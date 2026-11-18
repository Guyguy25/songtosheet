"""SongToSheet transcription engine on Modal (GPU billed per second).

- `wake`: HTTPS endpoint called by the site when a job is queued; starts `process_queue`.
- `process_queue`: GPU container that processes queued jobs with track_worker, then stops.
- `watchdog`: every 2 minutes, restarts `process_queue` if a job is waiting (lost wake-up).
- `benchmark`: `modal run backend/modal_app.py::benchmark --url <YouTube>` measures real timings.

Secret `custom-secret` (created by the owner in Modal): TRACK_WORKER_TOKEN,
ENGINE_WAKE_SECRET, SITE_URL.  Deployed by .github/workflows/deploy-engine.yml.
"""
import os
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
CODE = "/root/backend"
MT3_INFER = "git+https://github.com/openmirlab/mt3-infer.git@d8cbd287470291dee335f84315c5a9b9ff6e6c8a"
YOURMT3_URL = ("https://huggingface.co/spaces/mimbres/YourMT3/resolve/main/amt/logs/2024/"
               "mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops/checkpoints/last.ckpt")
YOURMT3_SHA256 = "ae38e415c79efd5592dcb9b658cdb99ddb11d4c4e1eaa364cab04a052473fc25"
TSUMUGI_COMMIT = "eba1c7d05e4d6a53cc4e8916d742d9623a3fdc38"
TSUMUGI_WEIGHTS = "https://huggingface.co/anime-song/instrument_agnostic_amt/resolve/main/best_model_guitar_v1_5.pth"
ARRANGER_COMMIT = "cd54d5b268d67404853b5aeb0b40eb7f6c0a27a4"
REMI_COMMIT = "832b96a0f990cdc3b67998836f3c067290632f6b"

app = modal.App("songtosheet-engine")
secret = modal.Secret.from_name("custom-secret")
# Residential proxy for YouTube downloads (TRACK_YTDLP_PROXY), kept in its own secret.
proxy_secret = modal.Secret.from_name("custom-secret-2")

# Small CPU image for the wake endpoint and the watchdog.
light = (modal.Image.debian_slim(python_version="3.11")
         .pip_install("requests>=2.32,<3", "fastapi[standard]>=0.115,<1")
         .add_local_file(HERE / "engine_cloud.py", f"{CODE}/engine_cloud.py"))

# GPU image: every model and its weights are baked in, so a container starts without downloads.
engine = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git", "curl", "ca-certificates", "chromium", "libsndfile1")
    .run_commands("curl -fsSL https://deb.nodesource.com/setup_22.x | bash -", "apt-get install -y nodejs")
    .pip_install_from_requirements(str(HERE / "requirements.txt"))
    .pip_install_from_requirements(str(HERE / "requirements-transcription.txt"))
    .pip_install("miditoolkit==1.0.1", "PyYAML>=6.0.2", "uv", "bgutil-ytdlp-pot-provider==2.0.2")
    # PO-token provider so YouTube accepts downloads from cloud servers (script mode, Node).
    .run_commands(
        "git clone --depth 1 --branch 2.0.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil",
        "cd /opt/bgutil/server && npm ci && npx tsc",
    )
    # Basic Pitch runs its ONNX model: TensorFlow (pulled in by basic-pitch on Linux) only slows start-up.
    .run_commands("python -m pip uninstall -y tensorflow tensorflow-cpu keras tf-keras || true")
    .run_commands(
        # YourMT3+ and Transkun in their own environment (pinned versions from backend/README.md).
        "python -m venv /opt/yourmt3",
        f"/opt/yourmt3/bin/pip install torch torchaudio 'transformers==4.43.4' 'mt3-infer[torch] @ {MT3_INFER}' "
        "transkun==2.0.1 moduleconf librosa pretty_midi",
        f"mkdir -p /models && curl -fL '{YOURMT3_URL}' -o /models/yourmt3.ckpt",
        f"echo '{YOURMT3_SHA256}  /models/yourmt3.ckpt' | sha256sum -c -",
        # Guitar engines.
        f"git clone https://github.com/anime-song/tsumugi.git /opt/tsumugi && git -C /opt/tsumugi checkout {TSUMUGI_COMMIT}",
        "cd /opt/tsumugi && uv sync --frozen --no-dev",
        f"curl -fL '{TSUMUGI_WEIGHTS}' -o /opt/tsumugi/best_model_guitar_v1_5.pth",
        f"git clone https://github.com/Sonata165/GuitarArranger.git /opt/guitararranger && "
        f"git -C /opt/guitararranger checkout {ARRANGER_COMMIT}",
        f"git clone https://github.com/Sonata165/REMI-z.git /opt/remi-z && git -C /opt/remi-z checkout {REMI_COMMIT}",
        # Weights fetched on first use, downloaded now instead.
        "python -c \"from demucs.pretrained import get_model; get_model('htdemucs'); get_model('htdemucs_6s')\"",
        "python -c \"from beat_this.inference import File2Beats; File2Beats(checkpoint_path='final0', device='cpu')\"",
    )
    # librosa compiles its numba code on first use (seconds per function, in the middle of a job):
    # compile it once here and keep the result in the image.
    # A generic CPU target: the cache built here is valid on the (different) machines that run jobs.
    .env({"NUMBA_CACHE_DIR": "/opt/numba-cache", "NUMBA_CPU_NAME": "generic"})
    .run_commands(
        "mkdir -p /opt/numba-cache && python -c \"import numpy as np, librosa; t = np.arange(44100 * 4) / 44100; y = (.2 * np.sin(2 * np.pi * 196 * t)).astype('float32'); v = librosa.resample(y, orig_sr=44100, target_sr=16000); librosa.feature.rms(y=v, frame_length=1600, hop_length=800); s = librosa.resample(y, orig_sr=44100, target_sr=22050); librosa.beat.beat_track(y=s, sr=22050, hop_length=512); h = librosa.effects.harmonic(s); librosa.feature.chroma_cqt(y=h, sr=22050, hop_length=512); e = librosa.onset.onset_strength(y=s, sr=22050, hop_length=512); librosa.onset.onset_detect(onset_envelope=e, sr=22050, hop_length=512)\"",
        # Same for the YourMT3+ venv, which reads and resamples every request with its own librosa.
        "/opt/yourmt3/bin/python -c \"import numpy as np, soundfile, librosa; t = np.arange(44100 * 4) / 44100; y = (.2 * np.sin(2 * np.pi * 196 * t)).astype('float32'); soundfile.write('/tmp/w.wav', np.stack([y, y], axis=1), 44100); librosa.load('/tmp/w.wav', sr=16000, mono=True)\"",
    )
    .env({
        "TRACK_YOURMT3_PYTHON": "/opt/yourmt3/bin/python",
        "TRACK_YOURMT3_CHECKPOINT": "/models/yourmt3.ckpt",
        "TRACK_YOURMT3_DEVICE": "cuda",
        "TRACK_TRANSKUN_DEVICE": "cuda",
        "TRACK_BEAT_DEVICE": "cuda",
        "TRACK_TSUMUGI_ROOT": "/opt/tsumugi",
        "TRACK_TSUMUGI_CHECKPOINT": "/opt/tsumugi/best_model_guitar_v1_5.pth",
        "TRACK_TSUMUGI_PYTHON": "/opt/tsumugi/.venv/bin/python",
        "TRACK_TSUMUGI_DEVICE": "cuda",
        "TRACK_GUITARARRANGER_ROOT": "/opt/guitararranger",
        "TRACK_REMI_ROOT": "/opt/remi-z",
        "TRACK_PDF_BROWSER": "/usr/bin/chromium",
        "TRACK_YTDLP_POT_HOME": "/opt/bgutil/server",
        "PYTHONPATH": CODE,
    })
    .add_local_dir(HERE, CODE, ignore=["tests", "data", ".venv", "**/__pycache__", "web/sounds", "web/demo", ".env"])
)

with light.imports():
    from fastapi import HTTPException, Request


# L4 first; A10 when no L4 is free (Modal tries them in order), so a job never waits for capacity.
# Cost per second ≈ L4 0.000222 $ + 8 cores × 0.0000131 $ + 16 GiB × 0.00000222 $ ≈ 0.00036 $.
@app.function(image=engine, gpu=["L4", "A10"], cpu=8.0, memory=16384, timeout=600, scaledown_window=5,
              max_containers=2, secrets=[secret, proxy_secret])
def process_queue():
    from engine_cloud import run_drain

    taken = run_drain()
    print(f"File traitée : {taken} demande(s).", flush=True)
    return taken


@app.function(image=light, secrets=[secret], scaledown_window=2)
@modal.fastapi_endpoint(method="POST")
def wake(request: Request):
    import sys

    sys.path.insert(0, CODE)
    from engine_cloud import wake_allowed

    if not wake_allowed(request.headers.get("authorization"), os.environ.get("ENGINE_WAKE_SECRET", "")):
        print("wake: secret refusé", flush=True)
        raise HTTPException(status_code=403, detail="Accès refusé.")
    process_queue.spawn()
    print("wake: moteur lancé", flush=True)
    return {"started": True}


# Safety net for a lost wake call: rare now, so a 5-minute check is enough, and the
# container shuts down 2 s after each check instead of idling for a minute.
@app.function(image=light, secrets=[secret], schedule=modal.Period(minutes=5), timeout=60,
              scaledown_window=2)
def watchdog():
    import sys

    sys.path.insert(0, CODE)
    from engine_cloud import queue_has_job, site_call

    waiting = queue_has_job(site_call(os.environ["SITE_URL"], os.environ["TRACK_WORKER_TOKEN"]))
    print(f"watchdog: demande en attente = {waiting}", flush=True)
    if waiting:
        process_queue.spawn()


@app.function(image=engine, gpu="L4", cpu=4.0, memory=12288, timeout=900, secrets=[proxy_secret])
def measure(url: str):
    """Time the piano pipeline on a 30 s preview and on 3 minutes of a YouTube video."""
    import re
    import subprocess
    import tempfile
    import time

    from engine_cloud import engines
    from piano_comparison import generate
    from track_link import download_youtube

    video = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", url)
    if not video:
        raise ValueError("Lien YouTube invalide.")
    started = time.monotonic()
    loaded = engines()
    report = {"model_loading_s": round(time.monotonic() - started, 1)}
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        started = time.monotonic()
        source = download_youtube(video.group(1), folder)
        report["youtube_download_s"] = round(time.monotonic() - started, 1)
        for seconds in (30, 180):
            clip = folder / f"clip{seconds}.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-t", str(seconds),
                            "-ar", "44100", "-ac", "2", str(clip)], check=True)
            work = folder / f"work{seconds}"
            work.mkdir()
            stages, last = {}, [time.monotonic()]

            def step(name):
                now = time.monotonic()
                stages[name] = round(now - last[0], 1)
                last[0] = now

            started = last[0]
            _, files, recommendation = generate(clip, work, "Mesure", step, loaded.piano,
                                                solo_engine=loaded.solo_piano)
            step("end")
            report[f"piano_{seconds}s"] = {"total_s": round(time.monotonic() - started, 1), "stages_s": stages,
                                           "versions": sorted(files),
                                           "recommended": (recommendation or {}).get("recommended")}
    gpu_seconds = report["piano_180s"]["total_s"]
    report["estimated_cost_180s_usd"] = round(gpu_seconds * (0.000222 + 4 * 0.0000131 + 12 * 0.00000222), 4)
    print(report, flush=True)
    return report


@app.local_entrypoint()
def benchmark(url: str):
    print(measure.remote(url))


@app.function(image=engine, gpu="L4", cpu=8.0, memory=16384, timeout=900, secrets=[proxy_secret])
def measure_yourmt3(url: str):
    """YourMT3+ speed and note agreement, full precision vs bf16, on 30 s and 120 s of a video."""
    import json
    import re
    import subprocess
    import tempfile

    from pretty_midi import PrettyMIDI

    from engine_cloud import start_pot_server
    from track_link import download_youtube
    from yourmt3_engine import note_agreement

    video = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", url)
    if not video:
        raise ValueError("Lien YouTube invalide.")
    start_pot_server()
    report = {}
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        source = download_youtube(video.group(1), folder)
        for seconds in (30, 120):
            clip, work = folder / f"clip{seconds}.wav", folder / f"work{seconds}"
            work.mkdir()
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "30", "-i", str(source), "-t", str(seconds),
                            "-ar", "44100", "-ac", "2", str(clip)], check=True)
            output = subprocess.run([os.environ["TRACK_YOURMT3_PYTHON"], f"{CODE}/bench_yourmt3.py", str(clip),
                                     str(work), os.environ["TRACK_YOURMT3_CHECKPOINT"], "cuda"],
                                    check=True, capture_output=True, text=True).stdout
            times = json.loads(output.strip().splitlines()[-1])

            def notes(name):
                midi = PrettyMIDI(str(work / f"{name}.mid"))
                return [(note.pitch, note.start) for track in midi.instruments if not track.is_drum
                        for note in track.notes]
            full, half = notes("fp32"), notes("bf16")
            report[f"{seconds}s"] = {"fp32_s": times["fp32"], "bf16_s": times["bf16"], "notes_fp32": len(full),
                                     "notes_bf16": len(half), "agreement_f1": note_agreement(full, half)}
    print(report, flush=True)
    return report


@app.local_entrypoint()
def benchmark_yourmt3(url: str):
    print(measure_yourmt3.remote(url))


@app.function(image=engine, gpu=["L4", "A10"], cpu=8.0, memory=16384, timeout=900, secrets=[proxy_secret])
def measure_speed(url: str):
    """Where a guitar preview loses time: YouTube download variants, YourMT3+ alone vs alongside
    Demucs and Tsumugi (as in a real job)."""
    import re
    import subprocess
    import sys
    import tempfile
    import time
    from concurrent.futures import ThreadPoolExecutor

    from engine_cloud import engines, start_pot_server
    from stem_separation import separate
    from track_link import download_youtube, download_youtube_section, redact, youtube_options

    video = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", url)
    if not video:
        raise ValueError("Lien YouTube invalide.")
    video = video.group(1)
    start_pot_server()
    report = {}

    def timed(name, function):
        started = time.monotonic()
        try:
            result = function()
        except Exception as error:  # a measurement, not a job: report and go on
            result = f"erreur : {error}"
        report[name] = {"s": round(time.monotonic() - started, 1), "result": str(result)[-300:]}
        return result

    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        for index, name in enumerate(("section_1", "section_2")):
            target = folder / name
            target.mkdir()
            timed(f"download_{name}", lambda: download_youtube_section(video, target, 30, 60))
        verbose = folder / "verbose"
        verbose.mkdir()
        command = [sys.executable, "-m", "yt_dlp", *youtube_options(), "--verbose", "--no-playlist",
                   "--js-runtimes", "node", "--format", "bestaudio[ext=m4a]/bestaudio/best[acodec!=none]",
                   "--download-sections", "*30-60", "-o", str(verbose / "s.%(ext)s"),
                   "--", "https://www.youtube.com/watch?v=" + video]
        run = subprocess.run(command, capture_output=True, text=True, timeout=120)
        lines = redact(run.stderr + run.stdout).splitlines()
        report["section_verbose_tail"] = [line[:300] for line in lines
                                          if "ffmpeg" in line.lower() or "error" in line.lower()][-15:]
        for index, fmt in enumerate(("140", "251", "250", "249")):
            target = folder / f"fmt{fmt}"
            target.mkdir()

            def fetch(fmt=fmt, target=target):
                subprocess.run([sys.executable, "-m", "yt_dlp", *youtube_options(), "--no-playlist",
                                "--js-runtimes", "node", "--format", fmt, "-o", str(target / "a.%(ext)s"),
                                "--", "https://www.youtube.com/watch?v=" + video],
                               check=True, capture_output=True, timeout=120)
                return sum(file.stat().st_size for file in target.iterdir()) // 1024
            timed(f"download_format_{fmt}_kB", fetch)
        full = folder / "full"
        full.mkdir()
        source = timed("download_full", lambda: download_youtube(video, full))
        clip = folder / "clip.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "30", "-i", str(source), "-t", "30",
                        "-ar", "44100", "-ac", "2", str(clip)], check=True)

        timed("engines_ready", engines)
        loaded = engines()
        for attempt in (1, 2):
            timed(f"yourmt3_alone_{attempt}", lambda: loaded.piano.transcribe(clip, folder / "alone.mid"))
        with ThreadPoolExecutor(3) as pool:
            began = time.monotonic()
            jobs = {
                "yourmt3_with_others": pool.submit(loaded.piano.transcribe, clip, folder / "with.mid"),
                "demucs_with_others": pool.submit(separate, "htdemucs_6s", clip, folder / "stems"),
                "tsumugi_with_others": pool.submit(loaded.guitar.transcribe, clip, folder / "tsumugi.mid"),
            }
            for name, future in jobs.items():
                future.result()
                report[name] = round(time.monotonic() - began, 1)
        from guitar_accompaniment import accompany

        timed("accompany_full_chords", lambda: accompany(clip, folder / "chords", "Mesure", lambda _: None,
                                                         loaded.piano))
    for key, value in report.items():
        print(f"{key}: {value}", flush=True)
    return report


@app.local_entrypoint()
def benchmark_speed(url: str):
    print(measure_speed.remote(url))


@app.function(image=engine, cpu=8.0, memory=4096, timeout=600, secrets=[proxy_secret])
def measure_download(url: str):
    """Timestamped yt-dlp verbose output: where a YouTube download spends its seconds."""
    import re
    import subprocess
    import sys
    import tempfile
    import time

    from engine_cloud import start_pot_server
    from track_link import redact, youtube_options

    video = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", url).group(1)
    start_pot_server()
    time.sleep(2)
    from track_link import download_youtube_section

    for attempt in range(3):
        with tempfile.TemporaryDirectory() as folder:
            started = time.monotonic()
            result = download_youtube_section(video, Path(folder), 30, 60.5)
            print(f"===== extrait en course n°{attempt + 1} : {time.monotonic() - started:.1f}s, "
                  f"{'ok' if result else 'échec'}", flush=True)
    for label, extra in (("extrait 1", ["--download-sections", "*30-60", "-f", "bestaudio[ext=m4a]/bestaudio"]),
                         ("extrait 2", ["--download-sections", "*30-60", "-f", "bestaudio[ext=m4a]/bestaudio"]),
                         ("complet léger", ["-f", "250/249/251/bestaudio"])):
        with tempfile.TemporaryDirectory() as folder:
            started = time.monotonic()
            process = subprocess.Popen([sys.executable, "-m", "yt_dlp", *youtube_options(), "--verbose",
                                        "--no-playlist", "--js-runtimes", "node", *extra, "-o", f"{folder}/a.%(ext)s",
                                        "--", "https://www.youtube.com/watch?v=" + video],
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            print(f"===== {label}", flush=True)
            for line in process.stdout:
                line = redact(line.rstrip())
                if line.startswith("[debug] ") and not any(word in line for word in ("Downloading", "Invoking",
                                                                                    "pot", "PO ", "ffmpeg")):
                    continue
                print(f"{time.monotonic() - started:6.1f}s {line[:220]}", flush=True)
            process.wait()
            print(f"===== {label} : {time.monotonic() - started:.1f}s, code {process.returncode}", flush=True)


@app.local_entrypoint()
def benchmark_download(url: str):
    measure_download.remote(url)

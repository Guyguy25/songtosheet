"""Process SongToSheet beta jobs on a machine with the transcription models."""
import argparse
from dataclasses import dataclass
import base64
from hashlib import file_digest
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from importlib.util import find_spec
from pathlib import Path
from urllib.parse import urlparse

import requests

from transcribe_track import AUDIO_FORMATS, load_note_model, run, transcribe
from score_pdf import render_pdf
from track_link import TrackLinkError, download_track, download_youtube, download_youtube_section
from tsumugi_engine import Tsumugi
from guitararranger_engine import GuitarArranger
from yourmt3_engine import YourMT3
from transkun_engine import Transkun


EXPORTS = {"musicxml": "score.musicxml", "tab": "tab.musicxml", "mid": "score.mid", "tabmid": "tab.mid"}
CHORD_EXPORTS = {"rhythmtab": "rhythm.musicxml", "rhythmmid": "rhythm.mid"}
REVIEW_TRACKS = ("original", "guitar", "vocals", "bass", "drums", "piano", "other")


def read_exports(folder, mapping):
    return {key: base64.b64encode((folder / name).read_bytes()).decode("ascii")
            for key, name in mapping.items() if (folder / name).is_file()}


def encode_vocals(original, source, output, limit):
    if not source.is_file():
        return
    import librosa
    import numpy as np

    voice, rate = librosa.load(source, sr=16000, mono=True)
    mix, _ = librosa.load(original, sr=rate, mono=True)
    frames = librosa.feature.rms(y=voice, frame_length=1600, hop_length=800)[0]
    threshold = max(.003, float(np.sqrt(np.mean(mix ** 2))) * .12)
    if np.count_nonzero(frames > threshold) >= 8:
        run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source),
             "-t", str(limit), "-map_metadata", "-1", "-ac", "1",
             "-ar", "24000", "-b:a", "64k", str(output)], timeout=20)


def include_vocals(exports, vocals):
    if vocals.is_file():
        voice = base64.b64encode(vocals.read_bytes()).decode("ascii")
        if 0 < len(voice) <= 420_000 and sum(map(len, exports.values())) + len(voice) <= 4_000_000:
            exports["vocals"] = voice


def compare_versions(audio, data, directory, job, report, guitar_engine, solo_engine, piano_engine):
    from guitar_accompaniment import accompany

    exports = {}
    options = {}
    direct = None
    vocals = directory / "vocals.mp3"

    def prepare_vocals(original, stems):
        try:
            encode_vocals(original, stems / "vocals.wav", vocals, job["preview_limit"])
        except Exception as error:
            vocals.unlink(missing_ok=True)
            print(f"{job['id']}: piste voix indisponible : {type(error).__name__}", flush=True)

    try:
        result = transcribe(audio, "guitare", data, isolated=False, title=job["title"],
                            progress=report, guitar_engine=guitar_engine, guitar_solo=True,
                            solo_engine=solo_engine, has_voice=True, compare_solo=True,
                            review_audio=prepare_vocals if job.get("guitar_vocals") and job.get("preview_limit") else None)
        files = read_exports(result, EXPORTS)
        if {"musicxml", "mid", "tab", "tabmid"} <= files.keys():
            direct = json.loads((result / "notes.json").read_text(encoding="utf-8"))
            exports.update(files)
            options["original-v1"] = {"score": result / "tab.musicxml", "midi": result / "tab.mid"}
            if direct.get("solo_engine") == "guitararranger-v2":
                solo = read_exports(result / "solo", {"solotab": "tab.musicxml", "solomid": "tab.mid"})
                if len(solo) == 2:
                    exports.update(solo)
                    options["solo-v2"] = {"score": result / "solo" / "tab.musicxml", "midi": result / "solo" / "tab.mid"}
    except Exception as error:
        print(f"{job['id']}: relevé guitare indisponible : {error}", flush=True)

    chord = None
    try:
        folder = directory / "chords"
        chord = accompany(audio, folder, job["title"], (lambda _: None) if direct else report, piano_engine)
        chord_files = read_exports(folder, CHORD_EXPORTS | {"heldtab": "tab.musicxml", "heldmid": "score.mid"})
        if len(chord_files) != 4:
            raise ValueError("Les deux accompagnements n’ont pas été exportés.")
        exports.update(chord_files)
        options["held-v1"] = {"score": folder / "tab.musicxml", "midi": folder / "score.mid"}
        options["rhythm-v1"] = {"score": folder / "rhythm.musicxml", "midi": folder / "rhythm.mid"}
        if not direct:
            exports.update(musicxml=chord_files["heldtab"], mid=chord_files["heldmid"], tab=chord_files["heldtab"])
    except Exception as error:
        chord = None
        print(f"{job['id']}: accompagnements indisponibles : {error}", flush=True)
    meta = direct or chord
    if not meta:
        raise ValueError("Aucune note exploitable. Essaie une piste plus claire ou un autre morceau.")
    if sum(map(len, exports.values())) > 4_000_000:
        raise ValueError("Les exports dépassent la taille maximale. Essaie un extrait plus court.")
    include_vocals(exports, vocals)
    recommendation = None
    if job.get("guitar_judge") and len(options) >= 2:
        report("judge")
        try:
            from evaluate_guitar_options import recommend

            recommendation = recommend(audio, options, guitar_evidence=(direct or {}).get("guitar_evidence"))
        except Exception as error:
            print(f"{job['id']}: recommandation automatique indisponible : {error}", flush=True)
    return meta, exports, recommendation


def publish_solo(call, identity, result, job, engine):
    folder = result / "solo"
    if not all((folder / filename).is_file() for filename in ("tab.musicxml", "tab.mid")):
        return
    title = f"{job['title']} – Guitare solo"
    try:
        exports = {kind: base64.b64encode((folder / filename).read_bytes()).decode("ascii")
                   for kind, filename in (("solotab", "tab.musicxml"), ("solomid", "tab.mid"))}
        if sum(map(len, exports.values())) > 4_000_000:
            raise ValueError("Tablature solo trop volumineuse.")
    except Exception as error:
        print(f"{job['id']}: arrangement solo indisponible : {error}", flush=True)
        return
    call("solo", **identity, exports=exports, solo_engine=engine)
    return folder, title


def encode_review_audio(original, stems, destination):
    destination.mkdir(exist_ok=True)
    for kind in REVIEW_TRACKS:
        source = original if kind == "original" else stems / f"{kind}.wav"
        if not source.is_file():
            continue
        output = destination / f"{kind}.mp3"
        try:
            run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source),
                 "-map_metadata", "-1", "-ar", "32000", "-b:a", "64k", str(output)], timeout=60)
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            output.unlink(missing_ok=True)
            print(f"Piste de diagnostic {kind} indisponible : {type(error).__name__}", flush=True)


def prepare_preview(audio, directory, limit, excerpt=None):
    input_options = ["-protocol_whitelist", "file", "-f", AUDIO_FORMATS[audio.suffix.lower()], "-i", str(audio)]
    duration = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=noprint_wrappers=1:nokey=1", *input_options], timeout=20))
    if not math.isfinite(duration) or duration < .5:
        raise ValueError("L’audio doit durer au moins 0,5 seconde.")
    seek = []
    if excerpt:
        start = excerpt["start_ms"] / 1000
        end = excerpt["end_ms"] / 1000
        if end > duration + .1 or min(duration, end) - start < .5:
            raise ValueError("L’extrait dépasse la durée de l’audio ou dure moins de 0,5 seconde.")
        limit = min(limit, end - start, duration - start)
        duration = limit
        seek = ["-ss", str(start)]
    preview = directory / "preview.wav"
    run(["ffmpeg", "-nostdin", "-v", "error", *input_options, *seek, "-map", "0:a:0", "-t", str(limit),
         "-ar", "44100", "-ac", "2", str(preview)], timeout=45)
    return preview, duration


def process_job(call, job, data, guitar_engine=None, solo_engine=None, piano_engine=None, solo_piano_engine=None):
    identity = {"id": job["id"], "lease": job["lease"]}
    job_started = time.monotonic()
    direct_published = False

    def report(stage):
        try:
            call("progress", **identity, stage=stage)
        except requests.RequestException:
            print(f"{job['id']}: étape {stage} non publiée", flush=True)

    try:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            section = None
            if job.get("youtube_id") and job.get("preview_limit") and os.getenv("TRACK_YOUTUBE_SECTIONS", "1") != "0":
                # A preview needs only 30 s: fetch that part instead of the whole video.
                begin = (job.get("excerpt") or {}).get("start_ms", 0) / 1000
                stop = begin + job["preview_limit"]
                if job.get("excerpt"):
                    stop = min(stop, job["excerpt"]["end_ms"] / 1000)
                section = download_youtube_section(job["youtube_id"], directory, begin, stop + .5)
                if section is None:
                    print(f"{job['id']}: extrait YouTube indisponible, téléchargement complet", flush=True)
            if section is not None:
                audio = section[0]
            elif job.get("youtube_id"):
                audio = download_youtube(job["youtube_id"], directory)
            elif job.get("audio_url"):
                audio = download_track(job["audio_url"], directory)
            else:
                audio = directory / f"input.{job['extension']}"
                with audio.open("wb") as file:
                    for index in range(job["chunks"]):
                        chunk = call("read", **identity, index=index)
                        file.write(base64.b64decode(chunk["data"], validate=True))
            capo = job.get("capo", 0)
            review = directory / "review"
            source_duration = None
            audio_hash = None
            if job.get("guitar_compare") and not (job.get("youtube_id") or job.get("audio_url")):
                with audio.open("rb") as stream:
                    audio_hash = file_digest(stream, "sha256").hexdigest()
            if section is not None:
                excerpt = job.get("excerpt")
                limit = job["preview_limit"]
                if excerpt:
                    limit = min(limit, (excerpt["end_ms"] - excerpt["start_ms"]) / 1000)
                audio, _ = prepare_preview(audio, directory, limit)
                source_duration = limit if excerpt else max(section[1], limit)
            elif job.get("preview_limit"):
                audio, source_duration = prepare_preview(audio, directory, job["preview_limit"], job.get("excerpt"))

            if job.get("piano_compare"):
                from piano_comparison import EXPORTS as PIANO_EXPORTS, generate

                vocals = directory / "piano-vocals.mp3"
                separation = None
                if job.get("piano_vocals"):
                    report("isolate")

                    def separate():
                        try:
                            run([sys.executable, "-m", "demucs", "-n", "htdemucs", "-o", str(directory),
                                 "--two-stems", "vocals", "--shifts", "0", str(audio)], timeout=110)
                            encode_vocals(audio, directory / "htdemucs" / audio.stem / "vocals.wav",
                                          vocals, job["preview_limit"])
                        except Exception as error:
                            vocals.unlink(missing_ok=True)
                            print(f"{job['id']}: piste voix piano indisponible : {error}", flush=True)

                    # The voice is only needed by the judge: separate it while the notes are transcribed.
                    separation = threading.Thread(target=separate, daemon=True)
                    separation.start()
                duration, variants, recommendation = generate(
                    audio, directory, job["title"], report, piano_engine, vocals=vocals,
                    solo_engine=solo_piano_engine, wait_vocals=separation.join if separation else None)
                primary = recommendation["recommended"] if recommendation else next(iter(variants))
                score, midi, count = variants[primary]
                exports = {}
                for key, (xml, mid, _) in variants.items():
                    score_key, midi_key = PIANO_EXPORTS[key]
                    exports.update(read_exports(directory, {score_key: xml.name, midi_key: mid.name}))
                score_key, midi_key = PIANO_EXPORTS[primary]
                exports.update(musicxml=exports[score_key], mid=exports[midi_key])
                if sum(map(len, exports.values())) > 4_000_000:
                    raise ValueError("Les exports dépassent la taille maximale. Essaie un extrait plus court.")
                include_vocals(exports, vocals)
                call("preview", **identity, duration=source_duration or duration,
                     preview_duration=duration, note_count=count, exports=exports,
                     engine="yourmt3-plus-moe-nops" if piano_engine is not None else "basic-pitch-0.4.0",
                     piano_primary=primary, piano_recommendation=recommendation)
                direct_published = True
                payload = {"ok": True, "preview": True, "exports": {}}
                call("finish", **identity, **payload)
                print(f"{job['id']}: comparatif piano terminé ({len(variants)} versions, {primary}) "
                      f"en {time.monotonic() - job_started:.1f}s", flush=True)
                return

            if job.get("guitar_compare"):
                meta, exports, recommendation = compare_versions(audio, data, directory, job, report, guitar_engine, solo_engine, piano_engine)
                call("preview", **identity, duration=source_duration or meta["duration"],
                     preview_duration=meta["duration"], note_count=len(meta["notes"]), exports=exports,
                     diagnostic=meta.get("diagnostic"), engine=meta.get("engine"),
                     solo_engine=meta.get("solo_engine"), audio_hash=audio_hash, recommendation=recommendation)
                call("finish", **identity, ok=True, preview=True, exports={})
                return

            def publish_direct(result, meta):
                nonlocal direct_published
                exports = {
                    key: base64.b64encode((result / filename).read_bytes()).decode("ascii")
                    for key, filename in (EXPORTS | CHORD_EXPORTS).items() if (result / filename).is_file()
                }
                if sum(map(len, exports.values())) > 4_000_000:
                    raise ValueError("Les exports dépassent la taille maximale. Essaie un extrait plus court.")
                call("preview", **identity, duration=source_duration or meta["duration"],
                     preview_duration=meta["duration"], note_count=len(meta["notes"]), exports=exports,
                     diagnostic=meta.get("diagnostic"), resolved_capo=meta.get("resolved_capo", capo),
                     engine=meta.get("engine"))
                direct_published = True
                print(f"{job['id']}: relevé disponible", flush=True)

            goal = job.get("guitar_goal")
            if goal == "chords":
                from guitar_accompaniment import accompany

                result = directory / "chords"
                meta = accompany(audio, result, job["title"], report, piano_engine)
                publish_direct(result, meta)
                call("finish", **identity, ok=True, preview=True, exports={})
                return
            started = time.monotonic()
            result = transcribe(audio, job["instrument"], data, isolated=job["isolated"], title=job["title"],
                                capo=capo, progress=report,
                                guitar_engine=guitar_engine, guitar_solo=goal != "original",
                                solo_engine=solo_engine, on_direct=publish_direct, piano_engine=piano_engine,
                                has_voice=job.get("source_content") != "instrumental",
                                review_audio=(lambda original, stems: encode_review_audio(original, stems, review))
                                if job.get("review_audio") else None)
            meta = json.loads((result / "notes.json").read_text(encoding="utf-8"))
            resolved_capo = meta.get("resolved_capo", capo)
            solo = publish_solo(call, identity, result, job, meta.get("solo_engine"))
            print(f"{job['id']}: calcul {time.monotonic() - started:.2f}s pour {meta['duration']:.2f}s audio", flush=True)
            payload = {"ok": True, "preview": True, "exports": {}}
            pdfs = [] if job.get("preview_limit") else [("pdf", result, job["title"], job.get("format", "partition"))]
            if solo and pdfs:
                pdfs.append(("solopdf", *solo, "tablature"))
            for kind, folder, title, format_ in pdfs:
                pdf = directory / f"{kind}.pdf"
                try:
                    render_pdf(folder, title, job["instrument"], format_, pdf, capo=resolved_capo)
                    encoded = base64.b64encode(pdf.read_bytes()).decode("ascii")
                    if sum(map(len, payload["exports"].values())) + len(encoded) > 4_000_000:
                        raise ValueError("PDF trop volumineux.")
                    payload["exports"][kind] = encoded
                except Exception as error:
                    print(f"{job['id']}: {kind} : {error}", flush=True)
                    if kind == "pdf":
                        payload["pdf_error"] = True
            for path in review.glob("*.mp3"):
                data64 = base64.b64encode(path.read_bytes()).decode("ascii")
                try:
                    call("review_audio", **identity, kind=path.stem, data=data64)
                except requests.RequestException:
                    print(f"{job['id']}: piste de diagnostic {path.stem} non publiée", flush=True)
    except requests.RequestException:
        raise  # The lease lets another attempt recover after a connection failure.
    except Exception as error:
        print(f"{job['id']}: {error}", flush=True)
        message = "La transcription a échoué. Essaie un audio valide ou une piste plus claire."
        if isinstance(error, TrackLinkError) or str(error).startswith(("L’audio doit durer", "L’audio dépasse", "Aucune note exploitable", "Les exports dépassent", "Les accords sont trop incertains", "Le moteur d’accompagnement")):
            message = str(error)
        payload = ({"ok": True, "preview": True, "exports": {}, "pdf_error": not job.get("preview_limit")}
                   if direct_published else {"ok": False, "error": message})
    for attempt in range(3):
        try:
            call("finish", **identity, **payload)
            print(f"{job['id']}: {'terminé' if payload['ok'] else 'échec'}", flush=True)
            return
        except requests.HTTPError as error:
            if error.response.status_code == 409:
                return  # Already committed, or this worker no longer owns the lease.
            if error.response.status_code < 500:
                raise
        except requests.RequestException:
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)


def _warm(engine):
    try:
        engine.warm()
    except Exception as error:
        print(f"Préchargement de {type(engine).__name__} impossible : {error}", flush=True)


@dataclass
class Engines:
    guitar: object = None
    solo: object = None
    piano: object = None
    solo_piano: object = None


def load_engines(piano_only=False):
    """Read the engines configured in the environment (TRACK_* variables)."""
    try:
        solo_piano = Transkun.from_env()
    except (OSError, ValueError) as error:
        print(f"Transkun indisponible : {error}", flush=True)
        solo_piano = None
    return Engines(None if piano_only else Tsumugi.from_env(), None if piano_only else GuitarArranger.from_env(),
                   YourMT3.from_env(), solo_piano)


def claim_payload(engines, guided_guitar_only=False, piano_only=False):
    """What this worker can process, sent with every claim."""
    youtube = find_spec("yt_dlp") is not None and find_spec("yt_dlp_ejs") is not None and shutil.which("node") is not None
    piano = engines.piano is not None
    guitar = engines.guitar is not None and engines.solo is not None
    return dict(pdf=True, links=True, youtube=youtube, capo=True, auto_capo=True,
                guitar_goals=True, guitar_chords=piano, guitar_compare=piano and guitar,
                guitar_judge=True, guitar_vocals=True, guided_guitar_only=guided_guitar_only,
                piano_only=piano_only, piano_compare=piano, piano_playable=piano,
                piano_judge_version=3 if piano else None,
                piano_vocals=piano and find_spec("demucs") is not None,
                excerpts=True, preview=piano_only or guitar)


def make_call(url, token):
    """Return (call, session): call(action, **fields) posts to the site's worker API."""
    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {token}"

    def call(action, **fields):
        response = session.post(url.rstrip("/") + "/api/track",
                                json={"action": action, **fields}, timeout=30, allow_redirects=False)
        response.raise_for_status()
        return response.json()
    return call, session


def run_job(call, job, cache, engines):
    process_job(call, job, cache, engines.guitar, engines.solo, engines.piano, engines.solo_piano)


JOB_LIMIT_SECONDS = 300  # the site's processing deadline per job


def drain(call, engines, cache, *, max_jobs=50, time_budget=None, guided_guitar_only=False, piano_only=False):
    """Process queued jobs until the queue is empty (cloud mode). Returns how many were taken.

    time_budget: seconds the container may still run; no job is claimed unless a full
    JOB_LIMIT_SECONDS remains.  A failing job does not stop the others; a connection
    error to the site propagates."""
    payload = claim_payload(engines, guided_guitar_only, piano_only)
    started = time.monotonic()
    done = 0
    while done < max_jobs:
        if time_budget is not None and time.monotonic() - started > time_budget - JOB_LIMIT_SECONDS:
            break
        job = call("claim", **payload)["job"]
        if not job:
            break
        done += 1
        try:
            run_job(call, job, cache, engines)
        except requests.RequestException:
            raise
        except Exception as error:
            print(f"{job.get('id')}: traitement interrompu : {error}", flush=True)
    return done


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("cache", type=Path)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--guided-guitar-only", action="store_true")
    parser.add_argument("--piano-only", action="store_true")
    args = parser.parse_args()
    token = os.environ.get("TRACK_WORKER_TOKEN")
    url = urlparse(args.url)
    if not token or not (url.scheme == "https" or (url.scheme == "http" and url.hostname in ("127.0.0.1", "localhost"))):
        parser.error("Configure TRACK_WORKER_TOKEN et une URL HTTPS ou locale.")

    if args.guided_guitar_only and args.piano_only:
        parser.error("Choisis un seul mode de traitement spécialisé.")
    engines = load_engines(args.piano_only)
    if args.piano_only and engines.piano is None:
        parser.error("Configure YourMT3+ pour le comparatif piano.")
    call, session = make_call(args.url, token)
    with session:
        if not args.once and not args.guided_guitar_only:
            load_note_model()
        # Load the piano models now rather than during the first user's job.
        for engine in (engines.piano, engines.solo_piano):
            if engine is not None and not args.once:
                threading.Thread(target=lambda engine=engine: _warm(engine), daemon=True).start()
        print(f"Moteur de transcription prêt. Piano : {'YourMT3+' if engines.piano else 'Basic Pitch'}"
              f"{' + Transkun' if engines.solo_piano else ''}.", flush=True)
        payload = claim_payload(engines, args.guided_guitar_only, args.piano_only)
        connected = False
        while True:
            try:
                job = call("claim", **payload)["job"]
                if not connected:
                    print("Connexion à la file de transcription confirmée.", flush=True)
                    connected = True
                if job:
                    run_job(call, job, args.cache, engines)
                if args.once:
                    return
                if not job:
                    time.sleep(5)
            except requests.RequestException as error:
                if args.once:
                    raise
                print(f"Connexion au site indisponible : {error}", flush=True)
                time.sleep(30)


if __name__ == "__main__":
    main()

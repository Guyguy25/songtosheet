"""Process SongToSheet beta jobs on a machine with the transcription models."""
import argparse
import base64
from hashlib import file_digest
import json
import math
import os
import shutil
import subprocess
import tempfile
import time
from importlib.util import find_spec
from pathlib import Path
from urllib.parse import urlparse

import requests

from transcribe_track import AUDIO_FORMATS, load_note_model, run, transcribe
from score_pdf import render_pdf
from track_link import TrackLinkError, download_track, download_youtube
from tsumugi_engine import Tsumugi
from guitararranger_engine import GuitarArranger
from yourmt3_engine import YourMT3


EXPORTS = {"musicxml": "score.musicxml", "tab": "tab.musicxml", "mid": "score.mid", "tabmid": "tab.mid"}
CHORD_EXPORTS = {"rhythmtab": "rhythm.musicxml", "rhythmmid": "rhythm.mid"}
REVIEW_TRACKS = ("original", "guitar", "vocals", "bass", "drums", "piano", "other")


def read_exports(folder, mapping):
    return {key: base64.b64encode((folder / name).read_bytes()).decode("ascii")
            for key, name in mapping.items() if (folder / name).is_file()}


def compare_versions(audio, data, directory, job, report, guitar_engine, solo_engine, piano_engine):
    from guitar_accompaniment import accompany

    exports = {}
    options = {}
    direct = None
    vocals = directory / "vocals.mp3"

    def prepare_vocals(original, stems):
        source = stems / "vocals.wav"
        if not source.is_file():
            return
        try:
            import librosa
            import numpy as np

            voice, rate = librosa.load(source, sr=16000, mono=True)
            mix, _ = librosa.load(original, sr=rate, mono=True)
            frames = librosa.feature.rms(y=voice, frame_length=1600, hop_length=800)[0]
            threshold = max(.003, float(np.sqrt(np.mean(mix ** 2))) * .12)
            if np.count_nonzero(frames > threshold) < 8:
                return
            run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source),
                 "-t", str(job["preview_limit"]), "-map_metadata", "-1", "-ac", "1",
                 "-ar", "24000", "-b:a", "64k", str(vocals)], timeout=20)
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
    if vocals.is_file():
        voice = base64.b64encode(vocals.read_bytes()).decode("ascii")
        if 0 < len(voice) <= 420_000 and sum(map(len, exports.values())) + len(voice) <= 4_000_000:
            exports["vocals"] = voice
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


def process_job(call, job, data, guitar_engine=None, solo_engine=None, piano_engine=None):
    identity = {"id": job["id"], "lease": job["lease"]}
    direct_published = False

    def report(stage):
        try:
            call("progress", **identity, stage=stage)
        except requests.RequestException:
            print(f"{job['id']}: étape {stage} non publiée", flush=True)

    try:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            if job.get("youtube_id"):
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
            if job.get("preview_limit"):
                audio, source_duration = prepare_preview(audio, directory, job["preview_limit"], job.get("excerpt"))

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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("cache", type=Path)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--guided-guitar-only", action="store_true")
    args = parser.parse_args()
    token = os.environ.get("TRACK_WORKER_TOKEN")
    url = urlparse(args.url)
    if not token or not (url.scheme == "https" or (url.scheme == "http" and url.hostname in ("127.0.0.1", "localhost"))):
        parser.error("Configure TRACK_WORKER_TOKEN et une URL HTTPS ou locale.")

    guitar_engine = Tsumugi.from_env()
    solo_engine = GuitarArranger.from_env()
    piano_engine = YourMT3.from_env()
    with requests.Session() as session:
        session.headers["Authorization"] = f"Bearer {token}"

        def call(action, **fields):
            response = session.post(args.url.rstrip("/") + "/api/track",
                                    json={"action": action, **fields}, timeout=30, allow_redirects=False)
            response.raise_for_status()
            return response.json()

        if not args.once and not args.guided_guitar_only:
            load_note_model()
        youtube = find_spec("yt_dlp") is not None and find_spec("yt_dlp_ejs") is not None and shutil.which("node") is not None
        print(f"Moteur de transcription prêt. Piano : {'YourMT3+' if piano_engine else 'Basic Pitch'}.", flush=True)
        connected = False
        while True:
            try:
                job = call("claim", pdf=True, links=True, youtube=youtube, capo=True, auto_capo=True,
                           guitar_goals=True, guitar_chords=piano_engine is not None,
                           guitar_compare=piano_engine is not None and guitar_engine is not None and solo_engine is not None,
                           guitar_judge=True,
                           guitar_vocals=True,
                           guided_guitar_only=args.guided_guitar_only,
                           excerpts=True, preview=guitar_engine is not None and solo_engine is not None)["job"]
                if not connected:
                    print("Connexion à la file de transcription confirmée.", flush=True)
                    connected = True
                if job:
                    process_job(call, job, args.cache, guitar_engine, solo_engine, piano_engine)
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

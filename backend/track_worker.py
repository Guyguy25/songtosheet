"""Process SongToSheet beta jobs on a machine with the transcription models."""
import argparse
import base64
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


EXPORTS = {"musicxml": "score.musicxml", "tab": "tab.musicxml", "mid": "score.mid", "tabmid": "tab.mid"}
REVIEW_TRACKS = ("original", "guitar", "vocals", "bass", "drums", "piano", "other")


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


def prepare_preview(audio, directory, limit):
    input_options = ["-protocol_whitelist", "file", "-f", AUDIO_FORMATS[audio.suffix.lower()], "-i", str(audio)]
    duration = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=noprint_wrappers=1:nokey=1", *input_options], timeout=20))
    if not math.isfinite(duration) or duration < .5:
        raise ValueError("L’audio doit durer au moins 0,5 seconde.")
    preview = directory / "preview.wav"
    run(["ffmpeg", "-nostdin", "-v", "error", *input_options, "-map", "0:a:0", "-t", str(limit),
         "-ar", "44100", "-ac", "2", str(preview)], timeout=45)
    return preview, duration


def process_job(call, job, data, guitar_engine=None, solo_engine=None):
    identity = {"id": job["id"], "lease": job["lease"]}

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
            if job.get("preview_limit"):
                audio, source_duration = prepare_preview(audio, directory, job["preview_limit"])

            def publish_direct(result, meta):
                exports = {
                    key: base64.b64encode((result / filename).read_bytes()).decode("ascii")
                    for key, filename in EXPORTS.items() if (result / filename).is_file()
                }
                if sum(map(len, exports.values())) > 4_000_000:
                    raise ValueError("Les exports dépassent la taille maximale. Essaie un extrait plus court.")
                call("preview", **identity, duration=source_duration or meta["duration"],
                     preview_duration=meta["duration"], note_count=len(meta["notes"]), exports=exports,
                     diagnostic=meta.get("diagnostic"), resolved_capo=meta.get("resolved_capo", capo),
                     engine=meta.get("engine"))
                print(f"{job['id']}: relevé disponible", flush=True)

            started = time.monotonic()
            result = transcribe(audio, job["instrument"], data, isolated=job["isolated"], title=job["title"],
                                capo=capo, progress=report,
                                guitar_engine=guitar_engine, guitar_solo=True,
                                solo_engine=solo_engine, on_direct=publish_direct,
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
        if isinstance(error, TrackLinkError) or str(error).startswith(("L’audio doit durer", "L’audio dépasse", "Aucune note exploitable", "Les exports dépassent")):
            message = str(error)
        payload = {"ok": False, "error": message}
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
    args = parser.parse_args()
    token = os.environ.get("TRACK_WORKER_TOKEN")
    url = urlparse(args.url)
    if not token or not (url.scheme == "https" or (url.scheme == "http" and url.hostname in ("127.0.0.1", "localhost"))):
        parser.error("Configure TRACK_WORKER_TOKEN et une URL HTTPS ou locale.")

    guitar_engine = Tsumugi.from_env()
    solo_engine = GuitarArranger.from_env()
    with requests.Session() as session:
        session.headers["Authorization"] = f"Bearer {token}"

        def call(action, **fields):
            response = session.post(args.url.rstrip("/") + "/api/track",
                                    json={"action": action, **fields}, timeout=30, allow_redirects=False)
            response.raise_for_status()
            return response.json()

        if not args.once:
            load_note_model()
        youtube = find_spec("yt_dlp") is not None and find_spec("yt_dlp_ejs") is not None and shutil.which("node") is not None
        print("Moteur de transcription prêt.", flush=True)
        while True:
            try:
                job = call("claim", pdf=True, links=True, youtube=youtube, capo=True, auto_capo=True,
                           preview=guitar_engine is not None and solo_engine is not None)["job"]
                if job:
                    process_job(call, job, args.cache, guitar_engine, solo_engine)
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

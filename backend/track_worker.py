"""Process SongToSheet beta jobs on a machine with the transcription models."""
import argparse
import base64
import json
import os
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

from transcribe_track import transcribe


EXPORTS = {"musicxml": "score.musicxml", "tab": "tab.musicxml", "mid": "score.mid"}


def process_job(call, job, data):
    identity = {"id": job["id"], "lease": job["lease"]}
    try:
        with tempfile.TemporaryDirectory() as temporary:
            audio = Path(temporary) / f"input.{job['extension']}"
            with audio.open("wb") as file:
                for index in range(job["chunks"]):
                    chunk = call("read", **identity, index=index)
                    file.write(base64.b64decode(chunk["data"], validate=True))
            result = transcribe(audio, job["instrument"], data, isolated=job["isolated"], title=job["title"])
        meta = json.loads((result / "notes.json").read_text(encoding="utf-8"))
        exports = {
            key: base64.b64encode((result / filename).read_bytes()).decode("ascii")
            for key, filename in EXPORTS.items() if (result / filename).is_file()
        }
        if sum(map(len, exports.values())) > 4_000_000:
            payload = {"ok": False, "error": "Les exports dépassent la taille maximale. Essaie un extrait plus court."}
        else:
            payload = {"ok": True, "duration": meta["duration"], "note_count": len(meta["notes"]), "exports": exports}
    except requests.RequestException:
        raise  # The lease lets another attempt recover after a connection failure.
    except Exception as error:
        print(f"{job['id']}: {error}", flush=True)
        message = "La transcription a échoué. Essaie un audio valide ou une piste plus claire."
        if str(error).startswith(("L’audio doit durer", "Aucune note exploitable")):
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

    with requests.Session() as session:
        session.headers["Authorization"] = f"Bearer {token}"

        def call(action, **fields):
            response = session.post(args.url.rstrip("/") + "/api/track",
                                    json={"action": action, **fields}, timeout=30, allow_redirects=False)
            response.raise_for_status()
            return response.json()

        print("Moteur de transcription prêt.", flush=True)
        while True:
            try:
                job = call("claim")["job"]
                if job:
                    process_job(call, job, args.cache)
                if args.once:
                    return
                if not job:
                    time.sleep(20)
            except requests.RequestException as error:
                if args.once:
                    raise
                print(f"Connexion au site indisponible : {error}", flush=True)
                time.sleep(30)


if __name__ == "__main__":
    main()

"""Glue between the Modal app and the existing worker, kept free of heavy imports.

The wake endpoint and the watchdog run in a small CPU image: they only need this
module and `requests`.  The GPU function imports track_worker lazily."""
import hmac
import os
from pathlib import Path

_engines = None


def wake_allowed(authorization, secret):
    """True only for 'Bearer <secret>' with a non-empty secret (constant-time compare)."""
    if not secret or not authorization or not authorization.startswith("Bearer "):
        return False
    return hmac.compare_digest(authorization[len("Bearer "):].encode(), secret.encode())


def site_call(url, token):
    """Minimal client for the site's worker API: call(action, **fields) -> dict."""
    import requests

    def call(action, **fields):
        response = requests.post(url.rstrip("/") + "/api/track", json={"action": action, **fields},
                                 headers={"Authorization": f"Bearer {token}"}, timeout=30, allow_redirects=False)
        response.raise_for_status()
        return response.json()
    return call


def queue_has_job(call):
    return bool(call("peek").get("queued"))


_pot_server = None


def start_pot_server():
    """Keep the bgutil PO-token server running (default http://127.0.0.1:4416).

    yt-dlp then asks it for tokens instead of starting a Node script per download."""
    global _pot_server
    home = os.getenv("TRACK_YTDLP_POT_HOME")
    if not home or (_pot_server is not None and _pot_server.poll() is None):
        return
    import subprocess

    try:
        _pot_server = subprocess.Popen(["node", "build/main.js"], cwd=home, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL)
    except OSError as error:
        print(f"Serveur de jetons YouTube indisponible : {error}", flush=True)


def engines():
    """Load (once per container) and warm the transcription engines."""
    global _engines
    if _engines is None:
        from track_worker import _warm, load_engines, load_note_model

        start_pot_server()
        try:
            import torch

            print(f"process_queue: GPU visible pour Demucs = {torch.cuda.is_available()}", flush=True)
        except ImportError:
            pass
        _engines = load_engines()
        load_note_model()
        # Transkun is only needed for piano recordings: it loads on first use.
        if _engines.piano is not None:
            _warm(_engines.piano)
        # Load the Demucs models now, while YourMT3+ loads in its own process.
        try:
            from stem_separation import _SEPARATORS, _api, _device

            for model in ("htdemucs_6s", "htdemucs"):
                _SEPARATORS.setdefault(model, _api().Separator(model=model, device=_device(), shifts=0))
        except Exception as error:
            print(f"Préchargement Demucs impossible : {error}", flush=True)
    return _engines


def run_drain(cache=Path("/tmp/songtosheet-cache"), time_budget=570):
    """Process the queue until it is empty. Returns the number of jobs taken.

    time_budget stays under process_queue's 600 s timeout."""
    from track_worker import drain, make_call

    call, session = make_call(os.environ["SITE_URL"], os.environ["TRACK_WORKER_TOKEN"])
    with session:
        return drain(call, engines(), cache, time_budget=time_budget)

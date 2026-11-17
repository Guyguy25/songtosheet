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


def engines():
    """Load (once per container) and warm the transcription engines."""
    global _engines
    if _engines is None:
        from track_worker import _warm, load_engines, load_note_model

        _engines = load_engines()
        load_note_model()
        # Transkun is only needed for piano recordings: it loads on first use.
        if _engines.piano is not None:
            _warm(_engines.piano)
    return _engines


def run_drain(cache=Path("/tmp/songtosheet-cache"), time_budget=570):
    """Process the queue until it is empty. Returns the number of jobs taken.

    time_budget stays under process_queue's 600 s timeout."""
    from track_worker import drain, make_call

    call, session = make_call(os.environ["SITE_URL"], os.environ["TRACK_WORKER_TOKEN"])
    with session:
        return drain(call, engines(), cache, time_budget=time_budget)

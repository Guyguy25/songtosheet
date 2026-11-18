import sys
from pathlib import Path

import track_link


def writer(path, delay, ok=True):
    code = f"import time,pathlib; time.sleep({delay}); pathlib.Path({str(path)!r}).write_bytes(b'x'*4096)"
    return [sys.executable, "-c", code + ("" if ok else "; raise SystemExit(1)")]


def test_race_keeps_the_first_success_and_stops_the_other(tmp_path):
    fast, slow = tmp_path / "fast", tmp_path / "slow"
    index, _ = track_link.race([writer(slow, 5), writer(fast, .1)], [slow, fast], timeout=10)
    assert index == 1
    assert not slow.exists()  # the slower attempt was stopped


def test_race_skips_a_failed_attempt(tmp_path):
    bad, good = tmp_path / "bad", tmp_path / "good"
    index, _ = track_link.race([writer(bad, 0, ok=False), writer(good, .5)], [bad, good], timeout=10)
    assert index == 1


def test_race_returns_none_when_everything_fails(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    index, results = track_link.race([writer(a, 0, ok=False), writer(b, 0, ok=False)], [a, b], timeout=10)
    assert index is None and len(results) == 2


def test_youtube_skips_hls_manifests(monkeypatch):
    monkeypatch.delenv("TRACK_YTDLP_POT_HOME", raising=False)
    options = track_link.youtube_options()
    assert "youtube:skip=hls" in options

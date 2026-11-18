import subprocess
from pathlib import Path

import track_link


def fake_run(created, seen):
    def run(command, **kwargs):
        seen.append(command)
        out = command[command.index("-o") + 1]
        (Path(out.replace("%(ext)s", created))).write_bytes(b"x" * 2048)
        return subprocess.CompletedProcess(command, 0, b"", b"")
    return run


def test_light_download_prefers_small_opus_without_reencoding(monkeypatch, tmp_path):
    seen = []
    monkeypatch.setattr(track_link.subprocess, "run", fake_run("opus", seen))
    audio = track_link.download_youtube("dQw4w9WgXcQ", tmp_path, light=True)
    command = seen[0]
    assert command[command.index("--format") + 1].startswith("250/249/")
    assert command[command.index("--audio-format") + 1] == "opus"
    assert audio.name == "input.opus"


def test_default_download_keeps_full_quality_m4a(monkeypatch, tmp_path):
    seen = []
    monkeypatch.setattr(track_link.subprocess, "run", fake_run("m4a", seen))
    audio = track_link.download_youtube("dQw4w9WgXcQ", tmp_path)
    assert seen[0][seen[0].index("--format") + 1].startswith("bestaudio[ext=m4a]")
    assert audio.name == "input.m4a"


def test_opus_audio_is_accepted():
    from transcribe_track import AUDIO_FORMATS

    assert ".opus" in AUDIO_FORMATS

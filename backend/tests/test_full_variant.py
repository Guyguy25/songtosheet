"""Full song of one paid version ("Générer la suite")."""
from pathlib import Path

import pytest

import track_worker


def write(folder, names):
    folder.mkdir(parents=True, exist_ok=True)
    for name in names:
        (folder / name).write_bytes(b"x" * 64)


def test_guitar_chords_only_run_the_accompaniment(tmp_path, monkeypatch):
    import guitar_accompaniment

    calls = []

    def accompany(audio, folder, title, report, engine):
        calls.append("accompany")
        write(folder, ["tab.musicxml", "score.mid", "rhythm.musicxml", "rhythm.mid"])
        return {"duration": 180.0, "notes": [1, 2, 3]}
    monkeypatch.setattr(guitar_accompaniment, "accompany", accompany)
    monkeypatch.setattr(track_worker, "transcribe", lambda *a, **k: calls.append("transcribe"))
    folder, meta = track_worker.generate_variant(tmp_path / "a.wav", tmp_path, tmp_path / "out",
                                                 {"id": "j", "title": "t", "instrument": "guitare", "variant": "rhythm-v1"},
                                                 lambda _: None, track_worker.Engines())
    assert calls == ["accompany"]
    assert {path.name for path in folder.iterdir()} >= {"score.musicxml", "score.mid", "tab.musicxml", "tab.mid"}
    assert meta["duration"] == 180.0


def test_guitar_original_skips_the_solo_arrangement(tmp_path, monkeypatch):
    seen = {}

    def transcribe(audio, instrument, data, **kwargs):
        seen.update(kwargs)
        result = tmp_path / "result"
        write(result, ["score.musicxml", "score.mid", "tab.musicxml", "tab.mid"])
        (result / "notes.json").write_text('{"duration": 200.0, "notes": [1]}', encoding="utf-8")
        return result
    monkeypatch.setattr(track_worker, "transcribe", transcribe)
    folder, meta = track_worker.generate_variant(tmp_path / "a.wav", tmp_path, tmp_path / "out",
                                                 {"id": "j", "title": "t", "instrument": "guitare", "variant": "original-v1"},
                                                 lambda _: None, track_worker.Engines())
    assert seen["guitar_solo"] is False
    assert (folder / "tab.musicxml").is_file() and meta["duration"] == 200.0


def test_piano_variant_skips_the_judge(tmp_path, monkeypatch):
    import piano_comparison

    seen = {}

    def generate(audio, directory, title, report, engine, **kwargs):
        seen.update(kwargs)
        write(directory, ["a.musicxml", "a.mid"])
        return 240.0, {"playable": (directory / "a.musicxml", directory / "a.mid", 321)}, None
    monkeypatch.setattr(piano_comparison, "generate", generate)
    folder, meta = track_worker.generate_variant(tmp_path / "a.wav", tmp_path, tmp_path / "out",
                                                 {"id": "j", "title": "t", "instrument": "piano", "variant": "playable"},
                                                 lambda _: None, track_worker.Engines())
    assert seen["judge"] is False
    assert (folder / "score.musicxml").is_file() and meta == {"duration": 240.0, "notes": 321}


def test_unknown_variant_is_refused(tmp_path, monkeypatch):
    import piano_comparison

    monkeypatch.setattr(piano_comparison, "generate", lambda *a, **k: (10.0, {}, None))
    with pytest.raises(ValueError, match="version"):
        track_worker.generate_variant(tmp_path / "a.wav", tmp_path, tmp_path / "out",
                                      {"id": "j", "title": "t", "instrument": "piano", "variant": "solo"},
                                      lambda _: None, track_worker.Engines())

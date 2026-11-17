from pathlib import Path

import stem_separation


class FakeSeparator:
    created = 0
    samplerate = 44100

    def __init__(self, model, device, shifts):
        FakeSeparator.created += 1
        self.model = model

    def separate_audio_file(self, file):
        import torch
        origin = torch.ones(2, 10)
        return origin, {"vocals": origin * .25, "guitar": origin * .5}


class FakeApi:
    Separator = FakeSeparator
    saved = {}

    @staticmethod
    def save_audio(wav, path, samplerate):
        Path(path).write_text(f"{float(wav.mean()):.2f}")


def test_stems_written_like_the_demucs_cli_and_model_kept(monkeypatch, tmp_path):
    monkeypatch.setattr(stem_separation, "_api", lambda: FakeApi)
    stem_separation._SEPARATORS.clear()
    audio = tmp_path / "input.wav"
    audio.write_bytes(b"x")
    folder = stem_separation.separate("htdemucs_6s", audio, tmp_path)
    assert folder == tmp_path / "htdemucs_6s" / "input"
    assert (folder / "guitar.wav").read_text() == "0.50"
    stem_separation.separate("htdemucs_6s", audio, tmp_path)
    assert FakeSeparator.created == 1  # loaded once per container


def test_two_stems_mode(monkeypatch, tmp_path):
    monkeypatch.setattr(stem_separation, "_api", lambda: FakeApi)
    stem_separation._SEPARATORS.clear()
    audio = tmp_path / "preview.wav"
    audio.write_bytes(b"x")
    folder = stem_separation.separate("htdemucs", audio, tmp_path, two_stems="vocals")
    assert sorted(path.name for path in folder.iterdir()) == ["no_vocals.wav", "vocals.wav"]
    assert (folder / "no_vocals.wav").read_text() == "0.75"


def test_warm_loads_models_and_runs_one_pass(monkeypatch):
    runs = []

    class Warmable(FakeSeparator):
        audio_channels = 2

        def separate_tensor(self, wav):
            runs.append(tuple(wav.shape))

    class Api(FakeApi):
        Separator = Warmable

    monkeypatch.setattr(stem_separation, "_api", lambda: Api)
    monkeypatch.setattr(stem_separation, "_device", lambda: "cpu")
    stem_separation._SEPARATORS.clear()
    stem_separation.warm()
    assert runs == [(2, 44100), (2, 44100)] and set(stem_separation._SEPARATORS) == {"htdemucs_6s", "htdemucs"}

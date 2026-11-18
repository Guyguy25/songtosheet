import numpy as np
import pretty_midi
import soundfile


def write_midi(path, notes):
    midi = pretty_midi.PrettyMIDI()
    piano = pretty_midi.Instrument(program=0)
    for pitch, start, end in notes:
        piano.notes.append(pretty_midi.Note(velocity=80, pitch=pitch, start=start, end=end))
    midi.instruments.append(piano)
    midi.write(str(path))


def test_parallel_judge_gives_the_same_scores(tmp_path):
    import evaluate_piano_options as judge

    rate = 22050
    t = np.arange(rate * 8) / rate
    audio = sum(np.sin(2 * np.pi * f * t) * (np.sin(2 * np.pi * .5 * t) > 0) for f in (261.6, 329.6, 392.0))
    source = tmp_path / "source.wav"
    soundfile.write(source, (.1 * audio).astype("float32"), rate)
    candidates = {}
    for key, shift in (("a", 0), ("b", 2), ("c", 7)):
        path = tmp_path / f"{key}.mid"
        write_midi(path, [(60 + shift + i % 3 * 4, i * .5, i * .5 + .4) for i in range(14)])
        candidates[key] = path
    sequential = judge.recommend_v3(source, candidates, workers=1)
    parallel = judge.recommend_v3(source, candidates)
    assert sequential is not None and parallel == sequential


def test_transkun_runs_alongside_yourmt3(tmp_path, monkeypatch):
    import threading

    import piano_comparison

    transkun_started = threading.Event()
    seen = {}

    class YourMT3:
        def transcribe(self, audio, destination):
            seen["parallel"] = transkun_started.wait(5)
            raise ValueError("stop here")

    class Transkun:
        def transcribe(self, audio, destination):
            transkun_started.set()
            raise ValueError("no piano")
    monkeypatch.setattr(piano_comparison, "run", lambda *args, **kwargs: "30")
    monkeypatch.setattr(piano_comparison, "track_beats", lambda audio: None)
    try:
        piano_comparison.generate(tmp_path / "a.wav", tmp_path, "t", lambda _: None, YourMT3(),
                                  solo_engine=Transkun())
    except ValueError:
        pass
    assert seen["parallel"] is True

def test_warm_audio_analysis_runs_every_first_call(tmp_path):
    from audio_warmup import warm_audio_analysis

    seconds = warm_audio_analysis(tmp_path)
    assert seconds >= 0
    assert list(tmp_path.iterdir()) == []  # its scratch audio is removed


def test_yourmt3_runs_bigger_batches():
    from yourmt3_engine import use_batch_size

    seen = []

    class Model:
        def inference_file(self, bsz, audio_segments):
            seen.append(bsz)
            return "tokens"
    model = Model()
    use_batch_size(model, 16)
    use_batch_size(model, 16)  # idempotent
    assert model.inference_file(bsz=8, audio_segments=[]) == "tokens"
    assert seen == [16]


def test_yourmt3_precision_defaults_to_full(monkeypatch):
    import contextlib

    from yourmt3_engine import precision_context

    monkeypatch.delenv("TRACK_YOURMT3_PRECISION", raising=False)
    assert isinstance(precision_context("cuda"), contextlib.nullcontext)
    monkeypatch.setenv("TRACK_YOURMT3_PRECISION", "bf16")
    assert isinstance(precision_context("cpu"), contextlib.nullcontext)  # bf16 only on the GPU


def test_note_agreement_scores_matching_notes():
    from yourmt3_engine import note_agreement

    reference = [(60, 1.0), (64, 2.0), (67, 3.0)]
    assert note_agreement(reference, reference) == 1.0
    assert note_agreement(reference, [(60, 1.02), (64, 2.0)]) == 0.8  # 2 of 3 matched: F1 = 0.8
    assert note_agreement([], []) == 1.0


def test_yourmt3_warm_clip_is_a_full_preview():
    from yourmt3_engine import warm_clip

    clip = warm_clip()
    assert len(clip) == 16000 * 30  # same shape as a real 30 s preview (15 segments, one batch)
    assert float(abs(clip).max()) > .05  # audible: silent windows would be skipped

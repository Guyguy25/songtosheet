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

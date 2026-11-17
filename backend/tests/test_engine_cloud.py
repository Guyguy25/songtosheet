from engine_cloud import queue_has_job, wake_allowed


def test_wake_requires_the_shared_secret():
    assert wake_allowed("Bearer s3cret", "s3cret")
    assert not wake_allowed("Bearer wrong", "s3cret")
    assert not wake_allowed(None, "s3cret")
    assert not wake_allowed("s3cret", "s3cret")
    assert not wake_allowed("Bearer ", "")


def test_queue_has_job_uses_peek():
    asked = []

    def call(action, **fields):
        asked.append(action)
        return {"queued": answer}
    answer = True
    assert queue_has_job(call) is True
    answer = False
    assert queue_has_job(call) is False
    assert asked == ["peek", "peek"]


def test_run_drain_logs_cost_and_subtracts_loading_time(monkeypatch, capsys):
    import engine_cloud
    import track_worker

    seen = {}
    monkeypatch.setenv("SITE_URL", "https://site.example")
    monkeypatch.setenv("TRACK_WORKER_TOKEN", "t")
    warmed = []
    monkeypatch.setattr(engine_cloud, "prepare_engines", lambda: "engines")
    monkeypatch.setattr(engine_cloud, "warm_engines", lambda loaded: warmed.append(loaded))

    def drain(call, loaded, cache, time_budget, warm):
        seen["budget"] = time_budget
        assert warmed == []  # the warm-up waits for a claimed job
        warm()
        return 1
    monkeypatch.setattr(track_worker, "drain", drain)
    assert engine_cloud.run_drain(time_budget=570) == 1
    assert seen["budget"] <= 570
    assert warmed == ["engines"]
    assert "coût estimé" in capsys.readouterr().out


def test_mix_transcription_failure_is_not_fatal(tmp_path):
    from transcribe_track import transcribe_mix

    class Broken:
        def transcribe(self, audio, destination):
            raise OSError("engine down")
    assert transcribe_mix(Broken(), tmp_path / "a.wav", tmp_path, 30.0) == ([], [])


def test_warm_engines_starts_tsumugi_without_waiting(monkeypatch):
    import threading

    import engine_cloud
    import stem_separation
    import track_worker
    from track_worker import Engines

    release, started, demucs = threading.Event(), threading.Event(), []

    class SlowGuitar:
        def warm(self):
            started.set()
            release.wait(5)
    monkeypatch.setattr(engine_cloud, "_warmed", False)
    monkeypatch.setattr(track_worker, "load_note_model", lambda: None)
    monkeypatch.setattr(stem_separation, "warm", lambda: demucs.append(1))
    engine_cloud.warm_engines(Engines(guitar=SlowGuitar()))
    assert started.wait(5) and not release.is_set()  # returned while Tsumugi was still starting
    assert demucs == [1]  # Demucs gets its warm-up pass
    release.set()

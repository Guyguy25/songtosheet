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
    monkeypatch.setattr(engine_cloud, "engines", lambda: "engines")

    def drain(call, loaded, cache, time_budget):
        seen["budget"] = time_budget
        return 1
    monkeypatch.setattr(track_worker, "drain", drain)
    assert engine_cloud.run_drain(time_budget=570) == 1
    assert seen["budget"] <= 570
    assert "coût estimé" in capsys.readouterr().out

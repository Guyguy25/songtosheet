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

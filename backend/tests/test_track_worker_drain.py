from pathlib import Path

import track_worker
from track_worker import Engines, claim_payload, drain


def jobs_then_empty(count):
    queue = [{"id": str(index), "lease": "l"} for index in range(count)]

    def call(action, **fields):
        assert action == "claim"
        return {"job": queue.pop(0) if queue else None}
    return call


def test_drain_processes_until_queue_empty(monkeypatch):
    seen = []
    monkeypatch.setattr(track_worker, "process_job", lambda call, job, *args: seen.append(job["id"]))
    assert drain(jobs_then_empty(2), Engines(), Path("/tmp")) == 2
    assert seen == ["0", "1"]


def test_drain_continues_after_failed_job(monkeypatch):
    seen = []

    def process(call, job, *args):
        seen.append(job["id"])
        if job["id"] == "0":
            raise ValueError("boom")
    monkeypatch.setattr(track_worker, "process_job", process)
    assert drain(jobs_then_empty(2), Engines(), Path("/tmp")) == 2
    assert seen == ["0", "1"]


def test_drain_stops_at_max_jobs(monkeypatch):
    monkeypatch.setattr(track_worker, "process_job", lambda *args: None)
    always = lambda action, **fields: {"job": {"id": "x", "lease": "l"}}
    assert drain(always, Engines(), Path("/tmp"), max_jobs=3) == 3


def test_claim_payload_matches_engines():
    without = claim_payload(Engines())
    assert without["piano_compare"] is False and without["piano_judge_version"] is None
    assert claim_payload(Engines(piano=object()))["piano_judge_version"] == 3


def test_drain_stops_claiming_when_time_runs_out(monkeypatch):
    # A job may take up to 5 minutes: never claim one the container could not finish.
    clock = iter([0, 100, 400]).__next__
    monkeypatch.setattr(track_worker.time, "monotonic", clock)
    monkeypatch.setattr(track_worker, "process_job", lambda *args: None)
    always = lambda action, **fields: {"job": {"id": "x", "lease": "l"}}
    assert drain(always, Engines(), Path("/tmp"), time_budget=600) == 1

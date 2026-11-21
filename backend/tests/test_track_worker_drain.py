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
    clock = iter([0, 100, 100, 100, 400, 400]).__next__  # start, check, job start, job end, check
    monkeypatch.setattr(track_worker.time, "monotonic", clock)
    monkeypatch.setattr(track_worker, "process_job", lambda *args: None)
    always = lambda action, **fields: {"job": {"id": "x", "lease": "l"}}
    assert drain(always, Engines(), Path("/tmp"), time_budget=600) == 1


def test_first_download_overlaps_engine_warmup(monkeypatch):
    # The audio of the first job downloads while the models load (warm), not after.
    import threading

    fetching = threading.Event()
    received = {}

    def fetch(call, job, directory):
        fetching.set()
        return ("audio", None)

    def warm():
        assert fetching.wait(5), "the download did not start during the warm-up"

    def process(call, job, *args, fetched=None):
        received["audio"] = fetched.result()
    monkeypatch.setattr(track_worker, "fetch_audio", fetch)
    monkeypatch.setattr(track_worker, "process_job", process)
    assert drain(jobs_then_empty(1), Engines(), Path("/tmp"), warm=warm) == 1
    assert received["audio"] == ("audio", None)


def test_empty_queue_skips_the_warmup(monkeypatch):
    warmed = []
    assert drain(jobs_then_empty(0), Engines(), Path("/tmp"), warm=lambda: warmed.append(1)) == 0
    assert warmed == []


def test_guitar_chords_run_alongside_the_guitar_transcription(monkeypatch):
    import threading

    import guitar_accompaniment

    chords_started = threading.Event()
    seen = {}

    def transcribe(*args, **kwargs):
        seen["parallel"] = chords_started.wait(5)
        raise ValueError("no guitar")

    def accompany(*args):
        chords_started.set()
        raise ValueError("no chords")
    monkeypatch.setattr(track_worker, "transcribe", transcribe)
    monkeypatch.setattr(guitar_accompaniment, "accompany", accompany)
    job = {"id": "j", "title": "t"}
    try:
        track_worker.compare_versions(Path("a.wav"), Path("/tmp"), Path("/tmp/x"), job, lambda _: None,
                                      None, None, None)
    except ValueError:
        pass
    assert seen["parallel"] is True


def test_guitar_judge_analysis_starts_with_the_transcription(monkeypatch):
    import threading

    import evaluate_guitar_options
    import guitar_accompaniment

    judge_started = threading.Event()
    seen = {}

    def transcribe(*args, **kwargs):
        seen["parallel"] = judge_started.wait(5)
        raise ValueError("no guitar")

    def prepare(audio):
        judge_started.set()
        return {}
    monkeypatch.setattr(track_worker, "transcribe", transcribe)
    monkeypatch.setattr(guitar_accompaniment, "accompany", lambda *args: (_ for _ in ()).throw(ValueError("x")))
    monkeypatch.setattr(evaluate_guitar_options, "prepare_judge", prepare)
    job = {"id": "j", "title": "t", "guitar_judge": True}
    try:
        track_worker.compare_versions(Path("a.wav"), Path("/tmp"), Path("/tmp/x"), job, lambda _: None,
                                      None, None, None)
    except ValueError:
        pass
    assert seen["parallel"] is True


def test_recommend_reuses_the_prepared_analysis(monkeypatch):
    import evaluate_guitar_options

    used = {}

    def evaluate(mix, candidates, guitar=None, reference=None, evidence=None):
        used.update(reference=reference, evidence=evidence)
        return {}
    monkeypatch.setattr(evaluate_guitar_options, "learned_reference",
                        lambda audio: (_ for _ in ()).throw(AssertionError("recomputed")))
    monkeypatch.setattr(evaluate_guitar_options, "evaluate", evaluate)
    evaluate_guitar_options.recommend(Path("a.wav"), {}, prepared={"reference": ["n"], "evidence": "e"})
    assert used == {"reference": ["n"], "evidence": "e"}


def test_piano_job_starts_transkun_right_after_the_claim(monkeypatch):
    started = []

    class Transkun:
        def warm(self):
            started.append("transkun")
    monkeypatch.setattr(track_worker, "process_job", lambda *args, **kwargs: None)
    engines = Engines(solo_piano=Transkun())
    drain(lambda action, **kw: {"job": {"id": "p", "instrument": "piano", "lease": "l"}}
          if not started and action == "claim" else {"job": None}, engines, Path("/tmp"), max_jobs=1)
    assert started == ["transkun"]


def test_guitar_job_leaves_transkun_off(monkeypatch):
    started = []

    class Transkun:
        def warm(self):
            started.append("transkun")
    monkeypatch.setattr(track_worker, "process_job", lambda *args, **kwargs: None)
    drain(lambda action, **kw: {"job": {"id": "g", "instrument": "guitare", "lease": "l"}}, Engines(solo_piano=Transkun()),
          Path("/tmp"), max_jobs=1)
    assert started == []


def test_drain_waits_for_a_first_job_when_woken_early(monkeypatch):
    seen = []
    monkeypatch.setattr(track_worker, "process_job", lambda call, job, *args: seen.append(job["id"]))
    answers = [None, None, {"id": "late", "lease": "l"}, None]
    call = lambda action, **fields: {"job": answers.pop(0) if answers else None}
    assert drain(call, Engines(), Path("/tmp"), idle_wait=30, poll_seconds=0) == 1
    assert seen == ["late"]


def test_drain_stops_at_once_on_an_empty_queue_without_idle_wait(monkeypatch):
    monkeypatch.setattr(track_worker, "process_job", lambda *args: None)
    calls = []
    call = lambda action, **fields: calls.append(action) or {"job": None}
    assert drain(call, Engines(), Path("/tmp")) == 0
    assert len(calls) == 1

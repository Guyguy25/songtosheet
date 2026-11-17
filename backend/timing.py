"""Per-engine timings in the logs: 'chrono <label>: <start>s → <end>s (<duration>s)'.

Times are counted from the start of the current job (start_job), so lines from
engines running in parallel can be read side by side."""
import functools
import time

_job_started = time.monotonic()


def start_job():
    global _job_started
    _job_started = time.monotonic()


def timed_call(label, function):
    @functools.wraps(function)
    def wrapper(*args, **kwargs):
        begin = time.monotonic()
        try:
            return function(*args, **kwargs)
        finally:
            end = time.monotonic()
            print(f"chrono {label}: {begin - _job_started:.1f}s → {end - _job_started:.1f}s "
                  f"({end - begin:.1f}s)", flush=True)
    return wrapper

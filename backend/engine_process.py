"""Keep a transcription model loaded in a child process between jobs.

Loading YourMT3+ or Transkun takes longer than transcribing a 30-second preview, so
the worker starts each model once and sends it one JSON request per job.  If the
child dies or times out, the next request starts a fresh one.
"""
import json
import os
import subprocess
import sys
import threading


class PersistentEngine:
    def __init__(self, command, name, *, startup_timeout=600):
        self.command = [str(part) for part in command]
        self.name = name
        self.startup_timeout = startup_timeout
        self.process = None
        self.lock = threading.Lock()

    def _start(self):
        environment = {key: value for key, value in os.environ.items() if key != "TRACK_WORKER_TOKEN"}
        self.process = subprocess.Popen(
            self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr,
            text=True, encoding="utf-8", errors="replace", bufsize=1, env=environment,
        )
        ready = self._read(self.startup_timeout)
        if ready.get("ready") is not True:
            self.close()
            raise ValueError(f"{self.name} n’a pas démarré.")

    def _read(self, timeout):
        result = {}

        def read():
            line = self.process.stdout.readline()
            if line:
                try:
                    result.update(json.loads(line))
                except json.JSONDecodeError:
                    result["error"] = "invalid response"

        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        reader.join(timeout)
        if reader.is_alive() or not result:
            self.close()
            raise ValueError(f"{self.name} ne répond pas.")
        return result

    def warm(self):
        """Start the child ahead of the first job."""
        with self.lock:
            if self.process is None or self.process.poll() is not None:
                self._start()

    def request(self, timeout=600, **fields):
        with self.lock:
            for attempt in range(2):
                if self.process is None or self.process.poll() is not None:
                    self._start()
                try:
                    self.process.stdin.write(json.dumps(fields) + "\n")
                    self.process.stdin.flush()
                except (BrokenPipeError, OSError):
                    self.close()
                    if attempt:
                        raise ValueError(f"{self.name} s’est arrêté.")
                    continue
                answer = self._read(timeout)
                if answer.get("ok"):
                    return answer
                raise ValueError(f"{self.name} : {answer.get('error', 'échec')}")

    def close(self):
        if self.process is not None:
            try:
                self.process.kill()
            except OSError:
                pass
            self.process = None


def protocol_channel():
    """Child side: keep the real stdout for answers and send any other output
    (library logs, C extensions) to stderr so it cannot corrupt the protocol."""
    sys.stdout.flush()
    channel = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    return channel


def serve(handler, channel):
    """Child side: announce readiness, then answer one JSON line per request."""
    print(json.dumps({"ready": True}), file=channel, flush=True)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            handler(request)
            answer = {"ok": True}
        except Exception as error:  # Report and keep the model loaded.
            answer = {"ok": False, "error": f"{type(error).__name__}: {error}"[:500]}
        print(json.dumps(answer), file=channel, flush=True)

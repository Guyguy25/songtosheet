"""Run the pinned YourMT3+ piano transcription model in a separate environment."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
from dataclasses import dataclass, field


ENGINE = "yourmt3-plus-moe-nops"
CHECKPOINT_SHA256 = "ae38e415c79efd5592dcb9b658cdb99ddb11d4c4e1eaa364cab04a052473fc25"


@dataclass
class YourMT3:
    python: Path
    checkpoint: Path
    device: str
    _process: object = field(default=None, repr=False, compare=False)

    @classmethod
    def from_env(cls):
        python = os.getenv("TRACK_YOURMT3_PYTHON")
        checkpoint = os.getenv("TRACK_YOURMT3_CHECKPOINT")
        if not python and not checkpoint:
            return None
        if not python or not checkpoint:
            raise ValueError("Configure Python et le checkpoint de YourMT3+.")
        from engine_process import interpreter

        python, checkpoint = interpreter(python), Path(checkpoint).resolve(strict=True)
        with checkpoint.open("rb") as weights:
            if hashlib.file_digest(weights, "sha256").hexdigest() != CHECKPOINT_SHA256:
                raise ValueError("Le checkpoint ne correspond pas aux poids YourMT3+ validés.")
        return cls(python, checkpoint, os.getenv("TRACK_YOURMT3_DEVICE", "auto"))

    @staticmethod
    def persistent():
        return os.getenv("TRACK_YOURMT3_PERSISTENT", "1") != "0"

    def _engine(self):
        from engine_process import PersistentEngine

        if self._process is None:
            self._process = PersistentEngine(
                [self.python, "-I", "-B", "-X", "utf8", Path(__file__).resolve(), "--serve",
                 self.checkpoint, self.device], "YourMT3+")
        return self._process

    def warm(self):
        if self.persistent():
            self._engine().warm()

    def transcribe(self, audio, destination):
        """Keep the model loaded between jobs (TRACK_YOURMT3_PERSISTENT=0 to disable)."""
        from pretty_midi import PrettyMIDI

        if self.persistent():
            try:
                self._engine().request(audio=str(Path(audio).resolve()), destination=str(Path(destination).resolve()))
                if Path(destination).is_file():
                    return PrettyMIDI(str(destination))
            except ValueError as error:
                print(f"YourMT3+ persistant indisponible, relance ponctuelle : {error}", file=sys.stderr, flush=True)
        result = subprocess.run(
            [str(self.python), "-I", "-B", "-X", "utf8", str(Path(__file__).resolve()),
             str(audio.resolve()), str(destination.resolve()), str(self.checkpoint), self.device],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1200,
        )
        if result.returncode or not destination.is_file():
            print(result.stderr[-2000:], file=sys.stderr, flush=True)
            raise ValueError("YourMT3+ n’a pas pu analyser cet audio.")
        return PrettyMIDI(str(destination))


_LOCK = None


BATCH_SIZE = 16  # mt3_infer decodes 8 segments at a time: 30 s of audio (15 segments) took two passes


def use_batch_size(model, size=BATCH_SIZE):
    """Make model.inference_file decode `size` segments per pass, whatever batch it is asked for."""
    if getattr(model, "_songtosheet_batch", None) == size:
        return
    original = getattr(model, "_songtosheet_inference", None) or model.inference_file

    def inference_file(*args, **kwargs):
        if "bsz" not in kwargs and args:  # bsz given positionally
            args = args[1:]
        kwargs["bsz"] = size
        return original(*args, **kwargs)
    model._songtosheet_inference = original
    model.inference_file = inference_file
    model._songtosheet_batch = size


def precision_context(device):
    """bf16 autocast on the GPU when TRACK_YOURMT3_PRECISION=bf16, full precision otherwise."""
    import contextlib

    if os.getenv("TRACK_YOURMT3_PRECISION", "fp32") != "bf16" or not str(device).startswith("cuda"):
        return contextlib.nullcontext()
    import torch

    return torch.autocast("cuda", dtype=torch.bfloat16)


def note_agreement(reference, candidate, tolerance=.05):
    """F1 between two note lists of (pitch, onset seconds): same pitch, onsets within 50 ms."""
    if not reference and not candidate:
        return 1.0
    unused = sorted(candidate)
    matched = 0
    for pitch, onset in sorted(reference):
        for index, (other_pitch, other_onset) in enumerate(unused):
            if other_pitch == pitch and abs(other_onset - onset) <= tolerance:
                matched += 1
                del unused[index]
                break
    return round(2 * matched / (len(reference) + len(candidate)), 4)


def _bigger_batches():
    try:
        from mt3_infer import api
    except ImportError:
        return
    for adapter in list(getattr(api, "_MODEL_CACHE", {}).values()):
        model = getattr(adapter, "model", None)
        if model is not None and hasattr(model, "inference_file"):
            use_batch_size(model)


def warm_clip(seconds=30, rate=16000):
    """30 s of audible synthetic audio: a warm-up pass with the shape of a real preview."""
    import numpy as np

    time = np.arange(seconds * rate) / rate
    chord = sum(np.sin(2 * np.pi * frequency * time) for frequency in (196.0, 246.9, 293.7))
    return (.1 * chord * (np.sin(2 * np.pi * time) > -.5)).astype(np.float32)


def preload(checkpoint, device):
    """Load the model once, before the first request (mt3_infer caches it)."""
    import time

    started = time.monotonic()
    import numpy as np
    from mt3_infer import transcribe

    with _LOCK:
        transcribe(np.zeros(16000, dtype=np.float32), sr=16000, model="yourmt3", checkpoint_path=checkpoint,
                   device=device, auto_download=False)  # loads the model
        _bigger_batches()
        # Then a pass with the real batch size: the first pass at a new shape sets up the GPU kernels
        # so a real 30 s preview does not pay for it.
        loaded = time.monotonic() - started
        transcribe(warm_clip(), sr=16000, model="yourmt3", checkpoint_path=checkpoint,
                   device=device, auto_download=False)
        print(f"YourMT3+ : modèle chargé en {loaded:.1f}s, prêt en {time.monotonic() - started:.1f}s "
              "(imports compris)", file=sys.stderr, flush=True)


def run(audio, destination, checkpoint, device):
    import contextlib

    import librosa
    from mt3_infer import transcribe

    samples, rate = librosa.load(audio, sr=16000, mono=True)
    lock = _LOCK if _LOCK is not None else contextlib.nullcontext()
    with lock:
        _bigger_batches()
        # mt3_infer caches the loaded model, so a serving process loads it only once.
        with precision_context(device):
            result = transcribe(samples, sr=rate, model="yourmt3", checkpoint_path=checkpoint, device=device,
                                auto_download=False)
        result.save(destination)


if __name__ == "__main__":
    if sys.argv[1] == "--serve":
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from engine_process import protocol_channel, serve

        import threading

        channel = protocol_channel()
        checkpoint, device = sys.argv[2:]
        _LOCK = threading.Lock()
        # Load the model in the background: the worker downloads and prepares the audio meanwhile.
        threading.Thread(target=preload, args=(checkpoint, device), daemon=True).start()
        serve(lambda request: run(request["audio"], request["destination"], checkpoint, device), channel)
    else:
        run(*sys.argv[1:])

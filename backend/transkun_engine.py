"""Transkun (Yan & Duan, MIT licence): high-accuracy transcription of solo piano audio.

Used when the source is mostly piano (piano covers, solo piano recordings), where it
is far more precise than multi-instrument models.  It runs in its own process,
normally the same Python environment as YourMT3+ (it needs PyTorch).
"""
import os
from pathlib import Path
import sys
from dataclasses import dataclass, field

ENGINE = "transkun-2.0"


@dataclass
class Transkun:
    python: Path
    device: str
    _process: object = field(default=None, repr=False, compare=False)

    @classmethod
    def from_env(cls):
        python = os.getenv("TRACK_TRANSKUN_PYTHON") or os.getenv("TRACK_YOURMT3_PYTHON")
        if os.getenv("TRACK_TRANSKUN", "1") == "0" or not python:
            return None
        from engine_process import interpreter

        return cls(interpreter(python), os.getenv("TRACK_TRANSKUN_DEVICE", "auto"))

    def _engine(self):
        from engine_process import PersistentEngine

        if self._process is None:
            self._process = PersistentEngine(
                [self.python, "-I", "-B", "-X", "utf8", Path(__file__).resolve(), "--serve", self.device],
                "Transkun")
        return self._process

    def warm(self):
        self._engine().warm()

    def transcribe(self, audio, destination):
        from pretty_midi import PrettyMIDI

        self._engine().request(audio=str(Path(audio).resolve()), destination=str(Path(destination).resolve()))
        if not Path(destination).is_file():
            raise ValueError("Transkun n’a pas pu analyser cet audio.")
        return PrettyMIDI(str(destination))


def load(device):
    import moduleconf
    import torch
    import transkun

    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    folder = Path(transkun.__file__).parent / "pretrained"
    manager = moduleconf.parseFromFile(str(folder / "2.0.conf"))
    model = manager["Model"].module.TransKun(conf=manager["Model"].config).to(device)
    checkpoint = torch.load(folder / "2.0.pt", map_location=device)
    model.load_state_dict(checkpoint.get("best_state_dict", checkpoint.get("state_dict")), strict=False)
    model.eval()
    torch.set_grad_enabled(False)
    return model, device


def run(model, device, audio, destination):
    import librosa
    import numpy as np
    import torch
    from transkun.Data import writeMidi

    samples, _ = librosa.load(audio, sr=model.fs, mono=False)
    samples = np.atleast_2d(samples).T.astype(np.float32)  # (frames, channels)
    notes = model.transcribe(torch.from_numpy(samples).to(device), discardSecondHalf=False)
    writeMidi(notes).write(destination)


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    if sys.argv[1] == "--serve":
        from engine_process import protocol_channel, serve

        channel = protocol_channel()
        model, device = load(sys.argv[2])
        serve(lambda request: run(model, device, request["audio"], request["destination"]), channel)
    else:
        audio, destination, device = sys.argv[1:]
        model, device = load(device)
        run(model, device, audio, destination)

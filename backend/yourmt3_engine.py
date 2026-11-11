"""Run the pinned YourMT3+ piano transcription model in a separate environment."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
from dataclasses import dataclass


ENGINE = "yourmt3-plus-moe-nops"
CHECKPOINT_SHA256 = "ae38e415c79efd5592dcb9b658cdb99ddb11d4c4e1eaa364cab04a052473fc25"


@dataclass(frozen=True)
class YourMT3:
    python: Path
    checkpoint: Path
    device: str

    @classmethod
    def from_env(cls):
        python = os.getenv("TRACK_YOURMT3_PYTHON")
        checkpoint = os.getenv("TRACK_YOURMT3_CHECKPOINT")
        if not python and not checkpoint:
            return None
        if not python or not checkpoint:
            raise ValueError("Configure Python et le checkpoint de YourMT3+.")
        python, checkpoint = Path(python).resolve(strict=True), Path(checkpoint).resolve(strict=True)
        with checkpoint.open("rb") as weights:
            if hashlib.file_digest(weights, "sha256").hexdigest() != CHECKPOINT_SHA256:
                raise ValueError("Le checkpoint ne correspond pas aux poids YourMT3+ validés.")
        return cls(python, checkpoint, os.getenv("TRACK_YOURMT3_DEVICE", "auto"))

    def transcribe(self, audio, destination):
        from pretty_midi import PrettyMIDI

        result = subprocess.run(
            [str(self.python), "-I", "-B", "-X", "utf8", str(Path(__file__).resolve()),
             str(audio.resolve()), str(destination.resolve()), str(self.checkpoint), self.device],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1200,
        )
        if result.returncode or not destination.is_file():
            print(result.stderr[-2000:], file=sys.stderr, flush=True)
            raise ValueError("YourMT3+ n’a pas pu analyser cet audio.")
        return PrettyMIDI(str(destination))


if __name__ == "__main__":
    import librosa
    from mt3_infer import transcribe

    audio, destination, checkpoint, device = sys.argv[1:]
    samples, rate = librosa.load(audio, sr=16000, mono=True)
    transcribe(samples, sr=rate, model="yourmt3", checkpoint_path=checkpoint, device=device,
               auto_download=False).save(destination)

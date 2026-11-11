"""Run the pinned guitar model in its own Python environment."""
import hashlib
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


CHECKPOINT_SHA256 = "59c8335517d1faf7d735fef29e061181d87b96385f2e9a08332791e2b64affd4"
ENGINE = "tsumugi-guitar-v1.5"


@dataclass(frozen=True)
class Tsumugi:
    root: Path
    checkpoint: Path
    python: str
    device: str

    @classmethod
    def from_env(cls):
        root = os.getenv("TRACK_TSUMUGI_ROOT")
        checkpoint = os.getenv("TRACK_TSUMUGI_CHECKPOINT")
        if not root and not checkpoint:
            return None
        if not root or not checkpoint:
            raise ValueError("Configure le dossier Tsumugi et le fichier des poids guitare.")
        root, checkpoint = Path(root).resolve(), Path(checkpoint).resolve()
        if not (root / "instrument_agnostic_amt" / "amt" / "cli" / "infer.py").is_file():
            raise ValueError("Le dossier Tsumugi ne contient pas le moteur de transcription.")
        with checkpoint.open("rb") as weights:
            if hashlib.file_digest(weights, "sha256").hexdigest() != CHECKPOINT_SHA256:
                raise ValueError("Le fichier doit correspondre aux poids Tsumugi Guitar v1.5 validés.")
        return cls(root, checkpoint, os.getenv("TRACK_TSUMUGI_PYTHON", sys.executable),
                   os.getenv("TRACK_TSUMUGI_DEVICE", "auto"))

    def transcribe(self, audio, destination):
        from pretty_midi import PrettyMIDI

        command = [
            self.python, "-m", "instrument_agnostic_amt.amt.cli.infer",
            "--type", "guitar_v1_5", "--checkpoint", str(self.checkpoint),
            "--audio", str(audio.resolve()), "--output-midi", str(destination.resolve()),
            "--device", self.device, "--disable-tqdm",
        ]
        result = subprocess.run(command, cwd=self.root, capture_output=True, timeout=240)
        if result.returncode or not destination.is_file():
            print(result.stderr.decode(errors="replace")[-1600:], file=sys.stderr, flush=True)
            raise ValueError("Le moteur guitare Tsumugi n’a pas pu analyser cet audio.")
        return PrettyMIDI(str(destination))

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
        python, checkpoint = Path(python).resolve(strict=True), Path(checkpoint).resolve(strict=True)
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


def run(audio, destination, checkpoint, device):
    import librosa
    from mt3_infer import transcribe

    samples, rate = librosa.load(audio, sr=16000, mono=True)
    # mt3_infer caches the loaded model, so a serving process loads it only once.
    transcribe(samples, sr=rate, model="yourmt3", checkpoint_path=checkpoint, device=device,
               auto_download=False).save(destination)


if __name__ == "__main__":
    if sys.argv[1] == "--serve":
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from engine_process import protocol_channel, serve

        channel = protocol_channel()
        checkpoint, device = sys.argv[2:]
        serve(lambda request: run(request["audio"], request["destination"], checkpoint, device), channel)
    else:
        run(*sys.argv[1:])

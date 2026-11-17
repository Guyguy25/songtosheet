"""Time YourMT3+ in full precision and in bf16 on one clip (run with the YourMT3 venv's python).

Usage: bench_yourmt3.py AUDIO OUT_DIR CHECKPOINT DEVICE -> prints a JSON report and writes
OUT_DIR/fp32.mid and OUT_DIR/bf16.mid."""
import json
import os
import sys
import time
from pathlib import Path


def main():
    import librosa
    from mt3_infer import transcribe

    from yourmt3_engine import _bigger_batches, precision_context

    audio, out, checkpoint, device = sys.argv[1:]
    samples, rate = librosa.load(audio, sr=16000, mono=True)

    def once():
        return transcribe(samples, sr=rate, model="yourmt3", checkpoint_path=checkpoint, device=device,
                          auto_download=False)
    once()  # loads the model
    _bigger_batches()
    report = {}
    for precision in ("fp32", "bf16"):
        os.environ["TRACK_YOURMT3_PRECISION"] = precision
        times = []
        for _ in range(2):  # the first bf16 pass may include one-off GPU set-up
            started = time.monotonic()
            with precision_context(device):
                result = once()
            times.append(round(time.monotonic() - started, 2))
        result.save(str(Path(out) / f"{precision}.mid"))
        report[precision] = times
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()

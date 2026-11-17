"""Demucs source separation with the model kept loaded between jobs.

`python -m demucs` starts Python, imports PyTorch and loads the model on every call
(about 20 s on the cloud GPU for a 30-second preview).  This runs the same
separation in-process and writes the same files: <out>/<model>/<track>/<stem>.wav.
TRACK_DEMUCS_INPROCESS=0 goes back to the command line.
"""
import os
from pathlib import Path
import subprocess
import sys
import threading

_SEPARATORS = {}
_LOCK = threading.Lock()


def _api():
    from demucs import api

    return api


def _device():
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def separate(model, audio, out, *, two_stems=None, timeout=900):
    audio, out = Path(audio), Path(out)
    folder = out / model / audio.name.rsplit(".", 1)[0]
    if os.getenv("TRACK_DEMUCS_INPROCESS", "1") != "0":
        try:
            api = _api()
            with _LOCK:
                separator = _SEPARATORS.get(model)
                if separator is None:
                    separator = _SEPARATORS[model] = api.Separator(model=model, device=_device(), shifts=0)
                origin, stems = separator.separate_audio_file(audio)
            if two_stems:
                kept = stems[two_stems]
                stems = {two_stems: kept, f"no_{two_stems}": origin - kept}
            folder.mkdir(parents=True, exist_ok=True)
            for name, wav in stems.items():
                api.save_audio(wav, folder / f"{name}.wav", samplerate=separator.samplerate)
            return folder
        except Exception as error:  # Fall back to the command line below.
            print(f"Demucs en mémoire indisponible, ligne de commande : {type(error).__name__}: {error}",
                  file=sys.stderr, flush=True)
    command = [sys.executable, "-m", "demucs", "-n", model, "-o", str(out), "--shifts", "0"]
    if two_stems:
        command += ["--two-stems", two_stems]
    subprocess.run(command + [str(audio)], check=True, capture_output=True, timeout=timeout)
    return folder

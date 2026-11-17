"""Run every audio analysis once on a short synthetic clip.

librosa compiles its numba functions on first use (several seconds each, holding a
global compile lock), and that cost hit every new cloud container in the middle of a
job.  Running this while the job's audio downloads moves it out of the way; with
NUMBA_CACHE_DIR baked into the image the compiled code is usually reused as is."""
import tempfile
import time
from pathlib import Path


def warm_audio_analysis(folder=None):
    import numpy as np
    import soundfile

    started = time.monotonic()
    rate = 44100
    seconds = np.arange(rate * 4) / rate
    tone = .2 * np.sin(2 * np.pi * 196 * seconds) * (np.sin(2 * np.pi * 2 * seconds) > 0)
    stereo = np.stack([tone, tone], axis=1).astype("float32")
    with tempfile.TemporaryDirectory(dir=folder) as work:
        clip = Path(work) / "warm.wav"
        soundfile.write(clip, stereo, rate)
        import librosa

        from evaluate_guitar_options import audio_evidence
        from guitar_accompaniment import estimate_tempo
        from transcribe_track import guitar_attacks

        voice, voice_rate = librosa.load(clip, sr=16000, mono=True)  # resampling (vocal track)
        librosa.feature.rms(y=voice, frame_length=1600, hop_length=800)
        signal, signal_rate = librosa.load(clip, sr=22050, mono=True)
        estimate_tempo(signal, signal_rate, 512)
        audio_evidence(clip)
        guitar_attacks(clip)
    return time.monotonic() - started

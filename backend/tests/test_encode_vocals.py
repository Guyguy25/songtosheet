import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import track_worker

MELODY = Path(__file__).with_name("melody.wav")


def test_voice_track_is_encoded_with_its_own_sample_rate():
    with tempfile.TemporaryDirectory() as folder:
        output = Path(folder) / "voice.mp3"
        track_worker.encode_vocals(MELODY, MELODY, output, 30)
        assert output.is_file() and output.stat().st_size > 0


def test_whole_song_voice_quality():
    with tempfile.TemporaryDirectory() as folder:
        output = Path(folder) / "voice.mp3"
        track_worker.encode_vocals(MELODY, MELODY, output, 600, *track_worker.FULL_VOICE_QUALITY)
        assert output.is_file() and output.stat().st_size > 0

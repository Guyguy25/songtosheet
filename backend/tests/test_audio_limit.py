import wave

import pytest

from transcribe_track import transcribe


def test_audio_over_ten_minutes_is_refused_before_any_work(tmp_path):
    source = tmp_path / "long.wav"
    with wave.open(str(source), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(1)
        audio.setframerate(4000)
        audio.writeframes(b"\x80" * 4000 * 611)  # 10 min 11 s of silence
    with pytest.raises(ValueError, match="^L’audio dépasse 10 minutes"):
        transcribe(source, "guitare", tmp_path / "out")

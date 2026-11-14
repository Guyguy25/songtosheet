import numpy as np

from evaluate_piano_options import score_notes, similarity


def test_spectral_ranking_checks_octave_timing_and_coverage():
    expected = np.zeros((88, 100), dtype=np.float32)
    expected[39, 10:25] = 1
    expected[46, 50:65] = 1
    first = dict(pitch=60, start=.1, end=.25)
    second = dict(pitch=67, start=.5, end=.65)
    assert score_notes(expected, .01, [first, second]) == 1
    assert score_notes(expected, .01, [first]) < 1
    assert score_notes(expected, .01, [{**first, "pitch": 72}, second]) < 1
    assert score_notes(expected, .01, [{**first, "start": .30, "end": .45}, second]) < 1
    assert score_notes(np.zeros_like(expected), .01, [first, second]) is None


def test_similarity_prefers_source_harmony_bass_and_timing():
    audio = np.zeros((88, 120), dtype=np.float32)
    reference = [(43, 10, 44), (64, 10, 30), (67, 30, 50),
                 (45, 60, 100), (69, 60, 80), (72, 80, 100)]
    for pitch, start, end in reference:
        audio[pitch - 21, start:end] = 1
    notes = [dict(pitch=pitch, start=start / 100, end=end / 100)
             for pitch, start, end in reference]
    score = similarity(audio, .01, notes)
    assert score > similarity(audio, .01, notes[1:3] + notes[4:])
    assert score > similarity(audio, .01, [{**note, "pitch": note["pitch"] + 1} for note in notes])
    assert score > similarity(audio, .01, [{**note, "start": note["start"] + .19,
                                           "end": note["end"] + .19} for note in notes])


def test_separated_vocal_makes_the_melody_count_on_a_tied_mix():
    mix = np.zeros((88, 100), dtype=np.float32)
    mix[[64 - 21, 67 - 21], 20:70] = .8
    mix[74 - 21, 20:70] = 1
    voice = np.zeros_like(mix)
    voice[64 - 21, 20:70] = 1
    melody = [dict(pitch=64, start=.20, end=.70)]
    other = [dict(pitch=67, start=.20, end=.70)]
    assert similarity(mix, .01, melody) == similarity(mix, .01, other)
    assert similarity(mix, .01, melody, voice) > similarity(mix, .01, other, voice)

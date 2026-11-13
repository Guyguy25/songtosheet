import numpy as np

from evaluate_piano_options import score_notes


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

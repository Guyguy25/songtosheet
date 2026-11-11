from guitar_tab import TabNote
from solo_quality import has_complete_opening, publishable_solo


TUNING = (64, 59, 55, 50, 45, 40)


def events(pitches):
    return [{"pitch": pitch, "start": index * .42} for index, pitch in enumerate(pitches)]


def test_recognizes_repeated_arp_without_rejecting_a_distinct_vocal_line():
    guitar = events([40, 55, 59, 64, 59, 55] * 4)
    assert has_complete_opening(guitar)
    assert not has_complete_opening(guitar, events([69, 67, 65, 67, 69, 70]))
    assert not has_complete_opening(events(range(48, 72)))
    assert not has_complete_opening(guitar + [{"pitch": 47, "start": note["start"]} for note in guitar])


def test_accepts_alternative_fingering_and_rejects_wrong_pitch_or_displaced_melody():
    melody = events([64, 66, 67, 69] * 4)
    # All notes can use the B string, including E, instead of the high E string.
    arrangement = [
        TabNote(note["pitch"], note["start"] + .04, note["start"] + .16, 90,
                2, note["pitch"] - 59, note["start"] + .04)
        for note in melody
    ]
    assert publishable_solo(melody, arrangement, TUNING, 0, .125)
    assert not publishable_solo(melody, arrangement[4:], TUNING, 0, .125)
    assert not publishable_solo(melody, arrangement + [TabNote(64, 0, .12, 90, 6, 0, 0)], TUNING, 0, .125)
    wide = TabNote(52, .04, .16, 90, 6, 12, .04)
    assert not publishable_solo(melody, arrangement + [wide], TUNING, 0, .125)

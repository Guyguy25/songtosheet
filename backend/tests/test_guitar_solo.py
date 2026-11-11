from xml.etree import ElementTree as ET

from guitar_solo import riff_notes, solo_notes
from guitar_tab import arrange, write_tab


def note(start, pitch, duration=.18, velocity=90):
    return {"start": start, "end": start + duration, "pitch": pitch, "velocity": velocity}


def test_recovers_a_mix_note_in_a_riff_without_importing_the_full_mix():
    guitar = [
        note(.2, 45), note(.22, 52), note(.22, 64),
        note(.5, 62), note(.8, 60),
        note(1.1, 57), note(1.1, 62), note(1.1, 65),
    ]
    mix = [note(.65, 61), note(.95, 50), note(1.25, 64)]
    result = riff_notes(guitar, mix, (), .6)
    assert result[0]["pitch"] == 45
    assert [(n["start"], n["pitch"]) for n in result if .5 <= n["start"] < 1.1] == [
        (.5, 62), (.65, 61), (.8, 60),
    ]


def test_arranged_melody_keeps_the_low_open_strings_and_adds_accompaniment_separately():
    guitar = [note(.2, 40), note(.5, 55), note(.8, 59), note(1.1, 64), note(1.4, 40)]
    lead = solo_notes(guitar, [], [], 120, 0, backing="melody")
    assert [n["pitch"] for n in lead] == [40, 55, 59, 64, 40]
    full = solo_notes(guitar, [], [(.2, 4, "minor"), (1.2, 4, "minor")], 120, 0)
    assert full[:len(lead)] == lead
    assert [(n["start"], n["pitch"]) for n in full[len(lead):]] == [(1.2, 40)]


def test_phrase_uses_the_following_melody_to_choose_the_chord_note():
    guitar = [note(0, 60), note(.3, 60), note(.3, 66), note(.6, 67), note(.9, 69)]
    assert [n["pitch"] for n in riff_notes(guitar, (), (), .6, phrase=True)] == [60, 66, 67, 69]


def test_compact_solo_keeps_pitches_and_beams_within_the_beat(tmp_path):
    tuning = (64, 59, 55, 50, 45, 40)
    notes = [note(i * .125, pitch, .125) for i, pitch in enumerate((71, 72, 74, 76, 74, 72))]
    tab = arrange(notes, tuning, compact=True)
    assert [n.pitch for n in tab] == [n["pitch"] for n in notes]
    assert max(n.fret for n in tab) <= 12
    target = tmp_path / "solo.musicxml"
    write_tab(tab, target, tuning, 120, "Solo", "guitare", grouped_rhythm=True)
    assert [beam.text for beam in ET.parse(target).findall(".//beam")] == [
        "begin", "continue", "continue", "end", "begin", "end",
    ]

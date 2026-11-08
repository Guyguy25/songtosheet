from xml.etree import ElementTree as ET

from guitar_tab import arrange, midi_notes, write_tab
from transcribe_track import TUNINGS, filter_guitar_echoes, guitar_diagnostic


def event(pitch, start, end):
    return {"pitch": pitch, "start": start, "end": end, "velocity": 90}


def test_arrangement_preserves_chord_attacks_and_a_sustained_bass():
    notes = [
        event(40, .08, 1.45),
        event(55, .08, .8),
        event(59, .08, .8),
        event(64, .33, 1.1),
    ]
    tab = arrange(notes, TUNINGS["guitare"])
    assert sorted(midi_notes(tab), key=lambda note: (note["start"], note["pitch"])) == notes
    assert len({note.string for note in tab}) == 4
    assert all(TUNINGS["guitare"][note.string - 1] + note.fret == note.pitch for note in tab)


def test_musicxml_writes_chords_and_full_bars_without_playback_drift(tmp_path):
    notes = [
        event(40, 0, 2.3),
        event(55, 0, .63),
        event(59, 0, 1.25),
        event(64, 2.04, 2.53),
    ]
    tab = arrange(notes, TUNINGS["guitare"])
    path = tmp_path / "tab.musicxml"
    write_tab(tab, path, TUNINGS["guitare"], 120, "Test", "guitare")
    bars = ET.parse(path).findall(".//measure")
    assert len(bars) == 2
    for bar in bars:
        assert sum(int(note.findtext("duration")) for note in bar.findall("note")
                   if note.find("chord") is None) == 32
    first_chord = bars[0].findall("note")[:3]
    assert [note.find("chord") is not None for note in first_chord] == [False, True, True]
    assert len({note.findtext("notations/technical/string") for note in first_chord}) == 3
    assert len(ET.parse(path).findall(".//note/pitch")) == len(notes)
    assert bars[0].find("note/notations/tied[@type='let-ring']") is not None
    assert bars[1].find("note[@print-object='no']/rest") is not None
    assert any(note["start"] == 2.04 for note in midi_notes(tab))


def test_arpeggio_does_not_print_sustaining_strings_as_new_chords(tmp_path):
    notes = [event(40, .10, .9), event(55, .14, .75), event(59, .20, .68)]
    tab = arrange(notes, TUNINGS["guitare"])
    path = tmp_path / "arpeggio.musicxml"
    write_tab(tab, path, TUNINGS["guitare"], 120, "Arpège", "guitare", transients=[.10, .14, .20])
    score = ET.parse(path)
    assert len(score.findall(".//note/pitch")) == 3
    assert score.findall(".//note/chord") == []


def test_strum_uses_one_column_for_delayed_notes_of_the_same_transient(tmp_path):
    notes = [event(40, 0.97, 1.3), event(55, 1.04, 1.35), event(59, 1.15, 1.4)]
    tab = arrange(notes, TUNINGS["guitare"])
    path = tmp_path / "strum.musicxml"
    write_tab(tab, path, TUNINGS["guitare"], 120, "Accord", "guitare", transients=[1, 1.18])
    pitched = [note for note in ET.parse(path).findall(".//note") if note.find("pitch") is not None]
    assert [note.find("chord") is not None for note in pitched] == [False, True, False]
    assert sorted(note["start"] for note in midi_notes(tab)) == [0.97, 1.04, 1.15]


def test_capo_fret_numbers_are_relative_and_midi_uses_sounding_pitch(tmp_path):
    tuning = TUNINGS["guitare"]
    notes = [event(42, .10, .8), event(66, .10, .8), event(40, 1, 1.5)]
    tab = arrange(notes, tuning, capo=2)
    assert sorted((note.pitch, note.fret) for note in tab) == [(42, 0), (66, 0)]
    assert {note["pitch"] for note in midi_notes(tab)} == {42, 66}
    path = tmp_path / "capo.musicxml"
    write_tab(tab, path, tuning, 120, "Test capo", "guitare", capo=2)
    score = ET.parse(path)
    assert score.findtext(".//staff-details/capo") == "2"
    assert score.findtext(".//direction-type/words") == "Capo · case 2"


def test_filter_preserves_the_chord_and_an_upper_note_with_its_own_attack():
    low = event(40, .1, .8)
    chord_note = event(55, .1, .7)
    echo = {**event(52, .17, .33), "velocity": 35}
    upper = {**event(59, .25, .4), "velocity": 35}
    notes = [low, chord_note, echo, upper]
    assert filter_guitar_echoes(notes, [.1, .25]) == [low, chord_note, upper]
    assert filter_guitar_echoes(notes, [.1, .17, .25]) == notes
    assert filter_guitar_echoes(notes, []) == notes
    diagnostic = guitar_diagnostic(notes, arrange(notes, TUNINGS["guitare"]), [.1], 0)
    assert diagnostic["matched_attacks"] == 2
    assert diagnostic["total_attacks"] == 3
    assert diagnostic["review_seconds"] == [0]

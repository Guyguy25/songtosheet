from xml.etree import ElementTree as ET

from guitar_tab import arrange, midi_notes, write_tab
from transcribe_track import TUNINGS


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
                   if note.find("chord") is None) == 16
    first_chord = bars[0].findall("note")[:3]
    assert [note.find("chord") is not None for note in first_chord] == [False, True, True]
    assert len({note.findtext("notations/technical/string") for note in first_chord}) == 3
    assert bars[1].find("note/tie[@type='stop']") is not None
    assert any(note["start"] == 2.04 for note in midi_notes(tab))

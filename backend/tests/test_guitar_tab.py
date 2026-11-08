from xml.etree import ElementTree as ET

from guitar_harmony import chord_changes, clean_arpeggio, tab_chord_changes
from guitar_tab import arrange, arrange_with_capo, midi_notes, write_tab
from transcribe_track import TUNINGS, filter_guitar_echoes, guitar_diagnostic, guitar_lead


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


def test_tab_names_strummed_and_arpeggiated_chords_without_altering_attacks(tmp_path):
    tuning = TUNINGS["guitare"]
    notes = [event(pitch, .10, .70) for pitch in (52, 57, 61, 64)]
    notes += [event(45, 1., 1.85), event(60, 1.2, 1.6), event(64, 1.4, 1.7)]
    notes += [event(pitch, 2.0, 2.5) for pitch in (40, 47, 52)]
    notes += [event(pitch, 3.0, 3.5) for pitch in (40, 47, 52, 56)]
    notes += [event(pitch, 4.0, 4.5) for pitch in (40, 47, 52)]
    tab = arrange(notes, tuning)
    chords = tab_chord_changes(tab, ())
    assert chords == [(.10, 9, "major"), (1., 9, "minor"), (2., 4, "power"), (3., 4, "major")]
    path = tmp_path / "mixed-chords.musicxml"
    write_tab(tab, path, tuning, 120, "Accords", "guitare", chords=chords)
    xml = ET.parse(path)
    assert [kind.get("text") for kind in xml.findall(".//harmony/kind")] == ["", "m", "5", ""]
    assert len(xml.findall(".//note/chord")) == 10
    assert len(xml.findall(".//note/pitch")) == len(notes)


def test_tab_does_not_infer_a_chord_from_detached_notes():
    notes = [event(45, 1., 1.1), event(60, 1.2, 1.3), event(64, 1.4, 1.5)]
    assert tab_chord_changes(arrange(notes, TUNINGS["guitare"]), ()) == []


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


def test_automatic_capo_prefers_playable_open_strings():
    tuning = TUNINGS["guitare"]
    notes = [event(pitch + 2, .1, .9) for pitch in tuning]
    capo, tab = arrange_with_capo(notes, tuning)
    assert capo == 2
    assert len(tab) == 6 and all(note.fret == 0 for note in tab)
    assert {note["pitch"] for note in midi_notes(tab)} == {note["pitch"] for note in notes}


def test_simple_lead_uses_the_same_two_strings_on_each_repetition():
    phrase = [61, 61, 59, 57, 55, 55, 57, 59, 57]
    notes = [event(pitch, i * .2, i * .2 + .23) for i, pitch in enumerate(phrase * 3)]
    echoes = [{**note, "pitch": 69, "velocity": 48} for i, note in enumerate(notes) if i % 9 == 8]
    lead = guitar_lead(notes + echoes)
    assert lead == notes
    tab = arrange(lead, TUNINGS["guitare"], simple=True)
    assert [(note.string, note.fret) for note in tab] == (
        [(2, 2), (2, 2), (2, 0), (3, 2), (3, 0), (3, 0), (3, 2), (2, 0), (3, 2)] * 3
    )
    chord_note = event(64, notes[0]["start"], notes[0]["end"])
    assert guitar_lead(notes + echoes + [chord_note]) is None


def test_arpeggio_labels_harmony_once_without_turning_notes_into_chords(tmp_path):
    shapes = [(45, 57, 60, 64), (53, 57, 60, 64), (48, 55, 60, 64), (43, 55, 59, 67)]
    notes = [event(pitch, section + i * .2, section + i * .2 + .18)
             for section, pitches in enumerate(shapes) for i, pitch in enumerate(pitches)]
    chords = chord_changes(notes, {id(note): .95 for note in notes})
    assert chords == [(0, 9, "minor"), (1, 5, "major-seventh"), (2, 0, "major"), (3, 7, "major")]
    path = tmp_path / "harmony.musicxml"
    write_tab(arrange(notes, TUNINGS["guitare"]), path, TUNINGS["guitare"],
              120, "Test", "guitare", chords=chords)
    xml = ET.parse(path)
    assert [node.findtext("kind") for node in xml.findall(".//harmony")] == [
        "minor", "major-seventh", "major", "major"]
    assert not xml.findall(".//note/chord")


def test_arpeggio_cleanup_holds_ringing_note_and_keeps_strummed_chords():
    bass = event(45, .1, .45)
    false_attack = event(45, .43, .7)
    pluck = event(57, .43, .61)
    lead = [bass, false_attack, pluck, event(60, .62, .8)]
    strengths = {id(note): .93 for note in lead}
    strengths[id(false_attack)] = .53
    assert clean_arpeggio(lead, strengths) == [{**bass, "end": .7}, pluck, lead[-1]]
    strummed = [event(pitch, onset, onset + .3) for onset in (.1, .5) for pitch in (45, 57, 60)]
    assert clean_arpeggio(strummed, {id(note): .95 for note in strummed}) == strummed


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

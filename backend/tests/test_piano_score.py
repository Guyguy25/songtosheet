from xml.etree import ElementTree

from piano_score import clean_piano_notes, estimate_piano_grid, piano_hands, write_piano_score


def test_basic_pitch_notes_can_be_persisted_in_the_result_manifest():
    import json
    from types import SimpleNamespace
    import numpy as np
    from transcribe_track import midi_events

    note = SimpleNamespace(pitch=np.int64(60), start=np.float32(.25),
                           end=np.float32(.75), velocity=np.int64(80))
    midi = SimpleNamespace(instruments=[SimpleNamespace(is_drum=False, notes=[note])])
    assert json.loads(json.dumps(midi_events(midi, 30))) == [
        {"pitch": 60, "start": .25, "end": .75, "velocity": 80}
    ]


def event(pitch, start, duration, velocity=85):
    return {"pitch": pitch, "start": start, "end": start + duration, "velocity": velocity}


def test_yourmt3_piano_merges_melodic_tracks_and_clips_to_preview():
    from types import SimpleNamespace
    from transcribe_track import piano_midi_events

    def note(pitch, start, end, velocity=70):
        return SimpleNamespace(pitch=pitch, start=start, end=end, velocity=velocity)

    piano = SimpleNamespace(is_drum=False, notes=[note(60, .10, 1), note(60, .65, 2), note(20, 0, 1)])
    strings = SimpleNamespace(is_drum=False, notes=[note(60, .12, .9, 90), note(67, .4, .6)])
    drums = SimpleNamespace(is_drum=True, notes=[note(42, .2, .3)])
    midi = SimpleNamespace(instruments=[piano, strings, drums])

    assert piano_midi_events(midi, 1) == [
        {"pitch": 60, "start": .10, "end": .65, "velocity": 90},
        {"pitch": 67, "start": .4, "end": .6, "velocity": 70},
        {"pitch": 60, "start": .65, "end": 1, "velocity": 70},
    ]


def test_regular_bass_and_melody_support_three_beats():
    notes = []
    for index, bass in enumerate((48, 52, 53, 55, 52)):
        start = 3.4 + 1.5 * index
        notes.extend([event(bass, start, 1.45), event(65, start, .5),
                      event(67, start + .5, .25), event(65, start + .75, .25)])
    assert estimate_piano_grid(notes, 120) == (120, 3)
    assert estimate_piano_grid(notes[:4], 120) == (120, 4)


def test_piano_exports_two_staves_and_preserves_real_octaves(tmp_path):
    bass = event(48, 0, .5)
    melody = event(60, 0, .24, 44)
    next_melody = event(60, .5, .24)
    false_bass = event(48, .51, .94, 61)
    notes = [bass, melody, next_melody, false_bass, event(62, .75, .24)]
    strengths = {id(item): .9 for item in notes}
    strengths[id(melody)] = .76
    strengths[id(false_bass)] = .59
    clean = clean_piano_notes(notes, strengths)
    assert len(clean) == 4
    assert clean[0]["end"] == false_bass["end"]

    destination = tmp_path / "piano.musicxml"
    write_piano_score(clean, destination, "Piano", 120, 3)
    xml = ElementTree.parse(destination)
    assert xml.findtext(".//staves") == "2"
    assert xml.findtext(".//time/beats") == "3"
    assert [node.findtext("sign") for node in xml.findall(".//clef")] == ["G", "F"]
    assert xml.find(".//note[staff='2']/dot") is not None


def test_middle_c_stays_with_alternating_left_hand():
    notes = [event(60, 0, .5)]
    for i in range(3):
        beat = 1.5 + i * .5
        notes.extend([event(52, beat, .30), event(72, beat, .48), event(60, beat + .25, .29)])
    right, left, patterns = piano_hands(notes, 120, 3)
    assert patterns == {1: (52, 60)}
    assert [item["pitch"] for item in left] == [52, 60] * 3
    assert [item["pitch"] for item in right] == [60, 72, 72, 72]

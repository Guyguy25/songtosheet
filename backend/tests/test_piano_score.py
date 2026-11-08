from xml.etree import ElementTree

from piano_score import clean_piano_notes, estimate_piano_grid, write_piano_score


def event(pitch, start, duration, velocity=85):
    return {"pitch": pitch, "start": start, "end": start + duration, "velocity": velocity}


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

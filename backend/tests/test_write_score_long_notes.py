import random
from xml.etree import ElementTree as ET

from transcribe_track import write_midi, write_score


def test_overlapping_long_notes_still_make_a_score(tmp_path):
    # Dense, overlapping notes held for many bars: music21 used to keep chords and voices longer
    # than their bar, which MusicXML cannot write ("duplex-maxima", too long).
    rng = random.Random(4)
    notes = []
    for _ in range(400):
        start = rng.uniform(0, 100)
        notes.append({"pitch": rng.randint(40, 76), "start": start,
                      "end": start + rng.choice([.1, .3, .8, 2, 6, 25, 60]), "velocity": 80})
    midi, xml = tmp_path / "score.mid", tmp_path / "score.musicxml"
    write_midi(notes, midi, 24, "guitare", 96)
    write_score(midi, xml, "Long", guitar=True)
    assert len(ET.parse(xml).findall(".//note/pitch")) > 300

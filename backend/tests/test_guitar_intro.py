from xml.etree import ElementTree

from guitar_evidence import refine_mixed_guitar, refine_picked_notes
from guitar_intro import open_pull_offs, repeated_open_intro
from guitar_tab import arrange, write_tab
from transcribe_track import TUNINGS


def note(pitch, start, velocity=90):
    return {"pitch": pitch, "start": start, "end": start + .43, "velocity": velocity}


def test_repeated_open_intro_preserves_picks_and_discards_octave_echoes(tmp_path):
    tuning = TUNINGS["guitare"]
    pattern = [40, 55, 59, 64, 59, 55]
    times = [2.8 + i * .43 for i in range(18)]
    picked = [note(pitch, start) for pitch, start in zip(pattern * 3, times)]
    echoes = [note(item["pitch"] + 12, item["start"] + .012, 48) for item in picked]
    raw = sorted(picked + echoes, key=lambda item: item["start"])
    strengths = {id(item): .91 if item["velocity"] == 90 else .70 for item in raw}
    result, origin, _, _, cycle, count = repeated_open_intro(raw, strengths, times, set(tuning))
    assert [item["pitch"] for item in result] == pattern * 3
    assert cycle == 6 and count == 18
    shifted = [{**item, "start": item["start"] - origin, "end": item["end"] - origin} for item in result]
    path = tmp_path / "intro.musicxml"
    write_tab(arrange(shifted, tuning), path, tuning, 70, "Intro", "guitare", meter=(6, 8), intro_count=count)
    xml = ElementTree.parse(path)
    assert xml.findtext(".//time/beat-type") == "8"
    for bar in xml.findall(".//measure")[:3]:
        assert [n.findtext("notations/technical/string") for n in bar.findall("note[pitch]")] == ["6", "3", "2", "1", "2", "3"]
        assert all(n.findtext("type") == "eighth" and n.find("chord") is None for n in bar.findall("note[pitch]"))
        assert [n.text for n in bar.findall("note/beam")] == ["begin", "continue", "end"] * 2
    assert not repeated_open_intro(raw, strengths, times[:12], set(tuning))


def test_pull_off_requires_acoustic_and_same_string_evidence(tmp_path):
    tuning = TUNINGS["guitare"]
    first, second = note(71, 1.50), note(64, 1.68)
    strengths = {id(first): .35, id(second): .70}
    transitions, echoes = open_pull_offs([first, second], strengths, [1.50, 1.68], [6., 3.], 1., .43, tuning)
    assert transitions == [(first, second, 1)] and not echoes
    assert open_pull_offs([first, second], strengths, [1.50, 1.68], [6., 5.], 1., .43, tuning) == ([], set())
    keys = ((1.50, 71), (1.68, 64))
    tab = arrange([first, second], tuning, string_hints=dict.fromkeys(keys, 1))
    path = tmp_path / "pull-off.musicxml"
    write_tab(tab, path, tuning, 70, "Pull-off", "guitare", pull_offs=[keys])
    xml = ElementTree.parse(path)
    assert [n.get("type") for n in xml.findall(".//pull-off")] == ["start", "stop"]
    assert xml.findtext(".//direction-type/words") == "P"
    assert [n.text for n in xml.findall(".//fret")] == ["7", "0"]


def test_repeated_open_picking_survives_a_quieter_competing_pitch():
    tuning = TUNINGS["guitare"]
    pitches = [40, 55, 59, 64, 59, 55] * 3 + [40, 55, 59, 64, 59, 71]
    times = [2.8 + index * .43 for index in range(len(pitches))]
    notes = [note(pitch, start, 87) for pitch, start in zip(pitches, times)]
    competing = note(52, times[21], 67)
    strengths = {id(item): .89 for item in notes} | {id(competing): .82}
    raw = sorted(notes + [competing], key=lambda item: item["start"])
    result, _, _, _, _, count = repeated_open_intro(raw, strengths, times, set(tuning))
    assert count == len(pitches)
    assert [item["pitch"] for item in result] == pitches


def test_pull_off_ignores_an_already_ringing_companion_when_acoustically_confirmed():
    tuning = TUNINGS["guitare"]
    first, ringing, second = note(71, 1.50, 74), note(52, 1.68, 64), note(64, 1.68, 77)
    strengths = {id(first): .70, id(ringing): .63, id(second): .85}
    evidence = {
        id(first): (1.50, 3.89, .89, .0, 1, .89),
        id(ringing): (1.68, .71, .84, .38, 4, .62),
        id(second): (1.68, 10.64, .88, .14, 1, .81),
    }
    args = [first, ringing, second], strengths, [1.50, 1.68], [5.61, 2.89], 1., .43, tuning
    assert open_pull_offs(*args, evidence=evidence) == ([(first, second, 1)], {id(ringing)})
    evidence[id(ringing)] = (1.68, 3.5, .84, .38, 4, .62)
    assert open_pull_offs(*args, evidence=evidence) == ([], set())


def test_acoustic_evidence_keeps_a_real_double_stop_and_filters_a_ringing_harmonic():
    bass, harmonic, melody = note(40, 1.50), note(52, 1.51, 49), note(71, 1.52, 85)
    strengths = {id(bass): .85, id(harmonic): .58, id(melody): .78}
    evidence = {
        id(bass): (1.50, 3.5, .95, .10, 6, .95),
        id(harmonic): (1.50, 1.15, .25, .22, 5, .15),
        id(melody): (1.50, 3.2, .92, .09, 1, .77),
    }
    clean, strings = refine_picked_notes([bass, harmonic, melody], strengths, evidence)
    assert clean == [bass, melody]
    assert strings == {(1.50, 40): 6, (1.52, 71): 1}


def test_mixed_guitar_drops_leaked_bass_but_keeps_a_doubled_chord(tmp_path, monkeypatch):
    import numpy as np
    import soundfile as sf

    rate = 22050
    time = np.arange(rate * 2) / rate
    envelope = np.clip((time - .5) * 100, 0, 1) * np.clip((1.2 - time) * 12, 0, 1)

    def tone(pitch):
        return envelope * np.sin(2 * np.pi * 440 * 2 ** ((pitch - 69) / 12) * time)

    bass, doubled, melody = (note(pitch, .5) for pitch in (45, 60, 67))
    sf.write(tmp_path / "guitar.wav", .04 * tone(45) + .11 * tone(60) + .10 * tone(67), rate)
    sf.write(tmp_path / "bass.wav", .26 * tone(45) + .35 * tone(60), rate)
    for stem in ("vocals", "piano", "other"):
        sf.write(tmp_path / f"{stem}.wav", np.zeros_like(time), rate)
    evidence = {id(doubled): (.5, 3., .92, .10, 2, .80), id(melody): (.5, 2., .91, .1, 1, .81)}
    monkeypatch.setattr("guitar_evidence.guitar_evidence", lambda *args: evidence)
    strengths = {id(bass): .40, id(doubled): .85, id(melody): .80}
    kept, _ = refine_mixed_guitar(tmp_path / "guitar.wav", [bass, doubled, melody], [.5], TUNINGS["guitare"], strengths)
    assert kept == [doubled, melody]


def test_musicxml_slide_requires_both_frets_on_the_same_string(tmp_path):
    tuning = TUNINGS["guitare"]
    keys = ((1.0, 69), (1.3, 67))
    notes = [note(pitch, start) for start, pitch in keys]
    path = tmp_path / "slide.musicxml"
    tab = arrange(notes, tuning, string_hints=dict.fromkeys(keys, 1))
    write_tab(tab, path, tuning, 70, "Slide", "guitare", slides=[keys])
    xml = ElementTree.parse(path)
    assert [n.get("type") for n in xml.findall(".//slide")] == ["start", "stop"]
    assert xml.findtext(".//direction-type/words") == "sl."
    assert [n.text for n in xml.findall(".//fret")] == ["5", "3"]
    tab = arrange(notes, tuning, string_hints={keys[0]: 1, keys[1]: 2})
    write_tab(tab, path, tuning, 70, "Slide", "guitare", slides=[keys])
    assert ElementTree.parse(path).findall(".//slide") == []

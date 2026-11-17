import numpy as np
from pretty_midi import PrettyMIDI

from evaluate_piano_options import agreement, consensus, explain, hand_split, playability
from piano_arranger import arrange, monophonic
from piano_beats import grid_from_beats, quantize, score_times, write_grid_midi
from piano_comparison import split_tracks, thin_hands
from piano_score import write_piano_score

BEAT = .625  # 96 BPM


def grid(first=.47, count=60, downbeat_index=1):
    beats = first + np.arange(count) * BEAT
    return grid_from_beats(beats, beats[downbeat_index::4])


def note(pitch, start, end, velocity=80):
    return {"pitch": pitch, "start": start, "end": end, "velocity": velocity}


def test_grid_finds_tempo_meter_and_pickup():
    g = grid()
    assert g.bpm == 96 and g.per_bar == 4
    start, pickup = g.layout()
    # Audio time 0 is .75 beat before the first beat, the first downbeat is one beat later.
    assert start == -.75 and pickup == 1.75
    assert abs(float(g.time(g.position(3.3))) - 3.3) < 1e-9


def test_quantize_snaps_to_sixteenths_and_keeps_audio_times():
    g = grid()
    placed = quantize([note(60, .47 + .01, .47 + BEAT - .02), note(64, .47 + BEAT * 1.27, .47 + BEAT * 2)], g)
    assert [n["pos"] for n in placed] == [.75, 2.0]
    assert placed[0]["length"] == 1
    assert abs(placed[0]["start"] - .47) < 1e-9


def test_midi_tempo_map_keeps_score_ticks_and_real_time(tmp_path):
    beats = np.cumsum([.47] + [.6] * 10 + [.66] * 10)  # the band slows down
    g = grid_from_beats(beats, beats[1::4])
    placed = quantize([note(60, beats[2], beats[3]), note(62, beats[15], beats[16])], g)
    midi = write_grid_midi(placed, tmp_path / "a.mid", g)
    reread = PrettyMIDI(str(tmp_path / "a.mid"))
    starts = sorted(n.start for n in reread.instruments[0].notes)
    assert abs(starts[0] - beats[2]) < .01 and abs(starts[1] - beats[15]) < .01
    ticks = sorted(reread.time_to_tick(s) for s in starts)
    start0, _ = g.layout()
    assert ticks[1] == round((15 - start0) * reread.resolution)
    assert midi.resolution == reread.resolution


def test_score_with_pickup_is_written_as_anacrusis(tmp_path):
    g = grid()
    placed = quantize([note(72, .47, .47 + BEAT), note(76, .47 + BEAT, .47 + 2 * BEAT)], g)
    _, pickup = g.layout()
    destination = tmp_path / "s.musicxml"
    write_piano_score(score_times(placed, g.bpm), destination, "Test", g.bpm, g.per_bar, pickup=pickup)
    text = destination.read_text(encoding="utf-8")
    assert '<measure implicit="yes" number="0">' in text
    assert '<measure implicit="no" number="1">' in text


def test_arrangement_puts_melody_right_and_chords_left():
    g = grid()
    melody = [note(76 - 12, .47 + (1 + i) * BEAT, .47 + (2 + i) * BEAT) for i in range(16)]
    harmony = []
    for bar in range(4):
        start = .47 + (1 + 4 * bar) * BEAT
        root, third = ((48, 4), (45, 3), (41, 4), (43, 4))[bar]
        harmony += [note(root - 12, start, start + 4 * BEAT)]
        harmony += [note(p, start + BEAT, start + 2 * BEAT, 55) for p in (root + 12, root + 12 + third, root + 19)]
    notes, chords = arrange(melody, harmony, g, 12.0)
    right = [n for n in notes if n["hand"] == "right"]
    left = [n for n in notes if n["hand"] == "left"]
    assert right and left
    assert min(n["pitch"] for n in right) >= 55 and max(n["pitch"] for n in left) < 66
    assert (0, "major") in chords and (9, "minor") in chords
    # The sung line was an octave low: it is lifted to the right-hand register.
    assert {n["pitch"] for n in right if n["velocity"] >= 64} == {76}


def test_monophonic_line_and_vocal_split():
    line = monophonic([note(60, 0, 1), note(64, 0, 1, 90), note(65, .5, 1)])
    assert [n["pitch"] for n in line] == [64, 65] and line[0]["end"] == .5

    midi = PrettyMIDI()
    from pretty_midi import Instrument, Note
    voice, piano = Instrument(100), Instrument(0)
    voice.notes += [Note(80, 70 + i % 3, i * .5, i * .5 + .4) for i in range(6)]
    piano.notes += [Note(70, 48, 0, 2), Note(70, 60, 0, 2)]
    midi.instruments += [voice, piano]
    vocal, other, share = split_tracks(midi, 10)
    assert len(vocal) == 6 and len(other) == 2 and share == 1


def test_thin_hands_keeps_wide_chords_playable():
    group = [note(p, 1, 2) for p in (36, 43, 48, 60, 64, 67, 72, 79, 84, 91)]
    kept = thin_hands(group)
    assert hand_split([n["pitch"] for n in kept])[2]
    assert max(n["pitch"] for n in kept) == 91 and min(n["pitch"] for n in kept) == 36


def test_playability_and_consensus():
    easy = [note(60, i * .5, i * .5 + .4) for i in range(10)]
    hard = [note(p, i * .5, i * .5 + .4) for i in range(10) for p in (30, 50, 62, 75, 90)]
    assert playability(easy) == 1 and playability(hard) < .5
    a = [note(60, 0, 1), note(64, 1, 2), note(67, 2, 3)]
    b = [note(60, .02, 1), note(64, 1.03, 2), note(79, 2, 3)]
    agreed = consensus([a, b])
    assert [n["pitch"] for n in agreed] == [60, 64]
    assert agreement(a[:2], agreed) == 1 and agreement(b, agreed) < 1
    assert consensus([a]) is None


def test_explanation_names_the_strengths():
    table = {"arrangement": {"melody": .95, "harmony": .8, "playability": 1, "notes": .4},
             "yourmt3": {"melody": .7, "harmony": .82, "playability": .6, "notes": .6}}
    text = explain("arrangement", table, True)
    assert text.startswith("Recommandée par l’IA") and "voix" in text

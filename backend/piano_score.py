"""Clean piano attacks and lay out the two hands on a grand staff."""
from bisect import bisect_left, bisect_right
from itertools import groupby
from math import ceil
from statistics import median

from guitar_tab import attack_groups


def clean_piano_notes(notes, strengths):
    kept = []
    latest = {}
    starts = [note["start"] for note in notes]
    for source in notes:
        pitch, start = source["pitch"], source["start"]
        around = notes[bisect_left(starts, start - .055):bisect_right(starts, start + .055)]
        strongest = max(around, key=lambda note: strengths[id(note)])
        strength = strengths[id(source)]
        previous = latest.get(pitch)
        weaker = strengths[id(strongest)] - strength >= .18
        if previous and strength < .72 and weaker:
            gap = start - previous["end"]
            long = previous["end"] - previous["start"] >= .34
            late_octave = strength < .45 and strongest["pitch"] == pitch + 12 and long and gap <= .38
            if gap <= .055 or late_octave:
                if long or pitch > strongest["pitch"]:
                    previous["end"] = max(previous["end"], source["end"])
                continue
        octave = any(
            (lower := latest.get(pitch - interval)) and lower["end"] >= start
            and source["velocity"] < .8 * lower["velocity"]
            for interval in (12, 24, 36)
        )
        if (strength < .42 and octave) or (
            strength < .60 and weaker and source["velocity"] <= .68 * strongest["velocity"]
        ):
            continue
        note = dict(source)
        latest[pitch] = note
        kept.append(note)
    return kept


def estimate_piano_grid(notes, default_bpm):
    """Choose a meter only when a regular bass pattern and note grid agree."""
    bass = []
    for note in notes:
        if note["pitch"] >= 60 or note["velocity"] < 60:
            continue
        if not bass or (note["pitch"] != bass[-1]["pitch"] and note["start"] - bass[-1]["start"] >= 1.15):
            bass.append(note)
            if len(bass) == 5:
                break
    if len(bass) < 5 or bass[0]["start"] - notes[0]["start"] > .05:
        return default_bpm, 4
    gaps = [right["start"] - left["start"] for left, right in zip(bass, bass[1:])]
    period = median(gaps)
    if max(abs(gap - period) for gap in gaps) > .07:
        return default_bpm, 4
    origin = notes[0]["start"]
    attacks = [group[0]["start"] - origin for group in attack_groups(notes, lambda note: note["start"])
               if group[0]["start"] <= bass[-1]["start"]]
    candidates = []
    for beats in (3, 4):
        step = period / (2 * beats)
        fit = sum(abs(time - round(time / step) * step) <= .045 for time in attacks) / len(attacks)
        candidates.append((fit, round(60 * beats / period), beats))
    candidates.sort(reverse=True)
    fit, bpm, beats = candidates[0]
    if fit >= .85 and fit - candidates[1][0] >= .15 and 60 <= bpm <= 190:
        return (default_bpm if abs(bpm - default_bpm) <= 2 else bpm), beats
    return default_bpm, 4


def piano_hands(notes):
    right, left = [], []
    for group in attack_groups(notes, lambda note: note["start"]):
        low = min(note["pitch"] for note in group)
        high = max(note["pitch"] for note in group)
        for note in group:
            pitch = note["pitch"]
            bass = pitch < 60 or (pitch == low and 60 <= pitch <= 62 and high - pitch >= 9)
            (left if bass else right).append(note)
    return right, left


def write_piano_score(notes, destination, title, bpm, beats):
    from music21 import chord, clef, instrument, layout, metadata, meter, note, pitch, stream, tempo

    score = stream.Score()
    score.metadata = metadata.Metadata(title=title)
    staves = []
    subdivisions = 2 if beats == 3 else 4
    scale = bpm * subdivisions / 60
    end = max(item["end"] for item in notes) * bpm / 60
    for index, hand in enumerate(piano_hands(notes)):
        staff = stream.PartStaff(id=f"Piano{index + 1}")
        staff.insert(0, instrument.Piano())
        staff.insert(0, meter.TimeSignature(f"{beats}/4"))
        staff.insert(0, (clef.TrebleClef, clef.BassClef)[index]())
        if index == 0:
            staff.insert(0, tempo.MetronomeMark(number=bpm))
        events = []
        for i, item in enumerate(hand):
            start = round(item["start"] * scale)
            end_time = item["end"]
            following = hand[i + 1] if i + 1 < len(hand) else None
            if following and following["start"] - item["start"] > .08 and 0 < end_time - following["start"] <= .14:
                end_time = following["start"]
            stop = max(start + 1, round(end_time * scale))
            if beats == 3 and following:
                following_tick = round(following["start"] * scale)
                close_to_next = stop + 1 == following_tick
                repeated = item["pitch"] == following["pitch"] and following_tick - start == subdivisions
                sustained_bass = (index == 1 and start % (beats * subdivisions) == 0
                                  and following_tick - start == beats * subdivisions
                                  and following["start"] - end_time <= .15)
                if close_to_next and (repeated or sustained_bass):
                    stop = following_tick
            events.append((start, stop, item["pitch"]))
        for (start, stop), values in groupby(sorted(events), key=lambda value: value[:2]):
            pitches = [pitch.Pitch(midi=midi) for midi in dict.fromkeys(midi for _, _, midi in values)]
            for value in pitches:
                if value.accidental and value.accidental.name == "natural":
                    value.accidental = None
            element = note.Note(pitches[0]) if len(pitches) == 1 else chord.Chord(pitches)
            element.quarterLength = (stop - start) / subdivisions
            staff.insert(start / subdivisions, element)
        extent = max(beats, ceil(end / beats) * beats)
        staff.makeMeasures(refStreamOrTimeRange=[0, extent - .01], inPlace=True)
        staff.makeTies(inPlace=True)
        for measure in staff.getElementsByClass(stream.Measure):
            if measure.getOverlaps():
                measure.makeVoices(inPlace=True, fillGaps=True)
            measure.makeRests(fillGaps=True, timeRangeFromBarDuration=True, inPlace=True)
        score.append(staff)
        staves.append(staff)
    score.insert(0, layout.StaffGroup(staves, name="Piano", symbol="brace", barTogether=True))
    score.write("musicxml", fp=destination)

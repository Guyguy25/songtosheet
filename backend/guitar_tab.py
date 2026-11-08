"""Choose polyphonic guitar fingerings and engrave them on a fixed beat grid."""
from collections import defaultdict
from dataclasses import dataclass
from itertools import groupby
from xml.etree import ElementTree as ET


NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
DIVISIONS = 4
BAR = 4 * DIVISIONS
TYPES = {16: "whole", 8: "half", 4: "quarter", 2: "eighth", 1: "16th"}
BEAM_SIZE = 64


@dataclass
class TabNote:
    pitch: int
    start: float
    end: float
    velocity: int
    string: int
    fret: int


def choose_fingering(group, tuning, held, position):
    # A small beam keeps dense detector output tractable. Keep as many attacks as
    # possible, then favor an economical hand position and notes that can ring.
    candidates = [([], frozenset(), 0)]
    seen_pitches = set()
    ringing = {note.pitch: string for string, note in held.items()}
    for note in sorted(group, key=lambda item: (-item["velocity"], item["pitch"])):
        if note["pitch"] in seen_pitches:
            continue
        seen_pitches.add(note["pitch"])
        next_candidates = list(candidates)
        for picked, strings, cost in candidates:
            for string, open_pitch in enumerate(tuning, 1):
                fret = note["pitch"] - open_pitch
                if string in strings or not 0 <= fret <= 24:
                    continue
                if ringing.get(note["pitch"], string) != string:
                    continue
                remaining = strings | {string}
                prior = held.get(string)
                if prior and prior.start >= note["start"]:
                    continue
                frets = {f for _, _, f in picked if f}
                frets.update(active.fret for key, active in held.items()
                             if key not in remaining and active.fret)
                if fret:
                    frets.add(fret)
                if len(frets) > 4 or (frets and max(frets) - min(frets) > 4):
                    continue
                movement = abs(fret - position) if fret else 0
                penalty = movement + fret * .12 + (6 if prior else 0)
                next_candidates.append((picked + [(note, string, fret)], remaining, cost + penalty))
        candidates = sorted(next_candidates, key=lambda item: (-len(item[0]), item[2]))[:BEAM_SIZE]
    return candidates[0][0]


def arrange(notes, tuning):
    ordered = sorted(notes, key=lambda note: note["start"])
    group_start = 0
    groups = []
    for note in ordered:
        if not groups or note["start"] - group_start > .03:
            group_start = note["start"]
            groups.append([])
        groups[-1].append(note)
    held, result, position = {}, [], 2
    for group in groups:
        start = group[0]["start"]
        held = {key: note for key, note in held.items() if note.end > start}
        picked = choose_fingering(group, tuning, held, position)
        frets = [fret for _, _, fret in picked if fret]
        if frets:
            position = min(frets)
        for source, string, fret in picked:
            if previous := held.get(string):
                previous.end = min(previous.end, source["start"])
            note = TabNote(**source, string=string, fret=fret)
            held[string] = note
            result.append(note)
    return result


def midi_notes(notes):
    return [{"pitch": n.pitch, "start": n.start, "end": n.end, "velocity": n.velocity}
            for n in notes if n.start < n.end]


def notated_notes(notes, bpm):
    grid = bpm * DIVISIONS / 60
    result = []
    for _, string_notes in groupby(sorted(notes, key=lambda n: (n.string, n.start)), key=lambda n: n.string):
        track = []
        for note in string_notes:
            start = round(note.start * grid)
            end = max(start + 1, round(note.end * grid))
            if track and start <= track[-1][0]:
                start = track[-1][0] + 1
                end = max(start + 1, end)
            if track and track[-1][1] > start:
                track[-1] = (track[-1][0], start, track[-1][2])
            track.append((start, end, note))
        result.extend(track)
    return result


def add(parent, tag, text, **attributes):
    ET.SubElement(parent, tag, **attributes).text = str(text)


def write_header(measure, tuning, bpm):
    attributes = ET.SubElement(measure, "attributes")
    add(attributes, "divisions", DIVISIONS)
    meter = ET.SubElement(attributes, "time")
    add(meter, "beats", 4)
    add(meter, "beat-type", 4)
    clef = ET.SubElement(attributes, "clef")
    add(clef, "sign", "TAB")
    add(clef, "line", len(tuning) // 2)
    staff = ET.SubElement(attributes, "staff-details")
    add(staff, "staff-lines", len(tuning))
    for line, pitch in enumerate(reversed(tuning), 1):
        name = NOTE_NAMES[pitch % 12]
        row = ET.SubElement(staff, "staff-tuning", line=str(line))
        add(row, "tuning-step", name[0])
        if name.endswith("#"):
            add(row, "tuning-alter", 1)
        add(row, "tuning-octave", pitch // 12 - 1)
    direction = ET.SubElement(measure, "direction", placement="above")
    metronome = ET.SubElement(ET.SubElement(direction, "direction-type"), "metronome")
    add(metronome, "beat-unit", "quarter")
    add(metronome, "per-minute", bpm)
    ET.SubElement(direction, "sound", tempo=str(bpm))


def write_segment(measure, start, length, playing):
    if not playing:
        note = ET.SubElement(measure, "note")
        ET.SubElement(note, "rest")
        add(note, "duration", length)
        add(note, "type", TYPES[length])
        return
    for index, (onset, end, event) in enumerate(playing):
        note = ET.SubElement(measure, "note")
        if index:
            ET.SubElement(note, "chord")
        pitch = ET.SubElement(note, "pitch")
        name = NOTE_NAMES[event.pitch % 12]
        add(pitch, "step", name[0])
        if name.endswith("#"):
            add(pitch, "alter", 1)
        add(pitch, "octave", event.pitch // 12 - 1)
        add(note, "duration", length)
        ties = [kind for kind, active in (("stop", onset < start), ("start", end > start + length)) if active]
        for kind in ties:
            ET.SubElement(note, "tie", type=kind)
        add(note, "type", TYPES[length])
        notation = ET.SubElement(note, "notations")
        for kind in ties:
            ET.SubElement(notation, "tied", type=kind)
        technical = ET.SubElement(notation, "technical")
        add(technical, "string", event.string)
        add(technical, "fret", event.fret)


def write_tab(notes, destination, tuning, bpm, title, instrument):
    root = ET.Element("score-partwise", version="4.0")
    add(root, "movement-title", title)
    part_list = ET.SubElement(root, "part-list")
    add(ET.SubElement(part_list, "score-part", id="P1"), "part-name", instrument.capitalize())
    part = ET.SubElement(root, "part", id="P1")
    starts, stops = defaultdict(list), defaultdict(list)
    for start, end, event in notated_notes(notes, bpm):
        starts[start].append((start, end, event))
        stops[end].append(event.string)
    end = ((max(stops) + BAR - 1) // BAR) * BAR
    boundaries = sorted(set(starts) | set(stops) | set(range(0, end + 1, BAR)))
    active = {}
    for start, following in zip(boundaries, boundaries[1:]):
        if start % BAR == 0:
            measure = ET.SubElement(part, "measure", number=str(start // BAR + 1))
            if not start:
                write_header(measure, tuning, bpm)
        for string in stops[start]:
            active.pop(string, None)
        for note in starts[start]:
            active[note[2].string] = note
        playing = sorted(active.values(), key=lambda note: note[2].pitch)
        while start < following:
            length = next(length for length in TYPES if length <= following - start)
            write_segment(measure, start, length, playing)
            start += length
    ET.ElementTree(root).write(destination, encoding="utf-8", xml_declaration=True)

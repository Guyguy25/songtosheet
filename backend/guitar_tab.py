"""Choose polyphonic guitar fingerings and engrave them on a fixed beat grid."""
from dataclasses import dataclass
from bisect import bisect_left
from itertools import groupby
from xml.etree import ElementTree as ET


NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
DIVISIONS = 8
BAR = 4 * DIVISIONS
TYPES = {
    32: ("whole", False), 24: ("half", True), 16: ("half", False),
    12: ("quarter", True), 8: ("quarter", False), 6: ("eighth", True),
    4: ("eighth", False), 3: ("16th", True), 2: ("16th", False), 1: ("32nd", False),
}
BEAM_SIZE = 64


@dataclass
class TabNote:
    pitch: int
    start: float
    end: float
    velocity: int
    string: int
    fret: int
    attack: float


def choose_fingering(group, tuning, held, position, max_fret):
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
                if string in strings or not 0 <= fret <= max_fret:
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


def attack_groups(notes, onset):
    ordered = sorted(notes, key=onset)
    group_start = 0
    groups = []
    for note in ordered:
        if not groups or onset(note) - group_start > .03:
            group_start = onset(note)
            groups.append([])
        groups[-1].append(note)
    return groups


def arrange(notes, tuning, *, capo=0):
    tuning = tuple(pitch + capo for pitch in tuning)
    held, result, position = {}, [], 2
    for group in attack_groups(notes, lambda note: note["start"]):
        start = group[0]["start"]
        held = {key: note for key, note in held.items() if note.end > start}
        picked = choose_fingering(group, tuning, held, position, 24 - capo)
        frets = [fret for _, _, fret in picked if fret]
        if frets:
            position = min(frets)
        for source, string, fret in picked:
            if previous := held.get(string):
                previous.end = min(previous.end, source["start"])
            note = TabNote(**source, string=string, fret=fret, attack=start)
            held[string] = note
            result.append(note)
    return result


def arrange_with_capo(notes, tuning):
    def options():
        for capo in range(1, 13):
            yield capo, arrange(notes, tuning, capo=capo)

    def rank(option):
        capo, tab = option
        return len(tab), -sum(note.fret for note in tab), -capo

    return max(options(), key=rank)


def midi_notes(notes):
    return [{"pitch": n.pitch, "start": n.start, "end": n.end, "velocity": n.velocity}
            for n in notes if n.start < n.end]


def closest_attack(group, transients):
    if not transients:
        return None
    start, end = group[0].start, group[-1].start
    middle = (start + end) / 2
    index = bisect_left(transients, middle)
    anchor = min(transients[max(0, index - 1):index + 1], key=lambda time: abs(time - middle))
    return anchor if max(abs(start - anchor), abs(end - anchor)) <= .095 else None


def group_for_notation(notes, transients):
    result = []
    ordered = sorted(notes, key=lambda note: (note.attack, note.start))
    for _, attacks in groupby(ordered, key=lambda note: note.attack):
        group = list(attacks)
        anchor = closest_attack(group, transients)
        if result and anchor is not None and result[-1][0] == anchor:
            previous = result[-1][1]
            combined = previous + group
            strings = {note.string for note in combined}
            frets = [note.fret for note in combined if note.fret]
            if (group[-1].start - previous[0].start <= .12 and len(strings) == len(combined)
                    and (not frets or max(frets) - min(frets) <= 4)):
                result[-1] = (anchor, combined, True)
                continue
        result.append((anchor, group, False))
    return result


def notated_attacks(notes, bpm, transients):
    grid = bpm * DIVISIONS / 60
    result = []
    previous = -1
    for anchor, group, merged in group_for_notation(notes, transients):
        # Preserve separate attacks that happen to round to the same grid slot.
        start = max(previous + 1, round((anchor if merged else group[0].start) * grid))
        ends = [(max(start + 1, round(note.end * grid)), note) for note in group]
        result.append((start, ends))
        previous = start
    return result


def add(parent, tag, text, **attributes):
    ET.SubElement(parent, tag, **attributes).text = str(text)


def write_header(measure, tuning, bpm, capo):
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
    if capo:
        add(staff, "capo", capo)
        instruction = ET.SubElement(measure, "direction", placement="above")
        add(ET.SubElement(instruction, "direction-type"), "words", f"Capo · case {capo}")
    direction = ET.SubElement(measure, "direction", placement="above")
    metronome = ET.SubElement(ET.SubElement(direction, "direction-type"), "metronome")
    add(metronome, "beat-unit", "quarter")
    add(metronome, "per-minute", bpm)
    ET.SubElement(direction, "sound", tempo=str(bpm))


def write_duration(note, length):
    kind, dotted = TYPES[length]
    add(note, "duration", length)
    add(note, "type", kind)
    if dotted:
        ET.SubElement(note, "dot")


def write_rest(measure, length, ringing):
    attributes = {"print-object": "no", "print-spacing": "yes"} if ringing else {}
    note = ET.SubElement(measure, "note", **attributes)
    ET.SubElement(note, "rest")
    write_duration(note, length)


def write_attack(measure, start, length, events):
    for index, (end, event) in enumerate(sorted(events, key=lambda item: item[1].pitch)):
        note = ET.SubElement(measure, "note")
        if index:
            ET.SubElement(note, "chord")
        pitch = ET.SubElement(note, "pitch")
        name = NOTE_NAMES[event.pitch % 12]
        add(pitch, "step", name[0])
        if name.endswith("#"):
            add(pitch, "alter", 1)
        add(pitch, "octave", event.pitch // 12 - 1)
        write_duration(note, length)
        notation = ET.SubElement(note, "notations")
        if end > start + length:
            ET.SubElement(notation, "tied", type="let-ring")
        technical = ET.SubElement(notation, "technical")
        add(technical, "string", event.string)
        add(technical, "fret", event.fret)


def write_tab(notes, destination, tuning, bpm, title, instrument, *, transients=(), capo=0):
    root = ET.Element("score-partwise", version="4.0")
    add(root, "movement-title", title)
    part_list = ET.SubElement(root, "part-list")
    add(ET.SubElement(part_list, "score-part", id="P1"), "part-name", instrument.capitalize())
    part = ET.SubElement(root, "part", id="P1")
    attacks = notated_attacks(notes, bpm, transients)
    end = max(stop for _, group in attacks for stop, _ in group)
    bars = (end + BAR - 1) // BAR
    index, ringing_until = 0, 0
    for bar in range(bars):
        start, bar_end = bar * BAR, (bar + 1) * BAR
        measure = ET.SubElement(part, "measure", number=str(bar + 1))
        if not bar:
            write_header(measure, tuning, bpm, capo)
        while start < bar_end:
            if index < len(attacks) and attacks[index][0] == start:
                events = attacks[index][1]
                index += 1
                group_end = max(stop for stop, _ in events)
                ringing_until = max(ringing_until, group_end)
                next_attack = attacks[index][0] if index < len(attacks) else bar_end
                limit = min(group_end, next_attack, bar_end)
                length = next(size for size in TYPES if size <= limit - start)
                write_attack(measure, start, length, events)
            else:
                next_attack = attacks[index][0] if index < len(attacks) else bar_end
                ringing = start < ringing_until
                limit = min(next_attack, bar_end, ringing_until if ringing else bar_end)
                length = next(size for size in TYPES if size <= limit - start)
                write_rest(measure, length, ringing)
            start += length
    ET.ElementTree(root).write(destination, encoding="utf-8", xml_declaration=True)

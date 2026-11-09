"""Choose polyphonic guitar fingerings and engrave them on a fixed beat grid."""
from dataclasses import dataclass
from bisect import bisect_left
from collections import deque
from itertools import groupby
from xml.etree import ElementTree as ET


NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
DIVISIONS = 8
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


def choose_fingering(group, tuning, held, position, max_fret, string_hints, shape=None):
    # A small beam keeps dense detector output tractable. Keep as many attacks as
    # possible, then favor an economical hand position and notes that can ring.
    candidates = [([], frozenset(), 0)]
    seen_pitches = set()
    ringing = {note.pitch: string for string, note in held.items()}
    for note in sorted(group, key=lambda item: (-item["velocity"], item["pitch"])):
        if note["pitch"] in seen_pitches:
            continue
        seen_pitches.add(note["pitch"])
        preferred = string_hints.get((note["start"], note["pitch"]))
        previous_string = shape.get(note["pitch"]) if shape else None
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
                if preferred is not None and string != preferred:
                    penalty += 15
                if previous_string is not None and string != previous_string:
                    penalty += 19
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


def open_position_melody(notes, tuning):
    """Look for one compact position before assigning notes one by one."""
    if any(left["end"] - right["start"] > .08 or right["start"] - left["start"] <= .03
           for left, right in zip(notes, notes[1:])):
        return []
    pitches = {note["pitch"] for note in notes}
    for width in range(1, len(tuning) + 1):
        positions = []
        for first in range(len(tuning) - width + 1):
            strings = range(first, first + width)
            fingering = {}
            for pitch in pitches:
                options = [(pitch - tuning[i], i + 1) for i in strings if 0 <= pitch - tuning[i] <= 4]
                if not options:
                    break
                fingering[pitch] = min(options)
            else:
                positions.append(fingering)
        if positions:
            best = min(positions, key=lambda pos: sum(pos[note["pitch"]][0] for note in notes))
            return [TabNote(**{**note, "end": min(note["end"], notes[i+1]["start"]) if i+1 < len(notes) else note["end"]},
                            string=best[note["pitch"]][1], fret=best[note["pitch"]][0], attack=note["start"])
                    for i, note in enumerate(notes)]
    return []


def arrange(notes, tuning, *, capo=0, simple=False, string_hints=None, strokes=None):
    tuning = tuple(pitch + capo for pitch in tuning)
    string_hints = string_hints or {}
    if simple and notes and (compact := open_position_melody(notes, tuning)):
        return compact
    held, result, position = {}, [], 2
    shape, shape_at = {}, 0.
    groups = deque(strokes if strokes is not None else attack_groups(notes, lambda note: note["start"]))
    while groups:
        group = groups.popleft()
        start = group[0]["start"]
        if start - shape_at > .95:
            shape = {}
        held = {key: note for key, note in held.items() if note.end > start}
        picked = choose_fingering(group, tuning, held, position, 24 - capo, string_hints, shape)
        strum = strokes is not None and group[-1]["start"] - start > .03
        if strum and len(picked) < len(group):
            # A new strum may release the old shape. If it still cannot be
            # played with all its pitches, keep the original separate attacks.
            open_strings = {key: note for key, note in held.items() if not note.fret}
            replacement = choose_fingering(group, tuning, open_strings, position, 24 - capo, string_hints, shape)
            if len(replacement) < len(group):
                groups.extendleft(reversed(attack_groups(group, lambda note: note["start"])))
                continue
            for key, note in held.items():
                if key not in open_strings:
                    note.end = start
            held, picked = open_strings, replacement
        frets = [fret for _, _, fret in picked if fret]
        new_shape = False
        if strokes is not None and len(picked) >= 2:
            current = {source["pitch"]: string for source, string, _ in picked}
            new_shape = len(current) >= 3 and all(
                max(open_pitch for open_pitch in tuning if open_pitch <= source["pitch"]) - tuning[string-1] <= 5
                for source, string, _ in picked
            )
            if new_shape:
                shape, shape_at = current, start
            elif current.items() <= shape.items():
                shape_at = start
        if frets and (not shape or new_shape):
            position = min(frets)
        for source, string, fret in picked:
            if strum:
                source = {**source, "start": start}
            if previous := held.get(string):
                previous.end = min(previous.end, source["start"])
            note = TabNote(**source, string=string, fret=fret, attack=start)
            held[string] = note
            result.append(note)
    return result


def arrange_with_capo(notes, tuning, *, simple=False, strokes=None):
    def options():
        for capo in range(1, 13):
            yield capo, arrange(notes, tuning, capo=capo, simple=simple, strokes=strokes)

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


def notated_attacks(notes, bpm, transients, intro_count=0):
    grid = bpm * DIVISIONS / 60
    step = DIVISIONS // 2
    result = []
    previous = -1
    offset = 0
    for index, (anchor, group, merged) in enumerate(group_for_notation(notes, transients)):
        # Preserve separate attacks that happen to round to the same grid slot.
        if index < intro_count:
            start = index * step
        else:
            measured = round((anchor if merged else group[0].start) * grid)
            if intro_count and index == intro_count and abs(index * step - measured) <= step:
                offset = index * step - measured
            start = max(previous + 1, measured + offset)
        minimum = step if index < intro_count else 1
        ends = [(max(start + minimum, round(note.end * grid) + offset), note) for note in group]
        result.append((start, ends))
        previous = start
    return result


def add(parent, tag, value, **attributes):
    ET.SubElement(parent, tag, **attributes).text = str(value)


def write_header(measure, tuning, bpm, capo, signature):
    attributes = ET.SubElement(measure, "attributes")
    add(attributes, "divisions", DIVISIONS)
    meter = ET.SubElement(attributes, "time")
    add(meter, "beats", signature[0])
    add(meter, "beat-type", signature[1])
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


def write_attack(measure, start, length, events, techniques, beam, strummed):
    labels = {kind for _, event in events
              for kind, role in [techniques.get((event.start, event.pitch), (None, None))]
              if role == "start"}
    words = (["Gratté"] if strummed else []) + [
        "P" if kind == "pull-off" else "sl." for kind in sorted(labels)
    ]
    if words:
        direction = ET.SubElement(measure, "direction", placement="below" if strummed else "above")
        add(ET.SubElement(direction, "direction-type"), "words", " · ".join(words))
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
        if beam and index == 0:
            add(note, "beam", beam, number="1")
        notation = ET.SubElement(note, "notations")
        if end > start + length:
            ET.SubElement(notation, "tied", type="let-ring")
        kind, role = techniques.get((event.start, event.pitch), (None, None))
        if kind == "pull-off":
            ET.SubElement(notation, "slur", type=role, number="1")
        elif kind == "slide":
            ET.SubElement(notation, "slide", type=role, number=str(event.string))
        technical = ET.SubElement(notation, "technical")
        add(technical, "string", event.string)
        add(technical, "fret", event.fret)
        if kind == "pull-off":
            add(technical, "pull-off", "", type=role, number="1")


def write_harmony(measure, root, quality):
    name = NOTE_NAMES[root]
    harmony = ET.SubElement(measure, "harmony", placement="above")
    root_element = ET.SubElement(harmony, "root")
    add(root_element, "root-step", name[0])
    if name.endswith("#"):
        add(root_element, "root-alter", 1)
    suffix = {"major": "", "minor": "m", "major-seventh": "maj7", "dominant": "7", "minor-seventh": "m7",
              "suspended-second": "sus2", "suspended-fourth": "sus4", "power": "5"}
    add(harmony, "kind", quality, text=suffix[quality])


def write_tab(notes, destination, tuning, bpm, title, instrument, *, transients=(), capo=0, chords=(),
              meter=(4, 4), intro_count=0, pull_offs=(), slides=(), strummed=()):
    root = ET.Element("score-partwise", version="4.0")
    add(root, "movement-title", title)
    part_list = ET.SubElement(root, "part-list")
    add(ET.SubElement(part_list, "score-part", id="P1"), "part-name", instrument.capitalize())
    part = ET.SubElement(root, "part", id="P1")
    attacks = notated_attacks(notes, bpm, transients, intro_count)
    played = {(note.start, note.pitch): note for note in notes}
    techniques = {}
    for kind, pairs in (("pull-off", pull_offs), ("slide", slides)):
        for first, second in pairs:
            before, after = played.get(first), played.get(second)
            if (before and after and before.string == after.string
                    and (before.fret > 0 and after.fret == 0 if kind == "pull-off"
                         else before.fret > 0 and after.fret > 0 and before.fret != after.fret)
                    and first not in techniques and second not in techniques):
                techniques.update({first: (kind, "start"), second: (kind, "stop")})
    ticks = [start for start, _ in attacks]
    grid = bpm * DIVISIONS / 60
    harmony = {}
    for time, root_pitch, quality in chords:
        target = round(time * grid)
        index = bisect_left(ticks, target)
        closest = min(ticks[max(0, index - 1):index + 1], key=lambda tick: abs(tick - target))
        if abs(closest - target) <= round(.15 * grid):
            harmony[closest] = (root_pitch - capo) % 12, quality
    end = max(stop for _, group in attacks for stop, _ in group)
    bar_ticks = meter[0] * DIVISIONS * 4 // meter[1]
    bars = (end + bar_ticks - 1) // bar_ticks
    index, ringing_until = 0, 0
    for bar in range(bars):
        start, bar_end = bar * bar_ticks, (bar + 1) * bar_ticks
        measure = ET.SubElement(part, "measure", number=str(bar + 1))
        if not bar:
            write_header(measure, tuning, bpm, capo, meter)
        while start < bar_end:
            if index < len(attacks) and attacks[index][0] == start:
                if start in harmony:
                    write_harmony(measure, *harmony[start])
                events = attacks[index][1]
                beam = ("begin", "continue", "end")[index % 3] if index + 3 - index % 3 <= intro_count else None
                index += 1
                group_end = max(stop for stop, _ in events)
                ringing_until = max(ringing_until, group_end)
                next_attack = attacks[index][0] if index < len(attacks) else bar_end
                limit = min(group_end, next_attack, bar_end)
                length = next(size for size in TYPES if size <= limit - start)
                is_strum = len(events) > 1 and events[0][1].start in strummed
                write_attack(measure, start, length, events, techniques, beam, is_strum)
            else:
                next_attack = attacks[index][0] if index < len(attacks) else bar_end
                ringing = start < ringing_until
                limit = min(next_attack, bar_end, ringing_until if ringing else bar_end)
                length = next(size for size in TYPES if size <= limit - start)
                write_rest(measure, length, ringing)
            start += length
    ET.ElementTree(root).write(destination, encoding="utf-8", xml_declaration=True)

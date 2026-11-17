"""Turn a transcription into a two-hand piano arrangement a pianist can read and play.

Right hand: the sung (or lead) melody, folded into a comfortable register, with a
supporting chord tone under long notes on strong beats.  Left hand: the song's chords
(detected bar by bar) as a pattern chosen from the tempo and meter.  Everything is
placed on the song's real beat grid, so rhythms are written as a musician would.
"""
from math import floor

import numpy as np

from guitar_accompaniment import decode_chords

STEP = .25  # quantization unit for the melody, in beats (16th note)
RH_LOW, RH_HIGH = 60, 84
LH_ROOT_LOW = 36  # C2


def _tones(root, quality):
    third = 4 if quality == "major" else 3
    return [root, (root + third) % 12, (root + 7) % 12]


def monophonic(notes):
    """Keep one line: at each attack the most salient note, continuous with the last one."""
    groups = []
    for note in sorted(notes, key=lambda item: (item["start"], -item["pitch"])):
        if groups and note["start"] - groups[-1][0]["start"] <= .04:
            groups[-1].append(note)
        else:
            groups.append([note])
    line, previous = [], None
    for group in groups:
        best = max(group, key=lambda tone: (
            min(.5, tone["end"] - tone["start"]) * 40 + tone["velocity"] * .2 + tone["pitch"] * .1
            - (abs(tone["pitch"] - previous) * .6 if previous is not None else 0)))
        if line and line[-1]["end"] > best["start"]:
            line[-1] = {**line[-1], "end": best["start"]}
        line.append(dict(best))
        previous = best["pitch"]
    return [note for note in line if note["end"] - note["start"] >= .05]


def lead_line(notes):
    """Fallback melody when no voice track exists: the top line of mid/high notes."""
    upper = [note for note in notes if note["pitch"] >= 58 and note["end"] - note["start"] >= .12]
    return monophonic(upper)


def _register_shift(pitches):
    middle = float(np.median(pitches))
    return 12 * round((72 - middle) / 12)


def fold(pitch, low, high):
    while pitch < low:
        pitch += 12
    while pitch > high:
        pitch -= 12
    return pitch


def place_melody(melody, grid):
    """Quantize the melody on the grid (positions in beats from audio time 0)."""
    start0, _ = grid.layout()
    if not melody:
        return []
    shift = _register_shift([note["pitch"] for note in melody])
    placed = []
    for note in sorted(melody, key=lambda item: item["start"]):
        pos = round(float(grid.position(note["start"])) / STEP) * STEP - start0
        end = round(float(grid.position(note["end"])) / STEP) * STEP - start0
        if pos < 0:
            continue
        end = max(end, pos + STEP)
        pitch = fold(note["pitch"] + shift, RH_LOW, RH_HIGH)
        if placed and placed[-1]["pos"] == pos:
            continue  # one melody note per 16th
        if placed:
            last = placed[-1]
            # Merge a sung note split in two (same pitch, no real gap).
            if last["pitch"] == pitch and pos - (last["pos"] + last["length"]) <= STEP / 2 and last["length"] < 1:
                last["length"] = max(last["length"], end - last["pos"])
                continue
            last["length"] = min(last["length"], pos - last["pos"])
        placed.append({"pitch": pitch, "pos": pos, "length": end - pos, "hand": "right",
                       "velocity": int(min(96, max(64, note.get("velocity", 80))))})
    return [note for note in placed if note["length"] > 0]


def chord_grid(notes, melody, grid, block, blocks):
    """One major/minor chord (or None) per block of `block` beats."""
    start0, _ = grid.layout()
    treble = np.zeros((blocks, 12))
    bass = np.zeros((blocks, 12))
    for weight, source in ((1.0, notes), (.35, melody)):
        for note in source:
            first = float(grid.position(note["start"])) - start0 - grid.bar_offset
            last = float(grid.position(note["end"])) - start0 - grid.bar_offset
            for index in range(max(0, floor(first / block)), min(blocks, floor(last / block) + 1)):
                overlap = min(last, (index + 1) * block) - max(first, index * block)
                if overlap <= 0:
                    continue
                value = weight * overlap * note.get("velocity", 80) / 127
                treble[index, note["pitch"] % 12] += value
                if weight == 1.0 and note["pitch"] < 55:
                    bass[index, note["pitch"] % 12] += value
    audible = treble.sum(axis=1) > 0
    if not audible.any():
        return [None] * blocks
    return decode_chords(treble, bass, audible)


def _close_triad(root, quality, low=48, high=60):
    tones = _tones(root, quality)
    best = None
    for bottom in range(low, high):
        if bottom % 12 not in tones:
            continue
        chord = [bottom]
        for _ in range(2):
            pitch = chord[-1] + 1
            while pitch % 12 not in tones or pitch % 12 in [p % 12 for p in chord]:
                pitch += 1
            chord.append(pitch)
        if chord[-1] <= high + 4 and (best is None or abs(np.mean(chord) - 55) < abs(np.mean(best) - 55)):
            best = chord
    return best


def accompaniment_style(harmony, melody, grid):
    """How the original accompaniment moves: 'held', 'beats' or 'arpeggio'."""
    start0, _ = grid.layout()
    sung = {(note["pitch"], round(note["start"], 2)) for note in melody}
    positions = sorted({round(float(grid.position(note["start"])) * 4) / 4 for note in harmony
                        if note["pitch"] < 72 and (note["pitch"], round(note["start"], 2)) not in sung})
    span = float(grid.position(max((note["end"] for note in harmony), default=0))) - start0
    if span <= 2 or not positions:
        return "beats"
    per_beat = len(positions) / span
    offbeat = sum(abs(pos % 1 - .5) < .01 for pos in positions) / len(positions)
    if per_beat < .55:
        return "held"
    if per_beat >= 1.4 and offbeat >= .28:
        return "arpeggio"
    return "beats"


def left_hand(chords, grid, block, level, style="beats"):
    """Left-hand events from the chord list. level: 'easy' or 'full'."""
    bpm, per_bar = grid.bpm, grid.per_bar
    events = []
    previous = None
    for index, chord in enumerate(chords):
        base = index * block + grid.bar_offset
        if chord is None:
            previous = None
            continue
        root, quality = chord
        low = LH_ROOT_LOW + (root - LH_ROOT_LOW) % 12  # 36..47
        if level == "easy":
            # One bass note per chord change (tied through repeats), whole block long.
            if chord == previous and events:
                events[-1]["length"] += block
            else:
                events.append({"pitch": low, "pos": base, "length": block, "velocity": 70, "hand": "left"})
            previous = chord
            continue
        triad = _close_triad(root, quality)
        if style == "held":
            # Sustained harmony: root and fifth held, chord on the first beat.
            events.append({"pitch": low, "pos": base, "length": block, "velocity": 70})
            events.extend({"pitch": p, "pos": base, "length": block, "velocity": 56} for p in triad)
        elif per_bar == 3:
            events.append({"pitch": low, "pos": base, "length": 1, "velocity": 74})
            for beat in (1, 2):
                events.extend({"pitch": p, "pos": base + beat, "length": 1, "velocity": 58} for p in triad)
        elif style == "arpeggio" or (style is None and bpm < 100):
            # Broken chord in eighths: root, fifth, octave, fifth.
            for step, pitch in enumerate((low, low + 7, low + 12, low + 7) * (block // 2)):
                events.append({"pitch": pitch, "pos": base + step * .5, "length": .5,
                               "velocity": 72 if step % 4 == 0 else 60})
        else:
            # Root on the beat, chord on the off-beat (pop "oom-pah").
            for half in range(block // 2):
                events.append({"pitch": low, "pos": base + half * 2, "length": 1, "velocity": 74})
                events.extend({"pitch": p, "pos": base + half * 2 + 1, "length": 1, "velocity": 58} for p in triad)
        previous = chord
    for event in events:
        event["hand"] = "left"
    return events


def harmonize(melody, chords, grid, block):
    """Add one chord tone a third to a sixth under long melody notes on strong beats."""
    extra = []
    strong = {0, 2} if grid.per_bar == 4 else {0}
    for note in melody:
        bar_pos = note["pos"] - grid.bar_offset
        if note["length"] < 1 or bar_pos < 0 or (bar_pos % grid.per_bar) not in strong:
            continue
        index = int(bar_pos // block)
        chord = chords[index] if 0 <= index < len(chords) else None
        if chord is None or note["pitch"] < 64:
            continue
        tones = _tones(*chord)
        for interval in (3, 4, 5, 8, 9):
            pitch = note["pitch"] - interval
            if pitch % 12 in tones:
                extra.append({"pitch": pitch, "pos": note["pos"], "length": note["length"],
                              "velocity": max(50, note["velocity"] - 18), "hand": "right"})
                break
    return extra


def arrange(melody, harmony, grid, duration, level="full"):
    """Build the arrangement. melody/harmony: note dicts in seconds.
    Returns quantized note dicts with pos/length (beats) and start/end (seconds)."""
    start0, pickup = grid.layout()
    total = float(grid.position(duration)) - start0
    block = grid.per_bar if grid.per_bar == 3 or level == "easy" and grid.bpm >= 120 else 2
    blocks = max(1, int(np.ceil(max(0.0, total - pickup) / block)))
    if not melody:
        melody = lead_line(harmony)
    right = place_melody(melody, grid)
    chords = chord_grid(harmony, melody, grid, block, blocks)
    style = accompaniment_style(harmony, melody, grid)
    left = left_hand(chords, grid, block, level, style)
    if level == "full":
        right += harmonize(right, chords, grid, block)
    notes = []
    for note in right + left:
        if note["pos"] < 0 or note["pos"] >= total:
            continue
        length = min(note["length"], total - note["pos"])
        if length <= 0:
            continue
        absolute = note["pos"] + start0
        notes.append({**note, "length": length, "start": float(grid.time(absolute)),
                      "end": float(grid.time(absolute + length))})
    return sorted(notes, key=lambda item: (item["pos"], item["pitch"])), chords


def chord_names(chords):
    names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    return [None if chord is None else names[chord[0]] + ("m" if chord[1] == "minor" else "") for chord in chords]


"""Estimate a chord grid from a mix and render two playable accompaniments."""

from itertools import combinations, groupby, product
from math import ceil
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory
from xml.etree import ElementTree as ET

import numpy as np

from guitar_tab import (
    DIVISIONS, TYPES, TabNote, add, midi_notes, write_attack, write_harmony,
    write_header, write_rest,
)


TUNING = (64, 59, 55, 50, 45, 40)
ENGINE = "yourmt3-guitar-chords-v1"
CHORDS = [(root, quality) for root in range(12) for quality in ("major", "minor")]
PROFILES = np.zeros((len(CHORDS), 12))
for index, (root, quality) in enumerate(CHORDS):
    PROFILES[index, [root, (root + (4 if quality == "major" else 3)) % 12, (root + 7) % 12]] = 1
ROOTS = [root for root, _ in CHORDS]


def estimate_tempo(signal, rate, hop):
    import librosa

    detected, _ = librosa.beat.beat_track(y=signal, sr=rate, hop_length=hop)
    bpm = float(np.asarray(detected).ravel()[0])
    return round(bpm / 2 if bpm > 170 else bpm) if bpm >= 50 else 100


def pitch_profiles(audio, *, bpm=None):
    import librosa

    rate, hop = 22050, 512
    signal, _ = librosa.load(audio, sr=rate, mono=True)
    harmonic = librosa.effects.harmonic(signal)
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=rate, hop_length=hop)
    bass = librosa.feature.chroma_cqt(y=harmonic, sr=rate, hop_length=hop, n_octaves=2)
    rms = librosa.feature.rms(y=harmonic, hop_length=hop)[0]
    if bpm is None:
        bpm = estimate_tempo(signal, rate, hop)
    return chroma, bass, rms, hop / rate, len(signal) / rate, bpm


def audio_chords(profiles, blocks, *, start=0):
    chroma, bass, rms, step, _, bpm = profiles
    treble, low, audible = [], [], []
    threshold = max(.001, float(np.max(rms)) * .04)
    for index in range(blocks):
        left = round((start + index * 120 / bpm) / step)
        right = round((start + (index + 1) * 120 / bpm) / step)
        treble.append(chroma[:, left:right].sum(axis=1))
        low.append(bass[:, left:right].sum(axis=1))
        audible.append(bool(np.any(rms[left:right] > threshold)))
    return decode_chords(treble, low, audible)


def midi_chords(midi, bpm, blocks):
    treble = np.zeros((blocks, 12))
    bass = np.zeros_like(treble)
    step = 120 / bpm
    for track in midi.instruments:
        if track.is_drum:
            continue
        for note in track.notes:
            is_bass = 32 <= track.program <= 39 or note.pitch < 49
            for index in range(int(note.start / step), min(blocks, ceil(note.end / step))):
                weight = max(0, min(note.end, (index + 1) * step) - max(note.start, index * step))
                weight *= note.velocity / 127
                treble[index, note.pitch % 12] += weight
                if is_bass:
                    bass[index, note.pitch % 12] += weight
    return decode_chords(treble, bass, treble.sum(axis=1) > 0)


def decode_chords(treble, bass, audible):
    treble, bass = np.asarray(treble), np.asarray(bass)
    treble /= np.maximum(treble.sum(axis=1, keepdims=True), 1e-8)
    bass /= np.maximum(bass.sum(axis=1, keepdims=True), 1e-8)
    scores = treble @ PROFILES.T + .27 * bass[:, ROOTS] + .06 * treble[:, ROOTS]
    # A different chord needs more support than a continuation of the previous one.
    cost = .065 * (1 - np.eye(len(CHORDS)))
    path = []
    best = np.zeros(len(CHORDS))
    for row in scores:
        candidates = best[:, None] - cost
        path.append(candidates.argmax(axis=0))
        best = row + candidates.max(axis=0)
    state = int(best.argmax())
    decoded = []
    for index in reversed(range(len(scores))):
        decoded.append((CHORDS[state], scores[index, state]))
        state = path[index][state]
    decoded.reverse()
    selected = [chord if audible[index] and score >= .47 else None
                for index, (chord, score) in enumerate(decoded)]
    # A brief dip in evidence within the same chord should not break accompaniment.
    for index in range(1, len(selected) - 1):
        chord, score = decoded[index]
        if selected[index] is None and audible[index] and score >= .38 and selected[index - 1] == selected[index + 1] == chord:
            selected[index] = chord
    return selected


def easy_shape(root, quality):
    index = CHORDS.index((root, quality))
    tones = set(np.flatnonzero(PROFILES[index]))
    options = []
    for strings in combinations(range(6), 3):
        for frets in product(range(8), repeat=3):
            pitches = tuple(TUNING[string] + fret for string, fret in zip(strings, frets))
            pressed = [fret for fret in frets if fret]
            span = max(pressed) - min(pressed) if pressed else 0
            if span > 3 or {pitch % 12 for pitch in pitches} != tones:
                continue
            score = (min(pitches) % 12 != root, span + .3 * sum(frets), max(strings) - min(strings))
            options.append((score, strings, frets, pitches))
    _, strings, frets, pitches = min(options)
    return list(zip(pitches, (index + 1 for index in strings), frets))


def render_chords(grid, bpm, duration, output, title, *, rhythmic=False):
    from transcribe_track import write_midi

    beat = 60 / bpm
    shapes = {chord: easy_shape(*chord) for chord in set(grid) if chord is not None}
    name = "rhythm" if rhythmic else "score"
    root = ET.Element("score-partwise", version="4.0")
    add(root, "movement-title", title)
    part_list = ET.SubElement(root, "part-list")
    add(ET.SubElement(part_list, "score-part", id="P1"), "part-name", "Guitare")
    part = ET.SubElement(root, "part", id="P1")
    notes = []
    # A guitar string decays even if the score still holds the note.
    # Rearticulate long runs once per four beats, with no change of fingering.
    sustain_end = {}
    if not rhythmic:
        span = 2 if bpm >= 80 else 1
        cursor = 0
        for chord, cells in groupby(grid):
            end = cursor + sum(1 for _ in cells)
            if chord is not None:
                sustain_end.update((index, min(end, index + span)) for index in range(cursor, end, span))
            cursor = end
    for index, chord in enumerate(grid):
        if index % 2 == 0:
            measure = ET.SubElement(part, "measure", number=str(index // 2 + 1))
            if index == 0:
                write_header(measure, TUNING, bpm, 0, (4, 4))
        if chord is None:
            write_rest(measure, 2 * DIVISIONS, False)
            continue
        same_chord = index > 0 and grid[index - 1] == chord
        tied_from_previous = not rhythmic and index not in sustain_end
        tied_to_next = not rhythmic and sustain_end.get(index) == index + 2
        if not same_chord:
            write_harmony(measure, *chord)
        if rhythmic:
            pattern = ((0, 8, 83), (8, 4, 72), (12, 4, 66)) if index % 2 else ((0, 8, 85), (8, 8, 70))
        else:
            pattern = ((0, 16, 80),)
        for offset, length, velocity in pattern:
            start = (index * 2 + offset / DIVISIONS) * beat
            end = min(duration, start + length / DIVISIONS * beat)
            attacks = [TabNote(pitch, start, end, velocity, string, fret, start)
                       for pitch, string, fret in shapes[chord]]
            before = len(measure)
            write_attack(measure, offset, length, [(offset + length, note) for note in attacks], {}, None, False)
            if not tied_from_previous:
                if not rhythmic:
                    for note in attacks:
                        note.end = min(duration, sustain_end[index] * 2 * beat)
                notes.extend(note for note in attacks if note.start < note.end)
            if tied_from_previous or tied_to_next:
                for note in list(measure)[before:]:
                    notation = note.find("notations")
                    for direction, applies in (("stop", tied_from_previous), ("start", tied_to_next)):
                        if applies:
                            note.insert(list(note).index(notation), ET.Element("tie", type=direction))
                            notation.insert(0, ET.Element("tied", type=direction))
    if len(grid) % 2:
        write_rest(measure, 2 * DIVISIONS, False)
    events = midi_notes(notes)
    write_midi(events, output / f"{name}.mid", 24, "guitare", bpm, beats=4)
    ET.ElementTree(root).write(output / f"{name}.musicxml", encoding="utf-8", xml_declaration=True)
    return events


def accompany(audio, output, title, progress, engine):
    import librosa

    if engine is None:
        raise ValueError("Le moteur d’accompagnement est indisponible pour le moment.")
    progress("detect")
    signal, rate = librosa.load(audio, sr=22050, mono=True)
    duration = len(signal) / rate
    bpm = estimate_tempo(signal, rate, 512)
    blocks = max(1, ceil(duration * bpm / 120))
    with TemporaryDirectory(dir=output.parent) as work:
        midi = engine.transcribe(audio, Path(work) / "harmony.mid")
    grid = midi_chords(midi, bpm, blocks)
    if sum(chord is not None for chord in grid) < max(1, blocks // 3):
        raise ValueError("Les accords sont trop incertains sur cet audio. Essaie un passage plus clair.")
    progress("arrange")
    output.mkdir()
    notes = render_chords(grid, bpm, duration, output, title)
    render_chords(grid, bpm, duration, output, title, rhythmic=True)
    copyfile(output / "score.musicxml", output / "tab.musicxml")
    return {"duration": duration, "notes": notes, "bpm": bpm, "engine": ENGINE}

"""Find the song's beats and bar lines, and place piano notes on that grid.

The score is written on a regular grid (constant tempo, real downbeats) while the
MIDI carries a tempo map that follows the recording beat by beat.  Score positions
and MIDI ticks therefore stay identical, so the player's cursor, the MIDI playback
and the separated vocal track all stay in sync with the original audio.

beat_this (CPJKU, MIT licence) is used when it is installed; librosa is the fallback.
"""
from dataclasses import dataclass
from functools import lru_cache
from math import floor
import os

import numpy as np

STEPS_PER_BEAT = 4  # 16th notes


@dataclass
class BeatGrid:
    beats: np.ndarray       # beat times in seconds (strictly increasing)
    per_bar: int            # beats per bar (3 or 4)
    first_downbeat: int     # index in beats of a downbeat
    source: str

    @property
    def bpm(self):
        return int(round(60 / float(np.median(np.diff(self.beats)))))

    def position(self, time):
        """Beat position (float) of a time, extrapolating at both ends."""
        beats = self.beats
        index = np.arange(len(beats), dtype=float)
        time = np.asarray(time, dtype=float)
        inside = np.interp(time, beats, index)
        first = (beats[1] - beats[0])
        last = (beats[-1] - beats[-2])
        before = (time - beats[0]) / first
        after = len(beats) - 1 + (time - beats[-1]) / last
        return np.where(time < beats[0], before, np.where(time > beats[-1], after, inside))

    def time(self, position):
        beats = self.beats
        index = np.arange(len(beats), dtype=float)
        position = np.asarray(position, dtype=float)
        inside = np.interp(position, index, beats)
        before = beats[0] + position * (beats[1] - beats[0])
        after = beats[-1] + (position - len(beats) + 1) * (beats[-1] - beats[-2])
        return np.where(position < 0, before, np.where(position > len(beats) - 1, after, inside))

    @property
    def bar_offset(self):
        """Beats before the first full bar, counted from audio time 0 (the pickup)."""
        return self.layout()[1]

    def layout(self):
        """Return (start, pickup): audio time 0 as a quantized beat position and the
        length in beats of the incomplete first bar (0 when the song starts on a bar)."""
        start = round(float(self.position(0.0)) * STEPS_PER_BEAT) / STEPS_PER_BEAT
        bar = self.first_downbeat + floor((start - self.first_downbeat) / self.per_bar + 1e-6) * self.per_bar
        pickup = self.per_bar - (start - bar)
        if pickup >= self.per_bar - 1 / STEPS_PER_BEAT or pickup <= 0:
            pickup = 0
        return start, pickup


def _beat_this(audio):
    tracker = _beat_this_model()
    beats, downbeats = tracker(str(audio))
    return np.asarray(beats, dtype=float), np.asarray(downbeats, dtype=float)


@lru_cache(maxsize=1)
def _beat_this_model():
    import torch
    from beat_this.inference import File2Beats

    device = os.getenv("TRACK_BEAT_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
    checkpoint = os.getenv("TRACK_BEAT_THIS_CHECKPOINT", "final0")
    return File2Beats(checkpoint_path=checkpoint, device=device, dbn=False)


def _librosa(audio):
    import librosa

    rate, hop = 22050, 256
    signal, _ = librosa.load(audio, sr=rate, mono=True)
    envelope = librosa.onset.onset_strength(y=signal, sr=rate, hop_length=hop, aggregate=np.median)
    tempo, frames = librosa.beat.beat_track(onset_envelope=envelope, sr=rate, hop_length=hop, tightness=120)
    # The tracker keeps a rigid spacing; move each beat onto the attack it stands for.
    frames = np.array([f - 5 + int(np.argmax(envelope[max(0, f - 5):f + 6])) if f >= 5 else f
                       for f in frames])
    frames = np.unique(frames)
    beats = librosa.frames_to_time(frames, sr=rate, hop_length=hop)
    if len(beats) < 4:
        return beats, np.array([])
    # Downbeats: the phase whose beats carry the most low-frequency attacks.
    mel = librosa.feature.melspectrogram(y=signal, sr=rate, hop_length=hop, n_mels=64, fmax=8000)
    low = librosa.onset.onset_strength(S=librosa.power_to_db(mel[:8]), sr=rate, hop_length=hop)
    frames = np.minimum(frames, len(low) - 1)
    strength = np.array([low[max(0, f - 2):f + 3].max() for f in frames])
    best = None
    for per_bar in (4, 3):
        for phase in range(per_bar):
            value = strength[phase::per_bar].mean() / max(strength.mean(), 1e-8)
            value *= 1 if per_bar == 4 else .87  # 3/4 must be clearly better
            if best is None or value > best[0]:
                best = (value, per_bar, phase)
    _, per_bar, phase = best
    return beats, beats[phase::per_bar]


def track_beats(audio):
    """Return a BeatGrid for the audio, or None when no steady pulse is found."""
    beats = downbeats = None
    source = "beat-this"
    if os.getenv("TRACK_BEAT_THIS", "1") != "0":
        try:
            beats, downbeats = _beat_this(audio)
        except Exception as error:  # Not installed, no weights, decoding error...
            print(f"beat_this indisponible, repli librosa : {type(error).__name__}", flush=True)
            beats = None
    if beats is None or len(beats) < 4:
        source = "librosa"
        beats, downbeats = _librosa(audio)
    return grid_from_beats(beats, downbeats, source)


def grid_from_beats(beats, downbeats, source="manual"):
    beats = np.asarray(sorted(set(np.round(np.asarray(beats, dtype=float), 4))))
    if len(beats) < 4:
        return None
    intervals = np.diff(beats)
    if np.any(intervals <= 0) or not .25 <= float(np.median(intervals)) <= 1.5:
        return None
    downbeats = np.asarray(downbeats, dtype=float)
    indices = sorted({int(np.argmin(np.abs(beats - time))) for time in downbeats
                      if np.min(np.abs(beats - time)) < .07})
    per_bar, first = 4, 0
    if len(indices) >= 2:
        gaps = np.diff(indices)
        counts = {value: int(np.sum(gaps == value)) for value in (2, 3, 4, 6)}
        best = max(counts, key=counts.get)
        per_bar = 3 if best in (3, 6) and counts[best] >= counts.get(4, 0) else 4
        first = indices[0]
    elif indices:
        first = indices[0]
    return BeatGrid(beats, per_bar, first, source)


def quantize(notes, grid, *, steps=STEPS_PER_BEAT):
    """Snap note starts and ends to the beat grid.

    Returns notes with "pos" and "length" in beats (relative to audio time 0's
    quantized position) and with start/end in seconds rebuilt from the grid."""
    start0, _ = grid.layout()
    out = []
    for note in notes:
        start = round(float(grid.position(note["start"])) * steps) / steps
        end = round(float(grid.position(note["end"])) * steps) / steps
        end = max(end, start + 1 / steps)
        if start < start0:
            start = start0
            if end <= start:
                continue
        out.append({**note, "pos": start - start0, "length": end - start,
                    "start": float(grid.time(start)), "end": float(grid.time(end))})
    # Same pitch twice on the same step: keep one, louder, longer.
    merged = {}
    for note in out:
        key = (note["pitch"], note["pos"])
        if key in merged:
            kept = merged[key]
            kept["length"] = max(kept["length"], note["length"])
            kept["end"] = max(kept["end"], note["end"])
            kept["velocity"] = max(kept["velocity"], note["velocity"])
        else:
            merged[key] = note
    return sorted(merged.values(), key=lambda note: (note["pos"], note["pitch"]))


def score_times(notes, bpm):
    """Convert quantized positions into the constant-tempo seconds used by the score."""
    beat = 60 / bpm
    return [{**note, "start": note["pos"] * beat, "end": (note["pos"] + note["length"]) * beat}
            for note in notes]


def write_grid_midi(notes, destination, grid, *, program=0, name="Piano", resolution=480):
    """Write a MIDI whose ticks follow the score and whose tempo map follows the audio."""
    from pretty_midi import Instrument, Note, PrettyMIDI, TimeSignature

    start0, _ = grid.layout()
    midi = PrettyMIDI(resolution=resolution, initial_tempo=grid.bpm)
    # Tempo segments: one per beat interval, anchored so that tick 0 is audio time 0.
    last = max([note["pos"] + note["length"] for note in notes] + [0]) + start0 + 1
    marks = [start0] + [index for index in range(int(np.ceil(start0)), int(np.ceil(last)) + 1) if index > start0]
    scales = []
    for left, right in zip(marks, marks[1:]):
        # Tick 0 is audio time 0 exactly (start0 is only rounded to a 16th).
        seconds = float(grid.time(right) - (0.0 if left == start0 else grid.time(left)))
        tick = int(round((left - start0) * resolution))
        scale = seconds / ((right - left) * resolution)
        if not scales or abs(scales[-1][1] - scale) > 1e-9:
            scales.append((tick, scale))
    midi._tick_scales = scales or [(0, 60 / (grid.bpm * resolution))]
    midi._update_tick_to_time(int(round((last - start0) * resolution)) + resolution)
    midi.time_signature_changes.append(TimeSignature(grid.per_bar, 4, 0))
    track = Instrument(program, name=name)
    for note in notes:
        start = midi.tick_to_time(int(round(note["pos"] * resolution)))
        end = midi.tick_to_time(int(round((note["pos"] + note["length"]) * resolution)))
        track.notes.append(Note(velocity=int(note["velocity"]), pitch=int(note["pitch"]), start=start, end=end))
    midi.instruments.append(track)
    midi.write(str(destination))
    return midi

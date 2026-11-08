"""Guitar-specific evidence to corroborate detected pitches and new attacks."""
from bisect import bisect_left, bisect_right
from functools import lru_cache
from pathlib import Path

from guitar_tab import attack_groups


@lru_cache(maxsize=1)
def load_tabcnn():
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    path = Path(__file__).with_name("models") / "tabcnn-gpfx.onnx"
    return ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])


def guitar_evidence(path, notes, transients, tuning):
    import librosa
    import numpy as np

    audio, rate = librosa.load(path, sr=22050, mono=True)
    hop = 512
    magnitude = np.abs(librosa.cqt(audio, sr=rate, hop_length=hop, n_bins=192, bins_per_octave=24))
    features = librosa.amplitude_to_db(magnitude, ref=np.max)
    features = (features - features.min()) / max(features.max() - features.min(), 1e-9)
    windows = np.lib.stride_tricks.sliding_window_view(np.pad(features, ((0, 0), (4, 4))), 9, axis=1)
    windows = windows.transpose(1, 0, 2)[..., None]
    model = load_tabcnn()
    probabilities = np.concatenate([
        np.exp(model.run(None, {"input": np.ascontiguousarray(windows[i:i + 128], dtype=np.float32)})[0])
        for i in range(0, len(windows), 128)
    ])
    # The model describes sounding strings, including sustained notes. A rise
    # in the recorded fundamental is separate evidence of an attack.
    fine_hop = 256
    spectrum = np.abs(librosa.cqt(
        audio, sr=rate, hop_length=fine_hop, fmin=librosa.midi_to_hz(36), n_bins=57,
    ))
    evidence = {}
    for note in notes:
        pitch, start = note["pitch"], note["start"]
        index = bisect_left(transients, start)
        adjacent = transients[max(0, index - 1):index + 1]
        anchor = min(adjacent, key=lambda time: abs(time - start), default=start)
        if abs(anchor - start) > .095:
            continue
        before = frame_window(anchor, -.12, -.025, rate, fine_hop, spectrum.shape[1])
        after = frame_window(anchor, .027, .11, rate, fine_hop, spectrum.shape[1])
        if not before.size or not after.size:
            continue
        prior = float(np.median(spectrum[pitch - 36, before]))
        peak = float(np.max(spectrum[pitch - 36, after]))
        recent = frame_window(anchor, .025, .115, rate, hop, len(probabilities))
        earlier = frame_window(anchor, -.13, -.035, rate, hop, len(probabilities))
        if not recent.size or not earlier.size:
            continue
        options = [
            (float(np.max(probabilities[recent, 6 - string, fret + 1])),
             float(np.max(probabilities[earlier, 6 - string, fret + 1])), string)
            for string, open_pitch in enumerate(tuning, 1)
            if 0 <= (fret := pitch - open_pitch) <= 19
        ]
        options.sort(reverse=True)
        if options:
            confidence, previous, string = options[0]
            margin = confidence - (options[1][0] if len(options) > 1 else 0)
            evidence[id(note)] = (anchor, peak / max(prior, .02), confidence, previous, string, margin)
    return evidence


def frame_window(anchor, start, end, rate, hop, size):
    import numpy as np

    first = max(0, round((anchor + start) * rate / hop))
    last = min(size, round((anchor + end) * rate / hop))
    return np.arange(first, last)


def refine_picked_notes(notes, strengths, evidence, protected=()):
    groups = {}
    for note in notes:
        if data := evidence.get(id(note)):
            groups.setdefault(data[0], []).append(note)
    removed = set()
    hints = {}
    for group in groups.values():
        supported = [
            note for note in group
            if evidence[id(note)][1] >= 1.65 or strengths[id(note)] >= .72
            or evidence[id(note)][2] - evidence[id(note)][3] >= .45
        ]
        if not supported:
            continue
        for note in group:
            _, rise, confidence, previous, string, margin = evidence[id(note)]
            pitch = note["pitch"]
            neighbors = [other for other in supported if other is not note]
            harmonic = any(
                pitch - other["pitch"] in (12, 24, 36)
                and strengths[id(note)] < .63
                and (
                    (note["velocity"] <= other["velocity"] * .82 and confidence < .36)
                    or (note["velocity"] <= other["velocity"] * .65
                        and strengths[id(other)] >= .72
                        and strengths[id(other)] - strengths[id(note)] >= .10)
                    or (confidence < .2 and strengths[id(other)] - strengths[id(note)] >= .32
                        and evidence[id(other)][1] >= 3 * rise)
                )
                for other in neighbors
            )
            ringing = rise < 1.23 and strengths[id(note)] < .68 and (
                confidence - previous < .25 or any(evidence[id(other)][1] > 2 for other in neighbors)
            )
            weak = confidence < .10 and strengths[id(note)] < .55 and any(
                note["velocity"] <= .55 * other["velocity"] for other in neighbors
            )
            if id(note) not in protected and (
                harmonic or weak or (ringing and neighbors)
            ):
                removed.add(id(note))
            elif confidence >= .80 and margin >= .45 and rise >= 1.55:
                hints[(note["start"], pitch)] = string
    starts = [note["start"] for note in notes]
    for note in notes:
        if id(note) in protected or id(note) in evidence or strengths[id(note)] > .22:
            continue
        start, pitch = note["start"], note["pitch"]
        nearby = notes[bisect_left(starts, start - 1.5):bisect_right(starts, start + .28)]
        if note["end"] - start <= .28 and any(
            (other["pitch"] == pitch and abs(other["start"] - start) <= .28
             and id(other) in evidence and id(other) not in removed)
            or (pitch - other["pitch"] in (12, 24, 36) and other["start"] < start < other["end"])
            for other in nearby if other is not note
        ):
            removed.add(id(note))
    return [note for note in notes if id(note) not in removed], hints


def descending_slides(path, notes, evidence, tuning, attack_levels, protected):
    import librosa
    import numpy as np

    groups = attack_groups(notes, lambda note: note["start"])
    candidates = []
    for left, right in zip(groups, groups[1:]):
        if len(left) != 1 or len(right) != 1:
            continue
        first, second = left[0], right[0]
        if id(first) in protected or id(second) in protected:
            continue
        start = evidence.get(id(first))
        end = evidence.get(id(second))
        difference = first["pitch"] - second["pitch"]
        gap = second["start"] - first["start"]
        if not start or not end or not 2 <= difference <= 4 or not .10 <= gap <= .30:
            continue
        string = start[4]
        if (start[2] < .60 or start[5] < .30 or end[1] < 2
                or second["pitch"] <= tuning[string - 1] or second["pitch"] < 55
                or attack_levels.get(end[0], 0) > .65 * attack_levels.get(start[0], 0)):
            continue
        candidates.append((first, second, string))
    if not candidates:
        return []

    audio, rate = librosa.load(path, sr=22050, mono=True)
    result = []
    window, fft_size = 1024, 8192
    taper = np.hanning(window)
    for first, second, string in candidates:
        low, high = second["pitch"], first["pitch"]
        band_start, band_end = [round(float(librosa.midi_to_hz(pitch)) * fft_size / rate)
                                for pitch in (low - 1, high + 1)]
        between = 0
        for offset in (-.055, -.043, -.031, -.019, -.007, .005, .017):
            frame = round((second["start"] + offset) * rate) - window // 2
            if frame < 0 or frame + window > len(audio):
                continue
            spectrum = np.abs(np.fft.rfft(audio[frame:frame + window] * taper, n=fft_size))
            peak = band_start + int(np.argmax(spectrum[band_start:band_end]))
            if spectrum[peak] < .06 * np.max(spectrum):
                continue
            a, b, c = np.log(np.maximum(spectrum[peak - 1:peak + 2], 1e-8))
            delta = .5 * (a - c) / min(a - 2 * b + c, -1e-8)
            pitch = float(librosa.hz_to_midi((peak + delta) * rate / fft_size))
            if low + .5 <= pitch <= high - .5:
                between += 1
        if between >= 2:
            result.append((first, second, string))
    return result

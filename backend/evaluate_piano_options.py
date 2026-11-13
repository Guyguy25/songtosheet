"""Rank piano exports using sparse pitch estimation from the original mix."""
import numpy as np
from scipy.ndimage import maximum_filter1d


def pitch_evidence(audio):
    import librosa

    rate, hop = 22050, 512
    signal, _ = librosa.load(audio, sr=rate, mono=True)
    lowest = librosa.midi_to_hz(21)
    spectrum = np.abs(librosa.cqt(y=signal, sr=rate, hop_length=hop, fmin=lowest,
                                  n_bins=306, bins_per_octave=36)).astype(np.float32)
    # Fit a sparse mixture of 88 harmonic templates to each time frame.
    bins = np.arange(len(spectrum), dtype=np.float32)[:, None]
    fundamentals = 3 * np.arange(88, dtype=np.float32)[None, :]
    dictionary = np.zeros((len(bins), 88), dtype=np.float32)
    for harmonic in range(1, 7):
        offsets = bins - fundamentals - 36 * np.log2(harmonic)
        dictionary += np.exp(-.5 * (offsets / 1.15) ** 2) / harmonic
    dictionary /= np.linalg.norm(dictionary, axis=0)
    projected = dictionary.T @ spectrum
    gram = dictionary.T @ dictionary
    penalty = .10 * projected.max(axis=0, keepdims=True)
    # Projected gradient descent with momentum for non-negative L1 regression.
    step = 1 / float(np.linalg.norm(gram, ord=2))
    strengths = np.zeros_like(projected)
    estimate = strengths
    for i in range(36):
        fitted = np.maximum(0, estimate + step * (projected - gram @ estimate - penalty))
        estimate = fitted + i / (i + 3) * (fitted - strengths)
        strengths = fitted
    rms = librosa.feature.rms(y=signal, hop_length=hop)[0][:strengths.shape[1]]
    if rms.size == 0:
        return strengths[:, :0], hop / rate
    strengths = strengths[:, :len(rms)]
    strengths[:, rms < max(.001, float(np.percentile(rms, 90)) * .07)] = 0
    confidence = strengths / np.maximum(strengths.max(axis=0, keepdims=True), 1e-8)
    confidence[confidence < .16] = 0
    return confidence, hop / rate


def score_notes(evidence, step, notes):
    if not evidence.size or not np.any(evidence) or not notes:
        return None
    mask = np.zeros(evidence.shape, dtype=bool)
    starts = []
    for note in notes:
        pitch = note["pitch"] - 21
        start = round(note["start"] / step)
        end = min(evidence.shape[1], max(start + 1, round(note["end"] / step)))
        if 0 <= pitch < len(evidence) and 0 <= start < end:
            mask[pitch, start:end] = True
            starts.append((pitch, start))
    if not starts:
        return None
    near_evidence = maximum_filter1d(evidence, size=7, axis=1)
    near_played = maximum_filter1d(mask, size=7, axis=1)
    precision = near_evidence[mask].mean()
    recall = evidence[near_played].sum() / evidence.sum()
    match = 2 * precision * recall / max(precision + recall, 1e-8)
    attack = np.mean([near_evidence[pitch, start] for pitch, start in starts])
    return float(.8 * match + .2 * attack)


def recommend(audio, candidates):
    from pretty_midi import PrettyMIDI
    from transcribe_track import midi_events

    evidence, step = pitch_evidence(audio)
    scores = {}
    for key, path in candidates.items():
        score = score_notes(evidence, step, midi_events(PrettyMIDI(str(path)), float("inf")))
        if score is not None:
            scores[key] = score
    if len(scores) < 2 or len(scores) != len(candidates) or max(scores.values()) <= 0:
        return None
    best = max(scores, key=scores.get)
    return {"version": 1, "recommended": best,
            "scores": {key: round(100 * score) for key, score in scores.items()}}

"""Rank piano exports by musical fidelity to the source audio."""
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


def note_grid(evidence, step, notes):
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
    return mask, starts


def score_notes(evidence, step, notes):
    grid = note_grid(evidence, step, notes)
    if grid is None:
        return None
    return pitch_score(evidence, *grid)


def pitch_score(evidence, mask, starts):
    near_evidence = maximum_filter1d(evidence, size=7, axis=1)
    near_played = maximum_filter1d(mask, size=7, axis=1)
    precision = near_evidence[mask].mean()
    recall = evidence[near_played].sum() / evidence.sum()
    match = 2 * precision * recall / max(precision + recall, 1e-8)
    attack = np.mean([near_evidence[pitch, start] for pitch, start in starts])
    return float(.8 * match + .2 * attack)


def chroma_grid(grid):
    chroma = np.zeros((12, grid.shape[1]), dtype=np.float32)
    for pitch, frames in enumerate(grid, start=21):
        chroma[pitch % 12] = np.maximum(chroma[pitch % 12], frames)
    return chroma


def coverage(reference, candidate):
    """Compare time-aligned profiles while allowing slight attack jitter."""
    if not reference.any():
        return None
    near = maximum_filter1d(candidate, size=7, axis=1)
    return float((reference * near).sum() / reference.sum())


def harmony_score(evidence, played):
    first, second = chroma_grid(evidence), chroma_grid(played)
    recall = coverage(first, second)
    active = first.any(axis=0)
    second[:, ~active] = 0
    precision = coverage(second, first) or 0
    return 2 * precision * recall / max(precision + recall, 1e-8)


def register_line(evidence):
    """Keep the strongest supported pitch in each frame."""
    strongest = evidence.argmax(axis=0)
    line = np.zeros_like(evidence)
    columns = np.arange(evidence.shape[1])
    line[strongest, columns] = evidence[strongest, columns]
    return line


def similarity(evidence, step, notes, vocal_evidence=None):
    grid = note_grid(evidence, step, notes)
    if grid is None:
        return None
    played, starts = grid
    score = .34 * pitch_score(evidence, played, starts) + .28 * harmony_score(evidence, played)
    weight = .62
    bass = coverage(register_line(evidence[:36]), played[:36])
    if bass is not None:
        score += .14 * bass
        weight += .14
    melodic_reference = vocal_evidence
    if melodic_reference is None or not melodic_reference.any():
        melodic_reference = evidence.copy()
        melodic_reference[:39] = 0
    length = min(evidence.shape[1], melodic_reference.shape[1])
    melody = coverage(chroma_grid(register_line(melodic_reference[:, :length])),
                      chroma_grid(played[:, :length]))
    if melody is not None:
        score += .16 * melody
        weight += .16
    attacks = np.maximum(0, np.diff(evidence, axis=1, prepend=0))
    predicted = np.zeros_like(played)
    for pitch, start in starts:
        predicted[pitch, start] = True
    timing = coverage(attacks, predicted)
    if timing is not None:
        score += .08 * timing
        weight += .08
    return score / weight


def recommend(audio, candidates, vocals=None, *, has_voice=False, references=None, version=3):
    if version == 3:
        return recommend_v3(audio, candidates, vocals, has_voice=has_voice, references=references)
    return recommend_v2(audio, candidates, vocals)


def recommend_v2(audio, candidates, vocals=None):
    from pretty_midi import PrettyMIDI
    from transcribe_track import midi_events

    evidence, step = pitch_evidence(audio)
    vocal_evidence = None
    if vocals is not None and vocals.is_file():
        try:
            vocal_evidence, _ = pitch_evidence(vocals)
        except (OSError, ValueError):
            pass
    scores = {}
    for key, path in candidates.items():
        score = similarity(evidence, step, midi_events(PrettyMIDI(str(path)), float("inf")), vocal_evidence)
        if score is not None:
            scores[key] = score
    if len(scores) < 2 or len(scores) != len(candidates) or max(scores.values()) <= 0:
        return None
    best = max(scores, key=scores.get)
    return {"version": 2, "recommended": best,
            "scores": {key: round(100 * score) for key, score in scores.items()}}


# --- Judge v3: per-criterion scores, playability and an explanation -------------------

CRITERIA = ("melody", "harmony", "bass", "rhythm", "notes", "playability")
WEIGHTS = {"melody": .25, "harmony": .18, "bass": .08, "rhythm": .09, "notes": .20, "playability": .20}
PHRASES = {
    "melody": "la mélodie suit fidèlement la voix du morceau",
    "harmony": "les accords correspondent à ceux de l’enregistrement",
    "bass": "la ligne de basse est respectée",
    "rhythm": "le rythme colle aux attaques de l’original",
    "notes": "les notes entendues dans l’audio sont bien présentes",
    "playability": "elle reste confortable à jouer à deux mains",
}


def hand_split(pitches, reach=(14, 12), most=(4, 5)):
    """Best split of one attack between the hands: (left, right, comfortable)."""
    pitches = sorted(pitches)
    best = None
    for cut in range(len(pitches) + 1):
        left, right = pitches[:cut], pitches[cut:]
        fits = [(not hand or (hand[-1] - hand[0] <= limit and len(hand) <= count))
                for hand, limit, count in ((left, reach[0], most[0]), (right, reach[1], most[1]))]
        cost = (not all(fits), abs(cut - sum(p < 60 for p in pitches)))
        if best is None or cost < best[0]:
            best = (cost, left, right, all(fits))
    return best[1], best[2], best[3]


def playability(notes):
    """1.0 = every attack fits two hands at a comfortable density."""
    if not notes:
        return None
    groups = []
    for note in sorted(notes, key=lambda item: item["start"]):
        if groups and note["start"] - groups[-1][0]["start"] <= .04:
            groups[-1].append(note)
        else:
            groups.append([note])
    awkward = sum(not hand_split([n["pitch"] for n in group])[2] for group in groups)
    span = max(1.0, groups[-1][0]["start"] - groups[0][0]["start"])
    density = len(groups) / span
    simultaneous = float(np.mean([len(group) for group in groups]))
    score = 1 - .75 * awkward / len(groups) - .25 * max(0.0, min(1.0, (density - 7) / 8))
    score -= .15 * max(0.0, min(1.0, (simultaneous - 6) / 4))
    return float(max(0.0, score))


RATE = 22050
HOP = 512


def render(notes, length):
    """Fast additive piano-like rendering, enough to compare spectra with the source."""
    out = np.zeros(length, dtype=np.float32)
    for note in notes:
        start = int(note["start"] * RATE)
        if start >= length:
            continue
        ring = min(length - start, int((note["end"] - note["start"] + .25) * RATE))
        if ring <= 0:
            continue
        t = np.arange(ring, dtype=np.float32) / RATE
        frequency = 440 * 2 ** ((note["pitch"] - 69) / 12)
        tone = np.zeros(ring, dtype=np.float32)
        for harmonic in range(1, 7):
            if frequency * harmonic < RATE / 2:
                tone += np.sin(2 * np.pi * frequency * harmonic * t) / harmonic ** 1.4
        decay = np.exp(-t * (1.2 + note["pitch"] / 40))
        held = int((note["end"] - note["start"]) * RATE)
        if held < ring:
            decay[held:] *= np.linspace(1, 0, ring - held)
        out[start:start + ring] += tone * decay * (note.get("velocity", 80) / 127)
    return out


def spectral_profile(signal, separate=False):
    import librosa

    harmonic = librosa.effects.harmonic(signal, margin=2) if separate and signal.any() else signal
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=RATE, hop_length=HOP)
    bass = librosa.feature.chroma_cqt(y=harmonic, sr=RATE, hop_length=HOP, fmin=librosa.note_to_hz("A0"),
                                      n_octaves=3)
    onsets = librosa.onset.onset_strength(y=harmonic, sr=RATE, hop_length=HOP)
    rms = librosa.feature.rms(y=signal, hop_length=HOP)[0]
    return chroma, bass, onsets, rms


def pooled(matrix, size=11):
    """Average over ~250 ms windows so small timing shifts do not count as errors."""
    frames = matrix.shape[-1] // size * size
    if frames == 0:
        return matrix
    return matrix[..., :frames].reshape(*matrix.shape[:-1], -1, size).mean(axis=-1)


def cosine_frames(first, second, active):
    numerator = (first * second).sum(axis=0)
    norm = np.linalg.norm(first, axis=0) * np.linalg.norm(second, axis=0)
    values = numerator / np.maximum(norm, 1e-8)
    return float(values[active].mean()) if active.any() else None


def sound_alike(source, rendered):
    """Compare the source mix with a rendering of a candidate: harmony, bass, rhythm."""
    chroma, bass, onsets, rms = source
    other_chroma, other_bass, other_onsets, _ = rendered
    frames = min(chroma.shape[1], other_chroma.shape[1])
    active = pooled(rms[:frames]) > max(1e-3, float(np.percentile(rms, 90)) * .08)
    values = {
        "harmony": cosine_frames(pooled(chroma[:, :frames]), pooled(other_chroma[:, :frames]), active),
        "bass": cosine_frames(pooled(bass[:, :frames]), pooled(other_bass[:, :frames]), active),
    }
    first, second = onsets[:frames], other_onsets[:frames]
    if first.std() > 0 and second.std() > 0:
        from scipy.ndimage import maximum_filter1d

        near = maximum_filter1d(second, size=5)
        values["rhythm"] = float(max(0.0, np.corrcoef(first, near)[0, 1]))
    return values


def _matches(notes, others, tolerance):
    from bisect import bisect_left

    index = {}
    for note in others:
        index.setdefault(note["pitch"], []).append(note["start"])
    for starts in index.values():
        starts.sort()
    found = 0
    for note in notes:
        starts = index.get(note["pitch"], [])
        position = bisect_left(starts, note["start"] - tolerance)
        found += position < len(starts) and starts[position] <= note["start"] + tolerance
    return found


def consensus(transcriptions, tolerance=.06):
    """Notes that independent transcription models agree on (pitch and onset).

    Each model has its own failure modes (harmonics, octave errors, missed notes), so
    a note heard by several models is far more likely to be in the recording."""
    lists = [notes for notes in transcriptions if notes]
    if len(lists) < 2:
        return None
    needed = 1 if len(lists) == 2 else (len(lists) + 1) // 2
    agreed = []
    for index, notes in enumerate(lists):
        others = [other for position, other in enumerate(lists) if position != index]
        for note in notes:
            if sum(_matches([note], other, tolerance) for other in others) >= needed:
                agreed.append(note)
    unique = []
    for note in sorted(agreed, key=lambda item: (item["pitch"], item["start"])):
        if unique and unique[-1]["pitch"] == note["pitch"] and note["start"] - unique[-1]["start"] <= tolerance:
            continue
        unique.append(note)
    return sorted(unique, key=lambda item: item["start"]) or None


def agreement(notes, reference, tolerance=.07):
    if not notes or not reference:
        return 0.0
    precision = _matches(notes, reference, tolerance) / len(notes)
    recall = _matches(reference, notes, tolerance) / len(reference)
    return 2 * precision * recall / max(precision + recall, 1e-8)


def criteria(evidence, step, notes, vocal_evidence=None, source=None, length=None, reference=None):
    grid = note_grid(evidence, step, notes)
    if grid is None:
        return None
    played, starts = grid
    values = {"notes": agreement(notes, reference) if reference else pitch_score(evidence, played, starts)}
    if source is not None:
        values.update(sound_alike(source, spectral_profile(render(notes, length))))
    else:
        values.update(harmony=harmony_score(evidence, played),
                      bass=coverage(register_line(evidence[:36]), played[:36]))
    reference = vocal_evidence
    if reference is None or not reference.any():
        reference = evidence.copy()
        reference[:39] = 0
    length = min(evidence.shape[1], reference.shape[1])
    values["melody"] = coverage(chroma_grid(register_line(reference[:, :length])), chroma_grid(played[:, :length]))
    if "rhythm" not in values:
        attacks = np.maximum(0, np.diff(evidence, axis=1, prepend=0))
        predicted = np.zeros_like(played)
        for pitch, start in starts:
            predicted[pitch, start] = True
        values["rhythm"] = coverage(attacks, predicted)
    values["playability"] = playability(notes)
    return {key: float(value) for key, value in values.items() if value is not None}


def total(values):
    weight = sum(WEIGHTS[key] for key in values)
    return sum(WEIGHTS[key] * value for key, value in values.items()) / max(weight, 1e-8)


def explain(best, table, has_voice):
    """French one-liner shown under the AI badge, built from the measured criteria."""
    mine = table[best]
    others = [values for key, values in table.items() if key != best]
    ranked = sorted(
        mine,
        key=lambda key: (mine[key] - max((values.get(key, 0) for values in others), default=0), mine[key]),
        reverse=True,
    ) if others else list(mine)
    strengths = [key for key in ranked if mine[key] >= .55][:2] or ranked[:1]
    if "playability" not in strengths and mine.get("playability", 0) >= .85 and len(strengths) < 2:
        strengths.append("playability")
    phrases = dict(PHRASES)
    if not has_voice:
        phrases["melody"] = "la mélodie principale est fidèle à l’original"
    reasons = " et ".join(phrases[key] for key in strengths)
    return f"Recommandée par l’IA : {reasons}."


def recommend_v3(audio, candidates, vocals=None, *, has_voice=False, references=None, workers=None):
    """workers: threads for the independent analyses (default: one per task). numpy and
    librosa release the GIL in their heavy parts, so on a 3-minute piece the candidates
    (rendered and analysed one by one before: ~18 s) are scored side by side, with the
    exact same computations."""
    from concurrent.futures import ThreadPoolExecutor

    from pretty_midi import PrettyMIDI
    from transcribe_track import midi_events

    import librosa

    def source_profile():
        signal, _ = librosa.load(audio, sr=RATE, mono=True)
        return signal, spectral_profile(signal, separate=True)

    def vocal_pitch():
        if vocals is None or not vocals.is_file():
            return None
        try:
            return pitch_evidence(vocals)[0]
        except (OSError, ValueError):
            return None

    with ThreadPoolExecutor(max_workers=workers or 3) as pool:
        evidence_future, profile_future = pool.submit(pitch_evidence, audio), pool.submit(source_profile)
        vocal_future = pool.submit(vocal_pitch)
        evidence, step = evidence_future.result()
        signal, source = profile_future.result()
        vocal_evidence = vocal_future.result()
    if vocal_evidence is not None:
        has_voice = has_voice or bool(vocal_evidence.any())
    reference = consensus(list((references or {}).values()))

    def score(path):
        notes = midi_events(PrettyMIDI(str(path)), float("inf"))
        return criteria(evidence, step, notes, vocal_evidence, source, len(signal), reference)

    with ThreadPoolExecutor(max_workers=workers or max(1, len(candidates))) as pool:
        results = dict(zip(candidates, pool.map(score, candidates.values())))
    table = {key: values for key, values in results.items() if values}
    if len(table) < 2 or len(table) != len(candidates):
        return None
    scores = {key: total(values) for key, values in table.items()}
    if max(scores.values()) <= 0:
        return None
    best = max(scores, key=scores.get)
    return {
        "version": 3, "recommended": best,
        "scores": {key: round(100 * score) for key, score in scores.items()},
        "criteria": {key: {name: round(100 * value) for name, value in values.items()} for key, values in table.items()},
        "summary": explain(best, table, has_voice),
    }

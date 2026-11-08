"""Find well-supported guitar harmony and separate plucks from ringing notes."""
from bisect import bisect_left
from itertools import groupby

from guitar_tab import attack_groups, group_for_notation


CHORD_INTERVALS = {
    (0, 4, 7): "major",
    (0, 3, 7): "minor",
    (0, 2, 7): "suspended-second",
    (0, 5, 7): "suspended-fourth",
    (0, 4, 7, 11): "major-seventh",
    (0, 4, 7, 10): "dominant",
    (0, 3, 7, 10): "minor-seventh",
}


def onset_strengths(model, notes):
    from basic_pitch.constants import AUDIO_SAMPLE_RATE, FFT_HOP

    strengths = {}
    for note in notes:
        frame = round(note["start"] * AUDIO_SAMPLE_RATE / FFT_HOP)
        values = model["onset"][max(0, frame - 4):frame + 5, note["pitch"] - 21]
        strengths[id(note)] = float(values.max()) if len(values) else 0
    return strengths


def chord_changes(notes, strengths):
    anchors = []
    for note in notes:
        start, pitch = note["start"], note["pitch"]
        if pitch > 53 or note["velocity"] < 65 or strengths[id(note)] < .76:
            continue
        if not anchors or (start - anchors[-1][0] >= .75 and pitch % 12 != anchors[-1][1]):
            anchors.append((start, pitch % 12))
    if not anchors:
        return []
    result = []
    starts = [note["start"] for note in notes]
    for index, (start, root) in enumerate(anchors):
        end = anchors[index + 1][0] if index + 1 < len(anchors) else notes[-1]["end"]
        if end - start < .65:
            continue
        window = notes[bisect_left(starts, start):bisect_left(starts, end)]
        segment = [note for note in window if note["velocity"] >= 60 and strengths[id(note)] >= .65]
        intervals = {(note["pitch"] - root) % 12 for note in segment}
        third = 4 if 4 in intervals else 3
        if third not in intervals or {3, 4} <= intervals:
            continue
        full = 7 in intervals
        if not full and (intervals != {0, third} or len(segment) < 4):
            continue
        quality = "minor" if third == 3 else "major"
        if full and third == 4 and 11 in intervals:
            quality = "major-seventh"
        elif full and 10 in intervals:
            quality = "dominant" if third == 4 else "minor-seventh"
        chord_tones = {0, third, 7}
        if quality.endswith("seventh") or quality == "dominant":
            chord_tones.add(11 if quality == "major-seventh" else 10)
        if sum((note["pitch"] - root) % 12 not in chord_tones for note in segment) > len(segment) / 5:
            continue
        result.append((start, root, quality, full))
    # A third without a fifth is only labelled in an established progression.
    established = sum(full for _, _, _, full in result) >= 2
    changes = ((start, root, quality) for start, root, quality, full in result if full or established)
    return [next(group) for _, group in groupby(changes, key=lambda chord: chord[1:])]


def tab_chord_changes(tab, transients):
    """Name clear voicings without changing the attacks or making notes simultaneous."""
    groups = [group for _, group, _ in group_for_notation(tab, transients)]
    starts = [group[0].start for group in groups]
    result = []
    for index, group in enumerate(groups):
        start = starts[index]
        bass_note = min(group, key=lambda note: note.pitch)
        bass = bass_note.pitch % 12
        tones = {note.pitch % 12 for note in group}
        matches = [
            (root, quality) for root in sorted(tones, key=lambda pitch: (pitch != bass, pitch))
            if (quality := CHORD_INTERVALS.get(tuple(sorted((tone - root) % 12 for tone in tones))))
        ]
        if not matches and len(tones) == 2 and len(group) >= 3 and tones == {bass, (bass + 7) % 12}:
            matches = [(bass, "power")]
        if not matches and bass_note.pitch <= 55:
            stop = bisect_left(starts, start + .8)
            phrase = [note for attack in groups[index:stop] for note in attack]
            # A low note followed by a third and fifth while it rings can be
            # an arpeggio. A detached melody with the same notes stays unlabelled.
            if len(phrase) >= 3 and bass_note.end >= phrase[-1].start + .04:
                intervals = tuple(sorted({(note.pitch - bass) % 12 for note in phrase}))
                if quality := CHORD_INTERVALS.get(intervals):
                    matches = [(bass, quality)]
        if matches:
            root, quality = matches[0]
            if result and result[-1][1] == root and quality in (result[-1][2], "power"):
                continue
            result.append((start, root, quality))
    return result


def clean_arpeggio(notes, strengths):
    groups = attack_groups(notes, lambda note: note["start"])
    kept = []
    ringing = {}
    for group in groups:
        attack = max(group, key=lambda note: strengths[id(note)])
        strongest = strengths[id(attack)]
        active = []
        for note in group:
            pitch, start = note["pitch"], note["start"]
            prior = ringing.get(pitch)
            if prior and start - prior["end"] <= .055 and strongest - strengths[id(note)] >= .17:
                prior["end"] = max(prior["end"], note["end"])
                continue
            harmonic = any(pitch - other["pitch"] in (12, 24, 36, 48)
                           and note["velocity"] <= other["velocity"] * .57
                           and note["end"] <= other["end"] + .07
                           for other in group)
            weak = (strongest >= .85 and strengths[id(note)] < .48
                    and note["velocity"] <= attack["velocity"] * .6)
            if not harmonic and not weak:
                active.append(dict(note))
        for note in active:
            ringing[note["pitch"]] = note
        kept.extend(active)
    # Keep the original attacks when several notes are regularly struck together.
    picked = attack_groups(kept, lambda note: note["start"])
    return kept if picked and sum(len(group) > 1 for group in picked) * 3 <= len(picked) else notes

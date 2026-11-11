"""Conservative publishing checks for the guitar-only arrangement."""
from collections import defaultdict, deque

from guitar_tab import attack_groups


def has_complete_opening(notes, voice=()):
    """Recognize a repeating picked pattern with a bass and upper notes."""
    if not notes:
        return False
    start = notes[0]["start"]
    opening_notes = [note for note in notes if note["start"] < start + 10]
    sung = [note for note in voice if note["start"] < start + 10
            and not any(abs(note["start"] - guitar["start"]) < .12
                        and (note["pitch"] - guitar["pitch"]) % 12 == 0 for guitar in opening_notes)]
    if len(sung) >= 5 and len({note["pitch"] for note in sung}) >= 3:
        return False
    groups = attack_groups(opening_notes, lambda note: note["start"])
    pitches = [set(note["pitch"] for note in group) for group in groups]
    if len(pitches) < 16 or sum(len(group) == 1 for group in pitches) < .9 * len(pitches):
        return False
    for length in range(4, 9):
        for offset in range(min(4, len(pitches) - 3 * length + 1)):
            first = pitches[offset:offset + length]
            motif = set().union(*first)
            if len(motif) < 3 or max(motif) - min(motif) < 12:
                continue
            repeats = pitches[offset + length:offset + 3 * length]
            if sum(group == first[i % length] for i, group in enumerate(repeats)) >= 2 * length - 2:
                return True
    return False


def publishable_solo(reference, arranged, tuning, capo, step):
    if len(reference) < 4 or not arranged:
        return False
    attacks = defaultdict(list)
    by_pitch = defaultdict(deque)
    for note in arranged:
        if not (1 <= note.string <= len(tuning) and 0 <= note.fret <= 20
                and note.pitch == tuning[note.string - 1] + capo + note.fret):
            return False
        attacks[note.start].append(note)
        by_pitch[note.pitch].append(note.start)
    for group in attacks.values():
        frets = [note.fret for note in group if note.fret]
        if len({note.string for note in group}) != len(group):
            return False
        if frets and max(frets) - min(frets) > 5:
            return False

    tolerance = min(.16, max(.075, .65 * step))
    matches = []
    for note in reference:
        times = by_pitch[note["pitch"]]
        start = note["start"]
        while times and times[0] < start - tolerance:
            times.popleft()
        matched = bool(times and times[0] <= start + tolerance)
        if matched:
            times.popleft()
        matches.append(matched)
    if sum(matches) < .8 * len(matches):
        return False
    for index in range(0, len(matches), 8):
        phrase = matches[index:index + 8]
        if len(phrase) >= 4 and sum(phrase) < .625 * len(phrase):
            return False
    return True

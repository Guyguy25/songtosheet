"""Recognize a repeated, evenly picked open-string figure at the start."""
from bisect import bisect_left, bisect_right
from statistics import median


def repeated_open_intro(notes, strengths, transients, open_pitches):
    if not notes:
        return None
    starts = [note["start"] for note in notes]
    first = bisect_left(transients, starts[0] - .12)
    times = transients[first:first + 36]
    if len(times) < 9 or abs(times[0] - starts[0]) > .12:
        return None
    picks = []
    for time in times:
        nearby = notes[bisect_left(starts, time - .105):bisect_right(starts, time + .105)]
        if not nearby:
            break
        best = max(nearby, key=lambda item: strengths[id(item)] + item["velocity"] / 300)
        confidence = strengths[id(best)]
        if confidence < .70 or any(
            note["pitch"] != best["pitch"] and strengths[id(note)] >= max(.76, confidence - .10)
            and note["velocity"] >= .72 * best["velocity"]
            for note in nearby
        ):
            break
        picks.append(best)
    for length in (6, 4, 3, 8):
        if len(picks) < length * 3:
            continue
        pattern = [item["pitch"] for item in picks[:length]]
        if len(set(pattern)) < 3 or not set(pattern) <= open_pitches:
            continue
        if any(pattern == pattern[:part] * (length // part) for part in (2, 3, 4) if part < length and length % part == 0):
            continue
        initial = times[:length * 3]
        gaps = [b - a for a, b in zip(initial, initial[1:])]
        pulse = median(gaps)
        if not .18 <= pulse <= .65 or any(abs(gap - pulse) > pulse * .16 for gap in gaps):
            continue
        count = 0
        for index, item in enumerate(picks):
            if item["pitch"] != pattern[index % length]:
                break
            if index and abs(times[index] - times[index - 1] - pulse) > pulse * .16:
                break
            count += 1
        if count < length * 3:
            continue
        origin = picks[0]["start"]
        cutoff = times[count - 1] + pulse * .45
        picked = [dict(item, end=max(item["end"], item["start"] + pulse)) for item in picks[:count]]
        if count % length == length - 1:
            next_time = times[count - 1] + pulse
            nearby = notes[bisect_left(starts, next_time - .11):bisect_right(starts, next_time + .11)]
            clear = [note for note in nearby if strengths[id(note)] >= .80]
            if len(clear) == 1 and clear[0]["pitch"] > max(open_pitches):
                note = clear[0]
                picked.append(dict(note, end=max(note["end"], note["start"] + pulse)))
                cutoff = note["start"] + pulse * .40
        tail = [item for item in notes if item["start"] >= cutoff]
        return picked + tail, origin, cutoff, pulse, length, len(picked)
    return None


def open_pull_offs(notes, strengths, transients, levels, cutoff, pulse, tuning):
    starts = [note["start"] for note in notes]
    result = []
    echoes = set()
    for index in range(max(1, bisect_left(transients, cutoff)), len(transients)):
        first, second = transients[index - 1:index + 1]
        if second - cutoff > 12 * pulse:
            break
        if first < cutoff or not .28 * pulse <= second - first <= .60 * pulse:
            continue
        if levels[index - 1] < 2 or levels[index] > .57 * levels[index - 1]:
            continue
        groups = [notes[bisect_left(starts, time - .07):bisect_right(starts, time + .07)]
                  for time in (first, second)]
        if not all(groups):
            continue
        before, after = [max(group, key=lambda note: note["velocity"]) for group in groups]
        if after["pitch"] not in tuning or not 2 <= before["pitch"] - after["pitch"] <= 8:
            continue
        if strengths[id(before)] < .23 or strengths[id(after)] < .55:
            continue
        if any(note["velocity"] > chosen["velocity"] * .83 or strengths[id(note)] >= .55
               for group, chosen in zip(groups, (before, after)) for note in group if note is not chosen):
            continue
        string = tuning.index(after["pitch"]) + 1
        result.append((before, after, string))
        echoes.update(id(note) for group, chosen in zip(groups, (before, after)) for note in group if note is not chosen)
    return result, echoes

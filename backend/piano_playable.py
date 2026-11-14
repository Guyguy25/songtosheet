"""Build a melody-and-bass piano arrangement from YourMT3+ instrument tracks."""
from bisect import bisect_left
from dataclasses import dataclass

from guitar_tab import attack_groups


@dataclass(frozen=True)
class Tone:
    pitch: int
    start: float
    end: float
    velocity: int
    vocal: bool


def source_tones(midi, duration):
    return sorted(
        (Tone(n.pitch, n.start, min(n.end, duration), n.velocity, track.program == 100)
         for track in midi.instruments if not track.is_drum
         for n in track.notes if 21 <= n.pitch <= 108 and 0 <= n.start < min(n.end, duration)),
        key=lambda tone: (tone.start, tone.pitch),
    )


def choose_melody(tones):
    lead = [tone for tone in tones if tone.vocal and tone.end - tone.start >= .085]
    if len(lead) >= 4:
        groups = attack_groups(lead, lambda tone: tone.start)
    else:
        groups = attack_groups(
            [tone for tone in tones if tone.pitch >= 58 and tone.end - tone.start >= .16],
            lambda tone: tone.start,
        )
    melody = []
    previous = 69
    for group in groups:
        top = max(group, key=lambda tone: (
            min(.5, tone.end - tone.start) * 50 + tone.velocity * .20
            - abs(tone.pitch - previous) * .75 + min(tone.pitch, 84) * .13
        ))
        melody.append(top)
        previous = top.pitch
    return melody


def fit_register(pitch, low, high):
    options = [value for value in range(low, high + 1) if value % 12 == pitch % 12]
    return min(options, key=lambda value: abs(value - pitch))


def write_voice(tones, low, high, end, minimum_gap):
    events = []
    for tone in tones:
        if events:
            previous = events[-1]
            if tone.start - previous["start"] < minimum_gap:
                continue
            previous["end"] = min(previous["end"], tone.start)
        events.append(dict(pitch=fit_register(tone.pitch, low, high), start=tone.start,
                           end=min(tone.end, end), velocity=tone.velocity))
    return events


def arrange(midi, duration, bpm):
    """Retain the detected lead and space low accompaniment attacks."""
    tones = source_tones(midi, duration)
    melody = choose_melody(tones)
    upper = write_voice(melody, 60, 84, duration, .105)
    bass = [tone for tone in tones if not tone.vocal and tone.pitch < 60 and tone.end - tone.start >= .12]
    times = [tone.start for tone in bass]
    lower = []
    interval = 60 / bpm
    cursor = 0
    while cursor < len(bass):
        first = bass[cursor].start
        next_cursor = bisect_left(times, first + interval * .72, lo=cursor)
        window = bass[cursor:next_cursor]
        tone = min(window, key=lambda n: n.pitch + (n.start - first) * 22 - min(.5, n.end - n.start) * 9)
        lower.append(Tone(tone.pitch, tone.start, min(duration, tone.start + min(interval * .90, tone.end - tone.start)),
                          min(tone.velocity, 74), False))
        cursor = next_cursor
    return sorted(upper + write_voice(lower, 36, 55, duration, .16),
                  key=lambda note: (note["start"], note["pitch"]))

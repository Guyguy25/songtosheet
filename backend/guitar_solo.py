"""Make a playable picked arrangement from an existing guitar transcription."""
from pretty_midi import PrettyMIDI

from guitar_tab import arrange, attack_groups, midi_notes, write_tab
from transcribe_track import TUNINGS, write_midi


def picked_notes(notes, bpm):
    groups = attack_groups(notes, lambda note: note["start"])
    subdivision = 15 / bpm  # Sixteenth note at the detected tempo.
    result = []
    for index, group in enumerate(groups):
        start = group[0]["start"]
        next_start = groups[index + 1][0]["start"] if index + 1 < len(groups) else start + 4 * subdivision
        pitches = {}
        for note in sorted(group, key=lambda note: -note["velocity"]):
            pitches.setdefault(note["pitch"], note)
        ordered = sorted(pitches.values(), key=lambda note: note["pitch"])
        if len(ordered) == 1:
            result.append(ordered[0])
            continue

        slots = min(3, max(1, int((next_start - start + .015) / subdivision)))
        if slots == 1:
            picked = ordered[-1:]
        elif slots == 2 or len(ordered) == 2:
            picked = [ordered[0], ordered[-1]]
        else:
            picked = [ordered[0], max(ordered[1:-1], key=lambda note: note["velocity"]), ordered[-1]]
        for offset, note in enumerate(picked):
            attack = start + offset * subdivision
            end = min(next_start, attack + max(subdivision, note["end"] - note["start"]))
            if end > attack:
                result.append({**note, "start": attack, "end": end})
    return result


def write_solo(source, destination, title, bpm, meter, capo):
    midi = PrettyMIDI(str(source))
    notes = [dict(pitch=note.pitch, start=note.start, end=note.end, velocity=note.velocity)
             for track in midi.instruments for note in track.notes]
    tuning = TUNINGS["guitare"]
    tab = arrange(picked_notes(notes, bpm), tuning, capo=capo, simple=True)
    playable = midi_notes(tab)
    if not playable:
        return False
    destination.mkdir(exist_ok=True)
    beats, beat_type = meter
    write_midi(playable, destination / "tab.mid", 24, "guitare", bpm, beats=beats, beat_type=beat_type)
    write_tab(tab, destination / "tab.musicxml", tuning, bpm, title, "guitare", capo=capo, meter=meter)
    return True

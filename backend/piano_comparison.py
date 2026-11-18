"""Generate SongToSheet's piano versions for a preview and let the judge pick one.

Versions (keys are shared with the site, see lib/track-jobs.js):
- arrangement: two-hand arrangement, sung melody in the right hand, chords in the left.
- playable:    "Piano facile", melody plus one bass note per chord.
- solo:        Transkun transcription when the recording is mostly piano (covers, ballads).
- yourmt3:     every note YourMT3+ hears in the mix, thinned so each hand stays playable.
- basic / reduction: Basic Pitch fallbacks, only when YourMT3+ is unavailable.

All versions are written on the song's real beat grid (see piano_beats.py).
"""
from concurrent.futures import ThreadPoolExecutor
import math

from piano_arranger import arrange, monophonic
from piano_beats import quantize, score_times, track_beats, write_grid_midi
from timing import timed_call
from piano_score import estimate_piano_grid, write_piano_score
from transcribe_track import load_note_model, piano_midi_events, run, write_midi

DEFAULT = "arrangement"
EXPORTS = {
    "yourmt3": ("pianoyourxml", "pianoyourmid"),
    "playable": ("pianoeasyxml", "pianoeasymid"),
    "basic": ("pianobasicxml", "pianobasicmid"),
    "reduction": ("pianoredxml", "pianoredmid"),
    "arrangement": ("pianoarrxml", "pianoarrmid"),
    "solo": ("pianosoloxml", "pianosolomid"),
}
VOCAL_PROGRAM = 100  # YourMT3+ writes the singing voice on this program.


def reduce_notes(notes):
    groups = []
    for note in notes:
        if not groups or note["start"] - groups[-1][0]["start"] > .045:
            groups.append([])
        groups[-1].append(note)
    reduced = []
    for group in groups:
        by_pitch = {}
        for note in sorted(group, key=lambda item: item["velocity"]):
            by_pitch[note["pitch"]] = note
        pitches = sorted(by_pitch)
        top = pitches[-1]
        upper = [pitch for pitch in pitches if pitch >= max(55, top - 12)][-3:]
        bass = pitches[:1] if pitches[0] < 60 else []
        reduced.extend(by_pitch[pitch] for pitch in set([top, *upper, *bass]))
    return sorted(reduced, key=lambda note: (note["start"], note["pitch"]))


def thin_hands(notes, *, right_max=4, left_max=3):
    """Keep every attack within reach of two hands (an octave and a bit each, a few
    notes per hand) and drop faint ghost notes."""
    from evaluate_piano_options import hand_split

    kept, groups = [], []
    for note in sorted(notes, key=lambda item: (item["start"], item["pitch"])):
        if note["end"] - note["start"] < .07 and note["velocity"] < 40:
            continue
        if groups and note["start"] - groups[-1][0]["start"] <= .04:
            groups[-1].append(note)
        else:
            groups.append([note])
    for group in groups:
        group.sort(key=lambda note: note["pitch"])
        left, right, comfortable = hand_split([note["pitch"] for note in group])
        if comfortable:
            kept.extend(group)
            continue
        # Too wide or too many: keep the melody side (top) and the bass side (bottom).
        top = group[-1]["pitch"]
        upper = [note for note in reversed(group) if top - note["pitch"] <= 12][:right_max]
        rest = [note for note in group if note not in upper]
        lower = [note for note in rest if note["pitch"] - rest[0]["pitch"] <= 14][:left_max] if rest else []
        kept.extend(upper + lower)
    return sorted(kept, key=lambda note: (note["start"], note["pitch"]))


def split_tracks(midi, duration):
    """YourMT3+ output -> (vocal melody notes, instrument notes, share of piano notes)."""
    vocal, other, piano = [], [], 0
    for track in midi.instruments:
        if track.is_drum:
            continue
        for note in track.notes:
            if not (21 <= note.pitch <= 108 and 0 <= note.start < min(note.end, duration)):
                continue
            event = {"pitch": int(note.pitch), "start": float(note.start),
                     "end": float(min(note.end, duration)), "velocity": int(note.velocity)}
            if track.program == VOCAL_PROGRAM:
                vocal.append(event)
            else:
                other.append(event)
                piano += track.program <= 7
    return monophonic(vocal) if len(vocal) >= 4 else [], other, piano / max(1, len(other))


def write_version(notes, directory, key, title, grid, quantized=False):
    xml, midi = directory / (key + ".musicxml"), directory / (key + ".mid")
    if grid is None:
        bpm, beats = estimate_piano_grid(notes, 120)
        write_midi(notes, midi, 0, "piano", bpm, beats=beats)
        write_piano_score(notes, xml, title, bpm, beats)
        return xml, midi, len(notes)
    placed = notes if quantized else quantize(notes, grid)
    if not placed:
        raise ValueError("Aucune note sur la grille.")
    _, pickup = grid.layout()
    write_grid_midi(placed, midi, grid)
    write_piano_score(score_times(placed, grid.bpm), xml, title, grid.bpm, grid.per_bar, pickup=pickup,
                      simplify=True)
    return xml, midi, len(placed)


def generate(audio, directory, title, report, piano_engine, *, vocals=None, solo_engine=None,
             wait_vocals=None, judge=True):
    """Return (duration, {key: (xml, midi, note_count)}, recommendation or None)."""
    duration = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(audio)], timeout=15))
    if not math.isfinite(duration) or duration < .5:
        raise ValueError("L’audio doit durer au moins 0,5 seconde.")
    report("detect")
    raw, prepared, references = {}, {}, {}
    melody, instruments, piano_share = [], [], 0.0

    def basic_pitch():
        from basic_pitch.inference import predict

        _, midi, _ = predict(audio, load_note_model())
        return piano_midi_events(midi, duration)

    with ThreadPoolExecutor(max_workers=3) as pool:
        beats = pool.submit(timed_call("grille rythmique (beat_this)", track_beats), audio)
        # Basic Pitch is cheap: it is always computed, as a fallback or as a second
        # opinion for the judge's consensus of transcription models.
        basic = pool.submit(timed_call("Basic Pitch piano", basic_pitch))
        # Transkun starts with YourMT3+ instead of after it; its notes are only kept when the
        # recording is mostly piano (decided from YourMT3+ below), as before.
        solo = None
        if solo_engine is not None:
            solo = pool.submit(timed_call("Transkun", solo_engine.transcribe), audio, directory / "transkun.mid")
        if piano_engine is not None:
            try:
                original = timed_call("YourMT3+ piano", piano_engine.transcribe)(audio, directory / "yourmt3-native.mid")
                melody, instruments, piano_share = split_tracks(original, duration)
                references["yourmt3"] = piano_midi_events(original, duration)
                raw["yourmt3"] = thin_hands(references["yourmt3"])
            except Exception as error:
                print(f"YourMT3+ indisponible : {error}", flush=True)
        if solo is not None and piano_engine is not None and piano_share < .5:
            solo = None  # not a piano recording: Transkun's notes are not used
        try:
            references["basic"] = basic.result()
        except Exception as error:
            print(f"Basic Pitch indisponible : {error}", flush=True)
        if not raw and references.get("basic"):
            raw["basic"] = references["basic"]
            raw["reduction"] = reduce_notes(raw["basic"])
            instruments = raw["basic"]
        if solo is not None:
            try:
                references["solo"] = raw["solo"] = piano_midi_events(solo.result(), duration)
            except Exception as error:
                print(f"Transkun indisponible : {error}", flush=True)
        try:
            grid = beats.result()
        except Exception as error:
            print(f"Grille rythmique indisponible : {error}", flush=True)
            grid = None

    report("arrange")
    if grid is not None and (instruments or melody):
        harmony = raw.get("solo") if piano_share >= .5 and raw.get("solo") else instruments
        for key, level in (("arrangement", "full"), ("playable", "easy")):
            try:
                notes, _ = timed_call(f"arrangement {key}", arrange)(melody, harmony, grid, duration, level)
                if notes:
                    prepared[key] = notes
            except Exception as error:
                print(f"Arrangement piano {key} indisponible : {error}", flush=True)
    files = {}
    for key, notes in [*prepared.items(), *raw.items()]:
        if not notes:
            continue
        try:
            files[key] = timed_call(f"partition {key}", write_version)(notes, directory, key, title, grid,
                                                                     quantized=key in prepared)
        except Exception as error:
            print(f"Partition piano {key} indisponible : {error}", flush=True)
    if not files:
        raise ValueError("Aucune note exploitable. Essaie un audio plus clair.")

    if wait_vocals is not None:
        timed_call("attente voix (Demucs)", wait_vocals)()
    recommendation = None
    if judge and len(files) >= 2:
        report("judge")
        try:
            from evaluate_piano_options import recommend

            recommendation = timed_call("juge piano", recommend)(audio, {key: values[1] for key, values in files.items()}, vocals,
                                       has_voice=bool(melody), references=references)
        except Exception as error:
            print(f"Comparaison audio piano indisponible : {error}", flush=True)
    return duration, files, recommendation

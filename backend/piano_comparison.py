"""Generate SongToSheet's piano variants from a common preview."""
import math

from piano_score import estimate_piano_grid, write_piano_score
from piano_playable import arrange
from transcribe_track import load_note_model, piano_midi_events, run, write_midi

DEFAULT = "yourmt3"
EXPORTS = {
    "yourmt3": ("pianoyourxml", "pianoyourmid"),
    "playable": ("pianoeasyxml", "pianoeasymid"),
    "basic": ("pianobasicxml", "pianobasicmid"),
    "reduction": ("pianoredxml", "pianoredmid"),
}


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


def generate(audio, directory, title, report, piano_engine):
    from basic_pitch.inference import predict

    duration = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(audio)], timeout=15))
    if not math.isfinite(duration) or duration < .5:
        raise ValueError("L’audio doit durer au moins 0,5 seconde.")
    report("detect")
    versions = {}
    try:
        original = piano_engine.transcribe(audio, directory / "yourmt3-native.mid")
        versions["yourmt3"] = piano_midi_events(original, duration)
    except Exception as error:
        print(f"YourMT3+ indisponible : {error}", flush=True)
    if versions.get("yourmt3"):
        try:
            bpm, _ = estimate_piano_grid(versions["yourmt3"], 120)
            versions["playable"] = arrange(original, duration, bpm)
        except Exception as error:
            print(f"Arrangement piano simplifié indisponible : {error}", flush=True)
    try:
        _, midi, _ = predict(audio, load_note_model())
        versions["basic"] = piano_midi_events(midi, duration)
        versions["reduction"] = reduce_notes(versions["basic"])
    except Exception as error:
        print(f"Basic Pitch indisponible : {error}", flush=True)

    report("arrange")
    files = {}
    for key, notes in versions.items():
        if not notes:
            continue
        try:
            bpm, beats = estimate_piano_grid(notes, 120)
            xml, midi = directory / (key + ".musicxml"), directory / (key + ".mid")
            write_midi(notes, midi, 0, "piano", bpm, beats=beats)
            write_piano_score(notes, xml, title, bpm, beats)
            files[key] = (xml, midi, len(notes))
        except Exception as error:
            print(f"Partition piano {key} indisponible : {error}", flush=True)
    if not files:
        raise ValueError("Aucune note exploitable. Essaie un audio plus clair.")

    recommendation = None
    if len(files) >= 2:
        report("judge")
        try:
            from evaluate_piano_options import recommend

            recommendation = recommend(audio, {key: values[1] for key, values in files.items()})
        except Exception as error:
            print(f"Comparaison audio piano indisponible : {error}", flush=True)
    return duration, files, recommendation

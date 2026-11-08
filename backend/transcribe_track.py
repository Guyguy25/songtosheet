"""Local audio-to-score prototype for files the operator is allowed to transcribe."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree as ET


TRACKS = {
    "voix": ("vocals", 53),
    "basse": ("bass", 33),
    "guitare": ("guitar", 24),
    "piano": ("piano", 0),
}
TUNINGS = {"guitare": (64, 59, 55, 50, 45, 40), "basse": (43, 38, 33, 28)}
NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
AUDIO_FORMATS = {".wav": "wav", ".mp3": "mp3", ".m4a": "mov", ".flac": "flac", ".ogg": "ogg", ".aac": "aac"}


def run(command, timeout):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise ValueError(f"{Path(command[0]).name} a échoué : {result.stderr.strip()[-1500:]}")
    return result.stdout.strip()


def write_score(midi_path, destination, title, *, guitar=False):
    from music21 import clef, converter, metadata

    score = converter.parse(midi_path, quarterLengthDivisors=(4, 3))
    score.metadata = metadata.Metadata(title=title)
    if guitar:
        for part in score.parts:
            for existing in list(part.recurse().getElementsByClass(clef.Clef)):
                existing.activeSite.remove(existing)
            part.getElementsByClass("Measure").first().insert(0, clef.Treble8vbClef())
    score.write("musicxml", fp=destination)


def tab_position(pitch, tuning, previous_fret):
    positions = [
        (string, pitch - open_pitch)
        for string, open_pitch in enumerate(tuning, 1)
        if 0 <= pitch - open_pitch <= 24
    ]
    return min(positions, key=lambda pair: (abs(pair[1] - previous_fret), pair[1]))


def write_tab(score_path, destination, tuning):
    tree = ET.parse(score_path)
    part = tree.find("part")
    attributes = part.find("measure/attributes")
    clef = attributes.find("clef")
    clef.clear()
    ET.SubElement(clef, "sign").text = "TAB"
    ET.SubElement(clef, "line").text = str(len(tuning) // 2)
    staff = ET.SubElement(attributes, "staff-details")
    ET.SubElement(staff, "staff-lines").text = str(len(tuning))
    for line, pitch in enumerate(reversed(tuning), 1):
        name = NOTE_NAMES[pitch % 12]
        row = ET.SubElement(staff, "staff-tuning", line=str(line))
        ET.SubElement(row, "tuning-step").text = name[0]
        if name.endswith("#"):
            ET.SubElement(row, "tuning-alter").text = "1"
        ET.SubElement(row, "tuning-octave").text = str(pitch // 12 - 1)
    fret = 0
    for note in part.findall("measure/note"):
        pitch = note.find("pitch")
        if pitch is None:
            continue
        octave = int(pitch.findtext("octave"))
        step = NOTE_NAMES.index(pitch.findtext("step"))
        midi = (octave + 1) * 12 + step + int(float(pitch.findtext("alter", "0")))
        string, fret = tab_position(midi, tuning, fret)
        notations = note.find("notations")
        if notations is None:
            notations = ET.SubElement(note, "notations")
        technical = ET.SubElement(notations, "technical")
        ET.SubElement(technical, "string").text = str(string)
        ET.SubElement(technical, "fret").text = str(fret)
    tree.write(destination, encoding="utf-8", xml_declaration=True)


def tab_melody(notes, tuning):
    # One playable line. Keep the full polyphonic result in score.musicxml.
    candidates = [n for n in notes if tuning[-1] <= n["pitch"] <= tuning[0] + 24]
    end = 0
    for note in sorted(candidates, key=lambda n: (n["start"], -n["velocity"])):
        if note["start"] >= end:
            yield note
            end = note["end"]


def write_midi(notes, destination, program, instrument, bpm):
    from pretty_midi import Instrument, Note, PrettyMIDI

    midi = PrettyMIDI(initial_tempo=bpm)
    track = Instrument(program, name=instrument.capitalize())
    track.notes.extend(Note(**note) for note in notes)
    midi.instruments.append(track)
    midi.write(str(destination))


def transcribe(source, instrument, output, *, isolated=False, bpm=120, title=None):
    source = source.resolve(strict=True)
    audio_format = AUDIO_FORMATS.get(source.suffix.lower())
    if not source.is_file() or not audio_format:
        raise ValueError("Choisis un fichier local WAV, MP3, M4A, FLAC, OGG ou AAC.")
    input_options = ["-protocol_whitelist", "file", "-f", audio_format, "-i", str(source)]
    duration = float(run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", *input_options,
    ], timeout=20))
    if not math.isfinite(duration) or not 0.5 <= duration <= 360:
        raise ValueError("L’audio doit durer entre 0,5 seconde et 6 minutes.")

    stem, program = TRACKS[instrument]
    separator = "htdemucs_6s" if stem in ("guitar", "piano") else "htdemucs"
    config = {"engine": "basic-pitch-0.4.0", "separator": None if isolated else f"demucs-4.1.0:{separator}",
              "instrument": instrument, "bpm": bpm, "version": 2 if instrument == "guitare" else 1}
    if title:
        config["title"] = title
    with source.open("rb") as audio:
        audio_hash = hashlib.file_digest(audio, "sha256").hexdigest()
    key = hashlib.sha256(f"{audio_hash}:{json.dumps(config, sort_keys=True)}".encode()).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    target = output / key
    if (target / "notes.json").is_file():
        return target

    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import predict

    with tempfile.TemporaryDirectory(dir=output) as temporary:
        work = Path(temporary)
        wav = work / "input.wav"
        run(["ffmpeg", "-nostdin", "-v", "error", *input_options, "-map", "0:a:0",
             "-t", "360", "-ar", "44100", "-ac", "2", str(wav)], timeout=90)
        if not isolated:
            run([sys.executable, "-m", "demucs", "-n", separator, "-o", str(work),
                 "--shifts", "0", str(wav)], timeout=900)
            wav = work / separator / "input" / f"{stem}.wav"

        model = build_icassp_2022_model_path(FilenameSuffix.onnx)
        _, midi, _ = predict(wav, model)
        notes = sorted([
            {"pitch": int(note.pitch), "start": float(note.start), "end": float(note.end),
             "velocity": int(note.velocity)}
            for track in midi.instruments for note in track.notes
            if note.start < note.end
        ], key=lambda note: (note["start"], note["pitch"]))
        if instrument == "guitare":
            tuning = TUNINGS[instrument]
            notes = [note for note in notes if tuning[-1] <= note["pitch"] <= tuning[0] + 24]
        if not notes:
            raise ValueError("Aucune note exploitable. Essaie une piste plus claire ou un autre instrument.")

        result = work / "result"
        result.mkdir()
        write_midi(notes, result / "score.mid", program, instrument, bpm)
        write_score(result / "score.mid", result / "score.musicxml", title or source.stem, guitar=instrument == "guitare")
        tuning = TUNINGS.get(instrument)
        melody = list(tab_melody(notes, tuning)) if tuning else []
        if melody:
            write_midi(melody, work / "tab.mid", program, instrument, bpm)
            write_score(work / "tab.mid", work / "tab.musicxml", title or source.stem)
            write_tab(work / "tab.musicxml", result / "tab.musicxml", tuning)
        manifest = {**config, "notes": notes, "duration": duration, "tab": bool(melody)}
        (result / "notes.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        try:
            result.rename(target)
        except OSError:
            if not (target / "notes.json").is_file():
                raise
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    parser.add_argument("instrument", choices=TRACKS)
    parser.add_argument("output", type=Path, help="Dossier privé où conserver les exports")
    parser.add_argument("--isolated", action="store_true", help="Le fichier contient déjà la piste voulue")
    parser.add_argument("--bpm", type=int, default=120, help="Tempo indicatif pour la notation")
    parser.add_argument("--authorized", action="store_true", required=True,
                        help="Je dispose des droits nécessaires à cette transcription")
    args = parser.parse_args()
    if not 30 <= args.bpm <= 300:
        parser.error("Le tempo doit être compris entre 30 et 300 BPM.")
    try:
        print(transcribe(args.audio, args.instrument, args.output, isolated=args.isolated, bpm=args.bpm))
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()

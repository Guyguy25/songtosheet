"""Local audio-to-score prototype for files the operator is allowed to transcribe."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
import tempfile
from bisect import bisect_left
from collections import Counter, defaultdict
from functools import lru_cache
from itertools import takewhile
from pathlib import Path

from guitar_tab import arrange, arrange_with_capo, attack_groups, group_for_notation, midi_notes, write_tab
from guitar_harmony import chord_changes, clean_arpeggio, onset_strengths, tab_chord_changes
from guitar_evidence import (
    audible_slides, descending_slides, guitar_evidence, mixed_attacks, mixed_guitar_tempo,
    refine_mixed_guitar, refine_picked_notes,
)
from guitar_intro import open_pull_offs, repeated_open_intro
from piano_score import clean_piano_notes, estimate_piano_grid, write_piano_score
from tsumugi_engine import ENGINE as TSUMUGI_ENGINE, Tsumugi


TRACKS = {
    "voix": ("vocals", 53),
    "basse": ("bass", 33),
    "guitare": ("guitar", 24),
    "piano": ("piano", 0),
}
TUNINGS = {"guitare": (64, 59, 55, 50, 45, 40), "basse": (43, 38, 33, 28)}
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


@lru_cache(maxsize=1)
def load_note_model():
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model

    return Model(build_icassp_2022_model_path(FilenameSuffix.onnx))


def guitar_attacks(path):
    import librosa

    audio, rate = librosa.load(path, sr=22050, mono=True)
    hop = 220
    envelope = librosa.onset.onset_strength(y=audio, sr=rate, hop_length=hop)
    frames = librosa.onset.onset_detect(onset_envelope=envelope, sr=rate, hop_length=hop)
    levels = [float(envelope[max(0, frame - 3):frame + 4].max()) for frame in frames]
    return librosa.frames_to_time(frames, sr=rate, hop_length=hop).tolist(), levels


def near_attack(time, transients, tolerance):
    index = bisect_left(transients, time - tolerance)
    return index < len(transients) and transients[index] <= time + tolerance


def filter_guitar_echoes(notes, transients):
    """Remove weak, brief upper harmonics that start after a supported note."""
    if not transients:
        return notes
    by_pitch = defaultdict(list)
    kept = []
    for note in notes:
        start = note["start"]
        echo = (
            note["end"] - start <= .20
            and not near_attack(start, transients, .045)
            and any(
                lower["end"] >= note["end"]
                and note["velocity"] <= lower["velocity"] * .5
                and near_attack(lower["start"], transients, .035)
                for harmonic in (12, 19, 24)
                for lower in takewhile(lambda earlier: start - earlier["start"] <= .12,
                                       reversed(by_pitch[note["pitch"] - harmonic]))
                if start - lower["start"] >= .025
            )
        )
        if not echo:
            by_pitch[note["pitch"]].append(note)
            kept.append(note)
    return kept


def guitar_lead(notes):
    """Recognize a single-line lead, allowing only weak octave doubles."""
    groups = attack_groups(notes, lambda note: note["start"])
    single_pitches = Counter(group[0]["pitch"] for group in groups if len(group) == 1)
    doubles = [group for group in groups if len(group) > 1]
    if doubles and (len(groups) < 8 or len(doubles) * 5 > len(groups)):
        return None
    for group in doubles:
        if len(group) != 2:
            return None
        low, high = sorted(group, key=lambda note: note["pitch"])
        if (high["pitch"] - low["pitch"] != 12 or high["velocity"] > .62 * low["velocity"]
                or high["end"] > low["end"] + .025 or single_pitches[low["pitch"]] < 2
                or single_pitches[high["pitch"]]):
            return None
    lead = [min(group, key=lambda note: note["pitch"]) for group in groups]
    if any(left["end"] - right["start"] > .08 for left, right in zip(lead, lead[1:])):
        return None
    return lead


def recover_lead_notes(lead, model):
    """Restore short model detections when the same five-note figure recurs."""
    if len(lead) < 10:
        return lead
    from basic_pitch.note_creation import model_output_to_notes

    _, candidates = model_output_to_notes(
        model, onset_thresh=.5, frame_thresh=.3, min_note_len=8, min_freq=None, max_freq=None,
        multiple_pitch_bends=False, melodia_trick=False,
    )
    starts = [note["start"] for note in lead]
    pitches = [note["pitch"] for note in lead]
    motifs = Counter(tuple(pitches[i:i + 5]) for i in range(len(pitches) - 4))
    additions = {}
    for start, end, pitch, amplitude, _ in candidates:
        if not .075 <= end - start < .125 or amplitude < .34:
            continue
        index = bisect_left(starts, start)
        if not 2 <= index <= len(lead) - 2:
            continue
        if (min(start - starts[index - 1], starts[index] - start) < .055
                or lead[index - 1]["end"] - start > .08 or end - starts[index] > .035):
            continue
        motif = tuple(pitches[index - 2:index] + [pitch] + pitches[index:index + 2])
        if motifs[motif] >= 2 and (index not in additions or amplitude * 127 > additions[index]["velocity"]):
            additions[index] = {"pitch": int(pitch), "start": float(start), "end": float(end),
                                "velocity": round(float(amplitude) * 127)}
    return sorted(lead + list(additions.values()), key=lambda note: note["start"])


def guitar_diagnostic(notes, tab, transients, filtered):
    score_attacks = attack_groups(notes, lambda note: note["start"])
    starts = [group[0]["start"] for group in score_attacks]
    unconfirmed = [time for time in starts if not near_attack(time, transients, .095)] if transients else []
    tab_attacks = group_for_notation(tab, transients)
    return {
        "total_attacks": len(starts),
        "matched_attacks": len(starts) - len(unconfirmed) if transients else None,
        "review_seconds": list(dict.fromkeys(int(time) for time in unconfirmed))[:5],
        "filtered_notes": filtered,
        "tab_notes": len(tab),
        "tab_chords": sum(len(group) > 1 for _, group, _ in tab_attacks),
    }


def write_midi(notes, destination, program, instrument, bpm, *, beats=None, beat_type=4):
    from pretty_midi import Instrument, Note, PrettyMIDI, TimeSignature

    midi = PrettyMIDI(initial_tempo=bpm)
    if beats is not None:
        midi.time_signature_changes.append(TimeSignature(beats, beat_type, 0))
    track = Instrument(program, name=instrument.capitalize())
    track.notes.extend(Note(**note) for note in notes)
    midi.instruments.append(track)
    midi.write(str(destination))


def midi_events(midi, duration, *, guitar_only=False):
    return sorted([
        {"pitch": note.pitch, "start": note.start, "end": min(note.end, duration),
         "velocity": note.velocity}
        for track in midi.instruments
        if not track.is_drum and (not guitar_only or 24 <= track.program <= 31)
        for note in track.notes
        if 0 <= note.start < min(note.end, duration)
    ], key=lambda note: (note["start"], note["pitch"]))


def transcribe(source, instrument, output, *, isolated=False, bpm=120, title=None, capo=0, progress=None,
               review_audio=None, guitar_engine=None, guitar_solo=False, has_voice=True, solo_engine=None,
               on_direct=None):
    if (capo != "auto" and (type(capo) is not int or not 0 <= capo <= 12)) or (capo and instrument != "guitare"):
        raise ValueError("Le capo est disponible pour la guitare uniquement, en mode automatique ou avec une case de 0 à 12.")
    source = source.resolve(strict=True)
    audio_format = AUDIO_FORMATS.get(source.suffix.lower())
    if not source.is_file() or not audio_format:
        raise ValueError("Choisis un fichier local WAV, MP3, M4A, FLAC, OGG ou AAC.")
    report = progress or (lambda stage: None)
    report("decode")
    input_options = ["-protocol_whitelist", "file", "-f", audio_format, "-i", str(source)]
    duration = float(run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", *input_options,
    ], timeout=20))
    if not math.isfinite(duration) or duration < 0.5:
        raise ValueError("L’audio doit durer au moins 0,5 seconde.")
    # Bound decoded stereo PCM and the separator's working set even for highly compressed inputs.
    max_pcm_bytes = 256 * 1024**2
    capacity_error = "L’audio dépasse la capacité de traitement. Essaie un extrait plus court."
    if duration * 44100 * 2 * 2 > max_pcm_bytes:
        raise ValueError(capacity_error)

    stem, program = TRACKS[instrument]
    separator = "htdemucs_6s" if stem in ("guitar", "piano") else "htdemucs"
    guitar_engine = guitar_engine if instrument == "guitare" else None
    guitar_solo = guitar_solo and instrument == "guitare"
    config = {"engine": TSUMUGI_ENGINE if guitar_engine else "basic-pitch-0.4.0",
              "separator": None if isolated else f"demucs-4.1.0:{separator}",
              "instrument": instrument, "bpm": bpm,
              "version": {"guitare": 15 if isolated else 16, "basse": 4, "piano": 3}.get(instrument, 1)}
    if guitar_solo:
        if solo_engine:
            from guitararranger_engine import ENGINE as solo_engine_id
        else:
            solo_engine_id = "mix-melody-v1"
        config["solo"] = {"version": 8, "voice": has_voice and not isolated, "engine": solo_engine_id}
    if capo:
        config["capo"] = capo
    if title:
        config["title"] = title
    with source.open("rb") as audio:
        audio_hash = hashlib.file_digest(audio, "sha256").hexdigest()
    key = hashlib.sha256(f"{audio_hash}:{json.dumps(config, sort_keys=True)}".encode()).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    target = output / key
    cached = (target / "notes.json").is_file()
    if cached and (isolated or review_audio is None):
        report("cached")
        if on_direct:
            on_direct(target, json.loads((target / "notes.json").read_text(encoding="utf-8")))
        return target

    if not guitar_engine or (guitar_solo and has_voice and not isolated):
        from basic_pitch.inference import predict

    with tempfile.TemporaryDirectory(dir=output) as temporary:
        work = Path(temporary)
        original = wav = work / "input.wav"
        run(["ffmpeg", "-nostdin", "-v", "error", *input_options, "-map", "0:a:0",
             "-ar", "44100", "-ac", "2", "-fs", str(max_pcm_bytes), str(wav)], timeout=90)
        if wav.stat().st_size >= max_pcm_bytes:
            raise ValueError(capacity_error)
        if not isolated:
            report("isolate")
            run([sys.executable, "-m", "demucs", "-n", separator, "-o", str(work),
                 "--shifts", "0", str(wav)], timeout=900)
            wav = work / separator / "input" / f"{stem}.wav"
            if review_audio is not None:
                review_audio(original, wav.parent)
        if cached:
            report("cached")
            if on_direct:
                on_direct(target, json.loads((target / "notes.json").read_text(encoding="utf-8")))
            return target

        report("detect")
        if guitar_engine:
            midi = guitar_engine.transcribe(wav, work / "guitar.mid")
            notes = midi_events(midi, duration, guitar_only=True)
        else:
            model, midi, _ = predict(wav, load_note_model())
            notes = midi_events(midi, math.inf)
        transients = ()
        filtered = 0
        simple = False
        chords = []
        tab_meter = (4, 4)
        intro_count = 0
        pull_offs = []
        slides = []
        string_hints = {}
        strokes = None
        open_intro = None
        if instrument == "guitare":
            tuning = TUNINGS[instrument]
            notes = [note for note in notes if tuning[-1] <= note["pitch"] <= tuning[0] + 24]
            transients, attack_levels = guitar_attacks(wav)
            if not guitar_engine:
                clean = filter_guitar_echoes(notes, transients)
                filtered = len(notes) - len(clean)
                notes = clean
            if guitar_engine:
                if bpm == 120 and not isolated:
                    bpm = mixed_guitar_tempo(wav.with_name("drums.wav"), bpm)
            elif isolated and (lead := guitar_lead(notes)):
                filtered += len(notes) - len(lead)
                notes = recover_lead_notes(lead, model)
                simple = True
            elif isolated:
                strengths = onset_strengths(model, notes)
                chords = chord_changes(notes, strengths)
                open_tuning = tuple(pitch + capo for pitch in tuning) if type(capo) is int else ()
                open_intro = repeated_open_intro(notes, strengths, transients, set(open_tuning)) if open_tuning else None
                if open_intro:
                    clean, intro, cutoff, pulse, cycle, count = open_intro
                    tail = clean[count:]
                    evidence = guitar_evidence(wav, tail, transients, tuning) if capo == 0 and tail else {}
                    techniques, echoes = open_pull_offs(tail, strengths, transients, attack_levels, cutoff, pulse,
                                                        open_tuning, evidence=evidence)
                    protected = {id(note) for first, second, _ in techniques for note in (first, second)}
                    tail = [note for note in tail if id(note) not in echoes or id(note) in protected]
                    refined, hints = refine_picked_notes(tail, strengths, evidence, protected)
                    glides = descending_slides(wav, refined, evidence, tuning, dict(zip(transients, attack_levels)),
                                               protected) if evidence else []
                    clean = clean[:count] + refined
                    filtered += len(notes) - len(clean)
                    notes = [{**note, "start": note["start"] - intro, "end": note["end"] - intro} for note in clean]
                    string_hints = {(start - intro, pitch): string for (start, pitch), string in hints.items()}
                    for events, destination in ((techniques, pull_offs), (glides, slides)):
                        for before, after, string in events:
                            pair = tuple((note["start"] - intro, note["pitch"]) for note in (before, after))
                            destination.append(pair)
                            string_hints.update(dict.fromkeys(pair, string))
                    transients = [max(0., time - intro) for time in transients if time >= intro - .12]
                    chords = [(max(0., time - intro), root, kind) for time, root, kind in chords if time >= intro - .12]
                    if cycle == 6:
                        tab_meter = (6, 8)
                        bpm = round(30 / pulse)
                        intro_count = count
                elif len(chords) >= 2:
                    clean = clean_arpeggio(notes, strengths)
                    filtered += len(notes) - len(clean)
                    notes = clean
            elif notes:
                strengths = onset_strengths(model, notes)
                clean, string_hints, evidence = refine_mixed_guitar(wav, notes, transients, tuning, strengths)
                filtered += len(notes) - len(clean)
                notes = clean
                strokes = mixed_attacks(notes, strengths, evidence)
                if bpm == 120:
                    bpm = mixed_guitar_tempo(wav.with_name("drums.wav"), bpm)
        if not notes:
            raise ValueError("Aucune note exploitable. Essaie une piste plus claire ou un autre instrument.")

        report("arrange")
        result = work / "result"
        result.mkdir()
        score_title = title or source.stem
        if instrument == "piano":
            if isolated:
                notes = clean_piano_notes(notes, onset_strengths(model, notes))
            detected_bpm, beats = estimate_piano_grid(notes, bpm)
            intro = notes[0]["start"]
            notes = [{**note, "start": note["start"] - intro, "end": note["end"] - intro} for note in notes]
            write_midi(notes, result / "score.mid", program, instrument, detected_bpm, beats=beats)
            write_piano_score(notes, result / "score.musicxml", score_title, detected_bpm, beats)
        else:
            write_midi(notes, result / "score.mid", program, instrument, bpm,
                       beats=tab_meter[0] if tab_meter != (4, 4) else None, beat_type=tab_meter[1])
            write_score(result / "score.mid", result / "score.musicxml", score_title, guitar=instrument == "guitare")
        tuning = TUNINGS.get(instrument)
        if capo == "auto":
            resolved_capo, tab = arrange_with_capo(notes, tuning, simple=simple, strokes=strokes)
        else:
            resolved_capo = capo
            tab = arrange(notes, tuning, capo=capo, simple=simple, string_hints=string_hints,
                          strokes=strokes) if tuning else []
        if tab:
            strummed = set()
            if strokes is not None:
                attacks = {(note.start, note.pitch) for note in tab}
                strummed = {group[0]["start"] for group in strokes
                            if len(group) >= 3 and group[-1]["start"] - group[0]["start"] > .03
                            and all((group[0]["start"], note["pitch"]) in attacks for note in group)}
            if instrument == "guitare" and not simple and not open_intro:
                slides = audible_slides(wav, tab, dict(zip(transients, attack_levels)))
            if instrument == "guitare" and not chords and not simple:
                chords = tab_chord_changes(tab, transients)
            write_midi(midi_notes(tab), result / "tab.mid", program, instrument, bpm,
                       beats=tab_meter[0] if tab_meter != (4, 4) else None, beat_type=tab_meter[1])
            write_tab(tab, result / "tab.musicxml", tuning, bpm, title or source.stem, instrument,
                      transients=transients, capo=resolved_capo, chords=chords, meter=tab_meter,
                      intro_count=intro_count, pull_offs=pull_offs, slides=slides, strummed=strummed)
        manifest = {**config, "notes": notes, "duration": duration, "tab": bool(tab)}
        if instrument == "piano":
            manifest.update(bpm=detected_bpm, meter=f"{beats}/4", intro=intro)
        if capo == "auto":
            manifest["resolved_capo"] = resolved_capo
        if instrument == "guitare":
            manifest.update(bpm=bpm, meter=f"{tab_meter[0]}/{tab_meter[1]}")
            manifest["diagnostic"] = guitar_diagnostic(notes, tab, transients, filtered)
        if on_direct:
            on_direct(result, manifest)
        vocals = []
        if guitar_solo and has_voice and not isolated:
            try:
                _, voice, _ = predict(wav.with_name("vocals.wav"), load_note_model(),
                                      minimum_frequency=100, maximum_frequency=1000)
                vocals = midi_events(voice, duration)
            except Exception as error:
                print(f"Mélodie vocale indisponible : {error}", file=sys.stderr, flush=True)
        offer_solo = guitar_solo
        if offer_solo and solo_engine and tab:
            from guitar_solo import vocal_melody
            from solo_quality import has_complete_opening

            offer_solo = not has_complete_opening(notes, vocal_melody(vocals))
        if offer_solo:
            from guitar_solo import write_solo

            mix_notes, mix_attacks = [], []
            if guitar_engine and not isolated:
                try:
                    mix = guitar_engine.transcribe(original, work / "mix-guitar.mid")
                    mix_notes = midi_events(mix, duration, guitar_only=True)
                    mix_attacks, _ = guitar_attacks(original)
                except (ValueError, OSError, subprocess.TimeoutExpired) as error:
                    print(f"Relevé guitare du mix indisponible : {error}", file=sys.stderr, flush=True)
            try:
                solo_result = work / "solo"
                arrange_solo = solo_engine.write if solo_engine else write_solo
                if arrange_solo(original, None if isolated else wav.with_name("bass.wav"), notes, vocals,
                              duration, solo_result, f"{score_title} – Guitare solo",
                              bpm, tab_meter, resolved_capo, mix=mix_notes, mix_attacks=mix_attacks):
                    solo_result.rename(result / "solo")
                    manifest["solo_engine"] = config["solo"]["engine"]
            except Exception as error:
                print(f"Arrangement solo indisponible : {error}", file=sys.stderr, flush=True)
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
    parser.add_argument("--capo", type=int, default=0, help="Case du capo pour une tablature de guitare")
    parser.add_argument("--authorized", action="store_true", required=True,
                        help="Je dispose des droits nécessaires à cette transcription")
    args = parser.parse_args()
    if not 30 <= args.bpm <= 300:
        parser.error("Le tempo doit être compris entre 30 et 300 BPM.")
    try:
        print(transcribe(args.audio, args.instrument, args.output, isolated=args.isolated, bpm=args.bpm,
                         capo=args.capo, guitar_engine=Tsumugi.from_env() if args.instrument == "guitare" else None,
                         guitar_solo=args.instrument == "guitare"))
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()

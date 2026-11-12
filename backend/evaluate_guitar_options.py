"""Local audit of guitar tablatures against independent evidence from the audio."""

import argparse
import json
from pathlib import Path
from xml.etree import ElementTree as ET

import librosa
import numpy as np
from pretty_midi import PrettyMIDI


TUNING = (64, 59, 55, 50, 45, 40)
STEPS = dict(zip("CDEFGAB", (0, 2, 4, 5, 7, 9, 11)))


def audio_evidence(path):
    rate, hop = 22050, 512
    signal, _ = librosa.load(path, sr=rate, mono=True)
    harmonic = librosa.effects.harmonic(signal)
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=rate, hop_length=hop).T
    energy = librosa.feature.rms(y=harmonic, hop_length=hop)[0]
    frames = min(len(chroma), len(energy))
    chroma, energy = chroma[:frames], energy[:frames]
    chroma /= np.maximum(chroma.sum(axis=1, keepdims=True), 1e-9)
    audible = energy >= max(.001, np.percentile(energy, 90) * .08)
    return chroma, audible, hop / rate


def attack_alignment(audio, notes):
    from bisect import bisect_left
    from transcribe_track import guitar_attacks

    reference, _ = guitar_attacks(audio)
    starts = []
    for note in sorted(notes, key=lambda item: item.start):
        if not starts or note.start - starts[-1] > .045:
            starts.append(note.start)
    matched = 0
    cursor = 0
    for time in starts:
        cursor = bisect_left(reference, time - .09, lo=cursor)
        if cursor < len(reference) and reference[cursor] <= time + .09:
            matched += 1
            cursor += 1
    return {"matched_attacks": matched, "estimated_attacks": len(starts), "detected_attacks": len(reference)}


def score_fingering(score):
    root = ET.parse(score)
    capo = int(root.findtext(".//staff-details/capo", default="0"))
    attacks = []
    for note in root.findall(".//part/measure/note"):
        if note.find("pitch") is None:
            continue
        if not attacks or note.find("chord") is None:
            attacks.append([])
        pitch = 12 * (int(note.findtext("pitch/octave")) + 1)
        pitch += STEPS[note.findtext("pitch/step")] + int(note.findtext("pitch/alter", default="0"))
        string = int(note.findtext("notations/technical/string", default="0"))
        fret = int(note.findtext("notations/technical/fret", default="-1"))
        attacks[-1].append((pitch, string, fret))
    invalid = 0
    for attack in attacks:
        strings = {string for _, string, _ in attack}
        pressed = [fret for _, _, fret in attack if fret > 0]
        if len(strings) != len(attack) or (pressed and max(pressed) - min(pressed) > 5):
            invalid += 1
        elif any(not (1 <= string <= 6 and 0 <= fret <= 24 - capo and
                       pitch == TUNING[string - 1] + capo + fret) for pitch, string, fret in attack):
            invalid += 1
    return len(attacks), invalid


def midi_support(evidence, notes):
    chroma, audible, step = evidence
    played = np.zeros(chroma.shape, dtype=bool)
    for note in notes:
        left = min(len(played), round(note.start / step))
        right = min(len(played), max(left + 1, round(note.end / step)))
        played[left:right, note.pitch % 12] = True
    used = played.any(axis=1)
    evaluated = audible & used
    if not np.any(audible) or not np.any(evaluated):
        return {"coverage": 0.0, "harmonic_support": None, "unsupported_seconds": 0.0}
    # Estimate how prominent the candidate's pitch classes are in the mix.
    # Subtract the expectation for equally many randomly chosen pitch classes.
    count = played[evaluated].sum(axis=1)
    observed = (chroma[evaluated] * played[evaluated]).sum(axis=1)
    relative = (observed - count / 12) / np.maximum(1 - count / 12, 1e-6)
    return {"coverage": round(float(evaluated.sum() / audible.sum()), 3),
            "harmonic_support": round(float(relative.mean()), 3),
            "unsupported_seconds": round(float((used & ~audible).sum() * step), 2)}


def evaluate(mix, candidates, guitar=None):
    evidence = audio_evidence(mix)
    stem = audio_evidence(guitar) if guitar else None
    report = {}
    for key, files in candidates.items():
        midi = PrettyMIDI(files["midi"])
        notes = [note for track in midi.instruments if not track.is_drum for note in track.notes]
        attacks, invalid = score_fingering(files["score"])
        row = {"notes": len(notes), "tab_attacks": attacks, "invalid_fingerings": invalid,
               "mix": midi_support(evidence, notes)}
        if key == "original" and stem is not None:
            row["guitar_stem"] = midi_support(stem, notes)
            row["guitar_stem"]["attacks"] = attack_alignment(guitar, notes)
        report[key] = row
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mix", type=Path)
    parser.add_argument("candidates", type=Path, help="JSON mapping option names to MIDI and MusicXML paths")
    parser.add_argument("--guitar", type=Path, help="Optional isolated guitar for evaluating fidelity")
    args = parser.parse_args()
    manifest = json.loads(args.candidates.read_text(encoding="utf-8"))
    print(json.dumps(evaluate(args.mix, manifest, args.guitar), indent=2))


if __name__ == "__main__":
    main()

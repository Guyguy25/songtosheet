"""Measure a transcription against a time-aligned reference MIDI."""
import argparse
import json

import mir_eval.transcription
import numpy as np
import pretty_midi


def read_notes(path):
    midi = pretty_midi.PrettyMIDI(path)
    return sorted((note for instrument in midi.instruments if not instrument.is_drum
                   for note in instrument.notes), key=lambda note: note.start)


def accuracy(reference, estimated, offset_ratio):
    def events(notes):
        intervals = np.array([(note.start, note.end) for note in notes], dtype=float).reshape(-1, 2)
        pitches = pretty_midi.note_number_to_hz(np.array([note.pitch for note in notes]))
        return intervals, pitches

    precision, recall, f1, _ = mir_eval.transcription.precision_recall_f1_overlap(
        *events(reference), *events(estimated), onset_tolerance=0.05,
        pitch_tolerance=50, offset_ratio=offset_ratio,
    )
    return {"precision": round(100 * precision, 1), "rappel": round(100 * recall, 1),
            "f1": round(100 * f1, 1)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("midi", help="Export MIDI à évaluer")
    parser.add_argument("--reference", help="MIDI corrigé et aligné sur le même audio")
    parser.add_argument("--guitare", action="store_true", help="Vérifier la tessiture standard, 24 cases")
    args = parser.parse_args()
    estimated = read_notes(args.midi)
    result = {"notes": len(estimated)}
    if args.guitare:
        outside = [note for note in estimated if not 40 <= note.pitch <= 88]
        result["hors_tessiture"] = [{"seconde": round(note.start, 3), "midi": note.pitch}
                                     for note in outside]
    if args.reference:
        reference = read_notes(args.reference)
        if not reference:
            parser.error("Le MIDI de référence ne contient aucune note.")
        result["notes_reference"] = len(reference)
        result["hauteur_et_attaque_pct"] = accuracy(reference, estimated, None)
        result["hauteur_attaque_et_duree_pct"] = accuracy(reference, estimated, .2)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

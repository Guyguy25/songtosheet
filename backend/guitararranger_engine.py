"""Run GuitarArranger's voicer and arpeggiator with SongToSheet exports."""
import os
from pathlib import Path
import sys

from guitar_solo import harmony, solo_notes
from guitar_tab import TabNote, midi_notes, write_tab


ENGINE = "guitararranger-v1"
TUNING = (64, 59, 55, 50, 45, 40)


class GuitarArranger:
    @classmethod
    def from_env(cls):
        root = os.environ.get("TRACK_GUITARARRANGER_ROOT")
        remi = os.environ.get("TRACK_REMI_ROOT")
        if not root and not remi:
            return None
        if not root or not remi:
            raise ValueError("Configure GuitarArranger et REMI-z.")
        return cls(Path(root).resolve(), Path(remi).resolve())

    def __init__(self, root, remi):
        if not (root / "voicer.py").is_file() or not (remi / "remi_z" / "__init__.py").is_file():
            raise ValueError("Les sources de GuitarArranger ou REMI-z sont introuvables.")
        sys.path[0:0] = [str(root), str(remi)]
        from arpeggiator import Arpeggiator
        from remi_z import MultiTrack, NoteSeq, ChordSeq
        from tab_util import Chart, Tab
        from voicer import Voicer

        class ChordVoicer(Voicer):
            def __init__(self):
                super().__init__()
                press = self.fretboard.press_chord

                def press_detected(chord, **options):
                    if chord in ("N", "N/A"):
                        return []
                    try:
                        return press(chord, **options)
                    except ValueError as error:
                        if "is not in list" not in str(error):
                            raise
                        # The upstream voicer can preserve the melody without
                        # an unsupported chord spelling (e.g. augmented).
                        return []

                self.fretboard.press_chord = press_detected

        class SilenceArpeggiator(Arpeggiator):
            def arpeggiate_a_bar(self, melody, charts, notes):
                if not notes.notes:
                    return Tab(n_positions=self.time_res)
                charts = list(charts)
                for index, chart in enumerate(charts):
                    if chart.string_fret_list:
                        continue
                    pitches = [note.pitch for note in notes.notes if note.onset // 24 == index]
                    pitch = min(pitches, default=40)
                    while pitch < 40:
                        pitch += 12
                    while pitch > 84:
                        pitch -= 12
                    string, fret = min(
                        ((i, pitch - opened) for i, opened in enumerate(TUNING, 1)
                         if 0 <= pitch - opened <= 20),
                        key=lambda position: (position[1], -position[0]),
                    )
                    charts[index] = Chart(string_fret_list=[(string, fret)], chord_name="")
                return super().arpeggiate_a_bar(melody, charts, notes)

        self.voicer = ChordVoicer
        self.arpeggiator = SilenceArpeggiator
        self.multitrack = MultiTrack
        self.note_seq = NoteSeq
        self.chord_seq = ChordSeq

    def write(self, audio, bass, guitar, vocals, duration, output, title, bpm, meter, capo, *,
              mix=(), mix_attacks=()):
        import random
        from pretty_midi import Instrument, Note, PrettyMIDI
        from transcribe_track import write_midi

        if not guitar:
            return False
        chords = list(harmony(audio, bass, guitar[0]["start"], duration, bpm))
        lead = solo_notes(guitar, vocals, [], bpm, capo, mix=mix, mix_attacks=mix_attacks,
                          backing="melody", phrase=True)
        if not lead:
            return False
        anchors = [dict(pitch=28 + (root - 28) % 12, start=start,
                        end=min(duration, start + 45 / bpm), velocity=60)
                   for start, root, _ in chords if start < duration]
        midi = PrettyMIDI(initial_tempo=bpm)
        for program, events in ((24, guitar), (53, lead), (33, anchors)):
            track = Instrument(program)
            for event in events:
                end = min(duration, event["end"])
                if 0 <= event["start"] < end:
                    pitch = event["pitch"] - capo
                    if program == 53:
                        while pitch < 45:
                            pitch += 12
                        while pitch > 81:
                            pitch -= 12
                    track.notes.append(Note(event["velocity"], pitch, event["start"], end))
            if track.notes:
                midi.instruments.append(track)
        prepared = output.parent / "solo-input.mid"
        midi.write(str(prepared))
        song = self.multitrack.from_midi(str(prepared))
        song.quantize_to_16th()
        melody = [self.note_seq(notes) for notes in song.get_all_notes_by_bar(of_insts=[53])]
        backing = [self.note_seq(notes) for notes in song.get_all_notes_by_bar(include_drum=False)]
        chord_bars = [self.chord_seq(bar.get_chord()) for bar in song]
        charts = self.voicer().generate_chart_sequence_for_song(melody, chord_bars)
        if not charts:
            return False
        state = random.getstate()
        try:
            random.seed(0)
            tabs = self.arpeggiator().arpeggiate_a_song(melody, charts, backing)
        finally:
            random.setstate(state)
        step = 15 / bpm
        arranged = []
        for bar, tab in enumerate(tabs.tab_list):
            for string, frets in enumerate(tab.matrix, 1):
                for slot, fret in enumerate(frets):
                    start = (16 * bar + slot) * step
                    if fret >= 0 and start < duration:
                        pitch = TUNING[string - 1] + int(fret) + capo
                        arranged.append(TabNote(pitch, start, min(duration, start + step), 90,
                                                string, int(fret), start))
        if not arranged:
            return False
        arranged.sort(key=lambda note: (note.start, note.string))
        output.mkdir()
        write_midi(midi_notes(arranged), output / "tab.mid", 24, "guitare", bpm,
                   beats=meter[0], beat_type=meter[1])
        write_tab(arranged, output / "tab.musicxml", TUNING, bpm, title, "guitare", capo=capo,
                  meter=meter, grouped_rhythm=True)
        return True

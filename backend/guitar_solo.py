"""Arrange the melody and bass of a recording for one guitar."""
from bisect import bisect_left
from itertools import groupby

from guitar_tab import arrange, attack_groups, midi_notes, write_tab


TRIADS = {"major": 4, "minor": 3}


def vocal_melody(notes):
    line = []
    for group in attack_groups(notes, lambda note: note["start"]):
        group = [note for note in group if note["velocity"] >= 40 and note["end"] - note["start"] >= .13]
        if not group:
            continue
        previous = line[-1]["pitch"] if line else 64
        note = max(group, key=lambda n: n["velocity"] - 2 * abs(n["pitch"] - previous))
        line.append(dict(note))
    return line


def riff_notes(guitar, mix, transients, beat, *, phrase=False):
    groups = attack_groups(guitar, lambda note: note["start"])
    starts = [group[0]["start"] for group in groups]
    recovered = []
    for group in attack_groups(mix, lambda note: note["start"]):
        time = group[0]["start"]
        index = bisect_left(starts, time)
        if not 0 < index < len(groups) or len(group) != 1:
            continue
        before, after = groups[index - 1], groups[index]
        if len(before) != 1 or len(after) != 1:
            continue
        if min(time - starts[index - 1], starts[index] - time) < .055 or starts[index] - starts[index - 1] > beat:
            continue
        onset = bisect_left(transients, time - .06)
        audible_attack = onset < len(transients) and transients[onset] <= time + .06
        gap = starts[index] - starts[index - 1]
        rhythmic_gap = abs(gap - beat / 2) <= .06 and abs(time - (starts[index - 1] + gap / 2)) <= .025
        if not audible_attack and not rhythmic_gap:
            continue
        candidate = group[0]
        if (candidate["velocity"] >= 55 and candidate["end"] - time >= .075
                and max(abs(candidate["pitch"] - neighbor[0]["pitch"]) for neighbor in (before, after)) <= 5):
            recovered.append(candidate)
    groups = attack_groups([*guitar, *recovered], lambda note: note["start"])
    opening_riff = len(groups) >= 3 and all(len(group) == 1 for group in groups[1:3])
    if phrase and groups:
        return trace_phrase(groups, opening_riff, beat)
    line = []
    for index, group in enumerate(groups):
        loudest = max(note["velocity"] for note in group)
        candidates = [note for note in group if note["velocity"] >= .65 * loudest]
        if line and group[0]["start"] - line[-1]["start"] <= 1.5 * beat:
            last_pitch = line[-1]["pitch"]
            picked = max(candidates, key=lambda note: note["velocity"] - 4 * abs(note["pitch"] - last_pitch)
                         + 12 * (note["pitch"] > 54))
        elif index == 0 and opening_riff and len(group) >= 3:
            bass = min(candidates, key=lambda note: note["pitch"])
            picked = bass if bass["pitch"] <= 51 else max(candidates, key=lambda note: note["pitch"])
        else:
            picked = max(candidates, key=lambda note: note["pitch"])
        line.append(dict(picked))
    return line


def trace_phrase(groups, opening_riff, beat):
    """Choose pitches across the whole phrase instead of committing at each attack."""
    layers, links, scores = [], [], []
    for index, group in enumerate(groups):
        strongest = max(note["velocity"] for note in group)
        options = [note for note in group if note["velocity"] >= .65 * strongest]
        if index == 0 and opening_riff and len(group) >= 3:
            bass = min(options, key=lambda note: note["pitch"])
            if bass["pitch"] <= 51:
                options = [bass]
        previous = layers[-1] if layers else []
        parents, next_scores = [], []
        for note in options:
            pitch = note["pitch"]
            emission = .08 * note["velocity"] - (max(0, 56 - pitch) * .65 if len(group) > 1 else 0)
            distances = []
            for old, score in zip(previous, scores):
                if note["start"] - old["start"] <= 1.5 * beat:
                    leap = abs(pitch - old["pitch"])
                    score -= .45 * leap + .025 * leap**2
                distances.append(score)
            parent = max(range(len(distances)), key=distances.__getitem__) if distances else 0
            parents.append(parent)
            next_scores.append(emission + (distances[parent] if distances else 0))
        layers.append(options)
        links.append(parents)
        scores = next_scores
    index = max(range(len(scores)), key=scores.__getitem__)
    result = []
    for layer, parents in zip(reversed(layers), reversed(links)):
        result.append(dict(layer[index]))
        index = parents[index]
    return result[::-1]


def fit_melody(line, capo, *, minimum=40):
    for note in line:
        pitch = note["pitch"]
        while pitch < minimum + capo:
            pitch += 12
        while pitch > 76 + capo:
            pitch -= 12
        yield {**note, "pitch": pitch, "velocity": max(75, note["velocity"])}


def harmony(audio, bass, start, stop, bpm):
    import librosa
    import numpy as np

    hop = 512
    rate = 22050
    signal, _ = librosa.load(audio, sr=rate, mono=True)
    chroma = librosa.feature.chroma_stft(y=signal, sr=rate, hop_length=hop, n_fft=4096)
    low = None
    if bass and bass.is_file():
        bass_signal, _ = librosa.load(bass, sr=rate, mono=True)
        if np.max(np.abs(bass_signal)) >= .005:
            low = librosa.feature.chroma_stft(y=bass_signal, sr=rate, hop_length=hop, n_fft=4096)
    beat = 60 / bpm
    beat_count = int((stop - start) / beat) + 1
    previous = None
    for i in range(0, beat_count, 2):
        time = start + i * beat
        left, right = round((time + .035) * rate / hop), round((time + 2 * beat) * rate / hop)
        window = chroma[:, left:right]
        if not window.size:
            continue
        energy = window.mean(axis=1)
        if energy.max() < .12:
            continue
        bass_window = low[:, left:right] if low is not None else None
        bass_profile = bass_window.mean(axis=1) if bass_window is not None and bass_window.size else np.zeros(12)
        ranked = []
        for root in range(12):
            for quality, third in TRIADS.items():
                triad = [root, (root + third) % 12, (root + 7) % 12]
                if energy[triad[1]] < .24 * energy.max():
                    continue
                score = energy[triad].sum() + .65 * bass_profile[root]
                if previous == (root, quality):
                    score += .10
                ranked.append((score, root, quality))
        if not ranked:
            continue
        score, root, quality = max(ranked)
        runner_up = max((value for value, r, q in ranked if (r, q) != (root, quality)), default=0)
        if previous is None and score - runner_up < .10:
            continue
        if previous is not None and score - runner_up < .12 and previous != (root, quality):
            root, quality = previous
        previous = root, quality
        yield time, root, quality


def solo_notes(guitar, vocals, chords, bpm, capo, *, mix=(), mix_attacks=(), backing="supported", phrase=False):
    beat = 60 / bpm
    lead = list(fit_melody(riff_notes(guitar, mix, mix_attacks, beat, phrase=phrase), capo))
    pickup = lead.pop(0) if lead and lead[0]["pitch"] < 52 + capo else None
    voice = list(fit_melody(vocal_melody(vocals), capo, minimum=55))
    if len(voice) >= 3:
        voice_starts = [note["start"] for note in voice]

        def covered(note):
            index = bisect_left(voice_starts, note["start"] - .05)
            return ((index < len(voice) and voice[index]["start"] <= note["start"] + .045)
                    or (index > 0 and voice[index - 1]["end"] >= note["start"] + .045))

        lead = [note for note in lead if not covered(note)] + voice
    lead.sort(key=lambda note: note["start"])
    for index, note in enumerate(lead[:-1]):
        following = lead[index + 1]["start"]
        note["end"] = following if abs(following - note["end"]) <= .10 * beat else min(note["end"], following)
    lead = [note for note in lead if note["end"] - note["start"] >= .045]
    if pickup:
        pitch = pickup["pitch"] + 12 if pickup["pitch"] < 40 + capo else pickup["pitch"]
        lead.insert(0, {**pickup, "pitch": pitch,
                        "velocity": 70, "end": min(pickup["end"], pickup["start"] + .9 * beat)})
    if backing == "melody":
        return lead
    lead_starts = [note["start"] for note in lead]
    attacks = attack_groups(guitar, lambda note: note["start"])
    attack_starts = [group[0]["start"] for group in attacks]
    for time, root, quality in chords:
        pitch = 40 + capo + (root - (40 + capo)) % 12
        match = bisect_left(lead_starts, time - .045)
        has_bass = any(note["pitch"] <= 51 + capo and note["end"] > time for note in
                       lead[max(0, match - 1):bisect_left(lead_starts, time + .045)])
        if not has_bass:
            lead.append(dict(pitch=pitch, start=time, end=time + .88 * beat, velocity=64))
        # Keep one accompaniment accent on the second beat when the guitar
        # actually strikes a chord there. Keep its attack time and pitch.
        pulse = time + beat
        left = bisect_left(attack_starts, pulse - .18 * beat)
        right = bisect_left(attack_starts, pulse + .18 * beat)
        group = min((g for g in attacks[left:right] if len({n["pitch"] for n in g}) >= 3),
                    key=lambda g: abs(g[0]["start"] - pulse), default=None)
        if group:
            tones = {root, (root + TRIADS[quality]) % 12, (root + 7) % 12}
            attack = group[0]["start"]
            index = bisect_left(lead_starts, attack + .03)
            previous = lead[index - 1] if index else None
            ceiling = previous["pitch"] if previous and previous["end"] > attack else 64 + capo
            supported = [note for note in group if 45 + capo <= note["pitch"] < ceiling - 2
                         and note["pitch"] % 12 in tones]
            if supported:
                note = max(supported, key=lambda n: n["velocity"])
                lead.append({**note, "end": min(note["end"], note["start"] + .40 * beat), "velocity": 57})
        if backing == "fingerstyle":
            # Play an alternating bass only in active sections. Use a tone
            # already heard in this chord's original guitar phrase.
            start = bisect_left(attack_starts, time)
            stop = bisect_left(attack_starts, time + 2 * beat)
            if stop - start >= 4:
                basses = [n["pitch"] for group in attacks[start:stop] for n in group
                          if 40 + capo <= n["pitch"] <= 52 + capo
                          and n["pitch"] % 12 == (root + 7) % 12]
                if basses:
                    lead.append(dict(pitch=min(basses), start=pulse, end=pulse + .80 * beat, velocity=56))
    return lead


def align_attacks(notes, start, beat):
    """Nudge attacks close to a sixteenth-note grid, keeping other phrasing."""
    subdivision = beat / 4
    for group in attack_groups(notes, lambda note: note["start"]):
        measured = group[0]["start"]
        target = start + round((measured - start) / subdivision) * subdivision
        for note in group:
            offset = target - measured if abs(target - measured) <= .045 else 0
            yield {**note, "start": note["start"] + offset, "end": note["end"] + offset}


def write_solo(audio, bass, guitar, vocals, duration, destination, title, bpm, meter, capo, *,
               mix=(), mix_attacks=(), backing="supported", phrase=True):
    from transcribe_track import TUNINGS, write_midi

    tuning = TUNINGS["guitare"]
    start = guitar[0]["start"]
    chords = list(harmony(audio, bass, start, duration, bpm))
    notes = solo_notes(guitar, vocals, chords, bpm, capo, mix=mix, mix_attacks=mix_attacks,
                       backing=backing, phrase=phrase)
    notes = [{**note, "end": min(duration, note["end"])}
             for note in align_attacks(notes, start, 60 / bpm) if 0 <= note["start"] < duration]
    tab = arrange(notes, tuning, capo=capo, compact=True)
    playable = midi_notes(tab)
    if not playable:
        return False
    destination.mkdir(exist_ok=True)
    beats, beat_type = meter
    changes = [next(run) for _, run in groupby(chords, key=lambda chord: chord[1:])]
    write_midi(playable, destination / "tab.mid", 24, "guitare", bpm, beats=beats, beat_type=beat_type)
    write_tab(tab, destination / "tab.musicxml", tuning, bpm, title, "guitare", capo=capo,
              meter=meter, chords=changes, grouped_rhythm=True)
    return True

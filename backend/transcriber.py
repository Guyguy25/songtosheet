"""Experimental melody transcription for licensed/user-owned recordings.

The engine extracts ONE predominant pitch line (not isolated multi-instrument scores).
Its output is useful for testing the end-to-end pipeline, not an accuracy promise.
"""
from __future__ import annotations
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path
from xml.etree import ElementTree as ET

import librosa
import numpy as np
import pretty_midi
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

PITCH_STEPS = ['C','D','E','F','G','A','B']
SHARP_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']


def get_duration(path: str) -> float:
    cmd = ['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(path)]
    p=subprocess.run(cmd,capture_output=True,text=True,timeout=20,check=True)
    val=float(p.stdout.strip())
    if not math.isfinite(val) or val <= 0:
        raise ValueError('Durée audio invalide')
    return val


def extract_melody(path: str) -> tuple[list[dict], int]:
    """Return timed MIDI melody notes and an approximate BPM."""
    with tempfile.TemporaryDirectory() as tmp:
        wav=Path(tmp)/'mono.wav'
        subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-i',str(path),
                        '-ac','1','-ar','16000','-vn',str(wav)],capture_output=True,text=True,timeout=90,check=True)
        y,sr=librosa.load(str(wav),sr=16000,mono=True)
    if y.size < sr // 2 or np.max(np.abs(y)) < 0.0002:
        raise ValueError('Le fichier est vide ou trop silencieux')
    # This is intentionally limited to predominant-melody extraction, not polyphony.
    hop=512
    f0=librosa.yin(y,fmin=librosa.note_to_hz('C3'),fmax=librosa.note_to_hz('C7'),sr=sr,
                  frame_length=2048,hop_length=hop)
    rms=librosa.feature.rms(y=y,frame_length=2048,hop_length=hop)[0]
    length=min(len(f0),len(rms))
    f0=f0[:length]
    rms=rms[:length]
    floor=max(0.008,float(np.percentile(rms,75))*0.17)
    pitches=np.where((rms>=floor)&np.isfinite(f0),np.rint(librosa.hz_to_midi(np.maximum(f0,1))),-1).astype(int)
    # Median filter avoids transient single-frame pitch jumps.
    from scipy.ndimage import median_filter
    pitches=median_filter(pitches,size=5)
    onset_frames=librosa.onset.onset_detect(y=y,sr=sr,hop_length=hop,backtrack=False,units='frames')
    onset_frames=np.clip(onset_frames,0,length-1)
    boundaries=sorted(set([0,length-1]+onset_frames.tolist()))
    notes=[]
    for a,b in zip(boundaries,boundaries[1:]):
        seg=pitches[a:b]
        valid=seg[(seg>=48)&(seg<=95)]
        if len(valid)<3 or len(valid)/max(1,len(seg))<0.38:
            continue
        # Mode is stable for plucked/held pitches.
        pitch=int(np.bincount(valid,minlength=128).argmax())
        start=float(a*hop/sr)
        end=float(min(len(y)/sr,b*hop/sr))
        if end-start<0.12:
            continue
        if notes and notes[-1]['pitch']==pitch and start-notes[-1]['end']<0.085:
            notes[-1]['end']=round(end,3)
        else:
            notes.append({'pitch':pitch,'start':round(start,3),'end':round(end,3)})
    if not notes:
        raise ValueError('Aucune mélodie exploitable détectée. Essayez un enregistrement plus clair ou isolé.')
    # Keep no more than 500 independent note events.
    notes=notes[:500]
    try:
        tempo,beat_frames=librosa.beat.beat_track(y=y,sr=sr,hop_length=hop,trim=True)
        tempo=float(np.asarray(tempo).ravel()[0])
        bpm=int(np.clip(round(tempo),55,210)) if len(beat_frames)>=2 and tempo>=55 else 120
    except Exception:
        bpm=120
    return notes,bpm


def export_midi(notes:list[dict],instrument:str,path:str,bpm:int):
    pm=pretty_midi.PrettyMIDI(initial_tempo=bpm)
    program={'piano':0,'guitare':24,'violon':40,'voix':53,'basse':32}.get(instrument,0)
    track=pretty_midi.Instrument(program=program,name=instrument.capitalize())
    for n in notes:
        track.notes.append(pretty_midi.Note(velocity=90,pitch=int(n['pitch']),start=float(n['start']),end=float(n['end'])))
    pm.instruments.append(track)
    pm.write(path)


def note_parts(midi:int):
    name=SHARP_NAMES[midi%12]
    return name[0], 1 if len(name)>1 else 0, midi//12-1


def export_musicxml(notes:list[dict],instrument:str,title:str,path:str,bpm:int):
    root=ET.Element('score-partwise',version='4.0')
    ET.SubElement(root,'work')
    ET.SubElement(root,'movement-title').text=title
    partlist=ET.SubElement(root,'part-list')
    scorepart=ET.SubElement(partlist,'score-part',id='P1')
    ET.SubElement(scorepart,'part-name').text=instrument.capitalize()
    part=ET.SubElement(root,'part',id='P1')
    # This export uses fixed 120-quarter beats per minute for basic, editable notation.
    # The detected tempo is metadata; rhythms are approximate.
    div=480; beats=4; measure=1; used=0
    current=ET.SubElement(part,'measure',number=str(measure))
    attrs=ET.SubElement(current,'attributes')
    ET.SubElement(attrs,'divisions').text=str(div)
    key=ET.SubElement(attrs,'key'); ET.SubElement(key,'fifths').text='0'
    tm=ET.SubElement(attrs,'time'); ET.SubElement(tm,'beats').text='4'; ET.SubElement(tm,'beat-type').text='4'
    clef=ET.SubElement(attrs,'clef'); ET.SubElement(clef,'sign').text='G'; ET.SubElement(clef,'line').text='2'
    direction=ET.SubElement(current,'direction',placement='above'); dtype=ET.SubElement(direction,'direction-type')
    metro=ET.SubElement(dtype,'metronome'); ET.SubElement(metro,'beat-unit').text='quarter'; ET.SubElement(metro,'per-minute').text=str(bpm)
    for n in notes:
        # quantize the duration to 1/8 note subdivisions, ensuring 1/8 note minimum
        remaining=max(240,int(round((n['end']-n['start'])*(bpm/60)*div/240)*240))
        continuation=False
        while remaining:
            avail=4*div-used
            if avail<=0:
                measure+=1; used=0; current=ET.SubElement(part,'measure',number=str(measure));continue
            permitted=min(remaining,avail)
            dur=next((v for v in (1920,960,480,240) if v<=permitted),240)
            note=ET.SubElement(current,'note')
            pitch=ET.SubElement(note,'pitch')
            step,alter,octave=note_parts(int(n['pitch']))
            ET.SubElement(pitch,'step').text=step
            if alter: ET.SubElement(pitch,'alter').text=str(alter)
            ET.SubElement(pitch,'octave').text=str(octave)
            ET.SubElement(note,'duration').text=str(dur)
            ET.SubElement(note,'type').text={1920:'whole',960:'half',480:'quarter',240:'eighth'}[dur]
            if continuation:ET.SubElement(note,'tie',type='stop')
            if remaining>dur:ET.SubElement(note,'tie',type='start')
            used+=dur;remaining-=dur;continuation=True
            if used>=4*div:
                measure+=1;used=0;current=ET.SubElement(part,'measure',number=str(measure))
    ET.ElementTree(root).write(path,encoding='utf-8',xml_declaration=True)


def _diatonic_y(midi:int,base:float)->float:
    step,_,octave=note_parts(midi)
    # E4 bottom line at y=base. Every diatonic step is 5 points.
    return base+((octave-4)*7+PITCH_STEPS.index(step)-2)*5


def export_pdf(notes:list[dict],title:str,instrument:str,bpm:int,path:str):
    c=canvas.Canvas(path,pagesize=A4)
    pagew,pageh=A4
    c.setTitle(f'{title} — SongToSheet')
    def page_header(first):
        c.setFillColor(colors.HexColor('#24223C')); c.setFont('Helvetica-Bold',17 if first else 11)
        c.drawString(52,pageh-60,title[:56] if first else f'{title[:50]} (suite)')
        if first:
            c.setFont('Helvetica',9); c.setFillColor(colors.HexColor('#747389'))
            c.drawString(52,pageh-79,f'{instrument.capitalize()} · environ {bpm} BPM · mélodie estimée')
            c.setStrokeColor(colors.HexColor('#E7E3F1')); c.line(52,pageh-95,pagew-52,pageh-95)
    page_header(True)
    x0=66; x=x0; base=pageh-165; step=29; perline=15; count=0
    for n in notes:
        if count and count%perline==0:
            x=x0; base-=106
            if base<85:
                c.showPage(); page_header(False); base=pageh-142
        if count%perline==0:
            c.setStrokeColor(colors.HexColor('#B8B8C9')); c.setLineWidth(0.7)
            for j in range(5): c.line(x0-11,base+j*10,pagew-55,base+j*10)
        y=_diatonic_y(n['pitch'],base)
        y=min(base+65,max(base-20,y))
        c.setFillColor(colors.HexColor('#2A2546')); c.setStrokeColor(colors.HexColor('#2A2546'))
        c.ellipse(x-5,y-3.7,x+5,y+3.7,fill=1,stroke=0)
        c.setLineWidth(1.15); c.line(x+4,y,x+4,y+28 if y<base+27 else y-28)
        if y<base:
            c.setLineWidth(0.7)
            for ledger in range(1,int((base-y)/10)+1): c.line(x-8,base-ledger*10,x+8,base-ledger*10)
        if y>base+40:
            for ledger in range(1,int((y-(base+40))/10)+1): c.line(x-8,base+40+ledger*10,x+8,base+40+ledger*10)
        x+=step; count+=1
    c.setFont('Helvetica',7); c.setFillColor(colors.HexColor('#8B899A'))
    c.drawString(52,33,'SongToSheet · Relevé automatique approximatif : vérifiez les hauteurs et rythmes avant utilisation.')
    c.save()


def process_file(source:str,title:str,instrument:str,export_dir:str):
    notes,bpm=extract_melody(source)
    folder=Path(export_dir); folder.mkdir(parents=True,exist_ok=True)
    export_midi(notes,instrument,str(folder/'score.mid'),bpm)
    export_musicxml(notes,instrument,title,str(folder/'score.musicxml'),bpm)
    export_pdf(notes,title,instrument,bpm,str(folder/'score.pdf'))
    return {'notes':notes,'bpm':bpm,'note_count':len(notes)}
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {detectPitch,midiOf,matchesNote,chroma,matchesChord}=require('../backend/web/learn-audio.js');

const SR=44100;
const tone=(f,n=4096,harm=[1,.5,.3])=>Float32Array.from({length:n},(_,i)=>harm.reduce((s,a,k)=>s+a*Math.sin(2*Math.PI*f*(k+1)*i/SR),0)*.3);
// Spectre d'amplitude (DFT directe, suffisante pour un test) d'un signal de 4096 points.
function spectrum(signal){
  const n=signal.length,out=new Float32Array(n/2);
  for(let k=1;k<n/2;k++){
    const f=k*SR/n;if(f>2100)break;
    let re=0,im=0;for(let i=0;i<n;i++){const w=signal[i]*(.5-.5*Math.cos(2*Math.PI*i/n));re+=w*Math.cos(2*Math.PI*k*i/n);im-=w*Math.sin(2*Math.PI*k*i/n);}
    out[k]=Math.hypot(re,im);
  }
  return out;
}

test('YIN trouve le La 440 et le Mi grave de guitare',()=>{
  assert.ok(Math.abs(detectPitch(tone(440),SR).freq-440)<3);
  assert.ok(Math.abs(midiOf(detectPitch(tone(82.41,4096),SR).freq)-40)<.5);
});
test('silence et bruit faible → null',()=>{
  assert.equal(detectPitch(new Float32Array(4096),SR),null);
  assert.equal(detectPitch(Float32Array.from({length:4096},()=>(Math.random()-.5)*1e-4),SR),null);
});
test('note : ±50 cents, octave tolérée',()=>{
  assert.ok(matchesNote(440,69));assert.ok(matchesNote(880,69));assert.ok(matchesNote(220,69));assert.ok(matchesNote(452,69));
  assert.ok(!matchesNote(466.16,69));assert.ok(!matchesNote(null,69));
});
test('chroma : Sol + Si ressortent',()=>{
  const signal=tone(196,4096,[1]).map((v,i)=>v+tone(246.94,4096,[1])[i]);
  const c=chroma(spectrum(signal),SR,4096);
  const top=[...c].map((v,i)=>[v,i]).sort((a,b)=>b[0]-a[0]).slice(0,2).map(x=>x[1]).sort((a,b)=>a-b);
  assert.deepEqual(top,[7,11]);
  assert.equal(Math.max(...c),1);
});
test('accord : 60 % des classes attendues',()=>{
  const c=new Float32Array(12);c[4]=1;c[11]=.8;
  assert.ok(matchesChord(c,[40,47,56,64]));
  const one=new Float32Array(12);one[4]=1;
  assert.ok(!matchesChord(one,[40,47,56]));
});

test('hauteur estimée sur une fenêtre réduite (mobile) à 48 kHz',()=>{
  const {PITCH_WINDOW}=require('../backend/web/learn-audio.js');
  assert.equal(PITCH_WINDOW,2048);
  const low=Float32Array.from({length:PITCH_WINDOW},(_,i)=>Math.sin(2*Math.PI*82.41*i/48000)*.3+Math.sin(2*Math.PI*164.82*i/48000)*.15);
  assert.ok(Math.abs(midiOf(detectPitch(low,48000).freq)-40)<.5);
});

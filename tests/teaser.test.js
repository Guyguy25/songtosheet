'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {teaserMusicXml,teaserSource}=require('../lib/teaser');

const measure=n=>`<measure number="${n}"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>`;
const score=(parts,count)=>`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Guitare</part-name></score-part></part-list>${
  parts.map(id=>`<part id="${id}">${Array.from({length:count},(_,i)=>measure(i+1)).join('')}</part>`).join('')}</score-partwise>`;

test('keeps only the opening measures of every part',()=>{
  const out=teaserMusicXml(score(['P1','P2'],20),8);
  assert.equal((out.match(/<measure\b/g)||[]).length,16);
  assert.match(out,/<measure number="8">/);
  assert.doesNotMatch(out,/<measure number="9">/);
  assert.match(out,/<part-list><score-part id="P1"><part-name>Guitare<\/part-name><\/score-part><\/part-list>/);
  assert.match(out,/<\/score-partwise>$/);
});

test('short scores and self-closing measures pass through',()=>{
  const xml='<score-partwise><part id="P1"><measure number="1"><note/></measure><measure number="2" /></part></score-partwise>';
  assert.equal(teaserMusicXml(xml,8),xml);
});

test('rejects anything that is not a MusicXML score',()=>{
  assert.equal(teaserMusicXml('<html></html>'),null);
  assert.equal(teaserMusicXml(''),null);
  assert.equal(teaserMusicXml('<score-partwise><part id="P1"></part></score-partwise>'),null);
});

test('picks the tablature for a tablature request, the score otherwise',()=>{
  const b64=s=>Buffer.from(s).toString('base64');
  const exports={musicxml:b64('score'),tab:b64('tab'),mid:b64('midi')};
  assert.equal(teaserSource({format:'tablature',exports}),'tab');
  assert.equal(teaserSource({format:'partition',exports}),'score');
  assert.equal(teaserSource({format:'tablature',exports:{musicxml:b64('score')}}),'score');
  assert.equal(teaserSource({exports:{mid:b64('midi')}}),null);
});

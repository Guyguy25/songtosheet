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

test('picks the preferred file when it has enough bars, else the fullest one',()=>{
  const b64=s=>Buffer.from(s).toString('base64');
  const long=score(['P1'],12),short=score(['P1'],3),mid=score(['P1'],5);
  assert.equal(teaserSource({format:'tablature',exports:{musicxml:b64(long),tab:b64(long.replace('C','D'))}}),long.replace('C','D'));
  assert.equal(teaserSource({format:'partition',exports:{musicxml:b64(long),tab:b64(short)}}),long);
  // Recommended version first, as long as it is not a near-empty one.
  assert.equal(teaserSource({format:'tablature',exports:{tab:b64(short),rhythmtab:b64(long)}},['rhythmtab']),long);
  assert.equal(teaserSource({format:'tablature',exports:{tab:b64(long),rhythmtab:b64(short)}},['rhythmtab']),long);
  assert.equal(teaserSource({format:'tablature',exports:{tab:b64(short),heldtab:b64(mid)}}),mid);
  assert.equal(teaserSource({exports:{mid:b64('midi')}}),null);
});

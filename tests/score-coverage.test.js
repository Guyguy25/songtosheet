'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {playedBars,coveredRecommendation}=require('../lib/score-coverage');

const note='<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>';
const rest='<note print-object="no"><rest/><duration>16</duration></note>';
const tab=(played,total)=>`<score-partwise><part id="P1">${Array.from({length:total},(_,i)=>
  `<measure number="${i+1}">${i<played?note:rest}</measure>`).join('')}</part></score-partwise>`;

test('counts only bars that hold a pitched note',()=>{
  assert.equal(playedBars(tab(3,3)),3);
  assert.equal(playedBars(tab(3,16)),3);
  assert.equal(playedBars(''),0);
});

test('a version that stops after a few bars is never recommended',()=>{
  // The judge prefers "original" (3 bars of 16) over "rhythm" (16 of 16).
  const files={'original-v1':tab(3,3),'rhythm-v1':tab(16,16),'held-v1':tab(15,16)};
  assert.equal(coveredRecommendation({'original-v1':90,'rhythm-v1':70,'held-v1':80},files),'held-v1');
});

test('keeps the judge pick when it plays through the excerpt',()=>{
  const files={'original-v1':tab(14,16),'rhythm-v1':tab(16,16)};
  assert.equal(coveredRecommendation({'original-v1':90,'rhythm-v1':70},files),'original-v1');
});

test('no notes anywhere: no recommendation',()=>{
  assert.equal(coveredRecommendation({a:90,b:70},{a:tab(0,4),b:tab(0,4)}),null);
});

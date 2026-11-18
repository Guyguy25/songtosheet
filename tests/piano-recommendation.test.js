'use strict';
const test=require('node:test');
const assert=require('node:assert');
const {pianoComparison,PIANO_VARIANTS}=require('../lib/track-jobs.js');

function job(scores,recommended){
  const downloads=Object.keys(scores).flatMap(key=>[PIANO_VARIANTS[key].score,PIANO_VARIANTS[key].midi]);
  return {piano_primary:true,instrument:'piano',downloads,
    piano_recommendation:{version:3,recommended,scores,summary:'Mélodie mieux suivie.',criteria:{}}};
}

test('a tie still shows the judge’s pick, flagged as close',()=>{
  const result=pianoComparison(job({arrangement:72,solo:72},'solo'));
  assert.strictEqual(result.piano_recommendation_status,'close');
  assert.deepStrictEqual(result.piano_versions.filter(v=>v.recommended).map(v=>v.key),['solo']);
  assert.strictEqual(result.piano_versions[0].key,'solo');
  assert.strictEqual(result.piano_recommendation_summary,'Mélodie mieux suivie.');
});

test('a clear winner is recommended without the close flag',()=>{
  const result=pianoComparison(job({arrangement:80,solo:70},'arrangement'));
  assert.strictEqual(result.piano_recommendation_status,undefined);
  assert.strictEqual(result.piano_versions[0].recommended,true);
});

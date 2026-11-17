'use strict';
const test=require('node:test');
const assert=require('node:assert');
const {engineStats}=require('../lib/engine-stats');

function fakeDb(jobs,ballots=[]){
  return {collection:name=>name==='track_jobs'?{find:()=>({sort:()=>({limit:()=>({toArray:async()=>jobs})})})}:
    {aggregate:()=>({toArray:async()=>ballots})}};
}
const at=(start,seconds)=>({processing_deadline:new Date(start+5*60*1000),finished_at:new Date(start+seconds*1000)});

test('counts generated, recommended and chosen versions per engine',async()=>{
  const piano=['pianoarrxml','pianoarrmid','pianoyourxml','pianoyourmid'];
  const jobs=[
    {instrument:'piano',preview_limit:30,downloads:piano,piano_recommendation:{recommended:'arrangement',scores:{arrangement:80,yourmt3:60}},piano_choice:'arrangement',...at(0,40)},
    {instrument:'piano',preview_limit:30,downloads:piano,piano_recommendation:{recommended:'yourmt3',scores:{arrangement:70,yourmt3:75}},piano_choice:'arrangement',...at(0,60)},
    {instrument:'guitare',downloads:['tab','tabmid','heldtab','heldmid'],auto_recommendation:{recommended:'held-v1'},guitar_choice:'original-v1',...at(0,90)},
  ];
  const stats=await engineStats(fakeDb(jobs,[{_id:'held-v1',count:4}]));
  const arrangement=stats.piano.versions[0];
  assert.strictEqual(arrangement.key,'arrangement');
  assert.deepStrictEqual([arrangement.generated,arrangement.recommended,arrangement.chosen,arrangement.chosen_rate],[2,1,2,100]);
  assert.strictEqual(arrangement.average_score,75);
  assert.strictEqual(stats.piano.average_seconds.preview,50);
  const held=stats.guitar.versions.find(row=>row.key==='held-v1');
  assert.deepStrictEqual([held.recommended,held.community_votes],[1,4]);
  assert.strictEqual(stats.guitar.versions[0].key,'original-v1');
});

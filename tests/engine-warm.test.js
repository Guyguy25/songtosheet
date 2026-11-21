'use strict';
const test=require('node:test');
const assert=require('node:assert');
const {warmEngine,recentlyWarmed}=require('../lib/engine-wake.js');

function fakeDb(){
  let doc=null;
  return {collection:()=>({
    updateOne:async(filter)=>{
      if(!doc)return {matchedCount:0};
      const cutoff=filter.$or[0].warmed_at.$lt;
      if(doc.warmed_at<cutoff){doc.warmed_at=new Date(cutoff.getTime()+75000);return {matchedCount:1};}
      return {matchedCount:0};
    },
    insertOne:async(d)=>{if(doc)throw Object.assign(new Error('dup'),{code:11000});doc={...d};},
    findOne:async()=>doc&&{...doc}
  })};
}
const NOW=new Date('2026-11-21T12:00:00Z');

test('pasting links wakes the engine at most once per 75 s, and the job then skips its own wake',async()=>{
  delete process.env.ENGINE_WAKE_URL;
  const db=fakeDb();
  assert.strictEqual(await warmEngine(db,NOW),true);
  assert.strictEqual(await warmEngine(db,new Date(+NOW+10000)),false);
  assert.strictEqual(await recentlyWarmed(db,new Date(+NOW+30000)),true);
  assert.strictEqual(await recentlyWarmed(db,new Date(+NOW+80000)),false);
  assert.strictEqual(await warmEngine(db,new Date(+NOW+80000)),true);
});

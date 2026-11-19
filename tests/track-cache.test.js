'use strict';
const test=require('node:test');
const assert=require('node:assert');
const {ObjectId}=require('mongodb');
const {cacheKey,reuseCached}=require('../lib/track-cache.js');

function fakeDb(){
  const docs=[];
  const matches=(d,f)=>Object.entries(f).every(([k,v])=>v instanceof ObjectId?d[k]?.equals?.(v):k==='_id'&&v.$ne?!d._id.equals(v.$ne):d[k]===v);
  return {docs,collection:()=>({
    find:f=>{const list=docs.filter(d=>matches(d,f));const c={sort:()=>c,limit:()=>c,toArray:async()=>list.slice(-1)};return c;},
    updateOne:async(f,u)=>{const d=docs.find(x=>matches(x,f));if(d)Object.assign(d,u.$set);return {modifiedCount:d?1:0};}
  })};
}
const base={youtube_id:'abcdefghijk',instrument:'piano',format:'partition',source_content:'mixed',capo:0};

test('the cache key separates previews, versions and settings',()=>{
  assert.strictEqual(cacheKey({...base,preview_limit:30}),'v1|abcdefghijk|piano|partition|mixed||0|preview30');
  assert.notStrictEqual(cacheKey({...base,variant:'solo'}),cacheKey({...base,variant:'arrangement'}));
  assert.strictEqual(cacheKey({...base,variant:'solo-v2',guitar_goal:'solo'}),cacheKey({...base,variant:'solo-v2',guitar_goal:'original'}));
  assert.notStrictEqual(cacheKey({...base,preview_limit:30,guitar_goal:'chords'}),cacheKey({...base,preview_limit:30,guitar_goal:'solo'}));
  assert.strictEqual(cacheKey({...base,excerpt:{start_ms:0,end_ms:1000},preview_limit:30}),null);
  assert.strictEqual(cacheKey({instrument:'piano',extension:'mp3'}),null);
});

test('a song already generated is copied into the new job instantly',async()=>{
  const db=fakeDb();
  const key=cacheKey({...base,variant:'solo'});
  db.docs.push({_id:new ObjectId(),user_id:new ObjectId(),cache_key:key,status:'completed',title:'Autre titre',
    duration:200,note_count:900,exports:{musicxml:'eA==',vocals:'dg=='},downloads:['musicxml','vocals'],full_jobs:{x:1},lease:'l'});
  const job={_id:new ObjectId(),user_id:new ObjectId(),cache_key:key,status:'queued',active:true,title:'Mon titre'};
  db.docs.push(job);
  const now=new Date();
  assert.strictEqual(await reuseCached(db,job,now),true);
  assert.strictEqual(job.status,'completed');
  assert.strictEqual(job.active,false);
  assert.deepStrictEqual(job.downloads,['musicxml','vocals']);
  assert.strictEqual(job.title,'Mon titre');
  assert.strictEqual(job.full_jobs,undefined);
  assert.strictEqual(job.lease,undefined);
  assert.strictEqual(job.finished_at,now);
});

test('nothing cached: the job goes to the engine',async()=>{
  const db=fakeDb();
  const job={_id:new ObjectId(),cache_key:cacheKey({...base,preview_limit:30}),status:'queued',active:true};
  db.docs.push(job);
  assert.strictEqual(await reuseCached(db,job),false);
  assert.strictEqual(job.status,'queued');
});

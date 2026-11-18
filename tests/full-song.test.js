'use strict';
const test=require('node:test');
const assert=require('node:assert');
const {ObjectId}=require('mongodb');
const {createFullSong}=require('../lib/full-song.js');
const billingStore=require('../lib/billing-store.js');

function fakeDb(){
  const data={};
  const matches=(doc,filter)=>Object.entries(filter).every(([k,v])=>{
    if(k==='$or')return v.some(part=>matches(doc,part));
    const actual=doc[k];
    if(v instanceof ObjectId)return actual instanceof ObjectId&&actual.equals(v);
    return actual===v;
  });
  return {data,collection:name=>{
    const docs=data[name]??=[];
    return {createIndex:async()=>null,
      findOne:async f=>docs.find(d=>matches(d,f))||null,
      find:f=>{const list=docs.filter(d=>matches(d,f));const c={sort:()=>c,limit:()=>c,toArray:async()=>list,next:async()=>list[0]||null};return c;},
      countDocuments:async f=>docs.filter(d=>matches(d,f)).length,
      insertOne:async d=>{
        if(name==='billing_unlocks'&&d.starter_day&&docs.some(o=>o.starter_day===d.starter_day&&String(o.user_id)===String(d.user_id)))
          throw Object.assign(new Error('dup'),{code:11000});
        if(name==='track_jobs'&&d.active&&docs.some(o=>o.active&&String(o.user_id)===String(d.user_id)))
          throw Object.assign(new Error('dup'),{code:11000});
        docs.push({...d});
      },
      updateOne:async(f,u,o={})=>{let d=docs.find(x=>matches(x,f));if(!d&&o.upsert){d={...f};docs.push(d);}
        if(d)for(const [k,v] of Object.entries(u.$set||{})){
          if(k.includes('.')){const [a,b]=k.split('.');(d[a]??={})[b]=v;}else d[k]=v;}},
      deleteOne:async f=>{const i=docs.findIndex(d=>matches(d,f));if(i>=0)docs.splice(i,1);}};
  }};
}

const NOW=new Date('2026-11-18T12:00:00Z');
function setup(tier){
  const db=fakeDb();
  const user={_id:new ObjectId(),email:'a@b.fr'};
  db.collection('users');db.data.users.push(user);
  if(tier)user.billing={membership_id:'mem',tier,status:'active',active:true,period_end:new Date('2026-12-18T00:00:00Z'),updated_at:NOW};
  const preview={_id:new ObjectId(),user_id:user._id,status:'completed',preview_limit:30,instrument:'piano',title:'Message',
    youtube_id:'dQw4w9WgXcQ',downloads:['pianoarrxml','pianoarrmid','pianosoloxml','pianosolomid'],active:false};
  db.collection('track_jobs');db.data.track_jobs.push(preview);
  return {db,user,preview};
}

test('a Starter generates the whole song of the paid version once',async()=>{
  const {db,user,preview}=setup('starter');
  let woke=0;
  const first=await createFullSong(db,user,{id:String(preview._id),variant:'arrangement'},NOW,async()=>{woke++;});
  assert.strictEqual(first.status,201);
  const job=db.data.track_jobs.find(j=>j.variant==='arrangement');
  assert.strictEqual(job.preview_limit,undefined);
  assert.strictEqual(job.youtube_id,'dQw4w9WgXcQ');
  assert.strictEqual(woke,1);
  // Asking again for the same version returns the same job, without using another song.
  const again=await createFullSong(db,user,{id:String(preview._id),variant:'arrangement'},NOW);
  assert.deepStrictEqual(again,{status:200,body:{id:first.body.id,existing:true}});
  assert.strictEqual(db.data.billing_unlocks.length,1);
});

test('a Starter’s second version the same day is refused with an upgrade hint',async()=>{
  const {db,user,preview}=setup('starter');
  await createFullSong(db,user,{id:String(preview._id),variant:'arrangement'},NOW);
  db.data.track_jobs.forEach(j=>{j.active=false;});
  const second=await createFullSong(db,user,{id:String(preview._id),variant:'solo'},NOW);
  assert.strictEqual(second.status,402);
  assert.strictEqual(second.body.reason,'daily_limit');
  assert.strictEqual(second.body.upgrade,'pro');
});

test('without a plan, the person is sent to the plans; guests must log in',async()=>{
  const {db,user,preview}=setup(null);
  const result=await createFullSong(db,user,{id:String(preview._id),variant:'arrangement'},NOW);
  assert.strictEqual(result.status,402);
  assert.strictEqual(result.body.reason,'subscription');
  assert.strictEqual((await createFullSong(db,{_id:new ObjectId(),guest:true},{id:String(preview._id),variant:'arrangement'},NOW)).status,401);
});

test('a version the preview does not have, or another person’s preview, is refused',async()=>{
  const {db,user,preview}=setup('pro');
  assert.strictEqual((await createFullSong(db,user,{id:String(preview._id),variant:'playable'},NOW)).status,400);
  const stranger={_id:new ObjectId(),billing:user.billing};
  assert.strictEqual((await createFullSong(db,stranger,{id:String(preview._id),variant:'arrangement'},NOW)).status,404);
});

test('a busy account gets its song back (no song used for nothing)',async()=>{
  const {db,user,preview}=setup('starter');
  db.data.track_jobs.push({_id:new ObjectId(),user_id:user._id,active:true,status:'processing'});
  const result=await createFullSong(db,user,{id:String(preview._id),variant:'arrangement'},NOW);
  assert.strictEqual(result.status,409);
  assert.strictEqual((db.data.billing_unlocks||[]).length,0);
});

test('an imported file must be imported again for the whole song',async()=>{
  const {db,user,preview}=setup('pro');
  delete preview.youtube_id;
  const result=await createFullSong(db,user,{id:String(preview._id),variant:'arrangement'},NOW);
  assert.strictEqual(result.status,409);
  assert.match(result.body.detail,/importe à nouveau/);
});

test('a single-version result (bass, voice) generates through the usual pipeline',async()=>{
  const {db,user,preview}=setup('pro');
  preview.instrument='basse';preview.downloads=['musicxml','mid'];
  const result=await createFullSong(db,user,{id:String(preview._id),variant:'default'},NOW);
  assert.strictEqual(result.status,201);
});

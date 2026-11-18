'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ObjectId}=require('mongodb');
const {freePreviewsLeft,FREE_PREVIEWS}=require('../lib/free-previews');

const dbWith=(jobs)=>({collection:()=>({countDocuments:async filter=>jobs.filter(job=>
  job.user_id.equals(filter.user_id)&&job.preview_limit&&filter.status.$in.includes(job.status)).length})});
const later=new Date(Date.now()+30*86400e3);

test('free accounts get three previews; failed ones do not count',async()=>{
  const user={_id:new ObjectId()};
  const job=status=>({user_id:user._id,preview_limit:30,status});
  assert.equal(FREE_PREVIEWS,3);
  assert.equal(await freePreviewsLeft(dbWith([]),user),3);
  assert.equal(await freePreviewsLeft(dbWith([job('completed'),job('failed'),job('processing')]),user),1);
  assert.equal(await freePreviewsLeft(dbWith([job('completed'),job('completed'),job('queued'),job('completed')]),user),0);
});

test('paid accounts, admins and guests are not counted here',async()=>{
  const db=dbWith([]);
  assert.equal(await freePreviewsLeft(db,{_id:new ObjectId(),billing:{active:true,tier:'starter',period_end:later}}),null);
  assert.equal(await freePreviewsLeft(db,{_id:new ObjectId(),role:'admin'}),null);
  assert.equal(await freePreviewsLeft(db,{_id:new ObjectId(),guest:true}),null);
});

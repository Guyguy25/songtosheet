'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildProfile,estimate,DEFAULTS}=require('../lib/track-eta');

const t=s=>new Date(Date.UTC(2026,10,18,22,0,0)+s*1000);
const job=(wait,audioLeft,detectLeft)=>({queued_at:t(0),claimed_at:t(wait),finished_at:t(wait+audioLeft),
  stage_at:{audio:t(wait),detect:t(wait+audioLeft-detectLeft)}});

test('learns queue and per-stage medians from finished previews',()=>{
  const jobs=[job(50,20,6),job(60,22,7),job(55,24,8),job(70,21,6),job(45,23,7)];
  const profile=buildProfile(jobs);
  assert.equal(profile.queue,55);
  assert.equal(profile.audio,22);
  assert.equal(profile.detect,7);
  // Too few samples for a stage: the default stays.
  assert.equal(profile.isolate,DEFAULTS.isolate);
});

test('ignores absurd samples and keeps defaults with too little data',()=>{
  const profile=buildProfile([job(5000,20,6),job(50,20,6)]);
  assert.equal(profile.queue,DEFAULTS.queue);
});

test('queued: engine start plus the whole processing, minus time already waited',()=>{
  const profile={...DEFAULTS,queue:50,audio:22};
  assert.equal(estimate({status:'queued',queued_at:t(0)},profile,t(10)),62);
  // Waited longer than usual: never shows 0 while not done.
  assert.equal(estimate({status:'queued',queued_at:t(0)},profile,t(200)),1);
});

test('processing: what usually remains from the current stage, minus time spent in it',()=>{
  const profile={...DEFAULTS,detect:9};
  const running={status:'processing',stage:'detect',claimed_at:t(0),stage_at:{audio:t(0),detect:t(14)}};
  assert.equal(estimate(running,profile,t(17)),6);
  assert.equal(estimate({...running,status:'completed'},profile,t(17)),null);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert');
const {ObjectId}=require('mongodb');
const {pick,validUnsubscribe,unsubscribeToken}=require('../lib/nudges.js');
const NOW=new Date('2026-11-26T12:00:00Z');
const ago=h=>new Date(NOW-h*3600000);
const user=(extra={})=>({_id:new ObjectId(),email:'a@b.fr',created_at:ago(30),...extra});
const preview=(h,extra={})=>({_id:new ObjectId(),created_at:ago(h),finished_at:ago(h),status:'completed',preview_limit:30,title:'Rehab',...extra});
const starter={billing:{active:true,tier:'starter',period_end:new Date('2027-01-01')}};

test('signed up a day ago, nothing generated: the first-song email',()=>{
  assert.strictEqual(pick({user:user(),jobs:[],now:NOW}).kind,'first');
  assert.strictEqual(pick({user:user({created_at:ago(5)}),jobs:[],now:NOW}),null);
  assert.strictEqual(pick({user:user({nudges:{first:ago(1)}}),jobs:[],now:NOW}),null);
});

test('a preview made yesterday and never unlocked: the unlock email, with the song',()=>{
  const due=pick({user:user(),jobs:[preview(24)],now:NOW});
  assert.strictEqual(due.kind,'unlock');
  assert.strictEqual(due.job.title,'Rehab');
  assert.strictEqual(pick({user:user(),jobs:[preview(3)],now:NOW}),null);
  assert.strictEqual(pick({user:user(),jobs:[preview(24,{full_jobs:{solo:1}})],now:NOW}),null);
});

test('free previews used up: the plans email once the unlock one was sent',()=>{
  const jobs=[preview(50),preview(40),preview(30)];
  assert.strictEqual(pick({user:user({nudges:{unlock:ago(30)}}),jobs,now:NOW}).kind,'limit');
});

test('Starter: the next song email when the 24 h window ends, once per window',()=>{
  const unlock={created_at:ago(26),window_until:ago(2)};
  assert.strictEqual(pick({user:user(starter),jobs:[preview(26)],unlock,now:NOW}).kind,'starter_ready');
  assert.strictEqual(pick({user:user({...starter,nudges:{starter_ready:unlock.window_until.toISOString()}}),jobs:[preview(26)],unlock,now:NOW}),null);
  assert.strictEqual(pick({user:user(starter),jobs:[preview(5)],unlock:{created_at:ago(5),window_until:new Date(+NOW+19*3600000)},now:NOW}),null);
});

test('quiet for two weeks: one winback, not again for the same quiet period',()=>{
  const jobs=[preview(15*24)];
  const old=user({created_at:ago(30*24),nudges:{unlock:ago(14*24)}});
  assert.strictEqual(pick({user:old,jobs,now:NOW}).kind,'winback');
  assert.strictEqual(pick({user:{...old,nudges:{...old.nudges,winback:ago(20)}},jobs,now:NOW}),null);
});

test('never more than one follow-up a day',()=>{
  assert.strictEqual(pick({user:user({last_nudge_at:ago(5)}),jobs:[],now:NOW}),null);
});

test('the unsubscribe link only works for its own account',()=>{
  const id=String(new ObjectId()),other=String(new ObjectId());
  assert.strictEqual(validUnsubscribe(id,unsubscribeToken(id)),true);
  assert.strictEqual(validUnsubscribe(other,unsubscribeToken(id)),false);
  assert.strictEqual(validUnsubscribe(id,'nope'),false);
});

test('email language: country and site language agree, else the chosen language, else the country',()=>{
  const {emailLang}=require('../lib/email.js');
  assert.strictEqual(emailLang({lang:'fr',lang_chosen:true,country:'BE'}),'fr');
  assert.strictEqual(emailLang({lang:'en',lang_chosen:true,country:'US'}),'en');
  assert.strictEqual(emailLang({lang:'en',lang_chosen:true,country:'FR'}),'en');
  assert.strictEqual(emailLang({lang:'fr',country:'US'}),'en');
  assert.strictEqual(emailLang({lang:'fr',country:'CH'}),'fr');
  assert.strictEqual(emailLang({lang:'fr',country:'SN'}),'fr');
  assert.strictEqual(emailLang({lang:'fr'}),'fr');
});

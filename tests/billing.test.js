'use strict';
const test=require('node:test');
const assert=require('node:assert');
const crypto=require('node:crypto');
const billing=require('../lib/billing.js');

function sign(secret,id,timestamp,body){
  const mac=crypto.createHmac('sha256',Buffer.from(secret,'utf8')).update(`${id}.${timestamp}.${body}`).digest('base64');
  return `v1,${mac}`;
}

test('a Whop webhook signed with the ws_ secret is accepted',()=>{
  const secret='ws_test_secret_value_123';
  const now=Date.now();
  const timestamp=String(Math.floor(now/1000));
  const body='{"type":"membership.activated","data":{"id":"mem_1"}}';
  const headers={'webhook-id':'msg_1','webhook-timestamp':timestamp,'webhook-signature':sign(secret,'msg_1',timestamp,body)};
  assert.strictEqual(billing.verifyWebhook(body,headers,secret,now),true);
});

test('a forged, altered or stale webhook is rejected',()=>{
  const secret='ws_test_secret_value_123';
  const now=Date.now();
  const timestamp=String(Math.floor(now/1000));
  const body='{"type":"membership.activated"}';
  const good=sign(secret,'msg_1',timestamp,body);
  assert.strictEqual(billing.verifyWebhook(body+' ',{'webhook-id':'msg_1','webhook-timestamp':timestamp,'webhook-signature':good},secret,now),false);
  assert.strictEqual(billing.verifyWebhook(body,{'webhook-id':'msg_1','webhook-timestamp':timestamp,'webhook-signature':sign('ws_other',"msg_1",timestamp,body)},secret,now),false);
  const old=String(Math.floor(now/1000)-600);
  assert.strictEqual(billing.verifyWebhook(body,{'webhook-id':'msg_1','webhook-timestamp':old,'webhook-signature':sign(secret,'msg_1',old,body)},secret,now),false);
  assert.strictEqual(billing.verifyWebhook(body,{},secret,now),false);
  assert.strictEqual(billing.verifyWebhook(body,{'webhook-id':'msg_1','webhook-timestamp':timestamp,'webhook-signature':good},'',now),false);
});

test('a signature among several (key rotation) is enough',()=>{
  const secret='ws_test_secret_value_123';
  const now=Date.now();
  const timestamp=String(Math.floor(now/1000));
  const body='{}';
  const header='v1,bm90LXRoZS1yaWdodC1vbmU= '+sign(secret,'msg_2',timestamp,body);
  assert.strictEqual(billing.verifyWebhook(body,{'webhook-id':'msg_2','webhook-timestamp':timestamp,'webhook-signature':header},secret,now),true);
});

test('Whop plans map to SongToSheet tiers',()=>{
  assert.strictEqual(billing.tierForPlan('plan_IDC4CtmdcNpi7'),'starter');
  assert.strictEqual(billing.tierForPlan('plan_tSyrCMbVC4Tc5'),'starter');
  assert.strictEqual(billing.tierForPlan('plan_4jV8ToLJhBWKm'),'pro');
  assert.strictEqual(billing.tierForPlan('plan_oTt3xxj15qEY0'),'pro');
  assert.strictEqual(billing.tierForPlan('plan_tXX5q8JhuWQui'),'lifetime');
  assert.strictEqual(billing.tierForPlan('plan_unknown'),null);
});

test('a membership becomes an entitlement, whatever the field spelling',()=>{
  const entitlement=billing.entitlement({id:'mem_1',status:'active',plan:{id:'plan_IDC4CtmdcNpi7'},
    renewal_period_end:1795000000,cancel_at_period_end:false,manage_url:'https://whop.com/@me/settings/memberships/',
    metadata:{user_id:'64b000000000000000000001'},user:{email:'A@B.fr'}});
  assert.deepStrictEqual(entitlement,{membership_id:'mem_1',tier:'starter',status:'active',active:true,
    period_end:new Date(1795000000*1000),cancel_at_period_end:false,manage_url:'https://whop.com/@me/settings/memberships/',
    user_id:'64b000000000000000000001',email:'a@b.fr'});
  const other=billing.entitlement({id:'mem_2',status:'canceled',plan_id:'plan_4jV8ToLJhBWKm',current_period_end:'2026-12-01T00:00:00Z',email:'x@y.fr'});
  assert.strictEqual(other.tier,'pro');
  assert.strictEqual(other.active,false);
  assert.deepStrictEqual(other.period_end,new Date('2026-12-01T00:00:00Z'));
  assert.strictEqual(billing.entitlement({id:'mem_3',status:'active',plan:{id:'plan_nope'}}),null);
});

test('the effective tier follows the subscription and its end date',()=>{
  const now=new Date('2026-11-18T12:00:00Z');
  assert.strictEqual(billing.effectiveTier(null,now),'free');
  assert.strictEqual(billing.effectiveTier({role:'admin'},now),'pro');
  assert.strictEqual(billing.effectiveTier({billing:{tier:'starter',active:true,period_end:new Date('2026-12-18T00:00:00Z')}},now),'starter');
  assert.strictEqual(billing.effectiveTier({billing:{tier:'starter',active:true,period_end:new Date('2026-11-01T00:00:00Z')}},now),'free');
  assert.strictEqual(billing.effectiveTier({billing:{tier:'pro',active:false,period_end:new Date('2026-12-18T00:00:00Z')}},now),'free');
  assert.strictEqual(billing.effectiveTier({billing:{tier:'lifetime',active:true,period_end:null}},now),'lifetime');
});

test('the Starter day resets at midnight, Paris time',()=>{
  // 23:30 in Paris (UTC+1 in November) is still the 18th; 00:30 is the 19th.
  assert.strictEqual(billing.parisDay(new Date('2026-11-18T22:30:00Z')),'2026-11-18');
  assert.strictEqual(billing.parisDay(new Date('2026-11-18T23:30:00Z')),'2026-11-19');
  assert.deepStrictEqual(billing.nextParisMidnight(new Date('2026-11-18T12:00:00Z')),new Date('2026-11-18T23:00:00Z'));
  // Summer time (UTC+2).
  assert.deepStrictEqual(billing.nextParisMidnight(new Date('2026-07-01T12:00:00Z')),new Date('2026-07-01T22:00:00Z'));
});

test('quotas: Starter one full song a day, Pro and Lifetime unlimited, free none',()=>{
  const now=new Date('2026-11-18T12:00:00Z');
  assert.deepStrictEqual(billing.quota('starter',0,now),{limit:1,used:0,remaining:1,resets_at:new Date('2026-11-18T23:00:00Z')});
  assert.strictEqual(billing.quota('starter',1,now).remaining,0);
  assert.deepStrictEqual(billing.quota('pro',7,now),{limit:null,used:7,remaining:null,resets_at:null});
  assert.strictEqual(billing.quota('lifetime',0,now).limit,null);
  assert.strictEqual(billing.quota('free',0,now).remaining,0);
});

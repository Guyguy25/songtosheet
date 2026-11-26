'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {tunnel,landingPage}=require('../lib/tunnel');

const NOW=new Date('2026-11-26T18:00:00Z');
const channelOf=s=>s==='google'?'organic':s==='direct'?'direct':'social';

function scenario(){
  const users=[
    {_id:'a',created_at:new Date('2026-11-20T10:05:00Z'),first_paid_at:new Date('2026-11-20T10:30:00Z'),billing:{tier:'pro'}}, // paye
    {_id:'b',created_at:new Date('2026-11-21T09:00:00Z')},                                                                     // compte, paywall, pas payé
    {_id:'c',created_at:new Date('2026-11-22T09:00:00Z')},                                                                     // compte sans générer
    {_id:'old',created_at:new Date('2026-09-01T09:00:00Z'),first_paid_at:new Date('2026-09-01T10:00:00Z'),billing:{tier:'free'}} // ancien compte
  ];
  const visitors=[
    {_id:'v1',first_seen:new Date('2026-11-20T10:00:00Z'),source:'tiktok',landing:'/',human:true,user_id:'a',steps:{preview:1}},
    {_id:'v2',first_seen:new Date('2026-11-21T08:58:00Z'),source:'tiktok',landing:'/',human:true,user_id:'b',steps:{preview:1,pricing:1,checkout:1}},
    {_id:'v3',first_seen:new Date('2026-11-22T08:55:00Z'),source:'google',landing:'/youtube-en-partition',human:true,user_id:'c',steps:{}},
    {_id:'v4',first_seen:new Date('2026-11-23T08:00:00Z'),source:'tiktok',landing:'/',human:false,steps:{}},                 // parti tout de suite
    {_id:'v5',first_seen:new Date('2026-11-23T09:00:00Z'),source:'tiktok',landing:'/',human:true,steps:{preview:1}},           // généré sans compte
    {_id:'v6',first_seen:new Date('2026-11-24T09:00:00Z'),source:'direct',landing:'/app',human:true,user_id:'old',steps:{pricing:1}} // ancien compte : pas une inscription
  ];
  const jobsOf=new Map([['a',[{variant:'solo'}]]]);
  const userById=new Map(users.map(u=>[u._id,u]));
  const paying=u=>Boolean(u.billing&&u.billing.tier!=='free');
  return tunnel(visitors,{userById,jobsOf,paying},{channelOf,users,now:NOW});
}

test('le tunnel compte chaque personne une fois, étapes emboîtées',()=>{
  const t=scenario().all;
  assert.equal(t.landing,6);
  assert.equal(t.engaged,5);
  assert.equal(t.generated,3);
  assert.equal(t.account,3,'un ancien compte qui revient n’est pas une inscription');
  assert.equal(t.paywall,2,'le payeur a forcément vu le paywall');
  assert.equal(t.checkout,2);
  assert.equal(t.paid,1);
  assert.equal(t.generated_rate,50);
  assert.equal(t.account_rate,50);
  assert.equal(t.paywall_rate,66.7);
  assert.equal(t.paid_rate,50);
  assert.equal(t.account_without_generation,1);
  assert.equal(t.generated_without_account,1);
});

test('tunnel par source et page d’arrivée',()=>{
  const t=scenario();
  const tiktok=t.sources.find(s=>s.key==='tiktok');
  assert.equal(tiktok.landing,4);assert.equal(tiktok.paid,1);
  assert.equal(t.channels.find(c=>c.key==='organic').account,1);
  assert.deepEqual(t.landing_pages,{accueil:4,outils:1,autre:1});
  assert.equal(landingPage('/en'),'accueil');
  assert.equal(landingPage('/en/guitar-tab-generator'),'outils');
  assert.equal(landingPage('/apprendre/alternative-songsterr'),'articles');
});

test('rétention M1 / M3 des payants',()=>{
  const r=scenario().retention;
  assert.equal(r.payers,2);
  assert.equal(r.m1_cohort,1);assert.equal(r.m1_kept,0);
  assert.equal(r.m3_cohort,0);
});

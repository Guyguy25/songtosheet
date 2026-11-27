'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pickJob,cleanRating,bucketOf,retention,parisDay,nextDay,recordSeen,QUESTIONS}=require('../lib/ratings');

const at=iso=>new Date(iso);
const job=(id,created,extra={})=>({_id:id,status:'completed',created_at:at(created),...extra});

test('la pop-up ne propose qu’une génération faite un jour AVANT, terminée, jamais notée',()=>{
  const now=at('2026-11-24T18:00:00Z');
  assert.equal(pickJob([job('a','2026-11-24T08:00:00Z')],now),null,'même jour : pas encore');
  assert.equal(pickJob([job('b','2026-11-23T08:00:00Z',{status:'failed'})],now),null,'échec : rien à noter');
  assert.equal(pickJob([job('c','2026-11-01T08:00:00Z')],now),null,'trop ancienne');
  assert.equal(pickJob([job('d','2026-11-23T08:00:00Z',{guest_expires_at:now})],now),null,'sans compte');
  assert.equal(pickJob([job('e','2026-11-23T08:00:00Z',{rating:{score:4}})],now),null,'déjà notée');
  assert.equal(pickJob([job('f','2026-11-23T08:00:00Z',{rating_dismissed_at:now})],now),null,'refusée');
  assert.equal(pickJob([job('g','2026-11-22T08:00:00Z'),job('h','2026-11-23T08:00:00Z')],now)._id,'h','la plus récente');
});

test('les versions d’un même morceau ne sont notées qu’une fois',()=>{
  const now=at('2026-11-24T18:00:00Z');
  const jobs=[job('p','2026-11-22T08:00:00Z',{rating:{score:5}}),job('v1','2026-11-23T08:00:00Z',{parent_id:'p',variant:'solo'})];
  assert.equal(pickJob(jobs,now),null);
});

test('le jour compte à l’heure de Paris',()=>{
  // 23h30 UTC le 23 = 00h30 à Paris le 24.
  assert.equal(parisDay(at('2026-11-23T23:30:00Z')),'2026-11-24');
  assert.equal(nextDay('2026-11-30'),'2026-12-01');
  const now=at('2026-11-24T09:00:00Z');
  assert.equal(pickJob([job('x','2026-11-23T23:30:00Z')],now),null,'faite « aujourd’hui » à Paris');
});

test('questions selon la note, raisons filtrées',()=>{
  assert.deepEqual([1,2,3,4,5].map(bucketOf),['low','low','mid','high','high']);
  for(const set of Object.values(QUESTIONS))assert.ok(Object.keys(set.reasons).length>=4);
  assert.deepEqual(cleanRating({score:2,reasons:['wrong_notes','speed','wrong_notes','x'],comment:'  mesure 12  '}),
    {score:2,reasons:['wrong_notes'],comment:'mesure 12'});
  assert.throws(()=>cleanRating({score:6}));
  assert.throws(()=>cleanRating({score:'4.5'}));
});

test('retours : J+1, 7 jours et comptes revenus',()=>{
  const now=at('2026-11-24T18:00:00Z'),since=at('2026-11-10T18:00:00Z');
  const users=[
    {_id:'1',created_at:at('2026-11-20T10:00:00Z'),seen_days:['2026-11-20','2026-11-21']},          // revenu le lendemain
    {_id:'2',created_at:at('2026-11-15T10:00:00Z'),seen_days:['2026-11-15','2026-11-19','2026-11-24']}, // revenu à J+4 et J+9
    {_id:'3',created_at:at('2026-11-20T10:00:00Z'),seen_days:['2026-11-20']},                         // jamais revenu
    {_id:'4',created_at:at('2026-11-24T10:00:00Z'),seen_days:['2026-11-24']},                         // inscrit aujourd'hui : hors cohorte
    {_id:'5',created_at:at('2026-10-01T10:00:00Z'),seen_days:['2026-10-01','2026-11-22']}             // ancien compte revenu
  ];
  const r=retention(users,since,now);
  assert.equal(r.returning,3);
  assert.equal(r.d1_cohort,3);assert.equal(r.d1_back,1);assert.equal(r.d1,33.3);
  assert.equal(r.d7_cohort,1);assert.equal(r.d7_back,1);
  assert.equal(r.by_day.get('2026-11-24'),1);
});

test('le jour de passage n’est écrit qu’une fois par jour',async()=>{
  const calls=[];
  const db={collection:()=>({updateOne:async(...args)=>{calls.push(args);return {modifiedCount:1};}})};
  const now=at('2026-11-24T18:00:00Z');
  assert.equal(await recordSeen(db,{_id:'u',seen_last_day:'2026-11-24'},now),false);
  assert.equal(await recordSeen(db,{_id:'u',seen_last_day:'2026-11-23'},now),true);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0][0],{_id:'u',seen_last_day:{$ne:'2026-11-24'}});
});

test('une écoute est comptée sur la génération et dans score_plays, jamais pour un invité',async()=>{
  const {recordPlay}=require('../lib/plays');
  const calls={jobs:[],plays:[]};
  const id='0123456789abcdef01234567';
  const db={collection:name=>name==='track_jobs'
    ?{findOneAndUpdate:async(filter,update)=>{calls.jobs.push([filter,update]);return {_id:filter._id,title:'Wonderwall',instrument:'guitare',variant:'solo'};}}
    :{createIndex:async()=>{},updateOne:async(filter,update)=>{calls.plays.push([filter,update]);return {};}}};
  const now=new Date('2026-11-25T20:00:00Z');
  assert.equal(await recordPlay(db,{_id:'g',guest:true},id,now),false);
  assert.equal(await recordPlay(db,{_id:'u'},'pas-un-id',now),false);
  assert.equal(await recordPlay(db,{_id:'u',role:'user'},id,now),true);
  assert.deepEqual(calls.jobs[0][1].$inc,{plays:1});
  assert.equal(calls.plays[0][0].day,'2026-11-25');
  assert.equal(calls.plays[0][1].$set.kind,'full');
  assert.equal(calls.plays[0][1].$set.admin,false);
});

test('un compte sans jour de passage enregistré ne fait pas planter les retours',()=>{
  const now=new Date('2026-11-27T00:00:00Z'),since=new Date('2026-11-19T23:00:00Z');
  const r=retention([{_id:'x',created_at:new Date('2026-11-20T09:00:00Z')}],since,now);
  assert.equal(r.d7_cohort,1);assert.equal(r.d7_back,0);assert.equal(r.returning,0);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ObjectId}=require('mongodb');
const {nextStreak,saveResult,getProgress,recordUnlockClick,learnStats}=require('../lib/learn.js');

// Petite base en mémoire : seules les opérations utilisées par lib/learn.js.
function same(actual,value){
  if(value instanceof ObjectId)return actual instanceof ObjectId&&actual.equals(value);
  if(value&&typeof value==='object'&&!(value instanceof Date)){
    if('$gte' in value)return actual>=value.$gte;
    if('$gt' in value)return actual>value.$gt;
  }
  return actual===value;
}
const matches=(doc,filter)=>Object.entries(filter).every(([k,v])=>same(doc[k],v));
function fakeDb(){
  const data={};
  return {data,collection(name){
    const docs=data[name]??=[];
    return {
      createIndex:async()=>null,
      findOne:async f=>docs.find(d=>matches(d,f))||null,
      find:f=>({toArray:async()=>docs.filter(d=>matches(d,f))}),
      updateOne:async(f,update,options={})=>{
        let doc=docs.find(d=>matches(d,f));
        if(!doc){if(!options.upsert)return {matchedCount:0};doc={...f};docs.push(doc);}
        Object.assign(doc,update.$set||{});
        for(const [k,v] of Object.entries(update.$setOnInsert||{}))if(!(k in doc))doc[k]=v;
        return {matchedCount:1};
      }
    };
  }};
}
function setup(extra={}){
  const db=fakeDb();
  const user={_id:new ObjectId(),role:'user'};
  const job=new ObjectId();
  db.data.track_jobs=[{_id:job,user_id:user._id,status:'completed',...extra}];
  db.data.users=[{...user}];
  return {db,user,job:String(job)};
}
const run=(o={})=>({version:'direct',level:0,boss:false,notes:20,accuracy:1,speed:1,mic:true,day:'2026-11-22',end:4,...o});

test('série : même jour inchangée, lendemain +1, trou → 1',()=>{
  assert.deepEqual(nextStreak(null,'2026-11-22'),{count:1,last_day:'2026-11-22'});
  assert.deepEqual(nextStreak({count:3,last_day:'2026-11-22'},'2026-11-22'),{count:3,last_day:'2026-11-22'});
  assert.deepEqual(nextStreak({count:3,last_day:'2026-11-22'},'2026-11-23'),{count:4,last_day:'2026-11-23'});
  assert.deepEqual(nextStreak({count:3,last_day:'2026-11-22'},'2026-11-25'),{count:1,last_day:'2026-11-25'});
  assert.deepEqual(nextStreak({count:3,last_day:'2026-11-30'},'2026-12-01'),{count:4,last_day:'2026-12-01'});
});
test('valeurs bornées, étoiles recalculées, meilleur résultat conservé',async()=>{
  const {db,user,job}=setup();
  const a=await saveResult(db,user,run({id:job,accuracy:5,speed:3}));
  assert.equal(a.level.stars,3);assert.equal(a.level.best_accuracy,1);assert.equal(a.level.best_speed,1);
  assert.equal(a.xp_gained,200);assert.equal(a.xp_total,200);assert.deepEqual(a.streak,{count:1,last_day:'2026-11-22'});
  const b=await saveResult(db,user,run({id:job,accuracy:.7}));
  assert.equal(b.level.stars,3);assert.equal(b.level.attempts,2);assert.equal(b.xp_total,340);
  const progress=await getProgress(db,user,{id:job,version:'direct',day:'2026-11-23'});
  assert.equal(progress.levels['0'].stars,3);assert.equal(progress.xp,340);assert.equal(progress.streak.count,1);
  assert.equal((await getProgress(db,user,{id:job,version:'direct',day:'2026-11-25'})).streak.count,0);
});
test('sans micro : coche, pas d\'étoile, pas d\'XP',async()=>{
  const {db,user,job}=setup();
  const r=await saveResult(db,user,run({id:job,mic:false}));
  assert.equal(r.level.stars,0);assert.equal(r.level.checked,true);assert.equal(r.xp_gained,0);
});
test('aperçu freemium : niveau au-delà de 30 s refusé',async()=>{
  const {db,user,job}=setup({preview_limit:30,preview_duration:30});
  await assert.rejects(saveResult(db,user,run({id:job,level:9,notes:10,end:34})),/aperçu/);
  await saveResult(db,user,run({id:job,level:7,end:30.2}));
});
test('morceau d\'un autre compte : introuvable',async()=>{
  const {db,job}=setup();const other={_id:new ObjectId(),role:'user'};
  await assert.rejects(saveResult(db,other,run({id:job})),/introuvable/);
});
test('entrées invalides refusées',async()=>{
  const {db,user,job}=setup();
  await assert.rejects(saveResult(db,user,run({id:job,version:'../x'})),/invalide/);
  await assert.rejects(saveResult(db,user,run({id:job,level:-1})),/invalide/);
  await assert.rejects(saveResult(db,user,run({id:job,day:'hier'})),/invalide/);
  await assert.rejects(saveResult(db,user,run({id:'nope'})),/invalide/);
});

test('learnStats : joueurs, niveaux, part micro, clics déblocage',async()=>{
  const {db,user,job}=setup();
  await saveResult(db,user,run({id:job,level:0,notes:10}));
  await saveResult(db,user,run({id:job,level:1,notes:10,mic:false,end:8}));
  await recordUnlockClick(db,user,{id:job,version:'direct'});
  assert.deepEqual(await learnStats(db,new Date(0)),{players:1,levels_done:2,songs:1,mic_share:.5,unlock_clicks:1});
  assert.deepEqual(await learnStats(db,new Date(Date.now()+60000)),{players:0,levels_done:0,songs:0,mic_share:0,unlock_clicks:0});
});

test('aperçu freemium : fin de niveau absente ou invalide refusée',async()=>{
  const {db,user,job}=setup({preview_limit:30,preview_duration:30});
  const base=run({id:job,level:9,notes:10});
  delete base.end;
  await assert.rejects(saveResult(db,user,base),/aperçu/);
  await assert.rejects(saveResult(db,user,{...base,end:'abc'}),/aperçu/);
  await assert.rejects(saveResult(db,user,{...base,end:-1}),/aperçu/);
});

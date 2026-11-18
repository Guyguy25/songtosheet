'use strict';
const test=require('node:test');
const assert=require('node:assert');
const {ObjectId}=require('mongodb');
const store=require('../lib/billing-store.js');

// A small in-memory stand-in for the MongoDB calls the billing store makes.
function matches(doc,filter){
  return Object.entries(filter).every(([key,value])=>{
    if(key==='$or')return value.some(part=>matches(doc,part));
    const actual=doc[key];
    if(value instanceof ObjectId)return actual instanceof ObjectId&&actual.equals(value);
    return actual===value;
  });
}
function fakeDb(){
  const data={};
  const unique={billing_unlocks:doc=>doc.starter_day?`${doc.user_id}|${doc.starter_day}`:null};
  const collection=name=>{
    const docs=data[name]??=[];
    return {
      createIndex:async()=>null,
      findOne:async filter=>docs.find(doc=>matches(doc,filter))||null,
      find:filter=>{
        let list=docs.filter(doc=>matches(doc,filter));
        const cursor={sort:()=>cursor,limit:()=>cursor,toArray:async()=>list,next:async()=>list[0]||null};
        return cursor;
      },
      countDocuments:async filter=>docs.filter(doc=>matches(doc,filter)).length,
      insertOne:async doc=>{
        const key=unique[name]?.(doc);
        if((doc._id&&docs.some(other=>other._id===doc._id))||(key&&docs.some(other=>unique[name](other)===key))){
          throw Object.assign(new Error('duplicate'),{code:11000});
        }
        docs.push({...doc});
      },
      updateOne:async(filter,update,options={})=>{
        let doc=docs.find(item=>matches(item,filter));
        if(!doc&&options.upsert){doc={...filter};docs.push(doc);}
        if(doc)Object.assign(doc,update.$set||{});
      },
      deleteOne:async filter=>{const index=docs.findIndex(doc=>matches(doc,filter));if(index>=0)docs.splice(index,1);}
    };
  };
  return {collection,data};
}

const NOW=new Date('2026-11-18T12:00:00Z');
const LATER=new Date('2026-12-18T12:00:00Z');
function user(db,email='tanguy@example.fr'){
  const doc={_id:new ObjectId(),email};
  db.collection('users');
  db.data.users.push(doc);
  return doc;
}
const grant=(over)=>({membership_id:'mem_s',tier:'starter',status:'active',active:true,period_end:LATER,
  cancel_at_period_end:false,manage_url:null,user_id:null,email:null,...over});

test('a payment carrying the account id unlocks that account',async()=>{
  const db=fakeDb();const account=user(db);
  await store.applyEntitlement(db,grant({user_id:String(account._id)}),NOW);
  const summary=await store.summary(db,account,NOW);
  assert.strictEqual(summary.tier,'starter');
  assert.deepStrictEqual({limit:summary.quota.limit,remaining:summary.quota.remaining},{limit:1,remaining:1});
  assert.ok(summary.manage_url.startsWith('https://whop.com/'));
});

test('a payment under the same e-mail is claimed when the account shows up',async()=>{
  const db=fakeDb();
  await store.applyEntitlement(db,grant({email:'late@example.fr'}),NOW);
  const account=user(db,'late@example.fr');
  assert.strictEqual((await store.summary(db,account,NOW)).tier,'starter');
});

test('Starter → Pro: the old plan’s late cancellation does not downgrade the account',async()=>{
  const db=fakeDb();const account=user(db);const id=String(account._id);
  await store.applyEntitlement(db,grant({user_id:id}),NOW);
  await store.applyEntitlement(db,grant({membership_id:'mem_p',tier:'pro',user_id:id}),NOW);
  await store.applyEntitlement(db,grant({status:'canceled',active:false,user_id:id}),NOW);
  assert.strictEqual(account.billing.tier,'pro');
  assert.strictEqual((await store.summary(db,account,NOW)).quota.limit,null);
});

test('Pro → Starter: once Pro ends, the Starter bought meanwhile takes over',async()=>{
  const db=fakeDb();const account=user(db);const id=String(account._id);
  await store.applyEntitlement(db,grant({membership_id:'mem_p',tier:'pro',period_end:new Date('2026-11-20T00:00:00Z'),user_id:id}),NOW);
  await store.applyEntitlement(db,grant({user_id:id}),NOW);
  assert.strictEqual(account.billing.tier,'pro');
  const afterPro=new Date('2026-11-21T12:00:00Z');
  assert.strictEqual((await store.summary(db,account,afterPro)).tier,'starter');
});

test('a cancelled subscription keeps access until the end of the paid period',async()=>{
  const db=fakeDb();const account=user(db);const id=String(account._id);
  await store.applyEntitlement(db,grant({user_id:id,cancel_at_period_end:true}),NOW);
  const summary=await store.summary(db,account,NOW);
  assert.strictEqual(summary.tier,'starter');
  assert.strictEqual(summary.cancel_at_period_end,true);
  await store.applyEntitlement(db,grant({user_id:id,status:'expired',active:false}),LATER);
  assert.strictEqual((await store.summary(db,account,LATER)).tier,'free');
});

test('Starter: one full song a day, a second is refused until midnight in Paris',async()=>{
  const db=fakeDb();const account=user(db);
  await store.applyEntitlement(db,grant({user_id:String(account._id)}),NOW);
  assert.deepStrictEqual(await store.reserveFullSong(db,account,{jobId:'j1',variant:'arrangement'},NOW),{ok:true,tier:'starter'});
  assert.deepStrictEqual(await store.reserveFullSong(db,account,{jobId:'j1',variant:'solo'},NOW),{ok:false,reason:'daily_limit',tier:'starter'});
  assert.strictEqual((await store.summary(db,account,NOW)).quota.remaining,0);
  const tomorrow=new Date('2026-11-18T23:30:00Z');  // 00:30 in Paris
  assert.strictEqual((await store.reserveFullSong(db,account,{jobId:'j2',variant:'solo'},tomorrow)).ok,true);
});

test('Pro: no daily limit; free accounts are sent to the plans',async()=>{
  const db=fakeDb();const pro=user(db);const free=user(db,'free@example.fr');
  await store.applyEntitlement(db,grant({membership_id:'mem_p',tier:'pro',user_id:String(pro._id)}),NOW);
  for(const variant of ['a','b','c'])assert.strictEqual((await store.reserveFullSong(db,pro,{jobId:'j',variant},NOW)).ok,true);
  assert.deepStrictEqual(await store.reserveFullSong(db,free,{jobId:'j',variant:'a'},NOW),{ok:false,reason:'subscription'});
});

test('a whole song that failed is given back: it does not count and can be generated again',async()=>{
  const db=fakeDb();const account=user(db);
  await store.applyEntitlement(db,grant({user_id:String(account._id)}),NOW);
  const first=new ObjectId();
  assert.strictEqual((await store.reserveFullSong(db,account,{jobId:first,variant:'original-v1'},NOW)).ok,true);
  db.collection('track_jobs');
  db.data.track_jobs.push({_id:first,user_id:account._id,status:'failed'});
  assert.strictEqual(await store.usedToday(db,account._id,NOW),0);
  const retry=new ObjectId();
  assert.deepStrictEqual(await store.reserveFullSong(db,account,{jobId:retry,variant:'original-v1'},NOW),{ok:true,tier:'starter'});
  // A successful (or still running) one keeps counting.
  db.data.track_jobs.push({_id:retry,user_id:account._id,status:'processing'});
  assert.strictEqual(await store.usedToday(db,account._id,NOW),1);
  assert.strictEqual((await store.reserveFullSong(db,account,{jobId:new ObjectId(),variant:'held-v1'},NOW)).reason,'daily_limit');
});

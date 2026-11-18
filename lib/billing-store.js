'use strict';
/** Billing state in MongoDB: memberships, the account's entitlement, daily Starter usage. */
const {ObjectId}=require('mongodb');
const {entitlement,effectiveTier,parisDay,quota}=require('./billing');

const WHOP_API='https://api.whop.com/api/v1';
const MANAGE_URL='https://whop.com/@me/settings/memberships/';
const RANK={starter:1,pro:2,lifetime:3};
const REFRESH_MS=10*60*1000;
let indexes=null;

function prepare(db){
  indexes??=Promise.all([
    db.collection('billing_events').createIndex({received_at:1},{expireAfterSeconds:30*86400}),
    db.collection('billing_memberships').createIndex({email:1}),
    db.collection('billing_unlocks').createIndex({user_id:1,day:1}),
    // Starter: one full song a day, enforced by the database itself (no race between two clicks).
    db.collection('billing_unlocks').createIndex({user_id:1,starter_day:1},
      {unique:true,partialFilterExpression:{starter_day:{$exists:true}},name:'starter_daily_unique'})
  ]).catch(error=>{indexes=null;throw error;});
  return indexes;
}

async function whop(path,{method='GET',body}={}){
  const key=process.env.WHOP_API_KEY;
  if(!key)throw Object.assign(new Error('Paiement indisponible pour le moment.'),{status:503});
  const response=await fetch(WHOP_API+path,{method,signal:AbortSignal.timeout(4000),
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})});
  const text=await response.text();
  let data=null;try{data=text?JSON.parse(text):null;}catch{}
  if(!response.ok){
    console.error('whop api',method,path,response.status,text.slice(0,300));
    throw Object.assign(new Error('Le service de paiement ne répond pas. Réessaie dans un instant.'),{status:502});
  }
  return data;
}

const fetchMembership=id=>whop('/memberships/'+encodeURIComponent(id));

/** Record a membership and give the account its entitlement (the best active one wins). */
async function applyEntitlement(db,granted,now=new Date()){
  await prepare(db);
  const users=db.collection('users');
  await db.collection('billing_memberships').updateOne({_id:granted.membership_id},
    {$set:{...granted,_id:granted.membership_id,updated_at:now}},{upsert:true});
  let user=granted.user_id?await users.findOne({_id:new ObjectId(granted.user_id)},{projection:{billing:1}}):null;
  if(!user&&granted.email)user=await users.findOne({email:granted.email},{projection:{billing:1}});
  if(!user)return null;  // claimed later by email, when the person signs up or logs in
  await db.collection('billing_memberships').updateOne({_id:granted.membership_id},{$set:{account_id:String(user._id)}});
  const current=user.billing;
  const same=current?.membership_id===granted.membership_id;
  const currentActive=current&&effectiveTier({billing:current},now)!=='free';
  // An upgrade (Starter → Pro) often sends the old plan's cancellation after the new one's
  // activation: an inactive or lesser membership never overwrites a better active one.
  if(!same&&currentActive&&(!granted.active||RANK[granted.tier]<RANK[current.tier]))return user._id;
  const billing={membership_id:granted.membership_id,tier:granted.tier,status:granted.status,active:granted.active,
    period_end:granted.period_end,cancel_at_period_end:granted.cancel_at_period_end,
    manage_url:granted.manage_url,updated_at:now};
  await users.updateOne({_id:user._id},{$set:{billing}});
  return user._id;
}

/** The account's billing, refreshed from Whop when it is stale; a payment made under the same
 * e-mail before the account was linked is claimed here. */
async function currentBilling(db,user,now=new Date()){
  await prepare(db);
  let billing=user.billing||null;
  if(billing?.membership_id&&process.env.WHOP_API_KEY&&
    (!billing.updated_at||now-new Date(billing.updated_at)>REFRESH_MS)){
    try{
      const granted=entitlement(await fetchMembership(billing.membership_id));
      if(granted){await applyEntitlement(db,{...granted,user_id:String(user._id)},now);}
    }catch(error){console.error('billing refresh',error.message);}
    billing=(await db.collection('users').findOne({_id:user._id},{projection:{billing:1}}))?.billing||billing;
  }
  if(effectiveTier({...user,billing},now)==='free'){
    // No valid plan on the account: a payment made under the same e-mail before the account was
    // linked, or another active membership (Pro → Starter downgrade), takes over.
    const owners=[{account_id:String(user._id)},...(user.email?[{email:String(user.email).toLowerCase()}]:[])];
    const candidates=await db.collection('billing_memberships').find({active:true,$or:owners}).toArray();
    const best=candidates.filter(item=>effectiveTier({billing:item},now)!=='free')
      .sort((a,b)=>(RANK[b.tier]||0)-(RANK[a.tier]||0))[0];
    if(best&&best.membership_id!==billing?.membership_id){
      const {_id,account_id,updated_at,...granted}=best;
      await applyEntitlement(db,{...granted,user_id:String(user._id)},now);
      billing=(await db.collection('users').findOne({_id:user._id},{projection:{billing:1}}))?.billing||billing;
    }
  }
  return billing;
}

async function usedToday(db,userId,now=new Date()){
  await prepare(db);
  return db.collection('billing_unlocks').countDocuments({user_id:userId,day:parisDay(now)});
}

async function summary(db,user,now=new Date()){
  const billing=await currentBilling(db,user,now);
  const tier=effectiveTier({...user,billing},now);
  const used=await usedToday(db,user._id,now);
  return {
    tier,status:billing?.status||null,
    period_end:billing?.period_end||null,cancel_at_period_end:Boolean(billing?.cancel_at_period_end),
    manage_url:billing?billing.manage_url||MANAGE_URL:null,
    quota:quota(tier,used,now)
  };
}

/** Use one full song of the account's allowance. Returns {ok:true} or {ok:false, reason}. */
async function reserveFullSong(db,user,{jobId,variant},now=new Date()){
  const billing=await currentBilling(db,user,now);
  const tier=effectiveTier({...user,billing},now);
  if(tier==='free')return {ok:false,reason:'subscription'};
  const day=parisDay(now);
  try{
    await db.collection('billing_unlocks').insertOne({user_id:user._id,day,tier,job_id:jobId,variant,created_at:now,
      ...(tier==='starter'?{starter_day:day}:{})});
  }catch(error){
    if(error.code===11000)return {ok:false,reason:'daily_limit',tier};
    throw error;
  }
  return {ok:true,tier};
}

async function releaseFullSong(db,user,{jobId,variant}){
  await db.collection('billing_unlocks').deleteOne({user_id:user._id,job_id:jobId,variant});
}

module.exports={prepare,whop,fetchMembership,applyEntitlement,currentBilling,usedToday,summary,reserveFullSong,releaseFullSong,MANAGE_URL};

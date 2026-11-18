'use strict';
/**
 * SongToSheet billing endpoint (one function: Vercel's free plan counts functions).
 *   GET  /api/billing                    → the signed-in account's plan, status and quota
 *   POST /api/billing {action:'checkout', plan, period} → a Whop checkout linked to the account
 *   POST /api/billing?webhook=whop        → Whop webhook (signed), updates the account's plan
 */
const {database}=require('../lib/mongodb');
const {authenticated,json,allowed}=require('../lib/session');
const {fail}=require('../lib/authorization');
const {verifyWebhook,entitlement}=require('../lib/billing');
const store=require('../lib/billing-store');

const CHECKOUT_PLANS={
  starter:{monthly:'plan_IDC4CtmdcNpi7',annual:'plan_tSyrCMbVC4Tc5'},
  pro:{monthly:'plan_4jV8ToLJhBWKm',annual:'plan_oTt3xxj15qEY0'},
  lifetime:{once:'plan_tXX5q8JhuWQui'}
};

async function rawBody(req){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>1_000_000)throw Object.assign(new Error('payload too large'),{status:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function membershipOf(event){
  const data=event?.data;
  if(!data||typeof data!=='object')return {id:null,object:null};
  if(String(event.type||'').startsWith('membership.'))return {id:typeof data.id==='string'?data.id:null,object:data};
  const membership=data.membership;
  if(membership&&typeof membership==='object')return {id:membership.id||null,object:membership};
  return {id:typeof membership==='string'?membership:typeof data.membership_id==='string'?data.membership_id:null,object:null};
}

async function webhook(req,res){
  const body=await rawBody(req);
  if(!verifyWebhook(body,req.headers,process.env.WHOP_WEBHOOK_SECRET)){
    return json(res,401,{detail:'Signature invalide.'});
  }
  let event;
  try{event=JSON.parse(body);}catch{return json(res,400,{detail:'JSON invalide.'});}
  const db=await database();
  await store.prepare(db);
  const eventId=String(req.headers['webhook-id']);
  if(await db.collection('billing_events').findOne({_id:eventId,processed:true},{projection:{_id:1}})){
    return json(res,200,{ok:true,duplicate:true});
  }
  const {id,object}=membershipOf(event);
  if(!id&&!object)return json(res,200,{ok:true,ignored:true});
  let membership=object;
  if(id&&process.env.WHOP_API_KEY){
    // The API's copy is authoritative (events can arrive out of order).
    membership=await store.fetchMembership(id);
  }
  // Metadata set at checkout (the account id) is kept even if the API copy lacks it.
  const granted=entitlement({...membership,metadata:{...(object?.metadata||{}),...(membership?.metadata||{})}});
  if(!granted)return json(res,200,{ok:true,ignored:true});
  const userId=await store.applyEntitlement(db,granted);
  await db.collection('billing_events').updateOne({_id:eventId},{$set:{processed:true,
    type:String(event.type||''),received_at:new Date()}},{upsert:true});
  console.log('billing webhook',event.type,granted.tier,granted.status,userId?'linked':'pending');
  return json(res,200,{ok:true});
}

async function checkout(req,res,user){
  const {plan,period}=req.body||{};
  const planId=CHECKOUT_PLANS[plan]?.[plan==='lifetime'?'once':period==='annual'?'annual':'monthly'];
  if(!planId)return json(res,400,{detail:'Offre inconnue.'});
  const origin='https://tablurio.com';
  const configuration=await store.whop('/checkout_configurations',{method:'POST',body:{
    account_id:'biz_7EpgzhL8mQlG1B',mode:'payment',variant_id:planId,metadata:{user_id:String(user._id)},redirect_url:origin+'/app?abonnement=merci'}});
  const target=String(configuration?.purchase_url||'');
  let url=null;
  try{
    const parsed=new URL(target,'https://whop.com');
    if(parsed.origin==='https://whop.com'&&parsed.pathname.startsWith('/checkout/'))url=parsed.href;
  }catch{}
  if(!url)return json(res,502,{detail:'Le service de paiement ne répond pas. Réessaie dans un instant.'});
  return json(res,200,{url});
}

module.exports=async(req,res)=>{
  try{
    if(req.method==='POST'&&req.query?.webhook==='whop')return await webhook(req,res);
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return json(res,405,{detail:'Méthode non autorisée.'});}
    if(req.method==='POST'&&!allowed(req))return json(res,403,{detail:'Origine refusée.'});
    const user=await authenticated(req);
    if(!user)return json(res,401,{detail:'Connecte-toi pour gérer ton abonnement.',login:true});
    const db=await database();
    if(req.method==='GET')return json(res,200,await store.summary(db,user));
    if(req.body?.action==='checkout')return await checkout(req,res,user);
    return json(res,400,{detail:'Action inconnue.'});
  }catch(error){
    if(error.status&&error.status<600)return json(res,error.status,{detail:error.message});
    return fail(res,error);
  }
};

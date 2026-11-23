'use strict';
const {database}=require('../../lib/mongodb');
const {issue,publicUser,json}=require('../../lib/session');
const {method,credentials,fail}=require('../../lib/authorization');
const {make}=require('../../lib/passwords');
const {normalizePhone}=require('../../lib/phone');
const {cleanGeneration,addGeneration,ensureIndexes}=require('../../lib/generations');
const {verify,sendVerification}=require('../../lib/account-flows');
const {emailEnabled,langOf}=require('../../lib/email');
const {allow,clientIp}=require('../../lib/rate-limit');
module.exports=async(req,res)=>{
  // /api/auth/verify → ?route=verify (email code), see vercel.json.
  if(req.query?.route==='verify')return verify(req,res);
  if(!method(req,res,'POST'))return;
  let fields,pending=null;
  try{
    fields=credentials(req.body);
    fields.phone=normalizePhone(req.body?.phone);
    if(req.body?.pending_generation?.completed===true){
      cleanGeneration(req.body.pending_generation);
      pending=req.body.pending_generation;
    }
  }catch(e){return json(res,400,{detail:e.message});}
  try{
    const db=await database();await ensureIndexes(db);
    if(!await allow(db,`signup-ip:${clientIp(req)}`,8,3600000))return json(res,429,{detail:'Trop de comptes créés depuis cette connexion. Réessaie dans une heure.'});
    // Existing address: say so plainly (checked first, before the phone number).
    if(await db.collection('users').findOne({email:fields.email},{projection:{_id:1}})){
      return json(res,409,{detail:'Un compte est déjà lié à cette adresse email.',reason:'email_taken'});
    }
    const password_hash=await make(fields.password);
    // With email set up, the address is confirmed by a 6-digit code before generating.
    const verifying=emailEnabled(),lang=langOf(req);
    const result=await db.collection('users').insertOne({email:fields.email,phone:fields.phone,password_hash,created_at:new Date(),tier:'free',lang,
      marketing_consent:req.body?.marketing_consent===true,...(req.body?.marketing_consent===true?{marketing_consent_at:new Date()}:{}),
      ...(verifying?{email_verified:false}:{})});
    const user={_id:result.insertedId,email:fields.email,phone:fields.phone,lang,...(verifying?{email_verified:false}:{})};
    if(pending)await addGeneration(db,String(user._id),pending);
    issue(res,user);
    const sent=verifying?await sendVerification(db,user):{sent:false};
    return json(res,201,{user:publicUser(user),verify:Boolean(verifying&&sent.sent)});
  }catch(e){return fail(res,e);}
};

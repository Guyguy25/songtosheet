'use strict';
const {database}=require('../../lib/mongodb');
const {issue,publicUser,json}=require('../../lib/session');
const {method,credentials,fail}=require('../../lib/authorization');
const {matches}=require('../../lib/passwords');
const {addGeneration}=require('../../lib/generations');
const {forgot,reset}=require('../../lib/account-flows');
const {allow,clientIp}=require('../../lib/rate-limit');
const oauth=require('../../lib/oauth');
const LIMIT=8,WINDOW=15*60*1000;
module.exports=async(req,res)=>{
  // /api/auth/forgot and /api/auth/reset, see vercel.json.
  if(req.query?.route==='forgot')return forgot(req,res);
  if(req.query?.route==='reset')return reset(req,res);
  // /api/auth/oauth/:provider and its /callback (Google, Apple), see vercel.json.
  if(req.query?.route==='oauth')return oauth.start(req,res,String(req.query.provider||''));
  if(req.query?.route==='oauth-callback')return oauth.callback(req,res,String(req.query.provider||''));
  if(!method(req,res,'POST'))return;
  let fields;try{fields=credentials(req.body);}catch(e){return json(res,400,{detail:e.message});}
  try{
    const db=await database(),coll=db.collection('login_limits');
    const key=fields.email;const now=new Date();
    // Per connection too: many addresses tried from one place.
    if(!await allow(db,`login-ip:${clientIp(req)}`,40,WINDOW))return json(res,429,{detail:'Trop de tentatives. Réessaie dans 15 minutes.'});
    const state=await coll.findOne({_id:key});
    if(state&&state.expires_at>now&&state.count>=LIMIT)return json(res,429,{detail:'Trop de tentatives. Réessaie dans 15 minutes.'});
    const user=await db.collection('users').findOne({email:key});
    const correct=user?await matches(fields.password,user.password_hash):false;
    if(!correct){
      if(!state||state.expires_at<=now)await coll.updateOne({_id:key},{$set:{count:1,expires_at:new Date(Date.now()+WINDOW)}},{upsert:true});
      else await coll.updateOne({_id:key},{$inc:{count:1}});
      return json(res,401,{detail:'Adresse email ou mot de passe incorrect.'});
    }
    await coll.deleteOne({_id:key});
    if(req.body?.pending_generation?.completed===true)await addGeneration(db,String(user._id),req.body.pending_generation);
    issue(res,user);
    return json(res,200,{user:publicUser(user)});
  }catch(e){return fail(res,e);}
};

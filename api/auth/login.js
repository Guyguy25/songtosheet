'use strict';
const {database}=require('../../lib/mongodb');
const {issue,publicUser,json}=require('../../lib/session');
const {method,credentials,fail}=require('../../lib/authorization');
const {matches}=require('../../lib/passwords');
const {addGeneration}=require('../../lib/generations');
const LIMIT=8,WINDOW=15*60*1000;
module.exports=async(req,res)=>{
  if(!method(req,res,'POST'))return;
  let fields;try{fields=credentials(req.body);}catch(e){return json(res,400,{detail:e.message});}
  try{
    const db=await database(),coll=db.collection('login_limits');
    const key=fields.email;const now=new Date();
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

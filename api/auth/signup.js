'use strict';
const {database}=require('../../lib/mongodb');
const {issue,publicUser,json}=require('../../lib/session');
const {method,credentials,fail}=require('../../lib/authorization');
const {make}=require('../../lib/passwords');
const {cleanGeneration,addGeneration,ensureIndexes}=require('../../lib/generations');
module.exports=async(req,res)=>{
  if(!method(req,res,'POST'))return;
  let fields,pending=null;
  try{
    fields=credentials(req.body);
    if(req.body?.pending_generation?.completed===true){
      cleanGeneration(req.body.pending_generation);
      pending=req.body.pending_generation;
    }
  }catch(e){return json(res,400,{detail:e.message});}
  try{
    const db=await database();await ensureIndexes(db);
    const password_hash=await make(fields.password);
    const result=await db.collection('users').insertOne({email:fields.email,password_hash,created_at:new Date(),tier:'free'});
    const user={_id:result.insertedId,email:fields.email};
    if(pending)await addGeneration(db,String(user._id),pending);
    issue(res,user);
    return json(res,201,{user:publicUser(user)});
  }catch(e){return fail(res,e);}
};

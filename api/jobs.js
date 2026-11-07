'use strict';
const {database}=require('../lib/mongodb');
const {authenticated,json}=require('../lib/session');
const {method,fail}=require('../lib/authorization');
const {serial,addGeneration}=require('../lib/generations');
module.exports=async(req,res)=>{
  if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');return json(res,405,{detail:'Méthode non autorisée.'});}
  if(!method(req,res,req.method))return;
  try{
    const user=await authenticated(req);
    if(!user)return json(res,401,{detail:'Connecte-toi pour retrouver tes créations.'});
    const db=await database();
    if(req.method==='GET'){
      const jobs=await db.collection('generations').find({user_id:user._id}).sort({created_at:-1}).limit(100).toArray();
      return json(res,200,{jobs:jobs.map(serial)});
    }
    const generation=req.body?.generation||req.body;
    if(generation?.completed!==true)return json(res,400,{detail:'Seules les créations de démonstration terminées peuvent être enregistrées.'});
    let job;
    try{job=await addGeneration(db,String(user._id),generation);}
    catch(e){if(e.message?.includes('Choisis')||e.message?.includes('titre')||e.message?.includes('durée')||e.message?.includes('Session'))return json(res,400,{detail:e.message});throw e;}
    return json(res,201,{job});
  }catch(e){return fail(res,e);}
};

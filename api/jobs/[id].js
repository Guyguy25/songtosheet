'use strict';
const {ObjectId}=require('mongodb');
const {database}=require('../../lib/mongodb');
const {authenticated,json}=require('../../lib/session');
const {method,fail}=require('../../lib/authorization');
const {serial}=require('../../lib/generations');
module.exports=async(req,res)=>{
  if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');return json(res,405,{detail:'Méthode non autorisée.'});}
  if(!method(req,res,req.method))return;
  const id=String(req.query?.id||'');
  if(!/^[0-9a-f]{24}$/i.test(id))return json(res,404,{detail:'Création introuvable.'});
  try{
    const user=await authenticated(req);
    if(!user)return json(res,401,{detail:'Connexion requise.'});
    const collection=(await database()).collection('generations');
    const filter={_id:new ObjectId(id),user_id:user._id};
    let job=await collection.findOne(filter);
    if(!job)return json(res,404,{detail:'Création introuvable.'});
    if(req.method==='POST'){
      if(req.body?.action!=='reveal')return json(res,400,{detail:'Action invalide.'});
      await collection.updateOne(filter,{$set:{preview_revealed:true,revealed_at:new Date()}});
      job=await collection.findOne(filter);
    }
    return json(res,200,serial(job));
  }catch(e){return fail(res,e);}
};

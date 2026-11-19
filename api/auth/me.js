'use strict';
const {authenticated,publicUser,json}=require('../../lib/session');
const {fail}=require('../../lib/authorization');
const {database}=require('../../lib/mongodb');
const {cleanProfile}=require('../../lib/profile');
const {starterUntil}=require('../../lib/billing-store');
module.exports=async(req,res)=>{
  if(!['GET','PATCH'].includes(req.method)){
    res.setHeader('Allow','GET, PATCH');
    return json(res,405,{detail:'Méthode non autorisée.'});
  }
  try{
    const user=await authenticated(req);
    if(req.method==='GET'){
      if(!user)return json(res,200,{user:null});
      // Starter: when the next whole song is available (open 24-hour window), shown on the CTAs.
      const until=publicUser(user).plan==='starter'?await starterUntil(await database(),user._id).catch(()=>null):null;
      return json(res,200,{user:{...publicUser(user),...(until?{starter_until:until}:{})}});
    }
    if(!user)return json(res,401,{detail:'Connexion requise.'});
    let update;
    try{update=cleanProfile(req.body||{});}catch(e){return json(res,400,{detail:e.message});}
    const set=Object.fromEntries(Object.entries(update).map(([key,value])=>['profile.'+key,value]));
    await (await database()).collection('users').updateOne({_id:user._id},{$set:set});
    return json(res,200,{user:publicUser({...user,profile:{...user.profile,...update}})});
  }catch(e){return fail(res,e);}
};

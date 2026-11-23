'use strict';
const {authenticated,publicUser,json}=require('../../lib/session');
const {fail}=require('../../lib/authorization');
const {database}=require('../../lib/mongodb');
const {cleanProfile}=require('../../lib/profile');
const {starterUntil}=require('../../lib/billing-store');
const {exportData,deleteAccount}=require('../../lib/account-flows');
const {langOf}=require('../../lib/email');
module.exports=async(req,res)=>{
  if(!['GET','PATCH','DELETE'].includes(req.method)){
    res.setHeader('Allow','GET, PATCH, DELETE');
    return json(res,405,{detail:'Méthode non autorisée.'});
  }
  try{
    const user=await authenticated(req);
    if(req.method==='DELETE'){
      if(!user)return json(res,401,{detail:'Connexion requise.'});
      return deleteAccount(req,res,user);
    }
    if(req.method==='GET'&&req.query?.export){
      if(!user)return json(res,401,{detail:'Connexion requise.'});
      return exportData(req,res,user);
    }
    if(req.method==='GET'){
      if(!user)return json(res,200,{user:null});
      // Language of the interface, for the emails sent later (sheet music ready).
      const lang=langOf(req);
      if(/tablurio_lang=/.test(String(req.headers?.cookie||''))&&user.lang!==lang)
        (await database()).collection('users').updateOne({_id:user._id},{$set:{lang}}).catch(()=>{});
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

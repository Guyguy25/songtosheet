'use strict';
/**
 * Account flows that need an email: address verification, forgotten password,
 * plus account deletion and data export (GDPR). Routed through existing functions
 * (the Hobby plan caps the number of functions), see vercel.json.
 */
const {ObjectId}=require('mongodb');
const {database}=require('./mongodb');
const {authenticated,issue,clear,publicUser,json}=require('./session');
const {method,fail}=require('./authorization');
const {make,matches}=require('./passwords');
const {issueCode,checkCode,CODE_MESSAGES}=require('./codes');
const {sendEmail,emailEnabled,langOf,emailLang,countryOf,langChosen}=require('./email');
const {allow,clientIp}=require('./rate-limit');

const HOUR=3600000;
const validEmail=value=>{
  const email=String(value||'').trim().toLowerCase();
  return email.length<=254&&/^\S+@\S+\.\S+$/.test(email)?email:null;
};

/** Sends a fresh verification code to a signed-in user. */
async function sendVerification(db,user,now=new Date()){
  const code=await issueCode(db,'verify',String(user._id),now);
  return sendEmail(user.email,'verify',{code,lang:emailLang(user)});
}

// POST /api/auth/verify  {code} to confirm, {resend:true} for a new code.
async function verify(req,res){
  if(!method(req,res,'POST'))return;
  try{
    const user=await authenticated(req);
    if(!user)return json(res,401,{detail:'Connexion requise.'});
    const db=await database();
    if(user.email_verified!==false)return json(res,200,{user:publicUser(user),verified:true});
    if(req.body?.resend){
      if(!await allow(db,`verify-send:${user._id}`,5,HOUR))return json(res,429,{detail:'Trop de codes demandés. Réessaie dans une heure.'});
      const sent=await sendVerification(db,user);
      if(!sent.sent)return json(res,503,{detail:'L’email n’a pas pu être envoyé. Réessaie dans un instant.'});
      return json(res,200,{sent:true});
    }
    const result=await checkCode(db,'verify',String(user._id),req.body?.code);
    if(result!=='ok')return json(res,400,{detail:CODE_MESSAGES[result],reason:result});
    await db.collection('users').updateOne({_id:user._id},{$set:{email_verified:true,email_verified_at:new Date()}});
    return json(res,200,{user:publicUser({...user,email_verified:true}),verified:true});
  }catch(e){return fail(res,e);}
}

// POST /api/auth/forgot  {email}: always the same answer, whether the account exists or not.
async function forgot(req,res){
  if(!method(req,res,'POST'))return;
  const email=validEmail(req.body?.email);
  if(!email)return json(res,400,{detail:'Indique une adresse email valide.'});
  if(!emailEnabled())return json(res,503,{detail:'La réinitialisation par email n’est pas encore disponible. Écris-nous pour récupérer ton compte.'});
  try{
    const db=await database();
    if(!await allow(db,`forgot-ip:${clientIp(req)}`,10,HOUR)||!await allow(db,`forgot:${email}`,4,HOUR))
      return json(res,429,{detail:'Trop de demandes. Réessaie dans une heure.'});
    const user=await db.collection('users').findOne({email},{projection:{_id:1}});
    if(user){
      const code=await issueCode(db,'reset',email);
      await sendEmail(email,'reset',{code,lang:emailLang({lang:langOf(req),lang_chosen:langChosen(req),country:countryOf(req)})});
    }
    return json(res,200,{sent:true});
  }catch(e){return fail(res,e);}
}

// POST /api/auth/reset, in two steps:
//   {email, code}            → the code is right: returns a one-time token (15 min)
//   {email, token, password} → new password, then signed in.
async function reset(req,res){
  if(!method(req,res,'POST'))return;
  const email=validEmail(req.body?.email);
  if(!email)return json(res,400,{detail:'Indique une adresse email valide.'});
  try{
    const db=await database();
    if(!await allow(db,`reset-ip:${clientIp(req)}`,20,HOUR))return json(res,429,{detail:'Trop de tentatives. Réessaie dans une heure.'});
    if(typeof req.body?.token!=='string'){
      const result=await checkCode(db,'reset',email,req.body?.code);
      if(result!=='ok')return json(res,400,{detail:CODE_MESSAGES[result],reason:result});
      return json(res,200,{token:await issueToken(db,email)});
    }
    const password=req.body?.password;
    if(typeof password!=='string'||password.length<8||password.length>128)return json(res,400,{detail:'Utilise un mot de passe de 8 à 128 caractères.'});
    if(!await useToken(db,email,req.body.token))return json(res,400,{detail:'Cette demande a expiré. Recommence depuis « Mot de passe oublié ».',reason:'expired'});
    const user=await db.collection('users').findOne({email});
    if(!user)return json(res,400,{detail:CODE_MESSAGES.expired,reason:'expired'});
    // The code proves the address: the email counts as verified too.
    await db.collection('users').updateOne({_id:user._id},{$set:{password_hash:await make(password),email_verified:true,password_changed_at:new Date()}});
    await db.collection('login_limits').deleteOne({_id:email});
    issue(res,user);
    return json(res,200,{user:publicUser({...user,email_verified:true})});
  }catch(e){return fail(res,e);}
}

// The token that links the two reset steps: random, stored hashed, used once.
const tokenHash=(email,token)=>require('node:crypto').createHash('sha256').update(`tablurio-reset-token:${email}:${token}`).digest('hex');
async function issueToken(db,email,now=new Date()){
  const token=require('node:crypto').randomBytes(24).toString('hex');
  await db.collection('email_codes').updateOne({_id:`resettoken:${email}`},
    {$set:{hash:tokenHash(email,token),expires_at:new Date(now.getTime()+15*60000)}},{upsert:true});
  return token;
}
async function useToken(db,email,token,now=new Date()){
  if(!/^[a-f0-9]{48}$/.test(token))return false;
  const entry=await db.collection('email_codes').findOne({_id:`resettoken:${email}`});
  if(!entry||new Date(entry.expires_at)<=now||entry.hash!==tokenHash(email,token))return false;
  await db.collection('email_codes').deleteOne({_id:`resettoken:${email}`});
  return true;
}

// GET /api/auth/me?export=1 — everything the account holds, as a JSON download.
async function exportData(req,res,user){
  const db=await database();
  const [account,jobs,generations,unlocks]=await Promise.all([
    db.collection('users').findOne({_id:user._id},{projection:{password_hash:0}}),
    db.collection('track_jobs').find({user_id:user._id},{projection:{exports:0,audio_url:0,lease:0}}).toArray(),
    db.collection('generations').find({user_id:String(user._id)}).toArray(),
    db.collection('billing_unlocks').find({user_id:user._id}).toArray()
  ]);
  res.setHeader('Content-Disposition','attachment; filename="tablurio-mes-donnees.json"');
  return json(res,200,{exported_at:new Date(),account,partitions:jobs,generations,full_songs:unlocks});
}

// DELETE /api/auth/me  {password}: deletes the account and everything attached to it.
async function deleteAccount(req,res,user){
  if(!method(req,res,'DELETE'))return;
  const db=await database();
  const full=await db.collection('users').findOne({_id:user._id});
  if(!await allow(db,`delete:${user._id}`,5,HOUR))return json(res,429,{detail:'Trop de tentatives. Réessaie dans une heure.'});
  if(!full||!await matches(String(req.body?.password||''),full.password_hash))return json(res,401,{detail:'Mot de passe incorrect.'});
  if(full.role==='admin')return json(res,400,{detail:'Le compte administrateur ne peut pas être supprimé d’ici.'});
  const id=full._id;
  const jobIds=(await db.collection('track_jobs').find({user_id:id},{projection:{_id:1}}).toArray()).map(job=>job._id);
  await Promise.all([
    db.collection('track_jobs').deleteMany({user_id:id}),
    db.collection('track_chunks').deleteMany({job_id:{$in:jobIds}}),
    db.collection('track_audio').deleteMany({job_id:{$in:jobIds}}),
    db.collection('track_review_audio').deleteMany({job_id:{$in:jobIds}}),
    db.collection('generations').deleteMany({user_id:String(id)}),
    db.collection('billing_unlocks').deleteMany({user_id:id}),
    db.collection('email_codes').deleteMany({_id:{$in:[`verify:${id}`,`reset:${full.email}`]}}),
    db.collection('analytics_visitors').updateMany({user_id:id},{$unset:{user_id:''}})
  ]);
  await db.collection('users').deleteOne({_id:id});
  clear(res);
  return json(res,200,{deleted:true,subscription:Boolean(full.billing?.active)});
}

module.exports={verify,forgot,reset,exportData,deleteAccount,sendVerification,issueToken,useToken};

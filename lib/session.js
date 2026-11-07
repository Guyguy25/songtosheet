'use strict';
const crypto=require('node:crypto');
const {database}=require('./mongodb');
const COOKIE='sts_session';
const DAYS=30;
function signKey(){
  const secret=process.env.AUTH_SESSION_SECRET||process.env.MONGODB_URI;
  if(!secret||secret.length<20)throw new Error('La configuration d’authentification est incomplète.');
  // Domain separation if the MongoDB secret is the only configured backend secret.
  return crypto.createHmac('sha256',secret).update('songtosheet-session-cookie-v1').digest();
}
function serialize(body){
  const text=Buffer.from(JSON.stringify(body)).toString('base64url');
  const mac=crypto.createHmac('sha256',signKey()).update(text).digest('base64url');
  return text+'.'+mac;
}
function issue(res,user){
  const value=serialize({uid:String(user._id),iat:Date.now(),exp:Date.now()+DAYS*86400000});
  res.setHeader('Set-Cookie',COOKIE+'='+value+'; Path=/; Max-Age='+(DAYS*86400)+'; HttpOnly; Secure; SameSite=Lax');
}
function clear(res){res.setHeader('Set-Cookie',COOKIE+'=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');}
function cookie(req){
  const raw=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='));
  return raw?raw.slice((COOKIE+'=').length):null;
}
async function authenticated(req){
  const token=cookie(req);if(!token||token.length>2000)return null;
  const parts=token.split('.');if(parts.length!==2)return null;
  const valid=crypto.createHmac('sha256',signKey()).update(parts[0]).digest('base64url');
  const a=Buffer.from(valid),b=Buffer.from(parts[1]);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  let payload;try{payload=JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch(e){return null;}
  if(!payload||!Number.isFinite(payload.exp)||payload.exp<Date.now()||typeof payload.uid!=='string'||!/^[0-9a-f]{24}$/i.test(payload.uid))return null;
  const {ObjectId}=require('mongodb');
  const db=await database();
  return db.collection('users').findOne({_id:new ObjectId(payload.uid)},{projection:{email:1,created_at:1,role:1}});
}
function publicUser(user){return user?{id:String(user._id),email:user.email,credits:0,role:user.role==='admin'?'admin':'user'}:null;}
function json(res,status,payload){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json(payload);
}
function allowed(req){
  const origin=req.headers.origin;
  if(!origin)return true;
  try{const url=new URL(origin);return url.protocol==='https:'&&url.host===String(req.headers.host||'');}
  catch(e){return false;}
}
module.exports={issue,clear,authenticated,publicUser,json,allowed};

'use strict';
// Also serves the funnel analytics (the Hobby plan caps the number of functions):
//   /api/collect      → ?route=collect (browser reports)
//   /api/admin/stats  → ?route=stats   (admin dashboard)
const {database}=require('../lib/mongodb');
const {ensureIndexes}=require('../lib/generations');
const {authenticated,json}=require('../lib/session');
const {method}=require('../lib/authorization');
const {collect,stats}=require('../lib/analytics');
const {allow,clientIp}=require('../lib/rate-limit');
const {ObjectId}=require('mongodb');
const crypto=require('node:crypto');
const {runNudges,validUnsubscribe}=require('../lib/nudges');

// /api/cron/nudges (POST, Authorization: Bearer CRON_SECRET): hourly follow-up emails.
async function nudgesRoute(req,res){
  const expected=process.env.CRON_SECRET||'';
  const given=String(req.headers.authorization||'').replace(/^Bearer /,'');
  const ok=expected.length>=16&&given.length===expected.length&&crypto.timingSafeEqual(Buffer.from(given),Buffer.from(expected));
  if(!ok)return json(res,401,{detail:'Non autorisé.'});
  return json(res,200,await runNudges(await database(),new Date(),{dryRun:req.query?.dry==='1'}));
}

// /api/desabonnement?u=…&t=… : stops follow-up emails (link in every follow-up, one-click POST too).
async function unsubscribeRoute(req,res){
  const id=String(req.query?.u||''),token=req.query?.t;
  const valid=ObjectId.isValid(id)&&validUnsubscribe(id,token);
  if(valid)await (await database()).collection('users').updateOne({_id:new ObjectId(id)},{$set:{nudges_off:true,nudges_off_at:new Date()}});
  if(req.method==='POST'){res.statusCode=valid?200:400;return res.end();}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.statusCode=valid?200:400;
  return res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tablurio</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4fb;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;color:#1e1533">
<div style="max-width:440px;margin:20px;padding:30px;background:#fff;border:1px solid #ebe5f5;border-radius:18px;text-align:center">
<p style="font-size:18px;font-weight:800;margin:0 0 14px">tablurio<span style="color:#6d3ddc">.com</span></p>
<h1 style="font-size:21px;margin:0 0 10px">${valid?'C’est noté.':'Lien invalide.'}</h1>
<p style="color:#5f557a;line-height:1.6;margin:0 0 18px">${valid?'Tu ne recevras plus d’emails de relance. Les emails utiles à ton compte (codes, partition prête) continuent d’arriver.<br><span style="font-size:13px">You won’t receive reminder emails anymore.</span>':'Ce lien de désinscription n’est pas valide. Écris-nous à contact@tablurio.com.'}</p>
<a href="/" style="display:inline-block;background:#6d3ddc;color:#fff;text-decoration:none;font-weight:750;padding:12px 18px;border-radius:12px">Retour sur Tablurio</a></div></body></html>`);
}

async function collectRoute(req,res){
  if(!method(req,res,'POST'))return;
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body);}catch{body=null;}}
  try{
    const db=await database();
    // A script flooding the statistics is cut off; a real visitor sends a few reports a minute.
    if(!await allow(db,`collect:${clientIp(req)}`,120,60000)){res.statusCode=204;return res.end();}
    const user=body?.step==='identify'?await authenticated(req):null;
    const result=await collect(db,req,body||{},user);
    res.statusCode=result.status;
    return res.end();
  }catch(error){
    console.error('analytics collect:',error.message);
    res.statusCode=204;
    return res.end();
  }
}

async function statsRoute(req,res){
  if(!method(req,res,'GET'))return;
  const user=await authenticated(req);
  if(user?.role!=='admin')return json(res,403,{detail:'Réservé à l’administrateur.'});
  const days=Math.min(365,Math.max(1,Number.parseInt(req.query?.days,10)||30));
  const db=await database();
  const data=await stats(db,{days});
  // Mode Apprentissage : un incident ici ne doit pas priver l'admin des autres KPI.
  data.learn=await learnStats(db,new Date(Date.now()-days*86400000)).catch(()=>null);
  // Notes données au retour (pop-up « Combien tu notes ta génération ? »).
  const admins=new Set((await db.collection('users').find({role:'admin'},{projection:{_id:1}}).toArray()).map(u=>String(u._id)));
  data.ratings=await ratingStats(db,new Date(Date.now()-days*86400000),admins).catch(()=>null);
  // Écoutes (bouton lecture sur l'écran partition).
  data.plays=await playStats(db,new Date(Date.now()-days*86400000)).catch(()=>null);
  return json(res,200,data);
}

const {learnStats}=require('../lib/learn');
const {ratingStats}=require('../lib/ratings');
const {playStats}=require('../lib/plays');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const route=req.query?.route;
  if(route==='collect')return collectRoute(req,res);
  if(route==='unsubscribe'){
    try{return await unsubscribeRoute(req,res);}catch(error){console.error('désabonnement :',error.message);return json(res,500,{detail:'Erreur.'});}
  }
  if(route==='nudges'){
    if(!method(req,res,'POST'))return;
    try{return await nudgesRoute(req,res);}catch(error){console.error('relances :',error.message);return json(res,500,{detail:error.message});}
  }
  if(route==='stats'){
    try{return await statsRoute(req,res);}
    catch(error){console.error('analytics stats:',error.message);return json(res,500,{detail:'Statistiques indisponibles.'});}
  }
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({status:'method_not_allowed'});}
  try{
    const db=await database();
    await db.command({ping:1});
    await ensureIndexes(db);
    return res.status(200).json({status:'ok'});
  }catch(error){
    return res.status(503).json({status:'unavailable'});
  }
};

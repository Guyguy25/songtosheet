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

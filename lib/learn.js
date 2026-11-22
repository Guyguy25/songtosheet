'use strict';
// Mode Apprentissage : progression par morceau, XP et série de jours.
// Le client envoie sa précision et sa vitesse ; les étoiles et l'XP sont recalculées ici.
const {starsFor,xpFor,SPEEDS}=require('../backend/web/learn-core.js');
const {trackFilter,isId}=require('./track-jobs');

const VERSION=/^[a-z0-9_-]{1,24}$/i;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,Number(value)||0));
const fail=(status,message)=>Object.assign(new Error(message),{status});

const dayNumber=day=>Date.UTC(+day.slice(0,4),+day.slice(5,7)-1,+day.slice(8,10))/86400000;
function nextStreak(streak,day){
  if(!streak?.last_day)return {count:1,last_day:day};
  const gap=dayNumber(day)-dayNumber(streak.last_day);
  if(gap<=0)return {count:streak.count,last_day:streak.last_day};
  return {count:gap===1?streak.count+1:1,last_day:day};
}
// Série affichée : elle tombe à 0 si le dernier jour joué est avant-hier ou plus ancien.
const currentStreak=(streak,day)=>!streak?.last_day||!DAY.test(day||'')?{count:streak?.count||0,last_day:streak?.last_day||null}
  :{count:dayNumber(day)-dayNumber(streak.last_day)<=1?streak.count:0,last_day:streak.last_day};

function checkKey({id,version}){
  if(!isId(id))throw fail(400,'Morceau invalide.');
  if(typeof version!=='string'||!VERSION.test(version))throw fail(400,'Version invalide.');
}
async function findJob(db,user,id){
  const job=await db.collection('track_jobs').findOne({...trackFilter(id,user),status:'completed'});
  if(!job)throw fail(404,'Morceau introuvable.');
  return job;
}
const progressKey=(user,job,version)=>({user_id:user._id,job_id:job._id,version});

async function saveResult(db,user,input){
  checkKey(input);
  const level=Number(input.level);
  if(!Number.isInteger(level)||level<0||level>500)throw fail(400,'Niveau invalide.');
  if(typeof input.day!=='string'||!DAY.test(input.day))throw fail(400,'Date invalide.');
  const job=await findJob(db,user,input.id);
  if(job.preview_limit){
    // Aperçu : la fin du niveau est obligatoire et doit rester dans les secondes ouvertes.
    const limit=Number(job.preview_duration||job.preview_limit),end=Number(input.end);
    if(input.end===undefined||input.end===null||!Number.isFinite(end)||end<=0||end>limit+.5)throw fail(403,'Niveau hors de ton aperçu.');
  }
  const mic=input.mic===true,boss=input.boss===true;
  const accuracy=clamp(input.accuracy,0,1),speed=clamp(input.speed,SPEEDS[0],1);
  const stars=mic?starsFor(accuracy,speed):0;
  const gained=mic?xpFor({notes:input.notes,accuracy,speed,boss}):0;
  const key=progressKey(user,job,input.version);
  const progress=db.collection('learn_progress');
  await progress.createIndex({user_id:1,job_id:1,version:1},{unique:true}).catch(()=>null);
  const doc=await progress.findOne(key);
  const levels={...(doc?.levels||{})};
  const before=levels[level]||{stars:0,checked:false,best_accuracy:0,best_speed:0,attempts:0,mic:false,completed_at:null};
  const now=new Date();
  const done=stars>0||!mic;
  const after={
    stars:Math.max(before.stars,stars),
    checked:before.checked||!mic,
    best_accuracy:mic?Math.max(before.best_accuracy,accuracy):before.best_accuracy,
    best_speed:mic&&stars>0?Math.max(before.best_speed,speed):before.best_speed,
    attempts:before.attempts+1,
    mic:before.mic||(mic&&stars>0),
    boss,
    completed_at:before.completed_at||(done?now:null)
  };
  levels[level]=after;
  const xp=(doc?.xp||0)+gained;
  await progress.updateOne(key,{$set:{levels,xp,updated_at:now},$setOnInsert:{unlock_clicks:0,created_at:now}},{upsert:true});
  const users=db.collection('users');
  const account=await users.findOne({_id:user._id});
  const streak=done?nextStreak(account?.learn_streak,input.day):currentStreak(account?.learn_streak,input.day);
  const total=(account?.learn_xp_total||0)+gained;
  await users.updateOne({_id:user._id},{$set:{learn_xp_total:total,...(done?{learn_streak:streak}:{})}});
  return {level:after,xp_gained:gained,xp_total:total,streak};
}

async function getProgress(db,user,{id,version,day}){
  checkKey({id,version});
  const job=await findJob(db,user,id);
  const [doc,account]=await Promise.all([db.collection('learn_progress').findOne(progressKey(user,job,version)),
    db.collection('users').findOne({_id:user._id})]);
  return {levels:doc?.levels||{},xp:doc?.xp||0,xp_total:account?.learn_xp_total||0,streak:currentStreak(account?.learn_streak,day)};
}

async function recordUnlockClick(db,user,{id,version}){
  checkKey({id,version});
  const job=await findJob(db,user,id);
  const key=progressKey(user,job,version),progress=db.collection('learn_progress');
  const doc=await progress.findOne(key),now=new Date();
  await progress.updateOne(key,{$set:{unlock_clicks:(doc?.unlock_clicks||0)+1,updated_at:now},
    $setOnInsert:{levels:{},xp:0,created_at:now}},{upsert:true});
}

async function learnStats(db,since){
  const docs=await db.collection('learn_progress').find({updated_at:{$gte:since}}).toArray();
  const levels=docs.flatMap(doc=>Object.values(doc.levels||{})).filter(l=>l.stars>0||l.checked);
  return {
    players:new Set(docs.filter(d=>Object.keys(d.levels||{}).length).map(d=>String(d.user_id))).size,
    levels_done:levels.length,
    songs:docs.filter(d=>Object.keys(d.levels||{}).length).length,
    mic_share:levels.length?Math.round(levels.filter(l=>l.mic).length/levels.length*100)/100:0,
    unlock_clicks:docs.reduce((sum,d)=>sum+(d.unlock_clicks||0),0)
  };
}

// /api/learn → /api/jobs?route=learn (pas de nouvelle fonction Vercel).
async function learnRoute(req,res){
  const {authenticated,json}=require('./session');
  const {method}=require('./authorization');
  const {database}=require('./mongodb');
  if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');return json(res,405,{detail:'Méthode non autorisée.'});}
  if(!method(req,res,req.method))return;
  try{
    const user=await authenticated(req);
    if(!user)return json(res,401,{detail:'Connecte-toi pour enregistrer ta progression.'});
    const db=await database();
    if(req.method==='GET')return json(res,200,await getProgress(db,user,req.query||{}));
    const body=req.body||{};
    if(body.action==='unlock'){await recordUnlockClick(db,user,body);return json(res,200,{ok:true});}
    if(body.action==='result')return json(res,200,await saveResult(db,user,body));
    return json(res,400,{detail:'Action invalide.'});
  }catch(error){
    if(error.status)return json(res,error.status,{detail:error.message});
    console.error('learn:',error?.message);
    return json(res,503,{detail:'Progression indisponible. Réessaie un peu plus tard.'});
  }
}

module.exports={nextStreak,saveResult,getProgress,recordUnlockClick,learnStats,learnRoute,currentStreak};

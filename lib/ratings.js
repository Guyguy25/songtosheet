'use strict';
/**
 * Retours des comptes et note des générations.
 * - Chaque jour (heure de Paris) où un compte ouvre le site est noté une fois : users.seen_days.
 * - Quand un compte revient un jour APRÈS une génération terminée, il voit une pop-up :
 *   « Combien tu notes cette génération ? » (1 à 5), puis des questions qui dépendent de la note.
 *   La note est rangée sur la génération : track_jobs.rating = {score, reasons, comment, at}.
 * Les identifiants des raisons restent stables : les réponses sont stockées par identifiant.
 */
const {ObjectId}=require('mongodb');

const DAY=86400000;
const PROMPT_WINDOW_DAYS=14; // une génération plus vieille n'est plus proposée à la note
const SEEN_DAYS_KEPT=400;

const parisDay=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
const nextDay=day=>new Date(Date.parse(day+'T12:00:00Z')+DAY).toISOString().slice(0,10);
const daysBetween=(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/DAY);

// Questions selon la note : 1-2 (déçu), 3 (moyen), 4-5 (content).
const bucketOf=score=>score<=2?'low':score===3?'mid':'high';
const QUESTIONS={
  low:{
    title:{fr:'Aïe. Qu’est-ce qui n’a pas marché ?',en:'Ouch. What went wrong?'},
    placeholder:{fr:'Quel passage, quelle mesure ? On corrige en priorité ce que tu nous signales.',en:'Which part, which bar? We fix what you report first.'},
    reasons:{
      wrong_notes:{fr:'Des notes fausses',en:'Wrong notes'},
      rhythm:{fr:'Le rythme ne colle pas',en:'Rhythm is off'},
      missing:{fr:'Des passages manquent',en:'Parts are missing'},
      unplayable:{fr:'Trop dur à jouer',en:'Too hard to play'},
      instrument:{fr:'Mauvais instrument entendu',en:'Wrong instrument picked up'},
      slow:{fr:'Trop long à générer',en:'Too slow to generate'}
    }
  },
  mid:{
    title:{fr:'Qu’est-ce qui manquait pour un 5 ?',en:'What was missing for a 5?'},
    placeholder:{fr:'Dis-nous ce qui t’aurait fait mettre 5 étoiles.',en:'Tell us what would have earned 5 stars.'},
    reasons:{
      accuracy:{fr:'Plus de notes justes',en:'More accurate notes'},
      rhythm:{fr:'Un rythme plus précis',en:'More precise rhythm'},
      simpler:{fr:'Une version plus simple',en:'A simpler version'},
      complete:{fr:'Le morceau en entier',en:'The whole song'},
      speed:{fr:'Une génération plus rapide',en:'Faster generation'},
      features:{fr:'Des fonctions en plus',en:'More features'}
    }
  },
  high:{
    title:{fr:'Génial ! Qu’est-ce qui t’a le plus plu ?',en:'Great! What did you like most?'},
    placeholder:{fr:'Un mot pour l’équipe ?',en:'A word for the team?'},
    reasons:{
      accuracy:{fr:'Les notes sont justes',en:'The notes are right'},
      speed:{fr:'C’est rapide',en:'It’s fast'},
      playable:{fr:'Facile à jouer',en:'Easy to play'},
      listen:{fr:'L’écoute avec la partition',en:'Listening along the score'},
      learn:{fr:'Le mode jeu',en:'The game mode'},
      price:{fr:'Plus besoin d’acheter la partition',en:'No need to buy sheet music'}
    }
  }
};

function cleanRating(body){
  const score=Number(body?.score);
  if(!Number.isInteger(score)||score<1||score>5)throw new Error('Note invalide.');
  const allowed=QUESTIONS[bucketOf(score)].reasons;
  const reasons=Array.isArray(body.reasons)?[...new Set(body.reasons.filter(r=>typeof r==='string'&&Object.hasOwn(allowed,r)))]:[];
  const comment=typeof body.comment==='string'?body.comment.replace(/[\u0000-\u0008\u000b-\u001f]/g,'').trim().slice(0,600):'';
  return {score,reasons,comment};
}

/** Note le jour de passage d'un compte, une seule écriture par jour. */
async function recordSeen(db,user,now=new Date()){
  if(!user?._id||user.guest)return false;
  const today=parisDay(now);
  if(user.seen_last_day===today)return false;
  const result=await db.collection('users').updateOne({_id:user._id,seen_last_day:{$ne:today}},
    {$set:{seen_last_day:today,last_seen_at:now},$push:{seen_days:{$each:[today],$slice:-SEEN_DAYS_KEPT}}});
  return result.modifiedCount===1;
}

/**
 * La génération à faire noter : la plus récente terminée, faite un jour AVANT aujourd'hui (heure de Paris),
 * il y a moins de 14 jours, jamais notée ni refusée. Les versions d'un même morceau comptent comme une seule.
 */
function pickJob(jobs,now=new Date()){
  const today=parisDay(now);
  const closed=new Set(jobs.filter(j=>j.rating||j.rating_dismissed_at).map(j=>String(j.parent_id||j._id)));
  return jobs.filter(j=>j.status==='completed'&&!j.guest_expires_at&&j.created_at
      &&parisDay(j.created_at)<today&&now-new Date(j.created_at)<=PROMPT_WINDOW_DAYS*DAY
      &&!closed.has(String(j.parent_id||j._id)))
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;
}

const promptOf=job=>job&&{job:String(job._id),title:job.title||job.source_name||'',instrument:job.instrument||'',
  kind:job.variant?'full':'preview',created_at:job.created_at};

/** GET /api/auth/rating et POST /api/auth/rating (route de api/auth/wait-survey.js). */
async function ratingRoute(req,res,{db,user,json}){
  const users=db.collection('users'),jobs=db.collection('track_jobs');
  if(req.method==='GET'){
    // Aperçu pour l'admin : la pop-up sur sa dernière génération, sans rien enregistrer.
    if(req.query?.preview&&user.role==='admin'){
      const last=await jobs.find({user_id:user._id,status:'completed'}).sort({created_at:-1}).limit(1).next();
      return json(res,200,{prompt:promptOf(last)||{job:'',title:'Bohemian Rhapsody — Queen',instrument:'piano',kind:'full',created_at:new Date(Date.now()-DAY)},questions:QUESTIONS,preview:true});
    }
    // Le compte admin sert à créer du contenu : pas de pop-up automatique.
    if(user.role==='admin')return json(res,200,{prompt:null});
    const now=new Date(),today=parisDay(now);
    const profile=await users.findOne({_id:user._id},{projection:{rating_prompted_day:1}});
    if(profile?.rating_prompted_day===today)return json(res,200,{prompt:null});
    const recent=await jobs.find({user_id:user._id,created_at:{$gte:new Date(now-PROMPT_WINDOW_DAYS*DAY)}},
      {projection:{status:1,created_at:1,title:1,source_name:1,instrument:1,variant:1,parent_id:1,guest_expires_at:1,rating:1,rating_dismissed_at:1}}).limit(200).toArray();
    const job=pickJob(recent,now);
    if(!job)return json(res,200,{prompt:null});
    return json(res,200,{prompt:promptOf(job),questions:QUESTIONS});
  }
  const body=typeof req.body==='string'?(()=>{try{return JSON.parse(req.body);}catch{return {};}})():req.body||{};
  if(typeof body.job!=='string'||!/^[a-f0-9]{24}$/i.test(body.job))return json(res,400,{detail:'Génération inconnue.'});
  const filter={_id:new ObjectId(body.job),user_id:user._id};
  // La pop-up vient de s'ouvrir à l'écran : une seule par jour, et le tableau de bord compte les affichages.
  if(body.shown===true){
    const now=new Date();
    await Promise.all([users.updateOne({_id:user._id},{$set:{rating_prompted_day:parisDay(now)}}),
      jobs.updateOne(filter,{$set:{rating_prompted_at:now},$inc:{rating_prompts:1}})]);
    return json(res,200,{ok:true});
  }
  if(body.dismiss===true){
    await jobs.updateOne({...filter,rating:{$exists:false}},{$set:{rating_dismissed_at:new Date()}});
    return json(res,200,{ok:true});
  }
  let rating;
  try{rating=cleanRating(body);}catch(error){return json(res,400,{detail:error.message});}
  const lang=body.lang==='en'?'en':'fr';
  const saved=await jobs.updateOne(filter,{$set:{rating:{...rating,lang,at:new Date()}},$unset:{rating_dismissed_at:''}});
  if(!saved.matchedCount)return json(res,404,{detail:'Génération introuvable.'});
  return json(res,200,{ok:true});
}

/** KPI du tableau de bord : notes données sur la période. admins : ids des comptes admin (exclus). */
async function ratingStats(db,since,admins=new Set()){
  const rows=await db.collection('track_jobs').find({$or:[{'rating.at':{$gte:since}},{rating_dismissed_at:{$gte:since}},{rating_prompted_at:{$gte:since}}]},
    {projection:{user_id:1,title:1,source_name:1,instrument:1,variant:1,rating:1,rating_dismissed_at:1,rating_prompted_at:1}}).limit(5000).toArray();
  const own=rows.filter(r=>!admins.has(String(r.user_id)));
  const shown=own.filter(r=>r.rating_prompted_at&&new Date(r.rating_prompted_at)>=since).length;
  const rated=own.filter(r=>r.rating&&new Date(r.rating.at)>=since);
  const dismissed=own.filter(r=>!r.rating&&r.rating_dismissed_at).length;
  const distribution=[1,2,3,4,5].map(score=>rated.filter(r=>r.rating.score===score).length);
  const reasons={low:{},mid:{},high:{}};
  for(const r of rated)for(const reason of r.rating.reasons||[]){
    const bucket=reasons[bucketOf(r.rating.score)];
    bucket[reason]=(bucket[reason]||0)+1;
  }
  const ids=[...new Set(rated.map(r=>String(r.user_id)))].map(id=>new ObjectId(id));
  const accounts=new Map((await db.collection('users').find({_id:{$in:ids}},{projection:{email:1,profile:1}}).toArray())
    .map(u=>[String(u._id),u.profile?.pseudo||u.email]));
  const recent=[...rated].sort((a,b)=>new Date(b.rating.at)-new Date(a.rating.at)).slice(0,40).map(r=>({
    at:r.rating.at,score:r.rating.score,reasons:r.rating.reasons||[],comment:r.rating.comment||'',
    title:r.title||r.source_name||'Sans titre',instrument:r.instrument||'',kind:r.variant?'full':'preview',
    account:accounts.get(String(r.user_id))||'—'}));
  const sum=rated.reduce((total,r)=>total+r.rating.score,0);
  return {count:rated.length,dismissed,shown,average:rated.length?Math.round(sum/rated.length*10)/10:0,
    answer_rate:Math.max(shown,rated.length+dismissed)?Math.round(rated.length/Math.max(shown,rated.length+dismissed)*1000)/10:0,
    distribution,reasons,recent,labels:QUESTIONS};
}

/**
 * Retours des comptes (users avec created_at, seen_days) sur la période [since, now].
 * - returning : comptes revenus pendant la période un autre jour que celui de leur inscription
 * - d1 / d7 : parmi les inscrits de la période assez anciens, part revenue le lendemain / dans les 7 jours suivants
 */
function retention(users,since,now=new Date()){
  const sinceDay=parisDay(since),today=parisDay(now);
  const tracked=users.filter(u=>u.created_at&&Array.isArray(u.seen_days));
  const later=u=>{const start=parisDay(u.created_at);return u.seen_days.filter(day=>day>start);};
  const returning=tracked.filter(u=>later(u).some(day=>day>=sinceDay));
  const cohort=(gap)=>users.filter(u=>u.created_at&&new Date(u.created_at)>=since&&daysBetween(parisDay(u.created_at),today)>=gap);
  const d1Cohort=cohort(1),d7Cohort=cohort(7);
  const backNextDay=d1Cohort.filter(u=>(u.seen_days||[]).includes(nextDay(parisDay(u.created_at)))).length;
  const backWithin7=d7Cohort.filter(u=>later(u).some(day=>daysBetween(parisDay(u.created_at),day)<=7)).length;
  const rate=(part,whole)=>whole?Math.round(part/whole*1000)/10:0;
  // Par jour : nombre de comptes revenus ce jour-là (hors jour d'inscription).
  const byDay=new Map();
  for(const u of tracked)for(const day of later(u))if(day>=sinceDay)byDay.set(day,(byDay.get(day)||0)+1);
  return {returning:returning.length,
    returning_days:returning.reduce((total,u)=>total+later(u).filter(day=>day>=sinceDay).length,0),
    d1:rate(backNextDay,d1Cohort.length),d1_back:backNextDay,d1_cohort:d1Cohort.length,
    d7:rate(backWithin7,d7Cohort.length),d7_back:backWithin7,d7_cohort:d7Cohort.length,
    by_day:byDay,
    list:returning.map(u=>({id:String(u._id),email:u.email,pseudo:u.profile?.pseudo||'',created_at:u.created_at,
      last_seen_at:u.last_seen_at||null,days:later(u).length+1,return_days:later(u).length}))
      .sort((a,b)=>new Date(b.last_seen_at||0)-new Date(a.last_seen_at||0)).slice(0,40)};
}

module.exports={QUESTIONS,bucketOf,cleanRating,parisDay,nextDay,recordSeen,pickJob,ratingRoute,ratingStats,retention,PROMPT_WINDOW_DAYS};

'use strict';
/**
 * First-party funnel analytics for the admin dashboard.
 * The browser keeps a random visitor id (no cookie, no IP stored) and reports a few steps:
 * page views, real interaction (bots never interact), start, preview launched, plan page, checkout.
 * Signups, generations and payments are read from the database itself, so they are exact.
 */
const {ObjectId}=require('mongodb');
const {effectiveTier}=require('./billing');

const VISITOR=/^[A-Za-z0-9_-]{16,40}$/;
const STEPS=new Set(['engaged','start','preview','signup_open','pricing','checkout']);
const BOT=/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|facebookcatalog|meta-externalagent|meta-externalfetcher|baiduspider|embedly|whatsapp|telegram|discord|curl|wget|python|node-fetch|axios|go-http|java\/|vercel-screenshot|monitor|uptime|scan/i;
const MONTHLY={starter:10,pro:19};
const DAY=86400000;

function clean(value,max=80){
  return typeof value==='string'?value.replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,max):'';
}

function device(ua){
  if(/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua))return 'Tablette';
  if(/Mobi|iPhone|iPod|Android/i.test(ua))return 'Mobile';
  return 'Ordinateur';
}
function os(ua){
  if(/iPhone|iPad|iPod/i.test(ua))return 'iOS';
  if(/Android/i.test(ua))return 'Android';
  if(/Windows/i.test(ua))return 'Windows';
  if(/Mac OS X|Macintosh/i.test(ua))return 'macOS';
  if(/CrOS/i.test(ua))return 'ChromeOS';
  if(/Linux/i.test(ua))return 'Linux';
  return 'Autre';
}
function browser(ua){
  if(/musical_ly|BytedanceWebview|TikTok/i.test(ua))return 'TikTok (in-app)';
  if(/Instagram/i.test(ua))return 'Instagram (in-app)';
  if(/FBAN|FBAV|FB_IAB/i.test(ua))return 'Meta (in-app)';
  if(/Edg\//i.test(ua))return 'Edge';
  if(/OPR\/|Opera/i.test(ua))return 'Opera';
  if(/Firefox|FxiOS/i.test(ua))return 'Firefox';
  if(/SamsungBrowser/i.test(ua))return 'Samsung Internet';
  if(/Chrome|CriOS/i.test(ua))return 'Chrome';
  if(/Safari/i.test(ua))return 'Safari';
  return 'Autre';
}

const REFERRERS=[[/tiktok\./,'tiktok'],[/instagram\.|l\.instagram/,'instagram'],[/youtube\.|youtu\.be/,'youtube'],
  [/facebook\.|fb\.me|messenger\./,'meta'],[/(^|\.)t\.co$|twitter\.|x\.com/,'x'],[/google\./,'google'],
  [/bing\./,'bing'],[/duckduckgo\./,'duckduckgo'],[/reddit\./,'reddit'],[/linkedin\./,'linkedin'],[/snapchat\./,'snapchat'],
  [/whop\./,'whop'],[/chatgpt\.|openai\./,'chatgpt']];

/** Where a visit comes from: the utm_source first, then the in-app browser, then the referrer. */
function sourceOf({utm_source:utm,referrer},ua=''){
  const tagged=clean(utm,40).toLowerCase();
  if(tagged)return tagged;
  if(/musical_ly|BytedanceWebview|TikTok/i.test(ua))return 'tiktok';
  if(/Instagram/i.test(ua))return 'instagram';
  if(/(^|\/\/)(l\.|www\.)?instagram\.com/i.test(String(referrer||'')))return 'instagram';
  // Meta's shared in-app browser (Facebook, Messenger, sometimes Instagram): not Facebook for sure.
  if(/FBAN|FBAV|FB_IAB/i.test(ua))return 'meta';
  let host='';
  try{host=new URL(referrer).hostname.toLowerCase();}catch{}
  if(!host||/(^|\.)tablurio\.com$|songtosheet\.vercel\.app$/.test(host))return 'direct';
  return REFERRERS.find(([pattern])=>pattern.test(host))?.[1]||host.replace(/^www\./,'');
}

/** One report from the browser. user: the signed-in account, if any. */
async function collect(db,req,body,user,now=new Date()){
  const id=body?.visitor;
  if(typeof id!=='string'||!VISITOR.test(id))return {status:400};
  const ua=String(req.headers['user-agent']||'').slice(0,400);
  if(!ua||BOT.test(ua))return {status:204};
  const visitors=db.collection('analytics_visitors');
  const step=clean(body.step,20);
  const path=clean(body.path,120)||'/';
  const set={last_seen:now};
  const min={};
  if(STEPS.has(step))min[`steps.${step}`]=now;
  if(step==='engaged')set.human=true;
  if(user&&!user.guest){
    set.user_id=user._id;
    if(user.role==='admin')set.admin=true;
  }
  const update={
    $setOnInsert:{_id:id,first_seen:now,landing:path,source:sourceOf(body,ua),
      // TikTok only makes the bio link clickable: an untagged visit from its app comes from there.
      medium:clean(body.utm_medium,40)||(sourceOf(body,ua)==='tiktok'&&!body.utm_source?'bio':''),
      campaign:clean(body.utm_campaign,60),content:clean(body.utm_content,60),referrer:clean(body.referrer,200),
      device:device(ua),os:os(ua),browser:browser(ua),
      country:clean(String(req.headers['x-vercel-ip-country']||''),2).toUpperCase()||'??'},
    $set:set,
    ...(step==='view'?{$inc:{views:1}}:{}),
    ...(Object.keys(min).length?{$min:min}:{})
  };
  await visitors.updateOne({_id:id},update,{upsert:true});
  return {status:204};
}

const pct=(part,whole)=>whole?Math.round(part/whole*1000)/10:0;
const dayKey=date=>new Date(new Date(date).getTime()+3600000).toISOString().slice(0,10); // Paris (UTC+1)

/** The dashboard: KPIs, funnel, breakdowns and recent signups for the last `days` days. */
async function stats(db,{days=30}={},now=new Date()){
  const since=new Date(now.getTime()-days*DAY);
  const [visitors,users,jobs]=await Promise.all([
    db.collection('analytics_visitors').find({first_seen:{$gte:since}}).limit(50000).toArray(),
    db.collection('users').find({role:{$ne:'admin'}},{projection:{email:1,phone:1,created_at:1,billing:1,first_paid_at:1,profile:1}}).toArray(),
    db.collection('track_jobs').find({created_at:{$gte:since}},
      {projection:{user_id:1,created_at:1,finished_at:1,preview_limit:1,variant:1,status:1,instrument:1,guest_expires_at:1,cached_from:1,title:1,youtube_id:1,source_name:1,source_content:1,guitar_goal:1,parent_id:1}}).toArray()
  ]);
  const admins=new Set((await db.collection('users').find({role:'admin'},{projection:{_id:1}}).toArray()).map(u=>String(u._id)));
  // Visits recorded before the Meta/Instagram split were labelled 'facebook'.
  for(const v of visitors)if(v.source==='facebook')v.source='meta';
  const real=visitors.filter(v=>!v.admin&&!(v.user_id&&admins.has(String(v.user_id))));
  const humans=real.filter(v=>v.human);
  const userById=new Map(users.map(u=>[String(u._id),u]));
  const jobsOf=new Map();
  const ownJobs=jobs.filter(j=>!admins.has(String(j.user_id)));
  for(const job of ownJobs){
    const key=String(job.user_id);
    if(!jobsOf.has(key))jobsOf.set(key,[]);
    jobsOf.get(key).push(job);
  }
  const paying=u=>effectiveTier(u,now)!=='free';
  const newUsers=users.filter(u=>u.created_at&&new Date(u.created_at)>=since);
  const visitorOfUser=new Map();
  for(const v of real)if(v.user_id&&!visitorOfUser.has(String(v.user_id)))visitorOfUser.set(String(v.user_id),v);

  // Funnel over the human visitors who arrived in the period.
  const reached=v=>{
    const account=v.user_id?userById.get(String(v.user_id)):null;
    const own=v.user_id?jobsOf.get(String(v.user_id))||[]:[];
    const signedUp=Boolean(account&&new Date(account.created_at)>=new Date(new Date(v.first_seen).getTime()-10*60000));
    return {
      start:Boolean(v.steps?.start||v.steps?.preview||own.length),
      preview:Boolean(v.steps?.preview||own.some(j=>j.preview_limit)),
      signup:signedUp,
      full:own.some(j=>j.variant),
      paid:Boolean(account&&signedUp&&paying(account))
    };
  };
  const steps=humans.map(reached);
  const count=key=>steps.filter(s=>s[key]).length;
  const funnel=[
    {key:'visit',label:'Visiteurs (humains)',value:humans.length},
    {key:'start',label:'Ont commencé (lien collé, bouton)',value:count('start')},
    {key:'preview',label:'Ont lancé un aperçu',value:count('preview')},
    {key:'signup',label:'Se sont inscrits',value:count('signup')},
    {key:'full',label:'Ont généré un morceau entier',value:count('full')},
    {key:'paid',label:'Sont devenus payants',value:count('paid')}
  ].map((step,index,all)=>({...step,rate_from_visit:pct(step.value,all[0].value),rate_from_previous:index?pct(step.value,all[index-1].value):100}));

  // Breakdowns of the human visitors, with what each group went on to do.
  const breakdown=field=>{
    const groups=new Map();
    humans.forEach((v,index)=>{
      const key=v[field]||'—';
      const group=groups.get(key)||{key,visitors:0,preview:0,signup:0,paid:0};
      group.visitors++;
      if(steps[index].preview)group.preview++;
      if(steps[index].signup)group.signup++;
      if(steps[index].paid)group.paid++;
      groups.set(key,group);
    });
    return [...groups.values()].map(g=>({...g,signup_rate:pct(g.signup,g.visitors)})).sort((a,b)=>b.visitors-a.visitors).slice(0,15);
  };

  // Day by day.
  const series=[];
  for(let t=now.getTime()-(days-1)*DAY;t<=now.getTime();t+=DAY)series.push({day:dayKey(t),visitors:0,signups:0,previews:0,full:0});
  const at=new Map(series.map(row=>[row.day,row]));
  for(const v of humans)at.get(dayKey(v.first_seen))&&at.get(dayKey(v.first_seen)).visitors++;
  for(const u of newUsers)at.get(dayKey(u.created_at))&&at.get(dayKey(u.created_at)).signups++;
  for(const j of ownJobs){
    const row=at.get(dayKey(j.created_at));
    if(row)j.variant?row.full++:j.preview_limit&&row.previews++;
  }

  const previews=ownJobs.filter(j=>j.preview_limit);
  const fulls=ownJobs.filter(j=>j.variant);
  const payingUsers=users.filter(paying);
  const byTier=tier=>payingUsers.filter(u=>effectiveTier(u,now)===tier).length;
  const generatorIds=new Set(ownJobs.filter(j=>!j.guest_expires_at).map(j=>String(j.user_id)));
  const kpis={
    visitors:humans.length,
    bots:real.length-humans.length,
    signups:newUsers.length,
    visit_to_signup:pct(newUsers.length,humans.length),
    previews:previews.length,
    guest_previews:previews.filter(j=>j.guest_expires_at).length,
    failed_previews:previews.filter(j=>j.status==='failed').length,
    full_songs:fulls.length,
    cached:ownJobs.filter(j=>j.cached_from).length,
    active_users:generatorIds.size,
    activation:pct(newUsers.filter(u=>(jobsOf.get(String(u._id))||[]).length).length,newUsers.length),
    paying:payingUsers.length,
    starter:byTier('starter'),pro:byTier('pro'),lifetime:byTier('lifetime'),
    new_paying:payingUsers.filter(u=>new Date(u.first_paid_at||u.billing?.updated_at||0)>=since).length,
    signup_to_paid:pct(newUsers.filter(paying).length,newUsers.length),
    mrr:byTier('starter')*MONTHLY.starter+byTier('pro')*MONTHLY.pro,
    total_users:users.length
  };

  const recent=[...newUsers].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,40).map(u=>{
    const v=visitorOfUser.get(String(u._id));
    const own=jobsOf.get(String(u._id))||[];
    return {created_at:u.created_at,email:u.email,phone:u.phone||'',pseudo:u.profile?.pseudo||'',plan:effectiveTier(u,now),
      source:v?.source||'inconnue',content:v?.content||'',device:v?.device||'',country:v?.country||'',
      previews:own.filter(j=>j.preview_limit).length,full:own.filter(j=>j.variant).length};
  });

  // What people generate: latest jobs, and the split by instrument.
  const generations=[...ownJobs].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,60).map(j=>{
    const account=j.guest_expires_at?null:userById.get(String(j.user_id));
    const v=account?visitorOfUser.get(String(account._id)):null;
    return {created_at:j.created_at,title:j.title||j.source_name||'Sans titre',instrument:j.instrument||'',
      kind:j.variant?'full':'preview',variant:j.variant||'',status:j.status,cached:Boolean(j.cached_from),
      youtube_id:j.youtube_id||'',content:j.source_content||'',goal:j.guitar_goal||'',
      seconds:j.finished_at&&j.created_at?Math.round((new Date(j.finished_at)-new Date(j.created_at))/1000):null,
      account:account?(account.profile?.pseudo||account.email):'Visiteur sans compte',source:v?.source||''};
  });
  const instrumentGroups=new Map();
  for(const j of ownJobs){
    const key=j.instrument||'—';
    const g=instrumentGroups.get(key)||{key,previews:0,full:0,failed:0,users:new Set()};
    j.variant?g.full++:g.previews++;
    if(j.status==='failed')g.failed++;
    g.users.add(String(j.user_id));
    instrumentGroups.set(key,g);
  }
  const instruments=[...instrumentGroups.values()].map(g=>({key:g.key,previews:g.previews,full:g.full,failed:g.failed,people:g.users.size}))
    .sort((a,b)=>b.previews+b.full-a.previews-a.full);

  return {days,since,generated_at:now,kpis,funnel,series,recent,generations,instruments,
    breakdowns:{source:breakdown('source'),content:breakdown('content'),device:breakdown('device'),country:breakdown('country'),
      os:breakdown('os'),browser:breakdown('browser'),landing:breakdown('landing')}};
}

module.exports={collect,stats,sourceOf,device,os,browser,BOT,VISITOR};

'use strict';
/**
 * Follow-up emails (« relances »), run every hour by .github/workflows/nudges.yml.
 *
 *   starter_ready  Starter: the next whole song is available again (24 h after the previous one)
 *   unlock         a preview was made, never unlocked (about a day later)
 *   limit          the free previews are used up
 *   first          signed up, never generated (about a day later)
 *   winback        no activity for 14 days
 *
 * At most one follow-up per person per day, each kind once (starter_ready once per window,
 * winback once per period of inactivity). Never to admins, unverified addresses, or people who
 * unsubscribed. Every email carries a one-click unsubscribe link.
 */
const crypto=require('node:crypto');
const {sendEmail,emailEnabled,SITE}=require('./email');
const {effectiveTier}=require('./billing');
const {FREE_PREVIEWS}=require('./free-previews');

const HOUR=3600000,DAY=24*HOUR;
const MAX_PER_RUN=40;
const SPACING_MS=550; // Resend allows about 2 emails a second

const secret=()=>process.env.AUTH_SESSION_SECRET||process.env.MONGODB_URI||'tablurio';
function unsubscribeToken(userId){
  return crypto.createHmac('sha256',secret()).update(`nudges-off:${userId}`).digest('hex').slice(0,32);
}
function unsubscribeUrl(userId){
  return `${SITE()}/api/desabonnement?u=${userId}&t=${unsubscribeToken(userId)}`;
}
function validUnsubscribe(userId,token){
  const expected=Buffer.from(unsubscribeToken(String(userId)));
  const given=Buffer.from(String(token||''));
  return given.length===expected.length&&crypto.timingSafeEqual(given,expected);
}

const COUNTED=new Set(['queued','processing','completed']);

/** The follow-up this person should get now, or null. Pure: easy to test. */
function pick({user,jobs,unlock,now}){
  const sent=user.nudges||{};
  const since=key=>sent[key]?now-new Date(sent[key]):Infinity;
  if(user.last_nudge_at&&now-new Date(user.last_nudge_at)<22*HOUR)return null;
  const tier=effectiveTier(user,now);
  const previews=jobs.filter(j=>j.preview_limit&&!j.guest_expires_at);
  const fulls=jobs.filter(j=>j.variant);
  const lastActivity=Math.max(new Date(user.created_at||0).getTime(),...jobs.map(j=>new Date(j.created_at).getTime()));

  // Starter: the window of the last whole song just ended.
  if(tier==='starter'&&unlock){
    const end=new Date(unlock.window_until||new Date(unlock.created_at).getTime()+DAY);
    if(end<=now&&now-end<DAY&&sent.starter_ready!==end.toISOString())
      return {kind:'starter_ready',key:end.toISOString()};
  }
  if(tier==='free'){
    // A finished preview, never unlocked.
    const done=previews.filter(j=>j.status==='completed'&&!j.full_jobs);
    const latest=done.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
    if(latest&&!fulls.length&&!sent.unlock){
      const age=now-new Date(latest.finished_at||latest.created_at);
      if(age>=20*HOUR&&age<4*DAY)return {kind:'unlock',job:latest};
    }
    // Free previews used up.
    const used=previews.filter(j=>COUNTED.has(j.status));
    if(used.length>=FREE_PREVIEWS&&!sent.limit){
      const age=now-Math.max(...used.map(j=>new Date(j.created_at).getTime()));
      if(age>=2*HOUR&&age<7*DAY)return {kind:'limit',job:latest||null};
    }
  }
  // Signed up, never generated.
  if(!jobs.length&&!sent.first){
    const age=now-new Date(user.created_at||now);
    if(age>=20*HOUR&&age<7*DAY)return {kind:'first'};
  }
  // Quiet for 14 days: once per period of inactivity.
  const quiet=now-lastActivity;
  if(quiet>=14*DAY&&quiet<21*DAY&&!(since('winback')<quiet))return {kind:'winback'};
  return null;
}

/** Sends the follow-ups due now. Returns a summary {checked, sent, by_kind}. */
async function runNudges(db,now=new Date(),{dryRun=false}={}){
  const summary={checked:0,sent:0,by_kind:{},enabled:emailEnabled()};
  if(!summary.enabled&&!dryRun)return summary;
  const users=await db.collection('users').find(
    {role:{$ne:'admin'},email_verified:{$ne:false},nudges_off:{$ne:true}},
    {projection:{email:1,created_at:1,billing:1,lang:1,nudges:1,last_nudge_at:1,profile:1}}).toArray();
  const ids=users.map(u=>u._id);
  const jobs=await db.collection('track_jobs').find({user_id:{$in:ids}},
    {projection:{user_id:1,created_at:1,finished_at:1,status:1,preview_limit:1,variant:1,full_jobs:1,title:1,guest_expires_at:1}}).toArray();
  const unlocks=await db.collection('billing_unlocks').find({user_id:{$in:ids}},
    {projection:{user_id:1,created_at:1,window_until:1}}).toArray();
  const jobsOf=new Map(),unlockOf=new Map();
  for(const job of jobs){const k=String(job.user_id);if(!jobsOf.has(k))jobsOf.set(k,[]);jobsOf.get(k).push(job);}
  for(const unlock of unlocks){
    const k=String(unlock.user_id),current=unlockOf.get(k);
    if(!current||new Date(unlock.created_at)>new Date(current.created_at))unlockOf.set(k,unlock);
  }
  for(const user of users){
    if(summary.sent>=MAX_PER_RUN)break;
    summary.checked++;
    const due=pick({user,jobs:jobsOf.get(String(user._id))||[],unlock:unlockOf.get(String(user._id)),now});
    if(!due)continue;
    if(!dryRun){
      const data={lang:user.lang,name:user.profile?.pseudo||'',title:due.job?.title||'',
        url:due.job?`${SITE()}/app/${due.job._id}`:`${SITE()}/app/new`,
        pricing:`${SITE()}/tarifs`,unsubscribe:unsubscribeUrl(String(user._id))};
      const result=await sendEmail(user.email,`nudge_${due.kind}`,data);
      if(!result.sent)continue;
      await db.collection('users').updateOne({_id:user._id},
        {$set:{last_nudge_at:now,[`nudges.${due.kind}`]:due.kind==='starter_ready'?due.key:now}});
      await new Promise(resolve=>setTimeout(resolve,SPACING_MS));
    }
    summary.sent++;
    summary.by_kind[due.kind]=(summary.by_kind[due.kind]||0)+1;
  }
  return summary;
}

module.exports={pick,runNudges,unsubscribeUrl,validUnsubscribe,unsubscribeToken};

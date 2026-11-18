'use strict';
/**
 * SongToSheet billing: Whop memberships → what an account may do.
 *
 * - Whop signs every webhook (Standard Webhooks): HMAC-SHA256 of "{id}.{timestamp}.{raw body}"
 *   with the ws_… secret, base64, sent as "v1,<signature>" in webhook-signature.
 * - A membership becomes an entitlement on the account (users.billing).
 * - Starter: one full song a day (the day resets at midnight, Paris time). Pro and
 *   Lifetime: no quota (fair personal use). Free: previews only.
 */
const crypto=require('node:crypto');

const PLANS={
  plan_IDC4CtmdcNpi7:'starter',   // Starter monthly
  plan_tSyrCMbVC4Tc5:'starter',   // Starter yearly
  plan_4jV8ToLJhBWKm:'pro',       // Pro monthly
  plan_oTt3xxj15qEY0:'pro',       // Pro yearly
  plan_tXX5q8JhuWQui:'lifetime'   // Lifetime (one payment)
};
// Grace while Whop retries a failed renewal (past_due) keeps access; canceled/expired do not.
const ACTIVE_STATUSES=new Set(['active','trialing','completed','past_due']);
const DAILY_LIMITS={starter:1};
const TOLERANCE_SECONDS=5*60;

function signatureKeys(secret){
  // Whop: pass the ws_ secret as issued. Standard Webhooks libraries base64-decode a whsec_
  // secret instead; both readings are derived from the same secret, so either may match.
  const keys=[Buffer.from(secret,'utf8')];
  const body=secret.replace(/^(ws|whsec)_/,'');
  if(body!==secret&&/^[A-Za-z0-9+/=]+$/.test(body))keys.push(Buffer.from(body,'base64'));
  return keys;
}

function verifyWebhook(rawBody,headers,secret,now=Date.now()){
  if(typeof secret!=='string'||!secret)return false;
  const id=headers?.['webhook-id'],timestamp=headers?.['webhook-timestamp'],signature=headers?.['webhook-signature'];
  if(typeof id!=='string'||typeof timestamp!=='string'||typeof signature!=='string'||!/^\d{1,12}$/.test(timestamp))return false;
  if(Math.abs(now/1000-Number(timestamp))>TOLERANCE_SECONDS)return false;
  const signed=`${id}.${timestamp}.${rawBody}`;
  const received=signature.split(' ').map(part=>part.split(',')).filter(([version,value])=>version==='v1'&&value)
    .map(([,value])=>Buffer.from(value,'base64'));
  for(const key of signatureKeys(secret)){
    const expected=crypto.createHmac('sha256',key).update(signed).digest();
    if(received.some(value=>value.length===expected.length&&crypto.timingSafeEqual(value,expected)))return true;
  }
  return false;
}

function tierForPlan(planId){return Object.hasOwn(PLANS,planId)?PLANS[planId]:null;}
const ANNUAL_PLANS=new Set(['plan_tSyrCMbVC4Tc5','plan_oTt3xxj15qEY0']);
// No renewal date in what Whop sent: one period (plus a few days' grace) from the start, refreshed
// later from the API or the next renewal event.
function fallbackEnd(planId,membership,now=Date.now()){
  const start=toDate(membership.renewal_period_start??membership.created_at)?.getTime()??now;
  const days=ANNUAL_PLANS.has(planId)?366:32;
  return new Date(Math.min(start,now)+days*86400e3);
}

function toDate(value){
  if(value==null||value==='')return null;
  const date=typeof value==='number'?new Date(value<1e12?value*1000:value):new Date(value);
  return Number.isFinite(date.getTime())?date:null;
}

/** A Whop membership object → {tier, active, period_end, …}, or null if not a SongToSheet plan. */
function entitlement(membership){
  if(!membership||typeof membership!=='object')return null;
  const accountId=membership.account_id??membership.account?.id??membership.company?.id;
  if(accountId&&accountId!=='biz_7EpgzhL8mQlG1B')return null;
  const planId=membership.variant_id??membership.variant?.id??membership.plan?.id??membership.plan_id??(typeof membership.plan==='string'?membership.plan:null);
  const tier=tierForPlan(planId);
  if(!tier||typeof membership.id!=='string')return null;
  const status=String(membership.status||'').toLowerCase();
  const email=membership.user?.email??membership.email??membership.member?.email??null;
  const userId=membership.metadata?.user_id;
  return {
    membership_id:membership.id,tier,status,active:ACTIVE_STATUSES.has(status),
    period_end:tier==='lifetime'?null:toDate(membership.renewal_period_end??membership.current_period_end??membership.expires_at)??
      (ACTIVE_STATUSES.has(status)?fallbackEnd(planId,membership):null),
    cancel_at_period_end:membership.cancel_at_period_end===true,
    manage_url:typeof membership.manage_url==='string'&&membership.manage_url.startsWith('https://')?membership.manage_url:null,
    user_id:typeof userId==='string'&&/^[0-9a-f]{24}$/i.test(userId)?userId:null,
    email:typeof email==='string'?email.trim().toLowerCase():null
  };
}

function effectiveTier(user,now=new Date()){
  if(!user)return 'free';
  if(user.role==='admin')return 'pro';
  const billing=user.billing;
  if(!billing?.active||!['starter','pro','lifetime'].includes(billing.tier))return 'free';
  const end=toDate(billing.period_end);
  if(end&&end<=now)return 'free';
  if(billing.tier!=='lifetime'&&!end)return 'free';
  return billing.tier;
}

const parisFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'});
function parisDay(now=new Date()){return parisFormat.format(now);}

function parisOffsetMinutes(date){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',hourCycle:'h23',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(date)
    .filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
  const asUtc=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);
  return Math.round((asUtc-date.getTime())/60000);
}

function nextParisMidnight(now=new Date()){
  const [year,month,day]=parisDay(now).split('-').map(Number);
  const guess=new Date(Date.UTC(year,month-1,day+1));
  return new Date(guess.getTime()-parisOffsetMinutes(guess)*60000);
}

function quota(tier,used,now=new Date()){
  const limit=Object.hasOwn(DAILY_LIMITS,tier)?DAILY_LIMITS[tier]:tier==='free'?0:null;
  if(limit===null)return {limit:null,used,remaining:null,resets_at:null};
  return {limit,used,remaining:Math.max(0,limit-used),resets_at:limit?nextParisMidnight(now):null};
}

module.exports={PLANS,verifyWebhook,tierForPlan,entitlement,effectiveTier,parisDay,nextParisMidnight,quota};

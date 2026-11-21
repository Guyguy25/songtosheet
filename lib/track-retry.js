'use strict';
/**
 * A failed generation is tried once more on its own; if it fails again the admin gets an email.
 * Errors that a second try cannot fix (audio too long, video unavailable…) are not retried.
 */
const {sendEmail,SITE}=require('./email');

const PERMANENT=/10 min|trop long|priv[ée]e|introuvable|indisponible dans|n'existe|n’existe|copyright|bloqu[ée]e|non prise en charge/i;
const PROCESSING_MS=5*60*1000;

function shouldRetry(job,message,now=new Date()){
  if((job.retries||0)>=1)return false;
  if(PERMANENT.test(String(message||'')))return false;
  // The audio must still be there for the second try.
  return Boolean(job.expires_at&&new Date(job.expires_at).getTime()>now.getTime()+PROCESSING_MS);
}

/** Puts the job back in the queue for its second try. Returns true when it did. */
async function requeue(db,filter,job,message,now=new Date()){
  const result=await db.collection('track_jobs').updateOne(filter,{
    $set:{status:'queued',queued_at:now,retries:(job.retries||0)+1,last_error:String(message||'').slice(0,300),stage:'queued',stages:[]},
    $unset:{lease:'',lease_until:'',processing_deadline:'',claimed_at:'',stage_at:''}});
  return result.modifiedCount===1;
}

/** Emails every admin (or ADMIN_ALERT_EMAIL) about a final failure. Never throws. */
async function alertAdmins(db,job,message){
  try{
    const to=process.env.ADMIN_ALERT_EMAIL
      ?[process.env.ADMIN_ALERT_EMAIL]
      :(await db.collection('users').find({role:'admin'},{projection:{email:1}}).toArray()).map(user=>user.email).filter(Boolean);
    const title=`${job.title||'Sans titre'} (${job.instrument||'?'}, ${job.variant?'morceau entier':'aperçu'})`;
    await Promise.all(to.map(address=>sendEmail(address,'alert',{title,detail:String(message||'Erreur inconnue').slice(0,300),url:`${SITE()}/admin`})));
  }catch(error){console.error('alerte admin :',error.message);}
}

module.exports={shouldRetry,requeue,alertAdmins};

'use strict';
/** « Ta partition est prête » by email, only when the person is no longer on the page. */
const {sendEmail,emailEnabled,SITE}=require('./email');

const AWAY_MS=45*1000; // the waiting page asks for news every few seconds

function isAway(job,now=new Date()){
  return !job.watched_at||now-new Date(job.watched_at)>AWAY_MS;
}

/** Sends the email when it applies. Returns true when sent. Never throws. */
async function notifyReady(db,job,now=new Date()){
  try{
    if(!emailEnabled()||job.guest_expires_at||!isAway(job,now))return false;
    const user=await db.collection('users').findOne({_id:job.user_id},{projection:{email:1,email_verified:1,notify_ready:1}});
    if(!user?.email||user.email_verified===false||user.notify_ready===false)return false;
    const title=job.title||'Ton morceau';
    const result=await sendEmail(user.email,'ready',{title,url:`${SITE()}/app/${job._id}`});
    return result.sent;
  }catch(error){
    console.error('email partition prête :',error.message);
    return false;
  }
}

module.exports={notifyReady,isAway,AWAY_MS};

'use strict';
/** Six-digit email codes (verification, password reset), stored hashed with a 15 min life. */
const crypto=require('node:crypto');
const LIFE_MS=15*60*1000;
const MAX_TRIES=5;

const digest=(purpose,owner,code)=>crypto.createHash('sha256').update(`tablurio-code:${purpose}:${owner}:${code}`).digest('hex');

async function issueCode(db,purpose,owner,now=new Date()){
  const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
  await db.collection('email_codes').updateOne({_id:`${purpose}:${owner}`},
    {$set:{hash:digest(purpose,owner,code),tries:0,expires_at:new Date(now.getTime()+LIFE_MS),created_at:now}},{upsert:true});
  return code;
}

/** 'ok', 'wrong', 'expired' (or missing) or 'locked' (too many wrong tries). A good code is used up. */
async function checkCode(db,purpose,owner,code,now=new Date()){
  const codes=db.collection('email_codes');
  const id=`${purpose}:${owner}`;
  const entry=await codes.findOne({_id:id});
  if(!entry||new Date(entry.expires_at)<=now)return 'expired';
  if(entry.tries>=MAX_TRIES)return 'locked';
  const given=String(code||'').replace(/\D/g,'');
  const a=Buffer.from(digest(purpose,owner,given)),b=Buffer.from(entry.hash);
  if(given.length!==6||a.length!==b.length||!crypto.timingSafeEqual(a,b)){
    await codes.updateOne({_id:id},{$inc:{tries:1}});
    return entry.tries+1>=MAX_TRIES?'locked':'wrong';
  }
  await codes.deleteOne({_id:id});
  return 'ok';
}

const CODE_MESSAGES={wrong:'Ce code n’est pas le bon. Vérifie l’email reçu.',expired:'Ce code a expiré. Demande-en un nouveau.',
  locked:'Trop d’essais avec ce code. Demande-en un nouveau.'};

module.exports={issueCode,checkCode,CODE_MESSAGES,LIFE_MS};

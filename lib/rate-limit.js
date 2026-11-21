'use strict';
/** Fixed-window counters in MongoDB (collection rate_limits, expired by a TTL index). */
function clientIp(req){
  const forwarded=process.env.VERCEL==='1'?req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']:null;
  return String(forwarded||req.socket?.remoteAddress||'unknown').split(',')[0].trim().slice(0,64);
}

/** Counts one hit on `key`. Returns true while at most `limit` hits happened in the window. */
async function allow(db,key,limit,windowMs,now=new Date()){
  const limits=db.collection('rate_limits');
  const state=await limits.findOne({_id:key});
  if(!state||new Date(state.expires_at)<=now){
    await limits.updateOne({_id:key},{$set:{count:1,expires_at:new Date(now.getTime()+windowMs)}},{upsert:true});
    return true;
  }
  if(state.count>=limit)return false;
  await limits.updateOne({_id:key},{$inc:{count:1}});
  return true;
}

module.exports={allow,clientIp};

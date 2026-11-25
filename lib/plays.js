'use strict';
/**
 * Écoutes : un compte appuie sur « lecture » sur l'écran d'une partition.
 * Une ligne par compte, morceau et jour dans score_plays (les rechargements du même jour s'additionnent),
 * plus last_played_at / plays sur la génération. Le tableau de bord admin en tire « Sons écoutés récemment ».
 */
const {ObjectId}=require('mongodb');
const {parisDay}=require('./ratings');

let indexed=null;
async function recordPlay(db,user,id,now=new Date()){
  if(!user?._id||user.guest||typeof id!=='string'||!/^[a-f0-9]{24}$/i.test(id))return false;
  const jobs=db.collection('track_jobs');
  const job=await jobs.findOneAndUpdate({_id:new ObjectId(id),user_id:user._id,status:'completed'},
    {$set:{last_played_at:now},$inc:{plays:1}},{projection:{title:1,source_name:1,instrument:1,variant:1,preview_limit:1,youtube_id:1}});
  const doc=job?.value===undefined?job:job.value; // driver 5 renvoie {value}, driver 6 le document
  if(!doc)return false;
  const plays=db.collection('score_plays');
  indexed??=plays.createIndex({at:-1}).catch(()=>{indexed=null;});
  await plays.updateOne({user_id:user._id,job_id:doc._id,day:parisDay(now)},
    {$set:{at:now,admin:user.role==='admin',title:doc.title||doc.source_name||'',instrument:doc.instrument||'',
      kind:doc.variant?'full':'preview',youtube_id:doc.youtube_id||''},$inc:{count:1},$setOnInsert:{first_at:now}},{upsert:true});
  return true;
}

/** Écoutes sur la période (comptes admin exclus) : totaux et dernières écoutes. */
async function playStats(db,since){
  const rows=(await db.collection('score_plays').find({at:{$gte:since}}).sort({at:-1}).limit(3000).toArray()).filter(r=>!r.admin);
  const ids=[...new Set(rows.map(r=>String(r.user_id)))].map(id=>new ObjectId(id));
  const accounts=new Map((await db.collection('users').find({_id:{$in:ids}},{projection:{email:1,profile:1}}).toArray())
    .map(u=>[String(u._id),u.profile?.pseudo||u.email]));
  const songs=new Set(rows.map(r=>String(r.job_id)));
  return {plays:rows.reduce((total,r)=>total+(r.count||1),0),listeners:ids.length,songs:songs.size,
    recent:rows.slice(0,80).map(r=>({at:r.at,account:accounts.get(String(r.user_id))||'—',user_id:String(r.user_id),title:r.title||'Sans titre',
      instrument:r.instrument,kind:r.kind,youtube_id:r.youtube_id,count:r.count||1}))};
}

module.exports={recordPlay,playStats};

'use strict';
const {ObjectId}=require('mongodb');
const instruments=new Set(['piano','guitare','violon','voix','basse']);
const formats=new Set(['partition','tablature']);
function cleanGeneration(data){
  if(!data||typeof data!=='object'||!instruments.has(data.instrument)||!formats.has(data.format))throw new Error('Choisis ton instrument et ton format.');
  const title=String(data.name||data.title||'').trim().slice(0,110);
  if(!title)throw new Error('Le titre de la musique est obligatoire.');
  const rawDuration=Number(data.duration);
  const verified=data.durationVerified===true||data.duration_verified===true;
  if(verified&&(!Number.isFinite(rawDuration)||rawDuration<=0))throw new Error('La durée de l’audio est invalide.');
  let sourceUrl=null;
  if(typeof data.sourceUrl==='string'&&data.sourceUrl.length<=1500){
    try{const url=new URL(data.sourceUrl);if(url.protocol==='https:'&&!url.username&&!url.password&&/^(www\.youtube\.com|youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com|open\.spotify\.com|www\.deezer\.com|deezer\.com|music\.apple\.com|soundcloud\.com|www\.soundcloud\.com)$/.test(url.hostname))sourceUrl=url.toString();}catch(e){}
  }
  const clientId=String(data.createdAt||data.client_generation_id||'').trim();
  if(!/^\d{10,16}$/.test(clientId))throw new Error('Session de génération invalide.');
  return {
    title,provider:String(data.provider||'Fichier audio').slice(0,40),
    source_type:data.kind==='link'?'link':'file',source_url:sourceUrl,
    instrument:data.instrument,format:data.format,
    duration_seconds:Number.isFinite(rawDuration)&&rawDuration>=0?rawDuration:null,
    duration_verified:verified,
    client_generation_id:clientId
  };
}
let indexesReady;
async function ensureIndexes(db){
  if(!indexesReady){
    indexesReady=Promise.all([
      db.collection('users').createIndex({email:1},{unique:true,name:'user_email_unique'}),
      db.collection('generations').createIndex({user_id:1,client_generation_id:1},{unique:true,name:'user_generation_id_unique'}),
      db.collection('generations').createIndex({user_id:1,created_at:-1},{name:'generations_user_created'})
    ]).catch(e=>{indexesReady=null;throw e;});
  }
  return indexesReady;
}
function serial(job){
  if(!job)return null;
  return {
    id:String(job._id),title:job.title,provider:job.provider,instrument:job.instrument,format:job.format,
    source_type:job.source_type,duration:job.duration_seconds||0,duration_verified:job.duration_verified===true,
    status:job.preview_revealed?'completed':'ready',preview_revealed:job.preview_revealed===true,
    demo_saved:true,created_at:Math.floor(new Date(job.created_at).getTime()/1000),
    note_count:0,bpm:0,reserved_credits:0,notes:[]
  };
}
async function addGeneration(db,userId,raw){
  const g=cleanGeneration(raw);const c=db.collection('generations');
  const filter={user_id:new ObjectId(userId),client_generation_id:g.client_generation_id};
  await ensureIndexes(db);
  await c.updateOne(filter,{$setOnInsert:{...g,user_id:new ObjectId(userId),preview_revealed:false,created_at:new Date()}},{upsert:true});
  return serial(await c.findOne(filter));
}
module.exports={cleanGeneration,ensureIndexes,serial,addGeneration};

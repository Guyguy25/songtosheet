'use strict';
const {createHash,randomUUID,timingSafeEqual}=require('node:crypto');
const {ObjectId}=require('mongodb');
const {database}=require('../lib/mongodb');
const {authenticated,json}=require('../lib/session');
const {method,fail}=require('../lib/authorization');
const {CHUNK_BYTES,MAX_BYTES,INSTRUMENTS,AUDIO_TYPES,FORMATS,isId,trackFilter,prepareTracks}=require('../lib/track-jobs');

const UPLOAD_MS=10*60*1000;
const AUDIO_RETENTION_MS=2*60*60*1000;
const LEASE_MS=25*60*1000;
const WORKER_ACTIONS=new Set(['claim','read','finish']);

function workerAuthorized(req){
  const expected=process.env.TRACK_WORKER_DIGEST||'';
  const token=req.headers.authorization||'';
  if(!/^[a-f0-9]{64}$/.test(expected)||!/^Bearer [a-f0-9]{64}$/.test(token))return false;
  return timingSafeEqual(createHash('sha256').update(token.slice(7)).digest(),Buffer.from(expected,'hex'));
}

async function begin(db,res,user,body){
  const {size,extension,instrument}=body;
  const title=typeof body.title==='string'?body.title.trim().slice(0,110):'';
  if(body.authorized!==true)return json(res,400,{detail:'Confirme que tu disposes des droits nécessaires pour transcrire cet audio.'});
  if(!title||!INSTRUMENTS.has(instrument)||!AUDIO_TYPES.has(extension)||!Number.isInteger(size)||size<1024||size>MAX_BYTES){
    return json(res,400,{detail:'Choisis un titre, une piste et un fichier audio de 25 Mo maximum.'});
  }
  await prepareTracks(db);
  const jobs=db.collection('track_jobs');
  const now=new Date();
  await jobs.updateMany({user_id:user._id,active:true,expires_at:{$lte:now}},
    {$set:{active:false,status:'failed',error_message:'Le délai de traitement a expiré.'}});
  try{
    const result=await jobs.insertOne({user_id:user._id,title,instrument,extension,size,
      isolated:body.isolated===true,status:'uploading',active:true,
      created_at:now,authorized_at:now,expires_at:new Date(now.getTime()+UPLOAD_MS)});
    return json(res,201,{id:String(result.insertedId),chunk_bytes:CHUNK_BYTES});
  }catch(error){
    if(error.code===11000)return json(res,409,{detail:'Une transcription est déjà en cours. Retrouve-la dans ta bibliothèque.'});
    throw error;
  }
}

async function upload(db,res,user,body){
  if(!isId(body.id))return json(res,404,{detail:'Création introuvable.'});
  const jobs=db.collection('track_jobs');
  const filter={...trackFilter(body.id,user),status:'uploading',active:true};
  const job=await jobs.findOne(filter);
  if(!job||job.expires_at<=new Date())return json(res,409,{detail:'Cet import est terminé ou a expiré.'});
  const chunks=db.collection('track_audio');
  if(body.action==='cancel'){
    const result=await jobs.deleteOne(filter);
    if(result.deletedCount)await chunks.deleteMany({job_id:job._id});
    return json(res,200,{ok:true});
  }
  const count=Math.ceil(job.size/CHUNK_BYTES);
  if(body.action==='queue'){
    if(await chunks.countDocuments({job_id:job._id})!==count)return json(res,400,{detail:'Import incomplet.'});
    const expires_at=new Date(job.created_at.getTime()+AUDIO_RETENTION_MS);
    const updated=await jobs.updateOne(filter,{$set:{status:'queued',expires_at}});
    return updated.modifiedCount?json(res,200,{id:body.id}):json(res,409,{detail:'Import déjà traité.'});
  }
  const {index,data}=body;
  const bytes=Math.min(CHUNK_BYTES,job.size-index*CHUNK_BYTES);
  if(!Number.isInteger(index)||index<0||index>=count||typeof data!=='string'||
    data.length!==Math.ceil(bytes/3)*4||Buffer.from(data,'base64').toString('base64')!==data||
    Buffer.from(data,'base64').length!==bytes){
    return json(res,400,{detail:'Partie audio invalide.'});
  }
  const expires_at=new Date(job.created_at.getTime()+AUDIO_RETENTION_MS);
  await chunks.updateOne({_id:`${job._id}:${index}`},
    {$setOnInsert:{job_id:job._id,data,expires_at}},{upsert:true});
  return json(res,200,{ok:true});
}

async function worker(db,res,body){
  const jobs=db.collection('track_jobs');
  const chunks=db.collection('track_audio');
  const now=new Date();
  if(body.action==='claim'){
    const lease=randomUUID();
    const job=await jobs.findOneAndUpdate({active:true,expires_at:{$gt:new Date(now.getTime()+LEASE_MS)},
      $or:[{status:'queued'},{status:'processing',lease_until:{$lte:now}}]},
      {$set:{status:'processing',lease,lease_until:new Date(now.getTime()+LEASE_MS)}},
      {sort:{created_at:1},returnDocument:'after'});
    return json(res,200,{job:job?{id:String(job._id),lease,title:job.title,instrument:job.instrument,
      extension:job.extension,isolated:job.isolated,chunks:Math.ceil(job.size/CHUNK_BYTES)}:null});
  }
  if(!isId(body.id)||typeof body.lease!=='string')return json(res,400,{detail:'Traitement invalide.'});
  const filter={_id:new ObjectId(body.id),status:'processing',active:true,lease:body.lease,lease_until:{$gt:now}};
  const job=await jobs.findOne(filter);
  if(!job)return json(res,409,{detail:'Traitement expiré ou déjà terminé.'});
  if(body.action==='read'){
    if(!Number.isInteger(body.index))return json(res,400,{detail:'Partie invalide.'});
    const chunk=await chunks.findOne({_id:`${job._id}:${body.index}`});
    return chunk?json(res,200,{data:chunk.data}):json(res,404,{detail:'Audio expiré.'});
  }
  const {duration,note_count,exports}=body;
  const completed=body.ok===true;
  if(completed&&(!Number.isFinite(duration)||duration<0.5||duration>360||!Number.isInteger(note_count)||note_count<1||
    !exports||typeof exports.musicxml!=='string'||typeof exports.mid!=='string'||
    Object.entries(exports).some(([key,value])=>!Object.hasOwn(FORMATS,key)||typeof value!=='string'||!value)||
    Object.values(exports).reduce((size,value)=>size+value.length,0)>4000000)){
    return json(res,400,{detail:'Exports invalides ou trop volumineux.'});
  }
  const outcome=completed?{status:'completed',duration,note_count,exports,downloads:Object.keys(exports)}
    :{status:'failed',error_message:typeof body.error==='string'?body.error.slice(0,300):'La transcription a échoué.'};
  const updated=await jobs.updateOne(filter,{$set:{...outcome,active:false,finished_at:now},$unset:{lease:'',lease_until:''}});
  if(!updated.modifiedCount)return json(res,409,{detail:'Traitement expiré ou déjà terminé.'});
  await chunks.deleteMany({job_id:job._id});
  return json(res,200,{ok:true});
}

async function download(db,req,res,user){
  const {id,download:format}=req.query;
  if(!isId(id)||!Object.hasOwn(FORMATS,format))return json(res,404,{detail:'Export introuvable.'});
  const job=await db.collection('track_jobs').findOne({...trackFilter(id,user),status:'completed'});
  const data=job?.exports?.[format];
  if(!data)return json(res,404,{detail:'Export introuvable.'});
  res.setHeader('Content-Type',FORMATS[format].type);
  res.setHeader('Content-Disposition',`attachment; filename="${FORMATS[format].suffix}"`);
  res.setHeader('Cache-Control','private, no-store');
  return res.status(200).send(Buffer.from(data,'base64'));
}

module.exports=async(req,res)=>{
  if(req.method!=='GET'&&req.method!=='POST'){
    res.setHeader('Allow','GET, POST');
    return json(res,405,{detail:'Méthode non autorisée.'});
  }
  if(!method(req,res,req.method))return;
  try{
    const body=req.body||{};
    if(req.method==='POST'&&WORKER_ACTIONS.has(body.action)){
      if(!workerAuthorized(req))return json(res,403,{detail:'Accès refusé.'});
      return await worker(await database(),res,body);
    }
    const user=await authenticated(req);
    if(!user)return json(res,401,{detail:'Connexion requise.'});
    if(user.role!=='admin')return json(res,403,{detail:'La transcription réelle est réservée au compte administrateur.'});
    if(req.method==='GET')return await download(await database(),req,res,user);
    if(!process.env.TRACK_WORKER_DIGEST)return json(res,503,{detail:'Le moteur de transcription est indisponible.'});
    if(body.action==='begin')return await begin(await database(),res,user,body);
    if(['chunk','queue','cancel'].includes(body.action))return await upload(await database(),res,user,body);
    return json(res,400,{detail:'Action invalide.'});
  }catch(error){return fail(res,error);}
};

'use strict';
const {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual}=require('node:crypto');
const {compareGuitar,sourceKey,candidates}=require('../lib/guitar-comparison');
const {ObjectId}=require('mongodb');
const {database}=require('../lib/mongodb');
const {authenticated,json}=require('../lib/session');
const {method,fail}=require('../lib/authorization');
const audioSource=require('../assets/audio-source');
const {scheduleWake}=require('../lib/engine-wake');
const {engineStats}=require('../lib/engine-stats');
const {createFullSong}=require('../lib/full-song');
const {PIANO_CRITERIA,CHUNK_BYTES,MAX_BYTES,PREVIEW_SECONDS,QUEUE_TIMEOUT_MESSAGE,PROCESSING_MS,PROCESSING_TIMEOUT_MESSAGE,INSTRUMENTS,AUDIO_TYPES,SOURCE_TYPES,REVIEW_TRACKS,FORMATS,PIANO_VARIANTS,SOLO_FORMATS,APPROVED_SOLO_ENGINE,showSolo,isId,trackFilter,expiredQueue,expiredProcessing,prepareTracks,serialTrack}=require('../lib/track-jobs');

const UPLOAD_MS=10*60*1000;
const AUDIO_RETENTION_MS=2*60*60*1000;
const REVIEW_MS=24*60*60*1000;
const WORKER_ACTIONS=new Set(['claim','peek','read','progress','preview','solo','review_audio','finish']);
const PROGRESS_STAGES=new Set(['decode','isolate','detect','arrange','cached','judge']);
const PIANO_FILES=Object.values(PIANO_VARIANTS).flatMap(({score,midi})=>[score,midi]);

const GUEST_COOKIE='sts_track_guest';
const GUEST_MS=24*60*60*1000;
const GUEST_HOUR_MS=60*60*1000;
const GUEST_HOURLY_LIMIT=5;

function guestSession(req,res,create=false){
  const cookie=String(req.headers.cookie||'').split(';').map(value=>value.trim())
    .find(value=>value.startsWith(GUEST_COOKIE+'='));
  let token=cookie?.slice(GUEST_COOKIE.length+1);
  if(!/^[a-f0-9]{64}$/.test(token||'')){
    if(!create)return null;
    token=randomBytes(32).toString('hex');
    res.setHeader('Set-Cookie',`${GUEST_COOKIE}=${token}; Path=/api/track; Max-Age=${GUEST_MS/1000}; HttpOnly; Secure; SameSite=Lax`);
  }
  const owner=createHash('sha256').update('songtosheet-track-guest:'+token).digest('hex');
  return {_id:new ObjectId(owner.slice(0,24)),guest:true};
}

async function reserveGuestGeneration(db,req,now){
  const forwarded=process.env.VERCEL==='1'?req.headers['x-vercel-forwarded-for']:null;
  const ip=forwarded||req.socket?.remoteAddress||'unknown';
  const hour=Math.floor(now.getTime()/GUEST_HOUR_MS);
  const key=createHmac('sha256',process.env.TRACK_WORKER_DIGEST).update(`guest-rate:${hour}:${ip}`).digest('hex');
  const limits=db.collection('track_guest_limits');
  try{
    await limits.updateOne({_id:key,count:{$lt:GUEST_HOURLY_LIMIT}},
      {$inc:{count:1},$setOnInsert:{expires_at:new Date((hour+1)*GUEST_HOUR_MS)}},{upsert:true});
    return true;
  }catch(error){
    if(error.code===11000)return false;
    throw error;
  }
}

async function guestStatus(db,req,res,guest){
  const {id}=req.query;
  if(!guest||!isId(id))return json(res,404,{detail:'Aperçu introuvable ou expiré.'});
  const job=await db.collection('track_jobs').findOne(trackFilter(id,guest),{projection:{
    title:1,instrument:1,format:1,status:1,stage:1,stages:1,source_name:1,preview_limit:1,
    active:1,created_at:1,queued_at:1,expires_at:1,processing_deadline:1,lease_until:1,error_message:1,
  }});
  if(!job)return json(res,404,{detail:'Aperçu introuvable ou expiré.'});
  const {title,instrument,format,status,stage,stages,source_name,preview_limit,error_message}=serialTrack(job);
  return json(res,200,{track:true,title,instrument,format,status,stage,stages,source_name,preview_limit,error_message,downloads:[]});
}

async function claimGuestTrack(db,res,user,guest,id){
  if(!isId(id))return json(res,404,{detail:'Aperçu introuvable ou expiré.'});
  const jobs=db.collection('track_jobs');
  if(guest){
    const claimed=await jobs.updateOne({...trackFilter(id,guest),status:'completed',active:false},
      {$set:{user_id:user._id},$unset:{guest_expires_at:''}});
    if(claimed.matchedCount)return json(res,200,{id});
  }
  const owned=await jobs.findOne({...trackFilter(id,user),status:'completed'},{projection:{_id:1}});
  return owned?json(res,200,{id}):json(res,404,{detail:'Aperçu introuvable ou expiré.'});
}

function validExports(exports){
  return exports&&typeof exports==='object'&&!Array.isArray(exports)&&
    Object.entries(exports).every(([key,value])=>Object.hasOwn(FORMATS,key)&&typeof value==='string'&&value)&&
    Object.values(exports).reduce((size,value)=>size+value.length,0)<=4000000;
}

function validDiagnostic(value,noteCount,duration){
  if(!value||typeof value!=='object')return null;
  const {total_attacks,matched_attacks,review_seconds,filtered_notes,tab_notes,tab_chords}=value;
  const count=(n,max)=>Number.isInteger(n)&&n>=0&&n<=max;
  if(!count(total_attacks,noteCount)||(matched_attacks!==null&&!count(matched_attacks,total_attacks))||
    !count(tab_notes,noteCount)||!count(tab_chords,tab_notes)||!count(filtered_notes,100000)||
    !Array.isArray(review_seconds)||review_seconds.length>5||review_seconds.some(time=>!count(time,Math.ceil(duration))))return null;
  return {total_attacks,matched_attacks,review_seconds,filtered_notes,tab_notes,tab_chords};
}

function workerAuthorized(req){
  const expected=process.env.TRACK_WORKER_DIGEST||'';
  const token=req.headers.authorization||'';
  if(!/^[a-f0-9]{64}$/.test(expected)||!/^Bearer [a-f0-9]{64}$/.test(token))return false;
  return timingSafeEqual(createHash('sha256').update(token.slice(7)).digest(),Buffer.from(expected,'hex'));
}

async function begin(db,req,res,user,body){
  const {size,extension,instrument}=body;
  const title=typeof body.title==='string'?body.title.trim().slice(0,110):'';
  const source=audioSource.parse(body.audioUrl);
  const link=source?.url;
  const source_name=link?(source.youtubeId?'YouTube':link.hostname):typeof body.sourceName==='string'
    ?body.sourceName.split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160)
    :'';
  const excerpt=body.excerpt;
  if(excerpt!==undefined&&(!link||!excerpt||!Number.isSafeInteger(excerpt.start_ms)||
    !Number.isSafeInteger(excerpt.end_ms)||excerpt.start_ms<0||excerpt.end_ms>86400000||
    excerpt.end_ms-excerpt.start_ms<500||excerpt.end_ms-excerpt.start_ms>PREVIEW_SECONDS*1000)){
    return json(res,400,{detail:'Choisis un extrait de 0,5 à 30 secondes.'});
  }
  const excerptKey=excerpt&&(excerpt.start_ms!==0||excerpt.end_ms!==PREVIEW_SECONDS*1000)
    ?':'+excerpt.start_ms+'-'+excerpt.end_ms:'';
  const format=body.format??'partition';
  const capo=body.capo??0;
  const guitarGoal=body.guitar_goal;
  const guitarPresence=body.guitar_presence;
  if(guitarGoal!=null||guitarPresence!=null){
    if(instrument!=='guitare'||format!=='tablature'||!['original','chords','solo'].includes(guitarGoal)||
      !['yes','no','unknown'].includes(guitarPresence)||capo!==0){
      return json(res,400,{detail:'Choisis un objectif compatible avec le contenu du morceau.'});
    }
  }
  if(body.authorized!==true)return json(res,400,{detail:'Confirme que tu disposes des droits nécessaires pour transcrire cet audio.'});
  if(body.audioUrl!=null&&!link)return json(res,400,{detail:'Colle un lien HTTPS public vers un fichier audio.'});
  if(source?.provider&&!source.youtubeId)return json(res,400,{detail:audioSource.importHint(source.provider)});
  if(!source_name)return json(res,409,{detail:'Actualise la page, puis sélectionne à nouveau ton fichier audio.'});
  if(!title||!INSTRUMENTS.has(instrument)||(!link&&(!AUDIO_TYPES.has(extension)||!Number.isInteger(size)||size<1024||size>MAX_BYTES))){
    return json(res,400,{detail:'Choisis un titre, une piste et un fichier audio de 25 Mo maximum.'});
  }
  if(format!=='partition'&&(format!=='tablature'||!['guitare','basse'].includes(instrument))){
    return json(res,400,{detail:'La tablature est disponible pour la guitare et la basse.'});
  }
  if(body.source!=null&&!SOURCE_TYPES.has(body.source))return json(res,400,{detail:'Choisis le contenu de ton audio.'});
  if((capo!=='auto'&&(!Number.isInteger(capo)||capo<0||capo>12))||(capo&&instrument!=='guitare')){
    return json(res,400,{detail:'Le capo est disponible pour la guitare uniquement.'});
  }
  await prepareTracks(db);
  const jobs=db.collection('track_jobs');
  const now=new Date();
  await jobs.updateOne({user_id:user._id,active:true,...expiredQueue(now)},
    {$set:{active:false,status:'failed',error_message:QUEUE_TIMEOUT_MESSAGE},$unset:{audio_url:''}});
  await jobs.updateOne({user_id:user._id,...expiredProcessing(now)},
    {$set:{active:false,status:'failed',finished_at:now,error_message:PROCESSING_TIMEOUT_MESSAGE},
      $unset:{lease:'',lease_until:'',audio_url:''}});
  await jobs.updateMany({user_id:user._id,active:true,expires_at:{$lte:now}},
    {$set:{active:false,status:'failed',error_message:'Le délai de traitement a expiré.'},$unset:{audio_url:''}});
  if(user.guest){
    const existing=await jobs.findOne({user_id:user._id,active:true},{projection:{_id:1}});
    if(existing)return json(res,409,{detail:'Une transcription est déjà en cours.'});
    if(!await reserveGuestGeneration(db,req,now)){
      return json(res,429,{detail:'Trop de générations récentes. Réessaie dans une heure.'});
    }
  }
  try{
    const input=source?.youtubeId?{youtube_id:source.youtubeId,source_kind:'link'}:
      link?{audio_url:link.href,source_kind:'link'}:{extension,size};
    const result=await jobs.insertOne({user_id:user._id,title,instrument,...input,format,source_name,capo,preview_limit:PREVIEW_SECONDS,
      ...(user.guest?{guest_expires_at:new Date(now.getTime()+GUEST_MS)}:{}),
      ...(excerpt?{excerpt:{start_ms:excerpt.start_ms,end_ms:excerpt.end_ms}}:{}),
      ...(instrument==='piano'&&body.source==='mixed'&&process.env.TRACK_PIANO_COMPARISON!=='0'?{piano_vocals:true}:{}),
      ...(guitarGoal?{guitar_goal:guitarGoal,guitar_presence:guitarPresence,guitar_compare:true,guitar_judge:true,guitar_choice:null,
        ...(body.source==='mixed'?{guitar_vocals:true}:{}),
        ...(link?{song_key:sourceKey(source)+excerptKey}:{})}:{}),
      source_content:body.source||null,
      isolated:body.source==null?body.isolated===true:['voice','instrument'].includes(body.source),status:link?'queued':'uploading',active:true,
      ...(link?{queued_at:now}:{}),
      created_at:now,authorized_at:now,expires_at:new Date(now.getTime()+(link?AUDIO_RETENTION_MS:UPLOAD_MS))});
    if(link)await scheduleWake();
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
  const job=await jobs.findOne(filter,{projection:{exports:0}});
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
    const queued_at=new Date();
    const updated=await jobs.updateOne({...filter,expires_at:{$gt:queued_at}},{$set:{status:'queued',queued_at,expires_at}});
    if(updated.modifiedCount)await scheduleWake();
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
  if(body.action==='peek'){
    // Same conditions as claim, so an expired job never wakes a GPU for nothing.
    const waiting=await jobs.findOne({active:true,status:'queued',expires_at:{$gt:new Date(now.getTime()+PROCESSING_MS)},
      $nor:[expiredQueue(now)]},{projection:{_id:1}});
    return json(res,200,{queued:Boolean(waiting)});
  }
  if(body.action==='claim'){
    const lease=randomUUID();
    const compatible=body.pdf===true?{}:{format:{$exists:false}};
    if(body.links!==true)compatible.audio_url={$exists:false};
    if(body.youtube!==true)compatible.youtube_id={$exists:false};
    if(body.excerpts!==true)compatible.excerpt={$exists:false};
    if(body.piano_only===true){
      if(process.env.TRACK_PIANO_COMPARISON!=='0'&&![2,3].includes(body.piano_judge_version))return json(res,200,{job:null});
      compatible.instrument='piano';
      compatible.preview_limit=PREVIEW_SECONDS;
    }else if(process.env.TRACK_PIANO_COMPARISON!=='0'&&
      (body.piano_compare!==true||body.piano_playable!==true||![2,3].includes(body.piano_judge_version))){
      compatible.$and=[{$or:[{instrument:{$ne:'piano'}},{preview_limit:{$ne:PREVIEW_SECONDS}}]}];
    }
    if(body.preview!==true)compatible.preview_limit={$exists:false};
    if(body.guitar_goals!==true)compatible.guitar_goal={$exists:false};
    else if(body.guided_guitar_only===true){
      compatible.guitar_goal={$in:body.guitar_chords===true?['original','solo','chords']:['original','solo']};
    }else if(body.guitar_chords!==true)compatible.guitar_goal={$ne:'chords'};
    if(body.guitar_compare!==true)compatible.guitar_compare={$ne:true};
    if(body.guitar_judge!==true)compatible.guitar_judge={$ne:true};
    if(body.guitar_vocals!==true)compatible.guitar_vocals={$ne:true};
    if(process.env.TRACK_PIANO_COMPARISON!=='0'&&body.piano_vocals!==true)compatible.piano_vocals={$ne:true};
    if(body.capo!==true)compatible.capo={$in:[null,0]};
    else if(body.auto_capo!==true)compatible.capo={$ne:'auto'};
    const deadline=new Date(now.getTime()+PROCESSING_MS);
    const job=await jobs.findOneAndUpdate({...compatible,active:true,status:'queued',expires_at:{$gt:deadline},
      $nor:[expiredQueue(now)]},
      {$set:{status:'processing',lease,lease_until:deadline,processing_deadline:deadline,stage:'audio',stages:['audio']}},
      {sort:{created_at:1},returnDocument:'after'});
    return json(res,200,{job:job?{id:String(job._id),lease,title:job.title,instrument:job.instrument,
      excerpt:job.excerpt,isolated:job.isolated,source_content:job.source_content,preview_limit:job.preview_limit,guitar_goal:job.guitar_goal,
      guitar_compare:job.guitar_compare===true,guitar_judge:job.guitar_judge===true,guitar_vocals:job.guitar_vocals===true,
      piano_vocals:job.piano_vocals===true,...(job.variant?{variant:job.variant}:{}),
      piano_compare:process.env.TRACK_PIANO_COMPARISON!=='0'&&body.piano_compare===true&&
        job.instrument==='piano'&&job.preview_limit===PREVIEW_SECONDS,
      review_audio:!job.isolated&&!job.preview_limit,format:job.format||'partition',capo:job.capo||0,...(job.youtube_id?{youtube_id:job.youtube_id}:job.audio_url?{audio_url:job.audio_url}:
        {extension:job.extension,chunks:Math.ceil(job.size/CHUNK_BYTES)})}:null});
  }
  if(!isId(body.id)||typeof body.lease!=='string')return json(res,400,{detail:'Traitement invalide.'});
  const filter={_id:new ObjectId(body.id),status:'processing',active:true,lease:body.lease,lease_until:{$gt:now},
    $nor:[expiredProcessing(now)]};
  if(body.action==='progress'){
    if(!PROGRESS_STAGES.has(body.stage))return json(res,400,{detail:'Étape invalide.'});
    const updated=await jobs.updateOne(filter,{$set:{stage:body.stage},$addToSet:{stages:body.stage}});
    return updated.matchedCount?json(res,200,{ok:true}):json(res,409,{detail:'Traitement expiré ou déjà terminé.'});
  }
  const job=await jobs.findOne(filter,{projection:{exports:0}});
  if(!job)return json(res,409,{detail:'Traitement expiré ou déjà terminé.'});
  if(body.action==='read'){
    if(!Number.isInteger(body.index))return json(res,400,{detail:'Partie invalide.'});
    const chunk=await chunks.findOne({_id:`${job._id}:${body.index}`});
    return chunk?json(res,200,{data:chunk.data}):json(res,404,{detail:'Audio expiré.'});
  }
  if(body.action==='review_audio'){
    const {kind,data}=body;
    if(job.isolated||job.preview_limit||!REVIEW_TRACKS.has(kind)||typeof data!=='string'||!data||data.length>3900000||
      Buffer.from(data,'base64').toString('base64')!==data)return json(res,400,{detail:'Piste audio invalide.'});
    const expires_at=new Date(job.created_at.getTime()+REVIEW_MS);
    await db.collection('track_review_audio').updateOne({_id:`${job._id}:${kind}`},
      {$set:{data,expires_at}},{upsert:true});
    const updated=await jobs.updateOne(filter,{$addToSet:{review_audio:kind},$set:{review_audio_expires_at:expires_at}});
    return updated.matchedCount?json(res,200,{ok:true}):json(res,409,{detail:'Traitement expiré ou déjà terminé.'});
  }
  const {duration,note_count,exports}=body;
  const completed=body.ok===true;
  const isPreview=body.action==='preview';
  const hasPreview=job.downloads?.includes('mid')&&job.downloads?.includes('musicxml');
  if(body.action==='solo'){
    if(job.instrument!=='guitare'||job.guitar_goal==='chords'||!hasPreview||!validExports(exports)||!exports.solotab||!exports.solomid||
      Object.keys(exports).length!==2)return json(res,400,{detail:'Arrangement invalide.'});
    const engines=['guitararranger-v1',APPROVED_SOLO_ENGINE];
    if(job.preview_limit&&!engines.includes(body.solo_engine))return json(res,400,{detail:'Moteur d’arrangement invalide.'});
    const solo=[...engines,'mix-melody-v1'].includes(body.solo_engine)?{solo_engine:body.solo_engine}:{};
    const updated=await jobs.updateOne(filter,{$set:{'exports.solotab':exports.solotab,'exports.solomid':exports.solomid,...solo},
      $addToSet:{downloads:{$each:['solotab','solomid']}}});
    return updated.matchedCount?json(res,200,{ok:true}):json(res,409,{detail:'Traitement expiré ou déjà terminé.'});
  }
  const finishingPreview=completed&&!isPreview&&hasPreview&&body.preview===true;
  const comparison=job.guitar_compare===true;
  const chordJob=job.guitar_goal==='chords';
  const guitarEngine=chordJob?'yourmt3-guitar-chords-v1':'tsumugi-guitar-v1.5';
  const paired=(a,b)=>Boolean(exports?.[a])===Boolean(exports?.[b]);
  const primary=typeof body.piano_primary==='string'&&Object.hasOwn(PIANO_VARIANTS,body.piano_primary)
    ?PIANO_VARIANTS[body.piano_primary]:null;
  const hasPianoFiles=PIANO_FILES.some(key=>Boolean(exports?.[key]));
  const pianoValid=!hasPianoFiles||isPreview&&job.instrument==='piano'&&job.preview_limit===PREVIEW_SECONDS&&
    primary&&exports?.[primary.score]===exports?.musicxml&&exports?.[primary.midi]===exports?.mid&&
    Object.values(PIANO_VARIANTS).every(({score,midi})=>paired(score,midi))&&
    Object.keys(exports).every(key=>key==='musicxml'||key==='mid'||key==='vocals'||PIANO_FILES.includes(key));
  const compareValid=paired('heldtab','heldmid')&&paired('rhythmtab','rhythmmid')&&paired('solotab','solomid')&&
    Boolean(exports?.heldtab)===Boolean(exports?.rhythmtab)&&
    (body.engine==='tsumugi-guitar-v1.5'&&exports?.tab&&exports?.tabmid||
      body.engine==='yourmt3-guitar-chords-v1'&&exports?.heldtab&&!exports?.solotab)&&
    (!exports?.solotab||body.solo_engine===APPROVED_SOLO_ENGINE)&&
    (job.song_key||typeof body.audio_hash==='string'&&/^[a-f0-9]{64}$/.test(body.audio_hash));
  const fullValid=validExports(exports)&&exports.musicxml&&exports.mid&&Number.isFinite(duration)&&duration>=.5&&
    Number.isInteger(note_count)&&note_count>=1&&pianoValid&&(!exports.vocals||
      ((comparison&&job.guitar_vocals)||(hasPianoFiles&&job.piano_vocals))&&
      job.preview_limit===PREVIEW_SECONDS&&exports.vocals.length<=420000)&&
    (comparison?compareValid:
      !exports.heldtab&&!exports.heldmid&&(chordJob?Boolean(exports.rhythmtab&&exports.rhythmmid):!exports.rhythmtab&&!exports.rhythmmid));
  const finishValid=validExports(exports)&&Object.keys(exports).every(key=>key==='pdf'||(key==='solopdf'&&job.downloads.includes('solotab')))&&
    (job.preview_limit?Object.keys(exports).length===0:Boolean(exports.pdf)||body.pdf_error===true);
  if((isPreview||completed)&&!(finishingPreview?finishValid:fullValid)){
    return json(res,400,{detail:'Exports invalides ou trop volumineux.'});
  }
  if(isPreview){
    const previewDuration=body.preview_duration;
    if(job.preview_limit&&(!Number.isFinite(previewDuration)||previewDuration<.5||
      previewDuration>Math.min(job.preview_limit,duration)+.05||
      (job.instrument==='guitare'&&!comparison&&body.engine!==guitarEngine))){
      return json(res,400,{detail:'Aperçu ou moteur de transcription invalide.'});
    }
    const diagnostic=job.instrument==='guitare'?validDiagnostic(body.diagnostic,note_count,duration):null;
    const resolved=body.resolved_capo;
    if(job.capo==='auto'&&(!Number.isInteger(resolved)||resolved<1||resolved>12)){
      return json(res,400,{detail:'Case du capo invalide.'});
    }
    const capo=job.capo==='auto'?{resolved_capo:resolved}:{};
    const approvedEngine={guitare:guitarEngine,piano:'yourmt3-plus-moe-nops'}[job.instrument];
    const engine=comparison||approvedEngine&&body.engine===approvedEngine?{engine:body.engine}:{};
    const comparisonData=comparison?{song_key:job.song_key||'file:'+body.audio_hash,
      ...(exports.solotab?{solo_engine:APPROVED_SOLO_ENGINE}:{})}:{};
    const suggestion=body.recommendation;
    if(comparison&&job.guitar_judge&&suggestion?.version===1&&suggestion.scores&&typeof suggestion.scores==='object'){
      const valid=candidates({...job,...engine,...comparisonData,downloads:Object.keys(exports)});
      const scores=Object.fromEntries(valid.filter(({key})=>Number.isInteger(suggestion.scores[key])&&
        suggestion.scores[key]>=0&&suggestion.scores[key]<=100).map(({key})=>[key,suggestion.scores[key]]));
      if(Object.hasOwn(scores,suggestion.recommended)&&Object.keys(scores).length>=2&&
        scores[suggestion.recommended]===Math.max(...Object.values(scores))){
        comparisonData.auto_recommendation={version:1,recommended:suggestion.recommended,scores};
      }
    }
    const preview=job.preview_limit?{preview_duration:Math.min(previewDuration,job.preview_limit)}:{};
    const pianoData=hasPianoFiles?{piano_primary:body.piano_primary}:{};
    const pianoSuggestion=body.piano_recommendation;
    if(hasPianoFiles&&[1,2,3].includes(pianoSuggestion?.version)&&pianoSuggestion.recommended===body.piano_primary){
      const available=Object.entries(PIANO_VARIANTS).filter(([,v])=>exports[v.score]&&exports[v.midi]);
      const scores=Object.fromEntries(available
        .map(([key])=>[key,pianoSuggestion.scores?.[key]])
        .filter(([,score])=>Number.isInteger(score)&&score>=0&&score<=100));
      if(available.length>=2&&Object.keys(scores).length===available.length&&
        scores[body.piano_primary]===Math.max(...Object.values(scores))){
        pianoData.piano_recommendation={version:pianoSuggestion.version,recommended:body.piano_primary,scores};
        if(pianoSuggestion.version===3){
          const criteria={};
          for(const [key] of available){
            const values=pianoSuggestion.criteria?.[key];
            if(!values||typeof values!=='object')continue;
            criteria[key]=Object.fromEntries(PIANO_CRITERIA.filter(name=>Number.isInteger(values[name])&&
              values[name]>=0&&values[name]<=100).map(name=>[name,values[name]]));
          }
          const summary=typeof pianoSuggestion.summary==='string'?
            pianoSuggestion.summary.replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,240):'';
          pianoData.piano_recommendation.criteria=criteria;
          if(summary)pianoData.piano_recommendation.summary=summary;
        }
      }
    }
    const updated=await jobs.updateOne(filter,{$set:{duration,note_count,exports,downloads:Object.keys(exports),diagnostic,stage:'pdf',...capo,...engine,...preview,...comparisonData,...pianoData},
      $unset:{...(!comparisonData.solo_engine?{solo_engine:''}:{}),...(!engine.engine?{engine:''}:{}),
        ...(!comparisonData.auto_recommendation?{auto_recommendation:''}:{}),
        ...(!pianoData.piano_primary?{piano_primary:''}:{}),
        ...(!pianoData.piano_recommendation?{piano_recommendation:''}:{})},
      $addToSet:{stages:'pdf'}});
    if(!updated.matchedCount)return json(res,409,{detail:'Traitement expiré ou déjà terminé.'});
    return json(res,200,{ok:true});
  }
  let outcome;
  if(finishingPreview){
    outcome={status:'completed',pdf_error:!job.preview_limit&&!exports.pdf,downloads:[...new Set([...job.downloads,...Object.keys(exports)])]};
    if(exports.pdf)outcome['exports.pdf']=exports.pdf;
    if(exports.solopdf)outcome['exports.solopdf']=exports.solopdf;
  }else if(completed){
    outcome={status:'completed',duration,note_count,exports,downloads:Object.keys(exports)};
  }else{
    outcome={status:'failed',error_message:typeof body.error==='string'?body.error.slice(0,300):'La transcription a échoué.'};
  }
  const updated=await jobs.updateOne(filter,{$set:{...outcome,active:false,finished_at:now},$unset:{lease:'',lease_until:'',audio_url:''}});
  if(!updated.modifiedCount)return json(res,409,{detail:'Traitement expiré ou déjà terminé.'});
  await chunks.deleteMany({job_id:job._id});
  return json(res,200,{ok:true});
}

async function download(db,req,res,user){
  const {id,download:format}=req.query;
  if(!isId(id)||!Object.hasOwn(FORMATS,format))return json(res,404,{detail:'Export introuvable.'});
  // Previews, and whole songs generated from a paid version ("Générer la suite").
  const access=user.role==='admin'?{}:{$and:[{$or:[{preview_limit:PREVIEW_SECONDS},{variant:{$exists:true}}]}]};
  const job=await db.collection('track_jobs').findOne({...trackFilter(id,user),...access,
    $or:[{status:{$in:['processing','completed']}},{status:'failed',downloads:{$all:['mid','musicxml']}}]},
    {projection:{[`exports.${format}`]:1,preview_limit:1,solo_engine:1}});
  if(job&&SOLO_FORMATS.has(format)&&!showSolo(job))return json(res,404,{detail:'Export introuvable.'});
  const data=job?.exports?.[format];
  if(!data)return json(res,404,{detail:'Export introuvable.'});
  res.setHeader('Content-Type',FORMATS[format].type);
  res.setHeader('Content-Disposition',`attachment; filename="${FORMATS[format].suffix}"`);
  res.setHeader('Cache-Control','private, no-store');
  return res.status(200).send(Buffer.from(data,'base64'));
}

async function reviewAudio(db,req,res,user){
  const {id,audio:kind,save}=req.query;
  if(!isId(id)||!REVIEW_TRACKS.has(kind))return json(res,404,{detail:'Piste introuvable.'});
  const job=await db.collection('track_jobs').findOne({
    ...trackFilter(id,user),review_audio:kind,review_audio_expires_at:{$gt:new Date()}
  },{projection:{_id:1}});
  const track=job&&await db.collection('track_review_audio').findOne({
    _id:`${job._id}:${kind}`,expires_at:{$gt:new Date()}
  });
  if(!track)return json(res,404,{detail:'Piste introuvable ou expirée.'});
  const bytes=Buffer.from(track.data,'base64');
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Accept-Ranges','bytes');
  res.setHeader('Content-Type','audio/mpeg');
  res.setHeader('Content-Disposition',`${save==='1'?'attachment':'inline'}; filename="tablurio-${kind}.mp3"`);
  if(!req.headers.range)return res.status(200).send(bytes);
  const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if(range&&(range[1]||range[2])){
    const first=range[1]?Number(range[1]):Math.max(0,bytes.length-Number(range[2]));
    const last=range[1]&&range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
    if(first<=last&&first<bytes.length){
      res.setHeader('Content-Range',`bytes ${first}-${last}/${bytes.length}`);
      return res.status(206).send(bytes.subarray(first,last+1));
    }
  }
  res.setHeader('Content-Range',`bytes */${bytes.length}`);
  return res.status(416).end();
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
    if(req.method==='GET'&&req.query.guest==='1'){
      return await guestStatus(await database(),req,res,guestSession(req,res));
    }
    if(req.method==='POST'&&body.action==='claim_guest'&&user){
      return await claimGuestTrack(await database(),res,user,guestSession(req,res),body.id);
    }
    const uploadAction=req.method==='POST'&&['begin','chunk','queue','cancel'].includes(body.action);
    const owner=user||(uploadAction&&guestSession(req,res,body.action==='begin'));
    if(!owner)return json(res,401,{detail:'Connexion requise.'});
    if(req.method==='POST'&&body.action==='full'){
      const result=await createFullSong(await database(),user,{id:body.id,variant:body.variant},new Date(),scheduleWake);
      return json(res,result.status,result.body);
    }
    if((req.method==='GET'&&req.query.comparison==='1')||(req.method==='POST'&&body.action==='guitar_vote')){
      return await compareGuitar(await database(),req,res,user);
    }
    if(req.method==='POST'&&body.action==='piano_choice'){
      const {id,choice}=body;
      const version=typeof choice==='string'&&Object.hasOwn(PIANO_VARIANTS,choice)?PIANO_VARIANTS[choice]:null;
      if(!isId(id)||!version)return json(res,400,{detail:'Partition piano invalide.'});
      const db=await database();
      const access=user.role==='admin'?{}:{preview_limit:PREVIEW_SECONDS};
      const saved=await db.collection('track_jobs').updateOne({...trackFilter(id,user),...access,
        status:'completed',instrument:'piano',piano_primary:{$exists:true},downloads:{$all:[version.score,version.midi]}},
        {$set:{piano_choice:choice}});
      return saved.matchedCount?json(res,200,{selected:choice}):json(res,404,{detail:'Partition piano indisponible.'});
    }
    if(req.method==='GET'&&req.query.stats==='1'){
      if(user?.role!=='admin')return json(res,403,{detail:'Accès refusé.'});
      res.setHeader('Cache-Control','no-store');
      try{
        return json(res,200,await engineStats(await database()));
      }catch(error){
        console.error('Statistiques des moteurs indisponibles',error?.name,error?.code,error?.message);
        return json(res,503,{detail:'Statistiques indisponibles : '+(error?.codeName||error?.name||'erreur')});
      }
    }
    if(req.method==='GET'&&req.query.audio!==undefined&&user.role!=='admin')return json(res,403,{detail:'Accès refusé.'});
    if(req.method==='GET')return req.query.audio===undefined
      ?await download(await database(),req,res,user):await reviewAudio(await database(),req,res,user);
    if(!process.env.TRACK_WORKER_DIGEST)return json(res,503,{detail:'Le moteur de transcription est indisponible.'});
    if(body.action==='begin')return await begin(await database(),req,res,owner,body);
    if(['chunk','queue','cancel'].includes(body.action))return await upload(await database(),res,owner,body);
    return json(res,400,{detail:'Action invalide.'});
  }catch(error){return fail(res,error);}
};

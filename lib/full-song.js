'use strict';
/**
 * "Générer la suite": the whole song for one version of a preview, for a paying account.
 * The plan and the Starter daily allowance are checked on the server; generating the same
 * version of the same preview again never costs a second song.
 */
const {ObjectId}=require('mongodb');
const {PIANO_VARIANTS,PREVIEW_SECONDS,pianoComparison}=require('./track-jobs');
const {candidates}=require('./guitar-comparison');
const {reserveFullSong,releaseFullSong}=require('./billing-store');
const {youtubeTooLong,TOO_LONG_MESSAGE}=require('./audio-limit');

const RETENTION_MS=2*60*60*1000;

function versionsOf(job){
  if(job.instrument==='piano'){
    const files=new Set(job.downloads||[]);
    const keys=Object.entries(PIANO_VARIANTS).filter(([,v])=>files.has(v.score)&&files.has(v.midi)).map(([key])=>key);
    return keys.length?keys:['default'];
  }
  const keys=job.instrument==='guitare'&&job.guitar_compare===true?candidates(job).map(({key})=>key):[];
  // Single-version results (bass, voice, a plain guitar transcription): the usual pipeline.
  return keys.length?keys:['default'];
}

async function createFullSong(db,user,{id,variant},now=new Date(),wake=async()=>{}){
  if(!user||user.guest)return {status:401,body:{detail:'Connecte-toi pour générer le morceau entier.',login:true}};
  if(typeof id!=='string'||!/^[a-f0-9]{24}$/i.test(id)||typeof variant!=='string'){
    return {status:400,body:{detail:'Version invalide.'}};
  }
  const jobs=db.collection('track_jobs');
  const preview=await jobs.findOne({_id:new ObjectId(id),user_id:user._id,status:'completed',preview_limit:PREVIEW_SECONDS});
  if(!preview)return {status:404,body:{detail:'Aperçu introuvable.'}};
  if(!versionsOf(preview).includes(variant))return {status:400,body:{detail:'Cette version n’existe pas pour ce morceau.'}};
  const existing=preview.full_jobs?.[variant];
  if(existing){
    const job=await jobs.findOne({_id:existing,user_id:user._id},{projection:{status:1}});
    if(job&&job.status!=='failed')return {status:200,body:{id:String(existing),existing:true}};
  }
  if(!preview.youtube_id){
    return {status:409,body:{detail:'Pour générer le morceau entier, importe à nouveau ton fichier audio (il n’est pas conservé après l’aperçu).'}};
  }
  if(await youtubeTooLong(preview.youtube_id))return {status:400,body:{detail:TOO_LONG_MESSAGE,reason:'too_long'}};
  const fullId=new ObjectId();
  const reserved=await reserveFullSong(db,user,{jobId:fullId,variant},now);
  if(!reserved.ok){
    return {status:402,body:reserved.reason==='daily_limit'
      ?{detail:'Tu as déjà généré ton morceau complet avec Starter : le prochain est disponible 24 h après le précédent. Passe au Pro pour ne plus attendre.',reason:'daily_limit',upgrade:'pro',resets_at:reserved.resets_at||null}
      :{detail:'Choisis une offre pour générer le morceau entier.',reason:'subscription',upgrade:'plans'}};
  }
  try{
    await jobs.insertOne({_id:fullId,user_id:user._id,title:preview.title,instrument:preview.instrument,
      format:preview.format||'partition',youtube_id:preview.youtube_id,source_kind:'link',source_name:preview.source_name||'',
      capo:preview.capo==='auto'?preview.resolved_capo||0:preview.capo||0,isolated:preview.isolated===true,
      source_content:preview.source_content??null,variant,parent_id:preview._id,status:'queued',active:true,
      // Isolated voice for the whole song, unless the audio was declared instrumental:
      // the engine keeps it only when a voice is actually heard.
      ...((preview.downloads||[]).includes('vocals')||preview.source_content!=='instrumental'?{full_vocals:true}:{}),
      queued_at:now,created_at:now,authorized_at:now,expires_at:new Date(now.getTime()+RETENTION_MS)});
  }catch(error){
    await releaseFullSong(db,user,{jobId:fullId,variant});
    if(error.code===11000)return {status:409,body:{detail:'Une transcription est déjà en cours. Attends qu’elle se termine.'}};
    throw error;
  }
  await jobs.updateOne({_id:preview._id},{$set:{[`full_jobs.${variant}`]:fullId}});
  await wake();
  return {status:201,body:{id:String(fullId)}};
}

// The version the AI recommends for a finished preview, else the first one available.
function recommendedVariant(job){
  const versions=versionsOf(job);
  const pick=job.instrument==='piano'
    ?pianoComparison(job).piano_versions?.find(version=>version.recommended)?.key
    :job.auto_recommendation?.recommended;
  return versions.includes(pick)?pick:versions[0];
}

/**
 * The admin account makes content: no 30 s step, the whole song of the recommended
 * version is launched as soon as the preview is done. Returns the new job id, or null.
 */
async function autoFullSong(db,preview,now=new Date(),wake=async()=>{}){
  if(!preview||preview.variant||preview.preview_limit!==PREVIEW_SECONDS)return null;
  const owner=await db.collection('users').findOne({_id:preview.user_id});
  if(owner?.role!=='admin')return null;
  const done=await db.collection('track_jobs').findOne({_id:preview._id});
  const result=await createFullSong(db,owner,{id:String(preview._id),variant:recommendedVariant(done||preview)},now,wake);
  return result.status<300?result.body.id:null;
}

module.exports={createFullSong,autoFullSong,recommendedVariant,versionsOf};

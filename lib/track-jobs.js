'use strict';
const {ObjectId}=require('mongodb');

const CHUNK_BYTES=2*1024*1024;
const MAX_BYTES=25*1024*1024;
const PREVIEW_SECONDS=30;
const INSTRUMENTS=new Set(['piano','guitare','voix','basse']);
const AUDIO_TYPES=new Set(['wav','mp3','m4a','flac','ogg','aac']);
const SOURCE_TYPES=new Set(['mixed','instrumental','voice','instrument']);
const REVIEW_TRACKS=new Set(['original','guitar','vocals','bass','drums','piano','other']);
const FORMATS={
  pdf:{suffix:'score.pdf',type:'application/pdf'},
  musicxml:{suffix:'score.musicxml',type:'application/vnd.recordare.musicxml+xml'},
  tab:{suffix:'tab.musicxml',type:'application/vnd.recordare.musicxml+xml'},
  tabmid:{suffix:'tablature.mid',type:'audio/midi'},
  solotab:{suffix:'arrangement-solo.musicxml',type:'application/vnd.recordare.musicxml+xml'},
  solomid:{suffix:'arrangement-solo.mid',type:'audio/midi'},
  solopdf:{suffix:'arrangement-solo.pdf',type:'application/pdf'},
  mid:{suffix:'score.mid',type:'audio/midi'}
};
const JOB_FIELDS={exports:0,lease:0};
const SOLO_FORMATS=new Set(['solotab','solomid','solopdf']);
const APPROVED_SOLO_ENGINE='guitararranger-v2';
const showSolo=job=>job.solo_engine===APPROVED_SOLO_ENGINE||
  (!job.preview_limit&&job.solo_engine!=='guitararranger-v1');
const isId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
const trackFilter=(id,user)=>({_id:new ObjectId(id),user_id:user._id});

let indexes;
function prepareTracks(db){
  if(!indexes)indexes=Promise.all([
    db.collection('track_jobs').createIndex({user_id:1,active:1},{
      unique:true,partialFilterExpression:{active:true},name:'one_active_track_per_user'
    }),
    db.collection('track_jobs').createIndex({user_id:1,created_at:-1}),
    db.collection('track_audio').createIndex({expires_at:1},{expireAfterSeconds:0}),
    db.collection('track_review_audio').createIndex({expires_at:1},{expireAfterSeconds:0}),
  ]).catch(error=>{indexes=null;throw error;});
  return indexes;
}

function serialTrack(job){
  const expired=job.active&&job.expires_at<=new Date();
  return {
    id:String(job._id),title:job.title,instrument:job.instrument,provider:job.youtube_id?'YouTube':job.source_kind==='link'?'Lien audio':'Fichier audio',
    source_type:job.source_kind||'file',source_name:job.source_name||'',format:job.format||'partition',track:true,status:expired?'failed':job.status,
    duration:job.duration||0,duration_verified:Boolean(job.duration),
    preview_limit:job.preview_limit,preview_duration:job.preview_duration,
    created_at:Math.floor(job.created_at.getTime()/1000),note_count:job.note_count||0,
    downloads:(job.downloads||[]).filter(format=>!SOLO_FORMATS.has(format)||showSolo(job)),
    pdf_error:job.pdf_error===true,capo:job.capo==='auto'?job.resolved_capo||0:job.capo||0,
    auto_capo:job.capo==='auto',diagnostic:job.diagnostic,stage:job.stage,stages:job.stages,
    engine:job.engine,solo_engine:job.solo_engine,
    review_audio:job.review_audio_expires_at>new Date()?job.review_audio:undefined,
    error_message:expired?'Le délai de traitement a expiré. Importe à nouveau le fichier.':job.error_message
  };
}

module.exports={CHUNK_BYTES,MAX_BYTES,PREVIEW_SECONDS,INSTRUMENTS,AUDIO_TYPES,SOURCE_TYPES,REVIEW_TRACKS,FORMATS,JOB_FIELDS,SOLO_FORMATS,APPROVED_SOLO_ENGINE,showSolo,isId,trackFilter,prepareTracks,serialTrack};

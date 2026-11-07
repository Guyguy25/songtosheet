'use strict';
const {ObjectId}=require('mongodb');

const CHUNK_BYTES=2*1024*1024;
const MAX_BYTES=25*1024*1024;
const INSTRUMENTS=new Set(['piano','guitare','voix','basse']);
const AUDIO_TYPES=new Set(['wav','mp3','m4a','flac','ogg','aac']);
const FORMATS={
  musicxml:{suffix:'score.musicxml',type:'application/vnd.recordare.musicxml+xml'},
  tab:{suffix:'tab.musicxml',type:'application/vnd.recordare.musicxml+xml'},
  mid:{suffix:'score.mid',type:'audio/midi'}
};
const JOB_FIELDS={exports:0,lease:0};
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
  ]).catch(error=>{indexes=null;throw error;});
  return indexes;
}

function serialTrack(job){
  const expired=job.active&&job.expires_at<=new Date();
  return {
    id:String(job._id),title:job.title,instrument:job.instrument,provider:'Fichier audio',
    source_type:'file',format:'partition',track:true,status:expired?'failed':job.status,
    duration:job.duration||0,duration_verified:Boolean(job.duration),
    created_at:Math.floor(job.created_at.getTime()/1000),note_count:job.note_count||0,
    downloads:job.downloads||[],
    error_message:expired?'Le délai de traitement a expiré. Importe à nouveau le fichier.':job.error_message
  };
}

module.exports={CHUNK_BYTES,MAX_BYTES,INSTRUMENTS,AUDIO_TYPES,FORMATS,JOB_FIELDS,isId,trackFilter,prepareTracks,serialTrack};

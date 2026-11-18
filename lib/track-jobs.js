'use strict';
const {ObjectId}=require('mongodb');

const CHUNK_BYTES=2*1024*1024;
const MAX_BYTES=25*1024*1024;
const PREVIEW_SECONDS=30;
const QUEUE_WAIT_MS=5*60*1000;
const QUEUE_TIMEOUT_MESSAGE='Le moteur n’a pas pris en charge ce morceau dans les 5 minutes. Tu peux réessayer ou choisir un autre morceau.';
const PROCESSING_MS=5*60*1000;
const LEGACY_LEASE_GRACE_MS=25*60*1000-PROCESSING_MS;
const PROCESSING_TIMEOUT_MESSAGE='La génération a dépassé le délai de 5 minutes. Tu peux réessayer ou choisir un autre morceau.';
const INSTRUMENTS=new Set(['piano','guitare','voix','basse']);
const AUDIO_TYPES=new Set(['wav','mp3','m4a','flac','ogg','aac']);
const SOURCE_TYPES=new Set(['mixed','instrumental','voice','instrument']);
const REVIEW_TRACKS=new Set(['original','guitar','vocals','bass','drums','piano','other']);
// Order = display order when the judge gives no recommendation.
const PIANO_VARIANTS={
  arrangement:{label:'Arrangement deux mains',hint:'Mélodie à la main droite, accords à la main gauche',score:'pianoarrxml',midi:'pianoarrmid'},
  solo:{label:'Piano original',hint:'Le piano de l’enregistrement, note à note',score:'pianosoloxml',midi:'pianosolomid'},
  playable:{label:'Piano facile',hint:'Mélodie et basse simple, idéal pour débuter',score:'pianoeasyxml',midi:'pianoeasymid'},
  yourmt3:{label:'Version complète',hint:'Toutes les notes entendues, réparties sur deux mains',score:'pianoyourxml',midi:'pianoyourmid'},
  basic:{label:'Relevé brut',hint:'Toutes les notes détectées, sans retouche',score:'pianobasicxml',midi:'pianobasicmid'},
  reduction:{label:'Réduction piano',hint:'Mélodie et accords principaux',score:'pianoredxml',midi:'pianoredmid'}
};
const PIANO_CRITERIA=['melody','harmony','bass','rhythm','notes','playability'];
// Display policy for the spectral score, which measures audio correspondence.
const PIANO_MIN_MATCH=50;
const PIANO_MIN_MARGIN=5;
const FORMATS={
  pdf:{suffix:'score.pdf',type:'application/pdf'},
  musicxml:{suffix:'score.musicxml',type:'application/vnd.recordare.musicxml+xml'},
  tab:{suffix:'tab.musicxml',type:'application/vnd.recordare.musicxml+xml'},
  tabmid:{suffix:'tablature.mid',type:'audio/midi'},
  vocals:{suffix:'voix.mp3',type:'audio/mpeg'},
  heldtab:{suffix:'accords-tenus.musicxml',type:'application/vnd.recordare.musicxml+xml'},
  heldmid:{suffix:'accords-tenus.mid',type:'audio/midi'},
  rhythmtab:{suffix:'accords-rythmes.musicxml',type:'application/vnd.recordare.musicxml+xml'},
  rhythmmid:{suffix:'accords-rythmes.mid',type:'audio/midi'},
  solotab:{suffix:'arrangement-solo.musicxml',type:'application/vnd.recordare.musicxml+xml'},
  solomid:{suffix:'arrangement-solo.mid',type:'audio/midi'},
  solopdf:{suffix:'arrangement-solo.pdf',type:'application/pdf'},
  mid:{suffix:'score.mid',type:'audio/midi'}
};
for(const [key,{score,midi}] of Object.entries(PIANO_VARIANTS)){
  FORMATS[score]={...FORMATS.musicxml,suffix:`piano-${key}.musicxml`};
  FORMATS[midi]={...FORMATS.mid,suffix:`piano-${key}.mid`};
}
const JOB_FIELDS={exports:0,lease:0};
const SOLO_FORMATS=new Set(['solotab','solomid','solopdf']);
const APPROVED_SOLO_ENGINE='guitararranger-v2';
const showSolo=job=>job.solo_engine===APPROVED_SOLO_ENGINE||
  (!job.preview_limit&&job.solo_engine!=='guitararranger-v1');
const isId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
const trackFilter=(id,user)=>({_id:new ObjectId(id),user_id:user._id,...(user.guest?{guest_expires_at:{$gt:new Date()}}:{})});

function expiredQueue(now){
  const cutoff=new Date(now.getTime()-QUEUE_WAIT_MS);
  return {status:'queued',$or:[
    {queued_at:{$lte:cutoff}},
    {queued_at:{$exists:false},created_at:{$lte:cutoff}},
  ]};
}

function expiredProcessing(now){
  return {active:true,status:'processing',$or:[
    {processing_deadline:{$lte:now}},
    {processing_deadline:{$exists:false},lease_until:{$lte:new Date(now.getTime()+LEGACY_LEASE_GRACE_MS)}},
    {processing_deadline:{$exists:false},lease_until:{$exists:false},
      created_at:{$lte:new Date(now.getTime()-PROCESSING_MS)}},
  ]};
}

let indexes;
function prepareTracks(db){
  if(!indexes)indexes=Promise.all([
    db.collection('track_jobs').createIndex({user_id:1,active:1},{
      unique:true,partialFilterExpression:{active:true},name:'one_active_track_per_user'
    }),
    db.collection('track_jobs').createIndex({user_id:1,created_at:-1}),
    db.collection('track_jobs').createIndex({guest_expires_at:1},{expireAfterSeconds:0}),
    db.collection('track_guest_limits').createIndex({expires_at:1},{expireAfterSeconds:0}),
    db.collection('track_audio').createIndex({expires_at:1},{expireAfterSeconds:0}),
    db.collection('track_review_audio').createIndex({expires_at:1},{expireAfterSeconds:0}),
  ]).catch(error=>{indexes=null;throw error;});
  return indexes;
}

function pianoComparison(job){
  if(!job.piano_primary||job.instrument!=='piano')return {};
  const files=new Set(job.downloads);
  const options=Object.entries(PIANO_VARIANTS).filter(([,v])=>files.has(v.score)&&files.has(v.midi));
  const judge=job.piano_recommendation;
  const ranked=options.map(([key])=>({key,score:judge?.scores?.[key]}))
    .filter(({score})=>Number.isInteger(score)&&score>=0&&score<=100)
    .sort((a,b)=>b.score-a.score);
  const [first,second]=ranked;
  let recommendationStatus;
  let recommended;
  if(options.length>1){
    if(ranked.length!==options.length||(judge?.version===1&&first.score<PIANO_MIN_MATCH))
      recommendationStatus='uncertain';
    else if(first.score-second.score<(judge?.version===1?PIANO_MIN_MARGIN:1)){
      recommendationStatus='close';
      // Judge v3 breaks ties on its detailed criteria: its pick keeps the badge, and the page
      // says the versions are close.
      if(judge?.version===3&&ranked.some(({key,score})=>key===judge.recommended&&score===first.score))
        recommended=judge.recommended;
    }
    else if(first.key===judge.recommended)
      recommended=first.key;
    else
      recommendationStatus='uncertain';
  }
  const criteria=key=>{
    const values=judge?.version===3?judge.criteria?.[key]:null;
    return values?Object.fromEntries(PIANO_CRITERIA.filter(name=>Number.isInteger(values[name]))
      .map(name=>[name,values[name]])):undefined;
  };
  return {
    piano_versions:options.sort(([a],[b])=>Number(b===recommended)-Number(a===recommended))
      .map(([key,version])=>({key,...version,recommended:key===recommended,criteria:criteria(key)})),
    piano_recommendation_status:recommendationStatus,
    piano_recommendation_summary:recommended&&judge?.version===3&&typeof judge.summary==='string'?judge.summary:undefined,
  };
}

function serialTrack(job){
  const now=new Date();
  const queueExpired=job.active&&job.status==='queued'&&
    (job.queued_at??job.created_at).getTime()+QUEUE_WAIT_MS<=now.getTime();
  const expired=job.active&&job.expires_at<=now;
  const processingDeadline=job.processing_deadline?.getTime()??
    (job.lease_until?job.lease_until.getTime()-LEGACY_LEASE_GRACE_MS:job.created_at.getTime()+PROCESSING_MS);
  const processingExpired=job.active&&job.status==='processing'&&processingDeadline<=now.getTime();
  return {
    id:String(job._id),title:job.title,instrument:job.instrument,provider:job.youtube_id?'YouTube':job.source_kind==='link'?'Lien audio':'Fichier audio',
    source_type:job.source_kind||'file',source_name:job.source_name||'',format:job.format||'partition',track:true,status:queueExpired||processingExpired||expired?'failed':job.status,
    duration:job.duration||0,duration_verified:Boolean(job.duration),
    preview_limit:job.preview_limit,preview_duration:job.preview_duration,excerpt:Boolean(job.excerpt),
    created_at:Math.floor(job.created_at.getTime()/1000),note_count:job.note_count||0,
    downloads:(job.downloads||[]).filter(format=>!SOLO_FORMATS.has(format)||showSolo(job)),
    pdf_error:job.pdf_error===true,capo:job.capo==='auto'?job.resolved_capo||0:job.capo||0,
    auto_capo:job.capo==='auto',diagnostic:job.diagnostic,stage:job.stage,stages:job.stages,
    engine:job.engine,solo_engine:job.solo_engine,guitar_goal:job.guitar_goal,guitar_compare:job.guitar_compare===true,
    ...pianoComparison(job),piano_choice:job.piano_choice,
    review_audio:job.review_audio_expires_at>new Date()?job.review_audio:undefined,
    error_message:queueExpired?QUEUE_TIMEOUT_MESSAGE:processingExpired?PROCESSING_TIMEOUT_MESSAGE:
      expired?'Le délai de traitement a expiré. Importe à nouveau le fichier.':job.error_message
  };
}

module.exports={pianoComparison,PIANO_CRITERIA,CHUNK_BYTES,MAX_BYTES,PREVIEW_SECONDS,QUEUE_TIMEOUT_MESSAGE,PROCESSING_MS,PROCESSING_TIMEOUT_MESSAGE,INSTRUMENTS,AUDIO_TYPES,SOURCE_TYPES,REVIEW_TRACKS,FORMATS,PIANO_VARIANTS,JOB_FIELDS,SOLO_FORMATS,APPROVED_SOLO_ENGINE,showSolo,isId,trackFilter,expiredQueue,expiredProcessing,prepareTracks,serialTrack};

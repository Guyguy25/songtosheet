'use strict';
// Admin statistics: which transcription engine wins, per instrument.
// A version counts as "generated" when its files exist, "recommended" when the AI judge
// picked it, and "chosen" when the user selected it on the score screen.
const {PIANO_VARIANTS,PROCESSING_MS}=require('./track-jobs');
const {candidates}=require('./guitar-comparison');

const ENGINES={
  arrangement:'YourMT3+ (voix + accords) → arrangeur deux mains',
  solo:'Transkun (piano seul)',
  playable:'YourMT3+ → arrangeur facile',
  yourmt3:'YourMT3+ (toutes les notes)',
  basic:'Basic Pitch',
  reduction:'Basic Pitch → réduction',
  'original-v1':'Tsumugi (relevé note à note)',
  'solo-v2':'GuitarArranger (arrangement solo)',
  'held-v1':'YourMT3+ → accords tenus',
  'rhythm-v1':'YourMT3+ → rythmique',
};
const GUITAR_LABELS={'original-v1':'Relevé fidèle','solo-v2':'Arrangement solo','held-v1':'Accords tenus','rhythm-v1':'Rythmique'};
const MAX_JOBS=5000;

function pianoVersions(job){
  const files=new Set(job.downloads||[]);
  return Object.entries(PIANO_VARIANTS).filter(([,version])=>files.has(version.score)&&files.has(version.midi))
    .map(([key])=>key);
}

function seconds(job){
  if(!(job.finished_at instanceof Date)||!(job.processing_deadline instanceof Date))return null;
  const value=(job.finished_at-(job.processing_deadline-PROCESSING_MS))/1000;
  return value>0&&value<=PROCESSING_MS/1000?value:null;
}

function summarize(jobs,versionsOf,recommendedOf,chosenOf,scoreOf,labelOf){
  const rows=new Map();
  const durations=[];
  let judged=0,chosenJobs=0;
  for(const job of jobs){
    const keys=versionsOf(job);
    if(!keys.length)continue;
    const time=seconds(job);
    if(time!==null)durations.push({time,preview:Boolean(job.preview_limit)});
    const recommended=recommendedOf(job),chosen=chosenOf(job);
    if(recommended&&keys.includes(recommended))judged++;
    if(chosen&&keys.includes(chosen))chosenJobs++;
    for(const key of keys){
      const row=rows.get(key)||{key,label:labelOf(key),engine:ENGINES[key]||key,generated:0,recommended:0,chosen:0,scores:[]};
      row.generated++;
      if(key===recommended)row.recommended++;
      if(key===chosen)row.chosen++;
      const score=scoreOf(job,key);
      if(Number.isFinite(score))row.scores.push(score);
      rows.set(key,row);
    }
  }
  const average=values=>values.length?Math.round(10*values.reduce((a,b)=>a+b,0)/values.length)/10:null;
  const versions=[...rows.values()].map(({scores,...row})=>({...row,
    recommended_rate:row.generated?Math.round(100*row.recommended/row.generated):0,
    chosen_rate:row.generated?Math.round(100*row.chosen/row.generated):0,
    average_score:average(scores)}))
    .sort((a,b)=>b.chosen_rate-a.chosen_rate||b.recommended_rate-a.recommended_rate||b.generated-a.generated);
  return {jobs:jobs.filter(job=>versionsOf(job).length).length,judged,chosen:chosenJobs,versions,
    average_seconds:{preview:average(durations.filter(d=>d.preview).map(d=>d.time)),
      full:average(durations.filter(d=>!d.preview).map(d=>d.time))}};
}

async function engineStats(db){
  const jobs=await db.collection('track_jobs').find({status:'completed',instrument:{$in:['piano','guitare']}},
    {projection:{instrument:1,downloads:1,engine:1,solo_engine:1,preview_limit:1,piano_recommendation:1,
      piano_choice:1,auto_recommendation:1,guitar_choice:1,finished_at:1,processing_deadline:1}})
    // Sort on the _id index: an in-memory sort of full documents (stored exports) can exceed
    // MongoDB's sort memory limit.
    .sort({_id:-1}).limit(MAX_JOBS).toArray();
  const piano=jobs.filter(job=>job.instrument==='piano');
  const guitar=jobs.filter(job=>job.instrument==='guitare');
  let votes=[];
  try{
    votes=await db.collection('guitar_ballots').aggregate([{$group:{_id:'$selected',count:{$sum:1}}}]).toArray();
  }catch{/* no ballots yet */}
  const guitarStats=summarize(guitar,job=>candidates(job).map(item=>item.key),
    job=>job.auto_recommendation?.recommended,job=>job.guitar_choice,
    (job,key)=>job.auto_recommendation?.scores?.[key],key=>GUITAR_LABELS[key]||key);
  const ballots=Object.fromEntries(votes.map(({_id,count})=>[_id,count]));
  guitarStats.versions=guitarStats.versions.map(row=>({...row,community_votes:ballots[row.key]||0}));
  return {
    generated_at:new Date().toISOString(),
    piano:summarize(piano,pianoVersions,job=>job.piano_recommendation?.recommended,job=>job.piano_choice,
      (job,key)=>job.piano_recommendation?.scores?.[key],key=>PIANO_VARIANTS[key]?.label||key),
    guitar:guitarStats,
  };
}

module.exports={engineStats,summarize,ENGINES};

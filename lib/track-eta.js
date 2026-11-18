'use strict';
// Remaining-time estimate for a preview, from how long recent previews really took.
// For each stage we keep "seconds from entering this stage to the finished preview";
// the queue gets "seconds from launch to the engine taking the job" (engine start included).
const STAGES=['audio','decode','isolate','detect','arrange','judge','cached','solo','finalize','pdf'];
// Used until enough real previews have been timed (observed on the Modal engine, November 2026).
const DEFAULTS={queue:40,audio:24,decode:17,isolate:14,detect:10,arrange:6,judge:4,cached:3,solo:3,finalize:2,pdf:2};
const MIN_SAMPLES=5;
const SAMPLE_SIZE=40;
const CACHE_MS=2*60*1000;
const cache=new Map();

const median=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=sorted.length>>1;
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
};
const seconds=(later,earlier)=>(new Date(later).getTime()-new Date(earlier).getTime())/1000;

// jobs: finished previews with claimed_at, stage_at and finished_at.
function buildProfile(jobs){
  const samples={queue:[],...Object.fromEntries(STAGES.map(stage=>[stage,[]]))};
  for(const job of jobs){
    if(!job.finished_at)continue;
    const launched=job.queued_at||job.created_at;
    if(job.claimed_at&&launched){
      const wait=seconds(job.claimed_at,launched);
      if(wait>=0&&wait<600)samples.queue.push(wait);
    }
    for(const stage of STAGES){
      const at=job.stage_at?.[stage];
      if(!at)continue;
      const left=seconds(job.finished_at,at);
      if(left>=0&&left<600)samples[stage].push(left);
    }
  }
  return Object.fromEntries(Object.entries(samples).map(([key,values])=>
    [key,values.length>=MIN_SAMPLES?median(values):DEFAULTS[key]]));
}

// Seconds left for a queued or processing preview, never below 1 while it is not done.
function estimate(job,profile,now=new Date()){
  if(!['queued','processing'].includes(job.status))return null;
  if(job.status==='queued'){
    const launched=job.queued_at||job.created_at;
    const waited=launched?Math.max(0,seconds(now,launched)):0;
    return Math.max(1,Math.round(profile.queue+profile.audio-waited));
  }
  const stage=STAGES.includes(job.stage)?job.stage:'audio';
  const since=job.stage_at?.[stage]||job.claimed_at;
  const elapsed=since?Math.max(0,seconds(now,since)):0;
  return Math.max(1,Math.round(profile[stage]-elapsed));
}

async function previewProfile(db,instrument,now=Date.now()){
  const hit=cache.get(instrument);
  if(hit&&now-hit.at<CACHE_MS)return hit.profile;
  let profile=DEFAULTS;
  try{
    const jobs=await db.collection('track_jobs').find(
      {instrument,preview_limit:{$exists:true},status:'completed',claimed_at:{$exists:true},finished_at:{$exists:true}},
      {projection:{created_at:1,queued_at:1,claimed_at:1,stage_at:1,finished_at:1},sort:{finished_at:-1},limit:SAMPLE_SIZE}).toArray();
    profile=buildProfile(jobs);
  }catch{}
  cache.set(instrument,{at:now,profile});
  return profile;
}

// ETA in seconds for a free preview still in progress, else undefined.
async function previewEta(db,job,now=new Date()){
  if(!job?.preview_limit||!['queued','processing'].includes(job.status))return undefined;
  return estimate(job,await previewProfile(db,job.instrument),now);
}

module.exports={buildProfile,estimate,previewEta,DEFAULTS,STAGES};

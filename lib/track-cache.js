'use strict';
/**
 * Songs already generated are reused: the same YouTube video, instrument, settings and
 * version give the same result, so a new job copies a finished one instead of waking the
 * engine. CACHE_VERSION invalidates every older result when the engine changes notably.
 */
const CACHE_VERSION='v1';

// Fields that belong to one person's job, never copied from another.
const OWN_FIELDS=new Set(['_id','user_id','title','source_name','created_at','queued_at','authorized_at','expires_at',
  'finished_at','claimed_at','active','status','lease','lease_until','audio_url','full_jobs','guitar_choice','piano_choice',
  'parent_id','guest_expires_at','error_message','error_detail','cached_from','cache_key','survey_asked']);

function cacheKey(job){
  if(!job?.youtube_id)return null;
  // A chosen excerpt is its own result; the default first 30 s is the plain preview.
  if(job.excerpt&&(job.excerpt.start_ms!==0||job.excerpt.end_ms!==30000))return null;
  const kind=job.preview_limit?`preview${job.preview_limit}`:`full:${job.variant||'default'}`;
  return [CACHE_VERSION,job.youtube_id,job.instrument,job.format||'partition',job.source_content||'',
    job.guitar_goal||'',job.capo==='auto'?'auto':job.capo||0,kind].join('|');
}

/** Copies a finished job with the same cache key into `job`. Returns true when it did. */
async function reuseCached(db,job,now=new Date()){
  if(!job?.cache_key)return false;
  const jobs=db.collection('track_jobs');
  const [source]=await jobs.find({cache_key:job.cache_key,status:'completed'}).sort({finished_at:-1}).limit(1).toArray();
  if(!source||source._id.equals(job._id)||!source.exports)return false;
  const copied=Object.fromEntries(Object.entries(source).filter(([key])=>!OWN_FIELDS.has(key)));
  const result=await jobs.updateOne({_id:job._id,status:job.status},
    {$set:{...copied,status:'completed',active:false,finished_at:now,cached_from:source._id},
      $unset:{lease:'',lease_until:'',audio_url:''}});
  if(!result.modifiedCount)return false;
  Object.assign(job,copied,{status:'completed',active:false,finished_at:now,cached_from:source._id});
  return true;
}

module.exports={CACHE_VERSION,cacheKey,reuseCached};

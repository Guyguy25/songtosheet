'use strict';
// Wake the cloud transcription engine (Modal) when a job is queued.
// Never throws. On Vercel the call runs after the response (waitUntil), with time for
// a cold Modal endpoint to answer; if it is still lost, the engine's watchdog picks the
// job up within a couple of minutes.
const TIMEOUT_MS=2000;
const BACKGROUND_TIMEOUT_MS=10000;

async function wakeEngine(timeout=TIMEOUT_MS,warm=false){
  const base=process.env.ENGINE_WAKE_URL;
  if(!base)return;
  const url=warm?`${base}${base.includes('?')?'&':'?'}warm=1`:base;
  try{
    const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${process.env.ENGINE_WAKE_SECRET||''}`},
      signal:AbortSignal.timeout(timeout)});
    console.log(`engine wake: HTTP ${response?.status}`);
  }catch(error){
    console.log(`engine wake failed: ${error?.name||'error'}`);
  }
}

const WARM_MS=75*1000;

/** Wakes the engine; warm: woken early (link pasted), it then waits ~90 s for the job. */
async function scheduleWake(warm=false){
  if(!process.env.ENGINE_WAKE_URL)return;
  let waitUntil=null;
  try{({waitUntil}=require('@vercel/functions'));}catch{/* outside Vercel */}
  if(typeof waitUntil==='function'){
    waitUntil(wakeEngine(BACKGROUND_TIMEOUT_MS,warm));
    return;
  }
  await wakeEngine(TIMEOUT_MS,warm);
}

/**
 * A link was pasted: start the GPU while the person picks the instrument.
 * At most once per 75 s for the whole site. Returns true when it woke the engine.
 */
async function warmEngine(db,now=new Date()){
  const state=db.collection('engine_state');
  const claimed=await state.updateOne({_id:'engine',$or:[{warmed_at:{$lt:new Date(now.getTime()-WARM_MS)}},{warmed_at:{$exists:false}}]},
    {$set:{warmed_at:now}}).catch(()=>({matchedCount:0}));
  if(!claimed.matchedCount){
    // First time ever: create the record (a duplicate key means another call just did).
    const created=await state.insertOne({_id:'engine',warmed_at:now}).then(()=>true,()=>false);
    if(!created)return false;
  }
  await scheduleWake(true);
  return true;
}

/** A warm engine is already waiting for this job: no second container needed. */
async function recentlyWarmed(db,now=new Date()){
  const doc=await db.collection('engine_state').findOne({_id:'engine'}).catch(()=>null);
  return Boolean(doc?.warmed_at&&now-new Date(doc.warmed_at)<WARM_MS);
}

module.exports={wakeEngine,scheduleWake,warmEngine,recentlyWarmed,WARM_MS};

'use strict';
// Wake the cloud transcription engine (Modal) when a job is queued.
// Never throws. On Vercel the call runs after the response (waitUntil), with time for
// a cold Modal endpoint to answer; if it is still lost, the engine's watchdog picks the
// job up within a couple of minutes.
const TIMEOUT_MS=2000;
const BACKGROUND_TIMEOUT_MS=10000;

async function wakeEngine(timeout=TIMEOUT_MS){
  const url=process.env.ENGINE_WAKE_URL;
  if(!url)return;
  try{
    const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${process.env.ENGINE_WAKE_SECRET||''}`},
      signal:AbortSignal.timeout(timeout)});
    console.log(`engine wake: HTTP ${response?.status}`);
  }catch(error){
    console.log(`engine wake failed: ${error?.name||'error'}`);
  }
}

async function scheduleWake(){
  if(!process.env.ENGINE_WAKE_URL)return;
  let waitUntil=null;
  try{({waitUntil}=require('@vercel/functions'));}catch{/* outside Vercel */}
  if(typeof waitUntil==='function'){
    waitUntil(wakeEngine(BACKGROUND_TIMEOUT_MS));
    return;
  }
  await wakeEngine();
}

module.exports={wakeEngine,scheduleWake};

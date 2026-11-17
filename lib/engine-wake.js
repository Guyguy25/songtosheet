'use strict';
// Wake the cloud transcription engine (Modal) when a job is queued.
// Never throws and never waits more than 2 s: if the call is lost, the engine's
// own watchdog picks the job up within a couple of minutes.
const TIMEOUT_MS=2000;

async function wakeEngine(){
  const url=process.env.ENGINE_WAKE_URL;
  if(!url)return;
  try{
    await fetch(url,{method:'POST',headers:{authorization:`Bearer ${process.env.ENGINE_WAKE_SECRET||''}`},
      signal:AbortSignal.timeout(TIMEOUT_MS)});
  }catch{/* The watchdog covers a lost wake-up. */}
}

module.exports={wakeEngine};

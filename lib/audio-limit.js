'use strict';
// One generation handles up to 10 minutes of audio. YouTube durations come from the official API;
// when it cannot answer, the engine enforces the same limit after downloading.
const MAX_AUDIO_SECONDS=600;
const TOO_LONG_MESSAGE='Tablurio ne prend pas encore les audios de plus de 10 minutes. Choisis un morceau plus court.';

function isoSeconds(iso){
  const match=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso||''));
  if(!match)return null;
  return Number(match[1]||0)*86400+Number(match[2]||0)*3600+Number(match[3]||0)*60+Number(match[4]||0);
}

async function youtubeSeconds(id,fetcher=fetch){
  const key=process.env.YOUTUBE_DATA_API_KEY;
  if(!key||!/^[\w-]{11}$/.test(String(id||'')))return null;
  try{
    const response=await fetcher('https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id='+id+'&key='+encodeURIComponent(key),
      {signal:AbortSignal.timeout(2500)});
    if(!response.ok)return null;
    const data=await response.json();
    return isoSeconds(data.items?.find(item=>item.id===id)?.contentDetails?.duration);
  }catch{return null;}
}

async function youtubeTooLong(id,fetcher){
  const seconds=await youtubeSeconds(id,fetcher);
  return seconds!==null&&seconds>MAX_AUDIO_SECONDS+1;
}

module.exports={MAX_AUDIO_SECONDS,TOO_LONG_MESSAGE,isoSeconds,youtubeSeconds,youtubeTooLong};

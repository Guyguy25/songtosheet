'use strict';
// How much of the excerpt a version actually plays: bars that hold at least one pitched note.
const MEASURE=/<measure\b[^>]*?(?:\/>|>[\s\S]*?<\/measure>)/g;
// A version playing in less than this share of the fullest version's bars is not recommendable.
const MIN_COVERAGE=.4;

function playedBars(xml){
  const bars=String(xml||'').match(MEASURE)||[];
  return new Set(bars.filter(bar=>/<pitch>/.test(bar)).map(bar=>(bar.match(/number="([^"]+)"/)||[])[1]??bar)).size;
}

// Keep the judge's scores, but never recommend a version that goes silent after a few bars.
function coveredRecommendation(scores,files){
  const played=Object.fromEntries(Object.keys(scores).map(key=>[key,files[key]?playedBars(files[key]):0]));
  const fullest=Math.max(0,...Object.values(played));
  if(!fullest)return null;
  const eligible=Object.keys(scores).filter(key=>played[key]>=fullest*MIN_COVERAGE);
  if(!eligible.length)return null;
  return eligible.reduce((best,key)=>scores[key]>scores[best]?key:best,eligible[0]);
}

module.exports={playedBars,coveredRecommendation,MIN_COVERAGE};

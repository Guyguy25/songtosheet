'use strict';
// The opening bars of a finished preview, shown to a visitor before they sign up.
const TEASER_MEASURES=8;
const MEASURE=/<measure\b[^>]*?(?:\/>|>[\s\S]*?<\/measure>)/g;
const PART=/(<part(?=[\s>])[^>]*>)([\s\S]*?)(<\/part>)/g;
const TEASER_FILES=['tab','musicxml','heldtab','rhythmtab','solotab'];

function teaserMusicXml(xml,measures=TEASER_MEASURES){
  const source=String(xml||'');
  if(!/<score-partwise\b/.test(source))return null;
  let found=false;
  const trimmed=source.replace(PART,(_,open,body,close)=>{
    const kept=(body.match(MEASURE)||[]).slice(0,measures);
    if(kept.length)found=true;
    return open+kept.join('')+close;
  });
  return found?trimmed:null;
}

const measureCount=xml=>{
  const part=String(xml).match(PART);
  return part?(part[0].match(MEASURE)||[]).length:0;
};

// Candidate files in order of preference (the recommended version first). The first one with
// enough bars for two lines wins; otherwise the longest, so a sparse version never shows alone.
function teaserSource(job,preferred=[]){
  const exports=job?.exports||{};
  const order=[...preferred,...(job?.format==='tablature'?['tab','musicxml']:['musicxml','tab']),...TEASER_FILES];
  let best=null,bestCount=-1;
  for(const key of new Set(order)){
    if(!exports[key])continue;
    const xml=Buffer.from(exports[key],'base64').toString('utf8');
    const count=measureCount(xml);
    if(count>=TEASER_MEASURES)return xml;
    if(count>bestCount){best=xml;bestCount=count;}
  }
  return best;
}

module.exports={teaserMusicXml,teaserSource,TEASER_MEASURES,TEASER_FILES};

'use strict';
// The opening bars of a finished preview, shown to a visitor before they sign up.
const TEASER_MEASURES=8;
const MEASURE=/<measure\b[^>]*?(?:\/>|>[\s\S]*?<\/measure>)/g;
const PART=/(<part(?=[\s>])[^>]*>)([\s\S]*?)(<\/part>)/g;

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

// Tablature first when the visitor asked for one, otherwise the score.
function teaserSource(job){
  const exports=job?.exports||{};
  const order=job?.format==='tablature'?['tab','musicxml']:['musicxml','tab'];
  const key=order.find(name=>exports[name])||Object.keys(exports).find(name=>!/mid|pdf|mp3/i.test(name));
  return key?Buffer.from(exports[key],'base64').toString('utf8'):null;
}

module.exports={teaserMusicXml,teaserSource,TEASER_MEASURES};

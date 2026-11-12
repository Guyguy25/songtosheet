'use strict';
const {createHash,createHmac,timingSafeEqual}=require('node:crypto');
const {json}=require('./session');
const {isId,trackFilter,showSolo,PREVIEW_SECONDS}=require('./track-jobs');

const MIN_PREFERENCES=6;
const MIN_HEAD_TO_HEAD=12;
const hash=value=>createHash('sha256').update(value).digest('hex');
let ballotIndex;

function sourceKey(source){
  if(source.youtubeId)return 'youtube:'+source.youtubeId;
  const url=new URL(source.url);
  url.hash='';
  return 'url:'+hash(url.href);
}

function candidates(job){
  const files=new Set(job.downloads||[]);
  const versions=[];
  const add=(key,score,midi)=>{
    if(files.has(score)&&files.has(midi))versions.push({key,score,midi});
  };
  if(job.engine!=='yourmt3-guitar-chords-v1'){
    add('original-v1',files.has('tab')?'tab':'musicxml',files.has('tabmid')?'tabmid':'mid');
    if(showSolo(job))add('solo-v2','solotab','solomid');
  }
  if(files.has('heldtab'))add('held-v1','heldtab','heldmid');
  else if(job.engine==='yourmt3-guitar-chords-v1')add('held-v1','musicxml','mid');
  add('rhythm-v1','rhythmtab','rhythmmid');
  return versions;
}

function rank(versions,ballots){
  const totals=new Map(versions.map(({key})=>[key,{key,likes:0,dislikes:0}]));
  for(const {selected,shown,count} of ballots){
    for(const key of shown){
      const item=totals.get(key);
      if(item)item[key===selected?'likes':'dislikes']+=count;
    }
  }
  const ordered=[...totals.values()].sort((a,b)=>b.likes-a.likes);
  const [best,second]=ordered;
  const recommended=best?.likes>=MIN_PREFERENCES&&best.likes>(second?.likes??0)?best.key:null;
  let hidden=null;
  if(recommended&&versions.length>=3){
    const comparisons=ordered.slice(1).map(({key})=>{
      let wins=0,losses=0;
      for(const {selected,shown,count} of ballots){
        if(shown.includes(key)&&shown.includes(recommended)){
          if(selected===key)wins+=count;
          else if(selected===recommended)losses+=count;
        }
      }
      return {key,wins,losses};
    }).filter(({wins,losses})=>wins+losses>=MIN_HEAD_TO_HEAD&&wins/(wins+losses)<=.15);
    comparisons.sort((a,b)=>a.wins/(a.wins+a.losses)-b.wins/(b.wins+b.losses)||b.losses-a.losses);
    hidden=comparisons[0]?.key??null;
  }
  return {recommended,hidden,totals:[...totals.values()]};
}

function sign(value){
  const secret=process.env.AUTH_SESSION_SECRET||process.env.MONGODB_URI;
  if(!secret||secret.length<20)throw new Error('Configuration de vote incomplète.');
  return createHmac('sha256',secret).update('songtosheet-guitar-vote-v1:').update(value).digest('base64url');
}

function exposure(job,user,shown){
  const payload=Buffer.from(JSON.stringify({job:String(job._id),user:String(user._id),shown,expires:Date.now()+86400000})).toString('base64url');
  return payload+'.'+sign(payload);
}

function verifiedExposure(token,job,user){
  if(typeof token!=='string'||token.length>1000)return null;
  const [payload,mac,extra]=token.split('.');
  if(!payload||!mac||extra!==undefined)return null;
  const expected=Buffer.from(sign(payload)),supplied=Buffer.from(mac);
  if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied))return null;
  const value=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  if(value.job!==String(job._id)||value.user!==String(user._id)||value.expires<Date.now())return null;
  return value.shown;
}

async function compareGuitar(db,req,res,user){
  const id=req.method==='GET'?req.query.id:req.body?.id;
  if(!isId(id))return json(res,404,{detail:'Création introuvable.'});
  const access=user.role==='admin'?{}:{preview_limit:PREVIEW_SECONDS};
  const job=await db.collection('track_jobs').findOne({...trackFilter(id,user),...access,instrument:'guitare',status:'completed'},
    {projection:{downloads:1,engine:1,solo_engine:1,preview_limit:1,song_key:1,youtube_id:1,auto_recommendation:1}});
  if(!job)return json(res,404,{detail:'Comparaison indisponible.'});
  const versions=candidates(job);
  const decorate=(version,community)=>{
    const automatic=!community&&version.key===job.auto_recommendation?.recommended;
    return {...version,recommended:version.key===community||automatic,
      recommendation_source:automatic?'ai':version.key===community?'votes':null};
  };
  const song=job.song_key||(job.youtube_id?'youtube:'+job.youtube_id:'job:'+id);
  const votes=db.collection('guitar_ballots');
  const ballotId=song+':'+String(user._id);
  if(req.method==='POST'){
    const {token,choice}=req.body;
    const shown=verifiedExposure(token,job,user);
    const available=new Set(versions.map(item=>item.key));
    if(!Array.isArray(shown)||shown.length<2||!shown.includes(choice)||shown.some(key=>!available.has(key))){
      return json(res,400,{detail:'Recharge la comparaison avant de voter.'});
    }
    try{
      await votes.updateOne({_id:ballotId},{$setOnInsert:{song,shown:[...shown].sort(),selected:choice,created_at:new Date()}},{upsert:true});
    }catch(error){if(error.code!==11000)throw error;}
  }
  let ballot,counts;
  try{
    ballotIndex??=votes.createIndex({song:1}).catch(error=>{ballotIndex=null;throw error;});
    await ballotIndex;
    [ballot,counts]=await Promise.all([
      votes.findOne({_id:ballotId},{projection:{selected:1}}),
      votes.aggregate([{$match:{song}},{$group:{_id:{selected:'$selected',shown:'$shown'},count:{$sum:1}}}]).toArray()
    ]);
  }catch(error){
    if(req.method==='POST')throw error;
    return json(res,200,{versions:versions.map(version=>decorate(version,null)),selected:null,token:null,votingUnavailable:true});
  }
  const {recommended,hidden}=rank(versions,counts.map(({_id,count})=>({..._id,count})));
  const shown=versions.filter(({key})=>key!==hidden||key===ballot?.selected)
    .map(item=>({...item,order:hash(ballotId+':'+item.key)}))
    .sort((a,b)=>a.order.localeCompare(b.order));
  return json(res,200,{versions:shown.map(({order,...item})=>decorate(item,recommended)),
    selected:ballot?.selected??null,token:!ballot&&shown.length>=2?exposure(job,user,shown.map(item=>item.key)):null});
}

module.exports={sourceKey,candidates,rank,compareGuitar};

/**
 * SongToSheet — métadonnées publiques de liens musicaux, sans téléchargement audio.
 * En V1, les durées ne sont vérifiées que si la plateforme fournit une valeur exploitable.
 * Les URL utilisateur ne sont jamais transmises directement à fetch (anti-SSRF).
 */
'use strict';

const TIMEOUT_MS=4700;
const MAX_LENGTH_SECONDS=360;
const LIMIT_MESSAGE='Ce morceau dépasse 6 minutes. Choisis une version de 6 minutes maximum pour créer ta partition.';
const clean=(value,limit=120)=>String(value||'').replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit);
const safeSeconds=(value)=>Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<24*3600?Math.round(Number(value)):null;

async function fetchData(url) {
  const response=await fetch(url,{
    method:'GET',redirect:'error',
    signal:AbortSignal.timeout(TIMEOUT_MS),
    headers:{'Accept':'application/json','User-Agent':'SongToSheet-preview/1.0'}
  });
  if(!response.ok)throw new Error('provider unavailable');
  const raw=await response.text();
  if(raw.length>250000)throw new Error('metadata too large');
  return JSON.parse(raw);
}
async function fetchYouTubeDuration(id) {
  const response=await fetch('https://www.youtube.com/watch?v='+id,{
    method:'GET',
    redirect:'error',
    signal:AbortSignal.timeout(TIMEOUT_MS),
    headers:{'User-Agent':'Mozilla/5.0 (compatible; SongToSheetPreview/1.0)','Accept':'text/html'}
  });
  if(!response.ok)throw new Error('duration unavailable');
  const html=(await response.text()).slice(0,2600000);
  let match=html.match(/"videoDetails"\s*:\s*\{[\s\S]{0,1500}?"lengthSeconds"\s*:\s*"(\d+)"/);
  if(!match)match=html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
  if(match)return safeSeconds(match[1]);
  match=html.match(/"approxDurationMs"\s*:\s*"(\d+)"/);
  if(match)return safeSeconds(Number(match[1])/1000);
  match=html.match(/"duration"\s*:\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/);
  return match?safeSeconds(Number(match[1]||0)*3600+Number(match[2]||0)*60+Number(match[3]||0)):null;
}

function parseSource(raw) {
  if(typeof raw!=='string'||raw.length>1800)throw Object.assign(new Error('Ce lien est trop long ou invalide.'),{status:400});
  let u;
  try{u=new URL(raw);}catch{throw Object.assign(new Error('Colle un lien HTTPS valide.'),{status:400});}
  if(u.protocol!=='https:'||u.username||u.password||u.port)throw Object.assign(new Error('Utilise un lien HTTPS valide.'),{status:400});
  const host=u.hostname.toLowerCase().replace(/\.$/,'');
  let id;
  if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'].includes(host)){
    const parts=u.pathname.split('/').filter(Boolean);
    id=host==='youtu.be'?parts[0]:u.pathname==='/watch'?u.searchParams.get('v'):['shorts','live','embed'].includes(parts[0])?parts[1]:null;
    if(!/^[a-zA-Z0-9_-]{11}$/.test(id||''))throw Object.assign(new Error('Ce lien YouTube ne pointe pas vers une vidéo valide.'),{status:400});
    return {provider:'YouTube',id,canonical:'https://www.youtube.com/watch?v='+id};
  }
  if(['open.spotify.com','spotify.com','spotify.link'].includes(host)){
    const m=u.pathname.match(/(?:^|\/)track\/([a-zA-Z0-9]{22})(?:\/|$)/);
    if(!m&&host!=='spotify.link')throw Object.assign(new Error('Colle le lien d’un morceau Spotify, pas d’une playlist ni d’un album.'),{status:400});
    return {provider:'Spotify',id:m?m[1]:null,canonical:m?'https://open.spotify.com/track/'+m[1]:null};
  }
  if(['deezer.com','www.deezer.com'].includes(host)){
    const m=u.pathname.match(/(?:^|\/)track\/(\d+)(?:\/|$)/);
    if(!m)throw Object.assign(new Error('Colle un lien vers un morceau Deezer.'),{status:400});
    return {provider:'Deezer',id:m[1],canonical:'https://www.deezer.com/track/'+m[1]};
  }
  if(host==='music.apple.com'){
    const m=u.searchParams.get('i')||u.pathname.match(/\/song\/[^/]+\/(\d+)/)?.[1];
    if(!/^\d{4,20}$/.test(m||''))throw Object.assign(new Error('Colle le lien d’un morceau Apple Music (pas d’un album).'),{status:400});
    return {provider:'Apple Music',id:m,canonical:'https://music.apple.com/song/'+m};
  }
  if(['soundcloud.com','www.soundcloud.com'].includes(host)){
    const parts=u.pathname.split('/').filter(Boolean);
    if(parts.length<2)throw Object.assign(new Error('Colle le lien direct d’un morceau SoundCloud.'),{status:400});
    return {provider:'SoundCloud',canonical:'https://soundcloud.com/'+parts.slice(0,3).map(encodeURIComponent).join('/')};
  }
  throw Object.assign(new Error('Plateforme non reconnue : utilise YouTube, Spotify, Deezer, SoundCloud ou Apple Music.'),{status:400});
}

async function getInfo(src) {
  const result={provider:src.provider,title:null,artist:null,thumbnail_url:null,duration_seconds:null,duration_verified:false};
  if(src.provider==='YouTube'){
    const work=await Promise.allSettled([
      fetchData('https://www.youtube.com/oembed?url='+encodeURIComponent(src.canonical)+'&format=json'),
      fetchYouTubeDuration(src.id)
    ]);
    if(work[0].status==='fulfilled'){
      const data=work[0].value;
      result.title=clean(data.title);
      result.artist=clean(data.author_name,80);
      if(typeof data.thumbnail_url==='string'&&/^https:\/\/(?:i\.ytimg\.com|img\.youtube\.com)\//.test(data.thumbnail_url))result.thumbnail_url=data.thumbnail_url;
    }
    if(work[1].status==='fulfilled')result.duration_seconds=safeSeconds(work[1].value);
  }else if(src.provider==='Spotify'){
    if(src.canonical){
      try{
        const data=await fetchData('https://open.spotify.com/oembed?url='+encodeURIComponent(src.canonical));
        result.title=clean(data.title);
        if(typeof data.thumbnail_url==='string'&&/^https:\/\/(?:i\.scdn\.co|image-cdn-ak\.spotifycdn\.com|mosaic\.scdn\.co)\//.test(data.thumbnail_url))result.thumbnail_url=data.thumbnail_url;
      }catch{}
    }
  }else if(src.provider==='Deezer'){
    try{
      const data=await fetchData('https://api.deezer.com/track/'+src.id);
      if(data.error)throw new Error('bad track');
      result.title=clean(data.title);
      result.artist=clean(data.artist?.name,80);
      result.duration_seconds=safeSeconds(data.duration);
      if(typeof data.album?.cover_medium==='string'&&data.album.cover_medium.startsWith('https://e-cdns-images.dzcdn.net/'))result.thumbnail_url=data.album.cover_medium;
    }catch{}
  }else if(src.provider==='Apple Music'){
    try{
      const data=await fetchData('https://itunes.apple.com/lookup?id='+src.id+'&entity=song&limit=1');
      const track=data.results?.find(item=>item.kind==='song');
      if(track){
        result.title=clean(track.trackName);
        result.artist=clean(track.artistName,80);
        result.duration_seconds=safeSeconds(Number(track.trackTimeMillis)/1000);
        if(typeof track.artworkUrl100==='string'&&/^https:\/\/is\d+-ssl\.mzstatic\.com\//.test(track.artworkUrl100))result.thumbnail_url=track.artworkUrl100;
      }
    }catch{}
  }else if(src.provider==='SoundCloud'){
    try{
      const data=await fetchData('https://soundcloud.com/oembed?format=json&url='+encodeURIComponent(src.canonical));
      result.title=clean(data.title);
      result.artist=clean(data.author_name,80);
      if(typeof data.thumbnail_url==='string'&&data.thumbnail_url.startsWith('https://i1.sndcdn.com/'))result.thumbnail_url=data.thumbnail_url;
    }catch{}
  }
  result.duration_verified=result.duration_seconds!==null;
  return result;
}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Méthode non autorisée.'});}
  try{
    const src=parseSource(req.query?.url);
    const result=await getInfo(src);
    if(result.duration_verified && result.duration_seconds>MAX_LENGTH_SECONDS){
      return res.status(422).json({error:LIMIT_MESSAGE,duration_seconds:result.duration_seconds,provider:src.provider});
    }
    return res.status(200).json(result);
  }catch(e){
    return res.status(e.status===400?400:503).json({error:e.status===400?e.message:'Impossible de vérifier ce lien. Réessaie ou importe ton fichier audio.'});
  }
};

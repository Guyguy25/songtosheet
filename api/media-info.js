/**
 * SongToSheet — métadonnées publiques de liens musicaux, sans téléchargement audio.
 * En V1, les durées ne sont vérifiées que si la plateforme fournit une valeur exploitable.
 * Les URL utilisateur ne sont jamais transmises directement à fetch (anti-SSRF).
 */
'use strict';

const TIMEOUT_MS=4700;
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

/**
 * Parse uniquement le player initial de la vidéo demandée.
 * Ne jamais lire une occurrence globale de lengthSeconds : elle pourrait
 * concerner une vidéo recommandée dans la page YouTube.
 */
function playerJson(html) {
  const marker=/\bytInitialPlayerResponse\s*=\s*\{/g;
  let match;
  while((match=marker.exec(html))!==null){
    const start=html.indexOf('{',match.index);
    let depth=0,inString=false,escaped=false;
    for(let i=start;i<Math.min(html.length,start+1000000);i++){
      const char=html[i];
      if(inString){
        if(escaped)escaped=false;
        else if(char==='\\')escaped=true;
        else if(char==='"')inString=false;
        continue;
      }
      if(char==='"'){inString=true;continue;}
      if(char==='{')depth++;
      if(char==='}'&&--depth===0){
        try{return JSON.parse(html.slice(start,i+1));}catch{break;}
      }
    }
  }
  return null;
}
function verifiedPlayerDuration(html,id){
  const data=playerJson(html);
  if(!data||data.videoDetails?.videoId!==id||data.videoDetails?.isLiveContent)return null;
  const seconds=safeSeconds(data.videoDetails.lengthSeconds);
  return seconds;
}
async function fetchYouTubeDuration(id) {
  const response=await fetch('https://www.youtube.com/watch?v='+id,{
    method:'GET',redirect:'error',
    signal:AbortSignal.timeout(TIMEOUT_MS),
    headers:{'User-Agent':'Mozilla/5.0 (compatible; SongToSheetPreview/1.0)','Accept':'text/html'}
  });
  if(!response.ok)throw new Error('duration unavailable');
  const html=(await response.text()).slice(0,3200000);
  return verifiedPlayerDuration(html,id);
}
async function fetchYouTubeEmbedDuration(id) {
  // Seconde source publique : l'embed peut répondre même si la page watch
  // est inaccessible depuis l'infrastructure serveur.
  const response=await fetch('https://www.youtube-nocookie.com/embed/'+id+'?playsinline=1',{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(TIMEOUT_MS),
    headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html'}
  });
  if(!response.ok)return null;
  const html=(await response.text()).slice(0,3200000);
  return verifiedPlayerDuration(html,id);
}
function parseIsoDuration(iso){
  const match=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso||''));
  if(!match)return null;
  return safeSeconds(Number(match[1]||0)*86400+Number(match[2]||0)*3600+Number(match[3]||0)*60+Number(match[4]||0));
}
async function fetchYouTubeOfficial(id){
  const key=process.env.YOUTUBE_DATA_API_KEY;
  if(!key)return null;
  const data=await fetchData('https://www.googleapis.com/youtube/v3/videos?part=contentDetails%2Csnippet%2CliveStreamingDetails&id='+id+'&key='+encodeURIComponent(key));
  const video=data.items?.find(item=>item.id===id);
  if(!video||video.snippet?.liveBroadcastContent==='live'||video.liveStreamingDetails?.actualEndTime===undefined&&video.liveStreamingDetails?.actualStartTime)return null;
  const duration=parseIsoDuration(video.contentDetails?.duration);
  return {duration,title:clean(video.snippet?.title),artist:clean(video.snippet?.channelTitle,80)};
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
      fetchYouTubeDuration(src.id),
      fetchYouTubeEmbedDuration(src.id),
      fetchYouTubeOfficial(src.id)
    ]);
    if(work[0].status==='fulfilled'){
      const data=work[0].value;
      result.title=clean(data.title);
      result.artist=clean(data.author_name,80);
      if(typeof data.thumbnail_url==='string'&&/^https:\/\/(?:i\.ytimg\.com|img\.youtube\.com)\//.test(data.thumbnail_url))result.thumbnail_url=data.thumbnail_url;
    }
    if(work[1].status==='fulfilled')result.duration_seconds=safeSeconds(work[1].value);
    if(result.duration_seconds===null&&work[2].status==='fulfilled')result.duration_seconds=safeSeconds(work[2].value);
    if(work[3].status==='fulfilled'&&work[3].value){
      const official=work[3].value;
      if(official.duration!==null)result.duration_seconds=official.duration;
      if(official.title)result.title=official.title;
      if(official.artist)result.artist=official.artist;
    }
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
    if(!result.duration_verified){
      return res.status(424).json({
        error:'Impossible de vérifier la durée de cette vidéo ou de ce morceau.',
        provider:src.provider,
        title:result.title,
        artist:result.artist,
        thumbnail_url:result.thumbnail_url,
        duration_verified:false
      });
    }
    return res.status(200).json(result);
  }catch(e){
    return res.status(e.status===400?400:503).json({error:e.status===400?e.message:'Impossible de vérifier ce lien. Réessaie ou importe ton fichier audio.'});
  }
};

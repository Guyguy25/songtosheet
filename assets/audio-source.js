(function(){
  'use strict';
  const providers=[
    ['YouTube',['youtube.com','youtu.be','youtube-nocookie.com']],
    ['Spotify',['spotify.com','spotify.link']],
    ['Deezer',['deezer.com','deezer.page.link']],
    ['SoundCloud',['soundcloud.com','snd.sc']],
    ['Apple Music',['music.apple.com']]
  ];

  function parse(value){
    if(typeof value!=='string'||value.length>4096)return null;
    let url;
    try{url=new URL(value);}catch{return null;}
    if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
    const host=url.hostname.replace(/\.$/,'');
    const provider=providers.find(([,domains])=>domains.some(domain=>host===domain||host.endsWith('.'+domain)))?.[0];
    let youtubeId;
    if(provider==='YouTube'){
      const [,first,second]=url.pathname.split('/');
      const id=host==='youtu.be'?first:first==='watch'?url.searchParams.get('v'):
        ['shorts','embed','live'].includes(first)?second:null;
      if(/^[\w-]{11}$/.test(id||''))youtubeId=id;
    }
    url.hash='';
    return {url,provider,youtubeId};
  }

  function importHint(provider){
    return `Le lien ${provider} sert de référence. Pour transcrire le morceau, ajoute un fichier audio autorisé ou son lien direct.`;
  }

  if(typeof module==='object')module.exports={parse,importHint};
  else window.SongToSheetAudioSource={parse,importHint};
})();

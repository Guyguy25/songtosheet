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

  const platformLogos=`<span class="source-platforms" role="img" aria-label="YouTube, Spotify et Deezer">
    <svg viewBox="0 0 24 24" aria-hidden="true"><title>YouTube</title><path fill="currentColor" fill-rule="evenodd" d="M22 8a3 3 0 0 0-2.1-2.1C18 5.4 12 5.4 12 5.4s-6 0-7.9.5A3 3 0 0 0 2 8a24 24 0 0 0 0 8 3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5A3 3 0 0 0 22 16a24 24 0 0 0 0-8ZM10 9v6l5-3Z"/></svg>
    <svg viewBox="0 0 24 24" aria-hidden="true"><title>Spotify</title><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M6.5 9.4c4.3-1.2 8.2-.7 11.3 1.2M7.4 12.4c3.4-.9 6.6-.5 9.3 1M8.2 15.2c2.7-.7 5.3-.4 7.6.9" fill="none" stroke="var(--source-icon-cutout, #fff)" stroke-width="1.45" stroke-linecap="round"/></svg>
    <svg viewBox="0 0 24 24" aria-hidden="true"><title>Deezer</title><path fill="currentColor" d="M12 20.2 3.8 12C-1.2 7 6 0 11 5.1l1 1.1 1-1.1C18 0 25.2 7 20.2 12ZM6 7.5v3h1.4v-3zm2.8-1v5h1.4v-5zm2.5 1.8v5h1.4v-5zm2.5-1.8v5h1.4v-5zm2.8 1v3H18v-3z" fill-rule="evenodd"/></svg>
  </span>`;

  function advanceOnPaste(field, advance){
    field.addEventListener('paste',event=>{
      const value=event.clipboardData?.getData('text/plain').trim();
      if(!value)return;
      event.preventDefault();
      field.value=value;
      advance();
    });
  }

  if(typeof module==='object')module.exports={parse,importHint,platformLogos,advanceOnPaste};
  else window.SongToSheetAudioSource={parse,importHint,platformLogos,advanceOnPaste};
})();

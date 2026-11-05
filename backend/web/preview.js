/* SongToSheet public UX preview — this is deliberately NOT a production API.
   No sign-up, uploads, transcription or payments happen on this static site. */
(()=>{
  'use strict';
  const originalFetch=window.fetch.bind(window);
  const demoUser={id:'preview-account',email:'demo@songtosheet.ai',credits:0};
  const timestamp=Math.floor(Date.now()/1000)-3600;
  const notes=[69,72,76,74].map((pitch,i)=>({pitch,start:i*.5,end:i*.5+.45}));
  const demoJob={id:'preview-melody',title:'Mélodie de démonstration',instrument:'piano',duration:2.6,reserved_credits:0,status:'completed',note_count:4,bpm:120,created_at:timestamp,error_message:null,notes};
  const packs=[{id:'starter',name:'Découverte',credits:10,cents:900,euros:9,badge:'Pour commencer'},
               {id:'standard',name:'Musicien',credits:30,cents:1900,euros:19,badge:'Le plus populaire'},
               {id:'studio',name:'Studio',credits:80,cents:3900,euros:39,badge:'Meilleur prix / crédit'}];
  function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});}
  function validLink(value){
    try{
      const url=new URL(value);
      if(url.protocol!=='https:' || url.username || url.password)return null;
      const host=url.hostname.toLowerCase();
      const allowYoutube=['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'];
      const allowSpotify=['spotify.com','open.spotify.com'];
      const allowCloud=['soundcloud.com','www.soundcloud.com'];
      if(!url.pathname||url.pathname==='/')return null;
      if(allowYoutube.includes(host))return 'YouTube';
      if(allowSpotify.includes(host))return 'Spotify';
      if(allowCloud.includes(host))return 'SoundCloud';
    }catch{}
    return null;
  }
  window.fetch=async function previewFetch(resource,options={}){
    const input=typeof resource==='string'?resource:resource?.url;
    if(!input||!input.startsWith('/api/'))return originalFetch(resource,options);
    const url=new URL(input,location.origin); const path=url.pathname;
    if(path==='/api/auth/me')return reply({user:demoUser});
    if(path==='/api/packs')return reply({packs,checkout_enabled:false});
    if(path==='/api/jobs'){
      if(options.method==='POST')return reply({detail:'Aperçu en ligne : la génération audio réelle n’est pas déployée. Ouvre la partition de démonstration dans la bibliothèque.'},503);
      return reply({jobs:[demoJob]});
    }
    if(path==='/api/jobs/preview-melody')return reply(demoJob);
    if(path==='/api/auth/signup'||path==='/api/auth/login')return reply({detail:'Aucun compte réel n’est créé dans cette démo. Utilise « Ouvrir le studio ».'},503);
    if(path==='/api/auth/logout')return reply({ok:true});
    if(path==='/api/checkout')return reply({detail:'Paiement désactivé : démonstration publique uniquement.'},503);
    if(path==='/api/links/inspect'){
      const value=JSON.parse(options.body||'{}').url||'';
      const provider=validLink(value);
      if(!provider)return reply({detail:'Entre un lien HTTPS YouTube, Spotify ou SoundCloud valide.'},400);
      return reply({provider,source_url:value,requires_audio:true,message:`Lien ${provider} reconnu ! En V1, il faut fournir un fichier audio autorisé pour la transcription. Cette page est un aperçu non connecté à un moteur.`});
    }
    return reply({detail:'Cette fonction n’est pas activée dans cet aperçu.'},503);
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const notice=document.createElement('div');notice.className='preview-banner';
    notice.innerHTML='<span><strong>APERÇU V1</strong> · Navigation et exemple interactif · Aucune inscription, génération ou transaction réelle</span> <a href="/app">Ouvrir le studio de démo →</a>';
    document.body.prepend(notice);
    const authForm=document.getElementById('auth-form');if(authForm)authForm.hidden=true;
    const alt=document.getElementById('auth-alternate');if(alt)alt.hidden=true;
    const card=document.querySelector('.auth-card');
    if(card){const a=document.createElement('a');a.href='/app';a.className='btn btn-primary';a.textContent='Ouvrir le studio de démonstration ↗';a.style.marginTop='16px';card.appendChild(a);}
  });
})();
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = {user:null,jobs:[],packages:[],link:'',file:null,heroMode:'link',activePage:'dashboard',resultId:null,pendingPack:null,poll:null,checkoutEnabled:false,authMode:'signup'};
  const safe = (s) => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const timeFmt = (secs) => `${Math.floor(secs/60)}:${String(Math.floor(secs%60)).padStart(2,'0')}`;
  const dateFmt = (epoch) => new Date(epoch*1000).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});
  const instrumentIcon = {piano:'🎹',guitare:'🎸',violon:'🎻',voix:'🎤',basse:'🎸'};
  let toastTimer;
  function toast(message,error=false){const el=$('toast');el.textContent=message;el.className=`toast show${error?' error':''}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='toast',5400);}
  async function api(endpoint,options={}){
    const res = await fetch(endpoint,{credentials:'same-origin',...options});
    const contentType=res.headers.get('content-type')||'';
    const data=contentType.includes('application/json')?await res.json():{};
    if(!res.ok){const detail=data.detail||'Une erreur est survenue';const e=new Error(typeof detail==='string'?detail:detail.message||'Une erreur est survenue');e.status=res.status;e.data=detail;throw e;}
    return data;
  }
  const post=(path,object)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(object)});
  function go(path,replace=false){if(replace)history.replaceState({},'',path);else history.pushState({},'',path);renderRoute();if(!path.includes('#'))window.scrollTo({top:0,behavior:'instant'});}
  function show(id,yes){$(id).classList.toggle('hidden',!yes);}
  function menuClose(){$('mobile-menu').classList.remove('open');$('mobile-menu-btn').setAttribute('aria-expanded','false');}
  function renderRoute(){
    clearInterval(state.poll);state.poll=null;menuClose();
    const pathname=location.pathname;
    const landing=pathname==='/' || pathname==='';
    const app=pathname==='/app';
    if(!app)stopPlayer();
    const authPage=pathname==='/connexion'||pathname==='/inscription';
    show('public-header',landing);show('landing',landing);show('public-footer',landing);
    show('workspace',app);show('auth-view',authPage);show('legal-view',pathname==='/legal');
    if(app){if(!state.user){go('/inscription',true);return;}showAppPage(state.activePage);}
    if(authPage){state.authMode=pathname==='/connexion'?'login':'signup';renderAuth();}
    document.title=landing?'SongToSheet.ai — De ta musique à ta partition.':app?'Mon studio — SongToSheet':authPage?'Mon compte — SongToSheet':'Informations — SongToSheet';
  }
  function renderAuth(){const login=state.authMode==='login';
    $('auth-title').textContent=login?'Content de te revoir !':'Bienvenue sur SongToSheet';
    $('auth-subtitle').textContent=login?'Retrouve ton studio de transcription.':'Crée ton compte pour retrouver toutes tes partitions.';
    $('auth-submit').innerHTML=login?'Se connecter <span>↗</span>':'Créer mon compte <span>↗</span>';
    $('auth-alternate').innerHTML=login?'Pas encore de compte ? <a href="/inscription" data-nav="signup">Créer un compte</a>':'Déjà un compte ? <a href="/connexion" data-nav="login">Se connecter</a>';
    $('auth-password').setAttribute('autocomplete',login?'current-password':'new-password');
    show('auth-error',false);
  }
  async function loadUser(){try{const data=await api('/api/auth/me');state.user=data.user;}catch{state.user=null;}}
  async function loadPackages(){try{const data=await api('/api/packs');state.packages=data.packs;state.checkoutEnabled=data.checkout_enabled;state.trackTest=data.track_test===true;}catch{state.packages=[];state.checkoutEnabled=false;}}
  async function refresh(){if(!state.user)return;
    try{const [user,jobs]=await Promise.all([api('/api/auth/me'),api('/api/jobs')]);state.user=user.user;state.jobs=jobs.jobs||[];
      if(!state.user){go('/inscription');return;}
      $('sidebar-credits').textContent=state.user.credits;$('top-credits').textContent=state.user.credits;$('metric-credits').textContent=state.user.credits;
      $('create-balance').textContent=state.user.credits;$('billing-balance').textContent=state.user.credits;
      $('metric-total').textContent=state.jobs.filter(j=>j.status==='completed').length;
      $('metric-progress').textContent=state.jobs.filter(j=>['processing','queued'].includes(j.status)).length;
      $('user-avatar').textContent=state.user.email.charAt(0).toUpperCase();
      renderJobs('recent-jobs',state.jobs.slice(0,5));renderJobs('library-jobs',filterJobs());
      $('library-count').textContent=`${state.jobs.length} partition${state.jobs.length===1?'':'s'}`;
    }catch(e){toast(e.message,true);}
  }
  function filterJobs(){const query=($('library-search').value||'').toLowerCase().trim();return state.jobs.filter(j=>j.title.toLowerCase().includes(query)||j.instrument.toLowerCase().includes(query));}
  const statusText={completed:'Terminée',failed:'Échec',processing:'En cours',queued:'En attente'};
  function renderJobs(id,jobs){const box=$(id);
    if(!jobs.length){box.innerHTML=`<div class="empty-jobs"><span>♬</span><strong>Pas encore de partition ici</strong><p>Ton prochain morceau n'attend que toi.</p><button class="btn btn-outline" data-start>Créer une partition ↗</button></div>`;return;}
    box.innerHTML=jobs.map(j=>`<button class="job-row" data-job="${safe(j.id)}"><span class="job-row-icon">${instrumentIcon[j.instrument]||'♫'}</span><span class="job-row-info"><b>${safe(j.title)}</b><small>${safe(j.instrument)} · ${timeFmt(j.duration)} · ${dateFmt(j.created_at)}</small></span><span class="job-status ${safe(j.status)}">${statusText[j.status]||'Inconnu'}</span><span class="job-chevron">›</span></button>`).join('');
  }
  let trackWizard;
  let closePlayer;
  function stopPlayer(){closePlayer?.();closePlayer=undefined;}
  function showAppPage(page){if(!state.user)return go('/inscription');
    if(page!=='result')stopPlayer();
    state.activePage=page;
    for(const p of ['dashboard','create','library','result','billing'])show(p+'-page',page===p);
    const side=page==='dashboard'?'menu-dashboard':page==='library'||page==='result'?'menu-library':'menu-create';
    for(const id of ['menu-dashboard','menu-create','menu-library'])$(id).classList.toggle('side-active',id===side);
    const names={dashboard:'Vue d’ensemble',create:'Nouvelle partition',library:'Ma bibliothèque',result:'Ma partition',billing:'Crédits'};
    $('page-crumb').textContent=names[page]||'Mon espace';
    document.querySelector('.sidebar').classList.remove('mobile-open');
    if(page==='create'){
      if(state.link)$('workspace-url').value=state.link;
      if(state.file)$('workspace-file-name').textContent=state.file.name;
      if(state.trackTest){
        $('create-page').classList.add('track-guided');
        if(!trackWizard){
          trackWizard=window.SongToSheetTrackWizard.mount($('track-onboarding'),{
            sampleUrl:'/api/transcription-test/sample',onSubmit:submitTrack
          });
          if(state.file)trackWizard.prefill({file:state.file});
        }
      }
    }
    if(page==='billing')renderAppPricing();
    if(page==='result'&&state.resultId)loadResult(state.resultId);
    document.querySelector('.app-scroll').scrollTo({top:0,behavior:'smooth'});
  }
  function startApp(page='create'){
    if(!state.user){state.activePage=page;go('/inscription');return;}
    if(location.pathname!=='/app'){state.activePage=page;go('/app');}
    else showAppPage(page);
  }
  function renderAppPricing(){
    const pricing=document.querySelector('.pricing-grid');
    $('app-pricing').innerHTML=pricing.innerHTML;
  }
  async function buy(pack){
    state.pendingPack=pack;
    if(!state.user){state.activePage='billing';go('/inscription');return;}
    if(!state.checkoutEnabled){startApp('billing');toast('Les paiements ne sont pas encore configurés. Aucun débit ne sera effectué.',true);return;}
    try{const data=await post('/api/checkout',{pack_id:pack});const url=new URL(data.url);if(url.hostname.endsWith('.stripe.com')&&url.protocol==='https:')location.assign(data.url);else throw new Error('URL de paiement invalide');}catch(e){toast(e.message,true);}
  }
  async function inspectLink(value){const info=await post('/api/links/inspect',{url:value});state.link=info.source_url;toast(info.message);return info;}
  function switchHero(mode){state.heroMode=mode;const link=mode==='link';show('link-panel',link);show('upload-panel',!link);$('tab-link').classList.toggle('active',link);$('tab-upload').classList.toggle('active',!link);$('tab-link').setAttribute('aria-selected',link);$('tab-upload').setAttribute('aria-selected',!link);}
  async function heroGenerate(){
    const instrument=$('hero-instrument').value;$('workspace-instrument').value=instrument;
    if(state.heroMode==='link'){
      const value=$('hero-link').value.trim();if(!value){toast('Colle un lien ou choisis « Importer un audio ».',true);return;}
      try{await inspectLink(value);startApp('create');}catch(e){toast(e.message,true);}
    }else{
      const file=$('hero-file').files[0];if(!file){toast('Ajoute un fichier audio pour commencer.',true);return;}
      state.file=file;$('workspace-file-name').textContent=file.name;startApp('create');
      if(state.trackTest&&trackWizard)trackWizard.prefill({file});
    }
  }
  async function submitJob(){
    const file=state.file||$('workspace-file').files[0];if(!file){toast('Ajoute un fichier audio avant de lancer la génération.',true);return;}
    const title=$('workspace-title').value.trim()||'Ma partition',instrument=$('workspace-instrument').value,url=$('workspace-url').value.trim();
    const btn=$('workspace-generate');btn.disabled=true;btn.textContent='Analyse du fichier…';
    $('upload-feedback').textContent='Vérification de ton audio et de tes crédits…';show('upload-feedback',true);
    const form=new FormData();form.append('audio',file);form.append('title',title);form.append('instrument',instrument);form.append('source_url',url);
    try{const result=await api('/api/jobs',{method:'POST',body:form});
      state.file=null;$('workspace-file').value='';$('workspace-file-name').textContent='Glisse un fichier ici, ou clique pour choisir';
      toast(`${result.credits_reserved} crédit(s) réservé(s). Génération en cours !`);
      await refresh();openResult(result.id);
    }catch(e){
      if(e.status===402){toast(e.message+' Ajoute des crédits.',true);showAppPage('billing');}
      else{toast(e.message,true);$('upload-feedback').textContent=e.message;}
    }finally{btn.disabled=false;btn.innerHTML='Générer la partition <span>↗</span>';}
  }
  async function submitTrack({file,title,instrument,format,source},setStatus){
    setStatus('Envoi de ton audio…');
    const form=new FormData();
    form.append('audio',file);
    form.append('title',title);
    form.append('instrument',instrument);
    form.append('format',format);
    form.append('source_content',source);
    form.append('authorized','true');
    const job=await api('/api/jobs',{method:'POST',body:form});
    state.file=null;
    await refresh();
    openResult(job.id);
  }
  function openResult(id){stopPlayer();state.resultId=id;startApp('result');}
  function notesSvg(notes){
    const notesToDraw=notes.slice(0,48),perLine=12,lineCount=Math.max(1,Math.ceil(notesToDraw.length/perLine)),height=150*lineCount+12;
    let svg=`<svg viewBox="0 0 720 ${height}" role="img" aria-label="Aperçu des premières notes transcrites" xmlns="http://www.w3.org/2000/svg">`;
    for(let line=0;line<lineCount;line++){
      const originY=line*150+48;
      for(let k=0;k<5;k++)svg+=`<path d="M25 ${originY+k*12} H690" stroke="#a7a0b4" stroke-width="1.1"/>`;
      svg+=`<text x="26" y="${originY+49}" font-size="53" font-family="Georgia,serif" fill="#342849">𝄞</text>`;
      const chunk=notesToDraw.slice(line*perLine,(line+1)*perLine);
      for(let i=0;i<chunk.length;i++){
        const note=chunk[i],pitch=note.pitch;
        const naturalSteps=[0,0,1,1,2,3,3,4,4,5,5,6],step=naturalSteps[pitch%12],octave=Math.floor(pitch/12)-1;
        const diatonic=(octave-4)*7+step-2;
        const y=originY+48-diatonic*6;
        const x=98+i*47;
        svg+=`<ellipse cx="${x}" cy="${y}" rx="8" ry="5.6" transform="rotate(-19 ${x} ${y})" fill="#453264"/><path d="M${x+7} ${y} V${y-39}" stroke="#453264" stroke-width="2"/>`;
        if(y>originY+48){for(let l=originY+60;l<=y+2;l+=12)svg+=`<path d="M${x-12} ${l}h24" stroke="#453264"/>`;}
        if(y<originY){for(let l=originY-12;l>=y-2;l-=12)svg+=`<path d="M${x-12} ${l}h24" stroke="#453264"/>`;}
      }
    }
    svg+='</svg>';return svg;
  }
  async function loadResult(id){
    try{const j=await api(`/api/jobs/${encodeURIComponent(id)}`);if(state.activePage!=='result'||state.resultId!==id)return;
      const completed=j.status==='completed',processing=['queued','processing'].includes(j.status);
      const trackTest=j.track_test===true;
      const details=`${instrumentIcon[j.instrument]||'♫'} ${safe(j.instrument)} · ${timeFmt(j.duration)} · ${dateFmt(j.created_at)} · ${trackTest?'Test local':j.reserved_credits+' crédit(s)'}`;
      const formats=j.downloads||['pdf','mid','musicxml'];
      const labels={pdf:'Télécharger le PDF',mid:'MIDI',musicxml:trackTest?'Partition MusicXML':'MusicXML',tab:'Tablature MusicXML'};
      const links=['pdf','musicxml','tab','mid'].filter(format=>formats.includes(format)).map((format,i)=>
        `<a class="btn ${i===0?'btn-primary':'btn-outline'}" href="/api/jobs/${encodeURIComponent(id)}/download/${format}">↓ ${labels[format]}</a>`).join('');
      const progress=trackTest?'Le moteur traite ton audio. Cette page se met à jour automatiquement.':'Le fichier est analysé en arrière-plan. Les crédits ne seront consommés que si tout se passe bien. Cette page se met à jour automatiquement.';
      const resultNote=`${j.note_count} notes estimées · Tempo indicatif ${j.bpm} BPM. Le relevé est expérimental. Tu peux le vérifier et le corriger dans un éditeur MusicXML.`;
      const body=completed
        ? `<h3>${trackTest?'Notes détectées':'Aperçu de la mélodie'}</h3>${trackTest?'':notesSvg(j.notes||[])}<p class="result-note">${resultNote}</p>`
        : processing
          ? `<h3>✦ On décode ta musique…</h3><p class="result-note">${progress}</p>`
          : `<h3>Le relevé n'a pas abouti</h3><p class="result-note">${safe(j.error_message||'Une erreur de génération est survenue.')}<br/>Aucun crédit débité pour ce traitement.</p><button class="btn btn-outline" data-start>Réessayer avec un autre audio ↗</button>`;
      $('result-content').innerHTML=`
        <div class="result-hero"><span class="dashboard-kicker">${completed?'TA PARTITION EST PRÊTE ✦':processing?'GÉNÉRATION EN COURS':'TRANSCRIPTION IMPOSSIBLE'}</span>
        <h1>${safe(j.title)}</h1><p class="result-meta">${details}</p>${completed?`<div class="result-actions">${links}</div>`:''}</div>
        ${completed&&trackTest&&formats.includes('mid')?'<section id="score-player" class="score-player" aria-label="Lecteur de la transcription"></section>':''}
        <div class="note-notation">${body}</div>`;
      stopPlayer();
      if($('score-player')&&window.SongToSheetPlayer){
        const exportUrl=kind=>`/api/jobs/${encodeURIComponent(id)}/download/${kind}`;
        closePlayer=window.SongToSheetPlayer.mount($('score-player'),{
          scoreUrl:exportUrl('musicxml'),midiUrl:exportUrl('mid'),instrument:j.instrument,sourceDuration:j.duration,
          tabUrl:formats.includes('tab')?exportUrl('tab'):null
        });
      }
      if(processing){clearInterval(state.poll);state.poll=setInterval(async()=>{if(state.activePage==='result'&&state.resultId===id){await loadResult(id);}else clearInterval(state.poll);},4500);}
      else{clearInterval(state.poll);state.poll=null;await refresh();}
    }catch(e){toast(e.message,true);}
  }
  async function submitAuth(e){e.preventDefault();
    const email=$('auth-email').value.trim(),password=$('auth-password').value;
    const btn=$('auth-submit');btn.disabled=true;btn.textContent='Un instant…';show('auth-error',false);
    try{const result=await post(`/api/auth/${state.authMode==='login'?'login':'signup'}`,{email,password});
      state.user=result.user;$('auth-password').value='';await refresh();
      if(state.pendingPack){const pack=state.pendingPack;state.pendingPack=null;startApp('billing');await buy(pack);}
      else startApp(state.activePage||'dashboard');
    }catch(err){$('auth-error').textContent=err.message;show('auth-error',true);}
    finally{btn.disabled=false;renderAuth();}
  }
  async function logout(){try{await post('/api/auth/logout',{});}catch{}state.user=null;state.jobs=[];state.activePage='dashboard';state.file=null;state.link='';go('/');toast('Tu es déconnecté.');}
  function wire(){
    document.addEventListener('click',async(e)=>{
      const nav=e.target.closest('[data-nav]');if(nav){e.preventDefault();go(nav.getAttribute('href')|| (nav.dataset.nav==='home'?'/':'/connexion'));return;}
      if(e.target.closest('[data-start]')){startApp('create');return;}
      const job=e.target.closest('[data-job]');if(job){openResult(job.dataset.job);return;}
      const pack=e.target.closest('[data-pack]');if(pack){buy(pack.dataset.pack);return;}
    });
    window.addEventListener('popstate',renderRoute);
    $('nav-login').onclick=()=>go('/connexion');$('nav-cta').onclick=()=>startApp('create');$('mobile-login').onclick=()=>go('/connexion');$('mobile-start').onclick=()=>startApp('create');$('footer-start').onclick=()=>startApp('create');$('showcase-cta').onclick=()=>startApp('create');
    $('mobile-menu-btn').onclick=()=>{const open=$('mobile-menu').classList.toggle('open');$('mobile-menu-btn').setAttribute('aria-expanded',String(open));};
    document.querySelectorAll('.mobile-menu a').forEach(a=>a.addEventListener('click',menuClose));
    $('tab-link').onclick=()=>switchHero('link');$('tab-upload').onclick=()=>switchHero('upload');$('hero-generate').onclick=heroGenerate;
    $('hero-file').onchange=e=>{const file=e.target.files[0];if(file){state.file=file;$('hero-file-label').textContent=file.name;}};
    $('workspace-file').onchange=e=>{const file=e.target.files[0];if(file){state.file=file;$('workspace-file-name').textContent=file.name;}};
    for(const [dropId,fileId] of [['hero-drop','hero-file'],['workspace-drop','workspace-file']]){
      const drop=$(dropId);drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
      drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
      drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');const file=e.dataTransfer.files[0];if(!file)return;state.file=file;
        if(fileId==='hero-file')$('hero-file-label').textContent=file.name;else $('workspace-file-name').textContent=file.name;
      });
    }
    $('sidebar-logout').onclick=logout;$('mobile-sidebar').onclick=()=>document.querySelector('.sidebar').classList.toggle('mobile-open');
    $('menu-dashboard').onclick=()=>showAppPage('dashboard');$('menu-create').onclick=()=>showAppPage('create');$('menu-library').onclick=()=>showAppPage('library');
    $('side-buy').onclick=()=>showAppPage('billing');$('create-buy').onclick=()=>showAppPage('billing');$('dashboard-start').onclick=()=>showAppPage('create');$('view-all').onclick=()=>showAppPage('library');$('library-new').onclick=()=>showAppPage('create');
    $('back-to-library').onclick=()=>showAppPage('library');$('workspace-generate').onclick=submitJob;
    $('library-search').oninput=()=>renderJobs('library-jobs',filterJobs());$('auth-form').onsubmit=submitAuth;
    $('learn-more').onclick=(e)=>{e.preventDefault();go('/#comment-ca-marche');document.querySelector('#comment-ca-marche')?.scrollIntoView({behavior:'smooth'});};
    $('footer-year').textContent=new Date().getFullYear();
  }
  async function init(){wire();await Promise.all([loadUser(),loadPackages()]);renderRoute();if(state.user){await refresh();if(location.search.includes('checkout=success')){
      toast('Paiement confirmé : les crédits apparaîtront dès que Stripe aura envoyé sa confirmation.');history.replaceState({},'',location.pathname);showAppPage('billing');
      let count=0;const timer=setInterval(async()=>{await refresh();if(++count>=8)clearInterval(timer);},2000);
    }}else if(location.pathname==='/app'){go('/inscription',true);}}
  init();
})();

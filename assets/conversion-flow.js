/* SongToSheet — parcours de génération simulée.
   Aucun son distant n'est analysé ; aucun compte ni achat réel n'est créé ici. */
(function(){
  'use strict';
  var KEY='sts_simulated_partition_v1';
  var ACCOUNT_KEY='sts_demo_email';
  var pendingInMemory=null;
  var timer=null;
  var starting=false;
  var sourceCache=null;
  var sourceRequestSerial=0;
  var inputDelay=null;
  var youtubeApiPromise=null;
  var $=function(id){return document.getElementById(id);};
  var instrumentNames={piano:'Piano',guitare:'Guitare',violon:'Violon',voix:'Voix',basse:'Basse'};
  var formatNames={partition:'Partition',tablature:'Tablature'};
  function chosenFormat(request){return request&&request.format==='tablature'?'tablature':'partition';}
  function formatLabel(request){return formatNames[chosenFormat(request)];}
  function formatLongName(request){return chosenFormat(request)==='tablature'?'tablature':'partition';}
  var audioFormats=/\.(mp3|wav|m4a|flac|ogg|aac)$/i;

  function readRequest(){
    try{
      var stored=JSON.parse(sessionStorage.getItem(KEY)||'null');
      if(stored&&typeof stored==='object'&&typeof stored.name==='string')return stored;
    }catch(e){}
    return pendingInMemory;
  }
  function saveRequest(data){
    pendingInMemory=data;
    try{sessionStorage.setItem(KEY,JSON.stringify(data));}catch(e){}
  }
  function clearPending(){
    pendingInMemory=null;
    stopProgress();
    try{sessionStorage.removeItem(KEY);}catch(e){}
  }
  function providerFor(value){
    try{
      var url=new URL(value);
      if(url.protocol!=='https:'||url.username||url.password)return null;
      var host=url.hostname.toLowerCase();
      if(!url.pathname||url.pathname==='/')return null;
      if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'].includes(host)){
        if(host!=='youtu.be'&&url.pathname==='/watch'&&!url.searchParams.get('v'))return null;
        return 'YouTube';
      }
      if(['spotify.com','open.spotify.com','spotify.link'].includes(host))return 'Spotify';
      if(['deezer.com','www.deezer.com'].includes(host))return 'Deezer';
      if(['soundcloud.com','www.soundcloud.com','on.soundcloud.com'].includes(host))return 'SoundCloud';
      if(['music.apple.com'].includes(host))return 'Apple Music';
    }catch(e){}
    return null;
  }

  function durationText(seconds){
    if(!Number.isFinite(seconds)||seconds<=0)return 'Durée non vérifiée';
    return Math.floor(seconds/60)+':'+String(Math.round(seconds%60)).padStart(2,'0');
  }
  function sourceError(message){
    var el=$('hero-source-error');
    if(!el)return;
    el.textContent=message||'';
    el.classList.toggle('hidden',!message);
    if(message)$('hero-source-meta')?.classList.add('hidden');
  }
  function showHeroMetadata(){
    // Pas de message de succès sous le champ : seule une erreur est affichée,
    // et seulement après la tentative de génération.
    var el=$('hero-source-meta');
    if(el){el.textContent='';el.classList.add('hidden');}
  }

  function youtubeVideoId(value){
    try{
      var url=new URL(value);
      var host=url.hostname.toLowerCase();
      var parts=url.pathname.split('/').filter(Boolean);
      var id=host==='youtu.be'?parts[0]:
        url.pathname==='/watch'?url.searchParams.get('v'):
        ['shorts','live','embed'].includes(parts[0])?parts[1]:null;
      return /^[a-zA-Z0-9_-]{11}$/.test(id||'')?id:null;
    }catch(e){return null;}
  }

  function loadYoutubeIframeApi(){
    if(window.YT&&window.YT.Player)return Promise.resolve(window.YT);
    if(youtubeApiPromise)return youtubeApiPromise;
    youtubeApiPromise=new Promise(function(resolve,reject){
      var previous=window.onYouTubeIframeAPIReady;
      var finished=false;
      var script=document.createElement('script');
      var watchdog=setTimeout(function(){done(new Error('Impossible de vérifier la durée de cette vidéo.'));},6000);
      function done(error){
        if(finished)return;
        finished=true;clearTimeout(watchdog);
        if(window.onYouTubeIframeAPIReady===ready)window.onYouTubeIframeAPIReady=previous;
        if(error){script.remove();reject(error);}else resolve(window.YT);
      }
      function ready(){
        if(typeof previous==='function')try{previous();}catch(e){}
        if(window.YT&&window.YT.Player)done(null);
        else done(new Error('Impossible de vérifier la durée de cette vidéo.'));
      }
      window.onYouTubeIframeAPIReady=ready;
      script.async=true;
      script.src='https://www.youtube.com/iframe_api';
      script.onerror=function(){done(new Error('Impossible de vérifier la durée de cette vidéo.'));};
      document.head.appendChild(script);
    }).catch(function(error){youtubeApiPromise=null;throw error;});
    return youtubeApiPromise;
  }

  // Secours sans clé API : le lecteur YouTube de la vidéo demandée renvoie
  // sa durée réelle après chargement des métadonnées (ou lecture silencieuse).
  // Le lecteur reste visible et interactif durant la vérification.
  async function youtubeDurationFromPlayer(value){
    var videoId=youtubeVideoId(value);
    var holder=$('hero-youtube-check'),slot=$('hero-youtube-player');
    if(!videoId||!holder||!slot)throw new Error('Impossible de vérifier la durée de cette vidéo.');
    holder.classList.remove('hidden');
    try{
      var YT=await loadYoutubeIframeApi();
      return await new Promise(function(resolve,reject){
        var player=null,interval=null,watchdog=null,finished=false;
        function finish(error,seconds){
          if(finished)return;
          finished=true;
          clearInterval(interval);clearTimeout(watchdog);
          if(player)try{player.stopVideo();player.destroy();}catch(e){}
          slot.textContent='';
          if(error)reject(error);else resolve(seconds);
        }
        function inspect(){
          if(!player||finished)return;
          try{
            var seconds=Number(player.getDuration());
            if(!Number.isFinite(seconds)||seconds<=0)return;
            var loaded=String(player.getVideoUrl?.()||'');
            if(loaded&&youtubeVideoId(loaded)!==videoId){
              finish(new Error('Impossible de vérifier la durée de cette vidéo.'));return;
            }
            finish(null,seconds);
          }catch(e){}
        }
        watchdog=setTimeout(function(){finish(new Error('Impossible de vérifier la durée de cette vidéo.'));},7500);
        try{
          player=new YT.Player(slot,{
            width:320,height:200,videoId:videoId,
            playerVars:{autoplay:0,controls:1,playsinline:1,rel:0,origin:location.origin},
            events:{
              onReady:function(event){
                try{event.target.mute();event.target.playVideo();}catch(e){}
                inspect();
              },
              onStateChange:inspect,
              onError:function(){finish(new Error('Impossible de vérifier la durée de cette vidéo.'));}
            }
          });
          interval=setInterval(inspect,350);
        }catch(e){finish(new Error('Impossible de vérifier la durée de cette vidéo.'));}
      });
    }finally{
      holder.classList.add('hidden');
      // YT.Player remplace le nœud cible par un iframe ; son destroy()
      // ne restaure pas forcément ce nœud. Le recréer pour le prochain essai.
      var current=$('hero-youtube-player');
      if(current)current.remove();
      var next=document.createElement('div');
      next.id='hero-youtube-player';
      holder.insertBefore(next,holder.firstChild);
    }
  }

  async function inspectLink(raw){
    var value=String(raw||'').trim();
    var provider=providerFor(value);
    if(!provider)throw new Error('Lien non reconnu. Utilise un lien direct HTTPS YouTube, Spotify, Deezer, Apple Music ou SoundCloud.');
    if(sourceCache&&sourceCache.url===value)return sourceCache.data;
    if(provider==='YouTube'&&!youtubeVideoId(value))throw new Error('Colle un lien vers une vidéo YouTube valide.');
    var response;
    try{response=await fetch('/api/media-info?url='+encodeURIComponent(value),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8500)});}
    catch(e){
      // La récupération des métadonnées est parfois bloquée par YouTube.
      // Ce n'est pas une preuve que la vidéo dépasse les 6 minutes.
      if(provider!=='YouTube')throw new Error('Impossible de récupérer les informations de ce morceau.');
    }
    var data={};
    if(response)try{data=await response.json();}catch(e){}
    if(response&&response.status===422)throw new Error('La durée maximale autorisée est de 6 min.');
    if(response&&response.status===400)throw new Error(data.error||'Ce lien ne pointe pas vers un morceau accepté.');
    var duration=response&&data.duration_verified===true&&Number.isFinite(data.duration_seconds)&&data.duration_seconds>0?data.duration_seconds:null;
    if(provider==='YouTube'&&duration===null){
      // Deuxième tentative côté navigateur. Si l'embed est bloqué, on
      // autorise la démo en gardant durationVerified=false.
      try{duration=await youtubeDurationFromPlayer(value);}
      catch(e){duration=null;}
    }else if(!response||!response.ok){
      throw new Error('Impossible de récupérer les informations de ce morceau.');
    }
    // Seule une durée réellement connue peut déclencher l'erreur 6 min.
    if(duration!==null&&duration>360)throw new Error('La durée maximale autorisée est de 6 min.');
    var result={
      provider:provider,name:typeof data.title==='string'&&data.title.trim()?data.title.trim().slice(0,110):'Morceau '+provider,
      artist:typeof data.artist==='string'?data.artist.slice(0,80):null,
      thumbnail:typeof data.thumbnail_url==='string'?data.thumbnail_url:null,
      duration:duration,durationVerified:duration!==null,metadataUnavailable:!data.title
    };
    sourceCache={url:value,data:result};
    return result;
  }
  async function verifyHeroLink(){
    var input=$('hero-link');if(!input)return;
    var value=input.value.trim();
    var serial=++sourceRequestSerial;
    if(!value){showHeroMetadata(null);sourceError('');return;}
    if(!providerFor(value)){showHeroMetadata(null);sourceError('');return;}
    var meta=$('hero-source-meta');
    if(meta){meta.textContent='Vérification du morceau…';meta.classList.remove('hidden');}
    sourceError('');
    try{
      var details=await inspectLink(value);
      if(serial===sourceRequestSerial&&input.value.trim()===value)showHeroMetadata(details);
    }catch(e){if(serial===sourceRequestSerial&&input.value.trim()===value)sourceError(e.message);}
  }
  function onHeroLinkInput(){
    sourceRequestSerial++;clearTimeout(inputDelay);
    sourceError('');
    $('hero-source-meta')?.classList.add('hidden');
    var value=$('hero-link')?.value.trim();
    if(!value)return;
    inputDelay=setTimeout(verifyHeroLink,650);
  }
  function onHeroFile(){
    // Le contrôle du fichier reste dans validateFile(), appelé après le clic.
    sourceRequestSerial++;clearTimeout(inputDelay);
    sourceError('');showHeroMetadata(null);
  }
  function setCover(id,request){
    var image=$(id);
    if(!image)return;
    if(request&&request.thumbnail&&/^https:\/\/(?:i\.ytimg\.com|img\.youtube\.com|i\.scdn\.co|image-cdn-ak\.spotifycdn\.com|mosaic\.scdn\.co|e-cdns-images\.dzcdn\.net|is\d+-ssl\.mzstatic\.com|i1\.sndcdn\.com)\//.test(request.thumbnail)){
      image.src=request.thumbnail;image.classList.remove('hidden');
    }else{image.removeAttribute('src');image.classList.add('hidden');}
  }

  function audioDuration(file){
    return new Promise(function(resolve,reject){
      var audio=document.createElement('audio');
      var objectUrl=URL.createObjectURL(file);
      var finished=false;
      var timeout=setTimeout(function(){finish(new Error('Durée audio impossible à lire. Essaie un MP3 ou un WAV valide.'));},8000);
      function finish(error,duration){
        if(finished)return;
        finished=true;clearTimeout(timeout);
        audio.removeAttribute('src');audio.load();URL.revokeObjectURL(objectUrl);
        if(error)reject(error);else resolve(duration);
      }
      audio.preload='metadata';
      audio.addEventListener('loadedmetadata',function(){
        var duration=audio.duration;
        if(!Number.isFinite(duration)||duration<=0)finish(new Error('La durée de cet audio ne peut pas être vérifiée.'));
        else finish(null,duration);
      },{once:true});
      audio.addEventListener('error',function(){finish(new Error('Ce format audio ne peut pas être vérifié dans ton navigateur. Essaie un MP3 ou un WAV.'));},{once:true});
      audio.src=objectUrl;
      audio.load();
    });
  }
  async function validateFile(file){
    if(!file)throw new Error('Choisis un fichier audio pour continuer.');
    if(!audioFormats.test(file.name))throw new Error('Formats acceptés : MP3, WAV, M4A, FLAC, OGG ou AAC.');
    if(file.size<=0)throw new Error('Le fichier sélectionné est vide.');
    if(file.size>25*1024*1024)throw new Error('Ton fichier dépasse 25 Mo. Choisis un fichier plus léger.');
    var duration=await audioDuration(file);
    if(duration>360)throw new Error('La durée maximale autorisée est de 6 min.');
    return duration;
  }
  function navigate(path){
    history.pushState({},'',path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.scrollTo(0,0);
  }
  function stopProgress(){if(timer){clearInterval(timer);timer=null;}}
  function setStage(stage){
    var tab=chosenFormat(readRequest())==='tablature';
    var texts=['Préparation de ta musique…','Construction de la maquette…',tab?'Placement des cases…':'Mise en place des notes…','Finalisation de l’aperçu…'];
    $('flow-progress-label').textContent=texts[stage]||texts[0];
    document.querySelectorAll('#flow-step-list .flow-step').forEach(function(item,index){
      item.classList.toggle('current',index===stage);
      item.classList.toggle('finished',index<stage);
    });
  }
  function showReady(){
    stopProgress();
    $('flow-working').classList.add('hidden');
    $('flow-finished').classList.remove('hidden');
    var request=readRequest();
    if(request){
      $('flow-ready-track').textContent=request.name;
      $('flow-ready-provider').textContent=request.provider+' · '+(instrumentNames[request.instrument]||'Piano')+' · '+formatLabel(request)+(request.durationVerified?' · '+durationText(request.duration):'');
      $('flow-finished-title').innerHTML=chosenFormat(request)==='tablature'?'Ta tablature prend <em>forme.</em>':'Ta partition prend <em>forme.</em>';
      $('flow-finished-lead').textContent=window.SongToSheetCurrentUser?'Ton morceau est prêt à être enregistré dans ton espace. Tu pourras y lancer ton aperçu.':'Crée ton compte pour conserver cette création et lancer son aperçu depuis ton espace.';
      $('flow-discover').innerHTML=window.SongToSheetCurrentUser?'Enregistrer dans mon espace <span aria-hidden="true">↗</span>':'Créer mon compte pour continuer <span aria-hidden="true">↗</span>';
      updatePreviewNotation(request);
      setCover('flow-ready-cover',request);
    }
    $('flow-discover').focus({preventScroll:true});
  }
  function runProgress(){
    if(timer)return;
    var request=readRequest();if(!request)return;
    $('flow-working').classList.remove('hidden');
    $('flow-finished').classList.add('hidden');
    var start=performance.now();
    var duration=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches?2400:18000;
    function frame(){
      var fraction=Math.min(1,(performance.now()-start)/duration);
      var percent=Math.min(100,Math.round((1-Math.pow(1-fraction,1.5))*100));
      $('flow-percent').textContent=percent+' %';
      $('flow-bar').style.width=percent+'%';
      $('flow-progressbar').setAttribute('aria-valuenow',String(percent));
      setStage(fraction<.21?0:fraction<.48?1:fraction<.76?2:3);
      if(fraction>=1){
        request.completed=true;
        saveRequest(request);
        showReady();
      }
    }
    frame();
    timer=setInterval(frame,85);
  }
  function setScreen(screen){
    $('flow-select').classList.add('hidden');
    $('flow-format').classList.add('hidden');
    $('flow-working').classList.add('hidden');
    $('flow-finished').classList.add('hidden');
    $('flow-preview').classList.add('hidden');
    var request=readRequest();
    if(screen==='select'){
      if(!request)return;
      $('flow-select-track').textContent=request.name;
      $('flow-select-source').textContent=request.provider+(request.artist?' · '+request.artist:'');
      $('flow-select-duration').textContent=request.durationVerified?durationText(request.duration)+' / 6:00 max':'Durée non vérifiée · max 6:00';
      $('flow-select-duration').classList.toggle('unverified',!request.durationVerified);
      setCover('flow-select-cover',request);
      var option=document.querySelector('input[name="flow-instrument"][value="'+request.instrument+'"]');
      if(option)option.checked=true;
      $('flow-select').classList.remove('hidden');
      return;
    }
    if(screen==='format'){
      if(!request)return;
      $('flow-format-track').textContent=request.name;
      $('flow-format-source').textContent=request.provider+(request.artist?' · '+request.artist:'');
      $('flow-format-instrument').textContent=instrumentNames[request.instrument]||'Piano';
      setCover('flow-format-cover',request);
      var selected=request.format&&formatNames[request.format]?request.format:
        (request.instrument==='guitare'||request.instrument==='basse'?'tablature':'partition');
      var option=document.querySelector('input[name="flow-format-choice"][value="'+selected+'"]');
      if(option)option.checked=true;
      $('flow-format').classList.remove('hidden');
      return;
    }
    if(screen==='preview'){
      $('flow-preview-source').textContent=request?request.name:'Ta musique';
      $('flow-preview-instrument').textContent=(request?(instrumentNames[request.instrument]||'Piano'):'Piano')+' · '+formatLabel(request);
      $('flow-preview-paper-label').textContent=chosenFormat(request)==='tablature'?'Tablature originale de démonstration':'Mélodie originale de démonstration';
      $('flow-paywall-title').textContent='Tu n’as accès qu’à 30 secondes de ta '+formatLongName(request);
      $('flow-plans-label').textContent='Débloquer la '+formatLongName(request)+' complète';
      $('flow-plans-label').textContent='Débloquer la '+formatLongName(request)+' complète';
      updatePreviewNotation(request);
      $('flow-preview').classList.remove('hidden');
      return;
    }
    $('flow-work-track').textContent=request?request.name:'Ton morceau';
    $('flow-work-provider').textContent=request?request.provider+' · '+(instrumentNames[request.instrument]||'Piano')+' · '+formatLabel(request):'';
    $('flow-step-notation').textContent=chosenFormat(request)==='tablature'?'Disposition des cases':'Disposition des notes';
    if(request&&request.completed)showReady();else runProgress();
  }
  function render(path){
    var view=$('generation-view');if(!view)return;
    var flowPage=path==='/choisir-instrument'||path==='/choisir-format'||path==='/generation'||path==='/apercu';
    if(!flowPage){view.classList.add('hidden');stopProgress();return;}
    var request=readRequest();
    if(!request){navigate('/');return;}
    if(path==='/apercu'&&(!window.SongToSheetCurrentUser||request.kind!=='saved-demo'||request.previewRevealed!==true)){
      navigate(window.SongToSheetCurrentUser?'/app':'/inscription');
      return;
    }
    if(request.kind==='link'&&request.durationVerified===true&&Number.isFinite(request.duration)&&request.duration>360){
      navigate('/');
      sourceError('La durée maximale autorisée est de 6 min.');
      return;
    }
    if((path==='/generation'||path==='/apercu')&&!formatNames[request.format]){navigate('/choisir-format');return;}
    if(path==='/apercu'&&!request.completed){navigate('/generation');return;}
    view.classList.remove('hidden');
    $('flow-back').textContent=path==='/apercu'?'← Revenir à l’accueil':path==='/generation'?'← Changer de format':path==='/choisir-format'?'← Changer d’instrument':'← Modifier mon morceau';
    if(path==='/choisir-instrument'||path==='/choisir-format'||path==='/apercu')stopProgress();
    if(path==='/generation'&&!request.completed)stopProgress();
    setScreen(path==='/choisir-instrument'?'select':path==='/choisir-format'?'format':path==='/apercu'?'preview':'working');
  }
  async function prepareSource(input){
    if(starting)return null;
    starting=true;
    try{
      var source;
      if(input.kind==='link'){
        var value=String(input.value||'').trim();
        source=await inspectLink(value);
        source.kind='link';
        source.sourceUrl=value;
      }else{
        var duration=await validateFile(input.file);
        source={
          kind:'file',provider:'Fichier audio',
          name:input.file.name.replace(audioFormats,'').slice(0,95)||'Mon morceau',
          duration:duration,durationVerified:true,thumbnail:null,artist:null,metadataUnavailable:false
        };
      }
      source.instrument=instrumentNames[input.instrument]?input.instrument:'piano';
      source.format=null;
      source.completed=false;
      source.createdAt=Date.now();
      saveRequest(source);
      return source;
    }finally{starting=false;}
  }
  async function start(input){
    var result=await prepareSource(input);
    if(result)navigate('/choisir-instrument');
    return result;
  }
  function chooseInstrument(instrument){
    var request=readRequest();
    if(!request){navigate('/');return;}
    if(request.kind==='link'&&request.durationVerified===true&&Number.isFinite(request.duration)&&request.duration>360){
      navigate('/');
      sourceError('La durée maximale autorisée est de 6 min.');
      return;
    }
    var selectedInstrument=instrumentNames[instrument]?instrument:'piano';
    if(request.instrument!==selectedInstrument)request.format=null;
    request.instrument=selectedInstrument;
    request.completed=false;
    saveRequest(request);
    navigate('/choisir-format');
  }
  function chooseFormat(format){
    var request=readRequest();
    if(!request){navigate('/');return;}
    if(!formatNames[format])return;
    request.format=format;
    request.completed=false;
    saveRequest(request);
    navigate('/generation');
  }
  function pending(){return Boolean(readRequest());}
  function pendingData(){var r=readRequest();return r&&r.kind!=='saved-demo'&&r.completed===true?r:null;}
  function configureAuth(login){
    var title=$('auth-title'),sub=$('auth-subtitle'),submit=$('auth-submit');
    if(!title||!sub||!submit)return;
    var request=readRequest();
    if(request&&!login){
      title.textContent='Conserve ton morceau ✦';
      sub.textContent='Crée ton compte pour enregistrer ta création et lancer son aperçu depuis ta bibliothèque.';
      submit.innerHTML='Créer mon compte <span>↗</span>';
    }else if(!login){
      title.textContent='Entre dans ton studio musical';
      sub.textContent='Enregistre tes créations et retrouve-les dans ta bibliothèque.';
      submit.innerHTML='Accéder au studio de démo <span>↗</span>';
    }
    var password=$('auth-password');
    if(password){password.hidden=false;password.required=true;password.minLength=8;password.autocomplete=login?'current-password':'new-password';}
    var passwordLabel=document.querySelector('label[for="auth-password"]');
    if(passwordLabel)passwordLabel.hidden=false;
    var info=$('flow-auth-disclaimer');
    if(!info){
      info=document.createElement('p');info.id='flow-auth-disclaimer';info.className='flow-auth-disclaimer';
      info.textContent='Tes créations sont conservées dans ton compte. L’aperçu musical est une démonstration illustrée : aucune transcription réelle n’est encore effectuée.';
      var form=$('auth-form');if(form)form.insertAdjacentElement('afterend',info);
    }
  }
  function openPreview(){
    var request=readRequest();
    if(!request||!request.completed){navigate('/');return;}
    var currentEmail='';
    try{currentEmail=sessionStorage.getItem(ACCOUNT_KEY)||'';}catch(e){}
    if(request.savedToEmail&&request.savedToEmail!==currentEmail){navigate('/app');return;}
    if(window.SongToSheetDemoStore)window.SongToSheetDemoStore.savePendingForCurrentAccount();
    navigate('/apercu');
  }
  function openSavedDemo(job){
    if(!window.SongToSheetCurrentUser||!job||job.demo_saved!==true||job.preview_revealed!==true||typeof job.title!=='string'||!['partition','tablature'].includes(job.format))return;
    var safeInstrument=instrumentNames[job.instrument]?job.instrument:'piano';
    var request={
      kind:'saved-demo',provider:String(job.provider||'Fichier audio').slice(0,40),
      name:job.title.slice(0,110),instrument:safeInstrument,format:job.format,
      duration:Number.isFinite(job.duration)?job.duration:null,
      durationVerified:job.duration_verified===true,
      artist:null,thumbnail:null,metadataUnavailable:true,
      completed:true,previewRevealed:true,createdAt:Number.isFinite(job.created_at)?job.created_at*1000:Date.now()
    };
    saveRequest(request);
    navigate('/apercu');
  }
  function backHome(){
    if(location.pathname==='/generation'){navigate('/choisir-format');return;}
    if(location.pathname==='/choisir-format'){navigate('/choisir-instrument');return;}
    var request=readRequest();
    navigate('/');
    if(request&&request.kind==='link'){
      var input=$('hero-link');if(input)input.focus();
    }
  }
  function staffSvg(){
    var pitches=[0,1,2,4,3,2,1,0,2,4,5,4,2,1,3,2,0,2,4,3,1,0,2,1,3,5,4,2,1,0,2,4,3,2,1,0,1,3,4,5,4,2,0,1,2,4,3,1];
    var shapes=['<svg viewBox="0 0 740 480" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Extrait de partition illustratif : mélodie originale de démonstration">'];
    for(var row=0;row<4;row++){
      var top=43+row*115;
      for(var line=0;line<5;line++){
        var y=top+line*12;
        shapes.push('<path d="M34 '+y+' H710" stroke="#c7c0d4" stroke-width="1.4"/>');
      }
      shapes.push('<text x="42" y="'+(top+47)+'" font-family="serif" font-size="52" fill="#41345e">𝄞</text>');
      for(var bar=1;bar<4;bar++)shapes.push('<path d="M'+(108+bar*150)+' '+top+' v48" stroke="#b9b2c7" stroke-width="1.2"/>');
      for(var n=0;n<12;n++){
        var index=row*12+n;
        var x=129+n*47;
        var pitch=pitches[index];
        var ny=top+43-pitch*6;
        shapes.push('<ellipse cx="'+x+'" cy="'+ny+'" rx="7.5" ry="5.2" transform="rotate(-19 '+x+' '+ny+')" fill="#7751d9"/>');
        shapes.push('<path d="M'+(x+6)+' '+(ny-2)+' v-28" stroke="#7751d9" stroke-width="2"/>');
      }
    }
    shapes.push('</svg>');return shapes.join('');
  }
  function tabSvg(instrument){
    var bass=instrument==='basse';
    var strings=bass?['G','D','A','E']:['e','B','G','D','A','E'];
    var pitches=bass?[[0,2,4,2,0,2,4,5],[0,2,2,4,5,4,2,0],[0,0,2,4,2,0,2,4],[2,4,5,4,2,0,2,0]]:
      [[0,3,2,0,2,3,0,2],[1,1,3,1,0,1,3,1],[0,2,0,2,0,2,0,2],[2,0,2,3,2,0,3,2]];
    var cells=['<svg viewBox="0 0 740 480" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tablature originale illustrative de démonstration">'];
    for(var row=0;row<4;row++){
      var top=31+row*115;
      for(var line=0;line<strings.length;line++){
        var y=top+line*(bass?13:10);
        cells.push('<text x="27" y="'+(y+4)+'" font-family="monospace" font-size="14" font-weight="700" fill="#625283">'+strings[line]+'</text>');
        cells.push('<path d="M48 '+y+' H710" stroke="#b4abc8" stroke-width="1.4"/>');
      }
      var run=pitches[row];
      for(var j=0;j<run.length;j++){
        var x=91+j*78;
        var stringIndex=(j+row)%strings.length;
        var noteY=top+stringIndex*(bass?13:10);
        cells.push('<rect x="'+(x-8)+'" y="'+(noteY-10)+'" width="18" height="18" rx="3" fill="#fff"/>');
        cells.push('<text x="'+x+'" y="'+(noteY+4)+'" text-anchor="middle" font-family="monospace" font-size="15" font-weight="700" fill="#7252d5">'+run[j]+'</text>');
      }
      if(row<3)cells.push('<path d="M48 '+(top+88)+' H710" stroke="#e8e2ef" stroke-width="1"/>');
    }
    cells.push('</svg>');
    return cells.join('');
  }
  function updatePreviewNotation(request){
    var svg=chosenFormat(request)==='tablature'?tabSvg(request.instrument):staffSvg();
    var full=$('flow-score'),mini=$('flow-ready-score');
    if(full)full.innerHTML=svg;
    if(mini)mini.innerHTML=svg;
  }
  function init(){
    var anchor=$('flow-score');if(anchor)anchor.innerHTML=staffSvg();
    var miniature=$('flow-ready-score');if(miniature)miniature.innerHTML=staffSvg();
    $('flow-back').addEventListener('click',backHome);
    $('flow-change').addEventListener('click',backHome);
    $('flow-select-continue').addEventListener('click',function(){
      var chosen=document.querySelector('input[name="flow-instrument"]:checked');
      chooseInstrument(chosen?chosen.value:'piano');
    });
    $('flow-format-continue').addEventListener('click',function(){
      var chosen=document.querySelector('input[name="flow-format-choice"]:checked');
      chooseFormat(chosen?chosen.value:'partition');
    });
    // Ne vérifie pas la source à la saisie : les erreurs s'affichent
    // uniquement après un clic explicite sur « Continuer ».
    if($('hero-link'))$('hero-link').addEventListener('input',function(){sourceRequestSerial++;clearTimeout(inputDelay);sourceError('');showHeroMetadata(null);});
    if($('hero-file'))$('hero-file').addEventListener('change',function(){sourceError('');showHeroMetadata(null);});
    $('flow-discover').addEventListener('click',function(){
      if(!readRequest())return;
      if(window.SongToSheetCurrentUser&&typeof window.SongToSheetSavePending==='function'){
        window.SongToSheetSavePending();return;
      }
      navigate('/inscription');
    });
    $('flow-library').addEventListener('click',function(){
      if(typeof window.SongToSheetOpenLibrary==='function')window.SongToSheetOpenLibrary();
      else navigate('/app');
    });
    $('flow-plans').addEventListener('click',function(){navigate('/tarifs');});
    $('flow-new').addEventListener('click',backHome);
    window.addEventListener('popstate',function(){render(location.pathname);});
    render(location.pathname);
  }
  window.SongToSheetFlow={start:start,prepareSource:prepareSource,chooseInstrument:chooseInstrument,chooseFormat:chooseFormat,openSavedDemo:openSavedDemo,clearPending:clearPending,pendingData:pendingData,inspectLink:inspectLink,validateFile:validateFile,onHeroFile:onHeroFile,sourceError:sourceError,showHeroMetadata:showHeroMetadata,pending:pending,render:render,configureAuth:configureAuth,openPreview:openPreview};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
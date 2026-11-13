(() => {
  'use strict';

  const instruments=[
    ['piano','🎹','Piano'],['guitare','🎸','Guitare'],['basse','♫','Basse']
  ];
  const formats=[
    ['partition','𝄞','Partition','Lis le relevé sur une portée.'],
    ['tablature','≡','Tablature','Lis les cordes et les cases à jouer.']
  ];
  const sources=[
    ['mixed','🎙️','Il y a une voix'],
    ['instrumental','♫','Il y a juste la musique']
  ];
  const capos=[
    [0,'♪','Sans capo','Joue avec l’accordage habituel.'],
    ['auto','♯','Capo automatique','On te propose une case sur la tablature.']
  ];
  const guitarPresence=[
    ['yes','♫','Oui'],['no','—','Non'],['unknown','?','Je ne sais pas']
  ];
  const guitarGoals=[
    ['original','♪','Rejouer la guitare originale'],
    ['chords','♫','M’accompagner pour chanter'],
    ['solo','↗','Jouer la mélodie en solo']
  ];
  const steps=[
    ['import','Source','Quel morceau veux-tu jouer ?'],
    ['excerpt','Extrait','Délimite l’extrait à transcrire'],
    ['instrument','Instrument','Quel instrument veux-tu jouer ?',instruments],
    ['guitarPresence','Guitare','Le morceau contient déjà de la guitare ?',guitarPresence],
    ['guitarGoal','Objectif','Qu’est-ce que tu veux jouer ?',guitarGoals],
    ['capo','Capo','Tu joues avec un capo ?',capos],
    ['format','Format','Partition ou tablature ?',formats],
    ['source','Voix','Y a-t-il une voix dans ton morceau ?',sources],
    ['confirm','Vérifier','Tout est prêt pour le relevé']
  ];
  const fileExtension=/\.(wav|mp3|m4a|flac|ogg|aac)$/i;
  const maxFileSize=25*1024*1024;
  const formatDuration=seconds=>{
    const total=Math.round(seconds);
    return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
  };

  function mount(root,{onSubmit,onLinkChange,sampleUrl,onExcerpt,onExcerptBack,allowLink=false,freemium=false,guitarGuidance=false}){
    const idPrefix=onExcerpt?'hero-':'';
    const draft={instrument:'',format:'',source:'',file:null,capo:null,guitarPresence:null,guitarGoal:null};
    const audioSource=allowLink?window.SongToSheetAudioSource:null;
    const allowsTab=()=>['guitare','basse'].includes(draft.instrument);
    const guidedGuitar=()=>guitarGuidance&&draft.instrument==='guitare';
    const activeSteps=()=>steps.filter(([field])=>
      (field!=='import'||!prefilledSource||current==='import'||(mode==='link'&&link))&&
      (field!=='excerpt'||(mode==='link'&&link))&&
      (field!=='capo'||(allowLink&&draft.instrument==='guitare'&&!guidedGuitar()))&&
      (field!=='guitarPresence'||guidedGuitar())&&
      (field!=='guitarGoal'||guidedGuitar())&&
      (field!=='format'||(allowsTab()&&!guidedGuitar())));
    let current='import', mode=allowLink?'link':'file', prefilledSource=false, editing=false, busy=false;
    let reference=null, link=null, metadata=null, lookup=null, titleEdited=false, fileDuration=null, previewUrl;
    root.innerHTML=`
      <ol class="track-steps" aria-label="Étapes de création"></ol>
      <div class="track-step-heading">
        <h2 id="${idPrefix}track-question" tabindex="-1"></h2><p></p>
      </div>
      <form>
        <div class="track-choices" role="group" aria-labelledby="${idPrefix}track-question"></div>
        <div class="track-import hidden">
          <p class="track-reference" aria-live="polite" hidden></p>
          <div class="track-import-card">
            ${allowLink?`<div class="track-source-tabs" role="tablist" aria-label="Source du morceau">
              <button type="button" id="${idPrefix}track-link-tab" data-source-mode="link" role="tab" aria-controls="${idPrefix}track-link-pane"><span aria-hidden="true">↗</span> Lien musical</button>
              <button type="button" id="${idPrefix}track-file-tab" data-source-mode="file" role="tab" aria-controls="${idPrefix}track-file-pane"><span aria-hidden="true">⇧</span> Fichier audio</button>
            </div>
            <div class="track-link-pane" id="${idPrefix}track-link-pane" role="tabpanel" aria-labelledby="${idPrefix}track-link-tab">
              <label class="track-link-label" for="${idPrefix}track-link-input">Lien du morceau</label>
              <div class="track-link-field track-source-field">
                <input id="${idPrefix}track-link-input" class="field" type="text" inputmode="url"
                  autocomplete="off" maxlength="4096" placeholder="Colle un lien (YouTube, Spotify, Deezer)" aria-describedby="${idPrefix}track-link-hint">
                ${audioSource.platformLogos}
              </div>
              <p class="track-source-hint" id="${idPrefix}track-link-hint">Colle un lien YouTube, Spotify, Deezer ou un lien direct vers un fichier audio. Pour Spotify et Deezer, il faudra aussi ajouter le fichier audio.</p>
            </div>`:''}
            <div class="track-file-pane" id="${idPrefix}track-file-pane" ${allowLink?'role="tabpanel" aria-labelledby="'+idPrefix+'track-file-tab"':''}>
              <label class="track-source-field track-file-drop" for="${idPrefix}track-audio-input">
                <span aria-hidden="true">⇧</span>
                <span><strong class="track-filename" aria-live="polite">Déposer ou choisir un audio</strong><small>MP3, WAV, M4A, FLAC, OGG ou AAC · 25 Mo</small></span>
                <input id="${idPrefix}track-audio-input" type="file" accept=".wav,.mp3,.m4a,.flac,.ogg,.aac,audio/*" aria-label="Ton fichier audio">
              </label>
            </div>
            <button class="btn btn-primary track-import-next" type="submit">Continuer <span aria-hidden="true">→</span></button>
          </div>
          <audio class="track-audio-preview hidden" controls preload="metadata" aria-label="Écouter le fichier sélectionné"></audio>
          ${sampleUrl?'<button type="button" class="btn btn-outline track-sample">Charger la mélodie de test</button>':''}
        </div>
        <section class="track-excerpt hidden">
          <div class="track-excerpt-video" hidden></div>
          <audio preload="metadata"></audio>
          <p class="track-excerpt-hint" aria-live="polite"></p>
          <div class="track-excerpt-controls hidden">
            <div class="track-excerpt-timeline">
              <svg class="track-excerpt-wave" viewBox="0 0 448 42" preserveAspectRatio="none" aria-hidden="true"><path d="M2 16.5v9M6 14v14M10 11.5v19M14 11v20M18 13.5v15M22 12v18M26 7.5v27M30 6.5v29M34 10v22M38 13.5v15M42 8.5v25M46 7v28M50 9.5v23M54 14v14M58 12.5v17M62 11v20M66 12v18M70 15v12M74 16v10M78 14.5v13M82 13.5v15M86 14v14M90 16v10M94 14v14M98 12.5v17M102 13v16M106 15.5v11M110 15.5v11M114 14.5v13M118 14v14M122 15v12M126 16.5v9M130 14v14M134 13v16M138 13.5v15M142 16v10M146 15.5v11M150 14.5v13M154 13.5v15M158 14.5v13M162 15.5v11M166 11.5v19M170 9.5v23M174 10.5v21M178 14.5v13M182 10.5v21M186 7v28M190 7.5v27M194 11.5v19M198 12.5v17M202 8.5v25M206 8.5v25M210 11.5v19M214 16v10M218 13.5v15M222 13.5v15M226 14v14M230 15v12M234 13.5v15M238 9.5v23M242 8v26M246 10.5v21M250 13.5v15M254 8v26M258 5.5v31M262 8v26M266 13.5v15M270 11v20M274 8v26M278 9.5v23M282 13v16M286 14.5v13M290 13v16M294 13.5v15M298 15v12M302 16.5v9M306 14v14M310 12.5v17M314 12.5v17M318 14.5v13M322 14.5v13M326 12.5v17M330 12.5v17M334 14.5v13M338 16.5v9M342 15v12M346 14v14M350 14.5v13M354 16v10M358 15v12M362 13.5v15M366 14v14M370 15.5v11M374 16v10M378 14v14M382 12.5v17M386 13v16M390 15.5v11M394 12v18M398 9v24M402 9v24M406 12v18M410 12.5v17M414 8v26M418 7v28M422 10.5v21M426 15v12M430 11v20M434 10.5v21M438 12.5v17M442 15.5v11M446 15.5v11"/></svg>
              <span aria-hidden="true"></span>
              <svg class="track-excerpt-wave track-excerpt-wave-selected" viewBox="0 0 448 42" preserveAspectRatio="none" aria-hidden="true"><path d="M2 16.5v9M6 14v14M10 11.5v19M14 11v20M18 13.5v15M22 12v18M26 7.5v27M30 6.5v29M34 10v22M38 13.5v15M42 8.5v25M46 7v28M50 9.5v23M54 14v14M58 12.5v17M62 11v20M66 12v18M70 15v12M74 16v10M78 14.5v13M82 13.5v15M86 14v14M90 16v10M94 14v14M98 12.5v17M102 13v16M106 15.5v11M110 15.5v11M114 14.5v13M118 14v14M122 15v12M126 16.5v9M130 14v14M134 13v16M138 13.5v15M142 16v10M146 15.5v11M150 14.5v13M154 13.5v15M158 14.5v13M162 15.5v11M166 11.5v19M170 9.5v23M174 10.5v21M178 14.5v13M182 10.5v21M186 7v28M190 7.5v27M194 11.5v19M198 12.5v17M202 8.5v25M206 8.5v25M210 11.5v19M214 16v10M218 13.5v15M222 13.5v15M226 14v14M230 15v12M234 13.5v15M238 9.5v23M242 8v26M246 10.5v21M250 13.5v15M254 8v26M258 5.5v31M262 8v26M266 13.5v15M270 11v20M274 8v26M278 9.5v23M282 13v16M286 14.5v13M290 13v16M294 13.5v15M298 15v12M302 16.5v9M306 14v14M310 12.5v17M314 12.5v17M318 14.5v13M322 14.5v13M326 12.5v17M330 12.5v17M334 14.5v13M338 16.5v9M342 15v12M346 14v14M350 14.5v13M354 16v10M358 15v12M362 13.5v15M366 14v14M370 15.5v11M374 16v10M378 14v14M382 12.5v17M386 13v16M390 15.5v11M394 12v18M398 9v24M402 9v24M406 12v18M410 12.5v17M414 8v26M418 7v28M422 10.5v21M426 15v12M430 11v20M434 10.5v21M438 12.5v17M442 15.5v11M446 15.5v11"/></svg>
              <input type="range" min="0" step="1" aria-label="Début de l’extrait">
              <input type="range" min="0" step="1" aria-label="Fin de l’extrait">
            </div>
            <div class="track-excerpt-times">
              <label>Début <output></output></label>
              <button type="button" class="btn btn-outline" aria-label="Écouter l’extrait">▶</button>
              <label>Fin <output></output></label>
            </div>
            <p class="track-excerpt-limit">30 s gratuites</p>
          </div>
        </section>
        <div class="track-upload track-confirm hidden">
          <div class="track-recap" aria-label="Récapitulatif de la transcription"></div>
          <div class="track-title-field">
            <label for="${idPrefix}track-title-input">Titre du relevé</label>
            <input id="${idPrefix}track-title-input" class="field" type="text" maxlength="110">
          </div>
          <label class="track-rights track-solo hidden"><input type="checkbox"> Ce fichier contient uniquement l’instrument choisi.</label>
          <label class="track-rights"><input id="${idPrefix}track-rights-input" type="checkbox"> <span class="track-rights-text"></span></label>
        </div>
        <p class="track-status" aria-live="polite"></p>
        <div class="track-actions">
          <button type="button" class="btn btn-outline track-back">← Retour</button>
          <button type="submit" class="btn btn-primary track-next"></button>
        </div>
      </form>`;
    const get=selector=>root.querySelector(selector);
    const form=get('form'), heading=get('h2'), choices=get('.track-choices'), importer=get('.track-import');
    const confirmation=get('.track-confirm'), recap=get('.track-recap');
    const back=get('.track-back'), next=get('.track-next'), title=get('#'+idPrefix+'track-title-input');
    const fileInput=get('#'+idPrefix+'track-audio-input'), rights=get('#'+idPrefix+'track-rights-input'), status=get('.track-status');
    const linkInput=get('#'+idPrefix+'track-link-input'), referenceNote=get('.track-reference');
    const sourceTabs=[...root.querySelectorAll('[data-source-mode]')];
    const soloLabel=get('.track-solo'), solo=soloLabel.querySelector('input'), filename=get('.track-filename');
    const media=get('.track-audio-preview');
    const clip=get('.track-excerpt'), clipAudio=clip.querySelector('audio');
    const clipVideo=clip.querySelector('.track-excerpt-video'), clipControls=clip.querySelector('.track-excerpt-controls');
    const [clipStart,clipEnd]=clip.querySelectorAll('input'), [startLabel,endLabel]=clip.querySelectorAll('output');
    const clipPlay=clip.querySelector('button'), clipHint=clip.querySelector('p');
    const clipLimit=30000, clipMinimum=500;
    let initialExcerpt, clipSource, clipPlayer, clipDuration=0, clipTimer, clipLoadTimer, clipPlaying=false;

    function clipTime(ms){
      const seconds=Math.floor(ms/1000);
      const fraction=String(ms%1000).padStart(3,'0').replace(/0+$/,'');
      return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+(fraction?','+fraction:'');
    }

    function stopClip(){
      clearInterval(clipTimer);
      clipPlaying=false;
      clipAudio.pause();
      clipPlayer?.pauseVideo?.();
      clipPlay.textContent='▶';
      clipPlay.setAttribute('aria-label','Écouter l’extrait');
    }

    function updateClip(){
      clipControls.classList.toggle('hidden',!draft.excerpt);
      if(!draft.excerpt)return;
      const {start_ms:start,end_ms:end}=draft.excerpt;
      clipStart.max=clipEnd.max=clipDuration;
      clipStart.value=start;
      clipEnd.value=end;
      startLabel.textContent=clipTime(start);
      endLabel.textContent=clipTime(end);
      clipStart.setAttribute('aria-valuetext',startLabel.textContent);
      clipEnd.setAttribute('aria-valuetext',endLabel.textContent);
      const selection=clip.querySelector('.track-excerpt-timeline span');
      const left=100*start/clipDuration+'%';
      const right=100*(clipDuration-end)/clipDuration+'%';
      selection.style.left=left;
      selection.style.right=right;
      selection.parentElement.style.setProperty('--wave-start',left);
      selection.parentElement.style.setProperty('--wave-end',right);
    }

    function resetClip(){
      stopClip();
      clearTimeout(clipLoadTimer);
      clipLoadTimer=null;
      clipSource=null;
      clipDuration=0;
      draft.excerpt=undefined;
      clipPlayer?.destroy();
      clipPlayer=null;
      clipVideo.replaceChildren();
      clipAudio.onloadedmetadata=clipAudio.onerror=null;
      clipAudio.removeAttribute('src');
      clipAudio.load();
      updateClip();
    }

    function loadClip(){
      if(clipSource===link&&(draft.excerpt||clipLoadTimer))return;
      resetClip();
      const source=clipSource=link;
      const fail=()=>{
        if(clipSource!==source)return;
        clearTimeout(clipLoadTimer);
        clipLoadTimer=null;
        stopClip();
        draft.excerpt=undefined;
        clipHint.textContent='Impossible de lire ce lien. Essaie un autre lien ou importe le fichier audio.';
        updateClip();
        if(current==='excerpt')next.disabled=true;
      };
      const ready=seconds=>{
        if(clipSource!==source||!Number.isFinite(seconds)||seconds<.5||draft.excerpt)return;
        clearTimeout(clipLoadTimer);
        clipLoadTimer=null;
        clipDuration=Math.min(86400000,Math.floor(seconds*1000));
        const saved=initialExcerpt;
        initialExcerpt=null;
        draft.excerpt=saved&&saved.end_ms<=clipDuration?saved:{start_ms:0,end_ms:Math.min(clipLimit,clipDuration)};
        clipHint.textContent='Fais glisser les poignées pour choisir le passage à transcrire.';
        updateClip();
        if(current==='excerpt')next.disabled=false;
      };
      clipHint.textContent='Chargement du morceau…';
      clipLoadTimer=setTimeout(fail,12000);
      clipVideo.hidden=!source.youtubeId;
      if(!source.youtubeId){
        clipAudio.onloadedmetadata=()=>ready(clipAudio.duration);
        clipAudio.onerror=fail;
        clipAudio.src=source.url.href;
        return;
      }
      window.SongToSheetFlow.loadYoutubeIframeApi().then(YT=>{
        if(clipSource!==source)return;
        const host=document.createElement('div');
        clipVideo.append(host);
        clipPlayer=new YT.Player(host,{
          videoId:source.youtubeId,
          playerVars:{controls:0,playsinline:1,disablekb:1,origin:location.origin},
          events:{
            onReady:({target})=>{
              target.getIframe().tabIndex=-1;
              ready(target.getDuration()||metadata?.duration_seconds);
              lookup?.request.then(()=>ready(target.getDuration()||metadata?.duration_seconds));
            },
            onStateChange:({target,data})=>{
              ready(target.getDuration());
              if(data===YT.PlayerState.ENDED&&clipPlaying)stopClip();
            },
            onAutoplayBlocked:()=>{
              if(clipSource!==source)return;
              stopClip();
              clipHint.textContent='La lecture a été bloquée. Appuie de nouveau sur Play.';
            },
            onError:fail
          }
        });
      }).catch(fail);
    }

    clipStart.addEventListener('input',()=>{
      stopClip();
      const start=Math.min(Number(clipStart.value),clipDuration-clipMinimum);
      const end=Math.max(start+clipMinimum,Math.min(draft.excerpt.end_ms,start+clipLimit));
      draft.excerpt={start_ms:start,end_ms:end};
      updateClip();
    });
    clipEnd.addEventListener('input',()=>{
      stopClip();
      const end=Math.max(Number(clipEnd.value),clipMinimum);
      const start=Math.min(end-clipMinimum,Math.max(draft.excerpt.start_ms,end-clipLimit));
      draft.excerpt={start_ms:start,end_ms:end};
      updateClip();
    });
    clipPlay.addEventListener('click',()=>{
      if(clipPlaying){stopClip();return;}
      const {start_ms:start,end_ms:end}=draft.excerpt;
      clipPlaying=true;
      clipPlay.textContent='❚❚';
      clipPlay.setAttribute('aria-label','Mettre en pause');
      if(link.youtubeId){
        clipPlayer.loadVideoById({videoId:link.youtubeId,startSeconds:start/1000,endSeconds:end/1000});
      }else{
        clipAudio.currentTime=start/1000;
        clipAudio.play().catch(()=>{
          if(!clipPlaying)return;
          stopClip();
          clipHint.textContent='La lecture a échoué. Réessaie.';
        });
        clipTimer=setInterval(()=>{
          if(clipAudio.currentTime>=end/1000||clipAudio.ended)stopClip();
        },30);
      }
    });
    const setStatus=(message,error=false)=>{
      status.textContent=message;
      status.classList.toggle('is-error',error);
    };
    const sourceLabel=()=>draft.file?.name||link?.provider||link?.url.hostname||'';
    const sourceTitle=()=>{
      const fallback=draft.file?.name||(link?.youtubeId?'Vidéo YouTube':link?.url.pathname.split('/').filter(Boolean).at(-1))||'Audio importé';
      return (metadata?.title||fallback.replace(fileExtension,'')).slice(0,110);
    };
    const labelFor=(options,value)=>options.find(option=>option[0]===value)?.[2];

    function showTitle(){
      if(!titleEdited&&current==='confirm')title.value=sourceTitle();
    }

    function fetchMetadata(source){
      lookup?.controller.abort();
      lookup=null;
      metadata=source?.youtubeId?{thumbnail_url:'https://i.ytimg.com/vi/'+source.youtubeId+'/hqdefault.jpg'}:null;
      if(!source?.provider)return;
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),8500);
      const url='/api/media-info?url='+encodeURIComponent(source.url.href);
      const request=fetch(url,{headers:{Accept:'application/json'},signal:controller.signal})
        .then(async response=>{
          if(!response.ok&&response.status!==424)return;
          const info=await response.json();
          if(controller.signal.aborted)return;
          metadata={...metadata,...info,thumbnail_url:info.thumbnail_url||metadata?.thumbnail_url};
          showTitle();
          if(current==='confirm')renderRecap();
        }).catch(()=>{}).finally(()=>clearTimeout(timeout));
      lookup={controller,request};
    }

    function setFile(file){
      media.pause();
      media.onloadedmetadata=null;
      media.removeAttribute('src');media.load();
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      previewUrl=undefined;
      fileDuration=null;
      media.classList.add('hidden');
      draft.file=file;
      solo.checked=false;
      rights.checked=false;
      filename.textContent=file?.name||'Déposer ou choisir un audio';
      if(!file)return;
      previewUrl=URL.createObjectURL(file);
      media.onloadedmetadata=()=>{
        if(draft.file!==file||!Number.isFinite(media.duration))return;
        fileDuration=media.duration;
        filename.textContent=`${file.name} · ${formatDuration(fileDuration)}`;
        media.classList.remove('hidden');
        if(current==='confirm')renderRecap();
      };
      media.src=previewUrl;
    }

    function setMode(value,sourceReference=null){
      resetClip();
      initialExcerpt=null;
      mode=value;
      reference=sourceReference;
      link=null;
      if(linkInput)linkInput.value='';
      fileInput.value='';
      setFile(null);
      fetchMetadata(reference);
      titleEdited=false;
      onLinkChange?.(reference?.url.href);
    }

    function renderRecap(){
      const duration=fileDuration??(metadata?.duration_verified?metadata.duration_seconds:null);
      const recordingDetails=[sourceLabel()!==sourceTitle()?sourceLabel():null,metadata?.artist,
        Number.isFinite(duration)&&duration>0?formatDuration(duration):null].filter(Boolean).join(' · ');
      const rows=[
        ['import','Enregistrement',sourceTitle(),'♪',recordingDetails],
        ['instrument','Instrument',labelFor(instruments,draft.instrument),'♫'],
        ['format','Format',labelFor(formats,draft.format),'𝄞'],
        ['source','Contenu',draft.source==='instrumental'&&solo.checked
          ?'Instrument seul':labelFor(sources,draft.source),'♬']
      ];
      if(draft.excerpt){
        rows.splice(1,0,['excerpt','Extrait',clipTime(draft.excerpt.start_ms)+' – '+clipTime(draft.excerpt.end_ms),'↔']);
      }
      if(guidedGuitar()){
        rows.splice(2,0,['guitarPresence','Guitare dans le morceau',labelFor(guitarPresence,draft.guitarPresence),'♫'],
          ['guitarGoal','Objectif',labelFor(guitarGoals,draft.guitarGoal),'♪']);
      }else if(allowLink&&draft.instrument==='guitare')rows.splice(2,0,['capo','Capo',labelFor(capos,draft.capo),'♯']);
      recap.replaceChildren(...rows.map(([field,label,value,icon,detail])=>{
        const row=document.createElement('div');
        row.className='track-recap-row';
        const visual=document.createElement('span');
        visual.className='track-recap-icon';
        visual.setAttribute('aria-hidden','true');
        visual.textContent=icon;
        if(field==='import'&&metadata?.thumbnail_url){
          const image=document.createElement('img');
          image.alt='';
          image.referrerPolicy='no-referrer';
          image.addEventListener('error',()=>image.remove(),{once:true});
          image.src=metadata.thumbnail_url;
          visual.append(image);
        }
        const text=document.createElement('div');
        text.className='track-recap-text';
        const caption=document.createElement('span'), strong=document.createElement('strong');
        caption.textContent=label;
        strong.textContent=value;
        text.append(caption,strong);
        if(detail){
          const small=document.createElement('small');
          small.textContent=detail;
          text.append(small);
        }
        row.append(visual,text);
        if(field==='import'||activeSteps().some(([step])=>step===field)){
          const edit=document.createElement('button');
          edit.type='button';
          edit.className='track-edit';
          edit.dataset.edit=field;
          edit.textContent='Modifier';
          edit.setAttribute('aria-label','Modifier · '+label);
          row.append(edit);
        }
        return row;
      }));
    }

    function render(focus=false){
      const flow=activeSteps();
      const index=flow.findIndex(([field])=>field===current);
      const [field,,question,options]=flow[index];
      const importing=field==='import', confirming=field==='confirm', clipping=field==='excerpt';
      heading.textContent=question;
      const intro=get('.track-step-heading p');
      intro.textContent=confirming&&freemium?'Écoute jusqu’à 30 secondes du relevé.':'';
      intro.hidden=!intro.textContent;
      get('.track-steps').innerHTML=flow.map(([,name],i)=>
        `<li${i<index?' class="is-done"':i===index?' aria-current="step"':''}>${name}</li>`).join('');
      choices.classList.toggle('hidden',!options);
      importer.classList.toggle('hidden',!importing);
      confirmation.classList.toggle('hidden',!confirming);
      clip.classList.toggle('hidden',!clipping);
      if(clipping)loadClip();
      else stopClip();
      if(!importing)media.pause();
      get('.track-link-pane')?.classList.toggle('hidden',mode!=='link');
      get('.track-file-pane').classList.toggle('hidden',mode!=='file');
      get('.track-import-next').classList.toggle('hidden',mode==='link');
      for(const tab of sourceTabs){
        const active=tab.dataset.sourceMode===mode;
        tab.setAttribute('aria-selected',String(active));
        tab.tabIndex=active?0:-1;
      }
      referenceNote.hidden=!reference;
      referenceNote.textContent=reference?audioSource.importHint(reference.provider):'';
      soloLabel.classList.toggle('hidden',draft.source!=='instrumental');
      get('.track-rights-text').textContent=link?.youtubeId
        ?'Je dispose des autorisations pour récupérer l’audio de cette vidéo et le transcrire.'
        :'Je dispose des droits nécessaires pour transcrire cet audio.';
      if(confirming){showTitle();renderRecap();}
      choices.innerHTML=options?options.map(([value,icon,name,detail])=>
        field==='guitarPresence'&&value==='unknown'
          ?`<button type="button" class="track-choice-text" value="${value}" aria-pressed="${draft[field]===value}">${name}</button>`
          :        `<button type="button" class="track-choice" value="${value}" aria-pressed="${draft[field]===value}">
          <span class="track-choice-icon" aria-hidden="true">${icon}</span>
          <span><strong>${name}</strong>${detail?`<small>${detail}</small>`:''}</span>
          <span class="track-choice-arrow" aria-hidden="true">→</span></button>`).join(''):'';
      back.classList.toggle('hidden',index===0&&!onExcerptBack);
      next.classList.toggle('hidden',!confirming&&!clipping);
      next.disabled=clipping&&!draft.excerpt;
      next.textContent=clipping?'Continuer →':freemium?'Générer mon aperçu gratuit ↗':'Générer mon relevé ↗';
      setStatus('');
      if(focus)heading.focus({preventScroll:true});
    }

    function advance(){
      if(current==='import'&&mode==='link'){
        current='excerpt';
      }else if(editing){
        current=activeSteps().find(([field,,,options])=>options&&
          (draft[field]===null||draft[field]===''))?.[0]||'confirm';
        editing=current!=='confirm';
      }else{
        const flow=activeSteps();
        current=flow[flow.findIndex(([field])=>field===current)+1][0];
      }
      render(true);
    }

    choices.addEventListener('click',event=>{
      const button=event.target.closest('.track-choice,.track-choice-text');
      if(!button||busy)return;
      const options=activeSteps().find(([field])=>field===current)[3];
      draft[current]=options.find(([value])=>String(value)===button.value)[0];
      if(current==='instrument'){
        draft.format=guidedGuitar()?'tablature':allowsTab()?'':'partition';
        if(draft.instrument!=='guitare'||guidedGuitar())draft.capo=null;
        if(!guidedGuitar())draft.guitarPresence=draft.guitarGoal=null;
      }
      if(current==='source'&&draft.source!=='instrumental')solo.checked=false;
      advance();
    });
    recap.addEventListener('click',event=>{
      const button=event.target.closest('button[data-edit]');
      if(!button||busy)return;
      current=button.dataset.edit;
      editing=true;
      render(true);
    });
    title.addEventListener('input',()=>{titleEdited=true;});
    solo.addEventListener('change',renderRecap);
    for(const tab of sourceTabs){
      tab.addEventListener('click',()=>{
        if(mode===tab.dataset.sourceMode)return;
        setMode(tab.dataset.sourceMode);
        render();
      });
      tab.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();
        const destination=event.key==='Home'?sourceTabs[0]:event.key==='End'?sourceTabs.at(-1):
          sourceTabs.find(option=>option!==tab);
        destination.click();
        destination.focus();
      });
    }
    const fileDrop=get('.track-file-drop');
    fileDrop.addEventListener('dragover',event=>event.preventDefault());
    fileDrop.addEventListener('drop',event=>{
      event.preventDefault();
      if(mode!=='file'||current!=='import'||busy)return;
      const file=event.dataTransfer.files[0];
      if(!file)return;
      fileInput.value='';
      setFile(file);
      titleEdited=false;
    });
    fileInput.addEventListener('change',()=>{
      setFile(fileInput.files[0]||null);
      titleEdited=false;
    });
    if(linkInput){
      linkInput.addEventListener('input',()=>{rights.checked=false;setStatus('');});
      audioSource.advanceOnPaste(linkInput,()=>{
        if(!busy&&current==='import'&&mode==='link')form.requestSubmit();
      });
      linkInput.addEventListener('keydown',event=>{
        if(event.key==='Enter'&&!event.isComposing){
          event.preventDefault();
          form.requestSubmit();
        }
      });
    }
    back.addEventListener('click',()=>{
      if(busy)return;
      if(onExcerptBack){onExcerptBack();return;}
      const flow=activeSteps();
      const index=flow.findIndex(([field])=>field===current);
      if(index>0){current=flow[index-1][0];editing=false;render(true);}
    });
    const sample=get('.track-sample');
    sample?.addEventListener('click',async()=>{
      if(busy)return;
      sample.disabled=true;
      try{
        const response=await fetch(sampleUrl);
        if(!response.ok)throw new Error('Impossible de charger la mélodie de test.');
        const audio=await response.blob();
        if(busy||mode!=='file')return;
        fileInput.value='';
        setFile(new File([audio],'Mélodie de test.wav',{type:'audio/wav'}));
        draft.source='instrumental';
        solo.checked=true;
        render();
      }catch(error){setStatus(error.message,true);}
      finally{sample.disabled=false;}
    });

    function acceptSource(){
      if(mode==='file'){
        if(!draft.file){setStatus('Ajoute le fichier audio du morceau.',true);fileInput.focus();return false;}
        if(draft.file.size>maxFileSize||draft.file.size<1024||!fileExtension.test(draft.file.name)){
          setStatus('Choisis un fichier audio valide de 25 Mo maximum.',true);fileInput.focus();return false;
        }
        return true;
      }
      const source=audioSource.parse(linkInput.value.trim());
      if(!source){
        setStatus('Colle un lien HTTPS vers ton morceau.',true);linkInput.focus();return false;
      }
      if(source.provider&&!source.youtubeId){
        if(source.provider==='YouTube'){
          setStatus('Colle le lien d’une vidéo YouTube.',true);linkInput.focus();return false;
        }
        setMode('file',source);
        render();
        fileInput.focus();
        return false;
      }
      if(link?.url.href!==source.url.href){
        link=source;
        titleEdited=false;
        fetchMetadata(link);
      }
      onLinkChange?.(link.url.href);
      return true;
    }

    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(busy)return;
      if(current==='import'){
        if(acceptSource())advance();
        return;
      }
      if(current==='excerpt'){
        if(draft.excerpt){
          if(onExcerpt)onExcerpt(draft.excerpt);
          else advance();
        }
        return;
      }
      if(current!=='confirm')return;
      if(mode==='link'&&!draft.excerpt){current='excerpt';render(true);return;}
      if(!rights.checked){setStatus('Confirme que tu disposes des droits nécessaires.',true);rights.focus();return;}
      busy=true;
      media.pause();
      for(const control of form.elements)control.disabled=true;
      try{
        if(lookup&&!titleEdited&&!metadata?.title){
          setStatus('Récupération du titre du morceau…');
          await lookup.request;
        }
        const source=solo.checked&&draft.source==='instrumental'?'instrument':draft.source;
        await onSubmit({...draft,capo:draft.capo??0,source,
          file:mode==='file'?draft.file:null,audioUrl:mode==='link'?link?.url.href:undefined,
          title:title.value.trim()||sourceTitle()},setStatus);
        setMode(allowLink?'link':'file');
        title.value='';
        prefilledSource=editing=false;
        Object.assign(draft,{instrument:'',format:'',source:'',capo:null,guitarPresence:null,guitarGoal:null});
        current='import';
      }catch(error){setStatus(error.message,true);}
      finally{
        busy=false;
        for(const control of form.elements)control.disabled=false;
        if(current==='import')render();
      }
    });
    render();
    return {
      pause(){media.pause();stopClip();},
      dispose(){resetClip();lookup?.controller.abort();},
      prefill({instrument,file,name,audioUrl,excerpt},{focus=true}={}){
        if(busy)return;
        if(file!==undefined||audioUrl!==undefined){
          Object.assign(draft,{instrument:'',format:'',source:'',capo:null,guitarPresence:null,guitarGoal:null});
          const parsed=audioSource?.parse(audioUrl);
          const isReference=parsed?.provider&&parsed.provider!=='YouTube';
          const validLink=parsed&&(!parsed.provider||parsed.youtubeId);
          setMode(file||isReference||!allowLink?'file':'link',isReference?parsed:null);
          if(file)setFile(file);
          else if(validLink){
            link=parsed;
            linkInput.value=parsed.url.href;
            fetchMetadata(link);
            onLinkChange?.(link.url.href);
          }
          prefilledSource=Boolean(mode==='link'?validLink:
            file&&file.size>=1024&&file.size<=maxFileSize&&fileExtension.test(file.name));
        }
        if(instruments.some(([value])=>value===instrument))draft.instrument=instrument;
        if(guidedGuitar())draft.format='tablature';
        else if(!allowsTab()&&draft.instrument)draft.format='partition';
        if(draft.instrument!=='guitare')draft.capo=null;
        if(name){title.value=name;titleEdited=true;}
        if(prefilledSource&&mode==='link'&&excerpt){
          initialExcerpt=excerpt;
          draft.excerpt=excerpt;
        }
        current=prefilledSource?(mode==='link'&&!excerpt?'excerpt':'instrument'):'import';
        editing=false;
        render(focus);
      }
    };
  }

  window.SongToSheetTrackWizard={mount};
})();

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
  const steps=[
    ['import','Source','Quel morceau veux-tu jouer ?'],
    ['instrument','Instrument','Quel instrument veux-tu jouer ?',instruments],
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

  function mount(root,{onSubmit,onLinkChange,sampleUrl,allowLink=false,freemium=false}){
    const draft={instrument:'',format:'',source:'',file:null,capo:null};
    const audioSource=allowLink?window.SongToSheetAudioSource:null;
    const allowsTab=()=>['guitare','basse'].includes(draft.instrument);
    const activeSteps=()=>steps.filter(([field])=>
      (field!=='import'||!prefilledSource||current==='import')&&
      (field!=='capo'||(allowLink&&draft.instrument==='guitare'))&&
      (field!=='format'||allowsTab()));
    let current='import', mode=allowLink?'link':'file', prefilledSource=false, editing=false, busy=false;
    let reference=null, link=null, metadata=null, lookup=null, titleEdited=false, fileDuration=null, previewUrl;
    root.innerHTML=`
      <ol class="track-steps" aria-label="Étapes de création"></ol>
      <div class="track-step-heading">
        <h2 id="track-question" tabindex="-1"></h2><p></p>
      </div>
      <form>
        <div class="track-choices" role="group" aria-labelledby="track-question"></div>
        <div class="track-import hidden">
          <p class="track-reference" aria-live="polite" hidden></p>
          <div class="track-import-card">
            ${allowLink?`<div class="track-source-tabs" role="tablist" aria-label="Source du morceau">
              <button type="button" id="track-link-tab" data-source-mode="link" role="tab" aria-controls="track-link-pane"><span aria-hidden="true">↗</span> Lien musical</button>
              <button type="button" id="track-file-tab" data-source-mode="file" role="tab" aria-controls="track-file-pane"><span aria-hidden="true">⇧</span> Fichier audio</button>
            </div>
            <div class="track-link-pane" id="track-link-pane" role="tabpanel" aria-labelledby="track-link-tab">
              <label class="track-link-label" for="track-link-input">Lien du morceau</label>
              <input id="track-link-input" class="field track-source-field" type="text" inputmode="url"
                autocomplete="off" maxlength="4096" placeholder="Lien YouTube, Spotify ou Deezer" aria-describedby="track-link-hint">
              <p class="track-source-hint" id="track-link-hint">Colle un lien YouTube, Spotify, Deezer ou un lien direct vers un fichier audio. Pour Spotify et Deezer, il faudra aussi ajouter le fichier audio.</p>
            </div>`:''}
            <div class="track-file-pane" id="track-file-pane" ${allowLink?'role="tabpanel" aria-labelledby="track-file-tab"':''}>
              <label class="track-source-field track-file-drop" for="track-audio-input">
                <span aria-hidden="true">⇧</span>
                <span><strong class="track-filename" aria-live="polite">Déposer ou choisir un audio</strong><small>MP3, WAV, M4A, FLAC, OGG ou AAC · 25 Mo</small></span>
                <input id="track-audio-input" type="file" accept=".wav,.mp3,.m4a,.flac,.ogg,.aac,audio/*" aria-label="Ton fichier audio">
              </label>
            </div>
            <button class="btn btn-primary track-import-next" type="submit">Continuer <span aria-hidden="true">→</span></button>
          </div>
          <audio class="track-audio-preview hidden" controls preload="metadata" aria-label="Écouter le fichier sélectionné"></audio>
          ${sampleUrl?'<button type="button" class="btn btn-outline track-sample">Charger la mélodie de test</button>':''}
        </div>
        <div class="track-upload track-confirm hidden">
          <div class="track-recap" aria-label="Récapitulatif de la transcription"></div>
          <div class="track-title-field">
            <label for="track-title-input">Titre du relevé</label>
            <input id="track-title-input" class="field" type="text" maxlength="110">
          </div>
          <label class="track-rights track-solo hidden"><input type="checkbox"> Ce fichier contient uniquement l’instrument choisi.</label>
          <label class="track-rights"><input id="track-rights-input" type="checkbox"> <span class="track-rights-text"></span></label>
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
    const back=get('.track-back'), next=get('.track-next'), title=get('#track-title-input');
    const fileInput=get('#track-audio-input'), rights=get('#track-rights-input'), status=get('.track-status');
    const linkInput=get('#track-link-input'), referenceNote=get('.track-reference');
    const sourceTabs=[...root.querySelectorAll('[data-source-mode]')];
    const soloLabel=get('.track-solo'), solo=soloLabel.querySelector('input'), filename=get('.track-filename');
    const media=get('.track-audio-preview');
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
      if(allowLink&&draft.instrument==='guitare')rows.splice(2,0,['capo','Capo',labelFor(capos,draft.capo),'♯']);
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
        if(field!=='format'||allowsTab()){
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
      const importing=field==='import', confirming=field==='confirm';
      heading.textContent=question;
      const intro=get('.track-step-heading p');
      intro.textContent=confirming&&freemium?'Écoute jusqu’à 30 secondes du relevé.':'';
      intro.hidden=!intro.textContent;
      get('.track-steps').innerHTML=flow.map(([,name],i)=>
        `<li${i<index?' class="is-done"':i===index?' aria-current="step"':''}>${name}</li>`).join('');
      choices.classList.toggle('hidden',!options);
      importer.classList.toggle('hidden',!importing);
      confirmation.classList.toggle('hidden',!confirming);
      if(!importing)media.pause();
      get('.track-link-pane')?.classList.toggle('hidden',mode!=='link');
      get('.track-file-pane').classList.toggle('hidden',mode!=='file');
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
        `<button type="button" class="track-choice" value="${value}" aria-pressed="${draft[field]===value}">
          <span class="track-choice-icon" aria-hidden="true">${icon}</span>
          <span><strong>${name}</strong>${detail?`<small>${detail}</small>`:''}</span>
          <span class="track-choice-arrow" aria-hidden="true">→</span></button>`).join(''):'';
      back.classList.toggle('hidden',index===0);
      next.classList.toggle('hidden',!confirming);
      next.textContent=freemium?'Générer mon aperçu gratuit ↗':'Générer mon relevé ↗';
      setStatus('');
      if(focus)heading.focus({preventScroll:true});
    }

    function advance(){
      if(editing){
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
      const button=event.target.closest('.track-choice');
      if(!button||busy)return;
      const options=activeSteps().find(([field])=>field===current)[3];
      draft[current]=options.find(([value])=>String(value)===button.value)[0];
      if(current==='instrument'){
        if(!allowsTab())draft.format='partition';
        if(draft.instrument!=='guitare')draft.capo=null;
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
    linkInput?.addEventListener('input',()=>{rights.checked=false;});
    back.addEventListener('click',()=>{
      if(busy)return;
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
      if(current!=='confirm')return;
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
        Object.assign(draft,{instrument:'',format:'',source:'',capo:null});
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
      pause(){media.pause();},
      prefill({instrument,file,name,audioUrl}){
        if(busy)return;
        if(file!==undefined||audioUrl!==undefined){
          Object.assign(draft,{instrument:'',format:'',source:'',capo:null});
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
        if(!allowsTab()&&draft.instrument)draft.format='partition';
        if(draft.instrument!=='guitare')draft.capo=null;
        if(name){title.value=name;titleEdited=true;}
        current=prefilledSource?'instrument':'import';
        editing=false;
        render(true);
      }
    };
  }

  window.SongToSheetTrackWizard={mount};
})();

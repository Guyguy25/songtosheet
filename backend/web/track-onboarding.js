(() => {
  'use strict';

  const instruments=[
    ['piano','🎹','Piano'],['guitare','🎸','Guitare'],['basse','♫','Basse']
  ];
  const formats=[
    ['partition','𝄞','Partition','Garde les notes simultanées détectées sur une portée.'],
    ['tablature','≡','Tablature','Lis les cordes et les cases, avec les accords jouables.']
  ];
  const sources=[
    ['mixed','🎙️','Il y a une voix'],
    ['instrumental','♫','Il y a juste la musique']
  ];
  const steps=[
    ['Instrument','Quel instrument veux-tu jouer ?',''],
    ['Format','Partition ou tablature ?','Tu pourras télécharger le résultat en PDF.'],
    ['Audio','Y a-t-il une voix dans ton morceau ?',''],
    ['Import','Ajoute ton fichier audio','Formats WAV, MP3, M4A, FLAC, OGG ou AAC. Jusqu’à 25 Mo et 6 minutes.']
  ];

  function mount(root,{onSubmit,onLinkChange,sampleUrl,allowLink=false}){
    const draft={instrument:'',format:'',source:'',file:null};
    let step=0,busy=false;
    root.innerHTML=`
      <ol class="track-steps" aria-label="Étapes de création">${steps.map(([label],i)=>
        `<li><span>${i+1}</span><b>${label}</b></li>`).join('')}</ol>
      <div class="track-step-heading">
        <span class="track-step-count"></span><h2 tabindex="-1"></h2><p></p>
      </div>
      ${allowLink?'<p class="track-selection track-reference hidden" aria-live="polite"></p>':''}
      <form>
        <div class="track-choices" role="radiogroup"></div>
        <div class="track-upload hidden">
          ${allowLink?`<div class="track-upload track-saved-link hidden">
            <p class="track-selection"></p>
            <button type="button" class="btn btn-outline track-change-source">Changer de source</button>
          </div>`:''}
          <div class="track-upload track-source-fields">
          <label for="track-audio-input">Ton fichier audio</label>
          <input id="track-audio-input" type="file" accept=".wav,.mp3,.m4a,.flac,.ogg,.aac,audio/*">
          ${allowLink?`<label for="track-link-input">Ou colle un lien audio ou YouTube</label>
          <input id="track-link-input" class="field" type="text" inputmode="url" autocomplete="off" maxlength="4096"
            placeholder="https://exemple.fr/morceau.mp3" aria-describedby="track-link-help">
          <small id="track-link-help">Utilise une vidéo YouTube publique ou un lien direct vers un fichier audio.</small>`:''}
          <small class="track-filename" aria-live="polite"></small>
          <audio class="track-audio-preview hidden" controls preload="metadata" aria-label="Écouter le fichier sélectionné"></audio>
          ${sampleUrl?'<button type="button" class="btn btn-outline track-sample">Charger la mélodie de test</button>':''}
          </div>
          <label for="track-title-input">Nom du relevé</label>
          <input id="track-title-input" class="field" type="text" maxlength="90" placeholder="Ex. Mon morceau">
          <label class="track-rights track-solo hidden"><input type="checkbox"> Ce fichier contient uniquement l’instrument choisi.</label>
          <label class="track-rights"><input id="track-rights-input" type="checkbox"> <span class="track-rights-text">Je dispose des droits nécessaires pour transcrire cet audio.</span></label>
        </div>
        <p class="track-selection hidden"></p>
        <p class="track-status" aria-live="polite"></p>
        <div class="track-actions">
          <button type="button" class="btn btn-outline track-back">← Retour</button>
          <button type="submit" class="btn btn-primary track-next">Continuer ↗</button>
        </div>
      </form>`;
    const get=selector=>root.querySelector(selector);
    const form=get('form'),heading=get('h2'),choices=get('.track-choices'),upload=get('.track-upload');
    const back=get('.track-back'),next=get('.track-next'),title=get('#track-title-input');
    const fileInput=get('#track-audio-input'),rights=get('#track-rights-input'),status=get('.track-status');
    const linkInput=get('#track-link-input');
    const savedLink=get('.track-saved-link');
    const sourceFields=get('.track-source-fields');
    const referenceNote=get('.track-reference');
    const audioSource=allowLink?window.SongToSheetAudioSource:null;
    const updateRights=source=>{
      get('.track-rights-text').textContent=source?.youtubeId
        ?'Je dispose des autorisations nécessaires pour récupérer cet audio depuis YouTube et le transcrire.'
        :'Je dispose des droits nécessaires pour transcrire cet audio.';
    };
    const soloLabel=get('.track-solo'),solo=soloLabel.querySelector('input'),filename=get('.track-filename');
    const media=get('.track-audio-preview');
    const fields=['instrument','format','source'];
    const allowsTab=()=>['guitare','basse'].includes(draft.instrument);
    const setStatus=(message,error=false)=>{status.textContent=message;status.classList.toggle('is-error',error);};
    let reference,editingSource=false;
    const setReference=source=>{
      reference=source;
      if(!referenceNote)return;
      referenceNote.classList.toggle('hidden',!source);
      referenceNote.textContent=source?audioSource.importHint(source.provider):'';
      if(source){
        const link=document.createElement('a');
        link.href=source.url.href;
        link.target='_blank';
        link.rel='noopener noreferrer';
        link.textContent='↗';
        link.setAttribute('aria-label',`Ouvrir la référence sur ${source.provider}`);
        referenceNote.append(' ',link);
      }
    };
    let previewUrl;
    const setFile=file=>{
      media.pause();
      media.onloadedmetadata=null;media.onerror=null;
      media.removeAttribute('src');media.load();
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      previewUrl=undefined;
      media.classList.add('hidden');
      draft.file=file;
      solo.checked=false;
      rights.checked=false;
      filename.textContent=file?file.name:'Aucun fichier sélectionné.';
      if(!file)return;
      previewUrl=URL.createObjectURL(file);
      media.onloadedmetadata=()=>{
        if(draft.file===file&&Number.isFinite(media.duration)){
          const seconds=Math.round(media.duration);
          filename.textContent=`${file.name} · Durée : ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
          media.classList.remove('hidden');
        }
      };
      media.src=previewUrl;
    };

    function render(focus=false){
      const [label,question,description]=steps[step];
      get('.track-step-count').textContent=`Étape ${step+1} sur ${steps.length}`;
      const link=audioSource?.parse(linkInput?.value);
      const useSavedLink=Boolean(link&&(!link.provider||link.youtubeId)&&!editingSource);
      sourceFields.classList.toggle('hidden',useSavedLink);
      if(savedLink){
        savedLink.classList.toggle('hidden',!useSavedLink);
        if(useSavedLink)savedLink.querySelector('p').textContent=`Lien conservé · ${link.youtubeId?'YouTube':link.url.hostname}`;
      }
      updateRights(link);
      heading.textContent=step===3&&allowLink?(useSavedLink?'Confirme ton relevé':'Ajoute ton audio'):question;
      const intro=get('.track-step-heading p');
      intro.textContent=step===3&&useSavedLink?'Ton lien est déjà prêt. Confirme les droits pour lancer la génération.':description;
      intro.hidden=!intro.textContent;
      root.querySelectorAll('.track-steps li').forEach((item,index)=>{
        item.classList.toggle('is-done',index<step);
        if(index===step)item.setAttribute('aria-current','step');
        else item.removeAttribute('aria-current');
      });
      const field=fields[step];
      choices.classList.toggle('hidden',!field);
      upload.classList.toggle('hidden',Boolean(field));
      if(field)media.pause();
      soloLabel.classList.toggle('hidden',draft.source!=='instrumental');
      const recap=get('form > .track-selection');
      recap.classList.toggle('hidden',Boolean(field));
      if(!field)recap.textContent=[instruments,formats,sources]
        .map((list,index)=>list.find(([value])=>value===draft[fields[index]])?.[2]).filter(Boolean).join(' · ');
      choices.setAttribute('aria-label',label);
      choices.innerHTML=field?[instruments,formats,sources][step].map(([value,icon,name,detail])=>{
        const disabled=value==='tablature'&&!allowsTab();
        const description=disabled?'Disponible pour la guitare et la basse.':detail;
        return `<label class="track-choice"><input type="radio" name="track-choice" value="${value}"
          ${draft[field]===value?'checked':''} ${disabled?'disabled':''}>
          <span><span class="track-choice-icon" aria-hidden="true">${icon}</span>
          <strong>${name}</strong>${description?`<small>${description}</small>`:''}</span></label>`;
      }).join(''):'';
      back.classList.toggle('hidden',step===0);
      next.textContent=step===3?'Générer mon relevé ↗':'Continuer ↗';
      next.disabled=Boolean(field&&!draft[field]);
      setStatus('');
      if(focus)heading.focus({preventScroll:true});
    }

    choices.addEventListener('change',event=>{
      draft[fields[step]]=event.target.value;
      if(step===0&&!allowsTab()&&draft.format==='tablature')draft.format='';
      next.disabled=false;
    });
    fileInput.addEventListener('change',()=>{
      if(linkInput&&fileInput.files.length){
        linkInput.value='';
        onLinkChange?.(reference?.url.href);
        updateRights(null);
      }
      setFile(fileInput.files[0]||null);
    });
    get('.track-change-source')?.addEventListener('click',()=>{
      editingSource=true;
      render();
      linkInput.focus();
    });
    linkInput?.addEventListener('input',()=>{
      rights.checked=false;
      updateRights(audioSource.parse(linkInput.value.trim()));
    });
    linkInput?.addEventListener('change',()=>{
      const source=audioSource.parse(linkInput.value.trim());
      if(source?.provider&&!source.youtubeId){
        setReference(source);
        linkInput.value='';
      }else if(source&&draft.file){
        fileInput.value='';
        setFile(null);
      }
      updateRights(audioSource.parse(linkInput.value.trim()));
      onLinkChange?.(source?.url.href||reference?.url.href);
    });
    back.addEventListener('click',()=>{if(!busy&&step>0){step--;render(true);}});
    const sample=get('.track-sample');
    if(sample)sample.addEventListener('click',async()=>{
      if(busy)return;
      sample.disabled=true;
      try{
        const response=await fetch(sampleUrl);
        if(!response.ok)throw new Error('Impossible de charger la mélodie de test.');
        const audio=await response.blob();
        if(busy)return;
        fileInput.value='';
        setFile(new File([audio],'melodie-de-test.wav',{type:'audio/wav'}));
        if(!title.value)title.value='Mélodie de test';
        draft.source='instrumental';
        solo.checked=true;
        render();
        setStatus('Exemple chargé. Il contient juste de la musique.');
      }catch(error){setStatus(error.message,true);}
      finally{sample.disabled=false;}
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(busy)return;
      if(step<3){
        if(draft[fields[step]]){step++;render(true);}
        return;
      }
      const audioUrl=linkInput?.value.trim()||'';
      let link=null,youtubeId;
      if(audioUrl){
        const source=audioSource.parse(audioUrl);
        if(!source){
          setStatus('Colle un lien HTTPS vers une vidéo YouTube ou un fichier audio.',true);linkInput.focus();return;
        }
        if(source.provider&&!source.youtubeId){
          setReference(source);
          linkInput.value='';
          onLinkChange?.(source.url.href);
        }else{
          link=source.url;
          youtubeId=source.youtubeId;
        }
      }
      if(!draft.file&&!link){
        setStatus(reference?audioSource.importHint(reference.provider):allowLink?'Ajoute un fichier audio ou colle un lien YouTube.':'Ajoute un fichier audio pour continuer.',true);
        fileInput.focus();return;
      }
      if(!rights.checked){setStatus('Confirme que tu disposes des droits nécessaires.',true);rights.focus();return;}
      busy=true;
      media.pause();
      for(const control of form.elements)control.disabled=true;
      try{
        const source=solo.checked&&draft.source==='instrumental'?'instrument':draft.source;
        const fallback=youtubeId?`Vidéo YouTube · ${youtubeId}`:draft.file?.name||link?.pathname.split('/').filter(Boolean).at(-1)||'Audio importé';
        await onSubmit({...draft,source,audioUrl:link?.href,title:title.value.trim()||fallback.replace(/\.(wav|mp3|m4a|flac|ogg|aac)$/i,'')},setStatus);
        if(linkInput)linkInput.value='';
        setReference(null);
        editingSource=false;
        fileInput.value='';title.value='';setFile(null);
        for(const field of fields)draft[field]='';
        step=0;
      }catch(error){setStatus(error.message,true);}
      finally{
        busy=false;
        for(const control of form.elements)control.disabled=false;
        if(step===0)render();
      }
    });
    setFile(null);
    render();
    return {
      pause(){media.pause();},
      prefill({instrument,file,name,audioUrl}){
        if(busy)return;
        if(file!==undefined||audioUrl!==undefined){
          for(const field of fields)draft[field]='';
          fileInput.value='';setFile(file||null);
          title.value='';
          const source=audioSource?.parse(audioUrl);
          const isReference=source?.provider&&!source.youtubeId;
          setReference(isReference?source:null);
          editingSource=false;
          if(linkInput)linkInput.value=source&&!isReference?source.url.href:'';
        }
        if(instruments.some(([value])=>value===instrument))draft.instrument=instrument;
        if(!allowsTab()&&draft.format==='tablature')draft.format='';
        if(name)title.value=name;
        step=0;render(true);
      }
    };
  }

  window.SongToSheetTrackWizard={mount};
})();

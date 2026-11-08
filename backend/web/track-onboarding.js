(() => {
  'use strict';

  const instruments=[
    ['piano','🎹','Piano'],['guitare','🎸','Guitare'],['basse','♫','Basse']
  ];
  const formats=[
    ['partition','𝄞','Partition','Garde les notes simultanées détectées sur une portée.'],
    ['tablature','≡','Tablature','Lis les cordes et les cases d’une mélodie à une note à la fois.']
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

  function mount(root,{onSubmit,sampleUrl}){
    const draft={instrument:'',format:'',source:'',file:null};
    let step=0,busy=false;
    root.innerHTML=`
      <ol class="track-steps" aria-label="Étapes de création">${steps.map(([label],i)=>
        `<li><span>${i+1}</span><b>${label}</b></li>`).join('')}</ol>
      <div class="track-step-heading">
        <span class="track-step-count"></span><h2 tabindex="-1"></h2><p></p>
      </div>
      <form>
        <div class="track-choices" role="radiogroup"></div>
        <div class="track-upload hidden">
          <label for="track-audio-input">Ton fichier audio</label>
          <input id="track-audio-input" type="file" accept=".wav,.mp3,.m4a,.flac,.ogg,.aac,audio/*">
          <small class="track-filename" aria-live="polite"></small>
          ${sampleUrl?'<button type="button" class="btn btn-outline track-sample">Charger la mélodie de test</button>':''}
          <label for="track-title-input">Nom du relevé</label>
          <input id="track-title-input" class="field" type="text" maxlength="90" placeholder="Ex. Mon morceau">
          <label class="track-rights track-solo hidden"><input type="checkbox"> Ce fichier contient uniquement l’instrument choisi.</label>
          <label class="track-rights"><input id="track-rights-input" type="checkbox"> Je dispose des droits nécessaires pour transcrire cet audio.</label>
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
    const soloLabel=get('.track-solo'),solo=soloLabel.querySelector('input'),filename=get('.track-filename');
    const fields=['instrument','format','source'];
    const allowsTab=()=>['guitare','basse'].includes(draft.instrument);
    const setStatus=(message,error=false)=>{status.textContent=message;status.classList.toggle('is-error',error);};
    let releaseMetadata;
    const setFile=file=>{
      releaseMetadata?.();
      draft.file=file;
      solo.checked=false;
      rights.checked=false;
      filename.textContent=file?file.name:'Aucun fichier sélectionné.';
      if(!file)return;
      const media=document.createElement('audio'),url=URL.createObjectURL(file);
      media.preload='metadata';
      releaseMetadata=()=>{
        media.onloadedmetadata=null;media.onerror=null;
        media.removeAttribute('src');media.load();
        URL.revokeObjectURL(url);
        releaseMetadata=undefined;
      };
      media.onloadedmetadata=()=>{
        if(draft.file===file&&Number.isFinite(media.duration)){
          const seconds=Math.round(media.duration);
          filename.textContent=`${file.name} · Durée : ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
        }
        releaseMetadata?.();
      };
      media.onerror=()=>releaseMetadata?.();
      media.src=url;
    };

    function render(focus=false){
      const [label,question,description]=steps[step];
      get('.track-step-count').textContent=`Étape ${step+1} sur ${steps.length}`;
      heading.textContent=question;
      const intro=get('.track-step-heading p');
      intro.textContent=description;
      intro.hidden=!description;
      root.querySelectorAll('.track-steps li').forEach((item,index)=>{
        item.classList.toggle('is-done',index<step);
        if(index===step)item.setAttribute('aria-current','step');
        else item.removeAttribute('aria-current');
      });
      const field=fields[step];
      choices.classList.toggle('hidden',!field);
      upload.classList.toggle('hidden',Boolean(field));
      soloLabel.classList.toggle('hidden',draft.source!=='instrumental');
      const recap=get('.track-selection');
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
    fileInput.addEventListener('change',()=>setFile(fileInput.files[0]||null));
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
      if(!draft.file){setStatus('Ajoute un fichier audio pour continuer.',true);fileInput.focus();return;}
      if(!rights.checked){setStatus('Confirme que tu disposes des droits nécessaires.',true);rights.focus();return;}
      busy=true;
      for(const control of form.elements)control.disabled=true;
      try{
        const source=solo.checked&&draft.source==='instrumental'?'instrument':draft.source;
        await onSubmit({...draft,source,title:title.value.trim()||draft.file.name.replace(/\.[^.]+$/,'')},setStatus);
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
      prefill({instrument,file,name}){
        if(busy)return;
        if(instruments.some(([value])=>value===instrument))draft.instrument=instrument;
        if(!allowsTab()&&draft.format==='tablature')draft.format='';
        if(file!==undefined){fileInput.value='';setFile(file);}
        if(name)title.value=name;
        step=0;render();
      }
    };
  }

  window.SongToSheetTrackWizard={mount};
})();

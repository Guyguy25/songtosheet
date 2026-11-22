/* Tablurio — mode Apprentissage : « Apprendre ce son ».
 * Carte du morceau (niveaux, sections, boss) → niveau en trois phases : Écoute, Entraîne, Défi.
 * Le micro valide les notes jouées (learn-audio.js), les règles viennent de learn-core.js.
 * window.TablurioLearn.mount(root,{job,version,backHref}) → dispose() */
(() => {
  'use strict';
  const Core=window.TablurioLearnCore,Audio=window.TablurioLearnAudio;
  const scriptUrl=document.currentScript?.src||location.href;
  const SOUNDS=new URL('sounds/',scriptUrl);
  const PROFILES={
    guitare:{folder:'guitar-steel/',pitches:[40,45,50,55,59,64,69,74,79,83,88],volume:.5,release:.06},
    piano:{folder:'piano-grand/',pitches:[21,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108],volume:.27,release:.18}
  };
  const PIANO={arrangement:['pianoarrxml','pianoarrmid'],solo:['pianosoloxml','pianosolomid'],playable:['pianoeasyxml','pianoeasymid'],
    yourmt3:['pianoyourxml','pianoyourmid'],basic:['pianobasicxml','pianobasicmid'],reduction:['pianoredxml','pianoredmid']};
  const OPEN={1:64,2:59,3:55,4:50,5:45,6:40};
  const MIC_KEY='tablurio_learn_mic';
  const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Langue : le jeu dessine aussi sur un canvas, il traduit donc lui-même ---------- */
  const EN={
    'Partition':'Sheet music','Mode Apprentissage':'Learning mode','Apprends ce son, niveau par niveau':'Learn this song, level by level',
    'Joue, gagne des étoiles, débloque la suite : à la fin, tu connais ton morceau.':'Play, earn stars, unlock what comes next: by the end, you know your song.',
    'Progression du morceau':'Song progress','Continuer : {x}':'Continue: {x}','Commencer : {x}':'Start: {x}','Rejouer le boss':'Replay the boss',
    'Section {n}':'Section {n}','Niveau {n}':'Level {n}','Boss':'Boss','Boss de la section {n}':'Section {n} boss',
    'jours de suite':'days in a row','jour de suite':'day in a row','XP':'XP',
    'Suite du morceau':'Rest of the song','Tu joues aux {s} premières secondes.':'You are playing the first {s} seconds.',
    'Débloque le morceau entier pour apprendre toute la suite.':'Unlock the whole song to learn all of it.',
    'Débloquer la suite du morceau':'Unlock the rest of the song','Le morceau entier est inclus dans ton abonnement.':'The whole song is included in your plan.',
    'Génère la suite depuis la partition, puis reviens jouer.':'Generate the rest from the sheet music, then come back to play.',
    'Générer la suite':'Generate the rest','Chargement du jeu…':'Loading the game…','Le jeu ne peut pas charger ce morceau.':'The game cannot load this song.',
    'Aucune note à apprendre dans ce relevé.':'No notes to learn in this transcription.','Retour à la partition':'Back to the sheet music',
    'Carte':'Map','Écoute':'Listen','Entraîne':'Practice','Défi':'Challenge',
    'Étape 1 · Écoute':'Step 1 · Listen','Écoute le passage et regarde les notes arriver sur la ligne.':'Listen to the passage and watch the notes reach the line.',
    'Écouter':'Listen','Réécouter':'Listen again','Passer':'Skip','Je suis prêt':'I’m ready',
    'Étape 2 · Entraîne':'Step 2 · Practice','Joue chaque note à ton rythme : le jeu t’attend et avance dès qu’il t’entend.':'Play each note at your own pace: the game waits and moves on as soon as it hears you.',
    'Note jouée':'Note played','Clique ou appuie sur Espace quand tu as joué la note.':'Click or press Space once you have played the note.',
    'Commencer':'Start','Étape 3 · Défi':'Step 3 · Challenge','Joue le passage en rythme. Parfait, Bien ou Raté : chaque note compte.':'Play the passage in time. Perfect, Good or Miss: every note counts.',
    'Vitesse':'Speed','Lancer le défi':'Start the challenge','Lancer le passage':'Play the passage','Je l’ai joué ✓':'I played it ✓',
    'Joue toute la section d’une traite, à vitesse réelle.':'Play the whole section in one go, at full speed.','Affronter le boss':'Face the boss',
    'Parfait !':'Perfect!','Bien':'Good','Raté':'Miss','Combo':'Combo','Score':'Score','Précision':'Accuracy','Meilleur combo':'Best combo',
    'Parfait, tu maîtrises ce passage !':'Perfect, you’ve mastered this passage!','Bien joué !':'Well played!','Pas mal, continue !':'Not bad, keep going!',
    'Encore un essai':'One more try','Il faut 60 % de notes justes pour débloquer la suite.':'You need 60% of the notes right to unlock what comes next.',
    'Passe à 1× pour viser la 3ᵉ étoile.':'Switch to 1× to aim for the 3rd star.','Rejouer':'Replay','Niveau suivant':'Next level','Validé ✓':'Done ✓',
    'Passage validé sans micro.':'Passage completed without the microphone.','Active le micro pour gagner des étoiles.':'Turn on the microphone to earn stars.',
    'Activer le micro':'Turn on the microphone','Joue avec ton instrument':'Play with your instrument',
    'Tablurio écoute ton instrument pour valider tes notes. Rien n’est enregistré ni envoyé.':'Tablurio listens to your instrument to check your notes. Nothing is recorded or sent.',
    'Avec des écouteurs, c’est encore plus précis.':'With headphones, it’s even more accurate.','Jouer sans micro':'Play without the microphone',
    'Joue une note':'Play a note','Gratte une corde ou appuie sur une touche, on règle l’écoute.':'Pluck a string or press a key, we’re tuning the listening.',
    'On n’a rien entendu':'We heard nothing','Rapproche-toi du micro ou joue plus fort, puis réessaie.':'Move closer to the microphone or play louder, then try again.',
    'Réessayer':'Try again','Micro indisponible':'Microphone unavailable','Le navigateur n’a pas donné accès au micro. Tu peux jouer sans micro.':'The browser did not give access to the microphone. You can play without it.',
    'Son guide':'Guide sound','Micro':'Mic','Tu joues :':'You play:','corde {s} · case {f}':'string {s} · fret {f}','Prêt ?':'Ready?',
    'Enregistrement impossible : ta progression n’a pas été sauvegardée.':'Could not save: your progress was not stored.',
    '+{x} XP':'+{x} XP','Série : {n} 🔥':'Streak: {n} 🔥','{a} sur {b} notes':'{a} of {b} notes','Écouter le passage':'Listen to the passage'
  };
  const lang=()=>{try{const v=localStorage.getItem('tablurio_lang');if(v==='fr'||v==='en')return v;}catch{}return (document.documentElement.lang||'fr').startsWith('en')?'en':'fr';};
  const t=(fr,vars={})=>(lang()==='en'&&EN[fr]||fr).replace(/\{(\w+)\}/g,(_,k)=>vars[k]??'');
  const NAMES={fr:['Do','Do#','Ré','Ré#','Mi','Fa','Fa#','Sol','Sol#','La','La#','Si'],en:['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']};
  const noteName=midi=>NAMES[lang()][((Math.round(midi)%12)+12)%12];
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const fmtSpeed=s=>(lang()==='en'?String(s):String(s).replace('.',','))+'×';

  /* ---------- Sources : la version affichée sur l'écran partition ---------- */
  function sources(job,version){
    const files=new Set(job.downloads||[]),url=k=>`/api/track?id=${encodeURIComponent(job.id)}&download=${k}`;
    const has=(...keys)=>keys.every(k=>files.has(k));
    if(job.instrument==='piano'){
      const keys=Object.keys(PIANO).filter(k=>has(...PIANO[k]));
      const recommended=(job.piano_versions||[]).find?.(v=>v?.recommended)?.key;
      const key=[version,job.piano_choice,recommended,keys[0]].find(k=>keys.includes(k));
      if(key)return {version:key,xml:url(PIANO[key][0]),midi:url(PIANO[key][1]),tab:false};
      return {version:'direct',xml:url('musicxml'),midi:url('mid'),tab:false};
    }
    if(job.instrument==='guitare'){
      if((version==='solo'||(!version&&job.guitar_goal==='solo'))&&has('solotab','solomid'))return {version:'solo',xml:url('solotab'),midi:url('solomid'),tab:true};
      if(version==='rhythm'&&has('rhythmtab','rhythmmid'))return {version:'rhythm',xml:url('rhythmtab'),midi:url('rhythmmid'),tab:true};
      if(has('tab'))return {version:'direct',xml:url('tab'),midi:url('mid'),tab:true};
    }
    return {version:'direct',xml:url('musicxml'),midi:url('mid'),tab:false};
  }

  // Débuts de mesures en secondes (même lecture que tabNotes dans score-player.js).
  function measureTimes(source,bpm){
    const xml=new DOMParser().parseFromString(source,'application/xml');
    const part=xml.querySelector('part');
    if(!part)return [];
    const starts=[];
    let divisions=1,start=0,length=240/bpm;
    for(const measure of part.querySelectorAll(':scope > measure')){
      starts.push(start);
      let position=start,longest=start;
      for(const item of measure.children){
        if(item.tagName==='attributes'){
          divisions=Number(item.querySelector('divisions')?.textContent)||divisions;
          const beats=Number(item.querySelector('time beats')?.textContent),type=Number(item.querySelector('time beat-type')?.textContent);
          if(beats&&type)length=beats*240/(type*bpm);
          continue;
        }
        const duration=Number(item.querySelector(':scope > duration')?.textContent)*60/(divisions*bpm);
        if(!duration)continue;
        if(item.tagName==='backup'){position-=duration;continue;}
        if(item.tagName==='note'&&item.querySelector('chord'))continue;
        if(item.tagName==='note'||item.tagName==='forward'){position+=duration;longest=Math.max(longest,position);}
      }
      start=measure.getAttribute('implicit')==='yes'?longest:start+length;
    }
    return starts;
  }

  function placeOnGuitar(note,capo){
    if(note.string&&OPEN[note.string]!==undefined){
      let fret=note.midi-OPEN[note.string]-capo;
      if(fret<0)fret=note.midi-OPEN[note.string];
      return {...note,fret:Math.max(0,fret)};
    }
    let best=null;
    for(const s of [1,2,3,4,5,6]){
      const fret=note.midi-OPEN[s];
      if(fret>=0&&fret<=15&&(!best||fret<best.fret))best={string:s,fret};
    }
    return {...note,...(best||{string:6,fret:Math.max(0,note.midi-40)})};
  }

  const loaded=new Map();
  function loadScript(src){
    if(!loaded.has(src))loaded.set(src,new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src=src;s.onload=resolve;
      s.onerror=()=>{loaded.delete(src);s.remove();reject(new Error('Script indisponible.'));};
      document.head.append(s);
    }));
    return loaded.get(src);
  }
  async function fetchOk(url,binary,signal){
    const r=await fetch(url,{credentials:'same-origin',signal});
    if(!r.ok)throw new Error('Export indisponible.');
    return binary?r.arrayBuffer():r.text();
  }

  /* ======================================================================= */
  function mount(root,{job,version,backHref}){
    const controller=new AbortController(),{signal}=controller;
    const src=sources(job,version);
    const guitar=job.instrument==='guitare';
    const previewEnd=job.preview_limit?Number(job.preview_duration||job.preview_limit):Infinity;
    const lockedRest=Number.isFinite(previewEnd)&&(job.excerpt||Number(job.duration)>previewEnd+.5);
    const user=window.SongToSheetCurrentUser||{};
    let levels=[],progress={levels:{},xp:0,xp_total:0,streak:{count:0}},bpm=120;
    let disposeLevel=null,mic=null;
    root.className='learn';
    root.innerHTML=`<div class="learn-loading"><span class="learn-spinner" aria-hidden="true"></span><p>${t('Chargement du jeu…')}</p></div>`;

    async function boot(){
      try{
        if(!window.Midi)await loadScript('/api/player-assets?asset=midi&v=2.0.28');
        const [buffer,xml]=await Promise.all([fetchOk(src.midi,true,signal),fetchOk(src.xml,false,signal).catch(()=>null)]);
        if(signal.aborted)return;
        const midi=new window.Midi(buffer);
        bpm=midi.header.tempos[0]?.bpm||120;
        let notes=src.tab&&xml&&window.SongToSheetPlayer?.tabNotes?window.SongToSheetPlayer.tabNotes(xml,bpm):[];
        if(!notes.length)notes=midi.tracks.flatMap(track=>track.notes.map(n=>({time:n.time,midi:n.midi,duration:n.duration,velocity:n.velocity})));
        notes=notes.filter(n=>n.time<previewEnd).map(n=>({time:n.time,midi:n.midi,duration:Math.max(.08,Math.min(n.duration,previewEnd-n.time)),velocity:n.velocity??.7,string:n.string}));
        if(guitar)notes=notes.map(n=>placeOnGuitar(n,Number(job.capo)||0));
        levels=Core.buildLevels(notes,xml?measureTimes(xml,bpm):[],{previewEnd});
        if(!levels.length){showError(t('Aucune note à apprendre dans ce relevé.'));return;}
        await loadProgress();
        renderMap();
      }catch(error){if(!signal.aborted)showError(t('Le jeu ne peut pas charger ce morceau.'));}
    }
    async function loadProgress(){
      try{
        const r=await fetch(`/api/learn?id=${encodeURIComponent(job.id)}&version=${encodeURIComponent(src.version)}&day=${today()}`,{credentials:'same-origin',signal});
        if(r.ok)progress=await r.json();
      }catch{/* Sans progression enregistrée, la carte part de zéro. */}
    }
    function showError(message){
      root.innerHTML=`<div class="learn-loading"><p>${esc(message)}</p><a class="learn-btn learn-btn-light" href="${esc(backHref)}">${t('Retour à la partition')}</a></div>`;
    }

    /* ---------- Règles de déblocage ---------- */
    const regular=()=>levels.filter(l=>!l.boss);
    const state=index=>progress.levels?.[index]||null;
    const done=index=>{const s=state(index);return Boolean(s&&(s.stars>0||s.checked));};
    function unlocked(level){
      if(level.boss)return regular().filter(l=>l.section===level.section).every(l=>done(l.index));
      const list=regular(),position=list.indexOf(level);
      return position===0||done(list[position-1].index);
    }
    function nextLevel(){
      return regular().find(l=>unlocked(l)&&!done(l.index))||levels.find(l=>l.boss&&unlocked(l)&&!done(l.index))||null;
    }
    const levelLabel=l=>l.boss?t('Boss de la section {n}',{n:l.section+1}):t('Niveau {n}',{n:regular().indexOf(l)+1});

    /* ---------- Carte du morceau ---------- */
    function header(){
      const streak=progress.streak?.count||0;
      return `<header class="learn-top">
        <a class="learn-back" href="${esc(backHref)}" data-learn-back>← <span>${t('Partition')}</span></a>
        <div class="learn-top-title"><strong>${esc(job.title||'')}</strong><small>${esc(job.instrument||'')}</small></div>
        <div class="learn-stats"><span class="learn-chip learn-chip-fire" title="${streak} ${t(streak>1?'jours de suite':'jour de suite')}">🔥 <b>${streak}</b></span>
        <span class="learn-chip learn-chip-xp">⚡ <b>${Number(progress.xp_total||0).toLocaleString(lang())}</b> ${t('XP')}</span></div>
      </header>`;
    }
    function node(level){
      const s=state(level.index),open=unlocked(level),finished=done(level.index);
      const current=open&&!finished&&nextLevel()===level;
      const stars=s?.stars||0;
      const cls=['learn-node',level.boss?'is-boss':'',finished?'is-done':'',current?'is-current':'',open?'':'is-locked'].filter(Boolean).join(' ');
      const face=level.boss?'👑':!open?'🔒':finished&&!stars?'✓':current?'▶':String(regular().indexOf(level)+1);
      const starRow=level.boss||!finished?'':`<span class="learn-node-stars" aria-hidden="true">${[1,2,3].map(i=>`<i class="${i<=stars?'on':''}">★</i>`).join('')}</span>`;
      return `<div class="learn-node-wrap"><button type="button" class="${cls}" data-level="${level.index}" ${open?'':'disabled'}
        aria-label="${esc(levelLabel(level))}${finished?' · '+stars+'★':''}"><span class="learn-node-face">${face}</span></button>
        ${starRow}<span class="learn-node-label">${esc(level.boss?t('Boss'):t('Niveau {n}',{n:regular().indexOf(level)+1}))}</span></div>`;
    }
    function renderMap(){
      disposeLevel?.();disposeLevel=null;
      const list=regular(),count=list.filter(l=>done(l.index)).length,percent=Math.round(count/list.length*100);
      const next=nextLevel();
      const sections=[...new Set(levels.map(l=>l.section))];
      const paid=(user.plan||'free')!=='free';
      const lock=lockedRest?`<section class="learn-section learn-section-locked">
          <div class="learn-section-head"><span>${t('Suite du morceau')}</span><small>${clock(previewEnd)} – ${job.duration?clock(job.duration):'…'}</small></div>
          <div class="learn-path learn-path-ghost" aria-hidden="true">${[0,1,2,3].map(()=>'<div class="learn-node-wrap"><span class="learn-node is-locked"><span class="learn-node-face">🔒</span></span></div>').join('')}</div>
          <div class="learn-lock-card"><strong>${t('Tu joues aux {s} premières secondes.',{s:Math.round(previewEnd)})}</strong>
          <p>${paid?t('Le morceau entier est inclus dans ton abonnement.')+' '+t('Génère la suite depuis la partition, puis reviens jouer.'):t('Débloque le morceau entier pour apprendre toute la suite.')}</p>
          ${paid?`<a class="learn-btn" href="${esc(backHref)}" data-learn-back>${t('Générer la suite')} ↗</a>`
            :`<a class="learn-btn" href="/upgrade" data-unlock="${src.tab?'tablature':'partition'}" data-learn-unlock aria-haspopup="dialog">${t('Débloquer la suite du morceau')} ↗</a>`}</div>
        </section>`:'';
      root.innerHTML=`${header()}<div class="learn-scroll"><div class="learn-map">
        <section class="learn-hero">
          <span class="learn-kicker">🎮 ${t('Mode Apprentissage')}</span>
          <h1>${t('Apprends ce son, niveau par niveau')}</h1>
          <p>${t('Joue, gagne des étoiles, débloque la suite : à la fin, tu connais ton morceau.')}</p>
          <div class="learn-progress"><div><span>${t('Progression du morceau')}</span><b>${percent} %</b></div><i><span style="width:${percent}%"></span></i></div>
          ${next?`<button type="button" class="learn-btn learn-btn-big" data-level="${next.index}">▶ ${count?t('Continuer : {x}',{x:esc(levelLabel(next))}):t('Commencer : {x}',{x:esc(levelLabel(next))})}</button>`
            :`<button type="button" class="learn-btn learn-btn-big" data-level="${levels.filter(l=>l.boss).at(-1)?.index??levels.at(-1).index}">👑 ${t('Rejouer le boss')}</button>`}
        </section>
        ${sections.map(s=>{const items=levels.filter(l=>l.section===s);return `<section class="learn-section">
          <div class="learn-section-head"><span>${t('Section {n}',{n:s+1})}</span><small>${clock(items[0].start)} – ${clock(items.at(-1).end)}</small></div>
          <div class="learn-path">${items.map(node).join('')}</div></section>`;}).join('')}
        ${lock}
      </div></div>`;
      root.querySelectorAll('[data-level]').forEach(b=>b.addEventListener('click',()=>openLevel(levels[Number(b.dataset.level)])));
      root.querySelector('[data-learn-unlock]')?.addEventListener('click',()=>{
        fetch('/api/learn',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'unlock',id:job.id,version:src.version})}).catch(()=>{});
      });
      requestAnimationFrame(drawPaths);
      root.querySelector('.learn-node.is-current')?.scrollIntoView({block:'center',behavior:reduced()?'auto':'smooth'});
    }
    // Chemin pointillé entre les pastilles de chaque section.
    function drawPaths(){
      for(const path of root.querySelectorAll('.learn-path')){
        path.querySelector('svg')?.remove();
        const box=path.getBoundingClientRect();
        const points=[...path.querySelectorAll('.learn-node')].map(n=>{const r=n.getBoundingClientRect();return [r.left+r.width/2-box.left,r.top+r.height/2-box.top];});
        if(points.length<2)continue;
        let d=`M${points[0][0]} ${points[0][1]}`;
        for(let i=1;i<points.length;i++){const [x0,y0]=points[i-1],[x1,y1]=points[i],my=(y0+y1)/2;d+=` C${x0} ${my} ${x1} ${my} ${x1} ${y1}`;}
        path.insertAdjacentHTML('beforeend',`<svg class="learn-path-line" width="${box.width}" height="${box.height}" aria-hidden="true"><path d="${d}"/></svg>`);
      }
    }
    const onResize=()=>{if(!disposeLevel)drawPaths();};
    window.addEventListener('resize',onResize);

    /* ---------- Micro ---------- */
    const micChoice=()=>{try{return localStorage.getItem(MIC_KEY);}catch{return null;}};
    const setMicChoice=v=>{try{localStorage.setItem(MIC_KEY,v);}catch{}};
    async function ensureMic(overlay){
      if(mic?.running)return true;
      if(micChoice()==='off')return false;
      if(!Audio.MicListener.supported()){setMicChoice('off');return false;}
      const choice=await card(overlay,`<span class="learn-card-icon">🎙️</span><h2>${t('Joue avec ton instrument')}</h2>
        <p>${t('Tablurio écoute ton instrument pour valider tes notes. Rien n’est enregistré ni envoyé.')}</p>
        <p class="learn-card-hint">🎧 ${t('Avec des écouteurs, c’est encore plus précis.')}</p>`,
        [['on',t('Activer le micro'),true],['off',t('Jouer sans micro')]]);
      if(choice!=='on'){setMicChoice('off');return false;}
      return calibrate(overlay);
    }
    async function calibrate(overlay){
      try{
        mic=mic||new Audio.MicListener();
        await mic.start();
      }catch{
        mic=null;setMicChoice('off');
        await card(overlay,`<span class="learn-card-icon">🎙️</span><h2>${t('Micro indisponible')}</h2><p>${t('Le navigateur n’a pas donné accès au micro. Tu peux jouer sans micro.')}</p>`,[['off',t('Jouer sans micro'),true]]);
        return false;
      }
      for(;;){
        overlay.innerHTML=`<div class="learn-card"><span class="learn-card-icon learn-pulse">🎸</span><h2>${t('Joue une note')}</h2>
          <p>${t('Gratte une corde ou appuie sur une touche, on règle l’écoute.')}</p><div class="learn-meter"><span></span></div></div>`;
        overlay.hidden=false;
        const bar=overlay.querySelector('.learn-meter span');
        const off=mic.onFrame(f=>{bar.style.width=Math.min(100,f.level*900)+'%';});
        const result=await mic.calibrate(5000);
        off();
        if(signal.aborted)return false;
        if(result.ok){overlay.hidden=true;setMicChoice('on');return true;}
        const again=await card(overlay,`<span class="learn-card-icon">🤔</span><h2>${t('On n’a rien entendu')}</h2><p>${t('Rapproche-toi du micro ou joue plus fort, puis réessaie.')}</p>`,
          [['retry',t('Réessayer'),true],['off',t('Jouer sans micro')]]);
        if(again!=='retry'){mic.stop();mic=null;setMicChoice('off');return false;}
      }
    }
    function card(overlay,html,buttons){
      return new Promise(resolve=>{
        overlay.innerHTML=`<div class="learn-card">${html}<div class="learn-card-actions">${buttons.map(([v,label,primary])=>
          `<button type="button" class="learn-btn ${primary?'':'learn-btn-ghost'}" data-choice="${v}">${label}</button>`).join('')}</div></div>`;
        overlay.hidden=false;
        overlay.querySelector('[data-choice]')?.focus({preventScroll:true});
        overlay.querySelectorAll('[data-choice]').forEach(b=>b.addEventListener('click',()=>{overlay.hidden=true;resolve(b.dataset.choice);},{once:true}));
      });
    }

    /* ---------- Un niveau ---------- */
    function openLevel(level){
      if(!level||!unlocked(level))return;
      disposeLevel?.();
      disposeLevel=playLevel(level);
    }

    function playLevel(level){
      const attacks=Core.groupAttacks(level.notes);
      const beat=60/bpm;
      const s=state(level.index);
      let phase=level.boss?'challenge':'listen';
      let speed=Math.max(Core.SPEEDS[0],s?.best_speed||Core.SPEEDS[0]);
      let guide=false,micOn=mic?.running&&micChoice()==='on';
      root.innerHTML=`${header()}<div class="learn-level">
        <div class="learn-level-bar">
          <button type="button" class="learn-back" data-map>← <span>${t('Carte')}</span></button>
          <strong>${esc(levelLabel(level))}</strong>
          <ol class="learn-steps">${level.boss?`<li class="is-active">👑 ${t('Défi')}</li>`:
            ['Écoute','Entraîne','Défi'].map((p,i)=>`<li data-step="${['listen','train','challenge'][i]}"><b>${i+1}</b> ${t(p)}</li>`).join('')}</ol>
          <div class="learn-level-tools">
            <span class="learn-mic" hidden title="${t('Micro')}">🎙️<i><span></span></i></span>
            <button type="button" class="learn-toggle" data-guide aria-pressed="false">🎧 ${t('Son guide')}</button>
          </div>
        </div>
        <div class="learn-stage"><canvas></canvas>
          <div class="learn-hud"><div><small>${t('Score')}</small><b data-score>0</b></div><div class="learn-combo"><small>${t('Combo')}</small><b data-combo>0</b><em data-mult hidden></em></div>
            <div class="learn-count"><b data-count></b></div></div>
          <div class="learn-overlay" hidden></div>
          <div class="learn-confetti" aria-hidden="true"></div>
        </div>
        <div class="learn-panel" aria-live="polite"></div>
      </div>`;
      const get=q=>root.querySelector(q);
      const canvas=get('canvas'),ctx2d=canvas.getContext('2d'),stage=get('.learn-stage'),overlay=get('.learn-overlay'),panel=get('.learn-panel');
      const hud={score:get('[data-score]'),combo:get('[data-combo]'),mult:get('[data-mult]'),count:get('[data-count]')};
      const micBadge=get('.learn-mic'),micBar=get('.learn-mic span'),guideButton=get('[data-guide]');
      get('[data-map]').onclick=()=>{renderMap();};

      /* --- son --- */
      let audio,samples,sampleLoad;
      const profile=PROFILES[job.instrument]||PROFILES.piano;
      function audioContext(){
        if(!audio){const C=window.AudioContext||window.webkitAudioContext;audio=new C();}
        if(audio.state==='suspended')audio.resume().catch(()=>{});
        return audio;
      }
      function loadSamples(){
        sampleLoad??=Promise.all(profile.pitches.map(async p=>{
          const bytes=await fetchOk(new URL(profile.folder+p+'.mp3',SOUNDS),true,signal);
          return [p,await audioContext().decodeAudioData(bytes)];
        })).then(list=>{samples=new Map(list);}).catch(()=>{samples=null;});
        return sampleLoad;
      }
      const live=new Set();
      function playNote(midi,when,length,velocity=.7){
        const ac=audioContext(),gain=ac.createGain();
        let node;
        if(samples){
          const pitch=profile.pitches.reduce((a,b)=>Math.abs(b-midi)<Math.abs(a-midi)?b:a);
          node=ac.createBufferSource();node.buffer=samples.get(pitch);node.playbackRate.value=2**((midi-pitch)/12);
          gain.gain.setValueAtTime(profile.volume*velocity,when);
        }else{
          node=ac.createOscillator();node.type='triangle';node.frequency.value=440*2**((midi-69)/12);
          gain.gain.setValueAtTime(.06*velocity,when);
        }
        gain.gain.exponentialRampToValueAtTime(.0001,when+Math.max(.1,length)+profile.release);
        node.connect(gain).connect(ac.destination);
        node.start(when);node.stop(when+Math.max(.1,length)+profile.release+.02);
        live.add(node);node.onended=()=>{live.delete(node);node.disconnect();gain.disconnect();};
      }
      function click(when,accent){
        const ac=audioContext(),osc=ac.createOscillator(),gain=ac.createGain();
        osc.frequency.value=accent?1600:1100;gain.gain.setValueAtTime(.12,when);gain.gain.exponentialRampToValueAtTime(.0001,when+.05);
        osc.connect(gain).connect(ac.destination);osc.start(when);osc.stop(when+.06);
        live.add(osc);osc.onended=()=>{live.delete(osc);osc.disconnect();gain.disconnect();};
      }
      const silence=()=>{for(const n of live){try{n.stop();}catch{}}live.clear();};

      /* --- horloge et état du jeu --- */
      const LEAD=3*beat;
      let songTime=level.start-LEAD,running=false,raf=0,lastFrame=0,clockStart=0,audioStart=0,mode=null;
      let marks=new Map(),score=0,combo=0,bestCombo=0,waitIndex=0,wrong=0,matchMs=0,onsetSinceWait=false,lastOnset=-1,detected=null,finishing=false;
      const particles=[],pops=[];
      const perfNow=()=>performance.now()/1000;
      function resetRun(){marks=new Map();score=0;combo=0;bestCombo=0;waitIndex=0;wrong=0;matchMs=0;onsetSinceWait=false;finishing=false;updateHud();}
      function updateHud(){
        hud.score.textContent=score.toLocaleString(lang());
        hud.combo.textContent=combo;
        const m=Core.multiplier(combo);hud.mult.hidden=m<2;hud.mult.textContent='×'+m;
        const hits=[...marks.values()].filter(v=>v!=='miss').length;
        hud.count.textContent=t('{a} sur {b} notes',{a:hits,b:attacks.length});
      }

      /* --- rendu --- */
      let width=0,height=0,dpr=1;
      const resize=()=>{
        dpr=Math.min(2,window.devicePixelRatio||1);
        width=stage.clientWidth;height=stage.clientHeight;
        canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
        canvas.style.width=width+'px';canvas.style.height=height+'px';
        draw();
      };
      const observer=new ResizeObserver(resize);observer.observe(stage);
      const span=Math.max(...level.notes.map(n=>n.midi))-Math.min(...level.notes.map(n=>n.midi));
      const mid=(Math.max(...level.notes.map(n=>n.midi))+Math.min(...level.notes.map(n=>n.midi)))/2;
      const lo=Math.floor(mid-Math.max(span/2+2,12)),hi=Math.ceil(mid+Math.max(span/2+2,12));
      const black=m=>[1,3,6,8,10].includes(((m%12)+12)%12);
      const whites=[];for(let m=lo;m<=hi;m++)if(!black(m))whites.push(m);
      function keyRect(m,kbTop,kbH){
        const w=width/whites.length;
        if(!black(m)){const i=whites.indexOf(m);return {x:i*w,w,y:kbTop,h:kbH};}
        const left=whites.indexOf(m-1);return {x:(left+1)*w-w*.32,w:w*.64,y:kbTop,h:kbH*.62};
      }
      const window_=()=>3.2;          // secondes de morceau visibles devant la ligne
      function draw(){
        if(!width)return;
        const c=ctx2d;c.setTransform(dpr,0,0,dpr,0,0);
        const g=c.createLinearGradient(0,0,width,height);g.addColorStop(0,'#0b0817');g.addColorStop(1,'#160d33');
        c.fillStyle=g;c.fillRect(0,0,width,height);
        const now=songTime,ahead=window_();
        const waitAttack=mode==='train'?attacks[waitIndex]:null;
        if(guitar){
          const hitX=Math.min(140,width*.2),top=height*.18,bottom=height*.86,gap=(bottom-top)/5,pps=(width-hitX)/ahead;
          // mesures
          c.strokeStyle='rgba(174,138,246,.10)';c.lineWidth=1;
          for(let b=Math.ceil((now-1)/beat)*beat;b<now+ahead;b+=beat){const x=hitX+(b-now)*pps;c.beginPath();c.moveTo(x,top-14);c.lineTo(x,bottom+14);c.stroke();}
          ['e','B','G','D','A','E'].forEach((name,i)=>{
            const y=top+i*gap;c.strokeStyle=`rgba(226,215,255,${.22+i*.05})`;c.lineWidth=1+i*.35;
            c.beginPath();c.moveTo(0,y);c.lineTo(width,y);c.stroke();
            c.fillStyle='rgba(207,188,255,.55)';c.font='600 12px Inter,sans-serif';c.textAlign='left';c.fillText(name,8,y-6);
          });
          glowLine(c,hitX,top-24,hitX,bottom+24);
          attacks.forEach((a,i)=>{
            const x=hitX+(a.time-now)*pps;if(x<-40||x>width+40)return;
            const mark=marks.get(i);
            for(const n of a.notes){
              const y=top+(n.string-1)*gap,r=Math.max(13,Math.min(19,gap*.38));
              const len=Math.max(0,n.duration*pps-r);
              c.fillStyle=mark==='miss'?'rgba(255,107,138,.18)':mark?'rgba(42,197,139,.22)':'rgba(140,99,255,.22)';
              roundRect(c,x,y-5,len,10,5);c.fill();
              disc(c,x,y,r,mark==='miss'?'#5a2a3c':mark?'#2ac58b':'#7549eb',mark?null:'#b694ff',waitAttack===a);
              c.fillStyle='#fff';c.font=`800 ${Math.round(r*.95)}px Inter,sans-serif`;c.textAlign='center';c.textBaseline='middle';
              c.fillText(String(n.fret),x,y+1);c.textBaseline='alphabetic';
            }
            if(waitAttack===a&&wrong>=3)hint(c,x,top-30,a);
          });
        }else{
          const kbH=Math.min(130,height*.26),kbTop=height-kbH,hitY=kbTop-2,pps=(hitY-20)/ahead;
          c.strokeStyle='rgba(174,138,246,.08)';
          for(const m of whites){const r=keyRect(m,kbTop,kbH);c.beginPath();c.moveTo(r.x,0);c.lineTo(r.x,kbTop);c.stroke();}
          attacks.forEach((a,i)=>{
            const mark=marks.get(i);
            for(const n of a.notes){
              if(n.midi<lo||n.midi>hi)continue;
              const r=keyRect(n.midi,kbTop,kbH),y1=hitY-(n.time-now)*pps,y0=y1-Math.max(14,n.duration*pps);
              if(y1<-10||y0>hitY+40)continue;
              const fill=c.createLinearGradient(0,y0,0,y1);
              if(mark==='miss'){fill.addColorStop(0,'#5a2a3c');fill.addColorStop(1,'#7a3550');}
              else if(mark){fill.addColorStop(0,'#1f9e70');fill.addColorStop(1,'#2ac58b');}
              else{fill.addColorStop(0,'#5b34cf');fill.addColorStop(1,'#a27bff');}
              c.fillStyle=fill;roundRect(c,r.x+2,y0,r.w-4,y1-y0,6);c.fill();
              if(waitAttack===a){c.strokeStyle='#efe3ff';c.lineWidth=2;roundRect(c,r.x+2,y0,r.w-4,y1-y0,6);c.stroke();}
            }
            if(waitAttack===a&&wrong>=3){const r=keyRect(a.midis[0],kbTop,kbH);hint(c,r.x+r.w/2,hitY-60,a);}
          });
          glowLine(c,0,hitY,width,hitY);
          const pressed=new Set();
          attacks.forEach((a,i)=>{const m=marks.get(i);if(m&&m!=='miss'&&now-a.time<.25&&now>=a.time)a.midis.forEach(x=>pressed.add(x));});
          const expected=new Set(waitAttack?waitAttack.midis:[]);
          for(const pass of [false,true])for(let m=lo;m<=hi;m++){
            if(black(m)!==pass)continue;
            const r=keyRect(m,kbTop,kbH);
            c.fillStyle=pressed.has(m)?'#2ac58b':expected.has(m)?'#a567ff':pass?'#2b2640':'#f1eff7';
            roundRect(c,r.x+.5,r.y,r.w-1,r.h,pass?3:5);c.fill();
            if(!pass&&m%12===0){c.fillStyle='rgba(60,50,80,.6)';c.font='600 10px Inter,sans-serif';c.textAlign='center';c.fillText(noteName(m)+(Math.floor(m/12)-1),r.x+r.w/2,kbTop+kbH-8);}
          }
        }
        // compte à rebours
        if(running&&mode!=='train'&&songTime<level.start){
          const left=Math.ceil((level.start-songTime)/beat);
          if(left>=1&&left<=3){c.fillStyle='rgba(255,255,255,.92)';c.font='900 72px Inter,sans-serif';c.textAlign='center';c.fillText(String(left),width/2,height/2+24);}
        }
        // particules et textes
        for(const p of particles){c.globalAlpha=Math.max(0,p.life);c.fillStyle=p.color;c.beginPath();c.arc(p.x,p.y,p.size,0,Math.PI*2);c.fill();}
        c.globalAlpha=1;
        for(const p of pops){c.globalAlpha=Math.max(0,p.life);c.fillStyle=p.color;c.font='900 22px Inter,sans-serif';c.textAlign='center';c.fillText(p.text,p.x,p.y);}
        c.globalAlpha=1;
        if(detected&&mode&&mode!=='listen'){
          c.fillStyle='rgba(207,188,255,.75)';c.font='600 12px Inter,sans-serif';c.textAlign='right';
          c.fillText(t('Tu joues :')+' '+detected,width-12,guitar?height-10:22);
        }
      }
      function glowLine(c,x0,y0,x1,y1){
        c.save();c.shadowColor='#a27bff';c.shadowBlur=18;c.strokeStyle='#b694ff';c.lineWidth=3;
        c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();c.restore();
      }
      function disc(c,x,y,r,fill,ring,focus){
        c.save();
        if(focus){c.shadowColor='#d9c8ff';c.shadowBlur=22;}
        c.fillStyle=fill;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();
        if(ring){c.strokeStyle=ring;c.lineWidth=2;c.stroke();}
        c.restore();
      }
      function roundRect(c,x,y,w,h,r){
        r=Math.max(0,Math.min(r,Math.abs(w)/2,Math.abs(h)/2));
        c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();
      }
      function hint(c,x,y,a){
        const text=guitar?a.notes.map(n=>t('corde {s} · case {f}',{s:n.string,f:n.fret})).join(' + '):a.midis.map(noteName).join(' + ');
        c.font='700 13px Inter,sans-serif';const w=c.measureText(text).width+20;
        c.fillStyle='#fff';roundRect(c,x-w/2,y-20,w,28,10);c.fill();
        c.fillStyle='#4a2aa8';c.textAlign='center';c.fillText(text,x,y-1);
      }
      function burst(i,good){
        if(reduced())return;
        const a=attacks[i];
        let x,y;
        if(guitar){const hitX=Math.min(140,width*.2),top=height*.18,gap=(height*.86-top)/5;x=hitX;y=top+(a.notes[0].string-1)*gap;}
        else{const kbH=Math.min(130,height*.26);const r=keyRect(Math.min(hi,Math.max(lo,a.midis[0])),height-kbH,kbH);x=r.x+r.w/2;y=height-kbH;}
        const colors=good?['#2ac58b','#a7f3d0','#b694ff','#fff']:['#ff6b8a'];
        for(let k=0;k<(good?16:6);k++){const ang=Math.random()*Math.PI*2,v=60+Math.random()*180;
          particles.push({x,y,vx:Math.cos(ang)*v,vy:Math.sin(ang)*v-60,life:1,size:2+Math.random()*3,color:colors[k%colors.length]});}
        return {x,y};
      }
      function pop(text,color,x,y){pops.push({text,color,x,y:y-24,life:1});}

      /* --- micro --- */
      let offMic=null;
      function listenMic(){
        offMic?.();offMic=null;
        micOn=Boolean(mic?.running)&&micChoice()==='on';
        micBadge.hidden=!micOn;
        if(!micOn)return;
        offMic=mic.onFrame(frame=>{
          micBar.style.width=Math.min(100,frame.level*900)+'%';
          detected=frame.pitch?noteName(Audio.midiOf(frame.pitch)):null;
          onFrame(frame,perfNow()-.06);
        });
      }
      const matches=(frame,a)=>{
        if(a.midis.length===1)return Audio.matchesNote(frame.pitch,a.midis[0]);
        if(Audio.matchesChord(frame.chroma,a.midis))return true;
        // Doute sur un accord de deux notes : on donne le point si une des deux sonne juste.
        return a.midis.length<=2&&a.midis.some(m=>Audio.matchesNote(frame.pitch,m));
      };
      const repeated=i=>i>0&&attacks[i-1].midis.join()===attacks[i].midis.join();
      function onFrame(frame,at){
        if(frame.onset){lastOnset=at;onsetSinceWait=true;}
        if(!running)return;
        if(mode==='train'){
          const a=attacks[waitIndex];
          if(!a||songTime<a.time-.02)return;
          if(matches(frame,a)){matchMs+=16;if(matchMs>=120&&(onsetSinceWait||!repeated(waitIndex)))validate(waitIndex,'good');}
          else{matchMs=Math.max(0,matchMs-8);if(frame.onset&&frame.pitch)wrong++;}
        }else if(mode==='challenge'){
          const time=songTime-(perfNow()-at)*speed;
          for(let i=0;i<attacks.length;i++){
            if(marks.has(i))continue;
            const delta=(time-attacks[i].time)/speed;
            if(delta<-.16)break;
            if(delta>.16)continue;
            if(matches(frame,attacks[i])&&(at-lastOnset<.25||!repeated(i))){grade(i,Core.judge(delta));break;}
          }
        }
      }
      function validate(i,quality){
        marks.set(i,quality);combo++;bestCombo=Math.max(bestCombo,combo);score+=70*Core.multiplier(combo);
        const at=burst(i,true);if(at)pop('✓','#2ac58b',at.x,at.y);
        if(guide)attacks[i].notes.forEach(n=>playNote(n.midi,audioContext().currentTime,.6,n.velocity));
        waitIndex++;wrong=0;matchMs=0;onsetSinceWait=false;updateHud();
      }
      function grade(i,quality){
        marks.set(i,quality);
        if(quality==='miss'){combo=0;const at=burst(i,false);if(at)pop(t('Raté'),'#ff6b8a',at.x,at.y);}
        else{combo++;bestCombo=Math.max(bestCombo,combo);score+=(quality==='perfect'?100:70)*Core.multiplier(combo);
          const at=burst(i,true);if(at)pop(quality==='perfect'?t('Parfait !'):t('Bien'),quality==='perfect'?'#ffd166':'#2ac58b',at.x,at.y);}
        updateHud();
      }

      /* --- boucle --- */
      function start(newMode,{withAudio}){
        cancelAnimationFrame(raf);silence();resetRun();
        mode=newMode;running=true;
        const rate=newMode==='listen'?Core.LISTEN_SPEED:speed;
        songTime=level.start-(newMode==='train'?.8:LEAD);
        const ac=audioContext();
        clockStart=perfNow();audioStart=ac.currentTime+.05;
        const at=song=>audioStart+(song-songTime)/rate;
        const origin=songTime;
        if(withAudio)for(const n of level.notes)playNote(n.midi,at(n.time),n.duration/rate,n.velocity);
        if(newMode!=='train'){
          for(let b=Math.ceil(origin/beat)*beat;b<level.end;b+=beat){
            const count=b<level.start;
            if(count||(newMode==='challenge'&&micOn))click(at(b),count&&Math.abs(b-level.start)<1e-6);
          }
        }
        lastFrame=perfNow();
        const tick=()=>{
          const now=perfNow(),dt=Math.min(.05,now-lastFrame);lastFrame=now;
          if(mode==='train'){
            const a=attacks[waitIndex];
            if(!a){songTime=Math.min(level.end,songTime+dt*speed);if(songTime>=Math.min(level.end,attacks.at(-1).time+.8))finish();}
            else songTime=Math.min(a.time,songTime+dt*.6);
          }else songTime=origin+(now-clockStart)*rate;
          if(mode==='challenge'){
            attacks.forEach((a,i)=>{if(!marks.has(i)&&(songTime-a.time)/speed>.16&&micOn)grade(i,'miss');});
          }
          for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=380*dt;p.life-=dt*1.6;}
          for(const p of pops){p.y-=40*dt;p.life-=dt*1.4;}
          while(particles.length&&particles[0].life<=0)particles.shift();
          while(pops.length&&pops[0].life<=0)pops.shift();
          draw();
          if(mode!=='train'&&songTime>=level.end+.3){finish();return;}
          if(running)raf=requestAnimationFrame(tick);
        };
        raf=requestAnimationFrame(tick);
      }
      function stop(){running=false;cancelAnimationFrame(raf);silence();}
      function finish(){
        if(finishing)return;finishing=true;
        const finished=mode;stop();draw();
        if(finished==='listen')showPhase('listen',true);
        else if(finished==='train'){markStep('train');showPhase('challenge');}
        else if(finished==='challenge'){
          if(micOn){const hits=[...marks.values()].filter(v=>v!=='miss').length;report(hits/attacks.length,true);}
          else showPhase('challenge',true);
        }
      }

      /* --- phases --- */
      function markStep(step){
        root.querySelectorAll('[data-step]').forEach(li=>{
          const order=['listen','train','challenge'];
          li.classList.toggle('is-done',order.indexOf(li.dataset.step)<order.indexOf(step));
          li.classList.toggle('is-active',li.dataset.step===step);
        });
      }
      function speedChips(){
        return `<div class="learn-speed" role="group" aria-label="${t('Vitesse')}"><span>${t('Vitesse')}</span>${Core.SPEEDS.map(v=>
          `<button type="button" data-speed="${v}" aria-pressed="${v===speed}">${fmtSpeed(v)}</button>`).join('')}</div>`;
      }
      function showPhase(name,after=false){
        phase=name;markStep(name);
        const noMic=!(mic?.running&&micChoice()==='on');
        let html;
        if(name==='listen'){
          html=`<div><h2>${t('Étape 1 · Écoute')}</h2><p>${t('Écoute le passage et regarde les notes arriver sur la ligne.')}</p></div>
            <div class="learn-panel-actions"><button type="button" class="learn-btn" data-go="listen">🔊 ${after?t('Réécouter'):t('Écouter')}</button>
            <button type="button" class="learn-btn ${after?'':'learn-btn-ghost'}" data-go="to-train">${after?t('Je suis prêt'):t('Passer')} →</button></div>`;
        }else if(name==='train'){
          html=`<div><h2>${t('Étape 2 · Entraîne')}</h2><p>${noMic?t('Clique ou appuie sur Espace quand tu as joué la note.'):t('Joue chaque note à ton rythme : le jeu t’attend et avance dès qu’il t’entend.')}</p></div>
            <div class="learn-panel-actions"><button type="button" class="learn-btn" data-go="train">▶ ${t('Commencer')}</button>
            <button type="button" class="learn-btn learn-btn-ghost" data-go="to-challenge">${t('Passer')} →</button></div>`;
        }else{
          const boss=level.boss;
          html=`<div><h2>${boss?'👑 '+esc(levelLabel(level)):t('Étape 3 · Défi')}</h2><p>${boss?t('Joue toute la section d’une traite, à vitesse réelle.'):t('Joue le passage en rythme. Parfait, Bien ou Raté : chaque note compte.')}</p>
            ${noMic?`<p class="learn-nomic">🎙️ ${t('Active le micro pour gagner des étoiles.')} <button type="button" data-go="mic">${t('Activer le micro')}</button></p>`:''}</div>
            <div class="learn-panel-actions">${speedChips()}
            ${noMic&&after?`<button type="button" class="learn-btn" data-go="checked">${t('Je l’ai joué ✓')}</button>
              <button type="button" class="learn-btn learn-btn-ghost" data-go="challenge">${t('Rejouer')}</button>`
            :`<button type="button" class="learn-btn" data-go="challenge">${noMic?'▶ '+t('Lancer le passage'):boss?'👑 '+t('Affronter le boss'):'🔥 '+t('Lancer le défi')}</button>`}</div>`;
        }
        panel.innerHTML=html;
        panel.querySelectorAll('[data-speed]').forEach(b=>b.onclick=()=>{speed=Number(b.dataset.speed);
          panel.querySelectorAll('[data-speed]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});
        panel.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>action(b.dataset.go));
        draw();
      }
      async function action(go){
        if(go==='listen'){await loadSamples();start('listen',{withAudio:true});panel.innerHTML=`<div><h2>🔊 ${t('Écouter le passage')}</h2></div>`;return;}
        if(go==='to-train'){markStep('train');stop();showPhase('train');return;}
        if(go==='to-challenge'){stop();showPhase('challenge');return;}
        if(go==='mic'){try{localStorage.removeItem(MIC_KEY);}catch{}await ensureMic(overlay);listenMic();showPhase(phase);return;}
        if(go==='checked'){report(1,false);return;}
        if(go==='train'||go==='challenge'){
          await ensureMic(overlay);listenMic();
          const noMic=!micOn;
          if(guide||noMic||go==='challenge')await loadSamples();
          panel.innerHTML=`<div><h2>${go==='train'?t('Étape 2 · Entraîne'):level.boss?'👑 '+esc(levelLabel(level)):t('Étape 3 · Défi')}</h2>
            <p>${go==='train'&&noMic?t('Clique ou appuie sur Espace quand tu as joué la note.'):t('Prêt ?')}</p></div>
            ${go==='train'&&noMic?`<div class="learn-panel-actions"><button type="button" class="learn-btn" data-tap>✓ ${t('Note jouée')}</button></div>`:''}`;
          panel.querySelector('[data-tap]')?.addEventListener('click',tap);
          start(go,{withAudio:go==='challenge'&&(guide||noMic)});
        }
      }
      function tap(){
        if(mode!=='train'||!running)return;
        const a=attacks[waitIndex];
        if(a&&songTime>=a.time-.02)validate(waitIndex,'good');
      }
      const onKey=e=>{if(e.code==='Space'&&mode==='train'&&!micOn&&running){e.preventDefault();tap();}};
      document.addEventListener('keydown',onKey);
      guideButton.onclick=()=>{guide=!guide;guideButton.setAttribute('aria-pressed',String(guide));if(guide)loadSamples();};

      /* --- résultat --- */
      async function report(accuracy,withMic){
        stop();
        const stars=withMic?Core.starsFor(accuracy,speed):0;
        let saved=null,failed=false;
        try{
          const r=await fetch('/api/learn',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({action:'result',id:job.id,version:src.version,level:level.index,boss:level.boss,notes:attacks.length,
              accuracy,speed,mic:withMic,day:today(),end:level.end})});
          if(r.ok)saved=await r.json();else failed=true;
        }catch{failed=true;}
        if(saved){
          progress.levels={...progress.levels,[level.index]:saved.level};
          progress.xp_total=saved.xp_total;progress.streak=saved.streak;
        }
        const gained=saved?.xp_gained??0;
        const title=!withMic?t('Validé ✓'):stars===3?t('Parfait, tu maîtrises ce passage !'):stars===2?t('Bien joué !'):stars===1?t('Pas mal, continue !'):t('Encore un essai');
        const list=regular(),pos=list.indexOf(level),boss=levels.find(l=>l.boss&&l.section===level.section);
        // Après le dernier niveau d'une section : son boss. Après un boss : la section suivante.
        const next=level.boss?levels.find(l=>!l.boss&&l.section===level.section+1):
          boss&&(!list[pos+1]||list[pos+1].section!==level.section)&&unlocked(boss)?boss:list[pos+1];
        const canNext=next&&unlocked(next);
        overlay.innerHTML=`<div class="learn-card learn-result ${stars===3?'is-perfect':''}">
          ${withMic?`<div class="learn-result-stars">${[1,2,3].map(i=>`<span class="${i<=stars?'on':''}" style="--i:${i}">★</span>`).join('')}</div>`:'<span class="learn-card-icon">✅</span>'}
          <h2>${title}</h2>
          ${withMic?`<dl class="learn-result-stats"><div><dt>${t('Précision')}</dt><dd>${Math.round(accuracy*100)} %</dd></div>
            <div><dt>${t('Meilleur combo')}</dt><dd>${bestCombo}</dd></div><div><dt>${t('Score')}</dt><dd>${score.toLocaleString(lang())}</dd></div></dl>`
            :`<p>${t('Passage validé sans micro.')} ${t('Active le micro pour gagner des étoiles.')}</p>`}
          ${withMic&&!stars?`<p>${t('Il faut 60 % de notes justes pour débloquer la suite.')}</p>`:''}
          ${withMic&&stars===2&&speed<1&&accuracy>=.95?`<p>${t('Passe à 1× pour viser la 3ᵉ étoile.')}</p>`:''}
          <div class="learn-result-gains">${gained?`<span class="learn-chip learn-chip-xp">${t('+{x} XP',{x:gained})}</span>`:''}
            ${saved?`<span class="learn-chip learn-chip-fire">${t('Série : {n} 🔥',{n:saved.streak?.count||0})}</span>`:''}</div>
          ${failed?`<p class="learn-error">${t('Enregistrement impossible : ta progression n’a pas été sauvegardée.')}</p>`:''}
          <div class="learn-card-actions">
            <button type="button" class="learn-btn ${canNext&&(stars||!withMic)?'learn-btn-ghost':''}" data-r="again">↻ ${t('Rejouer')}</button>
            ${canNext&&(stars||!withMic)?`<button type="button" class="learn-btn" data-r="next">${t('Niveau suivant')} →</button>`:''}
            <button type="button" class="learn-btn learn-btn-ghost" data-r="map">${t('Carte')}</button></div></div>`;
        overlay.hidden=false;
        if(stars===3)confetti();
        overlay.querySelector('[data-r="again"]').onclick=()=>{overlay.hidden=true;showPhase('challenge');};
        overlay.querySelector('[data-r="next"]')?.addEventListener('click',()=>openLevel(next));
        overlay.querySelector('[data-r="map"]').onclick=()=>renderMap();
        overlay.querySelector('.learn-card-actions .learn-btn:not(.learn-btn-ghost)')?.focus({preventScroll:true});
        const top=root.querySelector('.learn-top');
        if(top)top.outerHTML=header();
      }
      function confetti(){
        if(reduced())return;
        const box=get('.learn-confetti'),colors=['#7549eb','#b694ff','#2ac58b','#ffd166','#ff8fab','#fff'];
        box.innerHTML=Array.from({length:70},(_,i)=>`<i style="left:${Math.random()*100}%;background:${colors[i%colors.length]};
          animation-delay:${Math.random()*.5}s;animation-duration:${1.6+Math.random()*1.4}s;transform:rotate(${Math.random()*360}deg)"></i>`).join('');
        setTimeout(()=>{box.innerHTML='';},3600);
      }

      // Debug local : injecte une détection (console) — TablurioLearn._debugFeed([64]).
      if(/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
        window.TablurioLearn._debugFeed=midis=>{
          const chroma=new Float32Array(12);midis.forEach(m=>{chroma[((m%12)+12)%12]=1;});
          const pitch=440*2**((midis[0]-69)/12);
          for(let k=0;k<10;k++)setTimeout(()=>onFrame({pitch,chroma,onset:k===0,level:.2},perfNow()),k*16);
        };
        window.TablurioLearn._debugExpected=()=>{
          if(mode==='train')return attacks[waitIndex]?.midis||null;
          const i=attacks.findIndex((x,k)=>!marks.has(k)&&Math.abs(x.time-songTime)/speed<.08);
          return i>=0?attacks[i].midis:null;
        };
      }

      listenMic();
      showPhase(phase);
      resize();
      return ()=>{
        stop();observer.disconnect();offMic?.();document.removeEventListener('keydown',onKey);
        if(audio&&audio.state!=='closed')audio.close().catch(()=>{});
      };
    }

    function back(e){
      // Le lien garde son href (nouvel onglet possible) ; sinon le routeur de l'app s'en charge.
      if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
      e.preventDefault();
      root.dispatchEvent(new CustomEvent('learn:back',{bubbles:true}));
    }
    root.addEventListener('click',e=>{const a=e.target.closest('[data-learn-back]');if(a)back(e);});

    boot();
    return ()=>{
      controller.abort();disposeLevel?.();disposeLevel=null;mic?.stop();mic=null;
      window.removeEventListener('resize',onResize);root.innerHTML='';
    };
  }

  window.TablurioLearn={mount,sources};
})();

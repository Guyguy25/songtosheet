(() => {
  'use strict';
  const scripts=new Map();
  const samples=new URL('sounds/',document.currentScript.src);
  const soundProfiles={
    guitare:{folder:'guitar-steel/',pitches:[40,45,50,55,59,64,69,74,79,83,88],label:'Son de guitare acoustique',volume:.5,release:.06},
    piano:{folder:'piano-grand/',pitches:[21,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108],label:'Son de piano à queue',volume:.27,release:.18}
  };
  const instrumentLabels={guitare:'Guitare acoustique',basse:'Basse',piano:'Piano',voix:'Voix'};
  const loadScript=(asset,version)=>{
    if(!scripts.has(asset))scripts.set(asset,new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=`/api/player-assets?asset=${asset}&v=${version}`;
      script.onload=resolve;
      script.onerror=()=>{scripts.delete(asset);script.remove();reject(new Error('Lecteur indisponible.'));};
      document.head.append(script);
    }));
    return scripts.get(asset);
  };
  const time=value=>`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
  const svg=(name,attributes)=>{
    const node=document.createElementNS('http://www.w3.org/2000/svg',name);
    for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);
    return node;
  };
  async function read(url,signal,binary=false){
    const response=await fetch(url,{signal,credentials:'same-origin'});
    if(!response.ok)throw new Error('Export indisponible.');
    return binary?response.arrayBuffer():response.text();
  }

  function tabNotes(source,bpm){
    const document=new DOMParser().parseFromString(source,'application/xml');
    const pitchClass={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
    const result=[],ties=new Map();
    let divisions=1,measureStart=0,measureLength=240/bpm;
    for(const measure of document.querySelectorAll('part > measure')){
      let position=measureStart,onset=position;
      for(const item of measure.children){
        if(item.tagName==='attributes'){
          divisions=Number(item.querySelector('divisions')?.textContent)||divisions;
          const beats=Number(item.querySelector('time beats')?.textContent);
          const beatType=Number(item.querySelector('time beat-type')?.textContent);
          if(beats&&beatType)measureLength=beats*240/(beatType*bpm);
          continue;
        }
        const duration=Number(item.querySelector('duration')?.textContent)*60/(divisions*bpm);
        if(!duration)continue;
        if(item.tagName==='backup'){position-=duration;continue;}
        if(item.tagName!=='note'&&item.tagName!=='forward')continue;
        const chord=Boolean(item.querySelector('chord'));
        if(!chord)onset=position;
        const pitch=item.querySelector('pitch');
        if(pitch){
          const midi=(Number(pitch.querySelector('octave').textContent)+1)*12+
            pitchClass[pitch.querySelector('step').textContent]+Number(pitch.querySelector('alter')?.textContent||0);
          const key=`${midi}:${item.querySelector('technical string')?.textContent||''}`;
          const previous=item.querySelector('tie[type="stop"]')&&ties.get(key);
          const note=previous||{time:onset,midi,duration,velocity:.7};
          if(previous)note.duration=onset+duration-note.time;
          else result.push(note);
          if(item.querySelector('tie[type="start"]'))ties.set(key,note);
          else ties.delete(key);
        }
        if(!chord)position+=duration;
      }
      measureStart=measure.getAttribute('implicit')==='yes'?position:measureStart+measureLength;
    }
    return result;
  }

  function guitarNotation(source){
    const xml=new DOMParser().parseFromString(source,'application/xml');
    for(const clef of xml.querySelectorAll('clef')){
      const sign=clef.querySelector('sign'),line=clef.querySelector('line');
      if(sign?.textContent!=='F'||!line)continue;
      sign.textContent='G';
      line.textContent='2';
      let octave=clef.querySelector('clef-octave-change');
      if(!octave){octave=xml.createElement('clef-octave-change');clef.append(octave);}
      octave.textContent='-1';
    }
    return new XMLSerializer().serializeToString(xml);
  }

  function mount(root,{scoreUrl,tabUrl,tabMidiUrl,midiUrl,instrument,sourceDuration,preferTab=false}){
    const controller=new AbortController();
    const {signal}=controller;
    root.innerHTML=`
      <div class="sp-toolbar">
        <div class="sp-tabs" role="group" aria-label="Affichage">
          <button type="button" data-view="both" aria-pressed="true">Les deux</button>
          <button type="button" data-view="score" aria-pressed="false">Partition</button>
          <button type="button" data-view="roll" aria-pressed="false">Piano roll</button>
        </div>
        <div class="sp-tools">
          <span class="sp-instrument" hidden></span>
          ${tabUrl?'<label class="sp-kind"><span class="sp-sr">Notation</span><select><option value="score">Partition</option><option value="tab">Tablature</option></select></label>':''}
          <div class="sp-zoom" role="group" aria-label="Zoom de la partition">
            <button type="button" data-zoom="-1" aria-label="Réduire la partition">−</button>
            <button type="button" data-zoom="1" aria-label="Agrandir la partition">+</button>
          </div>
          <button type="button" class="sp-full" aria-label="Plein écran" title="Plein écran">⛶</button>
        </div>
      </div>
      <div class="sp-body">
        <div class="sp-sheet" tabindex="0" aria-label="Notation musicale"><p>Chargement de la partition…</p><div class="sp-engraving"></div></div>
        <div class="sp-roll">
          <div class="sp-roll-heading"><span aria-hidden="true">●</span> Piano roll <small>Clique dans la grille pour te déplacer</small></div>
          <div class="sp-roll-scroll" tabindex="0" aria-label="Grille des notes"><p>Chargement des notes…</p></div>
        </div>
      </div>
      <div class="sp-controls">
        <button type="button" class="sp-restart" aria-label="Revenir au début" disabled>↶</button>
        <button type="button" class="sp-play" aria-label="Lire la transcription" disabled>▶</button>
        <span class="sp-time">0:00 / 0:00</span>
        <input class="sp-seek" type="range" min="0" max="1" step="0.01" value="0" aria-label="Position de lecture" disabled>
        <label class="sp-speed"><span class="sp-sr">Vitesse de lecture</span><select disabled>
          <option value="0.5">0,5×</option><option value="0.75">0,75×</option>
          <option value="1" selected>1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option>
        </select></label>
        <span class="sp-audio-label">Transcription MIDI</span>
        <a class="sp-audio-credit" hidden target="_blank" rel="noopener" aria-label="Crédits audio">ⓘ</a>
      </div><p class="sp-source-duration" hidden></p><p class="sp-status" role="status" hidden></p>`;
    const get=selector=>root.querySelector(selector);
    const body=get('.sp-body'),pageScroll=root.closest('.app-scroll'),controls=get('.sp-controls');
    const sheet=get('.sp-sheet'),engraving=get('.sp-engraving'),sheetStatus=get('.sp-sheet p');
    const roll=get('.sp-roll'),scroll=get('.sp-roll-scroll'),play=get('.sp-play'),seek=get('.sp-seek');
    const speed=get('.sp-speed select'),restart=get('.sp-restart'),kind=get('.sp-kind select');
    const zoomButtons=[...root.querySelectorAll('[data-zoom]')];
    const full=get('.sp-full');
    const guitar=instrument==='guitare',instrumentBadge=get('.sp-instrument'),audioCredit=get('.sp-audio-credit');
    const profile=soundProfiles[instrument];
    const sampleFolder=profile?new URL(profile.folder,samples):null;
    instrumentBadge.textContent=instrumentLabels[instrument]||'';
    instrumentBadge.hidden=!instrumentBadge.textContent;
    if(profile){
      audioCredit.href=new URL('ATTRIBUTION.txt',sampleFolder);
      audioCredit.hidden=false;
    }
    full.hidden=!root.requestFullscreen;
    if(kind&&preferTab)kind.value='tab';

    let notes=[],duration=0,midi,position=0,rate=1,context,playing=false,starting=false,anchor=0,next=0,frame;
    let score,cursorTimes=[],cursorIndex=0,zoom=1,loadId=0,audioLoadId=0,resizeTimer;
    let chart,playhead,pixelsPerSecond=1;
    const sounds=new Set();
    let sampleBuffers;
    const now=()=>playing?Math.min(duration,Math.max(0,(context.currentTime-anchor)*rate)):position;

    function stopSounds(){
      for(const sound of sounds)sound.stop();
      sounds.clear();
    }
    function scheduleNote(note,offset){
      const from=Math.max(context.currentTime,anchor+Math.max(offset,note.time)/rate);
      const length=(note.time+note.duration-Math.max(offset,note.time))/rate;
      if(length<=0)return;
      const gain=context.createGain();
      let sound,startAt=0;
      gain.gain.setValueAtTime(0,from);
      const release=profile?.release??.06;
      if(sampleBuffers){
        const pitch=profile.pitches.reduce((closest,key)=>Math.abs(key-note.midi)<Math.abs(closest-note.midi)?key:closest);
        const ratio=2**((note.midi-pitch)/12);
        const buffer=sampleBuffers.get(pitch);
        startAt=Math.max(0,offset-note.time)*ratio/rate;
        if(startAt>=buffer.duration)return;
        sound=context.createBufferSource();
        sound.buffer=buffer;
        sound.playbackRate.value=ratio;
        const volume=profile.volume*note.velocity;
        gain.gain.linearRampToValueAtTime(volume,from+Math.min(.005,length/2));
        gain.gain.setValueAtTime(volume,from+length);
      }else{
        sound=context.createOscillator();
        sound.type='triangle';
        sound.frequency.value=440*2**((note.midi-69)/12);
        gain.gain.linearRampToValueAtTime(.055*note.velocity,from+Math.min(.018,length/2));
      }
      gain.gain.exponentialRampToValueAtTime(.0001,from+length+release-.005);
      sound.connect(gain).connect(context.destination);
      sound.onended=()=>{sounds.delete(sound);sound.disconnect();gain.disconnect();};
      sounds.add(sound);
      if(sampleBuffers)sound.start(from,startAt);else sound.start(from);
      sound.stop(from+length+release);
    }

    function syncScore(value,follow){
      if(!score||sheet.hidden||!cursorTimes.length)return;
      let low=0,high=cursorTimes.length;
      while(low+1<high){
        const middle=Math.floor((low+high)/2);
        if(cursorTimes[middle]<=value+.035)low=middle;else high=middle;
      }
      if(low===cursorIndex)return;
      const cursor=score.cursor;
      if(low<cursorIndex){cursor.resetIterator();cursorIndex=0;}
      while(cursorIndex<low){cursor.Iterator.moveToNext();cursorIndex++;}
      cursor.update();
      if(follow){
        const viewport=document.fullscreenElement===root?body:pageScroll;
        const bounds=viewport?.getBoundingClientRect();
        const top=bounds?.top??0;
        const bottom=Math.min(bounds?.bottom??window.innerHeight,controls.getBoundingClientRect().top);
        const sheetBounds=sheet.getBoundingClientRect();
        if(sheetBounds.bottom<=top||sheetBounds.top>=bottom)return;
        const cursorBounds=cursor.cursorElement.getBoundingClientRect();
        if(cursorBounds.top<top||cursorBounds.bottom>bottom){
          (viewport||window).scrollBy({top:cursorBounds.top-top-24,behavior:'instant'});
        }
      }
    }
    function update(value,follow=false){
      seek.value=value;
      get('.sp-time').textContent=`${time(value)} / ${time(duration)}`;
      if(playhead){
        const x=value*pixelsPerSecond+43;
        playhead.setAttribute('x1',x);playhead.setAttribute('x2',x);
        if(follow&&(x>scroll.scrollLeft+scroll.clientWidth-40||x<scroll.scrollLeft)){
          scroll.scrollLeft=Math.max(0,x-80);
        }
      }
      syncScore(value,follow);
    }
    function pause(){
      position=now();playing=false;
      cancelAnimationFrame(frame);stopSounds();
      play.textContent='▶';play.setAttribute('aria-label','Lire la transcription');
    }
    function tick(){
      if(!playing)return;
      const value=now();
      while(next<notes.length&&notes[next].time<=value+.16*rate)scheduleNote(notes[next++],value);
      update(value,true);
      if(value>=duration){pause();return;}
      frame=requestAnimationFrame(tick);
    }
    function schedule(){
      stopSounds();
      anchor=context.currentTime+.025-position/rate;
      next=notes.findIndex(note=>note.time>=position);
      if(next<0)next=notes.length;
      for(let i=0;i<next;i++)if(notes[i].time+notes[i].duration>position)scheduleNote(notes[i],position);
      cancelAnimationFrame(frame);tick();
    }
    function jump(value){
      position=Math.max(0,Math.min(duration,value));
      if(playing)schedule();
      update(position,true);
    }
    play.onclick=async()=>{
      if(playing){pause();return;}
      if(starting)return;
      starting=true;
      try{
        const Audio=window.AudioContext||window.webkitAudioContext;
        if(!context)context=new Audio();
        await context.resume();
        if(profile&&!sampleBuffers&&!signal.aborted){
          const status=get('.sp-status');
          status.hidden=false;
          status.textContent=`Chargement du ${profile.label.toLowerCase()}…`;
          sampleBuffers=new Map(await Promise.all(profile.pitches.map(async pitch=>{
            const data=await read(new URL(`${pitch}.mp3`,sampleFolder),signal,true);
            return [pitch,await context.decodeAudioData(data)];
          })));
          status.hidden=true;
        }
        if(signal.aborted)return;
        if(position>=duration)position=0;
        playing=true;
        play.textContent='❚❚';play.setAttribute('aria-label','Mettre en pause');
        schedule();
      }catch{
        if(!signal.aborted){
          const status=get('.sp-status');
          status.hidden=false;
          status.textContent=profile?'Le son de l’instrument n’a pas pu charger. Relance la lecture.':'La lecture audio est indisponible dans ce navigateur.';
        }
      }
      finally{starting=false;}
    };
    seek.oninput=()=>jump(Number(seek.value));
    restart.onclick=()=>{sheet.scrollLeft=0;scroll.scrollLeft=0;jump(0);};
    speed.onchange=()=>{position=now();rate=Number(speed.value);if(playing)schedule();};

    function drawRoll(){
      const high=Math.min(127,Math.max(...notes.map(note=>note.midi))+2);
      const low=Math.max(0,Math.min(Math.min(...notes.map(note=>note.midi))-2,high-14));
      const rows=high-low+1;
      const row=Math.max(6,Math.min(13,Math.floor((Math.min(255,window.innerHeight*.25)-27)/rows)));
      const height=rows*row+26;
      pixelsPerSecond=Math.max(75,(scroll.clientWidth-43)/duration);
      const rollWidth=Math.ceil(duration*pixelsPerSecond)+44;
      chart=svg('svg',{width:rollWidth,height,role:'img','aria-label':'Hauteur et durée des notes MIDI'});
      for(let pitch=high;pitch>=low;pitch--){
        const y=26+(high-pitch)*row;
        const dark=[1,3,6,8,10].includes(pitch%12);
        chart.append(svg('rect',{x:0,y,width:rollWidth,height:row,class:dark?'sp-grid-dark':'sp-grid-light'}));
        if(pitch%12===0){
          const label=svg('text',{x:8,y:y+10,class:'sp-grid-label'});
          label.textContent=`Do${Math.floor(pitch/12)-1}`;chart.append(label);
        }
      }
      const unit=duration>90?4:duration>24?2:1;
      for(let second=0;second<duration;second+=unit){
        const x=43+second*pixelsPerSecond,label=svg('text',{x:x+5,y:17,class:'sp-grid-label'});
        label.textContent=time(second);
        chart.append(svg('line',{x1:x,y1:0,x2:x,y2:height,class:'sp-grid-line'}),label);
      }
      for(const note of notes)chart.append(svg('rect',{
        x:43+note.time*pixelsPerSecond,y:27+(high-note.midi)*row,
        width:Math.max(3,note.duration*pixelsPerSecond-1),height:row-2,rx:2,class:'sp-note'
      }));
      playhead=svg('line',{x1:43,y1:25,x2:43,y2:height,class:'sp-playhead'});
      chart.append(playhead);scroll.replaceChildren(chart);
      chart.addEventListener('click',event=>jump((event.clientX-chart.getBoundingClientRect().left-43)/pixelsPerSecond));
      update(now());
    }

    const xml=new Map();
    let tabMidi;
    function loadXml(url){
      if(!xml.has(url))xml.set(url,read(url,signal).catch(error=>{xml.delete(url);throw error;}));
      return xml.get(url);
    }
    async function selectSound(){
      if(!midi||signal.aborted)return;
      const current=++audioLoadId,tab=kind?.value==='tab';
      if(playing)pause();
      for(const control of [play,seek,speed,restart])control.disabled=true;
      try{
        let track;
        if(tab&&tabMidiUrl){
          tabMidi??=read(tabMidiUrl,signal,true).then(buffer=>new window.Midi(buffer)).catch(error=>{tabMidi=undefined;throw error;});
          track=(await tabMidi).tracks.flatMap(part=>part.notes);
        }else if(tab){
          track=tabNotes(await loadXml(tabUrl),midi.header.tempos[0]?.bpm||120);
        }else{
          track=midi.tracks.flatMap(part=>part.notes);
        }
        if(signal.aborted||current!==audioLoadId)return;
        if(!track.length)throw new Error('Aucune note à lire.');
        notes=track.sort((a,b)=>a.time-b.time);
        duration=notes.reduce((end,note)=>Math.max(end,note.time+note.duration),0);
        if(sourceDuration>0){
          const timing=get('.sp-source-duration');
          timing.textContent=`Audio importé : ${time(Math.round(sourceDuration))} · Dernière note du relevé : ${time(Math.round(duration))}`;
          timing.hidden=false;
        }
        position=Math.min(position,duration);
        seek.max=duration;
        get('.sp-audio-label').textContent=profile?.label??(tab?'Lecture de la tablature':'Transcription MIDI');
        for(const control of [play,seek,speed,restart])control.disabled=false;
        drawRoll();
      }catch{
        if(!signal.aborted&&current===audioLoadId)scroll.textContent='Le piano roll est indisponible pour ce relevé.';
      }
    }
    async function drawSheet(){
      if(sheet.hidden||signal.aborted)return;
      const current=++loadId,url=kind?.value==='tab'?tabUrl:scoreUrl;
      try{
        const [,source]=await Promise.all([loadScript('score','2.3.0'),loadXml(url)]);
        if(current!==loadId||signal.aborted||sheet.hidden)return;
        engraving.replaceChildren();
        const display=new window.opensheetmusicdisplay.OpenSheetMusicDisplay(engraving,{
          backend:'svg',autoResize:false,drawTitle:false,drawSubtitle:false,drawComposer:false,drawCredits:false,
          cursorsOptions:[{type:0,color:'#7549eb',alpha:.48,follow:false}]
        });
        await display.load(guitar&&url===scoreUrl?guitarNotation(source):source);
        if(current!==loadId||signal.aborted||sheet.hidden)return;
        score=display;score.Zoom=zoom;score.render();score.cursor.show();
        cursorTimes=[];cursorIndex=0;
        const iterator=score.cursor.Iterator.clone();
        const bpm=midi?.header.tempos[0]?.bpm||120;
        while(!iterator.EndReached&&cursorTimes.length<20000){
          cursorTimes.push(iterator.CurrentEnrolledTimestamp.RealValue*240/bpm);
          iterator.moveToNext();
        }
        sheetStatus.hidden=true;syncScore(now(),playing);
      }catch{
        if(current!==loadId||signal.aborted)return;
        sheetStatus.hidden=false;sheetStatus.textContent='La notation ne s’affiche pas. Tu peux utiliser le PDF ou le MusicXML.';
      }
    }
    const buttons=[...root.querySelectorAll('[data-view]')];
    for(const button of buttons)button.onclick=()=>{
      const view=button.dataset.view;
      sheet.hidden=view==='roll';roll.hidden=view==='score';
      for(const item of buttons)item.setAttribute('aria-pressed',String(item===button));
      if(!sheet.hidden){if(score)syncScore(now(),false);else drawSheet();}
    };
    for(const button of zoomButtons)button.onclick=()=>{
      zoom=Math.min(1.7,Math.max(.65,zoom+Number(button.dataset.zoom)*.15));
      drawSheet();
    };
    if(kind)kind.onchange=()=>{drawSheet();selectSound();};
    full.onclick=()=>{const action=document.fullscreenElement===root?document.exitFullscreen():root.requestFullscreen();action.catch(()=>{});};
    let width=0,rollWidth=0;
    const observer=new ResizeObserver(()=>{
      if(scroll.clientWidth&&scroll.clientWidth!==rollWidth){
        rollWidth=scroll.clientWidth;
        if(notes.length)drawRoll();
      }
      const available=sheet.clientWidth;
      if(!available||Math.abs(available-width)<2)return;
      width=available;
      clearTimeout(resizeTimer);resizeTimer=setTimeout(drawSheet,140);
    });
    observer.observe(sheet);
    observer.observe(scroll);
    Promise.all([loadScript('midi','2.0.28'),read(midiUrl,signal,true)]).then(([,buffer])=>{
      if(signal.aborted)return;
      midi=new window.Midi(buffer);
      selectSound();
      if(score)drawSheet();
    }).catch(()=>{if(!signal.aborted)scroll.textContent='Le piano roll est indisponible pour ce relevé.';});
    return ()=>{
      controller.abort();pause();observer.disconnect();clearTimeout(resizeTimer);
      if(context&&context.state!=='closed')context.close().catch(()=>{});
    };
  }
  window.SongToSheetPlayer={mount};
})();

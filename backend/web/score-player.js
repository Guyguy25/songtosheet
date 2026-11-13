(() => {
  'use strict';
  const scripts=new Map();
  const samples=new URL('sounds/',document.currentScript.src);
  const soundProfiles={
    guitare:{folder:'guitar-steel/',pitches:[40,45,50,55,59,64,69,74,79,83,88],label:'Son de guitare acoustique',volume:.5,release:.06},
    piano:{folder:'piano-grand/',pitches:[21,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108],label:'Son de piano à queue',volume:.27,release:.18}
  };
  const accompanimentProfile={folder:'guitar-acoustic/',pitches:[40,43,46,49,52,55,58,61,64,67,70],
    label:'Guitare acoustique enregistrée',volume:.52,release:.14};
  const instrumentLabels={guitare:'Guitare',basse:'Basse',piano:'Piano',voix:'Voix'};
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
          const string=Number(item.querySelector('technical string')?.textContent)||null;
          const key=`${midi}:${string??''}`;
          const previous=item.querySelector('tie[type="stop"]')&&ties.get(key);
          const note=previous||{time:onset,midi,duration,velocity:.7,string};
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

  function guitarEntry(notes){
    const attacks=[];
    for(const note of [...notes].sort((a,b)=>a.time-b.time)){
      if(note.duration<.08||note.velocity<.2)continue;
      if(!attacks.length||note.time-attacks.at(-1)>.06)attacks.push(note.time);
      if(attacks.length===3)break;
    }
    return attacks[0]>=1&&attacks[2]-attacks[0]<=2?attacks[0]:0;
  }

  function addSoloSustain(notes,notation,bpm,end){
    const byPitch=new Map();
    for(const event of notation.sort((a,b)=>a.time-b.time)){
      if(!byPitch.has(event.midi))byPitch.set(event.midi,{events:[],next:0});
      byPitch.get(event.midi).events.push(event);
    }
    const strings=notes.map(note=>{
      const group=byPitch.get(note.midi);
      if(!group)return null;
      while(group.events[group.next]?.time<note.time-.055)group.next++;
      const event=group.events[group.next];
      if(!event||event.time>note.time+.055)return null;
      group.next++;
      return event.string;
    });
    const nextOnString=new Map();
    const sustain=Math.min(.6,45/bpm);
    let nextUnknown=end;
    for(let index=notes.length-1;index>=0;index--){
      const note=notes[index],string=strings[index];
      if(!string){nextUnknown=note.time;continue;}
      const stop=Math.min(note.time+sustain,nextOnString.get(string)??end,nextUnknown);
      note.ringDuration=Math.max(note.duration,stop-note.time);
      nextOnString.set(string,note.time);
    }
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

  function mount(root,{scoreUrl,tabUrl,tabMidiUrl,midiUrl,instrument,sourceDuration,previewDuration,preferTab=false,startAt=0,
                       findEntry=false,entryMidiUrl,soloSustain=false,accompaniment=false,comparison=false,onReady,onNotation,loadVocals}){
    const controller=new AbortController();
    const {signal}=controller;
    const guitar=instrument==='guitare';
    root.innerHTML=`
      <div class="sp-toolbar">
        ${guitar?'':`<div class="sp-tabs" role="group" aria-label="Affichage">
          <button type="button" data-view="both" aria-pressed="true">Les deux</button>
          <button type="button" data-view="score" aria-pressed="false">Partition</button>
          <button type="button" data-view="roll" aria-pressed="false">Piano roll</button>
        </div>`}
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
        <div class="sp-sheet" tabindex="0" aria-label="Notation musicale"><p>Chargement de la partition…</p><div class="sp-engraving"></div>
          <div class="sp-continuation" hidden><div class="sp-continuation-notation" aria-hidden="true"></div>
          <div class="sp-continuation-label"><strong>Suite verrouillée</strong><span>Les 30 premières secondes sont gratuites. La suite floutée est illustrative.</span></div></div>
        </div>
        ${guitar?'':`<div class="sp-roll">
          <div class="sp-roll-heading"><span aria-hidden="true">●</span> Piano roll <small>Clique dans la grille pour te déplacer</small></div>
          <div class="sp-roll-scroll" tabindex="0" aria-label="Grille des notes"><p>Chargement des notes…</p></div>
        </div>`}
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
      </div><p class="sp-source-duration" hidden></p>
      <p class="sp-source-duration sp-technique-key" hidden><strong>Lire la tablature</strong> · Cases alignées : ensemble · Cases décalées : une à une · Gratté : un coup sur plusieurs cordes · sl. : glissé · P : pull-off</p>
      <p class="sp-status" role="status" hidden></p>`;
    const get=selector=>root.querySelector(selector);
    const body=get('.sp-body'),pageScroll=root.closest('.app-scroll'),controls=get('.sp-controls');
    const sheet=get('.sp-sheet'),engraving=get('.sp-engraving'),sheetStatus=get('.sp-sheet p');
    const roll=get('.sp-roll'),scroll=get('.sp-roll-scroll'),play=get('.sp-play'),seek=get('.sp-seek');
    const speed=get('.sp-speed select'),restart=get('.sp-restart'),kind=get('.sp-kind select');
    const zoomButtons=[...root.querySelectorAll('[data-zoom]')];
    const full=get('.sp-full');
    const instrumentBadge=get('.sp-instrument'),audioCredit=get('.sp-audio-credit');
    const profile=accompaniment?accompanimentProfile:soundProfiles[instrument];
    const sampleFolder=profile?new URL(profile.folder,samples):null;
    instrumentBadge.textContent=instrumentLabels[instrument]||'';
    instrumentBadge.hidden=!instrumentBadge.textContent;
    if(profile){
      audioCredit.href=new URL('ATTRIBUTION.txt',sampleFolder);
      audioCredit.hidden=false;
    }
    full.hidden=!root.requestFullscreen;
    if(kind&&preferTab)kind.value='tab';

    let notes=[],duration=0,midi,position=startAt,rate=1,context,playing=false,starting=false,anchor=0,next=0,frame;
    let entry=0,playbackStart=0,initializedPosition=false;
    let score,scoreSystems=[],scoreLine,activeSystem,zoom=1,loadId=0,audioLoadId=0,resizeTimer;
    let playRequest=0;
    let chart,playhead,pixelsPerSecond=1;
    const sounds=new Set();
    let sampleBuffers;
    let vocalsEnabled=false,vocalsBuffer,vocalsSource,vocalsDecode;
    const now=()=>playing?Math.min(duration,Math.max(0,(context.currentTime-anchor)*rate)):position;
    const noteEnd=note=>note.time+(note.ringDuration??note.duration);

    function stopSounds(){
      for(const sound of sounds)sound.stop();
      sounds.clear();
      if(vocalsSource){vocalsSource.stop();vocalsSource.disconnect();vocalsSource=null;}
    }
    function scheduleVocals(from=now()){
      if(!vocalsEnabled||!vocalsBuffer||!playing)return;
      const when=Math.max(context.currentTime,anchor+from/rate);
      const offset=Math.max(0,(when-anchor)*rate);
      const length=Math.min(duration,vocalsBuffer.duration)-offset;
      if(length<=0)return;
      const source=context.createBufferSource();
      const gain=context.createGain();
      gain.gain.value=.65;
      source.buffer=vocalsBuffer;
      source.playbackRate.value=rate;
      source.connect(gain).connect(context.destination);
      source.onended=()=>{
        if(vocalsSource===source)vocalsSource=null;
        source.disconnect();gain.disconnect();
      };
      vocalsSource=source;
      source.start(when,offset,length);
    }
    function scheduleNote(note,offset){
      const attack=note.time+(note.strumDelay??0);
      const from=Math.max(context.currentTime,anchor+Math.max(offset,attack)/rate);
      const length=(noteEnd(note)-Math.max(offset,attack))/rate;
      if(length<=0)return;
      const gain=context.createGain();
      let sound,startAt=0;
      gain.gain.setValueAtTime(0,from);
      const release=profile?.release??.06;
      if(sampleBuffers){
        const pitch=profile.pitches.reduce((closest,key)=>Math.abs(key-note.midi)<Math.abs(closest-note.midi)?key:closest);
        const ratio=2**((note.midi-pitch)/12);
        const buffer=sampleBuffers.get(pitch);
        startAt=Math.max(0,offset-attack)*ratio/rate;
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

    function mapScore(display){
      const systems=new Map(), pages=new Map();
      const bounds=engraving.getBoundingClientRect();
      const scale=10*display.Zoom;
      const seconds=value=>midi?midi.header.ticksToSeconds(value*4*midi.header.ppq):value*2;
      for(const row of display.GraphicSheet.MeasureList){
        const measure=row.find(item=>item?.ParentMusicSystem);
        if(!measure)continue;
        const system=measure.ParentMusicSystem;
        const page=system.Parent.PageNumber;
        if(!pages.has(page)){
          const element=engraving.querySelector('#osmdCanvasPage'+page);
          const rect=element?.getBoundingClientRect()??bounds;
          pages.set(page,{x:rect.left-bounds.left,y:rect.top-bounds.top});
        }
        const offset=pages.get(page);
        const source=measure.parentSourceMeasure;
        const start=seconds(source.AbsoluteTimestamp.RealValue);
        const end=seconds(source.AbsoluteTimestamp.RealValue+source.Duration.RealValue);
        const box=measure.PositionAndShape;
        const x=box.AbsolutePosition.x;
        if(!systems.has(system)){
          const staves=system.StaffLines;
          const top=staves[0].PositionAndShape.AbsolutePosition.y;
          const last=staves.at(-1);
          const bottom=last.PositionAndShape.AbsolutePosition.y+last.StaffHeight;
          systems.set(system,{start,top:offset.y+top*scale-4,height:(bottom-top)*scale+8,points:new Map()});
        }
        const line=systems.get(system);
        const addPoint=(time,unit)=>line.points.set(time,offset.x+unit*scale);
        addPoint(start,x);
        for(const staff of row){
          if(staff?.ParentMusicSystem!==system)continue;
          for(const entry of staff.staffEntries){
            const hasNote=entry.graphicalVoiceEntries.some(voice=>voice.notes.some(note=>!note.sourceNote.isRest()));
            if(!hasNote)continue;
            const time=seconds(entry.getAbsoluteTimestamp().RealValue);
            if(time>=start&&time<end)addPoint(time,entry.PositionAndShape.AbsolutePosition.x);
          }
        }
        addPoint(end,x+box.Size.width);
      }
      return [...systems.values()].map(line=>({...line,points:[...line.points].sort(([a],[b])=>a-b)}));
    }

    function findTimeIndex(items,value,timeOf){
      let low=0,high=items.length;
      while(low+1<high){
        const middle=Math.floor((low+high)/2);
        if(timeOf(items[middle])<=value)low=middle;else high=middle;
      }
      return low;
    }

    function syncScore(value,follow){
      if(!scoreLine||sheet.hidden||!scoreSystems.length)return;
      const line=scoreSystems[findTimeIndex(scoreSystems,value,item=>item.start)];
      const index=findTimeIndex(line.points,value,item=>item[0]);
      const [time,x]=line.points[index];
      const next=line.points[index+1];
      const fraction=next?Math.min(1,Math.max(0,(value-time)/(next[0]-time))):0;
      const left=next?x+(next[1]-x)*fraction:x;
      const changed=activeSystem!==line;
      activeSystem=line;
      scoreLine.style.transform=`translate(${left}px,${line.top}px)`;
      scoreLine.style.height=line.height+'px';
      if(follow&&(left>sheet.scrollLeft+sheet.clientWidth-20||left<sheet.scrollLeft)){
        sheet.scrollLeft=Math.max(0,left-55);
      }
      if(follow&&changed&&comparison){
        if(line.top<sheet.scrollTop||line.top+line.height>sheet.scrollTop+sheet.clientHeight)
          sheet.scrollTop=Math.max(0,line.top-24);
      }else if(follow&&changed){
        const viewport=document.fullscreenElement===root?body:pageScroll;
        const bounds=viewport?.getBoundingClientRect();
        const top=bounds?.top??0;
        const bottom=Math.min(bounds?.bottom??window.innerHeight,controls.getBoundingClientRect().top);
        const sheetBounds=sheet.getBoundingClientRect();
        if(sheetBounds.bottom<=top||sheetBounds.top>=bottom)return;
        const cursorBounds=scoreLine.getBoundingClientRect();
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
      playRequest++;
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
      scheduleVocals(position);
      next=notes.findIndex(note=>note.time>=position);
      if(next<0)next=notes.length;
      if(!playbackStart||position!==playbackStart){
        for(let i=0;i<next;i++)if(noteEnd(notes[i])>position)scheduleNote(notes[i],position);
      }
      cancelAnimationFrame(frame);tick();
    }
    function jump(value,follow=true){
      position=Math.max(0,Math.min(duration,value));
      if(playing)schedule();
      update(position,follow);
    }
    play.onclick=async()=>{
      if(playing){pause();return;}
      if(starting||play.disabled)return;
      const request=++playRequest;
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
        if(signal.aborted||request!==playRequest)return;
        if(vocalsEnabled&&!vocalsBuffer){
          try{await setVocals(true);}catch{vocalsEnabled=false;}
        }
        if(signal.aborted||request!==playRequest)return;
        if(position>=duration)position=playbackStart;
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
    restart.onclick=()=>{sheet.scrollLeft=0;if(scroll)scroll.scrollLeft=0;jump(playbackStart);};
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
        const notation=soloSustain?await loadXml(scoreUrl).catch(()=>null):null;
        if(signal.aborted||current!==audioLoadId)return;
        if(!track.length)throw new Error('Aucune note à lire.');
        notes=track.filter(note=>!previewDuration||note.time<previewDuration).map(note=>({
          midi:note.midi,velocity:note.velocity,time:note.time,
          duration:previewDuration?Math.min(note.duration,previewDuration-note.time):note.duration
        })).sort((a,b)=>a.time-b.time);
        if(!notes.length)throw new Error('Aucune note dans cet aperçu.');
        if(accompaniment){
          let previous=-1,strings=0;
          notes.sort((a,b)=>a.time-b.time||a.midi-b.midi);
          for(const note of notes){
            strings=Math.abs(note.time-previous)<.005?strings+1:0;
            note.strumDelay=Math.min(strings,5)*.012;
            previous=note.time;
          }
        }
        const lastNote=notes.reduce((end,note)=>Math.max(end,note.time+note.duration),0);
        duration=accompaniment||comparison?Math.max(lastNote,previewDuration||sourceDuration||0):lastNote;
        if(notation){
          const bpm=midi.header.tempos[0]?.bpm||120;
          try{addSoloSustain(notes,tabNotes(notation,bpm),bpm,duration);}
          catch{/* A damaged tablature must not prevent MIDI playback. */}
        }
        playbackStart=entry?notes.find(note=>note.time>=entry-.035)?.time??0:0;
        if(!initializedPosition){
          position=startAt>playbackStart+.035?startAt:playbackStart;
          initializedPosition=true;
        }
        if(sourceDuration>0){
          const timing=get('.sp-source-duration');
          timing.textContent=`Audio importé : ${time(Math.round(sourceDuration))} · Dernière note du relevé : ${time(Math.round(lastNote))}`;
          timing.hidden=false;
        }
        position=Math.min(position,duration);
        seek.max=duration;
        get('.sp-audio-label').textContent=profile?.label??(tab?'Lecture de la tablature':'Transcription MIDI');
        for(const control of [play,seek,speed,restart])control.disabled=false;
        if(scroll)drawRoll();
        else update(position);
        onReady?.(duration);
      }catch{
        if(!signal.aborted&&current===audioLoadId)showPlaybackError();
      }
    }
    function showPlaybackError(){
      if(scroll)scroll.textContent='Le piano roll est indisponible pour ce relevé.';
      else{
        const status=get('.sp-status');
        status.textContent='La lecture est indisponible pour cette tablature.';
        status.hidden=false;
      }
      onReady?.(0);
    }
    async function drawSheet(){
      get('.sp-technique-key').hidden=!guitar||kind?.value!=='tab';
      const continuation=get('.sp-continuation');
      continuation.hidden=!(previewDuration&&sourceDuration>previewDuration+.05);
      if(!continuation.hidden){
        get('.sp-continuation-notation').innerHTML=window.SongToSheetFlow?.placeholderNotation(
          instrument,kind?kind.value==='tab':preferTab)||'';
      }
      if(sheet.hidden||signal.aborted)return;
      const current=++loadId,url=kind?.value==='tab'?tabUrl:scoreUrl;
      try{
        const [,source]=await Promise.all([loadScript('score','2.3.0'),loadXml(url)]);
        if(current!==loadId||signal.aborted||sheet.hidden)return;
        onNotation?.(source);
        scoreLine=null;
        engraving.replaceChildren();
        const display=new window.opensheetmusicdisplay.OpenSheetMusicDisplay(engraving,{
          backend:'svg',autoResize:false,drawTitle:false,drawSubtitle:false,drawComposer:false,drawCredits:false,
          cursorsOptions:[{type:0,color:'#7549eb',alpha:.48,follow:false}]
        });
        await display.load(guitar&&url===scoreUrl?guitarNotation(source):source);
        if(current!==loadId||signal.aborted||sheet.hidden)return;
        score=display;score.Zoom=zoom;score.render();
        scoreSystems=mapScore(display);activeSystem=null;
        scoreLine=document.createElement('div');
        scoreLine.className='sp-score-playhead';
        scoreLine.setAttribute('aria-hidden','true');
        engraving.append(scoreLine);
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
      if(scroll?.clientWidth&&scroll.clientWidth!==rollWidth){
        rollWidth=scroll.clientWidth;
        if(notes.length)drawRoll();
      }
      const available=sheet.clientWidth;
      if(!available||Math.abs(available-width)<2)return;
      width=available;
      clearTimeout(resizeTimer);resizeTimer=setTimeout(drawSheet,140);
    });
    observer.observe(sheet);
    if(scroll)observer.observe(scroll);
    const entryMidi=entryMidiUrl?read(entryMidiUrl,signal,true).catch(()=>null):null;
    Promise.all([loadScript('midi','2.0.28'),read(midiUrl,signal,true),entryMidi]).then(([,buffer,entryBuffer])=>{
      if(signal.aborted)return;
      midi=new window.Midi(buffer);
      if(findEntry){
        try{
          const original=entryMidiUrl?(entryBuffer&&new window.Midi(entryBuffer)):midi;
          if(original)entry=guitarEntry(original.tracks.flatMap(track=>track.notes));
        }catch{/* Playback can start at zero when the original MIDI is unavailable. */}
      }
      selectSound();
      if(score)drawSheet();
    }).catch(()=>{if(!signal.aborted)showPlaybackError();});
    const dispose=()=>{
      controller.abort();pause();observer.disconnect();clearTimeout(resizeTimer);
      if(context&&context.state!=='closed')context.close().catch(()=>{});
    };
    async function setVocals(enabled){
      vocalsEnabled=enabled&&Boolean(loadVocals);
      if(!vocalsEnabled){
        if(vocalsSource){vocalsSource.stop();vocalsSource.disconnect();vocalsSource=null;}
        return;
      }
      if(!context)return;
      try{
        if(!vocalsBuffer){
          vocalsDecode??=loadVocals().then(bytes=>context.decodeAudioData(bytes.slice(0)))
            .catch(error=>{vocalsDecode=null;throw error;});
          vocalsBuffer=await vocalsDecode;
        }
        if(!signal.aborted&&!vocalsSource)scheduleVocals();
      }catch(error){if(!signal.aborted)vocalsEnabled=false;throw error;}
    }
    dispose.position=now;
    dispose.seek=jump;
    dispose.play=()=>play.onclick();
    dispose.pause=pause;
    dispose.playing=()=>playing;
    dispose.setVocals=setVocals;
    return dispose;
  }
  window.SongToSheetPlayer={mount};
})();

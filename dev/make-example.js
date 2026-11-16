'use strict';
// Génère une tablature d'exemple originale (deux versions) pour la démo locale.
const fs=require('node:fs');
const path=require('node:path');
const {Midi}=require('@tonejs/midi');
const out=path.join(__dirname,'example');
const BPM=92,DIV=480,OPEN={6:40,5:45,4:50,3:55,2:59,1:64};
const SHAPES={
  Am:{root:['A',0],kind:'minor',frets:{5:0,4:2,3:2,2:1,1:0}},
  F:{root:['F',0],kind:'major',frets:{4:3,3:2,2:1,1:1}},
  C:{root:['C',0],kind:'major',frets:{5:3,4:2,3:0,2:1,1:0}},
  G:{root:['G',0],kind:'major',frets:{6:3,5:2,4:0,3:0,2:0,1:3}},
  Dm:{root:['D',0],kind:'minor',frets:{4:0,3:2,2:3,1:1}},
  Em:{root:['E',0],kind:'minor',frets:{6:0,5:2,4:2,3:0,2:0,1:0}}
};
const THEME=['Am','F','C','G','Am','F','C','G','Dm','G','C','Am','F','G','Am','Am'];
// Morceau complet (32 mesures) et aperçu gratuit (les 30 premières secondes).
const FULL=[...THEME,...THEME];
const PREVIEW=FULL.slice(0,11);
const NAMES=[['C',0],['C',1],['D',0],['D',1],['E',0],['F',0],['F',1],['G',0],['G',1],['A',0],['A',1],['B',0]];
const TYPES={240:'eighth',480:'quarter',960:'half',1920:'whole'};

// events: {bar, at (divisions in bar), dur, notes:[{string,fret}]}
function arpeggio(BARS,ending){
  const events=[];
  BARS.forEach((name,bar)=>{
    const frets=SHAPES[name].frets;
    const strings=Object.keys(frets).map(Number).sort((a,b)=>b-a);
    const bass=strings[0],last=ending&&bar===BARS.length-1;
    if(last){events.push({bar,at:0,dur:1920,notes:strings.map(string=>({string,fret:frets[string]}))});return;}
    const order=[bass,3,2,1,2,3,2,1];
    order.forEach((string,index)=>{
      const notes=[{string,fret:frets[string]}];
      if(index===0)notes.push({string:1,fret:frets[1]});
      events.push({bar,at:index*240,dur:240,notes});
    });
  });
  return events;
}
function strummed(BARS,ending){
  const events=[];
  BARS.forEach((name,bar)=>{
    const frets=SHAPES[name].frets;
    const notes=Object.keys(frets).map(Number).sort((a,b)=>b-a).map(string=>({string,fret:frets[string]}));
    if(ending&&bar===BARS.length-1){events.push({bar,at:0,dur:1920,notes});return;}
    events.push({bar,at:0,dur:960,notes},{bar,at:960,dur:480,notes},{bar,at:1440,dur:480,notes:notes.slice(-3)});
  });
  return events;
}
function xml(events,BARS){
  let body='';
  BARS.forEach((name,bar)=>{
    const {root,kind}=SHAPES[name];
    body+=`<measure number="${bar+1}">`;
    if(bar===0)body+=`<attributes><divisions>${DIV}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>`+
      `<clef><sign>TAB</sign><line>5</line></clef><staff-details><staff-lines>6</staff-lines>`+
      [[1,'E',2],[2,'A',2],[3,'D',3],[4,'G',3],[5,'B',3],[6,'E',4]].map(([line,step,octave])=>
        `<staff-tuning line="${line}"><tuning-step>${step}</tuning-step><tuning-octave>${octave}</tuning-octave></staff-tuning>`).join('')+
      `</staff-details></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${BPM}</per-minute></metronome></direction-type><sound tempo="${BPM}"/></direction>`;
    body+=`<harmony placement="above"><root><root-step>${root[0]}</root-step></root><kind>${kind}</kind></harmony>`;
    for(const event of events.filter(item=>item.bar===bar)){
      event.notes.forEach(({string,fret},index)=>{
        const midi=OPEN[string]+fret,[step,alter]=NAMES[midi%12];
        body+=`<note>${index?'<chord/>':''}<pitch><step>${step}</step>${alter?`<alter>${alter}</alter>`:''}<octave>${Math.floor(midi/12)-1}</octave></pitch>`+
          `<duration>${event.dur}</duration><voice>1</voice><type>${TYPES[event.dur]}</type>`+
          `<notations><technical><string>${string}</string><fret>${fret}</fret></technical></notations></note>`;
      });
    }
    body+='</measure>';
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Guitare</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}
function midi(events){
  const file=new Midi();
  file.header.setTempo(BPM);
  const track=file.addTrack();
  const seconds=divisions=>divisions/DIV*60/BPM;
  for(const event of events)for(const {string,fret} of event.notes){
    track.addNote({midi:OPEN[string]+fret,time:seconds(event.bar*1920+event.at),duration:seconds(event.dur)*.95,velocity:.72});
  }
  return Buffer.from(file.toArray());
}
// Petite piste « voix » synthétique pour montrer le réglage de voix dans la démo.
function vocals(BARS=FULL){
  const rate=11025,total=Math.ceil(BARS.length*4*60/BPM*rate),data=Buffer.alloc(total*2);
  BARS.forEach((name,bar)=>{
    const frets=SHAPES[name].frets,note=OPEN[2]+frets[2]+12;
    const frequency=440*2**((note-69)/12),start=Math.floor(bar*4*60/BPM*rate),length=Math.floor(4*60/BPM*rate);
    for(let i=0;i<length&&start+i<total;i++){
      const t=i/rate,envelope=Math.min(1,t*8)*Math.min(1,(length-i)/rate*4);
      const value=Math.sin(2*Math.PI*frequency*t+Math.sin(2*Math.PI*5*t)*.35)*.3*envelope;
      data.writeInt16LE(Math.round(value*32767),(start+i)*2);
    }
  });
  const header=Buffer.alloc(44);
  header.write('RIFF',0);header.writeUInt32LE(36+data.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);
  header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);
  header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);
  return Buffer.concat([header,data]);
}
fs.mkdirSync(out,{recursive:true});
for(const [name,events,bars] of [['arpege',arpeggio(FULL,true),FULL],['accords',strummed(FULL,true),FULL],
  ['arpege-apercu',arpeggio(PREVIEW,false),PREVIEW],['accords-apercu',strummed(PREVIEW,false),PREVIEW]]){
  fs.writeFileSync(path.join(out,name+'.musicxml'),xml(events,bars));
  fs.writeFileSync(path.join(out,name+'.mid'),midi(events));
}
fs.writeFileSync(path.join(out,'voix.wav'),vocals());
console.log('Exemple généré dans',out);

/* Tablurio — règles du mode Apprentissage, sans DOM : découpage en niveaux, jugement, étoiles, XP.
 * Partagé par le navigateur (window.TablurioLearnCore) et le serveur (require, lib/learn.js). */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TablurioLearnCore=api;
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const SPEEDS=[.6,.8,1];
  const LISTEN_SPEED=.75;
  const LEVEL_MIN=4,LEVEL_MAX=10,SILENCE=2,WINDOW=6,PER_SECTION=4;
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,Number(value)||0));

  // Bornes de mesures jusqu'à couvrir la dernière note.
  function boundaries(measureStarts,lastEnd){
    const starts=[...new Set(measureStarts.filter(Number.isFinite))].sort((a,b)=>a-b);
    if(starts.length<2)return null;
    const step=starts.at(-1)-starts.at(-2);
    if(!(step>0))return null;
    const list=[...starts];
    do list.push(list.at(-1)+step);while(list.at(-1)<lastEnd);
    return list;
  }

  function measureGroups(bounds){
    const groups=[];
    let i=0;
    while(i<bounds.length-1){
      let count=Math.min(2,bounds.length-1-i);
      const span=n=>bounds[i+n]-bounds[i];
      if(span(count)<LEVEL_MIN&&i+count+1<bounds.length)count++;
      if(span(count)>LEVEL_MAX&&count>1)count=1;
      const start=bounds[i],end=bounds[i+count];
      // Une seule mesure trop longue : parts égales de 10 s au plus.
      const parts=Math.max(1,Math.ceil((end-start)/LEVEL_MAX-1e-9));
      for(let p=0;p<parts;p++)groups.push([start+(end-start)*p/parts,start+(end-start)*(p+1)/parts]);
      i+=count;
    }
    return groups;
  }

  function windowGroups(notes){
    const groups=[];
    let index=0;
    while(index<notes.length){
      const start=notes[index].time;
      while(index<notes.length&&notes[index].time<start+WINDOW)index++;
      const end=index<notes.length?notes[index].time:Math.max(...notes.map(n=>n.time+(n.duration||0)),start+.5);
      groups.push([start,end]);
    }
    return groups;
  }

  function buildLevels(notes,measureStarts,{previewEnd=Infinity}={}){
    const sorted=[...(notes||[])].filter(n=>Number.isFinite(n?.time)&&n.time<previewEnd).sort((a,b)=>a.time-b.time);
    if(!sorted.length)return [];
    const lastEnd=Math.max(...sorted.map(n=>n.time+(n.duration||0)));
    const bounds=boundaries(measureStarts||[],lastEnd);
    const groups=bounds?measureGroups(bounds):windowGroups(sorted);
    const plain=[];
    for(let [start,end] of groups){
      if(start>=previewEnd)break;
      end=Math.min(end,previewEnd);
      const inside=sorted.filter(n=>n.time>=start&&n.time<end);
      if(!inside.length)continue;
      // Le premier niveau, et tout niveau précédé d'un long silence, démarre sur sa première note.
      if(!plain.length||inside[0].time-start>SILENCE)start=inside[0].time;
      plain.push({start,end,notes:inside});
    }
    const levels=[];
    for(let s=0;s*PER_SECTION<plain.length;s++){
      const chunk=plain.slice(s*PER_SECTION,(s+1)*PER_SECTION);
      for(const level of chunk)levels.push({index:levels.length,section:s,...level,boss:false});
      if(chunk.length>=2)levels.push({index:levels.length,section:s,start:chunk[0].start,end:chunk.at(-1).end,
        notes:chunk.flatMap(l=>l.notes),boss:true});
    }
    return levels;
  }

  // Notes jouées ensemble (accord) : une seule attaque.
  function groupAttacks(notes,tolerance=.06){
    const attacks=[];
    for(const note of [...(notes||[])].sort((a,b)=>a.time-b.time)){
      const last=attacks.at(-1);
      if(last&&note.time-last.time<=tolerance){
        last.notes.push(note);
        if(!last.midis.includes(note.midi))last.midis.push(note.midi);
      }else attacks.push({time:note.time,midis:[note.midi],notes:[note]});
    }
    return attacks;
  }

  const judge=delta=>{
    const gap=Math.abs(delta);
    return gap<=.08+1e-9?'perfect':gap<=.16+1e-9?'good':'miss';
  };
  const multiplier=combo=>combo>=40?4:combo>=20?3:combo>=10?2:1;

  function starsFor(accuracy,speed){
    const a=clamp(accuracy,0,1),s=clamp(speed,SPEEDS[0],1);
    const stars=a>=.95?3:a>=.8?2:a>=.6?1:0;
    return s<1?Math.min(stars,2):stars;
  }

  function xpFor({notes,accuracy,speed,boss}){
    const n=Math.round(clamp(notes,0,300)),a=clamp(accuracy,0,1),s=clamp(speed,SPEEDS[0],1);
    return Math.round(n*a*10*s)+(boss&&starsFor(a,s)>=1?100:0);
  }

  return {buildLevels,groupAttacks,judge,multiplier,starsFor,xpFor,SPEEDS,LISTEN_SPEED};
});

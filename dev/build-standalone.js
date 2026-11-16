'use strict';
// Fabrique un seul fichier HTML autonome (aucun serveur, aucune installation) :
// l'interface réelle + une API simulée dans la page + la tablature d'exemple.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const example=path.join(__dirname,'example');
require('./make-example.js');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const b64=file=>fs.readFileSync(file).toString('base64');
const inlineJs=code=>code.replace(/<\/script/gi,'<\\/script');

// Voix synthétique ré-échantillonnée (un point sur deux) pour alléger le fichier.
function lightVoice(){
  const wav=fs.readFileSync(path.join(example,'voix.wav')),data=wav.subarray(44);
  const half=Buffer.alloc(Math.floor(data.length/4)*2);
  for(let i=0;i<half.length/2;i++)half.writeInt16LE(data.readInt16LE(i*4),i*2);
  const header=Buffer.from(wav.subarray(0,44));
  const rate=header.readUInt32LE(24)/2;
  header.writeUInt32LE(36+half.length,4);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt32LE(half.length,40);
  return Buffer.concat([header,half]).toString('base64');
}
const files={
  arpegeXml:['application/xml',b64(path.join(example,'arpege.musicxml'))],
  arpegeMid:['audio/midi',b64(path.join(example,'arpege.mid'))],
  accordsXml:['application/xml',b64(path.join(example,'accords.musicxml'))],
  accordsMid:['audio/midi',b64(path.join(example,'accords.mid'))],
  voix:['audio/wav',lightVoice()],
  pdf:['application/pdf',b64(path.join(root,'backend/web/demo/score.pdf'))]
};
const sounds={};
const steel=path.join(root,'backend/web/sounds/guitar-steel');
for(const name of fs.readdirSync(steel))if(name.endsWith('.mp3'))sounds[name]=b64(path.join(steel,name));

const shim=`
(() => {
  const FILES=${JSON.stringify(files)};
  const SOUNDS=${JSON.stringify(sounds)};
  const bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
  // La démo s'ouvre directement sur la partition d'exemple.
  window.addEventListener('load',()=>{
    let tries=0;
    const timer=setInterval(()=>{
      const first=document.querySelector('#side-recents button[data-job]');
      if(first)first.click();
      if(first||++tries>40)clearInterval(timer);
    },150);
  });
  window.__demoRoute={pathname:'/app',push(path){this.pathname=String(path).split(/[?#]/)[0]||'/';}};
  const duration=16*4*60/92,now=Math.floor(Date.now()/1000);
  const base={track:true,instrument:'guitare',format:'tablature',status:'completed',source_type:'link',source_name:'YouTube',
    duration,note_count:142,guitar_compare:true,guitar_goal:'solo',capo:0,
    diagnostic:{matched_attacks:131,total_attacks:142,filtered_notes:3,tab_chords:16,tab_notes:142,review_seconds:[7,13,25]}};
  const all=['mid','musicxml','tab','pdf','solotab','solomid','rhythmtab','rhythmmid','vocals'];
  const jobs=[
    {...base,id:'exemple-complet',title:'Balade d’exemple (accès complet)',created_at:now-3600,downloads:all},
    {...base,id:'exemple-apercu',title:'Balade d’exemple (aperçu gratuit 30 s)',created_at:now-86400,preview_limit:30,preview_duration:30,
      downloads:all.filter(key=>key!=='pdf')},
    {...base,id:'exemple-choisi',title:'Balade d’exemple (version déjà choisie)',created_at:now-172800,downloads:all}
  ];
  const choices={'exemple-choisi':'solo-demo'};
  const versions=[
    {key:'solo-demo',score:'solotab',midi:'solomid',recommended:true,recommendation_source:'ai'},
    {key:'accords-demo',score:'rhythmtab',midi:'rhythmmid',recommended:false,recommendation_source:null}
  ];
  const exportsMap={solotab:'arpegeXml',solomid:'arpegeMid',rhythmtab:'accordsXml',rhythmmid:'accordsMid',
    tab:'arpegeXml',musicxml:'arpegeXml',mid:'arpegeMid',vocals:'voix',pdf:'pdf'};
  const names={arpegeXml:'tablature.musicxml',arpegeMid:'tablature.mid',accordsXml:'accords.musicxml',accordsMid:'accords.mid',voix:'voix.wav',pdf:'exemple.pdf'};
  const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  const file=key=>new Response(bytes(FILES[key][1]),{status:200,headers:{'Content-Type':FILES[key][0]}});
  function answer(input,options={}){
    const url=new URL(input instanceof Request?input.url:String(input),'https://demo.songtosheet.local');
    const route=url.pathname;
    if(route==='/api/auth/me')return json(200,{user:{id:'demo',email:'demo@songtosheet.local',role:'admin'}});
    if(route==='/api/jobs')return json(200,{jobs});
    if(route.startsWith('/api/jobs/')){
      const job=jobs.find(item=>item.id===decodeURIComponent(route.slice(10)));
      return job?json(200,job):json(404,{detail:'Création introuvable.'});
    }
    if(route==='/api/track'){
      if((options.method||'GET')==='POST'){
        const data=JSON.parse(options.body||'{}');
        if(data.action==='guitar_vote'){choices[data.id]=data.choice;return json(200,{selected:data.choice});}
        return json(400,{detail:'Action indisponible dans la démo.'});
      }
      const id=url.searchParams.get('id');
      if(url.searchParams.get('comparison')==='1')return json(200,{token:'demo',versions,selected:choices[id]||null});
      const key=exportsMap[url.searchParams.get('download')];
      return key?file(key):json(404,{detail:'Export indisponible.'});
    }
    const sound=route.match(/\\/sounds\\/guitar-steel\\/(\\d+\\.mp3)$/);
    if(sound&&SOUNDS[sound[1]])return new Response(bytes(SOUNDS[sound[1]]),{status:200,headers:{'Content-Type':'audio/mpeg'}});
    return json(404,{detail:'Indisponible dans la démo.'});
  }
  window.fetch=(input,options)=>{
    if(options?.signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
    try{return Promise.resolve(answer(input,options));}catch(error){return Promise.reject(error);}
  };
  // Dans un aperçu intégré (cadre isolé), le stockage du navigateur est refusé : on le remplace par une mémoire locale.
  for(const name of ['sessionStorage','localStorage']){
    let usable=false;
    try{window[name].getItem('demo');usable=true;}catch{/* refusé */}
    if(usable)continue;
    const data=new Map();
    const memory={getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>{data.set(key,String(value));},
      removeItem:key=>{data.delete(key);},clear:()=>data.clear(),key:index=>[...data.keys()][index]??null,get length(){return data.size;}};
    try{Object.defineProperty(window,name,{configurable:true,get:()=>memory});}
    catch{try{Object.defineProperty(Window.prototype,name,{configurable:true,get:()=>memory});}catch{/* sans stockage */}}
  }
  // Les liens de téléchargement pointent vers l'API : dans la démo, on remet le fichier d'exemple.
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href^="/api/track"]');
    if(!link)return;
    event.preventDefault();
    const key=exportsMap[new URL(link.getAttribute('href'),'https://demo.songtosheet.local').searchParams.get('download')];
    if(!key)return;
    try{
      const anchor=document.createElement('a');
      anchor.href=URL.createObjectURL(new Blob([bytes(FILES[key][1])],{type:FILES[key][0]}));
      anchor.download=names[key];
      anchor.click();
    }catch{/* Le téléchargement peut être bloqué selon l'endroit où la démo est ouverte. */}
  },true);
})();`;

let html=read('index.html');
const replaceAll=(text,from,to,min=1)=>{
  const count=text.split(from).length-1;
  if(count<min)throw new Error(`Motif introuvable : ${from}`);
  return text.split(from).join(to);
};
const route=code=>code.replace(/(?:window\.)?location\.pathname/g,'__demoRoute.pathname')
  .replace(/(?:window\.)?location\.origin/g,"'https://demo.songtosheet.local'")
  .replace(/history\.(?:push|replace)State\(\{\},'',/g,'__demoRoute.push(');
const scripts=[];
const local=src=>src.split('?')[0].replace(/^\//,'');
// Feuilles de style du projet → <style>
html=html.replace(/<link rel="stylesheet" href="(\/[^"]+)"\s*\/?>/g,(_,href)=>`<style>${read(local(href))}</style>`);
// Scripts différés du projet → regroupés en fin de page, dans le même ordre d'exécution
html=html.replace(/<script src="(\/[^"]+)" defer><\/script>/g,(_,src)=>{scripts.push(local(src));return '';});
html=route(html);
const mark='data:image/svg+xml;base64,'+b64(path.join(root,'assets/songtosheet-wave-mark.svg'));
html=replaceAll(html,'/assets/songtosheet-wave-mark.svg',mark);
html=html.replace(/<link rel="icon"[^>]*>/g,'');
if(/history\.(push|replace)State/.test(html))throw new Error('Navigation non convertie.');

const osmd=fs.readFileSync(require.resolve('opensheetmusicdisplay',{paths:[root]}),'utf8');
const midi=fs.readFileSync(require.resolve('@tonejs/midi',{paths:[root]}),'utf8');
let tail=`<script>${inlineJs(osmd)}</script>\n<script>${inlineJs(midi)}</script>\n`;
for(const file of scripts){
  let code=route(read(file));
  if(file.endsWith('score-player.js')){
    code=replaceAll(code,"new URL('sounds/',document.currentScript.src)","new URL('https://demo.songtosheet.local/backend/web/sounds/')");
    code=replaceAll(code,"if(!scripts.has(asset))scripts.set(asset,new Promise(","if(!scripts.has(asset))scripts.set(asset,Promise.resolve());if(false)scripts.set(asset,new Promise(");
  }
  tail+=`<script>${inlineJs(code)}</script>\n`;
}
html=replaceAll(html,'<meta charset="UTF-8" />',`<meta charset="UTF-8" />\n<script>${inlineJs(shim)}</script>`);
html=html.replace(/<title>[^<]*<\/title>/,'<title>SongToSheet — démo de l’écran partition</title>');
const end=html.lastIndexOf('</body>');
html=html.slice(0,end)+tail+html.slice(end);
const out=path.join(example,'songtosheet-demo.html');
fs.writeFileSync(out,html);
console.log(out,(fs.statSync(out).size/1048576).toFixed(1)+' Mo');

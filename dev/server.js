'use strict';
// Démo locale de l'interface : sert le site statique et simule l'API avec une tablature d'exemple.
// Aucune base de données, aucun secret : `node dev/server.js` puis http://localhost:4173/app
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const example=path.join(__dirname,'example');
if(!fs.existsSync(path.join(example,'arpege.musicxml')))require('./make-example.js');
const port=Number(process.env.PORT)||4173;
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.mp3':'audio/mpeg','.wav':'audio/wav','.txt':'text/plain; charset=utf-8',
  '.mid':'audio/midi','.musicxml':'application/xml; charset=utf-8','.pdf':'application/pdf'};
const pages=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8')).rewrites.map(item=>item.source);
const duration=32*4*60/92;
const now=Math.floor(Date.now()/1000);
const files={
  solotab:'arpege.musicxml',solomid:'arpege.mid',rhythmtab:'accords.musicxml',rhythmmid:'accords.mid',
  tab:'arpege.musicxml',musicxml:'arpege.musicxml',mid:'arpege.mid',vocals:'voix.wav',
  pdf:path.join(root,'backend/web/demo/score.pdf')
};
const base={track:true,instrument:'guitare',format:'tablature',status:'completed',source_type:'link',source_name:'YouTube',
  duration,note_count:142,guitar_compare:true,guitar_goal:'solo',capo:0,
  diagnostic:{matched_attacks:131,total_attacks:142,filtered_notes:3,tab_chords:16,tab_notes:142,review_seconds:[7,13,25]}};
const jobs=[
  {...base,id:'exemple-apercu',title:'Balade d’exemple (compte gratuit, suite masquée)',created_at:now-3600,preview_limit:30,preview_duration:30,
    downloads:['mid','musicxml','tab','solotab','solomid','rhythmtab','rhythmmid','vocals']},
  {...base,id:'exemple-extrait',title:'Balade d’exemple (extrait d’un lien, durée totale inconnue)',created_at:now-7200,preview_limit:30,preview_duration:28.7,
    duration:28.7,excerpt:true,downloads:['mid','musicxml','tab','solotab','solomid','rhythmtab','rhythmmid','vocals']},
  {...base,id:'exemple-complet',title:'Balade d’exemple (accès complet)',created_at:now-86400,
    downloads:['mid','musicxml','tab','pdf','solotab','solomid','rhythmtab','rhythmmid','vocals']},
  {...base,id:'exemple-choisi',title:'Balade d’exemple (version déjà choisie)',created_at:now-172800,
    downloads:['mid','musicxml','tab','pdf','solotab','solomid','rhythmtab','rhythmmid']},
  {...base,id:'exemple-en-cours',title:'Balade d’exemple (transcription en cours)',created_at:now-300,status:'processing',
    stage:'processing',note_count:0,diagnostic:undefined,downloads:[]}
];
for(let i=1;i<=7;i++)jobs.push({...base,id:'exemple-ancien-'+i,title:'Ancienne partition '+i,created_at:now-(3+i)*86400,
  downloads:['mid','musicxml','tab','pdf','solotab','solomid','rhythmtab','rhythmmid']});
const choices={'exemple-choisi':'solo-demo'};
const versions=[
  {key:'solo-demo',score:'solotab',midi:'solomid',recommended:true,recommendation_source:'ai'},
  {key:'held-demo',score:'rhythmtab',midi:'rhythmmid',recommended:false,recommendation_source:null}
];
const learn={},learnUser={xp:0,streak:null};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const send=(res,file,download)=>{
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);res.end('Introuvable');return;}
    const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'};
    if(download)headers['Content-Disposition']=`attachment; filename="${download}"`;
    res.writeHead(200,headers);res.end(data);
  });
};
const body=req=>new Promise(resolve=>{let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>{try{resolve(JSON.parse(text||'{}'));}catch{resolve({});}});});

http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const route=url.pathname;
  if(route==='/api/auth/me')return json(res,200,{user:{id:'demo',email:'demo@songtosheet.local',role:'admin'}});
  if(route==='/api/jobs')return json(res,200,{jobs});
  if(route.startsWith('/api/jobs/')){
    const job=jobs.find(item=>item.id===decodeURIComponent(route.slice(10)));
    return job?json(res,200,job):json(res,404,{detail:'Création introuvable.'});
  }
  if(route==='/api/track'){
    if(req.method==='POST'){
      const data=await body(req);
      if(data.action==='guitar_vote'){choices[data.id]=data.choice;return json(res,200,{selected:data.choice});}
      return json(res,400,{detail:'Action indisponible dans la démo locale.'});
    }
    const id=url.searchParams.get('id');
    if(url.searchParams.get('comparison')==='1')return json(res,200,{token:'demo',versions,selected:choices[id]||null});
    const kind=url.searchParams.get('download');
    if(Object.hasOwn(files,kind)){
      // Compte gratuit : seul le relevé des 30 premières secondes est servi, jamais la suite.
      const limited=jobs.find(item=>item.id===id)?.preview_limit&&/\.(musicxml|mid)$/.test(files[kind]);
      const name=limited?files[kind].replace('.','-apercu.'):files[kind];
      const file=path.isAbsolute(name)?name:path.join(example,name);
      return send(res,file,req.headers['sec-fetch-dest']==='empty'?null:'exemple-'+kind+path.extname(file));
    }
    return json(res,404,{detail:'Export indisponible.'});
  }
  if(route==='/api/player-assets'){
    const asset={score:'opensheetmusicdisplay',midi:'@tonejs/midi'}[url.searchParams.get('asset')];
    return asset?send(res,require.resolve(asset,{paths:[root]})):json(res,404,{detail:'Ressource introuvable.'});
  }
  if(route==='/api/learn'){
    // Progression du mode Apprentissage, gardée en mémoire le temps de la démo.
    const {starsFor,xpFor}=require('../backend/web/learn-core.js');
    const {nextStreak,currentStreak}=require('../lib/learn.js');
    if(req.method==='GET'){
      const doc=learn[url.searchParams.get('id')+'|'+url.searchParams.get('version')];
      return json(res,200,{levels:doc?.levels||{},xp:doc?.xp||0,xp_total:learnUser.xp,streak:currentStreak(learnUser.streak,url.searchParams.get('day'))});
    }
    const data=await body(req);
    const doc=learn[data.id+'|'+data.version]??={levels:{},xp:0};
    if(data.action==='unlock')return json(res,200,{ok:true});
    const job=jobs.find(item=>item.id===data.id);
    if(job?.preview_limit&&data.end>job.preview_duration+.5)return json(res,403,{detail:'Niveau hors de ton aperçu.'});
    const mic=data.mic===true,acc=Math.min(1,Math.max(0,+data.accuracy||0)),speed=Math.min(1,Math.max(.6,+data.speed||0));
    const stars=mic?starsFor(acc,speed):0,gained=mic?xpFor({...data,accuracy:acc,speed}):0;
    const before=doc.levels[data.level]||{stars:0,checked:false,best_accuracy:0,best_speed:0,attempts:0};
    const level={...before,stars:Math.max(before.stars,stars),checked:before.checked||!mic,best_accuracy:Math.max(before.best_accuracy,mic?acc:0),
      best_speed:stars?Math.max(before.best_speed,speed):before.best_speed,attempts:before.attempts+1,mic:before.mic||Boolean(stars)};
    doc.levels[data.level]=level;doc.xp+=gained;learnUser.xp+=gained;
    if(stars||!mic)learnUser.streak=nextStreak(learnUser.streak,data.day);
    return json(res,200,{level,xp_gained:gained,xp_total:learnUser.xp,streak:currentStreak(learnUser.streak,data.day)});
  }
  if(route.startsWith('/api/'))return json(res,404,{detail:'Indisponible dans la démo locale.'});
  const file=route==='/'||pages.includes(route)||/^\/app(\/|$)/.test(route)?'index.html':path.normalize(decodeURIComponent(route)).replace(/^([/\\]|\.\.)+/,'');
  const target=path.join(root,file);
  if(!target.startsWith(root))return json(res,403,{});
  send(res,target);
}).listen(port,'127.0.0.1',()=>console.log(`Démo locale SongToSheet : http://localhost:${port}/app`));

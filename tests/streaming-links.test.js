'use strict';
const test=require('node:test');
const assert=require('node:assert');
const path=require('node:path');

const root=path.join(__dirname,'..');
function fresh(id){delete require.cache[require.resolve(path.join(root,id))];return require(path.join(root,id));}

function jsonResponse(body){
  return {ok:true,status:200,text:async()=>JSON.stringify(body),json:async()=>body,headers:new Map(),body:null};
}

async function call(query){
  const handler=fresh('api/media-info.js');
  const res={headers:{},code:0,payload:null,
    setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(p){this.payload=p;return this;}};
  await handler({method:'GET',query},res);
  return res;
}

test('a Deezer link resolves to the same song on YouTube',async()=>{
  process.env.YOUTUBE_DATA_API_KEY='k';
  delete process.env.DEEZER_PREVIEW_AUTHORIZED;
  const searched=[];
  global.fetch=async url=>{
    url=String(url);
    if(url.startsWith('https://api.deezer.com/track/'))
      return jsonResponse({title:'Bohemian Rhapsody (Remastered 2011)',artist:{name:'Queen'},duration:354});
    if(url.startsWith('https://www.googleapis.com/youtube/v3/search')){
      searched.push(new URL(url).searchParams.get('q'));
      return jsonResponse({items:[
        {id:{videoId:'aaaaaaaaaaa'},snippet:{title:'Bohemian Rhapsody - Piano Cover',channelTitle:'Some Pianist'}},
        {id:{videoId:'fJ9rUzIMcZQ'},snippet:{title:'Queen – Bohemian Rhapsody (Official Video Remastered)',channelTitle:'Queen Official'}}
      ]});
    }
    throw new Error('unexpected '+url);
  };
  const res=await call({url:'https://www.deezer.com/fr/track/568115892',resolve:'youtube'});
  assert.strictEqual(res.code,200);
  assert.strictEqual(res.payload.version.url,'https://www.youtube.com/watch?v=fJ9rUzIMcZQ');
  assert.match(searched[0],/Queen Bohemian Rhapsody/);
  assert.doesNotMatch(searched[0],/Remastered/);  // edition tags would hide the official upload
});

test('the page turns a Deezer link into the YouTube version',async()=>{
  const audioSource=fresh('assets/audio-source.js');
  const asked=[];
  global.fetch=async url=>{asked.push(String(url));
    return {ok:true,status:200,json:async()=>({title:'Song',version:{url:'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',title:'Artist - Song'}})};};
  const version=await audioSource.resolveVersion(audioSource.parse('https://www.deezer.com/track/1'));
  assert.strictEqual(version.audioUrl,'https://www.youtube.com/watch?v=fJ9rUzIMcZQ');
  assert.match(asked[0],/resolve=youtube/);
});

test('the hint explains what to do when no match was found',()=>{
  const audioSource=fresh('assets/audio-source.js');
  const hint=audioSource.importHint('Deezer');
  assert.match(hint,/YouTube/);
  assert.doesNotMatch(hint,/sert de référence/);
});

test('the studio version is preferred over a medley or a live take',async()=>{
  process.env.YOUTUBE_DATA_API_KEY='k';
  global.fetch=async url=>{
    url=String(url);
    if(url.startsWith('https://api.deezer.com/track/'))
      return jsonResponse({title:'Harder, Better, Faster, Stronger',artist:{name:'Daft Punk'},duration:224});
    return jsonResponse({items:[
      {id:{videoId:'kcxK1Tnwy5M'},snippet:{title:'Around the World / Harder, Better, Faster, Stronger',channelTitle:'Daft Punk'}},
      {id:{videoId:'bbbbbbbbbbb'},snippet:{title:'Daft Punk - Harder, Better, Faster, Stronger (Live)',channelTitle:'Daft Punk'}},
      {id:{videoId:'gAjR4_CbPpQ'},snippet:{title:'Daft Punk - Harder, Better, Faster, Stronger (Official Video)',channelTitle:'Daft Punk'}},
      {id:{videoId:'yydNF8tuVmU'},snippet:{title:'Harder, Better, Faster, Stronger',channelTitle:'Daft Punk - Topic'}}
    ]});
  };
  const res=await call({url:'https://www.deezer.com/track/3135556',resolve:'youtube'});
  assert.strictEqual(res.payload.version.url,'https://www.youtube.com/watch?v=yydNF8tuVmU');
});

test('without a Topic upload, the exact official title wins over a medley',async()=>{
  process.env.YOUTUBE_DATA_API_KEY='k';
  global.fetch=async url=>{
    url=String(url);
    if(url.startsWith('https://api.deezer.com/track/'))
      return jsonResponse({title:'Harder, Better, Faster, Stronger',artist:{name:'Daft Punk'},duration:224});
    return jsonResponse({items:[
      {id:{videoId:'kcxK1Tnwy5M'},snippet:{title:'Around the World / Harder, Better, Faster, Stronger',channelTitle:'Daft Punk'}},
      {id:{videoId:'gAjR4_CbPpQ'},snippet:{title:'Daft Punk - Harder, Better, Faster, Stronger (Official Video)',channelTitle:'Daft Punk'}}
    ]});
  };
  const res=await call({url:'https://www.deezer.com/track/3135556',resolve:'youtube'});
  assert.strictEqual(res.payload.version.url,'https://www.youtube.com/watch?v=gAjR4_CbPpQ');
});

function searchReturning(items,track={title:'Message',artist:{name:'Klem Schen'},duration:200}){
  const searched=[];
  global.fetch=async url=>{
    url=String(url);
    if(url.startsWith('https://api.deezer.com/track/'))return jsonResponse(track);
    searched.push(new URL(url).searchParams.get('q'));
    return jsonResponse({items});
  };
  return searched;
}

test('an unrequested variant (acoustic) loses even from a Topic channel',async()=>{
  process.env.YOUTUBE_DATA_API_KEY='k';
  searchReturning([
    {id:{videoId:'acoustic001'},snippet:{title:'Message (Version Acoustique)',channelTitle:'Klem Schen - Topic'}},
    {id:{videoId:'original001'},snippet:{title:'Klem Schen - Message (Clip Officiel)',channelTitle:'Klem Schen'}}
  ]);
  const res=await call({url:'https://www.deezer.com/track/1',resolve:'youtube'});
  assert.strictEqual(res.payload.version.url,'https://www.youtube.com/watch?v=original001');
  assert.deepStrictEqual(res.payload.versions.map(item=>item.url),[
    'https://www.youtube.com/watch?v=original001','https://www.youtube.com/watch?v=acoustic001']);
  assert.strictEqual(res.payload.versions[1].channel,'Klem Schen - Topic');
});

test('a requested variant is kept in the search and preferred',async()=>{
  process.env.YOUTUBE_DATA_API_KEY='k';
  const searched=searchReturning([
    {id:{videoId:'original001'},snippet:{title:'Klem Schen - Message (Clip Officiel)',channelTitle:'Klem Schen'}},
    {id:{videoId:'acoustic001'},snippet:{title:'Message (Version Acoustique)',channelTitle:'Klem Schen - Topic'}}
  ],{title:'Message (Version Acoustique)',artist:{name:'Klem Schen'},duration:200});
  const res=await call({url:'https://www.deezer.com/track/2',resolve:'youtube'});
  assert.match(searched[0],/Version Acoustique/);
  assert.strictEqual(res.payload.version.url,'https://www.youtube.com/watch?v=acoustic001');
});

test('the page offers the other versions found',async()=>{
  const audioSource=fresh('assets/audio-source.js');
  global.fetch=async()=>({ok:true,status:200,json:async()=>({title:'Message',
    version:{url:'https://www.youtube.com/watch?v=original001',title:'Klem Schen - Message'},
    versions:[{url:'https://www.youtube.com/watch?v=original001',title:'Klem Schen - Message',channel:'Klem Schen'},
      {url:'https://www.youtube.com/watch?v=acoustic001',title:'Message (Version Acoustique)',channel:'Klem Schen - Topic'}]})});
  const version=await audioSource.resolveVersion(audioSource.parse('https://www.deezer.com/track/1'));
  assert.deepStrictEqual(version.alternatives,[{audioUrl:'https://www.youtube.com/watch?v=acoustic001',
    versionLabel:'Version proposée sur YouTube · Message (Version Acoustique)',title:'Message (Version Acoustique)',
    channel:'Klem Schen - Topic'}]);
});

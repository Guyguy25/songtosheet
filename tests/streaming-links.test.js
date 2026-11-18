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

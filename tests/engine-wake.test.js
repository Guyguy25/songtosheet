'use strict';
const test=require('node:test');
const assert=require('node:assert');
const Module=require('node:module');
const crypto=require('node:crypto');
const path=require('node:path');

const root=path.join(__dirname,'..');
function fresh(id){delete require.cache[require.resolve(path.join(root,id))];return require(path.join(root,id));}

test('no URL configured: no request',async()=>{
  delete process.env.ENGINE_WAKE_URL;
  let calls=0;global.fetch=async()=>{calls++;};
  await fresh('lib/engine-wake.js').wakeEngine();
  assert.strictEqual(calls,0);
});

test('posts the shared secret',async()=>{
  process.env.ENGINE_WAKE_URL='https://engine.example/wake';process.env.ENGINE_WAKE_SECRET='s3cret';
  const seen=[];global.fetch=async(url,options)=>{seen.push([url,options]);return {ok:true};};
  await fresh('lib/engine-wake.js').wakeEngine();
  assert.strictEqual(seen.length,1);
  assert.strictEqual(seen[0][0],'https://engine.example/wake');
  assert.strictEqual(seen[0][1].method,'POST');
  assert.strictEqual(seen[0][1].headers.authorization,'Bearer s3cret');
});

test('slow or failing engine does not throw or block',async()=>{
  process.env.ENGINE_WAKE_URL='https://engine.example/wake';process.env.ENGINE_WAKE_SECRET='s3cret';
  const {wakeEngine}=fresh('lib/engine-wake.js');
  global.fetch=(url,{signal})=>new Promise((_,reject)=>{
    const hang=setTimeout(()=>{},10000); // like a real socket, keeps the process alive
    signal.addEventListener('abort',()=>{clearTimeout(hang);reject(new Error('aborted'));});
  });
  const started=Date.now();
  await wakeEngine();
  assert.ok(Date.now()-started<2500);
  global.fetch=async()=>{throw new Error('down');};
  await wakeEngine();
});

test('peek reports a queued job',async()=>{
  const {ObjectId}=require(path.join(root,'node_modules/mongodb'));
  const token='a'.repeat(64);
  process.env.TRACK_WORKER_DIGEST=crypto.createHash('sha256').update(token).digest('hex');
  let queued=true;
  const db={collection:()=>({findOne:async filter=>filter.status==='queued'&&queued?{_id:new ObjectId()}:null,updateOne:async()=>({matchedCount:1}),createIndex:async()=>{}})};
  const original=Module._load;
  Module._load=function(request,...rest){if(request.endsWith('lib/mongodb'))return {database:async()=>db};return original.call(this,request,...rest);};
  const handler=fresh('api/track.js');
  Module._load=original;
  const call=async headers=>{
    const res={statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;},end(body){this.body=body;}};
    await handler({method:'POST',headers,body:{action:'peek'},query:{}},res);
    return {status:res.statusCode,body:res.body};
  };
  assert.deepStrictEqual(await call({authorization:'Bearer '+token}),{status:200,body:{queued:true}});
  queued=false;
  assert.deepStrictEqual((await call({authorization:'Bearer '+token})).body,{queued:false});
  assert.strictEqual((await call({})).status,403);
});

test('scheduleWake hands the call to waitUntil and returns at once',async()=>{
  process.env.ENGINE_WAKE_URL='https://engine.example/wake';process.env.ENGINE_WAKE_SECRET='s3cret';
  const kept=[];
  const original=Module._load;
  Module._load=function(request,...rest){if(request==='@vercel/functions')return {waitUntil:promise=>kept.push(promise)};return original.call(this,request,...rest);};
  const {scheduleWake}=fresh('lib/engine-wake.js');
  let finish;global.fetch=()=>new Promise(resolve=>{finish=resolve;});
  const started=Date.now();
  await scheduleWake();
  Module._load=original;
  assert.ok(Date.now()-started<100);
  assert.strictEqual(kept.length,1);
  finish({ok:true,status:200});
  await kept[0];
});

test('peek ignores jobs whose queue wait has expired',async()=>{
  const token='b'.repeat(64);
  process.env.TRACK_WORKER_DIGEST=crypto.createHash('sha256').update(token).digest('hex');
  let seen;
  const db={collection:()=>({findOne:async filter=>{seen=filter;return null;},updateOne:async()=>({matchedCount:1}),createIndex:async()=>{}})};
  const original=Module._load;
  Module._load=function(request,...rest){if(request.endsWith('lib/mongodb'))return {database:async()=>db};return original.call(this,request,...rest);};
  const handler=fresh('api/track.js');
  Module._load=original;
  const res={statusCode:0,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;},end(){}};
  await handler({method:'POST',headers:{authorization:'Bearer '+token},body:{action:'peek'},query:{}},res);
  // Same conditions as claim: a job past its 5-minute queue wait must not wake a GPU.
  assert.ok(Array.isArray(seen.$nor)&&seen.$nor.length===1);
  assert.ok(seen.expires_at.$gt.getTime()>Date.now()+60*1000);
});

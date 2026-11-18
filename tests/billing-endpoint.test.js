'use strict';
const test=require('node:test');
const assert=require('node:assert');
const crypto=require('node:crypto');
const path=require('node:path');
const {Readable}=require('node:stream');
const {ObjectId}=require('mongodb');

const root=path.join(__dirname,'..');
const SECRET='ws_endpoint_secret_123';

function load(db){
  for(const id of ['lib/mongodb.js','api/billing.js','lib/billing-store.js'])delete require.cache[require.resolve(path.join(root,id))];
  require.cache[require.resolve(path.join(root,'lib/mongodb.js'))]={exports:{database:async()=>db,configured:()=>true}};
  return require(path.join(root,'api/billing.js'));
}
function request(body,headers){
  const req=Readable.from([Buffer.from(body)]);
  Object.assign(req,{method:'POST',query:{webhook:'whop'},headers:{host:'songtosheet.vercel.app',...headers}});
  return req;
}
function response(){
  return {code:0,payload:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(p){this.payload=p;return this;}};
}
function signed(body,id='msg_'+crypto.randomUUID()){
  const timestamp=String(Math.floor(Date.now()/1000));
  const mac=crypto.createHmac('sha256',Buffer.from(SECRET)).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+mac};
}

// Same in-memory database as the store tests, reduced to what the endpoint touches.
function fakeDb(users){
  const data={users};
  const matches=(doc,filter)=>Object.entries(filter).every(([k,v])=>v instanceof ObjectId?doc[k]?.equals?.(v):doc[k]===v);
  return {data,collection:name=>{
    const docs=data[name]??=[];
    return {createIndex:async()=>null,findOne:async f=>docs.find(d=>matches(d,f))||null,
      insertOne:async d=>{if(docs.some(o=>o._id===d._id))throw Object.assign(new Error('dup'),{code:11000});docs.push(d);},
      updateOne:async(f,u,o={})=>{let d=docs.find(x=>matches(x,f));if(!d&&o.upsert){d={...f};docs.push(d);}if(d)Object.assign(d,u.$set||{});}};
  }};
}

test('an unsigned webhook changes nothing',async()=>{
  process.env.WHOP_WEBHOOK_SECRET=SECRET;
  const db=fakeDb([]);
  const res=response();
  await load(db)(request('{"type":"membership.activated"}',{}),res);
  assert.strictEqual(res.code,401);
  assert.strictEqual(db.data.billing_events,undefined);
});

test('a signed activation gives the account its plan, once',async()=>{
  process.env.WHOP_WEBHOOK_SECRET=SECRET;
  delete process.env.WHOP_API_KEY;
  const account={_id:new ObjectId(),email:'tanguy@example.fr'};
  const db=fakeDb([account]);
  const body=JSON.stringify({type:'membership.activated',data:{id:'mem_1',status:'active',plan:{id:'plan_IDC4CtmdcNpi7'},
    renewal_period_end:Math.floor(Date.now()/1000)+30*86400,metadata:{user_id:String(account._id)}}});
  const headers=signed(body);
  const handler=load(db);
  const res=response();
  await handler(request(body,headers),res);
  assert.strictEqual(res.code,200);
  assert.strictEqual(account.billing.tier,'starter');
  assert.strictEqual(account.billing.active,true);
  const again=response();
  await handler(request(body,headers),again);
  assert.strictEqual(again.payload.duplicate,true);
});

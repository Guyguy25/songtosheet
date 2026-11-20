'use strict';
const test=require('node:test');
const assert=require('node:assert');
const {ObjectId}=require('mongodb');
const {collect,stats,sourceOf,device,browser}=require('../lib/analytics.js');

function fakeDb(){
  const data={};
  const ok=(d,f)=>Object.entries(f).every(([k,v])=>{
    const a=d[k];
    if(v&&typeof v==='object'&&!(v instanceof ObjectId)&&!(v instanceof Date)){
      if('$gte' in v)return a!=null&&new Date(a)>=v.$gte;
      if('$ne' in v)return a!==v.$ne;
    }
    return v instanceof ObjectId?a?.equals?.(v):a===v;
  });
  return {data,collection:name=>{
    const docs=data[name]??=[];
    return {
      find:f=>{const list=docs.filter(d=>ok(d,f));const c={limit:()=>c,toArray:async()=>list};return c;},
      updateOne:async(f,u,o={})=>{
        let d=docs.find(x=>ok(x,f));
        if(!d&&o.upsert){d={...u.$setOnInsert};docs.push(d);}
        if(!d)return;
        Object.assign(d,u.$set||{});
        for(const [k,v] of Object.entries(u.$inc||{}))d[k]=(d[k]||0)+v;
        for(const [k,v] of Object.entries(u.$min||{})){const [a,b]=k.split('.');d[a]??={};if(!d[a][b]||v<d[a][b])d[a][b]=v;}
      }};
  }};
}
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_34.1.0 BytedanceWebview/d8a21c6';
const req=(ua,country='FR')=>({headers:{'user-agent':ua,'x-vercel-ip-country':country}});
const NOW=new Date('2026-11-20T12:00:00Z');

test('sources come from the utm tag, the in-app browser, then the referrer',()=>{
  assert.strictEqual(sourceOf({utm_source:'TikTok'}),'tiktok');
  assert.strictEqual(sourceOf({},IPHONE),'tiktok');
  assert.strictEqual(sourceOf({referrer:'https://www.google.fr/'}),'google');
  assert.strictEqual(sourceOf({referrer:'https://tablurio.com/tarifs'}),'direct');
  assert.strictEqual(sourceOf({}),'direct');
  assert.strictEqual(device(IPHONE),'Mobile');
  assert.strictEqual(browser(IPHONE),'TikTok (in-app)');
});

test('bots and malformed ids are not recorded',async()=>{
  const db=fakeDb();
  assert.strictEqual((await collect(db,req('Googlebot/2.1'),{visitor:'abcdefghijklmnop1234',step:'view'},null)).status,204);
  assert.strictEqual((await collect(db,req(IPHONE),{visitor:'x',step:'view'},null)).status,400);
  assert.strictEqual((db.data.analytics_visitors||[]).length,0);
});

test('the funnel follows a TikTok visitor from the landing page to a paid plan',async()=>{
  const db=fakeDb();
  const user={_id:new ObjectId(),email:'a@b.fr',created_at:new Date('2026-11-20T10:05:00Z'),
    billing:{active:true,tier:'starter',period_end:new Date('2026-12-20T00:00:00Z')}};
  db.data.users=[user,{_id:new ObjectId(),role:'admin',email:'admin@x.fr',created_at:NOW}];
  db.data.track_jobs=[{user_id:user._id,created_at:new Date('2026-11-20T10:06:00Z'),preview_limit:30,status:'completed'},
    {user_id:user._id,created_at:new Date('2026-11-20T10:20:00Z'),variant:'solo',status:'completed'}];
  const t=new Date('2026-11-20T10:00:00Z');
  await collect(db,req(IPHONE,'US'),{visitor:'visitor-tiktok-0001',step:'view',path:'/'},null,t);
  await collect(db,req(IPHONE,'US'),{visitor:'visitor-tiktok-0001',step:'engaged'},null,t);
  await collect(db,req(IPHONE,'US'),{visitor:'visitor-tiktok-0001',step:'identify'},user,t);
  // A server bot: views the page, never interacts.
  await collect(db,req('Mozilla/5.0 (X11; Linux x86_64) Chrome/120','NL'),{visitor:'visitor-robot-00001',step:'view'},null,t);
  const result=await stats(db,{days:7},NOW);
  assert.strictEqual(result.kpis.visitors,1);
  assert.strictEqual(result.kpis.bots,1);
  assert.deepStrictEqual(result.funnel.map(s=>s.value),[1,1,1,1,1,1]);
  assert.strictEqual(result.kpis.paying,1);
  assert.strictEqual(result.kpis.mrr,10);
  assert.strictEqual(result.breakdowns.source[0].key,'tiktok');
  assert.strictEqual(result.recent[0].source,'tiktok');
  assert.strictEqual(result.recent[0].country,'US');
  assert.strictEqual(result.series.reduce((n,d)=>n+d.signups,0),1);
});

test('an untagged visit from the TikTok app is counted as the bio link',async()=>{
  const db=fakeDb();
  await collect(db,req(IPHONE),{visitor:'visitor-plain-link-01',step:'view',path:'/'},null,NOW);
  const v=db.data.analytics_visitors[0];
  assert.strictEqual(v.source,'tiktok');
  assert.strictEqual(v.medium,'bio');
});

test('Instagram and Meta are told apart, Meta link checkers are robots',()=>{
  assert.strictEqual(sourceOf({},'Mozilla/5.0 (iPhone) Instagram 309.0.0'),'instagram');
  assert.strictEqual(sourceOf({referrer:'https://l.instagram.com/'}),'instagram');
  assert.strictEqual(sourceOf({},'Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/440.0]'),'meta');
  assert.strictEqual(sourceOf({referrer:'https://m.facebook.com/'}),'meta');
  assert.strictEqual(sourceOf({utm_source:'instagram'},'Mozilla/5.0 [FBAN/FBIOS]'),'instagram');
  assert.ok(require('../lib/analytics.js').BOT.test('meta-externalagent/1.1'));
});

test('the dashboard lists what was generated, by instrument',async()=>{
  const db=fakeDb();
  const user={_id:new ObjectId(),email:'g@b.fr',created_at:new Date('2026-11-20T09:00:00Z')};
  db.data.users=[user];
  db.data.track_jobs=[
    {user_id:user._id,created_at:new Date('2026-11-20T10:00:00Z'),finished_at:new Date('2026-11-20T10:01:05Z'),preview_limit:30,status:'completed',instrument:'guitare',title:'Rehab',youtube_id:'abcdefghijk',guitar_goal:'solo'},
    {user_id:user._id,created_at:new Date('2026-11-20T10:05:00Z'),variant:'yourmt3',status:'failed',instrument:'piano',title:'Back To Black'}];
  const result=await stats(db,{days:7},NOW);
  assert.strictEqual(result.generations[0].title,'Back To Black');
  assert.strictEqual(result.generations[1].seconds,65);
  assert.strictEqual(result.generations[1].account,'g@b.fr');
  assert.deepStrictEqual(result.instruments.map(i=>[i.key,i.previews,i.full,i.failed]).sort(),[['guitare',1,0,0],['piano',0,1,1]]);
});

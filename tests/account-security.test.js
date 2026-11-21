'use strict';
const test=require('node:test');
const assert=require('node:assert');
const {issueCode,checkCode}=require('../lib/codes.js');
const {allow}=require('../lib/rate-limit.js');
const {sendEmail,emailEnabled,TEMPLATES}=require('../lib/email.js');

function fakeDb(){
  const data={};
  return {data,collection:name=>{
    const docs=data[name]??=new Map();
    return {
      findOne:async({_id})=>docs.has(_id)?{...docs.get(_id)}:null,
      updateOne:async({_id},u,o={})=>{
        let d=docs.get(_id);
        if(!d&&o.upsert){d={_id};docs.set(_id,d);}
        if(!d)return;
        Object.assign(d,u.$set||{});
        for(const [k,v] of Object.entries(u.$inc||{}))d[k]=(d[k]||0)+v;
      },
      deleteOne:async({_id})=>docs.delete(_id)
    };
  }};
}
const NOW=new Date('2026-11-21T12:00:00Z');

test('a code works once, is stored hashed, and expires after 15 minutes',async()=>{
  const db=fakeDb();
  const code=await issueCode(db,'verify','u1',NOW);
  assert.match(code,/^\d{6}$/);
  assert.ok(!JSON.stringify([...db.data.email_codes.values()]).includes(code));
  assert.strictEqual(await checkCode(db,'verify','u1',code,new Date(+NOW+16*60000)),'expired');
  const again=await issueCode(db,'verify','u1',NOW);
  assert.strictEqual(await checkCode(db,'verify','u1',again,NOW),'ok');
  assert.strictEqual(await checkCode(db,'verify','u1',again,NOW),'expired');
});

test('five wrong codes lock it, even the right one afterwards',async()=>{
  const db=fakeDb();
  const code=await issueCode(db,'reset','a@b.fr',NOW);
  const wrong=code==='000000'?'111111':'000000';
  for(let i=0;i<4;i++)assert.strictEqual(await checkCode(db,'reset','a@b.fr',wrong,NOW),'wrong');
  assert.strictEqual(await checkCode(db,'reset','a@b.fr',wrong,NOW),'locked');
  assert.strictEqual(await checkCode(db,'reset','a@b.fr',code,NOW),'locked');
});

test('the rate limit counts hits in a window, then opens again',async()=>{
  const db=fakeDb();
  for(let i=0;i<3;i++)assert.strictEqual(await allow(db,'k',3,60000,NOW),true);
  assert.strictEqual(await allow(db,'k',3,60000,NOW),false);
  assert.strictEqual(await allow(db,'k',3,60000,new Date(+NOW+61000)),true);
});

test('without a Resend key nothing is sent, and templates carry the code',async()=>{
  delete process.env.RESEND_API_KEY;
  assert.strictEqual(emailEnabled(),false);
  assert.deepStrictEqual(await sendEmail('a@b.fr','verify',{code:'123456'}),{sent:false,reason:'disabled'});
  const mail=TEMPLATES.verify({code:'123456'});
  assert.match(mail.subject,/123456/);
  assert.match(mail.html,/123456/);
  assert.match(TEMPLATES.ready({title:'<b>x</b>',url:'https://tablurio.com/app/1'}).html,/&lt;b&gt;x/);
});

test('password reset token: works once, only for its address, and expires',async()=>{
  const {issueToken,useToken}=require('../lib/account-flows.js');
  const db=fakeDb();
  db.collection('email_codes').deleteOne=async({_id})=>db.data.email_codes.delete(_id);
  const token=await issueToken(db,'a@b.fr',new Date());
  assert.strictEqual(await useToken(db,'c@d.fr',token),false);
  assert.strictEqual(await useToken(db,'a@b.fr','0'.repeat(48)),false);
  assert.strictEqual(await useToken(db,'a@b.fr',token),true);
  assert.strictEqual(await useToken(db,'a@b.fr',token),false);
  const old=await issueToken(db,'a@b.fr',new Date(Date.now()-16*60000));
  assert.strictEqual(await useToken(db,'a@b.fr',old),false);
});

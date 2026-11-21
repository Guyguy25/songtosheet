'use strict';
const test=require('node:test');
const assert=require('node:assert');
const {ObjectId}=require('mongodb');
const {notifyReady}=require('../lib/ready-email.js');
const NOW=new Date('2026-11-21T12:00:00Z');

function setup(user){
  const sent=[];
  process.env.RESEND_API_KEY='test-key';process.env.EMAIL_FROM='Tablurio <bonjour@tablurio.com>';
  global.fetch=async(url,options)=>{sent.push(JSON.parse(options.body));return {ok:true};};
  const db={collection:()=>({findOne:async()=>user})};
  return {db,sent};
}
test.after(()=>{delete process.env.RESEND_API_KEY;delete process.env.EMAIL_FROM;});

test('the ready email goes out only when the person left the page',async()=>{
  const {db,sent}=setup({email:'a@b.fr'});
  const job={_id:new ObjectId(),user_id:new ObjectId(),title:'Rehab'};
  assert.strictEqual(await notifyReady(db,{...job,watched_at:new Date(+NOW-5000)},NOW),false);
  assert.strictEqual(await notifyReady(db,{...job,watched_at:new Date(+NOW-120000)},NOW),true);
  assert.strictEqual(sent.length,1);
  assert.deepStrictEqual(sent[0].to,['a@b.fr']);
  assert.match(sent[0].subject,/Rehab/);
  assert.match(sent[0].html,new RegExp(`/app/${job._id}`));
});

test('no email for guests or unverified addresses',async()=>{
  const {db,sent}=setup({email:'a@b.fr',email_verified:false});
  assert.strictEqual(await notifyReady(db,{_id:new ObjectId(),user_id:new ObjectId()},NOW),false);
  const guest=setup({email:'a@b.fr'});
  assert.strictEqual(await notifyReady(guest.db,{_id:new ObjectId(),user_id:new ObjectId(),guest_expires_at:NOW},NOW),false);
  assert.strictEqual(sent.length+guest.sent.length,0);
});

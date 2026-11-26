'use strict';
const test=require('node:test');
const assert=require('node:assert');
const crypto=require('node:crypto');

process.env.AUTH_SESSION_SECRET='test-secret-for-oauth-unit-tests-0123456789';
process.env.GOOGLE_CLIENT_ID='google-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET='google-secret';
const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
process.env.APPLE_CLIENT_ID='com.tablurio.web';
process.env.APPLE_TEAM_ID='TEAM123456';
process.env.APPLE_KEY_ID='KEY1234567';
process.env.APPLE_PRIVATE_KEY=privateKey.export({type:'pkcs8',format:'pem'}).replace(/\n/g,'\\n');

const oauth=require('../lib/oauth.js');
const {publicUser}=require('../lib/session.js');

const token=claims=>['e30',Buffer.from(JSON.stringify(claims)).toString('base64url'),'sig'].join('.');
const NOW=Date.parse('2026-11-26T12:00:00Z');
const base={iss:'https://accounts.google.com',aud:process.env.GOOGLE_CLIENT_ID,exp:NOW/1000+600,sub:'g-1',email:'Ana@Example.com',email_verified:true};

test('both providers are offered once their variables are set',()=>{
  assert.deepStrictEqual(oauth.available(),{google:true,apple:true});
});

test('Google claims: email lowercased, nonce, audience, issuer and expiry checked',()=>{
  const nonce='abc';
  const ok=oauth.verifyClaims('google',token({...base,nonce:oauth.sha(nonce)}),nonce,NOW);
  assert.deepStrictEqual(ok,{sub:'g-1',email:'ana@example.com',email_verified:true});
  assert.throws(()=>oauth.verifyClaims('google',token({...base,nonce:oauth.sha('other')}),nonce,NOW),/nonce/);
  assert.throws(()=>oauth.verifyClaims('google',token({...base,aud:'someone-else',nonce:oauth.sha(nonce)}),nonce,NOW),/audience/);
  assert.throws(()=>oauth.verifyClaims('google',token({...base,iss:'https://evil.example',nonce:oauth.sha(nonce)}),nonce,NOW),/issuer/);
  assert.throws(()=>oauth.verifyClaims('google',token({...base,exp:NOW/1000-3600,nonce:oauth.sha(nonce)}),nonce,NOW),/expired/);
});

test('Apple claims: email_verified may be the string "true"',()=>{
  const claims={iss:'https://appleid.apple.com',aud:'com.tablurio.web',exp:NOW/1000+600,sub:'a-1',email:'x@privaterelay.appleid.com',email_verified:'true',nonce:oauth.sha('n')};
  assert.strictEqual(oauth.verifyClaims('apple',token(claims),'n',NOW).email_verified,true);
});

test('Apple client secret is an ES256 JWT that verifies with the key',()=>{
  const jwt=oauth.appleClientSecret(NOW);
  const [h,p,s]=jwt.split('.');
  const header=JSON.parse(Buffer.from(h,'base64url'));const payload=JSON.parse(Buffer.from(p,'base64url'));
  assert.strictEqual(header.alg,'ES256');assert.strictEqual(header.kid,'KEY1234567');
  assert.strictEqual(payload.iss,'TEAM123456');assert.strictEqual(payload.sub,'com.tablurio.web');assert.strictEqual(payload.aud,'https://appleid.apple.com');
  assert.ok(crypto.verify('sha256',Buffer.from(h+'.'+p),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')));
});

function fakeUsers(initial=[]){
  const docs=initial.map(d=>({...d}));
  const get=(doc,path)=>path.split('.').reduce((v,k)=>v?.[k],doc);
  const match=(doc,query)=>Object.entries(query).every(([k,v])=>get(doc,k)===v);
  const users={
    findOne:async q=>{const d=docs.find(x=>match(x,q));return d?structuredClone(d):null;},
    insertOne:async d=>{const _id='id'+(docs.length+1);docs.push({...d,_id});return {insertedId:_id};},
    updateOne:async({_id},u)=>{const d=docs.find(x=>x._id===_id);
      for(const [k,v] of Object.entries(u.$set||{})){const parts=k.split('.');let t=d;while(parts.length>1){const p=parts.shift();t=t[p]??={};}t[parts[0]]=v;}
      for(const k of Object.keys(u.$unset||{}))delete d[k];}
  };
  return {docs,db:{collection:()=>users}};
}

test('a new Google identity creates a verified account that still owes its phone number',async()=>{
  const {db,docs}=fakeUsers();
  const result=await oauth.findOrCreateUser(db,'google',{sub:'g-1',email:'ana@example.com',email_verified:true},{lang:'en',country:'BE'});
  assert.strictEqual(result.created,true);
  assert.strictEqual(docs[0].oauth.google,'g-1');
  assert.strictEqual(docs[0].email_verified,true);
  assert.strictEqual(docs[0].phone_pending,true);
  assert.strictEqual(docs[0].password_hash,undefined);
  const pub=publicUser(result.user);
  assert.strictEqual(pub.phone_pending,true);assert.strictEqual(pub.has_password,false);assert.strictEqual(pub.email_verified,true);
  // Coming back: same account, found by the provider id.
  const again=await oauth.findOrCreateUser(db,'google',{sub:'g-1',email:'changed@example.com',email_verified:true});
  assert.strictEqual(again.created,false);assert.strictEqual(String(again.user._id),String(result.user._id));
});

test('an existing email account is linked, keeping its password',async()=>{
  const {db,docs}=fakeUsers([{_id:'u1',email:'ana@example.com',password_hash:'scrypt-v1$x$y',phone:'+33612345678'}]);
  const result=await oauth.findOrCreateUser(db,'apple',{sub:'a-1',email:'ana@example.com',email_verified:true});
  assert.strictEqual(result.linked,true);
  assert.strictEqual(docs[0].oauth.apple,'a-1');
  assert.strictEqual(docs[0].password_hash,'scrypt-v1$x$y');
  assert.strictEqual(publicUser(result.user).phone_pending,false);
});

test('linking an unconfirmed email account drops the password whoever set it chose',async()=>{
  const {db,docs}=fakeUsers([{_id:'u1',email:'ana@example.com',password_hash:'scrypt-v1$x$y',email_verified:false}]);
  const result=await oauth.findOrCreateUser(db,'google',{sub:'g-1',email:'ana@example.com',email_verified:true});
  assert.strictEqual(docs[0].password_hash,undefined);
  assert.strictEqual(docs[0].email_verified,true);
  assert.strictEqual(publicUser(result.user).has_password,false);
});

test('refused: unverified email, address tied to another Google account, too many sign-ups',async()=>{
  const {db}=fakeUsers([{_id:'u1',email:'ana@example.com',oauth:{google:'g-other'}}]);
  assert.strictEqual((await oauth.findOrCreateUser(db,'google',{sub:'g-2',email:'bob@example.com',email_verified:false})).error,'email_missing');
  assert.strictEqual((await oauth.findOrCreateUser(db,'google',{sub:'g-2',email:'ana@example.com',email_verified:true})).error,'email_linked');
  assert.strictEqual((await oauth.findOrCreateUser(db,'google',{sub:'g-3',email:'new@example.com',email_verified:true},{allowCreate:false})).error,'rate_limited');
});

function fakeRes(){
  const headers={};
  return {headers,statusCode:200,setHeader:(k,v)=>{headers[k.toLowerCase()]=v;},getHeader:k=>headers[k.toLowerCase()],end(){this.ended=true;}};
}

test('start redirects to the provider with a hashed nonce and a sealed state cookie',async()=>{
  const res=fakeRes();
  await oauth.start({headers:{host:'tablurio.com',cookie:''},query:{}},res,'apple');
  assert.strictEqual(res.statusCode,303);
  const url=new URL(res.headers.location);
  assert.strictEqual(url.origin+url.pathname,'https://appleid.apple.com/auth/authorize');
  assert.strictEqual(url.searchParams.get('response_mode'),'form_post');
  assert.strictEqual(url.searchParams.get('redirect_uri'),'https://tablurio.com/api/auth/oauth/apple/callback');
  const cookie=[].concat(res.headers['set-cookie'])[0];
  assert.match(cookie,/^tb_oauth=.+; Path=\/api\/auth\/oauth; .*HttpOnly; Secure; SameSite=None/);
});

test('callback with a wrong state goes back to the login page without signing in',async()=>{
  const start=fakeRes();
  await oauth.start({headers:{host:'tablurio.com',cookie:''},query:{}},start,'google');
  const cookie=[].concat(start.headers['set-cookie'])[0].split(';')[0];
  const res=fakeRes();
  await oauth.callback({method:'GET',headers:{host:'tablurio.com',cookie},query:{state:'forged',code:'c'}},res,'google');
  assert.strictEqual(res.headers.location,'/connexion?oauth_error=expired');
  assert.ok(![].concat(res.headers['set-cookie']).some(c=>c.startsWith('sts_session=')));
  const cancelled=fakeRes();
  await oauth.callback({method:'POST',headers:{host:'tablurio.com',cookie},query:{},body:'error=user_cancelled_authorize'},cancelled,'apple');
  assert.strictEqual(cancelled.headers.location,'/connexion?oauth_error=cancelled');
});

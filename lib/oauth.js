'use strict';
/**
 * Sign-in and sign-up with Google and Apple (OpenID Connect, authorization code flow).
 *
 *   GET  /api/auth/oauth/google           → redirect to Google
 *   GET  /api/auth/oauth/google/callback  ← Google sends the user back (?code&state)
 *   GET  /api/auth/oauth/apple            → redirect to Apple
 *   POST /api/auth/oauth/apple/callback   ← Apple posts the form back (code, state, user)
 *
 * Routed through api/auth/login.js (the Hobby plan caps the number of functions), see vercel.json.
 *
 * Environment (Vercel):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   APPLE_CLIENT_ID (the Services ID), APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (content of the .p8 file)
 * A provider whose variables are missing is simply not offered on the site.
 *
 * The ID token is received directly from the provider's token endpoint, over HTTPS and
 * authenticated with our client secret, so its claims can be trusted without fetching the
 * provider's signing keys (OpenID Connect Core §3.1.3.7). Issuer, audience, expiry and the
 * nonce are still checked.
 */
const crypto=require('node:crypto');
const {database}=require('./mongodb');
const {issue,serialize,unseal,addCookie,readCookie}=require('./session');
const {ensureIndexes}=require('./generations');
const {langOf,countryOf,langChosen}=require('./email');
const {allow,clientIp}=require('./rate-limit');

const STATE_COOKIE='tb_oauth';
const STATE_MINUTES=10;
const PROVIDERS={
  google:{
    issuers:['https://accounts.google.com','accounts.google.com'],
    configured:()=>Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),
    clientId:()=>process.env.GOOGLE_CLIENT_ID,
    authorizeUrl:({redirectUri,state,nonce})=>'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({
      client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',
      scope:'openid email profile',state,nonce,prompt:'select_account'}),
    tokenUrl:'https://oauth2.googleapis.com/token',
    clientSecret:()=>process.env.GOOGLE_CLIENT_SECRET
  },
  apple:{
    issuers:['https://appleid.apple.com'],
    configured:()=>Boolean(process.env.APPLE_CLIENT_ID&&process.env.APPLE_TEAM_ID&&process.env.APPLE_KEY_ID&&process.env.APPLE_PRIVATE_KEY),
    clientId:()=>process.env.APPLE_CLIENT_ID,
    // Apple only sends the email when asked with response_mode=form_post: the answer comes back as a POST.
    authorizeUrl:({redirectUri,state,nonce})=>'https://appleid.apple.com/auth/authorize?'+new URLSearchParams({
      client_id:process.env.APPLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',
      scope:'name email',response_mode:'form_post',state,nonce}),
    tokenUrl:'https://appleid.apple.com/auth/token',
    clientSecret:()=>appleClientSecret()
  }
};

const available=()=>({google:PROVIDERS.google.configured(),apple:PROVIDERS.apple.configured()});
const origin=req=>'https://'+String(req.headers.host||'tablurio.com').split(',')[0].trim();
const redirectUri=(req,provider)=>origin(req)+'/api/auth/oauth/'+provider+'/callback';
const sha=value=>crypto.createHash('sha256').update(value).digest('base64url');

/** Apple's client secret: a short-lived JWT signed (ES256) with the .p8 key from the Apple developer account. */
function appleClientSecret(now=Date.now()){
  const key=String(process.env.APPLE_PRIVATE_KEY||'').replace(/\\n/g,'\n').trim();
  const header={alg:'ES256',kid:process.env.APPLE_KEY_ID,typ:'JWT'};
  const iat=Math.floor(now/1000);
  const payload={iss:process.env.APPLE_TEAM_ID,iat,exp:iat+300,aud:'https://appleid.apple.com',sub:process.env.APPLE_CLIENT_ID};
  const enc=object=>Buffer.from(JSON.stringify(object)).toString('base64url');
  const data=enc(header)+'.'+enc(payload);
  const signature=crypto.sign('sha256',Buffer.from(data),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return data+'.'+signature;
}

/** Reads the claims of an ID token received from the token endpoint and checks them. */
function verifyClaims(provider,idToken,nonce,now=Date.now()){
  const parts=String(idToken||'').split('.');
  if(parts.length!==3)throw new Error('id_token');
  let claims;try{claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());}catch(e){throw new Error('id_token');}
  const config=PROVIDERS[provider];
  const aud=[].concat(claims.aud);
  if(!config.issuers.includes(claims.iss))throw new Error('issuer');
  if(!aud.includes(config.clientId()))throw new Error('audience');
  if(!Number.isFinite(claims.exp)||claims.exp*1000<now-60000)throw new Error('expired');
  // The nonce is sent hashed to the provider: only this browser holds the original (in the state cookie).
  if(typeof claims.nonce!=='string'||claims.nonce!==sha(nonce))throw new Error('nonce');
  if(typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255)throw new Error('subject');
  const email=typeof claims.email==='string'?claims.email.trim().toLowerCase():'';
  const verified=claims.email_verified===true||claims.email_verified==='true';
  return {sub:claims.sub,email:email.length<=254&&/^\S+@\S+\.\S+$/.test(email)?email:null,email_verified:verified};
}

/**
 * The Tablurio account for this Google / Apple identity:
 *  1. the account already linked to it,
 *  2. otherwise the account with the same (provider-verified) email, which gets linked,
 *  3. otherwise a new account, whose phone number is asked on the next screen.
 */
async function findOrCreateUser(db,provider,identity,context={},now=new Date()){
  const users=db.collection('users');
  const field='oauth.'+provider;
  const linked=await users.findOne({[field]:identity.sub});
  if(linked)return {user:linked,created:false};
  if(!identity.email||!identity.email_verified)return {error:'email_missing'};
  const existing=await users.findOne({email:identity.email});
  if(existing){
    // This address already belongs to another Google / Apple account: never swap it silently.
    if(existing.oauth?.[provider]&&existing.oauth[provider]!==identity.sub)return {error:'email_linked'};
    const set={[field]:identity.sub,email_verified:true};
    if(existing.email_verified===false&&!existing.email_verified_at)set.email_verified_at=now;
    const update={$set:set};
    // An address nobody had confirmed: whoever chose that password may not own the mailbox.
    // The provider just proved the owner, so the old password stops working (the owner can set one with « Mot de passe oublié »).
    if(existing.email_verified===false&&existing.password_hash)update.$unset={password_hash:''};
    await users.updateOne({_id:existing._id},update);
    const user={...existing,...set};
    if(update.$unset)delete user.password_hash;
    return {user,created:false,linked:true};
  }
  if(context.allowCreate===false)return {error:'rate_limited'};
  const doc={email:identity.email,oauth:{[provider]:identity.sub},created_at:now,tier:'free',
    lang:context.lang||'fr',lang_chosen:Boolean(context.lang_chosen),...(context.country?{country:context.country}:{}),
    email_verified:true,email_verified_at:now,signup_method:provider,phone_pending:true,marketing_consent:false};
  try{
    const result=await users.insertOne(doc);
    return {user:{...doc,_id:result.insertedId},created:true};
  }catch(error){
    // Two callbacks at once for the same person: the other one created the account first.
    if(error?.code===11000){
      const again=await users.findOne({[field]:identity.sub})||await users.findOne({email:identity.email});
      if(again)return {user:again,created:false};
    }
    throw error;
  }
}

function stateCookie(value,maxAge){
  // SameSite=None: Apple sends the user back with a cross-site POST, which drops Lax cookies.
  return STATE_COOKIE+'='+value+'; Path=/api/auth/oauth; Max-Age='+maxAge+'; HttpOnly; Secure; SameSite=None';
}
function redirect(res,location){
  res.statusCode=303;
  res.setHeader('Location',location);
  res.setHeader('Cache-Control','no-store');
  res.end();
}
const back=(res,error)=>redirect(res,'/connexion?oauth_error='+encodeURIComponent(error));

// GET /api/auth/oauth/:provider
async function start(req,res,provider){
  const config=PROVIDERS[provider];
  if(!config)return back(res,'unknown');
  if(!config.configured())return back(res,'unavailable');
  const state=crypto.randomBytes(24).toString('base64url'),nonce=crypto.randomBytes(24).toString('base64url');
  const sealed=serialize({p:provider,s:state,n:nonce,lang:langOf(req),lc:langChosen(req),exp:Date.now()+STATE_MINUTES*60000});
  addCookie(res,stateCookie(sealed,STATE_MINUTES*60));
  return redirect(res,config.authorizeUrl({redirectUri:redirectUri(req,provider),state,nonce:sha(nonce)}));
}

function params(req){
  const query=req.query||{};
  let body=req.body;
  if(typeof body==='string'){try{body=Object.fromEntries(new URLSearchParams(body));}catch(e){body={};}}
  return {...query,...(body&&typeof body==='object'?body:{})};
}

async function exchange(req,provider,code){
  const config=PROVIDERS[provider];
  const response=await fetch(config.tokenUrl,{method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
    body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri(req,provider),
      client_id:config.clientId(),client_secret:config.clientSecret()}),
    signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||typeof data.id_token!=='string')throw new Error('token_exchange');
  return data.id_token;
}

// GET (Google) or POST (Apple) /api/auth/oauth/:provider/callback
async function callback(req,res,provider){
  const config=PROVIDERS[provider];
  if(!config||!config.configured())return back(res,'unavailable');
  if(!['GET','POST'].includes(req.method))return back(res,'failed');
  const input=params(req);
  const saved=unseal(readCookie(req,STATE_COOKIE));
  addCookie(res,stateCookie('',0));
  if(input.error)return back(res,/cancel|denied/i.test(String(input.error))?'cancelled':'failed');
  if(!saved||saved.p!==provider||!Number.isFinite(saved.exp)||saved.exp<Date.now())return back(res,'expired');
  const a=Buffer.from(String(input.state||'')),b=Buffer.from(String(saved.s||''));
  if(!a.length||a.length!==b.length||!crypto.timingSafeEqual(a,b))return back(res,'expired');
  if(typeof input.code!=='string'||!input.code||input.code.length>2048)return back(res,'failed');
  let identity;
  try{identity=verifyClaims(provider,await exchange(req,provider,input.code),saved.n);}
  catch(e){console.error('oauth',provider,e.message);return back(res,'failed');}
  try{
    const db=await database();await ensureIndexes(db);
    const allowCreate=await allow(db,`signup-ip:${clientIp(req)}`,8,3600000);
    const result=await findOrCreateUser(db,provider,identity,{lang:saved.lang,lang_chosen:saved.lc,country:countryOf(req),allowCreate});
    if(result.error)return back(res,result.error);
    issue(res,result.user);
    return redirect(res,'/connexion?oauth='+(result.created?'signup':'login'));
  }catch(e){console.error('oauth',provider,e.message);return back(res,'failed');}
}

module.exports={start,callback,available,verifyClaims,findOrCreateUser,appleClientSecret,PROVIDERS,sha};

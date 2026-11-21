'use strict';
/**
 * Transactional emails through Resend (https://resend.com).
 * Needs RESEND_API_KEY and EMAIL_FROM (e.g. "Tablurio <bonjour@tablurio.com>").
 * Without them nothing is sent and the features that depend on email step aside.
 */
const SITE=()=>(process.env.SITE_URL||'https://tablurio.com').replace(/\/$/,'');

function emailEnabled(){
  return Boolean(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM);
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** The branded layout shared by every email. body: trusted HTML built by the templates below. */
function layout({title,body,button}){
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f6f4fb;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;color:#1e1533">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #ebe5f5;border-radius:18px">
<tr><td style="padding:26px 28px 8px;font-size:18px;font-weight:800;letter-spacing:-.02em">tablurio<span style="color:#6d3ddc">.com</span></td></tr>
<tr><td style="padding:8px 28px 4px"><h1 style="margin:0 0 10px;font-size:22px;line-height:1.25;letter-spacing:-.03em">${esc(title)}</h1>${body}</td></tr>
${button?`<tr><td style="padding:10px 28px 4px"><a href="${esc(button.url)}" style="display:inline-block;background:#6d3ddc;color:#fff;text-decoration:none;font-weight:750;padding:13px 20px;border-radius:12px">${esc(button.label)}</a></td></tr>`:''}
<tr><td style="padding:22px 28px 26px;color:#8a7fa1;font-size:12px;line-height:1.5">Tu reçois cet email parce qu’un compte Tablurio utilise cette adresse.<br>Tablurio · <a href="${SITE()}" style="color:#8a7fa1">tablurio.com</a></td></tr>
</table></td></tr></table></body></html>`;
}
const para=text=>`<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4b4163">${esc(text)}</p>`;
const codeBox=code=>`<p style="margin:6px 0 16px;font-size:32px;font-weight:800;letter-spacing:.28em;color:#1e1533">${esc(code)}</p>`;

const TEMPLATES={
  verify:({code})=>({subject:`${code} — ton code Tablurio`,html:layout({title:'Confirme ton adresse email',
    body:para('Voici ton code de vérification :')+codeBox(code)+para('Il est valable 15 minutes. Si tu n’as pas créé de compte, ignore cet email.')}),
    text:`Ton code Tablurio : ${code} (valable 15 minutes).`}),
  reset:({code})=>({subject:`${code} — réinitialise ton mot de passe`,html:layout({title:'Mot de passe oublié',
    body:para('Voici ton code pour choisir un nouveau mot de passe :')+codeBox(code)+para('Il est valable 15 minutes. Si tu n’as rien demandé, ignore cet email : ton mot de passe ne change pas.')}),
    text:`Ton code pour réinitialiser ton mot de passe Tablurio : ${code} (valable 15 minutes).`}),
  ready:({title,url})=>({subject:`Ta partition est prête : ${title}`,html:layout({title:'Ta partition est prête 🎶',
    body:para(`« ${title} » vient d’être transcrit. Tu peux l’écouter, la lire et la télécharger.`),button:{label:'Ouvrir ma partition',url}}),
    text:`Ta partition « ${title} » est prête : ${url}`}),
  alert:({title,detail,url})=>({subject:`⚠️ Génération en échec : ${title}`,html:layout({title:'Une génération a échoué',
    body:para(`Morceau : ${title}`)+para(`Erreur : ${detail}`)+para('Une nouvelle tentative automatique a déjà été faite.'),button:url?{label:'Voir le tableau de bord',url}:null}),
    text:`Génération en échec : ${title} — ${detail}`})
};

/** Sends one email. Returns {sent:true} or {sent:false,reason}. Never throws. */
async function sendEmail(to,template,data){
  if(!emailEnabled())return {sent:false,reason:'disabled'};
  const message=TEMPLATES[template](data);
  try{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',
      headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:process.env.EMAIL_FROM,to:[to],subject:message.subject,html:message.html,text:message.text}),
      signal:AbortSignal.timeout(8000)});
    if(!response.ok){
      console.error('email:',template,response.status,(await response.text()).slice(0,200));
      return {sent:false,reason:'provider'};
    }
    return {sent:true};
  }catch(error){
    console.error('email:',template,error.message);
    return {sent:false,reason:'network'};
  }
}

module.exports={emailEnabled,sendEmail,TEMPLATES,SITE};

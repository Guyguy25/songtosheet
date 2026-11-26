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
/** Interface language chosen on the site (cookie set by assets/i18n.js): 'en' or 'fr'. */
function langOf(req){
  const raw=String(req?.headers?.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('tablurio_lang='));
  return raw&&raw.slice(14)==='en'?'en':'fr';
}

function layout({title,body,button,lang,unsubscribe}){
  const en=lang==='en';
  return `<!doctype html><html lang="${en?'en':'fr'}"><body style="margin:0;background:#f6f4fb;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;color:#1e1533">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #ebe5f5;border-radius:18px">
<tr><td style="padding:26px 28px 8px;font-size:18px;font-weight:800;letter-spacing:-.02em">tablurio<span style="color:#6d3ddc">.com</span></td></tr>
<tr><td style="padding:8px 28px 4px"><h1 style="margin:0 0 10px;font-size:22px;line-height:1.25;letter-spacing:-.03em">${esc(title)}</h1>${body}</td></tr>
${button?`<tr><td style="padding:10px 28px 4px"><a href="${esc(button.url)}" style="display:inline-block;background:#6d3ddc;color:#fff;text-decoration:none;font-weight:750;padding:13px 20px;border-radius:12px">${esc(button.label)}</a></td></tr>`:''}
<tr><td style="padding:22px 28px 26px;color:#8a7fa1;font-size:12px;line-height:1.5">${en?'You are receiving this email because a Tablurio account uses this address.':'Tu reçois cet email parce qu’un compte Tablurio utilise cette adresse.'}${unsubscribe?`<br><a href="${esc(unsubscribe)}" style="color:#8a7fa1">${en?'Stop these reminder emails':'Ne plus recevoir ces emails de relance'}</a>`:''}<br>Tablurio · <a href="${SITE()}" style="color:#8a7fa1">tablurio.com</a></td></tr>
</table></td></tr></table></body></html>`;
}
const para=text=>`<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4b4163">${esc(text)}</p>`;
const codeBox=code=>`<p style="margin:6px 0 16px;font-size:32px;font-weight:800;letter-spacing:.28em;color:#1e1533">${esc(code)}</p>`;

// Follow-ups (lib/nudges.js). d: {name,title,url,pricing,unsubscribe}
const hi=(d,en)=>d.name?(en?`Hi ${d.name},`:`Salut ${d.name},`):(en?'Hi,':'Salut,');
const NUDGES_FR={
  nudge_starter_ready:d=>({subject:'Ton prochain morceau entier est disponible 🎸',html:layout({title:'Ton morceau du jour t’attend',unsubscribe:d.unsubscribe,
    body:para(hi(d))+para('Ça fait 24 heures depuis ton dernier morceau entier : tu peux en générer un nouveau dès maintenant, avec ton offre Starter.')+para('Colle le lien du prochain morceau que tu veux apprendre.'),
    button:{label:'Générer mon prochain morceau',url:d.url}}),text:`Ton prochain morceau entier est disponible : ${d.url}`}),
  nudge_unlock:d=>({subject:`Et si tu jouais « ${d.title||'ton morceau'} » en entier ?`,html:layout({title:'Ta partition t’attend en entier',unsubscribe:d.unsubscribe,
    body:para(hi(d))+para(`Tu as écouté l’aperçu de « ${d.title||'ton morceau'} ». La suite est prête à être générée : toute la partition, avec les exports PDF, MIDI et MusicXML.`)+para('Avec l’offre Starter, tu as un morceau entier toutes les 24 heures.'),
    button:{label:'Voir le morceau entier',url:d.url}}),text:`Ta partition de « ${d.title} » t’attend en entier : ${d.url}`}),
  nudge_limit:d=>({subject:'Tes aperçus gratuits sont terminés — la suite ?',html:layout({title:'Passe aux morceaux entiers',unsubscribe:d.unsubscribe,
    body:para(hi(d))+para('Tu as utilisé tes aperçus gratuits de 30 secondes. Pour continuer, l’offre Starter te donne un morceau entier toutes les 24 heures, et le Pro des morceaux entiers sans limite quotidienne.')+para('Tous les instruments, la voix isolée et les exports PDF, MIDI et MusicXML sont inclus.'),
    button:{label:'Voir les offres',url:d.pricing}}),text:`Tes aperçus gratuits sont terminés. Les offres : ${d.pricing}`}),
  nudge_first:d=>({subject:'Ta première partition en 3 clics 🎶',html:layout({title:'Quel morceau veux-tu jouer ?',unsubscribe:d.unsubscribe,
    body:para(hi(d))+para('Ton compte est prêt, mais tu n’as pas encore lancé de partition. Colle un lien YouTube, Spotify ou Deezer, choisis ton instrument, et l’aperçu est prêt en quelques instants.')+para('Tu as des aperçus gratuits pour essayer.'),
    button:{label:'Créer ma première partition',url:d.url}}),text:`Crée ta première partition : ${d.url}`}),
  nudge_winback:d=>({subject:'Un nouveau morceau à apprendre ?',html:layout({title:'Ça fait un moment !',unsubscribe:d.unsubscribe,
    body:para(hi(d))+para('Tu n’es pas revenu sur Tablurio depuis deux semaines. Un morceau te trotte dans la tête ? Colle son lien, et tu as sa partition ou sa tablature en quelques instants.'),
    button:{label:'Transcrire un morceau',url:d.url}}),text:`Un nouveau morceau à apprendre ? ${d.url}`})
};
const NUDGES_EN={
  nudge_starter_ready:d=>({subject:'Your next full song is available 🎸',html:layout({lang:'en',title:'Your song of the day is waiting',unsubscribe:d.unsubscribe,
    body:para(hi(d,true))+para('It’s been 24 hours since your last full song: you can generate a new one right now with your Starter plan.')+para('Paste the link of the next song you want to learn.'),
    button:{label:'Generate my next song',url:d.url}}),text:`Your next full song is available: ${d.url}`}),
  nudge_unlock:d=>({subject:`Ready to play “${d.title||'your song'}” in full?`,html:layout({lang:'en',title:'Your full sheet music is waiting',unsubscribe:d.unsubscribe,
    body:para(hi(d,true))+para(`You listened to the preview of “${d.title||'your song'}”. The rest is ready to be generated: the whole score, with PDF, MIDI and MusicXML exports.`)+para('With the Starter plan, you get one full song every 24 hours.'),
    button:{label:'See the full song',url:d.url}}),text:`Your full sheet music for “${d.title}” is waiting: ${d.url}`}),
  nudge_limit:d=>({subject:'Your free previews are used up — what’s next?',html:layout({lang:'en',title:'Move on to full songs',unsubscribe:d.unsubscribe,
    body:para(hi(d,true))+para('You’ve used your free 30-second previews. To keep going, Starter gives you one full song every 24 hours, and Pro gives you full songs with no daily limit.')+para('All instruments, isolated vocals and PDF, MIDI and MusicXML exports are included.'),
    button:{label:'See the plans',url:d.pricing}}),text:`Your free previews are used up. Plans: ${d.pricing}`}),
  nudge_first:d=>({subject:'Your first sheet music in 3 clicks 🎶',html:layout({lang:'en',title:'Which song do you want to play?',unsubscribe:d.unsubscribe,
    body:para(hi(d,true))+para('Your account is ready, but you haven’t made any sheet music yet. Paste a YouTube, Spotify or Deezer link, pick your instrument, and the preview is ready in moments.')+para('You have free previews to try it.'),
    button:{label:'Create my first sheet music',url:d.url}}),text:`Create your first sheet music: ${d.url}`}),
  nudge_winback:d=>({subject:'A new song to learn?',html:layout({lang:'en',title:'It’s been a while!',unsubscribe:d.unsubscribe,
    body:para(hi(d,true))+para('You haven’t been back to Tablurio for two weeks. Got a song stuck in your head? Paste its link and get the sheet music or tab in moments.'),
    button:{label:'Transcribe a song',url:d.url}}),text:`A new song to learn? ${d.url}`})
};

const TEMPLATES_EN={
  ...NUDGES_EN,
  verify:({code})=>({subject:`${code} — your Tablurio code`,html:layout({lang:'en',title:'Confirm your email address',
    body:para('Here is your verification code:')+codeBox(code)+para('It is valid for 15 minutes. If you did not create an account, ignore this email.')}),
    text:`Your Tablurio code: ${code} (valid for 15 minutes).`}),
  reset:({code})=>({subject:`${code} — reset your password`,html:layout({lang:'en',title:'Forgot your password',
    body:para('Here is your code to choose a new password:')+codeBox(code)+para('It is valid for 15 minutes. If you did not ask for this, ignore this email: your password stays the same.')}),
    text:`Your code to reset your Tablurio password: ${code} (valid for 15 minutes).`}),
  ready:({title,url})=>({subject:`Your sheet music is ready: ${title}`,html:layout({lang:'en',title:'Your sheet music is ready 🎶',
    body:para(`“${title}” has just been transcribed. You can listen to it, read it and download it.`),button:{label:'Open my sheet music',url}}),
    text:`Your sheet music “${title}” is ready: ${url}`})
};

const TEMPLATES={
  ...NUDGES_FR,
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
  const message=(data?.lang==='en'&&TEMPLATES_EN[template]||TEMPLATES[template])(data);
  try{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',
      headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:process.env.EMAIL_FROM,to:[to],subject:message.subject,html:message.html,text:message.text,
        // One-click unsubscribe shown by Gmail and others on follow-up emails.
        ...(data?.unsubscribe?{headers:{'List-Unsubscribe':`<${data.unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}:{})}),
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

module.exports={emailEnabled,sendEmail,TEMPLATES,TEMPLATES_EN,SITE,langOf};

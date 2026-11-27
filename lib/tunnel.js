'use strict';
/**
 * Tunnel d'acquisition du tableau de bord (onglet « Tunnel »).
 * Une personne = un visiteur réel (navigateur, robots exclus) arrivé sur la période.
 * Les étapes s'emboîtent : chaque étape ne compte que les personnes passées par la précédente.
 *   Landing → A généré un son → A créé un compte → A vu le paywall → A payé
 * Les comptes et les paiements viennent de la base (exacts) ; générations et paywall des points de suivi du site.
 */

const DAY=86400000;
const pct=(part,whole)=>whole?Math.round(part/whole*1000)/10:0;

/** Ce qu'une personne a fait. ctx : {userById, jobsOf, paying(user)} */
function journey(v,{userById,jobsOf,paying}){
  const account=v.user_id?userById.get(String(v.user_id)):null;
  const own=v.user_id?jobsOf.get(String(v.user_id))||[]:[];
  // Le compte doit être né après (ou juste avant, 10 min) l'arrivée : un ancien compte n'est pas une inscription.
  const signedUp=Boolean(account&&new Date(account.created_at)>=new Date(new Date(v.first_seen).getTime()-10*60000));
  const paid=Boolean(signedUp&&(account.first_paid_at||paying(account)));
  const paywall=Boolean(signedUp&&(v.steps?.pricing||v.steps?.checkout||paid));
  return {
    generated:Boolean(v.steps?.preview||own.length),
    account:signedUp,
    paywall,
    checkout:Boolean(paywall&&(v.steps?.checkout||paid)),
    paid,
    engaged:Boolean(v.human)
  };
}

// Page d'arrivée : accueil (FR/EN), pages outils (SEO), articles « apprendre », le reste (app, tarifs…).
const TOOLS=/^\/(en\/)?(youtube-en-partition|tablature-guitare|partition-piano|mp3-en-partition|spotify-en-partition|deezer-en-partition|musicxml|midi|youtube-to-sheet-music|guitar-tab-generator|piano-sheet-music|mp3-to-sheet-music|spotify-to-sheet-music|deezer-to-sheet-music)\/?$/;
function landingPage(path){
  if(/^\/(en)?\/?$/.test(path))return 'accueil';
  if(TOOLS.test(path))return 'outils';
  if(/^\/(apprendre|en\/learn|blog)/.test(path))return 'articles';
  if(path==='?')return 'inconnue';
  return 'autre';
}

function stepsOf(people){
  const n=key=>people.filter(p=>p[key]).length;
  const landing=people.length,generated=n('generated'),account=n('account'),paywall=n('paywall'),checkout=n('checkout'),paid=n('paid');
  return {
    landing,engaged:n('engaged'),generated,account,paywall,checkout,paid,
    // Pourcentages demandés : génération et compte par rapport à la landing, paywall par rapport aux comptes,
    // paiement par rapport au paywall.
    generated_rate:pct(generated,landing),account_rate:pct(account,landing),
    paywall_rate:pct(paywall,account),checkout_rate:pct(checkout,paywall),paid_rate:pct(paid,paywall),
    // Comptes créés sans avoir généré, et générations sans compte : pour voir où les gens partent.
    account_without_generation:people.filter(p=>p.account&&!p.generated).length,
    generated_without_account:people.filter(p=>p.generated&&!p.account).length,
    overall_rate:pct(paid,landing)
  };
}

/** Payants toujours abonnés 1 mois et 3 mois après leur premier paiement (tous les comptes, pas que la période). */
function retentionOf(users,paying,now=new Date()){
  const payers=users.filter(u=>u.first_paid_at);
  const cohort=days=>payers.filter(u=>now-new Date(u.first_paid_at)>=days*DAY);
  const m1=cohort(30),m3=cohort(90);
  const kept=list=>list.filter(u=>paying(u)).length;
  return {payers:payers.length,m1_cohort:m1.length,m1_kept:kept(m1),m1:pct(kept(m1),m1.length),
    m3_cohort:m3.length,m3_kept:kept(m3),m3:pct(kept(m3),m3.length)};
}

/**
 * visitors : visiteurs réels arrivés sur la période (admin exclu). channelOf : canal d'une source.
 * Renvoie le tunnel global, par canal et par source (les 8 plus grosses), et la rétention des payants.
 */
function tunnel(visitors,ctx,{channelOf,users,now=new Date(),signups=[],visitorOf=new Map()}){
  const people=visitors.map(v=>({...journey(v,ctx),source:v.source||'direct',channel:channelOf(v.source),landing_page:v.landing||'/'}));
  // Les comptes créés sur la période doivent tous être dans le tunnel, comme dans la carte « Inscriptions » :
  // certains ne sont pas reliés à une visite de la période (première visite plus ancienne, ou navigateur
  // qui bloque le suivi). On les ajoute en s'appuyant sur la base : génération, paiement, et le paywall si on l'a vu.
  const counted=new Set(visitors.filter((v,i)=>people[i].account).map(v=>String(v.user_id)));
  let earlier=0,untracked=0;
  for(const u of signups){
    const id=String(u._id);
    if(counted.has(id))continue;
    const v=visitorOf.get(id);
    if(v)earlier++;else untracked++;
    const paid=Boolean(u.first_paid_at||ctx.paying(u));
    const paywall=Boolean(paid||v?.steps?.pricing||v?.steps?.checkout);
    people.push({generated:Boolean((ctx.jobsOf.get(id)||[]).length||v?.steps?.preview),account:true,paywall,
      checkout:Boolean(paywall&&(v?.steps?.checkout||paid)),paid,engaged:true,
      source:v?.source||'inconnue',channel:v?channelOf(v.source):'inconnue',landing_page:v?.landing||'?'});
  }
  const group=key=>{
    const map=new Map();
    for(const p of people){const k=p[key]||'—';if(!map.has(k))map.set(k,[]);map.get(k).push(p);}
    return [...map.entries()].sort((a,b)=>b[1].length-a[1].length).map(([k,list])=>({key:k,...stepsOf(list)}));
  };
  const pages=new Map();
  for(const p of people){
    const page=landingPage(p.landing_page);
    pages.set(page,(pages.get(page)||0)+1);
  }
  return {all:{...stepsOf(people),earlier,untracked},channels:group('channel'),sources:group('source').slice(0,8),
    landing_pages:Object.fromEntries(pages),retention:retentionOf(users,ctx.paying,now)};
}

module.exports={tunnel,journey,stepsOf,retentionOf,landingPage};

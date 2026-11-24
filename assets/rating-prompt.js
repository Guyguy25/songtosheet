/* Tablurio — pop-up « Combien tu notes ta génération ? »
 * S'affiche quand un compte revient un jour après une génération terminée (le serveur choisit laquelle,
 * une seule pop-up par jour). Les questions qui suivent dépendent de la note donnée.
 * Aperçu admin : /app?noter (rien n'est enregistré).
 */
(() => {
  'use strict';
  const EN=()=>window.TablurioI18n?.lang==='en';
  const T=(fr,en)=>EN()?en:fr;
  const pick=value=>value&&typeof value==='object'?(EN()?value.en:value.fr):value;
  const LABELS=[
    ['😣','Très décevant','Very disappointing'],
    ['😕','Bof','Meh'],
    ['🙂','Correct','Okay'],
    ['😃','Très bien','Very good'],
    ['🤩','Parfait !','Perfect!']
  ];
  const INSTRUMENTS={piano:['🎹','Piano','Piano'],guitare:['🎸','Guitare','Guitar'],basse:['🎸','Basse','Bass'],violon:['🎻','Violon','Violin'],voix:['🎤','Voix','Vocals']};
  const bucketOf=score=>score<=2?'low':score===3?'mid':'high';
  const THANKS={
    low:['Merci, c’est noté.','Thanks, noted.','Ton retour part directement à l’équipe. Essaie aussi une autre version du morceau dans ta bibliothèque : certaines technos s’en sortent mieux selon les sons.','Your feedback goes straight to the team. Also try another version of the song in your library: some engines do better on some songs.'],
    mid:['Merci pour ton avis !','Thanks for your feedback!','On travaille chaque semaine sur la précision. Ta réponse nous dit quoi améliorer en premier.','We work on accuracy every week. Your answer tells us what to improve first.'],
    high:['Merci, ça fait plaisir !','Thanks, that means a lot!','Bonne session de jeu. Ta prochaine partition t’attend quand tu veux.','Have a great practice session. Your next sheet is ready whenever you are.']
  };
  let started=false;

  function ago(date){
    const days=Math.max(1,Math.round((Date.now()-new Date(date))/86400000));
    if(days===1)return T('hier','yesterday');
    return EN()?`${days} days ago`:`il y a ${days} jours`;
  }

  async function api(url,options){
    const response=await fetch(url,{credentials:'same-origin',...options});
    if(!response.ok)throw new Error(String(response.status));
    return response.json();
  }

  function open({prompt,questions,preview}){
    const dialog=document.createElement('dialog');
    dialog.className='rate-dialog';
    dialog.setAttribute('aria-labelledby','rate-title');
    const instrument=INSTRUMENTS[prompt.instrument]||['🎵',prompt.instrument||'',prompt.instrument||''];
    const kind=prompt.kind==='full'?T('Morceau entier','Whole song'):T('Aperçu 30 s','30 s preview');
    dialog.innerHTML=`<form class="rate-inner" method="dialog" novalidate>
      <button type="button" class="rate-close" data-rate-close aria-label="${T('Fermer','Close')}">×</button>
      <span class="rate-badge"><span aria-hidden="true">👋</span> ${T('Content de te revoir','Welcome back')}${preview?` · <b>${T('aperçu admin','admin preview')}</b>`:''}</span>
      <h2 id="rate-title" tabindex="-1" autofocus>${T('Combien tu notes ta dernière génération ?','How would you rate your last generation?')}</h2>
      <div class="rate-song">
        <span class="rate-song-icon" aria-hidden="true">${instrument[0]}</span>
        <span class="rate-song-text"><b></b><small>${EN()?instrument[2]:instrument[1]} · ${kind} · ${T('générée','made')} ${ago(prompt.created_at)}</small></span>
      </div>
      <div class="rate-stars" role="radiogroup" aria-label="${T('Note de 1 à 5','Rating from 1 to 5')}">
        ${[1,2,3,4,5].map(n=>`<button type="button" class="rate-star" role="radio" aria-checked="false" data-score="${n}" aria-label="${n} / 5">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/></svg></button>`).join('')}
      </div>
      <p class="rate-mood" aria-live="polite"><span class="rate-emoji" aria-hidden="true">🎼</span><span class="rate-mood-text">${T('Touche une étoile','Tap a star')}</span></p>
      <div class="rate-more" hidden>
        <h3 class="rate-q"></h3>
        <p class="rate-hint">${T('Plusieurs choix possibles','Pick as many as you like')}</p>
        <div class="rate-chips"></div>
        <label class="rate-label" for="rate-comment">${T('Pourquoi cette note ?','Why this rating?')} <span>${T('facultatif','optional')}</span></label>
        <textarea id="rate-comment" class="rate-comment" rows="3" maxlength="600"></textarea>
        <div class="rate-actions"><button type="button" class="btn btn-outline" data-rate-skip>${T('Plus tard','Later')}</button><button type="submit" class="btn btn-primary" data-rate-send>${T('Envoyer','Send')}</button></div>
      </div>
      <p class="rate-foot">${T('30 secondes, et ça nous aide vraiment à améliorer tes partitions.','30 seconds, and it really helps us improve your sheet music.')}</p>
      <p class="rate-error" role="status"></p>
    </form>
    <div class="rate-thanks" hidden><span class="rate-thanks-emoji" aria-hidden="true"></span><h2></h2><p></p><button type="button" class="btn btn-primary" data-rate-close>${T('Fermer','Close')}</button></div>`;
    dialog.querySelector('.rate-song-text b').textContent=prompt.title||T('Ta partition','Your sheet music');
    document.body.append(dialog);

    const form=dialog.querySelector('form'),stars=[...dialog.querySelectorAll('.rate-star')];
    const more=dialog.querySelector('.rate-more'),chips=dialog.querySelector('.rate-chips');
    const emoji=dialog.querySelector('.rate-emoji'),mood=dialog.querySelector('.rate-mood-text');
    let score=0,bucket=null,done=false;

    const save=payload=>preview||!prompt.job?Promise.resolve():api('/api/auth/rating',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({job:prompt.job,lang:EN()?'en':'fr',...payload})});

    function paint(value){
      stars.forEach((star,index)=>star.classList.toggle('on',index<value));
      const label=LABELS[(value||score)-1];
      emoji.textContent=label?label[0]:'🎼';
      mood.textContent=label?(EN()?label[2]:label[1]):T('Touche une étoile','Tap a star');
      dialog.dataset.mood=value||score?bucketOf(value||score):'';
    }
    stars.forEach(star=>{
      star.addEventListener('mouseenter',()=>paint(Number(star.dataset.score)));
      star.addEventListener('focus',()=>paint(Number(star.dataset.score)));
      star.addEventListener('click',()=>choose(Number(star.dataset.score)));
    });
    dialog.querySelector('.rate-stars').addEventListener('mouseleave',()=>paint(score));

    function choose(value){
      score=value;
      stars.forEach(star=>star.setAttribute('aria-checked',String(Number(star.dataset.score)===value)));
      paint(value);
      // La note est gardée tout de suite, même si l'utilisateur ferme sans répondre aux questions.
      save({score}).catch(()=>{});
      const next=bucketOf(value);
      if(next!==bucket){
        bucket=next;
        const set=questions[bucket];
        dialog.querySelector('.rate-q').textContent=pick(set.title);
        dialog.querySelector('.rate-comment').placeholder=pick(set.placeholder);
        chips.replaceChildren(...Object.entries(set.reasons).map(([id,label])=>{
          const chip=document.createElement('label');chip.className='rate-chip';
          const input=document.createElement('input');input.type='checkbox';input.value=id;
          const text=document.createElement('span');text.textContent=pick(label);
          chip.append(input,text);return chip;
        }));
      }
      more.hidden=false;
      dialog.querySelector('.rate-foot').hidden=true;
      dialog.classList.add('rate-open');
    }

    function thanks(){
      const [title,titleEn,text,textEn]=THANKS[bucket||'high'];
      const box=dialog.querySelector('.rate-thanks');
      box.querySelector('.rate-thanks-emoji').textContent=LABELS[score-1]?.[0]||'🎶';
      box.querySelector('h2').textContent=EN()?titleEn:title;
      box.querySelector('p').textContent=EN()?textEn:text;
      form.hidden=true;box.hidden=false;
      box.querySelector('button').focus();
    }

    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!score)return;
      const send=dialog.querySelector('[data-rate-send]');send.disabled=true;
      try{
        await save({score,reasons:[...chips.querySelectorAll('input:checked')].map(input=>input.value),comment:dialog.querySelector('.rate-comment').value});
        done=true;thanks();
      }catch{
        send.disabled=false;
        dialog.querySelector('.rate-error').textContent=T('Impossible d’envoyer pour l’instant. Réessaie.','Couldn’t send right now. Try again.');
      }
    });
    function close(){
      // Fermé sans note : cette génération ne sera plus proposée.
      if(!score&&!done)save({dismiss:true}).catch(()=>{});
      dialog.close();
    }
    dialog.addEventListener('click',event=>{
      if(event.target.closest('[data-rate-close],[data-rate-skip]')||event.target===dialog)close();
    });
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('close',()=>dialog.remove());
    dialog.showModal();
  }

  async function check(user){
    if(started||!user||!/^\/app(\/|$)/.test(location.pathname))return;
    started=true;
    const preview=user.role==='admin'&&new URLSearchParams(location.search).has('noter');
    try{
      const data=await api('/api/auth/rating'+(preview?'?preview=1':''));
      if(!data.prompt)return;
      // Laisser l'espace se charger, et ne jamais passer par-dessus une autre fenêtre.
      let tries=0;
      const show=()=>{if(document.querySelector('dialog[open]')){if(++tries<10)setTimeout(show,3000);return;}open(data);};
      setTimeout(show,1200);
    }catch{}
  }
  window.TablurioRating={check,open};
})();

(() => {
  const states=new WeakMap();
  function mount(root,userId,active){
    if(!root)return;
    const previous=states.get(root);
    if(!userId||!active){
      root.hidden=true;
      if(previous){
        states.delete(root);
        root.replaceChildren();
      }
      return;
    }
    if(previous?.userId===userId){
      root.hidden=!previous.questions?.length;
      return;
    }
    const state={userId,questions:null};
    states.set(root,state);
    root.hidden=true;
    root.replaceChildren();
    async function request(options){
      const response=await fetch('/api/auth/wait-survey',options);
      if(!response.ok)throw new Error('Questionnaire indisponible.');
      return response.json();
    }
    function render(){
      if(states.get(root)!==state)return;
      const question=state.questions[0];
      if(!question){root.hidden=true;root.replaceChildren();return;}
      const form=document.createElement('form');
      form.innerHTML=`<div class="wait-survey-heading"><strong>Pendant l’attente</strong><span></span></div>
        <fieldset><legend></legend><div class="wait-survey-options"></div></fieldset>
        <div class="wait-survey-actions"><button class="btn btn-primary" type="submit" disabled>Envoyer</button>
        <button class="wait-survey-skip" type="button">Passer la question</button></div>
        <p class="wait-survey-note">Facultatif. Tes réponses sont associées à ton compte pour nous aider à améliorer SongToSheet.</p>
        <p class="wait-survey-error" role="status"></p>`;
      form.querySelector('.wait-survey-heading span').textContent=`${state.total-state.questions.length+1} / ${state.total}`;
      form.querySelector('legend').textContent=question.text;
      const options=form.querySelector('.wait-survey-options');
      const submit=form.querySelector('[type="submit"]'),skip=form.querySelector('.wait-survey-skip');
      let saving=false;
      for(const [value,label] of Object.entries(question.options)){
        const tile=document.createElement('label');
        const input=document.createElement('input');
        input.type='radio';input.name='answer';input.value=value;
        const caption=document.createElement('span');
        caption.textContent=label;
        tile.append(input,caption);options.append(tile);
      }
      form.addEventListener('change',()=>{if(!saving)submit.disabled=false;});
      form.addEventListener('submit',event=>{
        event.preventDefault();
        const value=new FormData(form).get('answer');
        if(value!==null)save(value);
      });
      skip.addEventListener('click',()=>save(null));
      async function save(answer){
        if(saving)return;
        saving=true;
        submit.disabled=skip.disabled=true;
        try{
          await request({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:question.id,answer})});
          state.questions.shift();
          render();
        }catch{
          saving=false;
          submit.disabled=!form.querySelector('input:checked');skip.disabled=false;
          form.querySelector('.wait-survey-error').textContent='Impossible d’enregistrer pour l’instant.';
        }
      }
      root.replaceChildren(form);
    }
    request().then(({questions})=>{
      if(states.get(root)!==state)return;
      state.questions=questions;
      state.total=questions.length;
      render();
      root.hidden=!questions.length;
    }).catch(()=>{});
  }
  window.SongToSheetWaitSurvey={mount};
})();

/* Tablurio — first-party funnel analytics (no cookie, no IP kept). window.tbTrack(step) */
(function(){
  'use strict';
  if(navigator.webdriver)return;
  var KEY='tb_vid',memory=null;
  function store(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v);}catch(e){return null;}}
  function visitor(){
    var id=store(KEY)||memory;
    if(!id||!/^[A-Za-z0-9_-]{16,40}$/.test(id)){
      var bytes=new Uint8Array(16);(window.crypto||window.msCrypto).getRandomValues(bytes);
      id=Array.prototype.map.call(bytes,function(b){return('0'+b.toString(36)).slice(-2);}).join('').slice(0,24);
      memory=id;store(KEY,id);
    }
    return id;
  }
  // Attribution of the very first visit of this tab: UTM tags and referrer.
  var params=new URLSearchParams(location.search),first={};
  ['utm_source','utm_medium','utm_campaign','utm_content'].forEach(function(k){if(params.get(k))first[k]=params.get(k).slice(0,60);});
  first.referrer=document.referrer||'';
  function send(step,extra){
    var body={visitor:visitor(),step:step,path:location.pathname};
    for(var k in first)body[k]=first[k];
    for(var e in extra||{})body[e]=extra[e];
    try{fetch('/api/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true,credentials:'same-origin'});}catch(err){}
  }
  var once={};
  function track(step){
    if(step==='identify'||step==='engaged'){if(once[step])return;once[step]=true;}
    send(step);
  }
  window.tbTrack=track;
  // Page views, including the in-app navigations (history API).
  var lastPath=null;
  function view(){
    if(location.pathname===lastPath)return;lastPath=location.pathname;
    send('view');
    if(/^\/(tarifs|upgrade|pricing)/.test(lastPath))send('pricing');
    if(/^\/inscription/.test(lastPath))send('signup_open');
  }
  ['pushState','replaceState'].forEach(function(name){
    var original=history[name];
    history[name]=function(){var result=original.apply(this,arguments);setTimeout(view,0);return result;};
  });
  addEventListener('popstate',view);
  // Real interaction: robots load the page but never touch it.
  var engagedSince=Date.now();
  function engage(){if(Date.now()-engagedSince<600)return;track('engaged');['pointerdown','keydown','scroll','touchstart','mousemove'].forEach(function(t){removeEventListener(t,engage,true);});}
  ['pointerdown','keydown','scroll','touchstart','mousemove'].forEach(function(t){addEventListener(t,engage,{capture:true,passive:true});});
  // "Started": a click on a call to action of the landing page.
  addEventListener('click',function(event){
    var target=event.target.closest&&event.target.closest('a,button');
    if(!target)return;
    var text=(target.textContent||'').toLowerCase();
    if(/commencer|essayer|générer|generer|transcrire|créer ma|convertir/.test(text))track('start');
  },true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',view);else view();
})();

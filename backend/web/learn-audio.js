/* Tablurio — écoute au micro pour le mode Apprentissage, entièrement dans le navigateur.
 * Rien n'est enregistré ni envoyé : les fonctions analysent chaque trame puis l'oublient.
 * - detectPitch : hauteur d'une note seule (algorithme YIN)
 * - chroma / matchesChord : énergie par classe de note (12 demi-tons) pour les accords
 * - MicListener : micro → trames analysées (hauteur, chroma, attaque, niveau) */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TablurioLearnAudio=api;
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const MIN_FREQ=60,MAX_FREQ=1400,YIN_THRESHOLD=.15;
  // YIN sur les 2048 derniers échantillons (assez pour un Mi grave à 48 kHz), analyse ~40 fois par seconde : tenable sur mobile.
  const PITCH_WINDOW=2048,ANALYSIS_STEP=.025;

  const rms=samples=>{let sum=0;for(let i=0;i<samples.length;i++)sum+=samples[i]*samples[i];return Math.sqrt(sum/samples.length);};

  function detectPitch(samples,sampleRate,minRms=.01){
    if(!samples?.length||rms(samples)<minRms)return null;
    const tauMin=Math.floor(sampleRate/MAX_FREQ),tauMax=Math.min(Math.ceil(sampleRate/MIN_FREQ),Math.floor(samples.length/2));
    const width=samples.length-tauMax;
    const diff=new Float32Array(tauMax+1);
    for(let tau=1;tau<=tauMax;tau++){
      let sum=0;
      for(let i=0;i<width;i++){const d=samples[i]-samples[i+tau];sum+=d*d;}
      diff[tau]=sum;
    }
    // Différence normalisée cumulée.
    const cmnd=new Float32Array(tauMax+1);cmnd[0]=1;
    let running=0;
    for(let tau=1;tau<=tauMax;tau++){running+=diff[tau];cmnd[tau]=running?diff[tau]*tau/running:1;}
    let tau=-1;
    for(let t=tauMin;t<=tauMax;t++){
      if(cmnd[t]<YIN_THRESHOLD){while(t+1<=tauMax&&cmnd[t+1]<cmnd[t])t++;tau=t;break;}
    }
    if(tau<0){
      let best=tauMin;for(let t=tauMin;t<=tauMax;t++)if(cmnd[t]<cmnd[best])best=t;
      if(cmnd[best]>.2)return null;
      tau=best;
    }
    const clarity=1-cmnd[tau];
    if(clarity<.8)return null;
    let refined=tau;
    if(tau>1&&tau<tauMax){
      const a=cmnd[tau-1],b=cmnd[tau],c=cmnd[tau+1],den=a-2*b+c;
      if(den)refined=tau+(a-c)/(2*den);
    }
    return {freq:sampleRate/refined,clarity};
  }

  const midiOf=freq=>69+12*Math.log2(freq/440);

  // Juste à ±50 cents ; une erreur d'octave compte comme juste (harmoniques de guitare).
  function matchesNote(freq,midi){
    if(!(freq>0))return false;
    let gap=(midiOf(freq)-midi)%12;
    if(gap>6)gap-=12;if(gap<-6)gap+=12;
    return Math.abs(gap)<=.5;
  }

  function chroma(magnitudes,sampleRate,fftSize){
    const out=new Float32Array(12);
    const first=Math.ceil(60*fftSize/sampleRate),last=Math.min(magnitudes.length-1,Math.floor(2000*fftSize/sampleRate));
    for(let k=Math.max(1,first);k<=last;k++){
      const m=magnitudes[k];if(!(m>0))continue;
      const pc=((Math.round(midiOf(k*sampleRate/fftSize))%12)+12)%12;
      out[pc]+=m*m;
    }
    const max=Math.max(...out);
    if(max>0)for(let i=0;i<12;i++)out[i]/=max;
    return out;
  }

  function matchesChord(chromaVec,midis,threshold=.35){
    const classes=[...new Set((midis||[]).map(m=>((Math.round(m)%12)+12)%12))];
    if(!classes.length||!chromaVec)return false;
    const present=classes.filter(pc=>chromaVec[pc]>=threshold).length;
    return present/classes.length>=.6-1e-9;
  }

  class MicListener{
    static supported(){
      return typeof navigator!=='undefined'&&Boolean(navigator.mediaDevices?.getUserMedia)&&
        typeof window!=='undefined'&&Boolean(window.AudioContext||window.webkitAudioContext);
    }
    constructor(){this.callbacks=new Set();this.noise=.008;this.running=false;}
    async start(){
      if(this.running)return;
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      const Context=window.AudioContext||window.webkitAudioContext;
      this.context=new Context();
      if(this.context.state==='suspended')await this.context.resume().catch(()=>{});
      this.analyser=this.context.createAnalyser();
      this.analyser.fftSize=4096;this.analyser.smoothingTimeConstant=0;
      this.context.createMediaStreamSource(this.stream).connect(this.analyser);
      this.wave=new Float32Array(this.analyser.fftSize);
      this.db=new Float32Array(this.analyser.frequencyBinCount);
      this.mags=new Float32Array(this.analyser.frequencyBinCount);
      this.average=0;this.lastOnset=0;this.lastFrame=0;this.running=true;
      const loop=()=>{if(!this.running)return;this.frame();this.raf=requestAnimationFrame(loop);};
      loop();
    }
    frame(){
      const {analyser,context}=this;
      const time=context.currentTime;
      if(time-this.lastFrame<ANALYSIS_STEP)return;
      const dt=this.lastFrame?Math.min(.1,time-this.lastFrame):ANALYSIS_STEP;
      this.lastFrame=time;
      analyser.getFloatTimeDomainData(this.wave);
      analyser.getFloatFrequencyData(this.db);
      for(let i=0;i<this.db.length;i++)this.mags[i]=Number.isFinite(this.db[i])?Math.pow(10,this.db[i]/20):0;
      const level=rms(this.wave);
      // Moyenne glissante d'environ 300 ms.
      this.average+=(level-this.average)*Math.min(1,dt/.3);
      const onset=level>this.noise*1.5&&level>this.average*1.8&&time-this.lastOnset>.08;
      if(onset)this.lastOnset=time;
      const loud=level>this.noise;
      const pitch=loud?detectPitch(this.wave.subarray(this.wave.length-PITCH_WINDOW),context.sampleRate,this.noise):null;
      const frame={pitch:pitch?.freq||null,chroma:loud?chroma(this.mags,context.sampleRate,analyser.fftSize):null,onset,level,time,dt};
      for(const cb of this.callbacks)cb(frame);
    }
    onFrame(cb){this.callbacks.add(cb);return ()=>this.callbacks.delete(cb);}
    // « Joue une note » : mesure le bruit ambiant et vérifie qu'un vrai son arrive.
    calibrate(ms=5000){
      return new Promise(resolve=>{
        const levels=[];
        const off=this.onFrame(frame=>levels.push(frame.level));
        setTimeout(()=>{
          off();
          const sorted=[...levels].sort((a,b)=>a-b);
          const ambient=sorted[Math.floor(sorted.length*.2)]||0,peak=sorted.at(-1)||0;
          this.noise=Math.max(.004,ambient*2);
          resolve({ok:peak>.01&&peak>ambient*3,level:peak});
        },ms);
      });
    }
    stop(){
      this.running=false;cancelAnimationFrame(this.raf);
      this.stream?.getTracks().forEach(track=>track.stop());
      if(this.context&&this.context.state!=='closed')this.context.close().catch(()=>{});
      this.callbacks.clear();
    }
  }

  return {detectPitch,midiOf,matchesNote,chroma,matchesChord,MicListener,PITCH_WINDOW};
});

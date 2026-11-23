// Short, locally synthesized cues keep the sound and the visible contact on one clock.
export function gameFeedback(telegram, button) {
  let audio, noise, muted=false, lastImpact=-Infinity;
  try { muted=localStorage.getItem('lyceum.game.muted')==='1'; } catch {}
  function update() {
    button.setAttribute('aria-pressed',String(!muted));
    button.title=muted?'Увімкнути звук':'Вимкнути звук';
  }
  function unlock() {
    if(muted||document.hidden)return;
    try {
      const Context=window.AudioContext||window.webkitAudioContext;
      if(!audio && Context){
        audio=new Context({latencyHint:'interactive'});
        noise=audio.createBuffer(1,Math.ceil(audio.sampleRate*.055),audio.sampleRate);
        const samples=noise.getChannelData(0);
        for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
      }
      if(audio?.state==='suspended')audio.resume().catch(()=>{});
    } catch {}
  }
  button.onclick=()=>{
    muted=!muted;update();
    try { localStorage.setItem('lyceum.game.muted',muted?'1':'0'); } catch {}
    if(muted)audio?.suspend().catch(()=>{});else {unlock();cue('turn')}
  };
  update();
  document.addEventListener('pointerdown',unlock,{passive:true});
  document.addEventListener('keydown',unlock);
  function voice(frequency, time, duration, gain, noisy=false) {
    const source=noisy?audio.createBufferSource():audio.createOscillator();
    const envelope=audio.createGain(), filter=audio.createBiquadFilter();
    if(noisy)source.buffer=noise;
    else {source.type='sine';source.frequency.setValueAtTime(frequency,time);source.frequency.exponentialRampToValueAtTime(frequency*.86,time+duration)}
    filter.type='lowpass';filter.frequency.value=noisy?frequency:2400;
    envelope.gain.setValueAtTime(.0001,time);
    envelope.gain.exponentialRampToValueAtTime(gain,time+.004);
    envelope.gain.exponentialRampToValueAtTime(.0001,time+duration);
    source.connect(filter).connect(envelope).connect(audio.destination);
    source.onended=()=>{source.disconnect();filter.disconnect();envelope.disconnect()};
    source.start(time);source.stop(time+duration+.006);
  }
  function cue(kind, strength=1) {
    if(document.hidden)return;
    try {
      if(telegram?.isVersionAtLeast?.('6.1')){
        const h=telegram.HapticFeedback;
        if(kind==='win')h?.notificationOccurred('success');
        if(kind==='claim'||kind==='build')h?.impactOccurred('medium');
        if(kind==='turn')h?.selectionChanged();
        if(kind==='impact' && strength>.8 && performance.now()-lastImpact>180){
          lastImpact=performance.now();h?.impactOccurred('light');
        }
      }
    } catch {}
    if(muted||audio?.state!=='running')return;
    const t=audio.currentTime;
    try {
      if(kind==='impact'||kind==='build'||kind==='step'){
        voice(kind==='step'?145:230,t,.078,.082*strength);
        voice(kind==='build'?1350:2050,t,.045,.075*strength,true);
      }else{
        const notes=kind==='win'?[392,494,587]:kind==='claim'?[554,740]:[440];
        notes.forEach((n,i)=>voice(n,t+i*.093,kind==='win'?.24:.115,.037));
      }
    } catch {}
  }
  return {cue,dispose(){
    document.removeEventListener('pointerdown',unlock);document.removeEventListener('keydown',unlock);
    button.onclick=null;audio?.close().catch(()=>{});
  }};
}

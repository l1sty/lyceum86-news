const media=matchMedia('(prefers-reduced-motion: reduce)');
const active=new Map();
const spring={type:'spring',stiffness:440,damping:40,mass:.85};
export const still=()=>media.matches||document.hidden||!window.Motion;

function stop(key,finish=false){
  const animation=active.get(key);
  if(!animation)return;
  active.delete(key);
  if(finish)animation.complete();
  animation.stop();
}
function track(key,animation,done){
  active.set(key,animation);
  animation.then(()=>{
    if(active.get(key)!==animation)return;
    active.delete(key);done?.();
  });
}
export function surface(el,frames,options={},done){
  if(active.has(el)){
    frames=Object.fromEntries(Object.entries(frames).map(([key,value])=>
      [key,Array.isArray(value)?[null,...value.slice(1)]:value]));
  }
  stop(el);
  if(still()){el.style.transform='';el.style.opacity='';done?.();return}
  try{track(el,window.Motion.animate(el,frames,{...spring,...options}),done)}
  catch{el.style.transform='';el.style.opacity='';done?.()}
}
export function count(el,record,to,format){
  stop(el);
  const settle=()=>{record.shown=to;el.textContent=format(to)};
  if(still()){settle();return}
  try{
    const animation=window.Motion.animate(record.shown,to,{duration:.45,ease:[.2,.66,.25,1],
      onUpdate(value){record.shown=value;el.textContent=format(Math.round(value))}});
    track(el,animation,settle);
  }catch{settle()}
}
export function cancelMotion(el){stop(el)}
function finishAll(){
  for(const animation of [...active.values()])animation.complete();
}
function visibility(){if(document.hidden)finishAll()}
media.addEventListener('change',finishAll);
document.addEventListener('visibilitychange',visibility);
let pressed;
function release(){if(pressed){surface(pressed,{scale:1});pressed=null}}
function press(e){
  const b=e.target.closest('button:not(:disabled):not(.tile-label)');
  if(!b || still())return;
  release();pressed=b;surface(b,{scale:.965},{stiffness:720});
}
document.addEventListener('pointerdown',press);
window.addEventListener('pointerup',release);
window.addEventListener('pointercancel',release);
window.addEventListener('blur',release);
export function disposeUI(){
  for(const key of active.keys())stop(key);
  media.removeEventListener('change',finishAll);document.removeEventListener('visibilitychange',visibility);
  document.removeEventListener('pointerdown',press);window.removeEventListener('pointerup',release);
  window.removeEventListener('pointercancel',release);window.removeEventListener('blur',release);
}

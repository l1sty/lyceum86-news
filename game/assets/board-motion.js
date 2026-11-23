import * as T from './three.module.min.js';
import {dicePlayback} from './dice-playback.js';

const clamp = T.MathUtils.clamp;
const boardSize = 20;
const cosQuarter = [1,0,-1,0], sinQuarter = [0,1,0,-1];

// A continuous perimeter coordinate keeps a pawn on the outside pavement,
// including a rounded turn at each corner and across the start square.
function placePawn(mesh, distance, seat) {
  const shifted = distance + ((seat % 3)-1)*.18, n = ((shifted % boardSize)+boardSize)%boardSize;
  let side = Math.floor(n/5);
  const along = n-side*5;
  const edge = 5.57 + Math.floor(seat/3)*.31;
  const corner = .25;
  let x, z=edge;
  if (along < corner || along > 5-corner) {
    const end = along > 2.5, u = (along+(end ? -5 : 0)+corner)/(2*corner);
    // Quadratic fillet between equal-length tangents on adjacent edges.
    x = -edge + 2*corner*u*u;
    z = edge - 2*corner*(1-u)*(1-u);
    side = (side + Number(end)) % 4;
  } else x = T.MathUtils.mapLinear(along, corner, 5-corner, -edge+2*corner, edge-2*corner);
  const c=cosQuarter[side], s=sinQuarter[side];
  mesh.position.set(x*c+z*s, .151, z*c-x*s);
}

export function boardMotion({scene, dice, shadows, pawn, colors, plots, invalidate, cue, reduced}) {
  const gsap = window.gsap;
  const roller = dicePlayback(dice, shadows, cue, invalidate);
  const tracks = new Map(), tokens = new Map();
  const focus = {subject:null, amount:0, magnify:0};
  const trayCenter = new T.Vector3(0,0,2.48);
  let previous;
  function kill(key) {
    tracks.get(key)?.kill();
    tracks.delete(key);
  }
  function timeline(key) {
    kill(key);
    const tl = gsap.timeline({paused:true});
    tracks.set(key, tl);
    return tl;
  }
  function releaseCamera() {
    kill('camera');
    focus.subject=null;
    focus.amount=focus.magnify=0;
    invalidate();
  }
  function shot(subject, weight, zoom, hold) {
    focus.subject = subject;
    const tl=timeline('camera').to(focus,{amount:weight, magnify:zoom, duration:.38, ease:'sine.inOut'});
    if(hold!==null)tl.to(focus,{amount:0, magnify:0, duration:.52, ease:'sine.inOut'},hold);
  }
  function renderPlots() { plots.write(); }
  function update(state, instant=false) {
    const sameRoom = state && previous?.code === state.code;
    const animate = !!(sameRoom && !instant && !reduced.matches && gsap);
    const rolled = sameRoom && state.roll > previous.roll;
    const values = state?.dice?.length ? state.dice : [2,5];
    const mover=rolled && state.players.find(p=>{
      const token=tokens.get(p.id);
      return !p.out && token && (token.destination+values[0]+values[1])%boardSize===p.pos;
    });
    if (!animate) {
      for (const key of tracks.keys()) kill(key);
      releaseCamera();
      roller.settle(values);
    } else if (rolled) {
      roller.roll(values);
      shot(trayCenter,.38,.14,mover ? null : .8);
    } else if (state.roll !== previous.roll) roller.settle(values);
    if (state && !reduced.matches) roller.warm();

    const players=state?.players || [];
    players.forEach((p,seat) => {
      let token=tokens.get(p.id);
      if (!token) {
        const mesh=new T.Mesh(pawn,new T.MeshStandardMaterial({color:colors[seat],metalness:.46,roughness:.22}));
        token={mesh, distance:p.pos, destination:p.pos, seat};
        tokens.set(p.id,token); scene.add(mesh);
      }
      const {mesh}=token, key='pawn'+p.id;
      mesh.visible=!p.out;
      if (!animate || p.out || token.seat!==seat || !previous.players.some(q=>q.id===p.id)) {
        kill(key);
        token.seat=seat;mesh.material.color.set(colors[seat]);
        token.distance=token.destination=p.pos;
        placePawn(mesh,token.distance,seat);
      } else if (token.destination % boardSize !== p.pos) {
        const destination=token.destination+(p.pos-token.destination%boardSize+boardSize)%boardSize;
        const duration=clamp(.38+Math.sqrt(destination-token.distance)*.27,.55,1.48);
        const delay=rolled ? .66 : 0;
        token.destination=destination;
        const tl=timeline(key);
        tl.to(token,{distance:destination,duration,ease:'power1.inOut',
          onUpdate:()=>placePawn(mesh,token.distance,seat),
          onComplete:()=>cue('step')},delay);
        if (p===mover) {
          // A manual camera action kills this entire shot, including the handoff.
          const camera=tracks.get('camera');
          camera.call(()=>{focus.subject=mesh.position},[],delay)
            .to(focus,{amount:.32,magnify:.10,duration:.28},delay)
            .to(focus,{amount:0,magnify:0,duration:.55,ease:'sine.inOut'},delay+duration+.12);
        }
      }
    });
    for (const [id,token] of tokens) if (!players.some(p=>p.id===id)) {
      kill('pawn'+id);scene.remove(token.mesh);token.mesh.material.dispose();tokens.delete(id);
    }
    for (const plot of plots.items) {
      const deed=state?.deeds[plot.tile], old=sameRoom && previous.deeds[plot.tile];
      if (animate && deed?.owner===old?.owner && deed?.level===old?.level) continue;
      const key='plot'+plot.tile;
      kill(key);
      const color=deed ? new T.Color(colors[players.findIndex(p=>p.id===deed.owner)]) : plot.color.clone();
      if (!animate) {
        plot.claim=Number(!!deed); plot.level=deed?.level||0; plot.color.copy(color);
      } else {
        const tl=timeline(key);
        tl.to(plot,{claim:Number(!!deed),duration:.38,ease:'power2.out'},0)
          .to(plot.color,{r:color.r,g:color.g,b:color.b,duration:.38},0)
          .to(plot,{level:deed?.level||0,duration:.62,ease:'power1.inOut'},0);
        if (deed) {
          const build=old && deed.level>old.level;
          if (!old) plot.color.copy(color);
          shot(plot.center,.41,build ? .18 : .12,.66);
          tl.call(()=>cue(build?'build':'claim'),[],build ? .49 : .23);
        }
      }
    }
    if (animate && state.winner && state.winner!==previous.winner) {
      const winner=tokens.get(state.winner);
      if(winner)shot(winner.mesh.position,.54,.22,1.7);
    }
    renderPlots();
    previous=state;
    invalidate();
  }
  function advance(dt) {
    let plotsDirty=false;
    for (const [key,tl] of tracks) {
      tl.time(Math.min(tl.duration(),tl.time()+dt),false);
      if (key.startsWith('plot')) plotsDirty=true;
      if (tl.progress()===1) kill(key);
    }
    if (plotsDirty) renderPlots();
    return roller.advance(dt) || tracks.size>0;
  }
  return {update,advance,focus,releaseCamera,tokens,
    settle(){update(previous,true)},
    dispose(){for(const key of tracks.keys())kill(key);roller.dispose()}
  };
}

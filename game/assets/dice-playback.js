import * as T from './three.module.min.js';
import {tray, step} from './dice-tray.js';

const up = new T.Vector3(0,1,0);
const normals = [null, up, new T.Vector3(0,0,1), new T.Vector3(1,0,0),
  new T.Vector3(-1,0,0), new T.Vector3(0,0,-1), new T.Vector3(0,-1,0)];
const identity = new T.Quaternion();
const speed = 1.32;
const smooth = T.MathUtils.smoothstep;

export function dicePlayback(dice, shadows, cue, invalidate) {
  const position = new T.Vector3(), orientation = new T.Quaternion(), scratch = new T.Quaternion();
  const direction = new T.Vector3();
  let worker, ready = false, request = 0, timer, active, waiting, elapsed = 0, contact = 0;

  function rest(i) { return new T.Vector3((i ? 1 : -1) * .65, tray.floor + tray.die / 2, tray.z + (i ? -.10 : .10)); }
  function shadowsAtFeet() {
    dice.forEach((die,i) => {
      const shadow = shadows[i], lift = Math.max(0, die.position.y - tray.floor - tray.die / 2);
      shadow.position.set(die.position.x, tray.floor+.002, die.position.z);
      shadow.scale.setScalar(.78 + lift * .32);
      shadow.material.opacity = .66 / (1 + lift * 2);
    });
  }
  function stop() { request++; clearTimeout(timer); active = waiting = null; }
  function settle(values) {
    stop();
    dice.forEach((die,i) => {
      die.position.copy(rest(i));
      die.quaternion.setFromUnitVectors(normals[values[i]], up);
    });
    shadowsAtFeet();
  }
  function play(clip) {
    if (!waiting) return;
    clearTimeout(timer);
    const {values, starts} = waiting;
    waiting = null;
    const frames = clip ? clip.poses.length / 14 : 0;
    const corrections = dice.map((_, i) => {
      if (!clip) return new T.Quaternion().setFromUnitVectors(normals[values[i]], up);
      orientation.fromArray(clip.poses, (frames-1)*14+i*7+3);
      direction.copy(up).applyQuaternion(orientation.invert());
      const top = normals.slice(1).reduce((a,b) => direction.dot(a) > direction.dot(b) ? a : b);
      // A cube symmetry is immaterial to the collider. Blend the engraving's
      // orientation during launch so the authoritative face lands naturally.
      return new T.Quaternion().setFromUnitVectors(normals[values[i]], top);
    });
    active = {clip, frames, corrections, starts, ends:dice.map((_,i) => rest(i)),
      duration:clip ? (frames-1)*step/speed : .91};
    elapsed = contact = 0;
    invalidate();
  }
  function warm() {
    if (worker || !window.Worker || !window.WebAssembly) return;
    try {
      worker = new Worker(new URL('./dice-worker.js', import.meta.url), {type:'module'});
      worker.onmessage = ({data}) => {
        if (data.ready) ready = true;
        if (data.failed) { worker.terminate(); ready=false; }
        if (data.id === request) play(data.clip);
      };
      worker.onerror = () => { ready=false; worker.terminate(); play(null); };
    } catch { ready=false; }
  }
  function roll(values) {
    stop();
    const starts = dice.map(m => [...m.position.toArray(), ...m.quaternion.toArray()]);
    waiting = {values, starts};
    if (!ready) { play(null); return; }
    worker.postMessage({id: request, starts});
    timer = setTimeout(() => play(null), 95);
  }
  function advance(dt) {
    if (!active) return false;
    elapsed = Math.min(active.duration, elapsed + dt);
    const {clip, frames, starts, ends, corrections} = active;
    const progress = elapsed / active.duration;
    if (clip) {
      const cursor = progress * (frames-1), a = Math.floor(cursor), b = Math.min(frames-1,a+1);
      dice.forEach((die,i) => {
        const offset = a*14+i*7, next = b*14+i*7;
        die.position.fromArray(clip.poses, offset).lerp(position.fromArray(clip.poses, next), cursor-a);
        die.quaternion.fromArray(clip.poses, offset+3).slerp(orientation.fromArray(clip.poses, next+3), cursor-a);
        die.quaternion.multiply(scratch.copy(identity).slerp(corrections[i], smooth(elapsed, .025, .23)));
      });
      while (contact < clip.impacts.length && cursor >= clip.impacts[contact]) {
        if (contact < 3) cue('impact', 1 / (1 + contact*.8));
        contact++;
      }
    } else {
      dice.forEach((die,i) => {
        const t = Math.min(1, progress * (i ? 1 : 1.08)), first = Math.min(1,t/.72);
        const rebound = Math.max(0,(t-.72)/.28);
        die.position.fromArray(starts[i]).lerp(ends[i], smooth(t,0,1));
        die.position.y += 4*first*(1-first)*.89 + 4*rebound*(1-rebound)*.095;
        die.quaternion.fromArray(starts[i],3).slerp(corrections[i], smooth(t,0,1))
          .premultiply(scratch.setFromAxisAngle(normals[i ? 3 : 2], (i ? -1 : 1)*Math.PI*2*(1-(1-t)**2)));
      });
      if (!contact && progress >= .68) { contact++; cue('impact'); }
    }
    shadowsAtFeet();
    if (progress >= 1) active = null;
    return !!active;
  }
  return {warm, roll, settle, advance, dispose() { stop(); worker?.terminate(); }};
}

// Vendored @dimforge/rapier3d-compat 0.21.0, distributed under RAPIER-LICENSE.
import RAPIER from './rapier.min.js';
import {tray, step} from './dice-tray.js';

// The worker produces visual poses only. It never chooses or receives game results.
const ready = RAPIER.init();
ready.then(() => postMessage({ready: true})).catch(() => postMessage({failed: true}));

function simulate(starts, random) {
  const world = new RAPIER.World({x: 0, y: -24, z: 0});
  const contacts = new RAPIER.EventQueue(true);
  try {
    world.timestep = step;
    function fixed(x, y, z, w, h, d) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(w, h, d)
        .setTranslation(x, y, z).setFriction(.7).setRestitution(.19));
    }
    fixed(0, tray.floor - .1, tray.z, tray.halfWidth, .1, tray.halfDepth);
    for (const sign of [-1, 1]) {
      fixed(sign * (tray.halfWidth + .04), tray.floor + tray.rim / 2, tray.z, .04, tray.rim / 2, tray.halfDepth + .08);
      fixed(0, tray.floor + tray.rim / 2, tray.z + sign * (tray.halfDepth + .04), tray.halfWidth, tray.rim / 2, .04);
    }
    const half = tray.die / 2, radius = tray.die * .087;
    const bodies = starts.map(([x,y,z,qx,qy,qz,qw], i) => {
      const side = i ? 1 : -1;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x,y,z).setRotation({x:qx,y:qy,z:qz,w:qw})
        .setLinvel((side * .67 - x) * 1.45 + (random() - .5) * .74,
          5.1 + random() * 1.25, (tray.z - z) * 1.55 + (random() - .5) * .85)
        .setAngvel({x: side * (7 + random() * 8), y: (random() - .5) * 11, z: (random() - .5) * 21})
        .setAngularDamping(.46).setLinearDamping(.12).setCcdEnabled(true));
      world.createCollider(RAPIER.ColliderDesc.roundCuboid(half-radius,half-radius,half-radius,radius)
        .setFriction(.72).setRestitution(.27).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      return body;
    });
    const poses = starts.flat(), impacts = [];
    let quiet = 0;
    for (let frame = 1; frame <= 225; frame++) {
      world.step(contacts);
      contacts.drainCollisionEvents((_a, _b, began) => {
        if (began && frame > 10 && (!impacts.length || frame - impacts.at(-1) > 8)) impacts.push(frame);
      });
      let stopped = true;
      for (const body of bodies) {
        const p = body.translation(), q = body.rotation(), v = body.linvel(), w = body.angvel();
        if (p.y < tray.floor || Math.abs(p.x) > tray.halfWidth || Math.abs(p.z-tray.z) > tray.halfDepth) return null;
        poses.push(p.x,p.y,p.z,q.x,q.y,q.z,q.w);
        stopped &&= v.x*v.x + v.y*v.y + v.z*v.z < .003 && w.x*w.x + w.y*w.y + w.z*w.z < .008;
      }
      quiet = stopped ? quiet + 1 : 0;
      if (quiet >= 5) break;
    }
    if (bodies.some(b => Math.abs(b.translation().y - tray.floor - half) > .014) || !quiet) return null;
    return {poses: new Float32Array(poses), impacts};
  } finally {
    contacts.free();
    world.free();
  }
}

self.onmessage = async ({data: {id, starts}}) => {
  try {
    await ready;
    let clip;
    for (let attempt = 0; !clip && attempt < 5; attempt++) clip = simulate(starts, Math.random);
    postMessage({id, clip}, clip ? [clip.poses.buffer] : []);
  } catch { postMessage({id, clip: null}); }
};

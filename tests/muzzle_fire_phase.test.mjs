import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCrewAssets, realCrewPair, seeded, THREE } from './helpers/crew-assets.mjs';
import { GunnerController } from '../src/game/gunner.js';
import { VMU } from '../src/view/viewmodel.js';
import { ParticleSystem, PDesc, PF, STRIDE } from '../src/view/fx/particles.js';
import { tracerHit } from '../src/view/fx/recipes.js';
import { TRACER } from '../src/view/fx/weapons.js';
import { Fx } from '../src/view/fx.js';

const neutral = () => ({ dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false, reload: false, grenade: false, swap: 0, slot: -1, crouch: false, moveX: 0, moveZ: 0 });
const close = (actual, expected, label) => assert.ok(actual.distanceTo(expected) < 1e-7, `${label}: ${actual.toArray()} versus ${expected.toArray()}`);

function imageShim() {
  const old = { window: globalThis.window, document: globalThis.document };
  globalThis.window = {};
  globalThis.document = { createElementNS: () => {
    const listeners = new Map();
    return { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event),
      set src(value) { this.url = value; queueMicrotask(() => listeners.get('load')?.call(this)); } };
  } };
  return () => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } };
}

test('real hip/ADS barrels, physical rays and same-frame flashes agree through movement and final camera projection', async () => {
  await loadCrewAssets(); const restore = imageShim();
  try {
    for (const weapon of ['pistol', 'smg', 'shotgun', 'rifle']) for (const firstPerson of [false, true]) for (const fps of [30, 60, 120]) {
      const pair = realCrewPair({ kind: 'hero_gunner', weapon }), f = pair[1], events = [], target = new THREE.Vector3(), plane = new THREE.Plane();
      const gunner = new GunnerController({ weapons: [weapon] }, {
        emit: event => events.push(event), ownCar: () => null, targets: function* () {},
        raycastWorld(origin, dir, max) {
          const denom = plane.normal.dot(dir); if (Math.abs(denom) < 1e-8) return null;
          const t = -plane.distanceToPoint(origin) / denom;
          return t > 0 && t <= max ? { t, normal: plane.normal, kind: 'concrete' } : null;
        },
      });
      gunner.stats[0].spread = { ...gunner.stats[0].spread, hip: 0, ads: 0, bloom: 0 };
      for (let frame = 0; frame < 8; frame++) {
        const dt = 1 / fps, adsK = frame < 2 ? 0 : frame < 4 ? .5 : 1;
        gunner.fireT = gunner.pumpT = gunner.boltT = gunner.swapT = 0; gunner.mag[0] = gunner.weapon.mag; gunner.reloading = false; gunner.trigger = false;
        gunner.yaw = .2 + frame * .14; gunner.pitch = -.12 + frame * .02; gunner.bloom = 0;
        const priorCamera = { position: f.camera.position, dir: new THREE.Vector3(0, 0, -1).applyQuaternion(f.camera.quaternion) };
        seeded(300 + frame, () => gunner.update(dt, { ...neutral(), fire: true, firePressed: true, ads: adsK > .5, dYaw: .025 }, priorCamera, frame * .03, { deferFire: true }));
        assert.equal(events.filter(e => e.t === 'shot').length, frame);
        // Final camera changes include translation from shake and FOV changes.
        const eye = new THREE.Vector3(frame * 40 / fps, 2.5, 20 + frame * 23 / fps);
        f.car.root.position.set(eye.x, .08 * Math.sin(frame), eye.z);
        f.car.root.quaternion.setFromEuler(new THREE.Euler(.04, frame * .03, -.02));
        f.camera.position.copy(eye).add(new THREE.Vector3(.12 * Math.sin(frame), .07 * Math.cos(frame), .06));
        const dir = new THREE.Vector3(Math.sin(gunner.yaw) * Math.cos(gunner.pitch), Math.sin(gunner.pitch), Math.cos(gunner.yaw) * Math.cos(gunner.pitch));
        f.camera.lookAt(target.copy(f.camera.position).add(dir)); f.camera.fov = 75 - adsK * 25; f.camera.updateProjectionMatrix();
        target.copy(f.camera.position).addScaledVector(dir, 40); plane.setFromNormalAndCoplanarPoint(dir, target);
        const pose = { alive: true, quat: f.car.root.quaternion, vel: new THREE.Vector3(40, 0, 23), speed: 46, steer: 0,
          aimYaw: gunner.yaw, aimPitch: gunner.pitch, crouch: false, ads: adsK > .5, fire: true, reloading: false, weaponId: weapon,
          local: { firstPerson, camera: f.camera, eye, adsK, bedX: 0, bedZ: 0, gunner } };
        seeded(400 + frame, () => f.crew.update(dt, pose)); f.scene.updateMatrixWorld(true);
        assert.equal(f.crew.muzzleWorld(gunner.muzzle), true);
        const muzzle = gunner.muzzle.clone(), projected = muzzle.clone().project(f.camera);
        if (firstPerson) {
          const vm = f.crew.vm, rendered = new THREE.Vector4().copy(new THREE.Vector4(...vm.muzzleCam.toArray(), 1)).applyMatrix4(VMU.vmProj.value);
          assert.ok(Math.abs(projected.x - rendered.x / rendered.w) < 1e-8);
          assert.ok(Math.abs(projected.y - rendered.y / rendered.w) < 1e-8);
        } else close(muzzle, f.crew.weapon.sockets.muzzle.getWorldPosition(new THREE.Vector3()), 'external authored barrel');
        seeded(500 + frame, () => assert.equal(gunner.finishFire({ position: f.camera.position, dir }), true));
        const event = events.filter(e => e.t === 'shot').at(-1);
        close(new THREE.Vector3().fromArray(event.origin), muzzle, 'physical launch');
        for (const ray of event.rays) close(new THREE.Vector3().fromArray(ray.end), target, 'camera target with muzzle parallax');
        assert.equal(gunner.finishFire({ position: f.camera.position, dir }), false);
        if (firstPerson) {
          const vm = f.crew.vm, before = vm.muzzleCam.clone(); vm.notifyShot(gunner);
          assert.equal(vm.lastShots, gunner.shots); assert.equal(vm.flashStar.visible, true);
          close(vm.muzzleCam, before, 'notify does not move fired barrel');
          const impulse = Array.from(vm.recP.v); vm.notifyShot(gunner); assert.deepEqual(Array.from(vm.recP.v), impulse);
        }
      }
      pair.forEach(item => { item.crew.dispose(); item.car.dispose(); });
    }
  } finally { restore(); }
});

test('camera aiming does not bypass an obstacle between the current muzzle and the crosshair target', () => {
  const events = [], camera = { position: new THREE.Vector3(0, 2, 0), dir: new THREE.Vector3(0, 0, 1) };
  const gunner = new GunnerController({ weapons: ['pistol'] }, {
    emit: e => events.push(e), ownCar: () => null, targets: function* () {},
    raycastWorld(o) { if (o.x > .1) return { t: .7, normal: new THREE.Vector3(-1, 0, 0), kind: 'metal' }; return { t: 40, normal: new THREE.Vector3(0, 0, -1), kind: 'concrete' }; },
  });
  gunner.stats[0].spread = { ...gunner.stats[0].spread, hip: 0, ads: 0 }; gunner.muzzle.set(.35, 1.8, .8);
  gunner.update(1 / 60, { ...neutral(), fire: true }, camera, 0, { deferFire: true }); gunner.finishFire(camera);
  const event = events.find(e => e.t === 'shot'), end = new THREE.Vector3().fromArray(event.rays[0].end);
  assert.ok(Math.abs(end.distanceTo(gunner.muzzle) - .7) < 1e-8); assert.equal(event.rays[0].surface, 'metal');
});

function shaderSpan(pool) {
  // Execute the actual small GLSL span function under CPU arithmetic. Expected
  // distances below are independent flight/endpoint assertions, not a second
  // handwritten copy of the shader implementation.
  const match = pool.mat.vertexShader.match(/vec2 streakSpan\([^)]*\) \{([\s\S]*?)\n\}/); assert.ok(match);
  assert.ok(pool.mat.vertexShader.includes('streakSpan(trav, L, aLt.z, age, flags)'));
  const body = match[1].replace(/\bfloat\b/g, 'let').replace(/\bmin\(/g, 'Math.min(').replace(/return vec2\(([^;]+)\);/, 'return [$1];');
  return new Function('travel', 'ribbonLength', 'clip', 'age', 'flags', 'clamp', body);
}

function shaderEnvelope(pool) {
  const match = pool.mat.vertexShader.match(/float particleEnvelope\([^)]*\) \{([\s\S]*?)\n\}/); assert.ok(match);
  assert.ok(pool.mat.vertexShader.includes('particleEnvelope(t, aEn.x, aEn.y, flags)'));
  const body = match[1].replace(/\bfloat\b/g, 'let').replace(/\bmax\(/g, 'Math.max(');
  const smoothstep = (lo, hi, value) => { const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
  const evaluate = new Function('t', 'fin', 'fout', 'flags', 'smoothstep', body);
  return (t, fin, fout, flags) => evaluate(t, fin, fout, flags, smoothstep);
}

test('new tracers are uploaded at birth and start visibly at the muzzle at30/60/120fps, then fly and clip normally', () => {
  for (const fps of [30, 60, 120]) {
    const pool = new ParticleSystem(new THREE.Scene(), { cap: 48, uniforms: {}, name: 'test' }), p = new PDesc(), fx = { p, pf: pool };
    const span = shaderSpan(pool), envelope = shaderEnvelope(pool), clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
    for (const [wid, tuning] of Object.entries(TRACER)) {
      pool.clear(); pool.buf.clearUpdateRanges(); pool.dmin = 1e9; pool.dmax = -1; pool.time = 12.25;
      tracerHit(fx, wid, 5, 2, 7, 5, 2, 87); const before = pool.buf.version; pool.flush();
      assert.equal(pool.time, 12.25); assert.equal(pool.geo.instanceCount, 2); assert.equal(pool.buf.version, before + 1);
      for (let slot = 0; slot < 2; slot++) {
        const o = slot * STRIDE, flags = pool.data[o + 47], length = pool.data[o + 31], clip = pool.data[o + 42];
        assert.equal(flags & PF.MUZZLE_START, PF.MUZZLE_START); assert.deepEqual(Array.from(pool.data.slice(o, o + 3)), [5, 2, 7]);
        assert.deepEqual(span(0, length, clip, 0, flags, clamp), [0, length]);
        assert.equal(envelope(0, pool.data[o + 36], pool.data[o + 37], flags), 1);
        assert.equal(envelope(0, pool.data[o + 36], pool.data[o + 37], 0), 0);
        assert.equal(envelope(1, pool.data[o + 36], pool.data[o + 37], flags), 0);
        const dt = 1 / fps, travel = 620 * dt, moved = span(travel, length, clip, dt, flags, clamp);
        assert.ok(Math.abs(moved[1] - Math.min(80, travel)) < 1e-8);
        assert.ok(Math.abs(moved[0] - Math.max(0, travel - length)) < 1e-8);
        for (let frame = 0; frame < 30; frame++) {
          const age = frame / fps, [tail, head] = span(620 * age, length, clip, age, flags, clamp);
          assert.ok(tail >= 0 && tail <= head && head <= 80);
        }
      }
      assert.ok(tuning.len > 0); const version = pool.buf.version; pool.flush(); assert.equal(pool.buf.version, version);
    }
    pool.dispose();
  }
});

test('pre-render flush preserves pending after-render uploads and never advances or sweeps either FX pool', () => {
  const scene = new THREE.Scene(), pa = new ParticleSystem(scene, { cap: 8, uniforms: {} }), pf = new ParticleSystem(scene, { cap: 8, uniforms: {} }), p = new PDesc();
  pf.emit(p.pos(1, 2, 3)); pf.update(1 / 60); const pending = [...pf.buf.updateRanges];
  pf.emit(p.pos(4, 5, 6)); const time = pf.time, live = pf.live;
  const fx = Object.assign(Object.create(Fx.prototype), { loaded: true, pa, pf }); fx.flushEmits();
  assert.equal(pf.time, time); assert.equal(pf.live, live); assert.equal(pf.geo.instanceCount, 2);
  assert.deepEqual(pf.buf.updateRanges.slice(0, pending.length), pending);
  assert.ok(pf.buf.updateRanges.some(range => range.start === STRIDE && range.count === STRIDE));
  const version = pf.buf.version; fx.flushEmits(); assert.equal(pf.buf.version, version);
  pa.dispose(); pf.dispose();
});

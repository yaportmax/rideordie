import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fx } from '../src/view/fx.js';
import { ParticleSystem, PDesc, PF, STRIDE } from '../src/view/fx/particles.js';
import { Rng } from '../src/view/fx/util.js';

function fixture() {
  const scene = new THREE.Scene(), pa = new ParticleSystem(scene, { cap: 128, uniforms: {} }), pf = new ParticleSystem(scene, { cap: 128, uniforms: {} });
  const impacts = [], casings = [];
  const fx = Object.assign(Object.create(Fx.prototype), {
    pa, pf, p: new PDesc(), rng: new Rng(31), qd: 1, dist: () => 0, groundAt: () => -10, flashLight() {},
    _queueImpact: (ray, delay) => impacts.push({ ray, delay }),
    _eject: (weapon, origin) => casings.push({ weapon, origin: [...origin] }),
    tracked: Array.from({ length: 8 }, () => ({})), trackHead: 0,
  });
  return { fx, pf, impacts, casings, dispose() { pa.dispose(); pf.dispose(); } };
}

function traces(pool) {
  const out = [];
  for (let slot = 0; slot < pool.hw; slot++) {
    const o = slot * STRIDE;
    if (!(pool.data[o + 47] & PF.MUZZLE_START)) continue;
    const origin = new THREE.Vector3().fromArray(pool.data, o), velocity = new THREE.Vector3().fromArray(pool.data, o + 4);
    out.push({ origin, end: origin.clone().addScaledVector(velocity.normalize(), pool.data[o + 42]) });
  }
  return out;
}

test('remote player visual tracers/casings use this peer barrel without changing physical payload, endpoints or hit timing', () => {
  for (const weapon of ['pistol', 'smg', 'shotgun', 'rifle']) {
    const f = fixture(), event = { t: 'shot', src: 'player', remote: true, fp: 1, weapon, origin: [12, 7, 5],
      rays: [{ end: [40, 8, 90], surface: 'metal', carId: 2, dmg: 19, normal: [0, 0, -1] }] };
    const before = structuredClone(event), barrel = new THREE.Vector3(17, 5, 6); let queries = 0;
    f.fx._shot(event, { playerId: 1, playerMuzzle(out) { queries++; out.copy(barrel); return true; } });
    assert.equal(queries, 1); assert.deepEqual(event, before);
    const emitted = traces(f.pf); assert.equal(emitted.length, 2);
    for (const trace of emitted) {
      assert.deepEqual(trace.origin.toArray(), barrel.toArray());
      assert.ok(trace.end.distanceTo(new THREE.Vector3().fromArray(event.rays[0].end)) < 1e-5);
    }
    assert.deepEqual(f.casings, [{ weapon, origin: barrel.toArray() }]);
    assert.equal(f.impacts[0].ray, event.rays[0]);
    assert.equal(f.impacts[0].delay, new THREE.Vector3().fromArray(event.origin).distanceTo(new THREE.Vector3().fromArray(event.rays[0].end)) / 620);
    f.dispose();
  }
});

test('local player, unavailable remote rig and enemy projectile launches retain their physical origins', () => {
  for (const remote of [false, true]) {
    const f = fixture(), origin = [3, 4, 5]; let queries = 0;
    f.fx._shot({ t: 'shot', src: 'player', weapon: 'smg', origin, remote, rays: [{ end: [3, 4, 80] }] },
      { playerId: 1, playerMuzzle(out) { queries++; out.set(20, 30, 40); return false; } });
    assert.equal(queries, remote ? 1 : 0);
    for (const trace of traces(f.pf)) assert.deepEqual(trace.origin.toArray(), origin);
    f.dispose();
  }
  const f = fixture(), origin = [3, 4, 5]; let queries = 0;
  f.fx._shot({ t: 'shot', src: 2, weapon: 'enemy', origin, rays: [[0, 0, 1]], speed: 120 },
    { playerId: 1, playerMuzzle() { queries++; return true; } });
  assert.equal(queries, 0); assert.equal(traces(f.pf).length, 0); assert.equal(f.fx.tracked[0].x, origin[0]);
  assert.equal(f.fx.tracked[0].y, origin[1]); assert.equal(f.fx.tracked[0].z, origin[2]);
  f.dispose();
});

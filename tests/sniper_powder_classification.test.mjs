import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GunnerController } from '../src/game/gunner.js';
import { Fx } from '../src/view/fx.js';
import { MODE, PF, PDesc } from '../src/view/fx/particles.js';
import { SPR } from '../src/view/fx/atlas.js';
import { CASING } from '../src/view/fx/weapons.js';
import { Rng } from '../src/view/fx/util.js';

// Ordinary candidate test: original aimAt/raycast/fire/_shot/muzzle/_eject run.
// The empty world is a CPU fixture; only particle/mesh writes and lights are
// recorded. No replacement shot records, ray outcomes or effect recipes.
function actualMiss(weapon, fp) {
  const events = [], emitted = [], casings = [], lights = [];
  const gun = new GunnerController({ weapons: [weapon] }, {
    emit: event => events.push(event), report: () => { throw Error('empty world cannot report a hit'); },
    ownCar: () => null, targets: function* () {}, raycastWorld: () => null,
  });
  gun.muzzle.set(2, 3, 4); gun.fp = fp !== 0; gun.ads = fp === 2 ? 1 : 0;
  gun.vm = { scopedNow: fp === 2, ejectWorld: (position, direction) => { position.set(1.8, 3.1, 3.5); direction.set(-1, 0, 0); return true; } };
  gun.fire({ position: new THREE.Vector3(2, 3, 0), dir: new THREE.Vector3(0, 0, 1) });
  const event = events.find(event => event.t === 'shot'), original = structuredClone(event);
  const root = new THREE.Group(), ctx = { playerId: 1, carViews: new Map([[1, { root, spec: { seats: { gunner: [0, 1, 0] } } }]]) };
  const pool = name => ({ time: 0, emit: descriptor => { emitted.push({ pool: name, ...descriptor }); return emitted.length - 1; } });
  const fx = Object.assign(Object.create(Fx.prototype), {
    p: new PDesc(), pf: pool('fire'), pa: pool('alpha'), rng: new Rng(47), qd: 1,
    dist: () => 0, near: () => true, groundAt: () => 0,
    flashLight: (...args) => lights.push(args), casings: { spawn: (...args) => { casings.push(args); return casings.length - 1; } },
    _queueImpact: () => { throw Error('empty-world miss cannot queue an impact'); },
  });
  fx._shot(event, ctx);
  assert.deepEqual(event, original, 'presentation must preserve the actual controller event');
  assert.equal(gun.shots, 1); assert.equal(gun.magNow, gun.weapon.mag - 1);
  return { event, emitted, casings, lights, root };
}

test('sniper has one fast bullet without a slow powder fan while smoke, flashes and real casing routing survive; shotgun stays nine pellets', () => {
  for (const [weapon, fp, pellets, powderCount, casingKind] of [
    ['sniper', 0, 1, 0, 1], ['sniper', 1, 1, 0, 1], ['sniper', 2, 1, 0, 1],
    ['shotgun', 0, 9, 9, 2], ['shotgun', 1, 9, 9, 2],
  ]) {
    const result = actualMiss(weapon, fp), label = weapon + '/fp' + fp;
    assert.equal(result.event.rays.length, pellets, label + ': real bullet count');
    assert.ok(result.event.rays.every(ray => ray.end && !ray.surface && !ray.carId), label + ': original misses');
    const trajectories = result.emitted.filter(p => p.flags & PF.MUZZLE_START);
    const powder = result.emitted.filter(p => p.mode === MODE.STREAK && !(p.flags & PF.MUZZLE_START));
    assert.equal(trajectories.length, pellets * 2, label + ': each bullet retains ribbon and core');
    assert.equal(powder.length, powderCount, label + ': powder is not another bullet');
    for (const p of trajectories) {
      assert.equal(p.mode, MODE.STREAK); assert.ok(Math.abs(Math.hypot(p.vx, p.vy, p.vz) - 620) < 1e-8);
      assert.deepEqual([p.x, p.y, p.z], result.event.origin); assert.ok(p.clip > 3);
    }
    for (const p of powder) assert.ok(Math.hypot(p.vx, p.vy, p.vz) <= 26.0000001, label + ': distinct slow powder fan');
    const smoke = result.emitted.filter(p => p.spr === SPR.SMOKE);
    assert.equal(smoke.length, 4, label + ': complete authored smoke count');
    assert.ok(smoke.every(p => p.pool === 'alpha' && p.lit === 1 && p.nPlay === 4 && p.a0 > 0), label + ': smoke presentation retained');
    if (fp === 2) {
      assert.ok(smoke.every(p => p.a0 === .12 && Math.hypot(p.x - 2, p.y - 3, p.z - 4) >= 4.499999), 'scoped smoke remains ahead of the sight');
    }
    if (fp === 0) {
      assert.equal(result.emitted.filter(p => p.spr === SPR.MUZZLE).length, 2, label + ': star and forward cone');
      assert.equal(result.emitted.filter(p => p.spr === SPR.FLASH).length, 1, label + ': authored glow');
    } else {
      assert.equal(result.lights.length, 1, label + ': original first-person muzzle light');
      // The local viewmodel draws its own star/cone flash. This CPU Fx test
      // proves its world light/smoke/ejection only, not viewmodel pixels.
      assert.equal(result.emitted.filter(p => p.spr === SPR.MUZZLE).length, 0);
    }
    assert.equal(result.casings.length, 1, label + ': actual Fx._eject mesh write');
    assert.equal(result.casings[0][13], CASING[casingKind].hex, label + ': rifle brass versus shotgun shell');
    assert.equal(result.casings[0][15], result.root, label + ': casing remains attached to the car');
    if (fp) assert.deepEqual(result.casings[0].slice(0, 3), result.event.ej, label + ': actual viewmodel ejection port');
  }
});

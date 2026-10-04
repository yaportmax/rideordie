import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fx } from '../src/view/fx.js';
import { GunnerController } from '../src/game/gunner.js';
import { PDesc, PF, MODE } from '../src/view/fx/particles.js';
import { Rng } from '../src/view/fx/util.js';

// Copy this file into the candidate's ordinary tests directory. It imports the
// actual source graph and recipes; it does not extract or imitate _shot.
function gunFixture(weapon, contacts = []) {
  const events = [], reports = [];
  const gun = new GunnerController({ weapons: [weapon] }, {
    emit: event => events.push(event), report: report => reports.push(report),
    ownCar: () => null, targets: function* () {}, raycastWorld: () => null,
  });
  gun.muzzle.set(2, 3, 4);
  gun.stats[0].spread = { ...gun.stats[0].spread, hip: 0, ads: 0, bloom: 0 };
  gun.aimAt = () => gun.aimPoint.copy(gun.muzzle).add(new THREE.Vector3(0, 0, gun.weapon.range));
  let index = 0;
  gun._raycastAll = (origin, direction) => {
    const contact = contacts[index++]; if (!contact) return null;
    const point = gun.muzzle.clone().addScaledVector(direction, contact.distance);
    return contact.world ? { world: true, kind: 'concrete', point, normal: new THREE.Vector3(0, 0, -1) }
      : { world: false, car: { id: contact.id, veh: { pos: point.clone(), quat: new THREE.Quaternion(), poseRevision: 7 } }, zone: { kind: 'body' }, point };
  };
  return { gun, events, reports, camera: { position: new THREE.Vector3(0, 3, 0), dir: new THREE.Vector3(0, 0, 1) } };
}

function fxFixture() {
  const emitted = [], impacts = [], ejections = [], lights = [];
  const pool = { time: 17, emit: p => { emitted.push({ ...p }); return emitted.length - 1; } };
  const fx = Object.assign(Object.create(Fx.prototype), {
    p: new PDesc(), pf: pool, pa: pool, rng: new Rng(47), qd: 1, rockets: [],
    dist: () => 0, near: () => true, groundAt: () => -20,
    flashLight: (...args) => lights.push(args), _eject: (...args) => ejections.push(args),
    _queueImpact: (ray, delay) => impacts.push({ ray, delay }),
    tracked: [{}, {}, {}, {}], trackHead: 0,
  });
  return { fx, emitted, impacts, ejections, lights,
    tracers: () => emitted.filter(p => p.flags & PF.MUZZLE_START),
    muzzle: () => emitted.filter(p => !(p.flags & PF.MUZZLE_START)) };
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function fired(fixture) {
  fixture.gun.fire(fixture.camera);
  return fixture.events.find(event => event.t === 'shot');
}

test('one actual sniper round has one terminal trajectory in external, first-person hip and scoped views', () => {
  for (const view of [{ fp: false, ads: 0 }, { fp: true, ads: 0 }, { fp: true, ads: 1 }]) {
    const f = gunFixture('sniper', [{ id: 2, distance: 5 }, { id: 3, distance: 10 }, { id: 4, distance: 15 }]);
    f.gun.fp = view.fp; f.gun.ads = view.ads;
    f.gun.vm = { scopedNow: view.ads === 1, ejectWorld: () => false };
    const event = freeze(fired(f)), before = structuredClone(event), v = fxFixture();
    assert.equal(f.gun.weapon.pellets, 1);
    assert.equal(event.rays.length, 3);
    assert.equal(f.gun.shots, 1); assert.equal(f.gun.mag[0], f.gun.weapon.mag - 1);
    assert.deepEqual(f.reports.map(r => [r.carId, r.dmg, r.penetrationIndex, r.pelletIndex, r.shotId, r.poseRevision]),
      [[2, 150, 0, 0, 1, 7], [3, 90, 1, 0, 1, 7], [4, 90, 2, 0, 1, 7]]);
    v.fx._shot(event, {});
    assert.equal(v.tracers().length, 2, 'one authored flight retains a colored ribbon and a bright core');
    assert.ok(v.tracers().every(p => p.x === 2 && p.y === 3 && p.z === 4 && p.clip === 15));
    assert.deepEqual(v.impacts.map(i => [i.ray, i.delay]), event.rays.map((ray, i) => [ray, (i + 1) * 5 / 620]));
    assert.equal(v.ejections.length, 1);
    assert.deepEqual(event, before, 'FX must not change the shot or damage records');
    const flash = fxFixture(); flash.fx._shot({ ...event, rays: [] }, {});
    assert.deepEqual(v.muzzle(), flash.muzzle(), 'authored muzzle smoke, sparks and flash remain unchanged');
    assert.equal(v.fx.rng.s, flash.fx.rng.s);
  }
});

test('sniper misses, terminal world hits and depleted-range exits preserve the exact controller endpoint', () => {
  const cases = [
    { contacts: [], reports: 0, impacts: 0, distance: 700 },
    { contacts: [{ id: 2, distance: 5 }], reports: 1, impacts: 1, distance: 700 },
    { contacts: [{ id: 2, distance: 5 }, { id: 3, distance: 10 }], reports: 2, impacts: 2, distance: 694.75 },
    { contacts: [{ id: 2, distance: 5 }, { world: true, distance: 12 }], reports: 1, impacts: 2, distance: 12 },
    { contacts: [{ id: 2, distance: 699 }], reports: 1, impacts: 1, distance: 699 },
  ];
  for (const row of cases) {
    const f = gunFixture('sniper', row.contacts), event = freeze(fired(f)), before = structuredClone(event), v = fxFixture();
    const terminal = event.rays.at(-1).end, distance = new THREE.Vector3().fromArray(terminal).distanceTo(f.gun.muzzle);
    assert.equal(distance, row.distance, 'keep the current accumulated-range policy; do not extend it');
    v.fx._shot(event, {});
    assert.equal(v.tracers().length, 2);
    assert.ok(v.tracers().every(p => p.clip === distance));
    assert.equal(f.reports.length, row.reports); assert.equal(v.impacts.length, row.impacts);
    for (const impact of v.impacts) assert.equal(impact.delay,
      new THREE.Vector3().fromArray(impact.ray.end).distanceTo(f.gun.muzzle) / 620);
    assert.deepEqual(event, before);
  }
});

test('all other hitscan weapons retain every existing pellet and penetration-contact tracer', () => {
  for (const weapon of ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'minigun']) {
    const f = gunFixture(weapon, [{ id: 2, distance: 5 }, { id: 3, distance: 10 }]), event = freeze(fired(f));
    const before = structuredClone(event), v = fxFixture(); v.fx._shot(event, {});
    assert.equal(v.tracers().length, event.rays.length * 2, weapon);
    assert.equal(v.impacts.length, f.reports.length, weapon);
    assert.equal(v.ejections.length, 1, weapon);
    assert.deepEqual(event, before, weapon);
    if (weapon === 'shotgun') assert.equal(event.rays.length, 9, 'nine real pellets stay nine flights');
    if (weapon === 'lmg' || weapon === 'minigun') assert.equal(event.rays.length, 2, 'existing piercing gun visuals stay unchanged');
  }
});

test('remote sniper uses the rendered barrel for its sole flight and the physical origin for every impact delay', () => {
  const event = freeze({ t: 'shot', src: 'player', remote: true, weapon: 'sniper', origin: [2, 3, 4],
    rays: [{ end: [2, 3, 14], surface: 'metal', carId: 2 }, { end: [2, 3, 84], surface: 'flesh', carId: 3 }] });
  const before = structuredClone(event), v = fxFixture();
  v.fx._shot(event, { playerMuzzle: out => { out.set(10, 3, 4); return true; } });
  assert.equal(v.tracers().length, 2);
  assert.ok(v.tracers().every(p => p.x === 10 && p.y === 3 && p.z === 4 && p.clip === Math.hypot(8, 80)));
  assert.deepEqual(v.impacts.map(i => i.delay), [10 / 620, 80 / 620]);
  assert.deepEqual(v.impacts.map(i => i.ray), event.rays);
  assert.deepEqual(event, before);
});

test('terminal selection tolerates absent local endpoint records without duplicating a shared record', () => {
  const terminal = { end: [2, 3, 24], surface: 'metal' };
  const event = freeze({ t: 'shot', src: 'player', weapon: 'sniper', origin: [2, 3, 4],
    rays: [{ end: [2, 3, 14], surface: 'metal' }, terminal, terminal, {}, null] });
  const v = fxFixture(); v.fx._shot(event, {});
  assert.equal(v.tracers().length, 2, 'choose an index, not all records sharing the terminal reference');
  assert.ok(v.tracers().every(p => p.clip === 20));
  assert.equal(v.impacts.length, 3, 'retain the existing per-record impact handling');
  for (const rays of [undefined, []]) {
    const empty = fxFixture(); empty.fx._shot({ ...event, rays }, {});
    assert.equal(empty.tracers().length, 0); assert.equal(empty.impacts.length, 0);
  }
});

test('the authored short-distance tracer suppression and terminal-end ordering remain intact', () => {
  for (const distance of [2.99, 3]) {
    const v = fxFixture(), ray = { end: [2 + distance, 3, 4], surface: 'concrete' };
    const travelled = new THREE.Vector3().fromArray(ray.end).distanceTo(new THREE.Vector3(2, 3, 4));
    v.fx._shot({ t: 'shot', src: 'player', weapon: 'sniper', origin: [2, 3, 4], rays: [ray] }, {});
    assert.equal(v.tracers().length, distance < 3 ? 0 : 2);
    assert.equal(v.impacts.length, 1); assert.equal(v.impacts[0].delay, travelled / 620);
  }
  const v = fxFixture();
  v.fx._shot({ t: 'shot', src: 'player', weapon: 'sniper', origin: [2, 3, 4],
    rays: [{ end: [2, 3, 84] }, { end: [2, 3, 14] }] }, {});
  assert.ok(v.tracers().every(p => p.clip === 10), 'terminal order is authoritative, not farthest distance');
  assert.equal(v.tracers().length, 2);
});

test('enemy projectile rays are unaffected by the player-only sniper flight selection', () => {
  const v = fxFixture(), rays = [[0, 0, 1], [.1, 0, 1]], event = freeze({ t: 'shot', src: 2,
    weapon: 'sniper', origin: [2, 3, 4], rays, speed: 120 });
  v.fx._shot(event, {});
  assert.equal(v.emitted.filter(p => p.mode === MODE.STREAK && p.life === 1.8).length, 4);
  assert.equal(v.tracers().length, 0, 'enemy flight recipe keeps its existing flags');
  assert.equal(v.fx.trackHead, 2);
  assert.deepEqual(v.fx.tracked.slice(0, 2).map(t => [t.live, t.dx, t.dy, t.dz, t.sp]),
    rays.map(ray => [true, ...ray, 120]));
  assert.equal(v.impacts.length, 0); assert.equal(v.ejections.length, 0);
});

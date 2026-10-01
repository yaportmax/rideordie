import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as Assets from '../src/core/assets.js';
import { CarView } from '../src/view/car_view.js';
import { Cockpit, WINDSHIELD_BREAK_HITS } from '../src/view/cockpit.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { Sim, DT } from '../src/sim/sim.js';

const truckIds = ['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4'];
const old = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self, createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
globalThis.Request = class extends old.Request { constructor(url, opts) { super(typeof url === 'string' && url.startsWith('/') ? 'http://windshield-test.local' + url : url, opts); } };
globalThis.fetch = async request => {
  const url = new URL(typeof request === 'string' ? request : request.url);
  if (url.origin !== 'http://windshield-test.local') return old.fetch(request);
  return new Response(readFileSync(new URL('../public' + url.pathname, import.meta.url)), { headers: { 'Content-Type': 'application/octet-stream' } });
};
try { await Assets.preload(truckIds.map(id => `/models/vehicles/${id}.glb`)); }
finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }

function fixture(id = 'truck_t1') {
  const car = new CarView(VEHICLES[id], { lod: false }), calls = { clear: 0, draw: 0 };
  const priorDocument = globalThis.document;
  // The shipped geometry, swaps and textures are real. Only Canvas2D drawing is
  // observed without needing a native browser in this CPU regression suite.
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: (_target, key) => {
    if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (key === 'clearRect') return () => calls.clear++;
    return () => calls.draw++;
  }, set: () => true }) }) };
  let cockpit;
  try { cockpit = new Cockpit(car); }
  finally { if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument; }
  return { car, cockpit, calls };
}
function snapshot(root) {
  const out = [];
  root.traverse(mesh => { if (mesh.isMesh) out.push({ mesh, geometry: mesh.geometry, material: mesh.material, indices: Array.from(mesh.geometry.index?.array || []) }); });
  return out;
}
function assertOriginal(records) {
  for (const r of records) { assert.equal(r.mesh.geometry, r.geometry); assert.equal(r.mesh.material, r.material); assert.deepEqual(Array.from(r.geometry.index?.array || []), r.indices); }
}
function frontHit(cockpit, x = 0) {
  const s = cockpit.shield;
  const p = new THREE.Vector3(x, (s.top + s.bot) / 2, (s.topZ + s.botZ) / 2 - 0.5);
  cockpit.model.updateWorldMatrix(true, false);
  const n = new THREE.Vector3(0, 0, 1).transformDirection(cockpit.model.matrixWorld);
  return { t: 'hit', enemy: true, carId: 1, pos: cockpit.model.localToWorld(p).toArray(), normal: n.toArray(), zone: 'driver_head', dmg: 1 };
}

for (const [i, id] of truckIds.entries()) test(`${id} seven front-window rounds remove only its windshield and decals, preserving all shared truck assets`, () => {
  const sibling = new CarView(VEHICLES[id], { lod: false }), blueprint = Assets.template(`/models/vehicles/${id}.glb`);
  const siblingBefore = snapshot(sibling.model), templateBefore = snapshot(blueprint), { car, cockpit, calls } = fixture(id);
  const panelBefore = snapshot(car.model).filter(r => { for (let p = r.mesh; p && p !== car.model; p = p.parent) if (/^panel_/.test(p.name)) return true; return false; });
  assert.equal(cockpit.frontGlassSwap.length, 1);
  const glass = cockpit.frontGlassSwap[0];
  assert.equal((glass.full.index.count - glass.broken.index.count) / 3, [124, 136, 136, 144][i]);
  assert.equal(glass.broken.index.count / 3, [100, 108, 108, 108][i]);
  const pos = glass.broken.attributes.position;
  for (const index of glass.broken.index.array) assert.ok(pos.getZ(index) < cockpit.wheelPos.z - 0.05, 'remaining body glass is behind the windshield');
  // Break state follows the truck even while the driver briefly uses chase view.
  assert.equal(cockpit.active, false);
  for (let hit = 0; hit < WINDSHIELD_BREAK_HITS - 1; hit++) {
    assert.equal(cockpit.onEvent(frontHit(cockpit, -.22 + hit * .08)), undefined);
    assert.equal(cockpit.windshieldBroken, false); assert.equal(glass.mesh.geometry, glass.full);
  }
  cockpit.setActive(true);
  const event = cockpit.onEvent(frontHit(cockpit, .3));
  assert.equal(event.t, 'windshieldBreak'); assert.equal(event.id, 1); assert.ok(event.pos.every(Number.isFinite));
  assert.equal(cockpit.windshieldHits, WINDSHIELD_BREAK_HITS); assert.equal(cockpit.windshieldBroken, true);
  assert.equal(glass.mesh.geometry, glass.broken); assert.equal(cockpit.crackMesh.visible, false); assert.equal(calls.clear, 1);
  for (const decal of cockpit.decalSwap) assert.equal(decal.mesh.geometry, decal.broken);
  const afterBreakDraws = calls.draw;
  for (let hit = 0; hit < 20; hit++) assert.equal(cockpit.onEvent(frontHit(cockpit)), undefined);
  cockpit.crashCrack(); cockpit.bulletHole(); cockpit._dust();
  assert.equal(calls.draw, afterBreakDraws); assert.equal(cockpit.windshieldHits, WINDSHIELD_BREAK_HITS);
  cockpit.setActive(false); cockpit.setActive(true);
  assert.equal(glass.mesh.geometry, glass.broken); assert.equal(cockpit.crackMesh.visible, false);
  for (const decal of cockpit.decalSwap) assert.equal(decal.mesh.geometry, decal.broken);
  assertOriginal(panelBefore); assertOriginal(siblingBefore); assertOriginal(templateBefore);

  const owned = [...cockpit.frontGlassSwap.map(d => d.broken), ...cockpit.decalSwap.flatMap(d => [d.cut, d.broken].filter(g => g !== d.full)), ...cockpit.glass];
  const ownedDisposes = new Map(owned.map(resource => [resource, 0]));
  for (const resource of ownedDisposes.keys()) resource.addEventListener('dispose', () => ownedDisposes.set(resource, ownedDisposes.get(resource) + 1));
  const shared = new Set(templateBefore.flatMap(r => [r.geometry, ...[].concat(r.material)])); let sharedDisposes = 0;
  const onSharedDispose = () => sharedDisposes++;
  for (const resource of shared) resource.addEventListener('dispose', onSharedDispose);
  cockpit.dispose(); cockpit.dispose();
  assert.equal(glass.mesh.geometry, glass.full); assert.equal(sharedDisposes, 0);
  for (const count of ownedDisposes.values()) assert.equal(count, 1, 'each owned windshield allocation freed exactly once');
  for (const resource of shared) resource.removeEventListener('dispose', onSharedDispose);
  assertOriginal(siblingBefore); assertOriginal(templateBefore);
  const fresh = fixture(id);
  assert.equal(fresh.cockpit.windshieldHits, 0); assert.equal(fresh.cockpit.windshieldBroken, false);
  assert.equal(fresh.cockpit.frontGlassSwap[0].mesh.geometry, fresh.cockpit.frontGlassSwap[0].full);
  assert.equal(fresh.cockpit.crackMesh.visible, true); fresh.cockpit.dispose();
});

test('side/rear rounds, hood hits, blasts and malformed events never add fake front-window holes', () => {
  const { car, cockpit } = fixture();
  car.root.position.set(20, 4, -8); car.root.rotation.set(.1, .8, -.2); car.root.updateMatrixWorld(true);
  const good = frontHit(cockpit, .15);
  assert.equal(cockpit._windowImpact(good), true);
  const nRear = new THREE.Vector3(0, 0, -1).transformDirection(cockpit.model.matrixWorld).toArray();
  const nSide = new THREE.Vector3(1, 0, 0).transformDirection(cockpit.model.matrixWorld).toArray();
  const low = cockpit.model.localToWorld(new THREE.Vector3(.1, cockpit.shield.bot - .2, cockpit.shield.botZ - .5)).toArray();
  const farSide = cockpit.model.localToWorld(new THREE.Vector3(cockpit.shield.hw + .4, (cockpit.shield.top + cockpit.shield.bot) / 2, cockpit.shield.botZ - .5)).toArray();
  for (const event of [
    { ...good, normal: nRear }, { ...good, normal: nSide }, { ...good, pos: low }, { ...good, pos: farSide },
    { ...good, enemy: false }, { ...good, carId: 2 }, { ...good, normal: null }, { ...good, pos: [NaN, 1, 1] },
    { t: 'crewHit', id: 1, role: 'driver', point: good.pos }, { t: 'boom', pos: good.pos, radius: 10 },
  ]) assert.equal(cockpit.onEvent(event), undefined);
  assert.equal(cockpit.windshieldHits, 0);
  cockpit.onEvent(good); assert.equal(cockpit.windshieldHits, 1);
  assert.ok(Math.abs(cockpit.impactU - (cockpit.shield.hw - .15) / (2 * cockpit.shield.hw)) < 1e-6);
  assert.ok(Math.abs(cockpit.impactV - .5) < 1e-6);
  cockpit.dispose();
});

test('real Rapier/projectile enemy rounds cross the glass, retain crew damage and shatter exactly once', async () => {
  const sim = await new Sim({ seed: 7 }).init(), { car, cockpit } = fixture();
  try {
    sim.director.enabled = false;
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 40 });
    sim.world.step(sim.eventQueue); player.veh.afterStep(); sim.start(); sim.drainEvents();
    car.root.position.copy(player.veh.pos).add(new THREE.Vector3(0, -player.veh.restComHeight, 0).applyQuaternion(player.veh.quat));
    car.root.quaternion.copy(player.veh.quat); car.root.updateMatrixWorld(true);
    const driverHp = player.crew.driver.hp; let breakEvents = 0;
    for (let i = 0; i < WINDSHIELD_BREAK_HITS; i++) {
      const o = new THREE.Vector3(player.spec.seats.driver[0] + (i - 3) * .02, player.spec.seats.driver[1] + .76, cockpit.shield.botZ + 2);
      car.model.localToWorld(o);
      const dir = new THREE.Vector3(0, 0, -1).transformDirection(car.model.matrixWorld);
      sim.projectiles.addBullet(o, dir, 620, .05, 99, 'mg');
      sim.projectiles.update(DT, sim);
      const events = sim.drainEvents(), hits = events.filter(e => e.t === 'hit');
      assert.equal(hits.length, 1, 'each injected round must go through actual projectile collision');
      assert.equal(hits[0].zone, 'driver_head'); assert.ok(hits[0].dmg > 0);
      for (const e of events) if (cockpit.onEvent(e)?.t === 'windshieldBreak') breakEvents++;
      assert.equal(cockpit.windshieldHits, i + 1);
    }
    assert.equal(breakEvents, 1); assert.equal(cockpit.windshieldBroken, true);
    assert.ok(player.crew.driver.hp < driverHp, 'window visual change must not grant immunity');
    assert.equal(player.crew.driver.alive, true); assert.equal(sim.projectiles.bullets.length, 0);
  } finally { cockpit.dispose(); sim.dispose(); }
});

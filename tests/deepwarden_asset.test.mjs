// Source-authored and UNRUN. Root must generate/inspect the actual WORK GLB,
// overlay this proposal into an isolated execution candidate, then run serially.
// Image decode stubs below prove geometry/loader contracts, never native pixels.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as Assets from '../src/core/assets.js';
import { VEHICLES, vehicleModelURLs, vehicleModelURL, rideInfo } from '../src/data/vehicles.js';
import { ELITE_VEHICLE_PROTOCOL, DEEPWARDEN_ELITE, resolveEliteVehicle, eliteVehicleKey, validateDeepwardenInfo } from '../src/data/elite_vehicles.js';
import INFO from '../src/data/deepwarden_model_info.json' with { type: 'json' };
import { CarView } from '../src/view/car_view.js';
import { buildEliteKit } from '../src/view/elite_kits.js';
import { WorldView } from '../src/game/world_view.js';
import { makeCarState, stateFromCar } from '../src/view/car_state.js';
import { Car, GhostCar } from '../src/sim/car.js';
import { Sim } from '../src/sim/sim.js';
import { initPhysics, addStaticBox, createWorld, RAPIER, RAY_WORLD } from '../src/sim/physics.js';
import { Vehicle } from '../src/sim/vehicle.js';
import { ELITE_BOSSES, CAMPAIGN_BOSSES } from '../src/data/boss.js';
import { TEN_LEVELS, CAMPAIGN_PROTOCOL } from '../src/data/campaign.js';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../src/net/snapshot.js';
import { Session } from '../src/net/session.js';
import { NET_PROTOCOL } from '../src/net/run_packet.js';
import { GARAGE_SEAT_PROTOCOL } from '../src/net/garage_seats.js';
import { PLAYER_VEHICLE_PROTOCOL } from '../src/data/vehicle_families.js';
import { DRIVING_ROUTE_VERSION } from '../src/world/driving_plan.js';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { normalizeProfile } from '../src/meta/profile.js';

const URL = '/models/vehicles/boss_deepwarden.glb';
const S = resolveEliteVehicle(VEHICLES.e_heavy, DEEPWARDEN_ELITE);
const near = (a, b, label, e = 2e-4) => assert.ok(Math.abs(a - b) <= e, `${label}: ${a} != ${b}`);
const vector = (a, b, label, e) => a.forEach((v, i) => near(v, b[i], label + '/' + i, e));
const meshes = root => { const out = []; root.traverse(o => { if (o.isMesh) out.push(o); }); return out; };

test('dedicated geometry resolves only the correct existing wire identity and never mutates ordinary bosses', () => {
  const before = structuredClone(VEHICLES.e_heavy);
  assert.equal(S.id, 'e_heavy'); assert.equal(S.modelId, 'boss_deepwarden');
  assert.equal(resolveEliteVehicle(VEHICLES.e_heavy, 7), S, 'bounded cache does not allocate per-frame variants');
  for (const elite of [0, 1, 2, 3, 4, 5, 6, 8, 9]) assert.equal(resolveEliteVehicle(VEHICLES.e_heavy, elite), VEHICLES.e_heavy);
  assert.throws(() => resolveEliteVehicle(VEHICLES.e_sedan, 7));
  assert.equal(Object.values(VEHICLES).some(spec => spec.id === 'boss_deepwarden'), false, 'no catalogue/wire renumbering');
  assert.equal(vehicleModelURL(S), URL); assert.equal(vehicleModelURLs().filter(u => u === URL).length, 1);
  assert.equal(S.gunners, 1); assert.deepEqual(Object.keys(S.seats), ['driver', 'gunner']);
  assert.notEqual(S.wheels, VEHICLES.e_heavy.wheels); assert.notEqual(S.engine, VEHICLES.e_heavy.engine);
  assert.equal(Object.isFrozen(S.wheels), true); assert.equal(Object.isFrozen(VEHICLES.e_heavy.wheels), false);
  assert.notEqual(S.drift, VEHICLES.e_heavy.drift); assert.equal(Object.isFrozen(VEHICLES.e_heavy.drift), false);
  assert.deepEqual(VEHICLES.e_heavy, before);
  assert.equal(ELITE_BOSSES[6].look.kit, 'deepwarden'); assert.equal(CAMPAIGN_BOSSES[6].eliteIndex, 6);
});

test('extraction rejects missing crew/rotors, bad hulls and inadequate standing headroom', () => {
  assert.equal(validateDeepwardenInfo(INFO), INFO);
  for (const change of [i => delete i.groups.drill_R, i => delete i.sockets.seat_gunner,
    i => { i.colliders[0].half[2] = -1; }, i => { i.spawnClearance = i.bbox.max[1]; },
    i => { i.encodedElite = 6; }, i => { i.crewModels.gunner = 'raider_a'; }]) {
    const malformed = structuredClone(INFO); change(malformed); assert.throws(() => validateDeepwardenInfo(malformed));
  }
});

async function loadActualAsset() {
  const previous = Object.fromEntries(['fetch', 'Request', 'self', 'createImageBitmap', 'ProgressEvent'].map(k => [k, globalThis[k]]));
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
  globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
  globalThis.Request = class extends previous.Request {
    constructor(url, options) { super(typeof url === 'string' && url.startsWith('/') ? 'http://deepwarden-test.local' + url : url, options); }
  };
  globalThis.fetch = async request => {
    const url = new globalThis.URL(typeof request === 'string' ? request : request.url);
    if (url.origin !== 'http://deepwarden-test.local') return previous.fetch(request);
    return new Response(readFileSync(new globalThis.URL('../public' + url.pathname, import.meta.url)), { headers: { 'Content-Type': 'application/octet-stream' } });
  };
  try { await Assets.preload([URL, '/models/vehicles/e_heavy.glb', '/models/characters/raider_driver2.glb', '/models/characters/raider_c2.glb', '/models/weapons/lmg.glb']); }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
  assert.equal(Assets.has(URL), true, 'real candidate GLB is required, no procedural fallback');
}

test('a missing standalone clone fails explicitly before a placeholder can stand in for new art', () => {
  assert.throws(() => new CarView({ ...S, modelId: 'boss_deepwarden_missing' }), /Required standalone boss model is missing/);
});

test('actual loader preserves independent cutters, wheel pivots, sockets, detachment and bounded geometry', async () => {
  await loadActualAsset();
  const view = new CarView(S, { shadowProxy: true, lod: false });
  try {
    assert.equal(view.usesModel, true);
    const bb = new THREE.Box3().setFromObject(view.model, true);
    vector(bb.min.toArray(), INFO.bbox.min, 'GLB bbox min'); vector(bb.max.toArray(), INFO.bbox.max, 'GLB bbox max');
    for (const name of INFO.requiredNodes) assert.ok(view.model.getObjectByName(name), name + ' survives production loader');
    assert.deepEqual([...view.wheelNodes.keys()].sort(), S.wheels.map(w => w.name).sort());
    for (const w of S.wheels) {
      const node = view.wheelNodes.get(w.name), extracted = INFO.wheels[w.name];
      vector(node.getWorldPosition(new THREE.Vector3()).toArray(), [extracted.x, extracted.y, extracted.z], w.name + ' actual pivot');
      near(w.x, extracted.x, 'physical axle x'); near(w.z, extracted.z, 'physical axle z');
      const bounds = new THREE.Box3().setFromObject(node, true);
      near((bounds.max.y - bounds.min.y) / 2, S.wheelRadius, w.name + ' radius');
    }
    for (const panel of ['door_L', 'door_R', 'trunk', 'fender_L', 'fender_R', 'bumper_R']) assert.ok(view.panels.has(panel), 'real panel ' + panel);
    for (const name of ['drill_L', 'drill_R']) {
      const node = view.model.getObjectByName(name), bounds = new THREE.Box3().setFromObject(node, true), hull = S.colliders[name === 'drill_L' ? 3 : 4];
      vector(node.getWorldPosition(new THREE.Vector3()).toArray(), INFO.groups[name].pivot, name + ' model pivot');
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(bounds.min.getComponent(axis) >= hull.center[axis] - hull.half[axis] - .002, name + ' has no phantom reach minimum');
        assert.ok(bounds.max.getComponent(axis) <= hull.center[axis] + hull.half[axis] + .002, name + ' has no phantom reach maximum');
      }
    }
    assert.ok(INFO.bbox.max[1] < VEHICLES.e_heavy.model.bbox.max[1] - 1.5, 'actual silhouette is substantially lower than Priest base');
    const nearMeshes = meshes(view.model), heavyView = new CarView(VEHICLES.e_heavy, { lod: false });
    try {
      const draws = objects => objects.reduce((n, mesh) => n + (Array.isArray(mesh.material) ? mesh.geometry.groups.length || mesh.material.length : 1), 0);
      assert.ok(draws(nearMeshes) <= draws(meshes(heavyView.model)), 'new art cannot exceed actual baseline near material draws without measured exception');
    } finally { heavyView.dispose(); }
    for (const mesh of nearMeshes) for (const attribute of Object.values(mesh.geometry.attributes))
      for (let i = 0; i < attribute.count; i++) for (let a = 0; a < attribute.itemSize; a++) assert.ok(Number.isFinite(attribute.getComponent(i, a)));
  } finally { view.dispose(); }
});

function triangleFixture(view) {
  view.root.updateMatrixWorld(true);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), probes = [];
  for (const source of meshes(view.model)) {
    if ([].concat(source.material).every(m => m.transparent)) continue;
    const mesh = new THREE.Mesh(source.geometry, material);
    mesh.matrixAutoUpdate = false; mesh.matrix.copy(source.matrixWorld); mesh.updateMatrixWorld(true); probes.push(mesh);
  }
  const ray = new THREE.Raycaster();
  return { material, probes,
    hits(point, direction, max) { ray.set(new THREE.Vector3(...point), new THREE.Vector3(...direction)); ray.near = .001; ray.far = max; return ray.intersectObjects(probes, false); },
    dispose() { material.dispose(); },
  };
}

test('actual floor/head/muzzle paths and exposed drive survive triangle tests plus an obstruction negative control', async () => {
  await loadActualAsset(); const view = new CarView(S, { lod: false }), triangles = triangleFixture(view);
  try {
    const seat = S.seats.gunner, y = seat[1] + 1.62;
    const floor = triangles.hits([seat[0], seat[1] + .12, seat[2]], [0, -1, 0], .3)[0];
    assert.ok(floor); near(floor.point.y, seat[1], 'real gunner support', .012);
    for (const dx of [-.20, 0, .20]) for (const dz of [-.20, 0, .20])
      assert.equal(triangles.hits([seat[0] + dx, y, seat[2] + dz], [0, 1, 0], 1).length, 0, 'real open headroom');
    for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 12)
      assert.equal(triangles.hits([seat[0], seat[1] + 1.35, seat[2]], [Math.sin(yaw), 0, Math.cos(yaw)], 6).length, 0, 'HMG firing fan clears body at actual muzzle height');
    const opening = S.model.sockets.drill_drive;
    for (const x of [-.18, 0, .18]) for (const dy of [-.15, 0, .15]) {
      const hit = triangles.hits([x, opening[1] + dy, opening[2] + 2], [0, 0, -1], 2.3)[0];
      assert.ok(hit, 'drive is visible physical geometry');
      assert.ok(Math.abs(hit.point.z - opening[2]) < .045, 'no cutter or wall blocks the drive face');
    }
    const accidentalSeal = new THREE.Mesh(new THREE.BoxGeometry(.75, .6, .06), triangles.material);
    accidentalSeal.position.set(0, opening[1], opening[2] + .4); accidentalSeal.updateMatrixWorld(true); triangles.probes.push(accidentalSeal);
    try { assert.ok(triangles.hits([0, opening[1], opening[2] + 2], [0, 0, -1], 2)[0].point.z > opening[2] + .2, 'same test catches an opaque plate sealing target'); }
    finally { triangles.probes.pop(); accidentalSeal.geometry.dispose(); }
  } finally { triangles.dispose(); view.dispose(); }
});

test('rotating real cutter vertices stay inside actual rounded/truncated Rapier hulls, including a reach negative control', async () => {
  await loadActualAsset(); await initPhysics();
  const world = createWorld(1 / 120), vehicle = new Vehicle(world, S), view = new CarView(S, { lod: false });
  try {
    for (const name of ['drill_L', 'drill_R']) {
      const rotor = view.model.getObjectByName(name);
      // Sample the full circle in both directions. This is discrete vertex
      // coverage, not a proof of every continuous angle or driving terrain.
      for (const angle of Array.from({ length: 49 }, (_, i) => (i - 24) * Math.PI / 12)) {
        rotor.rotation.z = angle; view.root.updateMatrixWorld(true);
        for (const mesh of meshes(rotor)) {
          const attr = mesh.geometry.attributes.position;
          for (let i = 0; i < attr.count; i++) {
            const p = new THREE.Vector3().fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
            p.y -= vehicle.restComHeight; p.applyQuaternion(vehicle.quat).add(vehicle.pos);
            assert.ok(vehicle.colliders.some(collider => collider.containsPoint(p)), `${name} angle${angle} vertex${i} is inside an actual contact shape`);
          }
        }
      }
    }
    const beyond = new THREE.Vector3(.90, 1.16 - vehicle.restComHeight, 4.90).applyQuaternion(vehicle.quat).add(vehicle.pos);
    assert.equal(vehicle.colliders.some(collider => collider.containsPoint(beyond)), false, 'real shapes reject an oversized cosmetic drill extension');
  } finally { view.dispose(); vehicle.destroy(); world.free(); }
});

function entityFixture() {
  const events = [], ride = rideInfo(S), sim = Object.assign(Object.create(Sim.prototype), { time: 12, stats: {}, emit: e => events.push(e) });
  const veh = { pos: new THREE.Vector3(12, 7 + ride.restComHeight, -9), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(.06, .48, -.04, 'YXZ')),
    restComHeight: ride.restComHeight, vel: new THREE.Vector3(), input: {}, driverAlive: true, engineDamage: 0,
    wheels: S.wheels.map(() => ({ flat: false, grip: 1, L: ride.restLen, slip: 0, grounded: true })), lerpPose(alpha, p, q) { p.copy(this.pos); q.copy(this.quat); } };
  const car = new Car(sim, 19, S, veh, 'enemy'); car.elite = { index: 6 }; car.fuelHp = car.engineHp = 1e9;
  const state = makeCarState(car.id, 'e_heavy', 'enemy', 7); stateFromCar(car, 1, state);
  const ghost = new GhostCar(state); ghost.sync(state);
  const point = p => new THREE.Vector3(p[0], p[1] - ride.restComHeight, p[2]).applyQuaternion(veh.quat).add(veh.pos);
  const cast = (target, p) => target.raycast(point(p), new THREE.Vector3(0, 0, -1).applyQuaternion(veh.quat), 4);
  return { car, ghost, state, sim, events, cast };
}

test('local state and real Car/Ghost target the same exposed engine and exactly one gunner', () => {
  const { car, ghost, state, sim, cast } = entityFixture();
  assert.equal(state.nWheels, 6); assert.equal(eliteVehicleKey(state.spec), eliteVehicleKey(ghost.spec));
  assert.equal(car.crewAlive(), 2); assert.deepEqual(Object.keys(ghost.crew), ['driver', 'gunner']);
  const opening = INFO.sockets.drill_drive;
  for (const x of [-.18, 0, .18]) {
    const p = [x, opening[1], opening[2] + 2], actual = cast(car, p), remote = cast(ghost, p);
    assert.equal(actual?.zone.kind, 'engine'); assert.equal(remote?.zone.kind, 'engine');
    near(actual.t, remote.t, 'Car/Ghost opening hit');
  }
  const before = car.engineHp;
  sim.damageZone(car, cast(car, [0, opening[1], opening[2] + 2]), 180, { src: 1, cause: 'shot' });
  assert.ok(before - car.engineHp >= 90, 'existing accepted damage path supplies a genuine subsystem delta for wind-up jam');
});

function packet(time, elite = 7, x = 0, mutate = null) {
  const spec = resolveEliteVehicle(VEHICLES.e_heavy, elite), car = entityFixture().car;
  car.spec = spec; car.elite = elite ? { index: elite - 1 } : null;
  car.veh.pos.set(x, rideInfo(spec).restComHeight, 0); car.veh.quat.identity(); car.veh.angvel = new THREE.Vector3();
  car.veh.wheels = spec.wheels.map(() => ({ L: .4, slip: 0, grounded: true })); car.veh.rpm01 = .5; car.veh.brakeApplied = 0;
  car.crew = { driver: { alive: true }, gunner: { alive: true, aimYaw: .3, aimPitch: .1, fire: false } }; car.gunName = 'hmg';
  mutate?.(car);
  return encodeSnapshot({ cars: new Map([[car.id, car]]), time, state: 'run', projectiles: { rockets: [], grenades: [] }, boss: null }, Math.round(time * 120), { dist: 40, hp01: 1 });
}

test('real snapshot decode/materialization selects complete boss geometry and holds prior identity until pose cut', () => {
  const b = new SnapshotBuffer(); assert.ok(b.push(decodeSnapshot(packet(1, 0)), 10));
  b.clockOffset = 9; b.delay = 0; b.sample(10); const old = b.states.get(19);
  b.push(decodeSnapshot(packet(1 + 1 / 30, 7, 1)), 10 + 1 / 30); b.clockOffset = 9; b.delay = 0;
  b.sample(10 + 1 / 60);
  assert.equal(b.states.get(19), old); assert.equal(old.elite, 0); assert.notEqual(old.spec.modelId, 'boss_deepwarden');
  b.sample(10 + 1 / 30);
  const next = b.states.get(19); assert.notEqual(next, old); assert.equal(next.elite, 7); assert.equal(next.spec.modelId, 'boss_deepwarden');
  assert.equal(next.nWheels, 6); assert.deepEqual(next.spec.seats, S.seats); assert.deepEqual(new GhostCar(next).zones, new GhostCar(makeCarState(19, 'e_heavy', 'enemy', 7)).zones);
  const bad = packet(2), dv = new DataView(bad); dv.setUint8(37, 0); // Existing kind byte: Deepwarden can only be enemy.
  assert.equal(decodeSnapshot(bad), null);
  assert.equal(packet(2, 7, 0, c => { c.spec = VEHICLES.e_heavy; }), null, 'host cannot label the old physical Hauler as standalone Deepwarden');
  assert.equal(packet(2, 7, 0, c => { c.veh.wheels.pop(); }), null, 'host wheel contract must agree before encoding');
  assert.equal(packet(2, 7, 0, c => { c.crew.gunner2 = { alive: true }; }), null, 'host cannot attach an unmodelled second crew');
});

test('real WorldView recreates same-ID heavy geometry/crew on effective identity change and disposes the old view', async () => {
  await loadActualAsset();
  assert.equal(Assets.has('/models/characters/raider_driver2.glb'), true);
  assert.equal(Assets.has('/models/characters/raider_c2.glb'), true);
  const scene = new THREE.Scene(), world = new WorldView({ scene });
  try {
    const normal = makeCarState(19, 'e_heavy', 'enemy', 0), old = world.ensure(normal);
    const next = makeCarState(19, 'e_heavy', 'enemy', 7); next.gunName = 'hmg'; next.gunNames.gunner = 'hmg';
    const replacement = world.ensure(next);
    assert.notEqual(replacement, old); assert.equal(old.view.disposed, true); assert.equal(old.view.root.parent, null);
    assert.equal(world.cars.size, 1); assert.equal(world.loose.length, 0); assert.equal(world.viewMap.get(19), replacement.view);
    assert.equal(replacement.view.spec.modelId, 'boss_deepwarden'); assert.deepEqual(Object.keys(replacement.crew), ['driver', 'gunner']);
    assert.equal(replacement.crew.driver.kind, 'raider_driver2'); assert.equal(replacement.crew.gunner.kind, 'raider_c2');
    assert.equal(replacement.crew.driver.rigged, true); assert.equal(replacement.crew.gunner.rigged, true);
    assert.equal(world.ensure(next), replacement, 'stable identity reuses its bounded view/crew');
  } finally { world.dispose(); assert.equal(scene.children.length, 0); }
});

test('root-managed loaded-ground fixture rejects missing terrain, crew-height ceiling and occupied real tractor hull', async () => {
  await initPhysics(); const sim = await new Sim({ seed: 7, journey: { version: 1, mode: 'campaign', level: 7 } }).init();
  try {
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 40 }); sim.start();
    const at = { s: player.s + 200, d: 0, speed: 12 }, M = ELITE_BOSSES[6];
    const sm = sim.road.sample(at.s);
    addStaticBox(sim.world, [sm.x, sm.y - 1, sm.z], [50, 1, 100]);
    // Real supporting plane and real ray height. This remains a bounded flat
    // fixture, not authored Underground terrain or full suspension gameplay.
    sim.world.step(sim.eventQueue);
    sim.ground = { hasColliderAt: () => true, roadHeightAt: (s, x, z, hint) => {
      const ray = new RAPIER.Ray({ x, y: hint, z }, { x: 0, y: -1, z: 0 });
      const hit = sim.world.castRay(ray, 80, true, undefined, RAY_WORLD);
      return hit ? hint - hit.timeOfImpact : null;
    } };
    const options = { at, elite: { ...M, index: 6 }, behavior: M.behavior, pattern: { ...M.pattern } };
    const spawn = () => sim.director.spawn(sim, 'e_heavy', .5, options);
    sim.ground.hasColliderAt = () => false; assert.equal(spawn(), false); sim.ground.hasColliderAt = () => true;
    const ceiling = addStaticBox(sim.world, [sm.x, sm.y + S.seats.gunner[1] + 1.70, sm.z], [3, .1, 7]);
    sim.world.step(sim.eventQueue); assert.equal(spawn(), false, 'standing gunner overhead included despite low cab'); sim.world.removeRigidBody(ceiling.rb);
    const obstruction = sim.spawnCar('e_heavy', { s: at.s, d: 0 }); sim.world.step(sim.eventQueue); obstruction.veh.afterStep();
    const before = sim.cars.size; assert.equal(spawn(), false); assert.equal(sim.cars.size, before, 'rejected tractor body is cleaned');
    sim.removeCar(obstruction, 'controlled obstruction cleanup'); sim.world.step(sim.eventQueue);
    const car = spawn(); assert.ok(car); assert.equal(car.spec.modelId, 'boss_deepwarden');
    assert.equal(car.spec.wheels.length, 6); assert.equal(car.veh.colliders.length, S.colliders.length); assert.equal(car.crewAlive(), 2);
    player.s = TEN_LEVELS[6].bossDistance - 1; sim.director._bosses(sim, player, .5); assert.equal(sim.director.activeElite, undefined);
  } finally { sim.dispose(); }
});

class MemoryTransport {
  constructor() { this.sent = []; this.closedConnections = 0; }
  async host() { return 'ABCDE'; } async join() {}
  send(m) { this.sent.push(structuredClone(m)); return true; }
  closeConnection() { this.closedConnections++; this.onClose?.(); }
  destroy() {} sendFast() { return true; }
}
const hello = eliteVehicles => ({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL,
  familyVehicles: PLAYER_VEHICLE_PROTOCOL, eliteVehicles, drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL,
  name: 'Guest', wallet: { playerId: 'guest', cash: 1234, totalCash: 1234 } });
test('mandatory geometry capability rejects absent/old/new/malformed peers before readiness and preserves matching hello', async () => {
  for (const isHost of [true, false]) for (const value of [undefined, 0, 2, '1', null, NaN]) {
    const tp = new MemoryTransport(), session = new Session(tp), profile = normalizeProfile(DEFAULT_PROFILE());
    if (isHost) await session.host(profile); else await session.join('ABCDE', profile);
    tp.onOpen(); const before = structuredClone(profile);
    session._onMsg({ t: 'lobby', host: { name: 'Premature peer', role: 'driver', ready: true }, guest: { role: 'gunner', ready: true } });
    assert.equal(session.other, null, 'pre-hello JSON does not mutate peer/readiness');
    session._onMsg(hello(value));
    assert.equal(session.connected, false); assert.equal(session.peerWallet, null); assert.equal(session.canStart(), false);
    assert.equal(tp.closedConnections, 1); assert.deepEqual(profile, before); assert.equal(session.protocolError.type, 'protocol-mismatch');
  }
  for (const isHost of [true, false]) {
    const tp = new MemoryTransport(), session = new Session(tp), profile = normalizeProfile(DEFAULT_PROFILE());
    if (isHost) await session.host(profile); else await session.join('ABCDE', profile);
    tp.onOpen(); assert.equal(tp.sent.find(m => m.t === 'hello').eliteVehicles, ELITE_VEHICLE_PROTOCOL);
    session._onMsg(hello(ELITE_VEHICLE_PROTOCOL)); assert.equal(session.connected, true); assert.equal(tp.closedConnections, 0);
  }
});

test('dedicated cutter controller animates model Z pivots, keeps weak geometry scale fixed and releases only its nameplate', async () => {
  await loadActualAsset();
  const previous = globalThis.document, context = new Proxy({ measureText: () => ({ width: 180 }) }, { get(target, name) { return name in target ? target[name] : () => {}; } });
  globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
  const view = new CarView(S);
  try {
    const kit = buildEliteKit(view, S, 7, 19), left = view.model.getObjectByName('drill_L'), right = view.model.getObjectByName('drill_R'), weak = view.model.getObjectByName('weak_drill_drive');
    const authored = ELITE_BOSSES[6].look;
    assert.ok(view.paintMats.length > 0, 'real loaded paint materials required');
    for (const material of view.paintMats) {
      const color = new THREE.Color(material.name === 'paint2' ? authored.paint2 : authored.paint);
      vector(material.color.toArray(), color.toArray(), 'industrial palette survives dedicated controller');
    }
    assert.ok(view.lod && view.lodMat, 'actual template creates the dedicated far LOD');
    vector(view.lodMat.userData.uPaint.value.toArray(), new THREE.Color(authored.paint).toArray(), 'LOD industrial paint');
    vector(view.lodMat.userData.uPaint2.value.toArray(), new THREE.Color(authored.paint2).toArray(), 'LOD dark hardware');
    const ly = left.rotation.y, ry = right.rotation.y, scale = weak.scale.clone();
    let disposed = 0; meshes(view.model).forEach(m => m.geometry.addEventListener('dispose', () => disposed++));
    kit.update(.1, { intent: 'ram', hp01: .8, hitFlash: .1 });
    assert.ok(left.rotation.z > 0 && right.rotation.z < 0); assert.equal(left.rotation.y, ly); assert.equal(right.rotation.y, ry); assert.deepEqual(weak.scale, scale);
    assert.equal(view.root.getObjectByName('elite_kit'), undefined, 'no Priest primitives or second replacement shell');
    kit.dispose(); assert.equal(disposed, 0, 'kit never owns shared GLB geometry');
  } finally { view.dispose(); if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as Assets from '../src/core/assets.js';
import { CarView } from '../src/view/car_view.js';
import { Car, GhostCar } from '../src/sim/car.js';
import { Sim } from '../src/sim/sim.js';
import { Vehicle } from '../src/sim/vehicle.js';
import { initPhysics, createWorld, addStaticBox } from '../src/sim/physics.js';
import { rideInfo } from '../src/data/vehicles.js';
import { CITY_BUS_ID, CITY_BUS_MODEL_URL, CITY_DOUBLE_BUS, CITY_BUS_ENCOUNTER, createCityDoubleBusSpec } from '../src/data/city_bus.js';

// Keep the actual shipped GLB, production loader/rigid merge and CarView.
// Only browser image decoding is replaced; this establishes CPU geometry and
// simulation contracts, not texture quality, animated crew fit or frame timing.
const previous = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self,
  createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
globalThis.Request = class extends previous.Request {
  constructor(url, options) { super(typeof url === 'string' && url.startsWith('/') ? 'http://city-bus-test.local' + url : url, options); }
};
globalThis.fetch = async request => {
  const url = new URL(typeof request === 'string' ? request : request.url);
  if (url.origin !== 'http://city-bus-test.local') return previous.fetch(request);
  return new Response(readFileSync(new URL('../public' + url.pathname, import.meta.url)), { headers: { 'Content-Type': 'application/octet-stream' } });
};
try { await Assets.preload([CITY_BUS_MODEL_URL]); }
finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
}

const near = (actual, expected, label, epsilon = 1e-4) => assert.ok(Math.abs(actual - expected) <= epsilon,
  `${label}: ${actual} differs from ${expected}`);
const nearVector = (actual, expected, label) => actual.forEach((value, index) => near(value, expected[index], `${label}[${index}]`));
function descendants(root) { const result = []; root.traverse(node => { if (node.isMesh) result.push(node); }); return result; }
function below(node, predicate) { for (let parent = node; parent; parent = parent.parent) if (predicate(parent)) return true; return false; }
const moving = node => below(node, parent => /^wheel_[A-Za-z0-9]+$/.test(parent.name) || parent.name === 'steering_wheel');
function groundPosition(view, node) {
  return node.getWorldPosition(new THREE.Vector3()).applyMatrix4(view.root.matrixWorld.clone().invert()).toArray();
}
function materialDraws(mesh) {
  if (!Array.isArray(mesh.material)) return mesh.material.visible === false ? 0 : 1;
  return mesh.geometry.groups.filter(group => group.count > 0 && mesh.material[group.materialIndex]?.visible !== false).length;
}
function assertFiniteAttribute(attribute, label) {
  const getters = ['getX', 'getY', 'getZ', 'getW'];
  assert.ok(Number.isInteger(attribute.count) && attribute.count >= 0, `${label}: valid accessor count`);
  assert.ok(Number.isInteger(attribute.itemSize) && attribute.itemSize >= 1 && attribute.itemSize <= getters.length,
    `${label}: supported scalar/vector accessor size`);
  // InterleavedBufferAttribute.array exposes the entire typed stride, not
  // just this accessor. Packed color/normal bytes and padding in that stride
  // can appear nonfinite when reinterpreted as floats. These getters honour
  // the declared offset, stride, count and normalization for actual values.
  for (let vertex = 0; vertex < attribute.count; vertex++) for (let component = 0; component < attribute.itemSize; component++) {
    const getter = getters[component], value = attribute[getter](vertex);
    if (!Number.isFinite(value)) assert.fail(`${label}: vertex ${vertex} ${getter} is nonfinite (${value})`);
  }
}

test('finite attribute checks ignore interleaved padding and still reject an actual nonfinite component', () => {
  const storage = new THREE.InterleavedBuffer(new Float32Array([1, 2, 3, NaN, 4, 5, 6, NaN]), 4);
  const position = new THREE.InterleavedBufferAttribute(storage, 3, 0);
  assert.equal(position.array.every(Number.isFinite), false, 'whole-stride float inspection reproduces the false rejection');
  assert.doesNotThrow(() => assertFiniteAttribute(position, 'interleaved position'));
  position.setZ(1, NaN);
  assert.throws(() => assertFiniteAttribute(position, 'interleaved position'), /vertex 1 getZ is nonfinite/,
    'a nonfinite declared component remains a strict failure');
  const plain = new THREE.BufferAttribute(new Float32Array([1, Infinity]), 2);
  assert.throws(() => assertFiniteAttribute(plain, 'plain UV'), /vertex 0 getY is nonfinite/,
    'non-interleaved declared components use the same strict check');
});

test('shipped city bus retains its distinct dimensions, four wheel pivots, crew sockets and bounded merged body', () => {
  const spec = createCityDoubleBusSpec(), view = new CarView(spec, { lod: false });
  try {
    assert.equal(spec.id, CITY_BUS_ID); assert.equal(spec.modelId, CITY_BUS_ID);
    assert.equal(CITY_BUS_MODEL_URL, '/models/vehicles/e_double_bus.glb');
    assert.equal(view.usesModel, true, 'never silently validate the procedural placeholder');
    assert.equal(view.lod, null, 'count the full production-merged model');
    view.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(view.model, true);
    nearVector(bounds.min.toArray(), spec.model.bbox.min, 'actual model minimum');
    nearVector(bounds.max.toArray(), spec.model.bbox.max, 'actual model maximum');
    near(spec.length, bounds.max.z - bounds.min.z, 'length');
    near(spec.width, bounds.max.x - bounds.min.x, 'mirror-inclusive width');
    near(spec.height, bounds.max.y, 'height');
    assert.ok(spec.length > 9 && spec.length < 10 && spec.height > 4 && spec.height < 4.5,
      'a two-deck bus silhouette must survive export, not become a pickup alias');
    assert.ok(bounds.min.y >= -.01 && bounds.min.y <= .01, 'metres with tires resting at ground origin');
    assert.equal(spec.colliderModelFrame, true);
    assert.deepEqual([...view.wheelNodes.keys()].sort(), ['FL', 'FR', 'RL', 'RR']);
    assert.deepEqual(spec.wheels.map(wheel => wheel.name), ['FL', 'FR', 'RL', 'RR']);
    for (const wheel of spec.wheels) {
      const node = view.wheelNodes.get(wheel.name), metadata = spec.model.wheels[wheel.name];
      nearVector(groundPosition(view, node), [metadata.x, metadata.y, metadata.z], `${wheel.name} hub pivot`);
      const wheelBounds = new THREE.Box3().setFromObject(node, true);
      near((wheelBounds.max.y - wheelBounds.min.y) / 2, metadata.r, `${wheel.name} actual tire radius`);
      near(wheelBounds.max.x - wheelBounds.min.x, metadata.w, `${wheel.name} actual tire width`);
      near(wheel.x, metadata.x, `${wheel.name} physics X`); near(wheel.z, metadata.z, `${wheel.name} physics Z`);
      near(spec.wheelRadius, metadata.r, `${wheel.name} shared radius`);
      assert.ok(descendants(node).length > 0, 'the preserved moving pivot owns real wheel geometry');
    }
    for (const name of ['seat_driver', 'seat_gunner', 'seat_gunner2', 'steering_wheel', 'gun_mount', 'gun_mount2', 'roof_top',
      'exhaust_R', 'smoke_engine', 'fuel_cap', 'light_head_L', 'light_head_R', 'light_tail_L', 'light_tail_R']) {
      const node = view.sockets[name]; assert.ok(node, `production CarView preserves ${name}`);
      nearVector(groundPosition(view, node), spec.model.sockets[name], name);
    }
    for (const name of ['weak_engine', 'weak_fuel']) {
      const node = view.model.getObjectByName(name); assert.ok(node, `${name} remains authored metadata`);
      nearVector(groundPosition(view, node), spec.model.sockets[name], name);
    }
    assert.ok(view.sockets.steering_wheel.getObjectByName('steering_wheel_mesh'), 'driver IK retains the moving steering geometry');
    const hatch = view.panels.get('trunk'); assert.ok(hatch, 'rear engine service hatch remains detachable');
    const hatchBounds = new THREE.Box3().setFromObject(hatch, true);
    nearVector(hatchBounds.min.toArray(), spec.model.parts.panel_trunk.min, 'rear hatch minimum');
    nearVector(hatchBounds.max.toArray(), spec.model.parts.panel_trunk.max, 'rear hatch maximum');
    const all = descendants(view.model), staticMeshes = all.filter(mesh => !moving(mesh));
    const draws = staticMeshes.reduce((count, mesh) => count + materialDraws(mesh), 0);
    assert.ok(draws > 0 && draws <= CITY_BUS_ENCOUNTER.maximumStaticBodyDraws,
      `full static shell and hatch need ${draws} material draws, budget ${CITY_BUS_ENCOUNTER.maximumStaticBodyDraws}`);
    assert.equal(CITY_BUS_ENCOUNTER.movingWheelNodes, view.wheelNodes.size);
    for (const mesh of all) {
      assert.ok(mesh.geometry.attributes.position?.count > 0, 'every surviving primitive has real geometry');
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) assertFiniteAttribute(attribute, `${mesh.name}/${name}`);
      if (mesh.geometry.index) for (let i = 0; i < mesh.geometry.index.count; i++) {
        const index = mesh.geometry.index.getX(i);
        if (!Number.isInteger(index) || index < 0 || index >= mesh.geometry.attributes.position.count)
          assert.fail(`${mesh.name}: invalid triangle index ${i} (${index})`);
      }
      assert.ok(mesh.matrixWorld.elements.every(Number.isFinite), `${mesh.name} has a finite world transform`);
    }
    const ride = rideInfo(spec), dt = 1 / 60;
    const state = { spec, ride, kind: 'enemy', pos: new THREE.Vector3(0, ride.restComHeight, 0), quat: new THREE.Quaternion(),
      vel: new THREE.Vector3(0, 0, 10), spin: new Float32Array(4), L: new Float32Array(4).fill(ride.restLen),
      slip: new Float32Array(4), steer: .15, braking: false, gunnerAlive: false };
    view.update(state, dt);
    for (const wheel of spec.wheels) {
      const node = view.wheelNodes.get(wheel.name);
      nearVector(node.position.toArray(), [wheel.x, spec.wheelRadius, wheel.z], `${wheel.name} runtime hub`);
      near(node.rotation.x, 10 / spec.wheelRadius * dt, `${wheel.name} spins on its local axle`);
      near(node.rotation.y, wheel.front ? state.steer : 0, `${wheel.name} front-only steering`);
    }
  } finally { view.dispose(); }
});

function triangleFixture(view) {
  view.root.updateMatrixWorld(true);
  // Detect obstruction from either triangle face without changing production
  // materials or copying vertex data. Windows must be actual holes, not a
  // lucky backface-culling direction or transparent decoder substitution.
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), probes = [];
  for (const source of descendants(view.model).filter(mesh => !moving(mesh))) {
    assert.ok([].concat(source.material).every(m => !m.transparent), 'the bus aperture fixture uses its opaque authored shell');
    const mesh = new THREE.Mesh(source.geometry, material);
    mesh.matrixAutoUpdate = false; mesh.matrix.copy(source.matrixWorld); mesh.updateMatrixWorld(true); probes.push(mesh);
  }
  const ray = new THREE.Raycaster();
  return {
    probes, material,
    hits(point, direction, far) {
      ray.set(new THREE.Vector3(...point).applyMatrix4(view.root.matrixWorld), new THREE.Vector3(...direction).transformDirection(view.root.matrixWorld));
      ray.near = .001; ray.far = far;
      return ray.intersectObjects(probes, false);
    },
    dispose() { material.dispose(); },
  };
}

test('actual bus has supported human-scale stations, clear roof apertures and defined muzzle/window firing paths', () => {
  const spec = createCityDoubleBusSpec(), view = new CarView(spec, { lod: false });
  let triangles;
  try {
    assert.equal(view.usesModel, true); triangles = triangleFixture(view);
    const driver = spec.seats.driver, wheel = spec.steeringWheel, upper = spec.model.upperDeckFloor;
    assert.ok(driver[1] > .8 && driver[1] < 1.15 && driver[1] + .68 < upper, 'seated driver is in the lower cab');
    near(wheel[0], driver[0], 'steering centre follows driver lateral position');
    assert.ok(wheel[1] - driver[1] > .2 && wheel[1] - driver[1] < .5 && wheel[2] - driver[2] > .3 && wheel[2] - driver[2] < .6,
      'ordinary-scale steering is above and forward of the seat');
    assert.equal(triangles.hits([driver[0], driver[1] + .68, driver[2]], [0, 0, 1], spec.length).length, 0,
      'the seated driver head centre sees through the lower front window');
    for (const [role, mountName] of [['gunner', 'gun_mount'], ['gunner2', 'gun_mount2']]) {
      const seat = spec.seats[role], mount = spec.model.sockets[mountName], headY = seat[1] + 1.62;
      near(seat[1], upper, `${role} standing deck`); near(mount[1], seat[1] + 1.35, `${role} muzzle height`);
      const support = triangles.hits([seat[0], seat[1] + .12, seat[2]], [0, -1, 0], .3)[0];
      assert.ok(support, `${role} has a physical floor under the station`);
      near(support.point.y, seat[1], `${role} actual platform top`, .01);
      for (const dx of [-.2, 0, .2]) for (const dz of [-.2, 0, .2]) {
        assert.equal(triangles.hits([seat[0] + dx, headY, seat[2] + dz], [0, 1, 0], 1).length, 0,
          `${role}: roof clears the standing head footprint (${dx},${dz})`);
      }
      for (const origin of [[seat[0], seat[1] + 1.35, seat[2]], mount]) {
        assert.equal(triangles.hits(origin, [0, 1, 0], 1).length, 0, `${role}: muzzle is beneath a real roof opening`);
        // A bounded front/rear/outboard fan through designed window gaps.
        // Some other yaw angles correctly encounter structural window posts.
        for (const yaw of [0, Math.PI, Math.sign(seat[0]) * Math.PI / 2]) for (const offset of [-2, 0, 2]) {
          const angle = yaw + THREE.MathUtils.degToRad(offset);
          assert.equal(triangles.hits(origin, [Math.sin(angle), 0, Math.cos(angle)], spec.length + 1).length, 0,
            `${role}: muzzle path ${yaw}/${offset} clears actual shell triangles`);
        }
      }
      // Reconstruct an accidentally sealed hatch without mutating the shipped
      // model. The identical triangle predicate must detect its opaque roof.
      const seal = new THREE.Mesh(new THREE.BoxGeometry(.85, .085, 1.3), triangles.material);
      seal.position.set(seat[0], spec.model.roofHeight - .05, seat[2]); seal.updateMatrixWorld(true);
      triangles.probes.push(seal);
      try { assert.ok(triangles.hits([seat[0], headY, seat[2]], [0, 1, 0], 1).length > 0, `${role}: a sealed hatch fails the clearance predicate`); }
      finally { triangles.probes.pop(); seal.geometry.dispose(); }
    }
    assert.ok(triangles.hits([0, 3.8, 0], [0, 1, 0], 1).length > 0, 'the same rays detect the real opaque central roof spine');
  } finally { triangles?.dispose(); view.dispose(); }
});

function independentObjects(a, b, path = 'spec') {
  if (!a || typeof a !== 'object') return;
  assert.notEqual(a, b, `${path} must be instance-owned`);
  for (const key of Object.keys(a)) independentObjects(a[key], b[key], `${path}.${key}`);
}
test('bus factory does not share mutable physics, crew, mechanical-zone or model metadata between enemies', () => {
  const a = createCityDoubleBusSpec(), b = createCityDoubleBusSpec(), before = structuredClone(CITY_DOUBLE_BUS);
  assert.deepEqual(a, b); independentObjects(a, b); independentObjects(a, CITY_DOUBLE_BUS);
  a.engine.vmax = 99; a.grip.front = .2; a.susp.freq = 99; a.wheels[0].x += 1;
  a.colliders[0].half[0] += 1; a.seats.gunner[1] += 1; a.steeringWheel[0] += 1;
  a.hitZones.engine.c[2] += 1; a.hitZones.fuel.h[0] += 1;
  a.model.wheels.FL.r += 1; a.model.sockets.seat_gunner2[1] += 1;
  a.model.bbox.max[1] += 1; a.model.parts.panel_trunk.min[2] -= 1;
  assert.deepEqual(b, before, 'a separately spawned bus cannot inherit tuning or geometry mutations');
  assert.deepEqual(CITY_DOUBLE_BUS, before, 'the catalogue template remains unchanged');
});

function hitFixture() {
  const spec = createCityDoubleBusSpec(), ride = rideInfo(spec), events = [];
  const sim = Object.assign(Object.create(Sim.prototype), { time: 12, stats: {}, emit: event => events.push(event) });
  const veh = { pos: new THREE.Vector3(12, 7 + ride.restComHeight, -9),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(.06, .48, -.04, 'YXZ')),
    restComHeight: ride.restComHeight, vel: new THREE.Vector3(), input: {}, driverAlive: true, engineDamage: 0,
    wheels: spec.wheels.map(() => ({ flat: false, grip: 1 })) };
  const car = new Car(sim, 19, spec, veh, 'enemy');
  const state = { id: car.id, spec, kind: 'enemy', ride, pos: veh.pos, quat: veh.quat, vel: veh.vel,
    driverAlive: true, gunnerAlive: true, gunner2Alive: true, exploded: false, gunner: { crouch: false, x: 0, z: 0 } };
  const ghost = new GhostCar(state); ghost.sync(state);
  const worldPoint = p => new THREE.Vector3(p[0], p[1] - ride.restComHeight, p[2]).applyQuaternion(veh.quat).add(veh.pos);
  const cast = (target, origin, direction) => target.raycast(worldPoint(origin), new THREE.Vector3(...direction).applyQuaternion(veh.quat), 4);
  return { spec, sim, car, ghost, state, events, cast };
}
test('real bus and client ghost expose rear engine/fuel zones and independently hittable, damageable upper-deck gunners', () => {
  const { spec, sim, car, ghost, state, events, cast } = hitFixture();
  assert.equal(car.crewAlive(), 3); assert.notEqual(car.crew.gunner, car.crew.gunner2);
  for (const [kind, origin, direction] of [
    ['engine', [0, spec.hitZones.engine.c[1], -6], [0, 0, 1]],
    ['fuel', [-2, spec.hitZones.fuel.c[1], spec.hitZones.fuel.c[2]], [1, 0, 0]],
  ]) {
    const hit = cast(car, origin, direction), clientHit = cast(ghost, origin, direction);
    assert.equal(hit?.zone.kind, kind); assert.equal(clientHit?.zone.kind, kind);
    near(hit.t, clientHit.t, `${kind} Car/Ghost distance`);
    assert.deepEqual(hit.zone.c, spec.hitZones[kind].c); assert.deepEqual(hit.zone.h, spec.hitZones[kind].h);
    assert.notEqual(hit.zone.c, spec.hitZones[kind].c, 'zone bounds are owned by this entity');
    assert.ok(hit.zone.c[2] < 0, `${kind} is on the rear half of the actual bus`);
    sim.damageZone(car, hit, kind === 'engine' ? 100 : 30, { src: 1, cause: 'shot' });
  }
  near(car.engineHp, 40, 'rear engine damage'); near(car.veh.engineDamage, .6, 'rear engine affects propulsion');
  near(car.fuelHp, 30, 'side fuel tank damage'); assert.ok(car.hp < car.maxHp && car.hp > 0);
  for (const role of ['gunner', 'gunner2']) {
    const seat = spec.seats[role], origin = [seat[0], seat[1] + 3.0, seat[2]];
    const hit = cast(car, origin, [0, -1, 0]), clientHit = cast(ghost, origin, [0, -1, 0]);
    assert.equal(hit?.zone.kind, role + '_head'); assert.equal(hit.zone.role, role);
    assert.equal(clientHit?.zone.kind, hit.zone.kind); near(hit.t, clientHit.t, `${role} Car/Ghost distance`);
    sim.damageZone(car, hit, 100, { src: 1, cause: 'shot' });
    assert.equal(car.crew[role].alive, false); assert.equal(car.crew[role].hp, 0);
    state[role === 'gunner' ? 'gunnerAlive' : 'gunner2Alive'] = false; ghost.sync(state);
    assert.notEqual(cast(car, origin, [0, -1, 0])?.zone.role, role, 'dead crew zones leave simulation targeting');
    assert.notEqual(cast(ghost, origin, [0, -1, 0])?.zone.role, role, 'dead crew zones leave client targeting');
    if (role === 'gunner') assert.equal(car.crew.gunner2.alive, true, 'first gunner death does not kill the second');
  }
  assert.equal(car.crew.driver.alive, true); assert.equal(car.crewAlive(), 1);
  assert.equal(car.driverless, false); assert.equal(car.veh.driverAlive, true);
  assert.deepEqual(events.filter(event => event.t === 'crewDead').map(event => event.role), ['gunner', 'gunner2']);
  assert.equal(sim.stats.crewKills, 2, 'both real damage paths receive independent kill credit');
});

test('complete bus spec settles, accelerates, steers and brakes on a bounded real Rapier flat-road fixture', async () => {
  await initPhysics();
  const DT = 1 / 120, spec = createCityDoubleBusSpec(), world = createWorld(DT);
  const ground = addStaticBox(world, [0, -1, 0], [200, 1, 200], null, { friction: 1 });
  let veh;
  try {
    veh = new Vehicle(world, spec);
    const step = (input, count) => {
      veh.setInput(input);
      for (let i = 0; i < count; i++) {
        veh.applyForces(DT, null); world.step(); veh.afterStep();
        assert.ok(veh.pos.toArray().every(Number.isFinite) && veh.quat.toArray().every(Number.isFinite) && Number.isFinite(veh.speed), 'finite bus motion');
        assert.ok(veh.up.y > .75, 'bounded low-speed turn does not overturn the tall bus');
      }
    };
    step({}, 4 * 120);
    assert.equal(veh.grounded, 4); near(veh.restComHeight, rideInfo(spec).restComHeight, 'shared ride-height contract');
    near(veh.pos.y, veh.restComHeight, 'settled bus COM height', .04);
    near(veh.body.mass(), spec.mass, 'explicit mass', .01);
    const startZ = veh.pos.z;
    step({ throttle: 1 }, 5 * 120);
    assert.ok(veh.pos.z > startZ + 8 && veh.speed > 3, 'bus propulsion moves its actual mass forward');
    const beforeTurn = Math.atan2(veh.fwd.x, veh.fwd.z);
    step({ throttle: .5, steer: .25 }, 2 * 120);
    assert.ok(Math.atan2(veh.fwd.x, veh.fwd.z) > beforeTurn + .01, 'positive steer turns toward authored +X left');
    const beforeBrake = veh.speed;
    step({ brake: 1 }, 3 * 120);
    assert.ok(veh.speed < beforeBrake * .5, 'brakes slow the complete chassis');
    assert.equal(veh.poseRevision, 0, 'ordinary handling never disguises a reset as motion');
  } finally {
    let bodies, colliders;
    try {
      veh?.destroy(); world.removeRigidBody(ground.rb);
      bodies = world.bodies.len(); colliders = world.colliders.len();
    } finally { world.free(); }
    assert.equal(bodies, 0, 'fixture releases vehicle and ground bodies');
    assert.equal(colliders, 0, 'fixture releases owned colliders');
  }
});

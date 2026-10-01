// WORK-only acceptance regressions. Imports actual Run, camera rigs and THREE.
// No browser, renderer, simulation step, release edit or frame-rate claim.
import '../tests/helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { makeCarState } from '../src/view/car_state.js';

let Run;
if (!process.env.QA_RUN_SOURCE) ({ Run } = await import('../src/game/run.js'));
else {
  const source = await readFile(process.env.QA_RUN_SOURCE, 'utf8');
  const runtime = source.replace(/(from\s+)(['"])([^'"]+)\2/g, (_all, prefix, quote, specifier) => {
    const url = specifier.startsWith('.') ? new URL(specifier, new URL('../src/game/run.js', import.meta.url)).href : import.meta.resolve(specifier);
    return `${prefix}${quote}${url}${quote}`;
  });
  ({ Run } = await import(`data:text/javascript;base64,${Buffer.from(runtime).toString('base64')}`));
}

const dt = 1 / 60, grace = .35;
const idle = () => {};
const commands = () => Object.freeze({ driver: Object.freeze({}), gunner: Object.freeze({}) });
function withWindow(t) {
  const prior = globalThis.window, had = Object.hasOwn(globalThis, 'window'); globalThis.window = {};
  t.after(() => { if (had) globalThis.window = prior; else delete globalThis.window; });
}

function fixture({ role = 'gunner', specId = 'truck_t1', speed = 0, yaw = 0, pitch = 0, external = false, mode = 0, origin = [3000, 0, 24000], roll = 0 } = {}) {
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, .05, 1000), shown = [], active = [];
  const g = { camera, driverFovBase: 85, fovBase: 80, hud: { setVisible(v) { shown.push(v); } }, input: { lastDevice: 'kbm' } };
  const run = new Run(g, { role, seed: 7 }), p = makeCarState(1, specId, 'player');
  p.pos.fromArray(origin); p.vel.set(0, 0, speed); p.speed = speed;
  p.quat.setFromEuler(new THREE.Euler(0, 0, roll));
  const head = new THREE.Object3D(); head.position.copy(p.pos).add(new THREE.Vector3(-.45, 1.4, .75));
  Object.assign(run, { states: new Map([[1, p]]), started: true, goSeen: true, introDone: true,
    simState: 'run', spec: p.spec, eye: new THREE.Vector3(), effects: { weapons: ['pistol'] },
    wv: { cars: new Map([[1, { crew: { driver: { bones: { Head: head } } } }]]) },
    _worldRay: () => null, _groundY: () => null,
    cockpit: { active: false, setActive(v) { this.active = v; active.push(v); }, setUnits: idle, update: idle, onEvent: () => null },
  });
  if (role !== 'driver') run.gunner = { yaw, pitch, ads: 0, reloading: false, weapon: { scope: false } };
  run.gcam.firstPerson = !external; run.chase.mode = mode;
  for (let i = 0; i < 120; i++) {
    run._gunnerEye(p, run.eye);
    run._camera(dt, commands(), p);
  }
  return { run, p, camera, shown, active, head };
}

function defeat(f, why = f.run.role === 'driver' ? 'driver' : 'gunner') {
  f.run.simState = 'dying'; f.p[`${why}Alive`] = false; f.run._defeatWhy = why;
}
function sample(f) {
  const { camera, p } = f; camera.updateMatrixWorld(true);
  const target = p.pos.clone().add(new THREE.Vector3(0, .8, 0));
  const local = target.clone().applyMatrix4(camera.matrixWorldInverse), ndc = target.clone().project(camera);
  const corners = [];
  for (const x of [-p.spec.width / 2, p.spec.width / 2]) for (const y of [-.35, p.spec.height]) for (const z of [-p.spec.length / 2, p.spec.length / 2]) {
    const c = new THREE.Vector3(x, y, z).applyQuaternion(p.quat).add(p.pos), view = c.clone().applyMatrix4(camera.matrixWorldInverse), projection = c.project(camera);
    corners.push(view.z < -camera.near && Math.abs(projection.x) <= 1 && Math.abs(projection.y) <= 1 && projection.z >= -1 && projection.z <= 1);
  }
  return { target, depth: -local.z, ndc, corner: corners.some(Boolean), distance: camera.position.distanceTo(target),
    finite: [...camera.position.toArray(), ...camera.quaternion.toArray(), camera.fov, camera.near, ...ndc.toArray()].every(Number.isFinite) };
}
function readable(f, label) {
  const s = sample(f); assert.ok(s.finite, `${label}: finite camera/projection`);
  assert.ok(s.depth > .15, `${label}: truck in front, depth ${s.depth}`);
  assert.ok(Math.max(Math.abs(s.ndc.x), Math.abs(s.ndc.y)) <= .95, `${label}: truck center within NDC .95, ${s.ndc.toArray()}`);
  assert.ok(s.corner, `${label}: a truck body-box corner visible (geometric proxy, not pixels)`);
  if (f.run.deathCamT >= 1.4) assert.ok(s.distance <= 18, `${label}: settled truck distance ${s.distance}`);
}
function advance(f, seconds, onFrame = idle) {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    f.run._camera(dt, commands(), f.p); onFrame(f, i);
  }
}

test('a sky-facing actual gunner rig starts converging before the end of the original pull-out', t => {
  withWindow(t); const f = fixture({ speed: 55, pitch: 1.15 }), from = f.camera.quaternion.clone(); defeat(f);
  let maxStep = 0, previous = from.clone();
  advance(f, .3, () => { maxStep = Math.max(maxStep, previous.angleTo(f.camera.quaternion)); previous.copy(f.camera.quaternion); });
  assert.ok(from.angleTo(f.camera.quaternion) > .1, 'aim must not remain frozen at the pre-defeat sky pose');
  assert.ok(maxStep < .4, `aim convergence must avoid a single large snap, saw ${maxStep} radians`);
});

for (const cfg of [
  { name: 'gunner sky', role: 'gunner', pitch: 1.15 },
  { name: 'gunner rear', role: 'gunner', yaw: Math.PI },
  { name: 'gunner down', role: 'gunner', yaw: .8, pitch: -1.15 },
  { name: 'gunner shoulder sky', role: 'gunner', yaw: .8, pitch: 1.15, external: true },
  { name: 'driver cockpit', role: 'driver' },
  { name: 'driver chase', role: 'driver', mode: 1 },
]) test(`actual ${cfg.name} defeat keeps the moving truck readable after the proposed grace`, t => {
  withWindow(t); const f = fixture({ ...cfg, speed: 55 }); defeat(f);
  advance(f, 2, (_f, i) => {
    if (f.run.deathCamT + 1e-10 >= grace) readable(f, `${cfg.name}, frame ${i}`);
    f.p.pos.addScaledVector(f.p.vel, dt);
  });
});

test('death pull-out follows render translation without a speed-dependent world-space trail', t => {
  withWindow(t); const a = fixture({ speed: 0 }), b = fixture({ speed: 0 }); defeat(a); defeat(b);
  // Both capture the same initial view. Thereafter only the rendered truck's
  // translation differs. This metamorphic assertion does not copy orbit math.
  a.run._camera(dt, commands(), a.p); b.run._camera(dt, commands(), b.p);
  for (let i = 0; i < 60; i++) {
    b.p.pos.add(new THREE.Vector3(.4, .02, 55 * dt));
    a.run._camera(dt, commands(), a.p); b.run._camera(dt, commands(), b.p);
    const offsetA = a.camera.position.clone().sub(a.p.pos), offsetB = b.camera.position.clone().sub(b.p.pos);
    assert.ok(offsetA.distanceTo(offsetB) < 1e-8, `truck-relative camera differs after frame ${i}: ${offsetA.distanceTo(offsetB)}m`);
    assert.ok(a.camera.quaternion.angleTo(b.camera.quaternion) < 1e-6, 'translation cannot change aim convergence');
  }
});

test('inside-cab defeat starts with a bounded external cut while preserving captured aim/FOV', t => {
  withWindow(t);
  for (const role of ['driver', 'gunner']) for (const specId of ['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4']) {
    const f = fixture({ role, specId, pitch: 1.15 }), initialPos = f.camera.position.clone(), initialQuat = f.camera.quaternion.toArray(), initialFov = f.camera.fov;
    defeat(f); f.run._camera(0, commands(), f.p);
    const distance = f.camera.position.distanceTo(initialPos);
    assert.ok(distance > 1 && distance <= 8, `${role}/${specId}: authored terminal cut remains bounded, ${distance}m`);
    const local = f.camera.position.clone().sub(f.p.pos).applyQuaternion(f.p.quat.clone().invert()); local.y += f.p.ride.restComHeight;
    for (const collider of f.p.spec.colliders) {
      const center = new THREE.Vector3(...collider.center), half = new THREE.Vector3(...collider.half);
      assert.ok(!new THREE.Box3(center.clone().sub(half), center.clone().add(half)).containsPoint(local), `${role}/${specId}: camera outside physical cabin/body bounds`);
    }
    assert.deepEqual(f.camera.quaternion.toArray(), initialQuat); assert.equal(f.camera.fov, initialFov);
    assert.equal(f.run.defeatReason, role); assert.equal(f.p[`${role}Alive`], false);
  }
});

test('an already safe external camera preserves its captured position endpoint', t => {
  withWindow(t); const f = fixture({ role: 'driver', mode: 1 }), initial = f.camera.position.clone(), quat = f.camera.quaternion.toArray(), fov = f.camera.fov;
  defeat(f); f.run._camera(0, commands(), f.p);
  assert.ok(f.camera.position.distanceTo(initial) < 1e-8); assert.deepEqual(f.camera.quaternion.toArray(), quat); assert.equal(f.camera.fov, fov);
});

test('shorter aim convergence preserves the original FOV endpoints and position/FOV pull-out interval', t => {
  withWindow(t); const f = fixture({ pitch: 1.15 }), initialFov = f.camera.fov; defeat(f);
  f.run._camera(0, commands(), f.p); assert.equal(f.camera.fov, initialFov);
  advance(f, .35); const earlyPosition = f.camera.position.clone(), earlyFov = f.camera.fov;
  assert.ok(earlyFov > 60 && earlyFov < initialFov, 'FOV remains in its authored pull-out while aim has converged');
  advance(f, .85); assert.ok(f.camera.fov > 60, 'position/FOV must not be retimed to the short aim interval');
  advance(f, .2); assert.ok(Math.abs(f.camera.fov - 60) <= .05, 'authored FOV reaches60 at1.4s');
  assert.ok(f.camera.position.distanceTo(earlyPosition) > 2, 'position keeps pulling out after the short aim interval');
  assert.equal(f.camera.near, .15, 'external near plane remains appropriate');
});

test('death presentation never writes CarState, simulation result or incoming controls', t => {
  withWindow(t); const f = fixture({ speed: 55, pitch: 1.15 }); defeat(f);
  const result = Object.freeze({ why: 'gunner' }); f.run.sim = Object.freeze({ state: 'dying', result, won: false });
  const before = JSON.stringify(f.p), cmds = Object.freeze({ driver: Object.freeze({ throttle: 1, steer: -.8, nitro: true }), gunner: Object.freeze({ fire: true, ads: true, reload: true }) });
  for (let i = 0; i < 100; i++) f.run._camera(dt, cmds, f.p);
  assert.equal(JSON.stringify(f.p), before); assert.equal(f.run.sim.result, result);
  assert.equal(f.run.defeatReason, 'gunner'); assert.equal(f.run.sim.state, 'dying');
});

test('origin-zero, flipped hull and a rendered recovery jump remain finite and reframe the current truck', t => {
  withWindow(t);
  for (const origin of [[0, 0, 0], [3000, 0, 60000]]) for (const roll of [0, Math.PI]) {
    const f = fixture({ origin, roll, pitch: 1.15 }); defeat(f);
    // Include an exact zero camera-to-query-pivot vector on the first frame.
    f.camera.position.copy(f.p.pos).add(new THREE.Vector3(0, 1.2, 0));
    advance(f, .5, () => assert.ok(sample(f).finite));
    f.p.pos.add(new THREE.Vector3(19, 3, 75)); f.p.quat.identity();
    advance(f, 1.5, () => { assert.ok(sample(f).finite); readable(f, `${origin}/${roll} after recovery`); });
  }
});

function boxWorld(boxes) {
  function hit(r, max, normal = false) {
    const ray = new THREE.Ray(new THREE.Vector3(r.origin.x, r.origin.y, r.origin.z), new THREE.Vector3(r.dir.x, r.dir.y, r.dir.z));
    let nearest = null;
    for (const box of boxes) {
      const inside = box.containsPoint(ray.origin), point = inside ? ray.origin.clone() : ray.intersectBox(box, new THREE.Vector3()); if (!point) continue;
      const distance = ray.origin.distanceTo(point); if (distance > max || (nearest && distance >= nearest.timeOfImpact)) continue;
      const surfaceNormal = new THREE.Vector3();
      if (inside) surfaceNormal.copy(ray.direction).negate();
      else for (const axis of ['x', 'y', 'z']) {
        if (Math.abs(point[axis] - box.min[axis]) < 1e-6) { surfaceNormal[axis] = -1; break; }
        if (Math.abs(point[axis] - box.max[axis]) < 1e-6) { surfaceNormal[axis] = 1; break; }
      }
      nearest = { timeOfImpact: distance, kind: 'rock', ...(normal ? { normal: surfaceNormal } : {}) };
    }
    return nearest;
  }
  return { castRay: (r, max) => hit(r, max), castRayAndGetNormal: (r, max) => hit(r, max, true) };
}
function clearSegment(a, b, boxes) {
  const dir = b.clone().sub(a), length = dir.length(); if (length < 1e-8) return true;
  const ray = new THREE.Ray(a.clone(), dir.divideScalar(length));
  return boxes.every(box => { const point = ray.intersectBox(box, new THREE.Vector3()); return !point || a.distanceTo(point) >= length - 1e-6; });
}

test('final displayed camera respects a feasible tunnel roof/floor rather than lifting through the roof', t => {
  withWindow(t);
  const floor = new THREE.Box3(new THREE.Vector3(-40, -1, -40), new THREE.Vector3(40, 0, 40));
  const roof = new THREE.Box3(new THREE.Vector3(-40, 4.5, -40), new THREE.Vector3(40, 4.8, 40));
  const wall = new THREE.Box3(new THREE.Vector3(-7.5, 0, -40), new THREE.Vector3(-7, 4.5, 40));
  const boxes = [floor, roof, wall], f = fixture({ origin: [0, 1.2, 0], pitch: 1.15 });
  f.run._worldRay = Run.prototype._worldRay; f.run._groundY = Run.prototype._groundY; f.run.qworld = boxWorld(boxes);
  const pivot = f.p.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), witness = new THREE.Vector3(-4, 3.3, -4);
  assert.ok(clearSegment(pivot, witness, boxes), 'independent witness establishes a feasible camera location');
  assert.ok(witness.y > 1.2 && witness.y < 4.5 && boxes.every(box => !box.containsPoint(witness)));
  defeat(f); advance(f, 2, (_f, frame) => {
    assert.ok(sample(f).finite, `finite final pose at frame${frame}`);
    assert.ok(f.camera.position.y >= 1.2 - 1e-6, `camera clears actual floor, y=${f.camera.position.y}`);
    assert.ok(f.camera.position.y < 4.5, `camera remains under the tunnel roof, y=${f.camera.position.y}`);
    assert.ok(boxes.every(box => !box.containsPoint(f.camera.position)), 'final position outside solid geometry');
    assert.ok(clearSegment(pivot, f.camera.position, boxes), 'final floor adjustment cannot reintroduce roof/wall obstruction');
  });
});

for (const scene of ['close-wall', 'tunnel-close-wall', 'overhang-close-wall-step', 'raised-floor-step']) test(`feasible ${scene} keeps the camera outside the player body`, t => {
  withWindow(t);
  const tunnel = scene.startsWith('tunnel'), overhang = scene.startsWith('overhang');
  const floor = new THREE.Box3(new THREE.Vector3(-80, -1, -80), new THREE.Vector3(80, 0, 240));
  const wall = new THREE.Box3(new THREE.Vector3(-1.35, -.5, -80), new THREE.Vector3(-1.15, 6, 240));
  const roof = new THREE.Box3(new THREE.Vector3(-80, 4.5, -80), new THREE.Vector3(80, 4.8, 240));
  const boxes = [floor];
  if (scene.includes('close-wall')) boxes.push(wall);
  if (tunnel) boxes.push(roof);
  if (scene.includes('step')) boxes.push(new THREE.Box3(new THREE.Vector3(-25, 0, -80), new THREE.Vector3(-2.8, 2.8, 240)));
  if (overhang) boxes.push(new THREE.Box3(new THREE.Vector3(-25, 3.3, -80), new THREE.Vector3(-.45, 3.6, 240)));
  const f = fixture({ speed: 25, origin: [0, 1.2, 0], yaw: tunnel ? .8 : 0, pitch: .8 });
  f.run._worldRay = Run.prototype._worldRay; f.run._groundY = Run.prototype._groundY; f.run.qworld = boxWorld(boxes);
  const body = new THREE.Box3(new THREE.Vector3(-f.p.spec.width / 2, -.35, -f.p.spec.length / 2),
    new THREE.Vector3(f.p.spec.width / 2, f.p.spec.height, f.p.spec.length / 2));
  const initialTarget = f.p.pos.clone().add(new THREE.Vector3(0, .8, 0)), witness = new THREE.Vector3(-.7, 3.05, f.p.pos.z - 5);
  assert.ok(clearSegment(initialTarget, witness, boxes), 'finite independent witness has clear LOS on road side of close wall');
  assert.ok(boxes.every(box => !box.containsPoint(witness)) && witness.y >= 1.2 && (!tunnel || witness.y < 4.5));
  assert.ok(!body.containsPoint(witness.clone().sub(f.p.pos)), 'witness is outside player body proxy');
  let previousOffset = null, previousQuat = null, previousStatus = null;
  defeat(f); advance(f, 3, (_f, frame) => {
    const target = f.p.pos.clone().add(new THREE.Vector3(0, .8, 0));
    if (f.run.deathCamT + 1e-10 >= grace) {
      readable(f, `${scene}, frame${frame}`);
      const local = f.camera.position.clone().sub(f.p.pos).applyQuaternion(f.p.quat.clone().invert());
      assert.ok(!body.containsPoint(local), `camera outside own body proxy, frame${frame}, local=${local.toArray()}`);
      assert.ok(boxes.every(box => !box.containsPoint(f.camera.position)), 'camera outside solid wall/floor/roof');
      assert.ok(clearSegment(target, f.camera.position, boxes), 'final camera has unobstructed LOS to truck');
      assert.ok(f.camera.position.y >= 1.2 - 1e-6 && (!tunnel || f.camera.position.y < 4.5), 'final floor and roof remain safe');
      const offset = f.camera.position.clone().sub(f.p.pos);
      if (previousOffset) assert.ok(previousOffset.distanceTo(offset) < .5,
        `unchanged feasible scene offset jump ${previousOffset.distanceTo(offset)}m at frame${frame}/t${f.run.deathCamT}: ${previousOffset.toArray()} -> ${offset.toArray()}; previous=${JSON.stringify(previousStatus)} current=${JSON.stringify({ side: f.run.deathSide, clear: f.run.deathCameraClear, target: target.toArray(), camera: f.camera.position.toArray(), truck: f.p.pos.toArray() })}`);
      if (previousQuat) assert.ok(previousQuat.angleTo(f.camera.quaternion) < .25,
        `unchanged feasible scene aim jump ${previousQuat.angleTo(f.camera.quaternion)}rad at frame${frame}/t${f.run.deathCamT}`);
      previousOffset = offset; previousQuat = f.camera.quaternion.clone();
      previousStatus = { side: f.run.deathSide, clear: f.run.deathCameraClear, target: target.toArray(), camera: f.camera.position.toArray(), truck: f.p.pos.toArray() };
    }
    f.p.pos.addScaledVector(f.p.vel, dt);
  });
});

function updateFixture(role) {
  const f = fixture({ role }), calls = [], contexts = [];
  const { run, p, head } = f;
  Object.assign(run, { buf: { sample: () => null }, ghosts: new Map([[1, { sync: idle }]]),
    hazMarks: { update: idle }, banner: { update: idle }, threatHud: { setVisible: idle, update: idle },
    _hudData: () => ({}), hud2: {}, proj: [], gunner: null,
  });
  const getWorldPosition = head.getWorldPosition;
  head.getWorldPosition = function(out) { calls.push('head'); return getWorldPosition.call(this, out); };
  run.wv.updateBoss = idle; run.wv.viewMap = new Map();
  run.wv.update = (_dt, _states, _events, ctx) => {
    calls.push('views'); head.position.y += .25;
    contexts.push({ firstPerson: ctx.localDriver?.firstPerson, gunnerFirstPerson: ctx.localGunner?.firstPerson,
      cameraPos: run.g.camera.position.clone(), cinematic: run.cinematic, introOutside: run.introOutside, frustum: ctx.frustum?.clone() });
  };
  const actualCamera = Run.prototype._camera;
  run._camera = function(...args) { calls.push('camera'); return actualCamera.apply(this, args); };
  return { ...f, calls, contexts, step: () => run.update(dt, { driver: {}, gunner: {} }, 1) };
}

test('healthy driver resolves cockpit eye after this frame\'s actual head pose and views', t => {
  withWindow(t); const f = updateFixture('driver'), before = f.run._eyeLocal.clone(); f.step();
  assert.deepEqual(f.calls, ['views', 'camera', 'head']);
  assert.ok(f.run._eyeLocal.y > before.y, 'fresh head pose changes cockpit eye in this frame');
  assert.equal(f.contexts[0].firstPerson, true); assert.equal(f.run.deathFrom, undefined);
});

test('terminal driver camera resolves external crew visibility and current culling before views', t => {
  withWindow(t); const f = updateFixture('driver'); defeat(f); f.step();
  assert.deepEqual(f.calls, ['camera', 'views'], 'defeat presents its terminal camera before the world view');
  assert.equal(f.contexts[0].firstPerson, false, 'first defeat frame cannot use cockpit cutaways');
  assert.equal(f.contexts[0].introOutside, true); assert.equal(f.contexts[0].cinematic, true);
  assert.ok(f.contexts[0].cameraPos.distanceTo(f.camera.position) < 1e-8);
  assert.deepEqual(f.contexts[0].frustum.planes.map(p => [...p.normal.toArray(), p.constant]),
    f.run._frustum.planes.map(p => [...p.normal.toArray(), p.constant]), 'same frame culling uses terminal camera');
  assert.equal(f.run.cockpit.active, false);
});

test('healthy gunner keeps camera projection before world/viewmodel work', t => {
  withWindow(t); const f = updateFixture('gunner'); f.step();
  assert.deepEqual(f.calls, ['camera', 'views']); assert.equal(f.run.deathFrom, undefined);
});

test('late boss death cannot replace defeat; victory remains its own finale and HUD restoration stays owned', t => {
  withWindow(t); const loss = fixture(), victory = fixture();
  const boss = { pos: new THREE.Vector3(20, 0, 100), dead: true, exploded: true };
  loss.run.bossState = boss; defeat(loss); loss.run._finaleHudHidden = true;
  loss.run._camera(dt, commands(), loss.p);
  assert.ok(loss.run.deathFrom); assert.equal(loss.run.finaleT, undefined); assert.deepEqual(loss.shown, [true]);
  loss.run._finaleHudHidden = true; window.__app = { game: loss.run.g, screen: 'results' };
  loss.run._camera(dt, commands(), loss.p); assert.deepEqual(loss.shown, [true], 'results owns its HUD visibility');
  delete window.__app;
  victory.run.bossState = boss; victory.run.summary = { won: true };
  victory.run._camera(dt, commands(), victory.p);
  assert.equal(victory.run.deathFrom, undefined); assert.equal(victory.run.cinematic, true); assert.deepEqual(victory.shown, [false]);
  victory.run._camera(9, commands(), victory.p);
  assert.equal(victory.run.finaleDone, true); assert.deepEqual(victory.shown, [false, true]);
});

test('a new Run has no stale terminal pose and healthy camera restores its native near plane', t => {
  withWindow(t); const lost = fixture(); defeat(lost); advance(lost, .6);
  const fresh = fixture({ role: 'gunner', origin: [0, 0, 0] });
  assert.equal(fresh.run.deathFrom, undefined); assert.equal(fresh.run.deathCamT, undefined);
  assert.equal(fresh.run.cinematic, false); assert.equal(fresh.run.introOutside, undefined);
  assert.equal(fresh.camera.near, .05, 'new live FP gunner retains its near plane');
  assert.notEqual(fresh.run.id, lost.run.id); assert.equal(fresh.run.defeatReason, null);
});

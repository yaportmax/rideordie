import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ChaseCam, DRIVER_CAMERA_NAMES } from '../src/view/camera_rig.js';
import { Input, DEFAULT_BINDINGS } from '../src/core/input.js';
import { Run } from '../src/game/run.js';
import { driverBodyBounds, limitDriverCamera } from '../src/view/driver_camera_bounds.js';

const up = new THREE.Vector3(0, 1, 0), dt = 1 / 120;
const spec = { width: 2, length: 5.6, height: 1.9,
  colliders: [{ center: [0, .8, 0], half: [1, .4, 2.8] }] };
const forward = camera => new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
function fixture(mode, worldZ = 0) {
  const camera = new THREE.PerspectiveCamera(85, 16 / 9), rig = new ChaseCam(camera); rig.mode = mode;
  const pos = new THREE.Vector3(0, .75, worldZ), quat = new THREE.Quaternion(), vel = new THREE.Vector3();
  const opts = { vehicleSpec: spec, restComHeight: .75, fovBase: 85,
    cockpitEye: pos.clone().add(new THREE.Vector3(.4, .6, .7)), lookBackEye: pos.clone().add(new THREE.Vector3(0, 1.5, -3)) };
  const update = (delta = dt) => rig.update(delta, pos, quat, vel, opts);
  return { camera, rig, pos, quat, vel, opts, update };
}
function nearCorners(camera) {
  camera.updateMatrixWorld(true);
  return [-1, 1].flatMap(x => [-1, 1].map(y => new THREE.Vector3(x, y, -1).unproject(camera)));
}
function ownBody(f) {
  if (f.bodyBox) return f.bodyBox;
  return new THREE.Box3(new THREE.Vector3(-spec.width / 2, -.75, -spec.length / 2),
    new THREE.Vector3(spec.width / 2, spec.height - .75, spec.length / 2));
}
function assertOutsideOwnBody(f) {
  const body = ownBody(f), inv = f.quat.clone().invert();
  for (const point of [f.camera.position, ...nearCorners(f.camera)])
    assert.equal(body.containsPoint(point.clone().sub(f.pos).applyQuaternion(inv)), false, 'eye and actual near-plane corners clear the truck');
}
function rayWorld(boxes) {
  return (origin, direction, max) => {
    const ray = new THREE.Ray(origin.clone(), direction.clone()); let t = Infinity;
    for (const box of boxes) {
      if (box.containsPoint(origin)) { t = 0; break; }
      const hit = ray.intersectBox(box, new THREE.Vector3());
      if (hit) t = Math.min(t, origin.distanceTo(hit));
    }
    return t <= max ? { t } : null;
  };
}

test('keyboard view and R3 both cycle all five named driver views back to the default cockpit', () => {
  assert.deepEqual(DRIVER_CAMERA_NAMES, ['COCKPIT', 'CHASE', 'FAR CHASE', 'BUMPER', 'FRONT EXTERIOR']);
  const f = fixture(0);
  const input = Object.assign(Object.create(Input.prototype), { bindings: DEFAULT_BINDINGS,
    keys: new Set(), pressed: new Set(['KeyC']), padEdge: new Array(20).fill(false), pad: null,
    locked: false, mouseDX: 0, mouseDY: 0, sens: { mouse: .0022 }, steerSmooth: 0 });
  assert.equal(input.driver(dt).cameraToggle, true);
  input.pressed.clear(); input.padEdge[11] = true;
  input.pad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 20 }, () => ({ pressed: false, value: 0 })) };
  assert.equal(input.driver(dt).cameraToggle, true, 'actual standard-map R3 is button 11');
  for (let i = 1; i <= 5; i++) { f.rig.toggle(); assert.equal(f.rig.mode, i % 5); assert.equal(f.rig.firstPerson, i % 5 === 0); }
});

test('new views keep continuous offsets and aim through repeated full yaw wraps at both road origins', () => {
  for (const mode of [3, 4]) for (const worldZ of [0, 50000]) for (const sign of [-1, 1]) {
    const f = fixture(mode, worldZ); f.vel.z = 36;
    for (let i = 0; i < 600; i++) f.update();
    let lastOffset = f.camera.position.clone().sub(f.pos), lastQuat = f.camera.quaternion.clone();
    for (let i = 1; i <= 960; i++) {
      f.quat.setFromAxisAngle(up, sign * i * Math.PI / 240); f.update();
      const offset = f.camera.position.clone().sub(f.pos);
      assert.ok(lastOffset.distanceTo(offset) < .55, `mode ${mode}, offset continuity at frame ${i}`);
      assert.ok(lastQuat.angleTo(f.camera.quaternion) < .05, `mode ${mode}, aim continuity at frame ${i}`);
      assert.equal(f.rig.frontCameraClear, true); assertOutsideOwnBody(f);
      lastOffset.copy(offset); lastQuat.copy(f.camera.quaternion);
    }
  }
});

test('both new camera quaternions follow full chassis pitch and roll continuously without Euler inversion', () => {
  for (const mode of [3, 4]) for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
    const f = fixture(mode); f.update(); let last = f.camera.quaternion.clone();
    for (let i = 1; i <= 720; i++) {
      f.quat.setFromAxisAngle(axis, i * Math.PI / 180); f.update();
      assert.ok(last.angleTo(f.camera.quaternion) < .025, `mode ${mode} remains continuous past vertical`);
      assertOutsideOwnBody(f); last.copy(f.camera.quaternion);
    }
  }
});

test('new camera translations follow the current interpolated truck through uneven frame times without speed lag', () => {
  for (const mode of [3, 4]) {
    const f = fixture(mode); f.vel.set(0, 0, 40);
    for (let i = 0; i < 600; i++) f.update();
    const offset = f.camera.position.clone().sub(f.pos);
    for (const delta of [1 / 144, .04, 1 / 90, .05, 1 / 60]) {
      f.pos.addScaledVector(f.vel, delta); f.update(delta);
      assert.ok(f.camera.position.clone().sub(f.pos).distanceTo(offset) < 1e-7, 'offset is attached to this frame, not a previous world position');
    }
  }
});

test('bonnet and front exterior point in useful opposite directions and held look-back returns on release', () => {
  for (const mode of [3, 4]) {
    const f = fixture(mode); for (let i = 0; i < 500; i++) f.update();
    const initial = f.camera.position.clone(), aim = forward(f.camera);
    assert.ok(initial.z > f.pos.z + 2.8);
    assert.ok(mode === 3 ? aim.z > .99 : aim.z < -.8);
    f.opts.lookBack = true; f.update();
    assert.ok(f.camera.position.z < f.pos.z - 2.8);
    assert.ok(mode === 3 ? forward(f.camera).z < -.99 : forward(f.camera).z > .8);
    f.opts.lookBack = false; f.update();
    assert.ok(f.camera.position.distanceTo(initial) < 1e-8);
    assertOutsideOwnBody(f);
  }
});

test('bonnet free look supports mouse and right stick while its eye and near plane stay outside the body', () => {
  const f = fixture(3);
  for (const opts of [{ mouseYaw: 2.3, mousePitch: -.55 }, { mouseYaw: -2.3, mousePitch: .45 },
    { lookX: 1, lookY: 1 }, { lookX: -1, lookY: -1 }]) {
    Object.assign(f.opts, { mouseYaw: 0, mousePitch: 0, lookX: 0, lookY: 0 }, opts);
    for (let i = 0; i < 200; i++) { f.update(); assertOutsideOwnBody(f); assert.equal(f.rig.frontCameraClear, true); }
    assert.ok(Math.abs(forward(f.camera).x) > .5, 'actual camera aim moves with free look');
  }
});

test('front exterior free look moves the viewing angle without yaw flips at the old speed threshold', () => {
  const f = fixture(4); f.vel.x = 5.999;
  for (let i = 0; i < 500; i++) f.update(); const before = f.camera.quaternion.clone();
  f.vel.x = 6.001; f.update(); assert.ok(before.angleTo(f.camera.quaternion) < .002);
  f.opts.mouseYaw = .7; for (let i = 0; i < 300; i++) f.update();
  assert.ok(Math.abs(f.camera.position.x) > 3); assertOutsideOwnBody(f);
});

test('bonnet falls back above the body when a close wall blocks its nose, with actual near corners clear', () => {
  const f = fixture(3), wall = new THREE.Box3(new THREE.Vector3(-20, 0, 2.95), new THREE.Vector3(20, 5, 3.2));
  f.opts.raycastWorld = rayWorld([wall]); f.update();
  assert.equal(f.rig.frontCameraClear, true); assert.ok(f.camera.position.y > spec.height + .2);
  assertOutsideOwnBody(f);
  for (const point of [f.camera.position, ...nearCorners(f.camera)]) assert.equal(wall.containsPoint(point), false);
});

test('bonnet rooftop fallback cannot point a steep downward mouse look into its own roof', () => {
  const f = fixture(3), wall = new THREE.Box3(new THREE.Vector3(-20, 0, 2.95), new THREE.Vector3(20, 5, 3.2));
  f.opts.raycastWorld = rayWorld([wall]); f.opts.mousePitch = -.55;
  for (let i = 0; i < 200; i++) f.update();
  assert.equal(f.rig.frontCameraClear, true); assertOutsideOwnBody(f);
  const localEye = f.camera.position.clone().sub(f.pos).applyQuaternion(f.quat.clone().invert());
  assert.ok(localEye.y > f.rig.frontBounds.maxY && Math.hypot(localEye.x, localEye.z) < .05, 'actual rooftop fallback is exercised');
  const localAim = forward(f.camera).applyQuaternion(f.quat.clone().invert());
  assert.ok(localAim.y >= -1e-8, 'accepted rooftop eye aims out of the roof face');
  assert.equal(new THREE.Ray(localEye, localAim).intersectBox(ownBody(f), new THREE.Vector3()), null);
});

test('front exterior pulls before a wall and under a roof without entering the truck or solids', () => {
  const f = fixture(4), boxes = [
    new THREE.Box3(new THREE.Vector3(-40, -1, -40), new THREE.Vector3(40, 0, 40)),
    new THREE.Box3(new THREE.Vector3(-40, 3.6, -40), new THREE.Vector3(40, 4, 40)),
    new THREE.Box3(new THREE.Vector3(-40, 0, 4.3), new THREE.Vector3(40, 4, 4.6)),
  ];
  f.opts.raycastWorld = rayWorld(boxes);
  for (let i = 0; i < 120; i++) {
    f.update(); assert.equal(f.rig.frontCameraClear, true); assertOutsideOwnBody(f);
    assert.ok(f.camera.position.z < 4.3 && f.camera.position.y < 3.6);
    for (const point of [f.camera.position, ...nearCorners(f.camera)])
      assert.ok(boxes.every(box => !box.containsPoint(point)), 'actual near corners are outside all authored boxes');
  }
});

test('new views protect actual near-plane corners on a larger truck, boosted FOV and portrait/ultrawide viewports', () => {
  for (const mode of [3, 4]) for (const aspect of [9 / 16, 16 / 9, 32 / 9]) {
    const f = fixture(mode); f.camera.aspect = aspect; f.camera.updateProjectionMatrix();
    f.opts.vehicleSpec = { width: 2.3, length: 6.2, height: 2.2,
      colliders: [{ center: [0, .95, 0], half: [1.12, .48, 3.1] }] };
    f.opts.restComHeight = .95; f.pos.y = .95; f.opts.fovBase = 100; f.opts.boosting = true; f.vel.z = 70;
    f.bodyBox = new THREE.Box3(new THREE.Vector3(-1.15, -.95, -3.1), new THREE.Vector3(1.15, 1.25, 3.1));
    const boxes = [new THREE.Box3(new THREE.Vector3(-40, 0, 5), new THREE.Vector3(40, 5, 5.3))];
    f.opts.raycastWorld = rayWorld(boxes);
    for (let i = 0; i < 600; i++) f.update();
    assert.equal(f.rig.frontCameraClear, true); assertOutsideOwnBody(f);
    for (const point of [f.camera.position, ...nearCorners(f.camera)])
      assert.ok(boxes.every(box => !box.containsPoint(point)), `actual near plane clears wall at aspect ${aspect}, mode ${mode}`);
    assert.ok(f.camera.fov > 97, 'high speed / nitro target is exercised');
  }
});

test('asymmetric authored model bounds and high roofs take precedence over centered spec dimensions', () => {
  for (const mode of [3, 4]) {
    const f = fixture(mode);
    f.opts.vehicleSpec = { ...spec, model: { bbox: { min: [-1.3, 0, -3], max: [1.3, 2.8, 4] } } };
    f.bodyBox = new THREE.Box3(new THREE.Vector3(-1.3, -.75, -3), new THREE.Vector3(1.3, 2.05, 4));
    f.update(); assert.equal(f.rig.frontCameraClear, true); assertOutsideOwnBody(f);
    assert.ok(f.camera.position.z > 4.2, 'camera clears the actual asymmetric nose, not half the spec length');
    f.opts.lookBack = true; f.update(); assertOutsideOwnBody(f);
    assert.ok(f.camera.position.z < -3.2, 'rear view also clears the actual tail');
  }
});

test('a fully enclosed truck reports the unresolved world state without accepting an own-body eye', () => {
  for (const mode of [3, 4]) {
    const f = fixture(mode); f.opts.raycastWorld = () => ({ t: 0 }); f.update();
    assert.equal(f.rig.frontCameraClear, false);
    assert.ok([...f.camera.position, ...f.camera.quaternion].every(Number.isFinite));
    assertOutsideOwnBody(f);
  }
});

test('default cockpit, held rear view and both old chase FOV/near targets remain intact', () => {
  const f = fixture(0);
  for (let i = 0; i < 600; i++) f.update(); assert.ok(Math.abs(f.camera.fov - 85) < .051); assert.equal(f.camera.near, .05);
  f.opts.lookBack = true; for (let i = 0; i < 600; i++) f.update(); assert.ok(Math.abs(f.camera.fov - 78) < .051);
  for (const mode of [1, 2]) { f.rig.mode = mode; f.opts.lookBack = false; for (let i = 0; i < 600; i++) f.update();
    assert.ok(Math.abs(f.camera.fov - 66) < .051); assert.equal(f.camera.near, .15); }
});

test('Run supplies live authored body bounds, COM, installed view, world ray and exact floor origin to new views', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: {} });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  const f = fixture(3), calls = [], floors = [], view = { root: new THREE.Group() }; let received;
  const run = Object.assign(Object.create(Run.prototype), { role: 'driver', simState: 'run', introDone: true,
    g: { camera: f.camera, driverFovBase: 85 }, states: new Map(), camDir: new THREE.Vector3(),
    chase: { mode: 3, update(_dt, _pos, _quat, _vel, options) { received = options; } },
    playerId: 1, wv: { cars: new Map([[1, { view }]]) },
    _cockpitEye() { assert.fail('new exterior cameras must not require an old animated eye'); },
    _worldRay(o, d, max) { calls.push([o, d, max]); return { t: 2 }; },
    _groundY(x, y, z) { floors.push([x, y, z]); return .8; },
  });
  run._camera(dt, { driver: {} }, { spec, ride: { restComHeight: .75 }, pos: f.pos, quat: f.quat, vel: f.vel });
  assert.equal(received.vehicleSpec, spec); assert.equal(received.restComHeight, .75);
  assert.equal(received.vehicleView, view); assert.equal(received.cockpitEye, null);
  const origin = new THREE.Vector3(), direction = new THREE.Vector3(0, 0, 1);
  assert.deepEqual(received.raycastWorld(origin, direction, 5), { t: 2 }); assert.deepEqual(calls, [[origin, direction, 5]]);
  assert.equal(received.groundY(12, 5, -7), .8); assert.deepEqual(floors, [[12, 1, -7]]);
});

test('front exterior frames the complete asymmetric truck body across viewport shapes, free look and speed FOV', () => {
  for (const aspect of [9 / 16, 16 / 9, 32 / 9]) for (const worldZ of [0, 50000]) {
    const f = fixture(4, worldZ); f.camera.aspect = aspect; f.camera.updateProjectionMatrix();
    f.opts.vehicleSpec = { ...spec, model: { bbox: { min: [-1.5, 0, -3], max: [1.2, 2.8, 4] } } };
    f.opts.boosting = true; f.vel.z = 70;
    for (const mouseYaw of [-2.3, 0, 2.3]) for (const mousePitch of [-.55, .45]) {
      Object.assign(f.opts, { mouseYaw, mousePitch });
      for (let i = 0; i < 500; i++) f.update();
      f.camera.updateMatrixWorld(true);
      for (const x of [-1.5, 1.2]) for (const y of [-.75, 2.05]) for (const z of [-3, 4]) {
        const point = new THREE.Vector3(x, y, z).applyQuaternion(f.quat).add(f.pos).project(f.camera);
        assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && point.z > -1 && point.z < 1,
          `actual authored corner remains in the frustum, aspect ${aspect}, aim ${mouseYaw}/${mousePitch}`);
      }
    }
  }
});

test('new free-look aims and offsets evolve continuously through actual Input mouse/RS command transforms', () => {
  for (const mode of [3, 4]) {
    const f = fixture(mode); for (let i = 0; i < 500; i++) f.update();
    const input = Object.assign(Object.create(Input.prototype), { bindings: DEFAULT_BINDINGS,
      keys: new Set(), pressed: new Set(), padEdge: new Array(20).fill(false),
      locked: true, mouseDX: 0, mouseDY: 0, sens: { mouse: .0022 }, steerSmooth: 0,
      pad: { axes: [0, 0, 0, 0], buttons: Array.from({ length: 20 }, () => ({ pressed: false, value: 0 })) } });
    let previousQuat = f.camera.quaternion.clone(), previousEye = f.camera.position.clone();
    for (let i = 1; i <= 1200; i++) {
      input.mouseDX = 4 * Math.cos(i * .02); input.mouseDY = 2 * Math.sin(i * .02);
      input.pad.axes[2] = .5 * Math.sin(i * .002); input.pad.axes[3] = .3 * Math.cos(i * .002);
      Object.assign(f.opts, input.driver(dt));
      f.update();
      assert.ok(previousQuat.angleTo(f.camera.quaternion) < .04, `mode ${mode} free look has no angle snap`);
      assert.ok(previousEye.distanceTo(f.camera.position) < .2, `mode ${mode} attached eye has no jump`);
      previousQuat.copy(f.camera.quaternion); previousEye.copy(f.camera.position);
    }
  }
});

test('holding and releasing a new-view rear cut preserves live nonzero mouse/stick free look', () => {
  for (const mode of [3, 4]) {
    const f = fixture(mode); Object.assign(f.opts, { mouseYaw: .7, mousePitch: -.2, lookX: .2 });
    for (let i = 0; i < 600; i++) f.update();
    const eye = f.camera.position.clone(), aim = f.camera.quaternion.clone(), yaw = f.rig.lookYaw, pitch = f.rig.lookPitch;
    f.opts.lookBack = true; for (let i = 0; i < 120; i++) f.update();
    assert.ok(f.camera.position.z < f.pos.z - 2.8, 'held rear cut uses the back of this current car');
    assert.ok(Math.abs(f.rig.lookYaw - yaw) < 1e-8 && Math.abs(f.rig.lookPitch - pitch) < 1e-8,
      'held rear-view output does not reset the ongoing free-look filters');
    f.opts.lookBack = false; f.update();
    assert.ok(f.camera.position.distanceTo(eye) < 1e-8 && f.camera.quaternion.angleTo(aim) < 1e-7,
      'release returns to the live filtered view in one frame');
  }
});

test('installed upgrade and stage-trim meshes expand current body bounds in the exact ground frame', () => {
  const root = new THREE.Group(); root.position.set(5, 2, 50000); root.rotation.y = .8;
  const anchor = new THREE.Group(); anchor.position.set(.9, .7, .1); root.add(anchor);
  const spike = new THREE.Mesh(new THREE.BoxGeometry(.5, .3, .4)); spike.position.set(.5, 0, 0); spike.geometry.computeBoundingBox(); anchor.add(spike);
  const mine = new THREE.Mesh(new THREE.BoxGeometry(.6, .4, .8)); mine.position.set(-.5, .55, -3.1); mine.geometry.computeBoundingBox(); root.add(mine);
  const view = { root, upgradeKit: { records: [{ mesh: spike, released: false }] }, stageTrim: { records: [{ mesh: mine, released: false }] } };
  const b = driverBodyBounds(spec, .75, {}, view);
  assert.ok(b.maxX >= 1.65 - 1e-8 && b.minZ <= -3.5 + 1e-8, 'rotated root does not distort authored attached bounds');
  assert.ok(b.minY <= .35 - .75 && b.maxY >= .85 - .75, 'upgrade coordinates subtract COM exactly once');
  spike.removeFromParent(); const after = driverBodyBounds(spec, .75, {}, view);
  assert.equal(after.maxX, 1, 'detached upgrade is no longer a car-owned bound');
  spike.geometry.dispose(); mine.geometry.dispose();
});

test('front bounds refresh on actual kit replacement and remain cached during translation', () => {
  const f = fixture(3), root = new THREE.Group(), view = { root, upgradeKey: 'none', upgradeKit: { records: [] } };
  f.opts.vehicleView = view; f.update(); const initial = f.camera.position.z;
  const ram = new THREE.Mesh(new THREE.BoxGeometry(2, .3, .5)); ram.position.set(0, .65, 4); ram.geometry.computeBoundingBox(); root.add(ram);
  view.upgradeKit.records.push({ mesh: ram, released: false }); view.upgradeKey = 'ram3'; f.update();
  assert.ok(f.camera.position.z > initial + 1, 'new bought geometry changes the real eye');
  const offset = f.camera.position.clone().sub(f.pos); f.pos.z += 50000; f.update();
  assert.ok(f.camera.position.clone().sub(f.pos).distanceTo(offset) < 1e-8);
  ram.geometry.dispose();
});

test('sampled slope clearance raises the accepted eye and rechecks the new segment', () => {
  const b = driverBodyBounds(spec, .75), pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  const desired = new THREE.Vector3(0, .1, 4), pivot = new THREE.Vector3(0, .2, 0), out = new THREE.Vector3();
  const rays = [], floors = [], radius = .3;
  const ok = limitDriverCamera(out, desired, pivot, pos, quat, b, radius,
    (origin, direction, max) => { rays.push([origin.clone(), direction.clone(), max]); return null; },
    (x, originY, z) => { floors.push([x, originY, z]); return .1 + z * .05; });
  assert.equal(ok, true); assert.ok(out.y >= .1 + (out.z + radius) * .05 + radius + .02 - 1e-8);
  assert.ok(rays.length > 9 && rays.at(-1)[1].y > rays[0][1].y, 'floor-lifted segment is actually queried again');
  assert.ok(floors.some(([x, , z]) => x !== 0 && z !== out.z), 'floor is sampled under near-volume corners');
});

test('a floor/ceiling conflict stays rejected after a bounded number of correction passes', () => {
  const b = driverBodyBounds(spec, .75), out = new THREE.Vector3(); let rays = 0, floors = 0;
  const accepted = limitDriverCamera(out, new THREE.Vector3(0, .1, 4), new THREE.Vector3(0, .2, 0),
    new THREE.Vector3(), new THREE.Quaternion(), b, .3,
    () => { rays++; return null; },
    (_x, originY) => { floors++; return originY + .2; });
  assert.equal(accepted, false, 'an unsettled lifted point is never marked clear');
  assert.ok(rays <= 27 && floors <= 15, 'one candidate cannot create an unbounded floor loop');
});

test('retained clear points are revalidated against new obstacles without caching a world-space eye', () => {
  const f = fixture(4); f.update(); assert.equal(f.rig.frontCameraClear, true);
  const previous = f.rig.frontLast.clone(); f.pos.z += 50000; let rays = 0;
  f.opts.raycastWorld = () => { rays++; return { t: 0 }; }; f.update();
  assert.equal(f.rig.frontCameraClear, false, 'a historical safe point cannot bypass current obstruction');
  assert.ok(rays <= 162 && rays >= 18); assert.ok(f.camera.position.z > 49000, 'failed clearance cannot retain an old-origin position');
  assert.deepEqual(f.rig.frontLast.toArray(), previous.toArray(), 'a rejected sample does not overwrite the last clear local point');
});

test('new exterior view refuses a roof-pulled zenith eye even outside the own-body box', () => {
  const b = driverBodyBounds(spec, .75), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), out = new THREE.Vector3();
  const accepted = limitDriverCamera(out, new THREE.Vector3(0, 5, .01), new THREE.Vector3(0, .2, 0),
    pos, quat, b, .4, undefined, undefined, 1.48);
  assert.equal(accepted, false, 'being above the roof does not make an exterior lookAt pole usable');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fx } from '../src/view/fx.js';
import { ScenePass } from '../src/view/post/scene_pass.js';

function fixture(camera) {
  const scene = new THREE.Scene(), rig = new THREE.Group(), weapon = new THREE.Group(), grip = new THREE.Group();
  scene.add(rig); rig.add(camera); camera.add(weapon); weapon.add(grip);
  const idle = () => {}, pool = () => ({ alive: 0, live: 0, hw: 0, update: idle });
  const fx = Object.assign(Object.create(Fx.prototype), {
    loaded: true, camera, time: 0, frame: 0, camPos: new THREE.Vector3(), frustum: new THREE.Frustum(),
    _lightT: Infinity, _own: null, keyGain: 1, viewH: 1440, _carMs: 0, stats: { ms: 0, carMs: 0 },
    U: { uTime: { value: 0 }, uKeyCol: { value: new THREE.Vector3() }, uPix: { value: 0 } }, timeU: { value: 0 },
    _runJobs: idle, _updateRockets: idle, _updateTracked: idle, _updateImpacts: idle,
    boss: pool(), haz: pool(), chunks: pool(), plates: pool(), casings: pool(), grenades: pool(),
    lights: [], pa: pool(), pf: pool(), skid: pool(),
  });
  const pass = new ScenePass(scene, camera), renderer = { setRenderTarget: idle, clear: idle, render: s => s.updateMatrixWorld() };
  let walks = 0; const update = grip.updateMatrixWorld;
  grip.updateMatrixWorld = function(...args) { walks++; return update.apply(this, args); };
  return { scene, rig, camera, weapon, grip, fx, pass, render: () => pass.render(renderer, {}), walks: () => walks };
}

for (const type of ['perspective', 'orthographic']) test(`FX camera positions and culling stay exact for moving ${type} cameras without another weapon walk`, () => {
  const f = fixture(type === 'perspective' ? new THREE.PerspectiveCamera(66, 16 / 9, 0.15, 9000) : new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.15, 9000));
  const pos = new THREE.Vector3(), pv = new THREE.Matrix4(), expected = new THREE.Frustum(), point = new THREE.Vector3();
  for (let frame = 0; frame < 360; frame++) {
    f.rig.position.set(Math.sin(frame / 13) * 70, 2 + Math.sin(frame / 19), frame * 0.5);
    f.rig.rotation.set(frame / 331, frame / 39, Math.cos(frame / 41) * 0.12);
    // Keep the legacy culling inverse, including scaled parents. Three's
    // camera view inverse intentionally excludes scale and is not equivalent.
    f.rig.scale.set(1 + frame % 3 * 0.1, 1 + frame % 5 * 0.04, 1 + frame % 7 * 0.03);
    f.camera.position.set(1 + Math.sin(frame / 17), 1.7, 3);
    f.camera.rotation.set(Math.sin(frame / 11) * 0.3, Math.cos(frame / 23) * 0.2, 0);
    f.weapon.position.set(0.5, -0.3, -0.8); f.grip.rotation.x = frame / 43;
    f.render(); const before = f.walks();
    // Original FX coordinates/culling after the main scene rendered.
    f.camera.getWorldPosition(pos);
    pv.multiplyMatrices(f.camera.projectionMatrix, f.camera.matrixWorld.clone().invert());
    expected.setFromProjectionMatrix(pv);
    const weaponWorld = f.weapon.matrixWorld.clone(), gripWorld = f.grip.matrixWorld.clone();
    f.fx.update(1 / 60);
    assert.deepEqual(f.fx.camPos.toArray(), pos.toArray());
    for (let i = 0; i < 6; i++) {
      assert.deepEqual(f.fx.frustum.planes[i].normal.toArray(), expected.planes[i].normal.toArray());
      assert.equal(f.fx.frustum.planes[i].constant, expected.planes[i].constant);
    }
    for (let i = 0; i < 12; i++) {
      point.set(pos.x + (i - 6) * 4, pos.y + (i % 3 - 1) * 4, pos.z - i * 8);
      assert.equal(f.fx.frustum.containsPoint(point), expected.containsPoint(point));
    }
    assert.equal(f.walks(), before);
    assert.ok(f.weapon.matrixWorld.equals(weaponWorld)); assert.ok(f.grip.matrixWorld.equals(gripWorld));
  }
});

test('ScenePass still updates changed attached weapon transforms on the following render', () => {
  const f = fixture(new THREE.PerspectiveCamera());
  f.rig.position.set(3, 2, 1); f.camera.position.set(1, 0, 4); f.weapon.position.set(0, -1, -2); f.grip.position.x = 5;
  f.render(); assert.equal(f.walks(), 1);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(f.grip.matrixWorld).toArray(), [9, 1, 3]);
  f.fx.update(1 / 60); assert.equal(f.walks(), 1);
  f.camera.position.z = 6; f.grip.position.x = 7;
  f.render(); assert.equal(f.walks(), 2);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(f.grip.matrixWorld).toArray(), [11, 1, 5]);
  f.fx.update(1 / 60); assert.equal(f.walks(), 2);
});

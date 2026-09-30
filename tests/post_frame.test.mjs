import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Post } from '../src/view/post.js';

test('post camera preparation skips attached viewmodel traversal until the scene render', () => {
  const scene = new THREE.Scene(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  scene.add(rig); rig.add(camera); rig.position.set(3, 2, 1); camera.position.set(1, 0, 4);
  const model = new THREE.Group(), child = new THREE.Group(); camera.add(model); model.add(child); child.position.x = 5;
  let childWalks = 0; const update = child.updateMatrixWorld;
  child.updateMatrixWorld = function(...args) { childWalks++; return update.apply(this, args); };
  const post = Object.assign(Object.create(Post.prototype), {
    _enabled: true, renderer: {}, camera, scene, _time: 0, _frame: 0, _clockLast: 0, _profiling: false, _taa: false,
    _vp: new THREE.Matrix4(), _prevVP: new THREE.Matrix4(), _prevPos: new THREE.Vector3(), _updateState() {},
    _updateUniforms() {
      assert.equal(childWalks, 0);
      assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld).toArray(), [4, 2, 5]);
      assert.ok(camera.matrixWorldInverse.equals(camera.matrixWorld.clone().invert()));
    },
    composer: { render() {
      scene.updateMatrixWorld(); assert.equal(childWalks, 1);
      assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(child.matrixWorld).toArray(), [9, 2, 5]);
    } },
  });
  post.render(1 / 60); assert.equal(childWalks, 1);
});

for (const type of [THREE.HalfFloatType, THREE.UnsignedByteType]) test(`AO prewarm allocates the real input color precision (${type}) without first-frame mutation`, () => {
  const input = new THREE.WebGLRenderTarget(16, 16, { type });
  const post = Object.assign(Object.create(Post.prototype), {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), _internal: new THREE.Vector2(16, 16),
    composer: { inputBuffer: input, addPass() {} },
    dofPass: { fullscreenMaterial: {} }, mainPass: { fullscreenMaterial: {} },
    smaaPass: { fullscreenMaterial: {} }, finalPass: { fullscreenMaterial: {} },
  });
  post._ensureAO(); const ao = post.aoPass, output = new THREE.WebGLRenderTarget(16, 16, { type });
  assert.equal(ao.outputTargetInternal.texture.type, type);
  assert.equal(ao.outputTargetInternal.texture.format, input.texture.format);
  const allocations = new Map();
  const allocate = target => { if (target && !allocations.has(target)) allocations.set(target, { type: target.texture.type, format: target.texture.format }); };
  // Model Three's one-time framebuffer initialization during loading. A later
  // texture.needsUpdate cannot change this render target's immutable storage.
  allocate(ao.outputTargetInternal); const version = ao.outputTargetInternal.texture.version;
  const renderer = { capabilities: {}, xr: { enabled: false }, autoClear: false, setRenderTarget: allocate, clear() {}, render() {} };
  ao.render(renderer, input, output, 1 / 60);
  assert.equal(allocations.get(ao.outputTargetInternal).type, input.texture.type);
  assert.equal(ao.outputTargetInternal.texture.version, version);
  ao.dispose(); input.dispose(); output.dispose();
});

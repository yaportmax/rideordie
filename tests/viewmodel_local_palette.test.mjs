import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeaponAssets, THREE, Assets } from './helpers/weapon-assets.mjs';
import { ViewModel, FP_ARMS_URL, VMU, BAND } from '../src/view/viewmodel.js';
import { WEAPONS } from '../src/data/weapons.js';

await loadWeaponAssets();
const collect = root => { const out = []; root.traverse(o => { if (o.isSkinnedMesh) out.push(o); }); return out; };
const source = collect(Assets.template(FP_ARMS_URL))[0];

function fixture(t, id = 'pistol', pose = 'hip') {
  const oldWindow = globalThis.window;
  globalThis.window = {};
  t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture());
  const vm = new ViewModel(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 16 / 9, .01, 200);
  scene.add(camera); camera.add(vm.root);
  const gunner = { weaponId: id, weapon: WEAPONS[id], slots: [id], shots: 0, pos: new THREE.Vector3(), magNow: 0,
    trigger: false, swapT: 0, throwing: 0, reloading: pose === 'reload', reloadT: pose === 'reload' ? WEAPONS[id].reload * .55 : 0 };
  const state = { local: { camera, gunner, adsK: pose === 'ads' ? 1 : 0 }, vel: new THREE.Vector3() };
  vm.relAmt = pose === 'reload' ? 1 : 0;
  vm.update(0, state, true); scene.updateMatrixWorld(true);
  t.after(() => { vm.dispose(); if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  return { vm, scene, camera };
}

function multiply(matrix, vector, offset = 0, rounded = false) {
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    const product = matrix[offset + column * 4 + row] * vector[column];
    out[row] = rounded ? Math.fround(out[row] + Math.fround(product)) : out[row] + product;
  }
  return out;
}
// Preserve all four authored influences and homogeneous w. This estimates
// float GPU arithmetic, while the separate native collector proves pixels.
function skin(mesh, palette, index, local, rounded = false) {
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  let point = [position.getX(index), position.getY(index), position.getZ(index), 1];
  if (rounded) point = point.map(Math.fround);
  if (!local) point = multiply(rounded ? new Float32Array(mesh.bindMatrix.elements) : mesh.bindMatrix.elements, point, 0, rounded);
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const bone = multiply(palette, point, skinIndex.getComponent(index, k) * 16, rounded);
    const weight = rounded ? Math.fround(skinWeight.getComponent(index, k)) : skinWeight.getComponent(index, k);
    for (let a = 0; a < 4; a++) out[a] = rounded ? Math.fround(out[a] + Math.fround(bone[a] * weight)) : out[a] + bone[a] * weight;
  }
  return new THREE.Vector3(...(local ? out : multiply(rounded ? new Float32Array(mesh.bindMatrixInverse.elements) : mesh.bindMatrixInverse.elements, out, 0, rounded)).slice(0, 3));
}

for (const id of ['pistol', 'smg', 'rifle']) for (const pose of ['hip', 'ads', 'reload']) {
  test(`${id} ${pose}: actual dedicated FP palette retains authored skin/cuff vertices at origin and71km`, t => {
    const { vm, scene, camera } = fixture(t, id, pose), mesh = vm.arms, skeleton = mesh.skeleton;
    assert.equal(vm.dedicatedArms, true); assert.equal(mesh.geometry, source.geometry, 'no cuff/skin triangles are hidden or deformed to disguise the error');
    const points = new Map(), selected = [];
    for (let i = 0; i < mesh.geometry.attributes.position.count; i += 47) selected.push(i);
    let originalFarError = 0;
    for (const z of [0, 40, 71060, 120000]) {
      camera.position.set(844, 321.7, z); scene.updateMatrixWorld(true);
      const bones = skeleton.bones.map(b => b.matrixWorld.elements.slice()), bind = mesh.bindMatrix.elements.slice(), inverse = mesh.bindMatrixInverse.elements.slice();
      const socketFrames = ['socket_hand_R', 'socket_hand_L'].map(n => ({ p: vm.B[n].getWorldPosition(new THREE.Vector3()), q: vm.B[n].getWorldQuaternion(new THREE.Quaternion()) }));
      const exact = new Float64Array(skeleton.bones.length * 16), ordinary = new Float32Array(exact.length), matrix = new THREE.Matrix4();
      for (let i = 0; i < skeleton.bones.length; i++) matrix.multiplyMatrices(skeleton.bones[i].matrixWorld, skeleton.boneInverses[i]).toArray(exact, i * 16);
      THREE.Skeleton.prototype.update.call({ bones: skeleton.bones, boneInverses: skeleton.boneInverses, boneMatrices: ordinary, boneTexture: null });
      skeleton.update();
      assert.deepEqual(skeleton.bones.map(b => b.matrixWorld.elements), bones); assert.deepEqual(mesh.bindMatrix.elements, bind); assert.deepEqual(mesh.bindMatrixInverse.elements, inverse);
      for (let i = 0; i < socketFrames.length; i++) {
        const node = vm.B[['socket_hand_R', 'socket_hand_L'][i]];
        assert.deepEqual(node.getWorldPosition(new THREE.Vector3()), socketFrames[i].p); assert.deepEqual(node.getWorldQuaternion(new THREE.Quaternion()), socketFrames[i].q);
      }
      for (const index of selected) {
        const expected = skin(mesh, exact, index, false), actual = skin(mesh, skeleton.boneMatrices, index, true, true);
        assert.ok(expected.distanceTo(actual) < 2e-6, `${id}/${pose}/${z}/${index}: local palette error stays below0.002mm`);
        const cpu = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index); mesh.applyBoneTransform(index, cpu);
        assert.ok(cpu.distanceTo(expected) < 1e-8, 'CPU skin/raycast/bounds equation remains ordinary double precision');
        if (z === 0) points.set(index, expected);
        else assert.ok(expected.distanceTo(points.get(index)) < 1e-8, 'frozen mesh-local pose is translation invariant');
        if (z === 71060) originalFarError = Math.max(originalFarError, expected.distanceTo(skin(mesh, ordinary, index, false, true)));
      }
    }
    assert.ok(originalFarError > .003, `${id}/${pose}: control exposes a real far-world skin error instead of merely checking a changed implementation`);
    assert.equal(mesh.castShadow, false, 'FP arms retain their authored no-shadow role');
  });
}

test('dedicated FP color shader composes real local palette with existing viewmodel projection and depth band', t => {
  const { vm } = fixture(t), material = vm.arms.material, sourceHook = source.material.onBeforeCompile;
  assert.equal(material.customProgramCacheKey(), 'rod_viewmodel_1|rod_local_skin_v1');
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, null);
  assert.equal(shader.uniforms.vmProj, VMU.vmProj); assert.ok(shader.vertexShader.includes('gl_Position = vmProj * mvPosition'));
  assert.ok(shader.vertexShader.includes(`* ${BAND.toFixed(4)} - gl_Position.w`), 'projection still writes to its established near depth band');
  assert.ok(shader.vertexShader.includes('vec4 skinVertex = vec4( transformed, 1.0 )')); assert.ok(shader.vertexShader.includes('transformed = skinned.xyz'));
  assert.ok(!shader.vertexShader.includes('skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix'));
  assert.equal(source.material.onBeforeCompile, sourceHook); assert.notEqual(material, source.material);
});

test('dedicated replacement and sibling disposal own each real padded bone texture without editing shared asset data', async t => {
  const { vm } = fixture(t), sibling = new ViewModel(), old = vm.model;
  t.after(() => sibling.dispose());
  const attributes = new Map(Object.entries(source.geometry.attributes).map(([name, attr]) => [name, attr.array.slice()]));
  const templateMaterial = source.material, templateSkeleton = source.skeleton, siblingMesh = sibling.arms;
  const allocate = mesh => {
    mesh.skeleton.computeBoneTexture(); const texture = mesh.skeleton.boneTexture; let frees = 0;
    texture.addEventListener('dispose', () => frees++); return { skeleton: mesh.skeleton, texture, get frees() { return frees; } };
  };
  const first = allocate(vm.arms), peer = allocate(siblingMesh);
  const glb = await Assets.loadGLB(FP_ARMS_URL);
  assert.equal(vm._fpFrom(glb), true, 'normal asynchronous dedicated replacement follows the same preparation-before-registration path');
  assert.equal(first.frees, 1); assert.equal(first.skeleton.boneTexture, null); assert.equal(old.parent?.parent, null, 'old arm group is detached from the live VM');
  const replacement = allocate(vm.arms);
  assert.notEqual(vm.arms.skeleton, siblingMesh.skeleton); assert.equal(vm.arms.material, siblingMesh.material, 'bounded compiled material variant is reused across lives');
  vm.dispose(); vm.dispose();
  assert.equal(replacement.frees, 1); assert.equal(replacement.skeleton.boneTexture, null);
  assert.equal(peer.frees, 0); assert.equal(peer.skeleton.boneTexture, peer.texture);
  sibling.dispose(); sibling.dispose(); assert.equal(peer.frees, 1);
  assert.equal(source.material, templateMaterial); assert.equal(source.skeleton, templateSkeleton); assert.equal(source.skeleton.boneTexture, null);
  for (const [name, data] of attributes) assert.deepEqual(source.geometry.attributes[name].array, data, name + ': shared geometry/weights remain byte-identical');
});

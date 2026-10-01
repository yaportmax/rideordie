import test from 'node:test';
import assert from 'node:assert/strict';
import * as Assets from '../src/core/assets.js';
import { loadCrewAssets, THREE, CrewView, seeded } from './helpers/crew-assets.mjs';
import { CarView } from '../src/view/car_view.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { DriverArms } from '../src/view/driver_arms.js';
import { prepareLocalSkinning, localSkinningMaterial } from '../src/view/local_skinning.js';
import { ownClonedSkeletons, disposeOwnedSkeletons } from '../src/view/owned_skeletons.js';

await loadCrewAssets();
const collect = root => { const out = []; root.traverse(o => { if (o.isSkinnedMesh) out.push(o); }); return out; };
const sourceAttributes = new Map();
for (const url of ['/models/characters/hero_driver.glb', '/models/characters/fp_arms.glb']) {
  for (const mesh of collect(Assets.template(url))) for (const name of ['position', 'skinIndex', 'skinWeight']) {
    const attribute = mesh.geometry.attributes[name]; sourceAttributes.set(attribute, attribute.array.slice());
  }
}
function fixture() {
  return seeded(67, () => {
    const scene = new THREE.Scene(), car = new CarView(VEHICLES.truck_t1, { lod: false });
    const crew = new CrewView('hero_driver', { role: 'driver' });
    scene.add(car.root); car.root.add(crew.root); crew.attach(car, VEHICLES.truck_t1.seats.driver); crew._cutPrepared = true;
    return { scene, car, crew };
  });
}
function mul(matrix, vector, offset = 0, f32 = false) {
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const product = matrix[offset + col * 4 + row] * vector[col];
    out[row] = f32 ? Math.fround(out[row] + Math.fround(product)) : out[row] + product;
  }
  return out;
}
function skin(mesh, palette, index, local, f32 = false) {
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  let vertex = [position.getX(index), position.getY(index), position.getZ(index), 1];
  if (f32) vertex = vertex.map(Math.fround);
  if (!local) vertex = mul(f32 ? new Float32Array(mesh.bindMatrix.elements) : mesh.bindMatrix.elements, vertex, 0, f32);
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const p = mul(palette, vertex, skinIndex.getComponent(index, k) * 16, f32);
    const w = f32 ? Math.fround(skinWeight.getComponent(index, k)) : skinWeight.getComponent(index, k);
    for (let j = 0; j < 4; j++) out[j] = f32 ? Math.fround(out[j] + Math.fround(p[j] * w)) : out[j] + p[j] * w;
  }
  return new THREE.Vector3(...(local ? out : mul(f32 ? new Float32Array(mesh.bindMatrixInverse.elements) : mesh.bindMatrixInverse.elements, out, 0, f32)).slice(0, 3));
}
function palettes(mesh) {
  const skeleton = mesh.skeleton, n = skeleton.bones.length * 16, exact = new Float64Array(n), world = new Float32Array(n), matrix = new THREE.Matrix4();
  for (let i = 0; i < skeleton.bones.length; i++) matrix.multiplyMatrices(skeleton.bones[i].matrixWorld, skeleton.boneInverses[i]).toArray(exact, i * 16);
  THREE.Skeleton.prototype.update.call({ bones: skeleton.bones, boneInverses: skeleton.boneInverses, boneMatrices: world, boneTexture: null });
  skeleton.update(); return { exact, world, local: skeleton.boneMatrices };
}
function indices(mesh) {
  const sw = mesh.geometry.attributes.skinWeight, out = [];
  for (let i = 0; i < sw.count; i++) {
    const sum = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
    if (i % 47 === 0 || Math.abs(sum - 1) > 1e-6) out.push(i);
  }
  return out;
}

test('real neutral, steering and regrip driver poses retain homogeneous GPU skinning at 0,40,44000,60000m', () => {
  const f = fixture(), state = { alive: true, steer: 0, speed: 18, airborne: false, quat: new THREE.Quaternion(), vel: new THREE.Vector3(), local: { firstPerson: true, cockpit: { active: true }, gear: 1 } };
  const step = () => { f.crew.update(1 / 60, state); f.scene.updateMatrixWorld(true); };
  let checked = 0, worstOldFar = 0, regrip = false;
  try {
    for (let i = 0; i < 90; i++) step();
    for (const pose of ['neutral', 'steer', 'regrip']) {
      if (pose === 'steer') { state.steer = .22; for (let i = 0; i < 30; i++) step(); }
      if (pose === 'regrip') {
        state.steer = 1;
        for (let i = 0; i < 120; i++) {
          step();
          if (Object.values(f.crew.drvArms.side).some(side => side.mv > 0 && side.mv < 1)) { regrip = true; break; }
        }
        assert.ok(regrip, 'sample the actual production hand-over-hand transition');
      }
      const meshes = collect(f.crew.model).filter(mesh => mesh.name === 'body' || mesh.userData.fpArms);
      assert.equal(meshes.length, 2); const atOrigin = new Map();
      for (const z of [0, 40, 44000, 60000]) {
        f.car.root.position.z = z; f.scene.updateMatrixWorld(true);
        for (const mesh of meshes) {
          const cpuBefore = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0);
          mesh.applyBoneTransform(0, cpuBefore);
          const before = mesh.skeleton.bones.map(bone => bone.matrixWorld.elements.slice());
          const bind = mesh.bindMatrix.elements.slice(), inverse = mesh.bindMatrixInverse.elements.slice();
          const { exact, world, local } = palettes(mesh);
          assert.deepEqual(mesh.skeleton.bones.map(bone => bone.matrixWorld.elements), before, 'palette update leaves all CPU bones unchanged');
          assert.deepEqual(mesh.bindMatrix.elements, bind); assert.deepEqual(mesh.bindMatrixInverse.elements, inverse);
          const cpuAfter = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0); mesh.applyBoneTransform(0, cpuAfter);
          assert.deepEqual(cpuAfter, cpuBefore, 'CPU bounds/raycast vertex queries remain identical');
          for (const index of indices(mesh)) {
            const expected = skin(mesh, exact, index, false), gpu = skin(mesh, local, index, true, true);
            assert.ok(expected.distanceTo(gpu) < 2e-6, `${pose}/${mesh.name}/${z}/${index} local GPU error stays below0.002mm`);
            if (!z) { let origin = atOrigin.get(mesh); if (!origin) atOrigin.set(mesh, origin = new Map()); origin.set(index, expected); }
            else assert.ok(expected.distanceTo(atOrigin.get(mesh).get(index)) < 1e-8, 'pose remains translation invariant');
            if (z >= 44000) worstOldFar = Math.max(worstOldFar, expected.distanceTo(skin(mesh, world, index, false, true)));
            checked++;
          }
        }
      }
    }
    assert.ok(checked > 6000); assert.ok(worstOldFar > .005, 'fixture exposes the original centimetre-scale cancellation');
  } finally { f.crew.dispose(); f.car.dispose(); }
});

test('local variants preserve source options, callbacks, cache keys and matching color/normal/tangent/shadow equations', () => {
  const source = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest: .37, opacity: .8, transparent: true, side: THREE.DoubleSide });
  let called = 0;
  source.onBeforeCompile = function (shader, renderer) { called++; assert.equal(renderer, 'renderer'); shader.uniforms.sourceUniform = { value: 7 }; shader.vertexShader = '//preserved-source\n' + shader.vertexShader; };
  source.customProgramCacheKey = () => 'source-key-7';
  const before = source.onBeforeCompile, sourceKey = source.customProgramCacheKey;
  const local = localSkinningMaterial(source);
  assert.notEqual(local, source); assert.equal(localSkinningMaterial(source), local); assert.equal(localSkinningMaterial(local), local);
  assert.equal(local.map, source.map); assert.equal(local.alphaTest, .37); assert.equal(local.opacity, .8); assert.equal(local.transparent, true); assert.equal(local.side, THREE.DoubleSide);
  assert.equal(source.onBeforeCompile, before); assert.equal(source.customProgramCacheKey, sourceKey); assert.equal(source.customProgramCacheKey(), 'source-key-7');
  assert.equal(local.customProgramCacheKey(), 'source-key-7|rod_local_skin_v1');
  for (const shader of [THREE.ShaderLib.standard, THREE.ShaderLib.depth, THREE.ShaderLib.distance]) {
    const compiled = { uniforms: {}, vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader }; local.onBeforeCompile(compiled, 'renderer');
    assert.equal(compiled.uniforms.sourceUniform.value, 7); assert.ok(compiled.vertexShader.startsWith('//preserved-source'));
    assert.ok(compiled.vertexShader.includes('vec4 skinVertex = vec4( transformed, 1.0 )'));
    assert.ok(compiled.vertexShader.includes('transformed = skinned.xyz'));
    assert.ok(!compiled.vertexShader.includes('skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix'));
    if (shader === THREE.ShaderLib.standard) {
      assert.ok(compiled.vertexShader.includes('vec4( objectNormal, 0.0 )')); assert.ok(compiled.vertexShader.includes('vec4( objectTangent, 0.0 )'));
    }
  }
  assert.equal(called, 3);
});

test('actual shared skeletons with different binds split before ownership and leave ordinary siblings untouched', () => {
  const group = new THREE.Group(), bone = new THREE.Bone(); bone.position.set(3, 2, 60000); group.add(bone);
  const source = new THREE.Skeleton([bone], [new THREE.Matrix4().makeTranslation(0, 0, -60000)]), material = new THREE.MeshStandardMaterial();
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([.3, .5, -.2], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([.6, .4, 0, 0], 4));
  const meshes = [0, 1, 2].map(index => {
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = 'mesh' + index; mesh.skeleton = source; mesh.bindMode = THREE.DetachedBindMode;
    mesh.bindMatrix.makeRotationY(index * .4).setPosition(index, 0, 59995 + index); mesh.bindMatrixInverse.copy(mesh.bindMatrix).invert(); group.add(mesh); return mesh;
  });
  const customDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking }), customDistance = new THREE.MeshDistanceMaterial();
  customDepth.customProgramCacheKey = () => 'depth-source'; customDepth.onBeforeCompile = shader => { shader.uniforms.depthSource = { value: 9 }; };
  meshes[0].customDepthMaterial = customDepth; meshes[0].customDistanceMaterial = customDistance;
  group.updateMatrixWorld(true);
  const cpu = meshes.map(mesh => mesh.applyBoneTransform(0, new THREE.Vector3(.3, .5, -.2)).clone());
  prepareLocalSkinning(group, mesh => mesh !== meshes[2]); ownClonedSkeletons(group);
  assert.notEqual(meshes[0].skeleton, source); assert.notEqual(meshes[1].skeleton, source); assert.notEqual(meshes[0].skeleton, meshes[1].skeleton);
  assert.equal(meshes[2].skeleton, source); assert.equal(source.update, THREE.Skeleton.prototype.update); assert.equal(meshes[2].material, material);
  assert.equal(meshes[0].skeleton.boneInverses, source.boneInverses); assert.equal(meshes[0].skeleton.bones[0], bone);
  assert.equal(meshes[0].customDepthMaterial.depthPacking, THREE.BasicDepthPacking); assert.equal(meshes[0].customDepthMaterial.customProgramCacheKey(), 'depth-source|rod_local_skin_v1');
  const depthShader = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader }; meshes[0].customDepthMaterial.onBeforeCompile(depthShader);
  assert.equal(depthShader.uniforms.depthSource.value, 9); assert.notEqual(meshes[0].customDepthMaterial, customDepth); assert.notEqual(meshes[0].customDistanceMaterial, customDistance);
  let freed = 0;
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(meshes[i].applyBoneTransform(0, new THREE.Vector3(.3, .5, -.2)), cpu[i]);
    const skeleton = meshes[i].skeleton; skeleton.update(); const initial = skeleton.boneMatrices;
    skeleton.computeBoneTexture(); const padded = skeleton.boneMatrices; assert.notEqual(padded, initial);
    assert.equal(padded.length, 64); padded.fill(0); const version = skeleton.boneTexture.version; skeleton.update();
    assert.equal(skeleton.boneMatrices, padded); assert.ok(skeleton.boneTexture.version > version); assert.ok(padded.subarray(16).every(value => value === 0));
    if (i < 2) assert.ok(skin(meshes[i], palettes(meshes[i]).exact, 0, false).distanceTo(skin(meshes[i], padded, 0, true)) < 2e-6);
    skeleton.boneTexture.addEventListener('dispose', () => freed++);
  }
  meshes[0].removeFromParent(); assert.equal(disposeOwnedSkeletons(group), 3); assert.equal(freed, 3); assert.equal(disposeOwnedSkeletons(group), 0);
  assert.equal(customDepth.onBeforeCompile.toString().includes('depthSource'), true); assert.equal(customDepth.customProgramCacheKey(), 'depth-source');
});

test('fresh-clone preparation is atomic/idempotent and its updates allocate no matrices or graph traversals', t => {
  const root = Assets.clone('/models/characters/fp_arms.glb'), mesh = collect(root)[0];
  mesh.skeleton.computeBoneTexture(); const original = mesh.skeleton, material = mesh.material;
  assert.throws(() => prepareLocalSkinning(root), /fresh untextured clone/); assert.equal(mesh.skeleton, original); assert.equal(mesh.material, material);
  original.dispose();
  prepareLocalSkinning(root); ownClonedSkeletons(root);
  const skeleton = mesh.skeleton, update = skeleton.update, variant = mesh.material;
  prepareLocalSkinning(root); assert.equal(mesh.skeleton, skeleton); assert.equal(skeleton.update, update); assert.equal(mesh.material, variant);
  root.updateMatrixWorld(true); const palette = skeleton.boneMatrices;
  t.mock.method(root, 'traverse', () => { throw Error('No per-frame traversal'); });
  t.mock.method(mesh, 'updateMatrixWorld', () => { throw Error('No extra world traversal'); });
  t.mock.method(THREE.Matrix4.prototype, 'clone', () => { throw Error('No per-frame matrix clone'); });
  for (let frame = 0; frame < 100; frame++) skeleton.update();
  assert.equal(skeleton.boneMatrices, palette); disposeOwnedSkeletons(root);
});

test('default shadow variants isolate different source texture states and reject incompatible groups atomically', () => {
  const a = Assets.clone('/models/characters/fp_arms.glb'), b = Assets.clone('/models/characters/fp_arms.glb');
  const ma = collect(a)[0], mb = collect(b)[0], same = ma.material;
  const map = new THREE.Texture(); mb.material = same.clone(); mb.material.map = map; mb.material.alphaTest = .4;
  prepareLocalSkinning(a); prepareLocalSkinning(b); ownClonedSkeletons(a); ownClonedSkeletons(b);
  assert.notEqual(ma.customDepthMaterial, mb.customDepthMaterial); assert.notEqual(ma.customDistanceMaterial, mb.customDistanceMaterial);
  assert.equal(mb.material.map, map); assert.equal(mb.material.alphaTest, .4);
  const c = Assets.clone('/models/characters/fp_arms.glb'), mc = collect(c)[0], sourceSkeleton = mc.skeleton;
  mc.material = [same, same.clone()]; mc.material[1].alphaTest = .5;
  assert.throws(() => prepareLocalSkinning(c), /compatible shadow state/); assert.equal(mc.skeleton, sourceSkeleton); assert.equal(mc.customDepthMaterial, undefined);
  mc.material[1].alphaTest = same.alphaTest; prepareLocalSkinning(c); ownClonedSkeletons(c);
  assert.ok(Array.isArray(mc.material)); assert.equal(mc.material[0], ma.material);
  disposeOwnedSkeletons(a); disposeOwnedSkeletons(b); disposeOwnedSkeletons(c);
});

test('runtime, warm, shadow-only and sibling/template rigs keep their scope and exact texture ownership', () => {
  const warm = DriverArms.warmObject(), warmMesh = collect(warm)[0], f = fixture();
  const state = { alive: true, steer: .2, speed: 18, airborne: false, quat: new THREE.Quaternion(), vel: new THREE.Vector3(), local: { firstPerson: true, cockpit: { active: true }, gear: 1 } };
  try {
    f.crew.update(1 / 60, state); f.scene.updateMatrixWorld(true);
    const all = collect(f.crew.model), body = all.find(mesh => mesh.name === 'body'), arms = all.find(mesh => mesh.userData.fpArms);
    assert.equal(arms.material, warmMesh.material); assert.equal(arms.skeleton.update === THREE.Skeleton.prototype.update, false);
    for (const mesh of all.filter(mesh => mesh.name === 'hair' || mesh.name === 'eyes')) assert.equal(mesh.skeleton.update, THREE.Skeleton.prototype.update);
    f.crew._setShadowOnly(false); const visibleMaterial = body.material;
    f.crew._setShadowOnly(true); assert.equal(body.material.colorWrite, false); assert.equal(body.material.depthWrite, false);
    assert.equal(body.material.onBeforeCompile, visibleMaterial.onBeforeCompile); assert.equal(body.material.customProgramCacheKey(), visibleMaterial.customProgramCacheKey());
    f.crew._setShadowOnly(false); assert.equal(body.material, visibleMaterial);
    const sibling = Assets.clone('/models/characters/hero_driver.glb'), templates = [Assets.template('/models/characters/hero_driver.glb'), Assets.template('/models/characters/fp_arms.glb')];
    for (const root of [...templates, sibling]) for (const mesh of collect(root)) assert.equal(mesh.skeleton.update, THREE.Skeleton.prototype.update);
    for (const [attribute, original] of sourceAttributes) assert.deepEqual(attribute.array, original, 'authored source positions, indices and quantized skin weights stay byte-identical');
    const rigSkeletons = new Set([...all.map(mesh => mesh.skeleton), warmMesh.skeleton]); let freed = 0, sharedFreed = 0;
    for (const skeleton of rigSkeletons) { skeleton.computeBoneTexture(); skeleton.boneTexture.addEventListener('dispose', () => freed++); }
    for (const root of templates) for (const mesh of collect(root)) mesh.material.addEventListener('dispose', () => sharedFreed++);
    const socket = f.crew.bones.socket_hand_R.getWorldPosition(new THREE.Vector3());
    for (const mesh of all) mesh.skeleton.update(); assert.deepEqual(f.crew.bones.socket_hand_R.getWorldPosition(new THREE.Vector3()), socket);
    f.crew.dispose(); f.crew.dispose(); disposeOwnedSkeletons(warm); disposeOwnedSkeletons(warm);
    assert.equal(freed, rigSkeletons.size); assert.equal(sharedFreed, 0); for (const skeleton of rigSkeletons) assert.equal(skeleton.boneTexture, null);
  } finally { f.crew.dispose(); disposeOwnedSkeletons(warm); f.car.dispose(); }
});

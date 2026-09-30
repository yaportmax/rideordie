import test from 'node:test';
import assert from 'node:assert/strict';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as Assets from '../src/core/assets.js';
import { loadCrewAssets, THREE } from './helpers/crew-assets.mjs';

await loadCrewAssets();
const rigidUrls = ['/models/vehicles/truck_t1.glb', ...['pistol', 'smg', 'shotgun', 'rifle'].map(id => `/models/weapons/${id}.glb`)];
function nodes(root) { const all = []; root.traverse(o => all.push(o)); return all; }
function state(root) {
  return nodes(root).map(o => ({ name: o.name, type: o.type, children: o.children.map(c => c.name),
    position: o.position.toArray(), quaternion: o.quaternion.toArray(), scale: o.scale.toArray(),
    matrix: o.matrix.toArray(), world: o.matrixWorld.toArray(), order: o.rotation.order,
    visible: o.visible, castShadow: o.castShadow, receiveShadow: o.receiveShadow,
    frustumCulled: o.frustumCulled, layers: o.layers.mask, renderOrder: o.renderOrder,
    matrixAutoUpdate: o.matrixAutoUpdate, matrixWorldAutoUpdate: o.matrixWorldAutoUpdate,
    userData: JSON.parse(JSON.stringify(o.userData)), morphs: o.morphTargetInfluences?.slice(),
  }));
}

test('actual prepared rigid GLBs preserve the SkeletonUtils graph/resource contract and independent mechanics', () => {
  for (const url of rigidUrls) {
    const template = Assets.template(url), original = state(template);
    const baseline = SkeletonUtils.clone(template), clone = Assets.clone(url), sibling = Assets.clone(url);
    assert.deepEqual(state(clone), state(baseline), url);
    assert.equal(clone.animations, Assets.getAnimations(url));
    const sourceNodes = nodes(template), cloneNodes = nodes(clone), siblingNodes = nodes(sibling);
    assert.equal(cloneNodes.length, sourceNodes.length);
    sourceNodes.forEach((source, i) => {
      const copy = cloneNodes[i];
      assert.notEqual(copy, source); assert.notEqual(copy, siblingNodes[i]);
      for (const key of ['position', 'quaternion', 'scale', 'matrix', 'matrixWorld', 'userData']) assert.notEqual(copy[key], source[key]);
      if (source.isMesh) {
        assert.equal(copy.geometry, source.geometry);
        if (Array.isArray(source.material)) { assert.notEqual(copy.material, source.material); copy.material.forEach((m, j) => assert.equal(m, source.material[j])); }
        else assert.equal(copy.material, source.material);
      }
    });
    // Real authored pivots survive both prepared body merging and cloning.
    const pivot = cloneNodes.find(o => /^(panel_|wheel_|slide$|bolt$|pump$)/.test(o.name));
    assert.ok(pivot, url); pivot.position.x += .2; pivot.rotation.y += .3; pivot.visible = false;
    pivot.userData.cloneProbe = { changed: true }; pivot.removeFromParent();
    assert.deepEqual(state(template), original, `${url}: blueprint untouched`);
    assert.deepEqual(state(sibling), original, `${url}: sibling untouched`);
  }
});

test('repeated rigid cloning does no skeleton-remapping traversal after template classification', t => {
  for (const url of rigidUrls) Assets.clone(url);
  const traverse = THREE.Object3D.prototype.traverse; let visits = 0;
  t.mock.method(THREE.Object3D.prototype, 'traverse', function (callback) { visits++; return traverse.call(this, callback); });
  for (const url of rigidUrls) { assert.ok(Assets.clone(url)); assert.ok(Assets.clone(url)); }
  assert.equal(visits, 0, 'rigid templates stay classified between runtime spawns');
});

test('actual skinned rigs keep owned Skeletons and remap every bone within their own clone', () => {
  for (const id of ['hero_gunner', 'hero_driver', 'fp_arms']) {
    const url = `/models/characters/${id}.glb`, template = Assets.template(url), clone = Assets.clone(url), sibling = Assets.clone(url);
    const sourceNodes = nodes(template), cloneNodes = nodes(clone), siblingNodes = nodes(sibling);
    const mapped = new Map(sourceNodes.map((o, i) => [o, cloneNodes[i]]));
    const siblingSkeletons = new Set(siblingNodes.filter(o => o.isSkinnedMesh).map(o => o.skeleton));
    let skinned = 0;
    sourceNodes.forEach((source, i) => {
      if (!source.isSkinnedMesh) return; skinned++;
      const copy = cloneNodes[i];
      assert.notEqual(copy.skeleton, source.skeleton); assert.ok(!siblingSkeletons.has(copy.skeleton));
      assert.equal(copy.skeleton.boneInverses, source.skeleton.boneInverses);
      assert.notEqual(copy.skeleton.boneMatrices, source.skeleton.boneMatrices);
      assert.deepEqual(copy.skeleton.bones, source.skeleton.bones.map(bone => mapped.get(bone)));
      assert.equal(copy.geometry, source.geometry); assert.equal(copy.material, source.material);
      copy.skeleton.bones[0].position.x += 1;
      assert.notEqual(copy.skeleton.bones[0].position.x, source.skeleton.bones[0].position.x);
    });
    assert.ok(skinned); assert.equal(clone.animations, Assets.getAnimations(url));
  }
});

test('async instantiation preserves the same prepared graph and animation array as synchronous cloning', async () => {
  for (const url of [rigidUrls[0], rigidUrls[1], '/models/characters/hero_gunner.glb']) {
    const root = await Assets.instantiate(url);
    assert.deepEqual(state(root), state(Assets.clone(url)));
    assert.equal(root.animations, Assets.getAnimations(url));
    assert.notEqual(root, Assets.template(url));
  }
  assert.equal(Assets.clone('/not-preloaded.glb'), null);
});

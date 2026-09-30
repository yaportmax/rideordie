import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Group } from 'three';
import { WorldView } from '../src/game/world_view.js';

test('ending a life removes active projectile meshes and frees their owned GPU resources once', () => {
  const scene = new Scene(), unrelated = new Group(); scene.add(unrelated);
  const view = new WorldView({ scene });
  const released = new Map();
  for (const resource of [view.rocketGeo, view.rocketMat, view.grenadeGeo, view.grenadeMat]) {
    released.set(resource, 0);
    resource.addEventListener('dispose', () => released.set(resource, released.get(resource) + 1));
  }
  view._projectiles([{ k: 1, x: 1, y: 2, z: 3 }, { k: 2, x: 4, y: 5, z: 6 }]);
  assert.equal(view.projMeshes.size, 2);
  assert.equal(scene.children.length, 4);
  view.dispose(); view.dispose();
  assert.equal(view.projMeshes.size, 0);
  assert.equal(view._projectileSeen.size, 0);
  assert.deepEqual(scene.children, [unrelated]);
  for (const count of released.values()) assert.equal(count, 1);
});

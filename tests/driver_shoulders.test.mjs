import test from 'node:test';
import assert from 'node:assert/strict';
import * as Assets from '../src/core/assets.js';
import { DriverArms, shoulderGeometry } from '../src/view/driver_arms.js';
import { FP_ARMS_URL } from '../src/view/viewmodel.js';
import { disposeOwnedSkeletons } from '../src/view/owned_skeletons.js';
import { loadCrewAssets, THREE, CrewView, seeded } from './helpers/crew-assets.mjs';
import { CarView } from '../src/view/car_view.js';
import { VEHICLES } from '../src/data/vehicles.js';

await loadCrewAssets();

function skinned(root) {
  let result; root.traverse(o => { if (o.isSkinnedMesh) result = o; });
  assert.ok(result, 'the shipped first-person arms contain a real skinned mesh');
  return result;
}
const source = skinned(Assets.template(FP_ARMS_URL));

function boundaryCount(geometry) {
  // Weld only coincident positions. UV seams and the different skin/cloth/glove
  // components otherwise look like false mesh boundaries in a raw index walk.
  const p = geometry.attributes.position, weld = [], points = new Map(), edges = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e5)).join(',');
    if (!points.has(key)) points.set(key, points.size);
    weld[i] = points.get(key);
  }
  const ix = geometry.index.array;
  for (let i = 0; i < ix.length; i += 3) {
    const triangle = [weld[ix[i]], weld[ix[i + 1]], weld[ix[i + 2]]];
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3];
      if (a === b) continue;
      const key = a < b ? a + ',' + b : b + ',' + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  return [...edges.values()].filter(n => n === 1).length;
}

test('driver jacket extension closes both actual shoulder openings and preserves every authored vertex and triangle', () => {
  const g = source.geometry, before = new Map(Object.entries(g.attributes).map(([name, attr]) => [name, attr.array.slice()]));
  const indices = g.index.array.slice(), result = shoulderGeometry(source);
  assert.notEqual(result, g, 'the shared gunner arms asset must remain unchanged');
  assert.ok(result.attributes.position.count > g.attributes.position.count, 'real connected jacket geometry is added');
  assert.ok(result.attributes.position.count < g.attributes.position.count + 1000, 'extension remains small compared with the authored rig');
  for (const [name, data] of before) {
    assert.deepEqual(g.attributes[name].array, data, name + ': source remains byte-identical');
    const out = result.attributes[name];
    assert.equal(out.itemSize, g.attributes[name].itemSize, name + ': attribute width');
    assert.equal(out.normalized, g.attributes[name].normalized, name + ': normalized storage');
    assert.equal(out.array.constructor, data.constructor, name + ': typed storage');
    assert.deepEqual(out.array.subarray(0, data.length), data, name + ': original vertices remain byte-identical');
  }
  assert.deepEqual(g.index.array, indices, 'the source triangles remain unchanged');
  assert.deepEqual(result.index.array.subarray(0, indices.length), indices, 'authored hands and sleeves retain all their triangles');
  assert.equal(boundaryCount(g), 2240, 'the shipped asset has two open 76-vertex shoulders and authored accessory boundaries');
  assert.equal(boundaryCount(result), 2240 - 152, 'only the two shoulder rings are closed');
  const weights = result.attributes.skinWeight;
  for (let i = g.attributes.position.count; i < weights.count; i++) {
    const total = [0, 1, 2, 3].reduce((sum, k) => sum + weights.getComponent(i, k), 0);
    assert.ok(Math.abs(total - 1) < .01, 'added jacket vertices keep normalized bone weights');
  }
});

test('new driver jacket triangles keep finite nondegenerate UVs for leather textures and normal maps', () => {
  const original = source.geometry, geometry = shoulderGeometry(source), uv = geometry.attributes.uv, ix = geometry.index.array;
  let triangles = 0;
  for (let i = original.index.count; i < ix.length; i += 3) {
    const a = ix[i], b = ix[i + 1], c = ix[i + 2];
    const determinant = (uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a))
      - (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a));
    // Mirrored atlas coordinates are valid. Collapsed UVs are not: the normal
    // map needs two independent directions on every added sleeve triangle.
    assert.ok(Number.isFinite(determinant) && Math.abs(determinant) > 1e-10,
      'new jacket triangle keeps a valid UV basis, triangle ' + i / 3);
    for (const vertex of [a, b, c]) for (const value of [uv.getX(vertex), uv.getY(vertex)]) {
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, 'new sleeve remains inside the authored texture atlas');
    }
    triangles++;
  }
  assert.equal(triangles, 1064, 'validate every triangle of both closed jacket extensions');
});

test('warm and runtime driver arms reuse one jacket geometry without affecting the gunner template', () => {
  const expected = shoulderGeometry(source), original = source.geometry;
  const warm = DriverArms.warmObject();
  assert.equal(skinned(warm).geometry, expected);
  assert.equal(shoulderGeometry(skinned(Assets.clone(FP_ARMS_URL))), expected);
  assert.equal(source.geometry, original);
  assert.ok(!original.attributes.sleeve, 'the shared asset does not inherit driver-only material attributes');
  disposeOwnedSkeletons(warm);
});

function fixture() {
  return seeded(67, () => {
    const scene = new THREE.Scene(), car = new CarView(VEHICLES.truck_t1, { lod: false, paint: 0x786342 });
    const crew = new CrewView('hero_driver', { role: 'driver' });
    scene.add(car.root); car.root.add(crew.root); crew.attach(car, VEHICLES.truck_t1.seats.driver);
    crew._cutPrepared = true;
    return { scene, car, crew };
  });
}
const scratch = new THREE.Vector3(), oldVertex = new THREE.Vector3(), eye = new THREE.Vector3();
function posed(mesh, i, out) {
  out.fromBufferAttribute(mesh.geometry.attributes.position, i); mesh.applyBoneTransform(i, out); return out.applyMatrix4(mesh.matrixWorld);
}

test('closed driver shoulders stay behind the eye through steering, regrips, gear changes and bracing while the hands retain their pose', () => {
  // Both fixtures run the same production pose/IK. Only the reference mesh is
  // restored to the original asset to compare the exact skinned hand vertices.
  const primer = DriverArms.warmObject(); disposeOwnedSkeletons(primer);
  const reference = fixture(), candidate = fixture();
  let sawRegrip = false, sawShift = false, sawBrace = false, compared = 0;
  const sourceCount = source.geometry.attributes.position.count;
  let hiddenVertices;
  for (let frame = 0; frame < 420; frame++) {
    const steer = frame < 60 ? 0 : frame < 180 ? 1 : frame < 300 ? -1 : 0;
    const state = { alive: true, steer, speed: 18, airborne: frame >= 320 && frame < 355,
      quat: new THREE.Quaternion(), vel: new THREE.Vector3(), local: { firstPerson: true, cockpit: { active: true }, gear: frame < 30 ? 1 : frame < 320 ? 2 : 3 } };
    for (const f of [reference, candidate]) {
      f.car.root.position.set(Math.sin(frame * .02) * .3, Math.sin(frame * .03) * .1, frame * .4);
      f.car.root.quaternion.setFromEuler(new THREE.Euler(Math.sin(frame * .03) * .04, Math.sin(frame * .02) * .08, Math.cos(frame * .04) * .03));
      f.crew.update(1 / 60, state); f.scene.updateMatrixWorld(true);
    }
    const oldMesh = skinned(reference.crew.drvArms.model), mesh = skinned(candidate.crew.drvArms.model);
    oldMesh.geometry = source.geometry;
    if (!hiddenVertices) {
      const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
      const spine = mesh.skeleton.bones.findIndex(b => b.name === 'Spine2'); hiddenVertices = [];
      for (let i = sourceCount; i < si.count; i++) {
        let rootWeight = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === spine) rootWeight += sw.getComponent(i, k);
        if (rootWeight > .999) hiddenVertices.push(i);
      }
      assert.ok(hiddenVertices.length >= 100, 'the closing jacket ring and cap follow the torso instead of the steering hands');
    }
    candidate.crew.bones.Head.getWorldPosition(eye);
    // Match Run._cockpitEye offsets in truck space; camera smoothing may lag a
    // few frames, so leave a generous margin behind this instantaneous eye.
    candidate.car.root.worldToLocal(eye); eye.z -= .05; eye.y += .14;
    for (const i of hiddenVertices) {
      posed(mesh, i, scratch); candidate.car.root.worldToLocal(scratch);
      assert.ok(scratch.z < eye.z - .08, 'the closed end remains at least 8 cm behind the driver eye, frame ' + frame);
    }
    if (frame % 20 === 0) {
      // Full original mesh comparison samples the fingers, watch and sleeve
      // folds, rather than only checking the hand target/IK bones themselves.
      for (let i = 0; i < sourceCount; i++) {
        posed(mesh, i, scratch); posed(oldMesh, i, oldVertex);
        assert.ok(scratch.distanceToSquared(oldVertex) < 1e-14, 'authored skinned vertex unchanged, frame ' + frame + ', vertex ' + i); compared++;
      }
    }
    const arms = candidate.crew.drvArms;
    sawRegrip ||= arms.side.Left.mv >= 0 || arms.side.Right.mv >= 0;
    sawShift ||= arms.shiftT >= 0;
    sawBrace ||= candidate.crew.braceK > .8;
  }
  assert.ok(sawRegrip && sawShift && sawBrace, 'the differential crosses actual regrip, shifter and brace branches');
  assert.ok(compared > 300000, 'compare the real authored surface over multiple live poses');
  reference.crew.dispose(); candidate.crew.dispose();
});

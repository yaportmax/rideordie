import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeRigid, unifyAtlasMaterials } from '../src/core/merge.js';
import { CarView } from '../src/view/car_view.js';
import { InstancePool } from '../src/world/dressing/pool.js';
import { configureWeaponShadows } from '../src/view/weapon_view.js';
import { configureCrewShadows } from '../src/view/crew_view.js';
import { Cockpit } from '../src/view/cockpit.js';
import { CarRec } from '../src/view/fx/carfx.js';

test('rigid merging keeps detachable mesh pivots and separate visibility/shadow flags', () => {
  const root = new THREE.Group(), mat = new THREE.MeshStandardMaterial();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(), mat); panel.name = 'panel_door_L';
  const a = new THREE.Mesh(new THREE.BoxGeometry(), mat), b = a.clone(); b.position.x = 2;
  panel.add(a, b); root.add(panel);
  const hidden = a.clone(); hidden.visible = false; root.add(hidden);
  const shadow = a.clone(); shadow.castShadow = true; root.add(shadow);
  mergeRigid(root);
  assert.equal(panel.parent, root);
  assert.ok(panel.geometry.attributes.position);
  assert.equal(panel.children.length, 1);
  assert.ok(panel.children[0].geometry.boundingSphere);
  assert.equal(hidden.parent, root); assert.equal(hidden.visible, false);
  assert.equal(shadow.parent, root); assert.equal(shadow.castShadow, true);
});

test('atlas material sharing keeps roughness and tint differences', () => {
  const root = new THREE.Group(), map = new THREE.Texture();
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.4 });
  const same = mat.clone(), different = mat.clone(); different.roughness = 0.9;
  const a = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  const b = new THREE.Mesh(a.geometry, same), c = new THREE.Mesh(a.geometry, different);
  root.add(a, b, c);
  assert.equal(unifyAtlasMaterials(root), 1);
  assert.equal(b.material, mat); assert.equal(c.material, different);
});

test('car shared materials update once and rigid primitives follow moving/detached parents', () => {
  const car = Object.assign(Object.create(CarView.prototype), {
    root: new THREE.Group(), wheelNodes: new Map(), panels: new Map(), sockets: {}, taillights: [], headlights: [],
  });
  const model = new THREE.Group(), paint = new THREE.MeshStandardMaterial(); paint.name = 'paint';
  const wheel = new THREE.Group(); wheel.name = 'wheel_FL';
  const panel = new THREE.Mesh(new THREE.BoxGeometry(), paint); panel.name = 'panel_hood';
  const body = new THREE.Mesh(panel.geometry, paint), other = body.clone();
  const tyre = new THREE.Mesh(panel.geometry, new THREE.MeshStandardMaterial()); tyre.name = 'wheel_FL_merged_rubber'; wheel.add(tyre);
  model.add(body, other, panel, wheel); car._adoptModel(model, {});
  assert.equal(car.paintMats.length, 1);
  assert.equal(car.wheelNodes.size, 1);
  assert.equal(body.matrixAutoUpdate, false); assert.equal(tyre.matrixAutoUpdate, false);
  assert.equal(panel.matrixAutoUpdate, true); assert.equal(wheel.matrixAutoUpdate, true);
  car.root.position.x = 5; wheel.position.y = 2; car.root.updateMatrixWorld(true);
  assert.equal(tyre.matrixWorld.elements[12], 5); assert.equal(tyre.matrixWorld.elements[13], 2);
  const scene = new THREE.Scene(); scene.add(car.root); scene.attach(panel);
  panel.position.x = 10; scene.updateMatrixWorld(true);
  assert.equal(panel.matrixWorld.elements[12], 10);
});

function list(points) {
  const m = new Float32Array(points.length * 16), col = new Float32Array(points.length * 3);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  points.forEach((p, i) => {
    new THREE.Matrix4().makeTranslation(...p).toArray(m, i * 16);
    col.set([i / 10, 0.4, 0.8], i * 3); min.min(new THREE.Vector3(...p)); max.max(new THREE.Vector3(...p));
  });
  return { m, col, n: points.length, minx: min.x, miny: min.y, minz: min.z, maxx: max.x, maxy: max.y, maxz: max.z, rad: 1 };
}
function poolFixture(spec = {}) {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const asset = { parts: [{ geometry, material, role: 'main', tris: 12 }], sphere: new THREE.Sphere(new THREE.Vector3(), 1), height: 2 };
  const kit = { get: () => asset, state: () => 'ready' };
  const pool = new InstancePool(new THREE.Scene(), kit); pool.setSpec('prop', { far: 100, ...spec });
  const rebuild = (src, cam = { x: 0, y: 0, z: 0 }, sh = null) => pool.rebuild([{ lists: new Map([['prop', src]]) }], cam, { x: 0, z: 1 }, sh);
  return { pool, rebuild };
}
test('single-LOD bulk instance copies preserve transforms and colours across capacity growth', () => {
  const { pool, rebuild } = poolFixture();
  const src = list(Array.from({ length: 200 }, (_, i) => [i % 10, 0, 10 + i % 20]));
  assert.equal(rebuild(src), true);
  const set = pool.entries.get('prop').sets[0];
  assert.equal(set.n, 200); assert.ok(set.cap >= 200);
  assert.deepEqual(set.mat.subarray(0, 3200), src.m);
  assert.deepEqual(set.col.subarray(0, 600), src.col);
  assert.equal(set.meshes[0].count, 200);
  assert.ok(set.sph.containsPoint(new THREE.Vector3(9, 0, 29)));
  pool.dispose();
});
test('mixed instance lists still cull distance/behind and select the shadow set', () => {
  const { pool, rebuild } = poolFixture({ behind: true, shadow: true });
  const src = list([[0, 0, 10], [0, 0, -90], [0, 0, 200], [40, 0, 20]]);
  rebuild(src, { x: 0, y: 0, z: 0 }, { on: true, fx: 0, fy: 0, fz: 10, lx: 0, ly: 1, lz: 0, rad: 10, depth: 10 });
  const [plain, shadow] = pool.entries.get('prop').sets;
  assert.equal(shadow.n, 1); assert.equal(shadow.mat[14], 10);
  assert.equal(plain.n, 1); assert.equal(plain.mat[12], 40);
  pool.qf = 0.3; rebuild(src);
  assert.equal(plain.n, 1); assert.equal(plain.mat[14], 10);
  assert.equal(shadow.n, 0);
  pool.dispose();
});

test('crew initialization preserves the single firearm caster and skips eye/hair shadows', () => {
  const root = new THREE.Group(), weapon = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); body.name = 'mesh_body';
  const slide = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 32), body.material); slide.name = 'mesh_slide';
  weapon.add(body, slide); root.add(weapon);
  const eyes = body.clone(); eyes.name = 'eyes'; const hair = body.clone(); hair.name = 'hair_cards';
  const torso = body.clone(); torso.name = 'torso'; root.add(eyes, hair, torso);
  assert.equal(configureWeaponShadows(weapon), body); // slide has more vertices but is a moving mechanism
  configureCrewShadows(root, weapon);
  assert.equal(body.castShadow, true); assert.equal(slide.castShadow, false);
  assert.equal(body.receiveShadow, false);
  assert.equal(eyes.castShadow, false); assert.equal(hair.castShadow, false); assert.equal(torso.castShadow, true);
});

test('mirror pass omits dressing and effects, restores visibility and keeps its existing cadence', () => {
  const scene = new THREE.Scene(), model = new THREE.Group(); scene.add(model);
  const props = new THREE.Group(); props.name = 'dressing-pool';
  const smoke = new THREE.Group(); smoke.name = 'fx_smoke'; smoke.visible = false;
  const marks = new THREE.Group(); marks.name = 'hazard_marks';
  const city = new THREE.Group(); city.name = 'dressing-extras'; scene.add(props, smoke, marks, city);
  const cockpit = Object.assign(Object.create(Cockpit.prototype), {
    active: true, frame: 0, model, rearCam: new THREE.PerspectiveCamera(), rearLocal: new THREE.Vector3(),
    frustum: new THREE.Frustum(), glassMat: { visible: false }, rt: {},
  });
  const previousTarget = {}, calls = [];
  let target = previousTarget, renders = 0;
  const renderer = {
    shadowMap: { autoUpdate: true }, getRenderTarget: () => target,
    setRenderTarget: (v) => { target = v; }, clear: (...args) => { calls.push(args); },
    render: () => {
      renders++; assert.equal(model.visible, false); assert.equal(props.visible, false);
      assert.equal(smoke.visible, false); assert.equal(marks.visible, false); assert.equal(city.visible, true);
    },
  };
  for (let i = 0; i < 6; i++) cockpit.renderMirrors(renderer, scene, model);
  assert.equal(renders, 2); assert.equal(props.visible, true); assert.equal(smoke.visible, false);
  assert.equal(marks.visible, true); assert.equal(model.visible, true); assert.equal(cockpit.glassMat.visible, false);
  assert.equal(target, previousTarget); assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(scene.matrixWorldAutoUpdate, true); assert.deepEqual(calls[0], [true, true, true]);
  const late = new THREE.Group(); late.name = 'fx_fire'; scene.add(late);
  renderer.render = () => { assert.equal(late.visible, false); throw new Error('renderer test'); };
  assert.throws(() => cockpit.renderMirrors(renderer, scene, model), /renderer test/);
  assert.equal(late.visible, true); assert.equal(props.visible, true); assert.equal(model.visible, true);
  assert.equal(target, previousTarget); assert.equal(renderer.shadowMap.autoUpdate, true);
});

test('car wreck uniforms char body paint while leaving shared crew weapon paint unchanged', () => {
  const bodyMat = new THREE.MeshStandardMaterial(); bodyMat.name = 'paint';
  const weaponMat = new THREE.MeshStandardMaterial(); weaponMat.name = 'paint';
  const geometry = new THREE.BoxGeometry();
  const model = new THREE.Group(); model.add(new THREE.Mesh(geometry, bodyMat));
  const crew = new THREE.Group(); crew.add(new THREE.Mesh(geometry, weaponMat));
  const anotherWeapon = new THREE.Mesh(geometry, weaponMat);
  const root = new THREE.Group(); root.add(model, crew);
  const beforeCompile = weaponMat.onBeforeCompile, beforeKey = weaponMat.customProgramCacheKey();
  const cv = { root, model, wheelNodes: new Map(), sockets: {} };
  const state = { id: 1, spec: { wheels: [], wheelRadius: 0.4, length: 5, height: 2 } };
  const rec = new CarRec(state, cv);
  assert.equal(bodyMat.customProgramCacheKey(), 'rod_wreck_paint');
  assert.equal(weaponMat.onBeforeCompile, beforeCompile);
  assert.equal(weaponMat.customProgramCacheKey(), beforeKey);
  assert.equal(anotherWeapon.material.userData.__wreckPatched, undefined);
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>' };
  bodyMat.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uChar, rec.wreckU.uChar);
  rec.wreckU.uChar.value = 1;
  assert.equal(shader.uniforms.uChar.value, 1);
  assert.match(shader.fragmentShader, /diffuseColor.rgb = mix/);
});

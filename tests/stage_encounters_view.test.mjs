import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StageEncountersView, STAGE_ENCOUNTER_PALETTES, STAGE_ENCOUNTER_VIEW_LIMITS } from '../src/view/stage_encounters.js';
import { Road } from '../src/world/road.js';
import { EDGE, seaLevel } from '../src/world/terrain_gen.js';

const actor = (kind, extra = {}) => ({ id: 50000, kind, biome: 'canyon', pos: new THREE.Vector3(18, 7.2, 120),
  quat: new THREE.Quaternion(), half: new THREE.Vector3(2, 1, 1.2), hp: 100, maxHp: 100,
  status: 'armed', s: 120, groundY: 0, ...extra });
const system = (...actors) => ({ entities: new Map(actors.map(a => [a.id, a])) });
const near = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const capture = () => { const scene = new THREE.Scene(), view = new StageEncountersView(scene); return { scene, view }; };
const meshes = root => { const result = []; root.traverse(o => { if (o.isMesh) result.push(o); }); return result; };

test('all ten stages retain distinct authored palettes and finite batched actor geometry', () => {
  assert.equal(Object.keys(STAGE_ENCOUNTER_PALETTES).length, 10);
  assert.equal(new Set(Object.values(STAGE_ENCOUNTER_PALETTES).map(p => p.metal)).size, 10);
  const { view } = capture(); let id = 50000;
  for (const biome of Object.keys(STAGE_ENCOUNTER_PALETTES)) for (const kind of ['gate', 'rock', 'tower', 'rifleman', 'arch', 'drone', 'boat', 'barrel', 'vent']) {
    const a = actor(kind, { id: id++, biome, weakpoint: { pos: new THREE.Vector3(18, 7.2, 118), radius: .6 }, muzzle: new THREE.Vector3(18, 8, 120) });
    view.update(.016, system(a), 120);
    const record = view.actors.get(a.id); assert.ok(record);
    assert.ok(meshes(record.body).length <= 5, `${kind} has too many static material batches`);
    for (const mesh of meshes(record.group)) for (const attribute of Object.values(mesh.geometry.attributes)) {
      for (let i = 0; i < attribute.count; i++) for (let c = 0; c < attribute.itemSize; c++) assert.ok(Number.isFinite(attribute.array[i * attribute.itemSize + c]));
    }
  }
  assert.ok(view.templates.size <= STAGE_ENCOUNTER_VIEW_LIMITS.templates); view.dispose();
});

test('rock visual spans the authoritative half extents, rather than leaving invisible rock corners', () => {
  const { view } = capture(), a = actor('rock', { half: new THREE.Vector3(2.7, 1.8, 3.4) });
  view.update(0, system(a), 120);
  view.group.updateMatrixWorld(true);
  const body = view.actors.get(a.id).body;
  const box = new THREE.Box3().setFromObject(body);
  near(box.min.x, a.pos.x - 2.7); near(box.max.x, a.pos.x + 2.7); near(box.min.y, a.pos.y - 1.8); near(box.max.y, a.pos.y + 1.8); near(box.min.z, a.pos.z - 3.4); near(box.max.z, a.pos.z + 3.4);
  view.dispose();
});

test('world weakpoint and gun muzzle stay exact when the actor turns, without mutating authoritative state', () => {
  const { view } = capture(), a = actor('tower', {
    quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.3),
    weakpoint: { pos: new THREE.Vector3(17, 8, 121), radius: .72 }, muzzle: new THREE.Vector3(18.4, 13.2, 120.6),
    aimDir: new THREE.Vector3(-.3, -.1, -.9).normalize(),
  });
  const before = { pos: a.pos.toArray(), q: a.quat.toArray(), target: a.weakpoint.pos.toArray(), muzzle: a.muzzle.toArray() };
  view.update(.016, system(a), 120); view.group.updateMatrixWorld(true);
  const r = view.actors.get(a.id), actual = new THREE.Vector3();
  r.weakpoint.getWorldPosition(actual); near(actual.distanceTo(a.weakpoint.pos), 0);
  r.gun.getObjectByName('muzzle').getWorldPosition(actual); near(actual.distanceTo(a.muzzle), 0);
  const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(r.gun.getWorldQuaternion(new THREE.Quaternion()));
  near(direction.distanceTo(a.aimDir), 0);
  assert.deepEqual({ pos: a.pos.toArray(), q: a.quat.toArray(), target: a.weakpoint.pos.toArray(), muzzle: a.muzzle.toArray() }, before);
  view.dispose();
});

test('all visible weakpoint vertices fit inside the shootable sphere', () => {
  const { view } = capture(), a = actor('gate', { weakpoint: { pos: new THREE.Vector3(18, 7, 118), radius: .6 } });
  view.update(0, system(a), 120);
  const node = view.actors.get(a.id).weakpoint;
  for (const mesh of meshes(node)) {
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) assert.ok(new THREE.Vector3().fromBufferAttribute(position, i).length() <= 1 + 1e-7);
  }
  view.dispose();
});

test('gate stays closed until authority breaks it, then leaves a readable green opening', () => {
  const { view } = capture(), a = actor('gate', { weakpoint: { pos: new THREE.Vector3(18, 7, 118), radius: .6 } });
  view.update(20, system(a), 120);
  const r = view.actors.get(a.id);
  assert.equal(r.body.visible, true); assert.equal(r.weakpoint.visible, true); assert.equal(r.gap.visible, false);
  a.status = 'broken'; view.update(0, system(a), 120);
  assert.equal(r.body.visible, false); assert.equal(r.weakpoint.visible, false); assert.equal(r.gap.visible, true);
  view.dispose();
});

test('rockfall warning remains on the actual ground while the rock follows authority and disappears on rubble', () => {
  const { view } = capture(), a = actor('rock', { pos: new THREE.Vector3(18, 26, 120), groundY: 5.7 });
  view.update(.08, system(a), 120); const r = view.actors.get(a.id);
  near(r.warning.position.y, 5.755); near(r.group.position.y, 26); assert.equal(r.warning.visible, true);
  a.status = 'falling'; a.pos.y = 12; view.update(.08, system(a), 120);
  near(r.group.position.y, 12); near(r.warning.position.y, 5.755); assert.equal(r.warning.visible, true);
  a.status = 'rubble'; view.update(.08, system(a), 120); assert.equal(r.warning.visible, false);
  view.dispose();
});

test('unsupported ground height never invents a floating warning or activates damage', () => {
  const { view } = capture(), a = actor('rock', { groundY: undefined });
  view.update(.1, system(a), 120); assert.equal(view.actors.get(a.id).warning.visible, false);
  assert.equal(a.status, 'armed'); assert.equal(a.hp, 100); view.dispose();
});

test('arch has a clear roadway and matching fixed supports until authoritative collapse', () => {
  const { view } = capture(), a = actor('arch', { half: new THREE.Vector3(9, .9, 1.15) });
  view.update(0, system(a), 120); const r = view.actors.get(a.id);
  assert.equal(r.legs.visible, true); assert.equal(r.legs.children.length, 2);
  for (const [i, leg] of r.legs.children.entries()) {
    near(leg.position.x, i ? 8 : -8); near(leg.position.y, -3.6); near(leg.scale.x, 1.3); near(leg.scale.y, 7.2);
  }
  a.status = 'falling'; a.pos.y = 3.2; view.update(.016, system(a), 120);
  assert.equal(r.legs.visible, false); near(r.group.position.y, 3.2); view.dispose();
});

test('drone rotor animation is cosmetic and stops on death, and boats keep an actual pointed hull', () => {
  const { view } = capture(), d = actor('drone', { id: 50001 }), b = actor('boat', { id: 50002 });
  view.update(.08, system(d, b), 120); const r = view.actors.get(d.id), boat = view.actors.get(b.id);
  assert.equal(r.rotors.length, 4); assert.ok(r.rotors[0].rotation.y > 0);
  const angle = r.rotors[0].rotation.y; d.status = 'dead'; view.update(.08, system(d, b), 120);
  assert.equal(r.rotors[0].rotation.y, angle); assert.equal(boat.wake.visible, true);
  const hull = view.geometry.hull.attributes.position;
  assert.ok([...Array(hull.count).keys()].some(i => hull.getZ(i) === 1 && hull.getX(i) === 0));
  b.status = 'dead'; view.update(.08, system(d, b), 120); assert.equal(boat.wake.visible, false); view.dispose();
});

test('static attackers telegraph their authoritative windup without manufacturing a shot or danger phase', () => {
  const { view } = capture(), a = actor('rifleman', { muzzle: new THREE.Vector3(18, 7.75, 120), firePhase: 0 });
  view.update(.1, system(a), 120); const r = view.actors.get(a.id);
  assert.equal(r.tell.visible, false); a.firePhase = 1; view.update(.1, system(a), 120); assert.equal(r.tell.visible, true);
  a.firePhase = 0; view.update(.1, system(a), 120); assert.equal(r.tell.visible, false);
  assert.equal(a.hp, 100); assert.equal(a.status, 'armed'); view.dispose();
});

test('host and guest vent pulses display the full active damage footprint and end with authoritative phase', () => {
  const host = capture(), guest = capture(), a = actor('vent', { half: new THREE.Vector3(1.3, .3, 1.3), firePhase: 0 });
  host.view.update(.1, system(a), 120); guest.view.update(.1, system(a), 120);
  assert.equal(host.view.actors.get(a.id).plume.visible, false); assert.equal(guest.view.actors.get(a.id).plume.visible, false);
  const active = { ...a, firePhase: .85 };
  host.view.update(.1, system(active), 120); guest.view.update(.1, system(active), 120);
  const h = host.view.actors.get(a.id).plume, g = guest.view.actors.get(a.id).plume;
  assert.equal(h.visible, true); assert.equal(g.visible, true); near(h.scale.y, g.scale.y);
  const local = new THREE.Box3().setFromObject(h.children[0]); assert.ok(local.max.y - local.min.y > 2.7);
  host.view.update(.1, system(a), 120); guest.view.update(.1, system(a), 120);
  assert.equal(h.visible, false); assert.equal(g.visible, false); assert.equal(a.firePhase, 0);
  host.view.dispose(); guest.view.dispose();
});

test('render actors retire outside the bounded road window and cannot exceed their cap', () => {
  const { view } = capture(), list = [];
  for (let i = 0; i < 120; i++) list.push(actor('rock', { id: 50000 + i, s: 120 }));
  view.update(0, system(...list), 120); assert.equal(view.actors.size, STAGE_ENCOUNTER_VIEW_LIMITS.actors);
  view.update(0, system(...list), 1000); assert.equal(view.actors.size, 0); assert.equal(view.group.children.length, 0);
  view.dispose();
});

test('rear-facing gunner retains every active threat for the authority firing and retention window', () => {
  const { view } = capture();
  const list = ['tower', 'rifleman', 'boat', 'drone'].map((kind, i) => actor(kind, { id: 50000 + i, s: 120 }));
  view.update(0, system(...list), 290); assert.equal(view.actors.size, 4);
  view.update(0, system(...list), 360); assert.equal(view.actors.size, 4);
  view.update(0, system(...list), 391); assert.equal(view.actors.size, 0); view.dispose();
});

test('same-shaped actors share static buffers and dimension or biome replacement cannot keep stale art', () => {
  const { view } = capture(), a = actor('gate'), b = actor('gate', { id: 50001 });
  view.update(0, system(a, b), 120);
  const first = view.actors.get(a.id), second = view.actors.get(b.id);
  assert.equal(first.body.children[0].geometry, second.body.children[0].geometry);
  a.biome = 'space'; view.update(0, system(a, b), 120);
  assert.notEqual(view.actors.get(a.id).template, second.template);
  a.half.x = 4; view.update(0, system(a, b), 120); assert.ok(view.actors.get(a.id).template.key.endsWith(':4:1:1.2'));
  view.dispose();
});

test('retiring actors releases their exclusive meshes but preserves shared primitives and templates', () => {
  const { view } = capture(), a = actor('tower', { weakpoint: { pos: new THREE.Vector3(18, 8, 118), radius: .6 }, muzzle: new THREE.Vector3(18, 9, 120) });
  view.update(0, system(a), 120); const r = view.actors.get(a.id);
  let exclusive = 0, primitive = 0, template = 0;
  for (const mesh of meshes(r.group)) if (mesh.userData.encounterOwnedGeometry) mesh.geometry.addEventListener('dispose', () => exclusive++);
  view.geometry.box.addEventListener('dispose', () => primitive++);
  r.body.children[0].geometry.addEventListener('dispose', () => template++);
  view.update(0, system(), 120);
  assert.equal(exclusive, 5); assert.equal(primitive, 0); assert.equal(template, 0);
  view.dispose(); assert.equal(primitive, 1); assert.equal(template, 1);
});

test('template cache is bounded during distinct encounters and disposal is idempotent', () => {
  const { scene, view } = capture(); let releases = 0;
  view.geometry.rock.addEventListener('dispose', () => releases++);
  for (let i = 0; i < 80; i++) view.update(0, system(actor('rock', { half: new THREE.Vector3(1 + i * .1, 1, 1) })), 120);
  assert.ok(view.templates.size <= STAGE_ENCOUNTER_VIEW_LIMITS.templates);
  view.dispose(); view.dispose(); assert.equal(releases, 1); assert.equal(scene.children.length, 0); assert.equal(view.actors.size, 0);
});

test('invalid snapshots cannot create nonfinite geometry or duplicate actor keys', () => {
  const { view } = capture();
  const invalid = [actor('rock', { id: 1, pos: new THREE.Vector3(NaN, 0, 0) }), actor('rock', { id: 2, half: new THREE.Vector3(-1, 1, 1) }), actor('unknown', { id: 3 })];
  view.update(NaN, system(...invalid), 120); assert.equal(view.actors.size, 0); near(view.clock, 0); view.dispose();
});

test('terminal shooters become inert ground or water wrecks while healthy peers keep their geometry and materials', () => {
  for (const kind of ['tower', 'rifleman', 'drone', 'boat']) {
    const { view } = capture();
    const dead = actor(kind, { id: 50001, muzzle: new THREE.Vector3(18, 8, 120), groundY: 3 });
    const alive = actor(kind, { id: 50002, muzzle: new THREE.Vector3(18, 8, 120), groundY: 3 });
    view.update(.016, system(dead, alive), 120);
    const d = view.actors.get(dead.id), a = view.actors.get(alive.id);
    const healthyGeometry = a.body.children[0].geometry, healthyMaterial = a.body.children[0].material;
    const positions = [...healthyGeometry.attributes.position.array];
    assert.equal(d.body.visible, true); dead.status = 'dead'; dead.firePhase = 1;
    view.update(.016, system(dead, alive), 120); view.group.updateMatrixWorld(true);
    assert.equal(d.body.visible, false); assert.ok(d.wreck?.visible); assert.equal(d.gun.visible, false);
    if (d.rotorMesh) assert.equal(d.rotorMesh.visible, false);
    if (d.wake) assert.equal(d.wake.visible, false);
    assert.equal(a.body.visible, true); assert.equal(a.wreck, null);
    assert.equal(a.body.children[0].geometry, healthyGeometry); assert.equal(a.body.children[0].material, healthyMaterial);
    assert.deepEqual([...healthyGeometry.attributes.position.array], positions);
    const point = d.wreck.getWorldPosition(new THREE.Vector3());
    near(point.y, dead.groundY + (kind === 'boat' ? .1 : kind === 'rifleman' ? dead.half.x * .7 : .24));
    dead.status = 'armed'; view.update(0, system(dead, alive), 120);
    assert.equal(d.body.visible, true); assert.equal(d.wreck.visible, false); assert.equal(d.gun.visible, true);
    view.dispose();
  }
});

test('terminal wreck buffers remain shared and are released once with their bounded template owner', () => {
  const { view } = capture();
  const a = actor('tower', { id: 50001, status: 'dead' }), b = actor('tower', { id: 50002, status: 'dead' });
  view.update(0, system(a, b), 120);
  const x = view.actors.get(a.id), y = view.actors.get(b.id);
  assert.equal(x.wreck.children[0].geometry, y.wreck.children[0].geometry);
  let disposed = 0; x.wreck.children[0].geometry.addEventListener('dispose', () => disposed++);
  view.update(0, system(), 120); assert.equal(disposed, 0); view.dispose(); view.dispose(); assert.equal(disposed, 1);
});

test('water cuts have sampled supporting faces and piers below the real banked pavement, independent of living boats', () => {
  for (const level of [3, 6]) {
    const scene = new THREE.Scene(), road = new Road(1, { mode: 'campaign', level }), view = new StageEncountersView(scene, road);
    const cut = view.waterCuts[0]; assert.ok(cut);
    view.update(0, system(), cut.start + 180);
    assert.ok(view.viaducts.has(cut.id)); const group = view.viaducts.get(cut.id);
    assert.equal(group.name, 'waterside_viaduct'); assert.ok(meshes(group).length <= 2);
    assert.ok(group.userData.topSamples.length > 100);
    for (const point of group.userData.topSamples) {
      near(point.y, road.pointAt(point.s, point.d, {}).y - .18, 1e-5);
      assert.ok(Math.abs(point.d) < EDGE);
    }
    assert.equal(group.userData.waterY, seaLevel(road, cut.biome));
    const geometry = group.children[0].geometry;
    geometry.computeBoundingBox(); assert.ok(geometry.boundingBox.min.y + group.position.y <= group.userData.waterY - .9);
    view.update(.016, system(), cut.start + 180); assert.equal(view.viaducts.get(cut.id), group, 'stationary frames must not regenerate supports');
    view.dispose(); assert.equal(scene.children.length, 0);
  }
});

test('water-cut support retirement releases its exclusive buffers once and keeps ordinary shared primitives live', () => {
  const scene = new THREE.Scene(), road = new Road(1, { mode: 'campaign', level: 3 }), view = new StageEncountersView(scene, road);
  const cut = view.waterCuts[0]; view.update(0, system(), cut.start + 180);
  const group = view.viaducts.get(cut.id); let exclusive = 0, shared = 0;
  group.children[0].geometry.addEventListener('dispose', () => exclusive++);
  view.geometry.box.addEventListener('dispose', () => shared++);
  view.update(0, system(), 1e6); assert.equal(exclusive, 1); assert.equal(shared, 0); assert.equal(view.viaducts.size, 0);
  view.dispose(); assert.equal(exclusive, 1); assert.equal(shared, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeRigid } from '../src/core/merge.js';
import { MountedGun, MINIGUN_DECK_OFFSET, MINIGUN_SOCKETS } from '../src/view/mounted_gun.js';
import { WEAPONS, WEAPON_ORDER, weaponStats } from '../src/data/weapons.js';
import { DEFAULT_PROFILE, effects, weaponTrackCost } from '../src/data/upgrades.js';
import { normalizeProfile, buyWeapon } from '../src/meta/profile.js';
import { creditCampaignLevel } from '../src/data/campaign.js';

const bytes = readFileSync(new URL('../public/models/weapons/mounted_minigun.glb', import.meta.url));
const jsonLength = bytes.readUInt32LE(12);
const authored = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
async function fixture(t) {
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  // Exercise the same load-time merge that preserves mounted mechanical pivots.
  mergeRigid(gltf.scene, gltf.parser.associations);
  const sourceMaterials = new Set(); gltf.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) sourceMaterials.add(m); });
  const gun = new MountedGun('minigun', { model: gltf.scene });
  gun.testSourceMaterials = sourceMaterials;
  t.after(() => gun.dispose()); return gun;
}
function close(a, b, message = '') { assert.ok(a.distanceTo(b) < 1e-7, `${message}: ${a.toArray()} versus ${b.toArray()}`); }

test('minigun follows RPG, costs 105000 after chapter eight, upgrades through ordinary tracks and grants no durability', () => {
  const w = WEAPONS.minigun;
  assert.equal(WEAPON_ORDER.at(-2), 'rpg'); assert.equal(WEAPON_ORDER.at(-1), 'minigun');
  assert.equal(w.cost, 105000); assert.equal(w.unlockLevel, 9); assert.ok(w.cost > WEAPONS.rpg.cost);
  assert.equal(w.mode, 'auto'); assert.equal(w.mounted, true); assert.equal(w.model, 'mounted_minigun');
  assert.equal(w.sound, 'lmg'); assert.ok(w.soundPitch < 1);
  const upgraded = weaponStats('minigun', { dmg: 3, mag: 3, rel: 3, hnd: 3 });
  assert.ok(upgraded.dmg > w.dmg); assert.ok(upgraded.mag > w.mag); assert.ok(upgraded.reload < w.reload);
  assert.ok(upgraded.spreadMul < 1); assert.ok(upgraded.recoilMul < 1);
  assert.ok(weaponTrackCost('minigun', 'dmg', 2) > weaponTrackCost('minigun', 'dmg', 0));
  const career = normalizeProfile(DEFAULT_PROFILE()); career.cash = 1000000;
  const unearned = structuredClone(career);
  assert.deepEqual(buyWeapon(career, 'minigun'), { ok: false, reason: 'progress' }); assert.deepEqual(career, unearned);
  for (let level = 1; level < 9; level++) assert.equal(creditCampaignLevel(career,
    { runId: `mounted-gun-earned-${level}`, level, mode: 'campaign', won: true }), true);
  const cash = career.cash; assert.equal(buyWeapon(career, 'minigun').ok, true); assert.equal(career.cash, cash - 105000);
  const starter = DEFAULT_PROFILE(), bought = structuredClone(starter);
  // Existing owned miniguns retain their purchased tuning independently of the
  // fresh-career purchase gate; their mounted art/health effects stay unchanged.
  bought.weapons.minigun = { dmg: 3, mag: 3, rel: 3, hnd: 3 }; bought.loadout = ['minigun'];
  const a = effects(starter), b = effects(bought);
  for (const key of ['hpMul', 'bulletResist', 'gunnerHp', 'gunnerArmor', 'armorTier', 'driverHp', 'driverArmor']) {
    assert.equal(typeof a[key], 'number', key); assert.deepEqual(b[key], a[key], key);
  }
});

test('authored asset is a deck pedestal with six hollow barrels and grips at actual spade centers', () => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const byName = name => authored.nodes.find(n => n.name === name);
  assert.ok(byName('gun_mount_base')); assert.ok(byName('pedestal')); assert.ok(byName('footplate'));
  const barrels = authored.nodes.filter(n => /^barrel_\d$/.test(n.name)); assert.equal(barrels.length, 6);
  assert.equal(new Set(barrels.map(n => n.mesh)).size, 1, 'the six tubes reuse one hollow-barrel mesh');
  const posAccessor = authored.accessors[authored.meshes[barrels[0].mesh].primitives[0].attributes.POSITION];
  const view = authored.bufferViews[posAccessor.bufferView], binOffset = 20 + jsonLength + 8;
  const radii = new Set();
  for (let i = 0; i < posAccessor.count; i++) {
    const off = binOffset + view.byteOffset + i * 12;
    radii.add(Math.hypot(bytes.readFloatLE(off), bytes.readFloatLE(off + 4)).toFixed(2));
  }
  assert.ok(radii.has('0.62') && radii.has('1.00'), 'real geometry includes the inner bore and outer wall');
  const handles = authored.nodes.filter(n => n.name === 'spade_handle'); assert.equal(handles.length, 2);
  for (const side of ['L', 'R']) assert.ok(handles.some(n => n.translation.every((v, i) => v === MINIGUN_SOCKETS['grip_' + side][i])));
  const pitch = byName('gun_mount_pitch'), rotor = byName('gun_mg_barrels');
  for (const socket of Object.keys(MINIGUN_SOCKETS)) {
    const index = authored.nodes.findIndex(n => n.name === socket);
    const parent = socket === 'muzzle' ? rotor : pitch;
    assert.ok(parent.children.includes(index), `${socket} stays on its authored moving assembly`);
  }
  const firingBarrel = byName('barrel_0'), muzzle = byName('muzzle');
  close(new THREE.Vector3(...muzzle.translation), new THREE.Vector3(firingBarrel.translation[0], firingBarrel.translation[1],
    firingBarrel.translation[2] + posAccessor.max[2] * firingBarrel.scale[2]), 'muzzle is at the actual hollow tube front-center');
  assert.deepEqual(muzzle.translation, [...MINIGUN_SOCKETS.muzzle]);
});

test('merged moving rig stays bolted to rolling vehicle while muzzle follows world aim', async t => {
  const gun = await fixture(t), car = new THREE.Group();
  car.position.set(12, 3, -9); car.rotation.set(.42, .8, -.35, 'YXZ');
  const seat = [0, .555, -.86]; gun.attachToDeck(car, seat);
  const deckPoint = gun.root.position.clone(), baseWorld = gun.nodes.gun_mount_base.getWorldPosition(new THREE.Vector3());
  const dir = new THREE.Vector3(.5, .24, -.82).normalize();
  assert.equal(gun.aimWorld(dir), true);
  const forward = gun.pitchJoint.getWorldDirection(new THREE.Vector3()); close(forward, dir, 'muzzle heading');
  close(gun.root.position, deckPoint, 'base remains in deck coordinates');
  close(gun.nodes.gun_mount_base.getWorldPosition(new THREE.Vector3()), baseWorld, 'traversing does not move base');
  assert.equal(gun.root.parent, car); assert.equal(gun.yawJoint.parent, gun.model.getObjectByName('mounted_minigun'));
  close(deckPoint, new THREE.Vector3(...seat).add(new THREE.Vector3(...MINIGUN_DECK_OFFSET)));
  assert.equal(gun.fallback, false);
  const sight = new THREE.Vector3(), eye = new THREE.Vector3(); gun.sightWorld(sight); gun.eyeWorld(eye);
  close(eye, sight.clone().addScaledVector(dir, -.30), 'ADS eye follows real moving sight');
  const eject = new THREE.Vector3(), ejectDirection = new THREE.Vector3(); gun.ejectWorld(eject, ejectDirection);
  const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(gun.pitchJoint.getWorldQuaternion(new THREE.Quaternion()));
  close(ejectDirection, right, 'casing direction leaves the gun-right side of the traversing rig');
});

test('factory ADS line passes through a physical open window after load-time merging', async t => {
  const gun = await fixture(t), car = new THREE.Group(); gun.attachToDeck(car, [0, .555, -.86]);
  car.rotation.set(.18, -.6, .13, 'YXZ'); gun.aimWorld(new THREE.Vector3(.3, .12, .9).normalize());
  const eye = new THREE.Vector3(), dir = gun.pitchJoint.getWorldDirection(new THREE.Vector3()); gun.eyeWorld(eye);
  const opaque = [];
  gun.model.traverse(o => { if (o.isMesh && !Array.isArray(o.material) && !o.material.transparent) opaque.push(o); });
  const hits = new THREE.Raycaster(eye, dir, 0, 1.5).intersectObjects(opaque, false);
  assert.equal(hits.length, 0, 'there is no solid optic cap, receiver or riser across the optical center');
  assert.equal(gun.optic.reticle.material.depthTest, true); assert.equal(gun.optic.reticle.material.depthWrite, false);
  assert.equal(gun.optic.reticle.castShadow, false); assert.deepEqual(gun.prepareSightBores(), []);
});

test('rotor and reload mechanisms cannot move pedestal or hip/ADS spade grips', async t => {
  const gun = await fixture(t), car = new THREE.Group(); gun.attachToDeck(car, [0, .555, -.86]);
  gun.aimWorld(new THREE.Vector3(-.3, .2, .85).normalize());
  const base = gun.nodes.gun_mount_base.getWorldPosition(new THREE.Vector3());
  const grips = ['grip_L', 'grip_R'].map(name => gun.sockets[name].getWorldPosition(new THREE.Vector3()));
  const rotorRest = gun.rotor.quaternion.clone(), muzzleBefore = new THREE.Vector3(); gun.muzzleWorld(muzzleBefore); gun.fire(20);
  for (let i = 0; i < 5; i++) gun.update(.016, { trigger: true });
  assert.ok(gun.rotor.quaternion.angleTo(rotorRest) > .05, 'actual barrel geometry rotates');
  const muzzleAfter = new THREE.Vector3(); gun.muzzleWorld(muzzleAfter);
  assert.ok(muzzleAfter.distanceTo(muzzleBefore) > .001, 'round origin follows the firing bore as the real rotor turns');
  const boreTip = new THREE.Vector3(...MINIGUN_SOCKETS.muzzle).applyMatrix4(gun.rotor.matrixWorld);
  close(muzzleAfter, boreTip, 'merged moving socket stays calibrated to the real bore tip');
  gun.update(.016, { reloading: true, reload01: .4 });
  assert.equal(gun.nodes.mag.visible, false); assert.ok(gun.nodes.feed_cover.quaternion.angleTo(gun.rest.feed_cover.q) > .5);
  gun.update(.016, { reloading: false });
  assert.equal(gun.nodes.mag.visible, true); close(gun.nodes.mag.position, gun.rest.mag.p, 'drum restored');
  assert.ok(gun.nodes.feed_cover.quaternion.angleTo(gun.rest.feed_cover.q) < 1e-7);
  close(gun.nodes.gun_mount_base.getWorldPosition(new THREE.Vector3()), base, 'reload keeps footplate connected');
  ['grip_L', 'grip_R'].forEach((name, i) => close(gun.sockets[name].getWorldPosition(new THREE.Vector3()), grips[i], name));
});

test('dispose releases only private reticle resources once, preserving shared model geometry', async t => {
  const gun = await fixture(t), shared = gun.model.getObjectByName('footplate');
  // mergeRigid may absorb the named footplate; choose an actual cached-model mesh instead.
  let modelMesh = shared?.isMesh ? shared : null;
  gun.model.traverse(o => { if (!modelMesh && o.isMesh) modelMesh = o; });
  let geometryDisposals = 0, reticleDisposals = 0, planeDisposals = 0;
  modelMesh.geometry.addEventListener('dispose', () => geometryDisposals++);
  gun.optic.reticle.material.addEventListener('dispose', () => reticleDisposals++);
  gun.optic.reticle.geometry.addEventListener('dispose', () => planeDisposals++);
  const privateMaterials = new Set(); let sourceDisposals = 0, privateDisposals = 0;
  gun.model.traverse(o => { if (o.isMesh && o !== gun.optic.reticle) for (const m of [].concat(o.material)) privateMaterials.add(m); });
  for (const m of gun.testSourceMaterials) m.addEventListener('dispose', () => sourceDisposals++);
  for (const m of privateMaterials) {
    assert.ok(!gun.testSourceMaterials.has(m), 'opaque template materials are isolated per mount');
    m.addEventListener('dispose', () => privateDisposals++);
  }
  gun.dispose(); gun.dispose();
  assert.equal(geometryDisposals, 0); assert.equal(reticleDisposals, 1); assert.equal(planeDisposals, 1);
  assert.equal(sourceDisposals, 0); assert.equal(privateDisposals, privateMaterials.size);
});

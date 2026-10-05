import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WeaponView } from '../src/view/weapon_view.js';
import { MountedGun } from '../src/view/mounted_gun.js';
import { weaponAttachmentPlan, weaponVisualKey } from '../src/view/weapon_attachments.js';
import { WeaponLaser } from '../src/view/weapon_laser.js';
import { GunnerCam, scopeFovForZoom } from '../src/view/camera_rig.js';

const lv = Object.freeze({ dmg: 3, mag: 3, rel: 3, hnd: 3 });
const kit = Object.freeze(['extended_mag', 'laser', 'foregrip', 'stock']);
function firearm(id) {
  const model = new THREE.Group();
  const add = (name, parent = model, p = [0, 0, 0]) => { const n = new THREE.Group(); n.name = name; n.position.fromArray(p); parent.add(n); return n; };
  add('body'); add('mag', model, [0, .047, .075]);
  const pump = add('pump', model, [0, .027, .30]);
  add('cylinder'); add('crane'); add('rocket'); add('bolt'); add('slide'); add('charging_handle'); add('trigger');
  add('feed_cover'); add('optic'); add('scope');
  add('muzzle', model, id === 'shotgun' ? [0, .054, .683] : [0, .064, .334]);
  add('eject', model, [-.02, .074, .05]); add('grip_R');
  add('grip_L', id === 'shotgun' ? pump : model, id === 'shotgun' ? [0, 0, .05] : [.004, .04, .188]);
  add('mag_well'); add('sight', model, [0, .107, -.15]); add('stock', model, [0, .062, -.322]);
  return model;
}
const almost = (a, b, eps = 1e-8) => assert.ok(a.distanceTo(b) < eps, `${a.toArray()} != ${b.toArray()}`);

test('actual geometry is nonempty, merged by material/parent and individually owned', () => {
  const gun = new WeaponView('smg', { model: firearm('smg'), levels: lv, attachments: kit });
  assert.deepEqual(gun.attachmentIds, kit);
  assert.equal(gun.modifications.objects.length, 7);
  const sources = new Set(gun.modifications.plan.map(row => row.track).filter(Boolean));
  assert.deepEqual([...sources].sort(), ['dmg', 'hnd', 'mag', 'rel']);
  for (const mesh of gun.modifications.objects) {
    assert.ok(mesh.geometry.attributes.position.count > 0);
    assert.equal(mesh.geometry.index, null);
    assert.ok(mesh.geometry.boundingBox.min.toArray().every(Number.isFinite));
    assert.equal(mesh.userData.weaponMod, true);
    assert.ok(mesh.userData.weaponAttachments.length);
    assert.ok(gun._ownedResources.includes(mesh.geometry));
    assert.equal(mesh.castShadow, false);
  }
  let disposals = 0; for (const mesh of gun.modifications.objects) mesh.geometry.addEventListener('dispose', () => disposals++);
  gun.dispose(); gun.dispose(); assert.equal(disposals, 7);
});

test('extended magazine actually follows mag translation and removal visibility', () => {
  const gun = new WeaponView('smg', { model: firearm('smg'), attachments: ['extended_mag'] });
  const extension = gun.modifications.objects.find(mesh => mesh.userData.weaponAttachments.includes('capacity_extension'));
  assert.equal(extension.parent, gun.nodes.mag);
  const before = extension.getWorldPosition(new THREE.Vector3());
  gun.update(1 / 60, { parts: { mag: 1, magVisible: false } });
  const after = extension.getWorldPosition(new THREE.Vector3());
  almost(after.clone().sub(before), new THREE.Vector3(0, -.19, 0));
  assert.equal(extension.parent.visible, false);
  gun.update(1 / 60, { parts: { mag: 0, magVisible: true } });
  assert.equal(extension.parent.visible, true); almost(extension.getWorldPosition(new THREE.Vector3()), before);
  gun.dispose();
});

test('shotgun uses stationary magazine tube, grip follows real pump and does not move muzzle', () => {
  const gun = new WeaponView('shotgun', { model: firearm('shotgun'), attachments: ['extended_mag', 'foregrip'] });
  const tube = gun.modifications.objects.find(mesh => mesh.userData.weaponAttachments.includes('capacity_extension'));
  const grip = gun.modifications.objects.find(mesh => mesh.userData.weaponAttachments.includes('foregrip'));
  assert.equal(tube.parent, gun.nodes.body); assert.equal(grip.parent, gun.nodes.pump);
  const muzzle = gun.sockets.muzzle.getWorldPosition(new THREE.Vector3()), t = tube.getWorldPosition(new THREE.Vector3());
  const hand = gun.sockets.grip_L.getWorldPosition(new THREE.Vector3());
  almost(hand, new THREE.Vector3(0, .009, .34));
  gun.update(1 / 60, { parts: { pump: 1 } });
  almost(tube.getWorldPosition(new THREE.Vector3()), t);
  almost(gun.sockets.muzzle.getWorldPosition(new THREE.Vector3()), muzzle);
  almost(gun.sockets.grip_L.getWorldPosition(new THREE.Vector3()).sub(hand), new THREE.Vector3(0, 0, -.062));
  gun.dispose();
});

test('revolver and RPG reject absurd box magazines, foregrips and rifle stocks', () => {
  for (const id of ['revolver', 'rpg']) {
    const plan = weaponAttachmentPlan(id, lv, kit);
    assert.ok(!plan.some(row => row.id === 'capacity_extension' || row.id === 'stock' || row.id === 'foregrip'));
    assert.ok(plan.some(row => row.track === 'mag'));
    assert.ok(plan.some(row => row.track === 'rel'));
    assert.ok(plan.some(row => row.track === 'dmg'));
    assert.ok(plan.some(row => row.track === 'hnd'));
  }
});

test('appearance cache keys distinguish every tier and installed part but preserve stock identity', () => {
  assert.equal(weaponVisualKey('smg'), 'smg');
  assert.equal(weaponVisualKey('smg', 'wide_reflex'), 'smg:wide_reflex');
  const keys = new Set([weaponVisualKey('smg')]);
  for (const track of ['dmg', 'mag', 'rel', 'hnd']) for (let n = 1; n <= 3; n++) keys.add(weaponVisualKey('smg', 'standard', { [track]: n }));
  for (const part of kit) keys.add(weaponVisualKey('smg', 'standard', {}, [part]));
  assert.equal(keys.size, 17);
  assert.equal(weaponVisualKey('smg', 'standard', {}, ['laser', 'stock']), weaponVisualKey('smg', 'standard', {}, ['stock', 'laser', 'laser']));
});

test('mounted extended feed is a bigger real drum parented to moving ammo node', () => {
  const gun = new MountedGun('minigun', { levels: lv, attachments: ['extended_mag', 'laser'] });
  const plan = gun.modifications.plan.find(row => row.id === 'capacity_extension');
  assert.ok(plan.pieces.every(piece => piece.kind === 'tube' && piece.axis === 'x'));
  const mesh = gun.modifications.objects.find(m => m.userData.weaponAttachments.includes('capacity_extension'));
  assert.equal(mesh.parent, gun.nodes.mag);
  const before = mesh.getWorldPosition(new THREE.Vector3());
  gun.update(1 / 60, { reloading: true, reload01: .40 });
  const after = mesh.getWorldPosition(new THREE.Vector3());
  almost(after.clone().sub(before), new THREE.Vector3(.23, -.161, 0));
  assert.equal(gun.nodes.mag.visible, false); assert.ok(gun.sockets.laser_emitter);
  gun.dispose();
});

test('laser world collision is bounded, excludes own truck, and does not join weapon bounds', () => {
  const scene = new THREE.Scene(), laser = new WeaponLaser(scene), gun = new WeaponView('smg', { model: firearm('smg'), attachments: ['laser'] });
  let worldQueries = 0, ownQueries = 0, enemyQueries = 0;
  const own = { id: 1, raycast() { ownQueries++; return { t: 1 }; } }, enemy = { id: 2, raycast(_o, _d, max) { enemyQueries++; assert.ok(max <= 80); return { t: 5 }; } };
  const G = { weaponId: 'smg', attachments: { smg: ['laser'] }, aimPoint: new THREE.Vector3(0, 0, 90), reloading: false, swapT: 0, throwing: 0,
    ctx: { ownCar: () => own, targets: () => [own, enemy], raycastWorld(_o, _d, max) { worldQueries++; assert.equal(max, 80); return { t: 20 }; } } };
  const origin = { laserWorld(out) { out.set(0, 0, 0); return true; } };
  laser.update(1 / 60, G, gun, origin);
  assert.equal(laser.root.parent, scene); assert.equal(laser.root.parent === gun.root, false);
  assert.equal(ownQueries, 0); assert.equal(enemyQueries, 1); assert.equal(worldQueries, 1);
  assert.equal(laser.hit, true); assert.equal(laser.endpoint.z, 5);
  assert.ok(laser.positions[5] <= .651); assert.equal(laser.dot.visible, true);
  laser.update(1 / 60, G, gun, origin); assert.equal(worldQueries, 1);
  G.reloading = true; laser.update(1 / 60, G, gun, origin); assert.equal(laser.root.visible, false);
  laser.dispose(); laser.dispose(); assert.equal(laser.root.parent, null); gun.dispose();
});

test('selected 3x optic produces actual 3x world projection at every settings FOV and under boost', () => {
  const eye = new THREE.Vector3(0, 2, 0), quat = new THREE.Quaternion();
  for (const fovBase of [60, 80, 100, 120]) for (const firstPerson of [true, false]) for (const boosting of [false, true]) {
    const camera = new THREE.PerspectiveCamera(80, 16 / 9, .05, 1000), rig = new GunnerCam(camera); rig.firstPerson = firstPerson;
    for (let i = 0; i < 240; i++) rig.update(1 / 60, eye, .4, .1, true, { scoped: true, scopeZoom: 3, scopeFov: 24, fovBase, boosting, speed01: 1, truckQuat: quat });
    const reference = firstPerson ? fovBase - 4 : 62;
    const actualZoom = Math.tan(reference * Math.PI / 360) / Math.tan(camera.fov * Math.PI / 360);
    assert.ok(Math.abs(actualZoom - 3) < .012, `base=${fovBase}, fp=${firstPerson}, boost=${boosting}, zoom=${actualZoom}`);
    assert.ok(Math.abs(rig.fov - scopeFovForZoom(reference, 3)) < 1e-8);
  }
});

test('legacy fixed sniper/RPG zoom and ordinary ADS retain their former boost framing', () => {
  for (const scopeFov of [14, 30]) {
    const camera = new THREE.PerspectiveCamera(80, 16 / 9, .05, 1000), rig = new GunnerCam(camera);
    for (let i = 0; i < 240; i++) rig.update(1 / 60, new THREE.Vector3(), .2, .1, true, { scoped: true, scopeFov, fovBase: 80, boosting: true });
    assert.ok(Math.abs(rig.fov - (scopeFov + 6)) < 1e-8);
  }
});

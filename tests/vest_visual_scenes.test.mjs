// CPU source/asset regression suite; creates no renderer or browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWeaponAssets, THREE, Assets } from './helpers/weapon-assets.mjs';
import { GarageScene } from '../src/game/garage_scene.js';
import { TitleScene } from '../src/game/title_scene.js';
import { WorldView } from '../src/game/world_view.js';
import { buildPlayerSpec, gunnerLoadout } from '../src/game/run_setup.js';
import { DEFAULT_PROFILE, effects } from '../src/data/upgrades.js';
import { VEHICLES, vehicleModelURL } from '../src/data/vehicles.js';
import { VEHICLE_FAMILIES, PLAYER_VEHICLE_IDS } from '../src/data/vehicle_families.js';
import { sanitizeVisualLevels } from '../src/view/car_upgrade_plan.js';
import { makeCarState } from '../src/view/car_state.js';

await loadWeaponAssets();
// Load actual menu/world characters and all three player families through the
// shipped Assets path. Only file transport and browser image decoding differ.
const assetURLs = [...new Set([
  ...['hero_driver', 'raider_a', 'raider_b', 'raider_c', 'raider_d', 'raider_driver'].map(id => `/models/characters/${id}.glb`),
  ...[...PLAYER_VEHICLE_IDS, 'e_technical', 'e_buggy', 'e_muscle', 'e_sedan'].map(id => vehicleModelURL(VEHICLES[id])),
])];
const old = Object.fromEntries(['fetch', 'Request', 'self', 'createImageBitmap', 'ProgressEvent'].map(key => [key, globalThis[key]]));
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
globalThis.Request = class extends old.Request {
  constructor(url, opts) { super(typeof url === 'string' && url.startsWith('/') ? 'http://vest-scenes-test.local' + url : url, opts); }
};
globalThis.fetch = async request => {
  const url = new URL(typeof request === 'string' ? request : request.url);
  if (url.origin !== 'http://vest-scenes-test.local') return old.fetch(request);
  return new Response(readFileSync(new URL('../public' + url.pathname, import.meta.url)), { headers: { 'Content-Type': 'application/octet-stream' } });
};
try { await Assets.preload(assetURLs); }
finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
for (const url of assetURLs) assert.ok(Assets.has(url), `requires shipped ${url}, never placeholder proof`);

function mockImages(t) { t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture()); }
// Failure diagnostics must never format cyclic Three graphs or their buffers.
const same = (actual, expected, label) => assert.ok(actual === expected, label);
const different = (actual, expected, label) => assert.ok(actual !== expected, label);
function sameMembers(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: member count`);
  for (let i = 0; i < expected.length; i++) same(actual[i], expected[i], `${label}: exact member ${i}`);
}
function hiddenVests(crew) {
  assert.equal(crew.kind, 'hero_gunner'); assert.equal(crew.rigged, true);
  for (const name of ['armor_t1', 'armor_t2', 'armor_t3']) {
    const node = crew.model.getObjectByName(name);
    assert.ok(node?.isSkinnedMesh, `actual authored ${name} remains in the model`);
    assert.equal(node.visible, false); assert.ok(node.parent); same(crew.bones[name], node, `${name}: exact public ownership node`);
  }
  assert.equal(Object.hasOwn(crew.opts, 'armorTier'), false, 'creation sites have retired the visual option');
}
function appearance(view) {
  return { upgradeKey: view.upgradeKey, levels: structuredClone(view.upgradeLevels),
    kit: view.upgradeKit, trim: view.stageTrim,
    records: [...(view.upgradeKit?.records || []), ...(view.stageTrim?.records || [])].map(({ mesh, anchor }) => ({ mesh, geometry: mesh.geometry, anchor, visible: mesh.visible })) };
}
function sameAppearance(view, before, label) {
  assert.equal(view.upgradeKey, before.upgradeKey, `${label}: upgrade key`);
  assert.deepEqual(view.upgradeLevels, before.levels, `${label}: bounded numerical levels`);
  same(view.upgradeKit, before.kit, `${label}: exact installed kit`); same(view.stageTrim, before.trim, `${label}: exact family trim`);
  const records = [...(view.upgradeKit?.records || []), ...(view.stageTrim?.records || [])];
  assert.equal(records.length, before.records.length, `${label}: installed part count`);
  for (let i = 0; i < records.length; i++) {
    const current = records[i], saved = before.records[i];
    same(current.mesh, saved.mesh, `${label}: exact part ${i}`); same(current.mesh.geometry, saved.geometry, `${label}: exact geometry ${i}`);
    same(current.anchor, saved.anchor, `${label}: exact authored anchor ${i}`); assert.equal(current.mesh.visible, saved.visible, `${label}: part ${i} visibility`);
  }
}
function garageFixture(t) {
  mockImages(t);
  const scene = new THREE.Scene(), turntable = new THREE.Group(); scene.add(turntable);
  const garage = Object.assign(Object.create(GarageScene.prototype), {
    scene, turntable, crew: [], preview: {}, view: null, ringMat: new THREE.MeshStandardMaterial(),
    base: { truck: 'player_sedan_t1', paint: 0x8f6a3d, weapon: 'pistol', opticId: 'standard', upgradeLevels: sanitizeVisualLevels() },
  });
  t.after(() => {
    for (const crew of garage.crew) crew.dispose(); garage.view?.dispose(); garage._buildBench(null);
    garage.ringMat.dispose(); garage._plinthMat?.dispose();
  });
  return garage;
}
function titleFixture(t) {
  mockImages(t);
  const title = Object.assign(Object.create(TitleScene.prototype), { scene: new THREE.Scene(), cars: [] });
  t.after(() => { for (const car of title.cars) { car.view.dispose(); for (const crew of car.crew) crew.dispose(); } });
  return title;
}
const familyLevels = { sedan: { armor: 3, ram: 2, glass: 2 }, rustbucket: { armor: 5, ram: 3, spikes: 2, nitro: 5 }, buggy: { armor: 2, engine: 5, tires: 5 } };

test('stale owned and preview tiers cannot rebuild real garage crew, bench, chassis or installed family parts', t => {
  const garage = garageFixture(t);
  for (const [family, data] of Object.entries(VEHICLE_FAMILIES)) {
    const id = data.stageIDs.at(-1), loadout = { weapon: 'rifle', opticId: 'wide_reflex', upgradeLevels: familyLevels[family], armorTier: 0 };
    garage.setPreview({}); garage.setTruck(id, 0x8f6a3d, loadout);
    assert.equal(garage.view.usesModel, true);
    const crew = garage.crew.slice(), driver = crew.find(c => c.role === 'driver'), view = garage.view, bench = garage.benchWeapon, before = appearance(view);
    assert.ok(driver?.model && garage.gunnerCrew); hiddenVests(garage.gunnerCrew);
    assert.ok(before.records.length > 0, 'family-specific installed parts remain visible');
    assert.deepEqual(view.upgradeLevels, sanitizeVisualLevels(familyLevels[family]));
    for (const tier of [1, 2, 3, '3', Infinity]) {
      garage.setTruck(id, 0x8f6a3d, { ...loadout, armorTier: tier });
      garage.setPreview({ armorTier: tier });
      assert.equal(Object.hasOwn(garage.base, 'armorTier'), false);
      same(garage.view, view, 'stale tier retains exact chassis'); same(garage.benchWeapon, bench, 'stale tier retains exact bench');
      sameMembers(garage.crew, crew, 'stale tier retains crew'); same(garage.crew.find(c => c.role === 'driver'), driver, 'stale tier retains exact driver');
      sameAppearance(view, before, 'vest input cannot replace, hide or rebuild vehicle armor/trim');
      hiddenVests(garage.gunnerCrew);
    }
  }
});

test('real garage weapon/sight changes still rebuild owned crew and previews without vest state', t => {
  const garage = garageFixture(t), id = 'truck_t3', upgradeLevels = familyLevels.rustbucket;
  garage.setTruck(id, 0x8f6a3d, { weapon: 'rifle', opticId: 'standard', upgradeLevels, armorTier: 1 });
  const chassis = garage.view, parts = appearance(chassis), first = garage.gunnerCrew;
  garage.setTruck(id, 0x8f6a3d, { weapon: 'rifle', opticId: 'wide_reflex', upgradeLevels, armorTier: 3 });
  different(garage.gunnerCrew, first, 'sight change replaces crew'); same(first.root.parent, null, 'old crew detaches after sight change');
  assert.equal(garage.gunnerCrew.weaponId, 'rifle'); assert.equal(garage.gunnerCrew.opticId, 'wide_reflex');
  const second = garage.gunnerCrew, secondBench = garage.benchWeapon;
  garage.setTruck(id, 0x8f6a3d, { weapon: 'smg', opticId: 'standard', upgradeLevels, armorTier: 2 });
  different(garage.gunnerCrew, second, 'weapon change replaces crew'); same(second.root.parent, null, 'old crew detaches after weapon change');
  assert.equal(garage.gunnerCrew.weaponId, 'smg'); assert.equal(garage.gunnerCrew.opticId, 'standard');
  different(garage.benchWeapon, secondBench, 'weapon change replaces bench'); assert.equal(secondBench.view.disposed, true);
  const owned = garage.gunnerCrew, ownCrew = garage.crew.slice(), bench = garage.benchWeapon;
  garage.setPreview({ weapon: 'pistol', opticId: 'wide_reflex', armorTier: 3 });
  same(garage.gunnerCrew, owned, 'preview retains owned gunner'); sameMembers(garage.crew, ownCrew, 'preview retains owned crew');
  different(garage.benchWeapon, bench, 'preview changes bench'); assert.equal(garage.benchWeapon.view.id, 'pistol');
  assert.equal(garage.benchWeapon.view.opticId, 'wide_reflex');
  same(garage.view, chassis, 'weapon preview retains chassis'); sameAppearance(chassis, parts, 'weapon preview retains installed parts');
  hiddenVests(owned);
});

test('stale title tiers cannot rebuild actual chase cars while weapon/sight and family appearance changes still do', t => {
  const title = titleFixture(t), id = 'player_sedan_t2', upgradeLevels = familyLevels.sedan;
  title.setHero(id, 0x8f6a3d, 'rifle', { opticId: 'standard', upgradeLevels, armorTier: 0 });
  const hero = title.hero, cars = title.cars.slice(), before = appearance(hero.view), key = title.heroKey;
  assert.equal(hero.view.usesModel, true); hiddenVests(hero.gunner);
  const enemies = cars.filter(c => c.gunner).slice(1).map(c => ({ crew: c.gunner, kind: c.gunner.kind, ai: c.gunner.ai, weapon: c.gunner.weaponId }));
  assert.equal(enemies.length, 2); assert.ok(enemies.every(c => c.ai && /^raider/.test(c.kind)));
  for (const tier of [1, 2, 3, '3', NaN]) {
    title.setHero(id, 0x8f6a3d, 'rifle', { opticId: 'standard', upgradeLevels, armorTier: tier });
    same(title.hero, hero, 'stale tier retains exact title hero'); sameMembers(title.cars, cars, 'stale tier retains chase cars'); assert.equal(title.heroKey, key);
    sameAppearance(hero.view, before, 'stale title tier retains family parts'); hiddenVests(hero.gunner);
    const enemyCrew = title.cars.filter(c => c.gunner).slice(1).map(c => c.gunner);
    sameMembers(enemyCrew, enemies.map(e => e.crew), 'stale tier retains enemy crews');
    assert.deepEqual(enemyCrew.map(c => ({ kind: c.kind, ai: c.ai, weapon: c.weaponId })), enemies.map(({ kind, ai, weapon }) => ({ kind, ai, weapon })), 'bounded enemy metadata is unchanged');
  }
  title.setHero(id, 0x8f6a3d, 'rifle', { opticId: 'wide_reflex', upgradeLevels, armorTier: 3 });
  different(title.hero, hero, 'title sight change replaces hero'); assert.equal(hero.view.disposed, true); same(hero.gunner.root.parent, null, 'old title gunner detaches');
  assert.equal(title.hero.gunner.opticId, 'wide_reflex'); assert.deepEqual(title.hero.view.upgradeLevels, before.levels);
  const reflex = title.hero;
  title.setHero(id, 0x8f6a3d, 'smg', { opticId: 'wide_reflex', upgradeLevels, armorTier: 1 });
  different(title.hero, reflex, 'title weapon change replaces hero'); assert.equal(title.hero.gunner.weaponId, 'smg'); hiddenVests(title.hero.gunner);
  const smg = title.hero;
  title.setHero('player_buggy_t3', 0x8f6a3d, 'smg', { opticId: 'wide_reflex', upgradeLevels: familyLevels.buggy, armorTier: 2 });
  different(title.hero, smg, 'title family change replaces hero'); assert.equal(title.hero.spec.family, 'buggy');
  assert.deepEqual(title.hero.view.upgradeLevels, sanitizeVisualLevels(familyLevels.buggy));
  assert.ok(title.hero.view.stageTrim?.records.length > 0); hiddenVests(title.hero.gunner);
});

test('WorldView ignores stale tier properties for every player gunner and retains driver, seats, optic and enemy contracts', t => {
  mockImages(t);
  const world = new WorldView({ scene: new THREE.Scene(), playerUpgradeLevels: familyLevels.rustbucket, playerWeaponOptics: { rifle: 'wide_reflex' } });
  t.after(() => world.dispose()); world.playerWeapon = 'rifle';
  assert.equal(Object.hasOwn(world, 'armorTier'), false);
  for (const tier of [1, 2, 3]) {
    world.armorTier = tier; // A stale caller/property cannot be consumed by ensure.
    const st = makeCarState(100 + tier, 'truck_t3', 'player');
    // Exercise all public player gunner creation roles using actual authored
    // hero geometry and distinct declared seats, without changing sim stats.
    st.spec = { ...st.spec, seats: { ...st.spec.seats, gunner2: [1.4, st.spec.seats.gunner[1], -.5], gunner3: [-1.4, st.spec.seats.gunner[1], -.5], gunner4: [0, st.spec.seats.gunner[1], -1.6] } };
    const before = { armor: st.spec.armor, gunnerHp: st.spec.gunnerHp, gunnerArmor: st.spec.gunnerArmor }, rec = world.ensure(st);
    assert.equal(rec.crew.driver.kind, 'hero_driver'); same(rec.crew.driver.weapon, null, 'driver remains unarmed');
    assert.deepEqual(rec.crew.driver.root.position.toArray(), st.spec.seats.driver);
    for (const role of ['gunner', 'gunner2', 'gunner3', 'gunner4']) {
      const crew = rec.crew[role]; hiddenVests(crew);
      assert.equal(crew.weaponId, 'rifle'); assert.equal(crew.opticId, 'wide_reflex');
      assert.deepEqual(crew.root.position.toArray(), st.spec.seats[role]);
    }
    assert.deepEqual({ armor: st.spec.armor, gunnerHp: st.spec.gunnerHp, gunnerArmor: st.spec.gunnerArmor }, before);
    assert.deepEqual(rec.view.upgradeLevels, sanitizeVisualLevels(familyLevels.rustbucket));
  }
  const enemy = makeCarState(11, 'e_technical', 'enemy'); enemy.gunName = 'smg';
  const enemyBefore = { armor: enemy.spec.armor, gunnerArmor: enemy.spec.gunnerArmor, gunnerHp: enemy.spec.gunnerHp }, rec = world.ensure(enemy);
  assert.ok(/^raider/.test(rec.crew.gunner.kind)); assert.equal(rec.crew.gunner.ai, true); assert.equal(rec.crew.gunner.weaponId, 'smg');
  assert.deepEqual({ armor: enemy.spec.armor, gunnerArmor: enemy.spec.gunnerArmor, gunnerHp: enemy.spec.gunnerHp }, enemyBefore);
});

test('run loadout does not read retired tier input and preserves equipped weapons, sights, handling and spec armor values', () => {
  const input = { weapons: ['rifle', 'smg'], weaponLevels: { rifle: { dmg: 2 } }, weaponOptics: { rifle: 'wide_reflex', smg: 'standard' }, grenades: 4, grenadeLv: 2, reloadMul: .8, handling: .9 };
  Object.defineProperty(input, 'armorTier', { enumerable: true, get() { throw new Error('retired presentation input must not be read'); } });
  const loadout = gunnerLoadout(input);
  assert.deepEqual(loadout, { weapons: input.weapons, levels: input.weaponLevels, optics: input.weaponOptics, grenades: 4, grenadeLv: 2, reloadMul: .8, handling: .9 });
  assert.equal(Object.hasOwn(loadout, 'armorTier'), false);
  for (const family of Object.keys(VEHICLE_FAMILIES)) {
    const profile = DEFAULT_PROFILE(); profile.truck = VEHICLE_FAMILIES[family].stageIDs[0];
    profile.vehicleUpgradeSchema = 2; profile.vehicleUpgrades = structuredClone(familyLevels); profile.upgrades.vest = 3;
    const before = structuredClone(profile), e = effects(profile), { spec } = buildPlayerSpec(profile);
    assert.equal(spec.driverHp, e.driverHp); assert.equal(spec.gunnerHp, e.gunnerHp);
    assert.equal(spec.driverArmor, e.driverArmor); assert.equal(spec.gunnerArmor, e.gunnerArmor);
    assert.equal(spec.armor, 1 - e.bulletResist); assert.equal(spec.hp, Math.round(VEHICLES[e.truck].hp * e.hpMul));
    assert.deepEqual(profile, before, 'visual retirement cannot migrate, refund or change family/personal inventory');
  }
});

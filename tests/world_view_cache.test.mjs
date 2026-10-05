import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldView } from '../src/game/world_view.js';

function setup() {
  const world = Object.create(WorldView.prototype), records = new Map(), updates = [];
  Object.assign(world, { cars: records, playerWeapon: 'pistol', fx: {}, loose: [], debris: { update() {} }, _projectiles() {}, handleEvent() {} });
  world.ensure = (state) => {
    if (records.has(state.id)) return records.get(state.id);
    const crew = {}, crewEntries = [];
    for (const role of ['driver', 'gunner', 'gunner2']) {
      const actor = { deadT: -1, root: {}, update(dt, pose) { updates.push({ id: state.id, role, pose, values: { ...pose } }); } };
      crew[role] = actor; crewEntries.push({ role, crew: actor, pose: {} });
    }
    const view = { lodOn: false, wheelNodes: new Map(), update() {}, setLights() {}, setLod(value) { this.lodOn = value; } };
    const rec = { id: state.id, crew, crewEntries, view, wreck: false }; records.set(state.id, rec); return rec;
  };
  const state = (id, distance) => ({ id, kind: id === 1 ? 'player' : 'enemy', pos: new THREE.Vector3(distance, 0, 0), quat: new THREE.Quaternion(), vel: new THREE.Vector3(0, 0, 25), hp01: 1, driverAlive: true, gunnerAlive: true, gunner2Alive: true, steer: .2, speed: 25, airborne: false, intent: 'shoot', gunner: { yaw: .6, pitch: .1, fire: true, ads: true, reloading: true, x: 1, z: 2 }, gunner2: { yaw: -.6, pitch: -.1, fire: false, crouch: true, x: -1, z: -2 } });
  const states = new Map([[1, state(1, 0)], [2, state(2, 45)]]);
  return { world, records, updates, states };
}

test('world-view pose caches stay independent and refresh weapon, crew and local controls every frame', () => {
  const { world, records, updates, states } = setup(), local = { firstPerson: true }, ctx = { cameraPos: new THREE.Vector3(), playerWeaponId: 'smg', localGunner: local };
  world.update(1 / 60, states, [], ctx);
  const first = updates.filter((u) => u.id === 1), gunner = first.find((u) => u.role === 'gunner'), driver = first.find((u) => u.role === 'driver');
  assert.notEqual(gunner.pose, driver.pose);
  assert.equal(gunner.values.local, local); assert.equal(gunner.values.weaponId, 'smg');
  assert.equal(gunner.values.aimYaw, .6); assert.equal(gunner.values.bedX, 0); assert.equal(driver.values.aimYaw, 0);
  const oldPose = gunner.pose;
  states.get(1).gunner = null; states.get(1).gunnerAlive = false;
  world.update(1 / 60, states, [], { cameraPos: ctx.cameraPos, playerWeaponId: 'shotgun' });
  const current = updates.filter((u) => u.id === 1 && u.role === 'gunner').at(-1);
  assert.equal(current.pose, oldPose); assert.equal(current.values.weaponId, 'shotgun'); assert.equal(current.values.local, null);
  assert.equal(current.values.alive, true, 'obsolete player crew flags cannot kill a living hull'); assert.equal(current.values.fire, false); assert.equal(current.values.bedX, 0);
  states.get(1).dead = true;
  world.update(1 / 60, states, [], { cameraPos: ctx.cameraPos, playerWeaponId: 'shotgun' });
  const terminal = updates.filter((u) => u.id === 1 && u.role === 'gunner').at(-1);
  assert.equal(terminal.pose, oldPose); assert.equal(terminal.values.alive, false, 'authoritative hull terminal flag still updates the cached pose');
  assert.equal(records.get(2).crewEntries.length, 3);
});

test('cached optic poses follow the selected weapon and safely restore standard without an optional map', () => {
  const { world, updates, states } = setup();
  world.playerWeaponOptics = Object.freeze({ smg: 'wide_reflex', shotgun: 'standard', sniper: 'wide_reflex' });
  const pose = () => updates.filter(update => update.id === 1 && update.role === 'gunner').at(-1).values;
  world.update(1 / 60, states, [], { playerWeaponId: 'smg' }); assert.equal(pose().opticId, 'wide_reflex');
  world.update(1 / 60, states, [], { playerWeaponId: 'shotgun' }); assert.equal(pose().opticId, 'standard');
  world.update(1 / 60, states, [], { playerWeaponId: 'sniper' }); assert.equal(pose().opticId, 'standard', 'incompatible optics cannot enter a cached pose');
  delete world.playerWeaponOptics;
  world.update(1 / 60, states, [], { playerWeaponId: 'smg' }); assert.equal(pose().opticId, 'standard');
  for (const enemy of updates.filter(update => update.id === 2)) assert.equal(enemy.values.opticId, 'standard');
});

test('distance caching preserves LOD hysteresis, visibility and detached-body updates', () => {
  const { world, records, updates, states } = setup(), ctx = { cameraPos: new THREE.Vector3() }, enemy = states.get(2);
  for (const [distance, lod] of [[46, false], [46.01, true], [40.01, true], [40, false]]) {
    enemy.pos.x = distance; world.update(1 / 60, states, [], ctx); assert.equal(records.get(2).view.lodOn, lod);
  }
  enemy.pos.x = 130.01; world.update(1 / 60, states, [], ctx);
  assert.equal(records.get(2).crew.gunner.root.visible, false); assert.notEqual(records.get(2).crew.gunner.root.matrixWorldAutoUpdate, false);
  const detached = records.get(2).crew.gunner; detached.detached = true; detached.deadT = 1;
  updates.length = 0; world.update(1 / 60, states, [], ctx);
  const dead = updates.filter((u) => u.id === 2); assert.equal(dead.length, 1); assert.equal(dead[0].values.alive, false);
});

test('damage panel crossings stay exact and steady health does not shed extra panels', () => {
  const { world, records, states } = setup(), thrown = [];
  world._throwPanel = (rec, name) => thrown.push(name);
  world.update(1 / 60, states, []); states.get(1).hp01 = .4;
  world.update(1 / 60, states, []);
  assert.deepEqual(thrown, ['bumper_F', 'fender_L', 'door_L', 'door_R2', 'fender_R']);
  world.update(1 / 60, states, []); assert.equal(thrown.length, 5);
  states.get(1).hp01 = .399; world.update(1 / 60, states, []);
  assert.equal(thrown.at(-1), 'hood'); assert.equal(records.get(1).hpPrev, .399);
});

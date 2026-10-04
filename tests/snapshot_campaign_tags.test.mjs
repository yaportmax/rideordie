import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../src/net/snapshot.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { resolveEliteVehicle } from '../src/data/elite_vehicles.js';
import { legacySnapshotPacket } from './helpers/legacy_snapshot.mjs';

function packet({ gun = 'minigun', elite = 8, intent = 'block', weapon = 2 } = {}) {
  const spec = elite === 6 ? resolveEliteVehicle(VEHICLES.e_heavy, 7) : VEHICLES.truck_t1;
  const car = { id: 1, spec, kind: 'enemy', hp: 400, maxHp: 400, engineHp: 100,
    gunName: gun, elite: elite === null ? null : { index: elite }, ai: { intent },
    crew: { driver: { alive: true }, gunner: { alive: true, aimYaw: .2, aimPitch: .1, weapon } },
    veh: { pos: { x: 7, y: 1, z: 42 }, quat: { x: 0, y: 0, z: 0, w: 1 }, poseRevision: 23,
      vel: { x: 0, y: 0, z: 10 }, angvel: { x: 0, y: 0, z: 0 },
      wheels: spec.wheels.map(() => ({ L: .4, slip: 0, grounded: true })), steerAngle: 0, rpm01: .5, brakeApplied: 0 } };
  return encodeSnapshot({ cars: new Map([[1, car]]), time: 1, state: 'run', projectiles: { rockets: [], grenades: [] }, boss: null },
    120, { dist: 42, hp01: 1, dhp01: 1, ghp01: 1, nitro01: .5, medkits: 2 });
}

test('v3 preserves all nine elite identities independently of all four intents and the eighth enemy gun', () => {
  for (let elite = 0; elite < 9; elite++) for (const intent of [null, 'shoot', 'ram', 'block']) {
    const bytes = packet({ elite, intent }), decoded = decodeSnapshot(bytes);
    assert.equal(new DataView(bytes).getUint8(0), 3);
    assert.equal(decoded.cars[0].elite, elite + 1); assert.equal(decoded.cars[0].intent, intent);
    assert.equal(decoded.cars[0].tagIdx, 8); assert.equal(decoded.cars[0].gweapon, 2);
    assert.equal(decoded.cars[0].poseRevision, 23); assert.equal(decoded.cars[0].L.length, elite === 6 ? 6 : 4);
  }
});

test('every gun tag including none/minigun survives the real interpolation materialization', () => {
  const guns = [null, 'pistol', 'smg', 'rifle', 'shotgun', 'mg', 'hmg', 'rpg', 'minigun'];
  for (const gun of guns) {
    const b = new SnapshotBuffer(); b.push(decodeSnapshot(packet({ gun, elite: null, intent: null })), 2); b.sample(2);
    assert.equal(b.states.get(1).gunName, gun); assert.equal(b.states.get(1).elite, 0); assert.equal(b.states.get(1).intent, null);
  }
});

test('v1/v2 known independent packets retain old gun, elite, intent and revision semantics', () => {
  for (const version of [1, 2]) {
    const decoded = decodeSnapshot(legacySnapshotPacket(version)); assert.ok(decoded);
    assert.equal(decoded.tick, 91); assert.equal(decoded.cars[0].x, 7); assert.equal(decoded.cars[0].z, 90);
    assert.equal(decoded.cars[0].tagIdx, 7); assert.equal(decoded.cars[0].elite, 5); assert.equal(decoded.cars[0].intent, 'block');
    assert.equal(decoded.cars[0].poseRevision, version === 2 ? 65500 : 0);
    const b = new SnapshotBuffer(); b.push(decoded, 4); b.sample(4);
    assert.equal(b.states.get(1).gunName, 'rpg'); assert.equal(b.states.get(1).elite, 5);
  }
});

test('malformed new gun/elite/reserved fields and unknown versions fail closed', () => {
  for (const [offset, values] of [[90, [9, 15, 64, 128, 255]], [91, [10, 255]], [0, [0, 4, 255]]]) {
    for (const value of values) { const bad = packet(); new DataView(bad).setUint8(offset, value); assert.equal(decodeSnapshot(bad), null, `${offset}:${value}`); }
  }
  for (const version of [1, 2]) for (const elite of [6, 7]) {
    const bad = legacySnapshotPacket(version); new DataView(bad).setUint8(version === 1 ? 88 : 90, 7 | (elite << 3));
    assert.equal(decodeSnapshot(bad), null);
  }
  const bytes = packet(); for (let size = 0; size < bytes.byteLength; size++) assert.equal(decodeSnapshot(bytes.slice(0, size)), null, `truncated ${size}`);
});

test('encoder refuses invalid catalogue values before bit truncation can alias a different identity', () => {
  for (const change of [{ gun: 'unknown' }, { gun: 'mounted_unknown' }, { elite: -1 }, { elite: 9 }, { elite: 1.5 }, { intent: 'unknown' }]) {
    assert.equal(packet(change), null, JSON.stringify(change));
  }
});

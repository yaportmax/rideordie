import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/peer-import.mjs';
import { advanceCadence, consumeCadence } from '../src/net/cadence.js';
import { decodeSnapshot } from '../src/net/snapshot.js';
const { Run } = await import('../src/game/run.js');

const PERIOD = 1 / 30;
function sendSchedule(deltas) {
  let carry = 0, packets = 0, elapsed = 0;
  const sends = [];
  for (const dt of deltas) {
    elapsed += dt; carry = advanceCadence(carry, dt);
    if (carry >= PERIOD) {
      packets++; carry = consumeCadence(carry); sends.push(elapsed);
    }
    assert(carry >= 0 && carry < PERIOD, 'No full overdue packet survives a frame');
  }
  return { packets, elapsed, carry, sends };
}

test('network scheduling preserves 30Hz at every supported rendering cadence', () => {
  for (const fps of [30, 45, 49, 60, 75, 90, 120, 144]) {
    const schedule = sendSchedule(Array.from({ length: fps * 30 }, () => 1 / fps));
    assert.equal(schedule.packets, 900, `${fps}FPS sends exactly 30Hz across thirty seconds`);
    for (let i = 0; i < schedule.sends.length; i++) {
      assert(Math.abs(schedule.sends[i] - (i + 1) * PERIOD) <= 1 / fps + 1e-9, 'One frame bounds scheduling jitter');
    }
  }
});

test('mixed normal frame durations retain fractional time instead of biasing the packet rate', () => {
  const deltas = Array.from({ length: 2400 }, (_, i) => [1 / 45, 1 / 144, 1 / 75, 1 / 49, 1 / 60][i % 5]);
  const schedule = sendSchedule(deltas);
  assert.equal(schedule.packets, Math.floor(schedule.elapsed / PERIOD + 1e-9));
});

test('long stalls send one current packet and discard overdue bursts', () => {
  const schedule = sendSchedule([1 / 60, 2, 1 / 60, 0, 0, 0, 1 / 60]);
  assert.equal(schedule.packets, 2);
  assert.deepEqual(schedule.sends, [2 + 1 / 60, 2 + 2 / 60]);
  assert(consumeCadence(2) < 1e-12);
  assert(consumeCadence(PERIOD - PERIOD * 1e-10) < 1e-12, 'Roundoff cannot leave an overdue full period');
});

test('invalid deltas and accumulators cannot poison future network scheduling', () => {
  for (const dt of [NaN, Infinity, -1]) assert.equal(advanceCadence(.01, dt), .01);
  for (const carry of [NaN, Infinity, -1]) assert.equal(advanceCadence(carry, .02), .02);
  assert.equal(consumeCadence(NaN), 0);
  assert.equal(consumeCadence(Infinity), 0);
  assert.equal(consumeCadence(-1), 0);
  for (const period of [0, -1, NaN, Infinity]) {
    assert.equal(advanceCadence(.01, .02, period), 0);
    assert.equal(consumeCadence(.01, period), 0);
  }
});

function runFixtures() {
  let gunnerPackets = 0, snapshots = 0, newest = null;
  const net = { sendJSON(m) { if (m.t === 'g') gunnerPackets++; }, sendFast(bytes) { snapshots++; newest = decodeSnapshot(bytes); assert(newest, 'Actual Run snapshot traverses the live wire codec'); } };
  const gunner = { net, gunnerSendAcc: 0, outEvents: [], gunner: { yaw: 0, pitch: 0, trigger: true, magNow: 32, ads: 0, cur: 0, reloading: false } };
  const driver = { net, snapAcc: 0, events: [], player: { hp: 100, maxHp: 100, s: 40, crew: { driver: { hp: 100, max: 100 } }, veh: { nitro: 1, nitroMax: 1 } },
    sim: { cars: new Map(), time: 0, tick: 0, state: 'run', projectiles: { rockets: [], grenades: [] }, boss: null, stats: { kills: 0, streak: 0 }, director: { level: 0 } }, _bossHud() { return { id: 0, hp01: 0 }; } };
  return { driver, gunner, counts: () => ({ gunnerPackets, snapshots, newest }) };
}

test('actual Run gunner controls and vehicle snapshots both sustain30Hz independent of rendering FPS', () => {
  for (const fps of [30, 45, 49, 60, 75, 90, 120, 144]) {
    const f = runFixtures();
    for (let frame = 1; frame <= fps * 30; frame++) {
      f.driver.sim.time = frame / fps; f.driver.sim.tick = frame;
      Run.prototype._sendNet.call(f.driver, 1 / fps); Run.prototype._sendGunner.call(f.gunner, 1 / fps);
    }
    const counts = f.counts(); assert.equal(counts.snapshots, 900, `Actual driver snapshots at${fps}FPS`); assert.equal(counts.gunnerPackets, 900, `Actual gunner controls at${fps}FPS`);
    assert.equal(counts.newest.tick, fps * 30); assert.equal(counts.newest.time, 30, 'Final delivery carries the current authoritative state');
  }
});

test('actual Run sends only one fresh snapshot/control after a long stalled render frame', () => {
  const f = runFixtures(); f.driver.sim.time = 2; f.driver.sim.tick = 240;
  Run.prototype._sendNet.call(f.driver, 2); Run.prototype._sendGunner.call(f.gunner, 2);
  assert.equal(f.counts().snapshots, 1); assert.equal(f.counts().gunnerPackets, 1); assert.equal(f.counts().newest.tick, 240);
  for (let frame = 0; frame < 10; frame++) { Run.prototype._sendNet.call(f.driver, 0); Run.prototype._sendGunner.call(f.gunner, 0); }
  assert.equal(f.counts().snapshots, 1); assert.equal(f.counts().gunnerPackets, 1, 'No stale overdue burst drains on subsequent zero-time frames');
});

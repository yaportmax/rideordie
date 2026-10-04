// Actual App/Session caller regressions. No renderer, pointer, audio or transport
// is started; source modules use their ordinary production import graph.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { loadProfile, saveProfile } from '../src/meta/profile.js';
import { NET_PROTOCOL } from '../src/net/run_packet.js';
import { GARAGE_SEAT_PROTOCOL } from '../src/net/garage_seats.js';
import { PLAYER_VEHICLE_PROTOCOL } from '../src/data/vehicle_families.js';
import { ELITE_VEHICLE_PROTOCOL } from '../src/data/elite_vehicles.js';
import { CAMPAIGN_PROTOCOL } from '../src/data/campaign.js';
import { DRIVING_ROUTE_VERSION } from '../src/world/driving_plan.js';
const { Session } = await import('../src/net/session.js');
const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let App;
try { ({ App } = await import('../src/app.js')); }
finally { css.deregister(); }

function store() {
  const data = new Map(), writes = [];
  return { data, writes, getItem: key => data.get(key) ?? null,
    setItem(key, value) { data.set(key, value); writes.push({ key, value }); },
    removeItem(key) { data.delete(key); } };
}
function withStorage(storage, call) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true, configurable: true });
  try { return call(); }
  finally { if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage; }
}

function pauseFixture(AppClass, { started = false, mode = 'solo', startupError = false } = {}) {
  const storage = store();
  return withStorage(storage, () => {
    // Load and save through the real slot store before taking the quit snapshot.
    const profile = loadProfile();
    profile.cash = 1200; profile.totalCash = 5000; profile.runs = 4;
    saveProfile(profile);
    const before = structuredClone(profile), bytesBefore = [...storage.data];
    const writesBefore = storage.writes.length, calls = { summary: 0, garage: 0, lock: 0, reset: 0, net: [] };
    const run = { started, finished: startupError, startupError: startupError ? new Error('fixture startup failure') : null,
      over: false, sim: { state: started ? 'run' : 'countdown', player: { held: !started } },
      buildSummary() { calls.summary++; return { id: 'quit-earned-current', cash: 240,
        distance: 0, furthestS: 0, time: 0, kills: 0, won: false, journey: { mode: 'campaign', level: 1 } }; } };
    const game = { run, paused: false };
    let menu;
    const app = { game, profile, mode, screen: 'run', _flowId: 10,
      session: mode === 'coop' ? { sendJSON: message => calls.net.push(message) } : null,
      input: { releaseLock() { calls.lock++; }, reset() { calls.reset++; }, requestLock() { throw new Error('Quit must not recapture input'); } },
      ui: { showPause(value) { menu = value; }, hideAll() {} },
      garage() { calls.garage++; this.screen = 'garage'; game.run = null; } };
    AppClass.prototype._pause.call(app);
    assert.ok(menu, 'actual App._pause must install its current-run callbacks');
    assert.equal(game.paused, true);
    return { storage, before, bytesBefore, writesBefore, profile, calls, run, game, app, menu,
      quit() { return withStorage(storage, () => menu.onQuit()); } };
  });
}

test('current actual pause/quit never credits or writes an unstarted countdown or failed-start life', () => {
  for (const startupError of [false, true]) {
    const scene = pauseFixture(App, { startupError });
    scene.quit();
    assert.equal(scene.calls.summary, 0); assert.equal(scene.calls.garage, 1); assert.equal(scene.game.paused, false);
    assert.deepEqual(scene.profile, scene.before, 'cash, runs, upgrades and campaign records remain exactly owned');
    assert.deepEqual([...scene.storage.data], scene.bytesBefore, 'no save-slot/history bytes change before a life starts');
    assert.equal(scene.storage.writes.length, scene.writesBefore);
  }
});

test('started solo quit retains earned payout and actual save persistence', () => {
  const scene = pauseFixture(App, { started: true });
  scene.quit();
  assert.equal(scene.calls.summary, 1); assert.equal(scene.calls.garage, 1);
  assert.equal(scene.profile.cash, scene.before.cash + 240); assert.equal(scene.profile.totalCash, scene.before.totalCash + 240);
  assert.equal(scene.profile.runs, scene.before.runs + 1); assert.equal(scene.profile.lastRunId, 'quit-earned-current');
  assert.deepEqual(scene.profile.campaignProgress, scene.before.campaignProgress, 'abandonment does not clear a chapter');
  assert.ok(scene.storage.writes.length > scene.writesBefore);
  const saved = withStorage(scene.storage, () => loadProfile());
  assert.equal(saved.cash, scene.profile.cash); assert.equal(saved.runs, scene.profile.runs);
});

test('co-op quit preserves host-owned payout policy and sends only the existing abort', () => {
  for (const started of [false, true]) {
    const scene = pauseFixture(App, { started, mode: 'coop' });
    scene.quit();
    assert.deepEqual(scene.calls.net, [{ t: 'abort' }]); assert.equal(scene.calls.summary, 0); assert.equal(scene.calls.garage, 1);
    assert.deepEqual(scene.profile, scene.before); assert.deepEqual([...scene.storage.data], scene.bytesBefore);
    assert.equal(scene.storage.writes.length, scene.writesBefore);
  }
});

test('a stale pause callback cannot abandon or pay a replacement run', () => {
  const scene = pauseFixture(App, { started: true });
  scene.game.run = { started: true, sim: {} }; scene.app._flowId++;
  scene.quit();
  assert.equal(scene.calls.summary, 0); assert.equal(scene.calls.garage, 0);
  assert.deepEqual(scene.profile, scene.before); assert.deepEqual([...scene.storage.data], scene.bytesBefore);
});

class TransportFixture {
  constructor() { this.sent = []; this.closed = 0; this.rtt = 0; }
  async host() { return 'ABCDE'; }
  send(message) { this.sent.push(structuredClone(message)); return true; }
  sendFast() { return true; }
  closeConnection() { this.closed++; this.onClose(); }
  destroy() {}
}
const hello = overrides => ({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL,
  familyVehicles: PLAYER_VEHICLE_PROTOCOL, eliteVehicles: ELITE_VEHICLE_PROTOCOL,
  drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL,
  name: 'Guest', wallet: { playerId: 'friend-current', cash: 100, totalCash: 100 }, ...overrides });

test('current whole Session rejects old route4 and incompatible elite capability while retaining separate family and wire capabilities', async () => {
  assert.equal(DRIVING_ROUTE_VERSION, 5);
  assert.equal(PLAYER_VEHICLE_PROTOCOL, 2, 'vehicle family capability remains separate from route identity');
  assert.equal(ELITE_VEHICLE_PROTOCOL, 1, 'standalone elite models require their own explicit capability');
  const missingElite = hello(); delete missingElite.eliteVehicles;
  const incompatible = [hello({ drivingRoutes: 4 }), hello({ familyVehicles: 1 }), hello({ protocol: NET_PROTOCOL - 1 }),
    hello({ eliteVehicles: 0 }), hello({ eliteVehicles: ELITE_VEHICLE_PROTOCOL + 1 }), missingElite];
  for (const message of incompatible) {
    const tp = new TransportFixture(), session = new Session(tp), errors = [];
    const profile = withStorage(store(), () => loadProfile()), before = structuredClone(profile);
    await session.host(profile); session.on({ error: error => errors.push(error) }); tp.onOpen();
    assert.equal(tp.sent[0].drivingRoutes, 5, 'real current hello imports the candidate route capability');
    assert.equal(tp.sent[0].eliteVehicles, ELITE_VEHICLE_PROTOCOL, 'actual hello advertises the standalone elite model contract');
    session._onMsg(message);
    assert.equal(session.connected, false); assert.equal(session.canStart(), false);
    assert.equal(tp.closed, 1); assert.equal(errors.length, 1); assert.equal(errors[0].type, 'protocol-mismatch');
    assert.deepEqual(profile, before); assert.equal(session.peerWallet, null);
  }
  const tp = new TransportFixture(), session = new Session(tp);
  await session.host(withStorage(store(), () => loadProfile())); tp.onOpen(); session._onMsg(hello());
  assert.equal(session.protocolError, null); assert.equal(session.connected, true); assert.equal(tp.closed, 0);
  assert.equal(session.peerWallet.playerId, 'friend-current');
  assert.equal(tp.sent[0].protocol, NET_PROTOCOL); assert.equal(tp.sent[0].familyVehicles, PLAYER_VEHICLE_PROTOCOL);
  assert.equal(tp.sent[0].eliteVehicles, ELITE_VEHICLE_PROTOCOL);
});

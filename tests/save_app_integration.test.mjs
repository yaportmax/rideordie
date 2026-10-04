import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { normalizeProfile, getSaveStore, loadProfile, saveProfile, profileSaveStatus } from '../src/meta/profile.js';

const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let App;
try { ({ App } = await import('../src/app.js')); } finally { css.deregister(); }

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values };
}
function inStorage(t, value) {
  const previous = globalThis.localStorage; globalThis.localStorage = value;
  t.after(() => { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; });
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(t) {
  const memory = storage(); inStorage(t, memory);
  const p = loadProfile(), saves = getSaveStore();
  const shown = [], toasts = [], stages = [];
  const app = Object.assign(Object.create(App.prototype), {
    profile: p, personalProfile: p, saves, screen: 'title', mode: 'title', session: null,
    game: { run: null }, _flowId: 1, _saveVisit: null, _saveBusy: false,
    cloudSaves: { state: () => ({ connected: false, status: 'disconnected', conflicts: [] }) },
    ui: { screen: () => ({ kind: 'saves' }), updateSaves: model => shown.push(model), updateTitleSave() {},
      showSaves: model => shown.push(model), close() {}, showTitle() {}, toast: (...args) => toasts.push(args) },
    _stage: stage => stages.push(stage),
  });
  app._showSaves();
  return { app, saves, memory, shown, toasts, stages };
}

test('save recovery presentation supports guarded Hummer v2 singleton bytes and keeps future versions blocked', t => {
  const f = fixture(t);
  const hummer = normalizeProfile({ v: 1, campaignId: 'hummer-v2-recovery',
    trucks: ['player_sedan_t1', 'player_hummer_t1'], truck: 'player_hummer_t1',
    vehicleUpgradeSchema: 2, vehicleUpgrades: { hummer: { armor: 5, nitro: 3 } } });
  assert.equal(hummer.v, 2, 'actual new-family progress carries its older-client guard');
  const current = f.saves._retain({ reason: 'legacy-migration', raw: JSON.stringify(hummer) });
  const legacy = f.saves._retain({ reason: 'legacy-migration', raw: JSON.stringify({ ...DEFAULT_PROFILE(), campaignId: 'legacy-v1-recovery' }) });
  const tank = normalizeProfile({ ...hummer, trucks: [...hummer.trucks, 'player_tank_t1'], truck: 'player_tank_t1', vehicleUpgrades: { ...hummer.vehicleUpgrades, tank: { armor: 3 } } });
  const currentTank = f.saves._retain({ reason: 'legacy-migration', raw: JSON.stringify(tank) });
  const future = f.saves._retain({ reason: 'legacy-migration', raw: JSON.stringify({ ...hummer, v: 4 }) });
  const model = f.app._saveModel();
  assert.equal(model.recoveries.find(value => value.id === current.id).restorable, true);
  assert.equal(model.recoveries.find(value => value.id === legacy.id).restorable, true);
  assert.equal(model.recoveries.find(value => value.id === currentTank.id).restorable, true);
  assert.equal(model.recoveries.find(value => value.id === future.id).restorable, false);
});

test('existing personal save migrates once without turning foreign crew archives into cloud-owned slots', t => {
  const memory = storage(); inStorage(t, memory);
  const original = normalizeProfile(DEFAULT_PROFILE()); original.campaignId = 'legacy-person'; original.cash = 14200;
  original.vehicleUpgrades.sedan.engine = 2; original.weapons.minigun = { dmg: 1, mag: 2, rel: 0, hnd: 0 }; original.loadout = ['minigun', 'pistol'];
  memory.setItem('rideordie.profile.v1', JSON.stringify(original));
  memory.setItem('rideordie.profile.v1.foreign-host', JSON.stringify({ ...original, campaignId: 'foreign-host', cash: 999999 }));
  const loaded = loadProfile(), store = getSaveStore();
  assert.equal(loaded.cash, 14200); assert.equal(loaded.vehicleUpgrades.sedan.engine, 2);
  assert.deepEqual(loaded.loadout, ['minigun', 'pistol']); assert.equal(store.list().length, 1);
  assert.equal(loadProfile('foreign-host').campaignId, 'foreign-host'); assert.equal(store.list().length, 1);
  memory.setItem('rideordie.profile.v1', '{damaged');
  assert.equal(loadProfile().cash, 14200, 'legacy mirror damage cannot wipe the migrated personal save');
});

test('a bound personal reward is saved to its original slot even if another slot is selected', t => {
  const f = fixture(t), original = f.app.profile, firstId = f.saves.activeId();
  const second = f.saves.create('Another convoy'); f.saves.activate(second.id);
  original.cash = 800; original.totalCash = 800;
  saveProfile(original);
  assert.equal(profileSaveStatus(original).ok, true);
  assert.equal(f.saves.load(firstId).cash, 800); assert.equal(f.saves.load(second.id).cash, 0);
  assert.equal(f.saves.activeId(), second.id);
});

test('save activation is refused during gameplay, co-op, startup, results and an unresolved room', t => {
  const f = fixture(t), another = f.saves.create('Other');
  const blocks = [
    { screen: 'run' }, { screen: 'garage' }, { screen: 'results' }, { mode: 'coop' },
    { session: {} }, { _startup: {} }, { _startSelection: {} }, { _pendingResults: {} }, { _roomPending: {} },
  ];
  for (const changes of blocks) {
    const before = Object.fromEntries(Object.keys(changes).map(key => [key, f.app[key]]));
    Object.assign(f.app, changes);
    assert.throws(() => f.app._activateSave(another.id), /title/);
    Object.assign(f.app, before);
  }
  f.app.game.run = {}; assert.equal(f.app._canChangeSave(), false); f.app.game.run = null;
  f.app._activateSave(another.id);
  assert.equal(f.saves.activeId(), another.id); assert.equal(f.app.personalProfile, f.app.profile);
});

test('a file import finishing after its save screen closes cannot mutate a later visit', async t => {
  const f = fixture(t), pending = deferred(), callbacks = f.app._saveCallbacks();
  const request = callbacks.onImport({ size: 1000, text: () => pending.promise });
  callbacks.onClose(); f.app._showSaves();
  pending.resolve(JSON.stringify({ kind: 'rideordie-save', version: 2, name: 'Late import', profile: DEFAULT_PROFILE() }));
  await request;
  assert.equal(f.saves.list().length, 1);
  assert.equal(f.app._saveBusy, false); assert.equal(f.app._saveHistory, null);
});

test('late cloud backup results cannot replace the history shown in a new save visit', async t => {
  const f = fixture(t), pending = deferred(); f.app.cloudSaves.history = () => pending.promise;
  const callbacks = f.app._saveCallbacks(), request = callbacks.onCloudHistory(f.saves.activeId());
  callbacks.onClose(); f.app._showSaves(); pending.resolve([{ id: 'stale', profile: DEFAULT_PROFILE() }]);
  await request;
  assert.equal(f.app._saveHistory, null); assert.equal(f.app._saveBusy, false);
});

test('cloud presentation cannot substitute a live profile or guest personal wallet', t => {
  const f = fixture(t), original = f.app.profile, personal = f.app.personalProfile;
  const other = f.saves.create('Cloud pull'); f.saves.activate(other.id);
  f.app.screen = 'run'; f.app.mode = 'coop'; f.app.session = { isHost: false }; f.app.game.run = {};
  f.app._refreshSavePresentation();
  assert.equal(f.app.profile, original); assert.equal(f.app.personalProfile, personal);
});

test('cloud failures are reported instead of a false connected or restored notice', async t => {
  const f = fixture(t);
  f.app.cloudSaves.createVault = async () => ({ connected: true, status: 'offline', error: 'Request timed out; local progress retained.' });
  await f.app._saveCallbacks().onCloudCreate();
  assert.equal(f.app._saveNotice, 'Request timed out; local progress retained.');
  assert.equal(f.toasts.at(-1)[1], 'bad'); assert.equal(f.app._saveBusy, false);
});

test('blocked local storage cannot recursively refresh or prevent the title save manager', t => {
  const f = fixture(t);
  f.saves.onChange(() => f.app._refreshSavePresentation());
  f.memory.getItem = () => { throw new Error('Browser storage unavailable'); };
  assert.doesNotThrow(() => f.app._refreshSavePresentation());
  assert.equal(f.app._saveSummary().name, 'Unsaved session');
  assert.doesNotThrow(() => f.app._showSaves());
  assert.ok(f.app._saveModel().status.error);
});

test('stale personal branches appear without raw bytes and recover as a separate named save', t => {
  const f = fixture(t), old = f.saves.load(), current = f.saves.load();
  current.cash = 90; assert.equal(f.saves.save(current).ok, true);
  old.cash = 125; assert.equal(f.saves.save(old).ok, false);
  const recovery = f.app._saveModel().recoveries.find(row => row.reason === 'stale-profile');
  assert.ok(recovery?.restorable); assert.equal(Object.hasOwn(recovery, 'raw'), false);
  const restored = f.saves.restoreRecovery(recovery.id, 'Recovered convoy');
  assert.equal(restored.profile.cash, 125); assert.equal(f.saves.load().cash, 90);
});

test('title return resumes deferred cloud heads once and stale title work cannot follow into gameplay', async t => {
  const f = fixture(t), pending = deferred(); let calls = 0;
  f.app.cloudSaves.sync = async () => { calls++; return calls === 1 ? pending.promise : { status: 'connected' }; };
  f.app._resumeSaveSync(); pending.resolve({ status: 'pending' });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 2);
  const later = deferred(); calls = 0; f.app.cloudSaves.sync = () => { calls++; return later.promise; };
  f.app._resumeSaveSync(); f.app._flowId++; f.app.screen = 'run'; later.resolve({ status: 'pending' });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
});

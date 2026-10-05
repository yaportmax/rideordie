// Real App callback -> profile/SaveStore or co-op command contracts. These
// logical tests start no Ui instance, browser, renderer, sound or device input.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { GarageScreen, garageInitialSelection } from '../src/ui/screens/garage.js';
import { TRUCKS, UPGRADE_BY_ID, effectiveUpgrades, upgradeLevel } from '../src/data/upgrades.js';
import { getSaveStore, profileSaveStatus } from '../src/meta/profile.js';
import { normalizeCampaignProgress } from '../src/data/campaign.js';

const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let App;
try { ({ App } = await import('../src/app.js')); } finally { css.deregister(); }

function storage() {
  const records = new Map();
  return { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)), removeItem: key => records.delete(key) };
}
function fixture(t) {
  const storageBefore = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (storageBefore) Object.defineProperty(globalThis, 'localStorage', storageBefore); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage() });
  const store = getSaveStore(), p = store.load(); p.cash = 200000;
  p.campaignProgress = normalizeCampaignProgress({ cleared: [1, 2, 3], clearRuns: { 1: 'fixture-clear1', 2: 'fixture-clear2', 3: 'fixture-clear3' } });
  assert.equal(store.save(p).ok, true, 'fixture cash is a durable baseline before invoking actual App transactions');
  const events = [], previews = [], refreshed = [];
  const app = Object.assign(Object.create(App.prototype), {
    profile: p, personalProfile: p, mode: 'solo', screen: 'garage', session: null, readyMine: false, readyOther: false,
    ui: { toast: (...args) => events.push(['toast', ...args]), updateGarage: (...args) => refreshed.push(args) },
    sound: id => events.push(['sound', id]),
    game: { garage: { setTruck: (...args) => events.push(['setTruck', ...args]),
      setPreview: value => previews.push(value), setTab: id => events.push(['previewTab', id]),
      celebrate: id => events.push(['celebrate', id]) } },
  });
  const s = Object.assign(Object.create(GarageScreen.prototype), {
    p, ...garageInitialSelection(p), weaponPage: 'loadout', trackPrev: null, opticPrev: null,
    ui: { snd() {}, pressFx() {} }, cb: app._garageCb(), burst() {},
    denied: (_button, need) => events.push(['denied', need]),
  });
  return { app, s, p, store, events, previews, refreshed };
}
const click = (s, dataset) => s.onClick({ target: { closest: () => ({ dataset }) }, detail: 0 });

test('Vehicles base unlock and Upgrades chassis buy flow through actual App saves with authored prices', t => {
  const { s, p, store, refreshed } = fixture(t);
  s.selId.truck = 'truck_t1'; const initialCash = p.cash, initialRevision = p.revision;
  s.doBuy({});
  assert.equal(p.truck, 'truck_t1'); assert.ok(p.trucks.includes('truck_t1'));
  assert.equal(p.cash, initialCash - TRUCKS.find(tr => tr.id === 'truck_t1').cost);
  assert.equal(p.revision, initialRevision + 1); assert.equal(profileSaveStatus(p).ok, true);
  assert.equal(store.load().truck, 'truck_t1'); assert.equal(refreshed.at(-1)[0], p);
  p.vehicleUpgrades.rustbucket.armor = 2;
  s.tab = 'upgrades'; s.normalizeSelections(); s.selId.upgrades = 'chassis:truck_t2';
  const cash = p.cash; s.doBuy({});
  assert.equal(p.truck, 'truck_t2'); assert.equal(p.cash, cash - TRUCKS.find(tr => tr.id === 'truck_t2').cost);
  assert.equal(store.load().vehicleUpgrades.rustbucket.armor, 2);
  assert.equal(store.load().truck, 'truck_t2');
});

test('family/card selection and stock reselect preserve actual App per-family upgrade preview', t => {
  const { s, p, previews, store } = fixture(t);
  p.trucks.push('truck_t1', 'truck_t4'); p.vehicleUpgrades.rustbucket.ram = 3;
  p.vehicleUpgrades.sedan.ram = 1;
  s.selId.truck = 'truck_t1'; s.notifyView();
  assert.equal(previews.at(-1).truck, 'truck_t4'); assert.equal(previews.at(-1).upgradeLevels.ram, 3);
  click(s, { select: '1' }); assert.equal(p.truck, 'truck_t4'); assert.equal(store.load().truck, 'truck_t4');
  s.tab = 'upgrades'; s.selId.upgrades = 'chassis:truck_t1'; s.notifyView();
  assert.deepEqual(previews.at(-1), { truck: 'truck_t1', upgradeLevels: effectiveUpgrades(p, 'truck_t1') });
  click(s, { select: '1' }); assert.equal(p.truck, 'truck_t1'); assert.equal(p.vehicleUpgrades.rustbucket.ram, 3);
  s.selId.upgrades = 'engine'; s.notifyView();
  assert.equal(previews.at(-1).upgradeLevels.engine, upgradeLevel(p, 'engine') + 1);
  const cash = p.cash, price = UPGRADE_BY_ID.engine.costs[upgradeLevel(p, 'engine')];
  s.doBuy({}); assert.equal(p.cash, cash - price); assert.equal(store.load().vehicleUpgrades.rustbucket.engine, 1);
});

test('co-op family/chassis and personal gun actions retain exact Session command IDs and pending ownership', t => {
  const { app, s, p, store, refreshed } = fixture(t), commands = [], before = structuredClone(p);
  app.mode = 'coop'; app.session = { buy(...args) { commands.push(args); return { pending: true }; } };
  s.cb = app._garageCb(); s.selId.truck = 'truck_t1'; s.doBuy({});
  assert.deepEqual(commands.pop(), ['truck', 'truck_t1', undefined]);
  p.trucks.push('truck_t1'); p.truck = 'truck_t1'; s.tab = 'upgrades'; s.selId.upgrades = 'chassis:truck_t2';
  const authoritativeBefore = structuredClone(p); s.doBuy({});
  assert.deepEqual(commands.pop(), ['truck', 'truck_t2', undefined]);
  s.selId.upgrades = 'engine'; s.doBuy({}); assert.deepEqual(commands.pop(), ['upgrade', 'engine', undefined]);
  s.tab = 'weapons'; s.selId.weapons = 'rifle'; s.doBuy({}); assert.deepEqual(commands.pop(), ['weapon', 'rifle', undefined]);
  assert.deepEqual(p, authoritativeBefore, 'pending co-op commands cannot apply local cash or gear changes');
  assert.equal(p.revision, before.revision); assert.equal(refreshed.length, 0);
  assert.equal(store.load().cash, before.cash, 'the UI must not create a local save for pending authoritative purchases');
});

test('seat consent, co-op Ready and campaign selection retain actual guarded App consumers', async t => {
  const { app, s, p } = fixture(t), calls = [];
  app.mode = 'coop'; app.readyMine = false; app._cancelStartSelection = () => calls.push(['cancelStart']);
  app._showCampaign = () => calls.push(['campaign']);
  app.session = { swap: { request: () => calls.push(['request']), respond: (...args) => calls.push(['respond', ...args]),
    cancel: id => calls.push(['cancelSwap', id]), ready: value => calls.push(['ready', value]) } };
  s.cb = app._garageCb(); s.extra = { solo: false, readyBlocked: true };
  const before = structuredClone(p);
  click(s, { seatAction: 'accept', proposal: 'current-visit-proposal' }); click(s, { ready: '1' });
  assert.deepEqual(calls, [['cancelStart'], ['respond', 'current-visit-proposal', true]]);
  s.extra.readyBlocked = false; s.q = { ready: { querySelector: () => ({}) } };
  click(s, { ready: '1' }); assert.deepEqual(calls.at(-1), ['ready', true]);
  click(s, { campaign: '1' }); assert.deepEqual(calls.at(-1), ['campaign']);
  app.screen = 'results'; await s.cb.onReady(); s.cb.onSeatSwap('accept', 'stale');
  assert.deepEqual(calls.at(-1), ['campaign'], 'stale garage consumers are ignored outside the garage');
  assert.deepEqual(p, before);
});

test('integration storage fixtures restore the previous descriptor before subsequent suite consumers', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), external = storage();
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, enumerable: true, writable: true, value: external });
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  await t.test('nested fixture installs isolated writable storage', child => {
    fixture(child);
    assert.notEqual(globalThis.localStorage, external);
    assert.equal(Object.getOwnPropertyDescriptor(globalThis, 'localStorage').writable, true);
  });
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), before);
  const replacement = storage(); globalThis.localStorage = replacement;
  assert.equal(globalThis.localStorage, replacement, 'ordinary profile tests retain their direct storage assignment contract');
});

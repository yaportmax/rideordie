// Logical consumers only: no browser, renderer, audio or device input is created.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { GarageScreen, garageInitialSelection } from '../src/ui/screens/garage.js';
import { DEFAULT_PROFILE, TRUCKS, effectiveUpgrades, upgradeLevel } from '../src/data/upgrades.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { getSaveStore, loadProfile, saveProfile, profileSaveStatus, upgradeCost } from '../src/meta/profile.js';
import { truckStats, upgradeStats } from '../src/ui/garage_stats.js';
import { speedValue } from '../src/ui/units.js';
import { buildPlayerSpec } from '../src/game/run_setup.js';

const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let App;
try { ({ App } = await import('../src/app.js')); } finally { css.deregister(); }

const clone = value => structuredClone(value);
const flush = () => new Promise(resolve => setImmediate(resolve));
const price = id => TRUCKS.find(chassis => chassis.id === id).cost;
function inStore(store, fn) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: store });
  try { return fn(); }
  finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
}
function globals(t) {
  const keys = ['window', 'requestAnimationFrame', 'localStorage'], before = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: {} });
  // Presentation scheduling is a resource seam, not a frame/time oracle.
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, writable: true, value: () => 0 });
  t.after(() => keys.forEach((key, i) => { if (before[i]) Object.defineProperty(globalThis, key, before[i]); else delete globalThis[key]; }));
}
function personalStore(id, cash, guest = false) {
  const data = new Map(), store = { data, getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
  const seed = DEFAULT_PROFILE(); seed.campaignId = id; seed.cash = cash; seed.totalCash = guest ? 70000 : 60000;
  seed.upgrades.medkit = guest ? 2 : 1; seed.vehicleUpgrades.sedan.engine = guest ? 1 : 2;
  if (guest) {
    seed.trucks.push('player_buggy_t1'); seed.truck = 'player_buggy_t1'; seed.vehicleUpgrades.buggy.engine = 4;
    seed.weapons.rifle = { dmg: 2, mag: 1, rel: 0, hnd: 0 }; seed.loadout = ['rifle']; seed.runs = 9; seed.best.distance = 12345;
  }
  // Seed before loading: changing an already pinned campaign ID is invalid.
  store.setItem('rideordie.profile.v1', JSON.stringify(seed));
  return inStore(store, () => {
    const profile = loadProfile(), saves = getSaveStore(); saveProfile(profile);
    assert.equal(profileSaveStatus(profile).ok, true);
    return { store, profile, saves, slotId: saves.activeId() };
  });
}
class Memory {
  constructor(store) { this.store = store; this.sent = []; this.rtt = 0; }
  async host() { return 'ABCDE'; }
  async join() {}
  send(message) {
    const wire = clone(message); this.sent.push(wire);
    const receiver = this.other;
    if (receiver) queueMicrotask(() => {
      if (this.other === receiver) inStore(receiver.store, () => receiver.onMessage(clone(wire)));
    });
  }
  sendFast() {}
  destroy() { this.other = null; }
}
function memoryTransport(session, store) {
  const memory = new Memory(store);
  // Keep the actual Session constructor's handlers, which close over this Session.
  for (const key of ['onMessage', 'onFast', 'onOpen', 'onClose', 'onError', 'onState']) memory[key] = session.tp[key];
  session.tp = memory; return memory;
}
function node() {
  return { innerHTML: '', textContent: '', scrollTop: 0, hidden: false, isConnected: true,
    classList: { add() {}, remove() {}, toggle() {} }, animate() {}, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [] };
}
function screen(profile, cb, extra, ui) {
  const q = Object.fromEntries(['sub', 'campaign', 'tabs', 'rows', 'lhead', 'lcount', 'det', 'foot', 'detail', 'load', 'seats', 'party', 'ready', 'hints', 'cv'].map(key => [key, node()]));
  const s = Object.assign(Object.create(GarageScreen.prototype), {
    p: profile, cb, extra, ui, q, el: node(), ...garageInitialSelection(profile),
    weaponPage: 'loadout', trackPrev: null, opticPrev: null, fresh: {},
    // Only particle/cash/flash effects are omitted. Real rendering computes the
    // actual list/detail/stats/loadout/seat markup, and update/selection stay real.
    burst() {}, flashNew() {}, renderCash() { this.cashShown = this.p.cash; },
  });
  s.snap = s.snapshot(profile); s.renderAll(); return s;
}
function appFor(personal) {
  const scene = { equipped: [], previews: [], tabs: [], stages: [], celebrations: [],
    setTruck(id, paint, loadout) { this.equipped.push(clone({ id, paint, loadout })); },
    setPreview(value) { this.previews.push(clone(value)); }, setTab(id) { this.tabs.push(id); },
    setStage(id) { this.stages.push(id); }, celebrate(id) { this.celebrations.push(id); }, fadeIn() {} };
  const ui = { settings: { name: personal.profile.campaignId, units: 'mi' }, refreshed: [], toasts: [], currentGarage: null,
    nav: { cur: null, ensure() {} }, snd() {}, pressFx() {}, toast(...args) { this.toasts.push(clone(args)); }, updateLobby() {}, showTitle() {},
    hideAll() { this.currentGarage = null; },
    showGarage(p, cb, extra) { this.currentGarage = screen(p, cb, extra, this); },
    updateGarage(p, extra) { this.refreshed.push(p); this.currentGarage?.update(p, extra); } };
  const game = { run: null, garage: scene, endRun() { this.run = null; }, fade() {},
    showGarage(id, paint, loadout) { scene.setTruck(id, paint, loadout); } };
  const app = Object.assign(Object.create(App.prototype), {
    profile: personal.profile, personalProfile: personal.profile, saves: personal.saves,
    mode: 'coop', screen: 'lobby', session: null, ui, game, input: { lastDevice: 'kbm' },
    _flowId: 0, _garageGeneration: 0, _booted: true, _pendingRunMsgs: [],
    readyMine: false, readyOther: false,
  });
  return { ...personal, app, ui, scene };
}
async function pair(t, hostRole) {
  globals(t);
  const h = appFor(personalStore('consumer-host', 50000)), g = appFor(personalStore('consumer-guest', 50000, true));
  const host = inStore(h.store, () => h.app._newSession()), guest = inStore(g.store, () => g.app._newSession());
  const a = memoryTransport(host, h.store), b = memoryTransport(guest, g.store); a.other = b; b.other = a;
  await inStore(h.store, () => host.host(h.profile)); await inStore(g.store, () => guest.join('ABCDE', g.profile));
  inStore(h.store, () => a.onOpen()); inStore(g.store, () => b.onOpen()); await flush();
  inStore(h.store, () => host.setRole(hostRole)); inStore(g.store, () => guest.setRole(hostRole === 'driver' ? 'gunner' : 'driver')); await flush();
  inStore(h.store, () => host.broadcastProfile()); await flush();
  inStore(h.store, () => h.app.garage()); inStore(g.store, () => g.app.garage()); await flush();
  assert.equal(host.swap.canRequest(), true); assert.equal(guest.swap.canRequest(), true);
  t.after(() => {
    for (const f of [h, g]) { f.app.screen = 'closed'; inStore(f.store, () => f.app.session?.leave()); }
  });
  return { h, g, host, guest };
}
const click = (f, dataset, s = f.ui.currentGarage) => inStore(f.store, () => s.onClick({ target: { closest: () => ({ dataset }) }, detail: 0 }));
function choose(f, tab, id, s = f.ui.currentGarage) {
  inStore(f.store, () => { s.switchTab(tab, { focusTab: false }); s.select(id); });
  assert.equal(s.tab, tab); assert.equal(s.sel(), id); return s;
}
function persisted(f) { return inStore(f.store, () => f.saves.load(f.slotId)); }
function personalGear(p) {
  return clone({ campaignId: p.campaignId, truck: p.truck, trucks: p.trucks, vehicleUpgrades: p.vehicleUpgrades,
    upgrades: p.upgrades, weapons: p.weapons, weaponOptics: p.weaponOptics, loadout: p.loadout, best: p.best, runs: p.runs, totalCash: p.totalCash });
}
function assertReceipt(f, cash) {
  assert.equal(f.app.profile.cash, cash); assert.equal(f.app.personalProfile.cash, cash);
  assert.equal(profileSaveStatus(f.app.personalProfile).ok, true);
  assert.equal(persisted(f).cash, cash); assert.equal(f.saves.activeId(), f.slotId);
}
function displayedSpeed(s, before, after) {
  const value = s.q.det.innerHTML.match(/<span class="slabel">TOP SPEED<\/span>(.*?)<span class="sbar">/)?.[1];
  assert.ok(value, 'the actual detail markup must contain the TOP SPEED stat');
  if (after != null && Math.abs(after - before) > 1e-6) {
    assert.ok(value.includes(`<s>${Math.round(before)}</s>`), 'the displayed before speed must match the owned runtime build');
    assert.ok(value.includes(`<b class="${after > before ? 'up' : 'down'}">${Math.round(after)}</b>`), 'the displayed after speed must match the selected runtime/next-level target');
  } else assert.ok(value.includes(`<b>${Math.round(before)}</b>`), 'the displayed current speed must match the runtime build');
}
async function consentSwap(f, hostRole) {
  const { h, g, host, guest } = f;
  const before = { campaign: clone(host.profile), personal: clone(guest.personalProfile), wallet: clone(host.peerWallet) };
  // One real Ready intent demonstrates that proposing a swap revokes consent,
  // without arming an automatic both-ready run in this logical fixture.
  click(h, { ready: '1' }); await flush(); assert.equal(h.app.readyMine, true);
  click(h, { seatAction: 'request' }); await flush();
  const pending = host.swap.snapshot().pending; assert.ok(pending?.id); assert.equal(pending.by, 'host');
  assert.equal(h.app.readyMine, false); assert.equal(g.app.readyOther, false);
  click(h, { seatAction: 'accept', proposal: pending.id }); await flush();
  assert.equal(host.swap.snapshot().pending.id, pending.id, 'a requester cannot self-accept');
  assert.equal(host.me.role, hostRole);
  click(g, { seatAction: 'accept', proposal: pending.id }); await flush();
  const nextRole = hostRole === 'driver' ? 'gunner' : 'driver';
  assert.deepEqual([host.me.role, host.other.role], [nextRole, hostRole]);
  assert.deepEqual([guest.me.role, guest.other.role], [hostRole, nextRole]);
  for (const s of [host, guest]) { assert.equal(s.swap.snapshot().pending, null); assert.equal(s.me.ready, false); assert.equal(s.other.ready, false); }
  assert.deepEqual(host.profile, before.campaign); assert.deepEqual(guest.personalProfile, before.personal); assert.deepEqual(host.peerWallet, before.wallet);
}

for (const hostRole of ['driver', 'gunner']) test(`real accepted seat swap preserves requester-funded chassis and parts when host began as ${hostRole}`, async t => {
  const f = await pair(t, hostRole), { h, g, host, guest } = f;
  const guestGear = personalGear(g.profile); await consentSwap(f, hostRole);
  assert.ok(h.app.profile === host.profile, 'host App retains the actual shared campaign object');
  assert.ok(g.app.profile === guest.profile, 'guest App receives its actual Session shared profile');
  assert.ok(h.app.personalProfile === host.personalProfile, 'host personal save object remains bound');
  assert.ok(g.app.personalProfile === guest.personalProfile, 'guest personal save object remains bound');

  choose(g, 'truck', 'truck_t1');
  assert.equal(g.scene.previews.at(-1).truck, 'truck_t1');
  const guestBeforeBase = g.app.profile.cash, hostBeforeBase = h.app.profile.cash;
  click(g, { buy: '1' });
  assert.equal(guest.tp.sent.at(-1).kind, 'truck'); assert.equal(guest.tp.sent.at(-1).id, 'truck_t1');
  assert.equal(g.app.profile.cash, guestBeforeBase); assert.ok(!host.profile.trucks.includes('truck_t1'), 'pending guest UI cannot grant the host chassis');
  await flush();
  assertReceipt(g, guestBeforeBase - price('truck_t1')); assertReceipt(h, hostBeforeBase);
  assert.equal(host.peerWallet.cash, g.app.profile.cash);
  for (const p of [host.profile, guest.profile]) { assert.equal(p.truck, 'truck_t1'); assert.ok(p.trucks.includes('truck_t1')); }
  assert.equal(persisted(h).truck, 'truck_t1'); assert.deepEqual(personalGear(persisted(g)), guestGear);

  const baseSpec = clone(VEHICLES.truck_t2), beforeParts = clone(host.profile.vehicleUpgrades);
  choose(h, 'upgrades', 'chassis:truck_t2');
  assert.match(h.ui.currentGarage.q.foot.innerHTML, /BUY CHASSIS/);
  assert.equal(h.scene.previews.at(-1).truck, 'truck_t2', 'internal chassis prefix never reaches the App preview');
  const stageRows = truckStats(host.profile, 'truck_t2', 'mi'), targetSpec = buildPlayerSpec({ ...host.profile, truck: 'truck_t2' }).spec;
  assert.equal(stageRows.find(row => row.label === 'TOP SPEED').after, speedValue(targetSpec.engine.vmax, 'mi'));
  displayedSpeed(h.ui.currentGarage, speedValue(buildPlayerSpec(host.profile).spec.engine.vmax, 'mi'), speedValue(targetSpec.engine.vmax, 'mi'));
  const hostBeforeStage = host.profile.cash, guestBeforeStage = guest.profile.cash;
  click(h, { buy: '1' }); await flush();
  assertReceipt(h, hostBeforeStage - price('truck_t2')); assertReceipt(g, guestBeforeStage);
  assert.equal(host.profile.truck, 'truck_t2'); assert.equal(guest.profile.truck, 'truck_t2');
  assert.ok(persisted(h).trucks.includes('truck_t2')); assert.deepEqual(host.profile.vehicleUpgrades, beforeParts);

  choose(g, 'upgrades', 'engine');
  const state = g.ui.currentGarage.upState('engine'), cost = upgradeCost(guest.profile, 'engine');
  assert.equal(state.cost, cost); assert.equal(state.lv, 0);
  const speedRows = upgradeStats(guest.profile, 'engine', 'mi'), expectedSpeed = speedRows.find(row => row.label === 'TOP SPEED').after;
  displayedSpeed(g.ui.currentGarage, speedValue(buildPlayerSpec(guest.profile).spec.engine.vmax, 'mi'), expectedSpeed);
  assert.equal(g.scene.previews.at(-1).upgradeLevels.engine, 1);
  const partsBeforeBuy = clone(host.profile.vehicleUpgrades), guestBeforePart = guest.profile.cash, hostBeforePart = host.profile.cash;
  click(g, { buy: '1' });
  assert.equal(guest.tp.sent.at(-1).kind, 'upgrade'); assert.equal(guest.tp.sent.at(-1).id, 'engine');
  assert.equal(upgradeLevel(host.profile, 'engine'), 0); assert.equal(guest.profile.cash, guestBeforePart);
  await flush();
  assertReceipt(g, guestBeforePart - cost); assertReceipt(h, hostBeforePart);
  assert.equal(host.profile.vehicleUpgrades.rustbucket.engine, 1); assert.equal(guest.profile.vehicleUpgrades.rustbucket.engine, 1);
  assert.deepEqual(host.profile.vehicleUpgrades.sedan, partsBeforeBuy.sedan); assert.deepEqual(host.profile.vehicleUpgrades.buggy, partsBeforeBuy.buggy);
  assert.equal(speedValue(buildPlayerSpec(host.profile).spec.engine.vmax, 'mi'), expectedSpeed);
  displayedSpeed(g.ui.currentGarage, expectedSpeed, upgradeStats(guest.profile, 'engine', 'mi').find(row => row.label === 'TOP SPEED').after);
  for (const x of [h, g]) {
    assert.equal(x.scene.equipped.at(-1).id, 'truck_t2');
    assert.deepEqual(x.scene.equipped.at(-1).loadout.upgradeLevels, effectiveUpgrades(x.app.profile));
    assert.match(x.ui.currentGarage.q.load.innerHTML, /HAULER/);
  }
  assert.deepEqual(VEHICLES.truck_t2, baseSpec, 'stats and purchases cannot rewrite base vehicle specs');
  assert.deepEqual(personalGear(persisted(g)), guestGear, 'shared equipment cannot replace the guest personal gear');

  const wallets = [host.profile.cash, guest.profile.cash], boughtParts = clone(host.profile.vehicleUpgrades);
  choose(h, 'upgrades', 'chassis:truck_t1'); click(h, { select: '1' }); await flush();
  assert.equal(host.profile.truck, 'truck_t1'); assert.ok(host.profile.trucks.includes('truck_t2'));
  choose(g, 'truck', 'player_sedan_t1'); click(g, { select: '1' }); await flush();
  assert.equal(host.profile.truck, 'player_sedan_t1');
  choose(g, 'truck', 'truck_t1');
  assert.equal(g.ui.currentGarage.selectedVehicle(), 'truck_t2', 'a family card reopens its highest owned build');
  click(g, { select: '1' }); await flush();
  assert.equal(host.profile.truck, 'truck_t2'); assert.equal(guest.profile.truck, 'truck_t2');
  assert.deepEqual([host.profile.cash, guest.profile.cash], wallets); assert.deepEqual(host.profile.vehicleUpgrades, boughtParts);
  assertReceipt(h, wallets[0]); assertReceipt(g, wallets[1]);
  assert.deepEqual(personalGear(persisted(g)), guestGear); assert.equal(persisted(h).truck, 'truck_t2');

  const beforeRetired = { shared: clone(host.profile), remote: clone(guest.profile), personal: clone(guest.personalProfile),
    wallet: clone(host.peerWallet), stored: clone([...h.store.data]), otherStored: clone([...g.store.data]), toasts: g.ui.toasts.length };
  const retiredRequest = inStore(g.store, () => guest.buy('upgrade', 'vest'));
  assert.equal(retiredRequest.pending, true, 'the negative request follows the real queued guest purchase path');
  await flush();
  assert.deepEqual(host.tp.sent.at(-1), { t: 'buyDenied', reason: 'retired', kind: 'upgrade', id: 'vest' });
  assert.equal(g.ui.toasts.length, beforeRetired.toasts + 1, 'the real guest App receives the denied purchase');
  assert.deepEqual(host.profile, beforeRetired.shared); assert.deepEqual(guest.profile, beforeRetired.remote);
  assert.deepEqual(guest.personalProfile, beforeRetired.personal); assert.deepEqual(host.peerWallet, beforeRetired.wallet);
  assert.equal(host.profile.upgrades.vest, beforeRetired.shared.upgrades.vest, 'retirement cannot alter the retained legacy tier');
  assert.equal(guest.personalProfile.upgrades.vest, beforeRetired.personal.upgrades.vest);
  assert.deepEqual([...h.store.data], beforeRetired.stored); assert.deepEqual([...g.store.data], beforeRetired.otherStored);
});

test('retained actual garage consumers cannot purchase or preview after title, a new visit or a new Session', async t => {
  for (const transition of ['title', 'visit', 'session']) await t.test(transition, async st => {
    const { h, g, host, guest } = await pair(st, 'driver'), stale = h.ui.currentGarage;
    choose(h, 'upgrades', 'engine', stale);
    if (transition === 'title') inStore(h.store, () => h.app.title());
    else if (transition === 'visit') { inStore(h.store, () => h.app.garage()); await flush(); }
    else inStore(h.store, () => { const next = h.app._newSession(); memoryTransport(next, h.store); });
    const before = {
      profile: clone(h.app.profile), guest: clone(guest.personalProfile),
      stored: clone([...h.store.data]), otherStored: clone([...g.store.data]),
      previews: h.scene.previews.length, tabs: h.scene.tabs.length, equipped: h.scene.equipped.length,
      refreshes: h.ui.refreshed.length, sent: host.tp.sent.length, nextSent: h.app.session?.tp.sent?.length ?? 0,
    };
    inStore(h.store, () => {
      stale.doBuy({}); stale.notifyView();
      stale.cb.onSelectTruck('player_sedan_t1'); stale.cb.onPaint(1); stale.cb.onEquip('pistol', 2);
    });
    await flush();
    assert.deepEqual(h.app.profile, before.profile); assert.deepEqual(guest.personalProfile, before.guest);
    assert.deepEqual([...h.store.data], before.stored); assert.deepEqual([...g.store.data], before.otherStored);
    assert.equal(h.scene.previews.length, before.previews); assert.equal(h.scene.tabs.length, before.tabs);
    assert.equal(h.scene.equipped.length, before.equipped); assert.equal(h.ui.refreshed.length, before.refreshes);
    assert.equal(host.tp.sent.length, before.sent); assert.equal(h.app.session?.tp.sent?.length ?? 0, before.nextSent);
  });
});

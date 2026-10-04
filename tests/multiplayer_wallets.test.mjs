import { ELITE_VEHICLE_PROTOCOL } from '../src/data/elite_vehicles.js';
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, UPGRADE_BY_ID, weaponTrackCost, upgradeLevel } from '../src/data/upgrades.js';
import { WEAPONS } from '../src/data/weapons.js';
import { saveProfile, loadProfile, normalizeProfile } from '../src/meta/profile.js';
import { NET_PROTOCOL } from '../src/net/run_packet.js';
import { GARAGE_SEAT_PROTOCOL } from '../src/net/garage_seats.js';
import { PLAYER_VEHICLE_PROTOCOL } from '../src/data/vehicle_families.js';
import { DRIVING_ROUTE_VERSION } from '../src/world/driving_plan.js';
import { CAMPAIGN_PROTOCOL } from '../src/data/campaign.js';
import { weaponOpticState } from '../src/meta/weapon_optics.js';
const { Session } = await import('../src/net/session.js');

const storage = () => {
  const data = new Map();
  return { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v), data };
};
function inStore(store, fn) {
  const previous = globalThis.localStorage; globalThis.localStorage = store;
  try { return fn(); } finally { globalThis.localStorage = previous; }
}
class Memory {
  constructor(store) { this.store = store; this.rtt = 0; this.sent = []; }
  async host() { return 'ABCDE'; }
  async join() {}
  send(message) {
    this.sent.push(structuredClone(message));
    const receiver = this.other;
    if (receiver) queueMicrotask(() => { if (this.other === receiver) inStore(receiver.store, () => receiver.onMessage(structuredClone(message))); });
  }
  sendFast() {}
  destroy() { this.other = null; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function pair({ hostCash = 7000, guestCash = 5000, hostRole = 'driver', profiles = null, stores = null } = {}) {
  const [hostStore, guestStore] = stores || [storage(), storage()];
  const hp = profiles?.[0] || DEFAULT_PROFILE(), gp = profiles?.[1] || DEFAULT_PROFILE();
  if (!profiles) {
    hp.campaignId = 'host-person'; hp.cash = hostCash; hp.totalCash = 12000;
    gp.campaignId = 'guest-person'; gp.cash = guestCash; gp.totalCash = 18000;
    gp.weapons.rifle = { dmg: 2, mag: 1, rel: 0, hnd: 0 }; gp.loadout = ['rifle']; gp.upgrades.vest = 2; gp.best.distance = 12345; gp.runs = 9;
    inStore(hostStore, () => saveProfile(hp)); inStore(guestStore, () => saveProfile(gp));
  }
  const a = new Memory(hostStore), b = new Memory(guestStore); a.other = b; b.other = a;
  const host = new Session(a), guest = new Session(b);
  await host.host(hp); await guest.join('ABCDE', gp);
  inStore(hostStore, () => a.onOpen()); inStore(guestStore, () => b.onOpen()); await flush();
  host.setRole(hostRole); guest.setRole(hostRole === 'driver' ? 'gunner' : 'driver'); await flush();
  host.broadcastProfile(); await flush();
  return { host, guest, hostStore, guestStore,
    hostBuy: (...args) => inStore(hostStore, () => host.buy(...args)),
    guestBuy: (...args) => inStore(guestStore, () => guest.buy(...args)) };
}
async function start(host, guest) {
  host.activeRunId = guest.activeRunId = null;
  host.swap.enterGarage(); guest.swap.enterGarage(); await flush();
  host.swap.ready(true); guest.swap.ready(true); await flush();
  const cfg = host.startRun({ seed: 17 }); assert.ok(cfg); await flush(); return cfg;
}

// Actual Session/store transactions with in-memory transport. This exercises
// ownership and the purchasing person's wallet, not native WebRTC or UI pixels.
test('both host seats permit a guest-funded Hummer while preserving personal inventory, wallet and saved campaign', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const state = await pair({ hostRole, hostCash: 7000, guestCash: 120000 });
    const { host, guest, hostBuy, guestBuy, hostStore, guestStore } = state;
    const personalBefore = normalizeProfile(structuredClone(guest.personalProfile));
    guestBuy('truck', 'player_hummer_t1'); await flush();
    assert.equal(host.profile.cash, 7000); assert.equal(host.peerWallet.cash, 20000); assert.equal(guest.profile.cash, 20000);
    for (const campaign of [host.profile, guest.profile]) {
      assert.equal(campaign.truck, 'player_hummer_t1'); assert.ok(campaign.trucks.includes('player_hummer_t1'));
      assert.equal(upgradeLevel(campaign, 'engine'), 0); assert.equal(upgradeLevel(campaign, 'armor'), 0);
    }
    guestBuy('upgrade', 'armor'); await flush();
    const guestPaid = 20000 - UPGRADE_BY_ID.armor.costs[0];
    hostBuy('upgrade', 'engine'); await flush();
    assert.equal(host.profile.cash, 7000 - UPGRADE_BY_ID.engine.costs[0]); assert.equal(guest.profile.cash, guestPaid);
    assert.equal(host.profile.vehicleUpgrades.hummer.armor, 1); assert.equal(host.profile.vehicleUpgrades.hummer.engine, 1);
    assert.equal(upgradeLevel(host.profile, 'engine', 'player_sedan_t1'), 0);
    const denied = []; guest.on({ buyDenied: error => denied.push(error) });
    guestBuy('truck', 'player_hummer_t1'); await flush();
    assert.equal(denied.length, 1); assert.equal(host.profile.cash, 7000 - UPGRADE_BY_ID.engine.costs[0]);
    assert.equal(guest.profile.cash, guestPaid, 'repeat purchase cannot debit again');
    const hp = inStore(hostStore, () => loadProfile()), gp = inStore(guestStore, () => loadProfile());
    assert.equal(hp.truck, 'player_hummer_t1'); assert.equal(hp.vehicleUpgrades.hummer.armor, 1); assert.equal(hp.vehicleUpgrades.hummer.engine, 1);
    assert.equal(gp.cash, guestPaid); assert.equal(gp.campaignId, personalBefore.campaignId);
    assert.deepEqual(gp.trucks, personalBefore.trucks); assert.equal(gp.truck, personalBefore.truck);
    assert.deepEqual(gp.vehicleUpgrades, personalBefore.vehicleUpgrades); assert.deepEqual(gp.weapons, personalBefore.weapons);
    let guestCfg; guest.on({ start: cfg => { guestCfg = cfg; } }); const cfg = await start(host, guest);
    assert.equal(cfg.profile.truck, 'player_hummer_t1'); assert.equal(guestCfg.profile.truck, 'player_hummer_t1');
    assert.equal(cfg.profile.cash, hp.cash); assert.equal(guestCfg.profile.cash, guestPaid);
    assert.equal(cfg.role, hostRole); assert.equal(guestCfg.role, hostRole === 'driver' ? 'gunner' : 'driver');
    host.leave(); guest.leave();
    const next = await pair({ profiles: [hp, gp], stores: [hostStore, guestStore], hostRole });
    try {
      assert.equal(next.host.profile.truck, 'player_hummer_t1'); assert.equal(next.guest.profile.truck, 'player_hummer_t1');
      assert.equal(next.host.profile.vehicleUpgrades.hummer.armor, 1); assert.equal(next.guest.profile.cash, guestPaid);
      assert.deepEqual(next.guest.personalProfile.trucks, personalBefore.trucks);
    } finally { next.host.leave(); next.guest.leave(); }
  }
});

test('a premium Hummer cannot spend a rich partner wallet on a forged or unaffordable guest purchase', async () => {
  const { host, guest, guestBuy } = await pair({ hostCash: 200000, guestCash: 99999 });
  const before = structuredClone(host.profile), errors = []; guest.on({ buyDenied: event => errors.push(event) });
  try {
    guestBuy('truck', 'player_hummer_t1'); await flush();
    guest.tp.send({ t: 'buy', kind: 'truck', id: 'player_hummer_t1', payer: 'host', cash: 1000000 }); await flush();
    guestBuy('truck', 'player_hummer_forged'); await flush();
    assert.equal(errors.length, 3); assert.deepEqual(host.profile, before);
    assert.equal(host.profile.cash, 200000); assert.equal(host.peerWallet.cash, 99999); assert.equal(guest.profile.cash, 99999);
  } finally { host.leave(); guest.leave(); }
});

test('both seat assignments debit only the purchasing person while keeping shared equipment and truck upgrades', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const { host, guest, hostBuy, guestBuy, hostStore, guestStore } = await pair({ hostRole });
    guestBuy('weapon', 'smg'); await flush();
    assert.equal(host.profile.cash, 7000); assert.equal(guest.profile.cash, 5000 - WEAPONS.smg.cost);
    assert.ok(host.profile.weapons.smg); assert.ok(guest.profile.weapons.smg);
    const guestBalance = guest.profile.cash;
    hostBuy('upgrade', 'engine'); await flush();
    assert.equal(host.profile.cash, 7000 - UPGRADE_BY_ID.engine.costs[0]); assert.equal(guest.profile.cash, guestBalance);
    assert.equal(host.profile.vehicleUpgrades.sedan.engine, 1); assert.equal(guest.profile.vehicleUpgrades.sedan.engine, 1);
    assert.equal(upgradeLevel(host.profile, 'engine'), 1); assert.equal(upgradeLevel(guest.profile, 'engine'), 1);
    assert.equal(host.profile.upgrades.engine, undefined); assert.equal(guest.profile.upgrades.engine, undefined);
    for (const vehicle of ['truck_t1', 'player_buggy_t1']) {
      assert.equal(upgradeLevel(host.profile, 'engine', vehicle), 0); assert.equal(upgradeLevel(guest.profile, 'engine', vehicle), 0);
    }
    assert.equal(inStore(hostStore, () => loadProfile()).cash, host.profile.cash);
    const personal = inStore(guestStore, () => loadProfile());
    assert.equal(personal.cash, guestBalance); assert.equal(personal.campaignId, 'guest-person');
    assert.equal(personal.runs, 9); assert.equal(personal.best.distance, 12345); assert.equal(personal.upgrades.vest, 2);
    assert.deepEqual(personal.loadout, ['rifle']); assert.equal(personal.weapons.rifle.dmg, 2); assert.equal(personal.weapons.smg, undefined);
    assert.equal(upgradeLevel(personal, 'engine'), 0, 'shared driver purchases must not replace the guest personal inventory');
  }
});

test('both host seats preserve requester-funded shared sights and free factory re-equip', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const { host, guest, guestBuy, hostStore, guestStore } = await pair({ hostRole });
    const personalOptics = structuredClone(inStore(guestStore, () => loadProfile()).weaponOptics);
    const cost = weaponOpticState(host.profile, 'pistol', 'wide_reflex').cost;
    guestBuy('weaponOptic', 'pistol', 'wide_reflex'); await flush();
    assert.equal(host.profile.cash, 7000); assert.equal(guest.profile.cash, 5000 - cost);
    assert.equal(host.peerWallet.cash, 5000 - cost); assert.equal(host.profile.weaponOptics.pistol.equipped, 'wide_reflex');
    assert.deepEqual(guest.profile.weaponOptics.pistol, host.profile.weaponOptics.pistol);
    guestBuy('equipWeaponOptic', 'pistol', 'standard'); await flush();
    assert.equal(host.profile.weaponOptics.pistol.equipped, 'standard'); assert.equal(guest.profile.cash, 5000 - cost);
    assert.equal(inStore(hostStore, () => loadProfile()).weaponOptics.pistol.equipped, 'standard');
    const personal = inStore(guestStore, () => loadProfile());
    assert.equal(personal.cash, 5000 - cost); assert.equal(personal.weaponOptics.rifle.equipped, 'standard');
    assert.deepEqual(personal.weaponOptics, personalOptics, 'shared attachment must not overwrite personal gun inventory or grant a paid optic');
    guestBuy('equipWeaponOptic', 'pistol', 'wide_reflex'); await flush();
    assert.equal(host.profile.weaponOptics.pistol.equipped, 'wide_reflex'); assert.equal(guest.profile.cash, 5000 - cost);
  }
});

test('an unaffordable or locked sight cannot spend the partner wallet or mutate gear', async () => {
  const { host, guest, guestBuy } = await pair({ hostCash: 100000, guestCash: 0 });
  const optics = structuredClone(host.profile.weaponOptics), errors = [];
  guest.on({ buyDenied: event => errors.push(event) });
  guest.tp.send({ t: 'buy', kind: 'weaponOptic', id: 'pistol', extra: 'wide_reflex', payer: 'host', cash: 999999 }); await flush();
  guestBuy('equipWeaponOptic', 'pistol', 'wide_reflex'); await flush();
  assert.equal(errors.length, 2); assert.equal(host.profile.cash, 100000); assert.equal(host.peerWallet.cash, 0);
  assert.equal(guest.profile.cash, 0); assert.deepEqual(host.profile.weaponOptics, optics);
});

test('a rich partner cannot fund an unaffordable or forged guest request and repeated hello cannot refill cash', async () => {
  const { host, guest, guestBuy } = await pair({ hostCash: 100000, guestCash: 0 });
  let denied = 0; guest.on({ buyDenied: () => denied++ });
  guest.tp.send({ t: 'buy', kind: 'weapon', id: 'smg', payer: 'host', cash: 999999, wallet: { cash: 999999, playerId: 'host-person' } });
  await flush();
  assert.equal(denied, 1); assert.equal(host.profile.cash, 100000); assert.equal(guest.profile.cash, 0); assert.equal(host.profile.weapons.smg, undefined);
  guest.tp.send({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL, familyVehicles: PLAYER_VEHICLE_PROTOCOL, eliteVehicles: ELITE_VEHICLE_PROTOCOL, drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL, name: 'Guest', wallet: { playerId: 'guest-person', cash: 999999, totalCash: 999999 } }); await flush();
  guestBuy('upgrade', 'engine'); await flush();
  assert.equal(denied, 2); assert.equal(host.peerWallet.cash, 0); assert.equal(host.profile.cash, 100000);
  assert.equal(upgradeLevel(host.profile, 'engine'), 0); assert.equal(upgradeLevel(guest.profile, 'engine'), 0);
  assert.equal(host.profile.upgrades.engine, undefined);
});

test('invalid shared purchases leave both wallets and catalogue ownership unchanged', async () => {
  const { host, guest, hostBuy, guestBuy } = await pair();
  const campaign = structuredClone(host.profile), personal = structuredClone(guest.personalProfile);
  for (const id of ['missing', '__proto__', 'constructor']) { hostBuy('upgrade', id); guestBuy('weapon', id); }
  guestBuy('weaponTrack', 'pistol', 'bad'); guestBuy('equip', 'pistol', 99); await flush();
  assert.deepEqual(host.profile, campaign); assert.deepEqual(guest.personalProfile, personal); assert.equal(host.peerWallet.cash, 5000);
});

test('simultaneous track requests serialize shared progression while charging each requester exactly once', async () => {
  const { host, guest, hostBuy, guestBuy } = await pair();
  guestBuy('weaponTrack', 'pistol', 'dmg');
  hostBuy('weaponTrack', 'pistol', 'dmg'); await flush();
  assert.equal(host.profile.weapons.pistol.dmg, 2); assert.equal(guest.profile.weapons.pistol.dmg, 2);
  assert.equal(host.profile.cash, 7000 - weaponTrackCost('pistol', 'dmg', 0));
  assert.equal(guest.profile.cash, 5000 - weaponTrackCost('pistol', 'dmg', 1));
});

test('wallets stay with people through seat changes and personalize start profiles', async () => {
  const { host, guest } = await pair();
  host.setRole('gunner'); await flush(); guest.setRole('driver'); await flush();
  assert.equal(host.profile.cash, 7000); assert.equal(guest.profile.cash, 5000); assert.equal(host.peerWallet.playerId, 'guest-person');
  let remote; guest.on({ start: cfg => { remote = cfg; } });
  const cfg = await start(host, guest);
  assert.equal(cfg.role, 'gunner'); assert.equal(remote.role, 'driver'); assert.equal(remote.runId, cfg.runId);
  assert.equal(cfg.profile.cash, 7000); assert.equal(remote.profile.cash, 5000); assert.equal(remote.profile.campaignId, 'host-person');
});

test('only the current authoritative run rewards both independent wallets once and preserves personal progression', async () => {
  const { host, guest, hostStore, guestStore } = await pair();
  const cfg = await start(host, guest), summary = { id: cfg.runId, cash: 321, distance: 4500, furthestS: 4540, time: 45, kills: 3 };
  const pay = sm => inStore(hostStore, () => host.creditResult(sm));
  assert.equal(pay({ ...summary, id: 'unstarted-run' }), false); assert.equal(host.profile.cash, 7000); assert.equal(host.peerWallet.cash, 5000);
  assert.equal(pay(summary), true); await flush();
  assert.equal(host.profile.cash, 7321); assert.equal(guest.profile.cash, 5321); assert.equal(guest.personalProfile.cash, 5321);
  assert.equal(host.profile.runs, 1); assert.equal(guest.profile.runs, 1); assert.equal(guest.personalProfile.runs, 9);
  assert.equal(guest.hasCreditedResult(summary.id), true);
  assert.equal(pay({ ...summary, cash: 999999 }), false); host.broadcastProfile(); await flush();
  assert.equal(host.profile.cash, 7321); assert.equal(guest.profile.cash, 5321);
  assert.equal(inStore(hostStore, () => loadProfile()).cash, 7321); assert.equal(inStore(guestStore, () => loadProfile()).cash, 5321);
  const second = await start(host, guest);
  assert.equal(pay(summary), false); assert.equal(host.profile.cash, 7321);
  assert.equal(pay({ ...summary, id: second.runId, cash: 100 }), true); await flush();
  assert.equal(host.profile.cash, 7421); assert.equal(guest.profile.cash, 5421);
});

test('leaving and reconnecting resumes each saved wallet without adopting the host campaign inventory', async () => {
  const first = await pair(); first.guestBuy('weapon', 'smg'); await flush();
  first.host.leave(); first.guest.leave();
  const hp = inStore(first.hostStore, () => loadProfile()), gp = inStore(first.guestStore, () => loadProfile());
  assert.equal(hp.cash, 7000); assert.equal(gp.cash, 5000 - WEAPONS.smg.cost); assert.deepEqual(gp.loadout, ['rifle']);
  const next = await pair({ profiles: [hp, gp], stores: [first.hostStore, first.guestStore], hostRole: 'gunner' });
  assert.equal(next.host.profile.cash, 7000); assert.equal(next.guest.profile.cash, gp.cash); assert.ok(next.guest.profile.weapons.smg);
  const balance = next.guest.profile.cash; next.hostBuy('weaponTrack', 'smg', 'dmg'); await flush();
  assert.equal(next.guest.profile.cash, balance); assert.equal(next.host.profile.cash, 7000 - weaponTrackCost('smg', 'dmg', 0));
});

test('invalid wallet handshakes cannot start a split run or debit the host', async () => {
  const { host, guest } = await pair(); host.peerWallet = null;
  host._onMsg({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL, familyVehicles: PLAYER_VEHICLE_PROTOCOL, eliteVehicles: ELITE_VEHICLE_PROTOCOL, drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL, name: 'Old client', wallet: { playerId: '', cash: Infinity } });
  host.me.role = 'driver'; host.other.role = 'gunner'; host.me.ready = host.other.ready = true;
  assert.equal(host.canStart(), false); assert.equal(host.startRun(), null);
  host._onMsg({ t: 'buy', kind: 'weapon', id: 'smg' }); await flush();
  assert.equal(host.profile.cash, 7000); assert.equal(guest.profile.cash, 5000); assert.equal(host.profile.weapons.smg, undefined);
});

test('stale profile and duplicate start deliveries cannot roll back cash or restart a run', async () => {
  const { host, guest, guestBuy, guestStore } = await pair();
  const old = structuredClone(host.tp.sent.findLast(message => message.t === 'profile'));
  guestBuy('weapon', 'smg'); await flush();
  const balance = guest.profile.cash, revision = guest.profile.revision;
  inStore(guestStore, () => guest._onMsg(old));
  assert.equal(guest.profile.cash, balance); assert.equal(guest.personalProfile.cash, balance); assert.equal(guest.profile.revision, revision);
  let starts = 0; guest.on({ start: () => starts++ }); await start(host, guest);
  const cfg = structuredClone(host.tp.sent.findLast(message => message.t === 'start'));
  inStore(guestStore, () => guest._onMsg(cfg)); assert.equal(starts, 1);
  host.peerWallet.cash -= 10; inStore(host.tp.store, () => saveProfile(host.profile)); host.broadcastProfile(); await flush();
  inStore(guestStore, () => guest._onMsg(cfg)); assert.equal(starts, 1); assert.equal(guest.profile.cash, balance - 10);
});

test('a new physical connection binds its own wallet rather than the prior guest wallet', async () => {
  const { host, guest, guestBuy } = await pair(); guestBuy('weapon', 'smg'); await flush();
  const previous = host.peerWallet; assert.equal(previous.cash, 5000 - WEAPONS.smg.cost);
  host.tp.onClose(); assert.equal(host.peerWallet, null); assert.equal(host.activeRunId, null);
  host.tp.onOpen();
  host._onMsg({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL, familyVehicles: PLAYER_VEHICLE_PROTOCOL, eliteVehicles: ELITE_VEHICLE_PROTOCOL, drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL, name: 'A different person', wallet: { playerId: 'third-person', cash: 1234, totalCash: 4000 } });
  assert.equal(host.peerWallet.playerId, 'third-person'); assert.equal(host.peerWallet.cash, 1234);
  assert.notEqual(host.peerWallet, previous); assert.equal(host.profile.cash, 7000);
  guest.leave(); host.leave(); await flush();
});

test('an unseen older start cannot replace a later run even when campaign revisions are equal', async () => {
  const { host, guest } = await pair();
  const original = guest.tp.onMessage; let delayed;
  guest.tp.onMessage = message => { if (message.t === 'start' && !delayed) delayed = structuredClone(message); else original(message); };
  const first = await start(host, guest); assert.equal(guest.activeRunId, null);
  let starts = 0; guest.on({ start: () => starts++ });
  const second = await start(host, guest); assert.notEqual(second.runId, first.runId); assert.equal(starts, 1); assert.equal(guest.activeRunId, second.runId);
  assert.equal(delayed.cfg.profile.revision, second.profile.revision);
  original(delayed); assert.equal(starts, 1); assert.equal(guest.activeRunId, second.runId);
});

test('a valid peer hello received before the local open callback keeps its wallet', async () => {
  const store = storage(), session = new Session(new Memory(store));
  const profile = DEFAULT_PROFILE(); profile.cash = 7000; await session.host(profile);
  session._onMsg({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL, familyVehicles: PLAYER_VEHICLE_PROTOCOL, eliteVehicles: ELITE_VEHICLE_PROTOCOL, drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL, name: 'Guest', wallet: { playerId: 'guest-person', cash: 1234, totalCash: 5000 } });
  const wallet = session.peerWallet; session.tp.onOpen();
  assert.equal(session.peerWallet, wallet); assert.equal(session.peerWallet.cash, 1234); assert.equal(session.profile.cash, 7000);
});

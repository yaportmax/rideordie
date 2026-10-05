import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, effects } from '../src/data/upgrades.js';
import { normalizeProfile, loadProfile } from '../src/meta/profile.js';
import { normalizeCampaignProgress, campaignJourney, CAMPAIGN_PROTOCOL } from '../src/data/campaign.js';
import { weaponAttachmentState } from '../src/meta/weapon_attachments.js';
import { NET_PROTOCOL, encodeRunPacket } from '../src/net/run_packet.js';
import { GARAGE_SEAT_PROTOCOL } from '../src/net/garage_seats.js';
import { PLAYER_VEHICLE_PROTOCOL } from '../src/data/vehicle_families.js';
import { ELITE_VEHICLE_PROTOCOL } from '../src/data/elite_vehicles.js';
import { DRIVING_ROUTE_VERSION } from '../src/world/driving_plan.js';
const { Session } = await import('../src/net/session.js');

// Actual Session and profile APIs over a cloned in-memory transport. These
// tests do not establish WebRTC, WAN latency, browser visuals or GPU timing.
const storage = () => { const rows = new Map(); return { getItem: key => rows.get(key), setItem: (key, value) => rows.set(key, value) }; };
function inStore(store, fn) {
  const old = globalThis.localStorage; globalThis.localStorage = store;
  try { return fn(); } finally { if (old === undefined) delete globalThis.localStorage; else globalThis.localStorage = old; }
}
class Memory {
  constructor(store = storage()) { this.store = store; this.sent = []; this.closed = 0; this.rtt = 0; }
  async host() { return 'ABCDE'; }
  async join() {}
  send(message) {
    const copy = structuredClone(message); this.sent.push(copy); const receiver = this.other;
    if (receiver) queueMicrotask(() => { if (this.other === receiver) inStore(receiver.store, () => receiver.onMessage(structuredClone(copy))); });
    return true;
  }
  sendFast() { return true; }
  closeConnection() { this.closed++; this.onClose(); }
  destroy() { this.other = null; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const levels = n => normalizeCampaignProgress({ cleared: Array.from({ length: n - 1 }, (_, i) => i + 1), selectedLevel: n });
async function pair({ hostRole = 'driver', hostLevel = 9, guestLevel = 1 } = {}) {
  const hs = storage(), gs = storage();
  const hp = normalizeProfile(DEFAULT_PROFILE()), gp = normalizeProfile(DEFAULT_PROFILE());
  hp.campaignId = 'host-attachment-career'; hp.cash = 1000000; hp.campaignProgress = levels(hostLevel);
  hp.weapons.rifle = { dmg: 0, mag: 0, rel: 0, hnd: 0 }; hp.loadout = ['rifle', 'pistol'];
  Object.assign(hp, normalizeProfile(hp)); // Canonical owned rifle includes its actual free standard sight before the room opens.
  gp.campaignId = 'guest-attachment-career'; gp.cash = 1000000; gp.campaignProgress = levels(guestLevel);
  const a = new Memory(hs), b = new Memory(gs); a.other = b; b.other = a;
  const host = new Session(a), guest = new Session(b);
  await host.host(hp); await guest.join('ABCDE', gp);
  inStore(hs, () => a.onOpen()); inStore(gs, () => b.onOpen()); await flush();
  host.setRole(hostRole); guest.setRole(hostRole === 'driver' ? 'gunner' : 'driver'); await flush();
  host.broadcastProfile(); await flush();
  host.swap.enterGarage(); guest.swap.enterGarage(); await flush();
  return { host, guest, hp, gp, hs, gs, a, b,
    buyHost: (...args) => inStore(hs, () => host.buy(...args)),
    buyGuest: (...args) => inStore(gs, () => guest.buy(...args)),
    credit: summary => inStore(hs, () => host.creditResult(summary)) };
}
async function start(f) {
  f.host.swap.ready(true); f.guest.swap.ready(true); await flush(); assert.equal(f.host.canStart(), true);
  const cfg = f.host.startRun({ seed: 173, journey: campaignJourney(f.host.profile) }); await flush(); assert.ok(cfg); return cfg;
}
const summary = (cfg, extra = {}) => ({ id: cfg.runId, cash: 420, distance: 3000, furthestS: 3000, time: 120, kills: 5,
  won: true, levelCleared: true, journey: structuredClone(cfg.journey), ...extra });
const context = session => ({ phase: 'garage', epoch: session.swap.state.epoch, revision: session.swap.state.revision });
const gear = p => structuredClone({ weapons: p.weapons, loadout: p.loadout, weaponOptics: p.weaponOptics, weaponAttachments: p.weaponAttachments });
const hello = wallet => ({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL,
  familyVehicles: PLAYER_VEHICLE_PROTOCOL, eliteVehicles: ELITE_VEHICLE_PROTOCOL, drivingRoutes: DRIVING_ROUTE_VERSION,
  campaignProtocol: CAMPAIGN_PROTOCOL, name: 'Guest', wallet });

test('funded guest purchases use personal earned career, not the advanced shared host map', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const f = await pair({ hostRole, hostLevel: 9, guestLevel: 1 }), before = structuredClone(f.gp), cash = f.hp.cash;
    assert.equal(f.host.peerWallet.weaponCareerLevel, 1); assert.equal(f.guest.profile.campaignProgress.unlockedLevel, 9);
    f.buyGuest('weapon', 'rpg'); await flush();
    assert.equal(Object.hasOwn(f.host.profile.weapons, 'rpg'), false);
    assert.equal(f.host.peerWallet.cash, before.cash); assert.deepEqual(f.gp, before); assert.equal(f.hp.cash, cash);
    assert.equal(f.a.sent.findLast(row => row.t === 'buyDenied').reason, 'progress');
    assert.equal(f.buyHost('weapon', 'rpg').ok, true); await flush();
    assert.equal(Object.hasOwn(f.guest.profile.weapons, 'rpg'), true);
    assert.equal(Object.hasOwn(f.gp.weapons, 'rpg'), false, 'shared role equipment cannot replace the guest personal save');
    assert.equal(f.host.peerWallet.cash, before.cash);
  }
});

test('both host arrangements charge attachment buyer only, restore selections and preserve role gear on agreed swap', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const f = await pair({ hostRole }), cost = weaponAttachmentState(f.host.profile, 'rifle', 'laser').cost;
    const hostCash = f.hp.cash, guestCash = f.gp.cash, guestInventory = gear(f.gp);
    f.buyGuest('weaponAttachment', 'rifle', { id: 'laser', enabled: true }); await flush();
    assert.equal(f.hp.cash, hostCash); assert.equal(f.gp.cash, guestCash - cost); assert.equal(f.host.peerWallet.cash, guestCash - cost);
    assert.deepEqual(f.guest.profile.weaponAttachments.rifle, { owned: ['laser'], equipped: ['laser'] });
    assert.deepEqual(gear(f.gp), guestInventory, 'wallet update does not copy campaign equipment');
    const savedHost = inStore(f.hs, () => loadProfile());
    assert.deepEqual(savedHost.weaponAttachments.rifle, f.host.profile.weaponAttachments.rifle);
    f.buyGuest('equipWeaponAttachment', 'rifle', { id: 'laser', enabled: false }); await flush();
    assert.deepEqual(f.host.profile.weaponAttachments.rifle, { owned: ['laser'], equipped: [] });
    assert.equal(f.gp.cash, guestCash - cost);
    f.buyHost('equipWeaponAttachment', 'rifle', { id: 'laser', enabled: true }); await flush();
    const paidGear = gear(f.host.profile), wallets = [f.hp.cash, f.gp.cash];
    assert.equal(f.host.swap.request().ok, true); await flush();
    const pending = f.guest.swap.snapshot().pending; assert.ok(pending);
    assert.equal(f.guest.swap.respond(pending.id, true).ok, true); await flush();
    assert.equal(f.host.me.role, hostRole === 'driver' ? 'gunner' : 'driver');
    assert.deepEqual(gear(f.host.profile), paidGear); assert.deepEqual(gear(f.guest.profile), paidGear);
    assert.deepEqual([f.hp.cash, f.gp.cash], wallets);
    const cfg = await start(f), selected = effects(cfg.profile).weaponAttachments;
    assert.deepEqual(selected.rifle, ['laser']); assert.ok(Object.isFrozen(selected)); assert.ok(Object.isFrozen(selected.rifle));
    f.host.profile.weaponAttachments.rifle.equipped.length = 0;
    assert.deepEqual(selected.rifle, ['laser'], 'run selected IDs cannot alias a live garage row');
  }
});

test('malformed attachment JSON, foreign payer and stale garage commands are atomic', async () => {
  const f = await pair(), before = structuredClone(f.hp), wallet = structuredClone(f.host.peerWallet);
  const base = { t: 'buy', kind: 'weaponAttachment', id: 'rifle', ...context(f.host) };
  const invalid = [null, [], 'laser', {}, { id: 'laser' }, { enabled: true }, { id: 'laser', enabled: 1 },
    { id: 'laser', enabled: 'true' }, { id: 'laser', enabled: true, cash: 0 }, { id: '__proto__', enabled: true },
    { id: 'constructor', enabled: true }, { id: 'laser', enabled: false }];
  for (const extra of invalid) {
    inStore(f.hs, () => f.host._onMsg({ ...base, extra })); await flush();
    assert.deepEqual(f.hp, before); assert.deepEqual(f.host.peerWallet, wallet);
  }
  for (const stale of [{ phase: 'run' }, { epoch: base.epoch - 1 }, { revision: base.revision - 1 }]) {
    inStore(f.hs, () => f.host._onMsg({ ...base, ...stale, extra: { id: 'laser', enabled: true } })); await flush();
    assert.deepEqual(f.hp, before); assert.deepEqual(f.host.peerWallet, wallet);
  }
  const cost = weaponAttachmentState(f.hp, 'rifle', 'laser').cost;
  inStore(f.hs, () => f.host._onMsg({ ...base, extra: { id: 'laser', enabled: true }, wallet: { playerId: f.hp.campaignId, cash: 0 }, payer: 'host' })); await flush();
  assert.equal(f.hp.cash, before.cash); assert.equal(f.host.peerWallet.cash, wallet.cash - cost, 'foreign payer fields never select a different wallet');
  const cfg = await start(f), runningGear = gear(f.hp), runningWallet = structuredClone(f.host.peerWallet);
  f.buyGuest('weaponAttachment', 'rifle', { id: 'foregrip', enabled: true }); await flush();
  assert.deepEqual(gear(f.hp), runningGear); assert.deepEqual(f.host.peerWallet, runningWallet);
  assert.equal(f.host.activeRunId, cfg.runId);
});

test('paid current-life campaign receipts advance guest career once without copying host clears or skipping chapters', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const f = await pair({ hostRole, hostLevel: 1, guestLevel: 1 }), cfg = await start(f), originalCash = f.gp.cash;
    assert.equal(f.credit(summary(cfg)), true); await flush();
    assert.deepEqual(f.gp.campaignProgress.cleared, [1]); assert.equal(f.gp.campaignProgress.unlockedLevel, 2);
    assert.equal(f.gp.campaignProgress.clearRuns[1], cfg.runId); assert.equal(f.gp.cash, originalCash + 420);
    assert.equal(f.host.peerWallet.weaponCareerLevel, 2);
    const once = structuredClone(f.gp); assert.equal(f.credit(summary(cfg)), false); await flush(); assert.deepEqual(f.gp, once);
    const persisted = inStore(f.gs, () => loadProfile()); assert.deepEqual(persisted.campaignProgress, once.campaignProgress);
    const nextTransport = new Memory(f.gs), rejoined = new Session(nextTransport);
    await rejoined.join('ABCDE', persisted); inStore(f.gs, () => nextTransport.onOpen());
    assert.equal(nextTransport.sent.find(row => row.t === 'hello').wallet.weaponCareerLevel, 2, 'a reconnect derives career from the guest own persisted receipts');
    const staleWallet = { ...f.host.peerWallet, careerCredit: { runId: 'stale-life', level: 2, mode: 'campaign', won: true } };
    assert.equal(inStore(f.gs, () => f.guest._receiveProfile(f.host.profile, staleWallet)), true);
    assert.deepEqual(f.gp.campaignProgress, once.campaignProgress);
    const skipped = await pair({ hostRole, hostLevel: 9, guestLevel: 1 }), later = await start(skipped);
    assert.equal(skipped.credit(summary(later)), true); await flush();
    assert.deepEqual(skipped.gp.campaignProgress.cleared, []); assert.equal(skipped.host.peerWallet.weaponCareerLevel, 1);
  }
});

test('repeated hello cannot overwrite established personal career or wallet, and exact protocol8 is rejected before content', async () => {
  const f = await pair(), knownWallet = structuredClone(f.host.peerWallet);
  f.host._onMsg(hello({ playerId: f.gp.campaignId, cash: 999999999, totalCash: 999999999, weaponCareerLevel: 10 }));
  assert.deepEqual(f.host.peerWallet, knownWallet);
  assert.equal(NET_PROTOCOL, 9);
  for (const hostRole of ['driver', 'gunner']) for (const receiverSide of ['host', 'guest']) {
    const p = await pair({ hostRole }), cfg = await start(p), receiver = p[receiverSide];
    const before = structuredClone(receiver.personalProfile), oldHeader = receiver._fastHeader, reliable = [], fast = [];
    receiver.on({ run: row => reliable.push(row), fast: row => fast.push(row) });
    receiver._onMsg({ ...hello(p.host.peerWallet), protocol: 8 });
    assert.equal(receiver.connected, false); assert.equal(receiver.activeRunId, null); assert.equal(receiver._peerProtocol, null);
    receiver._onMsg({ t: 'input', runId: cfg.runId, g: { fire: true } });
    receiver.tp.onFast(encodeRunPacket(oldHeader, new Uint8Array([3, 0, 0, 0]).buffer));
    assert.deepEqual(reliable, []); assert.deepEqual(fast, []); assert.deepEqual(receiver.personalProfile, before);
  }
});

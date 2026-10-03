import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { normalizeProfile, loadProfile } from '../src/meta/profile.js';
import { CAMPAIGN_PROTOCOL, campaignJourney, normalizeCampaignProgress } from '../src/data/campaign.js';
import { NET_PROTOCOL } from '../src/net/run_packet.js';
import { GARAGE_SEAT_PROTOCOL } from '../src/net/garage_seats.js';
import { PLAYER_VEHICLE_PROTOCOL } from '../src/data/vehicle_families.js';
import { DRIVING_ROUTE_VERSION } from '../src/world/driving_plan.js';
const { Session } = await import('../src/net/session.js');

const storage = () => { const data = new Map(); return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), data }; };
function inStore(store, fn) {
  const previous = globalThis.localStorage; globalThis.localStorage = store;
  try { return fn(); } finally { globalThis.localStorage = previous; }
}
class Memory {
  constructor(store = storage()) { this.store = store; this.sent = []; this.rtt = 0; this.closedConnections = 0; }
  async host() { return 'ABCDE'; }
  async join() {}
  send(message) {
    this.sent.push(structuredClone(message)); const receiver = this.other;
    if (receiver) queueMicrotask(() => { if (this.other === receiver) inStore(receiver.store, () => receiver.onMessage(structuredClone(message))); });
    return true;
  }
  sendFast() { return true; }
  destroy() { this.other = null; }
  closeConnection() { this.closedConnections++; this.onClose(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function pair({ hostRole = 'driver', hostCleared = [], guestCleared = [1, 2] } = {}) {
  const hs = storage(), gs = storage(), hp = normalizeProfile(DEFAULT_PROFILE()), gp = normalizeProfile(DEFAULT_PROFILE());
  hp.campaignId = 'host-person'; hp.cash = 7000; hp.totalCash = 12000;
  hp.campaignProgress = normalizeCampaignProgress({ cleared: hostCleared });
  hp.weapons.minigun = { dmg: 2, mag: 1, rel: 0, hnd: 1 }; hp.loadout = ['minigun', 'pistol'];
  hp.vehicleUpgrades.sedan.engine = 2;
  gp.campaignId = 'guest-person'; gp.cash = 1234; gp.totalCash = 18000;
  gp.campaignProgress = normalizeCampaignProgress({ cleared: guestCleared, selectedLevel: 3 });
  gp.weapons.smg = { dmg: 1, mag: 0, rel: 0, hnd: 0 }; gp.loadout = ['smg'];
  const a = new Memory(hs), b = new Memory(gs); a.other = b; b.other = a;
  const host = new Session(a), guest = new Session(b);
  await host.host(hp); await guest.join('ABCDE', gp);
  inStore(hs, () => a.onOpen()); inStore(gs, () => b.onOpen()); await flush();
  host.setRole(hostRole); guest.setRole(hostRole === 'driver' ? 'gunner' : 'driver'); await flush();
  host.broadcastProfile(); await flush();
  host.swap.enterGarage(); guest.swap.enterGarage(); await flush();
  return { host, guest, hs, gs, select: (...args) => inStore(hs, () => host.selectJourney(...args)),
    credit: summary => inStore(hs, () => host.creditResult(summary)) };
}
async function ready(host, guest) {
  host.swap.ready(true); guest.swap.ready(true); await flush(); assert.equal(host.canStart(), true);
}
async function start(host, guest, journey = campaignJourney(host.profile)) {
  await ready(host, guest); const cfg = host.startRun({ seed: 17, journey }); assert.ok(cfg); await flush(); return cfg;
}
const summary = (cfg, extra = {}) => ({ id: cfg.runId, cash: 400, distance: 3600, furthestS: 3640, time: 90, kills: 4,
  won: true, levelCleared: true, journey: structuredClone(cfg.journey), minibosses: [0], ...extra });
const hello = campaignProtocol => ({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL,
  familyVehicles: PLAYER_VEHICLE_PROTOCOL, drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol,
  name: 'Guest', wallet: { playerId: 'guest-person', cash: 1234, totalCash: 18000 } });

test('hello requires explicit campaign capability and rejects a protocol-3 minigun/elite peer before mutation', async () => {
  for (const campaignProtocol of [undefined, 0, 2, '1']) {
    const transport = new Memory(), session = new Session(transport), p = normalizeProfile(DEFAULT_PROFILE());
    await session.host(p); const before = structuredClone(p), errors = []; session.on({ error: error => errors.push(error) });
    transport.onOpen(); session._onMsg(hello(campaignProtocol));
    assert.equal(session.connected, false); assert.equal(session.peerWallet, null); assert.equal(session.other, null);
    assert.equal(transport.closedConnections, 1); assert.equal(errors[0].type, 'protocol-mismatch'); assert.deepEqual(p, before);
  }
  const transport = new Memory(), session = new Session(transport); await session.host(normalizeProfile(DEFAULT_PROFILE()));
  transport.onOpen(); session._onMsg({ ...hello(CAMPAIGN_PROTOCOL), protocol: 3 });
  assert.equal(session.connected, false); assert.equal(session.canStart(), false); assert.equal(transport.closedConnections, 1);
  assert.equal(NET_PROTOCOL, 6);
});

test('host chapter selection invalidates old consent/readiness without moving personal cash, gear or garage presence', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const f = await pair({ hostRole, hostCleared: [1] }), { host, guest } = f;
    await ready(host, guest); const oldReady = structuredClone(guest.tp.sent.findLast(message => message.t === 'seatSwapReady'));
    assert.equal(host.swap.request().ok, true); await flush(); const pending = host.swap.snapshot().pending;
    const oldAccept = { t: 'seatSwapResponse', phase: 'garage', epoch: pending.epoch, revision: pending.revision, id: pending.id, accept: true };
    const before = host.swap.snapshot(), gear = structuredClone({ cash: host.profile.cash, totalCash: host.profile.totalCash,
      weapons: host.profile.weapons, loadout: host.profile.loadout, vehicleUpgrades: host.profile.vehicleUpgrades }), personal = structuredClone(guest.personalProfile);
    assert.deepEqual(f.select(2, 'campaign'), { ok: true }); await flush();
    const after = host.swap.snapshot(); assert.equal(after.epoch, before.epoch); assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(after.presence, before.presence); assert.deepEqual(after.roles, before.roles); assert.equal(after.pending, null);
    assert.deepEqual(after.ready, { host: false, guest: false }); assert.equal(host.canStart(), false);
    assert.deepEqual(campaignJourney(host.profile), { version: 1, mode: 'campaign', level: 2 });
    assert.deepEqual(guest.profile.campaignProgress, host.profile.campaignProgress);
    assert.deepEqual({ cash: host.profile.cash, totalCash: host.profile.totalCash, weapons: host.profile.weapons,
      loadout: host.profile.loadout, vehicleUpgrades: host.profile.vehicleUpgrades }, gear);
    assert.deepEqual(guest.personalProfile, personal); assert.equal(host.peerWallet.cash, 1234);
    host._onMsg(oldReady); host._onMsg(oldAccept); assert.deepEqual(host.swap.snapshot(), after);
    assert.deepEqual(guest.selectJourney(1), { ok: false, reason: 'unavailable' });
  }
});

test('locked selections and host selection outside garage are rejected without revision or readiness changes', async () => {
  const f = await pair(), { host, guest } = f; await ready(host, guest);
  const p = structuredClone(host.profile), state = host.swap.snapshot();
  for (const [level, mode] of [[2, 'campaign'], [1, 'marathon'], [0, 'campaign'], [1, 'unknown']]) {
    assert.equal(f.select(level, mode).ok, false); assert.deepEqual(host.profile, p); assert.deepEqual(host.swap.snapshot(), state);
  }
  const cfg = host.startRun({ journey: campaignJourney(host.profile) }); assert.ok(cfg); await flush();
  assert.deepEqual(f.select(1), { ok: false, reason: 'unavailable' });
});

test('explicit starts reject malformed schema, locked modes/levels and unselected chapters before allocating a life', async () => {
  const { host, guest } = await pair({ hostCleared: [1] }); await ready(host, guest);
  const invalid = [null, [], 'campaign', {}, { mode: 'campaign', level: 1 }, { version: 2, mode: 'campaign', level: 1 },
    { version: 1, mode: 'campaign', level: 0 }, { version: 1, mode: 'campaign', level: 11 }, { version: 1, mode: 'campaign', level: 1.5 },
    { version: 1, mode: 'unknown', level: 1 }, { version: 1, mode: 'marathon', level: 1 },
    { version: 1, mode: 'campaign', level: 3 }, { version: 1, mode: 'campaign', level: 2 },
    { version: 1, mode: 'campaign', level: 1, startS: 59000 }];
  const before = host.swap.snapshot(), sent = host.tp.sent.length;
  for (const journey of invalid) {
    assert.equal(host.startRun({ journey }), null, JSON.stringify(journey)); assert.equal(host.runSeq, 0);
    assert.equal(host.activeRunId, null); assert.equal(host.activeRunJourney, null); assert.deepEqual(host.swap.snapshot(), before);
    assert.equal(host.tp.sent.length, sent);
  }
  const cfg = host.startRun({ seed: 17 }); assert.ok(cfg); await flush();
  assert.deepEqual(cfg.journey, { version: 1, mode: 'legacy', level: 1 }); assert.deepEqual(guest.activeRunJourney, cfg.journey);
});

test('both host seats pin a frozen journey beside the life identifier and reject receiver forgeries before save/wallet mutation', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const f = await pair({ hostRole }), { host, guest } = f; await ready(host, guest);
    const receiver = host.tp.other; host.tp.other = null;
    const inputJourney = { version: 1, mode: 'campaign', level: 1 }, cfg = host.startRun({ seed: 17, journey: inputJourney }); assert.ok(cfg);
    const message = structuredClone(host.tp.sent.findLast(m => m.t === 'start'));
    inputJourney.level = 10; assert.equal(host.activeRunJourney.level, 1); assert.equal(Object.isFrozen(host.activeRunJourney), true);
    assert.deepEqual(host.activeRunRoles, cfg.roles); assert.equal(Object.isFrozen(host.activeRunRoles), true);
    let received; guest.on({ start: value => { received = value; } });
    const before = { profile: structuredClone(guest.profile), personal: structuredClone(guest.personalProfile), wallet: structuredClone(guest.wallet),
      revision: guest._receivedRevision, runSeq: guest.runSeq, seats: guest.swap.snapshot(), storage: [...f.gs.data] };
    for (const journey of [null, [], {}, { version: 9, mode: 'campaign', level: 1 }, { version: 1, mode: 'unknown', level: 1 },
      { version: 1, mode: 'campaign', level: 2 }, { version: 1, mode: 'marathon', level: 1 }, { version: 1, mode: 'campaign', level: 1, forged: true }]) {
      inStore(f.gs, () => guest._onMsg({ ...structuredClone(message), cfg: { ...structuredClone(message.cfg), journey } }));
      assert.equal(received, undefined); assert.equal(guest.activeRunId, null);
      assert.deepEqual({ profile: guest.profile, personal: guest.personalProfile, wallet: guest.wallet, revision: guest._receivedRevision,
        runSeq: guest.runSeq, seats: guest.swap.snapshot(), storage: [...f.gs.data] }, before);
    }
    inStore(f.gs, () => guest._onMsg(message)); assert.ok(received); assert.equal(received.role, hostRole === 'driver' ? 'gunner' : 'driver');
    assert.deepEqual(received.journey, host.activeRunJourney); assert.equal(Object.isFrozen(guest.activeRunJourney), true);
    assert.deepEqual(guest.activeRunRoles, cfg.roles); assert.equal(Object.isFrozen(guest.activeRunRoles), true);
    assert.equal(guest.activeRunId, cfg.runId); assert.ok(received.profile.weapons.minigun);
    assert.deepEqual(received.profile.loadout, ['minigun', 'pistol']); host.tp.other = receiver;
    guest.activeRunId = null; assert.equal(guest.activeRunJourney, null); assert.equal(guest._fastHeader, null);
    assert.equal(guest.activeRunRoles, null); host.tp.onClose(); assert.equal(host.activeRunJourney, null); assert.equal(host.activeRunRoles, null);
  }
});

test('only the driver authority forwards a current-life summary with the exact pinned journey', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const { host, guest } = await pair({ hostRole }), cfg = await start(host, guest), authority = hostRole === 'driver' ? host : guest;
    const viewer = authority === host ? guest : host, received = [], atAuthority = [];
    viewer.on({ run: message => received.push(message) }); authority.on({ run: message => atAuthority.push(message) });
    for (const s of [summary(cfg, { id: 'old-life' }), summary(cfg, { journey: { version: 1, mode: 'campaign', level: 2 } }),
      summary(cfg, { journey: undefined }), summary(cfg, { levelCleared: 'true' }), summary(cfg, { won: false })]) {
      authority.sendJSON({ t: 'summary', s });
    }
    viewer.sendJSON({ t: 'summary', s: summary(cfg) }); await flush();
    assert.deepEqual(received, []); assert.deepEqual(atAuthority, []);
    authority.sendJSON({ t: 'summary', s: summary(cfg) }); await flush();
    assert.equal(received.length, 1); assert.deepEqual(received[0].s.journey, cfg.journey);
  }
});

test('in-run lobby commands retain the existing consent reducer guard and cannot change pinned summary authority', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const { host, guest } = await pair({ hostRole }), cfg = await start(host, guest);
    const authority = hostRole === 'driver' ? host : guest, gunner = authority === host ? guest : host;
    const roles = structuredClone(authority.activeRunRoles), before = structuredClone({ me: authority.me, other: authority.other }), received = [];
    authority.on({ run: message => received.push(message) });
    gunner.tp.send({ t: 'role', role: 'driver' }); gunner.tp.send({ t: 'ready', ready: true });
    gunner.tp.send({ t: 'lobby', host: { role: 'driver', ready: true }, guest: { role: 'gunner', ready: true } });
    gunner.sendJSON({ t: 'summary', s: summary(cfg) }); await flush();
    assert.deepEqual({ me: authority.me, other: authority.other }, before); assert.deepEqual(received, []);
    assert.deepEqual(authority.activeRunRoles, roles);
    // Even an unrelated local/UI mutation cannot promote a gunner packet to
    // simulation authority: the received start pin is the only source.
    authority.other.role = 'driver'; gunner.sendJSON({ t: 'summary', s: summary(cfg) }); await flush(); assert.deepEqual(received, []);
    assert.deepEqual(authority.activeRunRoles, roles);
  }
});

test('first validated terminal summary survives altered same-life duplicates and resets for a later life', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const { host, guest } = await pair({ hostRole }), cfg = await start(host, guest);
    const authority = hostRole === 'driver' ? host : guest, viewer = authority === host ? guest : host, received = [];
    viewer.on({ run: message => received.push(message) });
    authority.sendJSON({ t: 'summary', s: summary(cfg, { journey: { version: 1, mode: 'campaign', level: 2 } }) }); await flush();
    assert.equal(viewer._receivedSummaryId, null); assert.deepEqual(received, []);
    const original = summary(cfg, { won: false, levelCleared: false, cause: 'DRIVER KILLED' });
    authority.sendJSON({ t: 'summary', s: original }); await flush();
    authority.sendJSON({ t: 'summary', s: summary(cfg, { cash: 999999, cause: 'VICTORY' }) });
    authority.sendJSON({ t: 'summary', s: original }); await flush();
    assert.equal(received.length, 1); assert.deepEqual(received[0].s, original); assert.equal(viewer._receivedSummaryId, cfg.runId);
    host.activeRunId = guest.activeRunId = null; assert.equal(viewer._receivedSummaryId, null);
    host.swap.enterGarage(); guest.swap.enterGarage(); await flush(); const next = await start(host, guest);
    authority.sendJSON({ t: 'summary', s: summary(next) }); await flush();
    assert.equal(received.length, 2); assert.equal(received[1].s.id, next.runId); assert.equal(viewer._receivedSummaryId, next.runId);
  }
});

test('malformed numeric campaign summaries cannot pay or poison records before a later valid result', async () => {
  const f = await pair(), { host, guest } = f, cfg = await start(host, guest), p = structuredClone(host.profile), wallet = structuredClone(host.peerWallet);
  for (const field of ['cash', 'kills', 'crashKills', 'distance', 'furthestS', 'time']) for (const value of [NaN, Infinity, -1, '400', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(f.credit(summary(cfg, { [field]: value })), false, `${field}:${value}`);
    assert.deepEqual(host.profile, p); assert.deepEqual(host.peerWallet, wallet);
  }
  for (const field of ['cash', 'kills', 'crashKills']) assert.equal(f.credit(summary(cfg, { [field]: .5 })), false);
  assert.equal(f.credit(summary(cfg)), true); assert.equal(host.profile.cash, 7400); assert.equal(host.peerWallet.cash, 1634);
});

test('exact finite clear pays both personal wallets once, advances host campaign and preserves the guest own save', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const f = await pair({ hostRole }), { host, guest } = f, personal = structuredClone(guest.personalProfile);
    const cfg = await start(host, guest), result = summary(cfg);
    for (const invalid of [summary(cfg, { journey: { version: 2, mode: 'campaign', level: 1 } }), summary(cfg, { levelCleared: undefined }),
      summary(cfg, { journey: { version: 1, mode: 'campaign', level: 2 } }), summary(cfg, { won: 'true' }), summary(cfg, { won: false })]) {
      assert.equal(f.credit(invalid), false); assert.equal(host.profile.cash, 7000); assert.deepEqual(host.profile.campaignProgress.cleared, []);
    }
    assert.equal(f.credit(result), true); await flush();
    assert.equal(host.profile.cash, 7400); assert.equal(host.peerWallet.cash, 1634); assert.equal(guest.profile.cash, 1634);
    assert.deepEqual(host.profile.campaignProgress.cleared, [1]); assert.equal(host.profile.campaignProgress.selectedLevel, 2);
    assert.equal(host.profile.campaignProgress.clearRuns[1], cfg.runId); assert.equal(host.profile.campaignProgress.unlockedLevel, 2);
    assert.deepEqual(guest.profile.campaignProgress, host.profile.campaignProgress);
    assert.equal(host.activeRunJourney.level, 1, 'a next-chapter selection cannot change the completed life pin');
    assert.equal(f.credit(result), false); assert.equal(f.credit(summary(cfg, { levelCleared: false, won: false })), false);
    assert.equal(host.profile.cash, 7400); assert.equal(host.peerWallet.cash, 1634); assert.equal(host.profile.runs, 1);
    const savedGuest = inStore(f.gs, () => loadProfile());
    assert.deepEqual(savedGuest.campaignProgress, personal.campaignProgress); assert.deepEqual(savedGuest.loadout, personal.loadout);
    assert.deepEqual(savedGuest.weapons, personal.weapons); assert.equal(savedGuest.cash, 1634);
    const sharedArchive = JSON.parse(f.gs.data.get('rideordie.profile.v1.host-person'));
    assert.deepEqual(sharedArchive.campaignProgress, host.profile.campaignProgress); assert.equal(sharedArchive.cash, 1634);
  }
});

test('defeat cannot be upgraded to a clear by a changed duplicate; a new life can clear the still-selected chapter', async () => {
  const f = await pair(), { host, guest } = f, cfg = await start(host, guest);
  assert.equal(f.credit(summary(cfg, { won: false, levelCleared: false })), true); await flush();
  assert.equal(f.credit(summary(cfg)), false); assert.deepEqual(host.profile.campaignProgress.cleared, []);
  host.activeRunId = guest.activeRunId = null; host.swap.enterGarage(); guest.swap.enterGarage(); await flush();
  const second = await start(host, guest); assert.notEqual(second.runId, cfg.runId); assert.equal(f.credit(summary(second)), true);
  assert.deepEqual(host.profile.campaignProgress.cleared, [1]); assert.equal(host.profile.cash, 7800); assert.equal(host.peerWallet.cash, 2034);
});

test('locked marathon is refused; all-ten-clear marathon stays independent of finite credit and selection', async () => {
  const f = await pair({ hostCleared: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }), { host, guest } = f;
  assert.deepEqual(f.select(1, 'marathon'), { ok: true }); await flush(); const cfg = await start(host, guest);
  assert.deepEqual(cfg.journey, { version: 1, mode: 'marathon', level: 1 }); const progress = structuredClone(host.profile.campaignProgress);
  assert.equal(f.credit(summary(cfg)), false); assert.equal(host.profile.cash, 7000);
  assert.equal(f.credit(summary(cfg, { won: false, levelCleared: false })), true); await flush();
  assert.deepEqual(host.profile.campaignProgress, progress); assert.equal(host.profile.cash, 7400); assert.equal(host.peerWallet.cash, 1634);
});

test('missing legacy summary remains payable but legacy victory cannot unlock a finite chapter', async () => {
  const f = await pair(), { host, guest } = f; await ready(host, guest); const cfg = host.startRun({ seed: 17 }); assert.ok(cfg); await flush();
  assert.equal(f.credit({ id: cfg.runId, cash: 10, won: true, levelCleared: true }), false);
  assert.equal(f.credit({ id: cfg.runId, cash: 10, won: true }), true); await flush();
  assert.equal(host.profile.cash, 7010); assert.equal(host.peerWallet.cash, 1244); assert.deepEqual(host.profile.campaignProgress.cleared, []);
});

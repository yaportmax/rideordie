import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, upgradeLevel } from '../src/data/upgrades.js';
import { GarageSeatSwap } from '../src/net/garage_seats.js';

const { Session } = await import('../src/net/session.js');

class Memory {
  constructor() { this.rtt = 0; this.sent = []; }
  async host() { return 'ABCDE'; }
  async join() {}
  send(message) {
    this.sent.push(structuredClone(message)); const receiver = this.other;
    if (receiver) queueMicrotask(() => { if (this.other === receiver) receiver.onMessage(structuredClone(message)); });
  }
  sendFast() {}
  destroy() { this.other = null; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function pair({ hostRole = 'driver', enter = true } = {}) {
  const a = new Memory(), b = new Memory(); a.other = b; b.other = a;
  const host = new Session(a), guest = new Session(b);
  const p = DEFAULT_PROFILE(), gp = DEFAULT_PROFILE();
  p.campaignId = 'host-person'; p.cash = 7000; p.truck = 'truck_t3'; p.trucks.push('truck_t3');
  p.vehicleUpgrades.rustbucket = { engine: 4, armor: 3, tires: 2 };
  p.upgrades = { pouches: 2, vest: 3 };
  p.weapons.rifle = { dmg: 2, mag: 1, rel: 3, hnd: 2 }; p.loadout = ['rifle', 'pistol'];
  gp.campaignId = 'guest-person'; gp.cash = 1234;
  await host.host(p); await guest.join('ABCDE', gp); a.onOpen(); b.onOpen(); await flush();
  host.setRole(hostRole); guest.setRole(hostRole === 'driver' ? 'gunner' : 'driver'); await flush(); host.broadcastProfile(); await flush();
  const events = { host: [], guest: [] }, swaps = { host: 0, guest: 0 }; let nonce = 0;
  for (const [s, name] of [[host, 'host'], [guest, 'guest']]) {
    s.swap = new GarageSeatSwap(s, { makeId: () => `${name}-nonce-${++nonce}`, onState: (state, event) => events[name].push({ state, event }), onSwap: () => swaps[name]++ });
    // Messages exercise the production Session routing and protocol gate.
  }
  if (enter) { host.swap.enterGarage(); guest.swap.enterGarage(); await flush(); }
  return { host, guest, events, swaps };
}
const roles = s => [s.me.role, s.other.role];
const context = swap => { const s = swap.snapshot(); return { phase: 'garage', epoch: s.epoch, revision: s.revision }; };
const acceptFrom = s => s.swap.respond(s.swap.snapshot().pending.id, true);
const requestFrom = async s => { assert.equal(s.swap.request().ok, true); await flush(); return s.swap.snapshot().pending; };

test('host or guest can propose, but only the other person explicitly accepts; both seat directions preserve existing kit and personal wallets', async () => {
  for (const hostRole of ['driver', 'gunner']) for (const byHost of [true, false]) {
    const { host, guest, swaps } = await pair({ hostRole });
    const campaign = structuredClone(host.profile), personal = structuredClone(guest.personalProfile), peerWallet = structuredClone(host.peerWallet);
    const before = roles(host), requester = byHost ? host : guest, responder = byHost ? guest : host;
    await requestFrom(requester); assert.deepEqual(roles(host), before); assert.deepEqual(roles(guest), before.toReversed());
    assert.equal(requester.swap.respond(requester.swap.snapshot().pending.id, true).ok, false);
    assert.equal(acceptFrom(responder).ok, true); await flush();
    assert.deepEqual(roles(host), before.toReversed()); assert.deepEqual(roles(guest), before);
    assert.equal(host.swap.snapshot().pending, null); assert.equal(guest.swap.snapshot().pending, null);
    assert.equal(host.me.ready, false); assert.equal(host.other.ready, false); assert.equal(guest.me.ready, false); assert.equal(guest.other.ready, false);
    assert.deepEqual(host.profile, campaign); assert.deepEqual(guest.personalProfile, personal); assert.deepEqual(host.peerWallet, peerWallet);
    assert.equal(host.profile.cash, 7000); assert.equal(guest.profile.cash, 1234); assert.deepEqual(host.profile.loadout, ['rifle', 'pistol']);
    assert.equal(host.profile.vehicleUpgrades.rustbucket.engine, 4);
    for (const [id, level] of [['engine', 4], ['armor', 3], ['tires', 2]]) {
      assert.equal(upgradeLevel(host.profile, id), level); assert.equal(upgradeLevel(guest.profile, id), level);
      assert.equal(host.profile.upgrades[id], undefined); assert.equal(guest.profile.upgrades[id], undefined);
    }
    assert.equal(host.profile.upgrades.pouches, 2); assert.equal(host.profile.weapons.rifle.dmg, 2);
    assert.deepEqual(swaps, { host: 1, guest: 1 });
  }
});

test('declining either person leaves seats and shared gear unchanged and clears the proposal', async () => {
  for (const byHost of [true, false]) {
    const { host, guest, swaps } = await pair(); const before = roles(host);
    const requester = byHost ? host : guest, responder = byHost ? guest : host; const pending = await requestFrom(requester);
    assert.equal(responder.swap.respond(pending.id, false).ok, true); await flush();
    assert.deepEqual(roles(host), before); assert.deepEqual(roles(guest), before.toReversed()); assert.equal(host.swap.snapshot().pending, null);
    assert.deepEqual(swaps, { host: 0, guest: 0 });
  }
});

test('simultaneous requests never count as agreement and the pending proposal still needs its other person', async () => {
  const { host, guest, swaps } = await pair(); const before = roles(host);
  assert.equal(host.swap.request().ok, true); assert.equal(guest.swap.request().ok, true); await flush();
  const pending = host.swap.snapshot().pending; assert.equal(pending.by, 'host'); assert.deepEqual(roles(host), before); assert.deepEqual(swaps, { host: 0, guest: 0 });
  assert.equal(host.swap.request().ok, false); assert.equal(guest.swap.request().ok, false);
  acceptFrom(guest); await flush(); assert.deepEqual(roles(host), before.toReversed()); assert.deepEqual(swaps, { host: 1, guest: 1 });
});

test('wrong nonce, garage visit, revision, phase and requester identity cannot authorize a swap', async () => {
  const { host, guest, swaps } = await pair(); const pending = await requestFrom(guest), before = roles(host);
  const valid = { t: 'seatSwapResponse', ...context(host.swap), id: pending.id, accept: true };
  for (const change of [{ id: 'wrong-id' }, { epoch: valid.epoch - 1 }, { revision: valid.revision - 1 }, { phase: 'run' }, { accept: 'true' }]) host.swap._respond({ ...valid, ...change }, 'host');
  // Incoming peer traffic remains the guest actor even if it forges a host field.
  host.swap.onMessage({ ...valid, actor: 'host', by: 'host' });
  assert.deepEqual(roles(host), before); assert.deepEqual(swaps, { host: 0, guest: 0 }); assert.equal(host.swap.snapshot().pending.id, pending.id);
  acceptFrom(host); await flush(); assert.deepEqual(roles(host), before.toReversed());
});

test('duplicate accepts, cancellations and stale authoritative snapshots cannot swap again or roll roles back', async () => {
  const { host, guest, swaps } = await pair(); await requestFrom(host);
  const before = structuredClone(host.tp.sent.findLast(m => m.t === 'seatSwapState'));
  acceptFrom(guest); const accept = structuredClone(guest.tp.sent.findLast(m => m.t === 'seatSwapResponse')); await flush();
  host.swap.onMessage(accept); host.swap.onMessage(accept); guest.swap.onMessage(before); await flush();
  assert.deepEqual(roles(host), ['gunner', 'driver']); assert.deepEqual(roles(guest), ['driver', 'gunner']); assert.deepEqual(swaps, { host: 1, guest: 1 });
});

test('only the requester can cancel, and accepting a cancelled or declined proposal does nothing', async () => {
  for (const outcome of ['cancel', 'decline']) {
    const { host, guest, swaps } = await pair(); const pending = await requestFrom(host), ctx = context(host.swap);
    assert.equal(guest.swap.cancel(pending.id).ok, false);
    if (outcome === 'cancel') host.swap.cancel(pending.id); else guest.swap.respond(pending.id, false);
    await flush(); host.swap.onMessage({ t: 'seatSwapResponse', ...ctx, id: pending.id, accept: true }); await flush();
    assert.deepEqual(roles(host), ['driver', 'gunner']); assert.deepEqual(swaps, { host: 0, guest: 0 });
  }
});

test('a proposal needs both people in the same garage and never works in lobby, run, results or after disconnect', async () => {
  const { host, guest } = await pair({ enter: false }); assert.equal(host.swap.request().ok, false);
  host.swap.enterGarage(); await flush(); assert.equal(host.swap.request().ok, false);
  guest.swap.enterGarage(); await flush(); assert.equal(host.swap.canRequest(), true);
  for (const phase of ['run', 'results', 'lobby']) {
    host.swap.leaveGarage(phase); await flush(); assert.equal(host.swap.request().ok, false); assert.equal(guest.swap.request().ok, false);
    host.swap.enterGarage(); guest.swap.enterGarage(); await flush();
  }
  const pending = await requestFrom(host), ctx = context(host.swap); host.swap.disconnect(); guest.swap.disconnect();
  host.swap.onMessage({ t: 'seatSwapResponse', ...ctx, id: pending.id, accept: true }); assert.deepEqual(roles(host), ['driver', 'gunner']); assert.equal(host.swap.snapshot().pending, null);
});

test('accepting an old proposal from a prior garage visit cannot affect a newer proposal', async () => {
  const { host, guest, swaps } = await pair(); const first = await requestFrom(host), old = context(host.swap);
  host.swap.leaveGarage('run'); await flush(); host.swap.enterGarage(); guest.swap.enterGarage(); await flush();
  const current = await requestFrom(host); assert.notEqual(current.id, first.id);
  host.swap.onMessage({ t: 'seatSwapResponse', ...old, id: first.id, accept: true });
  assert.equal(host.swap.snapshot().pending.id, current.id); assert.deepEqual(swaps, { host: 0, guest: 0 });
});

test('requesting or completing a swap clears both readiness flags and delayed ready/lobby role messages cannot rearm or change seats', async () => {
  const { host, guest } = await pair();
  host.swap.ready(true); guest.swap.ready(true); await flush(); assert.equal(host.swap.canStart(), true);
  const oldReady = structuredClone(guest.tp.sent.findLast(m => m.t === 'seatSwapReady'));
  await requestFrom(host); assert.equal(host.me.ready, false); assert.equal(host.other.ready, false); assert.equal(host.swap.canStart(), false);
  host.swap.onMessage(oldReady); host.tp.onMessage({ t: 'role', role: 'driver' }); host.tp.onMessage({ t: 'ready', ready: true }); host.tp.onMessage({ t: 'garageReady', ready: true });
  assert.equal(host.other.ready, false); assert.deepEqual(roles(host), ['driver', 'gunner']);
  acceptFrom(guest); await flush(); host.swap.onMessage(oldReady); assert.equal(host.swap.canStart(), false);
  assert.deepEqual(roles(host), ['gunner', 'driver']);
  host.swap.ready(true); guest.swap.ready(true); await flush(); assert.equal(host.swap.canStart(), true);
});

test('a fresh start after consent has swapped seats and unchanged shared truck and gunner upgrades', async () => {
  const { host, guest } = await pair(); await requestFrom(guest); acceptFrom(host); await flush();
  host.swap.ready(true); guest.swap.ready(true); await flush(); let received; guest.on({ start: cfg => received = cfg });
  const cfg = host.startRun({ seed: 17 }); assert.ok(cfg); host.swap.leaveGarage('run'); await flush();
  assert.equal(cfg.role, 'gunner'); assert.equal(received.role, 'driver'); assert.equal(cfg.profile.truck, 'truck_t3');
  assert.equal(cfg.profile.vehicleUpgrades.rustbucket.engine, 4); assert.equal(received.profile.vehicleUpgrades.rustbucket.engine, 4);
  assert.equal(upgradeLevel(cfg.profile, 'engine'), 4); assert.equal(upgradeLevel(received.profile, 'engine'), 4);
  assert.equal(cfg.profile.upgrades.engine, undefined); assert.equal(received.profile.upgrades.engine, undefined);
  assert.equal(received.profile.upgrades.pouches, 2); assert.equal(received.profile.weapons.rifle.rel, 3);
  assert.equal(cfg.profile.cash, 7000); assert.equal(received.profile.cash, 1234); assert.equal(host.swap.request().ok, false);
});

test('queued accepted or proposed state cannot restore roles, ready or pending UI after guest disconnects', async () => {
  for (const outcome of ['accepted', 'proposed']) {
    const { host, guest, swaps } = await pair();
    let snapshot;
    if (outcome === 'accepted') {
      await requestFrom(host);
      const oldReceiver = host.tp.other; host.tp.other = null;
      host.swap._respond({ t: 'seatSwapResponse', ...context(host.swap), id: host.swap.snapshot().pending.id, accept: true }, 'guest');
      snapshot = structuredClone(host.tp.sent.findLast(message => message.t === 'seatSwapState')); host.tp.other = oldReceiver;
    } else {
      const oldReceiver = host.tp.other; host.tp.other = null; host.swap.request();
      snapshot = structuredClone(host.tp.sent.findLast(message => message.t === 'seatSwapState')); host.tp.other = oldReceiver;
    }
    const beforeRoles = roles(guest); guest.swap.disconnect(); const state = guest.swap.snapshot(), beforeSwaps = swaps.guest;
    guest.swap.onMessage(snapshot);
    assert.deepEqual(guest.swap.snapshot(), state); assert.deepEqual(roles(guest), beforeRoles); assert.equal(swaps.guest, beforeSwaps);
    assert.equal(guest.swap.snapshot().pending, null); assert.equal(guest.me.ready, false);
  }
});

test('an old ready true replay cannot override a newer cancel within the same seat revision', async () => {
  const { host, guest } = await pair(); host.swap.ready(true); guest.swap.ready(true); await flush();
  const old = structuredClone(guest.tp.sent.findLast(message => message.t === 'seatSwapReady'));
  guest.swap.ready(false); await flush(); const revision = host.swap.snapshot().revision;
  assert.equal(host.swap.canStart(), false); host.swap.onMessage(old); assert.equal(host.swap.snapshot().revision, revision);
  assert.equal(host.swap.snapshot().ready.guest, false); assert.equal(host.swap.canStart(), false);
});

test('peer leaving before an in-flight proposal arrives cancels the proposal despite its newer seat revision', async () => {
  const { host, guest } = await pair(); const oldReceiver = host.tp.other;
  host.tp.other = null; assert.equal(host.swap.request().ok, true); host.tp.other = oldReceiver;
  assert.ok(host.swap.snapshot().pending); assert.equal(guest.swap.snapshot().pending, null);
  guest.swap.leaveGarage('results'); await flush();
  assert.equal(host.swap.snapshot().presence.guest, false); assert.equal(host.swap.snapshot().pending, null); assert.equal(host.swap.canRequest(), false);
});

test('old absence replay cannot override a later garage presence announcement', async () => {
  const { host, guest } = await pair(); guest.swap.leaveGarage('results'); await flush();
  const absence = structuredClone(guest.tp.sent.findLast(message => message.t === 'seatSwapPresence'));
  guest.swap.enterGarage(); await flush(); assert.equal(host.swap.snapshot().presence.guest, true);
  host.swap.onMessage(absence); assert.equal(host.swap.snapshot().presence.guest, true); assert.equal(host.swap.canRequest(), true);
});

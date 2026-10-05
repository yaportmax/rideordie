import { ELITE_VEHICLE_PROTOCOL } from '../src/data/elite_vehicles.js';
// Authored WORK acceptance against actual rebased consumers. Unrun by this author.
// Controlled CPU terminal outcomes and memory transport are not native/NAT proof.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { CAMPAIGN_PROTOCOL } from '../src/data/campaign.js';
import { PLAYER_VEHICLE_PROTOCOL } from '../src/data/vehicle_families.js';
import { DRIVING_ROUTE_VERSION } from '../src/world/driving_plan.js';
import { GARAGE_SEAT_PROTOCOL } from '../src/net/garage_seats.js';
import { NET_PROTOCOL, RUN_JSON_TYPES } from '../src/net/run_packet.js';
import { normalizeProfile, getSaveStore, loadProfile } from '../src/meta/profile.js';
import { weaponStats } from '../src/data/weapons.js';
import { Sim, DT } from '../src/sim/sim.js';

// The peer-import hook must evaluate before linking the actual transport.
// Match the established session_campaign fixture's dynamic import ordering.
const { Session } = await import('../src/net/session.js');
const { Run } = await import('../src/game/run.js');

const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let App;
try { ({ App } = await import('../src/app.js')); } finally { css.deregister(); }

const flush = () => new Promise(resolve => setImmediate(resolve));
function storage() {
  const data = new Map();
  return { data, getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function inStore(store, fn) {
  const previous = globalThis.localStorage; globalThis.localStorage = store;
  try { return fn(); } finally { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; }
}
function personal(name, cash) {
  const memory = storage();
  return inStore(memory, () => {
    const saves = getSaveStore();
    const selected = saves.create(`${name} road`, normalizeProfile({ ...DEFAULT_PROFILE(), campaignId: `${name}-person`, cash, totalCash: cash + 1000 }));
    const profile = saves.activate(selected.id);
    const reserve = saves.create(`${name} reserve`, normalizeProfile({ ...DEFAULT_PROFILE(), campaignId: `${name}-reserve`, cash: 71 }));
    return { memory, saves, profile, selectedId: selected.id, reserveId: reserve.id, reserve: saves.load(reserve.id) };
  });
}
class MemoryTransport {
  constructor(store) { this.store = store; this.sent = []; this.rtt = 0; this.closedConnections = 0; }
  async host() { return 'ABCDE'; }
  async join() {}
  send(message) {
    const copy = structuredClone(message); this.sent.push(copy); const receiver = this.other;
    if (receiver) queueMicrotask(() => { if (this.other === receiver) inStore(receiver.store, () => receiver.onMessage(structuredClone(copy))); });
    return true;
  }
  sendFast() { return true; }
  closeConnection() { this.closedConnections++; this.onClose(); }
  destroy() { this.other = null; }
}
async function pair(hostRole) {
  const hp = personal('host', 7000), gp = personal('guest', 5000);
  const a = new MemoryTransport(hp.memory), b = new MemoryTransport(gp.memory); a.other = b; b.other = a;
  const host = new Session(a), guest = new Session(b);
  await host.host(hp.profile); await guest.join('ABCDE', gp.profile);
  inStore(hp.memory, () => a.onOpen()); inStore(gp.memory, () => b.onOpen()); await flush();
  host.setRole(hostRole); guest.setRole(hostRole === 'driver' ? 'gunner' : 'driver'); await flush();
  host.broadcastProfile(); await flush();
  return { host, guest, hp, gp, authority: hostRole === 'driver' ? host : guest, viewer: hostRole === 'driver' ? guest : host };
}
async function start(f) {
  f.host.activeRunId = f.guest.activeRunId = null;
  f.host.swap.enterGarage(); f.guest.swap.enterGarage(); await flush();
  f.host.swap.ready(true); f.guest.swap.ready(true); await flush();
  let remote; f.guest.on({ start: cfg => { remote = cfg; } });
  const host = inStore(f.hp.memory, () => f.host.startRun({ seed: 7, journey: { version: CAMPAIGN_PROTOCOL, mode: 'campaign', level: 1 } }));
  assert.ok(host); await flush(); assert.ok(remote);
  return { host, guest: remote };
}
function runFor(session, cfg, sim = null) {
  const seen = { states: [], receipts: [], feeds: [], messages: [] };
  const game = { camera: new THREE.PerspectiveCamera(), input: { bindings: { nuke: ['KeyN'] }, lastDevice: 'kbm', rumble() {} },
    hud: { setCombat: value => seen.states.push(value), gh: { damageReceipt: value => seen.receipts.push(value) },
      feed: value => seen.feeds.push(value), message: value => seen.messages.push(value), hitMarker() {}, damageFlash() {} } };
  const run = new Run(game, { ...cfg, net: session });
  run.sim = sim; run.player = sim?.player; run.effects = { cashMul: 1, weapons: ['pistol'] };
  run.started = true; run.simState = 'run';
  return { run, seen };
}
async function withSim(cfg, fn) {
  const sim = await new Sim({ seed: cfg.seed, journey: cfg.journey }).init();
  try {
    sim.world.gravity = { x: 0, y: 0, z: 0 }; sim.director.enabled = false; sim.director.r = () => .2;
    sim.encounters.plan = []; sim.encounters.sim = sim; sim.hazards.update = () => {};
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 40 });
    sim.world.step(sim.eventQueue); for (const car of sim.cars.values()) car.veh.afterStep();
    sim.start(); sim.configureCombat(cfg.runId, { weapons: ['pistol'], levels: {} }); sim.drainEvents();
    await fn(sim, player);
  } finally { sim.dispose(); }
}
function earn(sim) {
  for (let i = 0; i < 20; i++) {
    sim.combat.advance(.1);
    const target = sim.spawnCar('e_sedan', { s: 500 + i * 40, d: 30 });
    sim.damageCar(target, target.hp + 1, { cause: 'bullet', src: 1 });
  }
  assert.equal(sim.combat.combo, 20); assert.equal(sim.combat.ready, true);
}
const startupApp = () => Object.assign(Object.create(App.prototype), { game: { run: null }, screen: 'run', _pendingRunMsgs: [] });

test('actual Session/App/Run nuke routing uses frozen driver ownership and rejects a previous life before startup in both host seats', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const f = await pair(hostRole); let previousRequest;
    try {
      for (let life = 0; life < 2; life++) {
        const cfgs = await start(f), authorityCfg = cfgs[f.authority.isHost ? 'host' : 'guest'], viewerCfg = cfgs[f.viewer.isHost ? 'host' : 'guest'];
        const app = startupApp(), dispatch = [];
        f.authority.on({ run: message => { dispatch.push(message); app._onRunMsg(message); } });
        const unscoped = { t: 'nuke', seq: 1 };
        inStore(f.authority.tp.store, () => f.authority.tp.onMessage(unscoped));
        if (previousRequest) inStore(f.authority.tp.store, () => f.authority.tp.onMessage(previousRequest));
        assert.equal(dispatch.length, 0); assert.equal(app._pendingRunMsgs.length, 0);
        await withSim(authorityCfg, async sim => {
          assert.equal(sim.combat.ready, false, 'entitlement starts empty on each actual new life');
          const authority = runFor(f.authority, authorityCfg, sim), viewer = runFor(f.viewer, viewerCfg);
          app.game.run = authority.run; f.viewer.on({ run: message => viewer.run.onNet(message) });
          earn(sim); authority.run._simEventsToRun(sim.drainEvents());
          f.authority.sendJSON({ t: 'events', e: [{ t: 'combatState', state: sim.combat.state() }] }); await flush();
          assert.equal(viewer.run.combatHud.ready, true);
          const target = sim.spawnCar('e_sedan', { s: 100 });
          assert.equal(viewer.run._requestNuke(), true); await flush();
          const request = structuredClone(f.viewer.tp.sent.findLast(message => message.t === 'nuke'));
          assert.equal(request.runId, authorityCfg.runId); assert.equal(target.exploded, true);
          assert.equal(sim.combat.ready, false); assert.equal(sim.events.filter(event => event.t === 'combatNuke').length, 1);
          inStore(f.authority.tp.store, () => f.authority.tp.onMessage(request));
          assert.equal(sim.events.filter(event => event.t === 'combatNuke').length, 1, 'same actual current-life command cannot spend twice');
          assert.ok(dispatch.some(message => message.t === 'nuke'));
          previousRequest = request;
          viewer.run.dispose();
        });
        app.game.run = null;
      }
    } finally { f.host.leave(); f.guest.leave(); await flush(); }
  }
});

test('current attachment protocol9 still rejects prior protocol7 in both local host modes without changing life framing', async () => {
  assert.equal(NET_PROTOCOL, 9); assert.equal(RUN_JSON_TYPES.has('nuke'), true);
  for (const isHost of [true, false]) {
    const p = personal(isHost ? 'host-old-peer' : 'guest-old-peer', 900), tp = new MemoryTransport(p.memory), session = new Session(tp);
    if (isHost) await session.host(p.profile); else await session.join('ABCDE', p.profile);
    const errors = []; session.on({ error: error => errors.push(error) }); inStore(p.memory, () => tp.onOpen());
    inStore(p.memory, () => tp.onMessage({ t: 'hello', protocol: 7, garageSeats: GARAGE_SEAT_PROTOCOL, familyVehicles: PLAYER_VEHICLE_PROTOCOL, eliteVehicles: ELITE_VEHICLE_PROTOCOL,
      drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL, name: 'Published old peer', wallet: { playerId: 'old-peer', cash: 500, totalCash: 500 } }));
    assert.equal(session.connected, false); assert.equal(session.activeRunId, null); assert.equal(session.peerWallet, null);
    assert.equal(session.canStart(), false); assert.equal(session.startRun(), null); assert.equal(tp.closedConnections, 1);
    assert.equal(errors.length, 1); assert.equal(errors[0].type, 'protocol-mismatch'); assert.match(errors[0].message, /Both players should reload/);
    assert.equal(session.personalProfile.cash, 900); session.leave();
  }
});

test('actual ordinary/nuke terminal cash settles both named personal wallets once without persisting entitlement or replacing another slot', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const f = await pair(hostRole);
    try {
      const cfgs = await start(f), authorityCfg = cfgs[f.authority.isHost ? 'host' : 'guest'], viewerCfg = cfgs[f.viewer.isHost ? 'host' : 'guest'];
      const initialGear = structuredClone({ trucks: f.host.profile.trucks, vehicleUpgrades: f.host.profile.vehicleUpgrades, weapons: f.host.profile.weapons, loadout: f.host.profile.loadout });
      await withSim(authorityCfg, async (sim, player) => {
        const authority = runFor(f.authority, authorityCfg, sim), viewer = runFor(f.viewer, viewerCfg);
        f.authority.on({ run: message => authority.run.onNet(message) }); f.viewer.on({ run: message => viewer.run.onNet(message) });
        const target = sim.spawnCar('e_sedan', { s: 100 }), zone = target.zones.find(value => value.kind === 'fuel');
        const local = new THREE.Vector3().fromArray(zone.c), w = weaponStats('pistol');
        assert.equal(sim.applyHit({ carId: target.id, weapon: 'pistol', shotId: 1, pelletIndex: 0, penetrationIndex: 0, dmg: w.dmg, tireMul: w.tireMul || 1,
          point: local.clone().applyQuaternion(target.veh.quat).add(target.veh.pos).toArray(), localPoint: local.toArray(), poseRevision: target.veh.poseRevision || 0,
          dir: [0, 0, 1], zone: zone.kind, zoneIndex: zone.index ?? -1, through: false }), true);
        earn(sim); const earned = sim.drainEvents(); authority.run._simEventsToRun(earned);
        f.authority.sendJSON({ t: 'events', e: earned }); await flush();
        assert.equal(viewer.seen.receipts.length, 1); assert.equal(viewer.seen.receipts[0].zone, 'fuel'); assert.ok(viewer.seen.receipts[0].damage > 0);
        const ordinaryCash = authority.run.cash; assert.ok(ordinaryCash > 0);
        assert.equal(viewer.run._requestNuke(), true); await flush();
        const cleared = sim.drainEvents(); assert.ok(cleared.some(event => event.t === 'kill' && event.id === target.id && event.nukeDerived));
        authority.run._simEventsToRun(cleared); assert.ok(authority.run.cash > ordinaryCash);
        sim.damageCar(player, player.hp + 1, { cause: 'bullet', src: 2 }); sim._runState(DT);
        assert.equal(sim.result.why, 'car');
        const summary = authority.run.buildSummary(false); assert.equal(summary.bestStreak, 20);
        assert.equal(summary.breakdown.find(line => line.label === 'RAIDERS WRECKED').amount, authority.run.cash);
        f.authority.sendJSON({ t: 'summary', s: summary }); await flush(); assert.deepEqual(viewer.run.remoteSummary, summary);
        assert.equal(inStore(f.hp.memory, () => f.host.creditResult(summary)), true); await flush();
        const balances = [f.host.profile.cash, f.guest.personalProfile.cash];
        assert.deepEqual(balances, [7000 + summary.cash, 5000 + summary.cash]);
        f.authority.sendJSON({ t: 'summary', s: { ...summary, cash: 999999 } }); await flush();
        assert.equal(inStore(f.hp.memory, () => f.host.creditResult({ ...summary, cash: 999999 })), false);
        f.host.broadcastProfile(); await flush();
        assert.deepEqual([f.host.profile.cash, f.guest.personalProfile.cash], balances); assert.deepEqual(viewer.run.remoteSummary, summary);
        assert.deepEqual({ trucks: f.host.profile.trucks, vehicleUpgrades: f.host.profile.vehicleUpgrades, weapons: f.host.profile.weapons, loadout: f.host.profile.loadout }, initialGear);
        for (const [saved, expectedCash, identity] of [[f.hp, balances[0], 'host-person'], [f.gp, balances[1], 'guest-person']]) inStore(saved.memory, () => {
          assert.equal(saved.saves.activeId(), saved.selectedId); const selected = loadProfile();
          assert.equal(selected.cash, expectedCash); assert.equal(selected.campaignId, identity);
          assert.deepEqual(saved.saves.load(saved.reserveId), saved.reserve);
          for (const field of ['combat', 'combatHud', 'nuke', 'nukeReady', 'nukeCharge', 'combo', 'combatRevision']) assert.equal(Object.hasOwn(selected, field), false, field);
        });
        assert.equal(inStore(f.gp.memory, () => loadProfile()).runs, 0, 'guest reward cannot adopt the room owner progression');
        assert.equal(inStore(f.hp.memory, () => loadProfile()).runs, 1);
        viewer.run.dispose();
      });
    } finally { f.host.leave(); f.guest.leave(); await flush(); }
  }
});

// AUTHORED UNRUN. Actual Session shop/profile/hello logic with queued transport
// delivery and isolated browser storage. This does not prove native/WebRTC/WAN.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, UPGRADE_BY_ID } from '../src/data/upgrades.js';
import { normalizeProfile, loadProfile } from '../src/meta/profile.js';
import { NET_PROTOCOL } from '../src/net/run_packet.js';
import { GARAGE_SEAT_PROTOCOL } from '../src/net/garage_seats.js';
import { PLAYER_VEHICLE_PROTOCOL } from '../src/data/vehicle_families.js';
import { ELITE_VEHICLE_PROTOCOL } from '../src/data/elite_vehicles.js';
import { DRIVING_ROUTE_VERSION } from '../src/world/driving_plan.js';
import { CAMPAIGN_PROTOCOL } from '../src/data/campaign.js';
const { Session } = await import('../src/net/session.js');
const TANK = 'player_tank_t1';
const storage = () => { const data = new Map(); return { data, getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }; };
function inStore(store, fn) { const previous = globalThis.localStorage; globalThis.localStorage = store; try { return fn(); } finally { globalThis.localStorage = previous; } }
class Memory {
  constructor(store = storage()) { this.store = store; this.sent = []; this.rtt = 0; this.closedConnections = 0; }
  async host() { return 'ABCDE'; } async join() {}
  send(message) { this.sent.push(structuredClone(message)); const receiver = this.other;
    if (receiver) queueMicrotask(() => { if (this.other === receiver) inStore(receiver.store, () => receiver.onMessage(structuredClone(message))); }); return true; }
  sendFast() { return true; } destroy() { this.other = null; } closeConnection() { this.closedConnections++; this.onClose(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function pair(hostRole, hostCash = 300000, guestCash = 300000) {
  const hs = storage(), gs = storage(), hp = normalizeProfile({ ...DEFAULT_PROFILE(), campaignId: 'tank-host', cash: hostCash, totalCash: hostCash }),
    gp = normalizeProfile({ ...DEFAULT_PROFILE(), campaignId: 'tank-guest', cash: guestCash, totalCash: guestCash, upgrades: { medkit: 1 }, vehicleUpgrades: { sedan: { engine: 2 } } });
  const a = new Memory(hs), b = new Memory(gs); a.other = b; b.other = a;
  const host = new Session(a), guest = new Session(b); await host.host(hp); await guest.join('ABCDE', gp);
  inStore(hs, () => a.onOpen()); inStore(gs, () => b.onOpen()); await flush();
  host.setRole(hostRole); guest.setRole(hostRole === 'driver' ? 'gunner' : 'driver'); await flush(); host.broadcastProfile(); await flush();
  return { host, guest, hs, gs };
}
test('both host seats preserve requester-only tank/upgrade funding, guest personal gear and exact family save round-trip', async () => {
  for (const role of ['driver', 'gunner']) {
    const { host, guest, hs, gs } = await pair(role), personal = structuredClone(guest.personalProfile), hostTotal = host.profile.totalCash;
    assert.equal(PLAYER_VEHICLE_PROTOCOL, 3); assert.equal(ELITE_VEHICLE_PROTOCOL, 1);
    for (const side of [host, guest]) assert.ok(side.tp.sent.some(message => message.t === 'hello'
      && message.familyVehicles === 3 && message.eliteVehicles === ELITE_VEHICLE_PROTOCOL));
    inStore(gs, () => guest.buy('truck', TANK)); await flush();
    assert.equal(host.profile.truck, TANK); assert.equal(host.profile.v, 3); assert.equal(guest.profile.truck, TANK);
    assert.equal(host.profile.cash, 300000); assert.equal(host.peerWallet.cash, 50000); assert.equal(guest.personalProfile.cash, 50000);
    assert.equal(host.profile.totalCash, hostTotal); assert.deepEqual(guest.personalProfile.trucks, personal.trucks);
    assert.deepEqual(guest.personalProfile.vehicleUpgrades, personal.vehicleUpgrades); assert.deepEqual(guest.personalProfile.upgrades, personal.upgrades);
    const hostCash = host.profile.cash;
    inStore(gs, () => guest.buy('upgrade', 'armor')); await flush();
    assert.equal(host.profile.cash, hostCash); assert.equal(host.peerWallet.cash, 50000 - UPGRADE_BY_ID.armor.costs[0]);
    assert.equal(host.profile.vehicleUpgrades.tank.armor, 1); assert.equal(guest.profile.vehicleUpgrades.tank.armor, 1);
    inStore(hs, () => host.buy('upgrade', 'engine')); await flush();
    assert.equal(host.profile.cash, hostCash - UPGRADE_BY_ID.engine.costs[0]); assert.equal(host.profile.vehicleUpgrades.tank.engine, 1);
    const savedHost = inStore(hs, () => loadProfile()), savedGuest = inStore(gs, () => loadProfile());
    assert.equal(savedHost.v, 3); assert.equal(savedHost.truck, TANK); assert.equal(savedHost.vehicleUpgrades.tank.armor, 1); assert.equal(savedHost.vehicleUpgrades.tank.engine, 1);
    assert.equal(savedGuest.truck, personal.truck); assert.deepEqual(savedGuest.vehicleUpgrades, personal.vehicleUpgrades);
    const before = structuredClone({ profile: guest.profile, personal: guest.personalProfile, wallet: guest.wallet }), disk = [...gs.data];
    const future = { ...structuredClone(host.profile), v: 4 };
    assert.equal(guest._receiveProfile(future, { playerId: guest.personalProfile.campaignId, cash: 999999, totalCash: 999999 }), false);
    assert.deepEqual({ profile: guest.profile, personal: guest.personalProfile, wallet: guest.wallet }, before); assert.deepEqual([...gs.data], disk);
    host.leave(); guest.leave();
  }
});
test('familyVehicles2 peers cannot enter the new catalogue before any wallet or profile mutation', async () => {
  const transport = new Memory(), session = new Session(transport), profile = normalizeProfile(DEFAULT_PROFILE());
  await session.host(profile); transport.onOpen(); const before = structuredClone(profile);
  session._onMsg({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL, familyVehicles: 2, eliteVehicles: ELITE_VEHICLE_PROTOCOL,
    drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL, name: 'Old peer', wallet: { playerId: 'old-peer', cash: 999999, totalCash: 999999 } });
  assert.equal(session.connected, false); assert.equal(session.peerWallet, null); assert.equal(transport.closedConnections, 1); assert.deepEqual(profile, before);
});

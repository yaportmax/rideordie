import { Sim, DT } from '../../src/sim/sim.js';
import { SyncGround } from '../../src/sim/sync_ground.js';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../../src/net/snapshot.js';
const sim = new Sim({ seed: 11 }); await sim.init(); const g = new SyncGround(sim); sim.setGround(g); g.update(100);
const P = sim.spawnCar('truck_t1', { s: 100, kind: 'player' }); sim.start();
for (let i = 0; i < 120 * 12; i++) { P.veh.setInput({ throttle: 1, steer: 0 }); sim.step(DT); }
const hud = { hp01: 0.9, dhp01: 1, ghp01: 0.5, nitro01: 0.3, cash: 1234, kills: 7, streak: 3, level: 0.2, dist: P.s, medkits: 1 };
const buf = encodeSnapshot(sim, sim.tick, hud);
const s = decodeSnapshot(buf);
console.log('bytes', buf.byteLength, 'cars', s.cars.length);
const c = s.cars.find((c) => c.id === 1);
console.log('pos err', Math.hypot(c.x - P.veh.pos.x, c.y - P.veh.pos.y, c.z - P.veh.pos.z).toFixed(4), 'vel err', Math.hypot(c.vx - P.veh.vel.x, c.vy - P.veh.vel.y, c.vz - P.veh.vel.z).toFixed(3), 'hud', s.cash, s.kills, s.state, s.ghp01.toFixed(2));
const sb = new SnapshotBuffer();
sb.push(s, 10.0);
const P2 = { ...s, time: s.time + 0.033, cars: s.cars.map((q) => ({ ...q, z: q.z + 1, L: q.L, slip: q.slip, gr: q.gr })) };
sb.push(P2, 10.033);
const r = sb.sample(10.033 + 0.05);
console.log('sampled', r && r.t.toFixed(2), sb.states.get(1).pos.z.toFixed(2), 'expected between', c.z.toFixed(2), (c.z + 1).toFixed(2));

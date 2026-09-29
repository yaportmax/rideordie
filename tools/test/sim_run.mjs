// Headless gameplay soak test: bot drives the player truck, bot gunner shoots. node tools/test/sim_run.mjs [seconds] [truck] [startS]
import { Sim, DT } from '../../src/sim/sim.js';
import { SyncGround } from '../../src/sim/sync_ground.js';
import { clamp, wrapAngle } from '../../src/core/util.js';
import { VEHICLES } from '../../src/data/vehicles.js';

const secs = +(process.argv[2] || 90), truck = process.argv[3] || 'truck_t1', startS = +(process.argv[4] || 100);
const sim = new Sim({ seed: 11 }); await sim.init();
const ground = new SyncGround(sim); sim.setGround(ground);
ground.update(startS);
const P = sim.spawnCar(truck, { s: startS, kind: 'player', speed: 0 });
sim.start();
let t0 = performance.now();
const dps = +(process.env.DPS || 60);
let nextLog = 0, nan = false;
const cars = sim.cars;
function bot(dt) {
  const v = P.veh, road = sim.road;
  const look = 22 + v.speed * 0.4;
  const tp = road.pointAt(P.s + look, 0, {});
  const err = wrapAngle(Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z));
  const target = 30; // m/s
  v.setInput({ throttle: v.vf < target ? 1 : 0.2, brake: v.vf > target + 6 ? 0.3 : 0, steer: clamp(err * 2.5, -1, 1) });
}
let gunT = 0;
function gunnerBot(dt) {
  gunT -= dt; if (gunT > 0) return; gunT = 0.2;
  let best = null, bd = 90;
  for (const c of cars.values()) { if (c.kind !== 'enemy' || c.exploded) continue; const d = c.veh.pos.distanceTo(P.veh.pos); if (d < bd) { bd = d; best = c; } }
  if (!best) return;
  const zones = ['driver', 'gunner', 'body', 'body', 'tire', 'engine'];
  const z = zones[(Math.random() * zones.length) | 0];
  const zone = best.zones.find((q) => q.kind === z) || best.zones[0];
  sim.applyHit({ carId: best.id, zone: zone.kind, zoneIndex: zone.index ?? -1, dmg: dps * 0.2 * (0.6 + 0.8 * Math.random()), through: false, point: [best.veh.pos.x, best.veh.pos.y + 1, best.veh.pos.z], dir: [0, 0, 1], weapon: 'bot' });
}
const N = Math.round(secs / DT);
const counts = { explode: 0, kill: 0, crash: 0, shot: 0, hit: 0, crewDead: 0, minibossSpawn: 0, minibossDown: 0, mineDrop: 0, summon: 0 };
for (let i = 0; i < N; i++) {
  bot(DT); gunnerBot(DT);
  sim.step(DT);
  for (const e of sim.drainEvents()) if (counts[e.t] !== undefined) counts[e.t]++;
  if (!Number.isFinite(P.veh.pos.x + P.veh.pos.y + P.veh.pos.z)) { nan = true; break; }
  if (sim.time >= nextLog) {
    nextLog += 10;
    const en = [...cars.values()].filter((c) => c.kind === 'enemy' && !c.exploded).length;
    console.log(`t=${sim.time.toFixed(0).padStart(3)}s s=${P.s.toFixed(0).padStart(5)}m v=${(P.veh.speed * 3.6).toFixed(0)}km/h L=${sim.director.level.toFixed(2)} enemies=${en} spawned=${sim.director.spawned} kills=${sim.stats.kills} carHp=${P.hp.toFixed(0)}/${P.maxHp} drv=${P.crew.driver.hp.toFixed(0)} gun=${P.crew.gunner?.hp.toFixed(0)} state=${sim.state}`);
  }
  if (sim.state === 'over') { console.log('RUN OVER at', sim.time.toFixed(1), 's why=', sim.result.why); break; }
}
console.log('done', { wall: ((performance.now() - t0) / 1000).toFixed(1) + 's', simT: sim.time.toFixed(1), nan, counts, kills: sim.stats.kills, dist: sim.stats.distance.toFixed(0) });

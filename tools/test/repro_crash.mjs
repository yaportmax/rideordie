// Reproduce a campaign-sim run and print the big world impacts. node tools/test/repro_crash.mjs [seed=2013] [secs=40]
import { Sim, DT } from '../../src/sim/sim.js';
import { SyncGround } from '../../src/sim/sync_ground.js';
import { buildPlayerSpec } from '../../src/game/run_setup.js';
import { DEFAULT_PROFILE } from '../../src/data/upgrades.js';
import { clamp, wrapAngle } from '../../src/core/util.js';
const seed = +(process.argv[2] || 2013), secs = +(process.argv[3] || 40);
const prof = DEFAULT_PROFILE(); prof.truck = 'truck_t3'; prof.trucks.push('truck_t3');
prof.upgrades = { armor: 3, engine: 3, tires: 1, vest: 2, nitro: 1, medkit: 1, glass: 1 };
const { spec } = buildPlayerSpec(prof);
const sim = new Sim({ seed }); await sim.init();
const g = new SyncGround(sim); sim.setGround(g); g.update(40);
const P = sim.spawnCar(spec.id, { spec, s: 40, kind: 'player' }); sim.start();
globalThis.__crashLog = [];
const wantSpeed = spec.engine.vmax * 0.8;
let gunT = 0;
const trace = [];
for (let i = 0; i < secs / DT; i++) {
  const v = P.veh, road = sim.road;
  let lat = 0; const rb = road.featuresIn(P.s, P.s + 160, 'roadblock')[0]; if (rb) lat = rb.gap * 2.6;
  const kA = Math.max(Math.abs(road.sample(P.s + 40).k), Math.abs(road.sample(P.s + 90).k));
  const tp = road.pointAt(P.s + 18 + v.speed * 0.45, lat, {});
  const err = wrapAngle(Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z));
  const want = Math.min(wantSpeed, Math.sqrt(16 / Math.max(kA, 1e-4)));
  v.setInput({ throttle: v.vf < want ? 1 : 0, brake: v.vf > want + 4 ? 0.5 : 0, steer: clamp(err * 2.5, -1, 1), nitro: v.nitro > 1 && v.vf < want - 5 });
  gunT -= DT;
  if (gunT <= 0) { gunT = 0.2; let tgt = null, bd = 120; for (const c of sim.cars.values()) { if (c.kind !== 'enemy' || c.exploded) continue; const d = c.veh.pos.distanceTo(v.pos); if (d < bd) { bd = d; tgt = c; } } if (tgt) { const z = tgt.zones.find((q) => q.kind === 'body'); sim.applyHit({ carId: tgt.id, zone: z.kind, zoneIndex: -1, dmg: 15, through: false, point: [tgt.veh.pos.x, tgt.veh.pos.y, tgt.veh.pos.z], dir: [0, 0, 1] }); } }
  const n0 = globalThis.__crashLog.length;
  sim.step(DT);
  if (i % 6 === 0) trace.push(`t${sim.time.toFixed(2)} s${P.s.toFixed(0)} d${P.d.toFixed(1)} v${(v.speed * 3.6).toFixed(0)} y${v.pos.y.toFixed(2)} up${v.up.y.toFixed(2)} L[${v.wheels.map((w) => w.L.toFixed(2) + (w.grounded ? '' : '!')).join(' ')}] boost${v.boosting ? 1 : 0}`);
  for (let k = n0; k < globalThis.__crashLog.length; k++) { const x = globalThis.__crashLog[k]; if (x.force > 1e6) { console.log('BIG', JSON.stringify(x)); console.log(trace.slice(-6).join('\n')); } }
  if (sim.state !== 'run') break;
}
console.log('end', P.hp.toFixed(0), sim.stats.damageBy);

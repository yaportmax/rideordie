import { Sim, DT } from '../../src/sim/sim.js';
import { SyncGround } from '../../src/sim/sync_ground.js';
import { clamp, wrapAngle } from '../../src/core/util.js';
const seed = 11; const sim = new Sim({ seed, director: { rate: 0 } }); await sim.init();
sim.director.enabled = false;
const g = new SyncGround(sim); sim.setGround(g);
sim.road.extendTo(20000);
const type = process.argv[2] || 'ramp';
const f = sim.road.features.filter((x) => x.type === type)[+(process.argv[3] || 0)];
console.log('feature', JSON.stringify(f));
const startS = Math.max(50, f.s0 - 350);
g.update(startS);
const P = sim.spawnCar('truck_t1', { s: startS, kind: 'player', speed: 30 }); sim.start();
let maxAir = 0, maxY = -1e9, landed = false, crashEv = 0, hpMin = 1e9, lat = +(process.argv[4] || 0);
for (let i = 0; i < 120 * 25; i++) {
  const v = P.veh, road = sim.road, look = 20 + v.speed * 0.4;
  const tp = road.pointAt(P.s + look, lat, {});
  const err = wrapAngle(Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z));
  v.setInput({ throttle: v.vf < 32 ? 1 : 0.1, steer: clamp(err * 2.5, -1, 1) });
  sim.step(DT);
  for (const e of sim.drainEvents()) { if (e.t === 'crash') crashEv++; if (e.t === 'boostPad') console.log('boost pad at s', P.s.toFixed(0)); }
  if (P.s > f.s0 - 20) { maxAir = Math.max(maxAir, v.airTime); maxY = Math.max(maxY, v.pos.y); hpMin = Math.min(hpMin, P.hp); }
  if (P.s > f.s1 + 120) break;
}
console.log(`${type}: s=${P.s.toFixed(0)} speed=${(P.veh.speed * 3.6).toFixed(0)}km/h maxAir=${maxAir.toFixed(2)}s hp=${P.hp.toFixed(0)}/${P.maxHp} crashes=${crashEv} upY=${P.veh.up.y.toFixed(2)}`);

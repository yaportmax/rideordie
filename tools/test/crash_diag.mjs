// What does the bot crash into? node tools/test/crash_diag.mjs [truck] [secs] [startS]
import { Sim, DT } from '../../src/sim/sim.js';
import { SyncGround } from '../../src/sim/sync_ground.js';
import { buildPlayerSpec } from '../../src/game/run_setup.js';
import { DEFAULT_PROFILE } from '../../src/data/upgrades.js';
import { clamp, wrapAngle } from '../../src/core/util.js';
const truck = process.argv[2] || 'truck_t3', secs = +(process.argv[3] || 180), s0 = +(process.argv[4] || 2000);
const prof = DEFAULT_PROFILE(); prof.truck = truck; prof.trucks.push(truck); prof.upgrades = JSON.parse(process.env.UPG || '{"armor":2,"engine":2}');
const { spec } = buildPlayerSpec(prof);
const sim = new Sim({ seed: 5 }); await sim.init(); sim.director.enabled = process.env.ENEMIES === '1';
const g = new SyncGround(sim); sim.setGround(g); g.update(s0);
const P = sim.spawnCar(spec.id, { spec, s: s0, kind: 'player', speed: 20 }); sim.start();
const want = spec.engine.vmax * 0.8;
const rows = [];
for (let i = 0; i < secs / DT; i++) {
  const v = P.veh, road = sim.road;
  let lat = 0; const rb = road.featuresIn(P.s, P.s + 160, 'roadblock')[0]; if (rb) lat = rb.gap * 2.6;
  const kA = Math.max(Math.abs(road.sample(P.s + 40).k), Math.abs(road.sample(P.s + 90).k));
  const tp = road.pointAt(P.s + 18 + v.speed * 0.45, lat, {});
  const err = wrapAngle(Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z));
  const w = Math.min(want, Math.sqrt(16 / Math.max(kA, 1e-4)));
  v.setInput({ throttle: v.vf < w ? 1 : 0, brake: v.vf > w + 4 ? 0.5 : 0, steer: clamp(err * 2.5, -1, 1), nitro: process.env.NITRO === '1' && v.nitro > 1 && v.vf < w - 5 });
  if (process.env.GUNBOT === '1' && i % 24 === 0) {
    let tgt = null, bd = 120;
    for (const c of sim.cars.values()) { if (c.kind !== 'enemy' || c.exploded) continue; const d = c.veh.pos.distanceTo(v.pos); if (d < bd) { bd = d; tgt = c; } }
    if (tgt) { const zs = ['driver', 'gunner', 'body', 'engine', 'tire']; const z = tgt.zones.find((q) => q.kind === zs[(Math.random() * zs.length) | 0]) || tgt.zones.find((q) => q.kind === 'body'); sim.applyHit({ carId: tgt.id, zone: z.kind, zoneIndex: z.index ?? -1, dmg: 20, through: false, point: [tgt.veh.pos.x, tgt.veh.pos.y, tgt.veh.pos.z], dir: [0, 0, 1] }); }
  }
  const hp0 = P.hp;
  sim.step(DT);
  for (const e of sim.drainEvents()) if (e.t === 'crash' && e.id === 1) {
    const f = road.features.filter((x) => P.s > x.s0 - 30 && P.s < x.s1 + 30).map((x) => x.type).join(',');
    rows.push(`t=${sim.time.toFixed(1)} s=${P.s.toFixed(0)} d=${P.d.toFixed(1)} v=${(v.speed * 3.6).toFixed(0)} dv=${e.dv.toFixed(1)} hpLoss=${(hp0 - P.hp).toFixed(0)} air=${v.airTime.toFixed(2)} feat=[${f}] other=${e.other}`);
  }
  if (sim.state !== 'run') break;
}
console.log(rows.slice(0, 40).join('\n'));
console.log('total crashes', rows.length, 'hp', P.hp.toFixed(0), '/', P.maxHp, 'dist', (P.s - s0).toFixed(0), 'dmgBy', sim.stats.damageBy);

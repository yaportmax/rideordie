// Headless Leviathan fight: node tools/test/boss_test.mjs [dps=350] [seconds=400] [truck=truck_t4] [upgradeLevel=5]
import { Sim, DT } from '../../src/sim/sim.js';
import { SyncGround } from '../../src/sim/sync_ground.js';
import { buildPlayerSpec } from '../../src/game/run_setup.js';
import { DEFAULT_PROFILE, UPGRADES } from '../../src/data/upgrades.js';
import { BOSS_S } from '../../src/data/biomes.js';
import { PART_NAMES, BOSS_PARTS } from '../../src/data/boss.js';
import { clamp, wrapAngle } from '../../src/core/util.js';

const dps = +(process.argv[2] || 350), secs = +(process.argv[3] || 400), truck = process.argv[4] || 'truck_t4', ul = +(process.argv[5] ?? 5);
const prof = DEFAULT_PROFILE(); prof.truck = truck; prof.trucks.push(truck);
for (const u of UPGRADES) prof.upgrades[u.id] = Math.min(ul, u.costs.length);
const { spec } = buildPlayerSpec(prof);
const sim = new Sim({ seed: 11 }); await sim.init();
const g = new SyncGround(sim); sim.setGround(g);
const s0 = BOSS_S - 900;
sim.road.extendTo(s0 + 3000); g.update(s0);
const P = sim.spawnCar(spec.id, { spec, s: s0, kind: 'player', speed: 35 }); sim.start();
sim.director.level = 1;
const order = ['part_turret_1', 'part_turret_2', 'part_pod_L', 'part_pod_R', 'part_turret_main', 'part_tank_L', 'part_tank_R', 'panel_armor_rear_1', 'panel_armor_rear_2', 'panel_armor_rear_3', 'part_engine'];
let fightT = 0, log = 0, events = {}, minGap = 1e9, maxGap = -1e9;
for (let i = 0; i < secs / DT; i++) {
  const v = P.veh, B = sim.boss;
  // bot driver: follow ~25 m behind the boss, offset to one lane
  const lat = B ? (Math.sin(sim.time * 0.15) > 0 ? 4.5 : -4.5) : 0;
  const tp = sim.road.pointAt(P.s + 20 + v.speed * 0.4, lat, {});
  const err = wrapAngle(Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z));
  const gap = B ? B.s - P.s : 999;
  const want = B ? B.v + clamp((gap - 30) * 0.4, -10, 10) : 45;
  v.setInput({ throttle: v.vf < want ? 1 : 0, brake: v.vf > want + 4 ? 0.5 : 0, steer: clamp(err * 2.5, -1, 1) });
  // bot gunner: dps against the first alive part in order, if within 150 m
  if (B && !B.dead && i % 12 === 0 && gap < 150) {
    const target = order.find((n) => B.alive[n]);
    if (target) sim.applyHit({ carId: B.id, zone: target, zoneIndex: -1, dmg: dps * 0.1, through: false, point: [B.pos.x, B.pos.y + 3, B.pos.z], dir: [0, 0, 1], weapon: 'bot' });
  }
  sim.step(DT);
  for (const e of sim.drainEvents()) { events[e.t] = (events[e.t] || 0) + 1; if (/boss|runOver|playerDown|miniboss/.test(e.t)) console.log(`  t=${sim.time.toFixed(1)} ${e.t} ${e.part || e.phase || e.why || ''}`); }
  if (B) { fightT += DT; minGap = Math.min(minGap, gap); maxGap = Math.max(maxGap, gap); }
  if (sim.time > log) {
    log += 20;
    const core = B ? B.coreHp01().toFixed(2) : '-';
    console.log(`t=${sim.time.toFixed(0)} s=${P.s.toFixed(0)} v=${(v.speed * 3.6).toFixed(0)} hp=${P.hp.toFixed(0)}/${P.maxHp} drv=${P.crew.driver.hp.toFixed(0)} gun=${P.crew.gunner.hp.toFixed(0)} boss=${B ? `core ${core} phase ${B.phase} v ${(B.v * 3.6).toFixed(0)} gap ${gap.toFixed(0)}` : 'none'} enemies=${[...sim.cars.values()].filter((c) => c.kind === 'enemy' && !c.exploded).length}`);
  }
  if (sim.state === 'over') break;
}
console.log('RESULT', { state: sim.state, why: sim.result?.why, fightSecs: fightT.toFixed(0), minGap: minGap.toFixed(0), maxGap: maxGap.toFixed(0), playerHp: P.hp.toFixed(0), shots: events.shot, rockets: events.bossVolley, cannon: events.bossCannon, ramps: events.bossRamp });

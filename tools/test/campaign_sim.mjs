// Rough campaign balance: bot crew plays runs back-to-back, buys upgrades between runs, until the boss dies or the time cap.
//   node tools/test/campaign_sim.mjs [accuracy=0.35] [capHours=4] [seed=1]
import { Sim, DT } from '../../src/sim/sim.js';
import { SyncGround } from '../../src/sim/sync_ground.js';
import { buildPlayerSpec } from '../../src/game/run_setup.js';
import { DEFAULT_PROFILE, UPGRADES, TRUCKS, effects } from '../../src/data/upgrades.js';
import { WEAPONS, weaponStats } from '../../src/data/weapons.js';
import { buyTruck, buyUpgrade, buyWeapon, buyWeaponTrack, upgradeCost, creditRun } from '../../src/meta/profile.js';
import { weaponTrackCost } from '../../src/data/upgrades.js';
import { ECONOMY, KILL_CASH } from '../../src/data/economy.js';
import { BOSS_S } from '../../src/data/biomes.js';
import { clamp, wrapAngle } from '../../src/core/util.js';

const ACC = +(process.argv[2] || 0.35), CAP = +(process.argv[3] || 4) * 3600, SEED = +(process.argv[4] || 1);
const prof = DEFAULT_PROFILE();
let total = 0, runNo = 0;

function bestWeapon(p) {
  let best = null, bd = 0;
  for (const id of Object.keys(p.weapons)) {
    const w = weaponStats(id, p.weapons[id]);
    const cyc = w.mag / w.rate + (w.reloadPerShell ? w.mag * w.reload : w.reload);
    const dps = (w.dmg * w.pellets * w.mag) / cyc * (w.rocket ? 2.2 : 1) * (id === 'shotgun' ? 0.6 : 1);
    if (dps > bd) { bd = dps; best = id; }
  }
  return { id: best, dps: bd };
}

async function playRun() {
  runNo++;
  const { spec, effects: E } = buildPlayerSpec(prof);
  const sim = new Sim({ seed: SEED * 1000 + runNo }); await sim.init();
  const g = new SyncGround(sim); sim.setGround(g); g.update(40);
  const P = sim.spawnCar(spec.id, { spec, s: 40, kind: 'player' }); sim.start();
  globalThis.__crashLog = [];
  const W = bestWeapon(prof);
  let cash = 0, gunT = 0, medkits = E.medkits;
  const wantSpeed = spec.engine.vmax * 0.8;
  for (let i = 0; ; i++) {
    const v = P.veh, road = sim.road, B = sim.boss;
    // steer for the gap in roadblocks, slow for tight curves
    let lat = B ? 4.5 : 0;
    const rb = road.featuresIn(P.s, P.s + 160, 'roadblock')[0];
    if (rb) lat = rb.gap * 2.6;
    const kAhead = Math.max(Math.abs(road.sample(P.s + 40).k), Math.abs(road.sample(P.s + 90).k));
    const tp = road.pointAt(P.s + 18 + v.speed * 0.45, lat, {});
    const err = wrapAngle(Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z));
    const want = B ? B.v + clamp((B.s - P.s - 30) * 0.4, -10, 10) : Math.min(wantSpeed, Math.sqrt(16 / Math.max(kAhead, 1e-4)));
    v.setInput({ throttle: v.vf < want ? 1 : 0, brake: v.vf > want + 4 ? 0.5 : 0, steer: clamp(err * 2.5, -1, 1), nitro: v.nitro > 1 && v.vf < want - 5 });
    gunT -= DT;
    if (gunT <= 0 && P.crew.gunner.alive) {
      gunT = 0.2;
      let tgt = null, bd = 120;
      for (const c of sim.cars.values()) { if (c.kind !== 'enemy' || c.exploded) continue; const d = c.veh.pos.distanceTo(v.pos); if (d < bd) { bd = d; tgt = c; } }
      const dmg = W.dps * 0.2 * ACC;
      if (B && !B.dead && B.pos.distanceTo(v.pos) < 150 && (!tgt || Math.random() < 0.7)) {
        const order = ['part_turret_1', 'part_turret_2', 'part_pod_L', 'part_pod_R', 'part_turret_main', 'part_tank_L', 'part_tank_R', 'panel_armor_rear_1', 'panel_armor_rear_2', 'panel_armor_rear_3', 'part_engine'];
        const n = order.find((k) => B.alive[k]); if (n) sim.applyHit({ carId: B.id, zone: n, zoneIndex: -1, dmg, through: false, point: [B.pos.x, B.pos.y + 3, B.pos.z], dir: [0, 0, 1], weapon: W.id });
      } else if (tgt) {
        const zs = ['driver', 'gunner', 'body', 'body', 'engine', 'tire', 'driver_head'];
        const z = tgt.zones.find((q) => q.kind === zs[(Math.random() * zs.length) | 0]) || tgt.zones.find((q) => q.kind === 'body');
        sim.applyHit({ carId: tgt.id, zone: z.kind, zoneIndex: z.index ?? -1, dmg, through: false, point: [tgt.veh.pos.x, tgt.veh.pos.y + 1, tgt.veh.pos.z], dir: [0, 0, 1], weapon: W.id });
      }
    }
    // medkits when hurt
    if (medkits > 0 && (P.crew.driver.hp < P.crew.driver.max * 0.35 || P.crew.gunner.hp < P.crew.gunner.max * 0.35)) { if (sim.useMedkit()) medkits--; }
    sim.step(DT);
    for (const e of sim.drainEvents()) {
      if (e.t === 'kill') cash += Math.round((KILL_CASH[e.spec] || 60) * (1 + sim.director.level * ECONOMY.killLevel) * (e.crash ? ECONOMY.crashMul : 1) * E.cashMul);
      if (e.t === 'minibossDown') cash += Math.round(ECONOMY.minibossBounty[e.index] * E.cashMul);
    }
    if (sim.state === 'over' || sim.time > 3000) break;
  }
  const dist = sim.stats.distance - 40;
  cash += Math.round(dist * ECONOMY.perMeter * (1 + ECONOMY.perMeterLevel * sim.director.level) * E.cashMul) + Math.round(sim.time * ECONOMY.perSecond * E.cashMul);
  if (sim.won) cash += ECONOMY.bossBounty;
  total += sim.time + 45; // + ~45 s in the garage per run
  creditRun(prof, { cash, distance: dist, time: sim.time, kills: sim.stats.kills, won: sim.won });
  const big = (globalThis.__crashLog || []).filter((x) => x.other === -1 && x.force > 150000);
  if ((sim.stats.damageBy?.crash || 0) > 400) console.log('   crash sample:', big.slice(0, 6).map((x) => `${x.what} t${x.t.toFixed(1)} F${(x.force / 1000) | 0}k dir${x.dir} v${x.v} air${x.air} s${x.s}`).join(' | '), 'n=', big.length);
  const dby = Object.entries(sim.stats.damageBy || {}).map(([k, v]) => `${k}:${v | 0}`).join(' ');
  return { dby, time: sim.time, dist, cash, won: sim.won, why: sim.result?.why, kills: sim.stats.kills, weapon: W.id, dps: W.dps.toFixed(0), truck: spec.id };
}

// greedy shopping list, repeated until nothing affordable
const PLAN = [
  ['weapon', 'smg'], ['upgrade', 'armor'], ['upgrade', 'engine'], ['weapon', 'shotgun'], ['truck', 'truck_t2'], ['upgrade', 'vest'], ['upgrade', 'nitro'],
  ['upgrade', 'armor'], ['weapon', 'rifle'], ['track', 'rifle', 'dmg'], ['upgrade', 'tires'], ['upgrade', 'engine'], ['upgrade', 'medkit'], ['truck', 'truck_t3'],
  ['upgrade', 'armor'], ['upgrade', 'vest'], ['weapon', 'lmg'], ['track', 'lmg', 'dmg'], ['track', 'lmg', 'mag'], ['upgrade', 'engine'], ['upgrade', 'glass'],
  ['weapon', 'rpg'], ['upgrade', 'scavenger'], ['track', 'lmg', 'dmg'], ['upgrade', 'armor'], ['truck', 'truck_t4'], ['upgrade', 'vest'], ['upgrade', 'medkit'],
  ['track', 'lmg', 'dmg'], ['track', 'lmg', 'rel'], ['upgrade', 'armor'], ['upgrade', 'engine'], ['upgrade', 'glass'], ['upgrade', 'medkit'], ['upgrade', 'nitro'],
];
function shop() {
  const bought = [];
  for (let k = 0; k < PLAN.length; k++) {
    const [kind, id, track] = PLAN[k];
    let r = { ok: false };
    if (kind === 'weapon' && !prof.weapons[id]) { r = buyWeapon(prof, id); if (r.ok) { prof.loadout = [id, ...prof.loadout.filter((x) => x !== id)].slice(0, 3); } }
    else if (kind === 'truck' && !prof.trucks.includes(id)) r = buyTruck(prof, id);
    else if (kind === 'upgrade') { const c = upgradeCost(prof, id); if (c !== null && c <= prof.cash) r = buyUpgrade(prof, id); else if (c !== null) break; else continue; }
    else if (kind === 'track' && prof.weapons[id]) r = buyWeaponTrack(prof, id, track);
    else continue;
    if (r.ok) { bought.push(kind === 'track' ? `${id}.${track}` : id); PLAN.splice(k, 1); k--; }
    else if (r.reason === 'cash') break; // save up for the next item in order
  }
  return bought;
}

const t0 = performance.now();
while (total < CAP) {
  const r = await playRun();
  const b = shop();
  console.log(`run ${String(runNo).padStart(2)} | ${(r.time / 60).toFixed(1)} min ${(r.dist / 1000).toFixed(1)} km | ${r.truck} ${r.weapon}(${r.dps} dps) kills ${r.kills} | +$${r.cash} ${r.won ? 'WON' : r.why} | total ${(total / 60).toFixed(0)} min | bought ${b.join(',') || '-'} | bank $${prof.cash} | dmg ${r.dby}`);
  if (r.won) { console.log(`BOSS BEATEN after ${(total / 3600).toFixed(2)} h of play (${runNo} runs)`); break; }
}
console.log('wall', ((performance.now() - t0) / 60000).toFixed(1), 'min');

// Encounter / threat probe: headless runs with the game's own AI partners (AIDriver + AIGunner + GunnerController), measuring
// how the raiders engage. Prints per-run results and an aggregate:
//   contact  = seconds until the first enemy round hits the truck/crew; near = first enemy within 20 m
//   hits/min, dmg/min per distance band; fwd% = time with a live raider in the driver's windshield cone (±38°, <130 m);
//   side% = in the side windows (38-100°, <60 m); ahead% = a raider ahead of the truck on the road; deaths by cause.
//   node tools/test/threat_probe.mjs [--runs=6] [--start=40] [--secs=300] [--profile=fresh|mid|late|maxed] [--seed=1] [--driver=ai|bot] [--quiet]
//   campaign mode (fresh save, runs back to back with the campaign_sim shopping list until the Leviathan dies or the cap):
//   node tools/test/threat_probe.mjs --campaign=4 [--seed=1]
import * as THREE from 'three';
import { Sim, DT } from '../../src/sim/sim.js';
import { SyncGround } from '../../src/sim/sync_ground.js';
import { RAY_SHOT } from '../../src/sim/physics.js';
import { RAPIER } from '../../src/sim/physics.js';
import { buildPlayerSpec, gunnerLoadout } from '../../src/game/run_setup.js';
import { DEFAULT_PROFILE, UPGRADES } from '../../src/data/upgrades.js';
import { ECONOMY, KILL_CASH } from '../../src/data/economy.js';
import { buyTruck, buyUpgrade, buyWeapon, buyWeaponTrack, upgradeCost, creditRun } from '../../src/meta/profile.js';
import { GunnerController } from '../../src/game/gunner.js';
import { AIDriver } from '../../src/game/ai_driver.js';
import { AIGunner } from '../../src/game/ai_gunner.js';
import { clamp, wrapAngle } from '../../src/core/util.js';

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const RUNS = +(opt.runs || 6), START = +(opt.start || 40), SECS = +(opt.secs || 300), SEED = +(opt.seed || 1), PROFILE = opt.profile || 'fresh', DRIVER = opt.driver || 'ai';
const BANDS = [0, 3000, 10000, 20000, 30000, 40000, 50000, 70000];
const bandOf = (s) => { for (let i = BANDS.length - 2; i >= 0; i--) if (s >= BANDS[i]) return i; return 0; };
const bandName = (i) => `${BANDS[i] / 1000}-${BANDS[i + 1] / 1000}km`;

function profileFor(kind) {
  const p = DEFAULT_PROFILE();
  const up = (lv) => { for (const u of UPGRADES) p.upgrades[u.id] = Math.min(lv, u.costs.length); };
  if (kind === 'mid') { p.truck = 'truck_t2'; p.trucks.push('truck_t2'); p.upgrades = { armor: 2, engine: 2, vest: 1, nitro: 1, tires: 1 }; p.weapons.smg = { dmg: 1, mag: 0, rel: 0, hnd: 0 }; p.weapons.shotgun = { dmg: 0, mag: 0, rel: 0, hnd: 0 }; p.loadout = ['smg', 'shotgun', 'pistol']; }
  if (kind === 'late') { p.truck = 'truck_t3'; p.trucks.push('truck_t2', 'truck_t3'); up(3); p.weapons.lmg = { dmg: 2, mag: 1, rel: 0, hnd: 0 }; p.weapons.rifle = { dmg: 1, mag: 0, rel: 0, hnd: 0 }; p.loadout = ['lmg', 'rifle', 'pistol']; }
  if (kind === 'maxed') { p.truck = 'truck_t4'; p.trucks = ['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4']; up(9); p.weapons = { lmg: { dmg: 3, mag: 3, rel: 3, hnd: 3 }, rpg: { dmg: 3, mag: 3, rel: 3, hnd: 3 }, sniper: { dmg: 3, mag: 3, rel: 3, hnd: 3 } }; p.loadout = ['lmg', 'rpg', 'sniper']; }
  return p;
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

async function oneRun(k, profIn = null, maxSecs = SECS) {
  const prof = profIn || profileFor(PROFILE);
  const { spec, effects } = buildPlayerSpec(prof);
  const sim = new Sim({ seed: SEED * 1000 + k }); await sim.init();
  const g = new SyncGround(sim); sim.setGround(g); g.update(START);
  const P = sim.spawnCar(spec.id, { spec, s: START, kind: 'player' }); sim.start();
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  const run = {
    sim, player: P, effects,
    _unflip() { const b = P.veh.body; const yaw = Math.atan2(P.veh.fwd.x, P.veh.fwd.z); b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true); b.setTranslation({ x: P.veh.pos.x, y: P.veh.pos.y + 1.8, z: P.veh.pos.z }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); sim.damageCar(P, P.maxHp * 0.04, { cause: 'flip' }); },
  };
  const gunner = new GunnerController(gunnerLoadout(effects), {
    ownCar: () => P,
    targets: function* () { for (const c of sim.cars.values()) if (c.kind === 'enemy') yield c; if (sim.boss && !sim.boss.exploded) yield sim.boss; },
    raycastWorld: (o, d, max) => { ray.origin.x = o.x; ray.origin.y = o.y; ray.origin.z = o.z; ray.dir.x = d.x; ray.dir.y = d.y; ray.dir.z = d.z; const h = sim.world.castRayAndGetNormal(ray, max, true, undefined, RAY_SHOT); return h ? { t: h.timeOfImpact, normal: new THREE.Vector3(h.normal.x, h.normal.y, h.normal.z), kind: 'dirt' } : null; },
    emit: (e) => sim.emit({ ...e, fromGunner: true }),
    report: (h) => sim.applyHit(h),
    fireRocket: (o, d, w) => sim.projectiles.addRocket(o, d, { ...w.rocket, direct: w.dmg }, 1),
    throwGrenade: (o, v, cfg) => sim.projectiles.addGrenade(sim, o, v, cfg, 1),
  });
  const aiG = new AIGunner(run), aiD = DRIVER === 'ai' ? new AIDriver(run) : null;
  let medkits = effects.medkits;
  const eye = new THREE.Vector3(), dir = new THREE.Vector3();
  const R = { tContact: null, tNear: null, hits: new Array(BANDS.length).fill(0), dmg: new Array(BANDS.length).fill(0), time: new Array(BANDS.length).fill(0), fwd: 0, side: 0, ahead: 0, t: 0, reg: { ahead: 0, beside: 0, behind: 0, far: 0 }, why: null, dby: null, crewBy: {}, kills: 0, crashKills: 0, chain: 0, driverKills: 0, dkCrash: 0, events: {} };
  const dkWatch = new Map(); // driver-killed car id -> time
  let crewDmgBy = {};
  const origCar = sim.damageCar.bind(sim);
  sim.damageCar = (car, dmg, info = {}) => { if (car === P && opt.noscenery && (info.cause === 'crash' || info.cause === 'flip') && !(info.src >= 0)) return; if (car === P && opt.srclog) { const o = sim.cars.get(info.src); const k = (o ? (o.elite ? 'WARLORD' : o.spec.id) : 'none') + ':' + (info.cause || '?'); (R.srcDmg || (R.srcDmg = {}))[k] = ((R.srcDmg || {})[k] || 0) + dmg; } if (car.elite && opt.elitelog) { const k = car.elite.name.slice(0, 6) + '#' + car.id + ':' + (info.cause || '?'); (R.eliteDmg || (R.eliteDmg = {}))[k] = ((R.eliteDmg || {})[k] || 0) + dmg; } return origCar(car, dmg, info); };
  const origCrew = sim.damageCrew.bind(sim);
  sim.damageCrew = (car, role, dmg, info = {}) => { const d = origCrew(car, role, dmg, info); if (car === P && d > 0) crewDmgBy[info.cause || '?'] = (crewDmgBy[info.cause || '?'] || 0) + d; return d; };
  globalThis.__crashLog = [];
  const steps = Math.round(maxSecs / DT);
  let cash = 0;
  for (let i = 0; i < steps; i++) {
    // partners at 60 Hz
    if ((i & 1) === 0) {
      const dt = DT * 2;
      if (aiD) { const c = aiD.update(dt); P.veh.setInput(c); if (c.medkit && medkits > 0 && sim.useMedkit()) medkits--; }
      else {
        const v = P.veh, road = sim.road; let lat = 0; const rb = road.featuresIn(P.s, P.s + 160, 'roadblock')[0]; if (rb) lat = rb.gap * 2.6;
        const kA = Math.max(Math.abs(road.sample(P.s + 40).k), Math.abs(road.sample(P.s + 90).k));
        const tp = road.pointAt(P.s + 18 + v.speed * 0.45, lat, {}); const err = wrapAngle(Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z));
        const want = Math.min(P.spec.engine.vmax * 0.8, Math.sqrt(16 / Math.max(kA, 1e-4)));
        v.setInput({ throttle: v.vf < want ? 1 : 0, brake: v.vf > want + 4 ? 0.5 : 0, steer: clamp(err * 2.5, -1, 1), nitro: v.nitro > 1 && v.vf < want - 5 });
        if (v.up.y < 0.5 || (v.speed < 2 && sim.time > 5)) { P.stuckT = (P.stuckT || 0) + dt; if (P.stuckT > 2.5) { P.stuckT = 0; run._unflip(); } } else P.stuckT = 0;
      }
      const seat = P.spec.seats.gunner, rc = P.veh.restComHeight;
      eye.set(seat[0] + gunner.pos.x, seat[1] + 1.66 - rc, seat[2] + gunner.pos.z + 0.08).applyQuaternion(P.veh.quat).add(P.veh.pos);
      const cmd = aiG.update(dt, gunner, eye);
      if (cmd.medkit && medkits > 0 && sim.useMedkit()) medkits--;
      dir.set(Math.sin(gunner.yaw) * Math.cos(gunner.pitch), Math.sin(gunner.pitch), Math.cos(gunner.yaw) * Math.cos(gunner.pitch));
      gunner.muzzle.copy(eye).addScaledVector(dir, 0.9);
      const carYaw = Math.atan2(P.veh.fwd.x, P.veh.fwd.z);
      gunner.update(dt, cmd, { position: eye, dir }, carYaw, { carVel: P.veh.vel });
      const gs = P.crew.gunner; gs.aimYaw = gunner.yaw; gs.aimPitch = gunner.pitch; gs.crouch = gunner.crouch > 0.5;
    }
    sim.step(DT);
    if (opt.traceelite && i % 240 === 0 && sim.director.activeElite) console.log(`  t${sim.time.toFixed(0)} P v${(P.veh.vf * 3.6) | 0} d${P.d.toFixed(1)} hp${P.hp | 0} | ` + sim.director.activeElite.cars.map((c) => `#${c.id} ${(c.s - P.s).toFixed(0)}/${c.d.toFixed(1)} v${(c.veh.vf * 3.6) | 0} hp${c.hp | 0}${c.exploded ? 'X' : ''}${c.driverless ? 'D' : ''} ${c.ai?.behavior}${c.ai?.atk ? '!' + c.ai.atk.kind + '.' + c.ai.atk.phase : ''}`).join(' | '));
    const b = bandOf(P.s);
    if (sim.state === 'run') { R.time[b] += DT; R.t += DT; }
    // pass speeds: a raider going from behind to ahead of the truck (relative speed at the moment it draws level)
    if ((i & 3) === 0) for (const c of sim.cars.values()) {
      if (c.kind !== 'enemy' || c.exploded) continue;
      const g = c.s - P.s, pg = c._pg; c._pg = g;
      if (pg !== undefined && pg < 0 && g >= 0 && Math.abs(c.d - P.d) < 7) { const v = (c.veh.vf - P.veh.vf) * 3.6; (R.passes || (R.passes = [])).push(v); if (c.ai?.mode === 'overtake') (R.opasses || (R.opasses = [])).push(v); }
    }
    // view presence
    if ((i & 7) === 0 && sim.state === 'run') {
      let fwd = false, side = false, ahead = false;
      _q.copy(P.veh.quat).invert();
      for (const c of sim.cars.values()) {
        if (c.kind !== 'enemy' || c.exploded) continue;
        _v.copy(c.veh.pos).sub(P.veh.pos); const dist = _v.length();
        _v.applyQuaternion(_q); // truck frame: +Z forward, +X left
        const ang = Math.abs(Math.atan2(_v.x, _v.z));
        if (ang < 0.66 && dist < 130) fwd = true; else if (ang < 1.75 && dist < 60) side = true;
        if (c.s > P.s + 3 && c.s < P.s + 120) ahead = true;
        const g = c.s - P.s; R.reg[Math.abs(c.d - P.d) > 60 || g > 120 || g < -120 ? 'far' : g > 5 ? 'ahead' : g > -6 ? 'beside' : 'behind'] += DT * 8;
      }
      const w = DT * 8; if (fwd) R.fwd += w; if (side) R.side += w; if (ahead) R.ahead += w;
      if (R.tNear === null) for (const c of sim.cars.values()) if (c.kind === 'enemy' && !c.exploded && c.veh.pos.distanceTo(P.veh.pos) < 20) { R.tNear = sim.time; break; }
    }
    for (const e of sim.drainEvents()) {
      R.events[e.t] = (R.events[e.t] || 0) + 1;
      if (e.t === 'hit' && e.enemy && e.carId === 1 && opt.srclog) { const o = sim.cars.get(e.src); }
      if ((e.t === 'hit' && e.enemy && e.carId === 1) || (e.t === 'crewHit' && e.id === 1 && e.dmg > 0 && !(e.t === 'crewHit' && false))) {
        if (e.t === 'hit') { R.hits[b]++; if (R.tContact === null) R.tContact = sim.time; }
      }
      if (e.t === 'shot' && e.src !== 'player' && !e.fromGunner) { R.eshots = (R.eshots || 0) + (e.rays ? e.rays.length : 1); }
      if (e.t === 'enemyTell' && e.kind === 'burst') R.bursts = (R.bursts || 0) + 1;
      if (e.t === 'kill') { R.kills++; if (e.crash) R.crashKills++; cash += Math.round((KILL_CASH[e.spec] || 60) * (1 + sim.director.level * ECONOMY.killLevel) * (e.crash ? ECONOMY.crashMul : 1) * effects.cashMul); }
      if (e.t === 'minibossDown') { cash += Math.round(ECONOMY.minibossBounty[e.index] * effects.cashMul); R.mbDown = (R.mbDown || 0) + 1; }
      if (e.t === 'minibossSpawn') { R.mbSeen = (R.mbSeen || 0) + 1; R.mbFight = { name: e.name, t0: sim.time, hp0: P.hp, crew0: P.crew.driver.hp + P.crew.gunner.hp }; }
      if ((e.t === 'minibossDown' || e.t === 'minibossLost') && R.mbFight) { const F = R.mbFight; (R.mbLog || (R.mbLog = [])).push(`${F.name} ${e.t === 'minibossDown' ? 'DOWN' : 'LOST'} in ${(sim.time - F.t0).toFixed(0)}s, truck -${(F.hp0 - P.hp) | 0}`); R.mbFight = null; }
      if (e.t === 'crash' && e.id === 1 && e.other >= 0) { const o = sim.cars.get(e.other); const k = !o ? 'gone' : o.exploded ? 'wreck' : o.driverless ? 'runaway' : (o.ai?.atk ? o.ai.atk.kind + '.' + o.ai.atk.phase : o.ai?.behavior + (o.s > P.s + 2 ? '(ahead)' : o.s < P.s - 2 ? '(behind)' : '(beside)')); R.rams = R.rams || {}; R.rams[k] = (R.rams[k] || 0) + e.dv; }
      if (e.t === 'explode' && e.id !== 1) { const d = P.veh.pos.distanceTo({ x: e.pos[0], y: e.pos[1], z: e.pos[2] }); if (d < 14) R.closeBooms = (R.closeBooms || 0) + 1; }
      if (e.t === 'crewDead' && e.role === 'driver' && e.id !== 1 && e.cause !== 'explosion') { R.driverKills++; dkWatch.set(e.id, sim.time); }
      if (e.t === 'crash' && dkWatch.has(e.id) && e.other >= 0 && sim.time - dkWatch.get(e.id) < 6) { R.dkCrash++; dkWatch.delete(e.id); }
      if (e.t === 'explode' && e.cause === 'crash') R.chain++;
    }
    // headless has no bridges/tunnel tubes and the AI driver can wedge itself: after 10 s without progress, put the truck back on the road
    if ((i % 1200) === 0) { if (R.lastS !== undefined && P.s - R.lastS < 15 && sim.time > 20 && sim.state === 'run') { R.resets = (R.resets || 0) + 1; const sm = sim.road.sample(P.s + 25), b = P.veh.body; b.setTranslation({ x: sm.x, y: sim.road.surfaceY(sm, 0) + 1.5, z: sm.z }, true); b.setRotation({ x: 0, y: Math.sin(sm.th / 2), z: 0, w: Math.cos(sm.th / 2) }, true); b.setLinvel({ x: Math.sin(sm.th) * 15, y: 0, z: Math.cos(sm.th) * 15 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); if (R.resets > 12) { R.why = 'stuck'; break; } } R.lastS = P.s; }
    if (sim.state === 'over') { if (R.mbFight) (R.mbLog || (R.mbLog = [])).push(`${R.mbFight.name} KILLED US after ${(sim.time - R.mbFight.t0).toFixed(0)}s (warlord hp ${((sim.director.activeElite?.hp01 ?? 0) * 100) | 0}%)`); break; }
  }
  const dmgNow = (sim.stats.damageTaken || 0) + Object.values(crewDmgBy).reduce((a, x) => a + x, 0);
  R.scenery = {}; for (const x of globalThis.__crashLog) if (x.other === -1 && x.force > 150000) R.scenery[x.what.replace(/\d+$/, '')] = (R.scenery[x.what.replace(/\d+$/, '')] || 0) + 1;
  R.dmgTotal = dmgNow; R.won = sim.won; R.truck = spec.id; R.weapon = effects.weapons[0];
  const dist = sim.stats.distance - START;
  R.cash = cash + Math.round(dist * ECONOMY.perMeter * (1 + ECONOMY.perMeterLevel * sim.director.level) * effects.cashMul) + Math.round(sim.time * ECONOMY.perSecond * effects.cashMul) + (sim.won ? ECONOMY.bossBounty : 0); R.why = R.why || sim.result?.why || (sim.state === 'over' ? '?' : 'alive'); R.dby = { ...(sim.stats.damageBy || {}) }; R.crewBy = crewDmgBy; R.dist = P.s - START; R.level = sim.director.level;
  return R;
}

// ------------------------------------------------------------------------------------------------ campaign mode
const PLAN = [
  ['weapon', 'smg'], ['upgrade', 'armor'], ['upgrade', 'engine'], ['weapon', 'shotgun'], ['truck', 'truck_t2'], ['upgrade', 'vest'], ['upgrade', 'nitro'],
  ['upgrade', 'armor'], ['weapon', 'rifle'], ['track', 'rifle', 'dmg'], ['upgrade', 'tires'], ['upgrade', 'engine'], ['upgrade', 'medkit'], ['truck', 'truck_t3'],
  ['upgrade', 'armor'], ['upgrade', 'vest'], ['weapon', 'lmg'], ['track', 'lmg', 'dmg'], ['track', 'lmg', 'mag'], ['upgrade', 'engine'], ['upgrade', 'glass'],
  ['weapon', 'rpg'], ['upgrade', 'scavenger'], ['track', 'lmg', 'dmg'], ['upgrade', 'armor'], ['truck', 'truck_t4'], ['upgrade', 'vest'], ['upgrade', 'medkit'],
  ['track', 'lmg', 'dmg'], ['track', 'lmg', 'rel'], ['upgrade', 'armor'], ['upgrade', 'engine'], ['upgrade', 'glass'], ['upgrade', 'medkit'], ['upgrade', 'nitro'],
];
function shop(prof) {
  const bought = [];
  for (let k = 0; k < PLAN.length; k++) {
    const [kind, id, track] = PLAN[k];
    let r = { ok: false, reason: 'skip' };
    if (kind === 'weapon') { if (prof.weapons[id]) { PLAN.splice(k--, 1); continue; } r = buyWeapon(prof, id); if (r.ok) prof.loadout = [id, ...prof.loadout.filter((x) => x !== id)].slice(0, 3); }
    else if (kind === 'truck') { if (prof.trucks.includes(id)) { PLAN.splice(k--, 1); continue; } r = buyTruck(prof, id); if (r.ok) prof.truck = id; }
    else if (kind === 'upgrade') { const c = upgradeCost(prof, id); if (c === null) { PLAN.splice(k--, 1); continue; } r = c <= prof.cash ? buyUpgrade(prof, id) : { ok: false, reason: 'cash' }; }
    else if (kind === 'track') { if (!prof.weapons[id]) continue; r = buyWeaponTrack(prof, id, track); if (!r.ok && r.reason !== 'cash') { PLAN.splice(k--, 1); continue; } }
    if (r.ok) { bought.push(kind === 'track' ? `${id}.${track}` : id); PLAN.splice(k--, 1); }
    else if (r.reason === 'cash') break;
  }
  // plan done: spend the rest like a player would -- cheapest remaining upgrade / weapon track first, until broke
  if (!PLAN.length) for (let guard = 0; guard < 60; guard++) {
    const opts = [];
    for (const u of UPGRADES) { const c = upgradeCost(prof, u.id); if (c !== null && c <= prof.cash) opts.push([c, () => buyUpgrade(prof, u.id), u.id]); }
    for (const w of prof.loadout) for (const t of ['dmg', 'mag', 'rel', 'hnd']) opts.push([0, () => buyWeaponTrack(prof, w, t), `${w}.${t}`]);
    let done = false;
    for (const [, fn, name] of opts.sort((a, b) => a[0] - b[0])) { const r = fn(); if (r.ok) { bought.push(name); done = true; break; } }
    if (!done) break;
  }
  return bought;
}
if (opt.campaign) {
  const cap = +opt.campaign * 3600, prof = DEFAULT_PROFILE();
  let total = 0, n = 0, deathsRaiders = 0, deathsScenery = 0;
  while (total < cap) {
    const r = await oneRun(n++, prof, 3000);
    total += r.t + 45;
    creditRun(prof, { cash: r.cash, distance: r.dist, time: r.t, kills: r.kills, won: r.won });
    const b = shop(prof);
    const dby = r.dby, raider = (dby.ram || 0) + (dby.bullet || 0) + (dby.blast || 0) + (dby.rocket || 0) + (dby.fire || 0), scen = (dby.crash || 0) + (dby.flip || 0);
    if (!r.won) { if (raider >= scen) deathsRaiders++; else deathsScenery++; }
    if (r.mbLog) console.log('     warlords: ' + r.mbLog.join(' | '));
    console.log(`run ${String(n).padStart(2)} | ${(r.t / 60).toFixed(1)} min ${(r.dist / 1000).toFixed(1)} km${r.resets ? ` (${r.resets} unstuck)` : ''} | ${r.truck} ${r.weapon} | kills ${r.kills} (chain ${r.chain}) mb ${r.mbDown || 0}/${r.mbSeen || 0} | +$${r.cash} ${r.won ? 'WON' : r.why} | raiders ${raider | 0} scenery ${scen | 0} crew ${Object.values(r.crewBy).reduce((a, x) => a + x, 0) | 0} | total ${(total / 60).toFixed(0)} min | bought ${b.join(',') || '-'} | bank $${prof.cash}`);
    if (r.won) { console.log(`LEVIATHAN DOWN after ${(total / 3600).toFixed(2)} h (${n} runs)`); break; }
  }
  console.log(`deaths mostly to raiders: ${deathsRaiders}, mostly to scenery: ${deathsScenery}`);
  process.exit(0);
}

const all = [];
for (let k = 0; k < RUNS; k++) {
  const r = await oneRun(k);
  all.push(r);
  if (!opt.quiet) {
    const dby = Object.entries(r.dby).map(([a, b]) => `${a}:${b | 0}`).join(' '), cby = Object.entries(r.crewBy).map(([a, b]) => `${a}:${b | 0}`).join(' ');
    if (r.mbLog) console.log('     warlords: ' + r.mbLog.join(' | '));
    if (r.srcDmg) console.log('     truck damage by source: ' + JSON.stringify(Object.fromEntries(Object.entries(r.srcDmg).sort((a, b) => b[1] - a[1]).map(([a, b]) => [a, b | 0]))));
    if (r.eliteDmg) console.log('     warlord damage by cause: ' + JSON.stringify(Object.fromEntries(Object.entries(r.eliteDmg).map(([a, b]) => [a, b | 0]))));
    console.log(`run ${k}: ${(r.t / 60).toFixed(1)} min ${(r.dist / 1000).toFixed(1)} km ${r.why} | contact ${r.tContact?.toFixed(1) ?? '-'}s near ${r.tNear?.toFixed(1) ?? '-'}s | hits/min ${(r.hits.reduce((a, x) => a + x, 0) / Math.max(r.t / 60, 0.01)).toFixed(1)} | fwd ${(100 * r.fwd / r.t).toFixed(0)}% side ${(100 * r.side / r.t).toFixed(0)}% ahead ${(100 * r.ahead / r.t).toFixed(0)}% | kills ${r.kills} crash ${r.crashKills} chain ${r.chain} drvKill ${r.driverKills}->crash ${r.dkCrash} | truck ${dby} | crew ${cby}`);
  }
}
// aggregate
const sum = (f) => all.reduce((a, r) => a + f(r), 0);
const T = sum((r) => r.t);
console.log(`\n== ${PROFILE} x${RUNS} from ${START} m, driver=${DRIVER}: mean ${(T / RUNS / 60).toFixed(1)} min, ${(sum((r) => r.dist) / RUNS / 1000).toFixed(1)} km`);
const cont = all.map((r) => r.tContact).filter((x) => x !== null); const near = all.map((r) => r.tNear).filter((x) => x !== null);
console.log(`first contact: median ${cont.length ? cont.sort((a, b) => a - b)[cont.length >> 1].toFixed(1) : '-'} s (${cont.length}/${RUNS} runs)  first raider within 20 m: median ${near.length ? near.sort((a, b) => a - b)[near.length >> 1].toFixed(1) : '-'} s`);
console.log(`forward view ${(100 * sum((r) => r.fwd) / T).toFixed(0)}%  side windows ${(100 * sum((r) => r.side) / T).toFixed(0)}%  raider ahead on the road ${(100 * sum((r) => r.ahead) / T).toFixed(0)}%  | avg raiders ahead ${(sum((r) => r.reg.ahead) / T).toFixed(2)} beside ${(sum((r) => r.reg.beside) / T).toFixed(2)} behind ${(sum((r) => r.reg.behind) / T).toFixed(2)} far ${(sum((r) => r.reg.far) / T).toFixed(2)}`);
const bands = [];
for (let b = 0; b < BANDS.length - 1; b++) { const t = sum((r) => r.time[b]); if (t < 5) continue; bands.push(`${bandName(b)}: ${(sum((r) => r.hits[b]) / (t / 60)).toFixed(1)} hits/min (${(t / 60).toFixed(1)} min)`); }
console.log('hits by band: ' + bands.join(' | '));
const why = {}; for (const r of all) why[r.why] = (why[r.why] || 0) + 1;
const dby = {}; for (const r of all) for (const [k2, v] of Object.entries(r.dby)) dby[k2] = (dby[k2] || 0) + v;
const cby = {}; for (const r of all) for (const [k2, v] of Object.entries(r.crewBy)) cby[k2] = (cby[k2] || 0) + v;
const raider = (dby.ram || 0) + (dby.bullet || 0) + (dby.blast || 0) + (dby.rocket || 0) + (dby.fire || 0), scen = (dby.crash || 0) + (dby.flip || 0);
console.log(`deaths: ${JSON.stringify(why)} | truck dmg: raiders ${raider | 0} vs scenery ${scen | 0} (${JSON.stringify(Object.fromEntries(Object.entries(dby).map(([a, b]) => [a, b | 0])))}) | crew dmg ${JSON.stringify(Object.fromEntries(Object.entries(cby).map(([a, b]) => [a, b | 0])))}`);
const rams = {}; for (const r of all) for (const [k2, v] of Object.entries(r.rams || {})) rams[k2] = (rams[k2] || 0) + v;
console.log('player collisions (sum dv) by what the raider was doing:', JSON.stringify(Object.fromEntries(Object.entries(rams).sort((a, b) => b[1] - a[1]).map(([a, b]) => [a, +b.toFixed(1)]))), ' explosions within 14 m:', sum((r) => r.closeBooms || 0));
const ev = {}; for (const r of all) for (const [k2, v] of Object.entries(r.events)) ev[k2] = (ev[k2] || 0) + v;
const scen2 = {}; for (const r of all) for (const [k2, v] of Object.entries(r.scenery || {})) scen2[k2] = (scen2[k2] || 0) + v;
console.log('hard scenery impacts by collider:', JSON.stringify(scen2));
console.log(`per min: enemy rounds ${(sum((r) => r.eshots || 0) / (T / 60)).toFixed(0)}, whizz ${((ev.whizz || 0) / (T / 60)).toFixed(0)}, crewHit ${((ev.crewHit || 0) / (T / 60)).toFixed(0)}, tells ${((ev.enemyTell || 0) / (T / 60)).toFixed(1)}, encounters ${((ev.encounter || 0) / (T / 60)).toFixed(2)}`);
const passes = all.flatMap((r) => r.passes || []).sort((a, b) => a - b), op = all.flatMap((r) => r.opasses || []).sort((a, b) => a - b);
console.log(`overtakes: ${(op.length / (T / 60)).toFixed(2)}/min, pass speed median ${op.length ? op[op.length >> 1].toFixed(0) : '-'} km/h (p25 ${op.length ? op[Math.floor(op.length * 0.25)].toFixed(0) : '-'}, p75 ${op.length ? op[Math.floor(op.length * 0.75)].toFixed(0) : '-'})`);
console.log(`raider passes: ${(passes.length / (T / 60)).toFixed(2)}/min, relative speed median ${passes.length ? passes[passes.length >> 1].toFixed(0) : '-'} km/h (p75 ${passes.length ? passes[Math.floor(passes.length * 0.75)].toFixed(0) : '-'})  near misses ${((ev.nearMiss || 0) / (T / 60)).toFixed(2)}/min  off-road bursts ${ev.enemyTell ? all.reduce((a, r) => a + (r.bursts || 0), 0) : 0}`);
console.log(`kills/min ${(sum((r) => r.kills) / (T / 60)).toFixed(2)}  crash kills ${sum((r) => r.crashKills)}  chain explosions ${sum((r) => r.chain)}  driver kills ${sum((r) => r.driverKills)} -> hit another car ${sum((r) => r.dkCrash)}`);

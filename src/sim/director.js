// Difficulty director: decides what spawns, where and when. Level L (0..1+) follows distance to the boss, plus a little run time.
// It spends a budget on ENCOUNTERS (data/enemies.js): squads with a plan that come from behind, wait ahead, or pass you.
// Pacing: a slow pulse (waves and lulls) + a pressure rule (nobody engaging for a while -> the next squad comes early).
// Also the chain-reaction rules (explosions cooking off neighbours, runaway cars wrecking what they hit) and the minibosses.
import * as THREE from 'three';
import { clamp, lerp, rng } from '../core/util.js';
import { ENEMIES, ENEMY_GUNS, ENCOUNTERS, SET_PIECES } from '../data/enemies.js';
import { VEHICLES } from '../data/vehicles.js';
import { BOSS_S, HALF_ROAD } from '../data/biomes.js';
import { MINIBOSSES } from '../data/boss.js';
import { Leviathan } from './boss.js';
import { EnemyBrain } from './ai.js';
import { RAPIER, RAY_WORLD } from './physics.js';

const LANES = [-5.0, -1.7, 1.7, 5.0];
const _v = new THREE.Vector3();

export function levelAt(s, t) { return clamp(0.86 * (s / BOSS_S) + 0.14 * Math.min(1, t / 1500), 0, 1.25); }

export class Director {
  constructor(opts = {}) {
    this.budget = 1.2; this.r = null; this.timeSinceSpawn = 0; this.cooldown = 0.6;
    this.level = 0; this.opts = opts;
    this.spawned = 0; this.enabled = true;
    this.pulse = 0;
    this.playerVmax = 40;
    this.minibossDone = new Set();
    this.disabled = new Set();
    this.lastEngaged = 0; this.encounters = 0; this.lastEnc = null; this.history = [];
  }

  update(dt, sim) {
    const P = sim.player;
    if (!P || sim.state !== 'run' || !this.enabled) return;
    if (!this.r) {
      this.r = rng(sim.seed * 31 + 5); this.playerVmax = P.spec.engine.vmax;
      // the player's fuel tank / engine are hit zones too; with raider fire landing, a 60-HP tank would be a one-burst instant
      // death on a 1800-HP truck. Scale them with the truck: a tank fire is a threat you see coming, not a coin flip.
      P.fuelHp = Math.max(P.fuelHp, P.maxHp * 0.6); P.engineHp = Math.max(P.engineHp, 100 + P.maxHp * 0.4);
    }
    const L = this.level = levelAt(P.s, sim.time); this.simTime = sim.time;
    this._runQueue(sim);
    if ((sim.tick & 3) === 0) this._nearMiss(sim, P);
    this._bosses(sim, P, L);
    if (sim.boss && !sim.boss.dead) {
      // the Leviathan brings its own raiders (ramp); its fight keeps the damage scaling it was tuned with
      // (tuned when raider rounds never landed: its OWN guns keep that scaling; its raider escort now fires for real, so the
      // escort uses the normal late curve, and blasts sting a bit less -- the gunner stands in the open for the whole fight)
      // the finale is tuned for its distance, not for how long the run took to get there (a long run shouldn't make it harder)
      const Lb = Math.min(L, 0.88);
      sim.bossDamageMul = 0.55 + 0.45 * Lb;
      sim.enemyDamageMul = 0.55 + 0.4 * Math.min(Lb, 0.55) + 0.12 * Math.max(0, Lb - 0.55);
      sim.enemyRamMul = 0.8; sim.playerBlastMul = 0.45; sim.playerCarBlastMul = 0.8;
      this._cleanup(sim, P); return;
    }
    // how much the raiders hurt, by level: rounds (x the per-round growth in ai.shoot), rams, blasts next to you
    sim.enemyDamageMul = 0.55 + 0.4 * Math.min(L, 0.55) + 0.12 * Math.max(0, L - 0.55);   // (flattens on the last stretch: a maxed rig must reach the dam)
    sim.enemyRamMul = 0.38 + 0.2 * Math.min(L, 1);
    sim.playerBlastMul = 0.18 + 0.1 * Math.min(L, 1);
    sim.playerCarBlastMul = 0.6;   // raider cars cooking off beside you (the chain-reaction show) sting less than rockets and mines
    // accumulate budget with a slow pulse (waves and lulls)
    this.pulse += dt * (0.45 + 0.2 * L);
    const wave = 0.55 + 0.75 * (0.5 + 0.5 * Math.sin(this.pulse));
    this.budget = Math.min(this.budget + dt * (0.32 + 1.7 * Math.pow(L, 0.9)) * wave * (this.opts.rate ?? 1), 14);
    this.timeSinceSpawn += dt;
    this.cooldown -= dt;
    let alive = 0, engaged = false;
    for (const c of sim.cars.values()) {
      if (c.kind !== 'enemy' || c.exploded) continue;
      alive++;
      if (!c.driverless && Math.abs(c.s - P.s) < 55) engaged = true;
    }
    if (engaged) this.lastEngaged = sim.time;
    const cap = Math.round(3 + 6.8 * Math.pow(L, 0.8)) + (this.opts.capBonus || 0) - (this.activeElite ? 3 : 0);
    this._cleanup(sim, P);
    // pressure: if nobody has been in your face for a while, the next squad comes now (early game: every run is eventful)
    const idle = sim.time - this.lastEngaged;
    const pressure = idle > lerp(9, 4, clamp(L * 1.5, 0, 1)) && sim.time > 2;
    if (this.activeElite) return;   // a warlord fight is its own encounter (the warlord calls its own help)
    // biome set piece: once per run, regardless of budget / cap
    for (const sp of SET_PIECES) {
      if (this.setDone?.has(sp.key) || P.s < sp.s - 260 || P.s > sp.s + 900) continue;
      (this.setDone || (this.setDone = new Set())).add(sp.key);
      if (this.spawnEncounter(sim, sp.key, Math.max(L, 0.05))) {
        sim.emit({ t: 'setPiece', key: sp.key, title: sp.title, sub: sp.sub });
        this.cooldown = Math.max(this.cooldown, 10); this.encounters++;
        return;
      }
    }
    if (this.cooldown > 0 && !(pressure && this.cooldown < 4)) return;
    if (alive >= cap) return;
    const enc = this._pickEncounter(L, cap - alive, pressure);
    if (!enc) return;
    const n = this.spawnEncounter(sim, enc.key, L);
    if (n) {
      this.budget -= enc.cost;
      this.encounters++; this.lastEnc = enc.key; this.history.push(enc.key); if (this.history.length > 4) this.history.shift();
      // gap before the next squad: long lulls early, short late; waves compress it further
      this.cooldown = lerp(6.5, 3.2, clamp(L * 1.25, 0, 1)) * (0.75 + 0.5 * this.r()) * (1.25 - 0.4 * wave) + n * 0.8;
      this.lastEngaged = Math.max(this.lastEngaged, sim.time - 2); // give the squad time to arrive
    }
  }

  /** Attack tokens: how many raider gunners may wind up / fire at the same time (warlords always may). */
  fireToken(car, role) {
    if (car.elite) return true;
    const sim = car.sim, max = Math.floor(2 + 2.2 * this.level);
    if (sim.time < (this.nextFireT || 0)) return false;
    let busy = 0;
    for (const c of sim.cars.values()) {
      if (c.kind !== 'enemy' || c.exploded || !c.ai || c.elite) continue;
      for (const [r, st] of Object.entries(c.ai.state)) if ((st.mode === 'aim' || st.mode === 'burst') && !(c === car && r === role)) busy++;
    }
    if (busy >= max) return false;
    // stagger: a breather between one raider's wind-up and the next (long early, gone late)
    this.nextFireT = sim.time + lerp(1.3, 0.15, clamp(this.level, 0, 1)) * (0.7 + 0.6 * this.r());
    return true;
  }

  _pickEncounter(L, room, pressure) {
    // the very first squad of a run is waiting ahead: raiders in the windshield within seconds of GO
    const first = this.encounters === 0;
    const opts = [];
    let total = 0;
    for (const [key, E] of Object.entries(ENCOUNTERS)) {
      if (E.minLevel > L || this.disabled.has(key) || (this.failT?.[key] ?? 0) > this.simTime) continue;
      if (first && key !== 'ambush') continue;
      const cars = E.cars.filter((c) => (c.minLevel ?? 0) <= L);
      if (cars.length > room) continue;
      const cost = cars.reduce((a, c) => a + ENEMIES[this._carKey(c, L, true)].cost, 0) * 0.85;
      if (cost > this.budget + (pressure ? 1.5 : 0)) continue;
      const rep = this.history.filter((h) => h === key).length;
      const w = E.weight * (1 + (L - E.minLevel) * 0.8) / (1 + rep * 1.5);
      total += w; opts.push({ key, cost, w });
    }
    if (!opts.length) return null;
    let pick = this.r() * total;
    for (const o of opts) { pick -= o.w; if (pick <= 0) return o; }
    return opts[opts.length - 1];
  }

  _carKey(c, L, cheapest = false) {
    if (typeof c.k === 'string') return c.k;
    const ok = c.k.filter((k) => ENEMIES[k].minLevel <= L);
    if (!ok.length) return c.k[0];
    if (cheapest) return ok[0];
    // later entries are the upgrades: prefer them as the level rises
    let total = 0; const w = ok.map((k, i) => { const x = 1 + i * (0.6 + L * 2); total += x; return x; });
    let p = this.r() * total;
    for (let i = 0; i < ok.length; i++) { p -= w[i]; if (p <= 0) return ok[i]; }
    return ok[ok.length - 1];
  }

  /** Spawn a squad. Returns the number of cars that made it onto the road. */
  spawnEncounter(sim, key, L) {
    const E = ENCOUNTERS[key], P = sim.player, r = this.r;
    const pv = Math.max(10, P.veh.vf);
    // the opening squad of a run waits closer: raiders peel out in front of you within ~12 s of GO
    // (far enough that nobody pops into view: the haze and the mirrors are kind at 250+ m ahead / 140+ m behind)
    const baseAhead = this.encounters === 0 ? r.range(160, 180) : r.range(250, 300), baseBehind = r.range(140, 170);
    const flip = r() < 0.5 ? 1 : -1;
    let ai = 0, bi = 0;
    const jobs = [];
    for (const c of E.cars) {
      if ((c.minLevel ?? 0) > L) continue;
      const k = this._carKey(c, L);
      const side = (c.side || (r() < 0.5 ? 1 : -1)) * flip;
      // placement relative to the truck, resolved when the car actually spawns (squads arrive one car per few frames)
      let rel;
      if (c.at === 'park') rel = { ds: baseAhead - 40 + ai++ * 22, d: side * (HALF_ROAD - 1.7), vMul: 0.45, vAdd: 0, park: true };   // waiting on the shoulder ahead
      else if (c.at === 'ahead') {
        // a crest up the road hides whatever is behind it: they come OVER it at you (placed just beyond the blind spot)
        const crest = this._crestAhead(sim, P, 70, 240);
        const ds = crest ? crest - P.s + 12 + ai++ * 14 : baseAhead + ai++ * 16;
        rel = { ds, d: c.role === 'flanker' ? side * 4.2 : r.pick([-1.7, 1.7]), vMul: crest ? 0.9 : 0.72, vAdd: 0 };
      } else if (c.at === 'burst') rel = { ds: r.range(75, 105) + ai++ * 24, d: side * (HALF_ROAD + r.range(9, 13)), vMul: 0.85, vAdd: 0, burst: side };   // charges in from off-road
      else if (pv > 40 && r() < Math.min(1, (pv - 40) / 14)) {
        // a fast truck outruns anything spawned behind it: at speed the squad comes from up the road instead (and adapts:
        // rammers / chasers drop back through the next lane, flankers ease onto your flanks)
        rel = { ds: baseAhead + ai++ * 16, d: side * r.range(1.7, 4.6), vMul: 0.8, vAdd: 0 };
      } else rel = { ds: -baseBehind - bi++ * 14, d: c.role === 'flanker' || c.mode === 'overtake' ? side * 4.6 : r.pick(LANES), vMul: 1, vAdd: c.role === 'chaser' && !c.mode ? 8 : 14 };
      jobs.push(() => {
        const Pn = sim.player, pvn = Math.max(10, Pn.veh.vf);
        const at = { s: Pn.s + rel.ds, d: rel.d, speed: pvn * rel.vMul + rel.vAdd, park: rel.park, burst: rel.burst };
        const car = this.spawn(sim, k, L, { behavior: c.role, side, mode: c.at === 'park' ? 'ambush' : c.mode, next: c.at === 'park' ? c.role : c.next, at, gap: c.gap, squad: key });
        if (car && at.park) car.ai.parkD = at.d;
        return car;
      });
    }
    if (!jobs.length) return 0;
    const first = jobs.shift()();
    if (!first) { (this.failT || (this.failT = {}))[key] = sim.time + 8; return 0; }   // (e.g. no flat ground for an off-road burst here)
    for (const j of jobs) this.queue(j);
    sim.emit({ t: 'encounter', key, ids: [first.id], n: jobs.length + 1, level: +L.toFixed(3) });
    return jobs.length + 1;
  }

  /** First road point (s) in [P.s+a, P.s+b] that the driver can't see over a crest (road surface hidden behind a rise), or null. */
  _crestAhead(sim, P, a, b) {
    const road = sim.road, eyeY = road.sample(P.s).y + 2.2;
    let hidden = null;
    for (let ds = 30; ds <= b; ds += 10) {
      const y = road.sample(P.s + ds).y + 1.2;        // roof of a car at that point
      // line of sight from the eye to that point, checked against the road profile in between
      let blocked = false;
      for (let k = 10; k < ds; k += 10) { const yk = road.sample(P.s + k).y, yl = eyeY + (y - eyeY) * (k / ds); if (yk > yl + 0.3) { blocked = true; break; } }
      if (blocked) { hidden = P.s + ds; break; }
    }
    return hidden !== null && hidden - P.s >= a ? hidden : null;
  }

  /** Height of whatever the physics world has under (s, d) (terrain / structures), or null. */
  _groundY(sim, s, d) {
    const p = sim.road.pointAt(s, d, this._gp || (this._gp = {}));
    const ray = this._gray || (this._gray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
    ray.origin.x = p.x; ray.origin.y = p.y + 40; ray.origin.z = p.z;
    const h = sim.world.castRay(ray, 120, true, undefined, RAY_WORLD);
    return h ? p.y + 40 - h.timeOfImpact : null;
  }

  /** Near misses: a raider scraping past the truck (< ~1.5 m clearance) at speed -> {t:'nearMiss'} (run.js: a 0.6x heartbeat). */
  _nearMiss(sim, P) {
    const pv = P.veh, hwP = P.spec.width / 2, hlP = P.spec.length / 2;
    for (const c of sim.cars.values()) {
      if (c.kind !== 'enemy' || c.exploded || sim.time - (c.nearMissT ?? -9) < 3) continue;
      _v.copy(c.veh.pos).sub(pv.pos);
      if (_v.lengthSq() > 144) continue;
      const lon = _v.dot(pv.fwd), lat = Math.abs(_v.dot(pv.left));
      const clear = lat - hwP - c.spec.width / 2;
      if (Math.abs(lon) > hlP + c.spec.length / 2 - 0.5 || clear > 1.4 || clear < 0.15) continue;
      const rel = Math.abs(c.veh.vf - pv.vf);
      if (rel < 7 && !c.driverless) continue;
      c.nearMissT = sim.time;
      sim.emit({ t: 'nearMiss', id: c.id, clear: +clear.toFixed(2), rel: +rel.toFixed(1) });
      return;
    }
  }

  /** Deferred spawns: at most one new raider every ~0.13 s, so a squad never builds 3-4 car views (+ crews) in one frame. */
  queue(job) { (this.spawnQ || (this.spawnQ = [])).push(job); }
  _runQueue(sim) {
    const q = this.spawnQ; if (!q || !q.length || sim.time < (this.nextQT || 0)) return;
    this.nextQT = sim.time + 0.13;
    q.shift()();
  }

  _cleanup(sim, P) {
    for (const c of [...sim.cars.values()]) {
      if (c.kind !== 'enemy') continue;
      const behind = P.s - c.s;
      if (c.elite && !c.exploded && behind < 700) continue; // bosses stay while the fight is on
      // stragglers that can't keep up just clog the cap: cull them (the next squad will come)
      const straggler = !c.exploded && ((behind > 170 && c.veh.vf < P.veh.vf - 3 && P.veh.vf > 30) || (c.bossClear && behind > 90));
      if ((c.exploded && c.wreckT > 14 && behind > 30) || behind > 300 || straggler || c.s - P.s > 640 || (c.veh.pos.y < -80)) sim.removeCar(c, 'cleanup');
    }
  }

  // --------------------------------------------------------------------------------------------- chain reactions
  /** sim hook: a car just exploded. Neighbours cook off (staggered), runaway wrecks tumble. */
  onExplode(sim, car) {
    const p = car.veh.pos;
    const R = car.spec.explosive ? 22 : 12.5;
    const credit = car.kind === 'enemy' && (car.lastHitBy === 1 && sim.time - car.lastHitT < 12);
    // wrecks keep their momentum and roll instead of hopping in place
    const m = car.veh.mass, s = (this.r ? this.r() : Math.random()) < 0.5 ? 1 : -1;
    _v.copy(car.veh.fwd).multiplyScalar(m * (2.5 + Math.min(4, car.veh.speed * 0.12)) * s);
    car.veh.body.applyTorqueImpulse({ x: _v.x, y: _v.y, z: _v.z }, true);
    // ... and get flung toward the nearer roadside instead of stopping dead in a lane
    // (harder the faster it was going: at 200 km/h a wreck left in the lane is a wall you meet a second later)
    const sm = sim.road.sample(car.s), side = car.d >= 0 ? 1 : -1, push = m * (4 + (this.r ? this.r() : 0.5) * 3 + Math.min(8, car.veh.speed * 0.14));
    car.veh.body.applyImpulse({ x: sm.nx * side * push, y: 0, z: sm.nz * side * push }, true);
    for (const o of sim.cars.values()) {
      if (o === car || o.exploded || o.kind !== 'enemy') continue;
      const d = o.veh.pos.distanceTo(p);
      if (d > R) continue;
      const f = 1 - d / R;
      if (credit) { o.lastHitBy = 1; o.lastHitT = sim.time; }
      if (o.elite) { sim.damageCar(o, o.maxHp * 0.06 * f, { cause: 'blast', src: credit ? 1 : car.id }); continue; }
      // close neighbours cook off a beat later (a rolling chain reads better than one simultaneous flash)
      const roll = this.r ? this.r() : Math.random();
      if (f > 0.45 || roll < f * 1.4) {
        if (o.fuseT < 0) { o.fuseT = 0.18 + (1 - f) * 0.55 + roll * 0.2; o.chainFrom = car.id; sim.emit({ t: 'fuelLeak', id: o.id }); }
      } else if (o.burning <= 0) { o.burning = 0.001; sim.emit({ t: 'fire', id: o.id }); }
      // the blast rattles the driver: sometimes that is enough to lose it
      if (f > 0.25 && o.crew.driver.alive && roll < 0.35 + f * 0.4) sim.damageCrew(o, 'driver', o.crew.driver.max * 2, { cause: 'blast', src: credit ? 1 : car.id });
    }
  }

  /** sim hook: two cars collided hard. Runaway (driverless) cars and burning wrecks take the other car with them. */
  onCrash(sim, car, other, dv) {
    if (!other) return;
    // a raider that MEANT to hit you (ram / swipe / crush) hits harder than the physics alone says: upgraded trucks still feel it
    if (car.kind === 'player' && other.kind === 'enemy' && other.ai?.atk && other.ai.atk.kind !== 'brake' && other.ai.atk.phase !== 'line' && dv > 1.2 && sim.time - (other.ramHitT ?? -9) > 0.6) {
      other.ramHitT = sim.time;
      const k = other.elite ? 0.016 : 0.004 + 0.004 * Math.min(this.level, 1);
      sim.damageCar(car, car.maxHp * Math.min(k * dv, other.elite ? 0.06 : 0.03), { cause: 'ram', src: other.id });
      return;
    }
    if (car.kind !== 'enemy' || car.exploded) return;
    if (other.kind === 'player' && car.ai) { car.ai.onContact?.(); return; }
    const chaos = other.driverless || other.exploded;
    if (!chaos || dv < 1.6) return;
    const credit = (other.lastHitBy === 1 && sim.time - other.lastHitT < 12) || other.driverless;
    if (credit) { car.lastHitBy = 1; car.lastHitT = sim.time; }
    const k = clamp((dv - 1.2) / 5, 0, 1);
    if (car.elite) { sim.damageCar(car, car.maxHp * 0.05 * k, { cause: 'crash', src: credit ? 1 : other.id }); return; }
    const roll = this.r ? this.r() : Math.random();
    // big hits blow up, medium ones kill / stun the driver (the chain continues), small ones set it smoking
    if (dv > 5.5 && roll < 0.55) { if (car.fuseT < 0) { car.fuseT = 0.25 + roll * 0.4; sim.emit({ t: 'fuelLeak', id: car.id }); } }
    else if (roll < 0.45 + k * 0.4 && car.crew.driver.alive) sim.damageCrew(car, 'driver', car.crew.driver.max * 2, { cause: 'crash', src: credit ? 1 : other.id });
    else sim.damageCar(car, car.maxHp * (0.2 + 0.35 * k), { cause: 'crash', src: credit ? 1 : other.id });
    if (dv > 3.5 && !car.rolledChain) {
      car.rolledChain = true;
      const m = car.veh.mass; _v.copy(car.veh.fwd).multiplyScalar(m * (1.5 + k * 3) * (roll < 0.5 ? 1 : -1));
      car.veh.body.applyTorqueImpulse({ x: _v.x, y: _v.y, z: _v.z }, true);
    }
  }

  // --------------------------------------------------------------------------------------------- minibosses + boss
  _bosses(sim, P, L) {
    // minibosses: one per biome, just before the biome ends
    for (let i = 0; i < MINIBOSSES.length; i++) {
      const M = MINIBOSSES[i];
      if (this.minibossDone.has(i) || P.s < M.s - 150 || P.s > M.s + 2500) continue;
      if (sim.ground && sim.ground.hasColliderAt && !sim.ground.hasColliderAt(P.s + 260)) continue;
      this.minibossDone.add(i);
      this.spawnElite(sim, i, M, L);
    }
    if (this.activeElite) {
      const E = this.activeElite;
      const cars = E.cars.filter((c) => sim.cars.has(c.id));
      const alive = cars.filter((c) => !c.exploded);
      E.hp01 = cars.reduce((a, c) => a + Math.max(0, c.hp), 0) / E.maxHp;
      // a warlord whose driver is dead crashes and burns
      for (const c of alive) if (c.driverless && c.fuseT < 0 && !c.eliteDoom) { c.eliteDoom = true; c.fuseT = 2.2; c.lastHitBy = 1; c.lastHitT = sim.time; sim.emit({ t: 'fuelLeak', id: c.id }); }
      if (!alive.length) { sim.emit({ t: 'minibossDown', index: E.index, name: E.name }); this.activeElite = null; }
      else if (alive.every((c) => P.s - c.s > 600)) { sim.emit({ t: 'minibossLost', index: E.index, name: E.name }); this.activeElite = null; } // outran it
    }
    // the Leviathan waits on the dam road
    if (!sim.boss && !this.bossSpawned && P.s > BOSS_S - 700) {
      if (sim.ground && sim.ground.hasColliderAt && !sim.ground.hasColliderAt(P.s + 300)) return;
      this.bossSpawned = true;
      sim.boss = new Leviathan(sim, P.s + 320, 0);
      sim.emit({ t: 'bossSpawn', id: sim.boss.id });
      for (const c of sim.cars.values()) if (c.kind === 'enemy' && !c.exploded && !c.elite) c.bossClear = true;
      // the last supply cache before the war-train: the fight starts fair however battered the truck arrived
      const before = P.hp; P.hp = P.maxHp;
      for (const c of Object.values(P.crew)) if (c && c.alive) c.hp = c.max;
      P.fuelHp = Math.max(P.fuelHp, P.maxHp * 0.6); P.engineHp = Math.max(P.engineHp, 100 + P.maxHp * 0.4); P.veh.engineDamage = 0;
      sim.emit({ t: 'repair', id: P.id, amount: P.hp - before, big: true, supply: true });
    }
  }

  spawnElite(sim, index, M, L) {
    const cars = [];
    const P = sim.player, pv = Math.max(12, P.veh.vf);
    const Le = Math.max(L, 0.3);
    for (let k = 0; k < (M.count || 1); k++) {
      const side = k === 0 ? 1 : -1;
      // warlords make an entrance: from behind at speed (rammers/flankers) or waiting up the road (leaders/droppers)
      const ahead = M.enter === 'ahead', park = M.enter === 'park';
      // (if the spot is blocked — roadblock, ramp, no ground yet — slide it along the road a little)
      let c = null;
      for (const shift of [0, 40, -40, 80]) {
        const at = park ? { s: P.s + 210 + k * 26 + shift, d: side * (HALF_ROAD - 1.7), speed: pv * 0.45 } : ahead ? { s: P.s + 250 + k * 18 + shift, d: side * 1.7, speed: pv * 0.75 } : { s: P.s - 120 - k * 10 - Math.abs(shift) * 0.5, d: side * 4.6, speed: pv + 12 };
        c = this.spawn(sim, M.spec, Le, { behavior: M.behavior, side, at, mode: park ? 'ambush' : undefined, next: park ? M.behavior : undefined, elite: { index, name: M.name, hpMul: M.hpMul, massMul: M.massMul, armor: M.armor, gun: M.gun, gun2: M.gun2, weak: M.weak }, pattern: { ...(M.pattern || {}) } });
        if (c) { if (park) c.ai.parkD = at.d; break; }
      }
      if (c) cars.push(c);
    }
    // nobody made it onto the road: try again next tick (and do NOT spawn the escorts, or they pile up every frame)
    if (!cars.length) { this.minibossDone.delete(index); return; }
    if (cars.length === 2) { cars[0].ai.pattern.partner = cars[1]; cars[1].ai.pattern.partner = cars[0]; }
    (M.escorts || []).forEach((e, i) => this.queue(() => { const Pn = sim.player; return this.spawn(sim, e, L, { behavior: i % 2 ? 'flanker' : 'chaser', side: i % 2 ? 1 : -1, at: { s: Pn.s - 150 - i * 14, d: (i % 2 ? 1 : -1) * 3.4, speed: Math.max(12, Pn.veh.vf) + 10 } }); }));
    this.activeElite = { index, name: M.name, cars, maxHp: cars.reduce((a, c) => a + c.maxHp, 0), hp01: 1 };
    sim.emit({ t: 'minibossSpawn', index, name: M.name, title: M.title || '', ids: cars.map((c) => c.id), weak: M.weak?.label || '' });
  }

  /** Spawn at an explicit road position (boss ramp drops). */
  spawnAt(sim, key, s, d, speed, o = {}) { const L = sim.boss && !sim.boss.dead ? Math.min(this.level, 0.88) : this.level; return this.spawn(sim, key, Math.max(L, 0.5), { ...o, at: { s, d, speed } }); } // (boss escorts: distance level only)

  /** Spawn an enemy. o: {behavior, side, mode, next, gap, at:{s,d,speed}, elite, pattern} */
  spawn(sim, key, L, o = {}) {
    const P = sim.player, def = ENEMIES[key], r = this.r || (this.r = rng(sim.seed * 31 + 5));
    const behavior = o.behavior || r.pick(def.behaviors);
    const ahead = behavior === 'blocker' || behavior === 'dropper';
    const s = o.at ? o.at.s : P.s + (ahead ? r.range(240, 330) : -r.range(120, 190));
    if (sim.ground && sim.ground.hasColliderAt && !sim.ground.hasColliderAt(s)) return false;
    // never drop a car into a roadblock / onto a ramp
    if (sim.road.featuresIn(s - 22, s + 22).some((f) => f.type === 'roadblock' || f.type === 'ramp')) return false;
    const lane = o.at ? o.at.d : o.lane ?? r.pick(LANES);
    const pv = Math.max(8, P.veh.vf);
    // tune the enemy so it can actually keep up with the player's truck as the game goes on
    const base = VEHICLES[def.spec];
    // raiders are always a little faster than the player's truck: you can't just outrun them, you have to fight
    // (a clear margin: leaders and flankers have to be able to hold a slot AHEAD of a truck that is flat out)
    const want = Math.max(base.engine.vmax, this.playerVmax * (1.12 + 0.06 * L) + (behavior === 'rammer' ? 3 : 0));
    const k = clamp(want / base.engine.vmax, 1, 2.5);
    // ... and they corner like the player's truck does (tyre upgrades included), or a fast truck simply leaves them in the ditch
    const pg = P.spec.grip, gm = (x, y) => Math.max(x, y) * 1.04;
    const grip = { ...base.grip, front: gm(base.grip.front, pg.front), rear: gm(base.grip.rear, pg.rear) };
    const spec = { ...base, grip, engine: { ...base.engine, vmax: base.engine.vmax * k, accel0: base.engine.accel0 * Math.pow(k, 0.85) * 1.12 }, susp: base.susp, nitro: { capacity: behavior === 'rammer' || o.elite ? 3 : 1.5, regen: 0.35, mul: 1.6 } };
    if (o.elite) spec.mass = base.mass * (o.elite.massMul ?? 1.5); // warlords are armour-plated: they shove you around
    let yawOff = 0, groundY = null;
    if (o.at?.burst) {
      // off-road entry: only where the ground out there is roughly level with the road (no cliffs / canyon walls / structures)
      groundY = this._groundY(sim, s, lane);
      const roadY = sim.road.surfaceY(sim.road.sample(s), Math.sign(lane) * HALF_ROAD);
      const midY = this._groundY(sim, s + 6, lane * 0.7);
      if (groundY === null || midY === null || Math.abs(groundY - roadY) > 1.4 || Math.abs(midY - roadY) > 1.4) return false;
      yawOff = -Math.sign(lane) * 0.55;   // angled in toward the road (+X is left: a car on the left turns right)
    }
    const car = sim.spawnCar(def.spec, { spec, s, d: lane, speed: o.at ? o.at.speed : ahead ? pv * 0.7 : pv * 0.95 + 5, kind: 'enemy', yawOff });
    if (groundY !== null) {
      const t = car.veh.body.translation(), th = sim.road.sample(s).th + yawOff, sp = o.at.speed;
      car.veh.body.setTranslation({ x: t.x, y: groundY + car.veh.restComHeight + 0.35, z: t.z }, true);
      car.veh.body.setLinvel({ x: Math.sin(th) * sp, y: 0, z: Math.cos(th) * sp }, true);   // moving the way it points
    }
    const hpMul = 1 + 1.9 * L;
    car.tag = def.label; car.maxHp = car.hp = Math.round(base.hp * hpMul); car.armor = clamp(0.08 * L * 2, 0, 0.35);
    const el = o.elite;
    if (el) {
      car.elite = el; car.maxHp = car.hp = Math.round(base.hp * hpMul * el.hpMul); car.armor = el.armor ?? car.armor; car.tag = el.name;
      car.fuelHp = car.engineHp = 1e9; // no instant cook-off: the weak point is how you kill a warlord
      spec.crashMul = 0.3;              // armoured: rams and pile-ups barely dent it
      if (el.weak) {
        car.zoneMul = { [el.weak.zone]: el.weak.mul, body: 0.6, tire: 0.5 };
        // for aiming helpers (AI gunner, aim assist): the weak zone's centre in the model frame
        const z = car.zones.find((q) => q.kind === el.weak.zone); car.weakPoint = z ? { zone: el.weak.zone, c: z.c.slice() } : null;
      }
    }
    const crewMul = 1 + 0.7 * L;
    for (const role of Object.keys(car.crew)) { const c = car.crew[role]; c.hp = c.max = Math.round(c.max * crewMul); }
    const gunName = el?.gun || (L > 0.55 && def.gunLate ? def.gunLate : r.pick(def.guns.length ? def.guns : ['pistol']));
    const guns = {};
    if (car.crew.gunner && (def.guns.length || el?.gun)) guns.gunner = ENEMY_GUNS[gunName];
    if (car.crew.gunner2 && (def.guns.length || el?.gun2)) guns.gunner2 = ENEMY_GUNS[el?.gun2 || r.pick(def.guns)];
    // warlord crews sit behind armour: the driver is nearly untouchable (the weak point is how you win), the gunners can be silenced
    if (el) for (const role of Object.keys(car.crew)) { const c = car.crew[role]; c.hp = c.max = Math.round(c.max * (role === 'driver' ? 6 : 2.5)); c.armor = role === 'driver' ? 0.92 : 0.45; }
    car.ai = new EnemyBrain(car, sim, { behavior, side: o.side, mode: o.mode, next: o.next, pattern: o.pattern, skill: clamp(def.skill + 0.25 * L + (el ? 0.15 : 0), 0.2, 0.95), level: L, guns, gap: o.gap });
    car.gunName = ENEMY_GUNS[gunName]?.model || gunName; // (what the crew view shows / snapshots carry)
    if (o.at?.burst) { car.ai.launchT = 0; car.ai._tell('burst'); sim.emit({ t: 'horn', id: car.id }); }   // floors it out of the scrub, nitro, horn
    this.spawned++;
    sim.emit({ t: 'enemySpawn', id: car.id, spec: def.spec, label: def.label, behavior, elite: el ? el.index + 1 : 0 });
    return car;
  }
}

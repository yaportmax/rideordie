// Difficulty director: decides what spawns, where and when. Level L (0..1+) follows distance to the boss, plus a little run time.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, rng } from '../core/util.js';
import { ENEMIES, ENEMY_KEYS, ENEMY_GUNS } from '../data/enemies.js';
import { VEHICLES } from '../data/vehicles.js';
import { BOSS_S, biomeAt } from '../data/biomes.js';
import { EnemyBrain } from './ai.js';

const LANES = [-5.0, -1.7, 1.7, 5.0];

export function levelAt(s, t) { return clamp(0.86 * (s / BOSS_S) + 0.14 * Math.min(1, t / 1500), 0, 1.25); }

export class Director {
  constructor(opts = {}) {
    this.budget = 0.5; this.r = null; this.timeSinceSpawn = 0; this.cooldown = 2.5;
    this.level = 0; this.opts = opts;
    this.spawned = 0; this.enabled = true;
    this.pulse = 0;
    this.playerVmax = 40;
    this.minibossDone = new Set();
    this.disabled = new Set();
  }

  update(dt, sim) {
    const P = sim.player;
    if (!P || sim.state !== 'run' || !this.enabled) return;
    if (!this.r) { this.r = rng(sim.seed * 31 + 5); this.playerVmax = P.spec.engine.vmax; }
    const L = this.level = levelAt(P.s, sim.time);
    sim.enemyDamageMul = 0.7 + 0.9 * L;
    // accumulate budget with a slow pulse (waves and lulls)
    this.pulse += dt * (0.5 + 0.2 * L);
    const wave = 0.55 + 0.75 * (0.5 + 0.5 * Math.sin(this.pulse));
    this.budget += dt * (0.30 + 1.9 * Math.pow(L, 0.9)) * wave * (this.opts.rate ?? 1);
    this.timeSinceSpawn += dt;
    this.cooldown -= dt;
    const alive = [];
    for (const c of sim.cars.values()) if (c.kind === 'enemy' && !c.exploded) alive.push(c);
    const cap = Math.round(2 + 13 * Math.pow(L, 0.75)) + (this.opts.capBonus || 0);
    // cleanup
    for (const c of [...sim.cars.values()]) {
      if (c.kind !== 'enemy') continue;
      const behind = P.s - c.s;
      if ((c.exploded && c.wreckT > 14 && behind > 30) || behind > 380 || c.s - P.s > 640 || (c.veh.pos.y < -80)) sim.removeCar(c, 'cleanup');
    }
    if (this.cooldown > 0 || alive.length >= cap) return;
    // pick an archetype we can afford and that has unlocked
    const options = ENEMY_KEYS.filter((k) => ENEMIES[k].minLevel <= L && ENEMIES[k].cost <= this.budget && !this.disabled.has(k));
    if (!options.length) return;
    let total = 0; const w = options.map((k) => { const e = ENEMIES[k]; const x = e.weight * (1 + (L - e.minLevel) * 0.6); total += x; return x; });
    let pick = this.r() * total, key = options[0];
    for (let i = 0; i < options.length; i++) { pick -= w[i]; if (pick <= 0) { key = options[i]; break; } }
    if (this.spawn(sim, key, L)) { this.budget -= ENEMIES[key].cost; this.cooldown = lerp(3.4, 0.9, Math.min(1, L * 1.2)) * (0.7 + 0.6 * this.r()); }
  }

  /** Spawn an enemy relative to the player. */
  spawn(sim, key, L, o = {}) {
    const P = sim.player, def = ENEMIES[key], r = this.r;
    let behavior = o.behavior || r.pick(def.behaviors);
    const ahead = behavior === 'blocker';
    const s = P.s + (ahead ? r.range(240, 330) : -r.range(150, 230));
    if (sim.ground && sim.ground.hasColliderAt && !sim.ground.hasColliderAt(s)) return false;
    const lane = r.pick(LANES);
    const pv = Math.max(8, P.veh.vf);
    // tune the enemy so it can actually keep up with the player's truck as the game goes on
    const base = VEHICLES[def.spec];
    const want = Math.max(base.engine.vmax, this.playerVmax * (0.9 + 0.1 * L) + (behavior === 'rammer' ? 4 : 0));
    const k = clamp(want / base.engine.vmax, 1, 1.75);
    const spec = k > 1.001 ? { ...base, engine: { ...base.engine, vmax: base.engine.vmax * k, accel0: base.engine.accel0 * Math.pow(k, 0.85) }, susp: base.susp } : base;
    const hpMul = 1 + 1.9 * L;
    const car = sim.spawnCar(def.spec, { spec, s, d: lane, speed: ahead ? pv * 0.7 : pv * 0.95 + 5, kind: 'enemy' });
    car.tag = def.label; car.maxHp = car.hp = Math.round(base.hp * hpMul); car.armor = clamp(0.08 * L * 2, 0, 0.35);
    const crewMul = 1 + 0.7 * L;
    for (const role of Object.keys(car.crew)) { const c = car.crew[role]; c.hp = c.max = Math.round(c.max * crewMul); }
    const gunName = L > 0.55 && def.gunLate ? def.gunLate : r.pick(def.guns.length ? def.guns : ['pistol']);
    const guns = {};
    if (car.crew.gunner && def.guns.length) guns.gunner = ENEMY_GUNS[gunName];
    if (car.crew.gunner2 && def.guns.length) guns.gunner2 = ENEMY_GUNS[r.pick(def.guns)];
    if (car.crew.gunner) car.crew.gunner.aimYaw = P.veh.pos.x !== undefined ? 0 : 0;
    car.ai = new EnemyBrain(car, sim, { behavior, skill: clamp(def.skill + 0.25 * L, 0.2, 0.95), level: L, guns, gap: o.gap });
    car.gunName = gunName;
    this.spawned++;
    sim.emit({ t: 'enemySpawn', id: car.id, spec: def.spec, label: def.label, behavior });
    return car;
  }
}

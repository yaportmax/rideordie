// THE LEVIATHAN: a 36 m kinematic war-train that drives the dam road. Part-based damage, three phases, many attacks.
// Kinematic body => it shoves cars around; it is steered along the road, so it never flips or gets stuck.
import * as THREE from 'three';
import { RAPIER, GROUPS } from './physics.js';
import { rayBox } from './car.js';
import { BOSS, BOSS_ID, BOSS_PARTS, PART_NAMES, BOSS_SOCKETS, BOSS_BODY, bossZones } from '../data/boss.js';
import { clamp, lerp, rng, wrapAngle } from '../core/util.js';

const V3 = THREE.Vector3;
const _o = new V3(), _d = new V3(), _p = new V3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _t = new V3();
const _sm = {}, _sm2 = {};

/** Shared by the sim boss and the client-side ghost: raycast the boss parts at a pose. */
export function raycastBoss(b, origin, dir, maxDist) {
  _qi.copy(b.quat).invert();
  _o.copy(origin).sub(b.pos).applyQuaternion(_qi);
  _d.copy(dir).applyQuaternion(_qi);
  let best = null;
  for (const z of b.zones) {
    if (z.kind !== 'body') {
      if (!b.alive[z.kind]) continue;
    }
    const t = rayBox(_o, _d, z.c, z.h);
    if (t < 0 || t > maxDist) continue;
    // parts sitting on the body win if they are within 0.4 m of the body entry
    if (!best || t < best.t - (z.kind === 'body' ? 0.4 : 0) || (best.zone.kind === 'body' && z.kind !== 'body' && t < best.t + 0.4)) best = { t, zone: z };
  }
  if (!best) return null;
  best.point = new V3().copy(origin).addScaledVector(dir, best.t); best.car = b; best.throughBody = false;
  return best;
}

export class Leviathan {
  constructor(sim, s0, d0 = 0) {
    this.sim = sim; this.id = BOSS_ID; this.kind = 'boss'; this.isBoss = true;
    this.s = s0; this.d = d0; this.v = 26; this.dTarget = d0;
    this.pos = new V3(); this.quat = new THREE.Quaternion(); this.vel = new V3();
    this.zones = bossZones();
    this.hp = {}; this.alive = {}; this.maxCore = 0;
    for (const n of PART_NAMES) { this.hp[n] = BOSS_PARTS[n].hp; this.alive[n] = true; if (BOSS_PARTS[n].core) this.maxCore += BOSS_PARTS[n].hp; }
    this.phase = 1; this.t = 0; this.dead = false; this.deathT = 0; this.exploded = false;
    this.r = rng(sim.seed * 13 + 777);
    this.cd = { pods: 6, cannon: 99, ramp: 99, charge: 0 };
    this.turrets = ['part_turret_1', 'part_turret_2'].map((n, i) => ({ part: n, socket: 'turret_' + (i + 1), yaw: 0, pitch: 0, mode: 'idle', t: 1 + i, burst: 0, fireT: 0 }));
    this.podQueue = [];
    this.flameOn = { L: false, R: false };
    // kinematic body
    this._pose(0);
    this.body = sim.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y, this.pos.z).setRotation(this.quat));
    for (const b of BOSS_BODY) {
      sim.world.createCollider(RAPIER.ColliderDesc.cuboid(b.half[0], b.half[1], b.half[2]).setTranslation(b.center[0], b.center[1], b.center[2]).setCollisionGroups(GROUPS.car).setFriction(0.4).setRestitution(0.1), this.body);
    }
    this.veh = { pos: this.pos, quat: this.quat, vel: this.vel, restComHeight: 0 }; // car-like fields used by some helpers
  }

  /** World point of a model-frame position. */
  local(p, out = new V3()) { return out.set(p[0], p[1], p[2]).applyQuaternion(this.quat).add(this.pos); }
  socket(name, out = new V3()) { const s = BOSS_SOCKETS[name]; return s ? this.local(s, out) : out.copy(this.pos); }

  _pose(dt) {
    const road = this.sim.road;
    const front = road.sample(this.s + 12, _sm), back = road.sample(this.s - 12, _sm2);
    const fx = front.x + front.nx * this.d, fz = front.z + front.nz * this.d, bx = back.x + back.nx * this.d, bz = back.z + back.nz * this.d;
    const fy = road.surfaceY(front, this.d), by = road.surfaceY(back, this.d);
    const yaw = Math.atan2(fx - bx, fz - bz), pitch = -Math.atan2(fy - by, Math.hypot(fx - bx, fz - bz));
    const prev = _t.copy(this.pos);
    this.pos.set((fx + bx) / 2, (fy + by) / 2 + 0.02, (fz + bz) / 2);
    this.quat.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    if (dt > 0) this.vel.copy(this.pos).sub(prev).multiplyScalar(1 / dt);
  }

  coreHp01() { let h = 0; for (const n of PART_NAMES) if (BOSS_PARTS[n].core) h += Math.max(0, this.hp[n]); return h / this.maxCore; }

  update(dt) {
    const sim = this.sim, P = sim.player;
    this.t += dt;
    if (this.dead) { this._dying(dt); return; }
    // ---- movement: keep station ahead of the player; ram if the player gets in front
    const gap = this.s - (P ? P.s : this.s);
    const pv = P ? Math.max(0, P.veh.vf) : 20;
    let vDes;
    const station = this.phase === 1 ? BOSS.gapPhase1 : BOSS.gapPhase2;
    if (gap < BOSS.rammingGap) vDes = pv + 9;                    // player overtook us: charge
    else vDes = pv + clamp((station - gap) * 0.35, -8, 10);
    if (gap > 180) vDes = Math.min(vDes, 18);                     // wait up for a player who fell behind
    vDes = clamp(vDes, BOSS.speedMin * (P && P.exploded ? 0 : 1), this.phase === 3 ? BOSS.speedMax3 : BOSS.speedMax);
    this.v += clamp(vDes - this.v, -6 * dt, 4 * dt);
    this.s += this.v * dt;
    // weave toward the player's lane in phase 3, otherwise hold the middle
    if (P) this.dTarget = this.phase === 3 ? clamp(P.d, -3, 3) : clamp(Math.sin(this.t * 0.07) * 2, -2, 2);
    this.d += clamp(this.dTarget - this.d, -1.2 * dt, 1.2 * dt);
    this._pose(dt);
    this.body.setNextKinematicTranslation(this.pos);
    this.body.setNextKinematicRotation(this.quat);
    if (!P || P.exploded) return;
    // ---- phases
    const weaponsLeft = ['part_turret_1', 'part_turret_2', 'part_pod_L', 'part_pod_R'].filter((n) => this.alive[n]).length;
    if (this.phase === 1 && (weaponsLeft <= 1 || this.t > 100)) this._setPhase(2);
    if (this.phase < 3 && this.engineExposed()) this._setPhase(3);
    const rate = this.phase === 3 ? 1.35 : 1;
    // ---- attacks
    for (const tu of this.turrets) this._turret(tu, dt * rate, P);
    this._pods(dt * rate, P);
    if (this.phase >= 2) { this._cannon(dt * rate, P); this._flames(dt, P); this._ramp(dt * rate, P); }
  }

  engineExposed() { return !this.alive.panel_armor_rear_1 && !this.alive.panel_armor_rear_2 && !this.alive.panel_armor_rear_3; }

  _setPhase(p) {
    this.phase = p;
    if (p === 2) { this.cd.cannon = 3; this.cd.ramp = 4; }
    this.sim.emit({ t: 'bossPhase', phase: p });
  }

  _aimAt(P, muzzle, speed, out) {
    // lead the target: aim at the truck bed / cab, compensate our own velocity
    const target = _t.copy(P.veh.pos); target.y += 0.8;
    const dist = target.distanceTo(muzzle), tFly = dist / speed;
    target.addScaledVector(P.veh.vel, tFly * 0.85).addScaledVector(this.vel, -tFly * 0.85);
    return out.copy(target).sub(muzzle).normalize();
  }

  _turret(tu, dt, P) {
    if (!this.alive[tu.part]) return;
    const G = BOSS.turret;
    const muzzle = this.socket(tu.socket, _p); muzzle.y += 1.3;
    const dist = muzzle.distanceTo(P.veh.pos);
    tu.t -= dt;
    if (tu.mode === 'idle') { if (tu.t <= 0 && dist < G.range) { tu.mode = 'burst'; tu.burst = this.r.int(G.burst[0], G.burst[1]); tu.fireT = 0; } return; }
    tu.fireT -= dt;
    while (tu.fireT <= 0 && tu.burst > 0) {
      const dir = this._aimAt(P, muzzle, G.speed, _d);
      const sp = G.spread * Math.PI / 180;
      dir.x += (this.r() - 0.5) * sp * 2; dir.y += (this.r() - 0.5) * sp; dir.z += (this.r() - 0.5) * sp * 2; dir.normalize();
      this.sim.projectiles.addBullet(muzzle, dir, G.speed, G.dmg * (1 + 0.3 * (this.phase - 1)), this.id, 'boss', 1.6);
      this.sim.emit({ t: 'shot', src: this.id, weapon: 'enemy', heavy: true, origin: muzzle.toArray(), rays: [dir.toArray()], speed: G.speed, pellets: 1 });
      tu.burst--; tu.fireT += 1 / G.rate;
    }
    if (tu.burst <= 0) { tu.mode = 'idle'; tu.t = this.r.range(G.pause[0], G.pause[1]); }
  }

  _pods(dt, P) {
    const C = BOSS.pods;
    for (let i = this.podQueue.length - 1; i >= 0; i--) {
      const q = this.podQueue[i]; q.t -= dt;
      if (q.t > 0) continue;
      this.podQueue.splice(i, 1);
      if (!this.alive[q.part]) continue;
      const m = this.socket(q.socket, _p); m.y += 1;
      const dir = this._aimAt(P, m, C.speed, _d);
      dir.x += (this.r() - 0.5) * C.spread; dir.y += 0.04 + (this.r() - 0.5) * C.spread * 0.5; dir.z += (this.r() - 0.5) * C.spread; dir.normalize();
      this.sim.projectiles.addRocket(m.clone(), dir.clone(), { speed: C.speed, blast: C.blast, blastDmg: C.blastDmg, direct: 30 }, this.id);
      this.sim.emit({ t: 'shot', src: this.id, weapon: 'rpg', origin: m.toArray(), dir: dir.toArray(), rocket: true, speed: C.speed });
    }
    this.cd.pods -= dt;
    if (this.cd.pods > 0) return;
    this.cd.pods = this.r.range(C.every[0], C.every[1]);
    const pods = [['part_pod_L', 'rocket_pod_L'], ['part_pod_R', 'rocket_pod_R']].filter(([p]) => this.alive[p]);
    if (!pods.length) return;
    for (let k = 0; k < C.rockets; k++) { const [part, socket] = pods[k % pods.length]; this.podQueue.push({ part, socket, t: k * C.interval }); }
    this.sim.emit({ t: 'bossVolley', pos: this.pos.toArray() });
  }

  _cannon(dt, P) {
    if (!this.alive.part_turret_main) return;
    const C = BOSS.cannon;
    if (this.cd.charge > 0) {
      this.cd.charge -= dt;
      if (this.cd.charge <= 0) {
        const m = this.socket('muzzle_main', _p);
        const dir = this._aimAt(P, m, C.speed, _d);
        this.sim.projectiles.addRocket(m.clone(), dir.clone(), { speed: C.speed, blast: C.blast, blastDmg: C.blastDmg, direct: 60 }, this.id);
        this.sim.emit({ t: 'shot', src: this.id, weapon: 'cannon', origin: m.toArray(), dir: dir.toArray(), rocket: true, speed: C.speed, heavy: true });
        this.sim.emit({ t: 'bossCannon', pos: m.toArray() });
      }
      return;
    }
    this.cd.cannon -= dt;
    if (this.cd.cannon <= 0) { this.cd.cannon = this.r.range(C.every[0], C.every[1]); this.cd.charge = C.charge; this.sim.emit({ t: 'bossCharge', pos: this.socket('muzzle_main', _p).toArray() }); }
  }

  _flames(dt, P) {
    for (const side of ['L', 'R']) {
      const part = side === 'L' ? 'part_tank_L' : 'part_tank_R'; // flamers are fed by the side tanks
      if (!this.alive[part]) { this.flameOn[side] = false; continue; }
      const m = this.socket('flame_' + side, _p);
      const rel = _t.copy(P.veh.pos).sub(m);
      const dist = rel.length();
      // the jets point sideways (+X = left): only a truck alongside that flank gets burnt
      _o.set(side === 'L' ? 1 : -1, 0, 0).applyQuaternion(this.quat);
      const out = rel.dot(_o), along = Math.abs(rel.dot(_d.set(0, 0, 1).applyQuaternion(this.quat)));
      const on = out > 0.5 && out < BOSS.flame.range && along < 7;
      if (on !== this.flameOn[side]) { this.flameOn[side] = on; this.sim.emit({ t: 'bossFlame', side, on, pos: m.toArray() }); }
      if (on) {
        const k = 1 - out / BOSS.flame.range;
        this.sim.damageCar(P, BOSS.flame.dps * k * dt * 0.6, { cause: 'fire', src: this.id });
        for (const role of ['driver', 'gunner']) if (P.crew[role]?.alive && Math.random() < dt * 2) this.sim.damageCrew(P, role, BOSS.flame.dps * k * 0.2, { cause: 'fire', src: this.id });
      }
    }
  }

  _ramp(dt, P) {
    this.cd.ramp -= dt;
    if (this.cd.ramp > 0) return;
    this.cd.ramp = this.r.range(BOSS.ramp.every[0], BOSS.ramp.every[1]);
    const alive = [...this.sim.cars.values()].filter((c) => c.kind === 'enemy' && !c.exploded).length;
    if (alive > 6) return;
    const key = this.r.pick(BOSS.ramp.cars);
    this.sim.emit({ t: 'bossRamp', pos: this.socket('ramp_rear', _p).toArray() });
    this.sim.director.spawnAt(this.sim, key, this.s - 24, this.d, this.v - 2, { behavior: 'chaser' });
  }

  /** Damage from a bullet/explosion to a part (or 'body'). Returns damage dealt. */
  damage(zoneKind, dmg, info = {}) {
    if (this.dead || zoneKind === 'body' || !this.alive[zoneKind]) { if (zoneKind === 'body') this.sim.emit({ t: 'bossDeflect', pos: info.point ? info.point.toArray?.() || info.point : this.pos.toArray() }); return 0; }
    const def = BOSS_PARTS[zoneKind];
    if (def.invulnerable) return 0;
    if (def.needs && def.needs.some((n) => this.alive[n])) return 0; // reactor behind armour
    const mul = def.weak ? 1.6 : 1;
    this.hp[zoneKind] -= dmg * mul;
    this.lastHitT = this.sim.time;
    if (this.hp[zoneKind] <= 0) this._destroyPart(zoneKind);
    return dmg * mul;
  }

  _destroyPart(n) {
    this.alive[n] = false; this.hp[n] = 0;
    const def = BOSS_PARTS[n];
    const zone = this.zones.find((z) => z.kind === n);
    const p = zone ? this.local(zone.c) : this.pos.clone();
    this.sim.emit({ t: 'bossPart', part: n, label: def.label || '', pos: p.toArray(), explodes: !!def.explodes });
    if (def.explodes) {
      this.sim.emit({ t: 'boom', pos: p.toArray(), radius: BOSS.tankBlast.radius, kind: 'tank' });
      this.sim.blast(p, BOSS.tankBlast.radius, BOSS.tankBlast.dmg, 1.2, null, this.id);
      // chunk out of the engine
      if (this.alive.part_engine) this.hp.part_engine -= BOSS_PARTS.part_engine.hp * BOSS.tankBlast.coreDmg * 3;
    } else if (def.core) this.sim.emit({ t: 'boom', pos: p.toArray(), radius: 6, kind: 'part' });
    if (n === 'part_engine') this._die();
  }

  _die() {
    this.dead = true; this.deathT = 0;
    this.sim.emit({ t: 'bossDying', pos: this.pos.toArray() });
  }

  _dying(dt) {
    this.deathT += dt;
    // coast to a stop along the road while it tears itself apart
    this.v = Math.max(0, this.v - 7 * dt); this.s += this.v * dt; this._pose(dt);
    this.body.setNextKinematicTranslation(this.pos); this.body.setNextKinematicRotation(this.quat);
    const k = Math.floor(this.deathT * 3);
    if (k !== this._lastPop && this.deathT < 4) {
      this._lastPop = k;
      const z = this.r.range(-16, 16), x = this.r.range(-3, 3), y = this.r.range(2, 7);
      const p = this.local([x, y, z]);
      this.sim.emit({ t: 'explode', id: this.id, pos: p.toArray(), size: 1.6, cause: 'boss', spec: 'boss', vel: this.vel.toArray() });
    }
    if (this.deathT > 4 && !this.exploded) {
      this.exploded = true;
      this.sim.emit({ t: 'explode', id: this.id, pos: this.pos.toArray(), size: 3.5, cause: 'boss', spec: 'boss', vel: [0, 0, 0] });
      this.sim.blast(this.pos, 30, 200, 1.5, null, this.id);
      this.sim.emit({ t: 'bossDown' });
    }
  }

  raycast(o, d, max) { return raycastBoss(this, o, d, max); }

  /** Blast damage to the parts within radius (grenades/rockets/mines from the player). */
  blastParts(p, radius, dmg) {
    for (const z of this.zones) {
      if (z.kind === 'body' || !this.alive[z.kind]) continue;
      const w = this.local(z.c, _t);
      const dist = Math.max(0, w.distanceTo(p) - Math.max(z.h[0], z.h[1], z.h[2]) * 0.6);
      if (dist < radius) this.damage(z.kind, dmg * (1 - dist / radius) * 0.8, { point: w });
    }
  }

  destroy() { this.sim.world.removeRigidBody(this.body); }
}

/** Client stand-in: pose + alive mask come from snapshots. */
export class GhostBoss {
  constructor() { this.id = BOSS_ID; this.kind = 'boss'; this.isBoss = true; this.zones = bossZones(); this.pos = new V3(); this.quat = new THREE.Quaternion(); this.vel = new V3(); this.alive = {}; this.exploded = false; this.veh = { pos: this.pos, quat: this.quat, vel: this.vel, restComHeight: 0 }; for (const n of PART_NAMES) this.alive[n] = true; }
  raycast(o, d, max) { return raycastBoss(this, o, d, max); }
}

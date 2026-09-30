// Sim-side projectiles: enemy bullets (fast, visible tracers, travel time), rockets, physics grenades.
import * as THREE from 'three';
import { RAPIER, GROUPS, RAY_SHOT } from './physics.js';
import { clamp } from '../core/util.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _pv = new THREE.Vector3();

export class Projectiles {
  constructor() {
    this.bullets = []; this.rockets = []; this.grenades = [];
    this.ray = null; this.nextId = 1;
  }

  update(dt, sim) {
    if (!this.ray) this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const P = sim.player;
    // Most bullets are still travelling towards the truck. Reject segments outside
    // a conservative sphere before transforming the ray and testing every zone.
    const playerRadius = this.bullets.length && P && !P.exploded && P.raycastRadius ? P.raycastRadius() : Infinity;
    const playerRadiusSq = playerRadius * playerRadius;
    // ---- enemy bullets: swept segment vs the player's car zones + world
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      _o.set(b.x, b.y, b.z); _d.set(b.vx, b.vy, b.vz); const sp = _d.length(); _d.multiplyScalar(1 / sp);
      const step = sp * dt;
      let hit = null;
      if (P && !P.exploded) {
        if (Number.isFinite(playerRadius)) {
          _pv.copy(P.veh.pos).sub(_o);
          const along = clamp(_pv.dot(_d), 0, step);
          if (_pv.addScaledVector(_d, -along).lengthSq() <= playerRadiusSq) hit = P.raycast(_o, _d, step, null);
        } else hit = P.raycast(_o, _d, step, null);
      }
      let worldT = step + 1;
      if (b.life < b.maxLife - 0.03) {
        this.ray.origin.x = _o.x; this.ray.origin.y = _o.y; this.ray.origin.z = _o.z; this.ray.dir.x = _d.x; this.ray.dir.y = _d.y; this.ray.dir.z = _d.z;
        const wh = sim.world.castRayAndGetNormal(this.ray, step, true, undefined, RAY_SHOT);
        if (wh) worldT = wh.timeOfImpact;
      }
      if (hit && hit.t <= worldT) {
        const fromBoss = sim.boss && b.owner === sim.boss.id;
        const dmg = b.dmg * (fromBoss ? (sim.bossDamageMul ?? sim.enemyDamageMul) : sim.enemyDamageMul) * (P.spec.bulletResist ?? 1);
        sim.damageZone(P, hit, dmg, { cause: 'bullet', src: b.owner, point: hit.point, weapon: b.weapon });
        sim.emit({ t: 'hit', pos: hit.point.toArray(), normal: [-_d.x, -_d.y, -_d.z], surface: /driver|gunner/.test(hit.zone.kind) ? 'flesh' : hit.zone.kind === 'tire' ? 'tire' : 'metal', carId: P.id, zone: hit.zone.kind, dmg, enemy: true });
        this.bullets.splice(i, 1); continue;
      }
      if (worldT <= step) {
        sim.emit({ t: 'hit', pos: [_o.x + _d.x * worldT, _o.y + _d.y * worldT, _o.z + _d.z * worldT], normal: [0, 1, 0], surface: 'dirt', carId: -1, enemy: true });
        this.bullets.splice(i, 1); continue;
      }
      // near miss whizz for the player
      if (P && !b.whizzed && b.life < b.maxLife - 0.05) {
        _pv.copy(P.veh.pos).sub(_o); const along = _pv.dot(_d);
        if (along > 0 && along < step * 1.5) { const perp = _pv.addScaledVector(_d, -along).length(); if (perp < 3.2 && perp > 0.6) { b.whizzed = true; sim.emit({ t: 'whizz', pos: [_o.x + _d.x * along, _o.y + _d.y * along, _o.z + _d.z * along], dist: perp }); } }
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.life <= 0) this.bullets.splice(i, 1);
    }
    // ---- rockets
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      _o.set(r.x, r.y, r.z); _d.set(r.vx, r.vy, r.vz); const sp = _d.length(); _d.multiplyScalar(1 / sp);
      // accelerate a bit after launch
      const targetSp = r.speed; const nsp = Math.min(targetSp, sp + dt * targetSp * 1.6);
      r.vx = _d.x * nsp; r.vy = _d.y * nsp - (r.gravity || 0) * dt; r.vz = _d.z * nsp;
      const step = nsp * dt;
      let best = null;
      for (const car of sim.cars.values()) {
        if (car.id === r.owner || car.exploded) continue;
        if (r.owner === 1 && car.kind === 'player') continue;
        if (car.veh.pos.distanceTo(_o) > step + 12) continue;
        const h = car.raycast(_o, _d, step + 0.3, null);
        if (h && (!best || h.t < best.t)) best = { t: h.t, car, point: h.point };
      }
      if (sim.boss && r.owner === 1 && !sim.boss.dead && sim.boss.pos.distanceTo(_o) < step + 30) {
        const h = sim.boss.raycast(_o, _d, step + 0.3);
        if (h && (!best || h.t < best.t)) best = { t: h.t, car: null, point: h.point, bossZone: h.zone.kind };
      }
      this.ray.origin.x = _o.x; this.ray.origin.y = _o.y; this.ray.origin.z = _o.z; this.ray.dir.x = _d.x; this.ray.dir.y = _d.y; this.ray.dir.z = _d.z;
      const wh = sim.world.castRayAndGetNormal(this.ray, step + 0.2, true, undefined, RAY_SHOT);
      let boom = null;
      if (best && (!wh || best.t <= wh.timeOfImpact)) boom = best.point; else if (wh) boom = new THREE.Vector3(_o.x + _d.x * wh.timeOfImpact, _o.y + _d.y * wh.timeOfImpact, _o.z + _d.z * wh.timeOfImpact);
      if (boom || r.life <= 0) {
        const p = boom || _o.clone();
        this.rockets.splice(i, 1);
        if (best && best.bossZone && r.direct) sim.boss.damage(best.bossZone, r.direct * 1.5, { point: p });
        this._explode(sim, p, r.blast, r.blastDmg, r.owner, r.direct && best ? best.car : null, r.direct);
        continue;
      }
      r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
    }
    // ---- grenades (Rapier bodies)
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      if (g.fuse <= 0) {
        const t = g.body.translation();
        sim.world.removeRigidBody(g.body);
        this.grenades.splice(i, 1);
        this._explode(sim, new THREE.Vector3(t.x, t.y, t.z), g.blast, g.dmg, g.owner, null, 0);
      }
    }
  }

  _explode(sim, p, radius, dmg, owner, directCar, directDmg) {
    sim.emit({ t: 'boom', pos: p.toArray(), radius, kind: 'rocket' });
    if (directCar && directDmg) sim.damageCar(directCar, directDmg, { cause: 'rocket', src: owner, point: p });
    sim.blast(p, radius, dmg, 1.0, null, owner);
    sim.hitStop = 0.05;
  }

  /** Enemy bullet. */
  addBullet(o, dir, speed, dmg, owner, weapon = 'mg', life = 1.6) {
    this.bullets.push({ x: o.x, y: o.y, z: o.z, vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed, dmg, owner, life, maxLife: life, weapon });
  }
  addRocket(o, dir, cfg, owner) {
    this.rockets.push({ id: this.nextId++, x: o.x, y: o.y, z: o.z, vx: dir.x * 25, vy: dir.y * 25, vz: dir.z * 25, speed: cfg.speed, blast: cfg.blast, blastDmg: cfg.blastDmg, direct: cfg.direct ?? 0, owner, life: 4, gravity: cfg.gravity || 0 });
  }
  addGrenade(sim, o, vel, cfg, owner) {
    const rb = sim.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(o.x, o.y, o.z).setLinvel(vel.x, vel.y, vel.z).setCcdEnabled(true).setAngularDamping(1.5));
    sim.world.createCollider(RAPIER.ColliderDesc.ball(0.09).setDensity(2).setRestitution(0.35).setFriction(0.5).setCollisionGroups(GROUPS.grenade), rb);
    this.grenades.push({ id: this.nextId++, body: rb, fuse: cfg.fuse, blast: cfg.blast, dmg: cfg.dmg, owner });
  }
}

// Enemy brains: driving (pure pursuit + behaviors) and gunnery (leading, aim error, bursts).
import * as THREE from 'three';
import { clamp, lerp, wrapAngle, rng, smoothstep } from '../core/util.js';
import { HALF_ROAD } from '../data/biomes.js';
import { ENEMY_GUNS } from '../data/enemies.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3(), _f = new THREE.Vector3(), _q = new THREE.Quaternion();
const _pt = {};

/** Local (model-frame) point -> world. */
export function carPoint(car, local, out) {
  const v = car.veh;
  out.set(local[0], local[1] - v.restComHeight, local[2]).applyQuaternion(v.quat).add(v.pos);
  return out;
}

export class EnemyBrain {
  constructor(car, sim, cfg) {
    this.car = car; this.sim = sim;
    this.behavior = cfg.behavior; this.skill = cfg.skill; this.level = cfg.level;
    this.r = rng((car.id * 7919 + 17) >>> 0);
    this.gapTarget = cfg.gap ?? (this.behavior === 'blocker' ? -70 : this.behavior === 'flanker' ? this.r.range(-2, 6) : this.r.range(14, 34));
    this.side = this.r() < 0.5 ? 1 : -1;
    this.lat = this.r.range(-2.6, 2.6);
    this.phase = this.r() * 6.28;
    this.t = 0; this.ramT = this.r.range(2, 5); this.ramActive = 0;
    this.maxSpeed = (car.spec.engine.vmax) * 0.97;
    this.stuckT = 0; this.brakeHold = 0; this.laneD = 0;
    this.guns = cfg.guns; // {gunner: gunDef, gunner2: gunDef}
    this.state = {}; // per gunner
    for (const role of Object.keys(this.guns)) this.state[role] = { mode: 'idle', t: this.r.range(0.3, 1.5), shots: 0, burst: 0, fireT: 0, aimAt: 'cab', err: new THREE.Vector3(), yaw: car.crew[role].aimYaw, pitch: 0 };
    this.tgt = new THREE.Vector3();
  }

  update(dt) {
    const car = this.car, sim = this.sim, veh = car.veh, P = sim.player;
    this.t += dt;
    if (car.exploded) return;
    if (car.driverless || !car.crew.driver.alive) {
      // the dead driver slumps onto the wheel: foot jammed on the gas for a moment, the wheel yanked to one side
      if (this.deadT === undefined) { this.deadT = 0; this.deadSteer = (this.r() < 0.5 ? -1 : 1) * this.r.range(0.45, 1.0); this.deadSpin = this.r() < 0.25; }
      this.deadT += dt;
      veh.input.throttle = this.deadT < 1.6 ? 0.7 : 0;
      veh.input.brake = 0;
      veh.input.steer = this.deadSteer * Math.min(1, this.deadT * 2.5);
      veh.input.handbrake = this.deadSpin && this.deadT > 0.4 && this.deadT < 1.2;
      veh.driverAlive = true; // let the jammed controls act on the car
      if (this.deadT > 2.5) { veh.driverAlive = false; veh.input.handbrake = false; }
      this.gunnery(dt); return;
    }
    if (!P || P.exploded) { veh.input.throttle = 0.4; veh.input.steer = 0; return; }
    const road = sim.road;
    const pv = P.veh.vf, gap = P.s - car.s;      // gap > 0: we are behind the player
    const speed = veh.vf;
    let dT = P.d, vDes;
    const laneLimit = HALF_ROAD - 2.2;
    switch (this.behavior) {
      case 'flanker': {
        const off = this.side * (4.6 + 0.4 * Math.sin(this.t * 0.6 + this.phase));
        dT = P.d + off;
        if (Math.abs(dT) > laneLimit) { this.side = -this.side; dT = P.d + this.side * 4.6; }
        // opportunistic side-swipe
        if (this.ramActive > 0) { this.ramActive -= dt; dT = P.d + this.side * 1.2; } else if (this.t > this.ramT && Math.abs(gap) < 9 && this.level > 0.15) { this.ramActive = 0.8; this.ramT = this.t + this.r.range(4, 8); }
        vDes = pv + clamp((gap - this.gapTarget) * 0.4, -14, 22);
        break;
      }
      case 'rammer': {
        if (gap > 30) { dT = P.d + this.lat; vDes = pv + clamp((gap - 22) * 0.45, -8, 28); }
        else {
          // predicted intercept of the player's rear
          dT = P.d + clamp(P.veh.vl * 0.25, -2, 2);
          vDes = Math.min(this.maxSpeed, pv + 16 + this.level * 8);
          if (gap < -6) { dT = P.d + this.side * 9; this.gapTarget = 26; vDes = pv - 5; } // overshot: drop back and try again
        }
        break;
      }
      case 'blocker': {
        dT = P.d + this.lat * 0.3;
        if (gap < -30) vDes = Math.max(6, pv - 7 - Math.min(10, (-gap - 30) * 0.02));
        else vDes = Math.max(0, pv * 0.25 - 4 * (this.t > 3 ? 1 : 0)); // slam the brakes right in front
        if (gap > 5) { this.behavior = 'chaser'; this.gapTarget = 28; }
        break;
      }
      case 'dropper': {
        // stay 40-70 m ahead in the player's lane, lay burning mines
        dT = P.d + Math.sin(this.t * 0.5) * 2;
        vDes = pv + clamp((-55 - gap) * 0.4, -10, 14);
        if (gap < -25 && gap > -110 && this.t - (this.lastDrop || 0) > 2.6) { this.lastDrop = this.t; sim.hazards.dropEnemyMine(sim, car, 8, 55 + 50 * this.level); }
        break;
      }
      case 'summoner': {
        dT = clamp(P.d + this.side * 4, -laneLimit, laneLimit);
        vDes = pv + clamp((gap - 18) * 0.3, -10, 12);
        if (this.t - (this.lastSummon || 0) > 14) { this.lastSummon = this.t; for (let k = 0; k < 2; k++) sim.director.spawn(sim, 'e_buggy', this.level, { behavior: 'flanker' }); sim.emit({ t: 'summon', id: car.id }); }
        break;
      }
      case 'heavy': {
        dT = clamp(P.d + this.lat * 0.5, -laneLimit, laneLimit);
        vDes = pv + clamp((gap - this.gapTarget) * 0.3, -10, 12);
        break;
      }
      default: { // chaser
        dT = P.d + this.lat * Math.sin(this.t * 0.35 + this.phase) * 1.4 + this.lat * 0.5;
        vDes = pv + clamp((gap - this.gapTarget) * 0.35, -14, 20);
      }
    }
    dT = clamp(dT, -laneLimit, laneLimit);
    vDes = Math.min(vDes, this.maxSpeed);
    // curve caution: slow down for tight corners
    const look = clamp(speed * 0.55 + 8, 10, 42);
    const smK = road.sample(car.s + look * 1.8, _pt).k;
    vDes = Math.min(vDes, Math.sqrt(Math.max(400, 26 * (1 / Math.max(Math.abs(smK), 1 / 900)) * 0.9)));
    // pure pursuit toward a point on the road ahead at the target lateral offset
    const tp = road.pointAt(car.s + look, dT, this._tp || (this._tp = {}));
    const desired = Math.atan2(tp.x - veh.pos.x, tp.z - veh.pos.z);
    const heading = Math.atan2(veh.fwd.x, veh.fwd.z);
    const err = wrapAngle(desired - heading);
    let steer = clamp(err * (2.2 + 0.6 * this.skill), -1, 1);
    // avoid other cars ahead
    let brakeAvoid = 0;
    for (const o of sim.cars.values()) {
      if (o === car || o.exploded) continue;
      _v.copy(o.veh.pos).sub(veh.pos); const ahead = _v.dot(veh.fwd), lat = _v.dot(veh.left);
      if (ahead > 0 && ahead < 16 + speed * 0.3 && Math.abs(lat) < 3.4) {
        if (this.behavior === 'rammer' && o === P) continue;
        if (o === P && this.behavior === 'blocker') continue;
        steer += clamp((lat >= 0 ? -1 : 1) * (1 - ahead / (16 + speed * 0.3)) * 1.6, -1, 1);
        if (o.veh.vf < speed - 2 && ahead < 10 + speed * 0.2) brakeAvoid = Math.max(brakeAvoid, 0.6);
      }
    }
    veh.input.steer = clamp(steer, -1, 1);
    const dv = vDes - speed;
    veh.input.throttle = dv > 0 ? clamp(dv * 0.5, 0, 1) : 0;
    veh.input.brake = Math.max(brakeAvoid, dv < -3 ? clamp(-dv * 0.18, 0, 1) : 0);
    veh.input.handbrake = false; veh.input.nitro = this.behavior === 'rammer' && gap < 60 && gap > 0 && this.level > 0.5;
    if (veh.up.y < 0.3) { this.stuckT += dt; if (this.stuckT > 3.5 && !car.exploded && car.burning <= 0) { car.burning = 0.001; sim.emit({ t: 'fire', id: car.id }); } } else this.stuckT = 0;
    this.gunnery(dt);
  }

  gunnery(dt) {
    const car = this.car, sim = this.sim, P = sim.player;
    if (!P || P.exploded) return;
    for (const role of Object.keys(this.guns)) {
      const crew = car.crew[role]; const st = this.state[role]; const gun = this.guns[role];
      if (!crew || !crew.alive) { crew && (crew.fire = false); continue; }
      const seat = car.spec.seats[role];
      const muzzle = carPoint(car, [seat[0], seat[1] + 1.35, seat[2]], _v);
      const dist = muzzle.distanceTo(P.veh.pos);
      // choose an aim point on the player's truck
      if (st.mode === 'idle' || st.mode === 'aim') {
        const zone = st.aimAt;
        const ps = P.spec.seats;
        const local = zone === 'cab' ? [ps.driver[0], ps.driver[1] + 0.5, ps.driver[2]] : zone === 'bed' ? [ps.gunner[0], ps.gunner[1] + 1.1, ps.gunner[2]] : zone === 'tire' ? [P.spec.wheels[0].x, 0.35, P.spec.wheels[0].z] : [0, 0.95, 0];
        carPoint(P, local, this.tgt);
      }
      // predicted lead
      const rel = _w.copy(P.veh.vel).sub(car.veh.vel);
      const tFly = clamp(dist / gun.speed, 0, 1.2);
      _t.copy(this.tgt).addScaledVector(rel, tFly * (0.75 + 0.25 * this.skill));
      _f.copy(_t).sub(muzzle); const dl = _f.length(); _f.multiplyScalar(1 / dl);
      const wantYaw = Math.atan2(_f.x, _f.z), wantPitch = Math.asin(clamp(_f.y, -1, 1));
      const rate = gun.aimRate * (0.7 + 0.6 * this.skill);
      const dy = wrapAngle(wantYaw - st.yaw), dp = wantPitch - st.pitch;
      st.yaw += clamp(dy, -rate * dt, rate * dt); st.pitch += clamp(dp, -rate * dt, rate * dt);
      crew.aimYaw = st.yaw; crew.aimPitch = st.pitch;
      const aligned = Math.abs(dy) < 0.09 && Math.abs(dp) < 0.09;
      const inRange = dl < gun.range;
      st.t -= dt;
      switch (st.mode) {
        case 'idle':
          crew.fire = false;
          if (inRange && st.t <= 0) { st.mode = 'aim'; st.t = this.r.range(gun.react[0], gun.react[1]) * lerp(1.25, 0.7, this.skill); st.aimAt = this.r() < 0.55 ? 'cab' : this.r() < 0.6 ? 'bed' : this.r() < 0.5 ? 'body' : 'tire'; }
          break;
        case 'aim':
          if (!inRange) { st.mode = 'idle'; st.t = 0.6; break; }
          if (st.t <= 0 && aligned) { st.mode = 'burst'; st.burst = Math.round(lerp(gun.burst[0], gun.burst[1], this.r())); st.fireT = 0; }
          break;
        case 'burst': {
          crew.fire = true;
          st.fireT -= dt;
          if (st.fireT <= 0 && st.burst > 0) {
            this.shoot(muzzle, role, gun, st);
            st.burst--; st.fireT += 1 / gun.rate;
          }
          if (st.burst <= 0) { st.mode = 'idle'; crew.fire = false; st.t = this.r.range(gun.pause[0], gun.pause[1]) * lerp(1.3, 0.8, this.skill); }
          if (!inRange) { st.mode = 'idle'; st.t = 0.5; crew.fire = false; }
          break;
        }
      }
    }
  }

  shoot(muzzle, role, gun, st) {
    const sim = this.sim, car = this.car;
    const spread = gun.spread * (Math.PI / 180) * lerp(1.5, 0.55, this.skill) * (1 - 0.0 * this.level);
    const proj = sim.projectiles;
    const dir = _v.set(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch));
    const origin = muzzle.clone();
    if (gun.rocket) {
      const d = dir.clone();
      d.x += (Math.random() - 0.5) * spread; d.y += (Math.random() - 0.5) * spread; d.normalize();
      proj.addRocket(origin, d, gun.rocket, car.id);
      sim.emit({ t: 'shot', src: car.id, weapon: 'rpg', origin: origin.toArray(), dir: d.toArray(), rocket: true, speed: gun.rocket.speed });
      return;
    }
    const dmg = gun.dmg * (1 + 1.1 * this.level);
    const rays = [];
    for (let p = 0; p < gun.pellets; p++) {
      const d = dir.clone();
      const a = Math.sqrt(Math.random()) * spread, r = Math.random() * 6.283;
      d.x += Math.cos(r) * a; d.z += Math.sin(r) * a * 0.6; d.y += Math.sin(r) * a; d.normalize();
      const v0 = d.clone().multiplyScalar(gun.speed).add(car.veh.vel);
      const sp = v0.length();
      proj.addBullet(origin, v0.normalize(), sp, dmg, car.id, gun.rocket ? 'rpg' : 'bullet', 1.8);
      rays.push(d.toArray());
    }
    sim.emit({ t: 'shot', src: car.id, weapon: 'enemy', origin: origin.toArray(), rays, speed: gun.speed, role, pellets: gun.pellets });
  }
}

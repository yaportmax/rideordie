// AI partner: the DRIVER (single player as gunner). Drives the road fast but sane, threads roadblock gaps, avoids enemy mines,
// keeps a good firing position for the gunner, dodges rammers, uses nitro / oil / mines / medkits, flips the truck back if stuck.
import * as THREE from 'three';
import { clamp, wrapAngle, lerp, smoothstep } from '../core/util.js';
import { HALF_ROAD } from '../data/biomes.js';
import { rbGapD } from '../sim/hazards.js';

const _v = new THREE.Vector3(), _tp = {};

export class AIDriver {
  constructor(run) {
    this.run = run; this.lane = 0; this.laneT = 0; this.stuckT = 0; this.oilCd = 5; this.mineCd = 5; this.swerve = 0; this.swerveT = 0;
    this.cmd = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, reset: false, special1: false, special2: false, medkit: false, lookX: 0, lookY: 0, cameraToggle: false, horn: false };
  }

  update(dt) {
    const run = this.run, sim = run.sim, P = run.player, v = P.veh, road = sim.road, c = this.cmd;
    c.special1 = c.special2 = c.medkit = c.reset = false;
    if (sim.state !== 'run' && sim.state !== 'countdown') { c.throttle = 0; c.brake = 1; c.steer = 0; return c; }
    const vmax = P.spec.engine.vmax;
    // ---------------- where to be laterally
    this.laneT -= dt;
    let want = this.lane;
    const B = sim.boss;
    if (B && !B.dead) want = Math.sin(sim.time * 0.12) > 0 ? 4.2 : -4.2;               // flank the war-train, out of its wake
    else if (this.laneT <= 0) { this.laneT = 4 + Math.random() * 4; want = this.lane = [-3.5, 0, 3.5][(Math.random() * 3) | 0]; }
    // roadblocks: commit to the gap early (it is only 4.4 m wide) and let nothing else pull us off that line
    const rb = road.featuresIn(P.s - 2, P.s + 260, 'roadblock')[0];
    const rbDist = rb ? rb.s0 - P.s : 1e9, rbLock = rb && rbDist < 110;
    if (rb) want = rbGapD(rb);
    // wedged here before? try another line this time (alternating sides, wider each attempt)
    if (this.retry && Math.abs(P.s - this.retry.s) < 60) want += this.retry.off; else if (this.retry && P.s - this.retry.s > 60) this.retry = null;
    // enemy mines / burning barrels ahead: pick the side away from them
    if (!rbLock) for (const m of sim.hazards.enemyMines) {
      const n = road.nearest(m.pos.x, m.pos.z, P.s, 80, _tp);
      if (n.s > P.s && n.s < P.s + 90 && Math.abs(n.d - want) < 3.2) want = n.d > 0 ? n.d - 4 : n.d + 4;
    }
    // cars directly ahead in our lane: go around
    if (!rbLock) for (const car of sim.cars.values()) {
      if (car === P || car.exploded && car.wreckT > 3) continue;
      const ahead = car.s - P.s;
      if (ahead > 4 && ahead < 45 && Math.abs(car.d - want) < 2.6) want = car.d > P.d ? car.d - 3.6 : car.d + 3.6;
    }
    want = clamp(want, -HALF_ROAD + 1.4, HALF_ROAD - 1.4);
    // rammers closing in from the side: flinch away (and keep a gunner-friendly spacing)
    if (this.swerveT > 0) this.swerveT -= dt; else this.swerve = 0;
    for (const car of sim.cars.values()) {
      if (car.kind !== 'enemy' || car.exploded) continue;
      _v.copy(car.veh.pos).sub(v.pos); const lat = _v.dot(v.left), lon = _v.dot(v.fwd);
      const closing = -car.veh.vel.clone().sub(v.vel).dot(v.left) * Math.sign(lat);
      if (Math.abs(lon) < 6 && Math.abs(lat) < 5 && closing > 4 && car.ai && car.ai.behavior === 'rammer') { this.swerve = -Math.sign(lat) * 2.5; this.swerveT = 0.6; }
    }
    want = clamp(want + (rbLock ? 0 : this.swerve), -HALF_ROAD + 1.2, HALF_ROAD - 1.2);
    // ---------------- steering: pure pursuit on the road (shorter look-ahead = more precise when threading a gap)
    const look = rbLock ? 9 + v.speed * 0.3 : 16 + v.speed * 0.42;
    const tp = road.pointAt(P.s + look, want, _tp);
    const err = wrapAngle(Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z));
    c.steer = clamp(err * 2.4, -1, 1);
    // ---------------- speed
    const kA = Math.max(Math.abs(road.sample(P.s + 35).k), Math.abs(road.sample(P.s + 80).k), Math.abs(road.sample(P.s + 130).k));
    let target = Math.min(vmax * 0.9, Math.sqrt(15 / Math.max(kA, 1e-4)));
    if (rb && rbDist < 160) target = Math.min(target, clamp(22 + (rbDist - 30) * 0.12, 22, 34)); // don't thread a roadblock at full chat
    if (B && !B.dead) target = B.v + clamp((B.s - P.s - 32) * 0.4, -10, 10);            // hold station behind the boss
    const vf = v.vf;
    c.throttle = vf < target ? clamp((target - vf) * 0.3 + 0.4, 0, 1) : 0;
    c.brake = vf > target + 4 ? clamp((vf - target) * 0.08, 0, 1) : 0;
    c.handbrake = false;
    c.nitro = v.nitroMax > 0 && v.nitro > 0.6 && vf < target - 6 && kA < 1 / 500;
    // ---------------- gadgets
    this.oilCd -= dt; this.mineCd -= dt;
    for (const car of sim.cars.values()) {
      if (car.kind !== 'enemy' || car.exploded) continue;
      const behind = P.s - car.s;
      if (behind > 4 && behind < 22 && Math.abs(car.d - P.d) < 3) { if (this.oilCd <= 0) { c.special1 = true; this.oilCd = 7; } else if (this.mineCd <= 0) { c.special2 = true; this.mineCd = 5; } }
    }
    const crew = P.crew;
    if ((crew.driver.alive && crew.driver.hp < crew.driver.max * 0.3) || (crew.gunner && crew.gunner.alive && crew.gunner.hp < crew.gunner.max * 0.3)) c.medkit = true;
    // ---------------- stuck / flipped: flipped => free flip-back; wedged upright => back out and re-aim
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      c.throttle = 0; c.brake = 1; c.nitro = false; c.handbrake = false;
      c.steer = clamp(-err * 3, -1, 1);                       // reversing: steering acts mirrored, back away from the obstacle
      return c;
    }
    const upright = v.up.y > 0.55;
    if (!upright) { this.flipT = (this.flipT || 0) + dt; if (this.flipT > 1.0) { this.flipT = 0; run._unflip(true); } }
    else this.flipT = 0;
    if (upright && v.speed < 2 && c.throttle > 0.3 && sim.state === 'run' && sim.time > 4) {
      this.stuckT += dt;
      if (this.stuckT > 0.9) {
        this.stuckT = 0; this.reverseT = 1.6;
        const n = this.retry && Math.abs(P.s - this.retry.s) < 60 ? this.retry.n + 1 : 1;
        this.retry = { s: P.s, n, off: (n % 2 ? 1 : -1) * Math.min(6, 1.6 * Math.ceil(n / 2) + 0.8) };
      }
    }
    else this.stuckT = Math.max(0, this.stuckT - dt);
    return c;
  }
}

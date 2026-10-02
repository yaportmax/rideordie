// AI partner: the DRIVER (single player as gunner). Drives the road fast but sane, threads roadblock gaps, avoids enemy mines,
// keeps a good firing position for the gunner, dodges rammers, uses nitro / oil / mines / medkits, flips the truck back if stuck.
import * as THREE from 'three';
import { clamp, wrapAngle, lerp, smoothstep } from '../core/util.js';
import { HALF_ROAD } from '../data/biomes.js';
import { rbGapD } from '../sim/hazards.js';
import { drivingLaneTarget, projectDrivingBranch } from '../world/driving_plan.js';

const _v = new THREE.Vector3(), _tp = {}, _mainProjection = {};

/** The driver's branch pursuit continues on main road outside the fork bounds. */
function ownCorridorCoordinates(road, branch, pos, hint, window, out) {
  if (!branch) return road.nearest(pos.x, pos.z, hint, window, out);
  projectDrivingBranch(branch, pos.x, pos.z, out);
  // Finite branch projection clamps to an endpoint. Its distance then includes
  // longitudinal travel beyond the merge, incorrectly treating future main-road
  // traffic as a separated corridor. Compare only the real main continuation.
  const main = road.nearest(pos.x, pos.z, hint, window, _mainProjection);
  if ((main.s < branch.s0 || main.s > branch.s1) && main.dist < out.dist) {
    out.s = main.s; out.d = main.d; out.dist = main.dist;
  }
  return out;
}

export class AIDriver {
  constructor(run) {
    this.run = run; this.lane = 0; this.laneT = 0; this.stuckT = 0; this.oilCd = 5; this.mineCd = 5; this.swerve = 0; this.swerveT = 0;
    this.cmd = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, reset: false, special1: false, special2: false, medkit: false, lookX: 0, lookY: 0, cameraToggle: false, horn: false };
  }

  update(dt) {
    const run = this.run, sim = run.sim, P = run.player, v = P.veh, road = sim.road, c = this.cmd;
    c.special1 = c.special2 = c.medkit = c.reset = false;
    if (sim.state !== 'run' && sim.state !== 'countdown') { c.throttle = 0; c.brake = 1; c.steer = 0; return c; }
    const vmax = P.spec.engine.vmax, branch = P.route && road.drivingBranch(P.route), route = branch?.id || null, halfWidth = branch ? branch.width / 2 : HALF_ROAD;
    if (route !== this._route) { this.lane = 0; this.laneT = 2; this.retry = null; this._route = route; }
    // ---------------- where to be laterally
    this.laneT -= dt;
    let want = branch ? 0 : this.lane;
    const B = sim.boss;
    if (!branch && B && !B.dead) want = (Math.sin(sim.time * 0.12) > 0 ? 3.6 : -3.6) + Math.sin(sim.time * 2.1) * 2.2; // flank the war-train and weave (its gunners lead a steady target)
    else if (!branch && this.laneT <= 0) { this.laneT = 4 + Math.random() * 4; want = this.lane = [-3.5, 0, 3.5][(Math.random() * 3) | 0]; }
    // roadblocks: commit to the gap early (it is only 4.4 m wide) and let nothing else pull us off that line
    const rb = branch ? null : road.featuresIn(P.s - 2, P.s + 260, 'roadblock')[0];
    const stage = branch ? null : drivingLaneTarget(road, P.s, P.spec.length, 265, this._stage || (this._stage = {}));
    const rbDist = rb ? rb.s0 - P.s : 1e9, rbLock = (rb && rbDist < 110) || (stage && stage.distance < 180);
    if (rb) want = rbGapD(rb);
    if (stage) want = stage.d;
    // wedged here before? try another line this time (alternating sides, wider each attempt)
    if (this.retry && Math.abs(P.s - this.retry.s) < 60) want += this.retry.off; else if (this.retry && P.s - this.retry.s > 60) this.retry = null;
    // enemy mines / burning barrels ahead: pick the side away from them
    if (!rbLock) for (const m of sim.hazards.enemyMines) {
      const n = ownCorridorCoordinates(road, branch, m.pos, P.s, 80, _tp);
      if (n.dist > halfWidth + 3.2) continue;
      if (n.s > P.s && n.s < P.s + 90 && Math.abs(n.d - want) < 3.2) want = n.d > 0 ? n.d - 4 : n.d + 4;
    }
    // cars directly ahead in our lane: go around
    // cars and WRECKS ahead in our line: go around (wrecks are the most solid thing on the road); look further ahead at speed
    const lookCar = 30 + v.speed * 0.9;
    if (!rbLock) for (const car of sim.cars.values()) {
      if (car === P) continue;
      const wide = car.exploded ? 3.2 : 2.6;
      // Route labels differ while both corridors physically overlap at joins.
      // Only compare lateral coordinates in our own corridor; separated forks
      // naturally stay outside its obstacle width instead of being skipped by ID.
      const crossRoute = (car.route || null) !== route;
      const n = crossRoute ? ownCorridorCoordinates(road, branch, car.veh.pos, P.s, Math.max(80, lookCar), _tp) : car;
      if (crossRoute && n.dist > halfWidth + wide) continue;
      const ahead = n.s - P.s;
      if (ahead > 3 && ahead < lookCar && Math.abs(n.d - want) < wide) want = n.d > P.d ? n.d - (wide + 1.1) : n.d + (wide + 1.1);
    }
    want = clamp(want, -halfWidth + 1.4, halfWidth - 1.4);
    // tunnels, bridges and overpass approaches: hold the middle (walls/rails close in, no lane games at 200+ km/h)
    const narrow = !branch && road.featuresIn(P.s - 30, P.s + 90).some((f) => f.type === 'tunnel' || f.type === 'bridge');
    if (narrow) want = clamp(want, -2.4, 2.4);
    // guard rails: keep a wider berth on a railed side (scraping one at 200 km/h shreds the truck)
    const gr = branch ? null : road.featuresIn(P.s - 10, P.s + 120, 'guard')[0];
    if (gr) { const L = gr.side === 'L' || gr.side === 'both', R = gr.side === 'R' || gr.side === 'both'; want = clamp(want, R ? -HALF_ROAD + 2.6 : -HALF_ROAD + 1.4, L ? HALF_ROAD - 2.6 : HALF_ROAD - 1.4); }
    // rammers closing in from the side: flinch away (and keep a gunner-friendly spacing)
    if (this.swerveT > 0) this.swerveT -= dt; else this.swerve = 0;
    for (const car of sim.cars.values()) {
      if (car.kind !== 'enemy' || car.exploded) continue;
      _v.copy(car.veh.pos).sub(v.pos); const lat = _v.dot(v.left), lon = _v.dot(v.fwd);
      const closing = -car.veh.vel.clone().sub(v.vel).dot(v.left) * Math.sign(lat);
      if (Math.abs(lon) < 6 && Math.abs(lat) < 5 && closing > 4 && car.ai && car.ai.behavior === 'rammer') { this.swerve = -Math.sign(lat) * 2.5; this.swerveT = 0.6; }
    }
    want = clamp(want + (rbLock ? 0 : this.swerve), -halfWidth + 1.2, halfWidth - 1.2);
    // A solid edge slice takes priority over random lane games, retries and rammer
    // flinches. Stay in its clear passage until the rear of the truck has passed.
    if (stage && stage.distance < 180) want = stage.d;
    // ---------------- steering: pure pursuit on the road (shorter look-ahead = more precise when threading a gap)
    const look = rbLock ? 9 + v.speed * 0.3 : 16 + v.speed * 0.42;
    const tp = branch ? road.drivingPointAt(P.s + look, want, route, _tp) : road.pointAt(P.s + look, want, _tp);
    const err = wrapAngle(Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z));
    c.steer = clamp(err * 2.4, -1, 1);
    // ---------------- speed
    const kA = branch ? Math.max(this._branchCurvature(road, route, P.s + 35), this._branchCurvature(road, route, P.s + 80), this._branchCurvature(road, route, P.s + 130)) : Math.max(Math.abs(road.sample(P.s + 35).k), Math.abs(road.sample(P.s + 80).k), Math.abs(road.sample(P.s + 130).k));
    let target = Math.min(vmax * 0.9, Math.sqrt(15 / Math.max(kA, 1e-4)));
    if (rb && rbDist < 160) target = Math.min(target, clamp(22 + (rbDist - 30) * 0.12, 22, 34)); // don't thread a roadblock at full chat
    if (stage) {
      target = Math.min(target, stage.speed);
      if (stage.distance < 180) for (const car of sim.cars.values()) {
        if (car === P) continue;
        const crossRoute = (car.route || null) !== route;
        const n = crossRoute ? road.nearest(car.veh.pos.x, car.veh.pos.z, P.s, 80, _tp) : car;
        if (crossRoute && n.dist > halfWidth + 3.3) continue;
        if (n.s < P.s || n.s > P.s + 30 || Math.abs(n.d - stage.d) > 3.3) continue;
        // Brake for traffic in the passage rather than dodge into the solid edge.
        target = Math.min(target, Math.max(8, car.veh.vf - 4));
      }
    }
    // jump ramps span the road: hitting one at 250 km/h throws the truck into whatever is beside the road on landing
    const ramp = branch ? null : road.featuresIn(P.s, P.s + 170, 'ramp')[0];
    if (ramp) target = Math.min(target, clamp(30 + (ramp.s0 - P.s - 40) * 0.12, 28, 40));
    if (!branch && B && !B.dead) target = B.v + clamp((B.s - P.s - 38 - 8 * Math.sin(sim.time * 0.7)) * 0.4, -10, 10); // hold station behind the boss, surging in and out
    const vf = v.vf;
    c.throttle = vf < target ? clamp((target - vf) * 0.3 + 0.4, 0, 1) : 0;
    c.brake = vf > target + 4 ? clamp((vf - target) * 0.08, 0, 1) : 0;
    c.handbrake = false;
    c.nitro = !stage && v.nitroMax > 0 && v.nitro > 0.6 && vf < target - 6 && kA < 1 / 500;
    // ---------------- gadgets
    this.oilCd -= dt; this.mineCd -= dt;
    for (const car of sim.cars.values()) {
      if (car.kind !== 'enemy' || car.exploded || (car.route || null) !== route) continue;
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

  _branchCurvature(road, route, s) {
    const a = road.drivingPointAt(s - 4, 0, route, this._curveA || (this._curveA = {}));
    const b = road.drivingPointAt(s + 4, 0, route, this._curveB || (this._curveB = {}));
    return Math.abs(wrapAngle(b.th - a.th)) / Math.max(.1, Math.hypot(b.x - a.x, b.z - a.z));
  }
}

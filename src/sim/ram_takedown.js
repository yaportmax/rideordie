import { clamp } from '../core/util.js';

/** A hard nose-to-rear contact launches a living enemy, without awarding a kill. */
export function planRearRamBonk(sim, target, driver, impactDv, dir) {
  if (sim.state !== 'run' || target.kind !== 'enemy' || target.dead || target.exploded || target.hp <= 0 || target.held || target._rearRamLocked) return null;
  if (driver !== sim.player || driver?.kind !== 'player' || driver.dead || driver.exploded || driver.held || !driver.crew.driver.alive) return null;
  const v = driver.veh, other = target.veh;
  if (v.up.y < 0.65 || other.up.y < 0.65 || !Number.isFinite(impactDv) || impactDv < 0.7) return null;
  const n = Math.hypot(v.fwd.x, v.fwd.z), on = Math.hypot(other.fwd.x, other.fwd.z);
  if (n < 0.5 || on < 0.5) return null;
  const x = v.fwd.x / n, z = v.fwd.z / n, ox = other.fwd.x / on, oz = other.fwd.z / on;
  if (x * ox + z * oz < 0.6) return null; // head-on contacts and side slams remain normal crashes
  const normal = Math.hypot(dir.x, dir.y, dir.z);
  if (normal < 0.5 || Math.abs(dir.x * x + dir.z * z) / normal < 0.65) return null;
  const dx = v.pos.x - other.pos.x, dz = v.pos.z - other.pos.z;
  let rear = Infinity, left = Infinity, right = -Infinity;
  // Heavy/tanker/bus hulls are not centred on their model origin. Use their authored boxes.
  for (const box of target.spec.colliders) {
    rear = Math.min(rear, box.center[2] - box.half[2]);
    left = Math.min(left, box.center[0] - box.half[0]); right = Math.max(right, box.center[0] + box.half[0]);
  }
  const lateral = dx * oz - dz * ox;
  if (dx * ox + dz * oz >= rear + 0.3 || lateral < left - driver.spec.width * 0.4 || lateral > right + driver.spec.width * 0.4) return null;
  const approach = v.preImpactVx * x + v.preImpactVz * z;
  const enemyForward = other.preImpactVx * x + other.preImpactVz * z;
  const closing = approach - enemyForward;
  if (!Number.isFinite(approach) || approach < 14 || !Number.isFinite(closing) || closing < 8) return null;
  const massFactor = clamp(Math.sqrt(v.mass / other.mass), 0.5, 1.2);
  return {
    x, z, closing,
    forward: clamp(enemyForward + closing * (1 + 0.4 * massFactor) + 6 * massFactor, 0, 85),
    lift: clamp((1.4 + closing * 0.055) * massFactor, 1.4, 4.2),
    pitch: clamp(0.2 + closing * 0.012, 0.2, 0.65) * massFactor,
  };
}

export function launchRearRamBonk(car, plan, time) {
  const b = car.veh.body, mass = b.mass(), linear = b.linvel();
  if (!(mass > 0)) return false;
  const currentForward = linear.x * plan.x + linear.z * plan.z;
  const add = clamp(plan.forward - currentForward, 0, 32);
  if (add <= 0) return false; // never slow an already faster target to a launch preset
  const y = clamp(Math.max(0, linear.y) + plan.lift, plan.lift, 6);
  b.applyImpulse({ x: plan.x * add * mass, y: (y - linear.y) * mass, z: plan.z * add * mass }, true);
  b.applyTorqueImpulse({ x: plan.z * mass * plan.pitch, y: 0, z: -plan.x * mass * plan.pitch }, true);
  const angular = b.angvel(), angularSpeed = Math.hypot(angular.x, angular.y, angular.z);
  if (angularSpeed > 3.5) b.setAngvel({ x: angular.x * 3.5 / angularSpeed, y: angular.y * 3.5 / angularSpeed, z: angular.z * 3.5 / angularSpeed }, true);
  car.veh.stunned = Math.max(car.veh.stunned, 0.38);
  car._rearRamLocked = true; car._rearRamLastLaunch = time; car._rearRamClearSince = null;
  car.veh.readState();
  return true;
}

let _touching = false;
function markTouching(manifold) { if (manifold.numSolverContacts() > 0) _touching = true; }

/** Rearm only after physical separation, so multiple hulls/resting contact cannot repeatedly launch. */
export function updateRearRamContact(sim, target) {
  if (!target._rearRamLocked || target.dead) return;
  const player = sim.player;
  _touching = false;
  if (player) for (const a of target.veh.colliders) for (const b of player.veh.colliders) {
    sim.world.contactPair(a, b, markTouching);
    if (_touching) break;
  }
  if (_touching) { target._rearRamClearSince = null; return; }
  if (target._rearRamClearSince == null) target._rearRamClearSince = sim.time;
  if (sim.time - target._rearRamClearSince >= 0.15 && sim.time - target._rearRamLastLaunch >= 0.4) target._rearRamLocked = false;
}

/** A takedown belongs only to a lethal, closing, forward player contact. */
export function planRamTakedown(sim, target, driver, damage, impactDv) {
  if (sim.state !== 'run' || target.kind !== 'enemy' || target.exploded || target.dead || target.hp <= 0 || damage < target.hp) return null;
  if (driver !== sim.player || driver?.kind !== 'player' || driver.exploded || !driver.crew.driver.alive) return null;
  const v = driver.veh, speed = v.vf;
  if (!Number.isFinite(speed) || speed < 8 || !Number.isFinite(impactDv) || impactDv < 0.35) return null;
  const n = Math.hypot(v.fwd.x, v.fwd.z);
  if (n < 0.5 || v.up.y < 0.4) return null;
  const x = v.fwd.x / n, z = v.fwd.z / n;
  const dx = target.veh.pos.x - v.pos.x, dz = target.veh.pos.z - v.pos.z;
  // A raider striking the truck from behind is not the driver's takedown.
  if (dx * x + dz * z < -driver.spec.length * 0.12) return null;
  const other = target.veh, gap = Math.hypot(dx, dz);
  const closing = ((v.preImpactVx - other.preImpactVx) * dx + (v.preImpactVz - other.preImpactVz) * dz) / Math.max(gap, 0.1);
  if (!Number.isFinite(closing) || closing < 1) return null;
  const massFactor = clamp(Math.sqrt(v.mass / other.mass), 0.65, 1.25);
  const bonus = clamp((12 + impactDv * 0.9) * massFactor, 10, 22);
  return {
    x, z, forward: clamp(speed + bonus, 22, 75),
    lift: clamp((4.5 + speed * 0.045) * massFactor, 4.5, 8),
    side: Math.sign(dx * z - dz * x) || ((target.id & 1) ? 1 : -1), impactDv,
  };
}

/** Replace the victim's random explosion/roadside impulse, retaining all chain hooks. */
export function launchRamTakedown(car, plan) {
  const b = car.veh.body, mass = b.mass(), linear = b.linvel();
  if (!(mass > 0)) return false;
  const lateral = clamp((linear.x * plan.z - linear.z * plan.x) * 0.25, -5, 5);
  const x = plan.x * plan.forward + plan.z * lateral;
  const y = clamp(Math.max(0, linear.y) + plan.lift, plan.lift, 10);
  const z = plan.z * plan.forward - plan.x * lateral;
  b.applyImpulse({ x: (x - linear.x) * mass, y: (y - linear.y) * mass, z: (z - linear.z) * mass }, true);
  const torque = mass * clamp(0.9 + plan.impactDv * 0.04, 0.9, 1.5);
  b.applyTorqueImpulse({ x: plan.z * torque + plan.x * torque * plan.side * 0.32, y: plan.side * torque * 0.16, z: -plan.x * torque + plan.z * torque * plan.side * 0.32 }, true);
  const angular = b.angvel(), angularSpeed = Math.hypot(angular.x, angular.y, angular.z);
  if (angularSpeed > 3.5) b.setAngvel({ x: angular.x * 3.5 / angularSpeed, y: angular.y * 3.5 / angularSpeed, z: angular.z * 3.5 / angularSpeed }, true);
  car.veh.readState();
  return true;
}

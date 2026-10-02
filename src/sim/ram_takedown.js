import { clamp } from '../core/util.js';

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

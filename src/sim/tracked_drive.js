// WORK proposal, UNRUN. Four independent shoe-contact rays approximate traction.
// This is not a continuous track, articulated belt or full drivetrain solver.
// Dependency-free leaf so Vehicle and data/vehicles.js rideInfo share one radius.
const bound = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const positive = value => Number.isFinite(value) && value > 0 ? value : 0;
export const TRACKED_DRIVE_DEFAULTS = Object.freeze({
  contactRadius: .39, lateralScrub: .55, lateralGain: 1.6,
  pivotRate: .70, yawResponse: 4.0, turnPower: 1.0,
});

export function trackedContactRadius(spec) {
  // The old wheel path returns its exact authored number without new arithmetic.
  if (spec.driveMode !== 'tracks') return spec.wheelRadius;
  const radius = spec.trackedDrive?.contactRadius;
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Tracked drive requires an explicit shoe contact radius');
  return radius;
}

export function createTrackedDriveState(spec) {
  if (spec.driveMode !== 'tracks') return null;
  trackedContactRadius(spec);
  if (!Array.isArray(spec.wheels) || spec.wheels.length !== 4) throw new Error('Tracked drive uses exactly four snapshot contacts');
  const names = new Set(spec.wheels.map(w => w.name));
  if (names.size !== 4 || !['FL', 'FR', 'RL', 'RR'].every(name => names.has(name))) throw new Error('Tracked contact names must remain FL/FR/RL/RR');
  let left = 0, right = 0;
  for (const wheel of spec.wheels) {
    if (![wheel.x, wheel.z, wheel.drive].every(Number.isFinite) || Math.abs(wheel.x) < .0001 || wheel.drive <= 0) throw new Error('Tracked contacts require finite off-centre driven points');
    if (wheel.x > 0) left++; else right++;
  }
  if (left !== 2 || right !== 2) throw new Error('Tracked drive requires two contacts on each side');
  for (const sign of [-1, 1]) {
    const side = spec.wheels.filter(w => Math.sign(w.x) === sign);
    if (Math.abs(side[0].z - side[1].z) < .0001 || side.filter(w => w.front === true).length !== 1) throw new Error('Each tracked side requires distinct front/rear contact points');
  }
  const config = { ...TRACKED_DRIVE_DEFAULTS, ...spec.trackedDrive };
  if (!Number.isFinite(config.lateralScrub) || config.lateralScrub <= 0 || config.lateralScrub > 1 ||
      !Number.isFinite(config.lateralGain) || config.lateralGain <= 0 ||
      !Number.isFinite(config.pivotRate) || config.pivotRate <= 0 ||
      !Number.isFinite(config.yawResponse) || config.yawResponse <= 0 ||
      !Number.isFinite(config.turnPower) || config.turnPower <= 0 || config.turnPower > 1) throw new Error('Invalid tracked drive calibration');
  return { ...config, forces: new Float64Array(4), limits: new Float64Array(4),
    leftForce: 0, rightForce: 0, differential: 0, bilateral: false, budget: 0 };
}

/** Write longitudinal requests only. Real Vehicle later shares each contact's
 * actual load between longitudinal and lateral requests through its existing
 * friction ellipse. No direct body torque is applied by this helper.
 * Steering needs a loaded, driven, nonzero-grip contact on BOTH sides. A single
 * loaded side can still exert ordinary propulsion; its natural off-centre yaw
 * is not secretly canceled or attributed to a two-track pivot.
 */
export function writeTrackedDriveForces(state, spec, wheels, driveForce, powerBudget, yawCommand, yawRate, steeringEnabled) {
  state.forces.fill(0); state.limits.fill(0);
  state.leftForce = state.rightForce = state.differential = 0; state.bilateral = false;
  const budget = positive(powerBudget); state.budget = budget;
  if (wheels.length !== 4) throw new Error('Tracked snapshot contact count changed');
  let leftDrive = 0, rightDrive = 0, leftLimit = 0, rightLimit = 0, leftX = 0, rightX = 0;
  for (let i = 0; i < 4; i++) {
    const w = wheels[i], weight = positive(w.drive);
    if (!w.grounded || !positive(w.load) || !weight) continue;
    const limit = positive(spec.grip.long ?? 1.25) * positive(w.surface.grip) * positive(w.grip) * w.load;
    if (!limit) continue;
    state.limits[i] = limit;
    if (w.mount.x > 0) { leftDrive += weight; leftLimit += limit; leftX += w.mount.x * limit; }
    else { rightDrive += weight; rightLimit += limit; rightX += w.mount.x * limit; }
  }
  const totalDrive = leftDrive + rightDrive;
  if (!totalDrive || !budget) return state;
  const base = Number.isFinite(driveForce) ? bound(driveForce, -budget, budget) : 0;
  let leftForce = base * leftDrive / totalDrive, rightForce = base * rightDrive / totalDrive;
  const bilateral = leftLimit > 0 && rightLimit > 0;
  state.bilateral = bilateral;
  if (bilateral && steeringEnabled && Number.isFinite(yawCommand) && Number.isFinite(yawRate)) {
    // +X is LEFT; a forward force on the right (-X) creates positive body yaw.
    // Opposite requests have zero net longitudinal force before saturation.
    const span = leftX / leftLimit - rightX / rightLimit;
    const inertia = positive(spec.inertia?.[1] ?? spec.mass * 2.6);
    const torque = inertia * state.yawResponse * (yawCommand - yawRate);
    const differential = span > .0001 ? bound(torque / span, -Math.min(leftLimit, rightLimit, budget / 2), Math.min(leftLimit, rightLimit, budget / 2)) : 0;
    leftForce -= differential; rightForce += differential;
    state.differential = differential;
  }
  // A turn cannot invent unlimited longitudinal engine force on top of drive.
  // At a neutral pivot the two opposite tracks share the same total budget.
  const totalRequest = Math.abs(leftForce) + Math.abs(rightForce);
  if (totalRequest > budget) {
    const scale = budget / totalRequest;
    leftForce *= scale; rightForce *= scale; state.differential *= scale;
  }
  state.leftForce = leftForce; state.rightForce = rightForce;
  for (let i = 0; i < 4; i++) {
    const w = wheels[i];
    if (!w.grounded || !positive(w.load) || !positive(w.drive) || !state.limits[i]) continue;
    const sideDrive = w.mount.x > 0 ? leftDrive : rightDrive;
    state.forces[i] = sideDrive ? (w.mount.x > 0 ? leftForce : rightForce) * w.drive / sideDrive : 0;
  }
  return state;
}

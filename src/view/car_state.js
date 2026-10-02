// CarState: the view-facing description of a car, identical whether it comes from the local sim or from network snapshots.
import * as THREE from 'three';
import { VEHICLES, rideInfo } from '../data/vehicles.js';

export const SPEC_IDS = Object.keys(VEHICLES);

export function makeCarState(id, specId, kind) {
  const spec = VEHICLES[specId];
  const ri = rideInfo(spec);
  return {
    id, specId, spec, kind, ride: ri,
    spin: new Float32Array(spec.wheels.length),
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(),
    steer: 0, nWheels: spec.wheels.length, poseRevision: 0,
    L: new Float32Array(spec.wheels.length),        // suspension length per wheel
    slip: new Float32Array(spec.wheels.length),     // 0..1 skid intensity
    grounded: new Uint8Array(spec.wheels.length),
    hp01: 1, driverAlive: true, gunnerAlive: true, gunner2Alive: true, exploded: false, dead: false, burning: false, smoking: false,
    braking: false, boosting: false, nitroRechargeLocked: false, drifting: false, rpm01: 0.2, speed: 0, airborne: false, engineHp01: 1,
    flat: new Uint8Array(spec.wheels.length),
    gunner: { yaw: 0, pitch: 0, fire: false, crouch: false, ads: false, weapon: 0, reloading: false, x: 0, z: 0 },
    gunner2: { yaw: 0, pitch: 0, fire: false, crouch: false },
    hitFlash: 0, age: 0, t: 0, gunName: null,
    elite: 0,        // 1..5 = miniboss index + 1 (view: warlord kit + nameplate)
    intent: null,    // raider intent: 'ram' | 'block' | 'shoot' | null (sim/ai.js EnemyBrain.intent)
  };
}

/** Fill a CarState from a sim Car at interpolation alpha. */
export function stateFromCar(car, alpha, st) {
  const v = car.veh;
  v.lerpPose(alpha, st.pos, st.quat);
  st.vel.copy(v.vel);
  st.poseRevision = v.poseRevision || 0;
  st.steer = v.steerAngle;
  for (let i = 0; i < v.wheels.length; i++) { const w = v.wheels[i]; st.L[i] = w.L; st.slip[i] = w.slip; st.grounded[i] = w.grounded ? 1 : 0; st.flat[i] = w.flat ? 1 : 0; }
  st.hp01 = car.hp / car.maxHp; st.driverAlive = car.crew.driver.alive; st.gunnerAlive = car.crew.gunner ? car.crew.gunner.alive : false; st.gunner2Alive = car.crew.gunner2 ? car.crew.gunner2.alive : false;
  st.exploded = car.exploded; st.dead = car.dead; st.burning = car.burning > 0; st.smoking = car.smoking;
  st.braking = v.brakeApplied > 0.1; st.boosting = v.boosting; st.nitroRechargeLocked = !!v.nitroRechargeLocked; st.drifting = v.drifting; st.rpm01 = v.rpm01; st.speed = v.speed;
  st.airborne = v.grounded === 0 && v.airTime > 0.12; st.engineHp01 = car.engineHp / 100;
  const g = car.crew.gunner; if (g) { st.gunner.yaw = g.aimYaw; st.gunner.pitch = g.aimPitch; st.gunner.fire = g.fire; st.gunner.crouch = g.crouch; st.gunner.ads = !!g.ads; st.gunner.weapon = g.weapon ?? 0; st.gunner.reloading = !!g.reloading; st.gunner.x = g.x || 0; st.gunner.z = g.z || 0; }
  const g2 = car.crew.gunner2; if (g2) { st.gunner2.yaw = g2.aimYaw; st.gunner2.pitch = g2.aimPitch; st.gunner2.fire = g2.fire; }
  st.hitFlash = car.hitFlash; st.age = car.age; st.gunName = car.gunName || null;
  st.elite = car.elite ? car.elite.index + 1 : 0; st.intent = car.ai ? car.ai.intent : null;
  return st;
}

// CarState: the view-facing description of a car, identical whether it comes from the local sim or from network snapshots.
import * as THREE from 'three';
import { VEHICLES, rideInfo } from '../data/vehicles.js';
import { GUNNER_ROLES } from '../sim/car.js';

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
    hp01: 1, driverAlive: true, gunnerAlive: true, gunner2Alive: true, gunner3Alive: false, gunner4Alive: false, exploded: false, dead: false, burning: false, smoking: false,
    braking: false, boosting: false, nitroRechargeLocked: false, drifting: false, rpm01: 0.2, speed: 0, airborne: false, engineHp01: 1,
    flat: new Uint8Array(spec.wheels.length),
    gunner: { yaw: 0, pitch: 0, fire: false, crouch: false, ads: false, weapon: 0, reloading: false, x: 0, z: 0 },
    gunner2: { yaw: 0, pitch: 0, fire: false, crouch: false, ads: false, reloading: false, weapon: 0, x: 0, z: 0 },
    gunner3: { yaw: 0, pitch: 0, fire: false, crouch: false, ads: false, reloading: false, weapon: 0, x: 0, z: 0 },
    gunner4: { yaw: 0, pitch: 0, fire: false, crouch: false, ads: false, reloading: false, weapon: 0, x: 0, z: 0 },
    hitFlash: 0, age: 0, t: 0, gunName: null, gunNames: {},
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
  st.hp01 = car.hp / car.maxHp; st.driverAlive = car.crew.driver.alive;
  st.exploded = car.exploded; st.dead = car.dead; st.burning = car.burning > 0; st.smoking = car.smoking;
  st.braking = v.brakeApplied > 0.1; st.boosting = v.boosting; st.nitroRechargeLocked = !!v.nitroRechargeLocked; st.drifting = v.drifting; st.rpm01 = v.rpm01; st.speed = v.speed;
  st.airborne = v.grounded === 0 && v.airTime > 0.12; st.engineHp01 = car.engineHp / 100;
  for (const role of GUNNER_ROLES) {
    const g = car.crew[role], target = st[role];
    st[role + 'Alive'] = !!g?.alive;
    if (g) { target.yaw = g.aimYaw; target.pitch = g.aimPitch; target.fire = !!g.fire; target.crouch = !!g.crouch;
      target.ads = !!g.ads; target.weapon = g.weapon ?? 0; target.reloading = !!g.reloading; target.x = g.x || 0; target.z = g.z || 0; }
    st.gunNames[role] = g ? car.gunNames?.[role] || car.gunName || null : null;
  }
  st.hitFlash = car.hitFlash; st.age = car.age; st.gunName = car.gunName || null;
  st.elite = car.elite ? car.elite.index + 1 : 0; st.intent = car.ai ? car.ai.intent : null;
  return st;
}

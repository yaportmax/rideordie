import MODEL_INFO from './enemy_variant_model_info.json' with { type: 'json' };

// Explicitly appended to the vehicle catalogue. Existing wire indices remain
// stable; protocol 5 advertises the extra crew and encounter capabilities.
export const ENEMY_VARIANT_IDS = Object.freeze([
  'e_barrel_carrier', 'e_grenadier', 'e_armored', 'e_monster', 'e_light_tank', 'e_warwagon',
]);

const handling = {
  susp: { freq: 1.95, zeta: .72, maxLen: .62, minLen: .17 },
  mountY: .20,
  grip: { front: 1.52, rear: 1.50, long: 1.32, gain: 15, slideMul: .88, hbLat: .40 },
  steerLockDeg: 30, yawRateMax: 1.65, yawAssist: 4.6,
  dragC: .55, downforce: .55, brakeDecel: 20, airLevel: 5,
  forceHeight: .17, hbDecel: 1.3, hullFriction: .15, hullRestitution: .08,
};

const templates = {
  e_barrel_carrier: {
    name: 'Cinder Hauler', mass: 2100, hp: 175,
    engine: { accel0: 4.1, vmax: 54, reverseMax: 10 },
    colliders: [
      { center: [0, .82, 0], half: [.97, .35, 2.7] },
      { center: [0, 1.4, 1.02], half: [.86, .34, .88] },
    ],
    gunners: 1, driverHp: 48, gunnerHp: 45, rollBarrels: true,
  },
  e_grenadier: {
    name: 'Lobber', mass: 1200, hp: 105,
    engine: { accel0: 4.8, vmax: 56, reverseMax: 10 },
    colliders: [{ center: [0, .85, 0], half: [.94, .36, 1.95] }],
    gunners: 1, driverHp: 42, gunnerHp: 42,
  },
  e_armored: {
    name: 'Ironback', mass: 3400, hp: 260,
    engine: { accel0: 3.1, vmax: 47, reverseMax: 8 },
    colliders: [
      { center: [0, 1.04, 0], half: [1.09, .54, 2.72] },
      { center: [0, 1.94, .1], half: [1.02, .36, 2.38] },
    ],
    gunners: 1, driverHp: 100, gunnerHp: 65,
    driverArmor: .96, gunnerArmor: .94,
    weakpoint: { zone: 'fuel', mul: 2.5 },
    hitZones: { fuel: { c: [0, 1.1, -2.72], h: [.46, .35, .24] } },
    // Physical rams still transfer momentum. Hull/rocket splash cannot replace
    // finding the exposed rear reactor with the gunner's aimed shots.
    crashMul: .24, weakpointBlastResist: 0,
  },
  e_monster: {
    name: 'Crusher', mass: 3900, hp: 340,
    engine: { accel0: 3.8, vmax: 49, reverseMax: 9 },
    colliders: [
      { center: [0, 1.30, 0], half: [1.04, .38, 2.65] },
      { center: [0, 2.03, .48], half: [.94, .51, 1.13] },
      { center: [0, .88, 1.67], half: [1.54, .36, .72] },
      { center: [0, .88, -1.67], half: [1.54, .36, .72] },
    ],
    inertia: [14000, 18000, 9200], mountY: -.12, angDamp: .8,
    susp: { freq: 1.65, zeta: .78, maxLen: .85, minLen: .30, arb: 135000 },
    yawRateMax: 1.1, yawAssist: 3.8, steerLockDeg: 25,
    gunners: 0, driverHp: 85, gunnerHp: 0,
  },
  e_light_tank: {
    name: 'Siegebreaker', mass: 7800, hp: 430,
    engine: { accel0: 2.45, vmax: 40, reverseMax: 7 },
    colliders: [
      { center: [0, .97, -.05], half: [1.37, .49, 2.83] },
      { center: [0, 1.84, -.02], half: [.83, .38, 1.39] },
    ],
    inertia: [39000, 47000, 14000], mountY: -.18, angDamp: 1,
    susp: { freq: 1.8, zeta: .80, maxLen: .53, minLen: .19, arb: 180000 },
    yawRateMax: .95, yawAssist: 3.2, steerLockDeg: 24,
    gunners: 1, driverHp: 130, gunnerHp: 80,
    driverArmor: .98, gunnerArmor: .96,
    weakpoint: { zone: 'fuel', mul: 3.0 },
    hitZones: { fuel: { c: [0, 1.65, -1.36], h: [.48, .32, .23] } },
    crashMul: .16, weakpointBlastResist: 0,
    // The authored barrel extends well ahead of the crew socket. The real
    // projectile must start outside its own armour, at the visible muzzle.
    gunMuzzles: { gunner: [0, 1.95, 3.70] },
  },
  e_warwagon: {
    name: 'Warwagon', mass: 3100, hp: 260,
    engine: { accel0: 3.2, vmax: 49, reverseMax: 9 },
    colliders: [
      { center: [0, .92, 0], half: [1.17, .40, 3.16] },
      { center: [0, 1.54, 1.55], half: [1.02, .32, 1.21] },
    ],
    gunners: 4, driverHp: 65, gunnerHp: 42,
  },
};

export function createEnemyVariantSpecs() {
  const result = {};
  for (const id of ENEMY_VARIANT_IDS) {
    const template = structuredClone(templates[id]), model = structuredClone(MODEL_INFO[id]);
    const seats = {};
    for (const role of ['driver', 'gunner', 'gunner2', 'gunner3', 'gunner4']) {
      seats[role] = model.sockets['seat_' + role]?.slice() ?? null;
    }
    const wheels = Object.entries(model.wheels).map(([name, wheel]) => ({
      name, x: wheel.x, z: wheel.z, front: name.startsWith('F'),
      drive: name.startsWith('F') ? .20 : .30,
      brake: name.startsWith('F') ? .30 : .20, hb: !name.startsWith('F'),
    }));
    result[id] = {
      ...structuredClone(handling), ...template,
      id, modelId: id, kind: 'enemy', colliderModelFrame: true,
      length: model.bbox.max[2] - model.bbox.min[2],
      width: model.bbox.max[0] - model.bbox.min[0], height: model.bbox.max[1],
      wheelRadius: model.wheels.FL.r, wheelWidth: model.wheels.FL.w,
      wheels, seats, model, audio: { engine: id === 'e_grenadier' ? 'engine_buggy' : 'engine_diesel' },
    };
    if (template.hitZones?.fuel && model.sockets.weak_fuel) result[id].hitZones.fuel.c = model.sockets.weak_fuel.slice();
    if (template.gunMuzzles && model.sockets.muzzle_cannon) result[id].gunMuzzles.gunner = model.sockets.muzzle_cannon.slice();
  }
  return result;
}

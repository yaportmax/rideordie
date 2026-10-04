import MODEL_INFO from './model_info.json' with { type: 'json' };
import PLAYER_MODEL_INFO from './player_model_info.json' with { type: 'json' };
import { createCityDoubleBusSpec } from './city_bus.js';
import { createEnemyVariantSpecs } from './enemy_variants.js';
import { createHummerBaseVehicleSpecs } from './hummer_base.js';
import HUMMER_MODEL_INFO from './hummer_model_info.json' with { type: 'json' };
import { ELITE_VEHICLE_MODEL_URLS } from './elite_vehicles.js';
// Static vehicle tables. Positions are meters in the model frame: +Z forward, +X LEFT, ground at y=0.
// `colliders`: boxes [center from ground at rest, half extents]. Physics is spec-driven (not model-driven) so both peers agree.

export const PLAYER_NITRO_RECHARGE_SECONDS = 12;
// Longer bursts on every player chassis, with a bounded full-recharge wait.
// Capacity remains seconds of boost; thrust and boosted top speed are unchanged.
function playerNitro(previousCapacity, mul) {
  const capacity = previousCapacity * 1.4;
  return { capacity, regen: capacity / PLAYER_NITRO_RECHARGE_SECONDS, mul };
}

function wheels4(track, zf, zr, front = { drive: 0.5, brake: 0.3 }, rear = { drive: 0.5, brake: 0.2 }) {
  return [
    { name: 'FL', x: track, z: zf, front: true, ...front },
    { name: 'FR', x: -track, z: zf, front: true, ...front },
    { name: 'RL', x: track, z: zr, hb: true, ...rear },
    { name: 'RR', x: -track, z: zr, hb: true, ...rear },
  ];
}

const truckBase = {
  wheelRadius: 0.36,
  susp: { freq: 2.1, zeta: 0.55, maxLen: 0.55, minLen: 0.16, arb: null },
  mountY: 0.22,
  grip: { front: 1.55, rear: 1.5, long: 1.3, gain: 15, slideMul: 0.86, hbLat: 0.3 },
  steerLockDeg: 34, yawRateMax: 2.3, yawAssist: 5.5, dragC: 0.42, downforce: 0.55, brakeDecel: 21, airLevel: 5,
  // tyre forces act low (0.15 m above the contact) so the body visibly rolls/pitches with the load; drifts keep momentum
  forceHeight: 0.15, hbDecel: 1.5, drift: { maxSlip: 0.55, thrust: 8 },
};

export const VEHICLES = {
  // A longer straight earns higher cruising speed: roughly 17% higher engine
  // limits with 14% gentler launch torque. Reverse limits stay parking-speed.
  // ---------------------------------------------------------------- player trucks
  truck_t1: {
    ...truckBase, id: 'truck_t1', name: 'Rustbucket', kind: 'player', tier: 1, family: 'rustbucket', familyStage: 1,
    mass: 1350, length: 4.9, width: 1.75, height: 1.75, hp: 400,
    wheels: wheels4(0.82, 1.5, -1.45), wheelRadius: 0.34,
    colliders: [{ center: [0, 0.72, 0], half: [0.86, 0.36, 2.4] }, { center: [0, 1.28, 0.65], half: [0.76, 0.32, 0.85] }],
    engine: { accel0: 4.3, vmax: 48, reverseMax: 11 }, nitro: playerNitro(1.0, 1.6),
    seats: { driver: [0.4, 0.55, 0.55], gunner: [0, 0.95, -0.85] },
  },
  truck_t2: {
    ...truckBase, id: 'truck_t2', hp: 560, name: 'Hauler', kind: 'player', tier: 2, family: 'rustbucket', familyStage: 2,
    mass: 1700, length: 5.6, width: 2.0, height: 1.9,
    wheels: wheels4(0.92, 1.72, -1.6), wheelRadius: 0.4,
    colliders: [{ center: [0, 0.8, 0], half: [0.98, 0.4, 2.75] }, { center: [0, 1.4, 0.8], half: [0.85, 0.36, 0.95] }],
    engine: { accel0: 4.65, vmax: 55, reverseMax: 12 }, nitro: playerNitro(2.0, 1.65),
    seats: { driver: [0.45, 0.6, 0.75], gunner: [0, 1.0, -0.95] },
  },
  truck_t3: {
    ...truckBase, id: 'truck_t3', hp: 760, name: 'Bruiser', kind: 'player', tier: 3, family: 'rustbucket', familyStage: 3,
    mass: 2300, length: 5.7, width: 2.1, height: 2.0,
    wheels: wheels4(0.96, 1.75, -1.65), wheelRadius: 0.42,
    colliders: [{ center: [0, 0.82, 0], half: [1.02, 0.42, 2.85] }, { center: [0, 1.45, 0.85], half: [0.88, 0.36, 0.95] }],
    engine: { accel0: 5.5, vmax: 62, reverseMax: 12 }, nitro: playerNitro(3.0, 1.7),
    seats: { driver: [0.48, 0.65, 0.8], gunner: [0, 1.05, -1.0] },
  },
  truck_t4: {
    ...truckBase, id: 'truck_t4', hp: 1000, name: 'Juggernaut', kind: 'player', tier: 4, family: 'rustbucket', familyStage: 4,
    mass: 3000, length: 6.2, width: 2.3, height: 2.2,
    wheels: wheels4(1.05, 1.95, -1.8), wheelRadius: 0.48,
    colliders: [{ center: [0, 0.95, 0], half: [1.12, 0.48, 3.1] }, { center: [0, 1.6, 0.95], half: [0.95, 0.38, 1.0] }],
    engine: { accel0: 6.55, vmax: 70, reverseMax: 13 }, nitro: playerNitro(4.0, 1.8),
    seats: { driver: [0.52, 0.72, 0.9], gunner: [0, 1.15, -1.1] },
  },

  // ---------------------------------------------------------------- enemies
  e_sedan: {
    ...truckBase, id: 'e_sedan', name: 'Bandit', kind: 'enemy', mass: 1500, length: 5.3, width: 1.95, height: 1.5, hp: 90,
    wheels: wheels4(0.85, 1.65, -1.6), wheelRadius: 0.33,
    colliders: [{ center: [0, 0.68, 0], half: [0.9, 0.34, 2.6] }, { center: [0, 1.15, 0.2], half: [0.78, 0.28, 1.0] }],
    engine: { accel0: 3.8, vmax: 51.5, reverseMax: 10 }, grip: { ...truckBase.grip, front: 1.4, rear: 1.35 },
    seats: { driver: [0.4, 0.5, 0.5], gunner: [0, 0.75, -0.8] }, gunners: 1, driverHp: 40, gunnerHp: 40,
  },
  e_muscle: {
    ...truckBase, id: 'e_muscle', name: 'Rammer', kind: 'enemy', mass: 1750, length: 5.1, width: 1.95, height: 1.35, hp: 150,
    wheels: wheels4(0.86, 1.6, -1.5), wheelRadius: 0.35,
    colliders: [{ center: [0, 0.62, 0], half: [0.92, 0.3, 2.55] }, { center: [0, 1.05, -0.1], half: [0.75, 0.26, 0.95] }],
    engine: { accel0: 5.35, vmax: 61, reverseMax: 12 },
    seats: { driver: [0.4, 0.45, 0.2], gunner: null }, gunners: 0, driverHp: 50, gunnerHp: 0,
  },
  e_buggy: {
    ...truckBase, id: 'e_buggy', name: 'Skirmisher', kind: 'enemy', mass: 850, length: 3.7, width: 2.0, height: 1.7, hp: 60,
    wheels: wheels4(0.9, 1.15, -1.1), wheelRadius: 0.4,
    colliders: [{ center: [0, 0.7, 0], half: [0.95, 0.3, 1.85] }],
    engine: { accel0: 5.15, vmax: 56, reverseMax: 10 }, grip: { ...truckBase.grip, front: 1.5, rear: 1.5 },
    seats: { driver: [0.35, 0.55, 0.15], gunner: [0, 0.7, -0.75] }, gunners: 1, driverHp: 35, gunnerHp: 35,
  },
  e_technical: {
    ...truckBase, id: 'e_technical', name: 'Technical', kind: 'enemy', mass: 1600, length: 5.0, width: 1.85, height: 1.9, hp: 150,
    wheels: wheels4(0.85, 1.5, -1.45), wheelRadius: 0.36,
    colliders: [{ center: [0, 0.75, 0], half: [0.9, 0.38, 2.5] }, { center: [0, 1.3, 0.7], half: [0.78, 0.32, 0.85] }],
    engine: { accel0: 4.15, vmax: 52.5, reverseMax: 10 },
    seats: { driver: [0.4, 0.55, 0.6], gunner: [0, 0.95, -0.9] }, gunners: 1, driverHp: 45, gunnerHp: 50,
  },
  e_van: {
    ...truckBase, id: 'e_van', name: 'Boxer', kind: 'enemy', mass: 2600, length: 5.6, width: 2.1, height: 2.4, hp: 320,
    wheels: wheels4(0.92, 1.75, -1.6), wheelRadius: 0.38,
    colliders: [{ center: [0, 1.15, 0], half: [1.0, 0.85, 2.75] }],
    engine: { accel0: 3.45, vmax: 47, reverseMax: 9 },
    seats: { driver: [0.45, 0.85, 1.2], gunner: [0, 1.5, -0.4] }, gunners: 1, driverHp: 60, gunnerHp: 60,
  },
  e_heavy: {
    ...truckBase, id: 'e_heavy', name: 'Hauler', kind: 'enemy', mass: 6000, length: 8.2, width: 2.6, height: 3.0, hp: 600,
    wheels: [
      { name: 'FL', x: 1.1, z: 3.0, front: true, drive: 0.2, brake: 0.2 }, { name: 'FR', x: -1.1, z: 3.0, front: true, drive: 0.2, brake: 0.2 },
      { name: 'ML', x: 1.1, z: -0.6, drive: 0.3, brake: 0.15 }, { name: 'MR', x: -1.1, z: -0.6, drive: 0.3, brake: 0.15 },
      { name: 'RL', x: 1.1, z: -2.2, drive: 0.3, brake: 0.15 }, { name: 'RR', x: -1.1, z: -2.2, drive: 0.3, brake: 0.15 },
    ].map((w) => ({ ...w, hb: !w.front })),
    wheelRadius: 0.55,
    colliders: [{ center: [0, 1.4, 0.8], half: [1.25, 0.9, 3.9] }],
    engine: { accel0: 2.4, vmax: 40, reverseMax: 8 },
    seats: { driver: [0.5, 1.3, 2.8], gunner: [0, 1.7, -1.6], gunner2: [0.3, 1.7, -3.0] }, gunners: 2, driverHp: 80, gunnerHp: 70,
    susp: { freq: 1.6, zeta: 0.6, maxLen: 0.7, minLen: 0.2 },
  },
  e_tanker: {
    ...truckBase, id: 'e_tanker', name: 'Fuel Bomb', kind: 'enemy', mass: 7000, length: 9.5, width: 2.6, height: 3.2, hp: 420,
    wheels: [
      { name: 'FL', x: 1.1, z: 3.6, front: true, drive: 0.2, brake: 0.2 }, { name: 'FR', x: -1.1, z: 3.6, front: true, drive: 0.2, brake: 0.2 },
      { name: 'ML', x: 1.1, z: -1.0, drive: 0.3, brake: 0.15 }, { name: 'MR', x: -1.1, z: -1.0, drive: 0.3, brake: 0.15 },
      { name: 'RL', x: 1.1, z: -2.6, drive: 0.3, brake: 0.15 }, { name: 'RR', x: -1.1, z: -2.6, drive: 0.3, brake: 0.15 },
    ].map((w) => ({ ...w, hb: !w.front })),
    wheelRadius: 0.55,
    colliders: [{ center: [0, 1.3, 1.9], half: [1.2, 0.8, 1.6] }, { center: [0, 1.7, -1.6], half: [1.2, 1.0, 3.6] }],
    engine: { accel0: 2.25, vmax: 39, reverseMax: 8 },
    seats: { driver: [0.5, 1.3, 3.3], gunner: [0, 2.3, 2.6] }, gunners: 1, driverHp: 80, gunnerHp: 70, explosive: true,
    susp: { freq: 1.5, zeta: 0.6, maxLen: 0.7, minLen: 0.2 },
  },

  // New IDs stay AFTER every legacy ID: snapshots encode the catalogue index.
  // Family stages reuse their own chassis mesh, not the pickup chassis. The
  // shop/save migration must be enabled together before these are purchasable.
  player_sedan_t1: {
    ...truckBase, id: 'player_sedan_t1', modelId: 'player_sedan_t1', name: 'Scrap Sedan', kind: 'player', tier: 1, family: 'sedan', familyStage: 1,
    mass: 1200, length: 5.278, width: 2.175996, height: 1.67, hp: 280,
    wheels: wheels4(.79, 1.62, -1.42), wheelRadius: .39,
    colliders: [{ center: [0, .66, 0], half: [.88, .31, 2.48] }, { center: [0, 1.18, .25], half: [.76, .29, .73] }],
    colliderModelFrame: true,
    engine: { accel0: 4.4, vmax: 46, reverseMax: 10 }, nitro: playerNitro(.85, 1.55),
    grip: { ...truckBase.grip, front: 1.58, rear: 1.53, long: 1.34 },
    seats: { driver: [.4, .56, .03], gunner: [0, .555, -.86] },
    audio: { engine: 'engine_sedan' },
  },
  player_sedan_t2: {
    ...truckBase, id: 'player_sedan_t2', modelId: 'player_sedan_t1', name: 'Road Runner', kind: 'player', tier: 2, family: 'sedan', familyStage: 2,
    mass: 1350, length: 5.278, width: 2.175996, height: 1.67, hp: 360,
    wheels: wheels4(.79, 1.62, -1.42), wheelRadius: .39,
    colliders: [{ center: [0, .66, 0], half: [.88, .31, 2.48] }, { center: [0, 1.18, .25], half: [.76, .29, .73] }],
    colliderModelFrame: true,
    engine: { accel0: 4.95, vmax: 54, reverseMax: 10 }, nitro: playerNitro(1.35, 1.6),
    grip: { ...truckBase.grip, front: 1.64, rear: 1.59, long: 1.4 },
    seats: { driver: [.4, .56, .03], gunner: [0, .555, -.86] },
    audio: { engine: 'engine_sedan' },
  },
  player_buggy_t1: {
    ...truckBase, id: 'player_buggy_t1', modelId: 'player_buggy_t1', name: 'Dune Buggy', kind: 'player', tier: 1, family: 'buggy', familyStage: 1,
    mass: 900, length: 3.756243, width: 1.99075, height: 1.72, hp: 300,
    wheels: wheels4(.84, 1.2, -1.1), wheelRadius: .4,
    colliders: [{ center: [0, .67, 0], half: [.77, .3, 1.62] }], colliderModelFrame: true,
    engine: { accel0: 5.3, vmax: 58, reverseMax: 10 }, nitro: playerNitro(1.55, 1.65),
    grip: { ...truckBase.grip, front: 1.65, rear: 1.6, long: 1.4 },
    susp: { ...truckBase.susp, freq: 2.1, zeta: .62, maxLen: .6, minLen: .15 },
    seats: { driver: [.36, .5, .14], gunner: [0, .7, -.68] },
    hitZones: { engine: { c: [0, .8, -1.28], h: [.48, .27, .49] }, fuel: { c: [0, .51, -.5], h: [.38, .21, .3] } },
    enginePanel: 'panel_trunk', engineLayout: 'rear', audio: { engine: 'engine_buggy' },
  },
  player_buggy_t2: {
    ...truckBase, id: 'player_buggy_t2', modelId: 'player_buggy_t1', name: 'Dune Runner', kind: 'player', tier: 2, family: 'buggy', familyStage: 2,
    mass: 1050, length: 3.756243, width: 1.99075, height: 1.72, hp: 380,
    wheels: wheels4(.84, 1.2, -1.1), wheelRadius: .4,
    colliders: [{ center: [0, .67, 0], half: [.77, .3, 1.62] }], colliderModelFrame: true,
    engine: { accel0: 5.8, vmax: 64, reverseMax: 10 }, nitro: playerNitro(2.25, 1.7),
    grip: { ...truckBase.grip, front: 1.7, rear: 1.65, long: 1.44 },
    susp: { ...truckBase.susp, freq: 2.1, zeta: .62, maxLen: .6, minLen: .15 },
    seats: { driver: [.36, .5, .14], gunner: [0, .7, -.68] },
    hitZones: { engine: { c: [0, .8, -1.28], h: [.48, .27, .49] }, fuel: { c: [0, .51, -.5], h: [.38, .21, .3] } },
    enginePanel: 'panel_trunk', engineLayout: 'rear', audio: { engine: 'engine_buggy' },
  },
  player_buggy_t3: {
    ...truckBase, id: 'player_buggy_t3', modelId: 'player_buggy_t1', name: 'Sandstorm', kind: 'player', tier: 3, family: 'buggy', familyStage: 3,
    mass: 1150, length: 3.756243, width: 1.99075, height: 1.72, hp: 460,
    wheels: wheels4(.84, 1.2, -1.1), wheelRadius: .4,
    colliders: [{ center: [0, .67, 0], half: [.77, .3, 1.62] }], colliderModelFrame: true,
    engine: { accel0: 6.4, vmax: 70, reverseMax: 10 }, nitro: playerNitro(3.0, 1.75),
    grip: { ...truckBase.grip, front: 1.74, rear: 1.69, long: 1.48 },
    susp: { ...truckBase.susp, freq: 2.1, zeta: .62, maxLen: .6, minLen: .15 },
    seats: { driver: [.36, .5, .14], gunner: [0, .7, -.68] },
    hitZones: { engine: { c: [0, .8, -1.28], h: [.48, .27, .49] }, fuel: { c: [0, .51, -.5], h: [.38, .21, .3] } },
    enginePanel: 'panel_trunk', engineLayout: 'rear', audio: { engine: 'engine_buggy' },
  },
};

export function playerTruck(tier) { return VEHICLES['truck_t' + tier]; }
/** Resolve stage aliases once so loading, rendering and shader warming agree. */
export function vehicleModelURL(specOrId) {
  const spec = typeof specOrId === 'string' ? VEHICLES[specOrId] : specOrId;
  const id = spec?.modelId ?? spec?.id ?? specOrId;
  return `/models/vehicles/${id}.glb`;
}
export function vehicleModelURLs() { return [...new Set([...Object.values(VEHICLES).map(vehicleModelURL), ...ELITE_VEHICLE_MODEL_URLS])]; }

/** Shared ride-height maths (must match Vehicle's constructor). */
export function rideInfo(spec) {
  const sp = spec.susp, n = spec.wheels.length, pm = spec.mass / n;
  const freq = sp.freq ?? 2.1, k = sp.k ?? pm * Math.pow(2 * Math.PI * freq, 2);
  const maxLen = sp.maxLen ?? 0.55, staticComp = (pm * 17.5) / k, restLen = maxLen - staticComp, mountY = spec.mountY ?? 0.22;
  return { maxLen, restLen, mountY, restComHeight: restLen + spec.wheelRadius - mountY };
}

/** Merge extracted GLB metadata (wheel positions/radius, seat sockets, size) into the hand-written specs so physics matches the art. */
function applyModelInfo() {
  for (const [id, spec] of Object.entries(VEHICLES)) {
    const modelId = spec.modelId ?? id;
    const mi = PLAYER_MODEL_INFO[modelId] ?? MODEL_INFO[modelId]; if (!mi) continue;
    const names = Object.keys(mi.wheels);
    if (names.length) {
      const front = mi.wheels.FL || mi.wheels[names[0]];
      spec.wheelRadius = front.r > 0.15 ? front.r : spec.wheelRadius;
      spec.wheelWidth = front.w;
      // wheels present in the model that the spec does not list (extra axles) are added; drive/brake shares renormalised
      const have = new Map(spec.wheels.map((w) => [w.name, w]));
      for (const n of names) if (!have.has(n)) { const tw = { name: n, x: mi.wheels[n].x, z: mi.wheels[n].z, front: false, drive: 0.3, brake: 0.15, hb: true }; spec.wheels.push(tw); have.set(n, tw); }
      spec.wheels = spec.wheels.filter((w) => mi.wheels[w.name]);
      for (const w of spec.wheels) { const m = mi.wheels[w.name]; w.x = m.x; w.z = m.z; }
      const dsum = spec.wheels.reduce((a, w) => a + (w.drive || 0), 0) || 1, bsum = spec.wheels.reduce((a, w) => a + (w.brake || 0), 0) || 1;
      for (const w of spec.wheels) { w.drive = (w.drive || 0) / dsum; w.brake = (w.brake || 0) / bsum; }
    }
    const S = mi.sockets;
    if (S.seat_driver) spec.seats.driver = S.seat_driver.slice();
    if (S.seat_gunner) spec.seats.gunner = S.seat_gunner.slice();
    if (S.seat_gunner2) spec.seats.gunner2 = S.seat_gunner2.slice();
    if (S.steering_wheel) spec.steeringWheel = S.steering_wheel.slice();
    const [lo, hi] = [mi.bbox.min, mi.bbox.max];
    const L = hi[2] - lo[2], W = hi[0] - lo[0];
    const sx = Math.min(1.4, Math.max(0.7, (W - 0.15) / spec.width)), sz = Math.min(1.4, Math.max(0.7, L / spec.length));
    if (!spec.colliderModelFrame) spec.colliders = spec.colliders.map((b) => ({ center: [b.center[0] * sx, b.center[1], b.center[2] * sz], half: [b.half[0] * sx, b.half[1], b.half[2] * sz] }));
    spec.length = L; spec.width = W;
    spec.model = { bbox: mi.bbox, sockets: S, wheels: mi.wheels, parts: mi.parts };
  }
}
// Append after legacy/player IDs so every previous snapshot catalogue index
// keeps its identity. Protocol4 gates clients that know the bus and chapters.
VEHICLES.e_double_bus = createCityDoubleBusSpec();
Object.assign(VEHICLES, createEnemyVariantSpecs());
// Append the new player base after every legacy ID to preserve snapshot indices.
Object.assign(VEHICLES, createHummerBaseVehicleSpecs(HUMMER_MODEL_INFO));
applyModelInfo();

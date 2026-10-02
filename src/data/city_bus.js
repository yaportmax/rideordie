import MODEL from './city_bus_model_info.json' with { type: 'json' };

// Integration is deliberately explicit: append this ID to the shared vehicle
// catalogue and version its network capability together. Importing this module
// alone does not add an enemy or change legacy snapshot indices.
export const CITY_BUS_ID = 'e_double_bus';
export const CITY_BUS_MODEL_URL = '/models/vehicles/e_double_bus.glb';

/** Fresh complete physics/render contract; all positions are ground-frame metres. */
export function createCityDoubleBusSpec() {
  const model = structuredClone(MODEL), bounds = model.bbox;
  const wheel = (name, front) => ({
    name, x: model.wheels[name].x, z: model.wheels[name].z, front,
    drive: front ? 0 : .5, brake: front ? .30 : .20, hb: !front,
  });
  return {
    id: CITY_BUS_ID, modelId: CITY_BUS_ID, name: 'Double Decker', kind: 'enemy',
    mass: 10000, hp: 740,
    length: bounds.max[2] - bounds.min[2], width: bounds.max[0] - bounds.min[0], height: bounds.max[1],
    // Tall bus requires its own inertia and lower suspension mounts. Its COM
    // rests ~1.31m high, rather than using a pickup's inertia/ride geometry.
    inertia: [88000, 80000, 20500], mountY: -.35, angDamp: 1.0,
    wheelRadius: model.wheels.FL.r, wheelWidth: model.wheels.FL.w,
    wheels: [wheel('FL', true), wheel('FR', true), wheel('RL', false), wheel('RR', false)],
    susp: { freq: 1.8, zeta: .72, maxLen: .60, minLen: .20, arb: 180000 },
    colliderModelFrame: true, clearance: .54,
    colliders: [
      { center: [0, .91, 0], half: [1.20, .34, 4.58] },
      { center: [0, 1.77, 0], half: [1.18, .55, 4.54] },
      { center: [0, 3.34, 0], half: [1.18, .83, 4.54] },
    ],
    engine: { accel0: 2.15, vmax: 37, reverseMax: 7 },
    grip: { front: 1.42, rear: 1.40, long: 1.26, gain: 14, slideMul: .90, hbLat: .45 },
    steerLockDeg: 24, yawRateMax: .85, yawAssist: 3.4, hiSpeedYaw: .68,
    dragC: .90, downforce: .45, brakeDecel: 17, airLevel: 4,
    forceHeight: .22, hbDecel: 1.0, hullFriction: .12, hullRestitution: .10,
    seats: {
      driver: [...model.sockets.seat_driver],
      gunner: [...model.sockets.seat_gunner],
      gunner2: [...model.sockets.seat_gunner2],
    },
    steeringWheel: [...model.sockets.steering_wheel],
    gunners: 2, driverHp: 80, gunnerHp: 70,
    hitZones: {
      engine: { c: [...model.sockets.weak_engine], h: [.84, .34, .46] },
      fuel: { c: [...model.sockets.weak_fuel], h: [.34, .22, .65] },
    },
    engineLayout: 'rear', enginePanel: 'panel_trunk', audio: { engine: 'engine_diesel' },
    model,
  };
}

export const CITY_DOUBLE_BUS = createCityDoubleBusSpec();

// Encounter authoring bounds for the Director integration owner. They are not
// silently enforced here: active density, free spawn volume and overhead/road
// clearance must be checked by the real city encounter, then played natively.
export const CITY_BUS_ENCOUNTER = Object.freeze({
  cityOnly: true, maxActive: 1,
  halfLength: Math.max(Math.abs(MODEL.bbox.min[2]), Math.abs(MODEL.bbox.max[2])),
  halfWidth: Math.max(Math.abs(MODEL.bbox.min[0]), Math.abs(MODEL.bbox.max[0])),
  frontExtent: MODEL.bbox.max[2], rearExtent: -MODEL.bbox.min[2],
  minimumOverheadClearance: 4.65,
  maximumStaticBodyDraws: 4,
  movingWheelNodes: 4,
});

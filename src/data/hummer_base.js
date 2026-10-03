// WORK-only base wagon definition. Metres: +X left, +Y up, +Z forward.
// Requires newly exported measurements; declared targets are rejected.
export const HUMMER_BASE_ID = 'player_hummer_t1';
export const HUMMER_BASE_CAPS = Object.freeze({ engine: 4, armor: 5, tires: 4, nitro: 3, ram: 3, spikes: 2, glass: 2, fueltank: 2, oil: 2, mines: 2 });
export const HUMMER_BASE_FAMILY = Object.freeze({
  name: 'HUMMER', stageIDs: Object.freeze([HUMMER_BASE_ID]),
  emphasis: 'Heavy off-road utility and protection', caps: HUMMER_BASE_CAPS,
});
export const HUMMER_BASE_CATALOGUE = Object.freeze({
  id: HUMMER_BASE_ID, family: 'hummer', tier: 1, name: 'HUMMER', cost: 100000,
  blurb: 'A wide four-door utility wagon with a low hood and a supported roof gunner station.',
});
const finite3 = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
const requiredSockets = ['seat_driver', 'seat_gunner', 'steering_wheel', 'weak_engine', 'weak_fuel',
  'mirror_L', 'mirror_R', 'mirror_C', 'part_nitro', 'part_fuel', 'part_oil', 'part_mines', 'upgrade_engine', 'mounted_deck', 'gun_mount'];
const requiredPanels = ['panel_hood', 'panel_door_L', 'panel_door_R', 'panel_door_L2', 'panel_door_R2',
  'panel_trunk', 'panel_bumper_F', 'panel_bumper_R', 'panel_windshield'];
const authoredWorldSockets = {
  mirror_L: [1.23, 1.62, .528], mirror_R: [-1.23, 1.62, .528], mirror_C: [0, 1.73, .80],
  steering_wheel: [.44, 1.21, .70], seat_driver: [.44, .84, .24], seat_gunner: [0, 1.02, -1.50],
  mounted_deck: [0, 1.02, -.92], gun_mount: [0, 2.24, -.92],
};

export function validateHummerBaseMetadata(info) {
  if (info?.id !== HUMMER_BASE_ID || info.authoringStatus !== 'exported-unaccepted' || info.authoringRevision !== 'hummer-base-v6-mirrors') {
    throw new Error('Hummer requires v6 rigid mirror exported measurements; authoring targets cannot be shipped');
  }
  if (info.glb?.file !== 'player_hummer_t1.glb' || !/^[a-f0-9]{64}$/.test(info.glb?.sha256 || '') || !Number.isInteger(info.glb?.bytes) || info.glb.bytes <= 20) {
    throw new Error('Hummer metadata requires its exact exported GLB byte binding');
  }
  if (info.roundTrip?.complete !== true || info.roundTrip.toleranceMetres !== .00005 || !Number.isFinite(info.roundTrip.maxDeltaMetres) || info.roundTrip.maxDeltaMetres < 0 || info.roundTrip.maxDeltaMetres > .00005 || !Array.isArray(info.roundTrip.records) || !info.roundTrip.records.length) {
    throw new Error('Hummer requires measured exported GLB round-trip validation');
  }
  if (info.roundTrip.materialNamesEqual !== true || info.roundTrip.basisComponentTolerance !== .00005 || !Number.isFinite(info.roundTrip.maxDeltaBasisComponent) || info.roundTrip.maxDeltaBasisComponent < 0 || info.roundTrip.maxDeltaBasisComponent > .00005) throw new Error('Hummer requires preserved material names and socket orientations');
  if (!finite3(info.bbox?.min) || !finite3(info.bbox?.max) || info.bbox.max.some((v, i) => v <= info.bbox.min[i])) throw new Error('Invalid Hummer bounds');
  if (Object.keys(info.wheels || {}).sort().join(',') !== 'FL,FR,RL,RR') throw new Error('Hummer requires exactly four authored wheel pivots');
  for (const name of ['FL', 'FR', 'RL', 'RR']) {
    const w = info.wheels[name];
    if (!w || ![w.x, w.y, w.z, w.r, w.w].every(Number.isFinite) || w.r <= 0 || w.w <= 0) throw new Error(`Invalid Hummer wheel ${name}`);
    if (Math.abs(w.r - info.wheels.FL.r) > .002) throw new Error('Hummer wheel controller requires equal radii');
  }
  for (const name of requiredSockets) {
    if (!finite3(info.sockets?.[name])) throw new Error(`Missing Hummer socket ${name}`);
    for (const axis of ['x', 'y', 'z']) if (!finite3(info.socketBasis?.[name]?.[axis])) throw new Error(`Missing Hummer socket basis ${name}.${axis}`);
  }
  if (info.authoredPose?.complete !== true) throw new Error('Hummer requires authored world-pose checks, not only a round trip');
  for (const phase of ['builtBeforeReparent', 'preExport', 'postImport']) {
    const check = info.authoredPose[phase];
    if (check?.complete !== true || check.toleranceMetres !== .00005 || check.basisComponentTolerance !== .00005 ||
      !Number.isFinite(check.maxDeltaMetres) || check.maxDeltaMetres < 0 || check.maxDeltaMetres > .00005 ||
      !Number.isFinite(check.maxDeltaBasisComponent) || check.maxDeltaBasisComponent < 0 || check.maxDeltaBasisComponent > .00005 ||
      check.socketCount !== Object.keys(info.sockets).length || !Array.isArray(check.records) || check.records.length !== check.socketCount) {
      throw new Error(`Missing Hummer authored pose phase ${phase}`);
    }
  }
  for (const [name, expected] of Object.entries(authoredWorldSockets)) {
    if (info.sockets[name].some((value, axis) => Math.abs(value - expected[axis]) > .00005)) throw new Error(`Hummer socket left its authored world pose: ${name}`);
  }
  // Exact independent authored basis: centre remains rearward. Both side
  // housings and sockets now yaw inward toward this wide body's driver eye.
  // V5's correctly exported180-degree sides were almost edge-on in native play.
  for (const [name, degrees] of [['mirror_L', -106], ['mirror_R', 98], ['mirror_C', 180]]) {
    const yaw = degrees * Math.PI / 180;
    const expected = { x: [Math.cos(yaw), 0, -Math.sin(yaw)], y: [0, 1, 0], z: [Math.sin(yaw), 0, Math.cos(yaw)] };
    for (const axis of ['x', 'y', 'z']) if (info.socketBasis[name][axis].some((value, component) => Math.abs(value - expected[axis][component]) > .00005)) throw new Error(`Hummer mirror left its authored rigid housing orientation: ${name}.${axis}`);
  }
  const tilt = 24 * Math.PI / 180;
  const steeringBasis = { x: [1, 0, 0], y: [0, Math.cos(tilt), Math.sin(tilt)], z: [0, -Math.sin(tilt), Math.cos(tilt)] };
  for (const axis of ['x', 'y', 'z']) if (info.socketBasis.steering_wheel[axis].some((value, component) => Math.abs(value - steeringBasis[axis][component]) > .00005)) throw new Error(`Hummer steering must keep its authored 24-degree tilt: ${axis}`);
  const seat = info.sockets.seat_gunner, deck = info.sockets.mounted_deck;
  if (deck.some((v, i) => Math.abs(v - seat[i] - (i === 2 ? .58 : 0)) > .002)) throw new Error('Hummer deck target must match the current mounted-seat offset');
  for (const name of requiredPanels) {
    const b = info.parts?.[name];
    if (!finite3(b?.min) || !finite3(b?.max) || b.max.some((v, i) => v <= b.min[i])) throw new Error(`Missing Hummer measured panel ${name}`);
  }
  const proxies = info.collisionProxies;
  if (!Array.isArray(proxies) || proxies.length !== 2 || proxies.some(b => !finite3(b.center) || !finite3(b.half) || b.half.some(v => v <= 0))) throw new Error('Missing Hummer ground-frame collider definitions');
  return info;
}

export function createHummerBaseVehicleSpecs(modelInfo) {
  validateHummerBaseMetadata(modelInfo);
  const [lo, hi] = [modelInfo.bbox.min, modelInfo.bbox.max];
  const capacity = 1.54; // proposed finite stock boost, no purchased upgrade level
  const spec = {
    id: HUMMER_BASE_ID, modelId: HUMMER_BASE_ID, name: 'Hummer', kind: 'player', tier: 1, family: 'hummer', familyStage: 1,
    assetMetadataStatus: modelInfo.authoringStatus, assetSHA256: modelInfo.glb.sha256, driveMode: 'wheels',
    // Preserve V5 physical/traffic width while decorative mirror bounds change.
    mass: 3100, hp: 460, length: hi[2] - lo[2], width: 2.62, height: hi[1] - lo[1],
    wheelRadius: modelInfo.wheels.FL.r, wheelWidth: modelInfo.wheels.FL.w,
    wheels: ['FL', 'FR', 'RL', 'RR'].map(name => ({ name, x: modelInfo.wheels[name].x, z: modelInfo.wheels[name].z,
      front: name[0] === 'F', drive: .25, brake: name[0] === 'F' ? .3 : .2, hb: name[0] === 'R' })),
    mountY: .15, inertia: [8000, 8800, 2700],
    susp: { freq: 1.85, zeta: .68, maxLen: .60, minLen: .18, arb: null },
    grip: { front: 1.55, rear: 1.50, long: 1.30, gain: 15, slideMul: .86, hbLat: .3 },
    steerLockDeg: 32, yawRateMax: 1.9, yawAssist: 5.5, dragC: .49, downforce: .65, brakeDecel: 20, airLevel: 5,
    forceHeight: .15, hbDecel: 1.5, drift: { maxSlip: .45, thrust: 7 },
    engine: { accel0: 3.8, vmax: 57, reverseMax: 10 }, nitro: { capacity, regen: capacity / 12, mul: 1.6 },
    colliders: modelInfo.collisionProxies.map(b => ({ center: [...b.center], half: [...b.half] })), colliderModelFrame: true,
    seats: { driver: [...modelInfo.sockets.seat_driver], gunner: [...modelInfo.sockets.seat_gunner] }, gunners: 1,
    steeringWheel: [...modelInfo.sockets.steering_wheel],
    cockpit: { frontGlassPanel: 'panel_windshield', mirrorLayout: { C: [.25, .07, .012], L: [.16, .20, .018], R: [.16, .20, .018] } },
    enginePanel: 'panel_hood', engineLayout: 'front', audio: { engine: 'engine_diesel' },
    hitZones: { engine: { c: [...modelInfo.sockets.weak_engine], h: [.55, .24, .40] }, fuel: { c: [...modelInfo.sockets.weak_fuel], h: [.35, .18, .425] } },
    model: structuredClone({ bbox: modelInfo.bbox, wheels: modelInfo.wheels, sockets: modelInfo.sockets, socketBasis: modelInfo.socketBasis, parts: modelInfo.parts }),
  };
  return { [HUMMER_BASE_ID]: spec };
}

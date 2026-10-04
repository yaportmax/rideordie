// HELD original tracked carrier. Exact exported metadata is mandatory.
// No target metadata, mock GLB or native acceptance is supplied with this source.
export const TANK_BASE_ID = 'player_tank_t1';
export const TANK_BASE_CAPS = Object.freeze({ engine: 3, armor: 5, tires: 4, nitro: 2, ram: 3, spikes: 2, glass: 2, fueltank: 2, oil: 2, mines: 2 });
export const TANK_BASE_FAMILY = Object.freeze({ name: 'BASTION TANK', stageIDs: Object.freeze([TANK_BASE_ID]),
  emphasis: 'Tracked protection and crushing rams', caps: TANK_BASE_CAPS });
export const TANK_BASE_CATALOGUE = Object.freeze({ id: TANK_BASE_ID, family: 'tank', tier: 1, name: 'BASTION TANK', cost: 250000,
  blurb: 'A distinct low tracked assault carrier. Heavy, deliberate and protected; equip your own roof weapon.' });
export const TANK_AUTHORED_SOCKETS = Object.freeze({
  seat_driver: [.52, .62, 1.16], seat_gunner: [0, 1.31, -.75], steering_wheel: [.52, .99, 1.73],
  mounted_deck: [0, 1.31, -.17], gun_mount: [0, 2.53, -.17], turret: [0, 1.31, -.17],
  mirror_L: [1.32, 1.45, 1.63], mirror_R: [-1.32, 1.45, 1.63], mirror_C: [0, 1.65, 1.76],
  track_front_L: [1.23, .43, 2.05], track_front_R: [-1.23, .43, 2.05],
  track_rear_L: [1.23, .43, -2.05], track_rear_R: [-1.23, .43, -2.05],
});
const finite3 = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const validBox = b => finite3(b?.min) && finite3(b?.max) && b.max.every((v, i) => v > b.min[i]);
const close = (a, b) => finite3(a) && a.every((v, i) => Math.abs(v - b[i]) <= .00005);
const poseOK = p => p?.complete === true && p.toleranceMetres === .00005 && p.basisComponentTolerance === .00005
  && Number.isFinite(p.maxDeltaMetres) && p.maxDeltaMetres >= 0 && p.maxDeltaMetres <= .00005
  && Number.isFinite(p.maxDeltaBasisComponent) && p.maxDeltaBasisComponent >= 0 && p.maxDeltaBasisComponent <= .00005;

export function validateTankBaseMetadata(info) {
  if (info?.id !== TANK_BASE_ID || info.authoringStatus !== 'exported-unaccepted' || info.authoringRevision !== 'tank-current-integration-v1') throw new Error('Tank requires freshly exported current-integration v1 measurements');
  if (info.glb?.file !== `${TANK_BASE_ID}.glb` || !/^[a-f0-9]{64}$/.test(info.glb?.sha256 || '') || !Number.isInteger(info.glb?.bytes) || info.glb.bytes <= 20) throw new Error('Tank requires exact GLB bytes');
  if (!poseOK(info.roundTrip) || info.roundTrip.materialNamesEqual !== true || !info.roundTrip.records?.length) throw new Error('Tank requires actual GLB re-import round trip');
  if (info.authoredPose?.complete !== true) throw new Error('Tank requires independent authored pose checks');
  for (const phase of ['builtBeforeReparent', 'preExport', 'postImport']) {
    const p = info.authoredPose[phase];
    if (!poseOK(p) || p.socketCount !== Object.keys(info.sockets || {}).length || p.records?.length !== p.socketCount) throw new Error(`Tank authored pose phase missing: ${phase}`);
  }
  for (const [id, p] of Object.entries(TANK_AUTHORED_SOCKETS)) if (!close(info.sockets?.[id], p)) throw new Error(`Tank socket differs from authored pose: ${id}`);
  for (const id of ['weak_engine', 'weak_fuel', 'part_nitro', 'part_fuel', 'part_oil', 'part_mines', 'upgrade_engine']) if (!finite3(info.sockets?.[id])) throw new Error(`Missing tank socket: ${id}`);
  for (const id of Object.keys(info.sockets)) for (const axis of ['x', 'y', 'z']) if (!finite3(info.socketBasis?.[id]?.[axis])) throw new Error(`Missing tank basis: ${id}.${axis}`);
  for (const [id, deg] of [['mirror_L', -115], ['mirror_R', 102], ['mirror_C', 180]]) {
    const a = deg * Math.PI / 180, expected = { x: [Math.cos(a), 0, -Math.sin(a)], y: [0, 1, 0], z: [Math.sin(a), 0, Math.cos(a)] };
    for (const axis of ['x', 'y', 'z']) if (!close(info.socketBasis[id][axis], expected[axis])) throw new Error(`Tank mirror orientation lost: ${id}.${axis}`);
  }
  if (!validBox(info.bbox)) throw new Error('Missing measured tank visual bounds');
  if (Object.keys(info.wheels || {}).sort().join(',') !== 'FL,FR,RL,RR') throw new Error('Tank wire state retains exactly four contacts');
  for (const id of ['FL', 'FR', 'RL', 'RR']) {
    const w = info.wheels[id];
    if (!w || ![w.x, w.y, w.z, w.r, w.w].every(Number.isFinite) || w.r <= 0 || w.w <= 0 || Math.abs(w.r - info.wheels.FL.r) > .002) throw new Error(`Invalid measured tank roadwheel: ${id}`);
  }
  for (const id of ['panel_hood', 'panel_door_L', 'panel_door_R', 'panel_trunk', 'panel_bumper_F', 'panel_bumper_R', 'panel_windshield', 'panel_turret', 'part_track_L', 'part_track_R',
    ...['L', 'R'].flatMap(side => [0, 1, 2, 3].map(i => `part_roadwheel_${side}${i}`))]) if (!validBox(info.parts?.[id])) throw new Error(`Missing actual tank geometry: ${id}`);
  const track = info.trackContract;
  if (track?.shoeCountPerSide !== 64 || track.pathRadius !== .36 || track.contactRadius !== .39 || track.shoeWidth !== .42 || track.staticNodeNames?.join(',') !== 'part_track_L,part_track_R') throw new Error('Unsupported authored tank belt contract');
  if (Math.abs(info.parts.part_track_L.min[1] - .04) > .015 || Math.abs(info.parts.part_track_R.min[1] - .04) > .015) throw new Error('Actual belt sole does not match authored contact radius');
  if (!Array.isArray(info.collisionProxies) || info.collisionProxies.length !== 2 || info.collisionProxies.some(p => !finite3(p.center) || !finite3(p.half) || p.half.some(x => x <= 0))) throw new Error('Tank requires explicit ground-frame collision proxies');
  return info;
}

export function createTankBaseVehicleSpecs(info) {
  validateTankBaseMetadata(info);
  const capacity = 1.4, [lo, hi] = [info.bbox.min, info.bbox.max];
  const spec = {
    id: TANK_BASE_ID, modelId: TANK_BASE_ID, name: 'Bastion Tank', kind: 'player', tier: 1, family: 'tank', familyStage: 1,
    driveMode: 'tracks', assetMetadataStatus: info.authoringStatus, assetSHA256: info.glb.sha256,
    mass: 6500, hp: 850, length: hi[2] - lo[2], width: 2.88, height: hi[1] - lo[1],
    // The belt's contact envelope is distinct from the actual measured
    // roadwheel radius. Vehicle AND rideInfo must use trackedDrive.contactRadius.
    wheelRadius: info.wheels.FL.r, wheelWidth: info.wheels.FL.w,
    wheels: ['FL', 'FR', 'RL', 'RR'].map(name => ({ name, x: info.wheels[name].x, z: info.wheels[name].z,
      front: name[0] === 'F', drive: .25, brake: .25, hb: false })),
    mountY: .13, inertia: [20000, 24500, 12500],
    susp: { freq: 1.6, zeta: .82, maxLen: .49, minLen: .16, arb: null },
    grip: { front: 1.38, rear: 1.38, long: 1.36, gain: 11, slideMul: .92, hbLat: 1 },
    trackedDrive: { contactRadius: .39, lateralScrub: .55, lateralGain: 1.6, pivotRate: .70, yawResponse: 4.0, turnPower: 1.0 },
    steerLockDeg: 0, yawRateMax: .72, yawAssist: 0, dragC: .73, downforce: .45, brakeDecel: 13, airLevel: 3.2,
    forceHeight: .28, hbDecel: 8, drift: { maxSlip: 0, thrust: 0 },
    engine: { accel0: 2.8, vmax: 48, reverseMax: 7 }, nitro: { capacity, regen: capacity / 12, mul: 1.35 },
    colliders: info.collisionProxies.map(b => ({ center: [...b.center], half: [...b.half] })), colliderModelFrame: true,
    seats: { driver: [...info.sockets.seat_driver], gunner: [...info.sockets.seat_gunner] }, gunners: 1,
    steeringWheel: [...info.sockets.steering_wheel],
    cockpit: { frontGlassPanel: 'panel_windshield', mirrorLayout: { C: [.25, .07, .012], L: [.16, .20, .018], R: [.16, .20, .018] } },
    enginePanel: 'panel_hood', engineLayout: 'rear', audio: { engine: 'engine_diesel' },
    hitZones: { engine: { c: [...info.sockets.weak_engine], h: [.43, .23, .57] }, fuel: { c: [...info.sockets.weak_fuel], h: [.30, .18, .34] } },
    model: structuredClone({ bbox: info.bbox, wheels: info.wheels, sockets: info.sockets, socketBasis: info.socketBasis, parts: info.parts }),
    trackVisual: { ...info.trackContract, halfLength: 2.05, middleZ: [1.23, .41, -.41, -1.23] },
  };
  return { [TANK_BASE_ID]: spec };
}

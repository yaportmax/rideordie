// Standalone boss geometry contract. SOURCE-ONLY: the imported JSON is emitted
// by the WORK generator, then root must inspect/validate it before integration.
// This module never imports VEHICLES, Sim or a renderer, so vehicles can enumerate
// the URL without a catalogue dependency cycle. No old Hauler shell is reused.
import DEEPWARDEN_INFO from './deepwarden_model_info.json' with { type: 'json' };

export const ELITE_VEHICLE_PROTOCOL = 1;
export const DEEPWARDEN_ELITE = 7;
export const DEEPWARDEN_MODEL_ID = 'boss_deepwarden';
export const ELITE_VEHICLE_MODEL_URLS = Object.freeze(['/models/vehicles/boss_deepwarden.glb']);
const ORDER = ['FL', 'FR', 'ML', 'MR', 'RL', 'RR'];
const resolved = new WeakMap();
const finite3 = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
function cloneTree(value) {
  if (Array.isArray(value)) return value.map(cloneTree);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneTree(child)]));
  return value;
}
function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

/** Fail the candidate loudly if extraction is missing/malformed; nominal
 * manual sockets are not a replacement for the generated asset's geometry. */
export function validateDeepwardenInfo(info) {
  if (info?.id !== DEEPWARDEN_MODEL_ID || info.schema !== 1 || info.encodedElite !== DEEPWARDEN_ELITE
    || info.baseSpec !== 'e_heavy' || !finite3(info.bbox?.min) || !finite3(info.bbox?.max)
    || !info.bbox.min.every((v, i) => v < info.bbox.max[i])) throw new Error('Invalid Deepwarden extraction identity/bounds');
  if (Object.keys(info.wheels || {}).length !== ORDER.length) throw new Error('Deepwarden requires six extracted wheels');
  for (const name of ORDER) {
    const w = info.wheels[name];
    if (!w || ![w.x, w.y, w.z, w.r, w.w].every(Number.isFinite) || w.r < .3 || w.r > .85 || w.w < .2 || w.w > .65)
      throw new Error('Invalid Deepwarden wheel ' + name);
  }
  for (const name of ['seat_driver', 'seat_gunner', 'steering_wheel', 'gun_mount', 'roof_top', 'camera_hood', 'drill_drive'])
    if (!finite3(info.sockets?.[name])) throw new Error('Missing Deepwarden socket ' + name);
  for (const name of ['drill_L', 'drill_R', 'weak_drill_drive'])
    if (!finite3(info.groups?.[name]?.pivot) || !finite3(info.groups[name].min) || !finite3(info.groups[name].max))
      throw new Error('Missing Deepwarden authored group ' + name);
  if (!Array.isArray(info.colliders) || info.colliders.length < 4
    || info.colliders.some(b => !finite3(b.center) || !finite3(b.half) || b.half.some(v => v <= 0)))
    throw new Error('Invalid Deepwarden physical hull');
  for (const zone of ['engine', 'fuel']) {
    const z = info.hitZones?.[zone];
    if (!finite3(z?.c) || !finite3(z?.h) || z.h.some(v => v <= 0)) throw new Error('Invalid Deepwarden hit zone ' + zone);
  }
  const gunnerCeiling = info.sockets.seat_gunner[1] + 1.85 + .25;
  if (!Number.isFinite(info.spawnClearance) || info.spawnClearance < gunnerCeiling
    || info.spawnClearance < info.bbox.max[1] + .25) throw new Error('Deepwarden clearance excludes authored body/crew');
  if (info.crewModels?.driver !== 'raider_driver2' || info.crewModels?.gunner !== 'raider_c2')
    throw new Error('Deepwarden crew must be explicit loaded industrial raiders');
  return info;
}
const INFO = freezeTree(validateDeepwardenInfo(DEEPWARDEN_INFO));

/** Existing e_heavy + encoded elite7 selects one fully authored contract.
 * Ordinary enemies/bosses return the original object and retain their metadata.
 * Director tuning spreads this immutable variant before mass/engine overrides. */
export function resolveEliteVehicle(base, elite = 0) {
  if (elite !== DEEPWARDEN_ELITE) return base;
  if (!base || base.id !== 'e_heavy') throw new Error('Deepwarden must retain e_heavy catalogue identity');
  if (resolved.has(base)) return resolved.get(base);
  const sockets = INFO.sockets, front = INFO.wheels.FL;
  const wheels = ORDER.map(name => {
    const wheel = INFO.wheels[name], axle = name[0];
    return { name, x: wheel.x, z: wheel.z, front: axle === 'F', drive: axle === 'F' ? .15 : .175,
      brake: axle === 'F' ? .20 : .15, hb: axle !== 'F' };
  });
  const spec = freezeTree({
    ...cloneTree(base), modelId: DEEPWARDEN_MODEL_ID, eliteModelKey: 'deepwarden:1', requiredStandaloneModel: true,
    requiresClearance: true, spawnClearance: INFO.spawnClearance, colliderModelFrame: true,
    length: INFO.bbox.max[2] - INFO.bbox.min[2], width: INFO.bbox.max[0] - INFO.bbox.min[0], height: INFO.bbox.max[1],
    wheels, wheelRadius: front.r, wheelWidth: front.w,
    colliders: INFO.colliders, hitZones: INFO.hitZones,
    seats: { driver: sockets.seat_driver, gunner: sockets.seat_gunner }, gunners: 1,
    steeringWheel: sockets.steering_wheel, crewModels: INFO.crewModels,
    model: { bbox: INFO.bbox, sockets, wheels: INFO.wheels, parts: INFO.parts, groups: INFO.groups },
    // All inherited nested data was cloned above, including shared drift and
    // any future handling table. Freezing cannot affect ordinary/player specs.
  });
  resolved.set(base, spec);
  return spec;
}

/** Tuned host specs and extracted peer specs share geometry identity. */
export function eliteVehicleKey(spec) {
  return spec?.eliteModelKey || `${spec?.id || ''}:${spec?.modelId || spec?.id || ''}`;
}
export function validEliteVehicleIdentity(specId, elite, kind) {
  return elite !== DEEPWARDEN_ELITE || (specId === 'e_heavy' && kind === 'enemy');
}

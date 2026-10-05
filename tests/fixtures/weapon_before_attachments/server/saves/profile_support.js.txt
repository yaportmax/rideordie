// Portable raw-content compatibility check. Call before any normalizer drops
// unrecognized vehicle ownership or family purchases. No art/runtime imports.
export const SUPPORTED_PROFILE_VERSION = 3;
export const PROFILE_VEHICLE_IDS = Object.freeze(['player_sedan_t1', 'player_sedan_t2', 'truck_t1', 'truck_t2', 'truck_t3', 'truck_t4', 'player_buggy_t1', 'player_buggy_t2', 'player_buggy_t3', 'player_hummer_t1', 'player_tank_t1']);
const driver = Object.freeze({ engine: 5, armor: 5, tires: 5, nitro: 5, ram: 3, spikes: 2, glass: 2, fueltank: 2, oil: 2, mines: 2 });
export const PROFILE_FAMILY_CAPS = Object.freeze({
  sedan: Object.freeze({ engine: 4, armor: 3, tires: 4, nitro: 3, ram: 2, spikes: 1, glass: 2, fueltank: 2, oil: 2, mines: 1 }),
  rustbucket: driver,
  buggy: Object.freeze({ engine: 5, armor: 2, tires: 5, nitro: 4, ram: 1, spikes: 1, glass: 1, fueltank: 2, oil: 1, mines: 1 }),
  hummer: Object.freeze({ engine: 4, armor: 5, tires: 4, nitro: 3, ram: 3, spikes: 2, glass: 2, fueltank: 2, oil: 2, mines: 2 }),
  tank: Object.freeze({ engine: 3, armor: 5, tires: 4, nitro: 2, ram: 3, spikes: 2, glass: 2, fueltank: 2, oil: 2, mines: 2 }),
});
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const owned = new Set(PROFILE_VEHICLE_IDS);
const positive = row => Object.values(object(row)).some(value => Number.isFinite(value) && Math.trunc(value) > 0);
export function contentProfileVersion(value) {
  const p = object(value), rows = object(p.vehicleUpgrades);
  if ((Array.isArray(p.trucks) && p.trucks.includes('player_tank_t1')) || positive(rows.tank)) return 3;
  if ((Array.isArray(p.trucks) && p.trucks.includes('player_hummer_t1')) || positive(rows.hummer)) return 2;
  return 1;
}
function unsupported(requiredVersion) {
  const error = new Error('unsupported_profile'); error.code = 'unsupported-profile';
  if (requiredVersion) error.requiredVersion = requiredVersion;
  throw error;
}
export function assertSupportedProfile(value, maxVersion = SUPPORTED_PROFILE_VERSION) {
  const p = object(value);
  if (p.v !== undefined && ![1, 2, 3].includes(p.v)) unsupported(p.v);
  if (p.truck !== undefined && !owned.has(p.truck)) unsupported();
  if (Array.isArray(p.trucks) && p.trucks.some(id => !owned.has(id))) unsupported();
  for (const [family, row] of Object.entries(object(p.vehicleUpgrades))) {
    if (!Object.hasOwn(PROFILE_FAMILY_CAPS, family)) unsupported();
    for (const track of Object.keys(object(row))) if (!Object.hasOwn(PROFILE_FAMILY_CAPS[family], track)) unsupported();
  }
  const selectedVersion = p.truck === 'player_tank_t1' ? 3 : p.truck === 'player_hummer_t1' ? 2 : 1;
  const requiredVersion = Math.max(p.v ?? 1, contentProfileVersion(p), selectedVersion);
  if (requiredVersion > maxVersion) unsupported(requiredVersion);
  return requiredVersion;
}

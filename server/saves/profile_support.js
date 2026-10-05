// Portable raw-content compatibility check. Call before any normalizer drops
// unrecognized vehicle ownership, family purchases or paid weapon equipment.
// No art/runtime imports.
import { weaponAttachmentIdsFor } from './weapon_attachment_support.js';
import { WEAPON_OPTIC_IDS, compatibleWeaponOptic } from './weapon_optic_support.js';
export const SUPPORTED_PROFILE_VERSION = 4;
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
  if (Object.values(object(p.weaponAttachments)).some(row => ['owned', 'equipped'].some(key => Array.isArray(row?.[key]) && row[key].length))) return 4;
  if (Object.values(object(p.weaponOptics)).some(row => (Array.isArray(row?.owned) && row.owned.includes('combat_3x')) || row?.equipped === 'combat_3x')) return 4;
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
  if (p.v !== undefined && ![1, 2, 3, 4].includes(p.v)) unsupported(p.v);
  if (p.truck !== undefined && !owned.has(p.truck)) unsupported();
  if (Array.isArray(p.trucks) && p.trucks.some(id => !owned.has(id))) unsupported();
  for (const [family, row] of Object.entries(object(p.vehicleUpgrades))) {
    if (!Object.hasOwn(PROFILE_FAMILY_CAPS, family)) unsupported();
    for (const track of Object.keys(object(row))) if (!Object.hasOwn(PROFILE_FAMILY_CAPS[family], track)) unsupported();
  }
  // Inspect raw purchases before either browser or Worker projection can erase
  // an unknown or unowned gun's paid equipment. Empty defaults do not raise the
  // content version or change an old save's canonical cloud signature.
  if (p.weaponAttachments !== undefined) {
    if (!p.weaponAttachments || typeof p.weaponAttachments !== 'object' || Array.isArray(p.weaponAttachments)) throw new TypeError('invalid_profile');
    for (const [weaponId, row] of Object.entries(p.weaponAttachments)) {
      const compatible = weaponAttachmentIdsFor(weaponId);
      if (!compatible.length || (weaponId !== 'pistol' && !Object.hasOwn(object(p.weapons), weaponId))) unsupported();
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('invalid_profile');
      if (Object.keys(row).some(key => !['owned', 'equipped'].includes(key))) unsupported();
      for (const key of ['owned', 'equipped']) {
        if (row[key] === undefined) continue;
        if (!Array.isArray(row[key]) || row[key].length > compatible.length) throw new TypeError('invalid_profile');
        if (row[key].some(id => !compatible.includes(id))) unsupported();
      }
      if ((row.equipped || []).some(id => !(row.owned || []).includes(id))) throw new TypeError('invalid_profile');
    }
  }
  // Existing standard/wide-reflex repairs remain backward compatible. A new
  // paid scope or future optic must never disappear during that repair.
  for (const [weaponId, row] of Object.entries(object(p.weaponOptics))) {
    const optics = [...(Array.isArray(row?.owned) ? row.owned : []), ...(typeof row?.equipped === 'string' ? [row.equipped] : [])];
    if (optics.some(id => !WEAPON_OPTIC_IDS.includes(id))) unsupported();
    if (optics.includes('combat_3x')) {
      if (!compatibleWeaponOptic(weaponId, 'combat_3x') || !Object.hasOwn(object(p.weapons), weaponId)) unsupported();
      if (!Array.isArray(row.owned) || !row.owned.includes('combat_3x') || (row.equipped !== undefined && typeof row.equipped !== 'string')) throw new TypeError('invalid_profile');
    }
  }
  const selectedVersion = p.truck === 'player_tank_t1' ? 3 : p.truck === 'player_hummer_t1' ? 2 : 1;
  const requiredVersion = Math.max(p.v ?? 1, contentProfileVersion(p), selectedVersion);
  if (requiredVersion > maxVersion) unsupported(requiredVersion);
  return requiredVersion;
}

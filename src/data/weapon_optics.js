// Attachment identity and physical mounting data. Optics change the sight picture,
// never weapon damage, handling, ammunition or world-camera magnification.
import { WEAPONS } from './weapons.js';

export const REFLEX_GUNS = Object.freeze(['pistol', 'smg', 'shotgun', 'rifle', 'lmg']);
export const WEAPON_OPTICS = Object.freeze({
  standard: Object.freeze({ id: 'standard', name: 'STANDARD SIGHT', desc: 'The weapon’s original sight.', baseCosts: Object.freeze({}) }),
  wide_reflex: Object.freeze({ id: 'wide_reflex', name: 'OPEN REFLEX', desc: 'A clear, wider window with an illuminated aiming dot.',
    baseCosts: Object.freeze({ pistol: 750, smg: 900, shotgun: 1200, rifle: 1500, lmg: 1800 }) }),
});

export const REFLEX_WINDOW = Object.freeze({ width: .034, height: .030, centerY: .027, lensZ: .015 });
export const REFLEX_MOUNTS = Object.freeze({
  pistol: Object.freeze({ parent: 'slide', rootPosition: Object.freeze([0, .077, -.008]), plateWidth: .026, relief: .40 }),
  smg: Object.freeze({ parent: 'body', rootPosition: Object.freeze([0, .101, .018]), plateWidth: .032, relief: .15 }),
  shotgun: Object.freeze({ parent: 'body', rootPosition: Object.freeze([0, .085, .036]), plateWidth: .032, relief: .13, ring: true }),
  rifle: Object.freeze({ parent: 'body', rootPosition: Object.freeze([0, .1263, -.020]), plateWidth: .032, riserHeight: .008, relief: .13, replaces: 'optic' }),
  lmg: Object.freeze({ parent: 'feed_cover', rootPosition: Object.freeze([0, .137, .045]), plateWidth: .032, relief: .12 }),
});

export function compatibleWeaponOptic(weaponId, opticId) {
  return Object.hasOwn(WEAPONS, weaponId) && Object.hasOwn(WEAPON_OPTICS, opticId)
    && (opticId === 'standard' || Object.hasOwn(WEAPON_OPTICS[opticId].baseCosts, weaponId));
}
export function sanitizeOpticId(weaponId, opticId) { return compatibleWeaponOptic(weaponId, opticId) ? opticId : 'standard'; }

const record = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
/** Legacy owned guns always retain their free factory sight. Never accept a locked-gun attachment. */
export function normalizeWeaponOptics(profile, value = profile?.weaponOptics) {
  const result = {}, weapons = record(profile?.weapons), rows = record(value);
  for (const weaponId of Object.keys(WEAPONS)) {
    if (!Object.hasOwn(weapons, weaponId)) continue;
    const row = record(rows[weaponId]);
    const owned = [...new Set(['standard', ...(Array.isArray(row.owned) ? row.owned.filter(id => compatibleWeaponOptic(weaponId, id)) : [])])];
    result[weaponId] = { owned, equipped: owned.includes(row.equipped) ? row.equipped : 'standard' };
  }
  return result;
}
/** Frozen run configuration contains only selected attachments, not the complete inventory. */
export function equippedWeaponOptics(profile) {
  return Object.freeze(Object.fromEntries(Object.entries(normalizeWeaponOptics(profile)).map(([id, row]) => [id, row.equipped])));
}

export function weaponOpticKey(weaponId, opticId = 'standard') {
  const selected = sanitizeOpticId(weaponId, opticId);
  return selected === 'standard' ? weaponId : `${weaponId}:${selected}`;
}

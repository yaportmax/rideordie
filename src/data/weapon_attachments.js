// Purchasable physical weapon parts. One compatible instance of each part may
// be installed; legacy magazine/handling tiers remain owned and do not stack
// a second copy of the same stat benefit.
import { WEAPON_ATTACHMENT_IDS, compatibleWeaponAttachment } from '../../server/saves/weapon_attachment_support.js';

export { compatibleWeaponAttachment };
export const WEAPON_ATTACHMENT_ORDER = WEAPON_ATTACHMENT_IDS;
export const WEAPON_ATTACHMENTS = Object.freeze({
  extended_mag: Object.freeze({ id: 'extended_mag', name: 'EXTENDED MAGAZINE',
    desc: '+45% capacity, or your existing magazine tier if larger. Adds a longer magazine, tube or ammo box.',
    baseCosts: Object.freeze({ pistol: 1200, smg: 2000, shotgun: 2600, rifle: 3600, lmg: 4800, sniper: 4200, minigun: 8000 }) }),
  laser: Object.freeze({ id: 'laser', name: 'LASER MODULE',
    desc: '20% tighter hip fire. Adds a visible rail-mounted laser emitter.',
    baseCosts: Object.freeze({ pistol: 1000, revolver: 1400, smg: 1800, shotgun: 2400, rifle: 3200, lmg: 4400, sniper: 3800, minigun: 6500 }) }),
  foregrip: Object.freeze({ id: 'foregrip', name: 'FOREGRIP',
    desc: '10% less spread and 8% less recoil. Your stronger legacy handling benefit is retained.',
    baseCosts: Object.freeze({ smg: 2200, shotgun: 2800, rifle: 3800, lmg: 4800 }) }),
  stock: Object.freeze({ id: 'stock', name: 'STABILIZING STOCK',
    desc: '18% less recoil. Adds a reinforced shoulder stock; combines with a foregrip without duplicating old handling tiers.',
    baseCosts: Object.freeze({ smg: 2600, shotgun: 3200, rifle: 4600, lmg: 5200, sniper: 5800 }) }),
});
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function sanitizeWeaponAttachmentIds(weaponId, value) {
  const selected = new Set(Array.isArray(value) ? value : []);
  return WEAPON_ATTACHMENT_ORDER.filter(id => selected.has(id) && compatibleWeaponAttachment(weaponId, id));
}
/** Canonical catalogue order, no attachment inventory for an unowned gun. */
export function normalizeWeaponAttachments(profile, value = profile?.weaponAttachments) {
  const result = {}, weapons = record(profile?.weapons), rows = record(value);
  for (const weaponId of Object.keys(weapons)) {
    // Unknown owned-weapon IDs cannot acquire an attachment row.
    if (!WEAPON_ATTACHMENT_ORDER.some(id => compatibleWeaponAttachment(weaponId, id))) continue;
    const row = record(rows[weaponId]);
    const owned = sanitizeWeaponAttachmentIds(weaponId, row.owned);
    const equipped = sanitizeWeaponAttachmentIds(weaponId, row.equipped).filter(id => owned.includes(id));
    if (!owned.length) continue;
    result[weaponId] = { owned, equipped };
  }
  return result;
}
/** A running loadout owns immutable selected IDs, never live shop arrays. */
export function equippedWeaponAttachments(profile) {
  return Object.freeze(Object.fromEntries(Object.entries(normalizeWeaponAttachments(profile))
    .map(([id, row]) => [id, Object.freeze(row.equipped.slice())])));
}
export function weaponAttachmentKey(weaponId, attachments = []) {
  const ids = sanitizeWeaponAttachmentIds(weaponId, attachments);
  return ids.length ? `${weaponId}:${ids.join('+')}` : weaponId;
}

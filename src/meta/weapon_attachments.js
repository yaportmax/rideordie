import { COST_SCALE } from '../data/upgrades.js';
import { WEAPON_ATTACHMENTS, compatibleWeaponAttachment, normalizeWeaponAttachments } from '../data/weapon_attachments.js';
import { assertSupportedProfile, contentProfileVersion } from '../../server/saves/profile_support.js';

export function weaponAttachmentState(profile, weaponId, attachmentId) {
  if (!compatibleWeaponAttachment(weaponId, attachmentId)) return { ok: false, reason: 'invalid' };
  if (!Object.hasOwn(profile.weapons || {}, weaponId)) return { ok: false, reason: 'locked' };
  const row = normalizeWeaponAttachments(profile)[weaponId] || { owned: [], equipped: [] };
  // An older paid magazine tier already owns this piece of hardware. Show it
  // as included without charging again, granting the new45% effect for free,
  // creating new profile content, or pretending its existing tier is removable.
  const legacyLevel = attachmentId === 'extended_mag' && !row.owned.includes(attachmentId)
    ? Math.max(0, Math.min(3, Math.trunc(profile.weapons[weaponId]?.mag || 0))) : 0;
  return { ok: true, owned: row.owned.includes(attachmentId) || legacyLevel > 0,
    equipped: row.equipped.includes(attachmentId) || legacyLevel > 0,
    includedLegacy: legacyLevel > 0, removable: legacyLevel === 0, legacyLevel,
    cost: Math.round(WEAPON_ATTACHMENTS[attachmentId].baseCosts[weaponId] * COST_SCALE) };
}
export function buyWeaponAttachment(profile, weaponId, attachmentId) {
  assertSupportedProfile(profile);
  const state = weaponAttachmentState(profile, weaponId, attachmentId);
  if (!state.ok) return state;
  if (state.owned) return { ok: false, reason: 'owned' };
  if (!Number.isSafeInteger(profile.cash) || profile.cash < state.cost) return { ok: false, reason: 'cash' };
  const rows = normalizeWeaponAttachments(profile), row = rows[weaponId] || { owned: [], equipped: [] };
  rows[weaponId] = row;
  row.owned.push(attachmentId); row.equipped.push(attachmentId);
  profile.cash -= state.cost;
  profile.weaponAttachments = normalizeWeaponAttachments(profile, rows);
  profile.v = contentProfileVersion(profile);
  return { ok: true };
}
export function equipWeaponAttachment(profile, weaponId, attachmentId, enabled = true) {
  assertSupportedProfile(profile);
  if (typeof enabled !== 'boolean') return { ok: false, reason: 'invalid' };
  const state = weaponAttachmentState(profile, weaponId, attachmentId);
  if (!state.ok) return state;
  if (!state.owned) return { ok: false, reason: 'locked' };
  if (state.includedLegacy) return enabled ? { ok: true } : { ok: false, reason: 'legacy' };
  const rows = normalizeWeaponAttachments(profile), row = rows[weaponId];
  row.equipped = enabled ? [...new Set([...row.equipped, attachmentId])] : row.equipped.filter(id => id !== attachmentId);
  profile.weaponAttachments = normalizeWeaponAttachments(profile, rows);
  profile.v = contentProfileVersion(profile);
  return { ok: true };
}

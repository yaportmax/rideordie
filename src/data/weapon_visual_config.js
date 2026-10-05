import { weaponOpticKey, sanitizeOpticId } from './weapon_optics.js';
import { sanitizeWeaponAttachmentIds } from './weapon_attachments.js';

const TRACKS = Object.freeze(['dmg', 'mag', 'rel', 'hnd']);
const clampLevel = value => Number.isInteger(value) ? Math.max(0, Math.min(3, value)) : 0;
export function weaponVisualLevels(levels = {}) {
  return Object.freeze(Object.fromEntries(TRACKS.map(id => [id, clampLevel(levels?.[id])])));
}
/** Appearance cache identity is portable and cannot instantiate renderer state. */
export function weaponVisualKey(id, opticId = 'standard', levels = {}, attachments = []) {
  const lv = weaponVisualLevels(levels), mods = sanitizeWeaponAttachmentIds(id, attachments);
  if (!TRACKS.some(k => lv[k]) && !mods.length) return weaponOpticKey(id, opticId);
  return `${id}:${sanitizeOpticId(id, opticId)}:${TRACKS.map(k => lv[k]).join('.')}:${mods.join('.')}`;
}
/** Factory specialist scopes use the existing full-screen sight presentation.
 * A purchased 3x optic is a physical aperture: magnify the world without hiding
 * the gun model or replacing its annular lens with a sniper HUD. */
export function usesFullscreenWeaponScope(weapon) {
  return !!weapon?.scope && weapon.opticId !== 'combat_3x';
}

// Portable attachment compatibility. Keep cloud/profile validation independent
// of browser runtime, visual assets and the weapon/effects import graph.
export const WEAPON_ATTACHMENT_IDS = Object.freeze(['extended_mag', 'laser', 'foregrip', 'stock']);
const compatible = Object.freeze({
  extended_mag: Object.freeze(['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'minigun']),
  laser: Object.freeze(['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'minigun']),
  foregrip: Object.freeze(['smg', 'shotgun', 'rifle', 'lmg']),
  stock: Object.freeze(['smg', 'shotgun', 'rifle', 'lmg', 'sniper']),
});
export function compatibleWeaponAttachment(weaponId, attachmentId) {
  return Object.hasOwn(compatible, attachmentId) && compatible[attachmentId].includes(weaponId);
}
export function weaponAttachmentIdsFor(weaponId) {
  return WEAPON_ATTACHMENT_IDS.filter(id => compatibleWeaponAttachment(weaponId, id));
}

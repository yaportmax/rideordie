// Portable purchasable-sight identities. Factory scopes remain standard on
// specialist weapons; new campaign rifles begin with authored iron sights.
export const WEAPON_OPTIC_IDS = Object.freeze(['standard', 'wide_reflex', 'combat_3x']);
const weapons = Object.freeze(['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'rpg', 'minigun']);
export function compatibleWeaponOptic(weaponId, opticId) {
  return weapons.includes(weaponId) && (opticId === 'standard'
    || (opticId === 'wide_reflex' && ['pistol', 'smg', 'shotgun', 'rifle', 'lmg'].includes(weaponId))
    || (opticId === 'combat_3x' && ['rifle', 'sniper'].includes(weaponId)));
}
export function weaponOpticIdsFor(weaponId) {
  return WEAPON_OPTIC_IDS.filter(id => compatibleWeaponOptic(weaponId, id));
}

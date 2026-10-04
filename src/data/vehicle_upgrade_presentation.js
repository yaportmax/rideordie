// A chassis-specific label for the same paid driver track. Mechanics and costs
// stay in upgrades.js; this leaf never changes a player's inventory or wallet.
import { UPGRADE_BY_ID } from './upgrades.js';
import { familyOf } from './vehicle_families.js';

export function vehicleUpgradePresentation(profile, id) {
  const upgrade = UPGRADE_BY_ID[id];
  if (!upgrade || id !== 'tires' || familyOf(profile?.truck) !== 'tank') return upgrade;
  return { ...upgrade, name: 'TRACTION TRACKS', desc: 'Reinforced track shoes and wheel tensioners. More grip with each level; drive protection at level 3.' };
}

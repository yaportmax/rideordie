import { WEAPONS } from '../data/weapons.js';
import { normalizeCampaignProgress } from '../data/campaign.js';

/** Campaign receipts, never wallet size or selected/debug chapter, unlock guns.
 * Already-owned legacy weapons remain available without inventing clear credit.
 */
// Session may provide its bounded personal-wallet career level. It derives
// that value from the payer's canonical personal campaign, not the host's
// shared campaign selection. This is an authority context, not a debug bypass.
export function weaponPurchaseState(profile, weaponId, careerLevel) {
  if (!Object.hasOwn(WEAPONS, weaponId)) return { ok: false, reason: 'invalid' };
  if (careerLevel !== undefined && (!Number.isInteger(careerLevel) || careerLevel < 1 || careerLevel > 10)) return { ok: false, reason: 'invalid' };
  const weapon = WEAPONS[weaponId], owned = Object.hasOwn(profile?.weapons || {}, weaponId);
  const availableLevel = careerLevel ?? normalizeCampaignProgress(profile?.campaignProgress).unlockedLevel;
  const state = { owned, cost: weapon.cost, unlockLevel: weapon.unlockLevel, availableLevel };
  if (owned) return { ...state, ok: true };
  if (availableLevel < weapon.unlockLevel) return { ...state, ok: false, reason: 'progress' };
  if (!Number.isSafeInteger(profile?.cash) || profile.cash < weapon.cost) return { ...state, ok: false, reason: 'cash' };
  return { ...state, ok: true };
}

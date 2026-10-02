import { COST_SCALE } from '../data/upgrades.js';
import { WEAPON_OPTICS, compatibleWeaponOptic, normalizeWeaponOptics } from '../data/weapon_optics.js';

export function weaponOpticState(profile, weaponId, opticId) {
  if (!compatibleWeaponOptic(weaponId, opticId)) return { ok: false, reason: 'invalid' };
  if (!Object.hasOwn(profile.weapons || {}, weaponId)) return { ok: false, reason: 'locked' };
  const row = normalizeWeaponOptics(profile)[weaponId];
  return { ok: true, owned: row.owned.includes(opticId), equipped: row.equipped === opticId,
    cost: opticId === 'standard' ? 0 : Math.round(WEAPON_OPTICS[opticId].baseCosts[weaponId] * COST_SCALE) };
}

export function buyWeaponOptic(profile, weaponId, opticId) {
  const state = weaponOpticState(profile, weaponId, opticId);
  if (!state.ok) return state;
  if (state.owned) return { ok: false, reason: 'owned' };
  if (!Number.isSafeInteger(profile.cash) || profile.cash < state.cost) return { ok: false, reason: 'cash' };
  const rows = normalizeWeaponOptics(profile);
  rows[weaponId].owned.push(opticId); rows[weaponId].equipped = opticId;
  profile.cash -= state.cost; profile.weaponOptics = rows;
  return { ok: true };
}

export function equipWeaponOptic(profile, weaponId, opticId) {
  const state = weaponOpticState(profile, weaponId, opticId);
  if (!state.ok) return state;
  if (!state.owned) return { ok: false, reason: 'locked' };
  const rows = normalizeWeaponOptics(profile);
  rows[weaponId].equipped = opticId; profile.weaponOptics = rows;
  return { ok: true };
}

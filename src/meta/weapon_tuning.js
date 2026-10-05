// Match the real selected-kit stats before charging for a tuning tier. Existing
// owned tiers remain owned; no skipped levels, free upgrade or stat stacking.
import { WEAPONS, weaponStats } from '../data/weapons.js';
import { WEAPON_TRACKS, WEAPON_TRACK_MAX, weaponTrackCost } from '../data/upgrades.js';
import { equippedWeaponAttachments } from '../data/weapon_attachments.js';

export function weaponTrackPurchaseState(profile, weaponId, track) {
  if (!Object.hasOwn(WEAPONS, weaponId) || !WEAPON_TRACKS.some(row => row.id === track)) return { ok: false, reason: 'invalid' };
  const levels = profile?.weapons?.[weaponId];
  if (!levels) return { ok: false, reason: 'locked' };
  const level = levels[track] || 0;
  if (!Number.isInteger(level) || level < 0) return { ok: false, reason: 'invalid' };
  if (level >= WEAPON_TRACK_MAX) return { ok: false, reason: 'max', level };
  const nextLevel = level + 1, cost = weaponTrackCost(weaponId, track, level);
  const state = { level, nextLevel, cost };
  const attachments = equippedWeaponAttachments(profile)[weaponId] || [];
  const hasRelevantPart = track === 'mag' ? attachments.includes('extended_mag')
    : track === 'hnd' && (attachments.includes('foregrip') || attachments.includes('stock'));
  if (hasRelevantPart) {
    const before = weaponStats(weaponId, levels, attachments);
    const after = weaponStats(weaponId, { ...levels, [track]: nextLevel }, attachments);
    const benefits = track === 'mag' ? after.mag > before.mag
      : after.spreadMul < before.spreadMul || after.recoilMul < before.recoilMul;
    if (!benefits) return { ...state, ok: false, reason: 'covered', coveredByAttachment: true };
  }
  // Old no-kit tracks keep their historical progression and price schedule.
  // In particular this does not redefine the launcher's rounded magazine path.
  if (!Number.isSafeInteger(profile?.cash) || profile.cash < cost) return { ...state, ok: false, reason: 'cash' };
  return { ...state, ok: true };
}

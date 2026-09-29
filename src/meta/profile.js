// Save/load + purchase logic. The profile is host-owned in multiplayer and mirrored to the other peer (higher revision wins).
import { DEFAULT_PROFILE, TRUCKS, UPGRADE_BY_ID, WEAPON_TRACKS, WEAPON_TRACK_MAX, weaponTrackCost, ownedWeapons, TRUCK_COLORS } from '../data/upgrades.js';
import { WEAPONS } from '../data/weapons.js';

const KEY = 'rideordie.profile.v1';
const LIST_KEY = 'rideordie.profiles';

export function loadProfile(campaignId) {
  try {
    const raw = localStorage.getItem(campaignId ? `${KEY}.${campaignId}` : KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch { /* ignore */ }
  return DEFAULT_PROFILE();
}
export function saveProfile(p) {
  try {
    p.revision = (p.revision || 0) + 1;
    localStorage.setItem(KEY, JSON.stringify(p));
    localStorage.setItem(`${KEY}.${p.campaignId}`, JSON.stringify(p));
  } catch { /* storage may be blocked */ }
  return p;
}
function migrate(p) { const d = DEFAULT_PROFILE(); return { ...d, ...p, best: { ...d.best, ...(p.best || {}) } }; }
export function newerProfile(a, b) { return (a?.revision || 0) >= (b?.revision || 0) ? a : b; }

// ---- purchases (return {ok, reason?}); all pure on the profile object
export function buyTruck(p, id) {
  const t = TRUCKS.find((x) => x.id === id);
  if (!t || p.trucks.includes(id)) return { ok: false, reason: 'owned' };
  if (p.cash < t.cost) return { ok: false, reason: 'cash' };
  p.cash -= t.cost; p.trucks.push(id); p.truck = id; return { ok: true };
}
export function selectTruck(p, id) { if (p.trucks.includes(id)) { p.truck = id; return { ok: true }; } return { ok: false }; }
export function upgradeCost(p, id) {
  const u = UPGRADE_BY_ID[id]; const l = p.upgrades[id] || 0;
  return l >= u.costs.length ? null : u.costs[l];
}
export function buyUpgrade(p, id) {
  const c = upgradeCost(p, id);
  if (c === null) return { ok: false, reason: 'max' };
  if (p.cash < c) return { ok: false, reason: 'cash' };
  p.cash -= c; p.upgrades[id] = (p.upgrades[id] || 0) + 1; return { ok: true };
}
export function buyWeapon(p, id) {
  const w = WEAPONS[id];
  if (!w || p.weapons[id]) return { ok: false, reason: 'owned' };
  if (p.cash < w.cost) return { ok: false, reason: 'cash' };
  p.cash -= w.cost; p.weapons[id] = { dmg: 0, mag: 0, rel: 0, hnd: 0 };
  if (p.loadout.length < 3) p.loadout.push(id);
  return { ok: true };
}
export function buyWeaponTrack(p, id, track) {
  const o = p.weapons[id]; if (!o) return { ok: false, reason: 'locked' };
  const l = o[track] || 0; if (l >= WEAPON_TRACK_MAX) return { ok: false, reason: 'max' };
  const c = weaponTrackCost(id, track, l); if (p.cash < c) return { ok: false, reason: 'cash' };
  p.cash -= c; o[track] = l + 1; return { ok: true };
}
/** Equip a weapon into loadout slot i (0..2). Max 3 weapons carried (primary, secondary, tertiary). */
export function equipWeapon(p, id, slot) {
  if (!p.weapons[id]) return { ok: false };
  const lo = p.loadout.filter((x) => x !== id);
  lo.splice(Math.min(slot, lo.length), 0, id);
  p.loadout = lo.slice(0, 3); return { ok: true };
}
export function cycleColor(p, dir = 1) { p.truckColor = (p.truckColor + dir + TRUCK_COLORS.length) % TRUCK_COLORS.length; return p.truckColor; }

/** Credit a finished run. */
export function creditRun(p, run) {
  p.cash += run.cash; p.totalCash += run.cash; p.runs++;
  p.best.distance = Math.max(p.best.distance, run.distance); p.best.time = Math.max(p.best.time, run.time); p.best.kills = Math.max(p.best.kills, run.kills);
  if (run.won) { p.wins++; p.bossKilled = true; }
  for (const id of run.minibosses || []) p.minibosses[id] = true;
  return p;
}
export { ownedWeapons };

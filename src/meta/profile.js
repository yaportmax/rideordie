// Save/load and host-owned campaign purchases.
import { DEFAULT_PROFILE, TRUCKS, UPGRADE_BY_ID, WEAPON_TRACKS, WEAPON_TRACK_MAX, weaponTrackCost, ownedWeapons, TRUCK_COLORS } from '../data/upgrades.js';
import { WEAPONS } from '../data/weapons.js';

const KEY = 'rideordie.profile.v1';
const record = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const natural = (v, max = Number.MAX_SAFE_INTEGER) => Number.isFinite(v) ? Math.min(max, Math.max(0, Math.trunc(v))) : 0;
const positive = (v) => Number.isFinite(v) ? Math.max(0, v) : 0;
const validTruck = (id) => TRUCKS.some((t) => t.id === id);
const validWeapon = (id) => Object.hasOwn(WEAPONS, id);

/** Repair incomplete/old saves without allowing malformed levels or loadouts to break a run. */
export function normalizeProfile(value) {
  const p = record(value), d = DEFAULT_PROFILE();
  const trucks = [...new Set(['truck_t1', ...(Array.isArray(p.trucks) ? p.trucks.filter(validTruck) : [])])];
  const upgrades = {};
  for (const [id, u] of Object.entries(UPGRADE_BY_ID)) upgrades[id] = natural(record(p.upgrades)[id], u.costs.length);
  const weapons = { pistol: { dmg: 0, mag: 0, rel: 0, hnd: 0 } };
  for (const [id, levels] of Object.entries(record(p.weapons))) {
    if (!validWeapon(id)) continue;
    weapons[id] = Object.fromEntries(WEAPON_TRACKS.map(({ id: track }) => [track, natural(record(levels)[track], WEAPON_TRACK_MAX)]));
  }
  const loadout = [...new Set((Array.isArray(p.loadout) ? p.loadout : d.loadout).filter((id) => Object.hasOwn(weapons, id)))].slice(0, 3);
  const best = record(p.best);
  return {
    ...d, ...p, v: 1,
    campaignId: typeof p.campaignId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(p.campaignId) ? p.campaignId : d.campaignId,
    revision: natural(p.revision), cash: natural(p.cash), totalCash: natural(p.totalCash), runs: natural(p.runs), wins: natural(p.wins),
    best: { distance: positive(best.distance), furthestS: Math.max(positive(best.furthestS), positive(best.distance)), time: positive(best.time), kills: natural(best.kills) },
    trucks, truck: trucks.includes(p.truck) ? p.truck : 'truck_t1', upgrades, weapons, loadout: loadout.length ? loadout : ['pistol'],
    truckColor: natural(p.truckColor, TRUCK_COLORS.length - 1),
    minibosses: Object.fromEntries(Object.entries(record(p.minibosses)).filter(([id, done]) => /^[0-4]$/.test(id) && done === true)),
    bossKilled: p.bossKilled === true,
    lastRunId: typeof p.lastRunId === 'string' ? p.lastRunId : null,
    coopLastRunId: typeof p.coopLastRunId === 'string' && p.coopLastRunId.length > 0 && p.coopLastRunId.length <= 128 ? p.coopLastRunId : null,
  };
}

export function loadProfile(campaignId) {
  try {
    const raw = localStorage.getItem(campaignId ? `${KEY}.${campaignId}` : KEY);
    if (raw) return normalizeProfile(JSON.parse(raw));
  } catch { /* blocked or damaged storage */ }
  return DEFAULT_PROFILE();
}
export function saveProfile(p) {
  p.revision = natural(p.revision) + 1;
  try {
    const data = JSON.stringify(p);
    localStorage.setItem(KEY, data);
    localStorage.setItem(`${KEY}.${p.campaignId}`, data);
  } catch { /* storage may be blocked */ }
  return p;
}
export function newerProfile(a, b) { return (a?.revision || 0) >= (b?.revision || 0) ? a : b; }

export function buyTruck(p, id) {
  const t = TRUCKS.find((x) => x.id === id);
  if (!t) return { ok: false, reason: 'invalid' };
  if (p.trucks.includes(id)) return { ok: false, reason: 'owned' };
  if (p.cash < t.cost) return { ok: false, reason: 'cash' };
  p.cash -= t.cost; p.trucks.push(id); p.truck = id; return { ok: true };
}
export function selectTruck(p, id) { if (validTruck(id) && p.trucks.includes(id)) { p.truck = id; return { ok: true }; } return { ok: false, reason: 'locked' }; }
export function upgradeCost(p, id) {
  if (!Object.hasOwn(UPGRADE_BY_ID, id)) return null;
  const u = UPGRADE_BY_ID[id], l = p.upgrades[id] || 0;
  return l >= u.costs.length ? null : u.costs[l];
}
export function buyUpgrade(p, id) {
  if (!Object.hasOwn(UPGRADE_BY_ID, id)) return { ok: false, reason: 'invalid' };
  const c = upgradeCost(p, id);
  if (c === null) return { ok: false, reason: 'max' };
  if (p.cash < c) return { ok: false, reason: 'cash' };
  p.cash -= c; p.upgrades[id] = (p.upgrades[id] || 0) + 1; return { ok: true };
}
export function buyWeapon(p, id) {
  if (!validWeapon(id)) return { ok: false, reason: 'invalid' };
  const w = WEAPONS[id];
  if (Object.hasOwn(p.weapons, id)) return { ok: false, reason: 'owned' };
  if (p.cash < w.cost) return { ok: false, reason: 'cash' };
  p.cash -= w.cost; p.weapons[id] = { dmg: 0, mag: 0, rel: 0, hnd: 0 };
  if (p.loadout.length < 3) p.loadout.push(id);
  return { ok: true };
}
export function buyWeaponTrack(p, id, track) {
  if (!validWeapon(id) || !WEAPON_TRACKS.some((t) => t.id === track)) return { ok: false, reason: 'invalid' };
  const o = p.weapons[id]; if (!o) return { ok: false, reason: 'locked' };
  const l = o[track] || 0; if (l >= WEAPON_TRACK_MAX) return { ok: false, reason: 'max' };
  const c = weaponTrackCost(id, track, l); if (p.cash < c) return { ok: false, reason: 'cash' };
  p.cash -= c; o[track] = l + 1; return { ok: true };
}
/** Replace the selected slot. If already equipped elsewhere, swap the two slots. */
export function equipWeapon(p, id, slot) {
  if (!validWeapon(id) || !p.weapons[id]) return { ok: false, reason: 'locked' };
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) return { ok: false, reason: 'invalid' };
  const lo = p.loadout.slice(0, 3), target = Math.min(slot, lo.length), from = lo.indexOf(id);
  if (from >= 0 && target < lo.length) [lo[from], lo[target]] = [lo[target], lo[from]];
  else {
    if (from >= 0) lo.splice(from, 1);
    lo[Math.min(target, lo.length)] = id;
  }
  p.loadout = lo.slice(0, 3); return { ok: true };
}
export function cycleColor(p, dir = 1) { p.truckColor = (p.truckColor + dir + TRUCK_COLORS.length) % TRUCK_COLORS.length; return p.truckColor; }

/** A result can arrive twice during a screen transition; pay a run only once. */
export function creditRun(p, run) {
  if (!run || (run.id && p.lastRunId === run.id)) return p;
  const cash = natural(run.cash);
  p.cash = natural(p.cash + cash); p.totalCash = natural(p.totalCash + cash); p.runs++;
  // Route progress is an absolute road coordinate; checkpoint payouts and the
  // distance record continue to count only metres travelled during that life.
  p.best.furthestS = Math.max(positive(p.best.furthestS), positive(p.best.distance), positive(run.furthestS), positive(run.distance));
  p.best.distance = Math.max(p.best.distance, positive(run.distance)); p.best.time = Math.max(p.best.time, positive(run.time)); p.best.kills = Math.max(p.best.kills, natural(run.kills));
  if (run.won) { p.wins++; p.bossKilled = true; }
  for (const id of Array.isArray(run.minibosses) ? run.minibosses : []) if (/^[0-4]$/.test(String(id))) p.minibosses[id] = true;
  if (run.id) p.lastRunId = run.id;
  return p;
}
export { ownedWeapons };

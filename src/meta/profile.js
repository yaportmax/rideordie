// Save/load and host-owned campaign purchases.
import { DEFAULT_PROFILE, TRUCKS, UPGRADE_BY_ID, WEAPON_TRACKS, WEAPON_TRACK_MAX, ownedWeapons, TRUCK_COLORS, upgradeLevel, upgradeLimit } from '../data/upgrades.js';
import { WEAPONS } from '../data/weapons.js';
import { familyOf, normalizeFamilyUpgrades, stagePurchaseAllowed } from '../data/vehicle_families.js';
import { normalizeWeaponOptics } from '../data/weapon_optics.js';
import { normalizeWeaponAttachments } from '../data/weapon_attachments.js';
import { weaponPurchaseState } from './weapon_progression.js';
import { weaponTrackPurchaseState } from './weapon_tuning.js';
import { defaultCampaignProgress, normalizeCampaignProgress, normalizeJourney } from '../data/campaign.js';
import { SaveStore } from './save_store.js';
import { assertSupportedProfile, contentProfileVersion } from '../../server/saves/profile_support.js';
export { campaignJourney, selectCampaignLevel, creditCampaignLevel } from '../data/campaign.js';

export { upgradeLevel, upgradeLimit };
export { buyWeaponOptic, equipWeaponOptic } from './weapon_optics.js';
export { buyWeaponAttachment, equipWeaponAttachment } from './weapon_attachments.js';
export { weaponPurchaseState } from './weapon_progression.js';
export { weaponTrackPurchaseState } from './weapon_tuning.js';

const KEY = 'rideordie.profile.v1';
const stores = new WeakMap();
const saveOutcomes = new WeakMap();
const blockedStorage = { getItem() { throw new Error('Local storage is unavailable'); }, setItem() { throw new Error('Local storage is unavailable'); } };
const record = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const natural = (v, max = Number.MAX_SAFE_INTEGER) => Number.isFinite(v) ? Math.min(max, Math.max(0, Math.trunc(v))) : 0;
const positive = (v) => Number.isFinite(v) ? Math.max(0, v) : 0;
const validTruck = (id) => TRUCKS.some((t) => t.id === id);
const validWeapon = (id) => Object.hasOwn(WEAPONS, id);
const bestRecord = value => { const b=record(value); return {distance:positive(b.distance),furthestS:Math.max(positive(b.furthestS),positive(b.distance)),time:positive(b.time),kills:natural(b.kills)}; };
export function normalizeCampaignRecords(value) {
  const records={};
  for(const [key,best] of Object.entries(record(value))) if(/^(?:[1-9]|10)$/.test(key))records[key]=bestRecord(best);
  return records;
}
export function bestForJourney(profile, journey) {
  const j=normalizeJourney(journey);
  return bestRecord(j.mode==='campaign'?record(profile?.campaignRecords)[j.level]:j.mode==='marathon'?profile?.marathonBest:profile?.best);
}

/** Repair incomplete/old saves without allowing malformed levels or loadouts to break a run. */
export function normalizeProfile(value) {
  assertSupportedProfile(value);
  const p = record(value), d = DEFAULT_PROFILE();
  const owned = Array.isArray(p.trucks) ? p.trucks.filter(validTruck) : [];
  // Legacy campaigns retain their selected pickup even when the old ownership
  // array was incomplete. New schema saves must actually own their selection.
  if (p.vehicleUpgradeSchema !== 2 && /^truck_t[1-4]$/.test(p.truck) && !owned.includes(p.truck)) owned.push(p.truck);
  const trucks = [...new Set([...d.trucks, ...owned])];
  const upgrades = {};
  for (const [id, u] of Object.entries(UPGRADE_BY_ID)) upgrades[id] = natural(record(p.upgrades)[id], u.costs.length);
  const familyUpgrades = normalizeFamilyUpgrades({ ...p, upgrades });
  // Content marker, independent of selected chassis. Empty unowned rows do
  // not opt old campaigns into a newer profile, while paid gear always does.
  const weapons = { pistol: { dmg: 0, mag: 0, rel: 0, hnd: 0 } };
  for (const [id, levels] of Object.entries(record(p.weapons))) {
    if (!validWeapon(id)) continue;
    weapons[id] = Object.fromEntries(WEAPON_TRACKS.map(({ id: track }) => [track, natural(record(levels)[track], WEAPON_TRACK_MAX)]));
  }
  const loadout = [...new Set((Array.isArray(p.loadout) ? p.loadout : d.loadout).filter((id) => Object.hasOwn(weapons, id)))].slice(0, 3);
  const weaponOptics = normalizeWeaponOptics({ weapons, weaponOptics: p.weaponOptics });
  const weaponAttachments = normalizeWeaponAttachments({ weapons, weaponAttachments: p.weaponAttachments });
  const profileVersion = contentProfileVersion({ trucks, ...familyUpgrades, weaponOptics, weaponAttachments });
  const best = record(p.best);
  const normalized = {
    ...d, ...p, v: profileVersion,
    campaignId: typeof p.campaignId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(p.campaignId) ? p.campaignId : d.campaignId,
    revision: natural(p.revision), cash: natural(p.cash), totalCash: natural(p.totalCash), runs: natural(p.runs), wins: natural(p.wins),
    best: { distance: positive(best.distance), furthestS: Math.max(positive(best.furthestS), positive(best.distance)), time: positive(best.time), kills: natural(best.kills) },
    trucks, truck: trucks.includes(p.truck) ? p.truck : d.truck, ...familyUpgrades, weapons, weaponOptics, weaponAttachments, loadout: loadout.length ? loadout : ['pistol'],
    truckColor: natural(p.truckColor, TRUCK_COLORS.length - 1),
    minibosses: Object.fromEntries(Object.entries(record(p.minibosses)).filter(([id, done]) => /^[0-4]$/.test(id) && done === true)),
    bossKilled: p.bossKilled === true,
    campaignProgress: normalizeCampaignProgress(p.campaignProgress),
    campaignRecords: normalizeCampaignRecords(p.campaignRecords), marathonBest: bestRecord(p.marathonBest),
    lastRunId: typeof p.lastRunId === 'string' ? p.lastRunId : null,
    coopLastRunId: typeof p.coopLastRunId === 'string' && p.coopLastRunId.length > 0 && p.coopLastRunId.length <= 128 ? p.coopLastRunId : null,
  };
  if (Object.keys(weaponAttachments).length) normalized.weaponAttachments = weaponAttachments;
  else delete normalized.weaponAttachments;
  return normalized;
}

/** Keep personal slots separate from foreign co-op campaign mirrors. */
export function getSaveStorage() {
  let storage;
  try { storage = globalThis.localStorage; } catch { /* Browser security can block the getter itself. */ }
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') storage = blockedStorage;
  return storage;
}
export function getSaveStore() {
  const storage = getSaveStorage();
  let store = stores.get(storage);
  if (!store) {
    store = new SaveStore({ storage, normalize: normalizeProfile, fresh: () => normalizeProfile(DEFAULT_PROFILE()) });
    stores.set(storage, store);
  }
  return store;
}
export function profileSaveStatus(profile) { return saveOutcomes.get(profile) || null; }
export function loadProfile(campaignId) {
  if (!campaignId) {
    try { return getSaveStore().load(); } catch { /* Store exposes the failure; keep a playable session. */ }
    return normalizeProfile(DEFAULT_PROFILE());
  }
  try {
    const raw = localStorage.getItem(`${KEY}.${campaignId}`);
    if (raw) return normalizeProfile(JSON.parse(raw));
  } catch (error) { if (error?.code === 'unsupported-profile') throw error; /* blocked or damaged storage */ }
  return { ...DEFAULT_PROFILE(), campaignProgress: defaultCampaignProgress(), campaignRecords:{}, marathonBest:bestRecord() };
}
export function saveProfile(p) {
  assertSupportedProfile(p); p.v = contentProfileVersion(p);
  p.revision = natural(p.revision) + 1;
  const result = getSaveStore().save(p);
  saveOutcomes.set(p, result);
  return p;
}
export function newerProfile(a, b) { return (a?.revision || 0) >= (b?.revision || 0) ? a : b; }

export function buyTruck(p, id) {
  assertSupportedProfile(p);
  const t = TRUCKS.find((x) => x.id === id);
  if (!t) return { ok: false, reason: 'invalid' };
  if (p.trucks.includes(id)) return { ok: false, reason: 'owned' };
  if (p.cash < t.cost) return { ok: false, reason: 'cash' };
  if (!stagePurchaseAllowed(p, id)) return { ok: false, reason: 'locked' };
  p.cash -= t.cost; p.trucks.push(id); p.truck = id; p.v = contentProfileVersion(p); return { ok: true };
}
export function selectTruck(p, id) { assertSupportedProfile(p); if (validTruck(id) && p.trucks.includes(id)) { p.truck = id; p.v = contentProfileVersion(p); return { ok: true }; } return { ok: false, reason: 'locked' }; }
export function upgradeCost(p, id) {
  if (!Object.hasOwn(UPGRADE_BY_ID, id)) return null;
  const u = UPGRADE_BY_ID[id], l = upgradeLevel(p, id);
  return l >= upgradeLimit(p, id) ? null : u.costs[l];
}
export function buyUpgrade(p, id) {
  assertSupportedProfile(p);
  if (!Object.hasOwn(UPGRADE_BY_ID, id)) return { ok: false, reason: 'invalid' };
  if (UPGRADE_BY_ID[id].retired) return { ok: false, reason: 'retired' };
  const c = upgradeCost(p, id);
  if (c === null) return { ok: false, reason: 'max' };
  if (p.cash < c) return { ok: false, reason: 'cash' };
  const u = UPGRADE_BY_ID[id], next = upgradeLevel(p, id) + 1;
  if (u.role === 'driver') {
    const families = normalizeFamilyUpgrades(p);
    families.vehicleUpgrades[familyOf(p.truck)][id] = next;
    Object.assign(p, families);
  } else p.upgrades[id] = next;
  p.cash -= c; p.v = contentProfileVersion(p); return { ok: true };
}
export function buyWeapon(p, id, careerLevel) {
  assertSupportedProfile(p);
  if (!validWeapon(id)) return { ok: false, reason: 'invalid' };
  const w = WEAPONS[id];
  if (Object.hasOwn(p.weapons, id)) return { ok: false, reason: 'owned' };
  const state = weaponPurchaseState(p, id, careerLevel);
  if (!state.ok) return { ok: false, reason: state.reason };
  p.cash -= w.cost; p.weapons[id] = { dmg: 0, mag: 0, rel: 0, hnd: 0 };
  p.weaponOptics = normalizeWeaponOptics(p);
  const attachmentRows = normalizeWeaponAttachments(p);
  if (Object.keys(attachmentRows).length) p.weaponAttachments = attachmentRows;
  else delete p.weaponAttachments;
  if (p.loadout.length < 3) p.loadout.push(id);
  return { ok: true };
}
export function buyWeaponTrack(p, id, track) {
  assertSupportedProfile(p);
  const state = weaponTrackPurchaseState(p, id, track);
  if (!state.ok) return { ok: false, reason: state.reason };
  p.cash -= state.cost; p.weapons[id][track] = state.nextLevel; return { ok: true };
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
  const journey=normalizeJourney(run.journey), best=bestForJourney(p,journey);
  // Chapters use their own local coordinates; only legacy road results alter
  // the old absolute 60km checkpoint record.
  best.furthestS=Math.max(best.furthestS,positive(run.furthestS),positive(run.distance));
  best.distance=Math.max(best.distance,positive(run.distance));best.time=Math.max(best.time,positive(run.time));best.kills=Math.max(best.kills,natural(run.kills));
  if(journey.mode==='campaign') { p.campaignRecords=normalizeCampaignRecords(p.campaignRecords);p.campaignRecords[journey.level]=best; }
  else if(journey.mode==='marathon')p.marathonBest=best;
  else p.best=best;
  const finale=journey.mode!=='campaign'||(journey.level===10&&run.levelCleared===true);
  if (run.won&&finale) { p.wins++; p.bossKilled = true; }
  if(journey.mode==='legacy')for (const id of Array.isArray(run.minibosses) ? run.minibosses : []) if (/^[0-4]$/.test(String(id))) p.minibosses[id] = true;
  if (run.id) p.lastRunId = run.id;
  return p;
}
export { ownedWeapons };

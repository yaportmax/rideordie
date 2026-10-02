// Shop catalogue. Every entry is data; `effects(profile)` folds owned upgrades into stat modifiers used by the run setup.
// COST_SCALE is the master economy knob (campaign target ~2-3 h across all runs).
import { WEAPON_ORDER, WEAPONS } from './weapons.js';
import { VEHICLES } from './vehicles.js';
import { equippedWeaponOptics } from './weapon_optics.js';
import { defaultCampaignProgress } from './campaign.js';
import { DRIVER_UPGRADE_IDS, PLAYER_VEHICLE_CATALOGUE, VEHICLE_FAMILIES, effectiveUpgrades, familyOf, upgradeCap, upgradeLevel } from './vehicle_families.js';

export { effectiveUpgrades, upgradeLevel };

export const COST_SCALE = 1.25;
const C = (arr) => arr.map((c) => Math.round(c * COST_SCALE));

/** Vehicle purchases. The chopped-roof sedan is the free new-campaign starter. */
export const TRUCKS = PLAYER_VEHICLE_CATALOGUE;

/** Leveled upgrades: {id, role, name, desc, costs[], per-level text}. */
export const UPGRADES = [
  // ---- driver / truck
  { id: 'engine', role: 'driver', name: 'ENGINE TUNE', desc: '+7% acceleration and top speed per level.', costs: C([800, 1500, 2600, 4200, 6500]) },
  { id: 'armor', role: 'driver', name: 'ARMOR PLATING', desc: '+16% truck HP and +4% bullet resistance per level.', costs: C([900, 1600, 2800, 4500, 7000]) },
  { id: 'tires', role: 'driver', name: 'TIRES & SUSPENSION', desc: '+4% grip per level. Level 3: run-flat tires.', costs: C([700, 1300, 2200, 3600, 5500]) },
  { id: 'nitro', role: 'driver', name: 'NITRO TANK', desc: 'Bigger nitro tank: +0.8 s of boost and faster refill per level.', costs: C([1500, 2400, 3800, 5600, 8000]) },
  { id: 'ram', role: 'driver', name: 'RAM PLATE', desc: 'Ramming hurts them more and you less.', costs: C([1200, 2600, 5200]) },
  { id: 'spikes', role: 'driver', name: 'SPIKED SKIRTS', desc: 'Enemies that side-swipe you take damage.', costs: C([2000, 5000]) },
  { id: 'glass', role: 'driver', name: 'ARMORED GLASS', desc: 'Driver takes 30% less bullet damage per level.', costs: C([2200, 4800]) },
  { id: 'fueltank', role: 'driver', name: 'SELF-SEALING TANK', desc: 'Fuel hits are far less likely to blow you up.', costs: C([1800, 4000]) },
  { id: 'oil', role: 'driver', name: 'OIL SLICK DROPPER', desc: 'Q: drop an oil slick behind you. Level 2: faster reload.', costs: C([2500, 4500]) },
  { id: 'mines', role: 'driver', name: 'MINE LAYER', desc: 'E: drop proximity mines. Level 2: bigger blast.', costs: C([3500, 6000]) },
  // ---- gunner
  { id: 'vest', role: 'gunner', name: 'BODY ARMOR', desc: 'T1 vest / T2 plate carrier / T3 heavy armor: more HP and less damage.', costs: C([1500, 5000, 12000]) },
  { id: 'grenades', role: 'gunner', name: 'GRENADE BANDOLIER', desc: '+1 grenade per level.', costs: C([1200, 2400, 4800]) },
  { id: 'grenadeDmg', role: 'gunner', name: 'FRAG UPGRADE', desc: 'Bigger, meaner frag grenades.', costs: C([2000, 4200]) },
  { id: 'medkit', role: 'gunner', name: 'MEDKITS', desc: 'One medkit per level per run: heals both of you.', costs: C([2000, 4200, 7000]) },
  { id: 'pouches', role: 'gunner', name: 'MAG POUCHES', desc: 'All reloads 12% faster per level.', costs: C([1600, 3200, 6000]) },
  { id: 'steady', role: 'gunner', name: 'STEADY HANDS', desc: 'Recoil and spread reduced 10% per level.', costs: C([1800, 3600, 6600]) },
  { id: 'scavenger', role: 'shared', name: 'SCAVENGER', desc: '+10% cash from everything per level.', costs: C([2500, 5200, 9000]) },
];
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** Driver tracks belong to the selected family; crew/shared tracks are global. */
export function upgradeLimit(profile, id, vehicleId = profile?.truck) {
  if (!Object.hasOwn(UPGRADE_BY_ID, id)) return 0;
  const u = UPGRADE_BY_ID[id];
  return u.role === 'driver' ? Math.min(u.costs.length, upgradeCap(familyOf(vehicleId), id)) : u.costs.length;
}

/** Weapon upgrade tracks (3 levels each) — names shown in the shop. */
export const WEAPON_TRACKS = [
  { id: 'dmg', name: 'DAMAGE', costMul: [0.16, 0.3, 0.55] },
  { id: 'mag', name: 'MAGAZINE', costMul: [0.12, 0.24, 0.45] },
  { id: 'rel', name: 'RELOAD', costMul: [0.1, 0.2, 0.4] },
  { id: 'hnd', name: 'HANDLING', costMul: [0.1, 0.2, 0.4] },
];
export function weaponTrackCost(weaponId, track, level) { // level = level being bought (0-based)
  const base = Math.max(WEAPONS[weaponId].baseCost ?? WEAPONS[weaponId].cost, 1800);
  return Math.round(base * WEAPON_TRACKS.find((t) => t.id === track).costMul[level] * COST_SCALE);
}
export const WEAPON_TRACK_MAX = 3;

export const DEFAULT_PROFILE = () => ({
  v: 1, campaignId: Math.random().toString(36).slice(2, 10), revision: 0,
  cash: 0, totalCash: 0, best: { distance: 0, time: 0, kills: 0 }, runs: 0, wins: 0,
  trucks: ['player_sedan_t1'], truck: 'player_sedan_t1',
  vehicleUpgradeSchema: 2,
  vehicleUpgrades: Object.fromEntries(Object.keys(VEHICLE_FAMILIES).map(id => [id, {}])),
  upgrades: {},                       // crew/shared id -> level
  weapons: { pistol: { dmg: 0, mag: 0, rel: 0, hnd: 0 } }, loadout: ['pistol'],
  weaponOptics: { pistol: { owned: ['standard'], equipped: 'standard' } },
  truckColor: 0, seen: {}, settings: {},
  bossKilled: false, minibosses: {}, campaignProgress: defaultCampaignProgress(),
  campaignRecords: {}, marathonBest: { distance: 0, furthestS: 0, time: 0, kills: 0 },
});

const TRUCK_COLORS = [0x8f6a3d, 0xa33a2c, 0x3d5c8f, 0x4c6b3a, 0x2b2b2b, 0xc99a2e, 0x7a4a8a, 0xd8d2c4];
export { TRUCK_COLORS };

/** Fold the profile into the numbers the run needs. */
export function effects(profile) {
  const truck = VEHICLES[profile.truck]?.kind === 'player' ? profile.truck : 'player_sedan_t1';
  const spec = VEHICLES[truck], levels = effectiveUpgrades(profile, truck);
  const lv = id => Number.isFinite(levels[id]) ? Math.max(0, Math.min(upgradeLimit(profile, id, truck), Math.trunc(levels[id]))) : 0;
  const tier = spec.familyStage ?? spec.tier;
  const nitro = spec.nitro;
  const vehicleUpgradeLevels = Object.freeze(Object.fromEntries(DRIVER_UPGRADE_IDS.map(id => [id, lv(id)])));
  const vestT = lv('vest');
  const e = {
    truck, tier, family: spec.family, stage: tier, vehicleUpgradeLevels,
    engineMul: 1 + 0.07 * lv('engine'), hpMul: 1 + 0.16 * lv('armor'), bulletResist: Math.max(0.55, 1 - 0.04 * lv('armor')),
    gripMul: 1 + 0.04 * lv('tires'), runFlat: lv('tires') >= 3,
    // Tank upgrades add to the selected chassis, rather than replacing every
    // tier's authored tank/refill with the Rustbucket's one-second baseline.
    nitroCap: nitro.capacity + (lv('nitro') > 0 ? 0.4 + 0.8 * lv('nitro') : 0),
    nitroRegen: nitro.regen + (lv('nitro') > 0 ? 0.03 : 0) + 0.03 * lv('nitro'),
    ramLevel: lv('ram'), spikes: lv('spikes'), glass: lv('glass'), fueltank: lv('fueltank'), oil: lv('oil'), mines: lv('mines'),
    gunnerHp: 100 + [0, 20, 50, 90][vestT], gunnerArmor: [0, 0.15, 0.3, 0.45][vestT], armorTier: vestT, driverHp: 100,
    driverArmor: 0.3 * lv('glass') > 0 ? 0.3 * lv('glass') : 0,
    grenades: 2 + lv('grenades'), grenadeLv: lv('grenadeDmg'), medkits: lv('medkit'),
    reloadMul: 1 - 0.12 * lv('pouches'), handling: lv('steady'), cashMul: 1 + 0.1 * lv('scavenger'),
    weapons: profile.loadout.slice(), weaponLevels: profile.weapons, weaponOptics: equippedWeaponOptics(profile),
  };
  return e;
}

/** Owned weapons in shop order. */
export const ownedWeapons = (profile) => WEAPON_ORDER.filter((id) => profile.weapons[id]);

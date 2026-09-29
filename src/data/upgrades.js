// Shop catalogue. Every entry is data; `effects(profile)` folds owned upgrades into stat modifiers used by the run setup.
// COST_SCALE is the master economy knob (campaign target ~2-3 h across all runs).
import { WEAPON_ORDER, WEAPONS } from './weapons.js';

export const COST_SCALE = 1.25;
const C = (arr) => arr.map((c) => Math.round(c * COST_SCALE));

/** Truck purchases (tier 1 owned from the start). */
export const TRUCKS = [
  { id: 'truck_t1', tier: 1, name: 'RUSTBUCKET', cost: 0, blurb: 'Rusted-out compact pickup. It runs. Mostly.' },
  { id: 'truck_t2', tier: 2, name: 'HAULER', cost: C([6500])[0], blurb: '3/4-ton workhorse: tougher, faster, roll bar + bull bar.' },
  { id: 'truck_t3', tier: 3, name: 'BRUISER', cost: C([17000])[0], blurb: 'Armor plated. Slit windows. Ram bumper. Mean.' },
  { id: 'truck_t4', tier: 4, name: 'JUGGERNAUT', cost: C([36000])[0], blurb: 'A war truck. Spikes, supercharger, nest for a gunner.' },
];

/** Leveled upgrades: {id, role, name, desc, costs[], per-level text}. */
export const UPGRADES = [
  // ---- driver / truck
  { id: 'engine', role: 'driver', name: 'ENGINE TUNE', desc: '+7% acceleration and top speed per level.', costs: C([800, 1500, 2600, 4200, 6500]) },
  { id: 'armor', role: 'driver', name: 'ARMOR PLATING', desc: '+16% truck HP and +4% bullet resistance per level.', costs: C([900, 1600, 2800, 4500, 7000]) },
  { id: 'tires', role: 'driver', name: 'TIRES & SUSPENSION', desc: '+4% grip per level. Level 3: run-flat tires.', costs: C([700, 1300, 2200, 3600, 5500]) },
  { id: 'nitro', role: 'driver', name: 'NITRO TANK', desc: 'Unlocks nitro; +0.8 s of boost and faster refill per level.', costs: C([1500, 2400, 3800, 5600, 8000]) },
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

/** Weapon upgrade tracks (3 levels each) — names shown in the shop. */
export const WEAPON_TRACKS = [
  { id: 'dmg', name: 'DAMAGE', costMul: [0.16, 0.3, 0.55] },
  { id: 'mag', name: 'MAGAZINE', costMul: [0.12, 0.24, 0.45] },
  { id: 'rel', name: 'RELOAD', costMul: [0.1, 0.2, 0.4] },
  { id: 'hnd', name: 'HANDLING', costMul: [0.1, 0.2, 0.4] },
];
export function weaponTrackCost(weaponId, track, level) { // level = level being bought (0-based)
  const base = Math.max(WEAPONS[weaponId].cost, 1800);
  return Math.round(base * WEAPON_TRACKS.find((t) => t.id === track).costMul[level] * COST_SCALE);
}
export const WEAPON_TRACK_MAX = 3;

export const DEFAULT_PROFILE = () => ({
  v: 1, campaignId: Math.random().toString(36).slice(2, 10), revision: 0,
  cash: 0, totalCash: 0, best: { distance: 0, time: 0, kills: 0 }, runs: 0, wins: 0,
  trucks: ['truck_t1'], truck: 'truck_t1',
  upgrades: {},                       // id -> level
  weapons: { pistol: { dmg: 0, mag: 0, rel: 0, hnd: 0 } }, loadout: ['pistol'],
  truckColor: 0, seen: {}, settings: {},
  bossKilled: false, minibosses: {},
});

const TRUCK_COLORS = [0x8f6a3d, 0xa33a2c, 0x3d5c8f, 0x4c6b3a, 0x2b2b2b, 0xc99a2e, 0x7a4a8a, 0xd8d2c4];
export { TRUCK_COLORS };

/** Fold the profile into the numbers the run needs. */
export function effects(profile) {
  const lv = (id) => profile.upgrades[id] || 0;
  const truck = profile.truck;
  const tier = +truck.slice(-1);
  const vestT = lv('vest');
  const e = {
    truck, tier,
    engineMul: 1 + 0.07 * lv('engine'), hpMul: 1 + 0.16 * lv('armor'), bulletResist: Math.max(0.55, 1 - 0.04 * lv('armor')),
    gripMul: 1 + 0.04 * lv('tires'), runFlat: lv('tires') >= 3,
    nitroCap: lv('nitro') > 0 ? 1.4 + 0.8 * lv('nitro') : 0, nitroRegen: 0.1 + 0.03 * lv('nitro'),
    ramLevel: lv('ram'), spikes: lv('spikes'), glass: lv('glass'), fueltank: lv('fueltank'), oil: lv('oil'), mines: lv('mines'),
    gunnerHp: 100 + [0, 20, 50, 90][vestT], gunnerArmor: [0, 0.15, 0.3, 0.45][vestT], armorTier: vestT, driverHp: 100,
    driverArmor: 0.3 * lv('glass') > 0 ? 0.3 * lv('glass') : 0,
    grenades: 2 + lv('grenades'), grenadeLv: lv('grenadeDmg'), medkits: lv('medkit'),
    reloadMul: 1 - 0.12 * lv('pouches'), handling: lv('steady'), cashMul: 1 + 0.1 * lv('scavenger'),
    weapons: profile.loadout.slice(), weaponLevels: profile.weapons,
  };
  return e;
}

/** Owned weapons in shop order. */
export const ownedWeapons = (profile) => WEAPON_ORDER.filter((id) => profile.weapons[id]);

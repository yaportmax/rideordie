// Chassis ownership and driver upgrades are independent for each vehicle family.
// Crew/shared purchases stay in profile.upgrades. This module has no catalogue
// imports so the stat/shop code can use it without a circular dependency.
export const PLAYER_VEHICLE_PROTOCOL = 1;
export const DRIVER_UPGRADE_MAX = Object.freeze({ engine: 5, armor: 5, tires: 5, nitro: 5, ram: 3, spikes: 2, glass: 2, fueltank: 2, oil: 2, mines: 2 });
export const DRIVER_UPGRADE_IDS = Object.freeze(Object.keys(DRIVER_UPGRADE_MAX));
const driverIDs = new Set(DRIVER_UPGRADE_IDS);

export const VEHICLE_FAMILIES = Object.freeze({
  sedan: Object.freeze({ name: 'SCRAP SEDAN', stageIDs: Object.freeze(['player_sedan_t1', 'player_sedan_t2']), emphasis: 'Light road runner', caps: Object.freeze({ engine: 4, armor: 3, tires: 4, nitro: 3, ram: 2, spikes: 1, glass: 2, fueltank: 2, oil: 2, mines: 1 }) }),
  rustbucket: Object.freeze({ name: 'RUSTBUCKET', stageIDs: Object.freeze(['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4']), emphasis: 'Armor, ramming and cargo', caps: DRIVER_UPGRADE_MAX }),
  buggy: Object.freeze({ name: 'DUNE BUGGY', stageIDs: Object.freeze(['player_buggy_t1', 'player_buggy_t2', 'player_buggy_t3']), emphasis: 'Acceleration and dirt handling', caps: Object.freeze({ engine: 5, armor: 2, tires: 5, nitro: 4, ram: 1, spikes: 1, glass: 1, fueltank: 2, oil: 1, mines: 1 }) }),
});
export const PLAYER_VEHICLE_CATALOGUE = Object.freeze([
  { id: 'player_sedan_t1', family: 'sedan', tier: 1, name: 'SCRAP SEDAN', cost: 0, blurb: 'A chopped-roof sedan. Light, affordable and ready for a roof gunner.' },
  { id: 'player_sedan_t2', family: 'sedan', tier: 2, name: 'ROAD RUNNER', cost: 6500, blurb: 'Rebuilt road chassis with a stronger engine and reinforced shell.' },
  { id: 'truck_t1', family: 'rustbucket', tier: 1, name: 'RUSTBUCKET', cost: 3125, blurb: 'Compact pickup with an open bed. Built for armor, cargo and ramming.' },
  { id: 'truck_t2', family: 'rustbucket', tier: 2, name: 'HAULER', cost: 8125, blurb: 'Tougher, faster pickup with a roll bar and bull bar.' },
  { id: 'truck_t3', family: 'rustbucket', tier: 3, name: 'BRUISER', cost: 21250, blurb: 'Armor-plated pickup with a heavy ram bumper.' },
  { id: 'truck_t4', family: 'rustbucket', tier: 4, name: 'JUGGERNAUT', cost: 45000, blurb: 'A war truck with spikes, a supercharger and a protected gunner bed.' },
  { id: 'player_buggy_t1', family: 'buggy', tier: 1, name: 'DUNE BUGGY', cost: 12500, blurb: 'A light rear-engine tube-frame buggy. Fast on dirt, light on armor.' },
  { id: 'player_buggy_t2', family: 'buggy', tier: 2, name: 'DUNE RUNNER', cost: 22500, blurb: 'Reinforced buggy frame with stronger acceleration and more nitro.' },
  { id: 'player_buggy_t3', family: 'buggy', tier: 3, name: 'SANDSTORM', cost: 37500, blurb: 'Race-tuned buggy with a braced chassis and a large boost reserve.' },
].map(Object.freeze));
export const PLAYER_VEHICLE_IDS = Object.freeze(PLAYER_VEHICLE_CATALOGUE.map(v => v.id));
const vehicleFamily = new Map(PLAYER_VEHICLE_CATALOGUE.map(v => [v.id, v.family]));
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const level = (value, cap) => Number.isFinite(value) ? Math.max(0, Math.min(cap, Math.trunc(value))) : 0;

export const familyOf = vehicleID => vehicleFamily.get(vehicleID) || 'rustbucket';
export const stageOf = vehicleID => VEHICLE_FAMILIES[familyOf(vehicleID)].stageIDs.indexOf(vehicleID) + 1;
export const upgradeCap = (familyID, upgradeID) => VEHICLE_FAMILIES[familyID]?.caps[upgradeID] ?? DRIVER_UPGRADE_MAX[upgradeID] ?? 0;

/** Old driver purchases move once into the legacy pickup inventory. Selecting
 * another family never grants copies of those purchases or deletes them. */
export function normalizeFamilyUpgrades(profile) {
  const global = record(profile?.upgrades), existing = record(profile?.vehicleUpgrades);
  const migrating = profile?.vehicleUpgradeSchema !== 2, vehicleUpgrades = {};
  for (const familyID of Object.keys(VEHICLE_FAMILIES)) {
    const owned = record(existing[familyID]); vehicleUpgrades[familyID] = {};
    for (const id of DRIVER_UPGRADE_IDS) {
      const cap = upgradeCap(familyID, id);
      const old = migrating && familyID === 'rustbucket' ? level(global[id], cap) : 0;
      vehicleUpgrades[familyID][id] = Math.max(old, level(owned[id], cap));
    }
  }
  const upgrades = {};
  for (const [id, value] of Object.entries(global)) if (!driverIDs.has(id)) upgrades[id] = value;
  return { vehicleUpgradeSchema: 2, vehicleUpgrades, upgrades };
}

/** Effective stat/appearance map, leaving saved per-family inventories intact. */
export function effectiveUpgrades(profile, vehicleID = profile?.truck) {
  const normalized = normalizeFamilyUpgrades(profile);
  return { ...normalized.upgrades, ...normalized.vehicleUpgrades[familyOf(vehicleID)] };
}
export function upgradeLevel(profile, id, vehicleID = profile?.truck) {
  const value = effectiveUpgrades(profile, vehicleID)[id];
  return level(value, driverIDs.has(id) ? upgradeCap(familyOf(vehicleID), id) : Number.MAX_SAFE_INTEGER);
}

/** Already owned legacy stages remain selectable even if a prior save omitted
 * a lower stage. Only new later-stage purchases need a same-family predecessor. */
export function stagePurchaseAllowed(profile, vehicleID) {
  if (!vehicleFamily.has(vehicleID)) return false;
  if (profile?.trucks?.includes(vehicleID)) return true;
  const stages = VEHICLE_FAMILIES[familyOf(vehicleID)].stageIDs, stage = stages.indexOf(vehicleID);
  return stage === 0 || profile?.trucks?.includes(stages[stage - 1]) === true;
}

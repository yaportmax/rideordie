// THE LEVIATHAN (final boss) + minibosses. Part boxes come from the boss GLB (src/data/model_info.json), model frame:
// ground origin, +Z forward, +X left. Part HP scale assumes a well upgraded rig (LMG/RPG ~300-400 dps).
import MODEL_INFO from './model_info.json' with { type: 'json' };

export const BOSS_ID = 60000;
const MI = MODEL_INFO.boss_warrig || { parts: {}, sockets: {}, wheels: {} };
export const BOSS_SOCKETS = MI.sockets;
export const BOSS_WHEELS = MI.wheels;

/** Damageable parts: hp, what destroying them does, and whether they are "core" (count toward the health bar).
 *  `phase`: the part is sealed (takes no damage) until that phase opens. Pacing: phase 1 lasts <= BOSS.phase1Max s, phase 2 <= phase2Max
 *  (then the reactor blows its own plates), so a fight runs ~3 min for a perfect aimbot and ~4 min at ~100 dps. */
export const BOSS_PARTS = {
  part_turret_1: { hp: 2300, core: true, label: 'FRONT TURRET', phase: 1 },
  part_turret_2: { hp: 2300, core: true, label: 'REAR TURRET', phase: 1 },
  part_pod_L: { hp: 1800, core: true, label: 'ROCKET POD', phase: 1 },
  part_pod_R: { hp: 1800, core: true, label: 'ROCKET POD', phase: 1 },
  part_turret_main: { hp: 4500, label: 'CANNON', phase: 2, marker: true },   // optional: silences the cannon, not needed to win
  part_tank_L: { hp: 5000, core: true, label: 'FUEL TANK', explodes: true, phase: 2 },
  part_tank_R: { hp: 5000, core: true, label: 'FUEL TANK', explodes: true, phase: 2 },
  panel_armor_rear_1: { hp: 5000, core: true, label: 'REAR ARMOR', phase: 2 },
  panel_armor_rear_2: { hp: 5000, core: true, label: 'REAR ARMOR', phase: 2 },
  panel_armor_rear_3: { hp: 5000, core: true, label: 'REAR ARMOR', phase: 2 },
  part_engine: { hp: 10500, core: true, label: 'REACTOR', weak: true, phase: 3, needs: ['panel_armor_rear_1', 'panel_armor_rear_2', 'panel_armor_rear_3', 'part_tank_L', 'part_tank_R'] },   // tanks cool it, plates cover it
  part_plow: { hp: 2500, label: 'PLOW' },
  part_stack_L: { hp: 700, label: 'STACK' },
  part_stack_R: { hp: 700, label: 'STACK' },
  panel_armor_t1_L1: { hp: 900 }, panel_armor_t1_L2: { hp: 900 }, panel_armor_t1_R1: { hp: 900 }, panel_armor_t1_R2: { hp: 900 },
  panel_armor_cab_L: { hp: 1100 }, panel_armor_cab_R: { hp: 1100 }, panel_armor_roof: { hp: 800 },
  ramp_rear: { hp: 99999, label: 'RAMP', invulnerable: true },
};
export const PART_NAMES = Object.keys(BOSS_PARTS).filter((n) => MI.parts?.[n]);

/** Hit boxes: parts from the model + structural body boxes that stop bullets (no damage). */
export function bossZones() {
  const zones = [];
  for (const n of PART_NAMES) {
    const b = MI.parts[n];
    zones.push({ kind: n, shape: 'box', c: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2], h: [Math.max(0.15, (b.max[0] - b.min[0]) / 2), Math.max(0.15, (b.max[1] - b.min[1]) / 2), Math.max(0.15, (b.max[2] - b.min[2]) / 2)] });
  }
  for (const b of BOSS_BODY) zones.push({ kind: 'body', shape: 'box', c: b.center, h: b.half });
  return zones;
}

/** Physics / bullet-stopping body boxes (model frame). Cab, fortress trailer, cannon trailer. */
export const BOSS_BODY = [
  { center: [0, 3.2, 11.3], half: [3.3, 2.9, 6.1] },
  { center: [0, 3.0, -2.6], half: [3.4, 1.7, 6.8] },
  { center: [0, 2.9, -13.0], half: [3.4, 1.6, 4.2] },
];

export const BOSS = {
  length: 36, speedMin: 20, speedMax: 35, speedMax3: 41, gapPhase1: 38, gapPhase2: 30, rammingGap: -8,
  turret: { rate: 8, burst: [8, 18], pause: [1.0, 2.0], dmg: 4.2, speed: 220, spread: 3.0, range: 180 },
  pods: { every: [7, 10], rockets: 5, interval: 0.16, speed: 58, blast: 8, blastDmg: 55, spread: 0.12 },
  cannon: { every: [6, 8], charge: 1.3, speed: 150, blast: 13, blastDmg: 130 },
  flame: { range: 16, dps: 55 },
  ramp: { every: [13, 18], cars: ['e_buggy', 'e_sedan', 'e_buggy', 'e_muscle'] },
  tankBlast: { radius: 16, dmg: 160, coreDmg: 0.06 },
  // pacing (3-4 min fight with beats): phase 1 (guns) ends when <= 1 gun is left or after phase1Max s; phase 2 (cannon, flamers,
  // tanks, rear armour) ends when the rear armour is gone or after phase2Max s (the overheating reactor blows its own plates off)
  phase1Max: 58, phase2Max: 95,
  blockadeAt: 16,           // s into the fight: the train smashes through a wall of wrecks up the road
  waves: { 2: ['e_buggy', 'e_sedan', 'e_muscle'], 3: ['e_buggy', 'e_buggy'] },   // escort drops when a phase starts
  bounty: 50000,
};

// Minibosses ("warlords"): one per biome. Each has a unique silhouette (view/car_view.js ELITE_KITS[look.kit]), a nameplate +
// HUD bar, an intro banner (ui/banner.js), an attack pattern and a glowing WEAK POINT (hull hits x0.6, weak point x`mul`).
//   behavior: the brain role (sim/ai.js); pattern: {summon: s, summonKinds, crush}; enter: 'ahead' (up the road) | 'park' (waiting on
//   the shoulders ahead, peel out as you pass) | 'behind'.
export const MINIBOSSES = [
  // A real larger chassis: its mesh, six-wheel suspension, seats and hull agree
  // on both peers. Retain the original technical-based HP and single-MG crew.
  { s: 9300, name: 'SCRAPJAW', title: 'KING OF THE SCRAPYARD', spec: 'e_heavy', massMul: 1, hpBase: 150, hpMul: 5.5, gunners: 1, driverHp: 45, gunnerHp: 50, armor: 0.3, gun: 'mg_warlord', behavior: 'leader', enter: 'ahead',
    pattern: { summon: 24, summonKinds: ['e_buggy', 'e_buggy'], summonCap: 3 }, escorts: [],
    weak: { zone: 'fuel', mul: 5, label: 'AMMO CRATE — REAR' }, look: { kit: 'scrapjaw', paint: 0xd6a01c, paint2: 0x1b1a18, glow: 0xff8a1a },
    tip: 'Stays ahead and hoses you with his machine gun. Calls in buggies.' },
  { s: 19300, name: 'THE BONECRUSHER TWINS', title: 'BROTHERS IN CARNAGE', spec: 'e_muscle', count: 2, massMul: 1.6, hpMul: 13, armor: 0.25, behavior: 'flanker', enter: 'park',
    pattern: { crush: true }, escorts: [],
    weak: { zone: 'engine', mul: 5, label: 'SUPERCHARGERS — HOOD' }, look: { kit: 'twins', paint: 0xa3121a, paint2: 0xe8e0cc, glow: 0xff3322 },
    tip: 'One on each flank. When both horns sound, they crush you from both sides.' },
  { s: 29300, name: 'MOTHER TRUCKER', title: 'QUEEN OF THE CONVOY', spec: 'e_heavy', massMul: 1.0, hpMul: 7, armor: 0.3, gun: 'hmg_warlord', gun2: 'rpg', behavior: 'heavy', enter: 'ahead',
    escorts: ['e_sedan', 'e_technical'],
    weak: { zone: 'fuel', mul: 5, label: 'FUEL TANKS — REAR' }, look: { kit: 'mother', paint: 0x8e1f6e, paint2: 0x151515, glow: 0xff3fc0 },
    tip: 'A moving wall: it blocks your lane, brake-checks you and fires rockets.' },
  { s: 40300, name: 'BLAZE', title: 'THE FIRE-STARTER', spec: 'e_tanker', massMul: 1.0, hpMul: 4.5, armor: 0.25, gun: 'rpg', behavior: 'dropper', enter: 'ahead',
    pattern: {}, escorts: ['e_buggy', 'e_buggy'],
    weak: { zone: 'fuel', mul: 4, label: 'RELEASE VALVE — REAR' }, look: { kit: 'blaze', paint: 0xc2410f, paint2: 0x2a1208, glow: 0xffa028 },
    tip: 'Lays burning barrels in your lane. Keep out of his wake.' },
  { s: 49300, name: 'IRON PRIEST', title: 'PROPHET OF THE LEVIATHAN', spec: 'e_van', massMul: 1.25, hpMul: 9, armor: 0.45, gun: 'rpg', behavior: 'summoner', enter: 'behind',
    pattern: { summon: 15, summonKinds: ['e_buggy', 'e_buggy', 'e_muscle'], summonCap: 6 }, escorts: ['e_buggy', 'e_muscle'],
    weak: { zone: 'engine', mul: 5, label: 'FURNACE GRILLE — FRONT' }, look: { kit: 'priest', paint: 0x3a3c40, paint2: 0xb8902e, glow: 0xff4a1a },
    tip: 'Armoured rocket van. Summons the faithful until you break his furnace.' },
];

// Stable wire/view identities: the original five slots remain unchanged.
// Campaign chapter order is separate because the city chief precedes Priest.
export const ELITE_BOSSES = [
  ...MINIBOSSES,
  { s: 36700, name: 'THE OVERSEER', title: 'WARDEN OF THE RUINED CITY', spec: 'e_double_bus', massMul: 1, hpBase: 600, hpMul: 6.5, armor: 0.35,
    gun: 'hmg_warlord', gun2: 'hmg_warlord', behavior: 'heavy', enter: 'ahead', escorts: ['e_muscle'],
    weak: { zone: 'engine', mul: 5, label: 'REAR ENGINE GRILLE' }, look: { kit: 'mother', paint: 0x314b53, paint2: 0xd8bc54, glow: 0xffc44a },
    tip: 'The double-decker blocks the road. Silence its upper-deck gunners and break the rear engine grille.' },
  { s: 53200, name: 'DEEPWARDEN', title: 'KEEPER OF THE UNDERWORLD', spec: 'e_heavy', massMul: 1.15, hpMul: 7, armor: 0.38,
    gun: 'hmg_warlord', gunners: 1, behavior: 'rammer', enter: 'ahead', pattern: { summon: 22, summonKinds: ['e_muscle'], summonCap: 3 }, escorts: [],
    weak: { zone: 'engine', mul: 5, label: 'DRILL DRIVE — FRONT' }, look: { kit: 'priest', paint: 0x635645, paint2: 0x242624, glow: 0xffa649 },
    tip: 'The tunnel rig charges your rear corners. Break its drill drive and avoid its reinforcements.' },
  { s: 61500, name: 'STORM TALON', title: 'CAPTAIN OF THE SKYWAY', spec: 'e_technical', count: 2, massMul: 1.15, hpMul: 11, armor: 0.3,
    gun: 'mg_warlord', behavior: 'flanker', enter: 'ahead', pattern: { crush: true }, escorts: [],
    weak: { zone: 'engine', mul: 5, label: 'TURBINE INTAKE — FRONT' }, look: { kit: 'mother', paint: 0x667c96, paint2: 0xd6e4ee, glow: 0x71d9ff },
    tip: 'Two skyway crews flank the truck. Break their turbine intakes before their coordinated charge.' },
  { s: 69750, name: 'HELLHOUND', title: 'HERALD OF THE INFERNO', spec: 'e_tanker', massMul: 1.1, hpMul: 8, armor: 0.35,
    gun: 'rpg', behavior: 'dropper', enter: 'ahead', pattern: { summon: 24, summonKinds: ['e_buggy'], summonCap: 3 }, escorts: [],
    weak: { zone: 'fuel', mul: 5, label: 'INFERNAL PRESSURE VALVE — REAR' }, look: { kit: 'blaze', paint: 0x551414, paint2: 0x17100e, glow: 0xff4924 },
    tip: 'The infernal tanker lays burning barrels. Reach its rear valve while clearing the summoned crew.' },
];
export const CAMPAIGN_BOSSES = [0, 1, 2, 3, 5, 4, 6, 7, 8].map(index => ({ ...ELITE_BOSSES[index], eliteIndex: index }));
export const BOSS_NAMES = ['', ...ELITE_BOSSES.map(m => m.name), 'THE LEVIATHAN'];

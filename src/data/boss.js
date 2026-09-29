// THE LEVIATHAN (final boss) + minibosses. Part boxes come from the boss GLB (src/data/model_info.json), model frame:
// ground origin, +Z forward, +X left. Part HP scale assumes a well upgraded rig (LMG/RPG ~300-400 dps).
import MODEL_INFO from './model_info.json' with { type: 'json' };

export const BOSS_ID = 60000;
const MI = MODEL_INFO.boss_warrig || { parts: {}, sockets: {}, wheels: {} };
export const BOSS_SOCKETS = MI.sockets;
export const BOSS_WHEELS = MI.wheels;

/** Damageable parts: hp, what destroying them does, and whether they are "core" (count toward the health bar). */
export const BOSS_PARTS = {
  part_turret_1: { hp: 2600, core: true, label: 'FRONT TURRET' },
  part_turret_2: { hp: 2600, core: true, label: 'REAR TURRET' },
  part_pod_L: { hp: 2000, core: true, label: 'ROCKET POD' },
  part_pod_R: { hp: 2000, core: true, label: 'ROCKET POD' },
  part_turret_main: { hp: 4200, core: true, label: 'CANNON' },
  part_tank_L: { hp: 1700, core: true, label: 'FUEL TANK', explodes: true },
  part_tank_R: { hp: 1700, core: true, label: 'FUEL TANK', explodes: true },
  panel_armor_rear_1: { hp: 1800, core: true, label: 'REAR ARMOR' },
  panel_armor_rear_2: { hp: 1800, core: true, label: 'REAR ARMOR' },
  panel_armor_rear_3: { hp: 1800, core: true, label: 'REAR ARMOR' },
  part_engine: { hp: 6000, core: true, label: 'REACTOR', weak: true, needs: ['panel_armor_rear_1', 'panel_armor_rear_2', 'panel_armor_rear_3'] },
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
  bounty: 50000,
};

// Minibosses ("warlords"): one per biome. Each has a unique silhouette (view/car_view.js ELITE_KITS[look.kit]), a nameplate +
// HUD bar, an intro banner (ui/banner.js), an attack pattern and a glowing WEAK POINT (hull hits x0.6, weak point x`mul`).
//   behavior: the brain role (sim/ai.js); pattern: {summon: s, summonKinds, crush}; enter: 'ahead' (waits up the road) | 'behind'.
export const MINIBOSSES = [
  { s: 9300, name: 'SCRAPJAW', title: 'KING OF THE SCRAPYARD', spec: 'e_technical', hpMul: 7, armor: 0.3, gun: 'hmg', behavior: 'leader', enter: 'ahead',
    pattern: { summon: 20, summonKinds: ['e_buggy', 'e_buggy'] }, escorts: ['e_buggy'],
    weak: { zone: 'fuel', mul: 5, label: 'AMMO CRATE — REAR' }, look: { kit: 'scrapjaw', paint: 0xd6a01c, paint2: 0x1b1a18, glow: 0xff8a1a },
    tip: 'Stays ahead and hoses you with the heavy MG. Calls in buggies.' },
  { s: 19300, name: 'THE BONECRUSHER TWINS', title: 'BROTHERS IN CARNAGE', spec: 'e_muscle', count: 2, hpMul: 5, armor: 0.25, behavior: 'flanker', enter: 'behind',
    pattern: { crush: true }, escorts: [],
    weak: { zone: 'engine', mul: 5, label: 'SUPERCHARGERS — HOOD' }, look: { kit: 'twins', paint: 0xa3121a, paint2: 0xe8e0cc, glow: 0xff3322 },
    tip: 'One on each flank. When both horns sound, they crush you from both sides.' },
  { s: 29300, name: 'MOTHER TRUCKER', title: 'QUEEN OF THE CONVOY', spec: 'e_heavy', hpMul: 3.5, armor: 0.3, gun: 'hmg', gun2: 'rpg', behavior: 'heavy', enter: 'ahead',
    escorts: ['e_sedan', 'e_technical'],
    weak: { zone: 'fuel', mul: 5, label: 'FUEL TANKS — REAR' }, look: { kit: 'mother', paint: 0x8e1f6e, paint2: 0x151515, glow: 0xff3fc0 },
    tip: 'A moving wall: it blocks your lane, brake-checks you and fires rockets.' },
  { s: 40300, name: 'BLAZE', title: 'THE FIRE-STARTER', spec: 'e_tanker', hpMul: 3.5, armor: 0.25, gun: 'rpg', behavior: 'dropper', enter: 'ahead',
    pattern: {}, escorts: ['e_buggy', 'e_buggy'],
    weak: { zone: 'fuel', mul: 4, label: 'RELEASE VALVE — REAR' }, look: { kit: 'blaze', paint: 0xc2410f, paint2: 0x2a1208, glow: 0xffa028 },
    tip: 'Lays burning barrels in your lane. Keep out of his wake.' },
  { s: 49300, name: 'IRON PRIEST', title: 'PROPHET OF THE LEVIATHAN', spec: 'e_van', hpMul: 9, armor: 0.45, gun: 'rpg', behavior: 'summoner', enter: 'behind',
    pattern: { summon: 13, summonKinds: ['e_buggy', 'e_buggy', 'e_muscle'] }, escorts: ['e_buggy', 'e_muscle'],
    weak: { zone: 'engine', mul: 5, label: 'FURNACE GRILLE — FRONT' }, look: { kit: 'priest', paint: 0x3a3c40, paint2: 0xb8902e, glow: 0xff4a1a },
    tip: 'Armoured rocket van. Summons the faithful until you break his furnace.' },
];
export const BOSS_NAMES = ['', ...MINIBOSSES.map((m) => m.name), 'THE LEVIATHAN'];

// Per-weapon muzzle flash / tracer / casing tuning. Muzzle sheet cells: 0 star7, 1 star9, 2 star4, 3 cone, 4 cone wide+side, 5 cone narrow, 6 star12+halo, 7 twin-lobe cone.
import { WEAPONS } from '../../data/weapons.js';
import { hexLinear } from './util.js';

export const MUZZLE = {
  pistol:   { stars: [2, 0], cones: [5, 3], star: 0.45, coneL: 0.94, coneW: 0.34, life: 0.055, hdr: 5.5, col: [1.0, 0.74, 0.36], smoke: 1, sparks: 3, glow: 0.96, shake: 0.0, casing: 0 },
  revolver: { stars: [1, 0], cones: [3, 4], star: 0.68, coneL: 1.39, coneW: 0.5, life: 0.07, hdr: 6.0, col: [1.0, 0.72, 0.32], smoke: 2, sparks: 5, glow: 1.32, shake: 0.0, casing: 0 },
  smg:      { stars: [2, 6], cones: [5, 3], star: 0.42, coneL: 0.86, coneW: 0.29, life: 0.045, hdr: 5.0, col: [1.0, 0.78, 0.4], smoke: 1, sparks: 2, glow: 0.84, shake: 0.0, casing: 0 },
  shotgun:  { stars: [1, 6], cones: [4], star: 1.08, coneL: 2.95, coneW: 1.52, life: 0.085, hdr: 6.5, col: [1.0, 0.68, 0.3], smoke: 4, sparks: 9, glow: 2.04, shake: 0.0, casing: 2 },
  rifle:    { stars: [0, 2], cones: [3, 5], star: 0.65, coneL: 1.31, coneW: 0.44, life: 0.05, hdr: 5.5, col: [1.0, 0.76, 0.38], smoke: 1, sparks: 3, glow: 1.2, shake: 0.0, casing: 1 },
  lmg:      { stars: [6, 0], cones: [7, 3], star: 0.79, coneL: 1.56, coneW: 0.6, life: 0.05, hdr: 6.0, col: [1.0, 0.72, 0.34], smoke: 2, sparks: 4, glow: 1.44, shake: 0.0, casing: 1 },
  minigun:  { stars: [2, 6], cones: [5, 3], star: .55, coneL: 1.20, coneW: .40, life: .035, hdr: 5.5, col: [1.0, .76, .36], smoke: 1, sparks: 2, glow: 1.12, shake: 0.0, casing: 1 },
  sniper:   { stars: [1, 6], cones: [5], star: 1.22, coneL: 3.61, coneW: 0.8, life: 0.09, hdr: 7.0, col: [1.0, 0.8, 0.5], smoke: 4, sparks: 8, glow: 2.16, shake: 0.0, casing: 1 },
  rpg:      { stars: [6], cones: [4], star: 1.01, coneL: 1.64, coneW: 0.96, life: 0.09, hdr: 6.0, col: [1.0, 0.7, 0.3], smoke: 2, sparks: 0, glow: 1.68, shake: 0.0, casing: -1 },
  heavy:    { stars: [6, 0], cones: [7, 3], star: 1.6, coneL: 3.0, coneW: 1.2, life: 0.06, hdr: 6.5, col: [1.0, 0.62, 0.3], smoke: 2, sparks: 4, glow: 2.8, shake: 0.0, casing: -1 },
  enemy:    { stars: [2, 0], cones: [3, 5], star: 0.61, coneL: 1.23, coneW: 0.4, life: 0.05, hdr: 5.0, col: [1.0, 0.55, 0.28], smoke: 1, sparks: 1, glow: 0.96, shake: 0.0, casing: -1 },
};

/** Casing kinds: 0 = 9mm brass, 1 = rifle brass, 2 = red shotgun shell. length/radius in metres (scaled up ~2x so they read on screen). */
export const CASING = [
  { len: 0.042, rad: 0.0105, hex: 0xd6a648 },
  { len: 0.075, rad: 0.0125, hex: 0xd0a040 },
  { len: 0.085, rad: 0.0190, hex: 0xb8311f },
];

/** Tracer look: hex from weapons.js, linear colour + width/length. */
export const TRACER = {};
for (const id of Object.keys(WEAPONS)) {
  const w = WEAPONS[id];
  const c = hexLinear(w.tracer ?? 0xffd27a);
  TRACER[id] = { col: c, len: Math.max(2.4, (w.tracerLen || 3) * 1.6), width: id === 'sniper' ? 0.14 : id === 'shotgun' ? 0.06 : id === 'lmg' ? 0.1 : 0.085, hdr: id === 'sniper' ? 8 : 6 };
}
TRACER.enemy = { col: hexLinear(0xff6a30), len: 2.6, width: 0.07, hdr: 6 };
TRACER.heavy = { col: hexLinear(0xff5a20), len: 4.2, width: 0.13, hdr: 7 };

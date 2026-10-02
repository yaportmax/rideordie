// Biome tables: road character, terrain profile parameters, look (fog/sky/light), scatter densities.
// The run is a single road; biome is a function of distance along it (s, meters).
import { CAMPAIGN_THEMES } from './campaign_themes.js';

export const ROAD_WIDTH = 14;     // asphalt edge to edge
export const SHOULDER = 2.5;      // gravel shoulder each side (drivable)
export const HALF_ROAD = ROAD_WIDTH / 2;

/** Progress is DISTANCE along the road: ~60 km to the dam (final boss). With the slowest truck (~28 m/s average) that is ~40 min, with the
 *  fastest (~50 m/s) ~20 min. Biome, time of day, difficulty and boss are all functions of distance (+ a little run time). */
export const BIOME_PLAN = [
  { id: 'desert', len: 10000 },
  { id: 'canyon', len: 10000 },
  { id: 'coast', len: 10000 },
  { id: 'mountain', len: 11000 },
  { id: 'city', len: 9000 },
  { id: 'dam', len: 1e9 }, // boss arena road, open ended
];
export const TRANSITION = 600; // blend distance (m) around a biome boundary
export const DAM_START = BIOME_PLAN.slice(0, -1).reduce((a, b) => a + b.len, 0); // 50 km: the dam biome starts here
export const BOSS_S = 60000; // the Leviathan is waiting on the dam road here
/** Distances of the minibosses (m): just before each biome ends. */
export const MINIBOSS_S = [9300, 19300, 29300, 40300, 49300];
export const BIOME_ORDER = BIOME_PLAN.map((b) => b.id);
export const BIOME_START = (() => { let s = 0; return BIOME_PLAN.map((b) => { const o = s; s += b.len; return o; }); })();

export const BIOMES = {
  ...CAMPAIGN_THEMES,
  desert: {
    name: 'Scorched Highway',
    road: { kmax: 1 / 380, straight: 0.35, sigma: 0.7, slopeMax: 0.05, elevBase: 0, elevAmp: 7, elevScale: 500, bank: 55 },
    terrain: { kind: 'dunes', flat: 30, amp: 5, far: 55 },
    sky: { sun: 46, az: 200, turbidity: 8, rayleigh: 1.4, mie: 0.006, exposure: 0.95, fog: 0xd9b48a, fogDensity: 0.00085, sunColor: 0xffe2b0, sunI: 3.4, hemiSky: 0xbcd2ff, hemiGround: 0xb08a5e, hemiI: 0.9 },
    ground: ['sand', 'dirt_red', 'gravel', 'dry_grass'],
    scatter: { rocks: 0.5, cactus: 0.6, shrubs: 1.0, deadTrees: 0.15, pines: 0, grass: 0.3 },
  },
  canyon: {
    name: 'Red Canyon',
    road: { kmax: 1 / 190, straight: 0.15, sigma: 0.9, slopeMax: 0.06, elevBase: 12, elevAmp: 9, elevScale: 400, bank: 70 },
    terrain: { kind: 'canyon', flat: 6, amp: 6, wall: 55, far: 90 },
    sky: { sun: 34, az: 215, turbidity: 6, rayleigh: 1.7, mie: 0.005, exposure: 0.92, fog: 0xd08c62, fogDensity: 0.0011, sunColor: 0xffd29a, sunI: 3.6, hemiSky: 0xa8c0ff, hemiGround: 0xa0553a, hemiI: 0.85 },
    ground: ['dirt_red', 'rock_red', 'sand', 'gravel'],
    scatter: { rocks: 1.0, cactus: 0.25, shrubs: 0.5, deadTrees: 0.1, pines: 0, grass: 0.05 },
  },
  coast: {
    name: 'Coastal Cliffs',
    road: { kmax: 1 / 165, straight: 0.15, sigma: 0.85, slopeMax: 0.07, elevBase: 26, elevAmp: 10, elevScale: 350, bank: 70 },
    terrain: { kind: 'coast', flat: 12, amp: 7, cliff: 42, seaSide: 1, far: 60 },
    sky: { sun: 14, az: 245, turbidity: 4, rayleigh: 2.2, mie: 0.004, exposure: 0.88, fog: 0xf0a877, fogDensity: 0.0009, sunColor: 0xffb274, sunI: 3.0, hemiSky: 0x9cb8f0, hemiGround: 0x8a6a55, hemiI: 0.8 },
    ground: ['grass_green', 'rock_grey', 'sand', 'gravel'],
    scatter: { rocks: 0.6, cactus: 0, shrubs: 0.7, deadTrees: 0.05, pines: 0.25, grass: 0.8, palms: 0.3 },
  },
  mountain: {
    name: 'Iron Peaks',
    road: { kmax: 1 / 125, straight: 0.1, sigma: 1.0, slopeMax: 0.085, elevBase: 120, elevAmp: 60, elevScale: 900, bank: 80 },
    terrain: { kind: 'mountain', flat: 10, amp: 9, mass: 180, far: 260, snowLine: 210 },
    sky: { sun: 22, az: 190, turbidity: 3, rayleigh: 2.6, mie: 0.004, exposure: 0.9, fog: 0xb6c2d4, fogDensity: 0.0012, sunColor: 0xfff0d0, sunI: 3.3, hemiSky: 0xa6c4ff, hemiGround: 0x5a6a5a, hemiI: 0.9 },
    ground: ['forest_floor', 'rock_grey', 'snow', 'gravel'],
    scatter: { rocks: 0.7, cactus: 0, shrubs: 0.4, deadTrees: 0.2, pines: 1.2, grass: 0.3 },
  },
  city: {
    name: 'Ashen City',
    road: { kmax: 1 / 260, straight: 0.4, sigma: 0.6, slopeMax: 0.03, elevBase: 30, elevAmp: 6, elevScale: 500, bank: 40 },
    terrain: { kind: 'plain', flat: 40, amp: 2, far: 25 },
    sky: { sun: 6, az: 260, turbidity: 9, rayleigh: 1.2, mie: 0.012, exposure: 0.85, fog: 0x9a7f76, fogDensity: 0.0016, sunColor: 0xff8a52, sunI: 2.6, hemiSky: 0x8c9cc8, hemiGround: 0x5a4a44, hemiI: 0.8 },
    ground: ['concrete', 'concrete_cracked', 'dirt_red', 'gravel'],
    scatter: { rocks: 0.15, cactus: 0, shrubs: 0.3, deadTrees: 0.3, pines: 0, grass: 0.1, ruins: 1.0 },
  },
  dam: {
    name: 'The Dam',
    road: { kmax: 1 / 520, straight: 0.6, sigma: 0.35, slopeMax: 0.015, elevBase: 40, elevAmp: 2, elevScale: 900, bank: 25 },
    terrain: { kind: 'lake', flat: 14, amp: 5, cliff: 60, seaSide: -1, far: 120 },
    sky: { sun: 9, az: 140, turbidity: 5, rayleigh: 2.4, mie: 0.006, exposure: 0.88, fog: 0xd7a48a, fogDensity: 0.0008, sunColor: 0xffa060, sunI: 3.2, hemiSky: 0x9fb6ee, hemiGround: 0x6a5a55, hemiI: 0.85 },
    ground: ['concrete', 'rock_grey', 'gravel', 'dry_grass'],
    scatter: { rocks: 0.5, cactus: 0, shrubs: 0.3, deadTrees: 0.2, pines: 0.2, grass: 0.2 },
  },
};

export const biomeIndex = (id) => BIOME_ORDER.indexOf(id);

/** {a, b, w, index}: biome ids a->b and blend weight w of b at distance s (transitions straddle each boundary). */
export function biomeAt(s) {
  let i = BIOME_PLAN.length - 1;
  for (let k = 0; k < BIOME_PLAN.length; k++) if (s < BIOME_START[k] + BIOME_PLAN[k].len) { i = k; break; }
  const start = BIOME_START[i];
  if (i > 0 && s < start + TRANSITION / 2) {
    const t = 0.5 + (s - start) / TRANSITION;
    return { a: BIOME_ORDER[i - 1], b: BIOME_ORDER[i], w: t * t * (3 - 2 * t), index: i };
  }
  if (i < BIOME_PLAN.length - 1 && s > start + BIOME_PLAN[i].len - TRANSITION / 2) {
    const t = (s - (start + BIOME_PLAN[i].len - TRANSITION / 2)) / TRANSITION;
    return { a: BIOME_ORDER[i], b: BIOME_ORDER[i + 1], w: t * t * (3 - 2 * t), index: i };
  }
  return { a: BIOME_ORDER[i], b: BIOME_ORDER[i], w: 0, index: i };
}

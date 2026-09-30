// Natural-prop scatter tables. Densities are "candidates per 1000 m2 at biome scatter multiplier 1.0"; the effective density in a
// biome is  dens * BIOMES[biome].scatter[key] * w[biome]  (blended across biome transitions). Everything is data: modules read it.
import { smoothstep } from '../../core/util.js';

export const BIOME_IDS = ['desert', 'canyon', 'coast', 'mountain', 'city', 'dam'];
const W = (desert, canyon, coast, mountain, city, dam) => ({ desert, canyon, coast, mountain, city, dam });

export const TINTS = {
  rock: { desert: [1.10, 0.92, 0.76], canyon: [1.10, 0.86, 0.70], coast: [0.96, 0.98, 1.02], mountain: [0.94, 0.97, 1.02], city: [0.90, 0.88, 0.87], dam: [0.98, 0.97, 0.96] },
};

// desert / canyon use the red rock set only, the other biomes the grey one: fewer distinct models in view = fewer draw calls
const rockGrey = W(0, 0, 1, 1, 1, 1.2), rockRed = W(1, 1, 0, 0, 0.15, 0), NONE = W(0, 0, 0, 0, 0, 0);
const ROCK = { role: 'rock', anchor: true };

function rockPair(id, o, redW = rockRed) {
  return [
    { id, key: 'rocks', w: rockGrey, cat: 'rock', tint: 'rock', ...ROCK, ...o },
    { id: id + '_red', fallback: id, key: 'rocks', w: redW, cat: 'rock', ...ROCK, ...o, dens: o.dens * 0.9 },
  ];
}

/** name -> asset ids; entries: {id, fallback?, key, dens, w, a:[min,max] metres beyond the road strip edge, sc:[min,max], slope (max 1-ny), sink (fraction of height),
 *  align (0..1 surface-normal blend), far (cull m), shadow, behind, sway (m), lite, cluster:{k (1/m), thr, soft, out}, lods?, ok?(env),
 *  role ('rock': outcrop groups on crests | 'veg': groves, washes, anchor feet; see ecology.js), group [nMin, nMax, radius m] (pieces per
 *  placement, dens counts pieces), anchor (others gather at its feet), open (vegetation factor on bare ground) } */
const RAW = [
  // ------------------------------------------------------------------------------------------------ rocks
  ...rockPair('rock_01', { dens: 4.2, a: [2.5, 75], sc: [1.7, 3.8], slope: 0.42, sink: 0.2, align: 0.5, far: 130, lite: true, group: [2, 5, 4] }),
  ...rockPair('rock_02', { dens: 3.0, a: [2.5, 80], sc: [1.4, 3.2], slope: 0.42, sink: 0.2, align: 0.5, far: 140, lite: true, group: [2, 4, 4] }, NONE),
  ...rockPair('rock_03', { autoLod: 'small', dens: 2.0, a: [3, 180], sc: [1.1, 2.6], slope: 0.4, sink: 0.2, align: 0.55, far: 280, shadow: true, group: [1, 3, 6] }),
  { id: 'rock_04', autoLod: 'small', key: 'rocks', w: W(0, 0, 1, 1, 1, 1), cat: 'rock', tint: 'rock', ...ROCK, dens: 1.4, a: [3, 200], sc: [1.1, 2.4], slope: 0.4, sink: 0.22, align: 0.55, far: 300, shadow: true, group: [1, 3, 6] },
  ...rockPair('rock_05', { autoLod: 'big', dens: 0.6, a: [6, 380], sc: [0.9, 2.1], slope: 0.36, sink: 0.25, align: 0.6, far: 650, shadow: true, behind: true, group: [1, 3, 9] }),
  { id: 'rock_06', autoLod: 'big', key: 'rocks', w: W(0, 0, 1, 1, 1, 1), cat: 'rock', tint: 'rock', ...ROCK, dens: 0.35, a: [6, 400], sc: [0.9, 2.0], slope: 0.36, sink: 0.25, align: 0.6, far: 700, shadow: true, behind: true, group: [1, 2, 9] },
  ...[['boulder_01', W(0.7, 1.2, 0, 0, 0.2, 0)], ['boulder_02', W(0.7, 1.2, 0, 0, 0.2, 0)], ['boulder_03', W(0, 1.2, 0, 0, 0, 0)]].map(([id, w]) => ({ id, autoLod: 'huge', key: 'rocks', w, cat: 'rock', ...ROCK, dens: 0.28, a: [5, 420], sc: [0.9, 2.4], slope: 0.32, sink: 0.3, align: 0.6, far: 900, shadow: true, behind: true, group: [1, 3, 12] })),
  ...['canyon_pillar_a', 'canyon_pillar_b'].map((id) => ({ id, autoLod: 'pillar', key: 'rocks', w: W(0.25, 1, 0, 0, 0, 0), cat: 'pillar', dens: 0.010, a: [26, 520], sc: [0.9, 1.7], slope: 0.22, sink: 0.05, align: 0.1, far: 1900, shadow: true, behind: true, noFade: true, rad: 1 })),
  // ------------------------------------------------------------------------------------------------ cacti
  { id: 'cactus_saguaro', autoLod: 'cactus', key: 'cactus', w: W(1, 1, 0, 0, 0, 0), cat: 'cactus', role: 'veg', open: 0.04, anchor: true, group: [2, 6, 16], dens: 0.7, a: [5, 240], sc: [0.8, 1.4], slope: 0.2, sink: 0.03, align: 0.1, far: 520, shadow: true, behind: true },
  { id: 'cactus_barrel', key: 'cactus', w: W(1, 1, 0, 0, 0, 0), cat: 'cactus', role: 'veg', open: 0.03, group: [2, 4, 3], dens: 1.2, a: [3, 100], sc: [1.3, 2.4], slope: 0.3, sink: 0.05, align: 0.3, far: 200 },
  { id: 'cactus_prickly_pear', key: 'cactus', w: W(1, 1, 0, 0, 0, 0), cat: 'cactus', role: 'veg', open: 0.03, group: [2, 4, 4], dens: 1.3, a: [3, 120], sc: [1.4, 2.6], slope: 0.3, sink: 0.04, align: 0.3, far: 230 },
  // ------------------------------------------------------------------------------------------------ shrubs / grass
  { id: 'shrub_desert_scrub', key: 'shrubs', w: W(1, 0.8, 0.1, 0, 0.6, 0.5), cat: 'shrub', role: 'veg', open: 0.03, dens: 2.8, a: [3, 110], sc: [0.8, 1.7], slope: 0.55, sink: 0.05, align: 0.3, far: 200, sway: 0.08, lite: true },
  { id: 'shrub_dry_bush', key: 'shrubs', w: W(1, 1, 0.3, 0.2, 0.8, 0.8), cat: 'shrub', role: 'veg', open: 0.03, dens: 2.2, a: [3, 100], sc: [1.0, 2.0], slope: 0.55, sink: 0.05, align: 0.3, far: 170, sway: 0.08, lite: true },
  { id: 'shrub_green_bush', key: 'shrubs', w: W(0, 0, 1, 0.8, 0.3, 0.4), cat: 'shrub', role: 'veg', open: 0.03, dens: 3.0, a: [3, 120], sc: [0.9, 1.9], slope: 0.55, sink: 0.05, align: 0.3, far: 240, sway: 0.08, lite: true },
  { id: 'fern', key: 'shrubs', w: W(0, 0, 0.6, 1, 0, 0.2), cat: 'shrub', role: 'veg', open: 0.03, dens: 5.0, a: [3, 110], sc: [1.2, 2.6], slope: 0.6, sink: 0.05, align: 0.4, far: 190, sway: 0.06, lite: true },
  { id: 'grass_tuft', key: 'grass', w: W(1, 1, 0.3, 0.4, 0.9, 1), cat: 'grass', role: 'veg', open: 0.03, dens: 16, a: [2.5, 80], sc: [1.5, 2.9], slope: 0.6, sink: 0.0, align: 0.5, far: 150, sway: 0.12, lite: true },
  { id: 'grass_tuft_green', key: 'grass', w: W(0, 0, 1, 0.9, 0.15, 0.3), cat: 'grass', role: 'veg', open: 0.03, dens: 15, a: [2.5, 90], sc: [1.5, 2.9], slope: 0.6, sink: 0.0, align: 0.5, far: 160, sway: 0.12, lite: true },
  // ------------------------------------------------------------------------------------------------ trees
  ...['dead_tree_a', 'dead_tree_b', 'dead_tree_c'].map((id) => ({ id, key: 'deadTrees', w: W(1, 1, 0.8, 1, 1, 1), cat: 'tree', role: 'veg', open: 0.25, anchor: true, dens: 0.12, a: [8, 300], sc: [0.8, 1.35], slope: 0.45, sink: 0.02, align: 0.1, far: 520, shadow: true, behind: true })),
  ...[['pine_a', 14.6], ['pine_b', 16.8], ['pine_c', 10.0]].map(([id]) => ({
    id, key: 'pines', w: W(0, 0, 1, 1, 0, 1), cat: 'pine', dens: 5.5, a: [8, 330], sc: [0.8, 1.5], slope: 0.5, sink: 0.02, align: 0.05, far: 2100, shadow: true, behind: true, sway: 0.3, noFade: true,
    lods: [{ asset: id, max: 58 }, { asset: id + '_lod', max: 170 }, { asset: id + '_billboard', max: 1e9 }],
    cluster: { k: 1 / 150, thr: 0.5, soft: 0.1, out: 0.12 },
    ok: (env) => env.rand < 1 - smoothstep(150, 200, env.y),
  })),
  { id: 'palm_coast', key: 'palms', w: W(0, 0, 1, 0, 0, 0), cat: 'palm', role: 'veg', open: 0.04, anchor: true, group: [2, 4, 7], dens: 1.0, a: [5, 200], sc: [0.85, 1.35], slope: 0.3, sink: 0.02, align: 0.05, far: 600, shadow: true, behind: true, sway: 0.55 },
  // ------------------------------------------------------------------------------------------------ ruined-city clutter
  { id: 'debris_pile', key: 'ruins', w: W(0, 0, 0, 0, 1, 0), cat: 'clutter', dens: 0.5, a: [5, 110], sc: [0.9, 1.8], slope: 0.4, sink: 0.05, align: 0.4, far: 280, shadow: true },
  { id: 'tire_stack', key: 'ruins', w: W(0, 0, 0, 0, 1, 0), cat: 'clutter', dens: 0.2, a: [4, 90], sc: [1.0, 1.4], slope: 0.3, sink: 0.02, align: 0.2, far: 200 },
  { id: 'crate_stack', key: 'ruins', w: W(0, 0, 0, 0, 1, 0), cat: 'clutter', dens: 0.25, a: [4, 100], sc: [1.0, 1.6], slope: 0.3, sink: 0.02, align: 0.2, far: 220 },
  { id: 'barrel', key: 'ruins', w: W(0, 0, 0, 0, 1, 0), cat: 'clutter', dens: 0.4, a: [4, 100], sc: [1.0, 1.3], slope: 0.3, sink: 0.02, align: 0.2, far: 200 },
  { id: 'shipping_container', key: 'ruins', w: W(0, 0, 0, 0, 1, 0), cat: 'clutter', dens: 0.10, a: [12, 130], sc: [1.0, 1.0], slope: 0.15, sink: 0.05, align: 0.05, far: 500, shadow: true, behind: true },
  { id: 'shipping_container_stack3', key: 'ruins', w: W(0, 0, 0, 0, 1, 0), cat: 'clutter', dens: 0.05, a: [14, 130], sc: [1.0, 1.0], slope: 0.15, sink: 0.05, align: 0.05, far: 520, shadow: true, behind: true },
];

/** Which generation tier an entry belongs to (by its cull distance). */
export const tierOf = (e) => (e.far <= 320 ? 3 : e.far <= 950 ? 2 : 1);

/** Auto-LOD via vertex clustering: [distance of full model, distance of LOD1, cell divisions LOD1, LOD2]. */
export const ROCK_LOD = { small: [55, 130, 8, 4], big: [95, 250, 9, 4.5], huge: [140, 380, 10, 5], pillar: [260, 650, 10, 5], cactus: [80, 220, 10, 6] };
export function withAutoLod(e) {
  if (e.lods || !e.autoLod) return e;
  const [d1, d2, c1, c2] = ROCK_LOD[e.autoLod];
  return { ...e, lods: [{ asset: e.id, max: d1 }, { asset: e.id + '@1', max: d2 }, { asset: e.id + '@2', max: 1e9 }], lodCells: [c1, c2] };
}
export function pineSpecs() { return SCATTER.filter((e) => e.cat === 'pine'); }

/** Pool spec derived from a scatter entry. */
export function specOfEntry(e, id = e.id) {
  const lods = e.lods ? e.lods.map((l) => ({ asset: l.asset.replace(e.id, id), max: l.max })) : null;
  return { far: e.far, shadow: !!e.shadow, behind: !!e.behind, sway: e.sway || 0, lite: !!e.lite, fade: !e.noFade, lods };
}

export const SCATTER = RAW.map(withAutoLod);

// Four authored campaign worlds plus a city landmark supplement. Each chunk
// merges opaque/glowing art, instances tiny repeated details, and owns one
// exact collision request. Geometry work happens during chunk jobs only.
import { CAMPAIGN_THEMES, CITY_CAMPAIGN_DRESSING } from '../../data/campaign_themes.js';
import { CHUNK_LEN } from './util.js';
import { hash2 } from '../../core/util.js';
import { CampaignThemeBuilder, campaignBiomeAt, registerCampaignThemeAssets } from './campaign_theme_builder.js';
import { buildUnderground } from './campaign_underground.js';
import { buildSky } from './campaign_sky.js';
import { buildSpaceLandmarks } from './campaign_space_landmarks.js';

export { registerCampaignThemeAssets };

function roadsideBoundary(b, color, glowColor) {
  // Hard boundaries are outside both asphalt+shoulders and every branch.
  // Four-metre sections keep the physical footprint honest on bends.
  for (let s = Math.ceil(b.s0 / 4) * 4; s < b.s1; s += 4) {
    const end = Math.min(b.s1, s + 4);
    if (b.themeAt(s) !== b.id || b.themeAt(end - .001) !== b.id) continue;
    for (const side of [-1, 1]) {
      const d = side * 12.8;
      if (!b.reserve((s + end) / 2, d, 2.3)) continue;
      b.tube(b.at(s, d, 1.1), b.at(end, d, 1.1), .12, color, { solid: true });
      b.tube(b.at(s, d, .45), b.at(end, d, .45), .1, color, { solid: true });
      if (s % 16 === 0) b.column(s, d, 0, 1.3, .14, .14, color, { solid: true, sides: 4 });
      if (s % 8 === 0) b.box(s + 1, side * 13.25, 1.16, .08, .1, 1.6, glowColor, { glow: true });
    }
  }
}

function buildHell(b) {
  const P = b.palette;
  // Liquids follow route elevation rather than its banked road plane. A banked
  // lava sheet would dive below one riverbed and climb its opposite bank.
  const lavaAt = (s, d, height = -24) => { const p = b.at(s, d); p.y = b.at(s, 0).y + height; return p; };
  roadsideBoundary(b, P.metal, P.hot);
  // Terraced basalt organ pipes, not sandstone props. Near columns are solid;
  // the massive caldera skyline is safely beyond any playable corridor.
  for (let s = Math.ceil(b.s0 / 48) * 48; s < b.s1; s += 48) {
    if (b.themeAt(s) !== b.id) continue;
    for (const side of [-1, 1]) {
      const h = 12 + hash2(Math.round(s), side + 14, b.ctx.seed) * 28;
      const d = side * (43 + hash2(Math.round(s), side + 88, b.ctx.seed) * 9);
      if (!b.reserve(s, d, 13)) continue;
      for (let i = -2; i <= 2; i++) {
        const offset = i * 4.4, atS = s + (i % 2) * 3;
        const ground = b.ground(atS, d + offset), roadY = b.at(atS, d + offset).y;
        const dy = ground.y - roadY - 1;
        b.column(atS, d + offset, dy, h * (1 - Math.abs(i) * .12), 3.1, 2.7, i % 2 ? P.mid : P.dark, { solid: true, sides: 6 });
        b.tube(b.at(atS, d + offset + .4, dy + h * .15), b.at(atS, d + offset + .4, dy + h * .85), .1, P.accent, { glow: true });
      }
    }
  }
  // Long molten channels sit below the road, with banks in the terrain profile.
  // They are labelled visual-only until the authoritative hazard owner wires
  // a matching trigger. Their renderer never silently inflicts damage.
  for (let s = b.s0; s < b.s1 - .01; s += 8) {
    const end = Math.min(b.s1, s + 8);
    if (b.themeAt(s) !== b.id || b.themeAt(end - .001) !== b.id) continue;
    for (const side of [-1, 1]) {
      const near = side * 30, far = side * 110;
      b.quad([lavaAt(s, near), lavaAt(end, near), lavaAt(end, far), lavaAt(s, far)], P.accent, { x: 0, y: 1, z: 0 }, { glow: true });
      if (Math.floor(s / 8) % 3 === 0) b.quad([lavaAt(s, side * 53, -23.95), lavaAt(end, side * 54, -23.95), lavaAt(end, side * 56, -23.95), lavaAt(s, side * 55, -23.95)], P.hot, { x: 0, y: 1, z: 0 }, { glow: true });
    }
  }
  for (let s = Math.ceil(b.s0 / 384) * 384; s < b.s1; s += 384) {
    if (b.themeAt(s) !== b.id) continue;
    const side = hash2(Math.round(s), 918, b.ctx.seed) < .5 ? -1 : 1;
    const d = side * 330;
    if (!b.reserve(s, d, 120)) continue;
    const frame = b.frame(s, d, -45);
    b.body.col(...P.dark).cyl(frame, 0, 0, 0, 185, 115, 43, 16, false);
    b.body.col(...P.mid).cyl(frame, 0, 0, 165, 200, 46, 57, 16, false);
    b.glow.col(...P.hot).cyl(frame, 0, 0, 190, 194, 37, 37, 16, true);
    // Eruption pillars remain far decorative scenery; no per-frame particles.
    b.glow.col(...P.accent).cyl(frame, 0, 0, 195, 265, 8, 2, 8, false);
  }
  // Forged gate silhouettes have a deliberately open road-sized aperture.
  for (let s = Math.ceil((b.s0 - 240) / 480) * 480 + 240; s < b.s1; s += 480) {
    if (s < b.s0 || !b.spanFree(s - 8, s + 8)) continue;
    for (const side of [-1, 1]) {
      const d = side * 26;
      const ground = b.ground(s, d), dy = ground.y - b.at(s, d).y - 1;
      b.column(s, d, dy, Math.max(36, 36 - dy), 4.5, 3.1, P.dark, { solid: true, sides: 6 });
    }
    b.box(s, 0, 33, 58, 5, 7, P.metal, { solid: true, overhead: true });
    b.box(s, 0, 29.8, 42, .3, 1.5, P.hot, { glow: true, overhead: true });
  }
}

function buildSpace(b) {
  const P = b.palette;
  roadsideBoundary(b, P.mid, P.accent);
  for (let s = Math.ceil(b.s0 / 8) * 8; s < b.s1; s += 8) {
    const end = Math.min(b.s1, s + 8);
    if (b.themeAt(s) !== b.id || b.themeAt(end - .001) !== b.id) continue;
    // Underside service lattices make the real collision strip read as a
    // constructed orbital deck. These surfaces are never a substitute floor.
    for (const side of [-1, 1]) {
      const d = side * 13.9;
      if (!b.reserve(s + (end - s) / 2, d, 3.4)) continue;
      b.quad([b.at(s, d, -.3), b.at(end, d, -.3), b.at(end, d, -7), b.at(s, d, -7)], P.dark, { x: side, y: 0, z: 0 });
      b.tube(b.at(s, d, -.6), b.at(end, d, -6), .19, P.mid);
      b.tube(b.at(s, d, -6), b.at(end, d, -.6), .19, P.mid);
    }
  }
  buildSpaceLandmarks(b);
  for (let s = Math.ceil((b.s0 - 192) / 768) * 768 + 192; s < b.s1; s += 768) {
    if (s < b.s0 || !b.spanFree(s - 9, s + 9)) continue;
    for (const side of [-1, 1]) {
      b.column(s, side * 26, -8, 46, 4, 2.5, P.mid, { solid: true, sides: 8 });
      b.box(s, side * 26, 30, 9, 10, 13, P.light, { solid: true });
    }
    b.box(s, 0, 34, 60, 6, 9, P.mid, { solid: true, overhead: true });
    b.box(s, 0, 30.7, 44, .12, 4, P.accent, { glow: true, overhead: true });
  }
}

function buildCityInterchange(b) {
  const P = b.palette;
  // The main road stays at its actual terrain/collision surface. The raised
  // interchange is a landmark, never an advertised unconnected shortcut.
  for (let s = Math.ceil((b.s0 - 240) / 960) * 960 + 240; s < b.s1; s += 960) {
    if (s < b.s0 || !b.spanFree(s - 32, s + 32)) continue;
    const bottom = Math.max(b.at(s - 32, 0).y, b.at(s, 0).y, b.at(s + 32, 0).y) - b.at(s, 0).y + 29;
    b.box(s, 0, bottom + 2, 150, 4, 19, P.mid, { solid: true, overhead: true });
    b.box(s, 0, bottom + 19, 25, 3, 126, P.dark, { solid: true, overhead: true });
    for (const side of [-1, 1]) {
      const d = side * 50, ground = b.ground(s, d), dy = ground.y - b.at(s, d).y - 2;
      b.column(s, d, dy, bottom + 2 - dy, 3.8, 3, P.light, { solid: true, sides: 6 });
      b.column(s + 28, side * 30, dy, bottom + 17 - dy, 3, 2.6, P.mid, { solid: true, sides: 6 });
    }
    // Parapets/underside girders explicitly above the full lane clearance.
    for (const d of [-69, 69]) b.box(s, d, bottom + 4.6, 1.2, 2.2, 21, P.light, { overhead: true });
    b.box(s, 0, bottom + 4.2, 142, .08, .35, P.accent, { glow: true, overhead: true });
  }
  for (let s = Math.ceil((b.s0 - 120) / 384) * 384 + 120; s < b.s1; s += 384) {
    if (s < b.s0 || b.themeAt(s) !== b.id) continue;
    for (const side of [-1, 1]) {
      const d = side * (130 + hash2(s | 0, side + 413, b.ctx.seed) * 30);
      if (!b.reserve(s, d, 48)) continue;
      const ground = b.ground(s, d), dy = ground.y - b.at(s, d).y;
      const height = 150 + hash2(s | 0, side + 714, b.ctx.seed) * 75;
      b.box(s, d, dy + 7, 58, 14, 56, P.mid);
      b.box(s, d, dy + height / 2, 39, height, 37, P.dark);
      b.box(s, d, dy + height - 19, 28, 50, 25, P.mid);
      b.box(s, d, dy + height + 17, 17, 24, 17, P.light);
      b.column(s, d, dy + height + 29, 27, .9, .25, P.gold, { sides: 6 });
      for (let y = dy + 18; y < dy + height - 10; y += 15) b.box(s, d, y, 39.2, .75, 37.2, P.light);
      for (const x of [-18.7, 18.7]) b.box(s, d + x, dy + height / 2, .45, height * .87, 37.4, P.accent, { glow: true });
    }
  }
}

const BUILDERS = { underground: buildUnderground, sky: buildSky, hell: buildHell, space: buildSpace, city: buildCityInterchange };

/** Existing ChunkDress API: ground.done, done Set, list/addExtra, hooks/dirty. */
export function buildCampaignThemes(ctx, chunk) {
  const ids = new Set([campaignBiomeAt(ctx.road, chunk.s0), campaignBiomeAt(ctx.road, chunk.s0 + CHUNK_LEN / 2), campaignBiomeAt(ctx.road, chunk.s0 + CHUNK_LEN - .001)]);
  if (![...ids].some(id => BUILDERS[id])) return true;
  if (!chunk.ground?.done) return false;
  for (const id of ids) {
    const fn = BUILDERS[id], tag = `campaign-theme:${id}`;
    if (!fn || chunk.done.has(tag)) continue;
    const builder = new CampaignThemeBuilder(ctx, chunk, CAMPAIGN_THEMES[id] || CITY_CAMPAIGN_DRESSING, id);
    fn(builder); builder.finish(); chunk.done.add(tag);
  }
  return true;
}

export const buildCampaignTheme = buildCampaignThemes;

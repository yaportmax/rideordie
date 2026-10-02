// World queries belong to the road that owns the run. Legacy test stubs can
// omit biomeAt; they retain the original distance-only world explicitly.
import { biomeAt, BIOME_PLAN, BIOME_START } from '../data/biomes.js';
import { TEN_LEVELS, MARATHON_LEVEL_STARTS, MARATHON_LEVEL_LENGTH } from '../data/campaign.js';

export function roadBiomeAt(road, s) {
  return typeof road?.biomeAt === 'function' ? road.biomeAt(s) : biomeAt(s);
}
export function contextualRoad(road) {
  return typeof road?.biomeAt === 'function' && road.journey?.mode !== 'legacy';
}
export function biomeWeight(road, s, id) {
  const b = roadBiomeAt(road, s);
  return (b.a === id ? 1 - b.w : 0) + (b.b === id ? b.w : 0);
}
/** Nominal level span, independent of mutable progress or another live road. */
export function biomeRange(road, id) {
  if (!contextualRoad(road)) {
    const i = BIOME_PLAN.findIndex(b => b.id === id);
    return i < 0 ? null : { start: BIOME_START[i], end: i === BIOME_PLAN.length - 1 ? Infinity : BIOME_START[i] + BIOME_PLAN[i].len };
  }
  const i = TEN_LEVELS.findIndex(b => b.id === id);
  if (i < 0) return null;
  if (road.journey?.mode === 'marathon') return { start: MARATHON_LEVEL_STARTS[i], end: MARATHON_LEVEL_STARTS[i] + MARATHON_LEVEL_LENGTH };
  const held = roadBiomeAt(road, 0);
  return held.a === id && held.b === id ? { start: 0, end: Infinity } : null;
}
/** Rebase a hand-authored legacy set piece into its chapter's approach. */
export function biomeDistance(road, id, legacyS) {
  if (!contextualRoad(road)) return legacyS;
  const span = biomeRange(road, id), i = BIOME_PLAN.findIndex(b => b.id === id);
  if (!span || i < 0) return null;
  const level = TEN_LEVELS.find(b => b.id === id);
  const length = road.journey?.mode === 'marathon' ? MARATHON_LEVEL_LENGTH : level.bossDistance;
  const legacyLength = id === 'dam' ? 10000 : BIOME_PLAN[i].len;
  return span.start + (legacyS - BIOME_START[i]) * length / legacyLength;
}

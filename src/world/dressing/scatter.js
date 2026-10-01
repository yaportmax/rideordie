// Natural prop scatter (rocks, cacti, shrubs, grass, trees...) for one chunk and one generation tier.
// Deterministic: every entry uses its own RNG stream seeded from (seed, chunk, entry id); quality only THINS candidates (never re-rolls them).
// Composition (dressing/ecology.js): rocks and cacti come in GROUPS (one big piece + smaller ones around it) on crests and in outcrop
// patches; shrubs / grass / small cacti grow in groves, along washes and at the feet of those anchors; open ground between vignettes stays
// bare (negative space) instead of an even sprinkle.
import { BIOMES, biomeAt } from '../../data/biomes.js';
import { fbm2, smoothstep } from '../../core/util.js';
import { SCATTER, TINTS, tierOf, specOfEntry } from './types.js';
import { rngOf, strId, CHUNK_LEN, EDGE } from './util.js';
import { buildCover } from './groundcover.js';
import { buildFences, buildWrecks } from './furniture.js';
import { vegFactor, rockFactor, addAnchor, VEG_MAX } from './ecology.js';
import { isSolidRock, RockCollisionBatch } from './rock_collisions.js';

const QKEEP = [0.26, 0.5, 0.74, 1.0];
const scat = (id, key) => (key ? (BIOMES[id].scatter[key] ?? 0) : 1);
function entryDens(e, bio) {
  const wa = (e.w[bio.a] ?? 0) * scat(bio.a, e.key), wb = (e.w[bio.b] ?? 0) * scat(bio.b, e.key);
  return wa * (1 - bio.w) + wb * bio.w;
}

/** Resolve which asset an entry uses right now: {id, fromFallback} | 'wait' (still loading) | null (missing). */
function resolve(ctx, e) {
  const kit = ctx.kit;
  const need = [e.id]; if (e.fallback) need.push(e.fallback); if (e.lods) for (const l of e.lods) need.push(l.asset);
  for (const n of need) if (kit.state(n) === 'idle') kit.request(n);
  const st = kit.state(e.id);
  if (st === 'loading') return 'wait';
  if (st === 'missing') {
    if (!e.fallback) return null;
    const sf = kit.state(e.fallback);
    if (sf === 'loading') return 'wait';
    return sf === 'missing' ? null : { id: e.fallback, fromFallback: true };
  }
  if (e.lods && !e.lodCells) for (const l of e.lods) if (kit.state(l.asset) === 'loading') return 'wait';
  return { id: e.id, fromFallback: false };
}

const _g = {}, _rs = {}, _fr = {};

/** Shared placement checks (slope, cliff drop, water, custom rule, landmark exclusions, tunnels). */
function placeable(ctx, chunk, e, s, d, a, side, g, rr, excl, tun, uAux) {
  const slope = 1 - g.ny;
  if (slope > e.slope) return false;
  const roadY = ctx.road.sample(s, _rs).y;
  if (roadY - g.y > (e.below ?? 9)) return false;                   // cliff / sea side drop
  if (g.y < chunk.seaY + (e.seaMargin ?? 0.8)) return false;        // under water
  if (e.ok && !e.ok({ y: g.y, roadY, seaY: chunk.seaY, slope, a, side, rand: uAux })) return false;
  for (let k = 0; k < excl.length; k++) { const z = excl[k]; const dx = g.x - z[0], dz = g.z - z[1], rz = z[2] + rr * 0.6; if (dx * dx + dz * dz < rz * rz) return false; }
  for (let k = 0; k < tun.length; k++) { const t = tun[k]; if (s > t.s0 - 30 && s < t.s1 + 30 && Math.abs(d) < 80) return false; }
  return true;
}

/** @returns {boolean} false when some asset is still loading or the time slice ran out (chunk._more = true); call again later for the same tier. */
export function runScatter(ctx, chunk, tier, deadline = Infinity) {
  const { road, seed, kit, pool } = ctx;
  const s0 = chunk.s0;
  const bios = [biomeAt(s0), biomeAt(s0 + 48), biomeAt(s0 + CHUNK_LEN)];
  const q = ctx.quality, qkeep = QKEEP[Math.max(0, Math.min(3, q))];
  const excl = ctx.exclusions(s0 - 40, s0 + CHUNK_LEN + 40);
  if (!excl) return false;
  const tun = ctx.tunnelsNear(s0 - 60, s0 + CHUNK_LEN + 60);
  // fences need the landmark plan (exclusions): built with the far tier so they never hold up road features
  if (tier === 1 && !chunk.done.has('f:fences')) {
    if (!buildFences(ctx, chunk)) return false;
    chunk.done.add('f:fences'); chunk.dirty = true;
  }
  if (tier === 1 && !chunk.done.has('f:wrecks')) {
    if (!buildWrecks(ctx, chunk)) return false;
    chunk.done.add('f:wrecks'); chunk.dirty = true;
  }
  let ready = true, worked = 0;
  const collisions = new RockCollisionBatch();
  for (const e of SCATTER) {
    if (tierOf(e) !== tier || chunk.done.has(e.id)) continue;
    if (worked > 0 && performance.now() > deadline) { collisions.flush(ctx, chunk, tier); chunk._more = true; return false; }
    let wmax = 0; for (const b of bios) wmax = Math.max(wmax, entryDens(e, b));
    if (wmax <= 0) { chunk.done.add(e.id); continue; }
    const res = resolve(ctx, e);
    if (res === 'wait') { ready = false; continue; }
    chunk.done.add(e.id); worked++;
    if (!res) continue;
    const asset = kit.get(res.id); if (!asset) continue;
    pool.register(res.id, specOfEntry(e, res.id));
    const list = chunk.list(res.id);
    const rnd = rngOf(seed, chunk.c, strId(e.id));
    const area = CHUNK_LEN * (e.a[1] - e.a[0]) * 2;
    const G = e.group, gAvg = G ? (G[0] + G[1]) / 2 : 1;
    const vegMul = e.role === 'veg' ? VEG_MAX : 1;
    const n = Math.ceil(e.dens * wmax * area / 1000 / gAvg * vegMul);
    const tintKind = e.tint || (res.fromFallback ? 'rock' : null);
    const h0 = asset.height, rad0 = asset.sphere.radius;
    const noiseSeed = seed + (strId(e.id) & 0xffff);
    const put = (g, sc, uYaw, uTint, bio) => {
      const rr = rad0 * sc;
      const sx = sc * (0.92 + 0.16 * uTint), sy = sc, sz = sc * (0.92 + 0.16 * (1 - uTint));
      const br = 0.84 + 0.3 * uTint;
      let cr = br, cg = br, cb = br;
      if (tintKind) { const t = (TINTS[tintKind] || {})[bio.w > 0.5 ? bio.b : bio.a]; if (t) { cr *= t[0]; cg *= t[1]; cb *= t[2]; } }
      const index = list.push(g.x, g.y - e.sink * h0 * sc, g.z, uYaw * 6.2832, sx, sy, sz, g.nx, g.ny, g.nz, e.align, rr, cr, cg, cb);
      collisions.add(e, asset, sc, list.m, index * 16);
      if (e.anchor) addAnchor(chunk, g.x, g.z, rr);
    };
    for (let i = 0; i < n; i++) {
      // fixed number of draws per candidate -> streams never depend on accept/reject
      const uSide = rnd(), uA = rnd(), uS = rnd(), uAcc = rnd(), uYaw = rnd(), uScale = rnd(), uTint = rnd(), uKeep = rnd(), uAux = rnd();
      const scC = G ? e.sc[0] + (e.sc[1] - e.sc[0]) * (0.55 + 0.45 * uScale) : e.sc[0] + (e.sc[1] - e.sc[0]) * uScale;
      // Physical rocks must exist on both peers even when graphics quality
      // thins the surrounding small scatter.
      if (uKeep > qkeep && !isSolidRock(e, asset, scC)) continue;
      const side = uSide < 0.5 ? 1 : -1;
      const a = e.a[0] + (e.a[1] - e.a[0]) * uA;
      const s = s0 + uS * CHUNK_LEN;
      const bio = biomeAt(s);
      const dHere = entryDens(e, bio);
      if (uAcc * wmax > dHere) continue;
      const d = side * (EDGE + a);
      const g = chunk.ground.sample(s, d, _g);
      if (e.cluster) {
        const c = e.cluster, nz = fbm2(g.x * c.k, g.z * c.k, 3, noiseSeed);
        const p = c.out + (1 - c.out) * smoothstep(c.thr - c.soft, c.thr + c.soft, nz);
        if (uAux > p) continue;
      }
      // composition: vegetation follows groves / washes / anchors; rock and cactus groups follow their own outcrop field
      if (e.role === 'veg' && uAux * VEG_MAX > vegFactor(seed, chunk, s, d, g, e.open ?? 0.08)) continue;
      if (e.role === 'rock' && uAux * 1.3 > rockFactor(seed, chunk, s, d, g)) continue;
      if (!placeable(ctx, chunk, e, s, d, a, side, g, rad0 * scC, excl, tun, uAux)) continue;
      put(g, scC, uYaw, uTint, bio);
      if (!G) continue;
      // group members: smaller pieces around the centre piece (own RNG stream -> the main stream keeps fixed draws)
      const mr = rngOf(seed + i * 7919, chunk.c, strId(e.id) ^ 0x5bd1);
      const cnt = G[0] + Math.floor(mr() * (G[1] - G[0] + 1)) - 1;
      const fr = road.sample(s, _fr);
      for (let m = 0; m < cnt; m++) {
        const ang = mr() * 6.2832, dist = G[2] * (0.35 + 0.65 * Math.sqrt(mr())) * (0.6 + 0.4 * scC / e.sc[1]);
        const ox = Math.cos(ang) * dist, oz = Math.sin(ang) * dist;
        const sm = Math.min(s0 + CHUNK_LEN, Math.max(s0, s + ox * fr.fx + oz * fr.fz)), dm = d + ox * fr.nx + oz * fr.nz;
        const sc = Math.max(e.sc[0] * 0.5, scC * (0.35 + 0.4 * mr())), yaw = mr(), tint = mr();
        if (Math.abs(dm) < EDGE + e.a[0] || Math.sign(dm) !== side) continue;
        const gm = chunk.ground.sample(sm, dm, _g);
        if (!placeable(ctx, chunk, e, sm, dm, Math.abs(dm) - EDGE, side, gm, rad0 * sc, excl, tun, 0.5)) continue;
        put(gm, sc, yaw, tint, bio);
      }
    }
  }
  collisions.flush(ctx, chunk, tier);
  // dense near-road ground cover (grass, scrub, flowers, pebbles, litter) once the near tier's anchors exist
  if (tier === 3 && ready && !chunk.done.has('cover')) {
    const r = buildCover(ctx, chunk, deadline);
    if (r !== true) { if (r === false) chunk._more = true; return false; }   // false = out of time (resume now), null = waiting for the landmark plan
    chunk.done.add('cover');
  }
  chunk.dirty = true;
  return ready;
}

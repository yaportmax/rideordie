// Natural prop scatter (rocks, cacti, shrubs, grass, trees...) for one chunk and one generation tier.
// Deterministic: every entry uses its own RNG stream seeded from (seed, chunk, entry id); quality only THINS candidates (never re-rolls them).
import { BIOMES, biomeAt } from '../../data/biomes.js';
import { fbm2, smoothstep } from '../../core/util.js';
import { SCATTER, TINTS, tierOf, specOfEntry } from './types.js';
import { rngOf, strId, CHUNK_LEN, EDGE } from './util.js';

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

const _g = {}, _rs = {};

/** @returns {boolean} false when some asset is still loading (call again later for the same tier). */
export function runScatter(ctx, chunk, tier) {
  const { road, seed, kit, pool } = ctx;
  const s0 = chunk.s0;
  const bios = [biomeAt(s0), biomeAt(s0 + 48), biomeAt(s0 + CHUNK_LEN)];
  const q = ctx.quality, qkeep = QKEEP[Math.max(0, Math.min(3, q))];
  const excl = ctx.exclusions(s0 - 40, s0 + CHUNK_LEN + 40);
  if (!excl) return false;
  const tun = ctx.tunnelsNear(s0 - 60, s0 + CHUNK_LEN + 60);
  const seaY = chunk.seaY;
  let ready = true;
  for (const e of SCATTER) {
    if (tierOf(e) !== tier || chunk.done.has(e.id)) continue;
    let wmax = 0; for (const b of bios) wmax = Math.max(wmax, entryDens(e, b));
    if (wmax <= 0) { chunk.done.add(e.id); continue; }
    const res = resolve(ctx, e);
    if (res === 'wait') { ready = false; continue; }
    chunk.done.add(e.id);
    if (!res) continue;
    const asset = kit.get(res.id); if (!asset) continue;
    pool.register(res.id, specOfEntry(e, res.id));
    const list = chunk.list(res.id);
    const rnd = rngOf(seed, chunk.c, strId(e.id));
    const area = CHUNK_LEN * (e.a[1] - e.a[0]) * 2;
    const n = Math.ceil(e.dens * wmax * area / 1000);
    const tintKind = e.tint || (res.fromFallback ? 'rock' : null);
    const h0 = asset.height, rad0 = asset.sphere.radius;
    const noiseSeed = seed + (strId(e.id) & 0xffff);
    for (let i = 0; i < n; i++) {
      // fixed number of draws per candidate -> streams never depend on accept/reject
      const uSide = rnd(), uA = rnd(), uS = rnd(), uAcc = rnd(), uYaw = rnd(), uScale = rnd(), uTint = rnd(), uKeep = rnd(), uAux = rnd();
      if (uKeep > qkeep) continue;
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
      const slope = 1 - g.ny;
      if (slope > e.slope) continue;
      const rs = road.sample(s, _rs), roadY = rs.y;
      if (roadY - g.y > (e.below ?? 9)) continue;                 // cliff / sea side drop
      if (g.y < seaY + (e.seaMargin ?? 0.8)) continue;            // under water
      if (e.ok && !e.ok({ y: g.y, roadY, seaY, slope, a, side, rand: uAux })) continue;
      const sc = e.sc[0] + (e.sc[1] - e.sc[0]) * uScale;
      const rr = rad0 * sc;
      let bad = false;
      for (let k = 0; k < excl.length; k++) { const z = excl[k]; const dx = g.x - z[0], dz = g.z - z[1], rz = z[2] + rr * 0.6; if (dx * dx + dz * dz < rz * rz) { bad = true; break; } }
      if (bad) continue;
      for (let k = 0; k < tun.length; k++) { const t = tun[k]; if (s > t.s0 - 30 && s < t.s1 + 30 && Math.abs(d) < 80) { bad = true; break; } }
      if (bad) continue;
      const sx = sc * (0.92 + 0.16 * uTint), sy = sc, sz = sc * (0.92 + 0.16 * (1 - uTint));
      const br = 0.84 + 0.3 * uTint;
      let cr = br, cg = br, cb = br;
      if (tintKind) { const t = (TINTS[tintKind] || {})[bio.w > 0.5 ? bio.b : bio.a]; if (t) { cr *= t[0]; cg *= t[1]; cb *= t[2]; } }
      list.push(g.x, g.y - e.sink * h0 * sc, g.z, uYaw * 6.2832, sx, sy, sz, g.nx, g.ny, g.nz, e.align, rr, cr, cg, cb);
    }
  }
  chunk.dirty = true;
  return ready;
}

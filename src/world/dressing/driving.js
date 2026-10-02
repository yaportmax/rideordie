// Stage-specific lane choices use the same loaded models and exact transform for
// their visible surface and collision. No moving debris or per-frame geometry.
import * as THREE from 'three';
import { STAGE_DRIVING, BRANCH_DRIVING, stageObstacleSpan, branchSample, branchPointAt } from '../driving_plan.js';
import { roadFrame, groundAt, CHUNK_LEN } from './util.js';
import { need, useSpec } from './furniture.js';
import { rockCollisionMesh } from './rock_collisions.js';

const COLLISION = new WeakMap();
const SIGN_SPEC = { far: 420, shadow: true, behind: true };

/** Kit-owned, bounded sign resources retire with the same world as other assets. */
export function registerDrivingSigns(kit) {
  const postMat = new THREE.MeshStandardMaterial({ color: 0x717772, metalness: .65, roughness: .6 });
  postMat.name = 'driving_sign_post';
  for (const [biome, cfg] of Object.entries(STAGE_DRIVING)) {
    const post = new THREE.BoxGeometry(.1, 3.2, .1).translate(0, 1.6, 0);
    const plate = new THREE.PlaneGeometry(3.6, 2.3).rotateY(Math.PI).translate(0, 2.8, -.06);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 320;
    const g = canvas.getContext('2d');
    g.fillStyle = '#d5aa3e'; g.fillRect(0, 0, 512, 320);
    g.strokeStyle = '#242626'; g.lineWidth = 18; g.strokeRect(14, 14, 484, 292);
    // A large two-way chevron conveys alternating lane choices before text is legible.
    g.strokeStyle = '#242626'; g.lineWidth = 24; g.lineJoin = 'round';
    for (const [x, side] of [[165, -1], [347, 1]]) {
      g.beginPath(); g.moveTo(x - side * 32, 65); g.lineTo(x + side * 32, 111); g.lineTo(x - side * 32, 157); g.stroke();
    }
    g.fillStyle = '#242626'; g.textAlign = 'center'; g.font = 'bold 35px Arial';
    const words = cfg.name.split(' '), split = words.length > 2 ? words.length - 1 : 1;
    g.fillText(words.slice(0, split).join(' '), 256, 215);
    g.fillText(words.slice(split).join(' '), 256, 260);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: .75, metalness: .05, side: THREE.DoubleSide });
    mat.name = `driving_sign_${biome}`;
    const box = new THREE.Box3(new THREE.Vector3(-1.8, 0, -.1), new THREE.Vector3(1.8, 3.95, .1));
    const name = `driving_sign_${biome}`;
    kit.assets.set(name, { name, kind: 'prop', procedural: true, parts: [
      { name: 'post', geometry: post, material: postMat, role: 'main', tris: 12 },
      { name: 'sign', geometry: plate, material: mat, role: 'main', tris: 2 },
    ], box, sphere: box.getBoundingSphere(new THREE.Sphere()), size: box.getSize(new THREE.Vector3()), height: 3.95, radius: 1.8, tris: 14, sockets: {}, collision: null });
  }
  const routeSigns = [{ id: 'shortcut', label: 'SHORTCUT', green: true }, { id: 'merge', label: 'MERGE', green: false },
    ...Object.keys(BRANCH_DRIVING).filter(biome => biome !== 'desert' && biome !== 'canyon').map(biome => ({ id: `shortcut_${biome}`, label: BRANCH_DRIVING[biome].label, green: true }))];
  for (const { id, label, green } of routeSigns) for (const side of [-1, 1]) {
    const name = `driving_${id}_${side > 0 ? 'right' : 'left'}`;
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 320;
    const g = canvas.getContext('2d');
    g.fillStyle = green ? '#225c43' : '#d5aa3e'; g.fillRect(0, 0, 512, 320);
    g.strokeStyle = g.fillStyle = green ? '#f0eee4' : '#242626'; g.lineWidth = 14; g.strokeRect(12, 12, 488, 296);
    // The arrow is readable at speed before the lettering comes into range.
    const arrow = [[-132, -20], [32, -20], [32, -59], [128, 0], [32, 59], [32, 20], [-132, 20]];
    g.beginPath(); arrow.forEach(([x, y], i) => i ? g.lineTo(256 + side * x, 115 + y) : g.moveTo(256 + side * x, 115 + y)); g.closePath(); g.fill();
    g.textAlign = 'center'; g.font = label.length > 9 ? 'bold 42px Arial' : 'bold 48px Arial'; g.fillText(label, 256, 244);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: .75, metalness: .05, side: THREE.DoubleSide }); mat.name = name;
    const post = new THREE.BoxGeometry(.1, 3.2, .1).translate(0, 1.6, 0);
    const plate = new THREE.PlaneGeometry(3.6, 2.3).rotateY(Math.PI).translate(0, 2.8, -.06);
    const box = new THREE.Box3(new THREE.Vector3(-1.8, 0, -.1), new THREE.Vector3(1.8, 3.95, .1));
    kit.assets.set(name, { name, kind: 'prop', procedural: true, parts: [
      { name: 'post', geometry: post, material: postMat, role: 'main', tris: 12 },
      { name: 'sign', geometry: plate, material: mat, role: 'main', tris: 2 },
    ], box, sphere: box.getBoundingSphere(new THREE.Sphere()), size: box.getSize(new THREE.Vector3()), height: 3.95, radius: 1.8, tris: 14, sockets: {}, collision: null });
  }
}

/** Per-tile route markers survive streaming across the full branch, in both directions. */
export function buildDrivingBranches(ctx, chunk) {
  const tag = 'driving-branch-markers';
  if (chunk.done.has(tag)) return true;
  const { road } = ctx, lo = chunk.s0, hi = lo + CHUNK_LEN;
  for (const branch of road.ensureDrivingBranches()) {
    if (branch.s1 < lo || branch.s0 - 120 >= hi) continue;
    // Main-road +d is the driver's left, matching the existing curve signs.
    const kind = branch.biome === 'desert' || branch.biome === 'canyon' ? 'shortcut' : `shortcut_${branch.biome}`;
    const shortcut = `driving_${kind}_${branch.side > 0 ? 'left' : 'right'}`;
    const merge = `driving_merge_${branch.side > 0 ? 'right' : 'left'}`;
    if (!ctx.kit.get(shortcut) || !ctx.kit.get(merge) || !ctx.kit.get('delineator')) return false;
    useSpec(ctx, shortcut, SIGN_SPEC); useSpec(ctx, merge, SIGN_SPEC);
    useSpec(ctx, 'delineator', { far: 240, shadow: false });
    for (const s of [branch.s0 - 120, branch.s0 - 35]) if (s >= lo && s < hi) {
      const p = groundAt(road, ctx.seed, s, -branch.side * 12, {}), sm = road.sample(s, {});
      chunk.list(shortcut).push(p.x, p.y, p.z, sm.th, 1, 1, 1, 0, 1, 0, 0, 4);
    }
    const mergeS = branch.s1 - 80;
    if (mergeS >= lo && mergeS < hi) {
      const p = branchPointAt(road, branch, mergeS, branch.side * 7.3, {});
      chunk.list(merge).push(p.x, p.y - .12, p.z, p.th, 1, 1, 1, 0, 1, 0, 0, 4);
    }
    const start = Math.max(branch.s0, lo), end = Math.min(branch.s1, hi);
    for (let k = Math.ceil((start - branch.s0) / 12); branch.s0 + k * 12 < end; k++) {
      const s = branch.s0 + k * 12, sm = road.sample(s, {}), centre = branchSample(road, branch, s, {});
      for (const side of [-1, 1]) {
        const p = branchPointAt(road, branch, s, side * (branch.width / 2 + .9), {});
        const mainD = (p.x - sm.x) * sm.nx + (p.z - sm.z) * sm.nz;
        // Overlap at the joins is intentional asphalt. A decorative post must
        // never turn that join into an object standing inside the main lane.
        if (Math.abs(mainD) < 8 || Math.abs(centre.d) < 10) continue;
        chunk.list('delineator').push(p.x, p.y - .12, p.z, p.th + (side > 0 ? Math.PI : 0), 1, 1, 1, 0, 1, 0, 0, 1.2);
      }
    }
  }
  chunk.done.add(tag);
  return true;
}

/** Exact unscaled collision mesh of an asset, reduced/cached once for rock pieces. */
function obstacleMesh(asset) {
  if (COLLISION.has(asset)) return COLLISION.get(asset);
  let list;
  if (asset.name.startsWith('rock_')) list = rockCollisionMesh(asset);
  else if (asset.collision) list = [asset.collision];
  else list = asset.parts.map(part => {
    const g = part.geometry, attr = g.attributes.position;
    const pos = Float32Array.from(attr.array);
    const idx = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: attr.count }, (_, i) => i);
    return { pos, idx };
  });
  let np = 0, ni = 0;
  for (const m of list) { np += m.pos.length; ni += m.idx.length; }
  const pos = new Float32Array(np), idx = new Uint32Array(ni);
  let po = 0, io = 0;
  for (const m of list) {
    pos.set(m.pos, po);
    for (let i = 0; i < m.idx.length; i++) idx[io + i] = m.idx[i] + po / 3;
    po += m.pos.length; io += m.idx.length;
  }
  const mesh = { pos, idx }; COLLISION.set(asset, mesh); return mesh;
}

/** Fit authored geometry to one edge slice. Visual and collision share this exact matrix. */
export function stageObstaclePlacement(road, f, asset) {
  const cfg = STAGE_DRIVING[f.biome], span = stageObstacleSpan(f);
  const box = asset.box, size = asset.size;
  const crosswise = cfg.asset === 'jersey_barrier';
  const sx = (crosswise ? cfg.depth : span.width - .4) / Math.max(.1, size.x), sy = cfg.height / Math.max(.1, size.y), sz = (crosswise ? span.width - .4 : cfg.depth) / Math.max(.1, size.z);
  const fr = roadFrame(road, f.s0, cfg.depth, span.d, {});
  const basis = crosswise ? { lx: fr.fx, ly: fr.fy, lz: fr.fz, fx: -fr.lx, fy: -fr.ly, fz: -fr.lz } : fr;
  const ox = -(box.min.x + box.max.x) * .5 * sx, oy = -box.min.y * sy + .025, oz = -(box.min.z + box.max.z) * .5 * sz;
  const px = fr.x + fr.fx * cfg.depth / 2 + basis.lx * ox + fr.ux * oy + basis.fx * oz;
  const py = fr.y + fr.fy * cfg.depth / 2 + basis.ly * ox + fr.uy * oy + basis.fy * oz;
  const pz = fr.z + fr.fz * cfg.depth / 2 + basis.lz * ox + fr.uz * oy + basis.fz * oz;
  const matrix = new THREE.Matrix4().set(
    basis.lx * sx, fr.ux * sy, basis.fx * sz, px,
    basis.ly * sx, fr.uy * sy, basis.fy * sz, py,
    basis.lz * sx, fr.uz * sy, basis.fz * sz, pz,
    0, 0, 0, 1,
  );
  return { span, fr, basis, sx, sy, sz, px, py, pz, matrix };
}

export function buildStageWarning(ctx, chunk, f) {
  const name = `driving_sign_${f.biome}`, asset = ctx.kit.get(name);
  if (!asset) return false;
  useSpec(ctx, name, SIGN_SPEC);
  for (const side of [-1, 1]) {
    const p = groundAt(ctx.road, ctx.seed, f.s0, side * 11.8, {}), sm = ctx.road.sample(f.s0, {});
    // Raised ground is not a place to bury the sign. Stay at the actual shoulder.
    chunk.list(name).push(p.x, p.y, p.z, sm.th, 1, 1, 1, 0, 1, 0, 0, 4);
  }
  return true;
}

export function buildStageChallenge(ctx, chunk, f) {
  const cfg = STAGE_DRIVING[f.biome], asset = need(ctx, cfg.asset), cone = need(ctx, 'road_cone');
  if (asset === undefined || cone === undefined) return false;
  if (!asset) return true;
  useSpec(ctx, cfg.asset, { far: 650, shadow: true, behind: true, mergeNear: 35 });
  const p = stageObstaclePlacement(ctx.road, f, asset), fr = p.fr, basis = p.basis;
  chunk.list(cfg.asset).pushBasis(p.px, p.py, p.pz, basis.lx, basis.ly, basis.lz, fr.ux, fr.uy, fr.uz, basis.fx, basis.fy, basis.fz, p.sx, p.sy, p.sz, 8);
  const local = obstacleMesh(asset), pos = new Float32Array(local.pos.length), v = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) { v.fromArray(local.pos, i).applyMatrix4(p.matrix).toArray(pos, i); }
  const id = `stage-challenge:${f.challengeId}:${f.row}`;
  chunk.hooks.push(id);
  ctx.hook({ type: 'static', id, asset: cfg.asset, s0: f.s0, s1: f.s1, collision: { pos, idx: local.idx }, challengeId: f.challengeId });
  if (cone) {
    useSpec(ctx, 'road_cone');
    // A taper reveals which edge is closed well before reaching each solid slice.
    for (let i = 0; i < 7; i++) {
      const d = -f.passSide * (7 - (7 - Math.abs(p.span.d)) * i / 6);
      const q = ctx.road.pointAt(f.s0 - 45 + i * 5, d, {});
      chunk.list('road_cone').push(q.x, q.y, q.z, 0, 1.3, 1.3, 1.3, 0, 1, 0, 0, 1);
    }
  }
  return true;
}

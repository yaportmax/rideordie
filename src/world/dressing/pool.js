// Global instance pool: every asset gets ONE InstancedMesh per part (plus a shadow-casting twin for instances that can land in the sun shadow map).
// The per-chunk placement lists (InstList) are the source of truth; the pool is re-filled a few times per second from the chunks that
// are in range: per-instance distance culling, LOD swap (pine -> lod -> billboard, full -> merged), behind-camera culling and shadow selection.
import * as THREE from 'three';
import { instanceMaterial } from './assets.js';

export const DEFAULT_SPEC = { far: 700, shadow: false, sway: 0, lite: false, behind: false, fade: false };

export class InstancePool {
  constructor(scene, kit) {
    this.scene = scene; this.kit = kit;
    this.group = new THREE.Group(); this.group.name = 'dressing-pool'; scene.add(this.group);
    this.specs = new Map();     // primary asset name -> spec
    this.entries = new Map();   // asset name -> entry
    this.qf = 1;                // far-distance quality factor
    this.stats = { instances: 0, drawn: 0, shadowInstances: 0 };
  }

  setSpec(name, spec) { this.specs.set(name, { ...DEFAULT_SPEC, ...spec }); }
  /** Register a spec; big multi-material structures automatically get a merged single-draw far LOD ('name@m'). */
  register(name, spec = {}) {
    if (this.specs.has(name)) return;
    spec = { ...spec };
    const a = this.kit.get(name);
    if (a && a.kind === 'struct' && !spec.lods && spec.merge !== false && a.parts.length > 3) {
      const size = Math.max(a.size.x, a.size.y, a.size.z);
      const near = spec.mergeNear ?? (size > 40 ? 230 : size > 15 ? 150 : 100);
      this.kit.deriveMerged(name, { includeRoad: !!spec.showRoad });
      spec.lods = [{ asset: name, max: near }, { asset: name + '@m', max: 1e9 }];
    }
    this.setSpec(name, spec);
  }
  specOf(name) { return this.specs.get(name) || null; }

  _entry(assetName, spec) {
    let e = this.entries.get(assetName);
    if (e) return e;
    const asset = this.kit.get(assetName);
    if (!asset) { if (this.kit.state(assetName) === 'idle') this.kit.request(assetName); return null; }
    const fadeFar = spec.fade ? spec.far * this.qf : 0;
    const mats = asset.parts.map((p) => (asset.derived && p.ready ? p.material : instanceMaterial(p.material, { sway: spec.sway, height: asset.height, fadeNear: fadeFar * 0.82, fadeFar, lite: spec.lite })));
    e = { name: assetName, asset, mats, sets: [this._makeSet(asset, mats, false, 128), this._makeSet(asset, mats, true, 32)], showRoad: !!spec.showRoad };
    this.entries.set(assetName, e);
    return e;
  }

  _makeSet(asset, mats, shadow, cap) {
    const set = { n: 0, cap, shadow, meshes: [], asset, mats, sph: new THREE.Sphere(), min: new THREE.Vector3(), max: new THREE.Vector3(), rad: 0 };
    this._alloc(set);
    return set;
  }
  _alloc(set) {
    const cap = set.cap;
    set.mat = new Float32Array(cap * 16); set.col = new Float32Array(cap * 3);
    set.attr = new THREE.InstancedBufferAttribute(set.mat, 16); set.attr.setUsage(THREE.DynamicDrawUsage);
    set.colAttr = new THREE.InstancedBufferAttribute(set.col, 3); set.colAttr.setUsage(THREE.DynamicDrawUsage);
    set.asset.parts.forEach((p, i) => {
      const mesh = new THREE.InstancedMesh(p.geometry, set.mats[i], 1);
      mesh.instanceMatrix = set.attr; mesh.instanceColor = set.colAttr;
      mesh.count = 0; mesh.visible = false; mesh.frustumCulled = true; mesh.boundingSphere = set.sph;
      mesh.castShadow = set.shadow && !(p.material && p.material.transparent); mesh.receiveShadow = true;
      mesh.userData.role = p.role; mesh.userData.partName = p.name;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh); set.meshes.push(mesh);
    });
  }
  _regrow(set, need) {
    for (const m of set.meshes) { this.group.remove(m); m.dispose(); }
    set.meshes.length = 0;
    const oldMat = set.mat, oldCol = set.col, n = set.n;
    while (set.cap < need) set.cap *= 2;
    this._alloc(set);
    set.mat.set(oldMat.subarray(0, n * 16)); set.col.set(oldCol.subarray(0, n * 3));
  }

  /**
   * chunks: iterable of {lists: Map<string, InstList>}. cam = {x,y,z}; fwd = {x,z} unit (0,0 = no behind-culling).
   * sh = { on, fx,fy,fz (shadow focus), lx,ly,lz (unit vector TOWARD the sun), rad (lateral half-extent of the shadow box), depth (half length along the light) }.
   */
  rebuild(chunks, cam, fwd, sh) {
    for (const e of this.entries.values()) for (const set of e.sets) { set.n = 0; set.min.set(1e18, 1e18, 1e18); set.max.set(-1e18, -1e18, -1e18); set.rad = 0; }
    const cx = cam.x, cy = cam.y, cz = cam.z, fx = fwd.x, fz = fwd.z;
    let missing = 0, total = 0, shTotal = 0;
    const shOn = !!(sh && sh.on);
    for (const chunk of chunks) {
      for (const [key, list] of chunk.lists) {
        if (!list.n) continue;
        const spec = this.specs.get(key);
        if (!spec) continue;
        const far = spec.far * this.qf, farSq = far * far;
        const ex = list.rad;
        const dx0 = Math.max(list.minx - ex - cx, 0, cx - list.maxx - ex), dy0 = Math.max(list.miny - ex - cy, 0, cy - list.maxy - ex), dz0 = Math.max(list.minz - ex - cz, 0, cz - list.maxz - ex);
        if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > farSq) continue;
        const lods = spec.lods || [{ asset: key, max: 1e9 }];
        let ents = spec._ents;
        if (!ents || ents.length !== lods.length || ents.some((x) => !x)) {
          ents = lods.map((l) => this._entry(l.asset, spec)); spec._ents = ents;
          if (lods.some((l, k) => !ents[k] && this.kit.state(l.asset) !== 'missing')) missing++;
          if (ents.every((x) => !x)) continue;
        }
        const lodSq = lods.map((l) => (Math.min(l.max, far) * (l.max >= 1e8 ? 1 : this.qf)) ** 2);
        const nl = lods.length, m = list.m, col = list.col, behind = spec.behind, canShadow = spec.shadow && shOn;
        const rr = list.rad;
        for (let i = 0, n = list.n; i < n; i++) {
          const o = i * 16;
          const px = m[o + 12], py = m[o + 13], pz = m[o + 14];
          const dx = px - cx, dy = py - cy, dz = pz - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > farSq) continue;
          if (behind && d2 > 1600) { const dot = dx * fx + dz * fz; if (dot < 0 && dot * dot > 0.25 * d2) continue; }
          let li = 0; while (li < nl - 1 && d2 > lodSq[li]) li++;
          const ent = ents[li] || ents[nl - 1] || ents[0];
          if (!ent) continue;
          let toShadow = 0;
          if (canShadow) {
            const vx = px - sh.fx, vy = py - sh.fy, vz = pz - sh.fz;
            const along = vx * sh.lx + vy * sh.ly + vz * sh.lz;
            if (along > -sh.depth - rr && along < sh.depth + rr) {
              const perp2 = vx * vx + vy * vy + vz * vz - along * along, lim = sh.rad + rr;
              if (perp2 < lim * lim) toShadow = 1;
            }
          }
          const set = ent.sets[toShadow];
          if (set.n >= set.cap) this._regrow(set, set.n + 1);
          set.mat.set(m.subarray(o, o + 16), set.n * 16);
          const c = set.n * 3, ci = i * 3; set.col[c] = col[ci]; set.col[c + 1] = col[ci + 1]; set.col[c + 2] = col[ci + 2];
          set.n++; total += 1; shTotal += toShadow;
          if (px < set.min.x) set.min.x = px; if (px > set.max.x) set.max.x = px;
          if (py < set.min.y) set.min.y = py; if (py > set.max.y) set.max.y = py;
          if (pz < set.min.z) set.min.z = pz; if (pz > set.max.z) set.max.z = pz;
          if (rr > set.rad) set.rad = rr;
        }
      }
    }
    let drawn = 0;
    for (const e of this.entries.values()) {
      for (const set of e.sets) {
        const on = set.n > 0;
        if (on) {
          set.sph.center.set((set.min.x + set.max.x) / 2, (set.min.y + set.max.y) / 2, (set.min.z + set.max.z) / 2);
          set.sph.radius = 0.5 * Math.hypot(set.max.x - set.min.x, set.max.y - set.min.y, set.max.z - set.min.z) + set.rad + e.asset.sphere.radius * 1.5;
        }
        for (const mesh of set.meshes) {
          const hide = mesh.userData.role === 'road' && !e.showRoad;
          mesh.count = set.n; mesh.visible = on && !hide;
          if (mesh.visible) drawn++;
        }
        if (on) {
          set.attr.clearUpdateRanges(); set.attr.addUpdateRange(0, set.n * 16); set.attr.needsUpdate = true;
          set.colAttr.clearUpdateRanges(); set.colAttr.addUpdateRange(0, set.n * 3); set.colAttr.needsUpdate = true;
        }
      }
    }
    this.stats.instances = total; this.stats.drawn = drawn; this.stats.shadowInstances = shTotal;
    return missing === 0;
  }

  /** Debug: per-asset instance counts and triangles currently submitted (plain + shadow pass). */
  report() {
    const rows = [];
    for (const e of this.entries.values()) {
      const n0 = e.sets[0].n, n1 = e.sets[1].n; if (!n0 && !n1) continue;
      const vis = e.asset.parts.filter((p) => p.role !== 'road' || e.showRoad);
      const tris = vis.reduce((a, p) => a + p.tris, 0);
      rows.push({ name: e.name, n: n0, nShadow: n1, parts: vis.length, tris: tris * (n0 + n1), triPer: tris, draws: vis.length * ((n0 > 0) + (n1 > 0)) });
    }
    rows.sort((a, b) => b.tris - a.tris);
    return rows;
  }

  reset() {
    for (const e of this.entries.values()) for (const set of e.sets) for (const m of set.meshes) { this.group.remove(m); m.dispose(); }
    for (const e of this.entries.values()) for (const m of e.mats) m.dispose();
    this.entries.clear();
    for (const s of this.specs.values()) s._ents = null;
  }
  dispose() { this.reset(); this.scene.remove(this.group); }
}

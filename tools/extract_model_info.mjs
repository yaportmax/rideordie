// node tools/extract_model_info.mjs  -> src/data/model_info.json
// Reads every public/models/vehicles/*.glb (pure JSON-chunk parse, no GL) and records wheels, sockets, bounds so the sim specs match the art.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

const dir = 'public/models/vehicles';
const out = {};
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.glb') || f.startsWith('_') || f.startsWith('t_')) continue;
  const id = f.slice(0, -4);
  const buf = fs.readFileSync(path.join(dir, f));
  const jl = buf.readUInt32LE(12); const json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
  const nodes = json.nodes, acc = json.accessors, meshes = json.meshes || [];
  const world = new Array(nodes.length);
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
  const M = (i) => {
    if (world[i]) return world[i];
    const n = nodes[i]; const m = new THREE.Matrix4();
    if (n.matrix) m.fromArray(n.matrix); else m.compose(new THREE.Vector3(...(n.translation || [0, 0, 0])), new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(n.scale || [1, 1, 1])));
    world[i] = parent[i] >= 0 ? new THREE.Matrix4().multiplyMatrices(M(parent[i]), m) : m;
    return world[i];
  };
  const pos = (i) => new THREE.Vector3().setFromMatrixPosition(M(i));
  const meshBox = (i, mat) => {
    const n = nodes[i]; const b = new THREE.Box3();
    if (n.mesh === undefined) return b;
    for (const p of meshes[n.mesh].primitives) { const a = acc[p.attributes.POSITION]; if (!a.min) continue; const lo = a.min, hi = a.max; for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) b.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(mat)); }
    return b;
  };
  const subtree = (i, cb) => { cb(i); (nodes[i].children || []).forEach((c) => subtree(c, cb)); };
  const info = { wheels: {}, sockets: {}, bbox: null };
  const all = new THREE.Box3();
  nodes.forEach((n, i) => {
    const b = meshBox(i, M(i)); if (!b.isEmpty() && !/^wheel_|^panel_.*(spare)/.test(n.name || '')) all.union(b);
  });
  nodes.forEach((n, i) => {
    const name = n.name || '';
    if (/^wheel_[A-Za-z0-9]+$/.test(name)) {
      const p = pos(i); const b = new THREE.Box3();
      subtree(i, (k) => { const bb = meshBox(k, M(k)); if (!bb.isEmpty()) b.union(bb); });
      info.wheels[name.slice(6)] = { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), r: b.isEmpty() ? 0.35 : +((b.max.y - b.min.y) / 2).toFixed(3), w: b.isEmpty() ? 0.25 : +(b.max.x - b.min.x).toFixed(3) };
      const bb = b; if (!bb.isEmpty()) all.union(bb);
    } else if (/^(seat_|steering_wheel|gun_mount|light_head_|light_tail_|exhaust|smoke_engine|fuel_cap|nitro_|camera_hood|roof_top|turret|rocket_pod|flame_|muzzle|floodlight|smoke_stack)/.test(name)) {
      const p = pos(i); info.sockets[name] = [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];
    }
  });
  info.bbox = { min: all.min.toArray().map((v) => +v.toFixed(3)), max: all.max.toArray().map((v) => +v.toFixed(3)) };
  out[id] = info;
  console.log(id, 'wheels', Object.keys(info.wheels).join(','), 'size', all.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join('x'));
}
fs.writeFileSync('src/data/model_info.json', JSON.stringify(out, null, 1));

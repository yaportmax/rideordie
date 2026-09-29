// Contract check for the enemy_a GLBs (no browser needed: parses the GLB JSON chunk).
//   node tools/blender/vehicles/enemy_a/check_contract.mjs [--save] [ids...]
// --save writes the current node/socket/hub table to contract_baseline.json (do this ONCE from the shipped models).
// Without --save: compares every node of the baseline (name, parent, translation, rotation) with the current GLB,
// lists missing / moved nodes, material names, tris, primitives, bbox and file size.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const BASE = path.join(HERE, 'contract_baseline.json');
const args = process.argv.slice(2);
const save = args.includes('--save');
const ids = args.filter(a => !a.startsWith('--'));
const IDS = ids.length ? ids : ['e_sedan', 'e_muscle', 'e_buggy', 'e_technical'];
const PAL = ['paint', 'paint2', 'metal_dark', 'metal_bare', 'rust', 'chrome', 'rubber', 'rubber_tire', 'rim', 'armor', 'spike', 'plastic', 'interior',
  'fabric', 'leather', 'wood', 'canvas', 'brass', 'glass', 'light_head', 'light_tail', 'light_amber', 'cloth_red', 'cloth_dark', 'cloth_tan',
  'gun_metal', 'gun_black', 'gun_steel', 'polymer', 'glass_lens'];

export function readGlb(file) {
  const b = fs.readFileSync(file);
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + len).toString('utf8'));
  return { json, size: b.length };
}

function mul(a, b) { // quaternion multiply (x,y,z,w)
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
function rot(q, v) {
  const [x, y, z, w] = q; const [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

export function inspect(file) {
  const { json, size } = readGlb(file);
  const nodes = json.nodes || [];
  const parent = {};
  nodes.forEach((n, i) => (n.children || []).forEach(c => (parent[c] = i)));
  const table = {};
  let tris = 0, prims = 0;
  const bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9];
  const world = (i) => {
    let t = [0, 0, 0], q = [0, 0, 0, 1];
    const chain = [];
    for (let k = i; k !== undefined; k = parent[k]) chain.unshift(k);
    for (const k of chain) {
      const n = nodes[k];
      const lt = n.translation || [0, 0, 0], lq = n.rotation || [0, 0, 0, 1];
      const r = rot(q, lt);
      t = [t[0] + r[0], t[1] + r[1], t[2] + r[2]];
      q = mul(q, lq);
    }
    return { t, q };
  };
  nodes.forEach((n, i) => {
    const pname = parent[i] !== undefined ? nodes[parent[i]].name : null;
    table[n.name] = { parent: pname, t: (n.translation || [0, 0, 0]).map(v => +v.toFixed(3)), r: (n.rotation || [0, 0, 0, 1]).map(v => +v.toFixed(3)), mesh: n.mesh !== undefined };
    if (n.mesh !== undefined) {
      const W = world(i);
      for (const p of json.meshes[n.mesh].primitives) {
        prims++;
        const acc = json.accessors[p.indices !== undefined ? p.indices : p.attributes.POSITION];
        tris += acc.count / 3;
        const pa = json.accessors[p.attributes.POSITION];
        for (const cx of [0, 1]) for (const cy of [0, 1]) for (const cz of [0, 1]) {
          const v = [cx ? pa.max[0] : pa.min[0], cy ? pa.max[1] : pa.min[1], cz ? pa.max[2] : pa.min[2]];
          const r = rot(W.q, v);
          for (let a = 0; a < 3; a++) { const w = r[a] + W.t[a]; bmin[a] = Math.min(bmin[a], w); bmax[a] = Math.max(bmax[a], w); }
        }
      }
    }
  });
  const mats = (json.materials || []).map(m => m.name);
  const imgs = (json.images || []).map(im => im.mimeType + ':' + (json.bufferViews[im.bufferView].byteLength / 1024).toFixed(0) + 'KB');
  return { table, tris: Math.round(tris), prims, mats, imgs, size, bbox: { min: bmin.map(v => +v.toFixed(3)), max: bmax.map(v => +v.toFixed(3)), size: bmax.map((v, a) => +(v - bmin[a]).toFixed(3)) } };
}

const CONTRACT = /^(body|wheel_(FL|FR|RL|RR)|panel_.*|seat_driver|seat_gunner|steering_wheel|gun_mount|gun_mg|light_head_.*|light_tail_.*|exhaust.*|smoke_engine|fuel_cap|nitro_.*|camera_hood|roof_top)$/;
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) main();

function main() {
if (save) {
  const out = {};
  for (const id of IDS) {
    const r = inspect(path.join(ROOT, 'public/models/vehicles', id + '.glb'));
    out[id] = { nodes: Object.fromEntries(Object.entries(r.table).filter(([k]) => CONTRACT.test(k))), mats: r.mats, bbox: r.bbox, tris: r.tris, size: r.size };
  }
  fs.writeFileSync(BASE, JSON.stringify(out, null, 1));
  console.log('saved baseline', BASE);
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
let bad = 0;
for (const id of IDS) {
  const r = inspect(path.join(ROOT, 'public/models/vehicles', id + '.glb'));
  const b = base[id];
  const issues = [];
  for (const [name, bn] of Object.entries(b.nodes)) {
    const cn = r.table[name];
    if (!cn) { issues.push('MISSING ' + name); continue; }
    if (cn.parent !== bn.parent) issues.push(`PARENT ${name}: ${bn.parent} -> ${cn.parent}`);
    const dt = Math.max(...cn.t.map((v, i) => Math.abs(v - bn.t[i])));
    const dr = Math.max(...cn.r.map((v, i) => Math.abs(v - bn.r[i])));
    if (dt > 0.002 || dr > 0.002) issues.push(`MOVED ${name}: t ${bn.t} -> ${cn.t}  r ${bn.r} -> ${cn.r}`);
  }
  const sw = r.table.steering_wheel_mesh;
  if (sw) {
    const ident = sw.t.every(v => Math.abs(v) < 1e-3) && Math.abs(sw.r[3]) > 0.9999;
    console.log(`   steering_wheel_mesh: parent=${sw.parent} local t=${sw.t} r=${sw.r} ${sw.parent === 'steering_wheel' && ident ? 'OK' : 'BAD'}`);
  }
  const extra = Object.keys(r.table).filter(k => CONTRACT.test(k) && !b.nodes[k]);
  const offPal = r.mats.filter(m => !PAL.includes(m));
  const missMat = b.mats.filter(m => !r.mats.includes(m));
  const dbb = r.bbox.size.map((v, i) => +(v - b.bbox.size[i]).toFixed(3));
  console.log(`\n== ${id}: tris ${b.tris} -> ${r.tris}   prims ${r.prims}   size ${(b.size / 1048576).toFixed(2)} -> ${(r.size / 1048576).toFixed(2)} MB   imgs ${r.imgs.join(' ')}`);
  console.log(`   bbox ${JSON.stringify(b.bbox.min)}..${JSON.stringify(b.bbox.max)}  ->  ${JSON.stringify(r.bbox.min)}..${JSON.stringify(r.bbox.max)}   dsize ${dbb}`);
  console.log(`   mats: ${r.mats.join(' ')}`);
  if (offPal.length) console.log('   OFF-PALETTE materials:', offPal.join(' '));
  if (missMat.length) console.log('   materials no longer present:', missMat.join(' '));
  if (extra.length) console.log('   new contract-like nodes:', extra.join(' '));
  if (issues.length) { bad++; console.log('   ' + issues.join('\n   ')); } else console.log('   contract nodes: OK (' + Object.keys(b.nodes).length + ' nodes identical)');
}
process.exit(bad ? 1 : 0);
}

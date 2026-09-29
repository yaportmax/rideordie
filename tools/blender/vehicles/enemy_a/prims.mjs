// Draw-call breakdown: primitives (= draw calls) per mesh node with their materials and triangle counts.
//   node tools/blender/vehicles/enemy_a/prims.mjs e_sedan [e_muscle ...]
import { readGlb } from './check_contract.mjs';

for (const id of process.argv.slice(2)) {
  const { json } = readGlb(`public/models/vehicles/${id}.glb`);
  let total = 0;
  const rows = [];
  for (const n of json.nodes) {
    if (n.mesh === undefined) continue;
    const ps = json.meshes[n.mesh].primitives;
    total += ps.length;
    rows.push(`${n.name.padEnd(22)} ${String(ps.length).padStart(2)}  ` + ps.map(p => `${json.materials[p.material].name}:${Math.round(json.accessors[p.indices].count / 3)}`).join(' '));
  }
  console.log(`== ${id}  primitives ${total}`);
  console.log(rows.join('\n'));
}

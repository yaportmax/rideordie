import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const [x0, x1] = (process.argv[3] || '0.15,5.05').split(',').map(Number);
let bad = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); const n = pos.getCount(); const v = [0, 0, 0];
    const P = []; for (let i = 0; i < n; i++) { pos.getElement(i, v); P.push([m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12], m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13], m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]]); }
    const idx = prim.getIndices(); const I = idx ? Array.from(idx.getArray()) : P.map((_, i) => i);
    // triangles whose x-extent overlaps the gap and rise above 3 cm
    let hits = 0; const ex = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = P[I[t]], b = P[I[t+1]], c = P[I[t+2]];
      const mnx = Math.min(a[0], b[0], c[0]), mxx = Math.max(a[0], b[0], c[0]), mxy = Math.max(a[1], b[1], c[1]);
      if (mxx > x0 && mnx < x1 && mxy > 0.03) { hits++; if (ex.length < 3) ex.push([a, b, c].map((p) => p.map((q) => q.toFixed(2)).join(',')).join(' ')); }
    }
    if (hits) { bad += hits; console.log(node.getName(), 'tris in gap:', hits, ex.join(' || ')); }
  }
}
console.log('total', bad);

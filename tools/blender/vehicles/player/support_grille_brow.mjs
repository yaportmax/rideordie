// Repair the Bruiser's unsupported grille brow without rebuilding its textures.
// The matching kit_t3.py generator now includes these two welded armor mounts.
// Existing attributes and triangles are preserved; the mounts share its draw.
// Run explicitly: node tools/blender/vehicles/player/support_grille_brow.mjs --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const k = .44 / .335, zl = 1.22 - .19 * k;
const gwh = (.75 - .03 - .25 * k) * .98;
export const GRILLE_BROW_MOUNTS = [-1, 1].map(side => ({
  min: [side * (gwh + .06) - .0225, zl - .02 + .15 * k + .05 - .02, 2.48 + .075 - .025],
  max: [side * (gwh + .06) + .0225, zl + .30 * k + .02, 2.48 + .075 + .025],
}));
const REPAIR = 'rideordieGrilleBrowMounts';

export function box(bounds) {
  const [x0, y0, z0] = bounds.min, [x1, y1, z1] = bounds.max;
  const faces = [
    { n: [1, 0, 0], p: [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]] },
    { n: [-1, 0, 0], p: [[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[x0,y0,z0]] },
    { n: [0, 1, 0], p: [[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]] },
    { n: [0, -1, 0], p: [[x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1]] },
    { n: [0, 0, 1], p: [[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[x0,y0,z1]] },
    { n: [0, 0, -1], p: [[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0]] },
  ];
  return { vertices: faces.flatMap(({ n, p }) => p.map(position => ({ position, normal: n }))),
    indices: faces.flatMap((_f, i) => [0,1,2,0,2,3].map(v => i * 4 + v)) };
}

/** Add two mechanically connected posts to the actual fixed armor primitive. */
export function supportGrilleBrow(document) {
  const root = document.getRoot();
  if (root.getExtras()[REPAIR]) return { vertices: 0, triangles: 0 };
  const body = root.listNodes().find(node => node.getName() === 'body');
  const primitive = body?.getMesh()?.listPrimitives().find(p => p.getMaterial()?.getName() === 'armor');
  if (!primitive || primitive.getMode() !== 4 || !primitive.getIndices()) throw new TypeError('Expected Bruiser fixed indexed armor');
  const pos = primitive.getAttribute('POSITION'), count = pos.getCount();
  if (pos.getType() !== 'VEC3' || primitive.listSemantics().join(',') !== 'POSITION,NORMAL,TEXCOORD_0,COLOR_0') throw new TypeError('Unsupported armor attribute layout');
  const boxes = GRILLE_BROW_MOUNTS.map(box), vertices = boxes.flatMap(b => b.vertices);
  const positions = pos.getArray(), colors = primitive.getAttribute('COLOR_0').getArray();
  // Use the existing grille's own vertex tint. Material/texture/normal maps are
  // shared unchanged, rather than adding a flat-colored cockpit-only prop.
  let nearest = 0, best = Infinity;
  for (let i = 0; i < count; i++) {
    const d = (positions[i*3] - GRILLE_BROW_MOUNTS[1].min[0]) ** 2 +
      (positions[i*3+1] - GRILLE_BROW_MOUNTS[1].min[1]) ** 2 + (positions[i*3+2] - 2.555) ** 2;
    if (d < best) { nearest = i; best = d; }
  }
  for (const semantic of primitive.listSemantics()) {
    const original = primitive.getAttribute(semantic), input = original.getArray(), size = original.getElementSize();
    const output = new input.constructor((count + vertices.length) * size); output.set(input);
    vertices.forEach(({ position: p, normal: n }, i) => {
      const uv = Math.abs(n[0]) ? [p[2] * .8, p[1] * .8] : Math.abs(n[1]) ? [p[0] * .8, p[2] * .8] : [p[0] * .8, p[1] * .8];
      const value = semantic === 'POSITION' ? p : semantic === 'NORMAL' ? n : semantic === 'TEXCOORD_0' ? uv : Array.from(colors.subarray(nearest * size, (nearest + 1) * size));
      value.forEach((v, component) => { output[(count + i) * size + component] = v; });
    });
    primitive.setAttribute(semantic, original.clone().setArray(output));
  }
  const index = primitive.getIndices(), input = index.getArray(), Type = count + vertices.length > 65535 ? Uint32Array : input.constructor;
  const output = new Type(input.length + boxes.length * 36); output.set(input);
  boxes.forEach((b, i) => output.set(b.indices.map(v => count + i * 24 + v), input.length + i * 36));
  primitive.setIndices(index.clone().setArray(output));
  root.setExtras({ ...root.getExtras(), [REPAIR]: 1 });
  return { vertices: vertices.length, triangles: boxes.length * 12 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--apply') throw new Error('Pass --apply to repair the Bruiser asset');
  const target = fileURLToPath(new URL('../../../../public/models/vehicles/truck_t3.glb', import.meta.url));
  if (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target) throw new Error('Refusing linked asset path: ' + target);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), document = await io.read(target), result = supportGrilleBrow(document);
  if (result.vertices) {
    await document.transform(prune({ propertyTypes: [PropertyType.ACCESSOR], keepLeaves: true, keepAttributes: true, keepIndices: true }));
    fs.writeFileSync(target, await io.writeBinary(document));
  }
  console.log(JSON.stringify(result));
}

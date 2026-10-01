// Close the actual truck cab's front corner gaps without rebuilding textures.
// The matching truck_cab.py generator now authors these permanent kick panels.
// Run explicitly: node tools/blender/vehicles/player/close_cab_kick_panels.mjs --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { box } from './support_grille_brow.mjs';

// [cab half width, floor, windshield base, door front, cowl], from tiers.py.
export const CAB_DIMENSIONS = {
  truck_t1: [.8, .45, 1.08, .9, 1.02], truck_t2: [.9, .55, 1.28, 1, 1.14],
  truck_t3: [.91, .57, 1.3, 1.02, 1.16], truck_t4: [1, .64, 1.38, 1.08, 1.22],
};
export function cabKickPanels(id) {
  const dims = CAB_DIMENSIONS[id]; if (!dims) throw new TypeError('Expected one of the four player trucks');
  const [halfWidth, floor, windshield, doorFront, cowl] = dims;
  return [-1, 1].map(side => ({ min: [side * (halfWidth - .01) - .028, floor - .035, doorFront - .012],
    max: [side * (halfWidth - .01) + .028, windshield + .005, cowl + .005] }));
}
export function closeCabKickPanels(document, id) {
  const root = document.getRoot();
  if (root.getExtras().rideordieCabKickPanels) return { id, vertices: 0, triangles: 0 };
  const panels = cabKickPanels(id), body = root.listNodes().find(n => n.getName() === 'body');
  const primitive = body?.getMesh()?.listPrimitives().find(p => p.getMaterial()?.getName() === 'interior');
  if (!primitive || primitive.getMode() !== 4 || !primitive.getIndices()) throw new TypeError('Expected fixed indexed cab interior');
  const pos = primitive.getAttribute('POSITION'), count = pos.getCount();
  if (primitive.listSemantics().join(',') !== 'POSITION,NORMAL,TEXCOORD_0,COLOR_0') throw new TypeError('Unsupported cab attribute layout');
  const boxes = panels.map(box), vertices = boxes.flatMap(b => b.vertices), positions = pos.getArray();
  const colors = primitive.getAttribute('COLOR_0').getArray(), [halfWidth, floor, , doorFront] = CAB_DIMENSIONS[id];
  const tints = [-1, 1].map(side => {
    let nearest = 0, best = Infinity;
    for (let i = 0; i < count; i++) {
      const d = (positions[i*3] - side * (halfWidth - .01)) ** 2 +
        (positions[i*3+1] - floor - .3) ** 2 + (positions[i*3+2] - doorFront + .02) ** 2;
      if (d < best) { nearest = i; best = d; }
    }
    return Array.from(colors.subarray(nearest * 4, nearest * 4 + 4));
  });
  for (const semantic of primitive.listSemantics()) {
    const original = primitive.getAttribute(semantic), input = original.getArray(), size = original.getElementSize();
    const output = new input.constructor((count + vertices.length) * size); output.set(input);
    vertices.forEach(({ position: p, normal: n }, i) => {
      const uv = Math.abs(n[0]) ? [p[2] * .8, p[1] * .8] : Math.abs(n[1]) ? [p[0] * .8, p[2] * .8] : [p[0] * .8, p[1] * .8];
      const value = semantic === 'POSITION' ? p : semantic === 'NORMAL' ? n : semantic === 'TEXCOORD_0' ? uv : tints[Math.floor(i / 24)];
      value.forEach((v, component) => { output[(count + i) * size + component] = v; });
    });
    primitive.setAttribute(semantic, original.clone().setArray(output));
  }
  const index = primitive.getIndices(), input = index.getArray(), Type = count + vertices.length > 65535 ? Uint32Array : input.constructor;
  const output = new Type(input.length + boxes.length * 36); output.set(input);
  boxes.forEach((b, i) => output.set(b.indices.map(v => count + i * 24 + v), input.length + i * 36));
  primitive.setIndices(index.clone().setArray(output));
  root.setExtras({ ...root.getExtras(), rideordieCabKickPanels: 1 });
  return { id, vertices: 48, triangles: 24 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--apply') throw new Error('Pass --apply to repair the four truck cabs');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), base = fileURLToPath(new URL('../../../../public/models/vehicles/', import.meta.url));
  for (const id of Object.keys(CAB_DIMENSIONS)) {
    const target = path.join(base, id + '.glb');
    if (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target) throw new Error('Refusing linked asset path: ' + target);
    const document = await io.read(target), result = closeCabKickPanels(document, id);
    if (result.vertices) {
      await document.transform(prune({ propertyTypes: [PropertyType.ACCESSOR], keepLeaves: true, keepAttributes: true, keepIndices: true }));
      fs.writeFileSync(target, await io.writeBinary(document));
    }
    console.log(JSON.stringify(result));
  }
}

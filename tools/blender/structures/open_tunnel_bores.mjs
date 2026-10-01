// Repair the authored rock portal's solid rear cap without rebuilding textures.
// The matching Blender generator now emits an open annulus. This migration keeps
// all geometry outside the bore and every material, texture, node and collider.
// Run explicitly: node tools/blender/structures/open_tunnel_bores.mjs --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

export const ROCK_TUNNELS = ['tunnel_portal_rock', 'tunnel_exit', 'tunnel_portal_rock_grey', 'tunnel_exit_grey'];
export const TUNNEL_OPENING = [[-7.4, -0.45], [-7.4, 3.8],
  ...Array.from({ length: 13 }, (_, i) => {
    const angle = Math.PI - Math.PI * (i + 1) / 14;
    return [7.4 * Math.cos(angle), 3.8 + 3.6 * Math.sin(angle)];
  }), [7.4, 3.8], [7.4, -0.45]];

const planes = TUNNEL_OPENING.map((a, i) => {
  const b = TUNNEL_OPENING[(i + 1) % TUNNEL_OPENING.length], dx = b[0] - a[0], dy = b[1] - a[1];
  return [-dy, dx, dx * a[1] - dy * a[0]];
});
const distance = (vertex, plane) => vertex.p[0] * plane[0] + vertex.p[1] * plane[1] - plane[2] - 1e-9;
function partition(polygon, plane) {
  const inside = [], outside = [];
  let a = polygon.at(-1), da = distance(a, plane), aIn = da <= 0;
  for (const b of polygon) {
    const db = distance(b, plane), bIn = db <= 0;
    if (aIn !== bIn) {
      const t = da / (da - db), edge = { p: a.p.map((v, i) => v + (b.p[i] - v) * t), w: a.w.map((v, i) => v + (b.w[i] - v) * t) };
      inside.push(edge); outside.push(edge);
    }
    (bIn ? inside : outside).push(b);
    a = b; da = db; aIn = bIn;
  }
  return { inside, outside };
}
function area(polygon) {
  if (polygon.length < 3) return 0;
  const a = polygon[0].p;
  let sum = 0;
  for (let i = 1; i + 1 < polygon.length; i++) {
    const b = polygon[i].p, c = polygon[i + 1].p;
    sum += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  return sum;
}
function subtract(polygon) {
  let inside = polygon;
  const result = [];
  for (const plane of planes) {
    const pieces = partition(inside, plane);
    if (pieces.outside.length >= 3) result.push(pieces.outside);
    inside = pieces.inside;
    if (inside.length < 3) return null;
  }
  // Serialized Float32 boundary vertices can drift by a fraction of a micron.
  // Ignore that numerical sliver so repeating this migration changes nothing.
  if (area(inside) <= Math.max(1e-5, area(polygon) * 1e-7)) return null;
  return result;
}

/** Cut only the planar authored rear rock cap; untouched indices stay exact. */
export function openTunnelBore(document, name) {
  if (!ROCK_TUNNELS.includes(name)) throw new TypeError('Only the four authored rock portals have this faulty cap');
  const capZ = name.includes('exit') ? -5 : 17;
  let changedTriangles = 0, addedVertices = 0;
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    if (!/^rock_(red|grey)$/.test(primitive.getMaterial()?.getName() || '') || mesh.getName() === 'collision') continue;
    const pos = primitive.getAttribute('POSITION'), indices = primitive.getIndices();
    if (!pos || !indices || pos.getType() !== 'VEC3' || primitive.getMode() !== 4) throw new TypeError('Expected indexed rigid rock triangles');
    const positions = pos.getArray(), sourceIndices = indices.getArray(), outputIndices = [], added = [];
    let changed = false;
    for (let i = 0; i < sourceIndices.length; i += 3) {
      const original = Array.from(sourceIndices.subarray(i, i + 3));
      const triangle = original.map((index, k) => ({ index, p: Array.from(positions.subarray(index * 3, index * 3 + 3)), w: [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0] }));
      if (!triangle.every(v => Math.abs(v.p[2] - capZ) < 1e-5)) { outputIndices.push(...original); continue; }
      const outside = subtract(triangle);
      if (outside === null) { outputIndices.push(...original); continue; }
      changed = true; changedTriangles++;
      for (const polygon of outside) {
        if (area(polygon) < 1e-8) continue;
        const ids = polygon.map(vertex => {
          if (vertex.index !== undefined) return vertex.index;
          vertex.index = pos.getCount() + added.length;
          added.push({ original, weights: vertex.w });
          return vertex.index;
        });
        for (let j = 1; j + 1 < polygon.length; j++) if (area([polygon[0], polygon[j], polygon[j + 1]]) > 1e-8) outputIndices.push(ids[0], ids[j], ids[j + 1]);
      }
    }
    if (!changed) continue;
    for (const semantic of primitive.listSemantics()) {
      const accessor = primitive.getAttribute(semantic), input = accessor.getArray(), size = accessor.getElementSize();
      const output = new input.constructor((pos.getCount() + added.length) * size); output.set(input);
      added.forEach(({ original, weights }, i) => {
        const values = Array.from({ length: size }, (_, k) => weights.reduce((sum, weight, j) => sum + weight * input[original[j] * size + k], 0));
        if (/^(NORMAL|TANGENT)$/.test(semantic)) {
          const length = Math.hypot(...values.slice(0, 3));
          const unit = accessor.getNormalized() && !(input instanceof Float32Array) ? (input.BYTES_PER_ELEMENT === 1 ? 127 : 32767) : 1;
          if (length > 0) for (let k = 0; k < 3; k++) values[k] *= unit / length;
        }
        values.forEach((value, k) => { output[(pos.getCount() + i) * size + k] = input instanceof Float32Array ? value : Math.round(value); });
      });
      primitive.setAttribute(semantic, accessor.clone().setArray(output));
    }
    const Type = pos.getCount() + added.length > 65535 ? Uint32Array : Uint16Array;
    primitive.setIndices(indices.clone().setArray(new Type(outputIndices)));
    addedVertices += added.length;
  }
  return { name, capZ, changedTriangles, addedVertices };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--apply') throw new Error('Pass --apply to migrate the four rock tunnel assets');
  const base = fileURLToPath(new URL('../../../public/models/structures/', import.meta.url));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const name of ROCK_TUNNELS) {
    const target = path.join(base, name + '.glb');
    if (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target) throw new Error('Refusing linked asset path: ' + target);
    const document = await io.read(target), result = openTunnelBore(document, name);
    if (result.changedTriangles) {
      await document.transform(prune({ propertyTypes: [PropertyType.ACCESSOR], keepLeaves: true, keepAttributes: true, keepIndices: true }));
      fs.writeFileSync(target, await io.writeBinary(document));
    }
    console.log(JSON.stringify(result));
  }
}

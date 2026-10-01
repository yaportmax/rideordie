// Cache-owned first-person optic variants. Subtract only a bounded polygonal
// bore; the authored source remains available for hip fire and external views.
import * as THREE from 'three';

const cache = new WeakMap();
const EPS = 1e-11;

function channelsFor(channels) {
  const list = Array.isArray(channels) ? channels : [channels];
  if (list.length > 16) throw new TypeError('Sight bores support at most 16 bounded channels');
  return list.map((channel) => {
    const { centerX = 0, centerY = 0, radius, minZ, maxZ, sides = 24 } = channel || {};
    if (![centerX, centerY, radius, minZ, maxZ].every(Number.isFinite) || radius <= 0 || minZ >= maxZ || !Number.isInteger(sides) || sides < 3 || sides > 64) {
      throw new TypeError('Sight bores need finite coordinates, positive radius, ordered Z bounds and 3-64 sides');
    }
    return { centerX, centerY, radius, minZ, maxZ, sides };
  });
}

function validate(source) {
  const position = source.attributes.position;
  if (!source.index || !position || position.itemSize !== 3 || source.isInstancedBufferGeometry || Object.keys(source.morphAttributes).length || source.groups.length || source.drawRange.start !== 0 || source.drawRange.count < source.index.count) {
    throw new TypeError('Sight bores require a full, rigid, indexed geometry without groups or morphs');
  }
  const index = source.index;
  if (index.itemSize !== 1 || index.normalized || index.isInterleavedBufferAttribute || ![Uint8Array, Uint16Array, Uint32Array].some(Type => index.array instanceof Type)) {
    throw new TypeError('Sight bores require scalar unsigned integer triangle indices');
  }
  for (const [name, attr] of Object.entries(source.attributes)) {
    if (/^skin(Index|Weight)$/.test(name) || attr.isInterleavedBufferAttribute || attr.isInstancedBufferAttribute || attr.isFloat16BufferAttribute || attr.count !== position.count || !attr.array) {
      throw new TypeError('Sight bores cannot split skin, interleaved, half-float or mismatched attributes');
    }
  }
  if (source.index.count % 3 !== 0) throw new TypeError('Sight bores require triangle indices');
}

/** Optional local sight variants cannot safely change unsupported mesh layouts. */
export function supportsSightBoreGeometry(source) {
  try { validate(source); return true; }
  catch (error) { if (error instanceof TypeError) return false; throw error; }
}

function planesFor(channel) {
  const { centerX, centerY, radius, minZ, maxZ, sides } = channel;
  const planes = [[0, 0, -1, -minZ], [0, 0, 1, maxZ]];
  // radius is the circumradius; the vertices lie on the authored bore circle.
  const edgeRadius = radius * Math.cos(Math.PI / sides);
  for (let i = 0; i < sides; i++) {
    const angle = (i + 0.5) * Math.PI * 2 / sides, x = Math.cos(angle), y = Math.sin(angle);
    planes.push([x, y, 0, edgeRadius + x * centerX + y * centerY]);
  }
  return planes;
}

function distance(vertex, plane) {
  const p = vertex.p;
  return p[0] * plane[0] + p[1] * plane[1] + p[2] * plane[2] - plane[3] - EPS;
}

function intersection(a, b, da, db) {
  const t = Math.max(0, Math.min(1, da / (da - db)));
  if (t < 1e-12) return a;
  if (t > 1 - 1e-12) return b;
  return { p: a.p.map((v, i) => v + (b.p[i] - v) * t), w: a.w.map((v, i) => v + (b.w[i] - v) * t) };
}

function partition(polygon, plane) {
  const inside = [], outside = [];
  let a = polygon[polygon.length - 1], da = distance(a, plane), aIn = da <= 0;
  for (const b of polygon) {
    const db = distance(b, plane), bIn = db <= 0;
    if (aIn !== bIn) {
      const edge = intersection(a, b, da, db);
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
  let value = 0;
  for (let i = 1; i + 1 < polygon.length; i++) {
    const b = polygon[i].p, c = polygon[i + 1].p;
    const x = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const y = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const z = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    value += Math.hypot(x, y, z) * 0.5;
  }
  return value;
}

function subtract(polygon, planes) {
  let remaining = polygon;
  const outside = [];
  for (const plane of planes) {
    const parts = partition(remaining, plane);
    if (parts.outside.length >= 3) outside.push(parts.outside);
    remaining = parts.inside;
    // The complete polygon misses this convex volume. Preserve it exactly,
    // including when earlier planes provisionally divided it into fragments.
    if (remaining.length < 3) return null;
  }
  const removed = area(remaining), original = area(polygon);
  if (removed <= Math.max(1e-20, original * 1e-10)) return null;
  return outside;
}

/**
 * Subtract one or more +Z convex polygon cylinders in geometry-local metres.
 * channel = { centerX, centerY, radius, minZ, maxZ, sides = 24 }.
 * Returns the source when untouched, otherwise a shared cache-owned variant.
 * Callers restore the original outside ADS and never dispose a cached variant.
 */
export function sightBoreGeometry(source, channels) {
  const list = channelsFor(channels);
  if (!list.length) return source;
  validate(source);
  const key = JSON.stringify(list);
  let variants = cache.get(source);
  if (variants?.has(key)) return variants.get(key);
  if (!variants) { variants = new Map(); cache.set(source, variants); }
  const planes = list.map(planesFor), position = source.attributes.position;
  const output = [], added = [];
  let changed = false;
  const emit = (polygon, original) => {
    const ids = polygon.map((vertex) => {
      if (vertex.index !== undefined) return vertex.index;
      vertex.index = position.count + added.length;
      added.push({ w: vertex.w, original });
      return vertex.index;
    });
    for (let i = 1; i + 1 < polygon.length; i++) {
      if (area([polygon[0], polygon[i], polygon[i + 1]]) > 1e-20) output.push(ids[0], ids[i], ids[i + 1]);
    }
  };
  for (let i = 0; i < source.index.count; i += 3) {
    const original = [source.index.getX(i), source.index.getX(i + 1), source.index.getX(i + 2)];
    if (original.some((index) => !Number.isInteger(index) || index < 0 || index >= position.count)) throw new TypeError('Sight bore index outside position attribute');
    const triangle = original.map((index, k) => ({ p: [position.getX(index), position.getY(index), position.getZ(index)], w: [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0], index }));
    let polygons = [triangle], triangleChanged = false;
    for (const channelPlanes of planes) {
      const next = [];
      for (const polygon of polygons) {
        const outside = subtract(polygon, channelPlanes);
        if (outside === null) next.push(polygon);
        else { next.push(...outside); triangleChanged = true; }
      }
      polygons = next;
      if (!polygons.length) break;
    }
    if (!triangleChanged) output.push(...original);
    else { changed = true; for (const polygon of polygons) emit(polygon, original); }
  }
  if (!changed) { variants.set(key, source); return source; }
  const geometry = new THREE.BufferGeometry();
  geometry.name = source.name + '_sightBore';
  for (const [name, attr] of Object.entries(source.attributes)) {
    const array = new attr.array.constructor((position.count + added.length) * attr.itemSize);
    array.set(attr.array);
    const target = new THREE.BufferAttribute(array, attr.itemSize, attr.normalized);
    target.name = attr.name; target.setUsage(attr.usage); target.gpuType = attr.gpuType;
    added.forEach(({ w, original }, j) => {
      const values = Array.from({ length: attr.itemSize }, (_, k) => w.reduce((value, weight, v) => value + weight * attr.getComponent(original[v], k), 0));
      if ((name === 'normal' || name === 'tangent') && values.length >= 3) {
        const length = Math.hypot(values[0], values[1], values[2]);
        if (length > 0) for (let k = 0; k < 3; k++) values[k] /= length;
      }
      values.forEach((value, k) => target.setComponent(position.count + j, k, value));
    });
    geometry.setAttribute(name, target);
  }
  const maxIndex = position.count + added.length - 1;
  const IndexType = source.index.array.BYTES_PER_ELEMENT < 4 && maxIndex > 65535 ? Uint32Array : source.index.array.BYTES_PER_ELEMENT < 2 && maxIndex > 255 ? Uint16Array : source.index.array.constructor;
  geometry.setIndex(new THREE.BufferAttribute(new IndexType(output), 1));
  geometry.boundingBox = source.boundingBox?.clone() || null;
  geometry.boundingSphere = source.boundingSphere?.clone() || null;
  variants.set(key, geometry);
  return geometry;
}

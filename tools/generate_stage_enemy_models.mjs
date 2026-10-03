// Root-only CPU asset-export lease. No renderer/browser required.
// Six independently authored chassis in metres, +X left/+Y up/+Z forward.
// node tools/generate_stage_enemy_models.mjs
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(path.basename(ROOT), 'rideordie-fast-opt', 'Authoring stays in the isolated checkout');
const MODEL_DIR = path.join(ROOT, 'public/models/vehicles');
const META = path.join(ROOT, 'src/data/enemy_variant_model_info.json');
const REPORT = path.join(ROOT, 'work/stage-enemy-models-export.json');
const SOURCE = 'tools/generate_stage_enemy_models.mjs';
const ID_LIST = ['e_barrel_carrier', 'e_grenadier', 'e_armored', 'e_monster', 'e_light_tank', 'e_warwagon'];
// GLTFLoader receives root-relative model URLs from Assets.loadGLB. Its
// resource base is /models/vehicles/, so a leading-slash image URI is appended
// to that directory by LoaderUtils rather than resolved at the site root.
// File-relative references work for both root-relative and absolute GLB URLs.
const MAPS = ['albedo', 'normal', 'arm'].map(name => `../../textures/rust_metal/${name}.jpg`);
for (const uri of MAPS) {
  const texturePath = fileURLToPath(new URL(uri, new URL('public/models/vehicles/chassis.glb', new URL('../', import.meta.url))));
  assert.equal(path.dirname(texturePath), path.join(ROOT, 'public/textures/rust_metal'));
  await access(texturePath);
}

// GLTFExporter's geometry-only binary path uses FileReader for its final Blob.
// The exporter never receives a CanvasTexture or an Image from this generator.
globalThis.FileReader ??= class FileReader {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }, error => { this.error = error; this.onerror?.({ target: this }); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }, error => { this.error = error; this.onerror?.({ target: this }); }); }
};

const materials = {
  paint: new THREE.MeshStandardMaterial({ name: 'paint', color: 0xffffff, vertexColors: true, roughness: .84, metalness: .44 }),
  paint2: new THREE.MeshStandardMaterial({ name: 'paint2', color: 0xffffff, vertexColors: true, roughness: .80, metalness: .36 }),
  metal_dark: new THREE.MeshStandardMaterial({ name: 'metal_dark', color: 0x8a949a, vertexColors: true, roughness: .83, metalness: .68 }),
  rubber_tire: new THREE.MeshStandardMaterial({ name: 'rubber_tire', color: 0x232629, vertexColors: true, roughness: .95, metalness: .02 }),
  rim: new THREE.MeshStandardMaterial({ name: 'rim', color: 0x89939a, vertexColors: true, roughness: .72, metalness: .72 }),
  glass: new THREE.MeshStandardMaterial({ name: 'glass', color: 0x20313a, vertexColors: true, roughness: .08, metalness: .20, transparent: true, opacity: .18, depthWrite: false }),
  light_head: new THREE.MeshStandardMaterial({ name: 'light_head', color: 0xffedc2, vertexColors: true, roughness: .26, metalness: .05, emissive: 0xffd696, emissiveIntensity: .75 }),
  light_tail: new THREE.MeshStandardMaterial({ name: 'light_tail', color: 0xeb3822, vertexColors: true, roughness: .26, metalness: .10, emissive: 0xe9220d, emissiveIntensity: .62 }),
};
const C = hex => new THREE.Color(hex);
const palette = { paint: C(0xb1aaa0), accent: C(0xb6a062), hardware: C(0x606b73), black: C(0x484e52), stripe: C(0xb7ac65), white: C(0xc3c0ac), rust: C(0x855039) };
const rounded = (size, bevel = .025) => bevel > 0 ? mergeVertices(new RoundedBoxGeometry(...size, 1, bevel), 1e-5) : new THREE.BoxGeometry(...size);
const vector = value => new THREE.Vector3(...value);
const orientation = value => new THREE.Quaternion().setFromEuler(new THREE.Euler(...value));
const colorVector = value => value?.isColor ? value : C(value ?? 0xffffff);
const deterministic = (x, y, z, seed) => { const v = Math.sin(x * 12.9898 + y * 31.233 + z * 19.312 + seed * 1.91) * 43758.5453; return v - Math.floor(v); };
function decorate(geo, tint, seed, weather = true) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2), color = new Uint8Array(p.count * 3), c = colorVector(tint);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    // Metre-scale projection allows all cars to reuse the existing shared PBR
    // wear maps. It avoids stretching one tiled rusty square over a whole hull.
    if (nx >= ny && nx >= nz) { uv[i * 2] = z * .68; uv[i * 2 + 1] = y * .68; }
    else if (ny >= nx && ny >= nz) { uv[i * 2] = x * .68; uv[i * 2 + 1] = z * .68; }
    else { uv[i * 2] = x * .68; uv[i * 2 + 1] = y * .68; }
    const grit = weather ? (.84 + deterministic(x, y, z, seed) * .14) * (.78 + .22 * Math.min(1, Math.max(0, y / 1.35))) : 1;
    color[i * 3] = Math.round(Math.min(1, c.r * grit) * 255); color[i * 3 + 1] = Math.round(Math.min(1, c.g * grit) * 255); color[i * 3 + 2] = Math.round(Math.min(1, c.b * grit) * 255);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.BufferAttribute(color, 3, true));
  if (!geo.index) geo = mergeVertices(geo, 1e-5);
  return geo;
}

class CarBuilder {
  constructor(id, seed) { this.id = id; this.seed = seed; this.root = new THREE.Group(); this.root.name = id; this.groups = new Map(); this.sockets = {}; this.wheels = {}; this.group('body', [0, 0, 0]); }
  group(name, origin = [0, 0, 0]) { if (!this.groups.has(name)) { const node = new THREE.Group(); node.name = name; node.position.fromArray(origin); this.root.add(node); this.groups.set(name, { node, origin: vector(origin), buckets: new Map() }); } return this.groups.get(name); }
  socket(name, position, rotation = [0, 0, 0]) { const node = new THREE.Group(); node.name = name; node.position.fromArray(position); node.quaternion.copy(orientation(rotation)); this.root.add(node); this.sockets[name] = [...position]; return node; }
  add(material, geometry, at, rotation = [0, 0, 0], tint = palette.paint, group = 'body', weather = true) {
    const data = this.group(group), matrix = new THREE.Matrix4().compose(vector(at), orientation(rotation), new THREE.Vector3(1, 1, 1));
    geometry.applyMatrix4(matrix); geometry = decorate(geometry, tint, this.seed, weather); geometry.translate(-data.origin.x, -data.origin.y, -data.origin.z);
    if (!data.buckets.has(material)) data.buckets.set(material, []); data.buckets.get(material).push(geometry);
  }
  box(material, size, at, options = {}) { this.add(material, rounded(size, options.bevel ?? .015), at, options.rotation, options.tint ?? (material === 'paint2' ? palette.accent : material === 'metal_dark' ? palette.hardware : palette.paint), options.group, options.weather ?? true); }
  cylinder(material, from, to, radius, options = {}) {
    const a = vector(from), b = vector(to), delta = b.clone().sub(a), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    const geo = new THREE.CylinderGeometry(options.topRadius ?? radius, radius, delta.length(), options.segments ?? 10, 1, options.open ?? false);
    const data = this.group(options.group || 'body'); geo.applyQuaternion(q); geo.translate(...a.add(b).multiplyScalar(.5).toArray());
    const decorated = decorate(geo, options.tint ?? palette.hardware, this.seed, options.weather ?? true); decorated.translate(-data.origin.x, -data.origin.y, -data.origin.z);
    if (!data.buckets.has(material)) data.buckets.set(material, []); data.buckets.get(material).push(decorated);
  }
  beam(from, to, width = .07, options = {}) {
    const a = vector(from), b = vector(to), delta = b.clone().sub(a), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    const geo = rounded([width, delta.length(), options.depth || width], options.bevel ?? 0); geo.applyQuaternion(q); geo.translate(...a.add(b).multiplyScalar(.5).toArray());
    this.add(options.material || 'metal_dark', geo, [0, 0, 0], [0, 0, 0], options.tint || palette.hardware, options.group);
  }
  wheelSet(track, frontZ, rearZ, radius, width, monster = false, tracked = false) {
    const tyrePieces = [], rimPieces = [], profile = [new THREE.Vector2(radius * .54, width * .37), new THREE.Vector2(radius * .75, width * .50), new THREE.Vector2(radius * .94, width * .49), new THREE.Vector2(radius * .99, width * .36), new THREE.Vector2(radius, width * .28), new THREE.Vector2(radius, -width * .28), new THREE.Vector2(radius * .99, -width * .36), new THREE.Vector2(radius * .94, -width * .49), new THREE.Vector2(radius * .75, -width * .50), new THREE.Vector2(radius * .54, -width * .37)];
    const tyre = new THREE.LatheGeometry(profile, tracked ? 16 : 24); tyre.rotateZ(Math.PI / 2); tyrePieces.push(tyre);
    // Track belts carry the tank's visible treads; its under-belt hubs do not
    // also need a second duplicated car tyre tread pattern.
    const lugCount = tracked ? 0 : monster ? 18 : 16, pitch = Math.PI * 2 / Math.max(1, lugCount);
    for (let i = 0; i < lugCount; i++) for (const side of [-1, 1]) {
      const angle = pitch * (i + (side > 0 ? .35 : 0)), length = radius * pitch * .62, thickness = monster ? .06 : .024;
      const g = new THREE.BoxGeometry(width * .46, thickness, length), radial = radius - thickness / 2 - length * length / (8 * radius) - .002;
      g.rotateX(angle); g.translate(side * width * .24, radial * Math.cos(angle), radial * Math.sin(angle)); tyrePieces.push(g);
    }
    for (const side of [-1, 1]) {
      const face = new THREE.CylinderGeometry(radius * .56, radius * .56, width * .15, tracked ? 10 : 16); face.rotateZ(Math.PI / 2); face.translate(side * width * .365, 0, 0); rimPieces.push(face);
      const hub = new THREE.CylinderGeometry(radius * .18, radius * .22, width * .17, tracked ? 8 : 10); hub.rotateZ(Math.PI / 2); hub.translate(side * width * .40, 0, 0); rimPieces.push(hub);
      const boltCount = tracked ? 4 : 6;
      for (let i = 0; i < boltCount; i++) { const a = i * Math.PI * 2 / boltCount, bolt = new THREE.CylinderGeometry(radius * .031, radius * .031, width * .04, tracked ? 4 : 5); bolt.rotateZ(Math.PI / 2); bolt.translate(side * width * .456, Math.cos(a) * radius * .34, Math.sin(a) * radius * .34); rimPieces.push(bolt); }
    }
    const tyreGeo = decorate(mergeGeometries(tyrePieces, false), C(0xd3d0c9), this.seed), rimGeo = decorate(mergeGeometries(rimPieces, false), C(0xbeb8a0), this.seed);
    for (const name of ['FL', 'FR', 'RL', 'RR']) {
      const x = name.endsWith('L') ? track : -track, z = name.startsWith('F') ? frontZ : rearZ, group = new THREE.Group(); group.name = 'wheel_' + name; group.position.set(x, radius, z);
      const t = new THREE.Mesh(tyreGeo, materials.rubber_tire); t.name = 'tyre'; const rim = new THREE.Mesh(rimGeo, materials.rim); rim.name = 'rim'; group.add(t, rim); this.root.add(group); this.wheels[name] = group;
    }
    for (const geo of [...tyrePieces, ...rimPieces]) geo.dispose();
  }
  seat(position) {
    const [x, y, z] = position; this.box('metal_dark', [.48, .09, .45], [x, y + .02, z], { bevel: .025, tint: palette.black });
    this.box('metal_dark', [.49, .53, .08], [x, y + .30, z - .19], { bevel: .025, rotation: [.10, 0, 0], tint: palette.black });
    this.box('paint2', [.045, .13, .34], [x + .20, y + .12, z], { bevel: 0 }); this.box('paint2', [.045, .13, .34], [x - .20, y + .12, z], { bevel: 0 });
    this.socket('seat_driver', position); const steering = [x, y + .40, z + .47]; this.socket('steering_wheel', steering);
    const ring = new THREE.TorusGeometry(.18, .018, 6, 16); this.add('metal_dark', ring, steering, [.48, 0, 0], palette.hardware);
    for (const yaw of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) this.box('metal_dark', [.024, .30, .025], steering, { bevel: 0, rotation: [.48, 0, yaw], tint: palette.hardware });
  }
  gunner(position, index = 1, ring = true) {
    const suffix = index === 1 ? '' : String(index), [x, floor, z] = position;
    this.socket('seat_gunner' + suffix, position); this.socket('gun_mount' + suffix, [x, floor + 1.35, z + .35]); this.socket('muzzle' + suffix, [x, floor + 1.35, z + .80]);
    this.box('metal_dark', [.52, .06, .57], [x, floor, z], { bevel: .02 });
    if (ring) { const r = new THREE.TorusGeometry(.35, .035, 6, 16); this.add('metal_dark', r, [x, floor + .62, z], [Math.PI / 2, 0, 0], palette.hardware); }
    for (const side of [-1, 1]) this.cylinder('metal_dark', [x + side * .26, floor, z + .28], [x + side * .26, floor + .78, z + .28], .025, { segments: 6 });
  }
  lamps(front, rear, half, y) {
    for (const side of [-1, 1]) {
      const x = side * half, suffix = side > 0 ? 'L' : 'R';
      this.box('metal_dark', [.34, .18, .12], [x, y, front - .035], { bevel: .025 }); this.box('light_head', [.25, .105, .025], [x, y, front + .035], { bevel: .01, tint: C(0xffffff), weather: false });
      this.box('light_tail', [.14, .18, .03], [x, y - .11, rear - .035], { bevel: .008, tint: C(0xffffff), weather: false });
      this.socket('light_head_' + suffix, [x, y, front + .055]); this.socket('light_tail_' + suffix, [x, y - .11, rear - .055]);
    }
  }
  axle(track, z, y) { this.cylinder('metal_dark', [-track, y, z], [track, y, z], .07, { segments: 8 }); }
  chassis(length, width, floor, options = {}) {
    const color = options.tint || palette.paint;
    this.box('metal_dark', [width * .64, .13, length * .93], [0, floor - .16, 0], { bevel: .02 });
    this.box('paint', [width, .13, length * .91], [0, floor, 0], { bevel: .028, tint: color });
    for (const side of [-1, 1]) this.box('metal_dark', [.10, .13, length * .82], [side * width * .34, floor - .29, -.08], { bevel: 0 });
  }
  cab(driver, bounds, options = {}) {
    const { xHalf, rear, front, sill, roof } = bounds, tint = options.tint || palette.paint;
    this.seat(driver);
    this.box('paint', [xHalf * 2, .11, front - rear], [0, roof, (front + rear) / 2], { bevel: .03, tint });
    this.box('paint', [xHalf * 2, .27, .10], [0, sill, rear], { bevel: .02, tint });
    for (const side of [-1, 1]) {
      const x = side * xHalf;
      this.box('paint', [.07, roof - sill, .08], [x, (roof + sill) / 2, rear], { bevel: .009, tint });
      this.beam([x, sill, front + .17], [x, roof, front], .055, { material: 'paint', tint });
      this.box('paint', [.075, .25, front - rear], [x, sill, (front + rear) / 2], { bevel: .016, tint });
      this.box('metal_dark', [.035, .04, front - rear - .09], [side * (xHalf + .04), sill + .15, (front + rear) / 2], { bevel: 0 });
      this.box('paint2', [.016, .12, .33], [side * (xHalf + .05), sill + .03, rear + .32], { bevel: 0, tint: palette.stripe });
      this.beam([x, sill + .47, front - .14], [side * (xHalf + .14), sill + .47, front - .14], .018);
      this.box('metal_dark', [.075, .15, .17], [side * (xHalf + .14), sill + .47, front - .14], { bevel: .016 });
    }
    this.box('metal_dark', [xHalf * 1.72, .14, .25], [0, sill + .13, front - .14], { bevel: .02 });
    if (!options.openFront) this.box('glass', [xHalf * 1.88, (roof - sill) * .77, .008], [0, (roof + sill) / 2 + .07, front + .015], { bevel: 0, rotation: [.10, 0, 0], tint: C(0xffffff), weather: false });
  }
  hood(size, at, options = {}) { const origin = [at[0], at[1] + size[1] / 2, at[2] - size[2] / 2]; this.group('panel_hood', origin); this.box('paint', size, at, { group: 'panel_hood', bevel: .035, tint: options.tint || palette.paint }); for (const side of [-1, 1]) this.box('paint2', [.07, .014, size[2] * .75], [side * size[0] * .28, at[1] + size[1] / 2 + .008, at[2]], { group: 'panel_hood', bevel: 0, tint: palette.stripe }); }
  rustPatches(sideX, y, values) { for (const [z, length] of values) this.box('paint2', [.016, .08, length], [sideX, y, z], { bevel: 0, tint: palette.rust }); }
  finish() {
    for (const [name, data] of this.groups) for (const [key, pieces] of data.buckets) {
      const merged = mergeVertices(mergeGeometries(pieces, false), 1e-5); assert.ok(merged, `${this.id}/${name}/${key} merged geometry`);
      merged.computeBoundingBox(); merged.computeBoundingSphere(); const mesh = new THREE.Mesh(merged, materials[key]); mesh.name = name + '_' + key; data.node.add(mesh); for (const p of pieces) p.dispose();
    }
    this.root.updateMatrixWorld(true); return this.root;
  }
}

function barrelCarrier() {
  const m = new CarBuilder('e_barrel_carrier', 231), tint = C(0xabb09b); m.chassis(5.6, 1.88, .62, { tint });
  m.cab([.44, .62, 1], { xHalf: .88, rear: .32, front: 1.34, sill: .94, roof: 1.91 }, { tint }); m.hood([1.70, .35, 1.24], [0, 1.00, 2.03], { tint });
  for (const side of [-1, 1]) { m.box('paint', [.075, .34, 2.83], [side * .90, .88, -1.26], { tint }); m.box('metal_dark', [.08, .10, 2.94], [side * .97, 1.05, -1.25], { bevel: .012 }); m.rustPatches(side * .946, .92, [[-1.86, .38], [-.9, .24], [.55, .16]]); }
  m.box('paint', [1.90, .30, .08], [0, .83, -2.66], { tint }); m.box('metal_dark', [2.06, .16, .12], [0, .48, -2.74]); m.box('metal_dark', [2.06, .17, .12], [0, .52, 2.72]);
  for (const x of [-.47, .47]) {
    m.cylinder('paint2', [x, .74, -1.91], [x, 1.86, -1.91], .34, { segments: 16, tint: C(0x959c74) });
    for (const y of [.85, 1.16, 1.69, 1.84]) m.cylinder('metal_dark', [x, y - .025, -1.91], [x, y + .025, -1.91], .352, { segments: 16 });
    m.cylinder('metal_dark', [x + .12, 1.855, -1.91], [x + .12, 1.878, -1.91], .038, { segments: 8 });
    m.box('paint2', [.31, .21, .022], [x, 1.35, -2.255], { bevel: 0, tint: C(0xcab973) });
  }
  for (const side of [-1, 1]) { m.beam([side * .85, .66, -2.40], [side * .85, 2.09, -2.40], .055); m.beam([side * .85, .66, -1.32], [side * .85, 2.09, -1.32], .055); m.beam([side * .85, 2.09, -2.40], [side * .85, 2.09, -1.32], .055); }
  m.gunner([0, .92, -.75]); m.axle(.94, 1.65, .43); m.axle(.94, -1.65, .43); m.wheelSet(.94, 1.65, -1.65, .43, .32);
  m.lamps(2.735, -2.72, .69, .91); m.socket('weak_engine', [0, .99, 2.03]); m.socket('weak_fuel', [0, 1.15, -1.91]); m.socket('fuel_cap', [-.50, 1.87, -1.91]); m.socket('exhaust_R', [-.86, .48, -2.75]); m.socket('smoke_engine', [0, 1.12, 2.25]); m.socket('roof_top', [0, 2.10, -1.86]); return m;
}
function grenadier() {
  const m = new CarBuilder('e_grenadier', 317), tint = C(0xa5aea4); m.chassis(4.15, 1.52, .56, { tint }); m.seat([.4, .52, .25]);
  m.hood([1.41, .22, 1.07], [0, .85, 1.27], { tint }); m.box('paint', [1.56, .33, .55], [0, .75, -1.73], { tint });
  for (const side of [-1, 1]) {
    m.beam([side * .77, .58, -1.20], [side * .70, 1.87, -.35], .055); m.beam([side * .70, 1.87, -.35], [side * .72, 1.72, .75], .055); m.beam([side * .72, 1.72, .75], [side * .80, .67, 1.20], .055);
    m.beam([side * .78, .79, -.93], [side * .78, .79, .82], .06); m.box('paint2', [.06, .27, .61], [side * .79, .83, -.02], { rotation: [.07, 0, 0], tint: C(0xb29f72) });
    for (const z of [1.28, -1.2]) m.box('paint', [.23, .07, 1.02], [side * .88, .99, z], { bevel: .02, tint });
  }
  m.beam([-.70, 1.87, -.35], [.70, 1.87, -.35], .055); m.beam([-.72, 1.72, .75], [.72, 1.72, .75], .05);
  for (const side of [-1, 1]) for (const offset of [-.12, .12]) {
    const from = [side * .64 + offset, 1.09, -1.84], to = [side * .64 + offset, 1.46, -.86];
    m.cylinder('metal_dark', from, to, .102, { segments: 10, open: true }); m.cylinder('paint2', [from[0], 1.11, -1.80], [from[0], 1.125, -1.76], .116, { segments: 10, tint: C(0xbfa970) });
    m.socket(`rocket_pod_${side > 0 ? 'L' : 'R'}_${offset > 0 ? '2' : '1'}`, to);
  }
  m.box('metal_dark', [1.83, .17, .12], [0, .48, 2.005]); m.box('metal_dark', [1.80, .15, .10], [0, .46, -2.00]);
  m.gunner([0, .84, -.7], 1, false); m.axle(.96, 1.28, .43); m.axle(.96, -1.2, .43); m.wheelSet(.96, 1.28, -1.2, .43, .26);
  m.lamps(2.014, -1.992, .58, .80); m.socket('weak_engine', [0, .80, 1.35]); m.socket('weak_fuel', [0, .67, -1.72]); m.socket('fuel_cap', [-.76, .86, -1.69]); m.socket('exhaust_R', [-.65, .46, -2.03]); m.socket('smoke_engine', [0, 1.02, 1.40]); m.socket('roof_top', [0, 1.9, -.34]); return m;
}
function armored() {
  const m = new CarBuilder('e_armored', 431), tint = C(0x929991); m.chassis(5.7, 2.10, .76, { tint });
  m.cab([.44, .75, 1], { xHalf: .98, rear: .22, front: 1.48, sill: 1.14, roof: 2.16 }, { tint, openFront: true }); m.hood([1.98, .48, 1.09], [0, 1.16, 2.17], { tint });
  for (const side of [-1, 1]) {
    m.box('paint', [.13, .51, 3.87], [side * 1.00, 1.11, -.66], { bevel: .045, tint });
    m.box('paint2', [.045, .70, 1.30], [side * 1.08, 1.31, -1.46], { rotation: [0, 0, side * -.11], tint: C(0x737c72) });
    for (const z of [-2.23, -1.66, -.91, .49, 1.25]) m.box('metal_dark', [.038, .12, .12], [side * 1.117, 1.48, z], { bevel: 0 });
    m.box('paint', [.18, .12, 1.24], [side * 1.045, 1.30, 1.75], { bevel: .035, tint }); m.box('paint', [.18, .12, 1.24], [side * 1.045, 1.30, -1.75], { bevel: .035, tint });
    m.rustPatches(side * 1.10, 1.04, [[-1.83, .31], [-.91, .24], [.81, .27]]);
  }
  // Actual slit windshield, plate chevrons and roof firing well. The crew is
  // not hidden behind a giant opaque cuboid pretending to be a full cabin.
  for (const side of [-1, 1]) m.box('paint', [.77, .39, .10], [side * .56, 1.60, 1.49], { rotation: [.13, 0, 0], tint });
  m.box('paint', [.13, .60, .10], [0, 1.70, 1.49], { tint }); m.box('paint2', [1.96, .12, .11], [0, 2.08, 1.49], { tint: palette.stripe });
  m.box('paint', [2.06, .12, .90], [0, 1.28, -2.04], { tint }); m.gunner([0, 1.28, -.45]);
  for (const side of [-1, 1]) m.beam([side * .50, 1.32, -.94], [side * .50, 2.44, -.94], .05);
  m.beam([-.50, 2.44, -.94], [.50, 2.44, -.94], .05);
  m.box('metal_dark', [2.18, .19, .13], [0, .61, 2.77]); m.box('metal_dark', [2.18, .19, .13], [0, .60, -2.77]);
  m.group('part_reactor', [0, 1.10, -2.72]); m.box('metal_dark', [1.10, .85, .30], [0, 1.13, -2.60], { group: 'part_reactor', bevel: .045 });
  m.box('light_tail', [.76, .53, .033], [0, 1.12, -2.944], { group: 'part_reactor', bevel: .014, tint: C(0xffffff), weather: false });
  for (const x of [-.39, -.13, .13, .39]) m.box('metal_dark', [.045, .67, .045], [x, 1.12, -2.935], { group: 'part_reactor', bevel: 0 });
  for (const side of [-1, 1]) m.box('metal_dark', [.10, .73, .34], [side * .50, 1.12, -2.79], { group: 'part_reactor', bevel: .025 });
  for (const side of [-1, 1]) m.cylinder('metal_dark', [side * .55, .95, -2.63], [side * .69, 1.48, -2.36], .047, { group: 'part_reactor', segments: 8 });
  m.axle(1.0, 1.75, .44); m.axle(1.0, -1.75, .44); m.wheelSet(1.0, 1.75, -1.75, .44, .35);
  m.lamps(2.790, -2.77, .78, 1.04); m.socket('weak_engine', [0, 1.18, 2.08]); m.socket('weak_fuel', [0, 1.1, -2.72]); m.socket('fuel_cap', [0, 1.39, -2.948]); m.socket('exhaust_R', [-.94, .58, -2.79]); m.socket('smoke_engine', [0, 1.4, 2.16]); m.socket('roof_top', [0, 2.49, -.94]); return m;
}
function monster() {
  const m = new CarBuilder('e_monster', 557), tint = C(0xa99584); m.chassis(5.6, 1.55, 1.27, { tint });
  m.cab([.46, 1.27, .7], { xHalf: .73, rear: -.21, front: 1.12, sill: 1.55, roof: 2.60 }, { tint }); m.hood([1.43, .38, 1.19], [0, 1.69, 1.87], { tint });
  m.box('paint', [1.56, .35, 1.87], [0, 1.46, -1.67], { tint });
  for (const side of [-1, 1]) {
    m.box('paint', [.08, .43, 1.72], [side * .77, 1.65, -1.58], { tint });
    for (const z of [1.67, -1.67]) {
      m.axle(1.18, z, .82); m.beam([side * .57, 1.30, z + .20], [side * 1.10, .83, z + .15], .065);
      m.cylinder('paint2', [side * .63, 1.24, z - .17], [side * 1.09, .86, z - .15], .045, { tint: C(0xaaa76f), segments: 8 });
      m.box('paint', [.47, .095, 1.81], [side * 1.425, 1.73, z], { bevel: .025, tint });
      m.box('metal_dark', [.035, .18, 1.81], [side * 1.6425, 1.67, z], { bevel: .008 });
    }
    m.cylinder('metal_dark', [side * .59, 1.25, -.35], [side * .59, 2.84, -.35], .068, { segments: 10 });
    m.cylinder('metal_dark', [side * .59, 2.78, -.35], [side * .59, 2.87, -.35], .09, { segments: 10 });
    m.beam([side * .66, 1.56, -2.24], [side * .56, 2.61, -.17], .055);
  }
  m.box('metal_dark', [2.06, .21, .15], [0, 1.00, 2.70]);
  for (const x of [-.75, -.38, 0, .38, .75]) m.cylinder('metal_dark', [x, 1.07, 2.70], [x, 1.23, 2.775], .07, { topRadius: 0, segments: 5 });
  m.box('metal_dark', [1.90, .18, .13], [0, 1.05, -2.72]); m.wheelSet(1.18, 1.67, -1.67, .82, .75, true);
  m.lamps(2.724, -2.736, .59, 1.48); m.socket('weak_engine', [0, 1.65, 1.93]); m.socket('weak_fuel', [0, 1.37, -2.21]); m.socket('fuel_cap', [-.76, 1.66, -1.93]); m.socket('exhaust_R', [-.59, 2.87, -.35]); m.socket('smoke_engine', [0, 1.91, 1.94]); m.socket('roof_top', [0, 2.90, -.35]); return m;
}
function lightTank() {
  const m = new CarBuilder('e_light_tank', 683), tint = C(0x979d83); m.chassis(5.8, 2.23, 1.02, { tint });
  m.box('paint', [2.23, .53, 5.45], [0, 1.10, 0], { bevel: .09, tint }); m.hood([2.04, .28, 1.42], [0, 1.46, 1.94], { tint });
  m.seat([.4, 1.02, 1.9]); m.box('paint', [1.1, .13, .64], [.24, 1.59, 1.48], { bevel: .035, tint });
  for (const side of [-1, 1]) {
    // Continuous steel track outline. Each side has a real open inner loop,
    // road-wheel hubs and distinct individual treads rather than a solid slab.
    const x = side * 1.18, outer = [[-2.73, .35], [-2.36, .085], [2.30, .085], [2.74, .42], [2.74, .90], [2.40, 1.20], [-2.37, 1.20], [-2.73, .91]];
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length], from = [x, a[1], a[0]], to = [x, b[1], b[0]], length = Math.hypot(a[0] - b[0], a[1] - b[1]), count = Math.max(2, Math.ceil(length / .30));
      m.beam(from, to, .66, { depth: .17, material: 'metal_dark', bevel: 0, tint: palette.black });
      for (let k = 0; k < count; k++) { const t = (k + .5) / count, z = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, angle = Math.atan2(b[1] - a[1], b[0] - a[0]); m.box('metal_dark', [.66, .048, .09], [x, y, z], { bevel: 0, rotation: [-angle, 0, 0], tint: C(0x717b77) }); }
    }
    for (const z of [-.92, .04, .99]) m.cylinder('metal_dark', [side * .87, .58, z], [side * 1.38, .58, z], .40, { segments: 10, tint: C(0x656e68) });
    m.box('paint', [.63, .14, 5.13], [side * 1.17, 1.32, -.01], { bevel: .04, tint });
    m.box('paint2', [.015, .18, .68], [side * 1.493, 1.09, -.14], { bevel: 0, tint: C(0xb6ad6c) });
  }
  m.group('part_turret', [0, 1.42, -.20]);
  const turretRing = new THREE.TorusGeometry(.72, .065, 6, 16); m.add('metal_dark', turretRing, [0, 1.42, -.20], [Math.PI / 2, 0, 0], palette.hardware, 'part_turret');
  // Hollow side/front/rear plates leave an actual open hatch around the crew
  // socket. A solid turret cuboid would bury the standing gunner's torso.
  for (const side of [-1, 1]) m.box('paint', [.48, .69, 1.67], [side * .68, 1.81, -.20], { group: 'part_turret', bevel: .07, tint });
  m.box('paint', [.94, .69, .32], [0, 1.81, .475], { group: 'part_turret', bevel: .065, tint });
  m.box('paint', [.94, .69, .32], [0, 1.81, -.875], { group: 'part_turret', bevel: .065, tint });
  for (const side of [-1, 1]) m.box('paint', [.38, .18, 1.19], [side * .50, 2.20, -.18], { group: 'part_turret', bevel: .04, tint });
  m.box('paint2', [.38, .055, .49], [.50, 2.325, -.20], { group: 'part_turret', bevel: .025, tint: C(0x76816f) });
  m.box('paint2', [.065, .18, .40], [.65, 2.46, -.61], { group: 'part_turret', bevel: .012, tint: C(0x76816f) });
  m.cylinder('metal_dark', [0, 1.95, .60], [0, 1.95, 3.37], .096, { group: 'part_turret', segments: 12, open: true });
  m.cylinder('paint', [0, 1.95, .62], [0, 1.95, 1.17], .17, { group: 'part_turret', segments: 12, tint });
  // Split muzzle brake leaves a central open bore instead of a solid endcap.
  for (const side of [-1, 1]) m.box('metal_dark', [.07, .21, .32], [side * .105, 1.95, 3.54], { group: 'part_turret', bevel: .018 });
  m.box('metal_dark', [.21, .045, .32], [0, 2.035, 3.54], { group: 'part_turret', bevel: .009 });
  m.box('metal_dark', [.21, .045, .32], [0, 1.865, 3.54], { group: 'part_turret', bevel: .009 });
  m.cylinder('metal_dark', [0, 1.95, 3.67], [0, 1.95, 3.70], .092, { group: 'part_turret', segments: 10, open: true, tint: C(0x282d30) });
  m.socket('turret_main', [0, 1.42, -.20]); m.socket('muzzle_cannon', [0, 1.95, 3.70]);
  m.group('part_reactor', [0, 1.65, -1.36]); m.box('metal_dark', [1.01, .66, .33], [0, 1.70, -1.40], { group: 'part_reactor', bevel: .04 });
  m.box('light_tail', [.78, .40, .026], [0, 1.67, -1.578], { group: 'part_reactor', bevel: .012, weather: false, tint: C(0xffffff) });
  for (const x of [-.42, -.14, .14, .42]) m.box('metal_dark', [.038, .55, .035], [x, 1.67, -1.562], { group: 'part_reactor', bevel: 0 });
  m.box('metal_dark', [2.34, .13, .11], [0, .72, -2.845]); m.wheelSet(1.12, 1.86, -1.86, .55, .65, false, true); m.gunner([0, 1.08, -.25], 1, false);
  m.lamps(2.85, -2.85, .86, 1.05); m.socket('weak_engine', [0, 1.09, -2.07]); m.socket('weak_fuel', [0, 1.65, -1.36]); m.socket('fuel_cap', [.44, 1.68, -1.35]); m.socket('exhaust_R', [-.84, 1.06, -2.85]); m.socket('smoke_engine', [0, 1.38, -2.10]); m.socket('roof_top', [0, 2.40, -.2]); return m;
}
function warwagon() {
  const m = new CarBuilder('e_warwagon', 797), tint = C(0xb0a694); m.chassis(6.5, 2.26, .75, { tint });
  m.cab([.48, .72, 1.65], { xHalf: 1.02, rear: .94, front: 2.18, sill: 1.10, roof: 2.12 }, { tint }); m.hood([1.93, .31, .87], [0, 1.09, 2.70], { tint });
  for (const side of [-1, 1]) {
    m.box('paint', [.12, .39, 3.92], [side * 1.10, 1.00, -1.19], { bevel: .025, tint });
    m.box('metal_dark', [.08, .09, 4.03], [side * 1.17, 1.23, -1.19], { bevel: .01 });
    for (const z of [-1.75, -.10]) {
      const x = side * .67; m.gunner([x, .94, z], z === -.10 ? side > 0 ? 1 : 2 : side > 0 ? 3 : 4, false);
      m.box('paint2', [.43, .53, .07], [x, 1.48, z + .39], { bevel: .035, tint: C(0x928c75) });
      // Runtime gives these four crew members independently aimed guns. Keep
      // a real support pedestal and shield, without a second fixed gun mesh.
      m.cylinder('metal_dark', [x, .98, z + .35], [x, 1.72, z + .35], .047, { segments: 8 });
      m.box('metal_dark', [.22, .065, .20], [x, 1.735, z + .35], { bevel: .012 });
      m.box('paint2', [.20, .17, .28], [x + side * .16, 1.35, z + .03], { bevel: .015, tint: C(0x929976) });
    }
    for (const z of [2.02, -2.02]) m.box('paint', [.28, .11, 1.33], [side * 1.18, 1.04, z], { bevel: .025, tint });
    m.rustPatches(side * 1.168, .91, [[-2.11, .31], [-1.15, .19], [-.14, .29]]);
  }
  m.beam([-.99, .82, -3.05], [-.92, 2.38, -2.66], .05); m.beam([.99, .82, -3.05], [.92, 2.38, -2.66], .05); m.beam([-.92, 2.38, -2.66], [.92, 2.38, -2.66], .05);
  m.box('paint', [2.26, .41, .095], [0, .98, -3.05], { tint }); m.group('panel_trunk', [0, 1.23, -3.099]); m.box('paint2', [1.32, .36, .055], [0, 1.02, -3.11], { group: 'panel_trunk', bevel: .025, tint: C(0x918771) });
  m.box('metal_dark', [2.38, .19, .13], [0, .59, 3.165]); m.box('metal_dark', [2.38, .19, .13], [0, .57, -3.17]);
  m.axle(1.11, 2.02, .47); m.axle(1.11, -2.02, .47); m.wheelSet(1.11, 2.02, -2.02, .47, .43);
  m.lamps(3.179, -3.17, .83, 1.02); m.socket('weak_engine', [0, 1.02, 2.64]); m.socket('weak_fuel', [0, .84, -2.73]); m.socket('fuel_cap', [-1.17, .97, -2.66]); m.socket('exhaust_R', [-.92, .58, -3.17]); m.socket('smoke_engine', [0, 1.25, 2.67]); m.socket('roof_top', [0, 2.40, -2.66]); return m;
}

function metadata(builder) {
  const root = builder.root; root.updateMatrixWorld(true); const bbox = new THREE.Box3().setFromObject(root), sockets = {}, wheels = {}, parts = {};
  const round = values => values.map(n => +n.toFixed(4));
  for (const [name, position] of Object.entries(builder.sockets)) sockets[name] = round(position);
  for (const [name, node] of Object.entries(builder.wheels)) { const box = new THREE.Box3().setFromObject(node), p = node.getWorldPosition(new THREE.Vector3()); wheels[name] = { x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4), r: +((box.max.y - box.min.y) / 2).toFixed(4), w: +(box.max.x - box.min.x).toFixed(4) }; }
  for (const [name, data] of builder.groups) if (/^(part_|panel_|weak_)/.test(name)) { const box = new THREE.Box3().setFromObject(data.node); if (!box.isEmpty()) parts[name] = { min: round(box.min.toArray()), max: round(box.max.toArray()) }; }
  return { id: builder.id, wheels, sockets, parts, bbox: { min: round(bbox.min.toArray()), max: round(bbox.max.toArray()) }, bodyWidth: +(bbox.max.x - bbox.min.x).toFixed(4) };
}
function patchSharedPbr(arrayBuffer) {
  const raw = Buffer.from(arrayBuffer), jsonLength = raw.readUInt32LE(12), json = JSON.parse(raw.subarray(20, 20 + jsonLength).toString('utf8'));
  const binOffset = 20 + jsonLength, binLength = raw.readUInt32LE(binOffset), binary = raw.subarray(binOffset + 8, binOffset + 8 + binLength);
  assert.equal(json.images?.length || 0, 0, 'Exporter must not introduce embedded or private images');
  json.images = MAPS.map(uri => ({ uri })); json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]; json.textures = MAPS.map((_, source) => ({ source, sampler: 0 }));
  for (const material of json.materials) if (['paint', 'paint2', 'metal_dark', 'rim'].includes(material.name)) {
    material.pbrMetallicRoughness.baseColorTexture = { index: 0, texCoord: 0 };
    material.pbrMetallicRoughness.metallicRoughnessTexture = { index: 2, texCoord: 0 };
    material.normalTexture = { index: 1, texCoord: 0, scale: .35 }; material.occlusionTexture = { index: 2, texCoord: 0, strength: .55 };
  }
  json.asset.generator = 'Ride or Die independently authored stage-raider chassis v4';
  json.asset.extras = { orientation: '+X left +Y up +Z forward', texturePolicy: 'existing shared rust_metal PBR maps; no duplicated embedded textures', source: SOURCE };
  const text = Buffer.from(JSON.stringify(json)), padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]), bin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]), result = Buffer.alloc(12 + 8 + padded.length + 8 + bin.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8); result.writeUInt32LE(padded.length, 12); result.writeUInt32LE(0x4e4f534a, 16); padded.copy(result, 20);
  const at = 20 + padded.length; result.writeUInt32LE(bin.length, at); result.writeUInt32LE(0x004e4942, at + 4); bin.copy(result, at + 8); return { bytes: result, json };
}
function inventory(json) {
  let triangles = 0, vertices = 0, primitives = 0, expandedDrawPrimitives = 0, expandedTriangles = 0;
  for (const mesh of json.meshes || []) for (const primitive of mesh.primitives) { primitives++; vertices += json.accessors[primitive.attributes.POSITION].count; triangles += (primitive.indices === undefined ? json.accessors[primitive.attributes.POSITION].count : json.accessors[primitive.indices].count) / 3; }
  const roots = json.nodes.filter(node => /^wheel_(?:FL|FR|RL|RR)$/.test(node.name || ''));
  assert.equal(roots.length, 4); assert.ok(json.nodes.some(node => node.name === 'body')); assert.ok(json.nodes.some(node => node.name === 'panel_hood'));
  for (const node of json.nodes) if (node.mesh !== undefined) for (const primitive of json.meshes[node.mesh].primitives) { expandedDrawPrimitives++; expandedTriangles += (primitive.indices === undefined ? json.accessors[primitive.attributes.POSITION].count : json.accessors[primitive.indices].count) / 3; }
  assert.ok(expandedDrawPrimitives <= 24, `At most 24 visible draw primitives per chassis, found ${expandedDrawPrimitives}`);
  return { triangles, vertices, uniqueMeshPrimitives: primitives, expandedDrawPrimitives, expandedTriangles, gltfNodes: json.nodes.length, movingWheels: roots.map(node => node.name), materials: json.materials.map(material => material.name), sharedTextureUris: json.images.map(image => image.uri) };
}

await mkdir(MODEL_DIR, { recursive: true });
const allMetadata = {}, report = { schema: 1, authoringVersion: 4, startedAt: new Date().toISOString(), source: SOURCE, passed: false, maps: MAPS, maxGlbBytes: 300000, maxExpandedDrawPrimitives: 24, models: [], scope: 'Authored geometry/export contract, not native visual or gameplay acceptance. No existing vehicle mesh reused; only standard primitive geometry and existing terrain PBR maps are shared.' };
try {
  for (const build of [barrelCarrier, grenadier, armored, monster, lightTank, warwagon]) {
    const builder = build(), root = builder.finish(), info = metadata(builder);
    assert.ok(ID_LIST.includes(builder.id)); assert.ok(info.bbox.max.every(Number.isFinite) && info.bbox.min.every(Number.isFinite)); assert.ok(info.sockets.seat_driver && info.sockets.weak_engine && info.sockets.weak_fuel);
    assert.deepEqual(Object.keys(info.wheels), ['FL', 'FR', 'RL', 'RR']);
    if (builder.id === 'e_warwagon') for (const name of ['seat_gunner', 'seat_gunner2', 'seat_gunner3', 'seat_gunner4', 'gun_mount', 'gun_mount2', 'gun_mount3', 'gun_mount4']) assert.ok(info.sockets[name], `Four-station wagon requires ${name}`);
    if (builder.id === 'e_armored') assert.deepEqual(info.sockets.weak_fuel, [0, 1.1, -2.72]);
    if (builder.id === 'e_light_tank') assert.deepEqual(info.sockets.weak_fuel, [0, 1.65, -1.36]);
    const arrayBuffer = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, trs: true, includeCustomExtensions: false });
    const asset = patchSharedPbr(arrayBuffer), contract = inventory(asset.json); assert.ok(asset.bytes.length <= report.maxGlbBytes, `${builder.id} ${asset.bytes.length} exceeds the standalone 300 KB budget`);
    const output = path.join(MODEL_DIR, `${builder.id}.glb`); assert.ok(path.dirname(output) === MODEL_DIR); await writeFile(output, asset.bytes); allMetadata[builder.id] = info;
    const row = { id: builder.id, output: path.relative(ROOT, output).replaceAll('\\', '/'), bytes: asset.bytes.length, bbox: info.bbox, wheels: info.wheels, seats: Object.fromEntries(Object.entries(info.sockets).filter(([name]) => name.startsWith('seat_'))), ...contract };
    report.models.push(row); console.log(JSON.stringify(row));
    const resources = new Set(); root.traverse(node => { if (node.isMesh) resources.add(node.geometry); }); for (const resource of resources) resource.dispose();
  }
  assert.equal(report.models.length, 6); await writeFile(META, JSON.stringify(allMetadata, null, 2) + '\n'); report.passed = true;
} catch (error) { report.failure = String(error.stack || error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(REPORT, JSON.stringify(report, null, 2) + '\n'); }

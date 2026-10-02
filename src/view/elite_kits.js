// Raider dress-up built from primitives on top of the vehicle GLBs (used by view/car_view.js):
//  - warlord kits (minibosses): unique silhouettes — plows/jaws, cages, stacks, horns, bell tower, flags, beacons — plus a
//    pulsing WEAK POINT marker placed over the damage zone that takes x5 (data/boss.js `weak`), and a nameplate + HP bar
//  - the gunless rammer (e_muscle) always wears a spiked ram bar, so "that one will ram you" reads at a glance
//  - the gunner wind-up glint (screen-space flare at the muzzle while a raider shoulders his gun = your cue to jink)
// Model frame: ground origin, +Z forward, +X left. Everything is parented to the CarView root (visible in the far LOD too).
import * as THREE from 'three';
import { ELITE_BOSSES as MINIBOSSES } from '../data/boss.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(0.5, 1, 8);                 // apex +Y
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const SPH = new THREE.SphereGeometry(0.5, 12, 8);
const TORUS = new THREE.TorusGeometry(0.5, 0.09, 8, 20);

const MATS = {};
const std = (key, o) => MATS[key] || (MATS[key] = new THREE.MeshStandardMaterial(o));
const M = {
  steel: () => std('steel', { color: 0x2c2c30, metalness: 0.75, roughness: 0.42 }),
  dark: () => std('dark', { color: 0x161616, metalness: 0.5, roughness: 0.6 }),
  rust: () => std('rust', { color: 0x6e3a1e, metalness: 0.35, roughness: 0.8 }),
  chrome: () => std('chrome', { color: 0xdadada, metalness: 1, roughness: 0.22 }),
  bone: () => std('bone', { color: 0xe6dcc4, metalness: 0.05, roughness: 0.55 }),
  spike: () => std('spike', { color: 0xb9b2a2, metalness: 0.7, roughness: 0.3 }),
  gold: () => std('gold', { color: 0xc89a34, metalness: 0.9, roughness: 0.3 }),
  hazard: () => std('hazard', { color: 0xf0b418, metalness: 0.2, roughness: 0.6 }),
};

function add(parent, geo, mat, p, s, r, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p[0], p[1], p[2]); if (s) m.scale.set(s[0], s[1], s[2]); if (r) m.rotation.set(r[0], r[1], r[2]);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m); return m;
}
/** Merge the static child meshes of `group` that share a material into one mesh per material (draw calls: ~30 -> ~6). */
function bake(group, keep) {
  const byMat = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || (keep && keep.has(child))) continue;
    child.updateMatrix();
    const geo = child.geometry.index ? child.geometry.clone() : child.geometry.clone();
    geo.applyMatrix4(child.matrix);
    let e = byMat.get(child.material); if (!e) byMat.set(child.material, (e = { geos: [], shadow: false }));
    e.geos.push(geo); e.shadow = e.shadow || child.castShadow;
    group.remove(child);
  }
  for (const [mat, e] of byMat) {
    const merged = mergeGeometries(e.geos, false);
    for (const g of e.geos) g.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat); m.castShadow = e.shadow; m.receiveShadow = true; m.userData.baked = true;
    group.add(m);
  }
  return group;
}

/** A spike pointing along +Z (forward) from its base. */
const spikeFwd = (g, mat, x, y, z, len = 0.5, rad = 0.13) => add(g, CONE, mat, [x, y, z + len / 2], [rad, len, rad], [Math.PI / 2, 0, 0], false);
/** A pole with a waving cloth (canvas emblem). Returns the cloth mesh (animated by waveFlags). */
function flag(g, x, z, y0, h, tex, w = 1.0, fh = 0.62) {
  add(g, CYL6, M.dark(), [x, y0 + h / 2, z], [0.05, h, 0.05], null, false);
  const geo = new THREE.PlaneGeometry(w, fh, 8, 3); geo.translate(-w / 2, 0, 0);
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 }));
  cloth.position.set(x, y0 + h - fh / 2 - 0.05, z); cloth.rotation.y = -Math.PI / 2; // streams backwards
  cloth.userData.base = geo.attributes.position.array.slice();
  g.add(cloth); return cloth;
}

// ------------------------------------------------------------------------------------------------ emblems (canvas)
const TEX = {};
function emblem(key, bg, fg, draw) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas'); c.width = 128; c.height = 80;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 128, 80);
  x.fillStyle = fg; x.strokeStyle = fg; x.lineWidth = 7; x.lineCap = 'round';
  draw(x);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (TEX[key] = t);
}
const skull = (x) => {
  x.beginPath(); x.arc(64, 34, 18, 0, Math.PI * 2); x.fill(); x.fillRect(52, 44, 24, 14);
  x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(57, 34, 5, 0, 7); x.arc(71, 34, 5, 0, 7); x.fill(); x.fillRect(58, 50, 3, 8); x.fillRect(67, 50, 3, 8);
  x.globalCompositeOperation = 'source-over'; x.beginPath(); x.moveTo(28, 64); x.lineTo(100, 12); x.moveTo(28, 12); x.lineTo(100, 64); x.globalAlpha = 0.9; x.stroke(); x.globalAlpha = 1;
};
const flame = (x) => { x.beginPath(); x.moveTo(20, 70); x.bezierCurveTo(30, 20, 55, 40, 60, 8); x.bezierCurveTo(70, 35, 95, 30, 108, 70); x.closePath(); x.fill(); };
const cross = (x) => { x.fillRect(58, 8, 12, 64); x.fillRect(38, 24, 52, 11); x.beginPath(); x.arc(64, 30, 20, 0, 7); x.lineWidth = 5; x.stroke(); };
const heart = (x) => { x.beginPath(); x.moveTo(64, 70); x.bezierCurveTo(10, 36, 30, 4, 64, 26); x.bezierCurveTo(98, 4, 118, 36, 64, 70); x.fill(); };
const horns = (x) => { x.beginPath(); x.arc(64, 44, 14, 0, 7); x.fill(); x.lineWidth = 8; x.beginPath(); x.moveTo(52, 38); x.quadraticCurveTo(30, 30, 26, 8); x.moveTo(76, 38); x.quadraticCurveTo(98, 30, 102, 8); x.stroke(); };

// ------------------------------------------------------------------------------------------------ shared pieces
function frame(spec) {
  const bb = spec.model?.bbox || { min: [-spec.width / 2, 0, -spec.length / 2], max: [spec.width / 2, spec.height, spec.length / 2] };
  const S = spec.model?.sockets || {};
  return { bb, S, W: bb.max[0] - bb.min[0], front: bb.max[2], rear: bb.min[2], top: bb.max[1], roof: S.roof_top || [0, bb.max[1], 0], hood: S.camera_hood || [0, bb.max[1] * 0.55, bb.max[2] - 1.0] };
}

const RAMBAR = new Map();
/** Spiked ram bar across the nose (rammers, twins, blaze): built once per vehicle type, merged, shared by every car. */
export function ramBar(g, spec, big = false) {
  const key = spec.id + (big ? ':big' : '');
  let proto = RAMBAR.get(key);
  if (!proto) { proto = new THREE.Group(); buildRamBar(proto, spec, big); bake(proto); RAMBAR.set(key, proto); }
  for (const m of proto.children) { const c = new THREE.Mesh(m.geometry, m.material); c.castShadow = m.castShadow; c.receiveShadow = true; c.userData.shared = true; g.add(c); }
}
function buildRamBar(g, spec, big) {
  const f = frame(spec), w = f.W * (big ? 1.08 : 1.0), z = f.front + 0.06;
  add(g, BOX, M.steel(), [0, 0.5, z], [w, 0.2, 0.16]);
  add(g, BOX, M.steel(), [0, 0.74, z - 0.08], [w * 0.92, 0.3, 0.07], [-0.4, 0, 0]);
  for (const x of [-0.42, 0.42]) add(g, BOX, M.dark(), [x * f.W, 0.62, z - 0.2], [0.09, 0.36, 0.5], [0.35, 0, 0], false);
  const n = big ? 7 : 5;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1) - 0.5) * w * 0.9; spikeFwd(g, M.spike(), x, 0.5, z + 0.05, big ? 0.62 : 0.48, big ? 0.15 : 0.12); }
}

// ------------------------------------------------------------------------------------------------ warlord kits
// each returns { weak: Object3D (pulsing marker, glow material), spin?: Object3D, flags: [cloth] }
const KITS = {
  scrapjaw(g, spec, look) {
    const f = frame(spec), glow = glowMat(look.glow);
    // the JAW: a toothed scoop over the nose
    const z = f.front + 0.1;
    add(g, BOX, M.hazard(), [0, 0.55, z], [f.W * 1.12, 0.46, 0.14], [-0.25, 0, 0]);
    add(g, BOX, M.steel(), [0, 1.02, z - 0.35], [f.W * 1.02, 0.12, 0.8], [0.35, 0, 0]);
    for (let i = 0; i < 7; i++) { const x = (i / 6 - 0.5) * f.W * 1.0; add(g, CONE, M.bone(), [x, 0.3, z + 0.14], [0.16, 0.42, 0.16], [Math.PI, 0, 0], false); add(g, CONE, M.bone(), [x + 0.08, 0.84, z + 0.12], [0.13, 0.34, 0.13], [0, 0, 0], false); }
    // roll cage over the bed + a war-flag
    const sz = f.S.seat_gunner ? f.S.seat_gunner[2] : f.rear * 0.5;
    const deckY = f.S.seat_gunner?.[1] ?? 0.95, cageY = deckY + 1.85;
    for (const x of [-0.46, 0.46]) { add(g, CYL, M.steel(), [x * f.W, deckY + 0.85, sz + 0.55], [0.08, 2.0, 0.08]); add(g, CYL, M.steel(), [x * f.W, deckY + 0.85, sz - 0.8], [0.08, 2.0, 0.08]); add(g, CYL, M.steel(), [x * f.W, cageY, sz - 0.12], [0.07, 1.4, 0.07], [Math.PI / 2, 0, 0]); }
    add(g, CYL, M.steel(), [0, cageY, sz + 0.55], [0.07, f.W * 0.92, 0.07], [0, 0, Math.PI / 2]);
    const flags = [flag(g, -0.46 * f.W, sz - 0.8, cageY - 0.05, 1.9, emblem('scrap', '#141414', '#f0b418', skull), 1.1, 0.7)];
    // rotating beacon on the cab roof
    const bz = f.roof[2] + 0.2;
    add(g, CYL, M.dark(), [0, f.roof[1] + 0.06, bz], [0.3, 0.12, 0.3]);
    const spin = new THREE.Group(); spin.position.set(0, f.roof[1] + 0.26, bz); g.add(spin);
    add(spin, BOX, glow, [0.12, 0, 0], [0.18, 0.22, 0.26], null, false); add(spin, BOX, M.dark(), [-0.12, 0, 0], [0.18, 0.22, 0.26], null, false);
    // weak point: the glowing ammo crates bolted over the tailgate
    // Match buildZones(spec)'s heavy rear fuel box and Mother Trucker's marker.
    const weak = new THREE.Group(); weak.position.set(0, 1.0, f.rear + 0.3); g.add(weak);
    add(weak, BOX, M.rust(), [0, 0, 0], [f.W * 0.8, 0.5, 0.42]);
    for (const x of [-0.3, 0, 0.3]) add(weak, BOX, glow, [x * f.W, 0.02, -0.22], [f.W * 0.22, 0.2, 0.04], null, false);
    add(weak, BOX, glow, [0, 0.27, 0], [f.W * 0.78, 0.04, 0.4], null, false);
    return { weak, spin, flags, glow };
  },
  twins(g, spec, look) {
    const f = frame(spec), glow = glowMat(look.glow);
    ramBar(g, spec, true);
    // bull horns on the roof
    for (const s of [-1, 1]) {
      const h = add(g, CONE, M.bone(), [s * 0.55, f.roof[1] + 0.35, f.roof[2] + 0.1], [0.2, 0.95, 0.2], [0.35, 0, -s * 0.95], true);
      h.userData.horn = true;
    }
    // side spikes
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const z = f.rear + 0.9 + i * (f.front - f.rear - 1.8) / 3; add(g, CONE, M.spike(), [s * (f.W / 2 + 0.2), 0.62, z], [0.1, 0.42, 0.1], [0, 0, -s * Math.PI / 2], false); }
    // weak point: the supercharger punching through the hood, glowing intake
    const weak = new THREE.Group(); weak.position.set(0, f.hood[1] + 0.1, f.front - 1.05); g.add(weak);
    add(weak, BOX, M.chrome(), [0, 0.1, 0], [0.62, 0.3, 0.7]);
    for (const x of [-0.16, 0.16]) { add(weak, CYL, M.chrome(), [x, 0.42, 0.05], [0.2, 0.34, 0.2]); add(weak, CYL, glow, [x, 0.6, 0.05], [0.17, 0.04, 0.17], null, false); }
    add(weak, BOX, glow, [0, 0.12, 0.36], [0.5, 0.18, 0.04], null, false);
    // flames out of the side pipes
    for (const s of [-1, 1]) add(g, CONE, glow, [s * (f.W / 2 + 0.06), 0.35, f.rear + 0.9], [0.12, 0.5, 0.12], [-Math.PI / 2, 0, 0], false);
    return { weak, flags: [], glow };
  },
  mother(g, spec, look) {
    const f = frame(spec), glow = glowMat(look.glow);
    // cow-catcher
    const z = f.front + 0.1;
    for (let i = 0; i < 9; i++) { const x = (i / 8 - 0.5) * f.W * 1.02; add(g, BOX, M.chrome(), [x, 0.7, z + 0.25 - Math.abs(x) * 0.35], [0.07, 1.0, 0.07], [0.45, 0, 0], false); }
    add(g, BOX, M.chrome(), [0, 1.15, z + 0.05], [f.W * 1.04, 0.1, 0.1]); add(g, BOX, M.chrome(), [0, 0.28, z + 0.45], [f.W * 1.04, 0.1, 0.1]);
    // twin smoke stacks with hot tips + flags
    const sz = (f.S.seat_driver ? f.S.seat_driver[2] : f.front - 2.2) - 1.05;
    const flags = [];
    for (const s of [-1, 1]) {
      add(g, CYL, M.chrome(), [s * f.W * 0.47, 2.9, sz], [0.24, 3.2, 0.24]);
      add(g, CYL, glow, [s * f.W * 0.47, 4.52, sz], [0.26, 0.08, 0.26], null, false);
      flags.push(flag(g, s * f.W * 0.47, sz - 0.05, 3.4, 2.0, emblem('mother', '#8e1f6e', '#ffd6f0', heart), 1.2, 0.7));
    }
    // floodlight bar on the cab roof
    add(g, BOX, M.dark(), [0, f.roof[1] + 0.12, f.roof[2] + 0.6], [f.W * 0.8, 0.12, 0.12]);
    for (const x of [-0.3, -0.1, 0.1, 0.3]) add(g, BOX, glowMat(0xfff2cc, 'flood'), [x * f.W, f.roof[1] + 0.26, f.roof[2] + 0.62], [0.2, 0.16, 0.06], null, false);
    // side armour
    for (const s of [-1, 1]) add(g, BOX, M.steel(), [s * (f.W / 2 + 0.04), 1.2, (f.front + f.rear) / 2 - 0.5], [0.06, 0.7, (f.front - f.rear) * 0.55]);
    // weak point: twin fuel tanks across the back
    const weak = new THREE.Group(); weak.position.set(0, 1.0, f.rear + 0.3); g.add(weak);
    for (const s of [-1, 1]) { add(weak, CYL, M.chrome(), [s * f.W * 0.24, 0, 0], [0.58, f.W * 0.4, 0.58], [0, 0, Math.PI / 2]); add(weak, TORUS, glow, [s * f.W * 0.24, 0, -0.02], [0.7, 0.7, 0.7], [0, 0, 0], false); }
    return { weak, flags, glow };
  },
  blaze(g, spec, look) {
    const f = frame(spec), glow = glowMat(look.glow);
    ramBar(g, spec, false);
    // burning barrels lashed along the tank + flame jets out of the back
    const tank = (f.S.fuel_cap ? f.S.fuel_cap[1] : f.top - 1.2) - 0.05;
    for (let i = 0; i < 3; i++) {
      const z = f.rear + 1.3 + i * 1.3, x = 0.45 * (i % 2 ? 1 : -1);
      add(g, CYL, M.rust(), [x, tank + 0.35, z], [0.5, 0.7, 0.5]);
      add(g, CYL, glow, [x, tank + 0.72, z], [0.42, 0.05, 0.42], null, false);
    }
    const flags = [flag(g, f.W * 0.42, f.rear + 0.5, tank - 0.6, 2.4, emblem('blaze', '#2a1208', '#ff8a1a', flame), 1.2, 0.72)];
    for (const s of [-1, 1]) add(g, CONE, glow, [s * f.W * 0.3, 0.9, f.rear - 0.35], [0.22, 0.8, 0.22], [-Math.PI / 2, 0, 0], false);
    // weak point: the release valve wheel on the tank's rear
    const weak = new THREE.Group(); weak.position.set(0, 1.9, f.rear + 0.1); g.add(weak);
    add(weak, CYL, M.chrome(), [0, 0, 0.1], [0.35, 0.4, 0.35], [Math.PI / 2, 0, 0]);
    add(weak, TORUS, glow, [0, 0, -0.14], [1.1, 1.1, 1.1], null, false);
    add(weak, BOX, glow, [0, 0, -0.14], [0.9, 0.06, 0.06], null, false); add(weak, BOX, glow, [0, 0, -0.14], [0.06, 0.9, 0.06], null, false);
    return { weak, flags, glow };
  },
  priest(g, spec, look) {
    const f = frame(spec), glow = glowMat(look.glow);
    // iron plates everywhere
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) add(g, BOX, M.steel(), [s * (f.W / 2 + 0.03), 1.18 + (i % 2) * 0.12, f.rear + 1.1 + i * 1.7], [0.07, 0.6, 1.5], [0, 0, s * 0.05]);
    // the bell tower on the roof, ahead of the priest's hatch (+ spire)
    const ry = f.roof[1], rz = f.roof[2] + 1.35;
    for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) add(g, BOX, M.dark(), [x, ry + 0.55, rz + z], [0.1, 1.1, 0.1]);
    add(g, CONE, M.dark(), [0, ry + 1.5, rz], [1.6, 0.8, 1.6], [0, Math.PI / 4, 0]);
    add(g, CYL6, M.gold(), [0, ry + 2.3, rz], [0.06, 1.0, 0.06]); add(g, BOX, M.gold(), [0, ry + 2.5, rz], [0.5, 0.07, 0.07]);
    const bell = add(g, CONE, M.gold(), [0, ry + 0.75, rz], [0.55, 0.5, 0.55], null, false); bell.userData.bell = true;
    // red lanterns on the corners
    for (const [x, z] of [[-0.5, -2.9], [0.5, -2.9], [-0.5, 0.7], [0.5, 0.7]]) add(g, BOX, glowMat(0xff2a10, 'lantern'), [x * f.W * 0.9, ry + 0.12, rz + z], [0.16, 0.22, 0.16], null, false);
    const flags = [flag(g, -f.W * 0.44, f.rear + 0.4, ry - 0.2, 2.6, emblem('priest', '#3a0c0c', '#d8aa46', cross), 0.8, 1.1)];
    // weak point: the furnace grille glowing through the front armour
    const weak = new THREE.Group(); weak.position.set(0, 0.85, f.front + 0.04); g.add(weak);
    add(weak, BOX, M.dark(), [0, 0, -0.02], [f.W * 0.8, 0.62, 0.08]);
    for (let i = 0; i < 5; i++) add(weak, BOX, glow, [(i / 4 - 0.5) * f.W * 0.66, 0, 0.03], [0.1, 0.5, 0.04], null, false);
    return { weak, flags, glow };
  },
};

const GLOWS = {};
/** Emissive material; `key` shares it (static lights), otherwise one per car (pulses with that car's weak point). */
function glowMat(color, key) {
  if (key && GLOWS[key]) return GLOWS[key];
  const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 3, roughness: 0.5, metalness: 0 });
  if (key) GLOWS[key] = m;
  return m;
}

// ------------------------------------------------------------------------------------------------ nameplate
const _np = new THREE.Vector3();
function nameplate(name, colorHex) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 112;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false });
  const sp = new THREE.Sprite(mat); sp.center.set(0.5, 0); sp.scale.set(0.26, 0.26 * 112 / 512, 1); sp.renderOrder = 999;
  const col = '#' + colorHex.toString(16).padStart(6, '0');
  const draw = (hp01) => {
    const x = c.getContext('2d');
    x.clearRect(0, 0, 512, 112);
    let px = 50; do { x.font = `italic 800 ${px}px Bahnschrift, "Arial Narrow", Impact, sans-serif`; px -= 2; } while (x.measureText(name).width > 490 && px > 20);
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.lineWidth = 7; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.strokeText(name, 256, 50); x.fillStyle = '#fff4e0'; x.fillText(name, 256, 50);
    x.fillStyle = 'rgba(0,0,0,0.7)'; x.fillRect(56, 66, 400, 22);
    x.fillStyle = col; x.fillRect(60, 70, 392 * Math.max(0, Math.min(1, hp01)), 14);
    x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 2; x.strokeRect(56, 66, 400, 22);
    tex.needsUpdate = true;
  };
  draw(1);
  // never over the top HUD (km readout + the warlord's own boss bar): fade out as the plate projects into the top band
  sp.onBeforeRender = (renderer, scene, camera) => {
    _np.setFromMatrixPosition(sp.matrixWorld).project(camera);
    mat.opacity = _np.y > 0.64 ? 0 : _np.y > 0.5 ? (0.64 - _np.y) / 0.14 : 1;
  };
  return { sprite: sp, draw };
}

// ------------------------------------------------------------------------------------------------ wind-up glint
const GLINT_TEX = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,220,150,0.9)'); gr.addColorStop(0.5, 'rgba(255,120,40,0.25)'); gr.addColorStop(1, 'rgba(255,80,20,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  x.globalCompositeOperation = 'lighter'; x.fillStyle = 'rgba(255,230,190,0.9)'; x.fillRect(0, 31, 64, 2); x.fillRect(31, 12, 2, 40);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
export function makeGlint() {
  const m = new THREE.SpriteMaterial({ map: GLINT_TEX, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false, opacity: 0 });
  const s = new THREE.Sprite(m); s.scale.set(0.035, 0.035, 1); s.visible = false; s.renderOrder = 998;
  return s;
}

/**
 * Build a warlord kit on a CarView root. Returns a controller {update(dt, st, carView)} or null.
 * @param index miniboss index + 1 (CarState.elite)
 */
export function buildEliteKit(view, spec, index, carId) {
  const M0 = MINIBOSSES[index - 1]; if (!M0 || !M0.look) return null;
  const look = M0.look, build = KITS[look.kit]; if (!build) return null;
  const g = new THREE.Group(); g.name = 'elite_kit'; view.root.add(g);
  const k = build(g, spec, look);
  bake(g, new Set(g.children.filter((c) => c.userData.horn || c.userData.bell || k.flags.includes(c))));   // (flags keep waving)
  // the second twin swaps his colours
  const swap = look.kit === 'twins' && carId % 2 === 0;
  view.setTint(swap ? look.paint2 : look.paint, swap ? look.paint : look.paint2);
  const f = frame(spec);
  const np = nameplate(M0.name, look.glow); np.sprite.position.set(0, f.top + 1.2 + (look.kit === 'priest' ? 0.8 : look.kit === 'mother' ? 1.2 : 0), 0); view.root.add(np.sprite);
  let hpShown = 1, t = Math.random() * 6;
  return {
    group: g, nameplate: np.sprite,
    dispose() {
      np.sprite.material.map.dispose(); np.sprite.material.dispose();
      g.traverse((o) => { if (o.isMesh && o.userData.baked) o.geometry.dispose(); });
      for (const c of k.flags) { c.geometry.dispose(); c.material.dispose(); }
      k.glow?.dispose();
    },
    update(dt, st) {
      t += dt;
      const dead = st.exploded || st.dead;
      // weak point: slow menacing pulse, white-hot flicker when it is being hit
      const hit = Math.max(0, st.hitFlash || 0) / 0.12;
      if (k.glow) k.glow.emissiveIntensity = dead ? 0 : 2.2 + 1.6 * (0.5 + 0.5 * Math.sin(t * 5)) + hit * 6;
      if (k.weak) k.weak.scale.setScalar(dead ? 1 : 1 + 0.05 * Math.sin(t * 5) + hit * 0.08);
      if (k.spin) k.spin.rotation.y += dt * 7;
      for (const c of k.flags) waveFlag(c, t, st.speed || 0);
      if (Math.abs(st.hp01 - hpShown) > 0.004) { hpShown = st.hp01; np.draw(hpShown); }
      np.sprite.visible = !dead;
    },
  };
}

/** Vertex wave on a flag cloth (few flags, cheap). */
export function waveFlag(cloth, t, speed) {
  const pos = cloth.geometry.attributes.position, base = cloth.userData.base, a = pos.array;
  const amp = 0.06 + Math.min(0.14, speed * 0.004), f = 6 + Math.min(10, speed * 0.25);
  for (let i = 0; i < a.length; i += 3) { const x = base[i]; const k = -x; a[i + 2] = base[i + 2] + Math.sin(t * f + x * 5) * amp * k; a[i + 1] = base[i + 1] + Math.sin(t * f * 0.7 + x * 3) * amp * 0.3 * k; }
  pos.needsUpdate = true;
}

// The garage set: a corrugated-steel desert workshop at golden hour. Polished concrete floor (planar reflection added by
// GarageScene), a roll-up door open onto the sunset desert (low sun streaming in, light shafts, dust motes), pendant lamps,
// a neon sign, a weapons workbench with a pegboard, tyre racks, drums, crates, a stripped project car and a container.
import * as THREE from 'three';
import * as Assets from '../core/assets.js';
import { makeSkyMaterial } from './title_scene.js';

const W = 30, D = 24, H = 8.6;                 // interior: x -15..15, z -11..13, height
export const BACK_Z = -11, LEFT_X = -15, RIGHT_X = 15, FRONT_Z = 13;
export const DOOR = { x0: -1, x1: 9.5, h: 6.2 };  // opening in the back wall
export const BENCH = new THREE.Vector3(-11.9, 1.02, 4.2); // weapon display point on the workbench (x toward the wall)
export const SUN_DIR = new THREE.Vector3(0.2, 0.2, -1).normalize();   // toward the sun (outside the door)

const tl = new THREE.TextureLoader();
function pbr(set, rx, ry, opts = {}) {
  const t = (n, srgb) => { const x = tl.load(`/textures/${set}/${n}.jpg`); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.set(rx, ry); x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; x.anisotropy = 8; return x; };
  const arm = t('arm', false);
  return new THREE.MeshStandardMaterial({ map: t('albedo', true), normalMap: t('normal', false), roughnessMap: arm, metalnessMap: opts.metal ? arm : null, aoMap: opts.ao ? arm : null, roughness: opts.roughness ?? 1, metalness: opts.metal ? 1 : 0, color: opts.color ?? 0xffffff, envMapIntensity: opts.env ?? 1 });
}

function canvasTex(w, h, draw, { srgb = true, repeat = [1, 1], wrap = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** Tileable corrugation normal map (sine ribs along U). */
function corrugationNormal(rx, ry) {
  return canvasTex(64, 4, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let x = 0; x < w; x++) {
      const s = Math.cos((x / w) * Math.PI * 2) * 0.85;   // d/dx of sin
      const nx = -s, nz = 1, l = Math.hypot(nx, nz);
      for (let y = 0; y < h; y++) { const i = (y * w + x) * 4; img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = 128; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false, wrap: true, repeat: [rx, ry] });
}

function hazardTex() {
  return canvasTex(256, 32, (g, w, h) => {
    g.fillStyle = '#e8b01c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16120e';
    for (let x = -h; x < w + h; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 24, h); g.lineTo(x + 24 + h, 0); g.lineTo(x + h, 0); g.fill(); }
    // wear
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(90,80,70,${Math.random() * 0.5})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 2); }
  }, { wrap: true });
}
function stainTex() {
  return canvasTex(256, 256, (g, w) => {
    for (let i = 0; i < 7; i++) {
      const x = w / 2 + (Math.random() - 0.5) * w * 0.35, y = w / 2 + (Math.random() - 0.5) * w * 0.35, r = w * (0.12 + Math.random() * 0.28);
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(8,6,4,0.55)'); gr.addColorStop(0.6, 'rgba(10,8,6,0.25)'); gr.addColorStop(1, 'rgba(10,8,6,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * (0.6 + Math.random() * 0.4), Math.random() * 3, 0, Math.PI * 2); g.fill();
    }
  });
}
function neonTex(text, sub) {
  return canvasTex(1024, 384, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'italic 900 150px Impact, "Arial Black", sans-serif';
    g.lineJoin = 'round'; g.lineWidth = 16; g.strokeStyle = 'rgba(255,120,40,0.35)'; g.strokeText(text, w / 2, h * 0.42);
    g.lineWidth = 7; g.strokeStyle = '#ffd9a0'; g.strokeText(text, w / 2, h * 0.42);
    g.font = '700 46px "Bahnschrift", "Arial Narrow", sans-serif';
    g.fillStyle = '#ffe2b0'; g.fillText(sub, w / 2, h * 0.84);
  });
}
function pegboardTex() {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#6b5236'; g.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { g.fillStyle = '#2a1e14'; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); }
    // tool silhouettes
    g.fillStyle = '#20252a'; g.strokeStyle = '#20252a';
    const wr = (x, y, l, a) => { g.save(); g.translate(x, y); g.rotate(a); g.fillRect(-4, 0, 8, l); g.beginPath(); g.arc(0, 0, 11, 0, 7); g.fill(); g.restore(); };
    for (let i = 0; i < 7; i++) wr(40 + i * 22, 40, 70 + i * 8, 0.05);
    g.fillStyle = '#8a1e14'; g.fillRect(230, 40, 16, 70); g.fillStyle = '#20252a'; g.fillRect(232, 110, 12, 60);
    g.fillStyle = '#b0701c'; g.fillRect(270, 30, 14, 60); g.fillStyle = '#20252a'; g.fillRect(262, 88, 30, 18);
    for (let i = 0; i < 5; i++) { g.fillStyle = ['#20252a', '#8a1e14', '#1d3a5a'][i % 3]; g.fillRect(330 + i * 30, 40, 10, 90 + (i % 2) * 20); g.fillRect(325 + i * 30, 130 + (i % 2) * 20, 20, 30); }
    g.strokeStyle = '#20252a'; g.lineWidth = 7; g.beginPath(); g.arc(120, 190, 30, 0, 7); g.stroke();
    g.fillStyle = '#20252a'; g.fillRect(200, 180, 120, 14); g.fillRect(300, 170, 40, 34);
  });
}
function stencilTex() {
  return canvasTex(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = '900 150px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(230,220,200,0.9)'; g.fillText('BAY 01', w / 2, h / 2);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.8})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 1 + Math.random() * 3); }
  });
}

/** Builds the static set into `scene`. Returns handles the scene animates (dust, lamps, door light). */
export function buildGarageSet(scene) {
  const S = new THREE.Group(); S.name = 'garageSet'; scene.add(S);
  const add = (m, shadow = true) => { m.traverse((o) => { if (o.isMesh) { o.castShadow = shadow; o.receiveShadow = true; } }); S.add(m); return m; };
  const box = (w, h, d, mat, x, y, z, shadow = true) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return add(m, shadow); };

  // ---------------------------------------------------------------- shell
  const wallMat = pbr('rust_metal', 1, 1, { color: 0x6a5a4c, metal: false, env: 0.5 });
  wallMat.normalMap = corrugationNormal(W / 0.3, 1); wallMat.normalScale.set(1.3, 1.3);
  wallMat.map.repeat.set(W / 3, H / 3); wallMat.roughnessMap.repeat.set(W / 3, H / 3); wallMat.roughness = 0.9; wallMat.metalness = 0.35;
  const wallMatSide = wallMat.clone(); wallMatSide.normalMap = corrugationNormal(D / 0.3, 1); wallMatSide.map = wallMat.map.clone(); wallMatSide.map.repeat.set(D / 3, H / 3); wallMatSide.map.needsUpdate = true;
  // back wall with the door opening: three panels around it
  const bw = (x0, x1, y0, y1) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), wallMat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, BACK_Z); return add(m); };
  bw(LEFT_X, DOOR.x0, 0, H); bw(DOOR.x1, RIGHT_X, 0, H); bw(DOOR.x0, DOOR.x1, DOOR.h, H);
  const lw = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMatSide); lw.rotation.y = Math.PI / 2; lw.position.set(LEFT_X, H / 2, (BACK_Z + FRONT_Z) / 2); add(lw);
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMatSide); rw.rotation.y = -Math.PI / 2; rw.position.set(RIGHT_X, H / 2, (BACK_Z + FRONT_Z) / 2); add(rw);
  const fw = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat); fw.rotation.y = Math.PI; fw.position.set(0, H / 2, FRONT_Z); add(fw);
  // grime skirting (darker lower band) + steel columns
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.55, metalness: 0.8 });
  const skirt = new THREE.MeshStandardMaterial({ color: 0x191512, roughness: 0.95 });
  box(W, 0.9, 0.08, skirt, 0, 0.45, BACK_Z + 0.05).visible = false;
  for (const x of [LEFT_X + 0.2, -6, DOOR.x0 - 0.2, DOOR.x1 + 0.2, RIGHT_X - 0.2]) box(0.34, H, 0.34, steel, x, H / 2, BACK_Z + 0.2);
  for (const z of [-4, 3, 9]) { box(0.34, H, 0.34, steel, LEFT_X + 0.2, H / 2, z); box(0.34, H, 0.34, steel, RIGHT_X - 0.2, H / 2, z); }
  // roof + trusses
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 0.9, metalness: 0.4 })); roof.rotation.x = Math.PI / 2; roof.position.set(0, H, (BACK_Z + FRONT_Z) / 2); add(roof, false);
  for (const z of [-8, -3, 2, 7, 11]) { box(W, 0.28, 0.22, steel, 0, H - 0.6, z, false); box(W, 0.12, 0.12, steel, 0, H - 1.5, z, false); for (let x = -13; x <= 13; x += 2.6) { const d = box(0.08, 1.2, 0.08, steel, x, H - 1.05, z, false); d.rotation.z = (x / 2.6) % 2 ? 0.6 : -0.6; } }
  // door frame + half-raised roll-up door slats at the top of the opening
  box(DOOR.x1 - DOOR.x0 + 0.6, 0.35, 0.4, steel, (DOOR.x0 + DOOR.x1) / 2, DOOR.h + 0.15, BACK_Z + 0.1);
  const slatMat = new THREE.MeshStandardMaterial({ color: 0x5a4e40, roughness: 0.7, metalness: 0.6, normalMap: corrugationNormal(1, 14) });
  box(DOOR.x1 - DOOR.x0, 0.9, 0.12, slatMat, (DOOR.x0 + DOOR.x1) / 2, DOOR.h - 0.45, BACK_Z - 0.05);

  // ---------------------------------------------------------------- floor decals: hazard border around the bay, oil stains, stencil
  const haz = hazardTex();
  const decal = (tex, w, d, x, z, ry = 0, op = 1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: op, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = ry; m.position.set(x, 0.004, z); m.receiveShadow = true; S.add(m); return m;
  };
  const hb = 6.4;
  for (const [x, z, len, r] of [[0, -hb, hb * 2, 0], [0, hb, hb * 2, 0], [-hb, 0, hb * 2, Math.PI / 2], [hb, 0, hb * 2, Math.PI / 2]]) {
    const t = haz.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(len / 2.4, 1);
    decal(t, len, 0.3, x, z, r, 0.85);
  }
  const st = stainTex();
  decal(st, 3.2, 3.2, -4.8, 7.5, 0.4, 0.8); decal(st, 2.6, 2.2, 7.5, -6.5, 2.1, 0.7); decal(st, 4, 3, -9.5, -4, 1.2, 0.6); decal(st, 2.4, 2.4, 3.5, 7.8, 0.2, 0.55);
  decal(stencilTex(), 4.2, 1.05, 0, 8.6, 0, 0.35);

  // ---------------------------------------------------------------- outside: sunset desert seen through the door
  const out = new THREE.Group(); S.add(out);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), makeSkyMaterial(SUN_DIR, { hot: 1.15 })); sky.renderOrder = -10; sky.frustumCulled = false; out.add(sky);
  const sand = pbr('sand', 60, 60, { color: 0xb7825e, env: 0.2 });
  const g = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2), sand); g.position.set(0, -0.03, -560); g.receiveShadow = true; out.add(g);
  const apron = pbr('concrete_cracked', 6, 3, { color: 0xa08a78 });
  const ap = new THREE.Mesh(new THREE.PlaneGeometry(22, 10).rotateX(-Math.PI / 2), apron); ap.position.set(4, -0.01, BACK_Z - 5); ap.receiveShadow = true; out.add(ap);

  // ---------------------------------------------------------------- workbench + pegboard (the weapons tab camera frames it)
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.8 });
  const benchTop = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.45, metalness: 0.85 });
  const bx = LEFT_X + 1.05, bz = BENCH.z;
  box(1.5, 0.08, 4.2, benchTop, bx + 0.15, 0.95, bz);
  for (const dz of [-1.9, 1.9]) for (const dx of [-0.55, 0.65]) box(0.08, 0.95, 0.08, steel, bx + dx, 0.475, bz + dz);
  box(1.3, 0.05, 3.9, wood, bx + 0.1, 0.25, bz);
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2), new THREE.MeshStandardMaterial({ map: pegboardTex(), roughness: 0.85 }));
  peg.rotation.y = Math.PI / 2; peg.position.set(LEFT_X + 0.12, 2.25, bz); add(peg, false);
  // rubber mat + a padded display rest under the weapon
  const mat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
  box(1.1, 0.02, 1.8, mat, BENCH.x, 1.0, bz, false);
  const toolbox = new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.45, metalness: 0.4 });
  box(0.7, 0.45, 1.0, toolbox, bx + 0.05, 1.22, bz + 1.4);
  for (let i = 0; i < 3; i++) box(0.02, 0.05, 0.8, steel, bx + 0.41, 1.1 + i * 0.13, bz + 1.4, false);
  box(0.9, 1.0, 1.4, toolbox, LEFT_X + 0.7, 0.5, bz + 3.3);
  // bench lamp (the weapon key light hangs over it)
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.42, 0.34, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c3a2c, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
  shade.position.set(BENCH.x + 0.3, 2.55, bz); S.add(shade);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd6a0, emissiveIntensity: 9 });
  const bb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), bulbMat); bb.position.set(BENCH.x + 0.3, 2.42, bz); S.add(bb);

  // ---------------------------------------------------------------- neon sign on the left wall + wall-hung tyres
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.4), new THREE.MeshBasicMaterial({ map: neonTex('RIDE OR DIE', 'CUSTOM  ·  REPAIRS  ·  ARMOR'), color: new THREE.Color(5.5, 2.4, 1.0), transparent: true, depthWrite: false, toneMapped: false }));
  neon.rotation.y = Math.PI / 2; neon.position.set(LEFT_X + 0.1, 5.4, -4.2); S.add(neon);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151414, roughness: 0.85 });
  const tyreGeo = new THREE.TorusGeometry(0.42, 0.17, 12, 28);
  for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(tyreGeo, tyreMat); t.rotation.y = Math.PI / 2; t.position.set(LEFT_X + 0.25, 3.4, 8.2 + i * 1.05); add(t); }
  box(0.1, 0.1, 4.6, steel, LEFT_X + 0.2, 3.85, 9.8);

  // ---------------------------------------------------------------- lamps (visual; the lights are owned by GarageScene)
  const lampShade = new THREE.MeshStandardMaterial({ color: 0x1e2a1e, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide });
  const lampPos = [[-3.2, 6.4, -1.5], [3.4, 6.4, 1.8], [-0.2, 6.6, 6.5], [-9.5, 6.0, 4.2], [9.5, 6.4, -5]];
  for (const [x, y, z] of lampPos) {
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.62, 0.44, 24, 1, true), lampShade); sh.position.set(x, y, z); S.add(sh);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, H - y), steel); cable.position.set(x, (H + y) / 2, z); S.add(cable);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), bulbMat); b.position.set(x, y - 0.14, z); S.add(b);
  }

  // ---------------------------------------------------------------- dust motes in the door light
  const motes = makeMotes(420);
  S.add(motes.points);

  // ---------------------------------------------------------------- god rays: additive sheets along the sun direction from the door
  const rayTex = canvasTex(64, 256, (g2, w2, h2) => { const gr = g2.createLinearGradient(0, 0, 0, h2); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.15, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g2.fillStyle = gr; g2.fillRect(0, 0, w2, h2); const gx = g2.createLinearGradient(0, 0, w2, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)'); g2.globalCompositeOperation = 'destination-out'; g2.fillStyle = gx; g2.fillRect(0, 0, w2, h2); });
  const rays = new THREE.Group(); S.add(rays);
  const rayMat = new THREE.MeshBasicMaterial({ map: rayTex, color: new THREE.Color(0.55, 0.3, 0.13), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const dir = SUN_DIR.clone().negate();
  for (let i = 0; i < 7; i++) {
    const len = 16 + Math.random() * 6;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3 + Math.random() * 1.6, len), rayMat);
    const x = DOOR.x0 + 0.8 + (i / 6) * (DOOR.x1 - DOOR.x0 - 1.6), y = 1.5 + Math.random() * 3.8;
    m.position.set(x, y, BACK_Z).addScaledVector(dir, len / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.rotateY(Math.random() * Math.PI);
    m.renderOrder = 8; rays.add(m);
  }

  // ---------------------------------------------------------------- GLB props (async)
  const propsReady = placeProps(S);
  return { group: S, motes, rays, rayMat, lampPos, neon, propsReady };
}

async function placeProps(S) {
  const want = [
    ['tire_stack', -12.6, -8.6, 0.3], ['tire_stack', -11.4, -9.3, 1.4], ['tire_stack', -12.3, -7.4, 2.2],
    ['barrel', -8.2, -9.8, 0], ['barrel', -7.5, -9.6, 1], ['barrel_explosive', -8.0, -9.0, 2], ['barrel', 12.6, 9.2, 0.4], ['barrel_explosive', 13.2, 8.5, 1.2],
    ['crate_stack', 12.8, 3.2, -1.57], ['crate_stack', 13.2, 5.6, -1.4], ['road_cone', 10.6, -8.6, 0], ['road_cone', 11.2, -8.1, 0.6], ['road_cone', 0.6, -12.5, 0],
    ['skeleton_car_frame', 11.2, -3.6, 1.9], ['shipping_container', -11.6, -2.2, 0], ['debris_pile', 13.2, -9.2, 0.7], ['jersey_barrier', 11.2, -14.8, 0.1],
    ['jersey_barrier', -3.4, -14.2, 0.05], ['sign_warning', 14.6, 1.2, -1.57], ['bollard', DOOR.x0 - 0.5, -10.7, 0], ['bollard', DOOR.x1 + 0.5, -10.7, 0],
    ['cactus_saguaro', -14, -40, 1], ['cactus_saguaro', 20, -55, 2], ['utility_pole', 26, -30, 0.3], ['utility_pole', 40, -70, 0.3], ['shrub_desert_scrub', 8, -24, 0], ['shrub_dry_bush', -6, -20, 0],
    ['rock_06', 30, -60, 1], ['boulder_03', -30, -70, 2], ['mesa_a', -200, -520, 0.4], ['mesa_b', 150, -620, 2.4], ['hoodoo_a', 60, -240, 1],
  ];
  const urls = [...new Set(want.map((w) => `/models/${/^(mesa|hoodoo|shipping)/.test(w[0]) ? 'structures' : 'props'}/${w[0]}.glb`))];
  await Assets.preload(urls);
  for (const [id, x, z, r] of want) {
    const kind = /^(mesa|hoodoo|shipping)/.test(id) ? 'structures' : 'props';
    const m = Assets.clone(`/models/${kind}/${id}.glb`); if (!m) continue;
    m.position.set(x, 0, z); m.rotation.y = r;
    if (id === 'shipping_container') m.rotation.y = 0;
    const far = z < -30;
    m.traverse((o) => { if (o.isMesh) { o.castShadow = !far; o.receiveShadow = true; } });
    S.add(m);
  }
}

function makeMotes(n) {
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = DOOR.x0 - 3 + Math.random() * (DOOR.x1 - DOOR.x0 + 8); pos[i * 3 + 1] = 0.2 + Math.random() * 6.5; pos[i * 3 + 2] = BACK_Z + 0.5 + Math.random() * 16;
    seed[i] = Math.random() * 100;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uSun: { value: SUN_DIR.clone() }, uPx: { value: 1 } },
    vertexShader: /* glsl */`attribute float seed; uniform float uTime; uniform float uPx; varying float vA; varying float vS;
      void main() { vec3 p = position; float t = uTime * 0.12 + seed;
        p.x += sin(t * 1.3 + seed) * 0.6; p.y += sin(t * 0.9 + seed * 2.0) * 0.4 + mod(uTime * 0.05 + seed, 1.0) * 0.3; p.z += cos(t * 1.1) * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float inShaft = smoothstep(${(-1).toFixed(1)}, 1.0, p.x) * (1.0 - smoothstep(${(DOOR.x1).toFixed(1)}, ${(DOOR.x1 + 3).toFixed(1)}, p.x));
        vA = (0.25 + 0.75 * inShaft) * (0.5 + 0.5 * sin(seed * 7.0 + uTime * 0.8)); vS = fract(seed * 13.7);
        gl_PointSize = uPx * (1.5 + vS * 2.5) * (6.0 / max(1.0, -mv.z)); }`,
    fragmentShader: /* glsl */`varying float vA; varying float vS; void main() { vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)); gl_FragColor = vec4(vec3(1.0, 0.72, 0.42) * 1.6 * a * vA, 1.0); }`,
  });
  const points = new THREE.Points(g, mat); points.frustumCulled = false; points.renderOrder = 9;
  return { points, mat };
}

// Roadblock telegraphing in the world (deterministic from road.features, identical on both peers):
//   ~250 m and ~140 m out: amber warning signs on both shoulders ("ROADBLOCK" + arrow to the gap) with blinking lamps
//   ~70 m out: flashing chevron boards on the shoulder pointing at the gap
//   last 60 m: a funnel of burning red road flares converging on the gap, and GREEN strobes on the gap's edges ("through here")
//   the soft strips either side of the gap: striped, lamp-lit BREAKABLE barricades (sim: hazards.js rbBarricades) that burst
//   into planks on the 'barrierBreak' event
// No colliders. Drive with update(dt, playerS) + handleEvent(e).
import * as THREE from 'three';
import { HALF_ROAD } from '../data/biomes.js';
import { rbGapD, RB_GAP_W, rbBarricades } from '../sim/hazards.js';

const SIGN_AT = [250, 140], BOARD_AT = 72, VIEW_AHEAD = 620, KEEP_BEHIND = 40;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function arrowPath(x, cx, cy, s, dir) { // dir -1 = points left (on the sign as seen), +1 right, 0 up
  x.beginPath();
  if (dir === 0) { x.moveTo(cx, cy - s); x.lineTo(cx + s * 0.8, cy); x.lineTo(cx + s * 0.3, cy); x.lineTo(cx + s * 0.3, cy + s); x.lineTo(cx - s * 0.3, cy + s); x.lineTo(cx - s * 0.3, cy); x.lineTo(cx - s * 0.8, cy); }
  else { const d = dir; x.moveTo(cx + d * s, cy); x.lineTo(cx, cy - s * 0.8); x.lineTo(cx, cy - s * 0.3); x.lineTo(cx - d * s, cy - s * 0.3); x.lineTo(cx - d * s, cy + s * 0.3); x.lineTo(cx, cy + s * 0.3); x.lineTo(cx, cy + s * 0.8); }
  x.closePath(); x.fill();
}
const SIGNS = {};
/** Warning sign face for a gap side ('L' | 'R' | 'C'). Seen from the approaching driver: left of the texture = driver's left. */
function signTex(side) {
  return SIGNS[side] || (SIGNS[side] = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#1a1200'; x.beginPath(); x.moveTo(w / 2, 4); x.lineTo(w - 4, h / 2); x.lineTo(w / 2, h - 4); x.lineTo(4, h / 2); x.closePath(); x.fill();
    x.fillStyle = '#ffb000'; x.beginPath(); x.moveTo(w / 2, 16); x.lineTo(w - 16, h / 2); x.lineTo(w / 2, h - 16); x.lineTo(16, h / 2); x.closePath(); x.fill();
    x.fillStyle = '#140c00'; x.font = '900 30px Bahnschrift, Impact, "Arial Narrow", sans-serif'; x.textAlign = 'center';
    x.fillText('ROADBLOCK', w / 2, 104);
    arrowPath(x, w / 2, 160, 42, side === 'L' ? -1 : side === 'R' ? 1 : 0);
  }));
}
let BOARD = null;
const boardTex = () => BOARD || (BOARD = canvasTex(256, 128, (x, w, h) => {
  x.fillStyle = '#0c0c0c'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#ffd21a';
  for (let i = 0; i < 3; i++) { const cx = 60 + i * 68; x.beginPath(); x.moveTo(cx - 22, 20); x.lineTo(cx + 18, 64); x.lineTo(cx - 22, 108); x.lineTo(cx - 4, 108); x.lineTo(cx + 36, 64); x.lineTo(cx - 4, 20); x.closePath(); x.fill(); }
}));
let GLOW = null;
const glowTex = () => GLOW || (GLOW = canvasTex(64, 64, (x) => {
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
}));

const MAT = {};
const mat = (k, make) => MAT[k] || (MAT[k] = make());
const POST = new THREE.CylinderGeometry(0.06, 0.07, 1, 8), PLANE = new THREE.PlaneGeometry(1, 1), BOX = new THREE.BoxGeometry(1, 1, 1), FLARE = new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6);
let STRIPE = null;
const stripeTex = () => STRIPE || (STRIPE = canvasTex(256, 32, (x, w, h) => {
  x.fillStyle = '#f2f2ee'; x.fillRect(0, 0, w, h); x.fillStyle = '#d8200e';
  for (let i = -2; i < 12; i++) { x.beginPath(); x.moveTo(i * 32, h); x.lineTo(i * 32 + 16, h); x.lineTo(i * 32 + 16 + h, 0); x.lineTo(i * 32 + h, 0); x.closePath(); x.fill(); }
}));

export class HazardMarks {
  constructor(scene, road) {
    this.scene = scene; this.road = road;
    this.group = new THREE.Group(); this.group.name = 'hazard_marks'; scene.add(this.group);
    this.sites = new Map(); // feature -> {group, lamps:[mat], flares:[sprite], strobes:[sprite], t}
    this.t = 0; this._p = {};
  }

  update(dt, playerS) {
    this.t += dt;
    this._planks(dt);
    const want = new Set(this.road.featuresIn(playerS - KEEP_BEHIND, playerS + VIEW_AHEAD, 'roadblock'));
    for (const f of want) if (!this.sites.has(f)) this.sites.set(f, this._build(f));
    for (const [f, site] of this.sites) if (!want.has(f)) { this._dispose(site); this.sites.delete(f); }
    // blink / flicker
    const blink = Math.sin(this.t * Math.PI * 2 * 1.4) > 0;
    for (const site of this.sites.values()) {
      const near = site.f.s0 - playerS;
      for (const m of site.lamps) m.opacity = blink ? 1 : 0.12;
      for (let i = 0; i < site.boards.length; i++) site.boards[i].material.color.setScalar(Math.sin(this.t * 9 + i) > -0.2 ? 1 : 0.35);
      for (let i = 0; i < site.flares.length; i++) { const s = site.flares[i]; const k = 0.75 + 0.25 * Math.sin(this.t * (17 + i % 5) + i * 1.7); s.material.opacity = k; s.scale.setScalar(s.userData.base * (0.85 + 0.3 * k)); }
      const strobe = (this.t * 2.2) % 1 < 0.18 || ((this.t * 2.2) % 1 > 0.3 && (this.t * 2.2) % 1 < 0.42);
      for (const s of site.strobes) { s.material.opacity = near < 260 ? (strobe ? 1 : 0.2) : 0; }
    }
  }

  _build(f) {
    const road = this.road, g = new THREE.Group(), P = this._p;
    const gapD = rbGapD(f), side = gapD > 1 ? 'L' : gapD < -1 ? 'R' : 'C';
    const site = { f, group: g, lamps: [], flares: [], strobes: [], boards: [] };
    const signMat = mat('sign' + side, () => new THREE.MeshBasicMaterial({ map: signTex(side), toneMapped: false, side: THREE.DoubleSide, fog: true }));
    const postMat = mat('post', () => new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.6, roughness: 0.5 }));
    const lampMat = () => new THREE.SpriteMaterial({ map: glowTex(), color: 0xffa21a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    // ---- warning signs on both shoulders, facing the traffic
    for (const back of SIGN_AT) {
      const s = f.s0 - back;
      const sm = road.sample(s);
      for (const sd of [-1, 1]) {
        const d = sd * (HALF_ROAD + 1.6);
        road.pointAt(s, d, P);
        const post = new THREE.Mesh(POST, postMat); post.scale.set(1, 3.0, 1); post.position.set(P.x, P.y + 1.5, P.z); g.add(post);
        const sign = new THREE.Mesh(PLANE, signMat); sign.scale.set(2.3, 2.3, 1);
        sign.position.set(P.x, P.y + 3.2, P.z); sign.rotation.y = sm.th + Math.PI; // face -road direction (toward the driver)
        sign.rotation.z = 0; g.add(sign);
        const lm = lampMat(); site.lamps.push(lm);
        const lamp = new THREE.Sprite(lm); lamp.scale.setScalar(1.1); lamp.position.set(P.x, P.y + 4.6, P.z); g.add(lamp);
      }
    }
    // ---- chevron boards on the shoulder(s) pointing at the gap
    {
      const s = f.s0 - BOARD_AT, sm = road.sample(s);
      const sides = side === 'C' ? [-1, 1] : [side === 'L' ? -1 : 1]; // the board stands on the side AWAY from the gap, arrows point across
      for (const sd of sides) {
        road.pointAt(s, sd * (HALF_ROAD + 0.8), P);
        const bm = new THREE.MeshBasicMaterial({ map: boardTex(), toneMapped: false, side: THREE.DoubleSide });
        const b = new THREE.Mesh(PLANE, bm); b.scale.set(3.2, 1.6, 1);
        b.position.set(P.x, P.y + 1.9, P.z); b.rotation.y = sm.th + Math.PI;
        // arrows are drawn pointing right on the texture; mirror to point toward the gap (driver's left = +X)
        if (sd < 0) b.scale.x = -3.2;
        g.add(b); site.boards.push(b);
        const frame = new THREE.Mesh(BOX, postMat); frame.scale.set(0.12, 1.2, 0.12); frame.position.set(P.x, P.y + 0.6, P.z); g.add(frame);
      }
    }
    // ---- flare funnel: from both road edges to the gap edges over the last 60 m
    const flareMat = mat('flare', () => new THREE.MeshStandardMaterial({ color: 0x551010, emissive: 0xff2a10, emissiveIntensity: 4 }));
    const fm = () => new THREE.SpriteMaterial({ map: glowTex(), color: 0xff3a18, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (const sd of [-1, 1]) {
      const from = sd * (HALF_ROAD - 0.3), to = gapD + sd * (RB_GAP_W / 2 + 0.5);
      if (sd * (to - from) > -0.5) continue; // the gap is on this edge: no funnel needed
      for (let k = 0; k < 7; k++) {
        const t = k / 6, s = f.s0 - 62 + 56 * t, d = from + (to - from) * t;
        road.pointAt(s, d, P);
        const fl = new THREE.Mesh(FLARE, flareMat); fl.position.set(P.x, P.y + 0.06, P.z); fl.rotation.z = Math.PI / 2; fl.rotation.y = k; g.add(fl);
        const sp = new THREE.Sprite(fm()); sp.userData.base = 1.3; sp.scale.setScalar(1.3); sp.position.set(P.x, P.y + 0.35, P.z); g.add(sp); site.flares.push(sp);
      }
    }
    // ---- breakable barricades in the soft strips (sawhorses + striped boards + a lamp)
    site.barricades = [];
    const boardMat = mat('stripe', () => new THREE.MeshStandardMaterial({ map: stripeTex(), roughness: 0.7, metalness: 0 }));
    const woodMat = mat('wood', () => new THREE.MeshStandardMaterial({ color: 0x7a5a36, roughness: 0.9 }));
    for (const b of rbBarricades(f)) {
      const sm = road.sample(b.s); road.pointAt(b.s, b.d, P);
      const bg = new THREE.Group(); bg.position.set(P.x, P.y, P.z); bg.rotation.y = sm.th;
      const w = b.hw * 2 - 0.12;
      for (const y of [0.62, 1.02]) { const pl = new THREE.Mesh(BOX, boardMat); pl.scale.set(w, 0.24, 0.05); pl.position.set(0, y, 0); bg.add(pl); }
      for (const x of [-0.42, 0.42]) for (const z of [-0.22, 0.22]) { const leg = new THREE.Mesh(BOX, woodMat); leg.scale.set(0.07, 1.15, 0.07); leg.position.set(x * w, 0.56, z * 0.6); leg.rotation.x = z > 0 ? -0.33 : 0.33; bg.add(leg); }
      const lm = lampMat(); lm.color.setHex(0xffb21a); site.lamps.push(lm);
      const lamp = new THREE.Sprite(lm); lamp.scale.setScalar(0.75); lamp.position.set(0, 1.32, 0); bg.add(lamp);
      g.add(bg); site.barricades.push({ ...b, group: bg, broken: false });
    }
    // ---- green strobes on the gap's edges: "through here"
    const sm0 = road.sample(f.s0 + 1);
    for (const sd of [-1, 1]) {
      const d = gapD + sd * (RB_GAP_W / 2 + 0.35);
      if (Math.abs(d) > HALF_ROAD + 0.5) continue;
      road.pointAt(f.s0 + 1, d, P);
      const post = new THREE.Mesh(POST, postMat); post.scale.set(1.2, 2.6, 1.2); post.position.set(P.x, P.y + 1.3, P.z); g.add(post);
      const sm = new THREE.SpriteMaterial({ map: glowTex(), color: 0x3aff6a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const sp = new THREE.Sprite(sm); sp.scale.setScalar(1.6); sp.position.set(P.x, P.y + 2.75, P.z); g.add(sp); site.strobes.push(sp);
      void sm0;
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.group.add(g);
    return site;
  }

  /** 'barrierBreak' {s0, i, pos, vel}: the barricade bursts into planks. */
  handleEvent(e) {
    if (e.t !== 'barrierBreak') return;
    for (const site of this.sites.values()) {
      if (Math.abs(site.f.s0 - e.s0) > 0.5) continue;
      const b = site.barricades?.[e.i]; if (!b || b.broken) return;
      b.broken = true; b.group.visible = false;
      const planks = this.planks || (this.planks = []);
      const boardMat = MAT.stripe, woodMat = MAT.wood;
      for (let k = 0; k < 7; k++) {
        const m = new THREE.Mesh(BOX, k < 4 ? boardMat : woodMat);
        m.scale.set(k < 4 ? 0.5 + Math.random() * 0.6 : 0.07, k < 4 ? 0.2 : 0.9, 0.05);
        m.position.set(e.pos[0] + (Math.random() - 0.5), e.pos[1] + Math.random() * 0.5, e.pos[2] + (Math.random() - 0.5));
        const v = new THREE.Vector3(e.vel[0] * (0.5 + Math.random() * 0.6) + (Math.random() - 0.5) * 8, 3 + Math.random() * 6, e.vel[2] * (0.5 + Math.random() * 0.6) + (Math.random() - 0.5) * 8);
        this.group.add(m); planks.push({ m, v, w: new THREE.Vector3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20), t: 0 });
      }
      return;
    }
  }

  _planks(dt) {
    const L = this.planks; if (!L || !L.length) return;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i]; p.t += dt;
      p.v.y -= 17.5 * dt; p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += p.w.x * dt; p.m.rotation.y += p.w.y * dt; p.m.rotation.z += p.w.z * dt;
      if (p.t > 2.2) { this.group.remove(p.m); L.splice(i, 1); }
    }
  }

  _dispose(site) {
    this.group.remove(site.group);
    site.group.traverse((o) => { if (o.material && (o.isSprite || site.boards.includes(o))) o.material.dispose(); });
  }

  dispose() { for (const s of this.sites.values()) this._dispose(s); this.sites.clear(); this.scene.remove(this.group); }
}

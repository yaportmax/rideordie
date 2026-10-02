// Per-car continuous effects: tyre smoke / dust / gravel spray, skid marks, exhaust, nitro jets, engine smoke / fire, scrape
// sparks, landing dust + undercarriage sparks. All emitters use per-wheel accumulators (no allocation) and scale with
// distance + quality.
//
// The LOCAL player's truck is special: its damage smoke / hood fire are ATTACHED particles (truck-local positions, the
// relative air flow as wind; see particles.js), so from the cockpit they pour off the hood seams, stream over the
// windshield and roll over the roof - always outside the glass (the shader clips anything inside the cab). It also gets
// wind-borne dust streaks near the road at speed.
import * as THREE from 'three';
import { SPR, FRAMES } from './atlas.js';
import { MODE, PF } from './particles.js';
import { spark, puff, dust, chip, ember, glow, flame, dustColor } from './recipes.js';
import { surfOf, clamp01, smooth } from './util.js';
import { ATMO } from '../../world/atmosphere.js';
import { makeWreckUniforms, patchPaint } from './wreck.js';

const PI2 = Math.PI * 2;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _inv = new THREE.Matrix4(), _r = new THREE.Vector3();
const ATT = PF.ATTACH | PF.DEFLECT;
const _dc2 = [0, 0, 0];

export class CarRec {
  constructor(state, cv) {
    this.cv = cv; this.id = state.id; this.spec = state.spec;
    const spec = state.spec, nW = spec.wheels.length;
    this.nW = nW; this.R = spec.wheelRadius;
    this.nodes = new Array(nW).fill(null); this.pm = new Array(nW).fill(null);
    this.acc = new Float32Array(nW * 4 + 24);
    this.skidOn = new Uint8Array(nW);
    this.halfW = clamp01(spec.wheelRadius * 0.62) * 0.5 + 0.08;
    this.sock = {}; this.wasAir = false; this.airT = 0; this.dead = false;
    this.wreckU = makeWreckUniforms(); this.wrecked = false;
    this.local = false; this.cab = null;
    this._init(cv, spec);
  }

  _init(cv, spec) {
    cv.root.updateMatrixWorld(true);
    _inv.copy(cv.root.matrixWorld).invert();
    for (let i = 0; i < this.nW; i++) {
      const node = cv.wheelNodes.get(spec.wheels[i].name);
      if (node) { this.nodes[i] = node; this.pm[i] = new THREE.Matrix4().multiplyMatrices(_inv, node.parent ? node.parent.matrixWorld : cv.root.matrixWorld); }
    }
    const L = spec.length, H = spec.height, sockets = cv.sockets || {};
    const get = (names, fb) => {
      for (const n of names) { const o = sockets[n]; if (o) { _v.setFromMatrixPosition(o.matrixWorld).applyMatrix4(_inv); return _v.clone(); } }
      return new THREE.Vector3(fb[0], fb[1], fb[2]);
    };
    this.sock.exL = get(['exhaust_L', 'exhaust'], [0.5, 0.3, -L / 2]); this.sock.exR = get(['exhaust_R', 'exhaust'], [-0.5, 0.3, -L / 2]);
    this.sock.nitL = get(['nitro_L', 'exhaust_L', 'exhaust'], [0.45, 0.45, -L / 2]); this.sock.nitR = get(['nitro_R', 'exhaust_R', 'exhaust'], [-0.45, 0.45, -L / 2]);
    this.sock.engine = get(['smoke_engine'], [0, H * 0.55, L / 2 - 0.9]);
    // Only the vehicle's own paint belongs to its wreck uniforms. Crew weapons
    // also have materials named paint, often shared between instances; walking
    // the whole car root corrupted those materials and compiled a cold weapon
    // wreck shader when a shotgun/RPG/sniper raider first appeared.
    (cv.model || cv.root).traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && /^paint/.test(m.name)) patchPaint(m, this.wreckU); });
  }

  /** local (root space) -> world */
  toWorld(local, out) { const r = this.cv.root; return out.copy(local).applyQuaternion(r.quaternion).add(r.position); }
}

const rate = (fx, acc, k, r, dt, cap = 3) => {
  // returns how many particles to emit this frame for rate r (per second); accumulator stored in acc[k]
  let a = acc[k] + r * dt; let n = 0;
  while (a >= 1 && n < cap) { a -= 1; n++; }
  acc[k] = a > 1 ? 1 : a;
  return n;
};

// ------------------------------------------------------------------------------------------------ own truck (attached)
/** A point on the hood seams (truck-local, into _r): rear edge by the windshield, the sides, the grille. */
function hoodSeam(rng, hood, bias = 0) {
  const u = rng.next();
  if (u < 0.28 - bias * 0.2) return _r.set(rng.range(hood.min.x * 0.85, hood.max.x * 0.85), hood.max.y - 0.03, hood.min.z + rng.range(0.02, 0.18));
  if (u < 0.8) { const s = rng.next() < 0.5 ? -1 : 1; return _r.set(s > 0 ? hood.max.x - rng.range(0.0, 0.1) : hood.min.x + rng.range(0.0, 0.1), hood.max.y - rng.range(0.04, 0.12), rng.range(hood.min.z + 0.1, hood.max.z - 0.05)); }
  return _r.set(rng.range(hood.min.x * 0.7, hood.max.x * 0.7), hood.max.y - rng.range(0.05, 0.2), hood.max.z - rng.range(0.0, 0.1));
}

function ownSmoke(fx, rng, hood, dark, a, glowK, big = 1) {
  hoodSeam(rng, hood);
  const c = 0.42 - 0.36 * dark;
  const p = fx.p.reset(); p.pos(_r.x, _r.y, _r.z).vel(rng.sym(0.35), rng.range(1.0, 2.2), rng.sym(0.35)); p.life = rng.range(1.3, 2.1) * big;
  p.spr = SPR.SMOKE; p.f0 = rng.int(4) * 4; p.nPlay = 4; p.size(0.35 * big, rng.range(1.9, 2.8) * big); p.sCurve = 0.5;
  p.rot = rng.sym(0.8); p.rotV = rng.sym(0.4); p.drag = 1.7; p.grav = -0.8; p.turb = 0.35; p.wind = 0.6; p.lit = 1;
  p.col(c, c * 0.97, c * 0.94, a).col1(c * 1.15, c * 1.12, c * 1.08, a); p.fin = 0.06; p.fout = 0.6; p.soft = 0.25; p.glow = glowK;
  p.flags = ATT | (rng.next() < 0.5 ? PF.FLIPU : 0);
  fx.pa.emit(p);
}

function ownFlame(fx, rng, hood, heat = 1, big = 1) {
  hoodSeam(rng, hood, 1);
  const w = rng.range(0.25, 0.6) * big;
  flame(fx, _r.x, _r.y - 0.04, _r.z, rng.sym(0.25), rng.range(0.4, 1.0), rng.sym(0.25), w, w * rng.range(1.2, 2.0), rng.range(0.3, 0.55), heat, 3.5, ATT, 2.4, 1.35, 0.12);
}

/** Damage on the local player's truck (called per frame from updateCarFx). */
function ownDamage(fx, rec, state, dt) {
  const cab = rec.cab; if (!cab) return;
  const rng = fx.rng, acc = rec.acc, o = rec.nW * 4 + 10, hood = cab.hood;
  const hp = state.hp01 ?? 1, burning = !!state.burning;
  const smoking = burning || state.smoking || hp < 0.34 || (state.engineHp01 ?? 1) < 0.3;
  if (!smoking) return;
  const dark = burning ? 1 : clamp01((0.36 - hp) / 0.22) * 0.7 + (1 - clamp01((state.engineHp01 ?? 1) * 1.8)) * 0.3;
  // smoke pouring out of the hood seams, swept back over the windshield and the roof
  const q = Math.max(0.6, fx.qd);
  const ns = rate(fx, acc, o, (burning ? 20 : 9 + 9 * dark) * q, dt, 3);
  for (let k = 0; k < ns; k++) ownSmoke(fx, rng, hood, dark, burning ? 0.62 : 0.4 + 0.2 * dark, burning ? 1.2 : 0);
  // the trail: once the smoke is over the cab it leaves the truck's frame and streams off behind it in the world (seen in the
  // mirrors, by the gunner, by everyone else) - thick and black when burning
  if (burning || dark > 0.35) {
    const nt = rate(fx, acc, o + 3, (burning ? 30 : 12 * dark) * q, dt, 3), v = state.vel;
    for (let k = 0; k < nt; k++) {
      const side = rng.next() < 0.5 ? -1 : 1, cab = rec.cab;
      if (cab.rearEngine) _v.set(rng.range(hood.min.x, hood.max.x), hood.max.y + rng.range(.15, .5), hood.min.z - rng.range(.1, .5));
      else if (rng.next() < 0.6) _v.set(rng.sym((cab.max.x - cab.min.x) * 0.35), cab.max.y + 0.2, cab.min.z + rng.range(-0.2, 0.4));
      else _v.set(side * ((cab.max.x - cab.min.x) * 0.5 + 0.25), rng.range(hood.max.y, cab.max.y), cab.min.z + rng.range(0, 0.6));
      rec.toWorld(_v, _w);
      const c = burning ? rng.range(0.045, 0.07) : 0.3 - 0.22 * dark;
      puff(fx, _w.x, _w.y, _w.z, v.x * 0.9 + rng.sym(0.8), v.y * 0.5 + rng.range(0.6, 1.8), v.z * 0.9 + rng.sym(0.8), 1.3, rng.range(3.4, 5.2) * (burning ? 1 : 0.8), rng.range(2.2, 3.2), c, c * 0.96, c * 0.93, burning ? 0.65 : 0.42, 0.7, 1.0, -1e4, burning ? 0.7 : 0);
    }
  }
  if (!burning) {
    if (dark > 0.5 && rng.next() < dt * 3) { hoodSeam(rng, hood); spark(fx, _r.x, _r.y, _r.z, rng.sym(2), rng.range(1, 3), rng.range(-1, 1), rng.range(0.15, 0.35), -1e4, 0.8, 0.03, 0.8, ATT); }
    return;
  }
  // fire: tongues licking out of the seams and the grille, bent back by the air flow toward the glass
  const night = 1 - (ATMO.uAtmSun.value.w || 0), heat = 1 - 0.35 * night;   // night exposure is ~2.4x: keep the hood fire from blowing out
  const nf = rate(fx, acc, o + 1, 20 * q, dt, 4);
  for (let k = 0; k < nf; k++) ownFlame(fx, rng, hood, rng.range(0.9, 1.2) * heat);
  const nc = rate(fx, acc, o + 4, 7 * q, dt, 2);
  for (let k = 0; k < nc; k++) {                         // big tongues out of the rear hood corners, up beside the A-pillars
    const side = rng.next() < 0.5 ? -1 : 1, w = rng.range(0.4, 0.7);
    flame(fx, side > 0 ? hood.max.x - 0.05 : hood.min.x + 0.05, hood.max.y - 0.05, hood.min.z + rng.range(0.05, 0.35), side * rng.range(0.2, 0.6), rng.range(0.6, 1.4), 0, w, w * rng.range(1.7, 2.6), rng.range(0.35, 0.6), 1.1 * heat, 3.0, ATT, 2.0, 1.3, 0.12);
  }
  if (rng.next() < dt * 14) { hoodSeam(rng, hood, 1); glow(fx, _r.x, _r.y + 0.05, _r.z, rng.range(0.5, 0.9), 0.12, 1.4, 0.55, 0.14, true, 1.2, ATT); }
  const ne = rate(fx, acc, o + 2, 7 * q, dt, 2);
  for (let k = 0; k < ne; k++) { hoodSeam(rng, hood); ember(fx, _r.x, _r.y, _r.z, rng.sym(1.2), rng.range(1.5, 4), rng.sym(1.2), rng.range(0.5, 1.1), 0.12, 1, PF.ATTACH); }
  // the whole truck lights up orange from its own fire
  const P = rec.cv.root.position; rec.toWorld(_v.set(0, hood.max.y + 0.4, (hood.min.z + hood.max.z) * 0.5), _w);
  fx.glowLight(_w.x, _w.y, _w.z, 1.0, 0.5, 0.2, 45 + 25 * Math.sin(fx.time * 17) * Math.sin(fx.time * 9.1), 9, 999);
  void P;
}

/** One-shot bursts on the local truck: 'smoke' (starts smoking), 'engineDead' (bang + sparks), 'fire' (whoomp of flame). */
export function ownBurst(fx, rec, state, kind) {
  const cab = rec.cab; if (!cab) return;
  const rng = fx.rng, hood = cab.hood;
  if (kind === 'fire') {
    for (let i = 0; i < 16; i++) ownFlame(fx, rng, hood, 1.5, 1.35);
    for (let i = 0; i < 10; i++) ownSmoke(fx, rng, hood, 1, 0.7, 1.6, 1.2);
    for (let i = 0; i < 3; i++) { hoodSeam(rng, hood, 1); glow(fx, _r.x, _r.y + 0.1, _r.z, 1.4, 0.25, 3, 1.3, 0.35, true, 1.4, ATT); }
    rec.toWorld(_v.set(0, hood.max.y + 0.3, (hood.min.z + hood.max.z) * .5), _w); fx.flashLight(_w.x, _w.y, _w.z, 1.0, 0.55, 0.22, 160, 14, 0.4, 0.6);
  } else {
    for (let i = 0; i < 8; i++) ownSmoke(fx, rng, hood, kind === 'engineDead' ? 0.9 : 0.4, 0.55, 0, 1.1);
    if (kind === 'engineDead') for (let i = 0; i < 10; i++) { hoodSeam(rng, hood); spark(fx, _r.x, _r.y, _r.z, rng.sym(4), rng.range(1, 5), rng.range(-2, 2), rng.range(0.2, 0.5), -1e4, 0.9, 0.035, 0.6, ATT); }
  }
}

/** Wind-borne dust streaking past near the road at speed (local truck only): a handful, low and to the sides. */
function speedStreaks(fx, rec, state, dt, surf, P, speed) {
  const k = smooth(20, 42, speed) * (state.boosting ? 1.5 : 1);
  if (k <= 0.01) return;
  const rng = fx.rng, n = rate(fx, rec.acc, rec.nW * 4 + 14, 22 * k * Math.max(0.5, fx.qd), dt, 3);
  if (!n) return;
  const vx = state.vel.x / speed, vz = state.vel.z / speed;
  const dc = dustColor(surf.hard ? 'gravel' : 'sand', _dc2);
  for (let i = 0; i < n; i++) {
    const ahead = rng.range(0.35, 0.9) * speed, side = (rng.next() < 0.5 ? -1 : 1) * rng.range(1.8, 6.5);   // 0.35-0.9 s ahead: they fly past the cab
    const x = P.x + vx * ahead - vz * side, z = P.z + vz * ahead + vx * side;
    const gy = fx.groundAt(x, z, P.y - 0.6);
    const p = fx.p.reset(); p.pos(x, gy + rng.range(0.1, 1.8), z).vel(-vx * speed * 0.3 + rng.sym(0.6), rng.range(-0.2, 0.3), -vz * speed * 0.3 + rng.sym(0.6));
    p.life = rng.range(0.45, 0.8); p.spr = SPR.STREAK; p.mode = MODE.STREAK; p.size(0.055, 0.035); p.len = 1.0; p.lenSpd = 0.2;
    p.col(0.55 + dc[0], 0.55 + dc[1], 0.55 + dc[2], 0.5); p.lit = 1; p.fin = 0.2; p.fout = 0.4; p.drag = 0.3;
    fx.pa.emit(p);
    if (rng.next() < 0.12) dust(fx, x, gy + 0.3, z, -vx * speed * 0.1 + rng.sym(1), rng.range(0.1, 0.6), -vz * speed * 0.1 + rng.sym(1), 0.4, rng.range(1.6, 2.6), rng.range(0.8, 1.3), dc[0], dc[1], dc[2], 0.22, gy, 1.2, 0.1);
  }
}

/** Update one car. `surface` = asphalt|gravel|sand|dirt|grass|snow|rock|concrete. */
export function updateCarFx(fx, rec, state, cv, dt, surfaceKind) {
  const rng = fx.rng, root = cv.root, q = root.quaternion, P = root.position;
  const surf = surfOf(surfaceKind);
  const vel = state.vel;
  const speed = Math.abs(state.speed) > 0 ? Math.abs(state.speed) : vel.length();
  const dx = P.x - fx.camPos.x, dy = P.y - fx.camPos.y, dz = P.z - fx.camPos.z, d2 = dx * dx + dy * dy + dz * dz;
  const far = fx.farDist;
  const lod = d2 > far * far ? 0 : 1 - smooth(fx.lodNear, far, Math.sqrt(d2));
  const visible = lod > 0 && fx.inView(P, 26);
  const exploded = state.exploded;
  _f.set(0, 0, 1).applyQuaternion(q); _u.set(0, 1, 0).applyQuaternion(q);
  const upY = _u.y;
  const acc = rec.acc, nW = rec.nW;
  let grndAny = false; for (let i = 0; i < nW; i++) if (state.grounded[i]) { grndAny = true; break; }
  const dc = dustColor(surfaceKind);

  // ---------------------------------------------------------------- wheels: skid marks, tyre smoke, dust, gravel, scrape
  for (let i = 0; i < nW; i++) {
    const node = rec.nodes[i];
    if (!node) continue;
    // contact point = hub - carUp * wheelRadius (hub in root space -> world)
    _w.copy(node.position); if (rec.pm[i]) _w.applyMatrix4(rec.pm[i]);
    _w.y -= rec.R;
    _w.applyQuaternion(q).add(P);
    const gr = state.grounded[i] === 1, slip = state.slip[i], flat = state.flat[i] === 1;
    // hysteresis: mark on at 0.34, off below 0.2 (flat tyres mark whenever rolling)
    let on = rec.skidOn[i] === 1;
    const sl = flat && speed > 3 ? Math.max(slip, 0.5) : slip;
    if (gr && upY > 0.2) { if (!on && sl > 0.34) on = true; else if (on && sl < 0.2) on = false; } else on = false;
    if (on && surf.skid > 0.01 && (visible || d2 < 3600)) {
      const a = clamp01((sl - 0.18) / 0.6) * surf.skid;
      fx.skid.add(rec.id * 16 + i, _w.x, _w.y, _w.z, Math.min(0.92, a), rec.halfW, surf.skidCol[0], surf.skidCol[1], surf.skidCol[2]);
    } else if (rec.skidOn[i] === 1 || on) { if (!on) fx.skid.end(rec.id * 16 + i); }
    rec.skidOn[i] = on ? 1 : 0;
    if (!visible || exploded && speed < 4) continue;
    const front = i < 2;
    if (gr) {
      const sm = surf.smokeK * lod;
      if (sm > 0 && sl > 0.3) {                         // tyre smoke on hard surfaces: thick, white, lingering
        const inten = clamp01((sl - 0.28) / 0.6);
        const n = rate(fx, acc, i * 4, sm * inten * (22 + speed * 0.45) * fx.qd, dt, 3);
        for (let k = 0; k < n; k++)
          puff(fx, _w.x + rng.sym(0.25), _w.y + 0.12, _w.z + rng.sym(0.25), vel.x * 0.22 + rng.sym(1.0), rng.range(0.4, 1.4), vel.z * 0.22 + rng.sym(1.0), 0.6, rng.range(3.0, 4.6), rng.range(1.9, 2.9), 0.86, 0.86, 0.88, 0.34 + 0.34 * inten, 0.32, 0.55, _w.y - 0.05);
      }
      const dk = surf.dustK * lod;
      if (dk > 0) {                                      // dust trail / slip dust on loose surfaces
        const base = Math.pow(clamp01(speed / 32), 1.15) * 7 * (front ? 0.35 : 1);
        const n = rate(fx, acc, i * 4 + 1, dk * (base * 1.6 + sl * 26) * fx.qd, dt, 4);
        for (let k = 0; k < n; k++)
          dust(fx, _w.x + rng.sym(0.25), _w.y + 0.1, _w.z + rng.sym(0.25), vel.x * 0.14 + rng.sym(0.9), rng.range(0.5, 1.8), vel.z * 0.14 + rng.sym(0.9), 0.9, rng.range(3.2, 5.2), rng.range(1.8, 2.8), dc[0], dc[1], dc[2], 0.5, _w.y - 0.05, 1.4, 0.2);
      }
      const sp = surf.spray * lod;
      if (sp > 0 && !front && (sl > 0.3 || speed > 14)) {  // gravel / dirt spray thrown backwards by the driven wheels
        const n = rate(fx, acc, i * 4 + 2, sp * (sl * 14 + speed * 0.12) * fx.qd, dt);
        for (let k = 0; k < n; k++) {
          const s = rng.range(3, 9);
          chip(fx, _w.x, _w.y + 0.15, _w.z, vel.x * 0.7 - _f.x * s + rng.sym(1.8), rng.range(1.5, 5), vel.z * 0.7 - _f.z * s + rng.sym(1.8), rng.range(0.05, 0.11), rng.range(0.5, 1.0), surfaceKind === 'dirt' || surfaceKind === 'sand' ? 6 + rng.int(3) : rng.int(6), _w.y - 0.02);
        }
      }
      if ((flat && speed > 5) || (upY < 0.55 && speed > 5)) {   // rim / body scraping sparks
        const n = rate(fx, acc, i * 4 + 3, (flat ? 20 : 26) * lod * fx.qd, dt);
        for (let k = 0; k < n; k++) { const s = rng.range(3, 9); spark(fx, _w.x, _w.y + 0.05, _w.z, vel.x * 0.5 - _f.x * s + rng.sym(2), rng.range(0.8, 4), vel.z * 0.5 - _f.z * s + rng.sym(2), rng.range(0.2, 0.55), _w.y - 0.01, 0.9, 0.035); }
      }
    }
  }

  // ---------------------------------------------------------------- landing: dust + undercarriage sparks on hard ground
  if (state.airborne) { rec.wasAir = true; rec.airT += dt; }
  else if (rec.wasAir) {
    if (rec.airT > 0.25 && visible && grndAny) {
      const k = clamp01(rec.airT / 1.2);
      for (let i = 0; i < nW; i++) {
        const node = rec.nodes[i]; if (!node) continue;
        _w.copy(node.position); if (rec.pm[i]) _w.applyMatrix4(rec.pm[i]); _w.y -= rec.R; _w.applyQuaternion(q).add(P);
        const n = Math.round((2 + 3 * k) * fx.qd);
        for (let j = 0; j < n; j++) { const a = rng.next() * PI2, sp = rng.range(2, 6 + 4 * k); dust(fx, _w.x, _w.y + 0.1, _w.z, Math.cos(a) * sp + vel.x * 0.1, rng.range(0.3, 1.4), Math.sin(a) * sp + vel.z * 0.1, 0.6, rng.range(2.4, 3.8), rng.range(1.1, 1.8), surf.hard ? 0.55 : dc[0], surf.hard ? 0.52 : dc[1], surf.hard ? 0.48 : dc[2], 0.5, _w.y - 0.05); }
      }
      if (rec.airT > 0.45 && surf.hard) {                // the chassis bottoms out: a shower of sparks off the undercarriage
        rec.toWorld(_v.set(0, 0.12, 0), _w);
        const gy = fx.groundAt(_w.x, _w.z, _w.y - 0.2), ns = Math.round((14 + 22 * k) * fx.qd);
        for (let j = 0; j < ns; j++) {
          const s = rng.range(2, 8), lat = rng.sym(4);
          spark(fx, _w.x + _f.x * rng.sym(1.2), gy + 0.06, _w.z + _f.z * rng.sym(1.2), vel.x * 0.7 - _f.x * s + _f.z * lat, rng.range(0.6, 3.5), vel.z * 0.7 - _f.z * s - _f.x * lat, rng.range(0.25, 0.7), gy, 1.1, 0.04);
        }
        glow(fx, _w.x, gy + 0.2, _w.z, 1.6, 0.08, 4, 2.4, 0.9, false, 1.3);
      }
      fx.shakeReq(P, 0.08 + 0.2 * k, 40);
    }
    rec.wasAir = false; rec.airT = 0;
  }

  if (rec.local && !exploded) {
    ownDamage(fx, rec, state, dt);
    speedStreaks(fx, rec, state, dt, surf, P, speed);
  }
  if (!visible) return;
  const lodQ = lod * fx.qd;

  // ---------------------------------------------------------------- exhaust puffs (subtle)
  if (!exploded && !state.dead && lod > 0.25) {
    const r = (3.5 + state.rpm01 * 9) * lodQ * (state.boosting ? 0.4 : 1);
    for (let s = 0; s < 2; s++) {
      const n = rate(fx, acc, nW * 4 + s, r, dt, 2);
      if (!n) continue;
      rec.toWorld(s === 0 ? rec.sock.exL : rec.sock.exR, _w);
      for (let k = 0; k < n; k++) puff(fx, _w.x, _w.y, _w.z, vel.x * 0.35 - _f.x * 1.2 + rng.sym(0.25), rng.range(0.15, 0.6), vel.z * 0.35 - _f.z * 1.2 + rng.sym(0.25), 0.1, rng.range(0.55, 0.9), rng.range(0.5, 0.85), 0.5, 0.5, 0.52, 0.16 + state.rpm01 * 0.1, 0.15, 0.25);
    }
  }

  // ---------------------------------------------------------------- nitro flames (blue-white jets + orange fringe + hot core)
  if (state.boosting && !exploded && lod > 0.15) {
    for (let s = 0; s < 2; s++) {
      rec.toWorld(s === 0 ? rec.sock.nitL : rec.sock.nitR, _w);
      const n = rate(fx, acc, nW * 4 + 2 + s, 95 * lod * Math.min(fx.qd, 1.3), dt, 4);
      for (let k = 0; k < Math.max(n, 1); k++) {
        const back = rng.range(24, 36);
        const p = fx.p.reset();
        p.pos(_w.x + rng.sym(0.04), _w.y + rng.sym(0.04), _w.z + rng.sym(0.04)).vel(vel.x - _f.x * back + rng.sym(0.3), vel.y - _f.y * back + rng.sym(0.3), vel.z - _f.z * back + rng.sym(0.3));
        p.life = rng.range(0.07, 0.13); p.spr = SPR.FIRE; p.mode = MODE.FLAME; p.f0 = rng.int(FRAMES.FIRE); p.nPlay = FRAMES.FIRE; p.fps = 40; p.len = rng.range(3.4, 5.0); p.size(rng.range(0.5, 0.7), 0.3); p.mono = 1;
        p.col0(1.2, 2.6, 7.5, 1).col1(0.7, 0.9, 3.4, 1); p.add0 = p.add1 = 1; p.fin = 0.03; p.fout = 0.5; fx.pf.emit(p);
        if ((k & 1) === 0) {                               // orange outer fringe
          p.reset(); p.pos(_w.x, _w.y, _w.z).vel(vel.x - _f.x * back * 0.7, vel.y - _f.y * back * 0.7, vel.z - _f.z * back * 0.7); p.life = rng.range(0.1, 0.17);
          p.spr = SPR.FIRE; p.mode = MODE.FLAME; p.f0 = rng.int(FRAMES.FIRE); p.nPlay = FRAMES.FIRE; p.fps = 30; p.len = rng.range(2.0, 3.0); p.size(0.85, 0.4); p.col(1.3, 0.55, 0.16, 0.5); p.add0 = p.add1 = 1; p.fin = 0.03; p.fout = 0.6; fx.pf.emit(p);
        }
      }
      // white-hot core at the nozzle (+ a few bright streak sparks)
      glow(fx, _w.x - _f.x * 0.2, _w.y, _w.z - _f.z * 0.2, 0.9 + rng.next() * 0.3, 0.06, 4, 5, 9, false, 1.2);
      glow(fx, _w.x - _f.x * 1.3, _w.y, _w.z - _f.z * 1.3, 0.7, 0.05, 2.5, 3.5, 7, false, 1.2);
      if (rng.next() < 0.35 * fx.qd) { const sp = rng.range(14, 28); spark(fx, _w.x, _w.y, _w.z, vel.x - _f.x * sp + rng.sym(3), vel.y + rng.range(-1, 3), vel.z - _f.z * sp + rng.sym(3), rng.range(0.2, 0.45), _w.y - 0.6, 0.6, 0.03); }
      // faint heat haze
      const nh = rate(fx, acc, nW * 4 + 4 + s, 16 * lod, dt, 1);
      for (let k = 0; k < nh; k++) { const p2 = fx.p.reset(); p2.pos(_w.x - _f.x * 1.2, _w.y + 0.1, _w.z - _f.z * 1.2).vel(vel.x - _f.x * 6 + rng.sym(0.6), vel.y + rng.range(0.4, 1.4), vel.z - _f.z * 6 + rng.sym(0.6)); p2.life = rng.range(0.4, 0.7); p2.spr = SPR.SMOKE_FLAT; p2.f0 = rng.int(4) * 4; p2.nPlay = 4; p2.size(0.6, 2.2); p2.col(0.55, 0.75, 1.2, 0.09); p2.add0 = p2.add1 = 0.85; p2.fin = 0.1; p2.fout = 0.7; p2.rot = rng.next() * PI2; p2.drag = 1.5; fx.pf.emit(p2); }
    }
  }

  // ---------------------------------------------------------------- damage (other cars): engine smoke, fire streaming back
  if ((state.smoking || state.burning) && !exploded && !state.dead && !rec.local) {
    rec.toWorld(rec.sock.engine, _w);
    const dark = state.burning ? 1 : 1 - clamp01((state.engineHp01 ?? 0.3) * 1.6);
    const n = rate(fx, acc, nW * 4 + 6, (state.burning ? 28 : 18) * lodQ * (0.6 + 0.4 * clamp01(speed / 20)), dt, 3);
    const g = 0.42 - 0.36 * dark;
    for (let k = 0; k < n; k++) puff(fx, _w.x + rng.sym(0.3), _w.y + 0.25, _w.z + rng.sym(0.3), vel.x * 0.85 - _f.x * 0.8 + rng.sym(0.5), rng.range(1.6, 3.2) + dark, vel.z * 0.85 - _f.z * 0.8 + rng.sym(0.5), 0.9, rng.range(2.8, 4.2) + dark * 1.4, rng.range(1.6, 2.8), g, g * 0.97, g * 0.94, 0.6, 0.9, 0.9, -1e4, state.burning ? 1.2 : 0);
    if (state.burning) {
      const nf = rate(fx, acc, nW * 4 + 7, 22 * lodQ, dt, 3);
      const W = rec.spec.width;
      for (let k = 0; k < nf; k++) {
        const w = rng.range(0.45, 0.75) * Math.sqrt(W / 1.9);
        flame(fx, _w.x + _f.z * rng.sym(W * 0.28) + rng.sym(0.15), _w.y + 0.2, _w.z - _f.x * rng.sym(W * 0.28) + rng.sym(0.15), vel.x * 0.92 + rng.sym(0.4), vel.y * 0.5 + rng.range(0.6, 1.6), vel.z * 0.92 + rng.sym(0.4), w, w * rng.range(1.8, 2.6), rng.range(0.35, 0.6), 1.1, 2.4, 0, 1.3, 1.3);
      }
      if (rng.next() < 0.25 * dt * 60) ember(fx, _w.x, _w.y, _w.z, vel.x * 0.8 + rng.sym(1.5), rng.range(2, 5), vel.z * 0.8 + rng.sym(1.5), rng.range(0.8, 1.6), 0.14, 0.9);
    }
  }
}

// Per-car continuous effects: tyre smoke / dust / gravel spray, skid marks, exhaust, nitro jets, engine smoke / fire, scrape sparks,
// landing dust. All emitters use per-wheel accumulators (no allocation) and scale with distance + quality.
import * as THREE from 'three';
import { SPR } from './atlas.js';
import { MODE } from './particles.js';
import { spark, puff, dust, chip, ember, glow } from './recipes.js';
import { surfOf, clamp01, smooth } from './util.js';
import { makeWreckUniforms, patchPaint } from './wreck.js';

const PI2 = Math.PI * 2;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();

export class CarRec {
  constructor(state, cv) {
    this.cv = cv; this.id = state.id; this.spec = state.spec;
    const spec = state.spec, nW = spec.wheels.length;
    this.nW = nW; this.R = spec.wheelRadius;
    this.nodes = new Array(nW).fill(null); this.pm = new Array(nW).fill(null);
    this.acc = new Float32Array(nW * 4 + 16);
    this.skidOn = new Uint8Array(nW);
    this.halfW = clamp01(spec.wheelRadius * 0.62) * 0.5 + 0.08;
    this.sock = {}; this.wasAir = false; this.airT = 0; this.dead = false;
    this.wreckU = makeWreckUniforms(); this.wrecked = false;
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
    // paint patch: compile the wreck shader variant now, not on explosion
    cv.root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && /^paint/.test(m.name)) patchPaint(m, this.wreckU); });
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
      if (sm > 0 && sl > 0.3) {                         // tyre smoke on hard surfaces
        const inten = clamp01((sl - 0.28) / 0.6);
        const n = rate(fx, acc, i * 4, sm * inten * (26 + speed * 0.5) * fx.qd, dt, 4);
        for (let k = 0; k < n; k++)
          puff(fx, _w.x + rng.sym(0.25), _w.y + 0.08, _w.z + rng.sym(0.25), vel.x * 0.16 + rng.sym(0.9), rng.range(0.5, 1.7), vel.z * 0.16 + rng.sym(0.9), 0.5, rng.range(2.4, 3.6), rng.range(1.2, 1.9), 0.9, 0.9, 0.93, 0.3 * (0.5 + 0.5 * inten), 0.35, 0.5, _w.y - 0.05);
      }
      const dk = surf.dustK * lod;
      if (dk > 0) {                                      // dust trail / slip dust on loose surfaces
        const base = Math.pow(clamp01(speed / 32), 1.15) * 7 * (front ? 0.35 : 1);
        const n = rate(fx, acc, i * 4 + 1, dk * (base * 1.6 + sl * 26) * fx.qd, dt, 4);
        const d = surf.dust;
        for (let k = 0; k < n; k++)
          dust(fx, _w.x + rng.sym(0.25), _w.y + 0.1, _w.z + rng.sym(0.25), vel.x * 0.14 + rng.sym(0.9), rng.range(0.5, 1.8), vel.z * 0.14 + rng.sym(0.9), 0.9, rng.range(3.0, 4.8), rng.range(1.6, 2.5), d[0], d[1], d[2], 0.42, _w.y - 0.05, 1.4, 0.2);
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

  // ---------------------------------------------------------------- landing dust
  if (state.airborne) { rec.wasAir = true; rec.airT += dt; }
  else if (rec.wasAir) {
    if (rec.airT > 0.25 && visible && grndAny) {
      const k = clamp01(rec.airT / 1.2);
      for (let i = 0; i < nW; i++) {
        const node = rec.nodes[i]; if (!node) continue;
        _w.copy(node.position); if (rec.pm[i]) _w.applyMatrix4(rec.pm[i]); _w.y -= rec.R; _w.applyQuaternion(q).add(P);
        const d = surf.dust, n = Math.round((2 + 3 * k) * fx.qd);
        for (let j = 0; j < n; j++) { const a = rng.next() * PI2, sp = rng.range(2, 6 + 4 * k); dust(fx, _w.x, _w.y + 0.1, _w.z, Math.cos(a) * sp + vel.x * 0.1, rng.range(0.3, 1.4), Math.sin(a) * sp + vel.z * 0.1, 0.6, rng.range(2.2, 3.6), rng.range(1.0, 1.7), surf.hard ? 0.6 : d[0], surf.hard ? 0.55 : d[1], surf.hard ? 0.5 : d[2], 0.45, _w.y - 0.05); }
      }
      if (!surf.hard || true) fx.shakeReq(P, 0.08 + 0.2 * k, 40);
    }
    rec.wasAir = false; rec.airT = 0;
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
        p.life = rng.range(0.07, 0.13); p.spr = SPR.FIRE; p.mode = MODE.FLAME; p.f0 = rng.int(16); p.nPlay = 16; p.fps = 40; p.len = rng.range(3.4, 5.0); p.size(rng.range(0.5, 0.7), 0.3); p.mono = 1;
        p.col0(1.2, 2.6, 7.5, 1).col1(0.7, 0.9, 3.4, 1); p.add0 = p.add1 = 1; p.fin = 0.03; p.fout = 0.5; fx.pf.emit(p);
        if ((k & 1) === 0) {                               // orange outer fringe
          p.reset(); p.pos(_w.x, _w.y, _w.z).vel(vel.x - _f.x * back * 0.7, vel.y - _f.y * back * 0.7, vel.z - _f.z * back * 0.7); p.life = rng.range(0.1, 0.17);
          p.spr = SPR.FIRE; p.mode = MODE.FLAME; p.f0 = rng.int(16); p.nPlay = 16; p.fps = 30; p.len = rng.range(2.0, 3.0); p.size(0.85, 0.4); p.col(1.3, 0.55, 0.16, 0.5); p.add0 = p.add1 = 1; p.fin = 0.03; p.fout = 0.6; fx.pf.emit(p);
        }
      }
      // white-hot core at the nozzle (+ a few bright streak sparks)
      glow(fx, _w.x - _f.x * 0.2, _w.y, _w.z - _f.z * 0.2, 0.9 + rng.next() * 0.3, 0.06, 4, 5, 9, false, 1.2);
      glow(fx, _w.x - _f.x * 1.3, _w.y, _w.z - _f.z * 1.3, 0.7, 0.05, 2.5, 3.5, 7, false, 1.2);
      if (rng.next() < 0.35 * fx.qd) { const sp = rng.range(14, 28); spark(fx, _w.x, _w.y, _w.z, vel.x - _f.x * sp + rng.sym(3), vel.y + rng.range(-1, 3), vel.z - _f.z * sp + rng.sym(3), rng.range(0.2, 0.45), _w.y - 0.6, 0.6, 0.03); }
      // faint heat haze
      const nh = rate(fx, acc, nW * 4 + 4 + s, 16 * lod, dt, 1);
      for (let k = 0; k < nh; k++) { const p2 = fx.p.reset(); p2.pos(_w.x - _f.x * 1.2, _w.y + 0.1, _w.z - _f.z * 1.2).vel(vel.x - _f.x * 6 + rng.sym(0.6), vel.y + rng.range(0.4, 1.4), vel.z - _f.z * 6 + rng.sym(0.6)); p2.life = rng.range(0.4, 0.7); p2.spr = SPR.SMOKE; p2.f0 = rng.int(4) * 4; p2.nPlay = 4; p2.size(0.6, 2.2); p2.col(0.55, 0.75, 1.2, 0.09); p2.add0 = p2.add1 = 0.85; p2.fin = 0.1; p2.fout = 0.7; p2.rot = rng.next() * PI2; p2.drag = 1.5; fx.pf.emit(p2); }
    }
  }

  // ---------------------------------------------------------------- damage: engine smoke, fire
  if ((state.smoking || state.burning) && !exploded && !state.dead) {
    rec.toWorld(rec.sock.engine, _w);
    const dark = state.burning ? 1 : 1 - clamp01((state.engineHp01 ?? 0.3) * 1.6);
    const n = rate(fx, acc, nW * 4 + 6, (state.burning ? 22 : 13) * lodQ, dt, 3);
    const g = 0.75 - 0.6 * dark;
    for (let k = 0; k < n; k++) puff(fx, _w.x + rng.sym(0.3), _w.y + 0.1, _w.z + rng.sym(0.3), vel.x * 0.75 - _f.x * 0.8 + rng.sym(0.5), rng.range(1.6, 3.2) + dark, vel.z * 0.75 - _f.z * 0.8 + rng.sym(0.5), 0.5, rng.range(2.4, 3.8) + dark * 1.4, rng.range(1.5, 2.6), g * 0.4, g * 0.4, g * 0.42, 0.7, 0.9, 0.5);
    if (state.burning) {
      const nf = rate(fx, acc, nW * 4 + 7, 16 * lodQ, dt, 3);
      for (let k = 0; k < nf; k++) {
        const p = fx.p.reset(); p.pos(_w.x + rng.sym(0.45), _w.y - 0.05, _w.z + rng.sym(0.45)).vel(vel.x * 0.85 - _f.x * 1.2 + rng.sym(0.4), rng.range(1.5, 3), vel.z * 0.85 - _f.z * 1.2 + rng.sym(0.4));
        p.life = rng.range(0.35, 0.6); p.spr = SPR.FIRE; p.mode = MODE.UPRIGHT; p.pivot = 1; p.aspect = 1.6; p.f0 = rng.int(16); p.nPlay = 16; p.fps = 26; p.size(rng.range(0.6, 0.9), 0.35); p.drag = 1.2;
        p.col(2.2, 1.6, 1.1, 1); p.add0 = p.add1 = 1; p.fin = 0.06; p.fout = 0.55; fx.pf.emit(p);
      }
      if (rng.next() < 0.25 * dt * 60) ember(fx, _w.x, _w.y, _w.z, vel.x * 0.8 + rng.sym(1.5), rng.range(2, 5), vel.z * 0.8 + rng.sym(1.5), rng.range(0.8, 1.6), 0.14, 0.9);
    }
  }
}

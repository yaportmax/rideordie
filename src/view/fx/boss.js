// THE LEVIATHAN effects: flamethrower jets, cannon charge + blast, part-destroyed fires that stay attached to the moving
// war-train, rear ramp scrape, deflection sparks, phase-3 stack smoke, the dying burn and the final mushroom cloud.
// Everything attached to the boss is stored in the boss model frame and re-projected every frame from the view root
// (ctx.carViews.get(BOSS_ID).root); particles inherit the boss velocity so fire/smoke streams back as it drives.
import * as THREE from 'three';
import { SPR } from './atlas.js';
import { MODE } from './particles.js';
import * as R from './recipes.js';
import { clamp01, smooth } from './util.js';
import { BOSS_ID, BOSS_SOCKETS, BOSS_BODY, BOSS_PARTS } from '../../data/boss.js';

const PI2 = Math.PI * 2;
const BJ = { FLAME: 1, CHARGE: 2, FIRE: 3, DYING: 4, RAMP: 5, MUSH: 6 };
class BJob {
  constructor() { this.type = 0; this.t = 0; this.dur = 0; this.side = 1; this.k = 1; this.att = false; this.lx = 0; this.ly = 0; this.lz = 0; this.x = 0; this.y = 0; this.z = 0; this.gy = 0; this.a0 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.stop = false; this.final = -1; }
}
const _w = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3(), _l = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const FALLBACK_BOX = [{ center: [0, 3.0, 0], half: [3.3, 2.5, 17] }];

export class BossFx {
  constructor(fx) {
    this.fx = fx; this.jobs = []; for (let i = 0; i < 40; i++) this.jobs.push(new BJob());
    this.view = null; this.root = null; this.vel = new THREE.Vector3(); this._prev = new THREE.Vector3(); this._hasPrev = false;
    this.phase = 1; this.dying = false; this.stackGone = [false, false]; this.lastCannonT = -9; this.acc = new Float32Array(8);
    this._sock = new Map(); this.lod = 0; this.visible = false;
    this.pos = new THREE.Vector3();
  }

  // ------------------------------------------------------------------------------------------------ frame helpers
  _findView() { const m = this.fx._views; const v = m && m.get(BOSS_ID); return v && v.root ? v : null; }
  /** Model-frame position of a socket (from the live node, else the extracted model info). Returns null if unknown. */
  local(name, out) {
    const v = this.view;
    const n = v && v.sockets && v.sockets[name];
    if (n) {
      if (n.parent === v.root) return out.copy(n.position);
      let c = this._sock.get(name);
      if (!c) { v.root.updateMatrixWorld(true); _m.copy(v.root.matrixWorld).invert(); c = new THREE.Vector3().setFromMatrixPosition(n.matrixWorld).applyMatrix4(_m); this._sock.set(name, c); }
      return out.copy(c);
    }
    const s = BOSS_SOCKETS && BOSS_SOCKETS[name];
    return s ? out.set(s[0], s[1], s[2]) : null;
  }
  toWorld(local, out) { const r = this.root; return r ? out.copy(local).applyQuaternion(r.quaternion).add(r.position) : out.copy(local); }
  dirWorld(x, y, z, out) { out.set(x, y, z); if (this.root) out.applyQuaternion(this.root.quaternion); return out; }
  toLocal(x, y, z, out) { const r = this.root; out.set(x - r.position.x, y - r.position.y, z - r.position.z); _q.copy(r.quaternion).invert(); return out.applyQuaternion(_q); }
  /** World position of job j (attached jobs follow the root; they keep their last position if the root disappears). */
  jobPos(j, out) {
    if (j.att && this.root) { this.toWorld(_l.set(j.lx, j.ly, j.lz), out); j.x = out.x; j.y = out.y; j.z = out.z; return out; }
    return out.set(j.x, j.y, j.z);
  }
  _job(type) { for (const j of this.jobs) if (j.type === 0) { j.type = type; j.t = 0; j.a0 = j.a1 = j.a2 = j.a3 = 0; j.stop = false; j.att = false; j.final = -1; j.k = 1; return j; } return null; }
  _attach(j, x, y, z) {
    j.x = x; j.y = y; j.z = z;
    if (this.root) { this.toLocal(x, y, z, _l); j.lx = _l.x; j.ly = _l.y; j.lz = _l.z; j.att = true; }
    j.gy = this.fx.groundAt(x, z, this.root ? this.root.position.y : y - 4);
  }
  _rate(j, key, r, dt, cap = 6) { let a = j[key] + r * dt, n = 0; while (a >= 1 && n < cap) { a -= 1; n++; } j[key] = a > 1 ? 1 : a; return n; }
  _gy(x, z) { return this.fx.groundAt(x, z, this.root ? this.root.position.y : this.pos.y); }

  // ------------------------------------------------------------------------------------------------ events
  handleEvent(e, ctx) {
    const fx = this.fx;
    this.view = this._findView(); this.root = this.view ? this.view.root : null;
    const p = e.pos || (this.root ? [this.root.position.x, this.root.position.y, this.root.position.z] : [0, 0, 0]);
    switch (e.t) {
      case 'bossSpawn': this.phase = 1; this.dying = false; this.stackGone[0] = this.stackGone[1] = false; break;
      case 'bossPhase':
        this.phase = e.phase | 0;
        if (this.phase >= 2) this._stackBurst(this.phase === 3 ? 1 : 0.5);
        if (this.phase === 3) { _w.set(p[0], p[1], p[2]); fx.shakeReq(_w, 0.25, 90); }
        break;
      case 'bossFlame': {
        const side = e.side === 'R' ? -1 : 1;
        for (const j of this.jobs) if (j.type === BJ.FLAME && j.side === side) j.stop = true;
        if (e.on) { const j = this._job(BJ.FLAME); if (j) { j.side = side; j.dur = 40; j.x = p[0]; j.y = p[1]; j.z = p[2]; j.gy = fx.groundAt(p[0], p[2], p[1] - 4); } }
        break;
      }
      case 'bossCharge': {
        for (const j of this.jobs) if (j.type === BJ.CHARGE) j.type = 0;
        const j = this._job(BJ.CHARGE); if (!j) break;
        j.dur = 1.3; j.x = p[0]; j.y = p[1]; j.z = p[2];
        break;
      }
      case 'bossCannon': {
        if (fx.time - this.lastCannonT < 0.25) break;                     // the matching 'shot' {weapon:'cannon'} already drew it
        this.dirWorld(0, 0.02, 1, _d).normalize();
        this.cannonBlast(p[0], p[1], p[2], _d.x, _d.y, _d.z);
        break;
      }
      case 'bossPart': this._part(e, p); break;
      case 'bossDeflect': this._deflect(p); break;
      case 'bossVolley': this._volley(); break;
      case 'bossRamp': {
        const j = this._job(BJ.RAMP); if (!j) break;
        j.dur = 2.4; this._attach(j, p[0], p[1], p[2]);
        break;
      }
      case 'bossDying': {
        this.dying = true;
        for (const j of this.jobs) if (j.type === BJ.FLAME || j.type === BJ.CHARGE) j.stop = true;
        const j = this._job(BJ.DYING); if (!j) break;
        j.dur = 1e9; j.x = p[0]; j.y = p[1]; j.z = p[2]; j.gy = fx.groundAt(p[0], p[2], p[1]);
        _w.set(p[0], p[1], p[2]); fx.shakeReq(_w, 0.45, 150);
        break;
      }
      default: break;
    }
  }

  /** `explode` events with spec 'boss': chained blasts while dying, then the size-3.5 finale. */
  explode(e) {
    const fx = this.fx, p = e.pos, S = e.size || 1.6;
    this.view = this._findView(); this.root = this.view ? this.view.root : null;
    const gy = fx.groundAt(p[0], p[2], this.root ? this.root.position.y : p[1] - 3);
    _w.set(p[0], p[1], p[2]);
    if (S >= 3) {
      R.megaExplosion(fx, p[0], Math.max(p[1], gy + 2), p[2], gy);
      const j = this._job(BJ.MUSH); if (j) { j.x = p[0]; j.y = p[1]; j.z = p[2]; j.gy = gy; j.dur = 16; }
      for (const d of this.jobs) if (d.type === BJ.DYING) d.final = d.t;
      fx.shakeReq(_w, 1.0, 320);
    } else {
      R.explosion(fx, p[0], p[1], p[2], Math.min(S, 1.8), { ground: gy, paint: 0x2a2622, column: false, pops: 1 });
      fx.shakeReq(_w, 0.7, 160);
    }
  }

  /** Main cannon muzzle blast (from the 'shot' {weapon:'cannon'} event, which carries the aim direction). */
  cannonBlast(x, y, z, dx, dy, dz) {
    const fx = this.fx;
    this.lastCannonT = fx.time;
    for (const j of this.jobs) if (j.type === BJ.CHARGE) j.type = 0;
    if (!fx.near(x, y, z, 600)) return;
    R.cannonBlast(fx, x, y, z, dx, dy, dz, this.vel.x, this.vel.y, this.vel.z, fx.groundAt(x, z, y - 5));
    _w.set(x, y, z); fx.shakeReq(_w, 0.6, 120);
  }

  _part(e, p) {
    const fx = this.fx, r = fx.rng, name = e.part || '';
    const def = BOSS_PARTS[name] || {};
    const k = def.explodes || /tank|engine/.test(name) ? 1.0 : /turret_main/.test(name) ? 0.9 : /turret|pod/.test(name) ? 0.7 : /stack|plow/.test(name) ? 0.5 : 0.32;
    if (name === 'part_stack_L') this.stackGone[0] = true;
    if (name === 'part_stack_R') this.stackGone[1] = true;
    const gy = fx.groundAt(p[0], p[2], this.root ? this.root.position.y : p[1] - 4);
    const vx = this.vel.x, vz = this.vel.z;
    if (fx.near(p[0], p[1], p[2], 400)) {
      // hot metal: sparks, flash, torn plates flung off (the fireball itself comes with the sim's 'boom' for core/explosive parts)
      const ns = Math.round((24 + 36 * k) * fx.qd);
      for (let i = 0; i < ns; i++) { const a = r.next() * PI2, sp = r.range(6, 24); R.spark(fx, p[0], p[1], p[2], vx * 0.8 + Math.cos(a) * sp, r.range(2, 14), vz * 0.8 + Math.sin(a) * sp, r.range(0.4, 1.2), gy, 1.1, 0.05); }
      R.glow(fx, p[0], p[1], p[2], 4 + 5 * k, 0.12, 8, 5, 2, true, 1.6);
      fx.debrisBurst(p[0], p[1], p[2], 0.35 + 0.55 * k, gy, 0x2a2622);
      if (!def.explodes && !def.core) R.miniPop(fx, p[0], p[1], p[2], 0.35 + 0.2 * k, gy);
      _w.set(p[0], p[1], p[2]); fx.shakeReq(_w, 0.2 + 0.3 * k, 90);
    }
    // lingering fire that rides the boss (armour panels only smoulder for a while)
    let j = this._job(BJ.FIRE);
    if (!j) { let weakest = null; for (const o of this.jobs) if (o.type === BJ.FIRE && (!weakest || o.k < weakest.k)) weakest = o; if (weakest && weakest.k <= k) { j = weakest; j.t = 0; j.a0 = j.a1 = j.a2 = 0; } }
    if (!j) return;
    j.k = k; j.dur = k < 0.4 ? 22 : 1e9; this._attach(j, p[0], p[1], p[2]);
  }

  _deflect(p) {
    const fx = this.fx, r = fx.rng;
    if (!fx.near(p[0], p[1], p[2], 200)) return;
    // armour normal from the hit's position in the boss frame (flank / roof / front-back), else toward the camera
    if (this.root) {
      this.toLocal(p[0], p[1], p[2], _l);
      if (Math.abs(_l.x) > 2.9) this.dirWorld(Math.sign(_l.x), 0.15, 0, _d); else if (_l.y > 5.8) this.dirWorld(0, 1, 0, _d); else this.dirWorld(0, 0.1, Math.sign(_l.z), _d);
    } else _d.set(fx.camPos.x - p[0], fx.camPos.y - p[1], fx.camPos.z - p[2]);
    _d.normalize();
    const vx = this.vel.x * 0.9, vy = this.vel.y * 0.9, vz = this.vel.z * 0.9;
    const n = Math.round(10 * fx.qd) + 3;
    for (let i = 0; i < n; i++) { const D = R.coneDir(r, _d.x, _d.y, _d.z, 0.9), sp = r.range(10, 28); R.spark(fx, p[0], p[1], p[2], vx + D.x * sp, vy + D.y * sp + 1, vz + D.z * sp, r.range(0.15, 0.45), p[1] - 8, 1.3, 0.035); }
    const D = R.coneDir(r, _d.x, _d.y, _d.z, 0.6);                              // the ricochet itself: one fast bright streak
    const q = fx.p.reset(); q.pos(p[0], p[1], p[2]).vel(vx + D.x * 110, vy + D.y * 110, vz + D.z * 110); q.life = 0.1; q.spr = SPR.STREAK; q.mode = MODE.STREAK; q.len = 3.5; q.size(0.07);
    q.col(8, 6.5, 4, 1); q.add0 = q.add1 = 1; q.fin = 0; q.fout = 0.4; fx.pf.emit(q);
    R.glow(fx, p[0] + _d.x * 0.1, p[1] + _d.y * 0.1, p[2] + _d.z * 0.1, 0.9, 0.06, 8, 7, 5, false, 1.3);
    R.puff(fx, p[0], p[1], p[2], vx + _d.x, vy + _d.y + 0.6, vz + _d.z, 0.15, 0.8, 0.7, 0.6, 0.58, 0.55, 0.25, 0.3, 0.3);
  }

  _volley() {
    const fx = this.fx, r = fx.rng; if (!this.root) return;
    for (const name of ['rocket_pod_L', 'rocket_pod_R']) {
      if (!this.local(name, _l)) continue;
      this.toWorld(_l, _w); if (!fx.near(_w.x, _w.y, _w.z, 300)) continue;
      R.glow(fx, _w.x, _w.y + 0.3, _w.z, 2.2, 0.35, 6, 1.4, 0.5, false, 1.3);            // red warning flare before the salvo
      for (let i = 0; i < 6; i++) R.spark(fx, _w.x, _w.y + 0.3, _w.z, this.vel.x + r.sym(5), r.range(2, 6), this.vel.z + r.sym(5), r.range(0.2, 0.5), _w.y - 7, 0.9, 0.03);
      R.puff(fx, _w.x, _w.y, _w.z, this.vel.x * 0.8 + r.sym(1), 1.5, this.vel.z * 0.8 + r.sym(1), 0.4, 2.2, 1.4, 0.8, 0.8, 0.8, 0.45, 0.4, 0.3);
    }
  }

  /** Belch of sparks/smoke from the exhaust stacks (phase change). */
  _stackBurst(k) {
    const fx = this.fx, r = fx.rng; if (!this.root) return;
    for (let s = 0; s < 2; s++) {
      if (this.stackGone[s] || !this.local(s ? 'smoke_stack_R' : 'smoke_stack_L', _l)) continue;
      this.toWorld(_l, _w);
      for (let i = 0; i < 16 * k; i++) R.spark(fx, _w.x, _w.y, _w.z, this.vel.x + r.sym(4), r.range(6, 16), this.vel.z + r.sym(4), r.range(0.5, 1.2), _w.y - 9, 1, 0.045);
      for (let i = 0; i < 5; i++) R.puff(fx, _w.x, _w.y + 0.5, _w.z, this.vel.x * 0.8 + r.sym(1), r.range(5, 9), this.vel.z * 0.8 + r.sym(1), 1, r.range(4, 6), r.range(3, 4.5), 0.08, 0.075, 0.07, 0.9, 1, 0.4);
      R.glow(fx, _w.x, _w.y + 0.4, _w.z, 2.4, 0.15, 5, 2.4, 0.6, true, 1.5);
    }
  }

  // ------------------------------------------------------------------------------------------------ per frame
  update(dt) {
    const fx = this.fx;
    const v = this._findView();
    if (v !== this.view) { this.view = v; this._hasPrev = false; this._sock.clear(); }
    this.root = v ? v.root : null;
    if (this.root) {
      const P = this.root.position;
      if (this._hasPrev && dt > 0) { _t.copy(P).sub(this._prev).multiplyScalar(1 / dt); if (_t.lengthSq() < 120 * 120) this.vel.lerp(_t, 1 - Math.exp(-dt * 12)); }
      this._prev.copy(P); this._hasPrev = true; this.pos.copy(P);
      const d = fx.dist(P.x, P.y, P.z);
      this.lod = (1 - smooth(fx.lodNear * 1.5, fx.farDist * 1.8, d)) * fx.qd;
      this.visible = this.lod > 0 && fx.inView(P, 30);
      if (this.visible && !this.dying) this._stacks(dt);
    } else { this.vel.multiplyScalar(Math.exp(-dt * 3)); this.lod = 0; this.visible = false; }
    let any = false;
    for (const j of this.jobs) {
      if (j.type === 0) continue;
      any = true; j.t += dt;
      switch (j.type) {
        case BJ.FLAME: this._flame(j, dt); break;
        case BJ.CHARGE: this._charge(j, dt); break;
        case BJ.FIRE: this._fire(j, dt); break;
        case BJ.DYING: this._dying(j, dt); break;
        case BJ.RAMP: this._ramp(j, dt); break;
        case BJ.MUSH: this._mush(j, dt); break;
        default: j.type = 0;
      }
    }
    return any;
  }

  /** Stack exhaust: light grey normally, thick black + sparks + flame belches when enraged (phase 3). */
  _stacks(dt) {
    const fx = this.fx, r = fx.rng, V = this.vel, lod = this.lod, rage = this.phase >= 3;
    for (let s = 0; s < 2; s++) {
      if (this.stackGone[s] || !this.local(s ? 'smoke_stack_R' : 'smoke_stack_L', _l)) continue;
      this.toWorld(_l, _w);
      let a = this.acc[s] + (rage ? 16 : 5) * lod * dt, n = 0; while (a >= 1 && n < 4) { a -= 1; n++; } this.acc[s] = Math.min(a, 1);
      for (let i = 0; i < n; i++) {
        if (rage) R.puff(fx, _w.x + r.sym(0.2), _w.y + 0.3, _w.z + r.sym(0.2), V.x * 0.85 + r.sym(0.8), V.y + r.range(6, 10), V.z * 0.85 + r.sym(0.8), 0.9, r.range(5, 8), r.range(3.5, 5.5), 0.06, 0.055, 0.052, 0.92, 1.1, 0.5);
        else R.puff(fx, _w.x, _w.y + 0.3, _w.z, V.x * 0.85 + r.sym(0.5), V.y + r.range(3, 5), V.z * 0.85 + r.sym(0.5), 0.5, r.range(2.5, 3.5), r.range(2, 3), 0.35, 0.34, 0.33, 0.28, 0.8, 0.4);
      }
      if (rage) {
        let b = this.acc[2 + s] + 7 * lod * dt; while (b >= 1) { b -= 1; R.spark(fx, _w.x, _w.y + 0.2, _w.z, V.x * 0.9 + r.sym(3), r.range(5, 13), V.z * 0.9 + r.sym(3), r.range(0.5, 1.1), _w.y - 9, 1, 0.04); } this.acc[2 + s] = b;
        if (r.next() < dt * 1.2) {                                             // flame belch
          for (let i = 0; i < 3; i++) { const q = fx.p.reset(); q.pos(_w.x, _w.y + 0.2, _w.z).vel(V.x * 0.95 + r.sym(0.6), r.range(6, 10), V.z * 0.95 + r.sym(0.6)); q.spr = SPR.FIRE; q.mode = MODE.UPRIGHT; q.pivot = 1; q.aspect = 1.6; q.f0 = r.int(16); q.nPlay = 16; q.fps = 30; q.size(r.range(1.2, 1.8), 0.6); q.drag = 1.2; q.life = r.range(0.3, 0.5); q.col(2.2, 1.3, 0.55, 1); q.add0 = q.add1 = 1; q.fin = 0.05; q.fout = 0.6; fx.pf.emit(q); }
          R.glow(fx, _w.x, _w.y + 0.8, _w.z, 2.5, 0.12, 4, 2, 0.5, true, 1.4);
        }
      }
    }
  }

  _flame(j, dt) {
    const fx = this.fx, r = fx.rng;
    if (j.stop || j.t > j.dur) { j.type = 0; return; }
    const side = j.side;
    if (this.root && this.local(side > 0 ? 'flame_L' : 'flame_R', _l)) this.toWorld(_l, _w); else _w.set(j.x, j.y, j.z);
    j.x = _w.x; j.y = _w.y; j.z = _w.z;
    if (!fx.near(_w.x, _w.y, _w.z, fx.farDist * 1.6)) return;
    this.dirWorld(side, -0.07, 0.04, _d).normalize();
    const Dx = _d.x, Dy = _d.y, Dz = _d.z, V = this.vel, gy = this._gy(_w.x, _w.z);
    j.gy = gy;
    const q = Math.max(0.35, fx.qd), first = j.t < 0.12;
    // turbulent fire licks (fire sheet, spinning billboards) - the body of the jet
    let n = this._rate(j, 'a0', 80 * q, dt, 8) + (first ? 6 : 0);
    for (let i = 0; i < n; i++) {
      const D = R.coneDir(r, Dx, Dy, Dz, 0.11), sp = r.range(24, 34), o = r.range(0, 0.6);
      const p = fx.p.reset(); p.pos(_w.x + D.x * o, _w.y + D.y * o, _w.z + D.z * o).vel(V.x + D.x * sp, V.y + D.y * sp, V.z + D.z * sp);
      p.spr = SPR.FIRE; p.f0 = r.int(16); p.nPlay = 16; p.fps = 30; p.rot = r.next() * PI2; p.rotV = r.sym(2.5);
      p.size(r.range(0.5, 0.8), r.range(3.8, 5.4)); p.sCurve = 0.6; p.drag = 1.7; p.grav = -2.5; p.life = r.range(0.5, 0.72); p.ground = gy;
      p.col0(2.6, 1.7, 0.9, 1).col1(1.4, 0.38, 0.08, 0.9); p.cCurve = 0.8; p.add0 = p.add1 = 1; p.fin = 0.02; p.fout = 0.45;
      fx.pf.emit(p);
    }
    // billowing fireballs that roll out and cool into black smoke
    n = this._rate(j, 'a1', 26 * q, dt, 4) + (first ? 4 : 0);
    for (let i = 0; i < n; i++) {
      const D = R.coneDir(r, Dx, Dy, Dz, 0.18), sp = r.range(14, 24), o = r.range(1, 3);
      const p = fx.p.reset(); p.pos(_w.x + D.x * o, _w.y + D.y * o, _w.z + D.z * o).vel(V.x + D.x * sp, V.y + D.y * sp + 1, V.z + D.z * sp);
      p.spr = SPR.SMOKE; p.f0 = r.int(4) * 4; p.nPlay = 4; p.size(1.2, r.range(5, 7.5)); p.sCurve = 0.45; p.rot = r.sym(0.6); p.rotV = r.sym(0.4);
      p.drag = 1.5; p.grav = -3; p.life = r.range(1.0, 1.5); p.ground = gy; p.lit = 0.4; p.turb = 0.5;
      p.col0(4.2, 1.6, 0.3, 1).col1(0.06, 0.05, 0.045, 0.85); p.cCurve = 0.5; p.add0 = 0.85; p.add1 = 0; p.fin = 0.03; p.fout = 0.5;
      fx.pa.emit(p);
    }
    // white-hot core streaks right out of the nozzle
    n = this._rate(j, 'a2', 34 * q, dt, 4);
    for (let i = 0; i < n; i++) {
      const D = R.coneDir(r, Dx, Dy, Dz, 0.05), sp = r.range(30, 38);
      const p = fx.p.reset(); p.pos(_w.x, _w.y, _w.z).vel(V.x + D.x * sp, V.y + D.y * sp, V.z + D.z * sp); p.spr = SPR.FIRE; p.mode = MODE.FLAME; p.f0 = r.int(16); p.nPlay = 16; p.fps = 40;
      p.len = 1.2; p.lenSpd = 0.1; p.size(0.4, 1.3); p.drag = 2; p.life = r.range(0.16, 0.24); p.col(3.4, 2.5, 1.4, 1); p.add0 = p.add1 = 1; p.fin = 0.02; p.fout = 0.5;
      fx.pf.emit(p);
    }
    R.glow(fx, _w.x + Dx * 0.3, _w.y + Dy * 0.3, _w.z + Dz * 0.3, 1.5, 0.05, 4, 3, 2.2, false, 1.1);
    R.glow(fx, _w.x, _w.y, _w.z, 0.55, 0.05, 1, 1.8, 5, false, 1.1);          // blue pilot flame
    if (r.next() < dt * 10) R.ember(fx, _w.x + Dx * 6, _w.y + 1, _w.z + Dz * 6, V.x + Dx * 8 + r.sym(3), r.range(3, 8), V.z + Dz * 8 + r.sym(3), r.range(1, 2), 0.2, 1);
    // smoke rolling off the tip
    n = this._rate(j, 'a3', 8 * q, dt, 2);
    for (let i = 0; i < n; i++) { const o = r.range(10, 15); R.puff(fx, _w.x + Dx * o, _w.y + Dy * o + 1.5, _w.z + Dz * o, V.x * 0.6 + Dx * 2, V.y + r.range(2.5, 4.5), V.z * 0.6 + Dz * 2, 2, r.range(6, 9), r.range(3, 4.5), 0.07, 0.065, 0.06, 0.65, 1, 0.6, gy); }
    fx.glowLight(_w.x + Dx * 6, _w.y + 0.5, _w.z + Dz * 6, 1.0, 0.52, 0.18, 140 + 50 * Math.sin(fx.time * 23 + side), 34, 7000 + side);
  }

  _charge(j, dt) {
    const fx = this.fx, r = fx.rng;
    if (j.stop || j.t > j.dur + 0.35) { j.type = 0; return; }
    if (this.root && this.local('muzzle_main', _l)) this.toWorld(_l, _w); else _w.set(j.x, j.y, j.z);
    j.x = _w.x; j.y = _w.y; j.z = _w.z;
    if (!fx.near(_w.x, _w.y, _w.z, 500)) return;
    this.dirWorld(0, 0, 1, _f);
    const k = clamp01(j.t / j.dur), V = this.vel, fl = 0.8 + 0.2 * Math.sin(fx.time * 60) * Math.sin(fx.time * 37);
    const cx = _w.x + _f.x * 0.5, cy = _w.y + _f.y * 0.5, cz = _w.z + _f.z * 0.5;
    R.glow(fx, cx, cy, cz, (0.6 + 3.4 * k * k) * fl, 0.05, 4 + 7 * k, 2.4 + 5 * k, 1 + 4 * k, false, 1.05);
    if (k > 0.5) R.glow(fx, cx, cy, cz, (2 + 7 * (k - 0.5)) * fl, 0.05, 1.2 * k, 0.6 * k, 0.2 * k, true, 1.05);
    // sparks sucked into the barrel: spawn on a shell, fly to the (moving) muzzle
    const n = this._rate(j, 'a0', (30 + 90 * k) * Math.max(0.5, fx.qd), dt, 6);
    for (let i = 0; i < n; i++) {
      let ux = r.sym(1), uy = r.sym(1), uz = r.sym(1); const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      const rad = r.range(2.2, 4.2), life = r.range(0.2, 0.3), sp = rad / life;
      const p = fx.p.reset(); p.pos(cx + ux * rad, cy + uy * rad, cz + uz * rad).vel(V.x - ux * sp, V.y - uy * sp, V.z - uz * sp); p.life = life;
      p.spr = SPR.STREAK; p.mode = MODE.STREAK; p.len = 0.3; p.lenSpd = 0.03; p.size(0.05); p.col(6, 4.2, 2.2, 1); p.add0 = p.add1 = 1; p.fin = 0.25; p.fout = 0.15;
      fx.pf.emit(p);
    }
    if (r.next() < dt * (3 + 8 * k)) R.puff(fx, cx, cy, cz, V.x * 0.9 + r.sym(0.5), V.y + r.range(0.5, 1.5), V.z * 0.9 + r.sym(0.5), 0.3, 1.6, 0.9, 0.7, 0.68, 0.65, 0.3, 0.6, 0.4);
    fx.glowLight(cx, cy, cz, 1.0, 0.6, 0.3, (30 + 220 * k * k) * fl, 26, 7100);
  }

  _fire(j, dt) {
    const fx = this.fx, r = fx.rng;
    if (j.t > j.dur) { j.type = 0; return; }
    const W = this.jobPos(j, _w);
    if (!j.att && j.t > 30) { j.type = 0; return; }                       // detached from a vanished root: burn out
    if (!this.visible && j.att) return;
    const lod = j.att ? this.lod : fx.qd;
    const k = j.k * (j.dur < 1e8 ? 1 - smooth(j.dur - 5, j.dur, j.t) : 1) * (0.7 + 0.3 * (1 - smooth(0, 4, j.t)) * 1.4);
    const V = this.vel, sk = Math.sqrt(j.k);
    let n = this._rate(j, 'a0', 18 * k * lod, dt, 4);
    for (let i = 0; i < n; i++) {
      const p = fx.p.reset(), w = r.range(1.0, 2.0) * sk + 0.4;
      p.pos(W.x + r.sym(0.9 * sk), W.y + r.sym(0.3), W.z + r.sym(0.9 * sk)).vel(V.x * 0.93 + r.sym(0.6), V.y + r.range(2, 3.6), V.z * 0.93 + r.sym(0.6));
      p.spr = SPR.FIRE; p.mode = MODE.UPRIGHT; p.pivot = 1; p.aspect = 1.7; p.f0 = r.int(16); p.nPlay = 16; p.fps = 26; p.size(w, w * 0.5); p.sCurve = 0.7; p.drag = 0.45;
      p.life = r.range(0.45, 0.8); p.col0(1.9, 1.05, 0.45, 1).col1(1.2, 0.42, 0.16, 1); p.add0 = p.add1 = 1; p.fin = 0.08; p.fout = 0.55;
      fx.pf.emit(p);
    }
    n = this._rate(j, 'a1', (7 * k + 1.5) * lod, dt, 3);
    for (let i = 0; i < n; i++) R.puff(fx, W.x + r.sym(0.6), W.y + 1, W.z + r.sym(0.6), V.x * 0.72 + r.sym(0.8), V.y + r.range(3, 5.5), V.z * 0.72 + r.sym(0.8), 1.2 * sk, r.range(4.5, 7) * sk + 1, r.range(4, 6), 0.075, 0.07, 0.066, 0.88, 1, 0.6);
    if (r.next() < dt * 3 * k) R.ember(fx, W.x, W.y + 0.5, W.z, V.x * 0.8 + r.sym(2), r.range(3, 8), V.z * 0.8 + r.sym(2), r.range(1, 2.2), 0.18, 1);
    if (k > 0.4) R.glow(fx, W.x, W.y + 0.4, W.z, 2.2 * sk, 0.05, 1.3, 0.55, 0.16, true, 1.05);
  }

  _dying(j, dt) {
    const fx = this.fx, r = fx.rng;
    const after = j.final >= 0 ? j.t - j.final : 0;
    if (after > 34) { j.type = 0; return; }
    if (!this.root) { if (j.t > 40) j.type = 0; return; }
    const k = (j.final >= 0 ? 1 - smooth(6, 34, after) : smooth(0, 1.5, j.t)) * 1.0;
    const P = this.root.position;
    fx.glowLight(P.x, P.y + 7, P.z, 1.0, 0.5, 0.17, (260 + 120 * Math.sin(fx.time * 11) * Math.sin(fx.time * 5.7)) * k, 70, 7200);
    if (!this.visible) return;
    const lod = this.lod * k, V = this.vel, boxes = BOSS_BODY && BOSS_BODY.length ? BOSS_BODY : FALLBACK_BOX;
    let n = this._rate(j, 'a0', 55 * lod, dt, 8);
    for (let i = 0; i < n; i++) {
      const b = boxes[r.int(boxes.length)], c = b.center, h = b.half;
      this.toWorld(_l.set(c[0] + r.sym(h[0] * 0.9), c[1] + h[1] * r.range(0.1, 1.0), c[2] + r.sym(h[2] * 0.95)), _w);
      const p = fx.p.reset(), w = r.range(1.6, 3.4);
      p.pos(_w.x, _w.y, _w.z).vel(V.x * 0.9 + r.sym(0.8), V.y + r.range(2.5, 5), V.z * 0.9 + r.sym(0.8)); p.spr = SPR.FIRE; p.mode = MODE.UPRIGHT; p.pivot = 1; p.aspect = 1.75;
      p.f0 = r.int(16); p.nPlay = 16; p.fps = 24; p.size(w, w * 0.55); p.sCurve = 0.7; p.drag = 0.5; p.life = r.range(0.55, 0.95);
      p.col0(1.9, 1.05, 0.45, 1).col1(1.2, 0.42, 0.16, 1); p.add0 = p.add1 = 1; p.fin = 0.08; p.fout = 0.55; fx.pf.emit(p);
    }
    n = this._rate(j, 'a1', 22 * lod, dt, 4);
    for (let i = 0; i < n; i++) {
      const b = boxes[r.int(boxes.length)], c = b.center, h = b.half;
      this.toWorld(_l.set(c[0] + r.sym(h[0] * 0.7), c[1] + h[1], c[2] + r.sym(h[2] * 0.9)), _w);
      R.puff(fx, _w.x, _w.y + 1, _w.z, V.x * 0.7 + r.sym(1.5), V.y + r.range(5, 10), V.z * 0.7 + r.sym(1.5), 2.5, r.range(9, 14), r.range(5, 8), 0.06, 0.056, 0.052, 0.92, 1.2, 0.8);
    }
    n = this._rate(j, 'a2', 10 * lod, dt, 3);
    for (let i = 0; i < n; i++) { this.toWorld(_l.set(r.sym(3), r.range(4, 8), r.sym(16)), _w); R.ember(fx, _w.x, _w.y, _w.z, V.x * 0.8 + r.sym(3), r.range(4, 10), V.z * 0.8 + r.sym(3), r.range(1.5, 3), 0.25, 1); }
    if (j.final < 0 && r.next() < dt * 2.5) {                              // crackling spark pops along the hull
      this.toWorld(_l.set(r.sym(3.2), r.range(3, 7), r.sym(16)), _w);
      for (let i = 0; i < 12 * fx.qd; i++) R.spark(fx, _w.x, _w.y, _w.z, V.x + r.sym(9), r.range(3, 12), V.z + r.sym(9), r.range(0.4, 1.0), this._gy(_w.x, _w.z), 1, 0.045);
      R.glow(fx, _w.x, _w.y, _w.z, 3, 0.1, 6, 3.5, 1.2, true, 1.5);
    }
  }

  _ramp(j, dt) {
    const fx = this.fx, r = fx.rng;
    if (j.t > j.dur || !this.root) { j.type = 0; return; }
    if (!this.visible) return;
    const V = this.vel, q = Math.max(0.4, fx.qd);
    if (j.t - dt <= 0.0001) {                                                  // the slam
      this.toWorld(_l.set(0, 0.2, -20), _w); const gy = this._gy(_w.x, _w.z);
      for (let i = 0; i < 14 * q; i++) { const a = r.next() * PI2, sp = r.range(4, 12); R.dust(fx, _w.x + Math.cos(a) * 2, gy + 0.3, _w.z + Math.sin(a) * 1.5, V.x * 0.5 + Math.cos(a) * sp, r.range(0.5, 3), V.z * 0.5 + Math.sin(a) * sp, 1.2, r.range(4, 7), r.range(1.8, 3), 0.55, 0.47, 0.37, 0.7, gy, 1.3, 0.1); }
      fx.shakeReq(_w, 0.3, 70);
    }
    for (let s = -1; s <= 1; s += 2) {
      this.toWorld(_l.set(2.2 * s, 0, -20.2), _w); const gy = this._gy(_w.x, _w.z);
      const n = this._rate(j, s < 0 ? 'a0' : 'a1', 55 * q * (1 - smooth(1.6, 2.4, j.t)), dt, 5);
      for (let i = 0; i < n; i++) R.spark(fx, _w.x + r.sym(0.4), gy + 0.05, _w.z, V.x * 0.55 + r.sym(4), r.range(1, 5), V.z * 0.55 + r.sym(4), r.range(0.3, 0.8), gy, 1.1, 0.05);
      if (r.next() < dt * 10) R.dust(fx, _w.x, gy + 0.2, _w.z, V.x * 0.4 + r.sym(1), r.range(0.4, 1.5), V.z * 0.4 + r.sym(1), 0.8, r.range(3, 4.5), r.range(1.4, 2.2), 0.58, 0.5, 0.4, 0.55, gy);
    }
  }

  /** Mushroom cloud: cap rolls up and out for ~4 s, a stem feeds it, then a long smoke column drifts for ~16 s. */
  _mush(j, dt) {
    const fx = this.fx, r = fx.rng, t = j.t;
    if (t > j.dur) { j.type = 0; return; }
    const x = j.x, z = j.z, gy = j.gy, q = Math.max(0.5, fx.qd);
    const capH = gy + 8 + 36 * (1 - Math.exp(-t / 2.2)), capV = (36 / 2.2) * Math.exp(-t / 2.2);
    const rc = 6 + 12 * (1 - Math.exp(-t / 1.6));
    let n = t < 4.5 ? this._rate(j, 'a0', 22 * q, dt, 5) : 0;
    for (let i = 0; i < n; i++) {                                              // rolling cap (toroidal vortex)
      const a = r.next() * PI2, c = Math.cos(a), s = Math.sin(a), sp = r.range(2, 5);
      const hot = 1 - smooth(0.4, 2.2, t);
      const p = fx.p.reset(); p.pos(x + c * rc, capH + r.sym(3), z + s * rc).vel(c * sp, capV + r.range(0, 2.5), s * sp);
      p.spr = SPR.SMOKE; p.f0 = r.int(4) * 4; p.nPlay = 4; p.size(r.range(8, 11), r.range(18, 24)); p.sCurve = 0.4; p.rot = r.sym(0.6); p.rotV = r.sym(0.15);
      p.drag = 0.35; p.grav = -0.6; p.life = r.range(8, 12); p.turb = 1.2; p.wind = 0.8; p.lit = 0.8;
      p.col0(0.06 + 3.6 * hot, 0.055 + 1.3 * hot, 0.05 + 0.2 * hot, 0.95).col1(0.075, 0.07, 0.066, 0.9); p.cCurve = 0.25; p.add0 = 0.6 * hot; p.add1 = 0; p.fin = 0.05; p.fout = 0.45;
      fx.pa.emit(p);
    }
    n = t < 10 ? this._rate(j, 'a1', 12 * q * (1 - smooth(5, 10, t)), dt, 3) : 0;
    for (let i = 0; i < n; i++) {                                              // stem
      const a = r.next() * PI2, d = r.range(0, 3.5), hot = 1 - smooth(0.5, 3, t);
      const p = fx.p.reset(); p.pos(x + Math.cos(a) * d, gy + r.range(1, 6), z + Math.sin(a) * d).vel(r.sym(1), r.range(9, 15) * (1 - 0.4 * smooth(3, 10, t)), r.sym(1));
      p.spr = SPR.SMOKE; p.f0 = r.int(4) * 4; p.nPlay = 4; p.size(r.range(4, 6), r.range(9, 13)); p.sCurve = 0.5; p.rot = r.sym(0.6); p.drag = 0.25; p.grav = -0.4; p.life = r.range(5, 8); p.turb = 0.6; p.wind = 0.8; p.lit = 0.8;
      p.col0(0.07 + 3 * hot, 0.065 + 1.1 * hot, 0.06 + 0.2 * hot, 0.9).col1(0.08, 0.075, 0.07, 0.85); p.cCurve = 0.3; p.add0 = 0.55 * hot; p.add1 = 0; p.fin = 0.06; p.fout = 0.5; p.ground = gy;
      fx.pa.emit(p);
    }
    n = t < 7 ? this._rate(j, 'a2', 12 * q * (1 - smooth(2, 7, t)), dt, 3) : 0;
    for (let i = 0; i < n; i++) {                                              // ground fire at the base
      const a = r.next() * PI2, d = r.range(0, 9), p = fx.p.reset(), w = r.range(3, 6);
      p.pos(x + Math.cos(a) * d, gy + 0.2, z + Math.sin(a) * d).vel(r.sym(1), r.range(2, 5), r.sym(1)); p.spr = SPR.FIRE; p.mode = MODE.UPRIGHT; p.pivot = 1; p.aspect = 1.7;
      p.f0 = r.int(16); p.nPlay = 16; p.fps = 22; p.size(w, w * 0.6); p.drag = 0.6; p.life = r.range(0.7, 1.2); p.col0(1.9, 1.05, 0.45, 1).col1(1.2, 0.42, 0.16, 1); p.add0 = p.add1 = 1; p.fin = 0.08; p.fout = 0.55; fx.pf.emit(p);
    }
    n = t > 3 ? this._rate(j, 'a3', 5 * q * (1 - smooth(10, 16, t)), dt, 2) : 0;
    for (let i = 0; i < n; i++) R.puff(fx, x + r.sym(4), gy + r.range(4, 10), z + r.sym(4), r.sym(1), r.range(7, 11), r.sym(1), 4, r.range(12, 17), r.range(8, 12), 0.065, 0.06, 0.056, 0.9, 0.8, 1.0, gy);
    if (t < 6) fx.glowLight(x, gy + 10, z, 1.0, 0.5, 0.18, 900 * (1 - smooth(0.5, 6, t)), 160, 7300);
  }

  clear() { for (const j of this.jobs) j.type = 0; this.dying = false; this.phase = 1; this.stackGone[0] = this.stackGone[1] = false; }
}

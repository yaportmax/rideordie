// Road hazards: dropped mines (blinking), enemy burning barrels, oil slicks (glossy decal), boost-pad speed streaks,
// unflip / medkit puffs. Fixed pools, no per-frame allocation.
import * as THREE from 'three';
import * as Assets from '../../core/assets.js';
import { SPR } from './atlas.js';
import { MODE } from './particles.js';
import { MeshPool } from './meshpool.js';
import * as R from './recipes.js';
import { smooth } from './util.js';

const PI2 = Math.PI * 2;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------------------------------------ oil slick decal
const OIL_VERT = /* glsl */`
uniform float uTime; uniform float uFogD;
attribute vec4 aOil;                       // birth, life, seed, alpha
varying vec2 vUv; varying vec3 vWPos; varying float vA; varying float vSeed; varying float vFog;
void main() {
  float age = uTime - aOil.x;
  if (age < 0.0 || age > aOil.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vUv = vec2(0.0); vWPos = vec3(0.0); vSeed = 0.0; vFog = 0.0; return; }
  float grow = 0.3 + 0.7 * (1.0 - pow(1.0 - clamp(age / 0.55, 0.0, 1.0), 3.0));   // the spill spreads out
  vA = aOil.w * (1.0 - smoothstep(aOil.y - 1.6, aOil.y, age));
  vUv = position.xz * 2.0; vSeed = aOil.z;
  vec4 wp = instanceMatrix * vec4(position.x * grow, position.y, position.z * grow, 1.0);
  vWPos = wp.xyz;
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vFog = 1.0 - exp(-uFogD * uFogD * dot(mv.xyz, mv.xyz));
}`;
const OIL_FRAG = /* glsl */`
uniform vec3 uLight; uniform vec3 uSunDir; uniform vec3 uFogCol;
varying vec2 vUv; varying vec3 vWPos; varying float vA; varying float vSeed; varying float vFog;
float oh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float on(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(oh(i), oh(i + vec2(1, 0)), f.x), mix(oh(i + vec2(0, 1)), oh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = vUv;
  float n = on(p * 2.2 + vSeed * 7.0) * 0.6 + on(p * 5.0 - vSeed * 3.0) * 0.4;
  float d = length(p) + (n - 0.5) * 0.55;
  float body = 1.0 - smoothstep(0.62, 0.72, d);
  float drops = smoothstep(0.78, 0.86, on(p * 6.5 + vSeed * 11.0)) * (1.0 - smoothstep(0.7, 1.0, length(p)));   // satellite splashes
  float m = max(body, drops);
  float a = m * vA;
  if (a < 0.004) discard;
  vec3 V = normalize(cameraPosition - vWPos);
  vec3 N = normalize(vec3((on(p * 9.0 + 3.0) - 0.5) * 0.08, 1.0, (on(p * 9.0 - 5.0) - 0.5) * 0.08));
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 base = vec3(0.012, 0.010, 0.008);
  vec3 sky = uFogCol * min(uLight, vec3(1.0)) * 1.1;
  // thin-film rainbow sheen, strongest where the film is thin (toward the edge)
  float h = fract(n * 1.7 + d * 2.3 + V.x * 0.35 + V.z * 0.2);
  vec3 film = 0.5 + 0.5 * cos(6.2832 * (h + vec3(0.0, 0.33, 0.67)));
  vec3 col = base + film * 0.07 * smoothstep(0.2, 0.7, d) * min(uLight, vec3(1.0));
  col = mix(col, sky, fres * 0.85);
  vec3 Rv = reflect(-V, N);
  col += uLight * pow(max(dot(Rv, normalize(uSunDir)), 0.0), 180.0) * 5.0;       // sun glint (HDR, blooms)
  col = mix(col, uFogCol, vFog * 0.85);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class OilPool {
  constructor(scene, U, cap = 12) {
    this.cap = cap; this.head = 0; this.n = 0;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOil', this.attr);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uFogD: U.uFogD, uFogCol: U.uFogCol, uLight: U.uLight, uSunDir: U.uSunDir },
      vertexShader: OIL_VERT, fragmentShader: OIL_FRAG, transparent: true, depthWrite: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, cap);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 57; this.mesh.count = 0; this.mesh.name = 'fx_oil';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _m.makeScale(0, 0, 0); for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, _m);
    scene.add(this.mesh);
  }
  add(x, y, z, r, dx, dz, life, seed, time) {
    const i = this.head; this.head = (i + 1) % this.cap; if (i + 1 > this.n) this.n = i + 1;
    _q.setFromAxisAngle(_up, Math.atan2(dx, dz));
    _p.set(x, y + 0.025, z); _s.set(r * 2, 1, r * 2 * 1.35);                    // stretched along the drop direction
    _m.compose(_p, _q, _s); this.mesh.setMatrixAt(i, _m);
    this.attr.setXYZW(i, time, life, seed, 0.96);
    this.mesh.instanceMatrix.addUpdateRange(i * 16, 16); this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.addUpdateRange(i * 4, 4); this.attr.needsUpdate = true;
    this.mesh.count = this.n;
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------------------------------------ hazards
export class HazardFx {
  constructor(fx) {
    this.fx = fx; this.items = []; for (let i = 0; i < 24; i++) this.items.push({ live: false, enemy: false, pool: null, slot: 0, t: 0, a0: 0, a1: 0, a2: 0 });
    this.boosts = []; for (let i = 0; i < 8; i++) this.boosts.push({ live: false, t: 0, cv: null, st: null, acc: 0 });
  }

  async load(scene, U) {
    this.oil = new OilPool(scene, U, 12);
    const mineGeo = new THREE.CylinderGeometry(0.3, 0.34, 0.12, 14);
    const mineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.7 });
    this.mines = new MeshPool(scene, mineGeo, mineMat, { cap: 12, restitution: 0.15, friction: 0.3, radius: 0.06, fadeTime: 0.2, drag: 0.4, upright: true });
    let geo = null, mat = null, h = 0.9;
    const g = await Assets.loadGLB('/models/props/barrel_explosive.glb');
    if (g) g.scene.traverse((o) => { if (!geo && o.isMesh) { geo = o.geometry.clone(); mat = o.material; } });
    if (geo) { geo.computeBoundingBox(); const b = geo.boundingBox; h = b.max.y - b.min.y; geo.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2); }
    else { geo = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 16); mat = new THREE.MeshStandardMaterial({ color: 0x8a2a18, roughness: 0.6, metalness: 0.5 }); h = 0.88; }
    this.barrelH = h;
    this.barrels = new MeshPool(scene, geo, mat, { cap: 12, restitution: 0.2, friction: 0.35, radius: 0.5, fadeTime: 0.2, drag: 0.4, upright: true });
    this.barrels.rad = h * 0.5;                                                 // geometry is centred: rest half a barrel above the ground
    for (const m of [this.mines, this.barrels]) m.mesh.castShadow = false;               // no instanced shadow-depth variant to compile mid-run
  }
  setGround(fn) { if (this.mines) { this.mines.groundFn = fn; this.barrels.groundFn = fn; } }

  // ------------------------------------------------------------------------------------------------ events
  mineDrop(e) {
    const fx = this.fx, p = e.pos; if (!p) return;
    let it = null; for (const o of this.items) if (!o.live) { it = o; break; }
    if (!it) { it = this.items[0]; for (const o of this.items) if (o.t > it.t) it = o; it.pool.kill(it.slot); }
    const enemy = !!e.enemy, pool = enemy ? this.barrels : this.mines;
    const sc = 1;
    const slot = pool.spawn(p[0], p[1] + (enemy ? this.barrelH * 0.5 + 0.1 : 0.1), p[2], 0, -1, 0, sc, sc, sc, 0, 0, 0, 20, enemy ? 0xffffff : 0x3b4032, false);
    const yaw = fx.rng.next() * PI2; pool.q[slot * 4] = 0; pool.q[slot * 4 + 1] = Math.sin(yaw / 2); pool.q[slot * 4 + 2] = 0; pool.q[slot * 4 + 3] = Math.cos(yaw / 2);
    if (!pool.groundFn) pool.gy[slot] = fx.groundAt(p[0], p[2], p[1] - 0.15);
    it.live = true; it.enemy = enemy; it.pool = pool; it.slot = slot; it.t = 0; it.a0 = it.a1 = it.a2 = 0;
    if (enemy && fx.near(p[0], p[1], p[2], 200)) R.glow(fx, p[0], p[1] + 0.6, p[2], 1.8, 0.2, 4, 2, 0.6, true, 1.4);   // it ignites as it lands
  }
  /** A mine/barrel went off: remove the nearest one within 4 m. */
  removeNear(x, y, z) {
    let best = null, bd = 16;
    for (const it of this.items) {
      if (!it.live) continue;
      const i = it.slot, P = it.pool;
      const d = (P.px[i] - x) ** 2 + (P.py[i] - y) ** 2 + (P.pz[i] - z) ** 2;
      if (d < bd) { bd = d; best = it; }
    }
    if (best) { best.pool.kill(best.slot); best.live = false; }
  }
  oilSlick(e) {
    const fx = this.fx, p = e.pos; if (!p || !this.oil) return;
    const dir = e.dir || [0, 1], r = e.r || 5;
    const gy = fx.groundAt(p[0], p[2], p[1] - 0.6);
    this.oil.add(p[0], gy, p[2], r * 1.3, dir[0], dir[1], 8, fx.rng.next() * 10, fx.time);
    if (!fx.near(p[0], gy, p[2], 150)) return;
    const rng = fx.rng;
    for (let i = 0; i < 10 * fx.qd; i++) {                                    // splat droplets
      const a = rng.next() * PI2, sp = rng.range(1.5, 5);
      const q = fx.p.reset(); q.pos(p[0], gy + 0.2, p[2]).vel(Math.cos(a) * sp, rng.range(1, 3), Math.sin(a) * sp); q.spr = SPR.DUST; q.f0 = rng.int(16); q.size(0.18, 0.4);
      q.grav = 9.8; q.ground = gy + 0.02; q.life = rng.range(0.35, 0.6); q.col(0.02, 0.018, 0.015, 0.9); q.fin = 0.02; q.fout = 0.3; fx.pa.emit(q);
    }
  }
  boostPad(e, ctx) {
    const fx = this.fx, cv = ctx.carViews && ctx.carViews.get(e.id), st = ctx.states && ctx.states.get(e.id);
    const p = e.pos || (cv ? [cv.root.position.x, cv.root.position.y, cv.root.position.z] : null); if (!p) return;
    if (!fx.near(p[0], p[1], p[2], 250)) return;
    const gy = fx.groundAt(p[0], p[2], cv ? cv.root.position.y : p[1] - 0.6), rng = fx.rng;
    const q = fx.p.reset(); q.pos(p[0], gy + 0.08, p[2]); q.mode = MODE.GROUND; q.spr = SPR.SHOCK; q.size(1.5, 11); q.sCurve = 0.5; q.life = 0.35; q.col(1.0, 2.4, 4.0, 0.8); q.add0 = q.add1 = 1; q.fin = 0.01; q.fout = 0.8; q.rot = rng.next() * PI2; fx.pf.emit(q);
    R.glow(fx, p[0], gy + 0.8, p[2], 4, 0.18, 1.2, 2.6, 5, true, 1.5);
    if (cv && st) { let b = null; for (const o of this.boosts) if (!o.live) { b = o; break; } if (b) { b.live = true; b.t = 0; b.cv = cv; b.st = st; b.acc = 0; } }
  }
  unflip(e, ctx) {
    const fx = this.fx, cv = ctx.carViews && ctx.carViews.get(e.id); if (!cv) return;
    const P = cv.root.position, rng = fx.rng; if (!fx.near(P.x, P.y, P.z, 150)) return;
    const gy = fx.groundAt(P.x, P.z, P.y);
    for (let i = 0; i < 10 * fx.qd + 3; i++) { const a = (i / 10) * PI2 + rng.sym(0.3), sp = rng.range(2, 5); R.dust(fx, P.x + Math.cos(a) * 2, gy + 0.3, P.z + Math.sin(a) * 2.6, Math.cos(a) * sp, rng.range(0.4, 1.4), Math.sin(a) * sp, 0.8, rng.range(2.5, 3.8), rng.range(1.1, 1.8), 0.6, 0.53, 0.43, 0.5, gy); }
  }
  medkit(e, ctx) {
    const fx = this.fx, cv = ctx.carViews && ctx.carViews.get(e.id); if (!cv) return;
    const P = cv.root.position, rng = fx.rng; if (!fx.near(P.x, P.y, P.z, 120)) return;
    const st = ctx.states && ctx.states.get(e.id), vx = st ? st.vel.x : 0, vz = st ? st.vel.z : 0;
    for (let i = 0; i < 16; i++) {
      const a = rng.next() * PI2, d = rng.range(0.4, 1.4);
      const q = fx.p.reset(); q.pos(P.x + Math.cos(a) * d, P.y + rng.range(0.8, 1.8), P.z + Math.sin(a) * d).vel(vx, rng.range(1, 2.4), vz); q.spr = SPR.SPARK; q.size(0.28, 0.08);
      q.life = rng.range(0.7, 1.2); q.drag = 0.5; q.col(0.7, 3.2, 1.1, 1); q.add0 = q.add1 = 1; q.fin = 0.1; q.fout = 0.5; q.rot = rng.next() * PI2; fx.pf.emit(q);
    }
    R.glow(fx, P.x, P.y + 1.3, P.z, 2.4, 0.3, 0.6, 2.2, 0.9, true, 1.3);
  }

  // ------------------------------------------------------------------------------------------------ per frame
  update(dt) {
    const fx = this.fx, rng = fx.rng;
    if (!this.mines) return;
    this.mines.update(dt); this.barrels.update(dt);
    for (const it of this.items) {
      if (!it.live) continue;
      const P = it.pool, i = it.slot;
      if (P.age[i] >= P.life[i]) { it.live = false; continue; }
      it.t += dt;
      const x = P.px[i], y = P.py[i], z = P.pz[i];
      if (!fx.near(x, y, z, fx.farDist)) continue;
      if (!it.enemy) {
        // armed mine: red LED blink (faster when freshly dropped)
        it.a0 += dt; const per = it.t < 1 ? 0.25 : 0.7;
        if (it.a0 >= per) { it.a0 = 0; R.glow(fx, x, y + 0.08, z, 0.45, 0.12, 6, 0.3, 0.15, false, 1.0); R.glow(fx, x, y + 0.08, z, 1.3, 0.12, 1.2, 0.05, 0.02, true, 1.0); }
        continue;
      }
      // burning barrel: flames from the open top, black smoke, embers, a glow pool
      const top = y + this.barrelH * 0.5;
      let a = it.a1 + 14 * fx.qd * dt;
      while (a >= 1) {
        a -= 1; const q = fx.p.reset(), w = rng.range(0.7, 1.05);
        q.pos(x + rng.sym(0.15), top - 0.05, z + rng.sym(0.15)).vel(rng.sym(0.3), rng.range(1, 2), rng.sym(0.3)); q.spr = SPR.FIRE; q.mode = MODE.UPRIGHT; q.pivot = 1; q.aspect = 1.8;
        q.f0 = rng.int(16); q.nPlay = 16; q.fps = 26; q.size(w, w * 0.6); q.drag = 0.8; q.life = rng.range(0.4, 0.65); q.wind = 0.4;
        q.col0(1.9, 1.05, 0.45, 1).col1(1.2, 0.42, 0.16, 1); q.add0 = q.add1 = 1; q.fin = 0.08; q.fout = 0.55; fx.pf.emit(q);
      }
      it.a1 = a;
      let b = it.a2 + 3.5 * fx.qd * dt;
      while (b >= 1) { b -= 1; R.puff(fx, x, top + 0.8, z, rng.sym(0.3), rng.range(1.5, 2.8), rng.sym(0.3), 0.5, rng.range(2.2, 3.2), rng.range(2.5, 3.5), 0.07, 0.065, 0.06, 0.7, 0.9, 0.5); }
      it.a2 = b;
      if (rng.next() < dt * 2) R.ember(fx, x, top + 0.2, z, rng.sym(1), rng.range(2, 4), rng.sym(1), rng.range(0.8, 1.5), 0.12, 0.9);
      R.glow(fx, x, top + 0.2, z, 1.6 + 0.2 * Math.sin(fx.time * 17 + i), 0.05, 1.1, 0.5, 0.14, true, 1.0);
    }
    // boost-pad streak bursts: speed lines pouring off the car for ~0.9 s
    for (const b of this.boosts) {
      if (!b.live) continue;
      b.t += dt;
      const cv = b.cv, st = b.st;
      if (b.t > 0.9 || !cv.root.parent) { b.live = false; continue; }
      const root = cv.root, spec = st.spec || {}, W = (spec.width || 2) * 0.5 + 0.25, L = (spec.length || 5) * 0.5, H = spec.height || 1.6;
      _f.set(0, 0, 1).applyQuaternion(root.quaternion);
      const k = 1 - smooth(0.4, 0.9, b.t), vel = st.vel;
      let a = b.acc + 70 * k * Math.max(0.5, fx.qd) * dt, n = 0;
      while (a >= 1 && n < 6) {
        a -= 1; n++;
        const side = rng.next() < 0.5 ? -1 : 1;
        _w.set(side * rng.range(W * 0.7, W * 1.4), rng.range(0.2, H * 1.1), rng.range(-L, L * 0.8)).applyQuaternion(root.quaternion).add(root.position);
        const q = fx.p.reset(); q.pos(_w.x, _w.y, _w.z).vel(vel.x * 0.25 + _f.x, vel.y * 0.25, vel.z * 0.25 + _f.z); q.life = rng.range(0.14, 0.24);
        q.spr = SPR.STREAK; q.mode = MODE.STREAK; q.len = rng.range(3, 6); q.size(0.05); q.col(1.1, 2.4, 4.5, 0.8); q.add0 = q.add1 = 1; q.fin = 0.15; q.fout = 0.5;
        fx.pf.emit(q);
      }
      b.acc = a;
    }
  }

  clear() { for (const it of this.items) { if (it.live) it.pool.kill(it.slot); it.live = false; } for (const b of this.boosts) b.live = false; }
  dispose() { this.oil && this.oil.dispose(); this.mines && this.mines.dispose(); this.barrels && this.barrels.dispose(); }
}

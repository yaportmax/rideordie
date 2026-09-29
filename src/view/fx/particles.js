// GPU-driven billboard particle system.
//
// One THREE.Mesh over an InstancedBufferGeometry per POOL (the Fx owns two pools that share one atlas texture and one
// shader: a "smoke" pool drawn first and a "fire" pool drawn on top of it). Every particle is written ONCE at spawn into an
// interleaved instance buffer (ring buffer, only the dirty range is re-uploaded); the vertex shader evaluates position
// (drag + gravity + bounce + wind + turbulence), size, colour, alpha envelope, sprite-sheet frame (with frame cross-fade),
// billboard orientation and depth-sorted-free premultiplied blending. Per-frame CPU cost per pool = one uniform write.
//
// Blending is premultiplied ONE / ONE_MINUS_SRC_ALPHA; a per-particle "additive" factor (start -> end over life) turns a
// particle from pure additive (fire, flash) into pure alpha (smoke): a fireball puff cools into black smoke seamlessly.
import * as THREE from 'three';
import { NSPR } from './atlas.js';

export const STRIDE = 44;
/** Orientation modes. */
export const MODE = {
  BILL: 0,      // camera-facing billboard (spins around the view axis)
  STREAK: 1,    // velocity-aligned ribbon, head at the particle, tail trailing `len + lenSpd*speed` behind (sparks, tracers)
  GROUND: 2,    // flat on the ground, rotates around Y (shockwave rings, dust discs)
  UPRIGHT: 4,   // cylindrical billboard, stays vertical (flames); `pivot` 1 = base of the sprite at the particle
  FLAME: 5,     // flame sprite whose tip points along the velocity, base at the particle (nitro jets)
  FWD: 6,       // sprite extends forward from the particle along a fixed axis given as yaw=pivot, pitch=aspect (muzzle cones)
};

/** Reusable particle description (no allocation per spawn). Fill fields, call pool.emit(d). */
export class PDesc {
  constructor() { this.reset(); }
  reset() {
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0; this.life = 1;
    this.s0 = 1; this.s1 = 1; this.rot = 0; this.rotV = 0;
    this.r0 = 1; this.g0 = 1; this.b0 = 1; this.a0 = 1; this.r1 = 1; this.g1 = 1; this.b1 = 1; this.a1 = 1;
    this.drag = 0; this.grav = 0; this.ground = -1e4; this.bounce = 0;
    this.spr = 0; this.f0 = 0; this.nPlay = 1; this.fps = 0;
    this.mode = 0; this.pivot = 0; this.aspect = 1; this.len = 0;
    this.add0 = 0; this.add1 = 0; this.lenSpd = 0; this.turb = 0;
    this.fin = 0.05; this.fout = 0.5; this.sCurve = 1; this.cCurve = 1;
    this.lit = 0; this.wind = 0; this.clip = 0; this.mono = 0;
    return this;
  }
  pos(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  vel(x, y, z) { this.vx = x; this.vy = y; this.vz = z; return this; }
  col(r, g, b, a = 1) { this.r0 = this.r1 = r; this.g0 = this.g1 = g; this.b0 = this.b1 = b; this.a0 = this.a1 = a; return this; }
  col0(r, g, b, a = 1) { this.r0 = r; this.g0 = g; this.b0 = b; this.a0 = a; return this; }
  col1(r, g, b, a = 1) { this.r1 = r; this.g1 = g; this.b1 = b; this.a1 = a; return this; }
  size(a, b = a) { this.s0 = a; this.s1 = b; return this; }
}

const VERT = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec4 uRect[NS];
uniform vec4 uGrid[NS];
uniform vec3 uWind;
uniform vec3 uLight;
uniform float uPix;
uniform float uFogD;
uniform vec2 uInset;
uniform float uFrameBlend;

attribute vec4 aP0; attribute vec4 aV; attribute vec4 aSz; attribute vec4 aC0; attribute vec4 aC1;
attribute vec4 aPh; attribute vec4 aSp; attribute vec4 aMd; attribute vec4 aEx; attribute vec4 aEn; attribute vec4 aLt;

varying vec2 vUv0; varying vec2 vUv1; varying float vBlend; varying vec4 vCol; varying float vAdd; varying float vFog; varying float vMono;

float hash11(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  float age = uTime - aP0.w;
  float life = aV.w;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); vUv0 = vec2(0.0); vUv1 = vec2(0.0); vBlend = 0.0; vAdd = 0.0; vFog = 0.0; vMono = 0.0;
    return;
  }
  float t = age / life;

  // ---------------------------------------------------------------- kinematics (analytic: drag + gravity/buoyancy + wind)
  vec3 v0 = aV.xyz;
  float k = aPh.x, g = aPh.y;
  vec3 acc = vec3(0.0, -g, 0.0) + uWind * aLt.y;
  vec3 disp, vel;
  if (k > 0.001) {
    float e = exp(-k * age);
    vec3 vt = v0 + acc / k;
    disp = vt * ((1.0 - e) / k) - acc * (age / k);
    vel = vt * e - acc / k;
  } else {
    disp = v0 * age + 0.5 * acc * age * age;
    vel = v0 + acc * age;
  }
  vec3 pos = aP0.xyz + disp;
  float gy = aPh.z;
  bool hasGround = gy > -9000.0;
  if (hasGround && aPh.w > 0.0 && g > 0.1) {           // up to three ground bounces (vertical motion re-solved ballistically)
    float h0 = aP0.y - gy;
    float vy0 = v0.y;
    float disc = vy0 * vy0 + 2.0 * g * h0;
    float th = disc > 0.0 ? (vy0 + sqrt(disc)) / g : 0.0;
    float y;
    if (age < th) { y = h0 + vy0 * age - 0.5 * g * age * age; }
    else {
      float vb = abs(vy0 - g * th) * aPh.w; float tt = age - th; float tb = 2.0 * vb / g;
      if (tt < tb) { y = vb * tt - 0.5 * g * tt * tt; }
      else {
        float vb2 = vb * aPh.w; float t3 = tt - tb; float tb2 = 2.0 * vb2 / g;
        y = t3 < tb2 ? vb2 * t3 - 0.5 * g * t3 * t3 : 0.0;
      }
    }
    pos.y = gy + max(y, 0.0);
  }
  if (aEx.w > 0.0) {                                   // turbulence: swirling drift that grows with age
    float ph = hash11(aP0.x * 12.9898 + aP0.z * 78.233 + aP0.w * 3.7) * 6.2831;
    float tw = aEx.w * sqrt(age);
    pos.x += sin(age * 1.9 + ph) * tw; pos.z += cos(age * 1.5 + ph * 1.7) * tw; pos.y += sin(age * 1.1 + ph * 2.3) * tw * 0.35;
  }

  // ---------------------------------------------------------------- size / colour / envelope
  float sz = mix(aSz.x, aSz.y, pow(t, aEn.z));
  vec4 col = mix(aC0, aC1, pow(t, aEn.w));
  float env = smoothstep(0.0, max(aEn.x, 1e-4), t) * (1.0 - smoothstep(1.0 - max(aEn.y, 1e-4), 1.0, t));
  col.rgb *= mix(vec3(1.0), uLight, aLt.x);

  // ---------------------------------------------------------------- sprite frame (+ cross-fade to the next frame)
  float nf = max(aSp.z, 1.0);
  bool loopAnim = aSp.w > 0.0;
  float ft = loopAnim ? age * aSp.w : t * (nf - 1.0);
  float i0 = floor(ft); float fr = ft - i0;
  float c0, c1;
  if (loopAnim) { c0 = mod(i0, nf); c1 = mod(i0 + 1.0, nf); } else { c0 = min(i0, nf - 1.0); c1 = min(i0 + 1.0, nf - 1.0); }
  c0 += aSp.y; c1 += aSp.y;
  int sid = int(aSp.x + 0.5);
  vec4 R = uRect[sid]; vec4 G = uGrid[sid];
  vec2 cs = vec2(R.z / G.x, R.w / G.y) ;
  vec2 corner = uv;
  vec2 csi = cs - 2.0 * uInset;
  vec2 o0 = vec2(R.x + mod(c0, G.x) * cs.x, R.y + (G.y - 1.0 - floor(c0 / G.x)) * cs.y);
  vec2 o1 = vec2(R.x + mod(c1, G.x) * cs.x, R.y + (G.y - 1.0 - floor(c1 / G.x)) * cs.y);
  vUv0 = o0 + uInset + corner * csi;
  vUv1 = o1 + uInset + corner * csi;
  vBlend = (uFrameBlend > 0.5 && c1 != c0) ? fr : 0.0;

  // ---------------------------------------------------------------- orientation
  int mode = int(aMd.x + 0.5);
  vec2 q = position.xy;
  float w = sz; float h = sz * aMd.z;
  vec3 toCam = cameraPosition - pos; float dist = length(toCam);
  vec3 world;
  if (mode == 0) {
    vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float rot = aSz.z + aSz.w * age; float cq = cos(rot), sq = sin(rot);
    vec3 rgt = cr * cq + cu * sq; vec3 up = -cr * sq + cu * cq;
    world = pos + rgt * (q.x * w) + up * ((q.y + 0.5 * aMd.y) * h);
  } else if (mode == 4) {
    vec3 fwd = vec3(toCam.x, 0.0, toCam.z); float fl = length(fwd); fwd = fl > 1e-4 ? fwd / fl : vec3(0.0, 0.0, 1.0);
    vec3 rgt = vec3(fwd.z, 0.0, -fwd.x);
    world = pos + rgt * (q.x * w) + vec3(0.0, 1.0, 0.0) * ((q.y + 0.5 * aMd.y) * h);
  } else if (mode == 2) {
    float rot = aSz.z + aSz.w * age; float cq = cos(rot), sq = sin(rot);
    world = pos + vec3(cq, 0.0, sq) * (q.x * w) + vec3(-sq, 0.0, cq) * (q.y * h);
  } else {
    vec3 ax = vel;
    if (mode == 6) ax = vec3(sin(aMd.y) * cos(aMd.z), sin(aMd.z), cos(aMd.y) * cos(aMd.z));   // axis given as yaw (aMd.y) / pitch (aMd.z)
    float sp = length(ax); ax = sp > 1e-4 ? ax / sp : vec3(0.0, 1.0, 0.0);
    vec3 side = cross(ax, toCam); float sl = length(side); side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    float L = aMd.w + aEx.z * length(vel);
    if (L <= 0.0) L = h;
    if (mode == 1) {
      float w2 = max(w, uPix * dist * 2.2);
      if (aLt.z > 0.0) {                               // clipped travel (hitscan tracers): grows out of the muzzle, shrinks into the impact
        float trav = length(disp);
        float head = min(trav, aLt.z); float tail = clamp(trav - L, 0.0, aLt.z);
        world = aP0.xyz + ax * (tail + (q.x + 0.5) * (head - tail)) + side * (q.y * w2);
      } else {
        world = pos + ax * ((q.x - 0.5) * L) + side * (q.y * w2);
      }
      col.a *= min(1.0, w / w2);
    } else if (mode == 5) {
      world = pos + ax * ((q.y + 0.5) * L) + side * (q.x * w);
    } else {
      world = pos + ax * ((q.x + 0.5) * L) + side * (q.y * w);
    }
  }
  if (hasGround && mode != 2) world.y = max(world.y, gy + 0.03);

  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  vFog = 1.0 - exp(-uFogD * uFogD * dot(mv.xyz, mv.xyz));
  vCol = vec4(col.rgb, col.a * env);
  vAdd = mix(aEx.x, aEx.y, t);
  vMono = aLt.w;
}
`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uMap;
uniform vec3 uFogCol;
varying vec2 vUv0; varying vec2 vUv1; varying float vBlend; varying vec4 vCol; varying float vAdd; varying float vFog; varying float vMono;
void main() {
  if (vCol.a <= 0.0005) discard;
  vec4 tx = texture2D(uMap, vUv0);
  if (vBlend > 0.001) tx = mix(tx, texture2D(uMap, vUv1), vBlend);
  vec3 c = min(tx.rgb / max(tx.a, 0.004), vec3(1.0));
  c = c * c;                                            // sheets are authored in sRGB: decode to linear (cheap gamma 2)
  if (vMono > 0.001) c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))), vMono);   // luminance-only: lets a orange flame sheet become a blue flame
  vec3 rgb = c * tx.a * vCol.rgb * vCol.a;
  float a = tx.a * vCol.a * (1.0 - vAdd);
  rgb = mix(rgb, uFogCol * a, vFog);
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

let _quad = null;
function quadGeometry() {
  if (_quad) return _quad;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  _quad = g;
  return g;
}

/** Uniform set shared by every pool. */
export function makeParticleUniforms(atlas) {
  return {
    uTime: { value: 0 }, uMap: { value: atlas.texture }, uRect: { value: atlas.rect }, uGrid: { value: atlas.grid },
    uWind: { value: new THREE.Vector3(1.2, 0.0, 0.4) }, uLight: { value: new THREE.Vector3(1, 0.9, 0.75) },
    uPix: { value: 0.002 }, uFogD: { value: 0 }, uFogCol: { value: new THREE.Color(0xd9b48a) },
    uInset: { value: new THREE.Vector2(0.5 / atlas.size[0], 0.5 / atlas.size[1]) }, uFrameBlend: { value: 1 },
  };
}

export class ParticleSystem {
  /** @param opts {cap, uniforms, order, name} */
  constructor(scene, opts) {
    this.cap = opts.cap; this.name = opts.name || 'particles';
    this.data = new Float32Array(this.cap * STRIDE);
    this.expire = new Float32Array(this.cap);
    this.head = 0; this.hw = 0; this.time = 0; this.live = 0; this.spawned = 0;
    this.dmin = 1e9; this.dmax = -1;
    const geo = new THREE.InstancedBufferGeometry();
    const base = quadGeometry();
    geo.index = base.index; geo.attributes.position = base.attributes.position; geo.attributes.uv = base.attributes.uv;
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const names = ['aP0', 'aV', 'aSz', 'aC0', 'aC1', 'aPh', 'aSp', 'aMd', 'aEx', 'aEn', 'aLt'];
    names.forEach((n, i) => geo.setAttribute(n, new THREE.InterleavedBufferAttribute(this.buf, 4, i * 4)));
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: opts.uniforms, vertexShader: VERT, fragmentShader: FRAG, defines: { NS: NSPR },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = opts.order ?? 90; this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'fx_' + this.name;
    scene.add(this.mesh);
    this._cache = 0;
  }

  setCap(cap) { /* caps are fixed at construction (buffers are pre-allocated); this only limits how many slots are used */
    this.limit = Math.min(cap, this.cap);
  }

  /** Writes one particle at the ring head. Returns its slot. */
  emit(d) {
    const lim = this.limit || this.cap;
    const i = this.head; this.head = i + 1 >= lim ? 0 : i + 1;
    if (i + 1 > this.hw) this.hw = i + 1;
    if (i < this.dmin) this.dmin = i; if (i > this.dmax) this.dmax = i;
    const a = this.data, o = i * STRIDE;
    a[o] = d.x; a[o + 1] = d.y; a[o + 2] = d.z; a[o + 3] = this.time;
    a[o + 4] = d.vx; a[o + 5] = d.vy; a[o + 6] = d.vz; a[o + 7] = d.life;
    a[o + 8] = d.s0; a[o + 9] = d.s1; a[o + 10] = d.rot; a[o + 11] = d.rotV;
    a[o + 12] = d.r0; a[o + 13] = d.g0; a[o + 14] = d.b0; a[o + 15] = d.a0;
    a[o + 16] = d.r1; a[o + 17] = d.g1; a[o + 18] = d.b1; a[o + 19] = d.a1;
    a[o + 20] = d.drag; a[o + 21] = d.grav; a[o + 22] = d.ground; a[o + 23] = d.bounce;
    a[o + 24] = d.spr; a[o + 25] = d.f0; a[o + 26] = d.nPlay; a[o + 27] = d.fps;
    a[o + 28] = d.mode; a[o + 29] = d.pivot; a[o + 30] = d.aspect; a[o + 31] = d.len;
    a[o + 32] = d.add0; a[o + 33] = d.add1; a[o + 34] = d.lenSpd; a[o + 35] = d.turb;
    a[o + 36] = d.fin; a[o + 37] = d.fout; a[o + 38] = d.sCurve; a[o + 39] = d.cCurve;
    a[o + 40] = d.lit; a[o + 41] = d.wind; a[o + 42] = d.clip; a[o + 43] = d.mono;
    this.expire[i] = this.time + d.life;
    this.spawned++;
    return i;
  }

  /** Kill a slot early (e.g. an enemy bullet that hit something) if it still holds the particle born at `birth`. */
  kill(slot, birth) {
    const o = slot * STRIDE;
    if (Math.abs(this.data[o + 3] - birth) > 1e-4) return;
    this.data[o + 7] = 0.0001; this.expire[slot] = 0;
    if (slot < this.dmin) this.dmin = slot; if (slot > this.dmax) this.dmax = slot;
  }
  birthOf(slot) { return this.data[slot * STRIDE + 3]; }

  /** Advance the pool clock, upload the dirty range, count live particles (cheap: one pass over the expiry array). */
  update(time) {
    this.time = time;
    if (this.dmax >= this.dmin) {
      const buf = this.buf;
      buf.clearUpdateRanges();
      buf.addUpdateRange(this.dmin * STRIDE, (this.dmax - this.dmin + 1) * STRIDE);
      buf.needsUpdate = true;
      this.dmin = 1e9; this.dmax = -1;
    }
    this.geo.instanceCount = this.hw;
    let n = 0; const ex = this.expire;
    for (let i = 0, e = this.hw; i < e; i++) if (ex[i] > time) n++;
    this.live = n;
  }

  clear() { this.expire.fill(0); this.data.fill(0); this.head = 0; this.hw = 0; this.live = 0; this.buf.clearUpdateRanges(); this.buf.needsUpdate = true; this.dmin = 0; this.dmax = this.cap - 1; }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}

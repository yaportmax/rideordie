// Skid marks: one pooled ribbon mesh (ring buffer of quads) glued to the road surface. Each wheel owns a "trail"; samples are
// world contact points, so the ribbon follows the terrain/road height. Marks fade with age in the vertex shader (no CPU work
// after a segment is written) and the ring overwrites the oldest segments.
import * as THREE from 'three';

const VERT = /* glsl */`
uniform float uTime; uniform vec2 uFade; uniform float uFogD;
attribute vec2 aMark; attribute vec3 aCol;
varying vec2 vUv; varying float vA; varying vec3 vCol; varying float vFog;
void main() {
  float age = uTime - aMark.x;
  vA = aMark.y * (1.0 - smoothstep(uFade.x, uFade.y, age));
  vUv = uv; vCol = aCol;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vFog = 1.0 - exp(-uFogD * uFogD * dot(mv.xyz, mv.xyz));
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap; uniform vec3 uLight; uniform vec3 uFogCol;
varying vec2 vUv; varying float vA; varying vec3 vCol; varying float vFog;
void main() {
  float a = texture2D(uMap, vUv).a * vA;
  if (a < 0.004) discard;
  vec3 rgb = vCol * min(uLight, vec3(1.0));
  rgb = mix(rgb, uFogCol, vFog * 0.9);
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Trail {
  constructor() { this.active = false; this.n = 0; this.lx = 0; this.ly = 0; this.lz = 0; this.pLx = 0; this.pLy = 0; this.pLz = 0; this.pRx = 0; this.pRy = 0; this.pRz = 0; this.prevA = 0; this.along = 0; this.hw = 0.2; this.dx = 0; this.dz = 1; }
}

export class SkidMarks {
  /** @param opts {maxSegs, texture, uniforms (shared uLight/uFogD/uFogCol), fade:[start,end] seconds, minStep, order} */
  constructor(scene, opts = {}) {
    this.maxSegs = opts.maxSegs ?? 2400; this.minStep = opts.minStep ?? 0.32; this.time = 0;
    const N = this.maxSegs;
    this.pos = new Float32Array(N * 12); this.uv = new Float32Array(N * 8); this.mark = new Float32Array(N * 8); this.colr = new Float32Array(N * 12);
    const idx = new Uint16Array(N * 6);
    for (let i = 0; i < N; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6); }
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aUv = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
    this.aMark = new THREE.BufferAttribute(this.mark, 2).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.colr, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('uv', this.aUv); geo.setAttribute('aMark', this.aMark); geo.setAttribute('aCol', this.aCol);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const u = opts.uniforms || {};
    this.uniforms = {
      uTime: { value: 0 }, uMap: { value: opts.texture || null }, uFade: { value: new THREE.Vector2(...(opts.fade || [20, 38])) },
      uFogD: u.uFogD || { value: 0 }, uFogCol: u.uFogCol || { value: new THREE.Color(0xd9b48a) }, uLight: u.uLight || { value: new THREE.Vector3(1, 1, 1) },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = opts.order ?? 55; this.mesh.name = 'fx_skid';
    scene.add(this.mesh);
    this.head = 0; this.hw = 0; this.dmin = 1e9; this.dmax = -1;
    this.trails = new Map();
    this.stats = { segments: 0 };
  }

  setTexture(t) { this.uniforms.uMap.value = t; }

  _trail(key) { let t = this.trails.get(key); if (!t) { t = new Trail(); this.trails.set(key, t); } return t; }

  /** Feed one world-space contact sample for wheel `key`. r,g,b = mark colour (linear), alpha 0..1, halfW = tyre half width (m). */
  add(key, x, y, z, alpha, halfW, r = 0.02, g = 0.02, b = 0.02) {
    const tr = this._trail(key);
    const hw = halfW / 0.55;                         // the texture's dark body covers ~55% of the ribbon width
    if (!tr.active) { tr.active = true; tr.n = 0; tr.along = 0; }
    if (tr.n === 0) { tr.lx = x; tr.ly = y; tr.lz = z; tr.prevA = 0; tr.n = 1; tr.hw = hw; return; }
    const dx = x - tr.lx, dz = z - tr.lz, dy = y - tr.ly;
    const hd = Math.hypot(dx, dz);
    if (hd < this.minStep) return;
    const nx = dz / hd, nz = -dx / hd;               // left-hand normal in the ground plane
    if (tr.n === 1) {
      tr.pLx = tr.lx + nx * hw; tr.pLy = tr.ly; tr.pLz = tr.lz + nz * hw;
      tr.pRx = tr.lx - nx * hw; tr.pRy = tr.ly; tr.pRz = tr.lz - nz * hw;
    }
    const nLx = x + nx * hw, nLz = z + nz * hw, nRx = x - nx * hw, nRz = z - nz * hw;
    const dist = Math.hypot(hd, dy);
    const uvLen = hw * 2 * 4;
    this._push(tr.pLx, tr.pLy, tr.pLz, tr.pRx, tr.pRy, tr.pRz, nLx, y, nLz, nRx, y, nRz, tr.along / uvLen, (tr.along + dist) / uvLen, tr.prevA, alpha, r, g, b);
    tr.pLx = nLx; tr.pLy = y; tr.pLz = nLz; tr.pRx = nRx; tr.pRy = y; tr.pRz = nRz;
    tr.lx = x; tr.ly = y; tr.lz = z; tr.prevA = alpha; tr.along += dist; tr.n++; tr.dx = dx / hd; tr.dz = dz / hd; tr.hw = hw;
  }

  /** The wheel stopped marking: taper the trail out and close it. */
  end(key) {
    const tr = this.trails.get(key);
    if (!tr || !tr.active) return;
    tr.active = false;
    if (tr.n >= 2 && tr.prevA > 0.01) {
      const L = 0.55, x = tr.lx + tr.dx * L, z = tr.lz + tr.dz * L, y = tr.ly;
      const nx = tr.dz, nz = -tr.dx, hw = tr.hw;
      const uvLen = hw * 2 * 4;
      this._push(tr.pLx, tr.pLy, tr.pLz, tr.pRx, tr.pRy, tr.pRz, x + nx * hw, y, z + nz * hw, x - nx * hw, y, z - nz * hw, tr.along / uvLen, (tr.along + L) / uvLen, tr.prevA, 0, 0.02, 0.02, 0.02, true);
    }
    tr.n = 0;
  }

  _push(aLx, aLy, aLz, aRx, aRy, aRz, bLx, bLy, bLz, bRx, bRy, bRz, v0, v1, a0, a1, r, g, b, keepCol) {
    const i = this.head; this.head = (i + 1) % this.maxSegs; if (i + 1 > this.hw) this.hw = i + 1;
    if (i < this.dmin) this.dmin = i; if (i > this.dmax) this.dmax = i;
    const p = this.pos, o = i * 12;
    p[o] = aLx; p[o + 1] = aLy + 0.02; p[o + 2] = aLz; p[o + 3] = aRx; p[o + 4] = aRy + 0.02; p[o + 5] = aRz;
    p[o + 6] = bLx; p[o + 7] = bLy + 0.02; p[o + 8] = bLz; p[o + 9] = bRx; p[o + 10] = bRy + 0.02; p[o + 11] = bRz;
    const u = this.uv, q = i * 8;
    u[q] = 0; u[q + 1] = v0; u[q + 2] = 1; u[q + 3] = v0; u[q + 4] = 0; u[q + 5] = v1; u[q + 6] = 1; u[q + 7] = v1;
    const m = this.mark, t = this.time;
    m[q] = t; m[q + 1] = a0; m[q + 2] = t; m[q + 3] = a0; m[q + 4] = t; m[q + 5] = a1; m[q + 6] = t; m[q + 7] = a1;
    const c = this.colr, cc = i * 12;
    for (let k = 0; k < 4; k++) { c[cc + k * 3] = r; c[cc + k * 3 + 1] = g; c[cc + k * 3 + 2] = b; }
    this.stats.segments = this.hw;
  }

  update(time) {
    this.time = time; this.uniforms.uTime.value = time;
    if (this.dmax >= this.dmin) {
      const a = this.dmin, n = this.dmax - this.dmin + 1;
      const up = (attr, per) => { attr.clearUpdateRanges(); attr.addUpdateRange(a * per, n * per); attr.needsUpdate = true; };
      up(this.aPos, 12); up(this.aUv, 8); up(this.aMark, 8); up(this.aCol, 12);
      this.dmin = 1e9; this.dmax = -1;
    }
    this.mesh.geometry.setDrawRange(0, this.hw * 6);
  }

  clear() { this.pos.fill(0); this.mark.fill(0); this.head = 0; this.hw = 0; this.trails.clear(); this.dmin = 0; this.dmax = this.maxSegs - 1; }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

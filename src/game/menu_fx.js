// Lightweight FX for the front-end stages (title chase, garage): instanced camera-facing dust/smoke sprites with sun
// forward-scattering, additive tracer ribbons and muzzle-flash sprites. One draw call per system, fixed pools (no allocs).
import * as THREE from 'three';

const tl = new THREE.TextureLoader();
const texCache = new Map();
export function fxTex(name) {
  let t = texCache.get(name);
  if (!t) { t = tl.load(`/textures/particles/${name}.png`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(name, t); }
  return t;
}

// ------------------------------------------------------------------------------------------------ billboard sprites
const SPRITE_VERT = /* glsl */`
attribute vec4 iPos;     // xyz, size
attribute vec4 iData;    // alpha, rotation, frame, heat
uniform vec2 uGrid;
varying vec2 vUv; varying float vAlpha; varying float vHeat; varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(iData.y), s = sin(iData.y);
  vec2 p = position.xy; p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec3 w = iPos.xyz + (right * p.x + up * p.y) * iPos.w;
  vWorld = w;
  float f = iData.z; float col = mod(f, uGrid.x); float row = floor(f / uGrid.x);
  vUv = vec2((col + uv.x) / uGrid.x, 1.0 - (row + 1.0 - uv.y) / uGrid.y);
  vAlpha = iData.x; vHeat = iData.w;
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SPRITE_FRAG = /* glsl */`
uniform sampler2D map; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uTint; uniform float uFwd;
varying vec2 vUv; varying float vAlpha; varying float vHeat; varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  vec3 v = normalize(vWorld - cameraPosition);
  float fwd = pow(max(dot(v, uSunDir), 0.0), 6.0);
  vec3 lit = t.rgb * uTint * (uAmb + uSunCol * (0.35 + uFwd * fwd)) + vec3(1.6, 0.7, 0.25) * vHeat * t.a;
  gl_FragColor = vec4(lit, t.a * vAlpha);
  #include <fog_fragment>
}`;

/** Instanced, lit smoke/dust puffs. emit(pos, vel, {size, grow, life, alpha, drag, rise, frameRow}) */
export class PuffSystem {
  constructor(max = 400, opts = {}) {
    this.max = max; this.n = 0;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.aData.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iData', this.aData); g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG, transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        map: { value: null }, uGrid: { value: new THREE.Vector2(4, 4) }, uSunDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
        uSunCol: { value: new THREE.Color(1.6, 0.9, 0.5) }, uAmb: { value: new THREE.Color(0.35, 0.28, 0.25) }, uTint: { value: new THREE.Color(1, 1, 1) }, uFwd: { value: 3.0 },
      }]),
    });
    this.mat.uniforms.map.value = fxTex(opts.tex || 'dust_puff');
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = opts.renderOrder ?? 5;
    // particle state (SoA)
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.age = new Float32Array(max); this.life = new Float32Array(max); this.size0 = new Float32Array(max); this.grow = new Float32Array(max);
    this.alpha = new Float32Array(max); this.rot = new Float32Array(max); this.spin = new Float32Array(max); this.drag = new Float32Array(max);
    this.rise = new Float32Array(max); this.frame = new Float32Array(max); this.heat = new Float32Array(max);
    this.wind = new THREE.Vector3();   // air velocity (the title chase: air streams past the "moving" cars)
  }
  emit(pos, vel, o = {}) {
    let i = this.n;
    if (i >= this.max) { // replace the oldest
      let best = 0, ba = -1; for (let k = 0; k < this.max; k++) { const a = this.age[k] / this.life[k]; if (a > ba) { ba = a; best = k; } } i = best;
    } else this.n++;
    this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z;
    this.v[i * 3] = vel.x; this.v[i * 3 + 1] = vel.y; this.v[i * 3 + 2] = vel.z;
    this.age[i] = 0; this.life[i] = o.life ?? 2.5; this.size0[i] = o.size ?? 1; this.grow[i] = o.grow ?? 2; this.alpha[i] = o.alpha ?? 0.6;
    this.rot[i] = Math.random() * 6.283; this.spin[i] = (Math.random() - 0.5) * (o.spin ?? 0.8); this.drag[i] = o.drag ?? 1.5; this.rise[i] = o.rise ?? 0.4;
    const row = o.frameRow ?? ((Math.random() * 4) | 0);
    this.frame[i] = row * 4; this.heat[i] = o.heat ?? 0;
  }
  update(dt) {
    const w = this.wind;
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      // compact in place
      if (j !== i) this._move(i, j);
      const k = Math.min(1, this.drag[j] * dt);
      const b = j * 3;
      this.v[b] += (w.x - this.v[b]) * k; this.v[b + 1] += (w.y + this.rise[j] - this.v[b + 1]) * k; this.v[b + 2] += (w.z - this.v[b + 2]) * k;
      this.p[b] += this.v[b] * dt; this.p[b + 1] += this.v[b + 1] * dt; this.p[b + 2] += this.v[b + 2] * dt;
      this.rot[j] += this.spin[j] * dt;
      j++;
    }
    this.n = j;
    const P = this.aPos.array, D = this.aData.array;
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i];
      const a = this.alpha[i] * Math.min(1, t * 8) * (1 - t) * (1 - t);
      P[i * 4] = this.p[i * 3]; P[i * 4 + 1] = this.p[i * 3 + 1]; P[i * 4 + 2] = this.p[i * 3 + 2];
      P[i * 4 + 3] = this.size0[i] * (1 + this.grow[i] * Math.sqrt(t));
      D[i * 4] = a; D[i * 4 + 1] = this.rot[i]; D[i * 4 + 2] = this.frame[i] + Math.min(3, Math.floor(t * 4)); D[i * 4 + 3] = this.heat[i] * Math.max(0, 1 - t * 3);
    }
    this.geo.instanceCount = this.n;
    this.aPos.needsUpdate = true; this.aData.needsUpdate = true;
    if (this.n) { this.aPos.addUpdateRange(0, this.n * 4); this.aData.addUpdateRange(0, this.n * 4); }
  }
  _move(i, j) {
    for (let c = 0; c < 3; c++) { this.p[j * 3 + c] = this.p[i * 3 + c]; this.v[j * 3 + c] = this.v[i * 3 + c]; }
    this.age[j] = this.age[i]; this.life[j] = this.life[i]; this.size0[j] = this.size0[i]; this.grow[j] = this.grow[i]; this.alpha[j] = this.alpha[i];
    this.rot[j] = this.rot[i]; this.spin[j] = this.spin[i]; this.drag[j] = this.drag[i]; this.rise[j] = this.rise[i]; this.frame[j] = this.frame[i]; this.heat[j] = this.heat[i];
  }
  setLight(sunDir, sunCol, amb) { const u = this.mat.uniforms; if (sunDir) u.uSunDir.value.copy(sunDir); if (sunCol) u.uSunCol.value.copy(sunCol); if (amb) u.uAmb.value.copy(amb); }
  clear() { this.n = 0; this.geo.instanceCount = 0; }
}

// ------------------------------------------------------------------------------------------------ tracers
const TR_VERT = /* glsl */`
attribute vec3 iA; attribute vec4 iB;   // start, end.xyz + alpha
uniform float uWidth;
varying float vT; varying float vA; varying float vS;
void main() {
  vec3 a = iA, b = iB.xyz;
  vec3 p = mix(a, b, uv.x);
  vec3 dir = normalize(b - a + 1e-5);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(dir, toCam));
  p += side * (uv.y - 0.5) * uWidth;
  vT = uv.x; vA = iB.w; vS = uv.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const TR_FRAG = /* glsl */`
uniform vec3 uColor; varying float vT; varying float vA; varying float vS;
void main() { float e = 1.0 - abs(vS - 0.5) * 2.0; float k = pow(vT, 1.6) * e * e; gl_FragColor = vec4(uColor * k * vA, 1.0); }`;

/** Additive tracer streaks: fire(from, to, speed) moves a 6-10 m bright segment along the line. */
export class Tracers {
  constructor(max = 48, color = new THREE.Color(9, 5.2, 1.8)) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('uv', base.getAttribute('uv'));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); this.aB = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aA.setUsage(THREE.DynamicDrawUsage); this.aB.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.aA); g.setAttribute('iB', this.aB); g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({ vertexShader: TR_VERT, fragmentShader: TR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: color }, uWidth: { value: 0.07 } } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 6;
    this.list = [];
  }
  fire(from, to, speed = 380, len = 7) {
    if (this.list.length >= this.max) this.list.shift();
    const d = to.clone().sub(from); const dist = d.length(); d.multiplyScalar(1 / Math.max(1e-3, dist));
    this.list.push({ o: from.clone(), d, dist, t: 0, speed, len });
  }
  update(dt, drift) {
    const A = this.aA.array, B = this.aB.array;
    let n = 0;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      s.t += dt; const head = s.t * s.speed;
      if (head - s.len > s.dist) { this.list.splice(i, 1); i--; continue; }
      if (drift) s.o.addScaledVector(drift, dt);
      const h = Math.min(head, s.dist), tail = Math.max(0, head - s.len);
      A[n * 3] = s.o.x + s.d.x * tail; A[n * 3 + 1] = s.o.y + s.d.y * tail; A[n * 3 + 2] = s.o.z + s.d.z * tail;
      B[n * 4] = s.o.x + s.d.x * h; B[n * 4 + 1] = s.o.y + s.d.y * h; B[n * 4 + 2] = s.o.z + s.d.z * h; B[n * 4 + 3] = 1;
      n++;
    }
    this.geo.instanceCount = n; this.aA.needsUpdate = true; this.aB.needsUpdate = true;
  }
}

/** A muzzle flash sprite (additive, random cell of the flash sheet), shown for a frame or two per shot. */
export class MuzzleFlash {
  constructor(scale = 0.55) {
    const tex = fxTex('muzzle_flash_sheet').clone(); tex.needsUpdate = true; tex.repeat.set(0.25, 0.5);
    this.tex = tex; this.scale = scale;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(5, 3.4, 1.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.sprite.visible = false; this.sprite.renderOrder = 7;
    this.t = 0;
  }
  flash(pos) {
    const cell = [0, 1, 6][(Math.random() * 3) | 0];
    this.tex.offset.set((cell % 4) * 0.25, cell < 4 ? 0.5 : 0);
    this.sprite.position.copy(pos); this.sprite.material.rotation = Math.random() * 6.28;
    this.sprite.scale.setScalar(this.scale * (0.8 + Math.random() * 0.5)); this.sprite.visible = true; this.t = 0.045;
  }
  update(dt) { if (this.t > 0) { this.t -= dt; if (this.t <= 0) this.sprite.visible = false; } }
}

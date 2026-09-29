// Sea / lake: one camera-following plane at seaLevel(road, 'coast'|'dam') with animated procedural wave normals and a
// dedicated shader: Fresnel mix of the scattered water colour and the ANALYTIC sky (atmosphere.js, so the sea reflects exactly
// the sky you see and melts into the horizon haze), two-lobe HDR key-light glints (sun path by day, moon path by night; they
// bloom), the shared atmosphere fog, s-range fade. Plus per-chunk shoreline ribbons (foam + turquoise shallows).
// Programs are warmed in Game.prewarm via Water.prewarmMeshes().
import * as THREE from 'three';
import { seaLevel, COLS, EDGE } from './terrain_gen.js';
import { smoothstep, lerp } from '../core/util.js';
import { lookAt } from './look.js';
import { ATMO_GLSL, KEY, noiseTexture } from './atmosphere.js';

// Gerstner-like swell as analytic slopes. Each wave fades out once it drops below ~4 pixels of screen footprint `fw` (metres
// per pixel, from derivatives: grazing angles included) => no distant stripe aliasing; the variance it no longer resolves is
// returned in .z and turned into micro-roughness by the caller (duller, bluer reflections far away, like a real sea).
const WAVES = /* glsl */`
  vec3 dwave(vec2 p, vec2 dir, float wl, float speed, float slope, float fw, float t) {
    float f = 6.2831853 / wl;
    float lodw = 1.0 - smoothstep(wl * 0.12, wl * 0.3, fw);
    return vec3(dir * (cos(dot(p, dir) * f + t * speed) * slope * lodw), slope * slope * (1.0 - lodw));
  }
  vec3 waveGrad(vec2 p, float fw, float t) {
    vec3 g = vec3(0.0);
    g += dwave(p, normalize(vec2(0.95, 0.31)), 82.0, 0.85, 0.040, fw, t);
    g += dwave(p, normalize(vec2(0.55, 0.83)), 37.0, 1.10, 0.050, fw, t);
    g += dwave(p, normalize(vec2(-0.30, 0.95)), 17.0, 1.50, 0.060, fw, t);
    g += dwave(p, normalize(vec2(0.85, -0.52)), 8.3, 1.9, 0.070, fw, t);
    g += dwave(p, normalize(vec2(-0.76, -0.65)), 3.9, 2.6, 0.075, fw, t);
    g += dwave(p, normalize(vec2(0.20, -0.98)), 1.7, 3.3, 0.070, fw, t);
    g += dwave(p, normalize(vec2(-0.93, 0.37)), 0.8, 4.4, 0.060, fw, t);
    return g;
  }`;

const WATER_VERT = /* glsl */`
varying vec3 vWPos;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = /* glsl */`
#include <fog_pars_fragment>
${ATMO_GLSL}
uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform float uFade; uniform float uGlint;
uniform vec3 uKeyDir; uniform vec3 uKeyCol; uniform sampler2D uNoise;
varying vec3 vWPos;
${WAVES}
// detail normals from the shared tileable noise (two scrolling layers): breaks up the regular swell into choppy water
vec2 noiseGrad(vec2 p, float e) {
  float c = texture2D(uNoise, p).g, x = texture2D(uNoise, p + vec2(e, 0.0)).g, z = texture2D(uNoise, p + vec2(0.0, e)).g;
  return vec2(x - c, z - c) / e;
}
void main() {
  vec3 rel = vWPos - cameraPosition;
  float dist = length(rel);
  vec3 V = -rel / max(dist, 1e-3);
  float fw = max(length(dFdx(vWPos.xz)), length(dFdy(vWPos.xz)));
  vec3 w = waveGrad(vWPos.xz, fw, uTime);
  vec2 g = w.xy;
  g += noiseGrad(vWPos.xz * 0.011 + vec2(uTime * 0.004, uTime * 0.0023), 1.0 / 256.0) * 0.006;
  g += noiseGrad(vWPos.xz * 0.043 + vec2(-uTime * 0.009, uTime * 0.006), 1.0 / 256.0) * 0.002;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  // unresolved slope variance (rough, distant water): reflections tilt up into the bluer sky, Fresnel drops (shadowing /
  // masking of the facets at grazing angles), more body colour shows through
  float rough = clamp(sqrt(w.z) * 3.0, 0.0, 1.0);
  float NV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NV, 5.0) / (1.0 + 2.5 * rough);
  vec3 R = reflect(-V, N); R.y = max(abs(R.y), 0.03 + 0.2 * rough);
  R = normalize(R);
  vec3 sky = atmSky(R);
  // light scattered up out of the water body; wave faces tilted toward the key light catch a little more (subsurface)
  vec3 body = mix(uShallow, uDeep, smoothstep(15.0, 450.0, dist));
  float sss = pow(max(dot(N, normalize(uKeyDir + vec3(0.0, 0.6, 0.0))), 0.0), 4.0);
  body *= 0.85 + 0.5 * sss;
  // key-light glints: tight sparkle lobe + broad sun path (HDR => bloom)
  float rs = max(dot(reflect(-V, N), uKeyDir), 0.0);
  vec3 glint = uKeyCol * (pow(rs, 1400.0) * 55.0 + pow(rs, 120.0) * 1.1) * uGlint;
  vec3 col = mix(body, sky, F) + glint * (0.3 + 0.7 * F);
  gl_FragColor = vec4(col, uFade);
  #include <fog_fragment>
}`;

/** Water surface material (sharing `u` uniforms). */
function makeWaterMaterial(u) {
  const m = new THREE.ShaderMaterial({
    name: 'water', transparent: true, depthWrite: true, fog: true,
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), ...u, ...KEY, uNoise: { value: noiseTexture() } },
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
  });
  return m;
}

function makeFoamMaterial(u) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: u.uTime, uShallow: u.uShallow, uFade: u.uFade, uLight: { value: new THREE.Color(1, 1, 1) } }]),
    vertexShader: /* glsl */`
      attribute vec2 aFoam; varying vec2 vFoam; varying vec3 vW;
      #include <fog_pars_vertex>
      void main() { vFoam = aFoam; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vFoam; varying vec3 vW; uniform float uTime; uniform vec3 uShallow; uniform float uFade; uniform vec3 uLight;
      #include <fog_pars_fragment>
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float u = vFoam.x;                       // 0 at shoreline, 1 at outer edge of the ribbon
        float n = vn(vW.xz * 0.55 + vec2(uTime * 0.25, -uTime * 0.18)) * 0.6 + vn(vW.xz * 1.7 - uTime * 0.4) * 0.4;
        float surge = 0.5 + 0.5 * sin(uTime * 0.9 + vW.x * 0.05 + vW.z * 0.04 + n * 3.0);
        float edge = 0.10 + 0.22 * surge;
        float foam = (1.0 - smoothstep(edge, edge + 0.25, u + (n - 0.5) * 0.35)) * smoothstep(0.0, 0.05, u + 0.02);   // thick foam band that breathes
        float lace = smoothstep(0.42, 0.62, n + (0.5 - u) * 0.35) * (1.0 - smoothstep(0.35, 0.95, u));          // lacy trailing foam
        float f = clamp(foam + lace * 0.7, 0.0, 1.0);
        float shallow = (1.0 - smoothstep(0.0, 1.0, u)) * 0.55;
        vec3 col = mix(uShallow * 1.6, vec3(0.93, 0.97, 0.98) * uLight, f);
        float a = clamp(max(f * 0.95, shallow), 0.0, 1.0) * uFade * (1.0 - smoothstep(0.85, 1.0, u));
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  });
  // UniformsUtils.merge clones: re-link the shared uniforms so the ribbon follows time / fade / colours of the sea
  m.uniforms.uTime = u.uTime; m.uniforms.uShallow = u.uShallow; m.uniforms.uFade = u.uFade;
  m.name = 'shore';
  return m;
}

const _c = new THREE.Color();
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
// water body albedo (deep / shallow) per body of water
const BODY = {
  coast: { deep: new THREE.Color(0.012, 0.07, 0.11), shallow: new THREE.Color(0.03, 0.2, 0.2) },
  dam: { deep: new THREE.Color(0.016, 0.06, 0.07), shallow: new THREE.Color(0.04, 0.14, 0.12) },
};

export class Water {
  /** Throw-away meshes with the water + foam materials, for shader prewarming (same programs as in play). */
  static prewarmMeshes() {
    const u = { uTime: { value: 0 }, uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uFade: { value: 1 }, uGlint: { value: 1 } };
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const a = new THREE.Mesh(g, makeWaterMaterial(u)); a.frustumCulled = false;
    // the shoreline ribbons have no normals (vertexNormals is part of the program key)
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3)); fg.setAttribute('aFoam', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    const b = new THREE.Mesh(fg, makeFoamMaterial(u)); b.frustumCulled = false;
    return [a, b];
  }

  constructor(scene, road, opts = {}) {
    this.scene = scene; this.road = road; this.opts = opts;
    this.uniforms = { uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x06202e) }, uShallow: { value: new THREE.Color(0x0e5560) }, uFade: { value: 0 }, uGlint: { value: 1 } };
    this.material = makeWaterMaterial(this.uniforms);
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2).scale(18000, 1, 18000);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 10; this.mesh.visible = false; this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.foamMat = makeFoamMaterial(this.uniforms);
    this.ribbons = new Map(); // chunk -> mesh
    this.group = new THREE.Group(); this.group.name = 'shore'; scene.add(this.group);
    this.level = { coast: null, dam: null };
    this.s = 0;
  }

  levelOf(id) { if (this.level[id] === null) this.level[id] = seaLevel(this.road, id); return this.level[id]; }

  /** Build the shoreline ribbon of a chunk from its LOD0 terrain grid (ChunkGround). Called by Dressing for coast/dam chunks. */
  buildChunk(chunk, biomeId) {
    const g = chunk.ground, level = this.levelOf(biomeId), side = biomeId === 'dam' ? -1 : 1;
    const si = side > 0 ? 0 : 1, rows = g.rows, nc = g.nc, pos = g.pos;
    const V = [], F = [], I = [];
    let prev = -1;
    for (let r = 0; r < rows; r += 2) {
      // walk outward until the terrain dips under the sea
      let hit = -1;
      for (let c = 0; c < nc - 1; c++) {
        const y0 = pos[((si * rows + r) * nc + c) * 3 + 1], y1 = pos[((si * rows + r) * nc + c + 1) * 3 + 1];
        if (y0 >= level && y1 < level) { hit = c; break; }
      }
      if (hit < 0) { prev = -1; continue; }
      const i0 = ((si * rows + r) * nc + hit) * 3, i1 = ((si * rows + r) * nc + hit + 1) * 3;
      const t = (pos[i0 + 1] - level) / Math.max(1e-4, pos[i0 + 1] - pos[i1 + 1]);
      const x = lerp(pos[i0], pos[i1], t), z = lerp(pos[i0 + 2], pos[i1 + 2], t);
      let dx = pos[i1] - pos[i0], dz = pos[i1 + 2] - pos[i0 + 2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const y = level + 0.07;
      const W = 11 + 5 * Math.sin((chunk.s0 + r * 3) * 0.11);
      const base = V.length / 3;
      // 3 verts across: inland (hidden under terrain), shoreline, outer edge
      const put = (off, u) => { V.push(x + dx * off, y, z + dz * off); F.push(u, 0); };
      put(-2.5, -0.2); put(0, 0); put(W * 0.45, 0.45); put(W, 1.0);
      if (prev >= 0) for (let k = 0; k < 3; k++) { const a = prev + k, b = prev + k + 1, c2 = base + k, d2 = base + k + 1; I.push(a, c2, b, b, c2, d2); }
      prev = base;
    }
    if (!I.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(V, 3)); geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(F, 2)); geo.setIndex(I);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.foamMat);
    mesh.renderOrder = 11; mesh.frustumCulled = true;
    this.group.add(mesh); this.ribbons.set(chunk.c, mesh);
  }
  dropChunk(c) { const m = this.ribbons.get(c); if (m) { this.group.remove(m); m.geometry.dispose(); this.ribbons.delete(c); } }

  update(dt, cam, s) {
    this.s = s;
    this.uniforms.uTime.value += dt;
    const coastFade = smoothstep(19100, 19700, s) * (1 - smoothstep(30300, 30900, s));
    const damFade = smoothstep(49100, 49700, s);
    const fade = Math.max(coastFade, damFade);
    this.uniforms.uFade.value = fade;
    this.mesh.visible = fade > 0.003; this.group.visible = this.mesh.visible;
    if (!this.mesh.visible) return;
    const id = damFade > coastFade ? 'dam' : 'coast';
    this.mesh.position.set(cam.x, this.levelOf(id), cam.z);
    // water body lit by the key light + sky of the moment (albedo * irradiance / pi)
    const look = lookAt(s), key = KEY.uKeyCol.value, kd = KEY.uKeyDir.value;
    const E = (0.2126 * key.r + 0.7152 * key.g + 0.0722 * key.b) * Math.max(0.05, kd.y) + Math.PI * 0.5 * (lum(look.zen) + lum(look.hor));
    const B = BODY[id], k = E / Math.PI;
    this.uniforms.uDeep.value.copy(B.deep).multiplyScalar(k).lerp(_c.copy(look.zen).multiplyScalar(0.05), 0.15);
    this.uniforms.uShallow.value.copy(B.shallow).multiplyScalar(k);
    this.uniforms.uGlint.value = id === 'dam' ? 0.8 : 1;
    this.foamMat.uniforms.uLight.value.setRGB(1, 1, 1).lerp(look.sunCol, 0.15).multiplyScalar(Math.min(1.1, 0.12 + E * 0.22));
    // ribbons only near the camera
    for (const [c, m] of this.ribbons) { m.visible = Math.abs(c * 96 + 48 - s) < 700; }
  }

  dispose() {
    this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.material.dispose();
    for (const c of [...this.ribbons.keys()]) this.dropChunk(c);
    this.scene.remove(this.group); this.foamMat.dispose();
  }
}

export { COLS, EDGE };

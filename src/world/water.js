// Sea / lake: one camera-following plane at seaLevel(road, 'coast'|'dam') with animated procedural wave normals, sky/IBL reflection
// (scene.environment through the standard PBR pipeline, so Fresnel + sun glitter come for free), fog integration, s-range fade,
// plus per-chunk shoreline ribbons (foam + turquoise shallows) generated from the terrain grid.
import * as THREE from 'three';
import { seaLevel, COLS, EDGE } from './terrain_gen.js';
import { smoothstep, lerp } from '../core/util.js';
import { lookAt } from './look.js';

const WAVES = /* glsl */`
  vec2 dwave(vec2 p, vec2 dir, float wl, float speed, float slope, float dist, float t) {
    float f = 6.2831853 / wl;
    float lodw = smoothstep(dist / 130.0, dist / 30.0, wl);
    return dir * (cos(dot(p, dir) * f + t * speed) * slope * lodw);
  }
  vec2 waveGrad(vec2 p, float dist, float t) {
    vec2 g = vec2(0.0);
    g += dwave(p, normalize(vec2(0.95, 0.31)), 82.0, 0.85, 0.030, dist, t);
    g += dwave(p, normalize(vec2(0.55, 0.83)), 37.0, 1.10, 0.036, dist, t);
    g += dwave(p, normalize(vec2(-0.30, 0.95)), 17.0, 1.50, 0.045, dist, t);
    g += dwave(p, normalize(vec2(0.85, -0.52)), 8.3, 1.9, 0.050, dist, t);
    g += dwave(p, normalize(vec2(-0.76, -0.65)), 3.9, 2.6, 0.055, dist, t);
    g += dwave(p, normalize(vec2(0.20, -0.98)), 1.7, 3.3, 0.050, dist, t);
    return g;
  }`;

export class Water {
  constructor(scene, road, opts = {}) {
    this.scene = scene; this.road = road;
    this.uniforms = { uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x06202e) }, uShallow: { value: new THREE.Color(0x0e5560) }, uFade: { value: 0 }, uHorizon: { value: new THREE.Color(0xdfe6f0) } };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.075, metalness: 0.0, transparent: true, depthWrite: true, envMapIntensity: 1.7 });
    mat.name = 'water';
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWPos; uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform float uFade; uniform vec3 uHorizon;
        ${WAVES}`)
        .replace('#include <fog_fragment>', `#ifdef USE_FOG
          float wfog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColor, uHorizon, 0.88), wfog);
        #endif`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        float wdist = length(vViewPosition);
        diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(30.0, 600.0, wdist) * 0.7 + 0.3);
        diffuseColor.a = uFade;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 wg = waveGrad(vWPos.xz, wdist, uTime);
          vec3 wn = normalize(vec3(-wg.x, 1.0, -wg.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`);
    };
    this.material = mat;
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2).scale(18000, 1, 18000);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 10; this.mesh.visible = false; this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.foamMat = this._foamMaterial();
    this.ribbons = new Map(); // chunk -> mesh
    this.group = new THREE.Group(); this.group.name = 'shore'; scene.add(this.group);
    this.level = { coast: null, dam: null };
    this.s = 0;
  }

  levelOf(id) { if (this.level[id] === null) this.level[id] = seaLevel(this.road, id); return this.level[id]; }

  _foamMaterial() {
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: this.uniforms.uTime, uShallow: this.uniforms.uShallow, uFade: this.uniforms.uFade, uLight: { value: new THREE.Color(1, 1, 1) } }]),
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
          vec3 col = mix(uShallow * 1.25, vec3(0.93, 0.97, 0.98) * uLight, f);
          float a = clamp(max(f * 0.95, shallow), 0.0, 1.0) * uFade * (1.0 - smoothstep(0.85, 1.0, u));
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
    });
    // UniformsUtils.merge clones: re-link the shared uniforms so the ribbon follows time / fade / colours of the sea
    m.uniforms.uTime = this.uniforms.uTime; m.uniforms.uShallow = this.uniforms.uShallow; m.uniforms.uFade = this.uniforms.uFade;
    m.name = 'shore';
    return m;
  }

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
    const coastFade = smoothstep(18800, 19800, s) * (1 - smoothstep(31000, 32500, s));
    const damFade = smoothstep(48800, 49800, s);
    const fade = Math.max(coastFade, damFade);
    this.uniforms.uFade.value = fade;
    this.mesh.visible = fade > 0.003; this.group.visible = this.mesh.visible;
    if (!this.mesh.visible) return;
    const id = damFade > coastFade ? 'dam' : 'coast';
    this.mesh.position.set(cam.x, this.levelOf(id), cam.z);
    const look = lookAt(s);
    // sea colour follows the sky / light of the moment
    const night = 1 - look.night * 0.75;
    this.uniforms.uDeep.value.setRGB(0.008, 0.045, 0.075).lerp(look.hemiSky, 0.05).multiplyScalar(0.85 * night + 0.15);
    this.uniforms.uHorizon.value.setRGB(0.86, 0.90, 0.95).lerp(look.fog, 0.10).multiplyScalar(0.12 + 0.88 * night);
    this.uniforms.uShallow.value.setRGB(0.02, 0.22, 0.27).lerp(look.fog, 0.06).multiplyScalar(night * 0.9 + 0.1);
    this.foamMat.uniforms.uLight.value.setRGB(1, 1, 1).lerp(look.sunCol, 0.12).multiplyScalar(0.55 + 0.45 * night);
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

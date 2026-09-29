// Far scenery: three camera-following mountain silhouette rings (3.2 km / 4.8 km / 7 km) with per-biome height / colour / plateau profile,
// haze-blended into the fog colour. 3 draw calls, no textures. Drawn before the sky so the sky only fills what the mountains leave open.
import * as THREE from 'three';
import { biomeAt } from '../../data/biomes.js';
import { lookAt } from '../look.js';
import { lerp } from '../../core/util.js';

// per biome: amplitude (m above the base), colour, plateau (0 rounded .. 1 mesas), snow, seaFactor (suppress toward the sea side), base drop
const PROFILE = {
  desert:   { amp: 130, col: [0.72, 0.53, 0.38], plateau: 0.75, snow: 0, sea: 0, ridge: 0.35 },
  canyon:   { amp: 300, col: [0.66, 0.34, 0.22], plateau: 0.9, snow: 0, sea: 0, ridge: 0.5 },
  coast:    { amp: 320, col: [0.36, 0.45, 0.58], plateau: 0.2, snow: 0, sea: 1, ridge: 0.7 },
  mountain: { amp: 900, col: [0.40, 0.45, 0.55], plateau: 0.0, snow: 1, sea: 0, ridge: 1.0 },
  city:     { amp: 90, col: [0.42, 0.38, 0.44], plateau: 0.3, snow: 0, sea: 0, ridge: 0.4 },
  dam:      { amp: 520, col: [0.42, 0.44, 0.52], plateau: 0.1, snow: 0.35, sea: 0.6, ridge: 0.8 },
};
const LAYERS = [
  { r: 3300, k: 1.0, mix: 0.62, seed: 1.3 },
  { r: 4900, k: 1.25, mix: 0.42, seed: 4.1 },
  { r: 7100, k: 1.5, mix: 0.24, seed: 7.7 },
];
const N = 240;

const VERT = /* glsl */`
  attribute float aAng; attribute float aTop;
  uniform float uR; uniform float uAmp; uniform float uPlateau; uniform float uRidge; uniform float uSeed; uniform vec3 uSea; uniform float uBase;
  varying float vTop; varying float vH;
  float prof(float a) {
    float m = sin(3.0 * a + uSeed) + 0.85 * sin(5.0 * a + uSeed * 2.1) + 0.65 * sin(8.0 * a + uSeed * 3.7) + 0.45 * sin(13.0 * a + uSeed * 5.3) + 0.3 * sin(21.0 * a + uSeed * 7.9) + 0.18 * sin(34.0 * a + uSeed * 11.0);
    m /= 3.4;
    float soft = 0.5 + 0.5 * m;
    float ridged = 1.0 - abs(m);
    float h = mix(soft, ridged * ridged, uRidge * 0.7);
    float plateau = smoothstep(0.30, 0.48, h);
    h = mix(h, plateau * 0.85 + 0.1 * h, uPlateau);
    return clamp(h, 0.0, 1.0);
  }
  void main() {
    float h = prof(aAng) * uAmp;
    float toward = uSea.x * sin(aAng) + uSea.y * cos(aAng);           // +1 facing the sea side
    h *= 1.0 - uSea.z * smoothstep(-0.25, 0.55, toward);
    vec3 p = vec3(sin(aAng) * uR, mix(-1500.0, h + uBase, aTop), cos(aAng) * uR);
    vTop = aTop; vH = h / max(uAmp, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99999);
  }`;
const FRAG = /* glsl */`
  uniform vec3 uFog; uniform vec3 uCol; uniform float uMix; uniform float uSnow; uniform vec3 uSun;
  varying float vTop; varying float vH;
  void main() {
    float t = smoothstep(0.02, 0.9, vTop);
    vec3 c = mix(uFog, uCol, uMix * (0.35 + 0.65 * t));
    c = mix(c, vec3(0.92, 0.94, 1.0) * uSun, uSnow * smoothstep(0.55, 0.85, vH) * smoothstep(0.85, 1.0, vTop) * uMix);
    c = mix(c, uFog, (1.0 - smoothstep(0.0, 0.16, vTop)));
    gl_FragColor = vec4(c, 1.0);
  }`;

export class Backdrop {
  constructor(scene) {
    this.scene = scene; this.group = new THREE.Group(); this.group.name = 'backdrop'; scene.add(this.group);
    this.layers = LAYERS.map((L, i) => {
      const pos = new Float32Array((N + 1) * 2 * 3), ang = new Float32Array((N + 1) * 2), top = new Float32Array((N + 1) * 2), idx = [];
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * Math.PI * 2 - Math.PI;
        ang[k * 2] = a; ang[k * 2 + 1] = a; top[k * 2] = 0; top[k * 2 + 1] = 1;
        if (k < N) { const b = k * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aAng', new THREE.BufferAttribute(ang, 1)); g.setAttribute('aTop', new THREE.BufferAttribute(top, 1)); g.setIndex(idx);
      const u = {
        uR: { value: L.r }, uAmp: { value: 300 }, uPlateau: { value: 0 }, uRidge: { value: 0.5 }, uSeed: { value: L.seed }, uSea: { value: new THREE.Vector3(0, 1, 0) }, uBase: { value: -60 },
        uFog: { value: new THREE.Color() }, uCol: { value: new THREE.Color() }, uMix: { value: L.mix }, uSnow: { value: 0 }, uSun: { value: new THREE.Color(1, 1, 1) },
      };
      const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, side: THREE.DoubleSide, depthWrite: true, depthTest: true, fog: false });
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = -5 + i * 0.01; mesh.matrixAutoUpdate = true;
      this.group.add(mesh);
      return { mesh, u, L };
    });
    this._c = new THREE.Color();
  }

  update(dt, cam, s, road) {
    this.group.position.set(cam.x, cam.y, cam.z);
    const b = biomeAt(s), A = PROFILE[b.a], B = PROFILE[b.b], w = b.w;
    const amp = lerp(A.amp, B.amp, w), plateau = lerp(A.plateau, B.plateau, w), ridge = lerp(A.ridge, B.ridge, w), snow = lerp(A.snow, B.snow, w), sea = lerp(A.sea, B.sea, w);
    const look = lookAt(s);
    // sea side: coast = left of the road heading, dam = right
    let sx = 0, sz = 1;
    if (road) { const sm = road.sample(s, {}); const side = b.a === 'dam' || (b.b === 'dam' && w > 0.5) ? -1 : 1; sx = sm.nx * side; sz = sm.nz * side; }
    const night = 1 - look.night * 0.8;
    for (const { u, L } of this.layers) {
      u.uAmp.value = amp * L.k; u.uPlateau.value = plateau; u.uRidge.value = ridge; u.uSnow.value = snow;
      u.uSea.value.set(sx, sz, sea);
      u.uBase.value = -70 - 40 * L.k;
      u.uFog.value.copy(look.fog);
      this._c.setRGB(lerp(A.col[0], B.col[0], w), lerp(A.col[1], B.col[1], w), lerp(A.col[2], B.col[2], w));
      this._c.multiplyScalar(0.55 + 0.45 * night).lerp(look.hemiSky, 0.14);
      u.uCol.value.copy(this._c);
      u.uSun.value.copy(look.sunCol).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(night);
    }
  }
  dispose() { for (const { mesh } of this.layers) { mesh.geometry.dispose(); mesh.material.dispose(); } this.scene.remove(this.group); }
}

// Far scenery: three camera-following silhouette rings (3.3 km / 4.9 km / 7.1 km), haze-blended into the fog colour. 3 draw calls, no textures.
// The ring geometry is only a tall band: the silhouette itself is computed PER PIXEL from the view angle (periodic noise on a circle), so
// ridgelines stay crisp at any resolution; edges are anti-aliased with alpha-to-coverage. Per biome: desert mesas + buttes, layered canyon
// rims, coastal headlands (suppressed toward the sea), jagged snowy peaks, a ruined city skyline with lit windows at night, and a mountain
// valley for the dam. Slopes facing the sun are lit, the others fall into shadow (derivative of the silhouette), so ranges read as 3D.
// The road ahead leads into a notch/valley in the mountain biomes. Drawn before the sky so the sky only fills what the ranges leave open.
import * as THREE from 'three';
import { roadBiomeAt } from '../biome_context.js';
import { lookAt } from '../look.js';
import { lerp } from '../../core/util.js';

// per biome: shape id (0 mesas, 1 canyon rim, 2 hills, 3 peaks, 4 skyline, 5 valley), amplitude (m), colour (linear), rock band colour,
// snow amount, sea suppression, notch toward the road ahead
const PROFILE = {
  desert:   { shape: 0, amp: 300, col: [0.62, 0.42, 0.29], band: [0.78, 0.55, 0.38], snow: 0, sea: 0, notch: 0 },
  canyon:   { shape: 1, amp: 460, col: [0.6, 0.29, 0.18], band: [0.82, 0.56, 0.4], snow: 0, sea: 0, notch: 0.25 },
  coast:    { shape: 2, amp: 420, col: [0.3, 0.37, 0.36], band: [0.4, 0.44, 0.4], snow: 0, sea: 1, notch: 0 },
  mountain: { shape: 3, amp: 1150, col: [0.33, 0.37, 0.45], band: [0.42, 0.44, 0.5], snow: 1, sea: 0, notch: 0.55 },
  city:     { shape: 4, amp: 280, col: [0.2, 0.2, 0.25], band: [0.26, 0.25, 0.3], snow: 0, sea: 0, notch: 0 },
  dam:      { shape: 5, amp: 700, col: [0.36, 0.38, 0.44], band: [0.44, 0.45, 0.5], snow: 0.45, sea: 0.6, notch: 0.7 },
  underground: { shape: 1, amp: 0, col: [0.1, 0.18, 0.22], band: [0.2, 0.3, 0.34], snow: 0, sea: 0, notch: 0 },
  sky:      { shape: 2, amp: 0, col: [0.62, 0.7, 0.88], band: [0.72, 0.8, 0.96], snow: 0, sea: 0, notch: 0 },
  hell:     { shape: 3, amp: 950, col: [0.2, 0.11, 0.12], band: [0.34, 0.18, 0.14], snow: 0, sea: 0, notch: 0.35 },
  space:    { shape: 2, amp: 0, col: [0.025, 0.035, 0.07], band: [0.04, 0.05, 0.09], snow: 0, sea: 0, notch: 0 },
};
const LAYERS = [
  { r: 3300, k: 1.0, mix: 0.84, seed: 1.3 },
  { r: 4900, k: 1.3, mix: 0.62, seed: 4.1 },
  { r: 7100, k: 1.6, mix: 0.4, seed: 7.7 },
];
const N = 360;

const VERT = /* glsl */`
  attribute float aAng; attribute float aTop;
  uniform float uR; uniform float uTopH; uniform float uBase;
  varying vec2 vAY;   // (angle, height above the ring base in m)
  void main() {
    float y = mix(-1500.0, uTopH, aTop);
    vec3 p = vec3(sin(aAng) * uR, y + uBase, cos(aAng) * uR);
    vAY = vec2(aAng, y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99999);
  }`;

const FRAG = /* glsl */`
  uniform vec3 uFog; uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uBandA; uniform vec3 uBandB;
  uniform float uMix; uniform float uSeed; uniform float uW; uniform vec2 uShape; uniform vec2 uAmp; uniform vec2 uSnow; uniform vec2 uNotch;
  uniform vec3 uSea; uniform float uHead; uniform vec3 uSun; uniform vec3 uKey; uniform vec3 uAmb; uniform float uNight; uniform float uR;
  varying vec2 vAY;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  // periodic noise around the ring: 2D value noise sampled on a circle of radius f (about 6.3 f features per turn)
  float rn(float a, float f, float s) { return vn(vec2(cos(a), sin(a)) * f + vec2(s * 17.1, s * 5.3)); }
  float fbmR(float a, float f, float s, int oct) { float v = 0.0, amp = 0.5, n = 0.0; for (int i = 0; i < 9; i++) { if (i >= oct) break; v += amp * rn(a, f, s + float(i) * 3.1); n += amp; amp *= 0.5; f *= 2.03; } return v / n; }
  float ridgeR(float a, float f, float s, int oct) { float v = 0.0, amp = 0.5, n = 0.0, w = 1.0; for (int i = 0; i < 9; i++) { if (i >= oct) break;
    float r = 1.0 - abs(rn(a, f, s + float(i) * 3.1) * 2.0 - 1.0); r *= r; v += amp * r * w; w = clamp(r * 1.6, 0.3, 1.0); n += amp; amp *= 0.5; f *= 2.07; } return v / n; }
  // silhouette height (0..1 of amp) for one shape; also returns a material id in m (0 rock, 1 building)
  float shapeH(float sh, float a, float s, out float m) {
    m = 0.0;
    if (sh < 0.5) {                       // desert: isolated mesas / buttes (flat caprock, steep cliff, flared talus) over low rolling dunes
      float base = fbmR(a, 3.0, s, 5) * 0.22;
      float mz = fbmR(a, 11.0, s + 9.0, 4), lvl = floor(fbmR(a, 2.0, s + 3.0, 2) * 3.0) / 3.0;
      float field = smoothstep(0.35, 0.6, fbmR(a, 2.5, s + 5.0, 2));                    // mesas cluster in some directions
      float cap = smoothstep(0.585, 0.6, mz) * (0.45 + 0.55 * lvl);
      float talus = smoothstep(0.5, 0.6, mz) * 0.3 * (0.45 + 0.55 * lvl);
      float top = max(cap, talus) * field + fbmR(a, 90.0, s, 3) * 0.015 * step(0.01, cap);
      return max(base, top) + fbmR(a, 60.0, s + 1.0, 4) * 0.03;
    }
    if (sh < 1.5) {                       // canyon: long flat rims with notches and stepped edges
      float r = fbmR(a, 2.5, s, 4);
      float st = floor(r * 6.0) / 6.0 + smoothstep(0.0, 0.25, fract(r * 6.0)) / 6.0;
      return st * 0.9 + fbmR(a, 70.0, s, 4) * 0.03 - smoothstep(0.62, 0.68, rn(a, 6.0, s + 4.0)) * 0.25;
    }
    if (sh < 2.5) {                       // coast: rolling headlands
      return fbmR(a, 2.2, s, 6) * 0.9 + ridgeR(a, 8.0, s, 5) * 0.12;
    }
    if (sh < 3.5) {                       // mountains: sharp ridged peaks
      return pow(ridgeR(a, 2.4, s, 9), 1.25) * 1.15;
    }
    if (sh < 4.5) {                       // city: skyline blocks + antennae over a low hazy base
      float fa = (a + 3.14159265) / 6.2831853;
      float c1 = floor(fa * 520.0), c2 = floor(fa * 260.0 + 0.5);
      float dt = smoothstep(0.35, 0.75, fbmR(a, 1.6, s, 3));                // downtown clusters
      float b1 = h21(vec2(c1, s)) < 0.72 ? h21(vec2(c1 + 3.0, s)) : 0.0, b2 = h21(vec2(c2, s + 7.0)) < 0.5 ? h21(vec2(c2, s + 9.0)) : 0.0;
      float hb = max(b1 * (0.25 + 0.75 * dt) * 0.8, b2 * (0.3 + 0.7 * dt));
      hb = hb * hb * 1.1;
      float ant = step(0.965, h21(vec2(c1, s + 2.0))) * step(abs(fract(fa * 520.0) - 0.5), 0.06) * (hb + 0.18);
      m = hb > 0.02 ? 1.0 : 0.0;
      return max(max(hb, ant), fbmR(a, 12.0, s, 3) * 0.08);
    }
    return pow(ridgeR(a, 2.0, s, 8), 1.1) * 1.05;                          // dam: high valley walls
  }
  float fullH(float a, out float m, out float snowK) {
    float mA, mB;
    float hA = shapeH(uShape.x, a, uSeed, mA) * uAmp.x;
    float hB = uW > 0.001 ? shapeH(uShape.y, a, uSeed + 0.5, mB) * uAmp.y : hA;
    if (uW <= 0.001) mB = mA;
    float h = mix(hA, hB, uW); m = uW > 0.5 ? mB : mA;
    // suppress toward the sea, notch where the road runs into the range
    float toward = uSea.x * sin(a) + uSea.y * cos(a);
    h *= 1.0 - uSea.z * smoothstep(-0.25, 0.55, toward);
    float da = a - uHead; da = mod(da + 3.14159265, 6.2831853) - 3.14159265;
    h *= 1.0 - mix(uNotch.x, uNotch.y, uW) * exp(-da * da * 9.0);
    snowK = mix(uSnow.x, uSnow.y, uW);
    return h;
  }
  void main() {
    float a = vAY.x, y = vAY.y;
    float m, snowK;
    float h = fullH(a, m, snowK);
    float amp = max(mix(uAmp.x, uAmp.y, uW), 1.0);
    // anti-aliased silhouette (alpha to coverage with MSAA; plain threshold otherwise)
    float dy = max(fwidth(y), 1e-3);
    float cov = clamp((h - y) / dy + 0.5, 0.0, 1.0);
    // slope of the ridge line -> lit / shadowed faces (tangent of the ring at a); derivatives before the discard
    float dh = dFdx(h) / max(abs(dFdx(a)), 1e-5) * sign(dFdx(a));
    if (cov <= 0.0) discard;
    vec2 tang = vec2(cos(a), -sin(a));
    float face = clamp(-dh / (uR * 0.35) * dot(tang, normalize(uKey.xz + 1e-4)) * 3.0, -1.0, 1.0);
    float t = clamp(y / amp, 0.0, 1.0);
    vec3 col = mix(uColA, uColB, uW), band = mix(uBandA, uBandB, uW);
    // rock layering: horizontal strata (canyon / mesas strongest)
    float strata = smoothstep(0.35, 0.65, vn(vec2(y / (amp * 0.07), uSeed)));
    col = mix(col, band, strata * 0.45);
    // snow cap on the high parts (noisy line), lit side brighter
    float sl = 0.55 + 0.12 * (rn(a, 40.0, uSeed + 2.0) - 0.5);
    float snow = snowK * smoothstep(sl, sl + 0.06, t) * smoothstep(sl - 0.05, sl + 0.25, h / amp);
    col = mix(col, vec3(0.9, 0.93, 1.0), snow);
    // lighting: ambient + key light modulated by the face direction; lower parts get extra haze
    vec3 lit = col * (uAmb + uKey.y * uSun * (0.55 + 0.45 * face));
    // city at night: scattered lit windows (floor-group sized so they stay stable at this distance)
    if (m > 0.5) {
      vec2 wc = vec2(floor((a + 3.14159265) / 6.2831853 * 2600.0), floor(y / 9.0));
      float on = step(0.83, h21(wc + uSeed)) * step(y, h - 6.0);
      lit += vec3(1.0, 0.72, 0.4) * on * uNight * 0.9;
    }
    float haze = uMix * (0.55 + 0.45 * smoothstep(-0.05, 0.85, t));
    vec3 c = mix(uFog, lit, haze);
    c = mix(c, uFog, 1.0 - smoothstep(0.0, 0.12, (y + 60.0) / amp));
    gl_FragColor = vec4(c, cov);
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
        uR: { value: L.r }, uTopH: { value: 1200 }, uBase: { value: -60 }, uSeed: { value: L.seed }, uW: { value: 0 },
        uShape: { value: new THREE.Vector2() }, uAmp: { value: new THREE.Vector2(300, 300) }, uSnow: { value: new THREE.Vector2() }, uNotch: { value: new THREE.Vector2() },
        uSea: { value: new THREE.Vector3(0, 1, 0) }, uHead: { value: 0 },
        uFog: { value: new THREE.Color() }, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uBandA: { value: new THREE.Color() }, uBandB: { value: new THREE.Color() },
        uMix: { value: L.mix }, uSun: { value: new THREE.Color(1, 1, 1) }, uKey: { value: new THREE.Vector3(0, 1, 0) }, uAmb: { value: new THREE.Color(0.3, 0.3, 0.3) }, uNight: { value: 0 },
      };
      const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, side: THREE.DoubleSide, depthWrite: true, depthTest: true, fog: false, alphaToCoverage: true });
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = -5 + i * 0.01; mesh.matrixAutoUpdate = true;
      this.group.add(mesh);
      return { mesh, u, L };
    });
    this._c = new THREE.Color(); this._sm = {};
  }

  update(dt, cam, s, road) {
    this.group.position.set(cam.x, cam.y, cam.z);
    const b = roadBiomeAt(road, s), A = PROFILE[b.a], B = PROFILE[b.b], w = b.w;
    const look = lookAt(s, undefined, road);
    // sea side: coast = left of the road heading, dam = right; heading = direction of the road ahead (for the valley notch)
    let sx = 0, sz = 1, head = 0;
    if (road) {
      const sm = road.sample(s, this._sm); const side = b.a === 'dam' || (b.b === 'dam' && w > 0.5) ? -1 : 1; sx = sm.nx * side; sz = sm.nz * side;
      const ahead = road.sample(s + 2500, {}); head = Math.atan2(ahead.x - cam.x, ahead.z - cam.z);
    }
    const sea = lerp(A.sea, B.sea, w);
    const night = look.night;
    // key light: sun by day, moon at night (direction TO the light, same convention as the sky rig)
    const useMoon = look.sun < 2 && look.moonEl > look.sun;
    const el = (useMoon ? look.moonEl : look.sun) * Math.PI / 180, az = (useMoon ? look.moonAz : look.az) * Math.PI / 180;
    const kx = Math.sin(az) * Math.cos(el), ky = Math.max(0.05, Math.sin(el) + 0.25), kz = Math.cos(az) * Math.cos(el);
    for (const { u, L } of this.layers) {
      u.uShape.value.set(A.shape, B.shape); u.uAmp.value.set(A.amp * L.k, B.amp * L.k); u.uW.value = w;
      u.uSnow.value.set(A.snow, B.snow); u.uNotch.value.set(A.notch, B.notch);
      u.uTopH.value = Math.max(A.amp, B.amp) * L.k * 1.3 + 40;
      u.uSea.value.set(sx, sz, sea); u.uHead.value = head;
      u.uBase.value = -40 - 25 * L.k;
      u.uFog.value.copy(look.fog);
      u.uColA.value.setRGB(...A.col); u.uColB.value.setRGB(...B.col); u.uBandA.value.setRGB(...A.band); u.uBandB.value.setRGB(...B.band);
      u.uKey.value.set(kx, ky, kz);
      u.uSun.value.copy(useMoon ? look.moonCol : look.sunCol).multiplyScalar(useMoon ? 0.35 : 0.42);
      u.uAmb.value.copy(look.hemiSky).multiplyScalar(0.3 * (1 - 0.6 * night)).lerp(look.fog, 0.25);
      u.uNight.value = night;
    }
  }
  dispose() { for (const { mesh } of this.layers) { mesh.geometry.dispose(); mesh.material.dispose(); } this.scene.remove(this.group); }
}

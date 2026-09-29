// Materials for the big set pieces (the dam): falling / flowing water sheets, spray mist, hanging cloth banners, still reservoir water.
// All share CITY_U (uNight, uTime) with the city materials; every material is a single program, created once.
import * as THREE from 'three';
import { CITY_U } from './city_mat.js';

const NOISE = /* glsl */`
  float sH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float sN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sH(i), sH(i + vec2(1.0, 0.0)), f.x), mix(sH(i + vec2(0.0, 1.0)), sH(i + vec2(1.0, 1.0)), f.x), f.y); }`;

let _flow = null;
/**
 * Aerated falling / sliding water. uv.x = 0..1 across the sheet, uv.y = metres along the flow (downstream = +).
 * aFac: x = speed (m/s), y = opacity, z = spread (0 = glassy chute .. 1 = broken spray jet), w = phase.
 */
export function flowMaterial() {
  if (_flow) return _flow;
  const m = new THREE.ShaderMaterial({
    name: 'set_flow', transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: CITY_U.uTime, uNight: CITY_U.uNight }]),
    vertexShader: /* glsl */`
      attribute vec4 aFac; varying vec2 vUv; varying vec4 vF; varying vec3 vN; varying vec3 vV;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vF = aFac; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz;
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uNight; varying vec2 vUv; varying vec4 vF; varying vec3 vN; varying vec3 vV;
      #include <fog_pars_fragment>
      ${NOISE}
      void main() {
        float sp = vF.x, t = uTime * sp;
        vec2 p = vec2(vUv.x * (6.0 + 10.0 * vF.z), (vUv.y - t) * 0.09);
        float n = sN(p * vec2(1.0, 1.0) + vF.w * 13.0) * 0.55 + sN(p * vec2(2.7, 3.1) + 7.0) * 0.3 + sN(p * vec2(7.0, 9.0) - 3.0) * 0.15;
        float streak = smoothstep(0.3, 0.75, n);
        float edge = smoothstep(0.0, 0.12 + 0.25 * vF.z, vUv.x) * smoothstep(0.0, 0.12 + 0.25 * vF.z, 1.0 - vUv.x);
        float a = vF.y * edge * mix(0.62 + 0.38 * streak, smoothstep(0.35, 0.7, n + 0.15), vF.z);
        float lit = mix(1.0, 0.22, uNight) * (0.75 + 0.25 * abs(dot(normalize(vN), normalize(vV))));
        vec3 col = mix(vec3(0.46, 0.55, 0.56), vec3(0.93, 0.96, 0.97), streak) * lit;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        #include <fog_fragment>
      }`,
  });
  m.uniforms.uTime = CITY_U.uTime; m.uniforms.uNight = CITY_U.uNight;
  _flow = m;
  return m;
}

let _mist = null;
/** Spray / mist puffs: camera-facing quads (all corners at the puff centre; aFac.z = radius, aFac.x = phase, aFac.y = opacity). */
export function mistMaterial() {
  if (_mist) return _mist;
  const m = new THREE.ShaderMaterial({
    name: 'set_mist', transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: CITY_U.uTime, uNight: CITY_U.uNight }]),
    vertexShader: /* glsl */`
      attribute vec4 aFac; varying vec2 vUv; varying vec4 vF;
      #include <fog_pars_vertex>
      uniform float uTime;
      void main() {
        vUv = uv; vF = aFac;
        vec4 w = modelMatrix * vec4(position, 1.0);
        float br = 1.0 + 0.15 * sin(uTime * 0.6 + aFac.x * 20.0);
        w.y += 2.0 * sin(uTime * 0.25 + aFac.x * 9.0);
        vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        w.xyz += (r * (uv.x - 0.5) + u * (uv.y - 0.5)) * 2.0 * aFac.z * br;
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uNight; varying vec2 vUv; varying vec4 vF;
      #include <fog_pars_fragment>
      ${NOISE}
      void main() {
        vec2 q = vUv - 0.5; float d = length(q) * 2.0;
        float n = sN(vUv * 4.0 + vec2(uTime * 0.05, -uTime * 0.08) + vF.x * 17.0) * 0.6 + sN(vUv * 9.0 - uTime * 0.11) * 0.4;
        float a = (1.0 - smoothstep(0.3, 1.0, d + (n - 0.5) * 0.5)) * vF.y;
        vec3 col = vec3(0.86, 0.9, 0.92) * mix(1.0, 0.2, uNight);
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  });
  m.uniforms.uTime = CITY_U.uTime; m.uniforms.uNight = CITY_U.uNight;
  _mist = m;
  return m;
}

/** Raider war banner texture: tattered black cloth, blood-red skull with horns and crossed pistons. */
let _banTex = null;
function bannerTexture() {
  if (_banTex) return _banTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#16100e'; g.fillRect(0, 0, 256, 1024);
  // grime
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${40 + Math.random() * 30},${25 + Math.random() * 15},${20},${Math.random() * 0.25})`; g.fillRect(Math.random() * 256, Math.random() * 1024, 2 + Math.random() * 12, 2 + Math.random() * 30); }
  // borders
  g.fillStyle = '#7a1510'; g.fillRect(10, 0, 10, 1024); g.fillRect(236, 0, 10, 1024);
  // skull
  const cx = 128, cy = 300;
  g.fillStyle = '#b3241a';
  g.beginPath(); g.ellipse(cx, cy, 78, 86, 0, 0, Math.PI * 2); g.fill();
  g.fillRect(cx - 50, cy + 40, 100, 70);
  g.beginPath(); g.moveTo(cx - 70, cy - 40); g.quadraticCurveTo(cx - 150, cy - 80, cx - 120, cy - 190); g.quadraticCurveTo(cx - 105, cy - 110, cx - 40, cy - 70); g.fill();
  g.beginPath(); g.moveTo(cx + 70, cy - 40); g.quadraticCurveTo(cx + 150, cy - 80, cx + 120, cy - 190); g.quadraticCurveTo(cx + 105, cy - 110, cx + 40, cy - 70); g.fill();
  g.fillStyle = '#16100e';
  g.beginPath(); g.ellipse(cx - 32, cy + 5, 22, 26, 0.2, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx + 32, cy + 5, 22, 26, -0.2, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(cx, cy + 30); g.lineTo(cx - 12, cy + 55); g.lineTo(cx + 12, cy + 55); g.fill();
  for (let k = 0; k < 5; k++) g.fillRect(cx - 42 + k * 18, cy + 74, 10, 30);
  // crossed pistons
  g.strokeStyle = '#b3241a'; g.lineWidth = 22; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - 100, cy + 190); g.lineTo(cx + 100, cy + 400); g.stroke();
  g.beginPath(); g.moveTo(cx + 100, cy + 190); g.lineTo(cx - 100, cy + 400); g.stroke();
  // dripping paint
  g.fillStyle = '#8f1b13';
  for (let i = 0; i < 14; i++) { const x = cx - 80 + Math.random() * 160, y = cy + 60 + Math.random() * 60; g.fillRect(x, y, 4, 40 + Math.random() * 160); }
  // tattered bottom (alpha)
  g.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < 256; x += 8) { const h = 30 + Math.random() * 140; g.beginPath(); g.moveTo(x, 1024); g.lineTo(x + 4, 1024 - h); g.lineTo(x + 8, 1024); g.fill(); }
  for (let i = 0; i < 18; i++) { g.beginPath(); g.ellipse(20 + Math.random() * 216, 560 + Math.random() * 400, 4 + Math.random() * 12, 6 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  _banTex = t;
  return t;
}

let _banner = null;
/** Hanging cloth: aFac.x = 0 at the fixed top .. 1 at the free bottom (ripple amplitude), aFac.y = phase. */
export function bannerMaterial() {
  if (_banner) return _banner;
  const m = new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.95, metalness: 0 });
  m.name = 'set_banner';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = CITY_U.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aFac; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float k = aFac.x; transformed += normal * (sin(uTime * 1.3 + position.y * 0.07 + aFac.y * 6.0) * 0.9 + sin(uTime * 2.9 + position.x * 0.11) * 0.35) * k * k; }`);
  };
  m.customProgramCacheKey = () => 'set_banner_v1';
  _banner = m;
  return m;
}

let _res = null;
/** Still reservoir water behind the dam (seen from high cameras / the dam ends): dark, sky-reflective. */
export function reservoirMaterial() {
  if (_res) return _res;
  _res = new THREE.MeshStandardMaterial({ color: 0x0b1a1c, roughness: 0.06, metalness: 0.0 });
  _res.name = 'set_reservoir';
  return _res;
}

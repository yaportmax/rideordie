// Terrain + road materials (MeshStandardMaterial + shader injection): 12-layer splat from array textures,
// planar mapping with triplanar for rock/cliff layers, per-layer tiling, macro variation, distance-faded detail.
import * as THREE from 'three';
import { LAYERS } from './terrain_gen.js';

/** Metres covered by one texture tile, per layer. */
const TILE = { sand: 6, dirt_red: 5, gravel: 3, dry_grass: 4, rock_red: 9, rock_grey: 9, snow: 6, forest_floor: 4, grass_green: 4, concrete: 5, cliff: 12, concrete_cracked: 5 };
const TRIPLANAR = new Set(['rock_red', 'rock_grey', 'cliff']);
const SIZE = 1024;

function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('img ' + url)); im.src = url; });
}
function pixels(im) {
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, SIZE, SIZE);
  return g.getImageData(0, 0, SIZE, SIZE).data;
}

let cache = null;
/** Builds the two array textures: albedo (rgb + unused a) and nra (normal.xy, roughness, ao). */
export async function loadGroundArrays(base = '/textures/') {
  if (cache) return cache;
  cache = (async () => {
    const n = LAYERS.length, layerBytes = SIZE * SIZE * 4;
    const alb = new Uint8Array(layerBytes * n), nra = new Uint8Array(layerBytes * n);
    await Promise.all(LAYERS.map(async (name, i) => {
      try {
        const [a, nm, arm] = await Promise.all([loadImage(`${base}${name}/albedo.jpg`), loadImage(`${base}${name}/normal.jpg`), loadImage(`${base}${name}/arm.jpg`)]);
        const pa = pixels(a), pn = pixels(nm), pr = pixels(arm);
        const o = i * layerBytes;
        for (let p = 0; p < SIZE * SIZE * 4; p += 4) {
          alb[o + p] = pa[p]; alb[o + p + 1] = pa[p + 1]; alb[o + p + 2] = pa[p + 2]; alb[o + p + 3] = 255;
          nra[o + p] = pn[p]; nra[o + p + 1] = pn[p + 1]; nra[o + p + 2] = pr[p + 1]; nra[o + p + 3] = pr[p];
        }
      } catch (e) { console.warn('ground layer missing', name, e.message); const o = i * layerBytes; for (let p = 0; p < SIZE * SIZE * 4; p += 4) { alb[o + p] = 150; alb[o + p + 1] = 130; alb[o + p + 2] = 100; alb[o + p + 3] = 255; nra[o + p] = 128; nra[o + p + 1] = 128; nra[o + p + 2] = 200; nra[o + p + 3] = 255; } }
    }));
    const mk = (data, srgb) => {
      const t = new THREE.DataArrayTexture(data, SIZE, SIZE, n);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
      return t;
    };
    return { albedo: mk(alb, true), nra: mk(nra, false) };
  })();
  return cache;
}

const TILE_ARR = LAYERS.map((n) => 1 / (TILE[n] ?? 5));
const TRI_ARR = LAYERS.map((n) => (TRIPLANAR.has(n) ? 1 : 0));

/** Shared terrain material. `arrays` from loadGroundArrays(). */
export function makeTerrainMaterial(arrays) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.name = 'terrain';
  const uniforms = {
    uAlbedo: { value: arrays.albedo }, uNRA: { value: arrays.nra },
    uTile: { value: TILE_ARR }, uTri: { value: TRI_ARR }, uNormalStrength: { value: 1.0 },
    uWetness: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSplat0; attribute vec4 aSplat1; attribute vec4 aSplat2; attribute float aMacro;
        varying vec4 vSplat0; varying vec4 vSplat1; varying vec4 vSplat2; varying float vMacro; varying vec3 vWPos; varying vec3 vWNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat0 = aSplat0; vSplat1 = aSplat1; vSplat2 = aSplat2; vMacro = aMacro;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray uAlbedo; uniform sampler2DArray uNRA; uniform float uTile[12]; uniform float uTri[12]; uniform float uNormalStrength; uniform float uWetness;
        varying vec4 vSplat0; varying vec4 vSplat1; varying vec4 vSplat2; varying float vMacro; varying vec3 vWPos; varying vec3 vWNrm;
        struct Lay { vec3 albedo; vec2 nxy; float rough; float ao; };
        Lay sampleLayer(int i, vec3 wp, vec3 wn, vec3 tw) {
          float sc = uTile[i]; Lay l;
          if (uTri[i] > 0.5) {
            vec4 a0 = texture(uAlbedo, vec3(wp.zy * sc, float(i))), a1 = texture(uAlbedo, vec3(wp.xz * sc, float(i))), a2 = texture(uAlbedo, vec3(wp.xy * sc, float(i)));
            vec4 n0 = texture(uNRA, vec3(wp.zy * sc, float(i))), n1 = texture(uNRA, vec3(wp.xz * sc, float(i))), n2 = texture(uNRA, vec3(wp.xy * sc, float(i)));
            l.albedo = a0.rgb * tw.x + a1.rgb * tw.y + a2.rgb * tw.z;
            vec4 n = n0 * tw.x + n1 * tw.y + n2 * tw.z;
            l.nxy = n.xy * 2.0 - 1.0; l.rough = n.z; l.ao = n.w;
          } else {
            vec2 uv = wp.xz * sc; vec4 a = texture(uAlbedo, vec3(uv, float(i))); vec4 n = texture(uNRA, vec3(uv, float(i)));
            // cheap anti-tiling: blend a second, rotated/scaled sample
            vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * wp.xz * sc * 0.37 + 0.5; vec4 a2 = texture(uAlbedo, vec3(uv2, float(i))); vec4 n2b = texture(uNRA, vec3(uv2, float(i)));
            float mixw = 0.35; a = mix(a, a2, mixw); n = mix(n, n2b, mixw);
            l.albedo = a.rgb; l.nxy = n.xy * 2.0 - 1.0; l.rough = n.z; l.ao = n.w;
          }
          return l;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 tw = pow(abs(normalize(vWNrm)), vec3(6.0)); tw /= (tw.x + tw.y + tw.z);
        vec3 accA = vec3(0.0); vec2 accN = vec2(0.0); float accR = 0.0; float accO = 0.0; float accW = 0.0;
        float wv[12] = float[12](vSplat0.x, vSplat0.y, vSplat0.z, vSplat0.w, vSplat1.x, vSplat1.y, vSplat1.z, vSplat1.w, vSplat2.x, vSplat2.y, vSplat2.z, vSplat2.w);
        for (int i = 0; i < 12; i++) { float w = wv[i]; if (w > 0.02) { Lay l = sampleLayer(i, vWPos, vWNrm, tw); accA += l.albedo * w; accN += l.nxy * w; accR += l.rough * w; accO += l.ao * w; accW += w; } }
        accW = max(accW, 0.001); accA /= accW; accN /= accW; accR /= accW; accO /= accW;
        float dist = length(vViewPosition);
        vec3 tint = vec3(vMacro);
        diffuseColor.rgb = accA * tint * mix(0.75, 1.0, accO);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(accR * (1.0 - uWetness * 0.5), 0.35, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // perturb the geometric normal with the blended tangent-space normal (world-planar approximation)
          vec3 N = normalize(normal);
          vec3 up = abs(N.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 T = normalize(cross(up, N)); vec3 B = cross(N, T);
          vec3 tn = vec3(accN * uNormalStrength * (1.0 - smoothstep(60.0, 220.0, dist)), 0.0); tn.z = sqrt(max(0.0, 1.0 - dot(tn.xy, tn.xy)));
          normal = normalize(T * tn.x + B * tn.y + N * tn.z);
        }`);
  };
  return mat;
}

/** Road material: asphalt PBR + procedural lane markings, wear stripes and oil stains. uv = (lateral m, distance m). */
export function makeRoadMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.name = 'road';
  const uniforms = { uAsph: { value: tex.albedo }, uAsphN: { value: tex.normal }, uAsphA: { value: tex.arm }, uWet: { value: 0 } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRoadUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRoadUv = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uAsph; uniform sampler2D uAsphN; uniform sampler2D uAsphA; uniform float uWet;
        varying vec2 vRoadUv;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float roadMask; float lineMask; float lineYellow;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 ruv = vec2(vRoadUv.x, vRoadUv.y);
        vec2 tuv = ruv * 0.25;
        vec3 asph = texture2D(uAsph, tuv).rgb;
        float wear = vn(ruv * vec2(0.6, 0.05)) * 0.6 + vn(ruv * vec2(2.5, 0.4)) * 0.4;
        // wheel tracks (darker, smoother) in each lane
        float lane = mod(ruv.x + 7.0, 3.5) / 3.5; float track = smoothstep(0.18, 0.3, lane) * (1.0 - smoothstep(0.32, 0.44, lane)) + smoothstep(0.58, 0.7, lane) * (1.0 - smoothstep(0.72, 0.84, lane));
        float oil = smoothstep(0.62, 0.78, vn(ruv * vec2(1.3, 0.35) + 11.0)) * 0.5;
        vec3 col = asph * (0.85 + 0.25 * wear) * (1.0 - track * 0.22 - oil * 0.35);
        // markings
        float ax = abs(ruv.x);
        float edge = (1.0 - smoothstep(6.5, 6.6, ax)) * smoothstep(6.15, 6.25, ax);           // solid white edge lines at +-6.35
        float dashCell = mod(ruv.y, 12.0);
        float dash = step(dashCell, 6.0);                                               // 6 m dash, 6 m gap
        float laneLine = 0.0; for (int k = -1; k <= 1; k++) { float lx = float(k) * 3.5; laneLine = max(laneLine, (1.0 - smoothstep(0.07, 0.09, abs(ruv.x - lx))) * dash); }
        // centre double yellow between the two middle lanes is skipped (one-way highway): dashed white only
        float shoulderT = smoothstep(7.0, 7.4, ax);
        float chip = smoothstep(0.35, 0.75, vn(ruv * vec2(3.0, 1.2))); // chipped paint
        float paint = clamp(max(edge, laneLine) * (0.55 + 0.45 * chip), 0.0, 1.0) * (1.0 - shoulderT);
        col = mix(col, vec3(0.86, 0.85, 0.8) * (0.85 + 0.15 * chip), paint);
        // shoulder: gravel/dirt blend
        vec3 dirt = vec3(0.42, 0.36, 0.29) * (0.8 + 0.4 * vn(ruv * 1.7));
        col = mix(col, dirt, shoulderT);
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(0.92, 0.6, track * 0.5), 0.98, shoulderT);
        roughnessFactor = mix(roughnessFactor, 0.35, uWet * (1.0 - shoulderT));
        roughnessFactor = mix(roughnessFactor, 0.55, paint);`);
  };
  return mat;
}

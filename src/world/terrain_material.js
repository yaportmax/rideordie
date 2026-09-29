// Terrain + road materials (MeshStandardMaterial + shader injection).
//  Terrain: 12-layer splat from array textures. World-space normals (whiteout blend), planar layers with a 45° anti-tiling second sample,
//           triplanar rock/cliff layers, per-pixel height blending, weight break-up noise, canyon strata bands, sand ripples, wet shoreline.
//  Road:    lane-tile worn asphalt + broad asphalt + cracked patches, repair patches, tar-sealed cracks, tyre marks, oil, worn paint from the
//           line atlas (yellow median edge, white right edge, 3 m dashes / 9 m gaps), cat's eyes that glow at night, dusty / wet / sandy /
//           snowy per biome, puddles, kerb + sidewalk in the city, and a verge that uses the terrain's own splat so the seam is invisible.
// Texture coordinates use world xz wrapped by TEX_WRAP (terrain) and road distance wrapped by ROAD_WRAP: every tile size and noise scale
// below divides those periods, so there are no seams and no fp32 precision loss at 60 km.
import * as THREE from 'three';
import { LAYERS } from './terrain_gen.js';
import { coverPrewarmMeshes } from './dressing/groundcover.js';

/** Metres covered by one texture tile, per layer (all divide TEX_WRAP = 720). */
const TILE = { sand: 6, dirt_red: 5, gravel: 3, dry_grass: 4, rock_red: 9, rock_grey: 9, snow: 6, forest_floor: 4, grass_green: 4, concrete: 5, cliff: 12, concrete_cracked: 5 };
const TRIPLANAR = new Set(['rock_red', 'rock_grey', 'cliff']);
/** Extra array layers used by the road shader (after the 12 terrain layers). */
export const ROAD_LAYERS = ['asphalt_worn', 'asphalt', 'asphalt_cracked'];
const ALL = [...LAYERS, ...ROAD_LAYERS];
const SIZE = 1024;
const LINES_W = 64, LINES_H = 768, LINES_N = 9;

function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('img ' + url)); im.src = url; });
}
function pixels(im, w = SIZE, h = SIZE) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}
function tex2D(im, srgb) {
  const t = new THREE.Texture(im);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

let cache = null, resolved = null;
/** Builds the ground array textures (albedo rgb, nra = normal.xy + roughness + ao) with the 12 terrain + 3 road layers, the road line
 *  array, the macro noise and the detail normal. Cached; makeRoadMaterial() needs it resolved first. */
export async function loadGroundArrays(base = '/textures/') {
  if (cache) return cache;
  cache = (async () => {
    const n = ALL.length, layerBytes = SIZE * SIZE * 4;
    const alb = new Uint8Array(layerBytes * n), nra = new Uint8Array(layerBytes * n);
    const extras = Promise.all([loadImage(`${base}road_markings/lines.png`), loadImage(`${base}detail/macro_noise.png`), loadImage(`${base}detail/detail_normal.jpg`)]).catch((e) => { console.warn('ground extras missing', e.message); return null; });
    await Promise.all(ALL.map(async (name, i) => {
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
    const mk = (data, srgb, w = SIZE, h = SIZE, layers = n, aniso = 16) => {
      const t = new THREE.DataArrayTexture(data, w, h, layers);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true; t.anisotropy = aniso; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
      return t;
    };
    const out = { albedo: mk(alb, true), nra: mk(nra, false) };
    const ex = await extras;
    // road line atlas: 9 columns of 64 x 768 -> 9 array layers (no mip bleeding between line variants)
    const lines = new Uint8Array(LINES_W * LINES_H * 4 * LINES_N);
    if (ex) {
      const px = pixels(ex[0], LINES_W * LINES_N, LINES_H);
      for (let l = 0; l < LINES_N; l++) for (let y = 0; y < LINES_H; y++) for (let x = 0; x < LINES_W; x++) {
        const si = (y * LINES_W * LINES_N + l * LINES_W + x) * 4, di = ((l * LINES_H + y) * LINES_W + x) * 4;
        lines[di] = px[si]; lines[di + 1] = px[si + 1]; lines[di + 2] = 0; lines[di + 3] = 255;
      }
      out.macro = tex2D(ex[1], false); out.detail = tex2D(ex[2], false);
    } else {
      const flat = (v) => { const t = new THREE.DataTexture(new Uint8Array([v[0], v[1], v[2], v[3]]), 1, 1); t.needsUpdate = true; return t; };
      out.macro = flat([128, 128, 128, 128]); out.detail = flat([128, 128, 255, 255]);
    }
    out.lines = mk(lines, false, LINES_W, LINES_H, LINES_N, 16);
    resolved = out;
    return out;
  })();
  return cache;
}

const GAIN = { concrete: 0.6, concrete_cracked: 0.66, snow: 1.05, grass_green: 0.92 };
const TILE_ARR = LAYERS.map((n) => 1 / (TILE[n] ?? 5));
const GAIN_ARR = LAYERS.map((n) => GAIN[n] ?? 1);
const TRI_ARR = LAYERS.map((n) => (TRIPLANAR.has(n) ? 1 : 0));

// ------------------------------------------------------------------------------------------------ shared ground GLSL
const GROUND_GLSL = /* glsl */`
  precision highp sampler2DArray;
  uniform sampler2DArray uAlbedo; uniform sampler2DArray uNRA; uniform sampler2D uMacroT; uniform sampler2D uDetailN;
  uniform float uTile[12]; uniform float uTri[12]; uniform float uGain[12]; uniform float uNormalStrength;
  struct GS { vec3 alb; vec3 n; float rough; float ao; };
  float gLum(vec3 c) { return dot(c, vec3(0.3, 0.55, 0.15)); }
  // Whiteout-blended world normal of one layer. uv conventions: image up = +z (top), +y (sides) - the array rows start at the image top.
  // Gradients come from gDx/gDy (d tp / d screen, computed once outside every loop / branch: no undefined derivatives).
  vec3 gDx, gDy;
  void gLayer(int i, vec3 tp, vec3 N, vec3 bl, float antiW, float fadeN, out vec3 alb, out vec3 nW, out vec2 ra) {
    float sc = uTile[i], fi = float(i);
    if (uTri[i] > 0.5) {
      vec3 sg = vec3(N.x < 0.0 ? -1.0 : 1.0, N.y < 0.0 ? -1.0 : 1.0, N.z < 0.0 ? -1.0 : 1.0);
      vec3 aN = abs(N);
      alb = vec3(0.0); nW = vec3(0.0); ra = vec2(0.0);
      if (bl.x > 0.02) {
        vec2 uv = vec2(tp.z * sg.x, -tp.y) * sc, g1 = vec2(gDx.z * sg.x, -gDx.y) * sc, g2 = vec2(gDy.z * sg.x, -gDy.y) * sc;
        vec4 a = textureGrad(uAlbedo, vec3(uv, fi), g1, g2), m = textureGrad(uNRA, vec3(uv, fi), g1, g2);
        vec3 t = vec3((m.xy * 2.0 - 1.0) * fadeN, 1.0); t.x *= sg.x;
        t = vec3(t.xy + N.zy, t.z * aN.x); t.z *= sg.x;
        alb += a.rgb * bl.x; nW += t.zyx * bl.x; ra += m.zw * bl.x;
      }
      if (bl.y > 0.02) {
        vec2 uv = vec2(tp.x * sg.y, -tp.z) * sc, g1 = vec2(gDx.x * sg.y, -gDx.z) * sc, g2 = vec2(gDy.x * sg.y, -gDy.z) * sc;
        vec4 a = textureGrad(uAlbedo, vec3(uv, fi), g1, g2), m = textureGrad(uNRA, vec3(uv, fi), g1, g2);
        vec3 t = vec3((m.xy * 2.0 - 1.0) * fadeN, 1.0); t.x *= sg.y;
        t = vec3(t.xy + N.xz, t.z * aN.y); t.z *= sg.y;
        alb += a.rgb * bl.y; nW += t.xzy * bl.y; ra += m.zw * bl.y;
      }
      if (bl.z > 0.02) {
        vec2 uv = vec2(-tp.x * sg.z, -tp.y) * sc, g1 = vec2(-gDx.x * sg.z, -gDx.y) * sc, g2 = vec2(-gDy.x * sg.z, -gDy.y) * sc;
        vec4 a = textureGrad(uAlbedo, vec3(uv, fi), g1, g2), m = textureGrad(uNRA, vec3(uv, fi), g1, g2);
        vec3 t = vec3((m.xy * 2.0 - 1.0) * fadeN, 1.0); t.x *= -sg.z;
        t = vec3(t.xy + N.xy, t.z * aN.z); t.z *= sg.z;
        alb += a.rgb * bl.z; nW += t.xyz * bl.z; ra += m.zw * bl.z;
      }
      float bs = max(bl.x * step(0.02, bl.x) + bl.y * step(0.02, bl.y) + bl.z * step(0.02, bl.z), 1e-3);
      alb /= bs; ra /= bs; nW = normalize(nW);
    } else {
      vec2 uv = vec2(tp.x, -tp.z) * sc, g1 = vec2(gDx.x, -gDx.z) * sc, g2 = vec2(gDy.x, -gDy.z) * sc;
      vec4 a = textureGrad(uAlbedo, vec3(uv, fi), g1, g2), m = textureGrad(uNRA, vec3(uv, fi), g1, g2);
      vec2 uv2 = vec2(uv.x - uv.y, uv.x + uv.y) * 0.25 + vec2(0.37, 0.61);          // 45 deg, x0.354: keeps the TEX_WRAP period
      vec2 h1 = vec2(g1.x - g1.y, g1.x + g1.y) * 0.25, h2 = vec2(g2.x - g2.y, g2.x + g2.y) * 0.25;
      vec4 a2 = textureGrad(uAlbedo, vec3(uv2, fi), h1, h2), m2 = textureGrad(uNRA, vec3(uv2, fi), h1, h2);
      vec2 n1 = m.xy * 2.0 - 1.0, n2 = m2.xy * 2.0 - 1.0;
      n2 = vec2(n2.x + n2.y, -n2.x + n2.y) * 0.70710678;                               // back into the uv frame
      alb = mix(a.rgb, a2.rgb, antiW); ra = mix(m.zw, m2.zw, antiW);
      vec2 nxy = mix(n1, n2, antiW) * fadeN;
      if (i == 0) {                                                                    // sand: wind ripples (0.9 m) at eye level
        vec4 q = textureGrad(uMacroT, tp.xz / 45.0, gDx.xz / 45.0, gDy.xz / 45.0);
        float ph = dot(tp.xz, vec2(0.6, 0.8)) * 6.9813170 + q.y * 7.0 + q.z * 3.0;
        float r = sin(ph) + 0.35 * sin(2.0 * ph + 1.3);
        nxy += vec2(0.6, 0.8) * r * 0.22 * fadeN * smoothstep(0.35, 0.6, q.x);
        alb *= 1.0 + 0.06 * r * fadeN;
      }
      vec3 t = vec3(nxy + N.xz, max(0.05, sqrt(max(0.0, 1.0 - dot(nxy, nxy)))) * abs(N.y));
      nW = normalize(t.xzy);
    }
  }
  /** Blend the splat layers at tp (wrapped world pos). N = geometric world normal, dist = view distance, strata = canyon/desert rock banding. */
  // gDx / gDy must be set (dFdx/dFdy of tp) by the caller OUTSIDE any branch before calling this.
  vec4 gTex(sampler2D t, vec2 uv, float k) { return textureGrad(t, uv, gDx.xz * k, gDy.xz * k); }
  GS groundSample(vec3 tp, vec3 N, float wv[12], float dist, float strata) {
    vec3 bl = pow(abs(N), vec3(4.0)); bl /= (bl.x + bl.y + bl.z);
    vec4 q1 = gTex(uMacroT, tp.xz / 45.0, 1.0 / 45.0), q2 = gTex(uMacroT, tp.xz / 15.0 + 0.31, 1.0 / 15.0);
    float antiW = 0.22 + 0.36 * q1.w;
    float fadeN = uNormalStrength * (1.0 - 0.75 * smoothstep(90.0, 420.0, dist));
    // weight break-up: every layer gets its own low-frequency noise so borders stop following the vertex grid
    float wsum = 0.0;
    for (int i = 0; i < 12; i++) {
      int c = i - (i / 4) * 4;
      float nz = mix(q1[c], q2[3 - c], 0.4);
      wv[i] = wv[i] * (0.3 + 1.4 * nz);
    }
    // per-pixel slope: snow never sticks to steep faces (their weight moves to rock)
    float flatK = smoothstep(0.62, 0.84, N.y + (q2.x - 0.5) * 0.12);
    float snowOff = wv[6] * (1.0 - flatK);
    wv[6] -= snowOff; wv[10] += snowOff * 0.7; wv[5] += snowOff * 0.3;
    for (int i = 0; i < 12; i++) wsum += wv[i];
    // layered sandstone: colour bands follow world height (warped), thin dark erosion ledges
    vec3 stTint = vec3(1.0);
    if (strata > 0.01) {
      float y = tp.y + (gTex(uMacroT, tp.xz / 180.0, 1.0 / 180.0).x - 0.5) * 16.0;
      vec2 gy1 = vec2(gDx.y, 0.0), gy2 = vec2(gDy.y, 0.0);
      float b1 = textureGrad(uMacroT, vec2(y / 61.0, 0.21), gy1 / 61.0, gy2 / 61.0).y, b2 = textureGrad(uMacroT, vec2(y / 14.0, 0.73), gy1 / 14.0, gy2 / 14.0).z;
      vec3 tint = mix(vec3(1.1, 0.96, 0.86), vec3(0.78, 0.56, 0.46), smoothstep(0.3, 0.7, b1)) * mix(0.86, 1.12, b2);
      tint *= 1.0 - 0.25 * smoothstep(0.82, 0.93, b2);
      stTint = mix(vec3(1.0), tint, strata);
    }
    float rockStreak = 1.0;
    if (bl.x + bl.z > 0.05) {
      float sx = textureGrad(uMacroT, vec2(tp.z / 11.0, tp.y / 95.0), vec2(gDx.z / 11.0, gDx.y / 95.0), vec2(gDy.z / 11.0, gDy.y / 95.0)).y;
      float sz = textureGrad(uMacroT, vec2(tp.x / 11.0, tp.y / 95.0 + 0.5), vec2(gDx.x / 11.0, gDx.y / 95.0), vec2(gDy.x / 11.0, gDy.y / 95.0)).y;
      float st = (sx * bl.x + sz * bl.z) / (bl.x + bl.z);
      rockStreak = 1.0 - 0.32 * smoothstep(0.5, 0.78, st) * smoothstep(0.05, 0.3, bl.x + bl.z) + 0.08 * smoothstep(0.35, 0.1, st);
    }
    vec3 A[4]; vec3 NN[4]; vec2 R[4]; float H[4]; int n = 0; float hm = -10.0;
    for (int i = 0; i < 12; i++) {
      float w = wv[i] / max(wsum, 1e-4);
      if (w < 0.04 || n >= 4) continue;
      vec3 a; vec3 nw; vec2 ra;
      gLayer(i, tp, N, bl, antiW, fadeN, a, nw, ra);
      a *= uGain[i];
      if (i == 4 || i == 10) a *= stTint;
      if (i == 4 || i == 5 || i == 10) a *= rockStreak;
      float h = ra.y * 0.6 + gLum(a) * 0.6;
      A[n] = a; NN[n] = nw; R[n] = ra; H[n] = w + h * 0.3; hm = max(hm, H[n]); n++;
    }
    GS g; g.alb = vec3(0.0); g.n = vec3(0.0); g.rough = 0.0; g.ao = 0.0;
    float ws = 0.0;
    for (int k = 0; k < 4; k++) {
      if (k >= n) break;
      float w = max(H[k] - hm + 0.24, 0.0);
      g.alb += A[k] * w; g.n += NN[k] * w; g.rough += R[k].x * w; g.ao += R[k].y * w; ws += w;
    }
    ws = max(ws, 1e-4); g.alb /= ws; g.rough /= ws; g.ao /= ws;
    g.n = n > 0 ? normalize(g.n) : N;
    // close-up grain (fades out beyond ~20 m where it would only shimmer)
    float dk = 1.0 - smoothstep(3.0, 22.0, dist);
    if (dk > 0.0) { vec2 dn = gTex(uDetailN, tp.xz / 1.2, 1.0 / 1.2).xy * 2.0 - 1.0; g.n = normalize(g.n + vec3(dn.x, 0.0, -dn.y) * 0.35 * dk * bl.y); }
    // large-scale brightness / hue variation (kills the last traces of tiling from far away)
    float mv = gTex(uMacroT, tp.xz / 360.0, 1.0 / 360.0).x, mv2 = gTex(uMacroT, tp.xz / 90.0 + 0.5, 1.0 / 90.0).y;
    g.alb *= (0.84 + 0.3 * mv) * (0.93 + 0.14 * mv2);
    g.alb = mix(g.alb, g.alb * vec3(1.05, 0.98, 0.9), q1.z - 0.5);
    return g;
  }
`;

function groundUniforms(arrays) {
  const r = resolved || arrays;
  return {
    uAlbedo: { value: r.albedo }, uNRA: { value: r.nra }, uMacroT: { value: r.macro }, uDetailN: { value: r.detail },
    uTile: { value: TILE_ARR }, uTri: { value: TRI_ARR }, uGain: { value: GAIN_ARR }, uNormalStrength: { value: 1.0 },
  };
}

/** Shared terrain material. `arrays` from loadGroundArrays(). */
export function makeTerrainMaterial(arrays) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.name = 'terrain';
  const uniforms = groundUniforms(arrays);
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSplat0; attribute vec4 aSplat1; attribute vec4 aSplat2; attribute vec4 aAux;
        varying vec4 vSplat0; varying vec4 vSplat1; varying vec4 vSplat2; varying vec3 vTexPos; varying vec3 vWNrm; varying vec2 vAux;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat0 = aSplat0; vSplat1 = aSplat1; vSplat2 = aSplat2; vAux = aAux.zw;
        vTexPos = vec3(position.x + aAux.x, (modelMatrix * vec4(position, 1.0)).y, position.z + aAux.y);
        vWNrm = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${GROUND_GLSL}
        varying vec4 vSplat0; varying vec4 vSplat1; varying vec4 vSplat2; varying vec3 vTexPos; varying vec3 vWNrm; varying vec2 vAux;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wv[12] = float[12](vSplat0.x, vSplat0.y, vSplat0.z, vSplat0.w, vSplat1.x, vSplat1.y, vSplat1.z, vSplat1.w, vSplat2.x, vSplat2.y, vSplat2.z, vSplat2.w);
        float gDist = length(vViewPosition);
        gDx = dFdx(vTexPos); gDy = dFdy(vTexPos);
        GS gs = groundSample(vTexPos, normalize(vWNrm), wv, gDist, vAux.x);
        // wet band just above the sea / lake
        float shoreWet = 1.0 - smoothstep(0.3, 2.6, vTexPos.y - vAux.y);
        gs.alb *= 1.0 - 0.42 * shoreWet; gs.rough = mix(gs.rough, 0.22, shoreWet);
        diffuseColor.rgb = gs.alb * mix(0.72, 1.0, gs.ao);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(gs.rough, 0.2, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(gs.n, 0.0)).xyz);`);
  };
  return mat;
}

// ------------------------------------------------------------------------------------------------ road
/**
 * Road material. uv = (lateral d m, distance m wrapped by ROAD_WRAP); attributes aRoadA/aRoadB (biome weights, snow, wrap segment),
 * aSplat0..2 + aAux (the terrain's layers at the strip edge). `tex.normal` is only used to switch on three's uv tangent frame.
 * Call setRoadNight(mat, night01) each frame (TerrainStreamer does it) to make cat's eyes + paint glow in the headlights.
 */
export function makeRoadMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, normalMap: tex.normal });
  mat.name = 'road';
  const r = resolved;
  if (!r) console.warn('makeRoadMaterial: call (and await) loadGroundArrays() first');
  const uniforms = { ...groundUniforms(r || {}), uLines: { value: r ? r.lines : null }, uNight: { value: 0 }, uRoadWet: { value: 0 } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aRoadA; attribute vec4 aRoadB; attribute vec4 aSplat0; attribute vec4 aSplat1; attribute vec4 aSplat2; attribute vec4 aAux;
        varying vec2 vRoadUv; varying vec4 vRA; varying vec4 vRB; varying vec4 vSplat0; varying vec4 vSplat1; varying vec4 vSplat2;
        varying vec3 vTexPos; varying vec3 vWNrm; varying vec2 vAux;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRoadUv = uv; vRA = aRoadA; vRB = aRoadB; vSplat0 = aSplat0; vSplat1 = aSplat1; vSplat2 = aSplat2; vAux = aAux.zw;
        vTexPos = vec3(position.x + aAux.x, (modelMatrix * vec4(position, 1.0)).y, position.z + aAux.y);
        vWNrm = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${GROUND_GLSL}
        uniform sampler2DArray uLines; uniform float uNight; uniform float uRoadWet;
        varying vec2 vRoadUv; varying vec4 vRA; varying vec4 vRB; varying vec4 vSplat0; varying vec4 vSplat1; varying vec4 vSplat2;
        varying vec3 vTexPos; varying vec3 vWNrm; varying vec2 vAux;
        float h11(float x) { return fract(sin(x * 127.1 + 1.7) * 43758.5453); }
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // box-filtered coverage of the interval [-h, h] by a pixel of footprint f centred at x (stable at any distance)
        float boxCov(float x, float h, float f) { f = max(f, 1e-4); return clamp((min(x + f * 0.5, h) - max(x - f * 0.5, -h)) / f, 0.0, 1.0); }
        vec3 roadEmit; float roadRough; vec3 roadNts; vec3 vergeNW; float vergeK;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
        vec2 ruv = vRoadUv; float d = ruv.x, s = ruv.y, ad = abs(d), sd = d < 0.0 ? -1.0 : 1.0, seg = vRB.w;
        vec2 gx = dFdx(ruv), gy = dFdy(ruv); vec2 fw = abs(gx) + abs(gy);
        gDx = dFdx(vTexPos); gDy = dFdy(vTexPos);
        float dist = length(vViewPosition);
        float desert = vRA.x, canyon = vRA.y, coast = vRA.z, mountain = vRA.w, city = vRB.x, dam = vRB.y, snow = vRB.z;
        vec4 nA = texture(uMacroT, ruv * vec2(1.0 / 48.0, 1.0 / 96.0));
        vec4 nB = texture(uMacroT, ruv * vec2(1.0 / 12.0, 1.0 / 24.0) + 0.5);
        vec4 nC = texture(uMacroT, ruv * vec2(1.0 / 3.0, 1.0 / 6.0) + 0.25);
        float dusty = clamp(desert + canyon * 0.85 + dam * 0.25, 0.0, 1.0);
        float wet = clamp((coast * 0.35 + mountain * 0.45 + city * 0.6 + dam * 0.25) * smoothstep(0.3, 0.62, nA.w) + uRoadWet, 0.0, 1.0);
        // ---------------- asphalt: worn lane tile (wheel tracks) + broad 45 deg tile + cracked patches
        float laneF = (d + 7.0) / 3.5, laneI = clamp(floor(laneF), 0.0, 3.0), lu = laneF - laneI;
        float vOff = floor(h21(vec2(laneI, seg)) * 7.0) * 0.43;
        vec2 wg1 = vec2(gx.x / 3.5, gx.y / 4.0), wg2 = vec2(gy.x / 3.5, gy.y / 4.0);
        vec3 wuv = vec3(lu, s / 4.0 + vOff, 12.0);
        vec4 aW = textureGrad(uAlbedo, wuv, wg1, wg2), mW = textureGrad(uNRA, wuv, wg1, wg2);
        vec3 buv = vec3(vec2(d - s, d + s) / 16.0, 13.0);
        vec2 bg1 = vec2(gx.x - gx.y, gx.x + gx.y) / 16.0, bg2 = vec2(gy.x - gy.y, gy.x + gy.y) / 16.0;
        vec4 aB = textureGrad(uAlbedo, buv, bg1, bg2), mB = textureGrad(uNRA, buv, bg1, bg2);
        float bw = 0.28 + 0.34 * nB.x;
        vec3 alb = mix(aW.rgb, aB.rgb * 0.95, bw);
        vec2 nW2 = mW.xy * 2.0 - 1.0, nB2 = mB.xy * 2.0 - 1.0;
        vec2 nxy = mix(vec2(nW2.x, -nW2.y), vec2(nB2.x - nB2.y, -nB2.x - nB2.y) * 0.70710678, bw);
        float rough = mix(mW.z, mB.z, bw), ao = mix(mW.w, mB.w, bw);
        float crackedM = smoothstep(0.6, 0.74, nA.z * 0.7 + nB.w * 0.4 + city * 0.18 + dam * 0.1);
        if (crackedM > 0.01) {
          vec3 cuv = vec3(d / 6.0, s / 6.0, 14.0);
          vec4 aC = textureGrad(uAlbedo, cuv, gx / 6.0, gy / 6.0), mC = textureGrad(uNRA, cuv, gx / 6.0, gy / 6.0);
          vec2 nC2 = mC.xy * 2.0 - 1.0;
          alb = mix(alb, aC.rgb * 0.92, crackedM); nxy = mix(nxy, vec2(nC2.x, -nC2.y), crackedM); rough = mix(rough, mC.z, crackedM); ao = mix(ao, mC.w, crackedM);
        }
        // grading: sun-bleached + dusty in the desert, darker and richer where it is damp
        alb *= mix(vec3(1.0), vec3(1.28, 1.2, 1.08), dusty * (0.55 + 0.45 * nA.x));
        alb *= 0.9 + 0.2 * nA.y;
        // oil drips down the middle of each lane
        float cen = 1.0 - smoothstep(0.05, 0.15, abs(lu - 0.5));
        float oil = cen * smoothstep(0.5, 0.78, nC.y) * step(ad, 6.9);
        alb *= 1.0 - 0.5 * oil; rough = mix(rough, 0.32, oil * 0.7);
        // repair patches (fresh darker asphalt with a tar-sealed rim)
        float pc = floor(s / 24.0), hp = h21(vec2(pc * 1.31 + laneI * 7.7, seg));
        if (hp < 0.09 && ad < 7.0) {
          float ps = pc * 24.0 + 2.0 + h21(vec2(pc, laneI + 7.0)) * 6.0, pl = 3.0 + h21(vec2(pc, laneI + 3.0)) * 13.0;
          float u0 = 0.05 + 0.3 * h21(vec2(pc, laneI + 11.0)), u1 = 0.95 - 0.3 * h21(vec2(pc, laneI + 13.0));
          float cs = s - (ps + pl * 0.5), cu = (lu - (u0 + u1) * 0.5) * 3.5, hu = (u1 - u0) * 1.75;
          float inner = boxCov(cs, pl * 0.5 - 0.03, fw.y) * boxCov(cu, hu - 0.03, fw.x);
          float outer = boxCov(cs, pl * 0.5 + 0.035, fw.y) * boxCov(cu, hu + 0.035, fw.x);
          alb = mix(alb, alb * vec3(0.8, 0.8, 0.82), inner); rough = mix(rough, rough * 0.92, inner); nxy *= 1.0 - 0.35 * inner;
          alb = mix(alb, alb * 0.45, (outer - inner) * 0.7);
        }
        // ---------------- tar-sealed cracks: transverse, along the lane joints, and meandering "tar snakes"
        float tar = 0.0;
        for (int k = -1; k <= 1; k++) {
          float ci = floor(s / 7.0) + float(k), hc = h21(vec2(ci, seg + 3.1));
          if (hc < 0.42) {
            float sc = ci * 7.0 + 1.0 + h11(ci + seg * 13.0) * 5.0;
            float wig = (textureLod(uMacroT, vec2(d / 9.0, hc * 7.3), 0.0).y - 0.5) * 1.3 + d * (h11(ci * 3.1) - 0.5) * 0.14;
            float span = step(abs(d - (h11(ci * 1.7) - 0.5) * 10.0), 2.5 + h11(ci * 2.3) * 7.0);
            tar = max(tar, boxCov(s - sc - wig, 0.018 + 0.02 * h11(ci * 5.9), fw.y + fw.x * 0.15) * span);
          }
        }
        {
          float kj = clamp(floor(d / 3.5 + 0.5), -1.0, 1.0);
          float jc = kj * 3.5 + 0.3 * sd + (nB.y - 0.5) * 0.5;
          tar = max(tar, boxCov(d - jc, 0.02, fw.x + fw.y * 0.05) * smoothstep(0.55, 0.62, nA.x) * step(ad, 6.5));
          float sn = texture(uMacroT, ruv * vec2(1.0 / 12.0, 1.0 / 24.0) + vec2(0.13, 0.71)).y;
          float fn = fwidth(sn);
          tar = max(tar, (1.0 - smoothstep(0.003, 0.003 + fn * 1.5, abs(sn - 0.5))) * smoothstep(0.64, 0.7, nA.y) * step(ad, 7.0) * 0.8);
        }
        alb = mix(alb, vec3(0.03, 0.029, 0.027), tar * 0.85); rough = mix(rough, 0.5, tar); nxy *= 1.0 - 0.8 * tar;
        // ---------------- tyre marks (swerves / skids)
        float skid = 0.0;
        float streakN = texture(uMacroT, vec2(d * 2.0, s / 12.0)).z;
        for (int k = -1; k <= 0; k++) {
          float ci = floor(s / 60.0) + float(k), hs = h21(vec2(ci, seg + 11.7));
          if (hs < 0.38) {
            float s0 = ci * 60.0 + h11(ci * 1.3 + seg) * 30.0, len = 14.0 + h11(ci * 2.1 + seg) * 38.0, t = (s - s0) / len;
            if (t > 0.0 && t < 1.0) {
              float dc = (h11(ci * 3.7 + seg) - 0.5) * 9.0 + (h11(ci * 5.1 + seg) - 0.5) * 6.0 * t * t;
              float m = boxCov(d - dc - 0.82, 0.11, fw.x) + boxCov(d - dc + 0.82, 0.11, fw.x);
              float streak = 0.55 + 0.45 * streakN;
              skid = max(skid, m * smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.55, 1.0, t)) * streak * (0.45 + 0.9 * hs));
            }
          }
        }
        alb *= 1.0 - 0.62 * clamp(skid, 0.0, 1.0); rough = mix(rough, 0.55, skid);
        // ---------------- paint (worn line atlas): 3 m dashes / 9 m gaps, yellow left (median) edge, white right edge
        float wob = (texture(uMacroT, vec2(0.13, s / 96.0)).x - 0.5) * 0.07;
        float dl = d - wob;
        float paintA = 0.0, paintL = 0.8; vec3 paintTint = vec3(0.86, 0.86, 0.82);
        float kl = clamp(floor(dl / 3.5 + 0.5), -1.0, 1.0), lx = dl - kl * 3.5;
        vec2 lg1 = vec2(gx.x / 0.5, gx.y / 6.0), lg2 = vec2(gy.x / 0.5, gy.y / 6.0);
        if (abs(lx) < 0.25) {
          float cell = floor(s / 12.0), ls = s - cell * 12.0;
          float var = floor(h21(vec2(cell, kl + seg * 3.0)) * 2.999);
          vec4 t = textureGrad(uLines, vec3(lx / 0.5 + 0.5, ls / 6.0, 4.0 + var), lg1, lg2);
          paintA = t.y * step(ls, 5.9); paintL = t.x;
        }
        float ex = abs(dl) - 6.62;
        if (abs(ex) < 0.25) {
          float cell = floor(s / 6.0), he = h21(vec2(cell, sd + seg * 5.0));
          float var = nA.y < 0.3 && he < 0.5 ? 3.0 : floor(he * 2.999);
          vec4 t = textureGrad(uLines, vec3(ex / 0.5 + 0.5, s / 6.0, var), vec2(sd * gx.x / 0.5, gx.y / 6.0), vec2(sd * gy.x / 0.5, gy.y / 6.0));
          paintA = t.y; paintL = t.x;
          if (d > 0.0) paintTint = vec3(0.9, 0.6, 0.1);
        }
        paintA *= mix(0.55, 1.0, smoothstep(0.25, 0.6, nB.z)) * (1.0 - 0.28 * dusty) * (1.0 - 0.6 * tar);
        alb = mix(alb, paintTint * (0.7 + 0.35 * paintL), paintA);
        rough = mix(rough, 0.5, paintA); nxy *= 1.0 - 0.6 * paintA; ao = mix(ao, 1.0, paintA);
        // ---------------- cat's eyes (raised reflective markers): in the lane-line gaps, amber along the median edge
        float eye = 0.0; vec3 eyeCol = vec3(1.0, 0.96, 0.88);
        if (ad < 5.5) { float ce = mod(s - 7.6 + 6.0, 12.0) - 6.0; eye = boxCov(lx, 0.06, fw.x) * boxCov(ce, 0.05, fw.y); }
        else {
          float ce2 = mod(s - 1.6 + 12.0, 24.0) - 12.0; float e2 = boxCov(abs(dl) - 6.92, 0.06, fw.x) * boxCov(ce2, 0.05, fw.y);
          if (e2 > eye) { eye = e2; eyeCol = d > 0.0 ? vec3(1.0, 0.52, 0.06) : vec3(1.0, 0.96, 0.88); }
        }
        alb = mix(alb, eyeCol * 0.55, eye); rough = mix(rough, 0.18, eye);
        float nightK = uNight * (1.0 - smoothstep(90.0, 420.0, dist));
        roadEmit = eyeCol * min(eye * 40.0, 2.6) * nightK + paintTint * paintA * 0.06 * nightK * (1.0 - smoothstep(10.0, 80.0, dist));
        // ---------------- dust / sand drifting onto the road (desert, canyon), grit along the edges everywhere
        vec3 sandA = texture(uAlbedo, vec3(vec2(vTexPos.x, -vTexPos.z) / 6.0, dusty > 0.5 && desert < canyon ? 1.0 : 0.0)).rgb;
        float drift = (ad - 5.3) / 1.9 + (nB.y - 0.5) * 1.3 + (texture(uMacroT, vec2((d + s * 0.5) / 6.0, (s - d * 0.25) / 48.0)).x - 0.5) * 1.6;
        float sandM = smoothstep(0.35, 0.75, drift) * (desert + canyon * 0.7);
        float grit = (1.0 - smoothstep(6.3, 7.1, ad)) * smoothstep(6.3, 6.9, ad) * 0.35 + smoothstep(0.62, 0.8, nC.x) * 0.25 * (1.0 - smoothstep(6.0, 7.0, ad));
        alb = mix(alb, sandA * 0.95, sandM); rough = mix(rough, 0.92, sandM); nxy *= 1.0 - 0.6 * sandM;
        alb = mix(alb, alb * vec3(1.18, 1.1, 0.98), grit * (0.4 + dusty));
        // ---------------- wet: damp stretches, puddles in dips and ruts
        float pf = nC.w * 0.5 + nB.z * 0.5 + (1.0 - smoothstep(0.1, 0.2, abs(abs(lu - 0.5) - 0.24))) * 0.08 + smoothstep(6.0, 7.1, ad) * 0.07;
        float pth = 0.9 - 0.08 * wet;
        float pud = smoothstep(pth, pth + 0.05, pf) * smoothstep(0.3, 0.5, wet) * (1.0 - sandM);
        float damp = wet * (0.6 + 0.4 * smoothstep(pth - 0.2, pth, pf));
        alb *= 1.0 - 0.35 * damp; rough = mix(rough, 0.42, damp * 0.7);
        alb = mix(alb, alb * 0.55, pud); rough = mix(rough, 0.12, pud); nxy *= 1.0 - 0.9 * pud;
        // ---------------- verge: ragged asphalt edge, then the terrain's own splat (gravel shoulder -> biome ground)
        float edgeJ = (nC.x - 0.5) * 0.32 + (nB.y - 0.5) * 0.26;
        float asphEnd = 7.1 + edgeJ;
        float onA = 1.0 - smoothstep(asphEnd - fw.x, asphEnd + fw.x, ad);
        vec3 vAlb = vec3(0.0); float vRough = 0.9; vec3 vN = vec3(0.0, 1.0, 0.0);
        vergeK = 1.0 - onA;
        if (vergeK > 0.001) {
          float wv[12] = float[12](vSplat0.x, vSplat0.y, vSplat0.z, vSplat0.w, vSplat1.x, vSplat1.y, vSplat1.z, vSplat1.w, vSplat2.x, vSplat2.y, vSplat2.z, vSplat2.w);
          GS g = groundSample(vTexPos, normalize(vWNrm), wv, dist, 0.0);
          vAlb = g.alb * mix(0.72, 1.0, g.ao); vRough = g.rough; vN = g.n;
          // tyre-packed dirt band right at the asphalt edge
          float band = 1.0 - smoothstep(0.0, 0.7, ad - asphEnd);
          vAlb *= 1.0 - 0.18 * band * (0.5 + 0.5 * nC.z);
          // snow banks on the high mountain passes
          float snowM = snow * smoothstep(7.15, 7.7, ad) * (1.0 - smoothstep(8.7, 9.45, ad)) * smoothstep(0.5, 0.62, nB.x * 0.7 + nC.z * 0.3);
          vec3 snA = textureGrad(uAlbedo, vec3(vec2(vTexPos.x, -vTexPos.z) / 6.0, 6.0), vec2(gDx.x, -gDx.z) / 6.0, vec2(gDy.x, -gDy.z) / 6.0).rgb;
          snA *= mix(vec3(0.72, 0.7, 0.66), vec3(1.0), smoothstep(0.55, 0.8, nB.x + (ad - 8.0) * 0.2));   // grimy near the asphalt
          vAlb = mix(vAlb, snA, snowM); vRough = mix(vRough, 0.75, snowM); vN = normalize(mix(vN, normalize(vWNrm), snowM * 0.7));
        }
        // city / dam: concrete kerb + sidewalk slabs instead of a gravel shoulder
        float kerbK = city;
        if (kerbK > 0.01 && ad > 6.75) {
          vec3 cA = textureGrad(uAlbedo, vec3(vec2(d, s) / 2.5, 9.0), gx / 2.5, gy / 2.5).rgb;
          float gutter = boxCov(ad - 6.88, 0.12, fw.x);
          float kFace = boxCov(ad - 7.03, 0.03, fw.x), kTop = boxCov(ad - 7.17, 0.11, fw.x);
          float walk = clamp((ad - 7.28) / max(fw.x, 1e-4) + 0.5, 0.0, 1.0);
          float joint = max(boxCov(mod(s + 0.9, 1.8) - 0.9, 0.012, fw.y), boxCov(ad - 8.55, 0.012, fw.x));
          vec3 kc = cA * vec3(0.95, 0.93, 0.9);
          vec3 kerbAlb = alb;
          kerbAlb = mix(kerbAlb, alb * 0.7 + vec3(0.02, 0.018, 0.015), gutter);
          kerbAlb = mix(kerbAlb, kc * 0.55, kFace); kerbAlb = mix(kerbAlb, kc * 1.1, kTop);
          kerbAlb = mix(kerbAlb, kc * (0.85 + 0.2 * nB.x) * (1.0 - 0.55 * joint * walk), walk);
          float kk = kerbK * smoothstep(6.75, 6.8, ad);
          alb = mix(alb, kerbAlb, kk); vAlb = mix(vAlb, kerbAlb, kk * step(asphEnd, ad));
          vRough = mix(vRough, 0.9, kk); rough = mix(rough, mix(rough, 0.9, kTop + walk), kk);
          onA = mix(onA, 1.0, kk);  vergeK = mix(vergeK, 0.0, kk);
          nxy = mix(nxy, vec2(-sd * 0.9 * kFace, 0.0), kk * kFace);
        }
        // crumbled asphalt lip
        float lip = boxCov(ad - asphEnd + 0.06, 0.07, fw.x) * (1.0 - kerbK);
        alb *= 1.0 - 0.3 * lip;
        diffuseColor.rgb = mix(alb * mix(0.7, 1.0, ao), vAlb, vergeK);
        roadRough = mix(rough, vRough, vergeK);
        // detail grain close to the camera
        float dk = 1.0 - smoothstep(3.0, 18.0, dist);
        if (dk > 0.0) { vec2 dn = textureGrad(uDetailN, ruv / 0.8, gx / 0.8, gy / 0.8).xy * 2.0 - 1.0; nxy += vec2(dn.x, -dn.y) * 0.45 * dk * (1.0 - pud); }
        nxy *= uNormalStrength * (1.0 - 0.7 * smoothstep(60.0, 300.0, dist));
        roadNts = vec3(nxy, sqrt(max(0.05, 1.0 - dot(nxy, nxy))));
        vergeNW = vN;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roadRough, 0.03, 1.0);`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 nr = normalize(tbn * roadNts);
          vec3 nv = normalize((viewMatrix * vec4(vergeNW, 0.0)).xyz);
          normal = normalize(mix(nr, nv, vergeK));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += roadEmit;`);
  };
  mat.customProgramCacheKey = () => 'road-v2';
  return mat;
}

/** Throw-away meshes that use the terrain, road and ground-cover programs with the same flags as in play (add them to Game.prewarm's
 *  group so these big shaders compile before the run instead of on the first streamed chunk). */
export function groundPrewarmMeshes(terrainMat, roadMat) {
  const out = [];
  const add = (mat) => { if (!mat) return; const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat); m.receiveShadow = true; m.castShadow = true; out.push(m); };
  add(terrainMat); add(roadMat);
  for (const m of coverPrewarmMeshes()) out.push(m);
  return out;
}

/** Per-frame road uniforms (night makes cat's eyes / paint retro-reflect; wet = extra global wetness 0..1). */
export function setRoadNight(mat, night, wet = 0) {
  const u = mat && mat.userData.uniforms; if (!u || !u.uNight) return;
  u.uNight.value = night; u.uRoadWet.value = wet;
}

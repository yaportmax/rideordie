// Shared materials for the procedural city (and other procedural set pieces):
//  - facadeMaterial(): ONE MeshStandardMaterial for every procedural building. Window grids, storefronts, lit / broken / burning
//    windows, grime and floor lines are computed in the fragment shader from per-vertex facade data (aUvF metres, aFac, aFac2),
//    so a whole chunk of buildings is one draw call and one shader program.
//  - neonMaterial(): runtime-painted neon sign atlas (emissive, per-sign flicker), one program.
//  - flameMaterial() / smokeMaterial(): cheap animated fire barrels + smoke columns.
// Night strength / time come from CITY_U (written by Dressing.update).
import * as THREE from 'three';

export const CITY_U = { uNight: { value: 0 }, uTime: { value: 0 } };

/** Facade styles (aFac.x). */
export const ST = { PLAIN: 0, PUNCHED: 1, RIBBON: 2, CURTAIN: 3, BRICK: 4, INDUSTRIAL: 5, PAVING: 6, ASPHALT: 7, CONCRETE: 8, DAM: 9 };

const HASH = /* glsl */`
  float cH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float cN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cH(i), cH(i + vec2(1.0, 0.0)), f.x), mix(cH(i + vec2(0.0, 1.0)), cH(i + vec2(1.0, 1.0)), f.x), f.y); }
  float cBox(vec2 p, vec2 lo, vec2 hi, vec2 w) { vec2 a = smoothstep(lo - w, lo + w, p) * (1.0 - smoothstep(hi - w, hi + w, p)); return a.x * a.y; }`;

let _facade = null;
/**
 * aUvF = facade coordinates in metres (u along the wall, v above the building base).
 * aFac = (style, bay width m, floor height m, seed 0..1); aFac2 = (lit fraction 0..1, storefront band height m (0 = none), damage 0..1, burning-from floor (0 = none)).
 */
export function facadeMaterial() {
  if (_facade) return _facade;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0, emissive: 0x000000 });
  m.name = 'city_facade';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = CITY_U.uNight; sh.uniforms.uTime = CITY_U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aUvF; attribute vec4 aFac; attribute vec4 aFac2;
        varying vec2 vUvF; varying vec4 vFac; varying vec4 vFac2; varying vec3 vWp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vUvF = aUvF; vFac = aFac; vFac2 = aFac2; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform float uTime;
        varying vec2 vUvF; varying vec4 vFac; varying vec4 vFac2; varying vec3 vWp;
        ${HASH}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 fEmis = vec3(0.0); float fGlass = 0.0;
        {
          int st = int(vFac.x + 0.5);
          vec2 f = vUvF;
          float bseed = vFac.w * 173.0;
          if (st >= 1 && st <= 5) {
            float bay = vFac.y, flh = vFac.z, litF = vFac2.x, gh = vFac2.y, dmg = vFac2.z, fire = vFac2.w;
            bool shop = gh > 0.0 && f.y < gh;
            vec2 cell = shop ? vec2(f.x / (bay * 1.7), f.y / gh) : vec2(f.x / bay, (f.y - gh) / flh);
            vec2 id = floor(cell), lc = fract(cell);
            vec2 fw = fwidth(cell);
            float far = smoothstep(0.3, 0.85, max(fw.x, fw.y));
            vec2 lo = vec2(0.28, 0.3), hi = vec2(0.72, 0.84);
            if (shop) { lo = vec2(0.07, 0.05); hi = vec2(0.93, 0.74); }
            else if (st == 2) { lo = vec2(0.015, 0.38); hi = vec2(0.985, 0.86); }
            else if (st == 3) { lo = vec2(0.05, 0.07); hi = vec2(0.95, 0.95); }
            else if (st == 4) { lo = vec2(0.33, 0.2); hi = vec2(0.67, 0.84); }
            else if (st == 5) { lo = vec2(0.08, 0.64); hi = vec2(0.92, 0.88); }
            vec2 w = max(fw * 0.8, vec2(0.004));
            float win = cBox(lc, lo, hi, w);
            float frame = cBox(lc, lo - vec2(0.045, 0.04), hi + vec2(0.045, 0.04), w) - win;
            float cover = (hi.x - lo.x) * (hi.y - lo.y);
            win = mix(win, cover, far); frame *= 1.0 - far;
            float r = cH(id + vec2(bseed, bseed * 0.37));
            float rFloor = cH(vec2(id.y * 1.13 + bseed * 0.71, bseed));
            float broken = step(1.0 - dmg * 0.85, cH(id * 1.31 + bseed + 7.7));
            if (shop) broken *= 0.5;
            float lit = step(r, litF * (0.25 + 1.5 * rFloor * rFloor)) * (1.0 - broken);
            // wall: grime streaks, darker base, floor slab lines
            float streak = cN(vec2(f.x * 0.8 + bseed, f.y * 0.055 + bseed)) * 0.7 + cN(vec2(f.x * 3.1, f.y * 0.2 + bseed)) * 0.3;
            float grime = 0.7 + 0.45 * streak;
            grime *= 0.72 + 0.28 * smoothstep(0.0, 4.0, f.y);
            grime *= 0.9 + 0.2 * cH(vec2(id.y + bseed, 3.0));                                   // floor-to-floor patching
            // dirty run-off streaks under every window
            float under = cBox(lc, vec2(lo.x + 0.04, lo.y - 0.42), vec2(hi.x - 0.04, lo.y), w) * cN(vec2(f.x * 7.0, f.y * 0.9 + bseed)) * (1.0 - far);
            grime *= 1.0 - 0.32 * under;
            float slab = shop ? 1.0 : 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.06 + fw.y, lc.y)) * (1.0 - far);
            vec3 wall = diffuseColor.rgb * grime * slab * (1.0 - 0.45 * frame);
            // burnt scorch above broken / burning windows
            float scorch = broken * smoothstep(hi.y, hi.y + 0.25, lc.y) * (1.0 - smoothstep(hi.y + 0.25, 1.0, lc.y));
            wall *= 1.0 - 0.55 * scorch * (1.0 - far);
            // glass: dark, a little sky reflection toward the top of the pane, some panes boarded up with plywood
            vec2 wl = (lc - lo) / max(hi - lo, vec2(1e-3));
            vec3 glass = mix(vec3(0.035, 0.045, 0.06), vec3(0.08, 0.1, 0.115), r) * (0.75 + 0.5 * smoothstep(0.2, 1.0, wl.y + 0.3 * wl.x));
            if (st == 3 && !shop) glass = mix(vec3(0.05, 0.075, 0.095), vec3(0.1, 0.13, 0.15), r) * (0.8 + 0.4 * wl.y);
            glass = mix(glass, vec3(0.012, 0.01, 0.01), broken);
            float board = (1.0 - broken) * (1.0 - lit) * step(0.9, cH(id * 2.7 + bseed + 1.3)) * (shop ? 0.0 : 1.0) * (st == 3 ? 0.0 : 1.0);
            glass = mix(glass, vec3(0.3, 0.22, 0.14) * (0.75 + 0.35 * step(0.5, fract(wl.x * 4.0 + r))), board);
            if (shop) glass = mix(glass, vec3(0.16, 0.15, 0.14) * (0.6 + 0.4 * step(0.5, fract(lc.y * 14.0))), step(0.55, cH(id + bseed + 2.0)) * (1.0 - lit));  // rolled-down shutters
            // sill under punched windows
            float sill = (st == 1 || st == 4) && !shop ? cBox(lc, vec2(lo.x - 0.04, lo.y - 0.07), vec2(hi.x + 0.04, lo.y - 0.01), w) * (1.0 - far) : 0.0;
            wall = mix(wall, wall * 1.35 + 0.02, sill);
            diffuseColor.rgb = mix(wall, glass, win);
            fGlass = win * (1.0 - broken) * (1.0 - board);
            // lit windows: mostly warm (fires, lamps, generators), some neutral, a few fluorescent / TV blue; room gradient + curtains
            float hu = cH(id * 0.77 + bseed + 3.1);
            vec3 lcol = hu < 0.55 ? vec3(1.0, 0.46, 0.16) : hu < 0.82 ? vec3(1.0, 0.7, 0.4) : hu < 0.94 ? vec3(0.6, 0.78, 1.0) : vec3(0.3, 0.45, 1.0);
            float inten = 0.22 + 0.55 * cH(id + 9.1);
            float inner = mix(0.35, 1.0, smoothstep(0.0, 0.75, wl.y)) * (0.8 + 0.2 * sin(wl.x * 3.14159));
            float curt = step(0.55, cH(id + 4.4));
            float curtain = mix(1.0, mix(0.25, 1.0, smoothstep(0.18, 0.3, abs(wl.x - 0.5))) * (0.8 + 0.2 * cN(vec2(wl.x * 14.0 + r * 20.0, 1.0))), curt);
            float tv = hu > 0.94 ? 0.6 + 0.4 * sin(uTime * 7.0 + r * 50.0) * sin(uTime * 2.3 + r * 13.0) : 1.0;
            vec3 e = lcol * inten * inner * curtain * tv * lit * win;
            if (shop) e *= 1.6;
            fEmis = e * uNight * (1.0 - 0.3 * far);
            // burning floors (from floor index 'fire' upward): flickering orange, scorched wall, glows day and night
            if (fire > 0.0 && !shop && id.y >= fire - 1.0) {
              float fl = 0.55 + 0.45 * sin(uTime * 8.0 + r * 31.0) * sin(uTime * 3.1 + r * 17.0 + id.x);
              float body = cBox(lc, vec2(0.1, 0.05), vec2(0.9, 0.95), w) * (1.25 - 0.8 * lc.y) * (0.7 + 0.3 * cN(vec2(lc.x * 6.0 + uTime * 0.7, lc.y * 3.0 - uTime * 1.3 + r * 9.0)));
              float burning = step(0.42, cH(id + 5.5));
              vec3 fcol = mix(vec3(1.0, 0.22, 0.03), vec3(1.0, 0.5, 0.12), cH(id + 6.6));
              fEmis += fcol * (0.55 + 1.0 * fl) * mix(body, 0.45, far) * burning;
              diffuseColor.rgb *= mix(0.45, 0.25, burning);
            }
          } else if (st == 6) {
            // paving slabs: 1.5 m joints + cracks
            vec2 c2 = f / 1.5; vec2 lc2 = fract(c2); vec2 fw2 = fwidth(c2);
            float j = 1.0 - cBox(lc2, vec2(0.03), vec2(0.97), max(fw2, vec2(0.01)));
            diffuseColor.rgb *= (0.86 + 0.2 * cH(floor(c2) + bseed)) * (1.0 - 0.35 * j * (1.0 - smoothstep(0.2, 0.6, max(fw2.x, fw2.y))));
          } else if (st == 7) {
            // asphalt: patches, a faded centre line (u = across the street, v = along)
            float n = cN(f * 0.35 + bseed) * 0.6 + cN(f * 2.1) * 0.4;
            diffuseColor.rgb *= 0.75 + 0.4 * n;
            float line = cBox(vec2(abs(f.x), fract(f.y / 6.0)), vec2(-1.0, 0.0), vec2(0.08, 0.5), vec2(fwidth(f.x), 0.02));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.5, 0.35), line * 0.6);
          } else if (st == 9) {
            // dam concrete: lift lines (2.4 m), block joints (18 m), calcite + rust streaks, damp dark base (aFac.y = waterline height in v)
            vec2 c2 = vec2(f.x / 18.0, f.y / 2.4); vec2 fw2 = fwidth(c2);
            float farK = smoothstep(0.25, 0.7, max(fw2.x, fw2.y * 0.3));
            float joint = (1.0 - cBox(fract(c2), vec2(0.012, -1.0), vec2(0.988, 2.0), max(fw2, vec2(0.002)))) * (1.0 - smoothstep(0.1, 0.5, fw2.x));
            float lift = (1.0 - cBox(fract(c2), vec2(-1.0, 0.04), vec2(2.0, 0.96), max(fw2, vec2(0.002)))) * (1.0 - farK);
            float blockTone = 0.9 + 0.18 * cH(floor(c2) + bseed);
            float calc = smoothstep(0.62, 0.9, cN(vec2(f.x * 0.9, f.y * 0.018 + bseed))) * smoothstep(0.4, 0.9, cN(vec2(f.x * 0.2, 1.3)));
            float rust = smoothstep(0.7, 0.95, cN(vec2(f.x * 1.7 + 3.0, f.y * 0.03))) * 0.6;
            float damp = 1.0 - smoothstep(vFac.y, vFac.y + 14.0, f.y);
            vec3 c = diffuseColor.rgb * blockTone * (1.0 - 0.22 * joint - 0.12 * lift);
            c = mix(c, vec3(0.75, 0.74, 0.7) * 0.9, calc * 0.45);
            c = mix(c, c * vec3(0.72, 0.5, 0.36), rust);
            c *= 1.0 - 0.45 * damp;
            c = mix(c, vec3(0.16, 0.2, 0.13), damp * smoothstep(0.45, 0.8, cN(vec2(f.x * 0.6, f.y * 0.4))) * 0.6);
            diffuseColor.rgb = c;
          } else {
            // plain concrete / roofs / rubble: world-space grime
            float n = cN(vWp.xz * 0.25 + vWp.y * 0.1) * 0.6 + cN(vWp.xz * 1.3 + vWp.y) * 0.4;
            diffuseColor.rgb *= 0.78 + 0.34 * n;
          }
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.3, fGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += fEmis;`);
  };
  m.customProgramCacheKey = () => 'city_facade_v1';
  _facade = m;
  return m;
}

// ------------------------------------------------------------------------------------------------ neon signs
/** Neon atlas layout: 2048 x 1024. Left half: 16 horizontal signs (512 x 128). Right half: 16 vertical signs (128 x 480) + a row of
 *  solid glow dots (64 x 64 at y 960: red, white, amber, cyan, green, pink, blue, yellow; the last 8 cells are dark board). */
export const NEON_H = 16, NEON_V = 16;
const H_SIGNS = [
  ['HOTEL', '#ff3a6a'], ['OPEN 24H', '#39f5ff'], ['LIQUOR', '#ffd23a'], ['PAWN SHOP', '#6aff5a'], ['NOODLES', '#ff7a1a'], ['BAR & GRILL', '#ff3ad6'],
  ['GARAGE', '#3a8cff'], ['PHARMACY', '#3aff9a'], ['ARCADE', '#c04aff'], ['CASINO', '#ffcf3a'], ['DINER', '#ff4a3a'], ['GUNS & AMMO', '#ff5a2a'],
  ['KARAOKE', '#ff4ad2'], ['LAST STOP', '#4affea'], ['RIDE OR DIE', '#ff2a3a'], ['PIZZA', '#ffa02a'],
];
const V_SIGNS = [
  ['HOTEL', '#ff3a6a'], ['BAR', '#39f5ff'], ['CLUB', '#ff3ad6'], ['EAT', '#ffd23a'], ['MOTEL', '#6aff5a'], ['BOOKS', '#3a8cff'], ['DRUGS', '#3aff9a'], ['ROOMS', '#ff7a1a'],
  ['CAFE', '#ffcf3a'], ['TATTOO', '#c04aff'], ['SUSHI', '#ff4a3a'], ['DANCE', '#4affea'], ['JAZZ', '#ff5aa0'], ['LOANS', '#9aff3a'], ['BINGO', '#ffa02a'], ['24H', '#39f5ff'],
];

function neonStroke(g, draw, color) {
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
  g.shadowColor = color; g.shadowBlur = 16; g.strokeStyle = color; g.lineWidth = 6; g.globalAlpha = 0.35; draw();
  g.globalAlpha = 1; g.shadowBlur = 5; g.lineWidth = 3.6; draw();
  // hot core: the tube colour pushed toward white
  const c = color.replace('#', ''), mixW = (i) => Math.round(parseInt(c.slice(i, i + 2), 16) * 0.45 + 255 * 0.55).toString(16).padStart(2, '0');
  g.shadowBlur = 0; g.strokeStyle = `#${mixW(0)}${mixW(2)}${mixW(4)}`; g.lineWidth = 1.5; draw();
  g.restore();
}

let _neonTex = null;
export function neonTexture() {
  if (_neonTex) return _neonTex;
  const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#050407'; g.fillRect(0, 0, 2048, 1024);
  const board = (x, y, w, h) => {
    const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, '#15141a'); gr.addColorStop(1, '#08080b');
    g.fillStyle = gr; g.fillRect(x + 4, y + 4, w - 8, h - 8);
    g.strokeStyle = '#2a2830'; g.lineWidth = 4; g.strokeRect(x + 6, y + 6, w - 12, h - 12);
  };
  H_SIGNS.forEach(([t, col], i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 128;
    board(x, y, 512, 128);
    let size = 84; g.font = `900 ${size}px "Arial Black", Impact, "Segoe UI", sans-serif`;
    while (g.measureText(t).width > 430 && size > 30) { size -= 4; g.font = `900 ${size}px "Arial Black", Impact, "Segoe UI", sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    neonStroke(g, () => g.strokeText(t, x + 256, y + 66), col);
    if (i % 3 === 0) neonStroke(g, () => { g.beginPath(); g.roundRect(x + 18, y + 16, 476, 96, 18); g.stroke(); }, col);
  });
  V_SIGNS.forEach(([t, col], i) => {
    const x = 1024 + (i % 8) * 128, y = Math.floor(i / 8) * 480;
    board(x, y, 128, 480);
    const n = t.length, step = Math.min(90, 410 / n);
    g.font = `900 ${Math.round(step * 0.86)}px "Arial Black", Impact, "Segoe UI", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const y0 = y + 240 - (n - 1) * step / 2;
    neonStroke(g, () => { for (let k = 0; k < n; k++) g.strokeText(t[k], x + 64, y0 + k * step); }, col);
    neonStroke(g, () => { g.beginPath(); g.roundRect(x + 14, y + 16, 100, 448, 14); g.stroke(); }, col);
  });
  DOTS.forEach((c, i) => { g.fillStyle = c; g.fillRect(1024 + i * 64 + 4, 964, 56, 56); });
  g.fillStyle = '#0c0b0f'; g.fillRect(1024 + 8 * 64, 960, 512, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  _neonTex = t;
  return t;
}
/** uv rect [u0, v0, u1, v1] of a sign (kind 'h' | 'v', index). Canvas y grows down, texture v grows up (flipY). */
export function neonRect(kind, i) {
  if (kind === 'h') { const x = (i % 2) * 512, y = Math.floor(i / 2) * 128; return [x / 2048, 1 - (y + 128) / 1024, (x + 512) / 2048, 1 - y / 1024]; }
  const x = 1024 + (i % 8) * 128, y = Math.floor(i / 8) * 480; return [x / 2048, 1 - (y + 480) / 1024, (x + 128) / 2048, 1 - y / 1024];
}
const DOTS = ['#ff2412', '#fff4e2', '#ffaa36', '#3aeeff', '#3aff66', '#ff46cc', '#3a78ff', '#ffe23a'];
/** uv rect of a solid glow dot (0 red, 1 white, 2 amber, 3 cyan, 4 green, 5 pink, 6 blue, 7 yellow; 8+ = dark board). */
export function NEON_DOT(i) {
  const x = 1024 + i * 64 + 16, y = 976; return [x / 2048, 1 - (y + 32) / 1024, (x + 32) / 2048, 1 - y / 1024];
}

let _neon = null;
/** Neon sign material: aFac.x = flicker phase, aFac.y = flicker mode (0 steady, 1 buzzing, 2 dying), aFac.z = brightness. */
export function neonMaterial() {
  if (_neon) return _neon;
  const t = neonTexture();
  const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.5, metalness: 0.1 });
  m.name = 'city_neon';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = CITY_U.uNight; sh.uniforms.uTime = CITY_U.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aFac; varying vec4 vNeo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNeo = aFac;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uNight; uniform float uTime; varying vec4 vNeo;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float ph = vNeo.x * 37.0, md = vNeo.y, k = 1.0;
          if (md > 0.5 && md < 1.5) k = 0.82 + 0.18 * sin(uTime * 55.0 + ph) * step(0.2, fract(uTime * 0.37 + ph));
          else if (md > 1.5 && md < 2.5) { float q = fract(uTime * 0.23 + ph); k = step(0.18, q) * (step(q, 0.6) + step(0.72, q) * step(q, 0.78)) * (0.7 + 0.3 * sin(uTime * 80.0)); }
          else if (md > 2.5) k = 0.08 + 0.92 * step(0.55, fract(uTime * 0.75 + ph));
          totalEmissiveRadiance *= (0.08 + 1.7 * uNight) * vNeo.z * k;
        }`);
  };
  m.customProgramCacheKey = () => 'city_neon_v1';
  _neon = m;
  return m;
}

// ------------------------------------------------------------------------------------------------ fire + smoke
let _flame = null;
/** Additive animated flame on crossed quads: uv.y 0 = base .. 1 = tip; aFac.x = phase. */
export function flameMaterial() {
  if (_flame) return _flame;
  const m = new THREE.ShaderMaterial({
    name: 'city_flame', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: CITY_U.uTime }]),
    vertexShader: /* glsl */`
      attribute vec4 aFac; varying vec2 vUv; varying float vPh;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vPh = aFac.x; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec2 vUv; varying float vPh;
      #include <fog_pars_fragment>
      ${HASH}
      void main() {
        vec2 p = vUv; float t = uTime * 2.2 + vPh * 11.0;
        float n = cN(vec2(p.x * 5.0 + vPh * 7.0, p.y * 3.0 - t * 1.7)) * 0.65 + cN(vec2(p.x * 11.0, p.y * 7.0 - t * 2.9)) * 0.35;
        float w = 0.5 - abs(p.x - 0.5);
        float shape = smoothstep(0.0, 0.32, w * (1.25 - p.y) + (n - 0.5) * 0.28) * (1.0 - smoothstep(0.55, 1.0, p.y + (n - 0.5) * 0.3));
        vec3 col = mix(vec3(1.0, 0.32, 0.05), vec3(1.0, 0.85, 0.45), smoothstep(0.35, 0.85, shape * (1.2 - p.y)));
        gl_FragColor = vec4(col * shape * 3.2, 1.0);
        #include <fog_fragment>
      }`,
  });
  m.uniforms.uTime = CITY_U.uTime;
  _flame = m;
  return m;
}

let _smoke = null;
/** Smoke column: camera-facing (about the vertical axis) quad strip, uv.y 0 base .. 1 top; aFac.x = phase, aFac.y = glow at the base. */
export function smokeMaterial() {
  if (_smoke) return _smoke;
  const m = new THREE.ShaderMaterial({
    name: 'city_smoke', transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: CITY_U.uTime, uNight: CITY_U.uNight }]),
    vertexShader: /* glsl */`
      attribute vec4 aFac; varying vec2 vUv; varying vec2 vF;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vF = aFac.xy;
        // cylindrical billboard: offset along the camera's right vector (projected to the ground plane)
        vec4 c = modelMatrix * vec4(position, 1.0);
        vec3 toCam = cameraPosition - c.xyz; vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
        c.xyz += right * aFac.z * (uv.x - 0.5) * 2.0;
        vec4 mvPosition = viewMatrix * c; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uNight; varying vec2 vUv; varying vec2 vF;
      #include <fog_pars_fragment>
      ${HASH}
      void main() {
        vec2 p = vUv; float t = uTime * 0.09 + vF.x * 5.0;
        float n = cN(vec2(p.x * 3.0 + p.y * 1.3, p.y * 4.0 - t * 3.0)) * 0.55 + cN(vec2(p.x * 7.0 - p.y * 2.0, p.y * 9.0 - t * 5.0)) * 0.3 + cN(vec2(p.x * 17.0, p.y * 19.0 - t * 9.0)) * 0.15;
        float edge = 0.5 - abs(p.x - 0.5);
        float a = smoothstep(0.02, 0.28, edge + (n - 0.5) * 0.35) * smoothstep(0.0, 0.06, p.y) * (1.0 - smoothstep(0.55, 1.0, p.y + n * 0.25));
        a *= (0.6 + 0.4 * n) * (1.0 - 0.35 * smoothstep(0.3, 1.0, p.y));
        vec3 col = mix(vec3(0.03, 0.028, 0.027), vec3(0.075, 0.07, 0.066), n) * (1.0 - 0.75 * uNight);
        col += vec3(1.0, 0.36, 0.08) * vF.y * pow(1.0 - smoothstep(0.0, 0.16, p.y), 2.0) * (0.5 + 0.5 * n) * 0.9;
        gl_FragColor = vec4(col, a * 0.95);
        #include <fog_fragment>
      }`,
  });
  m.uniforms.uTime = CITY_U.uTime; m.uniforms.uNight = CITY_U.uNight;
  _smoke = m;
  return m;
}

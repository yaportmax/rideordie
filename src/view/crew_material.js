// Character material upgrade (all rigged crews): world-scale micro-detail + skin shading on top of the baked atlas.
//  * The atlas metallicRoughness texture carries a DETAIL CLASS in its R channel (tools/characters/atlas.py:
//    R = class * 32 + 8 | 24; 1 skin, 2 fabric, 3 leather, 4 metal, 5 rubber/plastic) and the material extras
//    {detail: {pxm, size}} give the atlas texel density, so atlas UV * size / pxm = metres.
//  * A small procedural DataArrayTexture (one tileable layer per class: pores, plain weave, pebbled grain, scratches,
//    stipple; xyz = tangent normal, a = roughness modulation) is blended into the normal map (UDN) and roughness, faded out
//    beyond ~16 m so it only costs where it shows.
//  * Skin (class 1) gets a cheap wrap-lighting / scatter term in the direct diffuse (red wraps furthest) - soft terminators
//    instead of the plastic look - and a touch more specular breakup from the pore layer.
// patchCrewMaterials(root) is idempotent per material (materials are shared between clones of one GLB).
import * as THREE from 'three';

const N = 128, LAYERS = 6;
// tile size (m) per class: detail features ~1.5-4 mm so they read at 0.5-4 m
const TILE = [1, 0.05, 0.028, 0.07, 0.22, 0.05];
const STRENGTH = [0, 0.55, 0.7, 0.75, 0.45, 0.4];
let DETAIL = null;
const patched = new WeakSet();

// ---- tileable procedural fields -------------------------------------------------------------------------------------------
function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, p, s) {           // periodic value noise, period p cells, x,y in cells
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const m = (a) => ((a % p) + p) % p;
  const a = hash2(m(xi), m(yi), s), b = hash2(m(xi + 1), m(yi), s), c = hash2(m(xi), m(yi + 1), s), d = hash2(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(u, v, base, oct, s) { let f = 0, a = 0.5, p = base; for (let o = 0; o < oct; o++) { f += a * vnoise(u * p, v * p, p, s + o * 17); a *= 0.5; p *= 2; } return f; }
/** Periodic Worley: returns [F1, F2] (in cell units) for u,v in [0,1), `cells` cells per tile. */
function worley(u, v, cells, s) {
  const x = u * cells, y = v * cells, xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, mx = ((cx % cells) + cells) % cells, my = ((cy % cells) + cells) % cells;
    const px = cx + hash2(mx, my, s), py = cy + hash2(mx, my, s + 7);
    const d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return [f1, f2];
}

function heightLayer(k, h, r) {
  const rnd = (i) => hash2(i, k, 99);
  const lines = [];
  if (k === 4) for (let i = 0; i < 70; i++) lines.push([rnd(i * 3), rnd(i * 3 + 1), (rnd(i * 3 + 2) - 0.5) * 0.9 + (i % 5 === 0 ? 1.4 : 0), 0.05 + 0.3 * rnd(i + 500)]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, o = y * N + x;
    let hv = 0, rv = 0.5;
    if (k === 1) {            // skin: pores (pits) + fine crossing lines + soft undulation
      const [f1] = worley(u, v, 26, 11);
      const pore = Math.exp(-(f1 * f1) / 0.035);
      const lines2 = Math.abs(Math.sin((u * 0.8 + v * 0.6) * Math.PI * 38 + 3 * fbm(u, v, 4, 2, 5))) ** 12 + Math.abs(Math.sin((u * 0.6 - v * 0.8) * Math.PI * 30 + 3 * fbm(u, v, 4, 2, 9))) ** 12;
      hv = -0.9 * pore - 0.25 * lines2 + 0.6 * fbm(u, v, 6, 3, 21);
      rv = 0.5 + 0.35 * pore + 0.1 * (fbm(u, v, 8, 2, 31) - 0.5);
    } else if (k === 2) {     // fabric: plain weave (over-under threads) + slub
      const T = 22, a = u * T, b = v * T, ia = Math.floor(a), ib = Math.floor(b);
      const over = (ia + ib) & 1;
      const warp = Math.sin(Math.PI * (a - ia)), weft = Math.sin(Math.PI * (b - ib));
      const slub = fbm(u, v, 8, 3, 41);
      hv = (over ? warp * (0.6 + 0.4 * weft) : weft * (0.6 + 0.4 * warp)) * (0.8 + 0.4 * slub);
      rv = 0.55 - 0.15 * hv + 0.1 * (slub - 0.5);
    } else if (k === 3) {     // leather: pebbled grain cells, creased borders
      const [f1, f2] = worley(u, v, 18, 51);
      const edge = Math.min(1, (f2 - f1) * 3);
      hv = 0.8 * edge + 0.35 * fbm(u, v, 12, 3, 61) - 0.3 * Math.exp(-((f2 - f1) ** 2) / 0.004);
      rv = 0.45 + 0.25 * (1 - edge) + 0.1 * (fbm(u, v, 5, 2, 71) - 0.5);
    } else if (k === 4) {     // metal: pits + scratches
      hv = 0.25 * fbm(u, v, 16, 3, 81);
      const pit = worley(u, v, 30, 91)[0];
      hv -= 0.6 * Math.exp(-(pit * pit) / 0.01) * (hash2(Math.floor(u * 30), Math.floor(v * 30), 93) > 0.7 ? 1 : 0);
      rv += 0.15 * (fbm(u, v, 6, 2, 97) - 0.5);
    } else if (k === 5) {     // rubber / plastic: fine stipple
      hv = fbm(u, v, 32, 2, 101) * 0.9 + 0.3 * fbm(u, v, 8, 2, 103);
      rv = 0.5 + 0.2 * (fbm(u, v, 16, 2, 107) - 0.5);
    }
    h[o] = hv; r[o] = rv;
  }
  // metal scratches: rasterised along each line (wrapping), ~1 px wide grooves, rougher
  if (k === 4) for (const [lx, ly, ang, len] of lines) {
    const dx = Math.cos(ang), dy = Math.sin(ang), steps = Math.ceil(len * N * 2);
    for (let i = 0; i <= steps; i++) {
      const cx = (lx + dx * len * i / steps) * N, cy = (ly + dy * len * i / steps) * N;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const px = Math.floor(cx) + ox, py = Math.floor(cy) + oy, d = Math.abs(-(px + 0.5 - cx) * dy + (py + 0.5 - cy) * dx);
        if (d > 1.0) continue;
        const o = (((py % N) + N) % N) * N + (((px % N) + N) % N);
        h[o] = Math.min(h[o], -0.7 * (1 - d) + 0.25 * 0.5); r[o] = Math.max(r[o], 0.8);
      }
    }
  }
}

function buildDetail() {
  const data = new Uint8Array(N * N * 4 * LAYERS);
  const h = new Float32Array(N * N), r = new Float32Array(N * N);
  for (let k = 0; k < LAYERS; k++) {
    h.fill(0); r.fill(0.5);
    if (k > 0) heightLayer(k, h, r);
    // normalise the height range, gradients with wrap -> tangent normal (glTF: +Y up in the texture = +V)
    let lo = 1e9, hi = -1e9; for (let i = 0; i < h.length; i++) { lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
    const sc = hi > lo ? 1 / (hi - lo) : 0, st = 4.0;
    const base = k * N * N * 4;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const at = (xx, yy) => h[(((yy + N) % N) * N) + ((xx + N) % N)] * sc;
      const gx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * st, gy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * st;
      let nx = -gx, ny = gy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const o = base + (y * N + x) * 4;
      data[o] = (nx * 0.5 + 0.5) * 255; data[o + 1] = (ny * 0.5 + 0.5) * 255; data[o + 2] = (nz * 0.5 + 0.5) * 255;
      data[o + 3] = Math.max(0, Math.min(255, r[y * N + x] * 255));
    }
  }
  const t = new THREE.DataArrayTexture(data, N, N, LAYERS);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const FRAG_DECL = `
uniform highp sampler2DArray uCrewDetail;
uniform float uCrewDetailK;
uniform float uCrewTile[${LAYERS}];
uniform float uCrewStr[${LAYERS}];
float gSkinK = 0.0;
float gDetW = 0.0;
vec4 gDet = vec4( 0.5, 0.5, 1.0, 0.5 );
`;
const ROUGH_INJECT = `#include <roughnessmap_fragment>
	{
		float crewR = texture2D( roughnessMap, vRoughnessMapUv ).r * 255.0;
		int crewCls = int( clamp( floor( crewR / 32.0 ), 0.0, ${LAYERS - 1}.0 ) );
		float crewFade = 1.0 - smoothstep( 5.0, 16.0, length( vViewPosition ) );
		gSkinK = crewCls == 1 ? 1.0 : 0.0;
		if ( crewCls > 0 && crewFade > 0.0 ) {
			gDet = texture( uCrewDetail, vec3( vNormalMapUv * uCrewDetailK * uCrewTile[ crewCls ], float( crewCls ) ) );
			gDetW = uCrewStr[ crewCls ] * crewFade;
			roughnessFactor = clamp( roughnessFactor * ( 1.0 + ( gDet.a - 0.5 ) * 0.9 * crewFade ), 0.04, 1.0 );
		}
	}`;
const LAMBERT = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
const SKIN_WRAP = `${LAMBERT}
	if ( gSkinK > 0.0 ) {
		float crewNL = dot( geometryNormal, directLight.direction );
		vec3 crewW = vec3( 0.50, 0.24, 0.14 );
		vec3 crewWrap = saturate( ( vec3( crewNL ) + crewW ) / ( 1.0 + crewW ) );
		reflectedLight.directDiffuse += ( crewWrap - vec3( saturate( crewNL ) ) ) * 0.85 * directLight.color * BRDF_Lambert( material.diffuseContribution ) * gSkinK;
	}`;

/** Upgrade every atlas material (with the detail extras) of a character model; safe to call on every clone. */
export function patchCrewMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m || patched.has(m)) continue;
      patched.add(m);
      for (const t of [m.map, m.normalMap, m.roughnessMap, m.emissiveMap]) if (t) t.anisotropy = 8;
      const det = m.userData && m.userData.detail;
      if (!det || !m.normalMap || !m.roughnessMap) continue;
      if (!DETAIL) DETAIL = buildDetail();
      const k = det.size / Math.max(1, det.pxm);
      const tiles = TILE.map((t) => 1 / t);
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uCrewDetail = { value: DETAIL };
        sh.uniforms.uCrewDetailK = { value: k };
        sh.uniforms.uCrewTile = { value: tiles };
        sh.uniforms.uCrewStr = { value: STRENGTH };
        const lights = THREE.ShaderChunk.lights_physical_pars_fragment;
        const nmaps = THREE.ShaderChunk.normal_fragment_maps;
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
          .replace('#include <roughnessmap_fragment>', ROUGH_INJECT)
          .replace('#include <normal_fragment_maps>', nmaps.replace('mapN.xy *= normalScale;',
            'mapN.xy *= normalScale;\n\tif ( gDetW > 0.0 ) { vec3 crewN = gDet.xyz * 2.0 - 1.0; mapN = normalize( vec3( mapN.xy + crewN.xy * gDetW, mapN.z ) ); }'))
          .replace('#include <lights_physical_pars_fragment>', lights.includes(LAMBERT) ? lights.replace(LAMBERT, SKIN_WRAP) : lights);
      };
      m.customProgramCacheKey = () => 'crew_detail_1';
      m.needsUpdate = true;
    }
  });
}

// Time-of-day "look" keyed to distance along the road: late morning (desert) -> noon (canyon) -> golden hour (coast)
// -> sunset (mountains) -> moonlit night (city) -> dawn (dam + boss). One look per biome, anchored at the biome's midpoint,
// smoothly interpolated in between. Colours are LINEAR radiance (hex is sRGB, the second arg scales it).
//
// Consumers outside the atmosphere code read: sun, az, night, fog (average horizon haze), sunCol, hemiSky.
import * as THREE from 'three';
import { BIOME_PLAN, BIOME_START } from '../data/biomes.js';
import { smoothstep, lerp } from '../core/util.js';
import { contextualRoad, roadBiomeAt } from './biome_context.js';

const K = (h, i = 1) => new THREE.Color(h).multiplyScalar(i);
// field reference
//  sun/az: sun elevation/azimuth (deg). moonEl/moonAz: moon. sunCol/sunI: key light (sun). moonCol/moonI: key light at night.
//  zen/hor: zenith / horizon sky radiance, zenExp: gradient exponent, horSharp: horizon band sharpness.
//  glow/glowSpread: sun-side horizon glow (spread 0 = all around, e.g. city light pollution). halo/haloExp: Mie halo. disc: sun disc radiance mul.
//  cloudCov/cloudOp: coverage / opacity, cloudLit/cloudShade: radiance of the sunlit / shaded side. stars 0..1.
//  fogD: distance extinction (1/m), fogH: height-fog density at its base (1/m), fogFall: height-fog scale height (m),
//  fogBase: height-fog base relative to the truck (m), fogClear: fog-free radius (m), fogMax: max opacity,
//  haze/hazeMix: ground-haze colour + how much the height fog takes it (dust, sea mist, smog). shafts: sun-shaft strength.
//  hemiSky/hemiGnd/hemiI: hemisphere fill, envI: IBL intensity, gnd: ground albedo seen by the IBL (lower hemisphere).
//  exp: exposure. grade: con (S-curve), sat, shT (additive shadow tint), hiT (highlight multiplier).
export const LOOKS = {
  desert: {
    sun: 38, az: 120, moonEl: -30, moonAz: 30, sunCol: K(0xfff0dc), sunI: 3.4, moonCol: K(0x9fb4ff), moonI: 0,
    zen: K(0x2d74d8, 1.6), hor: K(0xd6dade, 1.25), zenExp: 0.42, horSharp: 7, glow: K(0xffdcb0, 0.35), glowSpread: 3, halo: K(0xfff0dc, 0.8), haloExp: 18, disc: 60,
    cloudCov: 0.30, cloudOp: 0.85, cloudLit: K(0xfff8f0, 2.1), cloudShade: K(0x8c9cba, 0.85), stars: 0,
    fogD: 0.00017, fogH: 0.00028, fogFall: 40, fogBase: -3, fogClear: 20, fogMax: 0.985, haze: K(0xe0c29a, 1.05), hazeMix: 0.55, shafts: 0.25,
    hemiSky: K(0xbcd2ff), hemiGnd: K(0xb08a5e), hemiI: 0.15, envI: 0.7, gnd: K(0xc9a676),
    exp: 1.0, night: 0, grade: { con: 0.3, sat: 1.3, shT: [-0.008, 0.0, 0.014], hiT: [1.05, 1.0, 0.93] },
  },
  canyon: {
    sun: 52, az: 250, moonEl: -30, moonAz: 20, sunCol: K(0xfff3e2), sunI: 3.6, moonCol: K(0x9fb4ff), moonI: 0,
    zen: K(0x2a6cd0, 1.75), hor: K(0xdcd6ce, 1.25), zenExp: 0.38, horSharp: 7, glow: K(0xffc890, 0.3), glowSpread: 2, halo: K(0xfff3e2, 0.7), haloExp: 20, disc: 60,
    cloudCov: 0.2, cloudOp: 0.8, cloudLit: K(0xffffff, 2.3), cloudShade: K(0x94a0bc, 0.85), stars: 0,
    fogD: 0.0002, fogH: 0.0006, fogFall: 18, fogBase: -2, fogClear: 20, fogMax: 0.985, haze: K(0xdc9e70, 1.05), hazeMix: 0.8, shafts: 0.2,
    hemiSky: K(0xa8c0ff), hemiGnd: K(0xa0553a), hemiI: 0.15, envI: 0.68, gnd: K(0xb0694a),
    exp: 0.97, night: 0, grade: { con: 0.32, sat: 1.3, shT: [0.0, -0.004, 0.012], hiT: [1.07, 1.0, 0.9] },
  },
  coast: {
    sun: 14, az: 40, moonEl: -30, moonAz: 70, sunCol: K(0xffc68a), sunI: 4.0, moonCol: K(0x9fb4ff), moonI: 0,
    zen: K(0x3a7ad0, 1.4), hor: K(0xd0d8e0, 1.1), zenExp: 0.5, horSharp: 7, glow: K(0xffb070, 1.0), glowSpread: 2.5, halo: K(0xffcc92, 0.8), haloExp: 16, disc: 55,
    cloudCov: 0.38, cloudOp: 0.85, cloudLit: K(0xffdcb0, 2.0), cloudShade: K(0x8a92b4, 0.7), stars: 0,
    fogD: 0.00015, fogH: 0.0004, fogFall: 45, fogBase: -25, fogClear: 20, fogMax: 0.985, haze: K(0xc4d2e0, 0.95), hazeMix: 0.5, shafts: 0.4,
    hemiSky: K(0x9cb8f0), hemiGnd: K(0x8a6a55), hemiI: 0.15, envI: 0.72, gnd: K(0x7a8656),
    exp: 1.0, night: 0, grade: { con: 0.3, sat: 1.3, shT: [-0.012, 0.004, 0.02], hiT: [1.08, 1.0, 0.88] },
  },
  mountain: {
    sun: 4.5, az: 345, moonEl: 5, moonAz: 150, sunCol: K(0xff9a58), sunI: 3.4, moonCol: K(0x9fb4ff), moonI: 0.1,
    zen: K(0x243c80, 0.9), hor: K(0xb4a2b8, 0.78), zenExp: 0.5, horSharp: 5, glow: K(0xff7a30, 1.7), glowSpread: 3, halo: K(0xff9a58, 1.5), haloExp: 14, disc: 40,
    cloudCov: 0.45, cloudOp: 0.9, cloudLit: K(0xffa060, 2.3), cloudShade: K(0x4a4470, 0.45), stars: 0,
    fogD: 0.00016, fogH: 0.0008, fogFall: 60, fogBase: -40, fogClear: 20, fogMax: 0.985, haze: K(0x8890b0, 0.6), hazeMix: 0.7, shafts: 0.9,
    hemiSky: K(0x8a90d0), hemiGnd: K(0x5a4a48), hemiI: 0.2, envI: 0.85, gnd: K(0x5a5048),
    exp: 1.08, night: 0.1, grade: { con: 0.3, sat: 1.3, shT: [-0.01, 0.0, 0.03], hiT: [1.08, 0.98, 0.88] },
  },
  city: {
    sun: -10, az: 340, moonEl: 34, moonAz: 110, sunCol: K(0xff7040), sunI: 0, moonCol: K(0xa8bce8), moonI: 0.24,
    zen: K(0x10204a, 0.3), hor: K(0x2a3448, 0.3), zenExp: 0.5, horSharp: 10, glow: K(0xff8a40, 0.05), glowSpread: 0, halo: K(0x000000), haloExp: 10, disc: 0,
    cloudCov: 0.35, cloudOp: 0.8, cloudLit: K(0x8090b0, 0.06), cloudShade: K(0x5a4038, 0.05), stars: 1,
    fogD: 0.0003, fogH: 0.001, fogFall: 30, fogBase: -3, fogClear: 15, fogMax: 0.985, haze: K(0x6a4a48, 0.05), hazeMix: 0.7, shafts: 0,
    hemiSky: K(0x4a5a90), hemiGnd: K(0x3a3040), hemiI: 0.3, envI: 1.2, gnd: K(0x4a4448),
    exp: 1.75, night: 0.8, grade: { con: 0.22, sat: 1.25, shT: [0.0, 0.005, 0.02], hiT: [1.05, 1.0, 0.95] },
  },
  dam: {
    sun: 9, az: 318, moonEl: 20, moonAz: 150, sunCol: K(0xffb078), sunI: 3.6, moonCol: K(0x9fb4ff), moonI: 0.1,
    zen: K(0x2c5cb0, 1.1), hor: K(0xc4cad8, 0.95), zenExp: 0.45, horSharp: 6, glow: K(0xffa060, 1.1), glowSpread: 3, halo: K(0xffb078, 0.85), haloExp: 18, disc: 50,
    cloudCov: 0.42, cloudOp: 0.88, cloudLit: K(0xffb890, 2.3), cloudShade: K(0x5a5a84, 0.5), stars: 0,
    fogD: 0.00022, fogH: 0.001, fogFall: 25, fogBase: -35, fogClear: 20, fogMax: 0.985, haze: K(0xd8d4dc, 0.9), hazeMix: 0.8, shafts: 0.5,
    hemiSky: K(0x9fb6ee), hemiGnd: K(0x6a5a55), hemiI: 0.15, envI: 0.72, gnd: K(0x7a7068),
    exp: 1.05, night: 0.15, grade: { con: 0.3, sat: 1.28, shT: [-0.008, 0.0, 0.02], hiT: [1.07, 0.99, 0.92] },
  },
};
// Complete look records keep every atmosphere, IBL, fog and grading consumer
// defined. The new worlds share an authored base, then replace their identity.
LOOKS.underground = {
  ...LOOKS.city, sun: -12, moonEl: -20, moonI: 0, night: 0.7, exp: 1.15,
  zen: K(0x112a36, 0.4), hor: K(0x305662, 0.45), glow: K(0x124556, 0.12), stars: 0,
  cloudCov: 0, cloudOp: 0, fogD: 0.0008, fogH: 0.0004, fogClear: 35,
  haze: K(0x35515b, 0.3), hemiSky: K(0x91c9dc), hemiGnd: K(0x65564b), hemiI: 0.5,
  envI: 0.85, gnd: K(0x4a5259), shafts: 0,
};
LOOKS.sky = {
  ...LOOKS.coast, sun: 30, az: 160, sunCol: K(0xffe9fa), sunI: 3, night: 0,
  zen: K(0x5b80e5, 1.4), hor: K(0xbecdf5, 1.15), glow: K(0xffd8f5, 0.45),
  cloudCov: 0.42, fogD: 0.00018, fogH: 0.00008, fogBase: -110, fogClear: 35,
  haze: K(0xaebfed, 0.75), hemiSky: K(0xbccaff), hemiGnd: K(0x6b749c), exp: 0.98,
};
LOOKS.hell = {
  ...LOOKS.canyon, sun: 8, az: 290, sunCol: K(0xff7b37), sunI: 2, night: 0.18,
  zen: K(0x48191d, 0.8), hor: K(0x84382b, 0.85), glow: K(0xff541a, 0.8),
  cloudLit: K(0xd7744c, 0.8), cloudShade: K(0x46272b, 0.5), cloudCov: 0.7,
  fogD: 0.00055, fogH: 0.0008, fogClear: 30, haze: K(0x6f211d, 0.55),
  hemiSky: K(0xb84931), hemiGnd: K(0x692716), hemiI: 0.3, exp: 1, gnd: K(0x47332e),
};
LOOKS.space = {
  ...LOOKS.city, sun: 25, az: 80, sunCol: K(0xe2eaff), sunI: 3.7, moonEl: -30, moonI: 0,
  zen: K(0x030617, 0.12), hor: K(0x101730, 0.2), glow: K(0x203c7a, 0.04),
  stars: 1, cloudCov: 0, cloudOp: 0, disc: 18, night: 0.55,
  fogD: 0.0001, fogH: 0, fogClear: 40, haze: K(0x090d23, 0.2),
  hemiSky: K(0x6985bf), hemiGnd: K(0x333650), hemiI: 0.3, envI: 0.85, exp: 1.05,
};
const ANCHORS = BIOME_PLAN.map((b, i) => ({ id: b.id, s: BIOME_START[i] + (i === BIOME_PLAN.length - 1 ? 1500 : b.len / 2) }));

const NUM = ['sun', 'az', 'moonEl', 'moonAz', 'sunI', 'moonI', 'zenExp', 'horSharp', 'glowSpread', 'haloExp', 'disc', 'cloudCov', 'cloudOp', 'stars',
  'fogD', 'fogH', 'fogFall', 'fogBase', 'fogClear', 'fogMax', 'hazeMix', 'shafts', 'hemiI', 'envI', 'exp', 'night'];
const COL = ['sunCol', 'moonCol', 'zen', 'hor', 'glow', 'halo', 'cloudLit', 'cloudShade', 'haze', 'hemiSky', 'hemiGnd', 'gnd'];
const GNUM = ['con', 'sat'], GARR = ['shT', 'hiT'];

function makeOut() {
  const o = { fog: new THREE.Color(), grade: { con: 0, sat: 1, shT: [0, 0, 0], hiT: [1, 1, 1] } };
  for (const k of NUM) o[k] = 0;
  for (const k of COL) o[k] = new THREE.Color();
  return o;
}
const _out = makeOut();

/** Smoothly interpolated look at road distance s. Returns a shared object (copy if you keep it). */
export function lookAt(s, out = _out, road) {
  let a, b, t;
  if (contextualRoad(road)) {
    const bio = roadBiomeAt(road, s);
    a = bio.a; b = bio.b; t = bio.w;
  } else {
    let i = 0;
    while (i < ANCHORS.length - 1 && s > ANCHORS[i + 1].s) i++;
    const A = ANCHORS[i], B = ANCHORS[Math.min(i + 1, ANCHORS.length - 1)];
    a = A.id; b = B.id; t = A === B ? 0 : smoothstep(A.s, B.s, s);
  }
  const la = LOOKS[a], lb = LOOKS[b];
  for (const k of NUM) out[k] = lerp(la[k], lb[k], t);
  for (const k of COL) out[k].copy(la[k]).lerp(lb[k], t);
  // azimuths: shortest way round
  let da = lb.az - la.az; da -= Math.round(da / 360) * 360; out.az = la.az + da * t;
  let dm = lb.moonAz - la.moonAz; dm -= Math.round(dm / 360) * 360; out.moonAz = la.moonAz + dm * t;
  const g = out.grade, ga = la.grade, gb = lb.grade;
  for (const k of GNUM) g[k] = lerp(ga[k], gb[k], t);
  for (const k of GARR) for (let j = 0; j < 3; j++) g[k][j] = lerp(ga[k][j], gb[k][j], t);
  // average horizon haze (for consumers that fog with one colour: backdrop, particles, decals)
  out.fog.copy(out.hor).lerp(out.haze, 0.35).add(_g.copy(out.glow).multiplyScalar(0.25));
  // legacy fields (fx / dev tools)
  out.hemiGround = out.hemiGnd; out.fogDensity = out.fogD;
  return out;
}
const _g = new THREE.Color();

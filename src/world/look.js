// Time-of-day "look" keyed to distance along the road: morning -> noon -> golden hour -> sunset -> dusk -> dawn (boss).
import * as THREE from 'three';
import { BIOME_PLAN, BIOME_START } from '../data/biomes.js';
import { smoothstep, lerp } from '../core/util.js';

const C = (h) => new THREE.Color(h);
// one look per biome, anchored at the biome's midpoint
export const LOOKS = {
  desert:   { sun: 38, az: 205, turb: 8, ray: 1.3, mie: 0.006, exp: 0.95, fog: C(0xd9b48a), fogD: 0.00075, sunCol: C(0xffe6c0), sunI: 2.8, hemiSky: C(0xbcd2ff), hemiGnd: C(0xb08a5e), hemiI: 0.35, moonI: 0, night: 0 },
  canyon:   { sun: 56, az: 190, turb: 6, ray: 1.6, mie: 0.005, exp: 0.90, fog: C(0xd6a37c), fogD: 0.00090, sunCol: C(0xfff2dc), sunI: 3.1, hemiSky: C(0xa8c0ff), hemiGnd: C(0xa0553a), hemiI: 0.35, moonI: 0, night: 0 },
  coast:    { sun: 17, az: 250, turb: 4, ray: 2.1, mie: 0.004, exp: 0.90, fog: C(0xf0a877), fogD: 0.00080, sunCol: C(0xffbb80), sunI: 2.8, hemiSky: C(0x9cb8f0), hemiGnd: C(0x8a6a55), hemiI: 0.35, moonI: 0, night: 0 },
  mountain: { sun: 4,  az: 235, turb: 3, ray: 2.6, mie: 0.005, exp: 0.95, fog: C(0xc98c82), fogD: 0.00110, sunCol: C(0xff8a4c), sunI: 2.6, hemiSky: C(0x9aa6e6), hemiGnd: C(0x6a5860), hemiI: 0.35, moonI: 0.15, night: 0.1 },
  city:     { sun: -8, az: 260, turb: 6, ray: 1.2, mie: 0.010, exp: 1.10, fog: C(0x55506c), fogD: 0.00140, sunCol: C(0xff7040), sunI: 0.6, hemiSky: C(0x5468a8), hemiGnd: C(0x40323c), hemiI: 0.45, moonI: 0.85, night: 0.8 },
  dam:      { sun: 2,  az: 95,  turb: 5, ray: 2.4, mie: 0.006, exp: 0.95, fog: C(0xe0a488), fogD: 0.00070, sunCol: C(0xffa070), sunI: 2.7, hemiSky: C(0x9fb6ee), hemiGnd: C(0x6a5a55), hemiI: 0.35, moonI: 0.2, night: 0.15 },
};
const ANCHORS = BIOME_PLAN.map((b, i) => ({ id: b.id, s: BIOME_START[i] + (i === BIOME_PLAN.length - 1 ? 1500 : b.len / 2) }));

const _out = {
  sun: 0, az: 0, turb: 0, ray: 0, mie: 0, exp: 0, fog: new THREE.Color(), fogD: 0, sunCol: new THREE.Color(), sunI: 0,
  hemiSky: new THREE.Color(), hemiGnd: new THREE.Color(), hemiI: 0, moonI: 0, night: 0,
};
const NUM = ['sun', 'az', 'turb', 'ray', 'mie', 'exp', 'fogD', 'sunI', 'hemiI', 'moonI', 'night'];
const COL = ['fog', 'sunCol', 'hemiSky', 'hemiGnd'];

/** Smoothly interpolated look at road distance s. Returns a shared object (copy if you keep it). */
export function lookAt(s, out = _out) {
  let i = 0;
  while (i < ANCHORS.length - 1 && s > ANCHORS[i + 1].s) i++;
  const A = ANCHORS[i], B = ANCHORS[Math.min(i + 1, ANCHORS.length - 1)];
  const t = A === B ? 0 : smoothstep(A.s, B.s, s);
  const la = LOOKS[A.id], lb = LOOKS[B.id];
  for (const k of NUM) out[k] = lerp(la[k], lb[k], t);
  for (const k of COL) out[k].copy(la[k]).lerp(lb[k], t);
  return out;
}

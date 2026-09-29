// Street-lamp lighting at night: a fixed pool of PointLights (always in the scene => the light count never changes => no
// shader recompiles) that is re-assigned every frame to the street lamps nearest the camera (preferring those ahead).
// Lights fade with distance before they can be re-assigned, so swapping is invisible. Intensity 0 by day.
import * as THREE from 'three';

const N = 4;             // pooled lights
const REACH = 26;        // light distance cutoff (m)
const FADE0 = 55, FADE1 = 95;   // camera distance where a lamp's light fades out (m)
const _cand = new Float32Array(64 * 4);   // x, y, z, score

export class NightLights {
  constructor(scene) {
    this.lights = [];
    for (let i = 0; i < N; i++) {
      const l = new THREE.PointLight(0xffa050, 0, REACH, 2);
      l.castShadow = false; l.name = 'lamp_light';
      scene.add(l); this.lights.push(l);
    }
    this.intensity = 70;
  }

  /** dressing: Dressing (reads its per-chunk 'lamp_cone' lists = lamp head positions). night 0..1. */
  update(camera, dressing, night) {
    const k = THREE.MathUtils.smoothstep(night, 0.15, 0.55);
    let n = 0;
    if (k > 0.001 && dressing && dressing.chunks) {
      const cp = camera.position;
      camera.getWorldDirection(_d);
      for (const ch of dressing.chunks.values()) {
        const L = ch.lists && ch.lists.get('lamp_cone');
        if (!L || !L.n) continue;
        if (L.maxx < cp.x - FADE1 || L.minx > cp.x + FADE1 || L.maxz < cp.z - FADE1 || L.minz > cp.z + FADE1) continue;
        const m = L.m;
        for (let i = 0; i < L.n && n < 64; i++) {
          const o = i * 16, x = m[o + 12], y = m[o + 13] - 0.6, z = m[o + 14];
          const dx = x - cp.x, dz = z - cp.z, d = Math.hypot(dx, dz);
          if (d > FADE1) continue;
          const ahead = (dx * _d.x + dz * _d.z) / Math.max(1, d);
          const j = n * 4; _cand[j] = x; _cand[j + 1] = y; _cand[j + 2] = z; _cand[j + 3] = d * (1.35 - 0.35 * ahead); n++;
        }
      }
    }
    // pick the N best (smallest score), no allocations
    for (let i = 0; i < N; i++) {
      let best = -1, bs = 1e9;
      for (let c = 0; c < n; c++) { const s = _cand[c * 4 + 3]; if (s < bs) { bs = s; best = c; } }
      const l = this.lights[i];
      if (best < 0) { l.intensity = 0; continue; }
      const j = best * 4;
      l.position.set(_cand[j], _cand[j + 1], _cand[j + 2]);
      const d = Math.hypot(_cand[j] - camera.position.x, _cand[j + 2] - camera.position.z);
      l.intensity = this.intensity * k * (1 - THREE.MathUtils.smoothstep(d, FADE0, FADE1));
      _cand[j + 3] = 1e9;
    }
  }
}
const _d = new THREE.Vector3();

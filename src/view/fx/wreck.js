// Wreck charring: patches the (already per-CarView cloned) `paint*` materials with a soot + ember-glow term driven by uniforms.
// The patch is applied the first time a car is seen (so the shader variant is compiled up-front, not at the moment of the
// explosion) and is a no-op while uChar == 0 (uniform branch).

const NOISE = /* glsl */`
float wh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wn(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wh(i), wh(i + vec3(1, 0, 0)), f.x), mix(wh(i + vec3(0, 1, 0)), wh(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(wh(i + vec3(0, 0, 1)), wh(i + vec3(1, 0, 1)), f.x), mix(wh(i + vec3(0, 1, 1)), wh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

/** Per-car uniform holder shared by all patched materials of one CarView. */
export function makeWreckUniforms() {
  return { uChar: { value: 0 }, uGlow: { value: 0 }, uWTime: { value: 0 } };
}

export function patchPaint(mat, u) {
  if (mat.userData.__wreckPatched) return;
  mat.userData.__wreckPatched = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uChar = u.uChar; sh.uniforms.uGlow = u.uGlow; sh.uniforms.uWTime = u.uWTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWrk;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWrk = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uChar; uniform float uGlow; uniform float uWTime; varying vec3 vWrk;\n${NOISE}\nfloat gSoot = 0.0; float gEmber = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uChar > 0.001) {
          float n1 = wn(vWrk * 2.6), n2 = wn(vWrk * 9.0 + 5.0);
          gSoot = clamp(uChar * (0.82 + 0.35 * n1), 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.016, 0.014) * (0.55 + 0.9 * n2), gSoot * 0.94);
          float e = wn(vWrk * 4.4 + 3.0) * 0.65 + wn(vWrk * 13.0) * 0.35;
          gEmber = smoothstep(0.58, 0.82, e) * uGlow * (0.7 + 0.3 * sin(uWTime * 9.0 + n1 * 40.0));
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.93, gSoot);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.15, gSoot);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(3.0, 0.85, 0.12) * gEmber;');
  };
  mat.customProgramCacheKey = () => 'rod_wreck_paint';
  mat.needsUpdate = true;
}

/** Find the paint colour (hex) of a car view for debris tinting. */
export function paintHexOf(cv) {
  let hex = 0x6d4a30;
  cv.root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && m.name === 'paint' && m.color) hex = m.color.getHex(); });
  return hex;
}

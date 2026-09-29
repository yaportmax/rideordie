// Atmosphere: ONE art-directed analytic sky model shared by the sky dome, the IBL environment, the water reflection and
// the fog of EVERY material in the run scene, so distant geometry dissolves into exactly the sky colour behind it
// (sun-side haze glows warm, the anti-sun side stays cool, peaks above the haze stay crisp).
//
// Fog model (replaces three's fog chunks when scene.fog is a FogExp2 and the atmosphere is enabled):
//   optical depth = sigma * max(0, d - clearDist)                       (aerial perspective, exponential in distance)
//                 + integral of a * exp(-b * (y - base)) along the ray  (height fog / ground haze, analytic)
//   inscatter colour = atmSky(view dir) blended toward a separate ground-haze colour by the height-fog share.
// Materials built with THREE.Fog (garage, UI previews) keep three's linear fog.
//
// Uniforms are shared by reference across every program: the Vector4 subclass below returns itself from clone(), so the
// copies three makes of ShaderLib / UniformsLib.fog uniforms all point at the same objects (no per-material updates).
import * as THREE from 'three';

class SharedV4 extends THREE.Vector4 { clone() { return this; } }
const V = () => ({ value: new SharedV4() });

/** Shared uniforms (values are written by SkyRig every frame). */
export const ATMO = {
  uAtmSun: V(),   // xyz: direction TO the sun (normalised), w: sun visibility 0..1 (disc/halo)
  uAtmZen: V(),   // rgb: zenith radiance,  w: gradient exponent (smaller = blue reaches lower)
  uAtmHor: V(),   // rgb: horizon radiance, w: horizon glow band sharpness
  uAtmGlow: V(),  // rgb: sun-side horizon glow (sunset band / city glow), w: azimuth spread exponent (0 = all around)
  uAtmHalo: V(),  // rgb: Mie halo radiance around the sun, w: halo exponent (tightness)
  uAtmFog: V(),   // x: distance extinction sigma (1/m), y: height-fog density a (1/m), z: height falloff b (1/m), w: 1 = enabled
  uAtmFog2: V(),  // x: height-fog base (world y), y: clear distance (m), z: max fog opacity, w: ground-haze colour share
  uAtmLow: V(),   // rgb: ground haze colour (dust / mist / smog), w: below-horizon darkening
};

export const ATMO_GLSL = /* glsl */`
#ifndef ATM_GLSL
#define ATM_GLSL
uniform vec4 uAtmSun; uniform vec4 uAtmZen; uniform vec4 uAtmHor; uniform vec4 uAtmGlow; uniform vec4 uAtmHalo;
uniform vec4 uAtmFog; uniform vec4 uAtmFog2; uniform vec4 uAtmLow;
// radiance of the clear sky (no disc, no clouds, no stars) seen along dir
vec3 atmSky(vec3 dir) {
  float y = dir.y;
  float h = clamp(y, 0.0, 1.0);
  vec3 col = mix(uAtmHor.rgb, uAtmZen.rgb, pow(h, uAtmZen.w));
  vec2 dxz = dir.xz * inversesqrt(max(dot(dir.xz, dir.xz), 1e-6));
  vec2 sxz = uAtmSun.xz * inversesqrt(max(dot(uAtmSun.xz, uAtmSun.xz), 1e-6));
  float az = dot(dxz, sxz) * 0.5 + 0.5;
  col += uAtmGlow.rgb * pow(max(az, 1e-4), uAtmGlow.w) * exp(-h * uAtmHor.w);
  float cs = max(dot(dir, uAtmSun.xyz), 0.0);
  col += uAtmHalo.rgb * (pow(cs, uAtmHalo.w) + 0.18 * pow(cs, max(uAtmHalo.w * 0.1, 1.0)));
  // below the horizon: the haze darkens slightly toward the ground
  col *= 1.0 - uAtmLow.w * smoothstep(0.0, -0.35, y);
  return col;
}
// fog / aerial perspective for a surface at world offset rel (camera -> point)
vec3 atmApply(vec3 col, vec3 rel) {
  float d = length(rel);
  vec3 dir = rel / max(d, 1e-4);
  float dc = max(d - uAtmFog2.y, 0.0);
  float tauD = uAtmFog.x * dc;
  float b = uAtmFog.z;
  float h0 = max(cameraPosition.y - uAtmFog2.x, -30.0);
  float k = clamp(b * dir.y * dc, -18.0, 60.0);
  float g = abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k;
  float tauH = uAtmFog.y * exp(-b * h0) * dc * g;
  float tau = tauD + tauH;
  float f = min(1.0 - exp(-tau), uAtmFog2.z);
  vec3 fc = mix(atmSky(dir), uAtmLow.rgb, uAtmFog2.w * tauH / max(tau, 1e-5));
  return mix(col, fc, f);
}
#endif
`;

/** Key light (sun by day, moon by night) for custom shaders (water glints, ...). Written by SkyRig. */
export const KEY = { uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uKeyCol: { value: new THREE.Color(1, 1, 1) } };

// ------------------------------------------------------------------------------------------ install into three's chunks
let installed = false;
/** Patch three's fog chunks + built-in uniform tables. Idempotent; must run before the first material compiles. */
export function installAtmosphere() {
  if (installed) return; installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogRel;\n#endif\n';
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogRel = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;\n#endif\n';
  C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogRel;
	#ifdef FOG_EXP2
		uniform float fogDensity;
		${ATMO_GLSL}
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;
  C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		if ( uAtmFog.w > 0.5 ) {
			gl_FragColor.rgb = atmApply( gl_FragColor.rgb, vFogRel );
		} else {
			float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
			gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
		}
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	#endif
#endif
`;
  const add = (u) => { if (u && u.fogColor) for (const k in ATMO) u[k] = ATMO[k]; };
  add(THREE.UniformsLib.fog);
  for (const k in THREE.ShaderLib) add(THREE.ShaderLib[k].uniforms);
}
installAtmosphere();

// ------------------------------------------------------------------------------------------ CPU mirror (for JS consumers)
const _c = new THREE.Vector3();
/** CPU version of atmSky (clear sky radiance along a normalised direction) -> out (THREE.Color, linear). */
export function atmSkyCPU(dir, out) {
  const S = ATMO.uAtmSun.value, Z = ATMO.uAtmZen.value, H = ATMO.uAtmHor.value, G = ATMO.uAtmGlow.value, A = ATMO.uAtmHalo.value, L = ATMO.uAtmLow.value;
  const y = dir.y, h = Math.min(1, Math.max(0, y));
  const t = Math.pow(h, Z.w);
  _c.set(H.x + (Z.x - H.x) * t, H.y + (Z.y - H.y) * t, H.z + (Z.z - H.z) * t);
  const dl = Math.hypot(dir.x, dir.z) || 1, sl = Math.hypot(S.x, S.z) || 1;
  const az = ((dir.x * S.x + dir.z * S.z) / (dl * sl)) * 0.5 + 0.5;
  const gk = Math.pow(az, G.w) * Math.exp(-h * H.w);
  _c.x += G.x * gk; _c.y += G.y * gk; _c.z += G.z * gk;
  const cs = Math.max(0, dir.x * S.x + dir.y * S.y + dir.z * S.z);
  const hk = Math.pow(cs, A.w) + 0.18 * Math.pow(cs, Math.max(A.w * 0.1, 1));
  _c.x += A.x * hk; _c.y += A.y * hk; _c.z += A.z * hk;
  const e = Math.min(1, Math.max(0, -y / 0.35)), dk = 1 - L.w * e * e * (3 - 2 * e);
  return out.setRGB(_c.x * dk, _c.y * dk, _c.z * dk);
}

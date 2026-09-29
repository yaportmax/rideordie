// Selective-ish bloom source: a soft-knee HDR threshold that
//  - only lets emissive / very bright pixels through (tracers, fire, lamps, sun glints, sun disc),
//  - uses a MUCH higher threshold on sky pixels (depth == 1) so bright sky / haze never blooms into the fog,
//    while the sun disc (thousands of HDR units) still produces a glare,
//  - clamps the value so a single tiny hot pixel cannot flicker across the whole screen,
//  - averages 4 taps (Karis-style weights) to be stable when the camera moves.
import { LuminancePass, BloomEffect, BlendFunction } from 'postprocessing';
import { ShaderMaterial, Uniform, NoBlending, Vector2, Vector4 } from 'three';

const vert = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const frag = /* glsl */`
precision highp float;
uniform sampler2D inputBuffer;
uniform sampler2D depthBuffer;
uniform vec2 texelSize;
uniform vec4 thr;     // x: threshold, y: knee, z: clamp, w: sky threshold multiplier
uniform float useDepth;
varying vec2 vUv;

vec3 prefilter(vec2 uv, float skyMul) {
  vec3 c = texture2D(inputBuffer, uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float t = thr.x * skyMul;
  float kn = thr.y * skyMul;
  float soft = clamp(l - t + kn, 0.0, 2.0 * kn);
  soft = soft * soft / (4.0 * kn + 1e-4);
  float contrib = max(soft, l - t) / max(l, 1e-4);
  return min(c * contrib, vec3(thr.z));
}

void main() {
  float skyMul = 1.0;
  if (useDepth > 0.5) {
    float d = texture2D(depthBuffer, vUv).r;
    skyMul = d >= 0.9999999 ? thr.w : 1.0;
  }
  vec2 o = texelSize * 0.5;
  vec3 a = prefilter(vUv + vec2(-o.x, -o.y), skyMul);
  vec3 b = prefilter(vUv + vec2( o.x, -o.y), skyMul);
  vec3 c = prefilter(vUv + vec2(-o.x,  o.y), skyMul);
  vec3 d = prefilter(vUv + vec2( o.x,  o.y), skyMul);
  // Karis average: down-weight very bright samples to kill fireflies
  float wa = 1.0 / (1.0 + dot(a, vec3(0.333)));
  float wb = 1.0 / (1.0 + dot(b, vec3(0.333)));
  float wc = 1.0 / (1.0 + dot(c, vec3(0.333)));
  float wd = 1.0 / (1.0 + dot(d, vec3(0.333)));
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  gl_FragColor = vec4(col, 1.0);
}`;

export class BloomThresholdMaterial extends ShaderMaterial {
  constructor() {
    super({
      name: 'BloomThresholdMaterial',
      uniforms: {
        inputBuffer: new Uniform(null),
        depthBuffer: new Uniform(null),
        texelSize: new Uniform(new Vector2(1, 1)),
        thr: new Uniform(new Vector4(1, 0.5, 24, 4)),
        useDepth: new Uniform(0),
      },
      vertexShader: vert,
      fragmentShader: frag,
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
    });
  }
  set inputBuffer(v) { this.uniforms.inputBuffer.value = v; if (v && v.image) this.uniforms.texelSize.value.set(1 / v.image.width, 1 / v.image.height); }
  get inputBuffer() { return this.uniforms.inputBuffer.value; }
}

/** BloomEffect (ADD blend, HDR) whose luminance stage is replaced with the sky-aware threshold above. */
export function makeBloom({ levels = 7, radius = 0.82, intensity = 0.35, resolutionScale = 0.5 } = {}) {
  const bloom = new BloomEffect({ blendFunction: BlendFunction.ADD, mipmapBlur: true, intensity, radius, levels, luminanceThreshold: 1, luminanceSmoothing: 0.1 });
  const mat = new BloomThresholdMaterial();
  const lp = new LuminancePass({ colorOutput: true, resolutionScale });
  lp.fullscreenMaterial = mat;
  bloom.luminancePass.dispose();
  bloom.luminancePass = lp;
  bloom.thresholdMaterial = mat;
  return bloom;
}

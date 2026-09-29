// FinalEffect: the last pass, runs at OUTPUT resolution on the (possibly lower-res) display-referred image.
//  - contrast-adaptive sharpen (also makes the resolutionScale < 1 upscale crisp)
//  - vignette, red damage vignette + heartbeat, hit flash
//  - procedural radial speed lines (boost)
//  - film grain + triangular dither
// Input/output are sRGB-encoded (see GradeEffect); the pass has encodeOutput=false.
import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Vector4 } from 'three';

const frag = /* glsl */`
uniform vec4 fxA;   // x: sharpen 0..1, y: vignette amount, z: damage 0..1, w: hit flash 0..1
uniform vec4 fxB;   // x: speed lines 0..1, y: grain amount, z: dither on/off, w: frame seed
uniform vec4 fxC;   // x: lines centre x (uv), y: lines centre y, z: slowmo 0..1, w: time (s)

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float l1(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash11(float p) {
  p = fract(p * 0.1031); p *= p + 33.33; p *= p + p;
  return fract(p);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  const vec3 W = vec3(0.2126, 0.7152, 0.0722);

  #ifdef SHARPEN
  if (fxA.x > 0.001) {
    vec3 b = textureLod(inputBuffer, uv + vec2(0.0, texelSize.y), 0.0).rgb;
    vec3 d = textureLod(inputBuffer, uv - vec2(texelSize.x, 0.0), 0.0).rgb;
    vec3 f = textureLod(inputBuffer, uv + vec2(texelSize.x, 0.0), 0.0).rgb;
    vec3 h = textureLod(inputBuffer, uv - vec2(0.0, texelSize.y), 0.0).rgb;
    vec3 mn = min(min(min(d, f), min(b, h)), c);
    vec3 mx = max(max(max(d, f), max(b, h)), c);
    vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-3)), 0.0, 1.0));
    float peak = -1.0 / mix(8.0, 4.5, fxA.x);
    vec3 w = amp * peak;
    c = ((b + d + f + h) * w + c) / (1.0 + 4.0 * w);
    c = clamp(c, 0.0, 1.0);
  }
  #endif

  vec2 asp = vec2(aspect, 1.0);
  vec2 q = (uv - 0.5) * asp;
  float vr = length(q * vec2(0.82, 1.0)) * 1.55;
  float vmask = smoothstep(0.32, 1.12, vr);

  // vignette (gamma-space multiply)
  c *= 1.0 - fxA.y * vmask * vmask;

  // damage: red edge, pulsing like a heartbeat when low (mask is equal on all four screen edges)
  float vd = length((uv - 0.5) * 2.0);
  float dmask = smoothstep(0.62, 1.42, vd);
  float dmg = fxA.z;
  if (dmg > 0.001) {
    float beat = 0.75 + 0.25 * pow(max(0.0, sin(fxC.w * (3.2 + dmg * 3.5))), 6.0);
    float e = dmg * dmask * dmask * beat;
    c *= 1.0 - 0.3 * dmg * dmask;
    c = mix(c, vec3(0.6, 0.02, 0.015) * (0.35 + l1(c)), clamp(e * 0.95, 0.0, 0.75));
  }
  // hit flash: quick red edge kick
  if (fxA.w > 0.001) {
    float hf = fxA.w;
    c += vec3(0.55, 0.05, 0.03) * hf * (0.06 + 0.94 * dmask * dmask) * 0.6;
    c = mix(c, vec3(dot(c, W)), hf * 0.2);
  }
  // slow-mo: cool, slightly darker edges
  if (fxC.z > 0.001) {
    c *= 1.0 - 0.18 * fxC.z * vmask;
    c = mix(c, c * vec3(0.9, 0.97, 1.1), fxC.z * 0.6);
  }

  // speed lines: thin tapered streaks in the outer ring only, low opacity
  #ifdef LINES
  if (fxB.x > 0.001) {
    vec2 p = (uv - fxC.xy) * asp;
    float r = length(p);
    float a = atan(p.y, p.x) / 6.2831853 + 0.5;
    const float N = 150.0;
    float ac = a * N;
    float cell = floor(ac);
    float fa = fract(ac) - 0.5;
    float tick = floor(fxC.w * 12.0);
    float h1 = hash11(cell * 1.71 + tick * 13.7);
    float h2 = hash11(cell * 3.13 + 7.0);
    float h3 = hash11(cell * 5.29 + tick * 3.1 + 2.0);
    float vis = step(1.0 - (0.12 + 0.3 * fxB.x), h1);
    float r0 = mix(0.42, 0.66, h3);
    float t = clamp((r - r0) / 0.42, 0.0, 1.0);
    float width = mix(0.04, 0.16, h2) * t;
    float aa = fwidth(ac) + 1e-4;
    float line = 1.0 - smoothstep(width - aa, width + aa, abs(fa));
    float I = line * vis * t * t * fxB.x * 0.32;
    c = mix(c, vec3(1.0, 0.97, 0.9), clamp(I, 0.0, 0.4));
  }
  #endif

  // grain + dither (output res)
  vec2 fc = gl_FragCoord.xy;
  float seed = fxB.w;
  float g = hash12(fc + seed * vec2(37.0, 17.0)) - 0.5;
  float lum = dot(c, W);
  c += g * fxB.y * (0.55 + 0.45 * (1.0 - lum)) * (1.0 - 0.6 * smoothstep(0.7, 1.0, lum));
  if (fxB.z > 0.5) {
    float n = hash12(fc * 1.13 + seed * vec2(11.0, 29.0)) + hash12(fc.yx * 0.87 + seed * vec2(53.0, 7.0)) - 1.0;
    c += n / 255.0;
  }
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

export class FinalEffect extends Effect {
  constructor({ sharpen = true, lines = true } = {}) {
    super('FinalEffect', frag, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['fxA', new Uniform(new Vector4(0.25, 0.25, 0, 0))],
        ['fxB', new Uniform(new Vector4(0, 0.03, 1, 0))],
        ['fxC', new Uniform(new Vector4(0.5, 0.52, 0, 0))],
      ]),
      defines: new Map([['SHARPEN', '1'], ['LINES', '1']]),
    });
    this._sharpen = true; this._lines = true;
    this.setSharpenEnabled(sharpen); this.setLinesEnabled(lines);
  }

  setSharpenEnabled(on) {
    if (on === this._sharpen) return;
    this._sharpen = on;
    if (on) this.defines.set('SHARPEN', '1'); else this.defines.delete('SHARPEN');
    this.setChanged();
  }

  setLinesEnabled(on) {
    if (on === this._lines) return;
    this._lines = on;
    if (on) this.defines.set('LINES', '1'); else this.defines.delete('LINES');
    this.setChanged();
  }
}

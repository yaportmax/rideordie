// GradeEffect: exposure + ACES / AgX tone mapping + LUT-less colour grade (contrast S-curve, split-toning with warm
// highlights / teal shadows, lift-gamma-gain, saturation, night blue shift). Input is linear HDR, output is sRGB
// *encoded* (gamma) display colour: everything after this effect (SMAA, sharpen, grain, dither) works in perceptual space,
// and the passes are configured with encodeOutput=false so there is no double encoding.
import { Effect } from 'postprocessing';
import { Uniform, Vector3, Vector4 } from 'three';

const frag = /* glsl */`
uniform float exposure;
uniform vec4 gradeA;     // x: contrast (S-curve amount), y: saturation, z: night 0..1, w: desaturate extra (damage/slowmo)
uniform vec3 shadowTint; // added to shadows in gamma space
uniform vec3 highTint;   // multiplied into highlights
uniform vec3 lift;
uniform vec3 gammaP;
uniform vec3 gainP;
uniform vec3 nightMul;

vec3 acesFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 tmACES(vec3 c) {
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= exposure / 0.6;
  c = inM * c; c = acesFit(c); c = outM * c;
  return clamp(c, 0.0, 1.0);
}
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 tmAgX(vec3 c) {
  const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 fromRec2020 = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  c *= exposure;
  c = toRec2020 * c; c = inset * c;
  c = max(c, 1e-10); c = log2(c);
  c = (c + 12.47393) / (4.026069 + 12.47393);
  c = clamp(c, 0.0, 1.0);
  c = agxContrast(c);
  c = outset * c;
  c = pow(max(vec3(0.0), c), vec3(2.2));
  c = fromRec2020 * c;
  return clamp(c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, vec3(0.0));
  #ifdef TM_AGX
    c = tmAgX(c);
  #else
    c = tmACES(c);
  #endif
  c = toSRGB(c);
  const vec3 W = vec3(0.2126, 0.7152, 0.0722);
  // contrast: smooth S-curve in gamma space (stays inside 0..1)
  vec3 s = c * c * (3.0 - 2.0 * c);
  c = mix(c, s, gradeA.x);
  // split toning: teal shadows, warm highlights
  float l = dot(c, W);
  float sh = 1.0 - smoothstep(0.0, 0.55, l);
  float hi = smoothstep(0.35, 1.0, l);
  c += shadowTint * sh;
  c *= mix(vec3(1.0), highTint, hi);
  // lift / gamma / gain
  c = pow(max(c * gainP + lift, vec3(0.0)), 1.0 / gammaP);
  // night: cool the image, keep luminance
  float n = gradeA.z;
  if (n > 0.001) {
    float l0 = dot(c, W);
    vec3 nc = c * nightMul;
    nc *= l0 / max(dot(nc, W), 1e-3);
    c = mix(c, nc, n);
    c += vec3(-0.004, 0.004, 0.022) * n * sh;
  }
  // saturation (+ damage / slow-mo desaturation)
  l = dot(c, W);
  c = mix(vec3(l), c, gradeA.y * (1.0 - gradeA.w));
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

export class GradeEffect extends Effect {
  constructor({ tonemap = 'aces' } = {}) {
    super('GradeEffect', frag, {
      uniforms: new Map([
        ['exposure', new Uniform(1)],
        ['gradeA', new Uniform(new Vector4(0.22, 1.1, 0, 0))],
        ['shadowTint', new Uniform(new Vector3(-0.012, 0.006, 0.02))],
        ['highTint', new Uniform(new Vector3(1.07, 1.0, 0.9))],
        ['lift', new Uniform(new Vector3(0.0, 0.0, 0.0))],
        ['gammaP', new Uniform(new Vector3(1, 1, 1))],
        ['gainP', new Uniform(new Vector3(1, 1, 1))],
        ['nightMul', new Uniform(new Vector3(0.78, 0.93, 1.3))],
      ]),
    });
    this.tonemap = '';
    this.setTonemap(tonemap);
  }

  setTonemap(name) {
    if (name === this.tonemap) return;
    this.tonemap = name;
    if (name === 'agx') this.defines.set('TM_AGX', '1'); else this.defines.delete('TM_AGX');
    this.setChanged();
  }
}

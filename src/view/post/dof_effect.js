// DofEffect: cheap depth-of-field for the garage / menu (HDR, before bloom so highlights become bokeh).
// Scatter-as-gather with a golden-angle disc; samples are weighted by their own circle of confusion so a sharp car
// never bleeds into the blurred background. Only runs when params.dof > 0 (the pass is disabled otherwise).
import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Vector4 } from 'three';

const frag = /* glsl */`
uniform vec4 dofP;    // x: max CoC radius (px), y: focus distance (m), z: focus range (m, fully sharp), w: near-blur scale

float cocPx(float z) {
  float dz = abs(z - dofP.y) - dofP.z;
  if (dz <= 0.0) return 0.0;
  float farK = z > dofP.y ? 1.0 : dofP.w;
  return dofP.x * clamp(dz / z * (dofP.y * 0.35 + 1.0), 0.0, 1.0) * farK;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (dofP.x <= 0.05) { outputColor = inputColor; return; }
  float z0 = -getViewZ(readDepth(uv));
  float c0 = cocPx(z0);
  vec2 px = 1.0 / resolution;
  // gather radius: own CoC (background) - sharp pixels next to blurred ones still gather a little via weights below
  float rad = max(c0, 0.0);
  vec3 acc = inputColor.rgb;
  float wsum = 1.0;
  float ang = 0.0;
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  if (rad > 0.4) {
    for (int i = 1; i <= DOF_TAPS; i++) {
      float fi = float(i);
      float r = sqrt(fi / float(DOF_TAPS)) * rad;
      float a = fi * 2.39996323 + jit;
      vec2 suv = uv + vec2(cos(a), sin(a)) * r * px;
      vec3 c = texture2D(inputBuffer, suv).rgb;
      float zs = -getViewZ(readDepth(suv));
      float cs = cocPx(zs);
      // a sample only contributes if its own CoC reaches this pixel, or if it is behind us (background never occludes)
      float reach = smoothstep(r - 1.0, r + 1.5, cs);
      float behind = zs > z0 + 0.5 ? 1.0 : 0.0;
      float w = mix(reach, 1.0, behind * step(0.5, c0));
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      w *= 1.0 + min(lum, 12.0) * 0.35;   // bokeh highlights pop
      acc += c * w; wsum += w;
    }
    outputColor = vec4(acc / wsum, inputColor.a);
  } else {
    // in-focus pixel: soft-gather from nearby blurred FOREGROUND only (near blur over sharp background)
    outputColor = inputColor;
  }
}
`;

export class DofEffect extends Effect {
  constructor({ taps = 24 } = {}) {
    super('DofEffect', frag, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map([['dofP', new Uniform(new Vector4(0, 8, 1.5, 0.6))]]),
      defines: new Map([['DOF_TAPS', String(taps)]]),
    });
    this.taps = taps;
  }

  setTaps(n) {
    n = Math.max(4, n | 0);
    if (n === this.taps) return;
    this.taps = n; this.defines.set('DOF_TAPS', String(n)); this.setChanged();
  }
}

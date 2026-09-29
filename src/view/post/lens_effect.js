// LensEffect: camera motion blur (depth reprojection) + edge-weighted chromatic aberration + up to 4 shockwave
// refraction rings, all in ONE shader so the scene colour is fetched once per tap (HDR, before bloom/tone map).
//
// Motion blur: world position is rebuilt from the depth buffer and re-projected with the previous frame's
// view-projection (`reproj = prevVP * inverse(curVP)`, composed on the CPU in double precision). Camera motion only,
// so it is faded near the camera (player car / close enemies move with the camera and must stay sharp), masked in an
// ellipse around the player's car and clamped in length so nothing smears into an unreadable mess.
import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Matrix4, Vector2, Vector4 } from 'three';

const frag = /* glsl */`
uniform mat4 reproj;
uniform float mbAmount;      // (frame-rate normalised) shutter * strength; 0 = off
uniform float mbMaxPx;       // max blur length in pixels
uniform vec4 car;            // xy = centre uv, zw = radii uv (protected ellipse)
uniform float carMask;       // 0..1 how strongly the ellipse suppresses blur
uniform vec3 nearFade;       // x: z0 (m) , y: z1 (m), z: blur factor at z<=z0
uniform float caAmount;      // radial chromatic aberration (uv units at the screen corner ~ 0.01 = 5px)
uniform vec4 shock[4];       // xy centre uv, z radius (height units), w displacement (height units); w<=0 inactive
uniform float shockWidth;    // ring half-thickness relative to radius
uniform float frameSeed;

float ignoise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 asp = vec2(aspect, 1.0);
  vec2 uvc = uv;               // sample centre (after shockwave refraction)
  float shockCA = 0.0;

  #ifdef SHOCK
  for (int k = 0; k < 4; k++) {
    vec4 s = shock[k];
    if (s.w > 0.0) {
      vec2 dv = (uv - s.xy) * asp;
      float d = length(dv);
      float x = (d - s.z) / max(s.z * shockWidth, 0.004);
      float ring = exp(-x * x);
      vec2 dir = dv / max(d, 1e-4);
      // refract: content is pulled towards the ring centre, plus a soft lens bulge inside the ring
      float bulge = exp(-x * x * 0.25) * 0.35;
      vec2 off = dir * (ring + bulge * (1.0 - smoothstep(0.0, s.z, d))) * s.w;
      uvc -= off / asp;
      shockCA += ring * s.w;
    }
  }
  #endif

  vec2 vel = vec2(0.0);
  float blurLen = 0.0;
  #ifdef MOTION_BLUR
  if (mbAmount > 0.0) {
    float depth = readDepth(uv);
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 p = reproj * clip;
    if (p.w > 0.02) {
      vec2 prevUv = p.xy / p.w * 0.5 + 0.5;
      vel = (uv - prevUv);
      // near-camera fade (car + close enemies move WITH the camera; do not smear them)
      float z = -getViewZ(depth);
      float nf = mix(nearFade.z, 1.0, smoothstep(nearFade.x, nearFade.y, z));
      // protect the player's car (soft ellipse)
      vec2 e = (uv - car.xy) / max(car.zw, vec2(1e-3));
      float m = 1.0 - carMask * (1.0 - smoothstep(0.55, 1.0, length(e)));
      vel *= mbAmount * nf * m;
      vec2 px = vel * resolution;
      float l = length(px);
      if (l > mbMaxPx) vel *= mbMaxPx / l;
      blurLen = length(vel * resolution);
    }
  }
  #endif

  vec2 cdir = (uvc - 0.5);
  float rr = length(cdir * asp);
  float caW = smoothstep(0.12, 0.85, rr);
  vec2 caOff = cdir * (caAmount * caW * caW * 1.6 + shockCA * 0.6);
  bool useCA = (caAmount > 0.0002) || (shockCA > 0.0002);

  #ifdef MOTION_BLUR
  if (blurLen > 0.75) {
    float jit = ignoise(gl_FragCoord.xy + frameSeed) - 0.5;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < MB_TAPS; i++) {
      float t = (float(i) + 0.5 + jit) / float(MB_TAPS) - 0.5;    // -0.5 .. 0.5
      float w = 1.0 - abs(t) * 0.9;                                  // gentle tent keeps the centre crisp
      vec2 suv = uvc + vel * t;
      vec3 c;
      if (useCA) {
        c = vec3(texture2D(inputBuffer, suv + caOff).r, texture2D(inputBuffer, suv).g, texture2D(inputBuffer, suv - caOff).b);
      } else {
        c = texture2D(inputBuffer, suv).rgb;
      }
      acc += c * w; wsum += w;
    }
    outputColor = vec4(acc / wsum, inputColor.a);
    return;
  }
  #endif

  if (useCA) {
    outputColor = vec4(texture2D(inputBuffer, uvc + caOff).r, texture2D(inputBuffer, uvc).g, texture2D(inputBuffer, uvc - caOff).b, inputColor.a);
  } else if (uvc != uv) {
    outputColor = texture2D(inputBuffer, uvc);
  } else {
    outputColor = inputColor;
  }
}
`;

export class LensEffect extends Effect {
  constructor({ mbTaps = 10 } = {}) {
    super('LensEffect', frag, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map([
        ['reproj', new Uniform(new Matrix4())],
        ['mbAmount', new Uniform(0)],
        ['mbMaxPx', new Uniform(24)],
        ['car', new Uniform(new Vector4(0.5, 0.3, 0.2, 0.25))],
        ['carMask', new Uniform(0.75)],
        ['nearFade', new Uniform(new Vector4(6, 45, 0.3, 0))],
        ['caAmount', new Uniform(0)],
        ['shock', new Uniform([new Vector4(), new Vector4(), new Vector4(), new Vector4()])],
        ['shockWidth', new Uniform(0.16)],
        ['frameSeed', new Uniform(0)],
      ]),
      defines: new Map([['SHOCK', '1']]),
    });
    this.mbTaps = 0;
    this.setMotionBlurTaps(mbTaps);
    this._res = new Vector2();
  }

  /** Number of blur taps (0 disables motion blur code entirely). Triggers a shader recompile when it changes. */
  setMotionBlurTaps(n) {
    n = Math.max(0, n | 0);
    if (n === this.mbTaps) return;
    this.mbTaps = n;
    if (n > 0) { this.defines.set('MOTION_BLUR', '1'); this.defines.set('MB_TAPS', String(n)); }
    else { this.defines.delete('MOTION_BLUR'); this.defines.set('MB_TAPS', '1'); }
    this.setChanged();
  }

  setShockEnabled(on) {
    if (on === this.defines.has('SHOCK')) return;
    if (on) this.defines.set('SHOCK', '1'); else this.defines.delete('SHOCK');
    this.setChanged();
  }
}

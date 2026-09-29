// Sun shafts ("god rays"), screen space, quarter resolution, ~0.1 ms:
//  ShaftsPass  - marches from every pixel toward the sun's screen position over the DEPTH buffer: sky pixels inside a soft
//                disc around the sun are the light source, anything in front of the sky (ridges, trees, the boss) occludes
//                it => light streaks through gaps. Skipped entirely when the sun is not in view.
//  ShaftsEffect - adds the result (tinted with the sun colour) to the HDR image inside the main effect pass, before bloom/tone map.
import { Pass, Effect } from 'postprocessing';
import { ShaderMaterial, Uniform, Vector2, Vector3, Vector4, WebGLRenderTarget, HalfFloatType, LinearFilter, NoBlending } from 'three';

const N_TAPS = 40;

const vert = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const frag = /* glsl */`
precision highp float;
uniform sampler2D depthBuffer;
uniform vec2 sunUv;     // sun position in uv (may lie off-screen)
uniform vec4 prm;       // x: aspect, y: source radius (screen heights), z: decay per tap, w: march length (fraction of the way to the sun)
uniform float seed;
varying vec2 vUv;
float src(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  if (texture2D(depthBuffer, uv).r < 0.9999999) return 0.0;   // occluded (not sky)
  vec2 o = (uv - sunUv) * vec2(prm.x, 1.0) / prm.y;
  return exp(-dot(o, o) * 2.5);
}
void main() {
  vec2 d = (sunUv - vUv) * (prm.w / float(${N_TAPS}));
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy + seed, vec2(0.06711056, 0.00583715))));
  vec2 uv = vUv + d * jit;
  float w = 1.0, acc = 0.0, wsum = 0.0;
  for (int i = 0; i < ${N_TAPS}; i++) { acc += src(uv) * w; wsum += w; w *= prm.z; uv += d; }
  // rays live around the sun: fade with screen distance so the whole frame never washes out
  vec2 r = (vUv - sunUv) * vec2(prm.x, 1.0);
  gl_FragColor = vec4(acc / wsum / (1.0 + 5.0 * dot(r, r)), 0.0, 0.0, 1.0);
}`;

export class ShaftsPass extends Pass {
  constructor() {
    super('ShaftsPass');
    this.needsSwap = false;
    this.fullscreenMaterial = new ShaderMaterial({
      name: 'ShaftsMaterial', vertexShader: vert, fragmentShader: frag, blending: NoBlending, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { depthBuffer: new Uniform(null), sunUv: new Uniform(new Vector2(0.5, 0.5)), prm: new Uniform(new Vector4(1.78, 0.3, 0.965, 0.95)), seed: new Uniform(0) },
    });
    this.rt = new WebGLRenderTarget(4, 4, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, generateMipmaps: false });
    this.rt.texture.name = 'Shafts';
    this.active = false;
    this.getDepth = () => null;
  }
  get texture() { return this.rt.texture; }
  render(renderer) {
    if (!this.active) return;
    const u = this.fullscreenMaterial.uniforms;
    u.depthBuffer.value = this.getDepth();
    if (!u.depthBuffer.value) return;
    u.seed.value = (u.seed.value + 7.31) % 97;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.camera);
  }
  setSize(w, h) { this.rt.setSize(Math.max(4, Math.round(w / 4)), Math.max(4, Math.round(h / 4))); this.fullscreenMaterial.uniforms.prm.value.x = w / Math.max(1, h); }
  dispose() { super.dispose(); this.rt.dispose(); }
}

const efrag = /* glsl */`
uniform sampler2D shaftTex;
uniform vec3 shaftCol;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb + texture2D(shaftTex, uv).r * shaftCol, inputColor.a);
}`;

export class ShaftsEffect extends Effect {
  constructor(tex) {
    super('ShaftsEffect', efrag, { uniforms: new Map([['shaftTex', new Uniform(tex)], ['shaftCol', new Uniform(new Vector3())]]) });
  }
}

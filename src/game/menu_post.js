// MenuPost: a small, fast render pipeline for the front-end 3D stages (title chase + garage).
//   scene -> MSAA x4 half-float target -> bloom (UnrealBloomPass mip chain, added in HDR) -> final pass
//   (exposure, ACES filmic, warm/cool split grade, vignette, letterbox fade, grain + dither) -> canvas.
// Independent of the in-run Post pipeline (which is bound to the run scene/camera) and of renderer.toneMapping state.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = /* glsl */`
precision highp float;
uniform sampler2D tScene;
uniform float uExposure, uVig, uGrain, uTime, uFade, uSat, uAspect;
uniform vec3 uShadowTint, uHighTint;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = IN * (c / 0.6); c = RRTAndODTFit(c); c = OUT * c; return clamp(c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec3 c = texture2D(tScene, vUv).rgb * uExposure;
  vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(d);
  c *= mix(1.0, smoothstep(1.25, 0.35, r), uVig);
  c = aces(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c *= mix(uShadowTint, uHighTint, smoothstep(0.05, 0.7, l));
  c = toSRGB(clamp(c, 0.0, 1.0));
  float n = hash(vUv * vec2(1931.0, 1087.0) + fract(uTime * 7.13)) - 0.5;
  c += n * uGrain + (hash(vUv * 1733.0 + uTime) - 0.5) / 255.0;
  gl_FragColor = vec4(c * (1.0 - uFade), 1.0);
}`;

export class MenuPost {
  constructor(renderer) {
    this.renderer = renderer;
    this.size = new THREE.Vector2(1, 1);
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    this.rt.texture.name = 'menuScene';
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.62, 0.92);
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        tScene: { value: this.rt.texture }, uExposure: { value: 1 }, uVig: { value: 0.55 }, uGrain: { value: 0.035 }, uTime: { value: 0 }, uFade: { value: 0 },
        uSat: { value: 1.05 }, uAspect: { value: 16 / 9 }, uShadowTint: { value: new THREE.Color(0.93, 0.97, 1.06) }, uHighTint: { value: new THREE.Color(1.04, 1.0, 0.94) },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); this.quad.frustumCulled = false;
    this.fsScene = new THREE.Scene(); this.fsScene.add(this.quad);
    this.t = 0;
    this.setSize(innerWidth, innerHeight);
  }
  /** Look parameters: {exposure, bloom:{strength, radius, threshold}, vignette, grain, saturation} */
  setLook(o = {}) {
    const u = this.mat.uniforms;
    if (o.exposure !== undefined) u.uExposure.value = o.exposure;
    if (o.vignette !== undefined) u.uVig.value = o.vignette;
    if (o.grain !== undefined) u.uGrain.value = o.grain;
    if (o.saturation !== undefined) u.uSat.value = o.saturation;
    if (o.bloom) { const b = this.bloom; if (o.bloom.strength !== undefined) b.strength = o.bloom.strength; if (o.bloom.radius !== undefined) b.radius = o.bloom.radius; if (o.bloom.threshold !== undefined) b.threshold = o.bloom.threshold; }
  }
  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    const W = Math.max(4, Math.floor(w * pr)), H = Math.max(4, Math.floor(h * pr));
    if (W === this.size.x && H === this.size.y) return;
    this.size.set(W, H);
    this.rt.setSize(W, H);
    this.bloom.setSize(W, H);
    this.mat.uniforms.uAspect.value = W / H;
  }
  render(scene, camera, dt = 0.016) {
    const r = this.renderer;
    this.t += dt; this.mat.uniforms.uTime.value = this.t % 100;
    const cw = r.domElement.width, ch = r.domElement.height;
    if (cw !== this.size.x || ch !== this.size.y) { this.size.set(-1, -1); this.setSize(cw / r.getPixelRatio(), ch / r.getPixelRatio()); }
    const prevTM = r.toneMapping, prevAC = r.autoClear, prevExp = r.toneMappingExposure;
    r.toneMapping = THREE.NoToneMapping; r.autoClear = true; r.toneMappingExposure = 1;
    r.setRenderTarget(this.rt); r.clear(); r.render(scene, camera);
    if (this.bloom.strength > 0.001) this.bloom.render(r, null, this.rt, dt, false);
    r.setRenderTarget(null); r.render(this.fsScene, this.fsCam);
    r.toneMapping = prevTM; r.autoClear = prevAC; r.toneMappingExposure = prevExp;
  }
  /** Compile the pipeline's own programs (call once while loading). */
  warm(scene, camera) { const r = this.renderer; try { r.setRenderTarget(this.rt); r.compile(scene, camera); r.setRenderTarget(null); r.compile(this.fsScene, this.fsCam); } catch { /* ignore */ } }
}

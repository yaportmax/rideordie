// TaaPass (optional, experimental): temporal anti-aliasing on the HDR image, before motion blur / bloom / tone map.
//  - the camera projection is jittered with a Halton(2,3) sequence (Post does that around composer.render),
//  - the history is re-projected with the camera-only reprojection matrix (depth based; the nearest depth of the 3x3
//    neighbourhood is used so object edges follow the closer surface),
//  - history is clipped to the variance AABB of the current 3x3 neighbourhood in YCoCg (tone-mapped space) which
//    removes ghosting from anything that moves independently of the camera (enemy cars, particles, tracers), at the
//    price of those objects only getting the spatial part of the AA,
//  - the blend factor rises with screen-space velocity and when the history is off-screen / after a cut.
import { Pass } from 'postprocessing';
import { ShaderMaterial, Uniform, Matrix4, Vector2, WebGLRenderTarget, HalfFloatType, LinearFilter, NoBlending, Mesh, Scene, BufferGeometry, Float32BufferAttribute, OrthographicCamera, NoColorSpace } from 'three';

const vert = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const frag = /* glsl */`
precision highp float;
uniform sampler2D tCur;
uniform sampler2D tHist;
uniform sampler2D tDepth;
uniform mat4 reproj;
uniform vec2 texel;
uniform float reset;      // 1 = ignore history
uniform float feedback;   // base history weight (0.9 = 10% new frame)
varying vec2 vUv;

vec3 toTm(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 fromTm(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
vec3 rgb2ycc(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 ycc2rgb(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }

vec3 clipAABB(vec3 mn, vec3 mx, vec3 center, vec3 q) {
  vec3 ext = 0.5 * (mx - mn) + 1e-4;
  vec3 v = q - center;
  vec3 a = abs(v / ext);
  float m = max(a.x, max(a.y, a.z));
  return m > 1.0 ? center + v / m : q;
}

// Catmull-Rom (9 -> 5 taps) history sampling keeps the accumulated image sharp
vec3 sampleHist(vec2 uv) {
  vec2 pos = uv / texel;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 p0 = (c - 1.0) * texel, p3 = (c + 2.0) * texel, p12 = (c + o12) * texel;
  vec3 r = vec3(0.0);
  r += texture2D(tHist, vec2(p12.x, p0.y)).rgb * (w12.x * w0.y);
  r += texture2D(tHist, vec2(p0.x, p12.y)).rgb * (w0.x * w12.y);
  r += texture2D(tHist, vec2(p12.x, p12.y)).rgb * (w12.x * w12.y);
  r += texture2D(tHist, vec2(p3.x, p12.y)).rgb * (w3.x * w12.y);
  r += texture2D(tHist, vec2(p12.x, p3.y)).rgb * (w12.x * w3.y);
  return max(r, vec3(0.0));
}

void main() {
  vec2 uv = vUv;
  vec3 cur = texture2D(tCur, uv).rgb;
  // 3x3 colour statistics + nearest depth
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  float dMin = 1.0; vec2 dUv = uv;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)) * texel;
    vec3 s = rgb2ycc(toTm(texture2D(tCur, uv + o).rgb));
    m1 += s; m2 += s * s;
    float d = texture2D(tDepth, uv + o).r;
    if (d < dMin) { dMin = d; dUv = uv + o; }
  }
  m1 /= 9.0; m2 /= 9.0;
  vec3 sigma = sqrt(max(m2 - m1 * m1, vec3(0.0)));
  vec3 curT = rgb2ycc(toTm(cur));

  vec4 p = reproj * vec4(dUv * 2.0 - 1.0, dMin * 2.0 - 1.0, 1.0);
  vec2 puv = p.xy / max(p.w, 1e-4) * 0.5 + 0.5;
  bool valid = reset < 0.5 && p.w > 0.02 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)));
  if (!valid) { gl_FragColor = vec4(cur, 1.0); return; }

  vec3 hist = rgb2ycc(toTm(sampleHist(puv)));
  vec3 gam = vec3(1.2, 1.0, 1.0);
  vec3 mn = m1 - sigma * gam - 0.002, mx = m1 + sigma * gam + 0.002;
  vec3 clipped = clipAABB(mn, mx, m1, hist);
  float clipAmt = clamp(length(hist - clipped) * 8.0, 0.0, 1.0);
  float velPx = length((uv - puv) / texel);
  float fb = feedback * (1.0 - 0.45 * clamp(velPx / 6.0, 0.0, 1.0)) * (1.0 - 0.6 * clipAmt);
  vec3 outT = mix(curT, clipped, fb);
  gl_FragColor = vec4(fromTm(ycc2rgb(outT)), 1.0);
}`;

const copyFrag = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }`;

export class TaaPass extends Pass {
  constructor(type = HalfFloatType) {
    super('TaaPass');
    this.needsSwap = true;
    this.needsDepthTexture = true;
    this.depthTexture = null;
    this.type = type;
    this.feedback = 0.9;
    this.reset = true;
    this.reproj = new Matrix4();
    this.material = new ShaderMaterial({
      uniforms: {
        tCur: new Uniform(null), tHist: new Uniform(null), tDepth: new Uniform(null),
        reproj: new Uniform(this.reproj), texel: new Uniform(new Vector2(1, 1)), reset: new Uniform(1), feedback: new Uniform(0.9),
      },
      vertexShader: vert, fragmentShader: frag, blending: NoBlending, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.fullscreenMaterial = this.material;
    // second quad: copy the resolved frame into the history target
    this.copyMat = new ShaderMaterial({ uniforms: { tSrc: new Uniform(null) }, vertexShader: vert, fragmentShader: copyFrag, blending: NoBlending, depthTest: false, depthWrite: false, toneMapped: false });
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.copyMesh = new Mesh(g, this.copyMat); this.copyMesh.frustumCulled = false;
    this.copyScene = new Scene(); this.copyScene.add(this.copyMesh);
    this.copyCam = new OrthographicCamera();
    this.history = new WebGLRenderTarget(1, 1, { type, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false });
    this.history.texture.colorSpace = NoColorSpace;
  }

  getDepthTexture() { return this.depthTexture; }
  setDepthTexture(t) { this.depthTexture = t; }

  setSize(w, h) {
    this.history.setSize(w, h);
    this.material.uniforms.texel.value.set(1 / w, 1 / h);
    this.reset = true;
  }

  render(renderer, inputBuffer, outputBuffer) {
    const u = this.material.uniforms;
    u.tCur.value = inputBuffer.texture; u.tHist.value = this.history.texture; u.tDepth.value = this.depthTexture;
    u.reset.value = this.reset ? 1 : 0; u.feedback.value = this.feedback;
    renderer.setRenderTarget(outputBuffer);
    renderer.render(this.scene, this.camera);
    this.copyMat.uniforms.tSrc.value = outputBuffer.texture;
    renderer.setRenderTarget(this.history);
    renderer.render(this.copyScene, this.copyCam);
    this.reset = false;
  }

  dispose() {
    this.history.dispose(); this.material.dispose(); this.copyMat.dispose(); this.copyMesh.geometry.dispose();
  }
}

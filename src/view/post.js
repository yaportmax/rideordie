// RIDE OR DIE post-processing pipeline (pmndrs `postprocessing` + `n8ao`).
//
//   scene (HDR half-float, MSAA 4x at quality>=2, private target + resolve blit)
//     -> N8AO ambient occlusion (half-res, quality gated)
//     -> [depth of field]   (garage/menu only, params.dof > 0)
//     -> LensEffect (camera motion blur by depth reprojection + edge chromatic aberration + shockwave refraction)
//        + sky-aware selective bloom (ADD, HDR) + exposure/ACES(AgX) tone map + LUT-less grade  -> sRGB-encoded
//     -> SMAA (on the display-referred image)
//     -> FinalEffect (contrast-adaptive sharpen / upscale, vignette, damage vignette, speed lines, grain, dither) -> screen
//
// Integration (main.js):
//   const renderer = createRenderer({ antialias: false });           // Post does the AA; a MSAA backbuffer is wasted work
//   const post = new Post(renderer, scene, camera, { quality: 2 });  // quality 0..3, resolutionScale 0.5..1, tonemap 'aces'|'agx', taa:false
//   resize:  post.setSize(innerWidth, innerHeight)                   // replaces renderer.setSize (it calls it for you)
//   frame:   sky.update(...); chase.update(...);                     // camera final first, then
//            post.setParams({ speed01: v/vmax, boost: boosting ? 1 : 0, damage01: 1 - hp01, night01: look.night,
//                             dof: inGarage ? 1 : 0, slowmo, anchor: playerView.root });   // hitFlash is an impulse (0..1)
//            post.render(realDt);                                     // replaces renderer.render(scene, camera); use the REAL frame dt
//   events:  'explode'/'boom' -> post.shockwave(pos, size); player hit -> post.hit(1); camera teleport/respawn -> post.cut()
//   settings: post.setQuality(q); post.setResolutionScale(s); post.setFeatures({ mb:false, ca:false, ... }); post.cfg (look tuning)
//   others:  post.depthTexture (float scene depth; valid after the scene pass, i.e. 1 frame old when sampled from scene materials),
//            post.stats {calls, triangles} of the scene pass (renderer.info is overwritten by the fullscreen passes),
//            post.profile(true) -> post.timings (Map pass -> GPU ms), post.enabled=false bypasses everything.
//
// Tone mapping is done inside the composer: renderer.toneMapping is forced to NoToneMapping while Post is active
// (renderer.toneMappingExposure, set by SkyRig, is still honoured) and restored on dispose()/enabled=false.
import * as THREE from 'three';
import { EffectComposer, EffectPass, Effect, SMAAEffect, SMAAPreset, EdgeDetectionMode } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { LensEffect } from './post/lens_effect.js';
import { DofEffect } from './post/dof_effect.js';
import { GradeEffect } from './post/grade_effect.js';
import { FinalEffect } from './post/final_effect.js';
import { makeBloom } from './post/bloom_threshold.js';
import { ScenePass } from './post/scene_pass.js';
import { TaaPass } from './post/taa_pass.js';
import { GpuTimer } from './post/gpu_timer.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

/** Quality presets. */
export const POST_PRESETS = [
  // 0: low - no AO, MSAA off, lite bloom, no motion blur, SMAA low
  { msaa: 0, ao: null, bloomLevels: 5, bloomScale: 0.5, mbTaps: 0, dofTaps: 12, smaa: SMAAPreset.LOW, smaaMode: EdgeDetectionMode.LUMA, sharpen: 0.25 },
  // 1: medium - half-res AO (fast), MSAA off, light motion blur
  { msaa: 0, ao: 'Performance', bloomLevels: 6, bloomScale: 0.5, mbTaps: 6, dofTaps: 16, smaa: SMAAPreset.MEDIUM, smaaMode: EdgeDetectionMode.LUMA, sharpen: 0.3 },
  // 2: high (default) - MSAA 4x, half-res AO, full motion blur
  { msaa: 4, ao: 'Medium', bloomLevels: 7, bloomScale: 0.5, mbTaps: 10, dofTaps: 24, smaa: SMAAPreset.MEDIUM, smaaMode: EdgeDetectionMode.COLOR, sharpen: 0.3 },
  // 3: ultra - MSAA 4x, better AO denoise, more taps, SMAA ultra
  { msaa: 4, ao: 'High', bloomLevels: 8, bloomScale: 0.5, mbTaps: 16, dofTaps: 40, smaa: SMAAPreset.ULTRA, smaaMode: EdgeDetectionMode.COLOR, sharpen: 0.3 },
];

/** Default look / tuning. Everything here can be edited live through `post.cfg` (it is re-applied every frame). */
export function defaultPostConfig() {
  return {
    exposure: 1.0,                 // multiplier on renderer.toneMappingExposure
    tonemap: 'aces',               // 'aces' | 'agx'
    bloom: { intensity: 0.55, threshold: 1.6, knee: 0.7, radius: 0.8, clamp: 20, skyMul: 8 },
    ao: { radius: 3.0, intensity: 4.2, falloff: 1.0, color: 0x231a14 },
    mb: { strength: 1.0, shutter: 0.5, maxFrac: 0.03, carMask: 0.75, nearZ0: 7, nearZ1: 45, nearMin: 0.3 },
    ca: { base: 0.0012, speed: 0.0045, boost: 0.005, hit: 0.011, slowmo: 0.002 },
    vignette: { base: 0.2, speed: 0.1, boost: 0.1, slowmo: 0.1 },
    grain: 0.03,
    lines: 1.0,
    sharpen: 0.3,
    grade: {
      contrast: 0.22, saturation: 1.1,
      shadowTint: [-0.012, 0.006, 0.02], highTint: [1.06, 1.0, 0.92],
      lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], nightMul: [0.86, 0.96, 1.18],
    },
    dof: { bokeh: 14, focus: 7, range: 1.5, near: 0.6 },
  };
}

/** EffectPass with optional per-effect GPU timing (used by Post.profile). */
class ProfEffectPass extends EffectPass {
  constructor(camera, label, ...effects) {
    super(camera, ...effects);
    this.label = label; this.timer = null;
  }

  render(renderer, inputBuffer, outputBuffer, deltaTime) {
    const t = this.timer;
    for (const effect of this.effects) {
      const timed = t && effect.update !== Effect.prototype.update;
      if (timed) t.begin(`${this.label}.${effect.name.replace('Effect', '')}`);
      effect.update(renderer, inputBuffer, deltaTime);
      if (timed) t.end();
    }
    if (!this.skipRendering || this.renderToScreen) {
      const material = this.fullscreenMaterial;
      material.inputBuffer = inputBuffer.texture;
      material.time += deltaTime * this.timeScale;
      renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
      if (t) t.begin(this.label);
      renderer.render(this.scene, this.camera);
      if (t) t.end();
    }
  }
}

const _v3 = new THREE.Vector3();
const _v2 = new THREE.Vector2();

export class Post {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   * @param {{quality?:number, resolutionScale?:number, tonemap?:'aces'|'agx'}} opts
   */
  constructor(renderer, scene, camera, opts = {}) {
    opts = { quality: 2, resolutionScale: 1, ...opts };
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.cfg = defaultPostConfig();
    if (opts.tonemap) this.cfg.tonemap = opts.tonemap;
    this.feat = { ao: true, bloom: true, mb: true, ca: true, vignette: true, grain: true, lines: true, dof: true, smaa: true, grade: true, sharpen: true };
    this.quality = clamp(Math.round(opts.quality), 0, 3);
    this.resolutionScale = clamp(opts.resolutionScale, 0.5, 1);
    this._enabled = true;
    this._taa = false; this.taaPass = null;
    this.params = { speed01: 0, boost: 0, damage01: 0, night01: 0, dof: 0, hitFlash: 0, slowmo: 0 };
    this._cur = { speed01: 0, boost: 0, damage01: 0, night01: 0, dof: 0, slowmo: 0 };
    this._hit = 0; this._shockPulse = 0;
    this._anchor = null; this.focusObject = null;
    this._frame = 0; this._time = 0; this._clockLast = 0;
    this.stats = { calls: 0, triangles: 0 };
    this.timings = null;
    this._profiling = false; this.timer = null;
    this._saved = { toneMapping: renderer.toneMapping, autoClear: renderer.autoClear };
    this._internal = new THREE.Vector2(1, 1);

    const ext = renderer.extensions;
    this.hdr = opts.hdr !== false && (ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float'));
    this.frameBufferType = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    renderer.toneMapping = THREE.NoToneMapping;

    const P = POST_PRESETS[this.quality];
    this.composer = new EffectComposer(renderer, { frameBufferType: this.frameBufferType, multisampling: 0, depthBuffer: true, stencilBuffer: false });
    if (!this.hdr) {   // LDR fallback: the composer would tag 8-bit buffers as sRGB; we manage encoding ourselves
      for (const b of [this.composer.inputBuffer, this.composer.outputBuffer]) { b.texture.colorSpace = THREE.NoColorSpace; b.dispose(); }
    }
    const cam = camera;

    // 0. scene
    this.scenePass = new ScenePass(scene, cam, { samples: this._safeSamples(P.msaa), type: this.frameBufferType, getDepthTarget: () => this.composer.depthRenderTarget });
    this.composer.addPass(this.scenePass);

    // (1. AO is inserted lazily at index 1)
    this.aoPass = null;

    // 2. DOF (garage / menu)
    this.dofEffect = new DofEffect({ taps: P.dofTaps });
    this.dofPass = new ProfEffectPass(cam, 'dof', this.dofEffect);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

    // 3. lens (MB + CA + shockwave) + bloom + tone/grade
    this.lens = new LensEffect({ mbTaps: P.mbTaps });
    this.bloom = makeBloom({ levels: P.bloomLevels, resolutionScale: P.bloomScale, intensity: this.cfg.bloom.intensity, radius: this.cfg.bloom.radius });
    this.grade = new GradeEffect({ tonemap: this.cfg.tonemap });
    this.mainPass = new ProfEffectPass(cam, 'main', this.lens, this.bloom, this.grade);
    this.composer.addPass(this.mainPass);

    // 4. SMAA on the display-referred image
    this.smaaEffect = new SMAAEffect({ preset: P.smaa, edgeDetectionMode: P.smaaMode });
    this.smaaPass = new ProfEffectPass(cam, 'smaa', this.smaaEffect);
    this.composer.addPass(this.smaaPass);

    // 5. final composite to the screen
    this.finalEffect = new FinalEffect();
    this.finalPass = new ProfEffectPass(cam, 'final', this.finalEffect);
    this.composer.addPass(this.finalPass);

    for (const p of [this.dofPass, this.mainPass, this.smaaPass, this.finalPass]) p.fullscreenMaterial.encodeOutput = false;

    // scene statistics (calls / triangles of the scene pass only)
    const origScene = this.scenePass.render.bind(this.scenePass);
    this.scenePass.render = (...a) => {
      const t = this._profiling ? this.timer : null;
      if (t) t.begin('scene');
      origScene(...a);
      if (t) t.end();
      const r = renderer.info.render; this.stats.calls = r.calls; this.stats.triangles = r.triangles;
    };

    // matrices for reprojection
    this._vp = new THREE.Matrix4(); this._prevVP = new THREE.Matrix4(); this._invVP = new THREE.Matrix4(); this._reproj = new THREE.Matrix4();
    this._prevPos = new THREE.Vector3(); this._haveHistory = false; this._forceCut = false;

    // shockwaves
    this._shocks = Array.from({ length: 4 }, () => ({ on: false, pos: new THREE.Vector3(), age: 0, dur: 0.7, str: 1, R: 24 }));

    this.setQuality(this.quality, true);
    this.setSize();
    if (opts.taa) this.taa = true;
  }

  // ------------------------------------------------------------------ public API

  /** false = bypass (plain renderer.render with the original tone mapping); true = post pipeline. */
  get enabled() { return this._enabled; }
  set enabled(v) {
    v = !!v;
    if (v === this._enabled) return;
    this._enabled = v;
    const r = this.renderer;
    if (v) { r.toneMapping = THREE.NoToneMapping; r.autoClear = false; } else { r.toneMapping = this._saved.toneMapping; r.autoClear = this._saved.autoClear; }
  }

  /**
   * Optional temporal AA (experimental, off by default; SMAA is used otherwise). Camera-motion reprojection only, so
   * things that move independently of the camera (enemy cars, tracers) get variance-clipped history (no ghosts, less AA).
   */
  get taa() { return this._taa; }
  set taa(v) {
    v = !!v;
    if (v === this._taa) return;
    this._taa = v;
    if (v && !this.taaPass) {
      if (this.camera.view && this.camera.view.enabled) { console.warn('Post: camera already uses a view offset; TAA disabled'); this._taa = false; return; }
      this.taaPass = new TaaPass(this.frameBufferType);
      this.composer.addPass(this.taaPass, this.composer.passes.indexOf(this.mainPass));
      this.taaPass.setSize(this._internal.x, this._internal.y);
      for (const p of [this.dofPass, this.mainPass, this.smaaPass, this.finalPass]) p.fullscreenMaterial.encodeOutput = false;
    }
    if (this.taaPass) { this.taaPass.enabled = v; this.taaPass.reset = true; }
  }

  /** Scene depth (float depth texture). Valid after the scene pass each frame; sample it 1 frame late from scene materials. */
  get depthTexture() { return this.composer.stableDepthTexture; }

  /** Size of the internal (scaled) render buffers. */
  get internalSize() { return this._internal; }

  /** Resize. Call with CSS pixel size (like renderer.setSize) or with no args to just re-sync with the renderer. */
  setSize(w, h) {
    const r = this.renderer;
    if (w !== undefined && h !== undefined) {
      const cur = r.getSize(_v2);
      if (cur.x !== w || cur.y !== h) r.setSize(w, h);
    }
    r.getDrawingBufferSize(_v2);
    this._applyInternalSize(_v2.x, _v2.y);
  }

  _applyInternalSize(dw, dh) {
    const s = this.resolutionScale;
    const iw = Math.max(4, Math.round(dw * s)), ih = Math.max(4, Math.round(dh * s));
    this._drawW = dw; this._drawH = dh;
    this._internal.set(iw, ih);
    const c = this.composer;
    c.inputBuffer.setSize(iw, ih); c.outputBuffer.setSize(iw, ih);
    if (c.depthRenderTarget) c.depthRenderTarget.setSize(iw, ih);
    for (const p of c.passes) p.setSize(iw, ih);
  }

  /** 0.5 .. 1.0: render-target scale; the final pass upscales with a contrast-adaptive sharpen. */
  setResolutionScale(s) {
    this.resolutionScale = clamp(s, 0.5, 1);
    this._applyInternalSize(this._drawW, this._drawH);
  }

  setQuality(q, force = false) {
    q = clamp(Math.round(q), 0, 3);
    if (q === this.quality && !force) return;
    this.quality = q;
    const P = POST_PRESETS[q];
    this.scenePass.setSamples(this._safeSamples(P.msaa));
    if (P.ao) { this._ensureAO(); this._applyAOQuality(P.ao); }
    if (this.aoPass) this.aoPass.enabled = !!P.ao;
    this.lens.setMotionBlurTaps(P.mbTaps);
    this.dofEffect.setTaps(P.dofTaps);
    const mp = this.bloom.mipmapBlurPass;
    if (mp.levels !== P.bloomLevels) mp.levels = P.bloomLevels;
    this.bloom.luminancePass.resolution.scale = P.bloomScale;
    this.smaaEffect.applyPreset(P.smaa);
    this.smaaEffect.edgeDetectionMaterial.edgeDetectionMode = P.smaaMode;
    this.finalEffect.setSharpenEnabled(true);
    if (this._drawW) this._applyInternalSize(this._drawW, this._drawH);
  }

  /**
   * Live parameters (all optional):
   *  speed01 (0..1 fraction of max speed), boost (0..1), damage01 (0..1), night01 (0..1),
   *  dof (0..1 depth-of-field amount, garage/menu), hitFlash (0..1 impulse, decays by itself), slowmo (0..1),
   *  focus (metres, DOF focus distance), anchor (Object3D of the player's car - protected from motion blur)
   */
  setParams(p = {}) {
    const t = this.params;
    for (const k of ['speed01', 'boost', 'damage01', 'night01', 'dof', 'slowmo']) if (p[k] !== undefined) t[k] = p[k];
    if (p.hitFlash !== undefined) { t.hitFlash = p.hitFlash; this._hit = Math.max(this._hit, p.hitFlash); }
    if (p.focus !== undefined) this.cfg.dof.focus = p.focus;
    if (p.anchor !== undefined) this._anchor = p.anchor;
    if (p.focusObject !== undefined) this.focusObject = p.focusObject;
  }

  /** Enable/disable individual effects (test page / settings). Keys: ao bloom mb ca vignette grain lines dof smaa grade sharpen */
  setFeatures(f) { Object.assign(this.feat, f); }

  /** Impulse: red edge flash + chromatic burst (decays in ~0.3 s). */
  hit(v = 1) { this._hit = Math.max(this._hit, v); }

  /** Call after a camera teleport / cut so motion blur skips one frame. */
  cut() { this._forceCut = true; }

  /**
   * Brief screen-space refraction ring around a world point (explosions).
   * @param {THREE.Vector3|number[]} worldPos  @param {number} strength 0..2  @param {{duration?:number, radius?:number}} o radius in metres
   */
  shockwave(worldPos, strength = 1, o = {}) {
    let s = this._shocks.find((x) => !x.on);
    if (!s) s = this._shocks.reduce((a, b) => (a.age / a.dur > b.age / b.dur ? a : b));
    if (Array.isArray(worldPos)) s.pos.set(worldPos[0], worldPos[1], worldPos[2]); else s.pos.copy(worldPos);
    s.on = true; s.age = 0; s.dur = o.duration ?? 0.75; s.str = strength; s.R = o.radius ?? (18 + 10 * strength);
  }

  /** Enable per-pass GPU timing (EXT_disjoint_timer_query_webgl2). Read `post.timings` (Map name -> ms). */
  profile(on = true) {
    if (on && !this.timer) this.timer = new GpuTimer(this.renderer);
    this._profiling = on && this.timer.supported;
    for (const p of [this.dofPass, this.mainPass, this.smaaPass, this.finalPass]) p.timer = this._profiling ? this.timer : null;
    if (this.aoPass) this._wrapAO();
    this.timings = this.timer ? this.timer.ms : null;
    return this.timer ? this.timer.supported : false;
  }

  get enabledPasses() { return this.composer.passes.filter((p) => p.enabled).map((p) => p.name); }

  // ------------------------------------------------------------------ frame

  render(dt) {
    const renderer = this.renderer;
    const now = performance.now() / 1000;
    if (dt === undefined) dt = this._clockLast ? now - this._clockLast : 1 / 60;
    this._clockLast = now;
    dt = clamp(dt, 1 / 240, 0.1);

    if (!this.enabled) { renderer.render(this.scene, this.camera); return; }

    this._time += dt; this._frame++;
    const camera = this.camera;
    camera.updateMatrixWorld();
    this._updateState(dt);
    this._updateUniforms(dt);
    if (this._profiling) this.timer.poll();
    const jitter = this._taa && this.taaPass;
    if (jitter) {
      const i = (this._frame % 16) + 1;
      camera.setViewOffset(this._internal.x, this._internal.y, halton(i, 2) - 0.5, halton(i, 3) - 0.5, this._internal.x, this._internal.y);
    }
    this.composer.render(dt);
    if (jitter) camera.clearViewOffset();
    this._prevVP.copy(this._vp); this._prevPos.copy(camera.position); this._haveHistory = true; this._forceCut = false;
  }

  // ------------------------------------------------------------------ internals

  _safeSamples(n) {
    if (n <= 0) return 0;
    return Math.min(n, this.renderer.capabilities.maxSamples || 0);
  }

  _ensureAO() {
    if (this.aoPass) return;
    const [w, h] = [this._internal.x, this._internal.y];
    const ao = new N8AOPostPass(this.scene, this.camera, w, h);
    ao.autoDetectTransparency = false;
    ao.configuration.transparencyAware = false;
    ao.configuration.halfRes = true;
    ao.configuration.gammaCorrection = false;
    this.aoPass = ao;
    this.composer.addPass(ao, 1);
    for (const p of [this.dofPass, this.mainPass, this.smaaPass, this.finalPass]) p.fullscreenMaterial.encodeOutput = false;
    this._wrapAO();
    ao.setSize(w, h);
  }

  _wrapAO() {
    const ao = this.aoPass;
    if (!ao || ao.__wrapped) return;
    ao.__wrapped = true;
    const orig = ao.render.bind(ao);
    ao.render = (...a) => {
      const t = this._profiling ? this.timer : null;
      if (t) t.begin('ao');
      orig(...a);
      if (t) t.end();
    };
  }

  _applyAOQuality(mode) {
    const ao = this.aoPass;
    ao.setQualityMode(mode);
    ao.configuration.halfRes = true;
  }

  _updateState(dt) {
    const t = this.params, c = this._cur;
    c.speed01 = damp(c.speed01, t.speed01, 5, dt);
    c.boost = damp(c.boost, t.boost, t.boost > c.boost ? 12 : 3, dt);
    c.damage01 = damp(c.damage01, t.damage01, 6, dt);
    c.night01 = damp(c.night01, t.night01, 1.5, dt);
    c.dof = damp(c.dof, t.dof, 6, dt);
    c.slowmo = damp(c.slowmo, t.slowmo, 8, dt);
    this._hit *= Math.exp(-dt * 7.5);
    if (this._hit < 0.002) this._hit = 0;
    // shockwaves
    let pulse = 0;
    for (const s of this._shocks) {
      if (!s.on) continue;
      s.age += dt;
      if (s.age >= s.dur) { s.on = false; continue; }
      pulse = Math.max(pulse, s.str * Math.pow(1 - s.age / s.dur, 2));
    }
    this._shockPulse = pulse;
  }

  _projectAnchor(out) {
    const cam = this.camera, a = this._anchor;
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov || 60) * 0.5);
    const aspect = cam.aspect || 1.78;
    if (!a) { out.set(0.5, 0.29, 0.15, 0.2); return; }
    a.getWorldPosition(_v3);
    _v3.y += 0.9;
    const dist = Math.max(0.5, cam.position.distanceTo(_v3));
    const h = 2 * dist * tanH;
    _v3.project(cam);
    if (_v3.z > 1) { out.set(0.5, 0.29, 0.001, 0.001); return; }
    out.set(_v3.x * 0.5 + 0.5, _v3.y * 0.5 + 0.5, 2.1 / (h * aspect), 2.1 / h);
  }

  _updateUniforms(dt) {
    const { cfg, feat, _cur: c, camera, renderer } = this;
    const P = POST_PRESETS[this.quality];
    const [iw, ih] = [this._internal.x, this._internal.y];
    const boost = c.boost, sp = c.speed01, dmg = c.damage01, slow = c.slowmo, hit = this._hit;

    for (const p of [this.dofPass, this.mainPass, this.smaaPass, this.finalPass]) {
      const u = p.fullscreenMaterial.uniforms;
      u.cameraNear.value = camera.near; u.cameraFar.value = camera.far;
    }

    // ---- lens: motion blur / CA / shockwave
    const lu = this.lens.uniforms;
    this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._invVP.copy(this._vp).invert();
    const cut = !this._haveHistory || this._forceCut || camera.position.distanceToSquared(this._prevPos) > 60 * 60;
    if (cut) this._reproj.identity(); else this._reproj.multiplyMatrices(this._prevVP, this._invVP);
    lu.get('reproj').value.copy(this._reproj);
    if (this.taaPass && this._taa) {
      this.taaPass.reproj.copy(this._reproj);
      if (cut) this.taaPass.reset = true;
    }
    const mbOn = feat.mb && P.mbTaps > 0 && !cut;
    const drive = clamp(smoothstep(0.1, 0.8, sp) * 0.85 + boost * 0.55, 0, 1.25);
    const frameNorm = clamp((1 / 60) / dt, 0.4, 3.0);
    lu.get('mbAmount').value = mbOn ? cfg.mb.strength * cfg.mb.shutter * 2 * drive * frameNorm : 0;
    lu.get('mbMaxPx').value = Math.max(4, cfg.mb.maxFrac * ih * (0.6 + 0.6 * drive));
    lu.get('carMask').value = cfg.mb.carMask;
    lu.get('nearFade').value.set(cfg.mb.nearZ0, cfg.mb.nearZ1, cfg.mb.nearMin);
    this._projectAnchor(lu.get('car').value);
    const caOn = feat.ca;
    lu.get('caAmount').value = caOn ? cfg.ca.base + cfg.ca.speed * sp * sp + cfg.ca.boost * boost + cfg.ca.hit * hit + cfg.ca.slowmo * slow : 0;
    lu.get('frameSeed').value = (this._frame % 64) * 3.7;
    // shockwaves -> screen space
    const sv = lu.get('shock').value;
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov || 60) * 0.5);
    for (let i = 0; i < 4; i++) {
      const s = this._shocks[i], v = sv[i];
      if (!s.on) { v.w = 0; continue; }
      const k = s.age / s.dur;
      _v3.copy(s.pos);
      const dist = Math.max(1, camera.position.distanceTo(_v3));
      _v3.project(camera);
      if (_v3.z > 1) { v.w = 0; continue; }
      const h = 2 * dist * tanH;
      const rad = s.R * (1 - Math.pow(1 - k, 3));
      const att = clamp(70 / dist, 0.12, 1);
      v.set(_v3.x * 0.5 + 0.5, _v3.y * 0.5 + 0.5, rad / h, 0.038 * s.str * Math.pow(1 - k, 1.5) * att);
    }

    // ---- bloom
    const bl = this.bloom;
    const tm = bl.thresholdMaterial.uniforms;
    tm.thr.value.set(cfg.bloom.threshold, cfg.bloom.knee, cfg.bloom.clamp, cfg.bloom.skyMul);
    tm.depthBuffer.value = this.composer.stableDepthTexture;
    tm.useDepth.value = 1;
    bl.intensity = feat.bloom ? cfg.bloom.intensity * (1 + 0.25 * c.night01 + 0.2 * boost + 0.35 * this._shockPulse) : 0;
    bl.mipmapBlurPass.radius = cfg.bloom.radius;

    // ---- grade
    const gu = this.grade.uniforms;
    const G = cfg.grade;
    gu.get('exposure').value = renderer.toneMappingExposure * cfg.exposure;
    const onG = feat.grade;
    gu.get('gradeA').value.set(onG ? G.contrast : 0, onG ? G.saturation : 1, onG ? c.night01 : 0, clamp(dmg * 0.4 + slow * 0.25, 0, 0.6));
    gu.get('shadowTint').value.fromArray(onG ? G.shadowTint : [0, 0, 0]);
    gu.get('highTint').value.fromArray(onG ? G.highTint : [1, 1, 1]);
    gu.get('lift').value.fromArray(G.lift); gu.get('gammaP').value.fromArray(G.gamma); gu.get('gainP').value.fromArray(G.gain);
    gu.get('nightMul').value.fromArray(G.nightMul);
    this.grade.setTonemap(cfg.tonemap);

    // ---- dof
    const dofAmt = feat.dof ? c.dof : 0;
    this.dofPass.enabled = dofAmt > 0.01;
    if (this.dofPass.enabled) {
      let focus = cfg.dof.focus;
      if (this.focusObject) { this.focusObject.getWorldPosition(_v3); focus = camera.position.distanceTo(_v3); }
      this.dofEffect.uniforms.get('dofP').value.set(dofAmt * cfg.dof.bokeh * (ih / 1080), focus, cfg.dof.range, cfg.dof.near);
    }

    // ---- final
    const fu = this.finalEffect.uniforms;
    const upscale = this.resolutionScale < 0.999;
    const sharp = feat.sharpen ? clamp(P.sharpen * (cfg.sharpen / 0.3) + (upscale ? 0.25 : 0) + (this._taa && this.taaPass ? 0.25 : 0), 0, 1) : 0;
    const vig = feat.vignette ? cfg.vignette.base + cfg.vignette.speed * sp + cfg.vignette.boost * boost + cfg.vignette.slowmo * slow : 0;
    fu.get('fxA').value.set(sharp, vig, feat.vignette ? dmg : 0, feat.vignette ? Math.min(1, hit) : 0);
    fu.get('fxB').value.set(feat.lines ? cfg.lines * clamp(boost * 1.05 + 0.12 * smoothstep(0.85, 1.0, sp), 0, 1) : 0, feat.grain ? cfg.grain : 0, 1, (this._frame % 97) * 1.0);
    fu.get('fxC').value.set(0.5, 0.5, slow, this._time);
    this.smaaPass.enabled = feat.smaa && !(this._taa && this.taaPass);
    if (this.aoPass) {
      this.aoPass.enabled = !!P.ao && feat.ao;
      const a = this.aoPass.configuration, A = cfg.ao;
      a.aoRadius = A.radius; a.intensity = A.intensity; a.distanceFalloff = A.falloff;
      if (a.color.getHex() !== A.color) a.color = new THREE.Color(A.color);
    }
  }

  dispose() {
    const r = this.renderer;
    if (this.timer) this.timer.dispose();
    this.composer.dispose();
    this.scenePass.dispose();
    r.toneMapping = this._saved.toneMapping;
    r.autoClear = this._saved.autoClear;
  }
}

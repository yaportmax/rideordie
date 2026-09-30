// Proposal-only CPU flow audit. No WebGL context, pixels, or GPU timings.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EffectComposer, Pass } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { ScenePass } from '../../src/view/post/scene_pass.js';

class FakeRenderer {
  constructor() {
    this.capabilities = {}; this.xr = { enabled: true }; this.autoClear = false;
    this.outputColorSpace = THREE.SRGBColorSpace; this.target = null;
    this.draws = []; this.blits = []; this.frame = 0; this.fail = null;
    this.labels = new Map(); this.targets = new Map();
    this.properties = { get: target => ({ __webglFramebuffer: target }) };
    const bindings = new Map();
    this.gl = { READ_FRAMEBUFFER: 1, DRAW_FRAMEBUFFER: 2, FRAMEBUFFER: 3,
      DEPTH_BUFFER_BIT: 4, STENCIL_BUFFER_BIT: 8, NEAREST: 0,
      getContextAttributes: () => ({ alpha: true }),
      bindFramebuffer: (kind, target) => bindings.set(kind, target),
      blitFramebuffer: (...args) => this.blits.push({ frame: this.frame,
        source: this.targetName(bindings.get(1)), destination: this.targetName(bindings.get(2)),
        mask: args[8], filter: args[9], coordinates: args.slice(0, 8) }),
    };
  }
  getSize(v) { return v.set(16, 16); }
  getDrawingBufferSize(v) { return v.set(16, 16); }
  getContext() { return this.gl; }
  getRenderTarget() { return this.target; }
  setRenderTarget(target) { this.target = target; }
  targetName(target) {
    return target ? this.targets.get(target) || target.texture?.name || target.name || 'anonymous-target' : 'screen';
  }
  clear() {}
  render(mesh) {
    const label = this.labels.get(mesh) || mesh.name;
    const u = mesh.material?.uniforms || {};
    this.draws.push({ frame: this.frame, label, target: this.targetName(this.target),
      samples: Object.fromEntries(['sceneDiffuse', 'sceneDepth', 'tDiffuse'].filter(k => u[k]?.value)
        .map(k => [k, u[k].value.name])), depthTest: mesh.material?.depthTest,
      depthFunc: mesh.material?.depthFunc, depthWrite: mesh.material?.depthWrite });
    if (this.fail === label) throw new Error(`Injected renderer failure: ${label}`);
  }
}

class FlowPass extends Pass {
  constructor(name, seen) {
    super(name); this.mesh = new THREE.Mesh(undefined, new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } }, depthTest: false, depthWrite: false,
    })); this.mesh.name = name; this.seen = seen; this.needsSwap = true;
    this.depth = null;
  }
  setDepthTexture(value) { this.depth = value; }
  getDepthTexture() { return this.depth; }
  render(r, input, output) {
    this.seen.push({ frame: r.frame, pass: this.name, input: input.texture.name,
      depth: this.getDepthTexture()?.name });
    this.mesh.material.uniforms.tDiffuse.value = input.texture;
    r.setRenderTarget(output); r.render(this.mesh);
  }
}

function compatible(ao, input, output) {
  const owned = ao.outputTargetInternal;
  const full = t => t.viewport.equals(new THREE.Vector4(0, 0, t.width, t.height))
    && t.scissor.equals(new THREE.Vector4(0, 0, t.width, t.height)) && !t.scissorTest;
  return !ao.renderToScreen && !ao.configuration.transparencyAware && input && output
    && input !== output && input.texture !== output.texture && output.samples === 0
    && !output.stencilBuffer && !input.stencilBuffer && [input, output].every(t => full(t)
      && t.width === owned.width && t.height === owned.height
      && t.texture.type === owned.texture.type && t.texture.format === owned.texture.format
      && t.texture.colorSpace === owned.texture.colorSpace);
}

function installProposal(ao) {
  const original = ao.render; const counts = { direct: 0, fallback: 0 };
  ao.render = function(r, input, output, ...rest) {
    if (!compatible(this, input, output)) {
      counts.fallback++; return original.call(this, r, input, output, ...rest);
    }
    counts.direct++;
    const owned = this.outputTargetInternal, copy = this.copyQuad, comp = this.effectCompositerQuad;
    const copyRender = copy.render, compRender = comp.render, sample = copy.material.uniforms.tDiffuse.value;
    const xr = r.xr.enabled, entryTarget = r.getRenderTarget(); let complete = false;
    this.outputTargetInternal = output; copy.render = () => {};
    comp.render = function(renderer) {
      const material = this.material, test = material.depthTest, func = material.depthFunc;
      material.depthTest = copy.material.depthTest; material.depthFunc = copy.material.depthFunc;
      try { return compRender.call(this, renderer); }
      finally { material.depthTest = test; material.depthFunc = func; }
    };
    try { const result = original.call(this, r, input, output, ...rest); complete = true; return result; }
    finally {
      this.outputTargetInternal = owned; copy.render = copyRender; comp.render = compRender;
      copy.material.uniforms.tDiffuse.value = sample; r.xr.enabled = xr;
      if (!complete) r.setRenderTarget(entryTarget);
    }
  };
  return counts;
}

function run({ proposal = false, dof = false, negative = null, failure = false } = {}) {
  const r = new FakeRenderer(), composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType,
    multisampling: 0, depthBuffer: true, stencilBuffer: false });
  composer.autoRenderToScreen = false;
  composer.inputBuffer.texture.name = 'A'; composer.outputBuffer.texture.name = 'B';
  const seen = [], scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  scene.name = 'scene';
  const ao = new N8AOPostPass(scene, camera, 16, 16);
  ao.autoDetectTransparency = false; ao.configuration.transparencyAware = false;
  ao.configuration.gammaCorrection = false; ao.configuration.halfRes = true;
  ao.outputTargetInternal.texture.type = THREE.HalfFloatType;
  r.targets.set(ao.depthDownsampleTarget, 'Downsample');
  ao.depthDownsampleTarget.textures[0].name = 'DepthHalf';
  ao.depthDownsampleTarget.textures[1].name = 'NormalsHalf';
  for (const [target, name] of [[ao.outputTargetInternal, 'AO'], [ao.writeTargetInternal, 'W'],
    [ao.readTargetInternal, 'R'], [ao.accumulationRenderTarget, 'Accum']]) target.texture.name = name;
  composer.addPass(new ScenePass(scene, camera, { samples: 0,
    getDepthTarget: () => composer.depthRenderTarget })); composer.addPass(ao);
  if (dof) composer.addPass(new FlowPass('dof', seen));
  composer.addPass(new FlowPass('main', seen));
  composer.stableDepthTexture.name = 'Depth';
  r.targets.set(composer.depthRenderTarget, 'StableDepthRT');
  const stable = composer.stableDepthTexture, depthImage = { ...stable.image };
  for (const [quad, label] of [[ao.depthDownsampleQuad, 'ao.depth'], [ao.effectShaderQuad, 'ao.sample'],
    [ao.poissonBlurQuad, 'ao.blur'], [ao.accumulationQuad, 'ao.accum'],
    [ao.effectCompositerQuad, 'ao.compose'], [ao.copyQuad, 'ao.copy']]) r.labels.set(quad._mesh, label);
  const owned = ao.outputTargetInternal, compRender = ao.effectCompositerQuad.render,
    copyRender = ao.copyQuad.render, depthTest = ao.effectCompositerQuad.material.depthTest,
    depthFunc = ao.effectCompositerQuad.material.depthFunc, copySample = ao.copyQuad.material.uniforms.tDiffuse.value;
  if (negative === 'screen') ao.renderToScreen = true;
  if (negative === 'stencil') composer.outputBuffer.stencilBuffer = true;
  if (negative === 'format') composer.outputBuffer.texture.format = THREE.RedFormat;
  const counts = proposal ? installProposal(ao) : null;
  if (failure) r.fail = 'ao.compose';
  let error = null;
  for (r.frame = 1; r.frame <= (failure ? 1 : 2); r.frame++) {
    try { composer.render(1 / 60); } catch (e) { error = e.message; break; }
  }
  const result = { draws: r.draws.length, flow: seen, blits: r.blits, counts, stableDepthUnchanged:
    composer.stableDepthTexture === stable && ao.depthTexture === stable
    && JSON.stringify(stable.image) === JSON.stringify(depthImage),
  ownedTargetRestored: ao.outputTargetInternal === owned,
  methodsRestored: ao.copyQuad.render === copyRender && ao.effectCompositerQuad.render === compRender,
  copySamplerRestored: proposal ? ao.copyQuad.material.uniforms.tDiffuse.value === copySample : null,
  materialRestored: ao.effectCompositerQuad.material.depthTest === depthTest
    && ao.effectCompositerQuad.material.depthFunc === depthFunc,
  xrEnabled: r.xr.enabled, finalTarget: r.targetName(r.target), error,
  drawFlow: r.draws.map(d => [d.frame, d.label, d.target, d.samples, d.depthTest, d.depthFunc]) };
  assert.ok(result.stableDepthUnchanged && result.ownedTargetRestored && result.methodsRestored && result.materialRestored);
  assert.equal(result.blits.length, failure ? 1 : 2);
  assert.ok(result.blits.every(b => b.source === 'A' && b.destination === 'StableDepthRT'
    && b.mask === r.gl.DEPTH_BUFFER_BIT && b.filter === r.gl.NEAREST
    && JSON.stringify(b.coordinates) === '[0,0,16,16,0,0,16,16]'));
  assert.ok(r.draws.filter(d => d.label.startsWith('ao.')).every(d => d.target !== 'StableDepthRT'));
  if (proposal && !negative) assert.ok(result.copySamplerRestored);
  // Disposes CPU-side Three objects only; no framebuffer or browser ever existed.
  composer.dispose();
  return result;
}

const pairs = [false, true].map(dof => {
  const baseline = run({ dof }), candidate = run({ dof, proposal: true });
  assert.equal(candidate.draws - baseline.draws, -2);
  assert.deepEqual(candidate.flow, baseline.flow);
  assert.deepEqual(candidate.blits, baseline.blits);
  assert.ok(candidate.xrEnabled && baseline.xrEnabled);
  assert.equal(candidate.counts.direct, 2);
  const baselineComp = baseline.drawFlow.filter(d => d[1] === 'ao.compose');
  const candidateComp = candidate.drawFlow.filter(d => d[1] === 'ao.compose');
  assert.deepEqual(candidateComp.map(d => d[3]), baselineComp.map(d => d[3]));
  assert.ok(candidateComp.every(d => d[2] === 'B' && d[4] === true && d[5] === THREE.LessEqualDepth));
  return { dof, deltaPerFrame: -1, baseline, candidate };
});
const fallback = ['screen', 'stencil', 'format'].map(negative => {
  const result = run({ proposal: true, negative });
  assert.equal(result.counts.fallback, 2); assert.equal(result.counts.direct, 0);
  assert.equal(result.drawFlow.filter(d => d[1] === 'ao.copy').length, 2);
  return { negative, counts: result.counts, copyDraws: 2, stableDepthUnchanged: result.stableDepthUnchanged };
});
const failure = { baseline: run({ failure: true }), candidate: run({ proposal: true, failure: true }) };
assert.ok(failure.baseline.error && failure.candidate.error);
assert.equal(failure.baseline.xrEnabled, false); assert.equal(failure.candidate.xrEnabled, true);
assert.equal(failure.candidate.finalTarget, 'screen');
console.log(JSON.stringify({ proposalOnly: true, limitation: 'Fake renderer checks call and reference flow; it cannot validate pixels, interpolation, precision, framebuffer completeness, or GPU performance.', pairs, fallback, failure }));

import test from 'node:test';
import assert from 'node:assert/strict';
import { WebGLRenderTarget, DepthTexture, Vector2 } from 'three';
import { Post } from '../src/view/post.js';

function fixture() {
  const allocations = new WeakMap(), passes = [{ sizes: [], setSize(w, h) { this.sizes.push([w, h]); } }];
  const target = () => {
    const rt = new WebGLRenderTarget(2560, 1440);
    rt.depthTexture = new DepthTexture(2560, 1440);
    // Model Three's immutable depth allocation and disposal. A scene sampler
    // can allocate this texture before the depth framebuffer is initialized.
    rt.addEventListener('dispose', () => allocations.delete(rt.depthTexture));
    return rt;
  };
  const composer = { inputBuffer: target(), outputBuffer: target(), depthRenderTarget: target(), passes };
  const post = Object.create(Post.prototype);
  Object.assign(post, { resolutionScale: 1, _internal: new Vector2(2560, 1440), composer });
  const sample = (depth) => {
    if (!allocations.has(depth)) allocations.set(depth, [depth.image.width, depth.image.height]);
    return allocations.get(depth);
  };
  return { post, composer, passes, sample };
}

test('dynamic resolution updates depth image before scene-first soft-particle allocation', () => {
  const f = fixture(), depth = f.composer.depthRenderTarget.depthTexture;
  assert.deepEqual(f.sample(depth), [2560, 1440]);
  const version = depth.version;
  f.post.resolutionScale = 0.9; f.post._applyInternalSize(2560, 1440);
  // This occurs BEFORE a framebuffer bind or the composer depth blit.
  assert.deepEqual(f.sample(depth), [2304, 1296]);
  for (const rt of [f.composer.inputBuffer, f.composer.outputBuffer, f.composer.depthRenderTarget]) {
    assert.deepEqual([rt.width, rt.height], [2304, 1296]);
    assert.deepEqual([rt.depthTexture.image.width, rt.depthTexture.image.height], [2304, 1296]);
  }
  assert.equal(depth.version, version + 1);
  assert.deepEqual(f.passes[0].sizes, [[2304, 1296]]);
});

test('resolution recovery and browser resize keep each independent depth attachment sized correctly', () => {
  const f = fixture();
  for (const [scale, width, height] of [[0.9, 2560, 1440], [0.75, 2560, 1440], [1, 2560, 1440], [1, 1920, 1080]]) {
    f.post.resolutionScale = scale; f.post._applyInternalSize(width, height);
    const expected = [Math.round(width * scale), Math.round(height * scale)];
    assert.deepEqual(f.sample(f.composer.depthRenderTarget.depthTexture), expected);
    for (const rt of [f.composer.inputBuffer, f.composer.outputBuffer, f.composer.depthRenderTarget]) assert.deepEqual(f.sample(rt.depthTexture), expected);
  }
  assert.notEqual(f.composer.inputBuffer.depthTexture, f.composer.depthRenderTarget.depthTexture);
  assert.notEqual(f.composer.outputBuffer.depthTexture, f.composer.depthRenderTarget.depthTexture);
});

test('unchanged dimensions do not dispose targets or reset temporal AO history', () => {
  const f = fixture(); let disposed = 0;
  f.composer.depthRenderTarget.addEventListener('dispose', () => disposed++);
  f.post._applyInternalSize(2560, 1440);
  f.post._applyInternalSize(2560, 1440);
  assert.equal(disposed, 0); assert.equal(f.passes[0].sizes.length, 0);
});

test('post loading prewarm initializes current buffers and restores the caller target', async () => {
  const post = Object.create(Post.prototype), initialized = [], compiled = [];
  const entry = { name: 'scene-target' }; let target = entry, face = 2, mip = 1;
  const buffer = name => ({ name });
  const pass = name => ({ scene: { name }, camera: {}, renderTarget: buffer(`${name}-buffer`) });
  post.renderer = {
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget: (next, nextFace = 0, nextMip = 0) => { target = next; face = nextFace; mip = nextMip; },
    initRenderTarget: next => initialized.push(next),
    compileAsync: (scene, camera) => { compiled.push({ scene, camera, target }); return Promise.resolve(); },
  };
  post.composer = { inputBuffer: buffer('input'), outputBuffer: buffer('output'), depthRenderTarget: buffer('depth') };
  post.scenePass = { rt: null };
  post.dofPass = pass('dof'); post.mainPass = pass('main'); post.smaaPass = pass('smaa'); post.finalPass = pass('final');
  post.shaftsPass = pass('shafts'); post.shaftsPass.rt = buffer('shafts-rt');
  const blur = pass('blur'); blur.fullscreenMaterial = 'original';
  Object.assign(blur, { downsamplingMaterial: 'down', upsamplingMaterial: 'up', downsamplingMipmaps: [buffer('mip0')], upsamplingMipmaps: [buffer('mip1')] });
  post.bloom = { renderTarget: buffer('bloom'), luminancePass: pass('luminance'), mipmapBlurPass: blur };
  post.smaaEffect = { renderTargetEdges: buffer('edges'), renderTargetWeights: buffer('weights'), edgeDetectionPass: pass('edge'), weightsPass: pass('weight') };
  post.aoPass = { writeTargetInternal: buffer('ao-write'), readTargetInternal: buffer('ao-read'), depthDownsampleQuad: { _mesh: { name: 'ao-depth' } } };
  await post.warm();
  assert.ok(initialized.includes(post.composer.depthRenderTarget));
  assert.ok(initialized.includes(post.smaaEffect.renderTargetEdges));
  assert.ok(initialized.includes(post.aoPass.writeTargetInternal));
  assert.equal(compiled.find(x => x.scene.name === 'final').target, null);
  assert.equal(compiled.find(x => x.scene.name === 'main').target, post.composer.outputBuffer);
  assert.ok(compiled.some(x => x.scene.name === 'ao-depth'));
  assert.equal(blur.fullscreenMaterial, 'original');
  assert.equal(target, entry); assert.equal(face, 2); assert.equal(mip, 1);
});

// Proposal-only RTX validation. This never changes the production AO pass.
// GAME_URL=http://127.0.0.1:5194 node tools/test/ao_direct_gpu.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

const base = process.env.GAME_URL || 'http://127.0.0.1:5194';
const output = resolve(process.env.AO_OUTPUT || 'shots/optimization/ao-direct-gpu');
const sampleFrames = Number(process.env.AO_FRAMES || 240);
const budgetMs = Number(process.env.AO_BUDGET_MS || 240000);
await mkdir(output, { recursive: true });
const result = { proposalOnly: true, base, sampleFrames, pixels: [], timings: [], errors: [], warnings: [],
  limitation: 'One frozen city scene on one RTX driver validates this runtime adapter, not all gameplay, GPUs or transparency-aware AO. GPU queries instrument the frozen render; they are not ordinary gameplay FPS.' };
let browser;
const deadline = setTimeout(() => { result.timedOut = true; void browser?.close(); }, budgetMs);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let value = n; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); return value >>> 0;
});

function pixelDiff(a, b) {
  assert.equal(a.length, b.length); let changed = 0, sum = 0, max = 0, overOne = 0;
  for (let i = 0; i < a.length; i += 4) {
    let difference = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - b[i + c]); sum += d; max = Math.max(max, d); difference += d; if (d > 1) overOne++; }
    if (difference) changed++;
  }
  return { changedPixels: changed, changedPercent: changed * 400 / a.length,
    meanChannelDelta: sum * 4 / (a.length * 3), maxChannelDelta: max, channelsOverOne: overOne };
}

function linearDiff(a, b, halfFloat) {
  assert.equal(a.length, b.length);
  const av = halfFloat ? new Uint16Array(a.buffer, a.byteOffset, a.length / 2) : a;
  const bv = halfFloat ? new Uint16Array(b.buffer, b.byteOffset, b.length / 2) : b;
  const half = bits => { const sign = bits & 0x8000 ? -1 : 1, exponent = (bits >> 10) & 31, fraction = bits & 1023;
    return exponent === 0 ? sign * fraction * 2 ** -24 : exponent === 31 ? (fraction ? NaN : sign * Infinity) : sign * (1 + fraction / 1024) * 2 ** (exponent - 15); };
  let changed = 0, max = 0, sum = 0, peak = 0;
  for (let i = 0; i < av.length; i++) {
    const x = halfFloat ? half(av[i]) : av[i] / 255, y = halfFloat ? half(bv[i]) : bv[i] / 255;
    assert.ok(Number.isFinite(x) && Number.isFinite(y), 'Nonfinite AO output');
    if (av[i] !== bv[i]) changed++;
    const difference = Math.abs(x - y); max = Math.max(max, difference); sum += difference; peak = Math.max(peak, x, y);
  }
  return { components: av.length, changedComponents: changed, maxDelta: max, meanDelta: sum / av.length, peakValue: peak, storage: halfFloat ? 'RGBA16F' : 'RGBA8' };
}

// Small RGBA PNG encoder using Node's bundled zlib, so the probe has no optional dependencies.
function png(width, height, bottomUp) {
  const crc = bytes => {
    let value = 0xffffffff;
    for (const b of bytes) value = (value >>> 8) ^ crcTable[(value ^ b) & 255];
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), body = Buffer.concat([name, bytes]), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc(body)); return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const stride = width * 4, rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) bottomUp.copy(rows, y * (stride + 1) + 1, (height - y - 1) * stride, (height - y) * stride);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) result.warnings.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('rideordie.settings.v1', JSON.stringify({ quality: 2, resScale: 1, master: 0, motionBlur: false, chromatic: false, grain: false })));
  await page.goto(`${base}/?solo&as=driver&s=44000&seed=7`);
  await page.waitForFunction(() => window.__ready && window.__run?.started && window.__game?.post, null, { timeout: 90000 });
  const bundle = await page.evaluate(() => [...document.scripts].find(script => /\/assets\/index-[^/]+\.js(?:$|\?)/.test(script.src))?.src);
  if (bundle) {
    const response = await fetch(bundle); assert.equal(response.status, 200, 'Candidate bundle was not reachable');
    result.bundle = { url: bundle, sha256: createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex') };
  }
  await page.waitForTimeout(6000);
  await page.evaluate(() => { delete window.__autodrive; window.__forceInput = { throttle: 0, brake: 1 }; });
  await page.waitForFunction(() => {
    const g = window.__game, r = window.__run;
    return r.streamer?.pending?.size === 0 && (!r.dressing?._pending || r.dressing._pending() === 0) && !g._texQueue?.length;
  });
  result.setup = await page.evaluate(() => {
    const g = window.__game, run = window.__run, renderer = g.renderer, gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info'), gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
    if (!/NVIDIA|RTX/i.test(gpu)) throw new Error(`RTX renderer required; got ${gpu}`);
    const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!timerExt) throw new Error('Real GPU timer queries unavailable');
    const player = run.states.get(1), target = g.camera.position.clone().set(0, 1.8, 65).applyQuaternion(player.quat).add(player.pos);
    g.camera.position.set(0, 2.5, -2.2).applyQuaternion(player.quat).add(player.pos); g.camera.lookAt(target); g.camera.updateMatrixWorld(true);
    g.sky.update(0, g.camera, player.pos); run.dressing?.setShadowFocus?.(g.sky.shadowFocus); g.scene.updateMatrixWorld(true);
    // Freeze the actual game, including sky, FX, camera, PMREM and streamed geometry.
    // The mirror texture remains its already-rendered image throughout both paths.
    g.frame = () => {};
    const state = window.__aoProbe = { proposal: false, queryKind: null, pending: [], values: [], disjoint: 0, type: 'HDR',
      postClass: g.post.constructor, cfg: JSON.parse(JSON.stringify(g.post.cfg)), uniformUpdate: null };
    const ensure = (condition, message) => { if (!condition) throw new Error(message); };
    const encode = bytes => { let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary); };
    const full = t => t.viewport.x === 0 && t.viewport.y === 0 && t.viewport.z === t.width && t.viewport.w === t.height
      && t.scissor.x === 0 && t.scissor.y === 0 && t.scissor.z === t.width && t.scissor.w === t.height && !t.scissorTest;
    const compatible = (ao, input, output) => {
      const owned = ao.outputTargetInternal;
      return !ao.renderToScreen && !ao.configuration.transparencyAware && input && output && input !== output && input.texture !== output.texture
        && output.samples === 0 && !output.stencilBuffer && !input.stencilBuffer && [input, output].every(t => full(t)
          && t.width === owned.width && t.height === owned.height && t.texture.type === owned.texture.type
          && t.texture.format === owned.texture.format && t.texture.colorSpace === owned.texture.colorSpace);
    };
    function installProposal(ao) {
      const original = ao.render, counts = { direct: 0, fallback: 0 };
      const direct = function (r, input, output, ...rest) {
        if (!compatible(this, input, output)) { counts.fallback++; return original.call(this, r, input, output, ...rest); }
        counts.direct++;
        const owned = this.outputTargetInternal, copy = this.copyQuad, comp = this.effectCompositerQuad;
        const copyRender = copy.render, compRender = comp.render, sample = copy.material.uniforms.tDiffuse.value;
        const xr = r.xr.enabled, entryTarget = r.getRenderTarget(); let complete = false;
        this.outputTargetInternal = output; copy.render = () => {};
        comp.render = function (render) {
          const material = this.material, test = material.depthTest, func = material.depthFunc;
          material.depthTest = copy.material.depthTest; material.depthFunc = copy.material.depthFunc;
          try { return compRender.call(this, render); }
          finally { material.depthTest = test; material.depthFunc = func; }
        };
        try { const value = original.call(this, r, input, output, ...rest); complete = true; return value; }
        finally {
          this.outputTargetInternal = owned; copy.render = copyRender; comp.render = compRender; copy.material.uniforms.tDiffuse.value = sample;
          r.xr.enabled = xr; if (!complete) r.setRenderTarget(entryTarget);
        }
      };
      return { original, direct, counts };
    }
    const poll = () => {
      const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
      if (disjoint) state.disjoint++;
      for (let i = state.pending.length - 1; i >= 0; i--) {
        const row = state.pending[i]; if (!gl.getQueryParameter(row.q, gl.QUERY_RESULT_AVAILABLE)) continue;
        if (!disjoint) state.values.push({ variant: row.variant, kind: row.kind, ms: gl.getQueryParameter(row.q, gl.QUERY_RESULT) / 1e6 });
        gl.deleteQuery(row.q); state.pending.splice(i, 1);
      }
    };
    const startQuery = kind => {
      const q = gl.createQuery(); gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
      return { q, kind, variant: state.proposal ? 'proposal' : 'reference' };
    };
    const endQuery = row => { gl.endQuery(timerExt.TIME_ELAPSED_EXT); state.pending.push(row); };
    state.installPost = p => {
      p.autoResolution = false; p.setQuality(2, true); p.setResolutionScale(1); p.taa = false; p.profile(false);
      p.setFeatures({ mb: false, ca: false, grain: false, lines: false, dof: true, shafts: false });
      p.cfg = JSON.parse(JSON.stringify(state.cfg)); p._frame = 0; p._time = 0;
      state.uniformUpdate = p._updateUniforms.bind(p); p._updateState = () => {}; p._updateUniforms = () => {};
      g.fx?.setDepthSource?.(p);
      for (const pass of [p.dofPass, p.mainPass, p.smaaPass, p.finalPass]) { pass.timeScale = 0; pass.fullscreenMaterial.time = 0; }
      const ao = p.aoPass;
      ensure(ao, 'High AO pass unavailable'); ao.configuration.accumulate = false; ao.disableDebugMode();
      // Installed N8AO writes wall time immediately before calling each quad.
      // Freeze those values at the draw, rather than assuming they are unused.
      for (const quad of [ao.depthDownsampleQuad, ao.effectShaderQuad, ao.poissonBlurQuad, ao.accumulationQuad, ao.effectCompositerQuad, ao.copyQuad]) if (quad) {
        const original = quad.render;
        quad.render = function (r) {
          for (const key of ['time', 'elapsedTime']) if (this.material.uniforms[key]) this.material.uniforms[key].value = 123;
          for (const key of ['frame', 'frameSeed']) if (this.material.uniforms[key]) this.material.uniforms[key].value = 0;
          return original.call(this, r);
        };
      }
      state.adapter = installProposal(ao);
      ao.render = function (...args) {
        const q = state.queryKind === 'ao' ? startQuery('ao') : null;
        try {
          const value = (state.proposal ? state.adapter.direct : state.adapter.original).apply(this, args);
          if (state.readAo) {
            const output = args[2], buffer = p.hdr ? new Uint16Array(output.width * output.height * 4) : new Uint8Array(output.width * output.height * 4);
            ensure(renderer.capabilities.textureTypeReadable(output.texture.type), 'AO output type does not support precision readback');
            renderer.readRenderTargetPixels(output, 0, 0, output.width, output.height, buffer);
            ensure(gl.getError() === 0, 'AO precision readback failed'); state.linearPixels = encode(new Uint8Array(buffer.buffer));
          }
          return value;
        }
        finally { if (q) endQuery(q); }
      };
      state.owned = ao.outputTargetInternal; state.depth = p.composer.stableDepthTexture;
    };
    state.signature = () => {
      const rows = []; g.scene.traverse(o => rows.push([o.uuid, o.visible, o.castShadow, o.position.toArray(), o.quaternion.toArray(), o.scale.toArray(),
        o.geometry?.uuid, o.geometry?.attributes?.position?.version, o.instanceMatrix?.version, o.count]));
      rows.push(['camera', g.camera.position.toArray(), g.camera.quaternion.toArray(), g.camera.projectionMatrix.toArray()]);
      rows.push(['clocks', run.time, g.sky._time, g.sky.U.uTime.value, g.sky.U.uCloud.value.w]); return JSON.stringify(rows);
    };
    state.resources = () => {
      const rows = {}, value = v => v?.isTexture ? [v.uuid, v.version, v.type, v.colorSpace, v.image?.width, v.image?.height, v.image?.complete]
        : v?.toArray ? v.toArray() : v?.isColor ? [v.r, v.g, v.b] : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : null;
      const material = m => {
        if (!m || rows[m.uuid]) return;
        rows[m.uuid] = { version: m.version, opacity: m.opacity, color: value(m.color), emissive: value(m.emissive), uniforms: {} };
        for (const [key, uniform] of Object.entries(m.uniforms || {})) rows[m.uuid].uniforms[key] = value(uniform.value);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'envMap']) if (m[key]) rows[m.uuid][key] = value(m[key]);
      };
      g.scene.traverse(o => { for (const m of [].concat(o.material || [])) material(m); });
      const p = g.post;
      for (const pass of [p.dofPass, p.mainPass, p.smaaPass, p.finalPass]) material(pass.fullscreenMaterial);
      for (const quad of [p.aoPass.depthDownsampleQuad, p.aoPass.effectShaderQuad, p.aoPass.poissonBlurQuad, p.aoPass.accumulationQuad, p.aoPass.effectCompositerQuad, p.aoPass.copyQuad]) material(quad?.material);
      return rows;
    };
    state.draw = () => {
      const p = g.post; renderer.info.autoReset = false; renderer.info.reset();
      const query = state.queryKind === 'total' ? startQuery('total') : null;
      try { p.render(1 / 60); } finally { if (query) endQuery(query); }
      ensure(p.aoPass.outputTargetInternal === state.owned, 'AO owned target was not restored');
      ensure(p.depthTexture === state.depth && p.aoPass.depthTexture === state.depth, 'Stable depth reference changed');
      ensure(p.depthTexture.image.width === p.internalSize.x && p.depthTexture.image.height === p.internalSize.y, 'Depth size mismatch');
      const error = gl.getError(); ensure(error === 0 && !gl.isContextLost(), `WebGL error ${error}`);
      return renderer.info.render.calls;
    };
    state.configure = ({ scale = 1, dof = false }) => {
      const p = g.post; p.setResolutionScale(scale); p._cur.dof = dof ? 1 : 0; state.uniformUpdate(1 / 60);
      p.lens.uniforms.get('mbAmount').value = 0; p.lens.uniforms.get('caAmount').value = 0;
      for (const shock of p.lens.uniforms.get('shock').value) shock.w = 0;
      p.shaftsPass.active = false; p.shafts.uniforms.get('shaftCol').value.set(0, 0, 0);
      p.finalEffect.uniforms.get('fxA').value.z = 0; p.finalEffect.uniforms.get('fxA').value.w = 0;
      p.finalEffect.uniforms.get('fxB').value.set(0, 0, 0, 0); p.finalEffect.uniforms.get('fxC').value.z = 0; p.finalEffect.uniforms.get('fxC').value.w = 0;
      p.aoPass.firstFrame(); state.baseline = state.signature();
      // Scene materials sample the previous stable-depth texture (soft particles),
      // and the first frozen camera frame refreshes cached shadows. Settle those
      // dependencies before treating any capture as the repeatability control.
      state.readAo = false; state.queryKind = null; state.proposal = false;
      for (let i = 0; i < 48; i++) state.draw();
      return { hdr: p.hdr, frameBufferType: p.frameBufferType, aoType: p.aoPass.outputTargetInternal.texture.type,
        viewport: [innerWidth, innerHeight], internal: p.internalSize.toArray(), dof: p.dofPass.enabled, scale: p.resolutionScale };
    };
    state.settle = async () => {
      // Synchronous warm draws starve queued TextureLoader, worker and resize
      // callbacks. Let the same real-rAF scheduling used by timing run before
      // freezing the reference controls, rather than settling only GPU work.
      state.queryKind = null; state.readAo = false; state.proposal = false;
      for (let i = 0; i < 60; i++) { await new Promise(done => requestAnimationFrame(done)); state.draw(); }
      state.baseline = state.signature();
    };
    state.capture = proposal => {
      state.queryKind = null; state.proposal = proposal; for (let i = 0; i < 6; i++) state.draw();
      state.readAo = false; const calls = state.draw();
      const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      ensure(gl.getError() === 0, 'Screen readback failed'); ensure(state.signature() === state.baseline, 'Frozen scene changed');
      return { width, height, pixels: encode(pixels), calls, counts: { ...state.adapter.counts } };
    };
    state.capturePrecision = proposal => {
      state.queryKind = null; state.proposal = proposal; state.readAo = false;
      for (let i = 0; i < 6; i++) state.draw();
      state.readAo = true; state.linearPixels = null;
      try { state.draw(); } finally { state.readAo = false; }
      ensure(state.signature() === state.baseline, 'Frozen scene changed during precision readback');
      return { pixels: state.linearPixels, width: g.post.internalSize.x, height: g.post.internalSize.y };
    };
    state.inspectFramebuffers = () => {
      const p = g.post, previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel(), statuses = [];
      try {
        for (const target of [p.composer.inputBuffer, p.composer.outputBuffer, p.composer.depthRenderTarget, p.aoPass.outputTargetInternal,
          p.aoPass.writeTargetInternal, p.aoPass.readTargetInternal, p.aoPass.accumulationRenderTarget, p.aoPass.depthDownsampleTarget]) if (target) {
          renderer.setRenderTarget(target); const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
          statuses.push(status); ensure(status === gl.FRAMEBUFFER_COMPLETE, `Incomplete framebuffer ${status}`);
        }
      } finally { renderer.setRenderTarget(previous, face, mip); }
      ensure(gl.getError() === 0, 'Framebuffer inspection failed');
      return statuses;
    };
    state.measure = async frames => {
      state.values = []; state.disjoint = 0; state.queryKind = null;
      for (let i = 0; i < 12; i++) { state.proposal = !!(i % 2); state.draw(); }
      const signature = state.signature(), resources = state.resources(), calls = { reference: [], proposal: [] };
      // Rotate four frame slots, reversing their order in each round. Each variant
      // receives both total-pipeline and AO-only queries; queries never nest.
      for (let i = 0; i < frames; i++) {
        await new Promise(done => requestAnimationFrame(done)); poll();
        const slot = Math.floor(i / 4) % 2 ? 3 - i % 4 : i % 4;
        state.proposal = slot % 2 === 1; state.queryKind = slot < 2 ? 'total' : 'ao';
        calls[state.proposal ? 'proposal' : 'reference'].push(state.draw());
      }
      state.queryKind = null;
      for (let i = 0; state.pending.length && i < 180; i++) { await new Promise(done => requestAnimationFrame(done)); poll(); }
      ensure(!state.pending.length, 'GPU queries did not finish'); ensure(state.signature() === signature, 'Scene changed during paired timing');
      const summary = values => { const sorted = [...values].sort((a, b) => a - b); return !values.length ? null : {
        n: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
        p95: sorted[Math.floor((sorted.length - 1) * 0.95)], max: sorted.at(-1) }; };
      const afterResources = state.resources(), resourceChanges = [];
      for (const key of new Set([...Object.keys(resources), ...Object.keys(afterResources)])) if (JSON.stringify(resources[key]) !== JSON.stringify(afterResources[key])) {
        resourceChanges.push({ uuid: key, before: resources[key], after: afterResources[key] });
      }
      return { queries: state.values, disjoint: state.disjoint, unchanged: true, resourceChanges, calls: Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, summary(v)])),
        gpu: Object.fromEntries(['reference', 'proposal'].map(variant => [variant, Object.fromEntries(['total', 'ao'].map(kind =>
          [kind, summary(state.values.filter(v => v.variant === variant && v.kind === kind).map(v => v.ms))]))])), glError: gl.getError() };
    };
    state.verifyFailure = () => {
      const p = g.post, ao = p.aoPass, copy = ao.copyQuad, comp = ao.effectCompositerQuad;
      const originalComp = comp.render, originalCopy = copy.render, owned = ao.outputTargetInternal;
      const sample = copy.material.uniforms.tDiffuse.value, depthTest = comp.material.depthTest, depthFunc = comp.material.depthFunc;
      const entryTarget = renderer.getRenderTarget(), xr = renderer.xr.enabled;
      const injectedRender = () => { throw new Error('AO probe injected composition failure'); }; comp.render = injectedRender;
      let injected = false;
      try { state.adapter.direct.call(ao, renderer, p.composer.inputBuffer, p.composer.outputBuffer); }
      catch (error) { injected = /injected composition failure/.test(error.message); }
      finally {
        const restored = ao.outputTargetInternal === owned && copy.render === originalCopy && comp.render === injectedRender && copy.material.uniforms.tDiffuse.value === sample
          && comp.material.depthTest === depthTest && comp.material.depthFunc === depthFunc && renderer.xr.enabled === xr && renderer.getRenderTarget() === entryTarget;
        comp.render = originalComp; ensure(injected && restored, 'AO adapter did not restore state after renderer failure');
      }
      state.proposal = false; state.draw(); return { injected: true, ownershipMethodsSamplerMaterialTargetXrRestored: true, glError: gl.getError() };
    };
    state.switchLdr = () => {
      const old = g.post; old.dispose(); g.post = new state.postClass(renderer, g.scene, g.camera, { quality: 2, hdr: false, resolutionScale: 1 });
      state.type = 'LDR'; state.installPost(g.post); return { hdr: g.post.hdr, type: g.post.frameBufferType };
    };
    state.installPost(g.post);
    ensure(g.post.hdr, 'RTX HDR path unavailable'); ensure(gl.getError() === 0, 'Error before AO validation');
    return { gpu, distance: run.playerS, quality: g.quality, hdr: g.post.hdr, native: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      frozen: ['simulation', 'camera', 'sky', 'FX', 'PMREM', 'mirror texture', 'post effect time', 'N8AO time/frame'], aoAccumulation: false };
  });

  for (const type of ['HDR', 'LDR']) {
    if (type === 'LDR') result.ldr = await page.evaluate(() => window.__aoProbe.switchLdr());
    for (const viewport of [{ width: 2560, height: 1440 }, { width: 1400, height: 800 }]) {
      await page.setViewportSize(viewport);
      const scales = viewport.width === 2560 ? [1, 0.8, 0.65] : [1];
      for (const scale of scales) for (const dof of [false, true]) {
        const label = `${type.toLowerCase()}-${viewport.width}x${viewport.height}-s${scale}-dof${Number(dof)}`;
        const configuration = await page.evaluate(options => window.__aoProbe.configure(options), { scale, dof });
        await page.evaluate(() => window.__aoProbe.settle());
        const captures = [];
        for (const proposal of [false, false, true, true, false]) {
          const row = await page.evaluate(v => window.__aoProbe.capture(v), proposal);
          captures.push({ ...row, pixels: Buffer.from(row.pixels, 'base64') });
        }
        const [reference, referenceAgain, proposal, proposalAgain, referenceAfter] = captures;
        const evidence = { label, ...configuration, referenceRepeat: pixelDiff(reference.pixels, referenceAgain.pixels),
          proposalRepeat: pixelDiff(proposal.pixels, proposalAgain.pixels), referenceAfterProposal: pixelDiff(reference.pixels, referenceAfter.pixels),
          comparison: pixelDiff(reference.pixels, proposal.pixels),
          referenceCalls: reference.calls, proposalCalls: proposal.calls, counts: proposalAgain.counts };
        for (const [variant, row] of [['reference', reference], ['proposal', proposal]]) await writeFile(`${output}/${label}-${variant}.png`, png(row.width, row.height, row.pixels));
        result.pixels.push(evidence);
        console.log(JSON.stringify({ pixelCase: label, comparison: evidence.comparison, controlMax: evidence.referenceRepeat.maxChannelDelta, drawDelta: proposal.calls - reference.calls }));
        assert.equal(evidence.referenceRepeat.maxChannelDelta, 0, `${label}: reference is not deterministic`);
        assert.equal(evidence.proposalRepeat.maxChannelDelta, 0, `${label}: proposal is not deterministic`);
        assert.equal(evidence.referenceAfterProposal.maxChannelDelta, 0, `${label}: reference changed after proposal`);
        assert.equal(proposal.calls - reference.calls, -1, `${label}: expected one fewer fullscreen draw`);
        assert.ok(proposalAgain.counts.direct > 0, `${label}: adapter never used direct path`);
        if (viewport.width === 2560 && scale === 1) {
          const timing = await page.evaluate(frames => window.__aoProbe.measure(frames), sampleFrames);
          assert.equal(timing.glError, 0); assert.equal(timing.disjoint, 0);
          for (const variant of ['reference', 'proposal']) for (const kind of ['total', 'ao']) assert.ok(timing.gpu[variant][kind]?.n >= Math.floor(sampleFrames / 8), 'Insufficient completed GPU query samples');
          result.timings.push({ label, ...timing, totalReductionPercent: 100 * (1 - timing.gpu.proposal.total.mean / timing.gpu.reference.total.mean),
            aoReductionPercent: 100 * (1 - timing.gpu.proposal.ao.mean / timing.gpu.reference.ao.mean) });
          const after = await page.evaluate(v => window.__aoProbe.capture(v), false);
          evidence.referenceAfterTiming = pixelDiff(reference.pixels, Buffer.from(after.pixels, 'base64'));
          assert.equal(evidence.referenceAfterTiming.maxChannelDelta, 0, `${label}: frozen reference changed during paired timing`);
          console.log(JSON.stringify({ timingCase: label, gpu: timing.gpu, drawDelta: timing.calls.proposal.mean - timing.calls.reference.mean }));
        }
        // Precision reads and framebuffer binds are separate from the display
        // controls and timed frames. Their own controls identify inspection
        // side effects instead of silently attributing them to the AO proposal.
        if (viewport.width === 2560 && scale === 1 && !dof) {
          const linear = [];
          for (const v of [false, false, true, true, false]) {
            const row = await page.evaluate(proposed => window.__aoProbe.capturePrecision(proposed), v);
            linear.push(Buffer.from(row.pixels, 'base64'));
          }
          evidence.linearAo = { referenceRepeat: linearDiff(linear[0], linear[1], type === 'HDR'),
            proposalRepeat: linearDiff(linear[2], linear[3], type === 'HDR'), referenceAfterProposal: linearDiff(linear[0], linear[4], type === 'HDR'),
            comparison: linearDiff(linear[0], linear[2], type === 'HDR') };
          assert.equal(evidence.linearAo.referenceRepeat.changedComponents, 0, `${label}: linear AO reference is not deterministic`);
          assert.equal(evidence.linearAo.proposalRepeat.changedComponents, 0, `${label}: linear AO proposal is not deterministic`);
          assert.equal(evidence.linearAo.referenceAfterProposal.changedComponents, 0, `${label}: linear AO reference changed after proposal`);
        }
        evidence.framebufferStatuses = await page.evaluate(() => window.__aoProbe.inspectFramebuffers());
        const afterInspection = await page.evaluate(v => window.__aoProbe.capture(v), false);
        evidence.referenceAfterInspection = pixelDiff(reference.pixels, Buffer.from(afterInspection.pixels, 'base64'));
        assert.equal(evidence.referenceAfterInspection.maxChannelDelta, 0, `${label}: reference changed after precision/FBO inspection`);
      }
    }
    result[`${type.toLowerCase()}FailureRestore`] = await page.evaluate(() => window.__aoProbe.verifyFailure());
  }
  assert.deepEqual(result.errors, [], 'Runtime page errors');
  result.pixelEquivalent = result.pixels.every(row => row.comparison.maxChannelDelta === 0 && (!row.linearAo || row.linearAo.comparison.changedComponents === 0));
  result.passed = true;
} catch (error) {
  result.passed = false; result.failure = error.stack || error.message; process.exitCode = 1;
} finally {
  clearTimeout(deadline); await browser?.close();
  result.browserClosed = !browser?.isConnected();
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed, pixelEquivalent: result.pixelEquivalent, cases: result.pixels.length,
    failures: result.failure || null, report: `${output}/result.json`, proposalOnly: true, browserClosed: result.browserClosed }));
}

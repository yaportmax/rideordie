// Run manually: GAME_URL=http://127.0.0.1:5194 node tools/test/shadow_visual_compare.mjs
// Same frozen city scene, RTX/native 1440p, cached and ordinary sun shadows.
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.GAME_URL || 'http://127.0.0.1:5194';
const output = resolve(process.env.SHADOW_OUTPUT || 'shots/optimization/shadow-visual');
const secs = Number(process.env.SHADOW_SECONDS || 6);
const distance = Number(process.env.SHADOW_DISTANCE || 44000);
const budgetMs = Number(process.env.SHADOW_BUDGET_MS || 60000);
await mkdir(output, { recursive: true });
const errors = [], warnings = [];
let browser;
let result = { base, width: 2560, height: 1440, distance, secondsPerPhase: secs };
const deadline = setTimeout(() => {
  result.timedOut = true;
  void browser?.close();
}, budgetMs);
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    timeout: Math.min(15000, budgetMs),
    args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  await page.goto(`${base}/?solo&as=driver&s=${distance}&seed=7`);
  await page.waitForFunction(() => window.__ready && window.__run?.started && window.__game?.sky?.shadowCache, null, { timeout: 60000 });
  // Let terrain workers, dressing jobs, program compilation and uploads finish.
  await page.waitForTimeout(6000);
  await page.evaluate(() => { delete window.__autodrive; window.__forceInput = { throttle: 0, brake: 1 }; });
  await page.waitForFunction(() => {
    const g = window.__game, run = window.__run;
    return run.streamer?.pending?.size === 0 && (!run.dressing?._pending || run.dressing._pending() === 0) && !g._texQueue?.length;
  }, null, { timeout: 15000 });
  result.setup = await page.evaluate(() => {
    const g = window.__game, run = window.__run, p = g.post, renderer = g.renderer;
    const cache = g.sky.shadowCache, gl = renderer.getContext();
    if (!p || !cache?.enabled) throw new Error('Post pipeline or shadow cache unavailable');
    const gpuExt = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = gpuExt ? gl.getParameter(gpuExt.UNMASKED_RENDERER_WEBGL) : '';
    if (!/NVIDIA|RTX/i.test(gpu)) throw new Error(`RTX renderer required; got ${gpu || 'unidentified renderer'}`);
    p.autoResolution = false; p.setResolutionScale(1); p.setQuality(2, true); p.taa = false;
    if (p.internalSize.x !== 2560 || p.internalSize.y !== 1440) throw new Error(`Native 1440p required; got ${p.internalSize.x}x${p.internalSize.y}`);
    if (!p.profile(true)) throw new Error('GPU timer queries unavailable');
    const player = run.states.get(1);
    // Fixed road-facing viewpoint. Its position and projection stay identical
    // across both phases, including the light projection and caster selection.
    const target = g.camera.position.clone().set(0, 1.8, 65).applyQuaternion(player.quat).add(player.pos);
    g.camera.position.set(0, 2.5, -2.2).applyQuaternion(player.quat).add(player.pos);
    g.camera.lookAt(target); g.camera.updateMatrixWorld(true);
    g.sky.update(0, g.camera, player.pos);
    run.dressing?.setShadowFocus?.(g.sky.shadowFocus);
    g.scene.updateMatrixWorld(true);
    p.setFeatures({ mb: false, ca: false, grain: false, lines: false, dof: false, shafts: false });
    p._updateState(0); p._updateUniforms(1 / 60);
    p.lens.uniforms.get('mbAmount').value = 0;
    p.lens.uniforms.get('caAmount').value = 0;
    for (const shock of p.lens.uniforms.get('shock').value) shock.w = 0;
    p.shaftsPass.active = false; p.shafts.uniforms.get('shaftCol').value.set(0, 0, 0);
    p.dofPass.enabled = false;
    if (p.aoPass) p.aoPass.configuration.accumulate = false;
    p.finalEffect.uniforms.get('fxA').value.z = 0;
    p.finalEffect.uniforms.get('fxA').value.w = 0;
    p.finalEffect.uniforms.get('fxB').value.set(0, 0, 0, 0); // lines, grain, dither, seed
    p.finalEffect.uniforms.get('fxC').value.z = 0;
    p.finalEffect.uniforms.get('fxC').value.w = 0;
    // Do not call Run.update, SkyRig.update/setLook, Fx.update or camera update.
    // Freezing only sim.step would still animate their actual rendered scene.
    p._updateState = () => {};
    p._updateUniforms = () => {};
    const state = window.__shadowCompare = { collect: false, gpu: {}, calls: [], scanMs: [], projectionChanges: 0 };
    const originalScan = cache._scan;
    cache._scan = function (...args) {
      const start = performance.now();
      try { return originalScan.apply(this, args); }
      finally { if (state.collect) state.scanMs.push(performance.now() - start); }
    };
    const originalProjection = cache._projectionChanged;
    cache._projectionChanged = function (...args) {
      const changed = originalProjection.apply(this, args);
      if (state.collect && changed) state.projectionChanges++;
      return changed;
    };
    const setLast = p.timer.last.set.bind(p.timer.last);
    p.timer.last.set = (name, ms) => {
      if (state.collect) (state.gpu[name] ||= []).push(ms);
      return setLast(name, ms);
    };
    renderer.info.autoReset = false;
    g.frame = () => {
      renderer.info.reset();
      // Keep the mirror texture and cadence deterministic; measure it outside
      // the main scene query. PMREM is frozen with the sky and never rebuilt.
      const cockpit = run.cockpit;
      if (cockpit?.active) {
        cockpit.frame = 0;
        p.timer.begin('mirrors');
        cockpit.renderMirrors(renderer, g.scene, run.wv.cars.get(1)?.view.root);
        p.timer.end();
      }
      const mirrorCalls = renderer.info.render.calls;
      p.render(1 / 60);
      if (state.collect) state.calls.push({ scene: p.stats.calls - mirrorCalls, mirrors: mirrorCalls, total: renderer.info.render.calls });
    };
    renderer.domElement.dataset.shadowProbe = 'true';
    state.signature = () => {
      const rows = [];
      g.scene.traverse(object => {
        rows.push([object.uuid, object.visible, object.castShadow, object.position.toArray(), object.quaternion.toArray(), object.scale.toArray(),
          object.geometry?.uuid, object.geometry?.attributes?.position?.version, object.instanceMatrix?.version, object.count]);
      });
      const light = g.sky.sun, sh = light.shadow;
      rows.push(['camera', g.camera.position.toArray(), g.camera.quaternion.toArray(), g.camera.projectionMatrix.toArray()]);
      rows.push(['sun', light.position.toArray(), light.target.position.toArray(), sh.mapSize.toArray(), sh.camera.projectionMatrix.toArray()]);
      rows.push(['clocks', run.time, g.sky._time, g.sky.U.uTime.value, g.sky.U.uCloud.value.w]);
      return JSON.stringify(rows);
    };
    state.baseline = state.signature();
    const glError = gl.getError();
    if (glError !== gl.NO_ERROR) throw new Error(`WebGL error before measurement: ${glError}`);
    return { gpu, distance: run.playerS, internal: p.internalSize.toArray(), quality: p.quality,
      samples: p.scenePass.samples, shadowSize: g.sky.sun.shadow.mapSize.toArray(), mirrorActive: !!run.cockpit?.active,
      frozen: ['run', 'sky', 'fx', 'camera', 'post uniforms', 'PMREM'], dynamicEffects: false };
  });
  for (const enabled of [true, false]) {
    const label = enabled ? 'cached' : 'ordinary';
    result[label] = await page.evaluate(async ({ enabled, seconds }) => {
      const g = window.__game, state = window.__shadowCompare, p = g.post, cache = g.sky.shadowCache;
      cache.enabled = enabled;
      if (enabled) cache.invalidate();
      state.collect = false;
      await new Promise(resolveWait => setTimeout(resolveWait, 1500));
      if (enabled && (!cache.enabled || !cache.valid || !cache.copyValidated)) throw new Error('Shadow cache did not validate its depth copy');
      if (state.signature() !== state.baseline) throw new Error('Rendered scene or projection changed while settling');
      const before = { ...cache.stats };
      state.gpu = {}; state.calls = []; state.scanMs = []; state.projectionChanges = 0;
      p.timer.reset(); state.collect = true;
      const frames = [], start = performance.now(); let last = start;
      await new Promise(done => {
        const tick = now => { frames.push(now - last); last = now; if (now - start < seconds * 1000) requestAnimationFrame(tick); else done(); };
        requestAnimationFrame(tick);
      });
      state.collect = false;
      const summary = values => {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        return { n: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
          p50: sorted[Math.floor((sorted.length - 1) * 0.5)], p95: sorted[Math.floor((sorted.length - 1) * 0.95)], max: sorted.at(-1) };
      };
      const glError = g.renderer.getContext().getError();
      const unchanged = state.signature() === state.baseline;
      const reuses = cache.stats.reuses - before.reuses, refreshes = cache.stats.refreshes - before.refreshes;
      if (glError !== 0 || !unchanged || state.projectionChanges || (enabled && (!cache.enabled || reuses === 0 || refreshes !== 0))) {
        throw new Error(JSON.stringify({ label: enabled ? 'cached' : 'ordinary', glError, unchanged, reuses, refreshes, projectionChanges: state.projectionChanges, cacheEnabled: cache.enabled }));
      }
      return { frameMs: summary(frames), gpuMs: Object.fromEntries(Object.entries(state.gpu).map(([key, values]) => [key, summary(values)])),
        sceneCalls: summary(state.calls.map(row => row.scene)), mirrorCalls: summary(state.calls.map(row => row.mirrors)),
        frameCalls: summary(state.calls.map(row => row.total)), scanCpuMs: summary(state.scanMs), cacheStats: { ...cache.stats },
        reuses, refreshes, projectionChanges: state.projectionChanges, glError, unchanged };
    }, { enabled, seconds: secs });
    await page.locator('canvas[data-shadow-probe="true"]').screenshot({ path: `${output}/${label}.png` });
  }
  result.sceneGpuReductionPercent = 100 * (1 - result.cached.gpuMs.scene.mean / result.ordinary.gpuMs.scene.mean);
  // pngjs is optional. Both full-resolution PNGs are always kept for review.
  try {
    const { PNG } = await import('pngjs');
    const a = PNG.sync.read(await readFile(`${output}/cached.png`)), b = PNG.sync.read(await readFile(`${output}/ordinary.png`));
    if (a.width !== b.width || a.height !== b.height) throw new Error('PNG size mismatch');
    let changed = 0, sum = 0, max = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      let pixel = 0;
      for (let channel = 0; channel < 3; channel++) { const delta = Math.abs(a.data[i + channel] - b.data[i + channel]); sum += delta; max = Math.max(max, delta); pixel += delta; }
      if (pixel) changed++;
    }
    result.pixelDiff = { changedPixels: changed, changedPercent: 100 * changed / (a.width * a.height), meanChannelDelta: sum / (a.width * a.height * 3), maxChannelDelta: max };
  } catch (error) { result.pixelDiff = { available: false, reason: error.message, review: ['cached.png', 'ordinary.png'] }; }
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  result.passed = true;
} catch (error) {
  result.passed = false; result.failure = error.stack || error.message;
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  result.errors = errors; result.warnings = warnings;
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser?.close();
}

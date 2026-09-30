// Exact synchronous Game.frame CPU costs, including work after Post.render.
// One installed-Chrome RTX page, native 2560x1440 High ceiling, real combat.
// GAME_URL=http://127.0.0.1:5194 ROLE=driver S=44000 SPAN=30 FRAME_MODE=phases
// FRAME_MODE=baseline keeps only the outer frame monitor. FRAME_MODE=profile
// adds CDP sampling to that baseline in a separate run, never phase wrappers.
// FRAME_AUTO_RESOLUTION=0 disables adaptive scaling for a fixed native test.
// FRAME_OUTPUT selects an isolated output directory. --dry-run never launches.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const cfg = {
  base: process.env.GAME_URL || 'http://127.0.0.1:5194',
  role: process.env.ROLE || 'driver', s: Number(process.env.S || 44000),
  span: Number(process.env.SPAN || 30), warmup: Number(process.env.FRAME_WARMUP || 10),
  mode: process.env.FRAME_MODE || 'phases', autoResolution: process.env.FRAME_AUTO_RESOLUTION !== '0',
  output: process.env.FRAME_OUTPUT || `shots/frame-cost/${new Date().toISOString().replace(/[:.]/g, '-')}`,
};
if (!['driver', 'gunner', 'solo'].includes(cfg.role) || !['baseline', 'phases', 'profile'].includes(cfg.mode)
  || !Number.isFinite(cfg.s) || !(cfg.span > 0 && cfg.span <= 180) || !(cfg.warmup >= 0 && cfg.warmup <= 60)) {
  throw new Error('Invalid ROLE, S, SPAN, FRAME_WARMUP or FRAME_MODE');
}
const gameUrl = new URL(cfg.base);
gameUrl.searchParams.set('solo', ''); gameUrl.searchParams.set('as', cfg.role);
gameUrl.searchParams.set('s', String(cfg.s)); gameUrl.searchParams.set('seed', '7'); gameUrl.searchParams.set('weapons', 'smg');
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ ...cfg, gameUrl: gameUrl.href, viewport: [2560, 1440], launch: false }));
} else {
  await mkdir(cfg.output, { recursive: true });
  let browser, page, cdp, profileStarted = false;
  const errors = [], warnings = [], failures = [];
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'] });
    page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) failures.push({ status: r.status(), url: r.url() }); });
    await page.goto(gameUrl.href);
    await page.waitForFunction(() => window.__ready && window.__run?.started, null, { timeout: 180000 });
    const setup = await page.evaluate(({ autoResolution, role }) => {
      const g = window.__game, r = g.run;
      g.setQuality(2); g.post.profile(false); g.post.setResolutionScale(1); g.post.autoResolution = autoResolution;
      window.__autodrive = { speed: 30 };
      if (role === 'gunner') {
        window.__forceGunner = { slot: 1, fire: true };
        const gunner = r.gunner, original = gunner.update;
        // Match smoothness.mjs: compensate recoil toward the moving road.
        gunner.update = function(dt, cmd, cam, carYaw, extra) {
          this.yaw = carYaw; this.pitch = -0.03; return original.call(this, dt, cmd, cam, carYaw, extra);
        };
      }
      const gl = g.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), quality: g.quality,
        viewport: [innerWidth, innerHeight], scale: g.post.resolutionScale, sceneNodes: (() => { let n = 0; g.scene.traverse(() => n++); return n; })() };
    }, cfg);
    await page.waitForTimeout(cfg.warmup * 1000);
    if (cfg.mode === 'profile') {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
      await cdp.send('Profiler.start'); profileStarted = true;
    }
    const result = await page.evaluate(({ span, mode }) => {
      const g = window.__game, r = g.run;
      if (r.over || g.mode !== 'run') throw new Error('Run ended during warm-up; choose a shorter FRAME_WARMUP or another start point');
      const labels = ['Game.frame', 'Game.runFrame', 'Input.poll', 'Input.commands', 'Textures.pump', 'Audio.update',
        'Audio.bridge', 'Audio.car', 'Audio.event', 'Audio.listener', 'Audio.interval', 'Run.update', 'Sim.step', 'Sim.physics', 'Sim.projectiles', 'Sim.ai', 'Run.camera',
        'Run.gunnerEye', 'Run.frustum', 'Run.hudData', 'Gunner.update', 'AI.driver', 'AI.gunner',
        'Terrain.update', 'Terrain.message', 'Dressing.update', 'Dressing.jobs', 'Dressing.pool', 'WorldView.update', 'WorldView.ensure',
        'WorldView.boss', 'Car.update', 'Crew.update', 'ViewModel.update', 'ViewModel.arms', 'DriverArms.update',
        'Cockpit.update', 'Cockpit.mirrors', 'ThreatHUD.update', 'Hud.update', 'GunnerHud.update', 'Sky.look',
        'Sky.update', 'Sky.environment', 'NightLights.update', 'Post.render', 'Post.state', 'Post.uniforms',
        'Post.resize', 'ScenePass.render', 'Renderer.render', 'Shadow.render', 'Shadow.scan', 'Shadow.native',
        'Shadow.copy', 'Fx.update', 'Fx.car', 'Fx.event', 'Fx.projectiles'];
      const ids = new Map(labels.map((name, i) => [name, i])), count = labels.length;
      const capacity = Math.ceil(span * 240) + 120, metaCount = 12;
      // Allocate outside the timed frames. Avoid a record allocation per nested
      // call, which would manufacture GC pressure in the diagnostic itself.
      const inclusive = new Float64Array(capacity * count), exclusive = new Float64Array(capacity * count);
      const calls = new Uint16Array(capacity * count), metadata = new Float64Array(capacity * metaCount);
      const stackChild = new Float64Array(96), restorations = [], patched = new WeakMap(), coverage = new Set();
      const outside = [], frameErrors = [], measurementStart = performance.now();
      let depth = 0, frame = -1, active = false, measuring = true, size = 0, first = 0, last = 0, overflow = false, timedOut = false;
      const wrap = (obj, key, label, external = false) => {
        if (!obj || typeof obj[key] !== 'function') return;
        let names = patched.get(obj); if (!names) { names = new Set(); patched.set(obj, names); }
        if (names.has(key)) return;
        names.add(key); const original = obj[key], id = ids.get(label), own = Object.hasOwn(obj, key);
        const wrapped = function(...args) {
          if (!active) {
            if (!external || !measuring) return original.apply(this, args);
            const at = performance.now();
            try { return original.apply(this, args); }
            finally { outside.push({ label, at: at - measurementStart, cpu: performance.now() - at }); }
          }
          const at = performance.now(), level = depth++, offset = frame * count + id; stackChild[level] = 0;
          try { return original.apply(this, args); }
          finally {
            const elapsed = performance.now() - at; depth--;
            inclusive[offset] += elapsed; exclusive[offset] += elapsed - stackChild[level]; calls[offset]++;
            if (level) stackChild[level - 1] += elapsed;
          }
        };
        obj[key] = wrapped; coverage.add(label);
        restorations.push(() => { if (obj[key] === wrapped) { if (own) obj[key] = original; else delete obj[key]; } });
      };
      const proto = obj => obj && Object.getPrototypeOf(obj);
      const discover = () => {
        for (const car of r.sim?.cars.values() || []) wrap(proto(car.ai), 'update', 'Sim.ai');
        for (const rec of r.wv?.cars.values() || []) {
          wrap(proto(rec.view), 'update', 'Car.update');
          for (const { crew } of rec.crewEntries || []) {
            wrap(proto(crew), 'update', 'Crew.update');
            wrap(proto(crew.vm), 'update', 'ViewModel.update'); wrap(proto(crew.vm), '_arms', 'ViewModel.arms');
            wrap(proto(crew.drvArms), 'update', 'DriverArms.update');
          }
        }
      };
      if (mode === 'phases') {
        for (const [obj, key, label] of [
          [g, '_runFrame', 'Game.runFrame'], [g.input, 'poll', 'Input.poll'],
          ...['solo', 'driver', 'gunner'].map(key => [g.input, key, 'Input.commands']),
          [g, '_pumpTextures', 'Textures.pump'], [g.audio, 'update', 'Audio.update'], [r.abridge, 'update', 'Audio.bridge'],
          [r.abridge, 'updateCar', 'Audio.car'], [r.abridge, 'handleEvent', 'Audio.event'], [g.audio?.listener, 'update', 'Audio.listener'],
          [r, 'update', 'Run.update'], [r.sim, 'step', 'Sim.step'], [r.sim?.world, 'step', 'Sim.physics'],
          [r.sim?.projectiles, 'update', 'Sim.projectiles'], [r.sim?.ai, 'update', 'Sim.ai'],
          [r, '_camera', 'Run.camera'], [r, '_gunnerEye', 'Run.gunnerEye'], [r, '_updateFrustum', 'Run.frustum'], [r, '_hudData', 'Run.hudData'],
          [r.gunner, 'update', 'Gunner.update'], [r.aiDriver, 'update', 'AI.driver'], [r.aiGunner, 'update', 'AI.gunner'],
          [r.streamer, 'update', 'Terrain.update'], [r.dressing, 'update', 'Dressing.update'], [r.dressing, '_jobs', 'Dressing.jobs'],
          [r.dressing?.pool, 'rebuild', 'Dressing.pool'], [r.wv, 'update', 'WorldView.update'], [r.wv, 'ensure', 'WorldView.ensure'],
          [r.wv, 'updateBoss', 'WorldView.boss'], [r.cockpit, 'update', 'Cockpit.update'], [r.cockpit, 'renderMirrors', 'Cockpit.mirrors'],
          [r.threatHud, 'update', 'ThreatHUD.update'], [g.hud, 'update', 'Hud.update'], [g.hud?.gh, 'update', 'GunnerHud.update'],
          [g.sky, 'setLook', 'Sky.look'], [g.sky, 'update', 'Sky.update'], [g.sky, 'rebuildEnv', 'Sky.environment'], [g.lampLights, 'update', 'NightLights.update'],
          [g.post, 'render', 'Post.render'], [g.post, '_updateState', 'Post.state'], [g.post, '_updateUniforms', 'Post.uniforms'],
          [g.post, '_applyInternalSize', 'Post.resize'], [g.post?.scenePass, 'render', 'ScenePass.render'], [g.renderer, 'render', 'Renderer.render'],
          [g.sky?.shadowCache, 'render', 'Shadow.render'], [g.sky?.shadowCache, '_scan', 'Shadow.scan'],
          [g.sky?.shadowCache, 'original', 'Shadow.native'], [g.sky?.shadowCache, '_copyDepth', 'Shadow.copy'],
          [g.fx, 'update', 'Fx.update'], [g.fx, 'updateCar', 'Fx.car'], [g.fx, 'handleEvent', 'Fx.event'], [g.fx, 'updateProjectiles', 'Fx.projectiles'],
        ]) wrap(obj, key, label);
        wrap(r.streamer, '_onMsg', 'Terrain.message', true); wrap(g.audio, '_tickFast', 'Audio.interval', true);
        discover();
      }
      const originalFrame = g.frame, started = performance.now(), shots = r.shots;
      let done;
      const promise = new Promise(resolve => { done = resolve; });
      let deadline;
      const restore = () => { measuring = false; clearTimeout(deadline); g.frame = originalFrame; for (let i = restorations.length - 1; i >= 0; i--) restorations[i](); };
      g.frame = function(now) {
        if (size >= capacity) { overflow = true; restore(); done(); return originalFrame.call(this, now); }
        const monitorAt = performance.now();
        if (mode === 'phases') discover();
        frame = size++; depth = 1; stackChild[0] = 0; active = true;
        const delta = now - this.last, at = performance.now(); if (!first) first = now;
        try { return originalFrame.call(this, now); }
        catch (error) { frameErrors.push(String(error?.stack || error)); restore(); done(); throw error; }
        finally {
          const elapsed = performance.now() - at; active = false;
          const offset = frame * count, mo = frame * metaCount;
          inclusive[offset] = elapsed; exclusive[offset] = elapsed - stackChild[0]; calls[offset] = 1;
          metadata.set([at - measurementStart, delta, elapsed, r.states.size, r.sim?.projectiles.bullets.length || 0,
            g.post.resolutionScale, r.playerS, r.over ? 1 : 0, g.renderer.info.programs?.length || 0,
            g.post.stats.calls, g.post.stats.triangles, performance.now() - monitorAt], mo);
          last = now;
          if (performance.now() - started >= span * 1000 || r.over || g.mode !== 'run') { restore(); done(); }
        }
      };
      deadline = setTimeout(() => { timedOut = true; restore(); done(); }, (span + 15) * 1000);
      return promise.then(() => {
        const rows = [];
        for (let i = 0; i < size; i++) {
          const mo = i * metaCount, costs = {};
          for (let j = 0; j < count; j++) {
            const offset = i * count + j;
            if (calls[offset]) costs[labels[j]] = { calls: calls[offset], inclusive: inclusive[offset], exclusive: exclusive[offset] };
          }
          rows.push({ frame: i, at: metadata[mo], rafDelta: metadata[mo + 1], cpu: metadata[mo + 2], cars: metadata[mo + 3],
            bullets: metadata[mo + 4], scale: metadata[mo + 5], s: metadata[mo + 6], over: !!metadata[mo + 7],
            programs: metadata[mo + 8], draws: metadata[mo + 9], triangles: metadata[mo + 10], monitorCpu: metadata[mo + 11], costs });
        }
        const gl = g.renderer.getContext();
        return { rows, coverage: [...coverage], missingPhases: mode === 'phases' ? labels.filter(n => n !== 'Game.frame' && !coverage.has(n)) : [],
          measuredSeconds: (last - first) / 1000, over: r.over, shots: r.shots - shots, overflow, timedOut, frameErrors, outside,
          scale: g.post.resolutionScale, glError: gl.getError(), programs: g.renderer.info.programs?.length,
          hitches: window.__hitches || [], limitation: 'Synchronous wall-time CPU attribution. It includes native driver stalls inside calls, excludes GPU execution and browser/compositor work outside Game.frame. Outside-frame terrain worker handlers and audio intervals are captured separately in phases mode. A rAF gap can originate in the preceding frame; slow rows include both frames and intervening outside tasks. Nested inclusive totals overlap and must not be summed.' };
      });
    }, cfg);
    let sampled = null;
    if (profileStarted) {
      const { profile } = await cdp.send('Profiler.stop'); profileStarted = false;
      await writeFile(`${cfg.output}/cpu-profile.json`, JSON.stringify(profile));
      const nodes = new Map(profile.nodes.map(n => [n.id, n])), self = new Map();
      for (let i = 0; i < (profile.samples || []).length; i++) {
        const n = nodes.get(profile.samples[i]), cf = n.callFrame;
        // Minified bundles put unrelated functions on one line. Keep the
        // column so their costs do not collapse into an ambiguous function.
        const key = `${cf.functionName || '(anonymous)'} ${cf.url || '(native)'}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`;
        self.set(key, (self.get(key) || 0) + (profile.timeDeltas[i] || 0) / 1000);
      }
      sampled = { sampledSpanMs: (profile.endTime - profile.startTime) / 1000,
        topSelf: [...self].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([functionName, selfMs]) => ({ functionName, selfMs })) };
    }
    const distribution = values => {
      const a = values.slice().sort((x, y) => x - y), q = p => a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
      return { mean: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) };
    };
    const phaseNames = [...new Set(result.rows.flatMap(r => Object.keys(r.costs)))];
    const phases = Object.fromEntries(phaseNames.map(name => [name, {
      inclusiveMsPerFrame: distribution(result.rows.map(r => r.costs[name]?.inclusive || 0)),
      exclusiveMsPerFrame: distribution(result.rows.map(r => r.costs[name]?.exclusive || 0)),
      totalCalls: result.rows.reduce((n, r) => n + (r.costs[name]?.calls || 0), 0),
    }]));
    const slow = result.rows.flatMap((row, i) => row.rafDelta > 25 || row.cpu > 16.7 ? [{ current: row, previous: result.rows[i - 1] || null,
      outside: result.outside.filter(t => t.at >= (result.rows[i - 1]?.at || 0) && t.at <= row.at) }] : []);
    const gaps = result.rows.map(r => r.rafDelta), totalGap = gaps.reduce((a, b) => a + b, 0);
    const summary = { cfg, setup, frames: result.rows.length, frameTime: distribution(gaps), cpuFrame: distribution(result.rows.map(r => r.cpu)),
      averageFps: result.rows.length * 1000 / totalGap, over25: gaps.filter(t => t > 25).length,
      over33: gaps.filter(t => t > 33.4).length, phases, slowFrames: slow.length, ...result, rows: undefined,
      outsideTasks: Object.fromEntries([...new Set(result.outside.map(t => t.label))].map(label => [label,
        { calls: result.outside.filter(t => t.label === label).length, cpu: distribution(result.outside.filter(t => t.label === label).map(t => t.cpu)) }])),
      sampled, errors, warnings: [...new Set(warnings)], failures };
    await writeFile(`${cfg.output}/summary.json`, JSON.stringify(summary, null, 2));
    await writeFile(`${cfg.output}/frames.json`, JSON.stringify(result.rows));
    await writeFile(`${cfg.output}/slow-frames.json`, JSON.stringify(slow, null, 2));
    await page.screenshot({ path: `${cfg.output}/final.png`, timeout: 30000 });
    console.log(JSON.stringify({ output: cfg.output, mode: cfg.mode, frames: summary.frames, averageFps: summary.averageFps,
      frameTime: summary.frameTime, cpuFrame: summary.cpuFrame, slowFrames: summary.slowFrames, over: summary.over,
      scale: summary.scale, errors, glError: summary.glError, topExclusive: Object.entries(phases)
        .sort((a, b) => b[1].exclusiveMsPerFrame.mean - a[1].exclusiveMsPerFrame.mean).slice(0, 12) }));
  } finally {
    if (profileStarted) { try { await cdp.send('Profiler.stop'); } catch { /* browser might have failed */ } }
    if (page && !page.isClosed()) { try { await page.evaluate(() => { window.__forceGunner = null; window.__autodrive = null; }); } catch { /* closed/crashed */ } }
    await browser?.close();
  }
}

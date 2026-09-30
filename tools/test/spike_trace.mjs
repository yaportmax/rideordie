// Bounded cold-path spike diagnostic, one installed Chrome RTX page at a time.
// GAME_URL=http://127.0.0.1:5194 ROLE=gunner S=44000 SPAN=45
// SPIKE_FIRE_TIMING=after-warm (default) | before-warm; SPIKE_WARMUP=10.
// SPIKE_AUTOPLAY=1 enables audio without a gesture; default off matches smoothness.
// SPIKE_EXPECT_BUNDLE=index-HhbXtVxx.js rejects accidental candidate drift.
// SPIKE_OUTPUT selects an isolated directory. --dry-run never launches.
// No GPU timer queries, CDP sampling, per-node hooks, or hot-path serialization.
// GL allocation hooks are numeric counters; only slow/large calls emit events.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const cfg = {
  base: process.env.GAME_URL || 'http://127.0.0.1:5194',
  role: process.env.ROLE || 'gunner', s: Number(process.env.S || 44000),
  span: Number(process.env.SPAN || 45), warmup: Number(process.env.SPIKE_WARMUP || 10),
  fireTiming: process.env.SPIKE_FIRE_TIMING || 'after-warm', slot: Number(process.env.SPIKE_SLOT || 1),
  autoResolution: process.env.SPIKE_AUTO_RESOLUTION !== '0',
  autoplay: process.env.SPIKE_AUTOPLAY === '1',
  expectedBundle: process.env.SPIKE_EXPECT_BUNDLE || 'index-HhbXtVxx.js',
  output: process.env.SPIKE_OUTPUT || `shots/spike-trace/${new Date().toISOString().replace(/[:.]/g, '-')}`,
};
if (!['gunner', 'solo'].includes(cfg.role) || !['after-warm', 'before-warm'].includes(cfg.fireTiming)
  || !Number.isFinite(cfg.s) || !(cfg.span > 0 && cfg.span <= 180)
  || !(cfg.warmup >= 0 && cfg.warmup <= 60) || !Number.isInteger(cfg.slot) || cfg.slot < 0 || cfg.slot > 2) {
  throw new Error('Invalid ROLE, S, SPAN, SPIKE_WARMUP, SPIKE_SLOT or SPIKE_FIRE_TIMING');
}
const gameUrl = new URL(cfg.base);
for (const [k, v] of Object.entries({ solo: '', as: cfg.role, s: cfg.s, seed: 7, weapons: 'smg' })) gameUrl.searchParams.set(k, String(v));

// This function is serialized into the page before its application starts.
function installTrace(options) {
  const phaseNames = ['startup', 'warmup', 'measurement', 'finished'];
  const labels = ['ready', 'warmup-end', 'fire-start', 'run-create', 'run-started', 'new-car-crew', 'boss-create',
    'texture-init', 'texture-pump', 'audio-interval', 'audio-meter', 'terrain-message', 'resolution-change',
    'program-addition', 'weapon-change', 'reload-start', 'reload-end', 'longtask', 'gc', 'game-event', 'failure', 'stop',
    'buffer-data', 'buffer-create', 'lod-transition'];
  const ids = new Map(labels.map((name, i) => [name, i]));
  const columns = ['rafTimestamp', 'cpuStart', 'rafDelta', 'cpu', 'monitorCpu', 'phase', 'cars', 'bullets',
    'scale', 'playerS', 'gunnerShots', 'allShots', 'slot', 'mag', 'reloading', 'over', 'programs', 'draws',
    'runCpu', 'postCpu', 'pumpCpu', 'textureCpu', 'textureCalls', 'newEnsureCpu', 'newCars', 'audioInsideFrameCpu', 'terrainInsideFrameCpu',
    'bufferDataCpu', 'bufferDataCalls', 'bufferDataBytes', 'createBufferCalls', 'lodCpu', 'lodTransitions'];
  const eventColumns = ['at', 'duration', 'phase', 'frame', 'insideFrame', 'label', 'a', 'b', 'c', 'detail'];
  const frameCapacity = Math.ceil((options.warmup + options.span + 15) * 240) + 12000;
  const eventCapacity = 30000;
  const frames = new Float64Array(frameCapacity * columns.length);
  const events = new Float64Array(eventCapacity * eventColumns.length);
  const cost = new Float64Array(15), details = [], detailIds = new Map(), restorations = [], observers = [], observedTypes = [];
  const allocationTotals = { bufferDataCalls: 0, bufferDataBytes: 0, bufferDataCpu: 0, createBufferCalls: 0, createBufferCpu: 0 };
  const patched = new WeakMap(), coverage = new Set(), hookErrors = [];
  const supportedObservers = typeof PerformanceObserver === 'function' ? PerformanceObserver.supportedEntryTypes || [] : [];
  let phase = 0, frameSize = 0, eventSize = 0, activeFrame = -1, lastFrame = -1, droppedEvents = 0;
  let game, run, readyAt = null, measurementStart = null, stoppedAt = null, fireAt = null, reason = null;
  let programArray, lastWeapon = null, lastReload = false, deadline, doneResolve, acceptingEvents = true;
  let oldAutoDrive, oldForceGunner;
  const seenPrograms = new Set();
  const done = new Promise(resolve => { doneResolve = resolve; });
  const detail = (key, value) => {
    let id = detailIds.get(key);
    if (id === undefined) { id = details.length; detailIds.set(key, id); details.push(value); }
    return id + 1; // Zero means no metadata.
  };
  const event = (label, at, duration = 0, a = 0, b = 0, c = 0, meta = 0) => {
    if (!acceptingEvents) return;
    if (eventSize >= eventCapacity) { droppedEvents++; return; }
    const base = eventSize++ * eventColumns.length;
    events[base] = at; events[base + 1] = duration; events[base + 2] = phase;
    events[base + 3] = activeFrame >= 0 ? activeFrame : lastFrame;
    events[base + 4] = activeFrame >= 0 ? 1 : 0; events[base + 5] = ids.get(label);
    events[base + 6] = a; events[base + 7] = b; events[base + 8] = c; events[base + 9] = meta;
  };
  const hook = (obj, key, make) => {
    if (!obj || typeof obj[key] !== 'function') return;
    let keys = patched.get(obj); if (!keys) { keys = new Set(); patched.set(obj, keys); }
    if (keys.has(key)) return;
    const original = obj[key], own = Object.hasOwn(obj, key), wrapped = make(original);
    obj[key] = wrapped; keys.add(key); coverage.add(key);
    restorations.push(() => { if (obj[key] === wrapped) { if (own) obj[key] = original; else delete obj[key]; } });
  };
  // Watch an assignment once, then restore a plain data property before the
  // runtime starts reading it every frame. Original descriptors survive cleanup.
  const watch = (obj, key, accept, onValue) => {
    const original = Object.getOwnPropertyDescriptor(obj, key);
    if (original && (!original.configurable || !Object.hasOwn(original, 'value'))) {
      hookErrors.push(`Cannot watch ${key}`); if (accept(obj[key])) onValue(obj[key]); return;
    }
    let value = original?.value, assigned = false, retired = false;
    const data = () => ({ configurable: original?.configurable ?? true, enumerable: original?.enumerable ?? true,
      writable: original?.writable ?? true, value });
    const getter = () => value;
    const setter = next => {
      value = next; assigned = true;
      if (accept(next)) {
        Object.defineProperty(obj, key, data()); retired = true;
        try { onValue(next); } catch (error) { hookErrors.push(`${key}: ${String(error)}`); }
      }
    };
    if (accept(value)) { onValue(value); return; }
    Object.defineProperty(obj, key, { configurable: true, enumerable: original?.enumerable ?? true, get: getter, set: setter });
    restorations.push(() => {
      if (retired) return;
      if (Object.getOwnPropertyDescriptor(obj, key)?.get !== getter) return;
      if (original || assigned) Object.defineProperty(obj, key, data()); else delete obj[key];
    });
  };
  const timed = (obj, key, label, costIndex, shouldRecord = () => true, metadata) => hook(obj, key, original => function() {
    const at = performance.now();
    try { return original.apply(this, arguments); }
    finally {
      const duration = performance.now() - at;
      if (activeFrame >= 0 && costIndex >= 0) cost[costIndex] += duration;
      if (shouldRecord.call(this, arguments, duration)) {
        const m = metadata?.call(this, arguments) || [0, 0, 0, 0];
        event(label, at, duration, m[0], m[1], m[2], m[3]);
      }
    }
  });
  const registerAudio = audio => {
    timed(audio, '_tickFast', 'audio-interval', 7);
    timed(audio, '_tickMeter', 'audio-meter', -1);
  };
  const registerCar = view => hook(Object.getPrototypeOf(view), 'setLod', original => function(far) {
    if (!this.lod || far === this.lodOn) return original.call(this, far);
    const at = performance.now(), prior = this.lodOn;
    try { return original.call(this, far); }
    finally {
      const duration = performance.now() - at;
      if (activeFrame >= 0) { cost[13] += duration; cost[14]++; }
      event('lod-transition', at, duration, this.root?.userData?.carId || 0, prior ? 1 : 0, this.lodOn ? 1 : 0,
        detail(`lod:${this.root?.userData?.carId}:${this.spec?.id}`, { carId: this.root?.userData?.carId, specId: this.spec?.id }));
    }
  });
  const registerWorld = world => {
    for (const rec of world.cars.values()) registerCar(rec.view);
    hook(world, 'ensure', original => function(st) {
      const prior = this.cars.get(st.id);
      if (prior && prior.specId === st.specId) return original.call(this, st);
      const at = performance.now(); let rec;
      try { return rec = original.call(this, st); }
      finally {
        const duration = performance.now() - at;
        if (activeFrame >= 0) { cost[5] += duration; cost[6]++; }
        if (rec?.view) registerCar(rec.view);
        const crews = rec?.crewEntries?.length ?? Object.keys(rec?.crew || {}).length;
        const meta = detail(`car:${st.id}:${st.specId}`, { carId: st.id, specId: st.specId, kind: st.kind,
          gunName: st.gunName, crewRoles: rec?.crewEntries?.map(c => c.role) || [], rebuilt: !!prior,
          scope: 'Combined new CarView, CrewView, attachment and registration; constructors are lexical and not separately hooked.' });
        event('new-car-crew', at, duration, st.id, crews, prior ? 1 : 0, meta);
      }
    });
    hook(world, 'updateBoss', original => function() {
      if (this.boss || !arguments[0]) return original.apply(this, arguments);
      const at = performance.now();
      try { return original.apply(this, arguments); }
      finally { event('boss-create', at, performance.now() - at, this.boss ? 1 : 0); }
    });
  };
  const registerRun = next => {
    run = next;
    watch(run, 'started', v => v === true, () => event('run-started', performance.now()));
    watch(run, 'streamer', Boolean, streamer => timed(streamer, '_onMsg', 'terrain-message', 8, undefined,
      args => [args[1]?.chunk ?? 0, args[1]?.lod ?? -1, args[1]?.type === 'chunk' ? 1 : 0, 0]));
    watch(run, 'wv', Boolean, registerWorld);
    hook(run, 'update', original => function() {
      const at = performance.now();
      try { return original.apply(this, arguments); }
      finally { if (activeFrame >= 0) cost[0] += performance.now() - at; }
    });
  };
  const registerPost = post => {
    post.profile(false);
    hook(post, 'render', original => function() {
      const at = performance.now();
      try { return original.apply(this, arguments); }
      finally { if (activeFrame >= 0) cost[1] += performance.now() - at; }
    });
    hook(post, '_applyInternalSize', original => function() {
      const width = this._internal?.x || 0, height = this._internal?.y || 0, at = performance.now();
      try { return original.apply(this, arguments); }
      finally {
        if (width !== this._internal?.x || height !== this._internal?.y) {
          event('resolution-change', at, performance.now() - at, this._internal?.x || 0, this._internal?.y || 0,
            this.resolutionScale, detail(`resize:${eventSize}`, { old: [width, height], next: this._internal?.toArray() }));
        }
      }
    });
  };
  const recordProgram = (p, length) => {
    if (!seenPrograms.has(p.id)) {
      seenPrograms.add(p.id);
      event('program-addition', performance.now(), 0, p.id, length, 0,
        detail(`program:${p.id}`, { id: p.id, name: p.name, cacheKey: p.cacheKey }));
    }
  };
  const checkPrograms = () => {
    const list = game?.renderer?.info?.programs;
    if (!list || list === programArray) return;
    programArray = list;
    for (const p of list) recordProgram(p, list.length);
    // Three's WebGLPrograms.acquireProgram pushes each completed program here.
    // This catches replacements without scanning all cached programs per frame.
    hook(list, 'push', original => function() {
      const result = original.apply(this, arguments);
      for (let i = 0; i < arguments.length; i++) recordProgram(arguments[i], this.length);
      return result;
    });
  };
  const stop = why => {
    if (phase === 3) return done;
    event('stop', performance.now(), 0, 0, 0, 0, detail('stop', { reason: why }));
    reason = why; stoppedAt = performance.now(); phase = 3;
    clearTimeout(deadline);
    for (let i = restorations.length - 1; i >= 0; i--) {
      try { restorations[i](); } catch (error) { hookErrors.push(`restore: ${String(error)}`); }
    }
    window.__autodrive = oldAutoDrive; window.__forceGunner = oldForceGunner;
    // The final rAF task's longtask entry exists only after that task returns.
    // Allow observer delivery across two task turns before the host serializes.
    setTimeout(() => setTimeout(() => {
      for (const { observer, consume } of observers) { consume(observer.takeRecords()); observer.disconnect(); }
      acceptingEvents = false; doneResolve();
    }, 0), 0);
    return done;
  };
  const registerGame = g => {
    game = g;
    watch(g, 'audio', Boolean, registerAudio); watch(g, 'post', Boolean, registerPost);
    hook(g, '_createRun', original => function() {
      const at = performance.now(), r = original.apply(this, arguments);
      event('run-create', at, performance.now() - at); registerRun(r); return r;
    });
    if (g.run) registerRun(g.run);
    checkPrograms();
    const gl = g.renderer.getContext();
    hook(gl, 'createBuffer', original => function() {
      const at = performance.now();
      try { return original.apply(this, arguments); }
      finally {
        const duration = performance.now() - at;
        allocationTotals.createBufferCalls++; allocationTotals.createBufferCpu += duration;
        if (activeFrame >= 0) cost[12]++;
        if (duration > 0.5) event('buffer-create', at, duration, allocationTotals.createBufferCalls);
      }
    });
    hook(gl, 'bufferData', original => function(target, data, usage, srcOffset, length) {
      const at = performance.now();
      const elementBytes = data?.BYTES_PER_ELEMENT || 1;
      const available = Math.max(0, (data?.byteLength || 0) / elementBytes - (srcOffset || 0));
      const bytes = typeof data === 'number' ? data
        : (length === undefined || length === 0 ? available : length) * elementBytes;
      try { return original.apply(this, arguments); }
      finally {
        const duration = performance.now() - at;
        allocationTotals.bufferDataCalls++; allocationTotals.bufferDataBytes += bytes; allocationTotals.bufferDataCpu += duration;
        if (activeFrame >= 0) { cost[9] += duration; cost[10]++; cost[11] += bytes; }
        if (bytes > 262144 || duration > 0.5) event('buffer-data', at, duration, bytes, target, usage);
      }
    });
    hook(g.renderer, 'initTexture', original => function(texture) {
      const at = performance.now();
      try { return original.apply(this, arguments); }
      finally {
        const duration = performance.now() - at;
        if (activeFrame >= 0) { cost[3] += duration; cost[4]++; }
        const image = texture?.source?.data || texture?.image;
        const src = image?.currentSrc || image?.src;
        const meta = detail(`texture:${texture?.id}`, { id: texture?.id, name: texture?.name,
          width: image?.width, height: image?.height, version: texture?.version,
          source: typeof src === 'string' && !src.startsWith('data:') ? src : src ? '(embedded)' : undefined });
        event('texture-init', at, duration, texture?.id || 0, image?.width || 0, image?.height || 0, meta);
      }
    });
    hook(g, '_pumpTextures', original => function() {
      const queued = this._texQueue?.length || 0, at = performance.now();
      try { return original.apply(this, arguments); }
      finally {
        const duration = performance.now() - at;
        if (activeFrame >= 0) cost[2] += duration;
        if (queued || duration > 0.5) event('texture-pump', at, duration, queued, this._texQueue?.length || 0);
      }
    });
    hook(g, 'frame', original => function(now) {
      if (frameSize >= frameCapacity) { stop('frame-capacity'); return original.call(this, now); }
      const monitorAt = performance.now(), index = frameSize++, capturedPhase = phase, delta = now - this.last;
      activeFrame = index; cost.fill(0);
      const at = performance.now(); let error;
      try { return original.call(this, now); }
      catch (caught) { error = caught; throw caught; }
      finally {
        const cpu = performance.now() - at, r = this.run, gunner = r?.gunner;
        const base = index * columns.length;
        frames[base] = now; frames[base + 1] = at; frames[base + 2] = delta; frames[base + 3] = cpu;
        frames[base + 5] = capturedPhase; frames[base + 6] = r?.states?.size || 0;
        frames[base + 7] = r?.sim?.projectiles?.bullets?.length || 0;
        frames[base + 8] = this.post?.resolutionScale || 0; frames[base + 9] = r?.playerS || 0;
        frames[base + 10] = gunner?.shots || 0; frames[base + 11] = r?.shots || 0;
        frames[base + 12] = gunner?.cur ?? -1; frames[base + 13] = gunner?.magNow ?? -1;
        frames[base + 14] = gunner?.reloading ? 1 : 0; frames[base + 15] = r?.over ? 1 : 0;
        frames[base + 16] = this.renderer.info.programs?.length || 0; frames[base + 17] = this.post?.stats?.calls || 0;
        frames.set(cost, base + 18);
        if (gunner?.weaponId !== lastWeapon) {
          lastWeapon = gunner?.weaponId;
          if (lastWeapon) event('weapon-change', performance.now(), 0, gunner.cur, 0, 0,
            detail(`weapon:${lastWeapon}`, { weaponId: lastWeapon }));
        }
        if (!!gunner?.reloading !== lastReload) {
          lastReload = !!gunner?.reloading;
          event(lastReload ? 'reload-start' : 'reload-end', performance.now(), 0, gunner?.magNow ?? -1);
        }
        // Only an array identity check normally; additions are rare push hooks.
        checkPrograms();
        // Bounded existing event summaries only on a missed or CPU-heavy frame.
        if (delta > 25 || cpu > 25) {
          const existing = r?.allEvents || [];
          for (let i = 0; i < Math.min(16, existing.length); i++) {
            const e = existing[i];
            event('game-event', performance.now(), 0, Number.isFinite(e.id) ? e.id : 0, Number.isFinite(e.src) ? e.src : 0, 0,
              detail(`event:${e.t}:${e.weapon || ''}`, { type: e.t, weapon: e.weapon }));
          }
        }
        frames[base + 4] = performance.now() - monitorAt - cpu;
        lastFrame = index; activeFrame = -1;
        if (error) { event('failure', performance.now(), 0, 0, 0, 0, detail('frame-error', { error: String(error?.stack || error) })); stop('frame-error'); }
        else if (capturedPhase === 2 && (performance.now() - measurementStart >= options.span * 1000 || r?.over || this.mode !== 'run')) {
          stop(r?.over ? 'death' : this.mode !== 'run' ? 'mode-change' : 'duration');
        }
      }
    });
  };
  for (const type of ['longtask', 'gc']) if (supportedObservers.includes(type)) {
    try {
      const consume = entries => {
        for (const e of entries) {
          const priorCount = eventSize;
          event(type, e.startTime, e.duration, e.kind || 0, 0, 0,
            detail(`${type}:${e.startTime}`, { name: e.name, entryType: e.entryType,
              attribution: Array.from(e.attribution || [], a => ({ name: a.name, containerType: a.containerType,
                containerName: a.containerName, containerSrc: a.containerSrc })) }));
          if (eventSize > priorCount) {
            const base = priorCount * eventColumns.length;
            events[base + 2] = stoppedAt !== null && e.startTime >= stoppedAt ? 3
              : measurementStart !== null && e.startTime >= measurementStart ? 2
              : readyAt !== null && e.startTime >= readyAt ? 1 : 0;
            events[base + 3] = -1; events[base + 4] = 0; // Delivery time is not the originating frame.
          }
        }
      };
      const observer = new PerformanceObserver(list => consume(list.getEntries()));
      observer.observe({ type, buffered: true }); observers.push({ observer, consume }); observedTypes.push(type);
    } catch (error) { hookErrors.push(`observer ${type}: ${String(error)}`); }
  }
  oldAutoDrive = window.__autodrive; oldForceGunner = window.__forceGunner;
  watch(window, '__game', Boolean, registerGame);
  window.__spikeTrace = {
    markReady() { readyAt = performance.now(); phase = 1; event('ready', readyAt); },
    fire() {
      if (fireAt !== null) return;
      fireAt = performance.now(); window.__forceGunner = { slot: options.slot, fire: true }; event('fire-start', fireAt, 0, options.slot);
      const gunner = game?.run?.gunner;
      hook(gunner, 'update', original => function(dt, cmd, cam, carYaw, extra) {
        this.yaw = carYaw; this.pitch = -0.03; return original.call(this, dt, cmd, cam, carYaw, extra);
      });
    },
    begin() {
      if (phase === 3) return done;
      event('warmup-end', performance.now());
      if (game?.run?.over) { stop('warmup-death'); return done; }
      measurementStart = performance.now(); phase = 2;
      if (options.fireTiming === 'after-warm') this.fire();
      deadline = setTimeout(() => stop('deadline-no-frames'), (options.span + 15) * 1000);
      return done;
    },
    stop,
    collect() {
      const frameRows = Array.from({ length: frameSize }, (_, i) => {
        const row = { frame: i };
        for (let j = 0; j < columns.length; j++) row[columns[j]] = frames[i * columns.length + j];
        row.phase = phaseNames[row.phase];
        row.atSinceMeasurementMs = measurementStart === null ? null : row.cpuStart - measurementStart;
        return row;
      });
      const eventRows = Array.from({ length: eventSize }, (_, i) => {
        const row = {};
        for (let j = 0; j < eventColumns.length; j++) row[eventColumns[j]] = events[i * eventColumns.length + j];
        row.phase = phaseNames[row.phase]; row.label = labels[row.label]; row.insideFrame = !!row.insideFrame;
        row.details = row.detail ? details[row.detail - 1] : null; delete row.detail;
        row.atSinceMeasurementMs = measurementStart === null ? null : row.at - measurementStart;
        return row;
      });
      return { frames: frameRows, events: eventRows, readyAt, measurementStart, stoppedAt, fireAt, reason,
        coverage: [...coverage], supportedObservers, observedTypes, allocationTotals,
        gcAvailable: supportedObservers.includes('gc'), frameCapacity, eventCapacity, droppedEvents, hookErrors,
        limitation: 'Game.frame and coarse hooks measure synchronous wall time, including native stalls and hook work, not GPU execution. Event duration is inclusive and nested callbacks overlap. Audio/terrain inside-frame columns normally remain zero; their outside callbacks are in events.json. initTexture records explicit warming, not Three implicit render-time uploads. GL bufferData/createBuffer are numeric attempted-call counters; events only for >256KiB bufferData or >0.5ms calls. newEnsureCpu combines new CarView and CrewView construction, not stable ensure lookups. Longtask requires at least50ms; absence does not exclude a compositor or shorter CPU stall. Browser GC observer may be unavailable. No causal attribution from EMAs or aggregate FPS.' };
    },
  };
}

const distribution = values => {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
  return { samples: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) };
};
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ ...cfg, gameUrl: gameUrl.href, viewport: [2560, 1440], launch: false,
    instrumentation: 'Preallocated frame/event buffers, outer frame + Run/Post/pump timings, rare constructor/init/program events, audio interval/terrain callbacks, GL allocation counters and LOD transitions; no per-node/per-ray/GL-query hooks.' }));
} else {
  await mkdir(cfg.output, { recursive: true });
  let browser, page, setup, trace, fatal;
  const errors = [], warnings = [], responses = [], bundles = [];
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
        ...(cfg.autoplay ? ['--autoplay-policy=no-user-gesture-required'] : [])] });
    page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()); });
    page.on('response', r => {
      if (r.status() >= 400) responses.push({ status: r.status(), url: r.url() });
      const asset = /\/assets\/(index-[^/?]+\.js)(?:\?|$)/.exec(r.url()); if (asset) bundles.push(asset[1]);
    });
    await page.addInitScript(installTrace, cfg);
    await page.goto(gameUrl.href);
    await page.waitForFunction(() => window.__ready && window.__run?.started, null, { timeout: 180000 });
    if (cfg.expectedBundle && !bundles.includes(cfg.expectedBundle)) {
      throw new Error(`Candidate mismatch: expected ${cfg.expectedBundle}, loaded ${bundles.join(', ')}`);
    }
    setup = await page.evaluate(({ autoResolution, fireTiming }) => {
      const g = window.__game; g.setQuality(2); g.post.profile(false); g.post.setResolutionScale(1); g.post.autoResolution = autoResolution;
      window.__autodrive = { speed: 30 }; window.__spikeTrace.markReady();
      if (fireTiming === 'before-warm') window.__spikeTrace.fire();
      const gl = g.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), quality: g.quality,
        scale: g.post.resolutionScale, profiling: g.post._profiling, viewport: [innerWidth, innerHeight],
        audio: { ctxState: g.audio?.ctx?.state ?? null, time: g.audio?.ctx?.currentTime ?? null,
          graphStats: g.audio?.graphStats?.() ?? null } };
    }, cfg);
    await page.waitForTimeout(cfg.warmup * 1000);
    await page.evaluate(() => window.__spikeTrace.begin());
  } catch (error) {
    fatal = String(error?.stack || error);
  } finally {
    if (page && !page.isClosed()) {
      try {
        trace = await page.evaluate(async () => {
          const t = window.__spikeTrace;
          if (!t) return null;
          await t.stop('host-cleanup'); const result = t.collect();
          const g = window.__game;
          result.final = { over: g?.run?.over, s: g?.run?.playerS, scale: g?.post?.resolutionScale,
            profiling: g?.post?._profiling, glError: g?.renderer?.getContext().getError(),
            audio: { ctxState: g?.audio?.ctx?.state ?? null, time: g?.audio?.ctx?.currentTime ?? null,
              graphStats: g?.audio?.graphStats?.() ?? null } };
          return result;
        });
      } catch (error) { errors.push(`collect/cleanup: ${String(error)}`); }
    }
    await browser?.close();
  }
  if (trace) {
    const phases = Object.fromEntries(['startup', 'warmup', 'measurement'].map(phase => {
      const rows = trace.frames.filter(r => r.phase === phase), gaps = rows.map(r => r.rafDelta);
      return [phase, { frames: rows.length, frameTime: distribution(gaps), cpu: distribution(rows.map(r => r.cpu)),
        monitorCpu: distribution(rows.map(r => r.monitorCpu)), over25: gaps.filter(v => v > 25).length,
        averageFps: rows.length * 1000 / Math.max(1, gaps.reduce((a, b) => a + b, 0)) }];
    }));
    const slow = trace.frames.flatMap((row, i) => {
      if (row.phase !== 'measurement' || (row.rafDelta <= 25 && row.cpu <= 25)) return [];
      const previous = trace.frames[i - 1] || null, intervalStart = previous?.cpuStart ?? row.cpuStart - row.rafDelta;
      return [{ current: row, previous, events: trace.events.filter(e =>
        e.at + e.duration >= intervalStart && e.at <= row.cpuStart + row.cpu),
      limitation: 'Temporal overlap is evidence to investigate, not proof of causality. rAF delay can come from the preceding frame or work between frames.' }];
    });
    const summary = { cfg, gameUrl: gameUrl.href, bundles, setup, phases, final: trace.final,
      readyAt: trace.readyAt, measurementStart: trace.measurementStart, stoppedAt: trace.stoppedAt,
      fireAt: trace.fireAt, reason: trace.reason, coverage: trace.coverage, supportedObservers: trace.supportedObservers,
      observedTypes: trace.observedTypes, gcAvailable: trace.gcAvailable, droppedEvents: trace.droppedEvents,
      allocationTotals: trace.allocationTotals,
      hookErrors: trace.hookErrors, fatal, errors, warnings: [...new Set(warnings)], responses,
      limitation: trace.limitation,
      overhead: 'Not yet benchmarked. Expect low tens of performance.now calls per frame, one extra Map lookup per ensure, bounded metadata reads, and audio/terrain callback timestamps. Hot path has no JSON/GL reads/tree walks. monitorCpu measures outer bookkeeping only; inner hook overhead is included in Game.frame CPU. Separate baseline needed to estimate total observer overhead.' };
    await writeFile(`${cfg.output}/summary.json`, JSON.stringify(summary, null, 2));
    await writeFile(`${cfg.output}/frames.json`, JSON.stringify(trace.frames));
    await writeFile(`${cfg.output}/events.json`, JSON.stringify(trace.events));
    await writeFile(`${cfg.output}/slow-frames.json`, JSON.stringify(slow, null, 2));
    console.log(JSON.stringify({ output: cfg.output, bundles, phases, reason: trace.reason, final: trace.final,
      slowFrames: slow.length, hookErrors: trace.hookErrors, fatal, errors }));
  }
  if (fatal) throw new Error(fatal);
}

// Explicitly remote acceptance. This file must never open a browser on the laptop.
// Run only with the dispatch-only remote-invite-map GitHub Actions workflow.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

if (process.platform !== 'linux' || process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.GITHUB_REPOSITORY !== 'yaportmax/rideordie' || !process.env.GITHUB_RUN_ID
  || !process.env.GITHUB_WORKSPACE || process.env.INVITE_MAP_REMOTE !== '1'
  || !process.argv.includes('--remote-ci') || process.env.GAME_URL || process.env.HARDWARE_GPU) {
  throw new Error('REMOTE ONLY: requires Linux GitHub Actions, INVITE_MAP_REMOTE=1 and --remote-ci. Local execution is forbidden.');
}

const root = resolve(process.env.GITHUB_WORKSPACE), dist = resolve(root, 'dist');
assert.equal(resolve(process.cwd()), root, 'Run only from the checked-out GitHub workspace');
const output = resolve(root, 'shots/invite-map');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (process.env.EXPECTED_SOURCE_SHA) assert.equal(commit, process.env.EXPECTED_SOURCE_SHA);
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim(), '', 'Worker tracked source must be clean');
await mkdir(output, { recursive: true });

const evidence = {
  version: 1, passed: false, startedAt: new Date().toISOString(), sourceCommit: commit,
  worker: { runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, repository: process.env.GITHUB_REPOSITORY, platform: process.platform },
  scope: 'Normal App invite, room, personal-wallet, map DOM/layout/controller and short co-op run-transition acceptance on one remote software-rendered worker.',
  limitations: ['Not native GPU FPS or sound quality proof.', 'One-worker WebRTC is not a remote friend, restrictive NAT or TURN proof.', 'Seeded progress is a layout fixture, not a completed campaign.', 'Short run transitions are not full-route, boss or long-session gameplay acceptance.', 'Screenshots require independent human or agent inspection before visual-quality claims.'],
  settingsFixture: { quality: 0, resScale: 0.5, master: 0, music: 0, sfx: 0, motionBlur: false, chromatic: false, grain: false },
  checks: [], setupMutations: [], pages: [], artifacts: [], errors: [], cleanup: [], completedPhases: [],
};
const log = async (type, detail) => appendFile(resolve(output, 'chronology.ndjson'), JSON.stringify({ at: new Date().toISOString(), type, ...detail }) + '\n');
async function record(name, details) { evidence.checks.push({ name, ...details }); await log('check', { name, ...details }); console.log(`PASS ${name}`); }
async function inventory(directory, prefix = '') {
  const rows = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name, path = resolve(directory, entry.name);
    if (entry.isDirectory()) rows.push(...await inventory(path, name + '/'));
    else { assert.ok(entry.isFile(), `No symlinks in frozen dist: ${name}`); const bytes = await readFile(path); rows.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) }); }
  }
  return rows;
}
const frozenInventory = await inventory(dist), indexBytes = await readFile(resolve(dist, 'index.html'));
const entryPath = /<script\b[^>]*\bsrc="([^"]+\.js)"/.exec(indexBytes.toString())?.[1];
assert.ok(entryPath && /^\/assets\/index-[\w-]+\.js$/.test(entryPath), 'Built production entry must be present');
const entry = frozenInventory.find(row => '/' + row.path === entryPath); assert.ok(entry);
const expectedProtocol = Number(/NET_PROTOCOL\s*=\s*(\d+)/.exec(await readFile(resolve(root, 'src/net/run_packet.js'), 'utf8'))?.[1]);
assert.ok(Number.isInteger(expectedProtocol) && expectedProtocol > 0);
evidence.networkProtocol = expectedProtocol;
evidence.artifact = { index: { bytes: indexBytes.length, sha256: sha256(indexBytes) }, entry, files: frozenInventory.length,
  bytes: frozenInventory.reduce((sum, row) => sum + row.bytes, 0), treeSha256: sha256(JSON.stringify(frozenInventory)) };
await writeFile(resolve(output, 'dist-inventory.json'), JSON.stringify({ sourceCommit: commit, ...evidence.artifact, inventory: frozenInventory }, null, 2));

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname), path = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (path !== dist && !path.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
    const bytes = await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); response.end(bytes);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); }
});
let browser, base;
const contexts = new Set(), networkTasks = [], pageRecords = new Map(), requestStarts = new WeakMap();
const until = (page, fn, arg, timeout = 180000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const themes = ['desert', 'canyon', 'coast', 'mountain', 'city', 'dam', 'underground', 'sky', 'hell', 'space'];

function profileFixture(label, cleared = 0, cash = 5000) {
  return { v: 1, campaignId: `remote-${label}`, cash, totalCash: cash,
    campaignProgress: { version: 1, cleared: Array.from({ length: cleared }, (_, i) => i + 1), selectedLevel: Math.min(10, cleared + 1), selectedMode: 'campaign', clearRuns: {} } };
}
async function pageFor(label, { viewport = { width: 1280, height: 720 }, cleared = 0, cash = 5000, pad = false } = {}) {
  const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'], reducedMotion: 'reduce' }); contexts.add(context);
  const seed = profileFixture(label, cleared, cash);
  evidence.setupMutations.push({ label, type: 'isolated-context preboot localStorage fixture', key: 'rideordie.profile.v1', value: seed,
    note: 'App uses its real profile normalization and SaveStore. No live user save or cloud account is used.' });
  await context.addInitScript(({ seed, settings, pad }) => {
    localStorage.setItem('rideordie.profile.v1', JSON.stringify(seed));
    localStorage.setItem('rideordie.settings.v1', JSON.stringify(settings));
    if (pad) {
      window.__remoteAcceptancePad = { id: 'Remote acceptance Xbox virtual gamepad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__remoteAcceptancePad] });
    }
  }, { seed, settings: evidence.settingsFixture, pad });
  if (pad) evidence.setupMutations.push({ label, type: 'virtual gamepad getGamepads fixture', note: 'Tests real Nav polling with synthetic button states, not physical controller hardware.' });
  const page = await context.newPage(); page.setDefaultTimeout(180000);
  const row = { label, viewport, positiveResourcePolicy: true, errors: [], console: [], networkFailures: [], websockets: [], entryResponses: [], snapshots: [] };
  evidence.pages.push(row); pageRecords.set(page, row);
  page.on('pageerror', error => { row.errors.push({ at: new Date().toISOString(), text: error.stack || String(error) }); });
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) row.console.push({ at: new Date().toISOString(), type: message.type(), text: message.text() }); });
  page.on('request', request => requestStarts.set(request, Date.now()));
  page.on('requestfailed', request => row.networkFailures.push({ at: new Date().toISOString(), atMs: Date.now(), requestStartedAtMs: requestStarts.get(request), resourceType: request.resourceType(), type: 'requestfailed', url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => {
    if (response.status() >= 400) row.networkFailures.push({ at: new Date().toISOString(), type: 'http', status: response.status(), url: response.url() });
    if (new URL(response.url()).pathname === entryPath) {
      networkTasks.push(response.body().then(bytes => row.entryResponses.push({ url: response.url(), status: response.status(), bytes: bytes.length, sha256: sha256(bytes) }), error => row.errors.push({ text: `Entry read failed: ${error}` })));
    }
  });
  page.on('websocket', socket => {
    const trace = { url: socket.url(), openedAt: new Date().toISOString(), sent: [], received: [], errors: [] }; row.websockets.push(trace);
    for (const [event, key] of [['framesent', 'sent'], ['framereceived', 'received']]) socket.on(event, data => {
      let type; try { type = JSON.parse(String(data.payload)).type; } catch { /* Keep non-JSON frame metadata. */ }
      trace[key].push({ at: new Date().toISOString(), bytes: data.payload.length, type });
    });
    socket.on('socketerror', error => trace.errors.push(String(error))); socket.on('close', () => { trace.closedAt = new Date().toISOString(); });
  });
  return page;
}
async function boot(page, url = base, expectedScreen = 'title') {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await until(page, screen => window.__ready && window.__app?.screen === screen, expectedScreen);
  assert.equal(await page.evaluate(() => !!window.__session || !!window.__forceInput || !!window.__forceGunner || !!window.__autodrive || !!window.__aimbot), false, 'Normal App boot without debug transport or controls');
  const renderer = await page.evaluate(() => {
    const gl = window.__game.renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, lost: gl.isContextLost() };
  });
  assert.match(renderer.renderer, /SwiftShader|llvmpipe|software/i, 'Acceptance must use software rendering'); assert.equal(renderer.lost, false);
  pageRecords.get(page).renderer = renderer;
  await installMusicLifecycle(page);
}
// Forward the real music methods unchanged. A successful source menu transition
// and exact original healthy bed disposal, not a URL suffix, can explain one
// owned media cancellation. This is adapted from the retained native observer.
async function installMusicLifecycle(page) {
  await page.evaluate(() => {
    const app = window.__app, game = window.__game, music = game.audio.music;
    if (game.run || window.__remoteMusicLifecycle) throw Error('Unique pre-run music observer required');
    const q = window.__remoteMusicLifecycle = { transitions: [], disposals: [], restores: [], watched: new WeakSet(), causes: new WeakMap(), fades: new WeakMap() };
    q.watch = () => { for (const bed of [music.cur, ...music.fading, music._streamPending]) {
      if (!bed?.streaming || q.watched.has(bed)) continue; q.watched.add(bed);
      const original = bed.dispose;
      bed.dispose = function(...args) {
        const src = this.media.getAttribute('src'), def = this.track?.stems?.[0]?.def?.urls?.[0];
        const receipt = { beforeAtMs: Date.now(), url: src ? new URL(src, location.href).href : null, definedUrl: def ? new URL(def, location.href).href : null,
          trackId: this.track?.id, deadBefore: !!this.dead, failedBefore: !!this.failed, mediaErrorBefore: this.media.error?.code || null, errorBefore: this.error?.message || null,
          cause: q.cleanupCause || q.causes.get(this) || null, fadingProof: q.fades.get(this) || null };
        const result = original.apply(this, args);
        Object.assign(receipt, { afterAtMs: Date.now(), originalCompleted: true, deadAfter: !!this.dead, srcRemoved: !this.media.hasAttribute('src') });
        if (receipt.url === receipt.definedUrl) q.disposals.push(receipt); return result;
      };
      q.restores.push(() => { bed.dispose = original; });
      const fadeOut = bed.fadeOut;
      bed.fadeOut = function(...args) {
        const cause = q.causes.get(this), transition = q.transitions.find(item => item.id === cause?.transitionId);
        const proof = cause?.retirement === 'current-replacement' && music.cur === this && music._req === transition?.musicRequest?.requestAfter && music.wantTrack === transition.musicRequest.trackId
          ? { beforeAtMs: Date.now(), request: music._req, targetTrackId: music.wantTrack } : null;
        const result = fadeOut.apply(this, args);
        if (proof && Number.isFinite(this.endAt)) q.fades.set(this, { ...proof, afterAtMs: Date.now(), originalCompleted: true, endAt: this.endAt }); return result;
      };
      q.restores.push(() => { bed.fadeOut = fadeOut; });
    } };
    const click = event => {
      if (!event.isTrusted) return;
      const proof = { kind: 'trusted-menu-click', atMs: Date.now(), from: app.screen };
      if (app.screen === 'title' && event.target.closest?.('.title [data-seat]')) q.intent = { ...proof, action: 'solo-seat', to: 'garage' };
      else if (app.screen === 'lobby' && event.target.closest?.('.lobby [data-act="start"]')) q.intent = { ...proof, action: 'lobby-start', to: 'garage' };
      else if (app.screen === 'lobby' && event.target.closest?.('.lobby [data-act="ready"]')) q.lobbyReady = { ...proof, action: 'lobby-ready' };
      else if (app.screen === 'garage' && event.target.closest?.('.garage [data-ready="1"]')) q.intent = { ...proof, action: 'garage-ready', to: 'run' };
    };
    document.addEventListener('click', click, true); q.restores.push(() => document.removeEventListener('click', click, true));
    const setState = music.setState;
    music.setState = function(state, ...args) {
      const transition = q.active?.expectedMusicState === state ? q.active : null, old = [music.cur, music._streamPending].filter(Boolean), newly = [];
      q.watch();
      if (transition) {
        transition.musicRequest = { state, beforeAtMs: Date.now(), requestBefore: music._req, originalCompleted: false };
        for (const bed of old) if (!bed.dead && !q.fades.has(bed)) { q.causes.set(bed, { kind: 'source-menu-transition', transitionId: transition.id, retirement: bed === music._streamPending ? 'pending-cancel' : 'current-replacement' }); newly.push(bed); }
      }
      const result = setState.call(this, state, ...args);
      if (transition) { Object.assign(transition.musicRequest, { originalCompleted: true, afterAtMs: Date.now(), requestAfter: music._req, trackId: result }); for (const bed of newly) if (!bed.dead && bed.track.id === result) q.causes.delete(bed); }
      q.watch(); return result;
    };
    q.restores.push(() => { music.setState = setState; });
    const makeTransition = (to, expectedMusicState) => {
      const proof = q.intent;
      if (!proof || proof.from !== app.screen || proof.to !== to || game.run) return null;
      q.intent = null;
      const transition = { id: q.transitions.length + 1, proof: { ...proof }, from: app.screen, to, expectedMusicState, beforeAtMs: Date.now(), originalCompleted: false, successful: false };
      q.transitions.push(transition); return transition;
    };
    const garage = app.garage;
    app.garage = function(...args) {
      const transition = makeTransition('garage', 'garage'), prior = q.active; q.active = transition;
      try { const result = garage.apply(this, args); if (transition) Object.assign(transition, { originalCompleted: true, afterAtMs: Date.now(), successful: app.screen === 'garage' && app.ui.screen()?.kind === 'garage' && !game.run }); return result; }
      finally { q.active = prior; }
    };
    q.restores.push(() => { app.garage = garage; });
    const startRun = app._startRun;
    app._startRun = async function(...args) {
      const transition = makeTransition('run', 'run'), prior = q.active; q.active = transition;
      try { const result = await startRun.apply(this, args); if (transition) Object.assign(transition, { originalCompleted: true, afterAtMs: Date.now(), runId: game.run?.id, constructed: app.screen === 'run' && !app._startup && !!game.run && !game.run.disposed && window.__run === game.run }); return result; }
      finally { q.active = prior; }
    };
    q.restores.push(() => { app._startRun = startRun; });
    const onRunMsg = app._onRunMsg;
    app._onRunMsg = function(message) {
      if (message?.t === 'toGarage' && app.screen === 'lobby' && !game.run && !app.session?.isHost && q.lobbyReady) q.intent = { kind: 'received-toGarage-after-trusted-ready', atMs: Date.now(), from: 'lobby', to: 'garage', trustedReady: { ...q.lobbyReady } };
      return onRunMsg.call(this, message);
    };
    q.restores.push(() => { app._onRunMsg = onRunMsg; }); q.watch();
  });
  evidence.setupMutations.push({ label: pageRecords.get(page).label, type: 'forwarding source-method lifecycle observers', note: 'Original App garage/start/message and music setState/fadeOut/dispose methods retain arguments, return values and behavior. Observers restored before context closure.' });
}
async function syncMusic(page) {
  pageRecords.get(page).musicLifecycle = await page.evaluate(() => {
    const q = window.__remoteMusicLifecycle, game = window.__game, app = window.__app;
    if (!q) return null;
    for (const transition of q.transitions) if (transition.to === 'run' && transition.constructed && app.screen === 'run' && !app._startup && game.run?.id === transition.runId && game.run.started && !game.run.disposed) transition.successful = true;
    return { transitions: q.transitions, disposals: q.disposals, cleanupVerified: q.cleanupVerified || false };
  });
}
function classifyNetwork(row) {
  const used = new Set();
  for (const failure of row.networkFailures) {
    failure.classification = 'blocking'; delete failure.lifecycle;
    if (failure.type === 'http' && failure.status === 404 && new URL(failure.url).pathname === '/favicon.ico') { failure.classification = 'browser-optional-favicon-404'; continue; }
    if (failure.error !== 'net::ERR_ABORTED' || failure.resourceType !== 'media' || !Number.isFinite(failure.requestStartedAtMs)) continue;
    const url = new URL(failure.url);
    if (url.origin !== base || url.search || !/^\/audio\/music\/suno\/[A-Za-z0-9_-]+\.mp3$/.test(url.pathname)) continue;
    const life = row.musicLifecycle;
    const eligible = disposal => {
      if (disposal.cause?.kind === 'owned-context-cleanup') return life.cleanupVerified && disposal.cause.pageLabel === row.label;
      const transition = life.transitions.find(item => item.id === disposal.cause?.transitionId), request = transition?.musicRequest;
      const proof = transition?.proof, trusted = proof?.kind === 'trusted-menu-click' && ['solo-seat', 'lobby-start', 'garage-ready'].includes(proof.action);
      const peer = proof?.kind === 'received-toGarage-after-trusted-ready' && proof.trustedReady?.kind === 'trusted-menu-click' && proof.trustedReady.action === 'lobby-ready';
      const retired = disposal.cause?.retirement === 'pending-cancel' || disposal.cause?.retirement === 'current-replacement' && disposal.fadingProof?.originalCompleted && disposal.fadingProof.request === request?.requestAfter && disposal.fadingProof.targetTrackId === request?.trackId;
      return transition?.originalCompleted && transition.successful && (trusted || peer) && retired && request?.state === transition.expectedMusicState && request.originalCompleted && request.trackId && request.requestAfter === request.requestBefore + 1 && proof.atMs <= transition.beforeAtMs && disposal.beforeAtMs >= request.beforeAtMs;
    };
    const index = life?.disposals.findIndex((disposal, index) => !used.has(index) && eligible(disposal) && disposal.url === failure.url && disposal.url === disposal.definedUrl && disposal.originalCompleted && !disposal.deadBefore && !disposal.failedBefore && !disposal.mediaErrorBefore && !disposal.errorBefore && disposal.deadAfter && disposal.srcRemoved && failure.requestStartedAtMs <= disposal.beforeAtMs && failure.atMs >= disposal.beforeAtMs && failure.atMs <= disposal.afterAtMs + 1000);
    if (index == null || index < 0) continue; used.add(index);
    failure.classification = 'exact-owned-healthy-stream-retirement'; failure.lifecycle = life.disposals[index];
  }
}
async function snapshot(page, label) {
  const value = await page.evaluate(() => {
    const app = window.__app, session = app.session;
    const personal = app.personalProfile || app.profile;
    return { screen: app.screen, ui: app.ui.screen()?.kind, mode: app.mode, url: location.href,
      personal: { campaignId: personal.campaignId, cash: personal.cash, totalCash: personal.totalCash, runs: personal.runs, trucks: personal.trucks, loadout: personal.loadout, weapons: personal.weapons, campaignProgress: personal.campaignProgress },
      session: session ? { code: session.code, host: session.isHost, connected: session.connected, status: session.status, signalling: session.signallingState, me: session.me, other: session.other, protocolError: session.protocolError, peerProtocol: session._peerProtocol, runId: session.activeRunId, garage: session.swap.snapshot() } : null,
      run: window.__run ? { id: window.__run.id, role: window.__run.role, started: window.__run.started, disposed: window.__run.disposed, phase: window.__run.phase, sourceOfActiveRun: window.__run === window.__game.run } : null,
      keys: [...window.__game.input.keys], inputDevice: window.__game.input.lastDevice, focusKey: app.ui.nav.cur?.dataset.k, focusConnected: !!app.ui.nav.cur?.isConnected };
  });
  pageRecords.get(page).snapshots.push({ label, at: new Date().toISOString(), value }); await log('snapshot', { page: pageRecords.get(page).label, label, value }); return value;
}
async function shot(page, label) {
  await stableMenu(page);
  const path = resolve(output, label + '.png'); await page.screenshot({ path, timeout: 60000 });
  const bytes = await readFile(path); evidence.artifacts.push({ path: relative(root, path).replaceAll(sep, '/'), bytes: bytes.length, sha256: sha256(bytes), scope: 'remote software rendered original screenshot' });
}
async function stableMenu(page) {
  await page.evaluate(async () => {
    const screen = window.__app?.ui.screen()?.el; if (!screen) return;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const finite = screen.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finite.map(animation => animation.finished.catch(() => {})));
  });
}
async function closePage(page, label) {
  if (!page || page.isClosed()) return;
  await page.evaluate(label => {
    const q = window.__remoteMusicLifecycle;
    if (q) { q.watch(); q.cleanupCause = { kind: 'owned-context-cleanup', pageLabel: label, atMs: Date.now() }; }
    window.__app?.title();
  }, pageRecords.get(page).label);
  const clean = await page.evaluate(() => ({ session: window.__app.session === null, run: window.__game.run === null, screen: window.__app.screen, inputKeys: [...window.__game.input.keys] }));
  assert.equal(clean.session, true); assert.equal(clean.run, true); assert.equal(clean.screen, 'title');
  await page.evaluate(() => {
    const q = window.__remoteMusicLifecycle; if (!q) return;
    q.watch(); window.__game.audio.music.dispose(); q.cleanupVerified = !!window.__game.audio.music._disposed && !window.__game.run && window.__app.screen === 'title' && !window.__app.session;
  });
  await page.waitForTimeout(1000);
  await syncMusic(page); const row = pageRecords.get(page); classifyNetwork(row);
  if (row.positiveResourcePolicy) await assertPositiveErrors(page);
  await page.evaluate(() => { const q = window.__remoteMusicLifecycle; if (q) for (const restore of q.restores.splice(0).reverse()) restore(); });
  const context = page.context(); await context.close(); contexts.delete(context); evidence.cleanup.push({ label, ...clean, contextClosed: true });
}
async function assertPositiveErrors(page) {
  await syncMusic(page);
  const row = pageRecords.get(page); assert.deepEqual(row.errors, [], `${row.label}: page errors`);
  classifyNetwork(row);
  assert.deepEqual(row.console.filter(item => item.type === 'error'), [], `${row.label}: console errors`);
  assert.deepEqual(row.networkFailures.filter(item => item.classification === 'blocking'), [], `${row.label}: network errors`);
}
async function transportProof(page) {
  const state = await page.evaluate(async () => {
    const tp = window.__app.session.tp, pc = tp.conn?.peerConnection;
    const report = pc ? [...(await pc.getStats()).values()] : [];
    const transport = report.find(item => item.type === 'transport' && item.selectedCandidatePairId);
    const pair = report.find(item => item.id === transport?.selectedCandidatePairId) || report.find(item => item.type === 'candidate-pair' && item.nominated && item.state === 'succeeded');
    const candidate = id => { const value = report.find(item => item.id === id); return value ? { type: value.candidateType, protocol: value.protocol, networkType: value.networkType } : null; };
    return { peerId: tp.peer?.id, peerHost: tp.peer?.options?.host, peerSecure: tp.peer?.options?.secure, peerClass: tp.PeerClass?.name,
      connection: pc?.connectionState, ice: pc?.iceConnectionState, reliableOpen: !!tp.conn?.open, dataChannel: tp.conn?.dataChannel?.readyState,
      fast: tp.fast?.readyState, protocolError: window.__app.session.protocolError, stats: tp.stats,
      selectedPair: pair ? { state: pair.state, nominated: pair.nominated, bytesSent: pair.bytesSent, bytesReceived: pair.bytesReceived, local: candidate(pair.localCandidateId), remote: candidate(pair.remoteCandidateId) } : null };
  });
  assert.equal(state.peerSecure, true); assert.equal(state.reliableOpen, true); assert.equal(state.connection, 'connected');
  assert.ok(['connected', 'completed'].includes(state.ice)); assert.equal(state.protocolError, null);
  assert.ok(state.selectedPair?.state === 'succeeded');
  assert.ok(pageRecords.get(page).websockets.some(socket => /^wss:\/\//.test(socket.url) && socket.received.some(frame => frame.type === 'OPEN')), 'Actual ordinary secure PeerJS signalling');
  return state;
}
async function openMap(page) {
  await page.locator('.garage [data-campaign="1"]').click(); await until(page, () => window.__app.ui.screen()?.kind === 'campaign');
  await until(page, () => window.__app.ui.nav.cur?.isConnected && !!window.__app.ui.nav.cur?.classList.contains('is-f'));
  await stableMenu(page);
}
async function geometry(page) {
  return page.evaluate(() => {
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const root = document.querySelector('.campaign'), body = root.querySelector('.campaign-body');
    const nodes = [...root.querySelectorAll('.campaign-card')].map(element => ({ level: Number(element.dataset.level), theme: element.dataset.theme,
      classes: [...element.classList], role: element.getAttribute('role'), disabled: element.getAttribute('aria-disabled'), rect: rect(element),
      name: element.querySelector('.campaign-card-label b').textContent, boss: element.querySelector('.campaign-card-label small').textContent,
      label: [...element.querySelectorAll('.campaign-card-label b, .campaign-card-label small')].map(label => ({ text: label.textContent, rect: rect(label), scroll: [label.scrollWidth, label.clientWidth, label.scrollHeight, label.clientHeight] })), statusRect: rect(element.querySelector('.campaign-status')), art: element.querySelector('svg').outerHTML }));
    const controls = [...root.querySelectorAll('.campaign-card,.campaign-marathon,.campaign-back,.campaign-map-preview,.campaign-authority,.hints')].map(element => ({ name: element.dataset.k || element.className, rect: rect(element) }));
    return { viewport: [innerWidth, innerHeight], body: { rect: rect(body), scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, overflowY: getComputedStyle(body).overflowY },
      nodes, controls, links: [...root.querySelectorAll('.campaign-route-link')].map(element => ({ from: Number(element.dataset.from), to: Number(element.dataset.to), cleared: element.classList.contains('cleared'), path: element.getAttribute('d') })),
      progress: Number(root.querySelector('.campaign-progress-track').getAttribute('aria-valuenow')), focused: window.__app.ui.nav.cur?.dataset.k,
      preview: root.querySelector('.campaign-map-preview').textContent, marathon: { classes: [...root.querySelector('.campaign-marathon').classList], disabled: root.querySelector('.campaign-marathon').getAttribute('aria-disabled') } };
  });
}
function checkGeometry(value, cleared, canSelect = true) {
  assert.equal(value.nodes.length, 10); assert.deepEqual(value.nodes.map(item => item.theme), themes); assert.equal(new Set(value.nodes.map(item => item.art)).size, 10);
  assert.equal(value.links.length, 9); assert.deepEqual(value.links.map(link => [link.from, link.to]), Array.from({ length: 9 }, (_, i) => [i + 1, i + 2]));
  assert.equal(value.progress, cleared); assert.equal(value.links.filter(link => link.cleared).length, Math.min(9, cleared));
  assert.ok(value.body.scrollHeight <= value.body.clientHeight + 2, 'Whole map must fit without vertical scrolling');
  assert.ok(value.body.scrollWidth <= value.body.clientWidth + 2, 'Whole map must fit without horizontal scrolling');
  for (const control of value.controls) {
    assert.ok(control.rect.x >= -1 && control.rect.y >= -1 && control.rect.right <= value.viewport[0] + 1 && control.rect.bottom <= value.viewport[1] + 1, `Visible map control: ${control.name}`);
    assert.ok(control.rect.width > 0 && control.rect.height > 0);
  }
  const separate = (a, b) => a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1;
  for (let i = 0; i < value.controls.length; i++) for (let j = i + 1; j < value.controls.length; j++) {
    assert.ok(separate(value.controls[i].rect, value.controls[j].rect), `Map controls must not overlap: ${value.controls[i].name} / ${value.controls[j].name}`);
  }
  for (const node of value.nodes) {
    const locked = node.level > Math.min(10, cleared + 1);
    assert.equal(node.classes.includes('locked'), locked); assert.equal(node.classes.includes('cleared'), node.level <= cleared);
    assert.equal(node.classes.includes('f'), canSelect && !locked);
    for (const label of node.label) {
      assert.ok(label.scroll[0] <= label.scroll[1] + 1 && label.scroll[2] <= label.scroll[3] + 1, `Unclipped level label ${node.level}: ${label.text}`);
      assert.ok(label.rect.x >= node.rect.x - 1 && label.rect.right <= node.rect.right + 1 && label.rect.bottom <= node.rect.bottom + 1);
      assert.ok(label.rect.bottom <= node.statusRect.y + 1, `Level ${node.level} labels must stay above its absolute status`);
    }
  }
  for (let i = 0; i < value.nodes.length; i++) for (let j = i + 1; j < value.nodes.length; j++) {
    const a = value.nodes[i].rect, b = value.nodes[j].rect;
    assert.ok(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1, 'World cards must not overlap');
  }
  assert.equal(value.marathon.classes.includes('f'), canSelect && cleared === 10);
}
async function padButton(page, index, predicate) {
  await until(page, () => !window.__app.ui.blocked(), null, 15000);
  await page.evaluate(index => { const button = window.__remoteAcceptancePad.buttons[index]; button.pressed = true; button.value = 1; }, index);
  try { await until(page, predicate, null, 15000); }
  finally { await page.evaluate(index => { const button = window.__remoteAcceptancePad.buttons[index]; button.pressed = false; button.value = 0; }, index); }
  await until(page, index => !window.__app.ui.nav.prev[index], index, 15000);
}

async function mapLayouts() {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) for (const cleared of [0, 3, 10]) {
    const label = `map-${viewport.width}x${viewport.height}-cleared-${cleared}`, page = await pageFor(label, { viewport, cleared, pad: true });
    try {
      await boot(page); await page.locator('.title [data-act="solo"]').click(); await page.locator('.title [data-seat="driver"]').click();
      await until(page, () => window.__app.screen === 'garage'); const before = await snapshot(page, 'before-map'); await openMap(page);
      const initial = await geometry(page); checkGeometry(initial, cleared); assert.equal(initial.focused, `campaign:${Math.min(10, cleared + 1)}`);
      await shot(page, label + '-initial'); await record('World map layout and unlock state', { label, geometry: initial });
      if (cleared < 10) {
        await page.locator(`.campaign-card[data-level="${cleared + 2}"]`).click({ force: true });
        assert.equal(await page.evaluate(() => window.__app.ui.screen()?.kind), 'campaign');
        assert.deepEqual((await snapshot(page, 'locked-selection-rejected')).personal, before.personal);
        await page.locator('.campaign-marathon').click({ force: true });
        assert.equal(await page.evaluate(() => window.__app.ui.screen()?.kind), 'campaign');
      }
      if (cleared === 3) {
        await padButton(page, 14, () => window.__app.ui.nav.cur?.dataset.k === 'campaign:3');
        assert.equal(await page.evaluate(() => window.__game.input.lastDevice), 'pad');
        assert.match(await page.locator('.campaign-map-preview').innerText(), /LEVEL 3.*COAST/i); assert.match(await page.locator('.campaign-map-preview').innerText(), /REPLAY AVAILABLE/);
        await shot(page, label + '-controller-replay-focus');
        await padButton(page, 0, () => window.__app.ui.screen()?.kind === 'garage');
        assert.equal(await page.evaluate(() => window.__app.profile.campaignProgress.selectedLevel), 3);
        await openMap(page);
        await padButton(page, 5, () => window.__app.ui.nav.cur?.dataset.k === 'campaign:4');
        await padButton(page, 1, () => window.__app.ui.screen()?.kind === 'garage');
        assert.equal(await page.evaluate(() => window.__app.profile.campaignProgress.selectedLevel), 3, 'Controller Back does not select a previewed world');
      } else if (cleared === 10) {
        await padButton(page, 5, () => window.__app.ui.nav.cur?.dataset.k === 'campaign:marathon');
        assert.match(await page.locator('.campaign-map-preview').innerText(), /MARATHON.*ALL TEN WORLDS/);
        await shot(page, label + '-controller-marathon-focus');
        await padButton(page, 0, () => window.__app.ui.screen()?.kind === 'garage');
        assert.equal(await page.evaluate(() => window.__app.profile.campaignProgress.selectedMode), 'marathon');
        await openMap(page); const marathon = await geometry(page); checkGeometry(marathon, 10); assert.equal(marathon.focused, 'campaign:marathon');
        assert.ok(marathon.marathon.classes.includes('selected')); await shot(page, label + '-marathon-selected');
        await until(page, () => !window.__app.ui.blocked(), null, 15000); await page.keyboard.press('Escape');
      } else { await until(page, () => !window.__app.ui.blocked(), null, 15000); await page.keyboard.press('Escape'); }
      await until(page, () => window.__app.ui.screen()?.kind === 'garage');
      const after = await snapshot(page, 'after-map');
      for (const field of ['cash', 'totalCash', 'runs', 'trucks', 'loadout', 'weapons']) assert.deepEqual(after.personal[field], before.personal[field]);
      await assertPositiveErrors(page); evidence.completedPhases.push(label);
    } finally { await closePage(page, label); }
  }
}

async function negativeInvites() {
  for (const query of ['', '?room=', '?room=x', '?room=BAD%3CCODE', '?room=ABC&room=DEF']) {
    const label = 'invalid-' + (query || 'no-room').replace(/[^\w-]/g, '_'), page = await pageFor(label);
    try {
      await boot(page, base + '/' + query); const value = await snapshot(page, 'normal-title-no-auto-room');
      assert.equal(value.session, null); assert.equal(value.mode, 'title'); assert.equal(value.personal.cash, 5000);
      if (query) {
        await until(page, () => [...document.querySelectorAll('.toast')].some(node => /INVALID INVITE LINK/.test(node.textContent)), null, 30000);
        assert.ok(!new URL(page.url()).searchParams.has('room'), 'Invalid/duplicate invitation is removed before normal reload');
      }
      await page.locator('.title [data-act="join"]').click(); await page.locator('.title input.code').fill('WASDR');
      assert.deepEqual(await page.evaluate(() => [...window.__game.input.keys]), []);
      await page.locator('.title [data-act="jback"]').click(); assert.equal(await page.evaluate(() => window.__app.screen), 'title');
      await shot(page, label); await assertPositiveErrors(page); evidence.completedPhases.push(label);
    } finally { await closePage(page, label); }
  }
  // Public signalling remains real here. A no-room response is expected and
  // retained verbatim; it is not hidden from the positive-path error policy.
  const page = await pageFor('stale-room');
  pageRecords.get(page).positiveResourcePolicy = false;
  try {
    const stale = ('Q' + process.env.GITHUB_RUN_ID).slice(0, 12);
    await page.goto(`${base}/?room=${stale}`); await until(page, () => window.__ready && window.__app.screen === 'title' && !window.__app.session);
    await until(page, () => [...document.querySelectorAll('.toast')].some(node => /No room|Timed out|Could not|connection/i.test(node.textContent)), null, 40000);
    const first = await snapshot(page, 'stale-room-returned-to-title'); assert.ok(!new URL(first.url).searchParams.has('room'));
    await shot(page, 'stale-room-error-original');
    evidence.setupMutations.push({ label: 'stale-room', type: 'remote context offline during manual retry cancellation only', note: 'Prevents a fast real no-room response from racing the Leave action. Original no-room path uses ordinary public signalling. Online is restored before reload.' });
    await page.context().setOffline(true);
    await page.locator('.title [data-act="join"]').click(); await page.locator('.title input.code').fill(stale); await page.locator('.title [data-act="jgo"]').click();
    await until(page, () => window.__app.screen === 'lobby'); await page.locator('.lobby [data-act="leave"]').click();
    await until(page, () => window.__app.screen === 'title' && !window.__app.session);
    await page.context().setOffline(false);
    await page.reload(); await until(page, () => window.__ready && window.__app.screen === 'title' && !window.__app.session);
    assert.ok(!new URL(page.url()).searchParams.has('room')); assert.equal((await snapshot(page, 'reload-does-not-retry-consumed-room')).personal.cash, 5000);
    await record('Stale room recovery, manual retry cancellation and consumed-URL reload', { stale, originalErrors: pageRecords.get(page).console, snapshots: pageRecords.get(page).snapshots });
    assert.deepEqual(pageRecords.get(page).errors, [], 'Expected networking failure must not be an unhandled page error'); evidence.completedPhases.push('stale-room');
  } finally { await closePage(page, 'stale-room'); }
}

async function deniedClipboardLayout(page, invite, label) {
  evidence.setupMutations.push({ label, type: 'negative clipboard denial fixture only', note: 'After the real clipboard successfully produced the positive invite URL, clipboard.writeText rejects and execCommand(copy) returns false. Both original property descriptors are restored before guest navigation.' });
  await page.evaluate(() => {
    const clipboard = navigator.clipboard, originalClipboard = Object.getOwnPropertyDescriptor(clipboard, 'writeText'), originalCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const fixture = window.__remoteClipboardDenial = { writes: 0, copies: 0 };
    fixture.restore = () => {
      if (originalClipboard) Object.defineProperty(clipboard, 'writeText', originalClipboard); else delete clipboard.writeText;
      if (originalCommand) Object.defineProperty(document, 'execCommand', originalCommand); else delete document.execCommand;
    };
    Object.defineProperty(clipboard, 'writeText', { configurable: true, value: () => { fixture.writes++; return Promise.reject(new DOMException('Declared remote negative fixture', 'NotAllowedError')); } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: command => { if (command === 'copy') fixture.copies++; return false; } });
  });
  try {
    await page.locator('.lobby [data-act="invite"]').click();
    await page.locator('.lobby input[data-k="invite-url"]').waitFor();
  } finally { await page.evaluate(() => window.__remoteClipboardDenial.restore()); }
  await stableMenu(page);
  const input = page.locator('.lobby input[data-k="invite-url"]');
  assert.equal(await input.inputValue(), invite);
  await input.click(); await input.press('ControlOrMeta+a');
  const state = await page.evaluate(() => {
    const root = document.querySelector('.lobby'), input = root.querySelector('input[data-k="invite-url"]');
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    return { viewport: [innerWidth, innerHeight], value: input.value, attribute: input.getAttribute('value'), readonly: input.readOnly, outerHTML: input.outerHTML,
      selected: [input.selectionStart, input.selectionEnd], activeInput: document.activeElement === input, navFocus: window.__app.ui.nav.cur?.dataset.k,
      fixtureCalls: { writes: window.__remoteClipboardDenial.writes, copies: window.__remoteClipboardDenial.copies },
      room: rect(root.querySelector('.lb-code')), input: rect(input), seats: rect(root.querySelector('.lb-seats')),
      roomControls: [...root.querySelectorAll('.lb-code .eyebrow,.codetiles,[data-act="invite"],[data-act="copy"],.lb-status')].map(element => ({ name: element.dataset.act || element.className, rect: rect(element) })) };
  });
  assert.equal(state.value, invite); assert.equal(state.attribute, invite); assert.equal(state.readonly, true); assert.equal(state.activeInput, true); assert.equal(state.navFocus, 'invite-url');
  assert.deepEqual(state.selected, [0, invite.length]); assert.deepEqual(state.fixtureCalls, { writes: 1, copies: 1 });
  assert.ok(state.room.bottom <= state.seats.y + 1, 'Clipboard fallback room plate must not overlap seat cards');
  for (const control of [{ name: 'selectable invite', rect: state.input }, ...state.roomControls]) {
    const r = control.rect;
    assert.ok(r.x >= state.room.x - 1 && r.right <= state.room.right + 1 && r.y >= state.room.y - 1 && r.bottom <= state.room.bottom + 1, `Fallback room control stays in its plate: ${control.name}`);
    assert.ok(r.x >= -1 && r.y >= -1 && r.right <= state.viewport[0] + 1 && r.bottom <= state.viewport[1] + 1);
    assert.ok(r.right <= state.seats.x + 1 || state.seats.right <= r.x + 1 || r.bottom <= state.seats.y + 1 || state.seats.bottom <= r.y + 1, `Fallback control does not overlap seats: ${control.name}`);
  }
  await shot(page, label + '-clipboard-denied-selectable-link');
  await record('Declared clipboard denial retains a selectable, focused real invite without room/seat overlap', { label, state });
}

async function inviteCoop(hostRole) {
  const label = `invite-host-${hostRole}`, guestRole = hostRole === 'driver' ? 'gunner' : 'driver';
  const host = await pageFor(label + '-host', { cleared: 3, cash: 7000 });
  let guest;
  try {
    await boot(host); await host.locator('.title [data-act="host"]').click();
    await until(host, () => window.__app.session?.code && window.__app.session.me.role === 'driver');
    if (hostRole === 'gunner') { await host.locator('.lobby [data-seat="gunner"]').click(); await until(host, () => window.__app.session.me.role === 'gunner'); }
    await host.locator('.lobby [data-act="invite"]').click();
    const invite = await host.evaluate(() => navigator.clipboard.readText()), url = new URL(invite);
    const code = await host.evaluate(() => window.__app.session.code); assert.equal(url.origin, base); assert.equal(url.searchParams.get('room'), code);
    assert.equal([...url.searchParams].length, 1); assert.equal(url.hash, '');
    await deniedClipboardLayout(host, invite, label + '-host');
    guest = await pageFor(label + '-guest', { cash: 5000 });
    // Cold visit of the actual copied link. No direct App.join call and no
    // transport/PeerClass/ICE mutation is permitted on either positive page.
    await boot(guest, invite, 'lobby');
    await Promise.all([
      until(host, protocol => window.__app.session.connected && window.__app.session.other && window.__app.session.peerWallet && window.__app.session._peerProtocol === protocol, expectedProtocol),
      until(guest, protocol => window.__app.session.connected && window.__app.session.other && window.__app.session.wallet?.playerId === window.__app.personalProfile.campaignId && window.__app.session._peerProtocol === protocol, expectedProtocol),
    ]);
    if (await guest.evaluate(role => window.__app.session.me.role !== role, guestRole)) await guest.locator(`.lobby [data-seat="${guestRole}"]`).click();
    await until(host, role => window.__app.session.other?.role === role, guestRole);
    const joined = await snapshot(guest, 'cold-copy-link-auto-joined'); assert.equal(joined.personal.cash, 5000); assert.equal(joined.personal.campaignId, `remote-${label}-guest`);
    assert.equal(joined.session.me.ready, false); assert.equal(joined.session.other.ready, false); assert.equal(joined.run, null); assert.ok(!new URL(joined.url).searchParams.has('room'));
    assert.equal(await host.evaluate(() => window.__app.session.canStart()), false);
    const transport = { host: await transportProof(host), guest: await transportProof(guest) };
    await shot(host, label + '-lobby-host'); await shot(guest, label + '-lobby-guest');
    await host.locator('.lobby [data-act="ready"]').click(); await until(guest, () => window.__app.session.other.ready);
    assert.equal(await host.evaluate(() => window.__app.session.canStart()), false, 'Invite does not imply the second player is ready');
    await guest.locator('.lobby [data-act="ready"]').click(); await until(host, () => window.__app.session.canStart());
    await host.locator('.lobby [data-act="start"]').click(); await Promise.all([until(host, () => window.__app.screen === 'garage'), until(guest, () => window.__app.screen === 'garage')]);
    await openMap(guest); const guestMap = await geometry(guest); checkGeometry(guestMap, 3, false); assert.equal(guestMap.focused, 'campaign:back');
    const hostJourney = await host.evaluate(() => window.__app.profile.campaignProgress);
    await guest.locator('.campaign-card[data-level="2"]').click({ force: true }); assert.deepEqual(await host.evaluate(() => window.__app.profile.campaignProgress), hostJourney);
    assert.match(await guest.locator('.campaign-authority').innerText(), /host chooses/i); await shot(guest, label + '-guest-read-only-map');
    await openMap(host); await host.locator('.campaign-card[data-level="2"]').click();
    await until(guest, () => window.__app.profile.campaignProgress.selectedLevel === 2);
    assert.equal(await guest.evaluate(() => window.__app.ui.screen()?.kind), 'campaign');
    assert.equal(await guest.evaluate(() => window.__app.ui.nav.cur?.dataset.k), 'campaign:back', 'Host profile rerender retains the guest Back focus');
    assert.match(await guest.locator('.campaign-map-preview').innerText(), /LEVEL 2/); await shot(guest, label + '-guest-host-selection-updated');
    await guest.locator('.campaign [data-act="back"]').click();
    await guest.locator('.garage [data-tab="weapons"]').click(); await guest.locator('.garage [data-row="smg"]').click(); await guest.locator('.garage [data-buy="1"]').click();
    await Promise.all([until(host, () => !!window.__app.profile.weapons.smg), until(guest, () => !!window.__app.profile.weapons.smg)]);
    await guest.locator('.garage [data-slot="0"]').click(); await until(host, () => window.__app.profile.loadout[0] === 'smg');
    const guestCash = await guest.evaluate(() => window.__app.personalProfile.cash); assert.ok(guestCash < 5000); assert.equal(await host.evaluate(() => window.__app.personalProfile.cash), 7000);
    await host.locator('.garage [data-tab="upgrades"]').click(); await host.locator('.garage [data-row="engine"]').click(); await host.locator('.garage [data-buy="1"]').click();
    await until(guest, () => window.__app._garageLoadout().upgradeLevels.engine === 1);
    const hostCash = await host.evaluate(() => window.__app.personalProfile.cash); assert.ok(hostCash < 7000); assert.equal(await guest.evaluate(() => window.__app.personalProfile.cash), guestCash);
    await host.locator('.garage [data-ready="1"]').click(); assert.equal(await guest.evaluate(() => window.__app.screen), 'garage');
    await guest.locator('.garage [data-ready="1"]').click();
    await Promise.all([until(host, () => window.__app.screen === 'run' && window.__run?.started && window.__run === window.__game.run), until(guest, () => window.__app.screen === 'run' && window.__run?.started && window.__run === window.__game.run)]);
    const started = { host: await snapshot(host, 'normal-ready-run'), guest: await snapshot(guest, 'normal-ready-run') };
    assert.equal(started.host.run.id, started.guest.run.id); assert.equal(started.host.run.role, hostRole); assert.equal(started.guest.run.role, guestRole);
    for (const page of [host, guest]) { assert.equal(await page.evaluate(() => window.__run.cfg.journey.level), 2); await assertPositiveErrors(page); }
    await shot(host, label + '-run-host'); await shot(guest, label + '-run-guest');
    await record('Actual copied invite joins normal App, preserves readiness and personal cash, selects shared map and starts both seat roles', { hostRole, guestRole, invite, code, transport, guestCash, hostCash, started });
    evidence.completedPhases.push(label);
  } finally { if (guest) await closePage(guest, label + '-guest'); await closePage(host, label + '-host'); }
}
function assertLateEvents() {
  for (const row of evidence.pages) {
    assert.deepEqual(row.errors, [], `${row.label}: late unhandled page errors`);
    classifyNetwork(row);
    if (row.positiveResourcePolicy) {
      assert.deepEqual(row.console.filter(item => item.type === 'error'), [], `${row.label}: late console errors`);
      assert.deepEqual(row.networkFailures.filter(item => item.classification === 'blocking'), [], `${row.label}: late resource failures`);
    }
  }
}

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  evidence.browser = { version: browser.version(), headless: true, muted: true, softwareRendering: true, base };
  await mapLayouts(); await negativeInvites(); await inviteCoop('driver'); await inviteCoop('gunner');
  await Promise.all(networkTasks);
  assertLateEvents();
  for (const row of evidence.pages) {
    assert.ok(row.entryResponses.length, `${row.label}: exact production entry loaded`);
    for (const loaded of row.entryResponses) { assert.equal(loaded.status, 200); assert.equal(loaded.sha256, entry.sha256); assert.equal(loaded.bytes, entry.bytes); }
  }
  assert.deepEqual(await inventory(dist), frozenInventory, 'The uploaded artifact is unchanged from the artifact served throughout acceptance');
  assert.equal(contexts.size, 0); evidence.passed = true;
} catch (error) {
  evidence.errors.push(error.stack || String(error)); process.exitCode = 1;
  for (const context of contexts) for (const page of context.pages()) {
    try { await shot(page, 'failure-' + pageRecords.get(page)?.label); await snapshot(page, 'original-failure-state'); } catch (captureError) { evidence.errors.push(`Failure capture: ${captureError}`); }
  }
} finally {
  for (const context of contexts) { try { await context.close(); evidence.cleanup.push({ contextClosedAfterFailure: true }); } catch (error) { evidence.errors.push(`Context cleanup: ${error}`); process.exitCode = 1; evidence.passed = false; } }
  try { if (browser) { await browser.close(); evidence.cleanup.push({ browserClosed: true }); } }
  catch (error) { evidence.errors.push(`Browser cleanup: ${error}`); process.exitCode = 1; evidence.passed = false; }
  try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); evidence.cleanup.push({ ownedHttpServerClosed: true }); }
  catch (error) { evidence.errors.push(`HTTP cleanup: ${error}`); process.exitCode = 1; evidence.passed = false; }
  await Promise.allSettled(networkTasks);
  try { assertLateEvents(); } catch (error) { evidence.errors.push(error.stack || String(error)); process.exitCode = 1; evidence.passed = false; }
  evidence.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: evidence.passed, sourceCommit: commit, entry, completedPhases: evidence.completedPhases, errors: evidence.errors }));
}

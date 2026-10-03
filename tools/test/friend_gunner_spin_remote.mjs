// WORK-only remote collector proposal. Root owns integration and every execution.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

if (process.platform !== 'linux' || process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.GITHUB_REPOSITORY !== 'yaportmax/rideordie' || !process.env.GITHUB_RUN_ID || !process.env.GITHUB_WORKSPACE
  || process.env.FRIEND_SPIN_REMOTE !== '1' || !process.argv.includes('--remote-ci') || process.env.GAME_URL || process.env.HARDWARE_GPU) throw Error('REMOTE GITHUB LINUX ONLY; laptop execution is forbidden.');
const root = resolve(process.env.GITHUB_WORKSPACE), out = resolve(root, 'shots/friend-gunner-spin');
assert.equal(resolve(process.cwd()), root);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.match(process.env.EXPECTED_SOURCE_SHA || '', /^[a-f0-9]{40}$/); assert.equal(commit, process.env.EXPECTED_SOURCE_SHA);
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const html = await readFile(resolve(root, 'dist/index.html')), entry = /<script\b[^>]*\bsrc="([^"]+\.js)"/.exec(html.toString())?.[1]; assert.ok(entry);
const entryBytes = await readFile(resolve(root, 'dist', entry.slice(1)));
await mkdir(out, { recursive: true });
const report = { version: 1, passed: false, orientationPassed: false, sourceCommit: commit, startedAt: new Date().toISOString(),
  entry: { path: entry, sha256: hash(entryBytes), bytes: entryBytes.length }, indexSha256: hash(html),
  scope: 'Normal-menu real WebRTC gunner-viewer backward/360 aim using trusted remote browser pointer movement; both lobby host roles.',
  exclusions: ['Not physical laptop input, native GPU FPS, complete gameplay, audio quality, remote-friend NAT or TURN proof.', 'Survival-controlled authority with no injected driving commands; contacts, snapshots and carrier rotation remain authored.'],
  setup: [], pages: [], phases: [], screenshots: [], errors: [], cleanup: [] };
const base = 'http://127.0.0.1:5184', contexts = new Set(), receipts = new Map(), responseTasks = [];
const until = (page, fn, arg, timeout = 180000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });
const chronology = row => appendFile(resolve(out, 'chronology.ndjson'), JSON.stringify({ wall: new Date().toISOString(), ...row }) + '\n');
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5184', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
report.preview = { pid: preview.pid, command: 'owned Vite preview --strictPort 127.0.0.1:5184', errors: [], exits: [] };
preview.on('error', error => report.preview.errors.push(String(error)));
preview.on('exit', (code, signal) => report.preview.exits.push({ at: Date.now(), code, signal }));
preview.stdout.on('data', data => chronology({ type: 'owned-preview-stdout', text: String(data) }).catch(() => {}));
preview.stderr.on('data', data => chronology({ type: 'owned-preview-stderr', text: String(data) }).catch(() => {}));
let browser, activePage;
async function newPage(label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['clipboard-read', 'clipboard-write'] }); contexts.add(context);
  const seed = { v: 1, campaignId: `friend-spin-${label}`, cash: 50000, totalCash: 50000 };
  report.setup.push({ label, prebootIsolatedStorage: seed, settings: { quality: 0, resScale: .5, master: 0, music: 0, sfx: 0, shake: 0, motionBlur: false, chromatic: false, grain: false }, note: 'Functional software rendering fixture and funded shop, not earned progression or native performance.' });
  await context.addInitScript(seed => { localStorage.setItem('rideordie.profile.v1', JSON.stringify(seed)); localStorage.setItem('rideordie.settings.v1', JSON.stringify({ quality: 0, resScale: .5, master: 0, music: 0, sfx: 0, shake: 0, motionBlur: false, chromatic: false, grain: false })); }, seed);
  const page = await context.newPage(), receipt = { label, errors: [], console: [], failures: [], wss: [], entries: [] }; receipts.set(page, receipt); report.pages.push(receipt);
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => receipt.errors.push({ at: Date.now(), text: error.stack || String(error) }));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) receipt.console.push({ at: Date.now(), type: message.type(), text: message.text() }); });
  page.on('requestfailed', request => receipt.failures.push({ at: Date.now(), url: request.url(), resourceType: request.resourceType(), error: request.failure()?.errorText }));
  page.on('response', response => {
    if (response.status() >= 400) receipt.failures.push({ at: Date.now(), url: response.url(), status: response.status() });
    if (new URL(response.url()).pathname === entry) responseTasks.push(response.body().then(bytes => receipt.entries.push({ url: response.url(), sha256: hash(bytes), bytes: bytes.length, headers: response.headers() }), error => receipt.errors.push({ text: String(error) })));
  });
  page.on('websocket', socket => { const row = { url: socket.url(), frames: [] }; receipt.wss.push(row); socket.on('framereceived', data => { let type; try { type = JSON.parse(String(data.payload)).type; } catch { /* Original non-JSON metadata retained. */ } row.frames.push({ at: Date.now(), type, bytes: data.payload.length }); }); });
  return page;
}
async function boot(page, url = base, screen = 'title') {
  const navigation = await page.goto(url), bytes = await navigation.body();
  receipts.get(page).navigation = { url: navigation.url(), status: navigation.status(), headers: navigation.headers(), sha256: hash(bytes), bytes: bytes.length };
  assert.equal(hash(bytes), report.indexSha256, 'Normal navigation must serve this exact worker index');
  await until(page, screen => window.__ready && window.__app?.screen === screen, screen);
  assert.equal(await page.evaluate(() => !!window.__session || !!window.__forceInput || !!window.__forceGunner || !!window.__aimbot || !!window.__autodrive), false);
  const gl = await page.evaluate(() => { const renderer = window.__game.renderer, gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return { vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR), renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER), width: gl.drawingBufferWidth, height: gl.drawingBufferHeight }; });
  receipts.get(page).gl = gl; assert.match(gl.renderer, /SwiftShader/i, 'This remote collector must use the software renderer');
}
async function screenshot(page, label) {
  const path = resolve(out, label + '.png'), bytes = await page.screenshot({ path, timeout: 60000 }); report.screenshots.push({ label, sha256: hash(bytes), bytes: bytes.length });
}
async function peerProof(page) {
  return page.evaluate(async () => {
    const session = window.__app.session, tp = session.tp, pc = tp.conn.peerConnection, stats = [...(await pc.getStats()).values()];
    const pair = stats.find(row => row.type === 'candidate-pair' && row.nominated && row.state === 'succeeded');
    return { host: session.isHost, role: session.me.role, code: session.code, peerHost: tp.peer.options.host, peerSecure: tp.peer.options.secure,
      connection: pc.connectionState, ice: pc.iceConnectionState, reliableOpen: tp.conn.open, protocol: session._peerProtocol,
      pair: pair ? { state: pair.state, nominated: pair.nominated, sent: pair.bytesSent, received: pair.bytesReceived } : null };
  });
}
async function room(hostRole) {
  const host = await newPage(`${hostRole}-host`), guest = await newPage(`${hostRole}-guest`);
  await boot(host); await host.locator('.title [data-act="host"]').click();
  await until(host, () => window.__app.session?.code && window.__app.session.me.role === 'driver');
  if (hostRole === 'gunner') { await host.locator('.lobby [data-seat="gunner"]').click(); await until(host, () => window.__app.session.me.role === 'gunner'); }
  await host.locator('.lobby [data-act="invite"]').click(); const link = await host.evaluate(() => navigator.clipboard.readText());
  await boot(guest, link, 'lobby');
  await Promise.all([until(host, () => window.__app.session.connected && window.__app.session.other && window.__app.session.peerWallet), until(guest, () => window.__app.session.connected && window.__app.session.other && window.__app.session._peerProtocol != null)]);
  const guestRole = hostRole === 'driver' ? 'gunner' : 'driver';
  if (await guest.evaluate(role => window.__app.session.me.role !== role, guestRole)) await guest.locator(`.lobby [data-seat="${guestRole}"]`).click();
  await until(host, role => window.__app.session.other?.role === role, guestRole);
  for (const page of [host, guest]) assert.equal(await page.evaluate(() => window.__app.session.me.ready), false);
  await host.locator('.lobby [data-act="ready"]').click(); await guest.locator('.lobby [data-act="ready"]').click(); await until(host, () => window.__app.session.canStart());
  await host.locator('.lobby [data-act="start"]').click(); await Promise.all([until(host, () => window.__app.screen === 'garage'), until(guest, () => window.__app.screen === 'garage')]);
  // Purchase and assign loadout through the real guest shop, irrespective of seat.
  for (const [weapon, slot] of [['rifle', 1], ['minigun', 2]]) {
    await guest.locator('.garage [data-tab="weapons"]').click(); await guest.locator(`.garage [data-row="${weapon}"]`).click(); await guest.locator('.garage [data-buy="1"]').click();
    await until(host, weapon => !!window.__app.profile.weapons[weapon], weapon); await guest.locator(`.garage [data-slot="${slot}"]`).click();
    await until(host, ({ weapon, slot }) => window.__app.profile.loadout[slot] === weapon, { weapon, slot });
  }
  await host.locator('.garage [data-ready="1"]').click(); await guest.locator('.garage [data-ready="1"]').click();
  await Promise.all([until(host, () => window.__run?.started && window.__app.screen === 'run'), until(guest, () => window.__run?.started && window.__app.screen === 'run')]);
  const driver = hostRole === 'driver' ? host : guest, gunner = hostRole === 'gunner' ? host : guest;
  assert.equal(await driver.evaluate(() => !!window.__run.sim && window.__run.role === 'driver'), true);
  assert.equal(await gunner.evaluate(() => !window.__run.sim && window.__run.role === 'gunner' && !!window.__run.gunner), true);
  const proof = { hostRole, link, host: await peerProof(host), guest: await peerProof(guest) };
  for (const [page, row] of [[host, proof.host], [guest, proof.guest]]) { assert.equal(row.peerSecure, true); assert.equal(row.connection, 'connected'); assert.ok(row.pair); assert.ok(receipts.get(page).wss.some(socket => /^wss:/.test(socket.url) && socket.frames.some(frame => frame.type === 'OPEN'))); }
  report.setup.push({ hostRole, fixture: 'authoritative HP-only survival shield', reason: 'Keep a slow software-rendered spin investigation alive. Does not set driver command, carrier pose, aim, camera, revision, network or world content.' });
  await driver.evaluate(() => {
    const run = window.__run, original = run.update;
    run.update = function(...args) { const player = this.player; if (player) { player.hp = player.maxHp = 1e9; for (const crew of [player.crew.driver, player.crew.gunner]) if (crew?.alive) crew.hp = crew.max = 1e9; } return original.apply(this, args); };
    window.__spinShieldRestore = () => { run.update = original; };
  });
  return { host, guest, driver, gunner, proof };
}
async function observe(page) {
  await page.evaluate(() => {
    const game = window.__game, run = window.__run, gunner = run.gunner, input = game.input;
    const probe = window.__friendSpin = { rows: [], events: [], restores: [], armed: false, serial: 0 };
    const vmState = () => ({ visible: gunner.vm?.visible, quat: gunner.vm?.quat?.toArray(), pos: gunner.vm?.pos?.toArray(), weapon: gunner.vm?.id, shownWeapon: gunner.vm?.shownId, angularVelocity: gunner.vm?.angV?.toArray() });
    const state = () => { const p = run.states.get(run.playerId), cam = game.camera, gl = game.renderer.getContext(); cam.updateMatrixWorld(); return { frame: game.frames, at: performance.now(), screen: window.__app.screen, role: run.role, simPeer: !!run.sim, paused: game.paused,
      focused: document.hasFocus(), hidden: document.hidden, alive: p?.gunnerAlive, phase: run.phase, simState: run.simState, defeated: run.defeated, cinematic: run.cinematic, victory: run.victoryPresentation, intro: run.introOutside,
      yaw: gunner.yaw, pitch: gunner.pitch, ads: gunner.ads, weapon: gunner.weaponId, mounted: !!gunner.weapon.mounted, scope: !!gunner.weapon.scope,
      carrier: p ? { quat: p.quat.toArray(), pos: p.pos.toArray(), vel: p.vel.toArray(), poseRevision: p.poseRevision, streamPoseGeneration: p.streamPoseGeneration, speed: p.speed } : null,
      previousCarrier: gunner._lastCarQuat.toArray(), hasPreviousCarrier: gunner._hasCarQuat, previousRevision: gunner.lastPoseRevision, previousGeneration: gunner.lastStreamPoseGeneration,
      camera: { quat: cam.quaternion.toArray(), position: cam.position.toArray(), direction: [0, 0, -1].map((_, i) => { const e = cam.matrixWorld.elements; return -e[i + 8]; }), camDir: run.camDir.toArray(), up: cam.up.toArray(), fov: cam.fov },
      view: { firstPerson: run.gcam.firstPerson, tpK: run.gcam.tpK, adsK: run.gcam.adsK, roll: run.gcam.roll, kickYaw: run.gcam.kickYaw, kickPitch: run.gcam.kickPitch, vmAtCameraStage: vmState() },
      input: { device: input.lastDevice, locked: input.locked, captured: document.pointerLockElement === game.canvas, mouseDX: input.mouseDX, mouseDY: input.mouseDY },
      internalResolution: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      snapshot: { queue: run.buf.snaps.length, newest: run.buf.snaps.at(-1)?.time, latest: run.buf.latest?.time, renderTime: run.buf.renderTime, clockOffset: run.buf.clockOffset, delay: run.buf.delay, streamPoseGeneration: run.buf.streamPoseGeneration, lastArrival: run.buf.lastArrival, lastSample: run.buf.lastSample } }; };
    probe.state = state;
    const movement = event => { if (probe.armed) probe.events.push({ n: ++probe.serial, at: performance.now(), trusted: event.isTrusted, movementX: event.movementX, movementY: event.movementY, clientX: event.clientX, clientY: event.clientY, locked: input.locked, captured: document.pointerLockElement === game.canvas }); };
    document.addEventListener('mousemove', movement, true); probe.restores.push(() => document.removeEventListener('mousemove', movement, true));
    const originalInput = input.gunner;
    input.gunner = function(...args) { const before = { dx: this.mouseDX, dy: this.mouseDY, device: this.lastDevice, locked: this.locked }, command = originalInput.apply(this, args); probe.command = { ...command }; probe.inputBefore = before; probe.eventSerial = probe.serial; return command; };
    probe.restores.push(() => { input.gunner = originalInput; });
    const originalUpdate = gunner.update;
    gunner.update = function(...args) { const before = state(), command = { ...args[1] }, extra = args[4], result = originalUpdate.apply(this, args); if (probe.armed) probe.control = { dt: args[0], before, after: state(), command, inputBefore: probe.inputBefore, eventSerial: probe.eventSerial,
      extra: { carQuat: extra?.carQuat?.toArray(), poseRevision: extra?.poseRevision, streamPoseGeneration: extra?.streamPoseGeneration } }; return result; };
    probe.restores.push(() => { gunner.update = originalUpdate; });
    const originalRig = run.gcam.update;
    run.gcam.update = function(...args) { const result = originalRig.apply(this, args); if (probe.armed) probe.rig = { dt: args[0], eye: args[1].toArray(), yaw: args[2], pitch: args[3], ads: args[4], returnedDirection: result.toArray(), after: state() }; return result; };
    probe.restores.push(() => { run.gcam.update = originalRig; });
    const originalCamera = run._camera;
    run._camera = function(...args) { const result = originalCamera.apply(this, args); if (probe.armed) { game.camera.updateMatrixWorld(); const final = state(); let mountedDirection = null; const rig = this.gunner.weapon.mounted && this.wv.mountedWeapon(this.states.get(this.playerId), this.gunner.weaponId); if (rig?.pitchJoint) { rig.pitchJoint.updateWorldMatrix(true, false); const e = rig.pitchJoint.matrixWorld.elements, n = Math.hypot(e[8], e[9], e[10]); mountedDirection = [e[8] / n, e[9] / n, e[10] / n]; } probe.rows.push({ dt: args[0], controller: probe.control, rigStage: probe.rig, final, mountedDirection }); } return result; };
    probe.restores.push(() => { run._camera = originalCamera; });
    const originalRun = run.update;
    run.update = function(...args) { const result = originalRun.apply(this, args); const row = probe.rows.at(-1); if (probe.armed && row?.final.frame === game.frames) row.afterRunUpdate = { at: performance.now(), vm: vmState(), paused: game.paused, phase: run.phase }; return result; };
    probe.restores.push(() => { run.update = originalRun; });
  });
}
const short = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const angular = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, v, i) => sum + v * b[i], 0)) / Math.hypot(...a) / Math.hypot(...b)));
function carrierTwist(controller) {
  const b = controller.before, e = controller.extra;
  const recovered = Number.isInteger(e.poseRevision) && b.previousRevision !== null && e.poseRevision !== b.previousRevision;
  const rebased = Number.isInteger(e.streamPoseGeneration) && b.previousGeneration !== null && e.streamPoseGeneration !== b.previousGeneration;
  if (!b.hasPreviousCarrier || recovered || rebased) return { inherited: 0, recovered, rebased };
  const a = e.carQuat, p = b.previousCarrier, an = Math.hypot(...a), pn = Math.hypot(...p);
  const [ax, ay, az, aw] = a.map(v => v / an), [px, py, pz, pw] = p.map(v => v / pn);
  // Current normalized carrier times conjugate of previous: independent
  // arithmetic from captured arguments, never a pose/controller setter.
  const dy = -aw * py + ay * pw - az * px + ax * pz, dw = aw * pw + ax * px + ay * py + az * pz;
  const twist = Math.hypot(dy, dw) > 1e-12 ? short(2 * Math.atan2(dy, dw)) : 0;
  return { inherited: twist * .55, twist, recovered, rebased };
}
function analyse(rows, view) {
  const violations = [], checks = []; let travel = 0, inputTravel = 0, seams = 0, backward = 0, snapshotAdvances = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i], old = rows[i - 1], c = row.controller;
    if (!c || row.final.frame === old.final.frame) continue;
    const yawDelta = short(c.after.yaw - c.before.yaw), inputDelta = c.command.dYaw * (c.before.ads > .5 ? c.before.scope ? .28 : .6 : 1);
    const carrier = carrierTwist(c), expectedYawDelta = inputDelta + carrier.inherited, controllerResidual = Math.abs(short(yawDelta - expectedYawDelta));
    travel += Math.abs(yawDelta); inputTravel += Math.abs(inputDelta); if (Math.abs(row.final.yaw - old.final.yaw) > Math.PI) seams++;
    const dir = row.final.camera.direction, [x, y, z, w] = row.final.carrier.quat;
    const fwd = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
    if (dir.reduce((sum, v, axis) => sum + v * fwd[axis], 0) < -.95) backward++;
    const cameraDelta = angular(row.final.camera.quat, old.final.camera.quat), carrierDelta = angular(row.final.carrier.quat, old.final.carrier.quat);
    const allowed = Math.abs(short(row.final.yaw - old.final.yaw)) + Math.abs(row.final.pitch - old.final.pitch) + carrierDelta * .5 + .18;
    const aimPitch = Math.max(-1.25, Math.min(1.25, row.final.pitch + row.final.view.kickPitch));
    const expected = row.mountedDirection || [Math.sin(row.final.yaw + row.final.view.kickYaw) * Math.cos(aimPitch), Math.sin(aimPitch), Math.cos(row.final.yaw + row.final.view.kickYaw) * Math.cos(aimPitch)];
    const aimDot = dir.reduce((sum, value, axis) => sum + value * expected[axis], 0);
    const snapshotAge = row.final.at / 1000 - row.final.snapshot.lastArrival;
    if (row.final.snapshot.latest > old.final.snapshot.latest) snapshotAdvances++;
    const check = { index: i, frame: row.final.frame, cameraDelta, carrierDelta, allowed, aimDot, inputDelta, yawDelta, expectedYawDelta, controllerResidual, carrier, snapshotAge };
    checks.push(check);
    if (cameraDelta > allowed || aimDot < .98 || controllerResidual > .1 || !Number.isFinite(cameraDelta) || !Number.isFinite(controllerResidual)) violations.push(check);
    const f = row.final, expectedAds = view === 'rifle-ads';
    if (!f.alive || f.defeated || f.intro || f.cinematic || f.victory || f.screen !== 'run' || f.role !== 'gunner' || f.simPeer || f.paused || !f.focused || f.hidden || !f.view.firstPerson || (expectedAds ? f.view.adsK < .95 : f.view.adsK > .05) || !f.input.captured || f.input.device !== 'kbm' || !(snapshotAge >= 0 && snapshotAge < 5) || !(f.snapshot.queue > 0)) violations.push({ index: i, frame: f.frame, invalidScope: f });
  }
  if (snapshotAdvances < 5) violations.push({ invalidScope: 'Viewer snapshot stream did not meaningfully advance during this phase', snapshotAdvances });
  return { violations, checks, travel, inputTravel, seams, backward, snapshotAdvances, rows: rows.length };
}
async function phase(room, view, sign) {
  const page = room.gunner; activePage = page; await page.bringToFront();
  if (await page.evaluate(() => window.__game.paused)) await page.locator('[data-act="resume"]').click();
  await page.keyboard.press(view === 'hip' ? '1' : view === 'rifle-ads' ? '2' : '3');
  await page.mouse.move(640, 330); await page.mouse.click(640, 330);
  await until(page, () => window.__game.input.locked && document.pointerLockElement === window.__game.canvas && !window.__run.introOutside && !window.__game.paused);
  await page.mouse.up({ button: 'right' }); if (view === 'rifle-ads') await page.mouse.down({ button: 'right' });
  await until(page, view => window.__run.gunner.weaponId === (view === 'hip' ? 'pistol' : view === 'rifle-ads' ? 'rifle' : 'minigun') && window.__run.gunner.swapT <= 0 && (view === 'rifle-ads' ? window.__run.gcam.adsK > .99 : window.__run.gcam.adsK < .01), view);
  assert.equal(await page.evaluate(() => window.__run.gcam.firstPerson), true);
  await observe(page); const label = `${room.proof.hostRole}-${view}-${sign}`; await screenshot(page, label + '-before');
  const sensitivity = await page.evaluate(() => window.__game.input.sens.mouse), pixels = Math.max(1, Math.round(.065 / sensitivity / (view === 'rifle-ads' ? .6 : 1)));
  await page.evaluate(() => { window.__friendSpin.armed = true; });
  let backwardShot = false, seamShot = false, failedShot = false, observedRows = 0, previousRow;
  for (let step = 1; step <= 120; step++) {
    // Game increments frames after Run.update. Compare against the last
    // recorded row, so the next actual consumed command is never skipped.
    const prior = await page.evaluate(() => ({ frame: window.__friendSpin.rows.at(-1)?.final.frame ?? window.__game.frames - 1, serial: window.__friendSpin.serial })); await page.mouse.move(640 + sign * pixels * step, 330);
    await until(page, prior => window.__friendSpin.rows.some(row => row.final.frame > prior.frame && row.controller?.eventSerial > prior.serial && Math.abs(row.controller.command.dYaw) > 0), prior, 30000);
    const fresh = await page.evaluate(offset => window.__friendSpin.rows.slice(offset), observedRows); observedRows += fresh.length;
    for (const current of fresh) { if (!previousRow) { previousRow = current; continue; }
      const a = previousRow.final, b = current.final, cameraTurn = angular(a.camera.quat, b.camera.quat); previousRow = current;
      if (!seamShot && Math.abs(a.yaw - b.yaw) > Math.PI) { await screenshot(page, label + '-yaw-seam-original'); seamShot = true; }
      const [x, y, z, w] = b.carrier.quat, facing = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
      if (!backwardShot && b.camera.direction.reduce((sum, value, i) => sum + value * facing[i], 0) < -.95) { await screenshot(page, label + '-backward-original'); backwardShot = true; }
      if (!failedShot && cameraTurn > 1) { await screenshot(page, label + '-unexpected-large-turn-original'); failedShot = true; }
    }
  }
  await page.evaluate(() => { window.__friendSpin.armed = false; });
  await screenshot(page, label + '-after');
  const raw = await page.evaluate(() => ({ rows: window.__friendSpin.rows, mouseEvents: window.__friendSpin.events, end: window.render_game_to_text() }));
  const analysis = analyse(raw.rows, view), result = { label, view, sign, pixels, sensitivity, room: room.proof, originalScreenshots: { backwardShot, seamShot, failedShot }, ...analysis, ...raw };
  report.phases.push(result); await writeFile(resolve(out, label + '.json'), JSON.stringify(result)); await chronology({ type: 'phase', label, analysis });
  await page.evaluate(() => { for (const restore of window.__friendSpin.restores.splice(0).reverse()) restore(); }); await page.mouse.up({ button: 'right' });
  assert.ok(raw.mouseEvents.length >= 120 && raw.mouseEvents.every(event => event.trusted && event.locked && event.captured), 'Actual trusted locked pointer events required');
  assert.ok(analysis.inputTravel > Math.PI * 2 && analysis.travel > Math.PI * 2 && analysis.seams > 0 && analysis.backward > 0, 'Actual full-circle input, yaw seam and backward view coverage required');
  assert.deepEqual(analysis.violations, [], `Observed camera or healthy-viewer scope failure: ${label}`);
}
function assertPageEvidence() {
  for (const row of report.pages) {
    assert.deepEqual(row.errors, []); assert.deepEqual(row.console.filter(message => message.type === 'error'), []);
    assert.ok(row.entries.length); for (const entry of row.entries) assert.equal(entry.sha256, report.entry.sha256);
    // Resource failures remain raw and block overall acceptance, independently
    // of the camera investigation. No media/GLB suffix or abort suppression.
    assert.deepEqual(row.failures.filter(failure => !(failure.status === 404 && new URL(failure.url).pathname === '/favicon.ico')), []);
  }
}
try {
  let ready = false; for (let i = 0; i < 100; i++) { assert.deepEqual(report.preview.errors, []); assert.deepEqual(report.preview.exits, []); try { const response = await fetch(base); ready = response.ok && hash(Buffer.from(await response.arrayBuffer())) === report.indexSha256; } catch { /* Owned preview may not have bound yet. */ } if (ready) break; await delay(100); } assert.ok(ready);
  browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  report.browser = { version: browser.version(), headless: true, muted: true, software: true };
  for (const hostRole of ['driver', 'gunner']) {
    const pair = await room(hostRole);
    for (const view of ['hip', 'rifle-ads', 'minigun-hip']) for (const sign of [-1, 1]) await phase(pair, view, sign);
    for (const page of [pair.gunner, pair.driver]) { await page.mouse.up(); await page.mouse.up({ button: 'right' }); await page.evaluate(() => { window.__spinShieldRestore?.(); window.__app.title(); }); const context = page.context(); await context.close(); contexts.delete(context); report.cleanup.push({ label: receipts.get(page).label, ownedContextClosed: true }); }
  }
  report.orientationPassed = true; await Promise.all(responseTasks);
  assertPageEvidence(); assert.deepEqual(report.preview.errors, []); assert.deepEqual(report.preview.exits, []);
  assert.equal(hash(await readFile(resolve(root, 'dist', entry.slice(1)))), report.entry.sha256); report.passed = true;
} catch (error) {
  report.errors.push(error.stack || String(error)); process.exitCode = 1;
  try { if (activePage && !activePage.isClosed()) { await screenshot(activePage, 'original-failure'); report.failureRaw = await activePage.evaluate(() => ({ state: window.__friendSpin?.state(), rows: window.__friendSpin?.rows, events: window.__friendSpin?.events })); } } catch (error) { report.errors.push(`Failure capture: ${error}`); }
} finally {
  for (const context of contexts) { try { await context.close(); report.cleanup.push({ failureOwnedContextClosed: true }); } catch (error) { report.errors.push(String(error)); report.passed = false; } }
  try { await browser?.close(); report.cleanup.push({ ownedBrowserClosed: true }); } catch (error) { report.errors.push(`Owned browser close: ${error}`); report.passed = false; }
  const requestedTermination = preview.kill(); await Promise.race([new Promise(done => { if (preview.exitCode !== null || preview.signalCode !== null) done(); else preview.once('exit', done); }), delay(5000)]);
  report.cleanup.push({ ownedPreview: preview.pid, requestedTermination, exitCode: preview.exitCode, signalCode: preview.signalCode });
  if (preview.exitCode === null && preview.signalCode === null) { preview.kill('SIGKILL'); report.errors.push('Owned preview failed bounded termination'); report.passed = false; }
  await Promise.allSettled(responseTasks);
  if (report.orientationPassed) { try { assertPageEvidence(); assert.deepEqual(report.preview.errors, []); } catch (error) { report.errors.push(`Final late evidence check: ${error}`); report.passed = false; } }
  if (report.errors.length) report.passed = false; if (!report.passed) process.exitCode = 1; report.finishedAt = new Date().toISOString();
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report)); console.log(JSON.stringify({ passed: report.passed, orientationPassed: report.orientationPassed, phases: report.phases.map(row => ({ label: row.label, violations: row.violations, travel: row.travel, inputTravel: row.inputTravel })), errors: report.errors }));
}

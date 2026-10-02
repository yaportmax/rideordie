// Run the built game in Chromium. No external signalling service or mocked physics/rendering.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { startPeerServer } from './peer_server.mjs';

const output = process.env.QA_OUTPUT || 'shots/quality';
await mkdir(output, { recursive: true });
const selectedPhases = (process.env.QA_PHASES || 'solo,devnet-driver,devnet-gunner,app-coop-driver,app-coop-gunner').split(',');
const evidence = { checks: [], console: [], errors: [], network: [], selectedPhases, completedPhases: [], bundleAssets: [], startedAt: new Date().toISOString() };
const base = process.env.GAME_URL || 'http://127.0.0.1:5180';
const preview = process.env.GAME_URL ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
preview?.stderr.on('data', (b) => evidence.console.push(`preview: ${b}`));
preview?.stdout.on('data', (b) => process.stdout.write(b));
let browser, signalling;
const pages = [];
const record = (name, details) => { evidence.checks.push({ name, ...details }); console.log(`PASS ${name}: ${JSON.stringify(details)}`); };
const shot = (page, name) => page.screenshot({ path: `${output}/${name}.png`, timeout: 30000 });
const until = (page, fn, arg, timeout = 180000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

async function newPage(label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    localStorage.setItem('rideordie.settings.v1', JSON.stringify({ quality: 0, resScale: 0.5, master: 0, motionBlur: false, chromatic: false, grain: false }));
  });
  const page = await context.newPage(); pages.push(page);
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => evidence.errors.push(`${label}: ${e.stack || e}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) evidence.console.push(`${label}: ${m.type()}: ${m.text()}`); });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) evidence.network.push(`${label}: ${r.status()} ${r.url()}`);
    if (/\/assets\/index-[^/?]+\.js(?:\?|$)/.test(r.url()) && !evidence.bundleAssets.includes(r.url())) evidence.bundleAssets.push(r.url());
  });
  return page;
}

async function seat(page, role) {
  await page.locator('.title [data-act="solo"]').click();
  await page.locator(`.title [data-seat="${role}"]`).click();
  await page.locator('.garage [data-ready="1"]').waitFor();
}

async function activateInput(page, capture = false) {
  // One browser controls two players here. Focusing one page may correctly
  // pause the other; its real co-op simulation and networking keep running.
  await page.bringToFront();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (await page.evaluate(() => window.__game.paused)) await page.locator('[data-act="resume"]').click();
  await until(page, () => !window.__game.paused && document.hasFocus() && !document.hidden, null, 15000);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (capture) {
    if (!await page.evaluate(() => window.__game.input.locked && document.pointerLockElement === window.__game.canvas)) await page.mouse.click(640, 350);
    await until(page, () => !window.__game.paused && window.__game.input.locked && document.pointerLockElement === window.__game.canvas, null, 15000);
  }
}

async function videoResizeFlow(page) {
  const saved = await page.evaluate(() => {
    const post = window.__game.post;
    const state = { quality: post.quality, scale: post.resolutionCeiling, automatic: post.autoResolution };
    post.autoResolution = false;
    post.setQuality(2); // Enable the High depth/AO path while exercising buffer resizing.
    return state;
  });
  const checkpoints = [];
  const checkpoint = async (label) => {
    const before = await page.evaluate(() => window.__game.frames);
    await until(page, (f) => window.__game.frames >= f + 4, before);
    const state = await page.evaluate(() => {
      const game = window.__game, post = game.post, gl = game.renderer.getContext();
      const image = post.depthTexture?.image, rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        viewport: [innerWidth, innerHeight], canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        scale: post.resolutionScale, internal: [post.internalSize.x, post.internalSize.y],
        color: [post.composer.inputBuffer.width, post.composer.inputBuffer.height],
        depth: image ? [image.width, image.height] : null,
        glError: gl.getError(), contextLost: gl.isContextLost(),
        renderer: rendererInfo ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    });
    assert.equal(state.glError, 0, `${label}: WebGL error after resize`);
    assert.equal(state.contextLost, false, `${label}: WebGL context was lost`);
    assert.deepEqual(state.internal, state.canvas.map((n) => Math.max(4, Math.round(n * state.scale))), `${label}: scaled render size`);
    assert.deepEqual(state.color, state.internal, `${label}: scene color buffer size`);
    assert.deepEqual(state.depth, state.internal, `${label}: scene depth texture size`);
    checkpoints.push({ label, ...state });
  };
  try {
    for (const scale of [1, 0.8, 0.65, 1]) {
      await page.evaluate((s) => window.__game.post.setResolutionScale(s), scale);
      await checkpoint(`resolution scale ${scale}`);
      assert.equal(checkpoints.at(-1).scale, scale);
    }
    await page.setViewportSize({ width: 1400, height: 800 });
    await checkpoint('viewport 1400x800');
    assert.deepEqual(checkpoints.at(-1).viewport, [1400, 800]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await checkpoint('viewport 1280x720');
    assert.deepEqual(checkpoints.at(-1).viewport, [1280, 720]);
    const framebuffers = evidence.console.filter((m) => /framebuffer.*(?:incomplete|not complete)|incomplete.*(?:framebuffer|attachment)|FRAMEBUFFER_INCOMPLETE|GL_INVALID_FRAMEBUFFER_OPERATION/i.test(m));
    assert.deepEqual(framebuffers, [], 'resolution and viewport transitions must not produce incomplete framebuffers');
    await shot(page, '06c-resolution-resize');
    record('High graphics resolution and viewport resizing preserve complete color and depth buffers', { hardwareGpu: !!process.env.HARDWARE_GPU, checkpoints });
  } finally {
    await page.evaluate((state) => {
      const post = window.__game.post;
      post.setQuality(state.quality); post.setResolutionScale(state.scale); post.autoResolution = state.automatic;
    }, saved);
  }
}

async function soloFlow() {
  const page = await newPage('menus/solo');
  await page.goto(base); await until(page, () => window.__ready && window.__app?.screen === 'title');
  await page.locator('.title [data-act="solo"]').waitFor();
  await shot(page, '01-title');
  // Typing room codes must never send vehicle commands or hijack navigation keys.
  await page.locator('.title [data-act="join"]').click();
  await page.locator('.title input.code').fill('WASDR');
  const typing = await page.evaluate(() => ({ keys: [...window.__game.input.keys], value: document.querySelector('.title input.code').value }));
  assert.equal(typing.value, 'WASDR'); assert.deepEqual(typing.keys, []);
  await page.locator('.title [data-act="jback"]').click();
  await seat(page, 'driver'); await shot(page, '02-garage');
  await page.locator('.garage [data-ready="1"]').click();
  await until(page, () => window.__run?.started && !window.__game.paused);
  const initial = await page.evaluate(() => window.__run.player.s);
  await page.keyboard.down('w');
  await until(page, (s) => window.__run.player.s > s + 12, initial);
  await page.keyboard.up('w');
  const driving = await page.evaluate(() => ({ distance: window.__run.player.s, speed: window.__run.player.veh.speed, held: window.__run.player.held }));
  assert.ok(driving.speed > 2); assert.equal(driving.held, false);
  await shot(page, '03-driver'); record('driver moves with real physics', driving);
  await page.keyboard.down('w');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await until(page, () => window.__game.paused);
  await page.keyboard.up('w');
  const pauseTime = await page.evaluate(() => window.__run.sim.time);
  await wait(700);
  assert.equal(await page.evaluate(() => window.__run.sim.time), pauseTime);
  assert.equal(await page.evaluate(() => window.__game.input.keys.size), 0);
  await shot(page, '04-pause');
  await page.locator('[data-act="resume"]').click();
  await until(page, (t) => window.__run.sim.time > t + 0.1, pauseTime);
  record('focus loss pauses solo and clears held inputs', { pauseTime });

  await page.evaluate(() => window.__run.sim.explodeCar(window.__run.player, 'test', -1));
  await until(page, () => window.__app.screen === 'results');
  await shot(page, '05-results');
  const payout = await page.evaluate(() => ({ runs: window.__app.profile.runs, cash: window.__app.profile.cash, id: window.__run.summary.id,
    distance: window.__run.summary.distance, startS: window.__run.summary.startS, furthestS: window.__run.summary.furthestS }));
  assert.equal(payout.runs, 1); assert.ok(Number.isFinite(payout.cash));
  assert.equal(payout.startS, 40); assert.ok(payout.furthestS > payout.startS);
  assert.equal(payout.distance, payout.furthestS - payout.startS);
  await page.evaluate(() => window.__app._results(window.__run));
  assert.equal(await page.evaluate(() => window.__app.profile.runs), 1);
  await page.locator('[data-act="cont"]').click();
  if (await page.evaluate(() => window.__app.screen === 'results')) await page.locator('[data-act="cont"]').click();
  await until(page, () => window.__app.screen === 'garage');
  assert.equal(await page.evaluate(() => window.__run.sim.world), null);
  assert.equal(await page.evaluate(() => window.__run.disposed && window.__game.run === null), true);
  assert.equal(await page.evaluate(() => window.__game.paused), false);
  record('results pay once and dispose the previous physics world', payout);

  await page.evaluate(() => window.__app.title());
  await seat(page, 'gunner');
  // Fund the shop fixture; purchase, equip and start through the same controls used in live play.
  await page.evaluate(() => { window.__app.profile.cash = 5000; window.__app._garageRefresh(); });
  await page.locator('.garage [data-tab="weapons"]').click();
  await page.locator('.garage [data-row="smg"]').click();
  await page.locator('.garage [data-buy="1"]').click();
  await until(page, () => !!window.__app.profile.weapons.smg);
  await page.locator('.garage [data-slot="0"]').click();
  await until(page, () => window.__app.profile.loadout[0] === 'smg');
  await page.locator('.garage [data-ready="1"]').click();
  await until(page, () => window.__run?.started && window.__run.role === 'gunner' && !window.__game.paused);
  assert.equal(await page.evaluate(() => window.__run.gunner.weaponId), 'smg');
  const ordinaryInput = await page.evaluate(() => ({ forced: !!window.__forceGunner, aimbot: !!window.__aimbot, autodrive: !!window.__autodrive,
    activeRun: window.__run === window.__game.run && !window.__run.disposed, ads: window.__run.gunner.ads }));
  assert.deepEqual(ordinaryInput, { forced: false, aimbot: false, autodrive: false, activeRun: true, ads: 0 }, 'SMG hip fire must use the active run and ordinary mouse input');
  const mag = await page.evaluate(() => window.__run.gunner.magNow);
  await page.mouse.move(640, 350); await page.mouse.down();
  await until(page, (n) => window.__run.gunner.magNow < n - 2, mag);
  await page.mouse.up();
  const afterShot = await page.evaluate(() => window.__run.gunner.magNow);
  await page.keyboard.press('r');
  await until(page, () => window.__run.gunner.reloading);
  await until(page, () => !window.__run.gunner.reloading);
  assert.equal(await page.evaluate(() => window.__run.gunner.magNow), mag);
  await shot(page, '06-gunner');
  record('solo SMG purchase, equip, hip fire and reload through normal menus', { mag, afterShot, ordinaryInput });

  await page.evaluate(() => {
    window.__captureTrace = [];
    const trace = (type, detail = '') => {
      const game = window.__game, app = window.__app;
      window.__captureTrace.push({ at: performance.now(), type, detail, locked: game.input.locked,
        captured: document.pointerLockElement === game.canvas, paused: game.paused, releasing: app._releasing, focus: document.hasFocus() });
    };
    for (const name of ['pointerlockchange', 'pointerlockerror']) document.addEventListener(name, () => trace(name));
    for (const name of ['blur', 'focus']) window.addEventListener(name, () => trace(name));
    for (const name of ['mousedown', 'mouseup', 'click']) window.addEventListener(name, e => trace(name, e.target.tagName), true);
    const request = window.__game.canvas.requestPointerLock;
    window.__game.canvas.requestPointerLock = function(...args) {
      trace('requestPointerLock');
      const result = request.apply(this, args);
      result?.then?.(() => trace('requestPointerLock-resolved'), error => trace('requestPointerLock-rejected', `${error.name}: ${error.message}`));
      return result;
    };
    const pause = window.__app._pause;
    window.__app._pause = function(...args) { trace('App._pause', new Error().stack); return pause.apply(this, args); };
    trace('capture-fixture-start');
  });

  // Ordinary capture release must still open a working pause menu, then Resume must restore it.
  await until(page, () => window.__game.input.locked && document.pointerLockElement === window.__game.canvas);
  await page.evaluate(() => document.exitPointerLock());
  await until(page, () => window.__game.paused && !document.pointerLockElement);
  await page.locator('[data-act="resume"]').click();
  await until(page, () => !window.__game.paused && window.__game.input.locked && document.pointerLockElement === window.__game.canvas);

  // Model an active run whose initial capture request failed. Use the existing intentional-release path
  // to leave gameplay active; all subsequent firing/capture input is real browser mouse input.
  await page.evaluate(() => { window.__captureReleaseAt = performance.now(); window.__app._releasing = true; document.exitPointerLock(); });
  await page.waitForFunction(() => !window.__game.input.locked && !document.pointerLockElement && !window.__game.paused
    && window.__captureTrace.some(e => e.type === 'pointerlockchange' && !e.captured && e.at >= window.__captureReleaseAt), null, { timeout: 10000 });
  const unlocked = await page.evaluate(() => ({
    canvasReceivesClick: document.elementFromPoint(640, 350) === window.__game.canvas,
    fire: window.__game.input.mouse.left, ads: window.__game.input.mouse.right,
    mag: window.__run.gunner.magNow, shots: window.__run.gunner.shots,
  }));
  assert.equal(unlocked.canvasReceivesClick, true, 'the hidden full-screen menu container must not intercept CLICK TO AIM');
  assert.equal(unlocked.fire, false); assert.equal(unlocked.ads, false);
  await page.mouse.click(640, 350);
  await page.waitForFunction(() => window.__game.input.locked && document.pointerLockElement === window.__game.canvas, null, { timeout: 10000 });
  await page.mouse.down();
  await until(page, (n) => window.__run.gunner.magNow < n - 3, unlocked.mag);
  await page.mouse.up();
  const restored = await page.evaluate(() => ({ mag: window.__run.gunner.magNow, shots: window.__run.gunner.shots, ads: window.__run.gunner.ads, locked: window.__game.input.locked }));
  assert.ok(restored.shots > unlocked.shots + 3); assert.equal(restored.ads, 0); assert.equal(restored.locked, true);
  await shot(page, '06b-smg-hip-fire-recaptured');
  record('SMG hip fire recovers mouse capture after an unlocked run without a HUD click shield', { unlocked, restored, captureTrace: await page.evaluate(() => window.__captureTrace) });
  await videoResizeFlow(page);
  await page.context().close();
}

async function coopFlow(hostRole) {
  const host = await newPage(`host-${hostRole}`), guest = await newPage(`guest-${hostRole}`);
  const query = `peerHost=127.0.0.1&peerPort=${signalling.port}&seed=7&s=300&weapons=smg`;
  await host.goto(`${base}/?devnet=host&role=${hostRole}&${query}`);
  await until(host, () => window.__code);
  const code = await host.evaluate(() => window.__code);
  await guest.goto(`${base}/?devnet=join&code=${code}&${query}`);
  await Promise.all([until(host, () => window.__run?.started), until(guest, () => window.__run?.started)]);
  const driver = hostRole === 'driver' ? host : guest, gunner = hostRole === 'gunner' ? host : guest;
  const id = await driver.evaluate(() => window.__run.id);
  assert.equal(await gunner.evaluate(() => window.__run.id), id);
  assert.equal(await driver.evaluate(() => window.__run.partnerReady), true);
  assert.ok(await gunner.evaluate(() => window.__run.buf.latest.tick > 0));
  const initial = await driver.evaluate(() => window.__run.player.s);
  await driver.keyboard.down('w');
  await until(driver, (s) => window.__run.player.s > s + 14, initial);
  await driver.keyboard.up('w');
  await until(gunner, (s) => window.__run.playerS > s + 10, initial);
  const mag = await gunner.evaluate(() => window.__run.gunner.magNow);
  await gunner.mouse.move(640, 350); await gunner.mouse.down();
  await until(gunner, (n) => window.__run.gunner.magNow < n, mag);
  await gunner.mouse.up();
  await until(driver, () => window.__run.shots > 0);
  // Damage and heal in the authority, then request a second medkit from the viewer.
  await driver.evaluate(() => { window.__run.medkits = 2; window.__run.player.crew.gunner.hp *= 0.4; });
  await until(gunner, () => window.__run.medkits === 2);
  await gunner.keyboard.press('x');
  await until(driver, () => window.__run.medkits === 1);
  await until(gunner, () => window.__run.medkits === 1);
  const details = await driver.evaluate(() => ({ distance: window.__run.player.s, shots: window.__run.shots, medkits: window.__run.medkits }));
  await shot(driver, `07-coop-${hostRole}-driver`); await shot(gunner, `08-coop-${hostRole}-gunner`);
  await driver.evaluate(() => window.__run.sim.explodeCar(window.__run.player, 'test', -1));
  await until(driver, () => window.__run.summary);
  await until(gunner, () => window.__run.remoteSummary);
  assert.equal(await gunner.evaluate(() => window.__run.remoteSummary.id), id);
  assert.equal(await driver.evaluate(() => window.__run.summary.id), id);
  const summary = await driver.evaluate(() => window.__run.summary);
  const remoteSummary = await gunner.evaluate(() => window.__run.remoteSummary);
  assert.deepEqual(remoteSummary, summary, 'the viewer must receive the complete authoritative summary');
  assert.equal(summary.startS, 300); assert.ok(summary.furthestS > summary.startS);
  assert.equal(summary.distance, summary.furthestS - summary.startS);
  await Promise.all([until(driver, () => window.__run.finished), until(gunner, () => window.__run.finished)]);
  record(`two-player run, ${hostRole} hosts`, { ...details, id, summary });
  await host.context().close(); await guest.context().close();
}

async function appCoopFlow(hostRole) {
  const tag = `menu-coop-${hostRole}`;
  const host = await newPage(`${tag}-host`), guest = await newPage(`${tag}-guest`);
  const driver = hostRole === 'driver' ? host : guest, gunner = hostRole === 'gunner' ? host : guest;
  const guestRole = hostRole === 'driver' ? 'gunner' : 'driver';
  for (const page of [host, guest]) {
    await page.goto(base); await until(page, () => window.__ready && window.__app?.screen === 'title');
    await page.locator('.title [data-act="host"]').waitFor();
    // The real App creates the real Session/PeerJS transport. Change only its
    // signalling address before opening a room; WebRTC carries all game data.
    await page.evaluate(port => {
      const app = window.__app, original = app._newSession;
      app._newSession = function(...args) {
        const session = original.apply(this, args);
        session.tp.peerOptions = { host: '127.0.0.1', port, path: '/peerjs', secure: false, config: { iceServers: [] } };
        return session;
      };
    }, signalling.port);
  }
  await host.evaluate(() => { window.__app.profile.cash = 7000; });
  await guest.evaluate(() => { window.__app.profile.cash = 5000; });
  await host.locator('.title [data-act="host"]').click();
  await until(host, () => window.__app.session?.code && window.__app.session.me.role === 'driver');
  if (hostRole === 'gunner') {
    await host.locator('.lobby [data-seat="gunner"]').click();
    await until(host, () => window.__app.session.me.role === 'gunner');
  }
  const code = await host.evaluate(() => window.__app.session.code);
  await guest.locator('.title [data-act="join"]').click();
  await guest.locator('.title input.code').fill(code);
  await guest.locator('.title [data-act="jgo"]').click();
  await Promise.all([until(host, () => window.__app.session.connected && window.__app.session.other), until(guest, () => window.__app.session.connected && window.__app.session.other)]);
  await guest.locator(`.lobby [data-seat="${guestRole}"]`).click();
  await until(host, role => window.__app.session.other?.role === role, guestRole);
  await until(guest, roles => window.__app.session.me.role === roles.guestRole && window.__app.session.other?.role === roles.hostRole, { hostRole, guestRole });
  await host.locator('.lobby [data-act="ready"]').click();
  await until(guest, role => window.__app.session.other?.ready && window.__app.session.me.role === role, guestRole);
  await guest.locator('.lobby [data-act="ready"]').click();
  await until(host, () => window.__app.session.canStart());
  await shot(host, `${tag}-01-lobby`);
  await host.locator('.lobby [data-act="start"]').click();
  await Promise.all([until(host, () => window.__app.screen === 'garage'), until(guest, () => window.__app.screen === 'garage')]);
  // The guest buys and equips through visible shop controls; the host handles
  // the purchase and synchronizes the actual shared campaign profile.
  await guest.locator('.garage [data-tab="weapons"]').click();
  await guest.locator('.garage [data-row="smg"]').click();
  await guest.locator('.garage [data-buy="1"]').click();
  await Promise.all([until(host, () => !!window.__app.profile.weapons.smg), until(guest, () => !!window.__app.profile.weapons.smg)]);
  await guest.locator('.garage [data-slot="0"]').click();
  await Promise.all([until(host, () => window.__app.profile.loadout[0] === 'smg'), until(guest, () => window.__app.profile.loadout[0] === 'smg')]);
  assert.equal(await host.evaluate(() => window.__app.profile.cash), 7000, 'guest weapon purchase must not spend host cash');
  const guestCashBefore = await guest.evaluate(() => window.__app.profile.cash);
  assert.ok(guestCashBefore < 5000);
  assert.equal(await guest.evaluate(() => window.__app.personalProfile.cash), guestCashBefore);
  // The host pays for a shared truck upgrade from their own wallet as well.
  await host.locator('.garage [data-tab="upgrades"]').click();
  await host.locator('.garage [data-row="engine"]').click();
  await host.locator('.garage [data-buy="1"]').click();
  await Promise.all([until(host, () => (window.__app._garageLoadout?.().upgradeLevels?.engine ?? window.__app.profile.upgrades.engine) === 1),
    until(guest, () => (window.__app._garageLoadout?.().upgradeLevels?.engine ?? window.__app.profile.upgrades.engine) === 1)]);
  const cashBefore = await host.evaluate(() => window.__app.profile.cash);
  assert.ok(cashBefore < 7000);
  assert.equal(await guest.evaluate(() => window.__app.profile.cash), guestCashBefore, 'host truck upgrade must not spend guest cash');
  await shot(guest, `${tag}-02-guest-purchase`);

  const start = async () => {
    await host.locator('.garage [data-ready="1"]').click();
    await guest.locator('.garage [data-ready="1"]').click();
    await Promise.all([until(host, () => window.__app.screen === 'run' && window.__run?.started && window.__run === window.__game.run), until(guest, () => window.__app.screen === 'run' && window.__run?.started && window.__run === window.__game.run)]);
    assert.equal(await driver.evaluate(() => window.__run.role), 'driver');
    assert.equal(await gunner.evaluate(() => window.__run.role), 'gunner');
    assert.equal(await driver.evaluate(() => window.__run.id), await gunner.evaluate(() => window.__run.id));
    assert.equal(await gunner.evaluate(() => window.__run.gunner.weaponId), 'smg');
    for (const page of [driver, gunner]) assert.equal(await page.evaluate(() => !!window.__forceGunner || !!window.__forceInput || !!window.__aimbot || !!window.__autodrive), false);
    return await driver.evaluate(() => window.__run.id);
  };
  const moveAndFire = async () => {
    await activateInput(driver);
    const initial = await driver.evaluate(() => window.__run.player.s);
    await driver.keyboard.down('w');
    try { await until(driver, s => window.__run.player.s > s + 12, initial, 20000); }
    finally { await driver.keyboard.up('w'); }
    await until(gunner, s => window.__run.playerS > s + 9, initial);
    // Resume and acquire using visible UI/browser input before real hip fire.
    await activateInput(gunner, true);
    await gunner.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = await gunner.evaluate(() => ({ shots: window.__run.gunner.shots, mag: window.__run.gunner.magNow, ads: window.__run.gunner.ads, weapon: window.__run.gunner.weaponId }));
    assert.equal(before.ads, 0); assert.equal(before.weapon, 'smg');
    await until(driver, n => window.__run.shots === n, before.shots);
    const authoritativeBefore = await driver.evaluate(() => window.__run.shots);
    await gunner.mouse.down();
    try { await until(gunner, n => window.__run.gunner.shots > n + 2 && window.__run.gunner.ads === 0, before.shots, 15000); }
    finally { await gunner.mouse.up(); }
    await gunner.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await gunner.evaluate(() => ({ shots: window.__run.gunner.shots, mag: window.__run.gunner.magNow, ads: window.__run.gunner.ads }));
    assert.ok(after.mag <= before.mag - 3); assert.equal(after.ads, 0);
    await until(driver, n => window.__run.shots === n, after.shots);
    const authoritativeShots = await driver.evaluate(() => window.__run.shots);
    assert.ok(authoritativeShots >= authoritativeBefore + 3);
    return { initial, reached: await driver.evaluate(() => window.__run.player.s), before, after,
      authoritativeBefore, authoritativeShots };
  };
  const end = async id => {
    await driver.evaluate(() => window.__run.sim.explodeCar(window.__run.player, 'test', -1));
    await Promise.all([until(host, () => window.__app.screen === 'results'), until(guest, () => window.__app.screen === 'results')]);
    const summary = await driver.evaluate(() => window.__run.summary);
    assert.equal(summary.id, id); assert.equal(summary.startS, 40);
    assert.equal(summary.distance, summary.furthestS - summary.startS);
    assert.deepEqual(await gunner.evaluate(() => window.__run.remoteSummary), summary);
    for (const page of [host, guest]) {
      assert.equal(await page.evaluate(() => window.__app.ui.screen().kind), 'results');
      const shown = await page.evaluate(() => { const r = window.__app.ui.screen().run; return { id: r.id, distance: r.distance, startS: r.startS, furthestS: r.furthestS }; });
      assert.deepEqual(shown, { id, distance: summary.distance, startS: summary.startS, furthestS: summary.furthestS });
    }
    return summary;
  };
  const garage = async () => {
    for (const page of [host, guest]) {
      await page.locator('.results [data-act="cont"]').click();
      if (await page.evaluate(() => window.__app.screen === 'results')) await page.locator('.results [data-act="cont"]').click();
      await until(page, () => window.__app.screen === 'garage');
      assert.equal(await page.evaluate(() => window.__run.disposed && window.__game.run === null && (window.__run.sim ? window.__run.sim.world === null : window.__run.qworld === null)), true);
    }
  };

  const id = await start(); const firstInput = await moveAndFire();
  await shot(gunner, `${tag}-03-smg-hip-fire`);
  const first = await end(id);
  await until(guest, () => window.__app.profile.runs === 1);
  assert.equal(await host.evaluate(() => window.__app.profile.runs), 1);
  assert.equal(await host.evaluate(() => window.__app.profile.cash), cashBefore + first.cash);
  assert.equal(await guest.evaluate(() => window.__app.profile.cash), guestCashBefore + first.cash);
  for (const page of [host, guest]) {
    await page.evaluate(() => window.__app._results(window.__run));
    assert.equal(await page.evaluate(() => window.__app.profile.runs), 1);
    assert.equal(await page.evaluate(() => window.__app.profile.cash), (page === host ? cashBefore : guestCashBefore) + first.cash);
  }
  await shot(guest, `${tag}-04-results`);
  await garage();
  await Promise.all([host.evaluate(() => { window.__firstRun = window.__run; }), guest.evaluate(() => { window.__firstRun = window.__run; })]);
  const secondId = await start(); assert.notEqual(secondId, id);
  for (const page of [host, guest]) assert.equal(await page.evaluate(() => window.__firstRun !== window.__run && window.__firstRun.disposed && !window.__run.disposed), true);
  const secondInput = await moveAndFire();
  const second = await end(secondId);
  await until(guest, () => window.__app.profile.runs === 2);
  assert.equal(await host.evaluate(() => window.__app.profile.runs), 2);
  assert.equal(await host.evaluate(() => window.__app.profile.cash), cashBefore + first.cash + second.cash);
  assert.equal(await guest.evaluate(() => window.__app.profile.cash), guestCashBefore + first.cash + second.cash);
  await garage();
  record(`normal-menu co-op purchase, hip fire, results and second run, ${hostRole} hosts`, { code, first, second, firstInput, secondInput, cashBefore, guestCashBefore,
    cashAfter: await host.evaluate(() => window.__app.profile.cash), guestCashAfter: await guest.evaluate(() => window.__app.profile.cash),
    independentWallets: true, guestWeaponPaidByGuest: true, sharedTruckUpgradePaidByHost: true, runs: 2, realPeerJsTransport: true, localSignallingOnly: true });
  await host.context().close(); await guest.context().close();
}

try {
  let reachable = false;
  for (let i = 0; i < 100; i++) {
    try { reachable = (await fetch(base)).ok; } catch { /* preview is starting */ }
    if (reachable) break; await wait(100);
  }
  assert.ok(reachable, 'game preview did not start');
  signalling = await startPeerServer();
  browser = await chromium.launch({
    headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--no-sandbox', ...(process.env.HARDWARE_GPU ? ['--use-angle=d3d11', '--force_high_performance_gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'],
  });
  const phases = { solo: soloFlow, 'devnet-driver': () => coopFlow('driver'), 'devnet-gunner': () => coopFlow('gunner'),
    'app-coop-driver': () => appCoopFlow('driver'), 'app-coop-gunner': () => appCoopFlow('gunner') };
  for (const name of selectedPhases) { assert.ok(phases[name], `unknown QA phase: ${name}`); await phases[name](); evidence.completedPhases.push(name); }
  assert.deepEqual(evidence.network, [], 'game assets failed to load');
  assert.deepEqual(evidence.errors, [], 'browser runtime errors');
  evidence.passed = true;
  console.log(`Browser gameplay checks passed. Screenshots and report are in ${output}.`);
} catch (e) {
  evidence.failure = e.stack || String(e);
  for (let i = 0; i < pages.length; i++) if (!pages[i].isClosed()) {
    try { await shot(pages[i], `failure-${i}`); } catch { /* preserve the original failure */ }
    try { evidence.checks.push({ diagnostic: i, state: await pages[i].evaluate(() => ({ ready: window.__ready, screen: window.__app?.screen, role: window.__run?.role, started: window.__run?.started, partnerReady: window.__run?.partnerReady, countdown: window.__run?.countdown, ground: window.__run?.groundOk, sim: window.__run?.sim?.state, snapshots: window.__run?.buf?.snaps.length, paused: window.__game?.paused, locked: window.__game?.input.locked,
      captured: document.pointerLockElement === window.__game?.canvas, captureTrace: window.__captureTrace, errors: document.getElementById('boot')?.textContent })) }); } catch { /* page may have crashed */ }
  }
  throw e;
} finally {
  const cleanupErrors = [];
  try { await browser?.close(); } catch (error) { cleanupErrors.push(`browser: ${error.stack || error}`); }
  evidence.browserClosed = !browser || !browser.isConnected();
  evidence.pagesClosed = pages.every(page => page.isClosed());
  try { await signalling?.close(); } catch (error) { cleanupErrors.push(`signalling: ${error.stack || error}`); }
  preview?.kill();
  evidence.finishedAt = new Date().toISOString();
  evidence.passed = !!evidence.passed && evidence.browserClosed && evidence.pagesClosed && !cleanupErrors.length;
  if (cleanupErrors.length) evidence.cleanupErrors = cleanupErrors;
  await writeFile(`${output}/report.json`, JSON.stringify(evidence, null, 2));
  assert.ok(evidence.browserClosed && evidence.pagesClosed && !cleanupErrors.length, 'browser, pages and local signalling must close before the report is finalized');
}

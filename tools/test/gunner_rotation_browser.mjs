// CI-only full Run/controller/viewmodel rotation probe. Never run on the user's laptop.
// Native browser pointer moves; camera, rendering and weapon poses are unmodified.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright-core';

assert.equal(process.env.CI, 'true', 'This rotation probe is restricted to remote CI');
const output = process.env.QA_OUTPUT || 'shots/gunner-rotation';
const base = process.env.GAME_URL || 'http://127.0.0.1:5181';
const views = (process.env.QA_ROTATION_VIEWS || 'hip').split(',');
await mkdir(output, { recursive: true });
const report = { scope: 'native pointer full Run gunner aim, survival-controlled software-rendered remote Chromium; not hardware FPS proof', phases: [], errors: [], passed: false };
const preview = process.env.GAME_URL ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5181', '--strictPort'], { stdio: 'ignore' });
let browser, activePage;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { ready = (await fetch(base)).ok; } catch {} if (ready) break; await wait(100); }
  assert.ok(ready, 'preview did not start');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'] });
  for (const view of views) for (const sign of [-1, 1]) {
    assert.ok(['hip', 'ads', 'scope', 'external'].includes(view), `Unknown rotation view ${view}`);
    const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
    await context.addInitScript(() => localStorage.setItem('rideordie.settings.v1', JSON.stringify({ quality: 0, resScale: .5, master: 0, motionBlur: false, grain: false, chromatic: false })));
    const page = await context.newPage();
    activePage = page;
    page.on('pageerror', error => report.errors.push(String(error.stack || error)));
    await page.goto(`${base}/?solo&as=gunner&s=40&seed=7&weapons=rifle,sniper`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__run?.started && window.__run.gunner, null, { timeout: 180000 });
    await page.bringToFront();
    if (await page.evaluate(() => window.__game.paused)) await page.locator('.pause [data-act="resume"]').click();
    await page.mouse.click(320, 180);
    await page.waitForFunction(() => !window.__run.introOutside && !window.__game.paused && window.__run.sim?.state === 'run', null, { timeout: 180000 });
    console.log(`READY ${view}/${sign}`);
    await page.evaluate(({ view, sign }) => {
      const run = window.__run, game = window.__game;
      if (view === 'ads') run.gunner.swapTo(run.gunner.slots.indexOf('rifle'));
      if (view === 'scope') run.gunner.swapTo(run.gunner.slots.indexOf('sniper'));
      run.gcam.firstPerson = view !== 'external';
      const originalUpdate = run.update.bind(run);
      const originalCamera = run._camera.bind(run);
      const rows = [], phase = { rows, enabled: false, count: 0, view, sign };
      window.__rotationProbe = phase;
      const originalInput = game.input.gunner.bind(game.input);
      game.input.gunner = (...args) => {
        const command = originalInput(...args);
        phase.lastInput = { dYaw: command.dYaw, dPitch: command.dPitch, locked: game.input.locked, device: game.input.lastDevice };
        return command;
      };
      run._camera = function(...args) {
        const value = originalCamera(...args);
        if (phase.enabled) {
          const camera = game.camera, g = run.gunner;
          const cp = Math.cos(g.pitch), expected = [Math.sin(g.yaw) * cp, Math.sin(g.pitch), Math.cos(g.yaw) * cp];
          const e = camera.matrixWorld.elements;
          camera.updateMatrixWorld();
          rows.push({ frame: game.frames, dt: args[0], yaw: g.yaw, pitch: g.pitch, input: phase.lastInput, quaternion: camera.quaternion.toArray(), direction: [-e[8], -e[9], -e[10]], expected, eye: run.eye.toArray(), camera: camera.position.toArray(), alive: run.states.get(run.playerId)?.gunnerAlive, state: run.sim?.state, fp: run.gcam.firstPerson, ads: run.gcam.adsK, weapon: g.weaponId });
        }
        return value;
      };
      run.update = function(...args) {
        // Explicit survival-controlled probe: avoid an enemy ending a slow CI
        // rotation. Damage, physics and camera still execute their real paths.
        if (run.player) {
          run.player.hp = run.player.maxHp = 1e9;
          for (const crew of [run.player.crew.driver, run.player.crew.gunner]) if (crew?.alive) crew.hp = crew.max = 1e9;
        }
        const value = originalUpdate(...args);
        const row = rows.at(-1), vm = run.gunner.vm;
        if (phase.enabled && row && vm) row.viewmodel = { position: vm.pos.toArray(), quaternion: vm.quat.toArray(), angularVelocity: vm.angV.toArray(), visible: vm.visible, rigged: vm.rigged };
        if (phase.enabled) ++phase.count;
        return value;
      };
    }, { view, sign });
    await page.mouse.move(320, 180); await page.mouse.click(320, 180);
    await page.waitForFunction(() => window.__game.input.locked && !!document.pointerLockElement, null, { timeout: 30000 });
    if (view === 'ads' || view === 'scope') await page.mouse.down({ button: 'right' });
    await page.waitForFunction(() => window.__run.gunner.swapT <= 0 && window.__run.gcam.adsK > (window.__rotationProbe.view === 'ads' || window.__rotationProbe.view === 'scope' ? .99 : -.01), null, { timeout: 30000 });
    await page.screenshot({ path: `${output}/${view}-${sign}-before.png`, timeout: 120000 });
    await page.evaluate(() => {
      // Reproduce a previous controller session without injecting pad axes.
      // The next real captured mouse move must take ownership before assist.
      window.__game.input.lastDevice = 'pad';
      window.__rotationProbe.enabled = true;
    });
    // Monotonic positions under pointer lock generate real movementX deltas;
    // they never recenter with an opposing mouse move at the viewport edge.
    const pixels = view === 'scope' ? 210 : view === 'ads' ? 96 : 60;
    for (let step = 1; step <= 110; step++) {
      const frame = await page.evaluate(() => window.__game.frames);
      await page.mouse.move(320 - sign * pixels * step, 180);
      await page.waitForFunction(frame => window.__game.frames > frame, frame, { timeout: 30000, polling: 'raf' });
      if (step === 23 || step === 25) await page.screenshot({ path: `${output}/${view}-${sign}-turn-${step}.png`, timeout: 120000 });
    }
    await page.evaluate(() => { window.__rotationProbe.enabled = false; });
    await page.screenshot({ path: `${output}/${view}-${sign}-after.png`, timeout: 120000 });
    const phase = await page.evaluate(() => ({ view: window.__rotationProbe.view, sign: window.__rotationProbe.sign, count: window.__rotationProbe.count, rows: window.__rotationProbe.rows, ended: window.render_game_to_text() }));
    report.phases.push(phase);
    assert.ok(phase.count >= 110, `${view}/${sign} ended before its full rotations`);
    let seams = 0, travel = 0;
    for (let i = 1; i < phase.rows.length; i++) {
      const previous = phase.rows[i - 1], row = phase.rows[i];
      if (Math.abs(row.yaw - previous.yaw) > Math.PI) seams++;
      travel += Math.abs(Math.atan2(Math.sin(row.yaw - previous.yaw), Math.cos(row.yaw - previous.yaw)));
      const aimDot = row.direction.reduce((sum, value, axis) => sum + value * row.expected[axis], 0);
      assert.ok(aimDot > .999, `${view}/${sign} camera lost current aim at frame ${row.frame}: dot ${aimDot}`);
      const quaternionDot = Math.abs(row.quaternion.reduce((sum, value, axis) => sum + value * previous.quaternion[axis], 0));
      const angle = 2 * Math.acos(Math.min(1, quaternionDot));
      assert.ok(angle < .35, `${view}/${sign} camera jumped ${angle} radians at frame ${row.frame}`);
      assert.ok(row.alive && row.state === 'run', 'rotation must remain in healthy gameplay');
      assert.ok(row.quaternion.every(Number.isFinite), 'camera orientation must remain finite');
      if (row.viewmodel) assert.ok([...row.viewmodel.position, ...row.viewmodel.quaternion, ...row.viewmodel.angularVelocity].every(Number.isFinite), 'viewmodel pose must remain finite');
    }
    assert.ok(seams >= 1, `${view}/${sign} must cross the real controller yaw seam`);
    assert.ok(travel > Math.PI * 2, `${view}/${sign} did not complete a full aim rotation: ${travel} radians`);
    assert.ok(phase.rows.some(row => Math.abs(row.input?.dYaw || 0) > .01 && row.input?.locked), 'real pointer movement must reach Input.gunner');
    assert.ok(phase.rows.filter(row => Math.abs(row.input?.dYaw || 0) > .01).every(row => row.input.device === 'kbm'), 'mouse rotation must take ownership after prior controller input');
    phase.seams = seams;
    phase.travel = travel;
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  try { report.failureState = await activePage?.evaluate(() => ({ready:window.__ready, screen:window.__app?.screen, paused:window.__game?.paused, started:window.__run?.started, introOutside:window.__run?.introOutside, simState:window.__run?.sim?.state, hasFocus:document.hasFocus(), hidden:document.hidden, probe:window.__rotationProbe})); } catch {}
  throw error;
}
finally {
  await browser?.close(); preview?.kill();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}

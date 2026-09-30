// Run the built game in Chromium. No external signalling service or mocked physics/rendering.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { startPeerServer } from './peer_server.mjs';

const output = 'shots/quality';
await mkdir(output, { recursive: true });
const evidence = { checks: [], console: [], errors: [], network: [] };
const base = process.env.GAME_URL || 'http://127.0.0.1:5180';
const preview = process.env.GAME_URL ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
preview?.stderr.on('data', (b) => evidence.console.push(`preview: ${b}`));
preview?.stdout.on('data', (b) => process.stdout.write(b));
let browser, signalling;
const pages = [];
const record = (name, details) => { evidence.checks.push({ name, ...details }); console.log(`PASS ${name}: ${JSON.stringify(details)}`); };
const shot = (page, name) => page.screenshot({ path: `${output}/${name}.png`, timeout: 30000 });
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 180000, polling: 100 });

async function newPage(label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    localStorage.setItem('rideordie.settings.v1', JSON.stringify({ quality: 0, resScale: 0.5, master: 0, motionBlur: false, chromatic: false, grain: false }));
  });
  const page = await context.newPage(); pages.push(page);
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => evidence.errors.push(`${label}: ${e.stack || e}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) evidence.console.push(`${label}: ${m.type()}: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) evidence.network.push(`${label}: ${r.status()} ${r.url()}`); });
  return page;
}

async function seat(page, role) {
  await page.locator('.title [data-act="solo"]').click();
  await page.locator(`.title [data-seat="${role}"]`).click();
  await page.locator('.garage [data-ready="1"]').waitFor();
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
  const payout = await page.evaluate(() => ({ runs: window.__app.profile.runs, cash: window.__app.profile.cash, id: window.__run.summary.id }));
  assert.equal(payout.runs, 1); assert.ok(Number.isFinite(payout.cash));
  await page.evaluate(() => window.__app._results(window.__run));
  assert.equal(await page.evaluate(() => window.__app.profile.runs), 1);
  await page.locator('[data-act="cont"]').click();
  if (await page.evaluate(() => window.__app.screen === 'results')) await page.locator('[data-act="cont"]').click();
  await until(page, () => window.__app.screen === 'garage');
  assert.equal(await page.evaluate(() => window.__run.sim.world), null);
  assert.equal(await page.evaluate(() => window.__game.paused), false);
  record('results pay once and dispose the previous physics world', payout);

  await page.evaluate(() => window.__app.title());
  await seat(page, 'gunner'); await page.locator('.garage [data-ready="1"]').click();
  await until(page, () => window.__run?.started && window.__run.role === 'gunner' && !window.__game.paused);
  const mag = await page.evaluate(() => window.__run.gunner.magNow);
  await page.mouse.move(640, 350); await page.mouse.down();
  await until(page, (n) => window.__run.gunner.magNow < n, mag);
  await page.mouse.up();
  const afterShot = await page.evaluate(() => window.__run.gunner.magNow);
  await page.keyboard.press('r');
  await until(page, () => window.__run.gunner.reloading);
  await until(page, () => !window.__run.gunner.reloading);
  assert.equal(await page.evaluate(() => window.__run.gunner.magNow), mag);
  await shot(page, '06-gunner');
  record('solo gunner fires and reloads while the AI drives', { mag, afterShot });
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
  assert.equal(await gunner.evaluate(() => window.__run.remoteSummary.distance), await driver.evaluate(() => window.__run.summary.distance));
  record(`two-player run, ${hostRole} hosts`, { ...details, id });
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
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'],
  });
  await soloFlow(); await coopFlow('driver'); await coopFlow('gunner');
  assert.deepEqual(evidence.network, [], 'game assets failed to load');
  assert.deepEqual(evidence.errors, [], 'browser runtime errors');
  console.log('Browser gameplay checks passed. Screenshots and report are in shots/quality.');
} catch (e) {
  evidence.failure = e.stack || String(e);
  for (let i = 0; i < pages.length; i++) if (!pages[i].isClosed()) {
    try { await shot(pages[i], `failure-${i}`); } catch { /* preserve the original failure */ }
    try { evidence.checks.push({ diagnostic: i, state: await pages[i].evaluate(() => ({ ready: window.__ready, screen: window.__app?.screen, role: window.__run?.role, started: window.__run?.started, partnerReady: window.__run?.partnerReady, countdown: window.__run?.countdown, ground: window.__run?.groundOk, sim: window.__run?.sim?.state, snapshots: window.__run?.buf?.snaps.length, paused: window.__game?.paused, errors: document.getElementById('boot')?.textContent })) }); } catch { /* page may have crashed */ }
  }
  throw e;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(evidence, null, 2));
  await browser?.close(); await signalling?.close(); preview?.kill();
}

// Reproducible first-person weapon review against an already-built server.
// GAME_URL=http://127.0.0.1:5194 node tools/test/weapon_visuals.mjs [label]
// Real mouse/key input drives the real GunnerController. Only aim is stabilized;
// reload timing is temporarily held after reaching each requested capture phase.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.GAME_URL || 'http://127.0.0.1:5194';
const label = process.argv[2] || 'candidate';
const output = `shots/weapon-visuals/${label}`;
const width = +(process.env.WIDTH || 2560), height = +(process.env.HEIGHT || 1440);
await mkdir(output, { recursive: true });
const report = { base, label, viewport: { width, height }, checks: [], snapshots: [], errors: [], network: [] };
let browser, page, cutoff, activeStarted;
const until = (fn, arg, timeout = 6000) => page.waitForFunction(fn, arg, { timeout, polling: 'raf' });
const state = () => page.evaluate(() => {
  const run = window.__run, g = run.gunner, vm = g.vm;
  const hand = (side, anchor) => {
    const socket = vm.B[`socket_hand_${side[0]}`];
    const actual = socket.getWorldPosition(socket.position.clone());
    const target = vm.root.localToWorld(anchor.p.clone());
    const targetQ = vm.root.getWorldQuaternion(anchor.q.clone()).multiply(anchor.q);
    return { position: actual.toArray(), target: target.toArray(), errorMetres: actual.distanceTo(target), rotationErrorRadians: socket.getWorldQuaternion(socket.quaternion.clone()).angleTo(targetQ) };
  };
  const gl = window.__game.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  const audio = window.__game.audio, smg = audio?.defs.get('guns/fire_smg');
  return { weapon: g.weaponId, shots: g.shots, mag: g.magNow, fullMag: g.weapon.mag, ads: g.ads,
    reloading: g.reloading, reloadRatio: g.reloadT / g.weapon.reload, swapT: g.swapT, pumpT: g.pumpT,
    locked: window.__game.input.locked, paused: window.__game.paused, simTime: run.sim.time,
    capture: { ...window.__weaponCapture }, gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
    audio: { context: audio?.ctx.state, smgPlays: smg?.plays || 0, smgLoaded: smg?.bufs.filter(Boolean).length || 0, smgMissing: audio?.notLoadedNames.has('guns/fire_smg'), gameplayPaused: !!audio?._gpPaused },
    viewmodel: { shownId: vm.shownId, dedicatedArms: vm.dedicatedArms, fingerPose: vm._poseKey,
      leftAnchor: { ...vm._R.lh }, left: hand('Left', vm._aL), right: hand('Right', vm._aR),
      cutaways: vm.gun.adsCut.map(c => ({ mesh: c.mesh.name, on: c.on, triangles: c.n })) } };
});
async function shot(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const data = await state();
  assert.equal(data.weapon, data.viewmodel.shownId, `${name}: weapon swap must have finished`);
  assert.equal(data.viewmodel.dedicatedArms, true, `${name}: dedicated arms required`);
  assert.ok(data.viewmodel.left.errorMetres < 0.045, `${name}: support wrist detached ${data.viewmodel.left.errorMetres} m`);
  assert.ok(data.viewmodel.right.errorMetres < 0.02, `${name}: gun wrist detached`);
  await page.screenshot({ path: `${output}/${name}.png`, timeout: 10000 });
  report.snapshots.push({ name, ...data });
  console.log(`CAPTURE ${name}: ${data.weapon}, mag ${data.mag}, phase ${data.reloadRatio.toFixed(3)}, left anchor ${data.viewmodel.leftAnchor.a}/${data.viewmodel.leftAnchor.b}`);
}
const check = (name, data = {}) => { report.checks.push({ name, ...data }); console.log(`PASS ${name}`); };
async function select(id) {
  const index = await page.evaluate(id => window.__run.gunner.slots.indexOf(id), id);
  assert.ok(index >= 0, `loadout is missing ${id}`);
  await page.keyboard.press(String(index + 1));
  await until(id => window.__run.gunner.weaponId === id && window.__run.gunner.swapT <= 0 && window.__run.gunner.vm.shownId === id, id);
  await page.waitForTimeout(350);
}
async function ads(on) {
  if (on) await page.mouse.down({ button: 'right' }); else await page.mouse.up({ button: 'right' });
  await until(on => on ? window.__run.gunner.ads > 0.995 && window.__run.gcam.adsK > 0.99 : window.__run.gunner.ads < 0.005 && window.__run.gcam.adsK < 0.01, on);
}
async function fire(count = 1) {
  const before = await state();
  await page.mouse.down();
  await until(n => window.__run.gunner.shots >= n, before.shots + count);
  await page.mouse.up();
  const after = await state();
  assert.ok(after.mag <= before.mag - count, 'firing must consume real ammunition');
  assert.equal(after.reloading, false, 'short firing fixture must leave rounds in the magazine');
  return { before: before.shots, after: after.shots, beforeMag: before.mag, afterMag: after.mag, ads: after.ads };
}
async function reload() {
  await page.keyboard.press('r');
  await until(() => window.__run.gunner.reloading);
  await until(() => !window.__run.gunner.reloading, null, 10000);
  const after = await state();
  assert.equal(after.mag, after.fullMag, 'reload must refill the actual magazine');
  await page.waitForTimeout(450);
  return after.mag;
}
async function phase(target) {
  await page.evaluate(target => { window.__weaponCapture.target = target; window.__weaponCapture.frozen = false; }, target);
  await until(target => window.__weaponCapture.frozen && window.__weaponCapture.actual >= target, target);
}

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'],
  });
  page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', e => report.errors.push(e.stack || e.message));
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) report.network.push({ url: r.url(), status: r.status() }); });
  await page.addInitScript(() => localStorage.setItem('rideordie.settings.v1', JSON.stringify({ quality: 2, master: 0 })));
  await page.goto(`${base}/?solo&as=gunner&s=3000&seed=7&weapons=smg,shotgun`);
  await until(() => window.__run?.started && window.__run.gunner?.vm?.dedicatedArms && !window.__game.paused, null, 180000);
  report.initialPrograms = await page.evaluate(() => window.__game.renderer.info.programs.map(p => ({ id: p.id, name: p.name, cacheKey: p.cacheKey })));
  activeStarted = Date.now();
  cutoff = setTimeout(() => { report.cutoff = '110 second active-gameplay safety cutoff'; void browser.close(); }, 110000);
  await page.evaluate(() => {
    window.__weaponCapture = { target: null, frozen: false, actual: null };
    const g = window.__run.gunner, original = g.update;
    g.update = function(dt, cmd, cam, carYaw, extra) {
      const capture = window.__weaponCapture;
      if (!capture.frozen) original.call(this, dt, cmd, cam, carYaw, extra);
      // Keep framing repeatable without bypassing firing, reloads or weapon swaps.
      this.yaw = carYaw; this.pitch = 0.015;
      if (!capture.frozen && capture.target !== null && this.reloading && this.reloadT / this.weapon.reload >= capture.target) {
        capture.frozen = true; capture.actual = this.reloadT / this.weapon.reload;
      }
      return this;
    };
  });
  await page.mouse.click(width / 2, height / 2);
  await until(() => document.pointerLockElement === window.__game.canvas);
  // The capture-acquisition click can shoot the starting pistol. Refill it via normal reload.
  if (await page.evaluate(() => window.__run.gunner.magNow < window.__run.gunner.weapon.mag)) await reload();

  if (!process.env.SMG_ONLY) {
  await ads(true); await shot('01-pistol-ads');
  check('pistol fires while aiming', await fire());
  await ads(false); await reload(); await ads(true); await shot('02-pistol-ads-after-reload'); await ads(false);

  await select('shotgun'); await shot('03-shotgun-hip');
  await ads(true); await shot('04-shotgun-ads'); await ads(false);
  check('shotgun hip shot consumes one shell', await fire()); await shot('05-shotgun-after-hip-shot');
  await page.evaluate(() => { window.__weaponCapture.target = 0.55; });
  await page.keyboard.press('r'); await phase(0.55); await shot('06-shotgun-shell-reload');
  await page.evaluate(() => { window.__weaponCapture.target = null; window.__weaponCapture.frozen = false; });
  await until(() => !window.__run.gunner.reloading, null, 10000);
  assert.equal(await page.evaluate(() => window.__run.gunner.magNow), await page.evaluate(() => window.__run.gunner.weapon.mag));
  await page.waitForTimeout(600); await ads(true); await shot('07-shotgun-ads-after-reload'); await ads(false);
  check('shotgun reload refills shell and restores aligned ADS');
  }

  await select('smg'); await shot('08-smg-hip');
  check('SMG sustained hip fire', await fire(3));
  await ads(true); await shot('09-smg-ads'); check('SMG sustained ADS fire', await fire(2));
  await ads(false); check('SMG hip fire continues after ADS release', await fire(3));
  await page.evaluate(() => { window.__weaponCapture.target = 0.13; });
  await page.keyboard.press('r'); await phase(0.13); await shot('10-smg-mag-grasp-13');
  await phase(0.38); await shot('11-smg-mag-insert-38');
  await page.evaluate(() => { window.__weaponCapture.target = null; window.__weaponCapture.frozen = false; });
  await until(() => !window.__run.gunner.reloading, null, 10000);
  assert.equal(await page.evaluate(() => window.__run.gunner.magNow), await page.evaluate(() => window.__run.gunner.weapon.mag));
  await page.waitForTimeout(500); await shot('12-smg-reload-complete');
  const restored = await state();
  assert.equal(restored.viewmodel.fingerPose, 'pose_smg|0.00');
  assert.deepEqual(restored.viewmodel.leftAnchor, { a: 'grip', b: 'grip', w: 0, arc: 0 });
  check('SMG reload restores authored closed support grip');
  check('SMG sustained hip fire after reload', await fire(3)); await shot('13-smg-hip-after-reload-fire');
  const final = await state();
  assert.equal(final.audio.context, 'running');
  assert.ok(final.audio.smgPlays > 0 && final.audio.smgLoaded > 0 && !final.audio.smgMissing && !final.audio.gameplayPaused);
  check('SMG shots reach loaded audio samples in a running audio context', final.audio);
  const hud = await page.evaluate(() => {
    const h = window.__game.hud, data = { ...window.__run.hud2, biome: 'Red Canyon' };
    h.update(0, data, false); const waiting = h.seenAreas.has('Red Canyon');
    h.update(0, data, true); const entry = { text: h.q.area.textContent, opacity: h.q.area.style.opacity };
    h.update(4.1, data, true); const faded = h.q.area.style.opacity;
    h.update(0.1, data, true);
    return { waiting, entry, faded, repeated: h.q.area.style.opacity, removed: !document.querySelector('#hud .dist,#hud .time,#hud .prog') };
  });
  assert.equal(hud.waiting, false); assert.equal(hud.entry.text, 'Red Canyon'); assert.equal(hud.entry.opacity, '1');
  assert.equal(hud.faded, '0'); assert.equal(hud.repeated, '0'); assert.equal(hud.removed, true);
  check('area appears once after readiness, fades, and distance/time/progress labels are removed', hud);
  assert.deepEqual(report.errors, [], 'browser runtime errors');
  assert.deepEqual(report.network, [], 'game assets failed to load');
  report.passed = true;
} catch (e) {
  report.failure = e.stack || String(e);
  if (page && !page.isClosed()) {
    try { report.failureState = await state(); await page.screenshot({ path: `${output}/failure.png`, timeout: 5000 }); } catch { /* keep original failure */ }
  }
  throw e;
} finally {
  clearTimeout(cutoff);
  report.activeWallMs = activeStarted ? Date.now() - activeStarted : 0;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close();
}

// Screenshots of the warlords (minibosses) parked next to the truck, from a few angles.
//   node tools/test/elite_shots.mjs [index 0-4 | all] [outPrefix=shots/threat/elite] [--base=http://localhost:5180]
// Spawns the miniboss through the director, freezes it 16 m ahead-left of the (stopped) truck and orbits a camera override.
import { chromium } from 'playwright-core';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const which = args[0] ?? 'all', out = args[1] || 'shots/threat/elite', base = opt.base || 'http://localhost:5180';
const S = [9300, 19300, 29300, 40300, 49300];
const list = which === 'all' ? [0, 1, 2, 3, 4] : [+which];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'] });
for (const i of list) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${base}/index.html?solo&as=driver&seed=7&s=${S[i] - 400}`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
  await page.waitForFunction(() => window.__run.sim.state === 'run', null, { timeout: 60000 });
  const ok = await page.evaluate(async (i) => {
    const run = window.__run, sim = run.sim, P = run.player;
    window.__autodrive = { speed: 0.01 }; run.aiGunner = null;
    sim.director.enabled = false;
    for (const c of [...sim.cars.values()]) if (c.kind === 'enemy') sim.removeCar(c, 'test');
    const { MINIBOSSES } = await import('/src/data/boss.js');
    await new Promise((r) => setTimeout(r, 1500));
    sim.director.minibossDone.add(i);
    sim.director.spawnElite(sim, i, MINIBOSSES[i], 0.5);
    const E = sim.director.activeElite; if (!E) return 'no elite';
    for (const c of [...sim.cars.values()]) if (c.kind === 'enemy' && !c.elite) sim.removeCar(c, 'test');
    // park the warlord(s) ahead-left of the stopped truck
    E.cars.forEach((c, k) => {
      c.ai = null; c.veh.input.throttle = 0; c.veh.input.brake = 0; c.veh.input.handbrake = true; c.hp = c.maxHp = 1e6;
      const sm = sim.road.sample(P.s + 16 + k * 9), d = P.d + 3.6 - k * 7.2;
      c.veh.body.setTranslation({ x: sm.x + sm.nx * d, y: sim.road.surfaceY(sm, d) + 1.2, z: sm.z + sm.nz * d }, true);
      c.veh.body.setRotation({ x: 0, y: Math.sin(sm.th / 2), z: 0, w: Math.cos(sm.th / 2) }, true);
      c.veh.body.setLinvel({ x: 0, y: 0, z: 0 }, true); c.veh.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    return 'ok ' + E.name;
  }, i);
  console.log(i, ok);
  const views = [
    { name: 'front', offset: [-3.5, 2.4, 30], look: [3.6, 1.2, 16] },
    { name: 'side', offset: [11, 2.2, 16], look: [3.6, 1.3, 16] },
    { name: 'rear', offset: [1.5, 2.8, 4], look: [3.6, 1.4, 16] },
    { name: 'cockpit', offset: null },
  ];
  for (const v of views) {
    await page.evaluate((v) => { window.__camOverride = v.offset ? { offset: v.offset, look: v.look, fov: 55 } : null; }, v);
    await page.waitForTimeout(1200);
    console.log('  ', v.name, await page.evaluate(() => { const r = window.__run, P = r.player, E = r.sim.director.activeElite; return E ? E.cars.map((c) => `ds ${(c.s - P.s).toFixed(1)} dd ${(c.d - P.d).toFixed(1)} v ${c.veh.speed.toFixed(1)} exploded ${c.exploded}`).join(' | ') + ` P v ${P.veh.speed.toFixed(1)}` : 'gone'; }));
    await page.screenshot({ path: `${out}${i}_${v.name}.png` });
  }
  await page.close();
}
await browser.close();

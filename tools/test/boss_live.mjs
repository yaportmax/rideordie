// Live Leviathan fight in the real client (aimbot gunner + autodrive/AI driver) and a timeline of phases / parts / damage rate.
//   node tools/test/boss_live.mjs [secs=240] [s=58600] [seed=7] [--as=driver] [--shots=prefix] [--base=http://localhost:5180]
import { chromium } from 'playwright-core';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const [secs = 240, s0 = 58600, seed = 7] = args.map(Number);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${opt.base || 'http://localhost:5180'}/index.html?solo&as=${opt.as || 'gunner'}&s=${s0}&seed=${seed}&maxed=1${opt.noaim ? '&noaim' : ''}`);
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.evaluate(() => {
  document.getElementById('boot')?.remove(); window.__aimbot = !/[?&]noaim/.test(location.search) && !window.__noAimbot; if (/as=driver/.test(location.search)) window.__autodrive = { speed: 30 };
  const sim = window.__run.sim, emit = sim.emit.bind(sim); window.__bl = [];
  sim.emit = (e) => { if (/bossPhase|bossPart|bossDown|bossSpawn|playerDown|bossBeat/.test(e.t)) window.__bl.push(`${sim.boss ? sim.boss.t.toFixed(0) : '-'}s ${e.t} ${e.part || e.phase || e.why || e.kind || ''}`); return emit(e); };
});
const t0 = Date.now(); let shot = 0;
while (Date.now() - t0 < secs * 1000) {
  await page.waitForTimeout(10000);
  const r = await page.evaluate(() => { const run = window.__run, B = run.sim.boss, P = run.player; const L = window.__bl.splice(0); return { L, b: B ? { t: +B.t.toFixed(0), ph: B.phase, core: +B.coreHp01().toFixed(2), dead: B.dead } : null, hp: +(P.hp / P.maxHp).toFixed(2), st: run.sim.state, s: Math.round(P.s) }; });
  for (const l of r.L) console.log('   ' + l);
  console.log(`wall ${((Date.now() - t0) / 1000).toFixed(0)}s  s=${r.s} truck ${r.hp} ${r.st} boss ${JSON.stringify(r.b)}`);
  if (opt.shots) await page.screenshot({ path: `${opt.shots}_${shot++}.png` });
  if (r.st === 'over') break;
}
await browser.close();

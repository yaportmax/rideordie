// Front-end screenshot sweep (title, garage tabs, results, menus) in ONE browser session.
//   node tools/test/frontend_shots.mjs <outPrefix> [--base=http://localhost:5180] [--w=1920] [--h=1080] [--only=title,garage_truck,...] [--fps]
// Each step runs JS in the page (window.__app), waits, then saves <outPrefix><name>.png. --fps also prints a frame-time probe per step.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const prefix = pos[0] || 'shots/frontend/fe_';
const base = opt.base || 'http://localhost:5180';
const W = +(opt.w || 1920), H = +(opt.h || 1080);
const only = opt.only ? new Set(String(opt.only).split(',')) : null;
fs.mkdirSync(path.dirname(prefix), { recursive: true });

const sleep = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
const richProfile = `(() => { const p = window.__app.profile; p.cash = 18500; p.runs = 6; p.best = { distance: 14200, time: 610, kills: 57 };
  p.trucks = ['truck_t1', 'truck_t2']; p.truck = 'truck_t2'; p.upgrades.engine = 2; p.upgrades.armor = 1; p.upgrades.vest = 1;
  p.weapons = { pistol: { dmg: 1, mag: 0, rel: 0, hnd: 0 }, smg: { dmg: 1, mag: 1, rel: 0, hnd: 0 }, shotgun: { dmg: 0, mag: 0, rel: 0, hnd: 0 } }; p.loadout = ['smg', 'shotgun', 'pistol']; })();`;
const tab = (t) => `window.__app.ui._find('garage').switchTab('${t}');`;
const sel = (id) => `(() => { const g = window.__app.ui._find('garage'); g.select('${id}'); const n = g.q.rows.querySelector('[data-row="${id}"]'); if (n) window.__app.ui.nav.focus(n, { silent: true }); })();`;
const summary = (won) => `({ won: ${won}, cash: ${won ? 9400 : 2380}, breakdown: [{ label: 'RAIDERS WRECKED', amount: ${won ? 3600 : 1210} }, { label: 'DISTANCE 18.4 KM', amount: ${won ? 2300 : 820} }, { label: 'TIME SURVIVED', amount: ${won ? 1500 : 350} }${won ? ", { label: 'WARLORD BOUNTIES', amount: 1000 }, { label: 'THE LEVIATHAN', amount: 1000 }" : ''}],
  distance: ${won ? 60000 : 18400}, time: ${won ? 1510 : 742}, kills: ${won ? 212 : 64}, crashKills: ${won ? 38 : 11}, bestStreak: ${won ? 9 : 5}, shots: 1840, hits: 812, cause: '${won ? 'VICTORY' : 'TRUCK DESTROYED'}', biome: '${won ? 'THE DAM' : 'RED CANYON'}', minibosses: [] })`;

const steps = [
  ['title', `window.__app.title(); ${sleep(3200)}`],
  ['title_shot1', `(() => { const T = window.__app.game.garage.title; T.shot = 1; T.shotT = 2.5; })(); ${sleep(900)}`],
  ['title_shot2', `(() => { const T = window.__app.game.garage.title; T.shot = 2; T.shotT = 2.5; })(); ${sleep(900)}`],
  ['solo_pick', `document.querySelector('[data-act=solo]').click(); ${sleep(900)}`],
  ['garage_truck', `window.__app.ui.modalCancel?.(); ${richProfile} window.__app.soloRole = 'driver'; window.__app.mode = 'solo'; window.__app.garage(); ${sleep(3500)}`],
  ['garage_truck_t3', `${sel('truck_t3')} ${sleep(1500)}`],
  ['garage_upgrades', `${tab('upgrades')} ${sleep(1800)}`],
  ['garage_weapons', `${tab('weapons')} ${sleep(1800)}`],
  ['garage_weapons_rifle', `${sel('rifle')} ${sleep(1500)}`],
  ['garage_gunner', `${tab('gunner')} ${sleep(1800)}`],
  ['garage_paint', `${tab('paint')} ${sleep(1800)}`],
  ['results_lose', `window.__app.game.mode = 'menu'; window.__app.ui.showResults({ ...${summary(false)}, newBest: { distance: true, kills: true } }, window.__app.profile, { onContinue: () => window.__app.garage() }); ${sleep(6500)}`],
  ['results_win', `window.__app.ui.showResults({ ...${summary(true)}, newBest: { distance: true } }, window.__app.profile, { onContinue: () => window.__app.garage() }); ${sleep(6500)}`],
  ['settings', `window.__app.title(); ${sleep(600)} window.__app.ui.showSettings(); ${sleep(1200)}`],
  ['controls', `window.__app.title(); ${sleep(600)} window.__app.ui.showControls('driver'); ${sleep(1200)}`],
  ['join', `window.__app.title(); ${sleep(600)} document.querySelector('[data-act=join]').click(); ${sleep(1200)}`],
  ['lobby', `window.__app.title(); ${sleep(400)} window.__app.ui.showLobby({ code: 'KXQ7P', status: 'connected', latency: 38, isHost: true, canStart: false, players: [{ id: 'me', name: 'Host', device: 'kbm', seat: 'driver', ready: true, you: true, host: true }, { id: 'o', name: 'Player 2', device: 'pad', seat: 'gunner', ready: false, you: false, host: false }] }, {}); ${sleep(1400)}`],
  ['pause', `window.__app.ui.showPause({}); ${sleep(1200)}`],
];

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)); });
await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.waitForTimeout(1500);
const probe = `(async () => { const t = []; let last = performance.now(); await new Promise((res) => { const f = (now) => { t.push(now - last); last = now; if (t.length < 90) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  t.shift(); t.sort((a, b) => a - b); const avg = t.reduce((a, b) => a + b, 0) / t.length; return { avgMs: +avg.toFixed(2), p95: +t[Math.floor(t.length * 0.95)].toFixed(2), max: +t[t.length - 1].toFixed(2), calls: window.__game.renderer.info.render.calls, tris: window.__game.renderer.info.render.triangles }; })()`;
for (const [name, js] of steps) {
  if (only && !only.has(name)) { await page.evaluate(`(async () => { ${js} })()`).catch(() => {}); continue; }
  try { await page.evaluate(`(async () => { ${js} })()`); } catch (e) { console.log('[step error]', name, e.message.slice(0, 300)); }
  const out = `${prefix}${name}.png`;
  await page.screenshot({ path: out });
  let extra = '';
  if (opt.fps) extra = ' ' + JSON.stringify(await page.evaluate(probe));
  console.log('saved', out + extra);
}
await browser.close();

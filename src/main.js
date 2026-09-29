import { Game } from './game/game.js';
import { App } from './app.js';
import { DEFAULT_PROFILE, UPGRADES } from './data/upgrades.js';
import { Session } from './net/session.js';

const q = new URLSearchParams(location.search);
const game = new Game();
window.__game = game;
await game.boot();
game.loop();
// dev shortcuts skip the menus: no boot screen (index.html removes it too; this is the safety net)
if (q.has('solo') || q.get('devnet')) document.getElementById('boot')?.remove();

const devProfile = () => {
  const p = DEFAULT_PROFILE();
  if (q.get('truck')) { p.truck = q.get('truck'); p.trucks.push(p.truck); }
  if (q.has('maxed')) { p.truck = 'truck_t4'; p.trucks = ['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4']; for (const u of UPGRADES) p.upgrades[u.id] = u.costs.length; p.weapons = { lmg: { dmg: 3, mag: 3, rel: 3, hnd: 3 }, rpg: { dmg: 3, mag: 3, rel: 3, hnd: 3 }, sniper: { dmg: 3, mag: 3, rel: 3, hnd: 3 } }; p.loadout = ['lmg', 'rpg', 'sniper']; }
  if (q.get('weapons')) for (const id of q.get('weapons').split(',')) { p.weapons[id] = { dmg: 0, mag: 0, rel: 0, hnd: 0 }; if (!p.loadout.includes(id)) p.loadout.push(id); }
  return p;
};

if (q.has('solo')) {
  // dev shortcut: straight into a solo run
  const as = q.get('as'); // ?solo&as=driver (AI gunner) | as=gunner (AI driver)
  const run = await game.startRun({ role: as || 'solo', ai: as === 'driver' ? 'gunner' : as === 'gunner' ? 'driver' : null, seed: +(q.get('seed') || 7), profile: devProfile(), paint: 0x8f6a3d, startS: +(q.get('s') || 40) });
  window.__run = run; window.__ready = true;
} else if (q.get('devnet')) {
  // dev shortcut for automated 2-browser tests: ?devnet=host&role=driver   /   ?devnet=join&code=ABCDE
  const session = new Session(); window.__session = session;
  const profile = devProfile();
  const startAs = async (cfg) => { const run = await game.startRun({ ...cfg, net: session, paint: 0x8f6a3d, startS: +(q.get('s') || 40) }); window.__run = run; window.__ready = true; };
  session.on({ run: (m) => game.run && game.run.onNet(m), fast: (b) => game.run && game.run.onFast(b), start: (cfg) => startAs(cfg) });
  if (q.get('devnet') === 'host') {
    const code = await session.host(profile); window.__code = code;
    const role = q.get('role') || 'driver';
    session.tp.onOpen = () => {
      session.connected = true; session.tp.send({ t: 'hello', name: 'Host' });
      session.me.role = role; session.me.ready = true;
      setTimeout(() => { session.other = { name: 'Guest', role: role === 'driver' ? 'gunner' : 'driver', ready: true }; startAs(session.startRun({ seed: +(q.get('seed') || 7) })); }, 800);
    };
  } else await session.join(q.get('code'), profile);
} else {
  const app = new App(game);
  app.title();
  window.__ready = true;
}

import { Game } from './game/game.js';
import { App } from './app.js';
import { DEFAULT_PROFILE, UPGRADES } from './data/upgrades.js';
import { Session } from './net/session.js';
import { Transport } from './net/transport.js';
import { loadSettings } from './ui/settings_store.js';

async function boot() {
const q = new URLSearchParams(location.search);
const game = new Game({ quality: loadSettings().quality });
window.__game = game;
window.render_game_to_text = () => {
  const run = game.run, gunner = run?.gunner;
  return JSON.stringify({ mode: game.mode, paused: game.paused, role: run?.role, distanceMetres: run?.playerS,
    coordinates: 'world metres; y up; truck follows road distance', player: run?.states.get(1)?.pos,
    weapon: gunner?.weapon?.id, magazine: gunner?.magNow, reloading: gunner?.reloading, ads: gunner?.ads,
    vehicles: run?.states.size, finished: run?.finished, performance: game.perf });
};
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
  // A local signalling server is supported by the test shortcut; normal rooms still use PeerJS defaults.
  const peerOptions = q.get('peerHost') ? { host: q.get('peerHost'), port: +(q.get('peerPort') || 9000), path: '/peerjs', secure: false, config: { iceServers: [] } } : {};
  const session = new Session(new Transport({ peerOptions })); window.__session = session;
  const profile = devProfile();
  const pending = []; let latestFast = null;
  const startAs = async (cfg) => {
    if (!cfg) return;
    const run = await game.startRun({ ...cfg, net: session, paint: 0x8f6a3d, startS: +(q.get('s') || 40) });
    if (!run || game.run !== run || session.activeRunId !== cfg.runId) return;
    for (const m of pending.splice(0)) run.onNet(m);
    if (latestFast) { run.onFast(latestFast); latestFast = null; }
    session.sendJSON({ t: 'runReady' }); window.__run = run; window.__ready = true;
  };
  session.on({ run: (m) => { if (game.run) game.run.onNet(m); else pending.push(m); }, fast: (b) => { if (game.run) game.run.onFast(b); else latestFast = b; }, start: (cfg) => startAs(cfg) });
  if (q.get('devnet') === 'host') {
    const role = q.get('role') || 'driver';
    session.me.name = 'Host';
    let started = false;
    const startWhenReady = () => {
      if (started || !session.connected || !session.peerWallet || !session.other) return;
      session.me.role = role; session.me.ready = true;
      session.other = { ...session.other, role: role === 'driver' ? 'gunner' : 'driver', ready: true };
      // The real Session handshake validates protocol and wallet before it can
      // start. No fixed timeout can safely assume a WAN hello has arrived.
      const cfg = session.startRun({ seed: +(q.get('seed') || 7) });
      if (!cfg) return;
      started = true; startAs(cfg);
    };
    session.on({ lobby: startWhenReady });
    const opened = session.tp.onOpen;
    session.tp.onOpen = () => {
      opened(); startWhenReady();
    };
    const code = await session.host(profile); window.__code = code;
  } else await session.join(q.get('code'), profile);
} else {
  const app = new App(game);
  app.title();
  window.__ready = true;
}
}

boot().catch((e) => {
  console.error('Game startup failed', e);
  const panel = document.getElementById('boot') || document.body.appendChild(document.createElement('div'));
  panel.id = 'boot'; panel.classList.remove('done'); panel.setAttribute('role', 'alert'); panel.replaceChildren();
  const title = document.createElement('h1'); title.textContent = 'COULD NOT START THE GAME';
  const detail = document.createElement('p'); detail.textContent = 'Check your connection and use a browser with hardware acceleration enabled.'; detail.style.color = '#d8d2c4';
  const retry = document.createElement('button'); retry.textContent = 'TRY AGAIN'; retry.style.cssText = 'padding:16px 28px;background:#ffc21a;color:#14110f;border:0;font:700 16px sans-serif;cursor:pointer'; retry.onclick = () => location.reload();
  title.style.color = '#ffc21a'; panel.append(title, detail, retry); retry.focus();
});

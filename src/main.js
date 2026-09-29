import { Game } from './game/game.js';
import { DEFAULT_PROFILE } from './data/upgrades.js';
import { Session } from './net/session.js';

const q = new URLSearchParams(location.search);
const game = new Game();
window.__game = game;
await game.boot();
const profile = DEFAULT_PROFILE();
if (q.get('truck')) { profile.truck = q.get('truck'); profile.trucks.push(profile.truck); }
if (q.get('weapons')) { for (const id of q.get('weapons').split(',')) { profile.weapons[id] = { dmg: 0, mag: 0, rel: 0, hnd: 0 }; if (!profile.loadout.includes(id)) profile.loadout.push(id); } }
const seed = +(q.get('seed') || 7);
const netMode = q.get('net');

if (!netMode) {
  // dev: solo run straight away
  const run = await game.startRun({ role: 'solo', seed, profile, paint: 0x8f6a3d, startS: +(q.get('s') || 40) });
  window.__run = run;
  game.loop();
  window.__ready = true;
} else {
  // dev network path (the real lobby UI replaces this): ?net=host&role=driver   /   ?net=join&code=ABCDE
  const session = new Session(); window.__session = session;
  const startAs = async (cfg) => { const run = await game.startRun({ ...cfg, net: session, paint: 0x8f6a3d, startS: +(q.get('s') || 40) }); window.__run = run; window.__ready = true; };
  session.on({
    run: (m) => game.run && game.run.onNet(m), fast: (b) => game.run && game.run.onFast(b),
    disconnect: () => console.log('peer disconnected'),
    start: (cfg) => startAs(cfg),
  });
  game.loop();
  if (netMode === 'host') {
    const code = await session.host(profile); window.__code = code; console.log('ROOM', code);
    const role = q.get('role') || 'driver';
    session.tp.onOpen = () => {
      session.connected = true; session.tp.send({ t: 'hello', name: 'Host', campaign: profile.campaignId });
      session.me.role = role; session.me.ready = true;
      setTimeout(() => { if (session.other) { session.other.role = role === 'driver' ? 'gunner' : 'driver'; session.other.ready = true; } const cfg = session.startRun({ seed }); startAs(cfg); }, 800);
    };
  } else {
    await session.join(q.get('code'), profile); console.log('JOINED');
  }
}

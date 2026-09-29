import { Game } from './game/game.js';
import { DEFAULT_PROFILE } from './data/upgrades.js';

const q = new URLSearchParams(location.search);
const game = new Game();
window.__game = game;
await game.boot();
const profile = DEFAULT_PROFILE();
if (q.get('truck')) { profile.truck = q.get('truck'); profile.trucks.push(profile.truck); }
if (q.get('weapons')) { for (const id of q.get('weapons').split(',')) { profile.weapons[id] = { dmg: 0, mag: 0, rel: 0, hnd: 0 }; if (!profile.loadout.includes(id)) profile.loadout.push(id); } }
const seed = +(q.get('seed') || 7);
const run = await game.startRun({ role: 'solo', seed, profile, paint: 0x8f6a3d, startS: +(q.get('s') || 40) });
window.__run = run;
game.loop();
window.__ready = true;

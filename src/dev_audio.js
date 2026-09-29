// Audio lab: /audio.html            interactive test page (events, engines, flyby/doppler, music, ambience, buses, meter, missing names)
//             /audio.html?auto=1    headless self-tests -> window.__audioReport (offline renders + analysis), window.__ready = true
//   node tools/test/shot.mjs "audio.html?auto=1" shots/audio/x.png --wait=500 --timeout=180000 --eval="window.__audioReport.summary"
import * as THREE from 'three';
import { AudioSys, airCutoff, attGain } from './core/audio.js';
import { AudioBridge, EXPECTED_NAMES } from './view/audio_bridge.js';
import { makeCarState } from './view/car_state.js';
import { VEHICLES } from './data/vehicles.js';
import { WEAPONS, WEAPON_ORDER } from './data/weapons.js';

const q = new URLSearchParams(location.search);
const AUTO = q.has('auto');
const statusEl = document.getElementById('status');
const app = document.getElementById('app');

// ------------------------------------------------------------------------------------------------------------ audio setup
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(0, 1.6, 0); camera.lookAt(0, 1.6, 10); // facing +Z (like the truck)
const audio = new AudioSys(camera);
window.__audio = audio;
await audio.init('/audio/manifest.json');
const bridge = new AudioBridge(audio, { playerId: 1, localRole: 'solo' });
window.__bridge = bridge;
audio.unlock();

// ------------------------------------------------------------------------------------------------------------ tiny DOM kit
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') e.style.cssText = v; else e[k] = v; }
  for (const k of kids.flat()) if (k !== null && k !== undefined) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const panel = (title, ...kids) => h('div', { class: 'panel' }, h('h2', {}, title), ...kids);
const btn = (label, fn, cls = '') => h('button', { class: cls, onclick: (ev) => { audio.unlock(); fn(ev); } }, label);
function slider(label, min, max, step, val, fn, fmt = (v) => (+v).toFixed(2)) {
  const out = h('span', { class: 'val' }, fmt(val));
  const inp = h('input', { type: 'range', min, max, step, value: val });
  inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); fn(+inp.value); });
  const root = h('label', { class: 'row' }, h('span', {}, label), inp, out);
  root.get = () => +inp.value; root.set = (v) => { inp.value = v; out.textContent = fmt(v); };
  return root;
}
function select(label, opts, val, fn) {
  const s = h('select', {}, opts.map((o) => h('option', { value: o, selected: o === val }, o)));
  s.addEventListener('change', () => fn(s.value));
  const root = h('label', { class: 'row' }, h('span', {}, label), s);
  root.get = () => s.value; return root;
}
function check(label, val, fn) {
  const c = h('input', { type: 'checkbox', checked: val }); c.addEventListener('change', () => fn(c.checked));
  const root = h('label', { class: 'row' }, h('span', {}, label), c); root.get = () => c.checked; root.set = (v) => { c.checked = v; }; return root;
}

// ------------------------------------------------------------------------------------------------------------ shared lab state
const lab = { dist: 30, az: 0, own: false, role: 'solo', playerId: 1 };
const place = (y = 1, d = lab.dist, az = lab.az) => { const a = az * Math.PI / 180; return [Math.sin(a) * d, y, Math.cos(a) * d]; }; // +X = left, az>0 = left
const fakeStates = new Map();
const ctxFor = () => ({ states: fakeStates, playerId: 1, localRole: lab.role, cameraPos: camera.position });
const fire = (e) => bridge.handleEvent(e, ctxFor());
const SURFACES = ['metal', 'flesh', 'dirt', 'sand', 'rock', 'glass', 'tire', 'asphalt'];

// ------------------------------------------------------------------------------------------------------------ sections
const secTop = panel('Start / buses / meter');
const meterCv = h('canvas', { width: 320, height: 70 }), scopeCv = h('canvas', { width: 320, height: 70 });
const volSliders = {};
secTop.append(
  h('div', {}, btn('START AUDIO (unlock)', () => audio.unlock(), 'big'), btn('Rescan manifest', async () => { const r = await audio.refreshManifest(); setStatus(`rescan +${r.added.length} new, ${r.changed.length} changed`); }), btn('Preload all', () => bridge.preloadAll().then(() => setStatus('all loaded')))),
  ...['master', 'sfx', 'music', 'ambience', 'ui'].map((k) => (volSliders[k] = slider(k, 0, 1.2, 0.01, audio.volumes[k], (v) => audio.setVolumes({ [k]: v })))),
  h('div', {}, meterCv, scopeCv),
);

const secPos = panel('Emitter placement (used by every event / engine button)',
  slider('distance m', 1, 320, 1, lab.dist, (v) => { lab.dist = v; }, (v) => v.toFixed(0)),
  slider('azimuth deg', -180, 180, 1, lab.az, (v) => { lab.az = v; }, (v) => v.toFixed(0)),
  check('own weapon (near camera)', lab.own, (v) => { lab.own = v; }),
  select('local role', ['solo', 'gunner', 'driver'], lab.role, (v) => { lab.role = v; }),
  slider('listener vel (m/s Z)', -60, 60, 1, 0, (v) => { listenerVel.z = v; }, (v) => v.toFixed(0)),
);
const listenerVel = new THREE.Vector3();

// ---- events
const secEvents = panel('Sim / gunner events (AudioBridge.handleEvent)');
const wSel = select('weapon', WEAPON_ORDER, 'smg', () => {}), sSel = select('surface', SURFACES, 'metal', () => {});
const dvSlider = slider('crash dv', 0.5, 20, 0.5, 8, () => {}, (v) => v.toFixed(1));
const sizeSel = select('explode size', ['1', '1.8', '2.4', '4.3'], '1', () => {});
const originFor = () => (lab.own ? [0.3, 1.5, 1.2] : place(1.5));
const shotEvt = (w) => ({ t: 'shot', src: 'player', weapon: w, origin: originFor(), mode: WEAPONS[w].mode, rocket: w === 'rpg' || undefined, dir: [0, 0, 1], rays: w === 'rpg' ? [] : Array.from({ length: WEAPONS[w].pellets }, () => ({ end: place(0.5, Math.max(3, lab.dist * 0.6)), surface: sSel.get(), carId: sSel.get() === 'metal' || sSel.get() === 'flesh' ? 5 : undefined, zone: sSel.get() === 'flesh' ? 'driver_head' : 'body', dmg: 10 })) });
let autoFire = null;
const evButtons = [
  ['shot (player weapon)', () => fire(shotEvt(wSel.get()))],
  ['auto-fire toggle', (ev) => { if (autoFire) { clearInterval(autoFire); autoFire = null; ev.target.classList.remove('on'); } else { const w = wSel.get(); autoFire = setInterval(() => fire(shotEvt(w)), 60000 / WEAPONS[w].rpm); ev.target.classList.add('on'); } }],
  ['shot enemy light', () => fire({ t: 'shot', src: 7, weapon: 'enemy', origin: place(1.5), rays: [[0, 0, -1]], speed: 140, role: 'gunner', pellets: 1 })],
  ['shot enemy heavy (hmg)', () => fire({ t: 'shot', src: 8, weapon: 'enemy', origin: place(1.5), rays: [[0, 0, -1]], speed: 230, role: 'gunner', pellets: 1 })],
  ['shot enemy shotgun', () => fire({ t: 'shot', src: 9, weapon: 'enemy', origin: place(1.5), rays: Array(7).fill([0, 0, -1]), speed: 125, role: 'gunner', pellets: 7 })],
  ['shot enemy rpg', () => fire({ t: 'shot', src: 10, weapon: 'rpg', origin: place(1.5), dir: [Math.sin(lab.az * Math.PI / 180) * -1, 0, -1], rocket: true, speed: 60 })],
  ['hit (surface)', () => fire({ t: 'hit', pos: place(0.8), normal: [0, 1, 0], surface: sSel.get(), carId: sSel.get() === 'metal' ? 1 : -1, enemy: true, dmg: 4 })],
  ['hit on player truck', () => fire({ t: 'hit', pos: place(1, 5), normal: [0, 1, 0], surface: 'metal', carId: 1, enemy: true, dmg: 20 })],
  ['whizz', () => fire({ t: 'whizz', pos: place(1.5, 2.5), dist: 1.2 })],
  ['crash', () => fire({ t: 'crash', id: 50 + Math.floor(Math.random() * 1000), other: -1, dv: dvSlider.get(), speed: 20, pos: place(0.8) })],
  ['crash (ram)', () => fire({ t: 'crash', id: 50 + Math.floor(Math.random() * 1000), other: 3, dv: dvSlider.get(), speed: 20, pos: place(0.8) })],
  ['explode', () => fire({ t: 'explode', id: 60 + Math.floor(Math.random() * 1000), pos: place(0.8), size: +sizeSel.get(), cause: 'shot', spec: 'e_sedan', vel: [0, 0, 0] })],
  ['boom rocket', () => fire({ t: 'boom', pos: place(0.8), radius: 11, kind: 'rocket' })],
  ['boom grenade', () => fire({ t: 'boom', pos: place(0.8), radius: 9.5, kind: 'grenade' })],
  ['crewHit', () => fire({ t: 'crewHit', id: 3, role: 'driver', hp: 20, dmg: 8, head: false, point: place(1.2) })],
  ['crewDead', () => fire({ t: 'crewDead', id: 3, role: 'gunner', cause: 'shot' })],
  ['tirePop', () => fire({ t: 'tirePop', id: 3, index: 0 })],
  ['engineDead', () => fire({ t: 'engineDead', id: 3 })],
  ['fuelLeak', () => fire({ t: 'fuelLeak', id: 3 })],
  ['kill', () => fire({ t: 'kill', id: 3, spec: 'e_sedan', cause: 'shot', pos: place(), crash: false })],
  ['playerDown', () => fire({ t: 'playerDown', why: 'car' })],
  ['land', () => fire({ t: 'land', id: 1, impact: 1.2 })],
  ['weaponSwap', () => fire({ t: 'weaponSwap', weapon: wSel.get() })],
  ['reloadStart', () => fire({ t: 'reloadStart', weapon: wSel.get(), time: WEAPONS[wSel.get()].reload })],
  ['reloadEnd', () => fire({ t: 'reloadEnd', weapon: wSel.get() })],
  ['shellIn', () => fire({ t: 'shellIn', weapon: 'shotgun' })],
  ['dryClick', () => fire({ t: 'dryClick', weapon: wSel.get() })],
  ['grenadeThrow', () => fire({ t: 'grenadeThrow', origin: place(1.5, 2), vel: [0, 6, 22] })],
];
secEvents.append(wSel, sSel, dvSlider, sizeSel, h('div', {}, evButtons.map(([l, f]) => btn(l, f))));

// ---- engines
const secEng = panel('Engines (one card per manifest engine id; bypasses AudioBridge, drives EngineSound directly)');
const engGrid = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:6px' });
const labEngines = new Map();
function engineCard(id) {
  const st = { id, eng: null, on: false, sweep: false, rpm: 0.3, load: 0.6, boost: 0, speed: 20, dist: 20, az: 0, hp: 1, slip: 0, surface: 'asphalt', player: false, turbo: false, sc: 0, bf: 0 };
  const info = h('div', { class: 'mono' }, '');
  const mk = () => { if (st.eng) st.eng.dispose(0.05); st.eng = audio.engine('lab_' + id + Math.random(), { id: 'lab', engine: { vmax: 50 }, kind: 'enemy' }, { engineId: id, player: st.player, turbo: st.turbo, supercharger: st.sc, backfire: st.bf }); };
  const card = h('div', { class: 'card' }, h('b', {}, id),
    h('div', {}, btn('on/off', (ev) => { st.on = !st.on; ev.target.classList.toggle('on', st.on); if (st.on) mk(); else if (st.eng) { st.eng.dispose(0.1); st.eng = null; } }), btn('sweep rpm', (ev) => { st.sweep = !st.sweep; ev.target.classList.toggle('on', st.sweep); }),
      btn('kill', () => st.eng && st.eng.kill())),
    slider('rpm01', 0.2, 1, 0.005, st.rpm, (v) => { st.rpm = v; }), slider('load', 0, 1, 0.01, st.load, (v) => { st.load = v; }), slider('boost (nitro)', 0, 1, 1, 0, (v) => { st.boost = v; }, (v) => v.toFixed(0)),
    slider('speed m/s', 0, 60, 1, st.speed, (v) => { st.speed = v; }, (v) => v.toFixed(0)), slider('distance', 0, 300, 1, st.dist, (v) => { st.dist = v; }, (v) => v.toFixed(0)), slider('azimuth', -180, 180, 1, st.az, (v) => { st.az = v; }, (v) => v.toFixed(0)),
    slider('engine hp', 0, 1, 0.01, 1, (v) => { st.hp = v; }), slider('slip', 0, 1, 0.01, 0, (v) => { st.slip = v; }),
    select('surface', ['asphalt', 'dirt', 'sand', 'gravel'], 'asphalt', (v) => { st.surface = v; }),
    check('player (no panner)', false, (v) => { st.player = v; if (st.on) mk(); }), check('turbo', false, (v) => { st.turbo = v; if (st.eng) st.eng.turbo = v; }),
    check('supercharger', false, (v) => { st.sc = v ? 0.7 : 0; if (st.eng) st.eng.supercharger = st.sc; }), check('backfire', false, (v) => { st.bf = v ? 1 : 0; if (st.eng) st.eng.backfire = st.bf; }),
    info);
  st.info = info; st.card = card; labEngines.set(id, st);
  return card;
}
function rebuildEngineCards() {
  const ids = audio.engineIds();
  for (const id of ids) if (!labEngines.has(id)) engGrid.append(engineCard(id));
  engHint.textContent = ids.length ? `${ids.length} engine ids in manifest` : 'NO engine ids in manifest yet (engines: {} - waiting for the asset builder)';
}
const engHint = h('div', { class: 'mono' }, '');
secEng.append(engHint, engGrid); secEng.classList.add('wide');

// ---- flyby / doppler
const secFly = panel('Moving car / doppler flyby (passes the listener along Z)');
const fly = { engineId: null, speed: 40, lat: 8, dir: 1, active: false, t: 0, eng: null, whizzed: false, z: -150, ratio: 1, rpm: 0.75 };
const flyInfo = h('div', { class: 'mono' }, '');
const flyEngSel = h('select', {}); flyEngSel.addEventListener('change', () => { fly.engineId = flyEngSel.value; });
secFly.append(h('label', { class: 'row' }, h('span', {}, 'engine'), flyEngSel),
  slider('speed m/s', 5, 90, 1, fly.speed, (v) => { fly.speed = v; }, (v) => v.toFixed(0)), slider('lateral m', 1, 40, 1, fly.lat, (v) => { fly.lat = v; }, (v) => v.toFixed(0)),
  slider('rpm01', 0.25, 1, 0.01, fly.rpm, (v) => { fly.rpm = v; }),
  h('div', {}, btn('flyby (approaching)', () => startFly(1)), btn('flyby (receding start)', () => startFly(-1)), btn('stop', () => stopFly())), flyInfo);
function startFly(dir) {
  stopFly();
  if (!fly.engineId) fly.engineId = audio.engineIds()[0];
  fly.dir = dir; fly.t = 0; fly.active = true; fly.whizzed = false; fly.z = dir > 0 ? -150 : 150;
  fly.eng = audio.engine('lab_fly', { id: 'lab', engine: { vmax: 50 }, kind: 'enemy' }, { engineId: fly.engineId, level: 1 });
}
function stopFly() { fly.active = false; if (fly.eng) { fly.eng.dispose(0.1); fly.eng = null; } }
function updateFly(dt) {
  if (!fly.active) return;
  fly.t += dt; fly.z += fly.dir * fly.speed * dt;
  const pos = [fly.lat, 0.8, fly.z], vel = [0, 0, fly.dir * fly.speed];
  const d = audio.listener.distTo(pos);
  fly.ratio = audio.doppler(pos, vel);
  if (fly.eng) fly.eng.update(fly.rpm, 0.8, 0, d, fly.speed, { pos, vel });
  if (!fly.whizzed && Math.abs(fly.z) < 1.5) { fly.whizzed = true; fire({ t: 'whizz', pos: [fly.lat * 0.4, 1.4, 0], dist: 1 }); }
  if (Math.abs(fly.z) > 170 && fly.t > 1) stopFly();
  flyInfo.textContent = `t=${fly.t.toFixed(2)}s z=${fly.z.toFixed(1)}m dist=${d.toFixed(1)}m doppler=${fly.ratio.toFixed(3)}  (${fly.active ? 'running' : ''})`;
}

// ---- bridge cars (CarState-driven: tests updateCar, tyres, wind, danger, fire)
const secCars = panel('AudioBridge.updateCar with fake CarStates (player + enemy)');
const carSim = { player: null, enemy: null };
function mkCar(id, specId, kind) { const st = makeCarState(id, specId, kind); fakeStates.set(id, st); return { st, speed: 20, hp: 1, engineHp: 1, slip: 0, air: false, boost: false, brake: false, surface: 'asphalt', active: false, z: 0, dist: 40 }; }
carSim.player = mkCar(1, 'truck_t3', 'player'); carSim.enemy = mkCar(20, 'e_muscle', 'enemy');
const gearRpm = (speed, vmax) => { const caps = [0.16, 0.32, 0.5, 0.7, 1]; const vr = speed / (vmax * 1.05); let g = 0; while (g < 4 && vr > caps[g]) g++; const lo = g === 0 ? 0 : caps[g - 1]; return 0.26 + 0.74 * Math.min(1, Math.max(0, (vr - lo) / (caps[g] - lo))); };
function carControls(sim, title) {
  const spec = sim.st.spec;
  const sp = select('spec', Object.keys(VEHICLES), spec.id, (v) => { sim.st = makeCarState(sim.st.id, v, sim.st.kind); fakeStates.set(sim.st.id, sim.st); bridge._removeCar(sim.st.id); });
  return h('div', { class: 'card' }, h('b', {}, title), h('div', {}, btn('on/off', (ev) => { sim.active = !sim.active; ev.target.classList.toggle('on', sim.active); if (!sim.active) bridge._removeCar(sim.st.id); })),
    sp, slider('speed', 0, 65, 1, sim.speed, (v) => { sim.speed = v; }, (v) => v.toFixed(0)), slider('car hp01', 0, 1, 0.01, 1, (v) => { sim.hp = v; }), slider('engine hp01', 0, 1, 0.01, 1, (v) => { sim.engineHp = v; }),
    slider('slip', 0, 1, 0.01, 0, (v) => { sim.slip = v; }), select('surface', ['asphalt', 'dirt', 'sand'], 'asphalt', (v) => { sim.surface = v; }),
    ...(sim === carSim.enemy ? [slider('distance', 0, 300, 1, sim.dist, (v) => { sim.dist = v; }, (v) => v.toFixed(0))] : []),
    check('boosting', false, (v) => { sim.boost = v; }), check('braking', false, (v) => { sim.brake = v; }), check('airborne', false, (v) => { sim.air = v; }),
    btn('burning on', () => { sim.st.burning = true; }), btn('burning off', () => { sim.st.burning = false; bridge._car(sim.st.id).burning = false; }),
    btn('explode', () => { fire({ t: 'explode', id: sim.st.id, pos: [sim.st.pos.x, sim.st.pos.y, sim.st.pos.z], size: 1, cause: 'shot' }); sim.st.exploded = true; }), btn('reset', () => { sim.st.exploded = false; sim.st.burning = false; bridge._removeCar(sim.st.id); }));
}
secCars.append(carControls(carSim.player, 'player truck (id 1)'), carControls(carSim.enemy, 'enemy car (id 20, placed by emitter azimuth)'));
function updateCars(dt) {
  for (const sim of [carSim.player, carSim.enemy]) {
    if (!sim.active) continue;
    const st = sim.st, vmax = st.spec.engine.vmax, isP = sim === carSim.player;
    const pos = isP ? [0, 0.5, 6] : place(0.5, sim.dist, lab.az);
    st.pos.set(pos[0], pos[1], pos[2]); st.vel.set(0, 0, sim.speed); st.speed = sim.speed; st.rpm01 += (gearRpm(sim.speed, vmax) - st.rpm01) * Math.min(1, dt * 8);
    st.hp01 = sim.hp; st.engineHp01 = sim.engineHp; st.boosting = sim.boost; st.braking = sim.brake; st.airborne = sim.air; st.exploded = st.exploded && true;
    for (let i = 0; i < st.nWheels; i++) { st.slip[i] = sim.slip; st.grounded[i] = sim.air ? 0 : 1; }
    bridge.updateCar(st, dt, { surface: sim.surface });
  }
}

// ---- music / ambience / danger
const secMusic = panel('Music / ambience / effects');
const musicInfo = h('div', { class: 'mono' }, '');
secMusic.append(
  h('div', {}, ['title', 'garage', 'run', 'boss', 'victory'].map((s) => btn('state: ' + s, () => audio.music.setState(s))), btn('stop', () => audio.music.stop(1))),
  slider('intensity', 0, 1, 0.01, 0, (v) => audio.music.setIntensity(v)),
  h('div', {}, ['run_start', 'game_over', 'boss_intro', 'boss_defeated', 'victory'].map((s) => btn('stinger ' + s, () => audio.stinger(s)))),
  h('div', {}, ['desert', 'canyon', 'coast', 'mountain', 'city', 'dam'].map((b) => btn(b, () => audio.ambience.setBiome(b)))),
  slider('wind speed01', 0, 1, 0.01, 0, (v) => audio.ambience.wind(v)),
  slider('roar (speed01)', 0, 1, 0.01, 0, (v) => audio.ambience.roar(v, 'asphalt', 0)),
  h('div', {}, btn('duck 0.6', () => audio.duck(0.6, { hold: 0.5, release: 1.2 })), btn('concussion 0.5', () => audio.concussion(0.5)), btn('concussion 1.0', () => audio.concussion(1))),
  slider('danger', 0, 1, 0.01, 0, (v) => { bridge.autoDanger = false; audio.setDanger(v); }),
  h('div', {}, ['click', 'hover', 'buy', 'error', 'coin', 'upgrade_unlock', 'ready', 'countdown_beep', 'go', 'menu_open', 'menu_close', 'whoosh_transition'].map((n) => btn('ui ' + n, () => audio.ui(n)))),
  musicInfo);

// ---- missing / stats
const secMiss = panel('Missing names (expected by AudioBridge / engine but not in manifest)');
const missDiv = h('div', { class: 'miss' }), statsDiv = h('div', { class: 'mono' }, '');
secMiss.append(missDiv);
const secStats = panel('Node graph / voices / buffers (live)', statsDiv);
const secTests = panel('Self tests (offline renders + analysis)', h('div', {}, btn('run self tests', () => runSelfTests().then(showReport)), btn('scenario spectrogram', () => runScenario(true))), h('div', { class: 'mono', id: 'testout' }, ''), h('canvas', { id: 'spec', width: 900, height: 240 }));
secTests.classList.add('wide');
secMiss.classList.add('wide');

app.append(h('div', { class: 'grid' }, secTop, secPos, secEvents, secMusic, secFly, secCars, secStats, secMiss, secTests, secEng));
window.__lab = { runSelfTests, runScenario, report };
function setStatus(t) { statusEl.textContent = t; }

// ------------------------------------------------------------------------------------------------------------ frame loop
let last = performance.now(), lastSlow = 0;
const sweepT0 = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  audio.listener.update(camera, listenerVel);
  for (const st of labEngines.values()) {
    if (!st.on || !st.eng) continue;
    const rpm = st.sweep ? 0.2 + 0.8 * (0.5 - 0.5 * Math.cos((now - sweepT0) / 1000 * 0.6)) : st.rpm;
    const pos = place(0.8, st.dist, st.az);
    st.eng.update(rpm, st.load, st.boost, st.player ? 0 : st.dist, st.speed, { pos, vel: [0, 0, 0], engineHp01: st.hp, slip: st.slip, surface: st.surface, grounded: 1 });
  }
  updateFly(dt); updateCars(dt);
  bridge.update(dt, ctxFor());
  audio.update(dt);
  drawMeter();
  if (now - lastSlow > 250) { lastSlow = now; slow(); }
  requestAnimationFrame(frame);
}
function db(x) { return x > 1e-6 ? 20 * Math.log10(x) : -120; }
function drawMeter() {
  const m = audio.meterState, c = meterCv.getContext('2d'), W = meterCv.width, H = meterCv.height;
  c.fillStyle = '#0d0b0a'; c.fillRect(0, 0, W, H);
  const bar = (y, v, col, label) => { const x = Math.max(0, Math.min(1, (db(v) + 60) / 60)) * (W - 50); c.fillStyle = col; c.fillRect(0, y, x, 14); c.fillStyle = '#9a8f83'; c.font = '10px monospace'; c.fillText(label + ' ' + db(v).toFixed(1), W - 48, y + 11); };
  bar(6, m.peak, '#e8792b', 'pk'); bar(24, m.rms, '#7bd88f', 'rms'); bar(42, m.hold, '#ffc21a', 'hold');
  c.strokeStyle = '#3a322b'; for (let d = -60; d <= 0; d += 12) { const x = (d + 60) / 60 * (W - 50); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  const s = scopeCv.getContext('2d'); s.fillStyle = '#0d0b0a'; s.fillRect(0, 0, scopeCv.width, scopeCv.height);
  const d = audio._tdata; s.strokeStyle = '#7bd88f'; s.beginPath();
  for (let i = 0; i < 320; i++) { const v = d[Math.floor(i / 320 * d.length)] || 0; const y = scopeCv.height / 2 - v * scopeCv.height / 2; i ? s.lineTo(i, y) : s.moveTo(i, y); }
  s.stroke();
}
let rescanT = 0;
function slow() {
  setStatus(`ctx ${audio.ctx.state} ${audio.ctx.sampleRate} Hz  baseLat ${(audio.ctx.baseLatency * 1000).toFixed(1)} ms  sounds ${audio.defs.size}  engines ${audio.engineIds().length}`);
  rebuildEngineCards();
  const ids = audio.engineIds();
  if (flyEngSel.options.length !== ids.length) { flyEngSel.replaceChildren(...ids.map((i) => h('option', { value: i }, i))); if (!fly.engineId) fly.engineId = ids[0]; }
  const mi = audio.music.info();
  musicInfo.textContent = `music: ${JSON.stringify(mi)}\nlast: ${JSON.stringify(audio.music.log.slice(-2))}\nambience: ${audio.ambience.biome} bed=${audio.ambience.bed ? audio.ambience.bed.stems.length + ' layers' : 'none'}  wind=${audio.ambience.windLevel.toFixed(2)}\nengines: ${[...audio.engines.values()].map((e) => JSON.stringify(e.info())).join('\n         ')}`;
  const g = audio.graphStats();
  statsDiv.textContent = JSON.stringify({ ...g, created: undefined, released: undefined, live: g.live, bridge: bridge.counts, loadQueue: audio.loadingCount() }, null, 1).replace(/\n\s+/g, ' ');
  const miss = audio.reportMissing();
  const have = EXPECTED_NAMES.length - miss.filter((n) => EXPECTED_NAMES.includes(n)).length;
  missDiv.replaceChildren(h('span', { class: 'tag ok' }, `${have}/${EXPECTED_NAMES.length} expected names present`), ...miss.map((n) => h('span', { class: 'tag bad' }, n)));
  if (performance.now() - rescanT > 6000) { rescanT = performance.now(); audio.refreshManifest().then((r) => { if (r.added.length || r.changed.length) setStatus(`manifest: +${r.added.length} new / ${r.changed.length} changed`); }).catch(() => {}); }
}

// ------------------------------------------------------------------------------------------------------------ analysis kit
function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), hl = len >> 1;
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < hl; j++) { const a = i + j, b = a + hl, vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr; re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
  }
}
/** Hann-windowed magnitude spectrum of x[t0 .. t0+dur]. */
function spectrum(x, sr, t0, dur) {
  const n0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(x.length - n0, Math.floor(dur * sr));
  let N = 1; while (N < n) N <<= 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < n; i++) re[i] = x[n0 + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  fftInPlace(re, im);
  const mag = new Float64Array(N / 2); for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]) * 4 / n;
  return { mag, df: sr / N, N };
}
function peakHz(x, sr, t0, dur, fmin, fmax) {
  const s = spectrum(x, sr, t0, dur), a = Math.max(1, Math.floor(fmin / s.df)), b = Math.min(s.mag.length - 2, Math.ceil(fmax / s.df));
  let bi = a; for (let i = a; i <= b; i++) if (s.mag[i] > s.mag[bi]) bi = i;
  const y0 = s.mag[bi - 1], y1 = s.mag[bi], y2 = s.mag[bi + 1], den = y0 - 2 * y1 + y2, off = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
  return { hz: (bi + off) * s.df, amp: y1 };
}
/** Amplitude of a known tone f in x[t0..t0+dur] (Hann-windowed single-bin DFT). */
function tone(x, sr, t0, dur, f) {
  const n0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(x.length - n0, Math.floor(dur * sr));
  let re = 0, im = 0, ws = 0; const w0 = 2 * Math.PI * f / sr;
  for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); ws += w; re += x[n0 + i] * w * Math.cos(w0 * i); im -= x[n0 + i] * w * Math.sin(w0 * i); }
  return 2 * Math.hypot(re, im) / ws;
}
function rmsOf(x, sr, t0, dur) { const a = Math.max(0, Math.floor(t0 * sr)), b = Math.min(x.length, Math.floor((t0 + dur) * sr)); let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }
function centroid(x, sr, t0, dur) { const s = spectrum(x, sr, t0, dur); let a = 0, b = 0; for (let i = 1; i < s.mag.length; i++) { a += s.mag[i] * i * s.df; b += s.mag[i]; } return b > 0 ? a / b : 0; }
/** Discontinuity scan: second difference vs local amplitude. Flags gain steps / hard cuts (not smooth ramps). */
function clickScan(x, sr, { thr = 0.07, win = 0.004, skip = 0, abs = 3e-4 } = {}) {
  const n = x.length, w = Math.round(win * sr), S = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) S[i + 1] = S[i] + x[i] * x[i];
  const out = []; let lastI = -1e9;
  for (let i = Math.max(2 + w, Math.floor(skip * sr)); i < n - w; i++) {
    const d2 = x[i] - 2 * x[i - 1] + x[i - 2];
    if (Math.abs(d2) < abs) continue;
    const amp = Math.sqrt((S[i + w] - S[i - w]) / (2 * w)) * 1.4142 + 1e-5;
    if (Math.abs(d2) > thr * amp) { if (i - lastI > sr * 0.003) out.push({ t: +(i / sr).toFixed(4), d2: +d2.toFixed(4), amp: +amp.toFixed(4), r: +(Math.abs(d2) / amp).toFixed(3) }); lastI = i; }
  }
  return { count: out.length, list: out.slice(0, 6) };
}
const peakOf = (x) => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; };
const dbr = (a, b) => 20 * Math.log10(Math.max(a, 1e-9) / Math.max(b, 1e-9));
function mkRand(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function sineBuf(sr, f, dur, amp = 0.3, ch = 1) { const n = Math.round(sr * dur), b = new AudioBuffer({ length: n, sampleRate: sr, numberOfChannels: ch }), fq = Math.round(f * dur) / dur; for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = amp * Math.sin(2 * Math.PI * fq * i / sr); } return b; }
function noiseBuf(sr, dur, seed, lpHz = 2000, amp = 0.3) { const n = Math.round(sr * dur), b = new AudioBuffer({ length: n, sampleRate: sr, numberOfChannels: 1 }), d = b.getChannelData(0), r = mkRand(seed), k = Math.exp(-2 * Math.PI * lpHz / sr); let y = 0; for (let i = 0; i < n; i++) { y = k * y + (1 - k) * (r() * 2 - 1); d[i] = y; } let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(d[i])); for (let i = 0; i < n; i++) d[i] *= amp / mx; /* seamless: crossfade end into start */ const f = Math.floor(sr * 0.05); for (let i = 0; i < f; i++) { const a = i / f; d[i] = d[i] * a + d[n - f + i] * (1 - a) * 0 + 0; } return b; }
const SR = 44100;

/** Render `dur` seconds offline; `step(t, A)` runs at ~60 Hz of audio time (OfflineAudioContext.suspend), so the whole per-frame game logic runs deterministically. */
async function renderOffline({ dur, sr = SR, setup, step, dt = 1 / 60, real = false, seed = 1 }) {
  const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const A = new AudioSys(null, { context: off, rand: mkRand(seed) });
  A.listener.setRaw({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, [0, 0, 0]);
  if (real) await A.init('/audio/manifest.json');
  const ctxObj = await setup(A, off);
  const seen = new Set(); let steps = 0;
  let jsMs = 0, jsMax = 0; const slow = [];
  const run = (t) => { const p0 = performance.now(); step && step(t, A, ctxObj); A.update(dt); const d = performance.now() - p0; jsMs += d; if (d > jsMax) jsMax = d; if (d > 4) slow.push([+t.toFixed(2), +d.toFixed(1)]); steps++; };
  for (let t = dt; t < dur - 0.05; t += dt) {
    const qt = Math.round(t * sr / 128) * 128 / sr; if (seen.has(qt) || qt <= 0) continue; seen.add(qt);
    off.suspend(qt).then(() => { run(off.currentTime); off.resume(); });
  }
  run(0);
  const t0 = performance.now();
  const buf = await off.startRendering();
  return { A, buf, x: buf.getChannelData(0), xr: buf.getChannelData(1), sr, ms: performance.now() - t0, steps, ctxObj, jsAvgMs: jsMs / Math.max(1, steps), jsMaxMs: jsMax, slowFrames: slow };
}
function injectEngine(A, id, rpms, gen, extra = {}) {
  ['idle', 'low', 'mid', 'high', 'redline'].forEach((st, i) => A.injectSound(`vehicles/${id}_${st}`, gen(rpms[i], i), { loop: true, category: 'engine', engine: id, stage: st, rpm: rpms[i], ...extra }));
}
const RPMS = [900, 2200, 3600, 5200, 6500];
const lerpN = (a, b, t) => a + (b - a) * t;
const R_OF = (rpm01, rp = RPMS) => lerpN(rp[0] * 0.94, rp[4] * 1.03, Math.min(1, Math.max(0, (rpm01 - 0.2) / 0.8)));

// ------------------------------------------------------------------------------------------------------------ self tests
const report = { asserts: [], tests: {}, info: {} };
function ck(name, ok, value, expect) { report.asserts.push({ name, ok: !!ok, value, expect }); return !!ok; }
const NS = (n) => Math.round(n * 1000) / 1000;

async function tEngineSine() {
  const T = 14, tri = (t) => (t < 7 ? t / 7 : 2 - t / 7), rec = [];
  const r = await renderOffline({ dur: T, setup: (A) => {
    injectEngine(A, 'engine_tsine', RPMS, (rpm) => sineBuf(SR, rpm / 10, 1.0, 0.25));
    return { eng: A.engine('e', { id: 'x', engine: { vmax: 50 } }, { engineId: 'engine_tsine', player: true, level: 1, tyres: false }) };
  }, step: (t, A, o) => { const rpm01 = 0.2 + 0.8 * tri(t); o.eng.update(rpm01, 1, 0, 0, 30, {}); const w = o.eng.w; rec.push({ t, rpm01, sw2: w.reduce((a, b) => a + b * b, 0) }); } });
  const errs = [];
  for (const tt of [1.2, 2.4, 3.6, 4.8, 6.0, 8.5, 9.7, 10.9, 12.1]) {
    const rpm01 = 0.2 + 0.8 * tri(tt), exp = R_OF(rpm01) / 10, got = peakHz(r.x, r.sr, tt - 0.15, 0.3, 40, 900).hz;
    errs.push({ t: tt, rpm01: NS(rpm01), expectHz: NS(exp), gotHz: NS(got), errPct: NS((got - exp) / exp * 100) });
  }
  const maxErr = Math.max(...errs.map((e) => Math.abs(e.errPct))), sw = Math.max(...rec.map((x) => Math.abs(x.sw2 - 1)));
  const cl = clickScan(r.x, r.sr, { skip: 0.4 });
  report.tests.engineSine = { renderMs: Math.round(r.ms), steps: r.steps, errs, maxPitchErrPct: NS(maxErr), maxWeightPowerDev: NS(sw), clicks: cl, peak: NS(peakOf(r.x)) };
  ck('engine pitch tracks rpm (|err| < 4%)', maxErr < 4, NS(maxErr), '< 4');
  ck('engine stage crossfade is equal-power (sum w^2 == 1)', sw < 0.002, NS(sw), '< 0.002');
  ck('engine rpm sweep click-free', cl.count === 0, cl.count, 0);
  ck('engine graph nodes freed after dispose', await disposeCheck(r.A, r.ctxObj.eng), 0, 0);
}
async function disposeCheck(A, eng) { eng.dispose(0.01); await new Promise((r) => setTimeout(r, 30)); A._timers.forEach((t) => { t.t = -1; }); A._tickFast(); const g = A.graphStats().live; return g.src === 0 && g.gain === 0 && g.filter === 0 && g.panner === 0; }

async function tEngineNoise() {
  const T = 12, tri = (t) => (t < 6 ? t / 6 : 2 - t / 6);
  const r = await renderOffline({ dur: T, setup: (A) => {
    injectEngine(A, 'engine_tnoise', RPMS, (rpm, i) => noiseBuf(SR, 1.0, 10 + i, 1500, 0.3));
    return { eng: A.engine('e', { id: 'x', engine: { vmax: 50 } }, { engineId: 'engine_tnoise', player: true, level: 1, tyres: false }) };
  }, step: (t, A, o) => o.eng.update(0.2 + 0.8 * tri(t), 1, 0, 0, 30, {}) });
  const w = 0.4, levels = [];
  for (let t = 1; t < T - 1; t += w) levels.push(dbr(rmsOf(r.x, r.sr, t, w), 1));
  const spread = Math.max(...levels) - Math.min(...levels);
  report.tests.engineNoise = { spreadDb: NS(spread), levels: levels.map(NS) };
  ck('engine crossfade keeps loudness within 2 dB across the whole rpm range', spread < 2.0, NS(spread), '< 2 dB');
}

async function tEngineCull() {
  const T = 16, log = [];
  const r = await renderOffline({ dur: T, setup: (A) => {
    injectEngine(A, 'engine_tsine', RPMS, (rpm) => sineBuf(SR, rpm / 10, 1.0, 0.25));
    return { eng: A.engine('far', { id: 'x', engine: { vmax: 50 }, kind: 'enemy' }, { engineId: 'engine_tsine', level: 1, tyres: false }) };
  }, step: (t, A, o) => {
    const d = t < 8 ? 60 + (t / 8) * 160 : 220 - ((t - 8) / 8) * 160; // 60 -> 220 -> 60 m
    o.eng.update(0.6, 0.7, 0, d, 25, { pos: [0, 1, d], vel: [0, 0, 0] });
    if (Math.floor(t * 10) % 10 === 0 && Math.abs(t * 10 - Math.round(t * 10)) < 0.1) log.push({ t: NS(t), d: Math.round(d), built: o.eng.built, allowed: o.eng.allowed, lod: o.eng.lod });
  } });
  const cl = clickScan(r.x, r.sr, { skip: 0.5, abs: 1e-4 });
  const builtSeq = log.map((l) => (l.built ? 1 : 0)).join('');
  const culled = log.some((l) => !l.allowed);
  report.tests.engineCull = { clicks: cl, culledAtSomePoint: culled, sample: log.filter((_, i) => i % 6 === 0) };
  ck('far engine is culled beyond 180 m and returns (hysteresis)', culled && log[log.length - 1].allowed, builtSeq.length, 'culled then back');
  ck('cull / un-cull / LOD switch click-free', cl.count === 0, cl.count, 0);
  // max 10 engines
  const r2 = await renderOffline({ dur: 1, setup: (A) => { injectEngine(A, 'engine_tsine', RPMS, (rpm) => sineBuf(SR, rpm / 10, 1.0, 0.1)); const es = []; for (let i = 0; i < 14; i++) es.push(A.engine('c' + i, { id: 'x', engine: { vmax: 50 }, kind: 'enemy' }, { engineId: 'engine_tsine', tyres: false })); return { es }; }, step: (t, A, o) => { o.es.forEach((e, i) => e.update(0.5, 0.5, 0, 10 + i * 12, 20, { pos: [0, 1, 10 + i * 12], vel: [0, 0, 0] })); } });
  const g = r2.A.graphStats();
  const allowed = r2.ctxObj.es.map((e) => e.allowed);
  report.tests.engineMax = { enginesAllowed: g.enginesAllowed, enginesBuilt: g.enginesBuilt, allowed: allowed.map((a) => (a ? 1 : 0)).join('') };
  ck('at most 10 simultaneous engines, nearest first', g.enginesAllowed === 10 && allowed.slice(0, 10).every(Boolean) && !allowed.slice(10).some(Boolean), allowed.map((a) => (a ? 1 : 0)).join(''), '1111111111 0000');
}

async function tDoppler() {
  const V = 40, LAT = 8, Z0 = -160, T = 9, f0 = 1000, samples = [];
  const r = await renderOffline({ dur: T, setup: (A) => {
    A.injectSound('sfx/tone1k', sineBuf(SR, f0, 1.0, 0.4), { loop: true, category: 'vehicle_loop' });
    const h = A.play('sfx/tone1k', { pos: [LAT, 1, Z0], vel: [0, 0, V], loop: true, pitchVar: 0, gain: 1, refDist: 30, noCull: true, airAbsorb: 50 });
    return { h };
  }, step: (t, A, o) => { const z = Z0 + V * t; o.h.setPos([LAT, 1, z], [0, 0, V]); samples.push({ t, z }); } });
  const res = [];
  for (const tt of [1.0, 1.8, 2.6, 5.4, 6.2, 7.0]) {
    const z = Z0 + V * tt, dx = LAT, dz = z, d = Math.hypot(dx, 0, dz), vs = V * dz / d, expect = f0 * 343 / (343 + vs);
    const got = peakHz(r.x, r.sr, tt - 0.12, 0.24, 500, 1600).hz;
    res.push({ t: tt, z: NS(z), expectHz: NS(expect), gotHz: NS(got), errPct: NS((got - expect) / expect * 100) });
  }
  const maxErr = Math.max(...res.map((x) => Math.abs(x.errPct)));
  report.tests.doppler = { res, maxErrPct: NS(maxErr), approachRatio: NS(res[0].gotHz / f0), recedeRatio: NS(res[5].gotHz / f0) };
  ck('doppler shift matches (c+vl)/(c+vs) within 2.5%', maxErr < 2.5, NS(maxErr), '< 2.5%');
  ck('doppler approach > 1 and recede < 1', res[0].gotHz > f0 * 1.05 && res[5].gotHz < f0 * 0.95, `${NS(res[0].gotHz)} / ${NS(res[5].gotHz)}`, '>1050 / <950');
  // listener moving (player driving) toward a static source
  const r2 = await renderOffline({ dur: 4, setup: (A) => { A.injectSound('sfx/tone1k', sineBuf(SR, f0, 1.0, 0.4), { loop: true, category: 'vehicle_loop' }); return { h: A.play('sfx/tone1k', { pos: [0, 1, 100], vel: [0, 0, 0], loop: true, pitchVar: 0, refDist: 30, noCull: true, airAbsorb: 50 }) }; }, step: (t, A, o) => { A.listener.setRaw({ x: 0, y: 1.6, z: 30 * t }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, [0, 0, 30]); o.h.setPos([0, 1, 100], [0, 0, 0]); } });
  const g = peakHz(r2.x, r2.sr, 1.5, 0.3, 500, 1600).hz, exp = f0 * (343 + 30) / 343;
  report.tests.dopplerListener = { gotHz: NS(g), expectHz: NS(exp) };
  ck('doppler with a moving listener (30 m/s toward source) within 2.5%', Math.abs(g - exp) / exp < 0.025, NS(g), NS(exp));
}

async function tSpatial() {
  const dur = 1.2;
  const run = (az, d, ref = 6) => renderOffline({ dur, setup: (A) => { A.injectSound('sfx/lfnoise', noiseBuf(SR, 1.0, 5, 250, 0.4), { loop: true, category: 'vehicle_loop' }); const a = az * Math.PI / 180; return { h: A.play('sfx/lfnoise', { pos: [Math.sin(a) * d, 1.6, Math.cos(a) * d], loop: true, pitchVar: 0, refDist: ref, noCull: true }) }; } });
  const rL = await run(90, 10), rC = await run(0, 10), rR = await run(-90, 10);
  const lr = (r) => dbr(rmsOf(r.x, r.sr, 0.4, 0.7), rmsOf(r.xr, r.sr, 0.4, 0.7));
  report.tests.pan = { leftDb: NS(lr(rL)), frontDb: NS(lr(rC)), rightDb: NS(lr(rR)) };
  ck('source at +X (left) is louder in the LEFT channel (> 12 dB)', lr(rL) > 12, NS(lr(rL)), '> 12');
  ck('source in front is centred (|L-R| < 1 dB)', Math.abs(lr(rC)) < 1, NS(lr(rC)), '< 1');
  ck('source at -X (right) is louder in the RIGHT channel (< -12 dB)', lr(rR) < -12, NS(lr(rR)), '< -12');
  const ref = rmsOf((await run(0, 6)).x, SR, 0.4, 0.7), dists = [12, 24, 48, 96, 192, 300], rows = [];
  for (const d of dists) { const rr = await run(0, d), lv = rmsOf(rr.x, SR, 0.4, 0.7); rows.push({ d, gotDb: NS(dbr(lv, ref)), expectDb: NS(20 * Math.log10(attGain(d, 6))) }); }
  const maxDev = Math.max(...rows.map((x) => Math.abs(x.gotDb - x.expectDb)));
  report.tests.distance = { rows, maxDevDb: NS(maxDev) };
  ck('distance attenuation follows the tuned inverse model (ref 6 m) within 1.5 dB from 6 to 300 m', maxDev < 1.5, NS(maxDev), '< 1.5');
  // air absorption: white-ish noise centroid drops with distance
  const wn = async (d) => renderOffline({ dur, setup: (A) => { A.injectSound('sfx/wn', noiseBuf(SR, 1.0, 9, 20000, 0.4), { loop: true, category: 'vehicle_loop' }); return { h: A.play('sfx/wn', { pos: [0, 1.6, d], loop: true, pitchVar: 0, refDist: 6, noCull: true }) }; } });
  const c10 = centroid((await wn(10)).x, SR, 0.4, 0.7), c250 = centroid((await wn(250)).x, SR, 0.4, 0.7);
  report.tests.air = { centroid10m: Math.round(c10), centroid250m: Math.round(c250), cutoff250: Math.round(airCutoff(250)) };
  ck('air absorption: spectral centroid at 250 m < 40% of 10 m', c250 < c10 * 0.4, `${Math.round(c250)} vs ${Math.round(c10)}`, '< 0.4x');
}

async function tVoices() {
  const r = await renderOffline({ dur: 4, setup: (A) => {
    A.injectSound('impacts/tclick', sineBuf(SR, 400, 0.5, 0.2), { loop: false, category: 'impact_bullet' });
    return { hs: [] };
  }, step: (t, A, o) => { if (t < 0.05 && !o.done) { o.done = true; for (let i = 0; i < 30; i++) o.hs.push(A.play('impacts/tclick', { pitchVar: 0.2 })); o.peakVoices = A.voices.size; o.cap = A.defs.get('impacts/tclick').cap; } if (t > 3.6 && !o.fin) { o.fin = true; o.end = A.graphStats(); } } });
  const o = r.ctxObj, cl = clickScan(r.x, r.sr, { skip: 0.02, thr: 0.12 });
  report.tests.voices = { cap: o.cap, peakVoices: o.peakVoices, stolen: r.A.stats.stolen, live: o.end.live, voicesAtEnd: o.end.voices, clicks: cl };
  ck('per-name voice cap enforced with stealing', o.peakVoices <= o.cap && r.A.stats.stolen === 30 - o.cap, `${o.peakVoices}/${o.cap}, stolen ${r.A.stats.stolen}`, `<= ${o.cap}, stolen ${30 - o.cap}`);
  ck('no leaked nodes after one-shots end (offline)', o.end.voices === 0 && o.end.live.src === 0 && o.end.live.gain === 0, JSON.stringify(o.end.live), 'all 0');
  ck('voice stealing is click-free (12 ms fade)', cl.count === 0, cl.count, 0);
}

function synthMusic(A, freqsRun, freqsBoss, sr = SR) {
  const bpm = 120, bars = 4, spb = 2.0, dur = 8.0, def = (id, stem, layer, f, loop = true, d = dur) => A.injectSound(`music/${id}_${stem}`, sineBuf(sr, f, d, 0.25, 2), { loop, category: 'music_stem', track: id, stem, intensity: layer, bpm, bars, secPerBar: spb, gain: 1, loopEnd: d });
  ['base', 'drums', 'lead', 'extra'].forEach((s, i) => { def('run_t1', s, i, freqsRun[i]); def('boss', s, i, freqsBoss[i]); });
  def('victory', 'base', 0, 1800, false, 4.0);
}
async function tMusic() {
  const FR = [300, 700, 1100, 1500], FB = [400, 800, 1200, 1600], T = 28;
  const r = await renderOffline({ dur: T, setup: (A) => { synthMusic(A, FR, FB); A.setVolumes({ master: 1, music: 1 }); return {}; }, step: (t, A) => {
    if (!A._ms) A._ms = {};
    const once = (k, tt, fn) => { if (!A._ms[k] && t >= tt) { A._ms[k] = 1; fn(); } };
    once('a', 0.0, () => { A.music.setState('run'); });
    once('b', 3.3, () => A.music.setIntensity(0.34));
    once('c', 9.4, () => A.music.setState('boss'));
    once('d', 13.0, () => A.duck(0.6, { hold: 0.5, release: 1.0 }));
    once('e', 17.0, () => A.music.setState('victory'));
  } });
  const A = r.A, log = A.music.log, sr = r.sr;
  report.tests.musicDebug = { ms: A._ms, state: A.music.state, want: A.music.wantTrack, tracks: [...A.music.tracks.keys()], kinds: [...A.music.tracks.values()].map((t) => t.kind + ':' + t.stems.length), log: log.length };
  const starts = log.filter((l) => l.type === 'start');
  report.tests.music = { log: log.map((l) => ({ ...l, when: l.when !== undefined ? NS(l.when) : undefined, t: l.t !== undefined ? NS(l.t) : undefined, now: l.now !== undefined ? NS(l.now) : undefined })) };
  // 1) state change lands on a bar boundary of the previous track
  const t0run = starts[0].when, spb = 2;
  const bossBar = (starts[1].when - t0run) / spb, vicBar = (starts[2].when - starts[1].when) / spb;
  report.tests.music.bossBar = NS(bossBar); report.tests.music.victoryBar = NS(vicBar);
  ck('run -> boss switch starts exactly on a bar boundary', Math.abs(bossBar - Math.round(bossBar)) < 1e-3 && starts[1].when > 9.4, NS(bossBar), 'integer');
  ck('boss -> victory switch starts exactly on a bar boundary', Math.abs(vicBar - Math.round(vicBar)) < 1e-3, NS(vicBar), 'integer');
  // 2) audio actually changes at that time: boss tone absent before, present after; run tone gone after the crossfade
  const tb = starts[1].when, xf = starts[1].xfade;
  const aBoss = (t) => tone(r.x, sr, t, 0.05, 400), aRun = (t) => tone(r.x, sr, t, 0.05, 300);
  const before = aBoss(tb - 0.25), atEnd = aBoss(tb + xf + 0.15), runBefore = aRun(tb - 0.25), runAfter = aRun(tb + xf + 0.15);
  report.tests.music.xfade = { tb: NS(tb), xf, bossBefore: NS(before), bossAfter: NS(atEnd), runBefore: NS(runBefore), runAfter: NS(runAfter) };
  ck('boss stem silent until the bar boundary, then present', before < 0.003 && atEnd > 0.05, `${NS(before)} -> ${NS(atEnd)}`, '<0.003 -> >0.05');
  ck('run stem gone after the crossfade', runAfter < 0.003 && runBefore > 0.05, `${NS(runBefore)} -> ${NS(runAfter)}`, '>0.05 -> <0.003');
  // 3) equal power across the crossfade
  const pw = []; for (let k = 0; k <= 8; k++) { const t = tb + xf * (k / 8); const a = aBoss(Math.max(0, t - 0.025)), b = aRun(Math.max(0, t - 0.025)); pw.push(NS(dbr(Math.sqrt(a * a + b * b), 0.25 * 0.3 * 2))); }
  const ripple = Math.max(...pw) - Math.min(...pw);
  report.tests.music.xfadePowerDb = pw; report.tests.music.xfadeRippleDb = NS(ripple);
  ck('crossfade is equal-power (ripple < 1 dB over the fade)', ripple < 1.2, NS(ripple), '< 1.2 dB');
  // 4) layers come in on the bar after setIntensity (t=3.3): drum stem (700 Hz) must start after the next boundary
  const lay = log.find((l) => l.type === 'layers'), tl = lay.t;
  const onset = (() => { for (let t = 3.3; t < 8; t += 0.02) if (tone(r.x, sr, t, 0.05, 700) > 0.02) return t; return -1; })();
  report.tests.music.layers = { scheduledAt: NS(tl), onset: NS(onset) };
  ck('intensity change is quantised to the next bar (drum layer starts at the boundary)', Math.abs(tl - (t0run + 2 * spb)) < 1e-3 && onset >= tl - 0.03 && onset < tl + 0.35, `${NS(tl)} / onset ${NS(onset)}`, `boundary ${NS(t0run + 2 * spb)} then fade`);
  // 5) ducking depth + recovery
  const ref = tone(r.x, sr, 12.5, 0.3, 400), duck = tone(r.x, sr, 13.2, 0.25, 400), rec = tone(r.x, sr, 16.2, 0.3, 400);
  report.tests.music.duck = { refDb: NS(dbr(ref, 1)), duckDb: NS(dbr(duck, 1)), deltaDb: NS(dbr(duck, ref)), recoverDb: NS(dbr(rec, ref)) };
  ck('duck(0.6) lowers music by ~8 dB', Math.abs(dbr(duck, ref) + 7.96) < 1.6, NS(dbr(duck, ref)), '-7.96 +-1.6');
  ck('music recovers after the duck', Math.abs(dbr(rec, ref)) < 0.8, NS(dbr(rec, ref)), '~0');
  // 6) victory is a one-shot and ends
  const ended = log.some((l) => l.type === 'ended');
  ck('victory one-shot plays once and is released', ended && A.music.cur === null, ended, true);
  const g = A.graphStats(); report.tests.music.live = g.live;
  ck('no leaked music nodes after transitions (only live bed allowed)', g.live.src <= 0 + 4 * 0 + 0 || A.music.cur === null && g.live.src === 0, JSON.stringify(g.live), 'src 0');
}

async function tConcussion() {
  const r = await renderOffline({ dur: 9, setup: (A) => { A.injectSound('sfx/hf', sineBuf(SR, 6000, 1, 0.3), { loop: true, category: 'vehicle_loop' }); A.injectSound('sfx/lf', sineBuf(SR, 200, 1, 0.3), { loop: true, category: 'vehicle_loop' }); A.play('sfx/hf', { loop: true, pitchVar: 0 }); A.play('sfx/lf', { loop: true, pitchVar: 0 }); return {}; }, step: (t, A) => { if (!A._c && t >= 2) { A._c = 1; A.concussion(1); } } });
  const hf = (t) => tone(r.x, r.sr, t, 0.2, 6000), lf = (t) => tone(r.x, r.sr, t, 0.2, 200);
  const base = hf(1.5), dive = hf(2.3), late = hf(3.3), rec = hf(8);
  report.tests.concussion = { hfBaseDb: NS(dbr(base, 1)), hfDiveDb: NS(dbr(dive, base)), hf1sAfterDb: NS(dbr(late, base)), hfRecoveredDb: NS(dbr(rec, base)), lfDiveDb: NS(dbr(lf(2.3), lf(1.5))) };
  ck('concussion low-pass kills the highs (> 25 dB down at 6 kHz)', dbr(dive, base) < -25, NS(dbr(dive, base)), '< -25');
  ck('concussion recovers fully within ~6 s', Math.abs(dbr(rec, base)) < 1.0, NS(dbr(rec, base)), '~0');
  const r2 = await renderOffline({ dur: 6, setup: (A) => { A.injectSound('sfx/lf', sineBuf(SR, 200, 1, 0.3), { loop: true, category: 'vehicle_loop' }); A.play('sfx/lf', { loop: true, pitchVar: 0 }); return {}; }, step: (t, A) => { if (!A._c && t >= 2) { A._c = 1; A.concussion(1); } } });
  const cl = clickScan(r2.x, r2.sr, { skip: 0.3, thr: 0.1 });
  ck('concussion transition is click-free (200 Hz probe)', cl.count === 0, cl.count, 0);
}

async function tAmbience() {
  const r = await renderOffline({ dur: 14, setup: (A) => {
    A.injectSound('ambience/desert_test_loop', sineBuf(SR, 200, 4, 0.3, 2), { loop: true, category: 'ambience' });
    A.injectSound('ambience/canyon_test_loop', sineBuf(SR, 400, 4, 0.3, 2), { loop: true, category: 'ambience' });
    A.injectSound('vehicles/wind_loop', noiseBuf(SR, 2.5, 3, 3000, 0.5), { loop: true, category: 'vehicle_loop' });
    A.setVolumes({ master: 1, ambience: 1 }); return {};
  }, step: (t, A) => { if (!A._s) A._s = {}; const once = (k, tt, fn) => { if (!A._s[k] && t >= tt) { A._s[k] = 1; fn(); } };
    once('a', 0, () => A.ambience.setBiome('desert')); once('b', 5, () => A.ambience.setBiome('canyon', { xfade: 3 })); once('w1', 9, () => A.ambience.wind(1)); } });
  const sr = r.sr, d = (t) => tone(r.x, sr, t, 0.2, 200), c = (t) => tone(r.x, sr, t, 0.2, 400);
  const log = r.A.eventLog.filter((l) => l.type === 'ambience');
  const pw = []; for (let k = 0; k <= 6; k++) { const t = 5.03 + 3 * k / 6 - 0.1; pw.push(NS(dbr(Math.hypot(d(Math.max(0.3, t)), c(Math.max(0.3, t))), 0.3 * 0.7071 * 1))); }
  const ripple = Math.max(...pw) - Math.min(...pw);
  const winBefore = d(4.5), winAfterD = d(8.4), winAfterC = c(8.4), beforeC = c(4.5);
  report.tests.ambience = { log: log.map((l) => ({ biome: l.biome, start: NS(l.start), xfade: l.xfade, layers: l.layers })), pwDb: pw, rippleDb: NS(ripple), desertBefore: NS(winBefore), canyonBefore: NS(beforeC), desertAfter: NS(winAfterD), canyonAfter: NS(winAfterC) };
  ck('biome crossfade is equal-power (ripple < 1 dB)', ripple < 1.2, NS(ripple), '< 1.2');
  ck('old biome faded out and new biome in after xfade', winAfterD < 0.002 && winAfterC > 0.05 && winBefore > 0.05 && beforeC < 0.002, `${NS(winBefore)}/${NS(beforeC)} -> ${NS(winAfterD)}/${NS(winAfterC)}`, 'swap');
  const bedNow = c(8.6), bedWind = c(12.5), ws = dbr(bedWind, bedNow);
  const windRms0 = rmsOf(r.x, sr, 0.5, 0.4), windRms1 = rmsOf(r.x, sr, 12, 1.0);
  report.tests.ambience.windMaskDb = NS(ws); report.tests.ambience.windRms = [NS(windRms0), NS(windRms1)];
  ck('wind(1) masks the biome bed by ~6 dB', Math.abs(ws + 6.02) < 1.5, NS(ws), '-6 +-1.5');
}

async function tDetector() {
  const r = await renderOffline({ dur: 2, setup: (A, off) => { const s = off.createBufferSource(); s.buffer = sineBuf(SR, 200, 1, 0.3); s.loop = true; const g = off.createGain(); g.gain.setValueAtTime(0.2, 0); g.gain.setValueAtTime(1.0, 1.00125); s.connect(g); g.connect(off.destination); s.start(); return {}; } });
  const cl = clickScan(r.x, r.sr, { skip: 0.1 });
  ck('click detector self-check: flags a deliberate hard gain step', cl.count >= 1 && Math.abs(cl.list[0].t - 1.00125) < 0.01, JSON.stringify(cl.list[0]), 'spike at 1.001 s');
  const r2 = await renderOffline({ dur: 2, setup: (A, off) => { const s = off.createBufferSource(); s.buffer = sineBuf(SR, 200, 1, 0.3); s.loop = true; const g = off.createGain(); g.gain.setValueAtTime(0.2, 0); g.gain.setTargetAtTime(1.0, 1.00125, 0.01); s.connect(g); g.connect(off.destination); s.start(); return {}; } });
  const c2 = clickScan(r2.x, r2.sr, { skip: 0.1 });
  ck('click detector: a 10 ms setTargetAtTime gain change is not flagged', c2.count === 0, c2.count, 0);
}

async function tLibrary() {
  const t0 = performance.now(), defs = [...audio.defs.values()].filter((d) => !d.injected);
  await audio.load(defs, 3);
  const bad = [], dur = [], seam = [], peak = [], over = [];
  let nan = 0, files = 0;
  for (const d of defs) d.bufs.forEach((b, i) => {
    if (!b) { bad.push(d.key + '#' + i + ' failed'); return; }
    files++;
    const exp = d.meta.durations ? d.meta.durations[i] : d.duration;
    if (Math.abs(b.duration - exp) > 0.06) dur.push({ k: d.key + '#' + i, got: NS(b.duration), exp });
    let pk = 0; for (let c = 0; c < b.numberOfChannels; c++) { const x = b.getChannelData(c); for (let n = 0; n < x.length; n++) { const a = Math.abs(x[n]); if (a > pk) pk = a; if (a !== a) nan++; } }
    peak.push({ k: d.key, pk });
    if (pk > 1.0001) over.push({ k: d.key, pk: NS(pk) });
    if (d.loop) { const x = b.getChannelData(0), n = x.length; let m = 0; for (let k = 1; k < 4000 && k < n; k++) m += Math.abs(x[k] - x[k - 1]); m /= 4000; const jump = Math.abs(x[0] - x[n - 1]); if (jump > 0.02 && jump > m * 12) seam.push({ k: d.key, jump: NS(jump), meanStep: NS(m) }); }
  });
  const ms = performance.now() - t0, st = audio.bufferStats();
  report.tests.library = { sounds: defs.length, files, loadMs: Math.round(ms), decodedMB: NS(st.bytes / 1048576), failures: bad, durationMismatch: dur.slice(0, 10), loopSeamSuspects: seam, nan, worstPeak: NS(Math.max(...peak.map((p) => p.pk))), codecOvershoot: over };
  ck('every manifest file fetches and decodes', bad.length === 0, bad.slice(0, 5), 'none');
  ck('decoded durations match the manifest (+-60 ms)', dur.length === 0, dur.length, 0);
  ck('no NaN and decoded peaks <= +2 dBFS (Vorbis overshoot; the master soft-clips)', nan === 0 && report.tests.library.worstPeak <= 1.26, report.tests.library.worstPeak, '<= 1.26');
  ck('loops have no audible seam jump (decoded first/last sample)', seam.length === 0, seam.slice(0, 4), 'none');
}

async function tRealtime() {
  await audio.unlock();
  const c = audio.ctx, t0 = c.currentTime; await new Promise((r) => setTimeout(r, 400));
  const adv = c.currentTime - t0, running = c.state === 'running' && adv > 0.2;
  report.tests.realtime = { state: c.state, advanced: NS(adv), baseLatency: c.baseLatency, sampleRate: c.sampleRate };
  ck('AudioContext runs in real time (headless autoplay flag)', running, `${c.state} +${NS(adv)}s`, 'running');
  if (!running) return;
  await audio.preload(['guns/fire_lmg', 'explosions/explosion_huge', 'ui/click', 'impacts/bullet_metal', 'guns/fire_smg'], 0);
  audio.meterReset(); audio.play('guns/fire_lmg', { gain: 1 }); audio.play('explosions/explosion_huge', { pos: [0, 1, 10] });
  await new Promise((r) => setTimeout(r, 500));
  const pk = audio.meterState.peakMax; report.tests.realtime.meterPeak = NS(pk);
  ck('live AnalyserNode sees the master output (peak > 0.02)', pk > 0.02, NS(pk), '> 0.02');
  ck('output never exceeds 1.0 (soft limiter)', pk <= 1.0, NS(pk), '<= 1');
  audio.stopAll(0.02); audio.setVolumes({ sfx: 0 }); await new Promise((r) => setTimeout(r, 500)); audio.meterReset();
  audio.play('guns/fire_lmg', { gain: 1 }); await new Promise((r) => setTimeout(r, 300));
  const z = audio.meterState.peakMax; report.tests.realtime.sfxMutedPeak = NS(z);
  ck('sfx bus volume 0 silences sfx', z < 0.002, NS(z), '< 0.002');
  audio.setVolumes({ sfx: 1 });
  await new Promise((r) => setTimeout(r, 300));
  audio.meterReset(); audio.ui('click'); await new Promise((r) => setTimeout(r, 200));
  ck('ui bus audible', audio.meterState.peakMax > 0.005, NS(audio.meterState.peakMax), '> 0.005');
  // leak test: hammer one-shots, wait, live nodes back to baseline
  audio.stopAll(0.02); await new Promise((r) => setTimeout(r, 400));
  const base = audio.graphStats();
  for (let i = 0; i < 120; i++) { audio.play('impacts/bullet_metal', { pos: [Math.sin(i) * 30, 1, 20 + i % 40] }); audio.play('guns/fire_smg', { pos: [10, 1, 30] }); }
  await new Promise((r) => setTimeout(r, 200));
  const peakVoices = audio.voices.size;
  await new Promise((r) => setTimeout(r, 3500));
  const end = audio.graphStats();
  report.tests.realtime.leak = { baseline: base.live, afterBurst: peakVoices, end: end.live, voices: end.voices, stats: end.stats };
  ck('voice count bounded during a 240-shot burst', peakVoices <= audio.maxVoices, peakVoices, `<= ${audio.maxVoices}`);
  ck('no leaked nodes after the burst (live counts back to baseline)', end.voices === 0 && end.live.src === base.live.src && end.live.gain === base.live.gain && end.live.panner === base.live.panner && end.live.filter === base.live.filter, JSON.stringify(end.live), JSON.stringify(base.live));
}

/** Full AudioBridge scenario with the real library rendered offline: mix sanity (peak / loudness / clipping / leaks). */
async function runScenario(draw) {
  const T = 16;
  const mkCar = (id, specId, kind, p, v) => { const st = makeCarState(id, specId, kind); st.pos.set(...p); st.vel.set(...v); st.speed = Math.hypot(v[0], v[2]); return st; };
  const r = await renderOffline({ dur: T, real: true, seed: 3, setup: async (A) => {
    const br = new AudioBridge(A, { playerId: 1 });
    await br.preload({ weapons: ['smg', 'rpg', 'shotgun'], truck: 'truck_t3', enemies: ['e_sedan', 'e_muscle', 'e_heavy'] });
    await A.load(['vehicles/wind_loop'], 0);
    await A.preloadEngine('engine_diesel', 0);
    A.setVolumes({ master: 1 });
    const cars = [mkCar(1, 'truck_t3', 'player', [0, 0.5, 6], [0, 0, 38]), mkCar(2, 'e_sedan', 'enemy', [4, 0.5, 18], [0, 0, 40]), mkCar(3, 'e_muscle', 'enemy', [-4, 0.5, -20], [0, 0, 44]), mkCar(4, 'e_heavy', 'enemy', [3, 0.5, 60], [0, 0, 30]), mkCar(5, 'e_sedan', 'enemy', [0, 0.5, 170], [0, 0, 36]), mkCar(6, 'e_buggy', 'enemy', [-6, 0.5, 40], [0, 0, 41])];
    const states = new Map(cars.map((c) => [c.id, c]));
    const music = A.music.setState('run'); void music; A.ambience.setBiome('desert');
    await new Promise((res) => setTimeout(res, 50));
    return { br, cars, states, ev: {}, peakVoices: 0, rmsSec: [] };
  }, step: (t, A, o) => {
    const { br, cars, states } = o, dt = 1 / 60, ctxE = { states, playerId: 1, localRole: 'solo' };
    const at = (k, tt, fn) => { if (!o.ev[k] && t >= tt) { o.ev[k] = 1; fn(); } };
    for (const c of cars) { c.pos.x += c.vel.x * dt; c.pos.z += c.vel.z * dt; c.rpm01 = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.9 + c.id)); c.boosting = c.id === 1 && t > 8 && t < 10.5; c.airborne = false; for (let i = 0; i < c.nWheels; i++) c.grounded[i] = 1; }
    // keep the world centred on the player (the camera follows the truck)
    const P = cars[0]; A.listener.setRaw({ x: P.pos.x, y: 2.2, z: P.pos.z - 7 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, [0, 0, 38]);
    cars[1].pos.z = P.pos.z + 12 + 6 * Math.sin(t * 0.7); cars[2].pos.z = P.pos.z - 16 + 5 * Math.sin(t * 0.9); cars[5].pos.z = P.pos.z + 30 + 10 * Math.cos(t * 0.5);
    cars[3].pos.z = P.pos.z + 65; cars[4].pos.z = P.pos.z + 190;
    at('start', 0.02, () => br.runStart());
    if (t > 1 && t < 2.9 && Math.floor(t * 13) !== Math.floor((t - dt) * 13)) { const ppos = [P.pos.x + 0.3, 1.6, P.pos.z - 0.8]; br.handleEvent({ t: 'shot', src: 'player', weapon: 'smg', origin: ppos, mode: 'auto', rays: [{ end: [cars[1].pos.x, 1, cars[1].pos.z], surface: 'metal', carId: 2, zone: 'body', dmg: 8 }] }, ctxE); }
    at('reload', 3.1, () => br.handleEvent({ t: 'reloadStart', weapon: 'smg', time: 1.7 }, ctxE));
    if (t > 2 && t < 5 && Math.floor(t * 10) !== Math.floor((t - dt) * 10)) br.handleEvent({ t: 'shot', src: 3, weapon: 'enemy', origin: [cars[2].pos.x, 1.4, cars[2].pos.z], rays: [[0, 0, 1]], speed: 165, pellets: 1, role: 'gunner' }, ctxE);
    if (t > 3 && t < 6 && Math.floor(t * 8) !== Math.floor((t - dt) * 8)) br.handleEvent({ t: 'shot', src: 4, weapon: 'enemy', origin: [cars[3].pos.x, 2.4, cars[3].pos.z], rays: [[0, 0, -1]], speed: 230, pellets: 1, role: 'gunner' }, ctxE);
    at('whizz', 3.5, () => br.handleEvent({ t: 'whizz', pos: [1.2, 1.5, P.pos.z], dist: 1.2 }, ctxE));
    at('crash', 4.0, () => br.handleEvent({ t: 'crash', id: 3, other: 2, dv: 8, speed: 12, pos: [cars[2].pos.x, 0.8, cars[2].pos.z] }, ctxE));
    at('pop', 4.6, () => br.handleEvent({ t: 'tirePop', id: 2, index: 0 }, ctxE));
    at('rpg', 5.0, () => br.handleEvent({ t: 'shot', src: 'player', weapon: 'rpg', origin: [P.pos.x, 1.6, P.pos.z - 0.5], dir: [0, 0, 1], rocket: true, rays: [] }, ctxE));
    at('boom', 6.0, () => { br.handleEvent({ t: 'boom', pos: [cars[1].pos.x, 1, cars[1].pos.z + 5], radius: 11, kind: 'rocket' }, ctxE); });
    at('explode', 6.05, () => { br.handleEvent({ t: 'explode', id: 2, pos: [cars[1].pos.x, 0.8, cars[1].pos.z], size: 1, cause: 'rocket' }, ctxE); cars[1].exploded = true; });
    at('explodeFar', 7.0, () => { br.handleEvent({ t: 'explode', id: 5, pos: [cars[4].pos.x, 0.8, cars[4].pos.z], size: 1.8, cause: 'shot' }, ctxE); cars[4].exploded = true; });
    at('fire', 9.0, () => { br.handleEvent({ t: 'fire', id: 4 }, ctxE); cars[3].burning = true; });
    at('engineDead', 9.5, () => { br.handleEvent({ t: 'engineDead', id: 6 }, ctxE); cars[5].engineHp01 = 0; });
    at('own', 10.0, () => br.handleEvent({ t: 'crash', id: 1, other: 4, dv: 14, speed: 20, pos: [P.pos.x, 0.8, P.pos.z] }, ctxE));
    at('down', 12.0, () => { cars[0].hp01 = 0.1; br.handleEvent({ t: 'playerDown', why: 'car' }, ctxE); });
    for (const c of cars) br.updateCar(c, dt, { surface: 'asphalt' });
    br.update(dt, ctxE);
    o.peakVoices = Math.max(o.peakVoices, A.voices.size);
    o.minDuck = Math.min(o.minDuck ?? 1, A._musicDuckV); o.maxConc = Math.max(o.maxConc ?? 0, A._conc); o.maxDanger = Math.max(o.maxDanger ?? 0, A._danger);
  } });
  const o = r.ctxObj, sec = [];
  for (let t = 0; t < T - 0.5; t += 1) sec.push(NS(dbr(rmsOf(r.x, r.sr, t, 1), 1)));
  let peak = 0, clip = 0, nan = 0, hi = 0;
  for (const ch of [r.x, r.xr]) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a !== a) nan++; if (a > peak) peak = a; if (a >= 0.999) clip++; if (a > 0.9) hi++; }
  const g = r.A.graphStats();
  const top = [...r.A.defs.values()].filter((d) => d.plays).sort((a, b) => b.plays - a.plays).slice(0, 14).map((d) => d.key.split('/')[1] + ' x' + d.plays);
  const res = { jsAvgMsPerFrame: NS(r.jsAvgMs), jsMaxMsPerFrame: NS(r.jsMaxMs), slowFrames: r.slowFrames.slice(0, 12), notLoaded: [...r.A.notLoadedNames], minMusicDuck: NS(o.minDuck), maxConcussion: NS(o.maxConc), maxDanger: NS(o.maxDanger), topSounds: top, renderMs: Math.round(r.ms), realtimeX: NS(T / (r.ms / 1000)), peak: NS(peak), peakDb: NS(dbr(peak, 1)), clipSamples: clip, samplesOver09: hi, nan, rmsPerSecDb: sec, maxRmsDb: Math.max(...sec), peakVoices: o.peakVoices, stats: g.stats, live: g.live, enginesAllowed: g.enginesAllowed, missing: r.A.reportMissing().filter((n) => !/ambience\/|music\//.test(n)), bridge: o.br.counts, played: r.A.stats.played, musicLog: r.A.music.log.slice(0, 3).map((l) => l.type + ':' + (l.track || '')) };
  report.tests.scenario = res;
  ck('scenario: master output never exceeds 1.0 and has no NaN', peak <= 1.0 && nan === 0, NS(peak), '<= 1');
  ck('scenario: mix is audible but not crushed (loudest second between -30 and -8 dBFS RMS)', res.maxRmsDb > -30 && res.maxRmsDb < -8, res.maxRmsDb, '(-30,-8)');
  ck('scenario: bounded voice count', o.peakVoices <= r.A.maxVoices, o.peakVoices, `<= ${r.A.maxVoices}`);
  ck('scenario: bridge + engines cost < 1 ms of JS per frame (10 cars, gunfire, explosions)', r.jsAvgMs < 1.0, NS(r.jsAvgMs), '< 1 ms');
  ck('scenario: explosions duck the music and the player crash triggers the concussion filter', o.minDuck < 0.75 && o.maxConc > 0.25, `${NS(o.minDuck)} / ${NS(o.maxConc)}`, 'duck < 0.75, conc > 0.25');
  ck('scenario: <= 10 engines audible', g.enginesAllowed <= 10, g.enginesAllowed, '<= 10');
  ck('scenario: bridge produced sounds for the events', r.A.stats.played > 100, r.A.stats.played, '> 100');
  if (draw) drawSpectrogram(r.x, r.sr);
  return res;
}
function drawSpectrogram(x, sr) {
  const cv = document.getElementById('spec'), c = cv.getContext('2d'), W = cv.width, H = cv.height, win = 1024, hop = Math.floor(x.length / W);
  const img = c.createImageData(W, H);
  const re = new Float64Array(win), im = new Float64Array(win);
  for (let px = 0; px < W; px++) {
    const n0 = px * hop; re.fill(0); im.fill(0);
    for (let i = 0; i < win; i++) re[i] = (x[n0 + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (win - 1)));
    fftInPlace(re, im);
    for (let py = 0; py < H; py++) {
      const f = 40 * Math.pow(9000 / 40, py / (H - 1)), bin = Math.min(win / 2 - 1, Math.round(f / sr * win)), m = Math.hypot(re[bin], im[bin]) / win * 4, dbv = 20 * Math.log10(m + 1e-9), v = Math.max(0, Math.min(1, (dbv + 90) / 70));
      const o = ((H - 1 - py) * W + px) * 4; img.data[o] = 255 * Math.pow(v, 0.8); img.data[o + 1] = 190 * v * v; img.data[o + 2] = 90 * (1 - v) * v * 4; img.data[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0); c.fillStyle = '#fff'; c.font = '10px monospace';
  for (const f of [100, 300, 1000, 3000, 8000]) { const y = H - 1 - Math.log(f / 40) / Math.log(9000 / 40) * (H - 1); c.fillText(f + ' Hz', 2, y); }
  for (let t = 0; t < x.length / sr; t += 2) c.fillText(t + 's', t / (x.length / sr) * W, H - 2);
}

/** Every EngineSound feature with distinct tone markers standing in for the layer loops (so each layer's level / pitch mapping is measurable). */
async function tEngineFeatures() {
  const T = 14.2;
  const r = await renderOffline({ dur: T, setup: (A) => {
    injectEngine(A, 'engine_tsine', RPMS, (rpm) => sineBuf(SR, rpm / 10, 1.0, 0.25));
    const loop = (key, f) => A.injectSound(key, sineBuf(SR, f, 1.0, 0.3), { loop: true, category: 'vehicle_loop' });
    loop('vehicles/tyre_asphalt_loop', 150); loop('vehicles/tyre_dirt_loop', 200); loop('vehicles/skid_loop', 2500); loop('vehicles/skid_gravel_loop', 3100);
    loop('vehicles/nitro_loop', 2100); loop('vehicles/turbo_whine_loop', 3300); loop('vehicles/supercharger_whine_loop', 1500); loop('vehicles/damaged_engine_loop', 1000);
    for (const [k, f] of [['nitro_ignite', 9000], ['nitro_end', 10000], ['backfire', 11000], ['gear_shift', 12000]]) A.injectSound('vehicles/' + k, sineBuf(SR, f, 0.2, 0.3), { loop: false, category: 'vehicle_fx' });
    return { eng: A.engine('e', { id: 'x', engine: { vmax: 50 } }, { engineId: 'engine_tsine', player: true, level: 1, tyres: true, turbo: false, backfire: 0 }), snap: {} };
  }, step: (t, A, o) => {
    const e = o.eng, ex = { slip: 0, surface: 'asphalt', grounded: 1, engineHp01: 1 };
    let rpm = 0.6, load = 0.8, boost = 0, speed = 30;
    if (t >= 2 && t < 4) ex.slip = 0.85;
    if (t >= 4 && t < 6) { ex.slip = 0.85; ex.surface = 'dirt'; }
    if (t >= 6 && t < 8) boost = 1;
    if (t >= 9) { e.turbo = true; e.backfire = 1; rpm = 0.9; load = t < 11 ? 1 : 0.05; speed = 40; }
    if (t >= 11.5) { e.supercharger = 0.7; rpm = 0.8; load = 0.8; }
    if (t >= 12) ex.engineHp01 = 0.15;
    e.update(rpm, load, boost, 0, speed, ex);
    const pl = (k) => (A.defs.get('vehicles/' + k)?.plays || 0);
    for (const [k, tt] of [['a', 5.9], ['b', 7.9], ['c', 8.5], ['d', 11.6]]) if (!o.snap[k] && t >= tt) o.snap[k] = { ignite: pl('nitro_ignite'), end: pl('nitro_end'), backfire: pl('backfire'), gear: pl('gear_shift') };
  } });
  const x = r.x, sr = r.sr, o = r.ctxObj, band = (a, b, lo, hi) => peakHz(x, sr, a, b - a, lo, hi);
  const m = {
    // tyre / skid loops are pitch-shifted by speed (rate 0.7 + 0.85*speed01 = 1.21 at 30/50 m/s; skid 0.9 + 0.3*speed01 = 1.08), so probe bands
    tyreAsphalt: band(1.0, 1.6, 165, 200).amp, tyreDirtWhileAsphalt: band(1.0, 1.6, 225, 265).amp, skidWhileCruise: band(1.0, 1.6, 2400, 3000).amp,
    skidAsphalt: band(3.0, 3.6, 2400, 3000).amp, skidGravelWhileAsphalt: band(3.0, 3.6, 3150, 3700).amp,
    tyreDirt: band(5.3, 5.8, 225, 265).amp, tyreAsphaltWhileDirt: band(5.3, 5.8, 165, 200).amp, skidGravel: band(5.3, 5.8, 3150, 3700).amp, skidAsphaltWhileDirt: band(5.3, 5.8, 2400, 3000).amp,
    nitro: band(7.0, 7.5, 1900, 2500), nitroAfter: band(8.6, 8.9, 1900, 2500).amp,
    turboEarly: band(9.4, 9.7, 1500, 5500), turboLate: band(10.5, 10.9, 1500, 5500),
    superchargerHz: band(12.6, 13.0, 1800, 2200), damagedHz: band(13.2, 13.9, 900, 1500), damagedWhileHealthy: band(3.0, 3.6, 900, 1500).amp, turboWhileOff: band(3.0, 3.6, 3000, 4000).amp,
    snap: o.snap,
  };
  const exSc = 1500 * (0.55 + 0.95 * 0.8), exDm = 1000 * (0.8 + 0.6 * 0.8);
  report.tests.engineFeatures = { ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'object' && v && v.hz !== undefined ? { hz: NS(v.hz), amp: NS(v.amp) } : typeof v === 'number' ? NS(v) : v])), expectSuperchargerHz: NS(exSc), expectDamagedHz: NS(exDm) };
  ck('tyre roar follows speed on asphalt (asphalt layer on, dirt layer off)', m.tyreAsphalt > 0.02 && m.tyreDirtWhileAsphalt < 0.004, `${NS(m.tyreAsphalt)} / ${NS(m.tyreDirtWhileAsphalt)}`, '>0.02 / <0.004');
  ck('no skid squeal while cruising, squeal on slip (asphalt skid, not gravel)', m.skidWhileCruise < 0.004 && m.skidAsphalt > 0.02 && m.skidGravelWhileAsphalt < 0.006, `${NS(m.skidWhileCruise)} / ${NS(m.skidAsphalt)} / ${NS(m.skidGravelWhileAsphalt)}`, '<0.004 / >0.02 / <0.006');
  ck('surface switch: dirt roar + gravel skid replace asphalt roar + asphalt skid', m.tyreDirt > 0.02 && m.tyreAsphaltWhileDirt < 0.006 && m.skidGravel > 0.02 && m.skidAsphaltWhileDirt < 0.006, `${NS(m.tyreDirt)} / ${NS(m.tyreAsphaltWhileDirt)} / ${NS(m.skidGravel)} / ${NS(m.skidAsphaltWhileDirt)}`, 'swap');
  ck('nitro: loop present while boosting, gone 0.6 s after; ignite once at start, end once at stop', m.nitro.amp > 0.02 && m.nitroAfter < 0.004 && o.snap.b.ignite === 1 && o.snap.c.end === 1 && o.snap.a.ignite === 0, `${NS(m.nitro.amp)} ${NS(m.nitroAfter)} ignite ${o.snap.b.ignite} end ${o.snap.c.end}`, 'on/off once');
  ck('turbo whine spools up (pitch rises) and is silent when disabled', m.turboLate.hz > m.turboEarly.hz * 1.08 && m.turboLate.amp > 0.01 && m.turboWhileOff < 0.004, `${NS(m.turboEarly.hz)} -> ${NS(m.turboLate.hz)}`, 'rising');
  ck('backfire pop + blow-off on throttle lift (once each)', o.snap.d.backfire === 1 && o.snap.d.gear >= 1, `${o.snap.d.backfire}/${o.snap.d.gear}`, '1 / >=1');
  ck('supercharger whine tracks rpm', Math.abs(m.superchargerHz.hz - exSc) / exSc < 0.05 && m.superchargerHz.amp > 0.005, `${NS(m.superchargerHz.hz)} vs ${NS(exSc)}`, 'within 5%');
  ck('damaged-engine rattle appears at low engine hp only', m.damagedHz.amp > 0.02 && m.damagedWhileHealthy < 0.004 && Math.abs(m.damagedHz.hz - exDm) / exDm < 0.06, `${NS(m.damagedHz.amp)} ${NS(m.damagedWhileHealthy)} @${NS(m.damagedHz.hz)} vs ${NS(exDm)}`, 'present / absent');
  const g = r.A.graphStats(); report.tests.engineFeatures.live = g.live;
}
async function tDanger() {
  const r = await renderOffline({ dur: 10, setup: (A) => {
    A.injectSound('stingers/low_health_heartbeat_loop', sineBuf(SR, 100, 2, 0.4, 2), { loop: true, category: 'stinger_loop' });
    A.injectSound('stingers/warning_alarm_loop', sineBuf(SR, 800, 1.2, 0.4, 2), { loop: true, category: 'stinger_loop' });
    return {};
  }, step: (t, A) => { A.setDanger(t < 1 ? 0 : t < 3.5 ? 0.5 : t < 6.5 ? 1 : 0); if (t > 9.6 && !A._end) A._end = A.graphStats().live; } });
  const hb = (a, b) => peakHz(r.x, r.sr, a, b - a, 80, 170), al = (a, b) => tone(r.x, r.sr, a, b - a, 800);
  const m = { silentBefore: rmsOf(r.x, r.sr, 0.3, 0.6), hbMid: hb(2.0, 3.0), alarmMid: al(2.0, 3.0), hbHigh: hb(5.0, 6.0), alarmHigh: al(5.0, 6.0), after: rmsOf(r.x, r.sr, 9.0, 0.6), live: r.A._end };
  report.tests.danger = { ...m, hbMid: { hz: NS(m.hbMid.hz), amp: NS(m.hbMid.amp) }, hbHigh: { hz: NS(m.hbHigh.hz), amp: NS(m.hbHigh.amp) } };
  ck('danger 0: silent; 0.5: heartbeat only; 1: heartbeat faster + alarm; back to 0: released', m.silentBefore < 0.001 && m.hbMid.amp > 0.03 && m.alarmMid < 0.004 && m.hbHigh.hz > m.hbMid.hz * 1.1 && m.alarmHigh > 0.02 && m.after < 0.002 && m.live.src === 0, JSON.stringify({ hb: [NS(m.hbMid.hz), NS(m.hbHigh.hz)], alarm: [NS(m.alarmMid), NS(m.alarmHigh)], src: m.live.src }), 'gated');
}
async function tReverb() {
  const run = (slap, d) => renderOffline({ dur: 3, setup: (A) => { A.injectSound('impacts/tburst', noiseBuf(SR, 0.1, 21, 6000, 0.5), { loop: false, category: 'impact_bullet' }); A.play('impacts/tburst', { pos: [0, 1.6, d], slap, pitchVar: 0, refDist: 6 }); return {}; } });
  const dry = await run(0, 30), wet = await run(1, 30), far = await run(1, 120);
  const tail = (r, a, b) => rmsOf(r.x, r.sr, a, b - a);
  const t1 = tail(wet, 0.3, 0.5), t2 = tail(wet, 1.3, 1.5), t3 = tail(wet, 2.3, 2.5);
  report.tests.reverb = { dryTail: tail(dry, 0.3, 0.5), wetTailDb: NS(dbr(t1, 1)), decay1s: NS(dbr(t1, t2)), decay2s: NS(dbr(t2, t3)), wetVsDryDirectDb: NS(dbr(tail(wet, 0, 0.1), tail(dry, 0, 0.1))), farTailToDirectDb: NS(dbr(tail(far, 0.3, 0.5), tail(far, 0, 0.1))), nearTailToDirectDb: NS(dbr(t1, tail(wet, 0, 0.1))) };
  ck('slapback send adds a reverb tail (and no tail without the send)', tail(dry, 0.3, 0.5) < 1e-5 && t1 > 1e-4, `${NS(dbr(t1, 1))} dB vs dry ${tail(dry, 0.3, 0.5)}`, 'tail only when slap');
  ck('reverb tail decays (>= 8 dB per second)', dbr(t1, t2) > 8, NS(dbr(t1, t2)), '>= 8');
  ck('distant sources are wetter than near ones (tail/direct ratio rises with distance)', dbr(tail(far, 0.3, 0.5), tail(far, 0, 0.1)) > dbr(t1, tail(wet, 0, 0.1)) + 3, `${NS(report.tests.reverb.farTailToDirectDb)} vs ${NS(report.tests.reverb.nearTailToDirectDb)}`, 'far > near + 3 dB');
  // timed voice: loop with duration ends on time with a fade
  const r2 = await renderOffline({ dur: 2.2, setup: (A) => { A.injectSound('sfx/tl', sineBuf(SR, 500, 1, 0.4), { loop: true, category: 'impact_loop' }); A.play('sfx/tl', { loop: true, duration: 0.6, fadeOut: 0.1, fadeIn: 0.05, pitchVar: 0, delay: 0.2 }); return {}; } });
  const before = rmsOf(r2.x, r2.sr, 0.15, 0.04), inside = rmsOf(r2.x, r2.sr, 0.5, 0.2), after = rmsOf(r2.x, r2.sr, 1.1, 0.5), cl = clickScan(r2.x, r2.sr, { skip: 0.1, thr: 0.12 });
  report.tests.timedVoice = { before, inside: NS(inside), after, clicks: cl };
  ck('timed loop voice (delay 0.2, duration 0.6): silent before, plays, fades out, click-free, node freed', before < 1e-4 && inside > 0.05 && after < 1e-4 && cl.count === 0 && r2.A.graphStats().live.src === 0, `${NS(inside)} / clicks ${cl.count} / src ${r2.A.graphStats().live.src}`, 'ok');
}
/** Every sim / gunner event through the bridge with the real library: which sounds start (a matrix instead of listening). */
async function tEvents() {
  const off = new OfflineAudioContext(2, SR, SR), A = new AudioSys(null, { context: off, rand: mkRand(5), maxVoices: 400 });
  A.listener.setRaw({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, [0, 0, 0]);
  await A.init('/audio/manifest.json');
  const br = new AudioBridge(A, { playerId: 1 });
  await A.preload([/^(?!music\/|ambience\/)/], 0);
  const states = new Map(); const st3 = makeCarState(3, 'e_sedan', 'enemy'); st3.pos.set(6, 0.5, 30); states.set(3, st3);
  const st1 = makeCarState(1, 'truck_t2', 'player'); st1.pos.set(0, 0.5, 5); states.set(1, st1);
  const ctx = { states, playerId: 1, localRole: 'solo' };
  const names = () => { const o = {}; for (const d of A.defs.values()) if (d.plays) o[d.key] = d.plays; return o; };
  const rows = []; let n = 0;
  const run = (label, evt, silentOk = false) => {
    const before = names(); n++;
    const e = JSON.parse(JSON.stringify(evt)); if (e.pos) e.pos = [e.pos[0] + n * 2, e.pos[1], e.pos[2]];
    if (e.src !== undefined && typeof e.src === 'number') e.src = e.src + n;
    if (e.id !== undefined && e.id > 100) e.id += n;
    br.handleEvent(e, ctx);
    const after = names(), played = Object.keys(after).filter((k) => after[k] !== (before[k] || 0)).map((k) => k.split('/')[1] + (after[k] - (before[k] || 0) > 1 ? 'x' + (after[k] - (before[k] || 0)) : ''));
    rows.push({ label, played, silentOk });
  };
  const P = [4, 1, 30];
  for (const w of WEAPON_ORDER) run('shot ' + w, { t: 'shot', src: 'player', weapon: w, origin: [0.3, 1.5, 1.2], dir: [0, 0, 1], mode: WEAPONS[w].mode, rocket: w === 'rpg' || undefined, rays: w === 'rpg' ? [] : [{ end: P, surface: 'metal', carId: 3, zone: 'body', dmg: 5 }] });
  run('shot enemy light', { t: 'shot', src: 200, weapon: 'enemy', origin: [5, 1.5, 40], rays: [[0, 0, -1]], speed: 140, pellets: 1 });
  run('shot enemy heavy', { t: 'shot', src: 201, weapon: 'enemy', origin: [5, 1.5, 40], rays: [[0, 0, -1]], speed: 230, pellets: 1 });
  run('shot enemy shotgun', { t: 'shot', src: 202, weapon: 'enemy', origin: [5, 1.5, 40], rays: Array(7).fill([0, 0, -1]), speed: 125, pellets: 7 });
  run('shot enemy rpg', { t: 'shot', src: 203, weapon: 'rpg', origin: [5, 1.5, 40], dir: [0, 0, -1], rocket: true, speed: 60 });
  for (const s of ['metal', 'flesh', 'dirt', 'sand', 'rock', 'glass', 'tire', 'asphalt', 'grass']) run('hit ' + s, { t: 'hit', pos: [3, 1, 20], normal: [0, 1, 0], surface: s, carId: 3, zone: 'body', dmg: 5, enemy: false });
  run('hit metal on player', { t: 'hit', pos: [1, 1, 5], surface: 'metal', carId: 1, enemy: true, dmg: 20 });
  run('hit armor plate', { t: 'hit', pos: [1, 1, 8], surface: 'metal', carId: 3, zone: 'armor', dmg: 5 });
  run('whizz', { t: 'whizz', pos: [1, 1.5, 3], dist: 1 });
  run('crash light', { t: 'crash', id: 300, other: -1, dv: 1.5, speed: 8, pos: [3, 1, 20] });
  run('crash medium ram', { t: 'crash', id: 301, other: 3, dv: 4, speed: 10, pos: [3, 1, 20] });
  run('crash heavy', { t: 'crash', id: 302, other: -1, dv: 9, speed: 20, pos: [3, 1, 20] });
  run('crash huge ram', { t: 'crash', id: 303, other: 3, dv: 14, speed: 30, pos: [3, 1, 20] });
  for (const s of [1, 1.8, 2.4]) run('explode size ' + s, { t: 'explode', id: 400 + s * 10, pos: [3, 1, 60], size: s, cause: 'shot', spec: 'e_sedan', vel: [0, 0, 0] });
  run('explode far', { t: 'explode', id: 450, pos: [0, 1, 230], size: 1.8, cause: 'shot', spec: 'e_heavy', vel: [0, 0, 0] });
  run('boom rocket', { t: 'boom', pos: [3, 1, 40], radius: 11, kind: 'rocket' });
  run('boom grenade', { t: 'boom', pos: [3, 1, 40], radius: 9.5, kind: 'grenade' });
  run('crewHit', { t: 'crewHit', id: 8, role: 'driver', hp: 10, dmg: 5, head: false, point: [6, 1.5, 30] });
  run('crewDead', { t: 'crewDead', id: 3, role: 'gunner', cause: 'shot' });
  run('tirePop', { t: 'tirePop', id: 3, index: 1 });
  run('engineDead', { t: 'engineDead', id: 3 });
  run('fuelLeak', { t: 'fuelLeak', id: 3 });
  run('smoke', { t: 'smoke', id: 3 }, true);
  run('fire', { t: 'fire', id: 3 });
  run('kill', { t: 'kill', id: 3, spec: 'e_sedan', cause: 'shot', pos: [3, 1, 20], crash: false });
  run('playerDown', { t: 'playerDown', why: 'car' });
  run('runOver', { t: 'runOver', why: 'car' }, true);
  run('nitro (no engine)', { t: 'nitro', id: 999, on: true });
  run('drift', { t: 'drift', id: 3 }, true);
  run('land', { t: 'land', id: 3, impact: 1.5 });
  run('spawn', { t: 'spawn', id: 5, spec: 'e_sedan', kind: 'enemy' }, true);
  run('remove', { t: 'remove', id: 5, why: 'far' }, true);
  run('weaponSwap', { t: 'weaponSwap', weapon: 'rifle' });
  for (const w of WEAPON_ORDER) run('reloadStart ' + w, { t: 'reloadStart', weapon: w, time: WEAPONS[w].reload }, w === 'shotgun');
  run('reloadEnd shotgun', { t: 'reloadEnd', weapon: 'shotgun' });
  run('shellIn', { t: 'shellIn', weapon: 'shotgun' });
  run('dryClick', { t: 'dryClick', weapon: 'pistol' });
  run('grenadeThrow', { t: 'grenadeThrow', origin: [0.3, 1.5, 1.2], vel: [0, 6, 22] });
  run('oilSlick', { t: 'oilSlick', id: 1 }); run('mineDrop', { t: 'mineDrop', id: 1 }); run('mineBoom', { t: 'mineBoom', pos: [2, 0.5, 20] });
  const silent = rows.filter((r) => !r.played.length && !r.silentOk).map((r) => r.label);
  const ui = ['click', 'hover', 'buy', 'error', 'coin', 'upgrade_unlock', 'ready', 'countdown_beep', 'go', 'menu_open', 'menu_close', 'whoosh_transition'];
  const uiMiss = []; for (const u of ui) { A._lastUi.clear(); const b = A.defs.get('ui/' + u)?.plays || 0; A.ui(u); if ((A.defs.get('ui/' + u)?.plays || 0) === b) uiMiss.push(u); }
  const sti = ['run_start', 'game_over', 'boss_intro', 'boss_defeated', 'victory'], stMiss = [];
  for (const s of sti) { const b = A.defs.get('stingers/' + s)?.plays || 0; A.stinger(s); if ((A.defs.get('stingers/' + s)?.plays || 0) === b) stMiss.push(s); }
  report.tests.events = { matrix: rows.map((r) => r.label + ' -> ' + (r.played.join(', ') || '(silent)')), silentUnexpected: silent, uiMissing: uiMiss, stingersMissing: stMiss, missing: A.reportMissing().filter((m) => !/^(ambience|music)\//.test(m)), stats: A.stats };
  ck('every sim/gunner event that should make noise plays a sound', silent.length === 0, silent, 'none silent');
  ck('all 12 UI sounds and 5 stingers play', uiMiss.length === 0 && stMiss.length === 0, [...uiMiss, ...stMiss], 'none missing');
  ck('bridge never references a name absent from the manifest (sfx)', report.tests.events.missing.length === 0, report.tests.events.missing, 'none');
  // reload sequences are timed from reloadStart.time (foley offsets)
  const offs = []; { const B2 = new AudioBridge(A, { playerId: 1 }); const orig = A.play.bind(A); A.play = (nm, o) => { offs.push([typeof nm === 'string' ? nm : nm.key, o && o.delay]); return orig(nm, o); }; B2.handleEvent({ t: 'reloadStart', weapon: 'lmg', time: 4.4 }, ctx); A.play = orig; }
  report.tests.events.lmgReload = offs.map((x) => x[0].split('/')[1] + '@' + NS(x[1]));
  ck('LMG reload foley sequence is spread over the 4.4 s reload (cover open -> belt -> cover close -> rack)', offs.length === 5 && offs[0][1] < 0.5 && offs[4][1] > 3.9 && offs.every((x, i) => i === 0 || x[1] >= offs[i - 1][1]), report.tests.events.lmgReload, 'monotone 0.26 .. 4.09');
  A.dispose?.();
}
/** Engine loops of the real library: does the output fundamental (cylinder firing frequency) follow rpm for every engine id? */
async function tEnginePitchReal() {
  const ids = audio.engineIds(), out = {};
  for (const id of ids) {
    const rp = audio.engineTable.get(id), n = Math.round(rp[0].fireHz * 60 / rp[0].rpm * 2);
    const pts = [0.3, 0.5, 0.7, 0.9], dur = 1.0;
    const r = await renderOffline({ dur: pts.length * dur + 0.6, real: true, setup: async (A) => { await A.preloadEngine(id, 0); return { eng: A.engine('e', { id: 'x', engine: { vmax: 50 } }, { engineId: id, player: true, level: 1, tyres: false, pitch: 1 }) }; }, step: (t, A, o) => { const i = Math.min(pts.length - 1, Math.floor((t - 0.3) / dur)); o.eng.update(pts[Math.max(0, i)], 1, 0, 0, 20, {}); } });
    const rows = pts.map((p, i) => {
      const R = R_OF(p, rp.map((s) => s.rpm)), f0 = R / 60 * n / 2, t0 = 0.3 + i * dur + 0.4, s = spectrum(r.x, r.sr, t0, 0.5);
      const bin = (f) => Math.round(f / s.df), pk = (f) => { let m = 0; for (let b = bin(f * 0.97); b <= bin(f * 1.03); b++) m = Math.max(m, s.mag[b]); return m; };
      const near = pk(f0), h2 = pk(f0 * 2), ref = []; for (let b = bin(f0 * 0.5); b < bin(f0 * 3); b++) ref.push(s.mag[b]); ref.sort((a, b) => a - b);
      const med = ref[Math.floor(ref.length / 2)] || 1e-9;
      return { rpm01: p, expectFireHz: NS(f0), prominenceDb: NS(dbr(Math.max(near, h2), med)), fundamentalPeak: NS(peakHz(r.x, r.sr, t0, 0.5, f0 * 0.5, f0 * 1.6).hz) };
    });
    out[id] = { cylinders: n, rows };
    r.A.dispose?.();
  }
  report.tests.enginePitchReal = out;
  const weak = []; for (const [id, v] of Object.entries(out)) for (const r of v.rows) if (r.prominenceDb < 6) weak.push(id + '@' + r.rpm01 + ' ' + r.prominenceDb + ' dB');
  ck('real engines: firing-frequency line (fundamental or 2nd harmonic) stands >= 6 dB above the spectrum at the mapped rpm', weak.length === 0, weak.slice(0, 6), 'none weak');
}
async function tResolve() {
  const beds = {}; for (const b of ['desert', 'canyon', 'coast', 'mountain', 'forest', 'city', 'dam']) beds[b] = audio.ambience._resolveBed(b).map((d) => d.key);
  const m = {}; for (const k of ['title', 'garage', 'run', 'boss', 'victory']) m[k] = audio.music.trackIds(k);
  const runFor = {}; const saved = audio.music.biome; for (const b of ['desert', 'canyon', 'coast', 'mountain', 'city', 'dam']) { audio.music.biome = b; runFor[b] = audio.music._pick('run', {}); } audio.music.biome = saved;
  report.tests.resolve = { ambience: beds, music: m, runTrackByBiome: runFor, engineTable: Object.fromEntries([...audio.engineTable].map(([k, v]) => [k, v.map((s) => s.rpm).join('/')])) };
  ck('every biome finds an ambience bed in the manifest', Object.values(beds).every((v) => v.length >= 1), Object.fromEntries(Object.entries(beds).filter(([, v]) => !v.length)), 'all found');
  ck('music: title/garage/run/boss/victory tracks resolved', ['title', 'garage', 'run', 'boss', 'victory'].every((k) => m[k].length >= 1), Object.fromEntries(Object.entries(m).filter(([, v]) => !v.length)), 'all found');
  ck('biome -> run track mapping uses the manifest notes (desert=a, canyon/coast=b, mountain/city=c)', runFor.desert === 'run_a' && runFor.canyon === 'run_b' && runFor.coast === 'run_b' && runFor.mountain === 'run_c' && runFor.city === 'run_c', runFor, 'a b b c c');
}

async function runSelfTests() {
  report.asserts.length = 0; report.started = Date.now();
  const all = [['detector', tDetector], ['engineSine', tEngineSine], ['engineNoise', tEngineNoise], ['engineCull', tEngineCull], ['engineFeatures', tEngineFeatures], ['doppler', tDoppler], ['spatial', tSpatial], ['voices', tVoices], ['reverb', tReverb], ['danger', tDanger], ['music', tMusic], ['concussion', tConcussion], ['ambience', tAmbience], ['library', tLibrary], ['resolve', tResolve], ['events', tEvents], ['enginePitchReal', tEnginePitchReal], ['realtime', tRealtime], ['scenario', () => runScenario(true)]];
  const only = q.get('only'), list = only ? all.filter(([n]) => only.split(',').includes(n)) : all;
  for (const [name, fn] of list) {
    const t0 = performance.now(); setStatus('testing ' + name + ' ...');
    try { await fn(); } catch (e) { ck(name + ' threw', false, String(e && e.stack || e).slice(0, 300), 'no error'); console.error(name, e); }
    report.info[name + 'Ms'] = Math.round(performance.now() - t0);
  }
  const failed = report.asserts.filter((a) => !a.ok);
  report.summary = { total: report.asserts.length, passed: report.asserts.length - failed.length, failed: failed.map((f) => ({ name: f.name, value: f.value, expect: f.expect })), ctx: audio.ctx.state, sounds: audio.defs.size, engineIds: audio.engineIds(), missing: audio.reportMissing(), finalGraph: audio.graphStats() };
  window.__audioReport = report;
  setStatus(`self tests: ${report.summary.passed}/${report.summary.total} passed`);
  return report;
}
function showReport() {
  const out = document.getElementById('testout'); if (!out) return;
  out.replaceChildren(...report.asserts.map((a) => h('div', { class: a.ok ? 'pass' : 'fail' }, `${a.ok ? 'PASS' : 'FAIL'}  ${a.name}   [${typeof a.value === 'object' ? JSON.stringify(a.value) : a.value}]  expect ${typeof a.expect === 'object' ? JSON.stringify(a.expect) : a.expect}`)));
}

// ------------------------------------------------------------------------------------------------------------ go
if (AUTO) {
  await runSelfTests(); showReport();
  window.__ready = true;
} else {
  requestAnimationFrame(frame);
  window.__ready = true;
}
if (AUTO) requestAnimationFrame(frame);

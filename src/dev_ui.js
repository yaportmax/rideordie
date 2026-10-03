// UI dev page: /ui.html?screen=garage&tab=weapons&pad=1
//   screen = title | join | lobby | garage | results | pause | settings | controls | toast | modal
//   tab = truck|upgrades|weapons|gunner|paint (garage)   select = item id to select   cash = fake cash   pad = 1|ps (fake gamepad, glyphs + focus ring)
//   victory=1 (results)  lobby = empty|waiting|seated|ready|lost   role = driver|gunner|solo (controls)   bg = 3d|none   log=1 (on-screen callback log)
//   window.__pad.tap('down'|'a'|'b'|'lb'|'rb'|'x'|'y'|'start', frames) simulates the gamepad; window.__ui / __profile / __log for probes.
import * as THREE from 'three';
import { Ui } from './ui/ui.js';
import { Input } from './core/input.js';
import * as Assets from './core/assets.js';
import { CarView } from './view/car_view.js';
import { VEHICLES, vehicleModelURL } from './data/vehicles.js';
import { DEFAULT_PROFILE, TRUCK_COLORS, TRUCKS, effectiveUpgrades } from './data/upgrades.js';
import { familyOf } from './data/vehicle_families.js';
import { buyTruck, buyUpgrade, buyWeapon, buyWeaponTrack, equipWeapon, selectTruck } from './meta/profile.js';

const q = new URLSearchParams(location.search);
const screenName = q.get('screen') || 'garage';
const log = window.__log = [];
const logEl = document.getElementById('devlog');
const say = (...a) => { const s = a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '); log.push(s); if (q.has('log')) { logEl.textContent = log.slice(-14).join('\n'); } console.log('[cb]', s); };

// ---------------------------------------------------------------- fake gamepad
const fakePad = { id: q.get('pad') === 'ps' ? 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)' : 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
const PADN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 };
if (q.has('pad')) navigator.getGamepads = () => [fakePad];
const setBtn = (n, v) => { fakePad.buttons[PADN[n]] = { pressed: v, value: v ? 1 : 0 }; };
window.__pad = {
  press: (n) => setBtn(n, true), release: (n) => setBtn(n, false),
  tap: (n, frames = 3) => new Promise((res) => { const raf = (k, f) => (k <= 0 ? f() : requestAnimationFrame(() => raf(k - 1, f))); setBtn(n, true); raf(frames, () => { setBtn(n, false); raf(2, res); }); }),
  axes: (x, y) => { fakePad.axes[0] = x; fakePad.axes[1] = y; },
  seq: async (list) => { for (const n of list) await window.__pad.tap(n); },
};

// ---------------------------------------------------------------- 3D backdrop (the integrator supplies the real garage view)
const canvasForInput = document.createElement('canvas');
const input = new Input(canvasForInput);
if (q.has('pad')) input.lastDevice = 'pad';
let profile = makeProfile();
let view3d = null;
if (q.get('bg') !== 'none') view3d = await make3d();

function makeProfile() {
  const p = DEFAULT_PROFILE();
  p.campaignId = 'devprofile'; p.cash = +(q.get('cash') ?? 12450); p.runs = 6; p.best = { distance: 31200, time: 1080, kills: 88 };
  p.trucks = ['player_sedan_t1', 'truck_t1', 'truck_t2']; p.truck = VEHICLES[q.get('truck')]?.kind === 'player' ? q.get('truck') : 'truck_t2';
  if (!p.trucks.includes(p.truck)) p.trucks.push(p.truck);
  p.vehicleUpgrades[familyOf(p.truck)] = { engine: 2, armor: 1, tires: 3, nitro: 1, ram: 1 };
  p.upgrades = { grenades: 2, scavenger: 1, medkit: 1 };
  p.weapons = { pistol: { dmg: 1, mag: 0, rel: 2, hnd: 0 }, revolver: { dmg: 0, mag: 0, rel: 0, hnd: 0 }, smg: { dmg: 2, mag: 1, rel: 0, hnd: 1 } };
  p.loadout = ['smg', 'revolver', 'pistol']; p.truckColor = 1; p.wins = 0;
  if (q.get('rich')) { p.cash = 999999; }
  return p;
}

async function make3d() {
  try {
    const canvas = document.createElement('canvas'); canvas.className = 'bg3d'; document.body.insertBefore(canvas, document.getElementById('ui'));
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1a1512); scene.fog = new THREE.Fog(0x1a1512, 14, 34);
    const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 100);
    scene.add(new THREE.HemisphereLight(0xffd9a8, 0x3a2a20, 1.1));
    const key = new THREE.DirectionalLight(0xffc28a, 3.2); key.position.set(5, 8, 4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); scene.add(key);
    const rim = new THREE.DirectionalLight(0x7aa8ff, 1.4); rim.position.set(-6, 3, -5); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    await Assets.preload([...new Set(TRUCKS.map(t => vehicleModelURL(t.id)))]).catch(() => {});
    const st = { renderer, scene, camera, car: null, ang: 0.6 };
    st.rebuild = () => {
      st.car?.dispose();
      const spec = VEHICLES[profile.truck];
      st.car = new CarView(spec, { paint: TRUCK_COLORS[profile.truckColor], upgradeLevels: effectiveUpgrades(profile) });
      scene.add(st.car.root);
    };
    st.rebuild();
    const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
    addEventListener('resize', resize);
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!q.has('still')) st.ang += dt * 0.25;
      const a = st.ang, r = 13.5;
      // truck sits in the middle of the free centre area; camera shifted so it is not covered by side panels
      camera.position.set(Math.sin(a) * r, 3.4, Math.cos(a) * r); camera.lookAt(0, 0.9, 0);
      if (st.car) { st.car.root.position.set(0, 0, 0); }
      renderer.render(scene, camera); requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return st;
  } catch (e) { console.warn('3D backdrop failed', e); return null; }
}

// ---------------------------------------------------------------- Ui + callbacks
const root = document.getElementById('ui');
const ui = window.__ui = new Ui(root, { input, sound: (n) => say('snd:' + n), onSettingsChange: (s, k) => say('setting', k, s[k]) });
window.__profile = profile;
let garageExtra = { solo: q.get('solo') !== '0', ready: false, isHost: true, partner: null, runNo: profile.runs + 1 };
if (q.get('partner')) garageExtra = { ...garageExtra, solo: false, partner: { name: 'RAVEN', ready: q.get('partner') === 'ready', connected: true, role: 'driver' } };

const sync = () => { ui.updateGarage(profile, garageExtra); if (view3d) view3d.rebuild(); };
const garageCb = {
  sound: (n) => say('snd:' + n),
  onBuy: (kind, id, track) => {
    const r = kind === 'truck' ? buyTruck(profile, id) : kind === 'upgrade' ? buyUpgrade(profile, id) : kind === 'weapon' ? buyWeapon(profile, id) : buyWeaponTrack(profile, id, track);
    say('onBuy', kind, id, track || '', JSON.stringify(r)); sync();
  },
  onSelectTruck: (id) => { say('onSelectTruck', id); selectTruck(profile, id); sync(); },
  onPaint: (i) => { say('onPaint', i); profile.truckColor = i; sync(); },
  onEquip: (id, slot) => { say('onEquip', id, slot); equipWeapon(profile, id, slot); sync(); },
  onReady: () => { say('onReady'); garageExtra = { ...garageExtra, ready: !garageExtra.ready }; ui.updateGarage(profile, garageExtra); },
};

function lobbyState(kind) {
  const you = { id: 'a', name: 'MAX', device: input.lastDevice === 'pad' ? 'pad' : 'kbm', seat: null, ready: false, you: true, host: true };
  const other = { id: 'b', name: 'RAVEN', device: 'pad', seat: 'gunner', ready: false, you: false, host: false };
  const s = { code: 'K7QX4M', status: 'waiting', latency: 38, isHost: true, players: [you] };
  if (kind === 'seated') { you.seat = 'driver'; }
  if (kind === 'full') { you.seat = 'driver'; s.status = 'connected'; s.players.push(other); }
  if (kind === 'ready') { you.seat = 'driver'; you.ready = true; other.ready = true; s.status = 'connected'; s.players.push(other); s.canStart = true; }
  if (kind === 'lost') { s.status = 'lost'; }
  return s;
}
const lobbyCb = { sound: (n) => say('snd:' + n), onSeat: (r) => say('onSeat', r), onReady: (r) => say('onReady', r), onStart: () => say('onStart'), onLeave: () => say('onLeave'), onCopy: () => say('onCopy') };

const sampleRun = () => ({
  won: q.has('victory'), cash: 8420, distance: q.has('victory') ? 61200 : 23480, time: q.has('victory') ? 2410 : 812, kills: 41, crashKills: 12, bestStreak: 7, shots: 940, hits: 431,
  cause: q.has('victory') ? 'THE LEVIATHAN HAS BEEN DESTROYED' : 'DRIVER SHOT BY A SKIRMISHER', biome: 'Red Canyon',
  breakdown: [{ label: 'DISTANCE 23.5 KM', amount: 2350 }, { label: 'KILLS x41', amount: 2870 }, { label: 'CRASH KILLS x12', amount: 1800 }, { label: 'STREAK BONUS', amount: 700 }, { label: 'SCAVENGER +10%', amount: 700 }],
});

function show(name) {
  switch (name) {
    case 'title': ui.showTitle({ sound: (n) => say('snd:' + n), onHost: () => say('onHost'), onJoin: (c) => say('onJoin', c), onSolo: () => say('onSolo'), onQuit: q.has('quit') ? () => say('onQuit') : undefined }); break;
    case 'join': ui.showTitle({ sound: (n) => say('snd:' + n), onJoin: (c) => say('onJoin', c) }); ui.screen().showJoin(); break;
    case 'lobby': ui.showLobby(lobbyState(q.get('lobby') || 'waiting'), lobbyCb); break;
    case 'garage': ui.showGarage(profile, garageCb, { ...garageExtra, tab: q.get('tab') || 'truck', select: q.get('select') || undefined }); if (view3d) view3d.rebuild(); break;
    case 'results': ui.showResults(sampleRun(), profile, { sound: (n) => say('snd:' + n), onTick: () => { log.push('tick'); }, onContinue: () => say('onContinue') }); break;
    case 'pause': ui.showPause({ sound: (n) => say('snd:' + n), onResume: () => say('onResume'), onQuit: () => say('onQuit') }); break;
    case 'settings': ui.showSettings(undefined, { onClose: () => say('settings closed') }); break;
    case 'controls': ui.showControls(q.get('role') || 'driver'); break;
    case 'toast': ui.showTitle({}); ui.toast('PARTNER CONNECTED', 'good'); ui.toast('NOT ENOUGH CASH', 'bad'); ui.toast('ROOM CODE COPIED', 'info'); break;
    case 'modal': ui.showTitle({}); ui.connectionLost('The other player left the room or the connection dropped.\nYour progress is saved.'); break;
    default:
  }
}
window.__show = show;
show(screenName);
if (q.get('after')) { /* e.g. after=down,down,a */ }
window.__ready = true;

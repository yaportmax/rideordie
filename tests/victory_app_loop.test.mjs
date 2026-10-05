// Actual App/Game CPU regressions. No renderer, mouse, audio or transport is started.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

const { Run } = await import('../src/game/run.js');
const { Sim, DT } = await import('../src/sim/sim.js');
const { TerrainStreamer } = await import('../src/world/terrain.js');
const { CHUNK_LEN, genTerrainChunk, genRoadChunk, genDrivingBranchChunk } = await import('../src/world/terrain_gen.js');
const { GunnerController } = await import('../src/game/gunner.js');
const { AIGunner } = await import('../src/game/ai_gunner.js');
const { buildPlayerSpec, gunnerLoadout } = await import('../src/game/run_setup.js');
const { DEFAULT_PROFILE } = await import('../src/data/upgrades.js');
const { TEN_LEVELS } = await import('../src/data/campaign.js');
const { makeCarState, stateFromCar } = await import('../src/view/car_state.js');
const { verifiedBossClear, celebrationActive } = await import('../src/sim/victory_presentation.js');
const { rememberDefeat, isDefeated, canCaptureRun, victoryPresenting } = await import('../src/game/run_status.js');
const { Game } = await import('../src/game/game.js');
const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let App, BaselineApp;
try {
  ({ App } = await import('../src/app.js'));
  const originalAppUrl = new URL('../src/app.js', import.meta.url);
  const baselineAppSource = await readFile(new URL('./fixtures/victory_before/app.js.txt', import.meta.url), 'utf8');
  const baselineImports = baselineAppSource.replace(/from (['"])([^'"\n]+)\1/g,
    (_match, quote, specifier) => `from ${quote}${specifier.startsWith('.') ? new URL(specifier, originalAppUrl).href : import.meta.resolve(specifier)}${quote}`);
  ({ App: BaselineApp } = await import('data:text/javascript;base64,' + Buffer.from(baselineImports).toString('base64')));
} finally { css.deregister(); }
const previousWindow = globalThis.window, previousRaf = globalThis.requestAnimationFrame;
const viewport = Object.freeze({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
const previousViewport = new Map(Object.keys(viewport).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(viewport)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
globalThis.window = { performance: globalThis.performance, ...viewport }; // real Node clock for Rapier; no fake browser timer
globalThis.requestAnimationFrame = () => 0; // no app or animation-frame loop is started
test.after(() => {
  if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  if (previousRaf === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previousRaf;
  for (const [key, descriptor] of previousViewport) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});

function commands() {
  return { driver: { throttle: 0, brake: 1, steer: 1, nitro: true, special1: true, special2: true,
    medkit: true, reset: true, lookX: 1, lookY: 1, lookBack: true, cameraToggle: true, horn: true },
  gunner: { dYaw: 1, dPitch: 1, fire: true, firePressed: true, reload: true, grenade: true,
    medkit: true, viewToggle: true, slot: -1, swap: 0 } };
}

// Actual authored terrain, asphalt and branch triangles through the source
// TerrainStreamer collision/cleanup methods. Imports use the normal production graph;
// no mocked road height/groundReady or flat floor substitutes authored support.
function supportedGround(sim) {
  const st = Object.create(TerrainStreamer.prototype);
  Object.assign(st, { world: sim.world, road: sim.road, seed: sim.seed, chunks: new Map(),
    group: new THREE.Group(), terrainMat: new THREE.MeshBasicMaterial(), roadMat: new THREE.MeshBasicMaterial(),
    pending: new Set(), stats: { built: 0 }, _sLast: 0 });
  st.update = function(s) {
    this._sLast = s;
    for (let c = Math.max(0, Math.floor((s - 330) / CHUNK_LEN)); c <= Math.floor((s + 400) / CHUNK_LEN); c++) {
      if (!this.chunks.has(c)) this._onMsg2({ busy: 1 }, { type: 'chunk', key: `${c}:0`, chunk: c, lod: 0,
        t: genTerrainChunk(sim.road, sim.seed, c, 0), r: genRoadChunk(sim.road, sim.seed, c),
        b: genDrivingBranchChunk(sim.road, sim.seed, c) });
    }
    for (const [c, rec] of this.chunks) {
      if ((c + .5) * CHUNK_LEN < s - 600 || (c + .5) * CHUNK_LEN > s + 700) { this._dispose(c, rec); this.chunks.delete(c); }
      else this._collision(c, rec, s);
    }
  };
  st.dispose = function() {
    for (const [c, rec] of this.chunks) this._dispose(c, rec);
    this.chunks.clear();
    this.terrainMat.dispose(); this.roadMat.dispose();
  };
  return st;
}
async function fixture({ role = 'driver', coop = false, level = 1, bossApproach = false } = {}, callback) {
  const profile = DEFAULT_PROFILE(); profile.truck = 'truck_t1'; profile.trucks.push('truck_t1');
  profile.weapons.smg = { dmg: 0, mag: 0, rel: 0, hnd: 0 }; profile.loadout = ['smg', 'pistol'];
  const setup = buildPlayerSpec(profile), journey = { version: 1, mode: 'campaign', level };
  const sim = await new Sim({ seed: 7, journey }).init();
  const s = bossApproach ? TEN_LEVELS[level - 1].bossDistance : 40;
  const ground = supportedGround(sim);
  ground.update(s);
  sim.setGround(ground);
  const player = sim.spawnCar(setup.spec.id, { spec: setup.spec, kind: 'player', s, speed: bossApproach ? 0 : 18, hold: bossApproach });
  sim.start(); sim.time = 60; sim.stats.distance = s;
  const sent = [], net = coop ? { sendJSON: m => { sent.push(structuredClone(m)); return true; },
    sendFast: () => true, sendTransientJSON: () => true } : null;
  const noop = () => {}, g = { camera: new THREE.PerspectiveCamera(85, 16 / 9, .15, 1000),
    scene: new THREE.Scene(), input: { lastDevice: 'kbm', rumble: noop },
    hud: { el: null, gh: null, message: noop, feed: noop, hitMarker: noop, damageFlash: noop, setVisible: noop }, fade: noop,
    paused: false, driverFovBase: 85 };
  const run = new Run(g, { role, seed: 7, profile, journey, net, runId: `work-victory-${role}-${level}` });
  Object.assign(run, { sim, player, spec: setup.spec, effects: setup.effects, started: true, groundOk: true,
    introDone: true, partnerReady: true, encounters: sim.encounters, medkits: 3,
    wv: { viewMap: new Map(), cars: new Map(), updateBoss: noop, update: noop, handleEvent: noop,
      notifyLocalShot: noop, dispose: noop,
      muzzlePos(st, out) { run._gunnerEye(st, out); out.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(st.quat), 1.5); return true; } },
    hazMarks: { update: noop, handleEvent: noop, dispose: noop }, bossMarks: { update: noop, dispose: noop },
    banner: { update: noop, miniboss: noop, hazard: noop, event: noop, bossBeat: noop, dispose: noop },
    threatHud: { setVisible: noop, update: noop, dispose: noop } });
  if (run.gunnerLocal) run.gunner = new GunnerController(gunnerLoadout(setup.effects), run._gunnerCtx());
  const st = makeCarState(1, player.spec.id, 'player'); stateFromCar(player, 0, st); run.states.set(1, st);
  sim.drainEvents();
  try { await callback({ run, sim, player, sent, profile, st }); }
  finally { run.dispose(); }
}

function actualChapterDeath(sim) {
  sim.director._journeyBosses(sim, sim.player, .3);
  const elite = sim.director.activeElite;
  assert.ok(elite?.cars.length, 'actual production Director retained boss identity');
  for (const car of elite.cars) sim.explodeCar(car, 'bullet', 1);
  sim.director._journeyBosses(sim, sim.player, .3);
  assert.equal(verifiedBossClear(sim), true);
  sim._runState(DT);
  return elite;
}


// DOM/renderer/RAF/storage consumers are explicit CPU fixtures. The App watcher,
// App result publication, Game frame dispatch, Run camera/AI/weapons/physics and
// generated road support remain their actual source methods. No app mouse input,
// browser, audio, GPU, earned boss kill or real WebRTC proof is claimed here.
function quietCommands() {
  const cmd = commands();
  for (const object of [cmd.driver, cmd.gunner]) for (const [key, value] of Object.entries(object)) {
    object[key] = typeof value === 'number' ? 0 : false;
  }
  cmd.driver.brake = 1; cmd.gunner.slot = -1;
  return cmd;
}
function rafFixture(t) {
  const previous = globalThis.requestAnimationFrame, callbacks = [];
  globalThis.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
  t.after(() => { globalThis.requestAnimationFrame = previous; });
  return { callbacks, pump() { assert.ok(callbacks.length > 0, 'watcher must remain scheduled'); callbacks.shift()(); } };
}
function memoryStorageFixture(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size; }, key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); }, removeItem(key) { values.delete(String(key)); }, clear() { values.clear(); },
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; });
}
function actualGame(run) {
  const game = run.g, counters = { renders: 0, hud: 0, lastHudVisible: null, hudVisibility: [] };
  Object.setPrototypeOf(game, Game.prototype);
  Object.assign(game, { mode: 'run', run, paused: false, frames: 1, last: 0, post: null, audio: null, _pumpTextures() {},
    sky: { setLook() {}, update() {} }, lampLights: { update() {} }, headlights: [],
    renderer: { render() { counters.renders++; }, info: { render: { calls: 0, triangles: 0 } } },
    perf: { sim: 0, render: 0, frame: 1000 / 60, fps: 60, calls: 0, tris: 0, worst: 0 },
    _lockEl: { style: {} }, input: { lastDevice: 'kbm', locked: false, hit: () => false, edge: () => false,
      poll() {}, endFrame() {}, rumble() {}, releaseLock() {}, requestLock() { throw new Error('CPU fixture may never request pointer capture'); },
      solo: quietCommands, driver: () => quietCommands().driver, gunner: () => quietCommands().gunner } });
  game.hud.update = () => { counters.hud++; };
  game.hud.setVisible = value => { counters.lastHudVisible = !!value; counters.hudVisibility.push(!!value); };
  return { game, counters };
}
function actualApp(run, game, profile, AppClass = App) {
  const results = [];
  const app = Object.assign(Object.create(AppClass.prototype), {
    game, input: game.input, profile, personalProfile: profile, session: null, mode: 'solo', screen: 'run', _flowId: 0,
    ui: { settings: {}, hideAll() {}, showResults(summary, value) { results.push({ summary: structuredClone(summary), profile: structuredClone(value) }); } },
  });
  window.__app = app;
  game.onRunEnd = value => app._results(value);
  return { app, results };
}
function policyRun({ verified = false, won = true, coop = false, loss = false } = {}) {
  const states = new Map(), run = { role: 'solo', playerId: 1, started: true, humanDriver: true, humanGunner: false,
    states, over: true, finished: false, finaleT: 8.5, victoryPresentation: verified, net: coop ? {} : null,
    journey: { mode: 'campaign', level: 10 }, road: null, hud2: {}, allEvents: [], playerS: 0,
    wv: { cars: new Map() }, g: { camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene(), hud: {} } };
  run.sim = { state: 'over', won, victoryPresentation: verified,
    journey: run.journey, result: { why: loss ? 'car' : 'victory' }, boss: { exploded: true } };
  let updates = 0; run.update = () => { updates++; };
  return { run, updates: () => updates };
}

test('actual App watcher reproduces legacy freeze and exempts only a verified celebration; other results retain dispatch', t => {
  const raf = rafFixture(t);
  for (const scene of [
    { name: 'baseline verified finale still freezes', AppClass: BaselineApp, verified: true, paused: true, updates: 0 },
    { name: 'candidate verified finale continues', AppClass: App, verified: true, paused: false, updates: 1 },
    { name: 'unverified solo won retains legacy hold', AppClass: App, verified: false, paused: true, updates: 0 },
    { name: 'loss retains moving background without AI proof', AppClass: App, verified: false, won: false, loss: true, paused: false, updates: 1 },
    { name: 'co-op retains existing nonfrozen dispatch', AppClass: App, verified: true, coop: true, paused: false, updates: 1 },
  ]) {
    raf.callbacks.length = 0;
    const f = policyRun(scene), { game } = actualGame(f.run), app = Object.assign(Object.create(scene.AppClass.prototype), { game, screen: 'results' });
    app._watchEnd(f.run); raf.pump();
    assert.equal(game.paused, scene.paused, scene.name);
    game.frame(1000 / 60);
    assert.equal(f.updates(), scene.updates, scene.name);
    assert.equal(raf.callbacks.length, scene.paused ? 0 : 1, 'unchanged freeze stops watcher; other backgrounds keep one scheduled tick');
  }
});

test('actual level10 boss death, App results and Game loop keep both real AI seats moving after finale while paying once', async t => {
  const raf = rafFixture(t); memoryStorageFixture(t);
  await fixture({ role: 'solo', level: 10, bossApproach: true }, ({ run, sim, player, profile }) => {
    const originalWindowApp = window.__app;
    t.after(() => { if (originalWindowApp === undefined) delete window.__app; else window.__app = originalWindowApp; });
    const { game, counters } = actualGame(run), { app, results } = actualApp(run, game, profile);
    const originalCash = profile.cash, originalRuns = profile.runs;
    sim.director._journeyBosses(sim, player, .3);
    const boss = sim.boss;
    assert.ok(boss?.body && boss.isBoss && !boss.dead, 'actual Director must create the authored Leviathan');
    // Controlled CPU setup enters the actual boss death method. Its authored
    // four-second dying/explosion logic runs; no won/over/Results flags or times
    // are assigned. This is not an earned part-damage or native boss kill.
    boss._die();
    for (let step = 0; step < 600 && !boss.exploded; step++) boss.update(DT);
    assert.equal(boss.exploded, true); assert.ok(boss.deathT > 4);
    assert.equal(verifiedBossClear(sim), true); sim._runState(DT);
    assert.equal(sim.state, 'run'); assert.equal(sim.won, false);
    run.events = sim.drainEvents(); run._simEventsToRun();
    assert.equal(run._beginVictoryPresentation(), true);
    sim.releaseCar(player); assert.equal(player.held, false);
    const enemy = sim.spawnCar('e_technical', { s: player.s + 60, d: -4, speed: 18 });
    const shots = [], acceptedHits = [], trace = [];
    const originalEmit = sim.emit.bind(sim), originalHit = sim.applyHit.bind(sim);
    sim.emit = event => { if (event.t === 'shot' && event.fromGunner) shots.push(structuredClone(event)); originalEmit(event); };
    sim.applyHit = report => { const accepted = originalHit(report); if (accepted && report.carId === enemy.id) acceptedHits.push(structuredClone(report)); return accepted; };
    app._watchEnd(run);
    let resultsStart = null;
    for (let frame = 0; frame < 1200; frame++) {
      game.frame((frame + 1) * 1000 / 60);
      raf.pump();
      if (app.screen === 'results' && resultsStart === null) resultsStart = { frame, s: player.s, tick: sim.tick, cash: profile.cash, runs: profile.runs,
        summary: structuredClone(run.summary), ownership: [run.role, run.simPeer, run.humanDriver, run.humanGunner] };
      if (frame % 60 === 0) trace.push({ frame, s: player.s, speed: player.veh.speed, tick: sim.tick, finaleT: run.finaleT,
        finaleDone: run.finaleDone, screen: app.screen, paused: game.paused, finished: run.finished, shots: shots.length, hits: acceptedHits.length });
      assert.equal(game.paused, false, JSON.stringify(trace));
      if (app.screen === 'results') assert.equal(counters.lastHudVisible, false, 'Results retain HUD ownership after the nine-second finale transition');
      assert.equal(player.exploded, false); assert.equal(player.veh.input.nitro, false);
      assert.equal(player.crew.driver.alive, true); assert.equal(player.crew.gunner.alive, true);
      if (resultsStart && frame - resultsStart.frame >= 300) break;
    }
    assert.ok(resultsStart, JSON.stringify(trace));
    assert.equal(sim.state, 'over'); assert.equal(sim.won, true); assert.equal(run.finished, true);
    assert.equal(run.finaleDone, true, 'real camera passes the authored nine-second finale boundary');
    assert.ok(player.s > resultsStart.s + 10, JSON.stringify(trace));
    assert.ok(sim.tick > resultsStart.tick + 200, 'actual simulation steps continue through five seconds beneath Results');
    assert.equal(run.aiDriver.run, run); assert.equal(run.aiGunner.run, run);
    assert.ok(shots.length > 0); assert.ok(acceptedHits.length > 0, 'actual temporary AI damages the actual Technical');
    assert.ok(enemy.exploded || enemy.hp < enemy.maxHp || Object.values(enemy.crew).some(crew => crew.hp < crew.max));
    assert.equal(results.length, 1); assert.equal(profile.cash, originalCash + run.summary.cash); assert.equal(profile.runs, originalRuns + 1);
    assert.equal(profile.cash, resultsStart.cash); assert.equal(profile.runs, resultsStart.runs);
    assert.deepEqual(run.summary, resultsStart.summary);
    assert.deepEqual([run.role, run.simPeer, run.humanDriver, run.humanGunner], resultsStart.ownership);
    app._results(run); assert.equal(results.length, 1); assert.equal(profile.cash, resultsStart.cash); assert.equal(profile.runs, resultsStart.runs);
    assert.ok(counters.renders > 600); assert.ok(counters.hud > 600);
  });
});

test('actual hull defeat still publishes loss once and keeps the background sim advancing without a victory takeover', async t => {
  const raf = rafFixture(t); memoryStorageFixture(t);
  await fixture({ role: 'solo' }, ({ run, sim, player, profile }) => {
    const originalWindowApp = window.__app;
    t.after(() => { if (originalWindowApp === undefined) delete window.__app; else window.__app = originalWindowApp; });
    const { game } = actualGame(run), { app, results } = actualApp(run, game, profile);
    sim.damageCar(player, player.hp + 1, { src: 2, cause: 'bullet' });
    assert.equal(player.hp, 0); assert.equal(player.dead, true); assert.equal(player.exploded, true);
    app._watchEnd(run);
    let resultsStart = null;
    for (let frame = 0; frame < 600; frame++) {
      game.frame((frame + 1) * 1000 / 60); raf.pump();
      if (app.screen === 'results' && resultsStart === null) resultsStart = { frame, tick: sim.tick, cash: profile.cash, runs: profile.runs };
      assert.equal(game.paused, false); assert.equal(run.victoryPresentation, false); assert.equal(sim.victoryPresentation, false);
      if (resultsStart && frame - resultsStart.frame >= 180) break;
    }
    assert.ok(resultsStart); assert.equal(run.summary.won, false); assert.equal(run.summary.cause, 'TRUCK DESTROYED');
    assert.equal(sim.won, false); assert.equal(run.aiDriver, undefined); assert.equal(run.aiGunner, undefined);
    assert.ok(sim.tick > resultsStart.tick + 200, 'ordinary lost-run background keeps its existing physics dispatch');
    assert.equal(results.length, 1); assert.equal(profile.cash, resultsStart.cash); assert.equal(profile.runs, resultsStart.runs);
    app._results(run); assert.equal(results.length, 1);
  });
});

test('actual finale camera completion shows HUD only for its current App run screen or a headless caller', t => {
  const original = window.__app;
  t.after(() => { if (original === undefined) delete window.__app; else window.__app = original; });
  for (const scene of [
    { name: 'headless compatibility', screen: null, visible: true },
    { name: 'current playable run', screen: 'run', visible: true },
    { name: 'results own HUD', screen: 'results', visible: false },
    { name: 'garage owns HUD', screen: 'garage', visible: false },
    { name: 'replacement run owns HUD', screen: 'run', replacement: true, visible: false },
    { name: 'another Game owns HUD', screen: 'run', otherGame: true, visible: false },
  ]) {
    const shown = [], g = { camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene(), hud: { setVisible: value => shown.push(value) } };
    const run = new Run(g, { role: 'solo', seed: 7, profile: DEFAULT_PROFILE(), journey: { mode: 'campaign', level: 10 } });
    g.run = scene.replacement ? {} : run;
    if (scene.screen === null) delete window.__app;
    else window.__app = { game: scene.otherGame ? {} : g, screen: scene.screen };
    // Declared camera-consumer transition fixture, separate from authority proof.
    run.bossState = { pos: new THREE.Vector3(0, 0, 80), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), dead: true, exploded: true };
    run.finaleT = 8.99; run.victoryPresentation = true; run._finaleHudHidden = true;
    try {
      run._camera(.02, quietCommands(), makeCarState(1, 'truck_t1', 'player'));
      assert.equal(run.finaleDone, true); assert.equal(run._finaleHudHidden, false);
      assert.deepEqual(shown, scene.visible ? [true] : [], scene.name);
    } finally { run.dispose(); }
  }
});

test('actual Esc/Start frame dispatch cannot pause a verified clear before runOver or stall Results; ordinary pause policy remains', async t => {
  const raf = rafFixture(t); memoryStorageFixture(t);
  // Source dispatcher/pause negative control and unchanged policy cases. These
  // are synthetic input callback values, never device keys or pointer input.
  for (const scene of [
    { name: 'baseline verified clear can stall', AppClass: BaselineApp, verified: true, paused: true, updates: 0, menus: 1 },
    { name: 'candidate verified clear continues', AppClass: App, verified: true, paused: false, updates: 1, menus: 0 },
    { name: 'healthy solo pause retained', AppClass: App, verified: false, paused: true, updates: 0, menus: 1 },
    { name: 'unverified claimed win still pauses', AppClass: App, verified: false, claimed: true, paused: true, updates: 0, menus: 1 },
    { name: 'known loss keeps existing timer', AppClass: App, verified: false, loss: true, paused: false, updates: 1, menus: 0 },
    { name: 'healthy co-op opens menu while advancing', AppClass: App, verified: false, coop: true, paused: true, updates: 1, menus: 1 },
    { name: 'verified co-op does not open menu', AppClass: App, verified: true, coop: true, paused: false, updates: 1, menus: 0 },
    { name: 'an already-owned solo pause stays owned', AppClass: App, verified: true, ownedPause: true, paused: true, updates: 0, menus: 0 },
  ]) {
    const f = policyRun({ ...scene, won: false });
    f.run.over = false; f.run.finaleT = 0; f.run.sim.state = 'run';
    f.run.sim.result = { why: scene.loss ? 'car' : scene.verified ? 'victory' : null };
    if (scene.claimed) f.run._victorySeen = true;
    const { game } = actualGame(f.run), observed = { menus: 0, releases: 0, resets: 0, dispatches: 0 };
    game.input.hit = key => key === 'pause';
    game.input.releaseLock = () => { observed.releases++; };
    game.input.reset = () => { observed.resets++; };
    const app = Object.assign(Object.create(scene.AppClass.prototype), { game, input: game.input,
      mode: scene.coop ? 'coop' : 'solo', screen: 'run', session: null, _flowId: 1,
      ui: { showPause() { observed.menus++; }, hideAll() {} } });
    game.paused = !!scene.ownedPause;
    game.onPause = () => { observed.dispatches++; app._pause(); };
    game.frame(1000 / 60);
    assert.equal(observed.dispatches, 1, scene.name);
    assert.equal(game.paused, scene.paused, scene.name);
    assert.equal(observed.menus, scene.menus, scene.name);
    assert.equal(observed.releases, scene.menus, scene.name);
    assert.equal(observed.resets, scene.menus, scene.name);
    assert.equal(f.updates(), scene.updates, scene.name);
  }

  await fixture({ role: 'solo', bossApproach: true }, ({ run, sim, player, profile }) => {
    const originalWindowApp = window.__app;
    t.after(() => { if (originalWindowApp === undefined) delete window.__app; else window.__app = originalWindowApp; });
    const { game } = actualGame(run), { app, results } = actualApp(run, game, profile);
    actualChapterDeath(sim); run.events = sim.drainEvents(); run._simEventsToRun(); run._beginVictoryPresentation();
    assert.equal(verifiedBossClear(sim), true); assert.equal(victoryPresenting(run), true);
    assert.equal(sim.state, 'run'); assert.equal(sim.won, false); assert.equal(run.over, false);
    sim.releaseCar(player);
    const cash = profile.cash, runs = profile.runs, initialTick = sim.tick;
    const observed = { menus: 0, resets: 0, releases: 0, esc: 0, start: 0, dispatches: 0 };
    let frame = 0;
    game.input.hit = key => { if (key === 'pause' && frame % 2 === 0) { observed.esc++; return true; } return false; };
    game.input.edge = button => { if (button === 9 && frame % 2 === 1) { observed.start++; return true; } return false; };
    game.input.reset = () => { observed.resets++; };
    game.input.releaseLock = () => { observed.releases++; };
    app.ui.showPause = () => { observed.menus++; };
    game.onPause = () => { observed.dispatches++; app._pause(); };
    app._watchEnd(run);
    let beforeOverDispatches = 0;
    for (; frame < 1200; frame++) {
      const wasOver = run.over, dispatches = observed.dispatches;
      game.frame((frame + 1) * 1000 / 60); raf.pump();
      if (!wasOver) beforeOverDispatches += observed.dispatches - dispatches;
      assert.equal(game.paused, false, `verified clear must advance at frame${frame}`);
      assert.equal(observed.menus, 0); assert.equal(observed.resets, 0);
      if (results.length) break;
    }
    assert.ok(observed.esc > 0 && observed.start > 0);
    assert.ok(beforeOverDispatches > 120, 'both actual dispatcher paths were exercised during the natural three-second delay');
    assert.equal(sim.state, 'over'); assert.equal(sim.won, true); assert.equal(run.over, true); assert.equal(run.finished, true);
    assert.ok(sim.tick > initialTick + 360, 'natural Run physics advances through clear and Results delays');
    assert.equal(app.screen, 'results'); assert.equal(results.length, 1);
    assert.equal(observed.releases, 1, 'only Results releases the synthetic input owner');
    assert.equal(profile.cash, cash + run.summary.cash); assert.equal(profile.runs, runs + 1);
  });
});

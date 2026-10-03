// CPU-only production-graph fixtures. No browser, renderer, worker, audio or
// device input starts here. Setup enters a real registered boss's death method;
// it is not an earned boss kill, a full campaign, pixels, FPS or WebRTC proof.
import './peer-import.mjs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerHooks } from 'node:module';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Run } from '../../src/game/run.js';
import { Game } from '../../src/game/game.js';
import { Sim, DT } from '../../src/sim/sim.js';
import { TerrainStreamer } from '../../src/world/terrain.js';
import { CHUNK_LEN, genTerrainChunk, genRoadChunk, genDrivingBranchChunk } from '../../src/world/terrain_gen.js';
import { GunnerController } from '../../src/game/gunner.js';
import { AIDriver } from '../../src/game/ai_driver.js';
import { AIGunner } from '../../src/game/ai_gunner.js';
import { buildPlayerSpec, gunnerLoadout } from '../../src/game/run_setup.js';
import { DEFAULT_PROFILE } from '../../src/data/upgrades.js';
import { TEN_LEVELS } from '../../src/data/campaign.js';
import { makeCarState, stateFromCar } from '../../src/view/car_state.js';
import { verifiedBossClear, celebrationActive } from '../../src/sim/victory_presentation.js';

const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let App;
try { ({ App } = await import('../../src/app.js')); } finally { css.deregister(); }

export { THREE, Run, Game, Sim, DT, App, AIDriver, AIGunner, TEN_LEVELS, verifiedBossClear, celebrationActive };

/** Explicit CPU window/storage/RAF/random consumers, restored after each case. */
export function installVictoryTailEnvironment(t, { randomSeed = 0x71c4 } = {}) {
  const keys = ['window', 'requestAnimationFrame', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'localStorage'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const callbacks = [], values = new Map(), previousRandom = Math.random;
  let randomState = randomSeed >>> 0;
  Math.random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 0x100000000; };
  const viewport = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 };
  for (const [key, value] of Object.entries(viewport)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: { performance: globalThis.performance, ...viewport }, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true,
    value: callback => { callbacks.push(callback); return callbacks.length; } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size; }, key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; }, setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }, clear() { values.clear(); },
  } });
  t.after(() => {
    Math.random = previousRandom;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { callbacks, values, randomSeed, pump() {
    assert.equal(callbacks.length, 1, 'the actual App watcher owns exactly one pending logical RAF');
    callbacks.shift()();
  } };
}

/** Generated source terrain/asphalt/branch meshes and their real Rapier support. */
export function supportedVictoryGround(sim) {
  const ground = Object.create(TerrainStreamer.prototype);
  Object.assign(ground, { world: sim.world, road: sim.road, seed: sim.seed, journey: sim.journey,
    chunks: new Map(), group: new THREE.Group(), terrainMat: new THREE.MeshBasicMaterial(),
    roadMat: new THREE.MeshBasicMaterial(), pending: new Set(), stats: { built: 0 }, _sLast: 0 });
  // Worker scheduling/render consumers are replaced with synchronous generation.
  // Geometry, source collider placement, bounds, groundReady and road-height
  // queries are unchanged. There is no substitute flat floor or support shim.
  ground.update = function(s) {
    if (this.disposed) return;
    this._sLast = s;
    for (let chunk = Math.max(0, Math.floor((s - 330) / CHUNK_LEN)); chunk <= Math.floor((s + 400) / CHUNK_LEN); chunk++) {
      if (!this.chunks.has(chunk)) this._onMsg2({ busy: 1 }, { type: 'chunk', key: `${chunk}:0`, chunk, lod: 0,
        t: genTerrainChunk(sim.road, sim.seed, chunk, 0), r: genRoadChunk(sim.road, sim.seed, chunk),
        b: genDrivingBranchChunk(sim.road, sim.seed, chunk) });
    }
    for (const [chunk, record] of this.chunks) {
      if ((chunk + .5) * CHUNK_LEN < s - 600 || (chunk + .5) * CHUNK_LEN > s + 700) this._dispose(chunk, record);
      else this._collision(chunk, record, s);
    }
  };
  ground.dispose = function() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [chunk, record] of this.chunks) this._dispose(chunk, record);
    this.chunks.clear(); this.terrainMat.dispose(); this.roadMat.dispose();
  };
  return ground;
}

export function quietVictoryCommands() {
  return { driver: { throttle: 0, brake: 1, steer: 0, handbrake: false, nitro: false,
    special1: false, special2: false, medkit: false, reset: false, lookX: 0, lookY: 0,
    mouseYaw: 0, mousePitch: 0, lookBack: false, cameraToggle: false, horn: false },
  gunner: { dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false,
    reload: false, grenade: false, medkit: false, viewToggle: false, slot: -1, swap: 0 } };
}

/** Actual local single-player authorities; no guest authority is fabricated. */
export async function createVictoryTailScene({ role = 'driver', level = 1, seed = 7 } = {}) {
  assert.ok(role === 'driver' || role === 'gunner');
  assert.ok(Number.isInteger(level) && level >= 1 && level <= 10);
  const profile = DEFAULT_PROFILE(); profile.truck = 'truck_t1';
  if (!profile.trucks.includes('truck_t1')) profile.trucks.push('truck_t1');
  profile.weapons.smg = { dmg: 0, mag: 0, rel: 0, hnd: 0 }; profile.loadout = ['smg', 'pistol'];
  // Prior chapters are declared profile setup so the actual App may credit the
  // selected chapter. No runtime clear state or campaign result is fabricated.
  profile.campaignProgress = { version: 1, unlockedLevel: level, selectedLevel: level,
    selectedMode: 'campaign', marathonUnlocked: false,
    cleared: Array.from({ length: level - 1 }, (_, index) => index + 1), clearRuns: {} };
  const setup = buildPlayerSpec(profile), journey = { version: 1, mode: 'campaign', level };
  const sim = await new Sim({ seed, journey }).init();
  const ground = supportedVictoryGround(sim), s = TEN_LEVELS[level - 1].bossDistance;
  let run;
  try {
    ground.update(s); sim.setGround(ground);
    const player = sim.spawnCar(setup.spec.id, { spec: setup.spec, kind: 'player', s, speed: 0, hold: true });
    sim.start(); sim.time = 60; sim.stats.distance = s;
    const noop = () => {}, counters = { renders: 0, hud: 0, lastHudVisible: null,
      inputReleases: 0, inputResets: 0, pauseMenus: 0, shots: [], hits: [], rays: 0, worldBlocks: 0 };
    const game = { camera: new THREE.PerspectiveCamera(85, 16 / 9, .15, 1000), scene: new THREE.Scene(),
      hud: { el: null, gh: null, message: noop, feed: noop, hitMarker: noop, damageFlash: noop,
        update() { counters.hud++; }, setVisible(value) { counters.lastHudVisible = !!value; } },
      fade: noop, paused: false, driverFovBase: 85, input: { lastDevice: 'kbm', rumble: noop } };
    const ai = role === 'driver' ? 'gunner' : 'driver';
    run = new Run(game, { role, ai, seed, profile, journey, runId: `victory-tail-${role}-${level}-${seed}` });
    Object.assign(run, { sim, player, spec: setup.spec, effects: setup.effects, started: true,
      groundOk: true, introDone: true, partnerReady: true, encounters: sim.encounters, medkits: 3,
      wv: { viewMap: new Map(), cars: new Map(), updateBoss: noop, update: noop, handleEvent: noop,
        notifyLocalShot: noop, dispose: noop,
        muzzlePos(state, out) { run._gunnerEye(state, out); out.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(state.quat), 1.5); return true; } },
      hazMarks: { update: noop, handleEvent: noop, dispose: noop }, bossMarks: { update: noop, dispose: noop },
      banner: { update: noop, miniboss: noop, hazard: noop, event: noop, bossBeat: noop, dispose: noop },
      threatHud: { setVisible: noop, update: noop, dispose: noop } });
    if (run.gunnerLocal) run.gunner = new GunnerController(gunnerLoadout(setup.effects), run._gunnerCtx());
    if (ai === 'driver') run.aiDriver = new AIDriver(run); else run.aiGunner = new AIGunner(run);
    const state = makeCarState(player.id, player.spec.id, 'player'); stateFromCar(player, 0, state); run.states.set(player.id, state);
    sim.drainEvents();
    Object.setPrototypeOf(game, Game.prototype);
    Object.assign(game, { mode: 'run', run, paused: false, frames: 1, last: 0, post: null, audio: null,
      _pumpTextures: noop, sky: { setLook: noop, update: noop }, lampLights: { update: noop }, headlights: [],
      renderer: { render() { counters.renders++; }, info: { render: { calls: 0, triangles: 0 } } },
      perf: { sim: 0, render: 0, frame: 1000 / 60, fps: 60, calls: 0, tris: 0, worst: 0 }, _lockEl: { style: {} },
      input: { lastDevice: 'kbm', locked: false, hit: () => false, edge: () => false,
        poll: noop, endFrame: noop, rumble: noop,
        releaseLock() { counters.inputReleases++; }, reset() { counters.inputResets++; },
        requestLock() { throw new Error('CPU fixture may never request device or pointer capture'); },
        solo: quietVictoryCommands, driver: () => quietVictoryCommands().driver, gunner: () => quietVictoryCommands().gunner } });
    const results = [], app = Object.assign(Object.create(App.prototype), { game, input: game.input,
      profile, personalProfile: profile, session: null, mode: 'solo', screen: 'run', _flowId: 0,
      ui: { settings: {}, hideAll: noop, showPause() { counters.pauseMenus++; },
        showResults(summary, value) { results.push({ summary: structuredClone(summary), profile: structuredClone(value) }); } } });
    window.__app = app;
    game.onRunEnd = value => app._results(value); game.onPause = () => app._pause();
    const originalEmit = sim.emit.bind(sim), originalHit = sim.applyHit.bind(sim), originalRay = run._worldRay.bind(run);
    sim.emit = event => { if (event.t === 'shot' && event.fromGunner) counters.shots.push(structuredClone(event)); originalEmit(event); };
    sim.applyHit = report => { const accepted = originalHit(report); if (accepted) counters.hits.push(structuredClone(report)); return accepted; };
    run._worldRay = (...args) => { counters.rays++; const hit = originalRay(...args); if (hit) counters.worldBlocks++; return hit; };
    return { role, level, seed, setup, journey, profile, sim, player, ground, run, game, app, results, counters,
      trace: [], frame: 0, resultsStart: null, clear: null, disposed: false,
      scope: { controlledSetup: true, authority: 'local-single-player', ai, truck: 'truck_t1',
        generatedSupport: 'production terrain, road and branches; synchronous worker consumer',
        consumers: 'no-op renderer, UI, models/muzzle, texture, markers; queued RAF; memory storage',
        nativePixels: false, fps: false, earnedBossKill: false, fullCampaign: false, webRTC: false } };
  } catch (error) { if (run) run.dispose(); else sim.dispose(); throw error; }
}

/** Kill the actual retained identities; never assign completion/won/over flags. */
export function clearRegisteredVictoryBoss(scene) {
  const { sim, player, run, level } = scene;
  sim.director._journeyBosses(sim, player, .3);
  let identities;
  if (level === 10) {
    const boss = sim.boss;
    assert.ok(boss?.isBoss && boss.body && !boss.dead, 'Director creates the actual authored Leviathan');
    identities = [boss.id]; boss._die();
    for (let step = 0; step < 600 && !boss.exploded; step++) boss.update(DT);
    assert.equal(boss.exploded, true); assert.ok(boss.deathT > 4, 'actual authored dying/explosion delay elapses');
    sim.director._journeyBosses(sim, player, .3);
  } else {
    const elite = sim.director.activeElite;
    assert.equal(elite?.chapter, level); assert.ok(elite.cars.length > 0);
    identities = elite.cars.map(car => car.id);
    for (const car of elite.cars) {
      assert.equal(sim.cars.get(car.id), car, 'registered source identity precedes its real explosion');
      sim.explodeCar(car, 'bullet', player.id);
    }
    sim.director._journeyBosses(sim, player, .3);
    assert.equal(sim.director.chapterBossDone.has(level), true);
  }
  assert.equal(verifiedBossClear(sim), true);
  sim._runState(DT);
  assert.equal(sim.state, 'run'); assert.equal(sim.won, false); assert.equal(run.over, false);
  run.events = sim.drainEvents(); run._simEventsToRun();
  assert.equal(run._beginVictoryPresentation(), true);
  sim.releaseCar(player);
  const target = sim.spawnCar('e_technical', { s: player.s + 60, d: -4, speed: 18 });
  scene.target = target;
  scene.clear = { simTime: sim.time, tick: sim.tick, s: player.s, pos: player.veh.pos.toArray(), identities,
    ownership: { role: run.role, ai: run.ai, simPeer: run.simPeer, humanDriver: run.humanDriver,
      humanGunner: run.humanGunner, driverLocal: run.driverLocal, gunnerLocal: run.gunnerLocal, net: run.net },
    cash: scene.profile.cash, runs: scene.profile.runs, runCash: run.cash, runShots: run.shots, hitsLanded: run.hitsLanded,
    medkits: run.medkits, summary: structuredClone(run.victorySummary), frozenStats: structuredClone(sim.victoryStats),
    protection: { hp: player.hp, driver: player.crew.driver.hp, gunner: player.crew.gunner.hp } };
  return scene.clear;
}

/** Raw chronological logical observations. They are not display refresh timing. */
export function observeVictoryTail(scene) {
  const { sim, player, run, ground, game, app, counters } = scene;
  const v = player.veh, road = sim.road.drivingPointAt(player.s, player.d, player.route);
  const bounds = ground.recoveryBoundsAt(player.s);
  const roadHeight = ground.roadHeightAt(player.s, v.pos.x, v.pos.z, Math.max(v.pos.y, road.y) + 3, player.route);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(game.camera.quaternion);
  const aim = v.pos.clone().add(new THREE.Vector3(0, .8, 0)).sub(game.camera.position);
  const row = { frame: scene.frame, logicalSeconds: scene.frame / 60, postClearSeconds: scene.clear ? sim.time - scene.clear.simTime : null,
    simTime: sim.time, tick: sim.tick, state: sim.state, won: sim.won, runOver: run.over, overT: run.overT ?? 0,
    screen: app.screen, finished: run.finished, paused: game.paused, s: player.s, d: player.d, route: player.route,
    pos: v.pos.toArray(), velocity: v.vel.toArray(), speed: v.speed, upY: v.up.y, grounded: v.grounded,
    airTime: v.airTime, held: player.held, halfWidth: player.routeHalfWidth,
    roadY: road.y, actualRoadHeight: roadHeight, bounds: bounds ? { ...bounds } : null,
    groundReady: ground.groundReady(player.s, player.route), chunks: ground.chunks.size,
    hp: player.hp, exploded: player.exploded, driverHp: player.crew.driver.hp, driverAlive: player.crew.driver.alive,
    gunnerHp: player.crew.gunner.hp, gunnerAlive: player.crew.gunner.alive,
    driverCommand: { ...v.input }, aiDriverCommand: run.aiDriver ? { ...run.aiDriver.cmd } : null,
    gunnerAim: run.gunner ? { yaw: run.gunner.yaw, pitch: run.gunner.pitch,
      ads: run.gunner.ads, reload: run.gunner.reloading, trigger: run.gunner.trigger, mag: run.gunner.magNow } : null,
    aiTarget: run.aiGunner?.target ? { kind: run.aiGunner.target.kind, carId: run.aiGunner.target.car?.id ?? null,
      actorId: run.aiGunner.target.encounter?.id ?? null } : null,
    cameraPos: game.camera.position.toArray(), cameraQuat: game.camera.quaternion.toArray(), fov: game.camera.fov,
    cinematic: run.cinematic, introOutside: run.introOutside, chaseMode: run.chase.mode,
    finaleT: run.finaleT ?? 0, finaleDone: !!run.finaleDone, cameraAimDot: aim.lengthSq() ? forward.dot(aim.normalize()) : null,
    shots: counters.shots.length, hits: counters.hits.length, rays: counters.rays, worldBlocks: counters.worldBlocks,
    cash: scene.profile.cash, runs: scene.profile.runs, results: scene.results.length, hullHud: counters.lastHudVisible };
  assert.ok(scene.trace.length < 2001, 'raw logical trace is bounded'); scene.trace.push(row);
  return row;
}

/** Actual Game.frame -> Run/Sim -> natural outcome -> actual App Results. */
export function driveVictoryTail(scene, environment, { postClearSeconds = 15, resultsSeconds = 5, maxFrames = 1920,
  onFrame = () => {} } = {}) {
  assert.ok(scene.clear, 'the actual registered clear must precede the tail');
  assert.ok(maxFrames <= 2000);
  scene.app._watchEnd(scene.run);
  for (; scene.frame < maxFrames; ) {
    scene.frame++;
    scene.game.frame(scene.frame * 1000 / 60); environment.pump();
    const row = observeVictoryTail(scene);
    if (scene.app.screen === 'results' && scene.resultsStart === null) scene.resultsStart = {
      frame: scene.frame, simTime: scene.sim.time, s: scene.player.s, tick: scene.sim.tick,
      cash: scene.profile.cash, runs: scene.profile.runs, summary: structuredClone(scene.run.summary) };
    onFrame(row, scene);
    if (scene.resultsStart && scene.sim.time - scene.clear.simTime >= postClearSeconds &&
      scene.sim.time - scene.resultsStart.simTime >= resultsSeconds) return row;
  }
  assert.fail(`actual clear/Results tail did not finish within ${maxFrames} logical frames`);
}

export function disposeVictoryTailScene(scene) {
  if (scene.disposed) return;
  scene.run.dispose(); scene.disposed = true;
}

let sourceHashes;
export async function retainVictoryTailEvidence(t, scene, { passed, error = null } = {}) {
  sourceHashes ||= Promise.all(['src/game/run.js', 'src/game/game.js', 'src/app.js', 'src/game/ai_driver.js',
    'src/game/ai_gunner.js', 'src/sim/sim.js', 'src/sim/director.js', 'src/sim/ai.js', 'src/sim/boss.js',
    'src/sim/victory_presentation.js', 'src/world/terrain.js', 'src/world/terrain_gen.js', 'src/data/campaign.js']
    .map(async path => [path, createHash('sha256').update(await readFile(new URL(`../../${path}`, import.meta.url))).digest('hex')]))
    .then(Object.fromEntries);
  const report = { version: 1, case: `level${scene.level}-${scene.role}`, passed: passed === true,
    error: error ? { name: error.name, message: error.message } : null, scope: scene.scope,
    sourceHashes: await sourceHashes, level: scene.level, role: scene.role, seed: scene.seed,
    clear: scene.clear, resultsStart: scene.resultsStart,
    endReason: passed ? 'required actual post-clear and Results durations completed' : 'assertion failure',
    totals: { frames: scene.frame, renders: scene.counters.renders, shots: scene.counters.shots.length,
      acceptedHits: scene.counters.hits.length, targetHits: scene.counters.hits.filter(hit => hit.carId === scene.target?.id).length,
      sourceWorldRays: scene.counters.rays, sourceWorldBlocks: scene.counters.worldBlocks },
    rawLogicalTrace: scene.trace, shots: scene.counters.shots, hits: scene.counters.hits };
  const requested = process.env.VICTORY_TAIL_REPORT_PATH;
  if (requested) {
    const work = resolve(fileURLToPath(new URL('../../work/', import.meta.url)));
    const target = resolve(requested);
    assert.ok(target.toLowerCase().startsWith((work + sep).toLowerCase()), 'optional root-run evidence belongs only inside this checkout WORK directory');
    await mkdir(dirname(target), { recursive: true }); await appendFile(target, JSON.stringify(report) + '\n', 'utf8');
  }
  // Every failure retains its full bounded logical chronology in the TAP log.
  // Successful raw chronology is retained when root sets the WORK report path.
  t.diagnostic(JSON.stringify(passed ? { case: report.case, passed: true, scope: report.scope, totals: report.totals,
    duration: scene.trace.at(-1)?.postClearSeconds, resultsSeconds: scene.resultsStart ? scene.sim.time - scene.resultsStart.simTime : null,
    tail: scene.trace.slice(-3), rawReport: requested || null } : report));
  return report;
}

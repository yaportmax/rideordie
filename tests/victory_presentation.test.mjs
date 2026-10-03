// Actual source CPU regressions. Rendering/input consumers are declared fixtures.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';

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
const baselineAIUrl = new URL('../src/game/ai_gunner.js', import.meta.url);
const baselineAISource = await readFile(new URL('./fixtures/victory_before/ai_gunner.js.txt', import.meta.url), 'utf8');
const baselineAIImports = baselineAISource.replace(/from (['"])([^'"\n]+)\1/g,
  (_match, quote, specifier) => `from ${quote}${specifier.startsWith('.') ? new URL(specifier, baselineAIUrl).href : import.meta.resolve(specifier)}${quote}`);
const { AIGunner: BaselineAIGunner } = await import('data:text/javascript;base64,' + Buffer.from(baselineAIImports).toString('base64'));

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
    hazMarks: { update: noop, handleEvent: noop, dispose: noop },
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

test('finite campaign approach and verified-clear helpers retain the authored ten chapters', () => {
  assert.equal(TEN_LEVELS[0].bossDistance, 5500);
  assert.equal(TEN_LEVELS.length, 10);
  assert.ok(TEN_LEVELS.every(level => level.bossDistance < 8000));
  assert.equal(verifiedBossClear(null), false);
  assert.equal(celebrationActive(null), false);
});
test('genuine controller prefers the owned sustained minigun, retaining the immutable pre-change pistol negative control', async () => {
  await fixture({ role: 'driver' }, ({ run, sim, player }) => {
    sim.spawnCar('e_technical', { s: player.s + 50, d: -2, hold: true });
    const eye = run._gunnerEye(run.states.get(1), new THREE.Vector3());
    const selected = [];
    for (const Controller of [BaselineAIGunner, AIGunner]) {
      run.gunner = new GunnerController({ weapons: ['minigun', 'pistol'] }, run._gunnerCtx());
      run.gunner.cur = 1;
      const ai = new Controller(run), command = ai.update(DT, run.gunner, eye);
      if (Controller === BaselineAIGunner) assert.equal(command.slot, -1, 'immutable pre-change snapshot keeps its pistol fallback');
      else assert.equal(command.slot, 0, 'candidate selects the actual owned minigun slot');
      run.gunner.update(DT, command, { position: eye, dir: new THREE.Vector3(0, 0, 1) }, 0, { deferFire: true });
      selected.push(run.gunner.weaponId);
    }
    assert.deepEqual(selected, ['pistol', 'minigun']);
    run.gunner = new GunnerController({ weapons: ['smg', 'pistol'] }, run._gunnerCtx()); run.gunner.cur = 1;
    const command = new AIGunner(run).update(DT, run.gunner, eye);
    assert.equal(command.slot, 0, 'loadouts without minigun retain their existing sustained preference');
    assert.equal(run.gunner.slots.includes('minigun'), false, 'no unowned gun is added');
  });
});

test('complete flag or living/missing boss cannot authorize either AI takeover', async () => {
  await fixture({ bossApproach: true, coop: true }, ({ run, sim, player }) => {
    const originalInput = { throttle: .4, brake: 0, steer: -.2, nitro: false };
    player.veh.setInput(originalInput);
    sim.director.campaignComplete = true;
    assert.equal(verifiedBossClear(sim), false); sim._runState(DT);
    assert.equal(sim.victoryPresentation, false); assert.equal(run._beginVictoryPresentation(), false);
    sim.director.campaignComplete = false; sim.director._journeyBosses(sim, player, .3);
    assert.ok(sim.director.activeElite.cars.every(c => !c.exploded));
    assert.equal(run._beginVictoryPresentation(), false);
    assert.equal(run.aiDriver, undefined); assert.equal(run.aiGunner, undefined);
    assert.equal(player.veh.input.throttle, originalInput.throttle, 'boss arrival preserves human controls');
    const boss = sim.director.activeElite.cars[0]; sim.cars.delete(boss.id);
    assert.equal(verifiedBossClear(sim), false, 'registry loss is not a dead boss');
    sim.cars.set(boss.id, boss);
  });
});

for (const role of ['driver', 'gunner', 'solo']) {
  test(`${role} authority owns both temporary AI seats once after actual chapter death`, async () => {
    await fixture({ role, coop: role === 'driver', bossApproach: true }, ({ run, sim }) => {
      const existingGunner = run.gunner, humanFlags = [run.humanDriver, run.humanGunner];
      if (existingGunner) { existingGunner.mag[0] = 7; existingGunner.yaw = .5; }
      run.gunnerRemote = { ...run.gunnerRemote, weapon: 1, yaw: .7, pitch: -.1, ads: true };
      actualChapterDeath(sim); run.events = sim.drainEvents(); run._simEventsToRun();
      assert.equal(run._beginVictoryPresentation(), true); assert.equal(run._beginVictoryPresentation(), false);
      assert.equal(run.aiDriver.run, run); assert.equal(run.aiGunner.run, run);
      assert.deepEqual([run.humanDriver, run.humanGunner], humanFlags, 'run/seat ownership is not rewritten');
      if (existingGunner) { assert.equal(run.gunner, existingGunner); assert.equal(run.gunner.mag[0], 7); }
      else {
        assert.equal(run._victoryControls.ownedGunner, true);
        assert.deepEqual(run.gunner.slots, ['smg', 'pistol']); assert.equal(run.gunner.cur, 1);
        assert.equal(run.gunner.yaw, .7); assert.equal(run.gunner.pitch, -.1);
      }
      assert.equal(celebrationActive(sim), true); assert.equal(isDefeated(run), false);
      assert.equal(canCaptureRun(run), false);
    });
  });
}

test('victory locks hull/crew/zones/healing and excludes later NPC kills from payout/statistics', async () => {
  await fixture({ role: 'solo', bossApproach: true }, ({ run, sim, player }) => {
    player.hp -= 120; player.crew.driver.hp -= 20; player.crew.gunner.hp -= 15;
    actualChapterDeath(sim); run.events = sim.drainEvents(); run._simEventsToRun(); run._beginVictoryPresentation();
    const protectedState = structuredClone({ hp: player.hp, crew: player.crew, tires: player.tireHp, fuel: player.fuelHp, engine: player.engineHp });
    const summary = run.buildSummary(true), stats = structuredClone(sim.stats), cash = run.cash, kits = run.medkits;
    sim.damageCar(player, 1e9, { cause: 'ram', src: 9 });
    sim.damageCrew(player, 'driver', 1e9, { cause: 'bullet', src: 9 });
    sim.damageCrew(player, 'gunner', 1e9, { cause: 'bullet', src: 9 });
    for (const zone of player.zones) sim.damageZone(player, zone, 1e9, { src: 9, cause: 'bullet' });
    sim.explodeCar(player, 'crew', 9); assert.equal(sim.useMedkit(), false); run._medkit();
    assert.deepEqual({ hp: player.hp, crew: player.crew, tires: player.tireHp, fuel: player.fuelHp, engine: player.engineHp }, protectedState);
    assert.equal(player.exploded, false); assert.equal(run.medkits, kits);
    const enemy = sim.spawnCar('e_sedan', { s: player.s + 90 }); sim.explodeCar(enemy, 'bullet', 1);
    assert.equal(enemy.exploded, true, 'the staged fight still destroys actual enemy bodies');
    const events = sim.drainEvents(); assert.ok(events.some(e => e.t === 'kill' && e.id === enemy.id && e.nonScoring));
    run._simEventsToRun(events); sim._countLandedShot(923); sim._creditKill(enemy, { src: 1 });
    assert.deepEqual(sim.stats, stats); assert.equal(run.cash, cash);
    sim.time += 20; sim.stats.distance += 400; run.shots += 10;
    assert.deepEqual(run.buildSummary(true), summary, 'presentation cannot farm time, distance, hits, kills or cash');
  });
});

test('a real registered ram boss clear retains clearing-batch cash and crashKills without recopying frozen combat/time or farming', async () => {
  await fixture({ role: 'solo', bossApproach: true }, ({ run, sim, player }) => {
    sim.director._journeyBosses(sim, player, .3);
    const elite = sim.director.activeElite;
    assert.ok(elite?.cars.length);
    for (const car of elite.cars) sim.explodeCar(car, 'ram', 1);
    sim.director._journeyBosses(sim, player, .3); sim._runState(DT);
    assert.equal(verifiedBossClear(sim), true); assert.equal(sim.state, 'run'); assert.equal(sim.won, false);
    const frozen = structuredClone(sim.victoryStats), clearTime = sim.victoryTime;
    run.events = sim.drainEvents();
    const crashEvents = run.events.filter(event => event.t === 'kill' && event.crash && !event.nonScoring);
    assert.ok(crashEvents.length > 0 && crashEvents.some(event => elite.cars.some(car => car.id === event.id)));
    run._simEventsToRun();
    assert.equal(sim.stats.crashKills, (frozen.crashKills || 0) + crashEvents.length);
    assert.ok(run.cash > 0); assert.equal(sim.stats.cash, run.cash);
    // Deliberate later-stat drift is a negative boundary fixture: only the
    // actual Run-owned clearing conversions may be reconciled at handover.
    sim.stats.distance += 400; sim.stats.hits += 5; sim.stats.kills += 7; sim.time += 2;
    assert.equal(run._beginVictoryPresentation(), true);
    assert.deepEqual(sim.victoryStats, { ...frozen, cash: run.cash, crashKills: (frozen.crashKills || 0) + crashEvents.length });
    assert.equal(sim.victoryTime, clearTime);
    const summary = run.buildSummary(true), cash = run.cash;
    assert.equal(summary.crashKills, sim.stats.crashKills); assert.equal(summary.kills, frozen.kills);
    assert.equal(summary.hits, frozen.hits); assert.equal(summary.furthestS, frozen.distance); assert.equal(summary.time, clearTime);
    assert.equal(summary.breakdown.find(line => line.label === 'RAIDERS WRECKED').amount, cash);
    const later = sim.spawnCar('e_sedan', { s: player.s + 90 }); sim.explodeCar(later, 'ram', 1);
    const late = sim.drainEvents();
    assert.ok(late.some(event => event.t === 'kill' && event.id === later.id && event.crash && event.nonScoring));
    run._simEventsToRun(late);
    assert.equal(run.cash, cash); assert.deepEqual(run.buildSummary(true), summary);
  });
});

test('known defeat and a simultaneous fatal crew hit cannot become a later celebration', async () => {
  for (const phase of ['run', 'dying', 'over']) {
    await fixture({ bossApproach: true }, ({ run, sim, player }) => {
      sim.damageCrew(player, 'gunner', 1e9, { src: 2, cause: 'bullet' });
      if (phase !== 'run') { sim.state = phase; sim.result = { why: 'gunner' }; }
      sim.director._journeyBosses(sim, player, .3);
      for (const boss of sim.director.activeElite.cars) sim.explodeCar(boss, 'bullet', 1);
      sim.director._journeyBosses(sim, player, .3); sim._runState(DT);
      assert.equal(run._beginVictoryPresentation(), false); assert.equal(sim.victoryPresentation, false);
      assert.equal(sim.result.why, 'gunner'); assert.equal(sim.won, false);
    });
  }
});

test('real Run.update drives both seats beneath naturally reached results after registered boss clear', async () => {
  await fixture({ role: 'solo', bossApproach: true }, ({ run, sim, player, profile }) => {
    // Declared source-generated terrain/asphalt/branch CPU scope at the authored boss approach.
    // Kill actual retained Director boss bodies through production explosion;
    // do not inject complete flags or force over/won/results timing.
    const beforeProfile = structuredClone(profile), beforeOwnership = [run.role, run.simPeer, run.humanDriver, run.humanGunner];
    const elite = actualChapterDeath(sim);
    assert.ok(elite.cars.every(car => sim.cars.get(car.id) === car && car.exploded));
    assert.equal(verifiedBossClear(sim), true); assert.equal(sim.state, 'run');
    run.events = sim.drainEvents(); run._simEventsToRun();
    assert.equal(run._beginVictoryPresentation(), true);
    assert.equal(run.aiDriver.run, run); assert.equal(run.aiGunner.run, run);
    const frozenSummary = structuredClone(run.victorySummary), frozenCash = run.cash;
    sim.releaseCar(player); assert.equal(player.held, false);
    const enemy = sim.spawnCar('e_technical', { s: player.s + 60, d: -4, speed: 18 });
    const start = player.s, shots = [], acceptedHits = [], trace = [];
    const emit = sim.emit.bind(sim); sim.emit = event => { if (event.t === 'shot' && event.fromGunner) shots.push(structuredClone(event)); emit(event); };
    const applyHit = sim.applyHit.bind(sim); sim.applyHit = report => {
      const accepted = applyHit(report);
      if (accepted && report.carId === enemy.id) acceptedHits.push({ shotId: report.shotId, zone: report.zone, dmg: report.dmg });
      return accepted;
    };
    let resultsStartS = null;
    for (let frame = 0; frame < 600; frame++) {
      run.update(1 / 60, commands(), frame / 60);
      if (run.finished && resultsStartS === null) resultsStartS = player.s;
      if (frame % 60 === 0) trace.push({ frame, s: player.s, d: player.d, speed: player.veh.speed,
        input: { ...player.veh.input }, state: sim.state, finished: run.finished, shots: shots.length, hits: acceptedHits.length });
      assert.equal(player.veh.input.nitro, false); assert.equal(player.exploded, false);
      assert.equal(player.crew.driver.alive, true); assert.equal(player.crew.gunner.alive, true);
    }
    assert.ok(player.s > start + 50, JSON.stringify(trace));
    assert.ok(Math.abs(player.d) < 8, JSON.stringify(trace));
    assert.ok(shots.length > 0, 'actual temporary AI fires its current gun through Run.update');
    assert.ok(shots.every(event => event.fromGunner && event.origin?.every(Number.isFinite)));
    assert.ok(acceptedHits.length > 0, 'real temporary AI hits are accepted by actual Sim.applyHit for the actual Technical');
    assert.ok(enemy.exploded || enemy.hp < enemy.maxHp || Object.values(enemy.crew).some(crew => crew.hp < crew.max), 'accepted shots damage a real enemy');
    assert.equal(sim.state, 'over'); assert.equal(sim.won, true);
    assert.equal(run.finished, true, 'actual victory and existing results delays complete while driving continues');
    assert.ok(resultsStartS !== null && player.s > resultsStartS + 10, 'actual AI driving continues after Results became available');
    assert.equal(sim.result.why, 'victory'); assert.equal(run.shots, 0, 'presentation shots remain non-scoring');
    assert.equal(run.cash, frozenCash); assert.deepEqual(run.summary, frozenSummary); assert.deepEqual(run.buildSummary(true), frozenSummary);
    assert.deepEqual(profile, beforeProfile, 'no ownership, upgrades or wallet are granted by cosmetic fighting');
    assert.deepEqual([run.role, run.simPeer, run.humanDriver, run.humanGunner], beforeOwnership);
  });
});
test('authoritative celebration rejects remote actions without mutating peer/seat ownership', async () => {
  await fixture({ coop: true }, ({ run, sim }) => {
    sim.director.chapterBossDone.add(1); sim.director.campaignComplete = true; sim._runState(DT); run._beginVictoryPresentation();
    const before = structuredClone(run.gunnerRemote), magazine = run.gunner.mag.slice(), kits = run.medkits;
    for (const message of [{ t: 'input', i: { throttle: 0, brake: 1 } }, { t: 'g', y: 4, p: 1, f: 1, w: 1 },
      { t: 'hit', h: {} }, { t: 'rocket', o: [0, 0, 0], d: [0, 0, 1], cfg: {} },
      { t: 'grenade', o: [0, 0, 0], v: [0, 0, 1], cfg: {} }, { t: 'shotfx', e: [{ t: 'shot' }] }, { t: 'medkit' }]) run.onNet(message);
    assert.deepEqual(run.gunnerRemote, before); assert.deepEqual(run.gunner.mag, magazine);
    assert.equal(run.remoteDriverInput, null); assert.equal(run.medkits, kits); assert.equal(run.shots, 0);
    assert.equal(run.simPeer, true); assert.equal(run.role, 'driver');
  });
});

test('gunner viewer accepts only same-journey authoritative presentation, follows pose and stops local sends', () => {
  for (const role of ['gunner']) {
    const sent = [], profile = DEFAULT_PROFILE(), g = { camera: new THREE.PerspectiveCamera(), hud: { feed() {}, hitMarker() {} } };
    const run = new Run(g, { role, seed: 7, profile, net: { sendJSON: message => sent.push(message) }, journey: { version: 1, mode: 'campaign', level: 1 } });
    const st = makeCarState(1, 'truck_t1', 'player'); run.states.set(1, st); run.simState = 'run'; run.started = true;
    run.gunner = new GunnerController({ weapons: ['smg', 'pistol'] }, { emit() {} }); run.gunner.mag[0] = 6;
    for (const event of [{ t: 'victoryPresentation', mode: 'marathon', level: 1 }, { t: 'victoryPresentation', mode: 'campaign', level: 2 }]) {
      run.onNet({ t: 'events', e: [event] }); assert.equal(victoryPresenting(run), false);
    }
    run.onNet({ t: 'events', e: [{ t: 'victoryPresentation', mode: 'campaign', level: 1 }] });
    assert.equal(victoryPresenting(run), true); assert.equal(canCaptureRun(run), false);
    st.gunner = { ...st.gunner, yaw: .9, pitch: -.2, ads: true, weapon: 1, reloading: true };
    run._syncVictoryGunnerPose(st); assert.equal(run.gunner.yaw, .9); assert.equal(run.gunner.cur, 1);
    assert.equal(run.gunner.reloading, true); assert.equal(run.gunner.trigger, false); assert.equal(run.gunner.mag[0], 6);
    run.outEvents.push({ t: 'shot' }); run._sendGunner(1); run._medkit();
    assert.equal(sent.length, 0); assert.equal(run.outEvents.length, 0); assert.equal(run.sim, null);
    run.dispose();
  }
});

test('viewer reliable loss/negative final summary rejects a late presentation proof', () => {
  for (const loss of [{ _defeatWhy: 'gunner' }, { remoteSummary: { won: false, cause: 'GUNNER KILLED' } }, { summary: { cause: 'DRIVER KILLED' } }]) {
    const run = { journey: { mode: 'campaign', level: 1 }, simState: 'dying', states: new Map(), ...loss };
    rememberDefeat(run, [{ t: 'victoryPresentation', mode: 'campaign', level: 1 }]);
    assert.equal(run.victoryPresentation, undefined); assert.equal(victoryPresenting(run), false);
  }
});

test('viewer reliable loss after a valid proof clears stored celebration and restores actual defeat camera and nonfiring control dispatch', () => {
  for (const message of [
    { t: 'events', e: [{ t: 'playerDown', why: 'gunner' }] },
    { t: 'events', e: [{ t: 'runOver', why: 'car' }] },
    { t: 'summary', s: { won: false, cause: 'GUNNER KILLED' } },
    { t: 'summary', s: { won: true, cause: 'DRIVER KILLED' } },
  ]) {
    const sent = [], profile = DEFAULT_PROFILE();
    profile.weapons.smg = { dmg: 0, mag: 0, rel: 0, hnd: 0 }; profile.loadout = ['smg', 'pistol'];
    const setup = buildPlayerSpec(profile), noop = () => {};
    const g = { camera: new THREE.PerspectiveCamera(85, 16 / 9, .15, 1000), scene: new THREE.Scene(),
      input: { lastDevice: 'kbm', rumble: noop }, hud: { feed: noop, hitMarker: noop, setVisible: noop, message: noop, damageFlash: noop }, fade: noop };
    const run = new Run(g, { role: 'gunner', seed: 7, profile, net: { sendJSON: value => sent.push(structuredClone(value)) },
      journey: { mode: 'campaign', level: 1 } });
    Object.assign(run, { spec: setup.spec, effects: setup.effects, simState: 'run', started: true, introDone: true,
      wv: { viewMap: new Map(), cars: new Map(), updateBoss: noop, update: noop, handleEvent: noop, dispose: noop,
        muzzlePos(_state, out) { out.set(0, 2, 1); return true; }, notifyLocalShot: noop },
      hazMarks: { update: noop, dispose: noop }, banner: { update: noop, dispose: noop },
      threatHud: { setVisible: noop, update: noop, dispose: noop }, bossMarks: { update: noop, dispose: noop },
      bossState: { pos: new THREE.Vector3(0, 0, 80), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), dead: true, exploded: true } });
    const state = makeCarState(1, setup.spec.id, 'player'); run.states.set(1, state);
    run.gunner = new GunnerController(gunnerLoadout(setup.effects), run._gunnerCtx());
    try {
      run.onNet({ t: 'events', e: [{ t: 'victoryPresentation', mode: 'campaign', level: 1 }] });
      assert.equal(victoryPresenting(run), true); assert.equal(run.victoryPresentation, true);
      // Casual terminal snapshots cannot reveal reliable-event ordering and
      // must not erase the earlier proof by themselves.
      run.simState = 'dying'; state.gunnerAlive = false;
      rememberDefeat(run); assert.equal(victoryPresenting(run), true); assert.equal(run.victoryPresentation, true);
      state.gunner = { ...state.gunner, yaw: .9, pitch: -.2, ads: true, weapon: 1, reloading: true };
      run.gunner.yaw = -.5; run.gunner.pitch = 0;
      run.outEvents.push({ t: 'shot' }); run._sendGunner(1);
      assert.equal(sent.length, 0); assert.equal(run.outEvents.length, 0);
      run.onNet(message);
      assert.equal(run._victorySeen, true, 'the previously received proof remains historical');
      assert.equal(run.victoryPresentation, false); assert.equal(victoryPresenting(run), false);
      assert.equal(isDefeated(run), true); assert.equal(canCaptureRun(run), false);
      const input = commands(); input.gunner.dYaw = input.gunner.dPitch = 0;
      const magazine = run.gunner.magNow;
      run.update(1 / 30, input, 1 / 30);
      assert.ok(run.deathFrom && run.deathCamT > 0, 'actual camera uses defeat rather than the stale victory chase');
      assert.equal(run.chase.mode, 0); assert.equal(run.gunner.yaw, -.5, 'the obsolete authoritative celebration pose is not reapplied');
      assert.equal(input.gunner.fire, false); assert.equal(input.gunner.firePressed, false);
      assert.equal(input.gunner.reload, false); assert.equal(input.gunner.grenade, false);
      assert.equal(run.gunner.magNow, magazine); assert.equal(run.gunner.trigger, false);
      assert.ok(sent.some(value => value.t === 'g' && value.f === 0), 'ordinary nonfiring viewer pose dispatch is no longer suppressed by a stale flag');
      assert.ok(sent.every(value => !['hit', 'rocket', 'grenade', 'shotfx'].includes(value.t)), 'loss controls cannot fire or send damage');
      run.onNet({ t: 'events', e: [{ t: 'victoryPresentation', mode: 'campaign', level: 1 }] });
      assert.equal(run.victoryPresentation, false, 'a later proof cannot reverse authoritative loss');
    } finally { run.dispose(); }
  }
});

test('summary publication and teardown remain once per Run, and a fresh life has no takeover', async () => {
  await fixture({ coop: true }, ({ run, sim, sent }) => {
    sim.director.chapterBossDone.add(1); sim.director.campaignComplete = true; sim._runState(DT); run._beginVictoryPresentation();
    sim.won = true; sim.state = 'over'; run.over = true;
    run._outcome(.31); const summary = structuredClone(run.summary);
    run._outcome(10); run._outcome(10);
    assert.equal(sent.filter(m => m.t === 'summary').length, 1); assert.deepEqual(run.summary, summary);
    const controllers = run._victoryControls; run.dispose(); run.dispose();
    assert.equal(sim.world, null); assert.equal(sim.cars.size, 0); assert.equal(run.aiDriver, null); assert.equal(run.aiGunner, null);
    assert.equal(run.gunner, null); assert.equal(run._victoryControls, null); assert.ok(controllers.driver !== controllers.gunner);
  });
  await fixture({ role: 'solo' }, ({ run, sim }) => {
    assert.equal(run.victoryPresentation, false); assert.equal(sim.victoryPresentation, false);
    assert.equal(run._beginVictoryPresentation(), false); assert.equal(canCaptureRun(run), true);
  });
});

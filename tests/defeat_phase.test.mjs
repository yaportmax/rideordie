import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
import { Run } from '../src/game/run.js';
import { Game } from '../src/game/game.js';
import { Sim } from '../src/sim/sim.js';
import { makeCarState, stateFromCar } from '../src/view/car_state.js';
import { canCaptureRun, runPhase, defeatReason, isDefeated, rememberDefeat } from '../src/game/run_status.js';

const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let App;
try { ({ App } = await import('../src/app.js')); } finally { css.deregister(); }

function live(role = 'gunner', phase = 'run', authority = false) {
  const run = Object.create(Run.prototype), p = makeCarState(1, 'truck_t1', 'player');
  Object.assign(run, { role, playerId: 1, started: true, over: false, humanDriver: role === 'driver' || role === 'solo',
    humanGunner: role !== 'driver', states: new Map([[1, p]]), simState: phase, cinematic: false, introOutside: false,
    ...(authority ? { sim: { state: phase, won: false } } : {}) });
  return { run, p };
}

test('mouse capture uses explicit phase, living player hull and playable camera on both peers', () => {
  for (const authority of [false, true]) for (const role of ['driver', 'gunner', 'solo']) {
    const { run, p } = live(role, 'run', authority);
    assert.equal(canCaptureRun(run), true, `${role} live mouse look remains available`);
    for (const phase of ['countdown', 'dying', 'over']) {
      if (authority) run.sim.state = phase; else run.simState = phase;
      assert.equal(canCaptureRun(run), false);
    }
    if (authority) run.sim.state = 'run'; else run.simState = 'run';
    for (const key of ['cinematic', 'introOutside', 'over']) {
      run[key] = true; assert.equal(canCaptureRun(run), false); run[key] = false;
    }
    run.started = false; assert.equal(canCaptureRun(run), false); run.started = true;
    p.driverAlive = p.gunnerAlive = false;
    rememberDefeat(run, [{ t: 'playerDown', why: 'driver' }, { t: 'runOver', why: 'gunner' }]);
    assert.equal(isDefeated(run), false, 'obsolete crew-loss reasons cannot defeat a living player hull');
    assert.equal(canCaptureRun(run), true, 'obsolete crew flags do not disable a living player hull');
    p.hp01 = 0;
    assert.equal(canCaptureRun(run), true, 'a quantized-zero HP byte is not an authoritative terminal flag');
    p.dead = true; assert.equal(canCaptureRun(run), false); p.dead = false;
    p.exploded = true; assert.equal(canCaptureRun(run), false); p.exploded = false;
    run.states.clear(); assert.equal(canCaptureRun(run), false);
  }
  assert.equal(runPhase({ started: true, over: false }), 'countdown', 'missing sim/snapshot is not playable');
  assert.equal(canCaptureRun(null), false);
});

test('existing reliable terminal events suppress capture before the next snapshot without host cash conversions', () => {
  for (const role of ['driver', 'gunner']) {
    const { run, p } = live(role);
    run.onNet({ t: 'events', e: [{ t: 'playerDown', why: 'car' }, { t: 'kill', spec: 'sedan' }] });
    assert.equal(run.phase, 'run', 'telemetry retains the actual last snapshot phase');
    assert.equal(run.defeated, true); assert.equal(run.defeatReason, 'car'); assert.equal(canCaptureRun(run), false);
    assert.equal(run.sim, undefined); assert.equal(run.cash, undefined);
    assert.equal(run.netEvents.length, 2, 'view/FX events still drain normally');
    run.simState = 'dying'; p.hp01 = 0; p.dead = p.exploded = true; p.driverAlive = p.gunnerAlive = false;
    rememberDefeat(run); assert.equal(run.defeatReason, 'car');
    run.onNet({ t: 'events', e: [{ t: 'runOver', why: 'car' }] });
    run.simState = 'over'; assert.equal(run.defeatReason, 'car');
  }
});

test('snapshot fallback persists terminal hull loss and late authoritative cause corrects an ambiguous wreck', () => {
  const { run, p } = live('gunner', 'dying'); p.hp01 = 0; p.dead = true;
  rememberDefeat(run); assert.equal(defeatReason(run), 'wrecked');
  p.exploded = true; p.driverAlive = false; rememberDefeat(run);
  assert.equal(defeatReason(run), 'wrecked', 'later wreck flags cannot invent an authoritative cause');
  const late = live('driver', 'over'); late.p.hp01 = 0; late.p.dead = late.p.exploded = true; late.p.driverAlive = late.p.gunnerAlive = false;
  rememberDefeat(late.run); assert.equal(late.run.defeatReason, 'wrecked');
  late.run.onNet({ t: 'events', e: [{ t: 'playerDown', why: 'driver' }] });
  assert.equal(late.run.defeatReason, 'wrecked', 'obsolete crew reasons cannot replace hull loss');
  late.run.onNet({ t: 'summary', s: { won: false, cause: 'TRUCK DESTROYED' } });
  assert.equal(late.run.defeatReason, 'car', 'authorized final summary takes priority over interim cause');
});

test('a viewer terminal packet cannot change the healthy simulation authority status', () => {
  const { run } = live('driver', 'run', true);
  run.onNet({ t: 'events', e: [{ t: 'playerDown', why: 'car' }, { t: 'runOver', why: 'car' }] });
  assert.equal(run.defeated, false); assert.equal(run.defeatReason, null); assert.equal(canCaptureRun(run), true);
  assert.equal(run.netEvents.length, 2, 'existing unconsumed host queue behavior is unchanged');
  rememberDefeat(run, [{ t: 'playerDown', why: 'car', remote: true }]);
  assert.equal(run.defeated, false, 'remote shot FX cannot authorize an authority defeat');
});

test('victory arriving before or after over never displays a defeat reason or permits capture', () => {
  for (const proof of ['sim', 'result', 'event', 'summary', 'remoteSummary']) {
    const { run, p } = live('gunner', 'over'); p.hp01 = 0; p.dead = p.exploded = true; p.driverAlive = p.gunnerAlive = false;
    rememberDefeat(run); assert.equal(run.defeated, true);
    if (proof === 'sim') run.sim = { state: 'over', won: true };
    if (proof === 'result') run.sim = { state: 'over', result: { why: 'victory' } };
    if (proof === 'event') run.onNet({ t: 'events', e: [{ t: 'runOver', why: 'victory' }] });
    if (proof === 'summary') run.summary = { won: true };
    if (proof === 'remoteSummary') run.onNet({ t: 'summary', s: { won: true } });
    assert.equal(run.defeated, false, proof); assert.equal(run.defeatReason, null); assert.equal(canCaptureRun(run), false);
  }
  const { run } = live('gunner', 'over');
  assert.equal(run.defeated, false, 'over with living hull and no reason cannot be guessed as loss');
  run.onNet({ t: 'events', e: [{ t: 'runOver', why: 'victory' }] });
  assert.equal(run.defeated, false);
  const provisional = live('gunner'); provisional.run.bossState = { exploded: true };
  assert.equal(provisional.run.defeated, false); assert.equal(canCaptureRun(provisional.run), false);
});

test('late boss explosion cannot turn an already-authoritative hull defeat into victory', () => {
  for (const authority of [false, true]) {
    const { run, p } = live('gunner', 'dying', authority); p.hp01 = 0; p.dead = p.exploded = true;
    if (authority) run.sim.result = { why: 'car' };
    else run.onNet({ t: 'events', e: [{ t: 'playerDown', why: 'car' }] });
    run.bossState = { exploded: true }; rememberDefeat(run);
    assert.equal(run.defeated, true); assert.equal(run.defeatReason, 'car'); assert.equal(canCaptureRun(run), false);
    run.remoteSummary = { won: false, cause: 'TRUCK DESTROYED' };
    assert.equal(run.defeated, true); assert.equal(run.defeatReason, 'car');
  }
});

test('actual camera switches a provisional finale to the defeat orbit and restores only its own HUD hide', t => {
  const oldWindow = globalThis.window; globalThis.window = {};
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  const { run, p } = live('gunner'), shown = [];
  run.g = { camera: new THREE.PerspectiveCamera(), hud: { setVisible(v) { shown.push(v); } } };
  run._worldRay = () => null; run._groundY = () => null;
  run.bossState = { pos: new THREE.Vector3(20, 0, 100), dead: true, exploded: false };
  run._camera(1 / 60, { driver: {}, gunner: {} }, p);
  assert.equal(run.cinematic, true); assert.equal(run._finaleHudHidden, true); assert.deepEqual(shown, [false]);
  run.simState = 'dying'; p.hp01 = 0; p.dead = p.exploded = true; run.bossState.exploded = true;
  run.onNet({ t: 'events', e: [{ t: 'playerDown', why: 'car' }] });
  run._camera(1 / 60, { driver: {}, gunner: {} }, p);
  assert.ok(run.deathFrom); assert.ok(run.deathCamT > 0); assert.equal(run.defeatReason, 'car');
  assert.deepEqual(shown, [false, true]); assert.equal(run._finaleHudHidden, false);
  run._finaleHudHidden = true; window.__app = { game: run.g, screen: 'results' };
  run._camera(1 / 60, { driver: {}, gunner: {} }, p);
  assert.deepEqual(shown, [false, true], 'results HUD visibility cannot be overwritten by the run');
});

function gameFixture(t, run) {
  const oldWindow = globalThis.window; globalThis.window = {};
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  const reasons = [], locks = [], game = Object.create(Game.prototype);
  Object.assign(game, { mode: 'run', run, paused: false, frames: 1, camera: new THREE.PerspectiveCamera(),
    input: { lastDevice: 'kbm', locked: false, requestLock() { locks.push('lock'); }, hit: () => false, edge: () => false,
      driver: () => ({}), gunner: () => ({}), solo: () => ({ driver: {}, gunner: {} }) },
    sky: { setLook() {}, update() {} }, lampLights: { update() {} }, headlights: [],
    renderer: { render() {}, info: { render: { calls: 0, triangles: 0 } } },
    hud: { update() {}, setDefeat(why) { reasons.push(why); } }, _lockEl: { style: {} },
    perf: { sim: 0, render: 0, frame: 16.7, fps: 60, worst: 0 },
  });
  Object.assign(run, { spec: run.states.get(1).spec, hud2: {}, wv: { cars: new Map() }, update() {} });
  return { game, reasons, locks };
}

test('actual frame prompt and canvas handler agree through defeat, paused co-op, victory and a new run', t => {
  const f = live(), { game, reasons, locks } = gameFixture(t, f.run);
  game._runFrame(1 / 60, 1000); assert.equal(game._lockEl.style.display, 'block');
  assert.equal(game._captureRunPointer(), true); assert.equal(locks.length, 1);
  f.run.simState = 'dying'; f.p.hp01 = 0; f.p.dead = f.p.exploded = true;
  rememberDefeat(f.run, [{ t: 'playerDown', why: 'car' }]);
  game._runFrame(1 / 60, 1017); assert.equal(game._lockEl.style.display, 'none'); assert.equal(reasons.at(-1), 'car');
  assert.equal(game._captureRunPointer(), false); assert.equal(locks.length, 1);
  game.paused = true; f.run.net = {};
  game._runFrame(1 / 60, 1034); assert.equal(reasons.at(-1), 'car', 'co-op pause does not suppress terminal status');
  f.run.remoteSummary = { won: true }; game._runFrame(1 / 60, 1050); assert.equal(reasons.at(-1), null);
  const fresh = live('driver'); game.run = fresh.run; game.paused = false;
  assert.equal(game._captureRunPointer(), true, 'new live driver run retains capture');
});

function appFixture(run) {
  const shown = [], resets = [], locks = [], app = Object.create(App.prototype);
  Object.assign(app, { game: { run, paused: false }, screen: 'run', mode: run.net ? 'coop' : 'solo', _flowId: 1, session: null,
    input: { releaseLock() { locks.push('release'); }, reset() { resets.push('reset'); }, requestLock() { locks.push('capture'); } },
    ui: { showPause(cbs) { shown.push(cbs); }, hideAll() { shown.push('hide'); } },
  });
  return { app, shown, resets, locks };
}

test('healthy focus pause still resets input; defeat cannot create a new pause or capture on late resume', () => {
  for (const coop of [false, true]) {
    const { run, p } = live('gunner', 'run', !coop); if (coop) run.net = {};
    const f = appFixture(run); f.app._pause();
    assert.equal(f.app.game.paused, true); assert.equal(f.shown.length, 1); assert.equal(f.resets.length, 1);
    if (coop) run.simState = 'dying'; else run.sim.state = 'dying';
    p.hp01 = 0; p.dead = p.exploded = true; rememberDefeat(run, [{ t: 'playerDown', why: 'car' }]);
    f.app._pause(); assert.equal(f.shown.length, 1, 'already-owned pause remains unchanged');
    f.shown[0].onResume(); assert.equal(f.app.game.paused, false); assert.deepEqual(f.locks, ['release']);
    assert.equal(f.resets.length, 2);
    f.app._pause(); assert.equal(f.app.game.paused, false); assert.equal(f.shown.length, 2, 'no new defeat pause overlay');
  }
});

test('actual fatal hull damage keeps its cause through explosion and unchanged results threshold', async t => {
  const oldRaf = globalThis.requestAnimationFrame, callbacks = [];
  globalThis.requestAnimationFrame = cb => { callbacks.push(cb); return callbacks.length; };
  t.after(() => { if (oldRaf === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = oldRaf; });
  const sim = await new Sim({ seed: 7 }).init();
  try {
    sim.systems.length = 0; const p = sim.spawnCar('truck_t1', { s: 40, kind: 'player', hold: true }); sim.start();
    const f = live('gunner', 'run', true); f.run.sim = sim; f.run.cfg = { startS: 40 };
    Object.assign(f.run, { id: 'fatal-hull', cash: 0, shots: 0, effects: { cashMul: 1 } });
    sim.damageCar(p, p.maxHp + 1, { src: 2, cause: 'shot' });
    sim._runState(1 / 120); stateFromCar(p, 0, f.p);
    const terminalEvents = sim.drainEvents(); rememberDefeat(f.run, terminalEvents);
    assert.equal(sim.state, 'dying'); assert.equal(p.hp, 0); assert.equal(p.dead, true); assert.equal(p.exploded, true);
    assert.equal(terminalEvents.filter(e => e.t === 'playerDown' && e.why === 'car').length, 1);
    assert.equal(terminalEvents.filter(e => e.t === 'explode' && e.id === p.id).length, 1);
    assert.equal(f.run.defeatReason, 'car'); assert.equal(canCaptureRun(f.run), false);
    sim.boss = { exploded: true, blastParts() {} }; f.run.bossState = { exploded: true };
    sim._runState(1 / 120); assert.equal(sim.won, false); assert.equal(sim.result.why, 'car');
    assert.equal(f.run.defeatReason, 'car', 'a later boss explosion does not award victory during dying');
    const a = appFixture(f.run); let results = 0;
    a.app.game.onRunEnd = () => { results++; };
    App.prototype._watchEnd.call(a.app, f.run);
    a.app._pause(); assert.equal(a.app.game.paused, false, 'native focus handler routes here and cannot stop the timer');
    sim.stateT = 1.5; sim._runState(1 / 120); stateFromCar(p, 0, f.p);
    const laterEvents = sim.drainEvents(); rememberDefeat(f.run, laterEvents);
    assert.equal(p.exploded, true); assert.equal(f.run.defeatReason, 'car');
    assert.equal(laterEvents.filter(e => e.t === 'explode' && e.id === p.id).length, 0, 'terminal wreck does not explode twice');
    sim.stateT = 2.299; callbacks.shift()(); assert.equal(results, 0); assert.equal(f.run.summary, undefined);
    sim.stateT = 2.3; callbacks.shift()(); assert.equal(results, 1); assert.equal(f.run.summary.cause, 'TRUCK DESTROYED');
    callbacks.shift()(); assert.equal(results, 1, 'summary notification remains one-shot');
    sim.stateT = 3.3; sim._runState(1 / 120); rememberDefeat(f.run, sim.drainEvents());
    assert.equal(sim.state, 'over'); assert.equal(f.run.defeatReason, 'car');
  } finally { sim.dispose(); }
});

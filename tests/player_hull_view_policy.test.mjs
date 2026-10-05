// Source-only draft. Copy to repository tests/ before running against the
// integrated shared-player-hull policy. No import/parser/test run by author.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Run } from '../src/game/run.js';
import { Game } from '../src/game/game.js';
import { GunnerController } from '../src/game/gunner.js';
import { WorldView } from '../src/game/world_view.js';
import { Hud } from '../src/ui/hud.js';
import { Cockpit } from '../src/view/cockpit.js';
import { makeCarState } from '../src/view/car_state.js';
import { buildPlayerSpec } from '../src/game/run_setup.js';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { canCaptureRun, defeatReason, rememberDefeat } from '../src/game/run_status.js';

const DT = 1 / 60;
const noop = () => {};
function globals(t, values) {
  const saved = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
}
function live(role = 'gunner') {
  const p = makeCarState(1, 'truck_t1', 'player');
  p.hp01 = .7; p.driverAlive = p.gunnerAlive = false;
  const run = Object.create(Run.prototype);
  Object.assign(run, { role, playerId: 1, started: true, over: false, simState: 'run',
    humanDriver: role === 'driver' || role === 'solo', humanGunner: role !== 'driver',
    states: new Map([[1, p]]), cinematic: false, introOutside: false });
  return { run, p };
}

test('actual run policy keeps every player seat usable with positive hull and legacy dead crew bits', () => {
  for (const role of ['driver', 'gunner', 'solo']) {
    const { run, p } = live(role);
    assert.equal(defeatReason(run), null, role);
    assert.equal(canCaptureRun(run), true, `${role} uses hull survival`);
    for (const phase of ['countdown', 'dying', 'over']) {
      run.simState = phase;
      assert.equal(canCaptureRun(run), false, `${role}/${phase} still blocks capture`);
    }
    run.simState = 'run';
    for (const key of ['cinematic', 'introOutside', 'over']) {
      run[key] = true; assert.equal(canCaptureRun(run), false); run[key] = false;
    }
    p.hp01 = 0;
    assert.equal(canCaptureRun(run), true, `${role} rounded wire zero is not a terminal flag`);
    p.hp01 = .7; p.exploded = true; assert.equal(canCaptureRun(run), false);
    p.exploded = false; p.dead = true; assert.equal(canCaptureRun(run), false);
  }
});

test('actual reliable crew reasons do not defeat the player; authoritative car loss still precedes the next snapshot', () => {
  const { run } = live();
  run.onNet({ t: 'events', e: [{ t: 'playerDown', why: 'gunner' }, { t: 'runOver', why: 'driver' }] });
  assert.equal(run.defeated, false); assert.equal(canCaptureRun(run), true);
  assert.equal(run.phase, 'run', 'legacy reasons do not rewrite phase');
  assert.equal(run.sim, undefined, 'view policy cannot create authority');
  run.onNet({ t: 'events', e: [{ t: 'playerDown', why: 'car' }] });
  assert.equal(run.defeated, true); assert.equal(canCaptureRun(run), false);
  assert.equal(run.defeatReason, 'car', 'a current authorized hull-loss event wins over a previous positive-HP snapshot');
  const authority = live().run; authority.sim = { state: 'run', won: false };
  rememberDefeat(authority, [{ t: 'playerDown', why: 'car', remote: true }]);
  assert.equal(authority.defeated, false, 'remote FX cannot authorize host failure');
});

test('actual canvas capture handler follows shared hull without a replacement input implementation', t => {
  globals(t, { window: {} });
  const { run, p } = live(), calls = [], game = Object.create(Game.prototype);
  Object.assign(game, { mode: 'run', paused: false, run,
    input: { requestLock: () => calls.push('capture') } });
  assert.equal(game._captureRunPointer(), true); assert.equal(calls.length, 1);
  p.hp01 = 0; assert.equal(game._captureRunPointer(), true); assert.equal(calls.length, 2);
  p.dead = true; assert.equal(game._captureRunPointer(), false); assert.equal(calls.length, 2);
  p.hp01 = .7; game.paused = true; assert.equal(game._captureRunPointer(), false);
});

// Uses the actual Run.update camera/control/fire order and actual controller.
// View/DOM/resource consumers are neutral stubs; this is not a rendered or
// physical driving check. Legacy false crew bits are an explicit fixture.
function viewer(t) {
  globals(t, { window: {}, innerWidth: 1280, innerHeight: 720 });
  const profile = DEFAULT_PROFILE(), setup = buildPlayerSpec(profile), sent = [];
  const g = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(80, 16 / 9, .05, 1000),
    input: { lastDevice: 'kbm', rumble: noop }, paused: false, fade: noop,
    hud: { el: null, gh: null, message: noop, feed: noop, hitMarker: noop,
      damageFlash: noop, setVisible: noop } };
  const run = new Run(g, { role: 'gunner', seed: 7, profile,
    net: { sendJSON: m => { sent.push(m); return true; } }, runId: 'shared-hull-view-draft' });
  const p = makeCarState(1, setup.spec.id, 'player'); p.hp01 = .7;
  p.driverAlive = p.gunnerAlive = false;
  Object.assign(run, { spec: setup.spec, effects: setup.effects, simState: 'run', started: true,
    introDone: true, introOutside: false, groundOk: true, playerS: 40,
    structures: { updateRocks: noop, dispose: noop },
    wv: { viewMap: new Map(), cars: new Map(), updateBoss: noop, update: noop,
      handleEvent: noop, notifyLocalShot: noop, dispose: noop,
      muzzlePos(st, out) { run._gunnerEye(st, out); return true; } },
    hazMarks: { update: noop, handleEvent: noop, dispose: noop },
    banner: { update: noop, miniboss: noop, hazard: noop, event: noop, bossBeat: noop, dispose: noop },
    threatHud: { setVisible: noop, update: noop, dispose: noop } });
  run.states.set(1, p);
  run.gunner = new GunnerController({ weapons: ['smg'], grenades: 2 }, run._gunnerCtx());
  t.after(() => run.dispose());
  const frame = extra => run.update(DT, { driver: {}, gunner: { dYaw: 0, dPitch: 0,
    slot: -1, swap: 0, fire: false, firePressed: false, ads: false, reload: false,
    grenade: false, medkit: false, ...extra } }, run.time + DT);
  return { run, p, sent, frame };
}

test('actual viewer Run keeps gunner fire, reload, grenade and aim usable despite stale crew flags', t => {
  const { run, frame } = viewer(t);
  frame({ fire: true, firePressed: true, dYaw: .15 });
  assert.ok(run.gunner.shots > 0, 'actual finishFire commits a shot');
  assert.ok(run.gunner.yaw > .1); assert.equal(run.defeated, false);
  frame({ reload: true }); assert.equal(run.gunner.reloading, true, 'Run must not clear reload');
});

test('actual viewer Run keeps grenade action at positive hull and suppresses actions on hull failure', t => {
  const { run, p, sent, frame } = viewer(t);
  frame({ grenade: true });
  assert.equal(run.gunner.grenades, 1);
  assert.ok(sent.some(m => m.t === 'grenade'), 'actual controller uses the existing Run network path');
  const shots = run.gunner.shots;
  p.hp01 = 0; p.dead = p.exploded = true;
  run.simState = 'dying'; rememberDefeat(run, [{ t: 'playerDown', why: 'car' }]);
  frame({ fire: true, firePressed: true, grenade: true, reload: true });
  assert.equal(run.gunner.shots, shots); assert.equal(canCaptureRun(run), false);
  assert.equal(run.defeated, true);
});

test('actual HUD persistent low-health warning follows the one hull value', () => {
  const node = () => ({ style: {}, textContent: '' }), hud = Object.create(Hud.prototype);
  Object.assign(hud, { q: { spd: node(), rpm: node(), nitro: node(), nitroBox: node(),
    nitroStatus: node(), hp: node(), area: node(), boss: node(), vig: node(),
    combatCombo: node(), arrows: node() }, el: { style: {} }, gunnerOn: true,
    gh: { update: noop }, vigT: 0, msgT: 0, combatT: 0, arrowPool: [] });
  const data = { speed: 0, rpm01: .2, nitro01: 0, nitroMax: 0, hp01: .8,
    dhp01: 0, ghp01: 0, arrows: [] };
  hud.update(DT, data, false);
  assert.equal(Number(hud.q.vig.style.opacity), 0, 'legacy crew HP cannot tint a healthy hull');
  hud.update(DT, { ...data, hp01: .1, dhp01: 1, ghp01: 1 }, false);
  assert.ok(Number(hud.q.vig.style.opacity) > 0, 'low hull still produces a warning');
});

test('actual cockpit drawing no longer presents independent crew-health lamps', () => {
  const labels = [], ctx = { fillRect: noop, beginPath: noop, arc: noop, fill: noop,
    stroke: noop, moveTo: noop, lineTo: noop, fillText: text => labels.push(text) };
  const cockpit = Object.assign(Object.create(Cockpit.prototype), { faceCtx: ctx,
    faceTex: { needsUpdate: false }, faceKey: '' });
  cockpit._drawFace({ speed: 0, nitro01: 0, hp01: .8, dhp01: 0, ghp01: 0 }, true);
  assert.equal(labels.includes('DRV'), false); assert.equal(labels.includes('GUN'), false);
});

function world() {
  const wv = Object.assign(Object.create(WorldView.prototype), { cars: new Map(),
    loose: [], debris: { update: noop }, playerWeapon: 'pistol' });
  wv.ensure = st => wv.cars.get(st.id);
  wv._damageVisuals = wv._projectiles = noop;
  const add = (id, kind) => {
    const st = makeCarState(id, kind === 'player' ? 'truck_t1' : 'e_sedan', kind);
    st.hp01 = .8; st.driverAlive = st.gunnerAlive = false;
    const observations = [];
    const crew = { root: { visible: true }, deadT: -1, update: (_, pose) => observations.push(['pose', pose.alive]),
      die: () => observations.push(['die']), flinch: noop };
    const rec = { state: st, wreck: false, view: { update: noop, setLights: noop, setLod: noop },
      crew: { driver: crew }, crewEntries: [{ role: 'driver', crew, pose: {} }] };
    wv.cars.set(id, rec); return { st, rec, observations };
  };
  return { wv, add };
}

test('actual WorldView keeps player poses alive from hull while preserving enemy crew deaths', () => {
  const { wv, add } = world(), player = add(1, 'player'), enemy = add(2, 'enemy');
  const states = new Map([[1, player.st], [2, enemy.st]]);
  wv.update(DT, states, [], { playerId: 1 });
  assert.deepEqual(player.observations, [['pose', true]]);
  assert.deepEqual(enemy.observations, [['pose', false]]);
  wv.handleEvent({ t: 'crewDead', id: 1, role: 'driver' }, states);
  assert.equal(player.observations.some(row => row[0] === 'die'), false, 'stale player crew event cannot eject healthy crew');
  wv.handleEvent({ t: 'crewDead', id: 2, role: 'driver', cause: 'shot', head: true }, states);
  assert.equal(enemy.observations.some(row => row[0] === 'die'), true, 'enemy driver/headshot presentation remains');
});

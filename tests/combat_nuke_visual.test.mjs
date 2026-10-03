// Authored, unrun actual-consumer checks. Real particle buffer writes and Sim
// terminals are CPU scope; no WebGL pixels, native input, audio or FPS claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sim } from '../src/sim/sim.js';
import { Run } from '../src/game/run.js';
import { Fx } from '../src/view/fx.js';
import { ParticleSystem, MODE, STRIDE } from '../src/view/fx/particles.js';
import { SPR } from '../src/view/fx/atlas.js';
import { NUKE_PULSE, validNukeCue } from '../src/view/fx/nuke.js';
import { Hud } from '../src/ui/hud.js';

const cue = (award = 1, runId = 'nuke-visual-life-A', extra = {}) => ({ t: 'combatNuke', runId, award,
  pos: [20, 4, 30], cars: 1, actors: 0, bossDamage: 0, ...extra });
function fxFixture(quality = 2, ground = () => 3) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const fx = new Fx(scene, camera, { quality });
  fx.pa = new ParticleSystem(scene, { cap: 8, uniforms: {}, name: 'nuke-alpha-probe' });
  fx.pf = new ParticleSystem(scene, { cap: 8, uniforms: {}, name: 'nuke-fire-probe' });
  fx.loaded = true; fx.camPos.set(20, 6, 35); fx.groundFn = ground;
  const forbidden = name => () => assert.fail(`single nuke cue cannot invoke ${name}`);
  fx.skid = { clear() {}, dispose() {} }; fx.boss = { clear() {}, explode: forbidden('boss explode') };
  fx.haz = { clear() {}, dispose() {}, igniteNear: forbidden('hazard ignition') };
  fx.lights = []; fx._shake = forbidden('camera shake');
  fx.startSmokeColumn = forbidden('smoke job'); fx.startPop = forbidden('pop job');
  fx.debrisBurst = forbidden('debris'); fx.flashLight = forbidden('point light');
  fx.glowLight = forbidden('glow light'); fx.wreck = forbidden('burning wreck');
  return { fx, scene, dispose: () => fx.dispose() };
}
function runFixture(fx, role = 'driver', isHost = true, runId = 'nuke-visual-life-A') {
  const messages = [];
  const game = { camera: new THREE.PerspectiveCamera(), fx, input: {}, hud: {
    message: (...args) => messages.push(args), setCombat() {}, feed() {}, hitMarker() {}, damageFlash() {},
  } };
  const roles = isHost ? { host: role, guest: role === 'driver' ? 'gunner' : 'driver' } :
    { guest: role, host: role === 'driver' ? 'gunner' : 'driver' };
  const run = new Run(game, { role, seed: 7, runId, net: { isHost, activeRunRoles: roles } });
  if (role === 'driver') run.sim = {}; // Declared ownership only; no fake simulation or frame loop.
  return { run, messages, game };
}
function dispatch(run, fx, events) {
  // Actual source method is the Run.update boundary before HUD/FX/net consumers.
  const accepted = run._filterNukePresentations(events);
  for (const event of accepted) fx.handleEvent(event, { runId: run.id, cameraPos: fx.camPos });
  return accepted;
}

test('actual Sim mints one copied nuke position while ordinary and actor terminals stay quiet', async () => {
  const sim = await new Sim({ seed: 7 }).init();
  try {
    sim.world.gravity = { x: 0, y: 0, z: 0 }; sim.director.enabled = false; sim.director.r = () => .2;
    sim.encounters.plan = []; sim.hazards.update = () => {};
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 40 });
    sim.world.step(sim.eventQueue); for (const car of sim.cars.values()) car.veh.afterStep();
    sim.start(); sim.configureCombat('nuke-visual-life-A', { weapons: ['pistol'], levels: {} });
    for (let i = 0; i < 20; i++) {
      sim.combat.advance(.1); const enemy = sim.spawnCar('e_sedan', { s: 500 + i * 40, d: 30 });
      sim.damageCar(enemy, enemy.hp + 1, { cause: 'bullet', src: 1 });
    }
    const target = sim.spawnCar('e_sedan', { s: 100 });
    const actor = sim.encounters._create(sim, 'tower', { id: 'nuke-visual-site', s0: 100, biome: 'desert' },
      new THREE.Vector3(20, 3, 70), { x: .5, y: 1, z: .5 }, 100);
    const hp = player.hp, stats = sim.stats.kills, position = player.veh.pos.toArray(); sim.drainEvents();
    const result = sim.activateNuke({ t: 'nuke', runId: 'nuke-visual-life-A', seq: 1 });
    assert.equal(result.ok, true); assert.equal(target.exploded, true); assert.equal(actor.dead, true);
    const events = sim.drainEvents(), cues = events.filter(event => event.t === 'combatNuke');
    assert.equal(cues.length, 1); assert.equal(validNukeCue(cues[0], 'nuke-visual-life-A'), true);
    assert.deepEqual(cues[0].pos, position); player.veh.pos.x += 12; assert.deepEqual(cues[0].pos, position);
    assert.equal(player.hp, hp); assert.equal(sim.stats.kills, stats + 2); assert.equal(sim.combat.ready, false);
    assert.equal(events.some(event => ['explode', 'boom', 'stageBreak', 'crewDead'].includes(event.t)), false);
    assert.equal(events.filter(event => event.t === 'kill' && event.nukeDerived).length, 2);
  } finally { sim.dispose(); }
});

test('actual authority/viewer Run consumers show one HUD cue and one particle in both host arrangements', () => {
  for (const isHost of [true, false]) for (const role of ['driver', 'gunner']) {
    const f = fxFixture(), { run, messages } = runFixture(f.fx, role, isHost);
    try {
      const event = cue(); let events;
      if (role === 'gunner') {
        const message = { t: 'events', runId: run.id, e: [event] };
        run.onNet(message); run.onNet(message); assert.equal(run.netEvents.length, 1);
        events = run.netEvents; run.netEvents = [];
      } else events = [event, structuredClone(event)];
      assert.equal(dispatch(run, f.fx, events).length, 1);
      assert.deepEqual(messages, [['NUKE DETONATED', 850, '#ffc93a']]);
      assert.equal(f.fx.pf.spawned, 1); assert.equal(run.nukePresentedAward, 1);
      assert.deepEqual(dispatch(run, f.fx, [structuredClone(event)]), []);
      assert.equal(messages.length, 1); assert.equal(f.fx.pf.spawned, 1);
    } finally { f.dispose(); }
  }
});

test('actual Run validation rejects malformed or stale awards before poisoning valid presentation', () => {
  for (const isHost of [true, false]) {
    const f = fxFixture(), { run, messages } = runFixture(f.fx, 'gunner', isHost);
    try {
      const malformed = [cue(9, 'old-life'), cue(9, run.id, { pos: [Infinity, 0, 0] }),
        cue(9, run.id, { pos: [0, 0] }), cue(9, run.id, { award: .5 }), cue(9, run.id, { cars: 65 }),
        cue(9, run.id, { actors: -1 }), cue(9, run.id, { bossDamage: 301 })];
      for (const event of malformed) run.onNet({ t: 'events', runId: run.id, e: [event] });
      assert.equal(run.netEvents?.length || 0, 0); assert.equal(run.nukeShownAward, 0);
      assert.deepEqual(dispatch(run, f.fx, malformed), []); assert.equal(run.nukePresentedAward, 0);
      const driverKey = isHost ? 'guest' : 'host'; run.net.activeRunRoles[driverKey] = 'gunner';
      run.onNet({ t: 'events', runId: run.id, e: [cue()] }); assert.equal(run.netEvents?.length || 0, 0);
      run.net.activeRunRoles[driverKey] = 'driver';
      run.onNet({ t: 'events', runId: 'old-life', e: [cue()] }); assert.equal(run.netEvents?.length || 0, 0);
      run.onNet({ t: 'events', runId: run.id, e: [cue()] }); dispatch(run, f.fx, run.netEvents);
      assert.equal(messages.length, 1); assert.equal(f.fx.pf.spawned, 1);
    } finally { f.dispose(); }
  }
});

test('actual Fx writes exactly one bounded SHOCK descriptor on every FX tier independent of target counts', () => {
  let descriptor;
  for (const quality of [0, 1, 2, 3]) for (const counts of [{ cars: 0, actors: 0 }, { cars: 64, actors: 48 }]) {
    const f = fxFixture(quality);
    try {
      const members = f.scene.children.length;
      f.fx.handleEvent(cue(1, 'nuke-visual-life-A', counts), { runId: 'nuke-visual-life-A' });
      assert.equal(f.fx.pf.spawned, 1); assert.equal(f.fx.pa.spawned, 0); assert.equal(f.scene.children.length, members);
      assert.equal(f.fx.jobs.filter(job => job.type !== 0).length, 0); assert.equal(f.fx.lights.length, 0);
      const data = Array.from(f.fx.pf.data.slice(0, STRIDE));
      if (descriptor) assert.deepEqual(data, descriptor); else descriptor = data;
      assert.equal(data[24], SPR.SHOCK); assert.notEqual(data[24], SPR.FLASH); assert.equal(data[28], MODE.GROUND);
      assert.equal(data[8], NUKE_PULSE.start); assert.equal(data[9], NUKE_PULSE.end); assert.ok(Math.abs(data[7] - NUKE_PULSE.life) < 1e-6);
      assert.ok(data.slice(12, 15).every(value => value >= 0 && value <= 1)); assert.ok(data[15] <= .700001);
      assert.equal(data[19], 0); assert.ok(data[32] <= .550001); assert.ok(data[33] <= .550001);
      assert.ok(Math.abs(data[1] - 3.12) < 1e-6); assert.equal(data[22], 3); assert.ok(Math.abs(data[44] - .35) < 1e-6);
      assert.ok(data.slice(4, 7).every(value => value === 0)); assert.equal(data[35], 0); assert.equal(data[41], 0);
    } finally { f.dispose(); }
  }
});

test('actual Fx rejects unloaded, malformed, foreign and replayed cues without suppressing a later valid award', () => {
  const f = fxFixture();
  try {
    f.fx.loaded = false; f.fx.handleEvent(cue(), { runId: 'nuke-visual-life-A' });
    assert.equal(f.fx._nukeAward, 0); f.fx.loaded = true;
    for (const [event, context] of [[cue(), {}], [cue(), { runId: 'another-life' }],
      [cue(100, 'nuke-visual-life-A', { pos: [NaN, 0, 0] }), { runId: 'nuke-visual-life-A' }]]) f.fx.handleEvent(event, context);
    assert.equal(f.fx._nukeAward, 0); assert.equal(f.fx.pf.spawned, 0);
    const ctx = { runId: 'nuke-visual-life-A' }; f.fx.handleEvent(cue(), ctx); f.fx.handleEvent(cue(), ctx);
    f.fx.handleEvent(cue(2), ctx); f.fx.handleEvent(cue(), ctx);
    assert.equal(f.fx.pf.spawned, 2); assert.equal(f.fx._nukeAward, 2);
  } finally { f.dispose(); }
});

test('actual particle expiration and Run teardown clear the pulse and per-life presentation identities', () => {
  const f = fxFixture(), first = runFixture(f.fx, 'gunner');
  try {
    dispatch(first.run, f.fx, [cue()]); f.fx.pf.update(.4); assert.equal(f.fx.pf.live, 1);
    f.fx.pf.update(1); assert.equal(f.fx.pf.live, 0);
    f.fx.handleEvent(cue(2), { runId: first.run.id }); f.fx.pf.flush(); assert.ok(f.fx.pf.geo.instanceCount > 0);
    first.run.dispose(); assert.equal(first.run.nukePresentedAward, 0); assert.equal(first.run.nukeShownAward, 0);
    assert.equal(f.fx._nukeRunId, null); assert.equal(f.fx._nukeAward, 0); assert.equal(f.fx.pf.live, 0);
    assert.equal(f.fx.pf.hw, 0); assert.ok(f.fx.pf.data.every(value => value === 0));
    assert.deepEqual(dispatch(first.run, f.fx, [cue(3)]), []);
    const next = runFixture(f.fx, 'gunner', false, 'nuke-visual-life-B');
    f.fx.handleEvent(cue(), { runId: next.run.id }); assert.equal(f.fx._nukeAward, 0);
    dispatch(next.run, f.fx, [cue(1, next.run.id)]); assert.equal(next.messages.length, 1);
    assert.equal(f.fx._nukeRunId, next.run.id); assert.equal(f.fx._nukeAward, 1); assert.equal(f.fx.pf.hw, 1);
    next.run.dispose(); assert.equal(f.fx.pf.hw, 0);
  } finally { f.dispose(); }
});

test('actual pulse recipe uses finite fallback ground and distance-gates one cue without target fan-out', () => {
  const f = fxFixture(0, () => NaN);
  try {
    f.fx.handleEvent(cue(), { runId: 'nuke-visual-life-A' });
    assert.equal(f.fx.pf.spawned, 1); assert.ok(Math.abs(f.fx.pf.data[22] - 3.4) < 1e-6);
    f.fx.clear(); f.fx.camPos.set(0, 0, 0);
    f.fx.handleEvent(cue(1, 'nuke-visual-life-B', { pos: [5000, 4, 5000], cars: 64, actors: 48 }), { runId: 'nuke-visual-life-B' });
    assert.equal(f.fx.pf.hw, 0); assert.equal(f.fx.jobs.some(job => job.type !== 0), false);
  } finally { f.dispose(); }
});

test('actual Hud preserves the single nuke notice through zero-combo refreshes and generic alerts, then expires and resets', () => {
  const node = () => ({ textContent: '', style: {} });
  const hud = Object.assign(Object.create(Hud.prototype), { q: {}, arrowPool: [], msgT: 0, vigT: 0, hitT: 0,
    gh: { show() {}, setDriverShown() {}, update() {} }, el: { style: {} } });
  for (const name of ['spd', 'spdUnit', 'rpm', 'nitro', 'nitroBox', 'nitroStatus', 'hp', 'area', 'vig', 'msg', 'defeat', 'boss',
    'bossbar', 'bossname', 'combatReady', 'combatCombo', 'speedBox', 'rpmBox', 'hpbox', 'cross', 'ammo', 'arrows']) hud.q[name] = node();
  const state = { runId: 'nuke-visual-life-A', revision: 2, combo: 0, best: 20, label: '', ready: false };
  const data = { speed: 12, rpm01: .4, nitro01: .6, nitroMax: 1, hp01: .75 };
  hud.show({ driver: true, gunner: false }); hud.setCombat(state); assert.equal(hud.nukeCue(), true);
  const notice = hud.q.combatCombo; assert.equal(notice.textContent, 'NUKE DETONATED');
  hud.message('GRENADE INCOMING', 1400); assert.equal(notice.textContent, 'NUKE DETONATED');
  hud.update(.4, data); const remaining = hud.combatT;
  hud.setCombat(state); hud.setCombat({ ...state, revision: 3 });
  assert.equal(hud.combatT, remaining); assert.equal(hud.combatNukeCue, true);
  hud.update(.5, data); assert.equal(hud.combatT, 0); assert.equal(hud.combatNukeCue, false); assert.equal(Number(notice.style.opacity), 0);
  hud.nukeCue(); hud.setCombat({ ...state, revision: 4, combo: 2, label: 'DOUBLE KILL' });
  assert.equal(hud.combatNukeCue, false); assert.equal(notice.textContent, 'x2 DOUBLE KILL');
  hud.nukeCue(); hud.setDefeat('gunner'); assert.equal(hud.combatNukeCue, false); assert.equal(Number(notice.style.opacity), 0);
  assert.equal(hud.nukeCue(), false); hud.show({ driver: false, gunner: true });
  assert.equal(notice.textContent, ''); assert.equal(hud.combatT, 0); assert.equal(hud.combatNukeCue, false);
  hud.setCombat({ ...state, runId: 'nuke-visual-life-B', revision: 0 }); hud.nukeCue(); hud.setCombat(null);
  assert.equal(notice.textContent, ''); assert.equal(Number(notice.style.opacity), 0); assert.equal(hud.combatNukeCue, false);
  const f = fxFixture(), current = runFixture(f.fx, 'gunner'); current.game.hud = hud;
  try {
    dispatch(current.run, f.fx, [cue()]); assert.equal(notice.textContent, 'NUKE DETONATED');
    assert.notEqual(hud.q.msg.textContent, 'NUKE DETONATED', 'native Hud path uses the combat notice rather than a stale generic alert');
    current.run.dispose(); assert.equal(notice.textContent, ''); assert.equal(hud.combatT, 0);
    assert.equal(hud.combatNukeCue, false); assert.equal(f.fx.pf.hw, 0);
  } finally { f.dispose(); }
});

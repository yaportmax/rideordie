import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Run } from '../src/game/run.js';
import { GunnerController } from '../src/game/gunner.js';
import { makeCarState } from '../src/view/car_state.js';
import { decodeSnapshot } from '../src/net/snapshot.js';

const neutral = () => ({ dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false,
  reload: false, grenade: false, swap: 0, slot: -1, crouch: false, moveX: 0, moveZ: 0 });

function fixedRandom(fn) {
  const prior = Math.random; Math.random = () => .5;
  try { return fn(); } finally { Math.random = prior; }
}

function browserFlags(fn) {
  const owned = Object.hasOwn(globalThis, 'window'), prior = globalThis.window;
  globalThis.window = {};
  try { return fn(); } finally { if (owned) globalThis.window = prior; else delete globalThis.window; }
}

// Keep the actual Run branches, car-state conversion, controller, ray/report
// plumbing and network sends. Only rendering/physics/UI consumers are boundaries.
function runFixture({ peer, role = peer === 'host' ? 'driver' : 'gunner', readyMuzzle = true } = {}) {
  const run = Object.create(Run.prototype), calls = [], packets = [], fastPackets = [], fxEvents = [], viewEvents = [], poseEvents = [], posedWeapons = [];
  const hits = [], feedback = [], camera = new THREE.PerspectiveCamera(65, 16 / 9, .1, 500);
  camera.position.set(-9, 1, -11);
  let frame = 0, queue = [];
  const state = makeCarState(1, 'truck_t1', 'player'); state.pos.set(7, 1, -20);
  const enemyState = makeCarState(2, 'truck_t1', 'enemy'); enemyState.pos.set(40, 1, -20);
  const car = (st) => ({ id: st.id, spec: st.spec, kind: st.kind, s: 20, hp: 400, maxHp: 400,
    engineHp: 100, hitFlash: 0, age: 1, burning: 0,
    crew: { driver: { alive: true, hp: 100, max: 100 }, gunner: { alive: true, hp: 100, max: 100, aimYaw: 0, aimPitch: 0 } },
    veh: { pos: st.pos, quat: st.quat, vel: st.vel.set(4, 0, 1), angvel: new THREE.Vector3(), poseRevision: 0,
      nitro: 8, nitroMax: 8, steerAngle: 0, brakeApplied: 0, grounded: 4,
      airTime: 0, rpm01: .4, speed: 4, wheels: st.spec.wheels.map(() => ({ L: .4, slip: 0, grounded: true })),
      lerpPose(alpha, pos, quat) { pos.copy(st.pos); quat.copy(st.quat); }, setInput() {} },
    sync() {}, raycast(o, d, max) {
      if (max < 25) return null;
      return { t: 25, point: o.clone().addScaledVector(d, 25), zone: { kind: 'gunner', index: 0 } };
    },
  });
  const player = car(state), enemy = car(enemyState);
  const road = { nearest: () => ({ s: 20, d: 0 }) };
  Object.assign(run, {
    role, playerId: 1, player, states: new Map([[1, state], [2, enemyState]]), ghosts: new Map([[1, player], [2, enemy]]),
    buf: { sample: () => null }, simState: 'run', time: 0, acc: 0, shots: 0, hitsLanded: 0,
    localEvents: [], outEvents: [], events: [], netEvents: [], proj: [], effects: { weapons: ['pistol'] },
    gunnerSendAcc: 0, snapAcc: 0, cash: 0, medkits: 2, humanGunner: role !== 'driver', humanDriver: role === 'driver', driverLocal: role === 'driver',
    camDir: new THREE.Vector3(0, 0, 1), eye: new THREE.Vector3(), _roadQuery: road,
    net: { sendJSON(packet, fast) { packets.push({ packet: structuredClone(packet), fast }); },
      sendFast(bytes) { fastPackets.push(new Uint8Array(bytes).slice()); } },
    g: { camera, input: { lastDevice: 'mouse', rumble(...values) { feedback.push(['rumble', ...values]); } },
      hud: { damageFlash(value) { feedback.push(['damage', value]); }, hitMarker() {} },
      fx: { handleEvent(event) { fxEvents.push(structuredClone(event)); } } },
    chase: { firstPerson: true, shake: { add() {} } },
    gcam: { firstPerson: true, tpK: 0, adsK: 0, shake: { add() {} }, addRecoil() {} },
    hazMarks: { update() {} }, banner: { update() {} }, threatHud: { setVisible() {}, update() {} },
    _driverActions() {}, _projectileViews() {}, _worldRay: () => null,
    _updateFrustum() {}, _hudData: () => ({}), _outcome() {},
    _camera() { calls.push('camera'); camera.position.set(13 + frame * 2, 3, -21 + frame); run.camDir.set(1, 0, 0); },
  });
  if (peer === 'host') run.sim = {
    state: 'run', cars: new Map([[1, player], [2, enemy]]), roadQuery: road, time: 0, tick: 0,
    director: { level: 0, activeElite: null }, stats: { kills: 0, streak: 0 }, projectiles: { rockets: [], grenades: [] }, boss: null,
    step(dt) { this.time += dt; this.tick++; },
    emit(event) { queue.push(event); }, drainEvents() { const events = queue; queue = []; return events; },
    applyHit(hit) {
      hits.push(structuredClone(hit));
      // The authoritative damage boundary may emit multiple event kinds after
      // the main sim drain, including local feedback that needs Run conversion.
      this.emit({ t: 'crewHit', id: hit.carId, token: 'late-enemy-damage' });
      this.emit({ t: 'crewHit', id: 1, token: 'late-player-feedback' });
    },
  };
  run.gunner = new GunnerController({ weapons: ['pistol'] }, run._gunnerCtx());
  run.gunner.muzzle.set(-50, -10, -60);
  const originalFire = run.gunner.fire;
  run.gunner.fire = function(cam, extra) { calls.push('fire'); return originalFire.call(this, cam, extra); };
  const muzzle = new THREE.Vector3();
  run.wv = { viewMap: new Map(), updateBoss() {},
    update(dt, states, events, ctx) {
      calls.push('pose'); poseEvents.push(events.map(event => structuredClone(event)));
      posedWeapons.push(ctx.playerWeaponId);
      muzzle.set(30 + frame, 4, -12 + frame);
      if (run.gunner) assert.equal(ctx.localGunner.gunner, run.gunner);
      else assert.equal(ctx.localGunner, null);
    },
    muzzlePos(st, out) { calls.push('muzzle'); if (readyMuzzle) out.copy(muzzle); return readyMuzzle; },
    notifyLocalShot() { calls.push('flash'); },
    handleEvent(event) { viewEvents.push(structuredClone(event)); },
  };
  const step = (cmd = {}) => browserFlags(() => fixedRandom(() => {
    frame++; calls.length = 0;
    run.update(1 / 60, { driver: {}, gunner: { ...neutral(), ...cmd } }, frame / 60);
  }));
  return { run, calls, packets, fastPackets, fxEvents, viewEvents, poseEvents, posedWeapons, hits, feedback, muzzle, step };
}

test('actual Run.update resolves the final camera and posed muzzle before a single committed shot', () => {
  for (const config of [{ peer: 'guest' }, { peer: 'host', role: 'solo' }, { peer: 'host', role: 'driver' }]) {
    const f = runFixture(config), magazine = f.run.gunner.magNow;
    f.step({ fire: true, firePressed: true });
    const order = config.role === 'driver' ? ['pose', 'camera', 'muzzle', 'fire', 'flash'] : ['camera', 'pose', 'muzzle', 'fire', 'flash'];
    assert.deepEqual(f.calls, order, `${config.peer}/${f.run.role}`);
    const shot = f.run.allEvents.find(event => event.t === 'shot');
    assert.ok(shot, 'this frame contains the physical shot');
    assert.deepEqual(shot.origin, f.muzzle.toArray(), 'the stale previous-frame muzzle is never used');
    assert.deepEqual(f.run.gunner.aimPoint.toArray(), f.run.g.camera.position.clone().addScaledVector(f.run.camDir, 25).toArray(), 'hitscan uses the final camera ray');
    assert.equal(f.run.gunner.magNow, magazine - 1);
    assert.equal(f.run.gunner.shots, 1); assert.equal(f.run.shots, 1);
    assert.equal(f.run.gunner.finishFire({ position: f.run.g.camera.position, dir: f.run.camDir }), false, 'a committed frame cannot fire twice');
    assert.equal(f.run.gunner.magNow, magazine - 1);
  }
});

test('a missing posed muzzle uses the final camera fallback rather than a stale gun position', () => {
  const f = runFixture({ peer: 'guest', readyMuzzle: false });
  f.step({ fire: true });
  const shot = f.run.allEvents.find(event => event.t === 'shot');
  assert.deepEqual(shot.origin, f.run.g.camera.position.clone().addScaledVector(f.run.camDir, 1).toArray());
});

test('the driver host poses the remote gunner weapon slot and refreshes swaps with a safe invalid-slot fallback', () => {
  const f = runFixture({ peer: 'host' });
  f.run.gunner = null; f.run.gunnerRemote = {};
  f.run.effects.weapons = ['pistol', 'smg', 'shotgun'];
  const select = slot => {
    f.run.onNet({ t: 'g', y: .6, p: -.1, f: 0, c: 0, a: 1, w: slot, r: 0, x: 0, z: 0 });
    f.step();
    assert.equal(f.run.states.get(1).gunner.weapon, slot, 'the actual remote aim packet reaches the host car state');
  };
  select(2); assert.equal(f.posedWeapons.at(-1), 'shotgun', 'the third slot supplies the remote visual weapon');
  select(99); assert.equal(f.posedWeapons.at(-1), 'pistol', 'an invalid remote slot uses the first loadout weapon');
  select(1); assert.equal(f.posedWeapons.at(-1), 'smg', 'a subsequent remote swap refreshes the next frame');
  assert.deepEqual(f.posedWeapons, ['shotgun', 'pistol', 'smg']);
});

test('host late shot and damage events reach views, feedback, FX and network once in their firing frame', () => {
  const f = runFixture({ peer: 'host' });
  f.run.sim.emit({ t: 'dryClick', weapon: 'pistol', token: 'before-fire' });
  f.step({ fire: true });
  assert.deepEqual(f.poseEvents[0].map(event => event.t), ['dryClick'], 'the original view update handles only events available before fire');
  assert.deepEqual(f.viewEvents.map(event => event.t), ['crewHit', 'crewHit', 'shot']);
  assert.deepEqual(f.run.allEvents.map(event => event.t), ['dryClick', 'crewHit', 'crewHit', 'shot']);
  assert.deepEqual(f.fxEvents, f.run.allEvents, 'every event reaches FX during the firing frame');
  assert.equal(f.feedback.filter(entry => entry[0] === 'damage').length, 1, 'late player damage runs through _simEventsToRun');
  assert.equal(f.hits.length, 1); assert.equal(f.run.hitsLanded, 1);
  const packets = f.packets.filter(({ packet }) => packet.t === 'events');
  assert.equal(packets.length, 1); assert.deepEqual(packets[0].packet.e, f.run.allEvents);
  const count = f.fxEvents.length, handled = f.viewEvents.length;
  f.step();
  assert.deepEqual(f.run.allEvents, []); assert.equal(f.fxEvents.length, count); assert.equal(f.viewEvents.length, handled);
  assert.equal(f.packets.filter(({ packet }) => packet.t === 'events').length, 1, 'the following frame sends no repeated events');
  assert.equal(f.feedback.filter(entry => entry[0] === 'damage').length, 1);
});

test('driver firing phases retain real30Hz snapshots with current pose, HUD and one reliable event delivery', () => {
  const f = runFixture({ peer: 'host' });
  f.step({ fire: true, firePressed: true }); assert.equal(f.fastPackets.length, 0, 'The first60Hz frame does not invent a due snapshot');
  for (let frame = 1; frame < 6; frame++) f.step();
  assert.equal(f.fastPackets.length, 3, 'Six real Run.update frames carry three fresh30Hz snapshots');
  let tick = -1, time = -1;
  for (const bytes of f.fastPackets) {
    assert.equal(bytes[0], 3, 'The current expanded snapshot wire version is actually encoded');
    const snapshot = decodeSnapshot(bytes); assert(snapshot, 'Captured binary bytes decode using the production receiver');
    assert(snapshot.tick > tick && snapshot.time > time); tick = snapshot.tick; time = snapshot.time;
    assert.equal(snapshot.cars.length, 2); assert.equal(snapshot.hp01, 1); assert.equal(snapshot.dhp01, 1); assert.equal(snapshot.ghp01, 1);
    assert.equal(snapshot.nitro01, 1); assert.equal(snapshot.cash, 0); assert.equal(snapshot.medkits, 2); assert.equal(snapshot.bossHp01, 0);
    const player = snapshot.cars.find(car => car.id === 1);
    assert.deepEqual([player.x, player.y, player.z], f.run.player.veh.pos.toArray());
    assert.equal(player.poseRevision, 0); assert.equal(player.L.length, 4); assert.equal(player.kind, 'player');
  }
  assert.equal(tick, f.run.sim.tick); assert(Math.abs(time - f.run.sim.time) < 1e-7, 'The final snapshot reports the current authoritative simulation clock');
  const events = f.packets.filter(({ packet }) => packet.t === 'events');
  assert.equal(events.length, 1); assert.equal(events[0].packet.e.filter(event => event.t === 'shot').length, 1, 'Snapshot cadence cannot repeat physical firing events');
  assert.equal(f.run.shots, 1); assert.equal(f.run.hitsLanded, 1);
});

test('driver cockpit glass feedback reaches local FX once without refeeding the cockpit or entering network events', () => {
  const f = runFixture({ peer: 'host' }), seen = [];
  const shot = { t: 'shot', src: 'enemy', weapon: 'pistol', origin: [40, 2, -20], rays: [{ end: [7, 2, -20], carId: 1 }] };
  const hit = { t: 'hit', id: 1, pos: [7, 2, -20], dmg: 11 };
  const glass = { t: 'windshieldBreak', id: 1, pos: [7, 2.1, -19.5] };
  f.run.cockpit = { active: false, onEvent(event) {
    assert.notEqual(event.t, 'windshieldBreak', 'generated local feedback must not be sent back into its producer');
    seen.push(event.t); return event.t === 'hit' ? glass : null;
  } };
  f.run.sim.emit(shot); f.run.sim.emit(hit);
  f.step();
  assert.deepEqual(seen, ['shot', 'hit'], 'the cockpit processes the original event count');
  assert.deepEqual(f.run.allEvents.map(event => event.t), ['shot', 'hit', 'windshieldBreak']);
  const produced = f.run.allEvents.at(-1);
  assert.deepEqual(produced, { ...glass, time: f.run.time, localOnly: true });
  assert.equal(Object.hasOwn(glass, 'localOnly'), false, 'Run tags a copy rather than mutating the producer event');
  assert.deepEqual(f.fxEvents, f.run.allEvents, 'the generated event reaches FX in this frame');
  const packets = f.packets.filter(({ packet }) => packet.t === 'events');
  assert.equal(packets.length, 1);
  assert.deepEqual(packets[0].packet.e, [shot, hit], 'physical events are sent while local glass feedback stays on this peer');
  f.step();
  assert.deepEqual(f.run.allEvents, []); assert.deepEqual(seen, ['shot', 'hit']);
  assert.equal(f.fxEvents.length, 3); assert.equal(f.packets.filter(({ packet }) => packet.t === 'events').length, 1);
});

test('guest combines arrived damage, preexisting local events and its new shot without echoing or repeating them', () => {
  const f = runFixture({ peer: 'guest' });
  f.run.onNet({ t: 'events', e: [{ t: 'crewHit', id: 2, token: 'arrived-damage' }] });
  f.run._localEvent({ t: 'dryClick', weapon: 'pistol', token: 'already-local' });
  f.step({ fire: true });
  assert.deepEqual(f.poseEvents[0].map(event => event.t), ['crewHit', 'dryClick']);
  assert.deepEqual(f.viewEvents.map(event => event.t), ['shot'], 'the new shot reaches views after the pose without replaying earlier events');
  assert.deepEqual(f.run.allEvents.map(event => event.t), ['crewHit', 'dryClick', 'shot']);
  assert.deepEqual(f.fxEvents, f.run.allEvents);
  const shots = f.packets.filter(({ packet }) => packet.t === 'shotfx'), reports = f.packets.filter(({ packet }) => packet.t === 'hit');
  assert.equal(shots.length, 1); assert.deepEqual(shots[0].packet.e.map(event => event.t), ['dryClick', 'shot'], 'incoming server damage is never echoed');
  assert.equal(reports.length, 1); assert.equal(f.run.hitsLanded, 1);
  assert.deepEqual(f.run.localEvents, []); assert.deepEqual(f.run.outEvents, []); assert.deepEqual(f.run.netEvents, []);
  const count = f.fxEvents.length;
  f.step();
  assert.deepEqual(f.run.allEvents, []); assert.equal(f.fxEvents.length, count); assert.equal(f.viewEvents.length, 1);
  assert.equal(f.packets.filter(({ packet }) => packet.t === 'shotfx').length, 1);
  assert.equal(f.packets.filter(({ packet }) => packet.t === 'hit').length, 1);
});

function controllerPair(weapons) {
  const cam = { position: new THREE.Vector3(2, 3, -4), dir: new THREE.Vector3(0, 0, 1) };
  const make = () => {
    const events = [], gunner = new GunnerController({ weapons }, { ownCar: () => null, targets: function* () {},
      raycastWorld: () => null, emit(event) { events.push(structuredClone(event)); } });
    gunner.muzzle.set(2.3, 2.8, -3);
    return { gunner, events };
  };
  const direct = make(), deferred = make();
  const fields = ['cur', 'yaw', 'pitch', 'ads', 'fireT', 'reloadT', 'reloading', 'pumpT', 'boltT', 'bloom',
    'recoilAnim', 'swapT', 'shots', 'trigger', 'dryClickT', '_autoFireContinuous', '_fireQueued'];
  const step = (dt, cmd = {}) => {
    const before = deferred.gunner.shots;
    fixedRandom(() => direct.gunner.update(dt, { ...neutral(), ...cmd }, cam, 0));
    fixedRandom(() => {
      deferred.gunner.update(dt, { ...neutral(), ...cmd }, cam, 0, { deferFire: true });
      assert.equal(deferred.gunner.shots, before, 'control preparation cannot emit a shot');
      deferred.gunner.finishFire(cam);
      assert.equal(deferred.gunner.finishFire(cam), false, 'the prepared fire phase is consumed once');
    });
    assert.ok(deferred.gunner.shots - before <= 1);
    assert.deepEqual(deferred.events, direct.events, 'deferred and standalone callers emit the same complete events');
    for (const field of fields) assert.equal(deferred.gunner[field], direct.gunner[field], field);
    assert.deepEqual(deferred.gunner.mag, direct.gunner.mag);
  };
  const both = fn => { fn(direct.gunner); fn(deferred.gunner); };
  return { direct, deferred, step, both };
}

test('deferred automatic fire preserves configured cadence and release/pause cooldown recovery', () => {
  for (const weapon of ['smg', 'rifle']) for (const pattern of [[1 / 30], [1 / 60], [1 / 120], [.008, .024, .012, .037, .016]]) {
    const p = controllerPair([weapon]); let elapsed = 0, frame = 0, firstShot;
    while (elapsed < 1.2 - 1e-10) {
      const dt = Math.min(pattern[frame++ % pattern.length], 1.2 - elapsed); elapsed += dt;
      p.step(dt, { fire: true }); if (firstShot === undefined) firstShot = elapsed;
    }
    assert.equal(p.deferred.gunner.shots, 1 + Math.floor((1.2 - firstShot) / (60 / p.deferred.gunner.weapon.rpm) + 1e-8));
  }
  for (const interrupt of ['release', .05, .5]) {
    const p = controllerPair(['smg']); p.step(1 / 30, { fire: true }); p.step(1 / 30, { fire: true });
    if (interrupt === 'release') { p.step(.01); p.step(.04, { fire: true }); } else p.step(interrupt, { fire: true });
    assert.equal(p.deferred.gunner.shots, 2); assert.equal(p.deferred.gunner.fireT, 60 / p.deferred.gunner.weapon.rpm);
    p.step(.04, { fire: true }); assert.equal(p.deferred.gunner.shots, 2, 'no recovery catch-up shot');
    p.step(.04, { fire: true }); assert.equal(p.deferred.gunner.shots, 3);
  }
});

test('deferred fire preserves reload, empty-magazine and swap recovery without automatic timing debt', () => {
  for (const interrupt of ['reload', 'empty', 'swap']) {
    const p = controllerPair(['smg', 'rifle']); p.step(1 / 30, { fire: true }); p.step(1 / 30, { fire: true });
    if (interrupt === 'reload') {
      p.both(gunner => gunner.startReload()); p.step(.04, { fire: true });
      p.both(gunner => { gunner.reloadT = gunner.weapon.reload - .02; });
    } else if (interrupt === 'empty') {
      p.both(gunner => { gunner.mag[0] = 0; }); p.step(.04, { fire: true }); p.step(.02, { fire: true });
      assert.equal(p.deferred.gunner.reloading, true);
      p.both(gunner => { gunner.reloadT = gunner.weapon.reload - .02; });
    } else p.both(gunner => { gunner.swapTo(1); gunner.swapT = gunner.fireT = .02; });
    p.step(.03, { fire: true }); assert.equal(p.deferred.gunner.shots, 2, `${interrupt} resumes held fire`);
    assert.equal(p.deferred.gunner.fireT, 60 / p.deferred.gunner.weapon.rpm);
    p.step(.04, { fire: true }); assert.equal(p.deferred.gunner.shots, 2, `${interrupt} has no catch-up shot`);
  }
});

test('deferred pistol and shotgun fire retain trigger-edge, cooldown and pump behavior', () => {
  for (const weapon of ['pistol', 'shotgun']) {
    const p = controllerPair([weapon]), period = 60 / p.deferred.gunner.weapon.rpm;
    p.step(.02, { fire: true }); for (let i = 0; i < 60; i++) p.step(1 / 30, { fire: true });
    assert.equal(p.deferred.gunner.shots, 1, 'holding the trigger cannot repeat a semi/pump shot');
    p.step(.01); p.step(.03, { fire: true, firePressed: true }); assert.equal(p.deferred.gunner.shots, 2);
    p.step(period / 2); p.step(period / 4, { fire: true, firePressed: true }); assert.equal(p.deferred.gunner.shots, 2);
  }
});

test('a reliable partner defeat received before the next snapshot stops actual guest shots, reloads and kit requests', () => {
  const f = runFixture({ peer: 'guest' }); let toggles = 0;
  f.run.gcam.toggle = () => { toggles++; };
  f.step({ fire: true, firePressed: true }); assert.equal(f.run.gunner.shots, 1);
  const sentBefore = f.packets.length, magazine = f.run.gunner.magNow, grenades = f.run.gunner.grenades;
  f.run.onNet({ t: 'events', e: [{ t: 'playerDown', why: 'driver' }] });
  assert.equal(f.run.simState, 'run'); assert.equal(f.run.states.get(1).gunnerAlive, true);
  f.run.gunner.fireT = 0;
  f.step({ fire: true, firePressed: true });
  assert.equal(f.run.gunner.shots, 1); assert.equal(f.run.gunner.magNow, magazine); assert.equal(f.run.gunner.trigger, false);
  f.step({ reload: true, grenade: true, medkit: true, viewToggle: true });
  assert.equal(f.run.gunner.reloading, false); assert.equal(f.run.gunner.grenades, grenades); assert.equal(toggles, 0);
  for (const { packet } of f.packets.slice(sentBefore)) {
    assert.notEqual(packet.t, 'medkit'); assert.notEqual(packet.t, 'grenade'); assert.notEqual(packet.t, 'shotfx');
    if (packet.t === 'g') assert.equal(packet.f, 0);
  }
  assert.equal(f.run.defeatReason, 'driver');
});

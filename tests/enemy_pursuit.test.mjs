import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DT } from '../src/sim/sim.js';
import { EnemyBrain, enemyDrivingContext } from '../src/sim/ai.js';
import { MINIBOSSES } from '../src/data/boss.js';
import { fixture, run, state, diagnostic, finiteSupported, physicalContact, pairedCrash, contactGeometry } from './enemy_pursuit_fixture.mjs';

// Focused physics fixtures isolate uncontrolled traffic and use fixed player
// inputs. Every enemy keeps the production brain created by Director; attack,
// contact, cooldown, grounding, tank and simulation time are never assigned.

function assertPhysicalTrajectory(f, rows) {
  assert.ok(f.car.ai instanceof EnemyBrain);
  assert.equal(f.car.ai, f.brain, 'retain the Director-created brain');
  assert.ok(finiteSupported(rows), diagnostic(f, rows));
  assert.ok(rows.every(r => r.loadedEnemy && r.loadedPlayer), diagnostic(f, rows));
  assert.ok(rows.every(r => r.poseRevision === 0 && r.playerPoseRevision === 0),
    'physical progress cannot be credited to a pose revision');
  assert.ok(!f.sim.events.some(e => e.t === 'groundRecovered' || e.t === 'unflip'),
    'physical progress cannot be credited to a recovery placement');
}

function assertToldContact(f, rows, kind) {
  const crash = pairedCrash(f);
  assert.ok(crash, diagnostic(f, rows));
  const tell = f.sim.events.find(e => e.t === 'enemyTell' && e.id === f.car.id && e.kind === kind);
  assert.ok(tell && tell.time < crash.time, diagnostic(f, rows));
  const contact = f.contacts.find(c => c.time === crash.time && c.attack?.kind === kind
    && c.attack.phase === 'hit' && c.contact && physicalContact(c));
  assert.ok(contact, `natural hit phase must have oriented hull support and real solver contacts: ${diagnostic(f, rows)}`);
  assert.ok(f.ramDamage.some(d => d.time === crash.time && d.tick === contact.tick
    && d.src === f.car.id && d.actual > 0),
    `the exact physical contact must cause attributed player ram damage: ${diagnostic(f, rows)}`);
  assert.ok(f.sim.stats.damageBy?.ram > 0, diagnostic(f, rows));
  return crash;
}

test('ordinary rammer uses finite catch-up boost and physically closes an authored far gap', async () => {
  const f = await fixture();
  try {
    const initialGap = state(f).gap, rows = run(f, 8, { throttle: 1, nitro: true });
    assertPhysicalTrajectory(f, rows);
    assert.ok(rows.some(r => r.boost && r.pursuitBoost && r.grounded >= 2), diagnostic(f, rows));
    assert.ok(f.player.s - f.car.s < initialGap - 20, diagnostic(f, rows));
  } finally { f.sim.dispose(); }
});

test('ordinary muscle naturally tells and completes a rear-corner ram with solver contact and player damage', async () => {
  const f = await fixture({ gap: 48, speed: 32, seconds: 12, travelSpeed: 70 });
  try {
    const rows = run(f, 12, { until: ({ sim, player, car }) =>
      sim.events.some(e => e.t === 'crash' && e.id === player.id && e.other === car.id) });
    assertPhysicalTrajectory(f, rows);
    const crash = assertToldContact(f, rows, 'ram');
    assert.ok(f.sim.events.some(e => e.t === 'crash' && e.id === f.player.id && e.other === f.car.id
      && e.time === crash.time), diagnostic(f, rows));
    assert.ok(!f.sim.events.some(e => e.rearBonk || e.t === 'kill'),
      'enemy rear-ending is not a player bonk or takedown reward');
  } finally { f.sim.dispose(); }
});

test('both mirrored flanker swipes retain the hit phase through actual hull contact and player damage', async () => {
  for (const side of [-1, 1]) {
    const f = await fixture({ enemy: 'e_sedan', behavior: 'flanker', gap: -2,
      d: side * 4.3, speed: 30, seconds: 12, travelSpeed: 65 });
    try {
      const rows = run(f, 12, { until: pairedCrash });
      assertPhysicalTrajectory(f, rows);
      assertToldContact(f, rows, 'swipe');
    } finally { f.sim.dispose(); }
  }
});

test('catch-up depletes the real tank and releases nitro during its recharge lock', async () => {
  const f = await fixture({ gap: 240, speed: 38, seconds: 7, travelSpeed: 85 });
  try {
    const rows = run(f, 7, { throttle: 1, nitro: true });
    assertPhysicalTrajectory(f, rows);
    const depleted = rows.findIndex(r => r.rechargeLocked);
    assert.ok(depleted >= 0, `real Vehicle depletion must engage the lock: ${diagnostic(f, rows)}`);
    const locked = rows.slice(depleted).filter(r => r.rechargeLocked);
    assert.ok(locked.length >= 6, diagnostic(f, rows));
    assert.ok(locked.every(r => !r.boost), diagnostic(f, rows));
    assert.ok(locked.slice(1).every(r => !r.pursuitBoost), diagnostic(f, rows));
    assert.ok(locked.some(r => !r.input.nitro && !r.needsRelease && r.tank > 0), diagnostic(f, rows));
  } finally { f.sim.dispose(); }
});

test('actual catalogue elite-only and pattern-only cars exclude catch-up boost in a genuine far-gap opportunity', async () => {
  const boss = MINIBOSSES[1];
  const elite = { index: 1, name: boss.name, hpMul: boss.hpMul, hpBase: boss.hpBase,
    massMul: boss.massMul, armor: boss.armor, gun: boss.gun, gun2: boss.gun2, weak: boss.weak,
    gunners: boss.gunners, driverHp: boss.driverHp, gunnerHp: boss.gunnerHp };
  for (const category of [{ elite }, { pattern: { ...boss.pattern } }]) {
    const f = await fixture({ enemy: boss.spec, behavior: boss.behavior, ...category });
    try {
      assert.equal(!!f.car.elite, !!category.elite);
      assert.equal(!!f.car.ai.pattern, !!category.pattern);
      const rows = run(f, 8, { throttle: 1, nitro: true });
      assertPhysicalTrajectory(f, rows);
      assert.ok(rows.some(r => r.gap >= 65 && r.gap <= 260 && r.playerSpeed > 18 && r.grounded >= 2
        && r.up >= .8 && !r.attack && r.tank > 0 && !r.rechargeLocked && !r.needsRelease
        && r.route === null && r.playerRoute === null && r.loadedEnemy && r.loadedPlayer), diagnostic(f, rows));
      assert.ok(rows.every(r => !r.pursuitBoost), diagnostic(f, rows));
      assert.ok(f.driveIntents.every(d => d.tireCurveBound === null
        && d.curveLimit === d.legacyCurveLimit), 'authored categories retain their existing curve limit');
    } finally { f.sim.dispose(); }
  }
});

function popTyres(f, indices) {
  for (const index of indices) {
    const zone = f.car.zones.find(z => z.kind === 'tire' && z.index === index);
    assert.ok(zone, 'actual authored tyre damage zone must exist');
    const damage = (f.car.tireHp[index] + .01) * 12 / (f.car.spec.tireMul ?? 1);
    f.sim.damageZone(f.car, zone, damage, { cause: 'bullet', src: f.player.id });
    assert.equal(f.car.veh.wheels[index].flat, true);
    assert.equal(f.car.veh.wheels[index].grip, .55);
  }
  assert.ok(f.car.hp > 0 && f.car.crew.driver.alive, 'source tyre damage leaves a living vehicle');
}

function assertBendCorridor(f, rows) {
  assertPhysicalTrajectory(f, rows);
  assert.ok(rows.every(r => Math.abs(r.d) + f.car.spec.width / 2 < 8.5 && r.up > .65), diagnostic(f, rows));
}

test('source tyre damage keeps a real canyon trajectory bounded without inflating yaw authority', async () => {
  const f = await fixture({ gap: 90, speed: 35, seconds: 5, travelSpeed: 80, curve: true, recordSteps: true });
  try {
    const rows = run(f, .5, { throttle: 1 });
    assert.ok(f.car.veh.grounded >= 2, diagnostic(f, rows));
    popTyres(f, [0, 2]);
    rows.push(...run(f, 4.5, { throttle: 1 }));
    assert.equal(f.sim.events.filter(e => e.t === 'tirePop' && e.id === f.car.id).length, 2);
    assertBendCorridor(f, rows);
    assert.ok(f.raw.every(r => r.after.enemy.poseRevision === 0 && r.after.player.poseRevision === 0), diagnostic(f, rows));
    assert.ok(f.driveIntents.some(d => d.tireTraction < d.surfaceTraction),
      'actual popped tyres reduce the speed bound while yaw uses surface-only authority');
  } finally { f.sim.dispose(); }
});

test('healthy upgraded grip supports actual canyon bend pursuit within the road corridor', async () => {
  const f = await fixture({ gap: 90, speed: 35, seconds: 5, travelSpeed: 80, curve: true });
  try {
    const initial = f.car.s, rows = run(f, 5, { throttle: 1 });
    assertBendCorridor(f, rows);
    assert.ok(rows.filter(r => r.grounded >= 2).length > rows.length * .9, diagnostic(f, rows));
    assert.ok(f.car.s > initial + 20, diagnostic(f, rows));
  } finally { f.sim.dispose(); }
});

test('authored solid-slice approach suppresses pursuit boost and targets its designated passage', async () => {
  const setup = await new Sim({ seed: 7 }).init();
  let s;
  try {
    const feature = setup.road.drivingPlan.find(f => f.type === 'stage_challenge' && f.biome === 'desert');
    assert.ok(feature);
    s = feature.s0 - 40;
  } finally { setup.dispose(); }
  const f = await fixture({ s, gap: 100, speed: 42 });
  try {
    const rows = run(f, .25);
    assertPhysicalTrajectory(f, rows);
    assert.equal(f.car.ai.stageAvoiding, true);
    assert.equal(f.car.ai.pursuitBoost, false);
    assert.equal(f.car.veh.input.nitro, false);
    assert.ok(Math.abs(f.car.ai._lastDT - f.car.ai._stage.d) < Math.abs(f.car.ai._stage.d), diagnostic(f, rows));
    assert.ok(f.car.ai._lastVDes <= f.car.ai._stage.speed + 1e-8, diagnostic(f, rows));
  } finally { f.sim.dispose(); }
});

test('physically separated branch vehicles reject cross-route charge and boost despite genuine opportunities', async () => {
  const setup = await new Sim({ seed: 7 }).init();
  let branch, s;
  try {
    branch = setup.road.ensureDrivingBranches()[0];
    assert.ok(branch);
    s = (branch.s0 + branch.s1) / 2;
  } finally { setup.dispose(); }
  for (const scenario of [{ gap: 90, seconds: 1.5, speed: 25 }, { gap: 30, seconds: 6, speed: 0 }]) {
    const f = await fixture({ s, gap: scenario.gap, speed: scenario.speed });
    try {
      // One declared physical placement. Sim projection and suspension derive
      // the occupied route and ground contact; neither route field is assigned.
      const p = f.sim.road.drivingPointAt(s, 0, branch.id, {}), v = f.player.veh;
      v.body.setTranslation({ x: p.x, y: p.y + v.restComHeight + .15, z: p.z }, true);
      v.body.setRotation({ x: 0, y: Math.sin(p.th / 2), z: 0, w: Math.cos(p.th / 2) }, true);
      v.body.setLinvel({ x: Math.sin(p.th) * scenario.speed, y: 0, z: Math.cos(p.th) * scenario.speed }, true);
      v.readState(); v.prevPos.copy(v.pos); v.prevQuat.copy(v.quat);
      f.sim.step(DT);
      assert.equal(f.player.route, branch.id, diagnostic(f, []));
      assert.equal(f.car.route, null, diagnostic(f, []));
      const rows = run(f, scenario.seconds, { throttle: 0 });
      assertPhysicalTrajectory(f, rows);
      assert.ok(rows.every(r => r.playerRoute === branch.id && r.route === null), diagnostic(f, rows));
      assert.ok(f.player.veh.grounded >= 2 && f.car.veh.grounded >= 2, diagnostic(f, rows));
      assert.equal(enemyDrivingContext(f.sim.road, f.car, f.player).crossRoute, true, diagnostic(f, rows));
      assert.ok(rows.every(r => !r.attack && !r.pursuitBoost), diagnostic(f, rows));
      if (scenario.gap > 65) assert.ok(rows.some(r => r.gap >= 65 && r.grounded >= 2 && r.playerSpeed > 18),
        `far-gap opportunity must actually exist: ${diagnostic(f, rows)}`);
      else assert.ok(rows.some(r => r.gap > 4 && r.gap < 60 && r.attackCooldown <= 0 && r.playerRoute !== r.route),
        `default cooldown must expire in real attack range while separated: ${diagnostic(f, rows)}`);
      assert.ok(!f.sim.events.some(e => e.t === 'enemyTell' && ['ram', 'swipe', 'crush'].includes(e.kind)), diagnostic(f, rows));
    } finally { f.sim.dispose(); }
  }
});

test('genuine oil and popped rear tyres cannot lift the conservative cap during an actual canyon slide', async () => {
  const f = await fixture({ gap: 90, speed: 55, seconds: 5, travelSpeed: 80, curve: true, recordSteps: true });
  try {
    const rows = run(f, .5, { throttle: 1 }); assert.ok(f.car.veh.grounded >= 2, diagnostic(f, rows));
    popTyres(f, [2, 3]); f.sim.systems.push(f.sim.hazards);
    // Declared one-second source-created oil trail. Every patch originates
    // from the car's genuine moving body through Hazards.dropOil; no pose,
    // wheel surface, slip, contact, velocity or hazard timer is assigned.
    for (let i = 0; i < 10; i++) { f.sim.hazards.dropOil(f.sim, f.car); rows.push(...run(f, .1, { throttle: 1 })); }
    rows.push(...run(f, 3.5, { throttle: 1 }));
    assertBendCorridor(f, rows);
    const oily = f.raw.map(r => r.after).filter(r => r.wheels.some(w => w.grounded && w.surfaceGrip === .22));
    assert.ok(oily.length >= 2, 'actual suspension contact must observe the source oil surface');
    // Match the cap to the actual surface/slip observed when the AI issued it;
    // raw post-step rows can observe a new surface before the next 60Hz update.
    const sliding = f.driveIntents.filter(r => Math.abs(r.slip) > .18 && r.surfaceTraction < 1);
    assert.ok(sliding.length > 0, `the oil fixture must actually slide: ${diagnostic(f, rows)}`);
    assert.ok(sliding.every(r => Number.isFinite(r.tireCurveBound) && r.curveLimit <= r.tireCurveBound + 1e-8
      && r.curveLimit <= r.legacyCurveLimit + 1e-8), 'actual sliding cannot jump to the larger legacy cap');
  } finally { f.sim.dispose(); }
});


function observeApproach(f) {
  const steering = [], damage = [], roadPoint = f.sim.road.pointAt, damageCar = f.sim.damageCar;
  f.sim.road.pointAt = function(s, d, out) {
    const result = roadPoint.call(this, s, d, out);
    if (out === f.car.ai._tp) steering.push({ time: f.sim.time, tick: f.sim.tick,
      phase: f.car.ai.atk?.phase, kind: f.car.ai.atk?.kind, gap: f.player.s - f.car.s,
      look: s - f.car.s, speed: f.car.veh.vf, targetD: d });
    return result;
  };
  f.sim.damageCar = function(target, amount, info, ...args) {
    const tracked = target === f.player && info?.cause === 'ram' && info.src === f.car.id;
    const beforeHP = target.hp;
    const receipt = tracked ? { time: this.time, tick: this.tick, attack: f.car.ai.atk ? { ...f.car.ai.atk } : null,
      geometry: contactGeometry(this, f.car, f.player), beforeHP } : null;
    const result = damageCar.call(this, target, amount, info, ...args);
    if (tracked && target.hp < beforeHP) damage.push({ ...receipt, afterHP: target.hp, actual: beforeHP - target.hp });
    return result;
  };
  return { steering, damage };
}

function supportedChronology(f, rows) {
  assert.ok(finiteSupported(rows), diagnostic(f, rows));
  assert.ok(f.raw.length > 0 && f.raw.every(row => {
    const state = row.after;
    return state.enemy.poseRevision === 0 && state.player.poseRevision === 0
      && state.enemy.pos.every(Number.isFinite) && state.enemy.velocity.every(Number.isFinite)
      && state.enemy.route === null && state.player.route === null
      && Math.abs(state.enemy.input.steer) <= 1 && state.enemy.loaded && state.player.loaded;
  }), 'each actual fixed step remains finite, loaded, on the declared route and unrepositioned');
  assert.ok(!f.sim.events.some(event => event.t === 'groundRecovered'), 'real contact cannot earn credit from recovery');
}

test('mirrored ordinary rams naturally tell, aim nearer and cause actual hit-phase player damage with solver geometry', async () => {
  for (const side of [-1, 1]) {
    const f = await fixture({ gap: 48, d: side * .4, speed: 32, seconds: 12, travelSpeed: 70, recordSteps: true });
    try {
      const observed = observeApproach(f);
      const rows = run(f, 12, { until: () => observed.damage.length > 0 });
      supportedChronology(f, rows);
      const contact = observed.damage.find(receipt => receipt.attack?.kind === 'ram'
        && receipt.attack.phase === 'hit' && receipt.actual > 0 && physicalContact(receipt));
      assert.ok(contact, `ordinary ram must cause real attributed hull loss in its natural hit phase: ${diagnostic(f, rows)}`);
      const tell = f.sim.events.find(event => event.t === 'enemyTell' && event.id === f.car.id && event.kind === 'ram');
      assert.ok(tell && tell.time < contact.time, 'natural ram tell precedes the exact damaging solver contact');
      assert.ok(f.ramDamage.some(receipt => receipt.time === contact.time && receipt.tick === contact.tick
        && receipt.actual === contact.actual && receipt.src === f.car.id), 'original Sim damage observer independently attributes the same hit');
      const close = observed.steering.filter(receipt => receipt.kind === 'ram' && receipt.phase === 'hit' && receipt.gap <= 16);
      assert.ok(close.length > 0, 'natural charge must reach the declared final approach');
      assert.ok(close.every(receipt => receipt.look >= 10 - 1e-8 && receipt.look <= 30 + 1e-8
        && receipt.look <= Math.max(10, receipt.gap + 6) + 1e-8), 'actual final steering target follows the bounded gap cap');
      assert.ok(f.driveIntents.some(receipt => receipt.attack?.kind === 'ram' && receipt.attack.phase === 'line'
        && Math.abs(receipt.targetD - receipt.playerD - receipt.attack.side * .25) < 1e-8), 'actual ordinary line target uses the .25m corner');
      assert.ok(!f.sim.events.some(event => event.rearBonk || event.t === 'kill'), 'enemy charge does not earn a player takedown');
    } finally { f.sim.dispose(); }
  }
});

test('Director-created elite and patterned rammers retain their .9m corner and uncapped hit lookahead', async () => {
  const boss = MINIBOSSES[1];
  const elite = { index: 1, name: boss.name, hpMul: boss.hpMul, hpBase: boss.hpBase,
    massMul: boss.massMul, armor: boss.armor, gun: boss.gun, gun2: boss.gun2,
    weak: boss.weak, gunners: boss.gunners, driverHp: boss.driverHp, gunnerHp: boss.gunnerHp };
  for (const category of [{ elite }, { pattern: { ...boss.pattern } }]) {
    // Declared rammer behavior exercises both excluded guard categories on
    // catalogue muscle/elite data. Retain Director's production brain rather
    // than comparing WORK classes; this fixture is not a full Twin fight.
    const f = await fixture({ enemy: boss.spec, behavior: 'rammer', ...category,
      gap: 48, speed: 32, seconds: 12, travelSpeed: 70, recordSteps: true });
    try {
      assert.equal(!!f.car.elite, !!category.elite);
      assert.equal(!!f.car.ai.pattern, !!category.pattern);
      const observed = observeApproach(f);
      const ordinaryHitLook = receipt => Math.min(
        Math.min(64, Math.max(10, receipt.speed * .6 + 8)),
        Math.min(30, Math.max(10, Math.max(0, receipt.gap) + 6)));
      const rows = run(f, 12, { until: () => observed.steering.some(receipt =>
        receipt.kind === 'ram' && receipt.phase === 'hit'
        && receipt.look > ordinaryHitLook(receipt) + 1) });
      assertPhysicalTrajectory(f, rows);
      supportedChronology(f, rows);
      const aligned = f.driveIntents.filter(receipt => receipt.attack?.kind === 'ram'
        && ['line', 'wind'].includes(receipt.attack.phase));
      assert.ok(aligned.some(receipt => receipt.attack.phase === 'line')
        && aligned.some(receipt => receipt.attack.phase === 'wind'),
      `excluded category must naturally line up and wind its ram: ${diagnostic(f, rows)}`);
      assert.ok(aligned.every(receipt =>
        Math.abs(receipt.targetD - receipt.playerD - receipt.attack.side * .9) < 1e-8),
      'actual excluded line/wind targets retain the authored .9m corner');
      const hit = observed.steering.filter(receipt => receipt.kind === 'ram' && receipt.phase === 'hit');
      assert.ok(hit.length > 0, `excluded category must naturally enter HIT: ${diagnostic(f, rows)}`);
      const tell = f.sim.events.find(event => event.t === 'enemyTell'
        && event.id === f.car.id && event.kind === 'ram');
      assert.ok(tell && tell.time < hit[0].time, 'natural ram tell precedes the observed HIT steering');
      assert.ok(hit.every(receipt =>
        Math.abs(receipt.look - Math.min(64, Math.max(10, receipt.speed * .6 + 8))) < 1e-8),
      'every actual excluded HIT target retains its original speed-derived 10..64m lookahead');
      assert.ok(hit.some(receipt => receipt.look > ordinaryHitLook(receipt) + 1),
        'the natural excluded HIT must actually distinguish its lookahead from the ordinary final-approach cap');
    } finally { f.sim.dispose(); }
  }
});

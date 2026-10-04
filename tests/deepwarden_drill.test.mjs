import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DT as PHYS_DT } from '../src/sim/sim.js';
import { EnemyBrain, enemyDrivingContext } from '../src/sim/ai.js';
import { Director } from '../src/sim/director.js';
import { CAMPAIGN_BOSSES, ELITE_BOSSES, MINIBOSSES } from '../src/data/boss.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { encodeSnapshot, decodeSnapshot } from '../src/net/snapshot.js';
import { makeCarState, stateFromCar } from '../src/view/car_state.js';
import { fixture as physicalFixture, run, finiteSupported, diagnostic, physicalContact } from './enemy_pursuit_fixture.mjs';

// Authored but UNRUN. The first group is an actual-source policy fixture with
// declared stationary poses, loaded flat road, fixed grounded/up state and a
// captured _drive request. It proves no physical trajectory, native pixels,
// real mouse/device input, fairness, performance or genuine remote connection.
// The final test separately retains real generated ground and vehicle forces.
const CHAPTER = 7;
const DEEP = CAMPAIGN_BOSSES[CHAPTER - 1];
const DT = 1 / 60;

async function policyCase(runCase) {
  const sim = await new Sim({ seed: 7, journey: { version: 1, mode: 'campaign', level: CHAPTER } }).init();
  try {
    sim.director = new Director({ journey: sim.journey });
    sim.ground = { hasColliderAt: () => true, roadHeightAt: s => sim.road.sample(s).y };
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 400, speed: 30 });
    const car = sim.director.spawn(sim, DEEP.spec, .5, { behavior: DEEP.behavior,
      pattern: { ...DEEP.pattern }, side: 1, at: { s: 386, d: 0, speed: 30 },
      elite: { ...DEEP, index: DEEP.eliteIndex } });
    assert.ok(car, 'the real Director must create a live physical boss');
    sim.start(); sim.drainEvents();
    const originalSample = sim.road.sample.bind(sim.road);
    sim.road.sample = (s, out = {}) => { originalSample(s, out); out.k = 0; return out; };
    sim.road.featuresIn = () => [];
    sim.road.drivingPlan = [];
    car.s = 386; car.d = 0; player.s = 400; player.d = 0;
    car.veh.vf = player.veh.vf = 30;
    car.veh.grounded = 4; car.veh.up.set(0, 1, 0); car.veh.driverAlive = true;
    const brain = car.ai;
    assert.ok(brain instanceof EnemyBrain);
    brain.atkCd = 0;
    // Silence ordinary gun crew only in this focused policy fixture.
    brain.gunRoles = [];
    const requests = [];
    brain._drive = (dt, lane, speed, brake, nitro, horn) => requests.push({ dt, lane, speed, brake, nitro, horn });
    const step = (dt = DT) => { sim.time += dt; brain.update(dt); return requests.at(-1); };
    const enterWind = () => { step(); assert.equal(brain.atk?.phase, 'wind'); assert.equal(brain.atk.drill, true); };
    await runCase({ sim, player, car, brain, requests, step, enterWind });
  } finally { sim.dispose(); }
}

test('Deepwarden alone replaces its summons with interruptible drill charge and retains stable roster/progression identities', () => {
  assert.equal(DEEP.name, 'DEEPWARDEN'); assert.equal(DEEP.eliteIndex, 6);
  assert.equal(DEEP.enter, 'behind'); assert.equal(DEEP.behavior, 'rammer');
  assert.ok(DEEP.pattern.drillCharge); assert.equal(DEEP.pattern.summon, undefined);
  assert.equal(DEEP.pattern.crush, undefined);
  assert.deepEqual(ELITE_BOSSES.slice(0, 5), MINIBOSSES);
  assert.deepEqual(CAMPAIGN_BOSSES.map(m => m.eliteIndex), [0, 1, 2, 3, 5, 4, 6, 7, 8]);
  assert.equal(ELITE_BOSSES.filter(m => m.pattern?.drillCharge).length, 1);
  assert.equal(TEN_LEVELS[6].bossDistance, 5200);
});

test('one horn/warning locks a lane for at least the authored wind; moving the player cannot retarget wind or hit', async () => {
  await policyCase(({ sim, player, brain, step, enterWind }) => {
    enterWind(); const locked = brain.atk.lane, began = sim.time;
    player.d = 3.8;
    while (brain.atk?.phase === 'wind') {
      const request = step(); assert.equal(request.lane, locked); assert.equal(request.nitro, false);
      if (brain.atk?.phase === 'hit') assert.ok(sim.time - began >= DEEP.pattern.drillCharge.wind - 1e-9);
    }
    assert.equal(brain.atk.phase, 'hit');
    const request = step(); assert.equal(request.lane, locked); assert.equal(request.nitro, true);
    assert.ok(request.speed >= player.veh.vf + 8);
    assert.ok(request.speed <= player.veh.vf + DEEP.pattern.drillCharge.closing);
    assert.equal(sim.events.filter(e => e.t === 'enemyTell' && e.kind === 'drill').length, 1);
    assert.equal(brain.intent, 'ram');
  });
});

test('drill warning asks for bounded longitudinal standoff feedback without retargeting its lane or boosting', async () => {
  for (const [gap, expected] of [[6, 24], [10, 26.8], [14, 30], [15, 30.8], [19, 32]]) {
    await policyCase(({ player, car, brain, step, enterWind }) => {
      enterWind(); const lane = brain.atk.lane;
      player.s = car.s + gap;
      player.d = lane + 2;
      const request = step();
      assert.equal(brain.atk.phase, 'wind');
      assert.ok(Math.abs(request.speed - expected) < 1e-9,
        `actual warning drive request at gap${gap} must hold bounded standoff`);
      assert.equal(request.lane, lane); assert.equal(request.nitro, false);
      assert.equal(brain.atk.lane, lane);
    });
  }
});

test('the hit commitment expires without contact or successful impact and boost ends on that same update', async () => {
  await policyCase(({ brain, step, enterWind }) => {
    enterWind(); while (brain.atk.phase === 'wind') step();
    let elapsed = 0, request;
    while (brain.atk.phase === 'hit') { request = step(); elapsed += DT; }
    assert.ok(elapsed <= DEEP.pattern.drillCharge.hit + DT + 1e-9);
    assert.equal(brain.atk.phase, 'recover'); assert.equal(request.nitro, false);
    while (brain.atk) step();
    assert.ok(brain.atkCd > 0, 'real cooldown must survive a missed charge');
  });
});

test('accepted engine-zone damage jams the warning while hull damage cannot fake the interruption', async () => {
  await policyCase(({ sim, car, brain, step, enterWind }) => {
    enterWind();
    const engineBefore = car.engineHp;
    sim.damageZone(car, { kind: 'body' }, 200, { cause: 'bullet', src: 1 });
    step(); assert.equal(brain.atk.phase, 'wind'); assert.equal(car.engineHp, engineBefore);
    sim.damageZone(car, { kind: 'engine' }, 31, { cause: 'bullet', src: 1 });
    assert.ok(engineBefore - car.engineHp >= DEEP.pattern.drillCharge.jamDamage);
    const request = step(); assert.equal(brain.atk.phase, 'recover'); assert.equal(brain.atk.jammed, true);
    assert.equal(request.nitro, false);
    assert.equal(sim.events.filter(e => e.t === 'enemyTell' && e.kind === 'drillJammed').length, 1);
    step(); assert.equal(sim.events.filter(e => e.kind === 'drillJammed').length, 1);
    assert.ok(car.hp < car.maxHp, 'jam does not erase actual accepted boss damage');
  });
});

test('pre-warning engine damage cannot permanently jam later charges', async () => {
  await policyCase(({ sim, car, brain, step, enterWind }) => {
    sim.damageZone(car, { kind: 'engine' }, 100, { cause: 'bullet', src: 1 });
    enterWind(); step(); assert.equal(brain.atk.phase, 'wind');
    while (brain.atk.phase === 'wind') step();
    assert.equal(brain.atk.phase, 'hit'); assert.equal(brain.atk.jammed, undefined);
  });
});

test('real onContact path ends a hit and contact during the warning cannot launch a later charge', async () => {
  for (const phase of ['wind', 'hit']) await policyCase(({ sim, player, car, brain, step, enterWind }) => {
    enterWind(); if (phase === 'hit') while (brain.atk.phase === 'wind') step();
    sim.director.onCrash(sim, car, player, 3);
    assert.equal(brain.atk.contact, true);
    const request = step(); assert.equal(brain.atk.phase, 'recover'); assert.equal(request.nitro, false);
  });
});

test('Deepwarden receives attack bonus damage only in hit; ordinary physical collision damage remains owned by Sim', async () => {
  for (const phase of ['line', 'wind', 'hit', 'recover']) await policyCase(({ sim, player, car, brain }) => {
    brain._startAttack(14, 0); brain.atk.phase = phase;
    const before = player.hp;
    sim.director.onCrash(sim, player, car, 3);
    assert.equal(player.hp < before, phase === 'hit');
  });
});

test('ordinary ram warning bonus and existing ordinary ram targeting remain unchanged', async () => {
  await policyCase(({ sim, player, car, brain, step }) => {
    brain.pattern = null; car.elite = null; brain._startAttack(14, 0); brain.atk.phase = 'wind';
    assert.equal(brain.atk.drill, undefined);
    const before = player.hp; sim.director.onCrash(sim, player, car, 3); assert.ok(player.hp < before);
    player.d = 2; const request = step(); assert.equal(request.lane, player.d + brain.atk.side * .25);
  });
});

for (const reason of ['car recovery', 'player recovery', 'cross route', 'ground gap', 'roadblock', 'stage challenge', 'ramp', 'curve', 'upside down', 'engine lost']) {
  test(`saved drill warning cancels safely after ${reason}`, async () => {
    await policyCase(({ sim, player, car, brain, step, enterWind }) => {
      enterWind();
      if (reason === 'car recovery') car.veh.poseRevision = (car.veh.poseRevision || 0) + 1;
      if (reason === 'player recovery') player.veh.poseRevision = (player.veh.poseRevision || 0) + 1;
      if (reason === 'cross route') player.route = 'other-controlled-route';
      if (reason === 'ground gap') sim.ground.hasColliderAt = () => false;
      if (reason === 'roadblock') sim.road.featuresIn = (from, to, kind) => kind && kind !== 'roadblock' ? [] : [{ type: 'roadblock', s0: 390, s1: 398, gap: 0 }];
      if (reason === 'stage challenge') sim.road.featuresIn = (from, to, kind) => kind ? [] : [{ type: 'stage_challenge', s0: 390, s1: 398 }];
      if (reason === 'ramp') sim.road.featuresIn = (from, to, kind) => kind ? [] : [{ type: 'ramp', s0: 390, s1: 398 }];
      if (reason === 'curve') { const sample = sim.road.sample; sim.road.sample = (s, out) => { const result = sample(s, out); result.k = 1 / 150; return result; }; }
      if (reason === 'upside down') car.veh.up.y = -.8;
      if (reason === 'engine lost') car.engineHp = 0;
      const request = step(); assert.equal(brain.atk, null); assert.equal(request.nitro, false);
      assert.ok(brain.atkCd > 0);
    });
  });
}

test('braking to zero after the tell is an ordinary evasive choice, not a switch that cancels the committed lane', async () => {
  await policyCase(({ player, brain, step, enterWind }) => {
    enterWind(); player.veh.vf = 0;
    const locked = brain.atk.lane;
    while (brain.atk.phase === 'wind') { step(); assert.ok(brain.atk); }
    assert.equal(brain.atk.phase, 'hit');
    const request = step(); assert.equal(request.lane, locked);
    assert.ok(request.speed >= 8 && request.speed <= DEEP.pattern.drillCharge.closing);
    assert.equal(request.nitro, true);
  });
});

test('branch routes cannot start a drill commitment while tunnel descriptors remain valid arena geometry', async () => {
  await policyCase(({ sim, car, player, brain }) => {
    const path = enemyDrivingContext(sim.road, car, player, {});
    assert.equal(brain._drillSafe({ ...path, branch: { width: 8.6 } }), false);
    sim.road.featuresIn = () => [{ type: 'tunnel', s0: 380, s1: 520 }];
    assert.equal(brain._drillSafe(path), true);
  });
});

test('driver death, explosion and lost player clear commitment rather than preserving a stale drill intent', async () => {
  for (const reason of ['driver', 'explosion', 'player']) await policyCase(({ sim, player, car, brain, step, enterWind }) => {
    enterWind();
    if (reason === 'driver') { sim.damageCrew(car, 'driver', car.crew.driver.max * 100, { cause: 'bullet', src: 1 }); brain._deadDriver = () => {}; }
    if (reason === 'explosion') car.exploded = true;
    if (reason === 'player') player.exploded = true;
    step(); assert.equal(brain.atk, null); assert.notEqual(brain.intent, 'ram');
  });
});

test('drill intent and stable elite index retain the existing snapshot encoding without a protocol change', async () => {
  await policyCase(({ sim, car, enterWind }) => {
    enterWind();
    const local = stateFromCar(car, 1, makeCarState(car.id, car.spec.id, car.kind)); assert.equal(local.elite, 7); assert.equal(local.intent, 'ram');
    const packet = encodeSnapshot(sim, 1, { hp01: 1, dhp01: 1, ghp01: 1, nitro01: 1, dist: sim.player.s }); assert.ok(packet);
    const decoded = decodeSnapshot(packet); const peer = decoded.cars.find(c => c.id === car.id);
    assert.equal(peer.elite, 7); assert.equal(peer.intent, 'ram');
  });
});

// Real generated-ground fixture: no assignments to attack/contact/grounding,
// timers/tank/pose revisions or curve inputs. This is a controlled CPU physics
// trajectory, not native play, full campaign or a proof of good balance.
// The original focused-first.tap failure is retained. That automatic selector
// starts at seed7/s4170, BEFORE the real chapter threshold, against a high-speed
// upgraded road-following target on later bends. It is a bounded safe-escape
// trajectory, not a legitimate demand that every such target must get rammed.
test('collision-only pre-threshold fast curved pursuit stays safe without requiring a guaranteed drill hit', async () => {
  const f = await physicalFixture({ enemy: DEEP.spec, behavior: DEEP.behavior, gap: 24, speed: 30,
    seconds: 18, travelSpeed: 85, journey: { version: 1, mode: 'campaign', level: CHAPTER },
    pattern: { ...DEEP.pattern }, elite: { ...DEEP, gunners: 0, index: DEEP.eliteIndex }, recordSteps: true });
  try {
    assert.equal(f.scene.seed, 7); assert.equal(f.scene.s, 4170);
    assert.equal(f.car.spec.gunners, 0); assert.equal(f.brain.gunRoles.length, 0);
    assert.ok(f.scene.s < TEN_LEVELS[CHAPTER - 1].bossDistance);
    const rows = runActualClock(f, 18, { throttle: .65, requestedCap: 36 });
    actualTrajectoryGuards(f, rows);
    for (const contact of f.contacts.filter(c => c.attack?.drill && c.attack.phase === 'hit' && physicalContact(c)))
      actualWarningBeforeContact(f, contact, rows);
    assert.ok(f.sim.time >= 18 - PHYS_DT, 'ordinary generated-ground trajectory must complete the declared finite escape window');
    assert.equal(f.sim.stats.cash, 0); assert.equal(f.sim.stats.kills, 0);
  } finally { f.sim.dispose(); }
});

// run() budgets requested 120Hz steps. Genuine impacts can invoke source hitStop
// and makes the actual simulation clock advance by .1dt for affected steps.
// Keep the original first requested chunk, then bounded real continuations;
// never silence weapons, change clocks/timers or discard the slowed frames.
function runActualClock(f, seconds, { throttle = .65, until, requestedCap = seconds * 2 } = {}) {
  assert.ok(f.recordSteps && Number.isFinite(seconds) && seconds > 0);
  assert.ok(Number.isFinite(requestedCap) && requestedCap >= seconds);
  const from = f.sim.time, target = from + seconds, rawFrom = f.raw.length;
  const maxSteps = Math.floor(requestedCap / PHYS_DT + 1e-9), rows = [];
  const terminal = () => f.sim.state !== 'run' || f.player.dead || f.car.dead || f.player.exploded || f.car.exploded;
  const done = () => until?.(f) || terminal() || f.sim.time >= target - 1e-9 || f.raw.length - rawFrom >= maxSteps;
  let first = true;
  while (!done()) {
    const rawBefore = f.raw.length, remaining = maxSteps - (rawBefore - rawFrom);
    const requested = Math.min(first ? seconds : .25, remaining * PHYS_DT);
    first = false;
    rows.push(...run(f, requested, { throttle, until: done }));
    assert.ok(f.raw.length > rawBefore, 'actual-clock continuation must perform genuine recorded Sim steps');
  }
  const steps = f.raw.slice(rawFrom), requested = steps.reduce((sum, step) => sum + step.requestedDt, 0);
  const receipt = { from, target, actualEnd: f.sim.time, requested, steps: steps.length,
    reason: until?.(f) ? 'condition' : terminal() ? 'terminal' : f.sim.time >= target - 1e-9 ? 'actual-clock' : 'requested-cap' };
  (f.actualClockWindows ||= []).push(receipt);
  assert.ok(requested <= requestedCap + 1e-8, 'actual-clock fixture retains its finite nominal step cap');
  assert.ok(receipt.reason !== 'requested-cap', `actual clock failed to reach its bounded target: ${JSON.stringify(receipt)}`);
  return rows;
}

function actualTrajectoryGuards(f, rows) {
  assert.ok(rows.length > 0); assert.ok(finiteSupported(rows), diagnostic(f, rows));
  assert.ok(rows.every(r => Number.isInteger(r.grounded) && r.grounded >= 0 && r.grounded <= f.car.spec.wheels.length
    && Number.isInteger(r.playerGrounded) && r.playerGrounded >= 0 && r.playerGrounded <= f.player.spec.wheels.length
    && Number.isFinite(r.up) && r.up >= -1 && r.up <= 1
    && Number.isFinite(r.playerUp) && r.playerUp >= -1 && r.playerUp <= 1), 'actual sampled suspension/orientation fields remain physical');
  // Root's retained actual spawn-settle-third receipts show both sites first
  // have zero wheel contacts at PHYS_DT, then real contact at 2 * PHYS_DT.
  // Keep those initial airborne frames; require simultaneous physical settling
  // within six real Sim steps, before the first actual charge warning.
  const settledSpawn = f.raw.find(step => [step.after.enemy, step.after.player].every(body =>
    body.loaded && body.grounded >= 2 && body.up > .8));
  assert.ok(settledSpawn && settledSpawn.after.time <= .05 + 1e-9,
    'both actual actors must settle onto loaded ground upright within .05s; finite initial air is not ground proof');
  const firstTell = f.sim.events.find(e => e.t === 'enemyTell' && e.kind === 'drill' && e.id === f.car.id);
  if (firstTell) assert.ok(settledSpawn.after.time < firstTell.time,
    'actual spawn wheel contact must precede the first genuine drill warning');
  assert.ok(rows.every(r => r.poseRevision === 0 && r.playerPoseRevision === 0), 'real trajectory cannot credit recovery placement');
  assert.ok(rows.every(r => r.loadedEnemy && r.loadedPlayer), 'actual terrain support remains installed for both actors');
  assert.ok(f.raw.every(step => Number.isFinite(step.before.hitStop) && Number.isFinite(step.after.hitStop)
    && Number.isFinite(step.effectiveDt) && step.effectiveDt > 0
    && Math.abs(step.effectiveDt - step.requestedDt * (step.before.hitStop > 0 ? .1 : 1)) < 1e-9),
    'all raw hit-stop frames retain actual requested/effective dt and the unchanged source scaling');
  assert.ok(f.raw.every(step => [step.after.enemy, step.after.player].every(body =>
    body.pos.every(Number.isFinite) && body.velocity.every(Number.isFinite)
    && Object.values(body.quat).every(Number.isFinite) && Number.isFinite(body.up)
    && Number.isInteger(body.grounded) && body.grounded >= 0
    && body.loaded && body.poseRevision === 0)), 'every recorded actual Sim step retains finite loaded unrecovered bodies');
  assert.ok(!f.sim.events.some(e => e.t === 'groundRecovered' || e.t === 'unflip'), diagnostic(f, rows));
  assert.equal(f.car.ai, f.brain);
}
function actualWarningBeforeContact(f, contact, rows) {
  const tell = f.sim.events.find(e => e.t === 'enemyTell' && e.kind === 'drill'
    && e.id === f.car.id && e.time === contact.attack.warnedAt);
  assert.ok(tell, diagnostic(f, rows));
  assert.ok(contact.time - tell.time >= DEEP.pattern.drillCharge.wind - PHYS_DT - 1e-9, diagnostic(f, rows));
  return tell;
}

// This exact genuine post-threshold site produced a real contact in root's
// CLOSED second probe with only hit1.25->2.4. This case fabricates no road,
// ground, attack, contact, AI state, timer, pose, health or tank. Unchanged
// fixture observer wrappers delegate real driving/contact/damage methods.
// Ordinary traffic/hazards remain isolated by that physical fixture. The normal
// Director elite constructor gunners:0 separately isolates collision acceptance:
// retained armed probes hit, then fuel-tank gunfire kills before recovery ends.
// No brain mutation or damage suppression is used; full armed native encounter
// acceptance remains required and cannot be inferred from these two cases.
test('collision-only post-threshold seed7 drill naturally warns, physically hits, then releases boost and enters real recovery/cooldown', async () => {
  assert.equal(DEEP.pattern.drillCharge.wind, 2.0);
  assert.equal(DEEP.pattern.drillCharge.hit, 2.4);
  assert.equal(DEEP.pattern.drillCharge.recover, 3);
  assert.equal(DEEP.pattern.drillCharge.cooldown, 9);
  assert.equal(DEEP.pattern.drillCharge.closing, 10);
  assert.equal(DEEP.pattern.drillCharge.jamDamage, 90);
  const startS = 5256;
  assert.ok(startS - 24 > TEN_LEVELS[CHAPTER - 1].bossDistance, 'both declared actors start past the real boss threshold');
  const f = await physicalFixture({ enemy: DEEP.spec, behavior: DEEP.behavior, seed: 7, s: startS,
    gap: 24, speed: 30, seconds: 18, travelSpeed: 85,
    journey: { version: 1, mode: 'campaign', level: CHAPTER },
    pattern: { ...DEEP.pattern }, elite: { ...DEEP, gunners: 0, index: DEEP.eliteIndex }, recordSteps: true });
  try {
    assert.equal(f.car.spec.gunners, 0); assert.equal(f.brain.gunRoles.length, 0);
    const rows = runActualClock(f, 18, { throttle: .65, requestedCap: 36,
      until: () => f.contacts.some(c => c.attack?.drill && c.attack.phase === 'hit' && physicalContact(c)) });
    actualTrajectoryGuards(f, rows);
    const contact = f.contacts.find(c => c.attack?.drill && c.attack.phase === 'hit' && physicalContact(c));
    assert.ok(contact, diagnostic(f, rows));
    actualWarningBeforeContact(f, contact, rows);
    assert.ok(contact.contact, 'real Director contact callback marks the actual attack');
    const warnedAt = contact.attack.warnedAt;
    const committed = f.driveIntents.filter(row => row.attack?.drill && row.attack.warnedAt === warnedAt
      && (row.attack.phase === 'wind' || row.attack.phase === 'hit'));
    assert.ok(committed.length > 0);
    assert.ok(committed.every(row => row.attack.lane === contact.attack.lane
      && Math.abs(row.targetD - contact.attack.lane) < 1e-9), 'actual natural wind/hit requests retain the warned lane');
    const afterContactFrom = f.aiUpdates.length;
    const tail = runActualClock(f, DEEP.pattern.drillCharge.recover + PHYS_DT * 8, { throttle: .65,
      until: () => f.brain.atk === null && Number.isFinite(f.brain.atkCd) && f.brain.atkCd > 0 });
    rows.push(...tail); actualTrajectoryGuards(f, rows);
    const post = f.aiUpdates.slice(afterContactFrom);
    assert.ok(post.some(update => update.before?.drill && update.before.warnedAt === warnedAt
      && (update.after?.phase === 'recover' || update.after === null)),
    'same natural commitment must enter recovery or its unchanged safety cancellation, never a fabricated callback');
    assert.equal(f.brain.atk, null, diagnostic(f, rows));
    assert.ok(Number.isFinite(f.brain.atkCd) && f.brain.atkCd > 0, diagnostic(f, rows));
    assert.equal(f.car.veh.input.nitro, false, 'post-contact natural release cannot retain charge boost');
    const cooldown = f.brain.atkCd;
    const cooling = runActualClock(f, Math.min(.5, cooldown / 4), { throttle: .65 });
    rows.push(...cooling); actualTrajectoryGuards(f, rows);
    const settled = rows.at(-1);
    assert.ok(settled.grounded >= 2 && settled.playerGrounded >= 2 && settled.up > .8 && settled.playerUp > .8,
      'after the natural contact transient, both actual loaded actors settle upright with wheel contact');
    assert.equal(f.brain.atk, null, 'positive real cooldown must prevent an immediate new charge');
    assert.ok(f.brain.atkCd > 0 && f.brain.atkCd < cooldown, 'real subsequent AI frames consume cooldown without a timer setter');
    assert.equal(f.car.veh.input.nitro, false);
    assert.ok(f.ramDamage.some(hit => hit.actual > 0 && hit.time >= contact.time - PHYS_DT
      && hit.time <= contact.time + PHYS_DT * 3),
    'actual contact must produce accepted ordinary player damage, not merely a visible near pass');
    assert.equal(f.sim.stats.cash, 0); assert.equal(f.sim.stats.kills, 0);
    assert.equal(f.sim.result, null, 'contact/recovery cannot grant a clear or payout');
    assert.ok(!f.sim.events.some(e => e.t === 'minibossDown' || e.t === 'levelCleared' || e.t === 'campaignClear'));
  } finally { f.sim.dispose(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.js';
import { Leviathan } from '../src/sim/boss.js';
import { BOSS } from '../src/data/boss.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { rng } from '../src/core/util.js';

const DT = 1 / 120;
const alive = sim => [...sim.cars.values()].filter(car => car.kind === 'enemy' && !car.exploded);
const ramps = sim => sim.events.filter(event => event.t === 'bossRamp');

async function fixture(run) {
  const sim = await new Sim({ seed: 7, journey: { version: 1, mode: 'campaign', level: 10 } }).init();
  try {
    const director = sim.director;
    director.r = rng(222); director.level = .9;
    // Explicit controlled loaded-asphalt provider. The production feature,
    // biome and physical-spawn guards and real Rapier bodies remain intact.
    // This fixture does not claim route driving or native boss balance.
    let loaded = true;
    sim.ground = { hasColliderAt: () => loaded, roadHeightAt: s => sim.road.sample(s).y };
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: TEN_LEVELS[9].bossDistance });
    director.playerVmax = player.spec.engine.vmax;
    sim.start(); sim.time = 60; sim.tick = 1;
    let bossS = null;
    for (let s = player.s + 280; s <= player.s + 560; s += 20) {
      if (!sim.road.featuresIn(s - 46, s - 2).some(f => ['roadblock', 'ramp', 'stage_challenge'].includes(f.type))) { bossS = s; break; }
    }
    assert.ok(bossS !== null, 'seeded scene supplies a legal authored ramp spawn slot');
    const boss = sim.boss = new Leviathan(sim, bossS);
    director.bossSpawned = true;
    const attempts = [], spawnAt = director.spawnAt;
    director.spawnAt = function (...args) {
      const car = spawnAt.apply(this, args);
      attempts.push({ time: boss.t, key: args[1], s: args[2], d: args[3], speed: args[4], options: { ...args[5] }, car });
      return car;
    };
    sim.drainEvents();
    await run({ sim, director, boss, player, attempts, setLoaded: value => { loaded = value; } });
  } finally { sim.dispose(); }
}

function traffic(sim, director, player, count) {
  const created = [], rejected = [];
  for (let offset = 70; offset <= 580 && created.length < count; offset += 20) {
    const at = { s: player.s + offset, d: created.length % 2 ? -5 : 5, speed: 20 };
    const car = director.spawn(sim, 'e_sedan', .5, { at });
    if (car) created.push(car); else rejected.push(at.s);
  }
  assert.equal(created.length, count, `legal original spawn guard slots required: ${JSON.stringify(rejected)}`);
  return created;
}

function finishPhaseWave(sim, boss) {
  boss._setPhase(2);
  for (let i = 0; i < BOSS.waves[2].length; i++) {
    boss.t = 1.5 + i * 1.4 + (i + 1) * DT;
    boss._beats(DT);
    assert.equal(boss.dropQ.length, BOSS.waves[2].length - i - 1);
    for (const car of alive(sim)) sim.removeCar(car, 'controlled completed phase-wave cleanup');
  }
  sim.drainEvents();
}

test('due escort query is read-only, ignores future jobs and ignores a dead boss', async () => {
  await fixture(({ boss }) => {
    assert.equal(boss.dueEscort(), false);
    boss._setPhase(2);
    const queue = boss.dropQ.map(q => ({ ...q })), cooldown = boss.cd.ramp;
    boss.t = 1.5 - DT;
    assert.equal(boss.dueEscort(), false);
    assert.deepEqual(boss.dropQ, queue); assert.equal(boss.cd.ramp, cooldown);
    boss.t = 1.5; assert.equal(boss.dueEscort(), true);
    boss._die(); assert.equal(boss.dueEscort(), false); assert.equal(boss.dropQ.length, 0);
  });
});

test('dense ordinary overlap retains due phase escorts without false ramp events', async () => {
  await fixture(({ sim, director, boss, player, attempts }) => {
    traffic(sim, director, player, 8);
    boss._setPhase(2); boss.t = 8;
    const jobs = boss.dropQ.slice(); sim.drainEvents();
    boss._beats(DT);
    assert.deepEqual(boss.dropQ, jobs); assert.equal(alive(sim).length, 8);
    assert.equal(attempts.length, 0); assert.equal(ramps(sim).length, 0);
    assert.equal(boss.dueEscort(), true, 'due retained support keeps ordinary waves from using its slot');
    boss.t += .25; boss._beats(DT);
    assert.deepEqual(boss.dropQ, jobs); assert.equal(attempts.length, 0);
  });
});

test('overdue phase jobs recover one actual spawn at a time with authored spacing', async () => {
  await fixture(({ sim, director, boss, player, attempts }) => {
    const pack = traffic(sim, director, player, 8);
    boss._setPhase(2); boss.t = 8; boss._beats(DT);
    for (const car of pack.slice(0, 4)) sim.removeCar(car, 'controlled freed escort slots');
    sim.drainEvents(); boss.t += .25;
    const start = boss.t;
    boss._beats(DT);
    assert.equal(attempts.length, 1); assert.equal(alive(sim).length, 5);
    assert.equal(boss.dropQ.length, 2); assert.equal(ramps(sim).length, 1);
    assert.ok(attempts[0].car?.veh.body.isValid()); assert.equal(attempts[0].key, BOSS.waves[2][0]);
    boss._beats(DT); assert.equal(attempts.length, 1, 'no same-frame overdue burst');
    boss.t = start + 1.4 - DT; boss._beats(DT); assert.equal(attempts.length, 1);
    boss.t = start + 1.4; boss._beats(DT); assert.equal(attempts.length, 2);
    boss.t = start + 2.8 + DT; boss._beats(DT); assert.equal(attempts.length, 3);
    assert.deepEqual(attempts.map(a => a.key), BOSS.waves[2]);
    assert.equal(boss.dropQ.length, 0); assert.equal(ramps(sim).length, 3);
    assert.equal(alive(sim).length, 7, 'phase guard never exceeds its original eight-live limit');
  });
});

test('actual missing-ground phase spawn retries boundedly without consuming its job', async () => {
  await fixture(({ sim, boss, attempts, setLoaded }) => {
    boss._setPhase(2); boss.t = 1.5; sim.drainEvents();
    setLoaded(false); const queue = boss.dropQ.slice(), bodies = sim.world.bodies.len();
    boss._beats(DT);
    assert.equal(attempts.length, 1); assert.equal(attempts[0].car, false);
    assert.deepEqual(boss.dropQ, queue); assert.equal(sim.world.bodies.len(), bodies);
    assert.equal(ramps(sim).length, 0); assert.equal(boss.dueEscort(), true);
    for (let i = 1; i < 30; i++) { boss.t = 1.5 + i * DT; boss._beats(DT); }
    assert.equal(attempts.length, 1, 'physical spawn guard is not retried every fixed step');
    setLoaded(true); boss.t = 1.75; boss._beats(DT);
    assert.equal(attempts.length, 2); assert.ok(attempts[1].car?.veh.body.isValid());
    assert.equal(attempts[1].key, attempts[0].key); assert.deepEqual(attempts[1].options, attempts[0].options);
    assert.equal(boss.dropQ.length, 2); assert.equal(ramps(sim).length, 1);
    assert.ok(sim.events.some(e => e.t === 'enemySpawn' && e.id === attempts[1].car.id));
  });
});

test('periodic ramp keeps its due cooldown through full traffic then earns normal cooldown on success', async () => {
  await fixture(({ sim, director, boss, player, attempts }) => {
    finishPhaseWave(sim, boss); attempts.length = 0;
    const pack = traffic(sim, director, player, 7);
    boss.t = 8; boss.cd.ramp = DT; sim.drainEvents();
    boss._ramp(DT, player);
    assert.equal(boss.cd.ramp, 0); assert.equal(boss.dueEscort(), true);
    assert.equal(attempts.length, 0); assert.equal(ramps(sim).length, 0);
    for (const car of pack.slice(0, 2)) sim.removeCar(car, 'controlled periodic escort slots');
    boss.t += .25; boss._ramp(DT, player);
    assert.equal(attempts.length, 1); assert.ok(attempts[0].car?.veh.body.isValid());
    assert.ok(BOSS.ramp.cars.includes(attempts[0].key));
    assert.ok(boss.cd.ramp >= BOSS.ramp.every[0] && boss.cd.ramp <= BOSS.ramp.every[1]);
    assert.equal(boss.dueEscort(), false); assert.equal(ramps(sim).length, 1);
    assert.equal(alive(sim).length, 6, 'periodic ramp retains original seven-live limit');
  });
});

test('actual missing-ground periodic failure does not reset the cycle or reroll its retained car', async () => {
  await fixture(({ sim, boss, player, attempts, setLoaded }) => {
    finishPhaseWave(sim, boss); attempts.length = 0;
    boss.t = 8; boss.cd.ramp = 0; setLoaded(false);
    boss._ramp(DT, player);
    assert.equal(attempts.length, 1); assert.equal(attempts[0].car, false);
    assert.equal(boss.cd.ramp, 0); assert.equal(ramps(sim).length, 0);
    for (let i = 1; i < 30; i++) { boss.t = 8 + i * DT; boss._ramp(DT, player); }
    assert.equal(attempts.length, 1);
    setLoaded(true); boss.t = 8.25; boss._ramp(DT, player);
    assert.equal(attempts.length, 2); assert.equal(attempts[1].key, attempts[0].key);
    assert.ok(attempts[1].car?.veh.body.isValid()); assert.equal(ramps(sim).length, 1);
    assert.ok(boss.cd.ramp >= BOSS.ramp.every[0] && boss.cd.ramp <= BOSS.ramp.every[1]);
  });
});

test('due phase support and periodic ramp cannot both spawn in one update', async () => {
  await fixture(({ sim, boss, player, attempts }) => {
    boss._setPhase(2); boss.t = 8; boss.cd.ramp = 0; sim.drainEvents();
    boss._beats(DT); boss._ramp(DT, player);
    assert.equal(attempts.length, 1); assert.equal(ramps(sim).length, 1);
    boss.t += 1.4; boss._beats(DT); boss._ramp(DT, player);
    assert.equal(attempts.length, 2);
    boss.t += 1.4; boss._beats(DT); boss._ramp(DT, player);
    assert.equal(attempts.length, 3); assert.equal(boss.dropQ.length, 0);
    boss.t += 1.4; boss._beats(DT); boss._ramp(DT, player);
    assert.equal(attempts.length, 4); assert.equal(ramps(sim).length, 4);
    assert.ok(attempts.every(a => a.car?.veh.body.isValid()));
  });
});

test('actual director accrues normal pacing and cleanup while prioritizing only due authored support', async () => {
  await fixture(({ sim, director, boss, player }) => {
    director.encounters = 2; director.lastEngaged = sim.time; director.cooldown = 0; director.budget = 8;
    const straggler = sim.spawnCar('e_sedan', { kind: 'enemy', s: player.s - 350 });
    boss._setPhase(2); boss.t = 1.5; sim.drainEvents();
    const budget = director.budget, pulse = director.pulse;
    director.update(DT, sim);
    assert.ok(director.budget > budget); assert.ok(director.pulse > pulse);
    assert.equal(sim.cars.has(straggler.id), false, 'actual straggler cleanup continues');
    assert.equal(sim.events.some(e => e.t === 'encounter'), false, 'ordinary wave cannot consume a due escort opportunity');
    boss._beats(DT); assert.equal(ramps(sim).length, 1);
    assert.equal(boss.dueEscort(), false, 'remaining future phase jobs do not monopolize ordinary waves');
    sim.drainEvents();
    for (let i = 0; i < 20 && !sim.events.some(e => e.t === 'encounter'); i++) {
      sim.time += .05; boss.t += .05; director.update(.05, sim);
    }
    assert.ok(sim.events.some(e => e.t === 'encounter'), 'ordinary budgeted selection resumes between authored deadlines');
    assert.ok(director.budget < budget); assert.ok(director.cooldown > 0);
  });
});

test('boss death clears retained support and cannot issue another spawn or fake ramp', async () => {
  await fixture(({ sim, boss, player, attempts, setLoaded }) => {
    boss._setPhase(2); boss.t = 1.5; setLoaded(false); boss._beats(DT);
    assert.equal(boss.dropQ.length, 3); assert.equal(attempts.length, 1);
    boss._die(); sim.drainEvents(); setLoaded(true); boss.t += 10;
    boss._beats(DT); boss._ramp(DT, player);
    assert.equal(boss.dropQ.length, 0); assert.equal(boss.rampEscort, null);
    assert.equal(boss.dueEscort(), false); assert.equal(attempts.length, 1); assert.equal(ramps(sim).length, 0);
    boss.destroy(); assert.equal(boss.body.isValid(), false);
  });
});

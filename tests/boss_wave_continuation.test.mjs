// Silent CPU checks of actual production boss-wave scheduling and spawn guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.js';
import { Director } from '../src/sim/director.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { rng } from '../src/core/util.js';

const DT = 1 / 120;

async function fixture(Director, level, run) {
  const sim = await new Sim({ seed: 7, journey: { version: 1, mode: 'campaign', level } }).init();
  try {
    const director = sim.director = new Director({ journey: sim.journey });
    director.r = rng(222);
    // Controlled loaded-asphalt fixture; physical spawn bodies and actual
    // collision/clearance queries remain Rapier. This is not a full route.
    sim.ground = { hasColliderAt: () => true, roadHeightAt: s => sim.road.sample(s).y };
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: TEN_LEVELS[level - 1].bossDistance });
    director.playerVmax = player.spec.engine.vmax;
    sim.start(); sim.drainEvents();
    sim.time = 60; sim.tick = 1;
    director.encounters = 2; director.lastEngaged = 60;
    director.budget = 14; director.cooldown = 0;
    await run({ sim, player, director });
  } finally { sim.dispose(); }
}

const normalCars = sim => [...sim.cars.values()].filter(car => car.kind === 'enemy' && !car.exploded && !car.elite);

for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  test(`chapter ${level}: ordinary budgeted encounters continue alongside the retained boss`, async () => {
    await fixture(Director, level, ({ sim, player, director }) => {
      // Original legal placement can reject a selected squad. Allow the normal
      // scheduler to choose again for at most half a second; no guard bypass,
      // forced encounter, fake terrain ray or simulated driving is claimed.
      for (let step = 0; step < 60 && !sim.events.some(event => event.t === 'encounter'); step++) {
        director.update(DT, sim); sim.time += DT; sim.tick++;
      }
      const boss = director.activeElite;
      assert.ok(boss); assert.equal(boss.chapter, level);
      assert.ok(boss.cars.every(car => sim.cars.has(car.id) && !car.exploded));
      assert.ok(sim.events.some(event => event.t === 'encounter'), 'actual ordinary encounter selected during boss fight');
      assert.ok(normalCars(sim).length > 0);
      assert.ok(director.budget < 14, 'ordinary wave still spends its normal budget');
      assert.ok(director.cooldown > 0, 'ordinary wave retains normal pacing');
      assert.equal(director.campaignComplete, false);
      assert.equal(player.hp, player.maxHp, 'entering an elite does not damage the player');
    });
  });
}

test('finale ordinary wave keeps Leviathan-specific damage tuning and the living boss', async () => {
  await fixture(Director, 10, ({ sim, director }) => {
    director.update(DT, sim);
    assert.ok(sim.boss && !sim.boss.dead);
    assert.ok(sim.events.some(event => event.t === 'encounter'));
    assert.ok(normalCars(sim).length > 0);
    assert.equal(sim.bossDamageMul, .55 + .45 * .88);
    assert.equal(sim.enemyDamageMul, .55 + .4 * .55 + .12 * (.88 - .55));
    assert.equal(sim.enemyRamMul, .8);
    assert.equal(sim.playerBlastMul, .45);
    assert.equal(sim.playerCarBlastMul, .8);
    assert.equal(director.campaignComplete, false);
  });
});

test('finale arrival retains existing ordinary traffic in active combat', async () => {
    await fixture(Director, 10, ({ sim, player, director }) => {
      const ordinary = director.spawn(sim, 'e_sedan', .7, { at: { s: player.s + 80, d: -1.7, speed: 25 } });
      assert.ok(ordinary);
      director.update(DT, sim);
      assert.ok(sim.boss && !sim.boss.dead);
      assert.equal(sim.cars.get(ordinary.id), ordinary);
      assert.equal(!!ordinary.bossClear, false, 'existing traffic keeps its normal pursuit/attack brain');
    });
});

test('normal budgeted-wave cap still blocks a further ordinary squad beside an elite', async () => {
  await fixture(Director, 1, ({ sim, player, director }) => {
    director._bosses(sim, player, .3);
    assert.ok(director.activeElite);
    const cap = Math.round(3 + 6.8 * Math.pow(.3, .8));
    const rejected = [];
    // The seeded route has genuine solid stage features. Find loaded, spaced
    // slots through the production spawn guard rather than asserting that one
    // arbitrary point is physically legal. Never force or remove an obstacle.
    for (let offset = 180; offset <= 590 && [...sim.cars.values()].filter(car => car.kind === 'enemy' && !car.exploded).length < cap; offset += 35) {
      const at = { s: player.s + offset, d: offset % 70 === 5 ? -5 : 5, speed: 15 };
      const car = director.spawn(sim, 'e_sedan', .3, { at });
      if (!car) rejected.push({ at, features: sim.road.featuresIn(at.s - 22, at.s + 22).map(f => ({ type: f.type, s0: f.s0, s1: f.s1 })) });
    }
    assert.equal([...sim.cars.values()].filter(car => car.kind === 'enemy' && !car.exploded).length, cap, JSON.stringify({ rejected }));
    const before = sim.cars.size;
    sim.drainEvents(); director.update(DT, sim);
    assert.equal(sim.cars.size, before, 'boss fight does not bypass normal wave capacity');
    assert.equal(sim.events.some(event => event.t === 'encounter'), false);
  });
});

test('boss ordinary wave respects insufficient budget and active cooldown', async () => {
  for (const blocker of ['budget', 'cooldown']) {
    await fixture(Director, 1, ({ sim, director }) => {
      if (blocker === 'budget') { director.budget = 0; director.disabled.add('fill_rammer'); }
      else director.cooldown = 10;
      director.update(DT, sim);
      assert.ok(director.activeElite);
      assert.equal(sim.events.some(event => event.t === 'encounter'), false, blocker);
    });
  }
});

test('authored elite escorts retain staggered queue timing rather than spawning as one frame burst', async () => {
  await fixture(Director, 3, ({ sim, player, director }) => {
    director._bosses(sim, player, .5);
    assert.ok(director.activeElite);
    assert.equal(director.spawnQ.length, 2);
    const before = normalCars(sim).length;
    director._runQueue(sim);
    assert.equal(normalCars(sim).length, before + 1);
    director._runQueue(sim);
    assert.equal(normalCars(sim).length, before + 1, 'second escort waits for its existing 0.13-second cadence');
    sim.time += .13; director._runQueue(sim);
    assert.equal(normalCars(sim).length, before + 2);
  });
});

test('ordinary queued squad remains staggered during a boss and inactive-run scheduling stays off', async () => {
  await fixture(Director, 1, ({ sim, player, director }) => {
    director._bosses(sim, player, .3);
    const cars = [];
    const legalSpawn = side => {
      let car = null;
      for(let distance=80;distance<=800&&!car;distance+=20)
        car=director.spawn(sim,'e_sedan',.3,{at:{s:player.s+distance,d:side*2.7,speed:15}});
      cars.push(car);return car;
    };
    director.queue(() => legalSpawn(-1));
    director.queue(() => legalSpawn(1));
    director.cooldown = 10;
    director.update(DT, sim); assert.equal(cars.length, 1);
    const deadline = director.nextQT;
    sim.time = deadline - .001; director.update(DT, sim); assert.equal(cars.length, 1);
    sim.time = deadline; director.update(DT, sim); assert.equal(cars.length, 2);
    assert.ok(cars.every(Boolean));
    const count = sim.cars.size;
    sim.state = 'over'; sim.time += 1; director.cooldown = 0;
    director.update(DT, sim); assert.equal(sim.cars.size, count);
  });
});

test('first boss waits past the old short approach and starts at the new authored threshold', async () => {
  await fixture(Director, 1, ({ sim, player, director }) => {
    assert.equal(TEN_LEVELS[0].bossDistance, 5500);
    for (const distance of [3500, 5499]) {
      player.s = distance; director._bosses(sim, player, .3);
      assert.equal(director.activeElite, undefined, 'no chapter boss before the new approach threshold');
      assert.equal(director.campaignComplete, false);
    }
    player.s = 5500; director._bosses(sim, player, .3);
    assert.equal(director.activeElite?.chapter, 1);
  });
});

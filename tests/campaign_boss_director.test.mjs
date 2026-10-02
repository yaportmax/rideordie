import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.js';
import { Director } from '../src/sim/director.js';
import { CAMPAIGN_BOSSES, ELITE_BOSSES, MINIBOSSES } from '../src/data/boss.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { addStaticBox } from '../src/sim/physics.js';
import { rng } from '../src/core/util.js';

async function fixture(mode, level, run) {
  const sim = await new Sim({ seed: 7, journey: { version: 1, mode, level } }).init();
  try {
    sim.journey = { version: 1, mode, level };
    sim.director = new Director({ journey: sim.journey });
    sim.director.r = rng(222);
    // Explicit controlled loaded-asphalt provider. Dynamic bodies, clearance
    // queries and selected obstruction geometry still use actual Rapier.
    sim.ground = { hasColliderAt: () => true, roadHeightAt: (s) => sim.road.sample(s).y };
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 40 });
    sim.start(); sim.drainEvents();
    await run(sim, player, sim.director);
  } finally { sim.dispose(); }
}

test('campaign roster preserves all legacy wire identities and provides nine distinct chapter encounters', () => {
  assert.deepEqual(ELITE_BOSSES.slice(0, 5), MINIBOSSES);
  assert.deepEqual(CAMPAIGN_BOSSES.map(m => m.eliteIndex), [0, 1, 2, 3, 5, 4, 6, 7, 8]);
  assert.equal(new Set(CAMPAIGN_BOSSES.map(m => m.name)).size, 9);
  assert.equal(CAMPAIGN_BOSSES[4].spec, 'e_double_bus');
});

test('normal bus is city-only and the one-live limit includes the chapter elite', async () => {
  await fixture('campaign', 1, (sim, player, director) => {
    assert.equal(director.spawn(sim, 'e_double_bus', 0.5, { at: { s: player.s + 200, d: 0, speed: 12 } }), false);
    assert.equal(director.spawnEncounter(sim, 'citybus', 0.5), 0);
  });
  await fixture('campaign', 5, (sim, player, director) => {
    const normal = director.spawn(sim, 'e_double_bus', 0.5, { at: { s: player.s + 200, d: 0, speed: 12 } });
    assert.ok(normal);
    assert.equal(director.spawn(sim, 'e_double_bus', 0.5, { at: { s: player.s + 260, d: 0, speed: 12 } }), false);
    player.s = TEN_LEVELS[4].bossDistance;
    director._bosses(sim, player, 0.5);
    assert.ok(director.activeElite, 'elite is not denied by existing normal cap');
    assert.equal(director.activeElite.cars[0].spec.id, 'e_double_bus');
    sim.removeCar(normal, 'controlled normal cleanup');
    assert.equal(director.spawn(sim, 'e_double_bus', 0.5, { at: { s: player.s + 320, d: 0, speed: 12 } }), false);
  });
});

test('bus rejects missing asphalt, low physical ceiling and occupied physical hull volume', async () => {
  await fixture('campaign', 5, (sim, player, director) => {
    const at = { s: player.s + 200, d: 0, speed: 12 };
    sim.ground.hasColliderAt = () => false;
    assert.equal(director.spawn(sim, 'e_double_bus', 0.5, { at }), false);
    sim.ground.hasColliderAt = () => true;
    const sm = sim.road.sample(at.s);
    const ceiling = addStaticBox(sim.world, [sm.x, sm.y + 4.3, sm.z], [3, 0.1, 7]);
    sim.world.step(sim.eventQueue);
    assert.equal(director.spawn(sim, 'e_double_bus', 0.5, { at }), false);
    sim.world.removeRigidBody(ceiling.rb);
    const obstruction = sim.spawnCar('e_heavy', { s: at.s, d: 0 });
    sim.world.step(sim.eventQueue); obstruction.veh.afterStep();
    const before = sim.cars.size;
    assert.equal(director.spawn(sim, 'e_double_bus', 0.5, { at }), false);
    assert.equal(sim.cars.size, before, 'rejected bus body removed');
  });
});

for (let level = 1; level <= 9; level++) {
  test(`campaign chapter${level} has no early boss and spawns its authored physical roster at the threshold`, async () => {
    await fixture('campaign', level, (sim, player, director) => {
      player.s = TEN_LEVELS[level - 1].bossDistance - 1;
      director._bosses(sim, player, 0.5);
      assert.equal(director.activeElite, undefined);
      player.s++;
      director._bosses(sim, player, 0.5);
      const expected = CAMPAIGN_BOSSES[level - 1], actual = director.activeElite;
      assert.ok(actual); assert.equal(actual.index, expected.eliteIndex);
      assert.equal(actual.chapter, level); assert.equal(actual.cars.length, expected.count || 1);
      for (const car of actual.cars) {
        assert.equal(car.spec.id, expected.spec);
        assert.ok(car.veh.body.isValid()); assert.equal(car.exploded, false);
      }
    });
  });
}

test('chapter twins cannot complete through missing registry or failed safe placement; only both actual explosions complete once', async () => {
  await fixture('campaign', 2, (sim, player, director) => {
    player.s = TEN_LEVELS[1].bossDistance;
    director._bosses(sim, player, 0.5);
    const elite = director.activeElite, [a, b] = elite.cars;
    a.exploded = true;
    sim.cars.delete(b.id);
    let placements = 0;
    sim._placeOnClearRoad = () => { placements++; return false; };
    director._bosses(sim, player, 0.5);
    assert.equal(placements, 1); assert.equal(director.campaignComplete, false);
    assert.equal(elite.cars[1], b); assert.equal(director.activeElite, elite);
    b.exploded = true;
    director._bosses(sim, player, 0.5);
    director._bosses(sim, player, 0.5);
    assert.equal(director.campaignComplete, true);
    assert.equal(director.chapterBossDone.has(2), true);
    assert.equal(sim.events.filter(e => e.t === 'campaignBossDown').length, 1);
  });
});

test('living outrun campaign boss survives cleanup and successful registry repair preserves damage and identity', async () => {
  await fixture('campaign', 1, (sim, player, director) => {
    player.s = TEN_LEVELS[0].bossDistance;
    director._bosses(sim, player, 0.5);
    const car = director.activeElite.cars[0], oldId = car.id;
    car.hp = 112; car.crew.gunner.hp = 14; car.tireHp[0] = -1;
    player.s = car.s + 1000;
    director._cleanup(sim, player);
    assert.equal(sim.cars.get(oldId), car);
    sim.cars.delete(oldId);
    const placements = [];
    sim._placeOnClearRoad = (c, s) => { placements.push({ c, s }); return true; };
    director._bosses(sim, player, 0.5);
    assert.equal(sim.cars.get(oldId), car);
    assert.equal(placements.length, 1); assert.equal(placements[0].s, player.s + 120);
    assert.equal(car.hp, 112); assert.equal(car.crew.gunner.hp, 14); assert.equal(car.tireHp[0], -1);
    assert.equal(director.campaignComplete, false);
  });
});

test('partial Twin spawn rolls back every spawned body and retries without victory', async () => {
  await fixture('campaign', 2, (sim, player, director) => {
    const spawn = director.spawn.bind(director); let calls = 0;
    director.spawn = (...args) => ++calls === 1 ? spawn(...args) : false;
    player.s = TEN_LEVELS[1].bossDistance;
    director._bosses(sim, player, 0.5);
    assert.equal(director.activeElite, undefined);
    assert.equal([...sim.cars.values()].filter(c => c.elite).length, 0);
    assert.equal(director.chapterBossDone.size, 0);
    director.spawn = spawn;
    director._bosses(sim, player, 0.5);
    assert.equal(director.activeElite.cars.length, 2);
  });
});

test('marathon cannot skip any chapter when the player outruns all thresholds; finale only follows all nine actual clears', async () => {
  await fixture('marathon', 1, (sim, player, director) => {
    player.s = 79000;
    for (let chapter = 1; chapter <= 9; chapter++) {
      director._bosses(sim, player, 0.8);
      assert.equal(director.activeElite.chapter, chapter);
      assert.equal(sim.boss, null);
      assert.equal(director.marathonComplete, false);
      for (const car of director.activeElite.cars) car.exploded = true;
    }
    director._bosses(sim, player, 0.8);
    assert.ok(sim.boss); assert.equal(director.marathonComplete, false);
    sim.boss.exploded = true;
    director._bosses(sim, player, 0.8);
    assert.equal(director.chapterBossDone.size, 9); assert.equal(director.marathonComplete, true);
  });
});

test('finite space chapter waits for its approach and creates the actual Leviathan rather than an elite alias', async () => {
  await fixture('campaign', 10, (sim, player, director) => {
    player.s = TEN_LEVELS[9].bossDistance - 1;
    director._bosses(sim, player, 0.8); assert.equal(sim.boss, null);
    player.s++;
    director._bosses(sim, player, 0.8);
    assert.ok(sim.boss); assert.equal(director.activeElite, undefined);
    assert.equal(director.campaignComplete, false);
    sim.boss.exploded = true;
    director._bosses(sim, player, 0.8); assert.equal(director.campaignComplete, true);
  });
});

test('missing journey preserves the legacy Scrapjaw threshold and legacy outrun policy', async () => {
  await fixture('legacy', 1, (sim, player) => {
    delete sim.journey;
    const director = sim.director = new Director(); director.r = rng(222);
    player.s = MINIBOSSES[0].s - 151;
    director._bosses(sim, player, 0.3); assert.equal(director.activeElite, undefined);
    player.s++;
    director._bosses(sim, player, 0.3);
    assert.equal(director.activeElite.index, 0);
    for (const car of director.activeElite.cars) car.s = player.s - 601;
    director._bosses(sim, player, 0.3);
    assert.equal(director.activeElite, null);
    assert.equal(director.campaignComplete, false);
    assert.equal(sim.events.filter(e => e.t === 'minibossLost').length, 1);
  });
});

test('removed physical chapter body is replaced only on verified road and retains crew, tire, engine and nitro damage', async () => {
  await fixture('campaign', 1, (sim, player, director) => {
    player.s = TEN_LEVELS[0].bossDistance;
    director._bosses(sim, player, 0.5);
    const old = director.activeElite.cars[0];
    old.hp = 101; old.crew.gunner.alive = false; old.crew.gunner.hp = 0;
    old.tireHp[0] = -1; old.veh.wheels[0].flat = true; old.veh.wheels[0].grip = 0.55;
    old.veh.engineDamage = 0.7; old.veh.nitro = 0.2; old.veh.nitroNeedsRelease = true;
    sim.removeCar(old, 'controlled missing body');
    sim._placeOnClearRoad = () => true;
    director._bosses(sim, player, 0.5);
    const next = director.activeElite.cars[0];
    assert.notEqual(next.id, old.id); assert.ok(next.veh.body.isValid());
    assert.equal(next.hp, 101); assert.equal(next.maxHp, old.maxHp);
    assert.equal(next.crew.gunner.alive, false); assert.equal(next.crew.gunner.hp, 0);
    assert.deepEqual(next.tireHp, old.tireHp); assert.equal(next.veh.wheels[0].flat, true);
    assert.equal(next.veh.wheels[0].grip, 0.55); assert.equal(next.veh.engineDamage, 0.7);
    assert.equal(next.veh.nitro, 0.2); assert.equal(next.veh.nitroNeedsRelease, true);
    assert.equal(director.campaignComplete, false);
  });
});

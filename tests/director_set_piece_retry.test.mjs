import test from 'node:test';
import assert from 'node:assert/strict';
import { Director } from '../src/sim/director.js';
import { SET_PIECES, ENCOUNTERS } from '../src/data/enemies.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { Road } from '../src/world/road.js';

const DT = 1 / 120;

function fixture(piece) {
  const director = new Director();
  // Isolate encounter scheduling while keeping the actual squad placement,
  // first-spawn failure gate and deferred-vehicle queue.
  director._bosses = () => {};
  director._cleanup = () => {};
  director._nearMiss = () => {};
  director._pickEncounter = () => null;
  director.lastEngaged = 20;
  const spawned = [], events = [];
  const road = new Road(7);
  // Scheduling isolation retains the flat crest profile; biome identity uses
  // the real legacy Road contract rather than an incomplete shape stub.
  road.sample = () => ({ y: 0 });
  let canSpawn = false;
  director.spawn = (_sim, _key, _level, options) => {
    spawned.push(options);
    return canSpawn ? { id: spawned.length, ai: {} } : false;
  };
  const sim = { state: 'run', seed: 7, tick: 1, time: 20, cars: new Map(),
    road,
    player: { s: piece.s, maxHp: 400, fuelHp: 60, engineHp: 100, spec: VEHICLES.truck_t1, veh: { vf: 30 } },
    emit: event => events.push(event) };
  const update = time => { sim.time = time; director.update(DT, sim); };
  return { director, sim, spawned, events, update, allow: () => { canSpawn = true; } };
}

test('each blocked stage encounter retries after its existing backoff and completes exactly once on success', () => {
  for (const piece of SET_PIECES) {
    const f = fixture(piece);
    f.update(20);
    assert.equal(f.spawned.length, 1, piece.key + ': first placement was attempted');
    assert.equal(f.director.setDone?.has(piece.key) ?? false, false, 'failed placement must not consume the stage event');
    assert.equal(f.director.spawnQ?.length ?? 0, 0, 'failed first car must not enqueue an orphan squad');
    assert.equal(f.events.filter(e => e.t === 'setPiece').length, 0);
    f.allow();
    for (const time of [20.5, 21, 24, 27.999]) f.update(time);
    assert.equal(f.spawned.length, 1, 'blocked terrain is not retried every physics tick');
    f.update(28);
    assert.equal(f.spawned.length, 2, 'a restored surface gets one new attempt after eight seconds');
    assert.equal(f.director.setDone.has(piece.key), true);
    assert.equal(f.events.filter(e => e.t === 'setPiece' && e.key === piece.key).length, 1);
    assert.equal(f.events.filter(e => e.t === 'encounter' && e.key === piece.key).length, 1);
    assert.equal(f.director.encounters, 1);
    const queueSize = f.director.spawnQ.length;
    assert.equal(queueSize, ENCOUNTERS[piece.key].cars.length - 1);
    f.update(28.01);
    assert.equal(f.events.filter(e => e.t === 'setPiece').length, 1, 'successful event cannot repeat while its escort queue drains');
    assert.equal(f.director.encounters, 1);
    assert.equal(f.director.spawnQ.length, queueSize - 1, 'only the existing deferred escort was spawned');
  }
});

test('stage retries retain route/run guards and bounded placement while coexisting with a retained warlord', () => {
  const piece = SET_PIECES[0], f = fixture(piece);
  f.update(20); f.allow();
  f.sim.player.s = piece.s + 901; f.update(29);
  assert.equal(f.spawned.length, 1, 'passing the existing window does not spawn a late ambush');
  f.sim.player.s = piece.s - 261; f.update(29.05);
  assert.equal(f.spawned.length, 1, 'the existing approach window still prevents an early retry');
  assert.equal(f.director.setDone?.has(piece.key) ?? false, false);
  f.sim.player.s = piece.s;
  // This scheduler fixture retains a warlord marker without fabricating an
  // earned boss fight. Real boss bodies/caps/clearance remain covered by the
  // separate production boss-wave tests; only placement is stubbed here.
  const warlord = { index: 0, name: 'retained scheduler warlord', cars: [] };
  f.director.activeElite = warlord; f.update(29.1);
  assert.equal(f.spawned.length, 2, 'an eligible stage squad may retry alongside the retained warlord');
  assert.equal(f.director.activeElite, warlord, 'ordinary stage scheduling cannot consume boss ownership');
  assert.equal(f.director.setDone.has(piece.key), true);
  assert.equal(f.events.filter(e => e.t === 'setPiece' && e.key === piece.key).length, 1);
  assert.equal(f.events.filter(e => e.t === 'encounter' && e.key === piece.key).length, 1);
  assert.equal(f.director.encounters, 1);
  const queueSize = f.director.spawnQ.length;
  assert.equal(queueSize, ENCOUNTERS[piece.key].cars.length - 1);
  f.update(29.11);
  assert.equal(f.spawned.length, 3, 'only one existing deferred escort enters the first opening');
  assert.equal(f.director.spawnQ.length, queueSize - 1);
  f.update(29.12);
  assert.equal(f.spawned.length, 3, 'retained warlord does not bypass the original escort cadence');
  assert.equal(f.events.filter(e => e.t === 'setPiece').length, 1, 'successful stage scheduling remains once per run');
  for (const state of ['dying', 'over', 'countdown']) {
    f.sim.state = state; f.update(30);
    assert.equal(f.spawned.length, 3, `no deferred stage escort outside the active run: ${state}`);
    assert.equal(f.director.spawnQ.length, queueSize - 1, 'terminal phase neither dispatches nor destroys the pending queue');
    assert.equal(f.director.activeElite, warlord);
  }

  const blocked = fixture(piece); blocked.director.activeElite = warlord;
  for (const time of [20, 20.01, 27.999]) blocked.update(time);
  assert.equal(blocked.spawned.length, 1, 'boss presence cannot retry rejected physical placement every tick');
  blocked.update(28);
  assert.equal(blocked.spawned.length, 2, 'failed placement retains its existing eight-second backoff during the fight');
  assert.equal(blocked.director.setDone?.has(piece.key) ?? false, false, 'an unsuccessful boss-adjacent placement cannot consume the event');
  assert.equal(blocked.director.spawnQ?.length ?? 0, 0, 'failed first placement cannot enqueue an orphan squad');
  assert.equal(blocked.events.filter(e => e.t === 'setPiece' || e.t === 'encounter').length, 0);
});

test('repeated placement failures stay bounded and a fresh director can run the stage again', () => {
  const piece = SET_PIECES[0], f = fixture(piece);
  for (const time of [20, 20.01, 27.99, 28, 28.01, 35.99, 36]) f.update(time);
  assert.equal(f.spawned.length, 3, 'one attempt per eight-second failure window');
  assert.equal(f.director.setDone?.has(piece.key) ?? false, false);
  assert.equal(f.director.spawnQ?.length ?? 0, 0);
  const fresh = fixture(piece); fresh.allow(); fresh.update(20);
  assert.equal(fresh.events.filter(e => e.t === 'setPiece').length, 1);
  assert.equal(fresh.director.setDone.has(piece.key), true, 'stage completion belongs only to its run');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Director } from '../src/sim/director.js';
import { SET_PIECES, ENCOUNTERS } from '../src/data/enemies.js';
import { VEHICLES } from '../src/data/vehicles.js';

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
  let canSpawn = false;
  director.spawn = (_sim, _key, _level, options) => {
    spawned.push(options);
    return canSpawn ? { id: spawned.length, ai: {} } : false;
  };
  const sim = { state: 'run', seed: 7, tick: 1, time: 20, cars: new Map(),
    road: { sample: () => ({ y: 0 }) },
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

test('a stage encounter cannot retry after its route window, during a warlord, or outside the active run', () => {
  const piece = SET_PIECES[0], f = fixture(piece);
  f.update(20); f.allow();
  f.sim.player.s = piece.s + 901; f.update(29);
  assert.equal(f.spawned.length, 1, 'passing the existing window does not spawn a late ambush');
  f.sim.player.s = piece.s;
  f.director.activeElite = {}; f.update(29.1);
  assert.equal(f.spawned.length, 1, 'warlord encounters retain exclusive scheduling');
  f.director.activeElite = null; f.sim.state = 'dying'; f.update(30);
  assert.equal(f.spawned.length, 1, 'no deferred stage retry after death');
  assert.equal(f.events.filter(e => e.t === 'setPiece').length, 0);
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

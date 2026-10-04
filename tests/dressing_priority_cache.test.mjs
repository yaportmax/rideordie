import test from 'node:test';
import assert from 'node:assert/strict';
import { Dressing } from '../src/world/dressing.js';
import { CHUNK_LEN } from '../src/world/dressing/util.js';

function observedFeatures(values) {
  let visits = 0;
  const features = new Proxy(values, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) visits++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { features, values, reset() { visits = 0; }, get visits() { return visits; } };
}

const chunk = (c, step = 0) => ({ c, s0: c * CHUNK_LEN, step, rec: {}, hooks: [], extras: [] });
function fixture(features, s, chunks) {
  const dress = Object.create(Dressing.prototype);
  Object.assign(dress, {
    road: { features }, s, chunks: new Map(chunks.map(ch => [ch.c, ch])),
    stats: { chunksBuilt: 0, jobMs: 0, stepMax: Array(9).fill(0) },
    ctx: { hook() {} }, water: { dropChunk() {} }, extraGroup: { remove() {} },
  });
  return dress;
}

// Observe the real scheduler's first choice without building meshes or assuming
// machine-speed thresholds. The original _jobs and _wantStep execute intact.
function selected(dress) {
  let chosen = null;
  const marker = new Error('OBSERVED_ACTUAL_SELECTED_JOB');
  dress._runStep = ch => { chosen = ch.c; throw marker; };
  assert.throws(() => dress._jobs(Infinity), error => error === marker);
  return chosen;
}
function retained(dress) {
  return [...dress._structurePriorityCache.owners.values()].reduce((sum, list) => sum + list.length, 0);
}
const canyonTunnel = () => ({ type: 'tunnel', s0: 384, s1: 624, rock: true, authoredDriving: true });

test('stable structural jobs and idle completed chunks do not reread road feature history', () => {
  const observed = observedFeatures([
    ...Array.from({ length: 12000 }, (_, i) => ({ type: 'guard', s0: i * 96, s1: i * 96 + 150 })),
    canyonTunnel(),
  ]);
  const dress = fixture(observed.features, 400, [chunk(4), chunk(6)]);
  assert.equal(selected(dress), 6); assert.equal(observed.visits, 12001, 'one cold historical reindex');
  assert.equal(retained(dress), 1, 'unrelated historical guards are not retained');
  for (let i = 0; i < 20; i++) {
    observed.reset(); assert.equal(selected(dress), 6);
    assert.equal(observed.visits, 0, 'warm owner priority uses cached references');
  }
  for (const ch of dress.chunks.values()) ch.step = 8;
  observed.reset(); dress._jobs(0);
  assert.equal(observed.visits, 0, 'idle completed chunks require no history scan');
  assert.equal(dress._structurePriorityCache.owners.size, 0); assert.equal(retained(dress), 0);
});

test('whole tunnel and bridge spans prioritize their end owners only until step3 with the exact cutoff', () => {
  for (const type of ['tunnel', 'bridge']) for (const step of [0, 1, 2]) {
    const dress = fixture([{ type, s0: 384, s1: 624 }], 400, [chunk(4), chunk(6, step)]);
    assert.equal(selected(dress), 6, `${type} end owner must finish structure before the nearby tile`);
    dress.chunks.get(6).step = 3;
    assert.equal(selected(dress), 4, 'distant later scatter returns to centre priority');
    assert.equal(dress._structurePriorityCache.owners.has(6), false);
  }
  const cutoff = fixture([canyonTunnel()], -616, [chunk(4), chunk(6)]);
  assert.equal(selected(cutoff), 6, 'exact 1000m span distance is included');
  cutoff.s = -616.001;
  assert.equal(selected(cutoff), 4, 'beyond 1000m span distance is excluded');
  const blocked = fixture([canyonTunnel()], 400, [chunk(4), chunk(6)]);
  blocked.chunks.get(6)._blockedUntil = Infinity;
  assert.equal(selected(blocked), 4, 'asset-blocked structure must not force work');
  const boundary = fixture([{ type: 'tunnel', s0: 384, s1: 576 }], 400, [chunk(5), chunk(6)]);
  assert.equal(selected(boundary), 6, 'exact end boundary belongs to floor(end/chunk length)');
  const sameOwner = fixture([
    { type: 'tunnel', s0: 500, s1: 620 },
    { type: 'bridge', s0: 384, s1: 624 },
    { type: 'roadblock', s0: 400, s1: 412, disabledClutter: true },
    { type: 'stage_challenge', s0: 400, s1: 420, authoredDriving: true },
  ], 400, [chunk(4), chunk(6)]);
  assert.equal(selected(sameOwner), 6, 'minimum distance across an owner spans remains effective');
  assert.equal(retained(sameOwner), 2, 'neither incidental nor authored nonstructural features become priority structures');
});

test('append-only feature growth visits each new record once without retaining inactive owners', () => {
  const observed = observedFeatures(Array.from({ length: 3000 }, (_, i) => ({ type: 'guard', s0: i * 96, s1: i * 96 + 200 })));
  const dress = fixture(observed.features, 400, [chunk(4), chunk(6)]);
  assert.equal(selected(dress), 4); assert.equal(observed.visits, 3000);
  observed.reset(); observed.values.push(canyonTunnel());
  assert.equal(selected(dress), 6); assert.equal(observed.visits, 1); assert.equal(retained(dress), 1);
  observed.reset(); observed.values.push({ type: 'roadblock', s0: 400, s1: 412, disabledClutter: true });
  assert.equal(selected(dress), 6); assert.equal(observed.visits, 1); assert.equal(retained(dress), 1);
  observed.reset(); observed.values.push({ type: 'bridge', s0: 400, s1: 14000 });
  assert.equal(selected(dress), 6); assert.equal(observed.visits, 1);
  assert.equal(retained(dress), 1, 'inactive future owner is not indexed indefinitely');
  observed.reset(); assert.equal(selected(dress), 6); assert.equal(observed.visits, 0);
});

test('source replacement and truncation invalidate stale structural priorities', () => {
  const original = observedFeatures([canyonTunnel()]);
  const dress = fixture(original.features, 400, [chunk(4), chunk(6)]);
  assert.equal(selected(dress), 6);
  const replacement = observedFeatures([{ type: 'bridge', s0: 1400, s1: 1600 }]);
  dress.road.features = replacement.features;
  assert.equal(selected(dress), 4); assert.equal(replacement.visits, 1, 'same-length replacement is reindexed');
  assert.equal(retained(dress), 0); replacement.reset();
  assert.equal(selected(dress), 4); assert.equal(replacement.visits, 0);
  replacement.values.push(canyonTunnel());
  assert.equal(selected(dress), 6); assert.equal(replacement.visits, 1);
  replacement.values.length = 1; replacement.reset();
  assert.equal(selected(dress), 4); assert.equal(replacement.visits, 1, 'shrink reindexes the retained source exactly');
  assert.equal(retained(dress), 0);
});

test('real chunk retirement and reverse reactivation bound owner storage without losing historical spans', () => {
  const observed = observedFeatures([
    canyonTunnel(), { type: 'bridge', s0: 9600, s1: 9720 },
    ...Array.from({ length: 4000 }, (_, i) => ({ type: 'guard', s0: i * 96, s1: i * 96 + 150 })),
  ]);
  const dress = fixture(observed.features, 400, [chunk(4), chunk(6)]);
  assert.equal(selected(dress), 6); assert.equal(retained(dress), 1);
  dress.onChunkDrop(6);
  assert.equal(dress._structurePriorityCache.owners.has(6), false, 'real retirement releases references immediately');
  dress.onChunkDrop(4); dress.onChunk(100, {}); dress.onChunk(101, {}); dress.s = 9600;
  observed.reset();
  assert.equal(selected(dress), 101); assert.equal(observed.visits, 4002, 'one cold active-owner reindex');
  assert.equal(retained(dress), 1); assert.equal(dress._structurePriorityCache.owners.size, 2);
  observed.reset(); assert.equal(selected(dress), 101); assert.equal(observed.visits, 0);
  dress.onChunkDrop(100); dress.onChunkDrop(101); dress.onChunk(4, {}); dress.onChunk(6, {}); dress.s = 400;
  observed.reset();
  assert.equal(selected(dress), 6); assert.equal(observed.visits, 4002, 'reverse activation recovers the discarded historical structure');
  assert.equal(retained(dress), 1); assert.equal(dress._structurePriorityCache.owners.size, 2);
  observed.reset(); assert.equal(selected(dress), 6); assert.equal(observed.visits, 0);
  for (const ch of dress.chunks.values()) ch.step = 3;
  selected(dress);
  assert.equal(dress._structurePriorityCache.owners.size, 0); assert.equal(retained(dress), 0);
  dress.onChunkDrop(6); dress.onChunk(6, {}); observed.reset();
  assert.equal(selected(dress), 6); assert.equal(observed.visits, 4002, 'new unfinished owner at the same coordinate reindexes history');
  assert.equal(dress._structurePriorityCache.owners.size, 1); assert.equal(retained(dress), 1);
});

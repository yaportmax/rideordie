// WORK proposal: materialize src/core/diagnostics.js and the four producer
// edits before running. No browser, GPU, frame-rate or whole-memory claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendDiagnostic, readDiagnosticSnapshot, DIAGNOSTIC_CAPACITY } from '../src/core/diagnostics.js';

test('slow-work records retain exact fields, identities and arrival order', () => {
  const owner = {}, a = { what: 'dressing', ms: 12.3, at: 9.1 }, b = { what: 'terrainMsg', ms: 18.9, at: 8.4 };
  const records = appendDiagnostic(owner, '__spikes', a);
  assert.equal(appendDiagnostic(owner, '__spikes', b), records);
  assert.equal(records[0], a); assert.equal(records[1], b);
  assert.deepEqual(records, [a, b]);
  assert.deepEqual(records.diagnostics, { total: 2, dropped: 0, retained: 2, capacity: DIAGNOSTIC_CAPACITY });
});

test('long repeated captures stay bounded and expose every discarded record in totals', () => {
  const owner = {}, total = DIAGNOSTIC_CAPACITY * 12 + 13;
  for (let seq = 0; seq < total; seq++) {
    appendDiagnostic(owner, '__hitches', { seq, at: seq / 10, ev: 'shot,hit' });
    const rows = owner.__hitches, info = rows.diagnostics;
    assert.ok(rows.length <= DIAGNOSTIC_CAPACITY);
    assert.equal(info.total, seq + 1); assert.equal(info.retained, rows.length);
    assert.equal(info.dropped + info.retained, info.total);
  }
  const snapshot = readDiagnosticSnapshot(owner.__hitches), first = total - snapshot.retained;
  assert.ok(snapshot.dropped > 0);
  assert.deepEqual(snapshot.rows.map(row => row.seq), Array.from({ length: snapshot.retained }, (_, i) => first + i));
  assert.ok(snapshot.rows.every((row, i) => row.at === (first + i) / 10 && row.ev === 'shot,hit'));
});

test('batch compaction has bounded reference movement rather than shifting every retained record per append', () => {
  let moved = 0, compactions = 0;
  const rows = [];
  Object.defineProperty(rows, 'copyWithin', { value(target, start) {
    compactions++; moved += this.length - start;
    return Array.prototype.copyWithin.call(this, target, start);
  } });
  const owner = { __spikes: rows }, total = DIAGNOSTIC_CAPACITY * 10;
  for (let seq = 0; seq < total; seq++) appendDiagnostic(owner, '__spikes', { seq });
  assert.ok(compactions > 0); assert.ok(compactions <= total / (DIAGNOSTIC_CAPACITY / 4));
  assert.ok(moved <= total * 4, 'reference moves are amortized over many new records; this is not a wall-time benchmark');
  assert.equal(owner.__spikes, rows);
});

test('array replacement and an explicit same-array clear start new capture counts', () => {
  const owner = {};
  for (let seq = 0; seq < DIAGNOSTIC_CAPACITY + 5; seq++) appendDiagnostic(owner, '__spikes', { seq });
  const previous = owner.__spikes, old = readDiagnosticSnapshot(previous);
  owner.__spikes = [];
  assert.deepEqual(readDiagnosticSnapshot(owner.__spikes), { rows: [], total: 0, dropped: 0, retained: 0, capacity: DIAGNOSTIC_CAPACITY });
  appendDiagnostic(owner, '__spikes', { seq: 99 });
  assert.deepEqual(owner.__spikes.diagnostics, { total: 1, dropped: 0, retained: 1, capacity: DIAGNOSTIC_CAPACITY });
  assert.deepEqual(readDiagnosticSnapshot(previous), old, 'replacement does not mutate the former capture');
  owner.__spikes.length = 0;
  assert.equal(readDiagnosticSnapshot(owner.__spikes).total, 0);
  appendDiagnostic(owner, '__spikes', { seq: 100 });
  assert.equal(owner.__spikes.diagnostics.total, 1); assert.equal(owner.__spikes.diagnostics.dropped, 0);
});

test('preexisting over-cap data is accounted for and normalized on the next append', () => {
  const initial = DIAGNOSTIC_CAPACITY * 3, owner = { __spikes: Array.from({ length: initial }, (_, seq) => ({ seq })) };
  appendDiagnostic(owner, '__spikes', { seq: initial });
  const result = readDiagnosticSnapshot(owner.__spikes);
  assert.equal(result.total, initial + 1); assert.ok(result.retained <= DIAGNOSTIC_CAPACITY);
  assert.equal(result.dropped + result.retained, result.total);
  assert.deepEqual(result.rows.map(row => row.seq), Array.from({ length: result.retained }, (_, i) => result.dropped + i));
});

test('ordinary array and JSON row schemas stay intact, while explicit snapshots serialize counts', () => {
  const owner = {}, row = { at: 1.2, sim: 81, look: 2, render: 3, chunks: 4, cars: 5, progs: 6, ev: 'shot' };
  appendDiagnostic(owner, '__hitches', row);
  const rows = owner.__hitches;
  assert.equal(Array.isArray(rows), true); assert.deepEqual(Object.keys(rows), ['0']);
  assert.equal(JSON.stringify(rows), JSON.stringify([row]));
  assert.deepEqual(rows.filter(value => value.sim > 80).slice(0, 1), [row]);
  const snapshot = readDiagnosticSnapshot(rows);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), { rows: [row], total: 1, dropped: 0, retained: 1, capacity: DIAGNOSTIC_CAPACITY });
  appendDiagnostic(owner, '__hitches', { ...row, at: 2.3 });
  assert.equal(snapshot.total, 1); assert.equal(snapshot.rows.length, 1, 'a published snapshot is not a live mutable capture');
});

test('independent diagnostic streams and owners do not share counters', () => {
  const a = {}, b = {};
  appendDiagnostic(a, '__spikes', { what: 'simSteps' }); appendDiagnostic(a, '__hitches', { at: 1 });
  appendDiagnostic(b, '__spikes', { what: 'terrainMsg' }); appendDiagnostic(b, '__spikes', { what: 'dressing' });
  assert.equal(a.__spikes.diagnostics.total, 1); assert.equal(a.__hitches.diagnostics.total, 1);
  assert.equal(b.__spikes.diagnostics.total, 2);
  assert.deepEqual(readDiagnosticSnapshot(undefined), { rows: [], total: 0, dropped: 0, retained: 0, capacity: DIAGNOSTIC_CAPACITY });
});

// Execute the exact current producer statements, not copied diagnostic logic.
// Only their surrounding physics/render consumers and clock are boundaries.
// This verifies thresholds/row fields and use of the bounded helper without
// constructing a renderer or claiming a full Game.frame integration playtest.
const producers = [
  { path: 'game/run.js', marker: "what: 'simSteps'", threshold: 15, vars: ['_ts', 'steps'], values: [0, 3], key: '__spikes', context: { sim: { cars: { size: 7 } } }, expected: { what: 'simSteps', ms: 16, steps: 3, cars: 7, at: 2 } },
  { path: 'game/run.js', marker: "what: 'dressing'", threshold: 10, vars: ['dt', 'g'], values: [1 / 60, { camera: { position: {} } }], key: '__spikes', context: { dressing: { update() {} }, playerS: 123 }, expected: { what: 'dressing', ms: 11, at: 2 } },
  { path: 'world/terrain.js', marker: "what: 'terrainMsg'", threshold: 12, vars: ['_t0', 'w', 'm'], values: [0, {}, {}], key: '__spikes', context: { _onMsg2() {} }, expected: { what: 'terrainMsg', ms: 13, at: 2 } },
  { path: 'sim/structure_colliders.js', marker: "what: 'collider:'", threshold: 8, vars: ['_t0', 'req'], values: [0, { type: 'bridge', collision: { idx: { length: 12 } } }], key: '__spikes', context: { _hook() {} }, expected: { what: 'collider:bridge', ms: 9, n: 4 } },
  { path: 'game/game.js', marker: "if (t3 - t0 > 80)", threshold: 80, vars: ['t0', 't1', 't2', 't3', 'run'], values: [0, 5, 9, 81, { streamer: { stats: { built: 11 } }, states: { size: 7 }, allEvents: [{ t: 'shot' }, { t: 'hit' }] }], key: '__hitches', context: { renderer: { info: { programs: { length: 23 } } } }, expected: { at: 2, sim: 5, look: 4, render: 72, chunks: 11, cars: 7, progs: 23, ev: 'shot,hit' } },
];
for (const producer of producers) test(`actual ${producer.path} ${producer.marker} keeps its strict threshold and row fields`, () => {
  const source = readFileSync(new URL(`../src/${producer.path}`, import.meta.url), 'utf8');
  assert.match(source, /import \{ appendDiagnostic \} from '\.\.\/core\/diagnostics\.js';/);
  const lines = source.split(/\r?\n/).filter(line => line.includes(producer.marker));
  assert.equal(lines.length, 1, 'the test must bind one exact current producer statement');
  assert.ok(lines[0].includes('appendDiagnostic(')); assert.equal(lines[0].includes('.push('), false);
  const invoke = new Function('appendDiagnostic', 'window', 'performance', ...producer.vars, lines[0]);
  for (const elapsed of [producer.threshold, producer.threshold + 1]) {
    const owner = {}, values = [...producer.values]; let nowCalls = 0;
    const clock = { now() { nowCalls++; return producer.marker === "what: 'dressing'" && nowCalls === 1 ? 0 : nowCalls <= (producer.marker === "what: 'dressing'" ? 2 : 1) ? elapsed : 2000; } };
    if (producer.key === '__hitches') { values[3] = elapsed; clock.now = () => 2000; }
    invoke.call(producer.context, appendDiagnostic, owner, clock, ...values);
    if (elapsed === producer.threshold) assert.equal(owner[producer.key], undefined, 'equality still records no slow-work row');
    else { assert.deepEqual(owner[producer.key], [producer.expected]); assert.equal(owner[producer.key].diagnostics.total, 1); }
  }
});

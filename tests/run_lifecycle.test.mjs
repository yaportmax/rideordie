import test from 'node:test';
import assert from 'node:assert/strict';
import { Run } from '../src/game/run.js';
import { Road } from '../src/world/road.js';
import { TEN_LEVELS } from '../src/data/campaign.js';

function outcome(won, remote = false) {
  const run = Object.create(Run.prototype);
  Object.assign(run, { over: true, finished: false, overT: 0, ...(remote ? { remoteSummary: { won } } : { summary: { won } }) });
  return run;
}

test('victory results preserve the finale delay on either peer while loss results remain prompt', () => {
  for (const remote of [false, true]) {
    const win = outcome(true, remote), loss = outcome(false, remote);
    for (let i = 0; i < 46; i++) { win._outcome(0.05); loss._outcome(0.05); }
    assert.equal(loss.finished, true);
    assert.equal(win.finished, false);
    for (let i = 0; i < 45; i++) win._outcome(0.05);
    assert.equal(win.finished, true);
    assert.ok(win.overT > 4.5);
  }
});

test('checkpoint summaries preserve absolute furthest progress separately from paid travel', () => {
  const run = Object.create(Run.prototype);
  Object.assign(run, { id: 'checkpoint-life', cfg: { startS: 52500 }, cash: 0, effects: { cashMul: 1 }, shots: 0,
    sim: { stats: { distance: 60000, kills: 0, hits: 0 }, time: 10, director: { level: 0 } } });
  const summary = run.buildSummary(false);
  assert.equal(summary.distance, 7500);
  assert.equal(summary.startS, 52500);
  assert.equal(summary.furthestS, 60000);
  assert.equal(summary.breakdown.find(line => line.label.startsWith('DISTANCE')).amount, 975);
});

test('results name the actual held campaign chapter and current marathon world', () => {
  for (const [journey, distance, expected] of [
    [{ mode: 'campaign', level: 2 }, 65000, TEN_LEVELS[1].name],
    [{ mode: 'campaign', level: 10 }, 65000, TEN_LEVELS[9].name],
    [{ mode: 'marathon', level: 7 }, 40, TEN_LEVELS[0].name],
    [{ mode: 'marathon', level: 1 }, 73000, TEN_LEVELS[9].name],
  ]) {
    const run = Object.create(Run.prototype);
    Object.assign(run, { id: 'chapter-name', journey, cfg: { startS: 40 }, cash: 0, effects: { cashMul: 1 }, shots: 0,
      sim: { road: new Road(7, journey), stats: { distance, kills: 0, hits: 0 }, time: 10, director: { level: 0 } } });
    const summary = run.buildSummary(false);
    assert.equal(summary.biome, expected);
    assert.equal(summary.won, false);
    assert.equal(summary.levelCleared, false);
  }
});

test('a failed dressing asset load removes allocated scene resources and installs no callbacks', async t => {
  t.mock.method(console, 'warn', () => {});
  const run = Object.create(Run.prototype), resources = new Set(['pool', 'water', 'backdrop']);
  let disposed = 0;
  Object.assign(run, { g: {}, streamer: { onChunk: null, onChunkDrop: null }, dressing: {
    load: async () => { throw new Error('manifest unavailable'); },
    dispose() { disposed++; resources.clear(); }, pool: {},
  } });
  await run._loadDressing(40);
  assert.equal(run.dressing, null);
  assert.equal(disposed, 1);
  assert.equal(resources.size, 0);
  assert.equal(run.streamer.onChunk, null);
  assert.equal(run.streamer.onChunkDrop, null);
});

test('cancelling during dressing load clears late allocations before the initializer returns', async () => {
  const run = Object.create(Run.prototype), resources = new Set(['initial']);
  let release, disposed = 0;
  const wait = new Promise(resolve => { release = resolve; });
  Object.assign(run, { g: {}, streamer: { onChunk: null, onChunkDrop: null, dispose() {} }, dressing: {
    async load() { await wait; resources.add('late'); },
    dispose() { disposed++; resources.clear(); }, pool: {},
  } });
  const loading = run._loadDressing(40);
  run.dispose();
  assert.equal(resources.size, 0);
  release(); await loading;
  assert.equal(disposed, 2);
  assert.equal(run.dressing, null);
  assert.equal(resources.size, 0);
  assert.equal(run.streamer.onChunk, null);
});

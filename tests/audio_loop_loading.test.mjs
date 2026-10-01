import test from 'node:test';
import assert from 'node:assert/strict';
import { audioLoadFixture, until, resolveAll } from './helpers/audio-load-fixture.mjs';

test('ten audible loop layers share one batch while three real data-URL decodes remain pending', async () => {
  const f = audioLoadFixture({ variations: 3 });
  const layers = Array.from({ length: 10 }, f.makeLayer);
  for (let frame = 0; frame < 240; frame++) { f.context.currentTime = frame / 60; for (const l of layers) l.set(.8, 1); }
  await until(() => f.decoders.length === 3, 'data-URL fetches');
  assert.equal(f.counts.loads, 1); assert.equal(f.counts.variations, 3); assert.deepEqual(f.counts.priorities, [0]);
  assert.equal(f.sources.length, 0); assert.equal(f.gains.length, 0);
  assert.equal(f.def._loopLoad.pending, true);
  for (const l of layers) l.release();
  resolveAll(f); await until(() => !f.def._loopLoad.pending);
  assert.equal(f.sources.length, 0, 'decode completion cannot restart released layers');
  assert.equal(f.def._loopLoad.buffers, null); assert.equal(f.def._loopLoad.loading, null);
});

test('a decoded variation starts both layers immediately with their latest gain and rate', async () => {
  const f = audioLoadFixture({ variations: 3 }), a = f.makeLayer(), b = f.makeLayer();
  a.set(.8, 1); b.set(.4, .9); a.set(.1, .6);
  await until(() => f.decoders.length === 3);
  f.context.currentTime = .25;
  f.decoders[1].resolve({ duration: 2.5 }); await until(() => !!f.def.bufs[1]);
  assert.equal(f.def._loopLoad.pending, true, 'other variants still decode');
  a.set(.31, 1.7, .12); b.set(.2, .9, .15);
  assert.equal(f.sources.length, 2); assert.equal(f.counts.loads, 1);
  for (const [layer, gain, rate, tau] of [[a, .31, 1.7, .12], [b, .2, .9, .15]]) {
    assert.equal(layer.src.buffer, f.def.bufs[1]); assert.equal(layer.src.loopStart, 0); assert.equal(layer.src.loopEnd, 2.5);
    assert.deepEqual(layer.src.starts, [{ time: .25, offset: .625 }]);
    assert.deepEqual(layer.gain.gain.targets, [{ value: gain * f.def.gain, time: .25, tau }]);
    assert.deepEqual(layer.src.playbackRate.targets, [{ value: rate, time: .25, tau }]);
  }
  a.release(); b.release(); resolveAll(f); await until(() => !f.def._loopLoad.pending);
  assert.equal(f.audio._cnt.src - f.audio._relc.src, 0); assert.equal(f.audio._cnt.gain - f.audio._relc.gain, 0);
});

test('failed loop decoding backs off for one audio second, survives paused time, then recovers audibly', async () => {
  const f = audioLoadFixture(), a = f.makeLayer(), b = f.makeLayer();
  a.set(.5); b.set(.4); await until(() => f.decoders.length === 1);
  f.decoders[0].reject(new Error('temporary decode failure')); await until(() => !f.def._loopLoad.pending);
  assert.equal(f.audio.stats.failed, 1); assert.equal(f.def._loopLoad.retryAt, 1);
  for (let frame = 0; frame < 240; frame++) { a.set(.5); b.set(.4); }
  assert.equal(f.counts.loads, 1, 'a suspended audio clock cannot flood retries');
  f.context.currentTime = .999; a.set(.5); assert.equal(f.counts.loads, 1);
  f.context.currentTime = 1; a.set(.5); b.set(.4); await until(() => f.decoders.length === 2);
  assert.equal(f.counts.loads, 2); assert.equal(f.counts.variations, 2);
  f.context.currentTime = 1.01; f.decoders[1].resolve({ duration: 3 }); await until(() => !f.def._loopLoad.pending);
  a.set(.5); b.set(.4); assert.equal(f.sources.length, 2);
  assert.deepEqual(a.src.starts, [{ time: 1.01, offset: .75 }]);
  assert.equal(f.audio.stats.fetched, 1);
  a.release(); b.release();
});

test('a failed fetch also backs off and a later explicit asset recovery bypasses the gate', async () => {
  const f = audioLoadFixture(), l = f.makeLayer();
  f.def.urls[0] = 'data:audio/ogg;base64,%%%';
  l.set(.5); await until(() => f.def._loopLoad && !f.def._loopLoad.pending);
  assert.equal(f.audio.stats.failed, 1); assert.equal(f.decoders.length, 0);
  for (let frame = 0; frame < 120; frame++) l.set(.5);
  assert.equal(f.counts.loads, 1);
  f.def.urls[0] = 'data:audio/ogg;base64,AA==';
  const manual = f.audio.load(f.def, 0); await until(() => f.decoders.length === 1);
  f.decoders[0].resolve({ duration: 2 }); await manual;
  l.set(.5); assert.equal(f.sources.length, 1, 'decoded recovery starts before retry deadline');
  l.release();
});

test('unload and manifest storage replacement invalidate a pending gate without stale settlement taking ownership', async () => {
  const f = audioLoadFixture(), l = f.makeLayer();
  l.set(.5); await until(() => f.decoders.length === 1);
  const old = f.def._loopLoad;
  f.audio.unload(f.def); l.set(.5); await until(() => f.decoders.length === 2);
  const unloaded = f.def._loopLoad;
  assert.notEqual(unloaded, old); assert.equal(f.counts.loads, 2);
  // Manifest ingestion replaces the same definition's signature and storage.
  f.def.sig = 'new-manifest'; f.def.bufs = []; f.def.loading = []; f.def.failed = [];
  l.set(.5); await until(() => f.decoders.length === 3);
  const current = f.def._loopLoad; assert.notEqual(current, unloaded);
  f.decoders[0].reject(new Error('obsolete request')); f.decoders[1].reject(new Error('obsolete unload request'));
  await until(() => !old.pending && !unloaded.pending);
  assert.equal(f.def._loopLoad, current); assert.equal(current.pending, true); assert.equal(current.retryAt, 0);
  f.decoders[2].resolve({ duration: 2 }); await until(() => !current.pending);
  l.set(.5); assert.equal(f.sources.length, 1); l.release();
});

test('readiness ignores stale decoded slots beyond the refreshed manifest variation range', async () => {
  const f = audioLoadFixture(), l = f.makeLayer();
  f.def.bufs[5] = { duration: 10 }; l.set(.5); await until(() => f.decoders.length === 1);
  assert.equal(f.counts.loads, 1); assert.equal(f.sources.length, 0);
  f.decoders[0].resolve({ duration: 2 }); await until(() => !f.def._loopLoad.pending);
  l.set(.5); assert.equal(f.sources[0].buffer, f.def.bufs[0]); l.release();
});

test('decoded loop mix automation and idle source lifetime retain their original thresholds', () => {
  const f = audioLoadFixture(), l = f.makeLayer(); f.def.bufs[0] = { duration: 2 };
  l.set(.5, 1, .08); l.set(.5, 1, .08); assert.equal(f.counts.loads, 0);
  assert.equal(l.gain.gain.targets.length, 1); assert.equal(l.src.playbackRate.targets.length, 1);
  const first = l.src, gain = l.gain;
  l.set(0, 1, .08); f.context.currentTime = .699; l.set(0, 1, .08); assert.equal(l.src, first);
  f.context.currentTime = .701; l.set(0, 1, .08); assert.equal(l.src, null); assert.equal(first.disconnected, 1);
  l.set(.5, 1, .08); assert.equal(l.gain, gain); assert.notEqual(l.src, first);
  assert.deepEqual(l.src.playbackRate.targets, [{ value: 1, time: .701, tau: .08 }]);
  assert.deepEqual(l.gain.gain.targets.at(-1), { value: .375, time: .701, tau: .08 });
  l.release(); l.release(); assert.equal(f.audio._cnt.src - f.audio._relc.src, 0); assert.equal(f.audio._cnt.gain - f.audio._relc.gain, 0);
});

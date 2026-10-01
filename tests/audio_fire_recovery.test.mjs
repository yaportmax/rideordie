import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioBridge } from '../src/view/audio_bridge.js';
import { NULL_HANDLE } from '../src/core/audio.js';
import { audioVoiceFixture } from './helpers/audio-voice-fixture.mjs';

function fixture({ cap = 2 } = {}) {
  const f = audioVoiceFixture({ cap }); f.add('explosions/fire_crackle_loop');
  const bridge = new AudioBridge(f.audio, { playerId: 1 });
  const cars = [];
  function car(id, x) {
    const state = { id, burning: true, exploded: false, pos: { x, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
    const entry = bridge._car(id); cars.push({ state, entry });
    return { state, entry };
  }
  function tick(dt = .1) {
    f.audio.ctx.currentTime += dt;
    for (const { state, entry } of cars) bridge._fireLoops(state, entry, false);
  }
  return { ...f, bridge, cars, car, tick };
}
const live = a => Object.fromEntries(Object.keys(a._cnt).map(k => [k, a._cnt[k] - a._relc[k]]));
const handles = f => f.cars.flatMap(({ entry }) => [entry.fire, entry.crackle]).filter(Boolean);

test('capped fire beds keep the nearest cars audible without every-frame source replacement', () => {
  const f = fixture(), far = f.car(2, 50), mid = f.car(3, 20), near = f.car(4, 8);
  f.tick();
  const displaced = [far.entry.fire, far.entry.crackle];
  assert.ok(displaced.every(v => v.stopped));
  assert.ok(mid.entry.fire.playing && mid.entry.crackle.playing);
  assert.ok(near.entry.fire.playing && near.entry.crackle.playing);
  const counts = { played: f.audio.stats.played, stolen: f.audio.stats.stolen };
  for (let i = 0; i < 180; i++) f.tick(1 / 60);
  assert.deepEqual({ played: f.audio.stats.played, stolen: f.audio.stats.stolen }, counts,
    'inaudible cap rejects must not steal and restart the same loops');
  assert.equal(far.entry.fire, null); assert.equal(far.entry.crackle, null);
  assert.equal(f.audio.voices.size, 4);
  for (const v of displaced) v.src.finish(); f.finish();
  assert.deepEqual(live(f.audio), { gain: 0, src: 0, filter: 0, panner: 0 });
});

test('a formerly displaced wreck recovers when it moves nearer, with current audibility', () => {
  const f = fixture(), far = f.car(2, 50), mid = f.car(3, 20), near = f.car(4, 8);
  f.tick(); const old = handles(f);
  f.tick(.5); far.state.pos.x = 6; f.tick(.5);
  assert.ok(far.entry.fire.playing && far.entry.crackle.playing, 'ended retained handles cannot block a new audible source');
  assert.ok(near.entry.fire.playing && near.entry.crackle.playing);
  assert.ok(!mid.entry.fire?.playing && !mid.entry.crackle?.playing);
  assert.equal(f.audio.voices.size, 4);
  for (const v of new Set([...old, ...handles(f)])) v.src?.finish();
  assert.deepEqual(live(f.audio), { gain: 0, src: 0, filter: 0, panner: 0 });
});

test('fire-null/crackle-success stays owned and retries fire independently', () => {
  const f = fixture(), c = f.car(2, 10), realPlay = f.audio.play;
  let blockFire = true;
  f.audio.play = function(name, opts) { return blockFire && name === 'explosions/fire_loop' ? NULL_HANDLE : realPlay.call(this, name, opts); };
  f.tick(); const crackle = c.entry.crackle;
  assert.equal(c.entry.fire, null); assert.ok(crackle.playing);
  f.tick(.2); assert.equal(c.entry.crackle, crackle);
  blockFire = false; f.tick(.3);
  assert.ok(c.entry.fire.playing); assert.equal(c.entry.crackle, crackle);
  assert.equal(f.audio.voices.size, 2);
  f.bridge._removeCar(c.state.id); assert.equal(crackle.stopped, true);
  for (const v of [crackle, c.entry.fire]) v.src.finish();
  assert.deepEqual(live(f.audio), { gain: 0, src: 0, filter: 0, panner: 0 });
});

test('crackle failure or ended source recovers without replacing the live fire bed', () => {
  const f = fixture(), c = f.car(2, 10), realPlay = f.audio.play;
  let blockCrackle = true;
  f.audio.play = function(name, opts) { return blockCrackle && name === 'explosions/fire_crackle_loop' ? NULL_HANDLE : realPlay.call(this, name, opts); };
  f.tick(); const fire = c.entry.fire;
  assert.equal(c.entry.crackle, null); assert.ok(fire.playing);
  blockCrackle = false; f.tick(.5); const first = c.entry.crackle;
  assert.ok(first.playing); assert.equal(c.entry.fire, fire);
  first.src.finish(); f.tick(.5);
  assert.ok(c.entry.crackle.playing); assert.notEqual(c.entry.crackle, first); assert.equal(c.entry.fire, fire);
  f.finish(); assert.deepEqual(live(f.audio), { gain: 0, src: 0, filter: 0, panner: 0 });
});

test('leaving range or extinguishing stops both independently-owned loop handles', () => {
  for (const change of ['range', 'extinguish']) {
    const f = fixture(), c = f.car(2, 10); f.tick(); const voices = handles(f);
    if (change === 'range') c.state.pos.x = 145; else c.state.burning = false;
    f.tick();
    assert.equal(c.entry.fire, null); assert.equal(c.entry.crackle, null);
    assert.ok(voices.every(v => v.stopped));
    for (const v of voices) v.src.finish();
    assert.deepEqual(live(f.audio), { gain: 0, src: 0, filter: 0, panner: 0 });
  }
});

test('retry remains bounded during unavailable audio without losing a successful partner', () => {
  const f = fixture(), c = f.car(2, 10); let requests = 0;
  f.audio.play = () => { requests++; return NULL_HANDLE; };
  f.tick(.01);
  for (let i = 0; i < 120; i++) f.tick(1 / 60);
  assert.ok(requests >= 6 && requests <= 10, 'two layers should retry about twice per second, never each frame: ' + requests);
  assert.equal(c.entry.fire, null); assert.equal(c.entry.crackle, null);
  assert.deepEqual(live(f.audio), { gain: 0, src: 0, filter: 0, panner: 0 });
});

test('a completely failed pending loop releases its waiter and recovers after bounded retry', async () => {
  const f = fixture(), c = f.car(2, 10), d = f.def;
  Object.assign(f.audio, { _queue: [], _active: 0, _maxActive: 4, _seq: 0, fetchCache: 'default' });
  Object.assign(f.audio.stats, { failed: 0, fetched: 0, fetchedBytes: 0 });
  Object.assign(d, { bufs: [], loading: [], failed: [], urls: ['data:audio/ogg;base64,!'] });
  f.tick(.01); const failed = c.entry.fire, crackle = c.entry.crackle;
  assert.equal(failed.src, null); assert.deepEqual(d.waiters, [failed]);
  assert.deepEqual(await f.audio.load(d), [null]);
  assert.equal(d.failed[0], true); assert.equal(failed.playing, true, 'Voice remains pending until its owning loop cancels');
  f.tick(.1);
  assert.equal(c.entry.fire, null); assert.equal(failed.ended, true);
  assert.equal(d.waiters.length, 0); assert.equal(d.voices.length, 0);
  assert.equal(c.entry.crackle, crackle); assert.ok(crackle.playing);
  d.urls = ['data:audio/ogg;base64,AA=='];
  f.audio.ctx.decodeAudioData = async () => ({ duration: 2, numberOfChannels: 1, length: 2000 });
  f.tick(.4); const recovered = c.entry.fire;
  await f.audio.load(d);
  assert.ok(recovered.src); assert.ok(recovered.playing); assert.notEqual(recovered, failed);
  assert.equal(d.waiters.length, 0); assert.equal(f.audio.stats.failed, 1); assert.equal(f.audio._cnt.src, 2);
  f.finish(); assert.deepEqual(live(f.audio), { gain: 0, src: 0, filter: 0, panner: 0 });
});

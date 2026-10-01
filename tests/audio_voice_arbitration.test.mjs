import test from 'node:test';
import assert from 'node:assert/strict';
import { NULL_HANDLE } from '../src/core/audio.js';
import { audioVoiceFixture as fixture } from './helpers/audio-voice-fixture.mjs';

test('a capped positional loop keeps nearer sources and rejects farther or equal arrivals without churn', () => {
  const f = fixture(), { audio, def, play } = f;
  const near = play(10), far = play(80);
  assert.equal(play(100), NULL_HANDLE);
  assert.equal(play(80), NULL_HANDLE, 'equal audibility must keep the already playing loop');
  const nearest = play(4);
  assert.equal(far.stopped, true, 'evict the least audible source, not the oldest');
  assert.equal(near.stopped, false); assert.equal(nearest.playing, true);
  assert.deepEqual(def.voices, [near, nearest]);
  for (let i = 0; i < 100; i++) assert.equal(play(100 + i), NULL_HANDLE);
  assert.equal(audio.voices.size, 2); assert.equal(audio._dyn.size, 2);
  assert.equal(audio.stats.stolen, 1); assert.equal(audio.stats.dropped, 102);
  far.src.finish(); f.finish();
  assert.deepEqual(Object.fromEntries(Object.keys(audio._cnt).map(k => [k, audio._cnt[k] - audio._relc[k]])), { gain: 0, src: 0, filter: 0, panner: 0 });
});

test('loop ranking follows listener movement before a new source reaches the cap', () => {
  const f = fixture(), { audio, def, play } = f;
  const originallyNear = play(10), nowNear = play(90);
  assert.ok(originallyNear.score > nowNear.score);
  audio.listener.pos.x = 100; audio.ctx.currentTime += .5;
  audio.update(.5);
  assert.ok(originallyNear.score < nowNear.score);
  const arriving = play(96);
  assert.equal(originallyNear.stopped, true); assert.equal(nowNear.playing, true);
  assert.deepEqual(def.voices, [nowNear, arriving]);
  originallyNear.src.finish(); f.finish();
});

test('moving a source updates its admission score immediately', () => {
  const f = fixture(), { def, play } = f;
  const first = play(8), second = play(40);
  first.setPos([100, 0, 0]); second.setPos([4, 0, 0]);
  assert.ok(first.score < second.score);
  const next = play(20);
  assert.equal(first.stopped, true); assert.equal(second.playing, true);
  assert.deepEqual(def.voices, [second, next]);
  first.src.finish(); f.finish();
});

test('loop ranking respects current user gain for positional and nonpositional voices', () => {
  const f = fixture(), { def, play } = f;
  const loud = play(8), quiet = play(8);
  quiet.setGain(.05); loud.setGain(1.5);
  assert.equal(quiet.score, .025); assert.equal(loud.score, .75);
  const replacement = play(8, { gain: .2 });
  assert.equal(quiet.stopped, true); assert.deepEqual(def.voices, [loud, replacement]);
  quiet.src.finish(); f.finish();
  const g = fixture({ cap: 1 });
  const unpositioned = g.audio.play(g.def, { loop: true, pitchVar: 0 });
  unpositioned.setGain(.1);
  assert.equal(unpositioned.score, .05);
  assert.ok(g.audio.play(g.def, { loop: true, gain: .2, pitchVar: 0 }).playing);
  assert.equal(unpositioned.stopped, true);
  unpositioned.src.finish(); g.finish();
});

test('one-shot arrivals preserve oldest-first per-definition stealing', () => {
  const f = fixture(), { def, play } = f;
  const oldest = play(4, { loop: false }), quiet = play(80, { loop: false });
  const next = play(40, { loop: false });
  assert.equal(oldest.stopped, true); assert.equal(quiet.playing, true);
  assert.deepEqual(def.voices, [quiet, next]);
  oldest.src.finish(); f.finish();
});

test('an incoming loop can replace an active one-shot, but cannot replace an equal or stronger loop', () => {
  const f = fixture({ cap: 1 });
  const oneShot = f.play(4, { loop: false, gain: 2 });
  const loop = f.play(4);
  assert.equal(oneShot.stopped, true); assert.equal(loop.playing, true);
  assert.equal(f.play(4), NULL_HANDLE);
  assert.equal(f.play(4, { gain: .5 }), NULL_HANDLE);
  assert.equal(loop.stopped, false);
  oneShot.src.finish(); f.finish();
});

test('loop arbitration does not choose a stopped fading voice instead of an active quiet source', () => {
  const f = fixture(), { def, play } = f;
  const fading = play(100), quiet = play(80);
  fading.stop(.2);
  const incoming = play(10);
  assert.equal(quiet.stopped, true); assert.equal(incoming.playing, true);
  assert.deepEqual(def.voices, [fading, incoming]);
  fading.src.finish(); quiet.src.finish(); f.finish();
});

test('global cap still protects loops and admits stronger one-shots by stealing weaker one-shots', () => {
  const f = fixture({ cap: 4, maxVoices: 2 }), { audio, add, play } = f;
  const loop = play(8), firstDef = add('impacts/first', 'impact_misc'), secondDef = add('impacts/second', 'impact_misc');
  const weak = play(8, { loop: false, gain: .1 }, firstDef);
  const strong = play(8, { loop: false, gain: 1 }, secondDef);
  assert.equal(weak.stopped, true); assert.equal(loop.playing, true); assert.equal(strong.playing, true);
  assert.equal(audio.voices.size, 2); assert.equal(audio.stats.stolen, 1);
  weak.src.finish(); f.finish();
  const g = fixture({ cap: 4, maxVoices: 2 });
  const other = g.add('explosions/other_loop');
  const a = g.play(8), b = g.play(8, {}, other);
  assert.equal(g.play(4), NULL_HANDLE, 'global admission cannot steal another persistent loop');
  assert.equal(a.stopped, false); assert.equal(b.stopped, false); assert.equal(g.audio.voices.size, 2);
  g.finish();
});

test('a per-definition replacement admits at the full global cap without interrupting other loops', () => {
  const f = fixture({ cap: 2, maxVoices: 3 }), { audio, def, add, play } = f;
  const near = play(10), far = play(80), unrelated = play(8, {}, add('explosions/other_loop'));
  assert.equal(audio.voices.size, 3);
  const replacement = play(4);
  assert.equal(replacement.playing, true); assert.equal(far.stopped, true);
  assert.equal(near.stopped, false); assert.equal(unrelated.stopped, false);
  assert.equal(audio.voices.size, 3); assert.deepEqual(def.voices, [near, replacement]);
  assert.equal(audio.stats.stolen, 1); assert.equal(audio.stats.dropped, 0);
  far.src.finish(); f.finish();
});

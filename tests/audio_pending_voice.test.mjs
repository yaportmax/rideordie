import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSys, Voice } from '../src/core/audio.js';

const AUDIO_URL = 'data:audio/wav;base64,AA==';
const BAD_URL = 'data:audio/wav;base64,!';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

class FakeParam {
  constructor() { this.value = 0; this.events = []; }
  setTargetAtTime(...args) { this.events.push(['target', ...args]); }
  setValueAtTime(...args) { this.events.push(['value', ...args]); }
  linearRampToValueAtTime(...args) { this.events.push(['ramp', ...args]); }
  cancelScheduledValues(...args) { this.events.push(['cancel', ...args]); }
  cancelAndHoldAtTime(...args) { this.events.push(['hold', ...args]); }
}

class FakeNode {
  constructor() {
    for (const name of ['gain', 'frequency', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release', 'delayTime', 'playbackRate', 'positionX', 'positionY', 'positionZ']) this[name] = new FakeParam();
    this.connections = []; this.disconnects = 0; this.starts = []; this.stops = [];
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections.length = 0; this.disconnects++; }
  start(...args) { this.starts.push(args); }
  stop(...args) { this.stops.push(args); }
  finish() { this.onended?.(); }
}

class FakeContext {
  constructor(decode) {
    this.currentTime = 2; this.sampleRate = 1000; this.state = 'running';
    this.destination = new FakeNode(); this.decode = decode; this.decodeCount = 0;
    this.decodeStarted = deferred();
  }
  // An offline context keeps the real AudioSys constructor free of wall timers.
  startRendering() {}
  createGain() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createDynamicsCompressor() { return new FakeNode(); }
  createWaveShaper() { return new FakeNode(); }
  createAnalyser() { return new FakeNode(); }
  createDelay() { return new FakeNode(); }
  createConvolver() { return new FakeNode(); }
  createPanner() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / sampleRate, numberOfChannels: channels, length, getChannelData: i => data[i] };
  }
  decodeAudioData(bytes) { this.decodeCount++; this.decodeStarted.resolve(); return this.decode(bytes); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

function fixture({ url = AUDIO_URL, decode = () => Promise.resolve(buffer()), maxVoices = 64, names = ['test/pending'] } = {}) {
  const ctx = new FakeContext(decode);
  const audio = new AudioSys(null, { context: ctx, rand: () => .5, maxVoices });
  audio.baseUrl = '';
  audio.ingestManifest({ sounds: Object.fromEntries(names.map(name => [name, { files: [url], duration: 1, category: 'explosion_loop', gain: 1 }])) });
  return { ctx, audio, defs: names.map(name => audio.resolve(name)) };
}
const buffer = () => ({ duration: 4, length: 4000, numberOfChannels: 1 });
const liveNodes = audio => Object.fromEntries(Object.keys(audio._cnt).map(type => [type, audio._cnt[type] - audio._relc[type]]));
const playPending = (audio, def, extra = {}) => audio.play(def, { loop: true, pos: [30, 0, 0], pitchVar: 0, ...extra });

function assertReleased(audio, def, voice) {
  assert.equal(voice.ended, true);
  assert.equal(voice.playing, false);
  assert.equal(voice.src, null);
  assert.equal(def.waiters.length, 0, 'ended pending voices cannot remain retained by a failed definition');
  assert.equal(def.voices.length, 0);
  assert.equal(audio.voices.size, 0);
  assert.equal(audio._dyn.size, 0);
  assert.deepEqual(liveNodes(audio), { gain: 0, src: 0, media: 0, filter: 0, panner: 0 });
}

for (const failure of ['fetch', 'decode']) {
  for (const stopWhen of ['before', 'after']) {
    test(`stopped pending voice releases its waiter and nodes ${stopWhen} ${failure} failure`, async t => {
      const gate = deferred();
      const { audio, ctx, defs: [def] } = fixture({
        url: failure === 'fetch' ? BAD_URL : AUDIO_URL,
        decode: () => gate.promise,
      });
      t.after(() => audio.dispose());
      const voice = playPending(audio, def);
      assert.ok(voice instanceof Voice);
      assert.deepEqual(def.waiters, [voice]);
      assert.deepEqual(liveNodes(audio), { gain: 1, src: 0, media: 0, filter: 1, panner: 1 });
      const loaded = audio.load(def);
      if (stopWhen === 'before') { voice.stop(); assertReleased(audio, def, voice); }
      if (failure === 'decode') { await ctx.decodeStarted.promise; gate.reject(new Error('fixture decode failure')); }
      assert.deepEqual(await loaded, [null]);
      assert.equal(audio.stats.failed, 1);
      assert.equal(def.failed[0], true);
      assert.equal(ctx.decodeCount, failure === 'decode' ? 1 : 0);
      if (stopWhen === 'after') voice.stop();
      assertReleased(audio, def, voice);
      const released = { ...audio._relc };
      voice.stop(); voice.attach(buffer());
      assert.deepEqual(audio._relc, released, 'late attachment and repeated stop must not double-release nodes');
      assert.equal(audio._cnt.src, 0, 'a stopped pending voice must never create a source');
    });
  }
}

test('per-definition stealing keeps pending waiters and nodes bounded through delayed decode', async t => {
  const gate = deferred();
  const { audio, ctx, defs: [def] } = fixture({ decode: () => gate.promise });
  t.after(() => audio.dispose());
  def.cap = 2;
  const voices = [];
  for (let i = 0; i < 100; i++) {
    ctx.currentTime += .01;
    voices.push(playPending(audio, def, { gain: 1 + i * .01 }));
    const count = Math.min(i + 1, 2);
    assert.equal(def.waiters.length, count);
    assert.equal(audio.voices.size, count);
    assert.deepEqual(liveNodes(audio), { gain: count, src: 0, media: 0, filter: count, panner: count });
  }
  assert.equal(audio.stats.stolen, 98);
  assert.ok(voices.slice(0, -2).every(voice => voice.ended && voice.src === null));
  await ctx.decodeStarted.promise;
  const loaded = audio.load(def), decoded = buffer(); gate.resolve(decoded);
  assert.deepEqual(await loaded, [decoded]);
  assert.equal(def.waiters.length, 0);
  assert.equal(audio._cnt.src, 2, 'only surviving voices may attach');
  for (const voice of voices.slice(-2)) { assert.equal(voice.src.buffer, decoded); voice.src.finish(); }
  assert.deepEqual(liveNodes(audio), { gain: 0, src: 0, media: 0, filter: 0, panner: 0 });
});

test('global stealing removes pending one-shot waiters from their original definitions', async t => {
  const gate = deferred();
  const { audio, ctx, defs } = fixture({ decode: () => gate.promise, maxVoices: 2, names: ['test/a', 'test/b', 'test/c'] });
  t.after(() => audio.dispose());
  const voices = [];
  for (let i = 0; i < 60; i++) {
    ctx.currentTime += .01;
    voices.push(playPending(audio, defs[i % defs.length], { loop: false, wait: true, gain: 1 + i * .01 }));
    assert.equal(defs.reduce((sum, def) => sum + def.waiters.length, 0), Math.min(i + 1, 2));
    assert.equal(audio.voices.size, Math.min(i + 1, 2));
  }
  assert.equal(audio.stats.stolen, 58);
  const loaded = audio.load(defs); gate.resolve(buffer()); await loaded;
  assert.equal(audio._cnt.src, 2);
  assert.ok(voices.slice(0, -2).every(voice => voice.ended && voice.src === null));
  for (const voice of voices.slice(-2)) voice.src.finish();
  assert.deepEqual(liveNodes(audio), { gain: 0, src: 0, media: 0, filter: 0, panner: 0 });
  assert.ok(defs.every(def => def.waiters.length === 0 && def.voices.length === 0));
});

test('equal-score pending loops preserve their original waiters without stealing or node churn', async t => {
  const gate = deferred();
  const { audio, ctx, defs: [def] } = fixture({ decode: () => gate.promise });
  t.after(() => audio.dispose());
  def.cap = 2;
  const first = playPending(audio, def), second = playPending(audio, def);
  for (let i = 0; i < 100; i++) {
    ctx.currentTime += .01;
    assert.equal(playPending(audio, def).isNull, true);
  }
  assert.equal(audio.stats.stolen, 0); assert.equal(audio.stats.dropped, 100);
  assert.deepEqual(def.waiters, [first, second]); assert.deepEqual(def.voices, [first, second]);
  assert.equal(audio._cnt.gain, 2); assert.equal(audio._cnt.src, 0);
  await ctx.decodeStarted.promise;
  const loaded = audio.load(def); gate.resolve(buffer()); await loaded;
  assert.equal(audio._cnt.src, 2); assert.equal(def.waiters.length, 0);
  assert.equal(first.playing, true); assert.equal(second.playing, true);
  first.src.finish(); second.src.finish();
  assert.deepEqual(liveNodes(audio), { gain: 0, src: 0, media: 0, filter: 0, panner: 0 });
});

test('delayed attachment preserves start, offset, pitch and pending scheduled-stop behavior', async t => {
  const gate = deferred();
  const { audio, ctx, defs: [def] } = fixture({ decode: () => gate.promise });
  t.after(() => audio.dispose());
  const future = playPending(audio, def, { delay: 1.5, offset: .25, pitch: 1.25, fadeIn: .4 });
  const late = playPending(audio, def, { delay: .25, loop: false, wait: true, offset: .5, duration: 1, fadeOut: .2 });
  // Existing API semantics: scheduling a future stop before a source exists is a no-op.
  future.stop(.1, 5);
  assert.equal(future.stopped, false);
  assert.deepEqual(def.waiters, [future, late]);
  await ctx.decodeStarted.promise;
  ctx.currentTime = 3;
  const decoded = buffer(), loaded = audio.load(def); gate.resolve(decoded); await loaded;
  assert.deepEqual(future.src.starts, [[3.5, .25]]);
  assert.equal(future.src.playbackRate.value, 1.25);
  assert.equal(future.src.loop, true);
  assert.deepEqual(future.src.stops, []);
  assert.deepEqual(future.gainNode.gain.events, [['target', 1, 3.5, .1]]);
  assert.deepEqual(late.src.starts, [[3, .5]], 'past requested start must clamp to decode completion time');
  assert.deepEqual(late.src.stops, [[4.23]]);
  assert.equal(late.endEst, 4.7);
  assert.equal(def.waiters.length, 0);
  assert.equal(audio.voices.size, 2);
  future.src.finish(); late.src.finish();
  assert.deepEqual(liveNodes(audio), { gain: 0, src: 0, media: 0, filter: 0, panner: 0 });
});

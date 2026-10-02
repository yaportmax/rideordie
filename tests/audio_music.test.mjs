import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AudioSys } from '../src/core/audio.js';
import { audioLoadFixture, until } from './helpers/audio-load-fixture.mjs';
import { musicFixture, musicTrack, MUSIC_BIOMES } from './helpers/music-fixture.mjs';

test('explicit stage metadata and legacy notes resolve all six stages and forest alias', () => {
  for (const notesOnly of [false, true]) {
    const f = musicFixture({ notesOnly });
    for (const biome of MUSIC_BIOMES) { f.music.setBiome(biome); assert.equal(f.music._pick('run', {}), musicTrack(biome)); }
    f.music.setBiome('forest'); assert.equal(f.music._pick('run', {}), musicTrack('mountain'));
    assert.deepEqual(f.music.trackIds('boss'), ['boss_dnb']); assert.equal(f.music.pinned.size, 0);
  }
});

test('cold checkpoint stage supersedes initial decoding before any audible bed starts', () => {
  const f = musicFixture({ ready: false });
  f.music.setBiome('desert'); f.music.setState('run'); const old = f.deferred[0];
  f.music.setBiome('city'); const fresh = f.deferred[1];
  f.fulfill(old); assert.equal(f.music.cur, null); assert.equal(f.sources.length, 0);
  f.fulfill(fresh); assert.equal(f.music.cur.track.id, musicTrack('city'));
  assert.equal(f.music.successor, musicTrack('dam'));
  assert.equal(f.loaded.at(-1).priority, 3); assert.equal(f.deferred[1].priority, 2);
});

test('return to an audible current track revokes a pending boss load', () => {
  const f = musicFixture({ ready: false }); f.decode(musicTrack('desert'));
  f.music.setBiome('desert'); f.music.setState('run'); f.advance(1);
  const current = f.music.cur;
  f.music.setState('boss'); const pending = f.deferred.at(-1);
  f.music.setState('run'); f.fulfill(pending);
  assert.equal(f.music.cur, current); assert.equal(f.music.state, 'run'); assert.equal(f.music.wantTrack, musicTrack('desert'));
  assert.equal(f.live().src, 2); assert.ok(f.defsFor('boss_dnb').every((d) => !d.bufs.length));
});

test('manifest refresh revokes stale startup while retaining the newest stage request', () => {
  const f = musicFixture({ ready: false }); f.music.setBiome('dam'); f.music.setState('run');
  const old = f.deferred[0]; f.music._rebuild(); const fresh = f.deferred[1];
  f.fulfill(old); assert.equal(f.music.cur, null);
  f.fulfill(fresh); assert.equal(f.music.cur.track.id, musicTrack('dam')); assert.equal(f.music.successor, 'boss_dnb');
});

test('complete groove and pressure start phase aligned and crossfade exactly on a bar', () => {
  const f = musicFixture(); f.music.setBiome('desert'); f.music.setState('run'); const old = f.music.cur;
  assert.deepEqual(old.stems.map((s) => s.target), [.5, 0]);
  assert.deepEqual(old.stems.map((s) => s.src.starts[0]), [[old.t0, 0], [old.t0, 0]]);
  assert.ok(old.stems.every((s) => s.src.loopStart === 0 && s.src.loopEnd === old.dur));
  f.music.setIntensity(1); assert.deepEqual(old.stems.map((s) => s.target), [.5, .5]);
  const layerTime = f.music._pendLayer.time; f.advance(layerTime - .1);
  assert.equal(f.music.log.at(-1).type, 'layers'); assert.equal(f.music.log.at(-1).t, layerTime);
  f.ctx.currentTime = 3; f.decode(musicTrack('canyon')); f.music.setBiome('canyon'); const next = f.music.cur;
  const bars = (next.t0 - old.t0) / old.spb;
  assert.ok(Math.abs(bars - Math.round(bars)) < 1e-9); assert.equal(next.stems.length, 2); assert.equal(old.endAt, next.t0 + next.fader.dur + .08);
  assert.deepEqual(next.stems.map((s) => s.target), [.5, .5]);
  f.advance(old.endAt + .001); assert.equal(old.dead, true); assert.deepEqual(f.live(), { src: 2, gain: 3 });
  assert.equal(next.prev, null, 'completed themes cannot form a retained JavaScript bed chain');
  assert.ok(f.defsFor(musicTrack('desert')).every((d) => !d.bufs.length));
  assert.ok(f.defsFor(musicTrack('canyon')).every((d) => d.bufs.length));
});

test('rapid pre-boundary supersession restores the audible bed and frees unstarted sources', () => {
  const f = musicFixture(); f.music.setBiome('desert'); f.music.setState('run'); f.advance(2);
  const desert = f.music.cur; f.decode(musicTrack('canyon')); f.music.setBiome('canyon'); const canyon = f.music.cur;
  assert.ok(canyon.t0 > f.ctx.currentTime + .02);
  f.music.setIntensity(1, { immediate: true });
  f.music.setBiome('desert');
  assert.equal(canyon.dead, true); assert.equal(f.music.cur, desert); assert.equal(desert.endAt, Infinity);
  assert.deepEqual(desert.stems.map((s) => s.target), [.5, .5], 'restored bed uses the latest threat even if future frames repeat it');
  assert.equal(f.music.fading.length, 0); assert.deepEqual(f.live(), { src: 2, gain: 3 });
});

test('superseding an audible fade coalesces latest request and keeps at most two live beds', () => {
  const f = musicFixture(); f.music.setBiome('desert'); f.music.setState('run'); f.advance(2);
  f.decode(musicTrack('canyon')); f.music.setBiome('canyon'); const canyon = f.music.cur, desert = f.music.fading[0];
  f.advance(canyon.t0 + .2); f.decode(musicTrack('coast')); f.music.setBiome('coast');
  assert.equal(f.music.cur, canyon); assert.equal(f.live().src, 4); assert.equal(f.music.wantTrack, musicTrack('coast'));
  f.advance(desert.endAt + .002);
  assert.equal(desert.dead, true); assert.equal(f.music.cur.track.id, musicTrack('coast')); assert.equal(f.live().src, 4);
  f.advance(canyon.endAt + .002); assert.deepEqual(f.live(), { src: 2, gain: 3 });
});

test('stage succession prefetches only one theme and retires decoded outgoing music', () => {
  const f = musicFixture(); f.music.setBiome('desert'); f.music.setState('run');
  assert.equal(f.music.successor, musicTrack('canyon'));
  assert.equal(f.loaded.length, 1); assert.ok(f.loaded[0].defs.every((d) => d.meta.track === musicTrack('canyon')));
  assert.ok(f.defsFor('boss_dnb').every((d) => !d.bufs.length));
  for (const biome of MUSIC_BIOMES.slice(1)) {
    f.advance(f.ctx.currentTime + 10); f.decode(musicTrack(biome)); f.music.setBiome(biome);
    if (f.music.fading.length) f.advance(f.music.fading[0].endAt + .01);
    const resident = new Set([...f.A.defs.values()].filter((d) => d.bufs.length).map((d) => d.meta.track));
    assert.equal(resident.size, 1); assert.equal(f.music.cur.track.id, musicTrack(biome));
    assert.ok(f.loaded.at(-1).defs.every((d) => d.meta.track === f.music.successor));
  }
  assert.equal(f.music.successor, 'boss_dnb');
});

test('failed stage loads back off on the audio clock and preserve audible current music', () => {
  const f = musicFixture({ ready: false }); f.decode(musicTrack('desert'));
  f.music.setBiome('desert'); f.music.setState('run'); f.advance(1); const old = f.music.cur;
  f.music.setBiome('city'); const failed = f.deferred.at(-1); failed.cb();
  for (let frame = 0; frame < 240; frame++) f.music.tick(1);
  assert.equal(f.deferred.length, 1); assert.equal(f.music.cur, old);
  f.advance(2.999); assert.equal(f.deferred.length, 1);
  f.advance(3); assert.equal(f.deferred.length, 2); assert.equal(f.deferred[1].priority, 2);
  f.fulfill(f.deferred[1]); assert.equal(f.music.cur.track.id, musicTrack('city')); assert.equal(f.music._retryAt, Infinity);
});

test('failed load retry is cancelled by garage, stop and synchronous dispose', () => {
  for (const action of ['garage', 'stop', 'dispose']) {
    const f = musicFixture({ ready: false }); f.music.setBiome('city'); f.music.setState('run'); const pending = f.deferred[0];
    if (action === 'garage') { f.decode('garage'); f.music.setState('garage'); }
    else f.music[action]();
    f.fulfill(pending); f.advance(10);
    assert.equal(f.music.cur?.track.id ?? null, action === 'garage' ? 'garage' : null);
    assert.equal(f.deferred.length, 1);
  }
});

test('mismatched decoded lengths cannot replace an aligned audible bed', () => {
  const f = musicFixture(); f.music.setBiome('desert'); f.music.setState('run'); f.advance(2); const old = f.music.cur;
  f.decode(musicTrack('city')); f.defsFor(musicTrack('city'))[1].bufs[0].length--;
  f.music.setBiome('city'); assert.equal(f.music.cur, old); assert.equal(f.live().src, 2);
  assert.equal(f.music._retryAt, 4);
});

test('boss pressure and victory one shot preserve state while releasing all completed beds', () => {
  const f = musicFixture(); f.music.setBiome('dam'); f.music.setState('run'); f.advance(2);
  f.decode('boss_dnb'); f.music.setState('boss'); f.music.setIntensity(.7, { immediate: true });
  assert.equal(f.music.cur.track.id, 'boss_dnb'); assert.equal(f.music.successor, null);
  f.advance(f.music.fading[0].endAt + .01); f.decode('victory'); f.music.setState('victory');
  const victory = f.music.cur; assert.equal(victory.loop, false);
  f.advance(victory.endAt + .01); assert.equal(f.music.cur, null); assert.equal(f.music.wantTrack, null);
  assert.deepEqual(f.live(), { src: 0, gain: 0 }); f.advance(500); assert.equal(f.music.cur, null);
});

test('stop fade and immediate disposal release nodes exactly once and cancel late completion', () => {
  const f = musicFixture(); f.music.setBiome('desert'); f.music.setState('run'); f.advance(2);
  f.decode(musicTrack('canyon')); f.music.setBiome('canyon'); assert.equal(f.live().src, 4);
  f.music.dispose(); f.music.dispose(); f.advance(100);
  assert.deepEqual(f.live(), { src: 0, gain: 0 }); assert.equal(f.music.fading.length, 0); assert.equal(f.music.cur, null);
  assert.ok([...f.A.defs.values()].every((d) => !d.bufs.length)); assert.equal(f.music.setState('run'), null);
});

test('victory retirement preserves a newer delayed theme and its bounded retry', () => {
  const f = musicFixture({ ready: false }); f.decode('victory'); f.music.setState('victory');
  const endedAt = f.music.cur.endAt; f.advance(endedAt - 1); f.music.setState('garage');
  const failed = f.deferred[0]; failed.cb(); f.advance(endedAt + .01);
  assert.equal(f.music.cur, null); assert.equal(f.music.wantTrack, 'garage');
  f.advance(endedAt + 1); assert.equal(f.deferred.length, 2); f.fulfill(f.deferred[1]);
  assert.equal(f.music.cur.track.id, 'garage'); assert.equal(f.music.state, 'garage');
});

test('steady threat does not enqueue redundant ramps and diagnostic history stays bounded', () => {
  const f = musicFixture(); f.music.setBiome('desert'); f.music.setState('run'); f.advance(2);
  for (let frame = 0; frame < 240; frame++) { f.music.setIntensity(0); f.music.tick(2 + frame / 60); }
  assert.equal(f.music.log.length, 1); assert.equal(f.music._pendLayer, null);
  for (let n = 0; n < 400; n++) f.music.setIntensity(n % 2, { immediate: true });
  assert.equal(f.music.log.length, 128); assert.equal(f.music.log.at(-1).type, 'layers');
});

test('unload prevents late decode from restoring buffers or attaching a waiting voice', async () => {
  const f = audioLoadFixture(); let attaches = 0; f.def.waiters.push({ attach() { attaches++; } });
  const old = f.audio.load(f.def, 2); await until(() => f.decoders.length === 1);
  f.audio.unload(f.def); const fresh = f.audio.load(f.def, 2); await until(() => f.decoders.length === 2);
  f.decoders[0].resolve({ duration: 2 }); await old;
  assert.equal(f.def.bufs.length, 0); assert.equal(attaches, 0); assert.ok(f.def.loading[0]);
  f.decoders[1].resolve({ duration: 3 }); await fresh;
  assert.equal(f.def.bufs[0].duration, 3); assert.equal(attaches, 1); assert.equal(f.def.loading[0], null);
});

test('old failed decode cannot clear a replacement manifest load or mark it failed', async () => {
  const f = audioLoadFixture(); const old = f.audio.load(f.def, 2); await until(() => f.decoders.length === 1);
  f.def.sig = 'new'; f.audio.unload(f.def); const fresh = f.audio.load(f.def, 2); await until(() => f.decoders.length === 2);
  const owner = f.def.loading[0]; f.decoders[0].reject(new Error('old failure')); await old;
  assert.equal(f.def.loading[0], owner); assert.equal(f.def.failed.length, 0);
  f.decoders[1].resolve({ duration: 3 }); await fresh; assert.equal(f.def.bufs[0].duration, 3);
});

test('AudioSys disposal prevents pending decodes from restoring released music memory', async () => {
  const f = audioLoadFixture(), music = musicFixture(); let closed = 0;
  f.audio.music = music.music; f.audio.defs = new Map([[f.def.key, f.def]]); f.audio.voices = new Set(); f.audio.engines = new Map();
  f.context.close = () => { closed++; return Promise.resolve(); };
  const pending = f.audio.load(f.def, 2); await until(() => f.decoders.length === 1);
  AudioSys.prototype.dispose.call(f.audio); AudioSys.prototype.dispose.call(f.audio);
  f.decoders[0].resolve({ duration: 3 }); await pending;
  assert.equal(f.def.bufs.length, 0); assert.equal(closed, 1); assert.equal(music.music._disposed, true);
});

test('production soundtrack registers complete streamed songs without layering old synthesis stems', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/audio/manifest.json', import.meta.url)));
  const registered = Object.entries(manifest.sounds).filter(([key]) => key.startsWith('music/'));
  assert.ok(registered.length >= 15);
  assert.ok(registered.every(([, def]) => def.streaming && def.stem === 'base' && def.intensity === 0));
  assert.equal(new Set(registered.map(([, def]) => def.track)).size, registered.length);
  assert.ok(!registered.some(([key]) => /_(?:extra|drums|lead)$/.test(key)));
});

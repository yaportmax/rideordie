import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { AudioSys, BIOME_ORDER } from '../src/core/audio.js';
import { musicFixture } from './helpers/music-fixture.mjs';
import { audioLoadFixture } from './helpers/audio-load-fixture.mjs';

class MediaFixture {
  constructor() {
    this.handlers = new Map(); this.readyState = 0; this.currentTime = 0; this.duration = 180;
    this.paused = true; this.playCalls = 0; this.pauseCalls = 0; this.loadCalls = 0;
    this.playError = null; this.holdPlay = false; this.pendingPlays = []; this.src = '';
  }
  addEventListener(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(fn); }
  removeEventListener(type, fn) { this.handlers.get(type)?.delete(fn); }
  emit(type) { if (type === 'canplay') this.readyState = 4; if (type === 'ended') this.paused = true; for (const fn of [...(this.handlers.get(type) || [])]) fn(); }
  load() { this.loadCalls++; }
  pause() {
    this.pauseCalls++; this.paused = true;
    if (this.abortOnPause) for (const pending of this.pendingPlays.splice(0)) { const error = new Error('Media paused during play'); error.name = 'AbortError'; pending.reject(error); }
  }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  play() {
    this.playCalls++;
    if (this.playError) return Promise.reject(this.playError);
    if (this.holdPlay) return new Promise((resolve, reject) => this.pendingPlays.push({ resolve: () => { this.paused = false; resolve(); }, reject }));
    this.paused = false; return Promise.resolve();
  }
}

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function streamFixture(t) {
  const f = musicFixture(), medias = [], mediaNodes = [];
  f.A._cnt.media = 0; f.A._relc.media = 0;
  f.ctx.state = 'running';
  f.ctx.createMediaElementSource = () => { const n = { connected: [], disconnected: 0, connect(dest) { this.connected.push(dest); }, disconnect() { this.disconnected++; } }; mediaNodes.push(n); return n; };
  f.A._media = AudioSys.prototype._media;
  f.A.opts = { mediaFactory: () => { const media = new MediaFixture(); medias.push(media); return media; } };
  const run = {}, boss = {};
  const add = (id, kind, loop = true, biomes = []) => {
    const def = { key: 'music/' + id, name: id, group: 'music', category: 'music', gain: .7, loop, duration: 180,
      urls: ['/audio/music/suno/' + id + '.mp3'], bufs: [], loading: [], voices: [],
      meta: { streaming: true, track: id, kind, stem: 'base', intensity: 0, biomes } };
    f.A.defs.set(def.key, def); return def;
  };
  for (const [i, biome] of BIOME_ORDER.entries()) { run[biome] = 'run_suno_' + String(i + 1).padStart(2, '0'); add(run[biome], 'run', true, [biome]); boss[biome] = i < 3 ? 'boss_suno_early' : i < 7 ? 'boss_suno_mid' : 'boss_suno_late'; }
  for (const id of new Set(Object.values(boss))) add(id, 'boss');
  for (const kind of ['title', 'garage', 'victory']) add(kind + '_suno', kind, kind !== 'victory');
  f.A.manifest = { musicRoutes: { run, boss, title: 'title_suno', garage: 'garage_suno', victory: 'victory_suno' } };
  f.music._rebuild();
  t.after(() => f.music.dispose());
  return { ...f, medias, mediaNodes, live: () => ({ ...f.live(), media: f.A._cnt.media - f.A._relc.media }) };
}
async function startRun(f, biome = 'desert') {
  f.music.setBiome(biome); f.music.setState('run'); f.medias.at(-1).emit('canplay'); await flush();
  assert.equal(f.music.cur.track.id, f.A.manifest.musicRoutes.run[biome]); return f.music.cur;
}

test('explicit full-mix routes resolve all ten stage and three boss bands without invented stems', async t => {
  const f = streamFixture(t);
  for (const biome of BIOME_ORDER) { f.music.setBiome(biome); assert.equal(f.music._pick('run', {}), f.A.manifest.musicRoutes.run[biome]); assert.equal(f.music._pick('boss', {}), f.A.manifest.musicRoutes.boss[biome]); }
  f.music.setBiome('forest'); assert.equal(f.music._pick('run', {}), f.A.manifest.musicRoutes.run.mountain);
  const bed = await startRun(f);
  assert.equal(bed.stems.length, 1); assert.equal(bed.stems[0].target, .7);
  assert.equal(bed.media.loop, true); assert.equal(bed.media.preload, 'auto'); assert.equal(bed.media.crossOrigin, 'anonymous');
  assert.equal(f.music.successor, null); assert.equal(f.loaded.length, 0);
  assert.equal(f.music.info().spb, null); assert.equal(f.music.info().bar, null);
  f.music.setIntensity(1); assert.equal(bed.stems.length, 1); assert.equal(bed.stems[0].target, .7); assert.equal(f.music._pendLayer, null);
  assert.deepEqual(f.live(), { src: 0, gain: 2, media: 1 });
  assert.equal(bed.out.connected[0], f.A.busIn.music, 'stream follows the existing ducked music bus');
});

test('stage and boss routing fades only after replacement media starts and never waits a fictitious bar', async t => {
  const f = streamFixture(t), old = await startRun(f); f.ctx.currentTime = 1;
  f.music.setState('boss'); const incoming = f.medias.at(-1);
  assert.equal(f.music.cur, old); assert.equal(old.endAt, Infinity);
  incoming.emit('canplay'); await flush();
  const boss = f.music.cur; assert.equal(boss.track.id, 'boss_suno_early');
  assert.equal(boss.fader.t0, 1); assert.ok(Math.abs(old.endAt - 2.28) < 1e-9); assert.equal(old.fader.dur, 1.2);
  assert.deepEqual(f.live(), { src: 0, gain: 4, media: 2 });
  f.advance(2.281); assert.equal(old.dead, true); assert.deepEqual(f.live(), { src: 0, gain: 2, media: 1 });
  f.music.setBiome('hell'); assert.equal(f.music.wantTrack, 'boss_suno_late'); f.medias.at(-1).emit('canplay'); await flush();
  assert.equal(f.music.cur.track.id, 'boss_suno_late');
});

test('rapid route requests coalesce during audible fading and retain at most two elements', async t => {
  const f = streamFixture(t); await startRun(f); f.ctx.currentTime = 1;
  f.music.setState('boss'); f.medias.at(-1).emit('canplay'); await flush();
  f.music.setState('garage'); f.music.setState('title');
  assert.equal(f.medias.length, 2); assert.equal(f.music.wantTrack, 'title_suno');
  f.advance(2.3); assert.equal(f.medias.length, 3); assert.equal(f.live().media, 2);
  f.medias.at(-1).emit('canplay'); await flush(); assert.equal(f.music.cur.track.id, 'title_suno'); assert.equal(f.live().media, 2);
  f.advance(3.6); assert.equal(f.live().media, 1); assert.ok(f.medias.filter(m => m.src).length <= 1);
});

test('stale readiness and stale play completion cannot restore replaced or disposed music', async t => {
  const f = streamFixture(t);
  f.music.setBiome('desert'); f.music.setState('run'); const abandoned = f.medias[0];
  abandoned.holdPlay = true; abandoned.emit('canplay'); await flush(); assert.equal(abandoned.pendingPlays.length, 1);
  f.music.setBiome('city'); const latest = f.medias[1];
  abandoned.emit('canplay'); abandoned.pendingPlays[0].resolve(); latest.emit('canplay'); await flush();
  assert.equal(f.music.cur.track.id, 'run_suno_05'); assert.equal(abandoned.paused, true); assert.equal(abandoned.src, '');
  assert.equal([...abandoned.handlers.values()].reduce((n, set) => n + set.size, 0), 0);
  f.music.setState('garage'); const stale = f.medias.at(-1); f.music.dispose(); stale.emit('canplay'); await flush();
  assert.deepEqual(f.live(), { src: 0, gain: 0, media: 0 }); assert.equal(f.music.cur, null);
  assert.ok(f.mediaNodes.every(n => n.disconnected === 1));
});

test('failed readiness and autoplay back off on the audio clock while keeping current cue audible', async t => {
  const f = streamFixture(t), old = await startRun(f); f.ctx.currentTime = 1;
  f.music.setBiome('city'); const failed = f.medias.at(-1); failed.error = { code: 4 }; failed.emit('error'); await flush();
  assert.equal(f.music.cur, old); assert.equal(old.endAt, Infinity); assert.equal(f.music._retryAt, 3);
  for (let i = 0; i < 300; i++) f.music.tick(1);
  assert.equal(f.medias.length, 2); assert.equal(f.live().media, 1);
  f.advance(3); const rejected = f.medias.at(-1); rejected.playError = new Error('Autoplay blocked'); rejected.playError.name = 'NotAllowedError'; rejected.emit('canplay'); await flush();
  assert.equal(f.music.cur, old); assert.equal(f.music._streamPending.retryAt, 5); assert.equal(f.live().media, 2);
  for (let i = 0; i < 300; i++) f.music.tick(3);
  assert.equal(rejected.playCalls, 1); rejected.playError = null; f.music.unlock(); await flush();
  assert.equal(f.music.cur.track.id, 'run_suno_05'); assert.equal(f.medias.at(-1), rejected); assert.equal(rejected.playCalls, 2);
});

test('hard pause holds media positions including a pending play while solo gameplay pause leaves music alone', async t => {
  const f = streamFixture(t), old = await startRun(f); old.media.currentTime = 71;
  f.A._paused = true; f.music.setPaused(true); assert.equal(old.media.paused, true);
  f.ctx.state = 'suspended'; f.A._paused = false; f.music.setPaused(false); await flush();
  assert.equal(old.media.paused, true); assert.equal(old.media.currentTime, 71);
  f.ctx.state = 'running'; f.music.unlock(); await flush(); assert.equal(old.media.paused, false); assert.equal(old.media.currentTime, 71);
  f.music.setState('boss'); const incoming = f.medias.at(-1); incoming.holdPlay = true; incoming.emit('canplay'); await flush();
  f.A._paused = true; f.music.setPaused(true); incoming.pendingPlays[0].resolve(); await flush();
  assert.equal(incoming.paused, true); assert.equal(f.music.cur, old); assert.ok(f.music._streamPending);
  f.A._paused = false; incoming.holdPlay = false; f.music.setPaused(false); await flush(); assert.equal(f.music.cur.track.kind, 'boss');
  const param = () => ({ cancelScheduledValues() {}, setTargetAtTime() {} });
  f.A.buses = { sfx: { gain: param() }, ambience: { gain: param() } }; f.A.volumes = { sfx: .85, ambience: .55 };
  const calls = f.medias.at(-1).pauseCalls; AudioSys.prototype.setGameplayPaused.call(f.A, true);
  assert.equal(f.medias.at(-1).pauseCalls, calls); assert.equal(f.music.cur.media.paused, false);
});

test('active media error can recover while a replacement loads without leaking an unowned request', async t => {
  const f = streamFixture(t), old = await startRun(f); f.ctx.currentTime = 1;
  f.music.setState('boss'); const pending = f.medias.at(-1);
  old.media.error = { code: 3 }; old.media.emit('error'); f.advance(1.1);
  assert.equal(f.music.cur, null); assert.equal(f.live().media, 1); assert.equal(f.music._streamPending.media, pending);
  f.advance(20); assert.equal(f.medias.length, 2); pending.emit('canplay'); await flush();
  assert.equal(f.music.cur.track.kind, 'boss'); assert.equal(f.live().media, 1);
});

test('incoming error during pending playback cannot fade the healthy audible bed even after late fulfillment', async t => {
  const f = streamFixture(t), old = await startRun(f); f.ctx.currentTime = 1;
  f.music.setState('boss'); const incoming = f.medias.at(-1); incoming.holdPlay = true; incoming.emit('canplay'); await flush();
  incoming.error = { code: 3 }; incoming.emit('error'); await flush();
  assert.equal(f.music.cur, old); assert.equal(old.endAt, Infinity); assert.equal(f.music.fading.length, 0);
  assert.equal(f.music._streamPending, null); assert.equal(f.live().media, 1); assert.equal(f.music._retryAt, 3);
  incoming.pendingPlays[0].resolve(); await flush();
  assert.equal(f.music.cur, old); assert.equal(incoming.paused, true); assert.equal(incoming.src, '');
});

test('synchronous pause and resume starts a fresh owned play without the cancelled promise delaying it', async t => {
  const f = streamFixture(t), old = await startRun(f); old.media.holdPlay = true;
  f.music.setPaused(true); f.music.setPaused(false); const pending = old._playPending;
  assert.ok(pending); assert.equal(old.media.pendingPlays.length, 1);
  f.music.setPaused(true); f.music.setPaused(false);
  assert.notEqual(old._playPending, pending); assert.equal(old.media.pendingPlays.length, 2);
  old.media.pendingPlays[1].resolve(); await flush(); assert.equal(old.media.paused, false);
  old.media.pendingPlays[0].resolve(); await flush(); assert.equal(old.media.paused, false); assert.equal(old._playPending, null);
});

test('independent context interruption cancels pending play safely and preserves the same ready cue', async t => {
  const f = streamFixture(t), old = await startRun(f); old.media.currentTime = 51;
  f.music.setState('boss'); const incoming = f.medias.at(-1); incoming.holdPlay = true; incoming.abortOnPause = true;
  incoming.emit('canplay'); await flush(); const pending = f.music._streamPending;
  f.ctx.state = 'interrupted'; f.music.setContextSuspended(true); await flush();
  assert.equal(old.media.paused, true); assert.equal(old.media.currentTime, 51);
  assert.equal(f.music._streamPending, pending); assert.equal(pending.dead, false); assert.equal(f.music._streamStarting, false);
  incoming.holdPlay = false; f.ctx.state = 'running'; f.music.setContextSuspended(false); await flush();
  assert.equal(f.music.cur, pending); assert.equal(f.medias.length, 2); assert.equal(incoming.playCalls, 2);
});

test('never-settling start and resume play promises time out without losing current music or retaining nodes', async t => {
  const f = streamFixture(t), old = await startRun(f); f.ctx.currentTime = 1; f.A.opts.mediaPlayTimeoutMs = 5;
  f.music.setState('boss'); const incoming = f.medias.at(-1); incoming.holdPlay = true; incoming.emit('canplay'); await flush();
  assert.equal(f.music._streamStarting, true);
  await new Promise(resolve => setTimeout(resolve, 12)); await flush();
  assert.equal(f.music.cur, old); assert.equal(old.dead, false); assert.equal(old.endAt, Infinity);
  assert.equal(f.music._streamPending, null); assert.equal(f.music._loadPending, false); assert.equal(f.music._retryAt, 3);
  assert.equal(f.live().media, 1); incoming.pendingPlays[0].resolve(); await flush(); assert.equal(incoming.paused, true);
  old.media.currentTime = 44; f.A._paused = true; f.music.setPaused(true); old.media.holdPlay = true;
  f.A._paused = false; f.music.setPaused(false); await new Promise(resolve => setTimeout(resolve, 12)); await flush();
  assert.equal(f.music.cur, old); assert.equal(old.media.currentTime, 44); assert.equal(old._playPending, null); assert.equal(f.live().media, 1);
  old.media.holdPlay = false; f.music.unlock(); await flush(); assert.equal(old.media.paused, false); assert.equal(old.media.currentTime, 44);
});

test('victory end and repeated stop/dispose retire every stream and node exactly once', async t => {
  const f = streamFixture(t); f.music.setState('victory'); f.medias.at(-1).emit('canplay'); await flush();
  const victory = f.music.cur; assert.equal(victory.loop, false); assert.equal(victory.media.loop, false);
  const plays = victory.media.playCalls;
  victory.media.currentTime = 180; victory.media.emit('ended'); f.advance(181);
  assert.equal(victory.media.playCalls, plays, 'an ended media cue cannot restart before retirement');
  assert.equal(f.music.cur, null); assert.equal(f.music.wantTrack, null); assert.deepEqual(f.live(), { src: 0, gain: 0, media: 0 });
  f.advance(300); assert.equal(f.medias.length, 1);
  await startRun(f); f.music.stop(.2); f.advance(300.3); f.music.dispose(); f.music.dispose();
  assert.deepEqual(f.live(), { src: 0, gain: 0, media: 0 }); assert.ok(f.mediaNodes.every(n => n.disconnected === 1));
});

test('streamed definitions never enter broad AudioBuffer preload, variation loading or one-shot voices', async t => {
  const f = streamFixture(t); f.music.setBiome('desert'); await f.music.preload(['run', 'boss', 'title']); assert.equal(f.loaded.length, 1); assert.equal(f.loaded[0].defs.length, 0); assert.equal(f.medias.length, 0);
  const load = audioLoadFixture(); load.def.meta = { streaming: true };
  await load.audio.load(load.def); await load.audio._loadVar(load.def, 0);
  assert.equal(load.counts.variations, 1, 'only the explicitly invoked variation wrapper ran'); assert.equal(load.audio._queue.length, 0); assert.equal(load.decoders.length, 0);
  assert.equal(AudioSys.prototype.play.call(load.audio, load.def, { loop: true }).isNull, true);
});

test('production Suno manifest declares single complete mixes and real files for every ten-level route', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/audio/manifest.json', import.meta.url)));
  const defs = Object.values(manifest.sounds).filter(d => d.streaming);
  const tracks = new Map(defs.map(d => [d.track, d]));
  for (const kind of ['run', 'boss']) for (const biome of BIOME_ORDER) {
    const id = manifest.musicRoutes[kind][biome], d = tracks.get(id); assert.ok(d, kind + '/' + biome); assert.equal(d.kind, kind); assert.equal(d.loop, true);
  }
  for (const kind of ['title', 'garage', 'victory']) assert.equal(tracks.get(manifest.musicRoutes[kind]).kind, kind);
  assert.equal(tracks.get(manifest.musicRoutes.victory).loop, false);
  assert.equal(new Set(defs.map(d => d.file)).size, 12);
  const assetHashes = new Map();
  for (const d of defs) {
    assert.equal(d.stem, 'base'); assert.equal(d.intensity, 0); assert.equal(d.channels, 2); assert.ok(d.duration > 10); assert.ok(d.gain > 0 && d.gain <= 1);
    assert.equal(d.files.length, 1); assert.equal(d.files[0], d.file); assert.equal(defs.filter(other => other.track === d.track).length, 1);
    assert.equal(d.bars, undefined); assert.equal(d.secPerBar, undefined);
    const file = new URL('../public/audio/' + d.file, import.meta.url);
    assert.ok(fs.statSync(file).size > 100000);
    if (!assetHashes.has(d.file)) assetHashes.set(d.file, createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    assert.match(d.sha256, /^[a-f0-9]{64}$/i); assert.equal(assetHashes.get(d.file), d.sha256.toLowerCase());
    assert.ok(d.sourceFilename && d.displayTitle);
  }
});

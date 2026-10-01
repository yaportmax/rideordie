import { AudioSys, MusicSys } from '../../src/core/audio.js';

export const MUSIC_BIOMES = ['desert', 'canyon', 'coast', 'mountain', 'city', 'dam'];
export const musicTrack = (biome) => `run_${String(MUSIC_BIOMES.indexOf(biome) + 1).padStart(2, '0')}_${biome}`;
export const MUSIC_BAR = 240 / 174;
export const MUSIC_DURATION = 32 * MUSIC_BAR;

function parameter() {
  return { value: 0, events: [], cancelScheduledValues(t) { this.events.push(['cancel', t]); },
    cancelAndHoldAtTime(t) { this.events.push(['hold', t]); }, setValueAtTime(v, t) { this.events.push(['value', v, t]); },
    linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); }, setTargetAtTime(v, t, tau) { this.events.push(['target', v, t, tau]); } };
}
function node() {
  return { gain: parameter(), starts: [], stops: [], connected: [], disconnected: 0,
    connect(n) { this.connected.push(n); }, disconnect() { this.disconnected++; },
    start(when, offset) { this.starts.push([when, offset]); }, stop(when) { this.stops.push(when); } };
}

/** Production MusicSys over counted audio nodes. Playback quality needs native audition. */
export function musicFixture({ ready = true, notesOnly = false } = {}) {
  const ctx = { currentTime: 0 }, sources = [], gains = [], deferred = [], unloaded = [], loaded = [];
  const A = {
    ctx, defs: new Map(), busIn: { music: {} }, missing: new Map(), rand: () => .5,
    _cnt: { src: 0, gain: 0 }, _relc: { src: 0, gain: 0 },
    _gain(v) { const n = node(); n.gain.value = v; gains.push(n); this._cnt.gain++; return n; },
    _src() { const n = node(); sources.push(n); this._cnt.src++; return n; },
    _rel(k) { this._relc[k]++; }, _free(n, k) { n.disconnect(); this._relc[k]++; },
    _pickBuf(def) { return def.bufs[0] || null; },
    unload(def) { unloaded.push(def.key); AudioSys.prototype.unload.call(this, def); },
    defInUse(def) { return AudioSys.prototype.defInUse.call(this, def); },
    load(defs, priority) { loaded.push({ defs, priority }); return Promise.resolve(defs); },
    whenReady(defs, priority, cb) {
      if (defs.every((d) => d.bufs[0])) cb();
      else {
        const storage = defs.map((d) => { if (!d.bufs[0]) d.loading[0] = {}; return { buffers: d.bufs, loading: d.loading }; });
        deferred.push({ defs, priority, cb, storage });
      }
    },
  };
  const buffer = (duration = MUSIC_DURATION) => ({ duration, length: Math.round(duration * 44100), numberOfChannels: 2, sampleRate: 44100 });
  const add = (id, biome, stem, looping = true) => {
    const def = { key: `music/${id}_${stem}`, name: `${id}_${stem}`, group: 'music', category: 'music_stem',
      gain: .5, loop: looping, bufs: ready ? [buffer()] : [], loading: [], voices: [],
      meta: { track: id, stem, bpm: 174, bars: 32, secPerBar: MUSIC_BAR, intensity: stem === 'base' ? 0 : 1,
        ...(notesOnly ? { notes: biome ? `RUN (${biome})` : '' } : { biomes: biome ? [biome] : [] }) } };
    A.defs.set(def.key, def);
  };
  for (const biome of MUSIC_BIOMES) for (const stem of ['base', 'extra']) add(musicTrack(biome), biome, stem);
  for (const stem of ['base', 'extra']) add('boss_dnb', null, stem);
  for (const kind of ['title', 'garage', 'victory']) add(kind, null, 'base', kind !== 'victory');
  A.music = new MusicSys(A); A.music._rebuild();
  const defsFor = (id) => [...A.defs.values()].filter((d) => d.meta.track === id);
  const decode = (id) => { for (const def of defsFor(id)) def.bufs[0] = buffer(); };
  const fulfill = (rec) => {
    rec.defs.forEach((def, i) => {
      if (def.bufs === rec.storage[i].buffers && def.loading === rec.storage[i].loading) { def.bufs[0] = buffer(); def.loading[0] = null; }
    });
    rec.cb();
  };
  const live = () => ({ src: A._cnt.src - A._relc.src, gain: A._cnt.gain - A._relc.gain });
  const advance = (t) => { ctx.currentTime = t; A.music.tick(t); };
  return { A, music: A.music, ctx, sources, gains, deferred, unloaded, loaded, defsFor, decode, fulfill, live, advance };
}

import { AudioSys, LoopLayer } from '../../src/core/audio.js';

export function audioLoadFixture({ variations = 1, Class = AudioSys, Layer = LoopLayer } = {}) {
  const parameter = () => ({ value: 0, targets: [], setTargetAtTime(value, time, tau) { this.targets.push({ value, time, tau }); } });
  const node = () => ({ gain: parameter(), playbackRate: parameter(), starts: [], stops: [], connections: [], disconnected: 0,
    connect(dest) { this.connections.push(dest); }, disconnect() { this.disconnected++; },
    start(time, offset) { this.starts.push({ time, offset }); }, stop(time) { this.stops.push(time); } });
  const decoders = [], sources = [], gains = [];
  const context = { currentTime: 0, createGain() { const n = node(); gains.push(n); return n; },
    createBufferSource() { const n = node(); sources.push(n); return n; },
    decodeAudioData(bytes) { return new Promise((resolve, reject) => decoders.push({ bytes: [...new Uint8Array(bytes)], resolve, reject })); },
  };
  const def = { key: 'vehicles/test_loop', sig: 'initial', gain: .75, urls: Array.from({ length: variations }, (_, i) => `data:audio/ogg;base64,${Buffer.from([i]).toString('base64')}`), bufs: [], loading: [], failed: [], waiters: [], last: -1 };
  const audio = Object.assign(Object.create(Class.prototype), { ctx: context, rand: () => .25, _queue: [], _active: 0, _maxActive: 4, _seq: 0,
    stats: { failed: 0, fetched: 0, fetchedBytes: 0 }, _cnt: { src: 0, gain: 0 }, _relc: { src: 0, gain: 0 }, resolve: () => def,
  });
  const counts = { loads: 0, variations: 0, priorities: [] }, load = audio.load, variation = audio._loadVar;
  audio.load = function (...args) { counts.loads++; counts.priorities.push(args[1]); return load.apply(this, args); };
  audio._loadVar = function (...args) { counts.variations++; return variation.apply(this, args); };
  const layers = [], makeLayer = () => { const l = new Layer(audio, def, {}); layers.push(l); return l; };
  return { audio, def, context, decoders, sources, gains, counts, layers, makeLayer };
}

export async function until(predicate, label = 'async audio loader') {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 0)); }
  throw new Error(label + ' did not settle');
}

export function resolveAll(fixture, duration = 2) {
  for (const decoder of fixture.decoders) decoder.resolve({ duration });
}

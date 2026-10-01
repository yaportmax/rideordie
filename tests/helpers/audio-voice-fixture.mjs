import { AudioSys, Listener } from '../../src/core/audio.js';

function parameter() {
  return { value: 0, setTargetAtTime() {}, cancelScheduledValues() {} };
}
function node() {
  return {
    gain: parameter(), playbackRate: parameter(), frequency: parameter(), Q: parameter(),
    positionX: parameter(), positionY: parameter(), positionZ: parameter(),
    stops: [], connect() {}, disconnect() {}, start() {},
    stop(when) { this.stops.push(when); }, finish() { this.onended?.(); },
  };
}
export function audioVoiceFixture({ cap = 2, maxVoices = 64 } = {}) {
  const audio = Object.assign(Object.create(AudioSys.prototype), {
    ctx: { state: 'running', currentTime: 1, createGain: node, createBufferSource: node, createBiquadFilter: node, createPanner: node },
    rand: () => .5, baseUrl: '', defs: new Map(), byBare: new Map(), engineTable: new Map(), engines: new Map(),
    music: { _rebuild() {} }, missing: new Map(), notLoadedNames: new Set(), expected: new Set(),
    voices: new Set(), _dyn: new Set(), maxVoices, _timer: true, offline: false,
    stats: { played: 0, culled: 0, stolen: 0, notLoaded: 0, dropped: 0 },
    _cnt: { gain: 0, src: 0, filter: 0, panner: 0 }, _relc: { gain: 0, src: 0, filter: 0, panner: 0 },
    busIn: { sfx: {} }, reverbIn: {},
  });
  audio.listener = new Listener(audio);
  const add = (key, category = 'explosion_loop') => {
    const def = audio.injectSound(key, { duration: 2, numberOfChannels: 1, length: 2000 }, { category });
    def.cap = cap;
    return def;
  };
  const def = add('explosions/fire_loop');
  const play = (distance, opts = {}, sound = def) => audio.play(sound, { loop: true, pos: [distance, 0, 0], pitchVar: 0, ...opts });
  const finish = () => { for (const sound of audio.defs.values()) for (const voice of [...sound.voices]) voice.src?.finish(); };
  return { audio, def, add, play, finish };
}

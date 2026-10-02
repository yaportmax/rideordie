// RIDE OR DIE audio engine (WebAudio). No dependency on Three.js; positions are [x,y,z] arrays or {x,y,z} objects.
//
//   const audio = new AudioSys(camera);  await audio.init('/audio/manifest.json');   // call audio.unlock() from any click/key
//   per frame:  audio.listener.update(camera, camVelocity);  audio.update(dt);
//   audio.play('guns/fire_pistol', { pos, gain, pitch, pitchVar, loop, bus });        // -> handle {stop,setGain,setPitch,setPos}
//   const eng = audio.engine(carId, spec);  eng.update(rpm01, load, boost, dist, speed, { pos, vel, slip, surface, ... });
//   audio.music.setState('run'); audio.music.setIntensity(0.6); audio.ambience.setBiome('desert'); audio.ambience.wind(0.5);
//   audio.ui('click'); audio.stinger('game_over'); audio.duck(0.6); audio.concussion(0.8); audio.setDanger(0.5);
//
// Everything is driven by public/audio/manifest.json which is read at runtime (and can be re-read: audio.refreshManifest()).
// A name that is not in the manifest is silently skipped (and recorded in audio.missing).
// All parameter changes use setTargetAtTime / ramps (no gain discontinuities); every dynamic node goes through the counted
// factories (_gain/_src/_filter/_panner) so audio.graphStats() can prove that nothing leaks.
import { clamp, lerp, smoothstep } from './util.js';
import { StreamingMusicBed } from './music_stream.js';

const C_SOUND = 343;
const PI = Math.PI;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Per-category defaults: voice cap, steal priority, panner reference distance (m), slapback send. */
const CAT = {
  gun_fire: { cap: 6, prio: 0.9, ref: 8, slap: 0.3 },
  gun_enemy: { cap: 8, prio: 0.6, ref: 10, slap: 0.4 },
  gun_foley: { cap: 4, prio: 0.4, ref: 2, slap: 0 },
  gun_loop: { cap: 6, prio: 0.7, ref: 10, slap: 0 },
  impact_bullet: { cap: 8, prio: 0.55, ref: 3, slap: 0.12 },
  impact_ui: { cap: 3, prio: 0.8, ref: 1, slap: 0 },
  impact_car: { cap: 4, prio: 0.85, ref: 10, slap: 0.25 },
  impact_misc: { cap: 5, prio: 0.4, ref: 4, slap: 0.1 },
  impact_loop: { cap: 4, prio: 0.5, ref: 6, slap: 0 },
  explosion: { cap: 5, prio: 1, ref: 28, slap: 0.45 },
  explosion_loop: { cap: 6, prio: 0.5, ref: 8, slap: 0 },
  engine: { cap: 60, prio: 0.6, ref: 8, slap: 0 },
  vehicle_loop: { cap: 40, prio: 0.5, ref: 8, slap: 0 },
  vehicle_fx: { cap: 4, prio: 0.6, ref: 8, slap: 0 },
  ui: { cap: 4, prio: 1, ref: 1, slap: 0, bus: 'ui' },
  stinger: { cap: 2, prio: 1, ref: 1, slap: 0, bus: 'stinger' },
  stinger_loop: { cap: 2, prio: 0.8, ref: 1, slap: 0, bus: 'sfx' },
  ambience: { cap: 8, prio: 0.3, ref: 1, slap: 0, bus: 'ambience' },
  music: { cap: 8, prio: 1, ref: 1, slap: 0, bus: 'music' },
  music_stem: { cap: 8, prio: 1, ref: 1, slap: 0, bus: 'music' },
};
const CAT_DEFAULT = { cap: 6, prio: 0.5, ref: 6, slap: 0 };
const CAP_BY_NAME = { hit_marker: 2, hit_marker_kill: 2, headshot_ping: 2, dry_click: 2, bullet_metal: 10, bullet_whizz: 4, fire_loop: 8, fire_crackle_loop: 4, debris_bounce: 4, shell_drop_brass: 3, shell_drop_shotgun: 3, hover: 2, click: 3 };

const STAGE_DEFAULT_RPM = { idle: 900, low: 2200, mid: 3600, high: 5200, redline: 6500 };

/** Which manifest engine each vehicle spec uses, plus per-car engine character (turbo / blower / backfire / pitch / level). */
const ENGINE_MAP = {
  truck_t1: 'engine_player_t1', truck_t2: 'engine_player_t2', truck_t3: 'engine_player_t3', truck_t4: 'engine_player_t4',
  e_sedan: 'engine_sedan', e_muscle: 'engine_muscle', e_buggy: 'engine_buggy',
  e_technical: 'engine_diesel', e_van: 'engine_diesel', e_heavy: 'engine_diesel', e_tanker: 'engine_diesel',
};
const ENGINE_OPTS = {
  truck_t1: { backfire: 0, level: 0.75 }, truck_t2: { backfire: 0.35, level: 0.75 }, truck_t3: { turbo: true, backfire: 0.5, level: 0.75 },
  truck_t4: { supercharger: 0.45, backfire: 0.6, level: 0.75 },
  e_sedan: { level: 0.62 }, e_muscle: { supercharger: 0.5, backfire: 0.5, level: 0.68 }, e_buggy: { backfire: 0.35, level: 0.62 },
  e_technical: { turbo: true, pitch: 1.2, level: 0.66 }, e_van: { level: 0.68 }, e_heavy: { pitch: 0.86, level: 0.75 }, e_tanker: { pitch: 0.8, level: 0.75 },
};

// ------------------------------------------------------------------------------------------------------------ helpers
const _isArr = Array.isArray;
function setVec(out, p) { if (_isArr(p)) { out.x = p[0]; out.y = p[1]; out.z = p[2]; } else { out.x = p.x; out.y = p.y; out.z = p.z; } return out; }
function setParam(p, v) { p.value = v; }
function hasDecodedVariation(def) {
  for (let i = 0; i < def.urls.length; i++) if (def.bufs[i]) return true;
  return false;
}
/** Distance -> lowpass cutoff (air absorption + terrain masking). */
export function airCutoff(d, scale = 1) { return clamp(20000 * Math.exp(-Math.max(0, d - 15) / (95 * scale)), 700, 20000); }
/** PannerNode 'inverse' model gain. */
export function attGain(d, ref, roll = 1) { return d <= ref ? 1 : ref / (ref + roll * (d - ref)); }

/** Tracks one AudioParam that is only ever driven by equal-power ramps, so the value at any time is known analytically
 *  (lets overlapping / re-targeted crossfades start from the right value without reading the param). */
export class Fader {
  constructor(A, param, init = 0) { this.A = A; this.p = param; this.v0 = init; this.v1 = init; this.t0 = 0; this.dur = 0; param.value = init; }
  valueAt(t) {
    if (this.dur <= 0 || t >= this.t0 + this.dur) return this.v1;
    if (t <= this.t0) return this.v0;
    const x = (t - this.t0) / this.dur;
    return this.v1 > this.v0 ? this.v0 + (this.v1 - this.v0) * Math.sin(x * PI / 2) : this.v1 + (this.v0 - this.v1) * Math.cos(x * PI / 2);
  }
  /** Equal-power (quarter sine) fade to `target` over `dur` s starting at `when` (default now). */
  to(target, dur, when) {
    const now = this.A.ctx.currentTime, t0 = Math.max(when ?? now, now), p = this.p;
    const from = this.valueAt(t0);
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t0); else p.cancelScheduledValues(t0);
    p.setValueAtTime(from, t0);
    const d = Math.max(dur, 0.004), N = d > 0.05 ? 16 : 1, up = target > from;
    for (let k = 1; k <= N; k++) {
      const x = k / N;
      const v = up ? from + (target - from) * Math.sin(x * PI / 2) : target + (from - target) * Math.cos(x * PI / 2);
      p.linearRampToValueAtTime(v, t0 + d * x);
    }
    this.v0 = from; this.v1 = target; this.t0 = t0; this.dur = d;
    return this;
  }
}

// ------------------------------------------------------------------------------------------------------------ null handle
export const NULL_HANDLE = Object.freeze({
  isNull: true, playing: false, stop() {}, setGain() {}, setPitch() {}, setPos() {}, setLowpass() {},
});

// ------------------------------------------------------------------------------------------------------------ Voice (sound instance)
/** One playing sound instance. Also the handle returned by audio.play(). */
export class Voice {
  constructor(A, def, o, dist) {
    this.A = A; this.def = def; this.o = o;
    this.ended = false; this.stopped = false; this.src = null; this.startTime = 0; this.endEst = Infinity;
    this.loop = !!o.loop;
    this.bus = o.bus || def.bus;
    this.userGain = o.gain ?? 1;
    this.baseGain = this.userGain * (o.raw ? 1 : def.gain);
    this.pitch = (o.pitch ?? 1) * (1 + (A.rand() * 2 - 1) * (o.pitchVar ?? 0.05));
    this.when = A.ctx.currentTime + (o.delay || 0);
    this.pos = null; this.vel = null; this.dynamic = false;
    this.gainNode = A._gain(this.baseGain);
    let tail = this.gainNode;
    const cat = def.cat;
    if (o.pos) {
      this.pos = setVec({ x: 0, y: 0, z: 0 }, o.pos);
      if (o.vel) { this.vel = setVec({ x: 0, y: 0, z: 0 }, o.vel); }
      this.dynamic = !!(o.vel || o.dynamic || this.loop || def.duration > 0.6);
      this.airScale = o.airAbsorb ?? 1;
      this.ref = o.refDist ?? cat.ref;
      this.rolloff = o.rolloff ?? 1;
      if (o.lowpass !== undefined || this.dynamic || dist > 15) {
        this.lp = A._filter('lowpass', o.lowpass ?? airCutoff(dist, this.airScale), 0.5);
        tail.connect(this.lp); tail = this.lp;
      }
      this.pan = A._panner(this.ref, this.rolloff);
      setParam(this.pan.positionX, this.pos.x); setParam(this.pan.positionY, this.pos.y); setParam(this.pan.positionZ, this.pos.z);
      tail.connect(this.pan); tail = this.pan;
    } else if (o.lowpass !== undefined) {
      this.lp = A._filter('lowpass', o.lowpass, 0.5); tail.connect(this.lp); tail = this.lp;
    }
    tail.connect(A.busIn[this.bus] || A.busIn.sfx);
    this.slap = o.slap ?? cat.slap ?? 0;
    if (this.slap > 0 && !o.noSlap) {
      this.send = A._gain(this.pos ? this.slap * clamp(0.45 + dist / 90, 0.45, 2.2) : this.slap);
      tail.connect(this.send); this.send.connect(A.reverbIn);
    }
    this._rescore(dist);
    this.age0 = A.ctx.currentTime;
  }
  get playing() { return !this.ended && !this.stopped; }

  /** Attach a decoded buffer and start (called immediately, or later for lazily-loaded loops). */
  attach(buf) {
    const A = this.A, c = A.ctx;
    if (this.ended || this.stopped) { this._cleanup(); return; }
    const src = A._src(); src.buffer = buf;
    src.playbackRate.value = clamp(this.pitch * this._dop(), 0.05, 8);
    if (this.loop) { src.loop = true; src.loopStart = 0; src.loopEnd = buf.duration; }
    src.connect(this.gainNode);
    const when = Math.max(c.currentTime, this.when);
    const off = this.o.offset ?? (this.loop && this.o.randomOffset ? A.rand() * buf.duration : 0);
    src.start(when, off);
    src.onended = () => this._cleanup();
    this.src = src; this.startTime = when; this.dur = buf.duration;
    this.endEst = this.loop ? Infinity : when + buf.duration / 0.4 + 0.5;
    if (this.o.fadeIn > 0) { this.gainNode.gain.value = 0; this.gainNode.gain.setTargetAtTime(this.baseGain, when, this.o.fadeIn / 4); }
    if (this.o.duration && this.o.duration > 0) this.stop(this.o.fadeOut ?? 0.05, when + this.o.duration);
  }
  _dop() { return this.vel && this.pos ? this.A.doppler(this.pos, this.vel) : 1; }

  /** Stop with a short fade (never a hard cut). `at` optionally schedules the stop in the future. */
  stop(fade = 0.03, at) {
    if (this.ended) return;
    const c = this.A.ctx, now = c.currentTime;
    if (at !== undefined && at > now + 0.01) {
      // scheduled stop: fade starts at `at`
      if (this.src) { this.gainNode.gain.setTargetAtTime(0, at, Math.max(0.003, fade / 4)); try { this.src.stop(at + fade + 0.03); } catch { /* not started */ } this.endEst = at + fade + 0.5; }
      return;
    }
    if (this.stopped) return;
    this.stopped = true;
    if (!this.src) { this._cleanup(); return; }
    if (this.startTime > now + 0.005) { try { this.src.stop(now); } catch { /* */ } this._cleanup(); return; }
    const g = this.gainNode.gain; g.cancelScheduledValues(now); g.setTargetAtTime(0, now, Math.max(0.003, fade / 4));
    try { this.src.stop(now + fade + 0.03); } catch { /* */ }
    this.endEst = now + fade + 0.5;
  }
  setGain(g, tau = 0.03) {
    if (this.ended) return; this.userGain = g; this.baseGain = g * (this.o.raw ? 1 : this.def.gain);
    this.gainNode.gain.setTargetAtTime(this.baseGain, this.A.ctx.currentTime, tau);
    this._rescore();
  }
  setPitch(p, tau = 0.03) {
    if (this.ended) return; this.pitch = p;
    if (this.src) this.src.playbackRate.setTargetAtTime(clamp(p * this._dop(), 0.05, 8), this.A.ctx.currentTime, tau);
  }
  setLowpass(fc, tau = 0.05) { if (this.lp && !this.ended) this.lp.frequency.setTargetAtTime(fc, this.A.ctx.currentTime, tau); }
  /** Move a positional voice (call every frame for moving sources). */
  setPos(p, v) {
    if (this.ended || !this.pan) return;
    setVec(this.pos, p); if (v) { if (!this.vel) this.vel = { x: 0, y: 0, z: 0 }; setVec(this.vel, v); }
    setParam(this.pan.positionX, this.pos.x); setParam(this.pan.positionY, this.pos.y); setParam(this.pan.positionZ, this.pos.z);
    if (!this.dynamic) { this.dynamic = true; this.A._dyn.add(this); }
    this._spatial(this.A.ctx.currentTime);
  }
  _spatial(now) {
    if (this.ended || !this.pos) return;
    const A = this.A, d = A.listener.distTo(this.pos);
    this._rescore(d);
    if (this.lp && this.o.lowpass === undefined) this.lp.frequency.setTargetAtTime(airCutoff(d, this.airScale), now, 0.06);
    if (this.send) this.send.gain.setTargetAtTime(this.slap * clamp(0.45 + d / 90, 0.45, 2.2), now, 0.08);
    if (this.vel && this.src) this.src.playbackRate.setTargetAtTime(clamp(this.pitch * A.doppler(this.pos, this.vel), 0.05, 8), now, 0.05);
  }
  _rescore(dist) {
    this.score = (this.def.cat.prio ?? 0.5) * this.baseGain * (this.pos ? attGain(dist ?? this.A.listener.distTo(this.pos), this.ref, this.rolloff) : 1);
  }
  _cleanup() {
    if (this.ended) return; this.ended = true;
    const A = this.A;
    A._voiceEnded(this);
    if (this.src) { this.src.onended = null; try { this.src.disconnect(); } catch { /* */ } A._rel('src'); this.src = null; }
    A._free(this.gainNode, 'gain');
    if (this.lp) A._free(this.lp, 'filter');
    if (this.pan) A._free(this.pan, 'panner');
    if (this.send) A._free(this.send, 'gain');
  }
}

// ------------------------------------------------------------------------------------------------------------ LoopLayer
/** A lazily created looping source with a persistent gain node; released after it has been silent for a while. */
export class LoopLayer {
  constructor(A, nameOrDef, dest, opts = {}) {
    this.A = A; this.dest = dest; this.name = typeof nameOrDef === 'string' ? nameOrDef : nameOrDef?.key;
    this.def = typeof nameOrDef === 'string' ? A.resolve(nameOrDef) : nameOrDef;
    this.src = null; this.gain = null; this.idleSince = -1; this.cur = 0;
    const pr = this.def?.meta?.pitchRange;
    this.rMin = opts.rMin ?? (pr ? pr[0] * 0.8 : 0.25); this.rMax = opts.rMax ?? (pr ? pr[1] * 1.2 : 4);
    this.randomOffset = opts.randomOffset !== false;
  }
  get active() { return !!this.src; }
  _start() {
    const A = this.A, d = this.def;
    // Share the cold request across all layers using this definition. A first
    // decoded variation is playable even while the remaining variations load.
    if (!hasDecodedVariation(d)) { A._requestLoopLoad(d); return false; }
    const buf = A._pickBuf(d);
    if (!buf) return false;
    if (!this.gain) { this.gain = A._gain(0); this.gain.connect(this.dest); }
    const src = A._src(); src.buffer = buf; src.loop = true; src.loopStart = 0; src.loopEnd = buf.duration;
    src.connect(this.gain);
    src.start(A.ctx.currentTime, this.randomOffset ? A.rand() * buf.duration : 0);
    this.src = src; this._lg = undefined; this._lr = undefined; return true;
  }
  /** g = linear gain (def.gain is applied on top), rate = playbackRate, tau = smoothing seconds. */
  set(g, rate = 1, tau = 0.05) {
    if (!this.def) return;
    const now = this.A.ctx.currentTime, gg = g * this.def.gain;
    if (!this.src && g > 0.004) this._start();
    if (this.src) {
      const r = clamp(rate, this.rMin, this.rMax);
      if (this._lg === undefined || Math.abs(gg - this._lg) > 0.0015 + 0.01 * gg) { this._lg = gg; this.gain.gain.setTargetAtTime(gg, now, tau); }
      if (this._lr === undefined || Math.abs(r - this._lr) > 0.0015 * r) { this._lr = r; this.src.playbackRate.setTargetAtTime(r, now, Math.max(0.02, tau)); }
    }
    this.cur = g;
    if (g <= 0.003) {
      if (this.idleSince < 0) this.idleSince = now;
      else if (this.src && now - this.idleSince > 0.7) this._stop();
    } else this.idleSince = -1;
  }
  _stop() {
    if (!this.src) return;
    const A = this.A;
    try { this.src.stop(); } catch { /* */ }
    try { this.src.disconnect(); } catch { /* */ }
    A._rel('src'); this.src = null;
  }
  /** Fade to silence and stop the source (does not need further set() calls). */
  fadeStop(fade = 0.3) {
    if (!this.src) return;
    this.set(0, this._lr ?? 1, fade / 3);
    this.A._later(fade + 0.1, () => { if (this.cur <= 0.003) this._stop(); });
  }
  release() {
    this._stop();
    if (this.gain) { this.A._free(this.gain, 'gain'); this.gain = null; }
    this.idleSince = -1; this.cur = 0;
  }
}

// ------------------------------------------------------------------------------------------------------------ Listener
export class Listener {
  constructor(A) {
    this.A = A;
    this.pos = { x: 0, y: 0, z: 0 }; this.vel = { x: 0, y: 0, z: 0 };
    this.fwd = { x: 0, y: 0, z: 1 }; this.up = { x: 0, y: 1, z: 0 };
    this._matrixPos = { x: 0, y: 0, z: 0 }; this._matrixFwd = { x: 0, y: 0, z: 1 }; this._matrixUp = { x: 0, y: 1, z: 0 };
    this._init = false;
  }
  /** camera: THREE.Camera (uses matrixWorld); vel: THREE.Vector3 | [x,y,z] | undefined (then derived from motion). */
  update(camera, vel) {
    if (!camera) return this;
    // Audio needs the camera and its ancestors, not the attached weapon rig.
    if (camera.updateWorldMatrix) camera.updateWorldMatrix(true, false);
    else if (camera.updateMatrixWorld) camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const p = this._matrixPos, f = this._matrixFwd, u = this._matrixUp;
    p.x = e[12]; p.y = e[13]; p.z = e[14];
    f.x = -e[8]; f.y = -e[9]; f.z = -e[10];
    u.x = e[4]; u.y = e[5]; u.z = e[6];
    this.setRaw(p, f, u, vel);
    return this;
  }
  setRaw(pos, fwd, up, vel) {
    const dt = Math.max(this.A.dt || 1 / 60, 1e-3);
    if (vel) setVec(this.vel, vel);
    else if (this._init) { this.vel.x = (pos.x - this.pos.x) / dt; this.vel.y = (pos.y - this.pos.y) / dt; this.vel.z = (pos.z - this.pos.z) / dt; }
    setVec(this.pos, pos); setVec(this.fwd, fwd); setVec(this.up, up || this.up);
    this._init = true;
    const l = this.A.ctx.listener;
    if (l.positionX) {
      setParam(l.positionX, this.pos.x); setParam(l.positionY, this.pos.y); setParam(l.positionZ, this.pos.z);
      setParam(l.forwardX, this.fwd.x); setParam(l.forwardY, this.fwd.y); setParam(l.forwardZ, this.fwd.z);
      setParam(l.upX, this.up.x); setParam(l.upY, this.up.y); setParam(l.upZ, this.up.z);
    } else { l.setPosition(this.pos.x, this.pos.y, this.pos.z); l.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z); }
    return this;
  }
  distTo(p) {
    const x = _isArr(p) ? p[0] : p.x, y = _isArr(p) ? p[1] : p.y, z = _isArr(p) ? p[2] : p.z;
    const dx = x - this.pos.x, dy = y - this.pos.y, dz = z - this.pos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

// ------------------------------------------------------------------------------------------------------------ LoopBed (music / ambience)
/** A set of aligned looping stems with a shared equal-power fader. All stems start at `when` so they stay phase-locked. */
class LoopBed {
  constructor(A, items, dest, when, fadeIn, o = {}) {
    this.A = A; this.dead = false; this.endAt = Infinity; this.loop = o.loop !== false;
    this.out = A._gain(0); this.out.connect(dest); this.fader = new Fader(A, this.out.gain, 0);
    const off = o.randomOffset ? A.rand() * items[0].buf.duration : 0;
    this.stems = items.map((it) => {
      const g = A._gain(it.gain), src = A._src();
      src.buffer = it.buf; src.loop = this.loop;
      if (this.loop) { src.loopStart = 0; src.loopEnd = it.buf.duration; }
      src.connect(g); g.connect(this.out); src.start(when, off);
      return { src, g, key: it.key, layer: it.layer ?? 0, target: it.gain, def: it.def, name: it.name };
    });
    this.t0 = when - off; this.dur = items[0].buf.duration;
    this.fader.to(1, fadeIn, when);
    if (!this.loop) this.endAt = when + this.dur + 0.1;
  }
  fadeOut(dur, when) {
    const now = this.A.ctx.currentTime, t = Math.max(when ?? now, now);
    this.fader.to(0, dur, t);
    this.endAt = t + Math.max(dur, 0.004) + 0.08;
    for (const s of this.stems) { try { s.src.stop(this.endAt); } catch { /* */ } }
  }
  /** Undo a scheduled (not yet started) fade-out. */
  cancelFadeOut() {
    this.fader.to(1, 0.01); this.endAt = this.loop ? Infinity : this.endAt;
    for (const s of this.stems) { try { s.src.stop(1e9); } catch { /* */ } }
  }
  dispose() {
    if (this.dead) return; this.dead = true;
    for (const s of this.stems) { try { s.src.stop(); } catch { /* */ } try { s.src.disconnect(); } catch { /* */ } this.A._rel('src'); this.A._free(s.g, 'gain'); }
    this.A._free(this.out, 'gain');
    this.stems = []; this.prev = null;
  }
}

// ------------------------------------------------------------------------------------------------------------ Music
export class MusicSys {
  constructor(A) {
    this.A = A; this.tracks = new Map(); this.state = null; this.cur = null; this.fading = [];
    this.intensity = 0; this._requestedIntensity = 0; this.log = []; this._req = 0; this.pinned = new Set(); this._pendLayer = null; this.biome = null; this.layerTau = 0.4; this.want = null;
    this.successor = null; this._loadPending = false; this._retryAt = Infinity; this._disposed = false;
    this._streamPending = null; this._streamStarting = false; this._mediaPaused = false; this._resumeAt = 0;
  }
  _rebuild() {
    const A = this.A; this.tracks.clear();
    for (const def of A.defs.values()) {
      if (def.group !== 'music' && !/^music/.test(def.category || '')) continue;
      const m = def.meta || {};
      let id = m.track, stem = m.stem;
      if (!id) { const r = /^(.*?)(?:_(base|drums|lead|extra))?$/.exec(def.name); id = r[1]; stem = r[2]; }
      let t = this.tracks.get(id);
      if (!t) { t = { id, kind: m.kind || (/^run/.test(id) ? 'run' : /^boss/.test(id) ? 'boss' : /^garage/.test(id) ? 'garage' : /^title/.test(id) ? 'title' : /^victory/.test(id) ? 'victory' : 'other'), stems: [], bpm: m.bpm, bars: m.bars, secPerBar: m.secPerBar, loop: def.loop, biomes: null, streaming: !!m.streaming }; this.tracks.set(id, t); }
      if (m.streaming) t.streaming = true;
      if (!t.biomes && t.kind === 'run') {
        if (Array.isArray(m.biomes)) t.biomes = m.biomes.map((b) => String(b).toLowerCase());
        else { const bm = /\(([a-z/ ]+)\)/i.exec(m.notes || ''); if (bm) t.biomes = bm[1].toLowerCase().split('/').map((x) => x.trim()); }
      }
      t.stems.push({ def, stem: stem || 'base', layer: m.intensity ?? Math.max(0, ['base', 'drums', 'lead', 'extra'].indexOf(stem || 'base')) });
      if (!def.loop) t.loop = false;
    }
    for (const t of this.tracks.values()) t.stems.sort((a, b) => a.layer - b.layer);
    if (this.want && !this._disposed) this.setState(this.want, this._wantOpts || {});
  }
  trackIds(kind) { return [...this.tracks.values()].filter((t) => !kind || t.kind === kind).map((t) => t.id).sort(); }
  _pick(kind, o) {
    if (o.track && this.tracks.has(o.track)) return o.track;
    const routes = this.A.manifest?.musicRoutes, route = routes?.[kind];
    const exact = typeof route === 'string' ? route : route?.[this.biome === 'forest' ? 'mountain' : this.biome] || route?.default;
    if (exact && this.tracks.has(exact) && this.tracks.get(exact).kind === kind) return exact;
    const ids = this.trackIds(kind);
    if (!ids.length) return null;
    if (kind === 'run') {
      const b = this.biome === 'forest' ? 'mountain' : this.biome;
      const route = BIOME_AUDIO[b];
      if (route && this.tracks.has(route.track)) return route.track;
      const hit = ids.find((id) => this.tracks.get(id).biomes && (this.tracks.get(id).biomes.includes(b) || (route && this.tracks.get(id).biomes.includes(route.track.split('_').at(-1)))));
      if (hit) return hit;
      if (b === 'dam') return ids[ids.length - 1];
      const i = Math.max(0, BIOME_ORDER.indexOf(route?.track.split('_').at(-1) || b)); return ids[i % ids.length];
    }
    return ids[0];
  }
  /** Music follows the biome: each biome maps to one of the run tracks (crossfades at the next bar while in the run state). */
  setBiome(id) {
    if (this.biome === id) return; this.biome = id;
    this.setIntensity(this._requestedIntensity);
    if (this.state === 'run' || this.state === 'boss') this.setState(this.state, {});
  }
  layerLevels(track, v) {
    const n = track.stems.length, p = clamp01(v) * Math.max(0, n - 1);
    return track.stems.map((s, k) => (k === 0 ? 1 : smoothstep(0, 1, p - (k - 1))));
  }
  /** state: 'garage' | 'title' | 'run' | 'boss' | 'victory'. Starts at the next bar boundary of the current track (equal-power crossfade). */
  setState(state, o = {}) {
    if (this._disposed) return null;
    const A = this.A, req = ++this._req;
    this._cancelStreamRequest();
    this.state = state; this.want = state; this._wantOpts = o;
    this._loadPending = false; this._retryAt = Infinity;
    const tid = this._pick(state, o);
    if (!tid) { A.missing.set('music/' + state, (A.missing.get('music/' + state) || 0) + 1); if (this.cur) this.stop(o.xfade ?? 1.2); return null; }
    this.wantTrack = tid;
    this.successor = null;
    this._releaseUnused();
    if (this.cur && this.cur.track.id === tid && !this.cur.dead && !o.force) { this._prefetchNext(); return tid; }
    this._requestTrack(this.tracks.get(tid), o, req);
    return tid;
  }
  _requestTrack(track, o, req = this._req) {
    if (this._disposed || req !== this._req || this._loadPending) return;
    if (track?.streaming) { this._requestStream(track, o, req); return; }
    this._loadPending = true;
    this.A.whenReady(track.stems.map((s) => s.def), 2, () => {
      if (this._disposed || req !== this._req) return;
      this._loadPending = false;
      // Failed loads retain the audible old bed and retry on the audio clock.
      // A hidden/suspended tab consequently cannot flood the asset loader.
      this._retryAt = this.A.ctx.currentTime + 2;
      if (track.stems.every((s) => s.def.bufs[0])) this._start(track, o);
      this._releaseUnused();
    });
  }
  _cancelStreamRequest() {
    if (this._streamPending) this._streamPending.dispose();
    this._streamPending = null; this._streamStarting = false;
  }
  _requestStream(track, o, req) {
    // Pending media counts as the second bed. Wait for an audible fade to retire
    // before creating another element, including during rapid level changes.
    if (this._streamPending) return;
    if (this.fading.length) { this._retryAt = Math.max(...this.fading.map(p => p.endAt)) + .001; return; }
    this._loadPending = true;
    let bed;
    try { bed = new StreamingMusicBed(this.A, track, this.A.busIn.music, Fader); }
    catch (error) { this._streamFailure(error, req); return; }
    this._streamPending = bed;
    bed.prepare().then(() => {
      if (this._disposed || req !== this._req || this._streamPending !== bed) { bed.dispose(); return; }
      this._activateStream(bed, o, req);
    }, error => {
      if (req !== this._req || this._streamPending !== bed) return;
      this._streamPending = null; bed.dispose(); this._streamFailure(error, req);
    });
  }
  _streamFailure(error, req) {
    if (this._disposed || req !== this._req) return;
    this._loadPending = false; this._streamStarting = false; this._retryAt = this.A.ctx.currentTime + 2;
    this._log({ type: 'stream_error', track: this.wantTrack, message: String(error?.message || error).slice(0, 180), t: this.A.ctx.currentTime });
  }
  _activateStream(bed, o = this._wantOpts || {}, req = this._req) {
    if (!bed.ready || bed.dead || bed.ended || this._disposed || req !== this._req || this._streamPending !== bed || this._streamStarting || this.A.ctx.currentTime < bed.retryAt) return;
    if (this._mediaPaused || this.A._paused || (this.A.ctx.state && this.A.ctx.state !== 'running')) return;
    this._streamStarting = true; bed.setPaused(false);
    bed.play().then(playing => {
      if (this._disposed || req !== this._req || this._streamPending !== bed) { bed.dispose(); return; }
      this._streamStarting = false;
      if (bed.failed || bed.ended) {
        this._streamPending = null; bed.dispose(); this._streamFailure(bed.error || new Error('Music media ended before activation'), req); return;
      }
      if (!playing || this._mediaPaused || this.A._paused || (this.A.ctx.state && this.A.ctx.state !== 'running')) { bed.setPaused(true); return; }
      const now = this.A.ctx.currentTime, prev = this.cur, xf = o.xfade ?? 1.2;
      this._streamPending = null; this._loadPending = false; this._retryAt = Infinity; this._pendLayer = null;
      bed.prev = prev; bed.begin(prev ? xf : .25);
      if (prev && !prev.dead) { prev.fadeOut(xf, now); this.fading.push(prev); }
      this.cur = bed; this.successor = null;
      this._log({ type: 'start', track: bed.track.id, when: now, now, xfade: prev ? xf : .25, bar: null, streaming: true, prev: prev?.track.id || null });
      this._releaseUnused();
    }, error => {
      if (req !== this._req || this._streamPending !== bed) return;
      if (error?.name === 'NotAllowedError') {
        this._streamStarting = false; bed.retryAt = this.A.ctx.currentTime + 2;
        this._log({ type: 'stream_blocked', track: bed.track.id, t: this.A.ctx.currentTime }); return;
      }
      this._streamPending = null; bed.dispose(); this._streamFailure(error, req);
    });
  }
  _start(track, o) {
    const A = this.A, c = A.ctx, now = c.currentTime;
    const levels = this.layerLevels(track, this.intensity), items = [];
    for (let i = 0; i < track.stems.length; i++) {
      const s = track.stems[i], buf = s.def.bufs[0];
      if (!buf) return;
      const first = items[0]?.buf;
      if (first && (Math.abs(first.duration - buf.duration) > 1e-6 || first.length !== buf.length)) return;
      items.push({ buf, gain: levels[i] * s.def.gain, key: s.def.key, layer: s.layer, def: s.def, name: s.stem });
    }
    if (!items.length) return;
    let prev = this.cur;
    // an unstarted, superseded transition: drop it and let the previous track keep playing
    if (prev && prev.t0 > now + 0.02) {
      const back = prev.prev; prev.fadeOut(0.01, now); this._retire(prev);
      if (back && !back.dead) { back.cancelFadeOut(); this.fading = this.fading.filter((f) => f !== back); }
      prev = back || null;
    }
    // Coalesce another transition until an audible crossfade has retired.
    // This bounds active themes and avoids stacking three or more loud beds.
    if (this.fading.length) {
      this._retryAt = Math.max(...this.fading.map((p) => p.endAt)) + 0.001;
      return;
    }
    this._retryAt = Infinity; this._pendLayer = null;
    if (prev && prev.track.id === track.id && !o.force) {
      this.cur = prev;
      prev.stems.forEach((s, i) => { s.target = levels[i] * s.def.gain; });
      this._applyLayers(prev, now); this._prefetchNext(); return;
    }
    const spb = track.secPerBar || (items[0].buf.duration / (track.bars || 16));
    let tb = now + 0.06, xf = 0.05;
    if (prev && !prev.dead && !prev.ended) {
      xf = o.xfade ?? clamp(Math.min(prev.spb, spb), 0.4, 2.5);
      if (prev.streaming) { tb = now + .04; xf = o.xfade ?? 1.2; }
      else if (o.immediate) { tb = now + 0.04; xf = o.xfade ?? 0.3; } else if (prev.loop) tb = prev.nextBoundary(now + 0.1);
    }
    const play = new LoopBed(A, items, A.busIn.music, tb, xf, { loop: track.loop !== false });
    play.track = track; play.spb = play.dur / (track.bars || Math.max(1, Math.round(play.dur / spb)));
    play.nextBoundary = (t) => (t <= play.t0 ? play.t0 : play.t0 + Math.ceil((t - play.t0) / play.spb - 1e-6) * play.spb);
    play.prev = prev;
    if (prev && !prev.dead) { prev.fadeOut(xf, tb); this.fading.push(prev); }
    this.cur = play;
    this._log({ type: 'start', track: track.id, when: tb, now, xfade: xf, bar: prev && !prev.streaming ? Math.round((tb - prev.t0) / prev.spb * 1000) / 1000 : null, prev: prev ? prev.track.id : null });
    this._prefetchNext(); this._releaseUnused();
  }
  _retire(p) { p.dead || p.dispose(); this.fading = this.fading.filter((f) => f !== p); if (this.cur === p) this.cur = null; }
  _log(event) { this.log.push(event); if (this.log.length > 128) this.log.splice(0, this.log.length - 128); }
  /** Optional explicit pins; normal gameplay retains only current, outgoing and one successor. */
  pin(...ids) { for (const i of ids) this.pinned.add(i); }
  preload(kinds = ['run', 'boss'], prio = 3) {
    // Kinds select the appropriate current stage, never all six large themes.
    const ids = new Set(kinds.map((k) => this.A.manifest?.musicRoutes?.[k] ? this._pick(k, {}) : this.tracks.has(k) ? k : this._pick(k, {})).filter(Boolean));
    return this.A.load([...ids].filter(id => !this.tracks.get(id).streaming).flatMap((id) => this.tracks.get(id).stems.map((s) => s.def)), prio);
  }
  _prefetchNext() {
    const cur = this.cur, stages = this.trackIds('run');
    this.successor = null;
    if (cur?.streaming) { this._releaseUnused(); return; }
    if (cur && !cur.dead && cur.track.kind === 'run' && this.wantTrack === cur.track.id) {
      const index = stages.indexOf(cur.track.id);
      const chapter = BIOME_ORDER.indexOf(this.biome);
      if (chapter >= 6) {
        const next = BIOME_AUDIO[BIOME_ORDER[chapter + 1]]?.track;
        this.successor = next === cur.track.id ? null : next && this.tracks.has(next) ? next : this.trackIds('boss')[0] || null;
      } else this.successor = stages[index + 1] || this.trackIds('boss')[0] || null;
      if (this.successor) this.A.load(this.tracks.get(this.successor).stems.map((s) => s.def), 3);
    }
    this._releaseUnused();
  }
  _releaseUnused() {
    const keep = new Set([this.cur?.track.id, this.wantTrack, this.successor, ...this.fading.filter((f) => !f.dead).map((f) => f.track.id)]);
    for (const t of this.tracks.values()) {
      if (keep.has(t.id) || this.pinned.has(t.id) || this.pinned.has(t.kind)) continue;
      for (const s of t.stems) if ((s.def.bufs.length || s.def.loading.some(Boolean)) && !s.def.injected && !this.A.defInUse(s.def)) this.A.unload(s.def);
    }
  }
  setIntensity(v, o = {}) {
    this._requestedIntensity = clamp01(v);
    const level = Math.max(this._requestedIntensity, BIOME_AUDIO[this.biome]?.pressureFloor || 0), changed = Math.abs(level - this.intensity) > 1e-6;
    this.intensity = level;
    const A = this.A, now = A.ctx.currentTime, cur = this.cur;
    if (!cur || cur.dead || cur.streaming || (!changed && !o.immediate && o.quantize !== false)) return;
    const lv = this.layerLevels(cur.track, this.intensity);
    cur.stems.forEach((s, i) => { s.target = lv[i] * s.def.gain; });
    if (o.immediate || o.quantize === false) { this._applyLayers(cur, now); return; }
    if (!this._pendLayer) this._pendLayer = { time: cur.nextBoundary(now + 0.05) };
  }
  _applyLayers(play, t) {
    const now = this.A.ctx.currentTime;
    for (const s of play.stems) s.g.gain.setTargetAtTime(s.target, Math.max(t, now), this.layerTau);
    this._log({ type: 'layers', t: Math.max(t, now), levels: play.stems.map((s) => +s.target.toFixed(3)) });
  }
  stop(fade = 1.0) {
    this._req++; this.want = null; this.state = null; this._loadPending = false; this._retryAt = Infinity; this._pendLayer = null;
    this._cancelStreamRequest();
    const p = this.cur; if (p && !p.dead) { p.fadeOut(fade); this.fading.push(p); }
    this.cur = null; this.wantTrack = null; this.successor = null; this._releaseUnused();
  }
  dispose() {
    if (this._disposed) return;
    this.stop(0); this._disposed = true;
    for (const p of this.fading) p.dispose();
    this.fading.length = 0; this.pinned.clear(); this._releaseUnused();
  }
  tick(now) {
    if (this._streamPending?.ready && !this._streamStarting) this._activateStream(this._streamPending);
    if (!this._mediaPaused && !this.A._paused && (!this.A.ctx.state || this.A.ctx.state === 'running') && now >= this._resumeAt) this._resumeStreams();
    if (this._pendLayer && this.cur && !this.cur.dead && now + 0.12 >= this._pendLayer.time) { this._applyLayers(this.cur, this._pendLayer.time); this._pendLayer = null; } else if (this._pendLayer && (!this.cur || this.cur.dead)) this._pendLayer = null;
    let retired = false;
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      if (f.dead || now > f.endAt) {
        if (this.cur?.prev === f) this.cur.prev = null;
        f.dispose(); this.fading.splice(i, 1); retired = true;
      }
    }
    const c = this.cur;
    if (c?.streaming && c.failed) {
      const error = c.error; this._retire(c);
      if (!this._streamPending) this._streamFailure(error, this._req);
      retired = true;
    } else if (c && !c.loop && (c.streaming ? c.ended : now > c.endAt)) {
      c.dispose(); this.cur = null;
      if (this.wantTrack === c.track.id) { this.wantTrack = null; this._retryAt = Infinity; }
      this._log({ type: 'ended', t: now }); retired = true;
    }
    if (retired) this._releaseUnused();
    if (!this._disposed && this.wantTrack && !this._loadPending && now >= this._retryAt) this._requestTrack(this.tracks.get(this.wantTrack), this._wantOpts || {});
  }
  setPaused(paused) {
    this._mediaPaused = !!paused;
    if (paused) {
      for (const bed of [this.cur, ...this.fading, this._streamPending]) if (bed?.streaming) bed.setPaused(true);
    } else this.unlock();
  }
  setContextSuspended(paused) {
    if (paused) {
      for (const bed of [this.cur, ...this.fading, this._streamPending]) if (bed?.streaming) bed.setPaused(true);
    } else this.unlock();
  }
  unlock() {
    if (this._disposed || this._mediaPaused || this.A._paused || (this.A.ctx.state && this.A.ctx.state !== 'running')) return;
    this._resumeAt = 0; this._resumeStreams();
    if (this._streamPending?.ready) { this._streamPending.retryAt = 0; this._activateStream(this._streamPending); }
  }
  _resumeStreams() {
    this._resumeAt = this.A.ctx.currentTime + 2;
    for (const bed of [this.cur, ...this.fading]) {
      if (!bed?.streaming || bed.dead || bed.failed || bed.ended || (!bed.paused && !bed.media.paused)) continue;
      bed.setPaused(false); bed.play().catch(error => {
        if (!bed.dead) this._log({ type: 'stream_resume_error', track: bed.track.id, message: String(error?.message || error).slice(0, 180), t: this.A.ctx.currentTime });
      });
    }
  }
  info() {
    const c = this.cur, now = this.A.ctx.currentTime;
    if (!c || c.dead) return { state: this.state, track: null, intensity: this.intensity };
    if (c.streaming) return { state: this.state, track: c.track.id, intensity: this.intensity, streaming: true, mediaState: c.status, t0: c.t0, spb: null, bar: null, bars: null, beat: null, loopPos: c.media.currentTime || 0, dur: c.dur, layers: c.stems.map(s => ({ name: s.name, target: s.target })), fading: this.fading.length };
    const el = Math.max(0, now - c.t0), pos = c.loop ? el % c.dur : Math.min(el, c.dur);
    const bar = Math.floor(pos / c.spb), beat = Math.floor(((pos % c.spb) / c.spb) * 4);
    return { state: this.state, track: c.track.id, intensity: this.intensity, t0: c.t0, spb: c.spb, bar: bar + 1, bars: c.track.bars, beat: beat + 1, loopPos: pos, dur: c.dur, layers: c.stems.map((s) => ({ name: s.name, target: +s.target.toFixed(3) })), fading: this.fading.length };
  }
}

// ------------------------------------------------------------------------------------------------------------ Tyres
/** Sim surface ('asphalt' | 'gravel' | 'oil' | biome dirt kinds, or a {kind} object) -> tyre layer. */
function surfaceKind(s) { if (s && typeof s === 'object') s = s.kind; return !s || s === 'asphalt' || s === 'road' || s === 'tarmac' || s === 'concrete' || s === 'bridge' || s === 'oil' ? 'asphalt' : 'dirt'; }

/** Tyre roar (asphalt / dirt crossfade by surface) + skid squeal (asphalt / gravel) loops. */
export class TyreSet {
  constructor(A, dest) {
    this.A = A; this.dirt = 0; this.la = new LoopLayer(A, 'vehicles/tyre_asphalt_loop', dest); this.ld = new LoopLayer(A, 'vehicles/tyre_dirt_loop', dest);
    this.sa = new LoopLayer(A, 'vehicles/skid_loop', dest); this.sg = new LoopLayer(A, 'vehicles/skid_gravel_loop', dest);
  }
  update(speed01, surface, slip, grounded, dt, rateMul = 1, level = 1) {
    this.dirt = lerp(this.dirt, surfaceKind(surface) === 'dirt' ? 1 : 0, 1 - Math.exp(-6 * dt));
    const g = Math.pow(clamp01(speed01), 1.05) * 0.9 * clamp01(grounded) * level;
    const rate = (0.7 + 0.85 * clamp01(speed01)) * rateMul;
    this.la.set(g * Math.cos(this.dirt * PI / 2), rate, 0.1);
    this.ld.set(g * Math.sin(this.dirt * PI / 2), rate, 0.1);
    const s = smoothstep(0.22, 0.85, slip) * (0.35 + 0.65 * clamp01(speed01 * 1.6)) * clamp01(grounded) * level;
    const sr = (0.9 + 0.3 * clamp01(speed01)) * rateMul;
    this.sa.set(s * Math.cos(this.dirt * PI / 2), sr, 0.06);
    this.sg.set(s * Math.sin(this.dirt * PI / 2), sr, 0.06);
  }
  release() { this.la.release(); this.ld.release(); this.sa.release(); this.sg.release(); }
}

// ------------------------------------------------------------------------------------------------------------ EngineSound
export class EngineSound {
  /** o: {engineId, player, turbo, supercharger, backfire(0..1 prob), level, pitch, tyres} */
  constructor(A, carId, spec, o = {}) {
    this.A = A; this.id = carId; this.spec = spec || null;
    this.engineId = o.engineId || A.engineIdFor(spec);
    const pre = (spec && ENGINE_OPTS[spec.id]) || {};
    this.player = !!o.player;
    this.turbo = o.turbo ?? pre.turbo ?? false;
    this.supercharger = o.supercharger ?? pre.supercharger ?? 0;
    this.backfire = o.backfire ?? pre.backfire ?? 0;
    this.level = o.level ?? pre.level ?? 0.7;
    this.pitchMul = o.pitch ?? pre.pitch ?? 1;
    this.tyres = o.tyres !== false;
    this.vmax = spec?.engine?.vmax || 50;
    this.stages = []; this._resolveStages(); this._nextResolve = 0;
    this.built = false; this.allowed = true; this.disposed = false; this.killed = false; this.dead = false;
    this.dist = 1e9; this.lod = 0; this.rpm = 0; this.w = []; this.spool = 0; this.boostS = 0; this.dirtRate = 1;
    this.peakLoad = 0; this.prevRpm01 = 0.2; this.lastBackfire = -9; this.lastShift = -9; this.lastBlow = -9; this.lastNitro = -9;
    this.nitroOn = false; this.nextSputter = 0; this._skip = 0; this.seen = 0; this.exploded = false; this.hp01 = 1; this.airborne = false;
    this.lastAirT = 0; this.landPending = 0;
  }
  _resolveStages() {
    const t = this.A.engineTable.get(this.engineId);
    if (t && t.length && (!this.stages.length || this.stages.length !== t.length)) this.stages = t.map((s) => ({ rpm: s.rpm, stage: s.stage, def: s.def }));
  }
  _rpmOf(rpm01) {
    const s = this.stages, idle = s[0].rpm, red = s[s.length - 1].rpm;
    return lerp(idle * 0.94, red * 1.03, clamp01((rpm01 - 0.2) / 0.8));
  }
  _build() {
    const A = this.A;
    this.out = A._gain(0); this.outF = new Fader(A, this.out.gain, 0);
    this.lp = A._filter('lowpass', 20000, 0.5);
    this.dip = A._gain(1); this.sum = A._gain(1); this.mix = A._gain(0.0001); this.loadLP = A._filter('lowpass', 9000, 0.6);
    this.mix.connect(this.loadLP); this.loadLP.connect(this.sum); this.sum.connect(this.dip); this.dip.connect(this.lp);
    if (!this.player) { this.pan = A._panner(8, 1); this.lp.connect(this.pan); this.pan.connect(this.out); } else this.lp.connect(this.out);
    this.out.connect(A.busIn.sfx);
    this.sl = this.stages.map((s) => new LoopLayer(A, s.def, this.mix, { rMin: 0.5, rMax: 1.9 }));
    this.turboL = new LoopLayer(A, 'vehicles/turbo_whine_loop', this.sum);
    this.superL = new LoopLayer(A, 'vehicles/supercharger_whine_loop', this.sum);
    this.nitroL = new LoopLayer(A, 'vehicles/nitro_loop', this.sum);
    this.dmgL = new LoopLayer(A, 'vehicles/damaged_engine_loop', this.sum);
    this.tyreS = this.tyres ? new TyreSet(A, this.sum) : null;
    this.outF.to(1, 0.2);
    this._c = {}; this._pp = null;
    this.built = true;
  }
  _releaseAll() {
    if (!this.built) return;
    const A = this.A;
    for (const l of this.sl) l.release();
    this.turboL.release(); this.superL.release(); this.nitroL.release(); this.dmgL.release(); if (this.tyreS) this.tyreS.release();
    A._free(this.mix, 'gain'); A._free(this.loadLP, 'filter'); A._free(this.sum, 'gain'); A._free(this.dip, 'gain'); A._free(this.lp, 'filter');
    if (this.pan) { A._free(this.pan, 'panner'); this.pan = null; }
    A._free(this.out, 'gain');
    this.built = false; this.sl = null;
  }
  /** Arbitration hook (AudioSys.update): cull far / excess engines with a short fade. */
  setAllowed(ok) {
    if (ok === this.allowed) return;
    this.allowed = ok;
    if (!this.built) return;
    if (!ok) { this.outF.to(0, 0.15); this.A._later(0.25, () => { if (!this.allowed && !this.disposed) this._releaseAll(); }); } else this.outF.to(1, 0.2);
  }
  /**
   * rpm01 0..1 (sim: 0.2 idle .. 1 redline), load 0..1, boost 0..1 (nitro), dist to listener (m), speed (m/s).
   * ex: {pos, vel, exhaustPos, slip(0..1 max), surface, grounded(0..1), braking, engineHp01, airborne}
   */
  update(rpm01, load = 0.5, boost = 0, dist, speed = 0, ex = null) {
    if (this.disposed || this.killed) return;
    const A = this.A, c = A.ctx, now = c.currentTime;
    ex = ex || EMPTY;
    if (dist === undefined || dist === null) dist = this.player || !ex.pos ? 0 : A.listener.distTo(ex.pos);
    this.dist = dist; this.speed = speed;
    if (!this.allowed) return;
    if (!this.stages.length) { if (now >= this._nextResolve) { this._nextResolve = now + 1; this._resolveStages(); } if (!this.stages.length) return; }
    if (!this.built) { if (A.buildBudget <= 0) return; A.buildBudget--; this._build(); }
    const lod = this.player || dist < 55 ? 0 : 1;
    if (lod === 1 && this.lod === 1) { this._skip ^= 1; if (this._skip) return; }
    this.lod = lod;
    const dt = Math.min((A.dt || 1 / 60) * (lod ? 2 : 1), 0.1);
    const hp = ex.engineHp01 ?? 1; this.hp01 = hp;
    const R = this._rpmOf(rpm01); this.rpm = R;
    this.boostS = lerp(this.boostS, clamp01(boost), 1 - Math.exp(-9 * dt));
    const st = this.stages, n = st.length, w = this.w; w.length = n;
    for (let i = 0; i < n; i++) w[i] = 0;
    if (R <= st[0].rpm) w[0] = 1;
    else if (R >= st[n - 1].rpm) w[n - 1] = 1;
    else {
      let i = 0; while (i < n - 2 && R >= st[i + 1].rpm) i++;
      const t = Math.log(R / st[i].rpm) / Math.log(st[i + 1].rpm / st[i].rpm), u = smoothstep(0.12, 0.88, t);
      w[i] = Math.cos(u * PI / 2); w[i + 1] = Math.sin(u * PI / 2);
    }
    const dop = this.player || !ex.pos ? 1 : A.doppler(ex.pos, ex.vel || ZERO);
    const rateMul = this.pitchMul * dop * (1 + 0.05 * this.boostS);
    const loadC = clamp01(load);
    for (let i = 0; i < n; i++) {
      const wi = lod === 1 ? (w[i] > 0.5 ? 1 : 0) : w[i];
      this.sl[i].set(wi, clamp(R / st[i].rpm, 0.55, 1.8) * rateMul, 0.04);
    }
    // load dependent level + brightness; a dead engine is choked
    const deadMul = this.dead ? 0.7 : 1;
    this._set('mix', this.mix.gain, this.level * lerp(0.6, 1, loadC) * deadMul, now, 0.06);
    const loadFc = clamp(lerp(1900, 16000, Math.pow(loadC, 0.7)) * (0.65 + 0.55 * clamp01(rpm01)) * (this.dead ? 0.5 : 1), 900, 18000);
    this._set('loadLP', this.loadLP.frequency, loadFc, now, 0.08);
    if (!this.player) {
      this._set('lp', this.lp.frequency, airCutoff(dist, 1), now, 0.1);
      if (ex.pos && (lod === 0 || this._skip === 0)) {
        const px = _isArr(ex.pos) ? ex.pos[0] : ex.pos.x, py = _isArr(ex.pos) ? ex.pos[1] : ex.pos.y, pz = _isArr(ex.pos) ? ex.pos[2] : ex.pos.z, pp = this._pp || (this._pp = [1e9, 0, 0]);
        if (Math.abs(px - pp[0]) + Math.abs(py - pp[1]) + Math.abs(pz - pp[2]) > 0.04) { pp[0] = px; pp[1] = py; pp[2] = pz; const p = this.pan; setParam(p.positionX, px); setParam(p.positionY, py); setParam(p.positionZ, pz); }
      }
    }
    if (lod === 0) {
      // forced induction
      const spoolT = loadC * smoothstep(0.25, 0.9, rpm01);
      this.spool = lerp(this.spool, spoolT, 1 - Math.exp(-(spoolT > this.spool ? 2.4 : 1.3) * dt));
      if (this.turbo) this.turboL.set(Math.pow(this.spool, 1.6) * 0.9 + this.boostS * 0.25, (0.5 + 1.1 * this.spool) * dop, 0.06); else this.turboL.set(0, 1, 0.1);
      if (this.supercharger > 0) this.superL.set(this.supercharger * (0.2 + 0.8 * clamp01(rpm01)) * (0.35 + 0.65 * loadC), (0.55 + 0.95 * clamp01(rpm01)) * dop, 0.06); else this.superL.set(0, 1, 0.1);
      this.nitroL.set(this.boostS * 0.85, (0.95 + 0.2 * clamp01(rpm01)) * dop, 0.05);
      // nitro ignite / end one-shots on the edges
      const on = boost > 0.5;
      if (on !== this.nitroOn && now - this.lastNitro > 0.35) { this.lastNitro = now; this.nitroOn = on; this._shot(on ? 'vehicles/nitro_ignite' : 'vehicles/nitro_end', ex, { gain: 0.9 }); } else if (on !== this.nitroOn && now - this.lastNitro <= 0.35) this.nitroOn = on;
      // damage: rattle + misfire dips + stalled engine
      const dmg = smoothstep(0.6, 0.08, hp);
      this.dmgL.set(dmg * 0.9, (0.8 + 0.6 * clamp01(rpm01)) * dop, 0.15);
      if (hp < 0.35 && now >= this.nextSputter) {
        const sev = 1 - hp / 0.35;
        this.dip.gain.setTargetAtTime(lerp(0.6, 0.15, sev), now, 0.008); this.dip.gain.setTargetAtTime(1, now + 0.05 + A.rand() * 0.07, 0.03);
        this.nextSputter = now + lerp(1.4, 0.3, sev) * (0.6 + A.rand() * 0.8);
      }
      // tyres
      if (this.tyreS) {
        const gr = ex.grounded ?? (ex.airborne ? 0 : 1);
        this.tyreS.update(speed / this.vmax, ex.surface, ex.slip || 0, gr, dt, dop, this.player ? 0.75 : 1);
        if (ex.braking && speed > 22 && (ex.slip || 0) > 0.3 && now - (this.lastSquealT || -9) > 1.6) { this.lastSquealT = now; this._shot('vehicles/brake_squeal', ex, { gain: 0.55, pitch: 0.9 + A.rand() * 0.3 }); }
      }
      // backfire / gear shift / blow-off (only on a lift from real load)
      this.peakLoad = Math.max(loadC, (this.peakLoad || 0) * Math.exp(-dt / 0.5));
      const lift = this.peakLoad > 0.55 && loadC < 0.2 && rpm01 > 0.5;
      if (lift) {
        this.peakLoad = loadC;
        if (this.backfire > 0 && now - this.lastBackfire > 0.6 && A.rand() < this.backfire) { this.lastBackfire = now; this._shot('vehicles/backfire', ex, { gain: 0.8, at: ex.exhaustPos }); }
        if (this.turbo && this.spool > 0.55 && now - this.lastBlow > 1.2) { this.lastBlow = now; this._shot('vehicles/gear_shift', ex, { gain: 0.35, pitch: 1.3 }); }
      }
      const slope = (rpm01 - this.prevRpm01) / Math.max(dt, 1e-3);
      if (this.player && slope < -1.4 && speed > 8 && now - this.lastShift > 0.7) { this.lastShift = now; this._shot('vehicles/gear_shift', ex, { gain: 0.3, pitch: 0.95 + A.rand() * 0.1 }); }
      this.prevRpm01 = rpm01;
      this._extrasOn = true;
    } else if (this._extrasOn) {
      // far LOD: only the dominant stage loop; fade the extra layers out (their sources stop after ~0.7 s of silence)
      this._extrasOn = false;
      for (const l of [this.turboL, this.superL, this.nitroL, this.dmgL]) l.set(0, 1, 0.08);
      if (this.tyreS) this.tyreS.update(0, ex.surface, 0, 0, dt);
    } else {
      for (const l of [this.turboL, this.superL, this.nitroL, this.dmgL]) if (l.active) l.set(0, 1, 0.08);
      if (this.tyreS && (this.tyreS.la.active || this.tyreS.ld.active || this.tyreS.sa.active || this.tyreS.sg.active)) this.tyreS.update(0, ex.surface, 0, 0, dt);
    }
    this.airborne = !!ex.airborne;
  }
  /** setTargetAtTime that is skipped when the value moved < 1% (keeps the automation timeline short). */
  _set(key, param, v, now, tau) {
    const c = this._c || (this._c = {});
    if (c[key] !== undefined && Math.abs(c[key] - v) <= 0.01 * Math.abs(v) + 1e-4) return;
    c[key] = v; param.setTargetAtTime(v, now, tau);
  }
  _shot(name, ex, o = {}) {
    const p = o.at || ex.pos;
    this.A.play(name, { pos: this.player ? undefined : p, gain: o.gain ?? 1, pitch: o.pitch ?? 1, pitchVar: 0.05 });
  }
  /** Engine dies (fuel/engine destroyed): stall sound, choked engine. */
  stall(ex) { if (this.dead) return; this.dead = true; this._shot('vehicles/engine_stall', ex || EMPTY, { gain: 0.9 }); }
  /** Explosion / removal: quick fade + free everything. */
  kill(fade = 0.06) {
    if (this.killed || this.disposed) return; this.killed = true;
    if (this.built) { this.outF.to(0, fade); this.A._later(fade + 0.1, () => this._releaseAll()); }
  }
  dispose(fade = 0.12) {
    if (this.disposed) return; this.disposed = true;
    this.A.engines.delete(this.id);
    if (this.built) { this.outF.to(0, fade); this.A._later(fade + 0.1, () => this._releaseAll()); }
  }
  info() { return { id: this.id, engine: this.engineId, rpm: Math.round(this.rpm), w: this.w.map((x) => +x.toFixed(2)), lod: this.lod, allowed: this.allowed, dist: +this.dist.toFixed(1), built: this.built, spool: +this.spool.toFixed(2), hp: this.hp01 }; }
}
const ZERO = { x: 0, y: 0, z: 0 };
const EMPTY = {};

// ------------------------------------------------------------------------------------------------------------ Ambience
export const BIOME_ORDER = Object.freeze(['desert', 'canyon', 'coast', 'mountain', 'city', 'dam', 'underground', 'sky', 'hell', 'space']);
/** Intentional reuse of existing mature DnB tracks; no extra decoded stem budget.
 * New chapters use increasingly present pressure stems, never a desert index fallback.
 * Ambience entries are exact existing manifest names, interpreted as machinery/wind beds.
 */
export const BIOME_AUDIO = Object.freeze(Object.fromEntries([
  ['desert','run_01_desert',0,['desert_wind_loop'],.7],
  ['canyon','run_02_canyon',0,['canyon_wind_loop'],1.4],
  ['coast','run_03_coast',0,['coast_waves_loop'],.9],
  ['mountain','run_04_mountain',0,['forest_wind_loop'],.9],
  ['city','run_05_city',0,['city_ruins_loop'],1.1],
  ['dam','run_06_dam',0,['dam_rumble_loop'],1.5],
  ['underground','run_05_city',.55,['dam_rumble_loop','city_ruins_loop'],1.7],
  ['sky','run_03_coast',.65,['desert_wind_loop','canyon_wind_loop'],.3],
  ['hell','run_06_dam',.78,['dam_rumble_loop','canyon_wind_loop'],1.2],
  ['space','run_06_dam',.9,['city_ruins_loop'],.4],
].map(([id,track,pressureFloor,ambience,reverb])=>[id,Object.freeze({track,pressureFloor,ambience:Object.freeze(ambience),reverb})])));

const BIOME_ALIAS = { mountain: ['mountain', 'forest', 'pine'], forest: ['forest', 'mountain', 'pine'], city: ['city', 'ruins'], coast: ['coast', 'sea', 'beach'] };
const BIOME_REVERB = { ...Object.fromEntries(Object.entries(BIOME_AUDIO).map(([id,route])=>[id,route.reverb])), forest: .9 };

export class AmbienceSys {
  constructor(A) {
    this.A = A; this.biome = null; this.bed = null; this.fading = []; this.windLevel = 0; this._req = 0;
    this.bedScale = A.ctx.createGain(); this.bedScale.connect(A.busIn.ambience);
    this.windLayer = null; this.windLP = null; this.tyres = null; this.want = null;
  }
  _resolveBed(biome) {
    const ids = BIOME_ALIAS[biome] || [biome], out = [], exact = BIOME_ORDER.indexOf(biome) >= 6 ? BIOME_AUDIO[biome]?.ambience : null;
    for (const d of this.A.defs.values()) {
      if (d.group !== 'ambience' && d.category !== 'ambience') continue;
      if (exact ? exact.includes(d.name) : ids.some((id) => d.name.startsWith(id) || d.meta.biome === id)) out.push(d);
    }
    return out;
  }
  setBiome(id, o = {}) {
    const A = this.A;
    this.want = id; this.wantOpts = o;
    if (this.biome === id && this.bed && !this.bed.dead) return;
    const defs = this._resolveBed(id);
    A.setReverbLevel(BIOME_REVERB[id] ?? 1);
    if (A.music) A.music.setBiome(id);
    this._noBed = !defs.length;
    if (!defs.length) { A.missing.set('ambience/' + id, (A.missing.get('ambience/' + id) || 0) + 1); this.biome = id; if (this.bed) { this.bed.fadeOut(o.xfade ?? 3); this.fading.push(this.bed); this.bed = null; } return; }
    const req = ++this._req; this.biome = id;
    A.whenReady(defs, 2, () => {
      if (req !== this._req) return;
      const items = [];
      for (const d of defs) { const buf = A._pickBuf(d); if (buf) items.push({ buf, gain: d.gain / Math.sqrt(defs.length), key: d.key, def: d }); }
      if (!items.length) return;
      const now = A.ctx.currentTime, xf = o.xfade ?? 3.5, prev = this.bed;
      const bed = new LoopBed(A, items, this.bedScale, now + 0.03, prev ? xf : 0.4, { randomOffset: true });
      if (prev) { prev.fadeOut(xf, now + 0.03); this.fading.push(prev); }
      this.bed = bed; A._log('ambience', { biome: id, start: now + 0.03, xfade: prev ? xf : 0.4, layers: items.map((i) => i.key) });
    });
  }
  /** Wind speed 0..1 (player's speed): drives the wind rush layer and masks the biome bed. */
  wind(speed01, o = {}) {
    const A = this.A, now = A.ctx.currentTime, s = clamp01(speed01);
    this.windLevel = s;
    if (!this.windLayer) {
      this.windLP = A._filter('lowpass', 800, 0.6); this.windLP.connect(A.busIn.ambience);
      this.windLayer = new LoopLayer(A, 'vehicles/wind_loop', this.windLP, { rMin: 0.6, rMax: 1.8 });
    }
    this.windLayer.set((0.03 + 0.9 * Math.pow(s, 1.4)) * (o.gain ?? 1), 0.75 + 0.5 * s, 0.15);
    this.windLP.frequency.setTargetAtTime(500 + 8500 * Math.pow(s, 1.2), now, 0.15);
    this.bedScale.gain.setTargetAtTime(1 - 0.5 * s, now, 0.4);
  }
  /** Global (non positional) tyre/road roar for the player: speed01 0..1, surface string, slip 0..1. */
  roar(speed01, surface = 'asphalt', slip = 0, grounded = 1) {
    if (!this.tyres) this.tyres = new TyreSet(this.A, this.A.busIn.ambience);
    this.tyres.update(speed01, surface, slip, grounded, this.A.dt || 1 / 60);
  }
  tick(now) {
    for (let i = this.fading.length - 1; i >= 0; i--) { const f = this.fading[i]; if (f.dead || now > f.endAt) { f.dispose(); this.fading.splice(i, 1); } }
    if (this._noBed && this.want && now > (this._nextRetry || 0)) {
      this._nextRetry = now + 2;
      if (this._resolveBed(this.want).length) { const w = this.want, o = this.wantOpts; this.biome = null; this.setBiome(w, o); }
    }
  }
  /** Stops the biome bed, the wind layer and the player-roar layer. */
  stop(fade = 1) {
    this._req++; if (this.bed) { this.bed.fadeOut(fade); this.fading.push(this.bed); this.bed = null; } this.biome = null; this.want = null; this._noBed = false;
    this.stopWind(fade);
  }
  stopWind(fade = 0.5) {
    if (this.windLayer) this.windLayer.fadeStop(fade);
    if (this.tyres) for (const l of [this.tyres.la, this.tyres.ld, this.tyres.sa, this.tyres.sg]) l.fadeStop(fade);
    this.windLevel = 0;
  }
}

// ------------------------------------------------------------------------------------------------------------ AudioSys
export class AudioSys {
  /** camera: optional THREE.Camera (only used if you call audio.listener.update() without args); opts.context for OfflineAudioContext tests. */
  constructor(camera = null, opts = {}) {
    this.camera = camera; this.opts = opts;
    this.offline = !!(opts.context && typeof opts.context.startRendering === 'function');
    if (opts.context) this.ctx = opts.context;
    else { const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC({ latencyHint: 'interactive' }); }
    this.rand = opts.rand || Math.random; this.buildBudget = 2;
    this.dt = 1 / 60;
    this.defs = new Map(); this.byBare = new Map(); this.engineTable = new Map(); this.engines = new Map();
    this.missing = new Map(); this.expected = new Set(); this.notLoadedNames = new Set(); this.manifest = null; this.manifestUrl = null; this.baseUrl = '/audio/';
    this.fetchCache = opts.fetchCache || 'no-cache';
    this.voices = new Set(); this._dyn = new Set(); this.maxVoices = opts.maxVoices || 64;
    this.maxEngines = opts.maxEngines || 10; this.engineCull = opts.engineCull || 180;
    this._cnt = { gain: 0, src: 0, media: 0, filter: 0, panner: 0 }; this._relc = { gain: 0, src: 0, media: 0, filter: 0, panner: 0 };
    this.stats = { played: 0, culled: 0, stolen: 0, notLoaded: 0, dropped: 0, fetched: 0, failed: 0, fetchedBytes: 0 };
    this._queue = []; this._active = 0; this._maxActive = opts.maxConcurrent || 4; this._seq = 0;
    this._timers = []; this._ducks = []; this._conc = 0; this._concHold = 0; this._danger = 0; this._dangerT = 0;
    this._lastFast = 0; this.dopplerScale = 1; this.eventLog = [];
    this.volumes = { master: 0.9, sfx: 0.85, music: 0.45, ambience: 0.55, ui: 0.9 };
    this.meterState = { peak: 0, rms: 0, peakMax: 0, hold: 0, clip: 0 };
    this._buildGraph();
    this.listener = new Listener(this);
    this.music = new MusicSys(this);
    this.ambience = new AmbienceSys(this);
    this._contextStateHandler = () => {
      const running = this.ctx.state === 'running'; this.music.setContextSuspended(!running);
      if (running && this._unl) { for (const ev of ['pointerdown', 'keydown', 'touchstart', 'mousedown']) window.removeEventListener(ev, this._unl, { capture: true }); this._unl = null; }
    };
    this.ctx.addEventListener?.('statechange', this._contextStateHandler);
    this._lastUi = new Map();
    if (!this.offline) {
      this._timer = setInterval(() => this._tickFast(), 25);
      if (opts.autoSuspend !== false && typeof document !== 'undefined') { this._visibilityHandler = () => this.setPaused(document.hidden); document.addEventListener('visibilitychange', this._visibilityHandler); }
    }
  }
  /** Hard pause (tab hidden / window blurred): fade the master out and suspend the context; false resumes. */
  setPaused(p) {
    const c = this.ctx, now = c.currentTime;
    if (p === this._paused) return; this._paused = p;
    this.music?.setPaused(p);
    if (p) { this.masterGain.gain.cancelScheduledValues(now); this.masterGain.gain.setTargetAtTime(0, now, 0.03); setTimeout(() => { if (this._paused && c.state === 'running') c.suspend().catch(() => {}); }, 250); } else { c.resume().then(() => { if (!this._paused && !this._disposed) this.music?.unlock(); }).catch(() => {}); this.masterGain.gain.cancelScheduledValues(c.currentTime); this.masterGain.gain.setTargetAtTime(this.volumes.master, c.currentTime, 0.05); }
  }
  get now() { return this.ctx.currentTime; }
  get state() { return this.ctx.state; }

  // -------------------------------------------------------------------------------------------------- graph
  _buildGraph() {
    const c = this.ctx, v = this.volumes;
    this.masterIn = c.createGain();
    this.concFilter = c.createBiquadFilter(); this.concFilter.type = 'lowpass'; this.concFilter.frequency.value = 20000; this.concFilter.Q.value = 0.6;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -9; this.comp.knee.value = 8; this.comp.ratio.value = 10; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.masterGain = c.createGain(); this.masterGain.gain.value = v.master;
    this.softclip = c.createWaveShaper();
    const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x); curve[i] = Math.sign(x) * (a < 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2)); }
    this.softclip.curve = curve; this.softclip.oversample = 'none';
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0;
    this._tdata = new Float32Array(this.analyser.fftSize);
    this.masterIn.connect(this.concFilter); this.concFilter.connect(this.comp); this.comp.connect(this.masterGain);
    this.masterGain.connect(this.softclip); this.softclip.connect(this.analyser); this.softclip.connect(c.destination);
    const bus = (g) => { const b = c.createGain(); b.gain.value = g; b.connect(this.masterIn); return b; };
    this.buses = { sfx: bus(v.sfx), music: bus(v.music), ambience: bus(v.ambience), ui: bus(v.ui) };
    // cabin: in the driver's cockpit the world is heard through the body shell (sfx gently darker, wind/road bed muffled)
    const cab = (b, q) => { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 20000; f.Q.value = q; b.disconnect(); b.connect(f); f.connect(this.masterIn); return f; };
    this.cabinSfx = cab(this.buses.sfx, 0.5); this.cabinAmb = cab(this.buses.ambience, 0.6); this._cabin = 0;
    this.musicDuck = c.createGain(); this.musicDuck.connect(this.buses.music);
    this.ambDuck = c.createGain(); this.ambDuck.connect(this.buses.ambience);
    this.stingerGain = c.createGain(); this.stingerGain.gain.value = 1.8; this.stingerGain.connect(this.buses.music); // stingers sit at sfx level; still follow the music slider
    this.busIn = { sfx: this.buses.sfx, ui: this.buses.ui, music: this.musicDuck, stinger: this.stingerGain, ambience: this.ambDuck };
    // outdoor reverb / slapback: pre-delay -> highpass -> convolver -> sfx bus
    this.reverbIn = c.createGain(); this.reverbIn.gain.value = 1;
    const pre = c.createDelay(0.2); pre.delayTime.value = 0.03;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
    this.convolver = c.createConvolver(); this.convolver.buffer = makeReverbIR(c, 1.5);
    this.reverbOut = c.createGain(); this.reverbOut.gain.value = 0.75; this.reverbLevel = 1;
    this.reverbIn.connect(pre); pre.connect(hp); hp.connect(this.convolver); this.convolver.connect(this.reverbOut); this.reverbOut.connect(this.buses.sfx);
    this._musicDuckV = 1; this._ambDuckV = 1;
  }
  setReverbLevel(k) { this.reverbLevel = k; this.reverbOut.gain.setTargetAtTime(0.75 * k, this.ctx.currentTime, 0.6); }
  /** Set any subset of {master,sfx,music,ambience,ui} (0..1). */
  setVolumes(v = {}) {
    const now = this.ctx.currentTime;
    for (const k of ['master', 'sfx', 'music', 'ambience', 'ui']) {
      if (v[k] === undefined) continue;
      this.volumes[k] = clamp(+v[k], 0, 1.5);
      const node = k === 'master' ? this.masterGain : this.buses[k];
      const muted = k === 'master' ? this._paused : this._gpPaused && (k === 'sfx' || k === 'ambience');
      node.gain.cancelScheduledValues(now);
      node.gain.setTargetAtTime(muted ? 0 : this.volumes[k], now, 0.03);
    }
    return this.volumes;
  }
  getVolumes() { return { ...this.volumes }; }

  // counted node factories
  _gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; this._cnt.gain++; return g; }
  _src() { this._cnt.src++; return this.ctx.createBufferSource(); }
  _media(element) { const src = this.ctx.createMediaElementSource(element); this._cnt.media++; return src; }
  _filter(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; this._cnt.filter++; return b; }
  _panner(ref, roll) {
    const p = this.ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 100000;
    p.coneInnerAngle = 360; p.coneOuterAngle = 360; this._cnt.panner++; return p;
  }
  _rel(t) { this._relc[t]++; }
  _free(node, t) { try { node.disconnect(); } catch { /* */ } this._relc[t]++; }
  _later(sec, fn) { this._timers.push({ t: this.ctx.currentTime + sec, fn }); }
  _log(type, o) { if (this.eventLog.length < 400) this.eventLog.push({ type, ...o }); }

  // -------------------------------------------------------------------------------------------------- manifest
  async init(manifestUrl = '/audio/manifest.json') {
    this.manifestUrl = manifestUrl; this.baseUrl = manifestUrl.replace(/[^/]*$/, '');
    await this.refreshManifest();
    this._installUnlock();
    return this;
  }
  /** Re-read the manifest (the asset builder keeps adding sounds). Returns { added, changed, total }. */
  async refreshManifest() {
    const res = await fetch(this.manifestUrl + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('manifest ' + res.status);
    return this.ingestManifest(await res.json());
  }
  /** Merge a manifest object (also used by tests to inject synthetic libraries). */
  ingestManifest(man, opts = {}) {
    const added = [], changed = [];
    const sounds = man.sounds || {};
    for (const [key, m] of Object.entries(sounds)) {
      const files = m.files || (m.file ? [m.file] : []);
      let def = this.defs.get(key);
      const sig = JSON.stringify([files, m.durations || m.duration, m.peakDb, m.lufs, !!m.streaming]);
      if (!def) { def = { key, bufs: [], loading: [], failed: [], voices: [], waiters: [], last: -1, sig }; this.defs.set(key, def); added.push(key); }
      else if (def.sig !== sig && !def.injected) { def.sig = sig; def.bufs = []; def.loading = []; def.failed = []; changed.push(key); }
      const i = key.indexOf('/');
      def.group = i < 0 ? '' : key.slice(0, i); def.name = i < 0 ? key : key.slice(i + 1);
      def.files = files; def.urls = files.map((f) => this.baseUrl + f);
      def.gain = m.gain ?? 1; def.loop = !!m.loop; def.category = m.category || ''; def.duration = m.duration || 0;
      def.cat = CAT[def.category] || CAT_DEFAULT; def.bus = def.cat.bus || 'sfx'; def.meta = m;
      def.cap = CAP_BY_NAME[def.name] ?? def.cat.cap;
      if (opts.injected) def.injected = true;
    }
    this.byBare.clear();
    for (const k of this.defs.keys()) { const b = k.slice(k.indexOf('/') + 1); if (!this.byBare.has(b)) this.byBare.set(b, k); }
    this.manifest = { ...(this.manifest || {}), ...man };
    this._buildEngineTable(man);
    this.music._rebuild();
    for (const k of this.missing.keys()) if (this.has(k)) this.missing.delete(k);
    return { added, changed, total: this.defs.size };
  }
  _buildEngineTable(man) {
    const tbl = new Map();
    for (const d of this.defs.values()) {
      let id = d.meta.engine, stage = d.meta.stage, rpm = d.meta.rpm;
      if (!id) { const r = /^(engine_.+)_(idle|low|mid|high|redline)$/.exec(d.name); if (r && d.loop) { id = r[1]; stage = r[2]; rpm = STAGE_DEFAULT_RPM[stage]; } }
      if (!id || !stage) continue;
      if (!tbl.has(id)) tbl.set(id, []);
      tbl.get(id).push({ id, stage, rpm: rpm || STAGE_DEFAULT_RPM[stage], def: d, fireHz: d.meta.fireHz });
    }
    for (const [id, list] of tbl) { list.sort((a, b) => a.rpm - b.rpm); this.engineTable.set(id, list); }
    void man;
  }
  engineIds() { return [...this.engineTable.keys()]; }
  has(name) {
    if (this.resolve(name, true)) return true;
    let m = /^ambience\/(\w+)$/.exec(name); if (m) return this.ambience._resolveBed(m[1]).length > 0;
    m = /^music\/(\w+)$/.exec(name); if (m) return this.music.trackIds(m[1]).length > 0;
    return false;
  }
  /** name: 'group/name' or bare name. */
  resolve(name, quiet) {
    let d = this.defs.get(name);
    if (!d) { const k = this.byBare.get(name); if (k) d = this.defs.get(k); }
    if (!d && !quiet) this.missing.set(name, (this.missing.get(name) || 0) + 1);
    return d || null;
  }
  /** First candidate (string name or RegExp on the full key) that exists. */
  find(...cands) {
    for (const c of cands) {
      if (typeof c === 'string') { const d = this.resolve(c, true); if (d) return d; } else { for (const d of this.defs.values()) if (c.test(d.key)) return d; }
    }
    return null;
  }
  expect(names) { for (const n of names) this.expected.add(n); }
  /** Expected-but-absent names + names that were requested and not found. */
  reportMissing() {
    const out = new Set();
    for (const n of this.expected) if (!this.has(n)) out.add(n);
    for (const n of this.missing.keys()) if (!this.has(n)) out.add(n);
    return [...out].sort();
  }
  engineIdFor(spec) {
    const sid = spec?.id;
    let id = spec?.audio?.engine || ENGINE_MAP[sid];
    if (!id && sid && /boss|leviathan|warrig|war_rig/.test(sid)) id = 'engine_boss';
    if (id && this.engineTable.has(id)) return id;
    if (spec && sid && this.engineTable.has('engine_' + sid)) return 'engine_' + sid;
    const kind = spec?.kind;
    const fb = kind === 'player' ? 'engine_player_t1' : 'engine_sedan';
    if (!id) id = fb;
    return id;
  }
  /** Register a decoded buffer (or several variations) under a manifest-like key (used by tests). */
  injectSound(key, buffers, meta = {}) {
    const arr = _isArr(buffers) ? buffers : [buffers];
    const man = { sounds: { [key]: { files: arr.map((_, i) => `_inj/${key}_${i}.ogg`), duration: arr[0].duration, durations: arr.map((b) => b.duration), loop: false, gain: 1, category: 'sfx', channels: arr[0].numberOfChannels, ...meta } } };
    this.ingestManifest(man, { injected: true });
    const d = this.defs.get(key); d.bufs = arr.slice(); return d;
  }

  // -------------------------------------------------------------------------------------------------- loading
  /** Load all variations of a sound / def / array of them. Lower prio value = sooner (0 critical, 1 normal, 2 music/ambience, 3 background). */
  load(what, prio = 1) {
    const list = _isArr(what) ? what : [what], ps = [];
    for (const w of list) {
      const d = typeof w === 'string' ? this.resolve(w) : w;
      if (!d || d.meta?.streaming) continue;
      for (let i = 0; i < d.urls.length; i++) ps.push(this._loadVar(d, i, prio).catch(() => null));
    }
    return Promise.all(ps);
  }
  /** One cold-loop batch per definition; failed batches may retry after one audio second. */
  _requestLoopLoad(def) {
    const now = this.ctx.currentTime, previous = def._loopLoad;
    if (previous && previous.signature === def.sig && previous.buffers === def.bufs && previous.loading === def.loading && (previous.pending || now < previous.retryAt)) return;
    const state = { signature: def.sig, buffers: def.bufs, loading: def.loading, pending: true, retryAt: 0 };
    def._loopLoad = state;
    // The callback owns no layer or destination graph, and never starts audio.
    const settled = () => {
      state.pending = false;
      if (def._loopLoad !== state || hasDecodedVariation(def)) { state.buffers = state.loading = null; state.retryAt = 0; }
      else state.retryAt = this.ctx.currentTime + 1;
    };
    this.load(def, 0).then(settled, settled);
  }
  /** Names or RegExp (on the full key). */
  preload(names, prio = 1) {
    const out = [];
    for (const n of names) {
      if (n instanceof RegExp) { for (const d of this.defs.values()) if (n.test(d.key)) out.push(d); } else { const d = this.resolve(n, true); if (d) out.push(d); }
    }
    return this.load(out, prio);
  }
  preloadEngine(engineId, prio = 0) { const t = this.engineTable.get(engineId); return t ? this.load(t.map((s) => s.def), prio) : Promise.resolve([]); }
  _loadVar(def, i, prio = 1) {
    if (this._disposed || def.meta?.streaming) return Promise.resolve(null);
    if (def.bufs[i]) return Promise.resolve(def.bufs[i]);
    const cur = def.loading[i];
    if (cur) { if (prio < cur.prio) { cur.prio = prio; const t = this._queue.find((q) => q.rec === cur); if (t) t.prio = prio; } return cur.promise; }
    const rec = { prio, promise: null }, buffers = def.bufs, loading = def.loading, failed = def.failed, signature = def.sig, url = def.urls[i];
    const owns = () => !this._disposed && def.bufs === buffers && def.loading === loading && def.sig === signature && def.urls[i] === url && loading[i] === rec;
    let resolve, reject;
    rec.promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    def.loading[i] = rec;
    this._queue.push({ prio, seq: this._seq++, rec, run: async () => {
        if (!owns()) { resolve(null); return; }
        try {
          const r = await fetch(url, { cache: this.fetchCache });
          if (!r.ok) throw new Error(url + ' ' + r.status);
          const ab = await r.arrayBuffer(), nb = ab.byteLength; // decodeAudioData detaches `ab`
          if (!owns()) { resolve(null); return; }
          const buf = await this.ctx.decodeAudioData(ab);
          this.stats.fetched++; this.stats.fetchedBytes += nb;
          if (!owns()) { resolve(null); return; }
          buffers[i] = buf; loading[i] = null; failed[i] = false;
          if (def.waiters.length) { const ws = def.waiters.splice(0); for (const w of ws) w.attach(this._pickBuf(def)); }
          resolve(buf);
        } catch (e) { this.stats.failed++; if (owns()) { failed[i] = true; loading[i] = null; } reject(e); }
      }, res: resolve, rej: reject });
    this._pump();
    return rec.promise;
  }
  _pump() {
    while (this._active < this._maxActive && this._queue.length) {
      let bi = 0;
      for (let k = 1; k < this._queue.length; k++) { const a = this._queue[k], b = this._queue[bi]; if (a.prio < b.prio || (a.prio === b.prio && a.seq < b.seq)) bi = k; }
      const t = this._queue.splice(bi, 1)[0];
      this._active++;
      t.run().finally(() => { this._active--; this._pump(); });
    }
  }
  /** Run cb now if the first variation of every def is decoded, else after loading (errors are logged). */
  whenReady(defs, prio, cb) {
    const list = defs.filter(Boolean);
    if (list.every((d) => d.bufs[0])) { cb(); return; }
    this.load(list, prio).then(() => { try { cb(); } catch (e) { console.warn('[audio] deferred start failed', e); } });
  }
  loadingCount() { return this._queue.length + this._active; }
  /** A random loaded variation (never the same twice in a row) or null. */
  _pickBuf(def, force) {
    const vi = this._pickVar(def, force);
    return vi < 0 ? null : def.bufs[vi];
  }
  _pickVar(def, force) {
    const n = def.urls.length;
    if (force !== undefined) { const i = clamp(force | 0, 0, n - 1); if (def.bufs[i]) return i; this._loadVar(def, i, 0).catch(() => {}); return -1; }
    let cnt = 0; const ready = [];
    for (let i = 0; i < n; i++) if (def.bufs[i]) { ready.push(i); cnt++; }
    if (!cnt) { this.load(def, 0); return -1; }
    if (cnt < n) for (let i = 0; i < n; i++) if (!def.bufs[i] && !def.loading[i] && !def.failed[i]) this._loadVar(def, i, 1).catch(() => {});
    let i = ready[Math.floor(this.rand() * ready.length) % ready.length];
    if (ready.length > 1 && i === def.last) i = ready[(ready.indexOf(i) + 1 + Math.floor(this.rand() * (ready.length - 1))) % ready.length];
    def.last = i; return i;
  }
  unload(def) { def.bufs = []; def.loading = []; def.failed = []; }
  defInUse(def) { return def.voices.length > 0 || (this.music.cur && this.music.cur.stems.some((s) => s.def === def)) || this.music.fading.some((f) => f.stems.some((s) => s.def === def)); }
  bufferStats() {
    let count = 0, bytes = 0;
    for (const d of this.defs.values()) for (const b of d.bufs) if (b) { count++; bytes += b.length * b.numberOfChannels * 4; }
    return { ...this.stats, count, bytes, queued: this._queue.length, active: this._active };
  }

  // -------------------------------------------------------------------------------------------------- unlock
  _installUnlock() {
    if (this.offline || this._unl) return;
    const h = () => { this.unlock(); };
    this._unl = h;
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'mousedown']) window.addEventListener(ev, h, { capture: true, passive: true });
  }
  /** Resume the context. Call from any click / key handler (also installed automatically on the first gesture). */
  unlock() {
    const c = this.ctx;
    const p = c.state !== 'running' && c.state !== 'closed' && c.resume ? c.resume().catch(() => {}) : Promise.resolve();
    if (!this._silent && !this.offline) { this._silent = true; try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0); } catch { /* */ } }
    return p.then(() => { if (!this._paused && !this._disposed) this.music?.unlock(); });
  }

  // -------------------------------------------------------------------------------------------------- play
  /** Manual Doppler ratio for a source with velocity `vel` at `pos` heard by the listener. */
  doppler(pos, vel, scale = this.dopplerScale) {
    if (!vel || !scale) return 1;
    const L = this.listener;
    const px = _isArr(pos) ? pos[0] : pos.x, py = _isArr(pos) ? pos[1] : pos.y, pz = _isArr(pos) ? pos[2] : pos.z;
    const dx = px - L.pos.x, dy = py - L.pos.y, dz = pz - L.pos.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1.5) return 1;
    const nx = dx / d, ny = dy / d, nz = dz / d;
    const vl = L.vel.x * nx + L.vel.y * ny + L.vel.z * nz;
    const vs = (_isArr(vel) ? vel[0] : vel.x) * nx + (_isArr(vel) ? vel[1] : vel.y) * ny + (_isArr(vel) ? vel[2] : vel.z) * nz;
    return clamp((C_SOUND + vl * scale) / (C_SOUND + vs * scale), 0.7, 1.45);
  }
  /**
   * play(name, {pos, vel, gain, pitch, pitchVar, loop, bus, delay, slap, refDist, rolloff, variation, fadeIn, offset, duration, lowpass, airAbsorb, wait, force})
   * Returns a handle (a Voice, or NULL_HANDLE when the name is missing / not loaded / too far / context suspended).
   */
  play(name, o = {}) {
    const def = name && typeof name === 'object' ? name : this.resolve(name);
    if (!def || def.meta?.streaming) return NULL_HANDLE;
    if (!this.offline && this.ctx.state !== 'running' && !o.force) return NULL_HANDLE;
    const loop = !!o.loop, cat = def.cat;
    let d = 0;
    if (o.pos) d = this.listener.distTo(o.pos);
    const g = o.gain ?? 1;
    const est = g * def.gain * (o.pos ? attGain(d, o.refDist ?? cat.ref, o.rolloff ?? 1) : 1);
    if (o.pos && !loop && !o.noCull && est < 0.004) { this.stats.culled++; return NULL_HANDLE; }
    const vi = this._pickVar(def, o.variation);
    if (vi < 0 && !(loop || o.wait)) { this.stats.notLoaded++; this.notLoadedNames.add(def.key); return NULL_HANDLE; }
    if (!this._admit(def, (cat.prio ?? 0.5) * est, loop)) { this.stats.dropped++; return NULL_HANDLE; }
    const v = new Voice(this, def, o, d);
    def.voices.push(v); this.voices.add(v); if (v.dynamic) this._dyn.add(v);
    def.plays = (def.plays || 0) + 1;
    if (vi >= 0) v.attach(def.bufs[vi]); else def.waiters.push(v);
    this.stats.played++;
    return v;
  }
  _admit(def, score, loop = false) {
    if (def.voices.length >= def.cap) {
      let victim = def.voices[0];
      if (loop) {
        // Persistent beds keep the most audible sources; stable ties avoid
        // repeatedly replacing an already playing loop with the same sound.
        victim = null;
        for (const v of def.voices) if (!v.ended && !v.stopped && (!victim || v.score < victim.score)) victim = v;
        if (!victim || (victim.loop && victim.score >= score)) return false;
      }
      victim.stop(0.012); this._voiceEnded(victim, true); this.stats.stolen++;
    }
    if (this.voices.size >= this.maxVoices) {
      let victim = null, vs = Infinity; const now = this.ctx.currentTime;
      for (const v of this.voices) { const s = v.score - (now - v.age0) * 0.01; if (s < vs && !v.loop) { vs = s; victim = v; } }
      if (!victim || vs > score) return false;
      victim.stop(0.012); this._voiceEnded(victim, true); this.stats.stolen++;
    }
    return true;
  }
  _voiceEnded(v, early) {
    const i = v.def.voices.indexOf(v); if (i >= 0) v.def.voices.splice(i, 1);
    const pending = v.def.waiters.indexOf(v); if (pending >= 0) v.def.waiters.splice(pending, 1);
    this.voices.delete(v); this._dyn.delete(v);
    void early;
  }
  /** Plays a UI sound: click hover buy error coin upgrade_unlock ready countdown_beep go menu_open menu_close whoosh_transition. */
  ui(name, o = {}) {
    const now = this.ctx.currentTime, last = this._lastUi.get(name) || -9;
    if (now - last < (name === 'hover' ? 0.045 : 0.02)) return NULL_HANDLE;
    this._lastUi.set(name, now);
    const d = this.resolve('ui/' + name);
    if (!d) return NULL_HANDLE;
    return this.play(d, { bus: 'ui', pitchVar: o.pitchVar ?? 0.02, ...o, pos: undefined, force: true });
  }
  /** run_start game_over boss_intro boss_defeated victory danger_riser (music-bus one-shots that duck the music). */
  stinger(name, o = {}) {
    const d = this.find('stingers/' + name, 'stinger_' + name, name);
    if (!d) { this.missing.set('stingers/' + name, (this.missing.get('stingers/' + name) || 0) + 1); return NULL_HANDLE; }
    this.duck(o.duck ?? 0.65, { hold: Math.max(0.3, d.duration * 0.7), release: 1.2 });
    return this.play(d, { bus: 'stinger', pitchVar: 0, gain: o.gain ?? 1, force: true });
  }
  /** Stop every one-shot / loop voice (fade). Engines, music and ambience are not affected. */
  stopAll(fade = 0.05) { for (const v of [...this.voices]) v.stop(fade); }
  engine(carId, spec, o = {}) {
    let e = this.engines.get(carId);
    if (e && !e.disposed) return e;
    e = new EngineSound(this, carId, spec, o);
    this.engines.set(carId, e);
    return e;
  }
  removeEngine(carId, fade) { const e = this.engines.get(carId); if (e) e.dispose(fade); }

  // -------------------------------------------------------------------------------------------------- effects
  /** Duck music (and a bit of ambience): amount 0..1 reduction, held `hold` s then released over ~`release` s. */
  duck(amount, o = {}) {
    const now = this.ctx.currentTime;
    this._ducks.push({ amt: clamp01(amount), until: now + (o.hold ?? 0.4), rel: o.release ?? 1.0 });
    if (this._ducks.length > 16) this._ducks.shift();
  }
  /** Heavy hit / explosion next to the camera: master low-pass dive + tinnitus, recovers in ~2 s. */
  concussion(amount = 1) {
    amount = clamp01(amount);
    if (amount <= this._conc * 0.8 && this.ctx.currentTime < this._concHold) return;
    this._conc = Math.max(this._conc, amount); this._concPeak = this._conc;
    this._concHold = this.ctx.currentTime + 0.1 + 0.3 * amount; this._concRel = 0.9 + 1.6 * amount;
  }
  /** 0..1: heartbeat (>0.25) + warning alarm (>0.55) loops. */
  setDanger(v) { this._danger = clamp01(v); }
  /** Solo pause fades world sounds; UI and music remain audible. */
  setGameplayPaused(p) {
    p = !!p;
    if (p === this._gpPaused) return;
    this._gpPaused = p;
    const now = this.ctx.currentTime;
    for (const k of ['sfx', 'ambience']) {
      const gain = this.buses[k].gain;
      gain.cancelScheduledValues(now);
      gain.setTargetAtTime(p ? 0 : this.volumes[k], now, p ? 0.04 : 0.12);
    }
  }
  /** 0 = open air (gunner in the bed), 1 = inside the cab (driver cockpit). Smoothly crossfaded. */
  setCabin(k) {
    k = clamp01(k); if (Math.abs(k - this._cabin) < 0.01) return; this._cabin = k;
    const now = this.ctx.currentTime;
    this.cabinSfx.frequency.setTargetAtTime(lerp(20000, 7500, k), now, 0.08);
    this.cabinAmb.frequency.setTargetAtTime(lerp(20000, 1500, k), now, 0.08);
  }
  _tickEffects(now, dt) {
    // ducking (music fully, ambience partly)
    let m = 1, a = 1;
    for (let i = this._ducks.length - 1; i >= 0; i--) {
      const d = this._ducks[i]; let amt = d.amt;
      if (now > d.until) { amt *= Math.exp(-(now - d.until) / (d.rel / 3)); if (amt < 0.01) { this._ducks.splice(i, 1); continue; } }
      m = Math.min(m, 1 - amt); a = Math.min(a, 1 - amt * 0.55);
    }
    if (Math.abs(m - this._musicDuckV) > 1e-3 || this._ducks.length) {
      this.musicDuck.gain.setTargetAtTime(m, now, m < this._musicDuckV ? 0.02 : 0.15); this.ambDuck.gain.setTargetAtTime(a, now, a < this._ambDuckV ? 0.02 : 0.2);
      this._musicDuckV = m; this._ambDuckV = a;
    }
    // concussion: low-pass dive + tinnitus
    if (this._conc > 0.002) {
      if (now > this._concHold) this._conc *= Math.exp(-dt / (this._concRel / 4));
      const c = this._conc, fc = Math.exp(lerp(Math.log(20000), Math.log(450), Math.pow(c, 0.7)));
      this.concFilter.frequency.setTargetAtTime(fc, now, now <= this._concHold ? 0.012 : 0.12);
      if (!this._tin) { this._tin = this.ctx.createOscillator(); this._tin.frequency.value = 4300; this._tinG = this.ctx.createGain(); this._tinG.gain.value = 0; this._tin.connect(this._tinG); this._tinG.connect(this.buses.sfx); this._tin.start(); }
      this._tinG.gain.setTargetAtTime(0.03 * Math.pow(c, 1.3), now, 0.1);
      this._concActive = true;
    } else if (this._concActive) {
      this._conc = 0; this._concActive = false;
      this.concFilter.frequency.setTargetAtTime(20000, now, 0.12); if (this._tinG) this._tinG.gain.setTargetAtTime(0, now, 0.15);
    }
    // danger loops
    const dg = this._danger;
    if (dg > 0.02 || this._dangerLayers) {
      if (!this._dangerLayers) {
        this._dangerLayers = { hb: new LoopLayer(this, this.find('stingers/low_health_heartbeat_loop', /heart/), this.buses.sfx, { rMin: 0.8, rMax: 1.5, randomOffset: false }), al: new LoopLayer(this, this.find('stingers/warning_alarm_loop', /alarm/), this.buses.sfx, { rMin: 0.8, rMax: 1.5, randomOffset: false }) };
        this.expect(['stingers/low_health_heartbeat_loop', 'stingers/warning_alarm_loop']);
      }
      const L = this._dangerLayers;
      L.hb.set(smoothstep(0.2, 0.9, dg) * 0.85, 0.9 + 0.5 * dg, 0.15);
      L.al.set(smoothstep(0.55, 0.95, dg) * 0.5, 1, 0.2);
    }
  }
  // -------------------------------------------------------------------------------------------------- per frame
  /** Call once per frame (dt in seconds): engine arbitration, moving voices, music/ambience scheduling, housekeeping. */
  update(dt = 1 / 60) {
    this.dt = dt; this.buildBudget = 2;
    const now = this.ctx.currentTime;
    // engines: nearest first, max N audible, cull beyond ~180 m (with hysteresis)
    const list = [];
    for (const e of this.engines.values()) if (!e.disposed) list.push(e);
    if (list.length) {
      list.sort((a, b) => (a.player ? -1 : b.player ? 1 : a.dist - b.dist));
      let ok = 0;
      for (const e of list) {
        const allow = e.player || (ok < this.maxEngines && e.dist < (e.allowed ? this.engineCull : this.engineCull - 15) && !e.killed);
        e.setAllowed(allow); if (allow) ok++;
      }
    }
    for (const v of this._dyn) v._spatial(now);
    if (this.offline || !this._timer) this._tickFast();
    return this;
  }
  _tickFast() {
    const c = this.ctx, now = c.currentTime;
    const dt = this._lastFast ? clamp(now - this._lastFast, 0.001, 0.25) : 0.025;
    if (now === this._lastFast) return;
    this._lastFast = now;
    this.music.tick(now); this.ambience.tick(now);
    this._tickEffects(now, dt);
    if (this._timers.length) { for (let i = this._timers.length - 1; i >= 0; i--) if (now >= this._timers[i].t) { const t = this._timers.splice(i, 1)[0]; try { t.fn(); } catch { /* */ } } }
    // safety sweep: voices whose 'ended' event never came
    for (const v of this.voices) if (!v.ended && now > v.endEst) v._cleanup();
    if (!this.offline && c.state === 'running') this._tickMeter();
  }
  _tickMeter() {
    const a = this.analyser, d = this._tdata; a.getFloatTimeDomainData(d);
    let pk = 0, ss = 0; for (let i = 0; i < d.length; i++) { const x = d[i], ax = x < 0 ? -x : x; if (ax > pk) pk = ax; ss += x * x; }
    const m = this.meterState; m.peak = pk; m.rms = Math.sqrt(ss / d.length); if (pk > m.peakMax) m.peakMax = pk; if (pk >= 0.999) m.clip++;
    m.hold = Math.max(pk, m.hold * 0.97);
  }
  meterReset() { const m = this.meterState; m.peakMax = 0; m.clip = 0; m.hold = 0; }
  /** Live counts of dynamic nodes (created - released = live). All must return to the loop baseline when the game is quiet. */
  graphStats() {
    const live = {}; for (const k of Object.keys(this._cnt)) live[k] = this._cnt[k] - this._relc[k];
    let engBuilt = 0, engAllowed = 0; for (const e of this.engines.values()) { if (e.built) engBuilt++; if (e.allowed && !e.disposed) engAllowed++; }
    const b = this.bufferStats();
    return { ctxState: this.ctx.state, sampleRate: this.ctx.sampleRate, time: +this.ctx.currentTime.toFixed(3), baseLatency: this.ctx.baseLatency ?? null,
      voices: this.voices.size, dynamicVoices: this._dyn.size, created: { ...this._cnt }, released: { ...this._relc }, live, engines: this.engines.size, enginesBuilt: engBuilt, enginesAllowed: engAllowed,
      buffers: b.count, bufferMB: +(b.bytes / 1048576).toFixed(1), loading: b.queued + b.active,
      musicStreams: [this.music.cur, ...this.music.fading, this.music._streamPending].filter(p => p?.streaming && !p.dead).length,
      musicStreamPending: !!this.music._streamPending, stats: { ...this.stats }, missing: this.reportMissing().length };
  }
  dispose() {
    if (this._disposed) return; this._disposed = true;
    if (this._timer) clearInterval(this._timer);
    if (this._visibilityHandler && typeof document !== 'undefined') { document.removeEventListener('visibilitychange', this._visibilityHandler); this._visibilityHandler = null; }
    if (this._unl && typeof window !== 'undefined') { for (const ev of ['pointerdown', 'keydown', 'touchstart', 'mousedown']) window.removeEventListener(ev, this._unl, { capture: true }); this._unl = null; }
    if (this._contextStateHandler) { this.ctx.removeEventListener?.('statechange', this._contextStateHandler); this._contextStateHandler = null; }
    for (const v of [...this.voices]) v._cleanup();
    for (const e of [...this.engines.values()]) { e.disposed = true; e._releaseAll(); }
    this.music.dispose();
    for (const def of this.defs.values()) this.unload(def);
    this.ctx.close?.().catch(() => {});
  }
}

// ------------------------------------------------------------------------------------------------------------ reverb IR
/** Procedural outdoor reverb: pre-echo, two canyon slaps, dark exponential noise tail. */
export function makeReverbIR(ctx, rt60 = 1.5) {
  const sr = ctx.sampleRate, len = Math.floor(sr * (rt60 * 1.15)), buf = ctx.createBuffer(2, len, sr);
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, a = Math.exp(-6.9078 * t / rt60);
      const k = Math.exp(-2 * PI * lerp(6500, 1100, Math.min(1, t / rt60)) / sr); // one-pole low-pass sweeping darker
      lp = k * lp + (1 - k) * rnd();
      d[i] = lp * a * (t < 0.012 ? t / 0.012 : 1) * 2.2;
    }
    for (const [tm, g] of [[0.11 + 0.012 * ch, 0.55], [0.27 - 0.02 * ch, 0.35], [0.46 + 0.03 * ch, 0.2]]) {
      const s = Math.floor(tm * sr);
      for (let j = 0; j < sr * 0.025; j++) { const x = Math.exp(-j / (sr * 0.006)); if (s + j < len) d[s + j] += rnd() * g * x * 1.5; }
    }
  }
  return buf;
}

// Full mixed soundtrack playback. Browser media decoding stays outside the
// AudioBuffer cache; only the current cue and its outgoing fade own an element.
export class StreamingMusicBed {
  constructor(A, track, dest, Fader) {
    if (track.stems.length !== 1 || !track.stems[0].def.meta?.streaming) throw new Error('A streamed music cue must contain one complete mix');
    this.A = A; this.track = track; this.streaming = true; this.dead = false;
    this.loop = track.loop !== false; this.endAt = Infinity; this.t0 = 0; this.prev = null;
    this.ready = false; this.active = false; this.failed = false; this.ended = false;
    this.paused = !!A._paused; this.status = 'loading'; this.error = null; this._playPending = null; this.retryAt = 0;
    const def = track.stems[0].def;
    if (!def.urls?.[0]) throw new Error('Streamed music cue has no file');
    this.media = A.opts?.mediaFactory ? A.opts.mediaFactory() : document.createElement('audio');
    this.media.preload = 'auto'; this.media.loop = this.loop; this.media.crossOrigin = 'anonymous';
    this.dur = Number(def.duration || def.meta.duration) || 0;
    this.out = A._gain(0); this.out.connect(dest); this.fader = new Fader(A, this.out.gain, 0);
    const g = A._gain(def.gain);
    let src;
    try { src = A._media(this.media); src.connect(g); g.connect(this.out); }
    catch (error) {
      if (src) { try { src.disconnect(); } catch { /* disconnected */ } A._rel('media'); }
      A._free(g, 'gain'); A._free(this.out, 'gain'); this.media.pause(); throw error;
    }
    this.stems = [{ src, g, key: def.key, layer: 0, target: def.gain, def, name: 'base' }];
    this._listeners = [];
    this._listen('loadedmetadata', () => { if (Number.isFinite(this.media.duration) && this.media.duration > 0) this.dur = this.media.duration; });
    this._listen('ended', () => { if (!this.loop) { this.ended = true; this.status = 'ended'; } });
    this._listen('error', () => {
      this.failed = true; this.status = 'failed';
      this.error = new Error('Music media failed: ' + (this.media.error?.code || 'unknown'));
      this._settleReady(this.error); this._cancelPlay?.(this.error);
    });
    this.media.src = def.urls[0];
  }
  _listen(type, handler) { this.media.addEventListener(type, handler); this._listeners.push([type, handler]); }
  _settleReady(error) {
    if (!this._readyResolve) return;
    clearTimeout(this._readyTimer);
    const resolve = this._readyResolve, reject = this._readyReject;
    this._readyResolve = this._readyReject = null;
    if (error) reject(error); else { this.ready = true; this.status = 'ready'; resolve(this); }
  }
  prepare() {
    if (this.dead) return Promise.reject(new Error('Music media retired'));
    if (this.failed) return Promise.reject(this.error);
    if (this.ready) return Promise.resolve(this);
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = new Promise((resolve, reject) => {
      this._readyResolve = resolve; this._readyReject = reject;
      this._listen('canplay', () => this._settleReady());
      this._readyTimer = setTimeout(() => this._settleReady(new Error('Music media readiness timed out')), 15000);
      this._readyTimer.unref?.();
      try { this.media.load(); } catch (error) { this._settleReady(error); }
      if (this.media.readyState >= 3) this._settleReady();
    });
    return this._readyPromise;
  }
  play() {
    if (this.dead || this.failed) return Promise.reject(this.error || new Error('Music media retired'));
    if (this.paused) return Promise.resolve(false);
    if (this._playPending) return this._playPending;
    const pending = new Promise((resolve, reject) => {
      let settled = false;
      const settle = (error, playing) => {
        if (settled) return; settled = true; clearTimeout(this._playTimer); this._cancelPlay = null;
        if (error) { this.status = this.failed ? 'failed' : 'blocked'; this.error = error; reject(error); } else resolve(playing);
      };
      this._cancelPlay = error => { settle(error || null, false); this._playPending = null; };
      this._playTimer = setTimeout(() => {
        const error = new Error('Music media play timed out'); error.name = 'TimeoutError';
        this.media.pause(); settle(error);
      }, this.A.opts?.mediaPlayTimeoutMs ?? 8000);
      this._playTimer.unref?.();
      let result;
      try { result = this.media.play(); } catch (error) { result = Promise.reject(error); }
      Promise.resolve(result).then(() => {
        if (this.dead || this.paused) { this.media.pause(); settle(null, false); return; }
        if (this.failed) { this.media.pause(); settle(this.error); return; }
        if (settled) return;
        this.status = 'playing'; settle(null, true);
      }, error => {
        if (settled) return;
        if (this.dead || this.paused) settle(null, false); else settle(error);
      });
    });
    const tracked = pending.finally(() => { if (this._playPending === tracked) this._playPending = null; });
    this._playPending = tracked;
    return this._playPending;
  }
  begin(fadeIn = 1.2) {
    this.active = true; this.t0 = this.A.ctx.currentTime - (this.media.currentTime || 0);
    this.fader.to(1, fadeIn); this.status = 'playing';
  }
  setPaused(paused) {
    if (this.dead) return;
    this.paused = !!paused;
    if (this.paused) { this._cancelPlay?.(); this.media.pause(); this.status = 'paused'; }
  }
  fadeOut(dur = 1.2, when) {
    const now = this.A.ctx.currentTime, t = Math.max(when ?? now, now);
    this.fader.to(0, dur, t); this.endAt = t + Math.max(dur, .004) + .08;
  }
  cancelFadeOut() { this.fader.to(1, .05); this.endAt = Infinity; }
  dispose() {
    if (this.dead) return;
    this.dead = true; this.active = false; this.status = 'retired';
    this._settleReady(new Error('Music media retired')); clearTimeout(this._readyTimer); this._cancelPlay?.(); clearTimeout(this._playTimer);
    for (const [type, handler] of this._listeners) this.media.removeEventListener(type, handler);
    this._listeners.length = 0; this.media.pause();
    this.media.removeAttribute('src');
    try { this.media.load(); } catch { /* release unsupported media implementations */ }
    for (const s of this.stems) { try { s.src.disconnect(); } catch { /* already disconnected */ } this.A._rel('media'); this.A._free(s.g, 'gain'); }
    this.A._free(this.out, 'gain'); this.stems = []; this.prev = null;
  }
}

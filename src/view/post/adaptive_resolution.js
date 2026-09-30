// Resolution decisions use sustained frame pressure, so a missed browser
// refresh or a background-tab pause cannot repeatedly resize GPU buffers.
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const roundScale = value => Math.round(value * 1000) / 1000;

export class AdaptiveResolutionController {
  constructor(ceiling = 1) { this.reset(ceiling); }

  reset(ceiling = this.ceiling ?? 1) {
    this.ceiling = Number.isFinite(ceiling) ? clamp(ceiling, 0.5, 1) : 1;
    this.averageMs = 16.7;
    this.observedMs = 0; this.fastMs = 0;
    this.samples = []; this.sampleHead = 0;
    this.windowMs = 0; this.windowMisses = 0;
    this.current = null;
  }

  /** Return a new scale only when a decision is ready; otherwise return null. */
  update(frameMs, current, ceiling = this.ceiling) {
    if (!Number.isFinite(current) || !Number.isFinite(ceiling)) { this.reset(); return null; }
    ceiling = clamp(ceiling, 0.5, 1);
    current = clamp(current, 0.5, 1);
    if (ceiling !== this.ceiling || (this.current !== null && Math.abs(current - this.current) > 0.0001)) this.reset(ceiling);
    this.current = current;
    // A setting change takes effect immediately, even before enough samples
    // have accumulated to make an automatic performance decision.
    if (current > ceiling) return this._change(ceiling);
    if (!Number.isFinite(frameMs) || frameMs < 1 || frameMs > 100) {
      // Loading, sleep and inactive tabs break a continuous observation period.
      this.reset(ceiling); this.current = current;
      return null;
    }

    this.averageMs += (frameMs - this.averageMs) * 0.04;
    this.observedMs += frameMs;
    this.samples.push(frameMs); this.windowMs += frameMs;
    if (frameMs > 17.8) this.windowMisses++;
    // Retain at least two seconds, including the frame crossing its boundary.
    // A cursor avoids shifting an array on every frame.
    while (this.windowMs - this.samples[this.sampleHead] >= 2000) {
      const expired = this.samples[this.sampleHead++];
      this.windowMs -= expired;
      if (expired > 17.8) this.windowMisses--;
    }
    if (this.sampleHead >= 1024) { this.samples = this.samples.slice(this.sampleHead); this.sampleHead = 0; }
    this.fastMs = this.averageMs < 16.9 ? this.fastMs + frameMs : 0;

    const floor = Math.min(0.65, ceiling);
    const frames = this.samples.length - this.sampleHead;
    // The window mean captures 55-60 fps refresh patterns whose EWMA briefly
    // dips between misses. Require actual repeated misses as well, so one
    // unusually expensive frame cannot trigger a resize.
    const sustained = this.windowMs / frames > 17.8;
    if (current > floor && this.observedMs >= 2000 && frames >= 20 && sustained && this.windowMisses / frames >= 0.05) {
      return this._change(Math.max(floor, roundScale(current - 0.1)));
    }
    if (current < ceiling && this.fastMs >= 20000) {
      return this._change(Math.min(ceiling, roundScale(current + 0.05)));
    }
    return null;
  }

  _change(next) {
    next = clamp(roundScale(next), 0.5, this.ceiling);
    this.reset(this.ceiling);
    this.current = next;
    return next;
  }
}

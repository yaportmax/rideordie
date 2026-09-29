// Tiny GPU timer (EXT_disjoint_timer_query_webgl2). Non-nested; results arrive a few frames late and are averaged.
export class GpuTimer {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.free = [];
    this.active = null;
    this.ms = new Map();     // name -> smoothed ms
    this.last = new Map();   // name -> last raw ms
    this.smooth = 0.9;
  }

  get supported() { return !!this.ext; }

  begin(name) {
    if (!this.ext || this.active || this.pending.length > 96) return;
    const q = this.free.pop() || this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = { q, name };
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Call once per frame. */
  poll() {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length && gl.getQueryParameter(this.pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const p = this.pending.shift();
      if (!disjoint) {
        const v = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
        this.last.set(p.name, v);
        const o = this.ms.get(p.name);
        this.ms.set(p.name, o === undefined ? v : o * this.smooth + v * (1 - this.smooth));
      }
      this.free.push(p.q);
    }
  }

  reset() { this.ms.clear(); this.last.clear(); }

  dispose() {
    for (const p of this.pending) this.gl.deleteQuery(p.q);
    for (const q of this.free) this.gl.deleteQuery(q);
    this.pending.length = 0; this.free.length = 0;
  }
}

// Focus navigation for menus: keyboard (arrows/Enter/Esc/Q-E), gamepad (d-pad + left stick, A/B/X/Y, LB/RB), mouse hover = focus.
// Focusable elements are `.f` (div role=button); `.dis` = not focusable; `data-adjust` = left/right adjusts the value instead of moving focus.
// The active screen may implement: back() -> bool, tabStep(dir), alt('x'|'y'|'start'|'select'), onKey(e) -> bool, navOverride(el, dir) -> Element|false|undefined.

const REPEAT_FIRST = 0.38, REPEAT_NEXT = 0.1;

export class Nav {
  constructor(ui) {
    this.ui = ui;
    this.cur = null;
    this.prev = new Array(20).fill(false);
    this.dirHeld = null; this.dirT = 0; this.dirFirst = true;
    this.capture = null; // set by screens while capturing raw keys (rebinding): (KeyboardEvent) => void
    this._lastHover = 0;
    addEventListener('keydown', (e) => this.onKey(e), true);
  }

  // ---------------------------------------------------------------- queries
  scope() { return this.ui.navScope(); }
  isFocusable(el) {
    if (!el || el.classList.contains('dis') || !el.isConnected) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    return true;
  }
  list() { const s = this.scope(); return s ? [...s.querySelectorAll('.f')].filter((el) => this.isFocusable(el)) : []; }

  // ---------------------------------------------------------------- focus
  focus(el, o = {}) {
    if (!el) return;
    if (el === this.cur && el.classList.contains('is-f')) { if (o.reveal !== false) this.reveal(el); return; }
    const old = this.cur;
    if (old && old !== el) old.classList.remove('is-f');
    this.cur = el; el.classList.add('is-f');
    if (el.tagName === 'INPUT') { if (document.activeElement !== el) el.focus({ preventScroll: true }); }
    else if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    if (o.reveal !== false) this.reveal(el);
    if (!o.silent && old !== el) this.ui.snd('hover');
    el.dispatchEvent(new CustomEvent('navfocus', { bubbles: true, detail: { el, from: old, hover: !!o.hover } }));
  }
  clear() { if (this.cur) this.cur.classList.remove('is-f'); this.cur = null; }
  /** Make sure something valid is focused in the current scope. */
  ensure(preferred) {
    const list = this.list();
    if (!preferred && this.cur && list.includes(this.cur)) return;
    let pick = preferred && list.includes(preferred) ? preferred : null;
    if (!pick) { const f = this.ui.screen()?.initialFocus?.(); if (f && list.includes(f)) pick = f; }
    if (!pick) pick = list[0];
    if (pick) this.focus(pick, { silent: true });
  }
  /** Scroll the nearest `.scroll` ancestor so `el` is visible (no scrollIntoView: it would scroll the clipped stage). */
  reveal(el) {
    const sc = el.closest('.scroll'); if (!sc) return;
    const k = this.ui.k || 1;
    const r = el.getBoundingClientRect(), s = sc.getBoundingClientRect(), pad = 18 * k;
    if (r.top < s.top + pad) sc.scrollTop -= (s.top + pad - r.top) / k;
    else if (r.bottom > s.bottom - pad) sc.scrollTop += (r.bottom - s.bottom + pad) / k;
  }

  move(dir) {
    const list = this.list();
    if (!list.length) return;
    if (!this.cur || !list.includes(this.cur)) { this.ensure(); return; }
    const scr = this.ui.screen();
    if (!this.ui.modalOpen() && scr && scr.navOverride) {
      const o = scr.navOverride(this.cur, dir);
      if (o === false) return;
      if (o && this.isFocusable(o)) { this.focus(o); return; }
    }
    const r0 = this.cur.getBoundingClientRect();
    const c0x = r0.left + r0.width / 2, c0y = r0.top + r0.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === this.cur) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let primary, secondary;
      if (dir === 'right') { if (cx <= c0x + 2) continue; primary = Math.max(0, r.left - r0.right); secondary = gap(r.top, r.bottom, r0.top, r0.bottom); }
      else if (dir === 'left') { if (cx >= c0x - 2) continue; primary = Math.max(0, r0.left - r.right); secondary = gap(r.top, r.bottom, r0.top, r0.bottom); }
      else if (dir === 'down') { if (cy <= c0y + 2) continue; primary = Math.max(0, r.top - r0.bottom); secondary = gap(r.left, r.right, r0.left, r0.right); }
      else { if (cy >= c0y - 2) continue; primary = Math.max(0, r0.top - r.bottom); secondary = gap(r.left, r.right, r0.left, r0.right); }
      const off = dir === 'left' || dir === 'right' ? Math.abs(cy - c0y) : Math.abs(cx - c0x);
      const dist = dir === 'left' || dir === 'right' ? Math.abs(cx - c0x) : Math.abs(cy - c0y);
      const score = primary * 1.0 + secondary * 3.2 + off * 0.3 + dist * 0.05;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.focus(best);
    else this.ui.edgeBump(this.cur, dir);
  }

  adjust(dir) { if (this.cur) this.cur.dispatchEvent(new CustomEvent('navadjust', { bubbles: false, detail: { dir } })); }
  activate() { const el = this.cur; if (el && this.isFocusable(el)) el.click(); }
  back() {
    if (this.ui.modalOpen()) return this.ui.modalCancel();
    const s = this.ui.screen();
    if (!s) return false;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    return !!(s.back && s.back());
  }
  tab(dir) { if (this.ui.modalOpen()) return; const s = this.ui.screen(); if (s && s.tabStep) s.tabStep(dir); }
  alt(name) { if (this.ui.modalOpen()) return; const s = this.ui.screen(); if (s && s.alt) s.alt(name); }
  _dir(dir) {
    const el = this.cur;
    if (el && el.dataset.adjust !== undefined && (dir === 'left' || dir === 'right')) this.adjust(dir === 'left' ? -1 : 1);
    else this.move(dir);
  }

  // ---------------------------------------------------------------- keyboard
  onKey(e) {
    const ui = this.ui;
    if (!ui.active()) return;
    if (this.capture) { this.capture(e); return; }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    ui._setDevice('kbm');
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    const eat = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (ui.blocked() && e.code !== 'Escape') return;
    const scr = ui.screen();
    if (!ui.modalOpen() && scr && scr.onKey && scr.onKey(e, typing)) { eat(); return; }
    switch (e.code) {
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
        if (typing && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return;
        eat();
        this._dir(e.code.slice(5).toLowerCase());
        return;
      }
      case 'Enter': case 'NumpadEnter':
        if (typing) { eat(); const sub = t.dataset.submit && ui.scopeEl().querySelector(t.dataset.submit); if (sub) sub.click(); return; }
        eat(); if (!e.repeat) this.activate();
        return;
      case 'Space':
        if (typing) return;
        eat(); if (!e.repeat) this.activate();
        return;
      case 'Escape':
        if (this.back()) eat();
        return;
      case 'Backspace':
        if (typing) return;
        if (this.back()) eat();
        return;
      case 'KeyQ': case 'PageUp': case 'BracketLeft':
        if (typing) return; eat(); this.tab(-1); return;
      case 'KeyE': case 'PageDown': case 'BracketRight':
        if (typing) return; eat(); this.tab(1); return;
      case 'Tab':
        eat(); this.tab(e.shiftKey ? -1 : 1); return;
      case 'KeyX': if (typing) return; eat(); this.alt('x'); return;
      case 'KeyY': if (typing) return; eat(); this.alt('y'); return;
      default:
    }
  }

  // ---------------------------------------------------------------- gamepad (own poll: works even when the game loop is not polling Input)
  update(dt) {
    const ui = this.ui;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let p = null;
    for (const q of pads) if (q && q.connected) { p = q; break; }
    if (!p) { this.prev.fill(false); this.dirHeld = null; return; }
    const btn = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
    const edge = [];
    let any = false;
    for (let i = 0; i < 16; i++) { const d = btn(i); if (d && !this.prev[i]) edge[i] = true; if (d) any = true; this.prev[i] = d; }
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (p.id !== this._padId) { this._padId = p.id; ui._setPadType(p.id); }
    if (any || Math.hypot(ax, ay) > 0.5) ui._setDevice('pad', p.id);
    if (!ui.active() || ui.blocked()) { this.dirHeld = null; return; }
    if (ui.device() !== 'pad') return;

    let dir = null;
    if (btn(12)) dir = 'up'; else if (btn(13)) dir = 'down'; else if (btn(14)) dir = 'left'; else if (btn(15)) dir = 'right';
    else if (Math.hypot(ax, ay) > 0.55) dir = Math.abs(ax) > Math.abs(ay) ? (ax < 0 ? 'left' : 'right') : (ay < 0 ? 'up' : 'down');
    if (dir !== this.dirHeld) { this.dirHeld = dir; this.dirT = 0; this.dirFirst = true; if (dir) this._dir(dir); }
    else if (dir) {
      this.dirT += dt;
      if (this.dirT >= (this.dirFirst ? REPEAT_FIRST : REPEAT_NEXT)) { this.dirT = 0; this.dirFirst = false; this._dir(dir); }
    }
    if (this.capture) { if (edge[1]) this.capture({ code: 'Escape', preventDefault() {}, stopImmediatePropagation() {}, pad: true }); return; }
    if (edge[0]) this.activate();
    if (edge[1]) this.back();
    if (edge[2]) this.alt('x');
    if (edge[3]) this.alt('y');
    if (edge[4]) this.tab(-1);
    if (edge[5]) this.tab(1);
    if (edge[9]) this.alt('start');
    if (edge[8]) this.alt('select');
    const ry = p.axes[3] || 0;
    if (Math.abs(ry) > 0.25) {
      const sc = (this.cur && this.cur.closest('.scroll')) || this.scope()?.querySelector('.scroll');
      if (sc) sc.scrollTop += ry * 900 * dt;
    }
  }
}

function gap(a0, a1, b0, b1) { return a1 < b0 ? b0 - a1 : b1 < a0 ? a0 - b1 : 0; }

// SETTINGS: VIDEO | AUDIO | INPUT | KEY BINDINGS. Sliders / segmented / toggles are keyboard, mouse and gamepad operable.
// Key rebinding reads and writes Input.bindings (persisted in localStorage), with conflict warning.
import { h } from '../comp.js';
import { esc, icon, hints, keyLabel } from '../glyphs.js';
import { DEFAULT_SETTINGS, BIND_GROUPS, ACTION_LABEL, conflictSet, saveBindings, defaultBindings } from '../settings_store.js';

const TABS = [
  { id: 'video', name: 'VIDEO', icon: 'monitor' }, { id: 'audio', name: 'AUDIO', icon: 'speaker' },
  { id: 'input', name: 'INPUT', icon: 'sliders' }, { id: 'keys', name: 'KEY BINDS', icon: 'key' },
];
const pctFmt = (v) => Math.round(v * 100) + '%';
const ROWS = {
  video: [
    { key: 'units', type: 'seg', label: 'DISTANCE & SPEED UNITS', desc: 'Distance and speed in the HUD, cockpit, garage and run results.', opts: ['MILES', 'KILOMETERS'], values: ['mi', 'km'] },
    { key: 'quality', type: 'seg', label: 'GRAPHICS QUALITY', desc: 'Shadows, particles and post-processing.', opts: ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] },
    { key: 'resScale', type: 'slider', label: 'RESOLUTION SCALE', desc: 'Render resolution. Lower is faster, higher is sharper.', min: 0.5, max: 1.5, step: 0.05, fmt: pctFmt },
    { key: 'autoResolution', type: 'toggle', label: 'AUTOMATIC RESOLUTION', desc: 'Adjust resolution in busy scenes for smoother play. Uses your resolution scale as the maximum.' },
    { key: 'driverFov', type: 'slider', label: 'DRIVER FIELD OF VIEW', desc: 'Vertical field of view in the cockpit.', min: 60, max: 100, step: 1, fmt: (v) => Math.round(v) + '°' },
    { key: 'fov', type: 'slider', label: 'GUNNER FIELD OF VIEW', desc: 'Vertical field of view in the truck bed.', min: 60, max: 100, step: 1, fmt: (v) => Math.round(v) + '°' },
    { key: 'shake', type: 'slider', label: 'CAMERA SHAKE', desc: 'Screen shake from crashes and explosions.', min: 0, max: 1, step: 0.05, fmt: pctFmt },
    { key: 'motionBlur', type: 'toggle', label: 'MOTION BLUR', desc: 'Camera motion blur at speed.' },
    { key: 'chromatic', type: 'toggle', label: 'CHROMATIC ABERRATION', desc: 'Colour fringing at the screen edges and on hits.' },
    { key: 'grain', type: 'toggle', label: 'FILM GRAIN', desc: 'Subtle noise over the image.' },
  ],
  audio: [
    { key: 'master', type: 'slider', label: 'MASTER VOLUME', desc: 'Overall loudness.', min: 0, max: 1, step: 0.05, fmt: pctFmt },
    { key: 'sfx', type: 'slider', label: 'EFFECTS', desc: 'Guns, engines, explosions and interface sounds.', min: 0, max: 1, step: 0.05, fmt: pctFmt },
    { key: 'music', type: 'slider', label: 'MUSIC', desc: 'Adaptive soundtrack.', min: 0, max: 1, step: 0.05, fmt: pctFmt },
  ],
  input: [
    { key: 'mouseSens', type: 'slider', label: 'MOUSE SENSITIVITY', desc: 'Aim speed with the mouse (gunner and solo).', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
    { key: 'padSens', type: 'slider', label: 'GAMEPAD SENSITIVITY', desc: 'Aim speed with the right stick.', min: 0.3, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
    { key: 'invertY', type: 'toggle', label: 'INVERT Y AXIS', desc: 'Push up to look down. Mouse and gamepad.' },
    { key: 'aimAssist', type: 'toggle', label: 'AIM ASSIST', desc: 'Gamepad gunner: the aim slows and nudges onto raiders.' },
    { key: 'vibration', type: 'toggle', label: 'CONTROLLER VIBRATION', desc: 'Rumble on hits, crashes and explosions.' },
  ],
};

export class SettingsScreen {
  constructor(ui, cb) {
    this.ui = ui; this.cb = cb || {}; this.kind = 'settings'; this.bg = 'dim';
    this.tabId = TABS.some((t) => t.id === this.cb.tab) ? this.cb.tab : 'video';
    this.listening = null;
    this.el = h(`<div class="screen settings"><div class="safe">
      <div class="st-title stg" style="--i:0"><div class="eyebrow">OPTIONS</div><h1>SETTINGS</h1></div>
      <div class="g-rail st-rail plate trans stg" style="--i:1"><div class="rail-k top"><span class="hk"><kbd>Q</kbd></span><span class="hg"><span class="pb pb-bump"><i class="xb">LB</i><i class="ps">L1</i></span></span></div><div class="tabs"></div><div class="rail-k bot"><span class="hk"><kbd>E</kbd></span><span class="hg"><span class="pb pb-bump"><i class="xb">RB</i><i class="ps">R1</i></span></span></div></div>
      <div class="st-panel plate trans stg" style="--i:2"><div class="lhead"><h2></h2><span class="lcount"></span></div><div class="hazbar"></div><div class="scroll st-rows"></div><div class="st-foot"></div></div>
      <div class="hints" data-hints></div>
    </div></div>`);
    const q = (s) => this.el.querySelector(s);
    this.q = { tabs: q('.tabs'), title: q('.lhead h2'), count: q('.lcount'), rows: q('.st-rows'), foot: q('.st-foot'), hints: q('[data-hints]') };
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.renderAll();
  }
  get S() { return this.ui.settings; }
  renderAll() {
    this.q.tabs.innerHTML = TABS.map((t) => `<div class="f tab ${t.id === this.tabId ? 'on' : ''}" role="button" data-tab="${t.id}" data-k="tab:${t.id}">${icon(t.icon)}<span>${t.name}</span></div>`).join('');
    this.renderRows();
    this.q.foot.innerHTML = `<div class="f btn wide small" role="button" data-act="reset" data-k="reset"><span>${this.tabId === 'keys' ? 'RESET KEYS' : 'RESET TAB'}</span></div><div class="f btn primary wide small" role="button" data-act="back" data-k="back"><span>BACK</span></div>`;
    this.q.hints.innerHTML = this.tabId === 'keys'
      ? hints([['nav', 'MOVE'], ['confirm', 'REBIND'], ['<kbd>DEL</kbd>', '<span class="pb pb-x"><i class="xb">X</i><i class="ps">□</i></span>', 'CLEAR'], ['tabs', 'TAB'], ['back', 'BACK']])
      : hints([['nav', 'MOVE'], ['navh', 'ADJUST'], ['tabs', 'TAB'], ['back', 'BACK']]);
  }
  renderRows() {
    const t = TABS.find((x) => x.id === this.tabId);
    this.q.title.textContent = t.name;
    this.q.count.textContent = this.tabId === 'keys' ? 'CLICK A KEY, THEN PRESS A NEW ONE' : '';
    if (this.tabId === 'keys') { this.renderKeys(); return; }
    this.q.rows.innerHTML = ROWS[this.tabId].map((r) => this.rowHtml(r)).join('');
    this.q.rows.querySelectorAll('.srow').forEach((row) => this.wireRow(row));
  }
  rowHtml(r) {
    const v = this.S[r.key];
    let ctl = '';
    if (r.type === 'slider') { const f = (v - r.min) / (r.max - r.min); ctl = `<div class="track"><i class="fill" style="width:${f * 100}%"></i><i class="thumb" style="left:${f * 100}%"></i></div><span class="val">${r.fmt(v)}</span>`; }
    else if (r.type === 'seg') ctl = `<div class="seg">${r.opts.map((o, i) => `<i data-v="${i}" class="${(r.values ? r.values[i] : i) === v ? 'on' : ''}">${o}</i>`).join('')}</div>`;
    else ctl = `<div class="tog ${v ? 'on' : ''}"><i class="knob"></i><span>${v ? 'ON' : 'OFF'}</span></div>`;
    return `<div class="f srow ${r.type}" role="slider" data-key="${r.key}" data-adjust="1" data-k="s:${r.key}"><div class="sl"><b>${r.label}</b><small>${r.desc}</small></div><div class="ctl">${ctl}</div></div>`;
  }
  rowDef(key) { return ROWS[this.tabId].find((r) => r.key === key); }
  wireRow(row) {
    const r = this.rowDef(row.dataset.key);
    row.addEventListener('navadjust', (e) => this.step(r, row, e.detail.dir));
    if (r.type === 'slider') {
      const track = row.querySelector('.track');
      const setFrom = (ev) => { const b = track.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)); this.setSlider(r, row, r.min + f * (r.max - r.min)); };
      track.addEventListener('pointerdown', (ev) => { track.setPointerCapture(ev.pointerId); this._drag = true; this.ui.nav.focus(row, { silent: true, reveal: false }); setFrom(ev); });
      track.addEventListener('pointermove', (ev) => { if (this._drag) setFrom(ev); });
      track.addEventListener('pointerup', () => { this._drag = false; });
    }
  }
  quant(r, v) { const n = Math.round((v - r.min) / r.step); return Math.min(r.max, Math.max(r.min, +(r.min + n * r.step).toFixed(4))); }
  setSlider(r, row, v) {
    v = this.quant(r, v);
    if (v === this.S[r.key]) return;
    this.ui.changeSetting(r.key, v, this.cb);
    const f = (v - r.min) / (r.max - r.min);
    row.querySelector('.fill').style.width = f * 100 + '%'; row.querySelector('.thumb').style.left = f * 100 + '%'; row.querySelector('.val').textContent = r.fmt(v);
    const t = performance.now(); if (t - (this._lastTick || 0) > 60) { this._lastTick = t; this.ui.snd('hover'); }
  }
  step(r, row, dir) {
    if (r.type === 'slider') this.setSlider(r, row, this.S[r.key] + dir * r.step);
    else if (r.type === 'seg') this.setSeg(r, row, Math.min(r.opts.length - 1, Math.max(0, (r.values ? r.values.indexOf(this.S[r.key]) : this.S[r.key]) + dir)));
    else this.setToggle(r, row, dir > 0);
  }
  setSeg(r, row, i) {
    const value = r.values ? r.values[i] : i;
    if (value === this.S[r.key]) return;
    this.ui.changeSetting(r.key, value, this.cb); this.ui.snd('click');
    row.querySelectorAll('.seg i').forEach((n) => n.classList.toggle('on', +n.dataset.v === i));
  }
  setToggle(r, row, on) {
    if (on === !!this.S[r.key]) return;
    this.ui.changeSetting(r.key, on, this.cb); this.ui.snd('click');
    const tg = row.querySelector('.tog'); tg.classList.toggle('on', on); tg.querySelector('span').textContent = on ? 'ON' : 'OFF';
  }

  // ---------------------------------------------------------------- key bindings
  bindings() { return this.ui.input.bindings; }
  slotHtml(action, i) {
    const code = (this.bindings()[action] || [])[i];
    const cls = this.listening && this.listening.action === action && this.listening.slot === i ? 'listen' : '';
    return `<div class="f kslot ${cls} ${code ? '' : 'empty'}" role="button" data-action="${action}" data-slot="${i}" data-k="k:${action}:${i}" data-snd="none">${cls ? '<span class="press">PRESS A KEY&hellip;</span>' : code ? `<kbd>${esc(keyLabel(code))}</kbd>` : '<span class="none">—</span>'}</div>`;
  }
  renderKeys() {
    const grp = (g) => `<div class="kb-group"><div class="d-sec">${g.name}</div>${g.actions.map(([a, label]) => `<div class="kb-row"><span class="kl">${label}</span>${this.slotHtml(a, 0)}${this.slotHtml(a, 1)}</div>`).join('')}</div>`;
    const [d, g, gl] = BIND_GROUPS;
    this.q.rows.innerHTML = `<div class="kb-grid"><div class="kb-col">${grp(d)}${grp(gl)}<div class="kb-note">Solo mode uses the driver keys to drive and the mouse to aim. <b>DEL</b> clears a slot, <b>ESC</b> cancels.</div></div><div class="kb-col">${grp(g)}</div></div>`;
  }
  startListen(el) {
    this.cancelListen(true);
    this.listening = { action: el.dataset.action, slot: +el.dataset.slot, key: el.dataset.k };
    this.ui.snd('click');
    this.refreshSlot(this.listening);
    this.ui.nav.capture = (e) => this.onCapture(e);
  }
  cancelListen(silent) {
    if (!this.listening) return;
    const l = this.listening; this.listening = null; this.ui.nav.capture = null;
    this.refreshSlot(l);
    if (!silent) this.ui.snd('menu_close');
  }
  refreshSlot(l) {
    const el = this.el.querySelector(`[data-k="${l.key || `k:${l.action}:${l.slot}`}"]`);
    if (el) { const n = h(this.slotHtml(l.action, l.slot)); el.replaceWith(n); if (this.ui.nav.cur === el) this.ui.nav.focus(n, { silent: true, reveal: false }); }
  }
  onCapture(e) {
    e.preventDefault && e.preventDefault(); e.stopImmediatePropagation && e.stopImmediatePropagation();
    if (e.type === 'keyup' || e.repeat) return;
    const l = this.listening; if (!l) return;
    if (e.code === 'Escape') { this.cancelListen(); return; }
    if (['MetaLeft', 'MetaRight', 'ContextMenu'].includes(e.code)) return;
    if (e.code === 'Delete' || e.code === 'Backspace') { this.assign(l, null); return; }
    this.assign(l, e.code);
  }
  assign(l, code) {
    this.listening = null; this.ui.nav.capture = null;
    const b = this.bindings(), arr = (b[l.action] = (b[l.action] || []).slice());
    if (code === null) { arr[l.slot] = undefined; b[l.action] = arr.filter(Boolean); this.persist(); this.refreshKeys(); this.ui.snd('click'); return; }
    // conflicts inside the same role group
    const others = conflictSet(l.action).filter((a) => (b[a] || []).includes(code));
    const finish = (steal) => {
      for (const a of steal) b[a] = (b[a] || []).filter((c) => c !== code);
      const cur = (b[l.action] || []).slice();
      const dupe = cur.indexOf(code); if (dupe >= 0 && dupe !== l.slot) cur.splice(dupe, 1);
      cur[Math.min(l.slot, cur.length)] = code; // keep slots dense
      b[l.action] = cur.filter(Boolean).slice(0, 2);
      this.persist(); this.refreshKeys(); this.ui.snd('buy');
      this.ui.toast(`${keyLabel(code)} → ${ACTION_LABEL[l.action]}`, 'good', 1600);
    };
    if (others.length) {
      const names = others.map((a) => ACTION_LABEL[a]).join(', ');
      this.ui.snd('error');
      this.ui.modal({ title: 'KEY ALREADY IN USE', text: `${keyLabel(code)} is bound to ${names}.\nReplace it and use ${keyLabel(code)} for ${ACTION_LABEL[l.action]}?`, kind: 'warn', buttons: [{ label: 'KEEP OLD', cancel: true, kind: 'primary' }, { label: 'REPLACE', id: 'yes', kind: 'danger' }] })
        .then((r) => { if (r === 'yes') finish(others); else this.refreshKeys(); });
    } else finish([]);
  }
  persist() { saveBindings(this.bindings()); if (this.cb.onBindingsChange) this.cb.onBindingsChange(this.bindings()); if (this.ui.opts.onBindingsChange) this.ui.opts.onBindingsChange(this.bindings()); }
  refreshKeys() {
    const keep = this.ui.nav.cur && this.ui.nav.cur.dataset.k, top = this.q.rows.scrollTop;
    this.renderKeys(); this.q.rows.scrollTop = top;
    const n = keep && this.el.querySelector(`[data-k="${keep}"]`); if (n) this.ui.nav.focus(n, { silent: true, reveal: false });
  }

  // ---------------------------------------------------------------- interaction
  switchTab(id) {
    if (id === this.tabId) return;
    this.cancelListen(true);
    this.tabId = id; this.renderAll();
    const tabEl = this.el.querySelector(`[data-tab="${id}"]`); if (tabEl) this.ui.nav.focus(tabEl, { silent: true });
    this.q.rows.animate([{ opacity: 0, transform: 'translateX(18px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
  }
  tabStep(dir) { this.ui.snd('click'); this.switchTab(TABS[(TABS.findIndex((t) => t.id === this.tabId) + dir + TABS.length) % TABS.length].id); }
  onClick(e) {
    const t = e.target.closest('.f'); if (!t) { this.cancelListen(); return; }
    if (t.dataset.tab) { this.ui.snd('click'); this.switchTab(t.dataset.tab); return; }
    if (t.dataset.action) { this.startListen(t); return; }
    if (this.listening) this.cancelListen(true);
    if (t.dataset.act === 'back') { this.back(); return; }
    if (t.dataset.act === 'reset') { this.reset(); return; }
    if (t.classList.contains('srow')) {
      const r = this.rowDef(t.dataset.key);
      if (r.type === 'toggle') this.setToggle(r, t, !this.S[r.key]);
      else if (r.type === 'seg') { const seg = e.target.closest('.seg i'); if (seg) this.setSeg(r, t, +seg.dataset.v); }
    }
  }
  reset() {
    if (this.tabId === 'keys') {
      this.ui.modal({ title: 'RESET KEY BINDINGS?', text: 'Every action goes back to its default key.', kind: 'warn', buttons: [{ label: 'CANCEL', cancel: true, kind: 'primary' }, { label: 'RESET', id: 'yes', kind: 'danger' }] }).then((r) => {
        if (r !== 'yes') return;
        const d = defaultBindings(); for (const k of Object.keys(d)) this.bindings()[k] = d[k];
        this.persist(); this.refreshKeys(); this.ui.snd('buy'); this.ui.toast('KEY BINDINGS RESET', 'good');
      });
      return;
    }
    for (const r of ROWS[this.tabId]) this.ui.changeSetting(r.key, DEFAULT_SETTINGS[r.key], this.cb);
    this.renderRows(); this.ui.snd('buy'); this.ui.toast('SETTINGS RESET', 'good', 1500);
    const first = this.q.rows.querySelector('.f'); if (first) this.ui.nav.focus(first, { silent: true });
  }
  initialFocus() { return this.q.rows.querySelector('.f'); }
  navOverride(el, dir) {
    if (el.dataset.tab && dir === 'right') return this.q.rows.querySelector('.f');
    if (dir === 'left' && el.dataset.slot === '0' && !el.closest('.kb-col + .kb-col')) return this.el.querySelector(`[data-tab="${this.tabId}"]`);
    return undefined;
  }
  back() {
    if (this.listening) { this.cancelListen(); return true; }
    const cb = this.cb; this.ui.close();
    if (cb.onClose) cb.onClose();
    return true;
  }
  alt(name) {
    if (name === 'x' && this.tabId === 'keys' && this.ui.nav.cur && this.ui.nav.cur.dataset.action) { const c = this.ui.nav.cur; this.assign({ action: c.dataset.action, slot: +c.dataset.slot }, null); }
  }
  onKey(e) {
    if (this.tabId === 'keys' && (e.code === 'Delete') && this.ui.nav.cur && this.ui.nav.cur.dataset.action && !this.listening) { this.alt('x'); return true; }
    return false;
  }
  destroy() { this.cancelListen(true); }
}

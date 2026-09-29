/**
 * RIDE OR DIE - menu / shop UI (DOM overlays).
 *
 *   import { Ui } from './ui/ui.js';
 *   const ui = new Ui(rootElement, { input, backdrop: true, onSettingsChange: (settings, key) => {...}, sound: (name) => {...} });
 *
 * `rootElement` must be a positioned element covering the viewport (e.g. <div id="ui" style="position:fixed;inset:0">). The Ui lays out a
 * 1920x1080 design space scaled to fit (wider aspect ratios get extra room at the sides). Everything is operable with keyboard, mouse
 * and gamepad; the Ui polls the gamepad itself while a screen is open (it does not need Input.poll) and keeps `input.lastDevice` in sync.
 * `backdrop:false` disables the built-in sunset backdrop (use it when the integrator renders its own 3D behind the transparent overlay;
 * the GARAGE never draws a backdrop).
 *
 * API (all `cb` objects are optional; every callback is optional):
 *   showTitle(cb)                 cb: onHost(), onJoin(code), onSolo(), onSettings()*, onControls()*, onQuit()** , sound(name)
 *   showLobby(state, cb)          cb: onSeat(role), onReady(ready:boolean), onStart(), onLeave(), onCopy()
 *   updateLobby(state)            state = { code, status:'connecting'|'waiting'|'connected'|'lost', latency?, isHost, canStart?,
 *                                            players:[{ id, name, device:'kbm'|'pad', seat:'driver'|'gunner'|null, ready, you, host }] }
 *   showGarage(profile, cb, extra)  cb: onBuy(kind, id, track?)  kind = 'truck'|'upgrade'|'weapon'|'weaponTrack' (weaponTrack: id=weaponId, track='dmg'|'mag'|'rel'|'hnd'),
 *                                       onSelectTruck(id), onPaint(index), onEquip(weaponId, slot), onReady(), onMenu()*, sound(name)
 *   updateGarage(profile, extra)  extra = { solo?:bool (button says START RUN), ready?:bool, isHost?:bool, partner?:{ name, ready, connected, role } , runNo?:number }
 *                                 (showGarage's extra also accepts tab:'truck'|'upgrades'|'weapons'|'gunner'|'paint' and select:<item id> for the initial view)
 *   showResults(run, profile, cb) cb: onContinue() (BACK TO GARAGE), onTick() (each count-up tick), sound(name)
 *                                 run = { won, cash, distance(m), time(s), kills, crashKills, bestStreak, shots, hits, cause, biome?, breakdown?:[{label, amount}], newBest?:{distance,time,kills} }
 *   showPause(cb)                 cb: onResume(), onSettings()*, onControls()*, onQuit(), sound(name)
 *   showSettings(settings, cb)    cb: onChange(settings, key), onClose(), onBindingsChange(bindings), tab:'video'|'audio'|'input'|'keys'
 *                                 settings = { quality 0-3, resScale, fov, shake, mouseSens, padSens, invertY, master, sfx, music, vibration } (all optional); persisted to
 *                                 localStorage, sens/invertY/vibration are applied to `input` and key bindings are written to input.bindings automatically.
 *                                 `ui.settings` holds the current values (loaded at construction) - read it at start-up; opts.onSettingsChange(settings, key) fires for every change.
 *   showControls(role)            role = 'driver' | 'gunner' | 'solo'
 *   hideAll(), toast(text, kind='info'|'good'|'warn'|'bad', ms), modal({title, text, buttons:[{label, id?, kind?, cancel?, onClick?}], kind?, dismiss?}) -> Promise<id|index|null>
 *   connectionLost(text) -> modal Promise                     (* = optional: if absent the Ui opens its built-in screen; ** = QUIT button only appears when provided)
 * Sound hooks (cb.sound / opts.sound): click hover buy error upgrade_unlock coin menu_open menu_close ready go
 */
import baseCss from './ui.css?inline';
import garageCss from './css/garage.css?inline';
import lobbyCss from './css/lobby.css?inline';
import resultsCss from './css/results.css?inline';
import settingsCss from './css/settings.css?inline';
import { Nav } from './nav.js';
import { esc, icon } from './glyphs.js';
import { loadSettings, saveSettings, applySettings, wrapRumble, loadBindings, defaultBindings } from './settings_store.js';
import { backdropSvg } from './backdrop.js';
import { TitleScreen } from './screens/title.js';
import { LobbyScreen } from './screens/lobby.js';
import { GarageScreen } from './screens/garage.js';
import { ResultsScreen } from './screens/results.js';
import { PauseScreen } from './screens/pause.js';
import { SettingsScreen } from './screens/settings.js';
import { ControlsScreen } from './screens/controls.js';

const cssText = [baseCss, garageCss, lobbyCss, resultsCss, settingsCss].join('\n');

const noiseUri = (alpha, freq, size = 200, seed = 3) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${alpha} 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
};
const grimeUri = (size = 240) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".012 .05" numOctaves="3" seed="8" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.6 -.55"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
};

const grungeUri = (size = 256) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".2 .28" numOctaves="4" seed="21" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -12 8.8"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
};

function stubInput() {
  return { bindings: defaultBindings(), sens: { mouse: 0.0022, padYaw: 3.1, padPitch: 2.3 }, invertY: false, lastDevice: 'kbm' };
}

let cssInjected = false;

export class Ui {
  constructor(root, opts = {}) {
    this.root = root; this.opts = opts;
    this.input = opts.input || stubInput();
    if (!cssInjected) { const st = document.createElement('style'); st.id = 'rod-ui-css'; st.textContent = cssText; document.head.appendChild(st); cssInjected = true; }

    this.settings = loadSettings();
    const b = loadBindings(); if (b) for (const k of Object.keys(b)) this.input.bindings[k] = b[k];
    applySettings(this.input, this.settings);
    wrapRumble(this.input, () => this.settings);

    const el = this.el = document.createElement('div');
    el.className = 'rod-ui'; el.style.display = 'none';
    el.dataset.dev = this.input.lastDevice || 'kbm'; el.dataset.pad = 'xbox';
    el.style.setProperty('--noise', noiseUri(0.55, 0.85));
    el.style.setProperty('--noise-soft', noiseUri(0.16, 0.9, 200, 5));
    el.style.setProperty('--noise-hard', noiseUri(0.9, 0.7, 160, 11));
    el.style.setProperty('--grime', grimeUri());
    el.style.setProperty('--grunge', grungeUri());
    const stage = this.stage = document.createElement('div');
    stage.className = 'rod-stage';
    stage.innerHTML = `<div class="bg" data-mode="none">${opts.backdrop === false ? '' : backdropSvg()}</div>
      <div class="layer screens"></div><div class="layer toasts"></div><div class="layer modal-layer"></div>
      <div class="fx"><i class="grain"></i><i class="vig"></i></div>`;
    el.appendChild(stage); root.appendChild(el);
    this.bgEl = stage.querySelector('.bg'); this.screensEl = stage.querySelector('.screens');
    this.toastsEl = stage.querySelector('.toasts'); this.modalEl = stage.querySelector('.modal-layer');

    this.stack = []; this._modal = null; this._sound = opts.sound || null; this._dev = el.dataset.dev;
    this._blockUntil = 0; this._mmT = 0; this._lastHoverSnd = 0; this.k = 1;
    this.nav = new Nav(this);
    this._running = false; this._last = 0;
    this._loop = (t) => {
      if (!this._running) return;
      const dt = Math.min(0.1, Math.max(0, (t - this._last) / 1000)); this._last = t;
      this.nav.update(dt);
      const d = this.input.lastDevice; if (d && d !== this._dev) this._setDevice(d);
      this._raf = requestAnimationFrame(this._loop);
    };

    // delegated pointer handling
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if ('movementX' in e && Math.abs(e.movementX) + Math.abs(e.movementY) < 1) return; // synthetic move after a layout change
      this._mmT = performance.now(); this._setDevice('kbm');
      const f = e.target.closest && e.target.closest('.f');
      if (f && f !== this.nav.cur && this.nav.isFocusable(f) && this.nav.scope()?.contains(f) && !this.nav.capture) this.nav.focus(f, { hover: true, reveal: false });
    }, true);
    stage.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') { this._mmT = performance.now(); this._setDevice('kbm'); } }, true);
    stage.addEventListener('click', (e) => {
      const f = e.target.closest && e.target.closest('.f');
      if (!f || f.classList.contains('dis')) return;
      if (this.nav.scope()?.contains(f)) this.nav.focus(f, { silent: true, reveal: false });
      const s = f.dataset.snd; if (s !== 'none') this.snd(s || 'click');
      if (f.classList.contains('btn') || f.classList.contains('pressable')) this.pressFx(f);
    });
    stage.addEventListener('focusin', (e) => { const f = e.target.closest && e.target.closest('.f'); if (f && f.tagName === 'INPUT') this.nav.focus(f, { silent: true }); });

    this._ro = new ResizeObserver(() => this._fit()); this._ro.observe(root);
    addEventListener('resize', () => this._fit());
    this._fit();
  }

  // ---------------------------------------------------------------- plumbing
  _fit() {
    const w = this.root.clientWidth || innerWidth, h = this.root.clientHeight || innerHeight;
    const k = Math.max(0.4, Math.min(w / 1920, h / 1080)); this.k = k;
    const s = this.stage.style; s.width = (w / k) + 'px'; s.height = (h / k) + 'px'; s.transform = `scale(${k})`;
    this.el.style.setProperty('--k', k);
  }
  screen() { return this.stack[this.stack.length - 1] || null; }
  active() { return this.stack.length > 0 || !!this._modal; }
  modalOpen() { return !!this._modal; }
  navScope() { return this._modal ? this._modal.el : (this.screen() ? this.screen().el : null); }
  scopeEl() { return this.navScope(); }
  device() { return this._dev; }
  blocked() { return performance.now() < this._blockUntil; }
  _block(ms = 220) { this._blockUntil = performance.now() + ms; }
  _setPadType(id) { this.el.dataset.pad = /054c|dualshock|dualsense|playstation/i.test(id) ? 'ps' : 'xbox'; }
  _setDevice(d, padId) {
    if (padId) this._setPadType(padId);
    if (this._dev === d) return;
    this._dev = d; this.el.dataset.dev = d; if (this.input) this.input.lastDevice = d;
  }
  snd(name) {
    const f = this._sound; if (!f) return;
    if (name === 'hover') { const t = performance.now(); if (t - this._lastHoverSnd < 45) return; this._lastHoverSnd = t; }
    try { f(name); } catch { /* audio hook errors must never break the UI */ }
  }
  _use(cb) { if (cb && cb.sound) this._sound = cb.sound; }
  pressFx(el) { el.classList.remove('press'); void el.offsetWidth; el.classList.add('press'); setTimeout(() => el.classList.remove('press'), 340); }
  edgeBump(el, dir) {
    el.classList.remove('bump-l', 'bump-r', 'bump-u', 'bump-d'); void el.offsetWidth;
    el.classList.add('bump-' + dir[0]); setTimeout(() => el.classList.remove('bump-' + dir[0]), 200);
  }
  _refresh() {
    const any = this.stack.length > 0 || !!this._modal || this.toastsEl.children.length > 0;
    this.el.style.display = any ? '' : 'none';
    const run = this.active();
    if (run && !this._running) { this._running = true; this._last = performance.now(); this._raf = requestAnimationFrame(this._loop); }
    else if (!run && this._running) { this._running = false; cancelAnimationFrame(this._raf); }
    const s = this.screen();
    const bg = s ? (s.bg || 'none') : 'none';
    // over live 3D (backdrop:false): title = left scrim for the logo + menu, dim = even darkening, results = heavy left-to-right scrim
    this.bgEl.dataset.mode = bg === 'veil' ? 'veil' : this.opts.backdrop !== false ? (bg === 'results' ? 'dim' : bg) : ({ title: 'scrim', dim: 'dim3d', results: 'results3d' }[bg] || 'none');
    this.el.classList.toggle('has-screen', !!s);
  }
  /** Free area of the garage screen between its panels (CSS px) - the 3D camera frames the subject inside it. */
  garageFrameRect() { const g = this._find('garage'); return g && g.frameRect ? g.frameRect() : null; }

  _mount(screen, { base = false } = {}) {
    if (base) this._clearStack();
    else { const p = this.screen(); if (p) { p._lastFocus = this.nav.cur; p.el.classList.add('under'); } }
    this.stack.push(screen);
    this.screensEl.appendChild(screen.el);
    this.nav.clear();
    this._block(); this._refresh();
    requestAnimationFrame(() => { if (this.screen() === screen && !this._modal) this.nav.ensure(); });
    if (screen.mounted) screen.mounted();
    return screen;
  }
  _clearStack() { for (const s of this.stack) { s.destroy?.(); s.el.remove(); } this.stack.length = 0; this.nav.clear(); }
  _pop() {
    const s = this.stack.pop(); if (!s) return;
    s.destroy?.(); s.el.remove();
    const top = this.screen();
    this.nav.clear();
    if (top) { top.el.classList.remove('under'); requestAnimationFrame(() => { this.nav.ensure(top._lastFocus && top.el.contains(top._lastFocus) ? top._lastFocus : undefined); }); top.resumed?.(); }
    this._block(160); this._refresh();
  }
  _find(kind) { return this.stack.find((s) => s.kind === kind) || null; }

  // ---------------------------------------------------------------- public screens
  showTitle(cb = {}) { this._use(cb); this.snd('menu_open'); return this._mount(new TitleScreen(this, cb), { base: true }); }
  showLobby(state, cb = {}) { this._use(cb); return this._mount(new LobbyScreen(this, state, cb), { base: true }); }
  updateLobby(state) { const s = this._find('lobby'); if (s) s.update(state); }
  showGarage(profile, cb = {}, extra = {}) { this._use(cb); return this._mount(new GarageScreen(this, profile, cb, extra), { base: true }); }
  updateGarage(profile, extra) { const s = this._find('garage'); if (s) s.update(profile, extra); }
  showResults(run, profile, cb = {}) { this._use(cb); return this._mount(new ResultsScreen(this, run, profile, cb), { base: true }); }
  showPause(cb = {}) { this._use(cb); this.snd('menu_open'); return this._mount(new PauseScreen(this, cb), { base: true }); }
  showSettings(settings, cb = {}) {
    this._use(cb);
    if (settings) { this.settings = { ...this.settings, ...settings }; }
    return this._mount(new SettingsScreen(this, cb), {});
  }
  showControls(role = 'driver') { return this._mount(new ControlsScreen(this, role), {}); }
  hideAll() {
    this._closeModal(null, true); this._clearStack(); this._refresh();
  }
  /** Close the topmost pushed screen (settings/controls) - used by screens. */
  close() { this.snd('menu_close'); this._pop(); }

  /** Apply + persist a changed setting and notify. */
  changeSetting(key, value, cb) {
    this.settings = { ...this.settings, [key]: value };
    saveSettings(this.settings); applySettings(this.input, this.settings);
    try { if (cb && cb.onChange) cb.onChange(this.settings, key); if (this.opts.onSettingsChange) this.opts.onSettingsChange(this.settings, key); } catch (e) { console.error(e); }
  }

  // ---------------------------------------------------------------- toasts
  toast(text, kind = 'info', ms = 2800) {
    const ic = { info: 'info', good: 'check', warn: 'warn', bad: 'warn' }[kind] || 'info';
    const t = document.createElement('div');
    t.className = `toast k-${kind}`;
    t.innerHTML = `<span class="tb"></span><span class="ti">${icon(ic)}</span><span class="tt">${esc(text)}</span>`;
    this.toastsEl.prepend(t);
    while (this.toastsEl.children.length > 4) this.toastsEl.lastChild.remove();
    this._refresh();
    requestAnimationFrame(() => t.classList.add('in'));
    if (kind === 'bad') this.snd('error');
    setTimeout(() => { t.classList.add('out'); setTimeout(() => { t.remove(); this._refresh(); }, 350); }, ms);
    return t;
  }

  // ---------------------------------------------------------------- modal
  modal({ title = '', text = '', buttons = [{ label: 'OK' }], kind = 'info', dismiss = true } = {}) {
    if (this._modal) this._closeModal(null, true);
    const el = document.createElement('div');
    el.className = `modal k-${kind}`;
    const btns = buttons.map((b, i) => `<div class="f mbtn ${b.kind || ''}" role="button" data-i="${i}"><span>${esc(b.label)}</span></div>`).join('');
    el.innerHTML = `<div class="veil"></div><div class="box plate"><div class="hazbar"></div><div class="mhead">${icon(kind === 'bad' ? 'plug' : kind === 'warn' ? 'warn' : 'info')}<h2>${esc(title)}</h2></div><p>${esc(text).replace(/\n/g, '<br>')}</p><div class="mbtns">${btns}</div></div>`;
    this.modalEl.appendChild(el);
    let resolve; const promise = new Promise((r) => { resolve = r; });
    const prevFocus = this.nav.cur;
    const m = this._modal = { el, buttons, dismiss, resolve, prevFocus };
    el.querySelectorAll('.mbtn').forEach((n) => n.addEventListener('click', () => {
      const i = +n.dataset.i, b = buttons[i];
      if (b.onClick) { try { b.onClick(); } catch (e) { console.error(e); } }
      this._closeModal(b.id ?? i);
    }));
    this.nav.clear(); this._block(); this._refresh(); this.snd('menu_open');
    requestAnimationFrame(() => {
      const first = buttons.findIndex((b) => b.kind === 'primary');
      this.nav.ensure(el.querySelectorAll('.mbtn')[first >= 0 ? first : 0]);
    });
    promise.close = () => { if (this._modal === m) this._closeModal(null); };
    return promise;
  }
  modalCancel() {
    const m = this._modal; if (!m) return false;
    if (!m.dismiss) return true;
    let i = m.buttons.findIndex((b) => b.cancel);
    if (i < 0 && m.buttons.length > 1) i = m.buttons.length - 1;
    if (i >= 0) { const b = m.buttons[i]; if (b.onClick) { try { b.onClick(); } catch (e) { console.error(e); } } this._closeModal(b.id ?? i); } else this._closeModal(null);
    return true;
  }
  _closeModal(val, silent = false) {
    const m = this._modal; if (!m) return;
    this._modal = null; m.el.remove(); m.resolve(val);
    this.nav.clear();
    if (!silent) this.snd('menu_close');
    this._block(160); this._refresh();
    requestAnimationFrame(() => { if (!this._modal) this.nav.ensure(m.prevFocus && m.prevFocus.isConnected ? m.prevFocus : undefined); });
  }
  connectionLost(text = 'The other player left or the connection dropped.') {
    return this.modal({ title: 'CONNECTION LOST', text, kind: 'bad', dismiss: false, buttons: [{ label: 'OK', kind: 'primary' }] });
  }

  dispose() { this._running = false; cancelAnimationFrame(this._raf); this._ro.disconnect(); this.el.remove(); }
}

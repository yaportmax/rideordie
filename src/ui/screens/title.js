// TITLE: logo + SINGLE PLAYER (seat picker: DRIVE / SHOOT / BOTH) / HOST CO-OP / JOIN CO-OP (room code entry incl. on-screen keypad for
// gamepads) / SETTINGS / CONTROLS. The live 3D chase (TitleScene) runs behind it.
import { h } from '../comp.js';
import { esc, hints, icon } from '../glyphs.js';

const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789'.split('');
const SEATS = [
  { id: 'driver', name: 'DRIVE', icon: 'wheel', sub: 'YOU TAKE THE WHEEL', text: 'Steer, drift, ram and burn nitro. Your AI gunner shoots back.', ai: 'AI GUNNER' },
  { id: 'gunner', name: 'SHOOT', icon: 'crosshair', sub: 'YOU MAN THE GUNS', text: 'Stand in the truck bed and fight. Your AI driver keeps you moving.', ai: 'AI DRIVER' },
  { id: 'both', name: 'BOTH', icon: 'truck', sub: 'ONE-PERSON CREW', text: 'Drive with the keys and aim with the mouse at the same time. Hard mode.', ai: 'NO AI' },
];

export class TitleScreen {
  constructor(ui, cb) {
    this.ui = ui; this.cb = cb; this.kind = 'title'; this.bg = 'title';
    this.view = 'menu'; this._actionGeneration = 0;
    this.el = h('<div class="screen title"></div>');
    this.render();
  }
  render() {
    this.el.innerHTML = `
      <div class="safe">
        <div class="tt-left">
          <div class="logo stg" style="--i:0"><span class="ln l1">RIDE OR</span><span class="ln l2">DIE</span><i class="logo-bar"></i></div>
          <div class="tagline stg" style="--i:1"><span>TWO PLAYERS</span><b></b><span>ONE RIDE</span><b></b><span>NO BRAKES</span></div>
          <div class="tt-view"></div>
        </div>
        <div class="tt-ver stg" style="--i:6">v0.9 &middot; DESERT-PUNK CO-OP ROAD COMBAT</div>
        <div class="hints" data-hints></div>
      </div>`;
    this.viewEl = this.el.querySelector('.tt-view');
    this.hintsEl = this.el.querySelector('[data-hints]');
    this.showMenu(false);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => { if (e.target.classList.contains('code')) this.sanitize(e.target); });
  }
  showMenu(anim = true, focusAct = 'solo') {
    const generation = ++this._actionGeneration;
    const cb = this.cb; this.view = 'menu'; this.el.classList.remove('joining', 'seating');
    const btn = (act, label, sub, i, extra = '') => `<div class="f btn stack stg ${extra}" style="--i:${i}" role="button" data-act="${act}" data-k="${act}"><span><b>${label}</b><small>${sub}</small></span></div>`;
    this.viewEl.innerHTML = `<nav class="menu">
      ${btn('solo', 'SINGLE PLAYER', 'DRIVE OR SHOOT &middot; AN AI PARTNER TAKES THE OTHER SEAT', 2, 'primary')}
      ${btn('host', 'HOST CO-OP', 'CREATE A ROOM &middot; SHARE THE CODE WITH A FRIEND', 3)}
      ${btn('join', 'JOIN CO-OP', 'ENTER A FRIEND&rsquo;S ROOM CODE', 4)}
      <div class="menu-split ${cb.onSaves ? 'menu-tools' : ''} stg" style="--i:5">
        ${cb.onSaves ? `<button type="button" class="f btn half" data-act="saves" data-k="saves"><span>${icon('copy')}SAVES</span></button>` : ''}
        ${`<div class="f btn half" role="button" data-act="settings" data-k="settings"><span>${icon('sliders')}SETTINGS</span></div>`}
        ${`<div class="f btn half" role="button" data-act="controls" data-k="controls"><span>${icon('gamepad')}CONTROLS</span></div>`}
      </div>
      ${cb.onQuit ? btn('quit', 'QUIT', 'EXIT TO DESKTOP', 7, 'danger') : ''}
    </nav><div class="tt-save-summary" data-save-summary hidden></div>`;
    this.updateSaveSummary(cb.saveSummary);
    this.hintsEl.innerHTML = hints([['nav', 'MOVE'], ['confirm', 'SELECT']]);
    if (anim) {
      this.viewEl.querySelector('.menu').animate([{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
      requestAnimationFrame(() => { if (this._activeView(generation, 'menu')) this.ui.nav.ensure(this.viewEl.querySelector(`[data-act=${focusAct}]`)); });
    }
  }
  showSeats() {
    const generation = ++this._actionGeneration;
    this.view = 'seats'; this.el.classList.add('seating');
    const card = (s, i) => `<div class="f seatcard stg" style="--i:${i}" role="button" data-seat="${s.id}" data-k="seat:${s.id}" data-snd="none">
        <div class="sc-ic">${icon(s.icon)}</div>
        <div class="sc-name">${s.name}</div><div class="sc-sub">${s.sub}</div>
        <p>${s.text}</p>
        <div class="sc-ai"><i></i>${s.ai}</div>
      </div>`;
    this.viewEl.innerHTML = `<div class="seats">
      <div class="eyebrow stg" style="--i:0">SINGLE PLAYER &middot; PICK YOUR SEAT</div>
      <div class="seatrow">${SEATS.map((s, i) => card(s, i + 1)).join('')}</div>
      <div class="tt-actions"><div class="f btn back-btn" role="button" data-act="sback" data-k="sback"><span>BACK</span></div></div>
    </div>`;
    this.hintsEl.innerHTML = hints([['navh', 'CHOOSE'], ['confirm', 'RIDE'], ['back', 'BACK']]);
    const last = this.ui.settings?.soloSeat || 'driver';
    requestAnimationFrame(() => { if (this._activeView(generation, 'seats')) this.ui.nav.focus(this.viewEl.querySelector(`[data-seat=${last}]`) || this.viewEl.querySelector('.seatcard'), { silent: true }); });
  }
  showJoin() {
    const generation = ++this._actionGeneration;
    this.view = 'join'; this.el.classList.add('joining');
    const keys = KEYS.map((k) => `<div class="f key" role="button" data-key="${k}"><span>${k}</span></div>`).join('');
    this.viewEl.innerHTML = `<div class="join">
      <div class="eyebrow">JOIN A FRIEND&rsquo;S ROOM</div>
      <div class="codebox interact"><input class="f code" data-submit=".jgo" maxlength="12" placeholder="ROOM CODE" spellcheck="false" autocomplete="off" autocapitalize="characters"></div>
      <div class="keypad">${keys}<div class="f key" role="button" data-key="0"><span>0</span></div><div class="f key w5" role="button" data-key="DEL"><span>&#9003; DELETE</span></div><div class="f key w4" role="button" data-key="CLR"><span>CLEAR</span></div></div>
      <div class="tt-actions"><div class="f btn primary jgo" role="button" data-act="jgo"><span>JOIN</span></div><div class="f btn" role="button" data-act="jback"><span>BACK</span></div></div>
    </div>`;
    this.hintsEl.innerHTML = hints([['nav', 'MOVE'], ['confirm', 'TYPE / SELECT'], ['back', 'BACK']]);
    this.input = this.viewEl.querySelector('.code');
    requestAnimationFrame(() => { if (this._activeView(generation, 'join')) this.ui.nav.focus(this.input, { silent: true }); });
    this.viewEl.querySelector('.join').animate([{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  sanitize(input) {
    const v = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (v !== input.value) input.value = v;
  }
  onClick(e) {
    const t = e.target.closest('.f'); if (!t) return;
    const ui = this.ui, cb = this.cb;
    if (t.dataset.key) {
      const inp = this.input; const k = t.dataset.key;
      if (k === 'DEL') inp.value = inp.value.slice(0, -1); else if (k === 'CLR') inp.value = ''; else if (inp.value.length < 12) inp.value += k;
      t.classList.remove('tap'); void t.offsetWidth; t.classList.add('tap');
      return;
    }
    if (t.dataset.seat) {
      ui.snd('go'); ui.pressFx(t);
      try { ui.changeSetting('soloSeat', t.dataset.seat); } catch { /* ignore */ }
      const generation = this._actionGeneration;
      if (cb.onSolo) setTimeout(() => {
        if (this._activeView(generation, 'seats')) cb.onSolo(t.dataset.seat);
      }, 120);
      return;
    }
    switch (t.dataset.act) {
      case 'host': ui.snd('go'); cb.onHost && cb.onHost(); break;
      case 'join': this.showJoin(); break;
      case 'solo': this.showSeats(); break;
      case 'sback': this.showMenu(true, 'solo'); break;
      case 'settings': if (cb.onSettings) cb.onSettings(); else ui.showSettings(); break;
      case 'controls': if (cb.onControls) cb.onControls(); else ui.showControls('driver'); break;
      case 'saves': cb.onSaves && cb.onSaves(); break;
      case 'quit': cb.onQuit && cb.onQuit(); break;
      case 'jgo': {
        const code = (this.input.value || '').trim();
        if (code.length < 3) { ui.snd('error'); this.input.parentElement.classList.remove('shake'); void this.input.offsetWidth; this.input.parentElement.classList.add('shake'); ui.toast('ENTER THE ROOM CODE', 'warn'); this.ui.nav.focus(this.input); break; }
        ui.snd('go'); cb.onJoin && cb.onJoin(code); break;
      }
      case 'jback': this.showMenu(true, 'join'); break;
      default:
    }
  }
  navOverride(el, dir) {
    if (this.view !== 'seats') return undefined;
    const cards = [...this.viewEl.querySelectorAll('.seatcard')];
    const i = cards.indexOf(el);
    if (i >= 0 && dir === 'down') return this.viewEl.querySelector('.back-btn');
    if (el.classList.contains('back-btn') && dir === 'up') return this.viewEl.querySelector('.seatcard.last-f') || cards[0];
    if (i >= 0) { cards.forEach((c) => c.classList.toggle('last-f', c === el)); }
    return undefined;
  }
  initialFocus() { return this.viewEl.querySelector('[data-act=solo]') || this.viewEl.querySelector('.f'); }
  updateSaveSummary(summary) {
    this.cb.saveSummary = summary;
    const element = this.viewEl.querySelector('[data-save-summary]'); if (!element) return;
    const name = typeof summary === 'string' ? summary : summary?.name;
    element.hidden = !name;
    if (!name) { element.textContent = ''; return; }
    const state = typeof summary === 'object' ? (summary.status || summary.cloud?.status || (summary.cloud?.connected ? 'connected' : 'disconnected')) : 'disconnected';
    const label = { connected: 'CLOUD CONNECTED', pending: 'SYNC QUEUED', offline: 'OFFLINE', syncing: 'SYNCING', connecting: 'CONNECTING', conflict: 'CONFLICT', error: 'SYNC ERROR', disconnected: 'LOCAL SAVE' }[state] || 'LOCAL SAVE';
    element.dataset.state = state;
    element.innerHTML = `<i></i><span>ACTIVE SAVE</span><strong>${esc(name)}</strong><small>${label}</small>`;
  }
  back() {
    if (this.view === 'join') { this.ui.snd('menu_close'); this.showMenu(true, 'join'); return true; }
    if (this.view === 'seats') { this.ui.snd('menu_close'); this.showMenu(true, 'solo'); return true; }
    return false;
  }
  resumed() { }
  _activeView(generation, view) { return !this._destroyed && this._actionGeneration === generation && this.view === view && this.ui.screen() === this; }
  destroy() { this._destroyed = true; this._actionGeneration++; }
}

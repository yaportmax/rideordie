// TITLE: logo + HOST / JOIN (room code entry incl. on-screen keypad for gamepads) / SOLO / SETTINGS / CONTROLS.
import { h } from '../comp.js';
import { hints } from '../glyphs.js';

const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789'.split('');

export class TitleScreen {
  constructor(ui, cb) {
    this.ui = ui; this.cb = cb; this.kind = 'title'; this.bg = 'title';
    this.view = 'menu';
    this.el = h('<div class="screen title"></div>');
    this.render();
  }
  render() {
    this.el.innerHTML = `
      <div class="safe">
        <div class="tt-left">
          <div class="logo stg" style="--i:0"><span class="ln l1">RIDE OR</span><span class="ln l2">DIE</span><i class="logo-bar"></i></div>
          <div class="tagline stg" style="--i:1"><span>TWO PLAYERS</span><b></b><span>ONE TRUCK</span><b></b><span>NO BRAKES</span></div>
          <div class="tt-view"></div>
        </div>
        <div class="tt-ver stg" style="--i:6">v0.1 &middot; DESERT-PUNK CO-OP ROAD COMBAT</div>
        <div class="hints" data-hints></div>
      </div>`;
    this.viewEl = this.el.querySelector('.tt-view');
    this.hintsEl = this.el.querySelector('[data-hints]');
    this.showMenu(false);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => { if (e.target.classList.contains('code')) this.sanitize(e.target); });
  }
  showMenu(anim = true) {
    const cb = this.cb; this.view = 'menu'; this.el.classList.remove('joining');
    const btn = (act, label, sub, i, extra = '') => `<div class="f btn stack stg ${extra}" style="--i:${i}" role="button" data-act="${act}"><span><b>${label}</b><small>${sub}</small></span></div>`;
    this.viewEl.innerHTML = `<nav class="menu">
      ${btn('host', 'HOST GAME', 'CREATE A ROOM &middot; SHARE THE CODE', 2, 'primary')}
      ${btn('join', 'JOIN GAME', 'ENTER A ROOM CODE', 3)}
      ${btn('solo', 'SINGLE PLAYER', 'DRIVE OR SHOOT &middot; AN AI PARTNER TAKES THE OTHER SEAT', 4)}
      ${btn('settings', 'SETTINGS', 'VIDEO &middot; AUDIO &middot; INPUT &middot; KEY BINDINGS', 5)}
      ${btn('controls', 'CONTROLS', 'KEYBOARD, MOUSE &amp; GAMEPAD LAYOUTS', 6)}
      ${cb.onQuit ? btn('quit', 'QUIT', 'EXIT TO DESKTOP', 7, 'danger') : ''}
    </nav>`;
    this.hintsEl.innerHTML = hints([['nav', 'MOVE'], ['confirm', 'SELECT']]);
    if (anim) requestAnimationFrame(() => this.ui.nav.ensure(this.viewEl.querySelector('[data-act=join]')));
  }
  showJoin() {
    this.view = 'join'; this.el.classList.add('joining');
    const keys = KEYS.map((k) => `<div class="f key" role="button" data-key="${k}"><span>${k}</span></div>`).join('');
    this.viewEl.innerHTML = `<div class="join">
      <div class="eyebrow">JOIN A ROOM</div>
      <div class="codebox interact"><input class="f code" data-submit=".jgo" maxlength="12" placeholder="ROOM CODE" spellcheck="false" autocomplete="off" autocapitalize="characters"></div>
      <div class="keypad">${keys}<div class="f key" role="button" data-key="0"><span>0</span></div><div class="f key w5" role="button" data-key="DEL"><span>&#9003; DELETE</span></div><div class="f key w4" role="button" data-key="CLR"><span>CLEAR</span></div></div>
      <div class="row"><div class="f btn primary jgo" role="button" data-act="jgo"><span>JOIN</span></div><div class="f btn" role="button" data-act="jback"><span>BACK</span></div></div>
    </div>`;
    this.hintsEl.innerHTML = hints([['nav', 'MOVE'], ['confirm', 'TYPE / SELECT'], ['back', 'BACK']]);
    this.input = this.viewEl.querySelector('.code');
    requestAnimationFrame(() => this.ui.nav.focus(this.input, { silent: true }));
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
    switch (t.dataset.act) {
      case 'host': ui.snd('go'); cb.onHost && cb.onHost(); break;
      case 'join': this.showJoin(); break;
      case 'solo': ui.snd('go'); cb.onSolo && cb.onSolo(); break;
      case 'settings': if (cb.onSettings) cb.onSettings(); else ui.showSettings(); break;
      case 'controls': if (cb.onControls) cb.onControls(); else ui.showControls('driver'); break;
      case 'quit': cb.onQuit && cb.onQuit(); break;
      case 'jgo': {
        const code = (this.input.value || '').trim();
        if (code.length < 3) { ui.snd('error'); this.input.parentElement.classList.remove('shake'); void this.input.offsetWidth; this.input.parentElement.classList.add('shake'); ui.toast('ENTER THE ROOM CODE', 'warn'); this.ui.nav.focus(this.input); break; }
        ui.snd('go'); cb.onJoin && cb.onJoin(code); break;
      }
      case 'jback': this.showMenu(); break;
      default:
    }
  }
  initialFocus() { return this.viewEl.querySelector('[data-act=host]'); }
  back() { if (this.view === 'join') { this.ui.snd('menu_close'); this.showMenu(); return true; } return false; }
  resumed() { }
}

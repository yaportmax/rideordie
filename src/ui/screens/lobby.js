// LOBBY: room code + copy, connection status, DRIVER / GUNNER seat cards, READY (everyone) and START (host).
import { h } from '../comp.js';
import { esc, icon, hints } from '../glyphs.js';

const ROLES = {
  driver: { name: 'DRIVER', icon: 'wheel', blurb: 'Steer, drift and burn nitro. Drop oil and mines. Keep the truck alive.' },
  gunner: { name: 'GUNNER', icon: 'crosshair', blurb: 'Stand in the bed with the guns. Shoot drivers, tyres and fuel tanks.' },
};
const STATUS = {
  closed: { txt: 'CONNECTION CLOSED', cls: 'bad' },
  connecting: { txt: 'CONNECTING', cls: 'wait', dots: true }, waiting: { txt: 'WAITING FOR PLAYER', cls: 'wait', dots: true },
  reconnecting: { txt: 'RECONNECTING', cls: 'wait', dots: true },
  connected: { txt: 'PLAYER CONNECTED', cls: 'ok' }, lost: { txt: 'CONNECTION LOST', cls: 'bad' },
};

export class LobbyScreen {
  constructor(ui, state, cb) {
    this.ui = ui; this.cb = cb; this.kind = 'lobby'; this.bg = 'dim';
    this.state = state;
    this.el = h('<div class="screen lobby"><div class="safe"></div></div>');
    this.safe = this.el.firstElementChild;
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.render();
  }
  me() { return (this.state.players || []).find((p) => p.you) || null; }
  other() { return (this.state.players || []).find((p) => !p.you) || null; }
  seatOccupant(role) { return (this.state.players || []).find((p) => p.seat === role) || null; }
  actionsAvailable() { return this.state.status === 'waiting' || this.state.status === 'connected'; }
  roomCode() { return String(this.state.code || '').trim().toUpperCase(); }
  canStart(s = this.state) {
    if (s.status !== 'connected') return false;
    const ps = s.players || [];
    if (s.canStart != null) return !!s.canStart;
    const d = ps.find((p) => p.seat === 'driver'), g = ps.find((p) => p.seat === 'gunner');
    return !!(d && g && d.ready && g.ready);
  }
  render() {
    const s = this.state, me = this.me(), st = STATUS[s.status] || STATUS.closed, available = this.actionsAvailable();
    const code = this.roomCode();
    const tiles = code ? [...code].map((c) => `<i>${esc(c)}</i>`).join('') : '<i class="ph">&middot;</i><i class="ph">&middot;</i><i class="ph">&middot;</i><i class="ph">&middot;</i>';
    const seat = (role) => {
      const R = ROLES[role], occ = this.seatOccupant(role), mine = !!(occ && occ.you);
      const disabled = !available || !!(occ && !mine);
      const dev = occ ? (occ.device === 'pad' ? `${icon('gamepad')}<span>CONTROLLER</span>` : `${icon('kbm')}<span>KEYBOARD &amp; MOUSE</span>`) : '';
      const body = occ
        ? `<div class="avatar">${esc((occ.name || '?').trim().charAt(0).toUpperCase())}</div><div class="who"><b>${esc(occ.name || 'PLAYER')}${occ.host ? '<em class="hostb">HOST</em>' : ''}</b><span class="dev">${dev}</span></div>${mine ? '<em class="you">YOU</em>' : ''}`
        : `<div class="openseat"><b>OPEN SEAT</b><small>${me && me.seat ? 'CLICK TO SWITCH HERE' : 'CLICK TO SIT HERE'}</small></div>`;
      const ready = occ ? `<div class="rdy ${occ.ready ? 'on' : ''}"><i></i>${occ.ready ? 'READY' : 'NOT READY'}</div>` : '<div class="rdy off"><i></i>WAITING FOR PLAYER&hellip;</div>';
      return `<div class="f seat ${role} ${mine ? 'mine' : ''} ${occ ? 'occ' : 'open'} ${occ && occ.ready ? 'isready' : ''} ${disabled ? 'dis' : ''}" role="button" aria-disabled="${disabled}" data-seat="${role}" data-k="seat:${role}">
        <div class="sk-top"><span class="sicon">${icon(R.icon)}</span><div><h3>${R.name}</h3><p>${R.blurb}</p></div></div>
        <div class="sk-body">${body}</div>${ready}</div>`;
    };
    const canStart = this.canStart(), host = !!s.isHost;
    const canReady = available && !!(me && me.seat);
    const readyBtn = `<div class="f btn ready-btn ${me && me.ready ? 'is-ready' : 'primary'} ${canReady ? '' : 'inactive dis'}" role="button" aria-disabled="${!canReady}" data-act="ready" data-k="ready" data-snd="none"><span>${me && me.ready ? icon('check') + ' READY' : 'READY UP'}${me && me.ready ? '<small>PRESS TO CANCEL</small>' : ''}</span></div>`;
    const startBtn = host
      ? `<div class="f btn start-btn ${canStart ? 'primary' : 'inactive dis'}" role="button" aria-disabled="${!canStart}" data-act="start" data-k="start" data-snd="none"><span>TO THE GARAGE${canStart ? '' : '<small>BOTH PLAYERS MUST BE READY</small>'}</span></div>`
      : '<div class="waithost"><i></i>WAITING FOR HOST TO START</div>';
    this.safe.innerHTML = `
      <div class="lb-title stg" style="--i:0"><div class="eyebrow">CO-OP LOBBY</div><h1>THE CONVOY</h1></div>
      <div class="lb-code plate trans stg" style="--i:1">
        <div class="lc-l"><span class="eyebrow">ROOM CODE</span><div class="codetiles">${tiles}</div><div class="lc-sub">SHARE THIS CODE WITH YOUR PARTNER</div></div>
        <div class="lc-r">
          <div class="f btn copy ${code ? '' : 'inactive dis'}" role="button" aria-disabled="${!code}" data-act="copy" data-k="copy"><span>${icon('copy')}COPY CODE</span></div>
          <div class="lb-status ${st.cls}"><i class="dot"></i><span>${st.txt}${st.dots ? '<b class="dots"><u>.</u><u>.</u><u>.</u></b>' : ''}</span>${s.latency != null && s.status === 'connected' ? `<em>${Math.round(s.latency)} MS</em>` : ''}</div>
        </div>
      </div>
      <div class="lb-seats">
        <div class="stg" style="--i:2">${seat('driver')}</div>
        <div class="vs stg" style="--i:3"><span>+</span></div>
        <div class="stg" style="--i:4">${seat('gunner')}</div>
      </div>
      <div class="lb-actions stg" style="--i:5">
        <div class="f btn danger leave" role="button" data-act="leave" data-k="leave"><span>LEAVE</span></div>
        <div class="sp"></div>${readyBtn}${startBtn}
      </div>
      <div class="hints" data-hints>${hints([['nav', 'MOVE'], ['confirm', 'SELECT'], ['back', 'LEAVE']])}</div>`;
  }
  update(state) {
    const old = this.state; this.state = state;
    const nav = this.ui.nav, k = nav.cur && this.el.contains(nav.cur) ? nav.cur.dataset.k : null;
    // small feedback for joins / leaves / both ready
    const on = (old.players || []).length, nn = (state.players || []).length;
    if (nn > on) { const p = state.players.find((x) => !x.you && !(old.players || []).some((o) => o.id === x.id)); if (p) { this.ui.toast(`${(p.name || 'PLAYER').toUpperCase()} JOINED`, 'good'); this.ui.snd('coin'); } }
    else if (nn < on) { const p = (old.players || []).find((o) => !(state.players || []).some((x) => x.id === o.id)); if (p && !p.you) { this.ui.toast(`${(p.name || 'PLAYER').toUpperCase()} LEFT`, 'warn'); } }
    if (!(old.status === 'lost') && state.status === 'lost') this.ui.snd('error');
    const wasGo = this.canStart(old), nowGo = this.canStart();
    this.render();
    if (!wasGo && nowGo) this.ui.snd('ready');
    if (k) { const n = this.el.querySelector(`[data-k="${k}"]`); if (n && nav.isFocusable(n)) nav.focus(n, { silent: true, reveal: false }); }
    if (!nav.cur || !nav.cur.isConnected) nav.ensure();
  }
  copy() {
    const code = this.roomCode();
    if (!code) return;
    const done = () => { this.ui.toast('ROOM CODE COPIED', 'good', 1800); this.cb.onCopy && this.cb.onCopy(); };
    const fallback = () => {
      let t;
      try { t = document.createElement('textarea'); t.value = code; t.style.cssText = 'position:fixed;left:-999px'; document.body.appendChild(t); t.select(); if (!document.execCommand('copy')) throw new Error('Copy failed'); done(); }
      catch { this.ui.toast('COULD NOT COPY - CODE: ' + code, 'warn'); }
      finally { t?.remove(); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(code).then(done, fallback);
    return fallback();
  }
  onClick(e) {
    const t = e.target.closest('.f'); if (!t || t.classList.contains('dis')) return;
    const ui = this.ui, cb = this.cb, me = this.me();
    if ((t.dataset.seat || t.dataset.act === 'ready' || t.dataset.act === 'start') && !this.actionsAvailable()) return;
    if (t.dataset.seat) {
      const role = t.dataset.seat, occ = this.seatOccupant(role);
      if (occ && !occ.you) { ui.snd('error'); ui.toast('SEAT TAKEN', 'warn', 1500); return; }
      if (occ && occ.you) return;
      cb.onSeat && cb.onSeat(role); return;
    }
    switch (t.dataset.act) {
      case 'copy': this.copy(); break;
      case 'leave': cb.onLeave && cb.onLeave(); break;
      case 'ready':
        if (!me || !me.seat) { ui.snd('error'); ui.toast('PICK A SEAT FIRST', 'warn', 1600); t.classList.add('shake'); setTimeout(() => t.classList.remove('shake'), 400); break; }
        ui.snd('ready'); cb.onReady && cb.onReady(!me.ready); break;
      case 'start':
        if (!this.canStart()) { ui.snd('error'); ui.toast('BOTH PLAYERS MUST PICK A SEAT AND READY UP', 'warn', 2000); t.classList.add('shake'); setTimeout(() => t.classList.remove('shake'), 400); break; }
        ui.snd('go'); cb.onStart && cb.onStart(); break;
      default:
    }
  }
  initialFocus() {
    if (!this.actionsAvailable()) return this.el.querySelector('[data-act=leave]');
    const me = this.me();
    if (!me || !me.seat) return this.el.querySelector('.seat.open') || this.el.querySelector('.seat');
    return this.el.querySelector('[data-act=ready]');
  }
  back() { if (this.cb.onLeave) { this.ui.snd('menu_close'); this.cb.onLeave(); } return true; }
  alt(name) { if (name === 'y') { const b = this.el.querySelector('[data-act=ready]'); if (b) b.click(); } }
}

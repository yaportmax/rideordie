// Session: the two-player room on top of Transport. Host = room creator (owns the save + shop). Roles are chosen in the lobby.
// Messages (reliable JSON): hello, lobby, role, ready, start, profile, buy, runOver, results, + in-run messages (see Run.onNet).
import { Transport } from './transport.js';
import { loadProfile, saveProfile, buyTruck, buyUpgrade, buyWeapon, buyWeaponTrack, equipWeapon, selectTruck, cycleColor, creditRun, newerProfile } from '../meta/profile.js';

export class Session {
  constructor() {
    this.tp = new Transport();
    this.isHost = false; this.connected = false; this.code = '';
    this.me = { name: 'Player', role: null, ready: false };
    this.other = null; // {name, role, ready}
    this.profile = null;
    this.h = {}; // handlers: lobby, start, profile, run, fast, disconnect, results, error, buyDenied
    this.tp.onMessage = (m) => this._onMsg(m);
    this.tp.onFast = (b) => this.h.fast && this.h.fast(b);
    this.tp.onClose = () => { this.connected = false; this.h.disconnect && this.h.disconnect(); };
    this.tp.onError = (e) => this.h.error && this.h.error(e);
    this.tp.onOpen = () => { this.connected = true; this.tp.send({ t: 'hello', name: this.me.name, campaign: this.profile?.campaignId, rev: this.profile?.revision }); if (this.isHost) this._broadcastLobby(); };
  }
  on(h) { Object.assign(this.h, h); return this; }
  get rtt() { return this.tp.rtt; }

  async host(profile) { this.isHost = true; this.profile = profile; this.code = await this.tp.host(); return this.code; }
  async join(code, profile) { this.isHost = false; this.profile = profile; await this.tp.join(code); this.code = code.toUpperCase(); }
  leave() { this.tp.destroy(); this.connected = false; this.other = null; }

  // ---- lobby
  setRole(role) { this.me.role = role; if (this.isHost) this._broadcastLobby(); else this.tp.send({ t: 'role', role }); this.h.lobby && this.h.lobby(this.lobby()); }
  setReady(r) { this.me.ready = r; if (this.isHost) this._broadcastLobby(); else this.tp.send({ t: 'ready', ready: r }); this.h.lobby && this.h.lobby(this.lobby()); }
  lobby() { return { code: this.code, isHost: this.isHost, me: { ...this.me }, other: this.other ? { ...this.other } : null, connected: this.connected }; }
  _broadcastLobby() {
    // resolve role clashes: the host keeps its choice, the guest gets the other seat
    if (this.other && this.other.role && this.other.role === this.me.role) this.other.role = null;
    this.tp.send({ t: 'lobby', host: { ...this.me }, guest: this.other ? { ...this.other } : null });
    this.h.lobby && this.h.lobby(this.lobby());
  }
  canStart() { return this.isHost && this.connected && this.other && this.me.role && this.other.role && this.me.role !== this.other.role && this.me.ready && this.other.ready; }

  /** Host: begin a run. Returns the start config (also sent to the guest). */
  startRun(extra = {}) {
    const seed = extra.seed ?? ((Math.random() * 1e9) | 0);
    const cfg = { seed, roles: { host: this.me.role, guest: this.other.role }, profile: this.profile, ...extra };
    this.tp.send({ t: 'start', cfg });
    this.me.ready = false; if (this.other) this.other.ready = false;
    return { ...cfg, role: this.me.role };
  }

  // ---- shop (host authoritative)
  buy(kind, id, extra) {
    if (this.isHost) return this._applyBuy({ kind, id, extra });
    this.tp.send({ t: 'buy', kind, id, extra });
    return { ok: true, pending: true };
  }
  _applyBuy(m) {
    const p = this.profile; let r = { ok: false };
    if (m.kind === 'truck') r = buyTruck(p, m.id);
    else if (m.kind === 'select') r = selectTruck(p, m.id);
    else if (m.kind === 'upgrade') r = buyUpgrade(p, m.id);
    else if (m.kind === 'weapon') r = buyWeapon(p, m.id);
    else if (m.kind === 'track') r = buyWeaponTrack(p, m.id, m.extra);
    else if (m.kind === 'equip') r = equipWeapon(p, m.id, m.extra);
    else if (m.kind === 'color') { p.truckColor = m.id; r = { ok: true }; }
    if (r.ok) { saveProfile(p); this.tp.send({ t: 'profile', p }); this.h.profile && this.h.profile(p, m); }
    return r;
  }
  broadcastProfile() { if (this.isHost) { saveProfile(this.profile); this.tp.send({ t: 'profile', p: this.profile }); } }

  sendJSON(m, unreliableOK) { this.tp.send(m); }
  sendFast(b) { this.tp.sendFast(b); }

  _onMsg(m) {
    switch (m.t) {
      case 'hello': this.other = { name: m.name || 'Player', role: this.other?.role ?? null, ready: false }; if (this.isHost) this._broadcastLobby(); break;
      case 'lobby': if (!this.isHost) { this.other = { ...m.host }; this.me = { ...this.me, role: m.guest?.role ?? this.me.role, ready: m.guest?.ready ?? this.me.ready }; this.h.lobby && this.h.lobby(this.lobby()); } break;
      case 'role': if (this.isHost && this.other) { this.other.role = m.role; this._broadcastLobby(); } break;
      case 'ready': if (this.isHost && this.other) { this.other.ready = m.ready; this._broadcastLobby(); } break;
      case 'start': if (!this.isHost) { this.profile = m.cfg.profile; const role = m.cfg.roles.guest; this.h.start && this.h.start({ ...m.cfg, role }); } break;
      case 'profile': if (!this.isHost) { this.profile = m.p; try { localStorage.setItem('rideordie.profile.v1.' + m.p.campaignId, JSON.stringify(m.p)); } catch { /* */ } this.h.profile && this.h.profile(m.p); } break;
      case 'buy': if (this.isHost) { const r = this._applyBuy(m); if (!r.ok) this.tp.send({ t: 'buyDenied', reason: r.reason, kind: m.kind, id: m.id }); } break;
      case 'buyDenied': this.h.buyDenied && this.h.buyDenied(m); break;
      case 'runOver': this.h.runOver && this.h.runOver(m); break;
      case 'results': this.h.results && this.h.results(m); break;
      default: this.h.run && this.h.run(m);
    }
  }
}

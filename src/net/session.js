// Session: the two-player room on top of Transport. Host = room creator (owns the save + shop). Roles are chosen in the lobby.
// Messages (reliable JSON): hello, lobby, role, ready, start, profile, buy, runOver, results, + in-run messages (see Run.onNet).
import { Transport } from './transport.js';
import { normalizeProfile, saveProfile, buyTruck, buyUpgrade, buyWeapon, buyWeaponTrack, equipWeapon, selectTruck } from '../meta/profile.js';
import { TRUCK_COLORS } from '../data/upgrades.js';

const ROLES = new Set(['driver', 'gunner']);

export class Session {
  constructor(transport = null) {
    this.tp = transport || new Transport();
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
  leave() { this.tp.destroy(); this.connected = false; this.other = null; this.me.ready = false; }

  // ---- lobby
  setRole(role) {
    if (!ROLES.has(role) || this.me.role === role) return;
    this.me.role = role; this.me.ready = false;
    if (this.isHost) { if (this.other) this.other.ready = false; this._broadcastLobby(); } else this.tp.send({ t: 'role', role });
    this.h.lobby && this.h.lobby(this.lobby());
  }
  setReady(r) { this.me.ready = !!r && ROLES.has(this.me.role); if (this.isHost) this._broadcastLobby(); else this.tp.send({ t: 'ready', ready: this.me.ready }); this.h.lobby && this.h.lobby(this.lobby()); }
  lobby() { return { code: this.code, isHost: this.isHost, me: { ...this.me }, other: this.other ? { ...this.other } : null, connected: this.connected }; }
  _broadcastLobby() {
    // resolve role clashes: the host keeps its choice, the guest gets the other seat
    if (this.other && this.other.role && this.other.role === this.me.role) { this.other.role = null; this.other.ready = false; this.me.ready = false; }
    this.tp.send({ t: 'lobby', host: { ...this.me }, guest: this.other ? { ...this.other } : null });
    this.h.lobby && this.h.lobby(this.lobby());
  }
  canStart() { return !!(this.isHost && this.connected && this.other && ROLES.has(this.me.role) && ROLES.has(this.other.role) && this.me.role !== this.other.role && this.me.ready && this.other.ready); }

  /** Host: begin a run. Returns the start config (also sent to the guest). */
  startRun(extra = {}) {
    if (!this.canStart()) return null;
    const seed = extra.seed ?? ((Math.random() * 1e9) | 0);
    const cfg = { ...extra, seed, runId: globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, roles: { host: this.me.role, guest: this.other.role }, profile: this.profile };
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
    else if (m.kind === 'track' || m.kind === 'weaponTrack') r = buyWeaponTrack(p, m.id, m.extra);
    else if (m.kind === 'equip') r = equipWeapon(p, m.id, m.extra);
    else if (m.kind === 'color' && Number.isInteger(m.id) && m.id >= 0 && m.id < TRUCK_COLORS.length) { p.truckColor = m.id; r = { ok: true }; }
    if (r.ok) { saveProfile(p); this.tp.send({ t: 'profile', p }); this.h.profile && this.h.profile(p, m); }
    return r;
  }
  broadcastProfile() { if (this.isHost) this.tp.send({ t: 'profile', p: this.profile }); }

  sendJSON(m, unreliableOK) { this.tp.send(m); }
  sendFast(b) { this.tp.sendFast(b); }

  _onMsg(m) {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'hello': this.other = { name: m.name || 'Player', role: this.other?.role ?? null, ready: false }; if (this.isHost) this._broadcastLobby(); break;
      case 'lobby': if (!this.isHost && m.host) { this.other = { ...m.host }; if (m.guest) this.me = { ...this.me, role: m.guest.role, ready: !!m.guest.ready }; this.h.lobby && this.h.lobby(this.lobby()); } break;
      case 'role': if (this.isHost && this.other && ROLES.has(m.role)) { this.other.role = m.role; this.me.ready = this.other.ready = false; this._broadcastLobby(); } break;
      case 'ready': if (this.isHost && this.other) { this.other.ready = !!m.ready && ROLES.has(this.other.role); this._broadcastLobby(); } break;
      case 'start': if (!this.isHost && m.cfg && ROLES.has(m.cfg.roles?.guest) && ROLES.has(m.cfg.roles?.host) && m.cfg.roles.guest !== m.cfg.roles.host) { this.profile = normalizeProfile(m.cfg.profile); const role = m.cfg.roles.guest; this.me.ready = false; this.h.start && this.h.start({ ...m.cfg, profile: this.profile, role }); } break;
      case 'profile': if (!this.isHost && m.p) { this.profile = normalizeProfile(m.p); try { localStorage.setItem('rideordie.profile.v1.' + this.profile.campaignId, JSON.stringify(this.profile)); } catch { /* */ } this.h.profile && this.h.profile(this.profile); } break;
      case 'buy': if (this.isHost) { const r = this._applyBuy(m); if (!r.ok) this.tp.send({ t: 'buyDenied', reason: r.reason, kind: m.kind, id: m.id }); } break;
      case 'buyDenied': this.h.buyDenied && this.h.buyDenied(m); break;
      case 'runOver': this.h.runOver && this.h.runOver(m); break;
      case 'results': this.h.results && this.h.results(m); break;
      default: this.h.run && this.h.run(m);
    }
  }
}

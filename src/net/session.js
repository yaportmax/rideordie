// Session: the room creator owns the shared campaign and validates the shop.
// Cash belongs to each person, independently of their driver/gunner seat.
// Messages (reliable JSON): hello, lobby, role, ready, start, profile, buy, runOver, results, + in-run messages (see Run.onNet).
import { Transport } from './transport.js';
import { normalizeProfile, saveProfile, buyTruck, buyUpgrade, buyWeapon, buyWeaponTrack, equipWeapon, selectTruck, creditRun } from '../meta/profile.js';
import { TRUCK_COLORS } from '../data/upgrades.js';

const ROLES = new Set(['driver', 'gunner']);
const natural = (v) => Number.isFinite(v) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(v))) : 0;
const runId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : null;
const walletOf = (p) => ({ playerId: p.campaignId, cash: natural(p.cash), totalCash: natural(p.totalCash), lastRunId: runId(p.coopLastRunId) });
const readWallet = (v) => v && typeof v.playerId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v.playerId)
  ? { playerId: v.playerId, cash: natural(v.cash), totalCash: natural(v.totalCash), lastRunId: runId(v.lastRunId) } : null;

export class Session {
  constructor(transport = null) {
    this.tp = transport || new Transport();
    this.isHost = false; this.connected = false; this.code = '';
    this.me = { name: 'Player', role: null, ready: false };
    this.other = null; // {name, role, ready}
    this.profile = null;
    this.personalProfile = null; this.peerWallet = null; this.wallet = null;
    this.activeRunId = null;
    this._receivedCampaign = null; this._receivedRevision = -1; this._startedRunIds = new Set();
    this._runSeq = 0; this._receivedRunSeq = 0;
    this.h = {}; // handlers: lobby, start, profile, run, fast, disconnect, results, error, buyDenied
    this.tp.onMessage = (m) => this._onMsg(m);
    this.tp.onFast = (b) => this.h.fast && this.h.fast(b);
    this.tp.onClose = () => { this.connected = false; this.activeRunId = null; this.peerWallet = null; this.h.disconnect && this.h.disconnect(); };
    this.tp.onError = (e) => this.h.error && this.h.error(e);
    this.tp.onOpen = () => { this.connected = true; this.tp.send({ t: 'hello', name: this.me.name, campaign: this.profile?.campaignId, rev: this.profile?.revision, wallet: walletOf(this.personalProfile) }); if (this.isHost) this._broadcastLobby(); };
  }
  on(h) { Object.assign(this.h, h); return this; }
  get rtt() { return this.tp.rtt; }

  async host(profile) { this.isHost = true; this.peerWallet = null; this.profile = this.personalProfile = profile; this.wallet = walletOf(profile); this.code = await this.tp.host(); return this.code; }
  async join(code, profile) { this.isHost = false; this.peerWallet = null; this.profile = this.personalProfile = profile; this.wallet = walletOf(profile); await this.tp.join(code); this.code = code.toUpperCase(); }
  leave() { this.tp.destroy(); this.connected = false; this.other = null; this.me.ready = false; this.activeRunId = null; }

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
  canStart() { return !!(this.isHost && this.connected && this.peerWallet && this.other && ROLES.has(this.me.role) && ROLES.has(this.other.role) && this.me.role !== this.other.role && this.me.ready && this.other.ready); }

  /** Host: begin a run. Returns the start config (also sent to the guest). */
  startRun(extra = {}) {
    if (!this.canStart()) return null;
    const seed = extra.seed ?? ((Math.random() * 1e9) | 0);
    const cfg = { ...extra, seed, runId: globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, runSeq: ++this._runSeq, roles: { host: this.me.role, guest: this.other.role }, profile: this.profile };
    this.activeRunId = cfg.runId;
    this.tp.send({ t: 'start', cfg, wallet: this.peerWallet });
    this.me.ready = false; if (this.other) this.other.ready = false;
    return { ...cfg, role: this.me.role };
  }

  // ---- shop (host authoritative)
  buy(kind, id, extra) {
    if (this.isHost) return this._applyBuy({ kind, id, extra });
    this.tp.send({ t: 'buy', kind, id, extra });
    return { ok: true, pending: true };
  }
  _applyBuy(m, peer = false) {
    const wallet = peer ? this.peerWallet : walletOf(this.personalProfile);
    if (!wallet) return { ok: false, reason: 'wallet' };
    // Existing catalogue validation applies to a transaction funded only by
    // the requester. A guest cannot choose a payer or borrow the host balance.
    const p = structuredClone(this.profile); p.cash = wallet.cash;
    let r = { ok: false, reason: 'invalid' };
    if (m.kind === 'truck') r = buyTruck(p, m.id);
    else if (m.kind === 'select') r = selectTruck(p, m.id);
    else if (m.kind === 'upgrade') r = buyUpgrade(p, m.id);
    else if (m.kind === 'weapon') r = buyWeapon(p, m.id);
    else if (m.kind === 'track' || m.kind === 'weaponTrack') r = buyWeaponTrack(p, m.id, m.extra);
    else if (m.kind === 'equip') r = equipWeapon(p, m.id, m.extra);
    else if (m.kind === 'color' && Number.isInteger(m.id) && m.id >= 0 && m.id < TRUCK_COLORS.length) { p.truckColor = m.id; r = { ok: true }; }
    if (r.ok) {
      const hostCash = this.profile.cash;
      Object.assign(this.profile, p, { cash: peer ? hostCash : p.cash });
      if (peer) this.peerWallet.cash = p.cash;
      saveProfile(this.personalProfile); this.wallet = walletOf(this.personalProfile);
      this.broadcastProfile(); this.h.profile && this.h.profile(this.profile, m);
    }
    return r;
  }
  broadcastProfile() { if (this.isHost) this.tp.send({ t: 'profile', p: this.profile, wallet: this.peerWallet }); }

  /** The shared run pays its existing team reward to both independent wallets. */
  creditResult(run) {
    if (!this.isHost || !run || !run.id || run.id !== this.activeRunId) return false;
    let changed = false;
    if (this.profile.lastRunId !== run.id) { creditRun(this.profile, run); this.profile.coopLastRunId = run.id; changed = true; }
    const w = this.peerWallet;
    if (w && w.lastRunId !== run.id) {
      const cash = natural(run.cash); w.cash = natural(w.cash + cash); w.totalCash = natural(w.totalCash + cash); w.lastRunId = run.id; changed = true;
    }
    if (changed) { saveProfile(this.personalProfile); this.wallet = walletOf(this.personalProfile); this.broadcastProfile(); this.h.profile && this.h.profile(this.profile); }
    return changed;
  }
  hasCreditedResult(id) { return !!id && this.wallet?.lastRunId === id; }

  _receiveProfile(value, remoteWallet) {
    const wallet = readWallet(remoteWallet);
    if (!wallet || wallet.playerId !== this.personalProfile.campaignId) return false;
    const profile = normalizeProfile(value);
    if ((this._receivedCampaign && profile.campaignId !== this._receivedCampaign) || profile.revision < this._receivedRevision) return false;
    this._receivedCampaign = profile.campaignId; this._receivedRevision = profile.revision;
    this.wallet = wallet;
    const personal = this.personalProfile;
    if (personal.cash !== wallet.cash || personal.totalCash !== wallet.totalCash || (personal.coopLastRunId || null) !== wallet.lastRunId) {
      personal.cash = wallet.cash; personal.totalCash = wallet.totalCash; personal.coopLastRunId = wallet.lastRunId;
      saveProfile(personal);
    }
    this.profile = profile;
    this.profile.cash = wallet.cash; this.profile.totalCash = wallet.totalCash;
    // Mirroring the crew's campaign must never replace the guest's own save.
    try { if (this.profile.campaignId !== personal.campaignId) localStorage.setItem('rideordie.profile.v1.' + this.profile.campaignId, JSON.stringify(this.profile)); } catch { /* blocked storage */ }
    return true;
  }

  sendJSON(m, unreliableOK) { this.tp.send(m); }
  sendFast(b) { this.tp.sendFast(b); }

  _onMsg(m) {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'hello':
        this.other = { name: m.name || 'Player', role: this.other?.role ?? null, ready: false };
        if (this.isHost) {
          // Establish once from the connected person's save, never from a buy
          // message or a repeated hello after spending has begun.
          if (!this.peerWallet) this.peerWallet = readWallet(m.wallet);
          this._broadcastLobby();
        }
        break;
      case 'lobby': if (!this.isHost && m.host) { this.other = { ...m.host }; if (m.guest) this.me = { ...this.me, role: m.guest.role, ready: !!m.guest.ready }; this.h.lobby && this.h.lobby(this.lobby()); } break;
      case 'role': if (this.isHost && this.other && ROLES.has(m.role)) { this.other.role = m.role; this.me.ready = this.other.ready = false; this._broadcastLobby(); } break;
      case 'ready': if (this.isHost && this.other) { this.other.ready = !!m.ready && ROLES.has(this.other.role); this._broadcastLobby(); } break;
      case 'start': if (!this.isHost && m.cfg && runId(m.cfg.runId) && Number.isSafeInteger(m.cfg.runSeq) && m.cfg.runSeq > this._receivedRunSeq && !this._startedRunIds.has(m.cfg.runId) && ROLES.has(m.cfg.roles?.guest) && ROLES.has(m.cfg.roles?.host) && m.cfg.roles.guest !== m.cfg.roles.host && this._receiveProfile(m.cfg.profile, m.wallet)) { this._receivedRunSeq = m.cfg.runSeq; this._startedRunIds.add(m.cfg.runId); this.activeRunId = m.cfg.runId; const role = m.cfg.roles.guest; this.me.ready = false; this.h.start && this.h.start({ ...m.cfg, profile: this.profile, role }); } break;
      case 'profile': if (!this.isHost && m.p && this._receiveProfile(m.p, m.wallet)) this.h.profile && this.h.profile(this.profile); break;
      case 'buy': if (this.isHost) { const r = this._applyBuy(m, true); if (!r.ok) this.tp.send({ t: 'buyDenied', reason: r.reason, kind: m.kind, id: m.id }); } break;
      case 'buyDenied': this.h.buyDenied && this.h.buyDenied(m); break;
      case 'runOver': this.h.runOver && this.h.runOver(m); break;
      case 'results': this.h.results && this.h.results(m); break;
      default: this.h.run && this.h.run(m);
    }
  }
}

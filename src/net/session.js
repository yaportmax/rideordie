// Session: the room creator owns the shared campaign and validates the shop.
// Cash belongs to each person, independently of their driver/gunner seat.
// Messages (reliable JSON): hello, lobby, role, ready, start, profile, buy, runOver, results, + in-run messages (see Run.onNet).
import { Transport } from './transport.js';
import { planEventPackets } from './event_batches.js';
import { GarageSeatSwap, GARAGE_SEAT_PROTOCOL } from './garage_seats.js';
import { PLAYER_VEHICLE_PROTOCOL } from '../data/vehicle_families.js';
import { ELITE_VEHICLE_PROTOCOL } from '../data/elite_vehicles.js';
import { assertSupportedProfile } from '../../server/saves/profile_support.js';
import { DRIVING_ROUTE_VERSION } from '../world/driving_plan.js';
import { CAMPAIGN_PROTOCOL, normalizeJourney, normalizeCampaignProgress, campaignJourney, selectCampaignLevel, creditCampaignLevel } from '../data/campaign.js';
import { normalizeProfile, saveProfile, buyTruck, buyUpgrade, buyWeapon, buyWeaponTrack, equipWeapon, selectTruck, creditRun } from '../meta/profile.js';
import { buyWeaponOptic, equipWeaponOptic } from '../meta/weapon_optics.js';
import { TRUCK_COLORS } from '../data/upgrades.js';
import { NET_PROTOCOL, RUN_JSON_TYPES, validRunId, createRunHeader, encodeRunPacket, decodeRunPacket } from './run_packet.js';

const ROLES = new Set(['driver', 'gunner']);
const natural = (v) => Number.isFinite(v) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(v))) : 0;
const runId = (v) => validRunId(v) ? v : null;
const walletOf = (p) => ({ playerId: p.campaignId, cash: natural(p.cash), totalCash: natural(p.totalCash), lastRunId: runId(p.coopLastRunId) });
const readWallet = (v) => v && typeof v.playerId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v.playerId)
  ? { playerId: v.playerId, cash: natural(v.cash), totalCash: natural(v.totalCash), lastRunId: runId(v.lastRunId) } : null;
const JOURNEY_MODES = new Set(['campaign', 'marathon', 'legacy']);
const sameJourney = (a, b) => !!(a && b && a.version === b.version && a.mode === b.mode && a.level === b.level);
// Network commands are strict. Save/debug normalization must not silently turn
// an unknown chapter/version/mode into a playable host-authoritative command.
function parseJourney(value) {
  if (value === undefined) return normalizeJourney();
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 3
    || Object.keys(value).some(key => !['version', 'mode', 'level'].includes(key))
    || value.version !== CAMPAIGN_PROTOCOL || !JOURNEY_MODES.has(value.mode)
    || !Number.isInteger(value.level) || value.level < 1 || value.level > 10) return null;
  return normalizeJourney(value);
}
function readJourney(value, profile) {
  const journey = parseJourney(value);
  if (!journey) return null;
  if (journey.mode !== 'legacy') {
    const progress = normalizeCampaignProgress(profile?.campaignProgress);
    if (journey.level > progress.unlockedLevel || (journey.mode === 'marathon' && !progress.marathonUnlocked)
      || !sameJourney(journey, campaignJourney(profile))) return null;
  }
  return journey;
}

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
    this._peerProtocol = null; this._protocolError = null;
    this.h = {}; // handlers: lobby, start, profile, run, fast, disconnect, results, error, buyDenied
    this.swap = new GarageSeatSwap(this, {
      onState: (state, event) => this.h.garageSeats?.(state, event),
      onSwap: (state) => this.h.seatSwapped?.(state),
    });
    this.tp.onMessage = (m) => this._onMsg(m);
    this.tp.onFast = (b) => {
      if (this._peerProtocol !== NET_PROTOCOL) return;
      const body = decodeRunPacket(this._fastHeader, b);
      if (body) this.h.fast && this.h.fast(body);
    };
    this.tp.onClose = () => { this.connected = false; this.activeRunId = null; this.peerWallet = null; this._peerProtocol = null; this.swap.disconnect(); if (!this._protocolError) this.h.disconnect && this.h.disconnect(); };
    this.tp.onError = (e) => this.h.error && this.h.error(e);
    this.tp.onState = (status, details) => this.h.state && this.h.state(status, details);
    this.tp.onOpen = () => { this.connected = true; this.tp.send({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL, familyVehicles: PLAYER_VEHICLE_PROTOCOL, eliteVehicles: ELITE_VEHICLE_PROTOCOL, drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL, name: this.me.name, campaign: this.profile?.campaignId, rev: this.profile?.revision, wallet: walletOf(this.personalProfile) }); if (this.isHost) this._broadcastLobby(); };
  }
  on(h) { Object.assign(this.h, h); return this; }
  get rtt() { return this.tp.rtt; }
  get runSeq() { return this.isHost ? this._runSeq : this._receivedRunSeq; }
  get status() { return this.tp.status ?? (this.connected ? 'connected' : 'waiting'); }
  get signallingState() { return this.tp.signallingState ?? 'unknown'; }
  get protocolError() { return this._protocolError; }
  get activeRunId() { return this._activeRunId; }
  get activeRunJourney() { return this._activeRunJourney; }
  get activeRunRoles() { return this._activeRunRoles; }
  set activeRunId(id) {
    const next = runId(id);
    if (next !== this._activeRunId) {
      this._activeRunJourney = next ? normalizeJourney() : null;
      this._activeRunRoles = null;
      this._creditedResultId = null;
      this._receivedSummaryId = null;
    }
    this._activeRunId = next;
    this._fastHeader = createRunHeader(this._activeRunId);
  }

  async host(profile) { assertSupportedProfile(profile); this.isHost = true; this.peerWallet = null; this._peerProtocol = null; this._protocolError = null; this.profile = this.personalProfile = profile; this.wallet = walletOf(profile); this.code = await this.tp.host(); return this.code; }
  async join(code, profile) { assertSupportedProfile(profile); this.isHost = false; this.peerWallet = null; this._peerProtocol = null; this._protocolError = null; this.profile = this.personalProfile = profile; this.wallet = walletOf(profile); await this.tp.join(code); this.code = code.toUpperCase(); }
  leave() { this.swap.disconnect(); this.tp.destroy(); this.connected = false; this.other = null; this.me.ready = false; this.activeRunId = null; this._peerProtocol = null; }

  // ---- lobby
  setRole(role) {
    if (this.swap.localPhase !== 'lobby' || !ROLES.has(role) || this.me.role === role) return;
    this.me.role = role; this.me.ready = false;
    if (this.isHost) { if (this.other) this.other.ready = false; this._broadcastLobby(); } else this.tp.send({ t: 'role', role });
    this.h.lobby && this.h.lobby(this.lobby());
  }
  setReady(r) { if (this.swap.localPhase !== 'lobby') return; this.me.ready = !!r && ROLES.has(this.me.role); if (this.isHost) this._broadcastLobby(); else this.tp.send({ t: 'ready', ready: this.me.ready }); this.h.lobby && this.h.lobby(this.lobby()); }
  lobby() { return { code: this.code, isHost: this.isHost, me: { ...this.me }, other: this.other ? { ...this.other } : null, connected: this.connected }; }
  _broadcastLobby() {
    // resolve role clashes: the host keeps its choice, the guest gets the other seat
    if (this.other && this.other.role && this.other.role === this.me.role) { this.other.role = null; this.other.ready = false; this.me.ready = false; }
    this.tp.send({ t: 'lobby', host: { ...this.me }, guest: this.other ? { ...this.other } : null });
    this.h.lobby && this.h.lobby(this.lobby());
  }
  canStart() { return !!(this.isHost && this.connected && this._peerProtocol === NET_PROTOCOL && this.peerWallet && this.other && ROLES.has(this.me.role) && ROLES.has(this.other.role) && this.me.role !== this.other.role && this.me.ready && this.other.ready && (this.swap.localPhase === 'lobby' || this.swap.canStart())); }

  /** Only the room creator chooses the shared chapter while both are in the garage. */
  selectJourney(level, mode = 'campaign') {
    if (!this.isHost || !this.swap._garage()) return { ok: false, reason: 'unavailable' };
    const result = selectCampaignLevel(this.profile, level, mode);
    if (!result.ok) return result;
    // Retain garage presence/epoch and role equipment, but revoke old consent
    // and ready messages by advancing the existing authoritative seat revision.
    this.swap.state.revision++; this.swap.state.pending = null;
    this.swap._clearReady();
    saveProfile(this.personalProfile); this.wallet = walletOf(this.personalProfile);
    this.broadcastProfile(); this.swap._publish('journey', 'host');
    this.h.profile && this.h.profile(this.profile);
    return { ok: true };
  }

  /** Host: begin a run. Returns the start config (also sent to the guest). */
  startRun(extra = {}) {
    if (!this.canStart()) return null;
    const journey = readJourney(extra.journey, this.profile);
    if (!journey) return null;
    const seed = extra.seed ?? ((Math.random() * 1e9) | 0);
    const cfg = { ...extra, journey, seed, runId: globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, runSeq: ++this._runSeq, roles: { host: this.me.role, guest: this.other.role }, profile: this.profile };
    this.activeRunId = cfg.runId;
    this._activeRunJourney = journey;
    this._activeRunRoles = Object.freeze({ ...cfg.roles });
    this.swap.leaveGarage('run');
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
    else if (m.kind === 'weaponOptic') r = buyWeaponOptic(p, m.id, m.extra);
    else if (m.kind === 'equipWeaponOptic') r = equipWeaponOptic(p, m.id, m.extra);
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
    if (!this.isHost || !this._validSummary(run) || this._creditedResultId === run.id) return false;
    this._creditedResultId = run.id;
    let changed = false;
    if (this.profile.lastRunId !== run.id) { creditRun(this.profile, run); this.profile.coopLastRunId = run.id; changed = true; }
    const w = this.peerWallet;
    if (w && w.lastRunId !== run.id) {
      const cash = natural(run.cash); w.cash = natural(w.cash + cash); w.totalCash = natural(w.totalCash + cash); w.lastRunId = run.id; changed = true;
    }
    if (run.levelCleared === true && creditCampaignLevel(this.profile, {
      runId: run.id, level: this.activeRunJourney.level, mode: this.activeRunJourney.mode, won: run.won === true,
    })) {
      selectCampaignLevel(this.profile, Math.min(10, this.activeRunJourney.level + 1), 'campaign');
      changed = true;
    }
    if (changed) { saveProfile(this.personalProfile); this.wallet = walletOf(this.personalProfile); this.broadcastProfile(); this.h.profile && this.h.profile(this.profile); }
    return changed;
  }
  hasCreditedResult(id) { return !!id && this.wallet?.lastRunId === id; }

  _validSummary(summary) {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary) || summary.id !== this.activeRunId || !this.activeRunId) return false;
    const context = this.activeRunJourney;
    // Compare strict schema with the run pin, not the current selection: a
    // successful result may already have selected the next unlocked chapter.
    if (!sameJourney(parseJourney(summary.journey), context)) return false;
    if (context.mode !== 'legacy' && (typeof summary.levelCleared !== 'boolean' || typeof summary.won !== 'boolean')) return false;
    if (summary.won !== undefined && typeof summary.won !== 'boolean') return false;
    if (summary.levelCleared !== undefined && typeof summary.levelCleared !== 'boolean') return false;
    if (summary.levelCleared === true && (context.mode !== 'campaign' || summary.won !== true)) return false;
    const integers = ['cash', 'kills', 'crashKills'];
    const continuous = ['distance', 'furthestS', 'time'];
    for (const field of [...integers, ...continuous]) {
      const value = summary[field], required = context.mode !== 'legacy' && field !== 'crashKills';
      if (value === undefined && !required) continue;
      if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || (integers.includes(field) && !Number.isSafeInteger(value))) return false;
    }
    return true;
  }

  _receiveProfile(value, remoteWallet) {
    const wallet = readWallet(remoteWallet);
    if (!wallet || wallet.playerId !== this.personalProfile.campaignId) return false;
    let profile;
    try { profile = normalizeProfile(value); }
    catch (error) { if (error?.code === 'unsupported-profile') return false; throw error; }
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

  sendJSON(m, unreliableOK) {
    if (RUN_JSON_TYPES.has(m?.t)) {
      if (!this.activeRunId) return false;
      const life = this.activeRunId, message = { ...m, runId: life };
      if (m.t === 'events') {
        const plan = planEventPackets(message);
        if (!plan.ok) {
          const error = new Error(`Could not send gameplay events: ${plan.reason}${plan.index === null ? '' : ` at event ${plan.index}`}.`);
          error.type = 'event-packet-rejected'; error.reason = plan.reason; error.index = plan.index;
          this.h.error && this.h.error(error); return false;
        }
        // Keep every ordered gameplay event. No retry queue, state-channel
        // dropping or life-crossing dispatch after a connection callback.
        for (const packet of plan.packets) {
          if (this.activeRunId !== life || this.tp.send(packet) !== true) return false;
        }
        return true;
      }
      return this.tp.send(message);
    }
    return this.tp.send(m);
  }
  /** Only supersedable actor poses may use the dropping reliable-state path. */
  sendTransientJSON(m) {
    if (!this.activeRunId || m?.t !== 'events' || !Array.isArray(m.e) || m.e.length !== 1 || m.e[0]?.t !== 'stageState') return false;
    return this.tp.sendTransientJSON?.({ ...m, runId: this.activeRunId }) === true;
  }
  sendFast(b) {
    const packet = encodeRunPacket(this._fastHeader, b);
    return packet ? this.tp.sendFast(packet) : false;
  }

  _onMsg(m) {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (m.t !== 'hello' && this._peerProtocol !== NET_PROTOCOL) return;
    if (RUN_JSON_TYPES.has(m.t) && (!this.activeRunId || m.runId !== this.activeRunId)) return;
    if (this.swap.onMessage(m)) return;
    switch (m.t) {
      case 'hello':
        if (m.protocol !== NET_PROTOCOL || m.garageSeats !== GARAGE_SEAT_PROTOCOL || m.familyVehicles !== PLAYER_VEHICLE_PROTOCOL || m.eliteVehicles !== ELITE_VEHICLE_PROTOCOL || m.drivingRoutes !== DRIVING_ROUTE_VERSION || m.campaignProtocol !== CAMPAIGN_PROTOCOL) {
          this._peerProtocol = null; this.connected = false; this.activeRunId = null;
          this.other = null; this.peerWallet = null; this.me.ready = false;
          this._protocolError = { type: 'protocol-mismatch', message: 'Your game versions differ. Both players should reload ride.maxyaport.com.' };
          this.h.error && this.h.error(this._protocolError);
          this.tp.closeConnection?.();
          this.h.lobby && this.h.lobby(this.lobby());
          return;
        }
        this._peerProtocol = NET_PROTOCOL; this._protocolError = null;
        this.other = { name: m.name || 'Player', role: this.other?.role ?? null, ready: false };
        if (this.isHost) {
          // Establish once from the connected person's save, never from a buy
          // message or a repeated hello after spending has begun.
          if (!this.peerWallet) this.peerWallet = readWallet(m.wallet);
          this._broadcastLobby();
        }
        break;
      case 'lobby': if (!this.activeRunId && this.swap.localPhase === 'lobby' && !this.isHost && m.host) { this.other = { ...m.host }; if (m.guest) this.me = { ...this.me, role: m.guest.role, ready: !!m.guest.ready }; this.h.lobby && this.h.lobby(this.lobby()); } break;
      case 'role': if (!this.activeRunId && this.swap.localPhase === 'lobby' && this.isHost && this.other && ROLES.has(m.role)) { this.other.role = m.role; this.me.ready = this.other.ready = false; this._broadcastLobby(); } break;
      case 'ready': if (!this.activeRunId && this.swap.localPhase === 'lobby' && this.isHost && this.other) { this.other.ready = !!m.ready && ROLES.has(this.other.role); this._broadcastLobby(); } break;
      case 'start': {
        const journey = m.cfg && readJourney(m.cfg.journey, m.cfg.profile);
        if (!this.isHost && journey && runId(m.cfg.runId) && Number.isSafeInteger(m.cfg.runSeq) && m.cfg.runSeq > this._receivedRunSeq && !this._startedRunIds.has(m.cfg.runId) && ROLES.has(m.cfg.roles?.guest) && ROLES.has(m.cfg.roles?.host) && m.cfg.roles.guest !== m.cfg.roles.host && this._receiveProfile(m.cfg.profile, m.wallet)) {
          this._receivedRunSeq = m.cfg.runSeq; this._startedRunIds.add(m.cfg.runId); this.activeRunId = m.cfg.runId; this._activeRunJourney = journey; this._activeRunRoles = Object.freeze({ ...m.cfg.roles });
          this.swap.leaveGarage('run'); const role = m.cfg.roles.guest; this.me.ready = false;
          this.h.start && this.h.start({ ...m.cfg, journey, profile: this.profile, role });
        }
        break;
      }
      case 'profile': if (!this.isHost && m.p && this._receiveProfile(m.p, m.wallet)) this.h.profile && this.h.profile(this.profile); break;
      case 'buy': if (this.isHost) { const r = this._applyBuy(m, true); if (!r.ok) this.tp.send({ t: 'buyDenied', reason: r.reason, kind: m.kind, id: m.id }); } break;
      case 'buyDenied': this.h.buyDenied && this.h.buyDenied(m); break;
      case 'runOver': this.h.runOver && this.h.runOver(m); break;
      case 'results': this.h.results && this.h.results(m); break;
      case 'summary':
        // One bounded terminal receipt per life. An altered same-id duplicate
        // must not replace the authoritative cause, payout or clear on screen.
        if (this.activeRunRoles?.[this.isHost ? 'guest' : 'host'] === 'driver' && this._validSummary(m.s)
          && this._receivedSummaryId !== this.activeRunId && this._creditedResultId !== this.activeRunId) {
          this._receivedSummaryId = this.activeRunId; this.h.run && this.h.run(m);
        }
        break;
      default: this.h.run && this.h.run(m);
    }
  }
}

// Host-authoritative garage consent. Role equipment and personal wallets stay untouched.
// Shared campaign/profile and personal wallets are deliberately never touched.
// Separate garage compatibility from the unchanged protocol-3 run envelopes.
export const GARAGE_SEAT_PROTOCOL = 1;
const PHASES = new Set(['lobby', 'garage', 'run', 'results', 'disconnected']);
const ROLES = new Set(['driver', 'gunner']);
const IDENT = /^[a-zA-Z0-9_-]{1,128}$/;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const copy = value => structuredClone(value);

export class GarageSeatSwap {
  constructor(session, { onState = () => {}, onSwap = () => {}, makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` } = {}) {
    this.session = session; this.onState = onState; this.onSwap = onSwap; this.makeId = makeId;
    this.localPhase = 'lobby'; this._lastSequence = -1; this._readySeq = 0; this._presenceSeq = 0;
    this.state = { phase: 'lobby', epoch: 0, revision: 0, sequence: 0,
      roles: { host: null, guest: null }, ready: { host: false, guest: false },
      presence: { host: false, guest: false }, presenceSequence: { host: 0, guest: 0 }, readySequence: { host: 0, guest: 0 }, intent: 0, pending: null };
  }
  get actor() { return this.session.isHost ? 'host' : 'guest'; }
  snapshot() { return copy(this.state); }
  _context() { return { phase: 'garage', epoch: this.state.epoch, revision: this.state.revision }; }
  _connected() { return !!(this.session.connected && this.session.other); }
  _validRoles() {
    const { host, guest } = this.state.roles;
    const s = this.session;
    return ROLES.has(host) && ROLES.has(guest) && host !== guest
      && (s.isHost ? s.me.role === host && s.other?.role === guest : s.me.role === guest && s.other?.role === host);
  }
  _garage() { return this.localPhase === 'garage' && this.state.phase === 'garage' && !this.session.activeRunId && this._connected() && this._validRoles(); }
  canRequest() { return this._garage() && this.state.presence.host && this.state.presence.guest && !this.state.pending; }
  canStart() { return this.canRequest() && this.state.ready.host && this.state.ready.guest; }

  enterGarage() {
    this.localPhase = 'garage';
    if (this.session.isHost) {
      this.state.phase = 'garage'; this.state.epoch++; this.state.revision++;
      this.state.roles = { host: this.session.me.role, guest: this.session.other?.role ?? null };
      this.state.readySequence = { host: 0, guest: 0 };
      this.state.presenceSequence = { host: 0, guest: 0 };
      this.state.presence = { host: true, guest: false }; this.state.pending = null; this._clearReady(); this._publish('entered');
    } else this._announcePresence();
  }
  leaveGarage(phase) {
    if (!PHASES.has(phase) || phase === 'garage') throw new Error('Invalid next phase');
    this.localPhase = phase;
    if (this.session.isHost) {
      this.state.phase = phase; this.state.revision++; this.state.pending = null;
      this.state.presence = { host: false, guest: false }; this._clearReady(); this._publish('closed');
    } else if (this._connected()) this.session.tp.send({ t: 'seatSwapPresence', ...this._context(), inGarage: false, commandSequence: ++this._presenceSeq });
  }
  disconnect() {
    this.localPhase = 'disconnected'; this.state.phase = 'disconnected'; this.state.revision++;
    this.state.pending = null; this.state.presence = { host: false, guest: false }; this._clearReady();
    this.onState(this.snapshot(), { type: 'disconnected' });
  }
  _announcePresence() {
    if (this.localPhase === 'garage' && this.state.phase === 'garage' && this._connected()) this.session.tp.send({ t: 'seatSwapPresence', ...this._context(), inGarage: true, commandSequence: ++this._presenceSeq });
  }
  _matches(message) { return message.phase === 'garage' && message.epoch === this.state.epoch && message.revision === this.state.revision; }
  _clearReady() {
    this.state.intent++;
    this.state.ready.host = this.state.ready.guest = false;
    this.session.me.ready = false; if (this.session.other) this.session.other.ready = false;
  }
  _publish(type, actor) {
    this.state.sequence++;
    this.session.tp.send({ t: 'seatSwapState', state: this.snapshot(), event: { type, actor } });
    this.onState(this.snapshot(), { type, actor });
  }
  request() {
    if (!this.canRequest()) return { ok: false, reason: 'unavailable' };
    const message = { t: 'seatSwapRequest', ...this._context(), requestId: this.makeId() };
    if (this.session.isHost) return this._request(message, 'host');
    this.session.tp.send(message); return { ok: true, pending: true };
  }
  _request(message, actor) {
    if (!this.canRequest() || !this._matches(message) || !IDENT.test(message.requestId || '')) return { ok: false, reason: 'stale' };
    this.state.revision++; this._clearReady();
    this.state.pending = { id: this.makeId(), by: actor, epoch: this.state.epoch, revision: this.state.revision, roles: copy(this.state.roles) };
    this._publish('proposed', actor); return { ok: true, id: this.state.pending.id };
  }
  respond(id, accept) {
    if (!this._garage() || this.state.pending?.id !== id || this.state.pending.by === this.actor || typeof accept !== 'boolean') return { ok: false, reason: 'stale' };
    const message = { t: 'seatSwapResponse', ...this._context(), id, accept };
    if (this.session.isHost) return this._respond(message, 'host');
    this.session.tp.send(message); return { ok: true, pending: true };
  }
  _respond(message, actor) {
    const pending = this.state.pending;
    if (!this._garage() || !this._matches(message) || !pending || pending.id !== message.id || pending.by === actor || typeof message.accept !== 'boolean'
      || pending.roles.host !== this.state.roles.host || pending.roles.guest !== this.state.roles.guest) return { ok: false, reason: 'stale' };
    if (message.accept) {
      // Commit complementary roles together. Session.setRole twice would clear
      // the second seat through the old lobby clash resolver.
      const roles = { host: this.state.roles.guest, guest: this.state.roles.host };
      this.state.roles = roles; this.session.me.role = roles.host; this.session.other.role = roles.guest;
    }
    this.state.pending = null; this.state.revision++; this._clearReady(); this._publish(message.accept ? 'accepted' : 'declined', actor);
    if (message.accept) this.onSwap(this.snapshot());
    return { ok: true, swapped: message.accept };
  }
  cancel(id) {
    if (!this._garage() || this.state.pending?.id !== id || this.state.pending.by !== this.actor) return { ok: false, reason: 'stale' };
    const message = { t: 'seatSwapCancel', ...this._context(), id };
    if (this.session.isHost) return this._cancel(message, 'host');
    this.session.tp.send(message); return { ok: true, pending: true };
  }
  _cancel(message, actor) {
    if (!this._garage() || !this._matches(message) || this.state.pending?.id !== message.id || this.state.pending.by !== actor) return { ok: false, reason: 'stale' };
    this.state.pending = null; this.state.revision++; this._clearReady(); this._publish('cancelled', actor); return { ok: true };
  }
  ready(value) {
    if (!this.canRequest() || typeof value !== 'boolean') return false;
    const message = { t: 'seatSwapReady', ...this._context(), ready: value, commandSequence: ++this._readySeq };
    if (this.session.isHost) return this._ready(message, 'host');
    this.session.tp.send(message); return true;
  }
  _ready(message, actor) {
    if (!this.canRequest() || !this._matches(message) || typeof message.ready !== 'boolean' || !integer(message.commandSequence) || message.commandSequence <= this.state.readySequence[actor]) return false;
    this.state.readySequence[actor] = message.commandSequence;
    if (!message.ready) this.state.intent++;
    this.state.ready[actor] = message.ready;
    this.session.me.ready = this.state.ready.host; this.session.other.ready = this.state.ready.guest;
    // Readiness does not change the seat revision, so two contemporaneous ready
    // clicks can both succeed. Sequence still orders authoritative snapshots.
    this._publish('ready', actor); return true;
  }
  onMessage(message) {
    if (!message || typeof message.t !== 'string') return false;
    // Session also gates legacy lobby/readiness
    // commands, so they cannot bypass garage consent after the screen changes.
    if (this.localPhase !== 'lobby' && ['lobby', 'role', 'ready', 'garageReady'].includes(message.t)) return true;
    if (!message.t.startsWith('seatSwap')) return false;
    if (this.session.isHost) {
      if (message.t === 'seatSwapRequest') this._request(message, 'guest');
      else if (message.t === 'seatSwapResponse') this._respond(message, 'guest');
      else if (message.t === 'seatSwapCancel') this._cancel(message, 'guest');
      else if (message.t === 'seatSwapReady') this._ready(message, 'guest');
      else if (message.t === 'seatSwapPresence' && this._garage() && message.phase === 'garage' && message.epoch === this.state.epoch
        && integer(message.commandSequence) && message.commandSequence > this.state.presenceSequence.guest && typeof message.inGarage === 'boolean') {
        // Leaving this garage invalidates pending consent even if a proposal
        // advanced the seat revision before the other person's UI received it.
        this.state.presenceSequence.guest = message.commandSequence;
        this.state.presence.guest = message.inGarage;
        if (!message.inGarage) { this.state.pending = null; this.state.revision++; this._clearReady(); }
        this._publish('presence', 'guest');
      }
    } else if (message.t === 'seatSwapState') this._receive(message);
    return true;
  }
  _receive(message) {
    if (!this._connected() || this.localPhase === 'disconnected') return false;
    const st = message.state;
    if (!st || !PHASES.has(st.phase) || !integer(st.epoch) || !integer(st.revision) || !integer(st.sequence) || !integer(st.intent)
      || !integer(st.readySequence?.host) || !integer(st.readySequence?.guest) || st.sequence <= this._lastSequence
      || !integer(st.presenceSequence?.host) || !integer(st.presenceSequence?.guest)
      || !ROLES.has(st.roles?.host) || !ROLES.has(st.roles?.guest) || st.roles.host === st.roles.guest
      || typeof st.ready?.host !== 'boolean' || typeof st.ready?.guest !== 'boolean'
      || typeof st.presence?.host !== 'boolean' || typeof st.presence?.guest !== 'boolean'
      || (st.pending && (!IDENT.test(st.pending.id || '') || !['host', 'guest'].includes(st.pending.by) || st.pending.epoch !== st.epoch || st.pending.revision !== st.revision))) return false;
    const oldPhase = this.state.phase, oldEpoch = this.state.epoch;
    this._lastSequence = st.sequence; this.state = copy(st);
    this.session.me.role = st.roles.guest; if (this.session.other) this.session.other.role = st.roles.host;
    this.session.me.ready = st.ready.guest; if (this.session.other) this.session.other.ready = st.ready.host;
    this.onState(this.snapshot(), copy(message.event || {}));
    if (message.event?.type === 'accepted') this.onSwap(this.snapshot());
    if (st.phase === 'garage' && (oldPhase !== 'garage' || oldEpoch !== st.epoch)) this._announcePresence();
    return true;
  }
}


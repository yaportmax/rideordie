// WebRTC transport: PeerJS signalling, reliable messages, and an unordered channel for snapshots.
import { Peer } from 'peerjs';
import { getIceConfig } from './ice.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode(n = 5) { let s = ''; for (let i = 0; i < n; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0]; return s; }
const idFor = (code) => 'rod-' + code.toLowerCase().replace(/[^a-z0-9]/g, '');
const FAST_ID = 7;
const MAX_BUFFER = 262144;

export class Transport {
  constructor({ peerOptions = {}, PeerClass = Peer, iceProvider = PeerClass === Peer ? getIceConfig : null, timeout = 15000, reconnectDelays = [500, 1500, 3000], reconnectTimeout = 5000 } = {}) {
    this.PeerClass = PeerClass; this.peerOptions = peerOptions; this.timeout = timeout;
    this.iceProvider = iceProvider; this._peerRequest = null;
    this.reconnectDelays = reconnectDelays; this.reconnectTimeout = reconnectTimeout;
    this.peer = null; this.conn = null; this.fast = null;
    this.isHost = false; this.code = ''; this.open = false;
    this.onMessage = () => {}; this.onFast = () => {}; this.onOpen = () => {}; this.onClose = () => {}; this.onError = () => {}; this.onState = () => {};
    this.rtt = 0; this.stats = { bytesIn: 0, bytesOut: 0, msgIn: 0, fastIn: 0, fastOut: 0 };
    this._pingT = null; this._cancelPending = null; this._pcCleanup = null;
    this._seatT = null; this._reconnectT = null; this._reconnectDeadline = null; this._reconnectPeer = null; this._reconnectAttempt = 0;
    this._signallingState = 'closed'; this._lastState = '';
  }

  get signallingState() { return this._signallingState; }
  get status() {
    if (this.open) return 'connected';
    if (this._signallingState === 'reconnecting' || this._signallingState === 'lost') return this._signallingState;
    if (this.conn || this._signallingState === 'connecting') return 'connecting';
    return this._signallingState === 'ready' ? 'waiting' : 'closed';
  }
  _emitState() {
    const key = this.status + ':' + this._signallingState;
    if (this._lastState === key) return;
    this._lastState = key;
    this.onState(this.status, { signalling: this._signallingState, connected: this.open, code: this.code });
  }
  _setSignalling(state) { this._signallingState = state; this._emitState(); }

  _preparePeer(request, id, cachedConfig, ready, fail) {
    const current = () => this._peerRequest === request;
    const create = (config) => {
      if (!current()) return;
      try {
        const options = { debug: 1, ...this.peerOptions };
        if (config !== undefined && this.peerOptions.config === undefined) options.config = config;
        const peer = this.peer = new this.PeerClass(id, options);
        this._watchPeer(peer); ready(peer, config);
      } catch (err) { if (current()) fail(err); }
    };
    // Explicit ICE options and injected peers retain their synchronous setup path.
    if (this.peerOptions.config !== undefined || !this.iceProvider) { create(undefined); return; }
    if (cachedConfig !== undefined) { create(cachedConfig); return; }
    Promise.resolve().then(() => {
      if (!current()) return;
      return this.iceProvider();
    }).then((config) => {
      if (!current()) return;
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Could not load multiplayer connection settings. Try again.');
      create(config);
    }).catch((err) => { if (current()) fail(err); });
  }

  _watchPeer(peer) {
    let opened = false;
    this._setSignalling('connecting');
    peer.on('open', () => {
      if (this.peer !== peer || peer.destroyed || peer.disconnected) return;
      opened = true; this._stopRecovery(); this._setSignalling('ready');
    });
    peer.on('disconnected', () => {
      if (this.peer !== peer || !opened || this._signallingState === 'lost') return;
      if (this._reconnectPeer !== peer) { this._reconnectPeer = peer; this._reconnectAttempt = 0; this._setSignalling('reconnecting'); }
      this._scheduleReconnect(peer);
    });
    peer.on('close', () => {
      if (this.peer !== peer) return;
      const err = new Error('The room service connection closed. Create or join a room again.');
      this._stopRecovery(); this.peer = null; this._setSignalling('lost');
      this._cancelPending?.(err); this.closeConnection(err); this.onError(err);
    });
  }

  _stopRecovery() {
    clearTimeout(this._reconnectT); clearTimeout(this._reconnectDeadline);
    this._reconnectT = null; this._reconnectDeadline = null; this._reconnectPeer = null; this._reconnectAttempt = 0;
  }
  _scheduleReconnect(peer) {
    if (this.peer !== peer || this._reconnectPeer !== peer) return;
    clearTimeout(this._reconnectDeadline); this._reconnectDeadline = null;
    if (this._reconnectT !== null) return;
    if (peer.destroyed || this._reconnectAttempt >= this.reconnectDelays.length) {
      this._stopRecovery(); this._setSignalling('lost');
      this.onError(new Error('Could not reconnect to the room service. Create or join a room again.'));
      return;
    }
    const delay = this.reconnectDelays[this._reconnectAttempt];
    this._reconnectT = setTimeout(() => {
      this._reconnectT = null;
      if (this.peer !== peer || this._reconnectPeer !== peer) return;
      this._reconnectAttempt++;
      this._reconnectDeadline = setTimeout(() => {
        if (this.peer !== peer || this._reconnectPeer !== peer) return;
        this._reconnectDeadline = null;
        // A stalled socket must be disconnected before PeerJS can retry the same ID.
        try { if (!peer.disconnected && !peer.destroyed) peer.disconnect(); } catch { /* retry below */ }
        this._scheduleReconnect(peer);
      }, this.reconnectTimeout);
      try { peer.reconnect(); } catch (err) { this.onError(err); this._scheduleReconnect(peer); }
    }, delay);
  }

  host(code = makeCode(), attempt = 0, cachedConfig = undefined) {
    this.destroy(); this.isHost = true; this.code = code;
    return new Promise((res, rej) => {
      let settled = false;
      const request = this._peerRequest = {};
      const finish = (err) => {
        if (settled) return; settled = true; clearTimeout(timer); this._cancelPending = null;
        if (err) rej(err); else res(code);
      };
      const fail = (err) => { finish(err); this.destroy(); this.onError(err); };
      const timer = setTimeout(() => fail(new Error('Timed out creating a room. Try again.')), this.timeout);
      this._cancelPending = finish;
      this._setSignalling('connecting');
      this._preparePeer(request, idFor(code), cachedConfig, (peer, config) => {
        peer.on('open', () => { if (this.peer === peer) finish(); });
        peer.on('error', (e) => {
          if (this.peer !== peer) return;
          if (!settled && e.type === 'unavailable-id' && attempt < 4) {
            settled = true; clearTimeout(timer); this._cancelPending = null;
            this.host(makeCode(), attempt + 1, config).then(res, rej);
          } else if (!settled) fail(e); else this.onError(e);
        });
        peer.on('connection', (conn) => {
          if (this.peer !== peer || this.conn) { conn.close(); return; }
          // Reserve the second seat while its connection opens, too.
          this._adopt(conn);
        });
      }, fail);
    });
  }

  join(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,12}$/.test(code)) return Promise.reject(new Error('Enter a valid room code.'));
    this.destroy(); this.isHost = false; this.code = code;
    return new Promise((res, rej) => {
      let settled = false;
      const request = this._peerRequest = {};
      const finish = (err) => {
        if (settled) return; settled = true; clearTimeout(timer); this._cancelPending = null;
        if (err) rej(err); else res();
      };
      const fail = (err) => { finish(err); this.destroy(); this.onError(err); };
      const timer = setTimeout(() => fail(new Error('Timed out connecting to room ' + code)), this.timeout);
      this._cancelPending = finish;
      this._setSignalling('connecting');
      this._preparePeer(request, undefined, undefined, (peer) => {
        let adopted = false;
        peer.on('open', () => {
          if (this.peer !== peer || adopted || peer.destroyed || peer.disconnected) return;
          // Signalling can reopen while the original P2P connection is still healthy.
          adopted = true;
          let conn;
          try {
            conn = peer.connect(idFor(code), { reliable: true, serialization: 'json' });
            if (!conn) throw new Error('Could not open a connection to the room. Try joining again.');
          } catch (err) { fail(err); return; }
          this._adopt(conn);
          if (conn.open) finish(); else conn.on('open', () => { if (this.conn === conn) finish(); });
        });
        peer.on('error', (e) => {
          if (this.peer !== peer) return;
          const err = e.type === 'peer-unavailable' ? new Error('No room with code ' + code) : e;
          if (!settled) fail(err); else this.onError(err);
        });
      }, fail);
    });
  }

  _adopt(conn) {
    this.conn = conn;
    const ready = () => {
      if (this.conn !== conn || this.open) return;
      clearTimeout(this._seatT); this._seatT = null;
      this._watchConnectionState(conn);
      if (this.conn !== conn) return;
      this.open = true; this._openFast(conn); this._startPing(); this.onOpen();
      this._emitState();
    };
    conn.on('data', (d) => {
      if (this.conn !== conn) return;
      this.stats.msgIn++;
      if (d && d.__ping !== undefined) {
        if (d.reply) { const rtt = Math.max(0, performance.now() - d.__ping); this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt; }
        else if (conn.open) conn.send({ __ping: d.__ping, reply: 1 });
        return;
      }
      if (d && Array.isArray(d.__fast)) {
        if (d.__fast.length > MAX_BUFFER || !d.__fast.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) return;
        const buf = Uint8Array.from(d.__fast).buffer;
        this.stats.fastIn++; this.stats.bytesIn += buf.byteLength; this.onFast(buf);
        return;
      }
      this.onMessage(d);
    });
    conn.on('close', () => { if (this.conn === conn) this.closeConnection(); });
    conn.on('error', (e) => {
      if (this.conn !== conn) return;
      // PeerJS closes failed pre-open negotiations without emitting a close event.
      if (!this.open) this.closeConnection(e);
      this.onError(e);
    });
    this._watchConnectionState(conn);
    if (this.conn !== conn) return;
    if (conn.open) ready(); else {
      conn.on('open', ready);
      this._seatT = setTimeout(() => {
        if (this.conn !== conn) return;
        const err = new Error('Timed out connecting the second seat. Your partner can try again.');
        this.closeConnection(err); this.onError(err);
      }, this.timeout);
      this._emitState();
    }
  }

  _watchConnectionState(conn) {
    const pc = conn.peerConnection;
    if (!pc?.addEventListener || this._pcCleanup?.pc === pc) return;
    this._pcCleanup?.();
    const changed = () => {
      if (this.conn !== conn) return;
      // Aggregate DTLS/data-channel failure can be terminal while ICE still
      // reports disconnected. PeerJS only watches ICE, so its close may never
      // arrive. A transient disconnected state remains eligible to recover.
      if (!['failed', 'closed'].includes(pc.connectionState) && !['failed', 'closed'].includes(pc.iceConnectionState)) return;
      this.closeConnection(new Error('The multiplayer connection closed.'));
    };
    pc.addEventListener('connectionstatechange', changed);
    pc.addEventListener('iceconnectionstatechange', changed);
    const cleanup = () => {
      pc.removeEventListener('connectionstatechange', changed);
      pc.removeEventListener('iceconnectionstatechange', changed);
      if (this._pcCleanup === cleanup) this._pcCleanup = null;
    };
    cleanup.pc = pc; this._pcCleanup = cleanup;
    changed();
  }
  /** Release a failed or rejected player without destroying the host's room. */
  closeConnection(error = null) {
    const conn = this.conn; if (!conn) return;
    const wasOpen = this.open; this._pcCleanup?.();
    this.open = false; this.conn = null;
    clearTimeout(this._seatT); this._seatT = null;
    clearInterval(this._pingT); this._pingT = null;
    const dc = this.fast; this.fast = null;
    this._cancelPending?.(error || new Error('The room closed before connecting.'));
    try { dc?.close(); } catch { /* already closed */ }
    try { conn.close(); } catch { /* already closed */ }
    if (!wasOpen && !this.isHost) this.destroy();
    if (wasOpen) this.onClose();
    this._emitState();
  }

  _openFast(conn) {
    try {
      const dc = conn.peerConnection.createDataChannel('fast', { ordered: false, maxRetransmits: 0, negotiated: true, id: FAST_ID });
      dc.binaryType = 'arraybuffer';
      dc.onmessage = (e) => {
        if (this.conn !== conn || this.fast !== dc || !(e.data instanceof ArrayBuffer)) return;
        this.stats.fastIn++; this.stats.bytesIn += e.data.byteLength; this.onFast(e.data);
      };
      this.fast = dc;
    } catch { this.fast = null; }
  }

  _startPing() {
    clearInterval(this._pingT);
    this._pingT = setInterval(() => this.send({ __ping: performance.now() }), 1500);
  }

  send(obj) {
    if (!this.conn?.open) return false;
    try { this.conn.send(obj); return true; } catch (e) { this.onError(e); return false; }
  }
  /** Use reliable delivery during negotiation or after the fast channel fails. Never queue stale snapshots. */
  sendFast(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : null;
    if (!bytes) return false;
    try {
      if (this.fast?.readyState === 'open') {
        if (this.fast.bufferedAmount > MAX_BUFFER) return false;
        this.fast.send(bytes); this.stats.fastOut++; this.stats.bytesOut += bytes.byteLength; return true;
      }
      if (this.conn?.open && (this.conn.bufferSize || 0) < 32 && this.send({ __fast: Array.from(bytes) })) {
        this.stats.fastOut++; this.stats.bytesOut += bytes.byteLength; return true;
      }
    } catch (e) { this.onError(e); }
    return false;
  }
  get ready() { return this.open; }

  destroy() {
    this._pcCleanup?.();
    this._stopRecovery(); clearTimeout(this._seatT); this._seatT = null;
    clearInterval(this._pingT); this._pingT = null;
    const cancel = this._cancelPending; this._cancelPending = null;
    const conn = this.conn, peer = this.peer, dc = this.fast;
    // Invalidate callbacks before close() emits anything.
    this.open = false; this.conn = null; this.peer = null; this.fast = null; this._peerRequest = null;
    cancel?.(new Error('Connection cancelled.'));
    try { dc?.close(); } catch { /* already closed */ }
    try { conn?.close(); } catch { /* already closed */ }
    try { peer?.destroy(); } catch { /* already closed */ }
    this._setSignalling('closed');
  }
}

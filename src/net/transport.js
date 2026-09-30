// WebRTC transport: PeerJS signalling, reliable messages, and an unordered channel for snapshots.
import { Peer } from 'peerjs';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode(n = 5) { let s = ''; for (let i = 0; i < n; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0]; return s; }
const idFor = (code) => 'rod-' + code.toLowerCase().replace(/[^a-z0-9]/g, '');
const FAST_ID = 7;
const MAX_BUFFER = 262144;

export class Transport {
  constructor({ peerOptions = {}, PeerClass = Peer, timeout = 15000 } = {}) {
    this.PeerClass = PeerClass; this.peerOptions = peerOptions; this.timeout = timeout;
    this.peer = null; this.conn = null; this.fast = null;
    this.isHost = false; this.code = ''; this.open = false;
    this.onMessage = () => {}; this.onFast = () => {}; this.onOpen = () => {}; this.onClose = () => {}; this.onError = () => {};
    this.rtt = 0; this.stats = { bytesIn: 0, bytesOut: 0, msgIn: 0, fastIn: 0, fastOut: 0 };
    this._pingT = null; this._cancelPending = null;
  }

  host(code = makeCode(), attempt = 0) {
    this.destroy(); this.isHost = true; this.code = code;
    return new Promise((res, rej) => {
      let settled = false;
      const peer = this.peer = new this.PeerClass(idFor(code), { debug: 1, ...this.peerOptions });
      const finish = (err) => {
        if (settled) return; settled = true; clearTimeout(timer); this._cancelPending = null;
        if (err) rej(err); else res(code);
      };
      const fail = (err) => { finish(err); this.destroy(); this.onError(err); };
      const timer = setTimeout(() => fail(new Error('Timed out creating a room. Try again.')), this.timeout);
      this._cancelPending = finish;
      peer.on('open', () => { if (this.peer === peer) finish(); });
      peer.on('error', (e) => {
        if (this.peer !== peer) return;
        if (!settled && e.type === 'unavailable-id' && attempt < 4) {
          settled = true; clearTimeout(timer); this._cancelPending = null;
          this.host(makeCode(), attempt + 1).then(res, rej);
        } else if (!settled) fail(e); else this.onError(e);
      });
      peer.on('connection', (conn) => {
        if (this.peer !== peer || this.conn) { conn.close(); return; }
        // Reserve the second seat while its connection opens, too.
        this._adopt(conn);
      });
    });
  }

  join(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,12}$/.test(code)) return Promise.reject(new Error('Enter a valid room code.'));
    this.destroy(); this.isHost = false; this.code = code;
    return new Promise((res, rej) => {
      let settled = false;
      const peer = this.peer = new this.PeerClass(undefined, { debug: 1, ...this.peerOptions });
      const finish = (err) => {
        if (settled) return; settled = true; clearTimeout(timer); this._cancelPending = null;
        if (err) rej(err); else res();
      };
      const fail = (err) => { finish(err); this.destroy(); this.onError(err); };
      const timer = setTimeout(() => fail(new Error('Timed out connecting to room ' + code)), this.timeout);
      this._cancelPending = finish;
      peer.on('open', () => {
        if (this.peer !== peer) return;
        const conn = peer.connect(idFor(code), { reliable: true, serialization: 'json' });
        this._adopt(conn);
        if (conn.open) finish(); else conn.on('open', () => { if (this.conn === conn) finish(); });
        conn.on('error', (e) => { if (this.conn === conn && !settled) fail(e); });
      });
      peer.on('error', (e) => {
        if (this.peer !== peer) return;
        const err = e.type === 'peer-unavailable' ? new Error('No room with code ' + code) : e;
        if (!settled) fail(err); else this.onError(err);
      });
    });
  }

  _adopt(conn) {
    this.conn = conn;
    const ready = () => {
      if (this.conn !== conn || this.open) return;
      this.open = true; this._openFast(conn); this._startPing(); this.onOpen();
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
    conn.on('close', () => {
      if (this.conn !== conn) return;
      const wasOpen = this.open;
      this.open = false; this.conn = null;
      clearInterval(this._pingT); this._pingT = null;
      const dc = this.fast; this.fast = null; try { dc?.close(); } catch { /* already closed */ }
      this._cancelPending?.(new Error('The room closed before connecting.'));
      if (!wasOpen && !this.isHost) this.destroy();
      if (wasOpen) this.onClose();
    });
    conn.on('error', (e) => { if (this.conn === conn) this.onError(e); });
    if (conn.open) ready(); else conn.on('open', ready);
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
    clearInterval(this._pingT); this._pingT = null;
    const cancel = this._cancelPending; this._cancelPending = null;
    const conn = this.conn, peer = this.peer, dc = this.fast;
    // Invalidate callbacks before close() emits anything.
    this.open = false; this.conn = null; this.peer = null; this.fast = null;
    cancel?.(new Error('Connection cancelled.'));
    try { dc?.close(); } catch { /* already closed */ }
    try { conn?.close(); } catch { /* already closed */ }
    try { peer?.destroy(); } catch { /* already closed */ }
  }
}

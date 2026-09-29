// WebRTC transport over PeerJS signalling (public cloud + free TURN fallback built into PeerJS defaults).
// Two channels: reliable ordered (PeerJS DataConnection, JSON) and an extra UNRELIABLE unordered RTCDataChannel (binary) for snapshots / aim.
import { Peer } from 'peerjs';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode(n = 5) { let s = ''; for (let i = 0; i < n; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0]; return s; }
const idFor = (code) => 'rod-' + code.toLowerCase().replace(/[^a-z0-9]/g, '');
const FAST_ID = 7;

export class Transport {
  constructor() {
    this.peer = null; this.conn = null; this.fast = null;
    this.isHost = false; this.code = ''; this.open = false;
    this.onMessage = () => {}; this.onFast = () => {}; this.onOpen = () => {}; this.onClose = () => {}; this.onError = () => {};
    this.rtt = 0; this.stats = { bytesIn: 0, bytesOut: 0, msgIn: 0, fastIn: 0, fastOut: 0 };
    this._pingT = null;
  }

  host(code = makeCode()) {
    this.isHost = true; this.code = code;
    return new Promise((res, rej) => {
      const peer = this.peer = new Peer(idFor(code), { debug: 1 });
      peer.on('open', () => res(code));
      peer.on('error', (e) => { if (e.type === 'unavailable-id') { this.destroy(); this.host(makeCode()).then(res, rej); } else { this.onError(e); if (!this.open) rej(e); } });
      peer.on('connection', (conn) => {
        if (this.conn && this.conn.open) { conn.close(); return; } // only two players
        this._adopt(conn);
      });
    });
  }

  join(code) {
    this.isHost = false; this.code = code.toUpperCase();
    return new Promise((res, rej) => {
      const peer = this.peer = new Peer(undefined, { debug: 1 });
      const timer = setTimeout(() => { rej(new Error('Timed out connecting to room ' + this.code)); this.destroy(); }, 15000);
      peer.on('open', () => {
        const conn = peer.connect(idFor(code), { reliable: true, serialization: 'json' });
        this._adopt(conn);
        conn.on('open', () => { clearTimeout(timer); res(); });
        conn.on('error', (e) => { clearTimeout(timer); rej(e); });
      });
      peer.on('error', (e) => { clearTimeout(timer); this.onError(e); rej(e.type === 'peer-unavailable' ? new Error('No room with code ' + this.code) : e); });
    });
  }

  _adopt(conn) {
    this.conn = conn;
    const ready = () => {
      this.open = true;
      this._openFast(conn);
      this._startPing();
      this.onOpen();
    };
    if (conn.open) ready(); else conn.on('open', ready);
    conn.on('data', (d) => { this.stats.msgIn++; if (d && d.__ping !== undefined) { if (d.reply) this.rtt = this.rtt ? this.rtt * 0.8 + (performance.now() - d.__ping) * 0.2 : performance.now() - d.__ping; else conn.send({ __ping: d.__ping, reply: 1 }); return; } this.onMessage(d); });
    conn.on('close', () => { this.open = false; clearInterval(this._pingT); this.onClose(); });
    conn.on('error', (e) => this.onError(e));
  }

  _openFast(conn) {
    try {
      const pc = conn.peerConnection;
      const dc = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0, negotiated: true, id: FAST_ID });
      dc.binaryType = 'arraybuffer';
      dc.onmessage = (e) => { this.stats.fastIn++; this.stats.bytesIn += e.data.byteLength || 0; this.onFast(e.data); };
      this.fast = dc;
    } catch (e) { console.warn('fast channel unavailable, falling back to reliable', e); this.fast = null; }
  }

  _startPing() { clearInterval(this._pingT); this._pingT = setInterval(() => { if (this.conn?.open) this.conn.send({ __ping: performance.now() }); }, 1500); }

  /** Reliable, ordered. Any JSON-able object. */
  send(obj) { if (this.conn?.open) { this.conn.send(obj); } }
  /** Unreliable, unordered. ArrayBuffer/typed array. Falls back to reliable base64-less path if the fast channel is missing. */
  sendFast(buf) {
    if (this.fast && this.fast.readyState === 'open') { this.stats.fastOut++; this.stats.bytesOut += buf.byteLength; this.fast.send(buf); }
    else if (!this.fast && this.conn?.open) this.conn.send({ __fast: Array.from(new Uint8Array(buf)) });
  }
  get ready() { return this.open && (!this.fast || this.fast.readyState === 'open'); }

  destroy() { clearInterval(this._pingT); try { this.conn?.close(); } catch { /* */ } try { this.peer?.destroy(); } catch { /* */ } this.open = false; this.conn = null; this.peer = null; this.fast = null; }
}

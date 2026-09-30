// Local PeerJS signalling for browser regression tests. WebRTC carries all game traffic.
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

export async function startPeerServer() {
  const peers = new Map();
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url.split('?')[0].endsWith('/id')) { res.end(randomUUID()); return; }
    res.writeHead(404); res.end();
  });
  const frame = (socket, value, opcode = 1) => {
    const payload = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    const len = payload.length;
    const head = Buffer.alloc(len < 126 ? 2 : len < 65536 ? 4 : 10);
    head[0] = 0x80 | opcode;
    if (len < 126) head[1] = len;
    else if (len < 65536) { head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    if (!socket.destroyed) socket.write(Buffer.concat([head, payload]));
  };
  server.on('upgrade', (req, socket, head) => {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    if (!id || !req.headers['sec-websocket-key']) { socket.destroy(); return; }
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    if (peers.has(id)) { frame(socket, { type: 'ID-TAKEN' }); socket.end(); return; }
    peers.set(id, socket); frame(socket, { type: 'OPEN' });
    let buffer = Buffer.alloc(0);
    const receive = (bytes) => {
      buffer = Buffer.concat([buffer, bytes]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15, masked = !!(buffer[1] & 128);
        let len = buffer[1] & 127, at = 2;
        if (len === 126) { if (buffer.length < 4) return; len = buffer.readUInt16BE(2); at = 4; }
        else if (len === 127) { if (buffer.length < 10) return; len = Number(buffer.readBigUInt64BE(2)); at = 10; }
        if (len > 1024 * 1024) { socket.destroy(); return; }
        const mask = masked ? buffer.subarray(at, at + 4) : null;
        if (masked) at += 4;
        if (buffer.length < at + len) return;
        const payload = Buffer.from(buffer.subarray(at, at + len));
        buffer = buffer.subarray(at + len);
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        if (opcode === 8) { socket.end(); return; }
        if (opcode === 9) { frame(socket, payload, 10); continue; }
        if (opcode !== 1) continue;
        let message; try { message = JSON.parse(payload.toString()); } catch { socket.destroy(); return; }
        if (message.type === 'HEARTBEAT') continue;
        const target = peers.get(message.dst);
        if (target) frame(target, { ...message, src: id });
        else if (message.dst) frame(socket, { type: 'EXPIRE', src: message.dst, dst: id });
      }
    };
    socket.on('data', receive);
    socket.on('error', () => {});
    socket.on('close', () => { if (peers.get(id) === socket) peers.delete(id); });
    if (head.length) receive(head);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () => { for (const socket of peers.values()) socket.destroy(); return new Promise((resolve) => server.close(resolve)); },
  };
}

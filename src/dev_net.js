import { Transport } from './net/transport.js';
const q = new URLSearchParams(location.search);
const o = document.getElementById('o');
const log = (s) => { o.textContent += s + '\n'; console.log(s); };
const t = new Transport();
window.__net = t; window.__log = [];
t.onMessage = (m) => { window.__log.push(['rel', m]); };
t.onFast = (b) => { window.__log.push(['fast', b.byteLength]); };
t.onOpen = () => { log('OPEN rtt?'); t.send({ hello: q.get('role') }); const buf = new Uint8Array(100).fill(7); let n = 0; const iv = setInterval(() => { t.sendFast(buf.buffer); if (++n > 30) clearInterval(iv); }, 33); };
t.onClose = () => log('CLOSE');
if (q.get('role') === 'host') { t.host().then((c) => { window.__code = c; log('HOST code ' + c); window.__ready = true; }); }
else { window.__joinReady = true; window.join = (c) => t.join(c).then(() => { log('JOINED'); window.__ready = true; }, (e) => log('JOIN FAIL ' + e.message)); }

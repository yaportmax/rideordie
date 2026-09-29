// dump browser-decoded samples of some files as float32 .bin for comparison with the python decode
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', 'public', 'audio');
const outDir = process.argv[2];
const files = process.argv.slice(3);
const server = http.createServer((req, res) => {
  if (req.url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>x</body></html>'); return; }
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/audio\//, ''));
  if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'audio/ogg' }); fs.createReadStream(p).pipe(res);
}).listen(8798);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:8798/index.html');
for (const f of files) {
  const b64 = await page.evaluate(async (f) => {
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const r = await fetch('http://localhost:8798/' + f);
    const buf = await ctx.decodeAudioData(await r.arrayBuffer());
    const x = buf.getChannelData(0);
    const u8 = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(s);
  }, f);
  fs.writeFileSync(path.join(outDir, f.replace(/\//g, '_') + '.f32'), Buffer.from(b64, 'base64'));
  console.log('dumped', f);
}
await browser.close(); server.close();

// Decode every file in public/audio with the REAL browser decoder (headless Chrome, decodeAudioData) and verify:
// sample rate, exact sample length vs manifest duration (gapless Vorbis), peak <= -1 dBFS, loop wrap step ratio.
//   node tools/audio/browser_check.mjs [groupFilter]
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', 'public', 'audio');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const filter = process.argv[2] || '';

const server = http.createServer((req, res) => {
  if (req.url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>audio check</body></html>'); return; }
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/audio\//, ''));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.ogg') ? 'audio/ogg' : 'text/html', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(p).pipe(res);
}).listen(8799);

const items = [];
for (const [key, d] of Object.entries(manifest.sounds)) {
  if (filter && !key.startsWith(filter)) continue;
  d.files.forEach((f, i) => items.push({ key, file: f, loop: d.loop, dur: d.durations[i], ch: d.channels }));
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto('http://localhost:8799/index.html');
const res = await page.evaluate(async ({ items }) => {
  const out = [];
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  for (const it of items) {
    try {
      const r = await fetch('http://localhost:8799/' + it.file);
      const buf = await ctx.decodeAudioData(await r.arrayBuffer());
      let peak = 0, worst = 0;
      const step95 = [];
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const x = buf.getChannelData(c);
        let d = new Float32Array(x.length - 1);
        for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
        for (let i = 0; i < x.length - 1; i++) d[i] = Math.abs(x[i + 1] - x[i]);
        const sorted = Float32Array.from(d).sort();
        const p = sorted[Math.floor(sorted.length * 0.995)] + 1e-9;
        const wrap = Math.abs(x[0] - x[x.length - 1]);
        worst = Math.max(worst, wrap / p);
      }
      out.push({ file: it.file, loop: it.loop, sr: buf.sampleRate, ch: buf.numberOfChannels, len: buf.length, dur: buf.length / buf.sampleRate,
                 expDur: it.dur, peakDb: 20 * Math.log10(peak + 1e-12), wrap: worst });
    } catch (e) { out.push({ file: it.file, error: String(e) }); }
  }
  return out;
}, { items });
await browser.close();
server.close();
if (process.env.BC_JSON) fs.writeFileSync(process.env.BC_JSON, JSON.stringify(res));

let bad = 0;
for (const r of res) {
  const issues = [];
  if (r.error) issues.push('decode error ' + r.error);
  else {
    if (r.sr !== 44100) issues.push('sr ' + r.sr);
    const dl = Math.round((r.expDur - r.dur) * 44100);
    if (r.loop ? Math.abs(dl) > 3 : (dl < -3 || dl > 130)) issues.push(`length off by ${dl} samples`);
    if (r.peakDb > -1.0) issues.push('peak ' + r.peakDb.toFixed(2));
    if (r.loop && r.wrap > 1.5) issues.push('loop wrap ' + r.wrap.toFixed(2));
  }
  if (issues.length) { bad++; console.log('ISSUE', r.file, issues.join('; ')); }
}
const loops = res.filter(r => r.loop && !r.error);
console.log(`browser-decoded ${res.length} files, ${bad} with issues; ${loops.length} loops, worst wrap ratio ${Math.max(...loops.map(r => r.wrap)).toFixed(2)}`);

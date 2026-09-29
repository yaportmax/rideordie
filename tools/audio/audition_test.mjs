// smoke-test tools/audio/audition.html in headless Chrome (no audio hardware needed)
import { chromium } from 'playwright-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const pub = path.resolve(here, '..', '..', 'public');
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = u === '/audition.html' ? path.join(here, 'audition.html') : path.join(pub, u);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : p.endsWith('.json') ? 'application/json' : 'audio/ogg' }); fs.createReadStream(p).pipe(res);
}).listen(8797);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('response', r => { if (r.status() >= 400) console.log('[http', r.status() + ']', r.url()); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8797/audition.html');
await page.waitForTimeout(1500);
console.log('sounds rendered:', await page.evaluate(() => document.querySelectorAll('.s').length));
await page.click('#engplay'); await page.waitForTimeout(1500);
await page.evaluate(() => { document.getElementById('rpm').value = 4000; document.getElementById('rpm').dispatchEvent(new Event('input')); document.getElementById('spd').value = 120; document.getElementById('spd').dispatchEvent(new Event('input')); });
await page.waitForTimeout(500);
console.log('engine running:', await page.evaluate(() => document.getElementById('engplay').textContent));
if (await page.$('#mplay')) { await page.click('#mplay'); await page.waitForTimeout(1500); console.log('music button:', await page.evaluate(() => document.getElementById('mplay').textContent)); }
fs.mkdirSync(path.join(here, 'sheets'), { recursive: true });
await page.screenshot({ path: path.join(here, 'sheets', 'audition.png') });
await browser.close(); server.close();

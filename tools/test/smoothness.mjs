// Controlled RTX gameplay timing; one live game page at a time.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.GAME_URL || 'http://127.0.0.1:5194';
const secs = Number(process.env.BENCH_SECONDS || 20);
const gpuProfile = process.env.BENCH_GPU_PROFILE === '1';
const spots = (process.env.BENCH_SPOTS || '3000,14000,44000').split(',').map(Number);
const roles = (process.env.BENCH_ROLES || 'driver,gunner').split(',');
const cases = process.env.BENCH_CASES ? process.env.BENCH_CASES.split(',').map(c => { const [role,s] = c.split(':'); return {role,s:Number(s)}; }) : roles.flatMap(role => spots.map(s => ({role,s})));
const out = process.env.BENCH_OUTPUT || 'shots/smoothness';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const results = [];
try {
  for (const {role,s} of cases) {
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
    const errors = [], warnings = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()); });
    await page.goto(`${base}/?solo&as=${role}&s=${s}&seed=7&weapons=smg`);
    await page.waitForFunction(() => window.__ready && window.__run?.started, null, { timeout: 180000 });
    await page.evaluate(profile => {
      window.__autodrive = { speed: 30 }; window.__game.post.profile(profile);
      const g = window.__game, gl = g.renderer.getContext(), seen = new Set(g.renderer.info.programs.map(p=>p.id)), frame = g.frame;
      window.__initialPrograms = g.renderer.info.programs.map(p=>({id:p.id,name:p.name,cacheKey:p.cacheKey}));
      window.__programAdditions = []; window.__resolutionChanges = [];
      g.frame = function(now) {
        frame.call(this,now);
        for (const p of g.renderer.info.programs) if (!seen.has(p.id)) {
          seen.add(p.id); window.__programAdditions.push({at:performance.now(),id:p.id,name:p.name,cacheKey:p.cacheKey,fragment:gl.getShaderSource(p.fragmentShader)});
        }
      };
      const resize = g.post._applyInternalSize;
      g.post._applyInternalSize = function(w,h) {
        const start = performance.now(), old = this._internal.toArray();
        resize.call(this,w,h);
        window.__resolutionChanges.push({at:start,old,next:this._internal.toArray(),cpuMs:performance.now()-start});
      };
    }, gpuProfile);
    await page.waitForTimeout(10000);
    if (role === 'gunner') await page.evaluate(() => {
      window.__forceGunner = { slot: 1, fire: true };
      const gunner = window.__run.gunner, update = gunner.update;
      // Keep aiming down the moving road as a player compensating for recoil
      // would; otherwise unattended automatic fire eventually measures sky.
      gunner.update = function(dt, cmd, cam, carYaw, extra) {
        this.yaw = carYaw; this.pitch = -0.03;
        return update.call(this, dt, cmd, cam, carYaw, extra);
      };
    });
    const result = await page.evaluate(async seconds => {
      const g = window.__game, r = window.__run, p = g.post;
      p.timer?.reset();
      const cacheBefore = { ...g.sky.shadowCache.stats }, shotBefore = r.shots;
      const bossBefore = r.sim?.boss ? { phase: r.sim.boss.phase, dead: r.sim.boss.dead, exploded: r.sim.boss.exploded } : null;
      const f = [], slow = []; let last = performance.now(), start = last;
      await new Promise(resolve => {
        const tick = now => {
          const elapsed = now - last; f.push(elapsed); last = now;
          if (elapsed > 25) slow.push({ at: +(now-start).toFixed(1), ms: +elapsed.toFixed(1), sim: +g.perf.sim.toFixed(2), render: +g.perf.render.toFixed(2), cars: r.states.size });
          if (now-start < seconds*1000 && !r.over) requestAnimationFrame(tick); else resolve();
        }; requestAnimationFrame(tick);
      });
      f.sort((a,b)=>a-b); const q = n => +f[Math.min(f.length-1,Math.floor(f.length*n))].toFixed(2);
      const gl = g.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), p50:q(.5), p95:q(.95), p99:q(.99), max:q(1),
        averageFps: +(f.length*1000/f.reduce((a,b)=>a+b,0)).toFixed(2), activeSeconds:+((last-start)/1000).toFixed(2), frames:f.length, over25:slow.length, over33:f.filter(x=>x>33.4).length,
        scale:p.resolutionScale, internal:p._internal.toArray(), quality:g.quality, gpuProfiling:p._profiling, gpuMs:Object.fromEntries(p.timer?.ms || []),
        cacheEnabled:g.sky.shadowCache.enabled, cacheBefore, cacheAfter:{...g.sky.shadowCache.stats}, calls:g.perf.calls,
        shots:r.shots-shotBefore, cars:r.states.size, over:r.over, playerS:r.playerS, bossBefore, bossAfter:r.sim?.boss ? { phase:r.sim.boss.phase, dead:r.sim.boss.dead, exploded:r.sim.boss.exploded } : null,
        pitch:r.gunner?.pitch, glError:gl.getError(), slow, hitches:window.__hitches || [], initialPrograms:window.__initialPrograms, programs:window.__programAdditions, resizes:window.__resolutionChanges };
    }, secs);
    await page.screenshot({ path:`${out}/${role}-${s}.png` });
    const row = { role, s, ...result, errors, warnings:[...new Set(warnings)] }; results.push(row);
    await writeFile(`${out}/results.json`, JSON.stringify(results,null,2));
    console.log(JSON.stringify({...row,initialPrograms:undefined,programs:row.programs?.map(p=>({at:p.at,id:p.id,name:p.name})),slow:row.slow.slice(0,12)}));
    await page.close();
  }
} finally { await browser.close(); }

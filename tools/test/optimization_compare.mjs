// Paired GPU comparison: same browser, camera, frozen world, and native 1440p.
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--use-angle=d3d11','--force_high_performance_gpu','--disable-background-timer-throttling'] });
try {
  const page = await browser.newPage({ viewport:{width:2560,height:1440} });
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5193'}/?solo&as=gunner&s=14000&seed=7`);
  await page.waitForFunction(() => window.__ready && window.__run?.started, null, {timeout:180000});
  await page.waitForTimeout(10000);
  const result = await page.evaluate(async () => {
    const g=window.__game, p=g.post, shadow=g.sky.sun.shadow;
    window.__run.sim.step=()=>{}; window.__forceGunner={ads:true};
    p.autoResolution=false; p.setResolutionScale(1); p.profile(true);
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const measure=async()=>{
      p.timer.reset(); await wait(2000);
      const frames=[]; let last=performance.now(), start=last;
      await new Promise(resolve=>{ const tick=now=>{frames.push(now-last);last=now;if(now-start<6000)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick); });
      frames.sort((a,b)=>a-b); return {p50:frames[frames.length>>1],p95:frames[Math.floor(frames.length*.95)],gpuMs:Object.fromEntries(p.timer.ms),calls:g.perf.calls};
    };
    const size=n=>{ shadow.mapSize.set(n,n); shadow.map?.dispose();shadow.map=null; };
    p.scenePass.setSamples(4); p._applyAOQuality('Medium'); p.lens.setMotionBlurTaps(10);size(4096);
    const before=await measure();
    p.setQuality(2,true);size(2048);
    const after=await measure();
    return {before,after,sceneGpuReductionPercent:100*(1-after.gpuMs.scene/before.gpuMs.scene)};
  });
  console.log(JSON.stringify(result));
  await writeFile('shots/optimization/paired.json',JSON.stringify(result,null,2));
} finally { await browser.close(); }

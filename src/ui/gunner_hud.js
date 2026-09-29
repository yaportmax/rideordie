// GunnerHud: the first-person shooter layer of the HUD (owned by Hud, only active when the local human is the gunner).
//   crosshair (per weapon: ticks / shotgun ring / launcher chevron; spread-driven gap; turns red over a target; hidden when aiming),
//   hit markers (body = white, head = gold, kill = big red X + ring pulse), kill confirm pop, damage-direction arcs (enemy bullet hits,
//   nearby blasts), ammo counter (low-ammo / empty warnings, reload progress bar), sniper / launcher scope overlay (reticle, soft
//   exit-pupil edge that drifts with the weapon sway, lens glint, scope-in fade).
// Data: Hud.update(dt, d) passes d.gunner (GunnerController), d.events (this frame's events), d.cam (camera), d.playerId, d.scoped,
// d.hideCross, d.spreadPx, d.mag, d.reloading.

import { inCinematic } from '../view/viewmodel.js';

const CSS = `
#ghud{position:absolute;inset:0;pointer-events:none;overflow:hidden}
#ghud .c{position:absolute;left:50%;top:50%;width:0;height:0;transition:opacity .08s}
#ghud .c i{position:absolute;background:#f4f4f0;border-radius:1px;box-shadow:0 0 0 1px rgba(0,0,0,.55),0 0 5px rgba(0,0,0,.35)}
#ghud .c .h{width:10px;height:2px;top:-1px}
#ghud .c .v{width:2px;height:10px;left:-1px}
#ghud .c .d{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%}
#ghud .c .ring{position:absolute;border:2px solid rgba(244,244,240,.9);border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.35),inset 0 0 0 1px rgba(0,0,0,.3);background:none}
#ghud .c .chev{position:absolute;left:-9px;top:6px;width:18px;height:10px;background:none;box-shadow:none;border-left:2px solid #f4f4f0;border-top:2px solid #f4f4f0;transform:rotate(45deg);transform-origin:50% 50%;filter:drop-shadow(0 0 1px #000)}
#ghud .c.on i{background:#ff4b36}
#ghud .c.on .ring{border-color:#ff4b36;background:none}
#ghud .c.on .chev{border-color:#ff4b36;background:none}
#ghud .hm{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0}
#ghud .hm i{position:absolute;left:-1.5px;top:-7px;width:3px;height:14px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.5),0 0 6px rgba(0,0,0,.4);border-radius:1px}
#ghud .hm.k i{background:#ff3524;box-shadow:0 0 0 1px rgba(40,0,0,.6),0 0 10px rgba(255,40,20,.8)}
#ghud .hm.hd i{background:#ffd23a;box-shadow:0 0 0 1px rgba(40,20,0,.6),0 0 8px rgba(255,200,40,.7)}
#ghud .kr{position:absolute;left:50%;top:50%;width:60px;height:60px;margin:-30px 0 0 -30px;border:3px solid rgba(255,60,40,.85);border-radius:50%;opacity:0}
#ghud .kt{position:absolute;left:50%;top:calc(50% + 46px);transform:translateX(-50%);font:800 italic 17px 'Bahnschrift','Segoe UI Semibold',sans-serif;letter-spacing:3px;color:#ff4a30;text-shadow:0 1px 3px #000,0 0 10px rgba(255,40,20,.6);opacity:0;white-space:nowrap}
#ghud .dm{position:absolute;left:50%;top:50%;width:0;height:0}
#ghud .dm div{position:absolute;left:-150px;top:-150px;width:300px;height:300px;border-radius:50%;border:5px solid transparent;border-top-color:rgba(255,34,18,.95);opacity:0;filter:drop-shadow(0 0 5px rgba(255,0,0,.6))}
#ghud .am{position:absolute;right:34px;bottom:26px;text-align:right;font-family:'Bahnschrift','Segoe UI Semibold','Arial Narrow',sans-serif;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.85)}
#ghud .am .wn{display:block;font-size:14px;letter-spacing:3px;opacity:.9}
#ghud .am b{font-size:56px;font-weight:800;font-style:italic;line-height:.95}
#ghud .am small{font-size:21px;opacity:.7;margin-left:3px}
#ghud .am .bar{height:4px;margin-top:4px;background:rgba(0,0,0,.45);transform:skewX(-18deg);overflow:hidden}
#ghud .am .bar i{display:block;height:100%;width:100%;background:#ffc21a;transform-origin:left;transform:scaleX(0)}
#ghud .am.low b{color:#ffb020}
#ghud .am.empty b{color:#ff4030}
#ghud .rp{position:absolute;left:50%;top:calc(50% + 64px);transform:translateX(-50%);font:700 15px 'Bahnschrift','Segoe UI Semibold',sans-serif;letter-spacing:4px;color:#fff;text-shadow:0 1px 3px #000;opacity:0;white-space:nowrap}
#ghud .rp span{display:inline-block;border:2px solid #fff;padding:0 6px;margin-right:8px;border-radius:3px}
#ghud .sc{position:absolute;inset:0;opacity:0}
#ghud .sc .mk{position:absolute;left:50%;top:50%;width:200vmax;height:200vmax;margin:-100vmax 0 0 -100vmax;border-radius:50%}
#ghud .sc svg{position:absolute;left:50%;top:50%;width:92vh;height:92vh;margin:-46vh 0 0 -46vh;overflow:visible}
#ghud .sc .gl{position:absolute;left:50%;top:50%;width:92vh;height:92vh;margin:-46vh 0 0 -46vh;border-radius:50%;background:radial-gradient(circle at 32% 26%,rgba(255,255,255,.10),rgba(255,255,255,0) 22%),radial-gradient(circle,rgba(0,0,0,0) 60%,rgba(40,70,90,.22) 88%,rgba(0,0,0,.6) 100%)}
`;

const SNIPER_RET = `
<g stroke="#000" fill="none" stroke-linecap="butt">
  <line x1="-100" y1="0" x2="-30" y2="0" stroke-width="2.2"/><line x1="30" y1="0" x2="100" y2="0" stroke-width="2.2"/>
  <line x1="0" y1="30" x2="0" y2="100" stroke-width="2.2"/><line x1="0" y1="-100" x2="0" y2="-30" stroke-width="1.2"/>
  <line x1="-30" y1="0" x2="30" y2="0" stroke-width="0.35"/><line x1="0" y1="-30" x2="0" y2="30" stroke-width="0.35"/>
  <g stroke-width="0.5">${[-24, -18, -12, -6, 6, 12, 18, 24].map((v) => `<line x1="${v}" y1="-1.3" x2="${v}" y2="1.3"/><line x1="-1.3" y1="${v}" x2="1.3" y2="${v}"/>`).join('')}</g>
</g>
<circle r="0.55" fill="#ff2a1a"/>`;
const RPG_RET = `
<g stroke="#101010" fill="none" stroke-width="0.7">
  <polyline points="-4,4 0,0 4,4"/><polyline points="-4,12 0,8 4,12"/><polyline points="-4,20 0,16 4,20"/><polyline points="-4,28 0,24 4,28"/>
  <line x1="-26" y1="0" x2="-8" y2="0"/><line x1="8" y1="0" x2="26" y2="0"/>
  ${[-22, -16, -11, 11, 16, 22].map((v) => `<line x1="${v}" y1="-1.6" x2="${v}" y2="1.6"/>`).join('')}
  <path d="M -30 34 Q 0 46 30 34" stroke-width="0.5"/>${[-24, -12, 0, 12, 24].map((v) => `<line x1="${v}" y1="${38 + Math.abs(v) * -0.12}" x2="${v}" y2="${41 + Math.abs(v) * -0.12}"/>`).join('')}
</g>
<circle r="0.6" fill="#ff5a1a"/>`;

export class GunnerHud {
  constructor(parent) {
    if (!document.getElementById('ghud-css')) { const st = document.createElement('style'); st.id = 'ghud-css'; st.textContent = CSS; document.head.appendChild(st); }
    const el = this.el = document.createElement('div'); el.id = 'ghud';
    el.innerHTML = `
      <div class="sc"><div class="mk"></div><div class="gl"></div><svg viewBox="-100 -100 200 200"></svg></div>
      <div class="dm">${'<div></div>'.repeat(6)}</div>
      <div class="c"><i class="h"></i><i class="h"></i><i class="v"></i><i class="v"></i><i class="d"></i><i class="ring"></i><i class="chev"></i></div>
      <div class="hm"><i></i><i></i><i></i><i></i></div>
      <div class="kr"></div><div class="kt"></div>
      <div class="rp"><span>R</span>RELOAD</div>
      <div class="am"><span class="wn"></span><b class="mg">0</b><small>/ ∞</small><div class="bar"><i></i></div></div>`;
    parent.appendChild(el);
    const $ = (s) => el.querySelector(s);
    this.q = { c: $('.c'), h: [...el.querySelectorAll('.c .h')], v: [...el.querySelectorAll('.c .v')], dot: $('.c .d'), ring: $('.c .ring'), chev: $('.c .chev'),
      hm: $('.hm'), hmI: [...el.querySelectorAll('.hm i')], kr: $('.kr'), kt: $('.kt'), dm: [...el.querySelectorAll('.dm div')], am: $('.am'), wn: $('.am .wn'), mg: $('.am .mg'), bar: $('.am .bar i'), rp: $('.rp'),
      sc: $('.sc'), mk: $('.sc .mk'), svg: $('.sc svg') };
    this.hitT = 0; this.hitLen = 0.2; this.hitKind = 0; this.killT = 0; this.scopeK = 0; this.scopeKind = null; this.on = true; this.crossKind = -1;
    this.dmg = this.q.dm.map((e) => ({ e, t: 0, a: 0 }));
    this._last = { mag: -1, w: '', cls: '' };
    this.lastHitKey = 0;
  }

  setVisible(v) { this.on = v; this.el.style.display = v ? '' : 'none'; }
  setDriverShown(v) { this.q.am.style.bottom = v ? '156px' : ''; }

  /** kind: 0 body, 1 head, 2 kill (2 + head -> gold/red) */
  hit(kill = false, head = false) {
    if (!this.on) return;
    const k = kill ? 2 : head ? 1 : 0;
    if (this.hitT > 0 && this.hitKind > k) return;       // a kill marker is not overwritten by the pellets that caused it
    this.hitKind = k; this.hitLen = kill ? 0.55 : head ? 0.3 : 0.2; this.hitT = this.hitLen;
    this.q.hm.className = 'hm' + (kill ? ' k' : head ? ' hd' : '');
    if (kill) { this.killT = 0.6; this.q.kt.textContent = head ? 'HEADSHOT' : 'KILL'; this.q.kt.style.color = head ? '#ffc93a' : ''; }
  }

  _events(d) {
    const cam = d.cam; if (!cam || !d.events) return;
    for (const e of d.events) {
      let src = null;
      if (e.t === 'hit' && e.enemy && e.carId === d.playerId && e.pos) { const n = e.normal || [0, 0, 0]; src = [e.pos[0] + n[0] * 40, e.pos[1], e.pos[2] + n[2] * 40]; this._lastSrc = src; if (/gunner/.test(e.zone || '')) { this._damage(src, cam, 30, 1); src = null; } }
      else if (e.t === 'crewHit' && e.id === d.playerId && e.role === 'gunner' && this._lastSrc) this._damage(this._lastSrc, cam, 30, 1);
      else if ((e.t === 'explode' || e.t === 'boom') && e.pos) { const dx = e.pos[0] - cam.position.x, dz = e.pos[2] - cam.position.z; if (dx * dx + dz * dz < 28 * 28) src = e.pos; }
      else if (e.t === 'crewDead' && e.id !== d.playerId && (e.src === d.playerId || e.src === 1) && e.cause === 'shot') this.hit(true, !!e.head);
      if (src) this._damage(src, cam, e.t === 'hit' ? (e.dmg || 8) : 30, e.t === 'hit' ? 0.45 : 0.9);
    }
  }
  _damage(p, cam, dmg, k = 1) {
    // bearing relative to the view: 0 = ahead, +pi/2 = right
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fz = -e[10], rx = e[0], rz = e[2];
    const vx = p[0] - cam.position.x, vz = p[2] - cam.position.z;
    const a = Math.atan2(vx * rx + vz * rz, vx * fx + vz * fz);
    let slot = this.dmg.find((s) => s.t > 0 && Math.abs(Math.atan2(Math.sin(s.a - a), Math.cos(s.a - a))) < 0.4);
    if (!slot) slot = this.dmg.reduce((m, s) => (s.t < m.t ? s : m), this.dmg[0]);
    slot.a = a; slot.t = Math.min(1.4, Math.max(slot.t, 0.7 + dmg * 0.02)); slot.k = Math.max(slot.t > 0.75 ? slot.k || 0 : 0, k);
    slot.e.style.transform = `rotate(${a}rad)`;
  }

  update(dt, d) {
    const q = this.q, G = d.gunner;
    if (!G || !this.on || d.cinematic || inCinematic()) { this.el.style.display = 'none'; return; }
    this.el.style.display = '';
    this._events(d);
    const W = G.weapon;
    // ---------------------------------------------------------------- crosshair
    const kind = W.crosshair ?? 2;
    if (kind !== this.crossKind) {
      this.crossKind = kind;
      const ticks = kind === 1 || kind === 2, ring = kind === 3, chev = W.mode === 'launcher';
      for (const t of [...q.h, ...q.v]) t.style.display = ticks && !chev ? '' : 'none';
      q.ring.style.display = ring ? '' : 'none'; q.chev.style.display = chev ? '' : 'none'; q.dot.style.display = '';
    }
    const gap = Math.max(5, Math.min(90, d.spreadPx || 8));
    q.h[0].style.left = (-gap - 10) + 'px'; q.h[1].style.left = gap + 'px'; q.v[0].style.top = (-gap - 10) + 'px'; q.v[1].style.top = gap + 'px';
    if (kind === 3) { const r = Math.max(14, gap); q.ring.style.cssText = `left:${-r}px;top:${-r}px;width:${2 * r}px;height:${2 * r}px`; }
    const onT = !!(G.aimCar && !G.aimCar.exploded);
    const cls = 'c' + (onT ? ' on' : '');
    if (cls !== this._last.cls) { q.c.className = cls; this._last.cls = cls; }
    const crossA = d.scoped || d.hideCross || G.reloading && false ? 0 : (G.swapT > 0 ? 0.35 : 1);
    q.c.style.opacity = crossA;
    // ---------------------------------------------------------------- hit marker + kill confirm
    if (this.hitT > 0) {
      this.hitT = Math.max(0, this.hitT - dt);
      const k = this.hitT / this.hitLen, age = 1 - k;
      const pop = this.hitKind === 2 ? 1.45 - 0.45 * Math.min(1, age * 5) : 1.2 - 0.2 * Math.min(1, age * 6);
      const r = (this.hitKind === 2 ? 13 : 10) * pop + gap * 0.25;
      const L = this.hitKind === 2 ? 20 : this.hitKind === 1 ? 16 : 13;
      q.hmI.forEach((t, i) => { const a = Math.PI / 4 + i * Math.PI / 2; t.style.height = L + 'px'; t.style.top = (-L / 2) + 'px'; t.style.transform = `rotate(${a}rad) translateY(${-r - L / 2}px)`; });
      q.hm.style.opacity = Math.min(1, k * 2.2);
    } else q.hm.style.opacity = 0;
    if (this.killT > 0) {
      this.killT = Math.max(0, this.killT - dt); const age = 1 - this.killT / 0.6;
      q.kr.style.opacity = Math.max(0, 0.9 - age * 1.4); q.kr.style.transform = `scale(${0.6 + age * 1.6})`;
      q.kt.style.opacity = age < 0.75 ? 1 : Math.max(0, 1 - (age - 0.75) * 4); q.kt.style.transform = `translateX(-50%) translateY(${-age * 6}px) scale(${1.15 - Math.min(0.15, age * 0.6)})`;
    } else { q.kr.style.opacity = 0; q.kt.style.opacity = 0; }
    // ---------------------------------------------------------------- damage direction
    for (const s of this.dmg) {
      if (s.t <= 0) { if (s.e.style.opacity !== '0') s.e.style.opacity = 0; continue; }
      s.t = Math.max(0, s.t - dt); s.e.style.opacity = Math.min(1, s.t * 1.4) * (s.k || 1);
    }
    // ---------------------------------------------------------------- ammo
    const mag = d.mag ?? G.magNow, max = W.mag || 1;
    if (W.name !== this._last.w) { q.wn.textContent = W.name; this._last.w = W.name; }
    if (mag !== this._last.mag || G.reloading !== this._last.rel) { q.mg.textContent = G.reloading ? mag : mag; this._last.mag = mag; this._last.rel = G.reloading; }
    const frac = mag / max, amCls = 'am' + (mag <= 0 ? ' empty' : frac <= 0.25 ? ' low' : '');
    if (amCls !== this._last.am) { q.am.className = amCls; this._last.am = amCls; }
    const rel = G.reloading ? (W.reloadPerShell ? (mag + Math.min(1, G.reloadT / W.reload)) / max : Math.min(1, G.reloadT / Math.max(0.01, W.reload))) : 0;
    q.bar.style.transform = `scaleX(${rel})`;
    q.rp.style.opacity = !G.reloading && mag <= 0 && W.mode !== 'launcher' ? 0.6 + 0.4 * Math.sin(performance.now() / 110) : 0;
    // ---------------------------------------------------------------- scope overlay
    const want = d.scoped ? 1 : 0;
    this.scopeK += (want - this.scopeK) * Math.min(1, dt * (want ? 16 : 22));
    if (this.scopeK > 0.01) {
      const sk = W.mode === 'launcher' ? 'rpg' : 'sniper';
      if (sk !== this.scopeKind) {
        this.scopeKind = sk; q.svg.innerHTML = sk === 'rpg' ? RPG_RET : SNIPER_RET;
        const R = 46; // vh: soft-edged exit pupil, black beyond
        q.mk.style.background = `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) calc(${R}vh - 14px), rgba(0,0,0,.85) calc(${R}vh + 2px), #000 calc(${R}vh + 26px))`;
      }
      const vm = G.vm, sx = vm ? vm.swayS.x[0] * 900 + vm.inert.x[0] * 700 : 0, sy = vm ? -vm.swayS.x[1] * 900 - vm.inert.x[1] * 700 : 0;
      q.mk.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
      q.sc.style.opacity = Math.min(1, this.scopeK * 1.4);
      q.svg.style.transform = `scale(${1.06 - 0.06 * this.scopeK})`;
    } else q.sc.style.opacity = 0;
  }
}

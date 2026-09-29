// DOM HUD overlay: speedometer, boost, HP bars, ammo, crosshair, damage vignette, radar arrows. Styled in hud.css (injected).
import { clamp, fmtTime } from '../core/util.js';

const CSS = `
#hud{position:fixed;inset:0;pointer-events:none;font-family:'Bahnschrift','Segoe UI Semibold','Arial Narrow',Impact,sans-serif;color:#fff;user-select:none;text-shadow:0 1px 3px rgba(0,0,0,.8)}
#hud .abs{position:absolute}
#hud .speed{right:34px;bottom:26px;text-align:right}
#hud .speed b{font-size:66px;line-height:.9;font-weight:800;letter-spacing:-1px;font-style:italic}
#hud .speed small{font-size:18px;opacity:.8;margin-left:4px}
#hud .bar{height:8px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.25);transform:skewX(-18deg);overflow:hidden}
#hud .bar i{display:block;height:100%;width:100%;transform-origin:left;transition:none}
#hud .rpm{right:34px;bottom:112px;width:250px}
#hud .rpm i{background:linear-gradient(90deg,#3fd,#fd3 70%,#f43)}
#hud .nitro{right:34px;bottom:130px;width:250px}
#hud .nitro i{background:linear-gradient(90deg,#2af,#7ff)}
#hud .hpbox{left:30px;bottom:26px;width:290px}
#hud .hpbox .row{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px;letter-spacing:1px}
#hud .hpbox .row span{width:56px;opacity:.85}
#hud .hpbox .bar{flex:1;height:11px}
#hud .hp i{background:linear-gradient(90deg,#e33,#fa3 60%,#7d4)}
#hud .dhp i{background:#6cf}
#hud .ghp i{background:#f9c}
#hud .top{left:50%;top:14px;transform:translateX(-50%);text-align:center;font-size:15px;letter-spacing:2px}
#hud .top b{font-size:28px;font-weight:800;letter-spacing:1px}
#hud .cross{left:50%;top:50%;width:0;height:0}
#hud .cross i{position:absolute;background:#fff;box-shadow:0 0 3px #000}
#hud .cross .h{width:9px;height:2px;top:-1px}
#hud .cross .v{width:2px;height:9px;left:-1px}
#hud .cross .dot{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%}
#hud .ammo{right:34px;bottom:26px;text-align:right}
#hud .ammo b{font-size:54px;font-weight:800;font-style:italic}
#hud .ammo small{font-size:22px;opacity:.75}
#hud .ammo .wname{font-size:15px;letter-spacing:3px;opacity:.9;display:block}
#hud .vig{inset:0;background:radial-gradient(ellipse at center,rgba(200,0,0,0) 45%,rgba(200,0,0,.55) 100%);opacity:0}
#hud .msg{left:50%;top:22%;transform:translateX(-50%);font-size:44px;font-weight:800;letter-spacing:4px;text-align:center;opacity:0;font-style:italic}
#hud .kf{right:30px;top:80px;text-align:right;font-size:18px;letter-spacing:1px}
#hud .kf div{opacity:1;transition:opacity .4s}
#hud .hitm{left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;opacity:0;transition:opacity .18s}
#hud .hitm:before,#hud .hitm:after{content:'';position:absolute;left:12px;top:-2px;width:2px;height:30px;background:#fff;transform:rotate(45deg)}
#hud .hitm:after{transform:rotate(-45deg)}
#hud .arrows{inset:0}
#hud .arrow{position:absolute;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:16px solid #f43;filter:drop-shadow(0 0 3px #000)}
#hud .boss{left:50%;top:104px;transform:translateX(-50%);width:520px;text-align:center;display:none}
#hud .boss .bar{height:16px}
#hud .boss .bar i{background:linear-gradient(90deg,#a11,#f54)}
#hud .prog{left:50%;top:76px;transform:translateX(-50%);width:420px;text-align:center;font-size:12px;letter-spacing:2px;opacity:.85}
#hud .prog .bar{height:6px;margin-top:3px}
#hud .prog .bar i{background:#fff}
`;

export class Hud {
  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const el = this.el = document.createElement('div'); el.id = 'hud';
    el.innerHTML = `
      <div class="abs vig"></div>
      <div class="abs arrows"></div>
      <div class="abs top"><b class="dist">0.0 km</b><br><span class="biome"></span> · <span class="time">0:00</span></div>
      <div class="abs prog"><span class="progt">TO THE DAM</span><div class="bar"><i class="progbar" style="transform:scaleX(0)"></i></div></div>
      <div class="abs boss"><div class="bossname">BOSS</div><div class="bar"><i class="bossbar"></i></div></div>
      <div class="abs cross"><i class="h" style="left:-16px"></i><i class="h" style="left:7px"></i><i class="v" style="top:-16px"></i><i class="v" style="top:7px"></i><i class="dot"></i></div>
      <div class="abs hitm"></div>
      <div class="abs msg"></div>
      <div class="abs kf"></div>
      <div class="abs speed"><b class="spd">0</b><small>KM/H</small></div>
      <div class="abs bar rpm"><i class="rpmbar"></i></div>
      <div class="abs bar nitro"><i class="nitrobar"></i></div>
      <div class="abs hpbox">
        <div class="row"><span>TRUCK</span><div class="bar hp"><i class="hpbar"></i></div></div>
        <div class="row"><span>DRIVER</span><div class="bar dhp"><i class="dhpbar"></i></div></div>
        <div class="row"><span>GUNNER</span><div class="bar ghp"><i class="ghpbar"></i></div></div>
      </div>
      <div class="abs ammo" style="display:none"><span class="wname"></span><b class="mag">0</b><small> / ∞</small></div>`;
    document.body.appendChild(el);
    const $ = (s) => el.querySelector(s);
    this.q = { spd: $('.spd'), rpm: $('.rpmbar'), nitro: $('.nitrobar'), nitroBox: $('.nitro'), hp: $('.hpbar'), dhp: $('.dhpbar'), ghp: $('.ghpbar'), dist: $('.dist'), time: $('.time'), biome: $('.biome'),
      vig: $('.vig'), msg: $('.msg'), kf: $('.kf'), hitm: $('.hitm'), arrows: $('.arrows'), ammo: $('.ammo'), mag: $('.mag'), wname: $('.wname'), cross: $('.cross'), progbar: $('.progbar'), boss: $('.boss'), bossbar: $('.bossbar'), bossname: $('.bossname'), rpmBox: $('.rpm'), speedBox: $('.speed'), hpbox: $('.hpbox') };
    this.arrowPool = []; this.msgT = 0; this.vigT = 0; this.hitT = 0;
    this.show({ driver: true, gunner: true });
  }
  show(o) {
    const q = this.q;
    q.speedBox.style.display = o.driver ? '' : 'none'; q.rpmBox.style.display = o.driver ? '' : 'none'; q.nitroBox.style.display = o.driver ? '' : 'none';
    q.cross.style.display = o.gunner ? '' : 'none'; q.ammo.style.display = o.gunner ? '' : 'none';
    q.ammo.style.bottom = o.gunner && o.driver ? '156px' : '';
    if (o.gunner && !o.driver) { q.hpbox.style.left = '30px'; }
  }
  setVisible(v) { this.el.style.display = v ? '' : 'none'; }
  hints(lines, ms = 9000) {
    if (!this.hintEl) { this.hintEl = document.createElement('div'); this.hintEl.style.cssText = 'position:absolute;left:50%;bottom:120px;transform:translateX(-50%);text-align:center;font-size:15px;letter-spacing:2px;line-height:1.9;opacity:0;transition:opacity .6s;background:rgba(0,0,0,.35);padding:10px 22px;border-left:3px solid #ffc21a'; this.el.appendChild(this.hintEl); }
    this.hintEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join(''); this.hintEl.style.opacity = 1;
    clearTimeout(this._hintT); this._hintT = setTimeout(() => { this.hintEl.style.opacity = 0; }, ms);
  }
  message(text, ms = 1600, color = '#fff') { const m = this.q.msg; m.textContent = text; m.style.color = color; m.style.opacity = 1; this.msgT = ms / 1000; }
  hitMarker(kill = false) { this.q.hitm.style.opacity = 1; this.q.hitm.style.filter = kill ? 'drop-shadow(0 0 4px #f33)' : ''; this.q.hitm.style.transform = kill ? 'scale(1.4) rotate(0deg)' : 'scale(1)'; this.hitT = kill ? 0.3 : 0.14; }
  damageFlash(a = 0.6) { this.vigT = Math.max(this.vigT, a); }
  feed(text, color = '#fff') { const d = document.createElement('div'); d.textContent = text; d.style.color = color; this.q.kf.prepend(d); setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 400); }, 3200); while (this.q.kf.children.length > 6) this.q.kf.lastChild.remove(); }

  /** data: {speed(m/s), rpm01, nitro01, hp01, dhp01, ghp01, dist, time, biome, ammo, mag, weapon, prog01, boss:{name,hp01}|null, arrows:[{x,y,a}]} */
  update(dt, d) {
    const q = this.q;
    q.spd.textContent = Math.round(d.speed * 3.6);
    q.rpm.style.transform = `scaleX(${clamp(d.rpm01, 0, 1)})`;
    q.nitro.style.transform = `scaleX(${clamp(d.nitro01, 0, 1)})`; q.nitroBox.style.display = d.nitroMax > 0 && d.showDriver !== false ? '' : 'none';
    q.hp.style.transform = `scaleX(${clamp(d.hp01, 0, 1)})`; q.dhp.style.transform = `scaleX(${clamp(d.dhp01, 0, 1)})`; q.ghp.style.transform = `scaleX(${clamp(d.ghp01, 0, 1)})`;
    q.dist.textContent = (d.dist / 1000).toFixed(2) + ' km'; q.time.textContent = fmtTime(d.time); q.biome.textContent = d.biome || '';
    q.progbar.style.transform = `scaleX(${clamp(d.prog01 ?? 0, 0, 1)})`;
    if (d.weapon !== undefined) { q.wname.textContent = d.weapon; q.mag.textContent = d.reloading ? 'RELOAD' : d.mag; q.mag.style.fontSize = d.reloading ? '34px' : ''; }
    q.progbar.parentElement.parentElement.style.display = d.boss ? 'none' : ''; if (d.boss) { q.boss.style.display = 'block'; q.bossbar.style.transform = `scaleX(${clamp(d.boss.hp01, 0, 1)})`; q.bossbar.style.transformOrigin = 'left'; q.bossname.textContent = d.boss.name; } else q.boss.style.display = 'none';
    if (this.vigT > 0) { this.vigT = Math.max(0, this.vigT - dt * 1.4); }
    const lowHp = d.hp01 < 0.3 ? (0.25 + 0.15 * Math.sin(performance.now() / 160)) : 0;
    q.vig.style.opacity = Math.max(this.vigT, lowHp);
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT < 0.4) q.msg.style.opacity = Math.max(0, this.msgT / 0.4); }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) q.hitm.style.opacity = 0; }
    // radar arrows for off-screen threats
    const arr = d.arrows || [];
    while (this.arrowPool.length < arr.length) { const a = document.createElement('div'); a.className = 'arrow'; q.arrows.appendChild(a); this.arrowPool.push(a); }
    for (let i = 0; i < this.arrowPool.length; i++) {
      const a = this.arrowPool[i];
      if (i < arr.length) { a.style.display = 'block'; a.style.left = arr[i].x + 'px'; a.style.top = arr[i].y + 'px'; a.style.transform = `translate(-50%,-50%) rotate(${arr[i].a}rad)`; a.style.opacity = arr[i].o ?? 1; a.style.borderBottomColor = arr[i].c || '#f43'; } else a.style.display = 'none';
    }
  }
}

// Cinematic banners over the HUD: the WARLORD intro (name, title, weak point, how it fights) and hazard warnings that count
// down the distance to a roadblock with the side of the gap. Driven from run.js by sim events:
//   banner.miniboss({name, title, weak, tip, color})   banner.hazard({s0, gapD})   banner.update(dt, playerS)
import { MINIBOSSES } from '../data/boss.js';

const CSS = `
#bnr{position:absolute;inset:0;pointer-events:none;font-family:'Bahnschrift','Segoe UI Semibold','Arial Narrow',Impact,sans-serif;color:#fff}
#bnr .bn-boss{position:absolute;left:0;right:0;top:24%;height:150px;display:none;align-items:center;justify-content:center;flex-direction:column;
  background:linear-gradient(90deg,rgba(0,0,0,0) 0%,rgba(10,4,2,.78) 18%,rgba(10,4,2,.86) 50%,rgba(10,4,2,.78) 82%,rgba(0,0,0,0) 100%);
  border-top:2px solid var(--ac);border-bottom:2px solid var(--ac);transform-origin:center;text-shadow:0 2px 6px #000}
#bnr .bn-boss .k{font-size:15px;letter-spacing:9px;color:var(--ac);font-weight:700}
#bnr .bn-boss .n{font-size:64px;line-height:1;font-weight:900;font-style:italic;letter-spacing:3px;margin:4px 0 2px}
#bnr .bn-boss .t{font-size:16px;letter-spacing:6px;opacity:.85}
#bnr .bn-boss .w{margin-top:8px;font-size:15px;letter-spacing:3px;color:#ffe08a}
#bnr .bn-boss .w b{color:var(--ac);font-weight:800}
#bnr .bn-boss .tip{font-size:13px;letter-spacing:2px;opacity:.75;margin-top:3px}
#bnr .bn-obj{position:absolute;left:50%;top:128px;transform:translateX(-50%);display:none;padding:4px 14px;background:rgba(0,0,0,.55);border-left:3px solid #ff5a2a;
  font-size:14px;letter-spacing:2px;font-weight:700;white-space:nowrap;text-shadow:0 1px 3px #000}
#bnr .bn-obj b{color:#ffb21a;font-weight:800;margin-right:8px}
#bnr .bn-obj i{font-style:normal;color:#ffe08a;margin-left:8px}
#bnr .bn-haz{position:absolute;left:50%;top:15%;transform:translateX(-50%);display:none;align-items:center;gap:16px;padding:9px 22px 9px 16px;
  background:rgba(20,12,0,.72);border:2px solid #ffb21a;border-radius:3px;box-shadow:0 0 18px rgba(255,160,20,.35);text-shadow:0 1px 4px #000}
#bnr .bn-haz .ic{width:0;height:0;border-left:19px solid transparent;border-right:19px solid transparent;border-bottom:33px solid #ffb21a;position:relative}
#bnr .bn-haz .ic:after{content:'!';position:absolute;left:-4px;top:7px;font-size:22px;font-weight:900;color:#1a1000}
#bnr .bn-haz .tx{font-size:26px;font-weight:900;font-style:italic;letter-spacing:3px;color:#ffc84a}
#bnr .bn-haz .d{font-size:30px;font-weight:800;min-width:92px;text-align:right}
#bnr .bn-haz .g{font-size:17px;letter-spacing:3px;font-weight:700;color:#fff}
#bnr .bn-haz .g i{font-style:normal;color:#ffb21a;font-size:24px;vertical-align:-2px}
`;

export class Banner {
  /** @param parent element to attach to (the HUD root, so it hides with the HUD) */
  constructor(parent = document.body) {
    if (!document.getElementById('bnr-css')) { const st = document.createElement('style'); st.id = 'bnr-css'; st.textContent = CSS; document.head.appendChild(st); }
    const el = this.el = document.createElement('div'); el.id = 'bnr';
    el.innerHTML = `<div class="bn-boss"><div class="k">WARLORD</div><div class="n"></div><div class="t"></div><div class="w"></div><div class="tip"></div></div>
      <div class="bn-obj"></div>
      <div class="bn-haz"><div class="ic"></div><div><div class="tx">ROADBLOCK</div><div class="g"></div></div><div class="d"></div></div>`;
    parent.appendChild(el);
    const $ = (s) => el.querySelector(s);
    this.q = { boss: $('.bn-boss'), n: $('.bn-boss .n'), t: $('.bn-boss .t'), w: $('.bn-boss .w'), tip: $('.bn-boss .tip'), haz: $('.bn-haz'), hd: $('.bn-haz .d'), hg: $('.bn-haz .g'), htx: $('.bn-haz .tx'), obj: $('.bn-obj') };
    this.bossT = -1; this.hazards = []; this.time = 0;
  }

  /** WARLORD intro: slides in, holds ~4 s, collapses. e: minibossSpawn event {index, name, title, weak} */
  miniboss(e) {
    const M = MINIBOSSES[e.index] || {};
    const col = '#' + (M.look?.glow ?? 0xff5a2a).toString(16).padStart(6, '0');
    const q = this.q;
    q.boss.style.setProperty('--ac', col);
    q.n.textContent = e.name || M.name || ''; q.t.textContent = e.title || M.title || '';
    const weak = e.weak || M.weak?.label;
    q.w.innerHTML = weak ? `WEAK POINT: <b>${weak}</b>` : '';
    q.tip.textContent = M.tip || '';
    q.boss.querySelector('.k').textContent = 'WARLORD';
    this.bossT = 0; this.bossHold = 4.2;
  }

  /** Set-piece announcement (smaller, no weak point line): e {title, sub}. */
  event(e) {
    const q = this.q;
    q.boss.style.setProperty('--ac', e.color || '#ffb21a');
    q.boss.querySelector('.k').textContent = e.k || 'INCOMING';
    q.n.textContent = e.title || ''; q.t.textContent = e.sub || ''; q.w.innerHTML = ''; q.tip.textContent = '';
    this.bossT = 0; this.bossHold = 2.6; // shorter hold than a warlord intro
  }

  /** Roadblock warning: tracked until the player is past it. e: {s0, gapD} (gapD > 0 = gap on the LEFT, +X is left). */
  hazard(e) {
    if (this.hazards.some((h) => Math.abs(h.s0 - e.s0) < 1)) return;
    this.hazards.push({ s0: e.s0, gapD: e.gapD ?? 0, kind: e.kind || 'roadblock', t: 0 });
  }

  /** Leviathan beats: phase changes, the blockade smash, the reactor overheating. */
  bossBeat(e) {
    const B = {
      2: { title: 'PHASE 2', sub: 'THE CANNON WAKES — FLAMERS ON ITS FLANKS, HIT THE FUEL TANKS' },
      3: { title: 'REACTOR EXPOSED', sub: 'THE CORE IS OPEN — POUR EVERYTHING INTO IT', color: '#ff3a1a' },
      blockade: { title: 'BRACE', sub: 'IT IS SMASHING THROUGH THE BLOCKADE' },
      overheat: { title: 'REACTOR OVERHEATING', sub: 'ITS TANKS AND PLATES ARE BLOWING — GET CLEAR', color: '#ff3a1a' },
    }[e.t === 'bossPhase' ? e.phase : e.kind];
    if (B) this.event({ k: 'THE LEVIATHAN', ...B });
  }

  update(dt, playerS, bs) {
    this.time += dt;
    const q = this.q;
    // ---- Leviathan objective chip under the boss bar: what to shoot this phase, and how much of it is left
    if (bs && !bs.dead && !bs.exploded) {
      const a = bs.alive || {}, n = (list) => list.filter((k) => a[k]).length;
      const guns = n(['part_turret_1', 'part_turret_2', 'part_pod_L', 'part_pod_R']), tanks = n(['part_tank_L', 'part_tank_R']), armor = n(['panel_armor_rear_1', 'panel_armor_rear_2', 'panel_armor_rear_3']);
      const html = bs.phase <= 1 ? `<b>PHASE 1</b>KNOCK OUT THE GUNS<i>${guns} LEFT</i>`
        : bs.phase === 2 ? `<b>PHASE 2</b>FUEL TANKS <i>${tanks}</i> &nbsp;·&nbsp; REAR ARMOUR <i>${armor}</i>${a.part_turret_main ? ' &nbsp;·&nbsp; CANNON' : ''}`
        : '<b>PHASE 3</b>SHOOT THE REACTOR — REAR, UP TOP';
      if (html !== this._objHtml) { this._objHtml = html; q.obj.innerHTML = html; }
      q.obj.style.display = 'block';
    } else if (this._objHtml) { this._objHtml = null; q.obj.style.display = 'none'; }
    // ---- warlord intro
    if (this.bossT >= 0) {
      this.bossT += dt;
      const T = this.bossT, IN = 0.35, HOLD = this.bossHold || 4.2, OUT = 0.4;
      if (T > IN + HOLD + OUT) { this.bossT = -1; q.boss.style.display = 'none'; }
      else {
        q.boss.style.display = 'flex';
        const kin = Math.min(1, T / IN), kout = T > IN + HOLD ? 1 - (T - IN - HOLD) / OUT : 1;
        const e = 1 - Math.pow(1 - kin, 3);
        q.boss.style.opacity = String(Math.min(e, kout));
        q.boss.style.transform = `scaleY(${(0.2 + 0.8 * e) * kout}) translateX(${(1 - e) * -8}%)`;
        q.n.style.letterSpacing = `${3 + (1 - e) * 22}px`;
      }
    }
    // ---- hazard warnings (closest one ahead)
    this.hazards = this.hazards.filter((h) => h.s0 - playerS > -8);
    const h = this.hazards.reduce((a, x) => (!a || x.s0 < a.s0 ? x : a), null);
    if (!h) { q.haz.style.display = 'none'; return; }
    const dist = Math.max(0, h.s0 - playerS);
    q.haz.style.display = 'flex';
    q.hd.textContent = dist > 5 ? `${Math.round(dist / 10) * 10} m` : 'NOW';
    const side = h.gapD > 1 ? 'LEFT' : h.gapD < -1 ? 'RIGHT' : 'CENTRE';
    q.hg.innerHTML = side === 'LEFT' ? '<i>&#9664;</i> GAP LEFT' : side === 'RIGHT' ? 'GAP RIGHT <i>&#9654;</i>' : '<i>&#9650;</i> GAP CENTRE';
    // urgency: blink faster as it gets close
    const rate = dist < 90 ? 7 : dist < 170 ? 4 : 2.2;
    const on = Math.sin(this.time * rate * Math.PI) > -0.3;
    q.haz.style.opacity = dist < 25 ? String(Math.max(0, dist / 25)) : on ? '1' : '0.55';
    q.haz.style.borderColor = dist < 90 ? '#ff4a1a' : '#ffb21a';
  }

  clear() { this.hazards.length = 0; this.bossT = -1; this.q.boss.style.display = 'none'; this.q.haz.style.display = 'none'; }
  dispose() { this.el.remove(); }
}

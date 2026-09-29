// RESULTS: run summary (stats tiles, route progress), cash breakdown that counts up with tick hooks, total -> BACK TO GARAGE. VICTORY variant.
import { h, tween } from '../comp.js';
import { esc, money, fmtNum, icon, hints } from '../glyphs.js';
import { BIOME_PLAN, MINIBOSS_S, BOSS_S } from '../../data/biomes.js';

const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const BIOME_SHORT = { desert: 'SCORCHED HWY', canyon: 'RED CANYON', coast: 'COASTAL CLIFFS', mountain: 'IRON PEAKS', city: 'ASHEN CITY', dam: 'THE DAM' };
const BIOME_COL = { desert: '#c98a3c', canyon: '#b1502a', coast: '#5f8fa8', mountain: '#7f8b9a', city: '#8a6a60', dam: '#c9a15c' };

export class ResultsScreen {
  constructor(ui, run, profile, cb) {
    this.ui = ui; this.cb = cb; this.kind = 'results'; this.bg = 'dim';
    this.run = run || {}; this.profile = profile || null;
    this.timers = []; this.cancels = []; this.done = false;
    this.win = !!this.run.won;
    this.el = h(`<div class="screen results ${this.win ? 'win' : 'lose'}"><div class="safe"></div></div>`);
    this.safe = this.el.firstElementChild;
    this.build();
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.timers.push(setTimeout(() => this.start(), 450));
  }
  lines() {
    const r = this.run; let ls = Array.isArray(r.breakdown) && r.breakdown.length ? r.breakdown.map((l) => ({ label: String(l.label), amount: Math.round(l.amount) })) : [];
    const sum = ls.reduce((a, l) => a + l.amount, 0), total = Math.round(r.cash ?? sum);
    if (!ls.length) ls = [{ label: 'RUN EARNINGS', amount: total }];
    else if (sum !== total) ls.push({ label: 'OTHER', amount: total - sum });
    return { ls, total };
  }
  build() {
    const r = this.run, p = this.profile, best = (p && p.best) || {};
    const nb = r.newBest || { distance: !!(p && r.distance > 0 && r.distance >= (best.distance || 0) && (p.runs || 0) > 1), time: !!(p && r.time > 0 && r.time >= (best.time || 0) && (p.runs || 0) > 1), kills: !!(p && r.kills > 0 && r.kills >= (best.kills || 0) && (p.runs || 0) > 1) };
    const acc = r.shots > 0 ? Math.round(100 * (r.hits || 0) / r.shots) : null;
    const tiles = [
      { k: 'distance', ic: 'road', label: 'DISTANCE', to: r.distance / 1000, fmt: (v) => v.toFixed(1), unit: 'KM', nb: nb.distance },
      { k: 'time', ic: 'clock', label: 'TIME SURVIVED', to: r.time, fmt: (v) => fmtTime(v), unit: '', nb: nb.time },
      { k: 'kills', ic: 'skull', label: 'KILLS', to: r.kills || 0, fmt: (v) => fmtNum(v), unit: '', nb: nb.kills },
      { k: 'crash', ic: 'bolt', label: 'CRASH KILLS', to: r.crashKills || 0, fmt: (v) => fmtNum(v), unit: '' },
      { k: 'streak', ic: 'medal', label: 'BEST STREAK', to: r.bestStreak || 0, fmt: (v) => '×' + fmtNum(v), unit: '' },
      { k: 'shots', ic: 'crosshair', label: 'SHOTS FIRED', to: r.shots || 0, fmt: (v) => fmtNum(v), unit: '' },
      { k: 'acc', ic: 'crosshair', label: 'ACCURACY', to: acc == null ? 0 : acc, fmt: (v) => (acc == null ? '—' : Math.round(v) + '%'), unit: '' },
      r.maxSpeed ? { k: 'top', ic: 'bolt', label: 'TOP SPEED', to: r.maxSpeed * 3.6, fmt: (v) => fmtNum(v), unit: 'KM/H' } : { k: 'biome', ic: 'flag', label: 'REACHED', to: 0, fmt: () => (r.biome ? String(r.biome).toUpperCase() : '—'), unit: '', text: true },
    ];
    this.tiles = tiles;
    const { ls, total } = this.lines(); this.ls = ls; this.total = total;
    const title = this.win ? 'VICTORY' : 'WRECKED';
    const eyebrow = this.win ? 'THE LEVIATHAN IS DEAD' : (r.biome ? String(r.biome).toUpperCase() : 'RUN OVER');
    const cause = r.cause ? `<div class="rs-cause">${this.win ? icon('flag') : icon('skull')}<span>${this.win ? '' : 'CAUSE OF DEATH &nbsp;&middot;&nbsp; '}<b>${esc(r.cause).toUpperCase()}</b></span></div>` : '';
    const confetti = this.win ? `<div class="confetti">${Array.from({ length: 34 }, (_, i) => `<i style="left:${(i * 29.7) % 100}%;animation-delay:${(i % 11) * 0.37}s;animation-duration:${3.4 + (i % 5) * 0.55}s;--h:${i % 3}"></i>`).join('')}</div>` : '';
    const tileHtml = tiles.map((t, i) => `<div class="tile stg ${t.text ? 'txt' : ''}" style="--i:${i + 2}" data-t="${t.k}"><span class="ti">${icon(t.ic)}</span><div><label>${t.label}${t.nb ? '<em class="nb">NEW BEST</em>' : ''}</label><b class="tv num">${t.text ? esc(t.fmt(0)) : t.fmt(0)}</b>${t.unit ? `<small>${t.unit}</small>` : ''}</div></div>`).join('');
    const lineHtml = ls.map((l, i) => `<div class="rs-l" data-i="${i}"><span class="rs-ln">${esc(l.label)}</span><span class="rs-ld"></span><b class="rs-la num">$0</b></div>`).join('');
    this.safe.innerHTML = `${confetti}
      <div class="rs-title stg" style="--i:0"><div class="eyebrow">${esc(eyebrow)}</div><h1>${title}</h1>${cause}</div>
      <div class="rs-stats">${tileHtml}</div>
      <div class="rs-route stg" style="--i:10">${this.routeHtml()}</div>
      <div class="rs-cash plate trans stg" style="--i:3">
        <div class="rs-ch"><span>CASH EARNED</span><i class="ico">${icon('coin')}</i></div><div class="hazbar"></div>
        <div class="rs-cls">${lineHtml}</div>
        <div class="rs-ct"><span>TOTAL</span><b class="num" data-total>$0</b></div>
        ${p ? `<div class="rs-cb"><span>BALANCE</span><b class="num">${money(p.cash)}</b></div>` : ''}
      </div>
      <div class="rs-actions"><div class="f btn primary cont pending" role="button" data-act="cont" data-k="cont" data-snd="none"><span>BACK TO GARAGE</span></div></div>
      <div class="hints" data-hints>${hints([['confirm', 'SKIP / CONTINUE']])}</div>`;
    this.q = { total: this.safe.querySelector('[data-total]'), cont: this.safe.querySelector('.cont'), fill: this.safe.querySelector('.rt-fill') };
  }
  routeHtml() {
    const r = this.run, total = BOSS_S;
    let acc = 0;
    const segs = BIOME_PLAN.filter((b) => b.id !== 'dam' || true).map((b) => {
      const len = b.id === 'dam' ? 0 : b.len; const s = acc; acc += len; return { id: b.id, s, len };
    }).filter((s) => s.len > 0);
    const mini = MINIBOSS_S.map((m) => `<i class="rt-mini" style="left:${(m / total) * 100}%"></i>`).join('');
    const seg = segs.map((s) => `<span class="rt-seg" style="width:${(s.len / total) * 100}%;--bc:${BIOME_COL[s.id]}"><b>${BIOME_SHORT[s.id]}</b></span>`).join('');
    const pct = Math.min(100, (Math.max(0, r.distance || 0) / total) * 100);
    this.routePct = pct;
    return `<div class="rt-head"><span>ROUTE TO THE DAM</span><em>${((r.distance || 0) / 1000).toFixed(1)} / ${(total / 1000).toFixed(0)} KM</em></div>
      <div class="rt-bar"><div class="rt-segs">${seg}</div><div class="rt-fill" style="width:0"></div>${mini}<i class="rt-boss">${icon('skull')}</i><i class="rt-you" style="left:0"></i></div>`;
  }
  // ---------------------------------------------------------------- animation
  clearAnim() { this.timers.forEach(clearTimeout); this.timers = []; this.cancels.forEach((c) => c()); this.cancels = []; }
  destroy() { this.clearAnim(); }
  tick() { const t = performance.now(); if (t - (this._tk || 0) > 42) { this._tk = t; if (this.cb.onTick) this.cb.onTick(); } }
  start() {
    this.ui.snd('menu_open');
    // stat tiles count up (staggered)
    this.tiles.forEach((t, i) => {
      if (t.text) return;
      const el = this.safe.querySelector(`[data-t="${t.k}"] .tv`);
      this.timers.push(setTimeout(() => { this.cancels.push(tween(0, t.to, 900, (v) => { el.textContent = t.fmt(v); }, () => { el.textContent = t.fmt(t.to); })); }, i * 70));
    });
    // route bar
    const fill = this.q.fill, you = this.safe.querySelector('.rt-you');
    this.cancels.push(tween(0, this.routePct, 1400, (v) => { fill.style.width = v + '%'; you.style.left = v + '%'; }));
    // cash lines, one after another
    let i = 0;
    const next = () => {
      if (this.done) return;
      if (i >= this.ls.length) { this.countTotal(); return; }
      const row = this.safe.querySelector(`.rs-l[data-i="${i}"]`), amt = this.ls[i].amount, out = row.querySelector('.rs-la');
      row.classList.add('in');
      const dur = Math.min(900, 360 + Math.abs(amt) * 0.22);
      this.cancels.push(tween(0, amt, dur, (v) => { out.textContent = money(v); this.tick(); }, () => { out.textContent = money(amt); this.ui.snd('coin'); this.timers.push(setTimeout(next, 170)); }));
      i++;
    };
    this.timers.push(setTimeout(next, 500));
  }
  countTotal() {
    const box = this.q.total.parentElement; box.classList.add('in');
    this.cancels.push(tween(0, this.total, 1100, (v) => { this.q.total.textContent = money(v); this.tick(); }, () => { this.q.total.textContent = money(this.total); this.finish(true); }));
  }
  skip() {
    if (this.done) return;
    this.clearAnim();
    this.tiles.forEach((t) => { const el = this.safe.querySelector(`[data-t="${t.k}"] .tv`); if (!t.text) el.textContent = t.fmt(t.to); });
    this.safe.querySelectorAll('.rs-l').forEach((row, i) => { row.classList.add('in'); row.querySelector('.rs-la').textContent = money(this.ls[i].amount); });
    this.q.fill.style.width = this.routePct + '%'; const you = this.safe.querySelector('.rt-you'); if (you) you.style.left = this.routePct + '%';
    this.q.total.parentElement.classList.add('in'); this.q.total.textContent = money(this.total);
    this.finish(false);
  }
  finish(fx) {
    if (this.done) return; this.done = true;
    this.q.cont.classList.remove('pending');
    if (fx) this.ui.snd(this.win ? 'go' : 'upgrade_unlock');
    const total = this.q.total.parentElement; total.classList.add('pop');
  }
  onClick(e) {
    const t = e.target.closest('.f');
    if (!this.done) { this.ui.snd('click'); this.skip(); if (t && t.dataset.act === 'cont') return; if (!t) return; }
    if (t && t.dataset.act === 'cont' && this.done) { this.ui.snd('menu_close'); this.cb.onContinue && this.cb.onContinue(); }
  }
  initialFocus() { return this.q.cont; }
  back() { if (!this.done) { this.skip(); return true; } return true; }
  onKey(e) { if (!this.done && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) { this.skip(); return true; } return false; }
}

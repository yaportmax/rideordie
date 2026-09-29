// GARAGE: tabs TRUCK | UPGRADES | WEAPONS | GUNNER | PAINT, item list, detail + stat preview + buy, cash, READY / START RUN.
// The integrator renders the 3D garage behind this transparent overlay and calls ui.updateGarage(profile) after every purchase.
import { h, tween, pips, statRow } from '../comp.js';
import { esc, money, icon, weaponIcon, hints } from '../glyphs.js';
import { TRUCKS, UPGRADES, UPGRADE_BY_ID, WEAPON_TRACKS, WEAPON_TRACK_MAX, weaponTrackCost, TRUCK_COLORS } from '../../data/upgrades.js';
import { WEAPONS, WEAPON_ORDER } from '../../data/weapons.js';
import { upgradeStats, truckStats, weaponRows } from '../garage_stats.js';

const TABS = [
  { id: 'truck', name: 'TRUCK', icon: 'truck' }, { id: 'upgrades', name: 'UPGRADES', icon: 'wrench' }, { id: 'weapons', name: 'WEAPONS', icon: 'gun' },
  { id: 'gunner', name: 'GUNNER', icon: 'vest' }, { id: 'paint', name: 'PAINT', icon: 'paint' },
];
const TAB_IDS = TABS.map((t) => t.id);
const PAINT_NAMES = ['DUST TAN', 'BRICK RED', 'STEEL BLUE', 'OLIVE DRAB', 'ASH BLACK', 'MUSTARD', 'PLUM', 'BONE'];
const MODE_NAME = { semi: 'SEMI-AUTO', auto: 'FULL-AUTO', pump: 'PUMP ACTION', bolt: 'BOLT ACTION', launcher: 'LAUNCHER' };
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const TAB_TITLE = { truck: 'CHOOSE YOUR RIDE', upgrades: 'DRIVER UPGRADES', weapons: 'ARMORY', gunner: 'GUNNER GEAR', paint: 'PAINT SHOP' };

export class GarageScreen {
  constructor(ui, profile, cb, extra = {}) {
    this.ui = ui; this.cb = cb; this.kind = 'garage'; this.bg = 'none';
    this.p = profile;
    this.extra = { solo: true, ready: false, isHost: true, partner: null, runNo: null, ...extra };
    this.tab = TAB_IDS.includes(extra.tab) ? extra.tab : 'truck';
    this.selId = { truck: profile.truck, upgrades: 'engine', weapons: profile.loadout[0] || 'pistol', gunner: 'vest', paint: String(profile.truckColor) };
    if (extra.select != null) this.selId[this.tab] = String(extra.select);
    this.trackPrev = null;
    this.snap = this.snapshot(profile);
    this.fresh = {};
    this.cashShown = profile.cash;
    this.el = h(`<div class="screen garage"><div class="safe">
      <div class="g-title stg" style="--i:0"><div class="eyebrow">BETWEEN RUNS</div><h1>GARAGE</h1><div class="g-sub"></div></div>
      <div class="g-cash plate trans stg" style="--i:1"><span class="cl">CASH</span><span class="cv num"></span><span class="cf"></span></div>
      <div class="g-rail plate trans stg" style="--i:2"><div class="rail-k top"><span class="hk">Q</span><span class="hg"></span></div><div class="tabs"></div><div class="rail-k bot"></div></div>
      <div class="g-list plate trans stg" style="--i:3"><div class="lhead"><h2></h2><span class="lcount"></span></div><div class="hazbar"></div><div class="scroll g-rows"></div></div>
      <div class="g-detail plate trans stg" style="--i:4"><div class="scroll d-scroll"></div><div class="d-foot"></div></div>
      <div class="g-party stg" style="--i:5"></div>
      <div class="g-tag stg" style="--i:5"></div>
      <div class="g-ready stg" style="--i:6"></div>
      <div class="hints" data-hints></div>
    </div></div>`);
    const q = (s) => this.el.querySelector(s);
    this.q = { sub: q('.g-sub'), cv: q('.cv'), cf: q('.cf'), tabs: q('.tabs'), rows: q('.g-rows'), lhead: q('.lhead h2'), lcount: q('.lcount'), det: q('.d-scroll'), foot: q('.d-foot'), tag: q('.g-tag'), party: q('.g-party'), ready: q('.g-ready'), hints: q('[data-hints]'), rail: q('.g-rail') };
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('navfocus', (e) => this.onNavFocus(e));
    this.renderAll();
  }

  // ---------------------------------------------------------------- data helpers
  snapshot(p) {
    return { cash: p.cash, up: { ...p.upgrades }, trucks: p.trucks.slice(), weapons: JSON.parse(JSON.stringify(p.weapons)), truck: p.truck };
  }
  items(tab = this.tab) {
    switch (tab) {
      case 'truck': return TRUCKS.map((t) => t.id);
      case 'upgrades': return UPGRADES.filter((u) => u.role === 'driver').map((u) => u.id);
      case 'gunner': return UPGRADES.filter((u) => u.role !== 'driver').map((u) => u.id);
      case 'weapons': return WEAPON_ORDER.slice();
      default: return TRUCK_COLORS.map((_, i) => String(i));
    }
  }
  sel() { return this.selId[this.tab]; }
  upState(id) {
    const u = UPGRADE_BY_ID[id], lv = this.p.upgrades[id] || 0, max = u.costs.length;
    if (lv >= max) return { u, lv, max, cost: null, state: 'max' };
    const cost = u.costs[lv];
    return { u, lv, max, cost, state: this.p.cash >= cost ? 'ok' : 'no' };
  }
  truckState(t) {
    const owned = this.p.trucks.includes(t.id), cur = this.p.truck === t.id;
    return { owned, cur, cost: t.cost, state: cur ? 'active' : owned ? 'owned' : this.p.cash >= t.cost ? 'ok' : 'no' };
  }
  weaponState(id) {
    const w = WEAPONS[id], owned = !!this.p.weapons[id];
    return { w, owned, cost: w.cost, slot: this.p.loadout.indexOf(id), state: owned ? 'owned' : this.p.cash >= w.cost ? 'ok' : 'no' };
  }
  trackState(id, tr) {
    const own = this.p.weapons[id]; const lv = own ? (own[tr] || 0) : 0;
    if (!own) return { lv, cost: null, state: 'locked' };
    if (lv >= WEAPON_TRACK_MAX) return { lv, cost: null, state: 'max' };
    const cost = weaponTrackCost(id, tr, lv);
    return { lv, cost, state: this.p.cash >= cost ? 'ok' : 'no' };
  }
  affordable(tab) {
    let n = 0;
    if (tab === 'truck') n = TRUCKS.filter((t) => this.truckState(t).state === 'ok').length;
    else if (tab === 'upgrades' || tab === 'gunner') n = this.items(tab).filter((id) => this.upState(id).state === 'ok').length;
    else if (tab === 'weapons') n = WEAPON_ORDER.filter((id) => this.weaponState(id).state === 'ok' || (this.p.weapons[id] && WEAPON_TRACKS.some((t) => this.trackState(id, t.id).state === 'ok'))).length;
    return n;
  }

  // ---------------------------------------------------------------- rendering
  renderAll() { this.renderHeader(); this.renderRail(); this.renderList(); this.renderDetail(); this.renderTag(); this.renderReady(); this.renderHints(); this.renderCash(true); }
  keepFocus(fn) {
    const nav = this.ui.nav, k = nav.cur && this.el.contains(nav.cur) ? nav.cur.dataset.k : null;
    fn();
    if (!k) return;
    let n = this.el.querySelector(`[data-k="${k}"]`);
    if (!n || !nav.isFocusable(n)) n = k === 'buy' || k.startsWith('trk:') || k.startsWith('slot:') ? this.el.querySelector('.row.sel, .sw.sel') : null;
    if (n) nav.focus(n, { silent: true, reveal: false });
  }
  renderHeader() {
    const p = this.p, best = p.best || {};
    const parts = [];
    if (this.extra.runNo || p.runs != null) parts.push(`RUN #${this.extra.runNo || p.runs + 1}`);
    if (best.distance) parts.push(`BEST ${(best.distance / 1000).toFixed(1)} KM`);
    if (best.kills) parts.push(`${best.kills} KILLS`);
    if (p.wins) parts.push(`${p.wins} VICTOR${p.wins > 1 ? 'IES' : 'Y'}`);
    this.q.sub.textContent = parts.join('  ·  ');
  }
  renderRail() {
    this.q.tabs.innerHTML = TABS.map((t) => {
      const n = this.affordable(t.id);
      return `<div class="f tab ${t.id === this.tab ? 'on' : ''}" role="button" data-tab="${t.id}" data-k="tab:${t.id}" data-snd="click">${icon(t.icon)}<span>${t.name}</span>${n ? `<i class="dot" title="${n} affordable"></i>` : ''}</div>`;
    }).join('');
    const lb = '<span class="pb pb-bump"><i class="xb">LB</i><i class="ps">L1</i></span>', rb = '<span class="pb pb-bump"><i class="xb">RB</i><i class="ps">R1</i></span>';
    this.q.rail.querySelector('.rail-k.top').innerHTML = `<span class="hk"><kbd>Q</kbd></span><span class="hg">${lb}</span>`;
    this.q.rail.querySelector('.rail-k.bot').innerHTML = `<span class="hk"><kbd>E</kbd></span><span class="hg">${rb}</span>`;
  }
  renderList() {
    const t = this.tab, sel = this.sel();
    this.q.lhead.textContent = TAB_TITLE[t];
    const ids = this.items();
    let html = '';
    if (t === 'paint') {
      html = `<div class="swatches">${ids.map((id) => `<div class="f sw ${id === sel ? 'sel' : ''} ${String(this.p.truckColor) === id ? 'cur' : ''}" role="button" data-row="${id}" data-k="row:${id}"><i style="background:${hex(TRUCK_COLORS[+id])}"></i><span>${PAINT_NAMES[+id] || 'COLOUR'}</span>${String(this.p.truckColor) === id ? icon('check') : ''}</div>`).join('')}</div>`;
    } else if (t === 'truck') {
      html = ids.map((id) => {
        const tr = TRUCKS.find((x) => x.id === id), s = this.truckState(tr);
        const price = s.cur ? '<em class="chip on">ACTIVE</em>' : s.owned ? '<em class="chip">OWNED</em>' : `<span class="pc ${s.state}">${money(s.cost)}</span>`;
        return `<div class="f row trow ${id === sel ? 'sel' : ''} st-${s.state}" role="button" data-row="${id}" data-k="row:${id}"><span class="ricon">${icon('truck')}</span><span class="rmain"><b class="rn">${esc(tr.name)}</b><span class="rsub">${pips(tr.tier, 4, this.fresh['truck:' + id] ? tr.tier - 1 : -1, 'tier')}<i class="lv">TIER ${tr.tier}</i></span></span><span class="rprice">${price}</span></div>`;
      }).join('');
    } else if (t === 'weapons') {
      html = ids.map((id) => {
        const s = this.weaponState(id);
        const slot = s.slot >= 0 ? `<em class="slotb">${s.slot + 1}</em>` : '';
        const price = s.owned ? '' : `<span class="pc ${s.state}">${money(s.cost)}</span>`;
        const lv = this.p.weapons[id] ? Object.values(this.p.weapons[id]).reduce((a, b) => a + b, 0) : 0;
        return `<div class="f row wrow ${id === sel ? 'sel' : ''} st-${s.owned ? 'owned' : s.state} ${s.owned ? '' : 'locked'}" role="button" data-row="${id}" data-k="row:${id}"><span class="wicon">${weaponIcon(id)}${s.owned ? '' : icon('lock', 'lk')}</span><span class="rmain"><b class="rn">${esc(s.w.name)}</b><span class="rsub"><i class="lv">${MODE_NAME[s.w.mode] || ''}</i>${s.owned ? `<i class="lv up">+${lv}</i>` : ''}</span></span>${slot}${price ? `<span class="rprice">${price}</span>` : ''}</div>`;
      }).join('');
    } else {
      html = ids.map((id) => {
        const s = this.upState(id);
        const shared = s.u.role === 'shared' ? '<i class="lv shared">SHARED</i>' : '';
        const price = s.state === 'max' ? '<em class="chip max">MAX</em>' : `<span class="pc ${s.state}">${money(s.cost)}</span>`;
        return `<div class="f row ${id === sel ? 'sel' : ''} st-${s.state}" role="button" data-row="${id}" data-k="row:${id}"><span class="rmain"><b class="rn">${esc(s.u.name)}</b><span class="rsub">${pips(s.lv, s.max, this.fresh['up:' + id] ?? -1)}<i class="lv">LV ${s.lv}/${s.max}</i>${shared}</span></span><span class="rprice">${price}</span></div>`;
      }).join('');
    }
    this.q.rows.innerHTML = html;
    this.q.lcount.textContent = t === 'paint' ? `${ids.length} COLOURS` : t === 'weapons' ? `${WEAPON_ORDER.filter((id) => this.p.weapons[id]).length}/${WEAPON_ORDER.length} OWNED` : t === 'truck' ? `${this.p.trucks.length}/${TRUCKS.length} OWNED` : `${ids.filter((id) => this.upState(id).state === 'max').length}/${ids.length} MAXED`;
  }
  buyBtn(state, cost, label, extraCls = '') {
    const need = cost - this.p.cash;
    if (state === 'ok') return `<div class="f buy ok pressable ${extraCls}" role="button" data-buy="1" data-k="buy" data-snd="none"><span class="bl">${label}</span><span class="bp">${money(cost)}</span></div>`;
    if (state === 'no') return `<div class="f buy no ${extraCls}" role="button" data-buy="1" data-k="buy" data-snd="none"><span class="bl">NEED ${money(need)} MORE</span><span class="bp">${money(cost)}</span></div>`;
    if (state === 'max') return `<div class="f buy max dis ${extraCls}" role="button"><span class="bl">MAXED OUT</span></div>`;
    if (state === 'active') return `<div class="f buy max dis ${extraCls}" role="button"><span class="bl">${icon('check')} ACTIVE</span></div>`;
    if (state === 'select') return `<div class="f buy ok pressable ${extraCls}" role="button" data-select="1" data-k="buy" data-snd="none"><span class="bl">SELECT</span></div>`;
    return '';
  }
  renderDetail() {
    const t = this.tab, id = this.sel(), d = this.q.det, foot = this.q.foot;
    let body = '', buy = '';
    if (t === 'truck') {
      const tr = TRUCKS.find((x) => x.id === id) || TRUCKS[0], s = this.truckState(tr);
      body = `<div class="d-head"><div class="eyebrow">${s.cur ? 'CURRENT TRUCK' : s.owned ? 'OWNED' : 'FOR SALE'}</div><h2>${esc(tr.name)}</h2><div class="d-tier">${pips(tr.tier, 4, -1, 'tier')} TIER ${tr.tier}</div></div>
        <p class="d-desc">${esc(tr.blurb)}</p><div class="d-sec">VS CURRENT TRUCK</div><div class="stats">${truckStats(this.p, tr.id).map(statRow).join('')}</div>`;
      buy = s.owned ? this.buyBtn(s.cur ? 'active' : 'select', 0, 'SELECT') : this.buyBtn(s.state, tr.cost, 'BUY TRUCK');
    } else if (t === 'weapons') {
      const w = WEAPONS[id], s = this.weaponState(id);
      const slots = s.owned ? `<div class="d-sec">LOADOUT SLOT</div><div class="slots">${[0, 1, 2].map((i) => { const occ = this.p.loadout[i]; return `<div class="f slot pressable ${s.slot === i ? 'on' : ''}" role="button" data-slot="${i}" data-k="slot:${i}"><b>${i + 1}</b><span>${occ ? esc(WEAPONS[occ].name) : 'EMPTY'}</span></div>`; }).join('')}</div>` : '';
      const tracks = `<div class="d-sec">UPGRADES</div><div class="tracks ${s.owned ? '' : 'locked'}">${WEAPON_TRACKS.map((tr) => {
        const ts = this.trackState(id, tr.id);
        const price = ts.state === 'max' ? '<em class="chip max">MAX</em>' : ts.state === 'locked' ? icon('lock', 'lk') : `<span class="pc ${ts.state}">${money(ts.cost)}</span>`;
        return `<div class="f trk st-${ts.state} ${this.trackPrev === tr.id ? 'prev' : ''}" role="button" data-trk="${tr.id}" data-k="trk:${tr.id}" data-snd="none"><b>${tr.name}</b><span class="tp">${price}</span>${pips(ts.lv, 3, this.fresh['trk:' + id + ':' + tr.id] ?? -1)}</div>`;
      }).join('')}</div>`;
      body = `<div class="d-head"><div class="eyebrow">${MODE_NAME[w.mode] || 'WEAPON'}${s.slot >= 0 ? ` · SLOT ${s.slot + 1}` : ''}</div><h2>${esc(w.name)}</h2></div>
        <div class="d-wicon">${weaponIcon(id)}</div><p class="d-desc">${esc(w.desc || '')}</p>${slots}
        <div class="stats compact">${weaponRows(this.p, id, s.owned ? this.trackPrev : null).map(statRow).join('')}</div>${tracks}`;
      buy = s.owned ? '' : this.buyBtn(s.state, w.cost, 'BUY WEAPON');
    } else if (t === 'paint') {
      const i = +id;
      body = `<div class="d-head"><div class="eyebrow">PAINT SHOP</div><h2>${PAINT_NAMES[i] || 'COLOUR'}</h2></div>
        <div class="paint-big" style="--pc:${hex(TRUCK_COLORS[i])}"><i></i></div>
        <p class="d-desc">Fresh coat, no charge. Your co-driver sees it too.</p>`;
      buy = String(this.p.truckColor) === id ? '<div class="f buy max dis" role="button"><span class="bl">' + icon('check') + ' APPLIED</span></div>' : '<div class="f buy ok pressable" role="button" data-paint="1" data-k="buy" data-snd="none"><span class="bl">APPLY PAINT</span><span class="bp">FREE</span></div>';
    } else {
      const s = this.upState(id);
      const rows = upgradeStats(this.p, id);
      const role = s.u.role === 'driver' ? 'DRIVER UPGRADE' : s.u.role === 'gunner' ? 'GUNNER GEAR' : 'SHARED PERK';
      body = `<div class="d-head"><div class="eyebrow">${role}</div><h2>${esc(s.u.name)}</h2></div>
        <p class="d-desc">${esc(s.u.desc)}</p>
        <div class="d-lv"><span>LEVEL <b>${s.lv}</b> / ${s.max}</span>${pips(s.lv, s.max, this.fresh['up:' + id] ?? -1, 'big')}</div>
        <div class="d-sec">${s.state === 'max' ? 'CURRENT' : 'AFTER PURCHASE'}</div><div class="stats">${rows.map(statRow).join('')}</div>`;
      buy = this.buyBtn(s.state, s.cost, s.lv === 0 ? 'BUY' : 'UPGRADE');
    }
    d.innerHTML = body; foot.innerHTML = buy;
    this.q.det.parentElement.classList.toggle('nofoot', !buy);
    d.scrollTop = 0;
  }
  renderTag() {
    const spec = TRUCKS.find((x) => x.id === this.p.truck) || TRUCKS[0];
    this.q.tag.innerHTML = `<span class="tk">TIER ${spec.tier} ${pips(spec.tier, 4, -1, 'tier')}</span><b>${esc(spec.name)}</b>`;
  }
  renderReady() {
    const e = this.extra, pt = e.partner;
    let party = '';
    if (!e.solo) {
      if (pt && pt.connected !== false) party = `<div class="party ${pt.ready ? 'on' : ''}"><i></i><span>${esc((pt.role || 'PARTNER').toUpperCase())} &middot; ${esc(pt.name || '')}</span><b>${pt.ready ? 'READY' : 'NOT READY'}</b></div>`;
      else party = '<div class="party off"><i></i><span>WAITING FOR PLAYER&hellip;</span></div>';
    }
    const label = e.solo ? 'START RUN' : e.ready ? 'READY' : 'READY UP';
    this.q.party.innerHTML = party;
    this.q.ready.innerHTML = `<div class="f btn ready primary ${e.ready ? 'is-ready' : ''}" role="button" data-ready="1" data-k="ready" data-snd="none"><span>${e.ready ? icon('check') : ''}${label}${!e.solo && e.ready ? '<small>WAITING FOR PARTNER &middot; PRESS TO CANCEL</small>' : ''}</span></div>`;
  }
  renderHints() {
    const list = [['confirm', 'SELECT'], ['tabs', 'TAB']];
    if (this.tab === 'weapons') list.push(['<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>', '<span class="pb pb-x"><i class="xb">X</i><i class="ps">□</i></span>', 'EQUIP']);
    list.push(['y', 'READY'], ['back', 'BACK']);
    this.q.hints.innerHTML = hints(list);
  }
  renderCash(instant) {
    const target = this.p.cash;
    if (instant) { this.q.cv.textContent = money(target); this.cashShown = target; return; }
    const from = this.cashShown; this.cashShown = target;
    if (this._cashTw) this._cashTw();
    if (from === target) { this.q.cv.textContent = money(target); return; }
    const cls = target < from ? 'down' : 'up';
    this.q.cv.parentElement.classList.remove('down', 'up'); void this.q.cv.offsetWidth; this.q.cv.parentElement.classList.add(cls);
    this._cashTw = tween(from, target, 520, (v) => { this.q.cv.textContent = money(v); }, () => { this.q.cv.textContent = money(target); });
    const f = document.createElement('span'); f.className = `cfl ${cls}`; f.textContent = (target < from ? '-' : '+') + money(Math.abs(target - from));
    this.q.cf.appendChild(f); setTimeout(() => f.remove(), 1300);
  }

  // ---------------------------------------------------------------- updates from the integrator
  update(profile, extra) {
    const before = this.snap;
    this.p = profile;
    if (extra) this.extra = { ...this.extra, ...extra };
    const after = this.snapshot(profile);
    this.fresh = {};
    let bought = false;
    for (const k of Object.keys(after.up)) if ((after.up[k] || 0) > (before.up[k] || 0)) { this.fresh['up:' + k] = after.up[k] - 1; bought = true; }
    for (const id of after.trucks) if (!before.trucks.includes(id)) { this.fresh['truck:' + id] = true; bought = true; }
    for (const id of Object.keys(after.weapons)) {
      if (!before.weapons[id]) { this.fresh['weapon:' + id] = true; bought = true; continue; }
      for (const tr of WEAPON_TRACKS) if ((after.weapons[id][tr.id] || 0) > (before.weapons[id][tr.id] || 0)) { this.fresh[`trk:${id}:${tr.id}`] = after.weapons[id][tr.id] - 1; bought = true; }
    }
    this.snap = after;
    if (bought) this.ui.snd('upgrade_unlock');
    if (after.cash !== before.cash) this.renderCash(false);
    this.keepFocus(() => {
      // keep the truck selection following the active truck when it changed elsewhere
      this.renderHeader(); this.renderRail(); this.renderList(); this.renderDetail(); this.renderTag(); this.renderReady();
    });
    const nav = this.ui.nav;
    if (!nav.cur || !nav.cur.isConnected) nav.ensure();
    if (bought) this.flashNew();
  }
  flashNew() {
    this.el.querySelectorAll('.pips i.new').forEach((n) => { n.classList.remove('new'); void n.offsetWidth; n.classList.add('new'); });
    const d = this.q.det.querySelector('.d-lv'); if (d) { d.classList.remove('pulse'); void d.offsetWidth; d.classList.add('pulse'); }
    const row = this.el.querySelector('.row.sel'); if (row) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
  }

  // ---------------------------------------------------------------- interaction
  switchTab(id, opts = {}) {
    if (!TAB_IDS.includes(id) || id === this.tab) return;
    this.tab = id; this.trackPrev = null;
    this.renderRail(); this.renderList(); this.renderDetail(); this.renderHints();
    this.q.rows.scrollTop = 0;
    this.q.rows.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    const nav = this.ui.nav;
    if (opts.focusTab !== false) { const tabEl = this.el.querySelector(`[data-tab="${id}"]`); if (tabEl) nav.focus(tabEl, { silent: true }); }
  }
  tabStep(dir) {
    const nav = this.ui.nav, inRail = !nav.cur || !!nav.cur.dataset.tab;
    const i = (TAB_IDS.indexOf(this.tab) + dir + TAB_IDS.length) % TAB_IDS.length;
    this.ui.snd('click'); this.switchTab(TAB_IDS[i], { focusTab: inRail });
    if (!inRail) { const r = this.q.rows.querySelector('.row.sel, .sw.sel') || this.q.rows.querySelector('.f'); if (r) nav.focus(r, { silent: true }); }
  }
  select(id) {
    if (this.sel() === id) return;
    this.selId[this.tab] = id; this.trackPrev = null;
    this.q.rows.querySelectorAll('.row.sel, .sw.sel').forEach((n) => n.classList.remove('sel'));
    const n = this.q.rows.querySelector(`[data-row="${id}"]`); if (n) n.classList.add('sel');
    this.renderDetail();
  }
  onNavFocus(e) {
    const el = e.detail.el;
    if (el.dataset.row != null) { this.select(el.dataset.row); return; }
    if (el.dataset.trk) { if (this.trackPrev !== el.dataset.trk) { this.trackPrev = el.dataset.trk; this.refreshStatsOnly(); } return; }
    if (this.trackPrev) { this.trackPrev = null; this.refreshStatsOnly(); }
  }
  refreshStatsOnly() {
    if (this.tab !== 'weapons') return;
    const id = this.sel(), s = this.weaponState(id);
    const box = this.q.det.querySelector('.stats'); if (!box) return;
    box.innerHTML = weaponRows(this.p, id, s.owned ? this.trackPrev : null).map(statRow).join('');
    this.q.det.querySelectorAll('.trk').forEach((n) => n.classList.toggle('prev', n.dataset.trk === this.trackPrev));
  }
  onClick(e) {
    const t = e.target.closest('.f'); if (!t) return;
    const ui = this.ui, cb = this.cb;
    if (t.dataset.tab) { if (t.dataset.tab !== this.tab) this.switchTab(t.dataset.tab, { focusTab: false }); return; }
    if (t.dataset.row != null) {
      // select (hover already did); on pad/keyboard, confirm moves focus to the action button for a quick repeat-buy
      if (this.tab === 'paint') { this.applyPaint(); return; }
      if (ui.device() === 'pad' || e.detail === 0) { const b = this.q.foot.querySelector('.buy:not(.dis)') || this.q.det.querySelector('.slot, .trk'); if (b) ui.nav.focus(b); }
      return;
    }
    if (t.dataset.buy) return this.doBuy(t);
    if (t.dataset.select) { ui.snd('click'); cb.onSelectTruck && cb.onSelectTruck(this.sel()); return; }
    if (t.dataset.paint) return this.applyPaint(t);
    if (t.dataset.slot != null) { ui.snd('click'); const id = this.sel(); cb.onEquip && cb.onEquip(id, +t.dataset.slot); return; }
    if (t.dataset.trk) return this.doTrack(t);
    if (t.dataset.ready) return this.doReady();
  }
  applyPaint(btn) {
    if (String(this.p.truckColor) === this.sel()) return;
    this.ui.snd('click'); if (btn) this.ui.pressFx(btn);
    this.cb.onPaint && this.cb.onPaint(+this.sel());
  }
  denied(el, need) {
    this.ui.snd('error');
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    this.ui.toast(`NOT ENOUGH CASH — NEED ${money(need)} MORE`, 'bad', 2200);
  }
  burst(el) {
    const b = document.createElement('span'); b.className = 'burst';
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('i'), a = (i / 14) * Math.PI * 2 + Math.random() * 0.4, r = 70 + Math.random() * 90;
      s.style.setProperty('--dx', Math.cos(a) * r + 'px'); s.style.setProperty('--dy', Math.sin(a) * r * 0.7 - 20 + 'px'); s.style.setProperty('--d', (Math.random() * 60) + 'ms');
      b.appendChild(s);
    }
    el.appendChild(b); setTimeout(() => b.remove(), 800);
  }
  doBuy(btn) {
    const t = this.tab, id = this.sel();
    let state, cost, kind;
    if (t === 'truck') { const tr = TRUCKS.find((x) => x.id === id); state = this.truckState(tr).state; cost = tr.cost; kind = 'truck'; }
    else if (t === 'weapons') { const s = this.weaponState(id); state = s.state; cost = s.cost; kind = 'weapon'; }
    else { const s = this.upState(id); state = s.state; cost = s.cost; kind = 'upgrade'; }
    if (state === 'no') return this.denied(btn, cost - this.p.cash);
    if (state !== 'ok') return;
    this.ui.snd('buy'); this.ui.pressFx(btn); this.burst(btn);
    this.cb.onBuy && this.cb.onBuy(kind, id);
  }
  doTrack(btn) {
    const id = this.sel(), tr = btn.dataset.trk, s = this.trackState(id, tr);
    if (s.state === 'locked') { this.ui.snd('error'); btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake'); this.ui.toast('BUY THE WEAPON FIRST', 'warn', 1800); return; }
    if (s.state === 'max') { this.ui.snd('click'); return; }
    if (s.state === 'no') return this.denied(btn, s.cost - this.p.cash);
    this.ui.snd('buy'); this.ui.pressFx(btn); this.burst(btn);
    this.cb.onBuy && this.cb.onBuy('weaponTrack', id, tr);
  }
  doReady() {
    const btn = this.q.ready.querySelector('.ready');
    this.ui.snd(this.extra.solo ? 'go' : 'ready'); this.ui.pressFx(btn);
    this.cb.onReady && this.cb.onReady();
  }

  // ---------------------------------------------------------------- nav hooks
  initialFocus() { return this.q.rows.querySelector('.row.sel, .sw.sel') || this.q.rows.querySelector('.f'); }
  navOverride(el, dir) {
    const nav = this.ui.nav;
    const selRow = () => this.q.rows.querySelector('.row.sel, .sw.sel') || this.q.rows.querySelector('.f');
    const inDetail = this.q.det.contains(el) || this.q.foot.contains(el);
    if (el.dataset.tab && dir === 'right') return selRow();
    if (el.closest('.g-rows') && this.tab !== 'paint' && dir === 'left') return this.el.querySelector(`[data-tab="${this.tab}"]`);
    if (el.closest('.g-rows') && dir === 'right') {
      if (this.tab === 'paint') { const sws = [...this.q.rows.querySelectorAll('.sw')]; const i = sws.indexOf(el); if (i % 4 !== 3) return undefined; }
      return this.q.foot.querySelector('.buy:not(.dis)') || this.q.det.querySelector('.slot.on, .slot, .trk') || nav.list().find((n) => n.dataset.ready);
    }
    if (el.closest('.g-rows') && this.tab === 'paint' && dir === 'left') { const sws = [...this.q.rows.querySelectorAll('.sw')]; if (sws.indexOf(el) % 4 === 0) return this.el.querySelector(`[data-tab="${this.tab}"]`); }
    if (inDetail && dir === 'left') return selRow();
    if (el.dataset.ready && dir === 'up') return this.q.foot.querySelector('.buy:not(.dis)') || selRow();
    if (inDetail && dir === 'down' && el.closest('.d-foot')) return this.q.ready.querySelector('.ready');
    if (el.dataset.tab && dir === 'up' && el.dataset.tab === TAB_IDS[0]) return false;
    return undefined;
  }
  back() {
    const nav = this.ui.nav, cur = nav.cur;
    if (cur && (this.q.det.contains(cur) || this.q.foot.contains(cur) || this.q.ready.contains(cur))) { const r = this.q.rows.querySelector('.row.sel, .sw.sel'); if (r) { nav.focus(r); return true; } }
    if (cur && this.q.rows.contains(cur)) { const t = this.el.querySelector(`[data-tab="${this.tab}"]`); if (t) { nav.focus(t); return true; } }
    if (this.cb.onMenu) { this.cb.onMenu(); return true; }
    this.ui.snd('menu_open'); this.ui.showSettings();
    return true;
  }
  alt(name) {
    if (name === 'y') return this.doReady();
    if (name === 'start') { if (this.cb.onMenu) this.cb.onMenu(); else this.ui.showSettings(); return; }
    if (name === 'x' && this.tab === 'weapons') {
      const id = this.sel(), s = this.weaponState(id); if (!s.owned) return;
      const next = s.slot < 0 ? Math.min(2, this.p.loadout.length) : (s.slot + 1) % 3;
      this.ui.snd('click'); this.cb.onEquip && this.cb.onEquip(id, next);
    }
  }
  onKey(e, typing) {
    if (typing) return false;
    if (this.tab === 'weapons' && /^Digit[1-3]$/.test(e.code)) {
      const id = this.sel(); if (!this.weaponState(id).owned) { this.ui.snd('error'); return true; }
      this.ui.snd('click'); this.cb.onEquip && this.cb.onEquip(id, +e.code.slice(5) - 1); return true;
    }
    return false;
  }
}

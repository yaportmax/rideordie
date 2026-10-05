// GARAGE: tab strip TRUCK | UPGRADES | WEAPONS | GUNNER | PAINT, item list, detail + stat preview + buy, cash, equipped loadout,
// READY / START RUN. The integrator renders the 3D garage behind this transparent overlay (framing the subject inside frameRect()),
// calls ui.updateGarage(profile) after every purchase and gets cb.onView(tab, selectedId) to drive the 3D camera + live previews.
import { h, tween, pips, statRow } from '../comp.js';
import { esc, money, icon, weaponIcon, hints } from '../glyphs.js';
import { TRUCKS, UPGRADES, UPGRADE_BY_ID, WEAPON_TRACKS, WEAPON_TRACK_MAX, TRUCK_COLORS, effectiveUpgrades, upgradeLevel, upgradeLimit } from '../../data/upgrades.js';
import { VEHICLE_FAMILIES, familyOf, stagePurchaseAllowed } from '../../data/vehicle_families.js';
import { WEAPONS, WEAPON_ORDER } from '../../data/weapons.js';
import { upgradeStats, truckStats, weaponRows } from '../garage_stats.js';
import { formatDistance } from '../units.js';
import { seatSwapMarkup } from './garage_seats.js';
import { WEAPON_OPTICS, compatibleWeaponOptic, normalizeWeaponOptics } from '../../data/weapon_optics.js';
import { weaponOpticState } from '../../meta/weapon_optics.js';
import { TEN_LEVELS, campaignJourney, normalizeJourney, normalizeCampaignProgress } from '../../data/campaign.js';
import { vehicleUpgradePresentation } from '../../data/vehicle_upgrade_presentation.js';
import { weaponPurchaseState } from '../../meta/weapon_progression.js';
import { WEAPON_ATTACHMENTS, WEAPON_ATTACHMENT_ORDER, compatibleWeaponAttachment, sanitizeWeaponAttachmentIds, normalizeWeaponAttachments, equippedWeaponAttachments } from '../../data/weapon_attachments.js';
import { weaponAttachmentState } from '../../meta/weapon_attachments.js';
import { weaponTrackPurchaseState } from '../../meta/weapon_tuning.js';

export function garageJourneyStatus(profile, extra={}) {
  const journey=extra.journey?normalizeJourney(extra.journey):campaignJourney(profile), level=TEN_LEVELS[journey.level-1];
  const progress=normalizeCampaignProgress(profile?.campaignProgress);
  return {journey,label:journey.mode==='marathon'?'MARATHON · TEN WORLDS':journey.mode==='legacy'?'LEGACY HIGHWAY':`LEVEL ${level.number}/10 · ${level.name}`,boss:journey.mode==='marathon'?'FINALE · THE LEVIATHAN':journey.mode==='legacy'?'THE LEVIATHAN':level.bossName,unlockedLevel:progress.unlockedLevel};
}

const TABS = [
  { id: 'truck', name: 'VEHICLES', icon: 'truck' }, { id: 'upgrades', name: 'UPGRADES', icon: 'wrench' }, { id: 'weapons', name: 'WEAPONS', icon: 'gun' },
  { id: 'gunner', name: 'GUNNER', icon: 'gun' }, { id: 'paint', name: 'PAINT', icon: 'paint' },
];
const TAB_IDS = TABS.map((t) => t.id);
const PAINT_NAMES = ['DUST TAN', 'BRICK RED', 'STEEL BLUE', 'OLIVE DRAB', 'ASH BLACK', 'MUSTARD', 'PLUM', 'BONE'];
const MODE_NAME = { semi: 'SEMI-AUTO', auto: 'FULL-AUTO', pump: 'PUMP ACTION', bolt: 'BOLT ACTION', launcher: 'LAUNCHER' };
const COVERED_TUNING_HELP = 'Installed attachment already provides this benefit; remove it to tune.';
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const TAB_TITLE = { truck: 'CHOOSE YOUR RIDE', upgrades: 'VEHICLE UPGRADES', weapons: 'ARMORY', gunner: 'GUNNER GEAR', paint: 'PAINT SHOP' };
const WEAPON_PAGES = ['loadout', 'tuning', 'sights', 'attachments'];
const CHASSIS_PREFIX = 'chassis:';
const chassisID = id => typeof id === 'string' && id.startsWith(CHASSIS_PREFIX) ? id.slice(CHASSIS_PREFIX.length) : null;
const baseID = id => VEHICLE_FAMILIES[familyOf(id)].stageIDs[0];

/** Preview a purchase without modifying the campaign or its equipped kit. */
export function garageWeaponPreview(profile, id, { track = null, attachmentId = null } = {}) {
  const levels = Object.fromEntries(WEAPON_TRACKS.map(row => [row.id, profile.weapons?.[id]?.[row.id] || 0]));
  if (WEAPON_TRACKS.some(row => row.id === track) && profile.weapons?.[id] && weaponTrackPurchaseState(profile, id, track).reason !== 'covered') levels[track] = Math.min(WEAPON_TRACK_MAX, levels[track] + 1);
  const attachments = [...(equippedWeaponAttachments(profile)[id] || [])];
  if (compatibleWeaponAttachment(id, attachmentId) && !attachments.includes(attachmentId)) attachments.push(attachmentId);
  return Object.freeze({ levels: Object.freeze(levels), attachments: Object.freeze(sanitizeWeaponAttachmentIds(id, attachments)) });
}

/** A family card reopens its equipped build, or its highest owned build. Saved
 * inventories and the equipped chassis are never rewritten by presentation. */
export function garageFamilyVehicle(profile, familyBaseID) {
  const stages = VEHICLE_FAMILIES[familyOf(familyBaseID)].stageIDs;
  if (stages.includes(profile.truck)) return profile.truck;
  return [...stages].reverse().find(id => profile.trucks.includes(id)) || stages[0];
}

export function garageItems(profile, tab) {
  if (tab === 'truck') return Object.values(VEHICLE_FAMILIES).map(family => family.stageIDs[0]);
  if (tab === 'upgrades') return [...VEHICLE_FAMILIES[familyOf(profile.truck)].stageIDs.map(id => CHASSIS_PREFIX + id), ...UPGRADES.filter(u => u.role === 'driver').map(u => u.id)];
  if (tab === 'gunner') return UPGRADES.filter(u => u.role !== 'driver' && u.id !== 'vest').map(u => u.id);
  if (tab === 'weapons') return WEAPON_ORDER.slice();
  return TRUCK_COLORS.map((_, i) => String(i));
}

/** Accept old results/deep links while keeping every visible selection valid. */
export function garageInitialSelection(profile, extra = {}) {
  let tab = TAB_IDS.includes(extra.tab) ? extra.tab : 'truck';
  const selId = { truck: baseID(profile.truck), upgrades: CHASSIS_PREFIX + profile.truck, weapons: profile.loadout[0] || 'pistol', gunner: garageItems(profile, 'gunner')[0], paint: String(profile.truckColor) };
  if (extra.select != null) {
    const selected = String(extra.select), stage = TRUCKS.find(tr => tr.id === (chassisID(selected) || selected));
    if ((tab === 'truck' || tab === 'upgrades') && stage) {
      if (stage.tier > 1 && familyOf(stage.id) === familyOf(profile.truck)) { tab = 'upgrades'; selId.upgrades = CHASSIS_PREFIX + stage.id; }
      else if (tab === 'upgrades' && familyOf(stage.id) === familyOf(profile.truck)) selId.upgrades = CHASSIS_PREFIX + stage.id;
      else { tab = 'truck'; selId.truck = baseID(stage.id); }
    } else selId[tab] = selected;
  }
  for (const key of TAB_IDS) if (!garageItems(profile, key).includes(selId[key])) selId[key] = garageItems(profile, key)[0];
  return { tab, selId };
}

export class GarageScreen {
  constructor(ui, profile, cb, extra = {}) {
    this.ui = ui; this.cb = cb; this.kind = 'garage'; this.bg = 'garage';
    this.p = profile;
    this.extra = { solo: true, ready: false, isHost: true, partner: null, runNo: null, ...extra };
    Object.assign(this, garageInitialSelection(profile, extra));
    this.trackPrev = null; this.opticPrev = null; this.attachmentPrev = null; this.attachmentPreviewOnly = false; this.weaponPage = 'loadout';
    this.snap = this.snapshot(profile);
    this.fresh = {};
    this.cashShown = profile.cash;
    const kq = '<span class="hk"><kbd>Q</kbd></span><span class="hg"><span class="pb pb-bump"><i class="xb">LB</i><i class="ps">L1</i></span></span>';
    const ke = '<span class="hk"><kbd>E</kbd></span><span class="hg"><span class="pb pb-bump"><i class="xb">RB</i><i class="ps">R1</i></span></span>';
    this.el = h(`<div class="screen garage"><div class="safe">
      <div class="g-title stg" style="--i:0"><div class="eyebrow">UPGRADE &amp; REARM</div><h1>GARAGE</h1><div class="g-sub"></div></div>
      <div class="g-loadout stg" style="--i:1"></div>
      <div class="g-seat-panel stg" style="--i:1"></div>
      <div class="g-campaign stg" style="--i:1"></div>
      <div class="g-cash plate trans stg" style="--i:1"><span class="cl">CASH</span><span class="cv num"></span></div><span class="cf g-cf"></span>
      <div class="g-party stg" style="--i:2"></div>
      <div class="g-left stg" style="--i:2">
        <div class="g-tabs plate trans"><span class="tk">${kq}</span><div class="tabs"></div><span class="tk">${ke}</span></div>
        <div class="g-list plate trans"><div class="lhead"><h2></h2><span class="lcount"></span></div><div class="hazbar"></div><div class="scroll g-rows"></div><div class="more m-up"><i></i></div><div class="more m-down"><i></i><span></span></div></div>
      </div>
      <div class="g-detail plate trans stg" style="--i:4"><div class="d-content"></div><div class="d-foot"></div></div>
      <div class="g-ready stg" style="--i:6"></div>
      <div class="hints" data-hints></div>
    </div></div>`);
    const q = (s) => this.el.querySelector(s);
    this.q = { sub: q('.g-sub'), cv: q('.cv'), cf: q('.cf'), tabs: q('.tabs'), rows: q('.g-rows'), list: q('.g-list'), lhead: q('.lhead h2'), lcount: q('.lcount'), det: q('.d-content'), foot: q('.d-foot'), detail: q('.g-detail'), left: q('.g-left'), load: q('.g-loadout'), seats: q('.g-seat-panel'), party: q('.g-party'), ready: q('.g-ready'), hints: q('[data-hints]'), mdown: q('.m-down span') };
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('navfocus', (e) => this.onNavFocus(e));
    this.q.rows.addEventListener('scroll', () => this.updateMore(), { passive: true });
    this.q.campaign=q('.g-campaign');
    this.renderAll();
  }
  mounted() { requestAnimationFrame(() => { this.updateMore(); this.notifyView(); }); }
  onUnitsChange() { this.keepFocus(() => { this.renderHeader(); this.renderDetail(); }); }

  // ---------------------------------------------------------------- data helpers
  snapshot(p) {
    return { cash: p.cash, up: effectiveUpgrades(p), trucks: p.trucks.slice(), weapons: JSON.parse(JSON.stringify(p.weapons)), optics: normalizeWeaponOptics(p), attachments: normalizeWeaponAttachments(p), truck: p.truck };
  }
  items(tab = this.tab) { return garageItems(this.p, tab); }
  normalizeSelections() {
    if (!this.selId) return;
    for (const tab of TAB_IDS) {
      if (tab === 'truck') this.selId.truck = baseID(this.selId.truck);
      const ids = this.items(tab);
      if (!ids.includes(this.selId[tab])) this.selId[tab] = tab === 'upgrades' ? CHASSIS_PREFIX + this.p.truck : ids[0];
    }
  }
  selectedVehicle() { return this.tab === 'truck' ? garageFamilyVehicle(this.p, this.sel()) : chassisID(this.sel()); }
  familyState(id) {
    const tr = TRUCKS.find(tr => tr.id === garageFamilyVehicle(this.p, id)), s = this.truckState(tr);
    return { ...s, owned: s.owned || s.cur, tr };
  }
  sel() { return this.selId[this.tab]; }
  upState(id) {
    const u = vehicleUpgradePresentation(this.p, id);
    if (!u) return { u: null, lv: 0, max: 0, cost: null, state: 'max' };
    const lv = upgradeLevel(this.p, id), max = upgradeLimit(this.p, id);
    if (lv >= max) return { u, lv, max, cost: null, state: 'max' };
    const cost = u.costs[lv];
    return { u, lv, max, cost, state: this.p.cash >= cost ? 'ok' : 'no' };
  }
  truckState(t) {
    const owned = this.p.trucks.includes(t.id), cur = this.p.truck === t.id;
    return { owned, cur, cost: t.cost, state: cur ? 'active' : owned ? 'owned' : !stagePurchaseAllowed(this.p, t.id) ? 'locked' : this.p.cash >= t.cost ? 'ok' : 'no' };
  }
  weaponState(id) {
    const w = WEAPONS[id], purchase = weaponPurchaseState(this.p, id, this.extra?.weaponCareerLevel), owned = !!this.p.weapons[id];
    return { ...purchase, w, owned, cost: w.cost, slot: this.p.loadout.indexOf(id), state: owned ? 'owned' : purchase.reason === 'progress' ? 'locked' : purchase.ok ? 'ok' : 'no' };
  }
  trackState(id, tr) {
    const purchase = weaponTrackPurchaseState(this.p, id, tr);
    const state = purchase.ok ? 'ok' : purchase.reason === 'cash' ? 'no' : purchase.reason === 'max' ? 'max' : purchase.reason === 'covered' ? 'covered' : 'locked';
    return { ...purchase, lv: purchase.level ?? this.p.weapons?.[id]?.[tr] ?? 0, cost: purchase.cost ?? null, state };
  }
  selectedOptic(id = this.sel()) { return this.opticPrev || normalizeWeaponOptics(this.p)[id]?.equipped || 'standard'; }
  opticChoices(id) { return Object.values(WEAPON_OPTICS).filter(optic => compatibleWeaponOptic(id, optic.id)); }
  attachmentChoices(id) { return WEAPON_ATTACHMENT_ORDER.filter(attachment => compatibleWeaponAttachment(id, attachment)).map(attachment => WEAPON_ATTACHMENTS[attachment]); }
  selectedAttachment(id = this.sel()) { return this.attachmentChoices(id).some(row => row.id === this.attachmentPrev) ? this.attachmentPrev : this.attachmentChoices(id)[0]?.id || null; }
  weaponPreview(id = this.sel()) { return garageWeaponPreview(this.p, id, { track: this.previewTrack(), attachmentId: this.weaponPage === 'attachments' && this.attachmentPreviewOnly ? this.attachmentPrev : null }); }
  affordable(tab) {
    let n = 0;
    if (tab === 'truck') n = this.items(tab).filter(id => this.familyState(id).state === 'ok').length;
    else if (tab === 'upgrades' || tab === 'gunner') n = this.items(tab).filter(id => chassisID(id) ? this.truckState(TRUCKS.find(tr => tr.id === chassisID(id))).state === 'ok' : this.upState(id).state === 'ok').length;
    else if (tab === 'weapons') n = WEAPON_ORDER.filter((id) => this.weaponState(id).state === 'ok' || (this.p.weapons[id] && (WEAPON_TRACKS.some((t) => this.trackState(id, t.id).state === 'ok') || this.opticChoices(id).some(optic => { const s = weaponOpticState(this.p, id, optic.id); return s.ok && !s.owned && this.p.cash >= s.cost; }) || this.attachmentChoices(id).some(attachment => { const s = weaponAttachmentState(this.p, id, attachment.id); return s.ok && !s.owned && this.p.cash >= s.cost; })))).length;
    return n;
  }

  // ---------------------------------------------------------------- rendering
  renderAll() { this.renderHeader(); this.renderTabs(); this.renderList(); this.renderDetail(); this.renderLoadout(); this.renderReady(); this.renderHints(); this.renderCash(true); }
  keepFocus(fn) {
    const nav = this.ui.nav, k = nav.cur && this.el.contains(nav.cur) ? nav.cur.dataset.k : null;
    fn();
    if (!k) return;
    let n = this.el.querySelector(`[data-k="${k}"]`);
    if (!n || !nav.isFocusable(n)) n = k === 'buy' || /^(trk:|slot:|page:|optic|attachment)/.test(k) ? this.el.querySelector('.row.sel, .sw.sel') : null;
    if (n) nav.focus(n, { silent: true, reveal: false });
  }
  renderHeader() {
    const p = this.p, best = p.best || {};
    const parts = [], campaign=garageJourneyStatus(p,this.extra);
    if(campaign.journey.mode!=='legacy')parts.push(campaign.label);
    if (this.extra.runNo || p.runs != null) parts.push(`RUN #${this.extra.runNo || p.runs + 1}`);
    if (best.distance) parts.push(`BEST ${formatDistance(best.distance, this.ui.settings?.units)}`);
    if (best.kills) parts.push(`${best.kills} KILLS`);
    if (p.wins) parts.push(`${p.wins} VICTOR${p.wins > 1 ? 'IES' : 'Y'}`);
    this.q.sub.textContent = parts.join('  ·  ');
    if(this.q.campaign)this.q.campaign.innerHTML=`<div class="f btn campaign-choose" role="button" data-campaign="1" data-k="campaign"><span><b>${esc(campaign.label)}</b><small>${esc(campaign.boss)} · ${campaign.unlockedLevel}/10 LEVELS UNLOCKED</small><em>${this.extra.solo||this.extra.isHost?'CHOOSE LEVEL':'VIEW LEVELS · HOST CHOOSES'}</em></span></div>`;
  }
  renderTabs() {
    this.q.tabs.innerHTML = TABS.map((t) => {
      const n = this.affordable(t.id);
      return `<div class="f tab ${t.id === this.tab ? 'on' : ''}" role="button" data-tab="${t.id}" data-k="tab:${t.id}" data-snd="click">${icon(t.icon)}<span>${t.name}</span>${n ? `<i class="dot" title="${n} affordable">${n}</i>` : ''}</div>`;
    }).join('');
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
        const s = this.familyState(id);
        const family = VEHICLE_FAMILIES[familyOf(id)];
        const price = s.cur ? '<em class="chip on">ACTIVE</em>' : s.owned ? '<em class="chip">OWNED</em>' : `<span class="pc ${s.state}">${money(s.cost)}</span>`;
        return `<div class="f row trow family-row ${id === sel ? 'sel' : ''} st-${s.state}" role="button" data-row="${id}" data-k="row:${id}"><span class="ricon">${icon('truck')}</span><span class="rmain"><b class="rn">${esc(family.name)}</b><span class="rsub"><i class="lv">${esc(family.emphasis)}</i></span></span><span class="rprice">${price}</span></div>`;
      }).join('');
    } else if (t === 'weapons') {
      html = ids.map((id) => {
        const s = this.weaponState(id);
        const slot = s.slot >= 0 ? `<em class="slotb" title="Loadout slot ${s.slot + 1}">${s.slot + 1}</em>` : '';
        const price = s.owned ? '' : `<span class="pc ${s.state}">${money(s.cost)}</span>`;
        const lv = this.p.weapons[id] ? Object.values(this.p.weapons[id]).reduce((a, b) => a + b, 0) : 0;
        return `<div class="f row wrow ${id === sel ? 'sel' : ''} st-${s.owned ? 'owned' : s.state} ${s.owned ? '' : 'locked'}" role="button" data-row="${id}" data-k="row:${id}"><span class="wicon">${weaponIcon(id)}${s.owned ? '' : icon('lock', 'lk')}</span><span class="rmain"><b class="rn">${esc(s.w.name)}</b><span class="rsub"><i class="lv">${s.state === 'locked' ? `UNLOCK AT LEVEL ${s.unlockLevel}` : MODE_NAME[s.w.mode] || ''}</i>${s.owned ? `<i class="lv up">+${lv}</i>` : ''}</span></span>${slot}${price ? `<span class="rprice">${price}</span>` : ''}</div>`;
      }).join('');
    } else {
      html = ids.map((id) => {
        const stage = chassisID(id);
        if (stage) {
          const tr = TRUCKS.find(x => x.id === stage), s = this.truckState(tr);
          const price = s.cur ? '<em class="chip on">ACTIVE</em>' : s.owned ? '<em class="chip">OWNED</em>' : s.state === 'locked' ? '<em class="chip">LOCKED</em>' : `<span class="pc ${s.state}">${money(s.cost)}</span>`;
          const heading = id === ids[0] ? `<div class="g-list-sec">${esc(VEHICLE_FAMILIES[familyOf(this.p.truck)].name)} · CHASSIS</div>` : '';
          return heading + `<div class="f row chassis-row ${id === sel ? 'sel' : ''} st-${s.state}" role="button" data-row="${id}" data-k="row:${id}"><span class="rmain"><b class="rn">${esc(tr.name)}</b><span class="rsub"><i class="lv">${tr.tier === 1 ? 'STOCK CHASSIS' : 'CHASSIS BUILD'}</i>${this.fresh['truck:' + stage] ? '<i class="lv up">NEW</i>' : ''}</span></span><span class="rprice">${price}</span></div>`;
        }
        const s = this.upState(id);
        const shared = s.u.role === 'shared' ? '<i class="lv shared">SHARED</i>' : '';
        const price = s.state === 'max' ? '<em class="chip max">MAX</em>' : `<span class="pc ${s.state}">${money(s.cost)}</span>`;
        const heading = t === 'upgrades' && id === UPGRADES.find(u => u.role === 'driver').id ? '<div class="g-list-sec">PARTS &amp; EQUIPMENT</div>' : '';
        return heading + `<div class="f row ${id === sel ? 'sel' : ''} st-${s.state}" role="button" data-row="${id}" data-k="row:${id}"><span class="rmain"><b class="rn">${esc(s.u.name)}</b><span class="rsub">${pips(s.lv, s.max, this.fresh['up:' + id] ?? -1)}<i class="lv">LV ${s.lv}/${s.max}</i>${shared}</span></span><span class="rprice">${price}</span></div>`;
      }).join('');
    }
    this.q.rows.innerHTML = html;
    this.q.lcount.textContent = t === 'paint' ? `${ids.length} COLOURS` : t === 'weapons' ? `${WEAPON_ORDER.filter((id) => this.p.weapons[id]).length}/${WEAPON_ORDER.length} OWNED` : t === 'truck' ? `${ids.filter(id => this.familyState(id).owned).length}/${ids.length} OWNED` : t === 'upgrades' ? `${ids.length} OPTIONS` : `${ids.filter((id) => this.upState(id).state === 'max').length}/${ids.length} MAXED`;
    requestAnimationFrame(() => this.updateMore());
  }
  /** Scroll affordances on the item list: fades + "N MORE" when rows are hidden above / below. */
  updateMore() {
    const r = this.q.rows; if (!r.isConnected) return;
    const below = r.scrollHeight - r.scrollTop - r.clientHeight, above = r.scrollTop;
    this.q.list.classList.toggle('has-below', below > 6); this.q.list.classList.toggle('has-above', above > 6);
    if (below > 6) {
      const bottom = r.getBoundingClientRect().bottom;
      const n = [...r.querySelectorAll('.row, .sw')].filter((x) => x.getBoundingClientRect().top > bottom - 20).length;
      this.q.mdown.textContent = n > 0 ? `${n} MORE` : 'MORE';
    }
  }
  buyBtn(state, cost, label, extraCls = '') {
    const need = cost - this.p.cash;
    if (state === 'ok') return `<div class="f buy ok pressable ${extraCls}" role="button" data-buy="1" data-k="buy" data-snd="none"><span class="bl">${label}</span><span class="bp">${money(cost)}</span></div>`;
    if (state === 'no') return `<div class="f buy no ${extraCls}" role="button" data-buy="1" data-k="buy" data-snd="none"><span class="bl"><small>NOT ENOUGH CASH</small>NEED ${money(need)} MORE</span><span class="bp">${money(cost)}</span></div>`;
    if (state === 'max') return `<div class="f buy max dis ${extraCls}" role="button"><span class="bl">MAXED OUT</span></div>`;
    if (state === 'active') return `<div class="f buy max dis ${extraCls}" role="button"><span class="bl">${icon('check')} ACTIVE</span></div>`;
    if (state === 'select') return `<div class="f buy ok pressable ${extraCls}" role="button" data-select="1" data-k="buy" data-snd="none"><span class="bl">SELECT</span></div>`;
    return '';
  }
  previewTrack() {
    if (this.weaponPage !== 'tuning') return null;
    return WEAPON_TRACKS.some(track => track.id === this.trackPrev) ? this.trackPrev : WEAPON_TRACKS[0].id;
  }
  weaponStatRows(id) {
    const page = this.weaponPage || 'loadout';
    const track = this.previewTrack(), preview = this.p.weapons[id] && this.trackState(id, track).state !== 'covered' ? track : null;
    const labels = page === 'loadout' ? ['DAMAGE', 'FIRE RATE', 'MAGAZINE', 'RANGE'] : page === 'attachments' ? ['MAGAZINE', 'SPREAD', 'RECOIL'] : { dmg: ['DAMAGE'], mag: ['MAGAZINE'], rel: ['RELOAD'], hnd: ['SPREAD', 'RECOIL'] }[track] || [];
    return weaponRows(this.p, id, preview, page === 'attachments' && this.attachmentPrev && this.attachmentPreviewOnly ? this.weaponPreview(id).attachments : null).filter(row => labels.includes(row.label));
  }
  renderDetail() {
    const t = this.tab, id = this.sel(), d = this.q.det, foot = this.q.foot;
    let body = '', buy = '';
    if (t === 'truck' || (t === 'upgrades' && chassisID(id))) {
      const isFamily = t === 'truck', actualID = this.selectedVehicle();
      const tr = TRUCKS.find((x) => x.id === actualID) || TRUCKS[0], s = isFamily ? this.familyState(id) : this.truckState(tr);
      const family = VEHICLE_FAMILIES[familyOf(tr.id)], previous = TRUCKS.find(x => x.id === family.stageIDs[tr.tier - 2]);
      const base = TRUCKS.find(x => x.id === family.stageIDs[0]);
      const unlock = s.state === 'locked' ? `Requires ${previous?.name || 'the previous chassis'}.` : '';
      body = `<div class="d-head"><div class="eyebrow">${isFamily ? s.cur ? 'CURRENT VEHICLE' : s.owned ? 'OWNED VEHICLE' : 'UNLOCK VEHICLE' : `${esc(family.name)} · CHASSIS`}</div><h2>${esc(isFamily ? family.name : tr.name)}</h2></div>
        <p class="d-desc">${esc(isFamily ? base.blurb : tr.blurb)}</p>${isFamily ? `<p class="d-build">${esc(family.emphasis)}${s.owned ? `<br>BUILD: ${esc(tr.name)}` : ''}</p>${s.cur ? '<div class="f detail-link" role="button" data-open-upgrades="1" data-k="open-upgrades">CHASSIS &amp; PARTS &#8594;</div>' : '<p class="d-build">Select this vehicle to customize its chassis and parts in Upgrades.</p>'}` : `<p class="d-build">${unlock ? esc(unlock) : 'Your purchased parts stay with this vehicle.'}</p>`}<div class="d-sec">${s.cur ? 'STATS' : 'VS CURRENT BUILD'}</div><div class="stats">${truckStats(this.p, tr.id, this.ui.settings?.units).map(statRow).join('')}</div>`;
      buy = s.owned || s.cur ? this.buyBtn(s.cur ? 'active' : 'select', 0, 'SELECT') : s.state === 'locked' ? '<div class="buy max dis" role="button" aria-disabled="true"><span class="bl">PREVIOUS CHASSIS REQUIRED</span></div>' : this.buyBtn(s.state, tr.cost, isFamily ? 'UNLOCK VEHICLE' : 'BUY CHASSIS');
    } else if (t === 'weapons') {
      const w = WEAPONS[id], s = this.weaponState(id);
      const page = this.weaponPage || 'loadout';
      const pages = `<div class="detail-pages" role="group" aria-label="Weapon setup">${WEAPON_PAGES.map(name => `<div class="f detail-page ${page === name ? 'on' : ''}" role="button" aria-pressed="${page === name}" data-weapon-page="${name}" data-k="page:${name}">${name.toUpperCase()}</div>`).join('')}</div>`;
      const slots = s.owned ? `<div class="d-sec">LOADOUT SLOT</div><div class="slots">${[0, 1, 2].map((i) => { const occ = this.p.loadout[i]; return `<div class="f slot pressable ${s.slot === i ? 'on' : ''}" role="button" data-slot="${i}" data-k="slot:${i}"><b>${i + 1}</b><span>${occ ? esc(WEAPONS[occ].name) : 'EMPTY'}</span></div>`; }).join('')}</div>` : '';
      const tracks = `<div class="d-sec">WEAPON TUNING</div><div class="tracks ${s.owned ? '' : 'locked'}">${WEAPON_TRACKS.map((tr) => {
        const ts = this.trackState(id, tr.id);
        const covered = ts.state === 'covered';
        const price = ts.state === 'max' ? '<em class="chip max">MAX</em>' : covered ? '<em class="chip max">COVERED</em>' : ts.state === 'locked' ? icon('lock', 'lk') : `<span class="pc ${ts.state}">${money(ts.cost)}</span>`;
        return `<div class="${covered ? '' : 'f'} trk st-${ts.state} ${covered ? 'st-locked' : ''} ${this.previewTrack() === tr.id ? 'prev' : ''}" role="button"${covered ? ' aria-disabled="true"' : ''} data-trk="${tr.id}" data-k="trk:${tr.id}" data-snd="none"><b>${tr.name}</b><span class="tp">${price}</span>${pips(ts.lv, 3, this.fresh['trk:' + id + ':' + tr.id] ?? -1)}</div>`;
      }).join('')}</div>`;
      const chosenOptic = this.selectedOptic(id);
      const optics = `<div class="d-sec">CHOOSE SIGHT</div><div class="optic-choices">${this.opticChoices(id).map(optic => {
        const os = weaponOpticState(this.p, id, optic.id);
        const status = !s.owned ? 'BUY WEAPON FIRST' : os.equipped ? 'EQUIPPED' : os.owned ? 'OWNED' : money(os.cost);
        return `<div class="f optic-choice ${chosenOptic === optic.id ? 'sel' : ''}" role="button" data-optic="${optic.id}" data-k="optic:${optic.id}"><b>${esc(optic.name)}</b><span>${status}</span></div>`;
      }).join('')}</div><p class="optic-help">${esc(WEAPON_OPTICS[chosenOptic]?.desc || '')} Previewing a sight does not equip it.</p>`;
      const chosenAttachment = this.selectedAttachment(id), attachmentChoices = this.attachmentChoices(id);
      const chosenAttachmentState = weaponAttachmentState(this.p, id, chosenAttachment);
      const attachmentDescription = chosenAttachmentState.includedLegacy ? 'Your previously purchased magazine tier remains installed with its original capacity. This included part cannot be bought twice or removed.' : WEAPON_ATTACHMENTS[chosenAttachment]?.desc || '';
      const attachments = attachmentChoices.length ? `<div class="d-sec">PHYSICAL PARTS</div><div class="attachment-choices">${attachmentChoices.map(attachment => {
        const as = weaponAttachmentState(this.p, id, attachment.id);
        const status = !s.owned ? 'BUY WEAPON FIRST' : as.includedLegacy ? `LEGACY MAGAZINE LV ${as.legacyLevel} · INCLUDED` : as.equipped ? 'INSTALLED' : as.owned ? 'OWNED' : money(as.cost);
        return `<div class="f attachment-choice ${chosenAttachment === attachment.id ? 'sel' : ''}" role="button" data-attachment="${attachment.id}" data-k="attachment:${attachment.id}"><b>${esc(attachment.name)}</b><span>${status}</span></div>`;
      }).join('')}</div><p class="attachment-help">${esc(attachmentDescription)} Select a part to preview it; confirm to install.</p><div class="stats compact attachment-stats">${this.weaponStatRows(id).map(statRow).join('')}</div>` : '<p class="d-desc">This weapon has no compatible rail or magazine attachments.</p>';
      const unlock = !s.owned ? `<p class="weapon-unlock ${s.state === 'locked' ? 'locked' : ''}">${s.state === 'locked' ? `REACH LEVEL ${s.unlockLevel} TO UNLOCK` : `AVAILABLE FROM LEVEL ${s.unlockLevel}`} · ${money(s.cost)}</p>` : '';
      const tuningHelp = WEAPON_TRACKS.some(track => this.trackState(id, track.id).state === 'covered') ? COVERED_TUNING_HELP : 'Select a track to preview the next level. Confirm to purchase.';
      const tuningLabel = this.trackState(id, this.previewTrack()).state === 'covered' ? 'INSTALLED BENEFIT' : 'PREVIEW';
      const content = page === 'loadout' ? `<p class="d-desc">${esc(w.desc || '')}</p>${unlock}${slots}<div class="d-sec">STATS</div><div class="stats compact">${this.weaponStatRows(id).map(statRow).join('')}</div>` : page === 'tuning' ? `${tracks}<div class="d-sec">${WEAPON_TRACKS.find(track => track.id === this.previewTrack()).name} ${tuningLabel}</div><div class="stats compact">${this.weaponStatRows(id).map(statRow).join('')}</div><p class="optic-help">${esc(tuningHelp)}</p>` : page === 'sights' ? optics : attachments;
      body = `<div class="d-head"><div class="eyebrow">${MODE_NAME[w.mode] || 'WEAPON'}${s.slot >= 0 ? ` · SLOT ${s.slot + 1}` : s.owned ? ' · OWNED' : ''}</div><h2>${esc(w.name)}</h2></div>${pages}<div class="weapon-panel" data-panel="${page}">${content}</div>`;
      if (!s.owned) buy = s.state === 'locked' ? `<div class="buy max dis" role="button" aria-disabled="true"><span class="bl">UNLOCK AT LEVEL ${s.unlockLevel}</span><span class="bp">${money(s.cost)}</span></div>` : this.buyBtn(s.state, w.cost, 'BUY WEAPON');
      else if (page === 'sights') {
        const os = weaponOpticState(this.p, id, chosenOptic);
        if (os.equipped) buy = '<div class="buy max dis" role="button" aria-disabled="true"><span class="bl">SIGHT EQUIPPED</span></div>';
        else buy = `<div class="f buy ${os.owned || this.p.cash >= os.cost ? 'ok pressable' : 'no'}" role="button" data-optic-buy="${chosenOptic}" data-k="optic-buy" data-snd="none"><span class="bl">${os.owned ? 'EQUIP SIGHT' : this.p.cash >= os.cost ? 'BUY SIGHT' : 'NOT ENOUGH CASH'}</span><span class="bp">${os.owned ? 'FREE' : money(os.cost)}</span></div>`;
      } else if (page === 'attachments' && chosenAttachment) {
        const as = weaponAttachmentState(this.p, id, chosenAttachment), enough = as.owned || this.p.cash >= as.cost;
        buy = as.includedLegacy ? '<div class="buy max dis" role="button" aria-disabled="true"><span class="bl">LEGACY MAGAZINE INCLUDED</span></div>' : `<div class="f buy ${enough ? 'ok pressable' : 'no'}" role="button" data-attachment-buy="${chosenAttachment}" data-k="attachment-buy" data-snd="none"><span class="bl">${as.equipped ? 'REMOVE PART' : as.owned ? 'INSTALL PART' : enough ? 'BUY PART' : 'NOT ENOUGH CASH'}</span><span class="bp">${as.owned ? 'FREE' : money(as.cost)}</span></div>`;
      } else buy = `<div class="d-note">${page === 'loadout' ? 'CHOOSE A LOADOUT SLOT' : page === 'attachments' ? 'NO COMPATIBLE PARTS' : 'CONFIRM A TRACK TO UPGRADE'}</div>`;
    } else if (t === 'paint') {
      const i = +id;
      body = `<div class="d-head"><div class="eyebrow">PAINT SHOP</div><h2>${PAINT_NAMES[i] || 'COLOUR'}</h2></div>
        <div class="paint-big" style="--pc:${hex(TRUCK_COLORS[i])}"><i></i></div>
        <p class="d-desc">Fresh coat, no charge. Previewed on the truck. Your co-driver sees it too.</p>`;
      buy = String(this.p.truckColor) === id ? '<div class="f buy max dis" role="button"><span class="bl">' + icon('check') + ' APPLIED</span></div>' : '<div class="f buy ok pressable" role="button" data-paint="1" data-k="buy" data-snd="none"><span class="bl">APPLY PAINT</span><span class="bp">FREE</span></div>';
    } else {
      const s = this.upState(id);
      const rows = upgradeStats(this.p, id, this.ui.settings?.units);
      const role = s.u.role === 'driver' ? `${VEHICLE_FAMILIES[familyOf(this.p.truck)].name} UPGRADE` : s.u.role === 'gunner' ? 'GUNNER GEAR' : 'SHARED PERK';
      body = `<div class="d-head"><div class="eyebrow">${role}</div><h2>${esc(s.u.name)}</h2></div>
        <p class="d-desc">${esc(s.u.desc)}</p>
        <div class="d-lv"><span>LEVEL <b>${s.lv}</b> / ${s.max}</span>${pips(s.lv, s.max, this.fresh['up:' + id] ?? -1, 'big')}</div>
        <div class="d-sec">${s.state === 'max' ? 'CURRENT' : 'AFTER PURCHASE'}</div><div class="stats">${rows.map(statRow).join('')}</div>`;
      buy = this.buyBtn(s.state, s.cost, s.lv === 0 ? 'BUY' : 'UPGRADE');
    }
    d.innerHTML = body; foot.innerHTML = buy;
    this.q.detail.classList.toggle('nofoot', !buy);
    requestAnimationFrame(() => this.updateMore());
  }
  /** Always-visible loadout: equipped build, three weapons and consumables. */
  renderLoadout() {
    const p = this.p, spec = TRUCKS.find((x) => x.id === p.truck) || TRUCKS[0];
    const slots = [0, 1, 2].map((i) => {
      const id = p.loadout[i];
      return id ? `<div class="lo-slot"><b>${i + 1}</b><span class="lo-w">${weaponIcon(id)}</span><em>${esc(WEAPONS[id].name)}</em></div>` : `<div class="lo-slot empty"><b>${i + 1}</b><em>EMPTY</em></div>`;
    }).join('');
    const u = p.upgrades, perks = [['grenades', 'GRENADES'], ['medkit', 'MEDKITS']].map(([k, n]) => `<i>${n} <b>${u[k] || 0}</b></i>`).join('');
    this.q.load.innerHTML = `<div class="lo-slots"><span class="lo-k">EQUIPPED &middot; ${esc(spec.name)}</span><div class="lo-row">${slots}</div></div>
      <div class="lo-gear"><span class="lo-k">SUPPLIES</span><span class="lo-perks">${perks}</span></div>`;
  }
  renderReady() {
    const e = this.extra, pt = e.partner;
    let party = '';
    if (!e.solo) {
      if (pt && pt.connected !== false) party = `<div class="party ${pt.ready ? 'on' : ''}"><i></i><span>${esc((pt.role || 'PARTNER').toUpperCase())} &middot; ${esc(pt.name || '')}</span><b>${pt.ready ? 'READY' : 'NOT READY'}</b></div>`;
      else party = '<div class="party off"><i></i><span>WAITING FOR PLAYER&hellip;</span></div>';
    }
    const mode = garageJourneyStatus(this.p, e).journey.mode;
    const label = e.solo ? mode === 'campaign' ? 'START LEVEL' : mode === 'marathon' ? 'START MARATHON' : 'START RUN' : e.ready ? 'READY' : 'READY UP';
    this.q.seats.hidden = !!e.solo;
    this.q.seats.innerHTML = seatSwapMarkup({ solo: e.solo, ...e.seatSwap });
    this.q.party.innerHTML = party;
    const blocked = !e.solo && e.readyBlocked;
    const help = blocked ? e.seatSwap?.state?.pending ? 'RESOLVE SEAT SWAP FIRST' : 'WAITING FOR PARTNER IN GARAGE' : !e.solo && e.ready ? 'WAITING FOR PARTNER &middot; PRESS TO CANCEL' : '';
    this.q.ready.innerHTML = `<div class="${blocked ? 'dis' : 'f'} btn ready primary ${e.ready ? 'is-ready' : ''}" role="button" aria-disabled="${blocked}" data-ready="1" data-k="ready" data-snd="none"><span>${e.ready ? icon('check') : ''}${label}${help ? `<small>${help}</small>` : ''}</span></div>`;
  }
  renderHints() {
    const list = [['confirm', 'SELECT'], ['tabs', 'TAB']];
    if (this.tab === 'weapons') list.push(['<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>', '<span class="pb pb-x"><i class="xb">X</i><i class="ps">□</i></span>', 'EQUIP']);
    list.push(['<kbd class="mouse">DRAG</kbd>', '<span class="pb pb-stick"><i class="xb">RS</i><i class="ps">R</i></span>', 'SPIN'], ['y', this.extra.solo ? 'START' : 'READY'], ['back', 'BACK']);
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
  /** Screen-space rect (CSS px) left free for the 3D subject: between the list and detail columns, below the loadout bar. */
  frameRect() {
    const L = this.q.left.getBoundingClientRect(), D = this.q.detail.getBoundingClientRect(), B = (!this.q.seats.hidden && this.q.seats.firstElementChild ? this.q.seats : this.q.load).getBoundingClientRect();
    if (!L.width || !D.width) return null;
    return { l: L.right + 8, r: D.left - 8, t: L.top, b: B.top - 6 };
  }
  notifyView() {
    if (!this.cb.onView) return;
    // Reuse the integrator's existing chassis-preview path with actual IDs.
    const vehicle = this.selectedVehicle();
    if (this.tab === 'weapons') this.cb.onView(this.tab, this.sel(), this.selectedOptic(), this.weaponPreview());
    else this.cb.onView(vehicle ? 'truck' : this.tab, vehicle || this.sel(), undefined);
  }

  // ---------------------------------------------------------------- updates from the integrator
  update(profile, extra) {
    const before = this.snap;
    this.p = profile;
    this.normalizeSelections();
    if (extra) this.extra = { ...this.extra, ...extra };
    const after = this.snapshot(profile);
    this.fresh = {};
    let bought = false;
    for (const k of Object.keys(after.up)) {
      // Switching to another family's saved kit is not a new purchase.
      if (UPGRADE_BY_ID[k]?.role === 'driver' && familyOf(after.truck) !== familyOf(before.truck)) continue;
      if ((after.up[k] || 0) > (before.up[k] || 0)) { this.fresh['up:' + k] = after.up[k] - 1; bought = true; }
    }
    for (const id of after.trucks) if (!before.trucks.includes(id)) { this.fresh['truck:' + id] = true; bought = true; }
    for (const id of Object.keys(after.weapons)) {
      if (!before.weapons[id]) { this.fresh['weapon:' + id] = true; bought = true; continue; }
      for (const tr of WEAPON_TRACKS) if ((after.weapons[id][tr.id] || 0) > (before.weapons[id][tr.id] || 0)) { this.fresh[`trk:${id}:${tr.id}`] = after.weapons[id][tr.id] - 1; bought = true; }
    }
    for (const [id, row] of Object.entries(after.optics)) if (row.owned.some(optic => optic !== 'standard' && !before.optics?.[id]?.owned.includes(optic))) bought = true;
    for (const [id, row] of Object.entries(after.attachments)) {
      if (row.owned.some(attachment => !before.attachments?.[id]?.owned.includes(attachment))) bought = true;
      if (id === this.selId.weapons && JSON.stringify(row.equipped) !== JSON.stringify(before.attachments?.[id]?.equipped || [])) this.attachmentPreviewOnly = false;
    }
    this.snap = after;
    if (bought) this.ui.snd('upgrade_unlock');
    if (after.cash !== before.cash) this.renderCash(false);
    const st = this.q.rows.scrollTop;
    this.keepFocus(() => {
      this.renderHeader(); this.renderTabs(); this.renderList(); this.renderDetail(); this.renderLoadout(); this.renderReady(); this.renderHints();
    });
    this.q.rows.scrollTop = st;
    const nav = this.ui.nav;
    if (!nav.cur || !nav.cur.isConnected) nav.ensure();
    if (bought) this.flashNew();
    this.notifyView();
  }
  flashNew() {
    this.el.querySelectorAll('.pips i.new').forEach((n) => { n.classList.remove('new'); void n.offsetWidth; n.classList.add('new'); });
    const d = this.q.det.querySelector('.d-lv'); if (d) { d.classList.remove('pulse'); void d.offsetWidth; d.classList.add('pulse'); }
    const row = this.el.querySelector('.row.sel'); if (row) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
    const lo = this.q.load; lo.classList.remove('flash'); void lo.offsetWidth; lo.classList.add('flash');
  }

  // ---------------------------------------------------------------- interaction
  switchTab(id, opts = {}) {
    if (!TAB_IDS.includes(id) || id === this.tab) return;
    this.tab = id; this.trackPrev = null; this.opticPrev = null; this.attachmentPrev = null; this.attachmentPreviewOnly = false; this.weaponPage = 'loadout';
    this.normalizeSelections();
    this.renderTabs(); this.renderList(); this.renderDetail(); this.renderHints();
    this.q.rows.scrollTop = 0;
    this.q.rows.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    this.q.det.animate([{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
    const nav = this.ui.nav;
    if (opts.focusTab !== false) { const tabEl = this.el.querySelector(`[data-tab="${id}"]`); if (tabEl) nav.focus(tabEl, { silent: true }); }
    this.ui.snd('whoosh_transition');
    this.notifyView();
  }
  tabStep(dir) {
    const nav = this.ui.nav, inRail = !nav.cur || !!nav.cur.dataset.tab;
    const i = (TAB_IDS.indexOf(this.tab) + dir + TAB_IDS.length) % TAB_IDS.length;
    this.ui.snd('click'); this.switchTab(TAB_IDS[i], { focusTab: inRail });
    if (!inRail) { const r = this.q.rows.querySelector('.row.sel, .sw.sel') || this.q.rows.querySelector('.f'); if (r) nav.focus(r, { silent: true }); }
  }
  select(id) {
    if (!this.items().includes(id) || this.sel() === id) return;
    this.selId[this.tab] = id; this.trackPrev = null; this.opticPrev = null; this.attachmentPrev = null; this.attachmentPreviewOnly = false; this.weaponPage = 'loadout';
    this.q.rows.querySelectorAll('.row.sel, .sw.sel').forEach((n) => n.classList.remove('sel'));
    const n = this.q.rows.querySelector(`[data-row="${id}"]`); if (n) n.classList.add('sel');
    this.renderDetail();
    this.notifyView();
  }
  switchWeaponPage(page) {
    if (this.tab !== 'weapons' || !WEAPON_PAGES.includes(page) || this.weaponPage === page) return;
    this.weaponPage = page; this.trackPrev = page === 'tuning' ? WEAPON_TRACKS[0].id : null; this.opticPrev = null; this.attachmentPrev = null; this.attachmentPreviewOnly = false;
    this.keepFocus(() => this.renderDetail());
    this.notifyView();
  }
  onNavFocus(e) {
    const el = e.detail.el;
    if (el.dataset.row != null) { this.select(el.dataset.row); return; }
    // keyboard / pad focus on a tab switches to it (mouse hover only highlights; click switches)
    if (el.dataset.tab && !e.detail.hover && el.dataset.tab !== this.tab) { this.switchTab(el.dataset.tab, { focusTab: true }); return; }
    if (el.dataset.weaponPage) { if (!e.detail.hover) this.switchWeaponPage(el.dataset.weaponPage); return; }
    if (el.dataset.trk) { if (this.trackPrev !== el.dataset.trk) { this.trackPrev = el.dataset.trk; this.refreshStatsOnly(); } return; }
    if (el.dataset.optic) { this.selectOptic(el.dataset.optic); return; }
    if (el.dataset.attachment) { this.selectAttachment(el.dataset.attachment); return; }
    if (this.trackPrev && this.weaponPage !== 'tuning') { this.trackPrev = null; this.refreshStatsOnly(); }
  }
  refreshStatsOnly() {
    if (this.tab !== 'weapons') return;
    const id = this.sel();
    const box = this.q.det.querySelector('.stats'); if (!box) return;
    box.innerHTML = this.weaponStatRows(id).map(statRow).join('');
    const track = this.previewTrack(), sec = box.previousElementSibling;
    if (sec && sec.classList.contains('d-sec')) sec.textContent = track ? WEAPON_TRACKS.find(row => row.id === track).name + (this.trackState(id, track).state === 'covered' ? ' INSTALLED BENEFIT' : ' PREVIEW') : 'STATS';
    this.q.det.querySelectorAll('.trk').forEach((n) => n.classList.toggle('prev', n.dataset.trk === track));
    this.notifyView();
  }
  onClick(e) {
    const t = e.target.closest('.f'); if (!t) return;
    const ui = this.ui, cb = this.cb;
    if(t.dataset.campaign){ui.snd('click');cb.onCampaign?.();return;}
    if (t.dataset.weaponPage) {
      if (this.tab !== 'weapons' || !WEAPON_PAGES.includes(t.dataset.weaponPage)) return;
      this.switchWeaponPage(t.dataset.weaponPage);
      const page = this.q.det.querySelector(`[data-weapon-page="${this.weaponPage}"]`);
      if (page) ui.nav.focus(page, { silent: true, reveal: false });
      return;
    }
    if (t.dataset.openUpgrades) { this.selId.upgrades = CHASSIS_PREFIX + this.p.truck; this.switchTab('upgrades', { focusTab: false }); const row = this.initialFocus(); if (row) ui.nav.focus(row); return; }
    if (t.dataset.optic) return this.selectOptic(t.dataset.optic);
    if (t.dataset.opticBuy) return this.doOptic(t);
    if (t.dataset.attachment) return this.selectAttachment(t.dataset.attachment);
    if (t.dataset.attachmentBuy) return this.doAttachment(t);
    if (t.dataset.seatAction) { ui.snd('click'); cb.onSeatSwap?.(t.dataset.seatAction, t.dataset.proposal); return; }
    if (t.dataset.tab) { if (t.dataset.tab !== this.tab) this.switchTab(t.dataset.tab, { focusTab: true }); return; }
    if (t.dataset.row != null) {
      this.select(t.dataset.row);
      // select (hover already did); on pad/keyboard, confirm moves focus to the action button for a quick repeat-buy
      if (this.tab === 'paint') { this.applyPaint(); return; }
      if (ui.device() === 'pad' || e.detail === 0) { const b = this.q.foot.querySelector('.buy:not(.dis)') || this.q.det.querySelector('.detail-page.on, .detail-link, .slot, .trk'); if (b) ui.nav.focus(b); }
      return;
    }
    if (t.dataset.buy) return this.doBuy(t);
    if (t.dataset.select) { const id = this.selectedVehicle(); if (!id || !this.p.trucks.includes(id)) return; ui.snd('click'); ui.pressFx(t); cb.onSelectTruck && cb.onSelectTruck(id); return; }
    if (t.dataset.paint) return this.applyPaint(t);
    if (t.dataset.slot != null) { const id = this.sel(), slot = +t.dataset.slot; if (this.tab !== 'weapons' || !this.weaponState(id).owned || !Number.isInteger(slot) || slot < 0 || slot > 2) return; ui.snd('click'); cb.onEquip && cb.onEquip(id, slot); return; }
    if (t.dataset.trk) return this.doTrack(t);
    if (t.dataset.ready) return this.doReady();
  }
  applyPaint(btn) {
    if (String(this.p.truckColor) === this.sel()) return;
    this.ui.snd('click'); if (btn) this.ui.pressFx(btn);
    this.cb.onPaint && this.cb.onPaint(+this.sel());
  }
  selectOptic(opticId) {
    if (this.tab !== 'weapons' || !compatibleWeaponOptic(this.sel(), opticId) || this.selectedOptic() === opticId) return;
    this.opticPrev = opticId; this.keepFocus(() => this.renderDetail()); this.notifyView();
  }
  doOptic(btn) {
    const id = this.sel(), opticId = btn.dataset.opticBuy, s = weaponOpticState(this.p, id, opticId);
    if (this.tab !== 'weapons' || !s.ok || s.equipped) return;
    if (!s.owned && this.p.cash < s.cost) return this.denied(btn, s.cost - this.p.cash);
    this.ui.snd(s.owned ? 'click' : 'buy'); this.ui.pressFx(btn);
    this.cb.onBuy?.(s.owned ? 'equipWeaponOptic' : 'weaponOptic', id, opticId);
  }
  selectAttachment(attachmentId) {
    if (this.tab !== 'weapons' || this.weaponPage !== 'attachments' || !compatibleWeaponAttachment(this.sel(), attachmentId) || (this.attachmentPrev === attachmentId && this.attachmentPreviewOnly)) return;
    this.attachmentPrev = attachmentId; this.attachmentPreviewOnly = true; this.keepFocus(() => this.renderDetail()); this.notifyView();
  }
  doAttachment(btn) {
    const id = this.sel(), attachmentId = btn.dataset.attachmentBuy, s = weaponAttachmentState(this.p, id, attachmentId);
    if (this.tab !== 'weapons' || this.weaponPage !== 'attachments' || !s.ok || s.includedLegacy) return;
    if (!s.owned && this.p.cash < s.cost) return this.denied(btn, s.cost - this.p.cash);
    this.ui.snd(s.owned ? 'click' : 'buy'); this.ui.pressFx(btn);
    this.attachmentPrev = attachmentId; this.attachmentPreviewOnly = false;
    this.cb.onBuy?.(s.owned ? 'equipWeaponAttachment' : 'weaponAttachment', id, { id: attachmentId, enabled: !s.equipped });
  }
  denied(el, need) {
    this.ui.snd('error');
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    const c = this.q.cv.parentElement; c.classList.remove('deny'); void c.offsetWidth; c.classList.add('deny');
    this.ui.toast(`NOT ENOUGH CASH - NEED ${money(need)} MORE`, 'bad', 2200);
  }
  burst(el) {
    const b = document.createElement('span'); b.className = 'burst';
    for (let i = 0; i < 18; i++) {
      const s = document.createElement('i'), a = (i / 18) * Math.PI * 2 + Math.random() * 0.4, r = 80 + Math.random() * 110;
      s.style.setProperty('--dx', Math.cos(a) * r + 'px'); s.style.setProperty('--dy', Math.sin(a) * r * 0.7 - 20 + 'px'); s.style.setProperty('--d', (Math.random() * 60) + 'ms');
      b.appendChild(s);
    }
    el.appendChild(b); setTimeout(() => b.remove(), 800);
    const f = document.createElement('span'); f.className = 'bflash'; el.appendChild(f); setTimeout(() => f.remove(), 500);
  }
  doBuy(btn) {
    const t = this.tab;
    let id = this.sel();
    let state, cost, kind;
    if (t === 'truck' || (t === 'upgrades' && chassisID(id))) { id = this.selectedVehicle(); const tr = TRUCKS.find((x) => x.id === id); if (!tr) return; state = this.truckState(tr).state; cost = tr.cost; kind = 'truck'; }
    else if (t === 'weapons') { const s = this.weaponState(id); state = s.state; cost = s.cost; kind = 'weapon'; }
    else { if (!this.items().includes(id) || !UPGRADE_BY_ID[id]) return; const s = this.upState(id); state = s.state; cost = s.cost; kind = 'upgrade'; }
    if (state === 'no') return this.denied(btn, cost - this.p.cash);
    if (state !== 'ok') return;
    this.ui.snd('buy'); this.ui.pressFx(btn); this.burst(btn);
    this.cb.onBuy && this.cb.onBuy(kind, id);
  }
  doTrack(btn) {
    const id = this.sel(), tr = btn.dataset.trk;
    if (this.tab !== 'weapons' || !WEAPONS[id] || !WEAPON_TRACKS.some(track => track.id === tr)) return;
    const s = this.trackState(id, tr);
    if (s.state === 'locked') { this.ui.snd('error'); btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake'); this.ui.toast('BUY THE WEAPON FIRST', 'warn', 1800); return; }
    if (s.state === 'max') { this.ui.snd('click'); return; }
    if (s.state === 'covered') { this.ui.snd('error'); this.ui.toast(COVERED_TUNING_HELP, 'warn', 2200); return; }
    if (s.state === 'no') return this.denied(btn, s.cost - this.p.cash);
    if (s.state !== 'ok') return;
    this.ui.snd('buy'); this.ui.pressFx(btn); this.burst(btn);
    this.cb.onBuy && this.cb.onBuy('weaponTrack', id, tr);
  }
  doReady() {
    if (!this.extra.solo && this.extra.readyBlocked) return;
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
    const inRows = !!el.closest('.g-rows');
    if (el.dataset.weaponPage) {
      const pages = [...this.q.det.querySelectorAll('.detail-page')], i = pages.indexOf(el);
      if (dir === 'left') return i > 0 ? pages[i - 1] : selRow();
      if (dir === 'right') return i < pages.length - 1 ? pages[i + 1] : false;
      if (dir === 'up') return false;
      if (dir === 'down') return this.q.det.querySelector('.slot.on, .slot, .trk.f, .optic-choice.sel, .optic-choice, .attachment-choice.sel, .attachment-choice') || this.q.foot.querySelector('.buy:not(.dis)') || this.q.ready.querySelector('.f') || false;
    }
    if (el.dataset.seatAction && dir === 'up') return selRow();
    if (el.dataset.seatAction && dir === 'down') return this.q.ready.querySelector('.f') || selRow();
    if (el.dataset.ready && dir === 'left') return this.q.seats.querySelector('.f') || selRow();
    if (el.dataset.tab && dir === 'down') return selRow();
    if (el.dataset.tab && dir === 'up') return false;
    if (el.dataset.tab && dir === 'right' && el.dataset.tab === TAB_IDS[TAB_IDS.length - 1]) return false;
    if (inRows && dir === 'up') {
      if (this.tab === 'paint') { const sws = [...this.q.rows.querySelectorAll('.sw')]; if (sws.indexOf(el) >= 4) return undefined; }
      else { const rows = [...this.q.rows.querySelectorAll('.row')]; if (rows.indexOf(el) > 0) return rows[rows.indexOf(el) - 1]; }
      return this.el.querySelector(`[data-tab="${this.tab}"]`);
    }
    if (inRows && dir === 'down' && this.tab !== 'paint') { const rows = [...this.q.rows.querySelectorAll('.row')]; const i = rows.indexOf(el); return i < rows.length - 1 ? rows[i + 1] : false; }
    if (inRows && dir === 'right') {
      if (this.tab === 'paint') { const sws = [...this.q.rows.querySelectorAll('.sw')]; const i = sws.indexOf(el); if (i % 4 !== 3) return undefined; }
      return this.q.foot.querySelector('.buy:not(.dis)') || this.q.det.querySelector('.detail-page.on, .detail-link, .slot.on, .slot, .trk.f') || nav.list().find((n) => n.dataset.ready);
    }
    if (inRows && dir === 'left') { if (this.tab === 'paint') { const sws = [...this.q.rows.querySelectorAll('.sw')]; if (sws.indexOf(el) % 4 !== 0) return undefined; } return false; }
    if (inDetail && dir === 'left') {
      if (el.dataset.slot != null && +el.dataset.slot > 0) return undefined;
      if (el.dataset.trk) { const tracks = [...this.q.det.querySelectorAll('.trk')]; if (tracks.indexOf(el) % 2 === 1 && tracks[tracks.indexOf(el) - 1]?.classList.contains('f')) return tracks[tracks.indexOf(el) - 1]; }
      if (el.dataset.optic) { const sights = [...this.q.det.querySelectorAll('.optic-choice')]; if (sights.indexOf(el) % 2 === 1) return sights[sights.indexOf(el) - 1]; }
      if (el.dataset.attachment) { const parts = [...this.q.det.querySelectorAll('.attachment-choice')]; if (parts.indexOf(el) % 2 === 1) return parts[parts.indexOf(el) - 1]; }
      return selRow();
    }
    if (inDetail && dir === 'up' && this.tab === 'weapons' && !el.closest('.d-foot')) {
      const controls = [...this.q.det.querySelectorAll('.slot, .trk, .optic-choice, .attachment-choice')];
      const firstRow = el.dataset.trk || el.dataset.optic || el.dataset.attachment ? controls.indexOf(el) < 2 : controls.indexOf(el) < 3;
      if (firstRow) return this.q.det.querySelector('.detail-page.on');
    }
    if (el.dataset.ready && dir === 'up') return this.q.foot.querySelector('.buy:not(.dis)') || this.q.det.querySelector('.trk.f:last-child, .slot, .optic-choice.sel, .attachment-choice.sel, .detail-page.on, .detail-link') || selRow();
    if (el.dataset.ready && dir === 'left') return selRow();
    if (inDetail && dir === 'down' && el.closest('.d-foot')) return this.q.ready.querySelector('.ready');
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

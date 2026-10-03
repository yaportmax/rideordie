import { h } from '../comp.js';
import { caps, esc, hints, pad } from '../glyphs.js';
import { TEN_LEVELS, normalizeCampaignProgress } from '../../data/campaign.js';

// Map positions are presentation only. Level identity and unlocks come from the
// existing campaign catalogue and normalized save, including host authority.
const MAP_POINTS = Object.freeze(TEN_LEVELS.map((level, index) => {
  const row = index < 5 ? 1 : 2, column = row === 1 ? index + 1 : 10 - index;
  // The 470px board contains two 208px rows, a 30px gap and 12px padding.
  // Match the connector endpoints to the actual card centers in that board.
  return Object.freeze({ column, row, x: column * 200 - 100, y: row === 1 ? 116 : 354 });
}));
const WORLD_SCENES = Object.freeze({
  desert: '<circle class="map-sun" cx="126" cy="28" r="15"/><path class="map-land" d="M0 85Q40 31 86 76Q130 37 180 86V112H0Z"/><path class="map-landmark" d="M33 90V43h9v17h10V49h8v22H42v19Z"/>',
  canyon: '<path class="map-land" d="M0 18H54L65 46L48 63L61 112H0ZM180 8H132L115 38L130 59L112 112H180Z"/><path class="map-landmark" d="M9 45H47M7 72H44M137 35H175M139 63H179"/>',
  coast: '<circle class="map-sun" cx="132" cy="29" r="12"/><path class="map-land" d="M0 80L37 70L58 85L77 112H0Z"/><path class="map-landmark" d="M28 76L34 31H44L51 79ZM30 32H48L39 20ZM70 82q14-11 28 0t28 0t28 0t28 0M84 101q14-11 28 0t28 0t28 0"/>',
  mountain: '<path class="map-land" d="M0 109L48 22L91 93L125 12L180 110Z"/><path class="map-landmark" d="M34 48L48 22L63 48L48 42ZM109 43L125 12L144 48L125 39Z"/>',
  city: '<path class="map-land" d="M0 112V48H28V64H40V19H62V8H78V59H94V39H118V63H131V28H156V48H180V112Z"/><path class="map-landmark" d="M49 35H68M49 49H68M139 44H149M139 57H149M102 54H112"/>',
  dam: '<path class="map-land" d="M0 94L30 65L58 87L86 49L115 77L149 50L180 83V112H0Z"/><path class="map-landmark" d="M36 53H144L131 108H48ZM63 66V101M89 66V101M115 66V101M30 52H150"/>',
  underground: '<path class="map-land" d="M0 0H180V37L160 25L146 54L128 28L99 44L80 20L63 47L41 23L20 40L0 30ZM0 112V91L23 81L49 96L74 79L102 94L132 78L155 91L180 81V112Z"/><path class="map-landmark" d="M47 91V64a42 42 0 0 1 84 0v27M64 89V65a25 25 0 0 1 50 0v24"/>',
  sky: '<path class="map-land" d="M0 84Q16 56 40 72Q64 35 88 67Q118 48 137 74Q165 55 180 82V112H0Z"/><path class="map-landmark" d="M16 46H163M42 46V108M136 46V108M39 26H46V46M132 21H139V46M45 29L135 24"/>',
  hell: '<path class="map-land" d="M0 112L18 76L43 94L89 20L123 84L145 62L180 104V112Z"/><path class="map-landmark" d="M79 43L90 30L103 52L92 62L108 77L96 96L105 112M32 112L44 100L52 112M131 112L144 99L155 112"/>',
  space: '<circle class="map-planet" cx="116" cy="51" r="28"/><ellipse class="map-landmark" cx="116" cy="51" rx="49" ry="10" transform="rotate(-21 116 51)"/><path class="map-landmark" d="M18 23h9m-4-4v8M49 48h7m-3-3v6M157 18h9m-4-4v8M65 16h3M26 76h3M154 90h3"/><path class="map-land" d="M0 112L32 91L59 104L75 92L100 112Z"/>',
});

export function campaignMapState(profile) {
  const progress = normalizeCampaignProgress(profile?.campaignProgress);
  const complete = progress.cleared.length === TEN_LEVELS.length;
  return {
    progress, complete, clearedCount: progress.cleared.length,
    nextLevel: complete ? null : TEN_LEVELS[progress.unlockedLevel - 1],
    nodes: TEN_LEVELS.map((level, index) => ({
      ...level, ...MAP_POINTS[index],
      locked: level.number > progress.unlockedLevel,
      cleared: progress.cleared.includes(level.number),
      current: progress.selectedMode === 'campaign' && level.number === progress.selectedLevel,
      frontier: !complete && level.number === progress.unlockedLevel,
    })),
  };
}

function worldScene(id) {
  return `<svg class="campaign-world-scene" viewBox="0 0 180 112" aria-hidden="true"><path class="map-road" d="M65 112L83 70H96L117 112Z"/>${WORLD_SCENES[id] || ''}</svg>`;
}
function worldDetailMarkup(profile, { level, mode, canSelect = true } = {}) {
  const p = normalizeCampaignProgress(profile?.campaignProgress);
  if ((mode || p.selectedMode) === 'marathon') {
    return '<div><span class="campaign-detail-label">CONTINUOUS ROUTE</span><b>MARATHON · ALL TEN WORLDS</b></div><p>One continuous road through every cleared world.</p>';
  }
  const item = TEN_LEVELS[(level || p.selectedLevel) - 1];
  if (!item) return '';
  const status = item.number > p.unlockedLevel ? 'LOCKED WORLD' : p.cleared.includes(item.number) ? canSelect ? 'CLEARED · REPLAY AVAILABLE' : 'CLEARED WORLD' : 'NEXT WORLD';
  return `<div><span class="campaign-detail-label">${esc(status)}</span><b>LEVEL ${item.number} · ${esc(item.name)}</b></div><p><span>BOSS</span> ${esc(item.bossName)}${canSelect ? '' : '<small>The host chooses the route.</small>'}</p>`;
}

/** Garage overlay. Selection is a callback; App/Session own authority/save flow. */
export function campaignSelectionMarkup(profile, { canSelect = true } = {}) {
  const map = campaignMapState(profile), p = map.progress, selected = p.selectedMode;
  const links = map.nodes.slice(0, -1).map((node, index) => {
    const next = map.nodes[index + 1], cleared = node.number < p.unlockedLevel;
    const path = node.row === next.row ? `M${node.x} ${node.y}H${next.x}` : `M${node.x} ${node.y}C${node.x + 70} ${node.y} ${next.x + 70} ${next.y} ${next.x} ${next.y}`;
    return `<path class="campaign-route-link ${cleared ? 'cleared' : ''}" data-from="${node.number}" data-to="${next.number}" d="${path}"/>`;
  }).join('');
  const cards = map.nodes.map(level => {
    const { locked, cleared, current, frontier } = level, enabled = canSelect && !locked;
    const status = locked ? 'LOCKED' : cleared ? 'CLEARED' : current ? 'SELECTED' : frontier ? 'NEXT WORLD' : 'READY';
    return `<div class="campaign-card ${enabled ? 'f' : ''} ${locked ? 'locked' : ''} ${cleared ? 'cleared' : ''} ${current ? 'selected' : ''} ${frontier ? 'frontier' : ''}" ${enabled ? 'role="button"' : 'aria-disabled="true"'} ${current ? 'aria-current="step"' : ''} aria-label="${esc(`Level ${level.number}, ${level.name}, ${level.bossName}, ${status}`)}" data-level="${level.number}" data-mode="campaign" data-theme="${level.id}" data-k="campaign:${level.number}" style="--map-column:${level.column};--map-row:${level.row}"><div class="campaign-world">${worldScene(level.id)}<span class="campaign-number">${String(level.number).padStart(2, '0')}</span>${cleared ? '<span class="campaign-clear-mark" aria-hidden="true">✓</span>' : ''}</div><div class="campaign-card-label"><b>${esc(level.name)}</b><small>${esc(level.bossName)}</small></div><span class="campaign-status">${status}</span></div>`;
  }).join('');
  const marathonEnabled = canSelect && p.marathonUnlocked;
  const next = map.complete ? 'ALL TEN WORLDS CLEARED' : `NEXT · ${map.nextLevel.name}`;
  return `<div class="campaign-progress"><div><b>${map.clearedCount}<span>/10</span></b><span>WORLDS CLEARED</span></div><div class="campaign-progress-track" role="progressbar" aria-label="Campaign worlds cleared" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${map.clearedCount}"><i style="width:${map.clearedCount * 10}%"></i></div><strong>${esc(next)}</strong></div><div class="campaign-map"><svg class="campaign-route" viewBox="0 0 1000 470" preserveAspectRatio="none" aria-hidden="true">${links}</svg><div class="campaign-grid">${cards}</div></div><div class="campaign-map-footer"><div class="campaign-legend"><span><i class="cleared"></i>CLEARED</span><span><i class="frontier"></i>NEXT WORLD</span><span><i class="locked"></i>LOCKED</span></div><span>DESERT TO THE VOID · TEN WORLDS, ONE CREW</span></div><div class="campaign-map-preview" aria-live="polite">${worldDetailMarkup(profile, { canSelect })}</div><div class="campaign-marathon ${marathonEnabled ? 'f' : ''} ${selected === 'marathon' ? 'selected' : ''}" ${marathonEnabled ? 'role="button"' : 'aria-disabled="true"'} data-level="1" data-mode="marathon" data-k="campaign:marathon"><b>MARATHON</b><span>${p.marathonUnlocked ? 'All ten worlds in one continuous run.' : 'Clear all ten campaign levels to unlock Marathon.'}</span></div><p class="campaign-authority">${canSelect ? 'Your equipment and cash carry across levels.' : 'The host chooses the next level. Your personal cash stays yours.'}</p>`;
}

export class CampaignScreen {
  constructor(ui, profile, cb = {}, extra = {}) {
    this.ui = ui; this.cb = cb; this.kind = 'campaign'; this.bg = 'dim'; this.extra = extra; this.profile = profile;
    this.el = h('<div class="screen campaign"><div class="safe campaign-safe"><div class="campaign-heading"><div class="eyebrow">CHOOSE YOUR NEXT ROAD</div><h1>CAMPAIGN MAP</h1></div><div class="campaign-body"></div><div class="f btn campaign-back" role="button" data-act="back" data-k="campaign:back"><span>BACK TO GARAGE</span></div><div class="hints" data-hints></div></div></div>');
    this.el.addEventListener('click', event => this.onClick(event));
    this.el.addEventListener('navfocus', event => this.preview(event.target));
    this.render();
  }
  render() { this.el.querySelector('.campaign-body').innerHTML = campaignSelectionMarkup(this.profile, this.extra); this.el.querySelector('[data-hints]').innerHTML = hints([[caps(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']), pad('DPAD'), 'CHOOSE WORLD'], ['confirm', 'SELECT'], ['back', 'GARAGE']]); }
  update(profile, extra = {}) {
    const focused = this.ui.nav.cur, key = focused && this.el.contains(focused) ? focused.dataset.k : null;
    this.profile = profile; this.extra = { ...this.extra, ...extra }; this.render();
    // Remote profile updates replace the cards. Keep the browsed world focused,
    // unless host authority or normalized unlocks now make that world read-only.
    const preferred = key ? [...this.el.querySelectorAll('.f')].find(el => el.dataset.k === key) : null;
    this.ui.nav.ensure(preferred);
  }
  preview(target) {
    if (!target?.dataset?.mode) return;
    const level = Number(target.dataset.level), mode = target.dataset.mode;
    if (!Number.isInteger(level) || level < 1 || level > TEN_LEVELS.length || !['campaign', 'marathon'].includes(mode)) return;
    this.el.querySelector('.campaign-map-preview').innerHTML = worldDetailMarkup(this.profile, { level, mode, canSelect: this.extra.canSelect !== false });
  }
  onClick(event) {
    const target = event.target.closest('.f'); if (!target || !this.el.contains(target)) return;
    if (target.dataset.act === 'back') return this.back();
    const level = Number(target.dataset.level), mode = target.dataset.mode, p = normalizeCampaignProgress(this.profile?.campaignProgress);
    if (this.extra.canSelect === false || !Number.isInteger(level) || level < 1 || level > p.unlockedLevel || (mode === 'marathon' && !p.marathonUnlocked) || !['campaign', 'marathon'].includes(mode)) return;
    this.ui.snd('click'); this.cb.onSelect?.(level, mode);
  }
  initialFocus() { return this.el.querySelector('.campaign-card.selected.f') || this.el.querySelector('.campaign-marathon.selected.f') || this.el.querySelector('.campaign-card.f') || this.el.querySelector('[data-act="back"]'); }
  navOverride(target, direction) {
    const back = this.el.querySelector('[data-act="back"]'), marathon = this.el.querySelector('.campaign-marathon.f');
    if (target.dataset.act === 'back') return direction === 'up' ? marathon || this.el.querySelector('.campaign-card.selected.f') || this.el.querySelector('.campaign-card.f') || false : false;
    if (target.dataset.mode === 'marathon') return direction === 'down' ? back : direction === 'up' ? this.el.querySelector('.campaign-card.selected.f') || this.el.querySelector('.campaign-card[data-level="10"].f') || false : false;
    const nodes = campaignMapState(this.profile).nodes, current = nodes.find(node => node.number === Number(target.dataset.level));
    if (!current || this.extra.canSelect === false) return false;
    let options = nodes.filter(node => !node.locked && node.number !== current.number);
    if (direction === 'left' || direction === 'right') {
      options = options.filter(node => node.row === current.row && (direction === 'left' ? node.column < current.column : node.column > current.column));
      options.sort((a, b) => Math.abs(a.column - current.column) - Math.abs(b.column - current.column));
    } else if (direction === 'up' || direction === 'down') {
      options = options.filter(node => direction === 'up' ? node.row < current.row : node.row > current.row);
      options.sort((a, b) => Math.abs(a.column - current.column) - Math.abs(b.column - current.column) || a.number - b.number);
    } else return false;
    if (options.length) return this.el.querySelector(`.campaign-card[data-level="${options[0].number}"].f`);
    return direction === 'down' ? marathon || back : false;
  }
  tabStep(direction) {
    // Q/E, Tab and controller bumpers follow chapter order, including the snake
    // row where physical left/right point the opposite way along the journey.
    const choices = [...this.el.querySelectorAll('.campaign-card.f, .campaign-marathon.f, .campaign-back.f')];
    if (!choices.length) return;
    const index = choices.indexOf(this.ui.nav.cur), step = direction < 0 ? -1 : 1;
    this.ui.nav.focus(choices[index < 0 ? step > 0 ? 0 : choices.length - 1 : (index + step + choices.length) % choices.length]);
  }
  selection() { const p = normalizeCampaignProgress(this.profile?.campaignProgress); return { level: p.selectedLevel, mode: p.selectedMode, unlockedLevel: p.unlockedLevel, marathonUnlocked: p.marathonUnlocked, canSelect: this.extra.canSelect !== false }; }
  back() { this.ui.snd('menu_close'); if (this.cb.onBack) this.cb.onBack(); else this.ui._pop(); return true; }
}

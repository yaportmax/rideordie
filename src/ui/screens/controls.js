// CONTROLS: keyboard + mouse table (live from Input.bindings) and a gamepad diagram, for DRIVER, GUNNER and SOLO.
import { h } from '../comp.js';
import { icon, hints, cap, pad } from '../glyphs.js';

const ROLES = [
  { id: 'driver', name: 'DRIVER', icon: 'wheel', blurb: 'You steer, drift and burn nitro. Keep the truck alive and give your gunner clean shots.' },
  { id: 'gunner', name: 'GUNNER', icon: 'crosshair', blurb: 'You ride in the bed. Aim with the mouse or right stick, shoot drivers, tyres and fuel tanks.' },
  { id: 'solo', name: 'SOLO', icon: 'kbm', blurb: 'Practice mode: one player drives with WASD and aims and shoots with the mouse.' },
];

// keyboard rows: [label, [action names or literal codes], note]. Literals start with a capital letter followed by lowercase (Mouse*, Wheel, Key*, Digit*).
const A = (a) => ({ a });
const L = (c) => ({ c });
const KB = {
  driver: [
    ['ACCELERATE', [A('throttle')]], ['BRAKE / REVERSE', [A('brake')]], ['STEER LEFT', [A('left')]], ['STEER RIGHT', [A('right')]], ['HANDBRAKE / DRIFT', [A('handbrake')]],
    ['NITRO', [A('nitro')]], ['OIL SLICK', [A('special1')]], ['DROP MINE', [A('special2')]], ['FLIP / RESET (HOLD)', [A('reset')]], ['CAMERA (COCKPIT / CHASE)', [A('camera')]], ['LOOK BACK (HOLD)', [A('lookBack')]], ['HORN', [A('horn')]], ['USE MEDKIT', [A('medkit')]], ['ACTIVATE NUKE (20-KILL COMBO)', [A('nuke')]], ['PAUSE MENU', [A('pause')]],
  ],
  gunner: [
    ['AIM', [L('MouseMove')]], ['FIRE', [L('MouseLeft')]], ['AIM DOWN SIGHTS', [L('MouseRight')]], ['RELOAD', [A('reload')]], ['THROW GRENADE', [A('grenade')]],
    ['WEAPON 1-3', [A('slot1'), A('slot2'), A('slot3')]], ['NEXT / PREVIOUS WEAPON', [L('Wheel')]], ['CAMERA (FIRST / THIRD PERSON)', [A('view')]], ['USE MEDKIT', [A('medkit')]], ['ACTIVATE NUKE (20-KILL COMBO)', [A('nuke')]], ['PAUSE MENU', [A('pause')]],
  ],
  solo: [
    ['DRIVE', [A('throttle'), A('left'), A('brake'), A('right')]], ['HANDBRAKE / DRIFT', [A('handbrake')]], ['NITRO', [A('nitro')]],
    ['AIM', [L('MouseMove')]], ['FIRE', [L('MouseLeft')]], ['AIM DOWN SIGHTS', [L('MouseRight')]], ['RELOAD', [A('reload')]], ['THROW GRENADE', [A('grenade')]],
    ['OIL SLICK', [A('special1')]], ['DROP MINE', [A('special2')]], ['FLIP / RESET', [L('KeyT')]], ['WEAPON 1-3 / WHEEL', [A('slot1'), A('slot2'), A('slot3'), L('Wheel')]], ['CAMERA (FIRST / THIRD PERSON)', [A('view')]], ['USE MEDKIT', [A('medkit')]], ['ACTIVATE NUKE (20-KILL COMBO)', [A('nuke')]], ['PAUSE MENU', [A('pause')]],
  ],
};
// gamepad mapping (mirrors src/core/input.js: driver(), gunner(), solo())
const PADMAP = {
  driver: { LT: 'BRAKE / REVERSE', RT: 'ACCELERATE', LB: 'LOOK BACK (HOLD)', RB: 'NITRO', LS: 'STEER', L3: 'ACTIVATE NUKE', DPAD: 'LEFT / RIGHT: STEER · DOWN: MEDKIT', A: 'HANDBRAKE / DRIFT', B: 'DROP MINE', X: 'OIL SLICK', Y: 'FLIP / RESET (HOLD)', RS: 'LOOK AROUND · CLICK: CAMERA', START: 'PAUSE' },
  gunner: { LT: 'AIM DOWN SIGHTS', RT: 'FIRE', LB: 'GRENADE', RB: 'GRENADE', L3: 'ACTIVATE NUKE', DPAD: 'UP / RIGHT / DOWN: WEAPON 1-3', X: 'RELOAD', Y: 'NEXT WEAPON', RS: 'AIM · CLICK: MEDKIT', BACK: 'FIRST / THIRD PERSON', START: 'PAUSE' },
  solo: { LT: 'BRAKE', RT: 'ACCELERATE', LB: 'NITRO', RB: 'FIRE', LS: 'STEER', L3: 'ACTIVATE NUKE', DPAD: 'LEFT: OIL · RIGHT: MINE · DOWN: MEDKIT', A: 'HANDBRAKE / DRIFT', B: 'GRENADE', X: 'RELOAD', Y: 'FLIP / RESET', RS: 'AIM · CLICK: NEXT WEAPON', BACK: 'FIRST / THIRD PERSON', START: 'PAUSE' },
};
const LEFT = ['LT', 'LB', 'LS', 'L3', 'DPAD'], RIGHT = ['RT', 'RB', 'Y', 'X', 'B', 'A', 'RS', 'BACK', 'START'];

function padSvg(map) {
  const on = (k) => (map[k] || k === 'LS' && map.L3 ? 'on' : '');
  const xy = (k, x, y, xb, ps) => `<g class="pbtn ${on(k)}"><circle cx="${x}" cy="${y}" r="15"/><text class="xb" x="${x}" y="${y + 5}">${xb}</text><text class="ps" x="${x}" y="${y + 5}">${ps}</text></g>`;
  return `<svg class="padsvg" viewBox="0 0 420 300" aria-hidden="true">
    <path class="pbody" d="M118 96C84 96 54 136 44 196C37 238 51 276 77 268C99 262 109 231 131 221L289 221C311 231 321 262 343 268C369 276 383 238 376 196C366 136 336 96 302 96Z"/>
    <g class="ptrig ${on('LT')}"><path d="M92 44h50l-4 30H96z"/><text x="117" y="65">LT</text></g>
    <g class="ptrig ${on('RT')}"><path d="M278 44h50l-4 30h-42z"/><text x="303" y="65">RT</text></g>
    <g class="pbump ${on('LB')}"><rect x="76" y="80" width="78" height="16" rx="7"/><text x="115" y="93">LB</text></g>
    <g class="pbump ${on('RB')}"><rect x="266" y="80" width="78" height="16" rx="7"/><text x="305" y="93">RB</text></g>
    <g class="pstick ${on('LS')}"><circle class="o" cx="118" cy="142" r="27"/><circle cx="118" cy="142" r="16"/><text x="118" y="147">LS</text></g>
    <g class="pstick ${on('RS')}"><circle class="o" cx="264" cy="204" r="25"/><circle cx="264" cy="204" r="15"/><text x="264" y="209">RS</text></g>
    <g class="pdpad ${on('DPAD')}"><path d="M152 176h14v12h12v14h-12v12h-14v-12h-12v-14h12z" transform="translate(-2 -4)"/></g>
    ${xy('Y', 336, 116, 'Y', '△')}${xy('X', 310, 142, 'X', '□')}${xy('B', 362, 142, 'B', '○')}${xy('A', 336, 168, 'A', '✕')}
    <g class="psys ${on('START')}"><rect x="222" y="138" width="22" height="12" rx="6"/></g>
    <g class="psys ${on('BACK')}"><rect x="176" y="138" width="22" height="12" rx="6"/></g>
    <circle class="pguide" cx="210" cy="118" r="10"/>
  </svg>`;
}

export class ControlsScreen {
  constructor(ui, role) {
    this.ui = ui; this.kind = 'controls'; this.bg = 'dim';
    this.role = ROLES.some((r) => r.id === role) ? role : 'driver';
    this.el = h(`<div class="screen controls"><div class="safe">
      <div class="st-title stg" style="--i:0"><div class="eyebrow">HOW TO PLAY</div><h1>CONTROLS</h1></div>
      <div class="ctabs stg" style="--i:1"></div>
      <div class="c-blurb stg" style="--i:1"></div>
      <div class="c-kb plate trans stg" style="--i:2"><div class="lhead"><h2>${icon('kbm')}KEYBOARD &amp; MOUSE</h2></div><div class="hazbar"></div><div class="scroll kb-rows"></div></div>
      <div class="c-pad plate trans stg" style="--i:3"><div class="lhead"><h2>${icon('gamepad')}GAMEPAD</h2><span class="lcount">XBOX / PLAYSTATION</span></div><div class="hazbar"></div><div class="pad-wrap"></div></div>
      <div class="c-foot"></div>
      <div class="hints" data-hints>${hints([['nav', 'MOVE'], ['confirm', 'SELECT'], ['tabs', 'ROLE'], ['back', 'BACK']])}</div>
    </div></div>`);
    this.q = { tabs: this.el.querySelector('.ctabs'), blurb: this.el.querySelector('.c-blurb'), kb: this.el.querySelector('.kb-rows'), pad: this.el.querySelector('.pad-wrap'), foot: this.el.querySelector('.c-foot') };
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.render();
  }
  render() {
    const b = this.ui.input.bindings || {};
    const code = (a) => (b[a] && b[a][0]) || '';
    this.q.tabs.innerHTML = ROLES.map((r) => `<div class="f ctab ${r.id === this.role ? 'on' : ''}" role="button" data-role="${r.id}" data-k="role:${r.id}">${icon(r.icon)}<span>${r.name}</span></div>`).join('');
    this.q.blurb.textContent = ROLES.find((r) => r.id === this.role).blurb;
    this.q.kb.innerHTML = KB[this.role].map(([label, items]) => {
      const cs = items.map((it) => (it.c ? cap(it.c) : code(it.a) ? cap(code(it.a)) : '<kbd class="none">—</kbd>')).join('');
      return `<div class="kr"><span class="kl">${label}</span><span class="kc">${cs}</span></div>`;
    }).join('');
    this.q.foot.innerHTML = '<div class="f btn small wide" role="button" data-act="rebind" data-k="rebind"><span>REBIND KEYS</span></div><div class="f btn primary small wide" role="button" data-act="back" data-k="back"><span>BACK</span></div>';
    const map = PADMAP[this.role];
    const leg = (list) => list.filter((k) => map[k]).map((k) => `<div class="lg"><span class="lgk">${pad(k === 'L3' ? 'LS' : k)}${k === 'L3' ? '<em>CLICK</em>' : ''}</span><span class="lgt">${map[k]}</span></div>`).join('');
    this.q.pad.innerHTML = `<div class="legend l">${leg(LEFT)}</div><div class="padfig">${padSvg(map)}</div><div class="legend r">${leg(RIGHT)}</div>`;
  }
  setRole(id) {
    if (id === this.role) return;
    this.role = id; this.render();
    const t = this.el.querySelector(`[data-role="${id}"]`); if (t) this.ui.nav.focus(t, { silent: true });
    this.q.kb.animate([{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
    this.q.pad.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260 });
  }
  tabStep(dir) { this.ui.snd('click'); this.setRole(ROLES[(ROLES.findIndex((r) => r.id === this.role) + dir + ROLES.length) % ROLES.length].id); }
  onClick(e) {
    const t = e.target.closest('.f'); if (!t) return;
    if (t.dataset.role) { this.setRole(t.dataset.role); return; }
    if (t.dataset.act === 'back') this.back();
    if (t.dataset.act === 'rebind') this.ui.showSettings(undefined, { tab: 'keys' });
  }
  initialFocus() { return this.el.querySelector(`[data-role="${this.role}"]`); }
  navOverride(el, dir) {
    if (el.dataset.role && dir === 'down') return this.el.querySelector('[data-act=rebind]');
    if (el.dataset.act && dir === 'up') return this.el.querySelector(`[data-role="${this.role}"]`);
    return undefined;
  }
  resumed() { this.render(); }
  back() { this.ui.close(); return true; }
}


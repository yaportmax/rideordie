// UI glyph kit: html escaping, number formatting, key caps, controller glyphs, inline SVG icons, weapon silhouettes.
// Pure string builders (no DOM) so screens can compose them into template literals.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
export const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------- keys
const KEY_NAMES = {
  Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', NumpadEnter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP', Delete: 'DEL', CapsLock: 'CAPS',
  ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/',
  PageUp: 'PG UP', PageDown: 'PG DN', Home: 'HOME', End: 'END', Insert: 'INS', MouseMove: 'MOUSE', MouseLeft: 'LMB', MouseRight: 'RMB', MouseMiddle: 'MMB', Wheel: 'WHEEL',
};
export function keyLabel(code) {
  if (!code) return '';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'NUM ' + code.slice(6).replace('Multiply', '*').replace('Add', '+').replace('Subtract', '-').replace('Divide', '/').replace('Decimal', '.');
  return code.toUpperCase();
}
export const cap = (code) => `<kbd class="${/^Mouse|Wheel/.test(code) ? 'mouse' : ''}">${esc(keyLabel(code))}</kbd>`;
export const caps = (codes) => codes.map(cap).join('');

// ---------------------------------------------------------------- controller glyphs (both variants are emitted; CSS shows the active pad family)
const PB = {
  A: ['A', '✕', 'a'], B: ['B', '○', 'b'], X: ['X', '□', 'x'], Y: ['Y', '△', 'y'],
  LB: ['LB', 'L1', 'bump'], RB: ['RB', 'R1', 'bump'], LT: ['LT', 'L2', 'trig'], RT: ['RT', 'R2', 'trig'],
  START: ['☰', '☰', 'sys'], BACK: ['⧉', '⧉', 'sys'], LS: ['LS', 'L3', 'stick'], RS: ['RS', 'R3', 'stick'],
};
export function pad(name) {
  if (name === 'DPAD') return DPAD;
  if (name === 'DPAD_H') return DPAD_H;
  const [xb, ps, cls] = PB[name] || [name, name, 'sys'];
  return `<span class="pb pb-${cls} pb-${name.toLowerCase()}"><i class="xb">${xb}</i><i class="ps">${ps}</i></span>`;
}
const DPAD = `<span class="pb pb-dpad"><svg viewBox="0 0 24 24"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" fill="currentColor"/></svg></span>`;
const DPAD_H = `<span class="pb pb-dpad"><svg viewBox="0 0 24 24"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" fill="currentColor" opacity=".35"/><path d="M2 9h7v6H2zM15 9h7v6h-7z" fill="currentColor"/></svg></span>`;

/** One hint chip: keyboard glyph markup, pad glyph markup, label. */
export const hint = (kb, gp, label) => `<span class="hint"><span class="hk">${kb}</span><span class="hg">${gp}</span><em>${esc(label)}</em></span>`;
const HK = {
  confirm: [cap('Enter'), pad('A')], back: [cap('Escape'), pad('B')], tabs: [cap('KeyQ') + cap('KeyE'), pad('LB') + pad('RB')],
  nav: [cap('ArrowUp') + cap('ArrowDown'), pad('DPAD')], navh: [cap('ArrowLeft') + cap('ArrowRight'), pad('DPAD_H')],
  x: [cap('KeyX'), pad('X')], y: [cap('KeyY'), pad('Y')], start: [cap('Enter'), pad('START')], select: [cap('Tab'), pad('BACK')],
};
/** hints([['confirm','SELECT'], ['back','BACK'], ['<kbd>1</kbd>', pad('X'), 'EQUIP']]) -> html */
export function hints(list) {
  return list.map((h) => (h.length === 2 ? hint(HK[h[0]][0], HK[h[0]][1], h[1]) : hint(h[0], h[1], h[2]))).join('');
}
export { HK };

// ---------------------------------------------------------------- icons (48x48 viewBox, currentColor)
const S = (body, vb = '0 0 48 48', cls = '') => `<svg class="ic ${cls}" viewBox="${vb}" fill="currentColor" aria-hidden="true">${body}</svg>`;
const ICONS = {
  truck: S('<path d="M2 31V20h19l5-8h10l8 9v10h-4a5 5 0 0 0-10 0H19a5 5 0 0 0-10 0z"/><path d="M28 15h6l6 6H28z" fill="#14110f" opacity=".55"/><circle cx="14" cy="32" r="4.6" fill="#14110f" stroke="currentColor" stroke-width="2.4"/><circle cx="35" cy="32" r="4.6" fill="#14110f" stroke="currentColor" stroke-width="2.4"/>'),
  wrench: S('<path d="M33 5a11 11 0 0 0-10.4 14.4L5.8 36.2a4.4 4.4 0 0 0 6.2 6.2L28.700 25.600A11 11 0 0 0 43 15.300l-6.800 6.800-5.700-1.200-1.200-5.700L36 8.400A11 11 0 0 0 33 5z"/>'),
  gun: S('<path d="M3 20h30l3-3h9v9h-6l-2 3h-6l-1-3H28l-2 10h-7l1-10H3z"/>'),
  vest: S('<path d="M14 6l4 3q6 4 12 0l4-3 8 7-4 7-3-2v22H13V18l-3 2-4-7z"/><path d="M24 20v22M17 28h14" stroke="#14110f" stroke-width="2" opacity=".5"/>'),
  paint: S('<path d="M24 4C18 13 11 20 11 28a13 13 0 0 0 26 0C37 20 30 13 24 4z"/><path d="M18 30a6 6 0 0 0 5 6" stroke="#14110f" stroke-width="2.4" fill="none" opacity=".55" stroke-linecap="round"/>'),
  wheel: S('<circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="4.5"/><circle cx="24" cy="24" r="5" /><path d="M24 24 6 22M24 24l18-2M24 24v18" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>'),
  crosshair: S('<circle cx="24" cy="24" r="13" fill="none" stroke="currentColor" stroke-width="3.6"/><circle cx="24" cy="24" r="2.8"/><path d="M24 3v12M24 33v12M3 24h12M33 24h12" stroke="currentColor" stroke-width="3.6"/>'),
  kbm: S('<rect x="2" y="14" width="28" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M7 20h3M13 20h3M19 20h3M25 20h1M7 25h3M13 25h3M19 25h3M10 29.500h10" stroke="currentColor" stroke-width="2.600" stroke-linecap="round"/><rect x="34" y="12" width="12" height="24" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M40 12v10M34 22h12" stroke="currentColor" stroke-width="2.600"/>'),
  gamepad: S('<path d="M14 12h20a10 10 0 0 1 10 9l2 10a5.500 5.500 0 0 1-10 3l-3-5H15l-3 5a5.500 5.500 0 0 1-10-3l2-10a10 10 0 0 1 10-9z"/><path d="M13 19v8M9 23h8" stroke="#14110f" stroke-width="2.800" stroke-linecap="round"/><circle cx="33" cy="20.500" r="2" fill="#14110f"/><circle cx="37.500" cy="24.500" r="2" fill="#14110f"/>'),
  lock: S('<rect x="9" y="21" width="30" height="21" rx="3"/><path d="M15 21v-6a9 9 0 0 1 18 0v6" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="24" cy="31" r="3" fill="#14110f"/>'),
  check: S('<path d="M8 25l11 11L41 12" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="square"/>'),
  coin: S('<circle cx="24" cy="24" r="20"/><circle cx="24" cy="24" r="15" fill="none" stroke="#14110f" stroke-width="2.500" opacity=".5"/><path d="M28 18.500c-1-2-3-2.800-4.500-2.800-2.500 0-4 1.300-4 3.200 0 5 9 2.500 9 8 0 2-2 3.400-4.800 3.400-2 0-4-.8-5-2.800M24 12v4M24 32.500V36" fill="none" stroke="#14110f" stroke-width="3" stroke-linecap="round" opacity=".8"/>'),
  skull: S('<path d="M24 4C13 4 7 12 7 21c0 6 3 9 6 11v7h6v-4h2v4h6v-4h2v4h6v-7c3-2 6-5 6-11C41 12 35 4 24 4z"/><circle cx="17" cy="22" r="4.500" fill="#14110f"/><circle cx="31" cy="22" r="4.500" fill="#14110f"/><path d="M24 26l-3 5h6z" fill="#14110f"/>'),
  flag: S('<path d="M9 4h4v40H9z"/><path d="M13 6h26l-6 9 6 9H13z"/>'),
  copy: S('<rect x="15" y="15" width="27" height="29" rx="3" fill="none" stroke="currentColor" stroke-width="4"/><path d="M33 9V6H8v29h4" fill="none" stroke="currentColor" stroke-width="4"/>'),
  cross: S('<path d="M10 10l28 28M38 10L10 38" stroke="currentColor" stroke-width="6" stroke-linecap="square"/>'),
  bolt: S('<path d="M28 2 10 27h11l-3 19 20-27H26z"/>'),
  plug: S('<path d="M17 4v10M31 4v10M11 14h26v10a13 13 0 0 1-26 0zM24 37v8" fill="none" stroke="currentColor" stroke-width="4.500" stroke-linecap="square"/>'),
  medal: S('<path d="M12 3h10l4 14H16zM26 3h10L26 17h-4z" opacity=".8"/><circle cx="24" cy="30" r="13"/><path d="M24 22l2.500 5 5.500.8-4 3.900 1 5.500-5-2.700-5 2.700 1-5.500-4-3.900 5.500-.8z" fill="#14110f" opacity=".7"/>'),
  clock: S('<circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="4.500"/><path d="M24 12v13l9 5" fill="none" stroke="currentColor" stroke-width="4.500" stroke-linecap="square"/>'),
  road: S('<path d="M18 4h12l14 40H4z"/><path d="M24 8v6M24 20v8M24 34v8" stroke="#14110f" stroke-width="3" opacity=".7"/>'),
  sliders: S('<path d="M6 12h36M6 24h36M6 36h36" stroke="currentColor" stroke-width="4"/><rect x="12" y="7" width="8" height="10" /><rect x="28" y="19" width="8" height="10"/><rect x="16" y="31" width="8" height="10"/>'),
  speaker: S('<path d="M5 18h9l11-9v30l-11-9H5z"/><path d="M32 16a11 11 0 0 1 0 16M37 10a19 19 0 0 1 0 28" fill="none" stroke="currentColor" stroke-width="3.600" stroke-linecap="round"/>'),
  monitor: S('<rect x="4" y="7" width="40" height="26" rx="2" fill="none" stroke="currentColor" stroke-width="4"/><path d="M16 42h16M24 33v9" stroke="currentColor" stroke-width="4"/>'),
  key: S('<rect x="4" y="12" width="40" height="24" rx="4" fill="none" stroke="currentColor" stroke-width="4"/><path d="M12 22h4M20 22h4M28 22h4M36 22h1M14 29h20" stroke="currentColor" stroke-width="3.400" stroke-linecap="round"/>'),
  info: S('<circle cx="24" cy="24" r="19"/><path d="M24 22v13M24 13v4" stroke="#14110f" stroke-width="4.500" stroke-linecap="round"/>'),
  warn: S('<path d="M24 4 45 41H3z"/><path d="M24 17v13M24 34v4" stroke="#14110f" stroke-width="4.500" stroke-linecap="round"/>'),
};
export const icon = (name, cls = '') => (cls ? ICONS[name].replace('class="ic ', `class="ic ${cls} `) : ICONS[name]) || '';

// ---------------------------------------------------------------- weapon silhouettes (120x48, facing right)
const W = (body) => `<svg class="wic" viewBox="0 0 120 48" fill="currentColor" aria-hidden="true">${body}</svg>`;
const WEAPON_ICONS = {
  pistol: W('<path d="M30 13h58l4 4v8H62l-3 3H50l-2 15H34l3-15 -7-3z"/><path d="M56 25h10v6h-7z" opacity=".5"/><rect x="88" y="15" width="16" height="4" />'),
  revolver: W('<path d="M24 20l5-8h20l6 4h58v9H60l-5 4-8 1-4 16H31l4-16-9-4z"/><circle cx="46" cy="18" r="8" stroke="#14110f" stroke-width="2.200" opacity=".55" fill="none"/><path d="M96 12h4v4h-4z"/>'),
  smg: W('<path d="M10 17h16l6-4h48v6l10 1v5H82v3H62l-4 2-6-1-3 16H40l3-15-2-3H30l-4 4H10z"/><rect x="92" y="16" width="20" height="5"/>'),
  shotgun: W('<path d="M2 21l12-6h24l4 3h36v-3h44v5H84v4H74l-4 2H56l-2 4H38l-8 3H14z"/><path d="M56 25h22v5H56z" opacity=".5"/>'),
  rifle: W('<path d="M2 20l10-6h20l4-4h8l2 4h34v4h24v-2h12v5h-12v3H74l-3 5H62l-3 10H46l4-10-14-2-4 3H12z"/><path d="M70 30l4 12h-8z" />'),
  lmg: W('<path d="M4 20l10-6h22l4-4h6l2 4h34v3h34v6h-2v-3H90v6H78l-3 3H64v9H40v-9l-8 1-4 3H8z"/><path d="M96 31l-6 12M99 31l7 12" stroke="currentColor" stroke-width="2.400"/>'),
  sniper: W('<path d="M2 23l10-7h20l3 3h30v3h44v5H80v5H66l-6 2H46l-8 4H26l-2-6-6 1-4 2H2z"/><rect x="36" y="9" width="34" height="8" rx="3"/><path d="M44 17v3M62 17v3" stroke="currentColor" stroke-width="3"/><rect x="108" y="20" width="10" height="7"/>'),
  rpg: W('<path d="M2 20h56l5-5h20l4 5h6l6-6 8 6-8 6-6-6h-6l-4 5H63l-5-5H44l-6 7 4 14h-9l-3-13-10-1-6 1H2z"/><path d="M84 14l14-9 14 9" opacity="0"/><rect x="34" y="12" width="10" height="4"/>'),
};
export const weaponIcon = (id) => WEAPON_ICONS[id] || WEAPON_ICONS.pistol;

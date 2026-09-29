// Small shared DOM helpers + reusable markup builders (pips, stat rows, buttons).
import { esc, clamp01 } from './glyphs.js';

export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

/** Eased number tween; returns a cancel function. fn(value, t01). */
export function tween(from, to, ms, fn, done) {
  const t0 = performance.now(); let raf = 0, dead = false;
  const step = (now) => {
    if (dead) return;
    const t = clamp01((now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
    fn(from + (to - from) * e, t);
    if (t < 1) raf = requestAnimationFrame(step); else if (done) done();
  };
  raf = requestAnimationFrame(step);
  return () => { dead = true; cancelAnimationFrame(raf); };
}

/** Level pips. `fresh` = index of a pip to animate as newly filled. */
export const pips = (lv, max, fresh = -1, cls = '') =>
  `<span class="pips ${cls}">${Array.from({ length: max }, (_, i) => `<i class="${i < lv ? 'on' : ''}${i === fresh ? ' new' : ''}"></i>`).join('')}</span>`;

/**
 * One stat preview row. s = {label, before, after, max, fmt, lowerBetter, text}
 * Shows a bar with the current value and a highlighted delta segment towards `after`, plus "before -> after".
 */
export function statRow(s) {
  const fmt = s.fmt || ((v) => String(Math.round(v * 10) / 10));
  const max = s.max || 1;
  let b = clamp01(s.before / max), a = s.after == null ? b : clamp01(s.after / max);
  if (s.lowerBetter) { b = 1 - b; a = s.after == null ? b : 1 - a; }
  const changed = s.after != null && Math.abs(s.after - s.before) > 1e-6;
  const better = changed && (s.lowerBetter ? s.after < s.before : s.after > s.before);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const bar = `<span class="sbar"><i class="base" style="width:${(changed ? lo : b) * 100}%"></i>${changed ? `<i class="delta ${better ? 'up' : 'down'}" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"></i>` : ''}</span>`;
  const val = changed
    ? `<span class="sval"><s>${esc(fmt(s.before))}</s><b class="${better ? 'up' : 'down'}">${esc(fmt(s.after))}</b>${s.unit ? `<small>${esc(s.unit)}</small>` : ''}</span>`
    : `<span class="sval"><b>${esc(s.text ?? fmt(s.before))}</b>${s.unit ? `<small>${esc(s.unit)}</small>` : ''}</span>`;
  return `<div class="stat${changed ? ' chg' : ''}"><span class="slabel">${esc(s.label)}</span>${val}${bar}</div>`;
}

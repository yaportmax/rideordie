// Settings + key bindings persistence, and applying them to the Input object (sens, invertY, bindings, vibration).
import { DEFAULT_BINDINGS } from '../core/input.js';

const SETTINGS_KEY = 'rideordie.settings.v1';
const BINDINGS_KEY = 'rideordie.bindings.v1';

export const DEFAULT_SETTINGS = {
  quality: 2,        // 0 low .. 3 ultra
  resScale: 1,       // render resolution scale 0.5 .. 1.5
  autoResolution: true,
  fov: 80,           // vertical fov, degrees (60..100) -- first person
  shake: 1,          // camera shake amount 0..1
  mouseSens: 1,      // multiplier on Input.sens.mouse
  padSens: 1,        // multiplier on Input.sens.padYaw/padPitch
  invertY: false,
  aimAssist: true,   // gamepad aim assist (gunner)
  master: 0.8, sfx: 1, music: 0.7,
  vibration: true,
  motionBlur: true, chromatic: true, grain: true,   // post-processing toggles (Post.setFeatures)
};
/** Baseline numbers of Input.sens that the multipliers scale. */
export const BASE_SENS = { mouse: 0.0022, padYaw: 3.1, padPitch: 2.3 };

export function loadSettings() {
  try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) return normalizeSettings(JSON.parse(raw)); } catch { /* blocked */ }
  return { ...DEFAULT_SETTINGS };
}
export function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_SETTINGS };
  const s = { ...DEFAULT_SETTINGS, ...value };
  const limits = { quality: [0, 3], resScale: [0.5, 1.5], fov: [60, 100], shake: [0, 1], mouseSens: [0.1, 5], padSens: [0.1, 5], master: [0, 1], sfx: [0, 1], music: [0, 1] };
  for (const [k, [lo, hi]] of Object.entries(limits)) s[k] = Number.isFinite(s[k]) ? Math.min(hi, Math.max(lo, s[k])) : DEFAULT_SETTINGS[k];
  s.quality = Math.round(s.quality);
  for (const k of ['autoResolution', 'invertY', 'aimAssist', 'vibration', 'motionBlur', 'chromatic', 'grain']) if (typeof s[k] !== 'boolean') s[k] = DEFAULT_SETTINGS[k];
  return s;
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* blocked */ } }

export function loadBindings() {
  try {
    const raw = JSON.parse(localStorage.getItem(BINDINGS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const k of Object.keys(DEFAULT_BINDINGS)) if (Array.isArray(raw[k]) && raw[k].every((c) => typeof c === 'string')) out[k] = raw[k].slice(0, 2);
    return out;
  } catch { return null; }
}
export function saveBindings(b) { try { localStorage.setItem(BINDINGS_KEY, JSON.stringify(b)); } catch { /* blocked */ } }
export const defaultBindings = () => Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([k, v]) => [k, v.slice()]));

/** Push settings into the Input instance (sensitivities / invert / vibration gate). Everything else is the integrator's via onChange. */
export function applySettings(input, s) {
  if (!input) return;
  input.sens = input.sens || {};
  input.sens.mouse = BASE_SENS.mouse * s.mouseSens;
  input.sens.padYaw = BASE_SENS.padYaw * s.padSens;
  input.sens.padPitch = BASE_SENS.padPitch * s.padSens;
  input.invertY = !!s.invertY;
  input.vibration = !!s.vibration;
}
/** Gate Input.rumble behind the vibration setting (idempotent). */
export function wrapRumble(input, getSettings) {
  if (!input || input.__rodRumble || typeof input.rumble !== 'function') return;
  const orig = input.rumble.bind(input);
  input.rumble = (...a) => { if (getSettings().vibration) orig(...a); };
  input.__rodRumble = true;
}

/** Actions grouped by role for the rebinding list + conflict checks. Bindings within one role group must be unique; 'pause' is global. */
export const BIND_GROUPS = [
  { id: 'driver', name: 'DRIVER', actions: [
    ['throttle', 'ACCELERATE'], ['brake', 'BRAKE / REVERSE'], ['left', 'STEER LEFT'], ['right', 'STEER RIGHT'], ['handbrake', 'HANDBRAKE / DRIFT'], ['nitro', 'NITRO'],
    ['special1', 'OIL SLICK'], ['special2', 'DROP MINE'], ['reset', 'FLIP / RESET'], ['camera', 'CAMERA'], ['lookBack', 'LOOK BACK'], ['horn', 'HORN'],
  ] },
  { id: 'gunner', name: 'GUNNER', actions: [
    ['reload', 'RELOAD'], ['grenade', 'GRENADE'], ['melee', 'MELEE'], ['crouch', 'CROUCH'], ['lean', 'LEAN'],
    ['moveF', 'MOVE FORWARD'], ['moveB', 'MOVE BACK'], ['moveL', 'MOVE LEFT'], ['moveR', 'MOVE RIGHT'],
    ['slot1', 'WEAPON 1'], ['slot2', 'WEAPON 2'], ['slot3', 'WEAPON 3'], ['slot4', 'WEAPON 4'], ['slot5', 'WEAPON 5'], ['slot6', 'WEAPON 6'],
  ] },
  { id: 'global', name: 'GLOBAL', actions: [['pause', 'PAUSE MENU']] },
];
export const ACTION_LABEL = Object.fromEntries(BIND_GROUPS.flatMap((g) => g.actions));
/** Actions that could conflict with `action` (same role group, or anything for global). */
export function conflictSet(action) {
  const g = BIND_GROUPS.find((x) => x.actions.some((a) => a[0] === action));
  if (!g) return [];
  if (g.id === 'global') return BIND_GROUPS.flatMap((x) => x.actions.map((a) => a[0])).filter((a) => a !== action);
  return [...g.actions.map((a) => a[0]), 'pause'].filter((a) => a !== action);
}

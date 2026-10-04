// Startup help follows the active device and the same live bindings Input reads.
import { DEFAULT_BINDINGS } from '../core/input.js';
import { esc, keyLabel } from './glyphs.js';

const item = (keys, action) => `<b>${esc(keys)}</b> ${action}`;
const line = items => items.join(' &nbsp; ');
const TACTICS = 'SHOOT THE DRIVERS &middot; SHOOT THE FUEL TANKS &middot; DON\'T CRASH';

export function startupHintLines(role, input = {}) {
  // An unplugged controller cannot keep advertising unavailable controls.
  // Connection alone does not select it: Input.poll() owns lastDevice.
  const pad = input.lastDevice === 'pad' && input.padConnected === true;
  const bindings = input.bindings || DEFAULT_BINDINGS;
  const binding = action => {
    const codes = Array.isArray(bindings[action]) ? bindings[action].filter(code => typeof code === 'string' && code.length) : [];
    return codes.length ? codes.map(keyLabel).join('/') : 'UNBOUND';
  };
  const action = (name, label) => item(binding(name), label);
  const pair = (a, b, label) => item(`${binding(a)} · ${binding(b)}`, label);
  const slots = () => item(Array.from({ length: 6 }, (_, i) => binding(`slot${i + 1}`)).join(' · '), 'WEAPONS');
  let rows;
  if (role === 'driver') {
    rows = pad ? [
      line([item('LS', 'STEER'), item('RT', 'GAS'), item('LT', 'BRAKE / REVERSE'), item('A', 'DRIFT'), item('RB', 'NITRO')]),
      line([item('LB', 'LOOK BACK (HOLD)'), item('Y', 'RESET (HOLD)'), item('R3', 'VIEW'), item('X / B', 'OIL / MINE'), item('D-PAD DOWN', 'MEDKIT')]),
    ] : [
      line([pair('throttle', 'brake', 'GAS / BRAKE'), pair('left', 'right', 'STEER'), action('handbrake', 'DRIFT'), action('nitro', 'NITRO')]),
      line([pair('special1', 'special2', 'OIL / MINE'), action('lookBack', 'LOOK BACK (HOLD)'), action('reset', 'RESET (HOLD)'), action('camera', 'VIEW'), action('medkit', 'MEDKIT')]),
    ];
  } else if (role === 'solo') {
    rows = pad ? [
      line([item('LS', 'STEER'), item('RT / LT', 'GAS / BRAKE'), item('A', 'DRIFT'), item('LB', 'NITRO'), item('Y', 'RESET (HOLD)')]),
      line([item('RS', 'AIM'), item('RB', 'FIRE'), item('X', 'RELOAD'), item('B', 'GRENADE'), item('R3', 'NEXT WEAPON')]),
      line([item('D-PAD LEFT / RIGHT', 'OIL / MINE'), item('BACK', 'VIEW'), item('D-PAD DOWN', 'MEDKIT')]),
    ] : [
      line([pair('throttle', 'brake', 'GAS / BRAKE'), pair('left', 'right', 'STEER'), action('handbrake', 'DRIFT'), action('nitro', 'NITRO'), item('T', 'RESET (HOLD)')]),
      line([item('MOUSE', 'AIM'), item('LMB', 'FIRE'), item('RMB', 'SIGHTS'), action('reload', 'RELOAD'), action('grenade', 'GRENADE')]),
      line([pair('special1', 'special2', 'OIL / MINE'), slots(), item('WHEEL', 'SWAP'), action('view', 'VIEW'), action('medkit', 'MEDKIT')]),
    ];
  } else {
    rows = pad ? [
      line([item('RS', 'AIM'), item('RT', 'FIRE'), item('LT', 'SIGHTS'), item('X', 'RELOAD'), item('RB / LB', 'GRENADE')]),
      line([item('Y', 'NEXT WEAPON'), item('D-PAD', 'WEAPONS 1-4'), item('BACK', 'VIEW'), item('R3', 'MEDKIT')]),
    ] : [
      line([item('MOUSE', 'AIM'), item('LMB', 'FIRE'), item('RMB', 'SIGHTS'), action('reload', 'RELOAD'), action('grenade', 'GRENADE')]),
      line([slots(), item('WHEEL', 'SWAP'), action('view', 'VIEW'), action('medkit', 'MEDKIT')]),
    ];
  }
  return [...rows, TACTICS];
}

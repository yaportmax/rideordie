// Installed vehicle upgrades. Game frame: +X left, +Y up, +Z forward.
// Static authored mounts; geometry is rebuilt only when appearance changes.
import { DRIVER_UPGRADE_MAX } from '../data/vehicle_families.js';
export const CAR_UPGRADE_MAX = DRIVER_UPGRADE_MAX;
export const sanitizeVisualLevels = (levels = {}) => Object.fromEntries(Object.entries(CAR_UPGRADE_MAX).map(([id, max]) => [id, Math.max(0, Math.min(max, Math.floor(Number(levels[id]) || 0)))]));
export const visualKey = levels => Object.entries(sanitizeVisualLevels(levels)).map(([id, level]) => `${id}:${level}`).join('|');

const surfaces = Object.freeze({
  steel: { color: 0x556062, roughness: .66, metalness: .65 },
  dark: { color: 0x1c2427, roughness: .78, metalness: .4 },
  bare: { color: 0x959b98, roughness: .42, metalness: .85 },
  rubber: { color: 0x161c1c, roughness: .95, metalness: 0 },
  nitro: { color: 0x235f99, roughness: .48, metalness: .45 },
  oil: { color: 0x775734, roughness: .72, metalness: .45 },
  mine: { color: 0x596142, roughness: .74, metalness: .35 },
});
export { surfaces as UPGRADE_SURFACES };

/** No inference from overall model bounds: armour/spikes can expand them.
 * Each mount supplies p (car-frame position), size and a detachable panel.
 * Wheels supply name/radius/width separately. Windows supply bottom/top/w.
 * No cover may be fitted across the driver's forward glass aperture.
 */
export function buildUpgradePlan(mounts, rawLevels) {
  const levels = sanitizeVisualLevels(rawLevels), parts = [];
  const add = (upgrade, shape, mount, offset, size, surface = 'steel', rotation = [0, 0, 0]) => {
    if (!mount) throw new Error(`Missing ${upgrade} mount`);
    const p = mount.p.map((v, i) => v + offset[i]);
    if (![...p, ...size, ...rotation].every(Number.isFinite) || size.some(v => v <= 0)) throw new Error(`Invalid ${upgrade} geometry`);
    parts.push({ upgrade, shape, anchor: mount.anchor || 'body', p, size, surface, rotation });
  };
  const box = (id, mount, p, size, surface = 'steel', rotation) => add(id, 'box', mount, p, size, surface, rotation);
  const cylinder = (id, mount, p, size, surface = 'steel', rotation) => add(id, 'cylinder', mount, p, size, surface, rotation);
  const bolts = (id, mount, w, h, z = .03, axis = 'z') => {
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const off = axis === 'x' ? [z, b * h * .36, a * w * .36] : [a * w * .36, b * h * .36, z];
      cylinder(id, mount, off, [.022, .018, .022], 'bare', axis === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]);
    }
  };

  if (levels.engine) {
    const lv = levels.engine, m = mounts.hood;
    // An actual intake/charge-cooler assembly: increasing capacity, fins and
    // twin inlet only at the final tune. Existing blowers use their own mount.
    const w = .29 + .024 * lv, h = .10 + .025 * lv, d = .35 + .025 * lv;
    box('engine', m, [0, h / 2, 0], [w, h, d], 'bare');
    box('engine', m, [0, h, .07], [w * .83, .045, d * .67], 'dark');
    for (let i = 0; i < lv + 2; i++) box('engine', m, [0, h * .64, (i / (lv + 1) - .5) * d * .8], [w * 1.05, .022, .025], 'bare');
    for (const x of lv === 5 ? [-w * .23, w * .23] : [0]) {
      cylinder('engine', m, [x, h * .73, d * .5 + .035], [lv === 5 ? .105 : .16, .085, lv === 5 ? .105 : .16], 'dark', [Math.PI / 2, 0, 0]);
      cylinder('engine', m, [x, h * .73, d * .5 + .077], [lv === 5 ? .087 : .136, .016, lv === 5 ? .087 : .136], 'bare', [Math.PI / 2, 0, 0]);
    }
  }
  if (levels.armor) {
    const lv = levels.armor;
    for (const side of ['left', 'right']) {
      const m = mounts.sides?.[side]; if (!m) throw new Error('Missing armor side mount');
      const sign = side === 'left' ? 1 : -1, h = m.size[1] * (.49 + .09 * lv), d = m.size[2] * (.63 + .065 * lv);
      box('armor', m, [sign * (.015 + .004 * lv), 0, 0], [.028 + .007 * lv, h, d], 'steel');
      bolts('armor', m, d, h, sign * (.044 + .009 * lv), 'x');
      if (lv >= 3) box('armor', m, [sign * .054, -h * .43, 0], [.055, .06, d * 1.03], 'dark');
      if (lv === 5) box('armor', m, [sign * .071, 0, 0], [.025, .055, d * .91], 'bare');
    }
    if (lv >= 4 && mounts.cargoArmor) {
      const m = mounts.cargoArmor;
      box('armor', m, [0, 0, -.035], [m.size[0] * .86, m.size[1] * .75, .045 + .006 * lv], 'steel');
      bolts('armor', m, m.size[0] * .86, m.size[1] * .75, -.067);
    }
  }
  if (levels.tires) {
    const lv = levels.tires;
    for (const m of mounts.wheels || []) {
      const r = m.radius, w = m.width, sign = m.p[0] >= 0 ? 1 : -1;
      // Wheel-relative tread reinforcement follows actual wheel rotation,
      // steer/suspension and tire detachment. Rolling radius is unchanged.
      const wheel = { ...m, p: [0, 0, 0] };
      for (let i = 0; i < 12 + lv * 2; i++) {
        const a = i * Math.PI * 2 / (12 + lv * 2), rr = r * .994;
        box('tires', wheel, [0, Math.sin(a) * rr, Math.cos(a) * rr], [w * (.78 + lv * .025), .022, .065 + .003 * lv], 'rubber', [-a, 0, 0]);
      }
      add('tires', 'torus', wheel, [sign * w * .47, 0, 0], [r * .76, .012 + .003 * lv, 1], lv >= 3 ? 'bare' : 'rubber', [0, Math.PI / 2, 0]);
      if (lv >= 3) for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        cylinder('tires', wheel, [sign * w * .49, Math.sin(a) * r * .76, Math.cos(a) * r * .76], [.022, .022, .022], 'bare', [0, 0, Math.PI / 2]);
      }
    }
    for (const m of mounts.suspension || []) {
      cylinder('tires', m, [0, 0, 0], [.038 + lv * .004, .23 + lv * .013, .038 + lv * .004], 'bare');
      cylinder('tires', m, [0, -.085, 0], [.065, .105, .065], 'nitro');
    }
  }
  if (levels.nitro) {
    const lv = levels.nitro, m = mounts.nitro, count = lv >= 3 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * .24, d = .49 + lv * .035, r = .16 + .006 * lv;
      cylinder('nitro', m, [x, 0, 0], [r, d, r], 'nitro', [Math.PI / 2, 0, 0]);
      cylinder('nitro', m, [x, 0, d / 2 + .022], [.043, .045, .043], 'bare', [Math.PI / 2, 0, 0]);
      for (const z of [-d * .32, d * .32]) add('nitro', 'torus', m, [x, 0, z], [r / 2 + .008, .015, 1], 'dark');
    }
    box('nitro', m, [0, -.105, 0], [count * .24, .055, .43], 'dark');
  }
  if (levels.ram) {
    const lv = levels.ram, m = mounts.bumper, w = m.size[0] * (.80 + .055 * lv), h = .21 + .07 * lv;
    box('ram', m, [0, 0, .034 + lv * .018], [w, h, .055 + lv * .018], 'steel', [-.12, 0, 0]);
    bolts('ram', m, w, h, .090 + lv * .03);
    for (const x of [-w * .31, w * .31]) box('ram', m, [x, -.035, -.135], [.075 + lv * .008, .12, .35], 'dark');
    if (lv >= 2) box('ram', m, [0, -h / 2, .025], [w * .96, .075, .17], 'bare');
    if (lv === 3) for (const x of [-w * .24, 0, w * .24]) box('ram', m, [x, .015, .13], [.052, h * .80, .055], 'bare');
  }
  if (levels.spikes) {
    const lv = levels.spikes;
    for (const side of ['left', 'right']) {
      const m = mounts.sides?.[side]; if (!m) throw new Error('Missing spikes side mount');
      const sign = side === 'left' ? 1 : -1, d = m.size[2] * .9;
      box('spikes', m, [sign * .075, -m.size[1] * .37, 0], [.075, .10, d], 'dark');
      for (let i = 0; i < 4 + lv * 2; i++) add('spikes', 'cone', m, [sign * (.11 + lv * .037), -m.size[1] * .37, (i / (3 + lv * 2) - .5) * d * .86], [.105, .16 + .08 * lv, .105], 'bare', [0, 0, -sign * Math.PI / 2]);
    }
  }
  if (levels.glass) {
    const lv = levels.glass, m = mounts.windshield, t = .022 + .009 * lv;
    if (!m?.bottom || !m?.top || !m?.width) throw new Error('Missing glass frame mount');
    const dy = m.top[1] - m.bottom[1], dz = m.top[2] - m.bottom[2], len = Math.hypot(dy, dz), angle = Math.atan2(dz, dy);
    // Only edge retainers and a lower laminate edge are added. NO central
    // plate, dark tint, or opaque sheet is allowed in the sight opening.
    const c = m.bottom.map((v, i) => (v + m.top[i]) / 2), edge = { anchor: m.anchor || 'body', p: c };
    for (const x of [-1, 1]) box('glass', edge, [x * m.width / 2, 0, .010], [t, len + .018, t], 'bare', [angle, 0, 0]);
    for (const y of [-1, 1]) box('glass', edge, [0, y * dy / 2, y * dz / 2 + .010], [m.width + t, t, t], 'bare');
  }
  if (levels.fueltank) {
    const lv = levels.fueltank, m = mounts.fuel, w = .39 + lv * .055;
    box('fueltank', m, [0, 0, 0], [w, .18 + lv * .035, .30 + lv * .025], 'dark');
    for (const x of [-w * .32, w * .32]) box('fueltank', m, [x, .11 + lv * .017, 0], [.042, .037, .31 + lv * .025], 'steel');
    cylinder('fueltank', m, [0, .12 + lv * .02, .045], [.08, .028, .08], 'bare');
  }
  if (levels.oil) {
    const lv = levels.oil, m = mounts.oil;
    box('oil', m, [0, .10, 0], [.29 + lv * .04, .25 + lv * .025, .28], 'oil');
    for (const x of [-.1, .1]) box('oil', m, [x, .10, -.15], [.025, .27 + lv * .025, .037], 'dark');
    cylinder('oil', m, [0, -.07, -.125], [.04 + lv * .01, .20, .04 + lv * .01], 'dark');
    cylinder('oil', m, [0, -.17, -.15], [.065, .10, .065], 'bare', [Math.PI / 2, 0, 0]);
  }
  if (levels.mines) {
    const lv = levels.mines, m = mounts.mines, w = .32 + lv * .04;
    box('mines', m, [0, .10, 0], [w, .23 + lv * .05, .32], 'mine');
    for (const x of [-1, 1]) box('mines', m, [x * w * .50, -.015, -.22], [.025, .085, .25], 'dark', [.16, 0, 0]);
    box('mines', m, [0, -.048, -.24], [w, .025, .25], 'steel', [.16, 0, 0]);
    for (let i = 0; i < 1 + lv; i++) cylinder('mines', m, [0, .025 + i * .083, -.17], [.20, .055, .20], 'mine');
  }
  const anchors = new Set(parts.map(p => p.anchor));
  return { levels, key: visualKey(levels), parts, estimatedDraws: anchors.size, ids: [...new Set(parts.map(p => p.upgrade))] };
}

/** Built-in stage trim is independent of bought modifiers. A later chassis
 * does not consume tire/armor upgrade levels or apply their stats for free. */
export function buildStageTrimPlan(mounts, family, stage) {
  const parts = [];
  const add = (mount, p, size, surface = 'steel', rotation = [0, 0, 0]) => {
    parts.push({ upgrade: 'chassis', shape: 'box', anchor: mount.anchor || 'body', p, size, surface, rotation });
  };
  if (family === 'sedan' && stage >= 2) {
    // A low trunk spoiler stays behind and well below the gunner's eye line.
    const trunk = { anchor: 'panel_trunk' };
    add(trunk, [0, 1.18, -2.19], [1.46, .055, .19], 'dark');
    for (const x of [-.55, .55]) add(trunk, [x, 1.085, -2.19], [.065, .16, .065], 'bare');
    for (const side of ['left', 'right']) {
      const mount = mounts.sides[side], sign = side === 'left' ? 1 : -1;
      add(mount, [mount.p[0] + sign * .015, .36, mount.p[2]], [.065, .065, .95], 'dark');
    }
  }
  if (family === 'buggy' && stage >= 2) {
    // Exterior floor-level frame rails are clear of both crew mounts. The
    // third stage adds rear chassis braces instead of a second engine blower.
    for (const sign of [-1, 1]) {
      add({ anchor: 'body' }, [sign * .81, .32, .05], [.08, .08, 1.08], stage >= 3 ? 'bare' : 'dark');
      if (stage >= 3) add({ anchor: 'body' }, [sign * .43, .78, -1.34], [.07, .07, .64], 'bare', [0, sign * .23, 0]);
    }
  }
  return { key: `${family}:${stage}`, parts, estimatedDraws: new Set(parts.map(p => p.anchor)).size, ids: parts.length ? ['chassis'] : [] };
}

// Stat previews for the garage: "before -> after" rows computed from effects() / weaponStats() / the vehicle tables.
import { effects, UPGRADE_BY_ID, TRUCKS, upgradeLevel, upgradeLimit } from '../data/upgrades.js';
import { VEHICLES } from '../data/vehicles.js';
import { familyOf, normalizeFamilyUpgrades, stagePurchaseAllowed } from '../data/vehicle_families.js';
import { WEAPONS, WEAPON_ORDER, weaponStats } from '../data/weapons.js';
import { speedValue, speedLabel } from './units.js';

const r0 = (v) => String(Math.round(v));
const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const r2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v)}%`;
const pctPlain = (v) => `${Math.round(v)}%`;
export const hullHp = (spec) => spec.hp ?? Math.round(spec.mass * 0.3);
const specOf = (p) => VEHICLES[p.truck]?.kind === 'player' ? VEHICLES[p.truck] : VEHICLES.player_sedan_t1;

/** Per-upgrade stat definitions: (spec, max levels) -> [{label, get(effects), max, unit, fmt, lowerBetter}]. */
const level = (n, label = 'LEVEL') => ({ label, get: (_e, lv) => lv, max: n, fmt: (v) => (v === 0 ? 'NONE' : `LV ${v}`), byLevel: true });
const UP_STATS = {
  engine: (spec, n, units) => [
    { label: 'TOP SPEED', get: (e) => speedValue(spec.engine.vmax * e.engineMul, units), max: speedValue(360 / 3.6, units), unit: speedLabel(units), fmt: r0 },
    { label: 'ACCELERATION', get: (e) => spec.engine.accel0 * (1 + (e.engineMul - 1) * 1.1), max: 10, unit: 'M/S²', fmt: r1 },
  ],
  armor: (spec) => [
    { label: 'CAR HP', get: (e) => hullHp(spec) * e.hpMul, max: 1800, fmt: r0 },
    { label: 'BULLET RESIST', get: (e) => (1 - e.bulletResist) * 100, max: 45, fmt: pctPlain },
  ],
  tires: () => [
    { label: 'GRIP', get: (e) => (e.gripMul - 1) * 100, max: 20, fmt: pct },
    { label: 'RUN-FLAT TIRES', get: (e) => (e.runFlat ? 1 : 0), max: 1, fmt: (v) => (v ? 'YES' : 'NO') },
  ],
  nitro: () => [
    { label: 'NITRO TANK', get: (e) => e.nitroCap, max: 11, unit: 'SEC', fmt: r1 },
    { label: 'REFILL RATE', get: (e) => e.nitroRegen / e.nitroCap * 100, max: 25, unit: '%/S', fmt: r1 },
  ],
  ram: (spec, n) => [level(n, 'RAM PLATE')],
  spikes: (spec, n) => [level(n, 'SPIKED SKIRTS')],
  glass: () => [{ label: 'DRIVER DAMAGE TAKEN', get: (e) => -e.driverArmor * 100, max: 60, fmt: (v) => (v === 0 ? 'NORMAL' : pct(v)), lowerBetter: true, invertBar: true, barBase: 0 }],
  fueltank: (spec, n) => [level(n, 'SEALING')],
  oil: (spec, n) => [level(n, 'OIL SLICK')],
  mines: (spec, n) => [level(n, 'MINE LAYER')],
  grenades: () => [{ label: 'GRENADES PER RUN', get: (e) => e.grenades, max: 6, fmt: r0 }],
  grenadeDmg: (spec, n) => [level(n, 'FRAG POWER')],
  medkit: () => [{ label: 'MEDKITS PER RUN', get: (e) => e.medkits, max: 3, fmt: r0 }],
  pouches: () => [{ label: 'RELOAD TIME', get: (e) => -(1 - e.reloadMul) * 100, max: 40, fmt: (v) => (v === 0 ? 'NORMAL' : pct(v)), lowerBetter: true, invertBar: true }],
  steady: () => [{ label: 'RECOIL & SPREAD', get: (e) => -e.handling * 10, max: 30, fmt: (v) => (v === 0 ? 'NORMAL' : pct(v)), lowerBetter: true, invertBar: true }],
  scavenger: () => [{ label: 'CASH BONUS', get: (e) => (e.cashMul - 1) * 100, max: 30, fmt: pct }],
};

/** Rows for a leveled upgrade: current level and (if not maxed) the level you would get. */
export function upgradeStats(profile, id, units = 'mi') {
  const u = UPGRADE_BY_ID[id]; if (!u || u.retired) return [];
  const lv = upgradeLevel(profile, id), n = upgradeLimit(profile, id);
  const spec = specOf(profile);
  const e0 = effects(profile);
  let next;
  if (u.role === 'driver') {
    const normalized = normalizeFamilyUpgrades(profile), family = familyOf(profile.truck);
    next = { ...profile, ...normalized, vehicleUpgrades: { ...normalized.vehicleUpgrades, [family]: { ...normalized.vehicleUpgrades[family], [id]: lv + 1 } } };
  } else next = { ...profile, upgrades: { ...profile.upgrades, [id]: lv + 1 } };
  const e1 = lv < n ? effects(next) : null;
  return (UP_STATS[id] ? UP_STATS[id](spec, n, units) : [level(n)]).map((d) => {
    // "invertBar" rows are negative numbers (less damage taken): show the magnitude as a growing bar, text keeps the sign.
    const before = d.get(e0, lv), after = e1 ? d.get(e1, lv + 1) : null;
    const flip = d.invertBar ? -1 : 1;
    return { label: d.label, before: before * flip, after: after == null ? null : after * flip, max: d.max, unit: d.unit, fmt: d.invertBar ? (v) => d.fmt(v * flip) : d.fmt, lowerBetter: false };
  });
}

/** Rows comparing truck `id` with the currently selected truck (upgrades included). */
export function truckStats(profile, id, units = 'mi') {
  const cur = specOf(profile), tgt = VEHICLES[id] || cur;
  const f = (spec) => {
    const e = effects({ ...profile, truck: spec.id });
    return {
    speed: speedValue(spec.engine.vmax * e.engineMul, units),
    accel: spec.engine.accel0 * (1 + (e.engineMul - 1) * 1.1),
    hp: hullHp(spec) * e.hpMul, mass: spec.mass,
    size: spec.length * spec.width,
    };
  };
  const a = f(cur), b = f(tgt), same = cur.id === tgt.id;
  const row = (label, k, max, fmt, unit, lowerBetter) => ({ label, before: a[k], after: same ? null : b[k], max, fmt, unit, lowerBetter });
  return [
    row('TOP SPEED', 'speed', speedValue(360 / 3.6, units), r0, speedLabel(units)), row('ACCELERATION', 'accel', 10, r1, 'M/S²'),
    row('HULL HP', 'hp', 1800, r0), { ...row('WEIGHT', 'mass', 3200, r0, 'KG'), },
  ];
}

/**
 * "What to buy next" after a run: the most useful thing the player can afford now (biased by what killed them), else the next
 * thing worth saving for. -> {tab, id, name, kind, cost, need, why} | null
 */
export function suggestNext(profile, cause = '') {
  const p = profile, cash = p.cash || 0, lv = (id) => upgradeLevel(p, id);
  const up = (id, why) => { const u = UPGRADE_BY_ID[id]; if (!u || u.retired || lv(id) >= upgradeLimit(p, id)) return null; return { tab: u.role === 'driver' ? 'upgrades' : 'gunner', id, name: `${u.name}${u.costs.length > 1 ? ' LV ' + (lv(id) + 1) : ''}`, kind: u.role === 'driver' ? 'CAR UPGRADE' : 'GUNNER GEAR', cost: u.costs[lv(id)], why }; };
  const family = familyOf(p.truck);
  const candidates = TRUCKS.filter(t => !p.trucks.includes(t.id) && stagePurchaseAllowed(p, t.id));
  const nextTruck = candidates.find(t => t.family === family) || candidates.find(t => t.tier === 1);
  const truck = nextTruck ? { tab: nextTruck.tier > 1 ? 'upgrades' : 'truck', id: nextTruck.id, name: nextTruck.name, kind: nextTruck.tier > 1 ? 'CHASSIS UPGRADE' : 'BASE VEHICLE', cost: nextTruck.cost, why: nextTruck.family === family ? 'A STRONGER CHASSIS FOR YOUR CURRENT BUILD' : 'A DIFFERENT CHASSIS WITH ITS OWN UPGRADE PATH' } : null;
  const bestOwnedIdx = Math.max(...WEAPON_ORDER.map((id, i) => (p.weapons[id] ? i : -1)));
  const nextGunId = WEAPON_ORDER.find((id, i) => i > bestOwnedIdx && !p.weapons[id] && id !== 'revolver');
  const gun = nextGunId ? { tab: 'weapons', id: nextGunId, name: WEAPONS[nextGunId].name, kind: 'WEAPON', cost: WEAPONS[nextGunId].cost, why: 'BIGGER GUN, FASTER KILLS, MORE CASH' } : null;
  const c = String(cause).toUpperCase();
  const causeUp = /TRUCK/.test(c) ? up('armor', 'YOUR TRUCK WAS WRECKED: PLATING KEEPS IT ROLLING') : /DRIVER/.test(c) ? (up('glass', 'THEY SHOT YOUR DRIVER: ARMORED GLASS STOPS THAT') || up('armor', 'MORE HULL, MORE TIME')) : /GUNNER/.test(c) ? up('medkit', 'PATCH UP MID-RUN') : null;
  const order = [causeUp, truck, gun, up('engine', 'OUTRUN THE CONVOY'), up('armor', 'MORE HULL, MORE TIME'), up('medkit', 'PATCH UP MID-RUN'), up('tires', 'GRIP IN THE CORNERS'), up('pouches', 'FASTER RELOADS')].filter(Boolean);
  if (!order.length) return null;
  const pick = order.find((o) => o.cost <= cash) || order.slice().sort((a, b) => a.cost - b.cost)[0];
  return { ...pick, need: Math.max(0, pick.cost - cash) };
}

/** Rows for a weapon; `previewTrack` ('dmg'|'mag'|'rel'|'hnd') shows what buying that track would change. */
export function weaponRows(profile, id, previewTrack) {
  const w = WEAPONS[id]; if (!w) return [];
  const lv = profile.weapons[id] || { dmg: 0, mag: 0, rel: 0, hnd: 0 };
  const s0 = weaponStats(id, lv);
  const s1 = previewTrack && (lv[previewTrack] || 0) < 3 ? weaponStats(id, { ...lv, [previewTrack]: (lv[previewTrack] || 0) + 1 }) : null;
  const P = w.pellets || 1;
  const val = (fn) => ({ before: fn(s0), after: s1 ? fn(s1) : null });
  const only = (tr, o) => (previewTrack === tr ? o : { before: o.before, after: null });
  return [
    { label: 'DAMAGE', max: 320, fmt: (v) => (P > 1 ? `${Math.round(v / P)}×${P}` : r0(v)), ...only('dmg', val((s) => s.dmg * P)) },
    { label: 'FIRE RATE', max: 850, unit: 'RPM', fmt: r0, before: s0.rpm, after: null },
    { label: 'MAGAZINE', max: 200, fmt: r0, ...only('mag', val((s) => s.mag)) },
    { label: 'RELOAD', max: 5, unit: 'SEC', fmt: r2, lowerBetter: true, ...only('rel', val((s) => s.reload)) },
    { label: 'SPREAD', max: 5, unit: '°', fmt: r2, lowerBetter: true, ...only('hnd', val((s) => s.spread.hip * s.spreadMul)) },
    { label: 'RECOIL', max: 8, fmt: r1, lowerBetter: true, ...only('hnd', val((s) => s.recoil.pitch * s.recoilMul)) },
    { label: 'RANGE', max: 720, unit: 'M', fmt: r0, before: w.range, after: null },
  ];
}

// Turns a profile (owned upgrades) into the concrete truck spec + gunner loadout used by a run.
import { VEHICLES } from '../data/vehicles.js';
import { effects } from '../data/upgrades.js';
import { clamp } from '../core/util.js';

export function buildPlayerSpec(profile) {
  const e = effects(profile);
  const base = VEHICLES[e.truck];
  const spec = {
    ...base,
    hp: Math.round(base.hp * e.hpMul), armor: 1 - e.bulletResist,
    engine: { ...base.engine, vmax: base.engine.vmax * e.engineMul, accel0: base.engine.accel0 * (1 + (e.engineMul - 1) * 1.1) },
    grip: { ...base.grip, front: base.grip.front * e.gripMul, rear: base.grip.rear * e.gripMul },
    nitro: { ...(base.nitro || {}), capacity: e.nitroCap, regen: e.nitroRegen, mul: base.nitro?.mul ?? 1.7 },
    driverHp: e.driverHp, gunnerHp: e.gunnerHp, driverArmor: e.driverArmor, gunnerArmor: e.gunnerArmor,
    tireMul: e.runFlat ? 0.3 : 1, crashMul: 1 - 0.14 * e.ramLevel,
    bulletResist: e.bulletResist, ramHurt: 1 + 0.4 * e.ramLevel, spikes: e.spikes, fuelSeal: e.fueltank, // RAM PLATE / SPIKED SKIRTS / SELF-SEALING TANK (read by the sim)
    gunners: 1, susp: base.susp,
  };
  return { spec, effects: e };
}

export function gunnerLoadout(e) {
  return { weapons: e.weapons, levels: e.weaponLevels, grenades: e.grenades, grenadeLv: e.grenadeLv, armorTier: e.armorTier, reloadMul: e.reloadMul, handling: e.handling };
}

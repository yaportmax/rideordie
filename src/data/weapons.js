// Weapon tables. Damage units: enemy sedan ~90 car HP / 40 crew HP. rpm = shots/min. Angles in degrees.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'RANGER 9', slot: 0, cost: 0, mode: 'semi', rpm: 330, dmg: 11, pellets: 1, mag: 12, reload: 1.35,
    spread: { hip: 0.75, ads: 0.18, bloom: 0.35, bloomMax: 2.2, recover: 5 }, recoil: { pitch: 1.5, yaw: 0.35, kick: 0.05 }, range: 160, falloff: [70, 160, 0.55],
    head: 2.5, tracer: 0xffd27a, tracerLen: 3.0, adsZoom: 1.25, sound: 'pistol', shell: 'shell_9mm', crosshair: 1, desc: 'Reliable sidearm.',
  },
  revolver: {
    id: 'revolver', name: 'MAGNUM .357', slot: 1, cost: 900, mode: 'semi', rpm: 170, dmg: 42, pellets: 1, mag: 6, reload: 2.5,
    spread: { hip: 0.9, ads: 0.15, bloom: 0.9, bloomMax: 2.5, recover: 4 }, recoil: { pitch: 4.2, yaw: 0.9, kick: 0.12 }, range: 200, falloff: [90, 200, 0.6],
    head: 2.6, tracer: 0xffc060, tracerLen: 3.5, adsZoom: 1.3, sound: 'revolver', shell: 'shell_9mm', crosshair: 1, pierce: 0, desc: 'Slow, brutal.',
  },
  smg: {
    id: 'smg', name: 'VIPER SMG', slot: 0, cost: 1500, mode: 'auto', rpm: 800, dmg: 8, pellets: 1, mag: 32, reload: 1.7,
    spread: { hip: 1.5, ads: 0.6, bloom: 0.22, bloomMax: 3.6, recover: 6 }, recoil: { pitch: 0.75, yaw: 0.5, kick: 0.03 }, range: 120, falloff: [45, 120, 0.4],
    head: 2.2, tracer: 0xffe08a, tracerLen: 2.6, adsZoom: 1.3, sound: 'smg', shell: 'shell_9mm', crosshair: 2, desc: 'Torrent of lead.',
  },
  shotgun: {
    id: 'shotgun', name: 'HAMMER 12G', slot: 0, cost: 2600, mode: 'pump', rpm: 78, dmg: 10, pellets: 9, mag: 6, reload: 0.5, reloadPerShell: true, pumpTime: 0.55,
    spread: { hip: 4.2, ads: 3.0, bloom: 0, bloomMax: 0, recover: 6 }, recoil: { pitch: 5.5, yaw: 1.0, kick: 0.16 }, range: 70, falloff: [14, 55, 0.12],
    head: 1.6, tracer: 0xffb060, tracerLen: 2.0, adsZoom: 1.2, sound: 'shotgun', shell: 'shell_shotgun', crosshair: 3, desc: 'Devastating up close; rips tyres apart.', tireMul: 3,
  },
  rifle: {
    id: 'rifle', name: 'RAIDER AR', slot: 0, cost: 4200, mode: 'auto', rpm: 620, dmg: 17, pellets: 1, mag: 30, reload: 2.0,
    spread: { hip: 1.0, ads: 0.22, bloom: 0.2, bloomMax: 2.4, recover: 5 }, recoil: { pitch: 1.05, yaw: 0.5, kick: 0.05 }, range: 260, falloff: [120, 260, 0.6],
    head: 2.4, tracer: 0xffd48a, tracerLen: 4.0, adsZoom: 1.6, sound: 'rifle', shell: 'shell_rifle', crosshair: 2, desc: 'Accurate all-rounder.',
  },
  lmg: {
    id: 'lmg', name: 'REAPER LMG', slot: 0, cost: 7000, mode: 'auto', rpm: 760, dmg: 19, pellets: 1, mag: 120, reload: 4.4,
    spread: { hip: 1.7, ads: 0.6, bloom: 0.14, bloomMax: 3.2, recover: 3.5 }, recoil: { pitch: 0.95, yaw: 0.65, kick: 0.055 }, range: 260, falloff: [110, 260, 0.6],
    head: 2.0, tracer: 0xffb84a, tracerLen: 5.0, adsZoom: 1.4, sound: 'lmg', shell: 'shell_rifle', crosshair: 2, pierce: 1, desc: 'Belt-fed mayhem. Rounds punch through light bodywork.',
  },
  sniper: {
    id: 'sniper', name: 'LONGBOW .50', slot: 1, cost: 6000, mode: 'bolt', rpm: 52, dmg: 150, pellets: 1, mag: 5, reload: 3.0, boltTime: 0.85,
    spread: { hip: 2.5, ads: 0.02, bloom: 0, bloomMax: 0, recover: 6 }, recoil: { pitch: 6.5, yaw: 0.6, kick: 0.2 }, range: 700, falloff: [400, 700, 0.85],
    head: 3.2, tracer: 0xfff0c0, tracerLen: 9.0, adsZoom: 4.0, scope: true, scopeFov: 14, sound: 'sniper', shell: 'shell_rifle', crosshair: 0, pierce: 2, desc: 'One shot, one wreck. Punches through cars.',
  },
  rpg: {
    id: 'rpg', name: 'WRECKER RPG', slot: 1, cost: 9000, mode: 'launcher', rpm: 40, dmg: 260, pellets: 1, mag: 1, reload: 3.6,
    spread: { hip: 0.6, ads: 0.1, bloom: 0, bloomMax: 0, recover: 6 }, recoil: { pitch: 7, yaw: 1.2, kick: 0.25 }, range: 600, falloff: [1, 2, 1],
    head: 1, tracer: 0xffffff, tracerLen: 0, adsZoom: 1.5, sound: 'rpg', crosshair: 1, rocket: { speed: 85, blast: 11, blastDmg: 240, trail: 0xffaa66 }, desc: 'Turns cars into fireballs.',
  },
};
export const WEAPON_ORDER = ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'rpg'];

export const GRENADE = { name: 'FRAG', fuse: 2.1, blast: 9.5, dmg: 190, speed: 24, cooldown: 7, count: 2, upgrades: 4 };

/** Stat multipliers from a weapon's upgrade levels {dmg,mag,rel,hnd} (each 0..5). */
export function weaponStats(id, lv = {}) {
  const w = WEAPONS[id];
  const d = lv.dmg || 0, m = lv.mag || 0, r = lv.rel || 0, h = lv.hnd || 0;
  return {
    ...w,
    dmg: w.dmg * (1 + 0.14 * d),
    mag: Math.round(w.mag * (1 + 0.18 * m)),
    reload: w.reload * (1 - 0.09 * r),
    boltTime: w.boltTime ? w.boltTime * (1 - 0.06 * r) : undefined,
    pumpTime: w.pumpTime ? w.pumpTime * (1 - 0.06 * r) : undefined,
    spreadMul: 1 - 0.08 * h,
    recoilMul: 1 - 0.09 * h,
    rate: w.rpm / 60,
  };
}

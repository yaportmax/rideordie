// Authority-owned per-life combat feedback, replay slots and earned nuke policy.
import { validRunId } from '../net/run_packet.js';
import { WEAPONS, weaponStats } from '../data/weapons.js';
import { validHitReport, resolveHitPoint } from './hit_contact.js';
import { BOSS_PARTS } from '../data/boss.js';
import * as THREE from 'three';

export const COMBO_WINDOW = 3.5, NUKE_THRESHOLD = 20;
export const NUKE_LIMITS = Object.freeze({ cars: 64, actors: 48, bossDamage: 300, bossFraction: .10 });
export const COMBO_NAMES = Object.freeze(['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUADRUPLE KILL', 'PENTAKILL',
  'ONSLAUGHT', 'UNSTOPPABLE', 'DOMINATING', 'RUTHLESS', 'ANNIHILATION', 'UNRELENTING', 'EXECUTIONER',
  'APOCALYPSE', 'SAVAGE', 'UNTOUCHABLE', 'WRECKING CREW', 'ROAD REAPER', 'TOTAL DESTRUCTION', 'CRITICAL MASS', 'SUPER ULTRA MEGA KILL']);
export const HOSTILE_STAGE_KINDS = Object.freeze(['tower', 'rifleman', 'drone', 'boat', 'barrel']);
const earnedStage = new Set(['tower', 'rifleman', 'drone', 'boat']);
const effectStage = new Set(HOSTILE_STAGE_KINDS);
const alive = x => !!x && !x.dead && !x.exploded && x.hp > 0;
const ordinaryCar = x => x?.kind === 'enemy' && !x.elite && !x.isBoss;
const currentCar = (sim, x) => sim.cars.get(x?.id) === x;
const currentActor = (sim, x) => sim.encounters?.entities.get(x?.id) === x;
export const playerLive = sim => sim?.state === 'run' && alive(sim.player) && sim.player.crew?.driver?.alive === true &&
  (!sim.player.crew.gunner || sim.player.crew.gunner.alive === true) && !sim.won && !sim.result &&
  !sim.director?.campaignComplete && !sim.director?.marathonComplete && !sim.boss?.dead && !sim.boss?.exploded;

/** Precomputed trusted nonlethal mutation limits. No client supplies targets,
 * fractions or inputs. Every final-boss operation respects the actual gated
 * part table and compensates its damage multiplier BEFORE source mutation.
 * Elite car operations deliberately change only hull HP, never fuel/crew/phase.
 */
export function bossChipPlan(sim, maxDamage = NUKE_LIMITS.bossDamage, fraction = NUKE_LIMITS.bossFraction) {
  if (!sim || !Number.isFinite(maxDamage) || maxDamage < 0 || maxDamage > NUKE_LIMITS.bossDamage ||
    !Number.isFinite(fraction) || fraction < 0 || fraction > NUKE_LIMITS.bossFraction) return [];
  const ops = []; let remaining = maxDamage;
  const boss = sim.boss;
  if (boss && !boss.dead && !boss.exploded) for (const [zone, def] of Object.entries(BOSS_PARTS)) {
    if (remaining <= 0 || !boss.alive?.[zone] || def.invulnerable || (def.phase && def.phase > boss.phase) ||
      (def.needs && def.needs.some(n => boss.alive[n]))) continue;
    const hp = boss.hp?.[zone], maximum = def.hp;
    if (!Number.isFinite(hp) || !Number.isFinite(maximum)) continue;
    const damage = Math.min(remaining, maximum * fraction, Math.max(0, hp - 1));
    if (damage <= 0) continue;
    ops.push(Object.freeze({ kind: 'part', target: boss, zone, damage, inputDamage: damage / (def.weak ? 1.6 : 1) })); remaining -= damage;
  }
  for (const car of [...sim.cars.values()].sort((a,b) => a.id-b.id)) {
    if (remaining <= 0 || !currentCar(sim, car) || car.kind !== 'enemy' || (!car.elite && !car.isBoss) || !alive(car) || !Number.isFinite(car.maxHp)) continue;
    // Sim._burning automatically ignites a hull below16%. A chip that crosses
    // that boundary would schedule its own later lethal burn, so preserve it.
    const floor = Math.max(1, car.maxHp * .16 + 1e-6);
    const damage = Math.min(remaining, car.maxHp * fraction, Math.max(0, car.hp - floor));
    if (damage <= 0) continue;
    ops.push(Object.freeze({ kind: 'elite-hull', target: car, damage })); remaining -= damage;
  }
  return Object.freeze(ops);
}

/** WORK effect adapter. Revalidate each planned operation immediately before
 * applying it. Final boss keeps its own phase logic; no part reaches zero.
 * The elite branch is explicitly hull-only to avoid fuel-fuse side effects.
 */
export function applyBossChip(sim, maxDamage, fraction) {
  let total = 0;
  for (const op of bossChipPlan(sim, maxDamage, fraction)) {
    if (op.kind === 'part') {
      const boss = op.target, def = BOSS_PARTS[op.zone];
      if (sim.boss !== boss || boss.dead || boss.exploded || !boss.alive[op.zone] || def.invulnerable ||
        (def.phase && def.phase > boss.phase) || (def.needs && def.needs.some(n => boss.alive[n]))) continue;
      const damage = Math.min(op.damage, maxDamage - total, Math.max(0, boss.hp[op.zone] - 1));
      if (!(damage > 0)) continue;
      const before = boss.hp[op.zone]; boss.damage(op.zone, damage / (def.weak ? 1.6 : 1)); total += before - boss.hp[op.zone];
    } else {
      const car = op.target;
      if (!currentCar(sim, car) || !alive(car) || (!car.elite && !car.isBoss)) continue;
      const floor = Math.max(1, car.maxHp * .16 + 1e-6);
      const damage = Math.min(op.damage, maxDamage - total, Math.max(0, car.hp - floor));
      if (!(damage > 0)) continue;
      car.hp -= damage; car.hitFlash = .12; total += damage;
    }
  }
  return total;
}

/** Brief labels are presentation-only; pass a trusted positive-damage receipt. */
export function zoneFeedback(zone, { damage = 0, killed = false } = {}) {
  if (!(Number.isFinite(damage) && damage > 0)) return null;
  if (zone === 'fuel') return { text: 'FUEL HIT', seconds: .28, color: '#ffb75b' };
  if (/^driver(?:_head)?$/.test(zone)) return { text: killed ? 'DRIVER DOWN' : zone.endsWith('_head') ? 'DRIVER HEADSHOT' : 'DRIVER HIT', seconds: killed ? .45 : .28, color: killed ? '#ffc93a' : '#f3e9d7' };
  if (/^gunner[2-4]?(?:_head|_legs)?$/.test(zone)) return { text: killed ? 'GUNNER DOWN' : zone.endsWith('_head') ? 'GUNNER HEADSHOT' : 'GUNNER HIT', seconds: killed ? .45 : .28, color: killed ? '#ffc93a' : '#f3e9d7' };
  return null;
}

export function damageState(target, zone) {
  if (!target) return null;
  const role = /^driver(?:_head)?$/.test(zone) ? 'driver' : /^gunner[2-4]?(?:_head|_legs)?$/.test(zone) ? zone.split('_')[0] : null;
  if (role) {
    const crew = target.crew?.[role];
    if (crew) return { hp: Math.max(0, crew.hp), alive: !!crew.alive, role };
    if (earnedStage.has(target.kind)) return { hp: Math.max(0, target.hp || 0), alive: !target.dead && target.hp > 0, role };
    return null;
  }
  if (target.isBoss) return { hp: Math.max(0, target.hp?.[zone] || 0) };
  return { hp: Math.max(0, target.hp || 0), subsystem: zone === 'fuel' ? Math.max(0, target.fuelHp || 0) : zone === 'engine' ? Math.max(0, target.engineHp || 0) : 0 };
}
export function actualDamageReceipt(target, zone, before) {
  const after = damageState(target, zone); if (!before || !after) return null;
  const damage = Math.max(0, before.hp - after.hp, (before.subsystem || 0) - (after.subsystem || 0));
  if (!Number.isFinite(damage) || damage <= 0) return null;
  return { zone, damage: Math.min(10000, damage), killed: !!before.role && before.alive && !after.alive };
}
export function validCombatState(state, runId) {
  return !!state && state.runId === runId && Number.isSafeInteger(state.revision) && state.revision >= 0 && state.revision <= 0x7fffffff &&
    Number.isInteger(state.combo) && state.combo >= 0 && state.combo <= 100000 && Number.isInteger(state.best) && state.best >= state.combo && state.best <= 100000 &&
    typeof state.ready === 'boolean' && Number.isSafeInteger(state.award) && state.award >= 0 && state.award <= 0x7fffffff &&
    state.label === (COMBO_NAMES[Math.min(state.combo, NUKE_THRESHOLD)] || '') && Number.isFinite(state.expiresIn) && state.expiresIn >= 0 && state.expiresIn <= COMBO_WINDOW;
}
export function validDamageReceipt(receipt, runId) {
  return !!receipt && receipt.runId === runId && Number.isSafeInteger(receipt.revision) && receipt.revision > 0 && receipt.revision <= 0x7fffffff &&
    Number.isSafeInteger(receipt.shotId) && receipt.shotId > 0 && Number.isInteger(receipt.pelletIndex) && receipt.pelletIndex >= 0 && receipt.pelletIndex < 9 &&
    Number.isInteger(receipt.penetrationIndex) && receipt.penetrationIndex >= 0 && receipt.penetrationIndex <= 2 && Number.isSafeInteger(receipt.targetId) && receipt.targetId > 1 &&
    typeof receipt.killed === 'boolean' && !!zoneFeedback(receipt.zone, receipt);
}
const GUNNER_FX_TYPES = new Set(['shot','weaponSwap','reloadStart','reloadEnd','reloadCancel','shellIn','dryClick','grenadeThrow']);
const finiteVector = a => Array.isArray(a) && a.length === 3 && a.every(v => Number.isFinite(v) && Math.abs(v) <= 1e9);
export function validRemoteGunnerFX(event, ownedWeapons) {
  if (!event || !GUNNER_FX_TYPES.has(event.t)) return false;
  if (event.t === 'grenadeThrow') return finiteVector(event.origin) && finiteVector(event.vel);
  if (!WEAPONS[event.weapon] || !ownedWeapons?.includes(event.weapon)) return false;
  if (event.t === 'reloadStart') return Number.isFinite(event.time) && event.time > 0 && event.time <= 60;
  if (event.t !== 'shot') return true;
  return event.src === 'player' && finiteVector(event.origin) && (event.rocket ? finiteVector(event.dir) :
    Array.isArray(event.rays) && event.rays.length <= 27 && event.rays.every(ray => !!ray && finiteVector(ray.end)));
}

/** This is a replay/damage bound, not a complete aim, magazine or anti-cheat proof.
 * Proposed reports add pelletIndex and penetrationIndex from actual fire loops.
 * Different shotgun pellets and real penetration passes remain distinct.
 */
export class HitContactGuard {
  constructor(loadout) {
    this.weapons = new Map((loadout.weapons || []).filter(id => WEAPONS[id]).map(id => [id, weaponStats(id, loadout.levels?.[id])]));
    this.watermark = 0; this.shots = new Map();
  }
  check(report, car) {
    // A switch+shot hit arrives before the next unreliable gunner pose packet.
    // Bound weapon identity to the authoritative current-life owned loadout,
    // rather than comparing it with that older pose packet's active weapon.
    const weapon = report?.weapon, w = this.weapons.get(weapon);
    if (!w || w.mode === 'launcher' || !validHitReport(report) || !car || report.carId !== car.id ||
      !Number.isSafeInteger(report.shotId) || report.shotId <= 0 || report.shotId <= this.watermark - 128 ||
      !Number.isInteger(report.pelletIndex) || report.pelletIndex < 0 || report.pelletIndex >= w.pellets ||
      !Number.isInteger(report.penetrationIndex) || report.penetrationIndex < 0 || report.penetrationIndex > (w.pierce || 0)) return false;
    const expected = w.dmg * (report.penetrationIndex ? .6 : 1);
    // Simulation applies playerDamageMul itself. The report is the unscaled,
    // falloff-limited weapon damage, never a client-selected head multiplier.
    if (report.dmg > expected + 1e-7 || (report.tireMul ?? 1) !== (w.tireMul || 1)) return false;
    // The final boss has a car-like pose but no car raycastRadius(). Its real
    // authored boxes extend far beyond the ordinary six-metre fallback.
    const target = car.isBoss && Array.isArray(car.zones) ? { ...car, raycastRadius: () => Math.max(1,
      ...car.zones.map(z => Math.hypot(...z.c) + (z.r || Math.hypot(...z.h)))) } : car;
    const point = resolveHitPoint(target, report, new THREE.Vector3());
    if (!point) return false;
    const contact = `${report.pelletIndex}:${report.penetrationIndex}`;
    const shot = this.shots.get(report.shotId);
    if (shot && (shot.weapon !== weapon || shot.contacts.has(contact))) return false;
    return true;
  }
  accept(report, car) {
    if (!this.check(report, car)) return false;
    const weapon = report.weapon, contact = `${report.pelletIndex}:${report.penetrationIndex}`;
    let shot = this.shots.get(report.shotId);
    if (!shot) { shot = { weapon, contacts: new Set() }; this.shots.set(report.shotId, shot); }
    shot.contacts.add(contact); this.watermark = Math.max(this.watermark, report.shotId);
    for (const id of this.shots.keys()) if (id <= this.watermark - 128) this.shots.delete(id);
    return true;
  }
  dispose() { this.shots.clear(); this.weapons.clear(); this.watermark = 0; }
}

/** Authority owns this per life. Only actual terminal Sim callbacks may call
 * creditTerminal; incoming events/feed/count/readiness are never its inputs.
 * Integration must keep it unreachable from generic JSON event dispatch.
 */
export class CombatPolicy {
  constructor(sim, runId) {
    if (!validRunId(runId) || !sim) throw Error('current authoritative Sim and runId required');
    this.sim = sim; this.runId = runId; this.clock = 0; this.lastKillAt = -Infinity; this.combo = 0; this.best = 0;
    this.ready = false; this.award = 0; this.revision = 0; this.closed = false; this.resolving = false;
    this.credited = new WeakSet(); this.nukeDerived = new WeakMap(); this.epochs = new WeakSet(); this.requestSeq = { local: 0, peer: 0 };
  }
  advance(dt) {
    if (this.closed || !Number.isFinite(dt) || dt < 0 || dt > 10) return false;
    if (!playerLive(this.sim)) { if (this.combo || this.ready) { this.combo = 0; this.ready = false; this.revision++; } return false; }
    // Called once from authority Run.update with its unchanged active frame dt.
    // It preserves the existing frame-clock3.5s window instead of slowmo time.
    this.clock += dt;
    if (this.combo && this.clock - this.lastKillAt >= COMBO_WINDOW) { this.combo = 0; this.revision++; }
    return true;
  }
  state() { return Object.freeze({ runId: this.runId, revision: this.revision, combo: this.combo, best: this.best,
    label: COMBO_NAMES[Math.min(this.combo, NUKE_THRESHOLD)] || '', ready: this.ready, award: this.award,
    expiresIn: this.combo ? Math.max(0, COMBO_WINDOW - (this.clock - this.lastKillAt)) : 0 }); }
  markNukeDerived(target, epoch) {
    if (this.closed || !target || !epoch || !this.epochs.has(epoch)) return false;
    this.nukeDerived.set(target, epoch); return true;
  }
  nukeEpoch(target) { return target && this.nukeDerived.get(target) || null; }
  /** Authority calls before damage or fuse scheduling, including a new victim
   * outside the original plan. Store the actual epoch, not only a source id:
   * the source wreck may leave the current map before the fuse detonates.
   */
  inheritNukeDerived(target, source) {
    if (!(ordinaryCar(target) && currentCar(this.sim, target)) && !(effectStage.has(target?.kind) && currentActor(this.sim, target))) return false;
    return this.markNukeDerived(target, this.nukeEpoch(source));
  }
  creditTerminal(target, { owner = -1, cause = '', nukeEpoch = null } = {}) {
    if (this.closed || this.resolving || !playerLive(this.sim) || owner !== 1 || !target || this.credited.has(target) ||
      this.nukeDerived.has(target) || nukeEpoch || cause === 'nuke' || !target.dead || !target.exploded || target.hp > 0) return null;
    const car = currentCar(this.sim, target) && ordinaryCar(target);
    const actor = currentActor(this.sim, target) && earnedStage.has(target.kind);
    if (!car && !actor) return null;
    this.credited.add(target);
    if (this.clock - this.lastKillAt >= COMBO_WINDOW) this.combo = 0;
    this.lastKillAt = this.clock; this.combo++; this.best = Math.max(this.best, this.combo);
    if (this.combo === NUKE_THRESHOLD && !this.ready) { this.ready = true; this.award++; }
    this.revision++; return this.state();
  }
  plan() {
    const cars = [...this.sim.cars.values()].filter(c => currentCar(this.sim, c) && ordinaryCar(c) && alive(c)).sort((a,b) => a.id-b.id);
    const actors = [...(this.sim.encounters?.entities.values() || [])].filter(a => currentActor(this.sim, a) && effectStage.has(a.kind) && alive(a)).sort((a,b) => a.id-b.id);
    if (cars.length > NUKE_LIMITS.cars || actors.length > NUKE_LIMITS.actors) return null; // never silently partial-clear
    return { cars: Object.freeze(cars), actors: Object.freeze(actors) };
  }
  /** effects must be dedicated authority methods, NOT generic Sim.blast.
   * clearCar/clearActor suppress blast/director/fuse chains and cannot dispatch
   * incoming kill credit. chipBoss must return actual dealt <= supplied budget.
   */
  activate(message, requester, effects) {
    if (this.closed || !message || Object.getPrototypeOf(message) !== Object.prototype ||
      Object.keys(message).length !== 3 || message.t !== 'nuke' || message.runId !== this.runId ||
      !['local','peer'].includes(requester) || !Number.isSafeInteger(message.seq) || message.seq <= 0 || message.seq > 0x7fffffff ||
      message.seq <= this.requestSeq[requester]) return { ok: false, reason: 'invalid-or-replayed' };
    // An early rejected request cannot be replayed later after readiness appears.
    this.requestSeq[requester] = message.seq;
    if (this.resolving || !playerLive(this.sim) || !this.ready) return { ok: false, reason: 'unavailable' };
    const plan = this.plan();
    if (!plan || typeof effects?.clearCar !== 'function' || typeof effects?.clearActor !== 'function' || typeof effects?.chipBoss !== 'function') return { ok: false, reason: 'unsafe-effect' };
    const epoch = Object.freeze({ runId: this.runId, award: this.award });
    this.epochs.add(epoch);
    this.ready = false; this.combo = 0; this.revision++; this.resolving = true;
    const cleared = { cars: [], actors: [] }; let bossDamage = 0;
    try {
      // Fixed target membership. No newly spawned escort is added recursively.
      for (const car of plan.cars) if (currentCar(this.sim, car) && ordinaryCar(car) && alive(car)) {
        this.markNukeDerived(car, epoch); effects.clearCar(car, epoch); if (car.dead && car.exploded) cleared.cars.push(car.id);
      }
      for (const actor of plan.actors) if (currentActor(this.sim, actor) && effectStage.has(actor.kind) && alive(actor)) {
        this.markNukeDerived(actor, epoch); effects.clearActor(actor, epoch); if (actor.dead && actor.exploded) cleared.actors.push(actor.id);
      }
      bossDamage = effects.chipBoss(NUKE_LIMITS.bossDamage, NUKE_LIMITS.bossFraction, epoch);
      if (!Number.isFinite(bossDamage) || bossDamage < 0 || bossDamage > NUKE_LIMITS.bossDamage + 1e-7) throw Error('dedicated boss chip violated its total actual-damage budget');
      return { ok: true, epoch, cleared, bossDamage, state: this.state() };
    } finally { this.resolving = false; }
  }
  dispose() { this.closed = true; this.ready = false; this.combo = 0; this.sim = null; this.credited = new WeakSet(); this.nukeDerived = new WeakMap(); this.epochs = new WeakSet(); this.requestSeq = { local: 0, peer: 0 }; }
}

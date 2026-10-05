// AI partner: the GUNNER (single player as driver). Picks threats like a player would (closest shooters, rammers, elites, boss
// weapons), aims with human-ish reaction time and settling error, fires in controlled bursts, reloads in lulls, swaps to the
// right tool (shotgun close, sniper far, RPG for heavies/boss), throws grenades at bunched cars, pops medkits.
import * as THREE from 'three';
import { clamp, wrapAngle, lerp } from '../core/util.js';
import { carPoint } from '../sim/ai.js';
import { bossAimPoint } from '../sim/boss.js';
import { GUNNER_ROLES } from '../sim/car.js';
import { celebrationActive } from '../sim/victory_presentation.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3();
const ENCOUNTER_THREAT = Object.freeze({ gate: 6, barrel: 5.5, tower: 3.8, rifleman: 3.6, drone: 4, boat: 3.8, arch: 1.4, rock: 1.2 });

export class AIGunner {
  constructor(run, skill = 0.5) {
    this.run = run; this.skill = skill;
    this.target = null; this.aimErr = new THREE.Vector2(); this.retargetT = 0; this.burstT = 0; this.pauseT = 0; this.nadeCd = 6; this.swapCd = 0; this.rpgCd = 0;
    this.cmd = { dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false, reload: false, grenade: false, swap: 0, slot: -1, crouch: false, moveX: 0, moveZ: 0, lean: 0, medkit: false, viewToggle: false };
  }

  /** Candidate aim points: {p, score, kind, car?, encounter?, protected?} */
  _targets(eye) {
    const run = this.run, sim = run.sim, P = run.player, out = [];
    for (const car of sim.cars.values()) {
      if (car.kind !== 'enemy' || car.exploded) continue;
      const dist = car.veh.pos.distanceTo(P.veh.pos);
      if (dist > 170) continue;
      const up = car.veh.restComHeight;
      const d = car.crew.driver, shooters = GUNNER_ROLES.filter(role => car.crew[role]?.alive && car.spec.seats[role]);
      const threat = (shooters.length ? 1.6 + .2 * (shooters.length - 1) : 0.6) + (car.ai && car.ai.behavior === 'rammer' ? 1.2 : 0) + (car.elite ? 1.5 : 0) + (car.spec.explosive ? 1 : 0);
      const base = threat * 60 / (dist + 15);
      // Armored stage enemies have one authored vulnerable zone. Do not spend
      // shots on their protected crew/body or on an inferred fuel position.
      if (car.spec.weakpoint) {
        const p = _armoredPoint(car, eye, new THREE.Vector3());
        if (p) out.push({ p, car, protected: true, score: base * 2.6 + 1.5, kind: 'weak' });
        continue;
      }
      // prefer the gunner who is shooting at us, else the driver (crashes!), else the fuel tank of big trucks
      for (const role of shooters) out.push({ p: _crewPoint(car, role), car, score: base * 1.2, kind: role });
      if (d?.alive && car.spec.seats.driver) { const s = car.spec.seats.driver; out.push({ p: _pt(car, s[0], s[1] + 0.55 - up, s[2]), car, score: base * (dist < 60 ? 1.1 : 0.8), kind: 'driver' }); }
      if (car.spec.explosive || car.spec.mass > 4000) out.push({ p: _pt(car, 0, 0.62 - up, -car.spec.length / 2 + 0.6), car, score: base * 1.3, kind: 'fuel' });
      out.push({ p: car.veh.pos.clone(), car, score: base * 0.5, kind: 'body' });
      // warlords only really die through their glowing weak point: that is THE target once one is in the fight
      if (car.elite && car.weakPoint) out.push({ p: carPoint(car, car.weakPoint.c, new THREE.Vector3()), car, score: base * 2.6 + 1.5, kind: 'weak' });
    }
    // Static gates and elevated/mobile shooters are not cars. The encounter
    // manager knows which current support/canister can actually be damaged.
    const encounters = sim.encounters;
    if (encounters?.targets) for (const actor of encounters.targets()) {
      const p = this._encounterPoint(actor, eye, new THREE.Vector3());
      if (!p) continue;
      const dist = p.distanceTo(P.veh.pos), ahead = _ahead(actor.pos, P);
      if (actor.kind === 'gate' && ahead < -8) continue; // a passed gate is no longer blocking our route
      const weight = ENCOUNTER_THREAT[actor.kind];
      if (!weight) continue;
      const lateral = Math.abs(_lateral(actor.pos, P));
      const nearPath = lateral < (P.spec?.width || 2) / 2 + 2.5;
      const urgent = nearPath && ahead > -8 && ahead < 90 && (actor.kind === 'gate' || actor.kind === 'barrel');
      out.push({ p, encounter: actor, score: weight * 60 / (dist + 15) + (urgent ? 3 : 0), kind: actor.kind });
    }
    const B = sim.boss;
    if (B && !B.dead && B.pos.distanceTo(P.veh.pos) < 180) {
      // the best part we can see AND damage right now (phases seal later parts)
      const p = bossAimPoint(B, eye);
      if (p) out.push({ p, boss: true, score: 3, kind: 'boss' });
    }
    // only what we can see from the bed (not through our own cab too much)
    return out.filter((t) => { _d.copy(t.p).sub(eye); return _d.length() > 3; });
  }

  _encounterPoint(actor, eye, out) {
    const manager = this.run.sim.encounters, entities = manager?.entities || manager?.actors;
    const range = actor?.kind === 'boat' ? 260 : 170;
    if (!actor?.isStageEncounter || !entities || entities.get(actor.id) !== actor || actor.dead || actor.exploded || !actor.shootable
      || actor.pos.distanceToSquared(this.run.player.veh.pos) > range * range || typeof manager.aimPoint !== 'function') return null;
    if (actor.kind === 'gate' && _ahead(actor.pos, this.run.player) < -8) return null;
    const p = manager.aimPoint(actor, eye, out);
    if (!p || ![p.x, p.y, p.z].every(Number.isFinite) || p.distanceToSquared(eye) <= 9) return null;
    // The actor's own ray only proves that its zones face us. Use the same
    // terrain/prop query as real shots before accepting a shoreline target.
    const ctx = this.run.gunner?.ctx;
    if (ctx?.raycastWorld) {
      _d.copy(p).sub(eye); const distance = _d.length(); _d.multiplyScalar(1 / distance);
      const hit = actor.raycast(eye, _d, distance + .5);
      if (!hit) return null;
      const world = ctx.raycastWorld(eye, _d, hit.t);
      if (world && world.t <= hit.t) return null;
    }
    return out.copy(p);
  }

  /** Refresh only the chosen live actor between selection ticks, reusing its aim vector. */
  _refreshTarget(t, eye) {
    if (t.encounter) {
      if (!this._encounterPoint(t.encounter, eye, _p)) return false;
      t.p.copy(_p); return true;
    }
    const car = t.car, run = this.run;
    if (!car || run.sim.cars.get(car.id) !== car || car.kind !== 'enemy' || car.exploded || car.veh.pos.distanceToSquared(run.player.veh.pos) > 170 * 170) return false;
    if (t.protected) {
      if (!_armoredPoint(car, eye, _p) || _p.distanceToSquared(eye) <= 9) return false;
      t.p.copy(_p); return true;
    }
    const up = car.veh.restComHeight;
    switch (t.kind) {
      case 'gunner': case 'gunner2': case 'gunner3': case 'gunner4': {
        if (!car.crew[t.kind]?.alive || !car.spec.seats[t.kind]) return;
        _crewPoint(car, t.kind, _p); break;
      }
      case 'driver': {
        if (!car.crew.driver.alive) return;
        const s = car.spec.seats.driver; _pt(car, s[0], s[1] + 0.55 - up, s[2], _p); break;
      }
      case 'fuel':
        if (!(car.spec.explosive || car.spec.mass > 4000)) return;
        _pt(car, 0, 0.62 - up, -car.spec.length / 2 + 0.6, _p); break;
      case 'body': _p.copy(car.veh.pos); break;
      case 'weak':
        if (!(car.elite && car.weakPoint)) return;
        carPoint(car, car.weakPoint.c, _p); break;
      default: return;
    }
    // Match candidate filtering: keep the previous point until retargeting if the point is unavailable or too near.
    if (_p.distanceToSquared(eye) > 9) t.p.copy(_p);
  }

  update(dt, gunner, eye) {
    const run = this.run, sim = run.sim, P = run.player, c = this.cmd;
    c.fire = c.firePressed = c.reload = c.grenade = c.medkit = false; c.slot = -1; c.swap = 0; c.dYaw = 0; c.dPitch = 0; c.ads = false;
    if ((sim.state !== 'run' && !celebrationActive(sim)) || !P.crew.gunner || P.dead || P.exploded) return c;
    this.retargetT -= dt; this.swapCd -= dt; this.nadeCd -= dt; this.rpgCd -= dt;
    // A destroyed/replaced encounter or a now-hidden armored weak point must
    // stop receiving fire immediately, even between reaction-time scans.
    if (this.target && (this.target.encounter || this.target.protected) && this._refreshTarget(this.target, eye) === false) {
      this.target = null; this.retargetT = 0;
    }
    // ---------------- choose a target (reaction time)
    if (this.retargetT <= 0 || !this.target || (this.target.car && this.target.car.exploded)) {
      const ts = this._targets(eye);
      let best = null; for (const t of ts) if (!best || t.score > best.score) best = t;
      if (best && (!this.target || best.car !== this.target.car || best.encounter !== this.target.encounter || best.kind !== this.target.kind)) {
        this.aimErr.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.06).multiplyScalar(1.4 - this.skill); // fresh target: start a bit off
        this.pauseT = lerp(0.7, 0.3, this.skill);                                                                     // reaction
      }
      this.target = best; this.retargetT = 0.5 + Math.random() * 0.4;
    }
    const t = this.target;
    const w = gunner.weapon;
    if (!t) { if (gunner.magNow < w.mag * 0.6 && !gunner.reloading) c.reload = true; return c; }
    // refresh the aim point on the moving car
    if (t.car || t.encounter) this._refreshTarget(t, eye);
    const dist = t.p.distanceTo(eye);
    // ---------------- weapon choice
    if (this.swapCd <= 0) {
      const slots = gunner.slots;
      const has = (id) => slots.indexOf(id);
      let want = gunner.cur;
      // Rockets splash hulls; a sealed vehicle's small exposed fuel zone needs
      // the normal aimed gun path rather than an invulnerable-body explosion.
      const heavy = !t.protected && (t.kind === 'weak' || (t.car && (t.car.spec.mass > 2500 || t.car.elite)));
      const auto = ['minigun', 'lmg', 'rifle', 'smg', 'revolver', 'pistol'].find((id) => has(id) >= 0);
      if (t.boss) {
        // the war-train: sustained fire wins; the RPG only when it is already loaded (never sit through its reload)
        const rpgReady = has('rpg') >= 0 && gunner.mag[has('rpg')] > 0 && !(gunner.cur === has('rpg') && gunner.reloading);
        want = rpgReady && dist > 18 && dist < 140 && this.rpgCd <= 0 ? has('rpg') : (auto ? has(auto) : want);
        if (want === has('rpg')) this.rpgCd = 6;
      } else if (has('rpg') >= 0 && heavy && dist > 18 && dist < 140) want = has('rpg');
      else if (has('shotgun') >= 0 && dist < 14) want = has('shotgun');
      else if (!t.boss && has('sniper') >= 0 && dist > 90) want = has('sniper');
      else if (!t.boss && auto) want = has(auto);
      if (want !== gunner.cur) { c.slot = want; this.swapCd = t.boss ? 1.2 : 2.5; }
    }
    // ---------------- aim: turn-rate limited toward target + settling error
    _d.copy(t.p).sub(eye).normalize();
    // a human-ish tracking error that never quite settles (slow drift + faster tremor): ~35-50% of rounds land, not 70%+
    this.swayT = (this.swayT || 0) + dt;
    const amp = lerp(0.03, 0.012, this.skill) * (t.boss ? 0.6 : 1);
    const nx = (Math.sin(this.swayT * 1.3) + 0.6 * Math.sin(this.swayT * 3.7 + 1.1)) * amp, ny = (Math.sin(this.swayT * 1.1 + 2) + 0.5 * Math.sin(this.swayT * 4.3)) * amp * 0.6;
    const wantYaw = Math.atan2(_d.x, _d.z) + this.aimErr.x + nx, wantPitch = Math.asin(clamp(_d.y, -1, 1)) + this.aimErr.y + ny;
    this.aimErr.multiplyScalar(Math.exp(-dt * lerp(2.5, 6, this.skill)));
    const rate = lerp(3.5, 7, this.skill) * dt;
    const dy = wrapAngle(wantYaw - gunner.yaw), dp = wantPitch - gunner.pitch;
    c.ads = w.mode !== 'pump' && dist > 18;
    // the controller scales look input while aiming down sights; undo that so corrections land fully
    const adsMul = c.ads ? (w.scope ? 0.28 : 0.6) : 1;
    c.dYaw = clamp(dy, -rate, rate) / adsMul; c.dPitch = clamp(dp, -rate, rate) / adsMul;
    // wobble: humans don't hold perfectly still on a truck bed
    c.dYaw += (Math.random() - 0.5) * 0.004 * (1.2 - this.skill); c.dPitch += (Math.random() - 0.5) * 0.003 * (1.2 - this.skill);
    const onTarget = Math.abs(dy) < Math.max(0.008, 0.5 / Math.max(dist, 6)) && Math.abs(dp) < Math.max(0.008, 0.4 / Math.max(dist, 6));
    const nearTarget = Math.abs(dy) < Math.max(0.02, 1.3 / Math.max(dist, 6)) && Math.abs(dp) < Math.max(0.016, 0.9 / Math.max(dist, 6)); // single shots: pulled a bit early
    // ---------------- trigger discipline
    if (this.pauseT > 0) this.pauseT -= dt;
    else if ((onTarget || (w.mode !== 'auto' && nearTarget)) && dist < w.range * 0.95) {
      if (w.mode === 'auto') {
        this.burstT += dt;
        c.fire = true;
        if (this.burstT > lerp(0.5, 1.1, this.skill) * (t.boss ? 2.2 : 1)) { this.burstT = 0; this.pauseT = t.boss ? 0.1 : 0.18; c.fire = false; } // let the recoil settle
      } else {
        // semi / pump / bolt: a fresh trigger pull at a human cadence (a held trigger only fires once)
        this.pullT = (this.pullT || 0) - dt;
        if (this.pullT <= 0) { c.fire = true; c.firePressed = true; this.pullT = Math.max(60 / (w.rpm || 120), lerp(0.55, 0.32, this.skill)) * (0.85 + Math.random() * 0.4); }
      }
    }
    this._pressed = c.fire;
    if (t.boss && w.mode !== 'auto' && gunner.magNow === 0 && this.swapCd > 0.3) this.swapCd = 0.3;   // fired the rocket: swap back, don't reload
    // ---------------- reload in lulls / when dry
    const rocketDry = t.boss && w.mode !== 'auto' && gunner.magNow === 0;   // swap to the gun instead (it reloads another time)
    if (!gunner.reloading && !rocketDry && (gunner.magNow === 0 || (gunner.magNow < w.mag * 0.25 && (!onTarget || dist > 80)))) c.reload = true;
    // reload the rocket in a lull, away from the fight
    if (!t.boss && gunner.weaponId === 'rpg' && gunner.magNow === 0 && !gunner.reloading) c.reload = true;
    // ---------------- grenades at bunched cars close behind
    if (this.nadeCd <= 0 && gunner.grenades > 0 && t.car && !t.protected && dist > 12 && dist < 38) {
      let bunch = 0; for (const car of sim.cars.values()) if (car.kind === 'enemy' && !car.exploded && car.veh.pos.distanceTo(t.car.veh.pos) < 9) bunch++;
      if (bunch >= 2) { c.grenade = true; this.nadeCd = 9; }
    }
    // ---------------- medkit when the shared hull is hurting
    if (P.hp < P.maxHp * 0.28) c.medkit = true;
    return c;
  }
}

function _pt(car, x, y, z, out = new THREE.Vector3()) { return out.set(x, y, z).applyQuaternion(car.veh.quat).add(car.veh.pos); }

function _crewPoint(car, role, out = new THREE.Vector3()) {
  const seat = car.spec.seats[role], crew = car.crew[role];
  return _pt(car, seat[0] + (crew.x || 0), seat[1] + 1.25 - car.veh.restComHeight - (crew.crouch ? .42 : 0), seat[2] + (crew.z || 0), out);
}

function _armoredPoint(car, eye, out) {
  const weak = car.spec.weakpoint, zone = weak && car.zones?.find(row => row.kind === weak.zone);
  if (!zone || !Array.isArray(zone.c) || zone.c.length !== 3 || !zone.c.every(Number.isFinite) || typeof car.raycast !== 'function') return null;
  carPoint(car, zone.c, out); _d.copy(out).sub(eye); const distance = _d.length();
  if (!Number.isFinite(distance) || distance <= 3) return null;
  _d.multiplyScalar(1 / distance);
  const hit = car.raycast(eye, _d, distance + .5);
  if (!hit || hit.zone?.kind !== zone.kind || hit.throughBody || hit.through) return null;
  return out;
}

function _ahead(pos, player) {
  const fwd = player.veh.fwd, x = fwd?.x ?? 0, z = fwd?.z ?? 1, length = Math.hypot(x, z) || 1;
  return ((pos.x - player.veh.pos.x) * x + (pos.z - player.veh.pos.z) * z) / length;
}
function _lateral(pos, player) {
  const fwd = player.veh.fwd, x = fwd?.x ?? 0, z = fwd?.z ?? 1, length = Math.hypot(x, z) || 1;
  return ((pos.x - player.veh.pos.x) * z - (pos.z - player.veh.pos.z) * x) / length;
}

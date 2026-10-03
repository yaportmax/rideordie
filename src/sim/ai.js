// Enemy brains. Driving = keep a SLOT around the player (behind / alongside / ahead) and run ATTACK moves with readable tells
// (side-swipe: swing out then slam in; brake-check: brake lights then stand on the brakes; ram: horn + nitro then charge).
// Gunnery = wind-up (gunner shoulders the gun, glint) -> burst that walks onto the truck (leading, spread, recovering error).
// Dead drivers slump onto the wheel: jammed throttle + yanked wheel + slide, steered into whatever is next to them.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, wrapAngle, rng } from '../core/util.js';
import { HALF_ROAD } from '../data/biomes.js';
import { drivingLaneTarget } from '../world/driving_plan.js';
import { GRAVITY } from './physics.js';
import { celebrationActive } from './victory_presentation.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3(), _f = new THREE.Vector3(), _m = new THREE.Vector3(), _q = new THREE.Quaternion();
const _pt = {};

/** Local (model-frame) point -> world. */
export function carPoint(car, local, out) {
  const v = car.veh;
  out.set(local[0], local[1] - v.restComHeight, local[2]).applyQuaternion(v.quat).add(v.pos);
  return out;
}

const LANE_LIMIT = HALF_ROAD - 1.6;

/** Lateral offsets belong to a route, never to another route's centreline. */
export function enemyDrivingContext(road, car, player, out = {}) {
  const branch = car.route && road.drivingBranch?.(car.route);
  out.branch = branch || null; out.route = branch?.id || null;
  out.halfWidth = branch ? branch.width / 2 : HALF_ROAD;
  out.carD = car.d;
  out.crossRoute = (car.route || null) !== (player?.route || null);
  out.playerD = player?.d ?? 0;
  if (out.crossRoute && player) {
    const p = road.drivingPointAt
      ? road.drivingPointAt(player.s, 0, out.route, out.point || (out.point = {}))
      : road.pointAt(player.s, 0, out.point || (out.point = {}));
    out.playerD = (player.veh.pos.x - p.x) * Math.cos(p.th) - (player.veh.pos.z - p.z) * Math.sin(p.th);
  }
  return out;
}
// gap = player.s - car.s  (> 0: the car is BEHIND the player)
const SLOT = {
  chaser: (r) => ({ gap: r.range(12, 26), lat: r.range(-2.6, 2.6) }),
  flanker: (r) => ({ gap: -r.range(4, 10), lat: 4.3 }),
  leader: (r) => ({ gap: -r.range(15, 24), lat: 0 }),
  blocker: (r) => ({ gap: -r.range(10, 15), lat: 0 }),
  rammer: (r) => ({ gap: r.range(14, 20), lat: r.range(-1.5, 1.5) }),
  heavy: (r) => ({ gap: -r.range(18, 28), lat: 0 }),
  dropper: () => ({ gap: -55, lat: 0 }),
  summoner: (r) => ({ gap: r.range(-4, 6), lat: 5.4 }),
};

export class EnemyBrain {
  /** cfg: {behavior, skill, level, guns, side?, mode?: 'ambush'|'overtake', next?, pattern?} */
  constructor(car, sim, cfg) {
    this.car = car; this.sim = sim;
    this.skill = cfg.skill; this.level = cfg.level;
    this.r = rng((car.id * 7919 + 17) >>> 0);
    this.side = cfg.side ?? (this.r() < 0.5 ? 1 : -1);
    this.phase = this.r() * 6.28;
    this.t = 0; this.stuckT = 0;
    this.pattern = cfg.pattern || null;            // miniboss attack pattern
    this.mode = cfg.mode || 'engage';               // 'ambush' (parked ahead, waiting) | 'overtake' (pass, then take `next`) | 'engage'
    this.next = cfg.next || null;
    this.setBehavior(cfg.behavior, cfg.gap);
    this.maxSpeed = car.spec.engine.vmax * 0.97;
    this.atk = null;
    const L = this.level;
    this.atkCd = this.r.range(2.5, 5) * lerp(1.4, 0.8, clamp(L, 0, 1));
    this.laneT = this.r.range(2, 5); this.laneOff = 0;
    this.guns = cfg.guns; // {gunner: gunDef, gunner2: gunDef}
    this.gunRoles = Object.keys(this.guns);
    this.state = {}; // per gunner
    for (const role of this.gunRoles) this.state[role] = { mode: 'idle', t: this.r.range(0.6, 1.8), burst: 0, fireT: 0, aimAt: 'body', err: new THREE.Vector3(), yaw: car.crew[role].aimYaw, pitch: 0 };
    this.tgt = new THREE.Vector3();
    this.hadGunner = this.gunRoles.length > 0;
  }

  setBehavior(b, gap) {
    this.behavior = b;
    const s = (SLOT[b] || SLOT.chaser)(this.r);
    this.gapTarget = gap ?? s.gap; this.lat = s.lat;
    this.atk = null;
  }

  /**
   * What this raider is about to do, for HUD chevrons / mirrors / car lights (also sent to the gunner peer in snapshots):
   * 'ram' (charging you: ram / side-swipe / crush, from the tell on), 'block' (brake-check in front), 'shoot' (a gunner is
   * winding up or firing at you), or null. Precedence: ram > block > shoot.
   */
  get intent() {
    if (this.car.driverless || this.car.exploded) return null;
    const a = this.atk;
    if (a && a.phase !== 'recover' && a.phase !== 'line') {
      if (a.kind === 'ram' || a.kind === 'swipe' || a.kind === 'crush') return 'ram';
      if (a.kind === 'brake') return 'block';
    }
    for (const role of this.gunRoles) { const st = this.state[role]; if (st.mode === 'aim' || st.mode === 'burst') return 'shoot'; }
    return null;
  }

  /** How eager this raider is: attack cooldown in seconds, shrinking with difficulty. */
  _cooldown(base) { return base * lerp(1.35, 0.72, clamp(this.level, 0, 1.2)) * this.r.range(0.75, 1.3) * (this.car.elite ? 0.6 : 1); }

  _tell(kind, extra) { this.sim.emit({ t: 'enemyTell', id: this.car.id, kind, ...extra }); }

  update(dt) {
    const car = this.car, sim = this.sim, veh = car.veh, P = sim.player;
    this.t += dt;
    this.drivingSlice = false; this.stageAvoiding = false; this.roadblockAvoiding = false;
    if (car.exploded) return;
    if (car.driverless || !car.crew.driver.alive) { this._deadDriver(dt); this.gunnery(dt); return; }
    if (!P || P.exploded) { veh.input.throttle = 0.4; veh.input.steer = 0; veh.input.brake = 0; veh.input.nitro = false; return; }
    if (sim.boss?.dead && !celebrationActive(sim)) { veh.input.throttle = 0; veh.input.brake = 0.6; veh.input.nitro = false; this.gunnery(dt); return; }   // scatter
    const path = enemyDrivingContext(sim.road, car, P, this._routeContext || (this._routeContext = {}));
    const pd = path.playerD, cd = path.carD, half = path.halfWidth;
    if (path.crossRoute && this.atk) this._endAttack(2);
    if (car.bossClear) {   // the war-train is here: the road pack peels off and drops back (the Leviathan brings its own escort)
      const side = cd >= 0 ? 1 : -1, want = side * (path.branch ? Math.max(0, half - car.spec.width / 2 - 0.35) : 6.2);
      const tp = sim.road.drivingPointAt
        ? sim.road.drivingPointAt(car.s + 20 + veh.speed * 0.4, want, path.route, this._rp || (this._rp = {}))
        : sim.road.pointAt(car.s + 20 + veh.speed * 0.4, want, this._rp || (this._rp = {}));
      const err = Math.atan2(tp.x - veh.pos.x, tp.z - veh.pos.z) - Math.atan2(veh.fwd.x, veh.fwd.z);
      veh.input.steer = Math.max(-1, Math.min(1, Math.atan2(Math.sin(err), Math.cos(err)) * 2)); veh.input.throttle = 0; veh.input.brake = 0.35; veh.input.nitro = false;
      return;
    }
    const road = sim.road;
    const pv = Math.max(0, P.veh.vf), gap = P.s - car.s;      // gap > 0: we are behind the player
    const speed = veh.vf;
    const L = this.level;
    // a raider whose gunner died goes for the ram
    if (this.hadGunner && this.behavior !== 'rammer' && !this.pattern && !this.gunRoles.some((r) => car.crew[r]?.alive)) {
      if (!this.enragedT) this.enragedT = this.t;
      else if (this.t - this.enragedT > 1.2) {
        this.hadGunner = false;
        // some drivers go berserk and ram, the rest lose their nerve and fall back out of the fight
        if (this.r() < 0.45 + 0.4 * L) { this.setBehavior('rammer'); this.atkCd = 0.8; this._tell('berserk'); } else this.setBehavior('chaser', 75);
      }
    }
    let dT, vDes, brake = 0, nitro = false, horn = false;
    // ---------------- mode: ambush — idling along the shoulder ahead, floors it as you arrive (ends up in your windshield)
    if (this.mode === 'ambush') {
      dT = this.parkD ?? cd;
      vDes = pv * 0.5; 
      if (gap > -62) { this.mode = 'engage'; this.setBehavior(this.next || this.behavior); this._tell('peelOut'); horn = true; this.launchT = this.t; }
      this._drive(dt, dT, vDes, 0, false, horn, true);
      this.gunnery(dt);
      return;
    }
    this.atkCd -= dt;
    this.laneT -= dt;
    let slotGap = this.gapTarget, slotLat;
    switch (this.behavior) {
      case 'flanker': slotLat = this.side * (this.lat + 0.35 * Math.sin(this.t * 0.7 + this.phase)); break;
      case 'summoner': slotLat = this.side * this.lat; break;
      case 'leader': case 'heavy': {
        // weave between the player's lane and the lanes either side of it: the gunner gets an angle, the driver has to watch it
        if (this.laneT <= 0) { this.laneT = this.r.range(3, 6.5); this.laneOff = this.r.pick(this.behavior === 'heavy' ? [0, 0, -2, 2] : [0, -3.4, 3.4, 0]); }
        // he's closing on us fast in our lane and we're not brake-checking: get out of the way (no free rear-end damage)
        if (!this.atk && gap > -12 && gap < 2 && Math.abs(cd - pd) < 2.4 && pv > speed + 2 && this.behavior === 'leader') { this.laneOff = cd >= pd ? 3.6 : -3.6; this.laneT = 1.5; }
        slotLat = this.laneOff; break;
      }
      case 'blocker': slotLat = 0; break;
      case 'dropper': slotLat = Math.sin(this.t * 0.5) * 2; break;
      case 'rammer': slotLat = this.lat; break;
      default: slotLat = this.lat * Math.sin(this.t * 0.35 + this.phase) * 1.2 + this.lat * 0.4;
    }
    if (this.mode === 'overtake') {
      // blast past close alongside (+30-50 km/h, nitro), then swerve across the bow and settle in front as a leader/flanker
      slotLat = this.side * 3.6; slotGap = -30;
      if (gap < -9 && !this.cutT) { this.cutT = this.t; this._tell('cutIn'); if (this.r() < 0.6) sim.emit({ t: 'horn', id: car.id }); }
      if (this.cutT) slotLat = -this.side * 1.2;          // across the bow
      if (this.cutT && (this.t - this.cutT > 1.3 || gap < -24)) { this.mode = 'engage'; this.cutT = 0; this.setBehavior(this.next || 'leader'); this.laneOff = 0; this.laneT = this.r.range(1.5, 3); this.atkCd = Math.min(this.atkCd, this.r.range(0.8, 2.2)); }
    }
    // a slot ahead of the player is reached by PASSING in the next lane (not by tailgating him)
    if (slotGap < -2 && gap > -9 && this.mode !== 'overtake') {
      if (gap > 12 || this.passSide === undefined) this.passSide = cd - pd >= 0 ? 1 : -1;
      if (Math.abs(pd + this.passSide * 4.6) > half + 0.8 && gap > 8) this.passSide = -this.passSide;
      if (this.behavior !== 'flanker' || Math.sign(slotLat) !== this.passSide) slotLat = this.passSide * 4.6;
    }
    if (this.mode === 'overtake' && Math.abs(pd + slotLat) > half + 0.8 && gap > 8) { this.side = -this.side; slotLat = -slotLat; }
    // a slot BEHIND the player while we're in front of him (e.g. a gunner-less raider turned rammer): fall back through the
    // next lane, never by braking in his face
    let dropBack = false;
    if (slotGap > 2 && gap < 3 && this.mode !== 'overtake') { const sd = cd - pd >= 0 ? 1 : -1; if (Math.abs(pd + sd * 4.6) > half + 0.8) slotLat = -sd * 4.6; else slotLat = sd * 4.6; dropBack = true; }
    // flank slots may use the shoulder; if the player hugs that edge, go round to the other side
    if ((this.behavior === 'flanker' || this.behavior === 'summoner') && Math.abs(pd + slotLat) > half + 1.2 && gap > 7) { this.side = -this.side; slotLat = -slotLat; }
    // a roadblock is coming up for the player: raiders ahead run for the gap well in front, the rest drop back — the gap is his
    const rbP = !path.branch && !path.crossRoute ? road.featuresIn(P.s + 5, P.s + 190, 'roadblock')[0] : null;
    if (rbP && rbP.s0 > car.s) {
      if (gap < -45) slotGap = Math.min(slotGap, -70);
      else { slotGap = Math.max(slotGap, 18); if (this.mode === 'overtake') this.mode = 'engage'; }
      this.atkCd = Math.max(this.atkCd, 1.5);
    }
    dT = pd + slotLat;
    // speed: close on the slot; the approach from far away is quick, the final metres are gentle
    // (the closing speed shrinks with the pace: at 200 km/h a +24 m/s lunge ends in the desert)
    vDes = pv + clamp((gap - slotGap) * 0.45, -12, lerp(26, 15, clamp(pv / 60, 0, 1)));
    if (this.mode === 'overtake') {
      if (gap > -10 && gap < 28) { vDes = Math.max(vDes, pv + (this.passV || (this.passV = this.r.range(10.5, 15)))); nitro = true; }   // the pass itself: ~40-55 km/h faster, no braking into it
      else if (this.cutT) vDes = pv + 5;
    }
    if (dropBack) vDes = Math.max(vDes, pv - (Math.abs(cd - pd) > 3 ? 8 : 2));
    if (this.launchT !== undefined && this.t - this.launchT < 3) nitro = true;   // peel-out
    // chasers get bored and come forward (they are the gunner's problem at first, the driver's next)
    if (this.behavior === 'chaser' && this.mode === 'engage' && this.atkCd <= 0 && gap < 45) {
      if (this.guns.gunner && this.r() < 0.6 + 0.3 * L) { this.mode = 'overtake'; this.next = this.r() < 0.55 ? 'leader' : 'flanker'; this.side = pd > 0 ? -1 : 1; this._tell('overtake'); }
      else { this.setBehavior('rammer'); }
      this.atkCd = this._cooldown(6);
    }
    // ---------------- attacks
    const relLat = cd - pd;
    if (!path.crossRoute && !this.atk && this.atkCd <= 0 && this.mode === 'engage' && this._canAttack(gap, relLat)) this._startAttack(gap, relLat);
    if (this.atk) {
      const a = this.atk; a.t += dt;
      switch (a.kind) {
        case 'swipe': {
          // tell: swing out ~1.5 m for a beat, then slam the flank
          if (a.phase === 'wind') { dT = pd + a.side * 5.8; vDes = pv + clamp((gap + 1.5) * 0.5, -6, 8); if (a.t > a.wind) { a.phase = 'hit'; a.t = 0; } }
          else if (a.phase === 'hit') { dT = pd + a.side * 0.6; vDes = pv + clamp((gap + 0.5) * 0.6, -5, 6) + 1; if (car.elite || this.pattern || path.branch ? a.t > .9 || Math.abs(relLat) < 2.1 : a.contact || gap < -(car.spec.length + P.spec.length) / 2 - 2 || a.t > 1.4) { a.phase = 'recover'; a.t = 0; } }
          else { dT = pd + a.side * 4.6; if (a.t > 1.0) this._endAttack(5.5); }
          break;
        }
        case 'brake': {
          dT = pd + clamp(relLat, -1.2, 1.2);
          if (a.phase === 'wind') { vDes = pv - 1; brake = 0.2; if (a.t > a.wind) { a.phase = 'hit'; a.t = 0; a.v0 = pv; } }
          else if (a.phase === 'hit') { vDes = a.v0 * 0.72; brake = this.behavior === 'heavy' ? 0.4 : 0.5; if (a.t > a.hold || gap > 1) { a.phase = 'recover'; a.t = 0; } }
          else { vDes = pv + 12; nitro = a.t < 0.8; dT = pd + (relLat >= 0 ? 3.8 : -3.8); if (a.t > 1.4) this._endAttack(6.5); }
          break;
        }
        case 'ram': {
          // line up behind a rear corner, hoot, then charge (nitro) into it — a PIT attempt
          // Ordinary charges commit closer to the truck's centre instead of
          // settling into a glancing .9m corner touch. Authored boss/branch
          // patterns keep their existing corner and tell alignment.
          const cornerOffset = car.elite || this.pattern || path.branch || path.crossRoute ? .9 : .25;
          const corner = pd + a.side * cornerOffset;
          if (a.phase === 'line') { dT = corner; vDes = pv + clamp((gap - 11) * 0.5, -8, 12); if (Math.abs(gap - 11) < 5 && Math.abs(relLat - a.side * cornerOffset) < 1.4) { a.phase = 'wind'; a.t = 0; horn = true; this._tell('ram'); } if (a.t > 7) this._endAttack(3); }
          else if (a.phase === 'wind') { dT = corner; vDes = pv; if (a.t > a.wind) { a.phase = 'hit'; a.t = 0; } }
          else if (a.phase === 'hit') { dT = corner + clamp(P.veh.vl * 0.2, -1, 1); vDes = car.elite || this.pattern || path.branch ? this.maxSpeed + 10 : pv + clamp(6 + Math.max(0, gap) * .2, 6, 12); nitro = true; if (gap < -3 || a.t > 2.4 || a.contact) { a.phase = 'recover'; a.t = 0; } }
          else { dT = pd + a.side * 5; vDes = pv - 6; if (a.t > 1.4) this._endAttack(4.5); }
          break;
        }
        case 'crush': {
          // twin miniboss: both slam in from opposite flanks at once
          if (a.phase === 'wind') { dT = pd + a.side * 6.2; vDes = pv + clamp((gap + 0.5) * 0.6, -6, 8); if (a.t > a.wind) { a.phase = 'hit'; a.t = 0; } }
          else if (a.phase === 'hit') { dT = pd + a.side * 0.2; vDes = pv + clamp(gap * 0.6, -5, 6) + 2; nitro = true; if (a.t > 1.1) { a.phase = 'recover'; a.t = 0; } }
          else { dT = pd + a.side * 5; if (a.t > 1.2) this._endAttack(9); }
          break;
        }
      }
    }
    // ---------------- dropper: rolling barrels, preceded by a visible tell.
    // Existing warlord mine patterns retain their authored timing and weapon.
    if (this.behavior === 'dropper' && car.spec.rollBarrels) {
      const eligible = !path.crossRoute && gap < -25 && gap > -110 && Math.abs(cd - pd) < 6 && veh.up.y > .65;
      if (this.barrelTellT !== undefined) {
        if (!eligible) this.barrelTellT = undefined;
        else if (this.t >= this.barrelTellT) {
          sim.encounters?.dropBarrel(sim, car);
          this.lastDrop = this.t;
          this.barrelTellT = undefined;
        }
      } else if (eligible && this.t - (this.lastDrop || 0) > 4.2) {
        this.barrelTellT = this.t + .7; this._tell('barrel', { delay: .7 });
      }
    } else if (this.behavior === 'dropper' && gap < -25 && gap > -110 && this.t - (this.lastDrop || 0) > (this.pattern ? 1.1 : 2.6)) {
      this.lastDrop = this.t;
      if (!this.pattern || (this.dropN = ((this.dropN || 0) + 1) % 4) !== 0) sim.hazards.dropEnemyMine(sim, car, 8, 55 + 50 * L);
    }
    // ---------------- summoner: calls in skirmishers
    if (this.behavior === 'summoner' || this.pattern?.summon) {
      const every = this.pattern?.summon ?? 14;
      if (this.lastSummon === undefined) this.lastSummon = this.t - every + 6;
      if (this.t - this.lastSummon > every) {
        this.lastSummon = this.t;
        const alive = [...sim.cars.values()].filter((c) => c.kind === 'enemy' && !c.exploded).length;
        if (alive < (this.pattern?.summonCap ?? 5)) {
          const kinds = this.pattern?.summonKinds || ['e_buggy', 'e_buggy'];
          kinds.forEach((k, i) => sim.director.queue(() => { const Pn = sim.player; return sim.director.spawn(sim, k, L, { behavior: 'flanker', side: i % 2 ? 1 : -1, at: { s: Pn.s - 105 - i * 12, d: (i % 2 ? 1 : -1) * 3.4, speed: Math.max(0, Pn.veh.vf) + 14 } }); }));
          sim.emit({ t: 'summon', id: car.id });
        }
      }
    }
    // ---------------- raiders know where their own roadblocks are: thread the gap
    const rb = !path.branch ? road.featuresIn(car.s + 5, car.s + 120, 'roadblock')[0] : null;
    this.roadblockAvoiding = !!rb || !!rbP;
    if (rb) { nitro = false; dT = clamp(rb.gap * 2.2, -4.6, 4.6); if (this.atk) this._endAttack(2); vDes = Math.min(vDes, 36); }
    const stage = !path.branch && drivingLaneTarget(road, car.s, car.spec.length, 220, this._stage || (this._stage = {}));
    this.stageAvoiding = !!stage;
    if (stage) {
      dT = stage.d; vDes = Math.min(vDes, stage.speed); nitro = false;
      this.drivingSlice = stage.distance < 160;
      if (this.atk) this._endAttack(2);
    }
    this._drive(dt, dT, vDes, brake, nitro, horn);
    if (veh.up.y < 0.3) { this.stuckT += dt; if (this.stuckT > 3.5 && !car.exploded && car.burning <= 0) { car.burning = 0.001; sim.emit({ t: 'fire', id: car.id }); } } else this.stuckT = 0;
    this.gunnery(dt);
  }

  _canAttack(gap, relLat) {
    const b = this.behavior;
    if (this.level < 0.03 && this.t < 8) return false;                       // first seconds of a run: let them show themselves
    if (b === 'flanker' || b === 'summoner') return gap > -12 && gap < 6 && Math.abs(relLat) > 2.6 && Math.abs(relLat) < 7.5;
    if (b === 'leader' || b === 'blocker' || b === 'heavy') return gap < -13 && gap > -32 && Math.abs(relLat) < 2.4 && this.sim.player.veh.vf > 12;
    if (b === 'rammer') return gap > 4 && gap < 60;
    return false;
  }

  _startAttack(gap, relLat) {
    const b = this.behavior, L = this.level;
    if (this.pattern?.crush && this.pattern.partner && !this.pattern.partner.exploded) {
      // twin: occasionally both brothers crush together (the brother gets the same order)
      if (this.r() < 0.45 && Math.abs(gap) < 8) {
        const side = relLat >= 0 ? 1 : -1;
        this.atk = { kind: 'crush', phase: 'wind', t: 0, wind: 0.8, side };
        const pb = this.pattern.partner.ai; if (pb && !pb.atk) pb.atk = { kind: 'crush', phase: 'wind', t: 0, wind: 0.8, side: -side };
        this._tell('crush', { horn: true }); this.sim.emit({ t: 'horn', id: this.car.id, heavy: true });
        return;
      }
    }
    if (b === 'flanker' || b === 'summoner') { this.atk = { kind: 'swipe', phase: 'wind', t: 0, wind: lerp(0.7, 0.45, clamp(L, 0, 1)), side: relLat >= 0 ? 1 : -1 }; this._tell('swipe'); }
    else if (b === 'leader' || b === 'blocker' || b === 'heavy') { this.atk = { kind: 'brake', phase: 'wind', t: 0, wind: 0.45, hold: this.r.range(0.5, 0.85) * (b === 'blocker' ? 1.3 : 1) }; this._tell('brake'); if (b === 'heavy') this.sim.emit({ t: 'horn', id: this.car.id, heavy: true }); }
    else if (b === 'rammer') { this.atk = { kind: 'ram', phase: 'line', t: 0, wind: lerp(0.65, 0.4, clamp(L, 0, 1)), side: this.r() < 0.5 ? 1 : -1 }; }
  }

  _endAttack(cd) { this.atk = null; this.atkCd = this._cooldown(cd); }

  /** Called by the director when this car bumps the player (ends a ram / swipe). */
  onContact() { if (this.atk && (this.atk.kind === 'ram' || this.atk.kind === 'swipe')) this.atk.contact = true; }

  // Estimate traction from the current grounded wheels and their surface grip.
  _traction(includeTires = true) {
    let sum = 0, count = 0;
    for (const w of this.car.veh.wheels || []) if (w.grounded) { sum += (w.surface?.grip ?? 1) * (includeTires ? Math.min(1, w.grip ?? 1) : 1); count++; }
    return count ? clamp(sum / count, .1, 1) : 1;
  }

  _curveSpeed(path, curvature) {
    const car = this.car, v = car.veh, sp = car.spec, k = Math.max(curvature, 1 / 1500);
    const old = Math.sqrt(Math.max(400, 15.5 / k));
    this._curveLegacyLimit = old; this._curveTireBound = null;
    if (car.elite || this.pattern || path.branch || path.crossRoute) return old;
    const yaw = clamp(sp.hiSpeedYaw ?? .76, .5, 1);
    // Heuristic .72 authority allowance. Pure-pursuit/heading gains and
    // axle loading still require genuine trajectory checks.
    const gain = .72 * .9 * (sp.steerAssistK ?? .9) * yaw * Math.min(sp.grip.front, sp.grip.rear) * this._traction();
    const denominator = k - gain * (sp.downforce ?? .35) * .01;
    const tireLimit = denominator > 0 ? Math.sqrt(gain * GRAVITY / denominator) : Infinity;
    const conservative = Math.min(tireLimit, .72 * (sp.yawRateMax ?? 2.3) * yaw / k);
    this._curveTireBound = conservative;
    // Sliding or sparse contact cannot lift a real low-traction speed bound.
    return v.grounded < 2 || Math.abs(v.slipAngle || 0) > .18 ? Math.min(old, conservative) : conservative;
  }

  _catchUpNitro(path, curvature) {
    const car = this.car, v = car.veh, P = this.sim.player, gap = P.s - car.s;
    const lining = this.atk?.kind === 'ram' && this.atk.phase === 'line';
    if (car.elite || this.pattern || path.branch || path.crossRoute || this.mode === 'ambush' || this.stageAvoiding || this.roadblockAvoiding
        || car.dead || car.held || car.driverless || car.exploded || !car.crew.driver.alive
        || !v.driverAlive || car.engineHp <= 0 || v.engineDamage > .35 || v.stunned > 0
        || v.grounded < 2 || v.up.y < .8 || Math.abs(v.slipAngle || 0) > .12
        || Math.abs(v.vl) > 2.5 || Math.abs(path.carD) + car.spec.width / 2 > path.halfWidth
        || curvature > 1 / 240 || P.veh.vf < 18 || (this.atk && !lining)
        || gap < (lining ? 28 : 65) || gap > 260 || v.nitro <= 0 || v.nitroNeedsRelease || v.nitroRechargeLocked) return false;
    const roadHeading = this.sim.road.sample(car.s, {}).th;
    if (Math.abs(wrapAngle(roadHeading - Math.atan2(v.fwd.x, v.fwd.z))) > .15) return false;
    return !this.sim.road.featuresIn(car.s + 5, car.s + 180)
      .some(f => ['roadblock', 'stage_challenge', 'ramp', 'bridge', 'tunnel', 'overpass'].includes(f.type));
  }

  _drive(dt, dT, vDes, brakeIn, nitro, horn, shoulder = false) {
    const car = this.car, sim = this.sim, veh = car.veh, road = sim.road, speed = veh.vf, P = sim.player;
    const path = enemyDrivingContext(road, car, P, this._routeContext || (this._routeContext = {}));
    const constrained = !!path.branch || path.crossRoute;
    const lim = constrained ? Math.max(0, path.halfWidth - car.spec.width / 2 - 0.35)
      : shoulder || this.behavior === 'flanker' || this.behavior === 'summoner' || this.mode === 'overtake' ? HALF_ROAD + 0.3 : LANE_LIMIT;
    dT = clamp(dT, -lim, lim);
    // curve caution: slow down for tight corners
    const curveLook = clamp(speed * 0.6 + 8, 10, 64);
    const smK = path.branch ? path.branch.maxCurvature
      : Math.max(Math.abs(road.sample(car.s + curveLook * 1.8, _pt).k), Math.abs(road.sample(car.s + curveLook * 0.9, _pt).k), Math.abs(road.sample(car.s + 10, _pt).k));
    this.pursuitBoost = this._catchUpNitro(path, smK);
    nitro = nitro || this.pursuitBoost;
    vDes = Math.min(vDes, this.maxSpeed + (nitro ? 8 : 0));
    this._curveLimit = this._curveSpeed(path, smK);
    vDes = Math.min(vDes, this._curveLimit);
    // off the asphalt: slow down and get back on it
    const off = Math.abs(path.carD) - (constrained ? lim : HALF_ROAD + 1.5);
    if (off > 0) vDes = Math.min(vDes, Math.max(18, 45 - off * 4));
    // Keep the original far curvature warning. Only the final ordinary hit
    // aims along a nearer road point, rather than forty metres beyond a truck
    // only five metres away. Existing slew/yaw limits and physical forces own
    // the approach; this does not place either body or promise unavoidable hits.
    const committedRam = !constrained && !car.elite && !this.pattern
      && this.atk?.kind === 'ram' && this.atk.phase === 'hit';
    const look = committedRam ? Math.min(curveLook, clamp(Math.max(0, P.s - car.s) + 6, 10, 30)) : curveLook;
    // pure pursuit toward a point on the road ahead at the target lateral offset
    // lane target moves at most ~8 m/s sideways: no twitchy full-lock swerves at 200 km/h when a slot flips sides
    const rate = this.atk && this.atk.phase === 'hit' ? 12 : 8;
    this.dTs = this.dTs === undefined ? path.carD : this.dTs + clamp(dT - this.dTs, -rate * dt, rate * dt);
    // Route changes and an old wide-road attack target cannot retain a point
    // outside a narrower strip while the lateral slew catches up.
    if (constrained) this.dTs = clamp(this.dTs, -lim, lim);
    dT = this.dTs; this._lastDT = dT;
    const tp = path.branch && road.drivingPointAt
      ? road.drivingPointAt(car.s + look, dT, path.route, this._tp || (this._tp = {}))
      : road.pointAt(car.s + look, dT, this._tp || (this._tp = {}));
    const desired = Math.atan2(tp.x - veh.pos.x, tp.z - veh.pos.z);
    const heading = Math.atan2(veh.fwd.x, veh.fwd.z);
    // proper pure pursuit: the yaw rate that arcs onto the target point, as a fraction of what the tyres allow at this speed
    // (the vehicle's steering is a yaw-rate command), plus a little direct heading gain for low-speed jostling
    const err = wrapAngle(desired - heading), sp = car.spec, vv = Math.max(Math.abs(speed), 4);
    let aLat = .81 * Math.min(sp.grip.front, sp.grip.rear) * (17.5 + (sp.downforce ?? .35) * vv * vv * .01);
    let rMax = Math.min(sp.yawRateMax ?? 2.3, aLat / vv);
    if (!constrained && !car.elite && !this.pattern) {
      // Vehicle yaw-command authority averages surface grip only. Flat tyres
      // reduce tyre forces and the curve speed bound, not this denominator.
      aLat = .9 * Math.min(sp.grip.front, sp.grip.rear) * this._traction(false) * (sp.steerAssistK ?? .9)
        * (GRAVITY + (veh.grounded > 0 ? (sp.downforce ?? .35) * vv * vv * .01 : 0));
      rMax = Math.max(.05, Math.min(sp.yawRateMax ?? 2.3, aLat / vv)
        * lerp(1, sp.hiSpeedYaw ?? .76, smoothstep(18, 45, vv)));
    }
    let steer = clamp((2 * Math.sin(err) * vv / look) / rMax * 1.15 + err * (0.5 + 0.4 * this.skill), -1, 1);
    // avoid other cars ahead (not the player when attacking it; wrecks and runaway cars are noticed late -> pile-ups)
    let brakeAvoid = 0;
    const attacking = this.atk && (this.atk.phase === 'hit' || this.atk.kind === 'ram');
    for (const o of sim.cars.values()) {
      if (o === car) continue;
      if (o === P && (attacking || this.behavior === 'rammer')) continue;
      _v.copy(o.veh.pos).sub(veh.pos); const ahead = _v.dot(veh.fwd), lat = _v.dot(veh.left);
      const chaos = o.exploded || o.driverless;
      const range = chaos ? 7 + speed * 0.12 : 16 + speed * 0.3;
      if (ahead > 0 && ahead < range && Math.abs(lat) < 3.4) {
        if (!this.drivingSlice && !constrained) steer += clamp((lat >= 0 ? -1 : 1) * (1 - ahead / range) * (chaos ? 0.9 : 1.6), -1, 1);
        else if (o.veh.vf < speed + 2) brakeAvoid = Math.max(brakeAvoid, .6);
        // (an overtaker steers round the truck instead of braking behind it: the pass stays fast)
        if (o.veh.vf < speed - 2 && ahead < 10 + speed * 0.2 && !(o === P && this.mode === 'overtake' && Math.abs(lat) > 1.6)) brakeAvoid = Math.max(brakeAvoid, chaos ? 0.3 : 0.6);
      }
    }
    // at speed, full lock just breaks traction (and the drift governor takes over): keep the input under the grip limit
    const sLim = clamp(1.9 - Math.max(0, speed) / 40, 0.8, 1);
    veh.input.steer = clamp(steer, -sLim, sLim);
    this._lastVDes = vDes;
    const dv = vDes - speed;
    veh.input.throttle = brakeIn > 0.5 ? 0 : dv > 0 ? clamp(dv * 0.5, 0, 1) : 0;
    veh.input.brake = Math.max(brakeAvoid, brakeIn, dv < -3 ? clamp(-dv * 0.18, 0, 1) : 0);
    veh.input.handbrake = false; veh.input.nitro = nitro;
    if (horn && this.t - (this.hornT ?? -9) > 2) { this.hornT = this.t; sim.emit({ t: 'horn', id: car.id }); }
  }

  /** Driver shot: he slumps onto the wheel. Throttle jammed, wheel yanked toward whatever is beside him, the rear steps out. */
  _deadDriver(dt) {
    const car = this.car, veh = car.veh, sim = this.sim;
    if (this.deadT === undefined) {
      this.deadT = 0;
      // pick a victim: the nearest OTHER raider beside / just ahead (never the player: you shot him, he shouldn't punish you)
      let best = null, bs = 1e9;
      for (const o of sim.cars.values()) {
        if (o === car || o.exploded || o.kind === 'player') continue;
        _v.copy(o.veh.pos).sub(veh.pos); const ahead = _v.dot(veh.fwd), lat = _v.dot(veh.left);
        if (ahead < -6 || ahead > 45 || Math.abs(lat) > 16 || Math.abs(lat) < 0.5) continue;
        const score = Math.abs(lat) + Math.max(0, ahead) * 0.35 + (o.kind === 'player' ? 6 : 0);
        if (score < bs) { bs = score; best = o; }
      }
      if (best) { _v.copy(best.veh.pos).sub(veh.pos); this.deadSteer = (_v.dot(veh.left) >= 0 ? 1 : -1) * this.r.range(0.75, 1); this.deadVictim = best; }
      else { // nobody to take along: veer away from the player, toward the roadside (scenery / a tumble)
        const P = sim.player;
        const away = P ? ((car.route || null) === (P.route || null)
          ? (car.d - P.d >= 0 ? 1 : -1)
          : (_v.copy(P.veh.pos).sub(veh.pos).dot(veh.left) <= 0 ? 1 : -1)) : (car.d >= 0 ? 1 : -1);
        this.deadSteer = away * this.r.range(0.6, 1);
      }
      this.deadSpin = !best && this.r() < 0.35;
      this.deadJam = best ? this.r.range(2.4, 3.2) : this.r.range(1.6, 2.6);   // (foot stays down longer when there's someone to hit)
      this.sim.emit({ t: 'runaway', id: car.id, victim: best ? best.id : -1 });
    }
    this.deadT += dt;
    const T = this.deadT;
    // steer toward the victim while it is still there (the slumped body keeps the wheel over)
    let steer = this.deadSteer;
    const v = this.deadVictim;
    if (v && !v.exploded && T < 3.0) {
      _v.copy(v.veh.pos).addScaledVector(v.veh.vel, 0.25).sub(veh.pos);
      const want = wrapAngle(Math.atan2(_v.x, _v.z) - Math.atan2(veh.fwd.x, veh.fwd.z));
      steer = clamp(want * 3.5, -1, 1);
    }
    veh.input.throttle = T < this.deadJam ? 0.85 : 0;
    veh.input.brake = 0;
    veh.input.steer = steer * Math.min(1, T * 3);
    veh.input.nitro = false;
    // the rear steps out: short handbrake stabs make it slide across the lanes instead of gently arcing
    veh.input.handbrake = (this.deadSpin && T > 0.3 && T < 1.4) || (T > 0.35 && T < 0.7) || (T > 1.1 && T < 1.35);
    veh.driverAlive = T < 3.4; // let the jammed controls act on the car, then it is just a coasting wreck-in-waiting
    if (!veh.driverAlive) veh.input.handbrake = false;
    // off the road at speed with nobody at the wheel: dig in and roll
    if (!this.rolled && Math.abs(car.d) > HALF_ROAD + 1.2 && veh.speed > 16 && T < 5) {
      this.rolled = true;
      const m = veh.mass, s = Math.sign(car.d) || 1;
      _f.copy(veh.fwd).multiplyScalar(s * m * this.r.range(3.5, 5.5));
      veh.body.applyTorqueImpulse({ x: _f.x, y: _f.y + m * this.r.range(-1, 1), z: _f.z }, true);
      veh.body.applyImpulse({ x: 0, y: m * 3.2, z: 0 }, true);
    }
  }

  gunnery(dt) {
    const car = this.car, sim = this.sim, P = sim.player;
    // (no target; or the Leviathan is going down: its escort loses heart, the finale is yours)
    if (!P || P.exploded || sim.boss?.dead) { for (const role of this.gunRoles) { const c = car.crew[role]; if (c) { c.fire = false; c.ads = false; } } return; }
    for (const role of this.gunRoles) {
      const crew = car.crew[role]; const st = this.state[role]; const gun = this.guns[role];
      if (!crew || !crew.alive) { if (crew) { crew.fire = false; crew.ads = false; } continue; }
      if (this.mode === 'ambush') { crew.fire = false; crew.ads = false; continue; }
      const seat = car.spec.seats[role];
      const muzzle = carPoint(car, car.spec.gunMuzzles?.[role] || [seat[0], seat[1] + 1.35, seat[2]], _m);
      const dist = muzzle.distanceTo(P.veh.pos);
      // choose an aim point on the player's truck (+ a walking error that closes during the burst)
      const ps = P.spec.seats, zone = st.aimAt;
      let local;
      if (zone === 'cab') local = [ps.driver[0] * 0.5, ps.driver[1] + 0.45, ps.driver[2]];
      else if (zone === 'bed') local = [ps.gunner[0], ps.gunner[1] + 0.9, ps.gunner[2]];
      else {
        // bodywork: the near end / flank of the truck, low (tailgate, grille, doors, wheels) — not the people
        _t.copy(muzzle).sub(P.veh.pos).applyQuaternion(_q.copy(P.veh.quat).invert());
        const hl = P.spec.length / 2 - 0.5, hw = P.spec.width / 2 - 0.2;
        local = zone === 'tire' ? [P.spec.wheels[2].x, 0.35, P.spec.wheels[2].z] : [clamp(_t.x * 0.3, -hw, hw), 0.55, clamp(_t.z * 0.4, -hl, hl)];
      }
      carPoint(P, local, this.tgt).add(st.err);
      st.err.multiplyScalar(Math.exp(-dt * (st.mode === 'burst' ? 1.5 + 1.2 * this.skill : 0.6)));
      // predicted lead
      const rel = _w.copy(P.veh.vel).sub(car.veh.vel);
      const tFly = clamp(dist / gun.speed, 0, 1.2);
      _t.copy(this.tgt).addScaledVector(rel, tFly * (0.7 + 0.25 * this.skill));
      _f.copy(_t).sub(muzzle); const dl = _f.length(); _f.multiplyScalar(1 / dl);
      const wantYaw = Math.atan2(_f.x, _f.z), wantPitch = Math.asin(clamp(_f.y, -1, 1));
      const rate = gun.aimRate * (0.7 + 0.6 * this.skill);
      const dy = wrapAngle(wantYaw - st.yaw), dp = wantPitch - st.pitch;
      st.yaw += clamp(dy, -rate * dt, rate * dt); st.pitch += clamp(dp, -rate * dt, rate * dt);
      crew.aimYaw = st.yaw; crew.aimPitch = st.pitch;
      const aligned = Math.abs(dy) < 0.09 && Math.abs(dp) < 0.09;
      const inRange = dl < gun.range && (!gun.forwardArc || Math.abs(wrapAngle(wantYaw - Math.atan2(car.veh.fwd.x, car.veh.fwd.z))) < gun.forwardArc);
      st.t -= dt;
      switch (st.mode) {
        case 'idle':
          crew.fire = false; crew.ads = false;
          if (inRange && st.t <= 0) {
            // only a few raiders may be winding up / firing at once (attack tokens): bursts come one after another, readable
            if (!sim.director.fireToken(car, role)) { st.t = this.r.range(0.25, 0.6); break; }
            // wind-up: the gunner shoulders the gun (visible glint) before the burst — this is the driver's cue to jink
            st.mode = 'aim'; st.t = this.r.range(gun.react[0], gun.react[1]) * lerp(1.2, 0.8, this.skill);
            st.t = Math.max(st.t, gun.minimumTell || 0);
            if (gun.tell) this._tell(gun.tell, { role, delay: st.t });
            // far away they shoot at the truck; up close they go for the crew
            const u = this.r(), close = dist < 32 && !car.elite; // (warlords work on the truck itself: their HP pressure, not crew one-shots)
            st.aimAt = close ? (u < 0.5 ? 'body' : u < 0.72 ? 'cab' : u < 0.94 ? 'bed' : 'tire') : (u < 0.7 ? 'body' : u < 0.8 ? 'cab' : u < 0.9 ? 'bed' : 'tire');
          }
          break;
        case 'aim':
          crew.ads = true;
          if (!inRange) { st.mode = 'idle'; st.t = 0.6; crew.ads = false; break; }
          if (st.t <= 0 && aligned) {
            st.mode = 'burst'; st.burst = Math.round(lerp(gun.burst[0], gun.burst[1], this.r())); st.fireT = 0;
            // first rounds land short / wide and walk onto the truck: the stream is readable and dodgeable
            const e = lerp(3.4, 1.4, this.skill) * (0.7 + Math.min(1, dist / 50));
            st.err.set(this.r.range(-1, 1), this.r.range(-0.2, 0.25), this.r.range(-1, 1)).normalize().multiplyScalar(e);
          }
          break;
        case 'burst': {
          crew.fire = true; crew.ads = true;
          st.fireT -= dt;
          while (st.fireT <= 0 && st.burst > 0) {
            this.shoot(muzzle, role, gun, st);
            st.burst--; st.fireT += 1 / gun.rate;
          }
          if (st.burst <= 0) { st.mode = 'idle'; crew.fire = false; crew.ads = false; st.t = this.r.range(gun.pause[0], gun.pause[1]) * lerp(1.3, 0.8, this.skill); }
          if (!inRange) { st.mode = 'idle'; st.t = 0.5; crew.fire = false; crew.ads = false; }
          break;
        }
      }
    }
  }

  shoot(muzzle, role, gun, st) {
    const sim = this.sim, car = this.car;
    const origin = muzzle.clone();                 // (clone FIRST: the muzzle is a shared scratch vector)
    const spread = gun.spread * (Math.PI / 180) * lerp(2.1, 0.75, this.skill);
    const proj = sim.projectiles;
    const dir = new THREE.Vector3(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch));
    if (gun.grenade) {
      // A ballistic toss to the truck's moving lane, carrying the launch car's
      // motion. Its readable fuse leaves time to dodge after it has landed.
      if (proj.grenades.length >= 12) return;
      const cfg = gun.grenade, target = this.tgt.clone(), relative = sim.player.veh.vel.clone().sub(car.veh.vel);
      const flight = clamp(origin.distanceTo(target) / cfg.speed, .35, 1.65);
      target.addScaledVector(relative, flight * .80);
      const velocity = target.sub(origin).multiplyScalar(1 / flight);
      velocity.y += GRAVITY * flight * .5;
      velocity.add(car.veh.vel);
      const fuse = Math.max(1.6, cfg.fuse);
      proj.addGrenade(sim, origin, velocity, { ...cfg, fuse }, car.id);
      sim.emit({ t: 'grenadeThrow', src: car.id, role, origin: origin.toArray(), vel: velocity.toArray(), fuse });
      return;
    }
    if (gun.rocket) {
      const d = dir.clone();
      d.x += (this.r() - 0.5) * spread; d.y += (this.r() - 0.5) * spread; d.normalize();
      proj.addRocket(origin, d, gun.rocket, car.id);
      sim.emit({ t: 'shot', src: car.id, role, weapon: gun.tell === 'cannon' ? 'cannon' : 'rpg', origin: origin.toArray(), dir: d.toArray(), rocket: true, speed: gun.rocket.speed, launchSpeed: gun.rocket.launchSpeed });
      return;
    }
    const dmg = gun.dmg * (1 + 0.5 * this.level) * (car.elite ? 1.1 : 1);
    const rays = [];
    for (let p = 0; p < gun.pellets; p++) {
      const d = dir.clone();
      const a = Math.sqrt(this.r()) * spread, r = this.r() * 6.283;
      d.x += Math.cos(r) * a; d.z += Math.sin(r) * a * 0.6; d.y += Math.sin(r) * a; d.normalize();
      const v0 = d.clone().multiplyScalar(gun.speed).add(car.veh.vel);
      const sp = v0.length();
      proj.addBullet(origin, v0.normalize(), sp, dmg, car.id, 'bullet', 1.8);
      rays.push(d.toArray());
    }
    sim.emit({ t: 'shot', src: car.id, weapon: 'enemy', origin: origin.toArray(), rays, speed: gun.speed, role, pellets: gun.pellets, heavy: gun.heavy || undefined });
  }
}


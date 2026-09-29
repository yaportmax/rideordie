// Road feature physics: jump ramps, boost pads, roadblocks, guard rails (colliders built from road.features near the player),
// plus player-dropped hazards (oil slicks, mines). Visuals for the road features come from world/dressing.js (same feature data).
import * as THREE from 'three';
import { RAPIER, GROUPS } from './physics.js';
import { HALF_ROAD } from '../data/biomes.js';
import { rng, clamp } from '../core/util.js';
import { RAMP, ROADBLOCK } from '../data/features.js';

const AHEAD = 420, BEHIND = 180;
const V = THREE.Vector3;

export class Hazards {
  constructor() {
    this.active = new Map();   // feature -> {bodies:[rb]}
    this.oil = []; this.mines = []; this.enemyMines = [];
    this.pending = []; this._t = 0;
  }

  update(dt, sim) {
    const P = sim.player; if (!P) return;
    this._t += dt;
    if (sim.tick % 30 === 0) this._sync(sim, P.s);
    // boost pads
    for (const car of sim.cars.values()) {
      if (car.held || car.exploded) continue;
      if (sim.tick % 2) continue;
      for (const [f, rec] of this.active) {
        if (f.type !== 'boost') continue;
        if (car.s >= f.s0 && car.s <= f.s1 && Math.abs(car.d - rec.d) < 2.0 && car.veh.grounded >= 2) {
          if ((car.boostPadT ?? -9) < sim.time - 1.2) {
            car.boostPadT = sim.time;
            const fwd = car.veh.fwd; const m = car.veh.mass;
            car.veh.body.applyImpulse({ x: fwd.x * m * 9, y: 0, z: fwd.z * m * 9 }, true);
            if (car.kind === 'player') car.veh.nitro = Math.min(car.veh.nitroMax, car.veh.nitro + 0.6);
            sim.emit({ t: 'boostPad', id: car.id, pos: car.veh.pos.toArray() });
          }
        }
      }
    }
    // oil slicks: slippery surface handled in Sim.surfaceFor via sim.oilAt
    for (let i = this.oil.length - 1; i >= 0; i--) { const o = this.oil[i]; o.t -= dt * 2; if (o.t <= 0) this.oil.splice(i, 1); }
    // enemy mines (burning barrels) vs the player
    for (let i = this.enemyMines.length - 1; i >= 0; i--) {
      const m = this.enemyMines[i]; m.arm -= dt; m.life -= dt;
      if (m.life <= 0) { this.enemyMines.splice(i, 1); continue; }
      if (m.arm > 0 || P.exploded) continue;
      if (P.veh.pos.distanceTo(m.pos) < 3.4) { this.enemyMines.splice(i, 1); sim.emit({ t: 'boom', pos: m.pos.toArray(), radius: m.blast, kind: 'mine' }); sim.blast(m.pos, m.blast, m.dmg, 0.8, null, m.owner); }
    }
    // mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]; m.arm -= dt;
      if (m.arm > 0) continue;
      for (const car of sim.cars.values()) {
        if (car.kind === 'player' || car.exploded) continue;
        if (car.veh.pos.distanceTo(m.pos) < 3.6 + car.spec.width * 0.4) { this.mines.splice(i, 1); sim.emit({ t: 'boom', pos: m.pos.toArray(), radius: m.blast, kind: 'mine' }); sim.blast(m.pos, m.blast, m.dmg, 1.0, null, 1); break; }
      }
    }
  }

  dropOil(sim, car) {
    const p = car.veh.pos.clone().addScaledVector(car.veh.fwd, -3.5);
    this.oil.push({ pos: p, r: 5.5, t: 8 });
    sim.emit({ t: 'oil', pos: p.toArray(), r: 5.5, dir: [car.veh.fwd.x, car.veh.fwd.z] });
  }
  dropEnemyMine(sim, car, blast, dmg) {
    const p = car.veh.pos.clone().addScaledVector(car.veh.fwd, -car.spec.length / 2 - 1.5); p.y = car.veh.pos.y - car.veh.restComHeight + 0.15;
    this.enemyMines.push({ pos: p, arm: 0.5, blast, dmg, owner: car.id, life: 20 });
    sim.emit({ t: 'mineDrop', pos: p.toArray(), enemy: true });
  }
  dropMine(sim, car, blast, dmg) {
    const p = car.veh.pos.clone().addScaledVector(car.veh.fwd, -3.2); p.y = car.veh.pos.y - car.veh.restComHeight + 0.1;
    this.mines.push({ pos: p, arm: 0.8, blast, dmg });
    sim.emit({ t: 'mineDrop', pos: p.toArray() });
  }
  roadblockNear(p) { for (const [f, rec] of this.active) if (rec.center) { const dx = p.x - rec.center.x, dz = p.z - rec.center.z; if (dx * dx + dz * dz < 18 * 18) return true; } return false; }
  oilAt(x, z) {
    for (const o of this.oil) { const dx = x - o.pos.x, dz = z - o.pos.z; if (dx * dx + dz * dz < o.r * o.r) return true; }
    return false;
  }

  _sync(sim, s) {
    const road = sim.road;
    const feats = road.featuresIn(s - BEHIND, s + AHEAD);
    const want = new Set(feats);
    for (const f of feats) {
      if (this.active.has(f)) continue;
      const rec = this._build(sim, f);
      if (rec) this.active.set(f, rec);
    }
    for (const [f, rec] of this.active) if (!want.has(f)) { for (const rb of rec.bodies) sim.world.removeRigidBody(rb); this.active.delete(f); }
  }

  _fixedBox(sim, pos, half, yaw, opts = {}) {
    const rb = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
    sim.world.createCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setCollisionGroups(GROUPS.world).setFriction(opts.friction ?? 0.1).setRestitution(opts.restitution ?? 0.05), rb);
    return rb;
  }

  _build(sim, f) {
    const road = sim.road, bodies = [];
    if (f.type === 'boost') { return { bodies, d: f.lane * 2.0 }; }
    if (f.type === 'ramp') {
      // wedge across the road: rows every 1 m, 3 columns; height h(t) = H * t^1.35 ; drops sharply after the lip
      const H = f.big ? RAMP.bigH : RAMP.smallH, L = RAMP.len, W = HALF_ROAD - 0.3;
      const rows = Math.round(L) + 1, verts = [], idx = [];
      const anchor = road.sample(f.s0);
      for (let r = 0; r < rows; r++) {
        const s = f.s0 + (r / (rows - 1)) * L, t = r / (rows - 1), sm = road.sample(s);
        for (const d of [-W, 0, W]) { verts.push(sm.x + sm.nx * d - anchor.x, road.surfaceY(sm, d) + H * Math.pow(t, 1.35) - anchor.y, sm.z + sm.nz * d - anchor.z); }
      }
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < 2; c++) { const a = r * 3 + c, b = (r + 1) * 3 + c; idx.push(a, b, b + 1, a, b + 1, a + 1); }
      // lip wall (closed underside so wheels never poke through)
      const rb = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(anchor.x, anchor.y, anchor.z));
      sim.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)).setCollisionGroups(GROUPS.world).setFriction(0.9), rb);
      bodies.push(rb);
      return { bodies };
    }
    if (f.type === 'roadblock') {
      const r = rng(f.seed >>> 0);
      const gapD = f.gap * 2.6;
      const n = 7; // slots across 14 m
      for (let i = 0; i < n; i++) {
        const d = -HALF_ROAD + 1.0 + i * ((2 * HALF_ROAD - 2.0) / (n - 1));
        if (Math.abs(d - gapD) < 2.6) continue;
        const s = f.s0 + 4 + r.range(-2.5, 2.5) + (i % 2) * 3;
        const sm = road.sample(s);
        const yaw = sm.th + r.range(-0.9, 0.9) + (r() < 0.3 ? Math.PI / 2 : 0);
        const y = road.surfaceY(sm, d) + 0.7;
        bodies.push(this._fixedBox(sim, { x: sm.x + sm.nx * d, y, z: sm.z + sm.nz * d }, ROADBLOCK.half, yaw, { friction: 0.3, restitution: 0.1 }));
      }
      const c = road.sample(f.s0 + 5);
      return { bodies, center: new V(c.x, c.y, c.z) };
    }
    if (f.type === 'guard') {
      const seg = 6;
      for (let s = f.s0; s < f.s1; s += seg) {
        const sm = road.sample(s + seg / 2);
        for (const side of f.side === 'both' ? [1, -1] : [f.side === 'L' ? 1 : -1]) {
          const d = side * (HALF_ROAD + 2.6);
          const y = road.surfaceY(sm, d) + 0.42;
          bodies.push(this._fixedBox(sim, { x: sm.x + sm.nx * d, y, z: sm.z + sm.nz * d }, [0.12, 0.42, seg / 2 + 0.05], sm.th, { friction: 0.02, restitution: 0.02 }));
        }
      }
      return { bodies };
    }
    return null;
  }
}

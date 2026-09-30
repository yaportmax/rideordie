// Effect recipes: explosions, fire, smoke, muzzle flashes, tracers, impacts, crashes. Pure functions over an Fx instance; they
// only write particles / pool items / decals / lights (no allocation: shared PDesc `fx.p`, module-level scratch).
//
// Sheets: SMOKE / DUST are normal-lit (colour = albedo, shaded by sun/moon + sky in the shader), FIRE is the looping flame
// tongue (32 frames), FIREBALL the one-shot explosion ball (64 frames: white-hot -> orange -> soot).
import { MODE, PF } from './particles.js';
import { SPR, FRAMES } from './atlas.js';
import { MUZZLE, TRACER } from './weapons.js';
import { SURF } from './util.js';
import { ATMO } from '../../world/atmosphere.js';

const PI2 = Math.PI * 2;
const SMOKE_GAIN = 1.0, DUST_GAIN = 1.0;
const D = { x: 0, y: 1, z: 0 };
const _dc = [0, 0, 0];
export function muzzleCfg(w) { return MUZZLE[w] || null; }

/** Random unit direction in a cone around (nx,ny,nz); `spread` ~ tan(half angle). Result in D. */
export function coneDir(r, nx, ny, nz, spread) {
  let tx, ty = 0, tz;
  if (Math.abs(ny) < 0.95) { tx = nz; tz = -nx; } else { tx = 1; tz = 0; }
  let l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  const a = r.next() * PI2, s = Math.sqrt(r.next()) * spread;
  const cx = Math.cos(a) * s, cy = Math.sin(a) * s;
  const dx = nx + tx * cx + bx * cy, dy = ny + ty * cx + by * cy, dz = nz + tz * cx + bz * cy;
  l = Math.hypot(dx, dy, dz) || 1; D.x = dx / l; D.y = dy / l; D.z = dz / l;
  return D;
}

/** Dust albedo for a surface, pulled a little toward the biome's ground-haze colour (red canyon dust, pale coast, grey city). */
export function dustColor(surf, out = _dc) {
  const s = SURF[surf] || SURF.dirt, d = s.dust, h = ATMO.uAtmLow.value;
  const hl = Math.max(0.05, 0.3 * h.x + 0.59 * h.y + 0.11 * h.z), dl = 0.3 * d[0] + 0.59 * d[1] + 0.11 * d[2];
  const k = 0.3;                                                                      // haze hue at the dust's own brightness
  out[0] = d[0] * (1 - k) + (h.x / hl) * dl * k; out[1] = d[1] * (1 - k) + (h.y / hl) * dl * k; out[2] = d[2] * (1 - k) + (h.z / hl) * dl * k;
  return out;
}

// ------------------------------------------------------------------------------------------------ primitives
/** Hot spark: velocity-aligned streak with bounce. */
export function spark(fx, x, y, z, vx, vy, vz, life, gy, hot = 1, width = 0.05, drag = 0.35, flags = 0) {
  const p = fx.p.reset(); p.pos(x, y, z).vel(vx, vy, vz); p.life = life;
  p.spr = SPR.STREAK; p.mode = MODE.STREAK; p.size(width * 1.7, width * 0.7); p.len = 0.14; p.lenSpd = 0.036;
  p.drag = drag; p.grav = 9.8; p.ground = gy; p.bounce = 0.42; p.flags = flags;
  p.col0(8 * hot, 4.4 * hot, 1.3 * hot, 1).col1(2.4 * hot, 0.55 * hot, 0.07 * hot, 1); p.cCurve = 0.75;
  p.add0 = p.add1 = 1; p.fin = 0.01; p.fout = 0.4;
  fx.pf.emit(p);
}

/** Glowing ember: soft point, buoyant, flickers out. */
export function ember(fx, x, y, z, vx, vy, vz, life, size = 0.2, hot = 1, flags = 0) {
  const p = fx.p.reset(); p.pos(x, y, z).vel(vx, vy, vz); p.life = life;
  p.spr = SPR.SPARK; p.size(size, size * 0.25); p.sCurve = 0.8; p.drag = 1.3; p.grav = -0.8; p.turb = 0.7; p.wind = 0.8; p.flags = flags;
  p.col0(6 * hot, 2.6 * hot, 0.5 * hot, 1).col1(1.4 * hot, 0.16 * hot, 0.02 * hot, 1); p.cCurve = 0.6;
  p.add0 = p.add1 = 1; p.rot = fx.rng.next() * PI2; p.fin = 0.03; p.fout = 0.45;
  fx.pf.emit(p);
}

/**
 * Lit smoke puff (normal-lit smoke sheet, a random puff family playing its 4 life frames). r,g,b = albedo.
 * glow: fire light from below at birth (fades over the first part of its life).
 */
export function puff(fx, x, y, z, vx, vy, vz, s0, s1, life, r, g, b, a, buoy = 0.5, turb = 0.4, gy = -1e4, glow = 0, flags = 0) {
  const rng = fx.rng, p = fx.p.reset(); p.pos(x, y, z).vel(vx, vy, vz); p.life = life;
  p.spr = SPR.SMOKE; p.f0 = rng.int(4) * 4; p.nPlay = 4; p.size(s0, s1); p.sCurve = 0.55;
  p.rot = rng.sym(0.8); p.rotV = rng.sym(0.22); p.drag = 0.9; p.grav = -buoy; p.turb = turb; p.wind = 0.6; p.lit = 1;
  p.col(r * SMOKE_GAIN, g * SMOKE_GAIN, b * SMOKE_GAIN, a); p.col1(r * SMOKE_GAIN * 1.2, g * SMOKE_GAIN * 1.2, b * SMOKE_GAIN * 1.2, a); p.fin = 0.08; p.fout = 0.6; p.ground = gy;
  p.soft = Math.min(2.5, 0.12 + 0.3 * s1); p.glow = glow; p.flags = flags | (rng.next() < 0.5 ? PF.FLIPU : 0);
  fx.pa.emit(p);
}

/** Lit dust puff (dust sheet). r,g,b = albedo (see dustColor). */
export function dust(fx, x, y, z, vx, vy, vz, s0, s1, life, r, g, b, a, gy = -1e4, drag = 1.6, buoy = 0.2) {
  const rng = fx.rng, p = fx.p.reset(); p.pos(x, y, z).vel(vx, vy, vz); p.life = life;
  p.spr = SPR.DUST; p.f0 = rng.int(4) * 4; p.nPlay = 4; p.size(s0, s1); p.sCurve = 0.5;
  p.rot = rng.sym(0.5); p.rotV = rng.sym(0.3); p.drag = drag; p.grav = -buoy; p.turb = 0.35; p.wind = 0.9; p.lit = 1;
  p.col(r * DUST_GAIN, g * DUST_GAIN, b * DUST_GAIN, a); p.fin = 0.06; p.fout = 0.65; p.ground = gy;
  p.soft = Math.min(2.0, 0.1 + 0.3 * s1); p.flags = rng.next() < 0.5 ? PF.FLIPU : 0;
  fx.pa.emit(p);
}

/** Flat sprite chunk (debris sheet): dirt/rock flung with gravity + bounce. cell 0-2 rock, 3-5 concrete, 6-8 dirt, 9-12 metal, 13-15 wood. */
export function chip(fx, x, y, z, vx, vy, vz, size, life, cell, gy, tr = 1, tg = 1, tb = 1) {
  const rng = fx.rng, p = fx.p.reset(); p.pos(x, y, z).vel(vx, vy, vz); p.life = life;
  p.spr = SPR.DEBRIS; p.f0 = cell; p.nPlay = 1; p.size(size); p.rot = rng.next() * PI2; p.rotV = rng.sym(14);
  p.drag = 0.4; p.grav = 9.8; p.ground = gy; p.bounce = 0.32; p.lit = 1; p.col(tr, tg, tb, 1); p.fin = 0.01; p.fout = 0.25;
  fx.pa.emit(p);
}

/** Camera-facing additive glow (spark sprite) or flash (blast flash sprite). */
export function glow(fx, x, y, z, size, life, r, g, b, big = false, grow = 1.5, flags = 0) {
  const p = fx.p.reset(); p.pos(x, y, z); p.life = life; p.spr = big ? SPR.FLASH : SPR.SPARK; p.size(size, size * grow); p.sCurve = 0.5;
  p.col(r, g, b, 1); p.add0 = p.add1 = 1; p.rot = fx.rng.next() * PI2; p.fin = 0.0; p.fout = 0.85; p.flags = flags;
  fx.pf.emit(p);
}

/**
 * Flame tongue (looping flame sheet, FIRE mode): base at (x,y,z), leans into the air flow it feels (the particle's own
 * velocity vs the wind), so fire on a moving car streams backwards and a wreck's flames lean with the wind.
 * w,h: tongue width / height (m); heat: HDR intensity (1 = normal); bend: rise strength (bigger = stiffer, more upright).
 */
export function flame(fx, x, y, z, vx, vy, vz, w, h, life, heat = 1, bend = 3, flags = 0, drag = 1.0, grow = 1.25, wind = 1) {
  const r = fx.rng, p = fx.p.reset(); p.pos(x, y, z).vel(vx, vy, vz); p.life = life;
  p.spr = SPR.FIRE; p.mode = MODE.FIRE; p.f0 = r.int(FRAMES.FIRE); p.nPlay = FRAMES.FIRE; p.fps = r.range(24, 34);
  p.size(w * 0.72, w * grow); p.aspect = h / w; p.sCurve = 0.55;
  const k = heat * r.range(0.85, 1.15);
  p.col0(1.5 * k, 1.3 * k, 0.78 * k, 1).col1(1.3 * k, 0.85 * k, 0.45 * k, 0.9); p.cCurve = 0.8;
  p.add0 = 0.82; p.add1 = 1; p.fin = 0.14; p.fout = 0.5;
  p.drag = drag; p.grav = -2.2; p.bend = bend; p.soft = 0.12 + 0.2 * w; p.wind = wind;
  p.flags = flags | (r.next() < 0.5 ? PF.FLIPU : 0);
  fx.pf.emit(p);
}

/** Explosion fireball blob (fireball sheet played once over its life: white-hot -> orange -> soot). */
export function fireBlob(fx, x, y, z, vx, vy, vz, s0, s1, life, heat = 1, add1 = 0.2, delay = 0, gy = -1e4) {
  const r = fx.rng, p = fx.p.reset(); p.pos(x, y, z).vel(vx, vy, vz); p.life = life; p.delay = delay;
  p.spr = SPR.FIREBALL; p.f0 = 0; p.nPlay = FRAMES.FIREBALL; p.size(s0, s1); p.sCurve = 0.35;
  p.rot = r.next() * PI2; p.rotV = r.sym(0.35); p.drag = 2.0; p.grav = -2.4; p.turb = 0.3; p.wind = 0.4;
  p.col0(2.9 * heat, 2.75 * heat, 2.2 * heat, 1).col1(0.75, 0.68, 0.62, 0.9); p.cCurve = 0.45;
  p.add0 = 0.6; p.add1 = add1; p.fin = 0.02; p.fout = 0.35; p.ground = gy;
  p.soft = 0.25 * s1; p.flags = r.next() < 0.5 ? PF.FLIPU : 0;
  fx.pa.emit(p);
}

/**
 * Rolling fire body: the hot half of the fireball sheet (white-yellow -> orange, no soot) as a rising, turbulent mass;
 * the bulk of a big fire that the flame tongues lick out of.
 */
export function fireBody(fx, x, y, z, vx, vy, vz, s0, s1, life, heat = 1, flags = 0) {
  const r = fx.rng, p = fx.p.reset(); p.pos(x, y, z).vel(vx, vy, vz); p.life = life;
  p.spr = SPR.FIREBALL; p.f0 = 4 + r.int(6); p.nPlay = 22; p.size(s0, s1); p.sCurve = 0.5;
  p.rot = r.next() * PI2; p.rotV = r.sym(0.8); p.drag = 1.2; p.grav = -3.0; p.turb = 0.35; p.wind = 1;
  const k = heat * r.range(0.8, 1.1);
  p.col0(1.45 * k, 1.2 * k, 0.8 * k, 0.85).col1(1.1 * k, 0.65 * k, 0.35 * k, 0.6); p.cCurve = 0.7;
  p.add0 = 0.92; p.add1 = 0.75; p.fin = 0.15; p.fout = 0.55; p.soft = 0.3 * s1; p.flags = flags | (r.next() < 0.5 ? PF.FLIPU : 0);
  fx.pf.emit(p);
}

// ------------------------------------------------------------------------------------------------ explosions
/**
 * Layered explosion. S = size (1 car, 1.8 heavy, 2.4 tanker). o: {ground, paint(hex), column, pops}
 *  flash -> fireball flipbook cluster + licking flames at the base -> sparks / embers / burning debris -> ground shock ring +
 *  dust skirt -> dark billowing smoke (fire-lit at first) that becomes the lingering column (job) -> scorch decal, light.
 */
export function explosion(fx, x, y, z, S, o) {
  const r = fx.rng, p = fx.p, qd = fx.qd;
  const gy = o && o.ground !== undefined ? o.ground : y - 0.9;
  const R = 4.2 * S;
  const sS = Math.sqrt(S);
  // 1. flash: hot white bloom + wide soft flash
  glow(fx, x, y + 0.6, z, R * 1.9, 0.14, 12, 9, 5.5, true, 2.1);
  glow(fx, x, y + 0.8, z, R * 3.2, 0.32, 2.6, 1.0, 0.25, true, 1.5);
  // 2. fireball: flipbook blobs, hot core first, outer ones a hair later (the ball keeps growing for ~0.2 s)
  const nb = Math.max(5, Math.round((8 + 4 * S) * qd));
  for (let i = 0; i < nb; i++) {
    let rx = r.sym(1), ry = r.range(-0.1, 1), rz = r.sym(1); const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const d = R * 0.36 * Math.sqrt(r.next()), sp = r.range(2.5, 7) * sS, core = i < nb * 0.35;
    fireBlob(fx, x + rx * d, Math.max(gy + R * 0.25, y + 0.4 + ry * d * 0.8), z + rz * d, rx * sp, ry * sp * 0.6 + r.range(1.5, 5) * sS, rz * sp,
      R * r.range(0.7, 0.9), R * r.range(1.55, 2.0) * (core ? 0.85 : 1), r.range(1.6, 2.4) * (0.85 + 0.15 * S), core ? 1.2 : 0.95, r.range(0.12, 0.3), core ? 0 : r.range(0.02, 0.12), gy);
  }
  // hot inner flames licking up from the base (short, they die with the fireball)
  const nf = Math.round((5 + 3 * S) * qd);
  for (let i = 0; i < nf; i++) {
    const a = r.next() * PI2, d = R * 0.32 * Math.sqrt(r.next()), w = R * r.range(0.22, 0.36);
    flame(fx, x + Math.cos(a) * d, gy + 0.1, z + Math.sin(a) * d, Math.cos(a) * r.range(0.5, 2), r.range(2, 5), Math.sin(a) * r.range(0.5, 2), w, w * r.range(2.0, 3.0), r.range(0.8, 1.4), 1.3, 3.5, 0, 1.2, 1.5);
  }
  // 3. sparks (bouncing streaks) + embers
  const ns = Math.round((34 + 18 * S) * qd);
  for (let i = 0; i < ns; i++) {
    const el = Math.acos(Math.pow(r.next(), 0.55)), az = r.next() * PI2;   // biased toward the sides/up
    const sp = r.range(12, 44) * (0.75 + 0.25 * S);
    spark(fx, x + r.sym(0.6), y + 0.3, z + r.sym(0.6), Math.cos(az) * Math.sin(el) * sp, Math.cos(el) * sp * 0.9 + 6, Math.sin(az) * Math.sin(el) * sp, r.range(0.7, 1.7), gy, 1, 0.06);
  }
  const ne = Math.round((22 + 10 * S) * qd);
  for (let i = 0; i < ne; i++) {
    const a = r.next() * PI2, sp = r.range(2, 13) * sS;
    ember(fx, x + r.sym(1), y + r.range(0, 1.5), z + r.sym(1), Math.cos(a) * sp, r.range(2, 12), Math.sin(a) * sp, r.range(1.8, 4.2), r.range(0.16, 0.34), r.range(0.6, 1.1));
  }
  // 4. debris chunks (3D)
  fx.debrisBurst(x, y, z, S, gy, o && o.paint !== undefined ? o.paint : 0x6d4a30);
  // 5. shockwave ring on the ground + faint vertical blast disc
  p.reset(); p.pos(x, gy + 0.06, z); p.mode = MODE.GROUND; p.spr = SPR.SHOCK; p.size(3, 30 * S); p.sCurve = 0.55; p.life = 0.6;
  p.col(1.5, 1.25, 1.0, 0.85); p.add0 = 0.7; p.add1 = 0.7; p.fin = 0.01; p.fout = 0.85; p.rot = r.next() * PI2; fx.pf.emit(p);
  p.reset(); p.pos(x, gy + 0.05, z); p.mode = MODE.GROUND; p.spr = SPR.SHOCK; p.size(2, 20 * S); p.sCurve = 0.6; p.life = 0.5;
  p.col(1.2, 1.0, 0.8, 0.5); p.add0 = 0.9; p.add1 = 0.9; p.fin = 0.02; p.fout = 0.9; p.rot = r.next() * PI2; fx.pf.emit(p);
  p.reset(); p.pos(x, y + 0.5, z); p.spr = SPR.SHOCK; p.size(R * 0.6, R * 4.2); p.sCurve = 0.5; p.life = 0.42;
  p.col(1.0, 0.85, 0.7, 0.16); p.add0 = p.add1 = 1; p.fin = 0.01; p.fout = 0.9; fx.pf.emit(p);
  // 6. dust skirt hugging the ground (lit, biome-tinted)
  const nd = Math.round((14 + 7 * S) * qd), dc = dustColor('dirt');
  for (let i = 0; i < nd; i++) {
    const a = (i / nd) * PI2 + r.sym(0.25), sp = r.range(9, 21) * sS;
    dust(fx, x + Math.cos(a) * R * 0.3, gy + 0.3, z + Math.sin(a) * R * 0.3, Math.cos(a) * sp, r.range(0.4, 2.2), Math.sin(a) * sp,
      r.range(1.2, 2.2) * sS, r.range(4.5, 7.5) * sS, r.range(2.4, 3.8), dc[0], dc[1], dc[2], 0.62, gy, 1.4, 0.15);
  }
  // 7. the fireball chars into a dark billowing cloud: fire-lit from inside at first, then it rises and drifts
  const nk = Math.round((9 + 5 * S) * qd);
  for (let i = 0; i < nk; i++) {
    const a = r.next() * PI2, d = R * 0.4 * Math.sqrt(r.next()), up = r.range(0.2, 1.0);
    const q = fx.p.reset(); q.pos(x + Math.cos(a) * d, y + R * 0.25 * up + 0.5, z + Math.sin(a) * d).vel(Math.cos(a) * r.range(1, 3.5), r.range(0.8, 2.4) * sS, Math.sin(a) * r.range(1, 3.5));
    q.delay = r.range(0.5, 1.0); q.life = r.range(5, 7.5) * (0.8 + 0.2 * S);
    q.spr = SPR.SMOKE; q.f0 = r.int(4) * 4; q.nPlay = 4; q.size(R * r.range(0.5, 0.7), R * r.range(1.3, 1.8)); q.sCurve = 0.45;
    q.rot = r.sym(0.8); q.rotV = r.sym(0.15); q.drag = 0.8; q.grav = -0.4; q.turb = 0.9; q.wind = 0.9; q.lit = 1;
    const c = r.range(0.055, 0.085); q.col(c, c * 0.95, c * 0.9, 0.9); q.fin = 0.12; q.fout = 0.55; q.ground = gy;
    q.glow = 1.0; q.soft = R * 0.3; q.flags = r.next() < 0.5 ? PF.FLIPU : 0;
    fx.pa.emit(q);
  }
  // 8. lingering smoke column (job) + secondary pops
  if (!o || o.column !== false) fx.startSmokeColumn(x, y, z, S, gy);
  const np = o && o.pops !== undefined ? o.pops : S > 1.5 ? 3 : 2;
  for (let i = 0; i < np; i++) fx.startPop(x + r.sym(R * 0.5), y + r.range(0, 1), z + r.sym(R * 0.5), S * 0.42, gy, 0.12 + i * 0.16 + r.next() * 0.1);
  // 9. scorch decal, light flash
  if (fx.decScorch) fx.decScorch.add(x, gy, z, 0, 1, 0, 7.5 * S, r.int(4), r.next() * PI2, 55, 0.95, fx.time);
  fx.flashLight(x, y + 1.2, z, 1.0, 0.6, 0.26, 1500 * S, 70 * S, 0.7 + 0.15 * S, S);
}

/** Small secondary fireball (used for chained pops). */
export function miniPop(fx, x, y, z, S, gy) {
  const r = fx.rng, qd = fx.qd, R = 4.0 * S;
  glow(fx, x, y + 0.4, z, R * 2.4, 0.14, 8, 6, 3, true, 2.0);
  const nb = Math.max(2, Math.round(4 * qd * Math.sqrt(S) * 1.6));
  for (let i = 0; i < nb; i++) {
    let rx = r.sym(1), ry = r.range(-0.1, 1), rz = r.sym(1); const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    fireBlob(fx, x + rx * R * 0.2, y + ry * R * 0.2, z + rz * R * 0.2, rx * r.range(3, 7), ry * r.range(2, 5) + r.range(2, 4), rz * r.range(3, 7),
      R * r.range(0.4, 0.6), R * r.range(1.1, 1.5), r.range(1.0, 1.6), 1.0, 0.15, 0, gy);
  }
  const ns = Math.round(14 * qd);
  for (let i = 0; i < ns; i++) {
    const el = Math.acos(Math.pow(r.next(), 0.6)), az = r.next() * PI2, sp = r.range(8, 28);
    spark(fx, x, y, z, Math.cos(az) * Math.sin(el) * sp, Math.cos(el) * sp, Math.sin(az) * Math.sin(el) * sp, r.range(0.5, 1.2), gy, 1, 0.05);
  }
  fx.flashLight(x, y + 1, z, 1.0, 0.6, 0.25, 500 * S, 30, 0.3, S * 0.6);
}

/** Non-car explosion: kind 'rocket' | 'grenade' | 'mine' | 'tank' (boss fuel tank) | 'part' (boss part); size follows the blast radius. */
export function boom(fx, x, y, z, radius, kind, ground) {
  const r = fx.rng;
  let S;
  switch (kind) {
    case 'grenade': S = 0.62; break;
    case 'mine': S = 0.45 + radius * 0.035; break;
    case 'tank': S = Math.max(1.4, radius / 10); break;
    case 'part': S = 0.5 + radius * 0.06; break;
    default: S = 0.72 * Math.max(0.6, radius / 11) + 0.15;
  }
  const gy = ground !== undefined ? ground : y - 0.15;
  explosion(fx, x, Math.max(y, gy + 0.9), z, S, { ground: gy, paint: kind === 'tank' || kind === 'part' ? 0x2a2622 : 0x40372d, boom: true, pops: kind === 'tank' ? 2 : S > 1.2 ? 1 : 0 });
  if (kind === 'grenade' || kind === 'mine') {
    // ground blast: fountain of dirt chips and a bigger dust skirt
    const n = Math.round((kind === 'mine' ? 22 : 14) * fx.qd);
    for (let i = 0; i < n; i++) {
      const a = r.next() * PI2, sp = r.range(3, 10);
      chip(fx, x, gy + 0.2, z, Math.cos(a) * sp, r.range(6, 16), Math.sin(a) * sp, r.range(0.12, 0.32), r.range(1.2, 2.2), 6 + r.int(3), gy, 0.85, 0.75, 0.65);
    }
    const dc = dustColor('dirt');
    if (kind === 'mine') for (let i = 0; i < Math.round(8 * fx.qd); i++) { const a = r.next() * PI2, sp = r.range(2, 6); dust(fx, x, gy + 0.5, z, Math.cos(a) * sp, r.range(4, 9), Math.sin(a) * sp, 1.0, r.range(3.5, 5.5), r.range(1.8, 2.8), dc[0], dc[1], dc[2], 0.7, gy, 1.2, 0.1); }
  }
}

/** Boss main cannon: huge muzzle blast along (dx,dy,dz) + shockwave + smoke ring. (vx,vy,vz) = boss velocity. */
export function cannonBlast(fx, ox, oy, oz, dx, dy, dz, vx, vy, vz, gy) {
  const r = fx.rng, p = fx.p, qd = fx.qd;
  const yaw = Math.atan2(dx, dz), pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
  glow(fx, ox + dx, oy + dy, oz + dz, 7, 0.14, 12, 9, 6, true, 2.0);
  glow(fx, ox + dx * 3, oy + dy * 3, oz + dz * 3, 16, 0.26, 3.2, 1.4, 0.4, true, 1.4);
  p.reset(); p.pos(ox + dx * 0.5, oy + dy * 0.5, oz + dz * 0.5).vel(vx, vy, vz); p.spr = SPR.MUZZLE; p.f0 = 6; p.size(5.5); p.life = 0.11; p.rot = r.next() * PI2; p.col(7, 5, 2.4, 1); p.add0 = p.add1 = 1; p.fin = 0; p.fout = 0.7; fx.pf.emit(p);
  for (let k = 0; k < 2; k++) {
    p.reset(); p.pos(ox - dx * 1.2, oy - dy * 1.2, oz - dz * 1.2).vel(vx, vy, vz); p.spr = SPR.MUZZLE; p.f0 = k ? 3 : 4; p.mode = MODE.FWD; p.pivot = yaw; p.aspect = pitch;
    p.len = k ? 8 : 12; p.size(k ? 3 : 5.5); p.life = 0.1 + 0.03 * k; p.col(6.5, 4.4, 2, 1); p.add0 = p.add1 = 1; p.fin = 0; p.fout = 0.65; fx.pf.emit(p);
  }
  // pressure wave: expanding ring in the air + on the road, dust kicked off the ground below
  p.reset(); p.pos(ox + dx * 2.5, oy + dy * 2.5, oz + dz * 2.5).vel(vx * 0.9, vy * 0.9, vz * 0.9); p.spr = SPR.SHOCK; p.size(1.5, 22); p.sCurve = 0.5; p.life = 0.38; p.col(1.3, 1.1, 0.9, 0.28); p.add0 = p.add1 = 0.8; p.fin = 0.01; p.fout = 0.85; fx.pf.emit(p);
  p.reset(); p.pos(ox + dx * 3, gy + 0.06, oz + dz * 3); p.mode = MODE.GROUND; p.spr = SPR.SHOCK; p.size(3, 38); p.sCurve = 0.55; p.life = 0.6; p.col(1.2, 1.0, 0.8, 0.45); p.add0 = p.add1 = 0.7; p.fin = 0.01; p.fout = 0.85; p.rot = r.next() * PI2; fx.pf.emit(p);
  const nd = Math.round(14 * qd), dc = dustColor('dirt');
  for (let i = 0; i < nd; i++) { const a = (i / nd) * PI2 + r.sym(0.2), sp = r.range(9, 20); dust(fx, ox + dx * 3 + Math.cos(a) * 2, gy + 0.3, oz + dz * 3 + Math.sin(a) * 2, vx * 0.5 + Math.cos(a) * sp, r.range(0.4, 2), vz * 0.5 + Math.sin(a) * sp, 1.2, r.range(4, 7), r.range(1.8, 2.8), dc[0], dc[1], dc[2], 0.6, gy, 1.5, 0.1); }
  // smoke ring perpendicular to the barrel + fire-lit blast cloud pushed forward
  let tx = dz, tz = -dx; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;           // horizontal side
  const bx = dy * tz, by = dz * tx - dx * tz, bz = -dy * tx;                                 // D x T (up-ish)
  const nr = Math.round(22 * qd) + 6;
  for (let i = 0; i < nr; i++) {
    const a = (i / nr) * PI2, c = Math.cos(a), s = Math.sin(a);
    const rx = tx * c + bx * s, ry = by * s, rz = tz * c + bz * s, f = r.range(10, 15), o = r.range(6.5, 9);
    puff(fx, ox + dx * 2.5 + rx * 0.8, oy + dy * 2.5 + ry * 0.8, oz + dz * 2.5 + rz * 0.8, vx + dx * f + rx * o, vy + dy * f + ry * o, vz + dz * f + rz * o, 1.4, r.range(6.5, 8.5), r.range(2.6, 3.6), 0.3, 0.29, 0.28, 0.9, 0.3, 0.2, gy);
  }
  const nb = Math.round(8 * qd) + 3;
  for (let i = 0; i < nb; i++) {
    coneDir(r, dx, dy, dz, 0.28); const sp = r.range(18, 42);
    fireBlob(fx, ox + dx * 2, oy + dy * 2, oz + dz * 2, vx + D.x * sp, vy + D.y * sp, vz + D.z * sp, 1.5, r.range(6, 9), r.range(1.2, 1.9), 1.0, 0.15, 0, gy);
  }
  for (let i = 0; i < Math.round(26 * qd); i++) { coneDir(r, dx, dy, dz, 0.35); const sp = r.range(30, 70); spark(fx, ox + dx * 2, oy + dy * 2, oz + dz * 2, vx + D.x * sp, vy + D.y * sp, vz + D.z * sp, r.range(0.3, 0.8), gy, 1.2, 0.05); }
  fx.flashLight(ox + dx * 3, oy + dy * 3, oz + dz * 3, 1.0, 0.72, 0.38, 2600, 90, 0.35, 2);
}

/** THE LEVIATHAN's final blast: a mushroom-cloud fireball (the rising cap / stem / long column is driven by BossFx's job). */
export function megaExplosion(fx, x, y, z, gy) {
  const r = fx.rng, p = fx.p, qd = fx.qd;
  glow(fx, x, y + 4, z, 70, 0.35, 10, 7, 4, true, 1.8);
  glow(fx, x, y + 6, z, 140, 0.7, 2.6, 1.1, 0.3, true, 1.3);
  // initial fireball: dense cluster of fireball blobs thrown up and out
  const nb = Math.round(26 * qd) + 8;
  for (let i = 0; i < nb; i++) {
    let rx = r.sym(1), ry = r.range(-0.1, 1), rz = r.sym(1); const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const d = 9 * Math.sqrt(r.next()), sp = r.range(6, 20);
    fireBlob(fx, x + rx * d, gy + 3 + ry * d * 0.8, z + rz * d, rx * sp, ry * sp * 0.6 + r.range(10, 22), rz * sp, r.range(9, 13), r.range(22, 30), r.range(3.0, 4.6), 1.2, 0.3, r.range(0, 0.25), gy);
  }
  for (let i = 0; i < Math.round(12 * qd) + 3; i++) {
    const a = r.next() * PI2, d = 8 * r.next(), w = r.range(4, 7);
    flame(fx, x + Math.cos(a) * d, gy + 0.3, z + Math.sin(a) * d, r.sym(3), r.range(4, 10), r.sym(3), w, w * r.range(2, 2.8), r.range(1.2, 2.2), 1.4, 4, 0, 1, 1.4);
  }
  // ground: shock rings + a huge dust skirt
  p.reset(); p.pos(x, gy + 0.08, z); p.mode = MODE.GROUND; p.spr = SPR.SHOCK; p.size(6, 150); p.sCurve = 0.5; p.life = 1.0; p.col(1.6, 1.3, 1.0, 0.8); p.add0 = p.add1 = 0.7; p.fin = 0.01; p.fout = 0.8; p.rot = r.next() * PI2; fx.pf.emit(p);
  p.reset(); p.pos(x, gy + 0.07, z); p.mode = MODE.GROUND; p.spr = SPR.SHOCK; p.size(4, 90); p.sCurve = 0.6; p.life = 0.8; p.col(1.2, 1.0, 0.8, 0.5); p.add0 = p.add1 = 0.9; p.fin = 0.02; p.fout = 0.9; p.rot = r.next() * PI2; fx.pf.emit(p);
  p.reset(); p.pos(x, y + 5, z); p.spr = SPR.SHOCK; p.size(6, 110); p.sCurve = 0.5; p.life = 0.55; p.col(1.0, 0.85, 0.7, 0.18); p.add0 = p.add1 = 1; p.fin = 0.01; p.fout = 0.9; fx.pf.emit(p);
  const nd = Math.round(40 * qd) + 8, dc = dustColor('dirt');
  for (let i = 0; i < nd; i++) {
    const a = (i / nd) * PI2 + r.sym(0.15), sp = r.range(22, 46);
    dust(fx, x + Math.cos(a) * 8, gy + 0.5, z + Math.sin(a) * 8, Math.cos(a) * sp, r.range(0.5, 4), Math.sin(a) * sp, r.range(4, 6), r.range(12, 20), r.range(3.5, 6), dc[0], dc[1], dc[2], 0.75, gy, 1.1, 0.15);
  }
  // sparks, embers, debris
  for (let i = 0; i < Math.round(150 * qd); i++) {
    const el = Math.acos(Math.pow(r.next(), 0.5)), az = r.next() * PI2, sp = r.range(20, 70);
    spark(fx, x + r.sym(4), y + r.range(0, 4), z + r.sym(6), Math.cos(az) * Math.sin(el) * sp, Math.cos(el) * sp * 0.9 + 8, Math.sin(az) * Math.sin(el) * sp, r.range(1.0, 2.6), gy, 1.2, 0.09, 0.2);
  }
  for (let i = 0; i < Math.round(100 * qd); i++) { const a = r.next() * PI2, sp = r.range(3, 22); ember(fx, x + r.sym(6), y + r.range(0, 6), z + r.sym(10), Math.cos(a) * sp, r.range(4, 22), Math.sin(a) * sp, r.range(3, 7), r.range(0.3, 0.6), r.range(0.7, 1.2)); }
  for (let i = 0; i < 3; i++) fx.debrisBurst(x + r.sym(4), y + 2, z + (i - 1) * 10, 2.4, gy, 0x2a2622);
  if (fx.decScorch) fx.decScorch.add(x, gy, z, 0, 1, 0, 34, r.int(4), r.next() * PI2, 120, 1.0, fx.time);
  fx.flashLight(x, y + 6, z, 1.0, 0.62, 0.28, 9000, 220, 1.4, 4);
  fx.flashLight(x, y + 20, z, 1.0, 0.5, 0.2, 4000, 160, 2.2, 4);
}

// ------------------------------------------------------------------------------------------------ guns
/** Muzzle flash for weapon `wid` at (ox,oy,oz) pointing along (dx,dy,dz). (vx,vy,vz) = shooter velocity (flash rides along). */
export function muzzle(fx, wid, ox, oy, oz, dx, dy, dz, vx, vy, vz, gy, fp = false) {
  const cfg = MUZZLE[wid] || MUZZLE.enemy, r = fx.rng, p = fx.p;
  const yaw = Math.atan2(dx, dz), pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
  const h = cfg.hdr, c0 = cfg.col[0] * h, c1 = cfg.col[1] * h, c2 = cfg.col[2] * h;
  if (wid === 'rpg') return rocketBlast(fx, ox, oy, oz, dx, dy, dz, vx, vy, vz, gy, fp);
  if (fp) return fpMuzzle(fx, cfg, ox, oy, oz, dx, dy, dz, vx, vy, vz, gy, fp === 2);
  // star (camera facing)
  const cell = cfg.stars[r.int(cfg.stars.length)];
  p.reset(); p.pos(ox + dx * 0.1, oy + dy * 0.1, oz + dz * 0.1).vel(vx, vy, vz); p.spr = SPR.MUZZLE; p.f0 = cell; p.size(cfg.star * r.range(0.85, 1.15));
  p.life = cfg.life; p.rot = r.next() * PI2; p.col(c0, c1, c2, 1); p.add0 = p.add1 = 1; p.fin = 0; p.fout = 0.7; fx.pf.emit(p);
  // cone (forward)
  const cc = cfg.cones[r.int(cfg.cones.length)], L = cfg.coneL * r.range(0.85, 1.15), W = cfg.coneW * r.range(0.9, 1.1);
  p.reset(); p.pos(ox - dx * L * 0.11, oy - dy * L * 0.11, oz - dz * L * 0.11).vel(vx, vy, vz); p.spr = SPR.MUZZLE; p.f0 = cc; p.mode = MODE.FWD; p.pivot = yaw; p.aspect = pitch;
  p.len = L; p.size(W); p.life = cfg.life * 0.9; p.col(c0, c1, c2, 1); p.add0 = p.add1 = 1; p.fin = 0; p.fout = 0.65; fx.pf.emit(p);
  // light-less glow
  glow(fx, ox + dx * 0.15, oy + dy * 0.15, oz + dz * 0.15, cfg.glow * 0.7, cfg.life * 1.1, c0 * 0.35, c1 * 0.3, c2 * 0.25, true, 1.3);
  // powder smoke drifting forward
  for (let i = 0; i < cfg.smoke; i++) {
    const s = r.range(2, 5);
    puff(fx, ox + dx * 0.3, oy + dy * 0.3, oz + dz * 0.3, vx * 0.85 + dx * s + r.sym(0.4), vy * 0.85 + dy * s + r.range(0.1, 0.7), vz * 0.85 + dz * s + r.sym(0.4), 0.18, 0.9 + cfg.star * 0.4, r.range(0.7, 1.1), 0.75, 0.72, 0.68, 0.32, 0.25, 0.3);
  }
  // burning powder sparks
  for (let i = 0; i < cfg.sparks; i++) {
    coneDir(r, dx, dy, dz, 0.35); const sp = r.range(8, 22);
    spark(fx, ox + dx * 0.2, oy + dy * 0.2, oz + dz * 0.2, vx * 0.9 + D.x * sp, vy * 0.9 + D.y * sp, vz * 0.9 + D.z * sp, r.range(0.15, 0.35), gy, 0.7, 0.03);
  }
}

/** Local first-person shot: the viewmodel draws the flash itself; here only the world part (light, drifting smoke, hot sparks). */
function fpMuzzle(fx, cfg, ox, oy, oz, dx, dy, dz, vx, vy, vz, gy, scoped = false) {
  const r = fx.rng;
  fx.flashLight(ox + dx * 1.3, oy + dy * 1.3 + 0.3, oz + dz * 1.3, cfg.col[0], cfg.col[1] * 0.9, cfg.col[2] * 0.75, 14 + cfg.glow * 14, 7 + cfg.glow * 3, 0.05, 0.3);
  // powder smoke: starts clear of the camera (through a scope it would fill the whole view)
  const o = scoped ? 4.5 : 0.6;
  for (let i = 0; i < cfg.smoke; i++) {
    const s = r.range(3, 6);
    puff(fx, ox + dx * o, oy + dy * o, oz + dz * o, vx * 0.85 + dx * s + r.sym(0.4), vy * 0.85 + dy * s + r.range(0.1, 0.7), vz * 0.85 + dz * s + r.sym(0.4), 0.14, (0.7 + cfg.star * 0.4) * (scoped ? 0.6 : 1), r.range(0.5, 0.9), 0.75, 0.72, 0.68, scoped ? 0.12 : 0.22, 0.25, 0.3);
  }
  if (scoped) return;
  for (let i = 0; i < cfg.sparks; i++) {
    coneDir(r, dx, dy, dz, 0.3); const sp = r.range(10, 26);
    spark(fx, ox + dx * 0.3, oy + dy * 0.3, oz + dz * 0.3, vx * 0.9 + D.x * sp, vy * 0.9 + D.y * sp, vz * 0.9 + D.z * sp, r.range(0.12, 0.3), gy, 0.7, 0.025);
  }
}

/** RPG launch: small front flash + big backblast (fire jet + smoke cloud) behind the tube. */
export function rocketBlast(fx, ox, oy, oz, dx, dy, dz, vx, vy, vz, gy, fp = false) {
  const r = fx.rng, p = fx.p;
  if (fp) {
    // first person: the backblast leaves the tube behind the shooter's shoulder (out of view); only the rocket's front puff
    // and the light show. Emitting it at the (apparent) muzzle would blast fire and sparks straight through the camera.
    for (let i = 0; i < 4; i++) { const s = r.range(4, 9); puff(fx, ox + dx * 1.2, oy + dy * 1.2, oz + dz * 1.2, vx * 0.8 + dx * s + r.sym(1), vy * 0.8 + dy * s + r.range(0.3, 1.2), vz * 0.8 + dz * s + r.sym(1), 0.3, r.range(1.6, 2.6), r.range(0.8, 1.4), 0.8, 0.77, 0.72, 0.35, 0.3, 0.5); }
    fx.flashLight(ox + dx * 1.5, oy + dy * 1.5 + 0.3, oz + dz * 1.5, 1.0, 0.65, 0.3, 90, 18, 0.18, 1);
    return;
  }
  glow(fx, ox + dx * 0.3, oy + dy * 0.3, oz + dz * 0.3, 1.8, 0.1, 8, 5, 2.4, true, 1.5);
  for (let i = 0; i < 3; i++) {                                    // fire jet backwards
    p.reset(); p.pos(ox - dx * 0.2, oy - dy * 0.2, oz - dz * 0.2).vel(vx - dx * r.range(16, 26) + r.sym(1), vy - dy * 20 + r.sym(1), vz - dz * r.range(16, 26) + r.sym(1));
    p.spr = SPR.FIRE; p.mode = MODE.FLAME; p.f0 = r.int(FRAMES.FIRE); p.nPlay = FRAMES.FIRE; p.fps = 30; p.len = 4.2; p.size(1.2, 2.0); p.drag = 2.5; p.life = r.range(0.16, 0.3);
    p.col(2.6, 1.9, 1.3, 1); p.add0 = p.add1 = 1; p.fin = 0.02; p.fout = 0.7; fx.pf.emit(p);
  }
  const n = Math.round(10 * fx.qd);
  for (let i = 0; i < n; i++) {                                    // backblast smoke cloud
    coneDir(r, -dx, -dy, -dz, 0.55); const sp = r.range(6, 20);
    puff(fx, ox - dx * 0.5, oy - dy * 0.5, oz - dz * 0.5, vx * 0.6 + D.x * sp, vy * 0.6 + D.y * sp + 0.6, vz * 0.6 + D.z * sp, 0.6, r.range(3.2, 5.5), r.range(1.4, 2.4), 0.8, 0.77, 0.72, 0.5, 0.2, 0.5);
  }
  for (let i = 0; i < 10 * fx.qd; i++) { coneDir(r, -dx, -dy, -dz, 0.5); const sp = r.range(10, 30); spark(fx, ox, oy, oz, vx * 0.5 + D.x * sp, vy * 0.5 + D.y * sp, vz * 0.5 + D.z * sp, r.range(0.3, 0.8), gy, 0.9, 0.04); }
  // dust kick on the ground behind the launcher (only if close to the ground)
  if (oy - gy < 3.5) { const dc = dustColor('dirt'); for (let i = 0; i < 5 * fx.qd; i++) { const a = r.next() * PI2, sp = r.range(3, 8); dust(fx, ox - dx * 2, gy + 0.2, oz - dz * 2, Math.cos(a) * sp, r.range(0.3, 1.5), Math.sin(a) * sp, 1, 3.5, 1.4, dc[0], dc[1], dc[2], 0.55, gy); } }
  fx.flashLight(ox, oy, oz, 1.0, 0.65, 0.3, 240, 30, 0.2, 1);
}

/** Player hitscan tracer (streak from origin to end at ~620 m/s, clipped at both ends). */
export function tracerHit(fx, wid, ox, oy, oz, ex, ey, ez) {
  const dx = ex - ox, dy = ey - oy, dz = ez - oz, dist = Math.hypot(dx, dy, dz);
  if (dist < 3) return;
  const t = TRACER[wid] || TRACER.pistol, p = fx.p, inv = 1 / dist, speed = 620;
  const L = t.len, h = t.hdr;
  p.reset(); p.pos(ox, oy, oz).vel(dx * inv * speed, dy * inv * speed, dz * inv * speed); p.life = (dist + L) / speed; p.clip = dist;
  p.spr = SPR.STREAK; p.mode = MODE.STREAK; p.len = L; p.size(t.width); p.col(t.col[0] * h, t.col[1] * h, t.col[2] * h, 1); p.add0 = p.add1 = 1; p.fin = 0; p.fout = 0;
  fx.pf.emit(p);
  p.reset(); p.pos(ox, oy, oz).vel(dx * inv * speed, dy * inv * speed, dz * inv * speed); p.life = (dist + L * 0.6) / speed; p.clip = dist;
  p.spr = SPR.STREAK; p.mode = MODE.STREAK; p.len = L * 0.6; p.size(t.width * 0.4); p.col(9, 8, 6.5, 1); p.add0 = p.add1 = 1; p.fin = 0; p.fout = 0;
  fx.pf.emit(p);
}

/** Enemy bullet: visible projectile, travels at `speed` along dir until killed (hit event) or 1.8 s. Returns [slot, birth] via fx.lastSlot. */
export function tracerBullet(fx, ox, oy, oz, dx, dy, dz, speed, vx, vy, vz, heavy = false) {
  const t = heavy ? TRACER.heavy : TRACER.enemy, p = fx.p, h = t.hdr;
  p.reset(); p.pos(ox, oy, oz).vel(dx * speed + vx, dy * speed + vy, dz * speed + vz); p.life = 1.8;
  p.spr = SPR.STREAK; p.mode = MODE.STREAK; p.len = t.len; p.size(t.width); p.col(t.col[0] * h, t.col[1] * h, t.col[2] * h, 1); p.add0 = p.add1 = 1; p.fin = 0; p.fout = 0;
  fx.lastSlot = fx.pf.emit(p); fx.lastBirth = fx.pf.time;
  p.reset(); p.pos(ox, oy, oz).vel(dx * speed + vx, dy * speed + vy, dz * speed + vz); p.life = 1.8;
  p.spr = SPR.STREAK; p.mode = MODE.STREAK; p.len = t.len * 0.55; p.size(t.width * 0.4); p.col(9, 6, 4, 1); p.add0 = p.add1 = 1; p.fin = 0; p.fout = 0;
  fx.lastSlot2 = fx.pf.emit(p);
}

/** Near-miss flyby: a short faint streak passing the listener. */
export function whizz(fx, x, y, z, ax, ay, az) {
  const p = fx.p;
  const speed = 320;
  p.reset(); p.pos(x - ax * 10, y - ay * 10, z - az * 10).vel(ax * speed, ay * speed, az * speed); p.life = 0.06; p.spr = SPR.STREAK; p.mode = MODE.STREAK; p.len = 7; p.size(0.05);
  p.col(2.4, 1.6, 1.0, 0.7); p.add0 = p.add1 = 1; p.fin = 0.1; p.fout = 0.3; fx.pf.emit(p);
}

// ------------------------------------------------------------------------------------------------ impacts
const HARD = new Set(['asphalt', 'road', 'concrete', 'rock', 'stone']);
/** Bullet impact by surface. (nx,ny,nz) = outward surface normal. */
export function impact(fx, surf, x, y, z, nx, ny, nz, gy) {
  const r = fx.rng, qd = fx.qd;
  switch (surf) {
    case 'metal': {
      const n = Math.round(10 * qd) + 3;
      for (let i = 0; i < n; i++) { coneDir(r, nx, ny, nz, 1.1); const sp = r.range(5, 19); spark(fx, x, y, z, D.x * sp, D.y * sp + 1.5, D.z * sp, r.range(0.25, 0.65), gy, 1, 0.035); }
      glow(fx, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, 0.6, 0.07, 7, 4.5, 2.2, false, 1.3);
      puff(fx, x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, nx * 0.9, ny * 0.9 + 0.7, nz * 0.9, 0.12, 0.6, r.range(0.7, 1.1), 0.55, 0.54, 0.52, 0.3, 0.3, 0.3);
      break;
    }
    case 'glass': {
      const n = Math.round(12 * qd) + 3;
      for (let i = 0; i < n; i++) {                                // glittering shards: little spinning chips that catch the light
        coneDir(r, nx, ny, nz, 1.4); const sp = r.range(2, 8), p = fx.p.reset();
        p.pos(x, y, z).vel(D.x * sp, D.y * sp + 1.2, D.z * sp); p.life = r.range(0.45, 1.0); p.spr = SPR.STREAK; p.mode = MODE.STREAK; p.size(0.03); p.len = 0.05; p.lenSpd = 0.025;
        p.drag = 0.2; p.grav = 9.8; p.ground = gy; p.bounce = 0.25; p.col(2.0, 2.6, 3.2, 1); p.add0 = p.add1 = 1; p.fin = 0.02; p.fout = 0.4; fx.pf.emit(p);
      }
      for (let i = 0; i < Math.round(5 * qd) + 1; i++) { coneDir(r, nx, ny, nz, 1.2); const sp = r.range(1.5, 5); chip(fx, x, y, z, D.x * sp, D.y * sp + 1, D.z * sp, r.range(0.03, 0.07), r.range(0.6, 1.1), 9 + r.int(4), gy, 1.6, 1.8, 2.0); }
      glow(fx, x, y, z, 0.5, 0.07, 3, 4, 5, false, 1.2);
      break;
    }
    case 'flesh': {                                      // no gore: a brief dusty puff
      const dc = dustColor('dirt');
      for (let i = 0; i < 2; i++) dust(fx, x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, nx * 1.2 + r.sym(0.5), ny * 1.2 + r.range(0.2, 0.8), nz * 1.2 + r.sym(0.5), 0.15, r.range(0.6, 0.9), r.range(0.45, 0.7), dc[0], dc[1], dc[2], 0.5, -1e4, 2.4, 0);
      break;
    }
    case 'tire': {
      for (let i = 0; i < 3; i++) puff(fx, x, y, z, nx * 1.6 + r.sym(0.5), ny * 1.6 + r.range(0.6, 1.3), nz * 1.6 + r.sym(0.5), 0.2, r.range(0.9, 1.4), r.range(0.9, 1.4), 0.45, 0.45, 0.46, 0.4, 0.3, 0.2);
      for (let i = 0; i < 3; i++) { coneDir(r, nx, ny, nz, 0.9); const sp = r.range(2, 6); chip(fx, x, y, z, D.x * sp, D.y * sp, D.z * sp, 0.06, r.range(0.5, 0.9), 9 + r.int(4), gy, 0.15, 0.15, 0.15); }
      break;
    }
    default: {                                           // ground: dirt / sand / rock / asphalt / gravel / grass / snow
      const s = SURF[surf] || (HARD.has(surf) ? SURF.rock : SURF.dirt);
      const hard = HARD.has(surf) || s.hard, d = dustColor(SURF[surf] ? surf : hard ? 'rock' : 'dirt');
      const n = 2 + Math.round(2 * qd);
      for (let i = 0; i < n; i++) dust(fx, x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, nx * r.range(0.8, 2.6) + r.sym(1), ny * r.range(0.8, 2.6) + r.range(0.3, 1.2), nz * r.range(0.8, 2.6) + r.sym(1), 0.18, r.range(0.7, 1.4), r.range(0.6, 1.1), d[0], d[1], d[2], 0.6, y - 0.05, 2.2, 0.1);
      const nc = 2 + Math.round(2 * qd);
      const cell = hard ? (surf === 'rock' ? r.int(3) : 3 + r.int(3)) : 6 + r.int(3);
      for (let i = 0; i < nc; i++) { coneDir(r, nx, ny, nz, 0.9); const sp = r.range(2, 7); chip(fx, x, y, z, D.x * sp, D.y * sp + 1, D.z * sp, r.range(0.05, 0.12), r.range(0.6, 1.2), cell, y - 0.02); }
      if (hard) for (let i = 0; i < 4; i++) { coneDir(r, nx, ny, nz, 1.0); const sp = r.range(4, 12); spark(fx, x, y, z, D.x * sp, D.y * sp, D.z * sp, r.range(0.15, 0.4), y - 0.02, 0.7, 0.03); }
      if (fx.decHoles && ny > 0.5) fx.decHoles.add(x, y, z, nx, ny, nz, r.range(0.28, 0.42), hard ? 0 : 2, r.next() * PI2, 25, 0.9, fx.time);
    }
  }
}

// ------------------------------------------------------------------------------------------------ crash / tyre pop
export function crash(fx, x, y, z, dv, speed, gy, vx = 0, vy = 0, vz = 0) {
  const r = fx.rng, qd = fx.qd;
  const k = Math.min(1, dv / 8);
  const n = Math.round((16 + 60 * k) * qd);
  for (let i = 0; i < n; i++) {
    const a = r.next() * PI2, sp = r.range(4, 12 + 18 * k), up = r.range(0.5, 5 + 8 * k);
    spark(fx, x + r.sym(0.4), y + r.range(-0.3, 0.4), z + r.sym(0.4), vx * 0.8 + Math.cos(a) * sp, vy * 0.5 + up, vz * 0.8 + Math.sin(a) * sp, r.range(0.4, 1.2), gy, 1, 0.05);
  }
  glow(fx, x, y + 0.3, z, 2.4 + 3 * k, 0.1, 7, 4.5, 1.8, true, 1.5);
  glow(fx, x, y + 0.3, z, 1.2 + 1.5 * k, 0.07, 9, 8, 6, false, 1.4);
  const nd = Math.round((4 + 6 * k) * qd), dc = dustColor('dirt');
  for (let i = 0; i < nd; i++) { const a = r.next() * PI2, sp = r.range(1.5, 5); dust(fx, x + r.sym(0.8), gy + 0.3, z + r.sym(1), vx * 0.5 + Math.cos(a) * sp, r.range(0.3, 1.6), vz * 0.5 + Math.sin(a) * sp, 0.8, r.range(2.8, 5), r.range(1.0, 1.8), dc[0], dc[1], dc[2], 0.55, gy); }
  if (dv > 2) for (let i = 0; i < Math.round(10 * k * qd) + 3; i++) { const a = r.next() * PI2, sp = r.range(2, 9); chip(fx, x, y + 0.3, z, vx * 0.7 + Math.cos(a) * sp, r.range(2, 8), vz * 0.7 + Math.sin(a) * sp, r.range(0.1, 0.24), r.range(0.8, 1.7), 9 + r.int(4), gy, 0.5, 0.5, 0.5); }
  if (dv > 4) fx.debrisBurst(x, y, z, 0.25 + 0.35 * k, gy, 0x6d4a30);
}

export function tirePop(fx, x, y, z, vx, vy, vz, gy) {
  const r = fx.rng, qd = fx.qd;
  for (let i = 0; i < 4; i++) puff(fx, x + r.sym(0.15), y, z + r.sym(0.15), vx * 0.4 + r.sym(1.4), vy * 0.4 + r.range(0.4, 1.6), vz * 0.4 + r.sym(1.4), 0.3, r.range(1.3, 2.0), r.range(1.0, 1.6), 0.6, 0.6, 0.62, 0.55, 0.3, 0.3);
  for (let i = 0; i < Math.round(6 * qd); i++) { const a = r.next() * PI2, sp = r.range(3, 9); chip(fx, x, y, z, vx * 0.5 + Math.cos(a) * sp, vy * 0.5 + r.range(2, 5), vz * 0.5 + Math.sin(a) * sp, r.range(0.08, 0.16), r.range(0.7, 1.3), 9 + r.int(4), gy, 0.12, 0.12, 0.12); }
  for (let i = 0; i < Math.round(8 * qd); i++) { const a = r.next() * PI2, sp = r.range(4, 12); spark(fx, x, y, z, vx * 0.5 + Math.cos(a) * sp, r.range(1, 5), vz * 0.5 + Math.sin(a) * sp, r.range(0.25, 0.6), gy, 0.8, 0.035); }
}

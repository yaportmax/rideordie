// One cosmetic pulse for a driver-authoritative earned nuke. Existing atlas,
// particle shader and pool only; no damage, targets, recursive explosion or jobs.
import { SPR } from './atlas.js';
import { MODE } from './particles.js';

export const NUKE_PULSE = Object.freeze({ life: .85, start: 4, end: 32 });

export function validNukeCue(event, runId) {
  return !!event && event.t === 'combatNuke' && event.runId === runId && typeof runId === 'string' && runId.length > 0 &&
    Number.isSafeInteger(event.award) && event.award > 0 && event.award <= 0x7fffffff &&
    Array.isArray(event.pos) && event.pos.length === 3 && event.pos.every(value => Number.isFinite(value) && Math.abs(value) <= 1e9) &&
    Number.isInteger(event.cars) && event.cars >= 0 && event.cars <= 64 &&
    Number.isInteger(event.actors) && event.actors >= 0 && event.actors <= 48 &&
    Number.isFinite(event.bossDamage) && event.bossDamage >= 0 && event.bossDamage <= 300 + 1e-7;
}

/** Exactly one soft amber ground ring. Counts/award never scale visual cost.
 * Cabin/depth clipping remain the existing shader's responsibility. Ground mode
 * has no billboard near-camera fade; keep this authored size/life conservative.
 */
export function emitNukePulse(fx, event) {
  const [x, y, z] = event.pos;
  if (!fx.near(x, y, z, fx.farDist)) return false;
  const queriedGround = fx.groundAt(x, z, y - .6);
  const ground = Number.isFinite(queriedGround) ? queriedGround : y - .6;
  const p = fx.p.reset(); p.pos(x, ground + .12, z);
  p.mode = MODE.GROUND; p.spr = SPR.SHOCK; p.size(NUKE_PULSE.start, NUKE_PULSE.end); p.life = NUKE_PULSE.life;
  p.sCurve = .75; p.col0(.95, .63, .23, .7).col1(.36, .18, .06, 0);
  p.add0 = p.add1 = .55; p.fin = .04; p.fout = .8; p.ground = ground; p.soft = .35;
  fx.pf.emit(p);
  return true;
}

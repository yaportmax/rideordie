// Read-only presentation/input policy shared by the authority and snapshot viewer.
// `over` is deliberately later than defeat, and may arrive before a victory summary.
import { celebrationActive } from '../sim/victory_presentation.js';
const CAUSES = { 'TRUCK DESTROYED': 'car', 'DRIVER KILLED': 'driver', 'GUNNER KILLED': 'gunner' };
const knownReason = why => why === 'car' || why === 'driver' || why === 'gunner';

export function runPhase(run) {
  return run?.sim?.state ?? run?.simState ?? (run?.over ? 'over' : 'countdown');
}

export function isVictory(run) {
  if (!run) return false;
  // A projectile may finish the boss after the player's run already ended.
  // Sim only awards that win while phase is run; known loss beats a bare wreck.
  const why = run.sim?.result?.why;
  if (knownReason(why)) return false;
  if (why === 'victory' || run.sim?.won) return true;
  const summary = run.remoteSummary ?? run.summary;
  if (summary?.won === false || CAUSES[summary?.cause]) return false;
  if (summary?.won === true) return true;
  if (knownReason(run._defeatWhy)) return false;
  if (run._victorySeen) return true;
  return runPhase(run) === 'run' && !run._inferredDefeatWhy && !!run.bossState?.exploded;
}

/** A late snapshot cannot reveal which crew death preceded the wreck explosion. */
export function inferredDefeatReason(run) {
  const phase = runPhase(run), p = run?.states?.get(run.playerId ?? 1);
  if (phase !== 'dying' && phase !== 'over') return null;
  if (p?.exploded) return 'wrecked';
  if (p?.driverAlive === false) return 'driver';
  if (p?.gunnerAlive === false) return 'gunner';
  return phase === 'dying' ? 'wrecked' : null;
}

export function defeatReason(run) {
  if (!run || isVictory(run)) return null;
  const why = run.sim?.result?.why;
  if (knownReason(why)) return why;
  // The authorized final summary can correct an interim snapshot interpretation.
  const summaryWhy = CAUSES[run.remoteSummary?.cause ?? run.summary?.cause];
  if (summaryWhy) return summaryWhy;
  if (knownReason(run._defeatWhy)) return run._defeatWhy;
  if ((run.remoteSummary ?? run.summary)?.won === false) return run._inferredDefeatWhy ?? 'wrecked';
  return run._inferredDefeatWhy ?? inferredDefeatReason(run);
}

export function isDefeated(run) { return defeatReason(run) !== null; }

export function victoryPresenting(run) {
  if (run?.sim) return celebrationActive(run.sim);
  return !!(run?.victoryPresentation && run._victorySeen && !isDefeated(run));
}

export function validVictoryPresentationEvent(run, event) {
  return !!(run && !run.sim && event?.t === 'victoryPresentation' &&
    event.mode === run.journey?.mode && event.level === run.journey?.level &&
    !knownReason(run._defeatWhy) && !CAUSES[(run.remoteSummary ?? run.summary)?.cause] &&
    (run.remoteSummary ?? run.summary)?.won !== false);
}

export function localSeatAlive(run) {
  const p = run?.states?.get(run.playerId ?? 1);
  if (!p) return false;
  return run.role === 'driver' ? !!p.driverAlive : !!p.gunnerAlive;
}

export function canCaptureRun(run) {
  return !!(run?.started && runPhase(run) === 'run' && !run.over && !isDefeated(run) && !isVictory(run) &&
    !run.cinematic && !run.introOutside && localSeatAlive(run) &&
    (run.role === 'driver' ? run.humanDriver : run.humanGunner));
}

/** Remember terminal events without executing host-only kill/cash conversions. */
export function rememberDefeat(run, events = []) {
  for (const e of events) {
    if (run.sim && e.remote) continue; // remote shot FX cannot authorize host run state
    if (validVictoryPresentationEvent(run, e)) { run._victorySeen = true; run.victoryPresentation = true; continue; }
    if (e.t !== 'playerDown' && e.t !== 'runOver') continue;
    if (e.why === 'victory') run._victorySeen = true;
    else if (knownReason(e.why) && !run._defeatWhy) run._defeatWhy = e.why;
  }
  // Explicit reliable loss/final correction supersedes an earlier proof.
  // Casual dying snapshots retain the proof, since they cannot reveal event order.
  const summary = run.remoteSummary ?? run.summary;
  if (run.victoryPresentation && (knownReason(run._defeatWhy) || summary?.won === false || CAUSES[summary?.cause])) run.victoryPresentation = false;
  if (!run._inferredDefeatWhy && !isVictory(run)) run._inferredDefeatWhy = inferredDefeatReason(run);
}

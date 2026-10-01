/** Preserve fractional scheduling time while sending at most one fresh packet
 * per frame. Long stalls discard whole overdue periods, never creating bursts. */
export function advanceCadence(accumulator, dt, period = 1 / 30) {
  if (!Number.isFinite(period) || period <= 0) return 0;
  const carry = Number.isFinite(accumulator) && accumulator >= 0 ? accumulator % period : 0;
  if (!Number.isFinite(dt) || dt < 0) return carry;
  const accumulated = carry + dt;
  return accumulated < period && accumulated >= period - period * 1e-9 ? period : accumulated;
}

/** Called once after a due send. Returns only the unspent fractional period. */
export function consumeCadence(accumulator, period = 1 / 30) {
  if (!Number.isFinite(accumulator) || accumulator < 0 || !Number.isFinite(period) || period <= 0) return 0;
  // Avoid turning 29.999999999999996 periods into a nearly full extra carry.
  const remainder = accumulator - Math.floor((accumulator + period * 1e-9) / period) * period;
  return Math.max(0, remainder);
}

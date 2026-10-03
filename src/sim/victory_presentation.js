// A finished, verified fight can continue visually without becoming a new run.
export function verifiedBossClear(sim) {
  if (!sim) return false;
  const journey = sim.journey;
  if (journey?.mode === 'campaign' && journey.level < 10) {
    return sim.director?.campaignComplete === true && sim.director.chapterBossDone?.has(journey.level) === true;
  }
  return sim.boss?.exploded === true && (journey?.mode !== 'marathon' || sim.director?.marathonComplete === true);
}

export function celebrationActive(sim) {
  return !!(sim?.victoryPresentation && sim.result?.why === 'victory' &&
    (sim.state === 'run' || sim.state === 'over') && verifiedBossClear(sim));
}

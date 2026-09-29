// Economy knobs. Campaign target: ~2-3 h of runs to afford a boss-ready rig (~250k of the ~420k catalogue).
export const ECONOMY = {
  perMeter: 0.13,        // $ per metre driven ...
  perMeterLevel: 3.0,    // ... times (1 + this * difficultyLevel)
  perSecond: 1.5,        // $ per second survived
  killLevel: 2.0,        // kill cash multiplier grows with difficulty
  crashMul: 1.5,         // wrecked by crashing / ramming / chain explosion
  bossBounty: 50000,
  minibossBounty: [3000, 5000, 8000, 11000, 15000],
};
export const KILL_CASH = { e_sedan: 70, e_buggy: 85, e_muscle: 120, e_technical: 150, e_van: 260, e_heavy: 420, e_tanker: 390 };

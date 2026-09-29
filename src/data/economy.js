// Economy knobs. Campaign target: ~2-3 h of runs to afford a boss-ready rig (~250k of the ~420k catalogue).
export const ECONOMY = {
  perMeter: 0.16,        // $ per metre driven ...
  perMeterLevel: 3.0,    // ... times (1 + this * difficultyLevel)
  perSecond: 1.5,        // $ per second survived
  killLevel: 2.0,        // kill cash multiplier grows with difficulty
  crashMul: 1.5,         // wrecked by crashing / ramming / chain explosion
  bossBounty: 50000,
  minibossBounty: [3000, 5000, 8000, 11000, 15000],
};
export const KILL_CASH = { e_sedan: 90, e_buggy: 110, e_muscle: 150, e_technical: 190, e_van: 320, e_heavy: 520, e_tanker: 480 };

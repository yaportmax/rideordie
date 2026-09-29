// Enemy archetypes + crew guns. `minLevel`: difficulty level (0..1+) at which the archetype starts appearing. cost = director budget.
export const ENEMY_GUNS = {
  pistol:  { rate: 2.6, burst: [1, 3], pause: [0.9, 1.8], dmg: 4.2, speed: 140, spread: 3.2, range: 95, aimRate: 1.6, pellets: 1, react: [0.8, 1.6] },
  smg:     { rate: 9,   burst: [4, 10], pause: [0.9, 2.0], dmg: 3.0, speed: 165, spread: 4.0, range: 105, aimRate: 1.9, pellets: 1, react: [0.7, 1.4] },
  rifle:   { rate: 6.5, burst: [3, 7], pause: [0.8, 1.6], dmg: 6.5, speed: 210, spread: 1.7, range: 150, aimRate: 2.2, pellets: 1, react: [0.6, 1.2] },
  shotgun: { rate: 1.3, burst: [1, 2], pause: [1.0, 2.0], dmg: 3.6, speed: 125, spread: 5.5, range: 42, aimRate: 2.0, pellets: 7, react: [0.6, 1.2] },
  mg:      { rate: 12,  burst: [8, 22], pause: [1.0, 2.4], dmg: 3.9, speed: 195, spread: 2.5, range: 145, aimRate: 1.5, pellets: 1, react: [0.9, 1.7] },
  hmg:     { rate: 9,   burst: [10, 26], pause: [1.0, 2.2], dmg: 6.5, speed: 230, spread: 2.0, range: 170, aimRate: 1.3, pellets: 1, react: [0.8, 1.5] },
  rpg:     { rate: 0.35, burst: [1, 1], pause: [5.5, 8.0], dmg: 0, speed: 60, spread: 1.3, range: 150, aimRate: 1.4, pellets: 1, react: [1.2, 2.0], rocket: { speed: 62, blast: 9, blastDmg: 70, direct: 40 } },
};

export const ENEMIES = {
  e_sedan:     { spec: 'e_sedan',     cost: 1.0, minLevel: 0.0,  weight: 10, behaviors: ['chaser', 'chaser', 'flanker'], guns: ['pistol'],           gunLate: 'smg',   skill: 0.35, label: 'BANDIT' },
  e_buggy:     { spec: 'e_buggy',     cost: 1.2, minLevel: 0.06, weight: 6,  behaviors: ['flanker', 'chaser'],           guns: ['pistol', 'smg'],    gunLate: 'smg',   skill: 0.45, label: 'SKIRMISHER' },
  e_muscle:    { spec: 'e_muscle',    cost: 1.6, minLevel: 0.12, weight: 5,  behaviors: ['rammer', 'rammer', 'chaser'],  guns: [],                   skill: 0.6, label: 'RAMMER' },
  e_technical: { spec: 'e_technical', cost: 2.3, minLevel: 0.18, weight: 5,  behaviors: ['chaser', 'flanker'],           guns: ['mg'],               gunLate: 'hmg',   skill: 0.5, label: 'TECHNICAL' },
  e_van:       { spec: 'e_van',       cost: 3.2, minLevel: 0.34, weight: 3,  behaviors: ['chaser', 'blocker'],           guns: ['rpg'],              gunLate: 'rpg',   skill: 0.55, label: 'BOXER' },
  e_heavy:     { spec: 'e_heavy',     cost: 5.0, minLevel: 0.5,  weight: 2,  behaviors: ['heavy'],                       guns: ['mg', 'rifle'],      gunLate: 'hmg',   skill: 0.6, label: 'HAULER' },
  e_tanker:    { spec: 'e_tanker',    cost: 4.5, minLevel: 0.42, weight: 2,  behaviors: ['heavy', 'blocker'],            guns: ['rifle'],            gunLate: 'hmg',   skill: 0.55, label: 'FUEL BOMB' },
};
export const ENEMY_KEYS = Object.keys(ENEMIES);

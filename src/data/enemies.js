// Enemy archetypes + crew guns + ENCOUNTERS (the director spends its budget on squads with intent, not on single cars).
// `minLevel`: difficulty level (0..1+) at which it starts appearing. cost = director budget.
// Guns: rate (rounds/s), burst [min,max] rounds, pause [s] between bursts, react [s] wind-up before a burst (the tell),
// dmg per round at level 0 (grows with level), speed m/s (travel time = dodge window), spread deg, aimRate rad/s (how fast they re-aim).
export const ENEMY_GUNS = {
  pistol:  { rate: 3.0, burst: [2, 4], pause: [0.8, 1.6], dmg: 4.0, speed: 135, spread: 2.8, range: 90, aimRate: 1.7, pellets: 1, react: [0.7, 1.3] },
  smg:     { rate: 9,   burst: [5, 10], pause: [1.0, 2.0], dmg: 2.8, speed: 160, spread: 3.6, range: 100, aimRate: 1.9, pellets: 1, react: [0.7, 1.2] },
  rifle:   { rate: 6.0, burst: [3, 6], pause: [0.9, 1.7], dmg: 5.5, speed: 200, spread: 1.6, range: 150, aimRate: 2.1, pellets: 1, react: [0.6, 1.1] },
  shotgun: { rate: 1.3, burst: [1, 2], pause: [1.0, 2.0], dmg: 3.2, speed: 125, spread: 5.5, range: 42, aimRate: 2.0, pellets: 7, react: [0.6, 1.1] },
  mg:      { rate: 11,  burst: [8, 18], pause: [1.2, 2.4], dmg: 3.3, speed: 185, spread: 2.5, range: 140, aimRate: 1.5, pellets: 1, react: [0.9, 1.5], heavy: true },
  // SCRAPJAW's turret: long, readable sweeps with real breathers between them (the first warlord must be beatable on a starter rig)
  mg_warlord: { rate: 9, burst: [9, 15], pause: [2.4, 3.6], dmg: 2.8, speed: 185, spread: 2.8, range: 140, aimRate: 1.3, pellets: 1, react: [1.0, 1.5], heavy: true, model: 'hmg' },
  hmg_warlord: { rate: 8, burst: [8, 16], pause: [2.0, 3.2], dmg: 4.6, speed: 210, spread: 2.2, range: 160, aimRate: 1.2, pellets: 1, react: [1.0, 1.5], heavy: true, model: 'hmg' },
  hmg:     { rate: 8,   burst: [10, 22], pause: [1.3, 2.4], dmg: 5.2, speed: 215, spread: 2.1, range: 165, aimRate: 1.3, pellets: 1, react: [1.0, 1.6], heavy: true },
  rpg:     { rate: 0.35, burst: [1, 1], pause: [5.5, 8.0], dmg: 0, speed: 60, spread: 1.3, range: 150, aimRate: 1.4, pellets: 1, react: [1.3, 2.0], rocket: { speed: 58, blast: 8, blastDmg: 48, direct: 28 } },
  sniper: { rate: 1, burst: [1, 1], pause: [3.0, 4.2], dmg: 14, speed: 240, spread: .7, range: 180, aimRate: 1.35, pellets: 1, react: [1.5, 2.0], model: 'rifle', tell: 'sniper' },
  grenade: { rate: .32, burst: [1, 1], pause: [4.5, 6.5], dmg: 0, speed: 30, spread: 0, range: 76, aimRate: 1.6, pellets: 1, react: [1.3, 1.8], model: 'rpg', tell: 'grenade', grenade: { fuse: 2.4, blast: 6, dmg: 34, speed: 28 } },
  cannon: { rate: .25, burst: [1, 1], pause: [5.8, 7.5], dmg: 0, speed: 150, spread: .4, range: 180, aimRate: 1.0, pellets: 1, react: [1.7, 2.2], minimumTell: 1.6, model: 'rpg', tell: 'cannon', forwardArc: Math.PI / 6, rocket: { launchSpeed: 150, speed: 150, blast: 6.5, blastDmg: 42, direct: 24, gravity: 3.5 } },
};

export const ENEMIES = {
  e_sedan:     { spec: 'e_sedan',     cost: 1.0, minLevel: 0.0,  weight: 10, behaviors: ['chaser', 'chaser', 'flanker'], guns: ['pistol'],           gunLate: 'smg',   skill: 0.35, label: 'BANDIT' },
  e_buggy:     { spec: 'e_buggy',     cost: 1.2, minLevel: 0.06, weight: 6,  behaviors: ['flanker', 'chaser'],           guns: ['pistol', 'smg'],    gunLate: 'smg',   skill: 0.45, label: 'SKIRMISHER' },
  e_muscle:    { spec: 'e_muscle',    cost: 1.6, minLevel: 0.1,  weight: 5,  behaviors: ['rammer'],                      guns: [],                   skill: 0.6, label: 'RAMMER' },
  e_technical: { spec: 'e_technical', cost: 2.3, minLevel: 0.18, weight: 5,  behaviors: ['chaser', 'flanker', 'leader'], guns: ['mg'],               gunLate: 'hmg',   skill: 0.5, label: 'TECHNICAL' },
  e_van:       { spec: 'e_van',       cost: 3.2, minLevel: 0.34, weight: 3,  behaviors: ['blocker', 'leader'],           guns: ['rpg'],              gunLate: 'rpg',   skill: 0.55, label: 'BOXER' },
  e_heavy:     { spec: 'e_heavy',     cost: 5.0, minLevel: 0.5,  weight: 2,  behaviors: ['heavy'],                       guns: ['mg', 'rifle'],      gunLate: 'hmg',   skill: 0.6, label: 'HAULER' },
  e_tanker:    { spec: 'e_tanker',    cost: 4.5, minLevel: 0.42, weight: 2,  behaviors: ['heavy', 'leader'],             guns: ['rifle'],            gunLate: 'hmg',   skill: 0.55, label: 'FUEL BOMB' },
  e_double_bus: { spec: 'e_double_bus', cost: 5.5, minLevel: 0.30, weight: 2, behaviors: ['heavy'], guns: ['hmg'], gunLate: 'hmg', skill: .60, label: 'DOUBLE DECKER', biomes: ['city'], maxActive: 1 },
  e_barrel_carrier: { spec: 'e_barrel_carrier', cost: 2.2, minLevel: .03, weight: 4, behaviors: ['dropper'], guns: ['pistol'], skill: .45, label: 'CINDER HAULER', biomes: ['desert', 'coast', 'city', 'dam', 'underground', 'hell', 'space'], maxActive: 1 },
  e_grenadier: { spec: 'e_grenadier', cost: 2.5, minLevel: .12, weight: 3, behaviors: ['flanker', 'leader'], guns: ['grenade'], skill: .54, label: 'LOBBER', biomes: ['canyon', 'mountain', 'underground'], maxActive: 1 },
  e_armored: { spec: 'e_armored', cost: 3.8, minLevel: .26, weight: 2, behaviors: ['heavy', 'leader'], guns: ['mg'], skill: .52, label: 'IRONBACK: REAR REACTOR', biomes: ['city', 'dam', 'hell', 'space'], maxActive: 1 },
  e_monster: { spec: 'e_monster', cost: 3.5, minLevel: .15, weight: 2, behaviors: ['rammer'], guns: [], skill: .62, label: 'CRUSHER', biomes: ['desert', 'canyon', 'mountain', 'hell'], maxActive: 1 },
  e_light_tank: { spec: 'e_light_tank', cost: 4.8, minLevel: .33, weight: 2, behaviors: ['chaser'], guns: ['cannon'], skill: .57, label: 'SIEGEBREAKER: REAR FUEL', biomes: ['city', 'dam', 'space'], maxActive: 1 },
  e_warwagon: { spec: 'e_warwagon', cost: 4.8, minLevel: .36, weight: 2, behaviors: ['leader', 'heavy'], guns: ['rifle', 'smg', 'shotgun', 'mg'], roleGuns: { gunner: 'rifle', gunner2: 'smg', gunner3: 'shotgun', gunner4: 'mg' }, skill: .50, label: 'WARWAGON', biomes: ['city', 'sky', 'hell', 'space'], maxActive: 1 },
};
export const ENEMY_KEYS = Object.keys(ENEMIES);

/**
 * Encounters: squads with a plan. Each car: {k: archetype or [archetypes by preference, first unlocked wins from the END],
 * role: behavior, at: 'behind' | 'ahead' (placed just over a crest when there is one) | 'park' (waiting at the roadside ahead,
 * peels out when you arrive) | 'burst' (charges onto the road from off-road ahead, where the ground is level),
 * side: +1 left / -1 right / 0 either, mode: 'overtake' (passes you, then takes `next`), gap: slot override}.
 * The director picks by weight among the unlocked + affordable ones; `max` caps how often a pattern repeats in a row.
 */
export const ENCOUNTERS = {
  citybus: { minLevel: .30, weight: 2, biomes: ['city'], cars: [{ k: 'e_double_bus', role: 'heavy', at: 'ahead' }] },
  cindertrail: { minLevel: .03, weight: 4, biomes: ['desert', 'hell'], cars: [{ k: 'e_barrel_carrier', role: 'dropper', at: 'ahead', gap: -45 }, { k: 'e_sedan', role: 'chaser', at: 'behind' }] },
  canyonlobbers: { minLevel: .12, weight: 3, biomes: ['canyon', 'mountain', 'underground'], cars: [{ k: 'e_grenadier', role: 'flanker', at: 'ahead', side: 1 }, { k: 'e_buggy', role: 'flanker', at: 'behind', side: -1 }] },
  monstercharge: { minLevel: .15, weight: 3, biomes: ['desert', 'canyon', 'mountain', 'hell'], cars: [{ k: 'e_monster', role: 'rammer', at: 'behind' }] },
  ironescort: { minLevel: .26, weight: 3, biomes: ['city', 'dam', 'hell', 'space'], cars: [{ k: 'e_armored', role: 'heavy', at: 'ahead' }, { k: 'e_buggy', role: 'flanker', at: 'behind', side: -1 }] },
  siegepatrol: { minLevel: .33, weight: 2, biomes: ['city', 'dam', 'space'], cars: [{ k: 'e_light_tank', role: 'chaser', at: 'behind' }, { k: 'e_sedan', role: 'chaser', at: 'behind' }] },
  warparty: { minLevel: .36, weight: 3, biomes: ['city', 'sky', 'hell', 'space'], cars: [{ k: 'e_warwagon', role: 'leader', at: 'ahead' }] },
  // two bandits waiting on the shoulder ahead: they pull out as you arrive, one leads, one rides your flank
  ambush:   { minLevel: 0, weight: 6, cars: [{ k: ['e_sedan', 'e_buggy', 'e_technical'], role: 'leader', at: 'park', side: 1 }, { k: ['e_sedan', 'e_buggy'], role: 'flanker', at: 'park', side: -1 }] },
  // a car tails you, then overtakes and cuts in front; its partner hangs back as the gunner's target
  overtake: { minLevel: 0, weight: 6, cars: [{ k: ['e_sedan', 'e_buggy', 'e_technical'], role: 'chaser', mode: 'overtake', next: 'leader', at: 'behind' }, { k: ['e_sedan', 'e_buggy'], role: 'chaser', at: 'behind' }] },
  // they come charging out of the scrub from both sides of the road ahead, nitro and horns, and cut into your windshield
  sidehit:  { minLevel: 0.03, weight: 5, cars: [{ k: ['e_sedan', 'e_buggy', 'e_technical'], role: 'flanker', at: 'burst', side: 1 }, { k: ['e_buggy', 'e_sedan'], role: 'leader', at: 'burst', side: -1 }] },
  // one on each flank at once
  pincer:   { minLevel: 0.04, weight: 5, cars: [{ k: ['e_sedan', 'e_buggy'], role: 'flanker', side: 1, at: 'behind' }, { k: ['e_sedan', 'e_buggy'], role: 'flanker', side: -1, at: 'behind' }] },
  // gunless bruisers: they only know how to ram
  rammers:  { minLevel: 0.1, weight: 4, cars: [{ k: 'e_muscle', role: 'rammer', at: 'behind' }, { k: 'e_muscle', role: 'rammer', at: 'behind', minLevel: 0.3 }] },
  // someone brake-checks you from the front while a rammer comes up behind
  anvil:    { minLevel: 0.14, weight: 4, cars: [{ k: ['e_sedan', 'e_van'], role: 'blocker', at: 'ahead' }, { k: 'e_muscle', role: 'rammer', at: 'behind' }] },
  // two skirmishers scream past on both sides, guns blazing, and take the road ahead
  driveby:  { minLevel: 0.2, weight: 4, cars: [{ k: ['e_buggy', 'e_sedan'], role: 'chaser', mode: 'overtake', next: 'flanker', side: 1, at: 'behind' }, { k: ['e_buggy', 'e_sedan'], role: 'chaser', mode: 'overtake', next: 'leader', side: -1, at: 'behind' }] },
  // a gun truck up the road with escorts on its flanks
  convoy:   { minLevel: 0.28, weight: 3, cars: [{ k: ['e_technical', 'e_heavy'], role: 'heavy', at: 'ahead' }, { k: ['e_sedan', 'e_buggy'], role: 'flanker', at: 'ahead', side: 1 }, { k: ['e_sedan', 'e_buggy'], role: 'flanker', at: 'ahead', side: -1, minLevel: 0.4 }] },
  // a fuel tanker leads, buggies swarm it: shoot the tanker when they are close
  tanker:   { minLevel: 0.42, weight: 2, cars: [{ k: 'e_tanker', role: 'leader', at: 'ahead' }, { k: 'e_buggy', role: 'flanker', at: 'behind', side: 1 }, { k: 'e_buggy', role: 'flanker', at: 'behind', side: -1 }] },
  // rocket van blocks ahead, technical hunts from behind
  hammer:   { minLevel: 0.36, weight: 3, cars: [{ k: 'e_van', role: 'leader', at: 'ahead' }, { k: 'e_technical', role: 'chaser', at: 'behind' }, { k: 'e_muscle', role: 'rammer', at: 'behind', minLevel: 0.5 }] },
  // ---- set pieces (never picked at random: minLevel 9; the director fires each once per run at SET_PIECES[].s)
  gauntlet: { minLevel: 9, weight: 0, cars: [{ k: ['e_sedan', 'e_buggy'], role: 'leader', at: 'park', side: 1 }, { k: ['e_sedan', 'e_buggy'], role: 'flanker', at: 'park', side: -1 }, { k: ['e_sedan', 'e_buggy'], role: 'flanker', at: 'park', side: 1 }, { k: 'e_muscle', role: 'rammer', at: 'park', side: -1 }] },
  stampede: { minLevel: 9, weight: 0, cars: [{ k: 'e_muscle', role: 'rammer', at: 'behind', side: 1 }, { k: 'e_muscle', role: 'rammer', at: 'behind', side: -1 }, { k: 'e_muscle', role: 'rammer', at: 'behind' }, { k: 'e_technical', role: 'leader', at: 'ahead' }] },
  fuelrun:  { minLevel: 9, weight: 0, cars: [{ k: 'e_tanker', role: 'heavy', at: 'ahead' }, { k: 'e_technical', role: 'flanker', at: 'ahead', side: 1 }, { k: 'e_technical', role: 'flanker', at: 'ahead', side: -1 }, { k: 'e_buggy', role: 'chaser', at: 'behind' }] },
  blockade: { minLevel: 9, weight: 0, cars: [{ k: 'e_van', role: 'blocker', at: 'ahead', gap: -12 }, { k: 'e_van', role: 'leader', at: 'ahead' }, { k: 'e_muscle', role: 'rammer', at: 'behind', side: 1 }, { k: 'e_muscle', role: 'rammer', at: 'behind', side: -1 }] },
  cityswarm: { minLevel: 9, weight: 0, cars: [{ k: 'e_buggy', role: 'flanker', at: 'behind', side: 1 }, { k: 'e_buggy', role: 'flanker', at: 'behind', side: -1 }, { k: 'e_buggy', role: 'chaser', mode: 'overtake', next: 'leader', at: 'behind', side: 1 }, { k: 'e_buggy', role: 'chaser', mode: 'overtake', next: 'flanker', at: 'behind', side: -1 }, { k: ['e_sedan', 'e_technical'], role: 'leader', at: 'park', side: 1 }, { k: ['e_sedan', 'e_technical'], role: 'flanker', at: 'park', side: -1 }] },
  // everything at once
  swarm:    { minLevel: 0.6, weight: 3, cars: [{ k: ['e_buggy', 'e_technical'], role: 'flanker', at: 'behind', side: 1 }, { k: ['e_buggy', 'e_technical'], role: 'flanker', at: 'behind', side: -1 }, { k: ['e_sedan', 'e_van'], role: 'leader', at: 'ahead' }, { k: 'e_muscle', role: 'rammer', at: 'behind' }] },
};

/** One scripted set piece per biome, fired once per run as you reach `s` (announced with a banner). */
export const SET_PIECES = [
  { s: 4600, key: 'gauntlet', title: 'AMBUSH', sub: 'THE SCRAP RATS ARE WAITING UP THE ROAD' },
  { s: 14600, key: 'stampede', title: 'STAMPEDE', sub: 'RAMMERS ON YOUR TAIL — WATCH THE HORNS' },
  { s: 24600, key: 'fuelrun', title: 'FUEL CONVOY', sub: 'HIT THE TANKER WHEN THEY BUNCH UP' },
  { s: 35200, key: 'blockade', title: 'BLOCKADE', sub: 'THEY WANT THE ROAD — BREAK THROUGH' },
  { s: 45200, key: 'cityswarm', title: 'SWARM', sub: 'THE CITY GANGS POUR OUT' },
];

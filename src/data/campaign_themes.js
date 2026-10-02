// Campaign-only worlds. These retain the BIOMES road/terrain/sky/ground/scatter
// contract, but their terrain kinds require explicit worker support. Importing
// this table does not alter the legacy six-biome road or its distance markers.
export const CAMPAIGN_THEME_VERSION = 1;

const scatter = () => ({ rocks: 0, cactus: 0, shrubs: 0, deadTrees: 0, pines: 0, grass: 0, palms: 0, ruins: 0 });
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export const CAMPAIGN_THEMES = freeze({
  underground: {
    name: 'The Underworld',
    road: { kmax: 1 / 155, straight: .12, sigma: .9, slopeMax: .065, elevBase: -55, elevAmp: 12, elevScale: 540, bank: 70 },
    terrain: { kind: 'vault', flat: 16, amp: 4, far: 85, wall: 60, ceiling: 42, ceilingClearance: 24 },
    sky: { sun: -12, az: 40, turbidity: 2, rayleigh: .4, mie: .001, exposure: 1.05, fog: 0x17333d, fogDensity: .0011, sunColor: 0xa2dbeb, sunI: .18, hemiSky: 0x75b6cf, hemiGround: 0x493930, hemiI: 1.15 },
    ground: ['rock_grey', 'concrete_cracked', 'gravel', 'cliff'],
    scatter: scatter(),
    dressing: {
      shell: 'ribbed-vault', minimumClearance: 24, far: 1200,
      palette: { light: [.35, .39, .41], mid: [.2, .24, .27], dark: [.075, .1, .12], stone: [.26, .3, .32], brass: [.52, .34, .15], accent: [.13, .82, .94], warm: [1, .48, .12] },
    },
    boundaries: { roadHalfWidth: 7, shoulder: 2.5, solidEdge: 12.8, fallRecovery: true, ceilingClearance: 24 },
    hazards: { language: 'amber machinery, cyan safe route', candidates: ['bulkhead-chicane', 'mine-cart-crossing', 'vent-pulse'], telegraphMeters: 260 },
  },
  sky: {
    name: 'Skyway',
    road: { kmax: 1 / 150, straight: .1, sigma: .95, slopeMax: .065, elevBase: 190, elevAmp: 28, elevScale: 720, bank: 72 },
    terrain: { kind: 'skyway', flat: 4, amp: 2, far: 0, deckHalfWidth: 13.5, deckDepth: 8, voidDrop: 260, voidStart: 16 },
    sky: { sun: 30, az: 160, turbidity: 2, rayleigh: 2.1, mie: .003, exposure: .92, fog: 0xacbce8, fogDensity: .00042, sunColor: 0xffe9fa, sunI: 3, hemiSky: 0xbccaff, hemiGround: 0x6b749c, hemiI: .95 },
    ground: ['concrete', 'rock_grey', 'gravel', 'cliff'],
    scatter: scatter(),
    dressing: {
      shell: 'prismatic-suspension', minimumClearance: 24, far: 1800,
      palette: { light: [.76, .83, .97], mid: [.34, .42, .62], dark: [.12, .17, .3], accent: [.18, .9, 1], violet: [.65, .3, .98], gold: [.92, .64, .24] },
    },
    boundaries: { roadHalfWidth: 7, shoulder: 2.5, solidEdge: 12.8, fallRecovery: true, voidDrop: 260 },
    hazards: { language: 'violet obstruction, cyan safe route', candidates: ['split-prism-chicane', 'wind-gate', 'suspended-jump'], telegraphMeters: 280 },
  },
  hell: {
    name: 'Hell Road',
    road: { kmax: 1 / 140, straight: .09, sigma: 1, slopeMax: .075, elevBase: 65, elevAmp: 22, elevScale: 620, bank: 78 },
    terrain: { kind: 'volcanic', flat: 8, amp: 8, far: 200, mass: 140, lavaDrop: 30, lavaStart: 14, lavaEnd: 105 },
    sky: { sun: 8, az: 290, turbidity: 11, rayleigh: .6, mie: .014, exposure: .84, fog: 0x6f211d, fogDensity: .0009, sunColor: 0xff7b37, sunI: 2, hemiSky: 0xb84931, hemiGround: 0x692716, hemiI: 1.2 },
    ground: ['rock_grey', 'rock_red', 'cliff', 'gravel'],
    scatter: scatter(),
    dressing: {
      shell: 'basalt-caldera', minimumClearance: 24, far: 1900,
      palette: { light: [.33, .3, .29], mid: [.16, .14, .15], dark: [.065, .055, .07], accent: [1, .19, .02], hot: [1, .62, .08], metal: [.29, .21, .17] },
    },
    boundaries: { roadHalfWidth: 7, shoulder: 2.5, solidEdge: 12.8, fallRecovery: true, lavaVisualOnlyUntilTrigger: true },
    hazards: { language: 'cool blue escape, orange eruption warning', candidates: ['basalt-fall', 'lava-vent', 'foundry-gate'], telegraphMeters: 290 },
  },
  space: {
    name: 'Void Highway',
    road: { kmax: 1 / 160, straight: .13, sigma: .86, slopeMax: .055, elevBase: 320, elevAmp: 18, elevScale: 760, bank: 65 },
    terrain: { kind: 'orbital', flat: 3, amp: 0, far: 0, deckHalfWidth: 13.5, deckDepth: 9, voidDrop: 320, voidStart: 16 },
    sky: { sun: 25, az: 80, turbidity: .1, rayleigh: 0, mie: 0, exposure: .88, fog: 0x090d23, fogDensity: .00012, sunColor: 0xe2eaff, sunI: 3.7, hemiSky: 0x6985bf, hemiGround: 0x333650, hemiI: .85 },
    ground: ['concrete', 'rock_grey', 'concrete_cracked', 'gravel'],
    scatter: scatter(),
    dressing: {
      shell: 'orbital-service-deck', minimumClearance: 24, far: 2100,
      palette: { light: [.63, .69, .79], mid: [.23, .29, .4], dark: [.055, .08, .15], accent: [.16, .84, 1], gold: [.82, .53, .2], danger: [1, .17, .06] },
    },
    boundaries: { roadHalfWidth: 7, shoulder: 2.5, solidEdge: 12.8, fallRecovery: true, voidDrop: 320, gravity: 'normal' },
    hazards: { language: 'cyan deck, red docking obstruction', candidates: ['orbital-debris', 'docking-clamp', 'reactor-gate'], telegraphMeters: 300 },
  },
});

export const CAMPAIGN_THEME_IDS = freeze(Object.keys(CAMPAIGN_THEMES));
export const campaignTheme = id => CAMPAIGN_THEMES[id] || null;

// City remains an existing biome. This supplement authors a visible raised
// interchange and recognisable tower crowns without replacing its street mesh.
export const CITY_CAMPAIGN_DRESSING = freeze({
  name: 'Ruined City', dressing: { far: 2000, minimumClearance: 24,
    palette: { light: [.55, .59, .64], mid: [.26, .3, .36], dark: [.09, .12, .17], accent: [.11, .67, .9], gold: [.9, .54, .17] } },
});

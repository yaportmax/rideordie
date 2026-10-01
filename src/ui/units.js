// Display units only. Simulation, progression and saved distances stay in meters.
export const METERS_PER_MILE = 1609.344;
export const normalizeUnits = units => units === 'km' ? 'km' : 'mi';
export const distanceValue = (meters, units = 'mi') => meters / (normalizeUnits(units) === 'km' ? 1000 : METERS_PER_MILE);
export const distanceLabel = (units = 'mi') => normalizeUnits(units) === 'km' ? 'KM' : 'MI';
export const speedValue = (metersPerSecond, units = 'mi') => distanceValue(metersPerSecond * 3600, units);
export const speedLabel = (units = 'mi') => normalizeUnits(units) === 'km' ? 'KM/H' : 'MPH';
export const formatDistance = (meters, units = 'mi', digits = 1) => `${distanceValue(meters, units).toFixed(digits)} ${distanceLabel(units)}`;

globalThis.__crashLog = [];
await import('file:///C:/Dev/rideordie/tools/test/crash_diag.mjs');
const L = globalThis.__crashLog; const big = L.filter((x) => x.other === -1);
console.log('player contacts', L.length, 'world contacts', big.length);
console.log(big.slice(0, 15).map((x) => JSON.stringify(x)).join('\n'));

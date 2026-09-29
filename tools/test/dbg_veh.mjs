import { initPhysics, createWorld, addStaticBox } from '../../src/sim/physics.js';
import { Vehicle } from '../../src/sim/vehicle.js';
import { VEHICLES } from '../../src/data/vehicles.js';
await initPhysics();
const spec = VEHICLES[process.argv[2] || 'e_tanker']; const DT = 1 / 120;
const world = createWorld(DT); addStaticBox(world, [0, -1, 0], [2000, 1, 6000], null, { friction: 1 });
const car = new Vehicle(world, spec, { x: 0, y: 0, z: 0 });
console.log('mass', spec.mass, 'R', spec.wheelRadius, 'restCom', car.restComHeight.toFixed(3), 'maxLen', car.maxLen, 'restLen', car.restLen.toFixed(3), 'susp k', spec.susp.k?.toFixed(0), 'wheels', spec.wheels.map((w) => `${w.name}(${w.drive.toFixed(2)})`).join(' '));
for (let i = 0; i < 600; i++) { car.setInput({ throttle: 1 }); car.applyForces(DT, null); world.step(); car.afterStep(); if (i % 120 === 119) console.log('t', ((i + 1) * DT).toFixed(1), 'speed', car.speed.toFixed(2), 'y', car.pos.y.toFixed(3), 'grounded', car.grounded, 'wheels L', car.wheels.map((w) => w.L.toFixed(2) + (w.grounded ? '' : '!')).join(' '), 'loads', car.wheels.map((w) => (w.load / 1000).toFixed(1)).join(' ')); }

// Headless handling lab: node tools/test/vehicle_sim.mjs [truck_t1|...] [scenario]
import { initPhysics, createWorld, addStaticBox, RAPIER } from '../../src/sim/physics.js';
import { Vehicle } from '../../src/sim/vehicle.js';
import { VEHICLES } from '../../src/data/vehicles.js';

await initPhysics();
const id = process.argv[2] || 'truck_t1';
const only = process.argv[3];
const DT = 1 / 120;
const kmh = (v) => (v * 3.6).toFixed(0);

function setup(spec) {
  const world = createWorld(DT);
  addStaticBox(world, [0, -1, 0], [2000, 1, 6000], null, { friction: 1 });
  const car = new Vehicle(world, spec, { x: 0, y: 0, z: 0, yaw: 0 });
  return { world, car };
}
function run(world, car, secs, inputFn, log) {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    car.setInput(inputFn(t, car));
    car.applyForces(DT, null);
    world.step();
    car.afterStep();
    if (log) log(t, car);
  }
}
const spec = VEHICLES[id];
const scen = {
  accel() {
    const { world, car } = setup(spec);
    let t100 = null, t60 = null; const marks = {};
    run(world, car, 30, () => ({ throttle: 1, steer: 0 }), (t, c) => {
      if (t60 === null && c.speed * 3.6 >= 60) t60 = t;
      if (t100 === null && c.speed * 3.6 >= 100) t100 = t;
      for (const m of [5, 10, 20, 29]) if (t >= m && !marks[m]) marks[m] = kmh(c.speed);
    });
    console.log(`[accel] 0-60 ${t60?.toFixed(2)}s  0-100 ${t100?.toFixed(2)}s  speed@5/10/20/29s`, marks, 'top', kmh(car.speed), 'km/h; ride height y=', car.pos.y.toFixed(3), 'expected', car.restComHeight.toFixed(3));
  },
  brake() {
    const { world, car } = setup(spec);
    run(world, car, 20, () => ({ throttle: 1 }));
    const v0 = car.speed, z0 = car.pos.z; let stop = null;
    run(world, car, 8, () => ({ brake: 1 }), (t, c) => { if (stop === null && c.speed < 0.5) stop = t; });
    console.log(`[brake] from ${kmh(v0)} km/h: stop in ${stop?.toFixed(2)}s, ${(car.pos.z - z0).toFixed(1)} m, pitch(up.z)=${car.up.z.toFixed(3)}`);
  },
  turn() {
    for (const target of [50, 100, 150]) {
      const { world, car } = setup(spec);
      run(world, car, 25, (t, c) => ({ throttle: c.speed * 3.6 < target ? 1 : 0.25 }));
      let maxLat = 0, slip = 0, rollMax = 0; const p0 = car.pos.clone(); let yaw0 = Math.atan2(car.fwd.x, car.fwd.z);
      run(world, car, 4, (t, c) => ({ throttle: c.speed * 3.6 < target ? 1 : 0.25, steer: 1 }), (t, c) => {
        if (t > 1.5) { maxLat = Math.max(maxLat, Math.abs(c.yawRate * c.vf)); slip = Math.max(slip, Math.abs(c.slipAngle)); rollMax = Math.max(rollMax, 1 - c.up.y); }
      });
      console.log(`[turn ${target}km/h] end speed ${kmh(car.speed)} yawRate ${car.yawRate.toFixed(2)} rad/s latAccel ~${maxLat.toFixed(1)} m/s2 (${(maxLat / 17.5).toFixed(2)}g) radius ${(car.speed / Math.max(0.01, Math.abs(car.yawRate))).toFixed(0)}m slip ${(slip * 57.3).toFixed(1)}deg tilt ${rollMax.toFixed(3)}`);
    }
  },
  drift() {
    const { world, car } = setup(spec);
    run(world, car, 14, () => ({ throttle: 1 }));
    console.log('[drift] start', kmh(car.speed), 'km/h');
    const tl = (t, c) => { if (Math.abs(t * 5 - Math.round(t * 5)) < 0.02) console.log(`   t=${t.toFixed(1)} v=${kmh(c.speed)} slip=${(c.slipAngle * 57.3).toFixed(0)} yawRate=${c.yawRate.toFixed(2)} steerAng=${(c.steerAngle * 57.3).toFixed(0)} grounded=${c.grounded}`); };
    run(world, car, 1.6, () => ({ throttle: 1, steer: 1, handbrake: true }), tl);
    console.log('   -- handbrake released, counter-steer & throttle');
    run(world, car, 3.0, (t, c) => ({ throttle: 1, steer: -0.5 }), tl);
  },
  flick() {
    const { world, car } = setup(spec);
    run(world, car, 30, () => ({ throttle: 1 }));
    let tiltMax = 0, ok = true;
    for (const dir of [1, -1, 1, -1]) run(world, car, 0.5, () => ({ throttle: 1, steer: dir }), (t, c) => { tiltMax = Math.max(tiltMax, 1 - c.up.y); if (c.up.y < 0.5) ok = false; });
    console.log(`[flick @${kmh(car.speed)}] tilt max ${tiltMax.toFixed(3)} stable=${ok}`);
  },
  jump() {
    const { world, car } = setup(spec);
    const ang = Math.atan2(2.2, 12); const q = [Math.sin(-ang / 2), 0, 0, Math.cos(-ang / 2)];
    addStaticBox(world, [0, 1.1, 300], [5, 0.2, 6.1], q);
    let maxAir = 0, maxH = 0, minUp = 1, peakVy = 0, landTilt = 0;
    run(world, car, 22, () => ({ throttle: 1 }), (t, c) => { if (c.pos.z > 280) { maxAir = Math.max(maxAir, c.airTime); maxH = Math.max(maxH, c.pos.y); minUp = Math.min(minUp, c.up.y); peakVy = Math.max(peakVy, c.vel.y); } });
    console.log(`[jump] now ${kmh(car.speed)} km/h, maxAir ${maxAir.toFixed(2)}s, peak y ${maxH.toFixed(2)}, peak vy ${peakVy.toFixed(1)}, min up.y ${minUp.toFixed(2)}, final up.y ${car.up.y.toFixed(3)}, z ${car.pos.z.toFixed(0)}`);
  },
};
for (const [k, f] of Object.entries(scen)) if (!only || only === k) f();

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { ParticleSystem, PDesc, PF, MODE, STRIDE } from '../src/view/fx/particles.js';
import { SPR } from '../src/view/fx/atlas.js';
import { Rng } from '../src/view/fx/util.js';
import { MUZZLE } from '../src/view/fx/weapons.js';
import * as CurrentRecipes from '../src/view/fx/recipes.js';

// Actual-source scalar regressions. Geometry comes from the real ParticleSystem quad;
// scalar arithmetic executes extracted production shader statements/functions.
// This is not a WebGL compiler, GPU timing or native pixel/quality acceptance.
// Historical overrides affect shader/recipe text only; construction/upload and
// imported dependencies use current modules, so that scope remains explicit.
const repo = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = process.env.EXPLOSION_EDGE_SOURCE || path.join(repo, 'src/view/fx/particles.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const shaders = Object.fromEntries(['VERT', 'FRAG'].map(name => {
  const begin = source.indexOf(`const ${name} = /* glsl */\u0060`);
  assert.ok(begin >= 0, `${name} template exists in actual source`);
  const start = source.indexOf('\u0060', begin) + 1, end = source.indexOf('\u0060;', start);
  assert.ok(end > start); return [name, source.slice(start, end)];
}));
console.log(`Actual-source shader probe ${path.resolve(sourcePath)} SHA256 ${createHash('sha256').update(source).digest('hex')}`);

let Recipes = CurrentRecipes;
if (process.env.EXPLOSION_EDGE_RECIPES_SOURCE) {
  // Execute a preserved actual historical recipe module, resolving its original
  // relative dependencies against the real repository rather than WORK copies.
  const historical = fs.readFileSync(process.env.EXPLOSION_EDGE_RECIPES_SOURCE, 'utf8');
  const recipeUrl = new URL('../src/view/fx/recipes.js', import.meta.url);
  const executable = historical.replace(/(from\s+['"])(\.[^'"]+)(['"])/g,
    (_, before, relative, after) => before + new URL(relative, recipeUrl).href + after);
  Recipes = await import('data:text/javascript;base64,' + Buffer.from(executable).toString('base64'));
  console.log(`Actual historical recipe module ${path.resolve(process.env.EXPLOSION_EDGE_RECIPES_SOURCE)} SHA256 ${createHash('sha256').update(historical).digest('hex')}`);
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smoothstep = (lo, hi, x) => { const t = clamp((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); };
const scalar = code => code.replace(/\b(?:float|int|bool)\b/g, 'let')
  .replace(/\b(min|max|abs|sqrt|exp|pow)\(/g, 'Math.$1(');

function bodyOf(shader, signature) {
  const at = shader.indexOf(signature); assert.ok(at >= 0, `Actual shader contains ${signature}`);
  const open = shader.indexOf('{', at); let level = 1, i = open + 1;
  for (; i < shader.length && level; i++) { if (shader[i] === '{') level++; if (shader[i] === '}') level--; }
  assert.equal(level, 0); return shader.slice(open + 1, i - 1);
}
function groundHeight() {
  return new Function('worldY', 'groundY', 'softDistance', 'hasGround', 'mode', 'clamp',
    scalar(bodyOf(shaders.VERT, 'float particleGroundHeight(')));
}
function groundStage() {
  const end = shaders.VERT.indexOf('// ---------------------------------------------------------------- overdraw bound');
  const anchor = 'rgt = side; up = ax;';
  const begin = shaders.VERT.lastIndexOf(anchor, end);
  assert.ok(begin >= 0 && end > begin);
  const orientationClose = shaders.VERT.indexOf('}', begin) + 1;
  const stage = shaders.VERT.slice(orientationClose, end);
  // Baseline has no helper and clamps world.y here. Candidate adds only vGround.
  const helper = shaders.VERT.includes('float particleGroundHeight(') ? groundHeight() : () => 1;
  const run = new Function('world', 'gy', 'aX', 'hasGround', 'mode', 'particleGroundHeight', 'clamp',
    `let vGround = 1; ${scalar(stage)}; return {world, vGround};`);
  return (world, ground, soft, hasGround, mode) => run({ ...world }, ground, { x: soft }, hasGround, mode,
    (...args) => helper(...args, clamp), clamp);
}
function groundFactor() {
  const end = shaders.FRAG.indexOf('// cabin clip:');
  const begin = shaders.FRAG.indexOf('float k = ');
  assert.ok(begin >= 0 && end > begin);
  const stage = scalar(shaders.FRAG.slice(begin, end)).replace(/\bdiscard\s*;/g, 'return 0;');
  const run = new Function('vGround', 'uSoftOn', 'smoothstep', `${stage}; return k;`);
  return (value, softOn = 0) => run(value, softOn, smoothstep);
}
function composedFactor() {
  const main = bodyOf(shaders.FRAG, 'void main()');
  const end = main.indexOf('vec4 tx = texture2D(uMap'); assert.ok(end > 0);
  // Translate the original vec3 subtraction and texture mock into CPU scalar
  // inputs. All clipping decisions, signed heights, cabin distance, depth
  // linearization and the way their factors combine execute the source body.
  const body = scalar(main.slice(0, end))
    .replace(/\bvec3\b/g, 'let')
    .replace(/\b(p - uCabMin.xyz)\b/g, 'sub(p, uCabMin)')
    .replace(/\b(uCabMax.xyz - p)\b/g, 'sub(uCabMax, p)')
    .replace(/uCabPlane.xyz/g, 'uCabPlane')
    .replace(/texture2D\(uDepth, gl_FragCoord.xy \* uDepthInfo.xy\)/g, '({x: sceneDepthValue})')
    .replace(/\bdiscard\s*;/g, 'return 0;');
  const run = new Function('vCol', 'vGround', 'vClip', 'vCab', 'uCabMin', 'uCabMax', 'uCabPlane',
    'uSoftOn', 'vLitP', 'uDepthInfo', 'sceneDepthValue', 'vDepth', 'sub', 'dot', 'smoothstep', 'clamp',
    `${body}; return k;`);
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  return ({ ground = 1, cab = { x: 2, y: 0, z: 0 }, cabin = true, softOn = false,
    sceneDepth = 10, spriteDepth = 9.5, softDistance = 1 } = {}) => {
    // Perspective inverse depth is a fixture input. Production depth conversion
    // runs below and is checked against the independently selected sceneDepth.
    const near = .1, far = 1000, encodedDepth = (far - near * far / sceneDepth) / (far - near);
    return run({ a: 1 }, ground, cabin ? 1 : 0, cab, { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 1, w: 1 }, softOn ? 1 : 0, { w: softDistance }, { z: near, w: far }, encodedDepth,
      spriteDepth, sub, dot, smoothstep, clamp);
  };
}
function enabledGround() {
  const match = shaders.VERT.match(/bool hasGround\s*=\s*([^;]+);/); assert.ok(match);
  return new Function('gy', 'attached', `return ${match[1]};`);
}
function bounce() {
  const signature = 'if (hasGround && aPh.w > 0.0 && g > 0.1)';
  const body = scalar(bodyOf(shaders.VERT, signature));
  const evaluate = new Function('aP0', 'aPh', 'v0', 'gy', 'g', 'age', 'pos', `${body}; return pos.y;`);
  return (height, velocity, gravity, restitution, age, ground = 0) =>
    evaluate({ y: ground + height }, { w: restitution }, { y: velocity }, ground, gravity, age, { y: NaN });
}

test('actual ground stage preserves the whole rotated sprite instead of flattening below-ground corners', () => {
  const pool = new ParticleSystem(new THREE.Scene(), { cap: 4, uniforms: {}, name: 'ground-probe' });
  try {
    const quad = pool.geo.getAttribute('position'), stage = groundStage();
    for (const mode of [MODE.BILL, MODE.STREAK, MODE.UPRIGHT, MODE.FLAME, MODE.FWD, MODE.FIRE]) {
      // A real six-metre sprite crossing an elevated emitter plane. Retain its
      // affine geometry/UV mapping; the fragment shader handles ground fade.
      const root = new THREE.Vector3(19, 4.2, -31), right = new THREE.Vector3(1, .5, 0).normalize();
      const up = new THREE.Vector3(-.5, 1, 0).normalize(), original = [], evaluated = [];
      for (let i = 0; i < quad.count; i++) {
        const p = root.clone().addScaledVector(right, quad.getX(i) * 6).addScaledVector(up, quad.getY(i) * 6);
        original.push(p); evaluated.push(stage({ x: p.x, y: p.y, z: p.z }, 4, .3, true, mode).world);
      }
      assert.ok(original.some(p => p.y < 4) && original.some(p => p.y > 4));
      assert.deepEqual(evaluated, original.map(p => ({ x: p.x, y: p.y, z: p.z })), `mode ${mode}: no world vertex moves`);
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
        assert.ok(Math.abs(original[a].distanceTo(original[b]) - 6) < 1e-10);
      }
    }
  } finally { pool.dispose(); }
});

test('signed ground height stays linear across a triangle and uses the bounded .08-.35m band', () => {
  const height = groundHeight();
  for (const ground of [-25, 0, 71.5]) for (const [soft, width] of [[0, .08], [.01, .08], [.2, .2], [2.5, .35]]) {
    for (const unit of [-10, -.5, 0, .25, .5, .75, 1, 4]) {
      const actual = height(ground + unit * width, ground, soft, true, MODE.BILL, clamp);
      assert.ok(Math.abs(actual - unit) < 2e-12, `${ground}/${soft}/${unit}: linear signed height`);
    }
    // Vertex inputs must carry signed distance, not already-clamped alpha. At
    // the ground crossing, barycentric interpolation must yield exactly zero.
    const a = height(ground - width, ground, soft, true, 0, clamp);
    const b = height(ground + 3 * width, ground, soft, true, 0, clamp);
    assert.ok(Math.abs(.75 * a + .25 * b) < 1e-12);
  }
});

test('actual fragment ground multiplier fades even at Low with depth softness disabled', () => {
  const factor = groundFactor();
  for (const softOn of [0, 1]) {
    for (const value of [-10, -.0001, 0]) assert.equal(factor(value, softOn), 0);
    assert.ok(Math.abs(factor(.5, softOn) - .5) < 1e-15);
    assert.ok(factor(.25, softOn) > 0 && factor(.25, softOn) < .25);
    assert.ok(factor(.75, softOn) > .75 && factor(.75, softOn) < 1);
    for (const value of [1, 2, 10]) assert.equal(factor(value, softOn), 1);
  }
  // The actual fade comes before scene-depth access and either atlas sample,
  // so no texture/depth availability can turn it off or waste those samples.
  assert.ok(shaders.FRAG.indexOf('smoothstep(0.0, 1.0, vGround)') < shaders.FRAG.indexOf('texture2D(uDepth'));
  assert.ok(shaders.FRAG.indexOf('smoothstep(0.0, 1.0, vGround)') < shaders.FRAG.indexOf('texture2D(uMap'));
});

test('attached particles, no-ground tracers and authored ground rings are exempt at any world height', () => {
  const enabled = enabledGround(), height = groundHeight(), stage = groundStage(), factor = groundFactor();
  for (const gy of [-10000, 0, 50]) {
    assert.equal(enabled(gy, true), false);
    assert.equal(height(-100, gy, .3, enabled(gy, true), MODE.FIRE, clamp), 1);
  }
  assert.equal(enabled(-10000, false), false);
  for (const mode of [MODE.GROUND, MODE.STREAK, MODE.FWD, MODE.BILL]) for (const y of [-100, 0, 200]) {
    const hasGround = mode === MODE.GROUND;
    const output = stage({ x: 1, y, z: 2 }, 0, .2, hasGround, mode);
    assert.deepEqual(output.world, { x: 1, y, z: 2 });
    assert.equal(output.vGround, 1); assert.equal(factor(output.vGround, 0), 1);
  }
});

test('actual ground bounce block retains continuous impacts and all three ballistic arcs', () => {
  const y = bounce(), h = 1.5, v = 3, g = 9.8, e = .42;
  const impact = (v + Math.sqrt(v * v + 2 * g * h)) / g;
  const reboundSpeed = Math.sqrt(v * v + 2 * g * h) * e;
  const firstPeriod = 2 * reboundSpeed / g, nextSpeed = reboundSpeed * e, secondPeriod = 2 * nextSpeed / g;
  for (const ground of [-17, 0, 85]) {
    assert.equal(y(h, v, g, e, 0, ground), ground + h);
    assert.ok(Math.abs(y(h, v, g, e, impact, ground) - ground) < 1e-12);
    assert.ok(Math.abs(y(h, v, g, e, impact + firstPeriod / 2, ground) - ground - reboundSpeed ** 2 / (2 * g)) < 1e-12);
    assert.ok(Math.abs(y(h, v, g, e, impact + firstPeriod + secondPeriod / 2, ground) - ground - nextSpeed ** 2 / (2 * g)) < 1e-12);
    assert.equal(y(h, v, g, e, impact + firstPeriod + secondPeriod + .01, ground), ground);
    for (const boundary of [impact, impact + firstPeriod, impact + firstPeriod + secondPeriod]) {
      assert.ok(Math.abs(y(h, v, g, e, boundary - 1e-7, ground) - y(h, v, g, e, boundary + 1e-7, ground)) < 2e-6);
    }
  }
});

test('muzzle birth, subsequent tracer flight and endpoint clipping execute the unchanged actual helper', () => {
  const body = scalar(bodyOf(shaders.VERT, 'vec2 streakSpan(')).replace(/return vec2\(([^;]+)\);/, 'return [$1];');
  const span = new Function('travel', 'ribbonLength', 'clip', 'age', 'flags', 'clamp', body);
  assert.deepEqual(span(0, 6, 30, 0, PF.MUZZLE_START, clamp), [0, 6]);
  assert.deepEqual(span(0, 6, 30, 0, 0, clamp), [0, 0]);
  for (const travel of [1, 6, 20, 30, 34, 36, 45]) {
    const [tail, head] = span(travel, 6, 30, travel / 620, PF.MUZZLE_START, clamp);
    assert.ok(tail >= 0 && tail <= head && head <= 30);
    assert.equal(head, Math.min(travel, 30)); assert.equal(tail, clamp(travel - 6, 0, 30));
  }
});

test('actual cabin wall and windshield factor remains active with ground fade at full strength', () => {
  const body = bodyOf(shaders.FRAG, 'if (vClip > 0.5)');
  const start = body.indexOf('float inside ='), end = body.indexOf('if (k <=');
  assert.ok(start >= 0 && end > start);
  const statement = scalar(body.slice(start, end)).replace(/dot\(uCabPlane.xyz, p\)/g,
    '(uCabPlane.x*p.x + uCabPlane.y*p.y + uCabPlane.z*p.z)');
  const cabin = new Function('a', 'b', 'uCabPlane', 'p', 'smoothstep', `let k = 1; ${statement}; return k;`);
  // Unit cab around the origin, windshield at z=1. Fully inside is hidden;
  // exterior points stay visible, and the original 20cm/2cm soft band persists.
  const sample = p => cabin({ x: p.x + 1, y: p.y + 1, z: p.z + 1 }, { x: 1 - p.x, y: 1 - p.y, z: 1 - p.z },
    { x: 0, y: 0, z: 1, w: 1 }, p, smoothstep);
  assert.equal(sample({ x: 0, y: 0, z: 0 }), 0);
  assert.equal(sample({ x: 1.3, y: 0, z: 0 }), 1);
  assert.equal(sample({ x: 0, y: 0, z: 1.3 }), 1);
  assert.ok(sample({ x: 1.1, y: 0, z: 0 }) > 0 && sample({ x: 1.1, y: 0, z: 0 }) < 1);
});

test('actual fragment ground, cabin and scene-depth factors compose multiplicatively', () => {
  const factor = composedFactor(), partialCab = { x: 1.09, y: 0, z: 0 };
  // Floor .5 is preserved outside the cabin instead of overwritten to 1.
  for (const cabin of [false, true]) assert.equal(factor({ ground: .5, cabin }), .5);
  // Cabin signed distance -.09 lies at the middle of its [-.2,.02] band.
  assert.ok(Math.abs(factor({ ground: 1, cab: partialCab }) - .5) < 1e-14);
  assert.ok(Math.abs(factor({ ground: .5, cab: partialCab }) - .25) < 1e-14);
  assert.equal(factor({ ground: 0, cab: partialCab }), 0);
  assert.equal(factor({ ground: -4, cabin: false }), 0);
  assert.equal(factor({ ground: 1, cab: { x: 0, y: 0, z: 0 } }), 0);
  // Independently configured 10m scene and 9.5m sprite at softness1 give .5.
  assert.ok(Math.abs(factor({ ground: .5, softOn: true }) - .25) < 1e-11);
  assert.ok(Math.abs(factor({ ground: .5, cab: partialCab, softOn: true }) - .125) < 1e-11);
  assert.equal(factor({ ground: 1, softOn: true, spriteDepth: 11 }), 0);
  assert.equal(factor({ ground: 1, softOn: false, spriteDepth: 11 }), 1);
  // An exempt attached particle provides height1 and retains the original
  // cabin/depth behavior; no new floor clips the hood flame.
  const h = groundHeight(); assert.equal(h(-2, 0, .2, false, MODE.FIRE, clamp), 1);
  assert.ok(Math.abs(factor({ ground: h(-2, 0, .2, false, MODE.FIRE, clamp), cab: partialCab }) - .5) < 1e-14);
});

test('actual interleaved upload preserves soft distance, emitter ground, attachment flags and ground mode', () => {
  const pool = new ParticleSystem(new THREE.Scene(), { cap: 4, uniforms: {}, name: 'upload-probe' });
  try {
    const p = new PDesc(); p.ground = 37; p.soft = .25; p.mode = MODE.GROUND; p.flags = PF.ATTACH | PF.NOCLIP;
    pool.emit(p); pool.flush();
    assert.equal(pool.geo.instanceCount, 1); assert.equal(pool.data[22], 37);
    assert.equal(pool.data[28], MODE.GROUND); assert.equal(pool.data[44], .25); assert.equal(pool.data[47], PF.ATTACH | PF.NOCLIP);
    assert.equal(pool.data.length, 4 * STRIDE);
    pool.clear(); assert.equal(pool.live, 0); assert.equal(pool.hw, 0); assert.equal(pool.head, 0);
  } finally { pool.dispose(); }
});

function recipeRecorder(seed = 108) {
  const alpha = [], fire = [], jobs = [], lights = [], decals = [], debris = [];
  const fx = {
    p: new PDesc(), rng: new Rng(seed), qd: 1, time: 17,
    pa: { emit: p => alpha.push({ ...p }) }, pf: { emit: p => fire.push({ ...p }) },
    startSmokeColumn: (...args) => jobs.push({ kind: 'column', args }),
    startPop: (...args) => jobs.push({ kind: 'pop', args }),
    flashLight: (...args) => lights.push(args), debrisBurst: (...args) => debris.push(args),
    decScorch: { add: (...args) => decals.push(args) },
  };
  return { fx, alpha, fire, jobs, lights, decals, debris };
}
const numberClose = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) <= 1e-12, `${label}: ${actual} versus ${expected}`);

const blastCases = [
  {
    name: 'main explosion', counts: { alpha: 51, fire: 106, jobs: 3, lights: 1, debris: 1, decals: 1 },
    run: (fx, gy) => Recipes.explosion(fx, 12, gy + 1.3, 9, 1.25, { ground: gy }),
    flashes: [
      { at: [12, 1.9, 9], size: [9.975, 20.9475], life: .14, rgb: [12, 9, 5.5] },
      { at: [12, 2.1, 9], size: [16.8, 25.2], life: .32, rgb: [2.6, 1, .25] },
    ],
  },
  {
    name: 'secondary pop', counts: { alpha: 5, fire: 15, jobs: 0, lights: 1, debris: 0, decals: 0 },
    run: (fx, gy) => Recipes.miniPop(fx, 12, gy + 1.3, 9, .6, gy),
    flashes: [{ at: [12, 1.7, 9], size: [5.76, 11.52], life: .14, rgb: [8, 6, 3] }],
  },
  {
    name: 'boss cannon blast', counts: { alpha: 53, fire: 33, jobs: 0, lights: 1, debris: 0, decals: 0 },
    run: (fx, gy) => Recipes.cannonBlast(fx, 12, gy + 3, 9, 0, 0, 1, 2, 0, 8, gy),
    flashes: [
      { at: [12, 3, 10], size: [7, 14], life: .14, rgb: [12, 9, 6] },
      { at: [12, 3, 12], size: [16, 22.4], life: .26, rgb: [3.2, 1.4, .4] },
    ],
  },
  {
    name: 'Leviathan mega explosion', counts: { alpha: 82, fire: 270, jobs: 0, lights: 2, debris: 3, decals: 1 },
    run: (fx, gy) => Recipes.megaExplosion(fx, 12, gy + 2, 9, gy),
    flashes: [
      { at: [12, 6, 9], size: [70, 126], life: .35, rgb: [10, 7, 4] },
      { at: [12, 8, 9], size: [140, 182], life: .7, rgb: [2.6, 1.1, .3] },
    ],
  },
];

for (const spec of blastCases) test(`actual ${spec.name} flashes carry ground while preserving authored look and emission counts`, () => {
  for (const gy of [-17, 0, 62]) {
    const capture = recipeRecorder(); spec.run(capture.fx, gy);
    for (const [collection, expected] of Object.entries(spec.counts)) {
      assert.equal(capture[collection].length, expected, `${spec.name} ${collection} count at ${gy}`);
    }
    const flashes = capture.fire.filter(p => p.spr === SPR.FLASH);
    assert.equal(flashes.length, spec.flashes.length);
    for (const [i, p] of flashes.entries()) {
      const expected = spec.flashes[i];
      assert.equal(p.ground, gy); assert.equal(p.soft, .35); assert.equal(p.flags, 0); assert.equal(p.mode, MODE.BILL);
      numberClose(p.x, expected.at[0], 'x'); numberClose(p.y, gy + expected.at[1], 'y'); numberClose(p.z, expected.at[2], 'z');
      numberClose(p.s0, expected.size[0], 'initial size'); numberClose(p.s1, expected.size[1], 'final size');
      assert.equal(p.life, expected.life); assert.deepEqual([p.r0, p.g0, p.b0], expected.rgb);
      assert.deepEqual([p.r1, p.g1, p.b1], expected.rgb); assert.equal(p.a0, 1); assert.equal(p.a1, 1);
      assert.equal(p.add0, 1); assert.equal(p.add1, 1); assert.equal(p.fin, 0); assert.equal(p.fout, .85);
      assert.equal(p.sCurve, .5); assert.equal(p.rotV, 0); assert.ok(p.rot >= 0 && p.rot < 2 * Math.PI);
      assert.deepEqual([p.vx, p.vy, p.vz, p.drag, p.grav, p.bounce, p.wind, p.turb, p.delay], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
    // Ground rings remain authored horizontal sprites. Passing emitter ground
    // to the large halos must not turn every effect into a grounded billboard.
    for (const ring of capture.fire.filter(p => p.mode === MODE.GROUND)) {
      assert.equal(ring.spr, SPR.SHOCK); assert.equal(ring.ground, -10000); assert.equal(ring.soft, 0);
    }
    for (const job of capture.jobs) {
      assert.equal(job.args[4], gy);
    }
  }
});

test('actual optional-ground glow preserves defaults, flags and reset isolation for unrelated flashes and sparks', () => {
  const capture = recipeRecorder(), flags = PF.ATTACH | PF.NOCLIP | PF.FLIPU;
  Recipes.glow(capture.fx, 1, 2, 3, 4, .2, 7, 5, 2, true, 1.5, flags, 0);
  Recipes.glow(capture.fx, 1, 2, 3, 4, .2, 7, 5, 2, true, 1.5, flags);
  Recipes.glow(capture.fx, 1, 2, 3, 4, .2, 7, 5, 2, false, 1.5, 0);
  assert.equal(capture.fire.length, 3);
  const [grounded, unrelated, spark] = capture.fire;
  assert.equal(grounded.ground, 0); assert.equal(grounded.soft, .35); assert.equal(grounded.flags, flags);
  assert.equal(unrelated.ground, -10000); assert.equal(unrelated.soft, 0); assert.equal(unrelated.flags, flags);
  assert.equal(unrelated.spr, SPR.FLASH); assert.equal(spark.spr, SPR.SPARK); assert.equal(spark.ground, -10000); assert.equal(spark.soft, 0);
  const ignoreContactAndRandomRotation = p => {
    const rest = { ...p };
    for (const key of ['ground', 'soft', 'rot', 'flags', 'spr']) delete rest[key];
    return rest;
  };
  assert.deepEqual(ignoreContactAndRandomRotation(grounded), ignoreContactAndRandomRotation(unrelated));
  assert.deepEqual(ignoreContactAndRandomRotation(unrelated), ignoreContactAndRandomRotation(spark));
  // Attached particles still ignore world-ground tags in the actual shader.
  assert.equal(enabledGround()(grounded.ground, (grounded.flags & PF.ATTACH) !== 0), false);
});

test('actual pistol, SMG, shotgun and rifle muzzle glows stay ungrounded with their authored weapon tuning', () => {
  const counts = { pistol: { fire: 6, alpha: 1 }, smg: { fire: 5, alpha: 1 }, shotgun: { fire: 12, alpha: 4 }, rifle: { fire: 6, alpha: 1 } };
  for (const wid of Object.keys(counts)) for (const gy of [-17, 0, 62]) {
    const capture = recipeRecorder(), cfg = MUZZLE[wid];
    Recipes.muzzle(capture.fx, wid, 4, 3, 8, 0, 0, 1, 2, 0, 8, gy);
    assert.equal(capture.fire.length, counts[wid].fire); assert.equal(capture.alpha.length, counts[wid].alpha);
    const flashes = capture.fire.filter(p => p.spr === SPR.FLASH); assert.equal(flashes.length, 1);
    const p = flashes[0]; assert.equal(p.ground, -10000); assert.equal(p.soft, 0); assert.equal(p.flags, 0);
    assert.deepEqual([p.x, p.y, p.z], [4, 3, 8.15]);
    numberClose(p.s0, cfg.glow * .7, 'muzzle glow size'); numberClose(p.s1, cfg.glow * .7 * 1.3, 'muzzle glow growth');
    numberClose(p.life, cfg.life * 1.1, 'muzzle life');
    numberClose(p.r0, cfg.col[0] * cfg.hdr * .35, 'muzzle red');
    numberClose(p.g0, cfg.col[1] * cfg.hdr * .3, 'muzzle green');
    numberClose(p.b0, cfg.col[2] * cfg.hdr * .25, 'muzzle blue');
    assert.equal(p.add0, 1); assert.equal(p.add1, 1); assert.equal(p.fin, 0); assert.equal(p.fout, .85);
    assert.equal(capture.lights.length, 0); assert.equal(capture.jobs.length, 0);
  }
});

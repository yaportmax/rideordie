import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAMPAIGN_THEMES, CAMPAIGN_THEME_IDS } from '../src/data/campaign_themes.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { Road } from '../src/world/road.js';
import { LAYERS } from '../src/world/terrain_gen.js';
import { AssetKit } from '../src/world/dressing/assets.js';
import { InstList, ChunkGround, CHUNK_LEN } from '../src/world/dressing/util.js';
import { buildCampaignThemes, registerCampaignThemeAssets } from '../src/world/dressing/campaign_themes.js';
import { CAMPAIGN_CHUNK_BUDGET } from '../src/world/dressing/campaign_theme_builder.js';
import { drivingJourneyStages, stageChallenges, protectedDrivingSpan, branchDrivingReserved, CAMPAIGN_BRANCH_LIMIT } from '../src/world/driving_plan.js';

test('new themes retain complete numeric biome contracts and distinct terrain kinds', () => {
  assert.deepEqual(CAMPAIGN_THEME_IDS, ['underground', 'sky', 'hell', 'space']);
  assert.equal(new Set(CAMPAIGN_THEME_IDS.map(id => CAMPAIGN_THEMES[id].terrain.kind)).size, 4);
  for (const id of CAMPAIGN_THEME_IDS) {
    const theme = CAMPAIGN_THEMES[id];
    for (const key of ['kmax', 'straight', 'sigma', 'slopeMax', 'elevBase', 'elevAmp', 'elevScale', 'bank']) assert.ok(Number.isFinite(theme.road[key]), `${id}.road.${key}`);
    for (const key of ['sun', 'az', 'turbidity', 'rayleigh', 'mie', 'exposure', 'fog', 'fogDensity', 'sunColor', 'sunI', 'hemiSky', 'hemiGround', 'hemiI']) assert.ok(Number.isFinite(theme.sky[key]), `${id}.sky.${key}`);
    assert.ok(theme.ground.every(layer => LAYERS.includes(layer)), `${id} uses available texture layers`);
    assert.equal(Object.values(theme.scatter).reduce((sum, v) => sum + v, 0), 0, `${id} uses authored theme art rather than desert natural scatter`);
    assert.ok(theme.dressing.minimumClearance >= 24);
  }
});

test('finite campaigns and marathon challenges use their own boss and theme coordinates', () => {
  for (const level of TEN_LEVELS) {
    const journey = { mode: 'campaign', level: level.number }, stages = drivingJourneyStages(journey), plan = stageChallenges(19, journey);
    assert.equal(stages.length, 1); assert.equal(stages[0].biome, level.id); assert.equal(stages[0].boss, level.bossDistance);
    const warnings = plan.filter(f => f.type === 'stage_warning');
    assert.ok(warnings.length, `${level.id} has a meaningful planned driving group`);
    for (const warning of warnings) {
      assert.equal(warning.biome, level.id);
      assert.equal(protectedDrivingSpan(warning.group.s0, warning.group.s1, journey), false);
      assert.ok(warning.group.s1 < level.bossDistance - 1000, 'boss approach remains clear');
    }
  }
  const marathon = drivingJourneyStages({ mode: 'marathon', level: 1 });
  assert.equal(marathon.length, 10); assert.equal(marathon.at(-1).s1, 80000);
  assert.deepEqual(marathon.map(stage => stage.s0), TEN_LEVELS.map((_, i) => i * 8000));
});

test('selected-level branch planning is bounded and late worlds retain physically qualified cuts', () => {
  for (const level of TEN_LEVELS) {
    const road = new Road(1, { mode: 'campaign', level: level.number });
    const branches = road.ensureDrivingBranches();
    assert.ok(road.sEnd <= level.bossDistance + 800, `${level.id} planning must not generate the legacy60km road`);
    assert.ok(branches.length <= CAMPAIGN_BRANCH_LIMIT[level.id], 'bounded physically qualified cuts per selected stage');
    for (const b of branches) {
      assert.equal(b.biome, level.id);
      assert.ok(b.saved >= 4 && b.maxGrade <= .085 && b.maxCurvature <= 1 / 70);
      assert.equal(protectedDrivingSpan(b.s0 - 100, b.s1 + 100, road.journey), false);
      assert.equal(branchDrivingReserved(road.drivingPlan, b.s0, b.s1, 100), false);
      assert.ok(b.s0 >= 650 && b.s1 < level.bossDistance - 1000);
    }
  }
  // Qualification can be absent for an individual seed. The new worlds still
  // need genuine physical cuts in an explicitly retained seed union.
  for (const id of CAMPAIGN_THEME_IDS) {
    const level = TEN_LEVELS.find(level => level.id === id).number;
    const union = [1, 7, 11, 31].flatMap(seed => new Road(seed, { mode: 'campaign', level }).ensureDrivingBranches());
    assert.ok(union.some(branch => branch.biome === id), `${id} must qualify in this declared four-seed union; do not relax savings/grade/curvature to force it`);
  }
});

function themeFixture(id, seed = 3) {
  const level = TEN_LEVELS.find(level => level.id === id).number;
  const road = new Road(seed, { mode: 'campaign', level });
  assert.equal(road.biomeAt(0).a, id, 'actual contextual Road provides selected theme at origin');
  road.extendTo(700); road.ensureDrivingBranches();
  const kit = new AssetKit(), specs = new Map(), pool = { register: (name, spec) => specs.set(name, spec) };
  registerCampaignThemeAssets(kit, pool);
  const hooks = [], lists = new Map(), extras = [];
  const chunk = { c: 0, s0: 0, done: new Set(), hooks: [], dirty: false, extras, lists,
    ground: new ChunkGround(road, seed, 0, []),
    list(name) { if (!lists.has(name)) lists.set(name, new InstList()); return lists.get(name); },
    addExtra(mesh) { extras.push(mesh); },
  };
  chunk.ground.build();
  const ctx = { road, seed, kit, pool, hook: req => hooks.push(req) };
  return { road, kit, specs, chunk, hooks, ctx };
}

for (const id of CAMPAIGN_THEME_IDS) test(`${id} chunk has bounded authored art, exact near-road collision and idempotent ownership`, () => {
  const f = themeFixture(id);
  try {
    assert.equal(buildCampaignThemes(f.ctx, f.chunk), true);
    assert.ok(f.chunk.extras.length > 0 && f.chunk.extras.length <= 2);
    const stats = f.chunk.campaignThemeStats[0];
    assert.ok(stats.vertices > 100, 'theme emits actual geometry');
    assert.ok(stats.vertices <= CAMPAIGN_CHUNK_BUDGET.vertices);
    assert.ok(stats.collisionTriangles > 0 && stats.collisionTriangles <= CAMPAIGN_CHUNK_BUDGET.collisionTriangles);
    assert.ok(stats.instances <= CAMPAIGN_CHUNK_BUDGET.instances);
    assert.equal(f.hooks.length, 1); assert.equal(f.chunk.hooks.length, 1);
    const collision = f.hooks[0].collision;
    const vertices = new Set();
    for (const mesh of f.chunk.extras) {
      assert.equal(mesh.userData.ownGeo, true);
      assert.ok(mesh.geometry.boundingSphere && Number.isFinite(mesh.geometry.boundingSphere.radius));
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) vertices.add([pos.getX(i) + mesh.position.x, pos.getY(i) + mesh.position.y, pos.getZ(i) + mesh.position.z].map(v => Math.fround(v).toFixed(4)).join(','));
    }
    for (let i = 0; i < collision.pos.length; i += 3) assert.ok(vertices.has(Array.from(collision.pos.subarray(i, i + 3)).map(v => v.toFixed(4)).join(',')), 'every collision vertex comes from the visible merged geometry');
    const extrasBefore = f.chunk.extras.length, hooksBefore = f.hooks.length;
    assert.equal(buildCampaignThemes(f.ctx, f.chunk), true);
    assert.equal(f.chunk.extras.length, extrasBefore); assert.equal(f.hooks.length, hooksBefore);
    // Existing chunk retirement frees geometry; kit retirement owns materials.
    let retired = 0;
    for (const mesh of f.chunk.extras) { mesh.geometry.addEventListener('dispose', () => retired++); mesh.geometry.dispose(); }
    assert.equal(retired, extrasBefore);
  } finally { f.kit.dispose(); }
});

test('underground shell has an open bore at both chunk endpoints, including the rear', () => {
  const f = themeFixture('underground');
  try {
    buildCampaignThemes(f.ctx, f.chunk);
    const collision = f.hooks[0].collision;
    for (const s of [0, CHUNK_LEN]) {
      const eye = f.road.pointAt(s, 0, {}); eye.y += 3;
      const near = f.road.pointAt(s + (s === 0 ? 1 : -1), 0, {});
      const origin = new THREE.Vector3(eye.x, eye.y, eye.z);
      const direction = new THREE.Vector3(near.x - eye.x, 0, near.z - eye.z).normalize();
      const ray = new THREE.Ray(origin, direction), hit = new THREE.Vector3();
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let i = 0; i < collision.idx.length; i += 3) {
        a.fromArray(collision.pos, collision.idx[i] * 3); b.fromArray(collision.pos, collision.idx[i + 1] * 3); c.fromArray(collision.pos, collision.idx[i + 2] * 3);
        const crossing = ray.intersectTriangle(a, b, c, false, hit);
        assert.ok(!crossing || origin.distanceTo(hit) > 8, `no road-height front/rear end wall at s=${s}`);
      }
    }
  } finally { for (const mesh of f.chunk.extras) mesh.geometry.dispose(); f.kit.dispose(); }
});

test('sky physical boundary rails remain intact beside a closed-lane stage challenge', () => {
  const baseline = themeFixture('sky'), challenge = themeFixture('sky');
  try {
    challenge.road.features.push({ type: 'stage_challenge', s0: 40, s1: 42.2, biome: 'sky', row: 0, passSide: 1, gap: 6.4, challengeId: 'boundary-positive-control' });
    buildCampaignThemes(baseline.ctx, baseline.chunk); buildCampaignThemes(challenge.ctx, challenge.chunk);
    assert.ok(baseline.hooks[0].collision.idx.length > 0, 'actual boundary positive control');
    assert.deepEqual(challenge.hooks[0].collision.pos, baseline.hooks[0].collision.pos);
    assert.deepEqual(challenge.hooks[0].collision.idx, baseline.hooks[0].collision.idx);
  } finally {
    for (const f of [baseline, challenge]) { for (const mesh of f.chunk.extras) mesh.geometry.dispose(); f.kit.dispose(); }
  }
});

test('four stage obstacle kits have different silhouettes and collision from actual geometry', () => {
  const kit = new AssetKit();
  try {
    registerCampaignThemeAssets(kit, { register() {} });
    const names = ['campaign_bulkhead', 'campaign_prism_barrier', 'campaign_basalt', 'campaign_docking_clamp'];
    const silhouettes = new Set();
    for (const name of names) {
      const asset = kit.get(name), g = asset.parts[0].geometry;
      assert.deepEqual(asset.collision.pos, g.attributes.position.array);
      assert.deepEqual(asset.collision.idx, Uint32Array.from(g.index.array));
      // Equal box/beam counts do not mean equal silhouettes. Compare the real
      // front-view convex outline; this also rejects recoloured copies of the
      // same shape without depending on tessellation or vertex ordering.
      const xy = new Map(), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const point = [p.getX(i), p.getY(i)]; xy.set(point.map(v => v.toFixed(5)).join(','), point);
      }
      const points = [...xy.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const half = rows => {
        const hull = [];
        for (const point of rows) { while (hull.length >= 2 && cross(hull.at(-2), hull.at(-1), point) <= 0) hull.pop(); hull.push(point); }
        return hull.slice(0, -1);
      };
      const hull = [...half(points), ...half(points.slice().reverse())];
      silhouettes.add(hull.map(point => point.map(v => v.toFixed(5)).join(',')).join(';'));
    }
    assert.equal(silhouettes.size, 4);
  } finally { kit.dispose(); }
});

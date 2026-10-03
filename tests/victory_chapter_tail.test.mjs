// Twenty sequential CPU scenes, actual local authority for each human seat.
// Generated terrain is real. This is controlled boss-death tail coverage, not
// earned campaign play, native camera pixels, performance or network evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVictoryTailEnvironment, createVictoryTailScene, clearRegisteredVictoryBoss,
  driveVictoryTail, disposeVictoryTailScene, retainVictoryTailEvidence, AIDriver, AIGunner,
  TEN_LEVELS, verifiedBossClear, celebrationActive } from './helpers/victory_tail_scene.mjs';

for (const level of TEN_LEVELS) for (const role of ['driver', 'gunner']) {
  test(`actual ${level.id} level${level.number} ${role} authority keeps supported AI motion and a frozen once-paid result for 15s after clear`,
    { concurrency: false }, async t => {
      const environment = installVictoryTailEnvironment(t, { randomSeed: 0x71c4 + level.number * 31 + (role === 'gunner' ? 1 : 0) });
      const scene = await createVictoryTailScene({ role, level: level.number, seed: 7 });
      const { run, sim, player, game, app, profile, results, counters, ground } = scene;
      let passed = false, failure = null;
      try {
        assert.equal(run.role, role); assert.equal(run.net, null); assert.equal(run.simPeer, true);
        assert.equal(run.ai, role === 'driver' ? 'gunner' : 'driver');
        assert.equal(run.humanDriver, role === 'driver'); assert.equal(run.humanGunner, role === 'gunner');
        assert.equal(run.driverLocal, true); assert.equal(run.gunnerLocal, true);
        assert.equal(game.audio, null); assert.equal(game.post, null);
        assert.equal(ground.groundReady(player.s, player.route), true);
        const originalGunner = run.gunner;
        const clear = clearRegisteredVictoryBoss(scene);
        assert.equal(run.gunner, originalGunner, 'local weapon state retains the existing controller');
        assert.ok(run.aiDriver instanceof AIDriver); assert.ok(run.aiGunner instanceof AIGunner);
        assert.equal(run.aiDriver.run, run); assert.equal(run.aiGunner.run, run);
        assert.equal(verifiedBossClear(sim), true); assert.equal(celebrationActive(sim), true);
        const profileGear = structuredClone({ truck: profile.truck, trucks: profile.trucks,
          upgrades: profile.upgrades, weapons: profile.weapons, loadout: profile.loadout });
        let damageAttempts = 0, groundedRows = 0, sightRows = 0;
        const checkpoints = new Set([60, 540, 780]);
        driveVictoryTail(scene, environment, { postClearSeconds: 15, resultsSeconds: 5, onFrame(row) {
          // Actual source damage entry points are exercised before/after natural
          // runOver and Results. Protection does not disable physics or AI.
          if (checkpoints.has(row.frame)) {
            sim.damageCar(player, player.maxHp * 2, { src: scene.target.id, cause: 'ram' });
            sim.damageCrew(player, 'driver', player.crew.driver.max * 2, { src: scene.target.id, cause: 'bullet' });
            sim.damageCrew(player, 'gunner', player.crew.gunner.max * 2, { src: scene.target.id, cause: 'bullet' });
            damageAttempts++;
          }
          assert.equal(game.paused, false, 'the real frame loop must keep dispatching');
          assert.equal(celebrationActive(sim), true); assert.equal(player.held, false);
          assert.equal(player.exploded, false); assert.equal(player.dead, false);
          assert.equal(player.hp, clear.protection.hp); assert.equal(player.crew.driver.hp, clear.protection.driver);
          assert.equal(player.crew.gunner.hp, clear.protection.gunner);
          assert.equal(player.crew.driver.alive, true); assert.equal(player.crew.gunner.alive, true);
          assert.equal(row.groundReady, true, 'source collider support must remain ready along this authored tail');
          assert.ok(row.bounds && Number.isFinite(row.bounds.minY), 'authored terrain lower bounds remain queryable');
          assert.ok(row.pos.every(Number.isFinite) && row.velocity.every(Number.isFinite));
          assert.ok(row.cameraPos.every(Number.isFinite) && row.cameraQuat.every(Number.isFinite) && Number.isFinite(row.fov));
          assert.ok(Math.abs(Math.hypot(...row.cameraQuat) - 1) < 1e-4, 'source camera orientation stays normalized');
          assert.ok(row.pos[1] > row.bounds.minY - 12, 'no persistent position under every source terrain triangle');
          assert.ok(Math.abs(row.d) < row.halfWidth + 20, 'actual AI stays within the authored road/adjacent recovery corridor');
          if (Math.abs(row.d) <= row.halfWidth + 1) assert.ok(row.pos[1] > row.roadY - 6,
            'road-centered celebration does not pass through source road triangles');
          if (row.bounds.waterY !== null && Math.abs(row.d) > row.halfWidth + 6) assert.ok(row.pos[1] > row.bounds.waterY - 2,
            'post-clear movement does not remain submerged beside authored water');
          if (row.grounded >= 2) groundedRows++;
          if (row.aiTarget && row.rays > 0) sightRows++;
          assert.equal(player.veh.input.nitro, false); assert.equal(run.aiDriver.cmd.special1, false);
          assert.equal(run.aiDriver.cmd.special2, false); assert.equal(run.aiDriver.cmd.medkit, false);
          assert.equal(run.medkits, clear.medkits); assert.equal(run.shots, clear.runShots);
          assert.equal(run.hitsLanded, clear.hitsLanded); assert.equal(run.cash, clear.runCash);
          assert.deepEqual(sim.victoryStats, clear.frozenStats); assert.deepEqual(run.victorySummary, clear.summary);
          assert.deepEqual({ role: run.role, ai: run.ai, simPeer: run.simPeer, humanDriver: run.humanDriver,
            humanGunner: run.humanGunner, driverLocal: run.driverLocal, gunnerLocal: run.gunnerLocal, net: run.net }, clear.ownership);
          if (row.screen === 'results') {
            assert.equal(counters.lastHudVisible, false, 'actual Results keeps HUD ownership');
            assert.equal(profile.cash, scene.resultsStart.cash); assert.equal(profile.runs, scene.resultsStart.runs);
            assert.deepEqual(run.summary, scene.resultsStart.summary);
          }
          if (level.number < 10 || row.finaleDone) {
            assert.equal(row.cinematic, true); assert.equal(row.introOutside, true); assert.equal(row.chaseMode, 1);
          }
        } });
        const last = scene.trace.at(-1);
        assert.ok(last.postClearSeconds >= 15); assert.ok(sim.time - scene.resultsStart.simTime >= 5);
        assert.equal(damageAttempts, 3); assert.ok(groundedRows >= 300, 'actual wheel contacts support at least five logical seconds');
        assert.ok(sightRows > 0 && counters.rays > 0, 'actual AI target selection and world sight queries run');
        assert.ok(counters.shots.length > 0, 'actual temporary AI finishes real controller shots');
        assert.ok(counters.hits.some(hit => hit.carId === scene.target.id), 'actual AI damages the controlled actual Technical');
        assert.ok(scene.target.exploded || scene.target.hp < scene.target.maxHp ||
          Object.values(scene.target.crew).some(crew => crew.hp < crew.max), 'accepted reports produce real enemy damage');
        assert.ok(player.s > clear.s + 50, 'actual physics advances at least fifty route meters during the fifteen-second tail');
        assert.ok(player.s > scene.resultsStart.s + 10, 'actual motion continues at least ten meters beneath Results');
        assert.ok(sim.tick > scene.resultsStart.tick + 500, 'actual 120Hz physics advances through five Results seconds');
        assert.equal(sim.state, 'over'); assert.equal(sim.won, true); assert.equal(run.over, true); assert.equal(run.finished, true);
        assert.equal(app.screen, 'results'); assert.equal(results.length, 1); assert.equal(run.summary.cause, 'VICTORY');
        assert.equal(run.summary.levelCleared, true); assert.equal(run.summary.journey.level, level.number);
        assert.equal(profile.cash, clear.cash + run.summary.cash); assert.equal(profile.runs, clear.runs + 1);
        assert.equal(profile.campaignProgress.cleared.includes(level.number), true);
        assert.deepEqual({ truck: profile.truck, trucks: profile.trucks, upgrades: profile.upgrades,
          weapons: profile.weapons, loadout: profile.loadout }, profileGear, 'seat takeover does not mutate personal gear');
        const paid = { cash: profile.cash, runs: profile.runs };
        app._results(run); assert.equal(results.length, 1); assert.deepEqual({ cash: profile.cash, runs: profile.runs }, paid);
        if (level.number === 10) assert.equal(run.finaleDone, true, 'actual Leviathan orbit hands off after its nine-second boundary');
        assert.ok(counters.renders >= 900 && counters.hud >= 900, 'actual source Game render/HUD consumer dispatch keeps running');
        // Source lifecycle, followed by an idempotent repeat, retires ownership,
        // all generated support/colliders and the life-owned WASM/event queues.
        disposeVictoryTailScene(scene);
        assert.equal(run.disposed, true); assert.equal(run.aiDriver, null); assert.equal(run.aiGunner, null);
        assert.equal(run.gunner, null); assert.equal(run._victoryControls, null); assert.equal(run.victoryPresentation, false);
        assert.equal(sim.world, null); assert.equal(sim.eventQueue, null); assert.equal(sim.ground, null);
        assert.equal(sim.player, null); assert.equal(sim.boss, null); assert.equal(sim.cars.size, 0);
        assert.equal(sim.colMap.size, 0); assert.equal(sim.events.length, 0); assert.equal(ground.chunks.size, 0);
        assert.equal(ground.disposed, true); disposeVictoryTailScene(scene); passed = true;
      } catch (error) { failure = error; throw error; }
      finally {
        // Persist before outer teardown. Reports retain each failed chronology,
        // rather than replacing a failure with a later successful rerun.
        await retainVictoryTailEvidence(t, scene, { passed, error: failure });
        disposeVictoryTailScene(scene);
      }
    });
}

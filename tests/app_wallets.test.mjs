import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let App;
try { ({ App } = await import('../src/app.js')); } finally { css.deregister(); }

function fixture() {
  const personal = DEFAULT_PROFILE(); personal.campaignId = 'guest-person'; personal.cash = 2000;
  const initial = DEFAULT_PROFILE(); initial.campaignId = 'host-person'; initial.cash = 2000; initial.best.distance = 500;
  const summary = { id: 'team-run', cash: 400, distance: 800, furthestS: 840, time: 20, kills: 3 };
  const run = { cfg: { profile: initial }, remoteSummary: summary };
  const shown = []; let releases = 0;
  const app = Object.assign(Object.create(App.prototype), {
    profile: initial, personalProfile: personal, screen: 'run', mode: 'coop', session: null,
    input: { releaseLock() { releases++; } }, sound() {},
    game: { run, paused: false, hud: { setVisible() {} }, audio: { music: { setState() {} } } },
    ui: { settings: {}, showResults(value, profile) { shown.push({ value, profile }); } },
  });
  const session = app._newSession(); session.isHost = false; session.personalProfile = personal; session.profile = initial;
  session.wallet = { playerId: personal.campaignId, cash: 2000, totalCash: 0, lastRunId: null };
  const paid = () => {
    const p = { ...initial, revision: 1, runs: 1, cash: 7400, best: { distance: 800, furthestS: 840, time: 20, kills: 3 } };
    session._onMsg({ t: 'profile', p, wallet: { playerId: personal.campaignId, cash: 2400, totalCash: 400, lastRunId: summary.id } });
  };
  return { app, session, run, summary, shown, paid, releases: () => releases };
}

test('guest results resume after host payment arrives and retain pre-run best/cash metadata', () => {
  const f = fixture(); f.app._results(f.run);
  assert.equal(f.app.screen, 'run'); assert.equal(f.app._pendingResults, f.run); assert.equal(f.shown.length, 0); assert.equal(f.releases(), 0);
  f.paid();
  assert.equal(f.app.screen, 'results'); assert.equal(f.app._pendingResults, null); assert.equal(f.releases(), 1); assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].profile.cash, 2400); assert.equal(f.shown[0].value.cashBefore, 2000);
  assert.equal(f.shown[0].value.bestBefore.distance, 500); assert.equal(f.shown[0].value.newBest.distance, true);
  f.paid(); f.app._results(f.run); assert.equal(f.shown.length, 1); assert.equal(f.app.profile.cash, 2400);
});

test('payment arriving before local crash transition still displays the personal balance and pre-run records', () => {
  const f = fixture(); f.paid(); assert.equal(f.shown.length, 0);
  f.app._results(f.run); assert.equal(f.shown.length, 1); assert.equal(f.shown[0].profile.cash, 2400);
  assert.equal(f.shown[0].value.cashBefore, 2000); assert.equal(f.shown[0].value.newBest.distance, true);
});

test('a pending guest result cannot reopen after a different run or screen replaces it', () => {
  const f = fixture(); f.app._results(f.run); f.app.game.run = { id: 'replacement' }; f.paid();
  assert.equal(f.shown.length, 0);
  f.app.game.run = f.run; f.app.screen = 'garage'; f.app._garageRefresh = () => {}; f.paid(); assert.equal(f.shown.length, 0);
});

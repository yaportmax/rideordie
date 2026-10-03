import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignMapState, campaignSelectionMarkup, CampaignScreen } from '../src/ui/screens/campaign.js';
import { TEN_LEVELS, creditCampaignLevel, selectCampaignLevel } from '../src/data/campaign.js';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { Nav } from '../src/ui/nav.js';
import { readFile } from 'node:fs/promises';

// Generated markup and actual screen/Nav methods only. No browser, renderer,
// device input, audio context or event listener is started by these tests.

const progressed = count => {
  const profile = DEFAULT_PROFILE();
  for (let level = 1; level <= count; level++) creditCampaignLevel(profile, { runId: 'map-clear-' + level, level, mode: 'campaign', won: true });
  return profile;
};
const card = (html, level) => html.match(new RegExp(`<div class="campaign-card [^>]*data-level="${level}"[^>]*>[\\s\\S]*?<span class="campaign-status">([^<]+)</span></div>`))?.[0];

test('fresh map shows ten distinct worlds, one frontier and nine locked worlds without changing the save', () => {
  const profile = DEFAULT_PROFILE(), before = structuredClone(profile), map = campaignMapState(profile), html = campaignSelectionMarkup(profile);
  assert.equal(map.clearedCount, 0); assert.equal(map.nextLevel.number, 1);
  assert.deepEqual(map.nodes.map(node => node.id), TEN_LEVELS.map(level => level.id));
  assert.equal(map.nodes.filter(node => node.frontier).length, 1); assert.equal(map.nodes.filter(node => node.locked).length, 9);
  assert.equal((html.match(/class="campaign-card /g) || []).length, 10);
  assert.equal((html.match(/class="campaign-route-link /g) || []).length, 9);
  assert.equal((html.match(/class="campaign-world-scene"/g) || []).length, 10);
  for (const level of TEN_LEVELS) assert.match(html, new RegExp(`data-theme="${level.id}"`));
  assert.match(card(html, 1), /role="button"/); assert.match(card(html, 2), /aria-disabled="true"/);
  assert.match(html, /aria-valuenow="0"/); assert.match(html, /Clear all ten campaign levels/);
  assert.deepEqual(profile, before);
});

test('map progress follows earned clears and distinguishes a selected replay from the next world', () => {
  const profile = progressed(3); selectCampaignLevel(profile, 2);
  const before = structuredClone(profile), map = campaignMapState(profile), html = campaignSelectionMarkup(profile);
  assert.equal(map.clearedCount, 3); assert.equal(map.nextLevel.number, 4);
  assert.equal(map.nodes.find(node => node.current).number, 2);
  assert.equal(map.nodes.find(node => node.frontier).number, 4);
  assert.equal((html.match(/class="campaign-route-link cleared"/g) || []).length, 3);
  assert.match(card(html, 2), /selected/); assert.match(card(html, 2), />CLEARED</);
  assert.match(card(html, 4), />NEXT WORLD</); assert.match(card(html, 5), /aria-disabled="true"/);
  assert.match(html, /CLEARED · REPLAY AVAILABLE/); assert.match(html, /aria-valuenow="3"/);
  assert.deepEqual(profile, before);
});

test('forged unlock and marathon flags do not create selectable worlds or a completed route', () => {
  const profile = DEFAULT_PROFILE();
  profile.campaignProgress = { cleared: [1, 1, 2, 4], selectedLevel: 10, unlockedLevel: 10, selectedMode: 'marathon', marathonUnlocked: true };
  const map = campaignMapState(profile), html = campaignSelectionMarkup(profile);
  assert.equal(map.progress.unlockedLevel, 3); assert.equal(map.progress.selectedMode, 'campaign');
  assert.equal(map.nextLevel.number, 3); assert.equal(map.complete, false);
  assert.match(card(html, 4), /aria-disabled="true"/);
  assert.equal((html.match(/class="campaign-route-link cleared"/g) || []).length, 2);
  assert.doesNotMatch(html, /campaign-marathon f/);
});

test('completed map unlocks marathon and does not invent another frontier', () => {
  const profile = progressed(10); selectCampaignLevel(profile, 1, 'marathon');
  const map = campaignMapState(profile), html = campaignSelectionMarkup(profile);
  assert.equal(map.complete, true); assert.equal(map.nextLevel, null); assert.equal(map.nodes.some(node => node.frontier), false);
  assert.match(html, /ALL TEN WORLDS CLEARED/); assert.match(html, /aria-valuenow="10"/);
  assert.match(html, /campaign-marathon f selected/); assert.match(html, /MARATHON · ALL TEN WORLDS/);
});

test('guest map keeps progress visible while every world and marathon remain read-only', () => {
  const profile = progressed(10), before = structuredClone(profile), html = campaignSelectionMarkup(profile, { canSelect: false });
  assert.doesNotMatch(html, /campaign-card f|campaign-marathon f/);
  assert.match(html, /aria-valuenow="10"/); assert.match(html, /The host chooses the next level/);
  assert.deepEqual(profile, before);
  assert.deepEqual(CampaignScreen.prototype.selection.call({ profile, extra: { canSelect: false } }), {
    level: 1, mode: 'campaign', unlockedLevel: 10, marathonUnlocked: true, canSelect: false,
  });
});

test('map clicks retain the callback boundary and reject locked and guest-forced activation', () => {
  const profile = progressed(2), before = structuredClone(profile), selected = [];
  const screen = { profile, extra: {}, el: { contains: () => true }, ui: { snd() {} }, cb: { onSelect: (...args) => selected.push(args) } };
  const click = (level, mode = 'campaign') => CampaignScreen.prototype.onClick.call(screen, { target: { closest: () => ({ dataset: { level: String(level), mode } }) } });
  click(3); click(4); click(1, 'marathon');
  assert.deepEqual(selected, [[3, 'campaign']]);
  screen.extra.canSelect = false; click(1); assert.equal(selected.length, 1);
  assert.deepEqual(profile, before, 'screen delegates selection instead of writing profile or progress');
});

test('controller focus starts at the selected Marathon route or an available world, and guests retain garage access', () => {
  const marathon = {}, world = {}, back = {};
  const focus = available => CampaignScreen.prototype.initialFocus.call({ el: { querySelector: selector => available[selector] || null } });
  assert.equal(focus({ '.campaign-marathon.selected.f': marathon, '.campaign-card.f': world }), marathon);
  assert.equal(focus({ '.campaign-card.f': world }), world);
  assert.equal(focus({ '[data-act="back"]': back }), back);
});

const logicalScreen = (profile, canSelect = true) => {
  const screen = Object.assign(Object.create(CampaignScreen.prototype), { profile, extra: { canSelect }, cb: {}, ui: { snd() {} } });
  let controls = [], body = { innerHTML: '' }, detail = { innerHTML: '' }, hint = { innerHTML: '' };
  const rebuild = () => {
    const map = campaignMapState(screen.profile), p = map.progress;
    controls = map.nodes.filter(node => screen.extra.canSelect && !node.locked).map(node => ({
      dataset: { level: String(node.number), mode: 'campaign', k: `campaign:${node.number}` }, selected: node.current,
    }));
    if (screen.extra.canSelect && p.marathonUnlocked) controls.push({ dataset: { level: '1', mode: 'marathon', k: 'campaign:marathon' }, selected: p.selectedMode === 'marathon' });
    controls.push({ dataset: { act: 'back', k: 'campaign:back' } });
  };
  rebuild();
  screen.el = {
    contains: node => controls.includes(node),
    querySelectorAll: () => controls,
    querySelector(selector) {
      if (selector === '.campaign-body') return body;
      if (selector === '.campaign-map-preview') return detail;
      if (selector === '[data-hints]') return hint;
      if (selector === '[data-act="back"]') return controls.find(node => node.dataset.act === 'back');
      if (selector === '.campaign-marathon.f' || selector === '.campaign-marathon.selected.f') return controls.find(node => node.dataset.mode === 'marathon' && (!selector.includes('selected') || node.selected)) || null;
      if (selector === '.campaign-card.f' || selector === '.campaign-card.selected.f') return controls.find(node => node.dataset.mode === 'campaign' && (!selector.includes('selected') || node.selected)) || null;
      const level = selector.match(/data-level="(\d+)"/);
      return level ? controls.find(node => node.dataset.mode === 'campaign' && node.dataset.level === level[1]) || null : null;
    },
  };
  screen.ui.nav = {
    cur: screen.initialFocus(), ui: { screen: () => screen },
    list: () => controls, focus(node) { this.cur = node; screen.preview(node); },
    ensure: Nav.prototype.ensure,
  };
  screen.render = () => { rebuild(); CampaignScreen.prototype.render.call(screen); };
  screen.world = number => controls.find(node => node.dataset.mode === 'campaign' && Number(node.dataset.level) === number);
  screen.detail = () => detail.innerHTML;
  screen.markup = () => body.innerHTML;
  return screen;
};

test('arrow navigation respects physical snake columns and keeps partial routes connected to Back', () => {
  const full = logicalScreen(progressed(10));
  assert.equal(full.navOverride(full.world(5), 'down'), full.world(6));
  assert.equal(full.navOverride(full.world(6), 'left'), full.world(7));
  assert.equal(full.navOverride(full.world(7), 'right'), full.world(6));
  assert.equal(full.navOverride(full.world(6), 'up'), full.world(5));
  assert.equal(full.navOverride(full.world(10), 'up'), full.world(1));
  assert.equal(full.navOverride(full.world(10), 'left'), false);
  assert.equal(full.navOverride(full.world(6), 'down').dataset.mode, 'marathon');
  const partial = logicalScreen(progressed(6));
  assert.equal(partial.navOverride(partial.world(1), 'down'), partial.world(7), 'nearest available second-row world, without entering locked cards');
  assert.equal(partial.navOverride(partial.world(7), 'left'), false);
  assert.equal(partial.navOverride(partial.world(7), 'down').dataset.act, 'back');
  const fresh = logicalScreen(DEFAULT_PROFILE());
  assert.equal(fresh.navOverride(fresh.world(1), 'down').dataset.act, 'back');
  assert.equal(fresh.navOverride(fresh.el.querySelector('[data-act="back"]'), 'up'), fresh.world(1));
  const guest = logicalScreen(progressed(10), false);
  assert.equal(guest.navOverride(guest.ui.nav.cur, 'up'), false);
});

test('keyboard Tab and controller bumpers visit earned chapters in order, then Marathon and Back', () => {
  const screen = logicalScreen(progressed(10));
  screen.ui.nav.cur = screen.world(5); screen.tabStep(1); assert.equal(screen.ui.nav.cur, screen.world(6));
  screen.tabStep(1); assert.equal(screen.ui.nav.cur, screen.world(7));
  screen.tabStep(-1); assert.equal(screen.ui.nav.cur, screen.world(6));
  screen.ui.nav.cur = screen.world(10); screen.tabStep(1); assert.equal(screen.ui.nav.cur.dataset.mode, 'marathon');
  screen.tabStep(1); assert.equal(screen.ui.nav.cur.dataset.act, 'back');
  screen.tabStep(1); assert.equal(screen.ui.nav.cur, screen.world(1));
  screen.tabStep(-1); assert.equal(screen.ui.nav.cur.dataset.act, 'back');
  screen.ui.nav.cur = null; screen.tabStep(1); assert.equal(screen.ui.nav.cur, screen.world(1));
  screen.ui.nav.cur = null; screen.tabStep(-1); assert.equal(screen.ui.nav.cur.dataset.act, 'back');
  const guest = logicalScreen(progressed(10), false), before = structuredClone(guest.profile);
  guest.tabStep(1); guest.tabStep(-1); assert.equal(guest.ui.nav.cur.dataset.act, 'back');
  assert.deepEqual(guest.profile, before);
});

test('authoritative updates preserve browsed-world focus and preview without changing selected replay', () => {
  const profile = progressed(3); selectCampaignLevel(profile, 2);
  const screen = logicalScreen(profile); screen.ui.nav.focus(screen.world(4));
  const oldNode = screen.ui.nav.cur, updated = structuredClone(profile); updated.cash += 100;
  screen.update(updated);
  assert.notEqual(screen.ui.nav.cur, oldNode, 'render replaces the card node');
  assert.equal(screen.ui.nav.cur, screen.world(4));
  assert.match(screen.detail(), /LEVEL 4 · FROST PASS/); assert.match(screen.detail(), /NEXT WORLD/);
  assert.equal(updated.campaignProgress.selectedLevel, 2);
  assert.match(screen.markup(), /aria-valuenow="3"/);
  screen.update(updated, { canSelect: false });
  assert.equal(screen.ui.nav.cur.dataset.act, 'back');
  assert.match(screen.markup(), /The host chooses the next level/);
  assert.doesNotMatch(screen.markup(), /campaign-card f|campaign-marathon f/);
});

test('map refresh cannot move focus outside a currently active modal scope', () => {
  const screen = logicalScreen(progressed(2)), modal = { dataset: { k: 'modal:cancel' } };
  screen.ui.nav.cur = modal; screen.ui.nav.list = () => [modal];
  screen.update(structuredClone(screen.profile));
  assert.equal(screen.ui.nav.cur, modal);
});

test('focus previews identify bosses and replay state, without selecting or writing campaign progress', () => {
  const profile = progressed(10), screen = logicalScreen(profile), before = structuredClone(profile);
  for (const level of TEN_LEVELS) {
    screen.preview(screen.world(level.number));
    assert.match(screen.detail(), new RegExp(`LEVEL ${level.number} · ${level.name}`));
    assert.ok(screen.detail().includes(level.bossName));
    assert.match(screen.detail(), /CLEARED · REPLAY AVAILABLE/);
  }
  screen.preview(screen.el.querySelector('.campaign-marathon.f'));
  assert.match(screen.detail(), /MARATHON · ALL TEN WORLDS/);
  assert.deepEqual(profile, before);
});

test('map activates earned replay and Marathon through their original callbacks and keeps Back available', () => {
  const profile = progressed(10), selected = [], screen = logicalScreen(profile), before = structuredClone(profile);
  screen.cb.onSelect = (...args) => selected.push(args);
  const click = node => screen.onClick({ target: { closest: () => node } });
  click(screen.world(7)); click(screen.el.querySelector('.campaign-marathon.f'));
  assert.deepEqual(selected, [[7, 'campaign'], [1, 'marathon']]);
  let returned = 0; screen.cb.onBack = () => returned++; click(screen.el.querySelector('[data-act="back"]'));
  assert.equal(returned, 1); assert.deepEqual(profile, before);
});

test('map presentation leaves approach lengths and authoritative catalogue intact and has no right-side scrolling', async () => {
  const css = await readFile(new URL('../src/ui/css/campaign.css', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/ui/screens/campaign.js', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /overflow-y\s*:\s*(?:auto|scroll)|max-height\s*:/);
  assert.doesNotMatch(source, /campaign-body scroll/);
  assert.match(css, /grid-template-rows:repeat\(2,208px\)/);
  assert.match(source, /viewBox="0 0 1000 470"/);
  assert.equal(TEN_LEVELS[0].bossDistance, 5500);
  assert.equal(TEN_LEVELS[9].id, 'space');
  assert.equal(Object.isFrozen(TEN_LEVELS), true);
  assert.equal(Object.isFrozen(TEN_LEVELS[0]), true);
});

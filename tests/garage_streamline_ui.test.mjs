import test from 'node:test';
import assert from 'node:assert/strict';
import { GarageScreen, garageFamilyVehicle, garageItems, garageInitialSelection } from '../src/ui/screens/garage.js';
import { DEFAULT_PROFILE, TRUCKS, UPGRADE_BY_ID, upgradeLevel } from '../src/data/upgrades.js';
import { buyTruck, selectTruck, buyUpgrade, buyWeaponTrack } from '../src/meta/profile.js';
import { normalizeFamilyUpgrades } from '../src/data/vehicle_families.js';
import { WEAPONS, WEAPON_ORDER } from '../src/data/weapons.js';
import { readFile } from 'node:fs/promises';

// Logical UI methods and generated markup only. These tests never start a
// browser, renderer, audio context or device input listener.
const screen = () => {
  const p = DEFAULT_PROFILE(); p.cash = 100000;
  const events = [];
  return Object.assign(Object.create(GarageScreen.prototype), {
    p, events, ...garageInitialSelection(p), weaponPage: 'loadout', trackPrev: null, opticPrev: null, fresh: {},
    ui: { settings: { units: 'mi' }, snd() {}, pressFx() {} },
    cb: { onBuy: (...args) => events.push(['buy', ...args]), onView: (...args) => events.push(['view', ...args]), onSelectTruck: id => events.push(['select', id]), onEquip: (...args) => events.push(['equip', ...args]), onSeatSwap: (...args) => events.push(['seat', ...args]), onReady: () => events.push(['ready']) },
    burst() {}, denied: (_btn, need) => events.push(['denied', need]),
  });
};
const click = (s, dataset) => s.onClick({ target: { closest: () => ({ dataset }) }, detail: 0 });
const renderDetail = s => {
  const previousRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  s.q = { det: { innerHTML: '' }, foot: { innerHTML: '' }, detail: { classList: { toggle() {} } } };
  try { s.renderDetail(); return { content: s.q.det.innerHTML, footer: s.q.foot.innerHTML }; }
  finally { if (previousRAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previousRAF; }
};

test('family cards preserve upgraded and legacy ownership without changing any saved inventory', () => {
  const s = screen();
  s.p.truck = 'truck_t4'; s.p.trucks = ['truck_t4', 'player_buggy_t1', 'player_buggy_t3'];
  s.p.vehicleUpgrades.rustbucket = { armor: 5, ram: 3, spikes: 2, glass: 2 };
  s.p.vehicleUpgrades.buggy = { engine: 5, nitro: 4 };
  s.p.upgrades.vest = 3;
  const before = structuredClone(s.p), selection = garageInitialSelection(s.p);
  assert.deepEqual(garageItems(s.p, 'truck'), ['player_sedan_t1', 'truck_t1', 'player_buggy_t1']);
  assert.equal(selection.selId.truck, 'truck_t1');
  assert.equal(garageFamilyVehicle(s.p, 'truck_t1'), 'truck_t4');
  assert.equal(garageFamilyVehicle(s.p, 'player_buggy_t1'), 'player_buggy_t3');
  assert.equal(s.familyState('truck_t1').state, 'active');
  assert.equal(s.familyState('player_buggy_t1').state, 'owned');
  assert.deepEqual(s.p, before, 'presentation cannot migrate or overwrite the save');
});

test('chassis and driver parts share Upgrades, while gunner choices omit obsolete BODY ARMOR', () => {
  const s = screen(); s.p.truck = 'truck_t4'; s.p.trucks.push('truck_t4');
  const ids = garageItems(s.p, 'upgrades');
  assert.deepEqual(ids.filter(id => id.startsWith('chassis:')), ['chassis:truck_t1', 'chassis:truck_t2', 'chassis:truck_t3', 'chassis:truck_t4']);
  assert.ok(ids.includes('armor'), 'purchased vehicle plating remains available');
  assert.ok(ids.includes('glass')); assert.ok(ids.includes('mines'));
  const crew = garageItems(s.p, 'gunner');
  assert.equal(crew[0], 'grenades'); assert.ok(!crew.includes('vest'));
  assert.equal(garageInitialSelection(s.p, { tab: 'gunner', select: 'vest' }).selId.gunner, 'grenades');
});

test('old chassis recommendations and family changes always resolve to a visible row', () => {
  const s = screen(); s.p.truck = 'truck_t1'; s.p.trucks.push('truck_t1');
  const oldRecommendation = garageInitialSelection(s.p, { tab: 'truck', select: 'truck_t3' });
  assert.equal(oldRecommendation.tab, 'upgrades'); assert.equal(oldRecommendation.selId.upgrades, 'chassis:truck_t3');
  assert.ok(garageItems(s.p, oldRecommendation.tab).includes(oldRecommendation.selId.upgrades));
  const otherFamily = garageInitialSelection(s.p, { tab: 'truck', select: 'player_buggy_t3' });
  assert.equal(otherFamily.tab, 'truck'); assert.equal(otherFamily.selId.truck, 'player_buggy_t1');
  Object.assign(s, oldRecommendation);
  s.selId.gunner = 'vest'; s.p.truck = 'player_buggy_t1';
  s.normalizeSelections();
  assert.equal(s.selId.upgrades, 'chassis:player_buggy_t1'); assert.equal(s.selId.gunner, 'grenades');
  for (const tab of ['truck', 'upgrades', 'weapons', 'gunner', 'paint']) assert.ok(s.items(tab).includes(s.selId[tab]));
});

test('chassis confirm retains predecessor/cash guards and emits the exact existing purchase type and ID', () => {
  const s = screen(), btn = {};
  s.p.truck = 'truck_t1'; s.p.trucks.push('truck_t1'); s.tab = 'upgrades'; s.selId.upgrades = 'chassis:truck_t3';
  s.doBuy(btn); assert.deepEqual(s.events, [], 'no transaction for a locked later chassis');
  s.p.trucks.push('truck_t2'); s.p.cash = 1;
  s.doBuy(btn); assert.deepEqual(s.events.pop(), ['denied', TRUCKS.find(t => t.id === 'truck_t3').cost - 1]);
  s.p.cash = 100000; s.doBuy(btn);
  assert.deepEqual(s.events.pop(), ['buy', 'truck', 'truck_t3']);
  s.selId.upgrades = 'engine'; s.doBuy(btn);
  assert.deepEqual(s.events.pop(), ['buy', 'upgrade', 'engine']);
  s.tab = 'gunner'; s.selId.gunner = 'vest'; s.doBuy(btn);
  assert.deepEqual(s.events, [], 'a stale hidden armor action cannot purchase it');
});

test('family and chassis selection/preview use actual saved IDs, including reverting to stock', () => {
  const s = screen(); s.p.truck = 'player_sedan_t1'; s.p.trucks.push('truck_t1', 'truck_t4');
  s.selId.truck = 'truck_t1';
  s.notifyView(); click(s, { select: '1' });
  assert.deepEqual(s.events, [['view', 'truck', 'truck_t4', undefined], ['select', 'truck_t4']]);
  s.events.length = 0; s.p.truck = 'truck_t4'; s.tab = 'upgrades'; s.selId.upgrades = 'chassis:truck_t1';
  s.notifyView(); click(s, { select: '1' });
  assert.deepEqual(s.events, [['view', 'truck', 'truck_t1', undefined], ['select', 'truck_t1']]);
});

test('weapon panels separate loadout, tuning and sight controls while preserving the weapon purchase action', () => {
  const s = screen(); s.tab = 'weapons'; s.selId.weapons = 'rifle';
  s.p.weapons.rifle = { dmg: 0, mag: 0, rel: 0, hnd: 0 }; s.p.loadout = ['rifle'];
  let markup = renderDetail(s);
  assert.equal((markup.content.match(/data-slot="/g) || []).length, 3);
  assert.ok(!markup.content.includes('data-trk="')); assert.ok(!markup.content.includes('data-optic="'));
  s.weaponPage = 'tuning'; markup = renderDetail(s);
  assert.equal((markup.content.match(/data-trk="/g) || []).length, 4);
  assert.ok(!markup.content.includes('data-slot="')); assert.ok(!markup.content.includes('data-optic="'));
  s.trackPrev = 'hnd';
  assert.deepEqual(s.weaponStatRows('rifle').map(row => row.label), ['SPREAD', 'RECOIL']);
  assert.ok(s.weaponStatRows('rifle').every(row => row.after != null));
  s.weaponPage = 'sights'; markup = renderDetail(s);
  assert.equal((markup.content.match(/data-optic="/g) || []).length, 2);
  assert.ok(!markup.content.includes('data-slot="')); assert.ok(!markup.content.includes('data-trk="'));
  delete s.p.weapons.rifle; s.p.loadout = ['pistol'];
  for (const page of ['loadout', 'tuning', 'sights']) { s.weaponPage = page; assert.ok(renderDetail(s).footer.includes('data-buy="1"')); }
});

test('page changes are previews, retain equip shortcuts, and keep paid sight purchase distinct from free equip', () => {
  const s = screen(); s.tab = 'weapons'; s.selId.weapons = 'rifle';
  s.p.weapons.rifle = { dmg: 0, mag: 0, rel: 0, hnd: 0 }; s.p.loadout = ['rifle'];
  s.keepFocus = fn => fn(); s.renderDetail = () => {};
  s.switchWeaponPage('sights'); s.selectOptic('wide_reflex');
  assert.equal(s.events.some(event => event[0] === 'buy'), false);
  assert.deepEqual(s.events.at(-1), ['view', 'weapons', 'rifle', 'wide_reflex']);
  s.doOptic({ dataset: { opticBuy: 'wide_reflex' } });
  assert.deepEqual(s.events.at(-1), ['buy', 'weaponOptic', 'rifle', 'wide_reflex']);
  s.p.weaponOptics.rifle = { owned: ['standard', 'wide_reflex'], equipped: 'wide_reflex' };
  s.doOptic({ dataset: { opticBuy: 'standard' } });
  assert.deepEqual(s.events.at(-1), ['buy', 'equipWeaponOptic', 'rifle', 'standard']);
  for (const page of ['loadout', 'tuning', 'sights']) {
    s.switchWeaponPage(page); s.onKey({ code: 'Digit3' }, false);
    assert.deepEqual(s.events.at(-1), ['equip', 'rifle', 2]);
  }
});

test('controller page navigation reaches panel actions and returns to the selected row', () => {
  const s = screen(); s.tab = 'weapons';
  const node = dataset => ({ dataset, closest: () => null });
  const pages = ['loadout', 'tuning', 'sights'].map(page => node({ weaponPage: page }));
  const row = node({ row: 'pistol' }), slot = node({ slot: '0' });
  s.q = {
    rows: { querySelector: () => row }, foot: { contains: () => false, querySelector: () => null },
    det: { contains: () => true, querySelectorAll: selector => selector === '.detail-page' ? pages : [slot], querySelector: selector => selector === '.detail-page.on' ? pages[0] : slot },
    ready: { querySelector: () => null },
  };
  assert.equal(s.navOverride(pages[0], 'right'), pages[1]);
  assert.equal(s.navOverride(pages[1], 'left'), pages[0]);
  assert.equal(s.navOverride(pages[2], 'right'), false);
  assert.equal(s.navOverride(pages[0], 'left'), row);
  assert.equal(s.navOverride(pages[0], 'down'), slot);
  assert.equal(s.navOverride(slot, 'up'), pages[0]);
  assert.equal(s.navOverride(slot, 'left'), row);
});

test('seat consent still forwards the proposal ID and blocks Ready while unresolved', () => {
  const s = screen(); s.extra = { solo: false, readyBlocked: true };
  click(s, { seatAction: 'accept', proposal: 'proposal-current' });
  click(s, { ready: '1' });
  assert.deepEqual(s.events, [['seat', 'accept', 'proposal-current']]);
  s.extra.readyBlocked = false; s.q = { ready: { querySelector: () => ({}) } };
  click(s, { ready: '1' }); assert.deepEqual(s.events.at(-1), ['ready']);
});

test('base-family and every chassis transaction spend the authored price and preserve that family\'s installed parts', () => {
  for (const base of garageItems(DEFAULT_PROFILE(), 'truck')) {
    const s = screen(); s.p.cash = 1000000;
    s.cb.onBuy = (kind, id) => {
      assert.equal(kind, 'truck');
      const before = s.p.cash, cost = TRUCKS.find(tr => tr.id === id).cost;
      assert.equal(buyTruck(s.p, id).ok, true);
      assert.equal(s.p.cash, before - cost);
      assert.ok(s.p.trucks.includes(id)); assert.equal(s.p.truck, id);
    };
    s.selId.truck = base;
    if (!s.p.trucks.includes(base)) s.doBuy({});
    else assert.equal(selectTruck(s.p, base).ok, true);
    const allParts = structuredClone(s.p.vehicleUpgrades);
    s.tab = 'upgrades';
    for (const id of s.items().filter(id => id.startsWith('chassis:'))) {
      s.selId.upgrades = id;
      const actual = id.slice('chassis:'.length);
      if (s.p.trucks.includes(actual)) continue;
      s.doBuy({});
      assert.equal(s.p.truck, actual);
      assert.deepEqual(s.p.vehicleUpgrades, allParts, 'chassis purchase must not erase or duplicate installed parts');
    }
  }
});

test('part preview and upgrade callbacks remain scoped to the actual selected family and crew purchases stay global', () => {
  const s = screen(); s.p.trucks.push('truck_t1', 'player_buggy_t1');
  s.p.vehicleUpgrades.rustbucket.ram = 2;
  s.cb.onBuy = (kind, id) => { assert.equal(kind, 'upgrade'); assert.equal(buyUpgrade(s.p, id).ok, true); };
  for (const vehicle of ['player_sedan_t1', 'truck_t1', 'player_buggy_t1']) {
    assert.equal(selectTruck(s.p, vehicle).ok, true);
    s.normalizeSelections(); s.tab = 'upgrades'; s.selId.upgrades = 'engine';
    const before = structuredClone(s.p.vehicleUpgrades), canonicalBefore = normalizeFamilyUpgrades(s.p).vehicleUpgrades,
      price = UPGRADE_BY_ID.engine.costs[upgradeLevel(s.p, 'engine')], cash = s.p.cash;
    s.notifyView(); assert.deepEqual(s.events.pop(), ['view', 'upgrades', 'engine', undefined]);
    s.doBuy({}); assert.equal(s.p.cash, cash - price); assert.equal(upgradeLevel(s.p, 'engine'), 1);
    const family = vehicle.startsWith('player_sedan') ? 'sedan' : vehicle.startsWith('player_buggy') ? 'buggy' : 'rustbucket';
    for (const id of Object.keys(before)) if (id !== family) {
      assert.deepEqual(s.p.vehicleUpgrades[id], canonicalBefore[id], 'production normalization may add zero tracks, but cannot grant or remove paid levels');
      for (const [part, level] of Object.entries(before[id])) if (level > 0) assert.equal(s.p.vehicleUpgrades[id][part], level);
    }
  }
  s.tab = 'gunner'; s.selId.gunner = 'medkit';
  const kits = s.p.upgrades.medkit || 0; s.doBuy({});
  for (const vehicle of ['player_sedan_t1', 'truck_t1', 'player_buggy_t1']) {
    s.p.truck = vehicle; assert.equal(s.upState('medkit').lv, kits + 1);
  }
});

test('every weapon stat is reachable through Loadout or a bounded selected tuning preview', () => {
  const s = screen(); s.tab = 'weapons';
  for (const id of WEAPON_ORDER) {
    s.selId.weapons = id; s.p.weapons[id] = { dmg: 0, mag: 0, rel: 0, hnd: 0 };
    const labels = new Set(); s.weaponPage = 'loadout';
    for (const row of s.weaponStatRows(id)) labels.add(row.label);
    assert.equal(s.weaponStatRows(id).length, 4);
    s.weaponPage = 'tuning'; s.trackPrev = null;
    assert.equal(s.previewTrack(), 'dmg'); assert.equal(s.weaponStatRows(id).length, 1);
    for (const track of ['dmg', 'mag', 'rel', 'hnd']) {
      s.trackPrev = track; const rows = s.weaponStatRows(id);
      assert.ok(rows.length > 0 && rows.length <= 2);
      assert.ok(rows.every(row => row.after != null));
      for (const row of rows) labels.add(row.label);
    }
    assert.deepEqual([...labels].sort(), ['DAMAGE', 'FIRE RATE', 'MAGAZINE', 'RANGE', 'RECOIL', 'RELOAD', 'SPREAD']);
  }
});

test('tuning selection persists when focus leaves the track and exact paid track prices are retained', () => {
  const s = screen(); s.tab = 'weapons'; s.selId.weapons = 'rifle';
  s.p.weapons.rifle = { dmg: 0, mag: 0, rel: 0, hnd: 0 };
  s.weaponPage = 'tuning'; s.trackPrev = 'hnd'; s.refreshStatsOnly = () => {};
  s.onNavFocus({ detail: { el: { dataset: {} }, hover: false } });
  assert.equal(s.trackPrev, 'hnd');
  s.cb.onBuy = (kind, id, track) => {
    assert.deepEqual([kind, id, track], ['weaponTrack', 'rifle', 'hnd']);
    const cash = s.p.cash, cost = s.trackState(id, track).cost;
    assert.equal(buyWeaponTrack(s.p, id, track).ok, true);
    assert.equal(s.p.cash, cash - cost);
  };
  s.doTrack({ dataset: { trk: 'hnd' } }); assert.equal(s.p.weapons.rifle.hnd, 1);
});

test('page activation focuses the recreated page node without a prior hover', () => {
  const s = screen(); s.tab = 'weapons'; s.selId.weapons = 'pistol';
  const currentPage = { dataset: { weaponPage: 'sights', k: 'page:sights' } }, focused = [];
  s.keepFocus = fn => fn(); s.renderDetail = () => {};
  s.q = { det: { querySelector: selector => selector === '[data-weapon-page="sights"]' ? currentPage : null } };
  s.ui.nav = { focus: (...args) => focused.push(args) };
  click(s, { weaponPage: 'sights' });
  assert.equal(s.weaponPage, 'sights'); assert.equal(focused[0][0], currentPage);
  assert.equal(s.events.some(event => event[0] === 'buy'), false);
});

test('stale armor, invalid track and invalid slot actions cannot spend cash or equip a locked weapon', () => {
  const s = screen(), before = structuredClone(s.p);
  s.tab = 'gunner'; s.selId.gunner = 'vest'; s.doBuy({});
  assert.equal(s.upState('unknown-legacy-upgrade').state, 'max');
  assert.equal(s.upState('unknown-legacy-upgrade').cost, null);
  s.tab = 'weapons'; s.selId.weapons = 'rifle';
  click(s, { slot: '1' });
  s.doTrack({ dataset: { trk: 'not-a-track' } });
  s.selId.weapons = 'pistol'; click(s, { slot: '-1' }); click(s, { slot: '3' }); click(s, { slot: 'NaN' });
  assert.deepEqual(s.events, []); assert.deepEqual(s.p, before);
});

test('generated lists group current-family builds under Vehicle Upgrades and never put stages or body armor in Vehicles', () => {
  const s = screen(); s.p.truck = 'truck_t1'; s.p.trucks.push('truck_t1');
  const previous = globalThis.requestAnimationFrame; globalThis.requestAnimationFrame = () => 0;
  s.q = { lhead: {}, lcount: {}, rows: {} };
  try {
    s.renderList();
    assert.equal((s.q.rows.innerHTML.match(/data-row=/g) || []).length, 3);
    assert.equal((s.q.rows.innerHTML.match(/family-row/g) || []).length, 3);
    assert.ok(!s.q.rows.innerHTML.includes('STAGE '));
    s.tab = 'upgrades'; s.renderList();
    assert.equal(s.q.lhead.textContent, 'VEHICLE UPGRADES');
    assert.equal((s.q.rows.innerHTML.match(/data-row="chassis:/g) || []).length, 4);
    assert.match(s.q.rows.innerHTML, /CHASSIS.*PARTS &amp; EQUIPMENT/s);
    s.tab = 'gunner'; s.renderList();
    assert.ok(!s.q.rows.innerHTML.includes('BODY ARMOR')); assert.ok(!s.q.rows.innerHTML.includes('data-row="vest"'));
    s.q.load = {}; s.renderLoadout();
    assert.ok(!s.q.load.innerHTML.includes('VEST')); assert.ok(!s.q.load.innerHTML.includes('ARMOR'));
    assert.match(s.q.load.innerHTML, /GRENADES.*MEDKITS/s);
  } finally { if (previous === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previous; }
});

test('garage framing, chapter choices and readiness retain existing lifecycle boundaries', () => {
  const s = screen(), calls = [];
  s.extra = { solo: false, isHost: false, ready: false, readyBlocked: true,
    partner: { connected: true, ready: false, role: 'driver', name: 'Friend' }, journey: { mode: 'marathon', level: 1 } };
  const bounds = { left: { right: 580, top: 164, width: 524 }, detail: { left: 1404, width: 460 }, load: { top: 884 }, seats: { top: 760 } };
  s.q = { sub: {}, campaign: {}, ready: {}, party: {},
    left: { getBoundingClientRect: () => bounds.left }, detail: { getBoundingClientRect: () => bounds.detail },
    load: { getBoundingClientRect: () => bounds.load }, seats: { hidden: false, firstElementChild: {}, getBoundingClientRect: () => bounds.seats } };
  assert.deepEqual(s.frameRect(), { l: 588, r: 1396, t: 164, b: 754 });
  s.q.seats.hidden = true; assert.equal(s.frameRect().b, 878);
  s.cb.onCampaign = () => calls.push('campaign'); s.renderHeader(); s.renderReady();
  assert.match(s.q.campaign.innerHTML, /HOST CHOOSES/); assert.match(s.q.ready.innerHTML, /aria-disabled="true"/);
  click(s, { campaign: '1' }); click(s, { ready: '1' });
  assert.deepEqual(calls, ['campaign']); assert.deepEqual(s.events, []);
  s.extra = { solo: true, journey: { mode: 'marathon', level: 1 } }; s.renderReady();
  assert.match(s.q.ready.innerHTML, /START MARATHON/);
  bounds.left.width = 0; assert.equal(s.frameRect(), null);
});

test('detail pane has bounded panel content and no right-side scroll affordance', async () => {
  const source = await readFile(new URL('../src/ui/screens/garage.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/ui/css/garage.css', import.meta.url), 'utf8');
  assert.ok(!source.includes('scroll d-scroll')); assert.ok(!source.includes('d-more'));
  assert.ok(!css.includes('.d-scroll')); assert.ok(!css.includes('.g-detail.has-below'));
  assert.match(css, /\.d-content\{[^}]*overflow:hidden/);
  assert.match(css, /\.btn\.ready>span\{[^}]*white-space:normal/);
  const s = screen(); s.tab = 'weapons';
  for (const id of WEAPON_ORDER) {
    s.selId.weapons = id; s.p.weapons[id] = { dmg: 0, mag: 0, rel: 0, hnd: 0 };
    for (const page of ['loadout', 'tuning', 'sights']) {
      s.weaponPage = page; const markup = renderDetail(s);
      assert.equal((markup.content.match(/data-panel=/g) || []).length, 1);
      assert.equal((markup.content.match(/class="stat/g) || []).length <= 5, true);
      assert.ok(markup.content.includes(WEAPONS[id].name));
    }
  }
});

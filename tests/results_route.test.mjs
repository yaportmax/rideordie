import test from 'node:test';
import assert from 'node:assert/strict';
import { ResultsScreen } from '../src/ui/screens/results.js';

function screen(run, profile = null) {
  return Object.assign(Object.create(ResultsScreen.prototype), {
    run: { distance: 0, time: 0, ...run }, profile, win: !!run.won,
    safe: { innerHTML: '', querySelector: () => ({ style: {} }) },
  });
}

test('a Dam checkpoint run plots its absolute endpoint while its distance tile reports only travel', () => {
  const result = screen({ startS: 52500, furthestS: 60000, distance: 7500, time: 180 });
  result.build();
  assert.equal(result.routePct, 100);
  assert.equal(result.tiles.find((tile) => tile.k === 'distance').to, 7.5);
  assert.match(result.safe.innerHTML, /<b>0\.0 KM<\/b> TO GO/);
  assert.match(result.safe.innerHTML, /THE DAM/);
  assert.equal((result.safe.innerHTML.match(/rt-mini past/g) || []).length, 5);
  assert.doesNotMatch(result.safe.innerHTML, /52\.5 KM/);
});

test('a checkpoint failure near the Dam keeps route and best markers in absolute world space', () => {
  const result = screen({ startS: 52500, furthestS: 54000, distance: 1500 }, { best: { furthestS: 58000, distance: 18000 } });
  const html = result.routeHtml();
  assert.equal(result.routePct, 90);
  assert.match(html, /<b>6\.0 KM<\/b> TO GO/);
  assert.match(html, /rt-best/);
  assert.match(html, /left:96\.66666666666667%/);
  assert.equal((html.match(/rt-mini past/g) || []).length, 5);
});

test('older summaries without absolute progress retain their existing distance route', () => {
  const result = screen({ distance: 30000 });
  const html = result.routeHtml();
  assert.equal(result.routePct, 50);
  assert.match(html, /<b>30\.0 KM<\/b> TO GO/);
  assert.equal((html.match(/rt-mini past/g) || []).length, 3);
});

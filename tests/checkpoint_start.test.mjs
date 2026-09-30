import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { normalizeProfile } from '../src/meta/profile.js';
// Menu styling is loaded by Vite in-browser; this CPU test exercises only the
// real App checkpoint picker and needs no DOM or stylesheet evaluation.
const css = registerHooks({
  load(url, context, nextLoad) {
    if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
    return nextLoad(url, context);
  },
});
let App;
try { ({ App } = await import('../src/app.js')); }
finally { css.deregister(); }

function app(best, choice = 'dam', normalized = true) {
  let prompts = 0;
  const value = Object.assign(Object.create(App.prototype), {
    profile: normalized ? normalizeProfile({ best }) : { best },
    ui: { async modal() { prompts++; return choice; } },
  });
  return { value, prompts: () => prompts };
}

test('Dam checkpoint unlock uses absolute route progress at 59000 metres and starts at 52500', async () => {
  const reached = app({ furthestS: 59000, distance: 58960 });
  assert.equal(await reached.value._pickStart(), 52500);
  assert.equal(reached.prompts(), 1);
  const short = app({ furthestS: 58999, distance: 58959 });
  assert.equal(await short.value._pickStart(), 40);
  assert.equal(short.prompts(), 0);
});

test('legacy and sanitized damaged saves preserve checkpoint options and cancellation', async () => {
  const legacy = app({ distance: 59000 }, 'dam', false);
  assert.equal(await legacy.value._pickStart(), 52500);
  const damaged = app({ distance: 59000, furthestS: Infinity }, 'start');
  assert.equal(await damaged.value._pickStart(), 40);
  const cancelled = app({ distance: 1000, furthestS: 60000 }, null);
  assert.equal(await cancelled.value._pickStart(), null);
});

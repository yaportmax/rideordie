import test from 'node:test';
import assert from 'node:assert/strict';
import { seatSwapMarkup } from '../src/ui/screens/garage_seats.js';
const base = { role: 'driver', actor: 'host', available: true, partnerName: 'Max', state: { pending: null } };

test('solo and invalid seats have no co-op swap control', () => {
  assert.equal(seatSwapMarkup({ ...base, solo: true }), ''); assert.equal(seatSwapMarkup({ ...base, role: null }), '');
});
test('idle garage shows current seat and a request button, never an accept button', () => {
  const markup = seatSwapMarkup(base); assert.match(markup, /YOU: DRIVER/); assert.match(markup, /data-seat-action="request"/);
  assert.doesNotMatch(markup, /data-seat-action="accept"/); assert.match(markup, /Equipment stays with the seats/); assert.match(markup, /Your cash stays with you/);
});
test('only the requester sees waiting and cancel, with the exact proposal id', () => {
  const markup = seatSwapMarkup({ ...base, state: { pending: { id: 'host-nonce-4', by: 'host' } } });
  assert.match(markup, /WAITING FOR MAX/); assert.match(markup, /data-seat-action="cancel"/); assert.match(markup, /data-proposal="host-nonce-4"/);
  assert.doesNotMatch(markup, /data-seat-action="accept"/);
});
test('the other person gets explicit accept/decline and the correct new seat', () => {
  const markup = seatSwapMarkup({ ...base, actor: 'guest', role: 'gunner', state: { pending: { id: 'host-nonce-4', by: 'host' } } });
  assert.match(markup, /You will be DRIVER/); assert.match(markup, /data-seat-action="accept"/); assert.match(markup, /data-seat-action="decline"/);
  assert.equal((markup.match(/data-proposal="host-nonce-4"/g) || []).length, 2); assert.doesNotMatch(markup, /data-seat-action="cancel"/);
});
test('waiting for garage presence has no actionable swap control and partner names are escaped', () => {
  assert.doesNotMatch(seatSwapMarkup({ ...base, available: false }), /data-seat-action=/);
  const markup = seatSwapMarkup({ ...base, partnerName: '<img src=x onerror=bad()>', state: { pending: { id: 'guest-nonce-4', by: 'guest' } } });
  assert.doesNotMatch(markup, /<img/); assert.match(markup, /&lt;img/);
});

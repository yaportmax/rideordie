// Garage seat consent controls use the existing keyboard/controller focus pattern.
import { esc } from '../glyphs.js';

export function seatSwapMarkup({ solo = false, role, actor, partnerName = 'Partner', state, available = false } = {}) {
  if (solo || !['host', 'guest'].includes(actor) || !['driver', 'gunner'].includes(role)) return '';
  const pending = state?.pending, ownSeat = role.toUpperCase(), nextSeat = role === 'driver' ? 'GUNNER' : 'DRIVER';
  const button = (action, text, id = '', primary = false) => `<div class="f btn seat-action ${primary ? 'primary' : ''}" role="button" data-seat-action="${action}" data-proposal="${esc(id)}" data-k="seat-${action}"><span>${text}</span></div>`;
  let description, actions;
  if (!available && !pending) {
    description = 'WAITING FOR PARTNER IN THE GARAGE'; actions = '';
  } else if (!pending) {
    description = `YOU: ${ownSeat}`; actions = button('request', 'REQUEST SEAT SWAP');
  } else if (pending.by === actor) {
    description = `WAITING FOR ${esc(partnerName).toUpperCase()}`; actions = button('cancel', 'CANCEL', pending.id);
  } else {
    description = `${esc(partnerName)} wants to swap seats. You will be ${nextSeat}.`;
    actions = button('accept', 'ACCEPT SWAP', pending.id, true) + button('decline', 'DECLINE', pending.id);
  }
  return `<div class="g-seat-swap plate trans ${pending ? 'pending' : ''}"><div class="seat-copy"><b>${description}</b><small>Equipment stays with the seats. Your cash stays with you.</small></div><div class="seat-actions">${actions}</div></div>`;
}


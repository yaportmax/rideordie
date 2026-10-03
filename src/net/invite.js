// Invitation URLs carry only a public room code, never profile or recovery data.
export function normalizeRoomCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{3,12}$/.test(code) ? code : null;
}

function webUrl(href) {
  try { const url = new URL(href); return ['http:', 'https:'].includes(url.protocol) ? url : null; }
  catch { return null; }
}

export function roomInviteFromUrl(href) {
  const url = webUrl(href), values = url?.searchParams.getAll('room');
  return values?.length === 1 ? normalizeRoomCode(values[0]) : null;
}

/** Preserve the current deployment path; omit unrelated query/hash state. */
export function makeInviteLink(href, value) {
  const source = webUrl(href), code = normalizeRoomCode(value);
  if (!source || !code) return null;
  const url = new URL(source.origin);
  url.pathname = source.pathname;
  url.searchParams.set('room', code);
  return url.href;
}

export function withoutRoomInvite(href) {
  const url = webUrl(href);
  if (!url) return null;
  url.searchParams.delete('room');
  return url.href;
}

/** Consume room/mode shortcuts; a denied history API must not make boot fatal. */
export function clearRoomInvite(href, history) {
  const url = webUrl(href);
  if (!url?.searchParams.has('room')) return false;
  // A mixed invitation still opens an ordinary lobby. Leaving debug modes in
  // its cleaned address would silently start them on the next manual reload.
  for (const key of ['room', 'solo', 'devnet']) url.searchParams.delete(key);
  try { history.replaceState(history.state, '', url.href); return true; }
  catch { return false; }
}

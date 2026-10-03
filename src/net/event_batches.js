// WORK proposal: no protocol changes and no dropping/retry gameplay queue.
// PeerJS1.5.5 JSON rejects >=16,300 UTF-8 bytes even with larger SCTP metadata.
// Include the complete pinned life envelope in this conservative budget.
import { validRunId } from './run_packet.js';

export const MAX_EVENT_PACKET_BYTES = 16299;
export const MAX_EVENT_PACKET_COUNT = 256;
const encoder = new TextEncoder();
const bytesOf = value => encoder.encode(JSON.stringify(value)).byteLength;
const isEvent = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && typeof value.t === 'string' && value.t.length > 0;
const rejected = (reason, index = null) => ({ ok: false, reason, index, packets: [], byteLengths: [] });

/** Preflight the entire frame before dispatch. Results own JSON value snapshots. */
export function planEventPackets(message) {
  let snapshot;
  try {
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || message.t !== 'events' || !Array.isArray(message.e) || !validRunId(message.runId)) return rejected('malformed-envelope');
    // Snapshot normal JSON semantics once so getters/toJSON cannot produce a
    // different value at the later PeerJS serialization or mutate caller data.
    snapshot = JSON.parse(JSON.stringify(message));
    if (!snapshot || snapshot.t !== 'events' || !Array.isArray(snapshot.e)
      || snapshot.runId !== message.runId) return rejected('malformed-envelope');
  } catch { return rejected('nonserializable-envelope'); }
  const base = { ...snapshot, e: [] }, baseBytes = bytesOf(base);
  if (baseBytes > MAX_EVENT_PACKET_BYTES) return rejected('oversized-envelope');

  const packets = [], byteLengths = [];
  let events = [], packetBytes = baseBytes;
  for (let index = 0; index < snapshot.e.length; index++) {
    const event = snapshot.e[index];
    if (!isEvent(event)) return rejected('malformed-event', index);
    const eventBytes = bytesOf(event);
    if (baseBytes + eventBytes > MAX_EVENT_PACKET_BYTES) return rejected('oversized-event', index);
    const nextBytes = packetBytes + eventBytes + (events.length ? 1 : 0);
    if (events.length && (events.length === MAX_EVENT_PACKET_COUNT || nextBytes > MAX_EVENT_PACKET_BYTES)) {
      packets.push({ ...base, e: events }); byteLengths.push(packetBytes);
      events = []; packetBytes = baseBytes;
    }
    packetBytes += eventBytes + (events.length ? 1 : 0); events.push(event);
  }
  // Retain the established empty-events message contract for direct callers.
  packets.push({ ...base, e: events }); byteLengths.push(packetBytes);
  return { ok: true, packets, byteLengths };
}

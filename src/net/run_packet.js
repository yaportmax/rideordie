// Each life uses one cached full identifier. Late packets from a prior life
// must be rejected before they reach startup queues or the snapshot clock.
export const NET_PROTOCOL = 2;
export const RUN_JSON_TYPES = new Set([
  'runReady', 'go', 'g', 'input', 'events', 'feed', 'hit', 'rocket',
  'grenade', 'shotfx', 'medkit', 'summary', 'runOver', 'results', 'abort',
]);

const MAGIC = 0x31524452; // RDR1, independently versioned from the snapshot body
const PREFIX = 10;
const MAX_PACKET = 262144;
const encoder = new TextEncoder();

export function validRunId(value) {
  if (typeof value !== 'string' || !value.length || value.length > 128) return false;
  // Reject lone surrogates rather than allowing distinct IDs to encode to the
  // same UTF-8 replacement character.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

const bytesOf = (value) => value instanceof ArrayBuffer ? new Uint8Array(value)
  : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;

/** Cache once when a run starts; the payload-length field is filled per packet. */
export function createRunHeader(id) {
  if (!validRunId(id)) return null;
  const encoded = encoder.encode(id), header = new Uint8Array(PREFIX + encoded.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, MAGIC, true); view.setUint16(4, encoded.length, true);
  header.set(encoded, PREFIX);
  return header;
}

/** One owned allocation: header + exactly the caller's ArrayBuffer/view range. */
export function encodeRunPacket(header, payload) {
  const bytes = bytesOf(payload);
  if (!header || !bytes || !bytes.length || header.length + bytes.length > MAX_PACKET) return null;
  const packet = new Uint8Array(header.length + bytes.length);
  packet.set(header); packet.set(bytes, header.length);
  new DataView(packet.buffer).setUint32(6, bytes.length, true);
  return packet;
}

/** Validate the entire envelope; return a body view without a second copy. */
export function decodeRunPacket(header, packet) {
  const bytes = bytesOf(packet);
  if (!header || !bytes || bytes.length <= header.length || bytes.length > MAX_PACKET) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC || view.getUint16(4, true) !== header.length - PREFIX
    || view.getUint32(6, true) !== bytes.length - header.length) return null;
  for (let i = PREFIX; i < header.length; i++) if (bytes[i] !== header[i]) return null;
  return bytes.subarray(header.length);
}

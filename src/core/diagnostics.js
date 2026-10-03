// Retain recent slow-work records as ordinary chronological arrays. Metadata
// is non-indexed, so legacy Array/JSON consumers keep their row schema. Export
// readDiagnosticSnapshot() when counts must survive serialization explicitly.
export const DIAGNOSTIC_CAPACITY = 2048;
const PRUNE_COUNT = DIAGNOSTIC_CAPACITY / 4;
const counts = new WeakMap();

function metadata(records) {
  let info = counts.get(records);
  // Existing probes replace the array with [] to reset their capture. A manual
  // length change also starts a new capture; it cannot reuse stale totals.
  if (!info || info.retained !== records.length) {
    info = { total: records.length, dropped: 0, retained: records.length, capacity: DIAGNOSTIC_CAPACITY };
    counts.set(records, info);
    Object.defineProperty(records, 'diagnostics', { value: info, configurable: true });
  }
  return info;
}

export function appendDiagnostic(owner, key, record) {
  let records = owner[key];
  if (!Array.isArray(records)) records = owner[key] = [];
  const info = metadata(records);
  if (records.length >= DIAGNOSTIC_CAPACITY) {
    const dropped = Math.max(PRUNE_COUNT, records.length + 1 - DIAGNOSTIC_CAPACITY);
    // Batch compaction avoids shifting every append and allocating a discarded
    // splice result. Ordinary arrays remain immediately readable in order.
    records.copyWithin(0, dropped); records.length -= dropped;
    info.dropped += dropped;
  }
  records.push(record); info.total++; info.retained = records.length;
  return records;
}

export function readDiagnosticSnapshot(records) {
  if (!Array.isArray(records)) return { rows: [], total: 0, dropped: 0, retained: 0, capacity: DIAGNOSTIC_CAPACITY };
  return { rows: records.slice(), ...metadata(records) };
}

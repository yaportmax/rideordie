import { SPEC_IDS } from '../../src/view/car_state.js';

// Independently authored historical wire fixture. It does not call or remove
// bytes from the v3 encoder. v1 omitted the two-byte car pose revision.
export function legacySnapshotPacket(version, { tick = 91, time = 3, x = 7, z = 90, poseRevision = 65500 } = {}) {
  const delta = version === 1 ? -2 : 0, out = new ArrayBuffer(103 + delta), dv = new DataView(out);
  dv.setUint8(0, version); dv.setUint32(1, tick, true); dv.setFloat32(5, time, true); dv.setFloat32(9, z, true);
  dv.setUint8(13, 1); for (const offset of [14, 15, 16]) dv.setUint8(offset, 255);
  dv.setUint8(17, 128); dv.setUint8(32, 2); dv.setUint8(33, 1);
  dv.setUint16(34, 1, true); dv.setUint8(36, SPEC_IDS.indexOf('truck_t1')); dv.setUint8(37, 1);
  dv.setUint16(38, 48, true); if (version === 2) dv.setUint16(40, poseRevision, true);
  dv.setFloat32(42 + delta, x, true); dv.setFloat32(46 + delta, 1, true); dv.setFloat32(50 + delta, z, true);
  dv.setInt16(60 + delta, 32767, true); dv.setInt16(66 + delta, 640, true);
  for (const offset of [75, 77]) dv.setUint8(offset + delta, 255); dv.setUint8(76 + delta, 128);
  dv.setUint8(82 + delta, 7 << 4); dv.setUint8(90 + delta, 7 | (5 << 3) | (3 << 6)); dv.setUint8(91 + delta, 4);
  for (let wheel = 0; wheel < 4; wheel++) { dv.setUint8(92 + delta + wheel * 2, 128); dv.setUint8(93 + delta + wheel * 2, 128); }
  // Remaining zero bytes are the empty projectile list and absent Leviathan.
  return out;
}

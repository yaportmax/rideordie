// Underground Vault: a road-following, open-ended shell, octagonal structural
// ribs and mineral pockets. All geometry belongs to the existing chunk builders.
// The only surfaces across the asphalt are above the 24 m camera clearance.

const SHELL_STEP = 8;
const RIB_STEP = 24;
const CHAMBER_STEP = 192;
const CYAN = [0.08, 0.72, 0.82];
const AMBER = [1.0, 0.48, 0.095];

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function mean(points) {
  const p = { x: 0, y: 0, z: 0 };
  for (const q of points) { p.x += q.x; p.y += q.y; p.z += q.z; }
  const k = 1 / points.length;
  p.x *= k; p.y *= k; p.z *= k;
  return p;
}

function difference(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

// The same global profile is evaluated on each side of a chunk boundary. Three
// chamber proportions alternate, with service passages between their shoulders.
function section(s) {
  const cell = Math.floor(s / CHAMBER_STEP);
  const variant = ((cell % 3) + 3) % 3;
  const distance = Math.abs(s - (cell * CHAMBER_STEP + 112));
  const t = Math.max(0, 1 - distance / 54);
  const chamber = t * t * (3 - 2 * t);
  const width = 20 + [7.5, 10.5, 6.5][variant] * chamber;
  const crown = 35 + [7, 10, 8.5][variant] * chamber;
  const shoulder = 27 + 2.5 * chamber;
  const waist = 12 + 2 * chamber;
  return {
    width, crown, chamber,
    // No floor segment and no portal cap: the asphalt remains continuous.
    profile: [
      [-width, -3], [-width, waist], [-width * 0.83, shoulder], [-width * 0.43, crown],
      [width * 0.43, crown], [width * 0.83, shoulder], [width, waist], [width, -3],
    ],
  };
}

function ring(builder, s, profile) {
  return profile.map(([d, h]) => builder.at(s, d, h));
}

function outerProfile(profile, width) {
  return profile.map(([d, h]) => [d * (1 + 2.2 / width), h > 15 ? h + 2.2 : h]);
}

function frameProfile(profile, width, outer) {
  const thickness = outer ? 1.4 : -1.35;
  return profile.map(([d, h]) => [d * (1 + thickness / width), h > 15 ? h + thickness : h]);
}

function freeSpan(builder, a, b) {
  return b > a && builder.themeAt(a + 0.01) === 'underground'
    && builder.themeAt(b - 0.01) === 'underground' && builder.spanFree(a, b);
}

function clearWallSpan(builder, a, b) {
  const wa = section(a).width, wb = section(b).width;
  const d = Math.min(wa, wb) * 0.915;
  const radius = Math.hypot((b - a) * 0.5 + 0.5, Math.max(wa, wb) * 1.11 - d);
  const s = (a + b) * 0.5;
  // Folded pieces of the main road are reserved as well as the local corridor.
  return builder.reserve(s, -d, radius) && builder.reserve(s, d, radius);
}

function surface(builder, points, color, centre, inward, overhead) {
  const middle = mean(points);
  const hint = inward ? difference(centre, middle) : difference(middle, centre);
  // quad() submits these exact world vertices and indices to the collider, so
  // the interior, exterior and end reveals share their visible boundaries.
  builder.quad(points, color, hint, { solid: true, overhead });
}

function shellStrip(builder, a, b, colors) {
  const sa = section(a), sb = section(b);
  const innerA = ring(builder, a, sa.profile), innerB = ring(builder, b, sb.profile);
  const outerA = ring(builder, a, outerProfile(sa.profile, sa.width));
  const outerB = ring(builder, b, outerProfile(sb.profile, sb.width));
  const centre = builder.at((a + b) * 0.5, 0, 13);
  for (let k = 0; k < 7; k++) {
    const roof = k >= 2 && k <= 4;
    const color = roof ? colors.ceiling : (k === 0 || k === 6 ? colors.foundation : colors.stone);
    surface(builder, [innerA[k], innerB[k], innerB[k + 1], innerA[k + 1]], color, centre, true, roof);
    surface(builder, [outerA[k], outerA[k + 1], outerB[k + 1], outerB[k]], colors.dark, centre, false, roof);
  }

  // A shallow ring reveal only at a real opening. A chunk seam has no end face.
  for (const [s, inner, outer, previous] of [[a, innerA, outerA, true], [b, innerB, outerB, false]]) {
    const neighborA = previous ? s - SHELL_STEP : s;
    const neighborB = previous ? s : s + SHELL_STEP;
    if (freeSpan(builder, neighborA, neighborB)) continue;
    const sign = previous ? -1 : 1;
    const hint = difference(builder.at(s + sign, 0), builder.at(s, 0));
    for (let k = 0; k < 7; k++) {
      builder.quad([inner[k], inner[k + 1], outer[k + 1], outer[k]], colors.edge,
        hint, { solid: true, overhead: k >= 2 && k <= 4 });
    }
  }

  // Practical strips trace the curvature instead of becoming straight chords
  // through the wall. Their small casings are merged into the same body mesh.
  for (const side of [-1, 1]) {
    const railA = builder.at(a, side * (sa.width - 0.38), 10.4);
    const railB = builder.at(b, side * (sb.width - 0.38), 10.4);
    builder.tube(railA, railB, 0.29, colors.brass);
    builder.tube(builder.at(a, side * (sa.width - 0.73), 10.4),
      builder.at(b, side * (sb.width - 0.73), 10.4), 0.105,
      side < 0 ? colors.cyan : colors.amber, { glow: true });
    const roofA = builder.at(a, side * 6.5, sa.crown - 0.35);
    const roofB = builder.at(b, side * 6.5, sb.crown - 0.35);
    builder.tube(roofA, roofB, 0.25, colors.dark, { overhead: true });
    builder.tube(builder.at(a, side * 6.5, sa.crown - 0.63),
      builder.at(b, side * 6.5, sb.crown - 0.63), 0.085,
      side < 0 ? colors.cyan : colors.amber, { overhead: true, glow: true });
  }
}

function structuralRib(builder, s, a, b, colors) {
  const profile = section(s);
  const support = profile.width * 0.93;
  const radius = Math.hypot((b - a) * 0.5 + 0.1, profile.width + 1.4 - support);
  if (!builder.reserve(s, -support, radius) || !builder.reserve(s, support, radius)) return;
  const inner = frameProfile(profile.profile, profile.width, false);
  const outer = frameProfile(profile.profile, profile.width, true);
  const iA = ring(builder, a, inner), iB = ring(builder, b, inner);
  const oA = ring(builder, a, outer), oB = ring(builder, b, outer);
  const centre = builder.at(s, 0, 13);
  const forward = difference(builder.at(b, 0), builder.at(a, 0));
  const backward = { x: -forward.x, y: -forward.y, z: -forward.z };
  for (let k = 0; k < 7; k++) {
    const roof = k >= 2 && k <= 4;
    surface(builder, [iA[k], iB[k], iB[k + 1], iA[k + 1]], colors.rib, centre, true, roof);
    surface(builder, [oA[k], oA[k + 1], oB[k + 1], oB[k]], colors.dark, centre, false, roof);
    if (a <= s - 1.3 + 0.001) {
      builder.quad([iA[k], iA[k + 1], oA[k + 1], oA[k]], colors.brass, backward, { solid: true, overhead: roof });
    }
    if (b >= s + 1.3 - 0.001) {
      builder.quad([iB[k], oB[k], oB[k + 1], iB[k + 1]], colors.brass, forward, { solid: true, overhead: roof });
    }
  }

  const middle = (a + b) * 0.5, depth = b - a;
  for (const side of [-1, 1]) {
    const d = side * (profile.width - 1.65);
    builder.box(middle, d, 9.0, 0.7, 6.6, depth, colors.dark);
    builder.box(middle, d - side * 0.42, 9.0, 0.13, 5.9, depth * 0.66,
      side < 0 ? colors.cyan : colors.amber, { glow: true });
    // Broad mechanical collars make the ribs read as authored vault frames.
    builder.box(middle, side * (profile.width - 0.9), 2.4, 3.3, 1.4, depth, colors.brass, { solid: true });
    builder.box(middle, side * (profile.width * 0.83), 25.1 + 2.5 * profile.chamber,
      2.25, 1.0, depth, colors.brass, { solid: true });
  }
}

function caveButtress(builder, s, side, colors) {
  const width = section(s).width;
  const d = side * (width - 0.55);
  const radius = 8.3;
  if (!builder.reserve(s, d, radius)) return;
  const a = Math.max(builder.s0, s - 6), b = Math.min(builder.s1, s + 6);
  if (!freeSpan(builder, a, b)) return;
  // Faceted, leaning stone masses overlap the wall. Their inward edges remain
  // outside the reserved road, and every exposed face uses exact collision.
  const outline = [[-1, -0.62], [-0.6, -1], [0.6, -1], [1, -0.62],
    [1, 0.62], [0.6, 1], [-0.6, 1], [-1, 0.62]];
  const rings = [];
  const heights = [-3, 9.5, 24.6];
  const lateral = [5.65, 4.75, 3.15], lengths = [6, 5.2, 3.6];
  for (let j = 0; j < 3; j++) {
    rings.push(outline.map(([x, z]) => {
      const anchor = Math.max(a, Math.min(b, s + z * lengths[j]));
      const offset = d + side * (x * lateral[j] + j * 0.65);
      const p = builder.at(anchor, offset, heights[j]);
      if (j === 0) p.y = Math.min(p.y, builder.ground(anchor, offset).y - 1.2);
      return p;
    }));
  }
  const centre = builder.at(s, d, 10);
  for (let j = 0; j < 2; j++) for (let k = 0; k < 8; k++) {
    const next = (k + 1) % 8;
    const color = k % 3 === 0 ? colors.foundation : colors.stone;
    surface(builder, [rings[j][k], rings[j][next], rings[j + 1][next], rings[j + 1][k]],
      color, centre, false, false);
  }
  const top = rings[2], topCentre = mean(top);
  for (let k = 0; k < 8; k += 2) {
    builder.quad([top[k], top[(k + 1) % 8], top[(k + 2) % 8], topCentre],
      colors.edge, { x: 0, y: 1, z: 0 }, { solid: true });
  }
  // Brass survey marks are a useful scale reference against the natural stone.
  const length = Math.min(0.5, b - a);
  builder.box(s, side * (width - 6.35), 2.6, 0.16, 2.8, length,
    colors.amber, { glow: true });
}

function mineralPocket(builder, s, side, colors) {
  if (!freeSpan(builder, s - 6, s + 6)) return;
  const width = section(s).width;
  const d = side * (width - 5.3);
  if (!builder.reserve(s, d, 3.5)) return;
  for (let k = 0; k < 4; k++) {
    const anchor = s + [-1.8, 1.5, 0.35, -0.5][k];
    const offset = d + side * [-0.65, 0.45, 1.8, 0.5][k];
    const height = [5.8, 3.3, 4.7, 2.4][k], r = [0.75, 0.6, 0.9, 0.45][k];
    if (anchor - r < builder.s0 || anchor + r > builder.s1) continue;
    if (!builder.reserve(anchor, offset, r + 0.2)) continue;
    const base = builder.ground(anchor, offset).y - builder.at(anchor, offset).y - 0.3;
    const crystal = mix(colors.stone, colors.cyan, 0.45 + k * 0.075);
    builder.column(anchor, offset, base, height * 0.77, r, r * 0.92, crystal, { solid: true });
    builder.column(anchor, offset, base + height * 0.77, height * 0.23,
      r * 0.92, 0.03, mix(crystal, colors.edge, 0.28), { solid: true });
    builder.tube(builder.at(anchor, offset - side * r * 0.92, base + 0.65),
      builder.at(anchor, offset - side * r * 0.82, base + height * 0.69),
      0.045, k === 1 ? colors.amber : colors.cyan, { glow: true });
  }
}

export function buildUnderground(builder) {
  const p = builder.palette;
  const stone = p.stone || p.mid || [0.18, 0.22, 0.25];
  const dark = p.dark || [0.06, 0.085, 0.105];
  const brass = p.brass || [0.44, 0.3, 0.12];
  const colors = {
    stone, dark, brass,
    ceiling: mix(stone, dark, 0.3), foundation: mix(stone, dark, 0.45),
    edge: mix(stone, p.light || [0.42, 0.47, 0.48], 0.4),
    rib: mix(brass, stone, 0.47),
    cyan: mix(CYAN, p.accent || CYAN, 0.22), amber: AMBER,
  };

  // Slice ownership is global; clipping confines each mesh to its 96 m chunk.
  for (let s = Math.floor(builder.s0 / SHELL_STEP) * SHELL_STEP; s < builder.s1; s += SHELL_STEP) {
    const a = Math.max(builder.s0, s), b = Math.min(builder.s1, s + SHELL_STEP);
    if (freeSpan(builder, a, b) && clearWallSpan(builder, a, b)) shellStrip(builder, a, b, colors);
  }
  // A rib on a chunk boundary is divided into two identical clipped halves.
  for (let s = Math.ceil((builder.s0 - 1.3) / RIB_STEP) * RIB_STEP; s < builder.s1 + 1.3; s += RIB_STEP) {
    const a = Math.max(builder.s0, s - 1.3), b = Math.min(builder.s1, s + 1.3);
    if (freeSpan(builder, a, b)) structuralRib(builder, s, a, b, colors);
  }
  for (let s = Math.ceil((builder.s0 - 16) / 32) * 32 + 16; s < builder.s1; s += 32) {
    if (builder.themeAt(s) !== 'underground') continue;
    if (!freeSpan(builder, Math.max(builder.s0, s - 6), Math.min(builder.s1, s + 6))) continue;
    for (const side of [-1, 1]) caveButtress(builder, s, side, colors);
  }
  for (let s = Math.ceil((builder.s0 - 40) / 64) * 64 + 40; s < builder.s1; s += 64) {
    if (builder.themeAt(s) !== 'underground') continue;
    for (const side of [-1, 1]) mineralPocket(builder, s, side, colors);
  }
}

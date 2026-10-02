// Prismatic skyway dressing. The existing physical road owns every driveable
// surface; the distant islands and stations below are explicitly nonplayable
// scenery and emit no collision. Only the short roadside guard rails are solid.
// Geometry goes into the caller's two merged body/glow builders.

const RAIL_D = 13.2;
const LATTICE_D = 13.8;
const RAIL_STEP = 4;
const ISLAND_STEP = 384;
const ARCH_STEP = 384;
const STATION_STEP = 576;
const RAIL_STRUCTURES = new Set(['bridge', 'tunnel', 'overpass', 'ramp']);

const PALE_CYAN = [0.39, 0.86, 0.96];
const PALE_ROSE = [0.90, 0.48, 0.74];
const PALE_GOLD = [0.94, 0.79, 0.42];

function skySpan(b, a, z) {
  return b.themeAt(a + 0.001) === 'sky'
    && b.themeAt((a + z) * 0.5) === 'sky'
    && b.themeAt(z - 0.001) === 'sky'
    && b.spanFree(a, z);
}

function railSpan(b, a, z) {
  if (b.themeAt(a) !== 'sky' || b.themeAt(z) !== 'sky'
    || b.themeAt((a + z) * 0.5) !== 'sky') return false;
  // The rails remain a physical boundary beside lane challenges and warnings.
  // Only nearby road structures suppress them. Each emitted rail/post still
  // reserves its whole footprint against the main strip and branch corridors.
  return !b.road.featuresIn(a - 4, z + 4).some(f => RAIL_STRUCTURES.has(f.type));
}

function anchors(b, step, visit) {
  for (let s = Math.ceil(b.s0 / step) * step; s < b.s1; s += step) {
    if (b.themeAt(s) === 'sky') visit(s, Math.floor(s / step));
  }
}

function triangle(mb, a, b, c, color, hint) {
  mb.col(...color);
  // Each faceted shell has outward normals even when the road curves or banks.
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const dot = (uy * vz - uz * vy) * hint.x
    + (uz * vx - ux * vz) * hint.y
    + (ux * vy - uy * vx) * hint.z;
  if (dot >= 0) mb.triW(a, b, c, 0, 0, 1, 0, 0.5, 1);
  else mb.triW(c, b, a, 0.5, 1, 1, 0, 0, 0);
}

function localPoint(frame, x, y, z) {
  return { x: frame.x + frame.lx * x + frame.fx * z, y: frame.y + y,
    z: frame.z + frame.lz * x + frame.fz * z };
}

function shiftedFrame(frame, x, y, z) {
  return { ...frame, ...localPoint(frame, x, y, z) };
}

// Decorative closed crystal, with a pointed crown and hanging keel. The caller
// reserves the full horizontal footprint before calling this; there is no
// surface or collision hook, and nothing here represents a driveable island.
function crystal(b, frame, rx, rz, height, colors, sides = 6, luminous = false) {
  const centre = localPoint(frame, 0, 0, 0);
  const crown = localPoint(frame, rx * 0.08, height * 0.78, -rz * 0.08);
  const keel = localPoint(frame, -rx * 0.06, -height * 0.30, rz * 0.10);
  const ring = [];
  for (let k = 0; k < sides; k++) {
    const a = Math.PI * 2 * k / sides;
    ring.push(localPoint(frame, Math.cos(a) * rx,
      Math.sin(a * 2) * height * 0.025, Math.sin(a) * rz));
  }
  for (let k = 0; k < sides; k++) {
    const a = ring[k], z = ring[(k + 1) % sides];
    const hint = { x: (a.x + z.x) * 0.5 - centre.x, y: 0.4,
      z: (a.z + z.z) * 0.5 - centre.z };
    // A few whole facets use the shared glow mesh, so there is no coplanar
    // overlay, separate material, light object, or animated crystal effect.
    const upper = luminous && k === 1 ? b.glow : b.body;
    triangle(upper, a, z, crown, colors[k % colors.length], hint);
    triangle(b.body, z, a, keel, colors[(k + 1) % colors.length],
      { x: hint.x, y: -0.5, z: hint.z });
  }
}

function buildRails(b) {
  const { light, mid, dark, accent } = b.palette;
  anchors(b, RAIL_STEP, (s, index) => {
    const end = Math.min(s + RAIL_STEP, b.s1);
    if (end - s < 0.1 || !railSpan(b, s, end)) return;
    const midS = (s + end) * 0.5;
    for (const side of [-1, 1]) {
      const d = side * RAIL_D;
      const centre = b.at(midS, d);
      const railA = b.at(s, d, 1.35), railZ = b.at(end, d, 1.35);
      const radius = Math.max(2.2,
        Math.hypot(railA.x - centre.x, railA.z - centre.z) + 0.12,
        Math.hypot(railZ.x - centre.x, railZ.z - centre.z) + 0.12);
      // The 4 m section's enclosing disk clears the protected 10.25 m strip.
      // The shared primitive helper emits each visible solid's exact collider.
      if (!b.reserve(midS, d, radius)) continue;
      b.tube(railA, railZ, 0.12, light, { solid: true });
      b.tube(b.at(s, d, 0.64), b.at(end, d, 0.64), 0.09, mid, { solid: true });
      if ((index & 1) === 0 && b.reserve(s, d, 0.35)) {
        b.box(s, d, 0.74, 0.36, 1.70, 0.36, dark, { solid: true });
        b.box(s, d, 1.64, 0.42, 0.12, 0.42, accent, { glow: true });
      }

      const latticeD = side * LATTICE_D;
      // Side trusses hang beside the road, never across the playable strip.
      // Their open triangles make the engineered underside readable in profile.
      const topA = b.at(s, latticeD, -1.25);
      const topZ = b.at(end, latticeD, -1.25);
      const lowA = b.at(s, latticeD, -3.65);
      const lowZ = b.at(end, latticeD, -3.65);
      const latticeCentre = b.at(midS, latticeD);
      const latticeRadius = Math.max(2.3,
        Math.hypot(topA.x - latticeCentre.x, topA.z - latticeCentre.z) + 0.13,
        Math.hypot(topZ.x - latticeCentre.x, topZ.z - latticeCentre.z) + 0.13);
      if (!b.reserve(midS, latticeD, latticeRadius)) continue;
      b.tube(topA, topZ, 0.13, mid);
      b.tube(lowA, lowZ, 0.13, dark);
      b.tube((index & 1) ? lowA : topA, (index & 1) ? topZ : lowZ, 0.11, mid);
      if ((index & 1) === 0) b.tube(topA, lowA, 0.13, dark);
    }
  });
}

function buildNonplayableIsland(b, s, index) {
  const side = (index & 1) ? -1 : 1;
  const d = side * (108 + (index % 3) * 19);
  const dy = 17 + (index % 4) * 5;
  const rx = 20 + (index % 3) * 3;
  const rz = 24 + (index % 2) * 5;
  // This bounds the island and its offset spires. Sampling the whole span also
  // prevents dressing from straddling a stage transition or nearby junction.
  if (!skySpan(b, s - 42, s + 42) || !b.reserve(s, d, 44)) return;
  const { light, mid, dark, accent } = b.palette;
  // All pieces share one road-tangent frame, so curvature cannot stretch the
  // distant island beyond its reserved footprint or distort its crystal fins.
  const frame = b.frame(s, d, dy);
  crystal(b, frame, rx, rz, 31, [mid, dark, mid, light]);

  // Cathedral-scale prismatic fins sit on the far island's crown. Their narrow
  // section and tall silhouettes do not resemble another ribbon of road.
  crystal(b, shiftedFrame(frame, side * 7, 7, -8), 5.3, 5.5, 58,
    [light, PALE_CYAN, mid, accent], 4, true);
  crystal(b, shiftedFrame(frame, -side * 8, 5, 9), 4.7, 6.2, 44,
    [mid, PALE_ROSE, light, accent], 4, true);
  crystal(b, shiftedFrame(frame, side * 17, 3, 2), 3.6, 4.5, 36,
    [light, PALE_GOLD, mid, accent], 4, true);
}

function buildSuspendedArch(b, s) {
  if (!skySpan(b, s - 26, s + 26)) return;
  const { light, mid, dark, accent } = b.palette;
  // Cable pylons terminate below the deck instead of floating arch feet.
  // Nothing spans the traffic aperture: these suspend the outside trusses.
  for (const side of [-1, 1]) {
    const d = side * 27;
    if (!b.reserve(s, d, 7)) continue;
    b.box(s, d, 9, 3.8, 70, 5.4, dark);
    b.box(s, d, 11, 2.4, 66, 4.6, mid);
    b.box(s, d + side * .9, 13, .22, 53, 4.8, light);
    b.box(s, d, 44, 6.4, 2.4, 8.2, light);
    b.box(s, d, -24, 9, 4, 10, dark);
    for (const dy of [-14, 0, 14, 28]) b.box(s, d, dy, 4.3, .65, 5.9, light);
    b.box(s, d - side * 1.95, 35, .14, 5.5, 2.3, accent, { glow: true });
    for (const along of [-21, -10, 10, 21]) {
      const at = s + along, deckD = side * LATTICE_D;
      if (!b.reserve(at, deckD, .35)) continue;
      const deck = b.at(at, deckD, -2.5), top = b.at(s, d, 43);
      b.tube(top, deck, .13, dark);
      b.tube(b.at(at, deckD, -3.4), b.at(at, side * 16.5, -3.4), .24, mid);
    }
  }
}

function buildNonplayableStation(b, s, index) {
  const side = (index & 1) ? 1 : -1, d = side * 88;
  if (!skySpan(b, s - 52, s + 52) || !b.reserve(s, d, 57)) return;
  const { light, mid, dark, accent } = b.palette;
  const frame = b.frame(s, d, 13), body = b.body;
  const box = (x,y,z,w,h,len,col) => body.col(...col).box(frame,x-w/2,x+w/2,y-h/2,y+h/2,z-len/2,z+len/2,{bottom:true});
  // Suspended relay outpost: split nacelles, load-bearing keel, catwalk,
  // louvered equipment and one open wind-rotor silhouette.
  box(0,0,0,24,4,38,dark); box(0,3,2,19,3,31,mid);
  box(-side*5,10,8,12,13,14,light);box(side*6,6,-9,8,7,15,mid);
  box(0,-8,3,4,14,23,dark);box(0,-14,3,8,2,29,mid);
  for (const z of [-13,-7,-1,5,11]) box(0,-8,z,5.5,.6,1,light);
  for (const z of [-12,-8,-4,0,4]) {
    box(side*10.1,4,z,.18,2.2,2.4,dark);
    box(-side*11.1,6,z,.17,.15,2.1,accent);
  }
  for(const x of [-11,11])for(const z of [-15,15]){
    b.tube(localPoint(frame,x,-12,z),localPoint(frame,x,18,z),.32,mid);
    b.tube(localPoint(frame,x,18,z),localPoint(frame,0,32,3),.14,dark);
  }
  box(0,30,3,4,8,5,mid);box(0,34,3,6,1.2,7,light);
  for(const z of [-18,18]) b.tube(localPoint(frame,-12,2,z),localPoint(frame,12,2,z),.15,light);
  // Rotor lies in a vertical plane, with a thin open rim and angled blades.
  const hub=shiftedFrame(frame,side*23,20,-4), radius=14, segments=12;
  for(let i=0;i<segments;i++){
    const a=i*Math.PI*2/segments,c=(i+1)*Math.PI*2/segments;
    b.tube(localPoint(hub,Math.cos(a)*radius,Math.sin(a)*radius,0),localPoint(hub,Math.cos(c)*radius,Math.sin(c)*radius,0),.38,light);
  }
  for(let i=0;i<3;i++){
    const angle=i*Math.PI*2/3,dx=Math.cos(angle),dy=Math.sin(angle);
    const p=(r,w,z)=>localPoint(hub,dx*r-dy*w,dy*r+dx*w,z);
    b.quad([p(2,-.8,0),p(12,-1.4,.7),p(13,1.2,-.4),p(3,1,0)],mid,{x:frame.fx,y:0,z:frame.fz});
  }
  b.tube(localPoint(hub,0,0,-3),localPoint(hub,0,0,4),1.1,dark);
  b.tube(localPoint(frame,side*8,8,-5),localPoint(hub,0,0,-2),.65,mid);
  b.tube(localPoint(frame,0,34,3),localPoint(frame,0,41,3),.13,light);
  // Small continuous service strips share the existing glow mesh; no new lights.
  b.tube(localPoint(frame,-9,12,14.1),localPoint(frame,1,12,14.1),.10,accent,{glow:true});
}

export function buildSky(builder) {
  buildRails(builder);
  anchors(builder, ISLAND_STEP, (s, index) => buildNonplayableIsland(builder, s, index));
  anchors(builder, ARCH_STEP, (s) => buildSuspendedArch(builder, s));
  anchors(builder, STATION_STEP, (s, index) => buildNonplayableStation(builder, s, index));
}

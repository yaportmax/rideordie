"""RIDE OR DIE weapons kit: reusable parts built on gunlib (G frame mm: +X fwd, +Y left, +Z up).

Small hardware (rivets, screws, sling loops, notch plates, dimple cutters), AK furniture (grip with moulded ribs, laminated
handguards, AKM stock, butt plate), magazines with rounds, optics (compact red dot, rifle scope with a real reticle behind a
see-through `glass_lens`)."""
import math

import bmesh
from mathutils import Matrix, Vector

from gunlib import (D2R, box_bm, cyl_bm, fillet_poly, lathe_bm, loft_bm, merge_bm, prism_bm, rail_bm, round_bms, rrect_ring,
                    sphere_bm, sweep_bm)


def _orient(bm, pos, axis):
    """Move a +Z-authored bmesh to pos, +Z -> axis."""
    a = Vector(axis).normalized()
    q = Vector((0, 0, 1)).rotation_difference(a)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(pos)) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return bm


# =========================================================================================== small hardware
def rivet(pos, axis, r=2.2, h=1.0, segs=10):
    """Dome rivet head sitting on a surface (axis = outward normal)."""
    bm = lathe_bm([(-0.4, r), (0.0, r), (h * 0.55, r * 0.86), (h * 0.9, r * 0.5), (h, 0.0)], segs, "z")
    return _orient(bm, pos, axis)


def screw_head(pos, axis, r=2.5, h=1.0, segs=12):
    bm = lathe_bm([(-0.4, r), (0.0, r), (h * 0.7, r * 0.92), (h, r * 0.6), (h, 0.0)], segs, "z")
    from gunlib import bool_op
    bm = bool_op(bm, [box_bm((r * 2.6, r * 0.34, h * 0.8), c=(0, 0, h))])
    return _orient(bm, pos, axis)


def dimple_cutter(pos, normal, length, height, depth):
    """Ellipsoid cutter for a stamped dimple on a +-Y facing wall (length along X, height along Z), indenting `depth`."""
    n = Vector(normal).normalized()
    bm = sphere_bm(1.0, usegs=24, vsegs=12)
    for v in bm.verts:
        v.co = Vector((v.co.x * length / 2, v.co.y * 3.0 * depth, v.co.z * height / 2))
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(pos) + n * (2.0 * depth)), verts=bm.verts)
    return bm


def loop_bm(pos, axis, r=7.0, t=1.6):
    """Sling loop: half ring standing off a surface (axis = outward normal); lies in the plane of axis and X."""
    a = Vector(axis).normalized()
    path = []
    for k in range(13):
        ang = math.pi * k / 12
        path.append((math.cos(ang) * r, 0.0, math.sin(ang) * r * 0.8))
    bm = sweep_bm(path, radius=t, segs=8, cap=True)
    q = Vector((0, 0, 1)).rotation_difference(a)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(pos)) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return bm


def vnotch(pos, half_w, h, t):
    """Rear sight notch plate (in the YZ plane at pos.x): U notch in the top edge."""
    x, y, z = pos
    pts = [(half_w, z - h), (half_w, z), (1.3, z), (0.9, z - 1.6), (-0.9, z - 1.6), (-1.3, z), (-half_w, z), (-half_w, z - h)]
    bm = bmesh.new()
    a = [bm.verts.new((x - t / 2, py, pz)) for py, pz in pts]
    b = [bm.verts.new((x + t / 2, py, pz)) for py, pz in pts]
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def knurl(k, n=2, amt=0.06):
    return 1.0 - amt if (k // n) % 2 else 1.0


# =========================================================================================== AK furniture
def rr_ring2(depth, width, rf, rb, cx=0.0, cz=0.0, n=4, rib=None, dense=16):
    """Grip cross-section in the (lx, y) plane: depth along lx (front = +lx), width along y; front corner radius rf, back rb.
    rib(y_side, lx) -> outward offset for the flat side walls (moulded ribs)."""
    d, w = depth / 2, width / 2
    pts = fillet_poly([(d, -w), (d, w), (-d, w), (-d, -w)], [rf, rf, rb, rb], n)
    out = []
    # densify the flat side walls so ribs have vertices
    pts2 = []
    for i in range(len(pts)):
        p, q = pts[i], pts[(i + 1) % len(pts)]
        pts2.append(p)
        if abs(p[1] - q[1]) < 1e-4 and abs(abs(p[1]) - w) < 1e-4 and abs(p[0] - q[0]) > 1.0:
            m = dense
            for k in range(1, m):
                pts2.append((p[0] + (q[0] - p[0]) * k / m, p[1]))
    for lx, y in pts2:
        if rib is not None and abs(abs(y) - w) < 1e-4:
            y = y + math.copysign(rib(lx), y)
        out.append((cx + lx, y, cz))
    return out


def ak_grip(GA, top=56.0, bottom=-58.0):
    """AK pistol grip: raked GA deg, moulded vertical ribs on both sides, fuller at the palm swell, top cut flat."""
    c, s = math.cos(GA * D2R), math.sin(GA * D2R)
    secs = [(top, 38.0, 27.0, 6, 11), (46.0, 41.0, 28.5, 7, 12), (26.0, 44.0, 30.0, 8, 13), (0.0, 46.0, 31.0, 8, 14), (-26.0, 45.5, 31.0, 8, 14),
            (-46.0, 44.0, 30.0, 8, 13), (bottom + 4, 42.0, 28.5, 7, 12), (bottom, 38.0, 26.0, 6, 10)]
    rib = lambda lx: 0.35 * (0.5 + 0.5 * math.cos(2 * math.pi * lx / 2.0)) if abs(lx) < 15 else 0.0
    rings = []
    for lz, dep, wid, rf, rb in secs:
        ring = rr_ring2(dep, wid, rf, rb, cx=1.5, rib=rib if bottom + 8 < lz < top - 4 else None)
        rings.append([(lx, y, lz) for lx, y, _ in ring])
    n = len(rings[0])
    bm = bmesh.new()
    vr = [[bm.verts.new((lx * c + lz * s, y, -lx * s + lz * c)) for lx, y, lz in r] for r in rings]
    for i in range(len(vr) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new((vr[i][k], vr[i][k2], vr[i + 1][k2], vr[i + 1][k]))
    bm.faces.new(list(reversed(vr[0])))
    bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # flat top at the receiver bottom: clip everything above z = 50.5
    from gunlib import bool_op
    bm = bool_op(bm, [box_bm((120, 60, 40), c=(20, 0, 70.5))])
    return bm


def ak_lower_handguard(x0, x1, bz):
    """AKM laminated lower handguard: U trough around the barrel with palm swells and a side channel."""
    secs = []
    N = 14
    for i in range(N + 1):
        t = i / N
        x = x0 + (x1 - x0) * t
        swell = 1.0 + 0.06 * math.sin(math.pi * min(1, max(0, (t - 0.1) / 0.8)))
        w = 44.0 * swell if t > 0.03 else 41.0
        if t > 0.95:
            w *= 0.96
        top, bot = bz + 6.0, bz - 34.0 * (0.98 + 0.02 * swell)
        pts = fillet_poly([(w / 2, bot), (w / 2, top), (-w / 2, top), (-w / 2, bot)], [15, 3, 3, 15], 5)
        ring = []
        for y, z in pts:
            if abs(abs(y) - w / 2) < 0.5 and bz - 20 < z < bz - 4:
                y -= math.copysign(1.4 * math.sin(math.pi * (z - (bz - 20)) / 16.0), y)
            ring.append((y, z))
        secs.append((x, ring))
    # the ring point counts are equal (fillet of the same polygon) -> loft
    return loft_bm(secs)


def ak_upper_handguard(x0, x1, zc):
    secs = []
    N = 8
    for i in range(N + 1):
        t = i / N
        x = x0 + (x1 - x0) * t
        k = 1.0 - 0.06 * t
        pts = fillet_poly([(18.5 * k, zc - 10), (18.5 * k, zc + 4), (9 * k, zc + 13.5), (-9 * k, zc + 13.5), (-18.5 * k, zc + 4), (-18.5 * k, zc - 10)],
                          [2, 9, 6, 6, 9, 2], 4)
        secs.append((x, pts))
    return loft_bm(secs)


def akm_stock(x0, x1):
    """AKM laminated buttstock from the receiver tang (x0) to the butt (x1)."""
    table = [(x0 + 4, 111.0, 66.0, 28.5), (x0 - 16, 112.0, 60.0, 30.0), (x0 - 50, 112.5, 45.0, 31.0), (x0 - 90, 113.0, 27.0, 33.0),
             (x0 - 130, 113.5, 8.0, 35.0), (x1, 114.0, -12.0, 36.0)]
    secs = []
    for x, zt, zb, w in table:
        pts = fillet_poly([(w / 2, zb), (w / 2, zt), (-w / 2, zt), (-w / 2, zb)], [10, 12, 12, 10], 5)
        secs.append((x, pts))
    return loft_bm(secs)


def butt_plate(x0, x1):
    w, zt, zb = 36.6, 114.6, -12.6
    ring = fillet_poly([(w / 2, zb), (w / 2, zt), (-w / 2, zt), (-w / 2, zb)], [10, 12, 12, 10], 5)
    ring2 = fillet_poly([(w / 2 - 1.2, zb + 1.5), (w / 2 - 1.2, zt - 1.5), (-w / 2 + 1.2, zt - 1.5), (-w / 2 + 1.2, zb + 1.5)], [9, 11, 11, 9], 5)
    return loft_bm([(x0 + 0.5, ring), (x1 + 1.5, ring), (x1, ring2)])


# =========================================================================================== magazines
def mag_arc(top, th0, rm):
    def at(s):
        th = th0 + s / rm
        x = top[0] + rm * (math.cos(th0) - math.cos(th))
        z = top[2] - rm * (math.sin(th) - math.sin(th0))
        return (x, z), (math.sin(th), -math.cos(th)), th
    return at


def akm_mag(mag, top, th0=6.0 * D2R, rm=440.0, length=244.0):
    at = mag_arc(top, th0, rm)
    path = lambda s0, s1, n=28: [(at(s0 + (s1 - s0) * i / n)[0][0], 0.0, at(s0 + (s1 - s0) * i / n)[0][1]) for i in range(n + 1)]
    outer = sweep_bm(path(0, length), 1.0, profile=rrect_ring(27.4, 58.0, 5.5, n=3), up=(0, 1, 0))
    mag.add(outer, "gun_black", bevel=0)
    # stamped side ribs (lower two thirds) + reinforcing spine ridges front & back
    for s in range(84, 232, 16):
        (x, z), (tx, tz), th = at(s)
        for sy in (1, -1):
            mag.add(box_bm((40, 1.5, 3.2), c=(x + 1, sy * 13.9, z), rot=(0, -math.degrees(th), 0)), "gun_black", bevel=0.6)
    for side in (1, -1):
        mag.add(sweep_bm([(p[0] + side * 29.2 * math.cos(at(12 + i * 8.0)[2]), 0, p[2] + side * 29.2 * math.sin(at(12 + i * 8.0)[2]))
                          for i, p in enumerate(path(12, length - 8, 27))], 1.0, profile=rrect_ring(3.0, 9.0, 1.2, n=2), up=(0, 1, 0)),
                "gun_black", bevel=0)
    # feed lips + rear locking lug + front hook
    (x, z), (tx, tz), th = at(3)
    for sy in (1, -1):
        mag.add(box_bm((46, 2.4, 4.0), c=(x - 3, sy * 9.8, z + 1), rot=(0, -math.degrees(th), 0)), "gun_black", bevel=0.5)
    (x, z), _, th = at(8)
    mag.add(box_bm((7, 12, 9), c=(x - 31.5, 0, z + 3), rot=(0, -math.degrees(th), 0)), "gun_metal", bevel=0.9)
    mag.add(box_bm((9, 14, 7), c=(x + 31.5, 0, z + 2), rot=(0, -math.degrees(th), 0)), "gun_metal", bevel=0.9)
    # floor plate with the dimple + retainer tab
    (x, z), (tx, tz), th = at(length)
    mag.add(box_bm((62, 30.4, 5.5), c=(x + tx * 2.0, 0, z + tz * 2.0), rot=(0, -math.degrees(th), 0)), "gun_metal", bevel=1.4)
    mag.add(box_bm((10, 16, 2.5), c=(x + tx * 5.0 + math.cos(th) * 22, 0, z + tz * 5.0 + math.sin(th) * 22), rot=(0, -math.degrees(th), 0)), "gun_metal", bevel=0.8)
    # two rounds in the feed lips (double column: the top round left, the next one right)
    for i, (s, sy) in enumerate(((1.5, 3.2), (9.5, -3.4))):
        (x, z), (tx, tz), th = at(s)
        fx, fz = math.cos(th), math.sin(th)
        head = (x - fx * 27.5, sy, z - fz * 27.5 + (2.0 if i == 0 else 0.0))
        rb = round_bms("762x39", segs=12, at=head, rot=(0, -math.degrees(th), 0), primer=False)
        mag.add(rb["case"], "brass", bevel=0)
        mag.add(rb["bullet"], "gun_metal", bevel=0)
    return mag


# =========================================================================================== optics
def red_dot(part, x_c, axis_z, rail_top, length=100.0, r_body=16.0):
    """Compact 1x red dot (CompM4-style) with a cantilever riser clamp; lenses are glass_lens discs recessed in the bells."""
    L = length
    xr = x_c - L / 2
    rb = r_body + 1.6
    prof = [(0, 0), (0, 13.2), (0.6, 14.6), (1.8, rb - 0.2), (10, rb), (12.5, r_body), (L - 14, r_body), (L - 11, rb + 0.2), (L - 1.8, rb + 0.4),
            (L, rb - 1.0), (L, 14.6), (L - 4, 13.4), (L - 4, 0)]
    tube = lathe_bm(prof, 36, "x", c=(xr, 0, axis_z))
    part.add(tube, "gun_black", bevel=0)
    # lenses (see-through): rear at xr+3.5, front at xr+L-4.2
    part.add(lathe_bm([(0, 0), (0, 13.0), (0.8, 13.0), (0.8, 0)], 28, "x", c=(xr + 2.5, 0, axis_z)), "glass_lens", bevel=0)
    part.add(lathe_bm([(0, 0), (0, 13.4), (0.8, 13.4), (0.8, 0)], 28, "x", c=(xr + L - 4.6, 0, axis_z)), "glass_lens", bevel=0)
    # knurled bands on the bells
    for x0 in (xr + 3.0, xr + L - 10.0):
        part.add(lathe_bm([(0, rb - 0.4), (0, rb + 0.6), (6.5, rb + 0.6), (6.5, rb - 0.4)], 44, "x", c=(x0, 0, axis_z), mod=lambda k: knurl(k, 1, 0.035), cap=False), "gun_black", bevel=0)
    # turrets: elevation (top), windage (right), brightness dial (left, bigger)
    part.add(_turret(x_c + 6, 0.0, axis_z + r_body - 1.5, (0, 0, 1), r=8.6, h=8.0), "gun_black", bevel=0)
    part.add(_turret(x_c + 6, -(r_body - 1.5), axis_z, (0, -1, 0), r=8.6, h=8.0), "gun_black", bevel=0)
    part.add(_turret(x_c + 6, r_body - 1.5, axis_z, (0, 1, 0), r=10.5, h=7.0), "gun_black", bevel=0)
    # riser: cantilever block down to the rail + two clamp rings + throw lever on the left
    zb = axis_z - r_body
    riser = prism_bm([(x_c - 28, rail_top), (x_c + 24, rail_top), (x_c + 24, zb + 6), (x_c + 16, zb + 1), (x_c - 22, zb + 1), (x_c - 28, zb + 6)],
                     -11.0, 11.0, fillet=[1, 1, 3, 4, 4, 3], fsegs=3)
    part.add(riser, "gun_black", bevel=0.8)
    for xx in (x_c - 18, x_c + 14):
        ring = lathe_bm([(0, r_body + 0.2), (0, r_body + 3.2), (8, r_body + 3.2), (8, r_body + 0.2)], 36, "x", c=(xx - 4, 0, axis_z), cap=True)
        part.add(ring, "gun_black", bevel=0.4)
        part.add(box_bm((8, 8, 5), c=(xx, -r_body - 3.5, axis_z - 6)), "gun_black", bevel=0.6)
        for zz in (axis_z - 4, axis_z - 9):
            part.add(_hex(xx, -r_body - 7.6, zz), "gun_metal", bevel=0)
    # rail clamp jaws + throw lever (left) + cross bolt (right)
    for sy in (1, -1):
        part.add(box_bm((50, 4.2, 10.0), c=(x_c - 2, sy * 12.8, rail_top - 3.0)), "gun_black", bevel=0.7)
    lever = prism_bm([(x_c - 20, rail_top - 6), (x_c + 18, rail_top - 5), (x_c + 22, rail_top - 1), (x_c - 18, rail_top + 1)], 15.0, 18.5, fillet=1.5, fsegs=3)
    part.add(lever, "gun_metal", bevel=0.5)
    part.add(cyl_bm((x_c - 16, -16, rail_top - 3), (x_c - 16, 18.5, rail_top - 3), 3.0, segs=12), "gun_metal", bevel=0)
    # the dot: a tiny emitter window under the front lens (the game draws the real reticle)
    return part


def micro_dot(part, x_c, axis_z, rail_top, r_body=13.5, length=62.0):
    """Micro red dot (T-2 class) on a tall one-piece riser: 27 mm body, flip-free, turret caps top/right, dial left."""
    L = length
    xr = x_c - L / 2
    rb = r_body
    prof = [(0, 0), (0, 10.2), (0.6, 11.4), (1.6, rb - 0.4), (4.5, rb), (L - 5.0, rb), (L - 1.6, rb - 0.2), (L, rb - 1.2), (L, 11.6), (L - 3.5, 10.8), (L - 3.5, 0)]
    part.add(lathe_bm(prof, 36, "x", c=(xr, 0, axis_z)), "gun_black", bevel=0)
    part.add(lathe_bm([(0, 0), (0, 10.0), (0.8, 10.0), (0.8, 0)], 28, "x", c=(xr + 2.2, 0, axis_z)), "glass_lens", bevel=0)
    part.add(lathe_bm([(0, 0), (0, 10.6), (0.8, 10.6), (0.8, 0)], 28, "x", c=(xr + L - 4.2, 0, axis_z)), "glass_lens", bevel=0)
    # boxy lower body where the turrets sit (the T-2 'shoulders') + turret caps
    part.add(box_bm((30, 2 * rb + 3.0, 10), c=(x_c + 2, 0, axis_z - rb + 4.0)), "gun_black", bevel=1.6)
    part.add(_turret(x_c + 4, 0.0, axis_z + rb - 1.0, (0, 0, 1), r=7.2, h=6.5), "gun_black", bevel=0)
    part.add(_turret(x_c + 4, -(rb + 0.2), axis_z - 1.0, (0, -1, 0), r=7.2, h=6.0), "gun_black", bevel=0)
    part.add(_turret(x_c + 4, rb + 0.2, axis_z - 1.0, (0, 1, 0), r=8.8, h=5.0), "gun_black", bevel=0)
    # tall one-piece riser (skeletonised) down to the rail + cross bolt nuts
    zb = axis_z - rb + 0.5
    riser = prism_bm([(x_c - 26, rail_top), (x_c + 26, rail_top), (x_c + 22, rail_top + 5), (x_c + 18, zb), (x_c - 16, zb), (x_c - 22, rail_top + 5)],
                     -10.5, 10.5, fillet=[1, 1, 3, 2, 2, 3], fsegs=3)
    from gunlib import bool_op
    riser = bool_op(riser, [cyl_bm((x_c + 1, -15, rail_top + 13), (x_c + 1, 15, rail_top + 13), 6.5, segs=20),
                            box_bm((22, 30, 7), c=(x_c + 1, 0, rail_top + 7))])
    part.add(riser, "gun_black", bevel=0.8)
    for sy in (1, -1):
        part.add(box_bm((50, 3.6, 9.0), c=(x_c, sy * 12.4, rail_top - 2.6)), "gun_black", bevel=0.7)
    for xx in (x_c - 14, x_c + 14):
        part.add(_hex(xx, -14.0, rail_top - 2.5), "gun_metal", bevel=0)
        part.add(cyl_bm((xx, -13, rail_top - 2.5), (xx, 15.5, rail_top - 2.5), 2.2, segs=10), "gun_metal", bevel=0)
    return part


def _turret(x, y, z, axis, r=10.2, h=9.5):
    bm = lathe_bm([(0, 0), (0, r - 0.7), (1.0, r), (h - 1.0, r), (h, r - 1.0), (h, 0)], 20, "z", mod=lambda k: knurl(k, 1, 0.05))
    cap = lathe_bm([(h, 0), (h, r * 0.35), (h + 0.8, r * 0.3), (h + 0.8, 0)], 12, "z")
    bm = merge_bm([bm, cap])
    return _orient(bm, (x, y, z), axis)


def _hex(x, y, z, r=2.3, h=1.8):
    bm = lathe_bm([(-0.3, r), (h, r), (h, 0)], 6, "z", phase=0.5236)
    return _orient(bm, (x, y, z), (0, -1, 0))


# =========================================================================================== modern polymer grip + shotshells
def modern_grip(GA, top=22.0, lz_top=None, bottom=-62.0, width=30.0, depth=46.0, name_scale=1.0):
    """Modern polymer pistol grip (A2/MOE class): raked GA, finger groove + palm swell, flat top at z = `top`."""
    c, s = math.cos(GA * D2R), math.sin(GA * D2R)
    lzt = (top / c) + 12.0 if lz_top is None else lz_top
    secs = [(lzt, depth - 6, width - 3, 7, 10), (lzt - 10, depth - 3, width - 1.5, 8, 11), (12.0, depth, width, 8, 12), (-8.0, depth + 0.5, width + 0.6, 8, 12),
            (-30.0, depth + 0.5, width + 0.8, 8, 12), (-50.0, depth - 0.5, width, 8, 11), (bottom + 5, depth - 2.5, width - 1.0, 7, 10), (bottom, depth - 6, width - 3.5, 6, 9)]
    rings = []
    for lz, dep, wid, rf, rb in secs:
        ring = rr_ring2(dep, wid, rf, rb, n=4)
        fg = 2.2 * math.exp(-((lz + 4.0) / 7.0) ** 2)          # finger groove under the middle finger
        rings.append([(lx - (fg if lx > dep / 2 - 4 else 0.0), y, lz) for lx, y, _ in ring])
    n = len(rings[0])
    bm = bmesh.new()
    vr = [[bm.verts.new((lx * c + lz * s, y, -lx * s + lz * c)) for lx, y, lz in r] for r in rings]
    for i in range(len(vr) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new((vr[i][k], vr[i][k2], vr[i + 1][k2], vr[i + 1][k]))
    bm.faces.new(list(reversed(vr[0])))
    bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    from gunlib import bool_op
    return bool_op(bm, [box_bm((140, 70, 60), c=(20, 0, top + 30.0))])


def shotshell(part, pos, direction, fired=False, head_back=True, length=70.0, segs=20):
    """12 ga shell with its brass head at `pos`, hull extending along `direction`: brass head + rim + primer, red hull, crimp."""
    L = length
    head = [(0, 0), (0, 10.9), (1.3, 10.9), (1.3, 10.35), (15.0, 10.35), (15.6, 10.15)]
    hull = [(15.6, 10.15), (L - 3.5, 10.15)]
    if fired:
        hull += [(L - 1.5, 10.8), (L, 11.4), (L, 9.8), (L - 4, 9.4)]
    else:
        hull += [(L - 1.2, 9.4), (L, 7.2), (L, 0)]
    a = Vector(direction).normalized()
    q = Vector((0, 0, 1)).rotation_difference(a)
    M = Matrix.Translation(Vector(pos)) @ q.to_matrix().to_4x4()
    hb = lathe_bm(head + [(15.6, 0)], segs, "z")
    bmesh.ops.transform(hb, matrix=M, verts=hb.verts)
    part.add(hb, "brass", bevel=0)
    hl = lathe_bm([(15.6, 0)] + hull + ([(L - 4, 0)] if fired else []), segs, "z")
    bmesh.ops.transform(hl, matrix=M, verts=hl.verts)
    part.add(hl, "paint", bevel=0)
    pr = lathe_bm([(-0.3, 0), (-0.3, 2.6), (0.2, 2.8), (0.2, 0)], 12, "z")
    bmesh.ops.transform(pr, matrix=M, verts=pr.verts)
    part.add(pr, "gun_steel", bevel=0)

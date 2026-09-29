"""tunnel_mid_10m, tunnel_portal_concrete, tunnel_portal_rock, tunnel_exit (+ tunnel_exit_concrete).
Road runs +Z. Interior half-width 7.4 (opening 14.8 m), walls vertical to y=3.8, elliptical crown at y=7.4.
Entrance portals: face at z=0 facing -Z (toward approaching traffic), 12 m of tube (z 0..12).
Mid segment: 10 m, ribs every 2.5 m. Exit: 12 m of tube then the portal face at z=12 facing +Z."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *
import bmesh

HW, WALL, CROWN = 7.4, 3.8, 7.4
DADO = 2.4
WALLPTS = (0.0, 0.9, DADO, WALL)


def tube_profile(n=14):
    pts = [(-HW, y) for y in WALLPTS]
    b = CROWN - WALL
    for i in range(1, n):
        a = math.pi - math.pi * i / n
        pts.append((HW * math.cos(a), WALL + b * math.sin(a)))
    pts += [(HW, y) for y in reversed(WALLPTS)]
    return pts


def ceil_y(x):
    return WALL + (CROWN - WALL) * math.sqrt(max(0.0, 1 - (x / HW) ** 2))


def offset_profile(pts, d):
    """Offset a left->right clockwise profile by d toward the interior (d<0 = outward)."""
    out = []
    n = len(pts)
    for i in range(n):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, n - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty) or 1
        nx, ny = ty / L, -tx / L
        out.append((pts[i][0] + nx * d, pts[i][1] + ny * d))
    return out


def resample(poly, n):
    seg = [math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]) for i in range(len(poly) - 1)]
    tot = sum(seg)
    out = []
    j, acc = 0, 0.0
    for k in range(n):
        target = tot * k / (n - 1)
        while j < len(seg) - 1 and acc + seg[j] < target - 1e-9:
            acc += seg[j]
            j += 1
        t = (target - acc) / seg[j] if seg[j] > 0 else 0
        t = min(max(t, 0), 1)
        out.append((poly[j][0] + (poly[j + 1][0] - poly[j][0]) * t, poly[j][1] + (poly[j + 1][1] - poly[j][1]) * t))
    return out


def tube_segment(p, z0, z1, rib_zs, light_zs=None, detail=True, fans=(), seed=1, outer_skin=True, cap_start=False, cap_end=False):
    """Interior lining between z0 and z1 (game space), ribs at rib_zs."""
    prof = tube_profile()
    n = len(prof)
    step = 1.25
    nz = max(1, int(round((z1 - z0) / step)))
    zs = [z0 + (z1 - z0) * i / nz for i in range(nz + 1)]

    def grid(idx_from, idx_to, mat, tint=None):
        sub = prof[idx_from:idx_to + 1]
        pts = [(x, y, z) for z in zs for x, y in sub]
        p.mesh_grid(mat, pts, len(sub), len(zs), flip=False, tint=tint)
    grid(0, 2, "concrete", tint=(1.25, 1.22, 1.14))                 # left dado (tile-like)
    grid(2, n - 3, "concrete_dark")
    grid(n - 3, n - 1, "concrete", tint=(1.25, 1.22, 1.14))
    # floor
    xs = [-7.0 + 14.0 * i / 14 for i in range(15)]
    zf = [z0 + (z1 - z0) * i / max(2, nz) for i in range(max(2, nz) + 1)]
    p.surface("road_surface", "asphalt", xs, zf, lambda x, z: 0.0)
    # outer skin (concrete lining thickness 0.7) so the tube also reads from outside
    if outer_skin:
        op = offset_profile(prof, -0.7)
        op[0] = (op[0][0], -0.6)
        op[-1] = (op[-1][0], -0.6)
        pts = [(x, y, z) for z in zs for x, y in op]
        p.mesh_grid("concrete_dark", pts, len(op), len(zs), flip=True)
        for zc_, flip_ in ((z0, True), (z1, False)):
            # annular end caps (only where not covered by a portal wall)
            if (zc_ == z0 and cap_start) or (zc_ == z1 and cap_end):
                ring = [(x, y, zc_) for x, y in prof] + [(x, y, zc_) for x, y in reversed(op)]
                p.raw("concrete_dark", ring, [tuple(range(len(ring)))] if not flip_ else [tuple(reversed(range(len(ring))))])
    # kerbs / walkway
    for s in (-1, 1):
        a, b = (7.0, HW) if s > 0 else (-HW, -7.0)
        p.bx("concrete_dark", (a, b), (0.0, 0.25), (z0, z1), sub=2.5)
        # amber delineators on the wall
        for zz in [z0 + 1.25 + 2.5 * k for k in range(int((z1 - z0) / 2.5))]:
            p.bx("light_amber", (s * (HW - 0.012) - 0.01, s * (HW - 0.012) + 0.01), (0.85, 1.07), (zz - 0.08, zz + 0.08))
    # ribs
    for zr in rib_zs:
        inner = offset_profile(prof, 0.16)
        poly = [q for q in prof[1:-1]] + [q for q in reversed(inner[1:-1])]
        p.extrude("concrete_dark", poly, zr - 0.25, zr + 0.25, sub=0)
    # cable trays + conduits along both walls
    for s in (-1, 1):
        y = 4.35
        xw = s * (HW * math.sqrt(1 - ((y - WALL) / (CROWN - WALL)) ** 2) - 0.02)
        xt = xw - s * 0.17
        p.bx("metal_dark", (min(xw, xt - s * 0.17), max(xw, xt + s * 0.17)) if False else (xt - 0.17, xt + 0.17), (y - 0.03, y + 0.0), (z0, z1))
        p.bx("metal_dark", (xt - 0.17, xt - 0.13) if s < 0 else (xt + 0.13, xt + 0.17), (y, y + 0.12), (z0, z1))
        p.tube("metal_dark", (xt - 0.05, y + 0.06, z0), (xt - 0.05, y + 0.06, z1), 0.045, sides=8)
        p.tube("rust", (xt + 0.06, y + 0.055, z0), (xt + 0.06, y + 0.055, z1), 0.035, sides=6)
        for zr in rib_zs:
            p.bx("metal_dark", (xt - 0.15, xt + 0.15), (y - 0.16, y - 0.03), (zr - 0.04, zr + 0.04))
    # lights: linear fixtures on both sides of the crown at rib positions
    for zr in (light_zs if light_zs is not None else rib_zs):
        for s in (-1, 1):
            x = s * 2.7
            yc = ceil_y(x)
            p.box("metal_dark", (x, yc - 0.11, zr), (0.3, 0.13, 1.7), bevel=0.02)
            broken = ((int(zr * 10) + (0 if s > 0 else 3)) % 7 == 0)
            p.box("light_amber" if not broken else "metal_dark", (x, yc - 0.19, zr), (0.2, 0.03, 1.5))
    if detail:
        zc = z0 + (z1 - z0) * 0.5
        # exit sign (green) + fire cabinet (red) on the walls
        p.box("metal_dark", (HW - 0.09, 3.1, zc), (0.12, 0.42, 0.8), bevel=0.01)
        p.box("light_green", (HW - 0.155, 3.1, zc), (0.02, 0.34, 0.68))
        p.box("metal_dark", (-HW + 0.09, 1.5, zc + 1.6), (0.16, 0.9, 0.7), bevel=0.02)
        p.box("light_tail", (-HW + 0.18, 1.85, zc + 1.6), (0.02, 0.1, 0.5))
        p.box("metal_bare", (-HW + 0.18, 1.35, zc + 1.6), (0.02, 0.5, 0.5))
    for (zf_, xf_) in fans:
        yf = 6.35
        p.cyl("metal_bare", (xf_, yf, zf_), 0.55, 3.0, "z", sides=14)
        for dz in (-1.4, 1.4):
            p.cyl("metal_dark", (xf_, yf, zf_ + dz), 0.58, 0.18, "z", sides=14)
        p.cyl("metal_dark", (xf_, yf, zf_), 0.5, 3.05, "z", sides=12) if False else None
        p.cyl("metal_dark", (xf_, yf, zf_ + 1.52), 0.4, 0.04, "z", sides=12)
        for dz in (-0.8, 0.8):
            p.tube("metal_dark", (xf_ - 0.4, yf + 0.5, zf_ + dz), (xf_ - 0.4, ceil_y(xf_ - 0.4) + 0.03, zf_ + dz), 0.03, sides=5)
            p.tube("metal_dark", (xf_ + 0.4, yf + 0.5, zf_ + dz), (xf_ + 0.4, ceil_y(xf_ + 0.4) + 0.03, zf_ + dz), 0.03, sides=5)
    # collision: walls + arched lining as hulls
    for s in (-1, 1):
        a, b = (HW, HW + 1.5) if s > 0 else (-HW - 1.5, -HW)
        p.cbx((a, b), (0, WALL), (z0, z1))
    outer = offset_profile(prof, -1.2)
    idx = list(range(3, n - 3))
    for i, j in zip(idx[:-1], idx[1:]):
        p.chull([(prof[i][0], prof[i][1], z0), (prof[j][0], prof[j][1], z0), (outer[i][0], outer[i][1], z0), (outer[j][0], outer[j][1], z0),
                 (prof[i][0], prof[i][1], z1), (prof[j][0], prof[j][1], z1), (outer[i][0], outer[i][1], z1), (outer[j][0], outer[j][1], z1)])


def frame_rings(inner, outer, k, power=1.0):
    """k+1 polylines interpolated between inner (k=0) and outer (k=K)."""
    rings = []
    for j in range(k + 1):
        t = (j / k) ** power
        rings.append([(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for a, b in zip(inner, outer)])
    return rings


def mesh_from_rings(p, mat, rings3d, flip=False, flat=False, tint=None, node=None):
    n = len(rings3d[0])
    pts = [q for r in rings3d for q in r]
    p.mesh_grid(mat, pts, n, len(rings3d), flip=flip, flat=flat, tint=tint, node=node)


def icolump(p, mat, c, r, seed, squash=0.7, jag=0.3, sub=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    rng = random.Random(seed)
    verts = []
    for v in bm.verts:
        co = v.co.copy()
        k = 1 + jag * (noise3(co.x * 2.1 + seed, co.y * 2.1, co.z * 2.1, seed, 2) - 0.5) * 2
        verts.append((c[0] + co.x * r * k, c[1] + max(co.z, -0.35) * r * squash * k + 0.0, c[2] + co.y * r * k))
    idx = {v: i for i, v in enumerate(bm.verts)}
    faces = [tuple(idx[v] for v in f.verts) for f in bm.faces]
    bm.free()
    # swap axes so that icosphere z is up: (x, z, y) mapping flips handedness -> reverse faces
    faces = [tuple(reversed(f)) for f in faces]
    p.raw(mat, verts, faces, sg=-1)


# ------------------------------------------------------------------------------------------ pieces
def mid_segment():
    p = Piece("tunnel_mid_10m", seed=41, ground_y=0.0, dirt_h=1.6, dirt_amt=0.55, ao_dist=3.0, streak_amt=0.4, under_amt=0.1)
    p.notes = dict(desc="Repeatable 10 m tunnel tube segment (z 0..10). Interior half-width 7.4 (14.8 m), walls to y=3.8, crown y=7.4. Ribs every 2.5 m (phase 1.5 + 2.5k) so it chains seamlessly with portals (12 m tube) and itself. Floor = road_surface (x -7..7). Interior only: bury it in terrain.",
                   length=10.0, interior_half_width=HW, crown=CROWN, lights="light_amber strips at crown x=+-2.7 (some dark), jet fans, cable trays")
    tube_segment(p, 0, 10, [1.5, 4.0, 6.5, 9.0], fans=[(5.0, -2.0)], seed=3, cap_start=True, cap_end=True)
    p.socket("end", (0, 0, 10))
    return p


def concrete_portal(pid="tunnel_portal_concrete", exit_=False, seed=43):
    p = Piece(pid, seed=seed, ground_y=0.0, dirt_h=2.4, dirt_amt=0.55, ao_dist=3.5, streak_amt=0.45)
    p.notes = dict(desc="Concrete tunnel portal: headwall at z=0 facing -Z, 12 m of tube (z 0..12), splayed wing walls. Headwall 27 m wide, 11.5 m high + cornice. Opening 14.8 m wide, crown 7.4 m. Meant to be embedded in a hillside.",
                   opening=[2 * HW, CROWN])
    prof = tube_profile()
    N = 40
    inn = resample(prof, N)
    Wd, Hd = 13.5, 11.5
    outer_path = [(-Wd, 0.0), (-Wd, Hd), (Wd, Hd), (Wd, 0.0)]
    # outer boundary polyline must run left->right like the inner one
    out = resample(outer_path, N)
    rings = frame_rings(inn, out, 8)
    rings3 = [[(x, y, 0.0) for x, y in r] for r in rings]
    mesh_from_rings(p, "concrete", rings3, flip=True)
    # relief: voussoir ring standing proud of the wall
    ring_out = offset_profile(prof, -1.15)
    poly = [q for q in prof[1:-1]] + [q for q in reversed(ring_out[1:-1])]
    p.extrude("concrete_dark", poly, -0.5, 0.15)
    # thin lintel / drip line
    p.bx("concrete", (-Wd - 0.3, Wd + 0.3), (Hd, Hd + 0.9), (-0.9, 1.9), bevel=0.06, sub=2.5)
    p.bx("concrete_dark", (-Wd - 0.35, Wd + 0.35), (Hd + 0.9, Hd + 1.15), (-1.0, 2.0), bevel=0.04, sub=3.0)
    # cornice vent boxes + floodlights + beacons on top
    for x in (-9.0, 9.0):
        p.box("metal_dark", (x, Hd + 1.4, 0.4), (1.6, 0.6, 0.9), bevel=0.03)
        for k in range(5):
            p.bx("metal_dark", (x - 0.7 + k * 0.3, x - 0.55 + k * 0.3), (Hd + 1.2, Hd + 1.65), (-0.06, 0.0))
    for x in (-4.5, 0.0, 4.5):
        p.tube("metal_dark", (x, Hd + 1.15, 0.6), (x, Hd + 1.9, 0.6), 0.04, sides=6)
        p.box("metal_dark", (x, Hd + 2.0, 0.35), (0.7, 0.3, 0.5), rot=(20, 0, 0), bevel=0.03)
        p.box("light_head", (x, Hd + 1.9, 0.08), (0.56, 0.2, 0.03), rot=(20, 0, 0))
    for x in (-Wd - 0.1, Wd + 0.1):
        p.cyl("light_amber", (x, Hd + 1.35, 0.4), 0.15, 0.22, "y", sides=8)
    # hazard jambs beside the opening
    Y, K = (0.95, 0.5, 0.02), (0.03, 0.03, 0.035)
    for s in (-1, 1):
        for k in range(9):
            xa, xb = (HW + 0.15, HW + 0.75) if s > 0 else (-HW - 0.75, -HW - 0.15)
            ya, yb = 0.15 + k * 0.5, 0.15 + (k + 1) * 0.5
            p.quad("hazard", (xa, ya, -0.53), (xa, yb, -0.53), (xb, yb, -0.53), (xb, ya, -0.53), tint=Y if k % 2 == 0 else K) if s < 0 else \
                p.quad("hazard", (xb, ya, -0.53), (xb, yb, -0.53), (xa, yb, -0.53), (xa, ya, -0.53), tint=Y if k % 2 == 0 else K)
    # sign plate above the crown ring
    p.bx("metal_dark", (-4.2, 4.2), (9.2, 10.7), (-0.16, -0.04), bevel=0.03)
    p.bx("paint2", (-4.05, 4.05), (9.35, 10.55), (-0.2, -0.16), tint=(0.1, 0.34, 0.22))
    for k in range(16):
        x = -3.9 + k * 0.5
        p.quad("hazard", (x + 0.5, 9.4, -0.205), (x + 0.5, 9.6, -0.205), (x, 9.6, -0.205), (x, 9.4, -0.205), tint=Y if k % 2 == 0 else K)
    # wing walls (splayed)
    for s in (-1, 1):
        yaw = 65.0 if s > 0 else 115.0
        prof_w = [(0.0, -0.6), (17.0, -0.6), (17.0, 2.2), (0.0, Hd - 0.2)]
        p.extrude("concrete", prof_w, -0.45, 0.45, M=xf((s * (Wd - 0.3), 0, 0.2), (0, yaw, 0)), sub=2.5, bevel=0.03)
        # coping on wing wall (sloped) - beam along top edge
        a0 = (s * (Wd - 0.3), Hd - 0.2 + 0.1, 0.2)
        d = Vector((math.cos(math.radians(yaw)), 0, -math.sin(math.radians(yaw))))
        a1 = Vector(a0) + Vector((d.x * 17.0, 2.2 + 0.1 - (Hd - 0.2 + 0.1), d.z * 17.0))
        p.beam("concrete_dark", a0, a1, 1.0, 0.24, up=(0, 1, 0), bevel=0.02)
    # exposed rebar on the right cornice end (damage)
    for k in range(7):
        p.tube("rebar", (Wd + 0.2 - k * 0.15, Hd + 0.9, 0.2 + (k % 3) * 0.3), (Wd + 0.3 - k * 0.15, Hd + 1.5 + 0.15 * (k % 3), 0.3 + (k % 3) * 0.3), 0.014, sides=5)
    # collision: headwall as boxes around the opening + wings
    p.cbx((-Wd, -HW - 0.0), (0, Hd), (0, 1.0))
    p.cbx((HW, Wd), (0, Hd), (0, 1.0))
    p.cbx((-HW, HW), (CROWN + 0.2, Hd), (0, 1.0))
    if exit_:
        pass
    return p


def finish_tube(p, ribs, fans):
    tube_segment(p, 0, 12, ribs, fans=fans, seed=5)


def nearest_on_poly(pt, poly):
    best, bp = 1e9, None
    for i in range(len(poly) - 1):
        ax, ay = poly[i]
        bx, by = poly[i + 1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1e-9
        t = max(0.0, min(1.0, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / L2))
        qx, qy = ax + dx * t, ay + dy * t
        d = math.hypot(pt[0] - qx, pt[1] - qy)
        if d < best:
            best, bp = d, (qx, qy)
    return best, bp


def rock_portal(pid, seed, exit_=False):
    p = Piece(pid, seed=seed, ground_y=0.0, dirt_h=2.0, dirt_amt=0.35, ao_dist=5.0, noise_amt=0.3, streak_amt=0.25, strata_period=3.2)
    p.notes = dict(desc="Rock tunnel portal in a hillside: rock mass with arched opening, concrete portal ring, 12 m of tube. Entrance: face at z=0 facing -Z, tube z 0..12, rock mass extends to z=17 behind. Rock is `rock_red` (swap material to rock_grey for pine mountains).",
                   opening=[2 * HW, CROWN], rock_height=24)
    prof = tube_profile()
    rng = random.Random(seed)
    ctrl = [(-34.0, -2.5), (-32.0, 3.5), (-29.0, 10.0), (-23.0, 15.5), (-16.0, 20.0), (-8.0, 23.0), (-1.0, 24.5), (6.0, 22.5), (13.0, 20.5), (20.0, 16.0), (26.0, 10.0), (30.0, 4.0), (33.0, -2.5)]

    def ytop(x):
        x = max(ctrl[0][0], min(ctrl[-1][0], x))
        for i in range(len(ctrl) - 1):
            if ctrl[i][0] <= x <= ctrl[i + 1][0]:
                t = (x - ctrl[i][0]) / (ctrl[i + 1][0] - ctrl[i][0])
                y = ctrl[i][1] + (ctrl[i + 1][1] - ctrl[i][1]) * t
                return y + (noise3(x * 0.55, 3.0, 1.0, seed, 4) - 0.5) * 6.0 * (1 if y > 0 else 0)
        return ctrl[-1][1]

    cell = 1.7
    nx = int(68 / cell) + 1
    ny = int(28.5 / cell) + 2
    X = [-34.0 + cell * i for i in range(nx)]
    verts, grid = [], {}
    for i in range(nx):
        for j in range(ny):
            x0, y0 = X[i], -2.5 + cell * j
            x, y = x0, y0
            interior = 0 < i < nx - 1 and 0 < j < ny - 1
            if interior:
                x += (rng.random() - 0.5) * cell * 0.5
                y += (rng.random() - 0.5) * cell * 0.5
            yt = ytop(x0)
            if y > yt:
                y = yt
            inside = abs(x) < HW and y < ceil_y(x)
            d = 99.0
            if inside or (abs(x) < HW + 2.0 and y < CROWN + 2.5):
                d, bp = nearest_on_poly((x, y), prof)
                if inside:
                    x, y = bp
                    d = 0.0
            w = min(1.0, d / 4.0)
            w = w * w * (3 - 2 * w)
            bulge = (noise3(x * 0.15, y * 0.15, 1.0, seed + 3, 3) * 2.6 + noise3(x * 0.5, y * 0.5, 7.0, seed + 9, 2) * 1.0) * w
            grid[(i, j)] = len(verts)
            verts.append((x, y, -bulge))
    faces = []
    for i in range(nx - 1):
        for j in range(ny - 1):
            ids = [grid[(i, j)], grid[(i + 1, j)], grid[(i + 1, j + 1)], grid[(i, j + 1)]]
            cs = [(X[i], -2.5 + cell * j), (X[i + 1], -2.5 + cell * j), (X[i + 1], -2.5 + cell * (j + 1)), (X[i], -2.5 + cell * (j + 1))]
            if all(abs(cx) < HW and cy < ceil_y(cx) for cx, cy in cs):
                continue
            yb = -2.5 + cell * j
            if yb >= max(ytop(X[i]), ytop(X[i + 1])) - 0.05:
                continue
            faces.append(tuple(reversed(ids)))
    p.raw("rock_red", verts, faces, sg=-1, weld=False)
    # top outline for the body
    outl = [verts[grid[(i, min(ny - 1, max(0, int((ytop(X[i]) + 2.5) / cell))))]] for i in range(nx)]
    outl = [(X[i], ytop(X[i]), verts[grid[(i, min(ny - 2, int((ytop(X[i]) + 2.5) / cell)))]][2]) for i in range(nx)]
    zs = [0.0, 3.0, 6.5, 10.5, 14.0, 17.0]
    body = []
    for zj in zs:
        f = zj / zs[-1]
        sx = 1.0 - 0.42 * f ** 0.9
        sy = 1.0 - 0.45 * f ** 1.1
        row = []
        for i, (x, y, z0) in enumerate(outl):
            nn = (noise3(x * 0.2, y * 0.2, zj * 0.2, seed + 5, 3) - 0.5) * 2.0
            yy = (y + 2.5) * sy - 2.5
            if 0 < i < nx - 1:
                yy += nn * 1.4 * f + nn * 0.4
            row.append((x * sx, yy, z0 * (1 - f) + zj if zj > 0 else z0))
        body.append(row)
    mesh_from_rings(p, "rock_red", body, flip=True, flat=True)
    back = body[-1]
    p.raw("rock_red", [(x, y, z) for x, y, z in back], [tuple(reversed(range(len(back))))], sg=-1)
    # portal ring (concrete) around the opening, proud of the rock
    ring_out = offset_profile(prof, -0.95)
    poly = [q for q in prof[1:-1]] + [q for q in reversed(ring_out[1:-1])]
    p.extrude("concrete", poly, -0.55, 0.3, bevel=0.03)
    ring_out2 = offset_profile(prof, -0.4)
    poly2 = [q for q in prof[1:-1]] + [q for q in reversed(ring_out2[1:-1])]
    p.extrude("concrete_dark", poly2, -0.7, -0.5)
    # lamps + beacons over the ring
    for x in (-5.0, 5.0):
        p.tube("metal_dark", (x, ceil_y(x) + 1.3, -0.4), (x, ceil_y(x) + 1.9, -0.7), 0.04, sides=6)
        p.box("metal_dark", (x, ceil_y(x) + 2.0, -0.9), (0.7, 0.3, 0.5), rot=(20, 0, 0), bevel=0.03)
        p.box("light_head", (x, ceil_y(x) + 1.89, -1.16), (0.56, 0.2, 0.03), rot=(20, 0, 0))
    for s in (-1, 1):
        p.cyl("light_amber", (s * (HW + 1.2), 3.4, -0.75), 0.15, 0.2, "z", sides=8)
    # boulders at the base
    for k in range(16):
        side = -1 if k % 2 else 1
        x = side * rng.uniform(9.5, 27)
        icolump(p, "rock_red", (x, -0.2, -rng.uniform(0.8, 5.5)), rng.uniform(0.9, 2.8), seed * 10 + k, squash=0.75, jag=0.3)
    for k in range(6):
        side = -1 if k % 2 else 1
        icolump(p, "rock_red", (side * rng.uniform(8.0, 9.6), -0.1, -rng.uniform(1.0, 3.0)), rng.uniform(0.5, 1.0), seed * 20 + k, squash=0.8)
    return p


def add_tube_to(p, ribs, fans):
    tube_segment(p, 0, 12, ribs, fans=fans, seed=5)


def rot180(p, Lz):
    """Rotate everything built so far by 180 deg about the vertical axis through (0, Lz/2): x -> -x, z -> Lz - z."""
    for a in p.accs.values():
        a.v = [Vector((-v.x, v.y, Lz - v.z)) for v in a.v]
    p.cols = [([Vector((-v.x, v.y, Lz - v.z)) for v in vs], fs) for vs, fs in p.cols]


def retex(p, old, new):
    """Rename a material on all accumulators (e.g. rock_red -> rock_grey)."""
    for k in list(p.accs.keys()):
        a = p.accs[k]
        if a.mat == old:
            del p.accs[k]
            a.mat = new
            a.node = new if a.node == old else a.node
            p.accs[(a.node, new)] = a


def build_all(only=""):
    if only in ("", "tunnel_mid_10m"):
        mid_segment().build()
    if only in ("", "tunnel_portal_concrete"):
        p = concrete_portal()
        add_tube_to(p, [1.0, 3.5, 6.0, 8.5, 11.0], [(6.0, 2.0)])
        p.socket("entrance", (0, 0, 0))
        p.socket("tube_end", (0, 0, 12))
        p.build()
    if only in ("", "tunnel_portal_rock"):
        p = rock_portal("tunnel_portal_rock", 5)
        add_tube_to(p, [1.0, 3.5, 6.0, 8.5, 11.0], [(6.0, 2.0)])
        p.socket("entrance", (0, 0, 0))
        p.socket("tube_end", (0, 0, 12))
        p.build()
    if only in ("", "tunnel_exit"):
        p = rock_portal("tunnel_exit", 9)
        p.notes["desc"] = "Rock tunnel EXIT: tube z 0..12 then the portal face at z=12 facing +Z (leaving the tunnel). Chains after tunnel_mid_10m. Rock mass extends back over the tube (to z=-5)."
        rot180(p, 12.0)
        tube_segment(p, 0, 12, [1.5, 4.0, 6.5, 9.0], fans=[(6.0, -2.0)], seed=6)
        p.socket("exit", (0, 0, 12))
        p.socket("tube_start", (0, 0, 0))
        p.build()
    if only in ("", "tunnel_portal_rock_grey"):
        p = rock_portal("tunnel_portal_rock_grey", 15)
        p.notes["desc"] = "Grey-rock variant of tunnel_portal_rock (pine mountains): face at z=0 facing -Z, 12 m of tube."
        retex(p, "rock_red", "rock_grey")
        add_tube_to(p, [1.0, 3.5, 6.0, 8.5, 11.0], [(6.0, 2.0)])
        p.socket("entrance", (0, 0, 0))
        p.socket("tube_end", (0, 0, 12))
        p.build()
    if only in ("", "tunnel_exit_grey"):
        p = rock_portal("tunnel_exit_grey", 19)
        p.notes["desc"] = "Grey-rock variant of tunnel_exit (pine mountains): tube z 0..12 then the portal face at z=12 facing +Z."
        retex(p, "rock_red", "rock_grey")
        rot180(p, 12.0)
        tube_segment(p, 0, 12, [1.5, 4.0, 6.5, 9.0], fans=[(6.0, -2.0)], seed=6)
        p.socket("exit", (0, 0, 12))
        p.socket("tube_start", (0, 0, 0))
        p.build()
    if only in ("", "tunnel_exit_concrete"):
        p = concrete_portal("tunnel_exit_concrete", seed=47)
        p.notes["desc"] = "Concrete tunnel EXIT: tube z 0..12 then portal face at z=12 facing +Z. Chains after tunnel_mid_10m."
        rot180(p, 12.0)
        tube_segment(p, 0, 12, [1.5, 4.0, 6.5, 9.0], fans=[(6.0, -2.0)], seed=6)
        p.socket("exit", (0, 0, 12))
        p.socket("tube_start", (0, 0, 0))
        p.build()


if __name__ == "__main__":
    build_all(os.environ.get("ONLY", ""))

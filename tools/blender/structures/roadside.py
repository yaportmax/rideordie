"""road_gate, toll_booth_ruined, roadblock_wreck_line."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *
import bmesh

JERSEY = [(-0.30, 0.0), (0.30, 0.0), (0.21, 0.32), (0.125, 0.85), (-0.125, 0.85), (-0.21, 0.32)]
YEL = (0.95, 0.5, 0.02)
BLK = (0.03, 0.03, 0.035)


class Xf:
    """Context manager: everything added to Piece `p` inside the block is transformed by matrix M afterwards."""
    def __init__(self, p, M):
        self.p, self.M = p, M

    def __enter__(self):
        self.snap = {k: len(a.v) for k, a in self.p.accs.items()}
        self.csnap = len(self.p.cols)
        self.ssnap = len(self.p.sockets)
        return self

    def __exit__(self, *a):
        for k, acc in self.p.accs.items():
            s = self.snap.get(k, 0)
            for i in range(s, len(acc.v)):
                acc.v[i] = self.M @ acc.v[i]
        for i in range(self.csnap, len(self.p.cols)):
            vs, fs = self.p.cols[i]
            self.p.cols[i] = ([self.M @ v for v in vs], fs)


def blob(p, mat, c, r, seed=1, sub=1, jag=0.12, tint=None, flat=False):
    """Icosphere ellipsoid with radii r=(rx,ry,rz) centred c."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    verts = []
    for v in bm.verts:
        co = v.co
        k = 1 + jag * (noise3(co.x * 2.3 + seed, co.y * 2.3, co.z * 2.3, seed, 2) - 0.5) * 2
        verts.append((c[0] + co.x * r[0] * k, c[1] + co.y * r[1] * k, c[2] + co.z * r[2] * k))
    idx = {v: i for i, v in enumerate(bm.verts)}
    faces = [tuple(idx[v] for v in f.verts) for f in bm.faces]
    bm.free()
    p.raw(mat, verts, faces, sg=-1 if flat else 0, tint=tint)


def skull(p, c, s=1.0, tint=None):
    x, y, z = c
    blob(p, "bone", (x, y + 0.08 * s, z), (0.42 * s, 0.4 * s, 0.4 * s), seed=3, sub=1, jag=0.05, tint=tint)      # cranium
    p.box("bone", (x, y - 0.33 * s, z - 0.05 * s), (0.5 * s, 0.22 * s, 0.4 * s), tint=tint)                       # jaw block
    for sx in (-1, 1):
        p.box("metal_dark", (x + sx * 0.17 * s, y + 0.02 * s, z - 0.36 * s), (0.2 * s, 0.2 * s, 0.1 * s))        # eye sockets
    p.box("metal_dark", (x, y - 0.13 * s, z - 0.37 * s), (0.09 * s, 0.14 * s, 0.1 * s), rot=(0, 0, 0))           # nose
    for k in range(5):
        p.box("bone", (x + (k - 2) * 0.095 * s, y - 0.42 * s, z - 0.27 * s), (0.07 * s, 0.09 * s, 0.05 * s), tint=(1.0, 0.98, 0.9))


def cloth(p, mat, x0, x1, ytop, ybot, z, nx=5, ny=12, amp=0.12, ph=0.0, tint=None, wave=2.0):
    """Hanging cloth in the XY plane facing -Z (front) with flutter along Z; fixed at the top edge."""
    pts = []
    for j in range(ny + 1):
        v = j / ny
        y = ytop + (ybot - ytop) * v
        for i in range(nx + 1):
            u = i / nx
            zz = z + amp * math.sin(v * wave * math.pi + ph + u * 1.7) * (0.15 + v) * (1.0 if 0 < i else 0.6)
            pts.append((x0 + (x1 - x0) * u, y, zz))
    p.mesh_grid(mat, pts, nx + 1, ny + 1, flip=False, tint=tint)


def box_truss(p, mat, a, b, w, h, panels, chord=0.09, web=0.06, up=(0, 1, 0)):
    """Rectangular truss between points a and b: 4 chords + X webs on all four faces. Section w (lateral) x h (vertical)."""
    a, b = Vector(a), Vector(b)
    d = (b - a)
    rm = look(d, up)
    ex, ey = rm @ Vector((1, 0, 0)), rm @ Vector((0, 1, 0))
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]

    def P(t, c):
        return a + d * t + ex * (c[0] * w / 2) + ey * (c[1] * h / 2)
    for c in corners:
        p.tube(mat, P(0, c), P(1, c), chord, sides=6, smooth=False)
    for i in range(panels + 1):
        t = i / panels
        for k in range(4):
            p.tube(mat, P(t, corners[k]), P(t, corners[(k + 1) % 4]), web, sides=4, smooth=False)
    for i in range(panels):
        t0, t1 = i / panels, (i + 1) / panels
        for k in range(4):
            c0, c1 = corners[k], corners[(k + 1) % 4]
            if i % 2 == 0:
                p.tube(mat, P(t0, c0), P(t1, c1), web, sides=4, smooth=False)
            else:
                p.tube(mat, P(t0, c1), P(t1, c0), web, sides=4, smooth=False)


# =============================================================================================== road_gate
def road_gate():
    p = Piece("road_gate", seed=51, ground_y=0.0, dirt_h=2.0, dirt_amt=0.5, ao_dist=3.0, streak_amt=0.35)
    p.notes = dict(desc="Raider checkpoint arch across the road (origin road centre, depth ~3.4 m along z). Lattice towers at x=+-8.6, truss gantry at y 8.0-9.6 (clear height 8.0 m), big sign board on top, banner poles, floodlights, raised boom barriers. Road (x -7..7) is fully clear.",
                   clear_height=8.0, banner_sockets="banner_L, banner_R", light_sockets="flood_0..3")
    XT = 8.6
    for s in (-1, 1):
        x = s * XT
        p.bx("concrete_dark", (x - 1.55, x + 1.55), (0, 0.55), (-1.55, 1.55), bevel=0.06, sub=1.6)
        lattice_tower(p, "steel_beam", x, 0.0, 0.55, 9.95, 0.95, 0.8, 7, leg=0.11, brace=0.05, sides=4)
        p.bx("metal_dark", (x - 1.0, x + 1.0), (10.45, 10.6), (-1.0, 1.0), bevel=0.02)
        p.box("metal_dark", (x, 10.75, 0), (0.6, 0.28, 0.6), bevel=0.02)
        p.cyl("light_amber", (x, 11.05, 0), 0.24, 0.32, "y", sides=10)
        p.cyl("metal_dark", (x, 11.28, 0), 0.26, 0.06, "y", sides=10)
        # crash barriers (jersey) in front of each tower, road side
        for zc in (-3.2, 3.2):
            xb = s * 7.55
            p.extrude("concrete", [(xb + lat, y) for lat, y in JERSEY], zc - 1.4, zc + 1.4, sub=1.5)
        # tyre stacks + sandbag walls at the tower base
        for k, zz in enumerate((-1.9, 1.9)):
            for lv in range(3):
                p.cyl("rubber", (s * 9.9, 0.2 + lv * 0.36, zz), 0.52, 0.36, "y", sides=12)
                p.cyl("metal_dark", (s * 9.9, 0.2 + lv * 0.36, zz), 0.3, 0.37, "y", sides=8) if lv == 0 else None
        for k in range(6):
            p.box("canvas", (s * (7.95 + (k % 2) * 0.15), 0.2 + (k // 3) * 0.3, -0.5 + k % 3 * 0.5 + 0.0), (0.7, 0.28, 0.4), rot=(0, (k * 23) % 30, 0), bevel=0.06, tint=(0.8, 0.72, 0.55))
        # boom barrier raised
        pivx = s * 7.7
        p.box("metal_dark", (pivx, 0.55, -1.9), (0.4, 1.1, 0.4), bevel=0.03)
        ang = 68
        base = Vector((pivx, 1.1, -1.9))
        dirv = Vector((-s * math.cos(ang * D2R), math.sin(ang * D2R), 0))
        for k in range(7):
            a0 = base + dirv * (k * 0.5)
            a1 = base + dirv * ((k + 1) * 0.5)
            p.beam("paint" if k % 2 == 0 else "hazard", a0, a1, 0.11, 0.11, up=(0, 0, 1), tint=(0.55, 0.05, 0.04) if k % 2 == 0 else (0.85, 0.85, 0.8))
        p.tube("metal_dark", base, base + dirv * -0.5, 0.06, sides=6)
        p.box("metal_dark", tuple(base + dirv * -0.6), (0.3, 0.3, 0.3), rot=(0, 0, 0))
        # hazard band on the tower base
        for k in range(8):
            y0 = 0.6 + k * 0.32
            p.quad("hazard", (x - 1.04, y0, -1.02), (x - 1.04, y0 + 0.32, -1.02), (x + 1.04, y0 + 0.32, -1.02), (x + 1.04, y0, -1.02), tint=YEL if k % 2 == 0 else BLK) if False else None
        # banner pole + tattered banner on the tower top
        p.tube("metal_dark", (x, 10.6, 0.0), (x, 16.2, 0.0), 0.085, sides=8, r2=0.06)
        p.cyl("metal_dark", (x, 16.3, 0.0), 0.11, 0.2, "y", sides=8)
        p.tube("metal_dark", (x, 15.6, 0.0), (x - s * 0.9 * 0 + 0.0, 15.6, -1.6), 0.04, sides=6)
        p.tube("metal_dark", (x, 12.0, 0.0), (x, 12.0, -1.3), 0.04, sides=6)
        cloth(p, "canvas", x - 0.95, x + 0.95, 15.5, 12.1, -1.32, nx=5, ny=14, amp=0.16, ph=0.7 if s > 0 else 2.0, tint=(0.55, 0.07, 0.05))
        p.p = None if False else None
        skull(p, (x, 13.8, -1.6), 0.62, tint=(0.95, 0.9, 0.8))
        p.socket("banner_R" if s < 0 else "banner_L", (x, 13.8, -1.6))
    # gantry truss between the towers
    box_truss(p, "steel_beam", (-XT - 0.6, 8.8, 0.0), (XT + 0.6, 8.8, 0.0), 1.2, 1.6, 24, chord=0.1, web=0.055)
    p.bx("metal_dark", (-XT - 0.9, -XT + 0.9), (7.9, 9.7), (-0.8, 0.8), bevel=0.02) if False else None
    # sign board on top (faces -Z toward approaching traffic)
    zb = -0.55
    p.bx("metal_dark", (-8.6, 8.6), (9.7, 12.2), (zb - 0.06, zb + 0.06), bevel=0.03, sub=2.0)
    p.bx("paint2", (-8.35, 8.35), (9.95, 11.95), (zb - 0.1, zb - 0.06), sub=2.0, tint=(0.62, 0.11, 0.07))
    nb = 34
    bw = 16.7 / nb
    for k in range(nb):
        xa = -8.35 + k * bw
        tt = YEL if k % 2 == 0 else BLK
        for (y0, y1) in ((9.95, 10.3), (11.6, 11.95)):
            p.quad("hazard", (xa, y0, zb - 0.105), (xa, y1, zb - 0.105), (xa + bw, y1, zb - 0.105), (xa + bw, y0, zb - 0.105), tint=tt)
    # big skull emblem + crossed bones in the middle of the sign
    p.bx("metal_dark", (-2.2, 2.2), (10.35, 11.55), (zb - 0.16, zb - 0.1), bevel=0.02)
    p.tube("bone", (-2.9, 10.4, zb - 0.28), (2.9, 11.5, zb - 0.28), 0.12, sides=8)
    p.tube("bone", (2.9, 10.4, zb - 0.28), (-2.9, 11.5, zb - 0.28), 0.12, sides=8)
    for sx in (-2.9, 2.9):
        for sy in (10.4, 11.5):
            blob(p, "bone", (sx, sy, zb - 0.28), (0.17, 0.15, 0.15), seed=2, sub=1, jag=0.05)
    skull(p, (0, 10.97, zb - 0.55), 1.05, tint=(0.95, 0.92, 0.85))
    # struts holding the sign
    for x in (-8.0, -4.0, 0.0, 4.0, 8.0):
        p.beam("steel_beam", (x, 9.6, 0.0), (x, 9.95, zb + 0.3), 0.1, 0.1)
    for x in (-6.0, 6.0):
        p.beam("steel_beam", (x, 9.6, 0.0), (x, 12.2, zb + 0.06), 0.08, 0.08)
    # floodlights on the sign top edge (4)
    for i, x in enumerate((-6.5, -2.2, 2.2, 6.5)):
        p.box("metal_dark", (x, 12.55, zb - 0.3), (0.9, 0.5, 0.5), rot=(-25, 0, 0), bevel=0.03)
        p.box("light_head", (x, 12.42, zb - 0.55), (0.76, 0.36, 0.03), rot=(-25, 0, 0))
        p.tube("metal_dark", (x, 12.2, zb), (x, 12.4, zb - 0.25), 0.04, sides=5)
        p.socket("flood_%d" % i, (x, 12.4, zb - 0.6))
    # hanging work lamps under the gantry
    for x in (-6.0, -3.0, 0.0, 3.0, 6.0):
        p.tube("metal_dark", (x, 8.0, 0.0), (x, 7.25, 0.0), 0.02, sides=4)
        p.cyl("metal_dark", (x, 7.15, 0.0), 0.16, 0.16, "y", sides=8, r2=0.1)
        p.cyl("light_head", (x, 7.02, 0.0), 0.11, 0.1, "y", sides=8)
    # chain + spikes along the gantry
    for k in range(20):
        x = -8.3 + k * 0.87
        p.cyl("spike", (x, 7.86, 0.55), 0.045, 0.28, "y", sides=5, r2=0.005)
    # collision
    for s in (-1, 1):
        p.cbx((s * XT - 1.0, s * XT + 1.0), (0, 10.6), (-1.0, 1.0))
        p.cbx((s * XT - 1.55, s * XT + 1.55), (0, 0.6), (-1.55, 1.55))
        xb = s * 7.55
        p.cbx((xb - 0.3, xb + 0.3), (0, 0.85), (-4.6, -1.8))
        p.cbx((xb - 0.3, xb + 0.3), (0, 0.85), (1.8, 4.6))
    p.cbx((-9.4, 9.4), (8.0, 9.6), (-0.7, 0.7))
    p.cbx((-8.6, 8.6), (9.7, 12.2), (-0.8, 0.0))
    return p


# =============================================================================================== toll_booth_ruined
def booth(p, x, z, broken=0, roof_collapse=0.0, tint=1.0):
    """Toll booth on an island: box 2.0 (x) x 2.7 (y) x 3.0 (z), origin at the floor centre."""
    W, H, D = 2.0, 2.7, 3.0
    p.bx("concrete", (x - W / 2, x + W / 2), (0.3, 0.55), (z - D / 2, z + D / 2), bevel=0.03, sub=1.5)                      # plinth
    # frame posts
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.bx("steel_beam", (x + sx * W / 2 - 0.08, x + sx * W / 2 + 0.08), (0.55, H), (z + sz * D / 2 - 0.08, z + sz * D / 2 + 0.08))
    # walls: lower solid panel (concrete) and upper window band (glass / broken)
    p.bx("concrete", (x - W / 2, x + W / 2), (0.55, 1.1), (z - D / 2, z + D / 2), bevel=0.02, sub=1.5, skip=("py",) if False else (), tint=tint)
    p.bx("paint2", (x - W / 2 - 0.01, x + W / 2 + 0.01), (0.55, 1.1), (z - D / 2 + 0.3, z + D / 2 - 0.3), tint=(0.5, 0.42, 0.28))
    for sx in (-1, 1):   # side windows
        for k in range(2):
            zc = z - D / 2 + 0.75 + k * 1.5
            if (k + (0 if sx > 0 else 1) + broken) % 3 != 0:
                p.box("glass", (x + sx * W / 2, 1.75, zc), (0.02, 1.0, 1.25))
            else:
                p.box("metal_dark", (x + sx * W / 2, 1.75, zc), (0.03, 1.0, 1.25))   # smashed: dark void
    for sz in (-1, 1):
        if (broken + sz) % 2 == 0:
            p.box("metal_dark", (x, 1.75, z + sz * D / 2), (1.7, 1.0, 0.03))
        else:
            p.box("glass", (x, 1.75, z + sz * D / 2), (1.7, 1.0, 0.02))
    # roof slab
    yr = H + 0.08
    if roof_collapse > 0:
        p.box("concrete", (x, yr - roof_collapse * 0.5, z), (W + 0.5, 0.18, D + 0.5), rot=(4 * roof_collapse, 0, 9 * roof_collapse), bevel=0.02, tint=0.9)
    else:
        p.box("concrete", (x, yr, z), (W + 0.5, 0.18, D + 0.5), bevel=0.02, sub=1.5)
    # counter + window sill on the lane side
    return p


def toll_booth():
    p = Piece("toll_booth_ruined", seed=61, ground_y=0.0, dirt_h=2.0, dirt_amt=0.5, ao_dist=3.5, streak_amt=0.4, noise_amt=0.32)
    L = 14.0
    p.notes = dict(desc="Ruined toll plaza: canopy over the road (z 1..13, clear height 5.1 m), two islands with booths at x=+-3.3; -X outer lane and the centre lane are open, +X outer lane is blocked by the collapsed canopy corner. Origin = road centre at the start of the piece.",
                   open_lanes="centre x -2.4..2.4 (4.8 m) and -X lane x -7..-4.1", blocked_lane="+X lane x 4.1..7 under the collapsed canopy",
                   clear_height=5.1)
    # islands
    for s in (-1, 1):
        x = s * 3.3
        p.bx("concrete_dark", (x - 0.85, x + 0.85), (0, 0.3), (1.0, 13.0), bevel=0.06, sub=1.6)
        for k in range(12):
            p.quad("hazard", (x - 0.7, 0.305, 1.05 + k * 0.5), (x - 0.7, 0.305, 1.35 + k * 0.5), (x - 0.5, 0.305, 1.35 + k * 0.5), (x - 0.5, 0.305, 1.05 + k * 0.5), tint=YEL if k % 2 == 0 else BLK) if False else None
        # nose bollards
        for zz in (1.15, 12.85):
            p.cyl("metal_dark", (x, 0.75, zz), 0.14, 0.9, "y", sides=8)
            p.cyl("hazard", (x, 0.9, zz), 0.15, 0.3, "y", sides=8, tint=YEL)
    booth(p, -3.3, 4.2, broken=0)
    booth(p, -3.3, 9.8, broken=1)
    booth(p, 3.3, 4.2, broken=2, roof_collapse=0.9)
    booth(p, 3.3, 9.8, broken=1, roof_collapse=0.5)
    # canopy: main beams along x, joists, slab (left part intact with holes, right part collapsed)
    YB, YT = 5.1, 6.1
    for z in (3.0, 11.0):
        p.bx("concrete", (-9.0, 3.8), (YB, YT), (z - 0.4, z + 0.4), bevel=0.04, sub=2.5)
    # canopy slab (intact left half: with missing panels)
    panels = []
    for i in range(7):
        x0 = -9.0 + i * (12.8 / 7)
        x1 = x0 + 12.8 / 7
        for j in range(5):
            z0 = 1.0 + j * 2.4
            z1 = z0 + 2.4
            missing = (i, j) in ((1, 1), (2, 3), (4, 2), (5, 0), (0, 4))
            if missing:
                continue
            p.bx("concrete", (x0 + 0.02, x1 - 0.02), (YT, YT + 0.5), (z0 + 0.02, z1 - 0.02), bevel=0.03, sub=2.0, tint=1.0 - 0.06 * ((i + j) % 3))
    # ceiling soffit strips + rebar / dangling cables
    for (i, j) in ((1, 1), (2, 3), (4, 2), (5, 0), (0, 4)):
        x0 = -9.0 + i * (12.8 / 7) + 0.9
        z0 = 1.0 + j * 2.4 + 1.2
        for k in range(6):
            p.tube("rebar", (x0 + (k - 3) * 0.2, YT + 0.05, z0 + (k % 2) * 0.3), (x0 + (k - 3) * 0.24, YT - 1.1 - 0.2 * (k % 3), z0 + (k % 2) * 0.4), 0.012, sides=4)
        p.tube("metal_dark", (x0 + 0.3, YT, z0), (x0 + 0.7, YT - 1.6, z0 + 0.2), 0.025, sides=4)
    # columns: island columns + outer left columns; right ones broken
    for s in (-1, 1):
        x = s * 3.3
        for z in (3.0, 11.0):
            if s > 0 and z == 3.0:
                p.bx("concrete", (x - 0.4, x + 0.4), (0.55, 2.6), (z - 0.4, z + 0.4), bevel=0.03, sub=1.5)             # snapped stump
                for k in range(6):
                    p.tube("rebar", (x - 0.3 + k * 0.12, 2.6, z - 0.25 + (k % 2) * 0.4), (x - 0.3 + k * 0.12 + 0.05, 3.5 + 0.2 * (k % 3), z - 0.2 + (k % 2) * 0.4), 0.014, sides=5)
            else:
                p.bx("concrete", (x - 0.4, x + 0.4), (0.55, YB), (z - 0.4, z + 0.4), bevel=0.03, sub=1.5)
    for z in (3.0, 11.0):
        p.bx("concrete", (-8.6, -7.8), (0, YB), (z - 0.4, z + 0.4), bevel=0.03, sub=1.5)
        p.bx("concrete", (-8.7, -7.7), (0, 0.4), (z - 0.5, z + 0.5), bevel=0.03)
    # right canopy beam remnant + collapsed slab lying diagonally on the +X lane
    p.bx("concrete", (3.8, 4.6), (YB, YT), (2.6, 3.4), bevel=0.04)     # torn beam stub
    p.bx("concrete", (3.8, 9.0), (YB, YT), (10.6, 11.4), bevel=0.04, sub=2.5, tint=0.9) if False else None
    Mslab = xf((6.6, 2.6, 8.0), (0, 0, 24))            # sloping slab, high edge toward the island (x low)
    with Xf(p, Mslab):
        p.bx("concrete", (-2.8, 2.8), (-0.25, 0.25), (-4.6, 4.6), bevel=0.04, sub=2.0, tint=0.88)
    with Xf(p, xf((5.8, 0.55, 3.0), (0, 20, -8))):
        p.bx("concrete", (-1.5, 1.5), (-0.2, 0.2), (-1.6, 1.6), bevel=0.03, sub=2.0, tint=0.92)
    # rebar tangle poking out of the collapsed slab
    rr = random.Random(5)
    for k in range(22):
        x = rr.uniform(4.2, 8.6)
        z = rr.uniform(3.3, 12.6)
        y = 2.6 - (x - 4.0) * 0.44 + 0.3
        p.tube("rebar", (x, max(y, 0.3), z), (x + rr.uniform(-0.6, 0.6), max(y, 0.3) + rr.uniform(0.3, 1.0), z + rr.uniform(-0.5, 0.5)), 0.012, sides=4)
    # debris chunks on the ground
    for k in range(14):
        x = rr.choice([rr.uniform(4.2, 8.0), rr.uniform(-8.5, -4.5), rr.uniform(-2.0, 2.0)])
        z = rr.uniform(1.5, 12.5)
        s = rr.uniform(0.3, 0.9)
        p.box("concrete", (x, s * 0.3, z), (s * 1.3, s * 0.6, s), rot=(rr.uniform(-15, 15), rr.uniform(0, 90), rr.uniform(-12, 12)), bevel=0.02, tint=rr.uniform(0.7, 1.0))
    # lane signals hanging from the intact canopy beam over each lane
    for lane_x, kind in ((-5.5, "x"), (-1.5, "arrow"), (1.5, "dead"), (5.5, "dead")):
        for zsig in (2.55,):
            if lane_x > 3:
                continue
            p.tube("metal_dark", (lane_x, YB, zsig), (lane_x, YB - 0.7, zsig), 0.03, sides=5)
            p.box("metal_dark", (lane_x, YB - 1.05, zsig), (0.9, 0.7, 0.24), bevel=0.02)
            p.box("light_tail" if kind == "x" else ("light_green" if kind == "arrow" else "metal_dark"), (lane_x, YB - 1.05, zsig - 0.13), (0.62, 0.5, 0.02))
    # broken boom barrier lying across the -X lane
    p.beam("paint", (-7.0, 1.05, 7.0), (-4.2, 0.88, 7.4), 0.13, 0.13, tint=(0.55, 0.05, 0.04))
    for k in range(5):
        a = Vector((-7.0, 1.05, 7.0)).lerp(Vector((-4.2, 0.88, 7.4)), (k + 0.5) / 5.0 + 0.0)
        if k % 2:
            p.box("hazard", tuple(a), (0.48, 0.135, 0.135), rot=(0, -8, 0), tint=(0.85, 0.85, 0.8))
    p.tube("metal_dark", (-7.0, 1.05, 7.0), (-7.0, 0.3, 7.0), 0.07, sides=6)
    # cable spilling from the canopy + toll gate fee sign remnants
    for k in range(4):
        x = -6.0 + k * 1.2
        p.tube("metal_dark", (x, YB, 12.0), (x + 0.3, 3.2 - k * 0.3, 12.3), 0.02, sides=4)
    # collision
    p.cbx((-9.0, 3.8), (YB, YT + 0.5), (1.0, 13.0))
    for z in (3.0, 11.0):
        p.cbx((-8.7, -7.7), (0, YB), (z - 0.5, z + 0.5))
        p.cbx((2.9, 3.7), (0, YB), (z - 0.4, z + 0.4)) if z == 11.0 else None
        p.cbx((-3.7, -2.9), (0, YB), (z - 0.4, z + 0.4))
    p.cbx((-4.15, -2.45), (0, 0.3), (1.0, 13.0))
    p.cbx((2.45, 4.15), (0, 0.3), (1.0, 13.0))
    for zc in (4.2, 9.8):
        p.cbx((-4.3, -2.3), (0.3, 2.9), (zc - 1.5, zc + 1.5))
        p.cbx((2.3, 4.3), (0.3, 2.9), (zc - 1.5, zc + 1.5))
    p.cbeam((4.2, 3.1, 8.0), (8.9, 0.6, 8.0), 9.2, 0.7, up=(0, 0, 1)) if False else None
    p.chull([(4.0, 3.1, 3.2), (4.0, 3.1, 12.6), (8.9, 0.3, 3.2), (8.9, 0.3, 12.6), (4.0, 2.4, 3.2), (4.0, 2.4, 12.6), (8.9, 0.0, 3.2), (8.9, 0.0, 12.6)])
    return p


# =============================================================================================== roadblock_wreck_line
def wreck_car(p, x, z, yaw, kind="sedan", roll=0.0, pitch=0.0, mat="rust", missing_wheels=(), burnt=0.5, y=0.0, seed=1):
    """Low-poly wrecked car (loft body) placed at (x, z) with yaw about Y; roll about the long axis."""
    rr = random.Random(seed)
    if kind == "sedan":
        Lc, hw, belt, roof, zc0, zc1 = 4.6, 0.92, 0.95, 1.45, -1.05, 0.55
    elif kind == "pickup":
        Lc, hw, belt, roof, zc0, zc1 = 5.3, 0.98, 1.05, 1.75, 0.0, 1.35
    elif kind == "van":
        Lc, hw, belt, roof, zc0, zc1 = 5.0, 0.98, 1.0, 2.05, -2.0, 1.55
    else:
        Lc, hw, belt, roof, zc0, zc1 = 4.2, 0.9, 0.9, 1.3, -0.9, 0.6
    n = 13
    stations = [-Lc / 2 + Lc * i / (n - 1) for i in range(n)]
    rings = []
    for zs in stations:
        t = (zs + Lc / 2) / Lc            # 0 rear .. 1 front
        endk = min(1.0, 4.0 * t, 4.0 * (1 - t) + 0.0)
        wb = hw * (0.78 + 0.22 * min(1.0, 5 * t, 5 * (1 - t)))
        yb = 0.32 + 0.1 * (1 - min(1.0, 6 * t, 6 * (1 - t)))
        yb_belt = belt * (0.75 + 0.25 * min(1.0, 4 * t, 4.5 * (1 - t))) - (0.1 if t > 0.86 else 0) - (0.06 if t > 0.94 else 0)
        # hood slope at the front, cabin in the middle
        if zc0 <= zs <= zc1:
            yr = roof
            wr = wb * 0.78
        else:
            k = 0.0
            if zs > zc1:
                k = min(1.0, (zs - zc1) / 0.8)
            if zs < zc0:
                k = min(1.0, (zc0 - zs) / 0.7)
            yr = roof + (yb_belt + 0.03 - roof) * k
            wr = wb * (0.78 + 0.2 * k)
        rings.append([(-wb, yb, zs), (wb, yb, zs), (wb, yb_belt, zs), (wr, yr, zs), (-wr, yr, zs), (-wb, yb_belt, zs)])
    # burnt/rusty variation is baked into vertex colours via tint (dark for burnt)
    burn = (0.32, 0.29, 0.27) if burnt > 0.6 else (0.58, 0.55, 0.5)
    M = xf((x, y, z), (pitch, yaw, roll))
    with Xf(p, M):
        p.loft(mat, rings, flat=False, sub=1.0, tint=burn if mat != "rust" else (0.85, 0.75, 0.7))
        # window voids on the cabin
        for sx in (-1, 1):
            ra, rb = None, None
            i0 = min(range(n), key=lambda i: abs(stations[i] - (zc0 - 0.1)))
            i1 = min(range(n), key=lambda i: abs(stations[i] - (zc1 + 0.1)))
            for i in range(i0, i1):
                a0, a1 = rings[i], rings[i + 1]
                sidea = (a0[2], a0[3]) if sx > 0 else (a0[5], a0[4])
                sideb = (a1[2], a1[3]) if sx > 0 else (a1[5], a1[4])
                def lp(pair, t):
                    return (pair[0][0] + (pair[1][0] - pair[0][0]) * t, pair[0][1] + (pair[1][1] - pair[0][1]) * t, pair[0][2])
                q = [lp(sidea, 0.18), lp(sidea, 0.86), lp(sideb, 0.86), lp(sideb, 0.18)]
                q = [(v[0] + sx * 0.012, v[1], v[2]) for v in q]
                if (i + (0 if sx > 0 else 1)) % 4 == 3:
                    continue
                p.quad("metal_dark", *(q if sx > 0 else q[::-1]))
        # windshield (front) + rear glass voids
        rf = rings[min(range(n), key=lambda i: abs(stations[i] - zc1))]
        # wheels
        wz = [(-Lc * 0.31, 0), (Lc * 0.32, 1)]
        idx = 0
        for wi, (wzp, front) in enumerate(wz):
            for sx in (-1, 1):
                if idx in missing_wheels:
                    idx += 1
                    continue
                cx = sx * (hw * 0.95)
                p.cyl("rubber", (cx, 0.34, wzp), 0.34, 0.24, "x", sides=12, tint=(0.6, 0.6, 0.6))
                p.cyl("metal_dark", (cx + sx * 0.12, 0.34, wzp), 0.2, 0.05, "x", sides=8)
                idx += 1
        # bumpers
        p.box("metal_dark", (0, 0.45, Lc / 2 - 0.02), (hw * 2 - 0.1, 0.22, 0.18), rot=(0, 0, rr.uniform(-4, 4)), bevel=0.02)
        p.box("metal_dark", (0, 0.45, -Lc / 2 + 0.02), (hw * 2 - 0.1, 0.22, 0.16), rot=(0, 0, rr.uniform(-6, 6)), bevel=0.02)
        # open hood / door panels
        p.box(mat, (-hw * 0.6, belt + 0.25, Lc * 0.28), (hw * 1.0, 0.05, 1.2), rot=(-38, 0, 8), tint=burn if mat != "rust" else (0.8, 0.7, 0.65))
        p.box(mat, (hw + 0.28, 0.75, -0.2), (0.05, 0.6, 1.0), rot=(0, 0, -50), tint=burn if mat != "rust" else (0.8, 0.7, 0.65))
        # exhaust stub + spare
        p.tube("metal_dark", (0.3, 0.32, -Lc / 2 - 0.25), (0.3, 0.32, -Lc / 2 + 0.6), 0.04, sides=6)
        p.cbox((0, 0.85, 0), (hw * 2, 1.4, Lc))
    return p


def sandbags(p, x, z, n=8, yaw=0):
    for k in range(n):
        row = k // 4
        col = k % 4
        p.box("canvas", (x + (col - 1.5) * 0.62 + (row % 2) * 0.3, 0.16 + row * 0.27, z), (0.6, 0.26, 0.38), rot=(0, yaw + (k * 13) % 17, 0), bevel=0.07, tint=(0.75, 0.68, 0.5))


def drum(p, x, z, tint=(0.45, 0.16, 0.08), fallen=False):
    if fallen:
        p.cyl("rust", (x, 0.3, z), 0.3, 0.9, "x", sides=10, tint=tint)
    else:
        p.cyl("rust", (x, 0.45, z), 0.29, 0.9, "y", sides=10, tint=tint)
        for yy in (0.2, 0.7):
            p.cyl("metal_dark", (x, yy, z), 0.305, 0.05, "y", sides=10)


def roadblock():
    p = Piece("roadblock_wreck_line", seed=71, ground_y=0.0, dirt_h=1.5, dirt_amt=0.5, ao_dist=2.5, streak_amt=0.3, noise_amt=0.35)
    p.notes = dict(desc="Raider roadblock: a line of wrecked cars, jersey barriers, sandbags, tyres and drums across the road (x -7..7, depth ~8 m, z 0..8) with a gap. The gap is x in [0.4, 4.8] (4.4 m wide, centre x=2.6); mirror with scale.x=-1 for a gap on the other side (or rotate 180 deg about Y). Socket `gap_center`.",
                   gap=[0.4, 4.8], gap_center=[2.6, 0, 4])
    # burnt ground patches
    for (x, z, r) in ((-4.0, 4.2, 2.4), (5.9, 4.0, 1.8), (-1.2, 3.5, 1.2)):
        pts = [(x + r * math.cos(a) * (0.8 + 0.25 * math.sin(3 * a + x)), 0.012, z + r * math.sin(a) * (0.8 + 0.25 * math.cos(2 * a))) for a in [k * math.pi / 6 for k in range(12)]]
        p.raw("metal_dark", pts + [(x, 0.012, z)], [(12, (i + 1) % 12, i) for i in range(12)], tint=(0.5, 0.5, 0.5), sg=-1)
    # left cluster (x -7 .. -0.6)
    wreck_car(p, -5.0, 3.6, 82, "sedan", mat="paint", burnt=0.3, missing_wheels=(1, 2), seed=3)
    wreck_car(p, -2.6, 4.7, -14, "pickup", mat="rust", missing_wheels=(0,), seed=4)
    wreck_car(p, -5.6, 6.7, 168, "coupe", roll=180, y=1.35, mat="rust", missing_wheels=(), seed=5)
    # right cluster (x 5.1 .. 8.4, beside the gap): overturned van on its side along the road + a rusty sedan
    # (the gap x 0.4..4.8 is kept completely clear - visuals and collision - with a 0.25 m margin: x 0.15..5.05)
    wreck_car(p, 7.25, 3.3, 8, "van", roll=90, y=1.0, mat="paint", burnt=0.8, missing_wheels=(1,), seed=6)
    wreck_car(p, 7.0, 7.4, 14, "sedan", mat="rust", missing_wheels=(2, 3), seed=7)
    # jersey barriers: slanted, some knocked over
    def jersey(x, z, yaw, L=3.0, roll=0.0, yy=0.0):
        with Xf(p, xf((x, yy, z), (0, yaw, roll))):
            p.extrude("concrete", [(lat, y) for lat, y in JERSEY], -L / 2, L / 2, sub=1.5)
            p.cbox((0, 0.42, 0), (0.6, 0.85, L))
    jersey(-0.7, 2.6, 8, roll=0)
    jersey(-6.6, 1.0, 96)
    jersey(6.0, 0.9, -20)
    jersey(-1.55, 8.2, 80, roll=0)
    jersey(-4.2, 9.0, 20, roll=65, yy=0.28)
    # hazard barricade boards (A-frame) at the gap
    for x, z, yaw in ((-0.95, 0.2, 12), (6.15, -0.4, -18)):
        with Xf(p, xf((x, 0, z), (0, yaw, 0))):
            for sx in (-1, 1):
                p.beam("metal_dark", (sx * 0.9, 0, 0), (sx * 0.75, 1.15, 0), 0.06, 0.06)
            for k in range(2):
                y0 = 0.6 + k * 0.32
                for m in range(6):
                    p.box("hazard", (-0.75 + m * 0.3 + 0.15, y0 + 0.1, -0.02), (0.3, 0.2, 0.03), tint=YEL if (m + k) % 2 == 0 else BLK)
            p.cbox((0, 0.6, 0), (1.9, 1.2, 0.2))
    # tyre stacks + drums + sandbags
    for (x, z, n) in ((-1.4, 1.2, 4), (8.0, 1.0, 3), (-7.0, 7.2, 4), (-2.6, 9.1, 3)):
        for lv in range(n):
            p.cyl("rubber", (x + 0.04 * (lv % 2), 0.19 + lv * 0.38, z), 0.52, 0.38, "y", sides=12)
        p.cbox((x, n * 0.19, z), (1.05, n * 0.38, 1.05))
    for (x, z, f) in ((-0.3, 4.6, False), (-0.75, 5.4, True), (5.55, 5.5, False), (5.6, 9.2, False), (-3.4, 1.6, True), (-6.9, 3.2, False)):
        drum(p, x, z, fallen=f, tint=(0.4 + 0.1 * ((x * 7) % 1), 0.15, 0.08))
    sandbags(p, -1.75, 2.1, n=8, yaw=10)
    sandbags(p, 6.55, 9.3, n=8, yaw=-8)
    p.cbx((-2.55, -0.95), (0, 0.6), (1.9, 2.35))
    p.cbx((5.75, 7.35), (0, 0.6), (9.1, 9.5))
    # razor / barbed wire coil on the barrier line (rings)
    for x, z in ((-0.7, 2.6), (-1.55, 8.2)):
        for k in range(6):
            a = k * 1.1
            p.tube("spike", (x + 0.2 * math.cos(a), 1.0 + 0.05 * k, z + 0.2 * math.sin(a)), (x + 0.2 * math.cos(a + 1.1), 1.0 + 0.05 * (k + 1), z + 0.2 * math.sin(a + 1.1)), 0.02, sides=4, smooth=False)
    p.socket("gap_center", (2.6, 0.0, 4.0))
    return p


# =============================================================================================== roadblock modules
# The game composes a roadblock from these modules: they fill the road only beyond RB_SOFT (5.2 m) from the gap centre
# (the clean 4.4 m gap + the breakable-barricade strips stay empty). Each module is road-aligned, centred on x=0 with a hard
# half-width `hw` (visuals and collision never exceed |x| <= hw), wreck line body around z 1..7 (barricade line at z=3.5).
def _burn(p, x, z, r):
    pts = [(x + r * math.cos(a) * (0.8 + 0.25 * math.sin(3 * a + x)), 0.012, z + r * math.sin(a) * (0.8 + 0.25 * math.cos(2 * a))) for a in [k * math.pi / 6 for k in range(12)]]
    p.raw("metal_dark", pts + [(x, 0.012, z)], [(12, (i + 1) % 12, i) for i in range(12)], tint=(0.5, 0.5, 0.5), sg=-1)


def _jersey(p, x, z, yaw, L=3.0, roll=0.0, yy=0.0, col=True):
    with Xf(p, xf((x, yy, z), (0, yaw, roll))):
        p.extrude("concrete", [(lat, y) for lat, y in JERSEY], -L / 2, L / 2, sub=1.5)
        if col:
            p.cbox((0, 0.42, 0), (0.6, 0.85, L))


def _tyres(p, x, z, n, col=True):
    for lv in range(n):
        p.cyl("rubber", (x + 0.04 * (lv % 2), 0.19 + lv * 0.38, z), 0.52, 0.38, "y", sides=12)
    if col:
        p.cbox((x, n * 0.19, z), (1.05, n * 0.38, 1.05))


def _wire(p, x, z, y=1.0, n=6):
    for k in range(n):
        a = k * 1.1
        p.tube("spike", (x + 0.2 * math.cos(a), y + 0.05 * k, z + 0.2 * math.sin(a)), (x + 0.2 * math.cos(a + 1.1), y + 0.05 * (k + 1), z + 0.2 * math.sin(a + 1.1)), 0.02, sides=4, smooth=False)


def rb_module_car():
    """4.5 m module: burnt coupe lying across the road + jersey barrier behind + tyres + drums."""
    hw = 2.4
    p = Piece("rb_wreck_car", seed=81, ground_y=0.0, dirt_h=1.5, dirt_amt=0.5, ao_dist=2.5, streak_amt=0.3, noise_amt=0.35)
    p.notes = dict(desc="Roadblock module (%.1f m wide, x -%.2f..%.2f, road-aligned, origin road level at the module centre line z=0). Burnt coupe across the road, jersey barrier, tyres, drums. Visuals + collision never exceed |x| <= hw." % (hw * 2, hw, hw), hw=hw)
    _burn(p, 0.2, 3.4, 1.8)
    wreck_car(p, 0.0, 3.3, 90, "coupe", mat="rust", burnt=0.9, missing_wheels=(0, 3), seed=11)
    p.cbx((-hw + 0.05, hw - 0.05), (0.0, 1.35), (2.4, 4.2))
    _jersey(p, -0.55, 6.3, 88, L=3.0)
    _tyres(p, 1.55, 6.1, 3)
    drum(p, -1.65, 1.5, tint=(0.45, 0.16, 0.08))
    drum(p, 1.2, 1.2, fallen=True, tint=(0.36, 0.2, 0.1))
    _wire(p, -0.55, 6.3, y=0.95)
    p.socket("hw", (hw, 0, 0))
    return p


def rb_module_van():
    """5.0 m module: van on its side lying across the road + sandbags + drums."""
    hw = 2.8
    p = Piece("rb_wreck_van", seed=82, ground_y=0.0, dirt_h=1.5, dirt_amt=0.5, ao_dist=2.5, streak_amt=0.3, noise_amt=0.35)
    p.notes = dict(desc="Roadblock module (%.1f m wide, x -%.2f..%.2f, road-aligned). Overturned van on its side across the road, sandbags, drums, tyres. Visuals + collision never exceed |x| <= hw." % (hw * 2, hw, hw), hw=hw)
    _burn(p, -0.4, 3.6, 2.1)
    wreck_car(p, 0.0, 2.35, 90, "van", pitch=90, y=0.99, mat="paint", burnt=0.8, missing_wheels=(1,), seed=12)
    p.cbx((-hw + 0.05, hw - 0.05), (0.0, 1.95), (2.35, 4.45))
    sandbags(p, -0.9, 1.6, n=8, yaw=4)
    p.cbx((-1.95, 0.4), (0, 0.6), (1.4, 1.8))
    drum(p, 1.7, 1.5, tint=(0.4, 0.15, 0.08))
    drum(p, 1.9, 6.0, tint=(0.3, 0.3, 0.12))
    _tyres(p, -1.5, 6.2, 2)
    p.socket("hw", (hw, 0, 0))
    return p


def rb_module_small():
    """2.4 m module: short jersey barrier across + stacked tyres + drum + razor wire."""
    hw = 1.2
    p = Piece("rb_wreck_small", seed=83, ground_y=0.0, dirt_h=1.5, dirt_amt=0.5, ao_dist=2.5, streak_amt=0.3, noise_amt=0.35)
    p.notes = dict(desc="Narrow roadblock module (%.1f m wide, x -%.2f..%.2f, road-aligned): jersey barrier across the road, tyre stack, drum, razor wire. Visuals + collision never exceed |x| <= hw." % (hw * 2, hw, hw), hw=hw)
    _jersey(p, 0.0, 3.4, 90, L=2.3)
    _wire(p, -0.3, 3.4, y=0.95)
    _tyres(p, 0.45, 5.6, 3)
    drum(p, -0.55, 5.9, tint=(0.42, 0.16, 0.08))
    drum(p, -0.5, 1.6, fallen=True, tint=(0.33, 0.22, 0.1))
    p.socket("hw", (hw, 0, 0))
    return p


if __name__ == "__main__":
    only = os.environ.get("ONLY", "")
    if only in ("", "road_gate"):
        road_gate().build()
    if only in ("", "toll_booth_ruined"):
        toll_booth().build()
    if only in ("", "roadblock_wreck_line"):
        roadblock().build()
    if only in ("", "rb_modules"):
        rb_module_car().build()
        rb_module_van().build()
        rb_module_small().build()

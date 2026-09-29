"""watchtower + shanty_hut + raider_camp_tent (fork B1)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_outpost_common import *
from bld_outpost_diner import dune


# ------------------------------------------------------------------------------------------------ raider props
def skull(p, c, s=1.0, yaw=0.0, jaw=True):
    """Crude low-poly skull (bone) with dark eye/nose sockets. Faces +Z (after yaw)."""
    x, y, z = c
    M = xf((x, y, z), (0, yaw, 0))
    def build():
        p.box("bone", (0, 0.13 * s, 0), (0.30 * s, 0.24 * s, 0.32 * s), bevel=0.05 * s, bsegs=1)
        p.box("bone", (0, -0.03 * s, 0.07 * s), (0.20 * s, 0.10 * s, 0.20 * s))
        if jaw:
            p.box("bone", (0, -0.11 * s, 0.05 * s), (0.17 * s, 0.05 * s, 0.17 * s), tint=0.85)
        for sx in (-1, 1):
            p.box("metal_dark", (sx * 0.075 * s, 0.11 * s, 0.155 * s), (0.08 * s, 0.075 * s, 0.05 * s))
        p.box("metal_dark", (0, 0.0, 0.17 * s), (0.04 * s, 0.05 * s, 0.05 * s))
    xform_block(p, M, build)


def spike(p, base, tip, r=0.05, mat="spike"):
    p.tube(mat, base, tip, r, sides=5, r2=0.005, smooth=False)


def banner(p, ox, oy, oz, w, h, tint=(0.75, 0.12, 0.08), nu=3, nv=5, amp=0.12, facing=1, seed=1, ragged=True):
    """Hanging rag banner: top-left at (ox,oy,oz), width along +x, hangs down -y, waves in z. canvas double-sided."""
    rr = random.Random(seed)
    pts = []
    for j in range(nv + 1):
        for i in range(nu + 1):
            t = i / nu
            v = j / nv
            y = oy - h * v
            if ragged and j == nv:
                y += h * 0.16 * (i % 2)
            pts.append((ox + w * t, y, oz + amp * math.sin(v * 5.0 + t * 3.0 + seed) * (0.3 + v)))
    p.mesh_grid("canvas", pts, nu + 1, nv + 1, tint=tint)


def flame(p, c, s=1.0):
    x, y, z = c
    for (dx, dz, hh, r) in ((0, 0, 0.55, 0.16), (0.12, 0.05, 0.38, 0.11), (-0.1, -0.08, 0.42, 0.12)):
        p.tube("light_amber", (x + dx * s, y, z + dz * s), (x + dx * s * 0.8, y + hh * s, z + dz * s * 0.8), r * s, sides=5, r2=0.01, smooth=False)


def rock(p, c, s, seed=0):
    rr = random.Random(seed)
    p.box("rock_grey", c, s, rot=(rr.uniform(-8, 8), rr.uniform(0, 90), rr.uniform(-8, 8)), flat=True, tint=rr.uniform(0.7, 1.0))


# ================================================================================================= WATCHTOWER
def watchtower():
    p = Piece("watchtower", seed=81, ground_y=0.0, dirt_h=1.6, dirt_amt=0.5, ao_dist=3.0)
    rj = random.Random(21)
    p.notes = dict(desc="Raider watchtower ~13 m: timber legs + X bracing, scrap-plate platform at y=9 with ladder on the +Z face, corrugated roof, searchlight, skull banner pole. Front (ladder) faces +Z. Sandbag/tyre nest at the base.",
                   footprint=[7, 7], height=13.2, platform_y=9.0, front="+Z", sockets="searchlight (aim +Z), platform (gunner stand)")
    HB, HT, PY = 2.0, 1.5, 9.0
    hw = lambda y: HB - (HB - HT) * y / PY
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    # footing blocks + legs
    for (sx, sz) in corners:
        p.bx("concrete_dark", (sx * HB - 0.35, sx * HB + 0.35), (0, 0.3), (sz * HB - 0.35, sz * HB + 0.35), sub=2.0)
        p.beam("wood", (sx * HB, 0.25, sz * HB), (sx * HT, PY + 0.1, sz * HT), 0.34, 0.34, up=(0, 1, 0), tint=rj.uniform(0.75, 1.0))
    for y in (3.0, 6.0, PY - 0.25):
        h = hw(y)
        for k in range(4):
            a, b = corners[k], corners[(k + 1) % 4]
            p.beam("wood", (a[0] * h, y, a[1] * h), (b[0] * h, y, b[1] * h), 0.18, 0.2, tint=rj.uniform(0.7, 1.0))
    for i, (y0, y1) in enumerate(((0.3, 3.0), (3.0, 6.0), (6.0, PY - 0.25))):
        for k in range(4):
            a, b = corners[k], corners[(k + 1) % 4]
            h0, h1 = hw(y0), hw(y1)
            if (i + k) % 3 != 2:
                p.beam("wood", (a[0] * h0, y0, a[1] * h0), (b[0] * h1, y1, b[1] * h1), 0.13, 0.13, tint=0.8)
            if (i * 2 + k) % 3 != 1:
                p.beam("wood", (b[0] * h0, y0, b[1] * h0), (a[0] * h1, y1, a[1] * h1), 0.13, 0.13, tint=0.85)
    # lashing / bolts at joints (rope wraps as thin dark boxes)
    for (sx, sz) in corners:
        for y in (3.0, 6.0):
            h = hw(y)
            p.box("rubber", (sx * h, y, sz * h), (0.4, 0.07, 0.4), tint=0.8)
    # platform
    for i in range(6):
        z = -1.9 + i * 0.76
        p.bx("wood", (-2.15, 2.15), (PY - 0.2, PY - 0.06), (z - 0.06, z + 0.06))
    p.bx("wood", (-2.25, 2.25), (PY, PY + 0.12), (-2.25, 2.25), sub=1.2, tint=0.9)
    for i in range(8):
        x = -2.0 + i * 0.57
        p.bx("wood", (x - 0.02, x + 0.02), (PY + 0.12, PY + 0.125), (-2.25, 2.25), tint=0.55) if False else None
    # scrap plate railings (mixed materials, slightly crooked)
    def plate(x, z, w, ax, mat, hh=1.0, tilt=0.0):
        rot = (0, 0 if ax == "x" else 90, tilt)
        p.box(mat, (x, PY + 0.12 + hh / 2, z), (w, hh, 0.07), rot=rot, tint=rj.uniform(0.7, 1.0))
    for k, x in enumerate((-1.7, -0.55)):
        plate(x, 2.2, 1.1, "x", ("rust", "metal_bare")[k % 2], 1.0 - 0.1 * k, rj.uniform(-3, 3))
    for k, x in enumerate((0.75, 1.7)):
        plate(x, 2.2, 1.0, "x", ("metal_bare", "rust")[k % 2], 0.95, rj.uniform(-3, 3))
    for k, x in enumerate((-1.5, -0.3, 0.9, 1.75)):
        plate(x, -2.2, 1.2 if k != 3 else 0.8, "x", ("rust", "metal_bare", "wood", "rust")[k], 1.05 - 0.1 * (k % 2), rj.uniform(-3, 3))
    for s in (-1, 1):
        for k, z in enumerate((-1.5, -0.3, 0.9, 1.75)):
            plate(s * 2.2, z, 1.2 if k != 3 else 0.8, "z", ("wood", "rust", "metal_bare", "rust")[(k + (s > 0)) % 4], 1.0, rj.uniform(-3, 3))
    for (sx, sz) in corners:
        p.tube("wood", (sx * 2.2, PY + 0.1, sz * 2.2), (sx * 2.2, PY + 3.0, sz * 2.2), 0.09, sides=4, smooth=False)
    # roof: two rust sheets + ridge + tarp
    ry, ridge = PY + 3.0, PY + 4.0
    th = math.degrees(math.atan((ridge - ry) / 2.7))
    for s in (-1, 1):
        p.box("rust", (0, (ry + ridge) / 2 + 0.05, s * 1.4), (5.6, 0.06, 3.0), rot=(s * th, 0, 0), sub=1.5, tint=0.8 + 0.1 * (s > 0))
        for k in range(5):
            x = -2.2 + k * 1.1
            p.box("rust", (x, (ry + ridge) / 2 + 0.11, s * 1.4), (0.07, 0.06, 3.02), rot=(s * th, 0, 0), tint=0.7)
    p.bx("metal_dark", (-2.9, 2.9), (ridge, ridge + 0.1), (-0.25, 0.25), skip=("ny",))
    p.box("canvas", (2.5, ry - 0.25, 0.3), (0.03, 1.6, 3.0), rot=(0, 0, 8), tint=(0.35, 0.42, 0.3))
    for x in (-2.55, 2.55):
        p.tube("wood", (x, ry, -2.2), (x, ridge, 0.0), 0.06, sides=4, smooth=False)
        p.tube("wood", (x, ry, 2.2), (x, ridge, 0.0), 0.06, sides=4, smooth=False)
    # ladder on the +Z face
    zl = lambda y: hw(y) + 0.14
    for s in (-1, 1):
        p.tube("wood", (s * 0.3, 0.1, zl(0.1)), (s * 0.3, PY + 1.15, zl(PY) + 0.0), 0.04, sides=4, smooth=False)
    n = 21
    for k in range(n):
        y = 0.5 + k * (PY + 0.55) / n
        p.box("wood", (0, y, zl(y) + 0.02), (0.6, 0.045, 0.06), tint=rj.uniform(0.7, 1.0))
    p.bx("metal_dark", (-0.8, 0.8), (PY, PY + 0.02), (1.3, 2.3)) if False else None
    # searchlight
    p.tube("metal_dark", (-1.9, PY + 0.1, 1.9), (-1.9, PY + 1.6, 1.9), 0.06, sides=6)
    p.box("metal_dark", (-1.9, PY + 1.7, 2.0), (0.6, 0.55, 0.7), rot=(-8, 12, 0), bevel=0.03)
    p.cyl("metal_dark", (-1.85, PY + 1.7, 2.42), 0.28, 0.15, "z", sides=10)
    p.cyl("light_head", (-1.85, PY + 1.7, 2.52), 0.24, 0.03, "z", sides=10)
    p.socket("searchlight", (-1.85, PY + 1.7, 2.55))
    p.socket("platform", (0, PY + 0.12, 0))
    # banner pole + skulls
    p.tube("wood", (1.9, PY + 0.1, 1.9), (1.9, PY + 6.0, 1.9), 0.06, sides=5)
    p.tube("wood", (1.9, PY + 5.6, 1.9), (0.7, PY + 5.6, 1.9), 0.04, sides=4, smooth=False)
    banner(p, 0.7, PY + 5.6, 1.9, 1.2, 2.2, tint=(0.62, 0.08, 0.06), seed=2)
    skull(p, (1.9, PY + 6.15, 1.9), 1.5, yaw=20)
    for (x, z) in ((-2.25, 2.25), (2.25, 2.25), (0.0, 2.3)):
        spike(p, (x, PY + 1.05, z), (x, PY + 1.65, z), 0.03)
    for x in (-2.25, 2.25):
        skull(p, (x, PY + 1.78, 2.25), 0.9, yaw=rj.uniform(-30, 30))
    # crates, water barrel and rope on the platform
    crate(p, -1.5, -1.5, PY + 0.12, 0.6, rot=20)
    barrel(p, 1.5, -1.4, PY + 0.12, mat="rust")
    p.tube("rubber", (-0.8, PY + 0.14, -0.5), (-0.2, PY + 0.14, -0.9), 0.05, sides=5)
    # base nest: tyre rings, sandbags, blocks, barrels
    for (sx, sz) in corners:
        tyre_stack(p, sx * (HB + 0.85), sz * (HB + 0.85), 2, 0.0, seed=int(sx * 3 + sz * 5 + 20))
    for row in range(3):
        for i in range(7 - row):
            x = -1.8 + i * 0.62 + row * 0.31
            p.box("canvas", (x, 0.14 + row * 0.24, 3.6), (0.62, 0.25, 0.38), rot=(0, rj.uniform(-6, 6), 0), tint=(0.7 - 0.1 * rj.random(), 0.62, 0.45), bevel=0.04)
    for k in range(3):
        p.bx("concrete_dark", (-3.6 - 0.0, -2.6), (0.0 + k * 0.5, 0.5 + k * 0.5), (1.0 - k * 0.1, 2.0 - k * 0.1), sub=1.5, tint=rj.uniform(0.7, 1.0)) if k < 2 else None
    barrel(p, 3.2, 0.5, 0.0, mat="rust")
    barrel(p, 3.7, 0.9, 0.0)
    crate(p, 3.4, -1.0, 0.0, 0.8, rot=15)
    dune(p, 2.5, 6.5, -4.5, -1.5, 0.7)
    # collision: legs as a hull-ish box column, platform, roof
    p.chull([(-2.1, 0, -2.1), (2.1, 0, -2.1), (-2.1, 0, 2.1), (2.1, 0, 2.1), (-1.6, PY, -1.6), (1.6, PY, -1.6), (-1.6, PY, 1.6), (1.6, PY, 1.6)])
    p.cbx((-2.3, 2.3), (PY, PY + 1.3), (-2.3, 2.3))
    p.cbx((-2.9, 2.9), (PY + 3.0, PY + 4.1), (-2.7, 2.7))
    p.cbx((-2.5, 2.5), (0, 0.9), (3.3, 3.9))
    return p


# ================================================================================================= SHANTY HUT
def shanty_hut():
    p = Piece("shanty_hut", seed=91, ground_y=0.0, dirt_h=1.0, dirt_amt=0.5, ao_dist=2.2, noise_amt=0.35)
    rj = random.Random(31)
    p.notes = dict(desc="Raider scrap shack ~5.2 x 4.4 m, 3.2 m tall: patchwork of plywood/corrugated sheets/car door, tyre-weighted roof, stovepipe, tarp lean-to on the side. Front (door) faces +Z.",
                   footprint=[7, 6], front="+Z", height=3.6)
    # pallet floor
    for i in range(5):
        p.bx("wood", (-2.6 + i * 1.05, -1.6 + i * 1.05), (0.0, 0.12), (-2.3, 2.3), tint=rj.uniform(0.6, 0.95))
    # frame posts (crooked)
    posts = [(-2.4, -2.0), (2.4, -2.1), (-2.5, 2.0), (2.5, 2.1), (0, -2.1), (0.0, 2.1)]
    for k, (x, z) in enumerate(posts):
        hh = 2.7 + rj.uniform(-0.15, 0.3) + (0.3 if k in (2, 3) else 0.0)
        p.beam("wood", (x, 0.1, z), (x + rj.uniform(-0.05, 0.05), hh, z + rj.uniform(-0.05, 0.05)), 0.14, 0.14, tint=rj.uniform(0.7, 1.0))
    # wall panels: (mat, cx, cz, w, h, y0, axis, tilt, tint)
    def panel(mat, cx, cz, w, h, y0, ax, tilt=0.0, t=None, thick=0.05):
        rot = (0, 0 if ax == "x" else 90, tilt)
        p.box(mat, (cx, y0 + h / 2, cz), (w, h, thick), rot=rot, tint=t if t is not None else rj.uniform(0.7, 1.0))
    # back wall (z=-2.1)
    panel("rust", -1.6, -2.1, 1.7, 2.5, 0.12, "x", 1.0)
    panel("wood", -0.1, -2.15, 1.4, 2.6, 0.12, "x", -1.5)
    panel("metal_bare", 1.5, -2.1, 1.8, 2.5, 0.12, "x", 0.8)
    panel("paint", 1.9, -2.06, 0.9, 1.0, 1.0, "x", 4, t=(0.8, 0.25, 0.2), thick=0.03)
    # left wall (x=-2.5)
    panel("wood", -2.5, -1.2, 1.4, 2.6, 0.12, "z", 1.0)
    panel("rust", -2.5, 0.2, 1.5, 2.5, 0.12, "z", -2.0)
    panel("metal_bare", -2.5, 1.5, 1.2, 2.7, 0.12, "z", 1.5)
    # right wall (x=+2.5)
    panel("rust", 2.5, -1.2, 1.5, 2.6, 0.12, "z", 1.5)
    panel("paint", 2.5, 0.2, 1.5, 2.7, 0.12, "z", -1.0, t=(0.55, 0.62, 0.7))
    panel("wood", 2.5, 1.55, 1.2, 2.9, 0.12, "z", 2.5)
    # front wall (z=+2.1) with door + window
    panel("rust", -1.85, 2.1, 1.3, 3.0, 0.12, "x", -1.0)
    panel("wood", -0.85, 2.15, 0.8, 2.8, 0.12, "x", 2.0)
    panel("metal_bare", 1.85, 2.1, 1.2, 3.1, 0.12, "x", 1.0)
    panel("wood", 1.05, 2.12, 0.8, 1.0, 1.9, "x", 3.0)                  # lintel above window
    panel("wood", 1.05, 2.12, 0.8, 0.55, 0.12, "x", -2.0)
    for k in range(4):                                                       # window bars
        p.box("metal_dark", (0.75 + k * 0.2, 1.3, 2.16), (0.03, 0.75, 0.03))
    p.box("wood", (0.05, 1.45, 2.3), (0.86, 2.5, 0.05), rot=(0, -38, 0))   # plank door hanging open
    p.box("metal_dark", (-0.28, 1.6, 2.6), (0.03, 0.03, 0.4), rot=(0, 0, 0)) if False else None
    # extra patchwork overlays (small scraps nailed over seams)
    for _ in range(16):
        side = rj.choice(("f", "b", "l", "r"))
        w, h = rj.uniform(0.35, 0.9), rj.uniform(0.3, 0.8)
        y = rj.uniform(0.3, 2.5)
        mat = rj.choice(("rust", "metal_bare", "wood", "paint", "rust"))
        t = rj.uniform(0.7, 1.0) if mat != "paint" else (rj.uniform(0.5, 0.85), rj.uniform(0.3, 0.6), rj.uniform(0.3, 0.6))
        u = rj.uniform(-1.9, 1.9)
        if side == "f":
            if abs(u - 0.05) < 0.8 or 0.55 < u < 1.6 and 1.0 < y < 1.9:
                continue
            p.box(mat, (u, y + h / 2, 2.2), (w, h, 0.03), rot=(0, 0, rj.uniform(-8, 8)), tint=t)
        elif side == "b":
            p.box(mat, (u, y + h / 2, -2.18), (w, h, 0.03), rot=(0, 0, rj.uniform(-8, 8)), tint=t)
        elif side == "l":
            p.box(mat, (-2.6, y + h / 2, u), (0.03, h, w), rot=(rj.uniform(-8, 8), 0, 0), tint=t)
        else:
            p.box(mat, (2.6, y + h / 2, u), (0.03, h, w), rot=(rj.uniform(-8, 8), 0, 0), tint=t)
    # tyre wall along the base of the right side + front awning
    for i in range(5):
        tyre(p, (3.05, 0.14, -1.9 + i * 0.82), 0.34, 0.13, "y")
        if i < 4:
            tyre(p, (3.05, 0.4, -1.5 + i * 0.82), 0.34, 0.13, "y")
    p.box("rust", (0.0, 2.85, 3.2), (3.0, 0.05, 1.9), rot=(-13, 0, 3), sub=1.5, tint=0.85)
    for x in (-1.4, 1.4):
        p.tube("wood", (x, 0.0, 4.0), (x, 2.55, 4.0), 0.05, sides=4, smooth=False)
    p.cyl("metal_dark", (-0.9, 2.5, 3.3), 0.12, 0.15, "y", sides=6)
    p.tube("rubber", (-0.9, 2.75, 3.3), (-0.9, 2.55, 3.3), 0.01, sides=3, smooth=False)
    # roof: overlapping sheets + tyres + tarp
    for k, (x, ang) in enumerate(((-1.5, 6), (0.1, 5), (1.7, 7))):
        p.box("rust" if k != 1 else "metal_bare", (x, 3.15 + 0.05 * k, 0.0), (1.85, 0.05, 5.4), rot=(0, 0, ang * (1 if k != 1 else -1)), sub=2.0, tint=rj.uniform(0.7, 1.0))
    p.box("canvas", (0.3, 3.35, 0.2), (2.4, 0.03, 3.0), rot=(3, 8, -8), tint=(0.3, 0.38, 0.3))
    for (x, z) in ((-1.6, -1.6), (1.9, 1.4), (-1.4, 1.3), (0.4, -0.3)):
        tyre(p, (x, 3.4, z), 0.34, 0.13, "y")
    p.bx("concrete_dark", (1.0, 1.7), (3.4, 3.65), (-1.8, -1.2), sub=2.0) if False else None
    # stovepipe chimney
    p.tube("metal_dark", (-1.2, 3.0, -1.2), (-1.2, 4.3, -1.2), 0.11, sides=8)
    p.cyl("metal_dark", (-1.2, 4.4, -1.2), 0.2, 0.05, "y", sides=8)
    p.tube("metal_dark", (-1.2, 3.7, -1.2), (-1.7, 3.7, -1.5), 0.03, sides=4, smooth=False)
    # lean-to tarp on the left side
    p.box("canvas", (-3.6, 2.0, 0.3), (0.03, 2.6, 4.0), rot=(0, 0, 35), tint=(0.62, 0.3, 0.16))
    for z in (-1.5, 2.0):
        p.tube("wood", (-4.4, 0.0, z), (-4.4, 2.3, z), 0.06, sides=4, smooth=False)
    # junk around: barrels, crates, tyres, bedroll, cross sign, skull on a post, car door
    barrel(p, 3.4, 2.2, 0.0, mat="rust")
    barrel(p, 3.9, 1.6, 0.0)
    barrel(p, 3.6, -0.6, 0.0, mat="rust")
    crate(p, -3.4, -1.0, 0.0, 0.7, rot=25)
    crate(p, -3.2, 0.0, 0.0, 0.6, rot=-10)
    tyre_stack(p, 3.2, -2.6, 3, 0.0, seed=5)
    tyre_stack(p, -3.9, 2.8, 2, 0.0, seed=6)
    p.box("paint", (2.0, 0.55, 3.1), (1.3, 1.0, 0.1), rot=(0, 25, -75), tint=(0.5, 0.6, 0.72))         # car door leaning
    p.tube("wood", (-2.6, 0.0, 3.4), (-2.6, 1.9, 3.4), 0.05, sides=4, smooth=False)
    skull(p, (-2.6, 2.05, 3.4), 1.0, yaw=-20)
    p.bx("paint2", (-1.5, -0.3), (2.0, 2.06), (2.2, 2.25), tint=(0.8, 0.15, 0.1)) if False else None
    p.box("paint", (-0.55, 2.35, 2.17), (0.9, 0.09, 0.03), rot=(0, 0, 40), tint=(0.85, 0.2, 0.15))
    p.box("paint", (-0.55, 2.35, 2.17), (0.9, 0.09, 0.03), rot=(0, 0, -40), tint=(0.85, 0.2, 0.15))
    # collision
    p.cbx((-2.7, 2.7), (0, 3.3), (-2.3, 2.3))
    p.cbx((-4.5, -2.7), (0, 2.2), (-1.8, 2.2)) if False else None
    p.cbx((-2.5, 2.5), (3.3, 3.5), (-2.9, 2.9))
    return p


# ================================================================================================= RAIDER CAMP TENT
def _atent(p, cx, cz, yaw, w=3.4, l=4.4, h=2.3, tints=((0.55, 0.42, 0.28), (0.45, 0.5, 0.35)), seed=1):
    """A-frame canvas tent, ridge along local Z. Door at +Z end (open slit)."""
    rr = random.Random(seed)
    def build():
        hw, hl = w / 2, l / 2
        # two roof planes as subdivided quads
        for s, t in zip((-1, 1), tints):
            p.quad("canvas", (s * hw, 0, -hl), (0, h, -hl), (0, h, hl), (s * hw, 0, hl), tint=t, sub=1.5)
        # back gable + front flaps
        p.poly("canvas", [(-hw, 0, -hl), (hw, 0, -hl), (0, h, -hl)], tint=tints[0], flat=False)
        p.poly("canvas", [(-hw, 0, hl), (-0.0, 0, hl), (0, h, hl)], tint=tints[1], flat=False)
        p.poly("canvas", [(0.55, 0, hl + 0.02), (hw, 0, hl), (0, h, hl)], tint=tints[0], flat=False)
        p.quad("metal_dark", (-0.5, 0, hl - 0.05), (0.5, 0, hl - 0.05), (0.1, h * 0.6, hl - 0.05), (-0.1, h * 0.6, hl - 0.05), tint=0.5)   # dark opening
        # pole + ridge + guy ropes
        p.tube("wood", (0, 0, hl), (0, h + 0.15, hl), 0.05, sides=5)
        p.tube("wood", (0, 0, -hl), (0, h + 0.15, -hl), 0.05, sides=5)
        p.tube("wood", (0, h + 0.03, -hl), (0, h + 0.03, hl), 0.035, sides=4, smooth=False)
        for (gx, gz) in ((-hw - 1.0, hl + 0.8), (hw + 1.0, hl + 0.8), (-hw - 1.0, -hl - 0.8), (hw + 1.0, -hl - 0.8)):
            p.tube("rubber", (0, h + 0.1, hl if gz > 0 else -hl), (gx, 0.05, gz), 0.012, sides=3, smooth=False)
            p.tube("metal_bare", (gx, 0.0, gz), (gx, 0.25, gz), 0.02, sides=4, smooth=False)
        # patches
        for _ in range(3):
            s = rr.choice((-1, 1))
            z = rr.uniform(-hl + 0.6, hl - 0.6)
            yy = rr.uniform(0.5, h * 0.55)
            xx = s * hw * (1 - yy / h)
            p.box("canvas", (xx - s * 0.02, yy, z), (0.7, 0.6, 0.02), rot=(0, 0, s * math.degrees(math.atan(h / hw)) * 1.0), tint=(0.62, 0.22, 0.14))
    xform_block(p, xf((cx, 0, cz), (0, yaw, 0)), build)


def raider_camp_tent():
    p = Piece("raider_camp_tent", seed=101, ground_y=0.0, dirt_h=1.0, dirt_amt=0.35, ao_dist=2.5, noise_amt=0.3)
    rj = random.Random(41)
    p.notes = dict(desc="Raider camp: large conical war tent (patched canvas, skull totem on top), 2 A-frame tents, fire pit ring with logs + emissive flames, skull-and-banner totem pole, weapon rack, crates/barrels/bones. Front (war-tent door) faces +Z. Footprint ~16 x 14 m.",
                   footprint=[16, 14], front="+Z", sockets="fire (flame origin), totem (skull totem), tent_door")
    # ground scuff
    blob_pad(p, "dirt_red", 0.0, 0.0, 10.0, 8.6, 0.0, 0.05, n=20, seed=7)
    # war tent: 10-gon cone, alternating tints, door slit facing +Z
    R0, H0, N = 3.4, 3.6, 10
    cx, cz = -1.5, -2.6
    tints = [(0.62, 0.5, 0.34), (0.5, 0.2, 0.14), (0.62, 0.5, 0.34), (0.4, 0.42, 0.32)]
    for i in range(N):
        a0, a1 = 2 * math.pi * i / N, 2 * math.pi * (i + 1) / N
        pa = (cx + R0 * math.sin(a0), 0.0, cz + R0 * math.cos(a0))
        pb = (cx + R0 * math.sin(a1), 0.0, cz + R0 * math.cos(a1))
        ma0 = (cx + R0 * 0.55 * math.sin(a0), 1.85, cz + R0 * 0.55 * math.cos(a0))
        ma1 = (cx + R0 * 0.55 * math.sin(a1), 1.85, cz + R0 * 0.55 * math.cos(a1))
        top = (cx, H0, cz)
        t = tints[i % 4]
        p.quad("canvas", pa, pb, ma1, ma0, tint=t, sub=1.3)
        p.raw("canvas", [ma0, ma1, top], [(0, 1, 2)], tint=tuple(c * 0.9 for c in t))
    # door slit + flaps (on +Z side: angle ~ 0)
    p.quad("metal_dark", (cx - 0.55, 0.0, cz + R0 - 0.05), (cx + 0.55, 0.0, cz + R0 - 0.05), (cx + 0.3, 2.3, cz + R0 * 0.72), (cx - 0.3, 2.3, cz + R0 * 0.72), tint=0.4)
    p.box("canvas", (cx - 0.75, 1.1, cz + R0 - 0.1), (0.9, 2.2, 0.03), rot=(-18, 0, 12), tint=(0.5, 0.2, 0.14))
    p.box("canvas", (cx + 0.75, 1.1, cz + R0 - 0.1), (0.9, 2.2, 0.03), rot=(-18, 0, -12), tint=(0.5, 0.2, 0.14))
    # top pole + skull + banners
    p.tube("wood", (cx, H0 - 0.2, cz), (cx, H0 + 1.6, cz), 0.06, sides=5)
    skull(p, (cx, H0 + 1.7, cz), 1.6, yaw=0)
    spike(p, (cx - 0.35, H0 + 1.35, cz), (cx - 0.95, H0 + 1.85, cz), 0.03, "bone")
    spike(p, (cx + 0.35, H0 + 1.35, cz), (cx + 0.95, H0 + 1.85, cz), 0.03, "bone")
    banner(p, cx + 0.06, H0 + 1.3, cz, 0.9, 2.0, tint=(0.62, 0.08, 0.06), seed=3)
    # guy ropes
    for i in range(0, N, 2):
        a = 2 * math.pi * (i + 0.5) / N
        gx, gz = cx + (R0 + 1.4) * math.sin(a), cz + (R0 + 1.4) * math.cos(a)
        p.tube("rubber", (cx + 0.45 * math.sin(a), H0 - 0.5, cz + 0.45 * math.cos(a)), (gx, 0.05, gz), 0.013, sides=3, smooth=False)
        p.tube("metal_bare", (gx, 0, gz), (gx, 0.28, gz), 0.02, sides=4, smooth=False)
    # small tents
    _atent(p, 4.6, -3.0, 20, seed=1)
    _atent(p, -6.6, 1.2, -75, w=3.0, l=3.8, h=2.0, tints=((0.42, 0.44, 0.3), (0.5, 0.36, 0.22)), seed=2)
    # fire pit
    fx, fz = 1.2, 3.6
    for i in range(9):
        a = 2 * math.pi * i / 9
        rock(p, (fx + 0.95 * math.cos(a), 0.14, fz + 0.95 * math.sin(a)), (0.42, 0.28, 0.36), seed=i)
    p.cyl("metal_dark", (fx, 0.03, fz), 0.82, 0.05, "y", sides=10, tint=0.35)
    for i in range(4):
        a = i * 0.8 + 0.3
        p.tube("wood", (fx + 0.5 * math.cos(a), 0.12, fz + 0.5 * math.sin(a)), (fx - 0.5 * math.cos(a), 0.22, fz - 0.5 * math.sin(a)), 0.07, sides=5, tint=0.6 + 0.1 * i)
    flame(p, (fx, 0.2, fz), 1.0)
    p.socket("fire", (fx, 0.4, fz))
    # log seats + tripod cooking pot
    for (x, z, a) in ((fx + 2.0, fz + 0.4, 10), (fx - 1.9, fz + 0.9, -70), (fx + 0.3, fz + 2.1, 90)):
        p.beam("wood", (x - 0.55 * math.cos(math.radians(a)), 0.2, z - 0.55 * math.sin(math.radians(a))), (x + 0.55 * math.cos(math.radians(a)), 0.2, z + 0.55 * math.sin(math.radians(a))), 0.36, 0.36, tint=0.7)
    for k in range(3):
        a = k * 2.09
        p.tube("wood", (fx + 0.7 * math.cos(a), 0.0, fz + 0.7 * math.sin(a)), (fx + 0.1 * math.cos(a), 1.7, fz + 0.1 * math.sin(a)), 0.035, sides=4, smooth=False)
    p.tube("metal_dark", (fx, 1.65, fz), (fx, 1.0, fz), 0.01, sides=3, smooth=False)
    p.cyl("metal_dark", (fx, 0.85, fz), 0.28, 0.3, "y", sides=8)
    # totem pole (stacked skulls, horns, banner)
    tx, tz = 6.2, 3.4
    p.tube("wood", (tx, 0.0, tz), (tx, 5.6, tz), 0.14, sides=6, r2=0.11)
    p.bx("concrete_dark", (tx - 0.5, tx + 0.5), (0, 0.25), (tz - 0.5, tz + 0.5), sub=1.5)
    for k in range(4):
        skull(p, (tx, 1.6 + k * 0.85, tz + 0.15), 1.5 - 0.15 * k, yaw=k * 25 - 30)
    p.box("wood", (tx, 5.0, tz), (1.8, 0.14, 0.14), rot=(0, 0, 0))
    for s in (-1, 1):
        spike(p, (tx + s * 0.85, 5.0, tz), (tx + s * 1.3, 5.7, tz), 0.05, "bone")
        skull(p, (tx + s * 0.6, 4.75, tz + 0.1), 0.9, yaw=s * 30)
    banner(p, tx + 0.1, 4.95, tz + 0.12, 1.0, 2.6, tint=(0.62, 0.08, 0.06), seed=5)
    spike(p, (tx, 5.5, tz), (tx, 6.3, tz), 0.06)
    p.socket("totem", (tx, 5.5, tz))
    # weapon rack + supplies
    rx, rz = -5.2, -5.4
    for x in (rx - 1.0, rx + 1.0):
        p.tube("wood", (x, 0, rz), (x, 1.7, rz), 0.06, sides=4, smooth=False)
    p.beam("wood", (rx - 1.0, 1.4, rz), (rx + 1.0, 1.4, rz), 0.08, 0.08)
    p.beam("wood", (rx - 1.0, 0.7, rz), (rx + 1.0, 0.7, rz), 0.08, 0.08)
    for k in range(6):
        x = rx - 0.8 + k * 0.32
        p.tube("wood", (x, 0.2, rz + 0.05), (x + 0.04 * (k % 2), 2.0, rz + 0.15), 0.025, sides=4, smooth=False)
        spike(p, (x + 0.04 * (k % 2), 2.0, rz + 0.15), (x + 0.04 * (k % 2), 2.35, rz + 0.15), 0.03) if k % 2 == 0 else None
    for (x, z, s) in ((3.0, 2.1, 0.8), (3.8, 2.6, 0.7), (7.0, -1.0, 0.9), (7.8, -0.4, 0.7), (-3.9, 4.2, 0.8)):
        crate(p, x, z, 0.0, s, rot=rj.uniform(0, 45))
    for (x, z) in ((5.6, -5.0), (6.2, -5.4), (-8.0, -3.6), (-7.6, -2.9)):
        barrel(p, x, z, 0.0, mat="rust" if x < 0 else "metal_dark")
    tyre_stack(p, 8.0, 4.8, 3, 0.0, seed=9)
    for k in range(9):
        a = rj.uniform(0, 6.28)
        r = rj.uniform(3.6, 6.6)
        p.box("bone", (fx + r * math.cos(a) * 0.9, 0.05, fz + r * math.sin(a)), (0.32, 0.07, 0.08), rot=(0, rj.uniform(0, 180), 0), tint=0.9)
    # hanging lantern
    p.tube("wood", (-4.6, 0, 2.4), (-4.6, 2.4, 2.4), 0.05, sides=4, smooth=False)
    p.beam("wood", (-4.6, 2.35, 2.4), (-3.9, 2.35, 2.4), 0.05, 0.05)
    p.cyl("metal_dark", (-3.95, 2.1, 2.4), 0.1, 0.24, "y", sides=6)
    p.cyl("light_amber", (-3.95, 2.1, 2.4), 0.085, 0.2, "y", sides=6)
    # collision
    p.cbox((cx, 1.8, cz), (2 * R0, 3.6, 2 * R0))
    p.cbox((4.6, 1.15, -3.0), (3.4, 2.3, 4.4), rot=(0, 20, 0))
    p.cbox((-6.6, 1.0, 1.2), (3.0, 2.0, 3.8), rot=(0, -75, 0))
    p.cbx((tx - 0.5, tx + 0.5), (0, 6.3), (tz - 0.5, tz + 0.5))
    return p

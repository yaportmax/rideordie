"""lighthouse + wharf_ruin (man-made coastal structures). Imported by coast_canyon.py."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rocklib import *  # noqa
import slib  # noqa


def collision_from(p, info, frac=0.85):
    rings = info["rings"]
    cx, cz = info["center"]
    picks = rings[::max(1, len(rings) // 4)] + [rings[-1]]
    pts = []
    for r in picks:
        for v in r[::2]:
            pts.append((cx + (v.x - cx) * frac, v.y, cz + (v.z - cz) * frac))
    p.chull(pts)


def _radial_box(p, mat, ang_deg, r, y, size, tint=None, node=None):
    """Box on a cylinder surface at angle (0 = +X, 270 = +Z), thin axis radial."""
    th = math.radians(ang_deg)
    c = (r * math.cos(th), y, -r * math.sin(th))
    psi = math.degrees(math.atan2(math.cos(th), -math.sin(th)))
    p.box(mat, c, size, rot=(0, psi, 0), tint=tint, node=node)


# ---------------------------------------------------------------------------------------------- lighthouse
def lighthouse():
    slib.MATDEFS["paint"] = ("#d8d2c2", 0.05, 0.6, None, 0, 1.0, False)
    slib.MATDEFS["paint2"] = ("#b3352a", 0.05, 0.6, None, 0, 1.0, False)
    p = RockPiece("lighthouse", seed=81, ground_y=0.0, dirt_h=3.5, dirt_amt=0.5, ao_dist=5, noise_scale=0.18, streak_amt=0.35)
    YB = 2.0
    ang20 = [2 * math.pi * i / 20 for i in range(20)]
    # ---- rocky island
    isl = rock_tower(p, "rock_grey", 5.0, 0.5, 0.0, YB, [(0.0, 16.0), (0.5, 13.5), (1.0, 12.5)], sides=28, seed=81, jag=0.2, ellipse=(1.5, 0.95),
                     top="rough", top_rough=0.3, ring_dy=1.0, foot=2.0, nscale=0.05, lobes=(6, 0.13))
    rock_skirt(p, "rock_grey", 5.0, 0.5, 0.0, 12.6, 21.0, 2.0, sides=28, seed=3, ellipse=(1.5, 0.95), jag=0.2, tint=(0.55, 0.57, 0.55))
    boulders(p, "rock_grey", 5.0, 0.5, 17, 27, 12, 1.2, 3.6, seed=7, y=0.0, tint=(0.6, 0.62, 0.6), ellipse=(1.5, 0.95))

    def rad(y):
        return 3.55 - 1.2 * (y - YB) / (22.0 - YB)

    def band(y0, y1, mat):
        rings = [[Vector((rad(y) * math.cos(a), y, -rad(y) * math.sin(a))) for a in ang20] for y in (y0, y1)]
        p.loft(mat, rings, closed=True, cap_a=False, cap_b=False, sg=p._new_sg(), sub=1.6)
    band(YB, 5.5, "brick")
    ys = [5.5, 9.1, 12.7, 16.3, 19.9, 22.0]
    for i in range(5):
        band(ys[i], ys[i + 1], "paint" if i % 2 == 0 else "paint2")
    # cornice rings + plinth
    p.cyl("concrete_dark", (0, YB - 0.4, 0), 4.7, 1.6, "y", sides=20)
    p.cyl("concrete_dark", (0, YB + 0.55, 0), 4.55, 1.1, "y", sides=20, r2=4.0)
    p.cyl("concrete", (0, 5.5, 0), rad(5.5) + 0.12, 0.3, "y", sides=20)
    p.cyl("concrete", (0, 21.9, 0), rad(21.9) + 0.16, 0.3, "y", sides=20)
    # door + steps (front = +Z, angle 270)
    _radial_box(p, "concrete_dark", 270, rad(YB + 1.3) + 0.05, YB + 1.4, (1.9, 2.8, 0.4))
    _radial_box(p, "metal_dark", 270, rad(YB + 1.3) + 0.22, YB + 1.25, (1.25, 2.4, 0.2), tint=(0.5, 0.5, 0.5))
    for k in range(3):
        p.bx("concrete_dark", (-1.3, 1.3), (YB, YB + 0.7 - 0.23 * k), (3.6 + 0.35 * k, 3.95 + 0.35 * k), bevel=0.02)
    # windows spiralling up
    for a, y in [(200, 7.4), (110, 10.9), (330, 14.5), (20, 18.0), (250, 20.6)]:
        _radial_box(p, "concrete_dark", a, rad(y) + 0.03, y, (0.85, 1.35, 0.2))
        _radial_box(p, "metal_dark", a, rad(y) + 0.1, y, (0.55, 1.0, 0.16), tint=(0.4, 0.4, 0.45))
    # storm damage: blown-out hole + cracks + rubble
    _radial_box(p, "metal_dark", 100, rad(15.0) + 0.02, 15.0, (1.5, 2.3, 0.3), tint=(0.03, 0.03, 0.03))
    for dy, dw in [(2.1, 0.5), (1.2, 0.35), (-1.9, 0.6)]:
        _radial_box(p, "brick", 100, rad(15.0) + 0.08, 15.0 + dy, (dw, 0.3, 0.14), tint=(0.5, 0.42, 0.4))
    for _a, _y in [(302, 7.0), (55, 17.4)]:
        _radial_box(p, "metal_dark", _a, rad(_y) + 0.02, _y, (0.06, 2.6, 0.06), tint=(0.1, 0.1, 0.1))
    rng = random.Random(4)
    for i in range(10):
        a = rng.uniform(0, 2 * math.pi)
        r_ = rng.uniform(4.6, 6.0)
        s = rng.uniform(0.25, 0.6)
        p.box(rng.choice(["brick", "concrete"]), (r_ * math.cos(a), YB + s * 0.4, -r_ * math.sin(a)), (s * 1.4, s, s),
              rot=(rng.uniform(-15, 15), rng.uniform(0, 90), rng.uniform(-15, 15)), bevel=0.03)
    # ---- gallery
    p.cyl("concrete", (0, 21.55, 0), 2.6, 0.9, "y", sides=20, r2=4.1)
    p.cyl("concrete", (0, 22.17, 0), 4.1, 0.35, "y", sides=20)
    gy = 22.35
    npost = 20
    posts = [(3.95 * math.cos(2 * math.pi * i / npost), -3.95 * math.sin(2 * math.pi * i / npost)) for i in range(npost)]
    missing_p = {3, 4, 11}
    for i, (x, z) in enumerate(posts):
        if i in missing_p:
            continue
        top = gy + (1.15 if i != 12 else 0.6)
        p.tube("metal_dark", (x, gy, z), (x + (0.35 if i == 5 else 0.0), top, z), 0.04, sides=5, smooth=False)
    for h in (gy + 0.55, gy + 1.1):
        for i in range(npost):
            if i in {2, 3, 4, 10, 11} or (h > gy + 0.8 and i in {5, 6, 12}):
                continue
            a, b = posts[i], posts[(i + 1) % npost]
            p.tube("metal_dark", (a[0], h, a[1]), (b[0], h, b[1]), 0.03, sides=5, smooth=False)
    # ---- lantern room
    p.cyl("metal_dark", (0, gy + 0.35, 0), 2.15, 0.7, "y", sides=12)
    p.cyl("metal_dark", (0, gy + 0.75, 0), 2.25, 0.12, "y", sides=12)
    LY0, LY1 = gy + 0.7, 25.0
    ang12 = [2 * math.pi * i / 12 for i in range(12)]
    R_l = 1.95
    for a in ang12:
        p.tube("metal_dark", (R_l * math.cos(a), LY0, -R_l * math.sin(a)), (R_l * math.cos(a), LY1, -R_l * math.sin(a)), 0.055, sides=5, smooth=False)
    for i in range(12):
        if i in {2, 3, 9}:
            continue
        a, b = ang12[i], ang12[(i + 1) % 12]
        pa = (R_l * math.cos(a), -R_l * math.sin(a))
        pb = (R_l * math.cos(b), -R_l * math.sin(b))
        p.quad("glass", (pa[0], LY0, pa[1]), (pb[0], LY0, pb[1]), (pb[0], LY1, pb[1]), (pa[0], LY1, pa[1]))
    for y in (LY0 + 0.05, LY1 - 0.05):
        p.cyl("metal_dark", (0, y, 0), R_l + 0.06, 0.1, "y", sides=12)
    p.cyl("metal_dark", (0, LY0 + 0.4, 0), 0.5, 0.8, "y", sides=8)
    p.cyl("light_head", (0, LY0 + 1.3, 0), 0.62, 1.3, "y", sides=12)
    p.cyl("metal_bare", (0, LY0 + 1.98, 0), 0.7, 0.06, "y", sides=12)
    p.cyl("metal_dark", (0, LY1 + 0.15, 0), 2.35, 0.3, "y", sides=12)
    p.cyl("rust", (0, LY1 + 1.2, 0), 2.2, 1.8, "y", sides=12, r2=0.25)
    p.cyl("metal_dark", (0, LY1 + 2.25, 0), 0.32, 0.4, "y", sides=8)
    p.tube("metal_bare", (0, LY1 + 2.4, 0), (0.1, LY1 + 4.3, 0.0), 0.03, sides=5)
    # ---- keeper cottage
    cx, cz, y0 = 12.5, 1.5, YB
    Wx, Wz, Hw = 8.4, 5.6, 3.3
    p.bx("concrete_dark", (cx - Wx / 2 - 0.15, cx + Wx / 2 + 0.15), (y0 - 0.8, y0 + 0.5), (cz - Wz / 2 - 0.15, cz + Wz / 2 + 0.15), bevel=0.04, sub=2.5)
    p.bx("paint", (cx - Wx / 2, cx + Wx / 2), (y0 + 0.5, y0 + Hw), (cz - Wz / 2, cz + Wz / 2), bevel=0.04, sub=1.8)
    rise, eave = 1.9, Wz / 2 + 0.45
    for x in (cx - Wx / 2, cx + Wx / 2 - 0.3):
        p.extrude_x("paint", [(cz - Wz / 2, y0 + Hw), (cz + Wz / 2, y0 + Hw), (cz, y0 + Hw + rise)], x, x + 0.3, sub=1.5)
    # roof slabs (rust corrugated): -z slope intact, +z slope collapsed halfway
    p.beam("rust", (cx, y0 + Hw + rise, cz), (cx, y0 + Hw - 0.25, cz - eave), Wx + 0.9, 0.1, up=(0, 1, 0), sub=1.5)
    p.beam("rust", (cx, y0 + Hw + rise, cz), (cx, y0 + Hw + rise * 0.15, cz + eave * 0.55), Wx + 0.9, 0.1, up=(0, 1, 0), sub=1.5)
    p.beam("rust", (cx + 0.4, y0 + Hw - 0.2, cz + eave * 0.6), (cx + 0.6, y0 + 0.9, cz + eave * 1.05), Wx * 0.55, 0.1, up=(0, 1, 0))
    for k in range(5):  # exposed rafters
        x = cx - Wx / 2 + 0.6 + k * (Wx - 1.2) / 4
        p.beam("wood", (x, y0 + Hw + rise - 0.1, cz + 0.1), (x, y0 + Hw + rise * 0.05, cz + eave * 0.95), 0.12, 0.16, up=(0, 1, 0))
    p.bx("brick", (cx + 2.4, cx + 3.2), (y0 + Hw - 0.5, y0 + Hw + rise + 1.4), (cz - 0.4, cz + 0.4), bevel=0.03)
    zf = cz + Wz / 2
    p.bx("concrete_dark", (cx - 1.2, cx - 0.1), (y0 + 0.5, y0 + 2.7), (zf - 0.05, zf + 0.15), bevel=0.02)
    p.bx("metal_dark", (cx - 1.05, cx - 0.25), (y0 + 0.5, y0 + 2.55), (zf + 0.1, zf + 0.2), tint=(0.5, 0.5, 0.5))
    for wx in (cx - 3.0, cx + 1.6):
        p.bx("concrete_dark", (wx - 0.6, wx + 0.6), (y0 + 1.2, y0 + 2.5), (zf - 0.05, zf + 0.12), bevel=0.02)
        p.bx("metal_dark", (wx - 0.48, wx + 0.48), (y0 + 1.3, y0 + 2.4), (zf + 0.08, zf + 0.16), tint=(0.35, 0.35, 0.4))
    for wz in (cz - 1.0, cz + 1.0):
        p.bx("concrete_dark", (cx + Wx / 2 - 0.05, cx + Wx / 2 + 0.12), (y0 + 1.2, y0 + 2.5), (wz - 0.5, wz + 0.5), bevel=0.02)
        p.bx("metal_dark", (cx + Wx / 2 + 0.08, cx + Wx / 2 + 0.16), (y0 + 1.3, y0 + 2.4), (wz - 0.4, wz + 0.4), tint=(0.35, 0.35, 0.4))
    for i in range(8):
        a = rng.uniform(0, 2 * math.pi)
        s = rng.uniform(0.25, 0.6)
        p.box(rng.choice(["brick", "rust", "wood"]), (cx + 1.5 + 3 * math.cos(a), y0 + s * 0.4, cz + Wz / 2 + 0.8 + 1.2 * abs(math.sin(a))),
              (s * 1.5, s, s), rot=(0, rng.uniform(0, 90), rng.uniform(-20, 20)))
    # ---- collision
    ring_pts = [(rad(y) * math.cos(a), y, -rad(y) * math.sin(a)) for y in (YB, 12.0, 22.0) for a in ang20[::2]]
    p.chull(ring_pts)
    p.chull([(4.1 * math.cos(a), 22.0, -4.1 * math.sin(a)) for a in ang20[::2]] + [(2.3 * math.cos(a), 26.8, -2.3 * math.sin(a)) for a in ang20[::4]])
    p.cbx((cx - Wx / 2, cx + Wx / 2), (y0 - 0.3, y0 + Hw + rise), (cz - Wz / 2, cz + Wz / 2))
    collision_from(p, isl, frac=0.95)
    p.socket("light", (0, LY0 + 1.3, 0))
    p.notes = dict(desc="Ruined lighthouse on a rock outcrop: 28 m tapered tower (brick base, white/red paint bands) + gallery + lantern (emissive light_head) + half-collapsed keeper cottage at +X. Tower at (0,0); ground y=0 = sea level, island top y=2. Door faces +Z.",
                   height=29.2, sockets="light = lantern lamp position (add a real point light there)", tint="paint bands = white, paint2 bands = red (base colours already set; game may tint)")
    p.build()


# ---------------------------------------------------------------------------------------------- wharf
def wharf_ruin():
    p = RockPiece("wharf_ruin", seed=91, ground_y=-3.5, dirt_h=2.0, dirt_amt=0.0, ao_dist=3.0, noise_scale=0.3, streak_amt=0.3)
    rng = random.Random(9)
    L, HW = 38.0, 3.5
    DECK = 3.15           # plank top
    # ---- concrete quay head
    p.bx("concrete", (-6.0, 6.0), (-2.5, DECK + 0.1), (-5.0, 3.2), bevel=0.06, sub=2.0)
    p.bx("concrete_dark", (-6.05, 6.05), (DECK - 0.1, DECK + 0.25), (-5.05, -4.6), bevel=0.03)
    for x in (-5.0, 5.0):
        p.cyl("metal_dark", (x, DECK + 0.45, 0.3), 0.22, 0.7, "y", sides=8, r2=0.3)      # bollards
    for i in range(7):   # rubble at quay edge
        s = rng.uniform(0.3, 0.8)
        p.box("concrete", (rng.uniform(-5, 5), DECK + 0.2 + s * 0.3, rng.uniform(1.0, 3.0)), (s * 1.5, s, s), rot=(0, rng.uniform(0, 90), rng.uniform(-20, 20)), bevel=0.03)
    # ---- timber structure: bents every 3.6 m, 3 piles each
    zb = [4.2 + 3.6 * k for k in range(10)]
    xs = [-3.05, 0.0, 3.05]
    broken = {(6, 2): 1.3, (7, 0): 0.4, (8, 1): -0.6, (9, 0): 1.4, (9, 2): 0.9, (9, 1): 1.9, (5, 2): 2.6}
    missing_piles = {(8, 2), (8, 0)}
    for k, z in enumerate(zb):
        for i, x in enumerate(xs):
            if (k, i) in missing_piles:
                continue
            top = 2.6 - broken.get((k, i), 0.0) * (1.0 if (k, i) in broken else 0)
            top = min(2.6, top) if (k, i) in broken else 2.6
            lean = rng.uniform(-0.06, 0.06) * (2.0 if k > 5 else 1.0)
            p.tube("wood", (x + lean, -3.6, z), (x, top, z), 0.3, sides=8, r2=0.27, tint=rng.uniform(0.7, 0.95))
            if top < 2.6:  # splintered top
                p.tube("wood", (x, top, z), (x + rng.uniform(-0.1, 0.1), top + 0.4, z + rng.uniform(-0.1, 0.1)), 0.13, sides=5, r2=0.03)
        # cap beam
        if k < 8:
            p.bx("wood", (-HW - 0.15, HW + 0.15), (2.55, 2.95), (z - 0.22, z + 0.22), tint=rng.uniform(0.7, 0.95))
        # bracing
        if k < 7:
            for (xa, xb) in ((xs[0], xs[1]), (xs[1], xs[2])):
                p.beam("wood", (xa, -2.2, z + 0.32), (xb, 1.8, z + 0.32), 0.12, 0.2, up=(0, 0, 1))
    for k in range(min(9, 6)):
        z0, z1 = zb[k], zb[k + 1]
        for x in (xs[0], xs[2]):
            p.beam("wood", (x + 0.32, -1.6, z0), (x + 0.32, 1.4, z1), 0.1, 0.18, up=(1, 0, 0)) if False else None
    # stringers (along z), broken past z~31
    for x in (-3.05, -1.0, 1.0, 3.05):
        zend = L - 6.0 if abs(x) > 2 else L - 3.5
        p.bx("wood", (x - 0.15, x + 0.15), (2.95, 3.15 - 0.0), (2.0, zend), sub=4.0, tint=rng.uniform(0.7, 0.9))
        # sagged broken end
        p.beam("wood", (x, 3.05, zend), (x + rng.uniform(-0.3, 0.3), 1.6 - rng.uniform(0, 0.6), zend + 3.2), 0.3, 0.22, up=(0, 1, 0), tint=0.8)
    # ---- planks
    holes = [(13.0, 14.5, -1.0, 1.4), (20.0, 21.5, 1.2, 3.6), (26.0, 28.5, -3.6, 3.6)]
    z = 3.2
    while z < L - 5.0:
        w = rng.uniform(0.24, 0.3)
        t = (z - 3.2) / (L - 8.2)
        for seg in ((-3.65, -1.2), (-1.2, 1.25), (1.25, 3.65)):
            miss = rng.random() < 0.05 + 0.5 * t * t
            for (h0, h1, a, b) in holes:
                if h0 <= z <= h1 and seg[0] < b and seg[1] > a:
                    miss = True
            if miss:
                continue
            tilt = rng.uniform(-6, 6) * (0.4 + t)
            p.box("wood", ((seg[0] + seg[1]) / 2, DECK - 0.06, z + w / 2), (seg[1] - seg[0] - 0.02, 0.12, w), rot=(0, rng.uniform(-2, 2) * t, tilt), tint=rng.uniform(0.62, 0.92) * (1.0, 0.97, 0.93)[0])
        z += w + 0.05
    # dangling planks at the broken end
    for k in range(5):
        x = -3.0 + k * 1.5
        p.beam("wood", (x, 3.1, L - 6.0 + rng.uniform(0, 1.5)), (x + rng.uniform(-0.4, 0.4), 1.2 + rng.uniform(0, 1.5), L - 4.5 + rng.uniform(0, 1.2)), 0.28, 0.1, up=(0, 1, 0), tint=0.75)
    # ---- railing (+X side), partial, rusty pipe
    for k in range(9):
        zz = 4.0 + k * 2.1
        if k in (5, 6):
            continue
        p.tube("rust", (3.5, DECK, zz), (3.5, DECK + 1.15, zz), 0.045, sides=6, smooth=False)
    for k in range(9):
        if k in (4, 5, 6, 8):
            continue
        z0, z1 = 4.0 + k * 2.1, 4.0 + (k + 1) * 2.1
        p.tube("rust", (3.5, DECK + 1.1, z0), (3.5, DECK + 1.1, z1), 0.035, sides=6, smooth=False)
        p.tube("rust", (3.5, DECK + 0.6, z0), (3.5, DECK + 0.6, z1), 0.03, sides=6, smooth=False)
    # ---- crane stump on the deck (-X side)
    cxp, czp = -2.2, 17.0
    p.cyl("concrete_dark", (cxp, DECK + 0.4, czp), 1.35, 0.7, "y", sides=12)
    p.cyl("rust", (cxp, DECK + 1.2, czp), 0.95, 1.0, "y", sides=12, r2=0.8)
    p.cyl("rust", (cxp, DECK + 5.0, czp), 0.55, 8.0, "y", sides=10, r2=0.42)
    p.cyl("metal_dark", (cxp, DECK + 9.15, czp), 0.8, 0.5, "y", sides=10)
    jib0 = (cxp, DECK + 8.6, czp)
    jib1 = (cxp + 4.2, DECK + 12.2, czp + 3.4)        # broken bent boom
    p.beam("rust", jib0, jib1, 0.5, 0.5, up=(0, 1, 0))
    p.beam("rust", (cxp + 0.3, DECK + 8.4, czp), (cxp + 4.5, DECK + 11.9, czp + 3.6), 0.14, 0.14, up=(0, 1, 0))
    p.beam("rust", jib1, (jib1[0] + 3.2, jib1[1] - 3.6, jib1[2] + 0.4), 0.42, 0.42, up=(0, 1, 0))          # snapped tip hanging
    p.tube("metal_dark", (jib1[0] + 3.0, jib1[1] - 3.3, jib1[2] + 0.4), (jib1[0] + 3.0, DECK + 2.6, jib1[2] + 0.4), 0.03, sides=5)
    p.box("metal_dark", (jib1[0] + 3.0, DECK + 2.4, jib1[2] + 0.4), (0.6, 0.4, 0.6), bevel=0.04)
    p.box("rust", (cxp - 1.6, DECK + 8.2, czp - 0.4), (1.6, 1.2, 1.6), bevel=0.04)      # counterweight
    p.box("metal_dark", (cxp + 0.9, DECK + 2.4, czp), (0.9, 1.5, 1.1), bevel=0.05)      # winch housing
    # ---- sunken boat hull (half submerged, rolled over)
    def hull_ring(s, hb=2.3, dp=2.4):
        pts = []
        n = 10
        for i in range(n + 1):     # bottom half-ellipse from -x gunwale to +x gunwale
            a = math.pi + math.pi * i / n
            pts.append((hb * s * math.cos(a), dp * s * (1 + math.sin(a)) * 0.5 * 0 + dp * s * math.sin(a) * 0.9 + dp * s * 0.9 - 0.0, 0.0))
        for i in range(3, 0, -1):  # gunwale/deck line back
            pts.append((hb * s * (i - 2) / 2.0 * -1.0, dp * s * 1.8 * 0 + dp * s * 0.9 + 0.05, 0.0))
        return pts
    Lb = 11.0
    rings = []
    nz_ = 9
    for k in range(nz_ + 1):
        t = k / nz_
        s = max(0.08, math.sqrt(max(0.0, 1 - (2 * t - 1) ** 4)))
        s = s * (1.0 if t < 0.5 else 1.0)
        pr = hull_ring(s)
        rings.append([(x, y - 2.2 * s, (t - 0.5) * Lb) for x, y, _ in pr])
    Mb = xf((9.5, -0.9, 20.0), (7, 25, 24))
    p.loft("rust", rings, closed=True, M=Mb, flat=False, sg=p._new_sg())
    # wooden ribs sticking out of a torn section + cabin remains
    for k in range(6):
        zr = -3.0 + k * 0.9
        a = Mb @ Vector((-2.1, 0.5, zr))
        b = Mb @ Vector((-1.4, 2.4 + 0.2 * (k % 3), zr))
        p.tube("wood", tuple(a), tuple(b), 0.06, sides=5, smooth=False)
        a2 = Mb @ Vector((2.1, 0.5, zr))
        b2 = Mb @ Vector((1.3, 2.0 + 0.3 * (k % 2), zr))
        p.tube("wood", tuple(a2), tuple(b2), 0.06, sides=5, smooth=False)
    cab = xf((9.5, -0.9, 20.0), (7, 25, 24)) @ Matrix.Translation((0.3, 1.6, 1.5))
    p.box("metal_dark", (0, 0, 0), (2.4, 1.8, 2.6), M=cab, bevel=0.05)
    p.box("glass", (0, 0.3, 1.32), (2.0, 0.7, 0.05), M=cab)
    p.tube("metal_dark", tuple(Mb @ Vector((0.0, 1.5, -2.5))), tuple(Mb @ Vector((0.4, 5.5, -2.9))), 0.09, sides=6)      # snapped mast
    # ---- collision (deck edge + quay + crane base + hull)
    p.cbx((-6.0, 6.0), (-2.5, DECK + 0.2), (-5.0, 3.2))
    p.cbx((-3.7, 3.7), (2.4, DECK), (3.2, L - 6.0))
    p.cbx((-1.3, 1.3), (DECK, DECK + 1.4), (cxp * 0 + czp - 1.3, czp + 1.3)) if False else None
    p.cbx((cxp - 1.4, cxp + 1.4), (DECK, DECK + 9.0), (czp - 1.4, czp + 1.4))
    hp = [tuple(Mb @ Vector(v)) for r in rings[1:-1:2] for v in r[::3]]
    p.chull(hp)
    p.notes = dict(desc="Ruined wharf: concrete quay head + 38 m timber pier along +Z with missing/broken planks and piles, rusty crane stump (z=17, x=-2.2), half-sunk boat hull at (9.5,-0.9,20). Pier deck top y=3.15, sea level y=0 (piles go to y=-3.6). Origin = pier centre at the quay edge (z=0).",
                   length=38, deck_y=3.15, placement="sea level = y 0; quay head sits on the shore, pier runs out to sea along +Z")
    p.build()

"""dam_wall_backdrop - 200 m wide, 79.4 m tall concrete dam wall with spillway, towers, powerhouses, rock abutments."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dam_common import *

ONLY = os.environ.get("ONLY", "")

H_CREST = 79.4        # crest deck top (module road level y=80 sits on it)
ARC_R = 260.0


def zf(x, y):
    """downstream face z at (x, y). Straight crest (y=H), plan curvature grows toward the base (amphitheatre)."""
    return 24.0 * (max(y, 0.0) / H_CREST) ** 1.3 - (x * x / (2 * ARC_R)) * (1 - min(y, H_CREST) / H_CREST) ** 0.8


def zb_(x, y):
    """upstream face z."""
    return 46.0 - 4.0 * (y / H_CREST) - (x * x / (2 * ARC_R)) * (1 - min(y, H_CREST) / H_CREST) ** 0.8


def backdrop():
    p = Piece("dam_wall_backdrop", seed=41, ground_y=0, dirt_h=9, dirt_amt=0.5, noise_scale=0.05, noise_amt=0.25, streak_amt=0.0,
              ao_amt=0.55, ao_dist=14, ao_rays=8, dust_amt=0.08)
    p.mat_style["rock_grey"] = dict(noise_scale=0.05, strata_period=6.0, dirt_amt=0.3, ao_amt=0.4)
    p.notes = dict(
        desc="Concrete dam wall backdrop, 200 m wide x 79.4 m tall (crest deck y=79.4; road level y=80 for dam_road_10m modules). "
             "Wall runs along X (x -100..100); DOWNSTREAM face (the one the player sees) faces -Z with base toe at z~0, y=0; reservoir (water_dark, y=76) is at +Z. "
             "Straight crest at z=24..42 (centre z=33). Central spillway: 5 radial-gate bays (x=-40..40, 16 m clear, gates y 62..78) with stepped chutes down the face; "
             "2 intake towers on the crest (x=+-68, top y=106); 2 powerhouses + penstocks at the toe (x=+-75); grey rock abutments beyond x=+-100. "
             "To use as a side backdrop rotate yaw 90 deg. Ground/terrain is NOT included (place terrain at y=0 in front, z<0).",
        crest_road="place dam_road_10m modules along X at y=80, z=33 with yaw +90 (module +Z -> +X): sockets crest_start (x=-100) crest_end (x=100)",
        arena="socket arena_center (0,0,-70): open flat ground area expected in front of the wall")
    H = H_CREST
    rj = random.Random(9)
    # ---------------- downstream face grid
    piers = [-50, -30, -10, 10, 30, 50]
    bays = [(c - 8, c + 8) for c in (-40, -20, 0, 20, 40)]
    joints = [-80, -60, -40, -20, 0, 20, 40, 60, 80]
    xe = []
    for x in range(-100, 101, 4):
        if x in joints:
            xe += [x - 0.3, x + 0.3]
        else:
            xe.append(float(x))
    ye = [i * 6.2 for i in range(11)] + [66.0, 70.0, 74.0, 78.0, H]
    inbay = lambda xc: any(a < xc < b for a, b in bays)
    for j in range(len(ye) - 1):
        y0, y1 = ye[j], ye[j + 1]
        for i in range(len(xe) - 1):
            x0, x1 = xe[i], xe[i + 1]
            xc = (x0 + x1) / 2
            if y0 >= 62.0 - 1e-6 and y1 <= 78.0 + 1e-6 and inbay(xc):
                continue
            isjoint = any(abs(xc - jx) < 0.31 for jx in joints)
            col = 0.9 + 0.12 * math.sin(xc * 1.7 + 3.0) * math.sin(xc * 0.43) + rj.uniform(-0.05, 0.05)
            hh = (y0 + y1) / 2
            g = 0.82 + 0.25 * min(1.0, hh / 60.0)
            stain = 1.0
            if inbay(xc) and hh < 62:
                stain = 0.62 + 0.38 * min(1.0, hh / 62.0)
            t = col * g * stain * (0.5 if isjoint else 1.0) * 0.6
            pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            q = [(px, py, zf(px, py)) for px, py in pts]
            p.quad("concrete", q[0], q[3], q[2], q[1], tint=t)
    # ---------------- upstream face (seen from the crest) + crest deck
    for j in range(5):
        y0, y1 = j * 19.85, (j + 1) * 19.85
        for i in range(10):
            x0, x1 = -100 + i * 20, -100 + (i + 1) * 20
            q = [(x0, y0, zb_(x0, y0)), (x1, y0, zb_(x1, y0)), (x1, y1, zb_(x1, y1)), (x0, y1, zb_(x0, y1))]
            p.quad("concrete_dark", *q, tint=rj.uniform(0.8, 1.0))
    for i in range(20):
        x0, x1 = -100 + i * 10, -100 + (i + 1) * 10
        for k in range(3):
            t0, t1 = k / 3, (k + 1) / 3
            za0, za1 = 24 + 18 * t0, 24 + 18 * t1
            p.quad("concrete_dark", (x0, H, za0), (x0, H, za1), (x1, H, za1), (x1, H, za0), tint=rj.uniform(0.85, 1.0))
    for sx in (-1, 1):
        x = sx * 100.0
        q = [(x, 0, zf(x, 0)), (x, 0, zb_(x, 0)), (x, H, zb_(x, H)), (x, H, zf(x, H))]
        p.quad("concrete_dark", *(q if sx > 0 else q[::-1]))
    # ---------------- spillway bays
    for (xa, xb) in bays:
        xm = (xa + xb) / 2
        zface = lambda y, x=xm: zf(x, y)
        zg = zface(70.0) + 12.5
        p.quad("concrete_dark", (xa, 62, zface(62)), (xa, 62, zg + 2), (xb, 62, zg + 2), (xb, 62, zface(62)), tint=0.85)
        p.quad("concrete_dark", (xa, 78, zface(78)), (xb, 78, zface(78)), (xb, 78, zg + 2), (xa, 78, zg + 2), tint=0.7)
        p.quad("concrete", (xa, 62, zf(xa, 62)), (xa, 78, zf(xa, 78)), (xa, 78, zg + 2), (xa, 62, zg + 2), tint=0.8)
        p.quad("concrete", (xb, 62, zf(xb, 62)), (xb, 62, zg + 2), (xb, 78, zg + 2), (xb, 78, zf(xb, 78)), tint=0.8)
        # radial gate: skin plate, horizontal girders on the downstream side, arms to trunnions on the piers
        p.box("steel_beam", (xm, 70, zg), (xb - xa - 0.1, 15.4, 0.4), tint=0.8)
        for yy in (63.6, 67.0, 70.5, 74.0, 76.8):
            p.bx("steel_beam", (xa + 0.1, xb - 0.1), (yy - 0.3, yy + 0.3), (zg - 0.75, zg - 0.2), tint=0.9)
        tz = zface(70.0) + 3.0
        for xarm in (xa + 2.2, xb - 2.2):
            for ya in (76.5, 63.8):
                p.beam("steel_beam", (xarm, ya, zg - 0.6), (xarm, 70.0, tz), 0.55, 0.45, up=(1, 0, 0), tint=0.85)
            p.beam("steel_beam", (xarm, 70.0, zg - 0.6), (xarm, 70.0, tz), 0.4, 0.4, up=(1, 0, 0), tint=0.9)
            p.cyl("metal_dark", (xarm + (0.65 if xarm < xm else -0.65), 70, tz), 0.9, 1.2, "x", sides=10)
        for yy in (65.5, 74.5):
            p.beam("rust", (xa + 2.2, yy, zg - 4), (xb - 2.2, yy, zg - 4), 0.3, 0.3, up=(0, 1, 0), tint=0.9)
        # chute: stepped, 4 sub-columns following the plan curvature
        n = 20
        for step in range(n):
            yh = 62.0 - step * 3.1
            yl = yh - 3.1
            for c in range(4):
                sx0, sx1 = xa + c * 4.0, xa + (c + 1) * 4.0
                xc = (sx0 + sx1) / 2
                prot = 0.4 + 2.2 * (1 - yl / 62.0)
                zfront = zf(xc, yl) - prot
                zback = zf(xc, yh) + 0.3
                p.box("concrete", ((sx0 + sx1) / 2, (yl + yh) / 2, (zfront + zback) / 2), (4.0, 3.1, zback - zfront),
                      skip=("px", "nx", "pz", "ny"), tint=(0.62 + 0.3 * (yl / 62.0)) * rj.uniform(0.9, 1.05))
    # pier extensions (training walls) down the face
    for xp in piers:
        prof = []
        for i in range(9):
            y = 62 - i * 62 / 8
            prof.append((zf(xp, y) - 4.2 * (1 - y / 62.0) - 0.05, y))
        prof.append((zf(xp, 0) + 3.0, 0.0))
        prof.append((zf(xp, 62) + 3.0, 62.0))
        p.extrude_x("concrete", prof, xp - 2.0, xp + 2.0, tint=0.85)
    # apron / stilling basin slab
    p.bx("concrete_dark", (-54, 54), (-0.6, 0.12), (-34, 1.0), sub=12.0, tint=0.85)
    for sx in (-1, 1):
        p.bx("concrete", (sx * 54 - (0 if sx > 0 else 3), sx * 54 + (3 if sx > 0 else 0)), (-0.6, 5.0), (-34, 1.0), sub=8.0, tint=0.8)
    # ---------------- crest cornice, wing pilasters, gallery portals
    p.bx("concrete_dark", (-100, 100), (H - 3.0, H), (22.4, 24.6), sub=10.0, tint=0.55)
    p.bx("concrete", (-100, 100), (H - 4.6, H - 3.0), (23.1, 24.4), sub=10.0, tint=0.5)
    for jx in (-80, -60, 60, 80):
        prof = []
        for y in (0, 15, 30, 45, 60, H - 4.6):
            prof.append((zf(jx, y) - 1.0 - 0.02, y))
        prof += [(zf(jx, H - 4.6) + 0.6, H - 4.6), (zf(jx, 0) + 0.6, 0.0)]
        p.extrude_x("concrete", prof, jx - 0.9, jx + 0.9, tint=0.55)
    for sx in (-1, 1):
        for xg in (66.0, 88.0):
            for yg in (22.0, 47.0):
                x = sx * xg
                ang = math.degrees(math.atan(24 * 1.3 * (yg / H_CREST) ** 0.3 / H_CREST))
                p.box("metal_dark", (x, yg, zf(x, yg) - 0.04), (3.4, 2.6, 0.5), rot=(ang, 0, 0), tint=0.6)
                p.box("concrete_dark", (x, yg - 1.5, zf(x, yg) - 0.35), (4.4, 0.35, 1.0), rot=(ang, 0, 0), tint=0.55)
    # ---------------- intake towers (crest, upstream half)
    for sx in (-1, 1):
        xc = sx * 68.0
        zc0 = 33.0
        p.bx("concrete", (xc - 5, xc + 5), (H, H + 27), (zc0 - 1, zc0 + 9), sub=6.0, bevel=0.15, tint=0.95)
        p.bx("concrete_dark", (xc - 5.6, xc + 5.6), (H + 27, H + 28.2), (zc0 - 1.6, zc0 + 9.6), tint=0.8)
        for tier in range(3):
            yy = H + 5 + tier * 8
            for side in (-1, 1):
                for k in range(3):
                    xx = xc + (k - 1) * 3.0
                    zzf = zc0 - 1.0 if side < 0 else zc0 + 9.0
                    p.box("metal_dark", (xx, yy + 2, zzf - 0.02 if side < 0 else zzf + 0.02), (1.2, 3.6, 0.1))
        p.bx("concrete", (xc - 3, xc + 3), (H + 28.2, H + 32), (zc0 + 1, zc0 + 7), bevel=0.1)
        p.tube("metal_dark", (xc, H + 32, zc0 + 4), (xc, H + 40, zc0 + 4), 0.15, sides=6)
        p.tube("metal_dark", (xc - 2.0, H + 37.5, zc0 + 4), (xc + 2.0, H + 37.5, zc0 + 4), 0.08, sides=4)
        p.cyl("light_tail", (xc, H + 40.2, zc0 + 4), 0.3, 0.4, "y", sides=8)
        p.socket("intake_beacon_%s" % ("R" if sx > 0 else "L"), (xc, H + 40.4, zc0 + 4))
        p.cbx((xc - 5, xc + 5), (H, H + 28), (zc0 - 1, zc0 + 9))
    # ---------------- powerhouses at the toe + penstocks
    for sx in (-1, 1):
        xc = sx * 76.0
        za = zf(xc, 0) + 3.5
        zbk = za - 26
        hh = 15.0
        p.bx("concrete", (xc - 17, xc + 17), (0, hh), (zbk, za), sub=6.0, bevel=0.12, tint=0.95)
        p.bx("concrete_dark", (xc - 17.8, xc + 17.8), (hh, hh + 1.0), (zbk - 0.8, za), sub=8.0, tint=0.8)
        p.bx("metal_dark", (xc - 12, xc + 12), (hh + 1.0, hh + 4.2), (zbk + 4, za - 5), sub=8.0, tint=0.8)
        for k in range(8):
            xx = xc - 14.4 + k * 4.1
            p.box("glass", (xx, 8.8, zbk - 0.03), (2.6, 8.0, 0.06))
            p.bx("concrete_dark", (xx + 1.55, xx + 2.05), (0, hh), (zbk - 0.35, zbk + 0.02), tint=0.85)
        p.box("metal_dark", (xc, 3.0, zbk - 0.06), (7.0, 6.0, 0.12), tint=0.75)
        p.cbx((xc - 17.8, xc + 17.8), (0, hh + 4.2), (zbk - 0.8, za))
        for dx in (-7.0, 7.0):
            xp = xc + dx
            pts = [(xp, 50.0, zf(xp, 50.0) - 2.4), (xp, 16.5, zf(xp, 16.5) - 2.3)]
            p.tube("metal_dark", pts[0], pts[1], 2.0, sides=8, tint=0.85)
            for k in range(4):
                t = k / 3
                q = tuple(pts[0][i] + (pts[1][i] - pts[0][i]) * t for i in range(3))
                p.cyl("rust", q, 2.18, 0.5, "y", sides=8, tint=0.9)
            for k in range(3):
                t = (k + 0.5) / 3
                q = tuple(pts[0][i] + (pts[1][i] - pts[0][i]) * t for i in range(3))
                p.bx("concrete_dark", (xp - 2.6, xp + 2.6), (q[1] - 1.0, q[1] + 1.0), (q[2] - 0.2, zf(xp, q[1]) + 0.5), tint=0.8)

    # ---------------- rock abutments (heightfield, terraced strata) both sides
    def rock_h(x, z):
        ax = abs(x)
        n1 = noise3(ax * 0.035, 1.3, z * 0.035, 5, 3) * 2 - 1
        n2 = noise3(ax * 0.11, 2.1, z * 0.11, 8, 3) * 2 - 1
        base = 84 + (ax - 100) * 0.6 + n1 * 16 + n2 * 5
        u = base / 8.0
        base = (math.floor(u) + (u - math.floor(u)) ** 2.2) * 8.0
        zfront = zf(100.0, 30.0) - 12 - (ax - 100) * 0.12 + n2 * 6
        t = min(1.0, max(0.0, (z - (zfront - 34)) / 34.0))
        t = t * t * (3 - 2 * t)
        return max(0.0, base * t)
    xsr = [100 + i * 10 for i in range(13)]
    zsr = [-80 + i * 12 for i in range(16)]
    for sx in (-1, 1):
        xs_ = [sx * x for x in xsr]
        if sx < 0:
            xs_ = xs_[::-1]
        p.surface("rock_grey", "rock_grey", xs_, zsr, lambda x, z: rock_h(x, z), flat=True, tint=(0.62, 0.58, 0.54))
    # ---------------- reservoir
    xsw = [-215 + i * 215 for i in range(3)]
    zsw = [zb_(0, 76) - 4 + i * 150 for i in range(3)]
    p.surface("water_dark", "water_dark", xsw, zsw, lambda x, z: 76.0)
    # ---------------- sockets + collision
    p.socket("crest_start", (-100, 80.0, 33.0), 90)
    p.socket("crest_end", (100, 80.0, 33.0), 90)
    p.socket("arena_center", (0, 0, -70))
    p.socket("spillway_center", (0, 62, zf(0, 62)))
    p.chull([(-100, 0, zf(-100, 0)), (100, 0, zf(100, 0)), (-100, 0, zb_(-100, 0)), (100, 0, zb_(100, 0)),
             (-100, H, 24), (100, H, 24), (-100, H, 42), (100, H, 42)])
    # global darkening of the big concrete/rock masses (sun-facing faces clip to white otherwise)
    for a in p.accs.values():
        if a.mat in ("concrete", "concrete_dark", "rock_grey"):
            k = 0.31 if a.mat != "rock_grey" else 0.34
            hue = (1.06, 1.0, 0.92)
            a.tint = [(k * hue[0], k * hue[1], k * hue[2]) if t is None else
                      (tuple(t * k * h for h in hue) if isinstance(t, (int, float)) else (t[0] * k * hue[0], t[1] * k * hue[1], t[2] * k * hue[2])) for t in a.tint]
    return p


if __name__ == "__main__" and ONLY in ("", "dam_wall_backdrop"):
    backdrop().build()

"""dam_gate_big - raider fortress gate over the road (boss spawn).  Road along +Z, origin road centre, z 0..8, road clear x +-7 up to y=11."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dam_common import *

ONLY = os.environ.get("ONLY", "")

PLATE_MATS = [("rust", (0.55, 0.5, 0.45)), ("rust", (0.8, 0.72, 0.65)), ("rust", (0.4, 0.36, 0.33)), ("metal_dark", None), ("metal_dark", (1.5, 1.45, 1.4)),
              ("metal_dark", (1.1, 1.1, 1.1)), ("metal_bare", (0.45, 0.42, 0.38)), ("metal_bare", (0.36, 0.42, 0.42)), ("metal_bare", (0.5, 0.26, 0.2)),
              ("metal_bare", (0.55, 0.5, 0.42))]


def darken(p, mats, k, hue=(1.0, 1.0, 1.0)):
    for a in p.accs.values():
        if a.mat in mats:
            a.tint = [(k * hue[0], k * hue[1], k * hue[2]) if t is None else
                      (tuple(t * k * h for h in hue) if isinstance(t, (int, float)) else (t[0] * k * hue[0], t[1] * k * hue[1], t[2] * k * hue[2])) for t in a.tint]


def scrap_wall(p, origin, u, v, w, h, seed=1, cover=0.8, thick=(0.07, 0.15), wmin=1.3, wmax=2.6, hmin=0.9, hmax=1.7, bolts=0.08, mats=None):
    """Patchwork of bolted scrap plates on a wall face: origin = bottom-left corner, u = across (unit), v = up (unit), n = u x v (outward)."""
    rj = random.Random(seed)
    u, v = Vector(u).normalized(), Vector(v).normalized()
    n = u.cross(v).normalized()
    R = Matrix(((u.x, v.x, n.x), (u.y, v.y, n.y), (u.z, v.z, n.z)))
    mats = mats or PLATE_MATS
    y = 0.0
    row = 0
    while y < h - 0.3:
        hp = min(rj.uniform(hmin, hmax), h - y)
        x = rj.uniform(0, 0.4)
        while x < w - 0.3:
            wp = min(rj.uniform(wmin, wmax), w - x)
            if rj.random() < cover and wp > 0.4:
                mat, tint = rj.choice(mats)
                t = rj.uniform(*thick)
                off = (0.0 if (row + int(x)) % 2 == 0 else 0.03) + t / 2
                c = Vector(origin) + u * (x + wp / 2) + v * (y + hp / 2) + n * off
                ang = rj.uniform(-2.5, 2.5)
                M = Matrix.Translation(c) @ R.to_4x4() @ Euler((0, 0, ang * D2R), "XYZ").to_matrix().to_4x4()
                jit = rj.uniform(0.8, 1.05)
                tt = (jit, jit, jit) if tint is None else tuple(jit * q for q in tint)
                p.box(mat, (0, 0, 0), (wp - 0.04, hp - 0.04, t), M=M, tint=tt)
                if rj.random() < bolts:
                    for sx, sy in ((-1, -1), (1, 1)):
                        q = M @ Vector((sx * (wp / 2 - 0.15), sy * (hp / 2 - 0.15), t / 2 + 0.01))
                        p.cyl("metal_bare", tuple(q), 0.035, 0.03, "z", sides=5, tint=0.7)
            x += wp
        y += hp
        row += 1


def merlons(p, mat, x0, x1, y, z, n, w=1.3, h=1.3, d=1.0, tint=None):
    for i in range(n):
        xc = x0 + (x1 - x0) * (i + 0.5) / n
        p.box(mat, (xc, y + h / 2, z), (w, h, d), tint=tint)


def spike_row(p, pts, length=0.9, r=0.06, d=(0, 1, 0), mat="spike", tilt=0.0, rj=None):
    rj = rj or random.Random(2)
    for c in pts:
        dd = Vector(d) + Vector((rj.uniform(-tilt, tilt), 0, rj.uniform(-tilt, tilt)))
        dd.normalize()
        tip = Vector(c) + dd * length * rj.uniform(0.8, 1.15)
        spike(p, c, tuple(tip), r, mat=mat, sides=5)


def tower(p, s, rj):
    """One gate tower on side s (+1 = +X). Inner face at x = s*7.8."""
    xi, xo = 7.8, 15.6
    a, b = (xi, xo) if s > 0 else (-xo, -xi)
    # plinth + shaft + crown
    p.bx("concrete_dark", (a - 0.4 * (1 if s < 0 else 0), b + 0.4 * (1 if s > 0 else 0)) if False else ((a - 0.0, b + 0.5) if s > 0 else (a - 0.5, b)), (0, 3.4), (-0.4, 8.2), bevel=0.1, sub=4.5, tint=0.8)
    p.bx("concrete", (a + (0.2 if s > 0 else 0), b - (0 if s > 0 else 0.2)), (3.4, 21.0), (0.3, 7.7), bevel=0.12, sub=4.5)
    p.bx("concrete_dark", (a - 0.4, b + 0.4), (21.0, 22.0), (-0.1, 8.1), sub=5.0, tint=0.85)
    p.bx("concrete", (a - 0.6, b + 0.6), (22.0, 23.0), (-0.5, 8.5), sub=5.0, tint=0.9)
    # slit windows (dark) on the front and outer face
    xm = (a + b) / 2
    for yy in (7.0, 11.5, 16.0):
        for k in (-1.8, 1.8):
            p.box("metal_dark", (xm + k, yy, 0.27), (0.5, 2.4, 0.12))
        p.box("metal_dark", (s * 15.55, yy, 4.0), (0.12, 2.4, 0.5))
        p.box("light_amber", (s * 15.5, yy - 1.0, 4.0), (0.05, 0.3, 0.3))
    # scrap plating: front face (-Z) and inner face (facing the road)
    scrap_wall(p, (s * 15.6, 3.4, 0.28), (-s, 0, 0), (0, 1, 0), 7.8, 12.6, seed=11 + s, cover=0.7)
    scrap_wall(p, (s * 15.6, 3.4, 7.7), (0, 0, -1), (0, 1, 0), 7.4, 12.0, seed=41 + s, cover=0.45, wmin=1.6, wmax=2.8) if s < 0 else scrap_wall(p, (s * 15.6, 3.4, 0.3), (0, 0, 1), (0, 1, 0), 7.4, 12.0, seed=41 + s, cover=0.45, wmin=1.6, wmax=2.8)
    # front face n = u x v must be -Z: u=(-s,0,0) v=(0,1,0) -> u x v = (0,0,-s) : ok for s=+1, for s=-1 flip
    scrap_wall(p, (s * 7.78, 3.4, 7.6), (0, 0, -1), (0, 1, 0), 7.3, 10.5, seed=21 + s, cover=0.65) if False else None
    # crown: merlons around front + inner + outer
    merlons(p, "concrete_dark", a - 0.6, b + 0.6, 23.0, -0.5 + 0.5, 7, tint=0.85)
    for k in range(4):
        zc = 1.5 + k * 1.9
        p.box("concrete_dark", (s * 7.2 if False else (a - 0.1 if s > 0 else b + 0.1), 23.65, zc), (1.0, 1.3, 1.3), tint=0.85)
        p.box("concrete_dark", ((b + 0.1 if s > 0 else a - 0.1), 23.65, zc), (1.0, 1.3, 1.3), tint=0.85)
    # spikes along the crown front and inner edge
    xs = [a - 0.4 + (b - a + 0.8) * (i + 0.5) / 12 for i in range(12)]
    spike_row(p, [(x, 24.3, -0.3) for x in xs], length=1.1, d=(0, 1, -0.5), tilt=0.15, rj=rj)
    # brazier + searchlight + beacon on the crown
    xb = b - 1.0 if s > 0 else a + 1.0
    brazier(p, (xb, 23.0, 6.6), r=0.7, h=1.2)
    xs2 = a + 1.0 if s > 0 else b - 1.0
    p.cyl("metal_dark", (xs2, 23.7, 1.4), 0.5, 1.4, "y", sides=8)
    p.box("metal_dark", (xs2, 24.7, 1.4), (0.9, 0.9, 1.0), rot=(18, 0, 0))
    p.cyl("light_head", (xs2, 24.7, 0.86), 0.36, 0.06, "z", sides=10, )
    p.cyl("light_amber", (xb + (-3.4 if s > 0 else 3.4), 23.4, 1.2), 0.3, 0.6, "y", sides=8)
    # tyres + drums at the base (front outside)
    tyre_stack(p, (s * 9.2, 0, -1.4), 3, seed=3 + s)
    tyre_stack(p, (s * 10.5, 0, -1.1), 2, seed=5 + s)
    p.cyl("rust", (s * 8.6, 0.55, -1.6), 0.4, 1.1, "y", sides=8)
    # skull poles at front corners of the crown
    for xx in (a - 0.3, b + 0.3):
        p.tube("metal_dark", (xx, 23.0, -0.3), (xx, 26.0, -0.3), 0.07, sides=5)
        skull(p, (xx, 26.35, -0.25), s=0.75, yaw=180, detail=0)
    # hazard stripes on the road-facing plinth edge (vertical bars) + door track
    rj2 = random.Random(4 + s)
    xin = s * 7.79
    n = 12
    for i in range(n):
        y0 = i * (3.4 / n)
        col = yellow(rj2) if i % 2 == 0 else black(rj2)
        q = [(xin - s * 0.02, y0, 0.0), (xin - s * 0.02, y0 + 3.4 / n, 0.0), (xin - s * 0.02, y0 + 3.4 / n, 0.0)]
    # blast-door leaf parked on the inner face: slab with hazard leading edge
    xl0, xl1 = (7.0, 7.8) if s > 0 else (-7.8, -7.0)
    p.bx("metal_dark", (xl0, xl1), (0.3, 10.6), (1.0, 7.4), sub=4.0, tint=0.8)
    for zz in (2.2, 4.2, 6.2):
        p.bx("rust", (xl0 - 0.05 if s > 0 else xl1 - 0.02, xl1 + 0.02 if s > 0 else xl0 + 0.05), (0.4, 10.5), (zz, zz + 0.16), tint=0.85)
    for i in range(14):
        yy = 0.3 + i * 0.75
        col = yellow(rj2) if i % 2 == 0 else black(rj2)
        xa_, xb_ = (xl0 - 0.012, xl0 + 0.012)
        q = [(xl0 - s * 0.012, yy, 1.0), (xl0 - s * 0.012, yy + 0.75, 1.0), (xl0 - s * 0.012, yy + 0.75, 1.55), (xl0 - s * 0.012, yy, 1.55)]
        p.quad("hazard", *(q if s < 0 else q[::-1]), tint=col)
    # road-side rails (top track + bottom rail)
    p.bx("rust", (xl0 - 0.1 if s > 0 else xl1 - 0.02, xl1 + 0.02 if s > 0 else xl0 + 0.1), (10.6, 11.2), (0.9, 7.6), tint=0.85)
    p.cbx((a - 0.5, b + 0.5), (0, 23.0), (-0.4, 8.3))


def build():
    p = Piece("dam_gate_big", seed=61, ground_y=0, dirt_h=2.5, dirt_amt=0.55, ao_dist=3.0, streak_amt=0.3, noise_amt=0.3)
    p.notes = dict(
        desc="Raider fortress blast gate spanning the road (boss spawn). Road along +Z, origin road centre, gate front faces -Z (toward the player), depth z 0..8. "
             "Road clear width 14 (x +-7), clearance 11 m to the portcullis spikes. Two 26 m towers with scrap plating, braziers, searchlights, skulls; lintel gatehouse with big horned skull emblem; banners.",
        clearance=11.0, road_clear=14.0, tower_height=27.0,
        spawn="sockets spawn_center (0,0,6), spawn_L (-3.5,0,6), spawn_R (3.5,0,6): boss/escort spawn points inside the gate; flame_* = brazier fire positions, light_* = searchlight positions",
        banners_hang_min_y=7.3)
    rj = random.Random(61)
    for s in (-1, 1):
        tower(p, s, rj)
    # ---- lintel gatehouse
    zl0, zl1 = 0.5, 7.5
    p.bx("concrete_dark", (-8.2, 8.2), (11.8, 17.6), (zl0, zl1), bevel=0.1, sub=4.0, tint=0.8)
    p.bx("concrete", (-8.6, 8.6), (17.6, 18.5), (zl0 - 0.5, zl1 + 0.5), sub=5.0, tint=0.9)
    # scrap plating on the front of the lintel
    scrap_wall(p, (8.2, 11.8, zl0 - 0.01), (-1, 0, 0), (0, 1, 0), 16.4, 5.8, seed=71, cover=0.85, wmin=1.4, wmax=2.8, hmin=1.0, hmax=1.8)
    # hazard band under the front edge + soffit ribs
    rj2 = random.Random(8)
    nb = 28
    for i in range(nb):
        xa_, xb_ = -8.2 + 16.4 * i / nb, -8.2 + 16.4 * (i + 1) / nb
        col = yellow(rj2) if i % 2 == 0 else black(rj2)
        p.quad("hazard", (xa_, 11.85, zl0 - 0.14), (xb_, 11.85, zl0 - 0.14), (xb_ - 0.2, 12.7, zl0 - 0.14), (xa_ - 0.2, 12.7, zl0 - 0.14), tint=col) if False else None
        p.quad("hazard", (xb_, 11.82, zl0 - 0.16), (xa_, 11.82, zl0 - 0.16), (xa_ + 0.15, 12.55, zl0 - 0.16), (xb_ + 0.15, 12.55, zl0 - 0.16), tint=col)
    for xx in (-6.0, -2.0, 2.0, 6.0):
        p.bx("steel_beam", (xx - 0.2, xx + 0.2), (11.6, 11.8), (zl0, zl1), tint=0.7)
    # portcullis spikes hanging down (tips at y=11.0)
    for i in range(27):
        x = -6.9 + i * 0.53
        p.tube("spike", (x, 11.8, 4.0), (x, 11.0, 4.0), 0.07, sides=4, r2=0.0, smooth=False, tint=0.6)
    p.bx("rust", (-7.2, 7.2), (11.8, 12.1), (3.88, 4.12), tint=0.8)
    # emblem: big horned skull on the front face
    skull(p, (0, 14.7, zl0 - 0.6), s=3.6, yaw=180, detail=2)
    for sx in (-1, 1):
        pts = [(0.0, 0.0), (0.7, 0.35), (1.35, 1.0), (1.55, 1.9), (1.3, 2.6)]
        prev = None
        for (dx, dy) in pts:
            cur = (sx * (1.6 + dx), 15.5 + dy, zl0 - 0.7)
            if prev is not None:
                p.tube("bone", prev, cur, 0.22, sides=6, r2=0.18, smooth=True)
            prev = cur
        p.tube("bone", prev, (prev[0] + sx * 0.2, prev[1] + 0.9, prev[2]), 0.16, sides=6, r2=0.02)
    # crossed spears/pipes behind the skull
    p.beam("rust", (-4.2, 12.6, zl0 - 0.35), (4.2, 16.8, zl0 - 0.35), 0.22, 0.22, up=(0, 0, 1))
    p.beam("rust", (4.2, 12.6, zl0 - 0.35), (-4.2, 16.8, zl0 - 0.35), 0.22, 0.22, up=(0, 0, 1))
    # roof deck: railing spikes, skull row, searchlights, warning beacons
    xs = [-8.4 + 16.8 * (i + 0.5) / 22 for i in range(22)]
    spike_row(p, [(x, 18.5, zl0 - 0.35) for x in xs], length=1.2, d=(0, 1, -0.35), tilt=0.1, rj=rj)
    for i in range(5):
        x = -6.0 + i * 3.0
        p.tube("metal_dark", (x, 18.5, zl0 - 0.2), (x, 20.2, zl0 - 0.2), 0.06, sides=5)
        skull(p, (x, 20.55, zl0 - 0.2), s=0.62, yaw=180, detail=0)
    for x in (-4.5, 0.0, 4.5):
        p.cyl("metal_dark", (x, 19.2, 3.8), 0.4, 1.4, "y", sides=8)
        p.box("metal_dark", (x, 20.2, 3.8), (1.0, 0.9, 1.1), rot=(20, 0, 0))
        p.cyl("light_head", (x, 20.2, 3.22), 0.38, 0.06, "z", sides=10)
    for x in (-8.0, 8.0):
        p.cyl("metal_dark", (x, 18.7, 1.0), 0.28, 0.4, "y", sides=8)
        p.cyl("light_amber", (x, 19.05, 1.0), 0.24, 0.45, "y", sides=8)
    # red lamp row under the lintel front edge
    for i in range(9):
        p.box("light_tail", (-7.2 + i * 1.8, 11.35, zl0 + 0.4), (0.3, 0.16, 0.3))
    # banners: two big ones on the tower fronts, two smaller ones inside the gate
    def banner_tint(fx):
        def f(s_, t_):
            k = 0.9 + 0.15 * math.sin(s_ * 8 + t_ * 5)
            return (0.75 * k * (1 - 0.35 * t_), 0.08 * k, 0.05 * k)
        return f
    for s in (-1, 1):
        xc = s * 11.7
        cloth(p, "canvas", (xc + 2.0, 21.6, -0.45), (-1, 0, 0), (0, -1, 0), 4.0, 13.5, nu=6, nv=10, amp=0.25, wl=3.0, phase=s, tatter=0.22, seed=5 + s,
              tint_fn=banner_tint(s), out=(0, 0, -1))
        skull(p, (xc, 17.0, -0.9), s=2.3, yaw=180, detail=1)
        p.tube("metal_dark", (xc + 2.4, 21.9, -0.5), (xc - 2.4, 21.9, -0.5), 0.08, sides=5)
        cloth(p, "canvas", (s * 5.4 + 0.9, 11.75, 3.2), (-1, 0, 0), (0, -1, 0), 1.8, 4.4, nu=4, nv=6, amp=0.2, wl=2.0, phase=2 + s, tatter=0.3, seed=9 + s,
              tint_fn=banner_tint(s), out=(0, 0, 1))
        p.tube("metal_dark", (s * 5.4 + 1.0, 11.8, 3.2), (s * 5.4 - 1.0, 11.8, 3.2), 0.05, sides=5)
    # fire barrels at the front corners (outside road)
    for s in (-1, 1):
        brazier(p, (s * 8.6, 0, -2.4), r=0.5, h=1.0)
    # chains: swags from tower crowns to lintel roof
    for s in (-1, 1):
        prev = None
        for i in range(9):
            t = i / 8
            x = s * (8.2 - 0.0) + (-s) * 0.0
            xx = s * (15.0 - 14.5 * t)
            yy = 23.4 - (5.0 * t) - 1.3 * math.sin(math.pi * t)
            cur = (xx, yy, -0.4)
            if prev:
                p.tube("metal_dark", prev, cur, 0.06, sides=4, smooth=False)
            prev = cur
    # sockets + collision
    p.socket("spawn_center", (0, 0, 6.0))
    p.socket("spawn_L", (3.5, 0, 6.0))
    p.socket("spawn_R", (-3.5, 0, 6.0))
    for s in (-1, 1):
        p.socket("flame_%s" % ("L" if s > 0 else "R"), (s * 8.6, 1.2, -2.4))
        p.socket("light_%s" % ("L" if s > 0 else "R"), (s * (7.8 + 1.0), 24.7, 1.4))
    p.cbx((-8.6, 8.6), (11.6, 18.5), (0.0, 8.0))
    darken(p, ("concrete", "concrete_dark"), 0.5, (1.05, 1.0, 0.93))
    return p


if __name__ == "__main__" and ONLY in ("", "dam_gate_big"):
    build().build()

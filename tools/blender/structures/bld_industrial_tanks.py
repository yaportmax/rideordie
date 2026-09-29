"""industrial_tanks (fork B2)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_industrial_lib import *


def tank(p, cx, cz, r, h, mat, roof, n=20, courses=None, tint=None):
    courses = courses or max(3, int(h / 2.3))
    ys = [h * i / courses for i in range(courses + 1)]
    revolve(p, mat, cx, cz, [(r, y) for y in ys], n, sub=3.0, tint=tint)
    for y in ys[1:-1]:
        revolve(p, "metal_dark", cx, cz, [(r + 0.035, y - 0.07), (r + 0.035, y + 0.07)], n)
    p.cyl("concrete_dark", (cx, 0.22, cz), r + 0.55, 0.44, "y", sides=n)
    if roof == "cone":
        prof = [(r + 0.12, h), (r + 0.12, h + 0.14), (r * 0.7, h + 1.5), (r * 0.36, h + 2.4), (0.0, h + 3.1)]
        revolve(p, mat, cx, cz, prof, n, sub=3.5, tint=tint)
        for k in range(10):
            a = k * 36
            x0, z0 = polar(cx, cz, r + 0.1, a)
            x1, z1 = polar(cx, cz, 0.3, a)
            p.tube("metal_dark", (x0, h + 0.16, z0), (x1, h + 3.05, z1), 0.05, sides=4, smooth=False)
        p.cyl("metal_dark", (cx, h + 3.3, cz), 0.45, 0.5, "y", sides=8)
    elif roof == "dome":
        prof = [(r + 0.1, h), (r + 0.1, h + 0.1)]
        for t in (0.25, 0.5, 0.75, 0.92, 1.0):
            a = t * math.pi / 2
            prof.append((r * math.cos(a) * 0.99 if t < 1 else 0.0, h + 0.1 + r * 0.42 * math.sin(a)))
        revolve(p, mat, cx, cz, prof, n, sub=3.5, tint=tint)
        p.cyl("metal_dark", (cx, h + 0.1 + r * 0.42 + 0.2, cz), 0.55, 0.5, "y", sides=8)
    else:   # floating roof: rim band + sunken deck (you can see down into the tank)
        revolve(p, "metal_dark", cx, cz, [(r + 0.06, h - 0.1), (r + 0.06, h + 0.9)], n)
        revolve(p, "rust", cx, cz, [(0.0, h - 1.4), (r - 0.05, h - 1.4)], n, sub=2.5)
        revolve(p, "rust", cx, cz, [(r - 0.02, h - 1.4), (r - 0.02, h - 0.1)], n, inward=True)
        p.cyl("metal_dark", (cx + 1.5, h - 1.3, cz - 1.0), 0.9, 0.3, "y", sides=10)
        p.cyl("metal_dark", (cx - 2.0, h - 1.3, cz + 1.5), 0.6, 0.25, "y", sides=10)
        # rim catwalk plate
        revolve(p, "metal_dark", cx, cz, [(r + 0.06, h + 0.9), (r - 0.5, h + 0.92)], n, inward=True)
    p.cyl("metal_bare", (cx + 1.6, 1.1, cz + r + 0.05), 0.5, 0.14, "z", sides=10)
    p.cyl("metal_dark", (cx + 1.6, 1.1, cz + r + 0.05), 0.4, 0.2, "z", sides=10)


def spiral_stairs(p, cx, cz, r, h, a0, turns=1.2, width=0.85, step_h=0.3, cw=1, mat="metal_dark", top_pad=True):
    m = max(6, int(h / step_h))
    y_lo, y_hi = 0.35, h + 0.3
    outer = []
    for k in range(m + 1):
        a = a0 + cw * 360 * turns * k / m
        y = y_lo + (y_hi - y_lo) * k / m
        c = polar(cx, cz, r + 0.12 + width / 2, a)
        if k < m:
            p.box(mat, (c[0], y, c[1]), (width, 0.06, 0.62), rot=(0, -a, 0), skip=("ny",))
        o = polar(cx, cz, r + 0.12 + width, a)
        outer.append((o[0], y + 1.0, o[1]))
    for k in range(0, m, 3):
        p.tube("metal_dark", outer[k], outer[min(k + 3, m)], 0.022, sides=4, smooth=False)
        p.tube("metal_dark", (outer[k][0], outer[k][1] - 1.0, outer[k][2]), outer[k], 0.02, sides=4, smooth=False)
    if top_pad:
        a = a0 + cw * 360 * turns
        for da in range(0, 60, 15):
            c = polar(cx, cz, r + 0.12 + width / 2, a + cw * da)
            p.box(mat, (c[0], y_hi, c[1]), (width, 0.06, 0.62), rot=(0, -(a + cw * da), 0), skip=("ny",))


def valve(p, pos, r=0.3):
    x, y, z = pos
    p.cyl("metal_dark", (x, y, z), r * 0.8, r * 1.2, "x", sides=8)
    p.tube("metal_dark", (x, y, z), (x, y + r * 1.6, z), 0.04, sides=4, smooth=False)
    p.cyl("rust", (x, y + r * 1.65, z), r * 0.8, 0.05, "y", sides=8)


def industrial_tanks():
    p = Piece("industrial_tanks", seed=41, ground_y=0.0, dirt_h=2.5, dirt_amt=0.5, streak_amt=0.4, noise_amt=0.34, ao_dist=3.0)
    p.notes = dict(desc="Tank farm: 3 big tanks (cone roof, floating roof, dome roof) on a concrete pad with a cracked bund wall, elevated pipe rack along the +Z front, spiral stairs, roof catwalk bridge.",
                   footprint=[52, 34], max_height=15.0, pipe_rack="along +X at z=12.5, y=5.8", bund_gap="+Z front, x in [-3, 3]")
    A = (-14.0, 0.0, 7.5, 12.5)
    B = (2.5, -0.5, 6.5, 10.0)
    C = (17.0, 1.0, 5.5, 14.5)
    p.bx("concrete_dark", (-25.5, 26.0), (0, 0.16), (-14.5, 16.5), skip=("ny",), sub=5.5)
    tank(p, A[0], A[1], A[2], A[3], "paint", "cone", n=22, tint=0.66)
    tank(p, B[0], B[1], B[2], B[3], "rust", "float", n=20)
    tank(p, C[0], C[1], C[2], C[3], "paint2", "dome", n=18, tint=0.66)
    spiral_stairs(p, A[0], A[1], A[2], A[3], a0=100, turns=1.15, cw=1)
    spiral_stairs(p, C[0], C[1], C[2], C[3], a0=60, turns=1.3, cw=-1)
    ladder(p, (B[0] + B[2] + 0.08, 0.4, B[1] + 1.5), (B[0] + B[2] + 0.08, B[3] + 0.9, B[1] + 1.5), width=0.5, rung=0.45, side=(0, 0, 1))

    def bridge(a, b, w=0.9):
        p.beam("metal_dark", a, b, w, 0.1)
        d = Vector(b) - Vector(a)
        nrm = Vector((-d.z, 0, d.x)).normalized() * (w / 2 + 0.03)
        for s in (-1, 1):
            railing(p, [Vector(a) + nrm * s, Vector(b) + nrm * s], h=1.05, post_every=1.9, rails=2)
    bridge((A[0] + A[2] - 0.6, A[3] + 1.45, 0.0), (B[0] - B[2] + 0.5, B[3] + 0.9, 0.0))
    bridge((B[0] + B[2] - 0.5, B[3] + 0.9, 0.5), (C[0] - C[2] + 0.5, C[3] + 0.55, 0.5))
    rp = [(polar(A[0], A[1], A[2] - 0.35, k * 360 / 20)[0], A[3] + 0.16, polar(A[0], A[1], A[2] - 0.35, k * 360 / 20)[1]) for k in range(20)]
    railing(p, rp, h=1.05, closed=True, post_every=3.0, rails=1, skip=lambda i: i in (3, 4, 5, 6))
    # pipe rack along +X
    zr, yr = 12.5, 5.8
    for x in (-22, -14, -6, 2, 10, 18):
        for dz in (-1.4, 1.4):
            p.bx("steel_beam", (x - 0.14, x + 0.14), (0, yr), (zr + dz - 0.14, zr + dz + 0.14))
            p.box("concrete_dark", (x, 0.15, zr + dz), (0.7, 0.3, 0.7))
        p.bx("steel_beam", (x - 0.14, x + 0.14), (yr - 0.16, yr), (zr - 1.6, zr + 1.6))
        p.beam("steel_beam", (x, 0.6, zr - 1.4), (x, yr - 0.16, zr + 1.4), 0.08, 0.08)
    pipes = [(-0.9, 0.36, "metal_dark"), (0.0, 0.28, "rust"), (0.8, 0.22, "metal_bare"), (1.3, 0.16, "metal_dark")]
    for dz, rr, mm in pipes:
        p.tube(mm, (-24.0, yr + rr + 0.02, zr + dz), (21.0, yr + rr + 0.02, zr + dz), rr, sides=10)
        for x in (-14, 2, 14):
            p.cyl("metal_dark", (x, yr + rr + 0.02, zr + dz), rr + 0.05, 0.16, "x", sides=8)
    for (cx, cz, r, h) in (A, B, C):
        xx = cx + 1.6
        top = yr + 0.66
        pipe(p, [(xx, top, zr - 0.9), (xx, 1.1, zr - 0.9), (xx, 1.1, cz + r + 0.1)], r=0.16, sides=8)
        valve(p, (xx, 1.1, (zr - 0.9 + cz + r) / 2 + 0.4))
    # bund wall (front gap, broken back-left)
    def wall(x0, x1, z0, z1):
        p.bx("concrete", (x0, x1), (0, 1.15), (z0, z1), skip=("ny",), sub=4.5)
        p.bx("concrete_dark", (x0 - 0.05, x1 + 0.05), (1.15, 1.28), (z0 - 0.05, z1 + 0.05), skip=("ny",), sub=6.0)
    wall(-25.5, -3.0, 15.75, 16.25)
    wall(3.0, 26.0, 15.75, 16.25)
    wall(-11.0, 26.0, -14.5, -14.0)
    wall(-25.5, -25.0, -9.0, 16.25)
    wall(25.5, 26.0, -14.5, 16.25)
    for k in range(8):
        x = -11.05 - k * 0.45
        p.tube("rebar", (x, 1.28, -14.25), (x - 0.1, 1.28 + 0.5 + 0.2 * (k % 3), -14.25 + 0.1 * (k % 2)), 0.012, sides=4, smooth=False)
    for (cx, cz, r, h) in (A, B, C):
        p.chull([(polar(cx, cz, r + 0.05, a * 360 / 12)[0], y, polar(cx, cz, r + 0.05, a * 360 / 12)[1]) for a in range(12) for y in (0.0, h + 1.0)])
    for x in (-22, -14, -6, 2, 10, 18):
        p.cbx((x - 0.2, x + 0.2), (0, yr), (zr - 1.5, zr - 1.2))
        p.cbx((x - 0.2, x + 0.2), (0, yr), (zr + 1.2, zr + 1.5))
    p.cbx((-25.5, -3.0), (0, 1.3), (15.7, 16.3))
    p.cbx((3.0, 26.0), (0, 1.3), (15.7, 16.3))
    p.cbx((-11.0, 26.0), (0, 1.3), (-14.5, -14.0))
    p.cbx((-25.5, -25.0), (0, 1.3), (-9.0, 16.3))
    p.cbx((25.5, 26.0), (0, 1.3), (-14.5, 16.3))
    p.socket("gate", (0, 0, 16.0))
    return p

"""dam_control_tower - concrete control tower / gatehouse (28 m) with cantilevered glass control cab, radar, antenna, searchlight."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dam_common import *
from dam_gate import darken, scrap_wall, spike_row

ONLY = os.environ.get("ONLY", "")


def stair(p, x, z0, z1, y0, y1, width=1.1, treads=16, side=1):
    """Straight steel stair from (x,z0,y0) to (x,z1,y1) along Z with stringers, treads and railings on both sides."""
    n = treads
    for i in range(n):
        t = (i + 0.5) / n
        z = z0 + (z1 - z0) * t
        y = y0 + (y1 - y0) * (i + 1) / n
        p.bx("metal_bare", (x - width / 2, x + width / 2), (y - 0.05, y), (z - abs(z1 - z0) / n / 2 - 0.02, z + abs(z1 - z0) / n / 2 + 0.02), tint=0.6)
    for s in (-1, 1):
        xx = x + s * (width / 2 + 0.03)
        p.beam("steel_beam", (xx, y0 - 0.1, z0), (xx, y1 - 0.1, z1), 0.05, 0.3, up=(1, 0, 0), tint=0.7)
        p.tube("metal_dark", (xx, y0 + 1.0, z0), (xx, y1 + 1.0, z1), 0.028, sides=4, smooth=False)
        for i in range(0, n + 1, 4):
            t = i / n
            p.tube("metal_dark", (xx, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t), (xx, y0 + (y1 - y0) * t + 1.0, z0 + (z1 - z0) * t), 0.028, sides=4, smooth=False)


def dish(p, c, r=1.7, depth=0.55, yaw=0.0, pitch=-25.0, seg=12, rings=4):
    pts = []
    for j in range(rings + 1):
        rr = r * j / rings
        for i in range(seg):
            a = 2 * math.pi * i / seg
            pts.append((rr * math.cos(a), rr * math.sin(a), depth * (rr / r) ** 2))
    M = xf(c, (pitch, yaw, 0))
    p.mesh_grid("metal_bare", pts, seg, rings + 1, closed_u=True, M=M, flat=False, tint=0.75)
    p.mesh_grid("metal_bare", pts, seg, rings + 1, closed_u=True, flip=True, M=M, tint=0.6)
    # feed horn + arm
    tip = M @ Vector((0, 0, depth + 1.2))
    base = M @ Vector((0, 0, depth * 0.1))
    p.tube("metal_dark", tuple(base), tuple(tip), 0.05, sides=5)
    p.box("metal_dark", (0, 0, 0), (0.25, 0.25, 0.3), M=M @ Matrix.Translation((0, 0, depth + 1.2)), tint=0.8)
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.5
        p.tube("metal_dark", tuple(M @ Vector((r * 0.8 * math.cos(a), r * 0.8 * math.sin(a), depth * 0.64))), tuple(tip), 0.03, sides=4, smooth=False)


def build():
    p = Piece("dam_control_tower", seed=91, ground_y=0, dirt_h=3.0, dirt_amt=0.5, ao_dist=3.0, streak_amt=0.35, noise_amt=0.3)
    p.notes = dict(desc="Concrete dam control tower / gatehouse, 28 m + antenna (top ~36 m). Origin base centre on the crest, front (entrance, exterior stair, banner) faces +Z. Footprint podium 15 x 11 m. Half the cab glass is smashed; raider banner + spikes on the roof.",
                   height=36.0, footprint=[15.0, 11.0], sockets="searchlight (beam origin), roof_beacon, door (entrance, +Z)")
    rj = random.Random(91)
    # ---- podium
    p.bx("concrete_dark", (-7.5, 7.5), (0, 6.0), (-5.5, 5.5), bevel=0.1, sub=3.5, tint=0.85)
    p.bx("concrete", (-7.9, 7.9), (6.0, 6.7), (-5.9, 5.9), bevel=0.05, sub=4.0, tint=0.9)                # podium roof slab
    for sx in (-1, 1):
        for k in range(5):
            xx = sx * (2.0 + k * 1.1)
    for k in range(-3, 4):
        p.bx("concrete", (k * 2.0 - 0.22, k * 2.0 + 0.22), (0, 5.95), (5.5, 5.82), tint=0.9)              # pilasters front
        p.bx("concrete", (k * 2.0 - 0.22, k * 2.0 + 0.22), (0, 5.95), (-5.82, -5.5), tint=0.9)
    # front: big door + slit windows
    p.box("metal_dark", (0, 1.7, 5.52), (3.6, 3.4, 0.14), tint=0.8)
    for sx in (-1, 1):
        p.bx("hazard", (sx * 1.8 - 0.1 + sx * 0.0, sx * 1.8 + 0.1), (0, 3.5), (5.5, 5.62), tint=(0.95, 0.5, 0.02) if sx > 0 else (0.03, 0.03, 0.035))
    p.box("light_amber", (0, 3.75, 5.6), (0.5, 0.2, 0.15))
    for k in (-5.0, -3.4, 3.4, 5.0):
        p.box("metal_dark", (k, 3.4, 5.52), (0.9, 1.7, 0.1), tint=0.7)
    # ---- shaft with corner pilasters + window strips
    y0, y1 = 6.7, 21.0
    p.bx("concrete", (-3.4, 3.4), (y0, y1), (-3.4, 3.4), bevel=0.12, sub=3.5)
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.bx("concrete", (sx * 3.4 - 0.35 + (0.35 if sx > 0 else 0) * 0 - (0.0), sx * 3.4 + 0.35), (y0, y1 - 0.5), (sz * 3.4 - 0.35, sz * 3.4 + 0.35), bevel=0.08, tint=0.92) if False else None
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.bx("concrete_dark", (sx * 3.4 - 0.4, sx * 3.4 + 0.4), (y0, y1 - 0.4), (sz * 3.4 - 0.4, sz * 3.4 + 0.4), bevel=0.06, sub=4.0, tint=0.85)
    for yy in (9.6, 13.0, 16.4, 19.5):
        for face in range(4):
            for k in (-1.2, 1.2):
                if face == 0:
                    p.box("glass", (k, yy, 3.42), (0.9, 1.6, 0.04)); p.box("metal_dark", (k, yy, 3.44), (1.1, 1.8, 0.05), tint=0.6)
                elif face == 1:
                    p.box("glass", (k, yy, -3.42), (0.9, 1.6, 0.04)); p.box("metal_dark", (k, yy, -3.44), (1.1, 1.8, 0.05), tint=0.6)
                elif face == 2:
                    p.box("glass", (3.42, yy, k), (0.04, 1.6, 0.9)); p.box("metal_dark", (3.44, yy, k), (0.05, 1.8, 1.1), tint=0.6)
                else:
                    p.box("glass", (-3.42, yy, k), (0.04, 1.6, 0.9)); p.box("metal_dark", (-3.44, yy, k), (0.05, 1.8, 1.1), tint=0.6)
    # ---- corbels + control cab
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.beam("concrete_dark", (sx * 3.3, 18.6, sz * 3.3), (sx * 6.8, 21.1, sz * 5.9), 0.9, 0.9, tint=0.8)
    p.bx("concrete", (-7.6, 7.6), (21.0, 21.8), (-6.6, 6.6), bevel=0.08, sub=4.0, tint=0.9)
    cab0, cab1 = 21.8, 26.6
    p.bx("metal_dark", (-7.3, 7.3), (cab0, cab1), (-6.3, 6.3), tint=0.7)       # dark interior
    # consoles (glowing) inside
    for k in range(4):
        p.bx("metal_dark", (-6.0 + k * 3.1, -3.9 + k * 3.1), (cab0, cab0 + 1.0), (4.6, 5.6), tint=0.9)
        p.bx("light_green" if k % 2 == 0 else "light_amber", (-5.8 + k * 3.1, -4.1 + k * 3.1), (cab0 + 1.0, cab0 + 1.06), (4.7, 5.5))
    # glass ribbon + mullions all around (some panes smashed)
    def wall_panes(a, b, fixed, axis, n, seed):
        rr = random.Random(seed)
        for i in range(n):
            t0, t1 = a + (b - a) * i / n, a + (b - a) * (i + 1) / n
            tm = (t0 + t1) / 2
            if rr.random() < 0.62:
                if axis == "x":
                    p.quad("glass", (t0, cab0 + 0.2, fixed), (t1, cab0 + 0.2, fixed), (t1, cab1 - 0.15, fixed), (t0, cab1 - 0.15, fixed)) if fixed > 0 else \
                        p.quad("glass", (t1, cab0 + 0.2, fixed), (t0, cab0 + 0.2, fixed), (t0, cab1 - 0.15, fixed), (t1, cab1 - 0.15, fixed))
                else:
                    p.quad("glass", (fixed, cab0 + 0.2, t1), (fixed, cab0 + 0.2, t0), (fixed, cab1 - 0.15, t0), (fixed, cab1 - 0.15, t1)) if fixed > 0 else \
                        p.quad("glass", (fixed, cab0 + 0.2, t0), (fixed, cab0 + 0.2, t1), (fixed, cab1 - 0.15, t1), (fixed, cab1 - 0.15, t0))
            # mullion
            if axis == "x":
                p.bx("steel_beam", (t0 - 0.06, t0 + 0.06), (cab0, cab1), (fixed - 0.1, fixed + 0.1), tint=0.7)
            else:
                p.bx("steel_beam", (fixed - 0.1, fixed + 0.1), (cab0, cab1), (t0 - 0.06, t0 + 0.06), tint=0.7)
    # (walls are 0.02 in front of the dark interior; faces are quads facing outward)
    wall_panes(-7.3, 7.3, 6.32, "x", 8, 1)
    wall_panes(-7.3, 7.3, -6.32, "x", 8, 2)
    wall_panes(-6.3, 6.3, 7.32, "z", 7, 3)
    wall_panes(-6.3, 6.3, -7.32, "z", 7, 4)
    for yy in (cab0 + 0.1, cab1 - 0.1):
        p.bx("steel_beam", (-7.4, 7.4), (yy - 0.08, yy + 0.08), (6.25, 6.45), tint=0.7)
        p.bx("steel_beam", (-7.4, 7.4), (yy - 0.08, yy + 0.08), (-6.45, -6.25), tint=0.7)
        p.bx("steel_beam", (7.25, 7.45), (yy - 0.08, yy + 0.08), (-6.4, 6.4), tint=0.7)
        p.bx("steel_beam", (-7.45, -7.25), (yy - 0.08, yy + 0.08), (-6.4, 6.4), tint=0.7)
    # ---- roof slab + parapet + roof kit
    p.bx("concrete", (-8.4, 8.4), (cab1, cab1 + 0.7), (-7.3, 7.3), bevel=0.06, sub=4.0, tint=0.9)
    p.bx("concrete_dark", (-8.4, 8.4), (cab1 + 0.7, cab1 + 1.3), (7.0, 7.3), sub=4.0, tint=0.8)
    p.bx("concrete_dark", (-8.4, 8.4), (cab1 + 0.7, cab1 + 1.3), (-7.3, -7.0), sub=4.0, tint=0.8)
    p.bx("concrete_dark", (8.1, 8.4), (cab1 + 0.7, cab1 + 1.3), (-7.3, 7.3), sub=4.0, tint=0.8)
    p.bx("concrete_dark", (-8.4, -8.1), (cab1 + 0.7, cab1 + 1.3), (-7.3, 7.3), sub=4.0, tint=0.8)
    ry = cab1 + 0.7
    dish(p, (-3.6, ry + 3.2, 0.0), r=1.9, yaw=-40, pitch=-30)
    p.tube("steel_beam", (-3.6, ry, 0), (-3.6, ry + 3.2, 0), 0.16, sides=8)
    p.cyl("metal_dark", (-3.6, ry + 0.3, 0), 0.5, 0.6, "y", sides=8)
    # antenna lattice mast
    lattice_tower(p, "steel_beam", 4.4, -2.6, ry, 8.0, 0.55, 0.22, 5, leg=0.05, brace=0.03, sides=4, stagger=True)
    p.tube("metal_dark", (4.4, ry + 8.0, -2.6), (4.4, ry + 9.6, -2.6), 0.04, sides=4, smooth=False)
    p.cyl("light_tail", (4.4, ry + 9.75, -2.6), 0.14, 0.2, "y", sides=8)
    p.socket("roof_beacon", (4.4, ry + 9.8, -2.6))
    # searchlight
    p.cyl("metal_dark", (5.5, ry + 0.6, 3.5), 0.45, 1.2, "y", sides=8)
    p.box("metal_dark", (5.5, ry + 1.5, 3.5), (1.0, 0.9, 1.1), rot=(15, 0, 0))
    p.cyl("light_head", (5.5, ry + 1.5, 4.06), 0.4, 0.06, "z", sides=10)
    p.socket("searchlight", (5.5, ry + 1.5, 4.1))
    # roof AC units + water tank on legs
    for k in range(2):
        p.bx("metal_bare", (-7.5 + k * 1.9, -6.3 + k * 1.9), (ry, ry + 0.9), (3.6, 5.2), bevel=0.02, tint=0.7)
        p.cyl("metal_dark", (-6.9 + k * 1.9, ry + 0.92, 4.4), 0.42, 0.05, "y", sides=10)
    # ---- raider takeover: spikes on the roof edge, banner, skulls
    spike_row(p, [(-8.2 + 16.4 * (i + 0.5) / 18, cab1 + 1.3, 7.2) for i in range(18)], length=1.1, d=(0, 1, 0.45), tilt=0.1, rj=rj)
    def tf(s_, t_):
        k = 0.9 + 0.15 * math.sin(s_ * 7 + t_ * 5)
        return (0.75 * k * (1 - 0.35 * t_), 0.08 * k, 0.05 * k)
    cloth(p, "canvas", (2.6, cab1 + 0.6, 7.45), (-1, 0, 0), (0, -1, 0), 5.2, 12.0, nu=8, nv=14, amp=0.35, wl=3.4, tatter=0.25, seed=13, tint_fn=tf, out=(0, 0, 1))
    skull(p, (0.0, cab1 - 4.5, 7.8), s=2.6, yaw=0, detail=1)
    p.tube("metal_dark", (-2.9, cab1 + 0.5, 7.45), (2.9, cab1 + 0.5, 7.45), 0.07, sides=5)
    for xs in (-8.2, 8.2):
        p.tube("metal_dark", (xs, cab1 + 1.3, 7.1), (xs, cab1 + 3.0, 7.1), 0.06, sides=5)
        skull(p, (xs, cab1 + 3.3, 7.1), s=0.7, yaw=0, detail=0)
    # exterior stair up the +X side of the podium, plus tank + drums at the base
    stair(p, 8.4, 3.5, -4.2, 0.0, 6.7, width=1.1, treads=15)
    p.bx("steel_beam", (7.8, 9.1), (6.6, 6.75), (-5.2, -3.9), tint=0.7)
    p.cyl("rust", (-11.2, 1.5, 1.0), 1.5, 3.0, "y", sides=12)
    p.tube("metal_dark", (-11.2, 3.0, 1.0), (-9.4, 5.0, 2.5), 0.12, sides=5)
    for k in range(3):
        p.cyl("metal_dark", (-9.8 + k * 0.9, 0.55, -3.3), 0.4, 1.1, "y", sides=8)
    # scrap plates on the front of the podium (raider patches)
    scrap_wall(p, (5.6, 0.2, 5.55), (-1, 0, 0), (0, 1, 0), 2.6, 4.5, seed=17, cover=0.7, wmin=1.0, wmax=1.6, hmin=0.8, hmax=1.4, bolts=0.05)
    # collision
    p.cbx((-7.9, 7.9), (0, 6.7), (-5.9, 5.9))
    p.cbx((-3.4, 3.4), (6.7, 21.0), (-3.4, 3.4))
    p.cbx((-8.4, 8.4), (21.0, 27.9), (-7.3, 7.3))
    p.socket("door", (0, 0, 5.6), 0)
    darken(p, ("concrete", "concrete_dark"), 0.5, (1.05, 1.0, 0.93))
    return p


if __name__ == "__main__" and ONLY in ("", "dam_control_tower"):
    build().build()

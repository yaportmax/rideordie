"""crane + cooling_tower + oil_derrick (fork B2)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_industrial_lib import *


# ==================================================================================================== crane
def crane():
    p = Piece("crane", seed=61, ground_y=0.0, dirt_h=3.5, dirt_amt=0.5, streak_amt=0.4, noise_amt=0.34, ao_dist=3.5)
    p.notes = dict(desc="Dock ship-to-shore gantry crane, ~41 m tall. Travels along X on rails; boom (raised ~55 deg) points +Z (sea side). Portal legs at z=+-6.5, x=+-8, machinery house on top, hanging spreader + rusty container from the boom tip.",
                   height=41.5, rails="along X at z=-6.5 and z=+6.5 (y=0.3)", footprint=[36, 40], boom_tip=[0, 40.5, 21.5])
    zs, zl = 6.5, -6.5
    XL = 8.0
    TOP = 18.0
    # quay slab + rails
    p.bx("concrete_dark", (-19, 19), (0, 0.25), (-11.5, 12.5), skip=("ny",), sub=5.0)
    for z in (zs, zl):
        p.bx("concrete_dark", (-17.5, 17.5), (0.25, 0.4), (z - 0.5, z + 0.5), sub=5.0)
        p.bx("metal_bare", (-17.5, 17.5), (0.4, 0.55), (z - 0.1, z + 0.1))
    # legs, bogies, ties, braces
    for z in (zs, zl):
        for sx in (-1, 1):
            p.box("metal_dark", (sx * XL, 0.85, z), (3.0, 0.6, 1.3), bevel=0.03)
            for k in (-1, 1):
                p.cyl("metal_bare", (sx * XL + k * 1.05, 0.8, z + 0.0), 0.4, 1.5, "z", sides=10)
            p.beam("steel_beam", (sx * XL, 1.1, z), (sx * (XL - 0.7), TOP, z), 1.1, 1.3, bevel=0.0, up=(0, 0, 1))
        # ties + X braces on each portal frame
        for y in (2.2, 10.5, TOP - 0.6):
            p.beam("steel_beam", (-XL + 0.5, y, z), (XL - 0.5, y, z), 0.5, 0.7)
        for (ya, yb) in ((2.2, 10.5), (10.5, TOP - 0.6)):
            xa, xb = XL - 0.25 * (ya / TOP), XL - 0.25 * (yb / TOP)
            p.beam("steel_beam", (-xa, ya, z), (xb, yb, z), 0.34, 0.34)
            p.beam("steel_beam", (xa, ya, z), (-xb, yb, z), 0.34, 0.34)
    # longitudinal ties (along Z) and top girders
    for sx in (-1, 1):
        for y in (2.2, 10.5):
            p.beam("steel_beam", (sx * (XL - 0.25 * (y / TOP)), y, zl), (sx * (XL - 0.25 * (y / TOP)), y, zs), 0.5, 0.6)
        p.beam("steel_beam", (sx * (XL - 0.75), TOP, zl - 9.0), (sx * (XL - 0.75), TOP, zs + 4.0), 1.0, 1.4)
    # lower diagonal braces in plan between land legs (K braces)
    p.beam("steel_beam", (-XL + 0.3, 2.2, zl), (XL - 0.3, 2.2, zs), 0.26, 0.26)
    # machinery house
    p.bx("paint", (-6.0, 6.0), (TOP + 0.6, TOP + 5.4), (zl - 8.5, zl + 2.5), bevel=0.0, sub=3.0, tint=0.62)
    p.bx("metal_dark", (-6.05, 6.05), (TOP + 5.4, TOP + 5.6), (zl - 8.6, zl + 2.6))
    for k in range(8):
        zz = zl - 8.0 + k * 1.35
        for sx in (-1, 1):
            p.bx("metal_dark", (sx * 6.0 - (0.0 if sx > 0 else 0.12), sx * 6.0 + (0.12 if sx > 0 else 0.0)), (TOP + 0.7, TOP + 5.3), (zz - 0.06, zz + 0.06))
    for k in range(6):
        xx = -5.0 + k * 2.0
        p.bx("metal_dark", (xx - 0.06, xx + 0.06), (TOP + 0.7, TOP + 5.3), (zl - 8.62, zl - 8.5))
    for k in range(5):
        x = -4.5 + k * 2.25
        p.bx("metal_dark", (x - 0.7, x + 0.7), (TOP + 5.6, TOP + 6.1), (zl - 5.0, zl - 3.4))
    for z in (zl - 6.5, zl - 2.5):
        for sx in (-1, 1):
            p.bx("metal_dark", (sx * 6.0 - 0.02 if sx > 0 else -6.06, sx * 6.0 + 0.06 if sx > 0 else -5.98), (TOP + 2.6, TOP + 3.7), (z - 1.2, z + 1.2))
    p.bx("steel_beam", (-6.2, 6.2), (TOP, TOP + 0.6), (zl - 8.7, zl + 2.7))
    # boom (raised) - lattice box girder from the hinge at the sea side
    ang = math.radians(55.0)
    L = 26.0
    hinge = Vector((0.0, TOP + 1.2, zs + 0.5))
    tip = hinge + Vector((0.0, math.sin(ang), math.cos(ang))) * L
    lattice_beam(p, "steel_beam", hinge, tip, 2.6, 2.2, 13, chord=0.16, brace=0.07, up=(1, 0, 0))
    for sx in (-1, 1):
        p.box("metal_dark", (sx * 1.3, hinge.y, hinge.z), (0.6, 1.3, 1.6), bevel=0.0)
    p.box("metal_dark", tuple(tip), (3.0, 1.2, 1.3), rot=(-55.0, 0, 0), bevel=0.0)
    p.cyl("metal_bare", tuple(tip + Vector((0, 0.5, 0.3))), 0.55, 2.9, "x", sides=12)
    # A-frame mast + stays
    ma = Vector((0.0, TOP + 16.5, zl + 1.0))
    for sx in (-1, 1):
        p.beam("steel_beam", (sx * 3.0, TOP + 0.6, zl - 1.0), tuple(ma + Vector((sx * 0.3, 0, 0))), 0.5, 0.5, up=(0, 0, 1))
        p.beam("steel_beam", (sx * 3.0, TOP + 0.6, zl + 3.5), tuple(ma + Vector((sx * 0.3, 0, 0))), 0.4, 0.4, up=(0, 0, 1))
    p.beam("steel_beam", (-2.9, TOP + 6.0, zl), (2.9, TOP + 6.0, zl), 0.35, 0.35)
    p.beam("steel_beam", (-2.9, TOP + 6.0, zl - 1.0), (2.9, TOP + 6.0, zl - 1.0), 0.3, 0.3) if False else None
    for sx in (-1, 1):
        p.tube("metal_dark", tuple(ma + Vector((sx * 0.9, 0.2, 0))), tuple(tip + Vector((sx * 1.1, 0.0, 0.0))), 0.06, sides=6)
        p.tube("metal_dark", tuple(ma + Vector((sx * 0.9, 0.0, -0.3))), (sx * 2.0, TOP + 1.0, zl - 8.0), 0.07, sides=6)
    p.box("metal_dark", tuple(ma), (1.4, 0.7, 1.4), bevel=0.0)
    # trolley cab under the top girder + hoist cables to a spreader with container (hangs at the boom tip)
    p.bx("paint2", (-1.6, 1.6), (TOP - 3.6, TOP - 0.6), (zs - 3.0, zs + 0.5), sub=2.0, tint=0.62)
    p.bx("glass", (-1.6, 1.6), (TOP - 2.6, TOP - 1.2), (zs + 0.51, zs + 0.53))
    p.bx("metal_dark", (-1.7, 1.7), (TOP - 0.6, TOP - 0.35), (zs - 3.1, zs + 0.6))
    sp = Vector((0.0, 12.0, tip.z + 0.6))
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.tube("metal_dark", tip + Vector((sx * 1.1, -0.2, sz * 0.3)), sp + Vector((sx * 1.1, 0.5, sz * 0.8)), 0.035, sides=4, smooth=False, caps=False)
    p.bx("metal_dark", (-1.6, 1.6), (12.0, 12.6), (sp.z - 1.4, sp.z + 1.4), bevel=0.0)
    # 20ft container held by the spreader, rusty
    p.bx("rust", (-1.25, 1.25), (9.6, 12.0), (sp.z - 3.0, sp.z + 3.0), sub=2.5, tint=0.85)
    for k in range(-3, 4):
        p.bx("rust", (-1.29, 1.29), (9.65, 11.95), (sp.z + k * 0.8 - 0.05, sp.z + k * 0.8 + 0.05))
    # floodlights + beacons
    for i in range(3):
        c = hinge.lerp(tip, 0.3 + 0.25 * i)
        p.box("metal_dark", tuple(c + Vector((0, 1.5, 0))), (0.9, 0.4, 0.5))
        p.box("light_head", tuple(c + Vector((0, 1.5, 0.28))), (0.8, 0.3, 0.04), rot=(-20, 0, 0))
    p.cyl("light_tail", tuple(tip + Vector((0, 1.2, 0.2))), 0.16, 0.25, "y", sides=8)
    p.cyl("light_tail", tuple(ma + Vector((0, 0.6, 0))), 0.16, 0.25, "y", sides=8)
    p.socket("beacon_boom", tuple(tip + Vector((0, 1.4, 0.2))))
    p.socket("beacon_mast", tuple(ma + Vector((0, 0.8, 0))))
    # ladder on a sea-side leg
    ladder(p, (XL + 0.95, 0.9, zs), (XL - 0.7 + 0.95, TOP, zs), width=0.55, rung=0.55, side=(0, 0, 1))
    # collision: legs, house, boom axis
    for z in (zs, zl):
        for sx in (-1, 1):
            p.cbeam((sx * XL, 0.5, z), (sx * (XL - 0.7), TOP, z), 1.4, 1.5)
    p.cbx((-6.0, 6.0), (TOP, TOP + 5.6), (zl - 8.5, zl + 2.5))
    p.cbx((-9.0, 9.0), (TOP - 0.2, TOP + 0.6), (zl - 9.0, zs + 4.0))
    return p


# ==================================================================================================== cooling tower
def cooling_tower():
    p = Piece("cooling_tower", seed=62, ground_y=0.0, dirt_h=7.0, dirt_amt=0.5, streak_amt=0.5, noise_amt=0.22, ao_dist=5.0, ao_amt=0.7, noise_scale=0.22)
    p.notes = dict(desc="Ruined hyperbolic concrete cooling tower, 50 m, big bite out of the +Z rim (down to y~33), exposed rebar, open V-column base with dark interior and dry basin.",
                   height=50.0, base_radius=24.0, throat_radius=13.5, bite="front (+Z) rim")
    n = 36
    r0, yt = 13.5, 36.0
    kk = (19.5 ** 2 - 13.5 ** 2) / (29.0 ** 2)
    rad = lambda y: math.sqrt(r0 * r0 + kk * (y - yt) ** 2)
    ys = [7.0 + 3.0 * i for i in range(15)]        # 7 .. 49
    ys.append(50.0)
    rng = random.Random(62)
    top = []
    for j in range(n):
        d = (23.0 * math.exp(-((j - 27.0) / 5.2) ** 2) + 8.0 * math.exp(-((j - 6.0) / 1.8) ** 2)) * (0.7 + 0.6 * rng.random())
        if d < 1.2:
            d = 0.0
        top.append(50.0 - d)
    # smooth far-side height variation (crumbly rim)
    for j in range(n):
        if top[j] >= 50.0:
            top[j] = 50.0 - (rng.random() * 1.5 if rng.random() < 0.3 else 0.0)

    def ring_pts(y_list, off, ribs):
        rings = []
        for y in y_list:
            pts = []
            for j in range(n):
                yy = min(y, top[j])
                a = -2 * math.pi * j / n
                rr = rad(yy) + off + (0.16 if (ribs and j % 2 == 1) else 0.0)
                pts.append((rr * math.cos(a), yy, rr * math.sin(a)))
            rings.append(pts)
        return rings

    def surf(mat, rings, inward=False, tint=None, sub=0):
        verts, faces = [], []
        for r_ in rings:
            verts.extend(r_)
        for i in range(len(rings) - 1):
            for j in range(n):
                j2 = (j + 1) % n
                f = (i * n + j, i * n + j2, (i + 1) * n + j2, (i + 1) * n + j)
                faces.append(tuple(reversed(f)) if inward else f)
        return p.raw(mat, verts, faces, None, None, tint=tint, sub=sub, weld=True)
    outer = ring_pts(ys, 0.0, True)
    surf("concrete", outer, sub=3.2)
    inner = ring_pts(ys, -0.55, False)
    surf("concrete_dark", inner, inward=True, tint=0.55, sub=3.5)
    # rim thickness strip along the jagged top
    o, i_ = outer[-1], inner[-1]
    verts = o + i_
    faces = []
    for j in range(n):
        j2 = (j + 1) % n
        faces.append((j, j2, n + j2, n + j))
    p.raw("concrete", verts, faces, None, None, tint=0.8, weld=True)
    # base ring beam at y=6..7.4
    rb = rad(7.0)
    revolve(p, "concrete_dark", 0, 0, [(rb + 0.6, 5.7), (rb + 0.6, 7.4), (rb - 0.6, 7.4)], n, sub=6.0)
    revolve(p, "concrete_dark", 0, 0, [(rb - 0.6, 7.4), (rb - 0.6, 5.7), (rb + 0.6, 5.7)], n, sub=6.0) if False else None
    revolve(p, "concrete_dark", 0, 0, [(rb - 0.6, 5.7), (rb + 0.6, 5.7)], n)
    revolve(p, "concrete_dark", 0, 0, [(rb - 0.6, 7.4), (rb - 0.6, 5.7)], n)
    # V-column supports (slanted)
    cols = 36
    rbase = 22.0
    for k in range(cols):
        a = 360.0 * k / cols + 5.0
        x0, z0 = polar(0, 0, rbase, a)
        x1, z1 = polar(0, 0, rb, a)
        p.beam("concrete_dark", (x0, 0.4, z0), (x1, 5.9, z1), 0.9, 0.9, up=(0, 1, 0))
    # basin wall (outer face, top, inner face) + dry basin floor + inner cross beams
    revolve(p, "concrete_dark", 0, 0, [(24.6, 0.0), (24.6, 1.3), (23.3, 1.3), (23.3, 0.0)], n, sub=6.0)
    revolve(p, "concrete_dark", 0, 0, [(23.3, 0.5), (0.0, 0.5)], n, tint=0.45)
    for k in range(4):
        a = k * 45.0
        xa, za = polar(0, 0, 21.0, a)
        xb, zb = polar(0, 0, 21.0, a + 180)
        p.beam("metal_dark", (xa, 5.0, za), (xb, 5.0, zb), 0.4, 0.5)
    # exposed rebar along the broken rim + vertical bars
    for j in range(n):
        if top[j] < 49.9:
            a = -360.0 * j / n
            yy = top[j]
            x, z = polar(0, 0, rad(yy) - 0.1, a)
            dxo, dzo = polar(0, 0, 1.0, a)
            for m in range(2):
                ox = 0.25 * (m - 0.5)
                tilt = rng.uniform(-0.6, 0.6)
                p.tube("rebar", (x + ox, yy - 0.2, z), (x + ox + dxo * 0.4 * tilt + rng.uniform(-0.3, 0.3), yy + rng.uniform(0.8, 2.2), z + dzo * 0.4 * tilt + rng.uniform(-0.3, 0.3)), 0.028, sides=4, smooth=False, caps=False)
    # debris chunks around the bite footprint
    for k in range(9):
        a = 90.0 + rng.uniform(-45, 45)
        rr_ = rng.uniform(25.5, 33.0)
        x, z = polar(0, 0, rr_, a)
        s = rng.uniform(0.9, 2.6)
        p.box("concrete", (x, s * 0.35, z), (s * rng.uniform(1.0, 1.8), s * 0.7, s * rng.uniform(0.8, 1.4)), rot=(rng.uniform(-12, 12), rng.uniform(0, 180), rng.uniform(-12, 12)), sub=2.0)
    # collision: wall wedges + column clusters
    segs = 12
    for k in range(segs):
        pts = []
        a0, a1 = -360.0 * k / segs, -360.0 * (k + 1) / segs
        jmid = int(((k + 0.5) / segs) * n) % n
        for y in (7.0, 30.0 if k in (7, 8, 9) else 48.0):
            for a in (a0, a1):
                for off in (0.0, -0.55):
                    x, z = polar(0, 0, rad(y) + off, a)
                    pts.append((x, y, z))
        p.chull(pts)
    for k in range(segs):
        a = 360.0 * k / segs + 5.0
        x0, z0 = polar(0, 0, rbase, a)
        x1, z1 = polar(0, 0, rb, a)
        p.cbeam((x0, 0.3, z0), (x1, 6.0, z1), 1.6, 1.6)
    p.socket("bite_center", (0, 40.0, rad(40.0)))
    return p


# ==================================================================================================== oil derrick / pumpjack
def oil_derrick():
    p = Piece("oil_derrick", seed=63, ground_y=0.0, dirt_h=2.5, dirt_amt=0.55, streak_amt=0.35, noise_amt=0.36, ao_dist=2.5)
    p.notes = dict(desc="Oil lease: nodding-donkey pumpjack (horsehead toward +Z), 22 m lattice derrick with crown block, two small storage tanks, wellhead + flow lines on an oil-stained pad.",
                   height=22.8, footprint=[40, 24], wellhead=[0, 1.0, 4.4])
    rng = random.Random(63)
    # pad + oil stains
    padp = []
    for k in range(20):
        a_ = 2 * math.pi * k / 20
        rr_ = 0.86 + 0.14 * math.sin(k * 2.3 + 1.0) * math.cos(k * 0.9)
        padp.append((22.0 * rr_ * math.cos(a_), 13.5 * rr_ * math.sin(a_)))
    p.extrude_y("dirt_red", padp, -0.05, 0.12, sub=4.0)
    for (cx, cz, r_) in ((0.0, 4.4, 1.9), (5.5, 2.0, 1.2), (-8.0, -3.0, 2.3), (13.0, 5.0, 1.1)):
        pts = [(cx + r_ * (0.8 + 0.4 * rng.random()) * math.cos(t * 0.7854), 0.135, cz + r_ * (0.8 + 0.4 * rng.random()) * math.sin(t * 0.7854)) for t in range(8)]
        # fan (convex-ish polygon) facing up
        p.poly("rubber", list(reversed(pts)), flat=False)
    # ---------------- pumpjack (axis along Z, horsehead toward +Z) ----------------
    p.bx("concrete_dark", (-2.0, 2.0), (0, 0.5), (-4.6, 3.0), bevel=0.05, sub=2.5)
    p.bx("steel_beam", (-1.4, -1.0), (0.5, 0.75), (-4.4, 2.8))
    p.bx("steel_beam", (1.0, 1.4), (0.5, 0.75), (-4.4, 2.8))
    pv = Vector((0.0, 6.6, 0.2))
    for sx in (-1, 1):
        p.beam("steel_beam", (sx * 0.95, 0.75, -1.4), (sx * 0.5, pv.y, pv.z), 0.34, 0.34, up=(1, 0, 0))
        p.beam("steel_beam", (sx * 0.95, 0.75, 1.9), (sx * 0.5, pv.y, pv.z), 0.34, 0.34, up=(1, 0, 0))
        p.beam("steel_beam", (sx * 0.85, 2.6, -0.6), (sx * 0.85, 2.6, 1.3), 0.2, 0.2)
    p.beam("steel_beam", (-0.95, 2.6, 1.3), (0.95, 2.6, 1.3), 0.2, 0.2)
    p.beam("steel_beam", (-0.95, 2.6, -0.6), (0.95, 2.6, -0.6), 0.2, 0.2)
    p.box("metal_dark", tuple(pv + Vector((0, 0.15, 0))), (1.2, 0.5, 0.7), bevel=0.0)
    # walking beam (I-beam), tilted so the horsehead end is up
    tau = math.radians(9.0)
    d = Vector((0.0, math.sin(tau), math.cos(tau)))
    a = pv - d * 3.8
    b = pv + d * 4.3
    p.beam("steel_beam", a, b, 0.62, 0.34, up=(1, 0, 0)) if False else None
    for dx in (-0.22, 0.22):
        p.beam("steel_beam", a + Vector((dx, 0, 0)), b + Vector((dx, 0, 0)), 0.1, 0.62, up=(1, 0, 0)) if False else None
    p.beam("steel_beam", a, b, 0.55, 0.25)                                 # web/box
    p.beam("steel_beam", a + Vector((0, 0.26, 0)), b + Vector((0, 0.26, 0)), 0.7, 0.07)   # top flange
    p.beam("steel_beam", a - Vector((0, 0.26, 0)), b - Vector((0, 0.26, 0)), 0.7, 0.07)   # bottom flange
    # horsehead (arc) at the front end
    Rh = 4.3
    prof = []
    for k in range(9):
        al = math.radians(-32 + 64 * k / 8)
        prof.append((0.5 + (Rh + 0.35) * math.cos(al + tau) + 0.0, 0.0))
    poly = []
    arc = [(-32 + 64 * k / 8) for k in range(9)]
    for al in arc:
        ang_ = math.radians(al) + tau
        poly.append((pv.z + (Rh + 0.4) * math.cos(ang_), pv.y + (Rh + 0.4) * math.sin(ang_)))
    for al in reversed(arc):
        ang_ = math.radians(al) + tau
        poly.append((pv.z + (Rh - 0.9) * math.cos(ang_), pv.y + (Rh - 0.9) * math.sin(ang_)))
    p.extrude_x("steel_beam", poly, -0.3, 0.3)
    hx = pv.z + Rh * math.cos(math.radians(24) + tau)
    hy = pv.y + Rh * math.sin(math.radians(24) + tau)
    # bridle cables + carrier bar + polish rod + wellhead (vertical line at z = wz)
    wz = pv.z + (Rh + 0.4) * math.cos(math.radians(-30) + tau) - 0.05
    ytop = pv.y + (Rh + 0.4) * math.sin(math.radians(-30) + tau)
    hzt = pv.z + (Rh + 0.4) * math.cos(math.radians(30) + tau)
    for dx in (-0.25, 0.25):
        p.tube("metal_dark", (dx, hy + 0.35, hzt - 0.25), (dx * 0.8, 3.1, wz + 0.15), 0.025, sides=4, smooth=False, caps=False)
    p.bx("metal_dark", (-0.45, 0.45), (2.9, 3.1), (wz - 0.15, wz + 0.35))
    p.tube("metal_bare", (0.0, 3.0, wz + 0.1), (0.0, 1.3, wz + 0.1), 0.055, sides=6)
    # wellhead / christmas tree
    p.cyl("metal_dark", (0.0, 0.55, wz + 0.1), 0.3, 1.0, "y", sides=10)
    p.cyl("rust", (0.0, 1.15, wz + 0.1), 0.42, 0.2, "y", sides=10)
    p.tube("metal_dark", (0.0, 0.9, wz + 0.1), (1.6, 0.9, wz + 0.1), 0.11, sides=8)
    p.cyl("metal_dark", (0.9, 0.9, wz + 0.1), 0.2, 0.25, "x", sides=8)
    p.tube("metal_dark", (0.9, 0.9, wz + 0.1), (0.9, 1.5, wz + 0.1), 0.03, sides=4, smooth=False, caps=False)
    p.cyl("rust", (0.9, 1.55, wz + 0.1), 0.2, 0.05, "y", sides=8)
    # gearbox, cranks, counterweights, pitman arms
    gz = -2.9
    p.bx("paint2", (-0.95, 0.95), (0.6, 2.1), (gz - 1.0, gz + 0.9), bevel=0.06, sub=1.5, tint=0.6)
    p.bx("metal_dark", (-0.6, 0.6), (2.1, 2.4), (gz - 0.6, gz + 0.5))
    cy = 1.45
    for sx in (-1, 1):
        xc = sx * 1.25
        p.cyl("metal_dark", (xc, cy, gz), 0.16, 0.36, "x", sides=8)
        # crank arm + counterweight (up-back position) + pin
        pin = (xc, cy + 0.9 * math.cos(math.radians(30)), gz - 0.9 * math.sin(math.radians(30)) + 0.0)
        p.tube("metal_dark", (xc, cy, gz), pin, 0.11, sides=6)
        cw = (xc, cy - 0.95 * math.cos(math.radians(30)), gz + 0.95 * math.sin(math.radians(30)))
        p.tube("metal_dark", (xc, cy, gz), cw, 0.11, sides=6)
        p.cyl("rust", (xc + sx * 0.06, cw[1] - 0.05, cw[2]), 0.85, 0.32, "x", sides=14)
        p.cyl("metal_dark", (xc + sx * 0.06, cw[1] - 0.05, cw[2]), 0.25, 0.4, "x", sides=8)
        # pitman arm to the beam's rear end
        p.tube("metal_dark", pin, (sx * 0.5, a.y - 0.2, a.z + 0.15), 0.07, sides=6)
        p.tube("metal_dark", (sx * 0.5, a.y - 0.05, a.z + 0.15), (sx * 0.5, a.y + 0.6, a.z + 0.15), 0.05, sides=4, smooth=False, caps=False)
    p.box("metal_dark", (0, a.y - 0.05, a.z + 0.15), (1.2, 0.18, 0.3))
    # motor + belt + guard
    p.box("paint", (-0.0, 0.85, gz - 2.4), (0.9, 0.8, 1.35), bevel=0.05, tint=0.6)
    p.bx("steel_beam", (-0.8, 0.8), (0.5, 0.7), (gz - 3.3, gz - 1.5))
    p.tube("metal_dark", (0.0, 0.9, gz - 1.7), (0.0, 1.5, gz - 0.2), 0.05, sides=4, smooth=False, caps=False)
    p.tube("metal_dark", (0.0, 1.0, gz - 1.7), (0.0, 1.6, gz - 0.2), 0.05, sides=4, smooth=False, caps=False)
    # ---------------- derrick tower ----------------
    DX, DZ, DH = -13.5, -3.0, 22.0
    levels = lattice_tower(p, "steel_beam", DX, DZ, 0.0, DH, 2.6, 0.95, 9, leg=0.14, brace=0.06)
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.box("concrete_dark", (DX + sx * 2.6, 0.3, DZ + sz * 2.6), (1.0, 0.6, 1.0), bevel=0.0)
    # crown block + monkey board + rig floor
    p.bx("steel_beam", (DX - 1.3, DX + 1.3), (DH, DH + 0.35), (DZ - 1.3, DZ + 1.3))
    p.box("metal_dark", (DX, DH + 0.9, DZ), (1.2, 1.0, 1.0), bevel=0.0)
    p.cyl("metal_bare", (DX, DH + 1.4, DZ), 0.5, 0.2, "x", sides=10)
    p.tube("metal_dark", (DX, DH + 1.4, DZ + 0.6), (DX, DH + 2.1, DZ + 0.6), 0.03, sides=4, smooth=False, caps=False) if False else None
    p.cyl("light_tail", (DX, DH + 1.9, DZ), 0.11, 0.2, "y", sides=8)
    p.bx("metal_dark", (DX - 1.7, DX + 1.7), (14.0, 14.12), (DZ + 0.4, DZ + 1.9))
    railing(p, [(DX - 1.7, 14.12, DZ + 1.9), (DX + 1.7, 14.12, DZ + 1.9)], h=1.0, post_every=1.2, rails=2)
    p.bx("metal_dark", (DX - 2.4, DX + 2.4), (3.5, 3.62), (DZ - 2.4, DZ + 2.4))
    railing(p, [(DX - 2.4, 3.62, DZ + 2.4), (DX + 2.4, 3.62, DZ + 2.4), (DX + 2.4, 3.62, DZ - 2.4), (DX - 2.4, 3.62, DZ - 2.4)], h=1.0, closed=True, post_every=1.6, rails=2, skip=lambda i: i in (2, 3))
    ladder(p, (DX + 0.0, 0.5, DZ + 2.68), (DX + 0.0, 13.8, DZ + 1.14), width=0.5, rung=0.5, side=(1, 0, 0))
    # drilling line (hanging cables) from the crown block to a travelling block
    p.tube("metal_dark", (DX - 0.2, DH + 0.9, DZ), (DX - 0.2, 9.0, DZ), 0.025, sides=4, smooth=False, caps=False)
    p.tube("metal_dark", (DX + 0.2, DH + 0.9, DZ), (DX + 0.2, 9.0, DZ), 0.025, sides=4, smooth=False, caps=False)
    p.box("metal_dark", (DX, 8.7, DZ), (0.9, 0.6, 0.6))
    p.tube("rust", (DX, 8.4, DZ), (DX, 6.5, DZ), 0.12, sides=6)
    # engine shed next to the derrick
    p.bx("rust", (DX + 3.2, DX + 8.2), (0, 3.2), (DZ - 3.0, DZ + 1.8), sub=2.5)
    p.extrude_x("metal_bare", [(DZ - 3.2, 3.2), (DZ + 2.0, 3.2), (DZ - 0.6, 4.2)], DX + 3.1, DX + 8.3)
    p.bx("metal_dark", (DX + 3.2, DX + 5.4), (0, 2.4), (DZ + 1.79, DZ + 1.85))
    p.tube("metal_dark", (DX + 7.0, 3.2, DZ - 1.5), (DX + 7.0, 6.0, DZ - 1.5), 0.15, sides=8)
    p.cyl("metal_dark", (DX + 7.0, 6.1, DZ - 1.5), 0.24, 0.15, "y", sides=8)
    # ---------------- storage tanks + flow lines ----------------
    tanks = [(12.0, 3.0, 2.7, 5.0), (17.2, -2.5, 2.3, 4.2)]
    for (cx, cz, r_, h_) in tanks:
        ys_ = [0.0, h_ / 3, 2 * h_ / 3, h_]
        revolve(p, "rust", cx, cz, [(r_, y) for y in ys_], 14, sub=3.0)
        revolve(p, "metal_dark", cx, cz, [(r_ + 0.04, h_ / 3 - 0.06), (r_ + 0.04, h_ / 3 + 0.06)], 14)
        revolve(p, "metal_dark", cx, cz, [(r_ + 0.04, 2 * h_ / 3 - 0.06), (r_ + 0.04, 2 * h_ / 3 + 0.06)], 14)
        revolve(p, "paint", cx, cz, [(r_ + 0.1, h_), (r_ * 0.55, h_ + 0.9), (0.0, h_ + 1.35)], 14, tint=0.55)
        p.cyl("concrete_dark", (cx, 0.2, cz), r_ + 0.3, 0.4, "y", sides=14)
        p.cyl("metal_dark", (cx, h_ + 1.5, cz), 0.3, 0.3, "y", sides=8)
        ladder(p, (cx - r_ - 0.05, 0.4, cz + 0.4), (cx - r_ - 0.05, h_ + 0.2, cz + 0.4), width=0.45, rung=0.45, side=(0, 0, 1))
    wz_ = wz + 0.1
    pipe(p, [(1.6, 0.9, wz_), (5.0, 0.6, wz_), (5.0, 0.6, 3.0), (10.5, 0.6, 3.0), (11.6, 0.9, 3.0)] if False else [(1.6, 0.9, wz_), (6.5, 0.9, wz_), (6.5, 0.9, 3.0), (9.3, 0.9, 3.0)], r=0.1)
    pipe(p, [(9.3, 0.9, 3.0), (9.3, 0.9, 4.5), (17.2, 0.9, 4.5), (17.2, 0.9, -0.1)], r=0.08)
    valve(p, (8.0, 0.9, 3.0), 0.3) if False else None
    for x in (3.0, 8.0):
        p.box("concrete_dark", (x, 0.3, wz_), (0.6, 0.35, 0.6))
    p.cyl("metal_dark", (6.5, 0.9, 3.7), 0.2, 0.25, "z", sides=8)
    p.tube("metal_dark", (6.5, 0.9, 3.7), (6.5, 1.5, 3.7), 0.03, sides=4, smooth=False, caps=False)
    p.cyl("rust", (6.5, 1.55, 3.7), 0.2, 0.05, "y", sides=8)
    # collision
    p.cbx((-2.0, 2.0), (0, 7.4), (-4.6, 3.0))
    p.cbx((-1.4, 1.4), (0, 3.3), (-5.6, -1.4))
    p.cbx((-0.5, 0.5), (2.8, 9.0), (2.5, 6.0))
    p.chull([(DX + sx * 2.6, 0, DZ + sz * 2.6) for sx in (-1, 1) for sz in (-1, 1)] + [(DX + sx * 0.95, DH, DZ + sz * 0.95) for sx in (-1, 1) for sz in (-1, 1)])
    p.cbx((DX + 3.2, DX + 8.2), (0, 4.2), (DZ - 3.0, DZ + 1.8))
    for (cx, cz, r_, h_) in tanks:
        p.chull([(polar(cx, cz, r_, a * 45)[0], y, polar(cx, cz, r_, a * 45)[1]) for a in range(8) for y in (0.0, h_ + 1.4)])
    p.socket("wellhead", (0.0, 1.2, wz_))
    p.socket("beacon", (DX, DH + 2.0, DZ))
    return p

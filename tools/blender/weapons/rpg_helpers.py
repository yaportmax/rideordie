"""Helpers shared by rpg.py / rocket.py / grenade.py / shells.py (units mm, G frame: +X fwd, +Y left, +Z up)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *  # noqa: F401,F403
import gunlib as GL


def lathe_loop(profile, segs=32, axis="x", c=(0, 0, 0), mod=None, phase=0.0, scale=(1, 1), rot=(0, 0, 0)):
    """Revolve a CLOSED (start == end) profile loop -> hollow closed shell (welds the seam)."""
    bm = lathe_bm(profile, segs, axis, c, rot, mod, False, phase, scale)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-3)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def ring_bm(center, normal, R, r, segs=10, tsegs=28):
    """Torus: circle of radius R around `center` in the plane with `normal`; tube radius r."""
    n = Vector(normal).normalized()
    a = n.orthogonal().normalized()
    b = n.cross(a)
    c = Vector(center)
    pts = [c + a * (R * math.cos(2 * math.pi * k / tsegs)) + b * (R * math.sin(2 * math.pi * k / tsegs)) for k in range(tsegs)]
    return sweep_bm(pts, r, segs=segs, closed=True)


def knurl(n=2, depth=0.07):
    return lambda k: 1.0 if (k % n) < n / 2 else 1.0 - depth


def ogive_pts(x0, x1, r0, r1, n=14, p=1.55, q=0.75):
    """(x, r) points from (x0, r0) tangent to a cylinder, curving to (x1, r1)."""
    out = []
    for k in range(n + 1):
        t = k / n
        out.append((x0 + (x1 - x0) * t, r1 + (r0 - r1) * (1 - t ** p) ** q))
    return out


def wobble_ring_pts(cx, cy, R, n, amp=0.0, ph=0.0):
    return [(cx + (R + amp * math.sin(ph + k)) * math.cos(2 * math.pi * k / n), cy + (R + amp * math.sin(ph + k)) * math.sin(2 * math.pi * k / n)) for k in range(n)]


# ------------------------------------------------------------------------------------------ PG-7V style HEAT warhead (shared by rpg.py and rocket.py)
WH_NOSE_X = 246.5          # nose tip in rocket-local x (origin = centre of the cylindrical body)
WH_BODY_R = 42.5
WH_TAPER_END = -95.0       # where the tail booster leaves the warhead (= tube mouth when loaded)
BOOST_R = 19.5
BOOST_END = -240.0         # rear end of the shared booster stub (hidden inside the launcher tube)


def warhead(part, o=(0.0, 0.0, 0.0), segs=36):
    """Build the loaded warhead + booster stub into `part`. Coordinates are rocket-local + offset o.  Materials: paint, gun_black, gun_metal."""
    ox, oy, oz = o
    c = (0, oy, oz)

    def sh(prof):
        return [(x + ox, r) for x, r in prof]

    # painted shell: rear taper -> body -> ogive nose
    prof = [(-95.0, 0.0), (-95.0, 19.8), (-90.0, 21.5), (-82.0, 25.0), (-73.0, 30.0), (-64.0, 35.5), (-55.0, 39.8), (-48.0, 42.0), (-44.0, 42.5)]
    prof += [(-41.0, 42.5), (-40.5, 43.7), (-36.5, 43.7), (-36.0, 42.5)]                    # crimp bead
    prof += [(-8.0, 42.5), (-7.6, 41.5), (-2.4, 41.5), (-2.0, 42.5)]                        # groove pair (stencil band)
    prof += [(2.0, 42.5), (2.4, 41.5), (7.6, 41.5), (8.0, 42.5)]
    prof += [(43.0, 42.5)] + ogive_pts(43.0, 212.0, 42.5, 14.0, n=16, p=1.6, q=0.72)[1:] + [(212.0, 0.0)]
    part.add(lathe_bm(sh(prof), segs, "x", c), "paint", bevel=0.0)
    # nose fuze cap (piezo) - black with a bright ring
    cap = [(212.0, 0.0), (212.0, 15.0), (216.5, 15.0), (216.5, 11.8), (234.0, 9.0), (242.0, 7.2), (245.4, 4.6), (246.5, 0.0)]
    part.add(lathe_bm(sh(cap), 28, "x", c), "gun_black", bevel=0.0)
    ring = [(216.5, 11.5), (216.5, 13.4), (221.0, 13.4), (221.0, 11.5), (216.5, 11.5)]
    part.add(lathe_loop(sh(ring), 28, "x", c), "gun_metal", bevel=0.0)
    # tail booster stub (steel) with collar + grooves
    bo = [(-240.0, 0.0), (-240.0, BOOST_R - 1.0), (-239.0, BOOST_R), (-104.0, BOOST_R), (-104.0, 21.6), (-98.0, 21.6), (-98.0, BOOST_R), (-95.0, BOOST_R), (-95.0, 0.0)]
    part.add(lathe_bm(sh(bo), 32, "x", c), "gun_metal", bevel=0.0)
    for gx in (-225.0, -150.0, -125.0):
        part.add(lathe_loop(sh([(gx, BOOST_R - 0.6), (gx, BOOST_R + 0.9), (gx + 5.0, BOOST_R + 0.9), (gx + 5.0, BOOST_R - 0.6), (gx, BOOST_R - 0.6)]), 32, "x", c), "gun_black", bevel=0.0)
    # black band + fuze safety details on the body
    part.add(lathe_loop(sh([(20.0, 42.0), (20.0, 43.4), (30.0, 43.4), (30.0, 42.0), (20.0, 42.0)]), segs, "x", c), "gun_black", bevel=0.0)
    return part


# ------------------------------------------------------------------------------------------ local look tweak: straighter, calmer wood grain
def install_straight_wood():
    """Replace the shared wood recipe (swirly at this scale) by a calmer straight-grained variant (beech/birch furniture)."""
    import numpy as np
    import gunlook as GLK

    def wood(c, style):
        st = style or {}
        N = c.N
        P = c.P
        ax = st.get("wood_axis", 0)
        yz = [i for i in range(3) if i != ax]
        q0, q1 = P[:, yz[0]], P[:, yz[1]]
        wob = (c.nM - 0.5) * 1.8 + (c.nL - 0.5) * 5.0
        r = np.sqrt(q0 ** 2 + (q1 * 1.1) ** 2) + wob + 0.012 * P[:, ax]
        ring = (0.5 + 0.5 * np.sin(r * 1.35)) ** 2.0
        fq = [0.05, c.fmax * 1.4, c.fmax * 1.4] if ax == 0 else [c.fmax * 1.4, 0.05, c.fmax * 1.4]
        fine = GLK.vnoise(P, tuple(fq), 91)
        grain = ring * 0.45 + fine * 0.55
        dark = np.array(st.get("wood_dark", (0.060, 0.026, 0.010)), np.float32)
        light = np.array(st.get("wood_light", (0.19, 0.088, 0.036)), np.float32)
        alb = dark + (light - dark) * grain[:, None]
        alb = alb * (0.8 + 0.4 * c.nL[:, None])
        hi, lo, grime = GLK._wear_common(c, st, 1.0, 0.7, 0.8)
        wear = np.clip(hi + lo * 0.7, 0, 1)
        bleach = np.array([0.24, 0.16, 0.085], np.float32)
        alb = alb * (1 - wear[:, None] * 0.6) + bleach * wear[:, None] * 0.6 * (0.7 + 0.5 * c.nH[:, None])
        alb = alb * (1 - grime[:, None] * 0.6) + np.array([0.028, 0.02, 0.014], np.float32) * grime[:, None] * 0.6
        alb = alb * (0.45 + 0.55 * c.ao_s[:, None])
        oil = GLK.smoothstep(0.45, 0.75, c.nL2)
        rough = 0.56 - 0.12 * oil + 0.15 * wear + 0.15 * grime + 0.05 * (c.nH - 0.5)
        h = (fine - 0.5) * 0.035 + (ring - 0.5) * 0.012 - 0.05 * np.maximum(c.scr_a, c.scr_b)
        return alb, np.clip(rough, 0.2, 1.0), np.zeros(N, np.float32), h

    GLK.RECIPES["wood"] = wood


def install_golden_brass():
    """Shell-scale look: deeper golden brass (less cream/green sky-wash), duller nickel primers (avoids blown-out white)."""
    import numpy as np
    import gunlook as GLK

    def brass(c, style):
        N = c.N
        tarn = GLK.smoothstep(0.50, 0.78, c.nM) * (0.3 + 0.7 * c.nL2) * 0.65
        bright = np.array([0.50, 0.275, 0.052], np.float32)
        dull = np.array([0.20, 0.10, 0.032], np.float32)
        alb = bright + (dull - bright) * tarn[:, None] * 0.85
        alb = alb * (0.85 + 0.3 * c.nH[:, None])
        scr = np.maximum(c.scr_a, c.scr_b)
        alb = alb * (1 + 0.35 * scr[:, None])
        soot = GLK.smoothstep(0.1, 0.9, (1 - c.ao_s) * 1.6 + (1 - c.ao_b) * 0.6) * (0.5 + 0.5 * c.nM)
        alb = alb * (1 - soot[:, None] * 0.75) + np.array([0.02, 0.016, 0.012], np.float32) * soot[:, None] * 0.75
        alb = alb * (0.6 + 0.4 * c.ao_s[:, None])
        rough = 0.36 + 0.2 * tarn + 0.25 * soot - 0.06 * scr + 0.05 * (c.nH - 0.5)
        metal = 1.0 - 0.3 * soot - 0.12 * tarn
        h = -0.01 * scr + (c.nH - 0.5) * 0.006
        return alb, np.clip(rough, 0.15, 1.0), np.clip(metal, 0, 1), h

    def nickel(c, style):
        return GLK.recipe_metal(c, (0.13, 0.13, 0.14), (0.10, 0.10, 0.11), (0.22, 0.22, 0.23), 0.42, 0.34, 1.0, 0.3, 0.5, brushed=0.0, style=style)

    GLK.RECIPES["brass"] = brass
    GLK.RECIPES["gun_steel"] = nickel


def install_military_paint():
    """Matte olive-drab military paint: worn to dark steel + rust freckles instead of the generic white-grey wear."""
    import numpy as np
    import gunlook as GLK

    def paint(c, style):
        st = style or {}
        N = c.N
        hi, lo, grime = GLK._wear_common(c, st, 1.0, 0.9, 0.7)
        base = np.array(st.get("paint_color", (0.052, 0.062, 0.026)), np.float32)
        alb = np.tile(base, (N, 1)) * (0.72 + 0.5 * c.nM[:, None]) * (0.9 + 0.2 * c.nH[:, None])
        fade = np.array([base[0] * 1.5 + 0.02, base[1] * 1.4 + 0.02, base[2] * 1.6 + 0.02], np.float32)
        alb = alb * (1 - lo[:, None] * 0.7) + fade * lo[:, None] * 0.7
        steel = np.array([0.15, 0.145, 0.14], np.float32) * (0.7 + 0.6 * c.nH[:, None])
        alb = alb * (1 - hi[:, None]) + steel * hi[:, None]
        rust = GLK.smoothstep(0.50, 0.70, c.nM2) * np.clip(hi * 0.9 + grime * 0.35, 0, 1) * st.get("rust", 0.5)
        alb = alb * (1 - rust[:, None]) + np.array([0.19, 0.07, 0.024], np.float32) * rust[:, None] * (0.6 + 0.8 * c.nH[:, None])
        alb = alb * (1 - grime[:, None] * 0.6) + np.array([0.035, 0.03, 0.022], np.float32) * grime[:, None] * 0.6
        alb = alb * (0.5 + 0.5 * c.ao_s[:, None])
        rough = 0.74 + 0.1 * (c.nM - 0.5) - 0.28 * hi + 0.06 * grime + 0.2 * rust
        metal = np.clip(hi * 0.95, 0, 1) * (1 - rust)
        h = (c.nH - 0.5) * 0.012 - 0.03 * np.maximum(c.scr_a, c.scr_b)
        return alb, np.clip(rough, 0.2, 1.0), metal.astype(np.float32), h

    GLK.RECIPES["paint"] = paint

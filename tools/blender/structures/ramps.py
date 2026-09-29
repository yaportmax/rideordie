"""jump_ramp, jump_ramp_small, speed_boost_pad."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *

_rj = random.Random(5)


def Yj():
    k = _rj.uniform(0.55, 1.0)
    return (0.95 * k, 0.5 * k, 0.02 * k)


def Kj():
    k = _rj.uniform(0.6, 1.4)
    return (0.035 * k, 0.035 * k, 0.04 * k)


Y_ = (0.95, 0.5, 0.02)
K_ = (0.03, 0.03, 0.035)


def make_ramp(pid, W, L, H, expo=1.45, seed=3):
    hw = W / 2
    yf = lambda z: H * (max(z, 0.0) / L) ** expo
    slope_end = math.atan(H * expo / L)
    p = Piece(pid, seed=seed, ground_y=-0.3, dirt_h=1.3, dirt_amt=0.4, ao_dist=2.5)
    p.notes = dict(desc="Kicker ramp spanning the road. Drive +Z. Surface curve y = H*(z/L)^%.2f (flush at z=0, lip at z=L)." % expo,
                   lip_height=H, length=L, width=W, launch_angle_deg=round(slope_end / D2R, 1))
    # -- drivable surface
    zs = [L * (i / 28.0) for i in range(29)]
    xs = [-hw + W * i / 14.0 for i in range(15)]
    p.surface("road_surface", "asphalt", xs, zs, lambda x, z: yf(z))
    # -- concrete wedge core under the surface (side profile), slightly narrower than the surface edges
    nsl = int(L)
    for i in range(nsl):
        za, zb = L * i / nsl, L * (i + 1) / nsl
        prof = [(za + 0.012, -0.35), (zb - 0.012, -0.35), (zb - 0.012, yf(zb) - 0.03), (za + 0.012, yf(za) - 0.03)]
        p.extrude_x("concrete", prof, -hw - 0.02, hw + 0.02, bevel=0.035, sub=1.3)
    # -- side kerbs (dark concrete) following the curve, hazard striped tops
    step = L / 14.0
    for sx in (-1, 1):
        x0, x1 = (hw - 0.05, hw + 0.45) if sx > 0 else (-hw - 0.45, -hw + 0.05)
        for i in range(14):
            za, zb = step * i, step * (i + 1)
            ya, yb = yf(za), yf(zb)
            hk = 0.32
            # kerb block: box from ground up to surface+hk, sloped top
            prof2 = [(za, -0.35), (zb, -0.35), (zb, yb + hk), (za, ya + hk)]
            p.extrude_x("concrete_dark", prof2, x0, x1, bevel=0.03)
            # hazard top plate
            p.quad("hazard", (x0 + 0.02, ya + hk + 0.012, za + 0.02), (x0 + 0.02, yb + hk + 0.012, zb - 0.02),
                   (x1 - 0.02, yb + hk + 0.012, zb - 0.02), (x1 - 0.02, ya + hk + 0.012, za + 0.02), tint=Yj() if i % 2 == 0 else Kj())
    # -- steel nosing at the lip
    ang = -slope_end / D2R
    p.box("metal_bare", (0, H - 0.055, L - 0.16), (W + 0.9, 0.14, 0.42), rot=(ang, 0, 0), bevel=0.02)
    p.box("metal_dark", (0, H - 0.2, L - 0.02), (W + 0.9, 0.35, 0.10), bevel=0.02)
    # -- hazard band across the lip + edge bands + centre chevrons (decals 1.5 cm above the surface)
    off = 0.016
    nb = int(W / 0.7)
    bw = (W - 1.6) / nb
    for i in range(nb):
        xa = -hw + 0.8 + bw * i
        za, zb = L - 1.6, L - 0.48
        p.quad("hazard", (xa, yf(za) + off, za), (xa, yf(zb) + off, zb), (xa + bw, yf(zb) + off, zb), (xa + bw, yf(za) + off, za),
               tint=Yj() if i % 2 == 0 else Kj())
    ns = 14
    for sx in (-1, 1):
        xa, xb = (hw - 0.75, hw - 0.1) if sx > 0 else (-hw + 0.1, -hw + 0.75)
        for i in range(ns):
            za, zb = 0.9 + (L - 3.4) * i / ns, 0.9 + (L - 3.4) * (i + 1) / ns
            p.quad("hazard", (xa, yf(za) + off, za), (xa, yf(zb) + off, zb), (xb, yf(zb) + off, zb), (xb, yf(za) + off, za),
                   tint=Yj() if i % 2 == 0 else Kj())
    # chevrons pointing +Z on the centre line (yellow paint)
    nchev = max(2, int(L / 3.3))
    for i in range(nchev):
        zc = 1.2 + (L - 5.2) * (i / max(1, nchev - 1))
        cw, cd, th = min(3.2, W * 0.22), 1.1, 0.5
        pts = [(-cw, zc), (0, zc + cd), (cw, zc), (cw, zc - th), (0, zc + cd - th), (-cw, zc - th)]
        # arrow shape with proper draping: split into quads
        for a, b in (((-cw, zc), (0, zc + cd)), ((0, zc + cd), (cw, zc))):
            pass
        L1 = [(-cw, zc - th), (-cw, zc), (0, zc + cd), (0, zc + cd - th)]
        R1 = [(0, zc + cd - th), (0, zc + cd), (cw, zc), (cw, zc - th)]
        for q_ in (L1, R1):
            p.quad("hazard", *[(x, yf(z) + off, z) for x, z in q_], tint=Yj())
    # -- rear wall buttresses (steel I-beams) + bracing + concrete footing
    zr = L
    nbt = max(3, int(W / 2.6) + 1)
    xsb = [-hw + 0.5 + (W - 1.0) * i / (nbt - 1) for i in range(nbt)]
    for xb in xsb:
        p.box("steel_beam", (xb, H / 2 - 0.15, zr + 0.14), (0.28, H + 0.3, 0.05), bevel=0.01)       # web
        p.box("steel_beam", (xb, H / 2 - 0.15, zr + 0.26), (0.32, H + 0.3, 0.05), bevel=0.01)       # outer flange
        p.box("steel_beam", (xb, H / 2 - 0.15, zr + 0.06), (0.32, H + 0.3, 0.05), bevel=0.01)       # inner flange
    for a, b in zip(xsb[:-1], xsb[1:]):
        p.beam("steel_beam", (a, 0.15, zr + 0.28), (b, H - 0.35, zr + 0.28), 0.1, 0.06)
        p.beam("steel_beam", (a, H - 0.35, zr + 0.28), (b, 0.15, zr + 0.28), 0.1, 0.06)
        p.box("steel_beam", ((a + b) / 2, 0.15, zr + 0.24), (b - a, 0.14, 0.14), bevel=0.01)
    p.bx("concrete_dark", (-hw - 0.45, hw + 0.45), (-0.35, 0.28), (zr - 0.05, zr + 0.85), bevel=0.05)
    # tie rods sticking out of the footing (rebar)
    for i in range(9):
        xr = -hw + 0.4 + (W - 0.8) * i / 8.0
        p.tube("rebar", (xr, 0.28, zr + 0.5), (xr + 0.05, 0.28 + 0.3 + (i % 3) * 0.1, zr + 0.55), 0.012, sides=5)
    # -- amber beacons on the rear corners + LED strip on the nosing
    for sx in (-1, 1):
        bxp = sx * (hw + 0.05)
        p.tube("metal_dark", (bxp, H - 0.2, zr - 0.5), (bxp, H + 0.9, zr - 0.5), 0.05, sides=6)
        p.cyl("metal_dark", (bxp, H + 0.95, zr - 0.5), 0.15, 0.1, "y", sides=8)
        p.cyl("light_amber", (bxp, H + 1.08, zr - 0.5), 0.13, 0.16, "y", sides=8)
    for i in range(int(W / 1.2)):
        xa = -hw + 0.6 + i * 1.2
        p.box("light_amber", (xa, H + 0.005 + 0.045, L - 0.03), (0.4, 0.02, 0.05), rot=(ang, 0, 0))
    # -- collision (kerbs + rear wall + nosing)
    for sx in (-1, 1):
        xc = sx * (hw + 0.2)
        p.cbeam((xc, 0.15, 0.0), (xc, H + 0.3, L), 0.5, 0.6)
    p.cbx((-hw - 0.5, hw + 0.5), (-0.35, H + 0.05), (L - 0.15, L + 0.9))
    p.socket("lip", (0, H, L))
    return p



def make_pad(seed=4):
    W, L = 14.0, 4.0
    hw = W / 2
    p = Piece("speed_boost_pad", seed=seed, ground_y=0.0, dirt_amt=0.25, ao_dist=1.0, ao_amt=0.6)
    p.notes = dict(desc="Flat boost pad 14 x 4 m, drive-over (trigger volume = bbox). Emissive chevrons point +Z (light_boost, cyan).",
                   trigger_size=[14, 0.3, 4])
    prof = [(0.0, -0.02), (0.0, 0.0), (0.4, 0.055), (L - 0.4, 0.055), (L, 0.0), (L, -0.02)]
    p.extrude_x("metal_dark", prof, -hw, hw, bevel=0.012, sub=1.0)
    # border strips + bolts
    for sx in (-1, 1):
        p.bx("metal_bare", (sx * hw - (0.0 if sx > 0 else -0.0) - 0.0, sx * hw - sx * 0.3), (0.05, 0.075), (0.45, L - 0.45), bevel=0.01)
    p.bx("metal_bare", (-hw + 0.3, hw - 0.3), (0.054, 0.066), (0.42, 0.55), bevel=0.008)
    p.bx("metal_bare", (-hw + 0.3, hw - 0.3), (0.054, 0.066), (L - 0.55, L - 0.42), bevel=0.008)
    for i in range(29):
        x = -hw + 0.35 + (W - 0.7) * i / 28
        for z in (0.5, L - 0.5):
            p.cyl("metal_bare", (x, 0.07, z), 0.035, 0.014, "y", sides=6)
    # chevrons: 4 columns x 3 rows
    hwc, ap, th, pitch = 1.42, 1.05, 0.42, 0.88
    cols = [-5.25, -1.75, 1.75, 5.25]
    for cx in cols:
        for r in range(3):
            z0 = 0.62 + r * pitch
            prof = [(cx - hwc, z0), (cx, z0 + ap), (cx + hwc, z0), (cx + hwc, z0 + th), (cx, z0 + ap + th), (cx - hwc, z0 + th)]
            p.extrude_y("light_boost", prof, 0.06, 0.075, bevel=0.004)
    # centre + edge glow bars
    for sx in (-1, 1):
        p.bx("light_boost", (sx * (hw - 0.12) - 0.04, sx * (hw - 0.12) + 0.04), (0.06, 0.07), (0.7, L - 0.7))
    p.cextrude([(0, 0)] * 0 or [], 0, 0) if False else None
    p.chull([(-hw, 0, 0), (hw, 0, 0), (-hw, 0.055, 0.4), (hw, 0.055, 0.4), (-hw, 0.055, L - 0.4), (hw, 0.055, L - 0.4), (-hw, 0, L), (hw, 0, L)])
    p.socket("trigger", (0, 0.06, L / 2))
    return p


if __name__ == "__main__":
    which = os.environ.get("ONLY", "")
    if which in ("", "jump_ramp"):
        make_ramp("jump_ramp", 14.0, 12.0, 2.2).build()
    if which in ("", "jump_ramp_small"):
        pp = make_ramp("jump_ramp_small", 5.6, 7.5, 1.15, expo=1.35, seed=8)
        pp.build()
    if which in ("", "speed_boost_pad"):
        make_pad().build()

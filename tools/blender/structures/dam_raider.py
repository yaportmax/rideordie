"""spike_wall (7 m barricade segment), spike_gate (14 m with a 5 m gap), banner_skull (raider banner pole)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dam_common import *
from dam_gate import darken, scrap_wall, spike_row, PLATE_MATS

ONLY = os.environ.get("ONLY", "")


def barricade(p, x0, x1, seed=1, hgt=3.6, z=0.0, skulls=3, plating=True):
    """Welded barricade between x0 and x1 (faces -Z): jersey base, I-beam posts + rear struts, pipe rails, scrap plating, forward spikes."""
    rj = random.Random(seed)
    W = x1 - x0
    xm = (x0 + x1) / 2
    # concrete jersey base
    prof = [(-0.42, 0.0), (0.42, 0.0), (0.31, 0.3), (0.17, 0.85), (-0.17, 0.85), (-0.31, 0.3)]
    p.extrude_x("concrete_dark", [(pz + z, py) for pz, py in prof], x0, x1, bevel=0.02, sub=3.0, tint=0.5)
    # posts (H-beams) + rear braces
    n = max(2, int(round(W / 2.3)) + 1)
    xs = [x0 + 0.15 + (W - 0.3) * i / (n - 1) for i in range(n)]
    for x in xs:
        p.bx("steel_beam", (x - 0.14, x + 0.14), (0.8, hgt), (z - 0.35, z - 0.28), tint=0.75)
        p.bx("steel_beam", (x - 0.14, x + 0.14), (0.8, hgt), (z + 0.15, z + 0.22), tint=0.75)
        p.bx("steel_beam", (x - 0.02, x + 0.02), (0.8, hgt), (z - 0.28, z + 0.15), tint=0.75)
        p.beam("steel_beam", (x, 0.8, z + 0.2), (x, hgt - 0.6, z + 1.4), 0.16, 0.12, up=(1, 0, 0), tint=0.7) if False else None
        p.tube("rust", (x, 0.6, z + 1.5), (x, hgt - 0.9, z + 0.2), 0.07, sides=4, smooth=False)
    # horizontal pipe rails (front) with spikes
    rows = [1.1, 2.0, 2.9]
    for y in rows:
        p.tube("rust" if int(y * 10) % 2 else "metal_dark", (x0, y, z - 0.5), (x1, y, z - 0.5), 0.1, sides=6, tint=0.8)
    # scrap plating on the front (fills between rails)
    if plating:
        scrap_wall(p, (x1, 0.85, z - 0.36), (-1, 0, 0), (0, 1, 0), W, hgt - 1.2, seed=seed + 5, cover=0.72, wmin=1.0, wmax=2.2, hmin=0.7, hmax=1.3, bolts=0.05)
    # spikes: forward-pointing lances at each rail, plus a vertical top row
    cnt = max(4, int(W / 0.55))
    for y in rows:
        for i in range(cnt):
            x = x0 + 0.3 + (W - 0.6) * (i + rj.uniform(-0.2, 0.2)) / (cnt - 1)
            base = (x, y + rj.uniform(-0.06, 0.06), z - 0.55)
            tip = (x + rj.uniform(-0.15, 0.15), y + 0.55 + rj.uniform(0, 0.4), z - 0.55 - rj.uniform(1.0, 1.6))
            spike(p, base, tip, 0.05)
    for i in range(cnt):
        x = x0 + 0.25 + (W - 0.5) * i / (cnt - 1)
        spike(p, (x, hgt - 0.05, z - 0.2), (x + rj.uniform(-0.1, 0.1), hgt + rj.uniform(0.6, 1.0), z - 0.3 - rj.uniform(0.0, 0.3)), 0.05)
    # chain swags between posts
    for a, b in zip(xs[:-1], xs[1:]):
        prev = None
        for k in range(6):
            t = k / 5
            cur = (a + (b - a) * t, hgt - 0.3 - 0.45 * math.sin(math.pi * t), z - 0.42)
            if prev:
                p.tube("metal_dark", prev, cur, 0.035, sides=4, smooth=False)
            prev = cur
    # tyres at the ends, skulls on top posts
    tyre_stack(p, (x0 + 0.55, 0, z - 1.05), 2, seed=seed)
    tyre_stack(p, (x1 - 0.55, 0, z - 1.0), 3, seed=seed + 1)
    for i in range(skulls):
        x = xs[min(len(xs) - 1, 1 + i * max(1, (len(xs) - 2) // max(1, skulls - 1)) if skulls > 1 else 1)]
        p.tube("metal_dark", (x, hgt, z - 0.3), (x, hgt + 0.9, z - 0.3), 0.04, sides=4, smooth=False)
        skull(p, (x, hgt + 1.15, z - 0.3), s=0.55, yaw=180 + rj.uniform(-25, 25), detail=0)
    # hazard band on the top rail (pipe) as delineator
    hb = random.Random(seed + 9)
    m = int(W / 0.6)
    for i in range(m):
        xa = x0 + W * i / m
        xb = x0 + W * (i + 1) / m
        col = yellow(hb) if i % 2 == 0 else black(hb)
        p.tube("hazard", (xa, rows[2], z - 0.5), (xb, rows[2], z - 0.5), 0.125, sides=6, caps=False, tint=col)
    p.cbx((x0, x1), (0, hgt), (z - 0.9, z + 0.4))


def wall():
    p = Piece("spike_wall", seed=81, ground_y=0, dirt_h=1.5, dirt_amt=0.5, ao_dist=2.0, ao_amt=0.7, streak_amt=0.3, ao_rays=10)
    p.notes = dict(desc="Raider spiked barricade segment, 7 m wide (x -3.5..3.5), origin at road centre/segment centre on the ground. Front (spikes) faces -Z toward the approaching player, depth ~2 m to the spike tips (z -2.0..0.5). Chain two segments (x=+-3.5) to block the 14 m road.",
                   width=7.0, height=3.6, spike_tip_height=4.6, chain="x = -3.5 and +3.5")
    barricade(p, -3.5, 3.5, seed=81)
    darken(p, ("concrete_dark",), 0.6)
    return p


def gate():
    p = Piece("spike_gate", seed=82, ground_y=0, dirt_h=1.5, dirt_amt=0.5, ao_dist=2.0, ao_amt=0.7, streak_amt=0.3, ao_rays=10)
    p.notes = dict(desc="Raider spiked road gate: 14 m wide (x -7..7) with a 5 m gap (x -2.5..2.5) between two gate posts with braziers and skulls; open gate leaves folded against the posts; lintel banner at y=5.2 (clearance 5 m). Front faces -Z. Origin road centre, ground level.",
                   gap=[-2.5, 2.5], clearance=5.0)
    barricade(p, -7.0, -3.05, seed=91, skulls=2)
    barricade(p, 3.05, 7.0, seed=92, skulls=2)
    rj = random.Random(5)
    for s in (-1, 1):
        xp = s * 2.75
        # gate post: heavy pillar
        p.bx("concrete_dark", (xp - 0.45, xp + 0.45), (0, 1.0), (-0.6, 0.6), bevel=0.04, tint=0.5)
        p.bx("steel_beam", (xp - 0.3, xp + 0.3), (1.0, 5.6), (-0.3, 0.3), bevel=0.02, tint=0.7)
        scrap_wall(p, (xp + 0.32, 1.0, -0.31), (-1, 0, 0), (0, 1, 0), 0.64, 4.4, seed=93 + s, cover=0.8, wmin=0.5, wmax=0.64, hmin=0.7, hmax=1.3, bolts=0.0)
        p.bx("metal_dark", (xp - 0.5, xp + 0.5), (5.6, 5.8), (-0.5, 0.5), tint=0.8)
        brazier(p, (xp, 5.8, 0.0), r=0.45, h=0.6, legs=False)
        for k in range(3):
            spike(p, (xp + (k - 1) * 0.28, 5.8, -0.4), (xp + (k - 1) * 0.3, 6.6 + k * 0.1, -0.7), 0.045)
        skull(p, (xp + s * 0.0, 4.6, -0.55), s=0.62, yaw=180, detail=0)
        # folded gate leaf: frame + spikes, lying along the post on the reservoir side
        xl = xp + s * 0.62
        p.tube("rust", (xl, 1.0, -0.6), (xl, 1.0, 1.9), 0.07, sides=6)
        p.tube("rust", (xl, 3.2, -0.6), (xl, 3.2, 1.9), 0.07, sides=6)
        for zz in (-0.6, 0.6, 1.9):
            p.tube("metal_dark", (xl, 1.0, zz), (xl, 3.2, zz), 0.06, sides=6)
        for k in range(5):
            z_ = -0.4 + k * 0.5
            spike(p, (xl + s * 0.05, 2.1, z_), (xl + s * 0.6, 2.4, z_), 0.045)
        p.tube("metal_dark", (xp + s * 0.3, 1.0, -0.4), (xl, 1.0, -0.6), 0.05, sides=4, smooth=False)
        p.tube("metal_dark", (xp + s * 0.3, 3.2, -0.4), (xl, 3.2, -0.6), 0.05, sides=4, smooth=False)
        p.cbx((xp - 0.5, xp + 0.5), (0, 5.8), (-0.6, 0.6))
    # lintel + banner
    p.beam("metal_dark", (-2.9, 5.2, -0.1), (2.9, 5.2, -0.1), 0.35, 0.35, up=(0, 1, 0), tint=0.8)
    for i in range(11):
        x = -2.5 + i * 0.5
        spike(p, (x, 5.0, -0.1), (x, 4.55, -0.1), 0.04)
    def tf(s_, t_):
        k = 0.9 + 0.15 * math.sin(s_ * 7 + t_ * 5)
        return (0.75 * k * (1 - 0.35 * t_), 0.08 * k, 0.05 * k)
    cloth(p, "canvas", (2.2, 5.0, -0.25), (-1, 0, 0), (0, -1, 0), 4.4, 1.6, nu=8, nv=3, amp=0.12, wl=2.4, tatter=0.35, seed=4, tint_fn=tf, out=(0, 0, -1))
    skull(p, (0, 4.3, -0.5), s=0.9, yaw=180, detail=1)
    darken(p, ("concrete_dark",), 0.6)
    p.socket("gap_center", (0, 0, 0))
    return p


def banner():
    p = Piece("banner_skull", seed=83, ground_y=0, dirt_h=1.5, dirt_amt=0.45, ao_dist=2.0, ao_amt=0.7, streak_amt=0.3, ao_rays=10)
    p.notes = dict(desc="Raider banner pole (7.4 m): tilted steel pole on a tyre + concrete cairn base, crossbar with skull finials, tattered red banner with skull emblem on both faces (front faces -Z), brazier fire on top (light_amber), chains, skull string. Origin base centre.",
                   height=8.4, sockets="flame = brazier fire position")
    rj = random.Random(83)
    p.bx("concrete_dark", (-0.9, 0.9), (0, 0.55), (-0.9, 0.9), bevel=0.05, tint=0.5)
    tyre(p, (0, 0.72, 0), R=0.55, r=0.2)
    tyre(p, (0.05, 1.15, 0.02), R=0.55, r=0.2)
    top = (0.12, 7.4, 0.0)
    p.tube("rust", (0, 0.5, 0), top, 0.11, sides=8, r2=0.075)
    for k in range(4):
        y = 1.6 + k * 1.5
        f = (y - 0.5) / 6.9
        p.cyl("metal_dark", (0.12 * f, y, 0), 0.14, 0.12, "y", sides=8)
    # crossbar + skull finials
    yb = 6.5
    xc = 0.12 * (yb - 0.5) / 6.9
    zo = -0.36     # banner + crossbar stand in front of the pole
    p.tube("metal_dark", (xc - 1.45, yb, zo), (xc + 1.45, yb, zo), 0.055, sides=6)
    p.tube("metal_dark", (xc, yb, 0), (xc, yb, zo), 0.05, sides=5)
    p.tube("metal_dark", (xc, yb - 0.6, 0), (xc, yb, zo), 0.035, sides=4, smooth=False)
    for s in (-1, 1):
        spike(p, (xc + s * 1.45, yb, zo), (xc + s * 1.75, yb + 0.3, zo), 0.05)
        p.tube("metal_dark", (xc + s * 1.45, yb, zo), (xc + s * 1.45, yb + 0.7, zo), 0.03, sides=4, smooth=False)
        skull(p, (xc + s * 1.45, yb + 0.95, zo), s=0.5, yaw=180, detail=0)

    def tf(s_, t_):
        k = 0.9 + 0.15 * math.sin(s_ * 7 + t_ * 4)
        return (0.75 * k * (1 - 0.4 * t_), 0.08 * k, 0.05 * k)
    cloth(p, "canvas", (xc + 1.2, yb - 0.05, zo - 0.03), (-1, 0, 0), (0, -1, 0), 2.4, 4.6, nu=6, nv=10, amp=0.16, wl=2.6, tatter=0.3, seed=7, tint_fn=tf, out=(0, 0, -1))
    skull(p, (xc, yb - 1.9, zo - 0.3), s=1.15, yaw=180, detail=1)
    # pennant streaming from the top + brazier + spike crown
    cloth(p, "canvas", (top[0] + 0.05, 7.25, 0.0), (0, 0, 1), (0, -1, 0), 1.8, 0.55, nu=4, nv=2, amp=0.1, wl=1.5, tatter=0.4, seed=9, tint_fn=lambda s_, t_: (0.08, 0.08, 0.08), out=(1, 0, 0))
    brazier(p, (top[0], 7.4, 0.0), r=0.32, h=0.35, legs=False)
    for k in range(6):
        a = k * math.pi / 3
        spike(p, (top[0] + math.cos(a) * 0.3, 7.7, math.sin(a) * 0.3), (top[0] + math.cos(a) * 0.55, 8.35, math.sin(a) * 0.55), 0.03)
    # lower skull string + chains
    for k in range(3):
        y = 3.4 + k * 0.6
        a = (k - 1) * 0.5
        skull(p, (0.05 + math.sin(a) * 0.2, y, -0.2 - 0.02 * k), s=0.38, yaw=180 + a * 40, detail=0)
    prev = None
    for k in range(7):
        t = k / 6
        cur = (xc + 0.3 + 1.0 * t, yb - 0.1 - 0.5 * math.sin(math.pi * t) - 0.2 * t, zo + 0.15)
        if prev:
            p.tube("metal_dark", prev, cur, 0.03, sides=4, smooth=False)
        prev = cur
    p.cbx((-0.9, 0.9), (0, 1.5), (-0.9, 0.9))
    p.cbx((-0.15, 0.25), (1.5, 7.5), (-0.15, 0.15))
    p.socket("flame", (top[0], 7.6, 0.0))
    darken(p, ("concrete_dark",), 0.6)
    return p


if __name__ == "__main__":
    if ONLY in ("", "spike_wall"):
        wall().build()
    if ONLY in ("", "spike_gate"):
        gate().build()
    if ONLY in ("", "banner_skull"):
        banner().build()

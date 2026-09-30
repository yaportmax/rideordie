"""Tall roadblock modules (readable from 200 m out of the cab): rb_wreck_stack, rb_container.
Same contract as the rb_* modules in roadside.py: road-aligned (x lateral, +z along the road), origin on the road at the module's
centre line, visuals + collision within |x| <= hw, body around z 1..7 (the breakable barricade line of the sim sits at z=3.5).
Socket `fire` = where the game puts a flame + smoke column."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *
from roadside import wreck_car, Xf, sandbags, drum, skull, _burn, _tyres, _wire, cloth


def container_across(p, x0, x1, zc, tint, y0=0.0, doors_at=1):
    """ISO container lying ACROSS the road (its length along x from x0 to x1), 2.44 wide (z), 2.59 tall; corrugated faces."""
    W, H = 2.44, 2.59
    z0, z1 = zc - W / 2, zc + W / 2
    p.bx("paint", (x0, x1), (y0, y0 + H), (z0, z1), tint=tint)
    # corrugation ribs on both long faces + roof ribs
    n = int((x1 - x0) / 0.3)
    for i in range(1, n):
        x = x0 + i * (x1 - x0) / n
        for z, s in ((z0, -1), (z1, 1)):
            p.bx("paint", (x - 0.06, x + 0.06), (y0 + 0.2, y0 + H - 0.15), (z + s * 0.0, z + s * 0.05), tint=tuple(c * 0.7 for c in tint))
    # frame rails + corner castings
    for z in (z0, z1):
        for y in (y0, y0 + H - 0.14):
            p.bx("metal_dark", (x0 - 0.02, x1 + 0.02), (y, y + 0.16), (z - 0.03, z + 0.03))
    for x in (x0, x1):
        for z in (z0, z1):
            p.bx("metal_dark", (x - 0.1, x + 0.1), (y0, y0 + H), (z - 0.1, z + 0.1))
    # door end (bars) at x1 side
    xe = x1 if doors_at > 0 else x0
    for zz in (zc - 0.5, zc + 0.5):
        p.tube("metal_bare", (xe + 0.03 * doors_at, y0 + 0.2, zz), (xe + 0.03 * doors_at, y0 + H - 0.2, zz), 0.03, sides=6, smooth=False)
    # rust patches
    rr = random.Random(int(zc * 100) + 7)
    for _ in range(5):
        xc, w, yc, h = rr.uniform(x0 + 0.5, x1 - 0.5), rr.uniform(0.5, 1.4), y0 + rr.uniform(0.5, 2.0), rr.uniform(0.3, 0.8)
        for z, s in ((z0, -1), (z1, 1)):
            p.bx("rust", (xc - w / 2, xc + w / 2), (yc - h / 2, yc + h / 2), (z + s * 0.055, z + s * 0.065), tint=(0.55, 0.42, 0.36))
    p.cbx((x0, x1), (y0, y0 + H), (z0, z1))


def scrap_wall(p, x0, x1, z, y0, h, seed=1):
    """Welded scrap-sheet parapet (facing -z, the approaching traffic) with spikes on top."""
    rr = random.Random(seed)
    x = x0
    while x < x1 - 0.2:
        w = min(x1 - x, rr.uniform(0.7, 1.5))
        hh = h * rr.uniform(0.75, 1.1)
        mat = rr.choice(["rust", "metal_dark", "paint2", "rust"])
        tint = (0.34, 0.2, 0.14) if mat == "paint2" else (0.62, 0.52, 0.46) if mat == "rust" else None
        p.box(mat, (x + w / 2, y0 + hh / 2, z + rr.uniform(-0.05, 0.05)), (w, hh, 0.06), rot=(rr.uniform(-6, 6), rr.uniform(-8, 8), rr.uniform(-4, 4)), tint=tint)
        # spike on top
        p.tube("spike", (x + w / 2, y0 + hh - 0.05, z), (x + w / 2 + rr.uniform(-0.2, 0.2), y0 + hh + 0.75, z - 0.25), 0.05, r2=0.005, sides=5, smooth=False)
        x += w * 0.92
    # hazard paint on a couple of sheets (yellow/black diagonal)
    for i in range(3):
        xc = x0 + (x1 - x0) * (i + 0.5) / 3
        p.box("hazard", (xc, y0 + h * 0.45, z - 0.045), (0.7, 0.35, 0.02), tint=(1.0, 0.74, 0.04) if i % 2 == 0 else (0.03, 0.03, 0.035))


def rb_wreck_stack():
    """5.6 m module: overturned van lying across the road with a burnt sedan flipped on top + tyres, drums, a skull pole."""
    hw = 2.8
    p = Piece("rb_wreck_stack", seed=91, ground_y=0.0, dirt_h=1.5, dirt_amt=0.5, ao_dist=2.5, streak_amt=0.3, noise_amt=0.35)
    p.notes = dict(desc="Tall roadblock module (%.1f m wide, x -%.2f..%.2f, road-aligned): overturned van across the road with a burnt car flipped on top (~4.3 m), tyres, drums, skull pole. Socket `fire` on the top wreck. Visuals + collision never exceed |x| <= hw." % (hw * 2, hw, hw), hw=hw)
    _burn(p, 0.0, 3.6, 2.4)
    wreck_car(p, 0.0, 3.1, 90, "van", pitch=90, y=0.99, mat="paint", burnt=0.9, missing_wheels=(1,), seed=31)
    p.cbx((-hw + 0.1, hw - 0.1), (0.0, 1.98), (2.1, 4.1))
    # sedan flipped on top, slewed a little, resting on the van
    wreck_car(p, 0.15, 3.3, 78, "sedan", roll=180, y=1.98 + 1.42, mat="rust", burnt=0.95, missing_wheels=(0, 2), seed=32)
    p.cbx((-2.25, 2.35), (1.98, 3.45), (2.35, 4.25))
    # tyres + drums at the foot, skull on a pole
    _tyres(p, -1.9, 5.8, 3)
    _tyres(p, 1.8, 1.0, 2)
    drum(p, -1.4, 1.2, tint=(0.4, 0.15, 0.08))
    drum(p, 0.9, 5.9, fallen=True, tint=(0.35, 0.2, 0.1))
    p.tube("rust", (2.1, 0, 5.6), (2.3, 5.2, 5.4), 0.06, sides=6)
    skull(p, (2.3, 5.4, 5.35), 0.55)
    p.socket("fire", (0.2, 3.5, 3.3))
    p.socket("hw", (hw, 0, 0))
    return p


def rb_container():
    """6.5 m module: container lying across the road, scrap-sheet parapet with spikes on top, sandbags, a war banner."""
    hw = 3.25
    p = Piece("rb_container", seed=92, ground_y=0.0, dirt_h=1.2, dirt_amt=0.5, ao_dist=2.2, streak_amt=0.35, noise_amt=0.35)
    p.notes = dict(desc="Tall roadblock module (%.1f m wide, x -%.2f..%.2f, road-aligned): rusty container lying across the road with a spiked scrap parapet on top (~4.4 m), sandbags, drums, war banner. Socket `fire` (drum fire on the roof). Visuals + collision never exceed |x| <= hw." % (hw * 2, hw, hw), hw=hw)
    rr = random.Random(5)
    tint = (0.4, 0.12, 0.07)
    _burn(p, 0.3, 3.4, 2.2)
    container_across(p, -3.03, 3.03, 3.4, tint)
    # parapet on the roof, facing the approach (-z) + a second one at the back
    scrap_wall(p, -3.0, 3.0, 2.25, 2.59, 1.25, seed=3)
    sandbags(p, -1.8, 2.8, n=4, yaw=0)
    for i in range(4):
        p.box("canvas", (-1.8 + (i - 1.5) * 0.62, 2.59 + 0.13, 3.0), (0.6, 0.26, 0.38), bevel=0.07, tint=(0.75, 0.68, 0.5))
    # rooftop drum fire + banner pole with a tattered red banner
    p.cyl("rust", (1.4, 2.59 + 0.45, 3.9), 0.29, 0.9, "y", sides=10, tint=(0.35, 0.18, 0.1))
    p.tube("metal_dark", (-2.6, 2.59, 4.3), (-2.7, 7.2, 4.3), 0.07, sides=6)
    p.tube("metal_dark", (-2.7, 7.0, 4.3), (-1.2, 7.05, 4.3), 0.04, sides=6)
    cloth(p, "canvas", -2.65, -1.25, 6.95, 4.4, 4.33, nx=4, ny=8, amp=0.15, tint=(0.55, 0.06, 0.04))
    skull(p, (-2.7, 7.45, 4.3), 0.5)
    # sandbags + drums at the foot (front)
    sandbags(p, 1.2, 1.7, n=8, yaw=4)
    p.cbx((0.1, 2.4), (0, 0.6), (1.5, 1.9))
    drum(p, -2.4, 1.5, tint=(0.4, 0.15, 0.08))
    drum(p, -1.7, 1.35, fallen=True, tint=(0.3, 0.3, 0.12))
    _tyres(p, 2.5, 5.9, 3)
    _wire(p, 0.0, 1.9, y=0.9)
    p.socket("fire", (1.4, 3.5, 3.9))
    p.socket("hw", (hw, 0, 0))
    return p


if __name__ == "__main__":
    only = os.environ.get("ONLY", "")
    if only in ("", "rb_wreck_stack"):
        rb_wreck_stack().build()
    if only in ("", "rb_container"):
        rb_container().build()

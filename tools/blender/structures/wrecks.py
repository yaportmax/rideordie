"""Loose vehicle wrecks for streets / roadsides: wreck_sedan, wreck_pickup, wreck_van, wreck_flipped, wreck_bus.
Origin = ground centre of the car, front (+Z). Each has one collision box (cars can crash into them)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *
from roadside import wreck_car, Xf


def bus(p, x, z, yaw, seed=1, burnt=0.7):
    """City bus hulk, 11.5 m, window band with most panes gone, flat tyres."""
    rr = random.Random(seed)
    L, hw, H = 11.4, 1.27, 3.05
    M = xf((x, 0.0, z), (0, yaw, 0))
    tint = (0.38, 0.34, 0.3) if burnt > 0.6 else (0.75, 0.7, 0.62)
    with Xf(p, M):
        # body shell: lower skirt, window band, roof (loft rings along z)
        rings = []
        n = 9
        for i in range(n):
            t = i / (n - 1)
            zz = -L / 2 + L * t
            k = 0.12 if (i == 0 or i == n - 1) else 0.0
            rings.append([(-hw, 0.42, zz), (hw, 0.42, zz), (hw, 1.25, zz), (hw - 0.04, H - 0.25 - k, zz), (hw - 0.3, H - k, zz),
                          (-hw + 0.3, H - k, zz), (-hw + 0.04, H - 0.25 - k, zz), (-hw, 1.25, zz)])
        p.loft("paint", rings, flat=False, tint=tint)
        # window band voids (dark) with a few panes left
        for sx in (-1, 1):
            for i in range(9):
                z0 = -L / 2 + 1.0 + i * 1.1
                if rr.random() < 0.2:
                    p.quad("glass", (sx * (hw + 0.012), 1.45, z0 + (0.95 if sx > 0 else 0)), (sx * (hw + 0.012), 1.45, z0 + (0 if sx > 0 else 0.95)),
                           (sx * (hw + 0.005), 2.5, z0 + (0 if sx > 0 else 0.95)), (sx * (hw + 0.005), 2.5, z0 + (0.95 if sx > 0 else 0)))
                else:
                    p.quad("metal_dark", (sx * (hw + 0.012), 1.45, z0 + (0.95 if sx > 0 else 0)), (sx * (hw + 0.012), 1.45, z0 + (0 if sx > 0 else 0.95)),
                           (sx * (hw + 0.005), 2.5, z0 + (0 if sx > 0 else 0.95)), (sx * (hw + 0.005), 2.5, z0 + (0.95 if sx > 0 else 0)))
        # windscreen + rear
        p.quad("metal_dark", (hw - 0.1, 1.3, L / 2 + 0.01), (-hw + 0.1, 1.3, L / 2 + 0.01), (-hw + 0.2, 2.7, L / 2 + 0.01), (hw - 0.2, 2.7, L / 2 + 0.01))
        p.box("metal_dark", (0, 0.6, L / 2 + 0.05), (2 * hw - 0.1, 0.35, 0.12), bevel=0.02)
        p.box("metal_dark", (0, 0.6, -L / 2 - 0.05), (2 * hw - 0.1, 0.35, 0.12), bevel=0.02)
        # destination board
        p.box("metal_dark", (0, 2.8, L / 2 + 0.02), (1.6, 0.3, 0.05))
        # wheels (flat, some gone)
        for wz in (-L * 0.3, L * 0.33):
            for sx in (-1, 1):
                if rr.random() < 0.25:
                    continue
                p.cyl("rubber", (sx * (hw - 0.12), 0.42, wz), 0.48, 0.3, "x", sides=12, tint=(0.6, 0.6, 0.6))
        # roof hatch + rust holes (dark patches)
        p.box("metal_dark", (0.2, H + 0.02, 1.0), (0.9, 0.06, 0.9))
        for i in range(4):
            p.box("rust", (rr.uniform(-0.8, 0.8), H + 0.01, rr.uniform(-4.5, 4.5)), (rr.uniform(0.5, 1.4), 0.03, rr.uniform(0.6, 1.6)), tint=(0.7, 0.55, 0.45))
        p.cbox((0, H / 2 + 0.2, 0), (2 * hw, H - 0.1, L))


def build(name, fn):
    p = Piece(name, seed=sum(ord(c) for c in name) % 1000, ground_y=0.0, dirt_h=1.2, dirt_amt=0.5, ao_dist=2.2, streak_amt=0.35, noise_amt=0.35)
    fn(p)
    p.notes = dict(desc="Loose vehicle wreck, origin ground centre, front +Z, one collision box.")
    p.build()


if __name__ == "__main__":
    only = os.environ.get("ONLY", "")
    todo = {
        "wreck_sedan": lambda p: wreck_car(p, 0, 0, 0, "sedan", mat="rust", burnt=0.9, missing_wheels=(1, 2), seed=21),
        "wreck_sedan_b": lambda p: wreck_car(p, 0, 0, 0, "sedan", mat="paint", burnt=0.3, missing_wheels=(3,), seed=22),
        "wreck_pickup": lambda p: wreck_car(p, 0, 0, 0, "pickup", mat="rust", burnt=0.5, missing_wheels=(0,), seed=23),
        "wreck_van": lambda p: wreck_car(p, 0, 0, 0, "van", mat="paint", burnt=0.4, missing_wheels=(), seed=24),
        "wreck_flipped": lambda p: wreck_car(p, 0, 0, 0, "coupe", roll=180, y=1.33, mat="rust", burnt=0.8, missing_wheels=(2,), seed=25),
        "wreck_bus": lambda p: bus(p, 0, 0, 0, seed=26, burnt=0.3),
    }
    for k, fn in todo.items():
        if only in ("", k):
            build(k, fn)

"""e_van "Boxer": armored cargo van.  ~5.6 m x 2.1 m x 2.4 m (3.3 m with the gunner standing in the roof hatch).
Run: blender -b --factory-startup -P tools/blender/vehicles/enemy_b/e_van.py
Game space: +X left, +Y up, +Z forward.  Driver on +X."""
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts import *  # noqa

m = Model('e_van', seed=11)
m.alias.update({'metal_bare': 'armor', 'wood': 'paint2', 'plastic': 'interior', 'fabric': 'interior', 'rust': 'armor', 'canvas': 'paint2'})
PI = math.pi
HW = 1.0                      # half width of skin
ROOF = 2.40
HUBY = 0.43
ZF, ZR = 1.65, -1.55          # axle positions


def both(fn):
    fn(1)
    fn(-1)


# ================================================================================ WHEELS
wheel_set(m, 'van', 0.43, 0.30, [(0.85, HUBY, ZF), (-0.85, HUBY, ZF), (0.85, HUBY, ZR), (-0.85, HUBY, ZR)],
          ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'], lugs=15, spl=3, tread_h=0.032, nuts=8, ribs=6)

# ================================================================================ CHASSIS / UNDERSIDE  (body)
m.use('body')
for sx in (1, -1):
    m.box('metal_dark', (0.10, 0.16, 5.5), at=(0.52 * sx, 0.36, -0.05), bevel=0)                  # ladder rails
    m.box('metal_dark', (0.04, 0.04, 5.3), at=(0.52 * sx, 0.28, -0.05), bevel=0)
for z in (-2.5, -1.9, -0.9, 0.2, 0.9, 1.3, 2.4):
    m.box('metal_dark', (1.16, 0.09, 0.10), at=(0, 0.37, z), bevel=0)                           # cross members
# axles + diffs + springs
for zc in (ZF, ZR):
    m.cyl('metal_dark', (-0.86, HUBY, zc), (0.86, HUBY, zc), 0.055, seg=8)
    m.revolve('metal_dark', [(0, -0.2), (0.17, -0.17), (0.2, -0.05), (0.2, 0.05), (0.17, 0.17), (0, 0.2)], at=(0, HUBY, zc), axis='z', seg=14, sx=1.0)
    m.cyl('metal_bare', (-0.2, HUBY, zc + 0.19), (0.2, HUBY, zc + 0.19), 0.06, seg=10)
    for sx in (1, -1):
        m.box('metal_dark', (0.09, 0.03, 0.9), at=(0.62 * sx, HUBY + 0.13, zc), bevel=0)          # leaf springs
        m.box('metal_dark', (0.09, 0.02, 0.7), at=(0.62 * sx, HUBY + 0.16, zc), bevel=0)
        m.box('metal_dark', (0.14, 0.05, 0.08), at=(0.62 * sx, HUBY + 0.11, zc), bevel=0)          # U-bolt plate
        m.cyl('metal_bare', (0.62 * sx, HUBY + 0.07, zc - 0.05), (0.62 * sx, HUBY + 0.24, zc - 0.05), 0.012, seg=5)
        m.cyl('metal_bare', (0.62 * sx, HUBY + 0.07, zc + 0.05), (0.62 * sx, HUBY + 0.24, zc + 0.05), 0.012, seg=5)
        # shock absorbers
        m.cyl('metal_bare', (0.72 * sx, HUBY - 0.02, zc + 0.15), (0.66 * sx, 0.58, zc + 0.18), 0.02, seg=6)
        m.cyl('metal_dark', (0.72 * sx, HUBY - 0.02, zc + 0.15), (0.70 * sx, 0.3, zc + 0.16), 0.03, seg=6)
    # brake drums / hub flanges (behind rim face)
    for sx in (1, -1):
        m.cyl('metal_dark', (0.7 * sx, HUBY, zc), (0.8 * sx, HUBY, zc), 0.2, seg=14)
# driveshaft + gearbox + transfer
m.cyl('metal_bare', (0, 0.41, 1.0), (0, 0.41, -1.35), 0.04, seg=8)
m.cyl('metal_dark', (0, 0.41, 0.05), (0, 0.41, 0.09), 0.06, seg=8)
m.cyl('metal_dark', (0, 0.41, -0.7), (0, 0.41, -0.66), 0.06, seg=8)
m.box('metal_dark', (0.38, 0.32, 0.7), at=(0, 0.5, 1.05), bevel=0)                                 # gearbox
# fuel tank (left) + straps
m.box('metal_dark', (0.5, 0.26, 1.0), at=(0.66, 0.34, -0.55), bevel=0)
for z in (-0.25, -0.85):
    m.box('metal_bare', (0.54, 0.03, 0.05), at=(0.66, 0.2, z), bevel=0)
# exhaust system: manifold pipe -> muffler -> tailpipe (right side, low)
m.tube('metal_dark', [(-0.3, 0.75, 2.05), (-0.42, 0.55, 1.6), (-0.5, 0.36, 1.2), (-0.5, 0.33, -1.9), (-0.45, 0.33, -2.25)], 0.045, seg=8, bend=0.2)
m.revolve('metal_dark', [(0, -0.5), (0.11, -0.46), (0.13, -0.3), (0.13, 0.3), (0.11, 0.46), (0, 0.5)], at=(-0.5, 0.31, -1.55), axis='z', seg=14, sx=1.1, sy=0.8)
m.tube('chrome', [(-0.45, 0.33, -2.2), (-0.45, 0.33, -2.68), (-0.45, 0.4, -2.86)], 0.05, seg=10, bend=0.1, r_end=0.058)
m.cyl('metal_dark', (-0.45, 0.4, -2.84), (-0.45, 0.4, -2.87), 0.046, seg=10)
# tow hooks/recovery points front
for sx in (1, -1):
    m.tube('metal_bare', [(0.4 * sx, 0.42, 2.6), (0.4 * sx, 0.42, 2.92), (0.4 * sx, 0.3, 2.95), (0.4 * sx, 0.3, 2.85)], 0.025, seg=6, bend=0.05)

# ================================================================================ FLOOR / INTERIOR
m.box('interior', (1.9, 0.05, 4.4), at=(0, 0.52, -0.4), bevel=0)                                # cargo+cab floor
m.box('interior', (1.9, 0.05, 1.0), at=(0, 0.52, 2.1), bevel=0)
m.box('armor', (1.85, 0.03, 3.0), at=(0, 0.55, -1.25), bevel=0)                                 # tread-plate cargo floor
for i in range(9):
    m.box('metal_bare', (1.85, 0.012, 0.03), at=(0, 0.57, -2.6 + i * 0.36), bevel=0)
# inner skins (cargo) with ribs
for sx in (1, -1):
    m.box('metal_dark', (0.04, 1.75, 2.8), at=(0.9 * sx, 1.4, -1.35), bevel=0)
    for i in range(6):
        m.box('metal_bare', (0.06, 1.75, 0.06), at=(0.88 * sx, 1.4, -2.6 + i * 0.5), bevel=0)
for i in range(7):
    m.box('metal_bare', (1.8, 0.06, 0.06), at=(0, 2.33, -2.6 + i * 0.5), bevel=0)               # roof ribs
m.box('metal_dark', (1.8, 0.03, 3.9), at=(0, 2.35, -0.85), bevel=0)
# partition between cab and cargo
m.box('metal_dark', (1.86, 1.75, 0.06), at=(0, 1.4, -0.1), bevel=0)
m.box('armor', (0.5, 0.55, 0.05), at=(0.45, 1.6, -0.14), bevel=0)
# gunner platform: stacked crates (his feet at y = 1.5)
m.box('wood', (0.95, 0.5, 0.95), at=(0, 0.8, -0.95), bevel=0)
m.box('wood', (0.95, 0.45, 0.95), at=(0, 1.275, -0.95), bevel=0)
for y in (0.8, 1.275):
    for sx in (1, -1):
        m.box('metal_dark', (0.03, 0.4, 0.98), at=(0.47 * sx, y, -0.95), bevel=0)
    m.box('metal_dark', (0.98, 0.4, 0.03), at=(0, y, -1.43), bevel=0)
m.box('metal_dark', (0.96, 0.03, 0.96), at=(0, 1.51, -0.95), bevel=0)
m.box('paint2', (0.5, 0.36, 0.5), at=(0.62, 0.78, -2.0), bevel=0.03, seg=2)                                # ammo/gear boxes
m.box('wood', (0.55, 0.3, 0.7), at=(-0.6, 0.72, -2.05), bevel=0)
m.box('armor', (0.35, 0.18, 0.5), at=(-0.62, 0.96, -2.0), bevel=0)
# benches
for sx in (1, -1):
    m.box('fabric', (0.42, 0.08, 1.2), at=(0.68 * sx, 0.95, -1.75), bevel=0)
# cab: seats, dash, wheel
bucket_seat(m, (0.42, 0.98, 0.42), w=0.5)
bucket_seat(m, (-0.42, 0.98, 0.42), w=0.5)
m.box('interior', (0.14, 0.32, 0.9), at=(0, 0.72, 0.6), bevel=0.02, seg=1)                                 # tunnel/console
m.hull('interior', [(-0.94, 1.02, 1.65), (0.94, 1.02, 1.65), (-0.94, 1.32, 1.6), (0.94, 1.32, 1.6), (-0.94, 1.26, 1.0), (0.94, 1.26, 1.0), (-0.94, 0.9, 1.0), (0.94, 0.9, 1.0)], bevel=0.03, seg=2)
m.box('interior', (0.5, 0.2, 0.2), at=(0.42, 1.32, 1.02), bevel=0.02, seg=1)                                # instrument hood
for gx in (0.3, 0.5):
    m.revolve('light_amber', [(0, 0.012), (0.034, 0.008), (0.034, 0.0), (0, 0.0)], at=(gx, 1.31, 0.915), axis='-z', seg=12)
steering_wheel(m, (0.42, 1.31, 0.86), tilt=24)
m.box('metal_dark', (0.06, 0.05, 0.5), at=(0, 1.28, 0.5), bevel=0.005, seg=1)                              # grab bar
m.sock('seat_driver', (0.42, 0.98, 0.42))
m.sock('seat_gunner', (0.0, 1.5, -0.95))
# ================================================================================ ENGINE BAY (under panel_hood)
m.hull('metal_dark', [(-0.34, 0.6, 1.8), (0.34, 0.6, 1.8), (-0.34, 1.0, 1.85), (0.34, 1.0, 1.85), (-0.34, 0.6, 2.5), (0.34, 0.6, 2.5), (-0.34, 0.95, 2.45), (0.34, 0.95, 2.45)], bevel=0)
for sx in (1, -1):
    m.box('metal_bare', (0.14, 0.09, 0.62), at=(0.2 * sx, 1.06, 2.14), bevel=0)                 # valve covers
    m.box('metal_bare', (0.1, 0.07, 0.5), at=(0.2 * sx, 1.13, 2.14), bevel=0)
    for i in range(4):
        m.hexbolt('metal_dark', (0.2 * sx, 1.165, 1.95 + i * 0.14), (0, 1, 0), r=0.014, h=0.012)
m.box('metal_bare', (0.3, 0.09, 0.4), at=(0, 1.06, 2.14), bevel=0)                                # intake
m.cyl('metal_dark', (0.0, 1.18, 2.0), (0, 1.18, 2.35), 0.09, seg=10)                                        # air cleaner
m.hull('metal_dark', [(-0.72, 0.58, 2.62), (0.72, 0.58, 2.62), (-0.72, 1.06, 2.62), (0.72, 1.06, 2.62), (-0.72, 0.58, 2.68), (0.72, 0.58, 2.68), (-0.72, 1.06, 2.68), (0.72, 1.06, 2.68)], bevel=0)   # radiator
for i in range(8):
    m.box('metal_bare', (1.36, 0.012, 0.03), at=(0, 0.62 + i * 0.055, 2.585), bevel=0)
m.cyl('metal_dark', (0, 0.83, 2.35), (0, 0.83, 2.6), 0.2, seg=12)
for a in range(0, 360, 60):
    m.box('metal_bare', (0.03, 0.17, 0.006), at=(0.1 * math.cos(a * D2R), 0.83 + 0.1 * math.sin(a * D2R), 2.545), rot=(0, 0, a - 90), bevel=0)
m.box('plastic', (0.22, 0.2, 0.16), at=(0.62, 0.78, 2.15), bevel=0)                                # battery
m.hexbolt('metal_bare', (0.55, 0.9, 2.2), (0, 1, 0), r=0.02, h=0.03)
m.hexbolt('metal_bare', (0.7, 0.9, 2.2), (0, 1, 0), r=0.02, h=0.03)
m.tube('rubber_tire', [(0.3, 0.9, 2.35), (0.6, 1.02, 2.5), (0.7, 0.9, 2.6)], 0.028, seg=6, bend=0.1)          # hoses
m.tube('rubber_tire', [(-0.3, 0.9, 2.35), (-0.6, 1.02, 2.5), (-0.7, 0.9, 2.6)], 0.028, seg=6, bend=0.1)
m.sock('smoke_engine', (0, 1.05, 2.2))
m.sock('camera_hood', (0, 1.42, 2.3))

# ================================================================================ SKIN (side walls with arches, door and slit holes)
def arch(zc, r=0.58, n=10):
    t0 = math.asin(0.07 / r)
    out = []
    for i in range(n + 1):
        t = PI - t0 - (PI - 2 * t0) * i / n
        out.append((zc + r * math.cos(t), HUBY + r * math.sin(t)))
    return out


outline = [(-2.8, 0.5), (-2.15, 0.5)]
outline += arch(ZR)
outline += [(-0.98, 0.5), (1.08, 0.5)]
outline += arch(ZF)
outline += [(2.22, 0.5), (2.8, 0.5), (2.8, 1.02), (2.74, 1.12), (1.7, 1.12), (0.95, ROOF), (-2.8, ROOF)]
door_hole = [(0.04, 0.66), (1.0, 0.66), (1.0, 2.12), (0.04, 2.12)]
slits = [[(-2.3, 1.78), (-1.72, 1.78), (-1.72, 1.94), (-2.3, 1.94)], [(-1.2, 1.78), (-0.62, 1.78), (-0.62, 1.94), (-1.2, 1.94)]]
for sx in (1, -1):
    m.plate('paint', outline, 0.05, at=(0.975 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.01, seg=1, holes=[door_hole] + slits)
    # door frame inner (dark) + sill
    m.box('metal_dark', (0.06, 0.06, 1.04), at=(0.93 * sx, 0.66, 0.52), bevel=0.006, seg=1)
    m.box('metal_dark', (0.12, 1.5, 0.06), at=(0.93 * sx, 1.38, 0.03), bevel=0.006, seg=1)               # B-pillar
    m.box('armor', (0.14, 0.09, 1.1), at=(0.97 * sx, 0.55, 0.5), bevel=0.012, seg=1)                     # side step
    # inner door liner (visible when door is shot off)
    m.box('interior', (0.04, 1.3, 0.9), at=(0.88 * sx, 1.35, 0.52), bevel=0.01, seg=1)
    # slit window glass + dark interior glimpses
    for zc in (-2.01, -0.91):
        m.box('glass', (0.02, 0.14, 0.56), at=(0.975 * sx, 1.86, zc), bevel=0, seg=1)
        # slit frame
        m.box('armor', (0.05, 0.03, 0.66), at=(1.0 * sx, 1.965, zc), bevel=0.004, seg=1)
        m.box('armor', (0.05, 0.03, 0.66), at=(1.0 * sx, 1.755, zc), bevel=0.004, seg=1)
    # rear arch flare + inner liner
    for zc in (ZR,):
        m.revolve('metal_dark', [(0.6, -0.16), (0.6, 0.16), (0.56, 0.16), (0.56, -0.16)], at=(0.86 * sx, HUBY, zc), axis='x', seg=24)
    # sill / rocker rail and lower rust strip
    m.box('metal_dark', (0.09, 0.07, 6.0 - 0.6), at=(1.0 * sx, 0.46, 0.0), bevel=0.01, seg=1)
    # mud flaps
    m.box('rubber_tire', (0.02, 0.32, 0.3), at=(1.0 * sx, 0.3, ZR - 0.68), bevel=0.006, seg=1)
    m.box('rubber_tire', (0.02, 0.3, 0.28), at=(1.0 * sx, 0.28, ZF - 0.7), bevel=0.006, seg=1)
    # armored rear arch flares (paint2)
    for zc, dz in ((ZR, 0), (ZF, 0)):
        pts = [(zc + 0.66 * math.cos(t * D2R), HUBY + 0.66 * math.sin(t * D2R)) for t in range(10, 171, 20)]
        pts_in = [(zc + 0.56 * math.cos(t * D2R), HUBY + 0.56 * math.sin(t * D2R)) for t in range(170, 9, -20)]
        if zc == ZR:
            m.plate('paint2', pts + pts_in, 0.06, at=(1.045 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.008, seg=1)
            for (a, b) in pts[::1]:
                m.rivet('metal_bare', (1.078 * sx, b - 0.045 * (b - HUBY) / 0.66, a - 0.045 * (a - zc) / 0.66), (sx, 0, 0), r=0.012)

# roof: plate with hatch hole
roof_pts = [(-1.0, -2.8), (1.0, -2.8), (1.0, 0.95), (-1.0, 0.95)]
m.plate('paint2', [(x, z) for x, z in roof_pts], 0.05, at=(0, ROOF + 0.005, 0), u=(1, 0, 0), v=(0, 0, 1), bevel=0.012, seg=2,
        holes=[[(-0.45, -1.4), (0.45, -1.4), (0.45, -0.5), (-0.45, -0.5)]])
# front pillar/roof brow (armored visor)
m.hull('armor', [(-1.0, ROOF - 0.05, 0.95), (1.0, ROOF - 0.05, 0.95), (-1.0, ROOF + 0.06, 0.85), (1.0, ROOF + 0.06, 0.85),
                 (-0.98, ROOF - 0.35, 1.28), (0.98, ROOF - 0.35, 1.28), (-0.98, ROOF - 0.22, 1.18), (0.98, ROOF - 0.22, 1.18)], bevel=0.015, seg=2)
m.rivet_line('metal_bare', (-0.9, ROOF + 0.065, 0.87), (0.9, ROOF + 0.065, 0.87), (0, 1, 0), step=0.14, r=0.012)
# rear wall (fixed part behind tailgate): frame + bumper mount
m.box('metal_dark', (2.0, 0.28, 0.08), at=(0, 0.66, -2.76), bevel=0.01, seg=1)
m.box('metal_dark', (2.0, 0.12, 0.08), at=(0, ROOF - 0.06, -2.76), bevel=0.01, seg=1)
for sx in (1, -1):
    m.box('paint', (0.14, 1.6, 0.09), at=(0.93 * sx, 1.5, -2.76), bevel=0.012, seg=1)
for sx in (1, -1):
    for i in range(5):
        m.box('decal_yellow', (0.15, 0.09, 0.02), at=(0.93 * sx, 0.72 + i * 0.19, -2.815), rot=(0, 0, 32 * sx), bevel=0, seg=1)
# ---- floor pan front (firewall) and cowl
m.box('metal_dark', (1.94, 0.9, 0.06), at=(0, 1.0, 1.66), bevel=0.01, seg=1)
m.hull('paint2', [(-0.99, 1.12, 1.72), (0.99, 1.12, 1.72), (-0.99, 1.2, 1.62), (0.99, 1.2, 1.62), (-0.99, 1.12, 1.55), (0.99, 1.12, 1.55)], bevel=0.008, seg=1)

# ================================================================================ WINDSHIELD + roof gunner hatch
WS_LO, WS_HI = (1.2, 1.66), (ROOF - 0.05, 0.93)
def ws(f, dx):
    return (dx, WS_LO[0] + (WS_HI[0] - WS_LO[0]) * f, WS_LO[1] + (WS_HI[1] - WS_LO[1]) * f)
m.hull('glass', [ws(0, -0.9), ws(0, 0.9), ws(1, 0.9), ws(1, -0.9)] + [(x, y + 0.012, z + 0.006) for x, y, z in (ws(0, -0.9), ws(0, 0.9), ws(1, 0.9), ws(1, -0.9))], bevel=0, seg=1)
for f in (0.22, 0.46, 0.7):        # armor slats (slit visor look)
    a, b = ws(f, -0.93), ws(f, 0.93)
    m.beam('armor', (a[0], a[1] + 0.04, a[2] + 0.03), (b[0], b[1] + 0.04, b[2] + 0.03), 0.06, 0.03, up=(0, 1, 0), bevel=0.006, seg=1)
for sx in (1, -1):                  # A-pillars
    a, b = ws(0, 0.94 * sx), ws(1, 0.94 * sx)
    m.beam('paint', (a[0], a[1] + 0.01, a[2] + 0.01), (b[0], b[1] + 0.01, b[2] + 0.01), 0.1, 0.09, up=(0, 1, 0), bevel=0.012, seg=1)
for x in (-0.45, 0.0, 0.45):        # vertical guard bars
    a, b = ws(0.05, x), ws(0.95, x)
    m.beam('metal_dark', (a[0], a[1] + 0.05, a[2] + 0.04), (b[0], b[1] + 0.05, b[2] + 0.04), 0.022, 0.022, bevel=0.004, seg=1)
# hatch coaming + lid + hinge (gunner pops out of here)
cz = -0.95
m.box('armor', (1.02, 0.17, 0.08), at=(0, ROOF + 0.09, -1.4 - 0.02), bevel=0.012, seg=1)
m.box('armor', (1.02, 0.17, 0.08), at=(0, ROOF + 0.09, -0.5 + 0.02), bevel=0.012, seg=1)
for sx in (1, -1):
    m.box('armor', (0.08, 0.17, 0.98), at=(0.49 * sx, ROOF + 0.09, cz), bevel=0.012, seg=1)
m.rivet_rect('metal_bare', (0, ROOF + 0.178, cz), 1.0, 1.0, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.11, r=0.011, inset=0.04)
# lid, opened ~100 deg, hinged at the rear edge
lid_h = (0, ROOF + 0.17, -1.44)
m.box('armor', (1.0, 0.05, 0.86), at=(0, ROOF + 0.17 + 0.86 / 2 * math.sin(112 * D2R), -1.44 + 0.86 / 2 * math.cos(112 * D2R)), rot=(-112, 0, 0), bevel=0.012, seg=1)
m.rivet_rect('metal_bare', (0, ROOF + 0.17 + 0.86 / 2 * math.sin(112 * D2R) + 0.026 * math.cos(112 * D2R) * -1, -1.44 + 0.86 / 2 * math.cos(112 * D2R) + 0.026 * math.sin(112 * D2R)), 0.96, 0.8, (0, math.cos(22 * D2R), math.sin(22 * D2R)), u=(1, 0, 0), v=(0, math.sin(112 * D2R), math.cos(112 * D2R)), step=0.16, r=0.011, inset=0.05)
m.cyl('metal_dark', (-0.42, ROOF + 0.17, -1.46), (0.42, ROOF + 0.17, -1.46), 0.03, seg=8)
m.beam('metal_dark', (0.4, ROOF + 0.18, -0.7), (0.4, ROOF + 0.72, -1.7), 0.03, 0.03, bevel=0.004, seg=1)   # lid stay
# ================================================================================ ROOF RACK, LIGHTS, ANTENNA
RY = ROOF + 0.12
for sx in (1, -1):
    m.tube('metal_dark', [(0.88 * sx, ROOF + 0.05, 0.6), (0.88 * sx, RY + 0.12, 0.6), (0.88 * sx, RY + 0.12, -0.28)], 0.02, seg=7, bend=0.05)
    m.tube('metal_dark', [(0.88 * sx, RY + 0.12, -1.7), (0.88 * sx, RY + 0.12, -2.6), (0.88 * sx, ROOF + 0.05, -2.6)], 0.02, seg=7, bend=0.05)
    for z in (0.6, -0.28, -1.7, -2.6):
        m.cyl('metal_dark', (0.88 * sx, ROOF + 0.02, z), (0.88 * sx, RY + 0.12, z), 0.02, seg=7)
        m.box('metal_dark', (0.09, 0.02, 0.09), at=(0.88 * sx, ROOF + 0.04, z), bevel=0.004, seg=1)
for z in (0.6, -0.28, -1.7, -2.6):
    m.cyl('metal_dark', (-0.88, RY + 0.12, z), (0.88, RY + 0.12, z), 0.016, seg=7)
for i in range(4):
    m.cyl('metal_dark', (-0.88, RY + 0.12, 0.6 - i * 0.29), (0.88, RY + 0.12, 0.6 - i * 0.29), 0.012, seg=6) if i in (1,) else None
m.cyl('metal_dark', (-0.88, RY + 0.12, 0.6), (-0.88, RY + 0.12, 0.6 + 0.001), 0.001, seg=3)
# rack slats / decking
for z in (0.45, 0.15):
    m.box('metal_dark', (1.72, 0.03, 0.1), at=(0, RY + 0.11, z), bevel=0.005, seg=1)
for z in (-1.85, -2.15, -2.45):
    m.box('metal_dark', (1.72, 0.03, 0.1), at=(0, RY + 0.11, z), bevel=0.005, seg=1)
# cargo on rack: spare tyre (flat) at rear, jerrycans, rolled canvas
spare_l, spare_r = 0.42, 0.24
m.revolve('rubber_tire', [(spare_r, -0.14), (spare_l - 0.03, -0.14), (spare_l, -0.09), (spare_l, 0.09), (spare_l - 0.03, 0.14), (spare_r, 0.14)], at=(0.0, RY + 0.26, -2.15), axis='y', seg=20)
m.revolve('rim', [(0, 0.09), (0.26, 0.09), (0.26, 0.145), (0, 0.145)], at=(0.0, RY + 0.26, -2.15), axis='y', seg=20)
for i in range(6):
    a = i * PI / 3
    m.hexbolt('rim', (0.13 * math.cos(a), RY + 0.41, -2.15 + 0.13 * math.sin(a)), (0, 1, 0), r=0.018, h=0.03)
jerrycan(m, (0.55, RY + 0.31, -1.78), rot=(0, 90, 0), mat='paint2')
jerrycan(m, (-0.55, RY + 0.31, -1.78), rot=(0, 90, 0), mat='paint')
m.revolve('canvas', [(0, -0.42), (0.11, -0.4), (0.13, -0.3), (0.13, 0.3), (0.11, 0.4), (0, 0.42)], at=(0.45, RY + 0.19, -2.45), axis='x', seg=12, sx=1.0)
m.box('wood', (0.5, 0.22, 0.4), at=(-0.5, RY + 0.24, -2.5), bevel=0.02, seg=1)
# spotlights on the roof brow + searchlight bar
for x in (-0.7, -0.35, 0.35, 0.7):
    spotlight(m, (x, ROOF + 0.17, 0.83), n=(0, -0.05, 1), r=0.085)
m.box('armor', (1.85, 0.05, 0.08), at=(0, ROOF + 0.06, 0.72), bevel=0.008, seg=1)
# antenna with rag flag
m.tube('metal_dark', [(-0.93, RY + 0.12, -2.6), (-0.95, RY + 0.6, -2.63), (-0.94, RY + 1.15, -2.66)], 0.011, seg=5, r_end=0.004)
m.box('cloth_red', (0.01, 0.16, 0.42), at=(-0.94, RY + 1.0, -2.87), rot=(0, 0, 4), bevel=0.0, seg=1)
m.sock('roof_top', (0, RY + 0.12, -0.3))
# vertical exhaust stack (right side behind cab, exits at roof rack height)
exhaust_stack(m, (-1.06, 0.62, -0.3), (-1.06, 2.5, -0.3), r=0.07, mat='chrome')
m.box('armor', (0.1, 0.14, 0.2), at=(-1.04, 0.9, -0.3), bevel=0.01, seg=1)
for y in (1.4, 1.95):
    m.box('metal_dark', (0.06, 0.05, 0.18), at=(-1.0, y, -0.3), bevel=0.006, seg=1)
m.sock('exhaust_R', (-1.06, 2.5, -0.3))
m.sock('exhaust_L', (0.45, 0.4, -2.86))
m.sock('fuel_cap', (1.03, 1.02, -0.62))
m.box('chrome', (0.03, 0.14, 0.14), at=(1.03, 1.02, -0.62), bevel=0.008, seg=1)
m.box('metal_dark', (0.02, 0.2, 0.2), at=(1.012, 1.02, -0.62), bevel=0.006, seg=1)
m.sock('nitro_L', (0.5, 0.55, -2.87))
m.sock('nitro_R', (-0.5, 0.55, -2.87))

# ================================================================================ LIGHTS
for sx in (1, -1):
    headlight(m, (0.66 * sx, 0.98, 2.78), 0.115, n=(0, 0, 1), obj='body')
    # cage over headlight
    for a in (0, 60, 120):
        m.beam('metal_dark', (0.66 * sx + 0.14 * math.cos(a * D2R), 0.98 + 0.14 * math.sin(a * D2R), 2.83), (0.66 * sx - 0.14 * math.cos(a * D2R), 0.98 - 0.14 * math.sin(a * D2R), 2.83), 0.014, 0.014, bevel=0.002, seg=1)
    light_rect(m, (0.9 * sx, 0.98, 2.79), (0.1, 0.09), 'light_amber', n=(0, 0, 1))
    light_rect(m, (0.9 * sx, 1.32, -2.905), (0.12, 0.42), 'light_tail', n=(0, 0, -1), depth=0.14)
    light_rect(m, (0.9 * sx, 0.9, -2.905), (0.1, 0.1), 'light_amber', n=(0, 0, -1), depth=0.14)
    m.box('armor', (0.22, 0.02, 0.1), at=(0.9 * sx, 1.57, -2.92), bevel=0.004, seg=1)
    m.box('armor', (0.22, 0.02, 0.1), at=(0.9 * sx, 1.07, -2.92), bevel=0.004, seg=1)
m.sock('light_head_L', (0.66, 0.98, 2.82))
m.sock('light_head_R', (-0.66, 0.98, 2.82))
m.sock('light_tail_L', (0.9, 1.32, -2.92))
m.sock('light_tail_R', (-0.9, 1.32, -2.92))

# ================================================================================ PANELS
# ---- hood (hinge at cowl)
m.panel('panel_hood', (0, 1.16, 1.68), metal_dark='paint2', chrome='paint2', metal_bare='paint2', armor='paint2')
m.hull('paint2', [(-1.0, 1.1, 1.72), (1.0, 1.1, 1.72), (-1.0, 1.24, 1.72), (1.0, 1.24, 1.72), (-1.0, 1.14, 2.78), (1.0, 1.14, 2.78), (-1.0, 1.02, 2.8), (1.0, 1.02, 2.8)], bevel=0.02, seg=2, obj='panel_hood')
m.hull('armor', [(-0.62, 1.22, 1.9), (0.62, 1.22, 1.9), (-0.55, 1.36, 1.98), (0.55, 1.36, 1.98), (-0.55, 1.34, 2.5), (0.55, 1.34, 2.5), (-0.62, 1.15, 2.6), (0.62, 1.15, 2.6)], bevel=0.02, seg=2, obj='panel_hood')   # engine hump / vent scoop
for i in range(6):
    m.box('metal_dark', (0.62, 0.012, 0.025), at=(0, 1.372 - i * 0.002, 1.99 + i * 0.075), bevel=0.002, seg=1, obj='panel_hood')
m.rivet_rect('metal_bare', (0, 1.225, 2.3), 1.9, 0.98, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.16, r=0.012, inset=0.06, obj='panel_hood')
for sx in (1, -1):
    m.box('metal_dark', (0.06, 0.05, 0.26), at=(0.55 * sx, 1.145, 2.72), bevel=0.01, seg=1, obj='panel_hood')      # latches
    m.cyl('metal_dark', (0.35 * sx, 1.22, 1.72), (0.55 * sx, 1.22, 1.72), 0.025, seg=8, obj='panel_hood')          # hinges
    m.beam('armor', (0.9 * sx, 1.14, 1.9), (0.9 * sx, 1.14, 2.75), 0.06, 0.05, bevel=0.008, seg=1, obj='panel_hood')
m.use('body')

# ---- doors (hinged at front edge z=1.0)
for sx, nm in ((1, 'panel_door_L'), (-1, 'panel_door_R')):
    m.panel(nm, (1.0 * sx, 1.35, 1.0), metal_dark='armor', chrome='armor')
    xd = 1.0 * sx
    outer = [(0.05, 0.68), (0.99, 0.68), (0.99, 2.1), (0.05, 2.1)]
    win = [(0.2, 1.5), (0.86, 1.5), (0.86, 2.0), (0.2, 2.0)]
    m.plate('paint', outer, 0.06, at=(0.985 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.012, seg=1, holes=[win], obj=nm)
    m.box('glass', (0.02, 0.5, 0.66), at=(0.985 * sx, 1.75, 0.53), bevel=0, seg=1, obj=nm)
    # armor skirt plate on the lower half with rivets
    m.box('armor', (0.03, 0.72, 0.86), at=(1.03 * sx, 1.02, 0.52), bevel=0.012, seg=1, obj=nm)
    m.rivet_rect('metal_bare', (1.048 * sx, 1.02, 0.52), 0.86, 0.72, (sx, 0, 0), u=(0, 0, -1), v=(0, 1, 0), step=0.13, r=0.011, obj=nm)
    # window bars + frame
    for zz in (0.36, 0.53, 0.7):
        m.box('metal_dark', (0.03, 0.56, 0.028), at=(1.02 * sx, 1.75, zz), bevel=0.004, seg=1, obj=nm)
    m.box('armor', (0.05, 0.05, 0.72), at=(1.02 * sx, 1.49, 0.53), bevel=0.008, seg=1, obj=nm)
    m.box('armor', (0.05, 0.05, 0.72), at=(1.02 * sx, 2.02, 0.53), bevel=0.008, seg=1, obj=nm)
    m.box('chrome', (0.05, 0.03, 0.16), at=(1.05 * sx, 1.36, 0.14), bevel=0.008, seg=1, obj=nm)                     # handle
    m.weld('metal_bare', (1.05 * sx, 1.4, 0.1), (1.05 * sx, 1.4, 0.95), r=0.007, obj=nm)
    for y in (0.85, 1.85):
        m.cyl('metal_dark', (1.0 * sx, y, 1.0), (1.0 * sx, y + 0.12, 1.0), 0.025, seg=8, obj=nm)
    # side mirror
    m.tube('metal_dark', [(1.05 * sx, 1.75, 0.95), (1.3 * sx, 1.9, 1.0)], 0.015, seg=6, obj=nm)
    m.box('metal_dark', (0.05, 0.22, 0.16), at=(1.33 * sx, 1.9, 1.0), bevel=0.015, seg=1, obj=nm)
    m.box('chrome', (0.01, 0.18, 0.12), at=(1.30 * sx, 1.9, 1.0), bevel=0.0, seg=1, obj=nm)
    m.use('body')

# ---- side armor plates on the cargo box (welded)
for sx, nm in ((1, 'panel_armor_L'), (-1, 'panel_armor_R')):
    m.panel(nm, (1.06 * sx, 1.4, -1.4), metal_dark='armor', chrome='armor', decal_yellow='armor')
    x = 1.03 * sx
    plates = [(-2.72, -1.65, 0.78, 2.28, 'armor'), (-1.62, -0.55, 0.78, 2.28, 'paint2'), (-0.52, -0.15, 0.78, 2.28, 'rust')]
    for (z0, z1, y0, y1, mt) in plates:
        zc, yc, w, h = (z0 + z1) / 2, (y0 + y1) / 2, z1 - z0, y1 - y0
        if mt == 'paint2':
            m.plate(mt, [(z0, y0), (z1, y0), (z1, y1 - 0.1), (z1 - 0.1, y1), (z0, y1)], 0.035, at=(x, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.01, seg=1,
                    holes=[[(-1.2, 1.76), (-0.6, 1.76), (-0.6, 1.96), (-1.2, 1.96)]], obj=nm)
        elif mt == 'armor' and z0 < -2:
            m.plate(mt, [(z0, y0), (z1, y0), (z1, y1), (z0 + 0.12, y1), (z0, y1 - 0.12)], 0.04, at=(x, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.01, seg=1,
                    holes=[[(-2.34, 1.76), (-1.7, 1.76), (-1.7, 1.96), (-2.34, 1.96)]], obj=nm)
        else:
            m.box(mt, (0.035, h, w), at=(x, yc, zc), bevel=0.01, seg=1, obj=nm)
        m.rivet_rect('metal_bare', (x + 0.024 * sx, yc, zc), w, h, (sx, 0, 0), u=(0, 0, -1), v=(0, 1, 0), step=0.16, r=0.012, inset=0.045, obj=nm)
    # diagonal brace + weld seams
    m.weld('metal_bare', (x + 0.03 * sx, 0.8, -1.635), (x + 0.03 * sx, 2.26, -1.635), r=0.009, obj=nm)
    m.weld('metal_bare', (x + 0.03 * sx, 0.8, -0.535), (x + 0.03 * sx, 2.26, -0.535), r=0.009, obj=nm)
    m.box('armor', (0.05, 0.04, 2.6), at=(x + 0.02 * sx, 2.3, -1.42), bevel=0.006, seg=1, obj=nm)
    # painted skull sigil and stripe (plastic/decal)
    m.box('decal_yellow', (0.006, 0.16, 0.9), at=(x + 0.022 * sx, 0.95, -1.1), bevel=0, seg=1, obj=nm)
    for i in range(5):
        m.box('metal_dark', (0.006, 0.16, 0.09), at=(x + 0.026 * sx, 0.95, -1.5 + i * 0.18), rot=(0, 0, 0), bevel=0, seg=1, obj=nm)
    m.use('body')

# ---- front fenders (flares, paint)
for sx, nm in ((1, 'panel_fender_L'), (-1, 'panel_fender_R')):
    m.panel(nm, (1.03 * sx, 0.9, ZF))
    zc = ZF
    pts = [(zc + 0.68 * math.cos(t * D2R), HUBY + 0.68 * math.sin(t * D2R)) for t in range(0, 181, 15)]
    inn = [(zc + 0.58 * math.cos(t * D2R), HUBY + 0.58 * math.sin(t * D2R)) for t in range(180, -1, -15)]
    m.plate('paint', pts + inn, 0.07, at=(1.04 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.01, seg=1, obj=nm)
    for (a, b) in pts[1:-1]:
        m.rivet('metal_bare', (1.08 * sx, b, a), (sx, 0, 0), r=0.012, obj=nm)
    m.use('body')

# ---- front bumper / ram grille
m.panel('panel_bumper_F', (0, 0.7, 2.8), metal_dark='armor', chrome='armor', spike='armor')
m.hull('armor', [(-1.08, 0.42, 2.72), (1.08, 0.42, 2.72), (-1.08, 0.88, 2.72), (1.08, 0.88, 2.72), (-1.04, 0.42, 2.94), (1.04, 0.42, 2.94), (-1.04, 0.88, 2.88), (1.04, 0.88, 2.88)], bevel=0.02, seg=2, obj='panel_bumper_F')
m.box('metal_dark', (1.5, 0.12, 0.06), at=(0, 0.66, 2.94), bevel=0.01, seg=1, obj='panel_bumper_F')
m.rivet_rect('metal_bare', (0, 0.65, 2.945), 2.0, 0.4, (0, 0, 1), u=(-1, 0, 0), v=(0, 1, 0), step=0.14, r=0.012, inset=0.05, obj='panel_bumper_F')
# ram bars (vertical grille), horizontal spine and spikes
for i in range(7):
    x = -0.9 + i * 0.3
    m.beam('armor', (x, 0.88, 2.86), (x * 0.96, 1.42, 2.78), 0.07, 0.05, bevel=0.01, seg=1, obj='panel_bumper_F')
m.beam('armor', (-0.98, 1.16, 2.8), (0.98, 1.16, 2.8), 0.1, 0.07, bevel=0.012, seg=1, obj='panel_bumper_F')
m.beam('armor', (-0.98, 1.4, 2.78), (0.98, 1.4, 2.78), 0.07, 0.06, bevel=0.01, seg=1, obj='panel_bumper_F')
for sx in (1, -1):
    m.beam('armor', (1.0 * sx, 0.85, 2.85), (1.0 * sx, 1.45, 2.78), 0.1, 0.07, bevel=0.012, seg=1, obj='panel_bumper_F')
    m.box('armor', (0.42, 0.06, 0.4), at=(0.6 * sx, 0.44, 3.0), rot=(-10, 0, 0), bevel=0.01, seg=1, obj='panel_bumper_F')   # skid
for i in range(5):
    x = -0.6 + i * 0.3
    m.spike('spike', (x, 0.64, 2.96), (x, 0.66, 3.32 if i % 2 == 0 else 3.18), 0.038, seg=6, obj='panel_bumper_F')
for sx in (1, -1):
    m.spike('spike', (1.0 * sx, 1.2, 2.84), (1.16 * sx, 1.22, 3.1), 0.04, seg=6, obj='panel_bumper_F')
    m.spike('spike', (1.02 * sx, 0.7, 2.86), (1.25 * sx, 0.7, 3.0), 0.038, seg=6, obj='panel_bumper_F')
m.use('body')

# ---- rear bumper + tow hitch
m.panel('panel_bumper_R', (0, 0.62, -2.86), metal_dark='armor', chrome='armor', spike='armor')
m.hull('armor', [(-1.06, 0.42, -2.8), (1.06, 0.42, -2.8), (-1.06, 0.8, -2.8), (1.06, 0.8, -2.8), (-1.02, 0.42, -2.98), (1.02, 0.42, -2.98), (-1.02, 0.8, -2.94), (1.02, 0.8, -2.94)], bevel=0.02, seg=2, obj='panel_bumper_R')
m.rivet_rect('metal_bare', (0, 0.61, -2.985), 2.0, 0.34, (0, 0, -1), u=(1, 0, 0), v=(0, 1, 0), step=0.14, r=0.012, inset=0.05, obj='panel_bumper_R')
m.cyl('metal_bare', (0, 0.56, -3.02), (0, 0.72, -3.02), 0.045, seg=10, obj='panel_bumper_R')
m.box('metal_dark', (0.3, 0.04, 0.2), at=(0, 0.52, -3.0), bevel=0.01, seg=1, obj='panel_bumper_R')
for sx in (1, -1):
    m.box('metal_dark', (0.5, 0.04, 0.12), at=(0.78 * sx, 0.82, -2.95), bevel=0.008, seg=1, obj='panel_bumper_R')
    m.spike('spike', (1.0 * sx, 0.62, -2.98), (1.14 * sx, 0.62, -3.18), 0.04, seg=6, obj='panel_bumper_R')
m.use('body')

# ---- tailgate: welded double rear doors
m.panel('panel_tailgate', (0, 1.5, -2.84), metal_dark='armor', chrome='armor', paint2='armor')
for sx in (1, -1):
    xc = 0.47 * sx
    m.box('armor', (0.94, 1.62, 0.06), at=(xc, 1.5, -2.86), bevel=0.012, seg=1, obj='panel_tailgate')
    m.rivet_rect('metal_bare', (xc, 1.5, -2.892), 0.94, 1.62, (0, 0, -1), u=(1, 0, 0), v=(0, 1, 0), step=0.15, r=0.012, inset=0.05, obj='panel_tailgate')
    m.box('paint2', (0.5, 0.5, 0.02), at=(xc, 1.1, -2.905), bevel=0.006, seg=1, obj='panel_tailgate')
    for y in (0.9, 1.5, 2.1):
        m.box('metal_dark', (0.14, 0.09, 0.06), at=(0.95 * sx, y, -2.84), bevel=0.008, seg=1, obj='panel_tailgate')     # hinges
    m.box('armor', (0.04, 1.62, 0.09), at=(0.04 * sx, 1.5, -2.9), bevel=0.006, seg=1, obj='panel_tailgate')
m.cyl('metal_bare', (0.0, 1.35, -2.93), (0.0, 1.65, -2.93), 0.02, seg=8, obj='panel_tailgate')
m.box('metal_dark', (0.14, 0.05, 0.03), at=(0.08, 1.5, -2.94), bevel=0.004, seg=1, obj='panel_tailgate')
for x in (-0.75, -0.25, 0.25, 0.75):
    m.beam('metal_dark', (x, 0.72, -2.92), (x, 1.05, -2.92), 0.05, 0.02, bevel=0.004, seg=1, obj='panel_tailgate')
m.weld('metal_bare', (-0.9, 1.5, -2.905), (0.9, 1.5, -2.905), r=0.009, obj='panel_tailgate')
m.use('body')

m.finish()

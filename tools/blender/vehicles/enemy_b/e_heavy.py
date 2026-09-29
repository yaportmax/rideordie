"""e_heavy "Hauler": military 6x6 flatbed converted into a gunner platform.  ~8.2 m x 2.6 m, deck 1.6 m, cab roof 3.15 m.
Run: blender -b --factory-startup -P tools/blender/vehicles/enemy_b/e_heavy.py
Game space: +X left, +Y up, +Z forward.  Driver on +X."""
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts import *  # noqa

m = Model('e_heavy', seed=21)
m.alias.update({'metal_bare': 'armor', 'plastic': 'interior', 'fabric': 'interior', 'rust': 'armor', 'chrome': 'metal_dark',
                'spike': 'armor', 'rim': 'metal_dark', 'decal_yellow': 'paint2', 'leather': 'interior', 'brass': 'metal_dark'})
PI = math.pi
R_W, W_W, HUBY = 0.66, 0.44, 0.66
HX = 1.02
ZF, ZM, ZR = 2.9, -1.1, -2.7
YD = 1.6                 # deck top
CFLOOR, ROOF = 1.4, 3.15
CAB_R, CAB_F = 1.05, 2.78
AL = dict(metal_dark='armor', chrome='armor', metal_bare='armor')

wheel_set(m, 'hv', R_W, W_W, [(HX, HUBY, ZF), (-HX, HUBY, ZF), (HX, HUBY, ZM), (-HX, HUBY, ZM), (HX, HUBY, ZR), (-HX, HUBY, ZR)],
          ['wheel_FL', 'wheel_FR', 'wheel_ML', 'wheel_MR', 'wheel_RL', 'wheel_RR'], rim_ratio=0.56, lugs=17, spl=3, tread_h=0.045, nuts=10, ribs=8, lug_skew=1.6, dish=0.46)

# ================================================================================ CHASSIS
m.use('body')
for sx in (1, -1):
    m.box('metal_dark', (0.14, 0.3, 8.0), at=(0.55 * sx, 1.15, -0.1), bevel=0)
    m.box('metal_dark', (0.05, 0.05, 7.8), at=(0.55 * sx, 0.98, -0.1), bevel=0)
for z in (-3.9, -3.3, -2.0, -0.4, 0.5, 1.2, 2.0, 3.3, 3.85):
    m.box('metal_dark', (1.1, 0.2, 0.12), at=(0, 1.16, z), bevel=0)
# axles, diffs, springs
for zc in (ZF, ZM, ZR):
    m.cyl('metal_dark', (-HX + 0.2, HUBY, zc), (HX - 0.2, HUBY, zc), 0.08, seg=8)
    m.revolve('metal_dark', [(0, -0.3), (0.24, -0.26), (0.3, -0.1), (0.3, 0.1), (0.24, 0.26), (0, 0.3)], at=(0, HUBY, zc), axis='z', seg=12)
    for sx in (1, -1):
        m.cyl('metal_dark', (HX * sx - 0.18 * sx, HUBY, zc), (HX * sx - 0.34 * sx, HUBY, zc), 0.27, seg=12)     # hub reduction housings
        m.cyl('metal_dark', (0.62 * sx, HUBY - 0.05, zc - 0.3), (0.62 * sx, 1.0, zc - 0.3), 0.03, seg=5)
        m.cyl('metal_dark', (0.62 * sx, HUBY - 0.05, zc + 0.3), (0.62 * sx, 1.0, zc + 0.3), 0.03, seg=5)
for sx in (1, -1):
    m.box('metal_dark', (0.11, 0.05, 1.4), at=(0.64 * sx, 0.96, ZF), bevel=0)
    m.box('metal_dark', (0.11, 0.04, 1.1), at=(0.64 * sx, 0.99, ZF), bevel=0)
    m.box('metal_dark', (0.12, 0.07, 3.3), at=(0.64 * sx, 0.95, (ZM + ZR) / 2), bevel=0)             # bogie leaf spring
    m.box('metal_dark', (0.12, 0.05, 2.7), at=(0.64 * sx, 1.0, (ZM + ZR) / 2), bevel=0)
    m.box('metal_dark', (0.2, 0.28, 0.3), at=(0.64 * sx, 0.9, (ZM + ZR) / 2), bevel=0)
    m.cyl('metal_dark', (0.95 * sx, 0.6, ZF + 0.35), (0.95 * sx, 1.08, ZF + 0.35), 0.04, seg=6)         # shocks
m.tube('metal_dark', [(-0.7, 0.72, ZF + 0.3), (0.0, 0.72, ZF + 0.5), (0.7, 0.72, ZF + 0.3)], 0.025, seg=6)   # tie rod
for z0, z1 in ((0.7, ZF - 0.05), (0.5, ZM + 0.05), (ZM - 0.05, ZR + 0.05)):
    m.cyl('metal_dark', (0, 0.92 if z0 < 1 else 0.95, z0), (0, 0.85, z1), 0.05, seg=8)
m.box('metal_dark', (0.55, 0.5, 1.3), at=(0, 1.1, 1.3), bevel=0)                                    # gearbox / transfer case
m.box('metal_dark', (0.5, 0.35, 0.5), at=(0, 0.9, 0.35), bevel=0)
# fuel tank (left), air tanks + battery box (right)
m.revolve('metal_dark', [(0, -0.62), (0.28, -0.6), (0.31, -0.5), (0.31, 0.5), (0.28, 0.6), (0, 0.62)], at=(0.98, 1.0, 0.1), axis='z', seg=14)
for z in (-0.3, 0.5):
    m.box('metal_bare', (0.05, 0.7, 0.06), at=(0.98, 1.0, z), bevel=0)
m.cyl('chrome', (1.05, 1.3, 0.05), (1.05, 1.36, 0.05), 0.05, seg=10)
for i, z in enumerate((-0.2, 0.3)):
    m.revolve('metal_dark', [(0, -0.3), (0.13, -0.28), (0.15, -0.2), (0.15, 0.2), (0.13, 0.28), (0, 0.3)], at=(-0.96, 1.0, z), axis='z', seg=10)
m.box('armor', (0.42, 0.34, 0.45), at=(-0.98, 1.05, 0.7), bevel=0)
# exhaust pipes -> stacks
m.tube('metal_dark', [(-0.62, 1.75, 3.15), (-0.9, 1.5, 3.0), (-1.18, 1.32, 2.6), (-1.2, 1.32, 1.1)], 0.055, seg=8, bend=0.25)
m.tube('metal_dark', [(0.62, 1.75, 3.15), (0.9, 1.5, 3.0), (1.18, 1.32, 2.6), (1.2, 1.32, 1.1)], 0.055, seg=8, bend=0.25)
exhaust_stack(m, (-1.22, 1.3, 1.0), (-1.22, 3.7, 1.0), r=0.085, mat='chrome')
exhaust_stack(m, (1.22, 1.3, 1.0), (1.22, 3.45, 1.0), r=0.085, mat='chrome')
for sx in (1, -1):
    for y in (1.75, 2.45, 3.1):
        m.box('metal_dark', (0.1, 0.05, 0.2), at=(1.17 * sx, y, 1.0), bevel=0)
m.sock('exhaust_R', (-1.22, 3.7, 1.0))
m.sock('exhaust_L', (1.22, 3.45, 1.0))
# rear: pintle hook, crossmember
m.box('metal_dark', (0.5, 0.2, 0.3), at=(0, 1.0, -4.05), bevel=0)
m.cyl('metal_bare', (0, 0.92, -4.2), (0, 1.12, -4.2), 0.06, seg=8)
# underbody spare wheel carrier (rear)
# ================================================================================ DECK / BED
m.box('wood', (2.44, 0.1, 4.9), at=(0, YD - 0.05, -1.55), bevel=0)
for i in range(11):
    m.box('metal_dark', (2.44, 0.012, 0.02), at=(0, YD + 0.001, -3.98 + i * 0.45), bevel=0)
for i in range(6):
    m.box('metal_dark', (0.02, 0.012, 4.85), at=(-1.0 + i * 0.4, YD + 0.002, -1.55), bevel=0)
for sx in (1, -1):
    m.box('armor', (0.16, 0.24, 5.0), at=(1.21 * sx, YD - 0.16, -1.55), bevel=0.012, seg=1)               # deck sills
m.box('armor', (2.6, 0.24, 0.16), at=(0, YD - 0.16, -4.03), bevel=0.012, seg=1)
m.box('armor', (2.5, 0.24, 0.16), at=(0, YD - 0.16, 0.88), bevel=0.012, seg=1)
for z in (-3.6, -2.7, -1.8, -0.9, 0.0, 0.7):
    m.box('metal_dark', (2.3, 0.16, 0.09), at=(0, YD - 0.2, z), bevel=0)
# side board posts, rails
for sx in (1, -1):
    for z in (0.85, -0.66, -2.21, -3.96):
        m.box('armor', (0.09, 1.16, 0.09), at=(1.22 * sx, YD + 0.58 + 0.08, z), bevel=0.008, seg=1)
    m.tube('metal_dark', [(1.22 * sx, YD + 1.15, 0.85), (1.22 * sx, YD + 1.15, -3.96)], 0.026, seg=7)
    m.tube('metal_dark', [(1.22 * sx, YD + 0.85, 0.85), (1.22 * sx, YD + 0.85, -3.96)], 0.022, seg=7)
m.tube('metal_dark', [(1.22, YD + 1.15, -3.96), (-1.22, YD + 1.15, -3.96)], 0.026, seg=7)
# sandbag bunkers (behind cab + rear)
sandbag_wall(m, (-1.0, 0.5), (1.0, 0.5), 3, YD, depth=0.4)
for sx in (1, -1):
    sandbag_wall(m, (0.98 * sx, 0.28), (0.98 * sx, -0.95), 3, YD, depth=0.4)
    sandbag_wall(m, (0.98 * sx, -3.3), (0.98 * sx, -2.55), 2, YD, depth=0.4)
sandbag_wall(m, (-1.0, -3.55), (1.0, -3.55), 2, YD, depth=0.4)
# gun mount pedestal + ring
GM = (0.0, YD, -1.9)
m.revolve('armor', [(0, 0), (0.42, 0), (0.44, 0.04), (0.4, 0.09), (0.16, 0.14), (0.15, 0.85), (0.24, 0.88), (0.24, 0.98), (0.0, 0.98)], at=GM, axis='y', seg=14)
for a in range(0, 360, 60):
    x, z = 0.32 * math.cos(a * D2R), 0.32 * math.sin(a * D2R)
    m.hexbolt('armor', (GM[0] + x, YD + 0.05, GM[2] + z), (0, 1, 0), r=0.03, h=0.03)
    m.beam('armor', (GM[0] + x, YD + 0.06, GM[2] + z), (GM[0] + 0.15 * math.cos(a * D2R), YD + 0.6, GM[2] + 0.15 * math.sin(a * D2R)), 0.05, 0.04, bevel=0)
m.revolve('metal_dark', [(0.26, 0.98), (0.26, 1.04), (0.18, 1.04), (0.18, 0.98)], at=GM, axis='y', seg=12)
m.box('metal_dark', (0.14, 0.24, 0.14), at=(GM[0], YD + 1.1, GM[2]), bevel=0.01, seg=1)
m.sock('gun_mount', (GM[0], YD + 1.2, GM[2]))
m.sock('seat_gunner', (0.45, YD, -0.12))
m.sock('seat_gunner2', (-0.45, YD, -3.05))
# crates, barrels, cans, tarp
for (x, z, ry) in ((0.85, -1.35, 10), (0.85, -2.05, -6)):
    m.box('wood', (0.5, 0.36, 0.62), at=(x, YD + 0.18, z), rot=(0, ry, 0), bevel=0.02, seg=1)
    m.box('metal_dark', (0.52, 0.04, 0.05), at=(x, YD + 0.32, z), rot=(0, ry, 0), bevel=0)
m.box('paint2', (0.5, 0.3, 0.55), at=(0.85, YD + 0.51, -1.7), rot=(0, 5, 0), bevel=0.02, seg=1)
barrel(m, (-0.9, YD + 0.43, -1.4), r=0.27, h=0.86, mat='paint2')
barrel(m, (-0.9, YD + 0.43, -2.0), r=0.27, h=0.86, mat='rust')
jerrycan(m, (-0.88, YD + 0.94 + 0.17, -1.55), rot=(0, 20, 0), mat='paint')
m.box('canvas', (0.9, 0.16, 1.1), at=(-0.5, YD + 0.08, -0.55), rot=(0, 8, 0), bevel=0.06, seg=1)
m.box('wood', (0.6, 0.25, 0.4), at=(0.4, YD + 0.13, -3.05), bevel=0.02, seg=1)
# rear light housings (taillights) + reflectors on the deck corners
for sx in (1, -1):
    light_rect(m, (1.2 * sx, YD - 0.12, -4.1), (0.16, 0.16), 'light_tail', n=(0, 0, -1), depth=0.1)
    light_rect(m, (1.2 * sx, YD - 0.32, -4.1), (0.16, 0.08), 'light_amber', n=(0, 0, -1), depth=0.1)
m.sock('light_tail_L', (1.2, YD - 0.12, -4.12))
m.sock('light_tail_R', (-1.2, YD - 0.12, -4.12))
m.sock('nitro_L', (0.6, 1.0, -4.15))
m.sock('nitro_R', (-0.6, 1.0, -4.15))
# banner pole (rear right) with red rag
m.tube('metal_dark', [(-1.2, YD, -3.9), (-1.2, YD + 1.6, -3.9), (-1.2, YD + 2.3, -3.9)], 0.024, seg=6, r_end=0.012)
m.box('cloth_red', (0.01, 0.5, 0.85), at=(-1.2, YD + 2.0, -4.32), rot=(0, 0, 5), bevel=0, seg=1)
m.box('cloth_red', (0.01, 0.3, 0.5), at=(-1.2, YD + 2.28, -4.15), rot=(0, 0, -7), bevel=0, seg=1)

# ================================================================================ CAB (side skins with door openings)
def cab_outline():
    return [(CAB_R, CFLOOR), (CAB_F, CFLOOR), (CAB_F, 2.1), (2.55, 3.1), (2.5, ROOF), (CAB_R, ROOF)]


door_hole = [(1.5, 1.58), (2.5, 1.58), (2.5, 3.0), (1.5, 3.0)]
for sx in (1, -1):
    m.plate('paint', cab_outline(), 0.06, at=(1.11 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.012, seg=1, holes=[door_hole])
    m.box('metal_dark', (0.07, 0.08, 1.06), at=(1.05 * sx, 1.55, 2.0), bevel=0)
    m.box('interior', (0.05, 1.3, 0.9), at=(1.0 * sx, 2.3, 2.0), bevel=0)
    m.box('armor', (0.22, 0.09, 1.1), at=(1.16 * sx, 1.36, 2.0), bevel=0.012, seg=1)                # cab step
    m.box('armor', (0.22, 0.09, 0.9), at=(1.16 * sx, 0.95, 1.9), bevel=0.012, seg=1)
    # welded seams
    m.weld('armor', (1.15 * sx, 1.42, 1.06), (1.15 * sx, 3.13, 1.06), r=0.012)
# cab rear wall + rear window slit
m.plate('armor', [(-1.14, CFLOOR), (1.14, CFLOOR), (1.14, ROOF), (-1.14, ROOF)], 0.07, at=(0, 0, CAB_R), u=(1, 0, 0), v=(0, 1, 0), bevel=0.012, seg=1,
        holes=[[(-0.5, 2.5), (0.5, 2.5), (0.5, 2.72), (-0.5, 2.72)]])
m.box('glass', (0.98, 0.2, 0.02), at=(0, 2.61, CAB_R + 0.03), bevel=0)
m.rivet_rect('armor', (0, 2.28, CAB_R - 0.04), 2.2, 1.6, (0, 0, -1), u=(-1, 0, 0), v=(0, 1, 0), step=0.2, r=0.014, inset=0.06)
# cab roof: paint2 plate + armor hat + visor
m.plate('paint2', [(-1.14, CAB_R), (1.14, CAB_R), (1.14, 2.55), (-1.14, 2.55)], 0.07, at=(0, ROOF + 0.02, 0), u=(1, 0, 0), v=(0, 0, 1), bevel=0.014, seg=2)
m.box('armor', (1.9, 0.05, 1.05), at=(0, ROOF + 0.075, 1.6), bevel=0.012, seg=1)
m.rivet_rect('armor', (0, ROOF + 0.102, 1.6), 1.9, 1.05, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.17, r=0.013, inset=0.05)
m.hull('armor', [(-1.14, ROOF - 0.02, 2.6), (1.14, ROOF - 0.02, 2.6), (-1.14, ROOF + 0.08, 2.5), (1.14, ROOF + 0.08, 2.5),
                 (-1.12, ROOF - 0.3, 2.85), (1.12, ROOF - 0.3, 2.85), (-1.12, ROOF - 0.22, 2.75), (1.12, ROOF - 0.22, 2.75)], bevel=0.02, seg=2)
# windshield + slat visor
WLO, WHI = (2.1, 2.8), (ROOF - 0.05, 2.56)
def ws(f, dx):
    return (dx, WLO[0] + (WHI[0] - WLO[0]) * f, WLO[1] + (WHI[1] - WLO[1]) * f)
m.hull('glass', [ws(0, -1.03), ws(0, 1.03), ws(1, 1.03), ws(1, -1.03)] + [(x, y + 0.012, z + 0.004) for x, y, z in (ws(0, -1.03), ws(0, 1.03), ws(1, 1.03), ws(1, -1.03))], bevel=0, seg=1)
for sx in (1, -1):
    a, b = ws(0, 1.07 * sx), ws(1, 1.07 * sx)
    m.beam('paint', (a[0], a[1], a[2]), (b[0], b[1], b[2]), 0.13, 0.1, up=(0, 1, 0), bevel=0.012, seg=1)
m.box('metal_dark', (2.0, 0.09, 0.1), at=(0, 2.13, 2.8), bevel=0)
for f in (0.28, 0.55, 0.8):
    a, b = ws(f, -1.05), ws(f, 1.05)
    m.beam('armor', (a[0], a[1] + 0.03, a[2] + 0.03), (b[0], b[1] + 0.03, b[2] + 0.03), 0.07, 0.03, up=(0, 1, 0), bevel=0.006, seg=1)
for x in (-0.68, -0.34, 0.0, 0.34, 0.68):
    a, b = ws(0.05, x), ws(0.95, x)
    m.beam('metal_dark', (a[0], a[1] + 0.04, a[2] + 0.04), (b[0], b[1] + 0.04, b[2] + 0.04), 0.024, 0.024, bevel=0)
# firewall + cowl
m.box('metal_dark', (2.0, 0.75, 0.06), at=(0, 1.78, CAB_F - 0.03), bevel=0)
m.box('paint2', (2.24, 0.06, 0.16), at=(0, 2.12, CAB_F - 0.02), bevel=0.01, seg=1)
# ================================================================================ CAB INTERIOR
m.box('interior', (2.1, 0.08, 1.7), at=(0, CFLOOR + 0.06, 1.9), bevel=0)
bucket_seat(m, (0.45, 1.92, 1.68), w=0.52)
bucket_seat(m, (-0.45, 1.92, 1.68), w=0.52)
m.hull('interior', [(-1.0, 1.85, 2.78), (1.0, 1.85, 2.78), (-1.0, 2.18, 2.74), (1.0, 2.18, 2.74), (-1.0, 2.12, 2.3), (1.0, 2.12, 2.3), (-1.0, 1.6, 2.3), (1.0, 1.6, 2.3)], bevel=0.03, seg=2)
m.box('interior', (0.5, 0.22, 0.24), at=(0.45, 2.3, 2.34), bevel=0.02, seg=1)
for gx in (0.32, 0.55):
    m.revolve('light_amber', [(0, 0.012), (0.04, 0.008), (0.04, 0.0), (0, 0.0)], at=(gx, 2.29, 2.21), axis='-z', seg=10)
steering_wheel(m, (0.45, 2.42, 2.28), tilt=38, r=0.23)
m.box('metal_dark', (0.05, 0.4, 0.05), at=(0.05, 1.75, 2.15), rot=(20, 0, 0), bevel=0)
m.box('interior', (0.5, 0.28, 0.5), at=(0, 1.7, 1.75), bevel=0.02, seg=1)
m.sock('seat_driver', (0.45, 1.92, 1.68))
m.sock('camera_hood', (0, 2.35, 3.2))
m.sock('roof_top', (0, ROOF + 0.12, 1.6))
# roof furniture: rack, spare tyre, spotlights, whip antenna
for sx in (1, -1):
    m.tube('metal_dark', [(1.02 * sx, ROOF + 0.1, 2.35), (1.02 * sx, ROOF + 0.32, 2.35), (1.02 * sx, ROOF + 0.32, 1.15), (1.02 * sx, ROOF + 0.1, 1.15)], 0.02, seg=6, bend=0.05)
m.tube('metal_dark', [(-1.02, ROOF + 0.32, 2.35), (1.02, ROOF + 0.32, 2.35)], 0.018, seg=6)
m.tube('metal_dark', [(-1.02, ROOF + 0.32, 1.15), (1.02, ROOF + 0.32, 1.15)], 0.018, seg=6)
m.revolve('rubber_tire', [(0.26, -0.15), (0.6, -0.15), (0.66, -0.09), (0.66, 0.09), (0.6, 0.15), (0.26, 0.15)], at=(-0.25, ROOF + 0.43, 1.8), axis='y', seg=24)
m.revolve('rim', [(0, 0.1), (0.3, 0.1), (0.3, 0.16), (0, 0.16)], at=(-0.25, ROOF + 0.43, 1.8), axis='y', seg=14)
for x in (-0.6, -0.3, 0.3, 0.6):
    spotlight(m, (x, ROOF + 0.24, 2.6), n=(0, -0.04, 1), r=0.1)
m.box('metal_dark', (2.0, 0.05, 0.1), at=(0, ROOF + 0.17, 2.52), bevel=0)
m.tube('metal_dark', [(1.1, ROOF + 0.1, 1.2), (1.14, ROOF + 0.9, 1.15), (1.13, ROOF + 1.6, 1.1)], 0.011, seg=5, r_end=0.004)
m.box('cloth_red', (0.01, 0.14, 0.34), at=(1.13, ROOF + 1.5, 0.92), rot=(0, 0, 6), bevel=0, seg=1)

# ================================================================================ ENGINE BAY (under the hood)
m.hull('metal_dark', [(-0.42, 1.5, 2.95), (0.42, 1.5, 2.95), (-0.42, 1.95, 3.0), (0.42, 1.95, 3.0), (-0.42, 1.5, 3.6), (0.42, 1.5, 3.6), (-0.42, 1.9, 3.55), (0.42, 1.9, 3.55)], bevel=0)
for sx in (1, -1):
    m.box('metal_bare', (0.2, 0.12, 0.62), at=(0.24 * sx, 2.0, 3.28), bevel=0)
    m.tube('metal_bare', [(0.4 * sx, 1.9, 3.1), (0.6 * sx, 1.9, 3.0), (0.68 * sx, 1.75, 3.1)], 0.045, seg=6, bend=0.08)
m.box('metal_bare', (0.3, 0.12, 0.4), at=(0, 2.04, 3.3), bevel=0)
m.revolve('metal_dark', [(0, 0), (0.1, 0.02), (0.1, 0.32), (0, 0.34)], at=(0.0, 2.0, 3.0), axis='y', seg=8)
m.box('metal_dark', (1.5, 0.6, 0.1), at=(0, 1.78, 3.68), bevel=0)                                     # radiator
for i in range(8):
    m.box('metal_bare', (1.44, 0.014, 0.03), at=(0, 1.52 + i * 0.07, 3.72), bevel=0)
m.cyl('metal_dark', (0, 1.78, 3.4), (0, 1.78, 3.62), 0.26, seg=10)
for a in range(0, 360, 60):
    m.box('metal_bare', (0.04, 0.22, 0.008), at=(0.14 * math.cos(a * D2R), 1.78 + 0.14 * math.sin(a * D2R), 3.395), rot=(0, 0, a - 90), bevel=0)
m.box('interior', (0.26, 0.24, 0.2), at=(0.68, 1.6, 3.0), bevel=0)
m.sock('smoke_engine', (0, 2.0, 3.3))

# ================================================================================ LIGHTS
for sx in (1, -1):
    headlight(m, (1.0 * sx, 1.72, 3.8), 0.14, n=(0, 0, 1), obj='body')
    for a in (0, 60, 120):
        m.beam('armor', (1.0 * sx + 0.17 * math.cos(a * D2R), 1.72 + 0.17 * math.sin(a * D2R), 3.86), (1.0 * sx - 0.17 * math.cos(a * D2R), 1.72 - 0.17 * math.sin(a * D2R), 3.86), 0.018, 0.018, bevel=0)
    light_rect(m, (1.12 * sx, 1.98, 3.75), (0.12, 0.08), 'light_amber', n=(0, 0, 1))
    headlight(m, (0.55 * sx, 1.55, 3.86), 0.08, n=(0, 0, 1), obj='body')
m.sock('light_head_L', (1.0, 1.72, 3.86))
m.sock('light_head_R', (-1.0, 1.72, 3.86))
m.sock('fuel_cap', (1.05, 1.36, 0.05))

# ================================================================================ PANELS
# hood
m.panel('panel_hood', (0, 2.1, 2.8), metal_dark='paint', chrome='paint', metal_bare='paint', armor='paint')
m.hull('paint', [(-0.86, 2.02, 2.82), (0.86, 2.02, 2.82), (-0.86, 2.2, 2.82), (0.86, 2.2, 2.82), (-0.86, 2.02, 3.74), (0.86, 2.02, 3.74), (-0.86, 1.95, 3.75), (0.86, 1.95, 3.75)], bevel=0.02, seg=2, obj='panel_hood')
m.hull('armor', [(-0.6, 2.16, 2.95), (0.6, 2.16, 2.95), (-0.5, 2.36, 3.05), (0.5, 2.36, 3.05), (-0.5, 2.34, 3.5), (0.5, 2.34, 3.5), (-0.6, 2.06, 3.62), (0.6, 2.06, 3.62)], bevel=0.02, seg=2, obj='panel_hood')
for i in range(6):
    m.box('metal_dark', (0.6, 0.012, 0.03), at=(0, 2.352, 3.08 + i * 0.08), bevel=0, obj='panel_hood')
m.rivet_rect('armor', (0, 2.205, 3.3), 1.68, 0.9, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.16, r=0.013, inset=0.05, obj='panel_hood')
for sx in (1, -1):
    m.cyl('metal_dark', (0.3 * sx, 2.16, 2.82), (0.55 * sx, 2.16, 2.82), 0.03, seg=8, obj='panel_hood')
    m.box('metal_dark', (0.07, 0.06, 0.28), at=(0.5 * sx, 2.0, 3.72), bevel=0, obj='panel_hood')
m.use('body')
# doors
for sx, nm in ((1, 'panel_door_L'), (-1, 'panel_door_R')):
    m.panel(nm, (1.14 * sx, 2.3, 2.5), **AL)
    outer = [(1.52, 1.6), (2.48, 1.6), (2.48, 2.98), (1.52, 2.98)]
    win = [(1.72, 2.42), (2.32, 2.42), (2.32, 2.86), (1.72, 2.86)]
    m.plate('paint', outer, 0.07, at=(1.15 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.014, seg=1, holes=[win], obj=nm)
    m.box('glass', (0.02, 0.44, 0.6), at=(1.15 * sx, 2.64, 2.02), bevel=0, obj=nm)
    m.box('armor', (0.04, 0.84, 0.92), at=(1.2 * sx, 1.98, 2.0), bevel=0.012, seg=1, obj=nm)
    m.rivet_rect('armor', (1.222 * sx, 1.98, 2.0), 0.92, 0.84, (sx, 0, 0), u=(0, 0, -1), v=(0, 1, 0), step=0.14, r=0.012, obj=nm)
    for zz in (1.86, 2.02, 2.18):
        m.box('metal_dark', (0.03, 0.5, 0.03), at=(1.2 * sx, 2.64, zz), bevel=0, obj=nm)
    m.box('armor', (0.12, 0.05, 0.75), at=(1.22 * sx, 2.9, 2.02), rot=(0, 0, -12 * sx), bevel=0.008, seg=1, obj=nm)      # visor over window
    m.box('armor', (0.05, 0.05, 0.7), at=(1.2 * sx, 2.4, 2.02), bevel=0.008, seg=1, obj=nm)
    m.box('chrome', (0.06, 0.03, 0.18), at=(1.22 * sx, 2.25, 1.62), bevel=0.008, seg=1, obj=nm)
    for y in (1.9, 2.7):
        m.cyl('metal_dark', (1.13 * sx, y, 2.5), (1.13 * sx, y + 0.12, 2.5), 0.03, seg=8, obj=nm)
    m.tube('metal_dark', [(1.2 * sx, 2.6, 2.46), (1.42 * sx, 2.75, 2.5)], 0.017, seg=6, obj=nm)
    m.box('metal_dark', (0.05, 0.32, 0.2), at=(1.44 * sx, 2.78, 2.52), bevel=0.015, seg=1, obj=nm)
    m.use('body')
# front fenders (arch + top + nose) -- paint
def arch(zc, r, cy, y0, n=10):
    t0 = math.asin(max(min((y0 - cy) / r, 1), -1))
    return [(zc + r * math.cos(PI - t0 - (PI - 2 * t0) * i / n), cy + r * math.sin(PI - t0 - (PI - 2 * t0) * i / n)) for i in range(n + 1)]
for sx, nm in ((1, 'panel_fender_L'), (-1, 'panel_fender_R')):
    m.panel(nm, (1.05 * sx, 1.6, ZF), metal_dark='paint', chrome='paint', metal_bare='paint', armor='paint')
    ol = [(2.2, 1.05)]
    ol += arch(ZF, 0.78, HUBY, 1.05)
    ol += [(3.6, 1.05), (3.82, 1.05), (3.86, 1.5), (3.82, 1.92), (2.2, 1.92)]
    m.plate('paint', ol, 0.06, at=(1.235 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.012, seg=1, obj=nm)
    m.hull('paint', [(0.84 * sx, 1.94, 2.25), (1.27 * sx, 1.94, 2.25), (0.84 * sx, 1.94, 3.85), (1.27 * sx, 1.94, 3.85), (0.84 * sx, 1.86, 2.25), (1.27 * sx, 1.86, 2.25), (0.84 * sx, 1.9, 3.85), (1.27 * sx, 1.9, 3.85)], bevel=0.02, seg=2, obj=nm)
    m.rivet_line('armor', (1.27 * sx, 1.945, 2.4), (1.27 * sx, 1.945, 3.8), (0, 1, 0), step=0.16, r=0.013, obj=nm)
    # flare lip around arch
    po = [(ZF + 0.86 * math.cos(t * D2R), HUBY + 0.86 * math.sin(t * D2R)) for t in range(22, 159, 14)]
    pi_ = [(ZF + 0.76 * math.cos(t * D2R), HUBY + 0.76 * math.sin(t * D2R)) for t in range(158, 21, -14)]
    m.plate('armor', po + pi_, 0.09, at=(1.27 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.008, seg=1, obj=nm)
    for (zz, yy) in po[1:-1]:
        m.rivet('armor', (1.32 * sx, yy - 0.04, zz), (sx, 0, 0), r=0.013, obj=nm)
    m.use('body')
# plow bumper
m.panel('panel_bumper_F', (0, 1.0, 3.95), **AL)
NZ = 3.78
m.hull('armor', [(-1.32, 0.5, 4.14), (1.32, 0.5, 4.14), (-1.32, 1.42, 3.9), (1.32, 1.42, 3.9), (-1.16, 0.5, NZ), (1.16, 0.5, NZ), (-1.16, 1.42, NZ), (1.16, 1.42, NZ)], bevel=0.025, seg=2, obj='panel_bumper_F')   # blade
for sx in (1, -1):
    m.hull('armor', [(1.32 * sx, 0.5, 4.14), (1.32 * sx, 1.42, 3.9), (1.5 * sx, 0.55, 3.72), (1.5 * sx, 1.35, 3.62), (1.16 * sx, 0.5, NZ), (1.16 * sx, 1.42, NZ)], bevel=0.02, seg=2, obj='panel_bumper_F')  # wing
    m.spike('armor', (1.45 * sx, 1.36, 3.68), (1.62 * sx, 1.38, 3.96), 0.05, seg=6, obj='panel_bumper_F')
    m.spike('armor', (1.4 * sx, 0.7, 3.75), (1.6 * sx, 0.7, 3.98), 0.05, seg=6, obj='panel_bumper_F')
m.box('metal_dark', (2.5, 0.09, 0.09), at=(0, 1.44, 3.94), bevel=0, obj='panel_bumper_F')
for i in range(9):
    x = -1.2 + i * 0.3
    m.spike('armor', (x, 1.46, 3.92), (x * 1.04, 1.86 if i % 2 == 0 else 1.7, 4.1), 0.05, seg=6, obj='panel_bumper_F')
m.hull('armor', [(-1.34, 0.44, 4.16), (1.34, 0.44, 4.16), (-1.34, 0.6, 4.16), (1.34, 0.6, 4.16), (-1.3, 0.42, 3.98), (1.3, 0.42, 3.98), (-1.3, 0.56, 3.98), (1.3, 0.56, 3.98)], bevel=0.015, seg=1, obj='panel_bumper_F')   # cutting edge
for x in (-0.9, -0.3, 0.3, 0.9):
    m.rivet_rect('armor', (x, 0.96, 4.02), 0.5, 0.7, (0, 0.3, 1), u=(1, 0, 0), v=(0, 1, -0.26), step=0.13, r=0.013, inset=0.04, obj='panel_bumper_F')
m.weld('armor', (-1.3, 0.96, 4.02), (1.3, 0.96, 4.02), r=0.014, obj='panel_bumper_F')
m.tube('armor', [(-0.4, 1.48, 3.86), (-0.55, 1.15, 4.22), (0.55, 1.15, 4.22), (0.4, 1.48, 3.86)], 0.03, seg=6, bend=0.1, obj='panel_bumper_F')   # tow loop
m.use('body')
# armor plates on the bed sides (three per side)
zs = [(0.85, -0.66), (-0.66, -2.21), (-2.21, -3.96)]
for sx, nm in ((1, 'panel_armor_L'), (-1, 'panel_armor_R')):
    m.panel(nm, (1.24 * sx, YD + 0.3, -1.55), paint2='armor', **AL)
    x = 1.245 * sx
    for i, (za, zb) in enumerate(zs):
        z0, z1 = zb + 0.03, za - 0.03
        mt = ('armor', 'paint2', 'armor')[i]
        pts = [(z0, YD + 0.02), (z1, YD + 0.02), (z1, YD + 0.5), (z1 - 0.15, YD + 0.56), (z0 + 0.15, YD + 0.56), (z0, YD + 0.5)]
        m.plate(mt, pts, 0.045, at=(x, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.012, seg=1, obj=nm)
        m.rivet_rect('armor', (x + 0.024 * sx, YD + 0.29, (z0 + z1) / 2), z1 - z0, 0.5, (sx, 0, 0), u=(0, 0, -1), v=(0, 1, 0), step=0.17, r=0.013, inset=0.05, obj=nm)
        m.beam('armor', (x + 0.03 * sx, YD + 0.04, (z0 + z1) / 2), (x + 0.03 * sx, YD + 0.54, (z0 + z1) / 2), 0.09, 0.03, up=(sx, 0, 0), bevel=0.006, seg=1, obj=nm)
        m.beam('armor', (x + 0.03 * sx, YD + 0.06, z0 + 0.1), (x + 0.03 * sx, YD + 0.5, z1 - 0.1), 0.07, 0.025, up=(sx, 0, 0), bevel=0.005, seg=1, obj=nm)
    m.weld('armor', (x + 0.04 * sx, YD + 0.05, -0.66), (x + 0.04 * sx, YD + 0.52, -0.66), r=0.011, obj=nm)
    m.weld('armor', (x + 0.04 * sx, YD + 0.05, -2.21), (x + 0.04 * sx, YD + 0.52, -2.21), r=0.011, obj=nm)
    m.box('armor', (0.07, 0.05, 4.9), at=(x + 0.02 * sx, YD + 0.56, -1.55), bevel=0.008, seg=1, obj=nm)
    m.use('body')
# tailgate
m.panel('panel_tailgate', (0, YD + 0.1, -4.0), paint2='armor', **AL)
m.box('armor', (2.4, 0.55, 0.06), at=(0, YD + 0.32, -4.0), bevel=0.014, seg=1, obj='panel_tailgate')
m.rivet_rect('armor', (0, YD + 0.32, -4.033), 2.4, 0.55, (0, 0, -1), u=(1, 0, 0), v=(0, 1, 0), step=0.16, r=0.013, inset=0.05, obj='panel_tailgate')
for x in (-0.8, 0.0, 0.8):
    m.beam('armor', (x, YD + 0.06, -4.04), (x, YD + 0.58, -4.04), 0.09, 0.03, bevel=0.006, seg=1, obj='panel_tailgate')
m.box('paint2', (0.9, 0.34, 0.02), at=(0.6, YD + 0.32, -4.055), bevel=0, obj='panel_tailgate')
m.hexbolt('armor', (-0.9, YD + 0.32, -4.06), (0, 0, -1), r=0.05, h=0.04, obj='panel_tailgate')
m.use('body')
# rear bumper
m.panel('panel_bumper_R', (0, 0.9, -4.08), **AL)
m.hull('armor', [(-1.24, 0.72, -4.02), (1.24, 0.72, -4.02), (-1.24, 1.2, -4.02), (1.24, 1.2, -4.02), (-1.2, 0.72, -4.2), (1.2, 0.72, -4.2), (-1.2, 1.2, -4.14), (1.2, 1.2, -4.14)], bevel=0.02, seg=2, obj='panel_bumper_R')
m.rivet_rect('armor', (0, 0.96, -4.2), 2.3, 0.4, (0, 0, -1), u=(1, 0, 0), v=(0, 1, 0), step=0.16, r=0.013, inset=0.05, obj='panel_bumper_R')
for sx in (1, -1):
    m.spike('armor', (1.2 * sx, 0.95, -4.16), (1.35 * sx, 0.95, -4.42), 0.05, seg=6, obj='panel_bumper_R')
    m.tube('armor', [(0.5 * sx, 0.8, -4.12), (0.5 * sx, 0.76, -4.4), (0.35 * sx, 0.78, -4.4)], 0.028, seg=6, bend=0.05, obj='panel_bumper_R')
m.use('body')

# tandem wheel arch lips + mud flaps (body)
for sx in (1, -1):
    for zc in (ZM, ZR):
        po = [(zc + 0.84 * math.cos(t * D2R), HUBY + 0.84 * math.sin(t * D2R)) for t in range(30, 151, 15)]
        pi_ = [(zc + 0.74 * math.cos(t * D2R), HUBY + 0.74 * math.sin(t * D2R)) for t in range(150, 29, -15)]
        m.plate('armor', po + pi_, 0.07, at=(1.27 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.008, seg=1)
        for (zz, yy) in po[1:-1]:
            m.rivet('armor', (1.31 * sx, yy - 0.04, zz), (sx, 0, 0), r=0.013)
        m.box('metal_dark', (0.03, 0.46, 0.5), at=(1.2 * sx, 0.97, zc - 0.78), bevel=0.006, seg=1)
m.finish()

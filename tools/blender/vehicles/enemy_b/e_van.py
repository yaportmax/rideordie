"""e_van "Boxer" (v2): armored cargo van with a roof-hatch gunner nest.  ~5.6 m x 2.1 m x 2.4 m (3.3 m with the gunner standing in the hatch).
Run: bash tools/blender/vehicles/enemy_b/run.sh e_van.py      (VEH_OUT=shots/enemy_b/test for a test build, BAKE_QUICK=1 for a fast bake)
Game space: +X left, +Y up, +Z forward.  Driver on +X.  Unique wear atlases are baked (vbake) -> no vertex colours."""
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts2 import *  # noqa

m = Model('e_van', seed=11, bake=True)
HUBY = 0.43
ZF, ZR = 1.65, -1.55          # axle positions
m.bake_opts = dict(dirt_h=0.95, dens=205.0, wheels=[(0.85, HUBY, ZF, 0.43), (0.85, HUBY, ZR, 0.43)], rust=1.0, wear=1.0)
# small materials are folded into bigger ones (fewer draw calls); the bake keeps each part's own look (chrome, rust, rubber, decals ...)
m.alias.update({'metal_bare': 'armor', 'plastic': 'interior', 'fabric': 'interior', 'leather': 'interior', 'spike': 'armor', 'brass': 'metal_dark',
                'chrome': 'metal_dark', 'rust': 'armor', 'decal_white': 'decal_yellow', 'decal_red': 'decal_yellow', 'cloth_red': 'canvas', 'wood': 'canvas',
                'rim': 'metal_dark'})
m.objs['body'].alias = {'rubber_tire': 'metal_dark', 'decal_yellow': 'armor'}
PAN = dict(metal_dark='armor', interior='armor', decal_yellow='armor', rubber_tire='armor', canvas='armor')
PI = math.pi
ROOF = 2.40
RT = ROOF + 0.03              # roof top surface

# ================================================================================ WHEELS (shared meshes, hub-centred)
m.section('wheels')
wheel_set2(m, 'van', 0.43, 0.30, [(0.85, HUBY, ZF), (-0.85, HUBY, ZF), (0.85, HUBY, ZR), (-0.85, HUBY, ZR)],
           ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'], lugs=15, tread_h=0.026, style='mt', holes=6, nuts=6, seg=24, rim_ratio=0.6)

# ================================================================================ CHASSIS / UNDERSIDE  (body)
m.use('body')
m.section('chassis')
with m.tag('under'):
    for sx in (1, -1):
        m.box('metal_dark', (0.10, 0.16, 5.5), at=(0.52 * sx, 0.36, -0.05), bevel=0.006, seg=1)                # ladder frame rails
    for z in (-2.5, -1.9, -0.9, 0.2, 0.9, 2.4):
        m.box('metal_dark', (1.16, 0.09, 0.10), at=(0, 0.37, z), bevel=0.005, seg=1)                           # cross members
    for zc in (ZF, ZR):
        m.cyl('metal_dark', (-0.72, HUBY, zc), (0.72, HUBY, zc), 0.055, seg=8)
        m.revolve('metal_dark', [(0, -0.2), (0.17, -0.17), (0.2, -0.05), (0.2, 0.05), (0.17, 0.17), (0, 0.2)], at=(0, HUBY, zc), axis='z', seg=8)
        m.cyl('metal_dark', (-0.2, HUBY, zc + 0.19), (0.2, HUBY, zc + 0.19), 0.06, seg=10)
        for sx in (1, -1):
            m.box('metal_dark', (0.09, 0.03, 0.9), at=(0.62 * sx, HUBY + 0.13, zc), bevel=0.004, seg=1)       # leaf springs
            m.box('metal_dark', (0.09, 0.02, 0.7), at=(0.62 * sx, HUBY + 0.16, zc), bevel=0.003, seg=1)
            m.box('metal_dark', (0.14, 0.05, 0.08), at=(0.62 * sx, HUBY + 0.11, zc), bevel=0.004, seg=1)       # U-bolt plate
            m.cyl('metal_dark', (0.72 * sx, HUBY - 0.02, zc + 0.15), (0.70 * sx, 0.3, zc + 0.16), 0.03, seg=6)  # shocks
            m.cyl('chrome', (0.70 * sx, 0.3, zc + 0.16), (0.66 * sx, 0.58, zc + 0.18), 0.018, seg=6)
    m.cyl('metal_dark', (0, 0.41, 1.0), (0, 0.41, -1.35), 0.04, seg=8)                                        # driveshaft
    m.box('metal_dark', (0.38, 0.32, 0.7), at=(0, 0.5, 1.05), bevel=0.01, seg=1)                             # gearbox
    m.box('metal_dark', (0.5, 0.26, 1.0), at=(0.66, 0.34, -0.55), bevel=0.02, seg=1)                          # fuel tank
    for z in (-0.25, -0.85):
        m.box('armor', (0.54, 0.03, 0.05), at=(0.66, 0.2, z), bevel=0.004, seg=1)
    m.tube('metal_dark', [(-0.3, 0.75, 2.05), (-0.42, 0.55, 1.6), (-0.5, 0.36, 1.2), (-0.5, 0.33, -1.9), (-0.45, 0.33, -2.25)], 0.045, seg=7, bend=0.2)
    m.revolve('metal_dark', [(0, -0.5), (0.11, -0.46), (0.13, -0.3), (0.13, 0.3), (0.11, 0.46), (0, 0.5)], at=(-0.5, 0.31, -1.55), axis='z', seg=8, sx=1.1, sy=0.8)
    m.tube('metal_dark', [(-0.45, 0.33, -2.25), (0.0, 0.3, -2.3), (0.45, 0.33, -2.2)], 0.045, seg=7, bend=0.1)
m.tube('chrome', [(0.45, 0.33, -2.2), (0.45, 0.33, -2.68), (0.45, 0.4, -2.88)], 0.05, seg=10, bend=0.1, r_end=0.056)     # tailpipe (exhaust_L)
for sx in (1, -1):                                                                                             # front recovery hooks
    m.tube('armor', [(0.4 * sx, 0.42, 2.6), (0.4 * sx, 0.42, 2.92), (0.4 * sx, 0.3, 2.95), (0.4 * sx, 0.3, 2.85)], 0.025, seg=6, bend=0.05, bsteps=2)

# ================================================================================ FLOOR / CARGO / CAB INTERIOR
m.section('interior')
with m.tag('inner'):
    m.box('interior', (1.9, 0.05, 4.4), at=(0, 0.52, -0.4), bevel=0)
    m.box('interior', (1.9, 0.05, 1.0), at=(0, 0.52, 2.1), bevel=0)
    m.box('armor', (1.85, 0.03, 3.0), at=(0, 0.555, -1.25), bevel=0)                                           # tread-plate cargo floor
    for i in range(9):
        m.box('armor', (1.85, 0.012, 0.03), at=(0, 0.575, -2.6 + i * 0.36), bevel=0)
    for sx in (1, -1):
        m.box('metal_dark', (0.04, 1.75, 2.8), at=(0.9 * sx, 1.4, -1.35), bevel=0)                              # inner skins + ribs
        for i in range(6):
            m.box('metal_dark', (0.06, 1.75, 0.06), at=(0.87 * sx, 1.4, -2.6 + i * 0.5), bevel=0, seg=1)
    for i in range(6):
        m.box('metal_dark', (1.8, 0.06, 0.06), at=(0, 2.33, -2.6 + i * 0.44), bevel=0, seg=1)             # roof ribs
    m.box('metal_dark', (1.8, 0.03, 3.9), at=(0, 2.35, -0.85), bevel=0)
    m.box('metal_dark', (1.86, 1.75, 0.06), at=(0, 1.4, -0.1), bevel=0.006, seg=1)                              # partition wall
    # gunner platform: stacked crates (his feet at y = 1.5)
    crate(m, (0, 0.555, -0.95), (0.95, 0.47, 0.95), yaw=0, mat='wood', slats=False)
    crate(m, (0, 1.025, -0.95), (0.92, 0.45, 0.92), yaw=4, mat='wood')
    m.box('armor', (0.96, 0.03, 0.96), at=(0, 1.49, -0.95), bevel=0.006, seg=1)                                # steel deck plate on top
    m.box('paint2', (0.3, 0.2, 0.6), at=(0.62, 0.67, -2.2), rot=(0, 6, 0), bevel=0.01, seg=1)
    crate(m, (-0.6, 0.57, -2.1), (0.55, 0.32, 0.7), yaw=-6, slats=False)
    for sx in (1, -1):
        m.box('leather', (0.42, 0.08, 1.2), at=(0.66 * sx, 0.95, -1.75), bevel=0.02, seg=1)                  # benches
        m.box('metal_dark', (0.04, 0.4, 1.1), at=(0.66 * sx, 0.73, -1.75), bevel=0.004, seg=1)
mesh_screen(m, (0.45, 1.75, -0.06), (1, 0, 0), (0, 1, 0), 0.5, 0.4, pitch=0.07, r=0.005, obj='body')          # partition window mesh
# cab
bucket_seat2(m, (0.42, 0.98, 0.42), w=0.5, cover='leather')
bucket_seat2(m, (-0.42, 0.98, 0.42), w=0.5, cover='leather', torn=False)
m.box('interior', (0.16, 0.3, 0.9), at=(0, 0.7, 0.62), bevel=0.02, seg=1)                                      # tunnel/console
m.cyl('metal_dark', (0.0, 0.84, 0.95), (0.03, 1.1, 0.88), 0.012, seg=6)                                       # gear lever
m.revolve('metal_dark', [(0, -0.03), (0.03, -0.02), (0.032, 0.01), (0, 0.035)], at=(0.03, 1.12, 0.875), axis='y', seg=8)
m.hull('interior', [(-0.94, 1.02, 1.62), (0.94, 1.02, 1.62), (-0.94, 1.3, 1.58), (0.94, 1.3, 1.58), (-0.94, 1.26, 1.05), (0.94, 1.26, 1.05),
                    (-0.94, 0.92, 1.02), (0.94, 0.92, 1.02)], bevel=0.03, seg=2)                              # dash
m.box('interior', (0.52, 0.16, 0.2), at=(0.42, 1.32, 1.04), bevel=0.03, seg=1)                                 # instrument hood
gauge_cluster(m, (0.42, 1.285, 0.935), n=(0, 0.2, -1), w=0.36, count=3)
m.box('metal_dark', (0.24, 0.07, 0.16), at=(-0.3, 1.2, 1.0), bevel=0.01, seg=1)                                # CB radio
m.tube('metal_dark', [(-0.3, 1.2, 0.93), (-0.38, 1.05, 0.95), (-0.45, 1.1, 1.0)], 0.005, seg=4)
m.box('decal_red', (0.06, 0.06, 0.06), at=(-0.6, 1.33, 1.1), rot=(10, 30, 0), bevel=0.012, seg=1)             # fuzzy dice
steering_wheel2(m, (0.42, 1.31, 0.86), tilt=24, r=0.19, mat='leather')
m.box('metal_dark', (0.05, 0.05, 0.5), at=(0, 2.3, 0.5), bevel=0.005, seg=1)                                  # grab bar
m.sock('seat_driver', (0.42, 0.98, 0.42))
m.sock('seat_gunner', (0.0, 1.5, -0.95))

# ================================================================================ ENGINE BAY (under panel_hood)
m.section('engine')
m.hull('metal_dark', [(-0.34, 0.6, 1.8), (0.34, 0.6, 1.8), (-0.34, 1.0, 1.85), (0.34, 1.0, 1.85), (-0.34, 0.6, 2.5), (0.34, 0.6, 2.5), (-0.34, 0.95, 2.45), (0.34, 0.95, 2.45)], bevel=0.01, seg=1)
for sx in (1, -1):
    m.box('armor', (0.14, 0.09, 0.62), at=(0.2 * sx, 1.06, 2.14), bevel=0.01, seg=1)                          # valve covers
    for i in range(4):
        m.hexbolt('metal_dark', (0.2 * sx, 1.105, 1.95 + i * 0.14), (0, 1, 0), r=0.014, h=0.012)
        m.tube('metal_dark', [(0.26 * sx, 0.95, 1.92 + i * 0.14), (0.4 * sx, 0.9, 1.92 + i * 0.14), (0.44 * sx, 0.72, 2.0)], 0.02, seg=4)   # headers
m.box('armor', (0.3, 0.09, 0.4), at=(0, 1.06, 2.14), bevel=0.01, seg=1)
m.cyl('metal_dark', (0.0, 1.14, 2.0), (0, 1.14, 2.32), 0.1, seg=10)                                            # air cleaner
m.hull('metal_dark', [(-0.72, 0.58, 2.62), (0.72, 0.58, 2.62), (-0.72, 1.06, 2.62), (0.72, 1.06, 2.62), (-0.72, 0.58, 2.68), (0.72, 0.58, 2.68), (-0.72, 1.06, 2.68), (0.72, 1.06, 2.68)], bevel=0.008, seg=1)
for i in range(8):
    m.box('armor', (1.36, 0.012, 0.03), at=(0, 0.62 + i * 0.055, 2.695), bevel=0)
m.cyl('metal_dark', (0, 0.83, 2.35), (0, 0.83, 2.6), 0.2, seg=12)                                               # fan shroud
m.box('interior', (0.22, 0.2, 0.16), at=(0.62, 0.78, 2.15), bevel=0.01, seg=1)                                 # battery
m.tube('rubber_tire', [(0.3, 0.9, 2.35), (0.6, 1.0, 2.5), (0.7, 0.9, 2.6)], 0.028, seg=6, bend=0.1)
m.tube('rubber_tire', [(-0.3, 0.9, 2.35), (-0.6, 1.0, 2.5), (-0.7, 0.9, 2.6)], 0.028, seg=6, bend=0.1)
m.sock('smoke_engine', (0, 1.05, 2.2))
m.sock('camera_hood', (0, 1.42, 2.3))


# ================================================================================ BODY SHELL
m.section('shell')
def arch(zc, r=0.58, n=10):
    t0 = math.asin(0.07 / r)
    return [(zc + r * math.cos(PI - t0 - (PI - 2 * t0) * i / n), HUBY + r * math.sin(PI - t0 - (PI - 2 * t0) * i / n)) for i in range(n + 1)]


outline = [(-2.8, 0.5), (-2.15, 0.5)] + arch(ZR) + [(-0.98, 0.5), (1.08, 0.5)] + arch(ZF) + \
          [(2.22, 0.5), (2.8, 0.5), (2.8, 1.02), (2.74, 1.12), (1.7, 1.12), (0.95, ROOF), (-2.8, ROOF)]
door_hole = [(0.04, 0.66), (1.0, 0.66), (1.0, 2.12), (0.04, 2.12)]
slits = [[(-2.3, 1.78), (-1.72, 1.78), (-1.72, 1.94), (-2.3, 1.94)], [(-1.2, 1.78), (-0.62, 1.78), (-0.62, 1.94), (-1.2, 1.94)]]
for sx in (1, -1):
    m.plate('paint', outline, 0.05, at=(0.975 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0, seg=1, holes=[door_hole] + slits)
    m.box('metal_dark', (0.06, 0.06, 1.04), at=(0.93 * sx, 0.66, 0.52), bevel=0.006, seg=1)                   # door sill
    m.box('metal_dark', (0.12, 1.5, 0.06), at=(0.93 * sx, 1.38, 0.03), bevel=0.006, seg=1)                   # B-pillar
    m.box('armor', (0.16, 0.05, 1.1), at=(0.99 * sx, 0.55, 0.5), bevel=0.01, seg=1)                           # side step
    for z in (0.1, 0.9):
        m.box('metal_dark', (0.1, 0.12, 0.04), at=(0.96 * sx, 0.5, z), bevel=0.004, seg=1)
    for zc in (-2.01, -0.91):                                                                                   # cargo slit windows
        m.box('glass', (0.02, 0.14, 0.56), at=(0.975 * sx, 1.86, zc), bevel=0, seg=1)
    po = [(ZR + 0.62 * math.cos(t * D2R), HUBY + 0.62 * math.sin(t * D2R)) for t in range(8, 173, 12)]         # rear wheel-house liner
    pi_ = [(ZR + 0.56 * math.cos(t * D2R), HUBY + 0.56 * math.sin(t * D2R)) for t in range(172, 7, -12)]
    with m.tag('inner'):
        m.plate('metal_dark', po + pi_, 0.3, at=(0.86 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0)
    m.box('metal_dark', (0.09, 0.07, 5.4), at=(1.0 * sx, 0.46, 0.0), bevel=0.01, seg=1)                        # rocker rail
    m.box('rubber_tire', (0.02, 0.36, 0.34), at=(1.0 * sx, 0.3, ZR - 0.68), rot=(8, 0, 0), bevel=0.006, seg=1)  # mud flaps
    m.box('rubber_tire', (0.02, 0.3, 0.3), at=(1.0 * sx, 0.28, ZF - 0.7), rot=(6, 0, 0), bevel=0.006, seg=1)
    # rear arch flare (paint2) bolted
    pts = [(ZR + 0.68 * math.cos(t * D2R), HUBY + 0.68 * math.sin(t * D2R)) for t in range(10, 171, 20)]
    pts_in = [(ZR + 0.57 * math.cos(t * D2R), HUBY + 0.57 * math.sin(t * D2R)) for t in range(170, 9, -20)]
    m.plate('paint2', pts + pts_in, 0.05, at=(1.035 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.008, seg=1)
    for (a, b) in pts[1:-1]:
        m.hexbolt('metal_dark', (1.062 * sx, HUBY + (b - HUBY) * 0.92, ZR + (a - ZR) * 0.92), (sx, 0, 0), r=0.013, h=0.01)
    # roof edge rail + drip rail
    m.beam('paint2', (0.99 * sx, ROOF + 0.01, 0.95), (0.99 * sx, ROOF + 0.01, -2.8), 0.07, 0.07, bevel=0.015, seg=1)
    m.beam('metal_dark', (1.0 * sx, ROOF - 0.08, 0.9), (1.0 * sx, ROOF - 0.08, -2.75), 0.025, 0.025, bevel=0.004, seg=1)
    # rear corner posts (armor angle) with the tail lamps
    m.box('armor', (0.1, 1.9, 0.1), at=(0.955 * sx, 1.45, -2.77), bevel=0.012, seg=1)
    m.rivet_line('metal_dark', (1.008 * sx, 0.6, -2.77), (1.008 * sx, 2.3, -2.77), (sx, 0, 0), step=0.17, r=0.011)
    # cab corner armor between door and wheel arch (welded plate) + seam
    patch_plate(m, (0.998 * sx, 0.84, 1.28), (sx, 0, 0), 0.42, 0.5, mat='armor', t=0.012, bolts=4, bead=False)
    m.bead('armor', [(1.0 * sx, 1.46, 1.02), (1.0 * sx, 1.46, 1.66)], r=0.006, n=(sx, 0, 0))

# roof plate with the hatch opening
m.plate('paint2', [(-1.0, -2.8), (1.0, -2.8), (1.0, 0.95), (-1.0, 0.95)], 0.05, at=(0, ROOF + 0.005, 0), u=(1, 0, 0), v=(0, 0, 1), bevel=0.012, seg=2,
        holes=[[(-0.45, -1.4), (0.45, -1.4), (0.45, -0.5), (-0.45, -0.5)]])
for z in (-2.5, -2.05, -1.65, 0.1, 0.55):                                                                      # roof stiffening ribs
    m.box('paint2', (1.86, 0.025, 0.06), at=(0, RT + 0.01, z), bevel=0, seg=1)
patch_plate(m, (0.55, RT, 0.2), (0, 1, 0), 0.5, 0.36, mat='rust', up=(0, 0, 1), t=0.01, bolts=4, bead=False)
# armored roof brow over the windshield
m.hull('armor', [(-1.0, ROOF - 0.05, 0.95), (1.0, ROOF - 0.05, 0.95), (-1.0, ROOF + 0.06, 0.85), (1.0, ROOF + 0.06, 0.85),
                 (-0.98, ROOF - 0.35, 1.28), (0.98, ROOF - 0.35, 1.28), (-0.98, ROOF - 0.22, 1.18), (0.98, ROOF - 0.22, 1.18)], bevel=0.015, seg=2)
m.rivet_line('metal_dark', (-0.9, ROOF + 0.065, 0.87), (0.9, ROOF + 0.065, 0.87), (0, 1, 0), step=0.18, r=0.012)
m.bead('armor', [(-0.98, ROOF + 0.005, 0.95), (0.98, ROOF + 0.005, 0.95)], r=0.007, n=(0, 1, 0.3))
# rear wall frame
m.box('metal_dark', (2.0, 0.28, 0.08), at=(0, 0.66, -2.76), bevel=0.01, seg=1)
m.box('metal_dark', (2.0, 0.12, 0.08), at=(0, ROOF - 0.06, -2.76), bevel=0.01, seg=1)
# firewall + cowl
m.box('metal_dark', (1.94, 0.9, 0.06), at=(0, 1.0, 1.66), bevel=0.01, seg=1)
m.hull('paint2', [(-0.99, 1.12, 1.72), (0.99, 1.12, 1.72), (-0.99, 1.2, 1.62), (0.99, 1.2, 1.62), (-0.99, 1.12, 1.55), (0.99, 1.12, 1.55)], bevel=0.008, seg=1)

# ================================================================================ WINDSHIELD: glass, armored visor, mesh screen
m.section('windshield')
WS_LO, WS_HI = (1.2, 1.66), (ROOF - 0.05, 0.93)
WN = (0, 0.536, 0.844)        # windshield normal
WD = (0, 0.844, -0.536)       # up the glass


def ws(f, dx, off=0.0):
    y = WS_LO[0] + (WS_HI[0] - WS_LO[0]) * f
    z = WS_LO[1] + (WS_HI[1] - WS_LO[1]) * f
    return (dx, y + off * WN[1], z + off * WN[2])


m.hull('glass', [ws(0, -0.9), ws(0, 0.9), ws(1, 0.9), ws(1, -0.9), ws(0, -0.9, -0.012), ws(0, 0.9, -0.012), ws(1, 0.9, -0.012), ws(1, -0.9, -0.012)], bevel=0, seg=1)
for sx in (1, -1):                                                                                             # A-pillars
    m.beam('paint', ws(0, 0.95 * sx, 0.02), ws(1, 0.95 * sx, 0.02), 0.11, 0.09, up=WN, bevel=0.014, seg=2)
# armored visor plate over the upper glass with two vision slits, hinged at the brow
m.plate('armor', [(-0.95, -0.21), (0.95, -0.21), (0.95, 0.27), (-0.95, 0.27)], 0.02, at=ws(0.76, 0, 0.06), u=(1, 0, 0), v=WD, bevel=0.006, seg=1,
        holes=[[(-0.8, -0.03), (-0.1, -0.03), (-0.1, 0.03), (-0.8, 0.03)], [(0.1, -0.03), (0.8, -0.03), (0.8, 0.03), (0.1, 0.03)]])
for x in (-0.6, 0.0, 0.6):                                                                                     # visor stiffeners
    m.beam('armor', ws(0.56, x, 0.08), ws(0.97, x, 0.08), 0.03, 0.022, up=WN, bevel=0.004, seg=1)
m.rivet_rect('metal_dark', ws(0.76, 0, 0.072), 1.86, 0.44, WN, u=(1, 0, 0), v=WD, step=0.22, r=0.011, inset=0.03)
for sx in (1, -1):
    m.cyl('metal_dark', ws(1.0, 0.7 * sx, 0.07), ws(1.0, 0.45 * sx, 0.07), 0.02, seg=8)                     # visor hinges
# welded mesh screen over the lower glass
mesh_screen(m, ws(0.28, 0, 0.05), (1, 0, 0), WD, 1.8, 0.62, pitch=0.09, r=0.005, mat='metal_dark', frame=0.03, frame_mat='armor', obj='body')
for sx in (1, -1):
    m.beam('armor', ws(0.0, 0.7 * sx, 0.0), ws(0.0, 0.7 * sx, 0.07), 0.03, 0.03, up=WD, bevel=0, seg=1)

# ================================================================================ ROOF: gunner nest
m.section('nest')
cz = -0.95
for z in (-1.42, -0.48):                                                                                       # hatch coaming
    m.box('armor', (1.02, 0.17, 0.07), at=(0, ROOF + 0.09, z), bevel=0.012, seg=1)
for sx in (1, -1):
    m.box('armor', (0.07, 0.17, 0.98), at=(0.49 * sx, ROOF + 0.09, cz), bevel=0.012, seg=1)
m.rivet_rect('metal_dark', (0, ROOF + 0.178, cz), 1.0, 1.0, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.16, r=0.011, inset=0.035)
# hatch lid, opened 112 deg about the rear hinge
LA = 112 * D2R
H0 = Vector((0, ROOF + 0.17, -1.44))
LD = Vector((0, math.sin(LA), math.cos(LA)))                  # along the lid, away from the hinge
LN = Vector((0, -0.375, -0.927))                              # outer face normal (open)
m.box('armor', (1.0, 0.05, 0.86), at=tuple(H0 + LD * 0.43), rot=(-112, 0, 0), bevel=0.012, seg=1)
for x in (-0.3, 0.3):                                                                                           # lid stiffeners (outer face)
    m.beam('armor', tuple(H0 + LD * 0.06 + LN * 0.04 + Vector((x, 0, 0))), tuple(H0 + LD * 0.8 + LN * 0.04 + Vector((x, 0, 0))), 0.04, 0.03, up=tuple(LN), bevel=0.004, seg=1)
m.tube('metal_dark', [tuple(H0 + LD * 0.55 - LN * 0.025 + Vector((-0.18, 0, 0))), tuple(H0 + LD * 0.55 - LN * 0.08 + Vector((-0.15, 0, 0))),
                      tuple(H0 + LD * 0.55 - LN * 0.08 + Vector((0.15, 0, 0))), tuple(H0 + LD * 0.55 - LN * 0.025 + Vector((0.18, 0, 0)))], 0.012, seg=5)
skull_decal(m, tuple(H0 + LD * 0.46 + LN * 0.026), tuple(LN), s=0.42, up=tuple(LD))
m.cyl('metal_dark', (-0.42, ROOF + 0.17, -1.46), (0.42, ROOF + 0.17, -1.46), 0.03, seg=8)
m.beam('metal_dark', (0.4, ROOF + 0.18, -0.7), tuple(H0 + LD * 0.6 + Vector((0.4, 0, 0))), 0.025, 0.025, bevel=0.004, seg=1)   # lid stay
# gun shield in front of the hatch: centre plate with a firing notch + two slits, angled wings, braces
GZ = -0.36
SV = Vector((0, 0.966, -0.259))
SN = Vector((0, 0.259, 0.966))
S0 = Vector((0, RT + 0.02, GZ))
m.plate('armor', [(-0.42, 0.0), (0.42, 0.0), (0.42, 0.52), (0.1, 0.52), (0.06, 0.4), (-0.06, 0.4), (-0.1, 0.52), (-0.42, 0.52)], 0.022,
        at=tuple(S0), u=(1, 0, 0), v=tuple(SV), bevel=0.006, seg=1,
        holes=[[(-0.3, 0.3), (-0.16, 0.3), (-0.16, 0.34), (-0.3, 0.34)], [(0.16, 0.3), (0.3, 0.3), (0.3, 0.34), (0.16, 0.34)]])
for sx in (1, -1):
    m.plate('armor', [(0.0, 0.0), (0.34, 0.0), (0.3, 0.44), (0.0, 0.5)], 0.02, at=(0.42 * sx, RT + 0.02, GZ), u=(0.6 * sx, 0, -0.8), v=tuple(SV),
            bevel=0.005, seg=1)
    m.bead('armor', [tuple(S0 + Vector((0.42 * sx, 0.01, 0))), tuple(S0 + Vector((0.42 * sx, 0, 0)) + SV * 0.5)], r=0.007, n=tuple(SN))
    m.beam('metal_dark', tuple(S0 + Vector((0.3 * sx, 0, 0)) + SV * 0.3 - SN * 0.03), (0.3 * sx, RT + 0.01, GZ - 0.45), 0.035, 0.035, bevel=0.004, seg=1)   # brace
m.rivet_line('metal_dark', tuple(S0 + SV * 0.08 + SN * 0.012 + Vector((-0.38, 0, 0))), tuple(S0 + SV * 0.08 + SN * 0.012 + Vector((0.38, 0, 0))), tuple(SN), step=0.13, r=0.011)
m.bead('armor', [tuple(S0 + Vector((-0.42, 0.005, 0.012))), tuple(S0 + Vector((0.42, 0.005, 0.012)))], r=0.007, n=(0, 1, 0))
for i in range(4):                                                                                            # kill tally
    m.box('decal_white', (0.012, 0.09, 0.004), at=tuple(S0 + SV * 0.16 + SN * 0.013 + Vector((-0.34 + i * 0.03, 0, 0))), rot=(-15, 0, 0), bevel=0, seg=1)
m.box('decal_white', (0.14, 0.012, 0.004), at=tuple(S0 + SV * 0.16 + SN * 0.014 + Vector((-0.295, 0, 0))), rot=(-15, 0, 25), bevel=0, seg=1)
# sandbags on both sides of the hatch
sandbag_ring(m, [(0.72, -1.38), (0.72, -0.5)], RT, rows=2, L=0.46, D=0.3, H=0.15)
sandbag_ring(m, [(-0.72, -1.38), (-0.72, -0.5)], RT, rows=2, L=0.46, D=0.3, H=0.15)
ammo_can(m, (0.7, RT + 0.27, -0.66), yaw=90, mat='paint2')
ammo_can(m, (-0.7, RT + 0.27, -1.22), yaw=80, mat='paint2')
m.sock('roof_top', (0, 2.64, -0.3))

# ---- front light bar + roof rack (rear)
m.section('rack')
for sx in (1, -1):
    m.tube('metal_dark', [(0.9 * sx, RT, 0.55), (0.9 * sx, RT + 0.2, 0.62), (0.9 * sx, RT + 0.2, 0.84)], 0.022, seg=6, bend=0.05, bsteps=2)
m.cyl('metal_dark', (-0.92, RT + 0.2, 0.8), (0.92, RT + 0.2, 0.8), 0.028, seg=8)
for x in (-0.66, -0.3, 0.3, 0.66):
    spot2(m, (x, RT + 0.33, 0.84), n=(0, -0.05, 1), r=0.085)
RY = RT + 0.25
for sx in (1, -1):
    m.tube('metal_dark', [(0.9 * sx, RT, -1.75), (0.9 * sx, RY, -1.8), (0.9 * sx, RY, -2.62), (0.9 * sx, RT, -2.7)], 0.022, seg=6, bend=0.06, bsteps=2)
    for z in (-2.05, -2.35):
        m.cyl('metal_dark', (0.9 * sx, RT, z), (0.9 * sx, RY, z), 0.018, seg=6)
for z in (-1.8, -2.62):
    m.cyl('metal_dark', (-0.9, RY, z), (0.9, RY, z), 0.02, seg=6)
for z in (-1.95, -2.2, -2.45):
    m.box('metal_dark', (1.76, 0.025, 0.07), at=(0, RT + 0.05, z), bevel=0.004, seg=1)
tyre_flat(m, (0.05, RT + 0.2, -2.2), R=0.4, W=0.24, tilt=(0, 0, 4), seg=14)
jerrycan2(m, (0.66, RT + 0.3, -1.95), yaw=90, mat='paint')
jerrycan2(m, (-0.66, RT + 0.3, -1.95), yaw=86, mat='decal_red')
tarp_roll(m, (-0.72, RT + 0.12, -2.35), (-0.72, RT + 0.12, -2.72), r=0.1, seg=8)
crate(m, (0.64, RT + 0.06, -2.5), (0.36, 0.26, 0.38), yaw=12)
m.tube('decal_yellow', [(0.9, RY, -1.9), (0.3, RT + 0.44, -2.1), (-0.3, RT + 0.44, -2.3), (-0.9, RY, -2.5)], 0.008, seg=3, bend=0.1, bsteps=2)      # ratchet strap
# antenna with a rag flag
m.tube('metal_dark', [(-0.93, RY, -2.62), (-0.95, RY + 0.55, -2.66), (-0.94, RY + 1.0, -2.7)], 0.01, seg=5, r_end=0.004)
flag(m, (-0.94, RY + 0.98, -2.7), length=0.36, height=0.2, direction=(0, 0, -1))
# side exhaust stack (right, behind the cab) with a flapper cap and a heat shield on the body
m.section('exhaust+ladder')
exhaust_stack2(m, (-1.06, 0.62, -0.3), (-1.06, 2.5, -0.3), r=0.07, mat='chrome', flap=False)
m.box('armor', (0.1, 0.14, 0.2), at=(-1.04, 0.9, -0.3), bevel=0.01, seg=1)
for y in (1.4, 1.95):
    m.box('metal_dark', (0.07, 0.05, 0.18), at=(-1.0, y, -0.3), bevel=0.006, seg=1)
m.box('metal_dark', (0.16, 0.012, 0.16), at=(-1.06, 2.53, -0.34), rot=(-28, 0, 0), bevel=0.003, seg=1)          # rain flap
m.box('armor', (0.012, 1.5, 0.3), at=(-0.998, 1.55, -0.3), bevel=0.004, seg=1)                                  # heat shield plate
m.sock('exhaust_R', (-1.06, 2.5, -0.3))
m.sock('exhaust_L', (0.45, 0.4, -2.86))
m.sock('fuel_cap', (1.03, 1.02, -0.62))
m.box('chrome', (0.03, 0.14, 0.14), at=(1.03, 1.02, -0.62), bevel=0.008, seg=1)
m.box('metal_dark', (0.02, 0.2, 0.2), at=(1.012, 1.02, -0.62), bevel=0.006, seg=1)
m.sock('nitro_L', (0.5, 0.55, -2.87))
m.sock('nitro_R', (-0.5, 0.55, -2.87))
# ladder up the right rear corner (stand-off brackets to the body)
for z in (-2.66, -2.42):
    m.tube('metal_dark', [(-1.1, 0.62, z), (-1.1, 2.52, z), (-0.92, 2.64, z)], 0.016, seg=6, bend=0.06, bsteps=2)
    for y in (0.9, 1.9):
        m.box('metal_dark', (0.1, 0.03, 0.03), at=(-1.055, y, z), bevel=0.003, seg=1)
for i in range(7):
    m.cyl('metal_dark', (-1.1, 0.82 + i * 0.26, -2.66), (-1.1, 0.82 + i * 0.26, -2.42), 0.012, seg=6)

# ================================================================================ LIGHTS
m.section('lights')
for sx in (1, -1):
    lamp_bucket(m, (0.66 * sx, 0.98, 2.76), 0.105, n=(0, 0, 1), cage=0 if sx > 0 else 3, tape=sx > 0)
    light_rect(m, (0.92 * sx, 0.98, 2.79), (0.08, 0.08), 'light_amber', n=(0, 0, 1))
    taillight2(m, (0.96 * sx, 1.32, -2.83), 0.075, 0.32, n=(0, 0, -1))
    light_rect(m, (0.96 * sx, 0.95, -2.835), (0.07, 0.08), 'light_amber', n=(0, 0, -1), depth=0.06)
m.sock('light_head_L', (0.66, 0.98, 2.82))
m.sock('light_head_R', (-0.66, 0.98, 2.82))
m.sock('light_tail_L', (0.9, 1.32, -2.92))
m.sock('light_tail_R', (-0.9, 1.32, -2.92))

# ================================================================================ PANELS
# ---- hood (hinge at the cowl): armored skin, big air scoop with a mesh mouth, hood pins
m.section('hood')
m.panel('panel_hood', (0, 1.16, 1.68), **PAN)
m.hull('paint2', [(-1.0, 1.1, 1.72), (1.0, 1.1, 1.72), (-1.0, 1.24, 1.72), (1.0, 1.24, 1.72), (-1.0, 1.14, 2.78), (1.0, 1.14, 2.78), (-1.0, 1.02, 2.8), (1.0, 1.02, 2.8)],
       bevel=0.02, seg=2, obj='panel_hood')
m.hull('armor', [(-0.4, 1.22, 1.85), (0.4, 1.22, 1.85), (-0.34, 1.42, 2.06), (0.34, 1.42, 2.06), (-0.34, 1.41, 2.42), (0.34, 1.41, 2.42),
                 (-0.4, 1.2, 2.5), (0.4, 1.2, 2.5)], bevel=0.018, seg=2, obj='panel_hood')                  # scoop
m.hull('metal_dark', [(-0.3, 1.215, 2.505), (0.3, 1.215, 2.505), (-0.3, 1.39, 2.435), (0.3, 1.39, 2.435), (-0.3, 1.22, 2.45), (0.3, 1.22, 2.45),
                      (-0.3, 1.37, 2.39), (0.3, 1.37, 2.39)], bevel=0, obj='panel_hood')                      # dark throat
mesh_screen(m, (0, 1.305, 2.482), (1, 0, 0), (0, 0.93, -0.37), 0.6, 0.18, pitch=0.045, r=0.004, frame=0.02, obj='panel_hood')
m.rivet_rect('metal_dark', (0, 1.225, 2.3), 1.9, 0.98, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.2, r=0.012, inset=0.06, obj='panel_hood')
patch_plate(m, (0.66, 1.2, 2.45), (0, 0.98, 0.2), 0.34, 0.3, mat='rust', up=(0, 0, 1), t=0.008, obj='panel_hood', bolts=4)
for sx in (1, -1):
    m.cyl('metal_dark', (0.35 * sx, 1.22, 1.72), (0.55 * sx, 1.22, 1.72), 0.025, seg=8, obj='panel_hood')          # hinges
    m.cyl('chrome', (0.8 * sx, 1.16, 2.7), (0.8 * sx, 1.26, 2.7), 0.012, seg=6, obj='panel_hood')                   # hood pins
    m.tube('metal_dark', [(0.8 * sx, 1.26, 2.7), (0.8 * sx, 1.28, 2.62), (0.8 * sx, 1.24, 2.56)], 0.005, seg=4, obj='panel_hood')
    m.beam('armor', (0.9 * sx, 1.15, 1.9), (0.9 * sx, 1.14, 2.74), 0.07, 0.04, bevel=0.008, seg=1, obj='panel_hood')
m.use('body')

# ---- doors (hinged at the front edge z = 1.0)
for sx, nm in ((1, 'panel_door_L'), (-1, 'panel_door_R')):
    m.section('doors')
    m.panel(nm, (1.0 * sx, 1.35, 1.0), **PAN)
    outer = [(0.05, 0.68), (0.99, 0.68), (0.99, 2.1), (0.05, 2.1)]
    win = [(0.2, 1.5), (0.86, 1.5), (0.86, 2.0), (0.2, 2.0)]
    m.plate('paint', outer, 0.06, at=(0.985 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.012, seg=1, holes=[win], obj=nm)
    m.box('glass', (0.02, 0.5, 0.66), at=(0.975 * sx, 1.75, 0.53), bevel=0, seg=1, obj=nm)
    m.box('interior', (0.03, 0.75, 0.9), at=(0.94 * sx, 1.08, 0.52), bevel=0.02, seg=1, obj=nm)                     # door card
    m.box('interior', (0.07, 0.05, 0.36), at=(0.915 * sx, 1.28, 0.6), bevel=0.015, seg=1, obj=nm)                    # arm rest
    m.box('metal_dark', (0.02, 0.03, 0.1), at=(0.93 * sx, 1.4, 0.3), bevel=0.004, seg=1, obj=nm)
    # armor plate welded over the lower half
    m.box('armor', (0.03, 0.72, 0.9), at=(1.028 * sx, 1.04, 0.52), bevel=0.01, seg=1, obj=nm)
    m.bead('armor', [(1.045 * sx, 1.40, 0.08), (1.045 * sx, 1.40, 0.97)], r=0.007, obj=nm, n=(sx, 0.2, 0))
    m.bead('armor', [(1.045 * sx, 0.69, 0.97), (1.045 * sx, 1.39, 0.97)], r=0.007, obj=nm, n=(sx, 0, 0.2))
    for (yy, zz) in ((0.78, 0.15), (0.78, 0.9), (1.3, 0.15), (1.3, 0.9)):
        m.hexbolt('metal_dark', (1.043 * sx, yy, zz), (sx, 0, 0), r=0.013, h=0.01)
    firing_port(m, (1.043 * sx, 1.08, 0.52), (sx, 0, 0), w=0.3, h=0.07, mat='armor', obj=nm)
    # window: welded mesh
    mesh_screen(m, (1.0 * sx, 1.75, 0.53), (0, 0, 1), (0, 1, 0), 0.66, 0.5, pitch=0.085, r=0.004, frame=0.03, frame_mat='armor', obj=nm)
    m.box('chrome', (0.05, 0.03, 0.16), at=(1.05 * sx, 1.47, 0.16), bevel=0.008, seg=1, obj=nm)                      # handle
    for y in (0.85, 1.85):
        m.cyl('metal_dark', (1.0 * sx, y, 1.0), (1.0 * sx, y + 0.14, 1.0), 0.028, seg=8, obj=nm)                     # hinges
        m.box('metal_dark', (0.02, 0.1, 0.16), at=(1.02 * sx, y + 0.07, 0.92), bevel=0.004, seg=1, obj=nm)
    # side mirror on a braced arm
    m.tube('metal_dark', [(1.03 * sx, 1.9, 0.95), (1.22 * sx, 1.98, 1.0), (1.32 * sx, 1.98, 1.0)], 0.013, seg=5, bend=0.04, obj=nm)
    m.tube('metal_dark', [(1.03 * sx, 1.62, 0.95), (1.3 * sx, 1.9, 1.0)], 0.01, seg=5, obj=nm)
    m.box('metal_dark', (0.05, 0.26, 0.17), at=(1.33 * sx, 1.95, 1.0), bevel=0.015, seg=1, obj=nm)
    m.box('chrome', (0.008, 0.22, 0.13), at=(1.33 * sx, 1.95, 0.914), bevel=0.0, seg=1, obj=nm)
    m.use('body')

# ---- side armor over the cargo box: welded plates (steel / patched paint / rusty), gun port, spikes, chain
for sx, nm in ((1, 'panel_armor_L'), (-1, 'panel_armor_R')):
    m.section('side armor')
    m.panel(nm, (1.06 * sx, 1.4, -1.4), **PAN)
    x = 1.03 * sx
    m.plate('armor', [(-2.72, 0.78), (-1.63, 0.78), (-1.63, 2.28), (-2.6, 2.28), (-2.72, 2.16)], 0.035, at=(x, 0, 0), u=(0, 0, 1), v=(0, 1, 0),
            bevel=0.008, seg=1, holes=[[(-2.34, 1.76), (-1.7, 1.76), (-1.7, 1.96), (-2.34, 1.96)]], obj=nm)
    zb = -0.44 if sx < 0 else -0.55
    m.plate('paint2', [(-1.64, 0.78), (zb, 0.78), (zb, 2.18), (zb - 0.1, 2.28), (-1.64, 2.28)], 0.03, at=(x + 0.004 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0),
            bevel=0.008, seg=1, holes=[[(-1.2, 1.76), (-0.62, 1.76), (-0.62, 1.96), (-1.2, 1.96)]], obj=nm)
    if sx > 0:
        m.plate('rust', [(-0.56, 0.78), (-0.15, 0.78), (-0.15, 2.1), (-0.3, 2.28), (-0.56, 2.28)], 0.03, at=(x, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.008, seg=1, obj=nm)
        m.bead('armor', [(x + 0.02 * sx, 0.8, -0.555), (x + 0.02 * sx, 2.26, -0.555)], r=0.008, obj=nm, n=(sx, 0, 0))
        for (yy, zz) in ((0.88, -0.25), (0.88, -0.46), (2.1, -0.25), (2.1, -0.46), (1.5, -0.36)):
            m.hexbolt('metal_dark', (x + 0.016 * sx, yy, zz), (sx, 0, 0), r=0.014, h=0.012, obj=nm)
    m.bead('armor', [(x + 0.02 * sx, 0.8, -1.635), (x + 0.02 * sx, 2.26, -1.635)], r=0.008, obj=nm, n=(sx, 0, 0))
    m.rivet_rect('metal_dark', (x + 0.018 * sx, 1.53, -2.175), 1.09, 1.5, (sx, 0, 0), u=(0, 0, -1), v=(0, 1, 0), step=0.27, r=0.012, inset=0.04, obj=nm)
    patch_plate(m, (x + 0.02 * sx, 1.0, -1.38), (sx, 0, 0), 0.36, 0.28, mat='armor', t=0.01, obj=nm, bolts=4, rot=7, bead=False)
    firing_port(m, (x + 0.018 * sx, 1.4, -2.2), (sx, 0, 0), w=0.34, h=0.08, mat='armor', obj=nm, open_=0.3)
    m.box('armor', (0.05, 0.04, 2.6), at=(x + 0.02 * sx, 2.3, -1.42), bevel=0.006, seg=1, obj=nm)                   # top cap
    for zz in (-2.55, -2.05, -1.45, -0.95):                                                                        # low welded spikes
        spike2(m, (x + 0.02 * sx, 0.9, zz), (x + 0.2 * sx, 0.84, zz + 0.05), 0.028, mat='spike', obj=nm)
    m.text('decal_white', 'X', (x + 0.02 * sx, 1.38, -0.95), u=(0, 0, -sx), v=(0, 1, 0), size=0.4, depth=0.004, obj=nm)
    if sx > 0:
        chain(m, [(x + 0.03 * sx, 2.18, -2.5), (x + 0.03 * sx, 2.18, -1.85)], link=0.06, wire=0.007, sag=0.2, obj=nm)
    m.use('body')

# ---- front fenders (arch flares)
for sx, nm in ((1, 'panel_fender_L'), (-1, 'panel_fender_R')):
    m.section('fenders')
    m.panel(nm, (1.03 * sx, 0.9, ZF), **PAN)
    zc = ZF
    pts = [(zc + 0.69 * math.cos(t * D2R), HUBY + 0.69 * math.sin(t * D2R)) for t in range(0, 181, 20)]
    inn = [(zc + 0.58 * math.cos(t * D2R), HUBY + 0.58 * math.sin(t * D2R)) for t in range(180, -1, -20)]
    m.plate('paint', pts + inn, 0.07, at=(1.04 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.012, seg=1, obj=nm)
    lip_o = [(zc + 0.6 * math.cos(t * D2R), HUBY + 0.6 * math.sin(t * D2R)) for t in range(0, 181, 20)]
    lip_i = [(zc + 0.575 * math.cos(t * D2R), HUBY + 0.575 * math.sin(t * D2R)) for t in range(180, -1, -20)]
    m.plate('armor', lip_o + lip_i, 0.12, at=(1.02 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0, seg=1, obj=nm)
    for (a, b) in pts[2:-2:2]:
        m.hexbolt('metal_dark', (1.078 * sx, HUBY + (b - HUBY) * 0.93, zc + (a - zc) * 0.93), (sx, 0, 0), r=0.013, h=0.01, obj=nm)
    m.use('body')

# ---- front bumper: heavy ram (box beam + V cow-catcher + teeth + winch)
nm = 'panel_bumper_F'
m.section('bumper F')
m.panel(nm, (0, 0.7, 2.8), **PAN)
m.hull('armor', [(-1.08, 0.42, 2.74), (1.08, 0.42, 2.74), (-1.08, 0.86, 2.74), (1.08, 0.86, 2.74), (-1.04, 0.44, 2.95), (1.04, 0.44, 2.95), (-1.04, 0.84, 2.93), (1.04, 0.84, 2.93)],
       bevel=0.02, seg=2, obj=nm)
m.rivet_line('metal_dark', (-0.98, 0.8, 2.94), (0.98, 0.8, 2.94), (0, 0.2, 1), step=0.16, r=0.012, obj=nm)
for i in range(12):                                                                                             # hazard stripes on the beam
    m.box('decal_yellow', (0.07, 0.26, 0.01), at=(-0.93 + i * 0.17, 0.63, 2.948), rot=(0, 0, 38), bevel=0, seg=1, obj=nm)
for sx in (1, -1):                                                                                              # V cow-catcher
    for i in range(4):
        xb = sx * (0.18 + i * 0.22)
        m.beam('armor', (xb, 0.84, 2.9), (xb * 0.94, 0.3, 3.02 + (0.12 - 0.035 * i)), 0.05, 0.04, bevel=0, seg=1, obj=nm)
    m.beam('armor', (sx * 0.02, 0.3, 3.15), (sx * 0.92, 0.3, 2.96), 0.07, 0.05, bevel=0.008, seg=1, obj=nm)                     # keel
    spike2(m, (sx * 0.5, 0.32, 3.07), (sx * 0.52, 0.3, 3.26), 0.035, obj=nm)
    spike2(m, (sx * 1.04, 0.62, 2.9), (sx * 1.26, 0.6, 3.04), 0.04, obj=nm)
spike2(m, (0.0, 0.32, 3.15), (0.0, 0.3, 3.32), 0.04, obj=nm)
for i in range(7):                                                                                              # grille guard
    x = -0.45 + i * 0.15
    m.beam('armor', (x, 0.86, 2.86), (x, 1.12, 2.82), 0.035, 0.03, bevel=0.004, seg=1, obj=nm)
m.beam('armor', (-0.52, 1.12, 2.82), (0.52, 1.12, 2.82), 0.05, 0.04, bevel=0.006, seg=1, obj=nm)
for sx in (1, -1):
    m.tube('armor', [(0.5 * sx, 0.86, 2.92), (0.52 * sx, 1.18, 2.92), (0.8 * sx, 1.2, 2.92), (0.98 * sx, 1.1, 2.9), (1.0 * sx, 0.86, 2.9)], 0.028, seg=6, bend=0.06, bsteps=2, obj=nm)
    m.box('armor', (0.4, 0.05, 0.36), at=(0.6 * sx, 0.44, 2.98), rot=(-12, 0, 0), bevel=0.008, seg=1, obj=nm)               # skid
m.cyl('metal_dark', (-0.21, 0.96, 2.99), (0.21, 0.96, 2.99), 0.085, seg=12, obj=nm)                                         # winch
for sx in (1, -1):
    m.cyl('armor', (0.25 * sx, 0.96, 2.99), (0.21 * sx, 0.96, 2.99), 0.11, seg=12, obj=nm)
m.tube('metal_dark', [(0.1, 0.88, 3.02), (0.05, 0.8, 3.06), (0.0, 0.78, 3.07)], 0.009, seg=4, obj=nm)
m.tube('metal_dark', [(0.0, 0.78, 3.07), (0.03, 0.72, 3.09), (-0.02, 0.68, 3.08), (-0.04, 0.72, 3.07)], 0.01, seg=5, bend=0.02, obj=nm)
m.use('body')

# ---- rear bumper: spiked step bumper + hitch + plate
nm = 'panel_bumper_R'
m.section('bumper R')
m.panel(nm, (0, 0.62, -2.86), **PAN)
m.hull('armor', [(-1.06, 0.42, -2.8), (1.06, 0.42, -2.8), (-1.06, 0.8, -2.8), (1.06, 0.8, -2.8), (-1.02, 0.44, -2.98), (1.02, 0.44, -2.98), (-1.02, 0.8, -2.95),
                 (1.02, 0.8, -2.95)], bevel=0.02, seg=2, obj=nm)
m.rivet_line('metal_dark', (-0.96, 0.75, -2.955), (0.96, 0.75, -2.955), (0, 0, -1), step=0.18, r=0.012, obj=nm)
m.box('armor', (0.9, 0.03, 0.22), at=(0, 0.815, -2.9), bevel=0.006, seg=1, obj=nm)                             # step plate
for i in range(6):
    m.box('armor', (0.86, 0.008, 0.02), at=(0, 0.832, -2.98 + i * 0.03), bevel=0, obj=nm)
m.box('metal_dark', (0.14, 0.14, 0.24), at=(0, 0.52, -3.0), bevel=0.01, seg=1, obj=nm)                         # hitch receiver
m.cyl('armor', (0, 0.52, -3.12), (0, 0.66, -3.12), 0.04, seg=10, obj=nm)
m.box('decal_white', (0.34, 0.16, 0.01), at=(0.5, 0.6, -2.99), rot=(0, 0, 4), bevel=0.004, seg=1, obj=nm)     # plate
for sx in (1, -1):
    spike2(m, (1.0 * sx, 0.62, -2.96), (1.16 * sx, 0.62, -3.181), 0.04, obj=nm)
    spike2(m, (0.72 * sx, 0.46, -2.97), (0.74 * sx, 0.4, -3.16), 0.035, obj=nm)
m.use('body')

# ---- rear doors (tailgate): welded double doors, lock bars, view slits
nm = 'panel_tailgate'
m.section('tailgate')
m.panel(nm, (0, 1.5, -2.84), **PAN)
for sx in (1, -1):
    xc = 0.445 * sx
    m.box('armor', (0.87, 1.62, 0.06), at=(xc, 1.5, -2.86), bevel=0.012, seg=1, obj=nm)
    m.box('paint', (0.74, 0.58, 0.02), at=(xc, 1.02, -2.9), bevel=0.006, seg=1, obj=nm)                        # original door skin showing
    m.plate('armor', [(-0.36, -0.05), (0.36, -0.05), (0.36, 0.05), (-0.36, 0.05)], 0.02, at=(xc, 1.95, -2.9), u=(1, 0, 0), v=(0, 1, 0), bevel=0.004, seg=1, obj=nm,
            holes=[[(-0.28, -0.018), (0.28, -0.018), (0.28, 0.018), (-0.28, 0.018)]])
    m.box('interior', (0.56, 0.036, 0.02), at=(xc, 1.95, -2.892), bevel=0, obj=nm)
    for y in (0.9, 1.5, 2.1):
        m.box('metal_dark', (0.12, 0.1, 0.05), at=(0.86 * sx, y, -2.9), bevel=0.008, seg=1, obj=nm)            # hinge straps
        m.cyl('metal_dark', (0.905 * sx, y - 0.06, -2.88), (0.905 * sx, y + 0.06, -2.88), 0.02, seg=6, obj=nm)
    m.rivet_rect('metal_dark', (xc, 1.5, -2.892), 0.87, 1.62, (0, 0, -1), u=(1, 0, 0), v=(0, 1, 0), step=0.22, r=0.012, inset=0.04, obj=nm)
    m.bead('armor', [(xc - 0.38, 1.33, -2.905), (xc + 0.38, 1.33, -2.905)], r=0.007, obj=nm, n=(0, 0.2, -1))
m.box('armor', (0.05, 1.62, 0.09), at=(0.0, 1.5, -2.9), bevel=0.006, seg=1, obj=nm)                            # centre overlap strip
for sx in (1, -1):
    m.cyl('metal_dark', (0.12 * sx, 0.72, -2.96), (0.12 * sx, 2.25, -2.96), 0.018, seg=6, obj=nm)            # cam lock bars
    for y in (0.95, 2.0):
        m.box('metal_dark', (0.06, 0.04, 0.05), at=(0.12 * sx, y, -2.94), bevel=0.004, seg=1, obj=nm)
    m.box('metal_dark', (0.03, 0.18, 0.04), at=(0.2 * sx, 1.45, -2.965), rot=(0, 0, 20 * sx), bevel=0.004, seg=1, obj=nm)
chain(m, [(0.14, 1.3, -2.975), (-0.14, 1.3, -2.975)], link=0.05, wire=0.007, sag=0.12, obj=nm)
m.box('metal_dark', (0.08, 0.1, 0.04), at=(0.0, 1.2, -2.98), bevel=0.01, seg=1, obj=nm)                        # padlock
m.use('body')

add_proxies(m)
m.finish()

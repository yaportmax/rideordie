"""e_heavy "Hauler" (v2): military 6x6 flatbed converted into a gunner platform.  ~8.2 m x 2.6 m, deck 1.6 m, cab roof 3.15 m.
Run: bash tools/blender/vehicles/enemy_b/run.sh e_heavy.py      (VEH_OUT=shots/enemy_b/test for a test build, BAKE_QUICK=1 for a fast bake)
Game space: +X left, +Y up, +Z forward.  Driver on +X.  Unique wear atlases are baked (vbake) -> no vertex colours."""
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts2 import *  # noqa

m = Model('e_heavy', seed=21, bake=True)
PI = math.pi
R_W, W_W, HUBY = 0.66, 0.44, 0.66
HX = 1.02
ZF, ZM, ZR = 2.9, -1.1, -2.7
YD = 1.6                 # deck top
CFLOOR, ROOF = 1.4, 3.15
CAB_R, CAB_F = 1.05, 2.78
RT = ROOF + 0.035
m.bake_opts = dict(dirt_h=1.25, dens=175.0, wheels=[(HX, HUBY, ZF, R_W), (HX, HUBY, ZM, R_W), (HX, HUBY, ZR, R_W)], rust=1.1, wear=1.0,
                   max_size={'paint': (2048, 1024), 'paint2': (1024, 1024), 'armor': (2048, 2048), 'metal_dark': (1024, 1024), 'wood': (1024, 1024)})
m.alias.update({'metal_bare': 'armor', 'plastic': 'interior', 'fabric': 'interior', 'leather': 'interior', 'spike': 'armor', 'brass': 'metal_dark',
                'chrome': 'metal_dark', 'rust': 'armor', 'decal_white': 'decal_yellow', 'decal_red': 'decal_yellow', 'cloth_red': 'canvas',
                'rim': 'metal_dark'})
m.objs['body'].alias = {'rubber_tire': 'metal_dark', 'decal_yellow': 'armor'}
PAN = dict(metal_dark='armor', interior='armor', decal_yellow='armor', rubber_tire='armor', canvas='armor', wood='armor')

# ================================================================================ WHEELS
m.section('wheels')
wheel_set2(m, 'hv', R_W, W_W, [(HX, HUBY, ZF), (-HX, HUBY, ZF), (HX, HUBY, ZM), (-HX, HUBY, ZM), (HX, HUBY, ZR), (-HX, HUBY, ZR)],
           ['wheel_FL', 'wheel_FR', 'wheel_ML', 'wheel_MR', 'wheel_RL', 'wheel_RR'], lugs=15, tread_h=0.04, style='mt', holes=8, nuts=8, seg=26, rim_ratio=0.56)

# ================================================================================ CHASSIS (body)
m.use('body')
m.section('chassis')
with m.tag('under'):
    for sx in (1, -1):
        m.box('metal_dark', (0.14, 0.3, 8.0), at=(0.55 * sx, 1.15, -0.1), bevel=0.008, seg=1)
    for z in (-3.9, -3.3, -2.0, -0.4, 0.5, 1.2, 2.0, 3.3):
        m.box('metal_dark', (1.1, 0.2, 0.12), at=(0, 1.16, z), bevel=0.006, seg=1)
    for zc in (ZF, ZM, ZR):
        m.cyl('metal_dark', (-HX + 0.3, HUBY, zc), (HX - 0.3, HUBY, zc), 0.08, seg=8)
        m.revolve('metal_dark', [(0, -0.3), (0.24, -0.26), (0.3, -0.1), (0.3, 0.1), (0.24, 0.26), (0, 0.3)], at=(0, HUBY, zc), axis='z', seg=10)
        for sx in (1, -1):
            m.revolve('metal_dark', [(0.0, 0.0), (0.26, 0.0), (0.27, 0.06), (0.2, 0.16), (0.1, 0.18)], at=(HX * sx - 0.36 * sx, HUBY, zc), axis=(sx, 0, 0), seg=12, closed=False)   # hub reduction
            m.cyl('metal_dark', (0.62 * sx, HUBY - 0.05, zc - 0.3), (0.62 * sx, 1.0, zc - 0.3), 0.03, seg=6)
            m.cyl('metal_dark', (0.62 * sx, HUBY - 0.05, zc + 0.3), (0.62 * sx, 1.0, zc + 0.3), 0.03, seg=6)
    for sx in (1, -1):
        m.box('metal_dark', (0.11, 0.05, 1.4), at=(0.64 * sx, 0.96, ZF), bevel=0.004, seg=1)
        m.box('metal_dark', (0.11, 0.04, 1.1), at=(0.64 * sx, 0.99, ZF), bevel=0.004, seg=1)
        m.box('metal_dark', (0.12, 0.07, 3.3), at=(0.64 * sx, 0.95, (ZM + ZR) / 2), bevel=0.004, seg=1)          # bogie leaf spring
        m.box('metal_dark', (0.12, 0.05, 2.7), at=(0.64 * sx, 1.0, (ZM + ZR) / 2), bevel=0.004, seg=1)
        m.box('metal_dark', (0.2, 0.28, 0.3), at=(0.64 * sx, 0.9, (ZM + ZR) / 2), bevel=0.01, seg=1)
        m.cyl('metal_dark', (0.95 * sx, 0.6, ZF + 0.35), (0.95 * sx, 1.08, ZF + 0.35), 0.04, seg=6)             # shocks
    m.tube('metal_dark', [(-0.7, 0.72, ZF + 0.3), (0.0, 0.72, ZF + 0.5), (0.7, 0.72, ZF + 0.3)], 0.025, seg=6)   # tie rod
    for z0, z1 in ((0.7, ZF - 0.05), (0.5, ZM + 0.05), (ZM - 0.05, ZR + 0.05)):
        m.cyl('metal_dark', (0, 0.92, z0), (0, 0.85, z1), 0.05, seg=6)
    m.box('metal_dark', (0.55, 0.5, 1.3), at=(0, 1.1, 1.3), bevel=0.02, seg=1)                                    # gearbox / transfer case
    m.box('metal_dark', (0.5, 0.35, 0.5), at=(0, 0.9, 0.35), bevel=0.02, seg=1)
# fuel tank (left) with filler, air tanks + battery box (right), toolbox
m.section('tanks')
m.revolve('paint2', [(0, -0.62), (0.28, -0.6), (0.31, -0.5), (0.31, 0.5), (0.28, 0.6), (0, 0.62)], at=(0.98, 1.0, 0.1), axis='z', seg=14)
for z in (-0.3, 0.5):
    m.revolve('metal_dark', [(0.318, -0.03), (0.318, 0.03)], at=(0.98, 1.0, z), axis='z', seg=14, closed=False)
m.cyl('chrome', (1.05, 1.28, 0.05), (1.05, 1.36, 0.05), 0.05, seg=10)
m.revolve('metal_dark', [(0.06, 0.0), (0.055, 0.02), (0.0, 0.025)], at=(1.05, 1.36, 0.05), axis='y', seg=10, closed=False)
m.box('decal_yellow', (0.02, 0.1, 0.3), at=(1.29, 1.02, 0.1), bevel=0, seg=1)
for z in (-0.2, 0.3):
    m.revolve('metal_dark', [(0, -0.3), (0.13, -0.28), (0.15, -0.2), (0.15, 0.2), (0.13, 0.28), (0, 0.3)], at=(-0.96, 1.0, z), axis='z', seg=10)
m.box('armor', (0.42, 0.34, 0.45), at=(-0.98, 1.05, 0.72), bevel=0.012, seg=1)
m.box('armor', (0.44, 0.03, 0.47), at=(-0.98, 1.235, 0.72), bevel=0.006, seg=1)
m.box('armor', (0.4, 0.3, 0.9), at=(0.95, 1.0, -0.55), bevel=0.012, seg=1)                                         # toolbox (left, behind tank)
m.box('metal_dark', (0.03, 0.04, 0.2), at=(1.16, 1.05, -0.55), bevel=0, seg=1)
# exhaust down-pipes -> twin stacks behind the cab
m.tube('metal_dark', [(-0.62, 1.75, 3.15), (-0.9, 1.5, 3.0), (-1.18, 1.32, 2.6), (-1.2, 1.32, 1.1)], 0.055, seg=6, bend=0.25, bsteps=2)
m.tube('metal_dark', [(0.62, 1.75, 3.15), (0.9, 1.5, 3.0), (1.18, 1.32, 2.6), (1.2, 1.32, 1.1)], 0.055, seg=6, bend=0.25, bsteps=2)
m.section('stacks')
exhaust_stack2(m, (-1.22, 1.3, 1.0), (-1.22, 3.7, 1.0), r=0.085, mat='chrome')
exhaust_stack2(m, (1.22, 1.3, 1.0), (1.22, 3.45, 1.0), r=0.085, mat='chrome')
for sx in (1, -1):
    for y in (1.8, 2.6):
        m.box('metal_dark', (0.12, 0.05, 0.16), at=(1.16 * sx, y, 1.0), bevel=0, seg=1)
m.sock('exhaust_R', (-1.22, 3.7, 1.0))
m.sock('exhaust_L', (1.22, 3.45, 1.0))
# rear: pintle hook crossmember
m.box('metal_dark', (0.5, 0.2, 0.3), at=(0, 1.0, -4.05), bevel=0.01, seg=1)

# ================================================================================ DECK / BED
m.section('deck')
m.box('wood', (2.44, 0.1, 4.9), at=(0, YD - 0.05, -1.55), bevel=0.01, seg=1)
for i in range(1, 12):                                                                                              # plank gaps
    m.box('metal_dark', (0.012, 0.012, 4.86), at=(-1.22 + i * (2.44 / 12), YD + 0.001, -1.55), bevel=0)
for i in range(9):                                                                                                  # steel cross straps
    m.box('armor', (2.44, 0.012, 0.05), at=(0, YD + 0.004, -3.95 + i * 0.6), bevel=0)
for sx in (1, -1):
    m.box('armor', (0.16, 0.24, 5.0), at=(1.21 * sx, YD - 0.16, -1.55), bevel=0.012, seg=1)                          # deck sills
    for z in (0.6, -0.5, -1.6, -2.7, -3.7):
        m.box('metal_dark', (0.06, 0.12, 0.1), at=(1.3 * sx, YD - 0.14, z), bevel=0.004, seg=1)                     # stake pockets
m.box('armor', (2.6, 0.24, 0.16), at=(0, YD - 0.16, -4.03), bevel=0.012, seg=1)
m.box('armor', (2.5, 0.24, 0.16), at=(0, YD - 0.16, 0.88), bevel=0.012, seg=1)
with m.tag('under'):
    for z in (-3.6, -2.7, -1.8, -0.9, 0.0, 0.7):
        m.box('metal_dark', (2.3, 0.16, 0.09), at=(0, YD - 0.2, z), bevel=0)
# headboard (cab protector): welded frame + vertical bars, two jerrycans clamped on
HZ = 0.93
for sx in (1, -1):
    m.box('armor', (0.08, 1.35, 0.08), at=(1.12 * sx, YD + 0.67, HZ), bevel=0.008, seg=1)
m.box('armor', (2.3, 0.08, 0.08), at=(0, YD + 1.33, HZ), bevel=0.008, seg=1)
m.box('armor', (2.3, 0.06, 0.06), at=(0, YD + 0.75, HZ), bevel=0.006, seg=1)
for i in range(9):
    x = -0.96 + i * 0.24
    m.cyl('metal_dark', (x, YD, HZ), (x, YD + 1.3, HZ), 0.016, seg=6)
jerrycan2(m, (0.72, YD + 0.95, HZ - 0.12), yaw=90, mat='paint')
jerrycan2(m, (-0.72, YD + 0.95, HZ - 0.12), yaw=90, mat='decal_red')
# front bunker (gunner 1 at 0.45, 1.6, -0.12): sandbags against the headboard + both sides
m.section('bunkers')
sandbag_ring(m, [(-1.0, 0.6), (1.0, 0.6)], YD, rows=3, L=0.5, D=0.3, H=0.16)
for sx in (1, -1):
    sandbag_ring(m, [(0.98 * sx, 0.3), (0.98 * sx, -0.85)], YD, rows=3, L=0.5, D=0.3, H=0.16)
    sandbag_ring(m, [(0.98 * sx, -2.45), (0.98 * sx, -3.3)], YD, rows=2, L=0.5, D=0.3, H=0.16)
sandbag_ring(m, [(-0.75, -3.55), (0.75, -3.55)], YD, rows=2, L=0.5, D=0.3, H=0.16)
# improvised steel shields on posts at the bunker corners
for (x, z, yaw) in ((0.98, -0.95, 0), (-0.98, -2.35, 0)):
    m.plate('armor', [(-0.3, 0.0), (0.3, 0.0), (0.26, 0.5), (-0.26, 0.5)], 0.02, at=(x, YD + 0.45, z), u=(0, 0, 1), v=(0, 1, 0), bevel=0.004, seg=1)
    m.cyl('metal_dark', (x - 0.03 * (1 if x > 0 else -1), YD + 0.3, z - 0.25), (x - 0.03 * (1 if x > 0 else -1), YD + 0.98, z - 0.25), 0.02, seg=6)
m.sock('seat_gunner', (0.45, YD, -0.12))
m.sock('seat_gunner2', (-0.45, YD, -3.05))
# gun pedestal: welded pipe column with gussets on a bolted base plate, traverse ring on top
m.section('pedestal')
GM = (0.0, YD, -1.9)
m.revolve('armor', [(0.44, 0.0), (0.44, 0.03), (0.4, 0.05), (0.14, 0.07)], at=GM, axis='y', seg=12, closed=False)
m.cyl('armor', (0, YD + 0.05, -1.9), (0, YD + 1.0, -1.9), 0.13, seg=10)
for a in range(0, 360, 90):
    ca, sa = math.cos((a + 45) * D2R), math.sin((a + 45) * D2R)
    m.plate('armor', [(0.0, 0.0), (0.26, 0.0), (0.0, 0.5)], 0.02, at=(0.12 * ca, YD + 0.05, -1.9 + 0.12 * sa), u=(ca, 0, sa), v=(0, 1, 0), bevel=0, seg=1)
for a in range(0, 360, 45):
    m.hexbolt('metal_dark', (0.36 * math.cos(a * D2R), YD + 0.03, -1.9 + 0.36 * math.sin(a * D2R)), (0, 1, 0), r=0.022, h=0.02)
m.revolve('metal_dark', [(0.26, 1.0), (0.26, 1.06), (0.2, 1.08), (0.2, 1.12), (0.15, 1.12)], at=GM, axis='y', seg=12, closed=False)
m.box('metal_dark', (0.16, 0.08, 0.16), at=(0, YD + 1.16, -1.9), bevel=0.01, seg=1)
m.sock('gun_mount', (GM[0], YD + 1.2, GM[2]))
# roll arch over the middle of the bed: light bar, skull, chains
m.section('arch')
AZ = -1.02
for sx in (1, -1):
    m.tube('armor', [(1.2 * sx, YD, AZ), (1.2 * sx, YD + 1.35, AZ), (1.02 * sx, YD + 1.72, AZ), (0.6 * sx, YD + 1.8, AZ)], 0.045, seg=8, bend=0.22, bsteps=3)
    m.tube('armor', [(1.2 * sx, YD + 0.8, AZ), (1.2 * sx, YD, AZ + 0.75)], 0.03, seg=6)                             # rake brace
    m.box('armor', (0.16, 0.02, 0.16), at=(1.2 * sx, YD + 0.01, AZ), bevel=0.004, seg=1)
m.cyl('armor', (-0.6, YD + 1.8, AZ), (0.6, YD + 1.8, AZ), 0.045, seg=8)
for x in (-0.7, 0.7):
    spot2(m, (x, YD + 1.95, AZ + 0.05), n=(0, -0.08, -1), r=0.1)
for x in (-0.3, 0.3):
    spot2(m, (x, YD + 1.95, AZ + 0.05), n=(0, -0.1, 1), r=0.1)
skull2(m, (0, YD + 1.6, AZ + 0.02), s=0.6, n=(0, -0.15, 1), horns=True, mat='plastic', horn_mat='armor')
chain(m, [(0.5, YD + 1.76, AZ + 0.05), (0.12, YD + 1.76, AZ + 0.05)], link=0.06, wire=0.008, sag=0.14)
# deck cargo: fuel drums, crates, ammo cans, tarp, spare wheel
m.section('cargo')
barrel(m, (-0.88, YD + 0.43, -1.45), r=0.27, h=0.86, mat='paint2', seg=14, rings=2)
barrel(m, (-0.88, YD + 0.43, -2.02), r=0.27, h=0.86, mat='decal_red', seg=14, rings=2)
m.tube('decal_yellow', [(-1.2, YD + 0.75, -1.2), (-0.6, YD + 0.8, -1.4), (-0.6, YD + 0.8, -2.1), (-1.2, YD + 0.75, -2.3)], 0.01, seg=3, bend=0.1, bsteps=2)   # strap
crate(m, (0.82, YD, -1.4), (0.52, 0.4, 0.62), yaw=8)
crate(m, (0.82, YD, -2.08), (0.5, 0.36, 0.6), yaw=-5)
ammo_can(m, (0.8, YD + 0.4, -1.45), yaw=80, mat='paint2')
ammo_can(m, (0.35, YD, -3.0), yaw=10, mat='paint2')
ammo_can(m, (0.35, YD, -3.35), yaw=-6, mat='paint2')
m.box('canvas', (0.9, 0.14, 1.0), at=(-0.4, YD + 0.07, -0.45), rot=(0, 8, 0), bevel=0.05, seg=1)                  # folded tarp
# banner pole (rear right) with rag flag, antenna
m.section('flags')
m.tube('metal_dark', [(-1.22, YD, -3.9), (-1.22, YD + 1.6, -3.9), (-1.22, YD + 2.3, -3.9)], 0.024, seg=6, r_end=0.012)
flag(m, (-1.22, YD + 2.28, -3.92), length=0.825, height=0.5, direction=(0, 0, -1), mat='cloth_red', cols=8, wave=0.06)
m.sock('light_tail_L', (1.2, YD - 0.12, -4.12))
m.sock('light_tail_R', (-1.2, YD - 0.12, -4.12))
m.sock('nitro_L', (0.6, 1.0, -4.15))
m.sock('nitro_R', (-0.6, 1.0, -4.15))


# ================================================================================ CAB (side skins with door openings)
m.section('cab')


def cab_outline():
    return [(CAB_R, CFLOOR), (CAB_F, CFLOOR), (CAB_F, 2.1), (2.55, 3.1), (2.5, ROOF), (CAB_R, ROOF)]


door_hole = [(1.5, 1.58), (2.5, 1.58), (2.5, 3.0), (1.5, 3.0)]
for sx in (1, -1):
    m.plate('paint', cab_outline(), 0.06, at=(1.11 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.01, seg=1, holes=[door_hole])
    m.box('metal_dark', (0.07, 0.08, 1.06), at=(1.05 * sx, 1.55, 2.0), bevel=0.006, seg=1)
    m.box('armor', (0.24, 0.05, 1.1), at=(1.18 * sx, 1.36, 2.0), bevel=0.01, seg=1)                                  # cab steps
    m.box('armor', (0.24, 0.05, 0.9), at=(1.18 * sx, 0.95, 1.95), bevel=0.01, seg=1)
    for z in (1.5, 2.45):
        m.box('metal_dark', (0.2, 0.5, 0.04), at=(1.15 * sx, 1.15, z), bevel=0.004, seg=1)
    m.bead('armor', [(1.145 * sx, 1.44, 1.08), (1.145 * sx, 3.12, 1.08)], r=0.008, n=(sx, 0, 0))
    patch_plate(m, (1.14 * sx, 2.62, 1.28), (sx, 0, 0), 0.34, 0.6, mat='armor', t=0.012, bolts=4, bead=False)
    m.rivet_line('metal_dark', (1.158 * sx, 2.35, 1.14), (1.158 * sx, 2.95, 1.14), (sx, 0, 0), step=0.12, r=0.011)
# cab rear wall + rear window slit
m.plate('armor', [(-1.14, CFLOOR), (1.14, CFLOOR), (1.14, ROOF), (-1.14, ROOF)], 0.07, at=(0, 0, CAB_R), u=(1, 0, 0), v=(0, 1, 0), bevel=0.01, seg=1,
        holes=[[(-0.5, 2.5), (0.5, 2.5), (0.5, 2.72), (-0.5, 2.72)]])
m.box('glass', (0.98, 0.2, 0.02), at=(0, 2.61, CAB_R + 0.03), bevel=0)
m.rivet_rect('metal_dark', (0, 2.28, CAB_R - 0.04), 2.2, 1.6, (0, 0, -1), u=(-1, 0, 0), v=(0, 1, 0), step=0.26, r=0.013, inset=0.06)
# cab roof: paint2 plate + armor hat + brow visor
m.plate('paint2', [(-1.14, CAB_R), (1.14, CAB_R), (1.14, 2.55), (-1.14, 2.55)], 0.07, at=(0, ROOF + 0.0, 0), u=(1, 0, 0), v=(0, 0, 1), bevel=0.014, seg=1)
m.box('armor', (1.9, 0.05, 1.05), at=(0, ROOF + 0.06, 1.6), bevel=0.01, seg=1)
m.rivet_rect('metal_dark', (0, ROOF + 0.087, 1.6), 1.9, 1.05, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.22, r=0.013, inset=0.05)
m.hull('armor', [(-1.14, ROOF - 0.02, 2.6), (1.14, ROOF - 0.02, 2.6), (-1.14, ROOF + 0.08, 2.5), (1.14, ROOF + 0.08, 2.5),
                 (-1.12, ROOF - 0.3, 2.85), (1.12, ROOF - 0.3, 2.85), (-1.12, ROOF - 0.22, 2.75), (1.12, ROOF - 0.22, 2.75)], bevel=0.02, seg=1)
m.bead('armor', [(-1.12, ROOF + 0.03, 2.5), (1.12, ROOF + 0.03, 2.5)], r=0.008, n=(0, 1, 0.3))
# windshield: glass, armored visor with two slits, welded mesh over the lower half
m.section('windshield')
WLO, WHI = (2.1, 2.8), (ROOF - 0.05, 2.56)
WDv = Vector((0, WHI[0] - WLO[0], WHI[1] - WLO[1])).normalized()
WNv = Vector((1, 0, 0)).cross(WDv).normalized()
if WNv.z < 0:
    WNv = -WNv


def ws(f, dx, off=0.0):
    return (dx, WLO[0] + (WHI[0] - WLO[0]) * f + WNv.y * off, WLO[1] + (WHI[1] - WLO[1]) * f + WNv.z * off)


m.hull('glass', [ws(0, -1.03), ws(0, 1.03), ws(1, 1.03), ws(1, -1.03), ws(0, -1.03, -0.012), ws(0, 1.03, -0.012), ws(1, 1.03, -0.012), ws(1, -1.03, -0.012)], bevel=0, seg=1)
for sx in (1, -1):
    m.beam('paint', ws(0, 1.07 * sx, 0.02), ws(1, 1.07 * sx, 0.02), 0.13, 0.1, up=tuple(WNv), bevel=0.012, seg=1)
m.box('metal_dark', (2.0, 0.09, 0.1), at=(0, 2.13, 2.8), bevel=0.008, seg=1)
m.plate('armor', [(-1.05, -0.22), (1.05, -0.22), (1.05, 0.24), (-1.05, 0.24)], 0.022, at=ws(0.72, 0, 0.06), u=(1, 0, 0), v=tuple(WDv), bevel=0.006, seg=1,
        holes=[[(-0.88, -0.035), (-0.12, -0.035), (-0.12, 0.035), (-0.88, 0.035)], [(0.12, -0.035), (0.88, -0.035), (0.88, 0.035), (0.12, 0.035)]])
for x in (-0.7, 0.0, 0.7):
    m.beam('armor', ws(0.52, x, 0.085), ws(0.96, x, 0.085), 0.035, 0.025, up=tuple(WNv), bevel=0, seg=1)
m.rivet_rect('metal_dark', ws(0.72, 0, 0.074), 2.06, 0.42, tuple(WNv), u=(1, 0, 0), v=tuple(WDv), step=0.24, r=0.012, inset=0.03)
mesh_screen(m, ws(0.26, 0, 0.05), (1, 0, 0), tuple(WDv), 2.0, 0.5, pitch=0.1, r=0.006, mat='metal_dark', frame=0.035, frame_mat='armor', obj='body')
# snorkel up the right A-pillar with a mushroom cap
m.section('snorkel')
m.tube('metal_dark', [(-1.2, 1.92, 2.72), (-1.2, 2.2, 2.72), (-1.2, 3.35, 2.52), (-1.2, 3.5, 2.5)], 0.075, seg=10, bend=0.2, bsteps=2)
m.revolve('metal_dark', [(0.075, -0.02), (0.13, 0.02), (0.14, 0.09), (0.1, 0.12), (0.0, 0.13)], at=(-1.2, 3.5, 2.5), axis='y', seg=10, closed=False)
for y in (2.4, 3.0):
    m.box('metal_dark', (0.12, 0.04, 0.1), at=(-1.14, y, 2.66 - (y - 2.2) * 0.17), bevel=0, seg=1)
# firewall + cowl
m.box('metal_dark', (2.0, 0.75, 0.06), at=(0, 1.78, CAB_F - 0.03), bevel=0.006, seg=1)
m.box('paint2', (2.24, 0.06, 0.16), at=(0, 2.12, CAB_F - 0.02), bevel=0.01, seg=1)

# ================================================================================ CAB INTERIOR
m.section('interior')
with m.tag('inner'):
    m.box('interior', (2.1, 0.08, 1.7), at=(0, CFLOOR + 0.06, 1.9), bevel=0)
    m.box('interior', (0.04, 1.3, 0.9), at=(1.0, 2.3, 2.0), bevel=0)
    m.box('interior', (0.04, 1.3, 0.9), at=(-1.0, 2.3, 2.0), bevel=0)
bucket_seat2(m, (0.45, 1.92, 1.68), w=0.52, cover='leather')
bucket_seat2(m, (-0.45, 1.92, 1.68), w=0.52, cover='leather', torn=False)
m.hull('interior', [(-1.0, 1.85, 2.78), (1.0, 1.85, 2.78), (-1.0, 2.18, 2.74), (1.0, 2.18, 2.74), (-1.0, 2.12, 2.3), (1.0, 2.12, 2.3), (-1.0, 1.6, 2.3), (1.0, 1.6, 2.3)],
       bevel=0.03, seg=1)
m.box('interior', (0.5, 0.2, 0.24), at=(0.45, 2.28, 2.36), bevel=0.02, seg=1)
gauge_cluster(m, (0.45, 2.27, 2.235), n=(0, 0.25, -1), w=0.4, count=3)
steering_wheel2(m, (0.45, 2.42, 2.28), tilt=38, r=0.23, mat='leather')
for x, a in ((0.08, 18), (0.16, 26)):
    m.cyl('metal_dark', (x, 1.5, 2.1), (x, 1.9, 2.1 - 0.4 * math.tan(a * D2R)), 0.012, seg=6)                     # gear + transfer levers
    m.revolve('metal_dark', [(0.0, -0.025), (0.028, 0.0), (0.0, 0.03)], at=(x, 1.9, 2.1 - 0.4 * math.tan(a * D2R)), axis='y', seg=6, closed=False)
m.box('interior', (0.5, 0.28, 0.5), at=(0, 1.7, 1.75), bevel=0.02, seg=1)
m.box('metal_dark', (0.24, 0.08, 0.16), at=(-0.4, 2.2, 2.4), bevel=0.01, seg=1)                                 # radio
m.cyl('metal_dark', (-0.8, 2.0, 1.2), (0.8, 2.6, 1.2), 0.018, seg=6)                                              # rifle across the back wall
m.box('metal_dark', (0.06, 0.1, 0.25), at=(0.2, 2.3, 1.2), rot=(0, 0, 20), bevel=0, seg=1)
m.sock('seat_driver', (0.45, 1.92, 1.68))
m.sock('camera_hood', (0, 2.35, 3.2))
m.sock('roof_top', (0, 3.27, 1.6))
# roof furniture: rack with spare tyre, light bar, whip antenna with pennant
m.section('roof')
for sx in (1, -1):
    m.tube('metal_dark', [(1.02 * sx, RT, 2.35), (1.02 * sx, RT + 0.22, 2.3), (1.02 * sx, RT + 0.22, 1.2), (1.02 * sx, RT, 1.15)], 0.022, seg=6, bend=0.05, bsteps=2)
for z in (2.3, 1.2):
    m.cyl('metal_dark', (-1.02, RT + 0.22, z), (1.02, RT + 0.22, z), 0.02, seg=6)
tyre_flat(m, (-0.2, RT + 0.2, 1.72), R=0.56, W=0.3, tilt=(0, 0, -3), seg=16)
m.tube('decal_yellow', [(-1.02, RT + 0.22, 1.5), (-0.2, RT + 0.37, 1.55), (0.6, RT + 0.2, 1.6)], 0.01, seg=3, bend=0.1, bsteps=2)
for x in (-0.66, -0.3, 0.3, 0.66):
    spot2(m, (x, RT + 0.28, 2.58), n=(0, -0.04, 1), r=0.1)
m.cyl('metal_dark', (-0.9, RT + 0.15, 2.5), (0.9, RT + 0.15, 2.5), 0.025, seg=6)
m.tube('metal_dark', [(1.1, ROOF + 0.08, 1.2), (1.14, ROOF + 0.9, 1.15), (1.13, ROOF + 1.6, 1.1)], 0.011, seg=5, r_end=0.004)
flag(m, (1.13, ROOF + 1.58, 1.08), length=0.34, height=0.16, direction=(0, 0, -1), mat='cloth_red')

# ================================================================================ ENGINE BAY (under the hood)
m.section('engine')
m.hull('metal_dark', [(-0.42, 1.5, 2.95), (0.42, 1.5, 2.95), (-0.42, 1.95, 3.0), (0.42, 1.95, 3.0), (-0.42, 1.5, 3.6), (0.42, 1.5, 3.6), (-0.42, 1.9, 3.55), (0.42, 1.9, 3.55)], bevel=0.01, seg=1)
for sx in (1, -1):
    m.box('armor', (0.2, 0.12, 0.62), at=(0.24 * sx, 2.0, 3.28), bevel=0.01, seg=1)
    m.tube('metal_dark', [(0.4 * sx, 1.9, 3.1), (0.6 * sx, 1.9, 3.0), (0.68 * sx, 1.75, 3.1)], 0.045, seg=6)
m.box('armor', (0.3, 0.12, 0.4), at=(0, 2.04, 3.3), bevel=0.01, seg=1)
m.revolve('metal_dark', [(0, 0), (0.1, 0.02), (0.1, 0.32), (0, 0.34)], at=(0.0, 2.0, 3.0), axis='y', seg=8)
m.box('metal_dark', (1.5, 0.6, 0.1), at=(0, 1.78, 3.68), bevel=0.006, seg=1)                                     # radiator
for i in range(8):
    m.box('armor', (1.44, 0.014, 0.03), at=(0, 1.52 + i * 0.07, 3.73), bevel=0)
m.cyl('metal_dark', (0, 1.78, 3.4), (0, 1.78, 3.62), 0.26, seg=10)
m.box('interior', (0.26, 0.24, 0.2), at=(0.68, 1.6, 3.0), bevel=0.01, seg=1)
m.sock('smoke_engine', (0, 2.0, 3.3))
# military grille (body, between the fenders)
m.section('grille')
m.box('armor', (1.52, 0.66, 0.05), at=(0, 1.76, 3.82), bevel=0.008, seg=1)
for i in range(11):
    x = -0.65 + i * 0.13
    m.box('metal_dark', (0.06, 0.52, 0.03), at=(x, 1.76, 3.85), bevel=0, seg=1)
m.rivet_rect('metal_dark', (0, 1.76, 3.847), 1.52, 0.66, (0, 0, 1), u=(-1, 0, 0), v=(0, 1, 0), step=0.24, r=0.012, inset=0.03)

# ================================================================================ LIGHTS
m.section('lights')
for sx in (1, -1):
    lamp_bucket(m, (1.0 * sx, 1.72, 3.8), 0.13, n=(0, 0, 1), cage=3 if sx > 0 else 0, tape=sx < 0)
    light_rect(m, (1.12 * sx, 2.0, 3.75), (0.12, 0.08), 'light_amber', n=(0, 0, 1))
    headlight2(m, (0.55 * sx, 1.35, 3.95), 0.07, n=(0, 0, 1), seg=8)
    taillight2(m, (1.18 * sx, YD - 0.12, -4.1), 0.2, 0.16, n=(0, 0, -1))
    taillight2(m, (0.9 * sx, YD - 0.12, -4.1), 0.14, 0.12, n=(0, 0, -1), cage=False)
    light_rect(m, (1.18 * sx, YD - 0.31, -4.1), (0.18, 0.07), 'light_amber', n=(0, 0, -1), depth=0.06)
m.sock('light_head_L', (1.0, 1.72, 3.86))
m.sock('light_head_R', (-1.0, 1.72, 3.86))
m.sock('fuel_cap', (1.05, 1.36, 0.05))

# ================================================================================ PANELS
# hood: long armored military bonnet with side louvres, intake mesh, rubber T-latches
m.section('hood')
m.panel('panel_hood', (0, 2.1, 2.8), **PAN)
m.hull('paint', [(-0.86, 2.02, 2.82), (0.86, 2.02, 2.82), (-0.86, 2.2, 2.82), (0.86, 2.2, 2.82), (-0.86, 2.02, 3.74), (0.86, 2.02, 3.74), (-0.86, 1.95, 3.75), (0.86, 1.95, 3.75)],
       bevel=0.02, seg=1, obj='panel_hood')
m.hull('armor', [(-0.6, 2.16, 2.95), (0.6, 2.16, 2.95), (-0.5, 2.3, 3.05), (0.5, 2.3, 3.05), (-0.5, 2.28, 3.5), (0.5, 2.28, 3.5), (-0.6, 2.06, 3.62), (0.6, 2.06, 3.62)],
       bevel=0.02, seg=1, obj='panel_hood')
mesh_screen(m, (0, 2.305, 3.27), (1, 0, 0), (0, 0, 1), 0.85, 0.34, pitch=0.05, r=0.004, frame=0.02, obj='panel_hood')
m.rivet_rect('metal_dark', (0, 2.2, 3.3), 1.68, 0.9, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.22, r=0.013, inset=0.05, obj='panel_hood')
for sx in (1, -1):
    for i in range(6):                                                                                             # side louvres
        z = 3.0 + i * 0.1
        m.box('paint', (0.02, 0.1, 0.05), at=(0.87 * sx, 2.08, z), rot=(0, 0, 0), bevel=0, seg=1, obj='panel_hood')
    m.cyl('metal_dark', (0.3 * sx, 2.16, 2.82), (0.55 * sx, 2.16, 2.82), 0.03, seg=8, obj='panel_hood')
    m.box('rubber_tire', (0.04, 0.12, 0.03), at=(0.88 * sx, 2.0, 3.55), bevel=0.006, seg=1, obj='panel_hood')      # T-latches
    m.box('rubber_tire', (0.05, 0.02, 0.1), at=(0.88 * sx, 2.06, 3.55), bevel=0.006, seg=1, obj='panel_hood')
patch_plate(m, (-0.5, 2.2, 2.95), (0, 1, 0), 0.32, 0.26, mat='rust', up=(0, 0, 1), t=0.008, obj='panel_hood', bolts=4, bead=False)
m.use('body')
# doors
for sx, nm in ((1, 'panel_door_L'), (-1, 'panel_door_R')):
    m.section('doors')
    m.panel(nm, (1.14 * sx, 2.3, 2.5), **PAN)
    outer = [(1.52, 1.6), (2.48, 1.6), (2.48, 2.98), (1.52, 2.98)]
    win = [(1.72, 2.42), (2.32, 2.42), (2.32, 2.86), (1.72, 2.86)]
    m.plate('paint', outer, 0.07, at=(1.15 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.012, seg=1, holes=[win], obj=nm)
    m.box('glass', (0.02, 0.44, 0.6), at=(1.15 * sx, 2.64, 2.02), bevel=0, obj=nm)
    m.box('interior', (0.03, 0.8, 0.9), at=(1.1 * sx, 2.0, 2.0), bevel=0.02, seg=1, obj=nm)                          # door card
    m.box('armor', (0.04, 0.84, 0.92), at=(1.2 * sx, 1.98, 2.0), bevel=0.01, seg=1, obj=nm)
    m.bead('armor', [(1.222 * sx, 2.4, 1.56), (1.222 * sx, 2.4, 2.45)], r=0.008, obj=nm, n=(sx, 0.2, 0))
    for (yy, zz) in ((1.64, 1.6), (1.64, 2.4), (2.3, 1.6), (2.3, 2.4)):
        m.hexbolt('metal_dark', (1.222 * sx, yy, zz), (sx, 0, 0), r=0.015, h=0.012, obj=nm)
    firing_port(m, (1.222 * sx, 2.0, 2.0), (sx, 0, 0), w=0.32, h=0.08, mat='armor', obj=nm)
    mesh_screen(m, (1.17 * sx, 2.64, 2.02), (0, 0, 1), (0, 1, 0), 0.6, 0.44, pitch=0.085, r=0.005, frame=0.03, frame_mat='armor', obj=nm)
    m.box('armor', (0.12, 0.05, 0.75), at=(1.22 * sx, 2.9, 2.02), rot=(0, 0, -12 * sx), bevel=0.008, seg=1, obj=nm)      # rain visor
    m.box('chrome', (0.06, 0.03, 0.18), at=(1.22 * sx, 2.3, 1.62), bevel=0.008, seg=1, obj=nm)
    for y in (1.9, 2.7):
        m.cyl('metal_dark', (1.14 * sx, y, 2.5), (1.14 * sx, y + 0.14, 2.5), 0.03, seg=8, obj=nm)
        m.box('metal_dark', (0.02, 0.1, 0.2), at=(1.17 * sx, y + 0.07, 2.4), bevel=0.004, seg=1, obj=nm)
    # west-coast mirror on a tube frame
    m.tube('metal_dark', [(1.2 * sx, 2.85, 2.46), (1.44 * sx, 2.95, 2.5), (1.44 * sx, 2.55, 2.5), (1.2 * sx, 2.45, 2.46)], 0.012, seg=5, obj=nm)
    m.box('metal_dark', (0.05, 0.36, 0.18), at=(1.46 * sx, 2.75, 2.52), bevel=0.012, seg=1, obj=nm)
    m.box('chrome', (0.008, 0.32, 0.15), at=(1.46 * sx, 2.75, 2.43), bevel=0, seg=1, obj=nm)
    m.use('body')


# front fenders: flat military wings with bolted arch lips
def arch(zc, r, cy, y0, n=8):
    t0 = math.asin(max(min((y0 - cy) / r, 1), -1))
    return [(zc + r * math.cos(PI - t0 - (PI - 2 * t0) * i / n), cy + r * math.sin(PI - t0 - (PI - 2 * t0) * i / n)) for i in range(n + 1)]


for sx, nm in ((1, 'panel_fender_L'), (-1, 'panel_fender_R')):
    m.section('fenders')
    m.panel(nm, (1.05 * sx, 1.6, ZF), **PAN)
    ol = [(2.2, 1.05)] + arch(ZF, 0.78, HUBY, 1.05) + [(3.6, 1.05), (3.82, 1.05), (3.86, 1.5), (3.82, 1.92), (2.2, 1.92)]
    m.plate('paint', ol, 0.06, at=(1.235 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.01, seg=1, obj=nm)
    m.hull('paint', [(0.84 * sx, 1.94, 2.25), (1.27 * sx, 1.94, 2.25), (0.84 * sx, 1.94, 3.85), (1.27 * sx, 1.94, 3.85), (0.84 * sx, 1.86, 2.25), (1.27 * sx, 1.86, 2.25),
                     (0.84 * sx, 1.9, 3.85), (1.27 * sx, 1.9, 3.85)], bevel=0.02, seg=1, obj=nm)
    m.rivet_line('metal_dark', (1.27 * sx, 1.945, 2.4), (1.27 * sx, 1.945, 3.8), (0, 1, 0), step=0.2, r=0.013, obj=nm)
    for i in range(3):                                                                                               # diamond tread plate step on the wing
        m.box('armor', (0.3, 0.012, 0.36), at=(1.02 * sx, 1.95, 2.45 + i * 0.4), bevel=0.004, seg=1, obj=nm)
    po = [(ZF + 0.86 * math.cos(t * D2R), HUBY + 0.86 * math.sin(t * D2R)) for t in range(22, 159, 17)]
    pi_ = [(ZF + 0.76 * math.cos(t * D2R), HUBY + 0.76 * math.sin(t * D2R)) for t in range(158, 21, -17)]
    m.plate('armor', po + pi_, 0.09, at=(1.27 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.006, seg=1, obj=nm)
    for (zz, yy) in po[1:-1]:
        m.hexbolt('metal_dark', (1.315 * sx, yy - 0.04, zz), (sx, 0, 0), r=0.014, h=0.012, obj=nm)
    m.use('body')

# plow bumper: welded V blade with ribs, cutting edge with teeth, spikes, hazard stripes, tow loop
m.section('plow')
nm = 'panel_bumper_F'
m.panel(nm, (0, 1.0, 3.95), **PAN)
NZ = 3.78
for sx in (1, -1):
    m.hull('armor', [(0.0, 0.5, 4.16), (0.0, 1.42, 3.98), (1.32 * sx, 0.5, 4.04), (1.32 * sx, 1.42, 3.86), (0.0, 0.5, 4.05), (0.0, 1.42, 3.88), (1.2 * sx, 0.5, NZ + 0.02), (1.2 * sx, 1.42, NZ)],
           bevel=0.02, seg=1, obj=nm)
    m.hull('armor', [(1.32 * sx, 0.5, 4.06), (1.32 * sx, 1.42, 3.86), (1.5 * sx, 0.55, 3.72), (1.5 * sx, 1.35, 3.62), (1.2 * sx, 0.5, NZ), (1.2 * sx, 1.42, NZ)],
           bevel=0.015, seg=1, obj=nm)                                                                                    # wing
    for i in range(3):                                                                                               # vertical ribs
        x = sx * (0.3 + i * 0.4)
        zf = 4.16 - (abs(x) / 1.32) * 0.12
        m.beam('armor', (x, 0.55, zf + 0.02), (x, 1.38, zf - 0.2), 0.05, 0.05, bevel=0, seg=1, obj=nm)
    spike2(m, (1.45 * sx, 1.36, 3.66), (1.621 * sx, 1.38, 3.94), 0.05, obj=nm)
    spike2(m, (1.42 * sx, 0.72, 3.74), (1.621 * sx, 0.7, 3.98), 0.05, obj=nm)
    for i in range(10):                                                                                              # hazard stripes
        x = sx * (0.12 + i * 0.12)
        zf = 4.16 - (abs(x) / 1.32) * 0.12
        m.box('decal_yellow', (0.05, 0.22, 0.01), at=(x, 1.28, zf - 0.155), rot=(-14, 0, 32 * sx), bevel=0, seg=1, obj=nm)
m.bead('armor', [(0.0, 0.52, 4.17), (0.0, 1.4, 4.0)], r=0.01, obj=nm, n=(0, 0.2, 1))
m.hull('armor', [(-1.34, 0.44, 4.06), (1.34, 0.44, 4.06), (-1.34, 0.56, 4.06), (1.34, 0.56, 4.06), (0, 0.44, 4.19), (0, 0.56, 4.19), (-1.3, 0.42, 3.94), (1.3, 0.42, 3.94)],
       bevel=0.01, seg=1, obj=nm)                                                                                        # cutting edge
for i in range(9):                                                                                                   # teeth
    x = -1.1 + i * 0.275
    zf = 4.19 - (abs(x) / 1.34) * 0.13
    m.hull('spike', [(x - 0.06, 0.45, zf - 0.02), (x + 0.06, 0.45, zf - 0.02), (x - 0.06, 0.53, zf - 0.02), (x + 0.06, 0.53, zf - 0.02), (x, 0.47, zf + 0.065)], bevel=0, obj=nm)
m.box('metal_dark', (2.5, 0.09, 0.09), at=(0, 1.44, 3.92), bevel=0.006, seg=1, obj=nm)
for i in range(7):
    x = -0.9 + i * 0.3
    spike2(m, (x, 1.46, 3.92), (x * 1.04, 1.8 if i % 2 == 0 else 1.66, 4.06), 0.045, obj=nm)
m.tube('armor', [(-0.4, 1.48, 3.86), (-0.55, 1.15, 4.18), (0.55, 1.15, 4.18), (0.4, 1.48, 3.86)], 0.03, seg=6, bend=0.1, bsteps=2, obj=nm)   # tow loop
m.use('body')
# armor plates on the bed sides (three per side)
zs = [(0.85, -0.66), (-0.66, -2.21), (-2.21, -3.96)]
for sx, nm in ((1, 'panel_armor_L'), (-1, 'panel_armor_R')):
    m.section('bed armor')
    m.panel(nm, (1.24 * sx, YD + 0.3, -1.55), **PAN)
    x = 1.245 * sx
    for i, (za, zb) in enumerate(zs):
        z0, z1 = zb + 0.03, za - 0.03
        mt = ('armor', 'paint2', 'rust')[i]
        pts = [(z0, YD + 0.02), (z1, YD + 0.02), (z1, YD + 0.5), (z1 - 0.15, YD + 0.56), (z0 + 0.15, YD + 0.56), (z0, YD + 0.5)]
        m.plate(mt, pts, 0.045, at=(x, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.01, seg=1, obj=nm)
        m.rivet_rect('metal_dark', (x + 0.024 * sx, YD + 0.29, (z0 + z1) / 2), z1 - z0, 0.5, (sx, 0, 0), u=(0, 0, -1), v=(0, 1, 0), step=0.26, r=0.013, inset=0.05, obj=nm)
        if i < 2:                                                                                  # (the rear plate carries the stencil instead)
            m.beam('armor', (x + 0.03 * sx, YD + 0.04, (z0 + z1) / 2), (x + 0.03 * sx, YD + 0.54, (z0 + z1) / 2), 0.09, 0.03, up=(sx, 0, 0), bevel=0, seg=1, obj=nm)
    m.bead('armor', [(x + 0.03 * sx, YD + 0.05, -0.66), (x + 0.03 * sx, YD + 0.52, -0.66)], r=0.01, obj=nm, n=(sx, 0, 0))
    m.bead('armor', [(x + 0.03 * sx, YD + 0.05, -2.21), (x + 0.03 * sx, YD + 0.52, -2.21)], r=0.01, obj=nm, n=(sx, 0, 0))
    m.box('armor', (0.07, 0.05, 4.9), at=(x + 0.02 * sx, YD + 0.56, -1.55), bevel=0.008, seg=1, obj=nm)
    firing_port(m, (x + 0.025 * sx, YD + 0.3, -1.45), (sx, 0, 0), w=0.36, h=0.08, mat='armor', obj=nm, open_=0.4)
    for zz in (0.3, -1.0, -2.9, -3.6):
        spike2(m, (x + 0.02 * sx, YD + 0.12, zz), (x + 0.2 * sx, YD + 0.08, zz + 0.04), 0.03, obj=nm)
    m.text('decal_white', 'KEEP BACK', (x + 0.026 * sx, YD + 0.28, -3.1), u=(0, 0, -sx), v=(0, 1, 0), size=0.13, depth=0.004, obj=nm)
    m.use('body')
# tailgate: armored gate, pivot at its bottom edge
m.section('tailgate')
nm = 'panel_tailgate'
m.panel(nm, (0, YD + 0.1, -4.0), **PAN)
m.box('armor', (2.4, 0.55, 0.06), at=(0, YD + 0.32, -4.0), bevel=0.012, seg=1, obj=nm)
m.rivet_rect('metal_dark', (0, YD + 0.32, -4.033), 2.4, 0.55, (0, 0, -1), u=(1, 0, 0), v=(0, 1, 0), step=0.24, r=0.013, inset=0.05, obj=nm)
for x in (-0.8, 0.0, 0.8):
    m.beam('armor', (x, YD + 0.06, -4.04), (x, YD + 0.58, -4.04), 0.09, 0.03, bevel=0, seg=1, obj=nm)
for i in range(16):
    x = -1.1 + i * 0.147
    if abs(x) < 0.12 or abs(abs(x) - 0.8) < 0.1:
        continue
    m.box('decal_yellow', (0.06, 0.4, 0.01), at=(x, YD + 0.32, -4.034), rot=(0, 0, 35), bevel=0, seg=1, obj=nm)
for sx in (1, -1):
    m.cyl('metal_dark', (1.15 * sx, YD + 0.62, -4.02), (1.15 * sx, YD + 0.62, -3.98), 0.03, seg=6, obj=nm)
    chain(m, [(1.15 * sx, YD + 0.6, -4.03), (1.22 * sx, YD + 0.95, -3.98)], link=0.05, wire=0.007, obj=nm)
m.use('body')
# rear bumper with pintle hook and spikes
m.section('bumper R')
nm = 'panel_bumper_R'
m.panel(nm, (0, 0.9, -4.08), **PAN)
m.hull('armor', [(-1.24, 0.72, -4.02), (1.24, 0.72, -4.02), (-1.24, 1.2, -4.02), (1.24, 1.2, -4.02), (-1.2, 0.72, -4.2), (1.2, 0.72, -4.2), (-1.2, 1.2, -4.14), (1.2, 1.2, -4.14)],
       bevel=0.02, seg=1, obj=nm)
m.rivet_line('metal_dark', (-1.1, 1.14, -4.16), (1.1, 1.14, -4.16), (0, 0, -1), step=0.2, r=0.013, obj=nm)
m.box('metal_dark', (0.24, 0.2, 0.14), at=(0, 0.9, -4.26), bevel=0.01, seg=1, obj=nm)
m.tube('metal_dark', [(0.0, 0.94, -4.3), (0.0, 0.94, -4.4), (0.0, 0.84, -4.42), (0.0, 0.8, -4.36)], 0.03, seg=6, bend=0.04, bsteps=2, obj=nm)     # pintle hook
for sx in (1, -1):
    spike2(m, (1.2 * sx, 0.95, -4.16), (1.35 * sx, 0.95, -4.42), 0.05, obj=nm)
    m.tube('armor', [(0.5 * sx, 0.8, -4.12), (0.5 * sx, 0.76, -4.4), (0.35 * sx, 0.78, -4.4)], 0.028, seg=6, bend=0.05, bsteps=2, obj=nm)
m.use('body')
# tandem wheel arch lips + mud flaps (body)
m.section('arches')
for sx in (1, -1):
    for zc in (ZM, ZR):
        po = [(zc + 0.84 * math.cos(t * D2R), HUBY + 0.84 * math.sin(t * D2R)) for t in range(30, 151, 20)]
        pi_ = [(zc + 0.74 * math.cos(t * D2R), HUBY + 0.74 * math.sin(t * D2R)) for t in range(150, 29, -20)]
        m.plate('armor', po + pi_, 0.07, at=(1.27 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.006, seg=1)
        for (zz, yy) in po[1:-1]:
            m.rivet('metal_dark', (1.31 * sx, yy - 0.04, zz), (sx, 0, 0), r=0.014)
    m.box('rubber_tire', (0.03, 0.5, 0.52), at=(1.2 * sx, 0.72, ZR - 0.8), rot=(6, 0, 0), bevel=0.006, seg=1)
    m.box('rubber_tire', (0.03, 0.4, 0.46), at=(1.2 * sx, 0.97, ZM + 0.8), bevel=0.006, seg=1)
add_proxies(m)
m.finish()

"""e_tanker "Fuel Bomb" (v2): armored fuel tanker (conventional day cab + dented aluminium tank inside a welded cage).  ~9.6 m.
Explodes when killed: red FLAMMABLE band, hazard placards, valves/manifold, roof gunner nest.  Game space: +X left, +Y up, +Z forward.  Driver on +X.
Run: bash tools/blender/vehicles/enemy_b/run.sh e_tanker.py     (VEH_OUT=shots/enemy_b/test for a test build, BAKE_QUICK=1 for a fast bake)"""
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts2 import *  # noqa

m = Model('e_tanker', seed=31, bake=True)
PI = math.pi
R_W, W_W, HUBY, HX = 0.58, 0.38, 0.58, 1.02
AXLES = dict(F=3.5, M=0.1, R=-1.25, R2=-3.2)
CFLOOR, ROOF = 1.4, 3.2
CAB_R, CAB_F = 1.4, 3.05
YC, A, B, NEXP = 2.28, 1.13, 1.05, 2.6
Z0, Z1, CAP = -3.6, 0.7, 0.32
YP = 3.3   # roof platform deck
m.bake_opts = dict(dirt_h=1.2, dens=165.0, wheels=[(HX, HUBY, z, R_W) for z in AXLES.values()], rust=1.0, wear=1.0,
                   max_size={'paint': 2048, 'paint2': 1024, 'armor': 2048, 'metal_dark': 2048, 'metal_bare': 2048},
                   recipes={'metal_bare': 'alu'})                      # the tank shell: dented aluminium (not 'chrome': the game darkens chrome x0.3)
m.alias.update({'plastic': 'interior', 'fabric': 'interior', 'leather': 'interior', 'spike': 'armor', 'brass': 'metal_dark',
                'rust': 'armor', 'decal_white': 'decal_yellow', 'cloth_red': 'canvas', 'wood': 'canvas', 'rim': 'metal_dark'})
m.objs['body'].alias = {'rubber_tire': 'metal_dark', 'decal_yellow': 'decal_red'}
PAN = dict(metal_dark='armor', interior='armor', decal_yellow='armor', decal_red='armor', rubber_tire='armor', canvas='armor', chrome='armor')

m.section('wheels')
names = ['wheel_FL', 'wheel_FR', 'wheel_ML', 'wheel_MR', 'wheel_RL', 'wheel_RR', 'wheel_RL2', 'wheel_RR2']
pos = []
for k in ('F', 'M', 'R', 'R2'):
    pos += [(HX, HUBY, AXLES[k]), (-HX, HUBY, AXLES[k])]
wheel_set2(m, 'tk', R_W, W_W, pos, names, tread_h=0.018, style='hwy', holes=5, nuts=8, seg=24, rim_ratio=0.58, beadlock=False)


# ================================================================================ TANK SHELL (dented aluminium, the red band is its own strip of the shell)
def sup(t, a=A, b=B):
    c, s = math.cos(t), math.sin(t)
    return a * math.copysign(abs(c) ** (2 / NEXP), c), b * math.copysign(abs(s) ** (2 / NEXP), s)


DENTS = [(0.75, -0.55, 0.55, 0.035), (-0.5, -1.7, 0.45, 0.03), (2.75, -2.7, 0.6, 0.045), (3.55, -1.1, 0.5, 0.05), (1.6, -1.6, 0.7, 0.05),
         (-1.57, -1.0, 0.5, 0.035), (2.1, 0.2, 0.4, 0.03), (0.3, -3.2, 0.5, 0.035), (-2.3, -3.1, 0.45, 0.04), (0.9, 0.35, 0.3, 0.04), (2.4, -0.4, 0.35, 0.05)]


def dent_field(t, z):
    d = 0.0
    for (ti, zi, r, dp) in DENTS:
        dt = math.atan2(math.sin(t - ti), math.cos(t - ti))
        d += dp * math.exp(-((dt * 1.05) ** 2 + (z - zi) ** 2) / (2 * (r / 2) ** 2))
    return d + 0.004 * math.sin(z * 7 + t * 3) + 0.003 * math.sin(z * 17 - t * 5)


def tank_deform(p):
    x, y, z = p.x, p.y - YC, p.z
    if not (Z0 - 0.02 < z < Z1 + 0.02):
        return p
    t = math.atan2(y / B, x / A)
    d = dent_field(t, z)
    r = math.hypot(x, y)
    k = (r - d) / max(r, 1e-4)
    return Vector((x * k, y * k + YC, z))


def surf(t, z, off=0.0):
    x, y = sup(t, A + off, B + off)
    return tank_deform(Vector((x, y + YC, z)))


m.use('body')
m.section('tank')
NR = 36
ts = [2 * PI * (i + 0.5) / NR for i in range(NR)]
BAND = (-2.46, -0.74)                                            # red FLAMMABLE band


def zrings(za, zb, n):
    return [za + (zb - za) * i / n for i in range(n + 1)]


rear_head = []
for k in range(6, 0, -1):
    ph = (PI / 2) * k / 6.0
    sc = math.cos(ph)
    rear_head.append([Vector((sup(t)[0] * sc, sup(t)[1] * sc + YC, Z0 - CAP * math.sin(ph))) for t in ts])
front_head = []
for k in range(1, 7):
    ph = (PI / 2) * k / 6.0
    sc = math.cos(ph)
    front_head.append([Vector((sup(t)[0] * sc, sup(t)[1] * sc + YC, Z1 + CAP * math.sin(ph))) for t in ts])
seg_a = [[surf(t, z) for t in ts] for z in zrings(Z0, BAND[0], 10)]
seg_b = [[surf(t, z) for t in ts] for z in zrings(BAND[0], BAND[1], 11)]
seg_c = [[surf(t, z) for t in ts] for z in zrings(BAND[1], Z1, 10)]
m.sweep('metal_bare', rear_head + seg_a, caps=False, wrap=False)
m.sweep('decal_red', seg_b, caps=False)
m.sweep('metal_bare', seg_c + front_head, caps=False)


def hoop(zc, w, mat, off=0.016, n=NR):
    """raised flat hoop band around the tank (seam cover / cage ring)"""
    zs = [zc - w / 2, zc + w / 2]
    rr = [[surf(t, zs[0], -0.004) for t in ts], [surf(t, zs[0], off) for t in ts], [surf(t, zs[1], off) for t in ts], [surf(t, zs[1], -0.004) for t in ts]]
    m.sweep(mat, rr, caps=False, wrap=False)


for zc in (-3.45, BAND[0] - 0.04, BAND[1] + 0.04, 0.55):
    hoop(zc, 0.09, 'paint2')
for zc in (BAND[0] - 0.04, BAND[1] + 0.04):
    for i in range(18):
        t = 2 * PI * (i + 0.25) / 18
        p = surf(t, zc, 0.018)
        m.rivet('metal_dark', tuple(p), (math.cos(t), math.sin(t), 0), r=0.013)
for sx in (1, -1):
    m.text('decal_yellow', 'FLAMMABLE', (1.13 * sx, YC + 0.12, (BAND[0] + BAND[1]) / 2), u=(0, 0, -sx), v=(0, 1, 0), size=0.3, depth=0.01, res=2,
           wrap=lambda w, sx=sx: tank_deform(w + Vector((0.017 * sx, 0, 0))))
    # hazard placards (white border, red diamond with flame) front + rear of the band
    for zc in (-3.0, 0.1):
        s = 0.28
        c = surf(0.0 if sx > 0 else PI, zc, 0.012)
        m.plate('decal_yellow', [(0, s), (s, 0), (0, -s), (-s, 0)], 0.012, at=(c.x + 0.004 * sx, YC + 0.1, zc), u=(0, 0, -sx), v=(0, 1, 0), bevel=0, seg=1)
        m.plate('decal_red', [(0, s * 0.84), (s * 0.84, 0), (0, -s * 0.84), (-s * 0.84, 0)], 0.012, at=(c.x + 0.01 * sx, YC + 0.1, zc), u=(0, 0, -sx), v=(0, 1, 0), bevel=0, seg=1)
        m.plate('decal_yellow', [(0, 0.17), (0.08, 0.02), (0.05, -0.1), (0, -0.14), (-0.05, -0.1), (-0.08, 0.02), (-0.03, 0.08)], 0.012,
                at=(c.x + 0.016 * sx, YC + 0.08, zc), u=(0, 0, -sx), v=(0, 1, 0), bevel=0, seg=1)
# rear head: big hazard diamond + skull
m.plate('decal_yellow', [(0, 0.5), (0.5, 0), (0, -0.5), (-0.5, 0)], 0.02, at=(0, YC + 0.1, Z0 - CAP - 0.005), u=(-1, 0, 0), v=(0, 1, 0), bevel=0.004, seg=1)
m.plate('decal_red', [(0, 0.42), (0.42, 0), (0, -0.42), (-0.42, 0)], 0.022, at=(0, YC + 0.1, Z0 - CAP - 0.012), u=(-1, 0, 0), v=(0, 1, 0), bevel=0, seg=1)
skull_decal(m, (0, YC + 0.12, Z0 - CAP - 0.024), (0, 0, -1), s=0.36, mat='decal_white')
m.text('decal_yellow', 'FLAMMABLE', (0, YC + 0.74, Z0 - CAP - 0.02), u=(-1, 0, 0), v=(0, 1, 0), size=0.2, depth=0.01, res=2)

# ---- welded cage around the tank: hoops + lower side skirts of scrap plate hung on them
m.section('cage')
for zc in (-3.3, BAND[0] - 0.13, BAND[1] + 0.13, 0.4):
    ring = [surf(t, zc, 0.07) for t in ts[NR - 5:] + ts[:NR // 2 + 5]]                 # over the top, down to the skirts
    ring = [tuple(p) for p in ring]
    m.tube('armor', ring, 0.028, seg=4, caps=True)
for sx in (1, -1):
    for y in (YC - 0.55, YC + 0.62):                                                       # longitudinal rails
        t = math.atan2((y - YC) / B, 1.0) if sx > 0 else PI - math.atan2((y - YC) / B, 1.0)
        p0, p1 = surf(t, -3.35, 0.08), surf(t, 0.4, 0.08)
        m.beam('armor', tuple(p0), tuple(p1), 0.05, 0.035, up=(sx, 0, 0), bevel=0, seg=1)
    # scrap skirts (lower third) with straps
    for (za, zb, mt) in ((-3.3, -2.5, 'armor'), (-0.7, 0.3, 'armor')):
        tA = 0.0 if sx > 0 else PI
        p = surf(tA - 0.5 * sx, (za + zb) / 2, 0.11)
        m.plate(mt, [(za, YC - 0.9), (zb, YC - 0.9), (zb, YC - 0.2), (za + 0.08, YC - 0.12), (za, YC - 0.2)], 0.025, at=(1.16 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.006, seg=1)
        m.rivet_line('metal_dark', (1.175 * sx, YC - 0.84, za + 0.05), (1.175 * sx, YC - 0.84, zb - 0.05), (sx, 0, 0), step=0.2, r=0.013)
        m.rivet_line('metal_dark', (1.175 * sx, YC - 0.26, za + 0.05), (1.175 * sx, YC - 0.26, zb - 0.05), (sx, 0, 0), step=0.2, r=0.013)
    for zz in (-3.25, -2.55, -0.65, 0.25):
        spike2(m, (1.17 * sx, YC - 0.5, zz), (1.37 * sx, YC - 0.52, zz - 0.05), 0.03)

# ---- tank-top hardware: manways, fuel cap, vents, catwalk + rail
m.section('tank top')
for (zc, big) in ((0.15, False), (-1.65, True), (-3.05, False)):
    ytop = YC + B - 0.02
    r = 0.34 if big else 0.27
    m.revolve('armor', [(r * 1.15, 0), (r * 1.15, 0.05), (r, 0.06), (r, 0.16)], at=(0, ytop, zc), axis='y', seg=14, closed=False)
    m.revolve('paint2', [(r * 0.98, 0.16), (r * 0.98, 0.2), (r * 0.9, 0.22), (0, 0.23)], at=(0, ytop, zc), axis='y', seg=14, closed=False)
    for i in range(6):
        a = 2 * PI * i / 6
        m.hexbolt('metal_dark', (r * 1.04 * math.cos(a), ytop + 0.05, zc + r * 1.04 * math.sin(a)), (0, 1, 0), r=0.022, h=0.025, seg=6)
    m.box('armor', (0.34, 0.06, 0.08), at=(0, ytop + 0.25, zc + r * 0.55), bevel=0.008, seg=1)
    if big:
        m.revolve('chrome', [(0.17, 0.23), (0.18, 0.3), (0.13, 0.36), (0.13, 0.4), (0, 0.4)], at=(0, ytop, zc), axis='y', seg=12, closed=False)
m.sock('fuel_cap', (0, YC + B + 0.4, -1.65))
for (x, zc) in ((0.5, -0.6), (-0.5, -2.6)):                                                          # pressure vents
    yy = YC + B * (1 - (abs(x) / A) ** NEXP) ** (1 / NEXP)
    m.cyl('chrome', (x, yy - 0.02, zc), (x, yy + 0.22, zc), 0.045, seg=8)
    m.revolve('decal_red', [(0.09, 0.2), (0.09, 0.26), (0, 0.29)], at=(x, yy, zc), axis='y', seg=8, closed=False)
for sx in (1, -1):                                                                                     # roll-over rail
    x = 0.46 * sx
    yy = YC + B * (1 - (abs(x) / A) ** NEXP) ** (1 / NEXP)
    m.tube('armor', [(x, yy + 0.34, 0.55), (x, yy + 0.34, -3.9)], 0.024, seg=6)
    for z in (0.55, -0.6, -1.65 + 0.7, -2.7, -3.9):
        m.cyl('armor', (x, yy - 0.02, z), (x, yy + 0.34, z), 0.02, seg=6)
yy0 = YC + B - 0.01
for i in range(22):                                                                                    # catwalk grating
    z = -3.7 + i * 0.2
    if abs(z + 1.65) < 0.4 or abs(z - 0.15) < 0.3 or abs(z + 3.05) < 0.3:
        continue
    m.box('metal_dark', (0.7, 0.025, 0.04), at=(0, yy0 + 0.02, z), bevel=0, seg=1)
for sx in (1, -1):
    m.box('metal_dark', (0.03, 0.05, 4.4), at=(0.36 * sx, yy0 + 0.03, -1.55), bevel=0, seg=1)
# rear ladder
ladder(m, 0.62, 1.0, [(1.4, Z0 - 0.5), (2.9, Z0 - 0.5), (3.42, Z0 - 0.15)], rung=0.22, r=0.02)

# ================================================================================ CHASSIS
m.section('chassis')
with m.tag('under'):
    for sx in (1, -1):
        m.box('metal_dark', (0.14, 0.28, 9.0), at=(0.55 * sx, 1.14, 0.0), bevel=0.008, seg=1)
    for z in (-4.5, -3.9, -2.8, -1.7, -0.6, 0.4, 1.3, 2.3, 3.2, 4.4):
        m.box('metal_dark', (1.1, 0.16, 0.12), at=(0, 1.14, z), bevel=0.005, seg=1)
    for k, zc in AXLES.items():
        m.cyl('metal_dark', (-HX + 0.25, HUBY, zc), (HX - 0.25, HUBY, zc), 0.075, seg=8)
        m.revolve('metal_dark', [(0, -0.26), (0.22, -0.23), (0.27, -0.09), (0.27, 0.09), (0.22, 0.23), (0, 0.26)], at=(0, HUBY, zc), axis='z', seg=8)
        for sx in (1, -1):
            m.box('metal_dark', (0.12, 0.05, 1.1 if k != 'F' else 1.2), at=(0.63 * sx, 0.88, zc), bevel=0.004, seg=1)
            m.box('metal_dark', (0.12, 0.04, 0.9), at=(0.63 * sx, 0.93, zc), bevel=0.004, seg=1)
            m.box('metal_dark', (0.18, 0.2, 0.28), at=(0.63 * sx, 0.78, zc), bevel=0.01, seg=1)
    m.cyl('metal_dark', (0, 0.95, 1.4), (0, 0.88, 3.4), 0.05, seg=6)
    m.cyl('metal_dark', (0, 0.95, 0.3), (0, 0.88, -1.1), 0.05, seg=6)
    m.box('metal_dark', (0.55, 0.5, 1.2), at=(0, 1.05, 1.9), bevel=0.02, seg=1)
for z in (-3.2, -1.9, -0.6, 0.6):                                                                      # tank saddles
    m.hull('armor', [(-0.75, 1.28, z - 0.08), (0.75, 1.28, z - 0.08), (-0.75, 1.28, z + 0.08), (0.75, 1.28, z + 0.08), (-0.95, 1.55, z), (0.95, 1.55, z), (0, 1.22, z)], bevel=0.01, seg=1)
for sx in (1, -1):
    m.box('armor', (0.5, 0.36, 1.3), at=(0.86 * sx, 0.92, -2.3), bevel=0.012, seg=1)                  # tool lockers
    m.box('metal_dark', (0.03, 0.05, 0.2), at=(1.115 * sx, 0.95, -2.3), bevel=0, seg=1)
    m.revolve('metal_dark', [(0, -0.4), (0.14, -0.38), (0.16, -0.3), (0.16, 0.3), (0.14, 0.38), (0, 0.4)], at=(0.86 * sx, 1.0, -0.55), axis='z', seg=10)   # air tanks
m.tube('metal_dark', [(-0.62, 1.95, 3.2), (-0.9, 1.6, 3.0), (-1.2, 1.32, 2.5), (-1.24, 1.32, 1.3)], 0.055, seg=6, bend=0.25, bsteps=2)
m.tube('metal_dark', [(0.62, 1.95, 3.2), (0.9, 1.6, 3.0), (1.2, 1.32, 2.5), (1.24, 1.32, 1.3)], 0.055, seg=6, bend=0.25, bsteps=2)
# fuel manifold + valves at the rear underside
m.section('manifold')
ZM_ = Z0 - CAP - 0.3
m.tube('chrome', [(-0.85, 1.42, ZM_), (0.85, 1.42, ZM_)], 0.055, seg=8)
for x in (-0.6, -0.2, 0.2, 0.6):
    m.tube('chrome', [(x, 1.42, ZM_), (x, 1.28, ZM_ + 0.05), (x * 0.9, 1.26, Z0 - CAP + 0.15)], 0.04, seg=6, bend=0.05, bsteps=2)
    m.cyl('metal_dark', (x, 1.42, ZM_ - 0.11), (x, 1.42, ZM_ + 0.11), 0.09, seg=8)
    m.cyl('metal_dark', (x, 1.42, ZM_), (x, 1.66, ZM_), 0.02, seg=5)
    m.revolve('decal_red', [(0.11, -0.014), (0.13, 0), (0.11, 0.014), (0.09, 0)], at=(x, 1.66, ZM_), axis='y', seg=10)
    m.box('decal_red', (0.02, 0.01, 0.2), at=(x, 1.665, ZM_), bevel=0)
for sx in (1, -1):
    m.cyl('chrome', (0.88 * sx, 1.42, ZM_), (1.0 * sx, 1.42, ZM_), 0.075, seg=8)
m.tube('rubber_tire', [(1.0, 1.42, ZM_), (1.12, 1.4, ZM_ + 0.1), (1.14, 1.2, ZM_ + 0.6), (1.1, 1.3, ZM_ + 1.2)], 0.05, seg=6, bend=0.15, bsteps=2)   # coiled hose

# ================================================================================ CAB
m.section('cab')


def cab_outline():
    return [(CAB_R, CFLOOR), (CAB_F, CFLOOR), (CAB_F, 2.3), (2.8, ROOF), (CAB_R, ROOF)]


door_hole = [(1.8, 1.6), (2.75, 1.6), (2.75, 3.05), (1.8, 3.05)]
for sx in (1, -1):
    m.plate('paint', cab_outline(), 0.06, at=(1.17 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.01, seg=1, holes=[door_hole])
    m.box('metal_dark', (0.07, 0.08, 1.0), at=(1.1 * sx, 1.58, 2.28), bevel=0.006, seg=1)
    with m.tag('inner'):
        m.box('interior', (0.05, 1.3, 0.86), at=(1.05 * sx, 2.4, 2.28), bevel=0)
    m.box('armor', (0.26, 0.05, 1.1), at=(1.24 * sx, 1.4, 2.28), bevel=0.01, seg=1)                  # steps
    m.box('armor', (0.26, 0.05, 0.9), at=(1.24 * sx, 0.96, 2.2), bevel=0.01, seg=1)
    m.bead('armor', [(1.205 * sx, 1.44, 1.42), (1.205 * sx, 3.16, 1.42)], r=0.008, n=(sx, 0, 0))
m.plate('armor', [(-1.2, CFLOOR), (1.2, CFLOOR), (1.2, ROOF), (-1.2, ROOF)], 0.07, at=(0, 0, CAB_R), u=(1, 0, 0), v=(0, 1, 0), bevel=0.01, seg=1,
        holes=[[(-0.45, 2.55), (0.45, 2.55), (0.45, 2.75), (-0.45, 2.75)]])
m.box('glass', (0.88, 0.18, 0.02), at=(0, 2.65, CAB_R + 0.03), bevel=0)
m.rivet_rect('metal_dark', (0, 2.3, CAB_R - 0.04), 2.3, 1.6, (0, 0, -1), u=(-1, 0, 0), v=(0, 1, 0), step=0.28, r=0.014, inset=0.06)
m.plate('paint2', [(-1.2, CAB_R), (1.2, CAB_R), (1.2, 2.85), (-1.2, 2.85)], 0.07, at=(0, ROOF + 0.0, 0), u=(1, 0, 0), v=(0, 0, 1), bevel=0.014, seg=1)
m.hull('armor', [(-1.2, ROOF - 0.02, 2.9), (1.2, ROOF - 0.02, 2.9), (-1.2, ROOF + 0.07, 2.8), (1.2, ROOF + 0.07, 2.8),
                 (-1.18, ROOF - 0.32, 3.15), (1.18, ROOF - 0.32, 3.15), (-1.18, ROOF - 0.22, 3.05), (1.18, ROOF - 0.22, 3.05)], bevel=0.02, seg=1)
m.section('windshield')
WLO, WHI = (2.3, 3.07), (ROOF - 0.05, 2.82)
WDv = Vector((0, WHI[0] - WLO[0], WHI[1] - WLO[1])).normalized()
WNv = Vector((1, 0, 0)).cross(WDv).normalized()
if WNv.z < 0:
    WNv = -WNv


def ws(f, dx, off=0.0):
    return (dx, WLO[0] + (WHI[0] - WLO[0]) * f + WNv.y * off, WLO[1] + (WHI[1] - WLO[1]) * f + WNv.z * off)


m.hull('glass', [ws(0, -1.1), ws(0, 1.1), ws(1, 1.1), ws(1, -1.1), ws(0, -1.1, -0.012), ws(0, 1.1, -0.012), ws(1, 1.1, -0.012), ws(1, -1.1, -0.012)], bevel=0, seg=1)
for sx in (1, -1):
    m.beam('paint', ws(0, 1.14 * sx, 0.02), ws(1, 1.14 * sx, 0.02), 0.13, 0.1, up=tuple(WNv), bevel=0.012, seg=1)
m.plate('armor', [(-1.12, -0.18), (1.12, -0.18), (1.12, 0.2), (-1.12, 0.2)], 0.022, at=ws(0.78, 0, 0.06), u=(1, 0, 0), v=tuple(WDv), bevel=0.006, seg=1,
        holes=[[(-0.95, -0.03), (-0.12, -0.03), (-0.12, 0.03), (-0.95, 0.03)], [(0.12, -0.03), (0.95, -0.03), (0.95, 0.03), (0.12, 0.03)]])
m.rivet_rect('metal_dark', ws(0.78, 0, 0.074), 2.2, 0.34, tuple(WNv), u=(1, 0, 0), v=tuple(WDv), step=0.26, r=0.012, inset=0.03)
mesh_screen(m, ws(0.3, 0, 0.05), (1, 0, 0), tuple(WDv), 2.14, 0.5, pitch=0.1, r=0.006, mat='metal_dark', frame=0.035, frame_mat='armor', obj='body')
m.box('metal_dark', (2.2, 0.75, 0.06), at=(0, 1.9, CAB_F - 0.03), bevel=0.006, seg=1)
m.box('paint2', (2.44, 0.06, 0.16), at=(0, 2.3, CAB_F - 0.02), bevel=0.01, seg=1)
# interior
m.section('interior')
with m.tag('inner'):
    m.box('interior', (2.3, 0.08, 1.6), at=(0, CFLOOR + 0.06, 2.2), bevel=0)
bucket_seat2(m, (0.5, 1.95, 1.95), w=0.55, cover='leather')
bucket_seat2(m, (-0.5, 1.95, 1.95), w=0.55, cover='leather', torn=False)
m.hull('interior', [(-1.1, 1.9, 3.05), (1.1, 1.9, 3.05), (-1.1, 2.25, 3.0), (1.1, 2.25, 3.0), (-1.1, 2.18, 2.6), (1.1, 2.18, 2.6), (-1.1, 1.65, 2.6), (1.1, 1.65, 2.6)],
       bevel=0.03, seg=1)
m.box('interior', (0.55, 0.2, 0.24), at=(0.5, 2.34, 2.66), bevel=0.02, seg=1)
gauge_cluster(m, (0.5, 2.33, 2.535), n=(0, 0.25, -1), w=0.42, count=3)
steering_wheel2(m, (0.5, 2.48, 2.58), tilt=40, r=0.24, mat='leather')
m.box('interior', (0.6, 0.3, 0.6), at=(0, 1.72, 2.0), bevel=0.02, seg=1)
m.cyl('metal_dark', (0.05, 1.6, 2.35), (0.08, 2.0, 2.2), 0.012, seg=6)
m.box('decal_red', (0.14, 0.14, 0.14), at=(-0.6, 2.33, 2.85), rot=(0, 20, 0), bevel=0.02, seg=1)       # jerrycan on the dash (why not)
m.sock('seat_driver', (0.5, 1.95, 1.95))
m.sock('camera_hood', (0, 2.55, 3.6))
# roof gunner nest: armored deck, sandbags, railing, spotlights, ladder up the back
m.section('nest')
for sx in (1, -1):
    for z in (1.55, 2.65):
        m.box('armor', (0.1, 0.13, 0.1), at=(0.9 * sx, ROOF + 0.12, z), bevel=0.008, seg=1)
m.box('armor', (2.05, 0.06, 1.35), at=(0, YP + 0.01, 2.08), bevel=0.01, seg=1)
for i in range(6):
    m.box('armor', (2.0, 0.012, 0.04), at=(0, YP + 0.045, 1.55 + i * 0.2), bevel=0)
m.rivet_rect('metal_dark', (0, YP + 0.04, 2.08), 2.05, 1.35, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.26, r=0.013, inset=0.05)
m.sock('seat_gunner', (0, YP + 0.05, 2.02))
m.sock('roof_top', (0, YP + 0.05, 2.02))
railing(m, [(0.95, YP + 0.04, 1.45), (-0.95, YP + 0.04, 1.45)], h=1.0, r=0.024, post_step=0.95, rails=(0.5, 1.0), mat='armor')
for sx in (1, -1):
    railing(m, [(0.95 * sx, YP + 0.04, 2.68), (0.95 * sx, YP + 0.04, 1.45)], h=1.0, r=0.024, post_step=1.3, rails=(0.5, 1.0), mat='armor')
sandbag_ring(m, [(-0.95, 2.6), (0.95, 2.6)], YP + 0.04, rows=3, L=0.5, D=0.3, H=0.15)
sandbag_ring(m, [(0.88, 2.3), (0.88, 1.8)], YP + 0.04, rows=2, L=0.5, D=0.28, H=0.15)
sandbag_ring(m, [(-0.88, 2.3), (-0.88, 1.8)], YP + 0.04, rows=2, L=0.5, D=0.28, H=0.15)
m.plate('armor', [(-0.5, 0.0), (0.5, 0.0), (0.46, 0.34), (0.08, 0.34), (0.05, 0.26), (-0.05, 0.26), (-0.08, 0.34), (-0.46, 0.34)], 0.02,
        at=(0, YP + 0.42, 2.78), u=(1, 0, 0), v=(0, 0.97, 0.26), bevel=0.004, seg=1)                     # shield on the sandbags
for x in (-0.55, 0.55):
    spot2(m, (x, YP + 0.3, 2.84), n=(0, 0, 1), r=0.1)
ammo_can(m, (0.6, YP + 0.04, 1.65), yaw=90, mat='paint2')
ammo_can(m, (-0.62, YP + 0.04, 1.62), yaw=80, mat='paint2')
ladder(m, 0.3, -0.3, [(1.55, CAB_R - 0.18), (3.3, CAB_R - 0.18)], rung=0.24, r=0.02)
m.tube('metal_dark', [(1.15, YP, 1.5), (1.17, YP + 0.9, 1.45), (1.16, YP + 1.55, 1.4)], 0.011, seg=5, r_end=0.004)
flag(m, (1.16, YP + 1.53, 1.38), length=0.4, height=0.2, direction=(0, 0, -1), mat='cloth_red')

# ================================================================================ ENGINE BAY
m.section('engine')
m.hull('metal_dark', [(-0.45, 1.5, 3.2), (0.45, 1.5, 3.2), (-0.45, 2.0, 3.25), (0.45, 2.0, 3.25), (-0.45, 1.5, 4.0), (0.45, 1.5, 4.0), (-0.45, 1.95, 3.95), (0.45, 1.95, 3.95)], bevel=0.01, seg=1)
for sx in (1, -1):
    m.box('armor', (0.2, 0.12, 0.7), at=(0.25 * sx, 2.06, 3.6), bevel=0.01, seg=1)
m.revolve('metal_dark', [(0, 0), (0.1, 0.02), (0.1, 0.34), (0, 0.36)], at=(-0.3, 2.06, 3.3), axis='y', seg=8)
m.box('metal_dark', (1.5, 0.9, 0.1), at=(0, 1.85, 4.3), bevel=0.006, seg=1)
m.cyl('metal_dark', (0, 1.85, 4.05), (0, 1.85, 4.25), 0.36, seg=10)
m.sock('smoke_engine', (0, 2.05, 3.8))
# big grille (body): chrome shell, vertical bars, gang skull welded on
m.section('grille')
m.box('chrome', (1.46, 0.98, 0.08), at=(0, 1.88, 4.43), bevel=0.02, seg=1)
for i in range(13):
    x = -0.6 + i * 0.1
    m.box('metal_dark', (0.035, 0.82, 0.04), at=(x, 1.88, 4.48), bevel=0, seg=1)
skull2(m, (0, 1.96, 4.5), s=0.55, n=(0, 0, 1), horns=True, mat='plastic', horn_mat='chrome')

# ================================================================================ LIGHTS
m.section('lights')
for sx in (1, -1):
    lamp_bucket(m, (0.92 * sx, 2.05, 4.47), 0.15, n=(0, 0, 1), cage=3 if sx < 0 else 0, tape=sx > 0, housing='chrome')
    light_rect(m, (1.15 * sx, 1.7, 4.4), (0.12, 0.08), 'light_amber', n=(0, 0, 1))
    for j, yy in enumerate((1.52, 1.78)):
        taillight2(m, (1.08 * sx, yy, ZM_ - 0.28), 0.16, 0.14, n=(0, 0, -1), cage=(j == 0))
    light_rect(m, (1.08 * sx, 1.28, ZM_ - 0.28), (0.14, 0.08), 'light_amber', n=(0, 0, -1), depth=0.1)
    for zc in (0.3, -1.3, -2.9):
        m.box('light_amber', (0.03, 0.05, 0.1), at=(1.13 * sx, 1.35, zc), bevel=0.005, seg=1)             # side markers
m.sock('light_head_L', (0.92, 2.05, 4.56))
m.sock('light_head_R', (-0.92, 2.05, 4.56))
m.sock('light_tail_L', (1.08, 1.6, ZM_ - 0.3))
m.sock('light_tail_R', (-1.08, 1.6, ZM_ - 0.3))
m.sock('nitro_L', (0.5, 0.9, ZM_ - 0.4))
m.sock('nitro_R', (-0.5, 0.9, ZM_ - 0.4))
m.sock('exhaust_L', (1.27, 4.25, 1.28))
m.sock('exhaust_R', (-1.27, 4.25, 1.28))

# ================================================================================ PANELS
m.section('hood')
m.panel('panel_hood', (0, 2.42, 3.07), **PAN)
m.hull('paint', [(-0.74, 2.3, 3.09), (0.74, 2.3, 3.09), (-0.74, 2.44, 3.09), (0.74, 2.44, 3.09), (-0.72, 2.2, 4.42), (0.72, 2.2, 4.42), (-0.72, 1.8, 4.44), (0.72, 1.8, 4.44)],
       bevel=0.025, seg=1, obj='panel_hood')
m.hull('paint', [(-0.5, 2.4, 3.3), (0.5, 2.4, 3.3), (-0.4, 2.56, 3.4), (0.4, 2.56, 3.4), (-0.4, 2.5, 4.0), (0.4, 2.5, 4.0), (-0.5, 2.3, 4.1), (0.5, 2.3, 4.1)],
       bevel=0.02, seg=1, obj='panel_hood')
m.plate('armor', [(-0.45, 0.0), (0.45, 0.0), (0.45, 0.5), (-0.45, 0.5)], 0.02, at=(0, 2.52, 3.32), u=(1, 0, 0), v=(0, -0.06, 1), bevel=0.004, seg=1, obj='panel_hood')
m.rivet_rect('metal_dark', (0, 2.535, 3.57), 0.9, 0.5, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.15, r=0.012, inset=0.03, obj='panel_hood')
patch_plate(m, (0.55, 2.36, 3.9), (0.3, 0.95, 0.1), 0.26, 0.3, mat='rust', up=(0, 0, 1), t=0.008, obj='panel_hood', bolts=4, bead=False)
for sx in (1, -1):
    m.cyl('metal_dark', (0.3 * sx, 2.44, 3.09), (0.6 * sx, 2.44, 3.09), 0.03, seg=8, obj='panel_hood')
    m.box('armor', (0.03, 0.42, 0.9), at=(0.74 * sx, 2.1, 3.9), rot=(0, 0, 0), bevel=0.006, seg=1, obj='panel_hood')     # side armor cheeks
m.use('body')
for sx, nm in ((1, 'panel_door_L'), (-1, 'panel_door_R')):
    m.section('doors')
    m.panel(nm, (1.2 * sx, 2.3, 2.75), **PAN)
    outer = [(1.82, 1.62), (2.73, 1.62), (2.73, 3.03), (1.82, 3.03)]
    win = [(2.0, 2.5), (2.55, 2.5), (2.55, 2.95), (2.0, 2.95)]
    m.plate('paint', outer, 0.07, at=(1.2 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.012, seg=1, holes=[win], obj=nm)
    m.box('glass', (0.02, 0.45, 0.55), at=(1.2 * sx, 2.72, 2.28), bevel=0, obj=nm)
    m.box('interior', (0.03, 0.8, 0.85), at=(1.15 * sx, 2.02, 2.28), bevel=0.02, seg=1, obj=nm)
    mesh_screen(m, (1.22 * sx, 2.72, 2.28), (0, 0, 1), (0, 1, 0), 0.55, 0.45, pitch=0.09, r=0.005, frame=0.028, frame_mat='armor', obj=nm)
    m.box('armor', (0.12, 0.05, 0.62), at=(1.27 * sx, 2.99, 2.28), rot=(0, 0, -14 * sx), bevel=0.008, seg=1, obj=nm)
    m.box('chrome', (0.06, 0.03, 0.18), at=(1.28 * sx, 2.25, 1.88), bevel=0.008, seg=1, obj=nm)
    for y in (1.9, 2.75):
        m.cyl('metal_dark', (1.2 * sx, y, 2.75), (1.2 * sx, y + 0.14, 2.75), 0.03, seg=8, obj=nm)
    m.tube('metal_dark', [(1.26 * sx, 2.95, 2.72), (1.52 * sx, 3.05, 2.78), (1.52 * sx, 2.62, 2.78), (1.26 * sx, 2.5, 2.72)], 0.012, seg=5, obj=nm)
    m.box('metal_dark', (0.05, 0.38, 0.2), at=(1.54 * sx, 2.84, 2.8), bevel=0.012, seg=1, obj=nm)
    m.box('chrome', (0.008, 0.34, 0.16), at=(1.54 * sx, 2.84, 2.7), bevel=0, seg=1, obj=nm)
    m.use('body')


def arch(zc, r, cy, y0, n=8):
    t0 = math.asin(max(min((y0 - cy) / r, 1), -1))
    return [(zc + r * math.cos(PI - t0 - (PI - 2 * t0) * i / n), cy + r * math.sin(PI - t0 - (PI - 2 * t0) * i / n)) for i in range(n + 1)]


for sx, nm in ((1, 'panel_fender_L'), (-1, 'panel_fender_R')):
    m.section('fenders')
    m.panel(nm, (1.05 * sx, 1.7, 3.5), **PAN)
    ol = [(2.9, 1.0)] + arch(3.5, 0.74, HUBY, 1.0) + [(4.2, 1.0), (4.52, 1.0), (4.56, 1.4), (4.5, 1.82), (2.9, 1.82)]
    m.plate('paint', ol, 0.06, at=(1.22 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.01, seg=1, obj=nm)
    m.hull('paint', [(0.74 * sx, 1.86, 2.9), (1.24 * sx, 1.86, 2.9), (0.74 * sx, 1.86, 4.54), (1.24 * sx, 1.86, 4.54), (0.74 * sx, 1.76, 2.9), (1.24 * sx, 1.76, 2.9),
                     (0.74 * sx, 1.8, 4.54), (1.24 * sx, 1.8, 4.54)], bevel=0.02, seg=1, obj=nm)
    po = [(3.5 + 0.8 * math.cos(t * D2R), HUBY + 0.8 * math.sin(t * D2R)) for t in range(22, 159, 17)]
    pi_ = [(3.5 + 0.7 * math.cos(t * D2R), HUBY + 0.7 * math.sin(t * D2R)) for t in range(158, 21, -17)]
    m.plate('armor', po + pi_, 0.08, at=(1.25 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.006, seg=1, obj=nm)
    for (zz, yy) in po[1:-1]:
        m.hexbolt('metal_dark', (1.295 * sx, yy - 0.04, zz), (sx, 0, 0), r=0.014, h=0.012, obj=nm)
    m.rivet_line('metal_dark', (1.25 * sx, 1.865, 3.0), (1.25 * sx, 1.865, 4.45), (0, 1, 0), step=0.22, r=0.013, obj=nm)
    m.use('body')
# bull-bar bumper with spikes
m.section('bullbar')
nm = 'panel_bumper_F'
m.panel(nm, (0, 0.9, 4.75), **PAN)
m.hull('armor', [(-1.24, 0.5, 4.72), (1.24, 0.5, 4.72), (-1.24, 1.05, 4.72), (1.24, 1.05, 4.72), (-1.2, 0.5, 4.95), (1.2, 0.5, 4.95), (-1.2, 1.05, 4.9), (1.2, 1.05, 4.9)],
       bevel=0.02, seg=1, obj=nm)
m.rivet_line('metal_dark', (-1.1, 0.98, 4.93), (1.1, 0.98, 4.93), (0, 0.1, 1), step=0.2, r=0.013, obj=nm)
for i in range(12):
    m.box('decal_yellow', (0.07, 0.3, 0.01), at=(-1.05 + i * 0.19, 0.74, 4.955), rot=(0, 0, 36), bevel=0, seg=1, obj=nm)
for i in range(7):
    x = -0.9 + i * 0.3
    m.beam('armor', (x, 1.05, 4.82), (x * 0.97, 2.35, 4.6), 0.06, 0.05, bevel=0, seg=1, obj=nm)
m.beam('armor', (-0.96, 1.5, 4.76), (0.96, 1.5, 4.76), 0.1, 0.07, bevel=0.01, seg=1, obj=nm)
m.beam('armor', (-0.96, 2.32, 4.62), (0.96, 2.32, 4.62), 0.09, 0.07, bevel=0.01, seg=1, obj=nm)
for sx in (1, -1):
    m.beam('armor', (1.0 * sx, 1.0, 4.82), (1.0 * sx, 2.3, 4.62), 0.1, 0.07, bevel=0.01, seg=1, obj=nm)
    spike2(m, (1.0 * sx, 2.32, 4.62), (1.02 * sx, 2.75, 4.72), 0.05, obj=nm)
    spike2(m, (1.24 * sx, 0.8, 4.85), (1.5 * sx, 0.8, 5.05), 0.055, obj=nm)
for i in range(5):
    x = -0.6 + i * 0.3
    spike2(m, (x, 0.85, 4.95), (x, 0.86, 5.2 if i % 2 == 0 else 5.08), 0.045, obj=nm)
m.use('body')
# cab armor plates (bolted on the door sides)
for sx, nm in ((1, 'panel_armor_L'), (-1, 'panel_armor_R')):
    m.section('cab armor')
    m.panel(nm, (1.3 * sx, 2.3, 2.3), **PAN)
    m.plate('armor', [(1.85, 2.15), (2.7, 2.15), (2.7, 2.35), (2.6, 2.45), (1.95, 2.45), (1.85, 2.35)], 0.04, at=(1.235 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.008, seg=1, obj=nm)
    m.rivet_rect('metal_dark', (1.257 * sx, 2.3, 2.28), 0.85, 0.3, (sx, 0, 0), u=(0, 0, -1), v=(0, 1, 0), step=0.16, r=0.012, inset=0.04, obj=nm)
    m.plate('armor', [(1.42, 1.5), (1.78, 1.5), (1.78, 3.1), (1.42, 3.1)], 0.04, at=(1.225 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.008, seg=1, obj=nm)
    m.rivet_line('metal_dark', (1.247 * sx, 1.56, 1.46), (1.247 * sx, 3.04, 1.46), (sx, 0, 0), step=0.2, r=0.012, obj=nm)
    m.rivet_line('metal_dark', (1.247 * sx, 1.56, 1.74), (1.247 * sx, 3.04, 1.74), (sx, 0, 0), step=0.2, r=0.012, obj=nm)
    m.bead('armor', [(1.26 * sx, 2.16, 1.83), (1.26 * sx, 2.44, 1.83)], r=0.01, obj=nm, n=(sx, 0, 0))
    m.use('body')
# dual chrome stacks (detachable)
for sx, nm in ((1, 'panel_stack_L'), (-1, 'panel_stack_R')):
    m.section('stacks')
    m.panel(nm, (1.28 * sx, 1.4, 1.28), metal_dark='chrome', metal_bare='chrome', armor='chrome')
    exhaust_stack2(m, (1.28 * sx, 1.32, 1.28), (1.28 * sx, 4.2, 1.28), r=0.095, mat='chrome', obj=nm, seg=10)
    for y in (1.9, 2.7, 3.5):
        m.box('chrome', (0.1, 0.05, 0.22), at=(1.2 * sx, y, 1.32), bevel=0, obj=nm)
    m.use('body')
# rear bumper / ICC bar with spikes
m.section('bumper R')
nm = 'panel_bumper_R'
m.panel(nm, (0, 0.9, ZM_ - 0.45), **PAN)
zb = ZM_ - 0.42
m.hull('armor', [(-1.22, 0.72, zb), (1.22, 0.72, zb), (-1.22, 1.15, zb), (1.22, 1.15, zb), (-1.18, 0.72, zb - 0.16), (1.18, 0.72, zb - 0.16), (-1.18, 1.15, zb - 0.1), (1.18, 1.15, zb - 0.1)],
       bevel=0.02, seg=1, obj=nm)
m.rivet_line('metal_dark', (-1.1, 1.08, zb - 0.13), (1.1, 1.08, zb - 0.13), (0, 0, -1), step=0.2, r=0.013, obj=nm)
for i in range(12):
    m.box('decal_yellow', (0.07, 0.26, 0.01), at=(-1.05 + i * 0.19, 0.9, zb - 0.165), rot=(0, 0, 36), bevel=0, seg=1, obj=nm)
for sx in (1, -1):
    spike2(m, (1.18 * sx, 0.93, zb - 0.12), (1.32 * sx, 0.93, zb - 0.36), 0.05, obj=nm)
    spike2(m, (0.6 * sx, 0.78, zb - 0.14), (0.62 * sx, 0.74, zb - 0.34), 0.04, obj=nm)
m.use('body')
# fenders for the rear tandem + trailer axle: arch lips + mud flaps
m.section('arches')
for sx in (1, -1):
    for zc in (AXLES['M'], AXLES['R'], AXLES['R2']):
        po = [(zc + 0.76 * math.cos(t * D2R), HUBY + 0.76 * math.sin(t * D2R)) for t in range(30, 151, 20)]
        pi_ = [(zc + 0.67 * math.cos(t * D2R), HUBY + 0.67 * math.sin(t * D2R)) for t in range(150, 29, -20)]
        m.plate('armor', po + pi_, 0.07, at=(1.25 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.006, seg=1)
        for (zz, yy) in po[1:-1]:
            m.rivet('metal_dark', (1.29 * sx, yy - 0.04, zz), (sx, 0, 0), r=0.013)
    m.box('rubber_tire', (0.03, 0.44, 0.5), at=(1.2 * sx, 0.78, AXLES['R2'] - 0.72), rot=(5, 0, 0), bevel=0.006, seg=1)
add_proxies(m)
m.finish()

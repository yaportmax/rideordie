"""e_tanker "Fuel Bomb": armored fuel tanker (day cab + dented aluminium tank), ~9.6 m.  Explodes when killed: red FLAMMABLE band,
hazard diamonds, valves/manifold, roof gunner platform.  Game space: +X left, +Y up, +Z forward.  Driver on +X.
Run: blender -b --factory-startup -P tools/blender/vehicles/enemy_b/e_tanker.py"""
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts import *  # noqa

m = Model('e_tanker', seed=31)
m.alias.update({'metal_bare': 'armor', 'wood': 'paint2', 'fabric': 'metal_dark', 'interior': 'metal_dark', 'rust': 'armor', 'spike': 'armor',
                'leather': 'metal_dark', 'rim': 'metal_dark', 'brass': 'metal_dark', 'cloth_red': 'decal_red'})
PI = math.pi
R_W, W_W, HUBY, HX = 0.58, 0.38, 0.58, 1.02
AXLES = dict(F=3.5, M=0.1, R=-1.25, R2=-3.2)
CFLOOR, ROOF = 1.4, 3.2
CAB_R, CAB_F = 1.4, 3.05
YC, A, B, NEXP = 2.28, 1.13, 1.05, 2.6
Z0, Z1, CAP = -3.6, 0.7, 0.32
YP = 3.3   # roof platform deck

names = ['wheel_FL', 'wheel_FR', 'wheel_ML', 'wheel_MR', 'wheel_RL', 'wheel_RR', 'wheel_RL2', 'wheel_RR2']
pos = []
for k in ('F', 'M', 'R', 'R2'):
    pos += [(HX, HUBY, AXLES[k]), (-HX, HUBY, AXLES[k])]
wheel_set(m, 'tk', R_W, W_W, pos, names, rim_ratio=0.56, lugs=17, spl=3, tread_h=0.04, nuts=10, ribs=8, lug_skew=1.5, dish=0.46)

# ================================================================================ TANK SHELL (dented aluminium)
def sup(t, a=A, b=B):
    c, s = math.cos(t), math.sin(t)
    return a * math.copysign(abs(c) ** (2 / NEXP), c), b * math.copysign(abs(s) ** (2 / NEXP), s)


DENTS = [(0.75, -0.55, 0.55, 0.035), (-0.5, -1.7, 0.45, 0.03), (2.75, -2.7, 0.6, 0.045), (3.55, -1.1, 0.5, 0.05), (1.6, -1.6, 0.7, 0.05),
         (-1.57, -1.0, 0.5, 0.035), (2.1, 0.2, 0.4, 0.03), (0.3, -3.2, 0.5, 0.035), (-2.3, -3.1, 0.45, 0.04)]


def dent_field(t, z):
    d = 0.0
    for (ti, zi, r, dp) in DENTS:
        dt = math.atan2(math.sin(t - ti), math.cos(t - ti))
        d += dp * math.exp(-((dt * 1.05) ** 2 + (z - zi) ** 2) / (2 * (r / 2) ** 2))
    return d + 0.0045 * math.sin(z * 7 + t * 3) + 0.003 * math.sin(z * 17 - t * 5)


def tank_deform(p):
    x, y, z = p.x, p.y - YC, p.z
    if Z0 - 0.02 < z < Z1 + 0.02:
        t = math.atan2(y / B, x / A)
        d = dent_field(t, z)
    else:
        return p
    r = math.hypot(x, y)
    k = (r - d) / max(r, 1e-4)
    return Vector((x * k, y * k + YC, z))


def surf(t, z, off=0.0):
    x, y = sup(t, A + off, B + off)
    return tank_deform(Vector((x, y + YC, z)))


NR = 44
ts = [2 * PI * i / NR for i in range(NR)]
rings = []
for k in range(6, 0, -1):                       # rear head (dished)
    ph = (PI / 2) * k / 7.0
    sc = math.cos(ph)
    rings.append([Vector((sup(t)[0] * sc, sup(t)[1] * sc + YC, Z0 - CAP * math.sin(ph))) for t in ts])
NZ = 50
for i in range(NZ + 1):
    z = Z0 + (Z1 - Z0) * i / NZ
    rings.append([surf(t, z) for t in ts])
for k in range(1, 7):                            # front head
    ph = (PI / 2) * k / 7.0
    sc = math.cos(ph)
    rings.append([Vector((sup(t)[0] * sc, sup(t)[1] * sc + YC, Z1 + CAP * math.sin(ph))) for t in ts])
m.use('body')
m.sweep('chrome', rings, caps=True)


def band(zc, w, mat, off=0.014):
    nseg = max(int(w / 0.09), 1)
    zs = [zc - w / 2 + w * i / nseg for i in range(nseg + 1)]
    rr = [[surf(t, zs[0], -0.006) for t in ts]] + [[surf(t, z, off) for t in ts] for z in zs] + [[surf(t, zs[-1], -0.006) for t in ts]]
    m.sweep(mat, rr, caps=False, wrap=True)


def hoop_rivets(zc, w, mat, off=0.014, n=24):
    for side in (-1, 1):
        for i in range(n):
            t = 2 * PI * (i + 0.5 * (side > 0)) / n
            p = surf(t, zc + side * (w / 2 - 0.02), off)
            nx, ny = sup(t, A + off, B + off)
            nrm = Vector((nx / A ** 2 if False else math.cos(t), math.sin(t) * 1.0, 0))
            m.rivet(mat, p, (nrm.x, nrm.y, 0), r=0.014)


for zc in (0.42, -2.85, -3.4):
    band(zc, 0.14, 'paint2')
hoop_rivets(0.42, 0.14, 'paint2'); hoop_rivets(-2.85, 0.14, 'paint2')
band(-1.6, 1.75, 'decal_red', off=0.01)                          # the big red FLAMMABLE band
for sx in (1, -1):
    m.text('plastic', 'FLAMMABLE', (1.14 * sx, YC + 0.05, -1.6), u=(0, 0, -sx), v=(0, 1, 0), size=0.27, depth=0.012, wrap=lambda w, sx=sx: tank_deform(w + Vector((0.0165 * sx, 0, 0))))
    m.text('plastic', 'DANGER', (1.14 * sx, YC - 0.34, -1.6), u=(0, 0, -sx), v=(0, 1, 0), size=0.2, depth=0.012, wrap=lambda w, sx=sx: tank_deform(w + Vector((0.0165 * sx, 0, 0))))
    m.text('plastic', 'HIGHLY', (1.14 * sx, YC + 0.4, -1.6), u=(0, 0, -sx), v=(0, 1, 0), size=0.14, depth=0.012, wrap=lambda w, sx=sx: tank_deform(w + Vector((0.0165 * sx, 0, 0))))
    # hazard diamond placards (white border, red diamond, white flame) on both sides
    for (zc, yc2) in ((-2.95, YC + 0.1), (0.05, YC + 0.1)):
        s = 0.30
        m.plate('plastic', [(0, s), (s, 0), (0, -s), (-s, 0)], 0.014, at=(1.155 * sx, yc2, zc), u=(0, 0, -sx), v=(0, 1, 0), bevel=0.004, seg=1)
        m.plate('decal_red', [(0, s * 0.86), (s * 0.86, 0), (0, -s * 0.86), (-s * 0.86, 0)], 0.016, at=(1.16 * sx, yc2, zc), u=(0, 0, -sx), v=(0, 1, 0), bevel=0.002, seg=1)
        m.plate('plastic', [(0, 0.2), (0.09, 0.02), (0.06, -0.12), (0, -0.16), (-0.06, -0.12), (-0.09, 0.02), (-0.03, 0.09)], 0.018, at=(1.164 * sx, yc2 - 0.02, zc), u=(0, 0, -sx), v=(0, 1, 0), bevel=0.0, seg=1)
        m.text('plastic', '1203', (1.166 * sx, yc2 - 0.24, zc), u=(0, 0, -sx), v=(0, 1, 0), size=0.09, depth=0.008)
# rear head: yellow diamond + skull-like warning
m.plate('decal_yellow', [(0, 0.5), (0.5, 0), (0, -0.5), (-0.5, 0)], 0.02, at=(0, YC + 0.1, Z0 - CAP - 0.005), u=(-1, 0, 0), v=(0, 1, 0), bevel=0.006, seg=1)
m.plate('decal_red', [(0, 0.42), (0.42, 0), (0, -0.42), (-0.42, 0)], 0.022, at=(0, YC + 0.1, Z0 - CAP - 0.01), u=(-1, 0, 0), v=(0, 1, 0), bevel=0.004, seg=1)
m.plate('plastic', [(0, 0.3), (0.13, 0.03), (0.09, -0.18), (0, -0.24), (-0.09, -0.18), (-0.13, 0.03), (-0.04, 0.13)], 0.024, at=(0, YC + 0.06, Z0 - CAP - 0.02), u=(-1, 0, 0), v=(0, 1, 0), bevel=0.0, seg=1)
m.text('plastic', 'FLAMMABLE', (0, YC + 0.72, Z0 - CAP - 0.02), u=(-1, 0, 0), v=(0, 1, 0), size=0.2, depth=0.012)
m.text('plastic', 'NO SMOKING', (0, YC - 0.55, Z0 - CAP - 0.02), u=(-1, 0, 0), v=(0, 1, 0), size=0.17, depth=0.012)

# ---- tank-top hardware: manways, fuel cap, vents, rail
for (zc, big) in ((0.15, False), (-1.65, True), (-3.05, False)):
    ytop = YC + B - 0.02
    r = 0.34 if big else 0.27
    m.revolve('armor', [(0, 0), (r * 1.15, 0), (r * 1.15, 0.05), (r, 0.06), (r, 0.16), (0, 0.16)], at=(0, ytop, zc), axis='y', seg=16)
    m.revolve('paint2', [(0, 0.16), (r * 0.98, 0.16), (r * 0.98, 0.2), (r * 0.9, 0.22), (0, 0.23)], at=(0, ytop, zc), axis='y', seg=16)
    for i in range(8):
        a = 2 * PI * i / 8
        m.hexbolt('metal_dark', (r * 1.02 * math.cos(a), ytop + 0.05, zc + r * 1.02 * math.sin(a)), (0, 1, 0), r=0.024, h=0.03, seg=6)
        m.box('armor', (0.05, 0.08, 0.05), at=(r * 0.9 * math.cos(a), ytop + 0.19, zc + r * 0.9 * math.sin(a)), rot=(0, -a / D2R, 0), bevel=0) if i % 2 == 0 else None
    m.box('armor', (0.34, 0.08, 0.1), at=(0, ytop + 0.22, zc + r * 0.6), bevel=0.01, seg=1)                              # latch handle
    m.cyl('metal_dark', (r + 0.02, ytop + 0.1, zc), (r + 0.3, ytop + 0.1, zc), 0.018, seg=6) if False else None
    if big:
        m.revolve('chrome', [(0, 0.23), (0.17, 0.23), (0.18, 0.3), (0.13, 0.36), (0.13, 0.4), (0, 0.4)], at=(0, ytop, zc), axis='y', seg=14)
        m.revolve('decal_red', [(0.185, 0.3), (0.185, 0.36), (0.13, 0.4), (0.0, 0.42), (0, 0.4)], at=(0, ytop, zc), axis='y', seg=14) if False else None
m.sock('fuel_cap', (0, YC + B + 0.4, -1.65))
for (x, zc) in ((0.5, -0.6), (-0.5, -2.6), (0.45, -3.4)):                                          # pressure vents
    yy = YC + B * (1 - (abs(x) / A) ** NEXP) ** (1 / NEXP)
    m.cyl('chrome', (x, yy - 0.02, zc), (x, yy + 0.22, zc), 0.045, seg=8)
    m.revolve('decal_red', [(0, 0.22), (0.09, 0.2), (0.09, 0.26), (0, 0.29)], at=(x, yy, zc), axis='y', seg=8)
for sx in (1, -1):                                                                                 # roll-over rail along the top
    x = 0.46 * sx
    yy = YC + B * (1 - (abs(x) / A) ** NEXP) ** (1 / NEXP)
    m.tube('chrome', [(x, yy + 0.34, 0.55), (x, yy + 0.34, -4.2)], 0.024, seg=7)
    for z in (0.55, -0.6, -1.65 + 0.7, -2.7, -3.6, -4.2):
        m.cyl('chrome', (x, yy - 0.02, z), (x, yy + 0.34, z), 0.02, seg=6)
    m.tube('chrome', [(x, yy + 0.34, 0.55), (0.0, yy + 0.38, 0.6), (-x, yy + 0.34, 0.55)], 0.024, seg=7) if sx > 0 else None
# rear ladder
for x in (0.62, 1.0):
    m.tube('metal_dark', [(x, 1.4, Z0 - 0.5), (x, 2.2, Z0 - 0.5), (x, 3.0, Z0 - 0.42), (x, 3.42, Z0 - 0.15)], 0.02, seg=6, bend=0.1)
for i in range(9):
    y = 1.5 + i * 0.2
    m.cyl('metal_dark', (0.62, y, Z0 - 0.5 + (0.08 if y > 2.8 else 0)), (1.0, y, Z0 - 0.5 + (0.08 if y > 2.8 else 0)), 0.014, seg=5)

# ================================================================================ CHASSIS
for sx in (1, -1):
    m.box('metal_dark', (0.14, 0.28, 9.0), at=(0.55 * sx, 1.14, 0.0), bevel=0)
    m.box('metal_dark', (0.05, 0.05, 9.0), at=(0.55 * sx, 0.99, 0.0), bevel=0)
for z in (-4.5, -3.9, -2.8, -1.7, -0.6, 0.4, 1.3, 2.3, 3.2, 4.4):
    m.box('metal_dark', (1.1, 0.16, 0.12), at=(0, 1.14, z), bevel=0)
for k, zc in AXLES.items():
    m.cyl('metal_dark', (-HX + 0.2, HUBY, zc), (HX - 0.2, HUBY, zc), 0.075, seg=8)
    m.revolve('metal_dark', [(0, -0.26), (0.22, -0.23), (0.27, -0.09), (0.27, 0.09), (0.22, 0.23), (0, 0.26)], at=(0, HUBY, zc), axis='z', seg=12)
    for sx in (1, -1):
        m.cyl('metal_dark', (HX * sx - 0.16 * sx, HUBY, zc), (HX * sx - 0.3 * sx, HUBY, zc), 0.24, seg=12)
        m.box('metal_dark', (0.12, 0.05, 1.1 if k != 'F' else 1.2), at=(0.63 * sx, 0.88, zc), bevel=0)                 # leaf springs
        m.box('metal_dark', (0.12, 0.04, 0.9), at=(0.63 * sx, 0.93, zc), bevel=0)
        m.box('metal_dark', (0.18, 0.2, 0.28), at=(0.63 * sx, 0.78, zc), bevel=0)
m.cyl('metal_dark', (0, 0.95, 1.4), (0, 0.88, 3.4), 0.05, seg=8)
m.cyl('metal_dark', (0, 0.95, 0.3), (0, 0.88, -1.1), 0.05, seg=8)
m.cyl('metal_dark', (0, 0.9, -1.4), (0, 0.85, -3.6), 0.045, seg=8) if False else None
m.box('metal_dark', (0.55, 0.5, 1.2), at=(0, 1.05, 1.9), bevel=0)
m.cyl('armor', (0, 1.32, 0.75), (0, 1.36, 0.75), 0.36, seg=14)                                    # fifth-wheel plate / saddle
for sx in (1, -1):
    m.box('armor', (0.5, 0.36, 1.3), at=(0.86 * sx, 0.92, -2.35), bevel=0)                       # tool locker
    m.box('paint', (0.06, 0.32, 1.26), at=(1.13 * sx, 0.92, -2.35), bevel=0.01, seg=1) if False else None
    m.revolve('metal_dark', [(0, -0.4), (0.14, -0.38), (0.16, -0.3), (0.16, 0.3), (0.14, 0.38), (0, 0.4)], at=(0.86 * sx, 1.0, -0.55), axis='z', seg=10)   # air tanks
for zc in (-0.5, 0.3):
    m.box('armor', (0.45, 0.3, 0.55), at=(-0.9, 1.0, zc + 0.6), bevel=0) if False else None
m.tube('metal_dark', [(-0.62, 1.95, 3.2), (-0.9, 1.6, 3.0), (-1.2, 1.32, 2.5), (-1.24, 1.32, 1.3)], 0.055, seg=8, bend=0.25)
m.tube('metal_dark', [(0.62, 1.95, 3.2), (0.9, 1.6, 3.0), (1.2, 1.32, 2.5), (1.24, 1.32, 1.3)], 0.055, seg=8, bend=0.25)
# fuel manifold + valves at the rear underside
ZM_ = Z0 - CAP - 0.3
m.tube('chrome', [(-0.85, 1.42, ZM_), (0.85, 1.42, ZM_)], 0.055, seg=10)
for x in (-0.6, -0.2, 0.2, 0.6):
    m.tube('chrome', [(x, 1.42, ZM_), (x, 1.28, ZM_ + 0.05), (x * 0.9, 1.26, Z0 - CAP + 0.15)], 0.04, seg=8, bend=0.05)
    m.cyl('metal_dark', (x, 1.42, ZM_ - 0.11), (x, 1.42, ZM_ + 0.11), 0.09, seg=10)
    m.cyl('metal_dark', (x, 1.42, ZM_), (x, 1.66, ZM_), 0.02, seg=5)
    m.revolve('decal_red', [(0.11, -0.014), (0.13, 0), (0.11, 0.014), (0.09, 0)], at=(x, 1.66, ZM_), axis='y', seg=14)
    m.box('decal_red', (0.02, 0.01, 0.2), at=(x, 1.665, ZM_), bevel=0)
for sx in (1, -1):
    m.cyl('chrome', (0.88 * sx, 1.42, ZM_), (1.0 * sx, 1.42, ZM_), 0.075, seg=10)
    m.cyl('plastic', (1.0 * sx, 1.42, ZM_), (1.04 * sx, 1.42, ZM_), 0.085, seg=10) if False else None
m.tube('rubber_tire', [(1.05, 1.0, -1.8), (1.18, 1.0, -1.8), (1.18, 1.35, -2.4), (1.05, 1.35, -3.0), (1.18, 1.0, -3.0), (1.18, 1.0, -2.0)], 0.055, seg=8, bend=0.12) if False else None
# ================================================================================ CAB
def cab_outline():
    return [(CAB_R, CFLOOR), (CAB_F, CFLOOR), (CAB_F, 2.3), (2.8, ROOF), (CAB_R, ROOF)]


door_hole = [(1.8, 1.6), (2.75, 1.6), (2.75, 3.05), (1.8, 3.05)]
for sx in (1, -1):
    m.plate('paint', cab_outline(), 0.06, at=(1.17 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.012, seg=1, holes=[door_hole])
    m.box('metal_dark', (0.07, 0.08, 1.0), at=(1.1 * sx, 1.58, 2.28), bevel=0)
    m.box('metal_dark', (0.05, 1.3, 0.86), at=(1.05 * sx, 2.4, 2.28), bevel=0)
    m.box('armor', (0.24, 0.09, 1.1), at=(1.22 * sx, 1.4, 2.28), bevel=0.012, seg=1)
    m.box('armor', (0.24, 0.09, 0.9), at=(1.22 * sx, 0.96, 2.2), bevel=0.012, seg=1)
m.plate('armor', [(-1.2, CFLOOR), (1.2, CFLOOR), (1.2, ROOF), (-1.2, ROOF)], 0.07, at=(0, 0, CAB_R), u=(1, 0, 0), v=(0, 1, 0), bevel=0.012, seg=1,
        holes=[[(-0.45, 2.55), (0.45, 2.55), (0.45, 2.75), (-0.45, 2.75)]])
m.rivet_rect('armor', (0, 2.3, CAB_R - 0.04), 2.3, 1.6, (0, 0, -1), u=(-1, 0, 0), v=(0, 1, 0), step=0.22, r=0.014, inset=0.06)
m.plate('paint2', [(-1.2, CAB_R), (1.2, CAB_R), (1.2, 2.85), (-1.2, 2.85)], 0.07, at=(0, ROOF + 0.02, 0), u=(1, 0, 0), v=(0, 0, 1), bevel=0.014, seg=2)
m.hull('armor', [(-1.2, ROOF - 0.02, 2.9), (1.2, ROOF - 0.02, 2.9), (-1.2, ROOF + 0.07, 2.8), (1.2, ROOF + 0.07, 2.8),
                 (-1.18, ROOF - 0.32, 3.15), (1.18, ROOF - 0.32, 3.15), (-1.18, ROOF - 0.22, 3.05), (1.18, ROOF - 0.22, 3.05)], bevel=0.02, seg=2)
WLO, WHI = (2.3, 3.07), (ROOF - 0.05, 2.82)
def ws(f, dx):
    return (dx, WLO[0] + (WHI[0] - WLO[0]) * f, WLO[1] + (WHI[1] - WLO[1]) * f)
m.hull('glass', [ws(0, -1.1), ws(0, 1.1), ws(1, 1.1), ws(1, -1.1)] + [(x, y + 0.012, z + 0.004) for x, y, z in (ws(0, -1.1), ws(0, 1.1), ws(1, 1.1), ws(1, -1.1))], bevel=0, seg=1)
for sx in (1, -1):
    a, b = ws(0, 1.14 * sx), ws(1, 1.14 * sx)
    m.beam('paint', a, b, 0.13, 0.1, up=(0, 1, 0), bevel=0.012, seg=1)
for f in (0.3, 0.62):
    a, b = ws(f, -1.12), ws(f, 1.12)
    m.beam('armor', (a[0], a[1] + 0.03, a[2] + 0.03), (b[0], b[1] + 0.03, b[2] + 0.03), 0.07, 0.03, up=(0, 1, 0), bevel=0.006, seg=1)
for x in (-0.75, -0.25, 0.25, 0.75):
    a, b = ws(0.05, x), ws(0.95, x)
    m.beam('metal_dark', (a[0], a[1] + 0.04, a[2] + 0.04), (b[0], b[1] + 0.04, b[2] + 0.04), 0.024, 0.024, bevel=0)
m.box('metal_dark', (2.2, 0.75, 0.06), at=(0, 1.9, CAB_F - 0.03), bevel=0)
m.box('paint2', (2.44, 0.06, 0.16), at=(0, 2.3, CAB_F - 0.02), bevel=0.01, seg=1)
# interior
m.box('interior', (2.3, 0.08, 1.6), at=(0, CFLOOR + 0.06, 2.2), bevel=0)
bucket_seat(m, (0.5, 1.95, 1.95), w=0.55)
bucket_seat(m, (-0.5, 1.95, 1.95), w=0.55)
m.hull('interior', [(-1.1, 1.9, 3.05), (1.1, 1.9, 3.05), (-1.1, 2.25, 3.0), (1.1, 2.25, 3.0), (-1.1, 2.18, 2.6), (1.1, 2.18, 2.6), (-1.1, 1.65, 2.6), (1.1, 1.65, 2.6)], bevel=0.03, seg=2)
m.box('interior', (0.55, 0.22, 0.24), at=(0.5, 2.36, 2.62), bevel=0.02, seg=1)
for gx in (0.36, 0.62):
    m.revolve('light_amber', [(0, 0.012), (0.04, 0.008), (0.04, 0.0), (0, 0.0)], at=(gx, 2.35, 2.49), axis='-z', seg=10)
steering_wheel(m, (0.5, 2.48, 2.58), tilt=40, r=0.24)
m.box('interior', (0.6, 0.3, 0.6), at=(0, 1.72, 2.0), bevel=0.02, seg=1)
m.sock('seat_driver', (0.5, 1.95, 1.95))
m.sock('camera_hood', (0, 2.55, 3.6))
# roof gunner platform
for sx in (1, -1):
    for z in (1.55, 2.65):
        m.box('armor', (0.1, 0.13, 0.1), at=(0.9 * sx, ROOF + 0.12, z), bevel=0)
m.box('armor', (2.05, 0.06, 1.35), at=(0, YP + 0.01, 2.08), bevel=0.012, seg=1)
for i in range(7):
    m.box('metal_dark', (2.0, 0.012, 0.04), at=(0, YP + 0.045, 1.5 + i * 0.2), bevel=0)
m.rivet_rect('armor', (0, YP + 0.04, 2.08), 2.05, 1.35, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.2, r=0.013, inset=0.05)
m.sock('seat_gunner', (0, YP + 0.05, 2.02))
m.sock('roof_top', (0, YP + 0.05, 2.02))
railing(m, [(0.95, YP + 0.04, 2.68), (0.95, YP + 0.04, 1.45), (-0.95, YP + 0.04, 1.45), (-0.95, YP + 0.04, 2.68)], h=1.0, r=0.024, post_step=0.62, rails=(0.5, 1.0))
# front shield wall of sandbags + armor
sandbag_wall(m, (-0.95, 2.62), (0.95, 2.62), 3, YP + 0.04, depth=0.36, jitter=0.012)
sandbag_wall(m, (0.9, 2.3), (0.9, 1.8), 2, YP + 0.04, depth=0.34, jitter=0.012)
sandbag_wall(m, (-0.9, 2.3), (-0.9, 1.8), 2, YP + 0.04, depth=0.34, jitter=0.012)
for x in (-0.5, 0.5):
    spotlight(m, (x, YP + 0.25, 2.75), n=(0, 0, 1), r=0.1)
# ladder up the back of the cab
for x in (-0.3, 0.3):
    m.tube('metal_dark', [(x, 1.55, CAB_R - 0.18), (x, 3.3, CAB_R - 0.18)], 0.02, seg=6)
for i in range(8):
    m.cyl('metal_dark', (-0.3, 1.7 + i * 0.22, CAB_R - 0.18), (0.3, 1.7 + i * 0.22, CAB_R - 0.18), 0.014, seg=5)
# antenna + red pennant
m.tube('metal_dark', [(1.15, YP, 1.5), (1.17, YP + 0.9, 1.45), (1.16, YP + 1.6, 1.4)], 0.011, seg=5, r_end=0.004)
m.box('decal_red', (0.01, 0.14, 0.34), at=(1.16, YP + 1.5, 1.2), rot=(0, 0, 6), bevel=0, seg=1)

# ================================================================================ ENGINE BAY
m.hull('metal_dark', [(-0.45, 1.5, 3.2), (0.45, 1.5, 3.2), (-0.45, 2.0, 3.25), (0.45, 2.0, 3.25), (-0.45, 1.5, 4.0), (0.45, 1.5, 4.0), (-0.45, 1.95, 3.95), (0.45, 1.95, 3.95)], bevel=0)
for sx in (1, -1):
    m.box('metal_bare', (0.2, 0.12, 0.7), at=(0.25 * sx, 2.06, 3.6), bevel=0)
m.revolve('metal_dark', [(0, 0), (0.1, 0.02), (0.1, 0.34), (0, 0.36)], at=(-0.3, 2.06, 3.3), axis='y', seg=8)      # turbo
m.box('metal_dark', (1.5, 0.9, 0.1), at=(0, 1.85, 4.36), bevel=0)
for i in range(10):
    m.box('metal_bare', (1.44, 0.014, 0.03), at=(0, 1.45 + i * 0.09, 4.41), bevel=0)
m.cyl('metal_dark', (0, 1.85, 4.05), (0, 1.85, 4.3), 0.36, seg=10)
for a in range(0, 360, 60):
    m.box('metal_bare', (0.05, 0.3, 0.008), at=(0.2 * math.cos(a * D2R), 1.85 + 0.2 * math.sin(a * D2R), 4.0), rot=(0, 0, a - 90), bevel=0)
m.sock('smoke_engine', (0, 2.05, 3.8))

# ================================================================================ LIGHTS
for sx in (1, -1):
    headlight(m, (0.92 * sx, 2.05, 4.5), 0.15, n=(0, 0, 1))
    for a in (0, 60, 120):
        m.beam('armor', (0.92 * sx + 0.18 * math.cos(a * D2R), 2.05 + 0.18 * math.sin(a * D2R), 4.58), (0.92 * sx - 0.18 * math.cos(a * D2R), 2.05 - 0.18 * math.sin(a * D2R), 4.58), 0.018, 0.018, bevel=0)
    light_rect(m, (1.15 * sx, 1.7, 4.4), (0.12, 0.08), 'light_amber', n=(0, 0, 1))
    # tail lights on the tank's rear cradle
    for j, yy in enumerate((1.52, 1.78)):
        light_rect(m, (1.08 * sx, yy, ZM_ - 0.28), (0.16, 0.14), 'light_tail', n=(0, 0, -1), depth=0.1)
    light_rect(m, (1.08 * sx, 1.28, ZM_ - 0.28), (0.14, 0.08), 'light_amber', n=(0, 0, -1), depth=0.1)
    # marker lights on tank flanks (row of amber)
    for zc in (0.3, -0.9, -2.0, -3.1, -4.2):
        m.box('light_amber', (0.03, 0.05, 0.1), at=(1.13 * sx, 1.36, zc), bevel=0.005, seg=1) if False else None
m.sock('light_head_L', (0.92, 2.05, 4.56))
m.sock('light_head_R', (-0.92, 2.05, 4.56))
m.sock('light_tail_L', (1.08, 1.6, ZM_ - 0.3))
m.sock('light_tail_R', (-1.08, 1.6, ZM_ - 0.3))
m.sock('nitro_L', (0.5, 0.9, ZM_ - 0.4))
m.sock('nitro_R', (-0.5, 0.9, ZM_ - 0.4))
m.sock('exhaust_L', (1.27, 4.25, 1.28))
m.sock('exhaust_R', (-1.27, 4.25, 1.28))

# ================================================================================ PANELS
m.panel('panel_hood', (0, 2.42, 3.07), metal_dark='paint', chrome='paint', metal_bare='paint', armor='paint')
m.hull('paint', [(-0.74, 2.3, 3.09), (0.74, 2.3, 3.09), (-0.74, 2.44, 3.09), (0.74, 2.44, 3.09), (-0.72, 2.2, 4.42), (0.72, 2.2, 4.42), (-0.72, 1.8, 4.44), (0.72, 1.8, 4.44)], bevel=0.025, seg=2, obj='panel_hood')
m.hull('paint', [(-0.5, 2.4, 3.3), (0.5, 2.4, 3.3), (-0.4, 2.56, 3.4), (0.4, 2.56, 3.4), (-0.4, 2.5, 4.0), (0.4, 2.5, 4.0), (-0.5, 2.3, 4.1), (0.5, 2.3, 4.1)], bevel=0.02, seg=2, obj='panel_hood')
for i in range(6):
    m.box('paint', (0.02, 0.36, 0.5), at=(0.0, 2.3, 3.3 + i * 0.16), bevel=0, obj='panel_hood') if False else None
m.rivet_rect('paint', (0, 2.445, 3.75), 1.5, 1.3, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.17, r=0.013, inset=0.06, obj='panel_hood')
for sx in (1, -1):
    m.cyl('paint', (0.3 * sx, 2.44, 3.09), (0.6 * sx, 2.44, 3.09), 0.03, seg=8, obj='panel_hood')
m.use('body')
# doors
for sx, nm in ((1, 'panel_door_L'), (-1, 'panel_door_R')):
    m.panel(nm, (1.2 * sx, 2.3, 2.75), metal_dark='paint', armor='paint', chrome='paint', metal_bare='paint', glass='paint')
    outer = [(1.82, 1.62), (2.73, 1.62), (2.73, 3.03), (1.82, 3.03)]
    win = [(2.0, 2.5), (2.55, 2.5), (2.55, 2.95), (2.0, 2.95)]
    m.plate('paint', outer, 0.07, at=(1.2 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.014, seg=1, holes=[win], obj=nm)
    m.box('paint', (0.04, 0.84, 0.9), at=(1.25 * sx, 2.0, 2.28), bevel=0.012, seg=1, obj=nm)
    m.rivet_rect('paint', (1.272 * sx, 2.0, 2.28), 0.9, 0.84, (sx, 0, 0), u=(0, 0, -1), v=(0, 1, 0), step=0.14, r=0.012, obj=nm)
    for zz in (2.1, 2.28, 2.46):
        m.box('paint', (0.03, 0.5, 0.03), at=(1.25 * sx, 2.72, zz), bevel=0, obj=nm)
    m.box('paint', (0.12, 0.05, 0.62), at=(1.27 * sx, 2.99, 2.28), rot=(0, 0, -14 * sx), bevel=0.008, seg=1, obj=nm)
    m.box('paint', (0.06, 0.03, 0.18), at=(1.28 * sx, 2.25, 1.88), bevel=0.008, seg=1, obj=nm)
    m.tube('paint', [(1.26 * sx, 2.7, 2.72), (1.52 * sx, 2.85, 2.78)], 0.017, seg=6, obj=nm)
    m.box('paint', (0.05, 0.34, 0.2), at=(1.54 * sx, 2.88, 2.8), bevel=0.015, seg=1, obj=nm)
    m.use('body')
# front fenders
def arch(zc, r, cy, y0, n=10):
    t0 = math.asin(max(min((y0 - cy) / r, 1), -1))
    return [(zc + r * math.cos(PI - t0 - (PI - 2 * t0) * i / n), cy + r * math.sin(PI - t0 - (PI - 2 * t0) * i / n)) for i in range(n + 1)]
for sx, nm in ((1, 'panel_fender_L'), (-1, 'panel_fender_R')):
    m.panel(nm, (1.05 * sx, 1.7, 3.5), metal_dark='paint', chrome='paint', metal_bare='paint', armor='paint')
    ol = [(2.9, 1.0)] + arch(3.5, 0.74, HUBY, 1.0) + [(4.2, 1.0), (4.52, 1.0), (4.56, 1.4), (4.5, 1.82), (2.9, 1.82)]
    m.plate('paint', ol, 0.06, at=(1.22 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.012, seg=1, obj=nm)
    m.hull('paint', [(0.74 * sx, 1.86, 2.9), (1.24 * sx, 1.86, 2.9), (0.74 * sx, 1.86, 4.54), (1.24 * sx, 1.86, 4.54), (0.74 * sx, 1.76, 2.9), (1.24 * sx, 1.76, 2.9), (0.74 * sx, 1.8, 4.54), (1.24 * sx, 1.8, 4.54)], bevel=0.02, seg=2, obj=nm)
    po = [(3.5 + 0.8 * math.cos(t * D2R), HUBY + 0.8 * math.sin(t * D2R)) for t in range(22, 159, 14)]
    pi_ = [(3.5 + 0.7 * math.cos(t * D2R), HUBY + 0.7 * math.sin(t * D2R)) for t in range(158, 21, -14)]
    m.plate('paint', po + pi_, 0.08, at=(1.25 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.008, seg=1, obj=nm)
    m.rivet_line('paint', (1.25 * sx, 1.865, 3.0), (1.25 * sx, 1.865, 4.45), (0, 1, 0), step=0.16, r=0.013, obj=nm)
    m.use('body')
# bull-bar bumper
m.panel('panel_bumper_F', (0, 0.9, 4.75), metal_dark='armor', chrome='armor', metal_bare='armor', spike='armor')
m.hull('armor', [(-1.24, 0.5, 4.72), (1.24, 0.5, 4.72), (-1.24, 1.05, 4.72), (1.24, 1.05, 4.72), (-1.2, 0.5, 4.95), (1.2, 0.5, 4.95), (-1.2, 1.05, 4.9), (1.2, 1.05, 4.9)], bevel=0.025, seg=2, obj='panel_bumper_F')
m.rivet_rect('armor', (0, 0.78, 4.95), 2.3, 0.42, (0, 0, 1), u=(-1, 0, 0), v=(0, 1, 0), step=0.15, r=0.013, inset=0.05, obj='panel_bumper_F')
for i in range(7):
    x = -0.9 + i * 0.3
    m.beam('armor', (x, 1.05, 4.82), (x * 0.97, 2.35, 4.6), 0.07, 0.05, bevel=0.01, seg=1, obj='panel_bumper_F')
m.beam('armor', (-0.96, 1.5, 4.76), (0.96, 1.5, 4.76), 0.1, 0.07, bevel=0.01, seg=1, obj='panel_bumper_F')
m.beam('armor', (-0.96, 2.32, 4.62), (0.96, 2.32, 4.62), 0.09, 0.07, bevel=0.01, seg=1, obj='panel_bumper_F')
for sx in (1, -1):
    m.beam('armor', (1.0 * sx, 1.0, 4.82), (1.0 * sx, 2.3, 4.62), 0.1, 0.07, bevel=0.012, seg=1, obj='panel_bumper_F')
    m.spike('armor', (1.0 * sx, 2.32, 4.62), (1.02 * sx, 2.75, 4.72), 0.05, seg=6, obj='panel_bumper_F')
    m.spike('armor', (1.24 * sx, 0.8, 4.85), (1.5 * sx, 0.8, 5.05), 0.055, seg=6, obj='panel_bumper_F')
for i in range(5):
    x = -0.6 + i * 0.3
    m.spike('armor', (x, 0.85, 4.95), (x, 0.86, 5.2 if i % 2 == 0 else 5.08), 0.045, seg=6, obj='panel_bumper_F')
m.use('body')
# cab armor plates (bolted on the door sides + roof brow)
for sx, nm in ((1, 'panel_armor_L'), (-1, 'panel_armor_R')):
    m.panel(nm, (1.3 * sx, 2.3, 2.3), metal_dark='armor', chrome='armor', metal_bare='armor')
    m.plate('armor', [(1.85, 2.15), (2.7, 2.15), (2.7, 2.6), (2.6, 2.7), (1.95, 2.7), (1.85, 2.6)], 0.04, at=(1.235 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.01, seg=1, obj=nm)
    m.rivet_rect('armor', (1.257 * sx, 2.42, 2.28), 0.85, 0.55, (sx, 0, 0), u=(0, 0, -1), v=(0, 1, 0), step=0.14, r=0.012, inset=0.045, obj=nm)
    m.plate('armor', [(1.42, 1.5), (1.78, 1.5), (1.78, 3.1), (1.42, 3.1)], 0.04, at=(1.225 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.01, seg=1, obj=nm)
    m.rivet_rect('armor', (1.247 * sx, 2.3, 1.6), 0.36, 1.6, (sx, 0, 0), u=(0, 0, -1), v=(0, 1, 0), step=0.16, r=0.012, inset=0.04, obj=nm)
    m.weld('armor', (1.26 * sx, 2.16, 1.83), (1.26 * sx, 2.65, 1.83), r=0.011, obj=nm)
    m.use('body')
# dual chrome stacks (detachable)
for sx, nm in ((1, 'panel_stack_L'), (-1, 'panel_stack_R')):
    m.panel(nm, (1.28 * sx, 1.4, 1.28), metal_dark='chrome', metal_bare='chrome', armor='chrome')
    exhaust_stack(m, (1.28 * sx, 1.32, 1.28), (1.28 * sx, 4.2, 1.28), r=0.095, mat='chrome', obj=nm)
    for y in (1.9, 2.7, 3.5):
        m.box('chrome', (0.1, 0.05, 0.22), at=(1.2 * sx, y, 1.32), bevel=0, obj=nm)
    m.use('body')
# rear bumper / ICC bar
m.panel('panel_bumper_R', (0, 0.9, ZM_ - 0.45), metal_dark='armor', chrome='armor', metal_bare='armor', spike='armor')
zb = ZM_ - 0.42
m.hull('armor', [(-1.22, 0.72, zb), (1.22, 0.72, zb), (-1.22, 1.15, zb), (1.22, 1.15, zb), (-1.18, 0.72, zb - 0.16), (1.18, 0.72, zb - 0.16), (-1.18, 1.15, zb - 0.1), (1.18, 1.15, zb - 0.1)], bevel=0.02, seg=2, obj='panel_bumper_R')
m.rivet_rect('armor', (0, 0.94, zb - 0.16), 2.3, 0.4, (0, 0, -1), u=(1, 0, 0), v=(0, 1, 0), step=0.16, r=0.013, inset=0.05, obj='panel_bumper_R')
for sx in (1, -1):
    m.spike('armor', (1.18 * sx, 0.93, zb - 0.12), (1.32 * sx, 0.93, zb - 0.36), 0.05, seg=6, obj='panel_bumper_R')
    m.box('rubber_tire', (0.6, 0.55, 0.03), at=(0.85 * sx, 0.5, zb + 0.02), bevel=0.006, seg=1, obj='panel_bumper_R') if False else None
m.use('body')
# fenders for the rear tandem + trailer axle: arch lips + mud flaps
for sx in (1, -1):
    for zc in (AXLES['M'], AXLES['R'], AXLES['R2']):
        po = [(zc + 0.76 * math.cos(t * D2R), HUBY + 0.76 * math.sin(t * D2R)) for t in range(30, 151, 15)]
        pi_ = [(zc + 0.67 * math.cos(t * D2R), HUBY + 0.67 * math.sin(t * D2R)) for t in range(150, 29, -15)]
        m.plate('armor', po + pi_, 0.07, at=(1.25 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.008, seg=1)
        for (zz, yy) in po[1:-1]:
            m.rivet('armor', (1.29 * sx, yy - 0.04, zz), (sx, 0, 0), r=0.013)
    m.box('metal_dark', (0.03, 0.44, 0.5), at=(1.2 * sx, 0.78, AXLES['R2'] - 0.72), bevel=0.006, seg=1)

add_proxies(m)
m.finish()

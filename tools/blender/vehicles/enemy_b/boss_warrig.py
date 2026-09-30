"""boss_warrig "The Leviathan": colossal articulated war-train, ~34 m x 7.5 m x 9.5 m.
armored tractor (spiked plow, twin stacks) + fortress trailer #1 (turret rings, missile racks, 4 gunner posts)
+ trailer #2 (cannon turret, fuel tanks, flame ports, drop ramp, exposed reactor behind bolt-on plates).
Game space: +X left, +Y up, +Z forward, origin on the ground at the middle of the train.  Driver on +X.
Run: blender -b --factory-startup -P tools/blender/vehicles/enemy_b/boss_warrig.py   (env STAGE=n builds only the first n sections)"""
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from boss_parts import *  # noqa

import boss_rear as BR  # noqa: E402  (rear tower, plates, ramp, nozzles, thrusters, flanks)

STAGE = int(os.environ.get('STAGE', '99'))
m = Model('boss_warrig', seed=41, bake=True)
m.tile_scale = 1.8            # detail-normal tiling (UV0) for this huge rig
# material folding: aliased materials keep their own baked look inside the target atlas (rust / spikes / bare steel on armor, chrome
# on metal_dark (the game darkens a material named chrome), hazard yellow on the bone atlas, red cloth on the charcoal atlas)
m.alias.update({'metal_bare': 'armor', 'interior': 'metal_dark', 'fabric': 'metal_dark', 'leather': 'metal_dark', 'brass': 'metal_dark',
                'gun_metal': 'armor', 'gun_black': 'metal_dark', 'decal_red': 'paint2', 'decal_yellow': 'plastic', 'spike': 'armor',
                'rust': 'armor', 'cloth_red': 'paint2', 'chrome': 'metal_dark'})
PI = math.pi
R_W, W_W, HUBY, HX = 1.35, 0.95, 1.35, 2.95
AX = dict(F=12.6, M=7.4, R=5.0, R2=-2.4, T1=-5.2, T2=-13.6)


def _dens(c, n):
    """texel density weighting: the players chase the rear for the whole fight"""
    z = c[2]
    k = 0.8 if z > 3.0 else (1.0 if z > -9.5 else 1.45)
    if z < -16.3 and n[2] < -0.5:
        k = 2.8                                   # rear faces of trailer #2 (plates, ramp, tower, bumper)
    return k


m.bake_opts = dict(
    dens=90.0, dens_max=1.1, dens_floor=0.9, margin=2, scale=2.2, edge_scale=1.5, heat_scale=1.2, shelf_window=14,
    max_size={'armor': (2048, 2048), 'paint': (1024, 1024), 'metal_dark': (2048, 1024), 'paint2': (1024, 1024), 'plastic': (1024, 1024),
              'canvas': (512, 512), 'rubber_tire': (1024, 512), 'rim': (512, 512), 'wood': (512, 512)},     # ~76 MB texture memory
    max_default=(512, 512),
    mat_dens={'rubber_tire': 0.7, 'wood': 0.7, 'canvas': 0.8},
    ao_dist=3.0, cav_dist=0.1, dirt_h=3.4, rust=1.15, wear=1.1, seed=41,
    wheels=[(x, y, z, R_W) for (x, y, z) in [(sx * HX, HUBY, zc) for zc in AX.values() for sx in (1, -1)]],
    heat_spots=BR.HEAT_SPOTS + [(2.4, 8.95, 6.15, 0.8), (-2.4, 8.95, 6.15, 0.8)],
    dens_fn=_dens,
    recipes={'paint': 'boss_paint', 'paint2': 'boss_paint2', 'rim': 'boss_rim'},
    look_recipes={'paint': 'boss_paint', 'paint2': 'boss_paint2', 'chrome': 'boss_chrome'},
)
WN = []
WP = []
for k, nm in (('F', 'F'), ('M', 'M'), ('R', 'R'), ('R2', 'R2'), ('T1', 'T1'), ('T2', 'T2')):
    WN += ['wheel_%sL' % nm, 'wheel_%sR' % nm]
    WP += [(HX, HUBY, AX[k]), (-HX, HUBY, AX[k])]
wheel_set(m, 'boss', R_W, W_W, WP, WN, rim_ratio=0.55, lugs=24, spl=3, tread_h=0.1, nuts=12, ribs=10, lug_skew=1.8, dish=0.42)
m.use('body')
DECK = 3.0            # trailer deck top
CF = 2.85             # cab / tractor deck top
CAB_R, CAB_F = 6.6, 10.6
ROOF = 6.8


def apanel(name, origin, **keep):
    """single-material detachable armor panel node (pass e.g. plastic='plastic' to keep an extra material)"""
    al = dict(metal_dark='armor', chrome='armor', metal_bare='armor', paint='armor', paint2='armor', rust='armor', spike='armor', plastic='armor')
    al.update(keep)
    m.panel(name, origin, **al)
    return name


def both(fn):
    fn(1)
    fn(-1)


# ================================================================================ 1. UNDERCARRIAGE (frames, axles, drive line)
def undercarriage():
    # tractor frame
    for sx in (1, -1):
        m.box('metal_dark', (0.34, 0.85, 12.8), at=(1.3 * sx, 1.95, 9.6), bevel=0)
        m.box('metal_dark', (0.2, 0.2, 12.4), at=(1.3 * sx, 1.45, 9.6), bevel=0)
        # trailer 1 & 2 frames (heavy girders)
        m.box('metal_dark', (0.4, 0.9, 12.0), at=(1.6 * sx, 2.15, -2.6), bevel=0)
        m.box('metal_dark', (0.4, 0.9, 8.0), at=(1.6 * sx, 2.15, -13.4), bevel=0)
        m.box('metal_dark', (0.22, 0.24, 11.8), at=(1.6 * sx, 1.62, -2.6), bevel=0)
    for z in (15.6, 14.4, 13.2, 11.6, 10.4, 9.2, 8.0, 6.8, 5.6, 4.4, 3.5, 2.2, 0.5, -1.4, -3.4, -5.6, -7.6, -9.4, -11.6, -13.8, -15.6, -16.6):
        m.box('metal_dark', (3.5, 0.5, 0.36), at=(0, 1.95 if z > 3 else 2.15, z), bevel=0)
    for k, zc in AX.items():
        m.cyl('metal_dark', (-HX + 0.3, HUBY, zc), (HX - 0.3, HUBY, zc), 0.2, seg=10)
        m.revolve('metal_dark', [(0, -0.75), (0.5, -0.66), (0.62, -0.25), (0.62, 0.25), (0.5, 0.66), (0, 0.75)], at=(0, HUBY, zc), axis='z', seg=14)
        for sx in (1, -1):
            m.cyl('metal_dark', (HX * sx - 0.3 * sx, HUBY, zc), (HX * sx - 0.72 * sx, HUBY, zc), 0.62, seg=14)              # planetary hubs
            m.box('metal_dark', (0.4, 0.14, 2.6), at=(1.95 * sx, HUBY + 0.55, zc), bevel=0)                                  # leaf springs
            m.box('metal_dark', (0.4, 0.12, 2.0), at=(1.95 * sx, HUBY + 0.68, zc), bevel=0)
            m.box('metal_dark', (0.5, 0.35, 0.5), at=(1.95 * sx, HUBY + 0.35, zc), bevel=0)
            for dz in (-0.45, 0.45):
                m.cyl('metal_dark', (1.95 * sx, HUBY + 0.3, zc + dz), (1.95 * sx, HUBY + 1.0, zc + dz), 0.05, seg=6)
            m.cyl('metal_dark', (1.5 * sx, HUBY - 0.1, zc + 0.9), (1.5 * sx, HUBY + 0.9, zc + 0.9), 0.1, seg=8)              # shocks
            m.revolve('metal_dark', [(0, 0), (0.28, 0), (0.28, 0.4), (0, 0.42)], at=(2.2 * sx, HUBY + 0.05, zc - 0.7), axis='x', seg=10)   # brake chambers
    # driveline
    m.cyl('metal_bare', (0, 2.0, 10.2), (0, 1.9, 5.0), 0.15, seg=8)
    m.cyl('metal_bare', (0, 1.8, 5.0), (0, 1.7, 3.5), 0.13, seg=8)
    m.cyl('metal_bare', (0, 1.9, 10.2), (0, 1.9, 12.5), 0.14, seg=8)
    m.box('metal_dark', (1.5, 1.2, 2.4), at=(0, 2.2, 9.4), bevel=0)                         # transmission
    m.box('metal_dark', (1.2, 0.9, 1.6), at=(0, 2.0, 6.0), bevel=0)
    # tractor/trailer coupling: fifth wheel + kingpin, bridge dolly + chains to trailer 2
    m.cyl('armor', (0, CF - 0.25, 3.2), (0, CF - 0.05, 3.2), 1.0, seg=20)
    m.box('armor', (2.6, 0.3, 2.2), at=(0, CF - 0.4, 3.5), bevel=0.02, seg=1)
    for sx in (1, -1):
        m.beam('armor', (1.5 * sx, 2.0, -8.5), (0.5 * sx, 2.2, -10.2), 0.4, 0.5, bevel=0.02, seg=1)                       # drawbar arms
    m.cyl('armor', (0, 2.0, -9.6), (0, 2.5, -9.6), 0.5, seg=14)
    chain(m, (1.4, 2.4, -8.6), (1.4, 2.4, -9.9), sag=0.25, link=0.26, r=0.05)
    chain(m, (-1.4, 2.4, -8.6), (-1.4, 2.4, -9.9), sag=0.25, link=0.26, r=0.05)


# ================================================================================ 2. TRACTOR (engine bay, hood, fenders, grille, plow)
def tractor():
    # engine block + turbos under the hood
    m.hull('metal_dark', [(-0.95, 2.6, 11.4), (0.95, 2.6, 11.4), (-0.95, 3.9, 11.6), (0.95, 3.9, 11.6), (-0.95, 2.6, 13.8), (0.95, 2.6, 13.8), (-0.95, 3.7, 13.6), (0.95, 3.7, 13.6)], bevel=0)
    for sx in (1, -1):
        m.box('metal_bare', (0.6, 0.35, 1.7), at=(0.5 * sx, 4.05, 12.5), bevel=0.04, seg=1)
        for i in range(6):
            m.hexbolt('metal_dark', (0.5 * sx, 4.23, 11.9 + i * 0.28), (0, 1, 0), r=0.06, h=0.05)
        m.tube('metal_bare', [(1.0 * sx, 3.9, 12.0), (1.6 * sx, 4.0, 11.9), (1.8 * sx, 3.5, 12.4)], 0.16, seg=8, bend=0.3)
        m.revolve('metal_dark', [(0, 0), (0.42, 0.02), (0.42, 0.75), (0.25, 0.9), (0, 0.9)], at=(1.5 * sx, 3.0, 13.3), axis='y', seg=12)   # turbo housings
    m.box('metal_bare', (1.0, 0.35, 1.2), at=(0, 4.1, 12.6), bevel=0.04, seg=1)
    m.revolve('metal_dark', [(0, 0), (0.42, 0), (0.42, 0.9), (0, 0.9)], at=(0.0, 4.2, 13.4), axis='y', seg=12)
    m.hull('metal_dark', [(-2.0, 2.5, 14.4), (2.0, 2.5, 14.4), (-2.0, 4.0, 14.4), (2.0, 4.0, 14.4), (-2.0, 2.5, 14.6), (2.0, 2.5, 14.6), (-2.0, 4.0, 14.6), (2.0, 4.0, 14.6)], bevel=0.03, seg=1)   # radiator
    for i in range(14):
        m.box('metal_bare', (3.9, 0.06, 0.08), at=(0, 2.6 + i * 0.1, 14.3), bevel=0)
    m.cyl('metal_dark', (0, 3.25, 13.9), (0, 3.25, 14.3), 0.95, seg=14)
    for a in range(0, 360, 45):
        m.box('metal_bare', (0.14, 0.75, 0.03), at=(0.5 * math.cos(a * D2R), 3.25 + 0.5 * math.sin(a * D2R), 13.85), rot=(0, 0, a - 90), bevel=0)
    m.tube('metal_dark', [(-1.3, 3.5, 13.9), (-1.6, 3.9, 14.2), (-1.7, 3.2, 14.35)], 0.09, seg=6, bend=0.2)
    m.tube('metal_dark', [(1.3, 3.5, 13.9), (1.6, 3.9, 14.2), (1.7, 3.2, 14.35)], 0.09, seg=6, bend=0.2)
    m.sock('smoke_engine', (0, 4.3, 12.5))
    m.sock('camera_hood', (0, 5.2, 12.0))
    # front cross beam + tow hooks
    m.box('armor', (5.2, 0.9, 0.7), at=(0, 1.6, 15.5), bevel=0.05, seg=1)
    for sx in (1, -1):
        m.tube('metal_dark', [(0.9 * sx, 1.6, 15.8), (0.9 * sx, 1.6, 16.5), (0.9 * sx, 1.1, 16.6), (0.9 * sx, 1.0, 16.2)], 0.09, seg=8, bend=0.15)


def tractor_panels():
    # ---- hood
    m.panel('panel_hood', (0, 4.6, 10.8), metal_dark='paint', chrome='paint', metal_bare='paint', armor='paint', rust='paint', spike='paint')
    o = 'panel_hood'
    m.hull('paint', [(-2.3, 4.3, 10.9), (2.3, 4.3, 10.9), (-2.3, 4.7, 10.9), (2.3, 4.7, 10.9), (-2.25, 4.0, 14.8), (2.25, 4.0, 14.8), (-2.2, 3.4, 14.85), (2.2, 3.4, 14.85)], bevel=0.12, seg=2, obj=o)
    m.hull('paint', [(-1.4, 4.6, 11.4), (1.4, 4.6, 11.4), (-1.1, 5.2, 11.8), (1.1, 5.2, 11.8), (-1.1, 4.9, 13.8), (1.1, 4.9, 13.8), (-1.4, 4.3, 14.1), (1.4, 4.3, 14.1)], bevel=0.1, seg=2, obj=o)   # engine hump
    for i in range(10):
        m.box('paint', (1.7, 0.05, 0.06), at=(0, 5.2 - i * 0.01, 11.9 + i * 0.22), bevel=0, obj=o)
    for sx in (1, -1):
        m.rivet_line('paint', (2.2 * sx, 4.34, 11.2), (2.2 * sx, 4.05, 14.6), (0, 1, 0), step=0.35, r=0.05, obj=o)
        m.cyl('metal_dark', (0.7 * sx, 4.7, 10.9), (1.5 * sx, 4.7, 10.9), 0.1, seg=8, obj=o)
        m.box('metal_dark', (0.2, 0.2, 0.7), at=(1.6 * sx, 3.7, 14.7), bevel=0.02, seg=1, obj=o)
    m.use('body')
    # ---- fenders
    for sx, nm in ((1, 'panel_fender_L'), (-1, 'panel_fender_R')):
        m.panel(nm, (2.9 * sx, 3.2, 12.6), metal_dark='armor', chrome='armor', metal_bare='armor', paint='armor', paint2='armor', rust='armor')
        zc = AX['F']
        ol = [(10.9, 1.95)]
        r_a = 1.8
        t0 = math.asin((1.95 - HUBY) / r_a)
        ol += [(zc + r_a * math.cos(PI - t0 - (PI - 2 * t0) * i / 12), HUBY + r_a * math.sin(PI - t0 - (PI - 2 * t0) * i / 12)) for i in range(13)]
        ol += [(14.3, 1.95), (14.8, 1.95), (14.95, 2.7), (14.85, 3.5), (10.9, 3.5)]
        m.plate('armor', ol, 0.14, at=(3.5 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.04, seg=1, obj=nm)
        m.hull('armor', [(2.15 * sx, 3.6, 10.9), (3.6 * sx, 3.6, 10.9), (2.15 * sx, 3.6, 14.9), (3.6 * sx, 3.6, 14.9), (2.15 * sx, 3.4, 10.9), (3.6 * sx, 3.4, 10.9), (2.15 * sx, 3.4, 14.9), (3.6 * sx, 3.4, 14.9)], bevel=0.06, seg=2, obj=nm)
        po = [(zc + 1.9 * math.cos(t * D2R), HUBY + 1.9 * math.sin(t * D2R)) for t in range(20, 161, 10)]
        pi_ = [(zc + 1.72 * math.cos(t * D2R), HUBY + 1.72 * math.sin(t * D2R)) for t in range(160, 19, -10)]
        m.plate('armor', po + pi_, 0.18, at=(3.58 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.02, seg=1, obj=nm)
        for (zz, yy) in po[1:-1]:
            m.rivet('armor', (3.68 * sx, yy - 0.09, zz), (sx, 0, 0), r=0.05, obj=nm)
        m.rivet_line('armor', (3.5 * sx, 3.62, 11.1), (3.5 * sx, 3.62, 14.7), (0, 1, 0), step=0.34, r=0.05, obj=nm)
        for i in range(5):
            m.spike('armor', (3.6 * sx, 3.5, 11.4 + i * 0.7), (3.75 * sx, 4.3, 11.4 + i * 0.7), 0.1, seg=6, obj=nm)
        m.use('body')


def plow_and_grille():
    o = 'part_plow'
    m.panel(o, (0, 1.4, 16.0), metal_dark='armor', chrome='armor', metal_bare='armor', paint='armor', paint2='armor', rust='armor', plastic='plastic')
    YT = 2.55
    # blade: centre + two wings curved back (low, so the grille + eyes stay visible above it)
    for sx in (1, -1):
        m.hull('armor', [(0.0, 0.45, 17.1), (1.7 * sx, 0.45, 17.0), (0.0, YT, 16.3), (1.7 * sx, YT, 16.25), (0.0, 0.45, 15.8), (1.6 * sx, 0.45, 15.7), (0.0, YT - 0.1, 15.6), (1.6 * sx, YT - 0.1, 15.6)], bevel=0.1, seg=2, obj=o)
        m.hull('armor', [(1.7 * sx, 0.45, 17.0), (3.7 * sx, 0.45, 15.6), (1.7 * sx, YT, 16.25), (3.7 * sx, YT - 0.1, 15.2), (1.6 * sx, 0.45, 15.7), (3.6 * sx, 0.45, 14.7), (1.6 * sx, YT - 0.1, 15.6), (3.6 * sx, YT - 0.2, 14.7)], bevel=0.1, seg=2, obj=o)
        m.hull('armor', [(0.0, 0.28, 17.35), (1.7 * sx, 0.28, 17.25), (0.0, 0.62, 17.1), (1.7 * sx, 0.62, 17.0), (0.0, 0.28, 17.0), (1.7 * sx, 0.28, 16.9)], bevel=0.04, seg=1, obj=o)
        m.hull('armor', [(1.7 * sx, 0.28, 17.25), (3.8 * sx, 0.28, 15.8), (1.7 * sx, 0.62, 17.0), (3.8 * sx, 0.62, 15.6), (1.7 * sx, 0.28, 16.9), (3.7 * sx, 0.28, 15.6)], bevel=0.04, seg=1, obj=o)
        for i in range(4):
            x = (0.4 + i * 0.5) * sx
            m.beam('armor', (x, 0.7, 16.98 - i * 0.03), (x, YT - 0.05, 16.3), 0.24, 0.14, bevel=0.03, seg=1, obj=o)
        for i in range(4):
            x = 1.9 + i * 0.5
            zc_ = 16.9 - (x - 1.7) * 0.7
            m.beam('armor', (x * sx, 0.7, zc_ - 0.05), (x * sx, YT - 0.1, zc_ - 0.75), 0.24, 0.14, bevel=0.03, seg=1, obj=o)
        for y in (0.95, 1.5, 2.05):
            m.rivet_line('armor', (0.05 * sx, y, 17.0 - (y - 0.45) * 0.36), (1.65 * sx, y, 16.95 - (y - 0.45) * 0.36), (0, 0.3, 1), step=0.28, r=0.05, obj=o)
        m.rivet_line('armor', (1.75 * sx, 1.0, 16.8), (3.6 * sx, 1.0, 15.4), (0.6 * sx, 0.3, 0.8), step=0.28, r=0.05, obj=o)
        m.rivet_line('armor', (1.75 * sx, 1.9, 16.5), (3.6 * sx, 1.9, 15.0), (0.6 * sx, 0.3, 0.8), step=0.28, r=0.05, obj=o)
        m.weld('armor', (0.0, 1.5, 16.8), (1.7 * sx, 1.5, 16.65), r=0.05, obj=o)
        m.spike('armor', (3.7 * sx, 0.9, 15.3), (4.3 * sx, 0.9, 16.4), 0.16, seg=6, obj=o)
        m.spike('armor', (3.6 * sx, 2.0, 14.9), (4.2 * sx, 2.1, 15.9), 0.15, seg=6, obj=o)
        m.beam('armor', (1.2 * sx, 1.9, 15.4), (1.35 * sx, 1.9, 13.2), 0.4, 0.55, bevel=0.03, seg=1, obj=o)
        m.cyl('metal_dark', (2.0 * sx, 1.9, 14.3), (2.6 * sx, 2.4, 15.5), 0.14, seg=8, obj=o)
    spike_row(m, 'armor', (-3.5, YT, 15.1), (3.5, YT, 16.25), 11, 1.5, 0.13, (0, 0.5, 0.86), obj=o)
    skull(m, (0, 1.55, 17.05), s=3.2, n=(0, 0.2, 1), obj=o, horns=True, mat='plastic', eyes='light_amber')
    m.use('body')
    # ---- grille + skull face (detachable) + headlights (body)
    m.panel('panel_grille', (0, 3.2, 14.95), metal_dark='armor', chrome='armor', metal_bare='armor', paint='armor', paint2='armor', rust='armor', spike='armor')
    for i in range(13):
        x = -2.05 + i * 0.3417
        m.beam('armor', (x, 2.45, 14.93), (x, 4.0, 14.93), 0.13, 0.12, bevel=0.02, seg=1, obj='panel_grille')
    m.beam('armor', (-2.2, 3.6, 14.95), (2.2, 3.6, 14.95), 0.35, 0.22, bevel=0.03, seg=1, obj='panel_grille')
    m.beam('armor', (-2.2, 2.75, 14.95), (2.2, 2.75, 14.95), 0.3, 0.2, bevel=0.03, seg=1, obj='panel_grille')
    skull(m, (0, 3.25, 15.05), s=2.6, n=(0, 0, 1), horns=True, mat='plastic', obj='panel_grille', eyes='light_amber')
    m.use('body')
    for sx in (1, -1):
        headlight(m, (2.6 * sx, 3.5, 15.0), 0.62, n=(0, 0, 1), seg=20)
        for a in (0, 45, 90, 135):
            m.beam('armor', (2.6 * sx + 0.75 * math.cos(a * D2R), 3.5 + 0.75 * math.sin(a * D2R), 15.12), (2.6 * sx - 0.75 * math.cos(a * D2R), 3.5 - 0.75 * math.sin(a * D2R), 15.12), 0.07, 0.07, bevel=0.005, seg=1)
        light_rect(m, (2.7 * sx, 2.5, 15.0), (0.5, 0.3), 'light_amber', n=(0, 0, 1), depth=0.3)
        headlight(m, (1.25 * sx, 2.75, 15.05), 0.3, n=(0, 0, 1), seg=14)
        # hood horns
        m.tube('armor', [(1.7 * sx, 4.2, 13.6), (2.5 * sx, 5.0, 14.0), (2.9 * sx, 6.4, 14.4), (2.7 * sx, 7.7, 14.6)], 0.2, seg=8, bend=0.7, r_end=0.03)
    m.sock('light_head_L', (2.6, 3.5, 15.15))
    m.sock('light_head_R', (-2.6, 3.5, 15.15))


# ================================================================================ 3. CAB (hollow armored fortress cab with interior, stacks, roof gantry)
def cab():
    m.use('body')
    m.box('metal_dark', (6.2, 0.25, 4.1), at=(0, 2.75, 8.55), bevel=0)
    m.box('armor', (6.3, 0.3, 4.3), at=(0, 2.6, 8.55), bevel=0.03, seg=1)                        # floor plate
    side_holes = [[(7.1, 4.55), (8.5, 4.55), (8.5, 5.25), (7.1, 5.25)], [(8.9, 4.55), (10.1, 4.55), (10.1, 5.25), (8.9, 5.25)]]
    for sx in (1, -1):
        m.plate('paint', [(CAB_R, 2.8), (CAB_F, 2.8), (CAB_F, ROOF), (CAB_R, ROOF)], 0.14, at=(3.0 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.04, seg=1, holes=side_holes)
        m.box('interior', (0.1, 2.0, 3.6), at=(2.9 * sx, 3.9, 8.6), bevel=0)
        for hz in (7.8, 9.5):
            m.box('glass', (0.03, 0.7, 1.4), at=(3.0 * sx, 4.9, hz), bevel=0)
            for k in range(4):
                m.box('metal_dark', (0.06, 0.8, 0.07), at=(3.1 * sx, 4.9, hz - 0.6 + k * 0.4), bevel=0)
        m.box('armor', (0.16, 0.3, 4.1), at=(3.1 * sx, 2.85, 8.6), bevel=0.03, seg=1)          # sill
        m.box('armor', (0.5, 0.16, 4.3), at=(3.2 * sx, 2.4, 8.55), bevel=0.02, seg=1)            # step
    # front wall with a slit windshield, back wall with a door hole
    m.plate('paint', [(-3.05, 2.8), (3.05, 2.8), (3.05, ROOF), (-3.05, ROOF)], 0.2, at=(0, 0, 10.5), u=(1, 0, 0), v=(0, 1, 0), bevel=0.04, seg=1,
            holes=[[(-2.35, 4.45), (2.35, 4.45), (2.35, 5.95), (-2.35, 5.95)]])
    m.box('glass', (4.6, 1.5, 0.04), at=(0, 5.2, 10.42), bevel=0)
    m.plate('armor', [(-3.05, 2.8), (3.05, 2.8), (3.05, ROOF), (-3.05, ROOF)], 0.2, at=(0, 0, CAB_R + 0.1), u=(1, 0, 0), v=(0, 1, 0), bevel=0.04, seg=1,
            holes=[[(-0.7, 2.85), (0.7, 2.85), (0.7, 5.0), (-0.7, 5.0)]])
    m.box('interior', (1.6, 2.2, 0.06), at=(0, 3.95, CAB_R + 0.25), bevel=0)
    # roof: paint2 slab + armor hat + brow
    m.box('paint2', (6.3, 0.22, 4.3), at=(0, ROOF + 0.08, 8.55), bevel=0.06, seg=2)
    m.hull('armor', [(-3.15, 5.9, 10.55), (3.15, 5.9, 10.55), (-3.15, 6.9, 10.4), (3.15, 6.9, 10.4), (-3.1, 5.55, 11.15), (3.1, 5.55, 11.15), (-3.1, 6.1, 11.25), (3.1, 6.1, 11.25)], bevel=0.08, seg=2)   # visor brow
    on = apanel('panel_armor_roof', (0, ROOF + 0.25, 8.4))
    wall(m, 'armor', (0, ROOF + 0.2, 8.4), (1, 0, 0), (0, 0, 1), 5.4, 3.4, 3, 3, t=0.08, gap=0.1, rr=0.04, bevel=0.03, obj=on)
    m.use('body')
    for sx in (1, -1):
        for k in range(7):
            m.spike('armor', (2.9 * sx, ROOF + 0.2, 6.9 + k * 0.5), (3.05 * sx, ROOF + 0.9, 6.9 + k * 0.5), 0.09, seg=6)
    # driver cage over the slit windshield
    for k in range(3):
        y = 4.6 + k * 0.55
        m.beam('armor', (-2.7, y, 10.75), (2.7, y, 10.75), 0.16, 0.14, bevel=0.02, seg=1)
    for k in range(9):
        x = -2.6 + k * 0.65
        m.beam('armor', (x, 4.35, 10.77), (x, 6.0, 10.77), 0.12, 0.1, bevel=0.015, seg=1)
    for sx in (1, -1):
        m.beam('armor', (3.0 * sx, 4.3, 10.72), (3.0 * sx, 6.1, 10.72), 0.3, 0.2, bevel=0.03, seg=1)
    for sx, nm in ((1, 'panel_armor_cab_L'), (-1, 'panel_armor_cab_R')):
        apanel(nm, (3.1 * sx, 4.6, 8.6))
        wall(m, 'armor', (3.08 * sx, 3.55, 8.6), (0, 0, -sx), (0, 1, 0), 3.9, 1.3, 3, 1, t=0.1, gap=0.1, rr=0.045, bevel=0.03, obj=nm)
        wall(m, 'armor', (3.08 * sx, 6.05, 8.6), (0, 0, -sx), (0, 1, 0), 3.9, 1.0, 3, 1, t=0.1, gap=0.1, rr=0.045, bevel=0.03, obj=nm)
        m.use('body')
    # lower chin armor, hazard stripes (paint2), war paint
    on = apanel('panel_chin', (0, 3.6, 10.7))
    wall(m, 'armor', (0, 3.6, 10.6), (1, 0, 0), (0, 1, 0), 5.9, 1.5, 4, 2, t=0.1, gap=0.09, rr=0.045, bevel=0.03, obj=on)
    m.use('body')
    for k in range(8):
        m.obox('paint2', (-2.8 + k * 0.8, 6.35, 10.68), (1, 0.7, 0), (0, 1, 0), (0.28, 0.55, 0.03), bevel=0, seg=1)
    # interior: pedestal seats, dash, wheel, gauges
    m.box('metal_dark', (0.9, 0.9, 1.0), at=(1.0, 3.2, 8.2), bevel=0)
    m.box('metal_dark', (0.9, 0.9, 1.0), at=(-1.0, 3.2, 8.2), bevel=0)
    bucket_seat(m, (1.0, 4.05, 8.4), w=0.9)
    bucket_seat(m, (-1.0, 4.05, 8.4), w=0.9)
    m.hull('interior', [(-2.8, 3.3, 10.4), (2.8, 3.3, 10.4), (-2.8, 4.5, 10.3), (2.8, 4.5, 10.3), (-2.8, 4.35, 9.5), (2.8, 4.35, 9.5), (-2.8, 3.3, 9.5), (2.8, 3.3, 9.5)], bevel=0.05, seg=2)
    m.box('interior', (1.5, 0.5, 0.5), at=(1.0, 4.85, 9.75), bevel=0.04, seg=1)
    for gx in (0.5, 0.9, 1.3, 1.7):
        m.revolve('light_amber', [(0, 0.02), (0.11, 0.015), (0.11, 0), (0, 0)], at=(gx, 4.8, 9.49), axis='-z', seg=10)
    steering_wheel(m, (1.0, 4.9, 9.2), tilt=32, r=0.42)
    m.box('interior', (1.0, 0.6, 1.4), at=(0, 3.5, 8.2), bevel=0.03, seg=1)                     # centre console
    for i in range(3):
        m.cyl('metal_dark', (0.0 + i * 0.25, 3.8, 8.6), (0.0 + i * 0.25, 4.5 + i * 0.1, 8.7), 0.045, seg=6)        # levers
    m.sock('seat_driver', (1.0, 4.05, 8.4))
    m.sock('roof_top', (0, ROOF + 0.4, 8.5))
    # roof gantry: 4 huge floodlights on a lamp bar
    for sx in (1, -1):
        m.cyl('metal_dark', (2.9 * sx, ROOF + 0.15, 10.0), (2.9 * sx, ROOF + 1.1, 10.0), 0.1, seg=6)
    m.beam('armor', (-3.0, ROOF + 1.15, 10.0), (3.0, ROOF + 1.15, 10.0), 0.22, 0.2, bevel=0.03, seg=1)
    fl = [(-2.3, ROOF + 1.55, 10.0), (-0.8, ROOF + 1.55, 10.0), (0.8, ROOF + 1.55, 10.0), (2.3, ROOF + 1.55, 10.0)]
    for i, p in enumerate(fl):
        spotlight(m, p, n=(0, -0.08, 1), r=0.42)
        m.cyl('metal_dark', (p[0], ROOF + 1.15, p[2] - 0.1), (p[0], p[1] - 0.2, p[2] - 0.1), 0.06, seg=6)
        m.sock('floodlight_%d' % (i + 1), (p[0], p[1], p[2] + 0.2), rot=(4, 0, 0), size=0.4)
    # roof skulls + chains
    for sx in (1, -1):
        skull(m, (2.4 * sx, ROOF + 0.4, 10.3), s=1.7, n=(0, 0.1, 1), horns=True, mat='plastic', eyes='light_amber')
    chain(m, (-3.05, 6.2, 9.0), (-3.05, 5.2, 7.0), sag=0.6, link=0.28, r=0.05)
    chain(m, (3.05, 6.2, 9.0), (3.05, 5.2, 7.0), sag=0.6, link=0.28, r=0.05)
    # colossal horned-skull crest on a pylon above the cab roof (bold far-view silhouette)
    m.beam('armor', (0, ROOF + 0.2, 8.6), (0, ROOF + 1.3, 8.6), 0.45, 0.4, bevel=0.04, seg=1)
    for sx in (1, -1):
        m.beam('armor', (0.9 * sx, ROOF + 0.25, 8.1), (0.15 * sx, ROOF + 1.4, 8.6), 0.22, 0.2, bevel=0.03, seg=1)
    skull(m, (0, ROOF + 1.95, 8.9), s=3.6, n=(0, 0.12, 1), horns=True, mat='plastic', eyes='light_amber')
    # exhaust pipes from the engine, running under the cab to the stacks
    for sx in (1, -1):
        m.tube('metal_dark', [(1.3 * sx, 3.3, 12.0), (1.9 * sx, 2.55, 11.4), (2.2 * sx, 2.4, 10.0), (2.4 * sx, 2.6, 6.6), (2.4 * sx, 3.0, 6.15)], 0.24, seg=10, bend=0.6)
    # ladders + grab rails on the cab flanks
    for sx in (1, -1):
        ladder(m, (3.35 * sx, 1.0, 9.9), (3.35 * sx, 6.7, 9.9), width=0.8, rung=0.4, side=(0, 0, 1))
        m.tube('metal_dark', [(3.35 * sx, 2.9, 6.9), (3.35 * sx, 6.4, 6.9), (3.35 * sx, 6.4, 7.6)], 0.06, seg=6, bend=0.1)


def stacks():
    for sx, nm in ((1, 'L'), (-1, 'R')):
        pn = 'part_stack_' + nm
        m.panel(pn, (2.4 * sx, 3.0, 6.15), chrome='metal_dark', metal_bare='metal_dark', armor='metal_dark', rust='metal_dark', spike='metal_dark')
        exhaust_stack(m, (2.4 * sx, 2.9, 6.15), (2.4 * sx, 8.9, 6.15), r=0.36, mat='chrome', obj=pn)
        for y in (3.6, 5.2, 6.8):
            m.box('chrome', (0.3, 0.16, 0.5), at=(2.4 * sx, y, 6.55), bevel=0.02, seg=1, obj=pn)
        m.use('body')
    m.sock('smoke_stack_L', (2.4, 9.0, 6.15))
    m.sock('smoke_stack_R', (-2.4, 9.0, 6.15))
    m.sock('exhaust_L', (2.4, 8.95, 6.15))
    m.sock('exhaust_R', (-2.4, 8.95, 6.15))


# ================================================================================ 4. TRAILER #1  (fortress: parapet, raised deck, turret rings, missile racks, 4 gunner posts)
Z1F, Z1R = 3.0, -8.4
WX = 3.2                # parapet centre x
PLAT_Y = 3.9


def sandbag_ring(cx, y0, cz, R, rows, n=14, obj='body'):
    for i in range(n):
        a0, a1 = 2 * PI * i / n, 2 * PI * (i + 1) / n
        sandbag_wall(m, (cx + R * math.cos(a0), cz + R * math.sin(a0)), (cx + R * math.cos(a1), cz + R * math.sin(a1)), rows, y0,
                     depth=0.5, bag_h=0.23, bag_l=0.6, obj=obj, jitter=0.03)


def trailer1():
    m.use('body')
    L1 = Z1F - Z1R
    zc1 = (Z1F + Z1R) / 2
    m.box('armor', (6.7, 0.3, L1), at=(0, 2.85, zc1), bevel=0.03, seg=1)
    m.box('wood', (6.3, 0.08, L1 - 0.3), at=(0, 3.02, zc1), bevel=0)
    for i in range(int(L1 / 0.55)):
        m.box('metal_dark', (6.3, 0.02, 0.03), at=(0, 3.065, Z1F - 0.3 - i * 0.55), bevel=0)
    # parapet walls with firing slits
    slits = [[(z0, 3.75), (z0 + 0.9, 3.75), (z0 + 0.9, 4.1), (z0, 4.1)] for z0 in (1.6, -0.2, -2.0, -3.8, -5.6, -7.2)]
    for sx in (1, -1):
        m.plate('paint', [(Z1R + 0.2, 2.7), (Z1F - 0.4, 2.7), (Z1F - 0.4, 4.6), (Z1R + 0.2, 4.6)], 0.34, at=(WX * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.05, seg=1, holes=slits)
        for half in (0, 1):
            nm = 'panel_armor_t1_%s%d' % ('L' if sx > 0 else 'R', half + 1)
            zc_h = zc1 - 0.2 + (2.65 if half == 0 else -2.65)
            apanel(nm, (WX * sx + 0.2 * sx, 3.5, zc_h), **({'plastic': 'plastic', 'light_amber': 'light_amber'} if half == 0 else {}))
            wall(m, 'armor', (WX * sx + 0.18 * sx, 3.15, zc_h), (0, 0, -sx), (0, 1, 0), 5.3, 0.9, 3, 1, t=0.1, gap=0.1, rr=0.045, bevel=0.03, obj=nm)
            wall(m, 'armor', (WX * sx + 0.18 * sx, 4.43, zc_h), (0, 0, -sx), (0, 1, 0), 5.3, 0.4, 3, 1, t=0.1, gap=0.1, rr=0.04, bevel=0.03, obj=nm)
            if half == 0:
                skull(m, (WX * sx + 0.5 * sx, 3.68, -2.45), s=2.1, n=(sx, 0.05, 0), horns=True, mat='plastic', eyes='light_amber', obj=nm)
            m.use('body')
        spike_row(m, 'armor', (WX * sx + 0.3 * sx, 3.4, 2.2), (WX * sx + 0.3 * sx, 3.4, -7.8), 12, 1.0, 0.11, (sx, 0.05, 0), jitter=0.2)
        spike_row(m, 'armor', (WX * sx, 4.65, 2.3), (WX * sx, 4.65, -7.9), 10, 0.6, 0.08, (0, 1, 0), jitter=0.2)
        m.box('interior', (0.2, 1.7, 10.4), at=((WX - 0.2) * sx, 3.55, zc1), bevel=0)
        # low skirts between the wheel groups + mud flaps
        m.box('armor', (0.16, 1.0, 4.1), at=(3.25 * sx, 2.4, 0.9), bevel=0.03, seg=1)
        m.box('armor', (0.16, 1.0, 1.8), at=(3.25 * sx, 2.4, -7.5), bevel=0.03, seg=1)
        for zc in (AX['R2'], AX['T1']):
            po = [(zc + 1.62 * math.cos(t * D2R), HUBY + 1.62 * math.sin(t * D2R)) for t in range(30, 151, 10)]
            pi_ = [(zc + 1.45 * math.cos(t * D2R), HUBY + 1.45 * math.sin(t * D2R)) for t in range(150, 29, -10)]
            m.plate('armor', po + pi_, 0.2, at=(3.45 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.02, seg=1)
        m.box('rubber_tire', (0.06, 1.3, 1.2), at=(3.3 * sx, 1.2, AX['T1'] - 1.5), bevel=0.02, seg=1)
    # front prow (toward the tractor) and rear wall
    m.hull('paint', [(-3.3, 2.7, Z1F), (3.3, 2.7, Z1F), (-3.3, 4.6, Z1F - 0.3), (3.3, 4.6, Z1F - 0.3), (-2.9, 2.7, Z1F - 0.6), (2.9, 2.7, Z1F - 0.6), (-2.9, 4.6, Z1F - 0.9), (2.9, 4.6, Z1F - 0.9)], bevel=0.06, seg=2)
    wall(m, 'armor', (0, 3.6, Z1F + 0.05), (1, 0, 0), (0, 1, 0), 6.4, 1.6, 4, 2, t=0.1, gap=0.1, rr=0.045, bevel=0.03, mats=['armor', 'rust', 'armor'])
    m.plate('paint', [(-3.3, 2.7), (3.3, 2.7), (3.3, 4.6), (-3.3, 4.6)], 0.34, at=(0, 0, Z1R + 0.1), u=(1, 0, 0), v=(0, 1, 0), bevel=0.05, seg=1)
    wall(m, 'armor', (0, 3.65, Z1R - 0.08), (-1, 0, 0), (0, 1, 0), 6.4, 1.7, 4, 2, t=0.1, gap=0.1, rr=0.045, bevel=0.03, mats=['armor', 'armor', 'rust'])
    # corner towers
    for sx in (1, -1):
        for zt, top in ((2.4, 'light'), (-7.85, 'spike')):
            m.revolve('armor', [(0, 3.0), (0.9, 3.0), (0.95, 3.1), (0.85, 5.3), (0.95, 5.45), (0.95, 5.6), (0, 5.6)], at=(3.05 * sx, 0, zt), axis='y', seg=10, bevel=0.02)
            for k in range(3):
                m.revolve('armor', [(0.97, 3.5 + k * 0.7), (1.0, 3.55 + k * 0.7), (1.0, 3.62 + k * 0.7), (0.97, 3.67 + k * 0.7)], at=(3.05 * sx, 0, zt), axis='y', seg=10)
            for k in range(8):
                a = k * 45 * D2R
                m.rivet('armor', (3.05 * sx + 0.98 * math.cos(a), 4.9, zt + 0.98 * math.sin(a)), (math.cos(a), 0, math.sin(a)), r=0.05)
            if top == 'light':
                m.cyl('metal_dark', (3.05 * sx, 5.6, zt), (3.05 * sx, 6.5, zt), 0.09, seg=6)
                for k in range(3):
                    spotlight(m, (3.05 * sx + (k - 1) * 0.5 * (1 if sx > 0 else 1), 6.7, zt + 0.15), n=(sx * 0.15, -0.08, 1), r=0.3)
                m.beam('armor', (3.05 * sx - 0.85, 6.4, zt), (3.05 * sx + 0.85, 6.4, zt), 0.15, 0.12, bevel=0.01, seg=1)
            else:
                for k in range(5):
                    a = k * 72 * D2R
                    m.spike('armor', (3.05 * sx + 0.6 * math.cos(a), 5.6, zt + 0.6 * math.sin(a)), (3.05 * sx + 0.7 * math.cos(a), 6.5, zt + 0.7 * math.sin(a)), 0.1, seg=6)
                skull(m, (3.05 * sx, 6.0, zt), s=1.6, n=(0, 0.1, -1), horns=True, mat='plastic', eyes='light_amber')
    # raised central platform + stairs
    PZ0, PZ1 = 1.4, -6.9
    m.box('armor', (4.9, 0.9, PZ0 - PZ1), at=(0, 3.45, (PZ0 + PZ1) / 2), bevel=0.04, seg=1)
    m.box('wood', (4.6, 0.08, PZ0 - PZ1 - 0.3), at=(0, 3.94, (PZ0 + PZ1) / 2), bevel=0)
    for i in range(int((PZ0 - PZ1) / 0.5)):
        m.box('metal_dark', (4.6, 0.02, 0.03), at=(0, 3.985, PZ0 - 0.15 - i * 0.5), bevel=0)
    wall(m, 'armor', (2.46, 3.45, (PZ0 + PZ1) / 2), (0, 0, -1), (0, 1, 0), 8.3, 0.85, 5, 1, t=0.08, gap=0.09, rr=0.04, bevel=0.03, mats=['armor', 'paint2', 'armor'])
    wall(m, 'armor', (-2.46, 3.45, (PZ0 + PZ1) / 2), (0, 0, 1), (0, 1, 0), 8.3, 0.85, 5, 1, t=0.08, gap=0.09, rr=0.04, bevel=0.03, mats=['armor', 'paint2', 'armor'])
    # front lower deck: generator, drums, cables
    m.box('paint2', (2.2, 1.5, 1.2), at=(-1.4, 3.85, 2.2), bevel=0.06, seg=1)
    for i in range(7):
        m.box('metal_dark', (0.06, 1.1, 0.03), at=(-2.2 + i * 0.25 + 0.1, 3.85, 2.82), bevel=0)
    m.cyl('metal_dark', (-2.0, 4.6, 2.4), (-2.0, 6.0, 2.4), 0.14, seg=8)
    m.revolve('metal_dark', [(0.2, 0.0), (0.2, 0.08), (0.12, 0.14), (0.0, 0.14)], at=(-2.0, 6.0, 2.4), axis='y', seg=8)
    for i in range(3):
        m.revolve('light_amber', [(0, 0.03), (0.09, 0.02), (0.09, 0), (0, 0)], at=(-1.0 + i * 0.32, 4.3, 2.81), axis='z', seg=8)
    m.tube('rubber_tire', [(-0.9, 4.6, 2.2), (-0.4, 5.3, 2.0), (2.5, 5.9, 1.7), (2.9, 5.5, 2.2)], 0.07, seg=6, bend=0.4)
    barrel_stack(m, (1.2, DECK, 2.0), n=(3, 2), r=0.36, h=1.0)
    ladder(m, (0.0, 3.0, 1.35), (0.0, 3.9, 1.35), width=1.0, rung=0.3, side=(1, 0, 0))
    # turret rings: pedestal drums + sandbags + gun turrets
    for name, zc in (('turret_1', -0.2), ('turret_2', -5.6)):
        m.revolve('armor', [(0, PLAT_Y), (1.5, PLAT_Y), (1.55, PLAT_Y + 0.08), (1.5, PLAT_Y + 0.72), (1.2, PLAT_Y + 0.8), (0, PLAT_Y + 0.8)], at=(0, 0, zc), axis='y', seg=20, bevel=0.02)
        for k in range(20):
            a = 2 * PI * (k + 0.5) / 20
            m.rivet('armor', (1.56 * math.cos(a), PLAT_Y + 0.4, zc + 1.56 * math.sin(a)), (math.cos(a), 0, math.sin(a)), r=0.05)
        sandbag_ring(0, PLAT_Y, zc, 1.9, 3)
        gun_turret(m, name, (0, PLAT_Y + 0.8, zc), s=1.35)
    m.use('body')
    # gunner posts: little sandbag nests + labelled sockets
    GP = [(1.2, PLAT_Y, -2.4), (-1.2, PLAT_Y, -2.4), (1.2, PLAT_Y, -3.5), (-1.2, PLAT_Y, -3.5)]
    for i, p in enumerate(GP):
        m.sock('seat_gunner' if i == 0 else 'seat_gunner%d' % (i + 1), p, size=0.3)
    for sx in (1, -1):
        sandbag_wall(m, (1.85 * sx, -1.9), (1.85 * sx, -4.0), 2, PLAT_Y, depth=0.5, bag_h=0.23, bag_l=0.6)
    # missile racks on the parapets
    for sx, nm, sk in ((1, 'pod_L', 'rocket_pod_L'), (-1, 'pod_R', 'rocket_pod_R')):
        pz = -4.0
        for zz in (pz, pz + 1.5):
            m.beam('armor', (3.25 * sx, 4.6, zz), (3.15 * sx, 5.55, zz + 0.4), 0.25, 0.3, bevel=0.03, seg=1)
        m.box('armor', (1.3, 0.3, 2.6), at=(3.1 * sx, 4.65, pz + 0.7), bevel=0.03, seg=1)
        rocket_pod(m, nm, sk, (3.0 * sx, 5.75, pz), elev=22)
    # banners on the platform corners
    for sx in (1, -1):
        banner(m, (2.25 * sx, PLAT_Y, 0.8), height=4.2, w=1.5, h=2.3, facing=(0, 0, -1), skull_top=True)
        banner(m, (2.25 * sx, PLAT_Y, -6.4), height=3.6, w=1.4, h=2.0, facing=(0, 0, -1), skull_top=True)
    # rear lower deck: chained loot + crates + tyre piles
    for sx in (-1, 1):
        crate(m, (2.0 * sx, DECK + 0.5, -7.6), size=(1.3, 1.0, 1.2), rot=(0, 8 * sx, 0))
    crate(m, (0.6, DECK + 0.45, -7.7), size=(1.2, 0.9, 1.0), rot=(0, -6, 0))
    crate(m, (0.4, DECK + 1.35, -7.6), size=(0.9, 0.8, 0.9), rot=(0, 14, 0), mat='armor')
    barrel_stack(m, (-0.9, DECK, -7.7), n=(2, 2), r=0.34, h=0.95)
    tyre_pile(m, (-2.0, DECK, -7.4), n=3, R=0.75, W=0.42)
    m.box('canvas', (1.6, 0.6, 1.0), at=(1.3, DECK + 1.4, -7.8), rot=(0, 10, 0), bevel=0.2, seg=2)
    chain(m, (-2.4, DECK + 1.5, -7.2), (2.4, DECK + 1.8, -7.9), sag=0.9, link=0.3, r=0.055)
    chain(m, (-2.4, DECK + 1.2, -7.6), (2.4, DECK + 1.3, -7.5), sag=0.7, link=0.3, r=0.055)
    # bridge catwalk over the hitch to trailer 2
    catwalk(m, (0, DECK + 0.1, Z1R), (0, DECK + 0.1, -9.9), width=1.6, mat='armor')
    # ladders on the flanks
    for sx in (1, -1):
        ladder(m, (3.55 * sx, 0.9, -6.2), (3.55 * sx, 4.7, -6.2), width=0.8, rung=0.4, side=(0, 0, 1))
    BR.trailer1_rear(m)


# ================================================================================ 5. TRAILER #2  (cannon turret, fuel tanks, flame ports, ramp, reactor tower)
Z2F, Z2R = -9.7, -17.0
CANNON_Z = -12.8


def trailer2():
    m.use('body')
    L2 = Z2F - Z2R
    zc2 = (Z2F + Z2R) / 2
    m.box('armor', (5.3, 0.3, L2), at=(0, 2.85, zc2), bevel=0.03, seg=1)
    m.box('wood', (4.9, 0.08, L2 - 0.3), at=(0, 3.02, zc2), bevel=0)
    for i in range(int(L2 / 0.55)):
        m.box('metal_dark', (4.9, 0.02, 0.03), at=(0, 3.065, Z2F - 0.3 - i * 0.55), bevel=0)
    slits = [[(z0, 3.75), (z0 + 0.9, 3.75), (z0 + 0.9, 4.1), (z0, 4.1)] for z0 in (-10.3, -12.0)]
    for sx in (1, -1):
        m.plate('paint', [(Z2R + 0.2, 2.7), (Z2F - 0.1, 2.7), (Z2F - 0.1, 4.6), (Z2R + 0.2, 4.6)], 0.3, at=(2.25 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.05, seg=1, holes=slits)
        wall(m, 'armor', (2.1 * sx, 3.7, zc2 - 0.1), (0, 0, sx), (0, 1, 0), 7.0, 1.7, 5, 2, t=0.08, gap=0.09, rr=0.04, bevel=0.03, mats=['armor', 'armor', 'rust'])
        m.box('armor', (0.18, 0.5, 7.2), at=(2.4 * sx, 2.5, zc2), bevel=0.02, seg=1)
        # tank saddles
        for zz in (-11.9, -15.4):
            m.beam('armor', (2.45 * sx, 3.0, zz), (3.05 * sx, 3.5, zz), 0.34, 0.5, bevel=0.03, seg=1)
        m.box('rubber_tire', (0.06, 1.3, 1.2), at=(3.3 * sx, 1.2, AX['T2'] - 1.5), bevel=0.02, seg=1)
        po = [(AX['T2'] + 1.62 * math.cos(t * D2R), HUBY + 1.62 * math.sin(t * D2R)) for t in range(30, 151, 10)]
        pi_ = [(AX['T2'] + 1.45 * math.cos(t * D2R), HUBY + 1.45 * math.sin(t * D2R)) for t in range(150, 29, -10)]
        m.plate('armor', po + pi_, 0.2, at=(3.45 * sx, 0, 0), u=(0, 0, 1), v=(0, 1, 0), bevel=0.02, seg=1)
    # front bulkhead with a doorway to the catwalk
    m.plate('paint', [(-2.6, 2.7), (2.6, 2.7), (2.6, 4.6), (-2.6, 4.6)], 0.3, at=(0, 0, Z2F), u=(1, 0, 0), v=(0, 1, 0), bevel=0.05, seg=1, holes=[[(-0.8, 3.05), (0.8, 3.05), (0.8, 4.3), (-0.8, 4.3)]])
    # cannon pedestal drum
    m.revolve('armor', [(0, 3.0), (1.85, 3.0), (1.9, 3.1), (1.85, 4.5), (1.5, 4.65), (0, 4.65)], at=(0, 0, CANNON_Z), axis='y', seg=24, bevel=0.02)
    m.revolve('paint2', [(1.9, 3.45), (1.93, 3.5), (1.93, 3.9), (1.9, 3.95)], at=(0, 0, CANNON_Z), axis='y', seg=24)
    for k in range(28):
        a = 2 * PI * (k + 0.5) / 28
        m.rivet('armor', (1.88 * math.cos(a), 4.3, CANNON_Z + 1.88 * math.sin(a)), (math.cos(a), 0, math.sin(a)), r=0.05)
    for k in range(10):
        a = 2 * PI * k / 10
        m.spike('armor', (2.0 * math.cos(a), 3.4, CANNON_Z + 2.0 * math.sin(a)), (2.35 * math.cos(a), 3.5, CANNON_Z + 2.35 * math.sin(a)), 0.09, seg=6)
    cannon_turret(m, 'turret_main', (0, 4.65, CANNON_Z), s=0.72)
    m.use('body')
    # fuel tanks on the flanks
    fuel_tank(m, 'tank_L', (3.05, 4.1, -13.7), r=0.8, L=5.2, fuel_socket=True)
    fuel_tank(m, 'tank_R', (-3.05, 4.1, -13.7), r=0.8, L=5.2)
    # ---- reactor tower, flame nozzles, thrusters, bumper (boss_rear.py) + flank stands
    BR.rear(m)
    BR.flanks2(m)


def trailer2_panels():
    # ---- drop ramp (hinged at the deck edge) + the three bolt-on plates over the reactor (boss_rear.py)
    BR.ramp(m)
    BR.rear_plates(m)


# ================================================================================ 6. TRACTOR REAR DECK (between cab and trailer): spares, toolboxes, gladhand hoses
def rear_deck():
    m.use('body')
    m.box('armor', (6.3, 0.22, 3.25), at=(0, 2.83, 4.72), bevel=0.03, seg=1)
    m.rivet_rect('armor', (0, 2.95, 4.72), 6.3, 3.25, (0, 1, 0), u=(1, 0, 0), v=(0, 0, 1), step=0.42, r=0.05, inset=0.15)
    for i in range(7):
        m.box('metal_dark', (6.0, 0.03, 0.08), at=(0, 2.96, 3.35 + i * 0.5), bevel=0)
    for sx in (1, -1):
        railing(m, [(3.05 * sx, 2.94, 6.25), (3.05 * sx, 2.94, 3.15)], h=1.1, r=0.045, post_step=1.05, rails=(0.55, 1.1))
        m.box('paint2', (1.3, 1.0, 1.8), at=(2.3 * sx, 3.45, 4.3), bevel=0.05, seg=1)
        for k in range(3):
            m.box('metal_dark', (0.06, 0.06, 1.6), at=(2.3 * sx + 0.67 * sx, 3.45 + (k - 1) * 0.3, 4.3), bevel=0)
        m.box('armor', (1.3, 0.12, 1.9), at=(2.3 * sx, 3.98, 4.3), bevel=0.03, seg=1)
        m.hexbolt('armor', (2.3 * sx, 4.04, 4.9), (0, 1, 0), r=0.1, h=0.08)
        # spare tyres standing against the cab
        m.revolve('rubber_tire', [(0.42, -0.3), (0.86, -0.3), (0.9, -0.18), (0.9, 0.18), (0.86, 0.3), (0.42, 0.3)], at=(1.05 * sx, 3.95, 6.0), axis='z', seg=24)
        m.revolve('metal_dark', [(0, -0.32), (0.44, -0.32), (0.44, -0.24), (0, -0.24)], at=(1.05 * sx, 3.95, 5.88), axis='z', seg=14)
        for k in range(8):
            a = k * 45 * D2R
            m.hexbolt('metal_dark', (1.05 * sx + 0.3 * math.cos(a), 3.95 + 0.3 * math.sin(a), 5.7), (0, 0, -1), r=0.05, h=0.05)
        m.beam('armor', (1.05 * sx, 2.95, 5.7), (1.05 * sx, 3.5, 5.7), 0.5, 0.12, bevel=0.02, seg=1)
    m.beam('armor', (-1.9, 5.0, 6.35), (1.9, 5.0, 6.35), 0.14, 0.14, bevel=0.02, seg=1)             # tyre retaining bar
    # gladhand air/electric lines between cab and trailer (drooping hoses)
    for x, y in ((-0.5, 3.6), (-0.15, 3.5), (0.2, 3.7), (0.55, 3.55)):
        m.tube('metal_dark', [(x, y, 6.3), (x, y - 0.5, 5.4), (x * 0.6, y - 1.0, 4.3), (x * 0.5, y - 0.4, 3.2), (x * 0.5, y, 3.0)], 0.075, seg=6, bend=0.6)
    m.box('armor', (1.6, 1.2, 0.4), at=(0, 3.6, 6.4), bevel=0.04, seg=1)


# ================================================================================ 7. EXTRA STORYTELLING DETAIL
def extra_detail():
    m.use('body')
    # impaled skulls + chains hanging from the plow crown
    o = 'part_plow'
    a, b = V3((-3.5, 2.55, 15.1)), V3((3.5, 2.55, 16.25))
    d = V3((0, 0.5, 0.86)).normalized()
    for i in (1, 3, 5, 7, 9):
        base = a + (b - a) * ((i + 0.5) / 11)
        skull(m, tuple(base + d * 1.25), s=1.0, n=(0, 0.2, 1), obj=o, horns=(i % 4 == 1), mat='plastic', eyes='light_amber')
    for i in (0, 2, 4, 6, 8):
        p0 = a + (b - a) * ((i + 0.5) / 11) + d * 0.9
        p1 = a + (b - a) * ((i + 2.5) / 11) + d * 0.9
        chain(m, tuple(p0), tuple(p1), sag=0.35, link=0.22, r=0.04, obj=o)
    m.use('body')
    # pipe runs + vents along the trailer-1 parapet tops
    for sx in (1, -1):
        m.tube('metal_dark', [(3.0 * sx, 4.85, 2.0), (3.0 * sx, 4.85, -7.9)], 0.11, seg=8)
        for z in (1.5, -0.5, -2.5, -4.5, -6.5):
            m.box('metal_dark', (0.3, 0.3, 0.16), at=(3.0 * sx, 4.7, z), bevel=0.01, seg=1)
    # ammo crates + belts between the two turrets
    crate(m, (0.0, PLAT_Y + 0.35, -2.95), size=(1.0, 0.7, 0.9), rot=(0, 3, 0), mat='armor')
    crate(m, (0.15, PLAT_Y + 1.05, -2.95), size=(0.8, 0.7, 0.8), rot=(0, -10, 0), mat='armor')
    for sx in (1, -1):
        m.tube('metal_dark', [(0.4 * sx, PLAT_Y + 0.6, -2.8), (0.9 * sx, PLAT_Y + 1.0, -2.4), (1.1 * sx, PLAT_Y + 0.4, -1.9)], 0.06, seg=6, bend=0.2)
    # radio mast + dish at the rear of trailer 1
    m.cyl('metal_dark', (0.0, PLAT_Y, -6.5), (0.0, PLAT_Y + 3.6, -6.5), 0.07, seg=6)
    for k in range(3):
        m.beam('metal_dark', (-0.7, PLAT_Y + 2.2 + k * 0.55, -6.5), (0.7, PLAT_Y + 2.2 + k * 0.55, -6.5), 0.05, 0.05, bevel=0, seg=1)
    # steam / coolant pipes at the hood sides
    for sx in (1, -1):
        m.tube('chrome', [(1.55 * sx, 3.6, 11.3), (2.0 * sx, 4.2, 11.4), (2.15 * sx, 5.2, 11.5)], 0.13, seg=8, bend=0.3)


SECTS = set(x for x in os.environ.get('SECT', '').split(',') if x)


def want(k):
    return (not SECTS) or (k in SECTS)


if want('under'):
    undercarriage()
if want('tractor'):
    tractor()
    tractor_panels()
    plow_and_grille()
if want('cab'):
    cab()
    stacks()
if want('t1'):
    trailer1()
if want('t2'):
    trailer2()
    trailer2_panels()
if want('deck'):
    rear_deck()
if want('extra'):
    extra_detail()

add_proxies(m)
m.finish()
# size pass: int8 normals + uint16 atlas UVs (KHR_mesh_quantization; positions / node transforms untouched), see quantize_glb.mjs
if not os.environ.get('NO_QUANT'):
    import subprocess
    _out = os.environ.get('VEH_OUT') or OUTDIR
    _out = os.path.join(_out if os.path.isabs(_out) else os.path.join(ROOT, _out), 'boss_warrig.glb')
    subprocess.run(['node', os.path.join(HERE, 'quantize_glb.mjs'), _out], cwd=ROOT, check=True)

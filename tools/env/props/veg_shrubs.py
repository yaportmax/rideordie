"""shrub_desert_scrub, shrub_dry_bush, shrub_green_bush, fern, grass_tuft, grass_tuft_green.
   blender -b --factory-startup -P tools/env/props/veg_shrubs.py -- [scrub dry green fern grass grassg]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from vegetation_lib import *


def card_mat(name, card, rough=1.0):
    return pmat(name, albedo_file=os.path.join(PTEX, card + ".png"), alpha="MASK", double_sided=True, rough=rough, alpha_cutoff=0.45, spec=0.05, glow=0.85)


def finish_foliage(name, mb, category, H, R, notes, tint=(0.85, 0.85, 0.85), low=0.5, extra=None, seed=1, wood_names=("bark_dead", "twig_dry")):
    objs = mb.to_objects(name, shade_smooth=True, smooth_angle=60)
    fol = [o for o in objs if o.data.materials[0].name not in wood_names]
    wood = [o for o in objs if o.data.materials[0].name in wood_names]
    foliage_vcol(fol, H, R, low=low, tint=tint, seed=seed, noise_amp=0.12, top_warm=0.05, base_fade=0.25)
    for o in wood:
        bake_ao(o, samples=14, dist=0.5, strength=0.85, ground=True, gradient=0.3, floor=0.3, others=fol)
    finish(name, objs, category=category, center_xy=False, ao=None, notes=notes, extra=extra)


def scrub():
    rnd = random.Random(3)
    fol = card_mat("shrub_scrub_leaves", "card_bush_scrub")
    wood = pmat("bark_dead", tex="bark_dead", uv_m=0.9, rough=0.95)
    mb = MB()
    N = 46
    for i in range(N):
        az = i * 137.5 + rnd.uniform(-10, 10)
        r0 = rnd.uniform(0.02, 0.28)
        base = polar(az, 0) * r0 + Vector((0, 0, rnd.uniform(0.0, 0.05)))
        tilt = rnd.uniform(6, 76) if i % 6 else rnd.uniform(66, 82)       # every 4th card leans far out (drooping outer sprays)
        d = polar(az, 90 - tilt)
        hgt = rnd.uniform(0.55, 1.0) * (1.0 - 0.25 * r0 / 0.28) * (0.75 if tilt > 65 else 1.0)
        w = hgt * rnd.uniform(0.85, 1.25)
        card3d(mb, fol, base, d, hgt, w, roll=rnd.uniform(-40, 40) + (0 if i % 2 else 90), bend=polar(az, 0) * rnd.uniform(0.02, 0.22) + Vector((0, 0, -0.03 - (0.1 if tilt > 65 else 0))), seg=2, fold=10)
    for i in range(6):
        az = i * 60 + rnd.uniform(-20, 20)
        p0 = polar(az, 0) * 0.03
        pts = gnarl_pts(rnd, p0, polar(az, rnd.uniform(50, 75)), 0.4, 4)
        sweep(mb, wood, pts, [0.028, 0.02, 0.013, 0.006], seg=5, tile_m=0.9)
    finish_foliage("shrub_desert_scrub", mb, "shrub", 1.05, 0.8, "sagebrush-like desert scrub: 46 alpha-tested (MASK) cards + woody stems; ~1 m tall, 1.4 m wide", tint=(0.80, 0.78, 0.68), low=0.5, seed=2)


def gnarl_pts(rnd, p0, d0, length, n, curl=0.2):
    pts = [Vector(p0)]
    d = Vector(d0).normalized()
    step = length / (n - 1)
    for i in range(1, n):
        d = (d + Vector((rnd.gauss(0, curl), rnd.gauss(0, curl), rnd.gauss(0, curl) * 0.6))).normalized()
        pts.append(pts[-1] + d * step)
    return pts


def dry_bush():
    rnd = random.Random(14)
    twig = pmat("twig_dry", color=(0.24, 0.185, 0.11), rough=1.0)
    fol = card_mat("shrub_dry_leaves", "card_bush_dry")
    mb = MB()
    for i in range(46):
        az = i * 137.5 + rnd.uniform(-12, 12)
        el = rnd.uniform(28, 84)
        L = rnd.uniform(0.4, 0.75)
        p0 = Vector((rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), 0.03))
        pts = gnarl_pts(rnd, p0, polar(az, el), L, 5, curl=0.35)
        # arch over: pull the tips downward a little so the twigs form a dome
        for k in range(len(pts)):
            pts[k].z -= 0.14 * (k / 4.0) ** 2
            pts[k].z = max(pts[k].z, 0.02)
        sweep(mb, twig, pts, [0.016, 0.012, 0.009, 0.006, 0.0025], seg=3, tile_m=1.0)
        if i % 3 != 2:
            e = pts[-1]
            dl = (pts[-1] - pts[-2]).normalized()
            card3d(mb, fol, pts[2], dl, 0.34, 0.34, roll=rnd.uniform(0, 180), bend=Vector((0, 0, -0.05)), seg=1, fold=0)
    finish_foliage("shrub_dry_bush", mb, "shrub", 1.0, 0.7, "dry dead shrub / tumbleweed-like: 34 woody twigs + a few papery leaf cards; ~0.9 m", tint=(0.78, 0.74, 0.66), low=0.55, seed=5)


def green_bush():
    rnd = random.Random(31)
    fol = card_mat("shrub_green_leaves", "card_bush_green")
    wood = pmat("bark_dead", tex="bark_dead", uv_m=0.9, rough=0.95)
    mb = MB()
    N = 64
    for i in range(N):
        az = i * 137.5 + rnd.uniform(-8, 8)
        zr = (i % 9) / 8.0
        r0 = rnd.uniform(0.0, 0.25)
        base = polar(az, 0) * r0 + Vector((0, 0, 0.05 + zr * 0.25))
        tilt = 12 + 62 * (1 - zr) + rnd.uniform(-8, 10)
        if i % 8 == 0:
            tilt = rnd.uniform(72, 84)                                 # low drooping sprays
        d = polar(az, 90 - tilt)
        hgt = rnd.uniform(0.5, 0.8)
        card3d(mb, fol, base, d, hgt, hgt * rnd.uniform(0.9, 1.2), roll=rnd.uniform(-45, 45) + (0 if i % 2 else 80), bend=polar(az, 0) * rnd.uniform(0.0, 0.15) + Vector((0, 0, -0.05)), seg=2, fold=8)
    for i in range(3):
        az = i * 120
        sweep(mb, wood, gnarl_pts(rnd, polar(az, 0) * 0.04, polar(az, 72), 0.55, 4), [0.035, 0.028, 0.02, 0.01], seg=5, tile_m=0.9)
    finish_foliage("shrub_green_bush", mb, "shrub", 1.25, 0.8, "green broadleaf bush (coast / lower biomes): 64 alpha-tested cards + 3 stems; dark green; ~1.2 m", tint=(0.78, 0.77, 0.66), low=0.45, seed=7)


def fern():
    rnd = random.Random(8)
    fol = card_mat("fern_fronds", "card_fern")
    mb = MB()
    N = 34
    for i in range(N):
        az = i * 137.5 + rnd.uniform(-8, 8)
        el = rnd.uniform(24, 76)
        L = rnd.uniform(0.62, 0.95)
        w = L * rnd.uniform(0.62, 0.8)
        base = polar(az, 0) * 0.02
        card3d(mb, fol, base, polar(az, el), L, w, roll=rnd.uniform(-10, 10), bend=Vector((0, 0, -L * rnd.uniform(0.3, 0.55))), seg=3, fold=22)
    finish_foliage("fern", mb, "shrub", 0.8, 0.6, "fern clump: 34 arching V-folded frond cards (MASK); ~0.7 m tall, 1.4 m wide", tint=(0.72, 0.76, 0.70), low=0.5, seed=9)


def grass_tuft(green=False):
    rnd = random.Random(6 if not green else 16)
    fol = card_mat("grass_green" if green else "grass_dry", "card_grass_green" if green else "card_grass_dry")
    stk = card_mat("grass_stalks_green" if green else "grass_stalks_dry", "card_grass_stalks_green" if green else "card_grass_stalks_dry")
    mb = MB()
    H = 0.5 if not green else 0.42
    for k in range(5):
        card3d(mb, fol, Vector((0, 0, 0)), Vector((0, 0, 1)), H * rnd.uniform(0.9, 1.08), H * 1.1, roll=k * 36 + rnd.uniform(-5, 5), seg=3, bend=Vector((0, 0, 0)), fold=0)
    for az in (20, 110, 200, 290):
        card3d(mb, fol, polar(az, 0) * 0.02, polar(az, 72), H * 0.95, H * 0.95, roll=0, seg=3, bend=polar(az, 0) * 0.06 + Vector((0, 0, -0.05)), fold=14)
    for k, az in enumerate((70, 250)):                                       # a few taller seed stalks
        card3d(mb, stk, polar(az, 0) * 0.03, polar(az, 84), H * 1.9, H * 1.0, roll=0, seg=3, bend=polar(az, 0) * 0.10 + Vector((0, 0, -0.04)), fold=6)
    finish_foliage("grass_tuft_green" if green else "grass_tuft", mb, "grass", H * 1.9, 0.4,
                   ("green" if green else "dry golden") + " grass tuft: 5 crossed blade cards + 4 leaning fans + 2 taller seed-stalk cards (MASK, double-sided), ~%.2f m (stalks %.2f m)" % (H, H * 1.9),
                   tint=(0.7, 0.7, 0.66), low=0.6, seed=3, extra=None)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    todo = args or ["scrub", "dry", "green", "fern", "grass", "grassg"]
    fn = {"scrub": scrub, "dry": dry_bush, "green": green_bush, "fern": fern, "grass": lambda: grass_tuft(False), "grassg": lambda: grass_tuft(True)}
    for t in todo:
        new_scene()
        fn[t]()

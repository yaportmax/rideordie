"""dead_tree_a/b/c and palm_coast.   blender -b --factory-startup -P tools/env/props/veg_trees.py -- [dead_a dead_b dead_c palm]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from vegetation_lib import *


def lerp_pts(pts, t):
    n = len(pts) - 1
    f = t * n
    i = min(n - 1, int(f))
    return pts[i].lerp(pts[i + 1], f - i), (pts[i + 1] - pts[i]).normalized()


def gnarl(rnd, p0, d0, length, n, curl=0.28, up=0.0, twist=0.0):
    """random-walk limb path with n points"""
    pts = [Vector(p0)]
    d = Vector(d0).normalized()
    step = length / (n - 1)
    for i in range(1, n):
        d = (d + Vector((rnd.gauss(0, curl), rnd.gauss(0, curl), rnd.gauss(0, curl) * 0.7 + up))).normalized()
        if twist:
            d = rot_about(d, Z, twist * D2R)
        pts.append(pts[-1] + d * step)
    return pts


def branch(mb, m, rnd, p0, d0, length, r0, r1, depth, tile=0.9, seg=6, rings=6, curl=0.3, up=0.12, sub=(2, 2), twig_len=(0.35, 0.8)):
    """recursive dead branch: sweep + sub-branches + twigs"""
    pts = gnarl(rnd, p0, d0, length, rings, curl, up)
    radii = [r0 + (r1 - r0) * (i / (rings - 1)) ** 0.85 for i in range(rings)]
    sweep(mb, m, pts, radii, seg=seg, tile_m=tile, cap_end=True)
    if depth <= 0:
        return
    nsub = rnd.randint(*sub)
    for k in range(nsub):
        t = rnd.uniform(0.3, 0.85)
        p, d = lerp_pts(pts, t)
        rr = r0 + (r1 - r0) * t ** 0.85
        # deviate 30-65 deg, mostly outward/up
        ang = rnd.choice((-1, 1)) * math.radians(rnd.uniform(28, 62))
        ax = d.cross(Z)
        if ax.length < 1e-3:
            ax = Vector((1, 0, 0))
        nd = rot_about(d, ax.normalized(), ang)
        nd = rot_about(nd, d, math.radians(rnd.uniform(0, 360)))
        nd.z += 0.25
        L2 = length * rnd.uniform(0.35, 0.6) * (1 - t * 0.5)
        L2 = max(L2, twig_len[0])
        branch(mb, m, rnd, p, nd, L2, max(rr * 0.6, 0.018), 0.008, depth - 1, tile, max(4, seg - 1), max(3, rings - 2), curl, up, sub, twig_len)


def trunk_radius(t, R, top_r, flare=0.45):
    r = R + (top_r - R) * t ** 0.9
    r *= 1.0 + flare * max(0.0, 1.0 - t * 9.0) ** 2
    return r


def dead_tree(key):
    rnd = random.Random({"a": 5, "b": 17, "c": 29}[key])
    bark = pmat("bark_dead", tex="bark_dead", uv_m=0.9, rough=0.95, normal_strength=1.2)
    mb = MB()
    if key == "a":
        # tall, straight-ish, broken top, spiralling limbs
        H = 7.6
        pts = wobble_path((0, 0, 0), (0.35, -0.25, H), 15, 0.22, 3, up_bias=0.0)
        R, top_r = 0.36, 0.09
        radii = [trunk_radius(i / 14.0, R, top_r) * (1 + 0.10 * mnoise.noise(Vector((i * 0.7, 1.3, 2.1)))) for i in range(15)]
        sweep(mb, bark, pts, radii, seg=9, tile_m=0.9)
        # roots
        for k in range(4):
            a = k * 90 + rnd.uniform(-20, 20)
            d = polar(a, -25)
            p0 = Vector((0, 0, 0.35)) + polar(a, 0) * 0.15
            pts_r = gnarl(rnd, p0, d, 0.9, 4, 0.15)
            sweep(mb, bark, pts_r, [0.14, 0.09, 0.05, 0.02], seg=5, tile_m=0.9)
        n = 8
        for k in range(n):
            t = 0.36 + 0.55 * k / (n - 1)
            p, d = lerp_pts(pts, t)
            rr = radii[min(14, int(t * 14))] * 0.55
            az = k * 137.5 + rnd.uniform(-15, 15)
            el = rnd.uniform(22, 55)
            L = (2.9 - 1.5 * (t - 0.36)) * rnd.uniform(0.75, 1.15)
            branch(mb, bark, rnd, p + polar(az, 0) * radii[min(14, int(t * 14))] * 0.4, polar(az, el), L, rr * 0.55, 0.02, 2, sub=(2, 3), curl=0.25)
        # broken splinter at the top
        for k in range(2):
            top = pts[-1]
            d = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 1)).normalized()
            sweep(mb, bark, [top - Vector((0, 0, 0.1)), top + d * 0.35, top + d * 0.8], [0.07, 0.05, 0.0], seg=5, tile_m=0.9, cap_end=False)
    elif key == "b":
        # leaning fork
        pts = wobble_path((0, 0, 0), (0.9, 0.2, 3.4), 9, 0.18, 7)
        R = 0.34
        radii = [trunk_radius(i / 8.0, R, 0.24) for i in range(9)]
        sweep(mb, bark, pts, radii, seg=9, tile_m=0.9)
        fork = pts[-1]
        for (H2, dx, dy, r_top, seedk) in ((3.9, -1.1, 0.3, 0.06, 1), (2.6, 1.7, -0.6, 0.05, 2)):
            end = fork + Vector((dx, dy, H2))
            fp = wobble_path(fork - Vector((0, 0, 0.05)), end, 10, 0.16, 11 + seedk)
            fr = [0.24 - (0.24 - r_top) * (i / 9.0) ** 0.8 for i in range(10)]
            sweep(mb, bark, fp, fr, seg=8, tile_m=0.9)
            for k in range(4):
                t = rnd.uniform(0.3, 0.9)
                p, d = lerp_pts(fp, t)
                az = rnd.uniform(0, 360)
                branch(mb, bark, rnd, p, polar(az, rnd.uniform(15, 50)), rnd.uniform(1.4, 2.5), 0.09, 0.02, 2, sub=(1, 3), curl=0.22)
        # main lower limbs on the trunk
        for k in range(3):
            t = 0.45 + 0.15 * k
            p, d = lerp_pts(pts, t)
            az = 200 + k * 120 + rnd.uniform(-20, 20)
            branch(mb, bark, rnd, p, polar(az, rnd.uniform(-5, 25)), rnd.uniform(1.8, 2.8), 0.11, 0.02, 2, sub=(2, 3), curl=0.26, up=0.05)
        # snapped stub
        p, d = lerp_pts(pts, 0.28)
        sweep(mb, bark, [p, p + polar(60, 30) * 0.5, p + polar(60, 40) * 0.95], [0.1, 0.085, 0.07], seg=6, tile_m=0.9, cap_end=True)
        for k in range(2):
            a = 110 + k * 160
            pts_r = gnarl(rnd, Vector((0, 0, 0.3)) + polar(a, 0) * 0.15, polar(a, -20), 0.8, 4, 0.15)
            sweep(mb, bark, pts_r, [0.13, 0.08, 0.045, 0.02], seg=5, tile_m=0.9)
    else:
        # twisted multi-stem snag (mesquite skeleton)
        for s in range(3):
            a0 = s * 120 + rnd.uniform(-20, 20)
            n = 8
            pts = []
            for i in range(n):
                t = i / (n - 1)
                rad = 0.15 + 0.7 * t ** 1.2 * (0.7 + 0.3 * s)
                ang = math.radians(a0 + 140 * t * (1 if s % 2 == 0 else -1))
                pts.append(Vector((math.cos(ang) * rad * (0.4 + 0.6 * t), math.sin(ang) * rad * (0.4 + 0.6 * t), 3.9 * (0.75 + 0.1 * s) * t)))
            radii = [0.20 * (1 - 0.86 * (i / (n - 1)) ** 0.8) * (1 + 0.5 * max(0, 1 - i * 0.6) ** 2) + 0.012 for i in range(n)]
            sweep(mb, bark, pts, radii, seg=7, tile_m=0.9)
            for k in range(4):
                t = 0.3 + 0.65 * k / 3
                p, d = lerp_pts(pts, t)
                az = a0 + rnd.uniform(-90, 90) + k * 70
                branch(mb, bark, rnd, p, polar(az, rnd.uniform(20, 65)), rnd.uniform(0.9, 1.7), 0.05, 0.012, 2, seg=5, rings=5, sub=(1, 3), curl=0.3, twig_len=(0.25, 0.5))
        # exposed roots
        for k in range(5):
            a = k * 72 + rnd.uniform(-20, 20)
            pts_r = gnarl(rnd, Vector((0, 0, 0.25)) + polar(a, 0) * 0.1, polar(a, -18), rnd.uniform(0.7, 1.1), 4, 0.12)
            sweep(mb, bark, pts_r, [0.12, 0.07, 0.04, 0.015], seg=5, tile_m=0.9)
    objs = mb.to_objects("dead_tree_" + key, shade_smooth=True)
    for o in objs:
        bake_ao(o, samples=22, dist=1.3, strength=0.85, ground=True, gradient=0.25, floor=0.3, tint=(1.0, 0.95, 0.9))
    finish("dead_tree_" + key, objs, category="tree_dead", center_xy=False, ao=None,
           notes="bare weathered snag, bark_dead texture (0.9 m/tile), origin at trunk base, no alpha cards")


def palm():
    rnd = random.Random(41)
    bark = pmat("bark_palm", tex="bark_palm", uv_m=1.2, rough=0.9, normal_strength=1.0)
    fr = pmat("palm_fronds", albedo_file=os.path.join(PTEX, "card_palm_frond.png"), alpha="MASK", double_sided=True, rough=1.0, alpha_cutoff=0.45)
    coco = pmat("palm_coconut", color=(0.22, 0.20, 0.07), rough=0.7)
    mb = MB()
    H = 8.6
    nr = 46
    pts, radii = [], []
    for i in range(nr + 1):
        t = i / nr
        pts.append(Vector((1.7 * t ** 1.7 + 0.25 * math.sin(t * 5.0) * t, 0.5 * math.sin(t * 2.6) * t, H * t)))
        z = H * t
        r = 0.25 * (1 - 0.42 * t) + 0.16 * max(0.0, 1 - t * 9) ** 2
        r *= 1.0 + 0.055 * math.cos(2 * math.pi * z / 0.32)
        radii.append(r)
    sweep(mb, bark, pts, radii, seg=8, tile_m=1.2, cap_end=True)
    crown = pts[-1]
    mb.sphere(bark, crown + Vector((0, 0, 0.08)), (0.30, 0.30, 0.24), subdiv=1)
    nf = 19
    for i in range(nf):
        zr = i / (nf - 1)
        el = 62 - 100 * zr + rnd.uniform(-6, 6)               # upper fronds first (steep) -> lower fronds droop
        az = i * 137.5 + rnd.uniform(-8, 8)
        L = 3.7 * (0.75 + 0.25 * math.sin(zr * 3.1)) * rnd.uniform(0.9, 1.1)
        w = 1.7 * rnd.uniform(0.92, 1.06)
        d = polar(az, el)
        droop = L * (0.30 + 0.45 * zr)
        card3d(mb, fr, crown + Vector((0, 0, 0.12)) + polar(az, 0) * 0.14, d, L, w, roll=rnd.uniform(-6, 6), bend=Vector((0, 0, -droop)), seg=4, fold=24)
    for i in range(5):
        a = i * 72 + 20
        mb.sphere(coco, crown + Vector((0, 0, -0.12)) + polar(a, 0) * 0.28, (0.13, 0.13, 0.15), subdiv=1)
    objs = mb.to_objects("palm_coast", shade_smooth=True)
    foliage = [o for o in objs if o.data.materials[0].name == "palm_fronds"]
    others = [o for o in objs if o.data.materials[0].name != "palm_fronds"]
    foliage_vcol(foliage, H + 2, 3.6, center=(crown.x, crown.y), low=0.55, tint=(0.85, 0.85, 0.82), seed=4, noise_amp=0.1)
    for o in others:
        bake_ao(o, samples=18, dist=1.5, strength=0.8, ground=True, gradient=0.2, floor=0.3, others=foliage)
    finish("palm_coast", objs, category="tree_palm", center_xy=False, ao=None,
           notes="coastal palm: ringed bark_palm trunk (curved, leans +X), 15 alpha-tested (MASK) V-folded frond cards, coconuts; origin at trunk base")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    todo = args or ["dead_a", "dead_b", "dead_c", "palm"]
    for t in todo:
        new_scene()
        if t.startswith("dead_"):
            dead_tree(t[-1])
        else:
            palm()

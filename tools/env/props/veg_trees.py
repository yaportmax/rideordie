"""dead_tree_a/b/c and palm_coast (round 2).   blender -b --factory-startup -P tools/env/props/veg_trees.py -- [dead_a dead_b dead_c palm]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from vegetation_lib import *


def lerp_pts(pts, t):
    n = len(pts) - 1
    f = t * n
    i = min(n - 1, int(f))
    return pts[i].lerp(pts[i + 1], f - i), (pts[i + 1] - pts[i]).normalized()


def gnarl(rnd, p0, d0, length, n, curl=0.28, up=0.0, twist=0.0):
    pts = [Vector(p0)]
    d = Vector(d0).normalized()
    step = length / (n - 1)
    for i in range(1, n):
        d = (d + Vector((rnd.gauss(0, curl), rnd.gauss(0, curl), rnd.gauss(0, curl) * 0.7 + up))).normalized()
        if twist:
            d = rot_about(d, Z, twist * D2R)
        pts.append(pts[-1] + d * step)
    return pts


def branch(mb, m, rnd, p0, d0, length, r0, r1, depth, tile=0.9, seg=6, rings=6, curl=0.3, up=0.12, sub=(2, 2), twig_len=(0.35, 0.8), broken=False):
    """recursive dead branch: sweep + sub-branches + twigs.  broken=True: thick stump with a jagged end"""
    pts = gnarl(rnd, p0, d0, length, rings, curl, up)
    radii = [r0 + (r1 - r0) * (i / (rings - 1)) ** 0.85 for i in range(rings)]
    sweep(mb, m, pts, radii, seg=seg, tile_m=tile, cap_end=True)
    if broken:
        e = pts[-1]
        for k in range(2):
            d = (pts[-1] - pts[-2]).normalized() + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(0.2, 0.7)))
            sweep(mb, m, [e - d.normalized() * 0.05, e + d.normalized() * 0.18, e + d.normalized() * 0.42], [radii[-1] * 0.8, radii[-1] * 0.5, 0.0], seg=4, tile_m=tile, cap_end=False)
        return
    if depth <= 0:
        return
    nsub = rnd.randint(*sub)
    for k in range(nsub):
        t = rnd.uniform(0.3, 0.85)
        p, d = lerp_pts(pts, t)
        rr = r0 + (r1 - r0) * t ** 0.85
        ang = rnd.choice((-1, 1)) * math.radians(rnd.uniform(28, 62))
        ax = d.cross(Z)
        if ax.length < 1e-3:
            ax = Vector((1, 0, 0))
        nd = rot_about(d, ax.normalized(), ang)
        nd = rot_about(nd, d, math.radians(rnd.uniform(0, 360)))
        nd.z += 0.25
        L2 = max(length * rnd.uniform(0.35, 0.6) * (1 - t * 0.5), twig_len[0])
        branch(mb, m, rnd, p, nd, L2, max(rr * 0.6, 0.018), 0.008, depth - 1, tile, max(4, seg - 1), max(3, rings - 2), curl, up, sub, twig_len)


def trunk_radius(t, R, top_r, flare=0.45):
    r = R + (top_r - R) * t ** 0.9
    r *= 1.0 + flare * max(0.0, 1.0 - t * 9.0) ** 2
    return r


def roots(mb, bark, rnd, R, n=4, length=(1.1, 1.7), r0=0.15):
    for k in range(n):
        a = k * 360.0 / n + rnd.uniform(-28, 28)
        o = polar(a, 0)
        L = rnd.uniform(*length)
        ctrl = [o * R * 0.3 + Vector((0, 0, 0.62)), o * (R * 0.9) + Vector((0, 0, 0.42)), o * (R + 0.4 * L) + Vector((0, 0, 0.2)),
                o * (R + 0.8 * L) + Vector((0, 0, 0.07)), o * (R + L) + Vector((0, 0, 0.02))]
        path = catmull(ctrl, 8)
        rr = [r0 * (1 - 0.86 * (i / 7.0)) * rnd.uniform(0.92, 1.08) + 0.012 for i in range(8)]
        sweep(mb, bark, path, rr, seg=5, tile_m=0.9)


def dead_tree(key):
    rnd = random.Random({"a": 5, "b": 17, "c": 29}[key])
    bark = pmat("bark_dead", tex="bark_dead", uv_m=0.9, rough=0.95, normal_strength=1.3)
    mb = MB()
    if key == "a":
        # tall windswept spire: fluted twisted trunk, limbs on one side, jagged broken top
        H = 7.2
        n = 17
        pts = wobble_path((0, 0, 0), (0.85, -0.5, H), n, 0.5, 3, up_bias=0.0)
        R, top_r = 0.37, 0.075
        radii = [trunk_radius(i / (n - 1.0), R, top_r, 0.55) * (1 + 0.09 * mnoise.noise(Vector((i * 0.7, 1.3, 2.1)))) for i in range(n)]
        sweep(mb, bark, pts, radii, seg=12, tile_m=0.9, shape=fluted(0.13, 3, 1.5))
        roots(mb, bark, rnd, R, 4, (1.2, 1.8), 0.16)
        az_w = 35.0
        for k in range(9):
            t = 0.28 + 0.66 * k / 8.0
            p, d = lerp_pts(pts, t)
            rr = radii[min(n - 1, int(t * (n - 1)))] * 0.55
            az = az_w + rnd.uniform(-80, 80)
            el = rnd.uniform(10, 42)
            L = (3.3 - 1.7 * (t - 0.30)) * rnd.uniform(0.8, 1.15)
            branch(mb, bark, rnd, p + polar(az, 0) * radii[min(n - 1, int(t * (n - 1)))] * 0.4, polar(az, el), L, rr * 0.55, 0.02, 2, sub=(1, 3), curl=0.25, rings=6)
        for k in range(2):                                            # leeward snapped stubs
            t = rnd.uniform(0.35, 0.6)
            p, d = lerp_pts(pts, t)
            az = az_w + 180 + rnd.uniform(-40, 40)
            branch(mb, bark, rnd, p, polar(az, rnd.uniform(15, 35)), 0.7, 0.09, 0.06, 0, rings=4, seg=6, broken=True)
        top = pts[-1]
        for k in range(3):
            d = Vector((rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), 1)).normalized()
            sweep(mb, bark, [top - Vector((0, 0, 0.12)), top + d * 0.4, top + d * (0.85 + 0.2 * k)], [0.075 - 0.012 * k, 0.05, 0.0], seg=5, tile_m=0.9, cap_end=False)
    elif key == "b":
        # broad forked candelabra: short fat trunk, three big curving limbs, one broken
        n = 8
        pts = wobble_path((0, 0, 0), (0.25, 0.1, 2.3), n, 0.15, 7)
        R = 0.44
        radii = [trunk_radius(i / (n - 1.0), R, 0.34, 0.5) for i in range(n)]
        sweep(mb, bark, pts, radii, seg=12, tile_m=0.9, shape=fluted(0.16, 3, 0.9, 0.5, 0.7))
        roots(mb, bark, rnd, R, 4, (1.3, 2.0), 0.19)
        F = pts[-1]
        for li, (az, brk) in enumerate(((rnd.uniform(-15, 15), False), (128 + rnd.uniform(-15, 15), True), (248 + rnd.uniform(-15, 15), False))):
            o = polar(az, 0)
            reach = rnd.uniform(2.4, 3.2)
            ctrl = [F - Vector((0, 0, 0.1)), F + o * 0.45 + Vector((0, 0, 0.9)), F + o * (reach * 0.55) + Vector((0, 0, 1.9)),
                    F + o * reach + Vector((0, 0, 3.1)), F + o * (reach * 1.08) + Vector((0, 0, 4.1 - (1.0 if brk else 0.0)))]
            path = catmull(ctrl, 11)
            rr = [0.225 * (1 - 0.75 * (i / 10.0) ** 0.8) + 0.03 for i in range(11)]
            if brk:
                path = path[:9]
                rr = rr[:9]
            sweep(mb, bark, path, rr, seg=8, tile_m=0.9, shape=fluted(0.08, 3, 1.0, 0.4, li))
            if brk:
                e = path[-1]
                for k in range(3):
                    d = Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), 1)).normalized()
                    sweep(mb, bark, [e - d * 0.05, e + d * 0.25, e + d * (0.6 + 0.2 * k)], [rr[-1] * 0.85, rr[-1] * 0.5, 0.0], seg=5, tile_m=0.9, cap_end=False)
            nsl = 2 if brk else 4
            for k in range(nsl):
                t = 0.35 + 0.5 * k / max(1, nsl - 1) + rnd.uniform(-0.05, 0.05)
                p, d = lerp_pts(path, min(0.95, t))
                a2 = az + rnd.choice((-1, 1)) * rnd.uniform(35, 95)
                branch(mb, bark, rnd, p, polar(a2, rnd.uniform(20, 55)), rnd.uniform(1.3, 2.2), 0.10, 0.02, 2, sub=(1, 2), curl=0.24, rings=6)
        # low dead bough drooping off the trunk
        p, d = lerp_pts(pts, 0.4)
        branch(mb, bark, rnd, p, polar(215, -12), 2.4, 0.13, 0.03, 2, sub=(2, 3), curl=0.22, up=-0.03)
    else:
        # low twisted multi-stem snag (mesquite skeleton), knotty and spiralling, with a dead horizontal bough
        for s_ in range(3):
            a0 = s_ * 120 + rnd.uniform(-20, 20)
            n = 9
            pts = []
            for i in range(n):
                t = i / (n - 1.0)
                rad = 0.15 + 0.8 * t ** 1.2 * (0.7 + 0.3 * s_)
                ang = math.radians(a0 + 160 * t * (1 if s_ % 2 == 0 else -1))
                pts.append(Vector((math.cos(ang) * rad * (0.4 + 0.6 * t), math.sin(ang) * rad * (0.4 + 0.6 * t), 4.1 * (0.72 + 0.12 * s_) * t)))
            radii = [(0.21 * (1 - 0.87 * (i / (n - 1.0)) ** 0.8) * (1 + 0.5 * max(0, 1 - i * 0.6) ** 2) + 0.012) * (1 + 0.12 * math.sin(i * 2.3 + s_)) for i in range(n)]
            sweep(mb, bark, pts, radii, seg=8, tile_m=0.9, shape=fluted(0.15, 2, 1.4, 0.5, s_ * 2.0))
            for k in range(4):
                t = 0.28 + 0.66 * k / 3
                p, d = lerp_pts(pts, t)
                az = a0 + rnd.uniform(-90, 90) + k * 70
                branch(mb, bark, rnd, p, polar(az, rnd.uniform(20, 65)), rnd.uniform(0.9, 1.7), 0.05, 0.012, 2, seg=5, rings=5, sub=(1, 3), curl=0.3, twig_len=(0.25, 0.5))
        roots(mb, bark, rnd, 0.28, 3, (0.9, 1.4), 0.12)
        branch(mb, bark, rnd, Vector((0.1, 0.05, 0.95)), polar(70, 6), 1.9, 0.1, 0.02, 2, sub=(2, 3), curl=0.2, rings=6, up=-0.02)
        branch(mb, bark, rnd, Vector((-0.1, 0.1, 1.5)), polar(250, 30), 0.6, 0.07, 0.05, 0, rings=4, broken=True)
    objs = mb.to_objects("dead_tree_" + key, shade_smooth=True)
    for o in objs:
        bake_ao(o, samples=20, dist=1.3, strength=0.9, ground=True, gradient=0.25, floor=0.28, tint=(1.0, 0.95, 0.9))
    finish("dead_tree_" + key, objs, category="tree_dead", center_xy=False, ao=None,
           notes={"a": "tall windswept dead spire: fluted twisted trunk, one-sided limbs, snapped stubs + jagged top, 4 exposed roots",
                  "b": "broad forked dead candelabra: short fat trunk, three curving limbs (one snapped), low drooping bough, exposed roots",
                  "c": "low twisted multi-stem dead mesquite: spiralling knotty stems, dead horizontal bough, exposed roots"}[key] +
                 "; bark_dead texture 0.9 m/tile, origin at trunk base, no alpha cards")


def palm():
    rnd = random.Random(41)
    bark = pmat("bark_palm", tex="bark_palm", uv_m=1.2, rough=0.9, normal_strength=1.0)
    fr = pmat("palm_fronds", albedo_file=os.path.join(PTEX, "card_palm_frond.png"), alpha="MASK", double_sided=True, rough=1.0, alpha_cutoff=0.45, spec=0.08, glow=0.85)
    frd = pmat("palm_fronds_dry", albedo_file=os.path.join(PTEX, "card_palm_frond_dry.png"), alpha="MASK", double_sided=True, rough=1.0, alpha_cutoff=0.45, spec=0.05, glow=0.65)
    coco = pmat("palm_coconut", color=(0.20, 0.17, 0.06), rough=0.7)
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
        el = 62 - 100 * zr + rnd.uniform(-6, 6)
        az = i * 137.5 + rnd.uniform(-8, 8)
        L = 3.7 * (0.75 + 0.25 * math.sin(zr * 3.1)) * rnd.uniform(0.9, 1.1)
        w = 1.7 * rnd.uniform(0.92, 1.06)
        d = polar(az, el)
        droop = L * (0.30 + 0.45 * zr)
        card3d(mb, fr, crown + Vector((0, 0, 0.12)) + polar(az, 0) * 0.14, d, L, w, roll=rnd.uniform(-6, 6), bend=Vector((0, 0, -droop)), seg=4, fold=24)
    for i in range(4):                                                  # dead brown fronds hanging below the crown
        az = i * 95 + 30 + rnd.uniform(-15, 15)
        card3d(mb, frd, crown + Vector((0, 0, -0.05)) + polar(az, 0) * 0.22, polar(az, -68 + rnd.uniform(-10, 8)), 2.7 * rnd.uniform(0.9, 1.1), 1.4, roll=rnd.uniform(-8, 8),
               bend=Vector((0, 0, -0.5)) + polar(az, 0) * 0.25, seg=3, fold=20)
    for i in range(5):
        a = i * 72 + 20
        mb.sphere(coco, crown + Vector((0, 0, -0.12)) + polar(a, 0) * 0.28, (0.13, 0.13, 0.15), subdiv=1)
    objs = mb.to_objects("palm_coast", shade_smooth=True)
    foliage = [o for o in objs if o.data.materials[0].name.startswith("palm_fronds")]
    others = [o for o in objs if not o.data.materials[0].name.startswith("palm_fronds")]
    foliage_vcol(foliage, H + 2, 3.6, center=(crown.x, crown.y), low=0.6, tint=(0.80, 0.80, 0.76), seed=4, noise_amp=0.1)
    for o in others:
        bake_ao(o, samples=16, dist=1.5, strength=0.8, ground=True, gradient=0.2, floor=0.3, others=foliage)
    finish("palm_coast", objs, category="tree_palm", center_xy=False, ao=None,
           notes="coastal palm: ringed bark_palm trunk (curved, leans +X), 19 green + 4 dry brown alpha-tested (MASK) V-folded frond cards, coconuts; origin at trunk base")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    todo = args or ["dead_a", "dead_b", "dead_c", "palm"]
    for t in todo:
        new_scene()
        if t.startswith("dead_"):
            dead_tree(t[-1])
        else:
            palm()

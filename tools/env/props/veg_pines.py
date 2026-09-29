"""pine_a / pine_b / pine_c  (+ _lod, + _billboard).   Round 2: real branch tubes carrying many small needle-cluster cards.
   blender -b --factory-startup -P tools/env/props/veg_pines.py -- [a b c] [--only full|lod|bb]
   The billboard is baked FROM the finished pine GLB by tools/env/render_billboards.py (run it between 'full' and 'bb')."""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from vegetation_lib import *

PINES = {
    # H height, R trunk base radius, crown0 crown start (fraction), Lmax longest (lowest) branch, gap mean level spacing, per branches per level,
    # e0/e1 branch elevation at bottom/top of the crown (deg), card = needle sprig texture, cardL = (card length at bottom, at top), dead_low = bare dead lowest branches
    "a": dict(H=14.0, R=0.34, crown0=0.20, Lmax=3.3, gap=0.50, per=(3, 4), e0=-30, e1=24, sway=0.40, card="card_pine_a", cardL=(2.4, 1.15), dead_low=5, stubs=0, seed=3, asym=0.28, tint=(0.84, 0.84, 0.80), lod_wr=1.45),
    "b": dict(H=16.5, R=0.42, crown0=0.42, Lmax=2.5, gap=0.46, per=(3, 4), e0=-22, e1=32, sway=0.80, card="card_pine_b", cardL=(2.6, 1.4), dead_low=0, stubs=12, seed=8, asym=0.32, tint=(0.86, 0.85, 0.78), lod_wr=1.5),
    "c": dict(H=9.5, R=0.26, crown0=0.12, Lmax=2.4, gap=0.38, per=(3, 4), e0=-26, e1=20, sway=0.18, card="card_pine_c", cardL=(1.8, 0.95), dead_low=2, stubs=0, seed=12, asym=0.18, tint=(0.82, 0.84, 0.80), lod_wr=1.4),
}


def mats_for(key):
    bark = pmat("bark_pine", tex="bark_pine", uv_m=1.6, rough=0.95, normal_strength=1.0)
    fol = pmat("pine_needles_" + key, albedo_file=os.path.join(PTEX, PINES[key]["card"] + ".png"), alpha="MASK", double_sided=True, rough=1.0, alpha_cutoff=0.45)
    return bark, fol


def trunk(mb, bark, P, rnd, lod=False):
    H, R = P["H"], P["R"]
    sway, ph = P["sway"], rnd.uniform(0, 6.28)

    def tpos(z):
        t = z / H
        return Vector((sway * math.sin(t * 2.3 + ph) * t ** 1.3, sway * 0.6 * math.cos(t * 1.7 + ph) * t ** 1.3, z))
    nrings = 5 if lod else 15
    pts, rad = [], []
    for i in range(nrings + 1):
        z = H * 0.997 * i / nrings
        t = z / H
        r = R * (1 - t) ** 0.82 + 0.018
        r *= 1.0 + 0.36 * max(0.0, 1.0 - z / 1.3) ** 2          # root flare
        r *= 1.0 + 0.05 * mnoise.noise(Vector((i * 0.9, 3.3, P["seed"])))
        pts.append(tpos(z))
        rad.append(r)
    sweep(mb, bark, pts, rad, seg=6 if lod else 10, tile_m=1.6, cap_end=True)
    if not lod:
        for k in range(4):                                        # surface roots
            a = k * 90 + rnd.uniform(-25, 25)
            p0 = polar(a, 0) * R * 0.5 + Vector((0, 0, 0.32))
            path = [p0, p0 + polar(a, -8) * 0.35 + Vector((0, 0, 0.0)), p0 + polar(a, -22) * 0.8, p0 + polar(a, -34) * 1.15]
            sweep(mb, bark, path, [R * 0.34, R * 0.24, R * 0.13, R * 0.05], seg=4, tile_m=1.6)
    return tpos


def build_full(key):
    P = PINES[key]
    rnd = random.Random(P["seed"])
    H, R = P["H"], P["R"]
    bark, fol = mats_for(key)
    mb = MB()
    tpos = trunk(mb, bark, P, rnd)
    c_lo = H * P["crown0"]
    crown_h = H * 0.985 - c_lo
    az0 = rnd.uniform(0, 360)
    z = c_lo
    level = 0
    Lmax = P["Lmax"]
    while z < H * 0.985:
        zr = (z - c_lo) / crown_h
        nb = rnd.randint(*P["per"])
        if zr > 0.75:
            nb = max(1, nb - 1)
        if rnd.random() < 0.10:
            nb = 1                                                   # irregular gaps
        a_start = rnd.uniform(0, 360)
        for i in range(nb):
            az = a_start + 360.0 * i / nb + rnd.uniform(-35, 35)
            dead = level < P["dead_low"]
            Lb = (Lmax * (1 - zr) ** 0.9 + 0.55) * rnd.uniform(0.7, 1.15) * (1 + P["asym"] * math.cos(math.radians(az - az0)))
            if key == "b":
                Lb *= 0.65 + 0.55 * abs(math.sin(zr * 4.3 + 0.7 + rnd.uniform(0, 0.6)))
            if dead:
                Lb *= 0.75
            elev = P["e0"] + (P["e1"] - P["e0"]) * zr + rnd.uniform(-10, 8)
            if dead:
                elev = rnd.uniform(-38, -18)
            r_here = R * (1 - z / H) ** 0.82 * 0.8
            base = tpos(z) + polar(az, 0) * r_here
            d = polar(az, elev)
            droop = Lb * ((0.30 if not dead else 0.42) * (1 - zr) + 0.05)
            # lowest tips stay above the ground
            tipz = base.z + d.z * Lb - droop
            if tipz < 0.5:
                d.z += (0.5 - tipz) / Lb
                d.normalize()

            def bp(t):
                w = Vector((mnoise.noise(Vector((t * 2, az * 0.1, z))) * 0.10 * Lb, mnoise.noise(Vector((z, t * 2, az * 0.1))) * 0.10 * Lb, 0)) * math.sin(t * math.pi)
                return base + d * Lb * t + Vector((0, 0, -droop * t * t)) + w
            npts = 5
            path = [bp(k / (npts - 1)) for k in range(npts)]
            r0 = (0.028 + 0.06 * (1 - zr)) * (R / 0.34)
            sweep(mb, bark, path, [r0, r0 * 0.7, r0 * 0.5, r0 * 0.3, 0.006], seg=3, tile_m=1.6, cap_end=True)
            if dead:
                for q in range(2):                                   # dead twiglets
                    t = rnd.uniform(0.35, 0.8)
                    p = bp(t)
                    tw = [p, p + polar(az + rnd.uniform(-60, 60), rnd.uniform(-30, 10)) * 0.3, p + polar(az + rnd.uniform(-80, 80), rnd.uniform(-40, 0)) * 0.6]
                    sweep(mb, bark, tw, [0.014, 0.009, 0.004], seg=3, tile_m=1.6)
                continue
            # needle-cluster cards along the branch
            cl = P["cardL"][0] + (P["cardL"][1] - P["cardL"][0]) * zr
            nc = max(2, min(7, int(Lb / 0.55) + 1))
            ts = [0.16 + 0.90 * k / (nc - 1) for k in range(nc)]
            for j, t in enumerate(ts):
                tan = (bp(min(1.0, t + 0.05)) - bp(max(0.0, t - 0.05))).normalized()
                lc = cl * rnd.uniform(0.8, 1.15) * (1.0 if j < len(ts) - 1 else 1.1)
                start = bp(min(t, 1.0)) if t <= 1.0 else bp(1.0) + tan * (t - 1.0) * Lb
                dirc = tan.copy()
                dirc.z -= 0.10
                dirc.normalize()
                for rep in range(2 if j == len(ts) - 1 else 1):
                    roll = rnd.uniform(0, 360) if rep == 0 else rnd.uniform(60, 120)
                    card3d(mb, fol, start - tan * 0.22 * lc, dirc, lc, lc * rnd.uniform(0.85, 1.05), roll=roll,
                           bend=Vector((0, 0, -0.11 * lc)), seg=2 if lc > 2.0 else 1, fold=0)
            level_last = level
        if level >= P["dead_low"]:
            for q in range(2):
                az = rnd.uniform(0, 360)
                cl2 = (P["cardL"][0] + (P["cardL"][1] - P["cardL"][0]) * zr) * rnd.uniform(0.45, 0.65)
                card3d(mb, fol, tpos(z) + polar(az, 0) * R * 0.3, polar(az, rnd.uniform(20, 55)), cl2, cl2 * 0.9, roll=rnd.uniform(0, 180), bend=Vector((0, 0, -0.1 * cl2)), seg=1)
        z += P["gap"] * (1 - 0.3 * zr) * rnd.uniform(0.6, 1.5)
        level += 1
    # bare dead stubs on the lower trunk (ponderosa style)
    for k in range(P["stubs"]):
        zz = rnd.uniform(1.6, c_lo)
        az = rnd.uniform(0, 360)
        b0 = tpos(zz) + polar(az, 0) * R * 0.7
        L = rnd.uniform(0.25, 0.6)
        sweep(mb, bark, [b0 - polar(az, 0) * 0.05, b0 + polar(az, rnd.uniform(-20, 15)) * L * 0.5, b0 + polar(az, rnd.uniform(-30, 10)) * L], [0.05, 0.035, 0.02], seg=4, tile_m=1.6)
    # pointed leader: small upright clusters around the top
    top = tpos(H * 0.93)
    for k in range(7):
        az = k * 51 + rnd.uniform(-15, 15)
        card3d(mb, fol, top + Vector((0, 0, rnd.uniform(-0.6, 0.0))), polar(az, rnd.uniform(58, 86)), rnd.uniform(0.9, 1.3), rnd.uniform(0.6, 0.9), roll=rnd.uniform(0, 180),
               bend=Vector((0, 0, -0.05)), seg=2)
    card3d(mb, fol, top + Vector((0, 0, 0.35)), Vector((0, 0, 1)), H * 0.07, 0.5, roll=0, seg=1)
    card3d(mb, fol, top + Vector((0, 0, 0.35)), Vector((0, 0, 1)), H * 0.07, 0.5, roll=90, seg=1)
    return mb, P


def build_lod(key):
    """<= 300 tris: trunk + 3 big needle cards per level (cards from the same sprig texture / material)"""
    P = PINES[key]
    rnd = random.Random(P["seed"] + 100)
    H, R = P["H"], P["R"]
    bark, fol = mats_for(key)
    mb = MB()
    tpos = trunk(mb, bark, P, rnd, lod=True)
    c_lo = H * P["crown0"]
    crown_h = H * 0.985 - c_lo
    Lmax = P["Lmax"]
    z = c_lo
    az0 = rnd.uniform(0, 360)
    while z < H * 0.985:
        zr = (z - c_lo) / crown_h
        L = (Lmax * (1 - zr) ** 0.92 + 0.6) * rnd.uniform(0.85, 1.1)
        if key == "b":
            L *= 0.65 + 0.55 * abs(math.sin(zr * 4.3 + 0.7))
        e = P["e0"] + (P["e1"] - P["e0"]) * zr
        a0 = rnd.uniform(0, 360)
        for i in range(4):
            az = a0 + 90 * i + rnd.uniform(-20, 20)
            Li = L * rnd.uniform(0.85, 1.05) * (1 + P["asym"] * math.cos(math.radians(az - az0)))
            base = tpos(z) + polar(az, 0) * R * 0.4
            d = polar(az, e + rnd.uniform(-6, 6))
            tipz = base.z + d.z * Li - 0.18 * Li
            if tipz < 0.6:
                d.z += (0.6 - tipz) / Li
                d.normalize()
            card3d(mb, fol, base, d, Li * 1.05, Li * P["lod_wr"] * 0.72, roll=rnd.uniform(-25, 25), bend=Vector((0, 0, -0.18 * Li)), seg=1)
        z += P["gap"] * 3.0 * (1 - 0.3 * zr)
    # upright crossed sprig cards: each one shows a whole conifer silhouette from every side
    for k in range(6):
        base = tpos(c_lo + crown_h * 0.03)
        card3d(mb, fol, base, Vector((0.02 * math.cos(k), 0.02 * math.sin(k), 1.0)), crown_h * 1.04, Lmax * 1.9 * rnd.uniform(0.9, 1.05), roll=k * 30 + rnd.uniform(-6, 6), seg=2)
    top = tpos(H * 0.94)
    for yaw in (0, 90):
        card3d(mb, fol, top - Vector((0, 0, 1.0)), Vector((0, 0, 1)), H * 0.12, 1.4, roll=yaw, seg=1)
    return mb, P


def finish_pine(key, lod=False):
    mb, P = build_lod(key) if lod else build_full(key)
    name = "pine_%s%s" % (key, "_lod" if lod else "")
    objs = mb.to_objects(name, shade_smooth=True)
    fol = [o for o in objs if o.data.materials[0].name.startswith("pine_needles")]
    bark = [o for o in objs if o.data.materials[0].name == "bark_pine"]
    foliage_vcol(fol, P["H"], P["Lmax"] * 1.0, low=0.62, tint=P["tint"], seed=P["seed"], noise_amp=0.12, top_warm=0.05)
    for o in bark:
        bake_ao(o, samples=10 if lod else 16, dist=2.0, strength=0.7, ground=True, gradient=0.10, others=fol, floor=0.35, tint=(1.0, 0.95, 0.9))
    extra = {}
    if not lod:
        extra = dict(lod="pine_%s_lod.glb" % key, billboard="pine_%s_billboard.glb" % key, crown_radius=round(P["Lmax"] * 0.95, 2))
    finish(name, objs, category="tree_pine_lod" if lod else "tree_pine", center_xy=False, ao=None, extra=extra,
           notes=("LOD1 of %s (alpha-tested cards, same materials)" % ("pine_" + key)) if lod else
           "conifer: bark_pine trunk + drooping branch tubes carrying many small needle-cluster cards (alphaMode MASK, double-sided); dead lower branches; origin = trunk base; "
           "use _lod beyond ~60 m and _billboard beyond ~150 m")


def build_billboard(key):
    P = PINES[key]
    info = json.load(open(os.path.join(PTEX, "billboard_pine_%s.json" % key)))
    W, H = info["width_m"], info["height_m"]
    fol = pmat("pine_billboard_" + key, albedo_file=os.path.join(PTEX, "billboard_pine_%s.png" % key), alpha="MASK", double_sided=True, rough=1.0, alpha_cutoff=0.4)
    mb = MB()
    bm = mb.bm(fol)
    uvl = bm.loops.layers.uv.verify()
    for yaw, (u0, u1) in ((0.0, (0.0, 0.5)), (90.0, (0.5, 1.0))):
        a = yaw * D2R
        dx, dy = math.cos(a) * W / 2, math.sin(a) * W / 2
        vs = [bm.verts.new((-dx, -dy, 0)), bm.verts.new((dx, dy, 0)), bm.verts.new((dx, dy, H)), bm.verts.new((-dx, -dy, H))]
        f = bm.faces.new(vs)
        for lp, t in zip(f.loops, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))):
            lp[uvl].uv = t
    objs = mb.to_objects("pine_%s_billboard" % key, shade_smooth=False)
    for o in objs:
        set_vertex_color(o, (1.0, 1.0, 1.0))
    finish("pine_%s_billboard" % key, objs, category="tree_pine_billboard", center_xy=False, ao=None,
           notes="crossed-quad far billboard (2 quads, 4 tris) baked from the real pine_%s model (front + side view in one texture), alphaMode MASK, %.1f x %.1f m" % (key, W, H))


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = "all"
    if "--only" in args:
        only = args[args.index("--only") + 1]
        args = [a for i, a in enumerate(args) if a != "--only" and (i == 0 or args[i - 1] != "--only")]
    keys = args or ["a", "b", "c"]
    for k in keys:
        if only in ("all", "full"):
            new_scene()
            finish_pine(k, lod=False)
        if only in ("all", "lod"):
            new_scene()
            finish_pine(k, lod=True)
        if only in ("all", "bb"):
            new_scene()
            build_billboard(k)

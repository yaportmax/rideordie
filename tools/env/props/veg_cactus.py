"""cactus_saguaro, cactus_barrel, cactus_prickly_pear.   blender -b --factory-startup -P tools/env/props/veg_cactus.py -- [saguaro barrel pear]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from vegetation_lib import *


def skin_mat():
    return pmat("cactus_skin", tex="cactus_skin", uv_m=0.5, rough=0.95, color=(0.3, 0.4, 0.28), spec=0.05, glow=0.6)


def catmull(pts, n):
    """centripetal-ish Catmull-Rom through pts, n samples total"""
    P = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    segs = len(pts) - 1
    for i in range(n):
        t = i / (n - 1) * segs
        k = min(segs - 1, int(t))
        u = t - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u))
    return out


def patch_colors(objs, fn):
    """multiply COLOR_0 by fn(world_pos) -> (r, g, b)"""
    for o in objs:
        ca = o.data.color_attributes["Col"]
        for i, v in enumerate(o.data.vertices):
            m = fn(o.matrix_world @ v.co)
            c = ca.data[i].color
            ca.data[i].color = (c[0] * m[0], c[1] * m[1], c[2] * m[2], 1.0)


def saguaro():
    rnd = random.Random(9)
    sk = skin_mat()
    mb = MB()
    H = 5.4
    ribs = 14
    seg = ribs * 2
    n = 19
    lean = 0.34
    pts, rad = [], []
    for i in range(n):
        t = i / (n - 1)
        z = H * 0.93 * t
        x = lean * t ** 1.4 + 0.07 * math.sin(t * 3.4)
        y = 0.06 * math.sin(t * 2.0 + 1.0)
        pts.append(Vector((x, y, z)))
        r = 0.30 * (1.0 - 0.10 * t) * (1 + 0.03 * math.sin(t * 9.0))
        r *= 1.0 + 0.30 * max(0.0, 1.0 - z / 0.8) ** 2               # base flare
        rad.append(r)
    top = pts[-1]
    for k in range(1, 4):                                           # rounded, slightly asymmetric crown
        a = k / 3.0 * math.pi / 2
        pts.append(top + Vector((0.02 * k, 0, math.sin(a) * 0.27)))
        rad.append(max(0.035, rad[n - 1] * math.cos(a) * 0.98))
    sweep(mb, sk, pts, rad, seg=seg, tile_m=0.5, u_repeat=ribs, rib=0.15, cap_end=True)

    def trunk_at(z):
        t = min(1.0, z / (H * 0.93))
        i = min(n - 2, int(t * (n - 1)))
        f = t * (n - 1) - i
        return pts[i].lerp(pts[i + 1], f), rad[i] + (rad[i + 1] - rad[i]) * f

    # arms: droop-then-rise, thick, organic
    for (h0, az, out, up, ra) in ((2.0, 25, 1.05, 1.75, 0.20), (3.2, 208, 0.8, 1.25, 0.18), (1.55, 305, 0.6, 0.7, 0.155)):
        c, rt = trunk_at(h0)
        o = polar(az, 0)
        p0 = c + o * rt * 0.35
        ctrl = [p0,
                p0 + o * (out * 0.42) + Vector((0, 0, -0.07)),
                p0 + o * (out * 0.90) + Vector((0, 0, 0.05)),
                p0 + o * (out * 1.06) + Vector((0, 0, 0.42)),
                p0 + o * (out * 1.04) + Vector((0, 0, 0.42 + up * 0.5)),
                p0 + o * (out * 1.00) + Vector((0, 0, 0.42 + up))]
        path = catmull(ctrl, 13)
        rr = [ra * (0.86 + 0.14 * min(1.0, i / 3.0)) * (1.0 - 0.06 * i / 12.0) for i in range(13)]
        topa = path[-1]
        for k in range(1, 4):
            a = k / 3.0 * math.pi / 2
            path.append(topa + Vector((0, 0, math.sin(a) * ra * 0.9)))
            rr.append(max(0.03, ra * 0.94 * math.cos(a)))
        sweep(mb, sk, path, rr, seg=20, tile_m=0.5, u_repeat=10, rib=0.15, cap_end=True)
    objs = mb.to_objects("cactus_saguaro", shade_smooth=True, smooth_angle=55)
    for o in objs:
        bake_ao(o, samples=18, dist=0.9, strength=0.9, ground=True, gradient=0.2, floor=0.38, tint=(1.0, 0.97, 0.92))
    off = Vector((3.1, 1.7, 5.3))

    def scars(p):
        n1 = mnoise.noise(p * 1.9 + off)
        m = smoothstep(0.30, 0.62, n1) * 0.75
        old = max(0.0, 1.0 - p.z / 1.6) * 0.30                      # older, browner base
        k = 1.0 - m * 0.30 - old * 0.25
        return (k, k * (1 - 0.03 * m), k * (1 - 0.10 * m - 0.06 * old))
    patch_colors(objs, scars)
    finish("cactus_saguaro", objs, category="cactus", center_xy=False, ao=None,
           notes="saguaro: lean, base flare, 3 thick droop-then-rise arms, 14 deep ribs (UV u = rib index; pale spine dots on crests), scar patches in vertex colour; origin at trunk base")


def barrel():
    sk = skin_mat()
    flw = pmat("cactus_flower", color=(0.50, 0.36, 0.06), rough=0.7)
    mb = MB()
    ribs = 16
    seg = ribs * 2
    n = 13
    pts, rad = [], []
    Hc = 0.86
    for i in range(n):
        t = i / (n - 1)
        prof = math.sin(math.pi * (0.10 + 0.78 * t)) ** 0.5
        r = 0.36 * prof * (1.0 if t < 0.86 else 1.0 - (t - 0.86) * 2.4) + 0.03
        pts.append(Vector((0, 0, Hc * t * 0.94)))
        rad.append(r)
    sweep(mb, sk, pts, rad, seg=seg, tile_m=0.4, u_repeat=ribs, rib=0.15, cap_end=True)
    topz = pts[-1].z
    for k in range(7):
        a = k * 360 / 7 + 10
        p = polar(a, 0) * 0.10 + Vector((0, 0, topz + 0.005))
        mb.cone(flw, p, p + Vector((0, 0, 0.09)) + polar(a, 0) * 0.03, 0.033, seg=6, cap=True)
    objs = mb.to_objects("cactus_barrel", shade_smooth=True, smooth_angle=55)
    for o in objs:
        bake_ao(o, samples=16, dist=0.45, strength=0.85, ground=True, gradient=0.25, floor=0.42)
    off = Vector((1.1, 4.7, 2.2))
    patch_colors([o for o in objs if o.data.materials[0].name == "cactus_skin"],
                 lambda p: (lambda k: (k, k, k * 0.96))(1.0 - 0.28 * smoothstep(0.3, 0.65, mnoise.noise(p * 3.0 + off)) - 0.15 * max(0.0, 1 - p.z / 0.25)))
    finish("cactus_barrel", objs, category="cactus", center_xy=False, ao=None,
           notes="barrel cactus ~0.85 m, 16 deep ribs with pale spine dots on crests (texture), dusty grey-green, dull flower ring; origin at base centre")


def pear():
    rnd = random.Random(21)
    sk = pmat("cactus_pear_skin", tex="cactus_pear_skin", uv_m=0.5, rough=0.95, color=(0.3, 0.4, 0.28), spec=0.05, glow=0.6)
    fr = pmat("cactus_fruit", color=(0.22, 0.04, 0.07), rough=0.5)
    mb = MB()
    pads = []
    T = 0.062                                                        # pad half-thickness (thicker than before)

    def add_pad(M, scale, depth):
        c = M.to_translation()
        eul = M.to_euler("XYZ")
        mb.sphere(sk, c, (0.25 * scale, T * scale, 0.30 * scale), subdiv=2, rot=[math.degrees(e) for e in eul])
        pads.append((M.copy(), scale))
        if depth <= 0:
            return
        nchild = 2 if depth > 1 else rnd.choice((1, 2))
        for k in range(nchild):
            side = -1 if k == 0 else 1
            up = M.to_3x3() @ Vector((side * 0.10 * scale, 0, 0.27 * scale))
            tilt = math.radians(rnd.uniform(18, 42)) * side
            yaw = math.radians(rnd.uniform(-85, 85))
            R = M.to_3x3() @ Matrix.Rotation(yaw, 3, "Z") @ Matrix.Rotation(tilt, 3, "Y")
            C = Matrix.Translation(c + up) @ R.to_4x4()
            C = C @ Matrix.Translation((0, 0, 0.24 * scale * 0.9))
            add_pad(C, scale * rnd.uniform(0.78, 0.9), depth - 1)
    R0 = Matrix.Rotation(math.radians(rnd.uniform(0, 360)), 3, "Z") @ Matrix.Rotation(math.radians(8), 3, "Y")
    add_pad(Matrix.Translation((0, 0, 0.24)) @ R0.to_4x4(), 1.0, 2)
    R1 = Matrix.Rotation(math.radians(130), 3, "Z") @ Matrix.Rotation(math.radians(-12), 3, "X")
    add_pad(Matrix.Translation((0.15, 0.10, 0.20)) @ R1.to_4x4(), 0.8, 1)
    for (M, sc) in pads[1:]:
        if rnd.random() < 0.75:
            top = M @ Vector((rnd.uniform(-0.1, 0.1) * sc, 0.0, 0.29 * sc))
            mb.sphere(fr, top, (0.040, 0.040, 0.06), subdiv=1)
    objs = mb.to_objects("cactus_prickly_pear", shade_smooth=True, smooth_angle=60)
    for o in objs:
        bake_ao(o, samples=16, dist=0.4, strength=0.8, ground=True, gradient=0.3, floor=0.42)
    finish("cactus_prickly_pear", objs, category="cactus", center_xy=False, ao=None,
           notes="prickly pear: thick chained pads with dotted areoles and blue-grey bloom + red fruit; origin at base centre")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    todo = args or ["saguaro", "barrel", "pear"]
    for t in todo:
        new_scene()
        {"saguaro": saguaro, "barrel": barrel, "pear": pear}[t]()

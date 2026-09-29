"""cactus_saguaro, cactus_barrel, cactus_prickly_pear.   blender -b --factory-startup -P tools/env/props/veg_cactus.py -- [saguaro barrel pear]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from vegetation_lib import *


def skin_mat():
    return pmat("cactus_skin", tex="cactus_skin", uv_m=0.5, rough=0.85, color=(0.3, 0.4, 0.28))


def saguaro():
    rnd = random.Random(9)
    sk = skin_mat()
    mb = MB()
    H = 5.4
    ribs = 12
    seg = ribs * 2
    n = 15
    pts, rad = [], []
    for i in range(n):
        t = i / (n - 1)
        z = H * 0.93 * t
        x = 0.10 * math.sin(t * 3.0) * t
        pts.append(Vector((x, 0.06 * math.sin(t * 2.0), z)))
        rad.append(0.30 * (1.0 + 0.10 * (1 - t) ** 2 - 0.06 * t) * (1 + 0.03 * math.sin(t * 9)))
    # dome top
    top = pts[-1]
    for k in range(1, 4):
        a = k / 3.0 * math.pi / 2
        pts.append(top + Vector((0, 0, math.sin(a) * 0.26)))
        rad.append(max(0.035, rad[n - 1] * math.cos(a) * 0.98))
    sweep(mb, sk, pts, rad, seg=seg, tile_m=0.5, u_repeat=ribs, rib=0.09, cap_end=True)
    def trunk_at(z):
        t = min(1.0, z / (H * 0.93))
        i = min(n - 2, int(t * (n - 1)))
        f = t * (n - 1) - i
        return pts[i].lerp(pts[i + 1], f), rad[i] + (rad[i + 1] - rad[i]) * f
    arms = [(2.05, 20, 0.95, 1.9), (3.1, 215, 0.75, 1.35), (1.6, 300, 0.6, 0.85)]
    for (h0, az, out, up) in arms:
        c, rt = trunk_at(h0)
        outv = polar(az, 0)
        ribs_a = 10
        p0 = c + outv * rt * 0.35
        ra = 0.17 if up > 1.0 else 0.14
        path, rr = [], []
        N = 9
        Re = 0.55
        for i in range(N):
            th = (math.pi / 2) * i / (N - 1)
            path.append(p0 + outv * (rt * 0.5 + (out - rt * 0.5) * math.sin(th) * 0.9 + Re * 0.0) + Vector((0, 0, Re * (1 - math.cos(th)) * 0.9)))
            rr.append(ra * (1.0 if i > 1 else 0.85 + 0.075 * i))
        # vertical run
        last = path[-1]
        for k in range(1, 4):
            path.append(last + Vector((0, 0, up * k / 3.0)))
            rr.append(ra * (1.0 - 0.06 * k))
        top = path[-1]
        for k in range(1, 4):
            a = k / 3.0 * math.pi / 2
            path.append(top + Vector((0, 0, math.sin(a) * 0.17)))
            rr.append(max(0.03, ra * math.cos(a) * 0.97))
        sweep(mb, sk, path, rr, seg=ribs_a * 2, tile_m=0.5, u_repeat=ribs_a, rib=0.09, cap_end=True)
    objs = mb.to_objects("cactus_saguaro", shade_smooth=True, smooth_angle=50)
    for o in objs:
        bake_ao(o, samples=20, dist=0.9, strength=0.9, ground=True, gradient=0.2, floor=0.35, tint=(1.0, 0.97, 0.9))
    finish("cactus_saguaro", objs, category="cactus", center_xy=False, ao=None,
           notes="saguaro with 3 arms, 12 ribs (UV u = rib index, spines on crests), cactus_skin material; origin at trunk base")


def barrel():
    sk = skin_mat()
    flw = pmat("cactus_flower", color=(0.62, 0.42, 0.06), rough=0.6)
    mb = MB()
    ribs = 16
    seg = ribs * 2
    n = 12
    pts, rad = [], []
    Hc = 0.74
    for i in range(n):
        t = i / (n - 1)
        prof = math.sin(math.pi * (0.10 + 0.78 * t)) ** 0.55
        r = 0.39 * prof * (1.0 if t < 0.85 else 1.0 - (t - 0.85) * 2.2) + 0.03
        pts.append(Vector((0, 0, Hc * t * 0.94)))
        rad.append(r)
    # top dimple: last ring goes a bit down
    sweep(mb, sk, pts, rad, seg=seg, tile_m=0.4, u_repeat=ribs, rib=0.10, cap_end=True)
    topz = pts[-1].z
    for k in range(7):
        a = k * 360 / 7 + 10
        p = polar(a, 0) * 0.10 + Vector((0, 0, topz + 0.005))
        mb.cone(flw, p, p + Vector((0, 0, 0.10)) + polar(a, 0) * 0.03, 0.035, seg=6, cap=True)
    objs = mb.to_objects("cactus_barrel", shade_smooth=True, smooth_angle=50)
    for o in objs:
        bake_ao(o, samples=18, dist=0.45, strength=0.8, ground=True, gradient=0.25, floor=0.4)
    finish("cactus_barrel", objs, category="cactus", center_xy=False, ao=None,
           notes="barrel cactus 0.8 m, 16 ribs with spines on crests (texture), yellow flower ring; origin at base centre")


def pear():
    rnd = random.Random(21)
    sk = pmat("cactus_pear_skin", tex="cactus_pear_skin", uv_m=0.5, rough=0.85, color=(0.3, 0.4, 0.28))
    fr = pmat("cactus_fruit", color=(0.25, 0.04, 0.07), rough=0.5)
    mb = MB()
    pads = []
    def add_pad(M, scale, depth):
        c = M.to_translation()
        eul = M.to_euler("XYZ")
        mb.sphere(sk, c, (0.25 * scale, 0.042 * scale, 0.30 * scale), subdiv=2, rot=[math.degrees(e) for e in eul])
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
    # second base pad
    R1 = Matrix.Rotation(math.radians(130), 3, "Z") @ Matrix.Rotation(math.radians(-12), 3, "X")
    add_pad(Matrix.Translation((0.15, 0.10, 0.20)) @ R1.to_4x4(), 0.8, 1)
    # fruits on the rims
    for (M, sc) in pads[1:]:
        if rnd.random() < 0.75:
            top = M @ Vector((rnd.uniform(-0.1, 0.1) * sc, 0.0, 0.29 * sc))
            mb.sphere(fr, top, (0.040, 0.040, 0.06), subdiv=1)
    objs = mb.to_objects("cactus_prickly_pear", shade_smooth=True, smooth_angle=60)
    for o in objs:
        bake_ao(o, samples=18, dist=0.4, strength=0.8, ground=True, gradient=0.3, floor=0.4)
    finish("cactus_prickly_pear", objs, category="cactus", center_xy=False, ao=None,
           notes="prickly pear: chained flattened pads + red fruit, cactus_pear_skin (areoles); origin at base centre")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    todo = args or ["saguaro", "barrel", "pear"]
    for t in todo:
        new_scene()
        {"saguaro": saguaro, "barrel": barrel, "pear": pear}[t]()

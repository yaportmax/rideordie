"""Road furniture: tire_stack, crate_stack, fence_chainlink_4m, debris_pile.
   blender -b --factory-startup -P tools/env/props/road_clutter.py -- [name ...]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from envlib import *
from roadlib import *


# ------------------------------------------------------------------------------------------------------ tyres
TIRE_PROFILE = [(0.205, -0.085), (0.235, -0.105), (0.30, -0.10), (0.325, -0.085), (0.336, -0.05), (0.338, 0.0), (0.336, 0.05), (0.325, 0.085),
                (0.30, 0.10), (0.235, 0.105), (0.205, 0.085), (0.198, 0.0)]


def add_tire(mb, m, M):
    """one tyre (axis Z) transformed by M; UVs match tire_tex(): tread strip in the top 128 rows, sidewall disc below"""
    bm = mb.bm(m)
    n0 = len(bm.faces)
    prof = TIRE_PROFILE + [TIRE_PROFILE[0]]
    vs = mb.lathe(m, prof, seg=18, close=False)
    faces = list(bm.faces)[n0:]
    cyl_uv(bm, -0.105, 0.105, 0.75, 1.0, faces=faces, flat=lambda p: (0.25 + p.x / 0.338 * 0.159, 0.34 + p.y / 0.338 * 0.318), u_off=0.0)
    # sidewall faces that are not flat enough (shoulders) use the disc mapping too
    uvl = bm.loops.layers.uv.verify()
    for f in faces:
        c = f.calc_center_median()
        if abs(c.z) > 0.08 and math.hypot(c.x, c.y) < 0.335:
            for lp in f.loops:
                lp[uvl].uv = (0.25 + lp.vert.co.x / 0.338 * 0.159, 0.34 + lp.vert.co.y / 0.338 * 0.318)
    transform_verts(mb, m, vs, M)


def tire_stack():
    new_scene(); S = std()
    m = pmat("tire", tex="tire", rough=0.9)
    mb = MB()
    rnd = random.Random(11)
    for i in range(3):                                            # stack of three
        M = Matrix.Translation((rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), 0.105 + i * 0.21)) @ Matrix.Rotation(rnd.uniform(0, 6.28), 4, "Z")
        add_tire(mb, m, M)
    # one tyre leaning against the stack
    th = math.radians(72)
    M = Matrix.Translation((0.52, 0.02, 0.338 * math.sin(th) + 0.105 * math.cos(th))) @ Matrix.Rotation(th, 4, "Y") @ Matrix.Rotation(1.1, 4, "Z")
    add_tire(mb, m, M)
    # one flat on the ground next to it
    add_tire(mb, m, Matrix.Translation((-0.62, 0.55, 0.105)) @ Matrix.Rotation(2.0, 4, "Z"))
    finish("tire_stack", mb, "furniture", ao=dict(samples=16, dist=0.35, strength=0.8), post=lambda o: grime_vc(o, 11, dirt=0.4, ground=0.5, ground_h=0.4),
           notes="3 stacked + 1 leaning + 1 flat tyre (0.68 m dia), tread/sidewall texture with lettering")


# ------------------------------------------------------------------------------------------------------ crates
def wood_crate(mb, W, cx, cy, z0, sx, sy, sz, yaw=0.0, missing=(), seed=0):
    """slatted wooden crate (size sx,sy,sz), centre (cx,cy) on height z0; slats are separate unbevelled boxes"""
    rnd = random.Random(seed)
    Rz = Matrix.Rotation(yaw * D2R, 4, "Z")
    T = Matrix.Translation((cx, cy, z0)) @ Rz
    vs = []
    p = 0.05
    for (x, y) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):                        # corner posts
        vs += mb.box(W, ((sx / 2 - p / 2) * x, (sy / 2 - p / 2) * y, sz / 2), (p, p, sz))
    nsl = 4
    gap = 0.028
    sh = (sz - gap * (nsl + 1)) / nsl
    k = 0
    for side in range(4):
        L = sx if side % 2 == 0 else sy
        for i in range(nsl):
            k += 1
            if (side, i) in missing:
                continue
            zc = gap + sh / 2 + i * (sh + gap)
            jitter = rnd.uniform(-0.004, 0.004)
            if side == 0:
                vs += mb.box(W, (0, sy / 2 - 0.01 + jitter, zc), (sx - 0.02, 0.018, sh))
            elif side == 1:
                vs += mb.box(W, (sx / 2 - 0.01 + jitter, 0, zc), (0.018, sy - 0.02, sh))
            elif side == 2:
                vs += mb.box(W, (0, -sy / 2 + 0.01 + jitter, zc), (sx - 0.02, 0.018, sh))
            else:
                vs += mb.box(W, (-sx / 2 + 0.01 + jitter, 0, zc), (0.018, sy - 0.02, sh))
    for i in range(4):                                                         # lid slats
        yc = -sy / 2 + (i + 0.5) * sy / 4
        vs += mb.box(W, (0, yc, sz - 0.009), (sx, sy / 4 - 0.02, 0.018))
    # diagonal brace on the front face
    ang = math.degrees(math.atan2(sz - 0.1, sx - 0.15))
    vs += mb.box(W, (0, sy / 2 + 0.008, sz / 2), (math.hypot(sx - 0.15, sz - 0.1), 0.014, 0.06), rot=(0, -ang, 0))
    transform_verts(mb, W, vs, T)
    return T


def ammo_can(mb, O, G, center, yaw=0.0):
    vs = []
    vs += mb.box(O, (0, 0, 0.12), (0.40, 0.19, 0.24), bevel=0.012, segs=1)
    vs += mb.box(O, (0, 0, 0.255), (0.41, 0.20, 0.03), bevel=0.008, segs=1)                 # lid
    vs += mb.tube(G, [Vector((-0.09, 0, 0.27)), Vector((-0.09, 0, 0.31)), Vector((0.09, 0, 0.31)), Vector((0.09, 0, 0.27))], 0.008, seg=5)   # handle
    vs += mb.box(G, (0.13, 0.102, 0.21), (0.04, 0.012, 0.06))
    vs += mb.box(G, (-0.13, 0.102, 0.21), (0.04, 0.012, 0.06))
    transform_verts(mb, O, [v for v in vs if v.is_valid], Matrix.Translation(center) @ Matrix.Rotation(yaw * D2R, 4, "Z"))


def crate_stack():
    new_scene(); M = std()
    W, O, G, R = M["wood"], M["olive"], M["galv"], M["red"]
    mb = MB()
    wood_crate(mb, W, 0.0, 0.0, 0.0, 0.95, 0.62, 0.58, 0, missing=[(0, 2)], seed=1)
    wood_crate(mb, W, 1.05, 0.06, 0.0, 0.72, 0.58, 0.48, -9, missing=[(1, 1), (2, 3)], seed=2)
    wood_crate(mb, W, 0.08, -0.02, 0.58, 0.72, 0.52, 0.42, 17, missing=[(3, 0)], seed=3)
    ammo_can(mb, O, G, (1.05, 0.06, 0.48), yaw=25)
    ammo_can(mb, O, G, (-0.15, 0.62, 0.0), yaw=-15)
    # jerrycan
    vs = []
    vs += mb.box(R, (0, 0, 0.22), (0.34, 0.16, 0.44), bevel=0.02, segs=2)
    vs += mb.cyl(G, Vector((0.10, 0, 0.44)), Vector((0.10, 0, 0.50)), 0.035, 0.03, seg=8)
    vs += mb.tube(G, [Vector((-0.12, 0, 0.44)), Vector((-0.12, 0, 0.53)), Vector((0.04, 0, 0.53)), Vector((0.04, 0, 0.44))], 0.012, seg=5)
    transform_verts(mb, R, [v for v in vs if v.is_valid], Matrix.Translation((-0.70, -0.25, 0)) @ Matrix.Rotation(0.7, 4, "Z"))
    finish("crate_stack", mb, "furniture", ao=dict(samples=16, dist=0.35, strength=0.8), post=lambda o: grime_vc(o, 13, dirt=0.6, ground=0.6, ground_h=0.5),
           notes="3 weathered wooden crates (one stacked, slats missing), 2 olive ammo cans, 1 red jerrycan")


# ------------------------------------------------------------------------------------------------------ chain-link fence
def fence_chainlink_4m():
    new_scene(); M = std()
    G, C = M["galv"], M["concrete"]
    mesh_m = pmat("chainlink", albedo_file=os.path.join(PTEX, "chainlink.png"), alpha="MASK", double_sided=True, rough=0.55, metal=0.6, alpha_cutoff=0.3)
    mb = MB()
    mb.cyl(G, Vector((0, 0, 0.0)), Vector((0, 0, 1.90)), 0.036, 0.034, seg=8)
    mb.sphere(G, (0, 0, 1.91), (0.045, 0.045, 0.035), subdiv=1)
    mb.cyl(C, Vector((0, 0, 0.0)), Vector((0, 0, 0.06)), 0.10, 0.09, seg=8)
    mb.cyl(G, Vector((0.02, -2.0, 1.83)), Vector((0.02, 2.0, 1.83)), 0.021, 0.021, seg=6)              # top rail
    mb.cyl(G, Vector((0.02, -2.0, 0.06)), Vector((0.02, 2.0, 0.06)), 0.006, 0.006, seg=4)              # bottom tension wire
    for z in (0.35, 0.95, 1.55):                                                                          # tension bands
        mb.box(G, (0.04, 0, z), (0.014, 0.085, 0.03))
    mb.box(G, (0.06, 0, 1.83), (0.05, 0.05, 0.05))                                                       # rail clamp
    # mesh
    bm = mb.bm(mesh_m)
    uvl = bm.loops.layers.uv.verify()
    nx, nz = 20, 9
    z_lo, z_hi = 0.07, 1.82
    off = Vector((3.3, 1.1, 2.2))
    grid = []
    for j in range(nz + 1):
        row = []
        for i in range(nx + 1):
            y = -2.0 + 4.0 * i / nx
            z = z_lo + (z_hi - z_lo) * j / nz
            d = mnoise.noise(Vector((y * 0.9, z * 1.2, 0)) + off) * 0.035 + 0.02
            sag = 0.05 * math.exp(-((y - 1.1) / 0.5) ** 2) * (1 - z / z_hi) ** 1.5           # torn/leaning bulge near the bottom
            row.append((y, z, 0.026 + d + sag))
        grid.append(row)
    verts = [[bm.verts.new((r[2], r[0], r[1])) for r in row] for row in grid]
    hole = {(i, j) for i in range(12, 15) for j in range(0, 3)} | {(15, 0), (11, 0), (13, 3)}
    for j in range(nz):
        for i in range(nx):
            if (i, j) in hole:
                continue
            f = bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
            for lp in f.loops:
                idx = [(j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i)][list(f.loops).index(lp)]
                lp[uvl].uv = ((-2.0 + 4.0 * idx[1] / nx + 2.0) / 0.4, (z_lo + (z_hi - z_lo) * idx[0] / nz) / 0.4)
    finish("fence_chainlink_4m", mb, "furniture", ao=dict(samples=12, dist=0.3, strength=0.6), post=lambda o: grime_vc(o, 15, dirt=0.4, ground=0.4, ground_h=0.5),
           notes="4.0 m chain-link fence section along Z (glTF), 1.9 m high, post at the segment centre so instances tile every 4 m; mesh = alphaMode MASK double-sided card texture, "
                 "torn hole near the bottom. Mesh sits on the +X side of the post.", extra=dict(segment_length=4.0))


# ------------------------------------------------------------------------------------------------------ debris pile
def debris_pile():
    new_scene(); M = std()
    CC, R, W, G, C = M["concrete_cracked"], M["rust"], M["planks"], M["galv"], M["concrete"]
    mb = MB()
    rnd = random.Random(23)
    hfun = lambda r: max(0.0, 0.62 * (1 - (r / 1.1) ** 2))
    mb.rock(CC, seed=90, size=(2.1, 1.8, 0.5), center=(0, 0, 0), subdiv=3, cuts=4, rough=0.3, bury=0.2, rot_z=20)       # rubble blanket
    for k in range(12):                                                      # concrete rubble
        a = rnd.uniform(0, 6.28)
        r = rnd.uniform(0.0, 0.85)
        sz = rnd.uniform(0.32, 0.7) * (1.15 - r * 0.5)
        mb.rock(CC, seed=30 + k, size=(sz * rnd.uniform(0.9, 1.4), sz, sz * rnd.uniform(0.5, 0.9)), center=(r * math.cos(a), r * math.sin(a), hfun(r) * 0.85),
                subdiv=2, cuts=5, rough=0.22, bury=0.2)
    for k in range(3):                                                      # cinder blocks
        a = rnd.uniform(0, 6.28); r = rnd.uniform(0.3, 0.9)
        mb.box(C, (r * math.cos(a), r * math.sin(a), 0.12 + hfun(r) * 0.8), (0.40, 0.20, 0.19), rot=(rnd.uniform(-15, 15), rnd.uniform(-12, 12), rnd.uniform(0, 180)), bevel=0.008)
    for k in range(5):                                                      # planks poking out of the heap
        a = rnd.uniform(0, 6.28); r = rnd.uniform(0.05, 0.6)
        L = rnd.uniform(0.7, 1.2)
        mb.box(W, (r * math.cos(a), r * math.sin(a), 0.2 + hfun(r) * 0.95), (L, 0.13, 0.03),
               rot=(rnd.uniform(-15, 15), rnd.uniform(20, 45) * rnd.choice([-1, 1]), rnd.uniform(0, 180)))
    for k in range(3):                                                      # crumpled sheet metal
        a = rnd.uniform(0, 6.28); r = rnd.uniform(0.2, 0.6)
        mb.box(G, (r * math.cos(a), r * math.sin(a), 0.3 + hfun(r) * 0.9), (0.62, 0.45, 0.008), rot=(rnd.uniform(-35, 35), rnd.uniform(-35, 35), rnd.uniform(0, 180)))
    for k in range(6):                                                      # rebar
        a = rnd.uniform(0, 6.28); r = rnd.uniform(0.0, 0.45)
        p0 = Vector((r * math.cos(a), r * math.sin(a), 0.25 + hfun(r) * 0.9))
        d = Vector((math.cos(a + rnd.uniform(-1, 1)), math.sin(a + rnd.uniform(-1, 1)), rnd.uniform(0.3, 1.0))).normalized()
        L = rnd.uniform(0.5, 0.9)
        p1 = p0 + d * L * 0.5
        p2 = p1 + (d + Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), -0.5))).normalized() * L * 0.5
        mb.tube(R, [p0, p1, p2], 0.009, seg=5, cap_start=True)
    mb.cyl(R, Vector((-0.5, 0.45, 0.4)), Vector((0.45, 0.6, 0.5)), 0.055, 0.055, seg=8)
    finish("debris_pile", mb, "furniture", ao=dict(samples=16, dist=0.5, strength=0.85), post=lambda o: grime_vc(o, 17, dirt=0.7, ground=0.6, ground_h=0.6),
           notes="2 m collapsed-building rubble heap: concrete chunks, cinder blocks, planks, sheet metal, bent rebar, pipe")


BUILD = dict(tire_stack=tire_stack, crate_stack=crate_stack, fence_chainlink_4m=fence_chainlink_4m, debris_pile=debris_pile)

if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for n in [x for x in a if x in BUILD] or list(BUILD):
        BUILD[n]()

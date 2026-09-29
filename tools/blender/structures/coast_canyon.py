"""Coastal + canyon rock set: sea_stack_a/b/c, hoodoo_a/b, natural_arch, mesa_a/b, lighthouse, wharf_ruin.
ONLY=<id> to build a single asset."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rocklib import *  # noqa

ONLY = os.environ.get("ONLY", "")


def want(i):
    return ONLY in ("", i)


def collision_from(p, info, frac=0.85, every=3, top_frac=0.9):
    """Convex-hull collision for a tower: hull of a few rings shrunk toward the centre."""
    rings = info["rings"]
    cx, cz = info["center"]
    picks = rings[::max(1, len(rings) // 4)] + [rings[-1]]
    pts = []
    for r in picks:
        for v in r[::2]:
            pts.append((cx + (v.x - cx) * frac, v.y, cz + (v.z - cz) * frac))
    p.chull(pts)


# ---------------------------------------------------------------------------------------------- sea stacks
def sea_stack_a():
    p = RockPiece("sea_stack_a", seed=41, ground_y=0.0, dirt_h=2.5, dirt_amt=0.35, ao_dist=8)
    H = 35.0
    st = STRATA_COAST(seed=5, y0=0.0)
    prof = [(0.0, 9.5), (0.05, 7.0), (0.10, 8.6), (0.35, 7.4), (0.6, 5.8), (0.85, 4.6), (1.0, 4.2)]
    info = rock_tower(p, "rock_grey", 0, 0, 0.0, H, prof, sides=20, seed=41, jag=0.24, strata=st, skew=(3.0, 1.2), erosion=0.16, layer_var=0.06, top="rough", top_rough=1.6, lobes=(5, 0.16))
    rock_skirt(p, STRATA_COAST(seed=9, y0=0.0), 0, 0, 0.0, 7.4, 15.5, 3.4, sides=18, seed=3)
    boulders(p, "rock_grey", 0, 0, 11, 17, 9, 1.2, 3.0, seed=5, y=0.0, tint=(0.5, 0.52, 0.5))
    collision_from(p, info)
    p.notes = dict(desc="Tall leaning sea stack (limestone, banded), origin at waterline centre; base talus + boulders. Undercut waist at y~2.",
                   height=H, radius_base=15.5, placement="stand in the sea beside coastal road, any yaw")
    p.build()


def sea_stack_b():
    p = RockPiece("sea_stack_b", seed=42, ground_y=0.0, dirt_h=2.5, dirt_amt=0.35, ao_dist=8)
    H = 24.0
    st = STRATA_RED(seed=7, y0=0.0)
    prof = [(0.0, 15.0), (0.06, 12.0), (0.12, 13.8), (0.45, 13.0), (0.75, 12.6), (0.9, 13.6), (1.0, 13.0)]
    info = rock_tower(p, "rock_red", 0, 0, 0.0, H, prof, sides=22, seed=42, jag=0.16, strata=st, ellipse=(1.0, 0.72), erosion=0.10, top="rough", top_rough=1.3, rot=0.3, lobes=(4, 0.12), layer_var=0.05)
    rock_skirt(p, STRATA_RED(seed=2, y0=0.0), 0, 0, 0.0, 11.6, 21, 3.5, sides=22, seed=8, ellipse=(1.0, 0.72))
    boulders(p, "rock_red", 0, 0, 15, 22, 10, 1.2, 3.4, seed=6, y=0.0)
    collision_from(p, info, frac=0.9)
    p.notes = dict(desc="Wide table-top sea stack, sandstone, sheer cliffs, flat rough top. Origin at waterline centre.", height=H, radius_base=21)
    p.build()


def sea_stack_c():
    p = RockPiece("sea_stack_c", seed=43, ground_y=0.0, dirt_h=2.5, dirt_amt=0.35, ao_dist=8)
    st1 = STRATA_GREY(seed=3, y0=0.0)
    st2 = STRATA_GREY(seed=4, y0=0.0)
    prof1 = [(0.0, 8.5), (0.06, 6.4), (0.14, 7.6), (0.4, 6.3), (0.62, 4.7), (0.8, 3.4), (0.92, 2.4), (1.0, 1.1)]
    prof2 = [(0.0, 7.0), (0.06, 5.2), (0.15, 6.2), (0.45, 4.6), (0.7, 3.4), (0.88, 2.5), (1.0, 0.9)]
    i1 = rock_tower(p, "rock_grey", -5.0, 0.0, 0.0, 34.0, prof1, sides=16, seed=43, jag=0.22, strata=st1, skew=(-1.5, 0.5), erosion=0.14, top="spire", spire_h=3.5, lobes=(3, 0.2))
    i2 = rock_tower(p, "rock_grey", 7.0, 3.5, 0.0, 23.0, prof2, sides=15, seed=44, jag=0.22, strata=st2, skew=(2.0, -0.8), erosion=0.14, top="spire", spire_h=2.6, rot=0.5, lobes=(3, 0.2))
    # saddle bridging both spires
    rock_lump(p, "rock_grey", (1.0, 5.5, 1.8), (7.0, 5.5, 5.0), seed=9, sides=11, rings=4, jag=0.15, tint=(0.9, 0.9, 0.88))
    rock_skirt(p, STRATA_GREY(seed=6, y0=0.0), 1.0, 1.5, 0.0, 6.0, 17.0, 3.2, sides=22, seed=4, ellipse=(1.25, 0.85))
    boulders(p, "rock_grey", 1.0, 1.5, 12, 19, 10, 1.0, 3.0, seed=8, y=0.0, tint=(0.55, 0.57, 0.55))
    collision_from(p, i1)
    collision_from(p, i2)
    p.notes = dict(desc="Twin-spire sea stack (34 m + 23 m) joined by a saddle. Origin at waterline centre between the spires.", height=34)
    p.build()



def collision_segments(p, info, n=3, frac=0.9):
    """n stacked convex hulls along a tower (better than one hull for hourglass shapes)."""
    rings = info["rings"]
    cx, cz = info["center"]
    k = max(2, len(rings) // n)
    for i in range(n):
        grp = rings[i * k: (i + 1) * k + 1] if i < n - 1 else rings[i * k:]
        pts = []
        for r in grp:
            for v in r[::2]:
                pts.append((v.x + (cx - v.x) * (1 - frac), v.y, v.z + (cz - v.z) * (1 - frac)))
        if len(pts) >= 4:
            p.chull(pts)


def top_center(info):
    r = info["rings"][-1]
    return (sum(v.x for v in r) / len(r), r[0].y, sum(v.z for v in r) / len(r))


def HOODOO(seed=1, y0=0.0, soft=5.0):
    return Strata([(soft, "rock_red", (1.05, 0.98, 0.94), 0.18), (2.0, "rock_red", (0.72, 0.62, 0.58), 0.95), (1.1, "sand", (1.0, 0.94, 0.86), 0.3),
                   (soft * 0.8, "rock_red", (0.95, 0.9, 0.88), 0.2), (1.6, "dirt_red", (0.8, 0.72, 0.68), 0.95)], y0=y0, seed=seed, jitter=0.3, cycle=True)


# ---------------------------------------------------------------------------------------------- hoodoos
def hoodoo_a():
    p = RockPiece("hoodoo_a", seed=51, ground_y=0.0, dirt_h=3.0, dirt_amt=0.4, ao_dist=6, strata_period=3.0)
    H = 33.0
    prof = [(0.0, 7.0), (0.05, 6.0), (0.3, 4.4), (0.55, 3.6), (0.8, 3.5), (0.93, 4.8), (1.0, 4.4)]
    info = rock_tower(p, "rock_red", 0, 0, 0.0, H, prof, sides=15, seed=51, jag=0.24, strata=HOODOO(seed=3), erosion=0.42, layer_var=0.14,
                      top="rough", top_rough=1.2, skew=(2.2, -1.0), lobes=(3, 0.2), ring_dy=4.0, layer_shift=0.9, layer_twist=14, layer_ell=0.22, ellipse=(1.1, 0.85))
    rock_skirt(p, STRATA_RED_DARK(seed=4), 0, 0, 0.0, 6.4, 10.0, 3.0, sides=16, seed=7, ellipse=(1.1, 0.85), jag=0.3)
    boulders(p, "rock_red", 0, 0, 7.5, 11.5, 9, 0.8, 2.2, seed=3, y=0.0)
    tc = top_center(info)
    rock_lump(p, "rock_red", (tc[0] + 0.3, tc[1] + 1.9, tc[2]), (2.6, 2.3, 2.4), seed=5, sides=10, rings=4, jag=0.22, tint=(0.75, 0.66, 0.62))
    collision_segments(p, info, 3)
    p.notes = dict(desc="Tall eroded hoodoo (36 m): soft red sandstone shaft, hard dark caprock flares, balanced boulder on top. Origin at base centre.", height=H, radius_base=12.5)
    p.build()


def hoodoo_b():
    p = RockPiece("hoodoo_b", seed=52, ground_y=0.0, dirt_h=3.0, dirt_amt=0.4, ao_dist=6, strata_period=3.0)
    H = 27.0
    prof = [(0.0, 6.8), (0.06, 5.8), (0.35, 4.6), (0.6, 3.0), (0.78, 2.7), (0.86, 5.6), (0.95, 6.2), (1.0, 4.4)]
    info = rock_tower(p, "rock_red", 0, 0, 0.0, H, prof, sides=16, seed=52, jag=0.24, strata=HOODOO(seed=6, soft=4.2), erosion=0.38, layer_var=0.14,
                      top="rough", top_rough=1.4, skew=(-1.4, 1.4), lobes=(4, 0.2), ring_dy=3.5, rot=0.4, layer_shift=0.8, layer_twist=16, layer_ell=0.22, ellipse=(1.15, 0.85))
    info2 = rock_tower(p, "rock_red", 8.5, 3.0, 0.0, 15.0, [(0.0, 3.6), (0.1, 3.0), (0.5, 2.3), (0.8, 2.2), (1.0, 2.6)], sides=12, seed=53, jag=0.18,
                       strata=HOODOO(seed=9, soft=3.4), erosion=0.36, top="rough", top_rough=0.9, skew=(1.0, 0.4), lobes=(3, 0.2), ring_dy=3.5, layer_shift=0.5, layer_twist=14, layer_ell=0.2, layer_var=0.12)
    rock_skirt(p, STRATA_RED_DARK(seed=5), 3.5, 1.4, 0.0, 6.4, 11.5, 2.8, sides=20, seed=9, ellipse=(1.5, 0.85), jag=0.3)
    boulders(p, "rock_red", 3.5, 1.4, 7, 12, 10, 0.8, 2.2, seed=4, y=0.0)
    tc = top_center(info)
    rock_lump(p, "rock_red", (tc[0], tc[1] + 1.3, tc[2] - 0.3), (2.0, 1.6, 2.2), seed=8, sides=9, rings=3, jag=0.24, tint=(0.72, 0.62, 0.58))
    collision_segments(p, info, 3)
    collision_segments(p, info2, 2)
    p.notes = dict(desc="Squat eroded hoodoo (27 m) with a wide mushroom cap and a smaller companion pillar (15 m). Origin between the pillars.", height=H)
    p.build()



# ---------------------------------------------------------------------------------------------- natural arch
def _spow(v, e):
    return math.copysign(abs(v) ** e, v)


def natural_arch():
    p = RockPiece("natural_arch", seed=61, ground_y=0.0, dirt_h=4.0, dirt_amt=0.45, ao_dist=10, noise_scale=0.08)
    D = 14.0
    st = STRATA_RED(seed=11, y0=-1.5)
    M = 46
    zs = [0.0, 1.2, 3.2, 5.3, 7.0, 8.7, 10.8, 12.8, D]
    Y0 = -1.5

    def fz(z, k):
        u = (z - D / 2) / (D / 2)
        return 1 - k * u * u

    def path(z, half, crown, n, seed, amp, inner):
        pts = []
        f = fz(z, 0.16)
        for i in range(M + 1):
            ph = math.pi * i / M
            cx_, sy_ = math.cos(ph), math.sin(ph)
            x = half * f * _spow(cx_, 2.0 / n)
            y = Y0 + (crown - Y0) * (fz(z, 0.10) if not inner else fz(z, 0.06)) * (abs(sy_) ** (2.0 / n))
            nx = nz(x * 0.6, y * 0.6, z * 0.6, seed, 2, 0.11)
            ny = nz(x * 0.6 + 9, y * 0.6, z * 0.6, seed + 1, 2, 0.11)
            nzz = nz(x * 0.6, y * 0.6 + 5, z * 0.6, seed + 2, 2, 0.11)
            fine = nz(x, y, z, seed + 5, 1, 0.5)
            edge = 0.0 if (i == 0 or i == M) else 1.0
            x += (amp * nx + 0.6 * fine) * edge + (1.6 if (x > 0 and not inner) else 0.0)
            y += (amp * 0.8 * ny + 0.6 * fine) * edge
            zsh = 2.0 * math.sin(x * 0.09 + 1.0) * (0.0 if inner else 1.0)
            pts.append(Vector((x, max(y, Y0) if edge else Y0, z + zsh * (0.5 + 0.5 * math.sin(math.pi * z / D)) + amp * 0.4 * nzz * (0 if z in (0.0, D) else 1))))
        return pts

    outer = [path(z, 23.0, 27.5, 3.2, 3, 3.0, False) for z in zs]
    inner = [path(z, 13.4, 17.6, 2.4, 8, 2.0, True) for z in zs]
    DIP = (0.05, 0.03)
    rock_sweep(p, outer, st, flat=True, closed=False, seed=2, dip=DIP)
    rock_sweep(p, inner, st, flat=True, closed=False, invert=True, seed=3, dip=DIP)
    # front (z=0) and back (z=D) frames between inner and outer boundary, with relief
    em = Emitter(p, None, True)
    rng = random.Random(9)
    R = 5
    for zi, sgn in ((0, -1), (len(zs) - 1, 1)):
        grid = []
        for i in range(M + 1):
            col = []
            for j in range(R + 1):
                a, b = inner[zi][i], outer[zi][i]
                t = j / R
                q = a.lerp(b, t)
                relief = nz(q.x * 0.5, q.y * 0.5, q.z + sgn * 5, 14, 2, 0.14) * 1.3 * math.sin(math.pi * t)
                q = Vector((q.x, q.y, q.z + sgn * (relief + 0.5 * math.sin(math.pi * t))))
                col.append(q)
            grid.append(col)
        for i in range(M):
            for j in range(R):
                pts = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
                if sgn > 0:
                    pts = pts[::-1]
                face_strata(em, pts, st, rng, DIP)
    # rubble at leg bases
    for sx in (-1, 1):
        boulders(p, "rock_red", sx * 22.0, 7.0, 0.0, 6.5, 8, 1.2, 3.6, seed=4 + sx, y=0.0)
        boulders(p, "rock_red", sx * 12.5, 7.0, 0.0, 3.0, 4, 0.6, 1.6, seed=9 + sx, y=0.0)
    # collision: legs only (convex hulls of the wall points below the spring line)
    for sx in (-1, 1):
        pts = []
        for zi in (0, len(zs) // 2, len(zs) - 1):
            for path_ in (outer[zi], inner[zi]):
                for v in path_:
                    if v.x * sx > 0 and v.y < 15.5:
                        pts.append((v.x, v.y, v.z))
        p.chull(pts)
    p.socket("arch_crown", (0, 17.6, D / 2))
    p.notes = dict(desc="Natural rock arch over the road, road-aligned (+Z), z=0..14. Inner clear opening: 26.8 m wide at the ground (x +-13.4), 17.6 m crown; >=15 m over the driving lane x in [-7,7]. Legs beyond |x|=13.4 out to |x|~24.",
                   clear_span=26.8, crown_y=17.6, depth=D, collision="legs only (2 hulls)", placement="road passes through at x=0; terrain should rise at the legs")
    p.build()



# ---------------------------------------------------------------------------------------------- mesas
def MESA(seed=1, y0=0.0, k=1.0):
    return Strata([(9.0 * k, "rock_red", (1.08, 1.02, 0.96), 0.85), (2.8 * k, "sand", (1.0, 0.95, 0.86), 0.3), (6.5 * k, "rock_red", (0.78, 0.7, 0.68), 0.7),
                   (1.6 * k, "dirt_red", (0.75, 0.7, 0.68), 0.2), (8.0 * k, "rock_red", (1.12, 1.04, 0.98), 0.9), (2.4 * k, "sand", (0.95, 0.88, 0.8), 0.35),
                   (5.0 * k, "rock_red", (0.7, 0.62, 0.6), 0.65)], y0=y0, seed=seed, jitter=0.35, cycle=True)


def mesa_a():
    p = RockPiece("mesa_a", seed=71, ground_y=0.0, dirt_h=8.0, dirt_amt=0.35, ao_dist=22, noise_scale=0.04, streak_amt=0.3)
    H, R = 95.0, 72.0
    prof = [(0.0, R * 1.0), (0.4, R * 0.99), (0.7, R * 1.0), (0.93, R * 0.96), (1.0, R * 0.93)]
    info = rock_tower(p, "rock_red", 0, 0, 0.0, H, prof, sides=48, seed=71, jag=0.13, strata=MESA(seed=3, k=1.7), ellipse=(1.0, 0.5), erosion=0.06, layer_var=0.025,
                      top="rough", top_rough=1.2, ring_dy=10.0, nscale=0.035, lobes=(13, 0.09), foot=3.0, skew=(6.0, -3.0), layer_shift=0.4, layer_twist=1.5)
    rock_skirt(p, "dirt_red", 0, 0, 0.0, R * 0.93, R * 1.3, 28.0, sides=48, seed=5, ellipse=(1.0, 0.5), jag=0.16, tint=(0.95, 0.85, 0.8))
    rock_skirt(p, "sand", 0, 0, 0.0, R * 0.995, R * 1.12, 12.0, sides=48, seed=6, ellipse=(1.0, 0.5), jag=0.2, tint=(0.9, 0.8, 0.7), rot=0.06)
    boulders(p, "rock_red", 0, 0, R * 0.95, R * 1.4, 24, 2.0, 6.5, seed=8, y=0.0, jag=0.28, ellipse=(1.0, 0.5))
    # a few caprock lumps on the plateau
    for i, (x, z, s) in enumerate([(-30, 2, 4.2), (14, -6, 3.2), (42, 3, 5.0)]):
        rock_lump(p, "rock_red", (x, H + 1.0, z), (s * 1.4, s * 0.8, s), seed=20 + i, sides=9, rings=3, jag=0.22, tint=(0.8, 0.72, 0.68))
    collision_from(p, info, frac=0.9)
    p.notes = dict(desc="Flat-top mesa backdrop, 144 x ~72 m footprint (~190 m with talus), 95 m tall, red banded cliffs + talus apron. Origin at base centre; low detail (backdrop, place 60-400 m off the road).",
                   width=140, height=H, placement="far backdrop; yaw freely; long axis = x")
    p.build()


def mesa_b():
    p = RockPiece("mesa_b", seed=72, ground_y=0.0, dirt_h=8.0, dirt_amt=0.35, ao_dist=22, noise_scale=0.04, streak_amt=0.3)
    R1, H1 = 58.0, 62.0
    prof1 = [(0.0, R1), (0.4, R1 * 0.98), (0.75, R1 * 1.0), (1.0, R1 * 0.95)]
    info = rock_tower(p, "rock_red", 0, 0, 0.0, H1, prof1, sides=44, seed=72, jag=0.14, strata=MESA(seed=8, k=1.5), ellipse=(1.0, 0.62), erosion=0.06, layer_var=0.025,
                      top="rough", top_rough=1.0, ring_dy=9.0, nscale=0.04, lobes=(11, 0.09), foot=3.0, skew=(-4.0, 2.0), layer_shift=0.4, layer_twist=1.5, rot=0.2)
    R2, H2 = 30.0, 48.0
    prof2 = [(0.0, R2), (0.3, R2 * 0.96), (0.7, R2 * 1.0), (1.0, R2 * 0.9)]
    info2 = rock_tower(p, "rock_red", 14.0, 3.0, H1 - 1.0, H2 + 1.0, prof2, sides=32, seed=73, jag=0.14, strata=MESA(seed=12, y0=H1 - 1.0, k=1.4), ellipse=(1.0, 0.7), erosion=0.06, layer_var=0.025,
                       top="rough", top_rough=0.8, ring_dy=8.0, nscale=0.05, lobes=(9, 0.09), foot=1.0, skew=(2.0, -1.0), layer_shift=0.4, layer_twist=1.5, rot=0.5)
    rock_skirt(p, "dirt_red", 0, 0, 0.0, R1 * 0.95, R1 * 1.3, 20.0, sides=44, seed=5, ellipse=(1.0, 0.62), jag=0.16, tint=(0.95, 0.85, 0.8))
    rock_skirt(p, "sand", 0, 0, 0.0, R1 * 0.99, R1 * 1.1, 9.0, sides=44, seed=6, ellipse=(1.0, 0.62), jag=0.2, tint=(0.9, 0.8, 0.7), rot=0.07)
    boulders(p, "rock_red", 0, 0, R1 * 0.95, R1 * 1.4, 20, 1.8, 6.0, seed=9, y=0.0, jag=0.28, ellipse=(1.0, 0.62))
    for i, (x, z, s) in enumerate([(-18, 4, 3.6), (30, 12, 3.2)]):
        rock_lump(p, "rock_red", (x, H1 + 0.6, z), (s * 1.3, s * 0.8, s), seed=30 + i, sides=9, rings=3, jag=0.22, tint=(0.8, 0.72, 0.68))
    collision_from(p, info, frac=0.9)
    collision_from(p, info2, frac=0.9)
    p.notes = dict(desc="Two-tier butte/mesa backdrop, ~112 m wide lower tier (62 m) + 48 m upper butte offset to +X, total ~110 m tall, red banded cliffs. Origin at base centre; backdrop only.",
                   width=112, height=H1 + H2, placement="far backdrop, 60-400 m from the road")
    p.build()



from coast_structures import lighthouse, wharf_ruin  # noqa: E402

if __name__ == "__main__":
    for name in ("sea_stack_a", "sea_stack_b", "sea_stack_c", "hoodoo_a", "hoodoo_b", "natural_arch", "mesa_a", "mesa_b", "lighthouse", "wharf_ruin"):
        if want(name):
            globals()[name]()

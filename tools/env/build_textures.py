"""Build public/textures/<name>/{albedo,normal,arm}.jpg from cached Poly Haven (CC0) photoscans + procedural grading / wear.
   usage: build_textures.py [name ...]   (no args = all)   -- needs tools/env/tex_fetch.py run first."""
import json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "public", "textures")
CACHE = os.environ.get("ROD_ART_CACHE", "C:/Dev/art_cache/rideordie/env")
META = {}   # name -> dict(source, tile_m, size)


def src(i, n):
    d = os.path.join(CACHE, i)
    alb = resize(load(os.path.join(d, "Diffuse.jpg")), n)
    nor = dec_n(resize(load(os.path.join(d, "nor_gl.jpg")), n))
    if os.path.exists(os.path.join(d, "arm.jpg")):
        arm = resize(load(os.path.join(d, "arm.jpg")), n)
    else:
        ao = resize(load(os.path.join(d, "AO.jpg"), "L"), n) if os.path.exists(os.path.join(d, "AO.jpg")) else np.ones((n, n), np.float32)
        ro = resize(load(os.path.join(d, "Rough.jpg"), "L"), n)
        mt = resize(load(os.path.join(d, "Metal.jpg"), "L"), n) if os.path.exists(os.path.join(d, "Metal.jpg")) else np.zeros((n, n), np.float32)
        arm = np.stack([ao, ro, mt], -1)
    info = json.load(open(os.path.join(d, "info.json")))
    return alb, nor, arm, info["dimensions_mm"][0] / 1000.0


def mirror2(a, is_normal=False):
    """2x2 mirrored tiling (seamless) resized back to the original size -> doubles the world size of one tile"""
    n = a.shape[0]
    fx = a[:, ::-1].copy(); fy = a[::-1].copy(); fxy = a[::-1, ::-1].copy()
    if is_normal:
        fx[..., 0] *= -1; fy[..., 1] *= -1; fxy[..., 0] *= -1; fxy[..., 1] *= -1
    big = np.concatenate([np.concatenate([a, fx], 1), np.concatenate([fy, fxy], 1)], 0)
    return resize(big, n)


def macro(a, seed, amt=0.10, beta=3.0, hue=0.0, fmax=None):
    """low-frequency tileable brightness/colour variation on an sRGB albedo"""
    n = a.shape[0]
    m = noise(n, beta=beta, seed=seed, fmax=fmax)
    x = s2l(a) * np.exp(m * amt)[..., None]
    if hue:
        m2 = noise(n, beta=beta, seed=seed + 101)
        x[..., 0] *= 1 + m2 * hue * 0.6
        x[..., 2] *= 1 - m2 * hue * 0.6
    return np.clip(l2s(x), 0, 1)


def rough_floor(arm, lo):
    """remap roughness (G) into [lo, 1] - photoscanned rock reads too glossy under bright sky IBL otherwise"""
    arm = arm.copy()
    arm[..., 1] = lo + (1 - lo) * np.clip(arm[..., 1], 0, 1)
    return arm


def sharpen(a, amt=0.5, sigma=1.5):
    return np.clip(a + (a - blur(a, sigma)) * amt, 0, 1)


RECIPES = {}


def recipe(name, size=2048):
    def deco(f):
        RECIPES[name] = (f, size)
        return f
    return deco


# ---------------------------------------------------------------------------------------------- ROAD
@recipe("asphalt")
def r_asphalt(N):
    a, n, arm, tile = src("asphalt_pit_lane", N)
    a = flatten(a, 0.07, 0.9)
    a = tone(a, (64, 58, 53), sat=0.7, contrast=1.1)
    a = macro(a, 11, 0.035, hue=0.05)
    META["asphalt"] = dict(source="asphalt_pit_lane", tile=tile)
    return a, n, arm


@recipe("asphalt_worn")
def r_asphalt_worn(N):
    a, n, arm, tile = src("asphalt_01", N)
    a, n, arm = mirror2(a), dec_n(enc_n(mirror2(n, True))), mirror2(arm)
    a = flatten(a, 0.07, 0.9)
    a = tone(a, (86, 77, 69), sat=0.6, contrast=1.15)     # sun-faded
    a = sharpen(a, 0.6, 2.0)
    u = (np.arange(N)[None, :] / N) * np.ones((N, 1))
    v = (np.arange(N)[:, None] / N) * np.ones((1, N))
    L = s2l(a)
    ao, ro, mt = arm[..., 0].copy(), arm[..., 1].copy(), arm[..., 2].copy()
    # tyre tracks (two polished bands, streaky along the road = image Y)
    streak = aniso_noise(N, 90, 3, seed=3)
    breakup = smoothstep(noise(N, 2.5, 4), -1.2, 0.6) * 0.5 + 0.5
    T = (np.exp(-((u - 0.255) / 0.075) ** 2) + np.exp(-((u - 0.745) / 0.075) ** 2)) * breakup
    T = np.clip(T, 0, 1)
    L *= (1 - 0.50 * T * (0.7 + 0.3 * streak))[..., None]                       # rubber darkening
    ro = ro - 0.10 * T                                                          # polished by tyres
    n = scale_n(n, 1 - 0.35 * T)                                                # flatten normals in the tracks
    # dusty lighter centre + edge aggregate exposure
    C = np.exp(-((u - 0.5) / 0.09) ** 2)
    L *= (1 + 0.16 * C * (0.6 + 0.4 * noise(N, 2, 5)))[..., None]
    du = np.minimum(u, 1 - u)
    E = np.exp(-(du / 0.07) ** 2)
    edgen = smoothstep(noise(N, 1.2, 6), -0.4, 1.2)
    L *= (1 + 0.45 * E * (0.5 + edgen))[..., None]
    ro = ro + 0.05 * E
    # ghost of an old edge line (very faded, chipped) centred on the u wrap
    line = np.exp(-(du / 0.016) ** 4)
    chip = smoothstep(noise(N, 0.8, 7) + 0.5 * noise(N, 1.6, 8), 0.1, 0.9)
    ghost = line * chip * 0.6
    L = L * (1 - ghost[..., None]) + np.array([0.42, 0.40, 0.34]) * ghost[..., None]
    ro = ro + 0.12 * ghost
    # oil drips in the centre strip
    oil_n = noise(N, 1.6, 9)
    oil = smoothstep(oil_n, 0.75, 1.3) * np.exp(-((u - 0.5) / 0.13) ** 2)
    big = smoothstep(noise(N, 3.0, 10), 0.9, 1.6) * np.exp(-((u - 0.47) / 0.16) ** 2)
    oil = np.clip(oil + big * 0.9, 0, 1)
    oil = blur(oil, 2.0)
    L *= (1 - 0.7 * oil)[..., None]
    ro = ro * (1 - oil) + 0.28 * oil
    # one sealed transverse crack
    wob = noise(N, 2.2, 12) * 0.006 + 0.2 * np.sin(2 * np.pi * u * 2) * 0.004
    d = np.abs(v - 0.62 - wob)
    seal = np.exp(-(d / 0.0034) ** 2) * smoothstep(noise(N, 1.0, 13), -1.0, 0.0)
    L *= (1 - 0.6 * seal)[..., None]
    ro = ro * (1 - seal) + 0.35 * seal
    a = np.clip(l2s(L), 0, 1)
    a = macro(a, 14, 0.035)
    a = np.clip(a * (1 + 0.10 * noise(N, 0.3, 15))[..., None], 0, 1)   # fine aggregate grain
    arm = np.stack([ao, np.clip(ro, 0.2, 1), mt], -1)
    META["asphalt_worn"] = dict(source="asphalt_01 (+procedural wear)", tile=3.7, note="one lane wide, tile U across the lane")
    return a, n, arm


@recipe("asphalt_cracked")
def r_asphalt_cracked(N):
    a, n, arm, tile = src("asphalt_02", N)
    a = flatten(a, 0.07, 0.85)
    a = tone(a, (80, 73, 66), sat=0.7, contrast=1.1)
    a = macro(a, 21, 0.035)
    META["asphalt_cracked"] = dict(source="asphalt_02", tile=tile)
    return a, n, arm


# ---------------------------------------------------------------------------------------------- TERRAIN
@recipe("sand")
def r_sand(N):
    a, n, arm, tile = src("sandy_gravel_02", N)
    a = flatten(a, 0.07, 0.9)
    a = tone(a, (196, 152, 98), sat=0.9, contrast=1.25)       # warm desert sand
    # wind ripples: asymmetric periodic waves, warped, fading in patches
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N
    warp = noise(N, 3.2, 31)
    kx, ky = 17, 5
    ph = kx * xx + ky * yy + warp * 0.55 + noise(N, 2.5, 32) * 0.12
    wave = np.sin(2 * np.pi * ph) + 0.3 * np.sin(4 * np.pi * ph + 0.9)
    patch = smoothstep(noise(N, 3.0, 33), -1.0, 0.6) * 0.75 + 0.25
    ripple = (wave * patch).astype(np.float32)
    rn = height_to_n(ripple * 8.0, 1.0)
    n = add_n(scale_n(n, 0.8), rn)
    L = s2l(a)
    L *= np.exp(0.11 * ripple)[..., None]
    a = macro(np.clip(l2s(L), 0, 1), 34, 0.08, hue=0.05)
    ao = arm[..., 0] * np.clip(1 + 0.06 * np.minimum(ripple, 0), 0.8, 1)
    arm = np.stack([ao, np.clip(arm[..., 1], 0.85, 1.0), arm[..., 2]], -1)
    META["sand"] = dict(source="sandy_gravel_02 (+procedural wind ripples)", tile=tile)
    return a, n, arm


@recipe("dirt_red")
def r_dirt_red(N):
    a, n, arm, tile = src("red_dirt_mud_01", N)
    a = flatten(a, 0.07, 0.9)
    a = tone(a, (150, 84, 52), sat=1.0, contrast=1.15)
    a = macro(a, 41, 0.035, hue=0.05)
    META["dirt_red"] = dict(source="red_dirt_mud_01", tile=tile)
    return a, n, arm


@recipe("dry_grass")
def r_dry_grass(N):
    a, n, arm, tile = src("withered_grass", N)
    a = flatten(a, 0.11, 1.0)
    a = tone(a, (176, 142, 84), sat=0.6, contrast=1.3)
    a = macro(a, 51, 0.035, hue=0.08)
    META["dry_grass"] = dict(source="withered_grass", tile=tile)
    return a, n, arm


@recipe("gravel")
def r_gravel(N):
    a, n, arm, tile = src("gravel_floor_03", N)
    a = flatten(a, 0.11, 1.0)
    a = tone(a, (130, 114, 98), sat=0.9, contrast=1.5)
    a = macro(a, 61, 0.035)
    META["gravel"] = dict(source="gravel_floor_03", tile=tile)
    return a, n, arm


@recipe("rock_red")
def r_rock_red(N):
    a, n, arm, tile = src("cliff_side", N)
    a = flatten(a, 0.07, 0.4)
    a = tone(a, (146, 78, 52), sat=1.15, contrast=1.15)
    a = macro(a, 71, 0.035)
    arm = rough_floor(arm, 0.74)
    META["rock_red"] = dict(source="cliff_side", tile=tile)
    return a, n, arm


@recipe("rock_grey")
def r_rock_grey(N):
    a, n, arm, tile = src("rock_face_03", N)
    a = flatten(a, 0.07, 0.7)
    a = tone(a, (126, 112, 100), sat=0.35, contrast=1.15)
    a = macro(a, 81, 0.035)
    arm = rough_floor(arm, 0.74)
    META["rock_grey"] = dict(source="rock_face_03 (desaturated)", tile=tile)
    return a, n, arm


@recipe("cliff")
def r_cliff(N):
    a, n, arm, tile = src("cliff_side", N)          # same photoscan as rock_red, regraded to a warm grey-tan (coastal / mountain limestone-sandstone)
    a = flatten(a, 0.07, 0.5)
    a = tone(a, (158, 140, 116), sat=0.55, contrast=1.1)
    a = macro(a, 91, 0.035)
    arm = rough_floor(arm, 0.74)
    META["cliff"] = dict(source="cliff_side (re-graded warm grey-tan)", tile=tile, note="strata run horizontally (image X)")
    return a, n, arm


@recipe("snow")
def r_snow(N):
    a, n, arm, tile = src("snow_02", N)
    a = flatten(a, 0.1, 0.9)
    a = tone(a, (236, 241, 248), sat=0.5, contrast=0.6, floor=0.8)
    META["snow"] = dict(source="snow_02", tile=tile)
    return a, n, arm


@recipe("forest_floor")
def r_forest_floor(N):
    a, n, arm, tile = src("forest_leaves_04", N)
    a = flatten(a, 0.1, 0.9)
    a = tone(a, (92, 70, 50), sat=0.85, contrast=1.15)
    a = macro(a, 111, 0.035, hue=0.05)
    META["forest_floor"] = dict(source="forest_leaves_04", tile=tile)
    return a, n, arm


@recipe("grass_green")
def r_grass_green(N):
    a, n, arm, tile = src("forrest_ground_01", N)
    a = flatten(a, 0.07, 0.9)
    a = tone(a, (86, 100, 58), sat=0.95, contrast=1.2)
    a = macro(a, 121, 0.035, hue=0.06)
    META["grass_green"] = dict(source="forrest_ground_01", tile=tile)
    return a, n, arm


@recipe("beach_sand")
def r_beach_sand(N):
    a, n, arm, tile = src("coast_sand_03", N)
    a = flatten(a, 0.13, 1.0)
    a = tone(a, (172, 152, 118), sat=1.1, contrast=1.2)
    a = macro(a, 131, 0.035)
    META["beach_sand"] = dict(source="coast_sand_03", tile=tile)
    return a, n, arm


@recipe("pebbles", 1024)
def r_pebbles(N):
    a, n, arm, tile = src("dry_river_pebbles", N)
    a = grade(a, sat=0.95, gain=1.0)
    META["pebbles"] = dict(source="dry_river_pebbles", tile=tile)
    return a, n, arm


# ---------------------------------------------------------------------------------------------- URBAN
@recipe("concrete", 1024)
def r_concrete(N):
    a, n, arm, tile = src("concrete_floor_03", N)
    a = flatten(a, 0.07, 0.9)
    a = tone(a, (174, 162, 146), sat=0.5, contrast=1.2)
    a = macro(a, 141, 0.035)
    META["concrete"] = dict(source="concrete_floor_03 (bleached)", tile=tile)
    return a, n, arm


@recipe("concrete_cracked", 1024)
def r_concrete_cracked(N):
    a, n, arm, tile = src("cracked_concrete", N)
    a = tone(a, (156, 146, 134), sat=0.5, contrast=1.15)
    META["concrete_cracked"] = dict(source="cracked_concrete (bleached)", tile=tile)
    return a, n, arm


@recipe("rust_metal", 1024)
def r_rust_metal(N):
    a, n, arm, tile = src("rust_coarse_01", N)
    a = flatten(a, 0.07, 0.6)
    a = tone(a, (128, 68, 38), sat=1.15, contrast=1.1)
    META["rust_metal"] = dict(source="rust_coarse_01", tile=tile)
    return a, n, arm


@recipe("brick_ruin", 1024)
def r_brick_ruin(N):
    a, n, arm, tile = src("red_bricks_02", N)
    a = flatten(a, 0.07, 0.7)
    a = tone(a, (118, 84, 70), sat=1.0, contrast=1.1)
    META["brick_ruin"] = dict(source="red_bricks_02", tile=tile)
    return a, n, arm


def build(name):
    f, size = RECIPES[name]
    t0 = time.time()
    a, n, arm = f(size)
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    save_jpg(a, os.path.join(d, "albedo.jpg"), 82, 2)
    save_jpg(enc_n(n), os.path.join(d, "normal.jpg"), 80, 0)
    save_jpg(arm, os.path.join(d, "arm.jpg"), 78, 2)
    m = META.get(name, {})
    m["size"] = size
    m["seam"] = round(seam_error(a), 2)
    m["kb"] = sum(os.path.getsize(os.path.join(d, x)) for x in ("albedo.jpg", "normal.jpg", "arm.jpg")) // 1024
    print("%-18s %4d  %5.1f m  seam=%.2f  %5d KB  %.1fs" % (name, size, m.get("tile", 0), m["seam"], m["kb"], time.time() - t0), flush=True)
    return m


if __name__ == "__main__":
    names = sys.argv[1:] or list(RECIPES)
    meta_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures_meta.json")
    allmeta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    for nm in names:
        allmeta[nm] = build(nm)
        json.dump(allmeta, open(meta_path, "w"), indent=1)

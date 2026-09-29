"""Surface looks for the weapon set: numpy noise + per-material worn/dirty PBR recipes (pure numpy, no bpy).

Inputs are the baked geometric masks (AO small/large, convex edge mask, world position, normal, material id) laid out in the UV atlas.
Output: albedo (sRGB encoded), ORM (R=AO, G=roughness, B=metal), tangent-space normal map.
"""
import math
import os
import time
import numpy as np

MAT_IDS = ["gun_metal", "gun_black", "gun_steel", "polymer", "wood", "rubber", "brass", "glass_lens", "paint", "paint2"]
DBG_DIR = os.environ.get("ROD_DBG", "")


# ---------------------------------------------------------------------------------------------- utils
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def srgb_enc(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def _hash(ix, iy, iz, seed):
    with np.errstate(over="ignore"):
        h = (ix.astype(np.uint32) * np.uint32(374761393) + iy.astype(np.uint32) * np.uint32(668265263)
             + iz.astype(np.uint32) * np.uint32(2246822519) + np.uint32((seed * 1013904223 + 12345) % (2 ** 32)))
        h = (h ^ (h >> np.uint32(13))) * np.uint32(1274126177)
        h = h ^ (h >> np.uint32(16))
        h = h * np.uint32(2654435761)
        h = h ^ (h >> np.uint32(15))
    return (h & np.uint32(0xFFFFFF)).astype(np.float32) * np.float32(1.0 / 16777216.0)


def vnoise(P, f, seed=0):
    """3D value noise in [0,1]. P (N,3) mm, f = frequency (1/mm), f may be a 3-tuple for anisotropy."""
    f = np.asarray(f, np.float32) if isinstance(f, (tuple, list)) else np.float32(f)
    q = P * f
    i0 = np.floor(q)
    fr = (q - i0).astype(np.float32)
    s = fr * fr * (3 - 2 * fr)
    i0 = i0.astype(np.int64)
    ix, iy, iz = i0[:, 0], i0[:, 1], i0[:, 2]
    sx, sy, sz = s[:, 0], s[:, 1], s[:, 2]
    c000 = _hash(ix, iy, iz, seed); c100 = _hash(ix + 1, iy, iz, seed)
    c010 = _hash(ix, iy + 1, iz, seed); c110 = _hash(ix + 1, iy + 1, iz, seed)
    c001 = _hash(ix, iy, iz + 1, seed); c101 = _hash(ix + 1, iy, iz + 1, seed)
    c011 = _hash(ix, iy + 1, iz + 1, seed); c111 = _hash(ix + 1, iy + 1, iz + 1, seed)
    x00 = c000 + (c100 - c000) * sx; x10 = c010 + (c110 - c010) * sx
    x01 = c001 + (c101 - c001) * sx; x11 = c011 + (c111 - c011) * sx
    y0 = x00 + (x10 - x00) * sy; y1 = x01 + (x11 - x01) * sy
    return y0 + (y1 - y0) * sz


def fbm(P, f, octaves=3, seed=0, gain=0.5):
    a, tot, out = 1.0, 0.0, 0.0
    for o in range(octaves):
        ff = f * (2.0 ** o) if not isinstance(f, (tuple, list)) else tuple(x * (2.0 ** o) for x in f)
        out = out + a * vnoise(P, ff, seed + o * 17)
        tot += a
        a *= gain
    return out / tot


def scratches(P, f_along, f_across, seed, width=0.06, axis=0):
    """Thin streaks aligned with an axis: noise sheets stretched along `axis`."""
    fr = [f_across] * 3
    fr[axis] = f_along
    n = vnoise(P, tuple(fr), seed)
    return smoothstep(width, 0.0, np.abs(n - 0.5))


def tri_scratch(P, Ng, f_along, f_across, ang_deg, seed, width, density=0.5, fdens=0.05):
    """Clean line scratches: 2D slices of noise projected along the dominant normal axis (no 3D-tangent blobs).
    Lines run along direction `ang_deg` inside each projection plane."""
    a = math.radians(ang_deg)
    ca, sa = math.cos(a), math.sin(a)
    w = np.abs(Ng) ** 4
    w = w / (w.sum(1, keepdims=True) + 1e-9)
    out = np.zeros(len(P), np.float32)
    for ax, (i, j) in enumerate([(1, 2), (2, 0), (0, 1)]):     # plane perpendicular to axis ax
        idx = np.nonzero(w[:, ax] > 0.04)[0]
        if len(idx) == 0:
            continue
        Ps = P[idx]
        u = Ps[:, i] * ca - Ps[:, j] * sa
        v = Ps[:, i] * sa + Ps[:, j] * ca
        z = np.full(len(idx), seed * 3.71, np.float32)
        n = vnoise(np.stack([u * f_along, v * f_across, z], 1), 1.0, seed + ax)
        line = smoothstep(width, 0.0, np.abs(n - 0.5))
        gate = smoothstep(density - 0.12, density + 0.08, vnoise(np.stack([u * fdens, v * fdens, z * 0.3], 1), 1.0, seed + 40 + ax))
        out[idx] += w[idx, ax] * line * gate
    return out


def rot_pts(P, ang_deg, axis=1):
    a = math.radians(ang_deg)
    c, s = math.cos(a), math.sin(a)
    Q = P.copy()
    i, j = [(1, 2), (2, 0), (0, 1)][axis]
    Q[:, i] = P[:, i] * c - P[:, j] * s
    Q[:, j] = P[:, i] * s + P[:, j] * c
    return Q


# ---------------------------------------------------------------------------------------------- recipes
class Ctx:
    pass


DIRT = np.array([0.050, 0.040, 0.030], np.float32)


def _wear_common(c, st, edge_k=1.0, scuff_k=1.0, scr_k=1.0):
    """Shared wear/grime masks. Returns (wear_hi, wear_lo, grime): hi = bare metal (edges, scratches), lo = dulled/rubbed patches."""
    wk = st.get("wear", 1.0)
    edge_w = smoothstep(0.22, 0.6, c.edge_cx * (0.35 + 1.15 * c.nH))                 # broken edge highlights
    scr = np.maximum(c.scr_a * 0.9, c.scr_b * 0.65)
    hi = np.clip((edge_w * edge_k + scr * scr_k * 0.7) * wk, 0, 1)
    lo = smoothstep(0.60, 0.78, c.nL) * c.expo * (0.5 + 0.7 * c.nM) * scuff_k * wk   # dulled patches on exposed flats
    lo = np.clip(lo * 1.2 + edge_w * 0.35 * wk, 0, 1)
    grime = np.clip(((1 - c.ao_s) * 1.25 + (1 - c.ao_b) * 0.6 + smoothstep(0.55, 0.85, c.nL2) * 0.22 + np.clip(-c.nz, 0, 1) * 0.25) * st.get("dirt", 1.0), 0, 1)
    grime = smoothstep(0.10, 0.85, grime) * (0.4 + 0.6 * c.nM)
    return hi, lo, grime


def recipe_metal(c, base, dull, bare, rough0, rough_worn, metal0=1.0, edge_k=1.0, scuff_k=1.0, brushed=0.0, style=None):
    """Blued / oxide / painted metal: finish -> rubbed patches -> bare steel (edges, scratches); grime, oil sheen, rust freckles."""
    N = c.N
    st = style or {}
    hi, lo, grime = _wear_common(c, st, edge_k, scuff_k)
    alb = np.tile(np.asarray(base, np.float32), (N, 1)) * (0.8 + 0.4 * c.nM[:, None])
    dull_c = np.tile(np.asarray(dull, np.float32), (N, 1)) * (0.7 + 0.6 * c.nH[:, None])
    bare_c = np.tile(np.asarray(bare, np.float32), (N, 1)) * (0.75 + 0.5 * c.nH[:, None]) * (0.85 + 0.3 * c.nM[:, None])
    alb = alb * (1 - lo[:, None]) + dull_c * lo[:, None]
    alb = alb * (1 - hi[:, None]) + bare_c * hi[:, None]
    rough = rough0 + 0.10 * (c.nM - 0.5) + 0.07 * (c.nH - 0.5)
    rough = rough * (1 - lo) + (rough0 + 0.12) * lo
    rough = rough * (1 - hi) + (rough_worn + 0.10 * (c.nH - 0.5)) * hi
    oil = smoothstep(0.55, 0.78, c.nL2) * 0.35                                      # oil sheen
    rough = rough - oil * 0.45 * (1 - hi)
    metal = np.full(N, metal0, np.float32)
    metal = metal * (1 - lo) + np.maximum(metal0, 0.7) * lo
    metal = metal * (1 - hi) + hi
    rust = smoothstep(0.62, 0.74, c.nM2) * np.clip(hi * 0.8 + lo * 0.4 + grime * 0.6, 0, 1) * st.get("rust", 0.4)
    rust_c = np.array([0.22, 0.075, 0.028], np.float32)
    alb = alb * (1 - rust[:, None]) + rust_c * rust[:, None] * (0.6 + 0.8 * c.nH[:, None])
    rough = rough * (1 - rust) + 0.75 * rust
    metal = metal * (1 - rust * 0.6)
    alb = alb * (1 - grime[:, None] * 0.6) + DIRT * grime[:, None] * 0.6
    rough = rough + grime * 0.3
    metal = metal * (1 - grime * 0.5)
    alb = alb * (0.5 + 0.5 * c.ao_s[:, None])
    scr = np.maximum(c.scr_a, c.scr_b)
    h = -0.035 * scr + (c.nH - 0.5) * 0.010
    if brushed:
        h = h + brushed * (c.brush - 0.5) * 0.02
    return alb, np.clip(rough, 0.08, 1.0), np.clip(metal, 0, 1), h


def recipe_polymer(c, style):
    N = c.N
    st = style or {}
    hi, lo, grime = _wear_common(c, st, 0.85, 0.5, 0.5)
    wear = np.clip(hi + lo * 0.6, 0, 1)
    base = np.array([0.011, 0.011, 0.012], np.float32)
    fade = smoothstep(0.5, 0.78, c.nL2) * 0.55
    alb = np.tile(base, (N, 1)) * (0.8 + 0.5 * c.nM[:, None])
    worn_c = np.array([0.045, 0.045, 0.048], np.float32)
    alb = alb * (1 - wear[:, None]) + worn_c * wear[:, None] * (0.7 + 0.6 * c.nH[:, None])
    fade_c = np.array([0.06, 0.056, 0.05], np.float32)
    alb = alb * (1 - fade[:, None] * 0.5) + fade_c * fade[:, None] * 0.5
    dc = np.array([0.065, 0.055, 0.043], np.float32)
    alb = alb * (1 - grime[:, None] * 0.5) + dc * grime[:, None] * 0.5
    alb = alb * (0.5 + 0.5 * c.ao_s[:, None])
    rough = 0.84 + 0.10 * (c.nM - 0.5) - 0.1 * wear + 0.08 * grime
    metal = np.zeros(N, np.float32)
    h = (c.stip - 0.5) * 0.07 + (c.nH - 0.5) * 0.015 - 0.03 * np.maximum(c.scr_a, c.scr_b)
    return alb, np.clip(rough, 0.2, 1.0), metal, h


def recipe_wood(c, style):
    N = c.N
    st = style or {}
    P = c.P
    ax = st.get("wood_axis", 0)
    yz = [i for i in range(3) if i != ax]
    q0, q1 = P[:, yz[0]], P[:, yz[1]]
    wob = (c.nM - 0.5) * 5.0 + (c.nL - 0.5) * 14.0
    r = np.sqrt(q0 ** 2 + (q1 * 1.15) ** 2) + wob + 0.05 * P[:, ax]
    ring = (0.5 + 0.5 * np.sin(r * 2.4)) ** 1.5
    fq = [0.06, c.fmax * 1.4, c.fmax * 1.4] if ax == 0 else [c.fmax * 1.4, 0.06, c.fmax * 1.4]
    fine = vnoise(P, tuple(fq), 91)
    grain = ring * 0.62 + fine * 0.38
    dark = np.array(st.get("wood_dark", (0.05, 0.018, 0.007)), np.float32)
    light = np.array(st.get("wood_light", (0.22, 0.09, 0.035)), np.float32)
    alb = dark + (light - dark) * grain[:, None]
    alb = alb * (0.75 + 0.5 * c.nL[:, None])
    hi, lo, grime = _wear_common(c, st, 1.0, 0.7, 0.8)
    wear = np.clip(hi + lo * 0.7, 0, 1)
    bleach = np.array([0.26, 0.17, 0.09], np.float32)
    alb = alb * (1 - wear[:, None] * 0.65) + bleach * wear[:, None] * 0.65 * (0.7 + 0.5 * c.nH[:, None])
    alb = alb * (1 - grime[:, None] * 0.6) + np.array([0.028, 0.02, 0.014], np.float32) * grime[:, None] * 0.6
    alb = alb * (0.45 + 0.55 * c.ao_s[:, None])
    oil = smoothstep(0.45, 0.75, c.nL2)
    rough = 0.52 - 0.14 * oil + 0.15 * wear + 0.15 * grime + 0.06 * (c.nH - 0.5)
    metal = np.zeros(N, np.float32)
    h = (fine - 0.5) * 0.04 + (ring - 0.5) * 0.02 - 0.05 * np.maximum(c.scr_a, c.scr_b)
    return alb, np.clip(rough, 0.2, 1.0), metal, h


def recipe_rubber(c, style):
    N = c.N
    st = style or {}
    hi, lo, grime = _wear_common(c, st, 0.9, 0.5, 0.4)
    wear = np.clip(hi + lo * 0.6, 0, 1)
    alb = np.tile(np.array([0.010, 0.013, 0.014], np.float32), (N, 1)) * (0.8 + 0.6 * c.nM[:, None])
    alb = alb * (1 - wear[:, None]) + np.array([0.05, 0.048, 0.045], np.float32) * wear[:, None]
    alb = alb * (1 - grime[:, None] * 0.3) + np.array([0.045, 0.035, 0.026], np.float32) * grime[:, None] * 0.3
    alb = alb * (0.5 + 0.5 * c.ao_s[:, None])
    rough = 0.82 + 0.1 * (c.nM - 0.5) - 0.15 * wear
    h = (c.stip - 0.5) * 0.12 + (c.nM - 0.5) * 0.03
    return alb, np.clip(rough, 0.3, 1.0), np.zeros(N, np.float32), h


def recipe_brass(c, style):
    N = c.N
    st = style or {}
    tarn = smoothstep(0.45, 0.72, c.nM) * (0.4 + 0.6 * c.nL2)
    bright = np.array([0.60, 0.40, 0.12], np.float32)
    dull = np.array([0.28, 0.17, 0.06], np.float32)
    alb = bright + (dull - bright) * tarn[:, None] * 0.85
    scr = np.maximum(c.scr_a, c.scr_b)
    alb = alb * (1 + 0.25 * scr[:, None])
    grime = smoothstep(0.1, 0.9, (1 - c.ao_s) * 1.3 + (1 - c.ao_b) * 0.5) * (0.4 + 0.6 * c.nM)
    alb = alb * (1 - grime[:, None] * 0.6) + np.array([0.04, 0.03, 0.02], np.float32) * grime[:, None] * 0.6
    alb = alb * (0.55 + 0.45 * c.ao_s[:, None])
    rough = 0.3 + 0.22 * tarn + 0.25 * grime + 0.05 * (c.nH - 0.5) - 0.06 * scr
    metal = 1.0 - 0.35 * grime - 0.15 * tarn
    h = -0.02 * scr + (c.nH - 0.5) * 0.008
    return alb, np.clip(rough, 0.12, 1.0), np.clip(metal, 0, 1), h


def recipe_paint(c, style):
    N = c.N
    st = style or {}
    base = np.array(st.get("paint_color", (0.42, 0.03, 0.02)), np.float32)
    hi, lo, grime = _wear_common(c, st, 1.0, 0.8, 0.6)
    wear = np.clip(hi + lo * 0.6, 0, 1)
    alb = np.tile(base, (N, 1)) * (0.75 + 0.4 * c.nM[:, None])
    alb = alb * (1 - wear[:, None]) + np.array([0.25, 0.25, 0.25], np.float32) * wear[:, None]
    alb = alb * (1 - grime[:, None] * 0.5) + np.array([0.05, 0.04, 0.03], np.float32) * grime[:, None] * 0.5
    alb = alb * (0.5 + 0.5 * c.ao_s[:, None])
    rough = 0.5 + 0.2 * wear + 0.2 * grime
    return alb, np.clip(rough, 0.2, 1.0), (wear * 0.8).astype(np.float32), (c.nH - 0.5) * 0.01


RECIPES = {
    "gun_metal": lambda c, s: recipe_metal(c, (0.022, 0.026, 0.034), (0.10, 0.10, 0.11), (0.30, 0.30, 0.32), 0.42, 0.32, 1.0, 1.0, 0.9, style=s),
    "gun_black": lambda c, s: recipe_metal(c, (0.006, 0.006, 0.007), (0.05, 0.05, 0.055), (0.27, 0.27, 0.29), 0.70, 0.34, 0.20, 1.1, 1.0, style=s),
    "gun_steel": lambda c, s: recipe_metal(c, (0.24, 0.24, 0.255), (0.15, 0.15, 0.16), (0.36, 0.36, 0.38), 0.36, 0.30, 1.0, 0.3, 0.5, brushed=1.0, style=s),
    "polymer": recipe_polymer,
    "wood": recipe_wood,
    "rubber": recipe_rubber,
    "brass": recipe_brass,
    "paint": recipe_paint,
    "paint2": recipe_paint,
}


def dbg_save_arr(name, arr):
    """debug hook, set by gunfinish (needs bpy)"""
    pass


def compose(masks, size, style, log=print, dbg_save=None):
    t0 = time.time()
    st = style or {}
    idm = masks["id"]
    valid = idm > 0
    if DBG_DIR and dbg_save:
        dbg_save("id", idm.astype(np.float32) / 6.0)
        dbg_save("ao_s", masks["ao_s"]); dbg_save("ao_b", masks["ao_b"]); dbg_save("edge", np.clip(masks["edge"], 0, 1))
    ys, xs = np.nonzero(valid)
    N = len(ys)
    log("  compose: %d valid texels (%.0f%% of atlas)" % (N, 100.0 * N / (size * size)))
    posB = masks["pos"][ys, xs] * 1000.0            # mm, Blender frame
    P = np.stack([-posB[:, 1], posB[:, 0], posB[:, 2]], 1).astype(np.float32)   # -> gun frame (x fwd, y left, z up)
    posimg = np.zeros((size, size, 3), np.float32)
    posimg[ys, xs] = P
    dx = np.linalg.norm(posimg[:, 1:] - posimg[:, :-1], axis=2)
    okx = valid[:, 1:] & valid[:, :-1] & (dx < 3.0)
    texel = float(np.median(dx[okx])) if okx.any() else 0.3           # mm per texel
    fmax = 0.34 / texel                       # highest noise frequency that still resolves (1/mm)
    log("  texel size %.3f mm  fmax %.2f/mm" % (texel, fmax))
    nrmB = masks["nrm"][ys, xs]
    nz = nrmB[:, 2]
    c = Ctx()
    c.N = N; c.P = P; c.nz = nz; c.fmax = fmax
    c.ao_s = np.clip(masks["ao_s"][ys, xs], 0, 1)
    c.ao_b = np.clip(masks["ao_b"][ys, xs], 0, 1)
    edge = np.clip(masks["edge"][ys, xs], 0, 1)
    c.edge_cx = edge * smoothstep(0.62, 0.98, c.ao_s) * st.get("edge_gain", 1.0)      # convex edges only
    c.expo = smoothstep(0.25, 0.85, c.ao_b)
    F = lambda f: min(f, fmax)
    c.nL = fbm(P, 0.045, 3, 1); c.nL2 = fbm(P, 0.02, 2, 5)
    c.nM = fbm(P, F(0.30), 3, 11); c.nM2 = fbm(P, F(0.5), 2, 23)
    c.nH = fbm(P, F(1.4), 2, 31)
    c.stip = vnoise(P, F(1.1), 47) * 0.65 + vnoise(P, F(2.0), 53) * 0.35
    c.brush = vnoise(P, (0.02, F(2.2), F(2.2)), 61)
    Ng = np.stack([-nrmB[:, 1], nrmB[:, 0], nrmB[:, 2]], 1).astype(np.float32)      # normal in gun frame
    fc = F(2.4)
    c.scr_a = np.maximum(tri_scratch(P, Ng, 0.045, fc, 8.0, 71, 0.030, 0.56), tri_scratch(P, Ng, 0.06, fc, -32.0, 73, 0.028, 0.60))
    c.scr_b = np.maximum(tri_scratch(P, Ng, 0.07, fc, 74.0, 83, 0.025, 0.62), tri_scratch(P, Ng, 0.08, fc, 112.0, 89, 0.025, 0.64))
    log("  noise fields %.1fs" % (time.time() - t0))

    alb = np.zeros((N, 3), np.float32) + 0.2
    rough = np.full(N, 0.6, np.float32)
    metal = np.zeros(N, np.float32)
    height = np.zeros(N, np.float32)
    ids = idm[ys, xs]

    def sub(c, m):
        d = Ctx()
        for k, v in c.__dict__.items():
            d.__dict__[k] = v[m] if isinstance(v, np.ndarray) and v.shape[:1] == (N,) else v
        d.N = int(m.sum())
        return d

    for k, name in enumerate(MAT_IDS):
        m = ids == (k + 1)
        if not m.any() or name == "glass_lens":
            continue
        cs = sub(c, m)
        a, r, me, h = RECIPES[name](cs, st)
        alb[m] = a; rough[m] = r; metal[m] = me; height[m] = h
    # decals (world-space painted marks): dict(pos=(x,y,z) mm, r=mm, color=(r,g,b) linear, mats=[..] optional)
    for d in st.get("decals", []):
        p = np.array(d["pos"], np.float32)
        dist = np.linalg.norm(P - p, axis=1)
        rr = d["r"]
        mk = smoothstep(rr, rr * 0.7, dist)
        if d.get("mats"):
            allow = np.zeros(N, bool)
            for nme in d["mats"]:
                allow |= ids == (MAT_IDS.index(nme) + 1)
            mk = mk * allow
        col = np.array(d["color"], np.float32)
        wearing = 1.0 - 0.45 * c.nM * st.get("dirt", 1.0)
        alb = alb * (1 - mk[:, None]) + col * mk[:, None] * wearing[:, None]
        rough = rough * (1 - mk) + d.get("rough", 0.5) * mk
        metal = metal * (1 - mk)
        height = height - mk * d.get("depth", 0.0)
    # grooves / panel lines: dict(axis='x'|'y'|'z', at=mm, width=mm, box=((x0,x1),(y0,y1),(z0,z1)), depth=mm)
    for g in st.get("grooves", []):
        ai = "xyz".index(g["axis"])
        dist = np.abs(P[:, ai] - g["at"])
        mk = smoothstep(g["width"] * 0.5 + texel * 0.6, g["width"] * 0.5 - texel * 0.2, dist)
        if "box" in g:
            for i, (lo, hi) in enumerate(g["box"]):
                if lo is not None:
                    mk = mk * (P[:, i] >= lo) * (P[:, i] <= hi)
        if g.get("mats"):
            allow = np.zeros(N, bool)
            for nme in g["mats"]:
                allow |= ids == (MAT_IDS.index(nme) + 1)
            mk = mk * allow
        height = height - mk * g.get("depth", 0.25)
        alb = alb * (1 - 0.6 * mk[:, None])
        rough = rough + 0.2 * mk
    log("  recipes %.1fs" % (time.time() - t0))
    dbg = os.environ.get("ROD_DEBUG_MASK", "")
    if dbg:
        v = {"ao_s": c.ao_s, "ao_b": c.ao_b, "edge": edge, "edge_cx": c.edge_cx, "id": ids / 8.0, "expo": c.expo}[dbg]
        alb = np.stack([v, v, v], 1).astype(np.float32); rough[:] = 0.9; metal[:] = 0.0; height[:] = 0.0

    A = np.zeros((size, size, 3), np.float32) + 0.05
    O = np.zeros((size, size, 3), np.float32)
    O[..., 0] = 1.0; O[..., 1] = 0.6
    H = np.zeros((size, size), np.float32)
    A[ys, xs] = alb
    ao_mix = np.clip(c.ao_b * 0.55 + c.ao_s * 0.45, 0, 1)
    O[ys, xs, 0] = ao_mix
    O[ys, xs, 1] = rough
    O[ys, xs, 2] = metal
    H[ys, xs] = height
    # normal from height (tangent space, OpenGL: +Y = +v)
    gy, gx = np.gradient(H)
    sx_ = -gx / max(texel, 1e-3); sy_ = -gy / max(texel, 1e-3)
    nn = np.stack([sx_, sy_, np.ones_like(H)], 2)
    nn /= np.linalg.norm(nn, axis=2, keepdims=True)
    NM = np.zeros((size, size, 3), np.float32) + np.array([0, 0, 1], np.float32)
    NM[valid] = nn[valid]
    NM = NM * 0.5 + 0.5
    return srgb_enc(A), O, NM, texel

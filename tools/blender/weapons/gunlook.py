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


# ---------------------------------------------------------------------------------------------- engraved / stamped markings
# 5x7 bitmap font (rows top -> bottom). Covers A-Z, 0-9, a few symbols and Cyrillic D ('Д' -> key 'D~').
FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"], "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"], "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"], "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"], "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"], "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"], "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"], "N": ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"], "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"], "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"], "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"], "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"], "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"], "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"], "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"], "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"], "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"], ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"], "*": ["00100", "10101", "01110", "11111", "01110", "10101", "00100"],
    "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"], ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
    "D~": ["00110", "01010", "01010", "01010", "01010", "11111", "10001"], "^": ["00100", "01110", "11111", "00000", "00000", "00000", "00000"],
    ">": ["01000", "00100", "00010", "00001", "00010", "00100", "01000"], "o": ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
    " ": ["00000"] * 7,
}


def _glyphs(text):
    out, i = [], 0
    while i < len(text):
        if text[i] == "~" and out:
            out[-1] = out[-1] + "~"
            i += 1
            continue
        out.append(text[i])
        i += 1
    return [FONT.get(g, FONT.get(g.upper(), FONT[" "])) for g in out]


def text_mask(P, Ng, spec):
    """Mask (0..1) of a stamped / engraved text line.  spec: text, pos (mm, G frame: centre of the line), u (reading dir),
    v (up dir), h (glyph height mm), optional 'bold' (stroke 0.6..1.0).  Texels whose normal faces away are rejected."""
    u = np.asarray(spec["u"], np.float32)
    u /= np.linalg.norm(u)
    v = np.asarray(spec["v"], np.float32)
    v = v - u * float(np.dot(u, v))
    v /= np.linalg.norm(v)
    n = np.cross(u, v)
    rel = P - np.asarray(spec["pos"], np.float32)[None]
    a = rel @ u
    b = rel @ v
    d = rel @ n
    h = float(spec["h"])
    cw = h * 5.0 / 7.0
    gap = cw * 0.35
    glyphs = _glyphs(spec["text"])
    total = len(glyphs) * (cw + gap) - gap
    x = a + total / 2
    y = h / 2 - b
    near = (np.abs(d) < spec.get("slab", 2.5)) & (np.abs(Ng @ n) > 0.6) & (x >= 0) & (x < total) & (y >= 0) & (y < h)
    out = np.zeros(len(P), np.float32)
    if not near.any():
        return out
    xi = x[near]
    yi = y[near]
    gi = np.floor(xi / (cw + gap)).astype(int)
    gx = (xi - gi * (cw + gap)) / cw * 5.0
    gy = yi / h * 7.0
    col = np.floor(gx).astype(int)
    row = np.floor(gy).astype(int)
    okc = (col >= 0) & (col < 5) & (row >= 0) & (row < 7)
    val = np.zeros(len(xi), np.float32)
    for k in np.unique(gi):
        g = glyphs[int(k)]
        sel = (gi == k) & okc
        if not sel.any():
            continue
        bits = np.array([[c == "1" for c in rowbits] for rowbits in g], bool)
        val[sel] = bits[row[sel], col[sel]].astype(np.float32)
    out[np.flatnonzero(near)] = val
    return out


# ---------------------------------------------------------------------------------------------- recipes
class Ctx:
    pass


DIRT = np.array([0.050, 0.040, 0.030], np.float32)
DUST = np.array([0.20, 0.16, 0.115], np.float32)          # desert dust (linear)


def _wear_common(c, st, edge_k=1.0, scuff_k=1.0, scr_k=1.0):
    """Wear / grime masks. hi = bare material on the sharpest convex edges (broken up, never speckled) + a few long scratches,
    lo = rubbed / handled patches, grime = dirt + dust settled in crevices and on up-facing surfaces."""
    wk = st.get("wear", 1.0)
    brk = smoothstep(0.38, 0.62, c.nM * 0.6 + c.nL * 0.4)                           # breakup at a few cm scale
    edge_w = smoothstep(0.50, 0.85, c.edge_cx) * (0.35 + 0.65 * brk)
    edge_w = np.maximum(edge_w, smoothstep(0.80, 0.97, c.edge_cx) * 0.8)           # the very sharpest edges always show
    scr = np.maximum(c.scr_a, c.scr_b * 0.7)
    hi = np.clip((edge_w * edge_k + scr * scr_k * 0.16) * wk, 0, 1)
    lo = smoothstep(0.62, 0.80, c.nL) * c.expo * (0.4 + 0.6 * c.nM) * scuff_k * wk
    lo = np.clip(lo * 0.45 + edge_w * 0.25 * wk, 0, 1)
    grime = np.clip(((1 - c.ao_s) * 1.35 + (1 - c.ao_b) * 0.55 + np.clip(-c.nz, 0, 1) * 0.15) * st.get("dirt", 1.0), 0, 1)
    grime = smoothstep(0.12, 0.8, grime) * (0.45 + 0.55 * c.nM)
    return hi, lo, grime


def _dust(c, st, alb, rough, amount=1.0):
    """Desert dust: fine layer in crevices and on up-facing surfaces (lighter, rougher)."""
    k = st.get("dust", 0.55) * amount
    d = (smoothstep(0.75, 0.25, c.ao_s) * 0.6 + smoothstep(0.45, 0.95, c.nz) * 0.14 * smoothstep(0.45, 0.8, c.nL2)) * (0.5 + 0.5 * c.nM)
    d = np.clip(d * k, 0, 0.7)
    alb = alb * (1 - d[:, None]) + DUST * d[:, None]
    return alb, rough * (1 - d) + 0.9 * d, d


def recipe_metal(c, base, dull, bare, rough0, rough_worn, metal0=1.0, edge_k=1.0, scuff_k=1.0, brushed=0.0, style=None):
    """Blued / phosphate / painted steel: finish -> rubbed patches -> bare steel on sharp edges; grime, dust, oil sheen."""
    N = c.N
    st = style or {}
    hi, lo, grime = _wear_common(c, st, edge_k, scuff_k)
    alb = np.tile(np.asarray(base, np.float32), (N, 1)) * (0.85 + 0.3 * c.nM[:, None]) * (0.92 + 0.16 * c.nL[:, None])
    dull_c = np.tile(np.asarray(dull, np.float32), (N, 1)) * (0.85 + 0.3 * c.nH[:, None])
    bare_c = np.tile(np.asarray(bare, np.float32), (N, 1)) * (0.85 + 0.3 * c.nH[:, None])
    alb = alb * (1 - lo[:, None]) + dull_c * lo[:, None]
    alb = alb * (1 - hi[:, None]) + bare_c * hi[:, None]
    rough = rough0 + 0.08 * (c.nM - 0.5) + 0.05 * (c.nL - 0.5)
    rough = rough * (1 - lo) + (rough0 - 0.08) * lo
    rough = rough * (1 - hi) + rough_worn * hi
    oil = smoothstep(0.6, 0.8, c.nL2) * 0.3
    rough = rough - oil * 0.3 * (1 - hi)
    metal = np.full(N, metal0, np.float32)
    metal = metal * (1 - hi) + hi
    rust = smoothstep(0.66, 0.76, c.nM2) * np.clip(grime * 0.7 + hi * 0.3, 0, 1) * st.get("rust", 0.25)
    rust_c = np.array([0.16, 0.06, 0.025], np.float32)
    alb = alb * (1 - rust[:, None]) + rust_c * rust[:, None]
    rough = rough * (1 - rust) + 0.8 * rust
    metal = metal * (1 - rust * 0.7)
    alb = alb * (1 - grime[:, None] * 0.55) + DIRT * grime[:, None] * 0.55
    rough = rough + grime * 0.25
    metal = metal * (1 - grime * 0.6)
    alb, rough, d = _dust(c, st, alb, rough)
    metal = metal * (1 - d)
    alb = alb * (0.6 + 0.4 * c.ao_s[:, None])
    scr = np.maximum(c.scr_a, c.scr_b)
    peel = vnoise(c.P, min(c.fmax, 1.4), 211) * 0.6 + vnoise(c.P, min(c.fmax * 0.5, 0.7), 212) * 0.4      # paint / phosphate micro-relief
    h = -0.05 * scr + (peel - 0.5) * 0.035 * (1 - hi) + (c.nH - 0.5) * 0.01
    if brushed:
        h = h + brushed * (c.brush - 0.5) * 0.03
    return alb, np.clip(rough, 0.08, 1.0), np.clip(metal, 0, 1), h


def recipe_polymer(c, style):
    N = c.N
    st = style or {}
    hi, lo, grime = _wear_common(c, st, 0.7, 0.5, 0.4)
    wear = np.clip(hi * 0.8 + lo * 0.5, 0, 1)
    base = np.array(st.get("polymer_color", (0.016, 0.016, 0.017)), np.float32)
    alb = np.tile(base, (N, 1)) * (0.85 + 0.35 * c.nM[:, None])
    worn_c = base * 2.6 + 0.01
    alb = alb * (1 - wear[:, None]) + worn_c * wear[:, None]
    fade = smoothstep(0.55, 0.8, c.nL2) * 0.35
    alb = alb * (1 - fade[:, None] * 0.4) + (base * 2.0 + 0.012) * fade[:, None] * 0.4
    alb = alb * (1 - grime[:, None] * 0.5) + DIRT * grime[:, None] * 0.5
    rough = 0.72 + 0.08 * (c.nM - 0.5) - 0.18 * wear + 0.08 * grime
    alb, rough, d = _dust(c, st, alb, rough, 0.9)
    alb = alb * (0.6 + 0.4 * c.ao_s[:, None])
    stipm = 1.0
    if st.get("polymer_stip"):
        stipm = np.zeros(N, np.float32)
        for (bx, by, bz) in st["polymer_stip"]:
            stipm = np.maximum(stipm, ((c.P[:, 0] >= bx[0]) & (c.P[:, 0] <= bx[1]) & (c.P[:, 1] >= by[0]) & (c.P[:, 1] <= by[1]) & (c.P[:, 2] >= bz[0]) & (c.P[:, 2] <= bz[1])).astype(np.float32))
        stipm = 0.1 + 0.9 * stipm
    h = (c.stip - 0.5) * 0.12 * stipm + (c.nH - 0.5) * 0.02 - 0.04 * np.maximum(c.scr_a, c.scr_b)
    return alb, np.clip(rough, 0.25, 1.0), np.zeros(N, np.float32), h


def recipe_wood(c, style):
    """Oiled / shellacked walnut or laminate: grain along the part, darker pores, worn light edges, varnish sheen."""
    N = c.N
    st = style or {}
    P = c.P
    ax = st.get("wood_axis", 0)
    yz = [i for i in range(3) if i != ax]
    q0, q1 = P[:, yz[0]], P[:, yz[1]]
    wob = (c.nM - 0.5) * 0.9 + (c.nL - 0.5) * 2.4
    # plies / growth lines run along the part: a slanted coordinate across the grain, gently wandering
    r = q1 * 0.92 + q0 * 0.38 + wob + 0.004 * P[:, ax]
    ring = (0.5 + 0.5 * np.sin(r * 2 * math.pi / st.get("grain_pitch", 1.35))) ** 2.2
    ff = min(c.fmax * 1.3, 2.2)
    fq = [ff, ff, ff]
    fq[ax] = 0.03
    fine = vnoise(P, tuple(fq), 91)
    sq = [0.6, 0.6, 0.6]
    sq[ax] = 0.015
    streak = vnoise(P, tuple(sq), 133)
    grain = ring * 0.30 + fine * 0.30 + streak * 0.40
    dark = np.array(st.get("wood_dark", (0.030, 0.010, 0.004)), np.float32)
    light = np.array(st.get("wood_light", (0.13, 0.048, 0.018)), np.float32)
    alb = dark + (light - dark) * grain[:, None]
    alb = alb * (0.8 + 0.4 * c.nL[:, None])
    hi, lo, grime = _wear_common(c, st, 1.0, 0.8, 0.6)
    wear = np.clip(hi + lo * 0.6, 0, 1)
    bleach = np.array(st.get("wood_worn", (0.17, 0.085, 0.04)), np.float32)
    alb = alb * (1 - wear[:, None] * 0.6) + bleach * wear[:, None] * 0.6 * (0.8 + 0.4 * c.nH[:, None])
    alb = alb * (1 - grime[:, None] * 0.6) + np.array([0.022, 0.016, 0.011], np.float32) * grime[:, None] * 0.6
    rough = 0.40 + 0.2 * wear + 0.15 * grime + 0.1 * (1 - fine) * 0.5
    alb, rough, d = _dust(c, st, alb, rough, 0.7)
    alb = alb * (0.55 + 0.45 * c.ao_s[:, None])
    pores = smoothstep(0.62, 0.8, vnoise(P, tuple([x * 3.0 for x in fq]), 97))
    alb = alb * (1 - 0.25 * pores[:, None])
    h = (fine - 0.5) * 0.03 + (ring - 0.5) * 0.02 - 0.05 * pores - 0.05 * np.maximum(c.scr_a, c.scr_b)
    return alb, np.clip(rough, 0.2, 1.0), np.zeros(N, np.float32), h


def recipe_rubber(c, style):
    N = c.N
    st = style or {}
    hi, lo, grime = _wear_common(c, st, 0.6, 0.4, 0.3)
    wear = np.clip(hi * 0.7 + lo * 0.5, 0, 1)
    alb = np.tile(np.array([0.012, 0.012, 0.012], np.float32), (N, 1)) * (0.85 + 0.4 * c.nM[:, None])
    alb = alb * (1 - wear[:, None]) + np.array([0.035, 0.034, 0.032], np.float32) * wear[:, None]
    alb = alb * (1 - grime[:, None] * 0.4) + DIRT * grime[:, None] * 0.4
    rough = 0.88 + 0.06 * (c.nM - 0.5) - 0.1 * wear
    alb, rough, d = _dust(c, st, alb, rough, 1.2)
    alb = alb * (0.6 + 0.4 * c.ao_s[:, None])
    h = (c.stip - 0.5) * 0.12 + (c.nM - 0.5) * 0.03
    return alb, np.clip(rough, 0.3, 1.0), np.zeros(N, np.float32), h


def recipe_brass(c, style):
    N = c.N
    st = style or {}
    tarn = smoothstep(0.45, 0.72, c.nM) * (0.4 + 0.6 * c.nL2)
    bright = np.array([0.55, 0.36, 0.11], np.float32)
    dull = np.array([0.26, 0.16, 0.06], np.float32)
    alb = bright + (dull - bright) * tarn[:, None] * 0.7
    grime = smoothstep(0.1, 0.9, (1 - c.ao_s) * 1.3 + (1 - c.ao_b) * 0.5) * (0.4 + 0.6 * c.nM)
    alb = alb * (1 - grime[:, None] * 0.5) + np.array([0.04, 0.03, 0.02], np.float32) * grime[:, None] * 0.5
    alb = alb * (0.6 + 0.4 * c.ao_s[:, None])
    rough = 0.28 + 0.22 * tarn + 0.25 * grime + 0.04 * (c.nH - 0.5)
    metal = 1.0 - 0.35 * grime - 0.1 * tarn
    h = (c.nH - 0.5) * 0.004
    return alb, np.clip(rough, 0.12, 1.0), np.clip(metal, 0, 1), h


def recipe_paint(c, style, key="paint_color"):
    N = c.N
    st = style or {}
    base = np.array(st.get(key, (0.42, 0.03, 0.02)), np.float32)
    hi, lo, grime = _wear_common(c, st, 1.0, 0.8, 0.6)
    wear = np.clip(hi + lo * 0.5, 0, 1)
    alb = np.tile(base, (N, 1)) * (0.8 + 0.35 * c.nM[:, None])
    under = np.array(st.get("paint_under", (0.12, 0.12, 0.12)), np.float32)
    alb = alb * (1 - wear[:, None]) + under * wear[:, None]
    alb = alb * (1 - grime[:, None] * 0.5) + DIRT * grime[:, None] * 0.5
    rough = st.get("paint_rough", 0.55) + 0.15 * wear + 0.2 * grime + 0.05 * (c.nM - 0.5)
    alb, rough, d = _dust(c, st, alb, rough)
    alb = alb * (0.6 + 0.4 * c.ao_s[:, None])
    return alb, np.clip(rough, 0.2, 1.0), (wear * st.get("paint_metal_under", 0.8)).astype(np.float32), (c.nH - 0.5) * 0.006


RECIPES = {
    # (c, base, dull, bare, rough0, rough_worn, metal0, edge_k, scuff_k)
    "gun_metal": lambda c, s: recipe_metal(c, (0.040, 0.041, 0.044), (0.08, 0.08, 0.084), (0.30, 0.30, 0.31), 0.40, 0.28, 1.0, 1.0, 0.9, style=s),
    "gun_black": lambda c, s: recipe_metal(c, (0.019, 0.019, 0.020), (0.045, 0.045, 0.047), (0.26, 0.26, 0.27), 0.55, 0.32, 0.35, 1.0, 1.0, style=s),
    "gun_steel": lambda c, s: recipe_metal(c, s.get("steel_base", (0.30, 0.30, 0.31)), (0.20, 0.20, 0.21), (0.42, 0.42, 0.43), s.get("steel_rough", 0.30), 0.24, 1.0, 0.4, 0.5, brushed=1.0, style=s),
    "polymer": recipe_polymer,
    "wood": recipe_wood,
    "rubber": recipe_rubber,
    "brass": recipe_brass,
    "paint": recipe_paint,
    "paint2": lambda c, s: recipe_paint(c, s, "paint2_color"),
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
    okx = valid[:, 1:] & valid[:, :-1] & (dx < 3.0) & (dx > 0.02)
    texel = float(np.percentile(dx[okx], 45)) if okx.any() else 0.3           # mm per texel (of the visible, high-density faces)
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
    c.scr_a = np.maximum(tri_scratch(P, Ng, 0.035, fc, 8.0, 71, 0.02, 0.78), tri_scratch(P, Ng, 0.05, fc, -32.0, 73, 0.018, 0.82))
    c.scr_b = np.maximum(tri_scratch(P, Ng, 0.06, fc, 74.0, 83, 0.016, 0.84), tri_scratch(P, Ng, 0.07, fc, 112.0, 89, 0.016, 0.86))
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
    # checkering panels: dict(pos, u, v (panel axes), w, h (panel size mm), pitch=1.3, depth=0.25, border=2.0, mats=[..], slab=10)
    for ck in st.get("checker", []):
        u = np.asarray(ck["u"], np.float32); u /= np.linalg.norm(u)
        v = np.asarray(ck["v"], np.float32); v = v - u * float(np.dot(u, v)); v /= np.linalg.norm(v)
        nn = np.cross(u, v)
        rel = P - np.asarray(ck["pos"], np.float32)[None]
        a_, b_, d_ = rel @ u, rel @ v, rel @ nn
        w2, h2 = ck["w"] / 2, ck["h"] / 2
        inside = (np.abs(d_) < ck.get("slab", 10.0)) & (np.abs(Ng @ nn) > 0.25)
        # rounded-rectangle panel with a smooth border
        ex = np.maximum(np.abs(a_) - (w2 - 4), 0); ey = np.maximum(np.abs(b_) - (h2 - 4), 0)
        rr = np.sqrt(ex * ex + ey * ey)
        panel = smoothstep(4.2, 3.4, rr) * inside
        border = np.exp(-((rr - 4.9) / 0.35) ** 2) * inside
        if ck.get("mats"):
            allow = np.zeros(N, bool)
            for nme in ck["mats"]:
                allow |= ids == (MAT_IDS.index(nme) + 1)
            panel = panel * allow; border = border * allow
        pt = ck.get("pitch", 1.3)
        g1 = np.abs(((a_ * 0.866 + b_ * 0.5) / pt) % 1.0 - 0.5) * 2
        g2 = np.abs(((a_ * 0.866 - b_ * 0.5) / pt) % 1.0 - 0.5) * 2
        diamond = np.minimum(g1, g2)                      # 0 in the grooves, 1 on the diamond tips
        dep = ck.get("depth", 0.25)
        height = height + panel * (diamond - 0.5) * dep - border * dep * 0.8
        alb = alb * (1 - panel[:, None] * 0.35 * (1 - diamond[:, None])) * (1 - 0.3 * border[:, None])
        rough = rough + panel * 0.15
    # stamped / engraved markings: dict(text, pos, u, v, h, depth=0.08, fill='dark'|'light', mats=[..])
    for e in st.get("engrave", []):
        mk = text_mask(P, Ng, e)
        if e.get("mats"):
            allow = np.zeros(N, bool)
            for nme in e["mats"]:
                allow |= ids == (MAT_IDS.index(nme) + 1)
            mk = mk * allow
        if not mk.any():
            continue
        dep = e.get("depth", 0.08) * 2.0
        height = height - mk * dep
        if e.get("fill", "dark") == "dark":
            alb = alb * (1 - 0.55 * mk[:, None])
            rough = rough + 0.15 * mk
        else:
            alb = alb * (1 - mk[:, None]) + np.array(e.get("color", (0.22, 0.22, 0.23)), np.float32) * mk[:, None]
            metal = np.maximum(metal, mk * e.get("metal", 0.8))
            rough = rough * (1 - mk) + 0.35 * mk
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

"""fp_arms texture painter (numpy): every texel knows its rest-pose 3D position / normal / region / finger coordinates, so all
detail (skin pores, knuckle creases, nails, leather grain, glove pattern seams + stitching, knuckle guard, perforations, suede
palm, ribbed cuff, cloth weave, frays, stains, watch dial, paracord) is computed in 3D -> no UV seams show.
Output: albedo (sRGB uint8), ORM (R = AO, G = roughness, B = metal), normal (tangent space, glTF convention, from a height
field in metres with the local texel density)."""
import numpy as np
from PIL import Image
from scipy import ndimage

import uvbake as U

REG = {"skin": 0, "glove": 1, "wrap": 3, "watch": 4, "strap": 5, "metal": 6, "cord": 7, "glass": 8, "hem": 10}
FING = ("Thumb", "Index", "Middle", "Ring", "Pinky")
CUFF_LEN = 0.030
WRAP_FROM = 0.18


def srgb(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


# ------------------------------------------------------------------------------------------------ 3D noise (vectorised)
def _hash3(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).astype(np.float32) / float(0xFFFFFF)


def vnoise(P, f, seed=0):
    """Value noise in [0,1] at frequency f (1/m)."""
    X = P * f
    i = np.floor(X).astype(np.int64)
    t = X - i
    t = t * t * (3 - 2 * t)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                out = out + w * _hash3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(P, f, octaves=4, seed=0, gain=0.5):
    out, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        out = out + amp * vnoise(P, f * (2.03 ** o), seed + o * 17)
        tot += amp
        amp *= gain
    return out / tot


def worley(P, f, seed=0, chunk=400000):
    """F1, F2 cellular distances (in cell units) at frequency f."""
    n = len(P)
    F1 = np.empty(n, np.float32)
    F2 = np.empty(n, np.float32)
    for a in range(0, n, chunk):
        X = P[a:a + chunk] * f
        i = np.floor(X).astype(np.int64)
        d1 = np.full(len(X), 9.0, np.float32)
        d2 = np.full(len(X), 9.0, np.float32)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    cx, cy, cz = i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz
                    fx = cx + _hash3(cx, cy, cz, seed)
                    fy = cy + _hash3(cx, cy, cz, seed + 1)
                    fz = cz + _hash3(cx, cy, cz, seed + 2)
                    d = np.sqrt((X[:, 0] - fx) ** 2 + (X[:, 1] - fy) ** 2 + (X[:, 2] - fz) ** 2).astype(np.float32)
                    closer = d < d1
                    d2 = np.where(closer, d1, np.minimum(d2, d))
                    d1 = np.where(closer, d, d1)
        F1[a:a + chunk] = d1
        F2[a:a + chunk] = d2
    return F1, F2


# ------------------------------------------------------------------------------------------------ per-vertex features
def vertex_features(geo, rig):
    P, N = geo["pos"], geo["nrm"]
    bones = [str(b) for b in geo["bones"]]
    W = geo["weights"]
    nv = len(P)
    side = np.where(P[:, 0] > 0, 1.0, -1.0)            # +1 = Left (+X)
    fid = np.full(nv, -1.0)
    tf = np.zeros(nv)
    lat_c = np.zeros(nv)
    dor_c = np.zeros(nv)
    for si, s in enumerate(("Left", "Right")):
        m_side = side > 0 if s == "Left" else side < 0
        fr = rig.frames[s]
        fw = np.stack([W[:, [bones.index("%sHand%s%d" % (s, f, k)) for k in (1, 2, 3)]].sum(1) for f in FING], 1)
        best = np.argmax(fw, 1)
        ok = m_side & (fw.max(1) > 0.35)
        for fi, f in enumerate(FING):
            sel = ok & (best == fi)
            if not sel.any():
                continue
            J = np.array([rig.H["%sHand%s%d" % (s, f, k)] for k in (1, 2, 3)] + [rig.tips[s + f]])
            q = P[sel]
            best_d = np.full(len(q), 1e9)
            best_t = np.zeros(len(q))
            best_foot = np.zeros_like(q)
            for k in range(3):
                a, b = J[k], J[k + 1]
                ab = b - a
                t = np.clip(((q - a) @ ab) / (ab @ ab), 0, 1)
                foot = a + t[:, None] * ab
                d = np.linalg.norm(q - foot, axis=1)
                better = d < best_d
                best_d = np.where(better, d, best_d)
                best_t = np.where(better, k + t, best_t)
                best_foot[better] = foot[better]
            # tip extension: beyond the tip joint, keep counting
            fid[sel] = fi
            tf[sel] = best_t
            ax = rig.axes[(s, f)]
            dirn = unit(J[2] - J[1])
            dors = unit(np.cross(dirn, ax))                  # nail side
            if np.dot(dors, fr["dorsal"]) < 0 and f != "Thumb":
                dors = -dors
            rel = q - best_foot
            dor_c[sel] = rel @ dors
            lat_c[sel] = rel @ unit(np.cross(dors, dirn))
    # forearm cylinder coords
    s_l = np.zeros(nv)
    th_l = np.zeros(nv)
    for s in ("Left", "Right"):
        m = side > 0 if s == "Left" else side < 0
        e, w = rig.H[s + "ForeArm"], rig.H[s + "Hand"]
        L = np.linalg.norm(w - e)
        ax = (w - e) / L
        dor = rig.frames[s]["dorsal"]
        e1 = unit(dor - ax * np.dot(dor, ax))
        e2 = np.cross(ax, e1)
        q = P[m] - e
        s_l[m] = (q @ ax) / L
        rr = q - np.outer(q @ ax, ax)
        th_l[m] = np.arctan2(rr @ e2, rr @ e1)
    # convexity (mean curvature proxy)
    idx = geo["idx"].reshape(-1, 3)
    acc = np.zeros(nv)
    cnt = np.zeros(nv)
    for a, b in ((0, 1), (1, 2), (2, 0), (1, 0), (2, 1), (0, 2)):
        d = P[idx[:, b]] - P[idx[:, a]]
        l2 = np.maximum((d * d).sum(1), 1e-10)
        c = -(d * N[idx[:, a]]).sum(1) / np.sqrt(l2)
        np.add.at(acc, idx[:, a], c)
        np.add.at(cnt, idx[:, a], 1)
    convex = acc / np.maximum(cnt, 1)
    # texel density (m per unit uv) per triangle -> per vertex
    uv = geo["uv"]
    a3 = 0.5 * np.linalg.norm(np.cross(P[idx[:, 1]] - P[idx[:, 0]], P[idx[:, 2]] - P[idx[:, 0]]), axis=1)
    e1u, e2u = uv[idx[:, 1]] - uv[idx[:, 0]], uv[idx[:, 2]] - uv[idx[:, 0]]
    a2 = 0.5 * np.abs(e1u[:, 0] * e2u[:, 1] - e1u[:, 1] * e2u[:, 0])
    mpu = np.sqrt(a3 / np.maximum(a2, 1e-14))
    dens = np.zeros(nv)
    dc = np.zeros(nv)
    for k in range(3):
        np.add.at(dens, idx[:, k], mpu * a3)
        np.add.at(dc, idx[:, k], a3)
    mpu_v = dens / np.maximum(dc, 1e-14)
    return np.column_stack([P, N, geo["strip"], fid, tf, lat_c, dor_c, side, s_l, th_l, convex, mpu_v, geo["region"]]).astype(np.float64)


COLS = ["px", "py", "pz", "nx", "ny", "nz", "sa", "sb", "fid", "tf", "lat", "dor", "side", "sl", "thl", "convex", "mpu", "reg"]


# ------------------------------------------------------------------------------------------------ the painter
class Canvas:
    def __init__(self, geo, rig, size):
        self.size = size
        idx = geo["idx"].reshape(-1, 3)
        attrs = vertex_features(geo, rig)
        # fid / region must not blend: rasterise them from a triangle soup (flat per triangle = first corner)
        img, mask = U.rasterize(geo["uv"], idx, attrs, size)
        flat = attrs[idx[:, 0]][:, [COLS.index("fid"), COLS.index("reg"), COLS.index("side")]]
        soup_uv = geo["uv"][idx.reshape(-1)]
        soup_idx = np.arange(len(soup_uv)).reshape(-1, 3)
        fimg, _ = U.rasterize(soup_uv, soup_idx, np.repeat(flat, 3, axis=0), size)
        self.mask = mask
        self.dist = ndimage.distance_transform_edt(~mask)
        img = U.dilate(img, mask, 24)
        fimg = U.dilate(fimg, mask, 24)
        self.active = self.dist <= 24
        sel = np.flatnonzero(self.active.reshape(-1))
        self.sel = sel
        A = img.reshape(-1, img.shape[-1])[sel]
        F = fimg.reshape(-1, 3)[sel]
        self.A = {c: A[:, i] for i, c in enumerate(COLS)}
        self.A["fid"] = np.rint(F[:, 0])
        self.A["reg"] = np.rint(F[:, 1])
        self.A["side"] = np.sign(F[:, 2])
        self.P = A[:, 0:3]
        self.N = unit(A[:, 3:6])
        n = len(sel)
        self.alb = np.zeros((n, 3), np.float32)
        self.rough = np.full(n, 0.7, np.float32)
        self.metal = np.zeros(n, np.float32)
        self.h = np.zeros(n, np.float32)            # height (m)
        self.cav = np.ones(n, np.float32)           # extra occlusion multiplier
        ao = np.asarray(Image.open(str(geo["ao"])).convert("L").resize((size, size), Image.BILINEAR), np.float32) / 255.0
        ao = U.dilate(ao[..., None], mask, 24)[..., 0]
        self.ao = ao.reshape(-1)[sel]

    def region(self, name):
        return self.A["reg"] == REG[name]

    def image(self, vals, fill=0.0):
        out = np.full((self.size * self.size,) + np.shape(vals)[1:], fill, np.float32)
        out[self.sel] = vals
        return out.reshape((self.size, self.size) + np.shape(vals)[1:])


# ------------------------------------------------------------------------------------------------ materials
def paint_skin(C, rig, m):
    A, P, N = C.A, C.P[m], C.N[m]
    fid, tf, lat, dor = A["fid"][m], A["tf"][m], A["lat"][m], A["dor"][m]
    side = A["side"][m]
    base = srgb((0.36, 0.235, 0.165))
    pale = srgb((0.56, 0.40, 0.32))
    # palmar side of the fingers (lighter)
    dors = np.zeros(len(P))
    for s, sg in (("Left", 1), ("Right", -1)):
        k = side == sg
        dors[k] = N[k] @ rig.frames[s]["dorsal"]
    finger = fid >= 0
    thumb = fid == 0
    pal = np.where(finger, sstep(0.25, -0.35, dor / np.maximum(np.abs(dor) + np.abs(lat), 1e-4) * 1.0), 0.0)
    mott = fbm(P, 90, 3, 11)
    red = fbm(P, 40, 2, 19)
    col = base[None] * (0.9 + 0.2 * mott[:, None]) * (1 + 0.08 * (red[:, None] - 0.5) * np.array([[1.0, -0.4, -0.8]]))
    col = col * (1 - pal[:, None]) + pale[None] * pal[:, None] * (0.92 + 0.14 * mott[:, None])
    # knuckle creases + darker knuckle skin over PIP (tf~1) and DIP (tf~2), back of the finger
    back = sstep(-0.1, 0.5, dor / np.maximum(np.abs(dor) + np.abs(lat), 1e-4)) * finger
    creases = np.zeros(len(P))
    hcr = np.zeros(len(P))
    for jt, width in ((1.0, 0.33), (2.0, 0.22)):
        d = (tf - jt)
        zone = np.exp(-(d / width) ** 2)
        # 3-4 wavy crease lines across the joint
        wav = np.sin((d * 38 + 0.8 * fbm(P, 300, 2, 3)) * np.pi)
        line = sstep(0.55, 0.95, np.abs(wav)) * zone
        creases = np.maximum(creases, line)
        hcr -= line * 0.00006
        col = col * (1 - 0.22 * zone * back)[:, None]
    col = col * (1 - 0.35 * creases * back)[:, None]
    # nails
    nail = np.zeros(len(P))
    nh = np.zeros(len(P))
    for fi, half_w, ln in ((0, 0.0062, 0.0125), (1, 0.0052, 0.0115), (2, 0.0054, 0.012), (3, 0.0050, 0.0112), (4, 0.0043, 0.0098)):
        k = fid == fi
        if not k.any():
            continue
        # distance from the tip along the distal segment (metres)
        f = FING[fi]
        for s, sg in (("Left", 1), ("Right", -1)):
            kk = k & (side == sg)
            if not kk.any():
                continue
            j3, tip = rig.H["%sHand%s3" % (s, f)], rig.tips[s + f]
            seg = np.linalg.norm(tip - j3)
            from_tip = (3.0 - tf[kk]) * seg
            u = from_tip / ln                       # 0 at the tip .. 1 at the cuticle
            v = lat[kk] / half_w
            on_back = sstep(0.0, 0.0025, dor[kk])
            shape = sstep(1.06, 0.96, u) * sstep(-0.02, 0.06, u) * sstep(1.0, 0.86, np.abs(v) + 0.25 * np.maximum(u - 0.7, 0) ** 2 * 8)
            nail[kk] = np.maximum(nail[kk], shape * on_back)
            nh[kk] = shape * on_back * 0.00018
    nail_col = srgb((0.66, 0.52, 0.46))
    tipc = srgb((0.80, 0.72, 0.62))
    lun = sstep(0.0, 1.0, nail)
    col = col * (1 - lun[:, None]) + nail_col[None] * lun[:, None]
    # grime: fingertips, under the nail free edge, creases (baked AO), a little on the palm
    tip_d = sstep(2.55, 3.0, tf) * finger
    grime = srgb((0.12, 0.09, 0.07))
    g = np.clip(0.35 * tip_d * fbm(P, 220, 3, 5) + 0.45 * (1 - C.ao[m]) * finger + 0.12 * (1 - C.ao[m]) + 0.25 * creases, 0, 0.8)
    col = col * (1 - g[:, None]) + grime[None] * g[:, None]
    # pores + fine wrinkles
    F1, F2 = worley(P, 1400, 7)
    pores = sstep(0.18, 0.0, F1)
    h = -pores * 0.000012 + (fbm(P, 900, 3, 9) - 0.5) * 0.00003 + hcr + nh
    col = col * (1 - 0.06 * pores[:, None])
    rough = 0.58 - 0.18 * nail + 0.1 * pores - 0.08 * tip_d
    return col, rough, np.zeros(len(P)), h


def tattoo(C, rig, m):
    """Ink on the upper arms / elbow skin: tribal band (right) and the end of the flame sleeve (left)."""
    A, P = C.A, C.P[m]
    side = A["side"][m]
    ink = np.zeros(len(P))
    for s, sg in (("Left", 1), ("Right", -1)):
        k = side == sg
        a0, a1 = rig.H[s + "Arm"], rig.H[s + "ForeArm"]
        L = np.linalg.norm(a1 - a0)
        ax = (a1 - a0) / L
        q = P[k] - a0
        t = (q @ ax) / L
        rr = q - np.outer(q @ ax, ax)
        ref = np.array([0.0, 0.0, 1.0])
        e1 = unit(ref - ax * ref @ ax)
        e2 = np.cross(ax, e1)
        th = np.arctan2(rr @ e2, rr @ e1)
        if s == "Right":
            # tribal band around the biceps: pointed blades
            band = np.abs(t - 0.45) < 0.10
            wave = np.sin(th * 3 + t * 20) * 0.05 + np.sin(th * 7) * 0.02
            blade = sstep(0.028, 0.018, np.abs(t - 0.45 - wave)) + sstep(0.012, 0.005, np.abs(t - 0.33 - 0.5 * wave))
            ink[k] = np.clip(blade, 0, 1) * band
        else:
            # flames licking up from the forearm (only the tips show above the wraps)
            fl = 0.92 + 0.05 * np.sin(th * 5 + 1.3) + 0.03 * np.sin(th * 11)
            tongues = sstep(0.0, 0.02, fl - t) * sstep(-0.25, -0.1, t - fl)
            ink[k] = tongues * (0.6 + 0.4 * np.abs(np.sin(th * 5 + 1.3)))
    return ink


def glove_panels(C, rig, m):
    """Signed seam distance (m, + = back panel) for the two-panel glove, plus an 'along seam' coordinate for stitches."""
    A, P, N = C.A, C.P[m], C.N[m]
    fid, tf, lat, dor, side, sl, thl = (A[k][m] for k in ("fid", "tf", "lat", "dor", "side", "sl", "thl"))
    sd = np.zeros(len(P))
    along = np.zeros(len(P))
    for s, sg in (("Left", 1), ("Right", -1)):
        k = side == sg
        fr = rig.frames[s]
        w = rig.H[s + "Hand"]
        mid = rig.H[s + "HandMiddle1"]
        # hand body: height above the mid plane through wrist / knuckles
        h = (P[k] - (w + mid) * 0.5) @ fr["dorsal"]
        sd[k] = h
        rel = P[k] - w
        along[k] = np.arctan2(rel @ fr["lat"], rel @ fr["d0"]) * 0.05
    fing = fid >= 0
    sd = np.where(fing, dor, sd)
    along = np.where(fing, tf * 0.03, along)
    cuff = (sl < 1.0) & (fid < 0)
    r_cuff = 0.03
    sd = np.where(cuff, np.cos(thl) * r_cuff, sd)
    along = np.where(cuff, sl * 0.28, along)
    return sd, along


def paint_glove(C, rig, m, hem):
    A, P, N = C.A, C.P[m], C.N[m]
    fid, tf, lat, dor, side, sl, thl, cvx = (A[k][m] for k in ("fid", "tf", "lat", "dor", "side", "sl", "thl", "convex"))
    n = len(P)
    sd, along = glove_panels(C, rig, m)
    back = sstep(-0.0008, 0.0008, sd)
    leather = srgb((0.13, 0.088, 0.062))
    worn = srgb((0.24, 0.16, 0.105))
    suede = srgb((0.16, 0.135, 0.11))
    knit = srgb((0.06, 0.058, 0.055))
    cuff = (sl < 1.0 - 0.004 / 0.28) & (fid < 0)
    # leather pebble grain
    F1, F2 = worley(P, 1150, 21)
    cell = sstep(0.0, 0.35, F2 - F1)
    grain_h = cell * 0.000025
    macro = fbm(P, 60, 3, 4)
    col = leather[None] * (0.8 + 0.4 * macro[:, None]) * (0.92 + 0.12 * cell[:, None])
    rough = 0.70 + 0.12 * (1 - cell) + 0.08 * macro
    # palm panel: suede with a stippled grip patch on the heel of the palm / finger undersides
    pal = 1 - back
    sfuzz = fbm(P, 2400, 2, 8)
    col = col * (1 - pal[:, None]) + suede[None] * pal[:, None] * (0.85 + 0.3 * sfuzz[:, None]) * (0.9 + 0.2 * macro[:, None])
    rough = rough * (1 - pal) + (0.86 + 0.08 * sfuzz) * pal
    grip_d = worley(P, 520, 33)[0]
    dots = sstep(0.32, 0.22, grip_d) * pal * (fid < 0) * (~cuff)
    col = col * (1 - 0.45 * dots[:, None])
    h = grain_h * back + (sfuzz - 0.5) * 0.00002 * pal + dots * 0.00022
    # knuckle guard: moulded lobes (same field as the geometry), stitched outline + quilting
    pad = np.zeros(n)
    for s, sg in (("Left", 1), ("Right", -1)):
        k = side == sg
        pad[k] = knuckle_pad(rig, s, P[k], N[k])
    edge = np.exp(-((pad - 0.45) / 0.07) ** 2)
    padm = sstep(0.4, 0.55, pad)
    col = col * (1 - 0.35 * edge[:, None]) * (1 - 0.15 * padm[:, None])
    h += -edge * 0.00018 + padm * 0.00008
    rough = rough - 0.1 * padm
    # pattern seams (back/palm) with twin stitch rows, finger openings / cuff edge stitched too
    seam = np.exp(-(sd / 0.0007) ** 2)
    h += -seam * 0.00022
    col = col * (1 - 0.4 * seam[:, None])
    thread = srgb((0.33, 0.27, 0.19))
    st = np.zeros(n)
    for off in (-0.0017, 0.0017):
        row = np.exp(-((sd - off) / 0.00042) ** 2)
        dash = sstep(0.35, 0.6, 0.5 + 0.5 * np.sin(along / 0.0026 * 2 * np.pi))
        st = np.maximum(st, row * dash)
    # stitch rows around the knuckle guard outline
    pr = np.exp(-((pad - 0.33) / 0.035) ** 2)
    st = np.maximum(st, pr * sstep(0.3, 0.6, 0.5 + 0.5 * np.sin((P @ np.array([1.0, 0.6, 0.4])) / 0.0025 * 2 * np.pi)))
    # perforations on the back of the proximal finger segments
    perf = np.zeros(n)
    for c_t in (0.30, 0.55):
        for c_l in (-0.0028, 0.0028):
            d = np.sqrt(((tf - c_t) * 0.045) ** 2 + (lat - c_l) ** 2)
            perf = np.maximum(perf, sstep(0.0011, 0.0006, d) * (fid >= 1) * sstep(0.001, 0.004, dor))
    col = col * (1 - 0.8 * perf[:, None])
    h -= perf * 0.0004
    # ribbed knit cuff past the wrist
    rib = 0.5 + 0.5 * np.sin(thl * 72)
    cf = cuff.astype(float) * (1 - np.maximum(np.asarray(hem, float), 0))
    col = col * (1 - cf[:, None]) + (knit[None] * (0.8 + 0.4 * rib[:, None]) * (0.9 + 0.2 * macro[:, None])) * cf[:, None]
    h = h * (1 - cf) + (rib * 0.00022) * cf
    rough = rough * (1 - cf) + 0.9 * cf
    # hem: rolled edge a touch lighter + stitch line 2.2 mm in from the opening
    hd = C.hem_dist[m]
    hemrow = np.exp(-((hd - 0.0024) / 0.00045) ** 2) * sstep(0.3, 0.6, 0.5 + 0.5 * np.sin((P @ np.array([0.7, 0.5, -0.5])) / 0.0024 * 2 * np.pi))
    st = np.maximum(st, hemrow * (1 - cf))
    roll = np.exp(-(hd / 0.0012) ** 2)
    col = col * (1 + 0.25 * roll[:, None] * (1 - pal[:, None] * 0.5))
    # thread
    col = col * (1 - st[:, None]) + thread[None] * st[:, None] * (0.8 + 0.3 * macro[:, None])
    h += st * 0.00016
    rough = rough * (1 - st) + 0.8 * st
    # wear: scuffed convex edges and knuckles go brown, grime in the creases, dust on the palm
    wear = np.clip(sstep(0.45, 1.1, cvx * 4 + 0.35 * padm + 0.5 * roll) * sstep(0.45, 0.8, fbm(P, 160, 4, 2)), 0, 1) * (1 - cf)
    wear = np.maximum(wear, 0.5 * roll * (1 - cf))
    col = col * (1 - wear[:, None] * 0.7) + worn[None] * wear[:, None] * 0.7
    rough = rough + 0.12 * wear
    dust = srgb((0.40, 0.34, 0.26))
    dm = np.clip(0.18 * pal * sstep(0.5, 0.85, fbm(P, 45, 3, 6)) + 0.12 * sstep(0.5, 0.2, C.ao[m]), 0, 0.35)
    col = col * (1 - dm[:, None]) + dust[None] * dm[:, None]
    return col, np.clip(rough, 0.3, 0.95), np.zeros(n), h


def knuckle_pad(rig, s, P, N):
    fr = rig.frames[s]
    d0, lat, dorsal = fr["d0"], fr["lat"], fr["dorsal"]
    up = sstep(0.30, 0.65, N @ dorsal)
    lobes = np.zeros(len(P))
    for f in ("Index", "Middle", "Ring", "Pinky"):
        k = rig.H["%sHand%s1" % (s, f)]
        d = P - k
        a = d @ d0
        c = d @ lat
        r = np.sqrt(((a + 0.001) / 0.0105) ** 2 + (c / 0.0095) ** 2)
        lobes = np.maximum(lobes, sstep(1.0, 0.72, r))
    mcp = np.array([rig.H["%sHand%s1" % (s, f)] for f in ("Index", "Middle", "Ring", "Pinky")])
    a, b = mcp[0], mcp[-1]
    ab = b - a
    t = ((P - a) @ ab) / (ab @ ab)
    along = (P - (a + np.outer(np.clip(t, 0, 1), ab))) @ d0
    bar = sstep(0.0125, 0.0085, np.abs(along + 0.009)) * sstep(-0.12, 0.02, t) * sstep(1.12, 0.98, t)
    return np.clip(np.maximum(lobes, 0.55 * bar), 0, 1) * up


def paint_wrap(C, m):
    A, P = C.A, C.P[m]
    a, b = A["sa"][m], A["sb"][m]
    n = len(P)
    W_ = 0.034
    tan = srgb((0.60, 0.53, 0.40))
    turn = np.floor(a / 0.19)
    tv = (np.sin(turn * 12.9898) * 43758.5453) % 1.0
    col = tan[None] * (0.93 + 0.1 * tv[:, None])
    # plain weave, ~1 mm pitch, with slubby threads
    pw = 0.0011
    wa = np.sin(a / pw * 2 * np.pi)
    wb = np.sin(b / pw * 2 * np.pi)
    slub_a = fbm(np.column_stack([a * 40, np.floor(b / pw) * 0.37, a * 0]), 1.0, 2, 3)
    slub_b = fbm(np.column_stack([np.floor(a / pw) * 0.37, b * 40, b * 0]), 1.0, 2, 4)
    over = np.where(wa * wb > 0, np.abs(wa) * (0.8 + 0.4 * slub_a), np.abs(wb) * (0.8 + 0.4 * slub_b))
    h = over * 0.00012
    col = col * (0.86 + 0.18 * over[:, None])
    # frayed edges: darker, fuzzy lines along the strip edges
    ed = np.minimum(b, W_ - b)
    fray = np.exp(-(ed / 0.0012) ** 2) * (0.6 + 0.6 * fbm(np.column_stack([a * 300, b * 30, a * 0]), 1.0, 3, 9))
    col = col * (1 - 0.35 * np.clip(fray, 0, 1)[:, None])
    h -= np.exp(-(ed / 0.0008) ** 2) * 0.00012
    # stains: sweat rings, oil, a rusty blood-brown patch
    sweat = sstep(0.55, 0.75, fbm(P, 38, 4, 12))
    oil = sstep(0.68, 0.8, fbm(P, 70, 3, 13))
    rust = sstep(0.72, 0.82, fbm(P, 30, 3, 14))
    col = col * (1 - 0.18 * sweat[:, None]) * (1 - 0.45 * oil[:, None])
    col = col * (1 - 0.35 * rust[:, None]) + srgb((0.25, 0.12, 0.08))[None] * 0.35 * rust[:, None]
    # grime toward the hand, dust on top, dark in the overlaps (AO)
    sl = A["sl"][m]
    lip = b < 0.0004
    ao_w = np.where(lip, np.maximum(C.ao[m], 0.7), C.ao[m])
    C.ao[m] = ao_w
    gr = sstep(0.7, 1.0, sl) * 0.18 + 0.15 * sstep(0.85, 0.35, ao_w)
    col = col * (1 - gr[:, None]) + srgb((0.22, 0.2, 0.17))[None] * gr[:, None]
    col = np.where(lip[:, None], col * 0.82, col)
    dust = sstep(0.4, 0.7, fbm(P, 25, 3, 15)) * 0.25
    col = col * (1 - dust[:, None]) + srgb((0.62, 0.55, 0.43))[None] * dust[:, None]
    rough = 0.92 - 0.25 * oil
    return col, rough, np.zeros(n), h


def paint_strap(C, rig, m):
    A, P = C.A, C.P[m]
    a, b = A["sa"][m], A["sb"][m]
    n = len(P)
    watch_side = (A["side"][m] > 0) & (A["sl"][m] < 1.0 - CUFF_LEN / 0.281)
    # glove strap: leather with edge stitching
    leather = srgb((0.075, 0.058, 0.046))
    F1, F2 = worley(P, 1150, 41)
    cell = sstep(0.0, 0.35, F2 - F1)
    macro = fbm(P, 90, 3, 2)
    col = leather[None] * (0.85 + 0.3 * macro[:, None]) * (0.92 + 0.12 * cell[:, None])
    wdt = np.where(b > 0.0175, 0.0185, 0.016)
    ed = np.minimum(b, wdt - b)
    st = np.exp(-((ed - 0.0018) / 0.0004) ** 2) * sstep(0.3, 0.6, 0.5 + 0.5 * np.sin(a / 0.0026 * 2 * np.pi))
    col = col * (1 - st[:, None]) + srgb((0.33, 0.27, 0.19))[None] * st[:, None]
    h = cell * 0.00002 + st * 0.00014 - np.exp(-(ed / 0.0006) ** 2) * 0.0001
    rough = 0.55 + 0.1 * (1 - cell)
    wear = sstep(0.7, 0.95, fbm(P, 200, 3, 3)) * np.exp(-(ed / 0.002) ** 2)
    col = col * (1 - wear[:, None]) + srgb((0.28, 0.19, 0.12))[None] * wear[:, None]
    # watch strap: black nylon webbing (twill ribs across)
    web = 0.5 + 0.5 * np.sin((a * 0.9 + b * 0.45) / 0.0009 * 2 * np.pi)
    wcol = srgb((0.045, 0.045, 0.043))[None] * (0.8 + 0.4 * web[:, None]) * (0.9 + 0.2 * macro[:, None])
    wcol = wcol * (1 - 0.25 * np.exp(-(np.minimum(b, 0.021 - b) / 0.0012) ** 2))[:, None]
    ws = watch_side.astype(float)
    col = col * (1 - ws[:, None]) + wcol * ws[:, None]
    h = h * (1 - ws) + web * 0.00008 * ws
    rough = rough * (1 - ws) + 0.8 * ws
    return col, rough, np.zeros(n), h


def paint_hard(C, rig, m, kind, watch):
    """watch case / lugs / plastic buckle (kind 'watch'), metal snaps + buckle ('metal'), the watch face ('glass')."""
    A, P, N = C.A, C.P[m], C.N[m]
    n = len(P)
    cvx = A["convex"][m]
    edge = sstep(0.25, 0.8, cvx * 4)
    if kind == "watch":
        col = srgb((0.05, 0.05, 0.048))[None] * (0.9 + 0.2 * fbm(P, 300, 2, 3)[:, None])
        scr = sstep(0.72, 0.9, fbm(P * np.array([1, 1, 6]), 700, 3, 5))
        col = col * (1 - 0.0) + srgb((0.22, 0.22, 0.21))[None] * (0.6 * edge + 0.3 * scr)[:, None]
        rough = 0.42 + 0.2 * scr
        h = -scr * 0.00002
        # bezel markers (12 + triangle) around the watch face
        c, nrm, ax_a, ax_c = watch
        rel = P - c
        hh = rel @ nrm
        r = np.linalg.norm(rel - np.outer(hh, nrm), axis=1)
        ang = np.arctan2(rel @ ax_c, rel @ ax_a)
        on_bezel = (hh > 0.0098) & (r > 0.0155) & (r < 0.0195)
        mk = sstep(0.06, 0.03, np.abs(((ang / (2 * np.pi) * 12) + 0.5) % 1.0 - 0.5)) * on_bezel
        col = col * (1 - mk[:, None]) + srgb((0.75, 0.73, 0.68))[None] * mk[:, None]
        h -= mk * 0.00008
        return col, rough, np.zeros(n), h
    if kind == "metal":
        c, nrm, ax_a, ax_c = watch
        steel = np.linalg.norm(P - c, axis=1) < 0.05
        brass = srgb((0.55, 0.44, 0.26))
        stl = srgb((0.50, 0.50, 0.50))
        col = np.where(steel[:, None], stl[None], brass[None]) * (0.75 + 0.3 * fbm(P, 400, 2, 7)[:, None])
        dirt = sstep(0.4, 0.1, C.ao[m]) * 0.7
        col = col * (1 - dirt[:, None]) + srgb((0.1, 0.08, 0.06))[None] * dirt[:, None]
        rough = 0.32 + 0.25 * dirt + 0.1 * (1 - edge)
        return col, rough, np.ones(n) * (1 - dirt * 0.5), np.zeros(n)
    # glass: LCD dial seen through the crystal (x = reading direction, y = up = toward the hand)
    c, nrm, ax_a, ax_c = watch
    rel = P - c
    xdir = np.cross(ax_a, nrm)
    x, y = rel @ xdir, rel @ ax_a
    r = np.sqrt(x * x + y * y)
    lcd = srgb((0.33, 0.36, 0.30))
    col = np.tile(lcd[None], (n, 1)).astype(np.float32)
    ring = sstep(0.0143, 0.0139, r)
    col = col * ring[:, None] + srgb((0.025, 0.025, 0.025))[None] * (1 - ring[:, None])
    ink = seven_seg(x, y, "10", -0.0092, 0.0005, 0.0012, 0.0078)
    ink = np.maximum(ink, seven_seg(x, y, "24", 0.0010, 0.0005, 0.0012, 0.0078))
    ink = np.maximum(ink, seven_seg(x, y, "38", 0.0036, -0.0084, 0.0009, 0.0036) * 0.85)
    for cy in (0.0027, -0.0003):
        ink = np.maximum(ink, sstep(0.00062, 0.00042, np.sqrt((x + 0.0000) ** 2 + (y - cy) ** 2)))
    # top status row: short bars
    for k in range(5):
        ink = np.maximum(ink, ((np.abs(x - (-0.006 + k * 0.003)) < 0.0011) & (np.abs(y - 0.0094) < 0.0005)).astype(float) * 0.7)
    ink = ink * ring
    col = col * (1 - 0.88 * ink[:, None])
    shade = sstep(0.0143, 0.010, r)            # vignette under the bezel
    col = col * (0.75 + 0.25 * shade[:, None])
    return col, np.full(n, 0.06), np.zeros(n), np.zeros(n)


SEGS = {"0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abfgcd"}


def seven_seg(x, y, text, x0, y0, gap, h):
    """Seven-segment digits (x right, y up): left edge x0, baseline centre y0, digit height h, inter-digit gap."""
    out = np.zeros_like(x)
    w = h * 0.52
    t = h * 0.12
    for i, ch in enumerate(text):
        cx = x0 + i * (w + gap) + w / 2
        X = x - cx
        Y = y - (y0 + h / 2)
        hw, hh = w / 2, h / 2
        segs = {"a": ("h", hh), "g": ("h", 0.0), "d": ("h", -hh), "b": ("v", hw, 1), "c": ("v", hw, -1), "f": ("v", -hw, 1), "e": ("v", -hw, -1)}
        for sname in SEGS.get(ch, ""):
            sp = segs[sname]
            if sp[0] == "h":
                m_ = (np.abs(Y - sp[1]) < t / 2) & (np.abs(X) < hw - t * 0.6)
            else:
                m_ = (np.abs(X - sp[1]) < t / 2) & (np.abs(Y - sp[2] * hh / 2) < hh / 2 - t * 0.6)
            out = np.maximum(out, m_.astype(float))
    return out


def paint_cord(C, m):
    A, P = C.A, C.P[m]
    a, b = A["sa"][m], A["sb"][m]
    n = len(P)
    # cobra weave: knots every 5.5 mm, strands running diagonally across the top, alternating colour per knot
    pitch = 0.0055
    k = np.floor(a / pitch)
    f = a / pitch - k
    v = (b / 0.03)                      # around the cord (0..1), 0.25 ~ top centre
    across = np.cos(v * 2 * np.pi)      # -1..1 across the band
    sgn = np.where(k % 2 == 0, 1.0, -1.0)
    centre = (2 * f - 1) * sgn
    strand = np.exp(-((across - centre) / 0.45) ** 2)
    spine = np.exp(-((np.abs(across) - 1.0) / 0.25) ** 2)
    hgt = np.clip(strand + 0.6 * spine, 0, 1.2)
    od = srgb((0.24, 0.26, 0.15))
    blk = srgb((0.05, 0.05, 0.05))
    c2 = np.where((k % 2 == 0)[:, None], od[None], blk[None])
    col = c2 * (0.65 + 0.45 * hgt[:, None])
    fib = 0.5 + 0.5 * np.sin((a + b) / 0.0006 * 2 * np.pi)
    col = col * (0.9 + 0.12 * fib[:, None])
    dirt = sstep(0.8, 0.4, C.ao[m]) * 0.4
    col = col * (1 - dirt[:, None]) + srgb((0.2, 0.16, 0.11))[None] * dirt[:, None]
    return col, np.full(n, 0.88), np.zeros(n), hgt * 0.0005 + fib * 0.00003


# ------------------------------------------------------------------------------------------------ main
def paint(geo, rig, size):
    import time
    t0 = time.time()
    C = Canvas(geo, rig, size)
    print("  raster %.1fs  texels %d" % (time.time() - t0, len(C.sel)))
    reg = C.A["reg"]
    # distance to the glove openings (hem vertices)
    from scipy.spatial import cKDTree
    hem_v = geo["pos"][geo["region"] == REG["hem"]]
    tree = cKDTree(hem_v) if len(hem_v) else None
    C.hem_dist = tree.query(C.P)[0] if tree is not None else np.full(len(C.P), 1.0)
    # watch frame (glass disc)
    gl = geo["region"] == REG["glass"]
    wc = geo["pos"][gl].mean(0)
    wn = unit(geo["nrm"][gl].mean(0))
    fa = rig.H["LeftHand"] - rig.H["LeftForeArm"]
    wa = unit(fa - wn * (fa @ wn))
    wcx = np.cross(wn, wa)
    base_c = wc - wn * 0.0112
    watch = (base_c, wn, wa, wcx)
    alb = np.zeros((len(C.sel), 3), np.float32)
    rough = np.full(len(C.sel), 0.7, np.float32)
    metal = np.zeros(len(C.sel), np.float32)
    h = np.zeros(len(C.sel), np.float32)
    jobs = [("skin", lambda m: paint_skin(C, rig, m)), ("glove", lambda m: paint_glove(C, rig, m, np.zeros(m.sum()))),
            ("hem", lambda m: paint_glove(C, rig, m, np.ones(m.sum()))), ("wrap", lambda m: paint_wrap(C, m)),
            ("strap", lambda m: paint_strap(C, rig, m)), ("watch", lambda m: paint_hard(C, rig, m, "watch", watch)),
            ("metal", lambda m: paint_hard(C, rig, m, "metal", watch)), ("glass", lambda m: paint_hard(C, rig, m, "glass", watch)),
            ("cord", lambda m: paint_cord(C, m))]
    for name, fn in jobs:
        m = reg == REG[name]
        if not m.any():
            continue
        c, r, mt, hh = fn(m)
        alb[m], rough[m], metal[m], h[m] = c, r, mt, hh
        print("  %s %d texels %.1fs" % (name, m.sum(), time.time() - t0))
    # tattoos on the bare arm skin
    sk = reg == REG["skin"]
    ink = tattoo(C, rig, sk) * (C.A["fid"][sk] < 0)
    inkc = srgb((0.035, 0.045, 0.06))
    alb[sk] = alb[sk] * (1 - 0.82 * ink[:, None]) + inkc[None] * 0.82 * ink[:, None]
    # AO into albedo (crevices), then images
    ao = C.ao
    alb = alb * (0.55 + 0.45 * ao[:, None])
    A_img = C.image(alb)
    H_img = C.image(h)
    R_img = C.image(rough, 0.7)
    M_img = C.image(metal)
    AO_img = C.image(ao, 1.0)
    mpu = C.image(C.A["mpu"], 1.0)            # metres per uv unit
    # dilate island borders so mips / bilinear never pick up the background
    mask = C.mask
    A_img = U.dilate(A_img, mask, 24)
    H_img = U.dilate(H_img[..., None], mask, 24)[..., 0]
    R_img = U.dilate(R_img[..., None], mask, 24)[..., 0]
    M_img = U.dilate(M_img[..., None], mask, 24)[..., 0]
    AO_img = U.dilate(AO_img[..., None], mask, 24)[..., 0]
    # height -> normal: slope = dh / (metres per texel)
    m_per_px = np.maximum(mpu / size, 1e-7)
    gy, gx = np.gradient(H_img)
    nx = -gx / m_per_px
    ny = gy / m_per_px
    nrm = np.stack([nx, ny, np.ones_like(nx)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    nrm_u8 = ((nrm * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)
    alb_u8 = (to_srgb(A_img) * 255 + 0.5).astype(np.uint8)
    orm = np.stack([AO_img, np.clip(R_img, 0.04, 1), np.clip(M_img, 0, 1)], -1)
    orm_u8 = (orm * 255 + 0.5).astype(np.uint8)
    print("  paint total %.1fs" % (time.time() - t0))
    for nm, arr in (("albedo", alb_u8), ("orm", orm_u8), ("normal", nrm_u8)):
        Image.fromarray(arr).save(r"C:/Dev/rideordie/tools/characters/_cache/fp_arms/tex_%s.png" % nm)
    return dict(albedo=alb_u8, orm=orm_u8, normal=nrm_u8)

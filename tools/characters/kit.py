"""Hard-surface / gear kit (numpy).  Everything is in FINAL space: +Z forward, +X = character LEFT, +Y up, metres.

Mesh = dict(pos (N,3), nrm (N,3), uv (N,2), idx (T,3), col (N,3) optional).  UVs are in metres / tile so that tiled
textures keep a real-world scale (materials that tile: leather, metal_dark, armor, cloth_*).
"""
import numpy as np
from scipy.spatial import cKDTree

import mh


# --- basic mesh ops -------------------------------------------------------------------------------

def mk(pos, nrm, uv, idx, col=None):
    d = dict(pos=np.asarray(pos, float), nrm=np.asarray(nrm, float), uv=np.asarray(uv, float),
             idx=np.asarray(idx, np.int64).reshape(-1, 3))
    if col is not None:
        d["col"] = np.asarray(col, float)
    return d


def merge(meshes):
    meshes = [m for m in meshes if m is not None and len(m["pos"])]
    if not meshes:
        return None
    pos, nrm, uv, idx, col = [], [], [], [], []
    base = 0
    has_col = any("col" in m for m in meshes)
    for m in meshes:
        pos.append(m["pos"])
        nrm.append(m["nrm"])
        uv.append(m["uv"])
        idx.append(m["idx"] + base)
        if has_col:
            col.append(m["col"] if "col" in m else np.ones((len(m["pos"]), 3)))
        base += len(m["pos"])
    return mk(np.concatenate(pos), np.concatenate(nrm), np.concatenate(uv), np.concatenate(idx),
              np.concatenate(col) if has_col else None)


def rot_axis(axis, ang):
    a = np.asarray(axis, float)
    a = a / np.linalg.norm(a)
    c, s = np.cos(ang), np.sin(ang)
    x, y, z = a
    return np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
                     [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
                     [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])


def rot_euler(rx=0.0, ry=0.0, rz=0.0):
    """Degrees, applied X then Y then Z (extrinsic)."""
    return rot_axis([0, 0, 1], np.radians(rz)) @ rot_axis([0, 1, 0], np.radians(ry)) @ rot_axis([1, 0, 0], np.radians(rx))


def look_rot(fwd, up=(0, 1, 0)):
    """Rotation whose local +Z = fwd and local +Y ~ up."""
    z = np.asarray(fwd, float)
    z = z / np.linalg.norm(z)
    x = np.cross(up, z)
    if np.linalg.norm(x) < 1e-6:
        x = np.cross([1, 0, 0], z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


def xform(m, R=None, t=None, s=None):
    """Return a transformed copy: p' = R (s*p) + t."""
    out = dict(m)
    p = m["pos"].copy()
    n = m["nrm"].copy()
    if s is not None:
        p = p * np.asarray(s, float)
        if np.ndim(s) > 0 and len(np.atleast_1d(s)) == 3:
            n = n / np.asarray(s, float)
            n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    if R is not None:
        p = p @ np.asarray(R).T
        n = n @ np.asarray(R).T
    if t is not None:
        p = p + np.asarray(t, float)
    out["pos"], out["nrm"] = p, n
    return out


def mirror_x(m):
    """Mirror across the x=0 plane (winding flipped to keep faces outward)."""
    out = dict(m)
    out["pos"] = m["pos"] * np.array([-1.0, 1.0, 1.0])
    out["nrm"] = m["nrm"] * np.array([-1.0, 1.0, 1.0])
    out["idx"] = m["idx"][:, [0, 2, 1]]
    return out


def tint(m, c):
    out = dict(m)
    out["col"] = np.tile(np.asarray(c, float), (len(m["pos"]), 1))
    return out


def face_normals(pos, idx):
    a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    return np.cross(b - a, c - a)


def smooth_normals(m, angle=35.0):
    """Split vertices where adjacent faces differ by more than `angle` degrees; smooth (area weighted) elsewhere."""
    pos, idx = m["pos"], m["idx"]
    T = len(idx)
    key = np.round(pos / 1e-5).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    fn = face_normals(pos, idx)
    area = np.linalg.norm(fn, axis=1)
    fnu = fn / np.maximum(area[:, None], 1e-12)
    cosang = np.cos(np.radians(angle))
    flat = idx.reshape(-1)
    corner_v = inv[flat]
    order = np.argsort(corner_v, kind="stable")
    cv = corner_v[order]
    starts = np.flatnonzero(np.r_[True, cv[1:] != cv[:-1]])
    ends = np.r_[starts[1:], len(cv)]
    out_of_corner = np.zeros(3 * T, np.int64)
    out_src, out_nrm = [], []
    for s, e in zip(starts, ends):
        corners = order[s:e]
        faces = corners // 3
        clusters = []          # [sum normal, [corner ids]]
        for c, f in zip(corners, faces):
            for cl in clusters:
                nn = cl[0] / max(np.linalg.norm(cl[0]), 1e-12)
                if nn @ fnu[f] >= cosang:
                    cl[0] = cl[0] + fn[f]
                    cl[1].append(c)
                    break
            else:
                clusters.append([fn[f].copy(), [c]])
        for cl in clusters:
            nid = len(out_src)
            out_src.append(flat[cl[1][0]])
            out_nrm.append(cl[0] / max(np.linalg.norm(cl[0]), 1e-12))
            for c in cl[1]:
                out_of_corner[c] = nid
    out_src = np.array(out_src)
    out = dict(m)
    out["pos"] = pos[out_src]
    out["nrm"] = np.array(out_nrm)
    out["uv"] = m["uv"][out_src]
    if "col" in m:
        out["col"] = m["col"][out_src]
    out["idx"] = out_of_corner.reshape(-1, 3)
    return out


# --- primitives ------------------------------------------------------------------------------------

def _axis_samples(h, r, seg):
    if r <= 1e-9:
        return np.array([-h, h])
    r = min(r, h - 1e-6)
    ph = np.linspace(0.0, np.pi / 4.0, seg + 1)[1:]
    off = r * np.tan(ph)
    lo = np.concatenate([-(h - r) - off[::-1], [-(h - r)]])
    hi = np.concatenate([[h - r], (h - r) + off])
    return np.concatenate([lo, hi])


def rbox(size, radius=0.005, seg=2, tile=0.25, uv_off=(0.0, 0.0)):
    """Rounded box centred at the origin. size = (sx, sy, sz). UV: per-face planar, metres / tile."""
    hx, hy, hz = [s / 2.0 for s in size]
    r = min(radius, min(hx, hy, hz) * 0.999)
    axes = [_axis_samples(hx, r, seg), _axis_samples(hy, r, seg), _axis_samples(hz, r, seg)]
    half = np.array([hx, hy, hz])
    inner = half - r
    pos, nrm, uv, idx = [], [], [], []
    base = 0
    for ax in range(3):
        for sgn in (-1.0, 1.0):
            u_ax, v_ax = [a for a in range(3) if a != ax]
            U_, V_ = np.meshgrid(axes[u_ax], axes[v_ax], indexing="ij")
            p = np.zeros(U_.shape + (3,))
            p[..., ax] = sgn * half[ax]
            p[..., u_ax] = U_
            p[..., v_ax] = V_
            c = np.clip(p, -inner, inner)
            d = p - c
            ln = np.linalg.norm(d, axis=-1, keepdims=True)
            n = d / np.maximum(ln, 1e-12)
            q = c + n * r if r > 1e-9 else p
            if r <= 1e-9:
                n = np.zeros_like(p)
                n[..., ax] = sgn
            nu, nv = U_.shape
            pos.append(q.reshape(-1, 3))
            nrm.append(n.reshape(-1, 3))
            uv.append(np.stack([U_.reshape(-1), V_.reshape(-1)], axis=1) / tile + np.array(uv_off))
            ii = np.arange(nu * nv).reshape(nu, nv) + base
            quads = np.stack([ii[:-1, :-1], ii[1:, :-1], ii[1:, 1:], ii[:-1, 1:]], axis=-1).reshape(-1, 4)
            # winding so that the geometric normal points outward
            t1 = quads[:, [0, 1, 2]]
            t2 = quads[:, [0, 2, 3]]
            tris = np.concatenate([t1, t2])
            allpos = np.concatenate(pos)
            fn = face_normals(allpos, tris)
            outward = np.einsum("ij,ij->i", fn, allpos[tris].mean(axis=1))
            tris[outward < 0] = tris[outward < 0][:, [0, 2, 1]]
            idx.append(tris)
            base += nu * nv
    return mk(np.concatenate(pos), np.concatenate(nrm), np.concatenate(uv), np.concatenate(idx))


def frame_from_axis(axis, up=(0.0, 1.0, 0.0)):
    z = np.asarray(axis, float)
    z = z / np.linalg.norm(z)
    up = np.asarray(up, float)
    x = np.cross(up, z)
    if np.linalg.norm(x) < 1e-6:
        x = np.cross([1.0, 0.0, 0.0], z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return x, y, z


def cylinder(p0, p1, r0, r1=None, seg=16, rings=1, caps=(True, True), tile=0.25, up=(0, 1, 0), smooth_caps=False, cap_inset=0.0):
    """Tapered cylinder from p0 to p1 (ends flat-capped)."""
    r1 = r0 if r1 is None else r1
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    x, y, z = frame_from_axis(p1 - p0, up)
    L = np.linalg.norm(p1 - p0)
    th = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    rings_p, rings_n = [], []
    slope = (r0 - r1) / max(L, 1e-9)
    for k in range(rings + 1):
        t = k / rings
        r = r0 + (r1 - r0) * t
        c = p0 + (p1 - p0) * t
        ring = c + r * (np.cos(th)[:, None] * x + np.sin(th)[:, None] * y)
        nn = np.cos(th)[:, None] * x + np.sin(th)[:, None] * y + slope * z
        nn /= np.linalg.norm(nn, axis=1, keepdims=True)
        rings_p.append(ring)
        rings_n.append(nn)
    K = rings + 1
    pos = np.concatenate(rings_p)
    nrm = np.concatenate(rings_n)
    u = np.tile(th / (2 * np.pi) * 2 * np.pi * (r0 + r1) / 2 / tile, K)
    v = np.repeat(np.linspace(0, L / tile, K), seg)
    uv = np.stack([u, v], axis=1)
    tris = []
    for k in range(rings):
        for i in range(seg):
            a = k * seg + i
            b = k * seg + (i + 1) % seg
            c = (k + 1) * seg + i
            d = (k + 1) * seg + (i + 1) % seg
            tris.append((a, c, b))
            tris.append((b, c, d))
    tris = np.array(tris, np.int64)
    # orient outward
    fn = face_normals(pos, tris)
    cen = pos[tris].mean(axis=1)
    axis_c = p0 + np.outer(np.clip((cen - p0) @ z / max(L, 1e-9), 0, 1), (p1 - p0))
    flip = np.einsum("ij,ij->i", fn, cen - axis_c) < 0
    tris[flip] = tris[flip][:, [0, 2, 1]]
    parts = [mk(pos, nrm, uv, tris)]
    for cap, (c, r, sgn) in zip(caps, ((p0, r0, -1.0), (p1, r1, 1.0))):
        if not cap:
            continue
        ring = c + r * (np.cos(th)[:, None] * x + np.sin(th)[:, None] * y)
        cp = np.vstack([c[None, :] + sgn * z * (-cap_inset if cap_inset else 0), ring])
        cn = np.tile(sgn * z, (seg + 1, 1))
        cuv = np.vstack([[0, 0], np.stack([np.cos(th), np.sin(th)], axis=1) * r]) / tile
        ct = []
        for i in range(seg):
            a, b = 1 + i, 1 + (i + 1) % seg
            ct.append((0, a, b) if sgn > 0 else (0, b, a))
        # ensure outward
        ct = np.array(ct)
        fnc = face_normals(cp, ct)
        if (fnc @ (sgn * z)).mean() < 0:
            ct = ct[:, [0, 2, 1]]
        parts.append(mk(cp, cn, cuv, ct))
    return merge(parts)


def lathe(profile, center, axis=(0, 1, 0), seg=24, tile=0.25, up=(0, 0, 1), angle=(0.0, 2 * np.pi)):
    """Surface of revolution. profile: [(radius, height_along_axis), ...] from bottom to top; radius 0 allowed at ends."""
    x, y, z = frame_from_axis(axis, up)
    th = np.linspace(angle[0], angle[1], seg + 1 if angle[1] - angle[0] < 2 * np.pi - 1e-6 else seg, endpoint=(angle[1] - angle[0] < 2 * np.pi - 1e-6))
    closed = angle[1] - angle[0] >= 2 * np.pi - 1e-6
    prof = np.asarray(profile, float)
    K = len(prof)
    pos = []
    for r, h in prof:
        pos.append(np.asarray(center) + h * z + r * (np.cos(th)[:, None] * x + np.sin(th)[:, None] * y))
    pos = np.concatenate(pos)
    n = len(th)
    tris = []
    for k in range(K - 1):
        for i in range(n if closed else n - 1):
            a = k * n + i
            b = k * n + (i + 1) % n
            c = (k + 1) * n + i
            d = (k + 1) * n + (i + 1) % n
            tris.append((a, b, c))
            tris.append((b, d, c))
    tris = np.array(tris, np.int64)
    uv = np.stack([np.tile(np.arange(n) * 0.02 / tile, K), np.repeat(np.cumsum(np.r_[0, np.linalg.norm(np.diff(prof, axis=0), axis=1)]) / tile, n)], axis=1)
    m = mk(pos, np.zeros_like(pos), uv, tris)
    # outward orientation: compare with radial direction
    fn = face_normals(pos, tris)
    cen = pos[tris].mean(axis=1) - np.asarray(center)
    cen_r = cen - np.outer(cen @ z, z)
    ok = np.einsum("ij,ij->i", fn, cen_r) > 0
    if ok.mean() < 0.5:
        m["idx"] = tris[:, [0, 2, 1]]
    return smooth_normals(m, 50.0)


def ellipsoid(center, radii, seg=16, rings=10, R=None, tile=0.25):
    lat = np.linspace(0, np.pi, rings + 1)
    lon = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    pos, nrm = [], []
    for a in lat:
        for b in lon:
            p = np.array([np.sin(a) * np.cos(b), np.cos(a), np.sin(a) * np.sin(b)])
            pos.append(p * np.asarray(radii))
            n = p / np.asarray(radii)
            nrm.append(n / np.linalg.norm(n))
    pos = np.array(pos)
    nrm = np.array(nrm)
    tris = []
    for k in range(rings):
        for i in range(seg):
            a = k * seg + i
            b = k * seg + (i + 1) % seg
            c = (k + 1) * seg + i
            d = (k + 1) * seg + (i + 1) % seg
            if k > 0:
                tris.append((a, c, b))
            if k < rings - 1:
                tris.append((b, c, d))
    tris = np.array(tris, np.int64)
    uv = np.stack([np.tile(lon, rings + 1) * np.mean(radii) / tile, np.repeat(lat, seg) * np.mean(radii) / tile], axis=1)
    m = mk(pos, nrm, uv, tris)
    fn = face_normals(pos, tris)
    if (np.einsum("ij,ij->i", fn, pos[tris].mean(axis=1)) < 0).mean() > 0.5:
        m["idx"] = tris[:, [0, 2, 1]]
    if R is not None:
        m = xform(m, R)
    return xform(m, t=center)


def loft(rings, closed=True, cap0=False, cap1=False, tile=0.25, angle=40.0, flip=False, smooth=True):
    """rings: (K, N, 3) array; quads between successive rings. Returns smooth-by-angle mesh."""
    rings = np.asarray(rings, float)
    K, N, _ = rings.shape
    pos = rings.reshape(-1, 3)
    # uv: arc length
    ds = np.linalg.norm(np.diff(rings, axis=1, append=rings[:, :1]), axis=2)
    arc = np.concatenate([np.zeros((K, 1)), np.cumsum(ds[:, :-1], axis=1)], axis=1)
    lv = np.linalg.norm(np.diff(rings, axis=0), axis=2).mean(axis=1)
    vv = np.concatenate([[0], np.cumsum(lv)])
    uv = np.stack([arc.reshape(-1), np.repeat(vv, N)], axis=1) / tile
    tris = []
    rng_i = N if closed else N - 1
    for k in range(K - 1):
        for i in range(rng_i):
            a = k * N + i
            b = k * N + (i + 1) % N
            c = (k + 1) * N + i
            d = (k + 1) * N + (i + 1) % N
            tris.append((a, b, c))
            tris.append((b, d, c))
    parts_pos, parts_uv = [pos], [uv]
    tris = np.array(tris, np.int64)
    extra = []
    base = len(pos)
    for cap, ring, sgn in ((cap0, rings[0], -1.0), (cap1, rings[-1], 1.0)):
        if cap:
            c = ring.mean(axis=0)
            parts_pos.append(np.vstack([c[None], ring]))
            parts_uv.append(np.vstack([[0, 0], np.stack([ring[:, 0] - c[0], ring[:, 2] - c[2]], axis=1)]) / tile)
            for i in range(N):
                extra.append((base, base + 1 + i, base + 1 + (i + 1) % N))
            base += N + 1
    if extra:
        tris = np.concatenate([tris, np.array(extra, np.int64)])
    pos = np.concatenate(parts_pos)
    uv = np.concatenate(parts_uv)
    m = mk(pos, np.zeros_like(pos), uv, tris)
    if flip:
        m["idx"] = m["idx"][:, [0, 2, 1]]
    return smooth_normals(m, angle if smooth else 1.0)


def orient_outward(m, center, angle=40.0):
    """Flip triangles that face toward `center` (for closed convex-ish shapes); normals are recomputed."""
    fn = face_normals(m["pos"], m["idx"])
    cen = m["pos"][m["idx"]].mean(axis=1) - np.asarray(center)
    bad = np.einsum("ij,ij->i", fn, cen) < 0
    out = dict(m)
    idx = m["idx"].copy()
    idx[bad] = idx[bad][:, [0, 2, 1]]
    out["idx"] = idx
    return smooth_normals(out, angle)


def sweep(path, radius=0.01, sides=8, tile=0.25, up=(0, 1, 0), profile=None, scale=None, caps=True, angle=45.0, ends_round=False):
    """Tube (or profile extrusion) along a polyline. radius: float or per-point array; profile: (N,2) local polygon."""
    path = np.asarray(path, float)
    M = len(path)
    tang = np.gradient(path, axis=0)
    tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
    if profile is None:
        a = np.linspace(0, 2 * np.pi, sides, endpoint=False)
        profile = np.stack([np.cos(a), np.sin(a)], axis=1)
    profile = np.asarray(profile, float)
    rad = np.full(M, radius) if np.ndim(radius) == 0 else np.asarray(radius, float)
    # parallel transport frames
    up = np.asarray(up, float)
    x0 = np.cross(up, tang[0])
    if np.linalg.norm(x0) < 1e-6:
        x0 = np.cross([1.0, 0, 0], tang[0])
    x0 /= np.linalg.norm(x0)
    frames = []
    xprev = x0
    for i in range(M):
        xi = xprev - tang[i] * (xprev @ tang[i])
        if np.linalg.norm(xi) < 1e-6:
            xi = np.cross(up, tang[i])
        xi /= np.linalg.norm(xi)
        yi = np.cross(tang[i], xi)
        frames.append((xi, yi))
        xprev = xi
    rings = []
    for i in range(M):
        xi, yi = frames[i]
        sc = rad[i]
        if scale is not None:
            sx, sy = scale
        else:
            sx = sy = 1.0
        rings.append(path[i] + sc * (profile[:, 0:1] * sx * xi + profile[:, 1:2] * sy * yi))
    m = loft(np.array(rings), closed=True, cap0=caps, cap1=caps, tile=tile, angle=angle)
    return m


def polyline_smooth(pts, n=32):
    """Catmull-Rom resample of a control polyline to n points."""
    pts = np.asarray(pts, float)
    if len(pts) < 3:
        return np.array([pts[0] + (pts[-1] - pts[0]) * t for t in np.linspace(0, 1, n)])
    P = np.vstack([2 * pts[0] - pts[1], pts, 2 * pts[-1] - pts[-2]])
    out = []
    ts = np.linspace(0, len(pts) - 1, n)
    for t in ts:
        i = min(int(np.floor(t)), len(pts) - 2)
        u = t - i
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


# --- ray casting against the body ---------------------------------------------------------------------

class Raycaster:
    """Vectorised Moller-Trumbore against a triangle soup (final space)."""

    def __init__(self, pos, tris):
        self.a = pos[tris[:, 0]]
        self.e1 = pos[tris[:, 1]] - self.a
        self.e2 = pos[tris[:, 2]] - self.a
        self.n = np.cross(self.e1, self.e2)
        self.n /= np.maximum(np.linalg.norm(self.n, axis=1, keepdims=True), 1e-12)
        self.centres = pos[tris].mean(axis=1)
        self.tree = cKDTree(self.centres)

    def cast(self, origins, dirs, tmax=2.0, chunk=256):
        """First hit for each ray. Returns (t (R,), point (R,3), normal (R,3)); t = inf where no hit."""
        R = len(origins)
        T = np.full(R, np.inf)
        pts = np.zeros((R, 3))
        nrm = np.zeros((R, 3))
        for s in range(0, R, chunk):
            o = origins[s:s + chunk][:, None, :]
            d = dirs[s:s + chunk][:, None, :]
            h = np.cross(d, self.e2[None])
            det = np.einsum("rtk,tk->rt", h, self.e1)
            ok = np.abs(det) > 1e-10
            inv = 1.0 / np.where(ok, det, 1.0)
            sv = o - self.a[None]
            u = np.einsum("rtk,rtk->rt", sv, h) * inv
            q = np.cross(sv, self.e1[None])
            v = np.einsum("rtk,rtk->rt", d.repeat(sv.shape[1], axis=1), q) * inv
            t = np.einsum("tk,rtk->rt", self.e2, q) * inv
            hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-6) & (t < tmax)
            tt = np.where(hit, t, np.inf)
            k = tt.argmin(axis=1)
            tm = tt[np.arange(len(k)), k]
            T[s:s + chunk] = tm
            good = np.isfinite(tm)
            pts[s:s + chunk][good] = origins[s:s + chunk][good] + dirs[s:s + chunk][good] * tm[good][:, None]
            nrm[s:s + chunk][good] = self.n[k[good]]
        return T, pts, nrm

    def nearest(self, P):
        """Approximate closest surface point (nearest triangle centroid -> plane projection)."""
        _, i = self.tree.query(P)
        n = self.n[i]
        d = np.einsum("ij,ij->i", P - self.centres[i], n)
        return P - n * d[:, None], n, d


# --- skinning ------------------------------------------------------------------------------------------

class Binder:
    """Skin gear by the body's own weights (nearest vertices) or rigidly to a bone."""

    def __init__(self, ch):
        self.ch = ch
        self.P = mh.to_final(ch.pos)
        valid = np.zeros(len(self.P), bool)
        valid[np.unique(ch.tv)] = True
        self.vidx = np.where(valid)[0]
        self.tree = cKDTree(self.P[self.vidx])
        self.W = ch.W

    def body(self, P, k=3, restrict=None):
        d, i = self.tree.query(P, k=k)
        v = self.vidx[i]
        w = 1.0 / np.maximum(d, 1e-4)
        w = w / w.sum(axis=1, keepdims=True)
        Wsum = np.einsum("nk,nkb->nb", w, self.W[v])
        return mh.top4(Wsum)

    def bone(self, P, name):
        n = len(P)
        j = np.zeros((n, 4), np.uint16)
        w = np.zeros((n, 4), np.float32)
        j[:, 0] = mh.BONE_INDEX[name]
        w[:, 0] = 1.0
        return j, w

    def blend(self, P, a, b, t):
        """t (N,) 0 -> bone a, 1 -> bone b."""
        n = len(P)
        j = np.zeros((n, 4), np.uint16)
        w = np.zeros((n, 4), np.float32)
        j[:, 0] = mh.BONE_INDEX[a]
        j[:, 1] = mh.BONE_INDEX[b]
        t = np.clip(t, 0, 1)
        w[:, 0] = 1 - t
        w[:, 1] = t
        return j, w


def to_prim(m, joints, weights):
    p = dict(pos=m["pos"], nrm=m["nrm"], uv=m["uv"], joints=joints, weights=weights, idx=m["idx"])
    if "col" in m:
        p["color"] = m["col"]
    return p


# --- surface-conforming parts ------------------------------------------------------------------------------

def superellipse_r(phi, a, b, e=4.0):
    """Radius of the superellipse |x/a|^e + |y/b|^e = 1 in direction phi."""
    c, s = np.abs(np.cos(phi)), np.abs(np.sin(phi))
    return (1.0 / ((c / a) ** e + (s / b) ** e)) ** (1.0 / e)


def patch_on_surface(rc, P0, n, up, half_u, half_v, standoff=0.004, thick=0.012, bevel=0.004, e=4.0, rings=5, seg=28,
                     dome=0.0, tile=0.25, back=True, cast_from=0.25, cut_r=0.0, bevel_steps=2):
    """A plate hugging the surface: outline = superellipse (half_u x half_v) around P0, projected along -n onto the
    surface hit by `rc`, offset by `standoff`, raised `thick` with a bevelled rim; optional dome. n = outward direction.
    Returns a mesh (with a closed rim wall)."""
    n = np.asarray(n, float)
    n /= np.linalg.norm(n)
    u = np.cross(up, n)
    if np.linalg.norm(u) < 1e-6:
        u = np.cross([1.0, 0, 0], n)
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    # rings of normalised radius 0..1 (0 = centre)
    phis = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    rad_r = np.concatenate([[0.0], np.linspace(1.0 / rings, 1.0, rings)])
    grid = []
    for ri in rad_r:
        row = []
        for ph in phis:
            R = superellipse_r(ph, half_u, half_v, e)
            row.append(P0 + (np.cos(ph) * u * 1.0 + np.sin(ph) * v * 1.0) * R * ri * (1.0 if ri > 0 else 0.0))
        grid.append(np.array(row))
    grid = np.array(grid)              # (rings+1, seg, 3)
    flat = grid.reshape(-1, 3)
    T, hp, hn = rc.cast(flat + n * cast_from, np.tile(-n, (len(flat), 1)), tmax=cast_from * 2.5)
    miss = ~np.isfinite(T)
    if miss.all():
        raise RuntimeError("patch_on_surface: no surface under the patch")
    if miss.any():
        pn, nn2, d = rc.nearest(flat[miss])
        hp[miss] = pn
        hn[miss] = nn2
    # smooth the hit surface a little so the plate is a clean shape
    hp = hp.reshape(rings + 1, seg, 3)
    hn = hn.reshape(rings + 1, seg, 3)
    surf_n = hn.mean(axis=(0, 1))
    surf_n /= np.linalg.norm(surf_n)
    out_rings = []
    zprof = []
    # height profile per ring: flat top + dome, bevel on the outermost rings
    bevel_r = np.linspace(1.0 - bevel_steps * 0.03, 1.0, bevel_steps + 1)
    prof_r = [r for r in rad_r]
    for ri in rad_r:
        z = standoff + thick
        if dome:
            z += dome * (1.0 - ri ** 2)
        zprof.append(z)
    pts_rings = []
    for k, ri in enumerate(rad_r):
        z = zprof[k]
        if k == len(rad_r) - 1:
            z = zprof[k] - bevel * 0.6
        pts_rings.append(hp[k] + hn[k] * z)
    # extra bevel ring just inside the rim, at full height, slightly smaller
    ring_top = pts_rings[-2].copy()
    rim_top = pts_rings[-1].copy()
    # walls: from rim (top-bevelled) down to the surface offset by standoff
    wall_bottom = hp[-1] + hn[-1] * standoff
    all_rings = pts_rings + [wall_bottom]
    R_ = np.array(all_rings)
    K = len(all_rings)
    pos = R_.reshape(-1, 3)
    tris = []
    for k in range(K - 1):
        for i in range(seg):
            a = k * seg + i
            b = k * seg + (i + 1) % seg
            c = (k + 1) * seg + i
            d = (k + 1) * seg + (i + 1) % seg
            tris.append((a, b, c))
            tris.append((b, d, c))
    tris = np.array(tris, np.int64)
    # centre collapse ring 0 (all points equal): fine (degenerate tris removed)
    uvp = np.stack([np.sum((pos - P0) * u, axis=1), np.sum((pos - P0) * v, axis=1)], axis=1) / tile
    m = mk(pos, np.zeros_like(pos), uvp, tris)
    # orient outward w.r.t. surface normal
    fn = face_normals(pos, tris)
    area = np.linalg.norm(fn, axis=1)
    keep = area > 1e-10
    m["idx"] = tris[keep]
    fn = fn[keep]
    top_tris = m["idx"] // seg < len(pts_rings)
    if (fn[top_tris] @ surf_n).mean() < 0:
        m["idx"] = m["idx"][:, [0, 2, 1]]
    return smooth_normals(m, 38.0)


def rings_along(rc, p0, p1, ts, offset=0.005, n=28, r_out=0.35, up_hint=(0, 0, 1)):
    """Cross-section rings of the body around the line p0->p1 at fractions ts (each ring: (n,3)), pushed out by
    `offset`.  Used for wraps, cuffs, straps and boot shafts."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    axis = (p1 - p0) / np.linalg.norm(p1 - p0)
    x, y, z = frame_from_axis(axis, up_hint)
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    dirs = np.cos(th)[:, None] * x + np.sin(th)[:, None] * y
    rings = []
    for t in ts:
        c = p0 + (p1 - p0) * t
        orig = c + dirs * r_out
        T, hp, hn = rc.cast(orig, -dirs, tmax=r_out * 1.2)
        miss = ~np.isfinite(T)
        if miss.any():
            fill = np.nanmedian(T[~miss]) if (~miss).any() else r_out * 0.5
            hp[miss] = orig[miss] - dirs[miss] * fill
            hn[miss] = dirs[miss]
        # smooth radii around the ring
        r = np.linalg.norm(hp - c - np.outer((hp - c) @ axis, axis), axis=1)
        r = (np.roll(r, 1) + 2 * r + np.roll(r, -1)) / 4.0
        ring = c + dirs * (r + offset)[:, None]
        rings.append(ring)
    return np.array(rings), dirs

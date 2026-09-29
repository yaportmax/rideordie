"""Reusable gear builders (final space).  Each returns a list of (mesh, material_key, skin_spec) for the caller to add."""
import numpy as np
from scipy.spatial import ConvexHull

import kit
import mh


class BodyRC:
    """Raycasters over regions of the body in final space."""

    def __init__(self, ch):
        self.ch = ch
        src = getattr(ch, "full", None)           # after decimation, rays go against the full-resolution body
        self.P = mh.to_final(src["pos"] if src else ch.pos)
        self.top = src["top"] if src else ch.top
        self.tv = src["tv"] if src else ch.tv
        self._cache = {}

    def region(self, *bone_subs):
        key = tuple(bone_subs)
        if key in self._cache:
            return self._cache[key]
        ids = [i for n, i in mh.BONE_INDEX.items() if any(s in n for s in bone_subs)]
        sel = np.isin(self.top, ids)
        tris = self.tv[np.all(sel[self.tv], axis=1)]
        rc = kit.Raycaster(self.P, tris)
        self._cache[key] = rc
        return rc

    def head(self):
        return self.region("Head", "Neck")

    def landmarks(self):
        ch = self.ch
        H = {n: mh.to_final(ch.sk["heads"][n]) for n in mh.BONE_NAMES}
        return H


def inflate_hull(pts, off, drop_top=None):
    """Convex hull of pts inflated by `off` along vertex normals. Returns kit mesh (outward)."""
    hull = ConvexHull(pts)
    used = np.unique(hull.simplices)
    remap = -np.ones(len(pts), int)
    remap[used] = np.arange(len(used))
    T = remap[hull.simplices]
    P = pts[used].copy()
    c = P.mean(axis=0)
    fn = kit.face_normals(P, T)
    flip = np.einsum("ij,ij->i", fn, P[T].mean(axis=1) - c) < 0
    T[flip] = T[flip][:, [0, 2, 1]]
    vn = np.zeros_like(P)
    fn = kit.face_normals(P, T)
    for k in range(3):
        np.add.at(vn, T[:, k], fn)
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)
    P = P + vn * off
    if drop_top is not None:
        fnn = kit.face_normals(P, T)
        fnn /= np.maximum(np.linalg.norm(fnn, axis=1, keepdims=True), 1e-9)
        cen = P[T].mean(axis=1)
        T = T[~((fnn[:, 1] > 0.5) & (cen[:, 1] > drop_top))]
    uv = np.stack([P[:, 0], P[:, 2]], axis=1) / 0.25
    return kit.smooth_normals(kit.mk(P, np.zeros_like(P), uv, T), 50.0)


def footprint_solid(poly_xz, y0, y1, chamfer=0.004, tile=0.25, heel_extra=0.0):
    """Extrude a footprint polygon (N,2) into a sole with chamfered top/bottom edges."""
    c = poly_xz.mean(axis=0)
    def ring(shrink, y):
        d = poly_xz - c
        L = np.linalg.norm(d, axis=1, keepdims=True)
        p = c + d * np.maximum(1 - shrink / np.maximum(L, 1e-6), 0.05)
        return np.stack([p[:, 0], np.full(len(p), y), p[:, 1]], axis=1)
    rings = [ring(chamfer, y0), ring(0.0, y0 + chamfer * 1.2), ring(0.0, y1 - chamfer * 1.2), ring(chamfer * 0.6, y1)]
    m = kit.loft(np.array(rings), closed=True, cap0=True, cap1=True, tile=tile, angle=40.0)
    # outward orientation
    return kit.orient_outward(m, np.array([c[0], (y0 + y1) / 2, c[1]]))


def boots(ctx, brc, side, shaft_len=0.22, upper_off=0.011, sole_h=0.032, sole_off=0.012, laces=True, detail=1.0):
    """One boot: dict(upper, shaft, sole, laces(list)). Lofted from the foot's own cross-sections (final space)."""
    ch = ctx.ch
    P = brc.P
    top = brc.top
    B = mh.BONE_INDEX
    H = brc.landmarks()
    ankle = H[side + "Foot"]
    valid = np.zeros(len(P), bool)
    valid[np.unique(brc.tv)] = True
    foot = np.isin(top, [B[side + "Foot"], B[side + "ToeBase"]]) & valid
    ptsF = P[foot]
    ptsF = ptsF[ptsF[:, 1] < ankle[1] + 0.03]
    sole0 = float(ptsF[:, 1].min())            # underside of the bare foot (= sole thickness above the floor)
    d = H[side + "ToeBase"] - ankle
    d[1] = 0
    d /= np.linalg.norm(d)
    side_v = np.cross(d, [0.0, 1.0, 0.0])
    along = (ptsF - ankle) @ d
    a0, a1 = float(along.min()), float(along.max())
    rc_foot = brc.region(side + "Foot", side + "ToeBase")
    stations = np.linspace(a0 + 0.012, a1 - 0.010, max(8, int(14 * detail)))
    n = max(14, int(26 * detail))
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    rings = []
    prev_c = None
    for a in stations:
        sel = np.abs(along - a) < 0.02
        pts = ptsF[sel]
        ymin, ymax = float(pts[:, 1].min()), float(pts[:, 1].max())
        c = ankle + d * a
        c[1] = (ymin + ymax) / 2
        c[:] = c + side_v * float(((pts - c) @ side_v).mean())
        dirs = np.cos(th)[:, None] * side_v + np.sin(th)[:, None] * np.array([0.0, 1.0, 0.0])
        orig = c + dirs * 0.16
        T, hp, hn = rc_foot.cast(orig, -dirs, tmax=0.2)
        bad = ~np.isfinite(T)
        r = np.where(bad, np.nan, 0.16 - T)
        if bad.any():
            r[bad] = np.nanmedian(r) if (~bad).any() else 0.04
        for _ in range(2):
            r = (np.roll(r, 1) + 2 * r + np.roll(r, -1)) / 4.0
        # boxier, chunkier section: blend toward a superellipse through the ring's extents (toe box, heel counter)
        wmax = float(np.abs(r * np.cos(th)).max())
        hup = float(np.max(r * np.sin(th)))
        hdn = float(np.max(-r * np.sin(th)))
        hh = np.where(np.sin(th) >= 0, hup, hdn)
        se = kit.superellipse_r(th, wmax, np.maximum(hh, 1e-3), 3.0)
        fore = float(np.clip((a - a0) / max(a1 - a0, 1e-6), 0, 1))
        k_box = 0.55
        r = r * (1 - k_box) + np.maximum(se, r * 0.9) * k_box
        grow = upper_off + 0.010 * float(np.clip((fore - 0.45) / 0.4, 0, 1)) * (1.0 if fore < 0.97 else 0.5)
        ring = c + dirs * (r + grow)[:, None]
        ring[:, 1] = np.maximum(ring[:, 1], sole0 - 0.012)
        rings.append(ring)
    rings = np.array(rings)
    # rounded toe / heel: shrink extra end rings toward the ends' centres
    def cap_ring(ring, toward, k):
        c = ring.mean(axis=0)
        return c + (ring - c) * k + toward
    heel = cap_ring(rings[0], -d * 0.010, 0.62)
    heel2 = cap_ring(rings[0], -d * 0.016, 0.25)
    toe = cap_ring(rings[-1], d * 0.014, 0.66)
    toe2 = cap_ring(rings[-1], d * 0.022, 0.30)
    R = np.concatenate([heel2[None], heel[None], rings, toe[None], toe2[None]])
    upper = kit.loft(R, closed=True, cap0=True, cap1=True, tile=0.25, angle=48.0)
    upper = kit.orient_outward(upper, R.reshape(-1, 3).mean(axis=0), 48.0)
    # sole: hull polygon of the footprint, inflated, chaikin-smoothed
    low = ptsF[ptsF[:, 1] < sole0 + 0.05]
    hull2d = ConvexHull(low[:, [0, 2]])
    poly = low[hull2d.vertices][:, [0, 2]]
    cen = poly.mean(axis=0)
    dd = poly - cen
    L = np.linalg.norm(dd, axis=1, keepdims=True)
    poly = cen + dd * (1 + (sole_off + upper_off * 0.6) / np.maximum(L, 1e-6))
    for _ in range(1 if detail >= 0.9 else 0):
        nxt = np.roll(poly, -1, axis=0)
        poly = np.concatenate([0.75 * poly + 0.25 * nxt, 0.25 * poly + 0.75 * nxt])
        order = np.argsort(np.arctan2(poly[:, 1] - cen[1], poly[:, 0] - cen[0]))
        poly = poly[order]
    sole = footprint_solid(poly, 0.0, sole0 + 0.004, chamfer=0.007)
    # shaft
    rc_leg = brc.region(side + "Leg", side + "Foot")
    p0 = np.array([ankle[0], ankle[1] - 0.035, ankle[2]])
    p1 = np.array([ankle[0], ankle[1] + shaft_len, ankle[2]])
    ts = np.linspace(0, 1, 9 if detail >= 0.7 else 6)
    srings, dirs = kit.rings_along(rc_leg, p0, p1, ts, offset=0.012, n=max(14, int(30 * detail)), r_out=0.25)
    cuff = srings[-1] + dirs * 0.005
    srings = np.concatenate([srings, cuff[None], (cuff - np.array([0, 0.012, 0]) + dirs * 0.002)[None]])
    shaft = kit.loft(srings, closed=True, tile=0.25, angle=45.0)
    shaft = kit.orient_outward(shaft, srings.reshape(-1, 3).mean(axis=0), 45.0)
    out = dict(upper=upper, shaft=shaft, sole=sole, laces=[])
    if laces and detail >= 0.7:
        for a in np.linspace(a0 + 0.32 * (a1 - a0), a0 + 0.70 * (a1 - a0), 5):
            xs = np.linspace(-0.035, 0.035, 7)
            path = []
            for x in xs:
                o = ankle + d * a + side_v * x
                o[1] = ankle[1] + 0.20
                T, hp, hn = rc_foot.cast(o[None], np.array([[0.0, -1.0, 0.0]]), tmax=0.4)
                if not np.isfinite(T[0]):
                    continue
                path.append(hp[0] + hn[0] * (upper_off + 0.003) + np.array([0, 0.0, 0]))
            if len(path) >= 4:
                out["laces"].append(kit.sweep(np.array(path), 0.0024, sides=4, caps=True, tile=0.25))
    return out


def belt(ctx, brc, y, height=0.045, thick=0.006, ease=0.004, cols=72, detail=1.0):
    """A belt ring around the waist at height y (final space), rays cast onto the trunk. Returns (belt mesh, front point)."""
    rc = brc.region("Hips", "Spine")
    Pf = mh.to_final(ctx.ch.pos)
    H = brc.landmarks()
    c = np.array([0.0, y, H["Hips"][2] * 0.4 + H["Spine"][2] * 0.6])
    cols = max(24, int(cols * detail))
    th = np.linspace(0, 2 * np.pi, cols, endpoint=False)
    dirs = np.stack([np.sin(th), np.zeros(cols), np.cos(th)], axis=1)
    out = []
    for dy in (-height / 2, -height * 0.3, height * 0.3, height / 2):
        origins = c + np.array([0, dy, 0]) + dirs * 0.4
        T, hp, hn = rc.cast(origins, -dirs, tmax=0.5)
        bad = ~np.isfinite(T)
        if bad.any():
            T[bad] = np.nanmedian(T[~bad])
            hp[bad] = origins[bad] - dirs[bad] * T[bad][:, None]
        r = np.linalg.norm((hp - (c + np.array([0, dy, 0])))[:, [0, 2]], axis=1)
        # smooth radii and never dip below neighbours (belt spans hollows)
        for _ in range(3):
            r = np.maximum(r, 0.5 * (np.roll(r, 1) + np.roll(r, -1)))
            r = (np.roll(r, 1) + 2 * r + np.roll(r, -1)) / 4.0
        out.append(np.stack([c[0] + dirs[:, 0] * (r + ease + thick), c[1] + dy + 0 * r, c[2] + dirs[:, 2] * (r + ease + thick)], axis=1))
    # outer skin (4 rings) + inner lining ring pair
    inner = [o - np.stack([dirs[:, 0], np.zeros(cols), dirs[:, 2]], axis=1) * thick for o in (out[0], out[-1])]
    rings = np.array([inner[0], out[0], out[1], out[2], out[3], inner[1]])
    m = kit.loft(rings, closed=True, tile=0.25, angle=50.0)
    front = out[1][0].copy()
    front[0] = 0.0
    return m, front, c, out


def strip_ring(ring_top, ring_bottom, thick, dirs=None):
    m = kit.loft(np.array([ring_top, ring_bottom]), closed=True, tile=0.25, angle=60.0)
    return m


def head_info(ctx, brc):
    ch = ctx.ch
    H = brc.landmarks()
    eyeL = mh.to_final(ch.body.mh_bone("eye.L")[0] * 0.1 * mh.SCALE * np.array([-1.0, 1.0, -1.0]) * np.array([-1.0, 1.0, -1.0]) if False else None) if False else None
    eye = mh.to_final(mh.to_game(ch.body.mh_bone("eye.L")[0]) + ch.lift)
    eye_r = mh.to_final(mh.to_game(ch.body.mh_bone("eye.R")[0]) + ch.lift)
    P = brc.P
    hp = P[np.isin(brc.top, [mh.BONE_INDEX["Head"]])]
    return dict(eye_l=eye, eye_r=eye_r, top=float(hp[:, 1].max()), front=float(hp[:, 2].max()), back=float(hp[:, 2].min()),
                head=H["Head"])


def goggles(ctx, brc, up=0.052, hair=0.012, lens_r=0.0255, spacing=0.034, tilt=6.0, seg=24, ring_n=44):
    """Goggles pushed up on the forehead: dict(strap, frames[], lenses[], rims[]) (kit meshes, rigid to Head)."""
    hi = head_info(ctx, brc)
    rc = brc.head()
    ey = 0.5 * (hi["eye_l"][1] + hi["eye_r"][1])
    yc = ey + up
    zc = hi["head"][2]
    # strap ring around the head at height yc (over the hair)
    p0 = np.array([0.0, yc - 0.017, zc])
    p1 = np.array([0.0, yc + 0.017, zc])
    rings, dirs = kit.rings_along(rc, p0, p1, [0.0, 1.0], offset=hair + 0.004, n=ring_n, r_out=0.3)
    inner, _ = kit.rings_along(rc, p0, p1, [0.0, 1.0], offset=hair, n=ring_n, r_out=0.3)
    strap = kit.loft(np.array([inner[0], rings[0], rings[1], inner[1]]), closed=True, tile=0.25, angle=60.0)
    strap = kit.orient_outward(strap, np.array([0.0, yc, zc]), 60.0)
    out = dict(strap=strap, frames=[], lenses=[], rims=[])
    for sgn in (1.0, -1.0):
        x = sgn * spacing
        o = np.array([[x, yc, zc + 0.35]])
        T, hp, hn = rc.cast(o, np.array([[0.0, 0.0, -1.0]]), tmax=0.6)
        pt = hp[0] + hn[0] * (hair + 0.006)
        ax = hn[0] + np.array([0.0, 0.30, 0.0])
        ax /= np.linalg.norm(ax)
        Rt = kit.rot_axis([1, 0, 0], np.radians(-tilt))
        ax = Rt @ ax
        # frame: soft rubber cup
        prof = [(0.0, -0.004), (lens_r + 0.006, -0.004), (lens_r + 0.008, 0.006), (lens_r + 0.005, 0.024), (lens_r - 0.002, 0.030),
                (lens_r - 0.004, 0.024), (lens_r - 0.002, 0.004), (0.0, 0.004)]
        frame = kit.lathe(prof, pt, axis=ax, seg=seg, up=(0, 1, 0))
        rim = kit.lathe([(lens_r - 0.004, 0.026), (lens_r + 0.002, 0.026), (lens_r + 0.003, 0.032), (lens_r - 0.003, 0.033)], pt, axis=ax, seg=seg, up=(0, 1, 0))
        lens = kit.lathe([(0.0, 0.033), (lens_r * 0.6, 0.0325), (lens_r - 0.003, 0.030)], pt, axis=ax, seg=seg, up=(0, 1, 0))
        out["frames"].append(frame)
        out["rims"].append(rim)
        out["lenses"].append(lens)
    # nose bridge between the cups
    br = kit.rbox((0.030, 0.012, 0.012), 0.004, 1)
    pc = 0.5 * (out["frames"][0]["pos"].mean(axis=0) + out["frames"][1]["pos"].mean(axis=0))
    out["bridge"] = kit.xform(br, t=pc + np.array([0, 0.0, 0.004]))
    return out


# --- surface-following parts -----------------------------------------------------------------------------------

def surface_pts(rc, pts, lift=0.12):
    """Project approximate points onto the surface seen by rc: returns (hit points, unit normals)."""
    pts = np.asarray(pts, float)
    P, n0, d = rc.nearest(pts)
    orig = P + n0 * lift
    T, hp, hn = rc.cast(orig, -n0, tmax=lift * 2.5)
    miss = ~np.isfinite(T)
    hp[miss] = P[miss]
    hn[miss] = n0[miss]
    return hp, hn


def ribbon(rc, ctrl, width, standoff=0.004, thick=0.006, n=60, closed=False, tile=0.25, angle=45.0, smooth_n=3):
    """A strap hugging the surface along a smooth path through `ctrl` (approximate surface points)."""
    path = kit.polyline_smooth(ctrl, n)
    if closed:
        path = np.vstack([path, path[:1]])
    hp, hn = surface_pts(rc, path)
    for _ in range(smooth_n):
        hn = (np.roll(hn, 1, axis=0) + 2 * hn + np.roll(hn, -1, axis=0)) / 4.0
        hn /= np.linalg.norm(hn, axis=1, keepdims=True)
    t = np.gradient(hp, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
    side = np.cross(hn, t)
    side /= np.maximum(np.linalg.norm(side, axis=1, keepdims=True), 1e-9)
    prof = [(-width / 2, 0.0), (width / 2, 0.0), (width / 2, thick), (-width / 2, thick)]
    rings = []
    for i in range(len(hp)):
        base = hp[i] + hn[i] * standoff
        rings.append(np.array([base + side[i] * x + hn[i] * z for x, z in prof]))
    m = kit.loft(np.array(rings), closed=True, cap0=not closed, cap1=not closed, tile=tile, angle=angle)
    c = np.array(rings).reshape(-1, 3).mean(axis=0)
    return m, hp, hn


def pouch(size=(0.09, 0.11, 0.05), flap=0.4, radius=0.006, tile=0.25, strap=True, detail=1.0):
    """A belt/MOLLE pouch: body box + flap (origin at the back-centre, +Z = out of the surface). Returns a merged mesh."""
    sx, sy, sz = size
    if detail < 0.7:
        radius = 0.0
    body = kit.rbox((sx, sy, sz), radius, 1 if radius > 0 else 0, tile)
    body = kit.xform(body, t=[0, 0, sz / 2])
    fl = kit.rbox((sx * 1.02, sy * flap, sz * 0.22), radius * 0.8, 1 if radius > 0 else 0, tile)
    fl = kit.xform(fl, t=[0, sy / 2 - sy * flap / 2 + 0.002, sz + 0.002 - sz * 0.05])
    parts_ = [body, fl]
    if strap and detail >= 0.7:
        tab = kit.rbox((sx * 0.22, sy * 0.10, sz * 0.14), radius * 0.6, 1, tile)
        parts_.append(kit.xform(tab, t=[0, sy / 2 - sy * flap - 0.004, sz + 0.004]))
    return kit.merge(parts_)


def place(mesh, P, n, up=(0, 1, 0)):
    """Place a part authored with +Z out of the surface and +Y up at point P with outward normal n."""
    n = np.asarray(n, float)
    n = n / np.linalg.norm(n)
    y = np.asarray(up, float) - n * (np.asarray(up, float) @ n)
    if np.linalg.norm(y) < 1e-6:
        y = np.cross(n, [1.0, 0, 0])
    y /= np.linalg.norm(y)
    x = np.cross(y, n)
    R = np.stack([x, y, n], axis=1)
    return kit.xform(mesh, R=R, t=P)


def grenade(scale=1.0, tile=0.25):
    """Frag grenade (origin at its base centre, +Y up): body, neck, spoon lever and pull ring; returns (body, metal) meshes."""
    s = scale
    body = kit.lathe([(0.0, 0.0), (0.016 * s, 0.002 * s), (0.026 * s, 0.018 * s), (0.028 * s, 0.038 * s), (0.024 * s, 0.056 * s),
                      (0.014 * s, 0.066 * s), (0.0, 0.066 * s)], [0, 0, 0], axis=(0, 1, 0), seg=10, tile=tile)
    neck = kit.cylinder([0, 0.064 * s, 0], [0, 0.078 * s, 0], 0.011 * s, 0.011 * s, seg=8, tile=tile)
    lever = kit.rbox((0.012 * s, 0.070 * s, 0.004 * s), 0.0015, 1, tile)
    lever = kit.xform(lever, t=[0.023 * s, 0.040 * s, 0.0])
    ring = kit.sweep(kit.polyline_smooth([[0.0, 0.08 * s, 0.0], [0.012 * s, 0.086 * s, 0.0], [0.02 * s, 0.078 * s, 0.0], [0.012 * s, 0.072 * s, 0.0]], 8), 0.0012 * s, sides=3, caps=True, tile=tile)
    return body, kit.merge([neck, lever, ring])


def spike(base, direction, length=0.09, r=0.012, seg=10, tile=0.25):
    d = np.asarray(direction, float)
    d /= np.linalg.norm(d)
    p1 = np.asarray(base, float) + d * length
    return kit.cylinder(base, p1, r, 0.0008, seg=seg, tile=tile, caps=(True, False))


def knee_pad(rc, P0, n, up=(0, 1, 0), half_u=0.062, half_v=0.075, thick=0.02):
    return kit.patch_on_surface(rc, P0, n, up, half_u, half_v, standoff=0.006, thick=thick, bevel=0.006, e=3.2, rings=5, seg=28, dome=0.012)


def spiral_wrap(rc, p0, p1, turns=5, width=0.024, offset=0.004, thick=0.003, n=64, ring_n=36, r_out=0.25, phase=0.0, tilt=0.0):
    """A bandage spiralling around a limb from p0 to p1 (radii sampled from the surface)."""
    ts = np.linspace(0, 1, 26)
    rings, dirs = kit.rings_along(rc, p0, p1, ts, offset=0.0, n=ring_n, r_out=r_out)
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    axis = (p1 - p0) / np.linalg.norm(p1 - p0)
    centers = p0 + (p1 - p0) * ts[:, None]
    rad = np.linalg.norm(rings - centers[:, None, :] - np.einsum("ktj,j->kt", rings - centers[:, None, :], axis)[..., None] * axis, axis=2)
    x, y, z = kit.frame_from_axis(axis, (0, 0, 1))
    tt = np.linspace(0, 1, n)
    phi = phase + tt * turns * 2 * np.pi
    L = np.linalg.norm(p1 - p0)
    # interpolate radius at (t, phi)
    def R_at(t, ph):
        ti = np.clip(t * (len(ts) - 1), 0, len(ts) - 1 - 1e-6)
        i0 = ti.astype(int)
        f = ti - i0
        ang = np.mod(ph, 2 * np.pi) / (2 * np.pi) * ring_n
        j0 = ang.astype(int) % ring_n
        j1 = (j0 + 1) % ring_n
        g = ang - np.floor(ang)
        r00, r01 = rad[i0, j0], rad[i0, j1]
        r10, r11 = rad[i0 + 1, j0], rad[i0 + 1, j1]
        return (r00 * (1 - g) + r01 * g) * (1 - f) + (r10 * (1 - g) + r11 * g) * f
    r = R_at(tt, phi) + offset
    pts_c = p0 + np.outer(tt, p1 - p0)
    dirv = np.cos(phi)[:, None] * x + np.sin(phi)[:, None] * y
    pt = pts_c + dirv * r[:, None]
    rings2 = []
    for k in range(n):
        for_edge = []
        for s_, off_r in ((-1, 0.0), (1, 0.0)):
            pass
        c = pt[k]
        e = axis * (width / 2)
        nrm = dirv[k]
        rings2.append(np.array([c - e, c + e, c + e + nrm * thick, c - e + nrm * thick]))
    m = kit.loft(np.array(rings2), closed=True, cap0=True, cap1=True, tile=0.25, angle=50.0)
    return m

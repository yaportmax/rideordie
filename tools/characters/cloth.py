"""Modern garments grown over a MakeHuman body (membrane shells, see garments.py for the machinery) plus the UV /
atlas step that turns them into bake-ready pieces.

All geometry here is in INTERNAL space (faces -Z, character LEFT = -X, metres, feet at y = 0); export flips to final.
"""
import numpy as np
from scipy.spatial import cKDTree

import garments as G
import mh
import uvbake as U


def sstep(e0, e1, x):
    t = np.clip((np.asarray(x, float) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# --- fit with limb coordinates ---------------------------------------------------------------------

class CFit(G.Fit):
    """garments.Fit plus arc-length coordinates along the arms and legs and a few landmarks."""

    def __init__(self, ch):
        super().__init__(ch.body, ch.sk, ch.pos, ch.nrm, ch.tv, W=ch.W)
        self.ch = ch
        H = ch.sk["heads"]
        self.H = H
        self.height = float(ch.pos[:, 1].max())
        self.sh_y = float(H["LeftArm"][1])
        self.sh_x = abs(float(H["LeftArm"][0]) - self.cx)
        self.torso_cz = float(H["Spine1"][2])
        # arm / leg chains: (joint points) for s coordinates, per side
        self.chains = {}
        for side, name in (("L", "Left"), ("R", "Right")):
            self.chains[side + "_arm"] = [H[name + "Arm"], H[name + "ForeArm"], H[name + "Hand"],
                                          0.5 * (H[name + "Hand"] + H[name + "HandMiddle1"]) + (H[name + "HandMiddle1"] - H[name + "Hand"]) * 0.5]
            self.chains[side + "_leg"] = [H[name + "UpLeg"], H[name + "Leg"], H[name + "Foot"], H[name + "ToeBase"]]

    def chain_coord(self, P, key):
        """Arc length s (m from the first joint) and distance r from the chain for points P (N, 3)."""
        pts = self.chains[key]
        best_r = np.full(len(P), 1e9)
        best_s = np.zeros(len(P))
        acc = 0.0
        for a, b in zip(pts[:-1], pts[1:]):
            d = b - a
            L = float(np.linalg.norm(d))
            u = d / max(L, 1e-9)
            t = np.clip((P - a) @ u, 0.0, L)
            q = a + t[:, None] * u
            r = np.linalg.norm(P - q, axis=1)
            better = r < best_r
            best_r = np.where(better, r, best_r)
            best_s = np.where(better, acc + t, best_s)
            acc += L
        return best_s, best_r

    def limb_len(self, key, upto):
        pts = self.chains[key]
        return sum(float(np.linalg.norm(pts[i + 1] - pts[i])) for i in range(upto))

    def tri_centroids(self):
        return self.pos[self.tris].mean(axis=1)

    def tri_normals(self):
        n = self.nrm[self.tris].mean(axis=1)
        return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)

    def theta(self, P):
        """Angle around the torso axis, 0 = front (-z), +ve toward +x (character right ... internal space)."""
        return np.arctan2(P[:, 0] - self.cx, -(P[:, 2] - self.torso_cz))


# --- shell helpers ---------------------------------------------------------------------------------

def _near_arm(fit):
    S = fit.S
    arm_pts = fit.pos[fit.in_groups(fit.g_arms, fit.g_fore)]
    n = len(fit.pos)
    return 1.0 - G._smoothstep(0.03 * S, 0.1 * S, cKDTree(arm_pts).query(fit.pos)[0]) if len(arm_pts) else np.zeros(n)


def offsets(fit, off, bridge, belt=True, blouse=0.012, cinch_y=None, near_arm=None):
    S = fit.S
    n = len(fit.pos)
    lo = np.full(n, off * S)
    na = _near_arm(fit) if near_arm is None else near_arm
    hi = np.full(n, (off + bridge) * S) * (1.0 - 0.85 * na) + off * S * 0.15
    hi = np.maximum(hi, lo)
    if belt:
        y_belt = fit.belt_y if cinch_y is None else cinch_y
        d = fit.pos[:, 1] - y_belt
        cinch = 1.0 - G._smoothstep(0.015 * S, 0.035 * S, np.abs(d))
        lo = lo * (1.0 - 0.45 * cinch)
        hi = np.minimum(hi, lo + 0.004 * S) * cinch + hi * (1.0 - cinch)
        puff = G._smoothstep(0.02 * S, 0.05 * S, d) * (1.0 - G._smoothstep(0.07 * S, 0.16 * S, d))
        lo = lo + blouse * S * puff
        hi = np.maximum(hi, lo)
    return lo, hi


def _set_pos(g, first, P):
    for k, p in enumerate(P):
        g.pos[first + k] = p


def torso_top(fit, style="tank", off=0.014, bridge=0.04, sleeve_len=None, hem=0.0, neck=(0.0, 0.0), open_front=0.0,
              iters=50, belt_blouse=0.01, drape=True, collar=False, strap=0.135, neck_half=0.078, arm_off_extra=0.012, seed=1,
              open_y=None, neck_up=0.0):
    """A top over the torso (and sleeves): returns a Garment (region-tagged), no belt.
    style: 'tank' (deep armholes), 'sleeved' (sleeve_len metres from the shoulder joint; None = none),
    hem: metres relative to the belt line (negative = lower), neck: (front_drop, back_drop) extra metres,
    open_front: half-width (m) of a front opening (jacket), collar: adds a stand-up collar ring."""
    S = fit.S
    B = fit.B
    g = G.Garment()
    n = len(fit.pos)
    pos = fit.pos
    y_hem = fit.belt_y + hem * S
    m = fit.in_groups(fit.g_torso) | ((fit.top == B["Hips"]) & (pos[:, 1] > y_hem - 0.05 * S))
    sh = fit.sh_x
    # shoulder tops out to the joint even without sleeves
    m |= fit.in_groups(fit.g_arms) & (np.abs(pos[:, 0] - fit.cx) < sh + 0.02 * S) & (pos[:, 1] > fit.sh_y - 0.03 * S)
    arm_groups = fit.g_arms | fit.g_fore
    if sleeve_len is not None:
        m |= fit.in_groups(fit.g_arms)
        if sleeve_len > fit.limb_len("L_arm", 1) - 0.03:
            m |= fit.in_groups(fit.g_fore)
    lo, hi = offsets(fit, off, bridge, belt=True, blouse=belt_blouse, cinch_y=y_hem + 0.02 * S)
    arm = fit.in_groups(arm_groups)
    hi = np.where(arm, lo + arm_off_extra * S, hi)
    # -- the cut
    cent = fit.tri_centroids()
    tnorm = fit.tri_normals()
    th = fit.theta(cent)
    ax, ay = np.abs(cent[:, 0] - fit.cx), cent[:, 1]
    tri_arm = np.all(np.isin(fit.top[fit.tris], list(arm_groups)), axis=1)
    sL, _ = fit.chain_coord(cent, "L_arm")
    sR, _ = fit.chain_coord(cent, "R_arm")
    s_arm = np.where(cent[:, 0] < fit.cx, sL, sR)
    keep = ay > y_hem - 0.02 * S
    # neckline: front scoop and lower back, straps of `strap` half width
    neck_base = fit.neck_y
    front = tnorm[:, 2] < 0.0
    fdrop, bdrop = neck
    nk_front = neck_base - 0.045 * S - fdrop * S + (ax / (0.08 * S)) ** 2 * 0.06 * S + neck_up * S
    nk_back = neck_base - 0.02 * S - bdrop * S + (ax / (0.09 * S)) ** 2 * 0.04 * S + neck_up * S
    nk = np.where(front, nk_front, nk_back)
    if style == "tank":
        # armhole: |x| limit shrinking from the underarm up to the strap
        y_ap = fit.sh_y - 0.10 * S
        y_top = fit.neck_y - 0.03 * S
        t = sstep(y_ap, y_top, ay)
        xlim = (fit.sh_x - 0.03 * S) * (1 - t) + strap * S * t
        keep &= ((ax < xlim) | (ay < y_ap)) & ~tri_arm
        keep &= ~((ay > nk) & (ax < strap * S - 0.05 * S)) if False else keep
        keep &= ~((ay > nk) & (ax < neck_half * S))
    else:
        keep &= ~((ay > nk) & (ax < 0.05 * S + 0.0))
        keep &= ~((ay > nk + 0.02 * S) & (ax < 0.075 * S))
        if sleeve_len is not None:
            keep &= ~(tri_arm & (s_arm > sleeve_len))
        else:
            keep &= ~tri_arm
    if open_front > 0.0:
        if open_y is None:
            keep &= ~((tnorm[:, 2] < 0.25) & (ax < open_front * S) & (ay < nk + 0.04 * S) & (cent[:, 2] < fit.torso_cz))
        else:
            # V opening from the neckline down to open_y, narrowing to a point
            topy = nk_front_center = neck_base - 0.045 * S - fdrop * S
            taper = np.clip((ay - open_y) / max(topy - open_y, 1e-3), 0.0, 1.0)
            keep &= ~((tnorm[:, 2] < 0.25) & (cent[:, 2] < fit.torso_cz) & (ay > open_y) & (ax < open_front * S * taper))
    res = G._shell(g, fit, m, lo, hi, iters, cut=lambda c: keep)
    if res is None:
        return g
    first, verts, lt = res
    g.cover = verts[np.array(lt) - first]
    trim_slivers(g, 0)
    # Cull skin only beneath retained cloth faces after boundary sliver removal.
    g.cover = verts[np.asarray(g.tris, dtype=np.int64).reshape(-1, 3) - first]
    if drape:
        G._drape(g, first, fit, y_hem + 0.03 * S)
    P = fit.clear(np.array(g.pos[first:]), off * S * 0.7)
    _set_pos(g, first, P)
    G._classify_edges(g, first, lt, fit, belt=False)
    return g


def pants(fit, off=0.02, bridge=0.03, hem_y=None, iters=45, hem_flare=0.0, waist=0.0):
    """Trousers: thighs, shins and the hips below the waist line; cut at hem_y (metres above the floor)."""
    S = fit.S
    B = fit.B
    g = G.Garment()
    pos = fit.pos
    y_waist = fit.belt_y + waist * S
    hem_y = fit.ankle_y + 0.13 * S if hem_y is None else hem_y
    m = fit.in_groups(fit.g_thigh, fit.g_shin) | (((fit.top == B["Hips"]) | (fit.top == B["Spine"])) & (pos[:, 1] < y_waist + 0.01 * S))
    m &= pos[:, 1] > hem_y - 0.03 * S
    n = len(pos)
    lo = np.full(n, off * S)
    ext = np.abs(fit.nrm[:, 0])
    hi = lo + bridge * S * (1.0 - 0.6 * G._smoothstep(0.45, 0.8, ext))
    # tighter toward the hem so it hangs over the boots without ballooning
    tight = G._smoothstep(hem_y + 0.25 * S, hem_y, pos[:, 1]) * 0.35
    lo = lo * (1.0 - tight) + (hem_flare * S)
    hi = np.maximum(hi, lo)
    cent = fit.tri_centroids()
    keep = (cent[:, 1] < y_waist + 0.005 * S) & (cent[:, 1] > hem_y)
    res = G._shell(g, fit, m, lo, hi, iters, cut=lambda c: keep)
    if res:
        first, verts, lt = res
        g.cover = verts[np.array(lt) - first]
        P = fit.clear(np.array(g.pos[first:]), off * S * 0.7)
        _set_pos(g, first, P)
        G._classify_edges(g, first, lt, fit)
    return g


def vertex_ao(P, N, fit, radius=0.14):
    """Cheap ambient occlusion: body points in the outward hemisphere within `radius`."""
    tree = fit.tree
    pts = fit.pos[fit.vidx]
    occ = np.zeros(len(P))
    for i in range(len(P)):
        idx = tree.query_ball_point(P[i], radius)
        if not idx:
            continue
        q = pts[idx] - P[i]
        d = np.linalg.norm(q, axis=1)
        ok = (q @ N[i] > 0.25 * d) & (d > 0.02)
        if ok.any():
            occ[i] = np.sum((1.0 - d[ok] / radius) ** 2)
    return np.clip(occ / 30.0, 0.0, 1.0)


# --- finishing: tube UVs (metres), regions, hem distance ---------------------------------------------

def finish(g, fit, hem_scale=0.12, uv_r=None):
    """Recompute normals, split seams, tube-unwrap per region (uv in metres, up-facing triangles get their own
    '<region>_top' projected islands) and return arrays for packing. Positions stay INTERNAL."""
    pos, nrm0, joints, weights, tris = g.arrays()
    nrm = mh.vertex_normals(pos, tris)
    loops = G._boundary_loops(tris)
    edge_v = {v for l in loops for v in l} - g.nofray
    dist = np.full(len(pos), 1e9)
    for v in edge_v:
        dist[v] = 0.0
    adj = [[] for _ in range(len(pos))]
    for a, b, c in tris:
        adj[a] += [b, c]
        adj[b] += [a, c]
        adj[c] += [a, b]
    import heapq
    heap = [(0.0, v) for v in edge_v]
    heapq.heapify(heap)
    while heap:
        dv, v = heapq.heappop(heap)
        if dv > dist[v] or dv > 0.3:
            continue
        for u in adj[v]:
            nd = dv + float(np.linalg.norm(pos[u] - pos[v]))
            if nd < dist[u]:
                dist[u] = nd
                heapq.heappush(heap, (nd, u))
    frames = G.axes(fit.sk)
    region = np.array(g.region)
    keymap, src, uvs, regs, new_idx = {}, [], [], [], []
    for t in tris:
        vals, cnt = np.unique(region[t], return_counts=True)
        rg = vals[np.argmax(cnt)]
        ang, rad, along = G._tube_uv(pos[t], rg, frames)
        a0 = ang[0]
        ang = a0 + (ang - a0 + np.pi) % (2 * np.pi) - np.pi
        R = 0.07 if rg.endswith("_arm") else (0.09 if rg.endswith("_leg") else None)
        rr = np.full(3, R) if R else np.maximum(rad, 0.1)
        fn = np.cross(pos[t[1]] - pos[t[0]], pos[t[2]] - pos[t[0]])
        up_face = rg in ("head", "body") and abs(fn[1]) > 0.72 * max(np.linalg.norm(fn), 1e-12)
        face = []
        for k in range(3):
            if up_face:
                uv = (float(pos[t[k], 0]), float(pos[t[k], 2]))
                key = (int(t[k]), rg + "_top", round(uv[0], 4), round(uv[1], 4))
                rname = rg + "_top"
            else:
                uv = (float(ang[k] * rr[k]), float(-along[k] if rg not in ("body", "head") else -pos[t[k], 1]))
                key = (int(t[k]), rg, round(uv[0], 4), round(uv[1], 4))
                rname = rg
            if key not in keymap:
                keymap[key] = len(src)
                src.append(int(t[k]))
                uvs.append(uv)
                regs.append(rname)
            face.append(keymap[key])
        new_idx.append(face)
    src = np.array(src)
    P, N = pos[src], nrm[src]
    _, vi = fit.tree.query(P)
    bv = fit.vidx[vi]
    depth = np.einsum("ij,ij->i", P - fit.pos[bv], fit.nrm[bv])
    return dict(pos=P, nrm=N, uv_m=np.array(uvs, float), region=np.array(regs), joints=joints[src],
                weights=weights[src], idx=np.array(new_idx, np.int64), hem=np.clip(dist[src], 0, 1.0),
                src=src, depth=depth, ao=vertex_ao(P, N, fit))


def pack(pieces, px_per_m, pad=6, max_size=2048):
    """Assign atlas UVs to a list of finished pieces (dicts from finish) sharing one texture. Returns the atlas size.
    Every (piece, region) island is a rectangle with a uniform px_per_m scale."""
    islands = []
    for pi, pc in enumerate(pieces):
        for rg in np.unique(pc["region"]):
            sel = pc["region"] == rg
            uvm = pc["uv_m"][sel]
            lo, hi = uvm.min(axis=0), uvm.max(axis=0)
            w = int(np.ceil((hi[0] - lo[0]) * px_per_m)) + 2
            h = int(np.ceil((hi[1] - lo[1]) * px_per_m)) + 2
            islands.append((pi, rg, lo, w, h))
    offs, atlas = U.pack_islands([(w, h) for _, _, _, w, h in islands], pad, max_size)
    for pc in pieces:
        pc["uv"] = np.zeros((len(pc["pos"]), 2))
    for (pi, rg, lo, w, h), (ox, oy) in zip(islands, offs):
        pc = pieces[pi]
        sel = pc["region"] == rg
        uvm = pc["uv_m"][sel]
        px = (uvm - lo) * px_per_m + np.array([ox + 1, oy + 1])
        pc["uv"][sel] = px / atlas
    return atlas


# --- gloves / hands -------------------------------------------------------------------------------------------

def glove(fit, side, fingerless=True, off=0.0028, cuff=0.05, finger_len=0.03, iters=8, thumb=True):
    """A glove shell over the hand of `side` ('Left'/'Right'). Fingerless: covers palm, back of the hand, the base of
    the fingers (finger_len beyond the knuckles) and a cuff on the forearm."""
    S = fit.S
    H = fit.H
    B = fit.B
    g = G.Garment()
    wrist = H[side + "Hand"]
    mid1 = H[side + "HandMiddle1"]
    hdir = (mid1 - wrist)
    hlen = float(np.linalg.norm(hdir))
    hdir = hdir / hlen
    pos = fit.pos
    t = (pos - wrist) @ hdir
    hand_ids = {i for n, i in mh.BONE_INDEX.items() if n.startswith(side + "Hand")}
    m = np.isin(fit.top, list(hand_ids))
    if fingerless:
        m &= t < hlen + finger_len
        if not thumb:
            m &= ~np.isin(fit.top, [B[side + "HandThumb2"], B[side + "HandThumb3"]])
        else:
            tb = np.isin(fit.top, [B[side + "HandThumb2"], B[side + "HandThumb3"]])
            m &= ~tb
    # forearm cuff
    fore = fit.top == B[side + "ForeArm"]
    m |= fore & (t > -cuff) & (t < 0.02)
    n = len(pos)
    lo = np.full(n, off * S)
    hi = lo + 0.004 * S
    cent = fit.tri_centroids()
    tc = (cent - wrist) @ hdir
    keep = (tc > -cuff) & (tc < (hlen + finger_len + 0.02 if fingerless else 1.0))
    res = G._shell(g, fit, m, lo, hi, iters, cut=lambda c: keep)
    if res:
        first, verts, lt = res
        g.cover = verts[np.array(lt) - first]
        P = fit.clear(np.array(g.pos[first:]), off * S * 0.8)
        _set_pos(g, first, P)
        G._classify_edges(g, first, lt, fit, belt=False)
    return g


def trim_slivers(g, first_tri=0, qmin=0.16, passes=4):
    """Delete thin triangles that touch a free edge (spikes left by cutting along a coarse mesh)."""
    T = np.array(g.tris[first_tri:], np.int64)
    if len(T) == 0:
        return
    P = np.array(g.pos)
    for _ in range(passes):
        a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
        area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
        l2 = np.sum((a - b) ** 2, 1) + np.sum((b - c) ** 2, 1) + np.sum((c - a) ** 2, 1)
        q = 4 * np.sqrt(3) * area / np.maximum(l2, 1e-12)
        cnt = {}
        for t in T:
            for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                k = (min(e), max(e))
                cnt[k] = cnt.get(k, 0) + 1
        free = np.array([any(cnt[(min(e), max(e))] == 1 for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0]))) for t in T])
        kill = free & (q < qmin)
        if not kill.any():
            break
        T = T[~kill]
    g.tris[first_tri:] = [tuple(t) for t in T]


def bindings(g, radius=0.0055, smooth=8, min_len=0.10, first_tri=0, sides=6, skip=None, spacing=0.015):
    """Rolled trim (piping / hem roll) along every free edge of a garment: closed tubes swept along the smoothed boundary
    loops. Returns kit-style meshes in INTERNAL space (call mh.to_final on them) plus the loop points."""
    import kit as K
    T = np.array(g.tris[first_tri:], np.int64)
    if len(T) == 0:
        return []
    P = np.array(g.pos)
    out = []
    for loop in G._boundary_loops(T):
        pts = P[loop]
        L = float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())
        if L < min_len:
            continue
        if skip is not None and skip(pts):
            continue
        for _ in range(smooth):
            pts = pts * 0.5 + (np.roll(pts, 1, axis=0) + np.roll(pts, -1, axis=0)) * 0.25
        n = len(pts)
        # resample to ~1.5 cm spacing
        seg = np.linalg.norm(np.diff(np.vstack([pts, pts[:1]]), axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        m_ = max(int(s[-1] / spacing), 12)
        u = np.linspace(0, s[-1], m_, endpoint=False)
        pts2 = np.stack([np.interp(u, s, np.append(pts[:, k], pts[0, k])) for k in range(3)], axis=1)
        out.append(closed_tube(pts2, radius, sides))
    return out


def closed_tube(path, radius, sides=6, tile=0.25):
    import kit as K
    M = len(path)
    tang = np.roll(path, -1, axis=0) - np.roll(path, 1, axis=0)
    tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
    ref = np.array([0.0, 1.0, 0.0])
    a = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    rings = []
    xprev = np.cross(ref, tang[0])
    for i in range(M):
        xi = xprev - tang[i] * (xprev @ tang[i])
        if np.linalg.norm(xi) < 1e-6:
            xi = np.cross([1.0, 0, 0], tang[i])
        xi /= np.linalg.norm(xi)
        yi = np.cross(tang[i], xi)
        rings.append(path[i] + radius * (np.cos(a)[:, None] * xi + np.sin(a)[:, None] * yi))
        xprev = xi
    rings.append(rings[0])
    m = K.loft(np.array(rings), closed=True, tile=tile, angle=70.0)
    return m


def loop_band(g, which="lowest", height=0.05, thick=0.008, grow=0.006, shrink=0.006, min_len=0.5, center=None, n_max=80):
    """A rib band (hem / waistband) built from a garment's own free-edge loop: the band spans `height` upward from the loop,
    slightly proud of the garment (INTERNAL space kit mesh) - hides the ragged edge of a cut."""
    import kit as K
    T = np.array(g.tris, np.int64)
    P = np.array(g.pos)
    best = None
    for loop in G._boundary_loops(T):
        pts = P[loop]
        L = float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())
        if L < min_len:
            continue
        ym = pts[:, 1].mean()
        if best is None or (which == "lowest" and ym < best[0]) or (which == "highest" and ym > best[0]):
            best = (ym, pts)
    if best is None:
        return None
    pts = best[1]
    for _ in range(8):
        pts = pts * 0.5 + (np.roll(pts, 1, axis=0) + np.roll(pts, -1, axis=0)) * 0.25
    c = pts.mean(axis=0) if center is None else np.asarray(center)
    # order by angle and resample
    ang = np.arctan2(pts[:, 0] - c[0], pts[:, 2] - c[2])
    order = np.argsort(ang)
    pts = pts[order]
    ang = ang[order]
    ta = np.linspace(-np.pi, np.pi, n_max, endpoint=False)
    pr = np.stack([np.interp(ta, ang, pts[:, k], period=2 * np.pi) for k in range(3)], axis=1)
    out = np.stack([pr[:, 0] - c[0], np.zeros(len(pr)), pr[:, 2] - c[2]], axis=1)
    out /= np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-9)
    up = np.array([0.0, 1.0, 0.0]) if which == "lowest" else np.array([0.0, -1.0, 0.0])
    rings = np.array([
        pr - out * thick + up * 0.0,
        pr + out * (grow * 0.4) - up * 0.004,
        pr + out * grow + up * (height * 0.25),
        pr + out * grow + up * (height * 0.75),
        pr + out * (grow * 0.4) + up * height,
        pr - out * thick + up * height,
    ])
    m = K.loft(rings, closed=True, tile=0.25, angle=50.0)
    return m


# --- head wear ------------------------------------------------------------------------------------------------------

def head_frame(fit):
    """Landmarks of the head in INTERNAL space: eye centre, head centre, top, front (min z), back (max z)."""
    ch = fit.ch
    eL = mh.to_game(ch.body.mh_bone("eye.L")[0]) + ch.lift
    eR = mh.to_game(ch.body.mh_bone("eye.R")[0]) + ch.lift
    hd = np.isin(fit.top, [fit.B["Head"]])
    P = fit.pos[hd]
    return dict(eye=0.5 * (eL + eR), eye_l=eL, eye_r=eR, top=float(P[:, 1].max()), front=float(P[:, 2].min()), back=float(P[:, 2].max()),
                centre=np.array([fit.cx, float(P[:, 1].mean()), float(0.5 * (P[:, 2].min() + P[:, 2].max()))]))


def head_shell(fit, keep_fn, off=0.008, bridge=0.004, iters=10, include_neck=False, ymin=None):
    """A shell hugging the head (INTERNAL space).  keep_fn(centroids (T,3), normals (T,3), landmarks) -> bool per triangle."""
    S = fit.S
    g = G.Garment()
    hf = head_frame(fit)
    groups = [fit.B["Head"]] + ([fit.B["Neck"]] if include_neck else [])
    m = np.isin(fit.top, groups)
    if ymin is not None:
        m &= fit.pos[:, 1] > ymin
    n = len(fit.pos)
    lo = np.full(n, off)
    hi = lo + bridge
    cent = fit.tri_centroids()
    nrm = fit.tri_normals()
    keep = keep_fn(cent, nrm, hf)
    res = G._shell(g, fit, m, lo, hi, iters, cut=lambda c: keep)
    if res:
        first, verts, lt = res
        g.cover = verts[np.array(lt) - first]
        P = fit.clear(np.array(g.pos[first:]), off * 0.8)
        _set_pos(g, first, P)
        G._classify_edges(g, first, lt, fit, belt=False)
        trim_slivers(g, 0, qmin=0.10)
    return g

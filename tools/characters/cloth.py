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
              iters=50, belt_blouse=0.01, drape=True, collar=False, strap=0.11, arm_off_extra=0.012, seed=1):
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
    nk_front = neck_base - 0.045 * S - fdrop * S + (ax / (0.08 * S)) ** 2 * 0.06 * S
    nk_back = neck_base - 0.02 * S - bdrop * S + (ax / (0.09 * S)) ** 2 * 0.04 * S
    nk = np.where(front, nk_front, nk_back)
    if style == "tank":
        # armhole: |x| limit shrinking from the underarm up to the strap
        y_ap = fit.sh_y - 0.10 * S
        y_top = fit.neck_y - 0.03 * S
        t = sstep(y_ap, y_top, ay)
        xlim = (fit.sh_x - 0.03 * S) * (1 - t) + strap * S * t
        keep &= ((ax < xlim) | (ay < y_ap)) & ~tri_arm
        keep &= ~((ay > nk) & (ax < strap * S - 0.05 * S)) if False else keep
        keep &= ~((ay > nk) & (ax < (strap - 0.04) * S))
    else:
        keep &= ~((ay > nk) & (ax < 0.05 * S + 0.0))
        keep &= ~((ay > nk + 0.02 * S) & (ax < 0.075 * S))
        if sleeve_len is not None:
            keep &= ~(tri_arm & (s_arm > sleeve_len))
        else:
            keep &= ~tri_arm
    if open_front > 0.0:
        keep &= ~((tnorm[:, 2] < 0.25) & (ax < open_front * S) & (ay < nk + 0.04 * S) & (cent[:, 2] < fit.torso_cz))
    res = G._shell(g, fit, m, lo, hi, iters, cut=lambda c: keep)
    if res is None:
        return g
    first, verts, lt = res
    g.cover = verts[np.array(lt) - first]
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

"""Period clothes grown from a MakeHuman body: tunics, robes, shrouds,
gambesons, jerkins, hose, breeches, loincloths, hoods with shoulder capes,
and the belts that hold them.

Two kinds of cloth:
  * shells over the body (torso, sleeves, legs, head), relaxed like a
    membrane: pulled taut across the hollows between high points (chest to
    belly, the small of the back, the nape), never sinking into the skin,
    cinched in under a belt and bloused above it;
  * hanging cloth (skirts, capes, flaps) that falls straight from the widest
    part of the body above it, gathered into folds that deepen toward the
    hem, skinned to the hips and then the legs so it swings with the stride.

Tube UVs run around each body part in metres, split at the natural seams
(centre back, under the arms, inside the legs). COLOR.r is the distance to
the nearest fraying hem (necklines and edges under a belt don't fray),
COLOR.b the height; UV2 the rest position across the body.
"""
import heapq

import numpy as np
from scipy import sparse
from scipy.spatial import cKDTree

import mh


def _weights_matrix(body, sk, n):
    W = np.zeros((n, len(mh.BONE_NAMES)))
    for gi, name in enumerate(mh.BONE_NAMES):
        for mb in sk["merged"][name]:
            for v, w in body.mh_weights.get(mb, []):
                if v < n:
                    W[v, gi] += w
    s = W.sum(axis=1, keepdims=True)
    return W / np.maximum(s, 1e-9)


def _top4(Wrow):
    j = np.argsort(-Wrow)[:4]
    w = Wrow[j]
    s = w.sum()
    return j, (w / s if s > 1e-9 else np.array([1.0, 0, 0, 0]))


def _smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, float) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _boundary_loops(lt):
    """Open edges of a triangle set, chained into loops of vertex indices."""
    count = {}
    for a, b, c in lt:
        for e in ((a, b), (b, c), (c, a)):
            k = (min(e), max(e))
            count[k] = count.get(k, 0) + 1
    adj = {}
    for (a, b), n in count.items():
        if n == 1:
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
    loops, seen = [], set()
    for start in adj:
        if start in seen:
            continue
        loop = [start]
        seen.add(start)
        prev, cur = None, start
        while True:
            nxt = [x for x in adj[cur] if x != prev and x not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            loop.append(cur)
            seen.add(cur)
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def _taubin(P, lt, iters, lam=0.5, mu=-0.53):
    """Smooth a surface without shrinking it (Taubin's lambda/mu steps)."""
    n = len(P)
    i = np.concatenate([lt[:, 0], lt[:, 1], lt[:, 2], lt[:, 1], lt[:, 2], lt[:, 0]])
    j = np.concatenate([lt[:, 1], lt[:, 2], lt[:, 0], lt[:, 0], lt[:, 1], lt[:, 2]])
    A = sparse.csr_matrix((np.ones(len(i)), (i, j)), shape=(n, n))
    A.data[:] = 1.0
    deg = np.maximum(np.asarray(A.sum(axis=1)).ravel(), 1.0)[:, None]
    for _ in range(iters):
        P = P + lam * ((A @ P) / deg - P)
        P = P + mu * ((A @ P) / deg - P)
    return P


def _membrane(shell, lt, base, bn, lo, hi, iters):
    """Relax a shell like cloth: each point moves toward its neighbours' average
    along the skin's normal (filling hollows, flattening bumps), staying between
    lo and hi off the skin."""
    n = len(shell)
    i = np.concatenate([lt[:, 0], lt[:, 1], lt[:, 2], lt[:, 1], lt[:, 2], lt[:, 0]])
    j = np.concatenate([lt[:, 1], lt[:, 2], lt[:, 0], lt[:, 0], lt[:, 1], lt[:, 2]])
    A = sparse.csr_matrix((np.ones(len(i)), (i, j)), shape=(n, n))
    A.data[:] = 1.0
    deg = np.maximum(np.asarray(A.sum(axis=1)).ravel(), 1.0)
    edge = np.zeros(n, bool)
    for loop in _boundary_loops(lt):
        edge[loop] = True
    tang = np.where(edge, 0.0, 0.12)[:, None]
    for _ in range(iters):
        avg = (A @ shell) / deg[:, None]
        d = avg - shell
        dn = np.einsum("ij,ij->i", d, bn)
        shell = shell + bn * (0.7 * dn)[:, None] + (d - bn * dn[:, None]) * tang
        depth = np.einsum("ij,ij->i", shell - base, bn)
        shell = shell + bn * (np.clip(depth, lo, hi) - depth)[:, None]
    return shell


class Garment:
    """Vertices, triangles and skinning for one piece of cloth."""

    def __init__(self):
        self.pos, self.nrm, self.joints, self.weights, self.region, self.tris = [], [], [], [], [], []
        self.nofray = set()
        self.cover = np.zeros((0, 3), np.int64)     # body triangles (body vertex ids) this garment lies over

    def add_vertex(self, p, n, j, w, region="body"):
        self.pos.append(np.asarray(p, float))
        self.nrm.append(np.asarray(n, float))
        self.joints.append(np.asarray(j))
        self.weights.append(np.asarray(w, float))
        self.region.append(region)
        return len(self.pos) - 1

    def arrays(self):
        return (np.array(self.pos), np.array(self.nrm), np.array(self.joints, np.uint16),
                np.array(self.weights, np.float32), np.array(self.tris, np.int64))


class Fit:
    """Everything about one body a garment needs: rest mesh, weights, landmarks."""

    def __init__(self, body, sk, pos, nrm, tris, W=None):
        self.body, self.sk, self.pos, self.nrm, self.tris = body, sk, pos, nrm, tris
        self.S = mh.SCALE
        self.W = _weights_matrix(body, sk, len(pos)) if W is None else W
        self.top = np.argmax(self.W, axis=1)
        self.valid = np.zeros(len(pos), bool)
        self.valid[np.unique(tris)] = True
        self.top[~self.valid] = -1
        B = self.B = mh.BONE_INDEX
        H = sk["heads"]
        self.hips_y = float(H["Hips"][1])
        self.knee_y = float(H["LeftLeg"][1])
        self.ankle_y = float(H["LeftFoot"][1])
        self.neck_y = float(H["Neck"][1])
        self.spine1_y = float(H["Spine1"][1])
        self.cx, self.cz = float(H["Hips"][0]), float(H["Hips"][2])
        self.lx, self.rx = float(H["LeftUpLeg"][0]), float(H["RightUpLeg"][0])
        self.belt_y = self.hips_y + 0.55 * (self.spine1_y - self.hips_y)
        bset = lambda *names: {B[b] for b in names}
        self.g_torso = bset("Spine", "Spine1", "Spine2", "LeftShoulder", "RightShoulder")
        self.g_arms = bset("LeftArm", "RightArm")
        self.g_fore = bset("LeftForeArm", "RightForeArm")
        self.g_hands = {i for n, i in mh.BONE_INDEX.items() if "Hand" in n}
        self.g_thigh = bset("LeftUpLeg", "RightUpLeg")
        self.g_shin = bset("LeftLeg", "RightLeg")
        self.g_feet = bset("LeftFoot", "RightFoot")
        self.g_head = bset("Head", "Neck")
        # The crotch: lowest point of the pelvis between the legs.
        mid = (self.top == B["Hips"]) & (np.abs(pos[:, 0] - self.cx) < 0.04 * self.S)
        self.crotch_y = float(pos[mid, 1].min()) if mid.any() else self.hips_y - 0.08 * self.S
        self.vidx = np.where(self.valid)[0]
        self.tree = cKDTree(pos[self.vidx])

    def clear(self, P, lo):
        """Push points out of the skin to at least lo off the nearest surface."""
        for _ in range(3):
            _, i = self.tree.query(P)
            v = self.vidx[i]
            depth = np.einsum("ij,ij->i", P - self.pos[v], self.nrm[v])
            P = P + self.nrm[v] * np.maximum(lo - depth, 0.0)[:, None]
        return P

    def region_of(self, v):
        b = self.top[v]
        x = self.pos[v, 0]
        side = "L" if x < self.cx else "R"
        if b in self.g_arms | self.g_fore | self.g_hands:
            return side + "_arm"
        if b in self.g_thigh | self.g_shin | self.g_feet:
            return side + "_leg"
        if b in self.g_head:
            return "head"
        return "body"

    def in_groups(self, *groups):
        m = np.zeros(len(self.pos), bool)
        for g in groups:
            m |= np.isin(self.top, list(g))
        return m


def _shell(g, fit, vmask, lo, hi, iters, cut=None, open_face=False):
    """A membrane shell over the body vertices in vmask (lo/hi: per-vertex
    offsets off the skin). cut(centroids) -> bool keeps triangles."""
    t = fit.tris
    tm = np.all(vmask[t], axis=1)
    if cut is not None:
        tm &= cut(fit.pos[t].mean(axis=1))
    rt = t[tm]
    if open_face:
        S = fit.S
        brow = float(fit.sk["heads"]["Head"][1]) + 0.1 * S
        chin = float(fit.sk["heads"]["Head"][1]) - 0.01 * S
        c = fit.pos[rt].mean(axis=1)
        fn = fit.nrm[rt].mean(axis=1)
        hz = float(fit.sk["heads"]["Head"][2])
        # Whatever faces forward, and whatever lies in front of the head's
        # middle (eye sockets, the folds by the nose and mouth), is face.
        # (Up to the brow and no further: a cowl shades the forehead.)
        face = ((fn[:, 2] < -0.2) | (c[:, 2] < hz - 0.035 * S)) & (c[:, 1] < brow + 0.008 * S) & (c[:, 1] > chin - 0.03 * S)
        rt = rt[~face]
    if len(rt) == 0:
        return None
    verts = np.unique(rt)
    local = -np.ones(len(fit.pos), int)
    local[verts] = np.arange(len(verts))
    lt = local[rt]
    base, bn = fit.pos[verts], fit.nrm[verts]
    lo_v, hi_v = lo[verts], hi[verts]
    shell = _membrane(base + bn * lo_v[:, None], lt, base, bn, lo_v, hi_v, iters)
    # Clean edges: a cut along the body's triangles steps; smooth each open
    # edge into a curve (necklines, armholes, hems, plate edges).
    for loop in _boundary_loops(lt):
        L = np.array(loop)
        Q = shell[L]
        for _ in range(8):
            Q = Q * 0.5 + (np.roll(Q, 1, axis=0) + np.roll(Q, -1, axis=0)) * 0.25
        shell[L] = Q
    first = len(g.pos)
    for k, v in enumerate(verts):
        j, w = _top4(fit.W[v])
        g.add_vertex(shell[k], bn[k], j, w, fit.region_of(v))
    g.tris += [tuple(x) for x in (lt + first)]
    return first, verts, lt + first


def _drape(g, first, fit, y_stop, drop=0.3, slope=0.08, gather=True):
    """Cloth over the trunk hangs from its high points: no point on it sits
    further in toward the body's axis than the cloth just above it (less a
    little slope), down to the belt where it's gathered in."""
    P = np.array(g.pos[first:])
    reg = np.array(g.region[first:])
    S = fit.S
    idx = np.where((reg == "body") & (P[:, 1] > y_stop))[0]
    if len(idx) == 0:
        return
    Q = P[idx]
    dx, dz = Q[:, 0] - fit.cx, Q[:, 2] - fit.cz
    th = np.arctan2(dx, -dz)
    r = np.hypot(dx, dz)
    y = Q[:, 1]
    new_r = r.copy()
    order = np.argsort(-y)          # top down, so hanging carries on downward
    for k in order:
        dth = np.abs((th - th[k] + np.pi) % (2 * np.pi) - np.pi)
        above = (dth < 0.09) & (y > y[k]) & (y < y[k] + drop * S)
        if above.any():
            hang = (new_r[above] - slope * (y[above] - y[k])).max()
            # Gathered in toward the belt.
            f = float(_smoothstep(y_stop, y_stop + 0.13 * S, y[k])) if gather else 1.0
            new_r[k] = max(new_r[k], r[k] + (hang - r[k]) * f if hang > r[k] else r[k])
    scale = new_r / np.maximum(r, 1e-6)
    Q[:, 0] = fit.cx + dx * scale
    Q[:, 2] = fit.cz + dz * scale
    P[idx] = Q
    for k, p in enumerate(P):
        g.pos[first + k] = p


def _classify_edges(g, first, lt, fit, belt=True):
    """Necklines and edges tucked under the belt don't fray."""
    P = np.array(g.pos)
    for loop in _boundary_loops(lt):
        c = P[loop].mean(axis=0)
        if belt and abs(c[1] - fit.belt_y) < 0.06 * fit.S:
            g.nofray.update(loop)
        elif c[1] > fit.neck_y - 0.16 * fit.S and abs(c[0] - fit.cx) < 0.05 * fit.S:
            g.nofray.update(loop)


def _orient(g, t0, c):
    """Wind the triangles from t0 on so they face away from the vertical axis at c (xz)."""
    P = np.array(g.pos)
    T = np.array(g.tris[t0:])
    if len(T) == 0:
        return
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    out = P[T].mean(axis=1) - np.array([c[0], 0.0, c[1]])
    out[:, 1] = 0.0
    if np.einsum("ij,ij->i", fn, out).sum() < 0.0:
        g.tris[t0:] = [(a, cc, b) for a, b, cc in g.tris[t0:]]


def _body_pts(g):
    """The garment's own cloth over the trunk (not its sleeves)."""
    if not g.pos:
        return None
    P = np.array(g.pos)
    return P[np.array(g.region) == "body"]


def _support(pts, c, dirs):
    """Support function of points (xz) about c in each direction."""
    if len(pts) == 0:
        return None
    return ((pts - c) @ dirs.T).max(axis=0)


def _hang(g, fit, y_top, y_hem, off, flare, folds, amp, src_mask, weigh, cols=64, arc=None, hem_ragged=0.04,
          seed=0, extra_pts=None, centre=None, tight=False):
    """Cloth hanging from y_top to y_hem: each ring as wide as the widest body
    part above it, pleated, flared toward the hem. y_top may be a function of
    the angle (0 = front) for a top edge that isn't level. arc: None for a
    full ring or a list of (from, to) angle spans for flaps."""
    S = fit.S
    rng = np.random.default_rng(seed)
    c = np.array([fit.cx, fit.cz]) if centre is None else np.asarray(centre, float)
    pts_all = fit.pos[src_mask & fit.valid]
    if extra_pts is not None and len(extra_pts):
        pts_all = np.concatenate([pts_all, extra_pts])
    ph = rng.uniform(0, 6.28, 4)
    if arc is None:
        pieces = [(0.0, 2.0 * np.pi, True)]
    else:
        pieces = [(a0, a1, False) for a0, a1 in arc]
    made = []
    for a0, a1, closed in pieces:
        n = cols if closed else max(4, int(cols * (a1 - a0) / (2 * np.pi)) + 1)
        th = a0 + (a1 - a0) * np.arange(n) / (n if closed else n - 1)
        dirs = np.stack([np.sin(th), -np.cos(th)], axis=1)      # 0 = front (-z)
        y0 = np.asarray(y_top(th) if callable(y_top) else np.full(n, float(y_top)), float)
        span = float((y0 - y_hem).max())
        rings = max(4, int(span / (0.045 * S)) + 1)
        proj = (pts_all[:, [0, 2]] - c) @ dirs.T
        widest = None
        grid = []
        for r in range(rings):
            t = r / (rings - 1)
            yk = y0 + (y_hem - y0) * t
            near = np.abs(pts_all[:, 1][:, None] - yk[None, :]) < 0.03 * S
            h = np.where(near, proj, -np.inf).max(axis=0)
            missing = ~np.isfinite(h)
            if missing.all():
                h = widest.copy() if widest is not None else np.full(n, 0.1 * S)
            elif missing.any():
                h[missing] = (widest[missing] if widest is not None else h[~missing].mean())
            # Smooth around the ring so it drapes rather than follows each bump.
            if closed:
                h = (np.roll(h, 2) + np.roll(h, 1) * 2 + h * 3 + np.roll(h, -1) * 2 + np.roll(h, -2)) / 9.0
            widest = h if (widest is None or tight) else np.maximum(widest, h)
            wave = 0.7 * np.sin(folds * th + ph[0] + 0.8 * np.sin(2.0 * th + ph[2])) + 0.3 * np.sin(folds * 2.13 * th + ph[1])
            size = 0.65 + 0.35 * np.sin(0.5 * folds * th + ph[3])
            pleat = (1.0 - 2.0 * ((1.0 - wave) * 0.5) ** 1.4) * amp * size * (0.25 + 0.75 * t)
            rad = widest + off * S + flare * S * t * t + pleat * S
            ring_y = yk.copy()
            if r == rings - 1:
                ring_y -= hem_ragged * S * (0.5 + 0.5 * np.sin(folds * 0.7 * th + ph[2]) * np.sin(3.1 * th + ph[3]))
            elif r > 0:
                ring_y -= hem_ragged * S * t * t * 0.3 * (0.5 + 0.5 * np.sin(3.1 * th + ph[3]))
            xz = c + dirs * rad[:, None]
            grid.append(np.stack([xz[:, 0], ring_y, xz[:, 1]], axis=1))
        grid = np.array(grid)
        first = len(g.pos)
        for r in range(rings):
            for k in range(n):
                p = grid[r, k]
                j, w = weigh(p, r / (rings - 1))
                g.add_vertex(p, np.array([p[0] - c[0], 0.0, p[2] - c[1]]), j, w, "body")
        idx = lambda r, k: first + r * n + (k % n)
        kmax = n if closed else n - 1
        t0 = len(g.tris)
        for r in range(rings - 1):
            for k in range(kmax):
                a, b, cc, d = idx(r, k), idx(r, k + 1), idx(r + 1, k + 1), idx(r + 1, k)
                g.tris.append((a, d, b))
                g.tris.append((b, d, cc))
        _orient(g, t0, c)
        g.nofray.update(idx(0, k) for k in range(n))
        made.append((first, n, rings))
    return made


def _leg_weigher(fit, blend_top=0.06, shin=0.65, hips_keep=0.3):
    """Weights for cloth hanging over the legs: the body's own near the top,
    then the hips, then each thigh and shin by side."""
    B = fit.B
    nb = len(mh.BONE_NAMES)
    allowed = np.where(fit.in_groups(fit.g_torso, fit.g_thigh, fit.g_shin, {B["Hips"]}) & fit.valid)[0]
    tree = cKDTree(fit.pos[allowed])
    S = fit.S

    def weigh(p, t):
        _, i = tree.query(p)
        near = fit.W[allowed[i]].copy()
        y = p[1]
        f = float(_smoothstep(fit.crotch_y + blend_top * S, fit.crotch_y - 0.18 * S, y))
        if f <= 0.0:
            return _top4(near)
        u = np.clip((p[0] - fit.cx) / (fit.lx - fit.cx), -1.0, 1.0)
        fl = float(_smoothstep(0.0, 1.0, 0.5 + 0.5 * u))
        fs = shin * float(_smoothstep(fit.knee_y + 0.05 * S, fit.knee_y - 0.15 * S, y))
        hw = hips_keep * (1.0 - float(_smoothstep(fit.crotch_y, fit.knee_y, y)))
        legs = np.zeros(nb)
        legs[B["Hips"]] = hw
        rest = 1.0 - hw
        legs[B["LeftUpLeg"]] = rest * fl * (1.0 - fs)
        legs[B["LeftLeg"]] = rest * fl * fs
        legs[B["RightUpLeg"]] = rest * (1.0 - fl) * (1.0 - fs)
        legs[B["RightLeg"]] = rest * (1.0 - fl) * fs
        return _top4(near * (1.0 - f) + legs * f)
    return weigh


def _cape_weigher(fit):
    """A shoulder cape: the chest, and the upper arms at its sides."""
    B = fit.B
    allowed = np.where(fit.in_groups(fit.g_torso, fit.g_arms, {B["Neck"]}) & fit.valid)[0]
    tree = cKDTree(fit.pos[allowed])
    S = fit.S

    def weigh(p, t):
        _, i = tree.query(p)
        near = fit.W[allowed[i]].copy()
        side = abs(p[0] - fit.cx)
        fa = 0.55 * t * float(_smoothstep(0.1 * S, 0.24 * S, side))
        arm = np.zeros(len(mh.BONE_NAMES))
        arm[B["LeftArm"] if p[0] < fit.cx else B["RightArm"]] = fa
        arm[B["Spine2"]] = 1.0 - fa
        f = float(_smoothstep(0.0, 0.5, t))
        return _top4(near * (1.0 - f) + arm * f)
    return weigh


def _hug(pts, c, cols):
    """The outermost radius of the points (xz) in each of cols sectors about c
    (sector 0 faces front, -z), -inf where a sector is empty."""
    d = pts - c
    ang = np.arctan2(d[:, 0], -d[:, 1]) % (2.0 * np.pi)
    k = np.floor(ang / (2.0 * np.pi) * cols).astype(int) % cols
    out = np.full(cols, -np.inf)
    np.maximum.at(out, k, np.hypot(d[:, 0], d[:, 1]))
    return out


def _band(g, fit, y, height, thick, src_pts, round_=False, cols=64):
    """A belt around the waist, lying on whatever cloth is there: it follows
    the cloth into the hollows of the back and sides instead of spanning them."""
    S = fit.S
    c = np.array([fit.cx, fit.cz])
    th = 2.0 * np.pi * np.arange(cols) / cols
    dirs = np.stack([np.sin(th), -np.cos(th)], axis=1)
    slab = src_pts[np.abs(src_pts[:, 1] - y) < height * 0.9]
    hull = _support(slab[:, [0, 2]], c, dirs)
    h = _hug(slab[:, [0, 2]], c, cols)
    h = np.where(np.isfinite(h), h, hull)
    # Never dip below a neighbour's cloth (it would cut into it), then smooth.
    h = np.maximum(h, 0.5 * (np.roll(h, 1) + np.roll(h, -1)))
    h = (np.roll(h, 1) + h * 2 + np.roll(h, -1)) / 4.0 + 0.002 * S
    allowed = np.where(fit.in_groups(fit.g_torso, {fit.B["Hips"]}) & fit.valid)[0]
    tree = cKDTree(fit.pos[allowed])
    # Cross-section: a flat strap, or a round cord.
    if round_:
        prof = [(np.cos(a) * thick, np.sin(a) * height * 0.5) for a in np.linspace(0, 2 * np.pi, 7)[:-1]]
    else:
        prof = [(0.0, -height * 0.5), (thick, -height * 0.5), (thick, height * 0.5), (0.0, height * 0.5)]
    first = len(g.pos)
    t0 = len(g.tris)
    m = len(prof)
    for k in range(cols):
        for (dr, dy) in prof:
            r = h[k] + (thick if round_ else 0.0) + dr
            p = np.array([c[0] + dirs[k, 0] * r, y + dy, c[1] + dirs[k, 1] * r])
            _, i = tree.query(p)
            j, w = _top4(fit.W[allowed[i]])
            g.add_vertex(p, np.array([dirs[k, 0], 0.0, dirs[k, 1]]), j, w, "body")
    for k in range(cols):
        k2 = (k + 1) % cols
        for s in range(m if round_ else m - 1):
            s2 = (s + 1) % m
            a, b = first + k * m + s, first + k * m + s2
            cc, d = first + k2 * m + s2, first + k2 * m + s
            g.tris.append((a, b, cc))
            g.tris.append((a, cc, d))
    _orient(g, t0, c)
    g.nofray.update(range(first, len(g.pos)))


def _hem(fit, length):
    """Where a skirt ends: thigh, knee, calf or ankle (or metres above the floor)."""
    S = fit.S
    if not isinstance(length, str):
        return float(length) * S
    return {"thigh": fit.knee_y + 0.14 * S, "knee": fit.knee_y - 0.04 * S,
            "calf": 0.5 * (fit.knee_y + fit.ankle_y), "ankle": fit.ankle_y + 0.03 * S}[length]


def build(body, sk, pos, nrm, tris, kind, opts=None, W=None):
    """One garment over the body (game-space pos/nrm, body triangles).
    Returns [(Garment, part)] where part names a separate piece (a belt)."""
    opts = opts or {}
    fit = Fit(body, sk, pos, nrm, tris, W=W)
    S, B = fit.S, fit.B
    n = len(pos)
    g = Garment()
    parts = [(g, {})]
    y_belt = fit.belt_y
    # Near the armpits cloth can't bridge far, or it webs the arm to the body.
    arm_pts = pos[fit.in_groups(fit.g_arms, fit.g_fore)]
    near_arm = 1.0 - _smoothstep(0.03 * S, 0.1 * S, cKDTree(arm_pts).query(pos)[0]) if len(arm_pts) else np.zeros(n)
    ext = np.abs(nrm[:, 0])
    seed = opts.get("seed", 7)

    def offsets(off, bridge, belt=True, blouse=0.012):
        lo = np.full(n, off * S)
        hi = np.full(n, (off + bridge) * S) * (1.0 - 0.85 * near_arm) + off * S * 0.15
        hi = np.maximum(hi, lo)
        if belt:
            d = pos[:, 1] - y_belt
            cinch = 1.0 - _smoothstep(0.015 * S, 0.035 * S, np.abs(d))
            lo = lo * (1.0 - 0.45 * cinch)
            hi = np.minimum(hi, lo + 0.004 * S) * cinch + hi * (1.0 - cinch)
            puff = _smoothstep(0.02 * S, 0.05 * S, d) * (1.0 - _smoothstep(0.07 * S, 0.16 * S, d))
            lo = lo + blouse * S * puff
            hi = np.maximum(hi, lo)
        return lo, hi

    def torso_shell(off, bridge, sleeves, iters=60):
        m = fit.in_groups(fit.g_torso) | ((fit.top == B["Hips"]) & (pos[:, 1] > y_belt - 0.06 * S))
        # The tops of the shoulders, out to the joint, even without sleeves.
        sh = abs(float(sk["heads"]["LeftArm"][0]) - fit.cx)
        m |= fit.in_groups(fit.g_arms) & (np.abs(pos[:, 0] - fit.cx) < sh + 0.015 * S) & (pos[:, 1] > float(sk["heads"]["LeftArm"][1]) - 0.02 * S)
        if sleeves in ("short", "long"):
            m |= fit.in_groups(fit.g_arms)
        if sleeves == "long":
            m |= fit.in_groups(fit.g_fore)
        lo, hi = offsets(off, bridge)
        # Sleeves hang a little looser than they cling.
        arm = fit.in_groups(fit.g_arms, fit.g_fore)
        hi = np.where(arm, lo + 0.012 * S, hi)
        res = _shell(g, fit, m, lo, hi, iters, cut=lambda c: c[:, 1] > y_belt - 0.03 * S)
        if res:
            _drape(g, res[0], fit, y_belt + 0.02 * S)
            P = fit.clear(np.array(g.pos[res[0]:]), off * S * 0.7)
            for k, p in enumerate(P):
                g.pos[res[0] + k] = p
            _classify_edges(g, res[0], res[2], fit)
        return res

    def skirt(y_hem, off, flare, folds, amp, arc=None, ragged=0.04):
        src = fit.in_groups(fit.g_torso, fit.g_thigh, fit.g_shin, {B["Hips"]})
        _hang(g, fit, y_belt + 0.03 * S, y_hem, off, flare, folds, amp, src, _leg_weigher(fit), arc=arc,
              hem_ragged=ragged, seed=seed, extra_pts=_body_pts(g))

    def belt(round_=False, fabric="leather"):
        bg = Garment()
        own = _body_pts(g)
        pts = pos[fit.in_groups(fit.g_torso, {B["Hips"]})]
        if own is not None and len(own):
            pts = np.concatenate([own, pts])
        # Over the skirt's top edge, so the join is always under the belt.
        _band(bg, fit, y_belt + 0.014 * S, (0.024 if round_ else 0.046) * S, (0.008 if round_ else 0.006) * S, pts, round_=round_)
        parts.append((bg, {"fabric": fabric, "belt": True}))

    if kind == "tunic":
        torso_shell(0.014, 0.045, opts.get("sleeves", "long"))
        skirt(_hem(fit, opts.get("length", "thigh")), 0.012, 0.03, 10, 0.03)
        belt()
    elif kind == "robe":
        torso_shell(0.016, 0.05, "long")
        skirt(_hem(fit, opts.get("length", "ankle")), 0.014, 0.06, 12, 0.045, ragged=0.06)
        belt(round_=True, fabric="rope")
    elif kind == "shroud":
        torso_shell(0.012, 0.04, "none")
        skirt(_hem(fit, opts.get("length", "ankle")), 0.01, 0.03, 9, 0.035, ragged=0.08)
        belt(fabric="linen_strip")
    elif kind == "gambeson":
        torso_shell(0.03, 0.03, "long", iters=40)
        skirt(fit.crotch_y - 0.16 * S, 0.028, 0.04, 7, 0.008)
        belt()
    elif kind == "jerkin":
        torso_shell(0.016, 0.03, "none", iters=40)
        skirt(fit.crotch_y - 0.02 * S, 0.016, 0.02, 5, 0.004, ragged=0.015)
        belt()
    elif kind == "boots":
        # The shaft: soft leather up the calf.
        m = fit.in_groups(fit.g_shin) & (pos[:, 1] < fit.ankle_y + opts.get("height", 0.2) * S) & (pos[:, 1] > fit.ankle_y - 0.03 * S)
        lo = np.full(n, 0.007 * S)
        res = _shell(g, fit, m, lo, lo + 0.01 * S, 20)
        if res:
            _classify_edges(g, res[0], res[2], fit, belt=False)
            g.nofray.update(v for loop in _boundary_loops(res[2]) for v in loop
                            if np.array(g.pos)[loop, 1].mean() < fit.ankle_y + 0.02 * S)
        # The shoe: each foot's own hull, so it has a toe box and no toes.
        from scipy.spatial import ConvexHull
        for side in ("Left", "Right"):
            fm = fit.in_groups({B[side + "Foot"], B[side + "ToeBase"]}) & fit.valid & (pos[:, 1] < fit.ankle_y + 0.015 * S)
            ids = np.where(fm)[0]
            if len(ids) < 8:
                continue
            hull = ConvexHull(pos[ids])
            used = np.unique(hull.simplices)
            remap = -np.ones(len(ids), int)
            remap[used] = np.arange(len(used))
            T = remap[hull.simplices]
            P = pos[ids[used]].copy()
            c = P.mean(axis=0)
            # Wind every face outward.
            fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
            flip = np.einsum("ij,ij->i", fn, P[T].mean(axis=1) - c) < 0
            T[flip] = T[flip][:, [0, 2, 1]]
            # Open at the ankle, where the shaft comes down over it.
            fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
            fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-9)
            top = (fn[:, 1] > 0.75) & (P[T].mean(axis=1)[:, 1] > fit.ankle_y - 0.02 * S)
            T = T[~top]
            Nv = mh.vertex_normals(P, T)
            P = P + Nv * 0.004 * S
            first = len(g.pos)
            for k, v in enumerate(ids[used]):
                j, w = _top4(fit.W[v])
                g.add_vertex(P[k], Nv[k], j, w, side[0] + "_leg")
            g.tris += [tuple(t) for t in (T + first)]
            g.nofray.update(range(first, len(g.pos)))
    elif kind in ("hose", "breeches"):
        m = fit.in_groups(fit.g_thigh, fit.g_shin) | ((fit.top == B["Hips"]) & (pos[:, 1] < y_belt + 0.01 * S))
        if kind == "hose":
            m &= pos[:, 1] > fit.ankle_y + 0.03 * S
            lo = np.full(n, 0.006 * S)
            hi = lo + 0.004 * S
            iters = 10
        else:
            m &= pos[:, 1] > fit.knee_y - 0.1 * S
            lo = np.full(n, 0.014 * S)
            hi = lo + 0.02 * S * (1.0 - 0.6 * _smoothstep(0.45, 0.8, ext))
            iters = 40
        res = _shell(g, fit, m, lo, hi, iters, cut=lambda c: c[:, 1] < y_belt + 0.005 * S)
        if res:
            _classify_edges(g, res[0], res[2], fit)
    elif kind == "loincloth":
        m = (fit.top == B["Hips"]) & (pos[:, 1] < y_belt + 0.01 * S)
        m |= fit.in_groups(fit.g_thigh) & (pos[:, 1] > fit.crotch_y - 0.05 * S)
        lo = np.full(n, 0.007 * S)
        res = _shell(g, fit, m, lo, lo + 0.01 * S, 20, cut=lambda c: c[:, 1] < y_belt + 0.005 * S)
        if res:
            _classify_edges(g, res[0], res[2], fit)
        flap = opts.get("flap", 0.34)
        skirt(fit.crotch_y - flap * S, 0.012, 0.02, 4, 0.006, arc=[(-0.42, 0.42), (np.pi - 0.5, np.pi + 0.5)],
              ragged=0.05)
        belt(round_=True, fabric="rope")
    elif kind == "hood":
        m = fit.in_groups(fit.g_head) | (fit.in_groups(fit.g_torso) & (pos[:, 1] > fit.neck_y - 0.05 * S))
        hc = sk["heads"]["Head"]
        top_y = float(pos[fit.in_groups(fit.g_head), 1].max())
        # Loose over the crown, hanging off the back of the head.
        back = _smoothstep(-0.02 * S, 0.08 * S, pos[:, 2] - hc[2])
        crown = _smoothstep(hc[1] + 0.06 * S, top_y, pos[:, 1])
        # Cloth, not a cap: it stands off the skull, fullest over the crown
        # and at the back (a hood hugging the head read as a bald scalp).
        lo = 0.03 * S + 0.022 * S * back + 0.016 * S * crown
        hi = lo + 0.05 * S * back + 0.02 * S
        res = _shell(g, fit, m, lo, hi, 50, open_face=True)
        if res:
            first, verts, lt = res
            # Pulled up and back into a point behind the crown.
            P = np.array(g.pos[first:])
            w = _smoothstep(top_y - 0.07 * S, top_y + 0.01 * S, P[:, 1]) * _smoothstep(hc[2] - 0.02 * S, hc[2] + 0.07 * S, P[:, 2])
            P = P + w[:, None] ** 1.5 * np.array([0.0, 0.012, 0.095]) * S
            # Folds falling from the crown round the sides and back to the
            # neck (none over the face): ridges and hollows in the cloth.
            rng = np.random.default_rng(opts.get("seed", 7))
            ph = rng.uniform(0.0, 6.28)
            ang = np.arctan2(P[:, 0] - hc[0], P[:, 2] - hc[2])
            radial = np.stack([P[:, 0] - hc[0], np.zeros(len(P)), P[:, 2] - hc[2]], axis=1)
            radial /= np.maximum(np.linalg.norm(radial, axis=1, keepdims=True), 1e-6)
            sides = _smoothstep(hc[2] - 0.06 * S, hc[2] + 0.01 * S, P[:, 2])
            fall = 1.0 - _smoothstep(hc[1] + 0.02 * S, top_y - 0.01 * S, P[:, 1])
            fold = np.sin(ang * 8.0 + 1.8 * np.sin(ang * 3.0 + ph) + ph)
            P = P + radial * (fold * 0.012 * S * sides * fall)[:, None]
            for k, p in enumerate(P):
                g.pos[first + k] = p
            P = np.array(g.pos)
            for loop in _boundary_loops(lt):
                if P[loop, 1].mean() > fit.neck_y:
                    g.nofray.update(loop)      # the face opening: a rolled edge
        # The shoulder cape beneath it, resting on the shoulders.
        sh = abs(float(sk["heads"]["LeftArm"][0]) - fit.cx)
        src = fit.in_groups(fit.g_torso) | (fit.in_groups(fit.g_arms) & (np.abs(pos[:, 0] - fit.cx) < sh + 0.05 * S))
        _hang(g, fit, fit.neck_y - 0.03 * S, fit.neck_y - 0.24 * S, 0.016, 0.042, 9, 0.022, src, _cape_weigher(fit),
              hem_ragged=0.04, seed=seed + 3, centre=(fit.cx, float(sk["heads"]["Neck"][2])))
    return parts if g.pos else [p for p in parts if p[0].pos]


def _tube_uv(p, region, fit_axes):
    o, ax, e1 = fit_axes[region]
    r = p - o
    along = r @ ax
    rp = r - np.outer(along, ax) if r.ndim == 2 else r - along * ax
    e2 = np.cross(ax, e1)
    ang = np.arctan2(rp @ e2, rp @ e1)
    rad = np.linalg.norm(rp, axis=-1)
    return ang, rad, along


def axes(sk):
    """Per-region tube frames: origin, axis, zero-angle direction. The wrap
    (±pi) lands on the seams: centre back, under the arms, inside the legs."""
    H = sk["heads"]
    up = np.array([0.0, 1.0, 0.0])
    # (tube seam at the character's LEFT side: the centre back and centre front stay in one piece for logos and zips)
    out = {"body": (H["Hips"] * np.array([1, 0, 1]), -up, np.array([1.0, 0.0, 0.0])),
           "head": (H["Head"] * np.array([1, 0, 1]), -up, np.array([0.0, 0.0, -1.0]))}
    for side, arm, hand, leg, foot in (("L", "LeftArm", "LeftHand", "LeftUpLeg", "LeftFoot"),
                                       ("R", "RightArm", "RightHand", "RightUpLeg", "RightFoot")):
        a = H[hand] - H[arm]
        a = a / np.linalg.norm(a)
        e1 = up - a * (up @ a)
        out[side + "_arm"] = (H[arm], a, e1 / np.linalg.norm(e1))
        a = H[foot] - H[leg]
        a = a / np.linalg.norm(a)
        side_dir = np.array([np.sign(H[leg][0] - H["Hips"][0]) or 1.0, 0.0, 0.0])
        e1 = side_dir - a * (side_dir @ a)
        out[side + "_leg"] = (H[leg], a, e1 / np.linalg.norm(e1))
    return out


def finish(g, height, sk, quilt=0.0, edge_scale=0.12, armour=None):
    """Normals, hem distances, seam-split tube UVs; returns glTF-ready arrays."""
    pos, nrm, joints, weights, tris = g.arrays()
    nrm = mh.vertex_normals(pos, tris)
    # Face the cloth outward (hanging rings are wound either way).
    loops = _boundary_loops(tris)
    # Distance to the nearest fraying edge, over the mesh.
    edge_v = {v for l in loops for v in l} - g.nofray
    dist = np.full(len(pos), 1e9)
    for v in edge_v:
        dist[v] = 0.0
    adj = [[] for _ in range(len(pos))]
    for a, b, c in tris:
        adj[a] += [b, c]
        adj[b] += [a, c]
        adj[c] += [a, b]
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
    hem = np.clip(dist / edge_scale, 0.0, 1.0)
    # Tube UVs per body part; triangles take their majority region, and
    # vertices on a seam (or the wrap) are split.
    frames = axes(sk)
    region = np.array(g.region)
    new_pos, new_idx, keymap, src = [], [], {}, []
    uvs = []
    for t in tris:
        regs = region[t]
        vals, cnt = np.unique(regs, return_counts=True)
        rg = vals[np.argmax(cnt)]
        ang, rad, along = _tube_uv(pos[t], rg, frames)
        a0 = ang[0]
        ang = a0 + (ang - a0 + np.pi) % (2 * np.pi) - np.pi
        R = 0.07 if rg.endswith("_arm") else (0.09 if rg.endswith("_leg") else None)
        rr = np.full(3, R) if R else np.maximum(rad, 0.1)
        # Faces turned up (a crown, the tops of the shoulders) would pinch
        # on a tube: project them from above instead.
        fn = np.cross(pos[t[1]] - pos[t[0]], pos[t[2]] - pos[t[0]])
        up_face = rg in ("head", "body") and abs(fn[1]) > 0.72 * max(np.linalg.norm(fn), 1e-12)
        face = []
        for k in range(3):
            if up_face:
                uv = (float(pos[t[k], 0]), float(pos[t[k], 2]))
                key = (int(t[k]), rg + "_top", round(uv[0], 4), round(uv[1], 4))
                if key not in keymap:
                    keymap[key] = len(src)
                    src.append(int(t[k]))
                    uvs.append(uv)
                face.append(keymap[key])
                continue
            uv = (float(ang[k] * rr[k]), float(-along[k] if rg != "body" and rg != "head" else -pos[t[k], 1]))
            key = (int(t[k]), rg, round(uv[0], 4), round(uv[1], 4))
            if key not in keymap:
                keymap[key] = len(src)
                src.append(int(t[k]))
                uvs.append(uv)
            face.append(keymap[key])
        new_idx.append(face)
    src = np.array(src)
    idx = np.array(new_idx, np.int64)
    col = np.zeros((len(src), 4), np.float32)
    if armour is None:
        col[:, 0] = hem[src]
        col[:, 1] = quilt
    else:
        col[:, 0] = 1.0 - hem[src]      # plate edges, rubbed bright
        col[:, 1] = armour
    col[:, 2] = np.clip(pos[src, 1] / max(height, 1e-6), 0.0, 1.0)
    return dict(pos=pos[src], nrm=nrm[src], uv=np.array(uvs, float), joints=joints[src], weights=weights[src],
                idx=idx.reshape(-1).astype(np.uint32), color=col, uv2=np.stack([pos[src, 0], pos[src, 2]], axis=1))

"""Unique wear-atlas bake for the enemy_b vehicles (opt-in: Model(..., bake=True); the boss keeps the legacy tiling path).

Pipeline (numpy + mathutils BVH, deterministic):
 1. charts   every primitive is split into planar-ish charts (faces binned by dominant signed axis -> connected components);
             tiny primitives (rivets, bolts, weld beads, small brackets) become ONE chart projected along their mean normal.
             Vertical charts are oriented so atlas-down == world-down (rust / grime streaks run down in texture space).
 2. packing  one atlas PER MATERIAL (keeps the runtime far-LOD average colour of every material right), shelf packed with column stacking,
             smallest pow2 atlas holding ~85 % of the target density; enclosed charts get less density (visibility rays).
 3. raster   world position + smooth normal + chart id per texel; Cycles bakes AO (1 m) + cavity (7 cm) at half resolution.
 4. masks    convex-edge distance (per primitive), weld heat, rust streak sources smeared downward, height dirt + wheel spray,
             dust on up-facing faces, road-dust film, scratches, 3D value noise.
 5. recipes  per material 'smart material' -> albedo (sRGB) + roughness + metalness (paint/paint2 stay grayscale: runtime tint).
 6. padding  charts are dilated into their gutters, images are written, vmat builds UV1-mapped materials
             (albedo + ORM on TEXCOORD_1, clean tiling detail normal map on TEXCOORD_0).
"""
import math
import os
import time
import zlib
import numpy as np
from mathutils.bvhtree import BVHTree  # noqa  (bpy side)
import vmat

NO_BAKE = {'glass', 'glass_lens', 'light_head', 'light_tail', 'light_amber'}
DEFAULTS = dict(
    dens=210.0,          # target texels per metre
    dens_max=1.25,       # allowed up-scaling of the density to fill a pow2 atlas
    margin=3,            # gutter (px) around every chart
    max_size={'paint': (2048, 1024), 'paint2': (1024, 1024), 'armor': (2048, 1024), 'metal_dark': (1024, 1024)},
    max_default=(1024, 512),
    dens_floor=0.85,     # accept a smaller atlas when it still holds 85 % of the target density
    mat_dens={'rubber_tire': 0.8, 'interior': 0.6, 'fabric': 0.6, 'leather': 0.6, 'metal_dark': 0.85},
    ao_rays=12, ao_dist=1.0, cav_dist=0.07,
    dirt_h=1.0,          # height (m) below which road dirt builds up
    rust=1.0,            # global rust amount
    wear=1.0,            # global edge wear / chipping amount
    dirt=1.0,
    seed=7,
    orm_half=True,
    wheels=[],           # hub positions (x, y, z, R) for spray
    scale=1.0,           # world scale of the wear patterns (noise size, edge-wear width, streak length, weld heat rings): >1 for huge rigs
    heat_spots=[],       # (x, y, z, radius): soot + heat tint around thrusters / flame nozzles / stack tops
    dens_fn=None,        # f(centre, normal) -> texel density multiplier per chart (hero faces)
    shelf_window=0,      # >0: first-fit only over the last N shelves (fast packing for tens of thousands of charts)
    recipes={},          # material -> recipe name override
    look_recipes={},     # look (material asked for before aliasing) -> recipe name override
)
SMALL = 0.085            # primitives smaller than this (m) get a single chart


# =========================================================================================== noise (3D value noise, uint32 hash)
_LAT = {}
_LN = 128


def _lattice(seed):
    L = _LAT.get(seed)
    if L is None:
        L = np.random.default_rng(seed * 7919 + 13).random(_LN ** 3).astype(np.float32)
        _LAT[seed] = L
    return L


def vnoise(P, freq, seed=0):
    """P (n,3) -> (n,) in [0,1] value noise from a 128^3 random lattice (trilinear, smoothstep).  freq: scalar or (fx, fy, fz)."""
    L = _lattice(seed % 64)
    f = np.asarray(freq, np.float32)
    off = np.float32(37.0 + (seed * 13.7) % 97)
    p = P.astype(np.float32) * f + off
    i = np.floor(p)
    t = p - i
    t = t * t * (3 - 2 * t)
    i = i.astype(np.int64)
    m = _LN - 1
    x0 = i[:, 0] & m; x1 = (x0 + 1) & m
    y0 = (i[:, 1] & m) * _LN; y1 = ((i[:, 1] + 1) & m) * _LN
    z0 = (i[:, 2] & m) * (_LN * _LN); z1 = ((i[:, 2] + 1) & m) * (_LN * _LN)
    tx, ty, tz = t[:, 0], t[:, 1], t[:, 2]
    a = L[x0 + y0 + z0]; b = L[x1 + y0 + z0]
    c00 = a + (b - a) * tx
    a = L[x0 + y1 + z0]; b = L[x1 + y1 + z0]
    c10 = a + (b - a) * tx
    a = L[x0 + y0 + z1]; b = L[x1 + y0 + z1]
    c01 = a + (b - a) * tx
    a = L[x0 + y1 + z1]; b = L[x1 + y1 + z1]
    c11 = a + (b - a) * tx
    c0 = c00 + (c10 - c00) * ty
    c1 = c01 + (c11 - c01) * ty
    return c0 + (c1 - c0) * tz


def fbm(P, freq, octaves=4, seed=0, gain=0.5, lac=2.03):
    f = np.asarray(freq, np.float32)
    out = np.zeros(len(P), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * vnoise(P, f, seed + o * 101)
        tot += amp
        amp *= gain
        f = f * lac
    return out / tot


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = np.asarray(t, np.float32)
    if t.ndim == 1 and (np.ndim(a) == 2 or np.ndim(b) == 2):
        t = t[:, None]
    return a * (1 - t) + b * t


def col(c, n):
    return np.broadcast_to(np.asarray(c, np.float32), (n, 3)).copy()


# =========================================================================================== charts
class Chart:
    __slots__ = ('obj', 'mat', 'mi', 'pid', 'corners', 'u', 'v', 'n', 'mult', 'umin', 'vmin', 'du', 'dv', 'w', 'h', 'x', 'y', 'dens',
                 'faces', 'fn', 'small', 'kind', 'shared', 'vert')


def _basis(n):
    n = n / max(np.linalg.norm(n), 1e-9)
    if abs(n[1]) < 0.8:
        tu = np.cross((0.0, 1.0, 0.0), n)
    else:
        tu = np.array((1.0, 0.0, 0.0)) - n * n[0]
    tu = tu / max(np.linalg.norm(tu), 1e-9)
    tv = np.cross(n, tu)
    return n, tu, tv


def _components(faces, F):
    parent = {f: f for f in faces}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    owner = {}
    for f in faces:
        for v in F[f]:
            o = owner.get(v)
            if o is None:
                owner[v] = f
            else:
                a, b = find(f), find(o)
                if a != b:
                    parent[a] = b
    comps = {}
    for f in faces:
        comps.setdefault(find(f), []).append(f)
    return list(comps.values())


def build_charts(m, data, opts):
    charts = []
    for name, d in data.items():
        V, F, nf, area, MI, PI = d['V'], d['F'], d['nf'], d['area'], d['MI'], d['PI']
        lens = d['lens']
        starts = np.cumsum(lens) - lens
        d['starts'] = starts
        keys = MI.astype(np.int64) * 100000000 + (PI + 1)
        order = np.argsort(keys, kind='stable')
        ks = keys[order]
        cuts = np.flatnonzero(np.diff(ks)) + 1
        for g in np.split(order, cuts):
            mi = int(MI[g[0]])
            mat = d['mats'][mi]
            if mat in NO_BAKE:
                continue
            pid = int(PI[g[0]])
            kind, shape, look = m.pkind[pid] if 0 <= pid < len(m.pkind) else ('part', 'hard', None)
            gl = g.tolist()
            vids = np.unique(np.concatenate([np.asarray(F[f]) for f in gl]))
            ext = V[vids].max(0) - V[vids].min(0)
            small = kind in ('rivet', 'weld') or ext.max() < SMALL
            comps = []
            if small:
                ws = (nf[g] * area[g][:, None]).sum(0)
                if np.linalg.norm(ws) < 0.3 * area[g].sum():
                    ws = nf[g[np.argmax(area[g])]]
                comps.append((gl, ws))
            else:
                ax = np.argmax(np.abs(nf[g]), axis=1)
                sg = nf[g, ax] < 0
                b = ax * 2 + sg
                for bv in np.unique(b):
                    fs = g[b == bv].tolist()
                    for comp in _components(fs, F):
                        ca = np.asarray(comp)
                        ws = (nf[ca] * area[ca][:, None]).sum(0)
                        if np.linalg.norm(ws) < 0.55 * area[ca].sum():
                            axv = np.zeros(3); axv[bv // 2] = -1.0 if bv % 2 else 1.0
                            ws = axv
                        comps.append((comp, ws))
            for comp, ws in comps:
                n, tu, tv = _basis(np.asarray(ws, np.float64))
                if small:        # front-most faces rasterize last (they win overlaps)
                    comp = sorted(comp, key=lambda f: float(nf[f] @ n))
                cidx = np.concatenate([np.arange(starts[f], starts[f] + lens[f]) for f in comp])
                pv = V[d['Fflat'][cidx]]
                c = Chart()
                c.obj, c.mat, c.mi, c.pid, c.kind, c.small, c.shared = name, mat, mi, pid, kind, small, d['shared']
                c.faces = comp
                c.corners = cidx
                c.u = pv @ tu
                c.v = pv @ tv
                c.n = n
                c.vert = abs(n[1]) < 0.55
                mult = 1.0
                if kind == 'under' or n[1] < -0.6:
                    mult = 0.4
                elif kind == 'inner':
                    mult = 0.5
                elif kind == 'hero':
                    mult = 1.3
                c.mult = mult * opts['mat_dens'].get(mat, 1.0)
                if opts.get('dens_fn') is not None:
                    c.mult *= opts['dens_fn'](pv.mean(0), n)
                c.umin, c.vmin = float(c.u.min()), float(c.v.min())
                c.du, c.dv = float(c.u.max() - c.umin), float(c.v.max() - c.vmin)
                charts.append(c)
    return charts


def visibility(charts, data, bvh, rays=7):
    """scale down the texel density of enclosed charts (inner faces of plates, covered surfaces): few rays from face centres along the normal"""
    dirs = _dirs(rays)
    rng = np.random.default_rng(3)
    hidden = 0
    for c in charts:
        if c.shared or c.small:
            continue
        d = data[c.obj]
        faces = c.faces if len(c.faces) <= 3 else [c.faces[i] for i in rng.choice(len(c.faces), 3, replace=False)]
        n = c.n
        ref = np.array([0.0, 1.0, 0.0]) if abs(n[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
        T = np.cross(ref, n); T /= np.linalg.norm(T); B = np.cross(n, T)
        esc = 0; tot = 0
        for f in faces:
            vids = d['F'][f]
            p = d['V'][list(vids)].mean(0) + n * 0.01
            for k in range(rays):
                dv = T * dirs[k, 0] + B * dirs[k, 1] + n * dirs[k, 2]
                hit = bvh.ray_cast(tuple(p), tuple(dv), 2.5)[0]
                esc += hit is None
                tot += 1
        op = esc / max(tot, 1)
        if op < 0.35:
            c.mult *= 0.35 + 0.65 * (op / 0.35)
            hidden += 1
    print('[bake] visibility: %d of %d charts enclosed (density reduced)' % (hidden, len(charts)))


# =========================================================================================== packing
def _sizes(charts, dens, margin):
    for c in charts:
        c.dens = dens * c.mult
        c.w = int(math.ceil(c.du * c.dens)) + 1 + 2 * margin
        c.h = int(math.ceil(c.dv * c.dens)) + 1 + 2 * margin


_WIN = [0]


def _shelf(charts, W, dens, margin):
    """shelf packing with column stacking: short charts stack inside the columns of taller shelves (first fit)"""
    _sizes(charts, dens, margin)
    win = _WIN[0]
    order = sorted(charts, key=lambda c: (-c.h, -c.w))
    shelves = []                    # [y, h, x_end, cols]  cols: [x, w, used_h]
    ytop = 0
    for c in order:
        if c.w > W:
            return None
        placed = False
        for sh in (shelves[-win:] if win else shelves):
            if c.h > sh[1]:
                continue
            for col in sh[3]:
                if c.w <= col[1] and col[2] + c.h <= sh[1]:
                    c.x, c.y = col[0], sh[0] + col[2]
                    col[2] += c.h
                    placed = True
                    break
            if placed:
                break
            if sh[2] + c.w <= W:
                c.x, c.y = sh[2], sh[0]
                sh[3].append([sh[2], c.w, c.h])
                sh[2] += c.w
                placed = True
                break
        if not placed:
            c.x, c.y = 0, ytop
            shelves.append([ytop, c.h, c.w, [[0, c.w, c.h]]])
            ytop += c.h
    return ytop


def _pow2(x, lo=32):
    p = lo
    while p < x:
        p *= 2
    return p


def _max_wh(opts, mat):
    v = opts['max_size'].get(mat, opts['max_default'])
    return (v, v) if isinstance(v, int) else tuple(v)


def pack(charts, opts, mat):
    """pick the smallest pow2 atlas (W >= H) that holds the charts at >= floor * target density, then use the largest density that fits"""
    margin = opts['margin']
    _WIN[0] = opts.get('shelf_window', 0)
    mxW, mxH = _max_wh(opts, mat)
    target = opts['dens']
    floor = opts.get('dens_floor', 0.85)
    hi_cap = target * opts['dens_max']
    area1 = sum((c.du * c.mult + (3 + 2 * margin) / target) * (c.dv * c.mult + (3 + 2 * margin) / target) for c in charts)   # m^2 at unit density
    cands = []
    W = 64
    while W <= mxW:
        for H in (W // 2, W):
            if 32 <= H <= mxH:
                cands.append((W * H, W, H))
        W *= 2
    cands.sort()

    def best_d(W, H, lo, hi):
        if _shelf(charts, W, lo, margin) is None or _shelf(charts, W, lo, margin) > H:
            return None
        for _ in range(9):
            mid = (lo + hi) * 0.5
            h = _shelf(charts, W, mid, margin)
            if h is not None and h <= H:
                lo = mid
            else:
                hi = mid
        return lo
    choice = None
    for (A, W, H) in cands:
        if area1 * (target * floor) ** 2 > A * 0.95:            # cannot fit even perfectly packed
            continue
        d = best_d(W, H, target * floor * 0.5, hi_cap)
        if d is not None and d >= target * floor:
            choice = (W, H, d)
            break
    if choice is None:                                         # largest allowed atlas, whatever density fits
        A, W, H = cands[-1]
        d = best_d(W, H, 1.0, hi_cap)
        choice = (W, H, d if d else 1.0)
    W, H, dens = choice
    _shelf(charts, W, dens, margin)
    return W, H, dens


# =========================================================================================== raster
def raster(charts, data, W, H, margin):
    P = np.zeros((H, W, 3), np.float32)
    N = np.zeros((H, W, 3), np.float32)
    CID = np.full((H, W), -1, np.int32)
    for ci, c in enumerate(charts):
        d = data[c.obj]
        ox, oy = c.x + margin + 0.5, c.y + margin + 0.5
        px = ox + (c.u - c.umin) * c.dens
        py = oy + (c.vmin + c.dv - c.v) * c.dens
        d['uv1'][c.corners, 0] = px / W
        d['uv1'][c.corners, 1] = 1.0 - py / H
        V = d['V']; Ff = d['Fflat']; cn = d['cn']
        k = 0
        for f in c.faces:
            L = int(d['lens'][f])
            s0 = int(d['starts'][f])
            X = px[k:k + L]; Yv = py[k:k + L]
            vi = Ff[s0:s0 + L]
            for t in range(1, L - 1):
                ids = (0, t, t + 1)
                x0, x1, x2 = X[0], X[t], X[t + 1]
                y0, y1, y2 = Yv[0], Yv[t], Yv[t + 1]
                den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
                if abs(den) < 1e-9:
                    continue
                xa = max(int(math.floor(min(x0, x1, x2) - 0.5)), 0)
                xb = min(int(math.ceil(max(x0, x1, x2) - 0.5)), W - 1)
                ya = max(int(math.floor(min(y0, y1, y2) - 0.5)), 0)
                yb = min(int(math.ceil(max(y0, y1, y2) - 0.5)), H - 1)
                if xb < xa or yb < ya:
                    continue
                gx, gy = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
                w0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / den
                w1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / den
                w2 = 1.0 - w0 - w1
                ins = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
                if not ins.any():
                    continue
                yy, xx = np.nonzero(ins)
                a0, a1, a2 = w0[ins][:, None], w1[ins][:, None], w2[ins][:, None]
                p = V[vi[0]] * a0 + V[vi[t]] * a1 + V[vi[t + 1]] * a2
                nn = cn[s0] * a0 + cn[s0 + t] * a1 + cn[s0 + t + 1] * a2
                P[yy + ya, xx + xa] = p
                N[yy + ya, xx + xa] = nn
                CID[yy + ya, xx + xa] = ci
            k += L
    nl = np.linalg.norm(N, axis=2, keepdims=True)
    N /= np.maximum(nl, 1e-6)
    return P, N, CID


# =========================================================================================== masks
def _dirs(k):
    out = []
    for i in range(k):
        u = (i + 0.5) / k
        phi = i * 2.399963
        r = math.sqrt(u)
        out.append((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0.0, 1 - u))))
    return np.array(out, np.float64)


def _shift(a, dy, dx, fill):
    out = np.full_like(a, fill)
    H, W = a.shape[:2]
    ys0, ys1 = max(dy, 0), H + min(dy, 0)
    xs0, xs1 = max(dx, 0), W + min(dx, 0)
    out[ys0:ys1, xs0:xs1] = a[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return out


def sharp_edges(m, d):
    """per primitive id -> (A, B) arrays of convex 'wear' edge segments (hard dihedral > 24 deg, round shapes > 55 deg, sheet borders)."""
    V, nf, PI = d['V'], d['nf'], d['PI']
    Ff, lens = d['Fflat'], d['lens']
    starts = np.cumsum(lens) - lens
    cf = np.repeat(np.arange(len(lens)), lens)
    k = np.arange(len(Ff)) - starts[cf]
    nxt = starts[cf] + (k + 1) % lens[cf]
    a, b = Ff, Ff[nxt]
    lo, hi = np.minimum(a, b), np.maximum(a, b)
    key = lo * (len(V) + 1) + hi
    o = np.argsort(key, kind='stable')
    ks = key[o]
    first = np.r_[True, ks[1:] != ks[:-1]]
    grp_start = np.flatnonzero(first)
    grp_cnt = np.diff(np.r_[grp_start, len(ks)])
    cent = np.zeros((len(lens), 3))
    for c in range(3):
        cent[:, c] = np.bincount(cf, weights=V[Ff][:, c], minlength=len(lens)) / lens
    out = {}
    thr_h, thr_r = math.cos(24 * math.pi / 180), math.cos(55 * math.pi / 180)
    for gs, gc in zip(grp_start, grp_cnt):
        e = o[gs]
        f1 = cf[e]
        A, Bp = V[a[e]], V[b[e]]
        pid = int(PI[f1])
        if gc == 1:
            convex = True; sharp = True
        elif gc == 2:
            f2 = cf[o[gs + 1]]
            cs = float(nf[f1] @ nf[f2])
            shape = m.pkind[pid][1] if 0 <= pid < len(m.pkind) else 'hard'
            sharp = cs < (thr_r if shape == 'round' else thr_h)
            mid = (A + Bp) * 0.5
            convex = float((cent[f2] - mid) @ nf[f1]) < 1e-5
        else:
            continue
        if sharp and convex and not (0 <= pid < len(m.pkind) and m.pkind[pid][0] == 'rivet'):
            out.setdefault(pid, []).append((A, Bp))
    return {p: (np.array([x[0] for x in L]), np.array([x[1] for x in L])) for p, L in out.items()}


def seg_dist(Pt, A, B):
    D = B - A
    L2 = max(float(D @ D), 1e-12)
    t = np.clip(((Pt - A) @ D) / L2, 0, 1)
    C = A + t[:, None] * D
    return np.linalg.norm(Pt - C, axis=1), t * math.sqrt(L2)


class Grid:
    """hash grid over texel positions for splats"""
    def __init__(self, P, cell):
        self.cell = cell
        q = np.floor(P / cell).astype(np.int64) + (1 << 20)
        key = (q[:, 0] << 42) | (q[:, 1] << 21) | q[:, 2]
        self.o = np.argsort(key, kind='stable')
        ks = key[self.o]
        first = np.r_[True, ks[1:] != ks[:-1]]
        st = np.flatnonzero(first)
        cnt = np.diff(np.r_[st, len(ks)])
        self.map = dict(zip(ks[st].tolist(), zip(st.tolist(), cnt.tolist())))

    def near(self, p, r):
        lo = np.floor((np.asarray(p) - r) / self.cell).astype(np.int64) + (1 << 20)
        hi = np.floor((np.asarray(p) + r) / self.cell).astype(np.int64) + (1 << 20)
        out = []
        for ix in range(lo[0], hi[0] + 1):
            for iy in range(lo[1], hi[1] + 1):
                for iz in range(lo[2], hi[2] + 1):
                    v = self.map.get((ix << 42) | (iy << 21) | iz)
                    if v:
                        out.append(self.o[v[0]:v[0] + v[1]])
        return np.concatenate(out) if out else np.zeros(0, np.int64)


# =========================================================================================== material recipes
# every recipe gets S (dict of per-texel masks for this material's texels) and returns rgb (n,3 sRGB), rough (n,), metal (n,)
def _common(S):
    return S['n'], S['ao'], S['cav'], S['dirt'], S['dust'], S['ew'], S['streak'], S['heat']


DUST_COL = (0.56, 0.48, 0.38)


def _film(S):
    """thin warm road-dust film on exterior surfaces (strongest low down and on open faces)"""
    ext = np.clip(1.0 - S['ao'] * 1.4, 0, 1)
    low = ss(2.2, 0.3, S['P'][:, 1])
    return (0.07 + 0.16 * ss(0.3, 0.8, S['n_lo2']) + 0.12 * low) * ext * S['film_on']


def r_paint(S, base=0.80):
    n, ao, cav, dirt, dust, ew, streak, heat = _common(S)
    P, N = S['P'], S['N']
    lo, mid, fine = S['n_lo'], S['n_mid'], S['n_fine']
    g = base + 0.07 * (lo - 0.5) + 0.05 * (mid - 0.5) + 0.02 * (fine - 0.5)
    g += 0.07 * ss(0.35, 0.95, N[:, 1]) * S['sky']                                   # sun bleached tops
    patch = S['patch']                                                                  # touched-up repaint patches
    g = g * (1 - 0.13 * patch) + 0.02 * patch
    rough = 0.64 + 0.12 * (mid - 0.5) + 0.06 * (fine - 0.5) + 0.14 * ss(0.3, 0.9, N[:, 1])
    metal = np.full(n, 0.04, np.float32)
    # chips: clusters of small chips everywhere + heavy wear along convex edges
    chip = S['chip']
    g = g * (1 - chip) + chip * (0.34 + 0.08 * fine)
    rough = rough * (1 - chip) + chip * 0.42
    metal = metal * (1 - chip) + chip * 0.75
    # worn edge: primer ring (lighter) outside, bare steel at the very edge
    g = g * (1 - ew) + ew * (0.93 + 0.05 * fine)
    rough = rough * (1 - ew) + ew * 0.62
    bare = S['ew_core']
    g = g * (1 - bare) + bare * 0.55
    metal = metal * (1 - bare) + bare * 0.9
    rough = rough * (1 - bare) + bare * 0.32
    # scratches through the clear coat
    sc = S['scratch']
    g = g * (1 - 0.6 * sc) + 0.97 * 0.6 * sc
    rough = rough * (1 - 0.5 * sc) + 0.35 * 0.5 * sc
    # rust bleeding + rust spots: darker (tint multiplies)
    rs = S['rust']
    g *= (1 - 0.55 * rs)
    rough = rough * (1 - rs) + rs * 0.92
    metal *= (1 - rs)
    g *= (1 - 0.45 * streak)
    rough = rough * (1 - 0.6 * streak) + 0.85 * 0.6 * streak
    # heat: burnt paint around welds
    g *= (1 - 0.75 * heat)
    rough = rough * (1 - heat) + heat * 0.8
    # grime, dust, ao
    g *= (1 - 0.55 * dirt)
    rough = rough * (1 - dirt) + dirt * 0.9
    g = g * (1 - 0.55 * dust) + 0.9 * 0.55 * dust
    rough = rough * (1 - dust) + dust * 0.95
    fl = _film(S)
    g = g * (1 - fl) + 0.92 * fl
    rough = rough + fl * 0.2
    g *= (1 - 0.72 * ao) * (1 - 0.5 * cav)
    rough = np.clip(rough + 0.25 * cav, 0, 1)
    g = np.clip(g, 0.03, 1)
    return np.repeat(g[:, None], 3, 1), rough, np.clip(metal, 0, 1)


def _steel_like(S, base, tint, rust_amt, bare_col=(0.47, 0.47, 0.46), metal0=0.75, rough0=0.55, heat_col=True, mill=0.18):
    n, ao, cav, dirt, dust, ew, streak, heat = _common(S)
    lo, mid, fine = S['n_lo'], S['n_mid'], S['n_fine']
    lum = base * (1 + mill * (mid - 0.5) + 0.12 * (lo - 0.5) + 0.08 * (fine - 0.5))
    rgb = lum[:, None] * np.asarray(tint, np.float32)[None]
    rough = rough0 + 0.15 * (mid - 0.5) + 0.08 * (fine - 0.5)
    metal = np.full(n, metal0, np.float32)
    # rust: blotches driven by noise, crevices, streaks, edges
    rs = np.clip(S['rust'] * rust_amt, 0, 1)
    rc = mix(col((0.30, 0.13, 0.05), n), col((0.50, 0.25, 0.09), n), S['n_rc'])
    rc = mix(rc, col((0.16, 0.075, 0.04), n), ss(0.55, 0.9, S['n_pit']))
    rgb = mix(rgb, rc, rs)
    rough = rough * (1 - rs) + rs * (0.86 + 0.1 * fine)
    metal = metal * (1 - rs) + rs * 0.12
    st = np.clip(streak * 0.9, 0, 1)
    rgb = mix(rgb, col((0.33, 0.15, 0.06), n) * (0.8 + 0.3 * fine)[:, None], st * 0.75)
    rough = rough * (1 - st) + st * 0.8
    # heat tint around welds: dark core, blue ring, straw ring
    if heat_col:
        hd = S['heat_d']
        h_core = ss(0.02, 0.004, hd) * S['heat_on']
        h_blue = ss(0.045, 0.02, hd) * (1 - h_core) * S['heat_on']
        h_straw = ss(0.075, 0.045, hd) * (1 - ss(0.045, 0.02, hd)) * S['heat_on']
        rgb = mix(rgb, col((0.08, 0.075, 0.075), n), h_core * 0.85)
        rgb = mix(rgb, col((0.20, 0.22, 0.36), n), h_blue * 0.55)
        rgb = mix(rgb, col((0.52, 0.40, 0.22), n), h_straw * 0.45)
    # bare metal on worn edges
    ec = np.clip(ew * 0.7 + S['ew_core'] * 0.85, 0, 1)
    rgb = mix(rgb, col(bare_col, n) * (0.85 + 0.25 * fine)[:, None], ec)
    rough = rough * (1 - ec) + ec * 0.38
    metal = metal * (1 - ec) + ec * 1.0
    sc = S['scratch']
    rgb = mix(rgb, col(bare_col, n), sc * 0.55)
    rough = rough * (1 - 0.5 * sc) + 0.3 * 0.5 * sc
    # grime + dust + ao
    rgb = mix(rgb, col((0.20, 0.17, 0.13), n), dirt * 0.8)
    rough = rough * (1 - dirt) + dirt * 0.9
    metal *= (1 - 0.7 * dirt)
    rgb = mix(rgb, col((0.50, 0.44, 0.36), n), dust * 0.6)
    rough = rough * (1 - dust) + dust * 0.95
    metal *= (1 - 0.8 * dust)
    fl = _film(S)
    rgb = mix(rgb, col(DUST_COL, n), fl)
    rough = rough + fl * 0.25
    metal *= (1 - 0.6 * fl)
    rgb *= ((1 - 0.72 * ao) * (1 - 0.5 * cav))[:, None]
    rough = np.clip(rough + 0.2 * cav, 0, 1)
    return np.clip(rgb, 0, 1), np.clip(rough, 0.05, 1), np.clip(metal, 0, 1)


def r_armor(S):
    return _steel_like(S, 0.175, (1.0, 0.965, 0.92), 1.0, metal0=0.35, rough0=0.66, mill=0.26)


def r_mdark(S):
    return _steel_like(S, 0.085, (1.0, 0.98, 0.95), 0.6, bare_col=(0.45, 0.45, 0.44), metal0=0.35, rough0=0.66, mill=0.3)


def r_mbare(S):
    return _steel_like(S, 0.46, (1.0, 1.0, 0.99), 0.8, metal0=0.95, rough0=0.45)


def r_spike(S):
    rgb, r, mt = _steel_like(S, 0.40, (1.0, 0.99, 0.97), 0.8, bare_col=(0.75, 0.75, 0.72), metal0=0.95, rough0=0.38, heat_col=False)
    return rgb, r, mt


def r_rust(S):
    n, ao, cav, dirt, dust, ew, streak, heat = _common(S)
    t = np.clip(0.5 * S['n_mid'] + 0.3 * S['n_rc'] + 0.2 * S['n_fine'], 0, 1)
    rgb = mix(col((0.11, 0.06, 0.035), n), col((0.30, 0.14, 0.06), n), ss(0.25, 0.7, t))                 # dark scale -> brown
    rgb = mix(rgb, col((0.50, 0.24, 0.08), n), ss(0.62, 0.9, t + 0.25 * (S['n_lo'] - 0.5)) * 0.8)     # orange bloom
    rgb = mix(rgb, col((0.26, 0.24, 0.22), n), ss(0.7, 0.85, S['n_lo2']) * 0.35)                      # remains of grey primer
    rgb *= (1 - 0.4 * ss(0.6, 0.85, S['n_pit']))[:, None]
    rgb = mix(rgb, col((0.20, 0.17, 0.13), n), dirt * 0.6)
    rgb = mix(rgb, col((0.50, 0.44, 0.36), n), dust * 0.5)
    rgb *= ((1 - 0.7 * ao) * (1 - 0.5 * cav))[:, None]
    rough = np.clip(0.88 + 0.1 * (S['n_fine'] - 0.5), 0, 1)
    return np.clip(rgb, 0, 1), rough, np.full(n, 0.15, np.float32)


def r_chrome(S):
    n, ao, cav, dirt, dust, ew, streak, heat = _common(S)
    fine, mid = S['n_fine'], S['n_mid']
    g = 0.46 + 0.08 * (mid - 0.5)
    rgb = col((1.0, 0.98, 0.95), n) * g[:, None]
    rough = 0.28 + 0.1 * (mid - 0.5) + 0.06 * fine
    metal = np.ones(n, np.float32)
    smudge = ss(0.45, 0.8, S['n_lo'] * 0.6 + mid * 0.4)
    rgb = mix(rgb, col((0.38, 0.35, 0.31), n), smudge * 0.55)
    rough = rough + smudge * 0.3
    fl = _film(S)
    rgb = mix(rgb, col(DUST_COL, n), fl * 0.8)
    rough = rough + fl * 0.3
    rs = np.clip(S['rust'] * 0.6, 0, 1)
    rgb = mix(rgb, col((0.36, 0.18, 0.08), n), rs)
    rough = rough * (1 - rs) + rs * 0.85
    metal *= (1 - 0.8 * rs)
    heat = S['heat']
    rgb = mix(rgb, col((0.55, 0.42, 0.3), n), ss(0.2, 1, heat) * 0.5)      # heat blued/golden pipes
    tarnish = ss(0.35, 0.75, S['n_rc'] * 0.5 + S['n_lo2'] * 0.5)                    # bronze/blue heat tarnish + soot bloom
    rgb = mix(rgb, col((0.36, 0.30, 0.24), n), tarnish * 0.45)
    rgb = mix(rgb, col((0.10, 0.09, 0.08), n), ss(0.6, 0.9, S['n_mid']) * 0.35)
    rgb = mix(rgb, col((0.16, 0.13, 0.1), n), dirt * 0.75)
    rough = rough * (1 - dirt) + dirt * 0.8
    metal *= (1 - 0.7 * dirt)
    rgb = mix(rgb, col((0.5, 0.45, 0.38), n), dust * 0.55)
    rough = rough * (1 - dust) + dust * 0.9
    rgb *= ((1 - 0.6 * ao) * (1 - 0.4 * cav))[:, None]
    return np.clip(rgb, 0, 1), np.clip(rough, 0.04, 1), np.clip(metal, 0, 1)


def r_alu(S):
    """weathered aluminium tank skin: brushed grey, oxidised milky patches, grime streaks, dents catch dirt"""
    n, ao, cav, dirt, dust, ew, streak, heat = _common(S)
    lo, mid, fine = S['n_lo'], S['n_mid'], S['n_fine']
    g = 0.56 + 0.06 * (mid - 0.5) + 0.05 * (lo - 0.5)
    rgb = col((1.0, 0.995, 0.98), n) * g[:, None]
    rough = 0.44 + 0.12 * (mid - 0.5) + 0.06 * (fine - 0.5)
    metal = np.full(n, 0.78, np.float32)
    ox = ss(0.55, 0.8, lo * 0.5 + S['n_rc'] * 0.5)                                        # milky oxidation
    rgb = mix(rgb, col((0.66, 0.66, 0.63), n), ox * 0.6)
    rough = rough + ox * 0.3
    metal = metal - ox * 0.35
    rgb = mix(rgb, col((0.22, 0.19, 0.15), n), np.clip(streak * 0.9, 0, 1))
    rough = rough * (1 - streak) + streak * 0.75
    rgb = mix(rgb, col((0.18, 0.15, 0.12), n), dirt * 0.85)
    rough = rough * (1 - dirt) + dirt * 0.85
    metal *= (1 - 0.7 * dirt)
    rgb = mix(rgb, col((0.55, 0.48, 0.38), n), dust * 0.65)
    rough = rough * (1 - dust) + dust * 0.92
    metal *= (1 - 0.7 * dust)
    sc = S['scratch']
    rgb = mix(rgb, col((0.8, 0.8, 0.8), n), sc * 0.5)
    fl = _film(S)
    rgb = mix(rgb, col(DUST_COL, n), fl)
    rough = rough + fl * 0.3
    rgb *= ((1 - 0.72 * ao) * (1 - 0.55 * cav))[:, None]
    return np.clip(rgb, 0, 1), np.clip(rough, 0.05, 1), np.clip(metal, 0, 1)


def r_rim(S):
    rgb, r, mt = _steel_like(S, 0.40, (1.0, 0.94, 0.8), 0.55, bare_col=(0.5, 0.5, 0.48), metal0=0.2, rough0=0.62, heat_col=False)
    n = S['n']
    bd = np.clip(S['ao'] * 1.5 + 0.2 * S['n_mid'], 0, 1)                          # brake dust in the dish
    rgb = mix(rgb, col((0.13, 0.09, 0.06), n), bd * 0.6)
    return rgb, r, mt


def r_rubber(S):
    n, ao, cav, dirt, dust, ew, streak, heat = _common(S)
    fine, mid = S['n_fine'], S['n_mid']
    g = 0.05 * (0.85 + 0.3 * mid) * (0.9 + 0.2 * fine)
    rgb = col((1.0, 0.98, 0.96), n) * g[:, None]
    groove = np.clip(cav * 2.2 + ao * 0.8, 0, 1)                                     # dust packed in the tread grooves
    rgb = mix(rgb, col((0.30, 0.26, 0.21), n), groove * 0.55 * (0.6 + 0.4 * S['n_lo']))
    rgb = mix(rgb, col((0.36, 0.32, 0.26), n), dust * 0.4 + 0.12 * ss(0.4, 0.8, S['n_lo']))
    rgb = mix(rgb, col((0.2, 0.18, 0.15), n), ew * 0.25)                               # scuffed lug edges
    rough = np.clip(0.9 - 0.1 * ew + 0.05 * fine, 0, 1)
    rgb *= (1 - 0.35 * ao)[:, None]
    return np.clip(rgb, 0, 1), rough, np.zeros(n, np.float32)


def _dielectric(S, c, rough0=0.8, wear_col=None, dirt_amt=0.8, dust_amt=0.6, fine_amp=0.15, chip_col=None, chip_amt=0.0):
    n, ao, cav, dirt, dust, ew, streak, heat = _common(S)
    fine, mid, lo = S['n_fine'], S['n_mid'], S['n_lo']
    rgb = col(c, n) * (1 + fine_amp * (mid - 0.5) + 0.08 * (lo - 0.5) + 0.06 * (fine - 0.5))[:, None]
    rough = rough0 + 0.08 * (mid - 0.5)
    metal = np.zeros(n, np.float32)
    if wear_col is not None:
        rgb = mix(rgb, col(wear_col, n), ew * 0.8)
    if chip_col is not None and chip_amt > 0:
        ch = np.clip(S['chip'] * chip_amt + S['ew_core'], 0, 1)
        rgb = mix(rgb, col(chip_col, n), ch)
        metal = metal * (1 - ch) + ch * 0.6
        rough = rough * (1 - ch) + ch * 0.45
    rgb = mix(rgb, col((0.25, 0.2, 0.15), n), np.clip(streak * 0.6 + S['rust'] * 0.5, 0, 1))
    rgb = mix(rgb, col((0.2, 0.17, 0.13), n), dirt * dirt_amt)
    rgb = mix(rgb, col((0.52, 0.46, 0.38), n), dust * dust_amt)
    rgb = mix(rgb, col(DUST_COL, n), _film(S) * 0.8)
    rough = rough * (1 - dirt) + dirt * 0.92
    rgb *= ((1 - 0.72 * ao) * (1 - 0.5 * cav))[:, None]
    rgb *= (1 - 0.7 * heat)[:, None]
    return np.clip(rgb, 0, 1), np.clip(rough, 0.05, 1), metal


def r_canvas(S):
    n = S['n']
    base = mix(col((0.50, 0.44, 0.30), n), col((0.40, 0.37, 0.27), n), S['n_lo2'])     # bag to bag hue variation
    rgb, r, mt = _dielectric(S, (1, 1, 1), 0.93, dust_amt=0.7, dirt_amt=0.7, fine_amp=0.25)
    rgb = rgb * base
    stain = ss(0.55, 0.85, S['n_mid'])
    rgb *= (1 - 0.25 * stain)[:, None]
    return rgb, r, mt


def r_wood(S):
    n = S['n']
    P = S['P']
    gr = fbm(P, (3.0, 40.0, 40.0) if True else 1, 3, 77)
    gr2 = fbm(P, (40.0, 40.0, 3.0), 3, 78)
    g = np.where(S['grain_x'], gr, gr2)
    base = mix(col((0.30, 0.20, 0.12), n), col((0.46, 0.33, 0.20), n), g)
    weather = ss(0.4, 0.9, S['n_lo'])
    base = mix(base, col((0.42, 0.40, 0.36), n), weather * 0.6)                        # sun-greyed boards
    rgb, r, mt = _dielectric(S, (1, 1, 1), 0.86)
    return rgb * base, r, mt


def r_paint_col(S, pc, sun_col, chip_col=(0.20, 0.19, 0.18), primer=(0.50, 0.48, 0.44), bare=(0.50, 0.50, 0.49), rust_col=(0.30, 0.12, 0.05),
                rough0=0.62):
    """painted steel in a baked colour (untinted models, e.g. the boss): hue variation, sun fade, repaint patches, chips to dark primer,
    worn primer edges with bare steel cores, scratches, rust bleed + streaks, burnt paint at welds, grime / dust / film, AO"""
    n, ao, cav, dirt, dust, ew, streak, heat = _common(S)
    N = S['N']
    lo, mid, fine = S['n_lo'], S['n_mid'], S['n_fine']
    k = 1 + 0.16 * (lo - 0.5) + 0.10 * (mid - 0.5) + 0.05 * (fine - 0.5)
    rgb = col(pc, n) * k[:, None]
    fade = np.clip(0.55 * ss(0.35, 0.95, N[:, 1]) * S['sky'] + 0.35 * ss(0.45, 0.9, S['n_lo2']), 0, 1)       # sun-faded tops + blotches
    rgb = mix(rgb, col(sun_col, n) * k[:, None], fade)
    patch = S['patch']
    rgb = mix(rgb, col(pc, n) * 0.72, patch * 0.8)                                                              # darker repaint patches
    rough = rough0 + 0.12 * (mid - 0.5) + 0.06 * (fine - 0.5) + 0.12 * fade
    metal = np.full(n, 0.04, np.float32)
    chip = S['chip']
    rgb = mix(rgb, col(chip_col, n) * (0.85 + 0.3 * fine)[:, None], chip)
    rough = rough * (1 - chip) + chip * 0.5
    metal = metal * (1 - chip) + chip * 0.5
    rgb = mix(rgb, col(primer, n) * (0.9 + 0.2 * fine)[:, None], ew * 0.85)
    rough = rough * (1 - ew) + ew * 0.6
    b = S['ew_core']
    rgb = mix(rgb, col(bare, n), b)
    metal = metal * (1 - b) + b * 0.9
    rough = rough * (1 - b) + b * 0.34
    sc = S['scratch']
    rgb = mix(rgb, col(primer, n), sc * 0.55)
    rs = np.clip(S['rust'], 0, 1)
    rc = mix(col(rust_col, n), col((0.14, 0.07, 0.04), n), ss(0.55, 0.9, S['n_pit']))
    rgb = mix(rgb, rc, rs * 0.85)
    rough = rough * (1 - rs) + rs * 0.9
    metal *= (1 - rs)
    st = np.clip(streak * 0.9, 0, 1)
    rgb = mix(rgb, col((0.22, 0.10, 0.045), n) * (0.8 + 0.3 * fine)[:, None], st * 0.7)
    rough = rough * (1 - 0.6 * st) + 0.85 * 0.6 * st
    rgb *= (1 - 0.75 * heat)[:, None]
    rough = rough * (1 - heat) + heat * 0.8
    rgb = mix(rgb, col((0.20, 0.17, 0.13), n), dirt * 0.75)
    rough = rough * (1 - dirt) + dirt * 0.9
    rgb = mix(rgb, col((0.52, 0.46, 0.38), n), dust * 0.55)
    rough = rough * (1 - dust) + dust * 0.95
    fl = _film(S)
    rgb = mix(rgb, col(DUST_COL, n), fl * 0.85)
    rough = rough + fl * 0.2
    rgb *= ((1 - 0.72 * ao) * (1 - 0.5 * cav))[:, None]
    rough = np.clip(rough + 0.25 * cav, 0, 1)
    return np.clip(rgb, 0.02, 1), np.clip(rough, 0.05, 1), np.clip(metal, 0, 1)


def r_boss_rim(S):
    rgb, r, mt = r_paint_col(S, (0.30, 0.085, 0.06), (0.40, 0.16, 0.11), rough0=0.6)
    bd = np.clip(S['ao'] * 1.5 + 0.2 * S['n_mid'], 0, 1)                          # brake dust in the dish
    rgb = mix(rgb, col((0.13, 0.09, 0.06), S['n']), bd * 0.6)
    return rgb, r, mt


def r_flat(c, rough=0.8, wear=None, chip=None, chip_amt=0.0, dust_amt=0.6, dirt_amt=0.8):
    return lambda S: _dielectric(S, c, rough, wear, dirt_amt=dirt_amt, dust_amt=dust_amt, chip_col=chip, chip_amt=chip_amt)


RECIPES = {
    'paint': r_paint, 'paint2': lambda S: r_paint(S, 0.74),
    'armor': r_armor, 'metal_dark': r_mdark, 'metal_bare': r_mbare, 'spike': r_spike, 'rust': r_rust,
    'chrome': r_chrome, 'rim': r_rim, 'alu': r_alu, 'rubber_tire': r_rubber, 'rubber': r_rubber,
    'canvas': r_canvas, 'wood': r_wood,
    'interior': r_flat((0.10, 0.095, 0.09), 0.85, wear=(0.2, 0.19, 0.17), dust_amt=0.35, dirt_amt=0.3),
    'fabric': r_flat((0.22, 0.17, 0.12), 0.95, wear=(0.3, 0.25, 0.18), dust_amt=0.4, dirt_amt=0.3),
    'leather': r_flat((0.20, 0.12, 0.07), 0.6, wear=(0.36, 0.26, 0.17), dust_amt=0.4, dirt_amt=0.3),
    'plastic': r_flat((0.62, 0.58, 0.48), 0.55, wear=(0.78, 0.75, 0.66), dust_amt=0.8, dirt_amt=0.9),
    'decal_yellow': r_flat((0.80, 0.56, 0.06), 0.62, chip=(0.12, 0.12, 0.12), chip_amt=1.4),
    'decal_red': r_flat((0.58, 0.08, 0.05), 0.6, chip=(0.12, 0.11, 0.1), chip_amt=1.2),
    'decal_white': r_flat((0.80, 0.78, 0.72), 0.6, chip=(0.12, 0.11, 0.1), chip_amt=1.2),
    'cloth_red': r_flat((0.50, 0.07, 0.05), 0.95, dust_amt=0.5),
    'brass': lambda S: _steel_like(S, 0.55, (1.0, 0.78, 0.42), 0.3, bare_col=(0.85, 0.7, 0.4), metal0=1.0, rough0=0.35, heat_col=False),
    'gun_metal': lambda S: _steel_like(S, 0.16, (1.0, 1.0, 1.02), 0.2, metal0=0.85, rough0=0.45, heat_col=False),
    # the Leviathan (untinted): oxblood war paint, charcoal trim, oxblood wheels
    'boss_paint': lambda S: r_paint_col(S, (0.36, 0.085, 0.055), (0.46, 0.17, 0.11)),
    'boss_paint2': lambda S: r_paint_col(S, (0.075, 0.072, 0.068), (0.17, 0.16, 0.145), chip_col=(0.30, 0.29, 0.28), rough0=0.7),
    'boss_rim': r_boss_rim,
}


# =========================================================================================== main
def prepare(m, data, bvh=None):
    """charts + packing + raster (world pos/normal per texel); sets d['uv1']; registers placeholder baked materials."""
    t0 = time.time()
    opts = dict(DEFAULTS)
    opts.update(m.bake_opts)
    if os.environ.get('BAKE_QUICK'):
        opts['dens'] *= 0.5
    m._bopts = opts
    for d in data.values():
        d['uv1'] = np.zeros((len(d['Fflat']), 2), np.float64)
    charts = build_charts(m, data, opts)
    if bvh is not None:
        visibility(charts, data, bvh)
    bymat = {}
    for c in charts:
        bymat.setdefault(c.mat, []).append(c)
    m._bake = {}
    for mat, cl in sorted(bymat.items()):
        W, H, dens = pack(cl, opts, mat)
        P, N, CID = raster(cl, data, W, H, opts['margin'])
        ai = vmat._img('bake_%s_alb' % mat, np.full((8, 8, 3), 0.5, np.float32), True)
        oi = vmat._img('bake_%s_orm' % mat, np.full((8, 8, 3), 0.5, np.float32), False)
        vmat.set_baked(mat, ai, oi)
        m._bake[mat] = dict(W=W, H=H, dens=dens, charts=cl, P=P, N=N, CID=CID, alb=ai, orm=oi)
    print('[bake] prepare: %d charts, %d atlases (%.1fs)  %s' % (len(charts), len(bymat), time.time() - t0,
          ', '.join('%s %dx%d@%.0f' % (k, v['W'], v['H'], v['dens']) for k, v in m._bake.items())))


def _cycles_setup(samples):
    import bpy
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        sc.cycles.device = 'CPU'
    except Exception:
        pass
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    if sc.world is None:
        sc.world = bpy.data.worlds.new('bake_world')
    return sc


def cycles_bakes(m, data, objs):
    """AO (1 m), cavity (7 cm) and sky visibility (overhead soft sun shadow) into float images per atlas."""
    import bpy
    t0 = time.time()
    quick = bool(os.environ.get('BAKE_QUICK'))
    sc = _cycles_setup(16)
    gm = bpy.data.meshes.new('bake_ground')                  # ground plane occluder
    g = 60.0
    gm.from_pydata([(-g, -g, 0), (g, -g, 0), (g, g, 0), (-g, g, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new('bake_ground', gm)
    sc.collection.objects.link(ground)
    imgs = {}
    dummy = bpy.data.images.new('bake_dummy', 8, 8, alpha=False, float_buffer=True)
    for mat in list(bpy.data.materials):
        nt = mat.node_tree
        if nt is None:
            continue
        node = nt.nodes.new('ShaderNodeTexImage')
        node.name = 'bake_target'
        B = m._bake.get(mat.name)
        if B is None:
            node.image = dummy
        else:
            im = {}
            for key in ('ao', 'cav'):
                im[key] = bpy.data.images.new('bake_%s_%s' % (mat.name, key), max(B['W'] // 2, 8), max(B['H'] // 2, 8), alpha=False, float_buffer=True)
                im[key].colorspace_settings.name = 'Non-Color'
            imgs[mat.name] = im
            node.image = im['ao']
        for n2 in nt.nodes:
            n2.select = False
        node.select = True
        nt.nodes.active = node
    meshes = [o for o in sc.objects if o.type == 'MESH' and o is not ground]
    shared_srcs = {}
    for o in meshes:                                        # one instance per shared (wheel) mesh, baked in isolation
        if data.get(o.data.name, {}).get('shared'):
            shared_srcs.setdefault(o.data.name, o)
    body_objs = [o for o in meshes if not data.get(o.data.name, {}).get('shared')]
    wheel_objs = list(shared_srcs.values())

    def set_target(key):
        for mat in bpy.data.materials:
            nt = mat.node_tree
            if nt is None or 'bake_target' not in nt.nodes:
                continue
            if mat.name in imgs:
                nt.nodes['bake_target'].image = imgs[mat.name][key]

    def bake(objs_sel, visible, btype, clear):
        for o in sc.objects:
            o.hide_render = o not in visible
            o.select_set(o in objs_sel)
        bpy.context.view_layer.objects.active = objs_sel[0]
        bpy.ops.object.bake(type=btype, uv_layer='UV1', margin=2, use_clear=clear, target='IMAGE_TEXTURES')

    everything = meshes + [ground]
    for key, dist, spp in (('ao', m._bopts['ao_dist'], 10 if quick else 28), ('cav', m._bopts['cav_dist'], 6 if quick else 14)):
        sc.world.light_settings.distance = dist
        sc.cycles.samples = spp
        set_target(key)
        bake(body_objs, everything, 'AO', True)
        if wheel_objs:
            sc.world.light_settings.distance = min(dist, 0.45)
            bake(wheel_objs, wheel_objs, 'AO', False)
        print('[bake]   cycles %s (%.1fs)' % (key, time.time() - t0))
    out = {}
    for mat, im in imgs.items():
        B = m._bake[mat]
        res = {}
        for key, img in im.items():
            w, h = img.size
            buf = np.empty(w * h * 4, np.float32)
            img.pixels.foreach_get(buf)
            half = buf.reshape(h, w, 4)[::-1, :, 0]
            res[key] = np.repeat(np.repeat(half, 2, 0), 2, 1)[:B['H'], :B['W']]
            bpy.data.images.remove(img)
        out[mat] = res
    for mat in bpy.data.materials:
        nt = mat.node_tree
        if nt is not None and 'bake_target' in nt.nodes:
            nt.nodes.remove(nt.nodes['bake_target'])
    bpy.data.images.remove(dummy)
    bpy.data.objects.remove(ground); bpy.data.meshes.remove(gm)
    for o in sc.objects:
        o.hide_render = False
    print('[bake] cycles bakes done (%.1fs)' % (time.time() - t0))
    return out


def finish(m, data, objs):
    t0 = time.time()
    opts = m._bopts
    baked = cycles_bakes(m, data, objs)
    edges = {}
    for name, d in data.items():
        edges.update(sharp_edges(m, d))
    welds = [(np.array(a, np.float32), np.array(b, np.float32), r) for a, b, r in m.welds]
    dbg = os.environ.get('BAKE_DEBUG')
    stats = []
    for mat, B in sorted(m._bake.items()):
        t1 = time.time()
        W, H, dens, cl, CID = B['W'], B['H'], B['dens'], B['charts'], B['CID']
        valid = CID >= 0
        yy, xx = np.nonzero(valid)
        S, extra = compose_masks(m, mat, B, baked[mat], yy, xx, opts, edges, welds, data)
        t2 = time.time()
        fn = RECIPES.get(opts.get('recipes', {}).get(mat, mat)) or r_flat((0.5, 0.5, 0.5))
        rgb, rough, metal = fn(S)
        rgb = np.array(rgb, np.float32)
        rough = np.array(rough, np.float32); metal = np.array(metal, np.float32)
        clook = extra['clook']
        for lk in set(clook.tolist()) - {''}:
            rk = opts.get('look_recipes', {}).get(lk, lk)
            if rk not in RECIPES:
                continue
            idx = np.flatnonzero(clook == lk)
            Ssub = {k: (v[idx] if isinstance(v, np.ndarray) and v.shape[:1] == (S['n'],) else v) for k, v in S.items()}
            Ssub['n'] = len(idx)
            r2, ro2, me2 = RECIPES[rk](Ssub)
            rgb[idx] = r2; rough[idx] = ro2; metal[idx] = me2
        if 'soot' in S and S['soot'].any():                   # soot bloom + heat-tinted steel around thrusters / nozzles / stack tops
            so, ho = S['soot'], S['hot']
            rgb = rgb * (1 - 0.85 * so[:, None]) + np.array([0.05, 0.045, 0.04], np.float32) * (0.85 * so[:, None])
            tint = np.stack([0.30 + 0.2 * ho, 0.22 + 0.05 * ho, 0.34 - 0.1 * ho], 1).astype(np.float32)
            rgb = rgb * (1 - 0.5 * ho[:, None]) + tint * (0.5 * ho[:, None])
            rough = rough * (1 - so) + so * 0.9
            metal = metal * (1 - 0.6 * so)
        isweld, wt = extra['isweld'], extra['wt']
        if isweld.any():                                    # weld bead: ripples + scale
            rip = 0.5 + 0.5 * np.sin(wt[isweld] * 2 * math.pi / 0.02)
            rgb[isweld] *= (0.62 + 0.45 * rip)[:, None] * np.array([0.92, 0.9, 0.95], np.float32)
            rough[isweld] = 0.5 + 0.2 * rip
        alb = np.zeros((H, W, 3), np.float32); orm = np.zeros((H, W, 3), np.float32)
        alb[yy, xx] = rgb
        orm[yy, xx, 0] = 1.0; orm[yy, xx, 1] = rough; orm[yy, xx, 2] = metal
        alb = dilate(alb, valid)
        orm = dilate(orm, valid)
        if opts['orm_half'] and W >= 256:
            orm = orm.reshape(H // 2, 2, W // 2, 2, 3).mean((1, 3))
        vmat.fill_img(B['alb'], alb)
        vmat.fill_img(B['orm'], orm)
        if dbg:
            _dbg_save(dbg, m.id, mat, alb, orm)
        stats.append((mat, W, H, dens, len(cl), len(yy)))
        print('[bake] %-12s %4dx%-4d dens %5.1f charts %5d texels %7d  masks %.1fs  recipe %.1fs' % (mat, W, H, dens, len(cl), len(yy), t2 - t1, time.time() - t2))
        for k in ('P', 'N', 'CID'):
            B[k] = None
    m.bake_stats = stats
    print('[bake] finish done in %.1fs' % (time.time() - t0))


def compose_masks(m, mat, B, bk, yy, xx, opts, edges, welds, data):
    T = [time.time()]
    tm = {}

    def lap(k):
        tm[k] = time.time() - T[0]
        T[0] = time.time()
    W, H, dens, cl, CID = B['W'], B['H'], B['dens'], B['charts'], B['CID']
    Pv = B['P'][yy, xx]
    Nv = B['N'][yy, xx]
    cid = CID[yy, xx]
    n = len(Pv)
    cshared = np.array([c.shared for c in cl])[cid]
    cvert = np.array([c.vert for c in cl])[cid]
    cpid = np.array([c.pid for c in cl])[cid]
    ckind = np.array([c.kind for c in cl])[cid]
    clook = np.array([(m.pkind[c.pid][2] or '') if 0 <= c.pid < len(m.pkind) else '' for c in cl])[cid]
    ao = np.clip(1.0 - bk['ao'][yy, xx], 0, 1)
    cav = np.clip(1.0 - bk['cav'][yy, xx], 0, 1)
    sky = np.where(cshared, 1.0, np.clip(1.0 - (1.0 - bk['ao'][yy, xx]) * 1.6, 0, 1))
    ao = (np.clip((ao - 0.05) * 1.3, 0, 1) ** 1.15).astype(np.float32)
    cav = np.clip((cav - 0.05) * 1.6, 0, 1).astype(np.float32)
    lap('read')
    seed = opts['seed'] + (zlib.crc32(mat.encode()) & 0xff)
    SC = opts.get('scale', 1.0)
    Pn = Pv if SC == 1.0 else (Pv / SC).astype(np.float32)
    S = dict(n=n, P=Pv, N=Nv, ao=ao, cav=cav, sky=sky.astype(np.float32))
    S['n_lo'] = fbm(Pn, 1.3, 3, seed + 1)
    S['n_lo2'] = vnoise(Pn, 2.6, seed + 17)
    S['n_mid'] = fbm(Pn, 6.0, 3, seed + 2)
    S['n_fine'] = fbm(Pn, 38.0, 2, seed + 3)
    S['n_rc'] = vnoise(Pn, 14.0, seed + 4)
    S['n_pit'] = fbm(Pn, 70.0, 2, seed + 5)
    lap('noise')
    # ---------------- edges (band search around every wear edge of the texel's own primitive)
    ed = np.full(n, 9.0, np.float32); edy = np.zeros(n, np.float32); eh = np.zeros(n, np.float32)
    G = Grid(Pv, 0.05)
    R = 0.045
    for pid in np.unique(cpid).tolist():
        if pid not in edges:
            continue
        A, Bb = edges[pid]
        for a, b in zip(A.astype(np.float32), Bb.astype(np.float32)):
            L = float(np.linalg.norm(b - a))
            k = max(int(L / 0.06), 1)
            cand = [G.near(a + (b - a) * (i / k), R + 0.035) for i in range(k + 1)]
            sel = np.unique(np.concatenate(cand))
            if not len(sel):
                continue
            sel = sel[cpid[sel] == pid]
            if not len(sel):
                continue
            D = b - a
            L2 = max(float(D @ D), 1e-12)
            t = np.clip(((Pv[sel] - a) @ D) / L2, 0, 1)
            C = a + t[:, None] * D
            dd_ = np.linalg.norm(Pv[sel] - C, axis=1)
            better = dd_ < ed[sel]
            s2 = sel[better]
            ed[s2] = dd_[better]
            edy[s2] = C[better, 1] - Pv[s2, 1]
            eh[s2] = float(abs(D[1]) / math.sqrt(L2) < 0.45)
    lap('edges')
    wear = opts['wear']
    wn = fbm(Pn, 9.0, 2, seed + 6)
    chipn = fbm(Pn, 55.0, 3, seed + 7, gain=0.6)
    cmin = np.array([max(min(c.du, c.dv), 0.004) for c in cl], np.float32)[cid]
    width = np.minimum((0.004 + 0.02 * ss(0.35, 0.85, wn)) * wear * SC, 0.14 * cmin + 0.002)
    ewm = ss(width, width * 0.25, ed)
    S['ew'] = (ewm * ss(0.30, 0.52, chipn * 0.7 + wn * 0.45)).astype(np.float32)
    S['ew_core'] = (ss(np.minimum(0.005 * wear * SC, 0.08 * cmin + 0.001), 0.001, ed) * ss(0.45, 0.62, chipn)).astype(np.float32)
    zone = ss(0.58, 0.8, S['n_lo'] * 0.5 + S['n_mid'] * 0.5 + 0.25 * ao - 0.1 * (1 - wear))
    S['chip'] = (zone * ss(0.66, 0.71, chipn) * wear).astype(np.float32)
    # ---------------- scratches (two directions), repaint patches
    Pr1 = np.stack([Pn[:, 0] * 0.8 + Pn[:, 2] * 0.6, Pn[:, 1] + 0.2 * Pn[:, 2], Pn[:, 2] * 0.8 - Pn[:, 0] * 0.6], 1)
    Pr2 = np.stack([Pn[:, 0], Pn[:, 1] * 0.9 - Pn[:, 2] * 0.45, Pn[:, 2] * 0.9 + Pn[:, 1] * 0.45], 1)
    s1 = vnoise(Pr1, (4.0, 260.0, 4.0), seed + 9)
    s2 = vnoise(Pr2, (5.0, 230.0, 3.0), seed + 10)
    sz = ss(0.62, 0.85, vnoise(Pn, 1.6, seed + 11))
    S['scratch'] = (np.maximum(ss(0.9, 0.97, s1), ss(0.91, 0.975, s2)) * sz * wear).astype(np.float32)
    S['patch'] = ss(0.60, 0.62, fbm(Pn, 2.4, 2, seed + 12)).astype(np.float32)
    lap('wear')
    # ---------------- welds (heat tint) + weld bead ripple position
    heat_d = np.full(n, 9.0, np.float32)
    wt = np.zeros(n, np.float32)
    for (a, b, r) in welds:
        L = float(np.linalg.norm(b - a))
        k = max(int(L / 0.08), 1)
        cand = [G.near(a + (b - a) * (i / k), 0.1) for i in range(k + 1)]
        sel = np.unique(np.concatenate(cand)) if cand else np.zeros(0, np.int64)
        if not len(sel):
            continue
        dd_, tt = seg_dist(Pv[sel], a, b)
        better = dd_ < heat_d[sel]
        heat_d[sel[better]] = dd_[better]; wt[sel[better]] = tt[better]
    hn = vnoise(Pn, 25.0, seed + 13)
    S['heat_d'] = (heat_d * (0.75 + 0.5 * hn) / SC).astype(np.float32)
    S['heat_on'] = np.ones(n, np.float32)
    S['heat'] = (ss(0.05, 0.006, S['heat_d'])).astype(np.float32)
    isweld = (ckind == 'weld')
    lap('welds')
    # ---------------- rust + streaks
    rust_amt = opts['rust']
    rsrc = np.zeros(n, np.float32)
    for (p, nrm, r) in m.rivets:
        idx = G.near(p, r * 3.0)
        if not len(idx):
            continue
        dist = np.linalg.norm(Pv[idx] - np.asarray(p, np.float32), axis=1)
        w = ss(r * 3.0, r * 0.8, dist) * (0.55 + 0.45 * ((zlib.crc32(str(p).encode()) % 100) / 100.0))
        rsrc[idx] = np.maximum(rsrc[idx], w)
    top = (ed < 0.02) & (edy > 0.002) & (eh > 0.5) & (np.abs(Nv[:, 1]) < 0.5)
    rsrc = np.maximum(rsrc, top * ss(0.55, 0.85, vnoise(Pn, (14.0, 2.0, 14.0), seed + 14)))
    rsrc = np.maximum(rsrc, ss(0.04 * SC, 0.0, heat_d) * 0.8)
    rsrc = np.maximum(rsrc, ss(0.86, 0.92, fbm(Pn, 7.0, 2, seed + 15)))
    rsrc *= rust_amt
    lap('rsrc')
    Simg = np.zeros((H, W), np.float32)
    Simg[yy, xx] = rsrc
    vimg = np.zeros((H, W), bool); vimg[yy, xx] = cvert
    decay_img = np.zeros((H, W), np.float32)
    Lpx = 0.45 * dens * SC
    dn = vnoise(Pn, (22.0, 1.5, 22.0), seed + 16)
    decay_img[yy, xx] = np.exp(-1.0 / (Lpx * (0.25 + 1.2 * dn)))
    same_all = ((CID[1:] == CID[:-1]) & vimg[1:] & (CID[1:] >= 0)).astype(np.float32)
    for y in range(1, H):
        np.maximum(Simg[y], Simg[y - 1] * decay_img[y] * same_all[y - 1], out=Simg[y])
    streak = Simg[yy, xx]
    sn = vnoise(Pn, (60.0, 3.0, 60.0), seed + 18)
    streak = streak * ss(0.25, 0.75, sn) * np.where(cvert, 1.0, 0.5)
    S['streak'] = np.clip(streak * 0.8, 0, 1).astype(np.float32)
    rspot = ss(0.62, 0.82, fbm(Pn, 4.0, 3, seed + 19) + 0.35 * ao + 0.3 * cav - 0.15)
    S['rust'] = np.clip((rspot * 0.85 + S['ew'] * 0.25 * ss(0.5, 0.8, wn) + rsrc * 0.6) * rust_amt, 0, 1).astype(np.float32)
    lap('streak')
    # ---------------- dirt, spray, dust
    h = Pv[:, 1]
    hn2 = S['n_lo2']
    dh = opts['dirt_h']
    dirt = ss(dh, dh * 0.1, h + (fbm(Pn, 3.0, 2, seed + 20) - 0.5) * 0.5 * dh) ** 1.2
    for (wx, wy, wz, wr) in opts['wheels']:
        for sx in (1, -1):
            dz = Pv[:, 2] - wz; dyw = Pv[:, 1] - wy
            rr = np.sqrt(dz * dz + dyw * dyw)
            side = (Pv[:, 0] * sx) > abs(wx) - 0.45
            spray = ss(wr + 0.55, wr + 0.03, rr) * side * (0.6 + 0.4 * (dz < 0))
            dirt = np.maximum(dirt, spray * ss(0.2, 0.7, hn2 + 0.3))
    dirt = np.where(cshared, 0.25 + 0.2 * hn2, dirt)
    dirt = np.clip(dirt * (0.75 + 0.5 * ao) * opts['dirt'], 0, 1)
    S['dirt'] = dirt.astype(np.float32)
    up = ss(0.3, 0.85, Nv[:, 1])
    dust = up * S['sky'] * (0.45 + 0.55 * ss(0.3, 0.8, S['n_mid'])) + 0.35 * cav * up
    dust = np.where(cshared, 0.0, dust)
    S['dust'] = np.clip(dust, 0, 1).astype(np.float32)
    S['grain_x'] = np.abs(np.array([c.n for c in cl])[cid][:, 0]) < 0.5
    S['film_on'] = np.where(cshared | (ckind == 'inner'), 0.35, 1.0).astype(np.float32)
    soot = np.zeros(n, np.float32)
    hot = np.zeros(n, np.float32)
    for (sx_, sy_, sz_, sr) in opts.get('heat_spots', []):
        dd_ = np.sqrt(((Pv - np.array([sx_, sy_, sz_], np.float32)) ** 2).sum(1))
        wv = fbm(Pn, 3.0, 2, seed + 31)
        soot = np.maximum(soot, ss(sr * (0.8 + 0.4 * wv), sr * 0.1, dd_))
        hot = np.maximum(hot, ss(sr * 0.45, sr * 0.05, dd_))
    S['soot'] = np.where(cshared, 0.0, soot).astype(np.float32)
    S['hot'] = np.where(cshared, 0.0, hot).astype(np.float32)
    lap('dirt')
    if os.environ.get('BAKE_TIMING'):
        print('      ', mat, ' '.join('%s %.1f' % kv for kv in tm.items()))
    return S, dict(isweld=isweld, wt=wt, ckind=ckind, clook=clook)


def dilate(img, valid, iters=8):
    """fill gutters with the nearest chart texel (index propagation), rest with the mean colour."""
    H, W = valid.shape
    idx = np.where(valid, np.arange(H * W, dtype=np.int64).reshape(H, W), -1)
    for _ in range(iters):
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = _shift(idx, dy, dx, -1)
            fill = (idx < 0) & (sh >= 0)
            idx[fill] = sh[fill]
    flat = img.reshape(-1, img.shape[2])
    out = np.empty_like(flat)
    ok = idx.ravel() >= 0
    out[ok] = flat[idx.ravel()[ok]]
    out[~ok] = flat[valid.ravel()].mean(0) if valid.any() else 0.5
    return out.reshape(img.shape)


def _dbg_save(dirp, mid, mat, alb, orm):
    import bpy
    os.makedirs(dirp, exist_ok=True)
    for tag, arr in (('alb', alb), ('orm', orm)):
        im = bpy.data.images.new('dbg', arr.shape[1], arr.shape[0], alpha=False)
        rgba = np.ones((arr.shape[0], arr.shape[1], 4), np.float32); rgba[..., :3] = arr
        im.pixels.foreach_set(np.ascontiguousarray(rgba[::-1]).ravel())
        im.filepath_raw = os.path.join(dirp, '%s_%s_%s.png' % (mid, mat, tag)); im.file_format = 'PNG'
        im.save()
        bpy.data.images.remove(im)

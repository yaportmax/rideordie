"""rocklib.py - procedural rock generators for RIDE OR DIE structures (built on slib.Piece).

Everything is GAME coordinates (x lateral, y up, z along road).  Rocks are faceted (flat-shaded) ring lofts whose look comes from
  * STRATA: layers of different material/tint/hardness. Each layer is its own set of rings, hard layers stick out, soft layers are
    eroded back, so you get real ledges + hard colour bands (materials rock_red / sand / dirt_red / rock_grey are used per layer).
  * baked vertex colours from slib (AO, dirt, streaks) - use RockPiece (overrides _matcolor so rock colours are not double-banded).

API
---
RockPiece(pid, seed=1, **style)            Piece subclass with rock-friendly style defaults (big-scale noise, strong AO).
Strata(spec, y0=0.0, seed=1, jitter=0.25, cycle=True)
    spec = [(thickness_m, material, (r,g,b) tint, hardness 0..1), ...]  cycled up the rock; use Strata.at(y) -> (mat, tint)
    presets: STRATA_RED, STRATA_RED_DARK, STRATA_GREY, STRATA_COAST, STRATA_SANDSTONE  (functions returning a Strata: fn(seed, y0=0))
rock_tower(p, mat, cx, cz, y0, height, radius, sides=16, seed=1, jag=0.12, strata=None, ellipse=(1,1), skew=(0,0), rot=0,
           erosion=0.12, top="rough", top_rough=0.5, spire_h=0, flat=True, foot=1.5, ring_dy=3.0, nscale=None, ky=0.5,
           tint=None, node=None, bottom_cap=True)  -> dict(rings=[...], top_y, ...)
    Stack / pillar / mesa / hill. `radius` = callable t->metres (t 0..1 over height) or [(t, metres), ...] (linear).
    strata=None -> single material `mat`, uniform rings every ring_dy.  top = "rough" | "flat" | "spire" | "dome".
    ellipse scales x/z radii (mesas: (1.0, 0.5)); skew=(dx, dz) leans the top (offset grows like t^1.5).
rock_lump(p, mat, c, radii, seed=1, sides=9, rings=4, jag=0.28, flat=True, squash=0.55, tint=None, node=None, rot=0)
    Boulder / rubble lump centred on c (x,y,z), radii=(rx,ry,rz); flattened at the bottom so it sits on the ground.
boulders(p, mat_or_strata, cx, cz, r_min, r_max, n, s_min, s_max, seed=1, y=0.0, jag=0.3)   scatter of lumps in an annulus.
rock_skirt(p, strata_or_mat, cx, cz, y0, r_in, r_out, h, sides=18, seed=1, ellipse=(1,1), jag=0.15)
    Talus apron (sloped ring from r_out at y0-0.6 up to r_in at y0+h); r_in should be ~0.95 x the tower radius at y0+h.
rock_sweep(p, rings, strata_or_mat, flat=True, closed=True) - loft a list of equal-length CCW-in-XY (viewed from +z) polygons along +z
    with per-face strata by mid-height; used by natural_arch.  Winding: polygon CCW seen from +z with mass on the left of travel.
Emitter(p, node=None, flat=True).face(mat, pts, tint)   low-level: add a polygon (dedupes vertices per material).
nz(x, y, z, seed, octaves=2, scale=1.0)  noise in [-1, 1] (about +-0.5 typical); usable for your own displacement.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *  # noqa: F401,F403,E402
import slib  # noqa: E402
import bisect  # noqa: E402

ROCKMATS = ("rock_red", "rock_grey", "sand", "dirt_red")


def nz(x, y, z, seed=0, octaves=2, scale=1.0):
    n = noise3(x, y, z, seed, octaves, scale)
    return max(-1.0, min(1.0, (n - 0.5) * 2.4))


class RockPiece(slib.Piece):
    """Piece with rock defaults. Rock colour variation comes from strata tints; this class only adds soft mottling."""

    def __init__(self, pid, seed=1, **style):
        base = dict(ao_dist=7.0, ao_amt=0.9, dirt_h=3.0, dirt_amt=0.45, noise_scale=0.10, streak_amt=0.35, dust_amt=0.15,
                    under_amt=0.25, noise_amt=0.28, facejit=0.06)
        base.update(style)
        super().__init__(pid, seed=seed, **base)

    def _matcolor(self, mat, w, n1, n2, P, Nn):
        if mat in ROCKMATS:
            y = P[:, 1]
            micro = 0.5 + 0.5 * np.sin(y * 5.3 + n2 * 4.0)
            g = w * (0.84 + 0.26 * n1) * (0.94 + 0.10 * micro)
            if mat == "rock_red":
                return np.stack([g * 1.03, g * (0.96 + 0.06 * n2), g * (0.92 + 0.10 * n2)], 1)
            if mat == "sand":
                return np.stack([g * 1.02, g * 0.99, g * (0.94 + 0.05 * n2)], 1)
            if mat == "dirt_red":
                return np.stack([g * 1.0, g * (0.95 + 0.06 * n1), g * 0.92], 1)
            return np.stack([g, g * 0.99, g * (0.97 + 0.03 * n2)], 1)
        return super()._matcolor(mat, w, n1, n2, P, Nn)


# ------------------------------------------------------------------------------------------------ strata
class Strata:
    def __init__(self, spec, y0=0.0, seed=1, jitter=0.25, cycle=True):
        self.spec, self.y0, self.seed, self.jitter, self.cycle = spec, y0, seed, jitter, cycle
        self._layers = None

    def build(self, y_top):
        """Layers [(ya, yb, mat, tint, hard)] covering y0..y_top."""
        rng = random.Random(self.seed)
        layers, y, i = [], self.y0, 0
        while y < y_top - 1e-6:
            if i >= len(self.spec) and not self.cycle:
                th, mat, tint, hard = self.spec[-1]
            else:
                th, mat, tint, hard = self.spec[i % len(self.spec)]
            th = th * (1 + self.jitter * rng.uniform(-1, 1))
            y1 = y + th
            if y_top - y1 < 0.55 * th + 0.3:
                y1 = y_top
            y1 = min(y1, y_top)
            k = 1 + 0.10 * rng.uniform(-1, 1)
            layers.append((y, y1, mat, (tint[0] * k, tint[1] * k, tint[2] * k), hard))
            y = y1
            i += 1
        self._layers = layers
        return layers

    def ensure(self, y_top):
        if self._layers is None or self._layers[-1][1] < y_top - 1e-6:
            self.build(y_top)
        return self._layers

    def at(self, y):
        if not self._layers:
            self.build(self.y0 + 150.0)
        L = self._layers
        for ya, yb, mat, tint, hard in L:
            if y < yb:
                return mat, tint
        return L[-1][2], L[-1][3]


def _s(seed, y0, spec, jitter=0.25):
    return Strata(spec, y0=y0, seed=seed, jitter=jitter)


def STRATA_RED(seed=1, y0=0.0):
    return _s(seed, y0, [(3.4, "rock_red", (1.0, 1.0, 1.0), 0.85), (0.9, "sand", (1.0, 0.96, 0.92), 0.35), (2.6, "rock_red", (0.9, 0.88, 0.88), 0.7),
                         (0.7, "dirt_red", (0.9, 0.9, 0.9), 0.15), (3.0, "rock_red", (1.05, 1.02, 1.0), 0.9), (1.1, "sand", (0.95, 0.9, 0.86), 0.3)])


def STRATA_RED_DARK(seed=1, y0=0.0):
    return _s(seed, y0, [(2.8, "rock_red", (0.9, 0.85, 0.85), 0.8), (0.8, "dirt_red", (0.85, 0.85, 0.85), 0.2), (3.4, "rock_red", (1.0, 0.98, 0.96), 0.9),
                         (0.7, "sand", (0.9, 0.85, 0.8), 0.35)])


def STRATA_SANDSTONE(seed=1, y0=0.0):
    return _s(seed, y0, [(3.0, "sand", (1.0, 0.95, 0.9), 0.7), (1.2, "rock_red", (1.05, 1.0, 1.0), 0.9), (2.2, "sand", (0.9, 0.87, 0.84), 0.4),
                         (0.8, "dirt_red", (0.95, 0.92, 0.9), 0.2), (2.6, "rock_red", (0.95, 0.92, 0.92), 0.85)])


def STRATA_GREY(seed=1, y0=0.0):
    return _s(seed, y0, [(3.2, "rock_grey", (1.0, 1.0, 1.0), 0.8), (0.8, "sand", (0.85, 0.82, 0.78), 0.3), (2.6, "rock_grey", (0.9, 0.9, 0.9), 0.65),
                         (1.6, "rock_grey", (1.08, 1.06, 1.03), 0.95), (0.6, "dirt_red", (0.75, 0.72, 0.7), 0.15)])


def STRATA_COAST(seed=1, y0=0.0):
    """Wet dark base (first 2.2 m) then pale grey/sand banded limestone."""
    return Strata([(2.4, "rock_grey", (0.42, 0.46, 0.44), 0.7)] + [(6.0, "rock_grey", (1.05, 1.03, 1.0), 0.85), (0.7, "sand", (0.95, 0.9, 0.82), 0.4),
                   (3.8, "rock_grey", (0.92, 0.92, 0.9), 0.7), (0.45, "dirt_red", (0.9, 0.85, 0.8), 0.2), (4.6, "rock_grey", (1.0, 1.0, 0.98), 0.9)],
                  y0=y0, seed=seed, jitter=0.4, cycle=True)


# ------------------------------------------------------------------------------------------------ emitter
class Emitter:
    def __init__(self, p, node=None, flat=True):
        self.p, self.node, self.flat = p, node, flat
        self.maps = {}

    def face(self, mat, pts, tint=None):
        a = self.p.acc(mat, self.node)
        m = self.maps.setdefault(mat, {})
        idx = []
        for v in pts:
            k = (round(v.x * 500), round(v.y * 500), round(v.z * 500))
            i = m.get(k)
            if i is None:
                i = len(a.v)
                a.v.append(Vector(v))
                m[k] = i
            if not idx or idx[-1] != i:
                idx.append(i)
        if len(idx) > 1 and idx[0] == idx[-1]:
            idx.pop()
        if len(set(idx)) < 3 or len(idx) < 3:
            return
        a.f.append(tuple(idx))
        a.sg.append(-1 if self.flat else 0)
        a.tint.append(tint)


def _jt(rng, tint, amt=0.06):
    k = 1 + amt * rng.uniform(-1, 1)
    t = tint or (1.0, 1.0, 1.0)
    return (t[0] * k, t[1] * k, t[2] * k)


def _prof(radius):
    if callable(radius):
        return radius
    pts = sorted(radius, key=lambda a: a[0])

    def f(t):
        if t <= pts[0][0]:
            return pts[0][1]
        for (t0, r0), (t1, r1) in zip(pts[:-1], pts[1:]):
            if t <= t1:
                if t1 - t0 < 1e-9:
                    return r1
                return r0 + (r1 - r0) * (t - t0) / (t1 - t0)
        return pts[-1][1]
    return f


# ------------------------------------------------------------------------------------------------ rock_tower
def rock_tower(p, mat, cx, cz, y0, height, radius, sides=16, seed=1, jag=0.12, strata=None, ellipse=(1.0, 1.0), skew=(0.0, 0.0),
               rot=0.0, erosion=0.12, top="rough", top_rough=0.5, spire_h=0.0, flat=True, foot=1.5, ring_dy=3.0, nscale=None, ky=0.5,
               tint=None, node=None, bottom_cap=True, layer_var=0.05, lobes=(4, 0.10), drift=0.035, layer_shift=0.0, layer_twist=0.0, layer_ell=0.0):
    prof = _prof(radius)
    rng = random.Random(seed * 31 + 7)
    R0 = max(prof(0.0), prof(0.5), 1.0)
    ns = nscale if nscale is not None else 1.0 / (R0 * 1.2 + 4.0)
    em = Emitter(p, node, flat)
    ytop = y0 + height
    # ---- layers
    if strata is None:
        n = max(1, int(math.ceil(height / max(ring_dy, 0.5))))
        layers = [(y0 + height * i / n, y0 + height * (i + 1) / n, mat, tint or (1.0, 1.0, 1.0), 1.0) for i in range(n)]
        ledged = False
    else:
        layers = strata.ensure(ytop)
        layers = [l for l in layers if l[0] < ytop - 1e-6]
        ledged = True
        if layers and layers[0][0] > y0 + 1e-6:
            pass
    if not layers:
        return {}

    def ring(y, rs, er=0.0, sh=(0.0, 0.0), ro=0.0, el=(1.0, 1.0)):
        t = min(1.0, max(0.0, (y - y0) / height))
        rn = prof(t)
        r0 = rn * rs
        sx = skew[0] * t ** 1.5
        sz = skew[1] * t ** 1.5
        pts = []
        for j in range(sides):
            th = rot + ro + 2 * math.pi * j / sides
            c, s = math.cos(th), math.sin(th)
            qx, qz = cx + rn * c, cz - rn * s
            n1 = nz(qx * 1.0, y * ky, qz * 1.0, seed, 2, ns)
            n2 = nz(qx * 3.1, y * ky * 3.1, qz * 3.1, seed + 9, 1, ns)
            rr = r0 * (1 + jag * (n1 + 0.45 * n2))
            if lobes and lobes[1]:
                rr *= 1 + lobes[1] * math.sin(lobes[0] * th + drift * y + seed * 1.7) * (0.6 + 0.4 * math.sin(y * 0.11 + seed))
            if er:
                m = 0.5 + 0.5 * nz(qx * 0.7 + 5.0, y * 0.35, qz * 0.7, seed + 13, 2, ns * 1.6)
                rr *= 1 - er * (0.25 + 0.75 * m)
            pts.append(Vector((cx + sx + sh[0] + rr * c * ellipse[0] * el[0], y, cz + sz + sh[1] - rr * s * ellipse[1] * el[1])))
        return pts

    def quads(a, b, mat_, tint_):
        for j in range(sides):
            j2 = (j + 1) % sides
            em.face(mat_, [a[j], a[j2], b[j2], b[j]], _jt(rng, tint_))

    lvar = [1.0 + layer_var * rng.uniform(-1, 1) for _ in layers]
    lsh = [(layer_shift * rng.uniform(-1, 1), layer_shift * rng.uniform(-1, 1)) for _ in layers]
    lro = [layer_twist * D2R * rng.uniform(-1, 1) for _ in layers]
    lel = [(1 + layer_ell * rng.uniform(-1, 1), 1 + layer_ell * rng.uniform(-1, 1)) for _ in layers]
    ring_list = []
    # foot (below ground)
    first = layers[0]
    base = ring(y0 - foot, 1.0)
    first_ring = ring(y0, lvar[0], erosion * (1 - first[4]) * 0.5 if ledged else 0.0, lsh[0], lro[0], lel[0])
    quads(base, first_ring, first[2], first[3])
    if bottom_cap:
        cpt = Vector((cx, y0 - foot, cz))
        for j in range(sides):
            j2 = (j + 1) % sides
            em.face(first[2], [base[j2], base[j], cpt], _jt(rng, first[3]))
    prev_top = first_ring
    ring_list.append(first_ring)
    for li, (ya, yb, lm, lt, hard) in enumerate(layers):
        th = yb - ya
        nrows = max(1, int(math.ceil(th / ring_dy)))
        rings_here = []
        for k in range(nrows + 1):
            u = k / nrows
            y = ya + th * u
            er = 0.0
            rs = lvar[li]
            if ledged:
                cc = math.sin(math.pi * u)
                if hard < 0.85:
                    er = erosion * (1 - hard) * (0.55 + 0.45 * cc)
                else:
                    rs += 0.02 * cc
            rings_here.append(ring(y, rs, er, lsh[li], lro[li], lel[li]))
        # ledge from previous ring (top of the layer below / foot ring) to this layer's bottom ring
        if li > 0 or True:
            if li == 0:
                pass
            else:
                quads(prev_top, rings_here[0], layers[li - 1][2] if False else lm, lt)
        for a, b in zip(rings_here[:-1], rings_here[1:]):
            quads(a, b, lm, lt)
        prev_top = rings_here[-1]
        ring_list.extend(rings_here)
    lm, lt = layers[-1][2], layers[-1][3]
    # ---- top
    yt = prev_top[0].y
    ctr = Vector((sum(v.x for v in prev_top) / sides, yt, sum(v.z for v in prev_top) / sides))
    if top == "spire":
        apex = Vector((ctr.x, yt + (spire_h if spire_h > 0 else height * 0.12), ctr.z))
        for j in range(sides):
            j2 = (j + 1) % sides
            em.face(lm, [prev_top[j], prev_top[j2], apex], _jt(rng, lt))
    elif top == "dome":
        cur = prev_top
        nd = 3
        dh = spire_h if spire_h > 0 else height * 0.06
        for k in range(1, nd + 1):
            f = math.cos(k / nd * math.pi / 2)
            yy = yt + dh * math.sin(k / nd * math.pi / 2)
            nxt = [Vector((ctr.x + (v.x - ctr.x) * f, yy + top_rough * 0.5 * nz(v.x, yy, v.z, seed + 3, 1, 0.3), ctr.z + (v.z - ctr.z) * f)) for v in prev_top]
            if k == nd:
                apex = Vector((ctr.x, yy, ctr.z))
                for j in range(sides):
                    j2 = (j + 1) % sides
                    em.face(lm, [cur[j], cur[j2], apex], _jt(rng, lt))
            else:
                quads(cur, nxt, lm, lt)
                cur = nxt
    elif top == "rough":
        cur = prev_top
        for f in (0.78, 0.45):
            nxt = [Vector((ctr.x + (v.x - ctr.x) * f, yt + top_rough * nz(v.x * 1.7, yt, v.z * 1.7, seed + 5, 1, 0.4), ctr.z + (v.z - ctr.z) * f)) for v in prev_top]
            quads(cur, nxt, lm, lt)
            cur = nxt
        apex = Vector((ctr.x, yt + top_rough * nz(ctr.x, yt, ctr.z, seed + 6, 1, 0.4), ctr.z))
        for j in range(sides):
            j2 = (j + 1) % sides
            em.face(lm, [cur[j], cur[j2], apex], _jt(rng, lt))
    else:  # flat
        cur = prev_top
        for j in range(1, sides - 1):
            em.face(lm, [prev_top[0], prev_top[j], prev_top[j + 1]], _jt(rng, lt)) if False else None
        em.face(lm, list(prev_top), _jt(rng, lt))
        # ngon (concave-safe via exporter); winding fixed below by flipping if normal points down
        a = p.acc(lm, node)
        f = a.f[-1]
        pts = [a.v[i] for i in f]
        nrm = Vector()
        for k in range(len(pts)):
            q, r = pts[k], pts[(k + 1) % len(pts)]
            nrm.x += (q.y - r.y) * (q.z + r.z)
            nrm.y += (q.z - r.z) * (q.x + r.x)
            nrm.z += (q.x - r.x) * (q.y + r.y)
        if nrm.y < 0:
            a.f[-1] = tuple(reversed(f))
    return dict(rings=ring_list, top_y=yt, center=(cx, cz), sides=sides, y0=y0)


# ------------------------------------------------------------------------------------------------ lumps
def rock_lump(p, mat, c, radii, seed=1, sides=9, rings=4, jag=0.28, flat=True, squash=0.55, tint=None, node=None, rot=0.0):
    rng = random.Random(seed * 17 + 3)
    em = Emitter(p, node, flat)
    cx, cy, cz = c
    rx, ry, rz = radii
    lats = []
    for k in range(1, rings):
        a = -math.pi / 2 + math.pi * k / rings
        lats.append(a)
    prs = []
    for a in lats:
        pts = []
        cy_r = math.cos(a)
        for j in range(sides):
            th = rot + 2 * math.pi * j / sides
            n = nz(cx + math.cos(th) * 3.1, cy + math.sin(a) * 3.1, cz - math.sin(th) * 3.1, seed, 2, 0.35)
            k = 1 + jag * n
            x = cx + rx * cy_r * math.cos(th) * k
            z = cz - rz * cy_r * math.sin(th) * k
            y = cy + ry * math.sin(a) * k
            y = max(y, cy - ry * squash)
            pts.append(Vector((x, y, z)))
        prs.append(pts)
    bot = Vector((cx, cy - ry * squash, cz))
    top = Vector((cx, cy + ry * (1 + jag * nz(cx, cy, cz, seed + 4, 1, 0.5) * 0.5), cz))
    t0 = tint or (1.0, 1.0, 1.0)
    for j in range(sides):
        j2 = (j + 1) % sides
        em.face(mat, [prs[0][j2], prs[0][j], bot], _jt(rng, t0))
        em.face(mat, [prs[-1][j], prs[-1][j2], top], _jt(rng, t0))
    for a, b in zip(prs[:-1], prs[1:]):
        for j in range(sides):
            j2 = (j + 1) % sides
            em.face(mat, [a[j], a[j2], b[j2], b[j]], _jt(rng, t0))


def boulders(p, mat, cx, cz, r_min, r_max, n, s_min, s_max, seed=1, y=0.0, jag=0.3, node=None, strata=None, tint=None, ellipse=(1.0, 1.0)):
    rng = random.Random(seed * 101 + 11)
    for i in range(n):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(r_min, r_max)
        s = rng.uniform(s_min, s_max)
        m = mat
        t = tint
        if isinstance(mat, Strata):
            m, t = mat.at(y + s * 0.3)
        rock_lump(p, m, (cx + r * math.cos(a) * ellipse[0], y + s * 0.15, cz - r * math.sin(a) * ellipse[1]), (s * rng.uniform(0.8, 1.3), s * rng.uniform(0.6, 1.0), s * rng.uniform(0.8, 1.3)),
                  seed=seed * 7 + i, sides=7, rings=3, jag=jag, tint=t, node=node)


def rock_skirt(p, mat_or_strata, cx, cz, y0, r_in, r_out, h, sides=18, seed=1, ellipse=(1.0, 1.0), jag=0.15, node=None, tint=None, rot=0.0):
    rng = random.Random(seed * 13)
    em = Emitter(p, node, True)
    rows = [(y0 - 0.6, r_out, 1.0), (y0 + h * 0.45, r_in + (r_out - r_in) * 0.5, 1.0), (y0 + h, r_in, 1.0)]
    rr = []
    for y, r, _ in rows:
        pts = []
        for j in range(sides):
            th = rot + 2 * math.pi * j / sides
            n = nz(cx + r * math.cos(th), y * 0.5, cz - r * math.sin(th), seed + 21, 2, 1.0 / (r_out * 0.6 + 3))
            rad = r * (1 + jag * n)
            pts.append(Vector((cx + rad * math.cos(th) * ellipse[0], y + (0.0 if y < y0 else 0.3 * n * h * 0.3), cz - rad * math.sin(th) * ellipse[1])))
        rr.append(pts)
    for a, b in zip(rr[:-1], rr[1:]):
        ymid = (a[0].y + b[0].y) / 2
        if isinstance(mat_or_strata, Strata):
            m, t = mat_or_strata.at(max(ymid, y0 + 0.1))
        else:
            m, t = mat_or_strata, tint
        for j in range(sides):
            j2 = (j + 1) % sides
            em.face(m, [a[j], a[j2], b[j2], b[j]], _jt(rng, t))


# ------------------------------------------------------------------------------------------------ strata clipping
def _clip(pts, fn, c, above):
    """Sutherland-Hodgman clip of polygon pts against the surface fn(p) = c (keep fn>=c if above else fn<=c)."""
    out = []
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        fa, fb = fn(a) - c, fn(b) - c
        ina = fa >= 0 if above else fa <= 0
        inb = fb >= 0 if above else fb <= 0
        if ina:
            out.append(a)
        if ina != inb:
            t = fa / (fa - fb)
            out.append(a.lerp(b, t))
    return out


def face_strata(em, pts, strata, rng, dip=(0.0, 0.0), amt=0.06):
    """Add polygon `pts` to the emitter, split into horizontal strata bands (planes y + dip.x*x + dip.z*z = const)."""
    fn = (lambda v: v.y + dip[0] * v.x + dip[1] * v.z)
    vals = [fn(v) for v in pts]
    lo, hi = min(vals), max(vals)
    layers = strata.ensure(hi + 0.01)
    for k, (ya, yb, mat, tint, hard) in enumerate(layers):
        if yb < lo and k < len(layers) - 1:
            continue
        if ya > hi:
            break
        poly = pts
        if ya > lo and k > 0:
            poly = _clip(poly, fn, ya, True)
        if yb < hi and k < len(layers) - 1:
            poly = _clip(poly, fn, yb, False)
        if len(poly) >= 3:
            em.face(mat, poly, _jt(rng, tint, amt))


# ------------------------------------------------------------------------------------------------ sweep (arches)
def rock_sweep(p, rings, mat_or_strata, flat=True, closed=True, node=None, tint=None, invert=False, seed=1, dip=(0.0, 0.0)):
    """Loft polygons (each list of Vector/tuple points, CCW seen from +z, same count) along the list order (increasing z).
    Faces get per-face strata by mid height. invert=True flips faces (for inner surfaces)."""
    rng = random.Random(seed)
    em = Emitter(p, node, flat)
    R = [[Vector(v) for v in r] for r in rings]
    n = len(R[0])
    for a, b in zip(R[:-1], R[1:]):
        for j in range(n if closed else n - 1):
            j2 = (j + 1) % n
            pts = [a[j], a[j2], b[j2], b[j]]
            if invert:
                pts = pts[::-1]
            if isinstance(mat_or_strata, Strata):
                face_strata(em, pts, mat_or_strata, rng, dip)
            else:
                em.face(mat_or_strata, pts, _jt(rng, tint))

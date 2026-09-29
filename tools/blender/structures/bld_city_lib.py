"""bld_city_lib.py - ruined-city building generator built on slib (fork A).

A `Block` is a rectangular multi-storey volume (x0..x1, z0..z1, F floors of height fh).  It is built from
 * interior volumes (dark boxes, vertical runs per cell column, greedily merged) - they close the building and read as dark voids,
 * facade cells per side/floor/bay: spandrel + header quads, recessed reveal (sill top / header underside), glass panes (some broken),
 * piers (vertical runs) with rebar stubs where they are snapped,
 * floor-slab stubs protruding into wounds, bare columns standing in wounds, roof slabs + parapets.
`Wound` shapes (sphere / box / half-space, with noise jaggedness) remove cells: that is where the ruin comes from.
Sides: F (+Z, front), L (+X), B (-Z), R (-X).
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *
from mathutils import Vector

BIG = 1e9
UPV = Vector((0, 1, 0))
SIDEN = {"F": (0, 0, 1), "L": (1, 0, 0), "B": (0, 0, -1), "R": (-1, 0, 0)}
INWARD_FACE = {"F": "nz", "L": "nx", "B": "pz", "R": "px"}


# ------------------------------------------------------------------------------------------- wounds
class Wound:
    """kind: 'sph' (c, r) | 'box' (lo, hi; None = unbounded) | 'half' (n, d): removed where dot(n, p) > d.  jag = noise amplitude (m)."""

    def __init__(self, kind, jag=1.5, seed=1, **kw):
        self.kind, self.jag, self.seed = kind, jag, seed
        self.kw = kw

    def test(self, x, y, z, k=1.0):
        j = 0.0
        if self.jag:
            j = (noise3(x, y, z, self.seed, 2, 0.22) - 0.5) * 2 * self.jag
        m = (1.0 - k) * 2.5  # shrink margin in metres for k < 1
        if self.kind == "sph":
            cx, cy, cz = self.kw["c"]
            r = self.kw["r"] + j - m
            return (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 < r * r
        if self.kind == "box":
            lo, hi = self.kw["lo"], self.kw["hi"]
            p = (x, y, z)
            for i in range(3):
                l = -BIG if lo[i] is None else lo[i] + j + m
                h = BIG if hi[i] is None else hi[i] - j - m
                if not (l < p[i] < h):
                    return False
            return True
        if self.kind == "half":
            n, d = self.kw["n"], self.kw["d"]
            return n[0] * x + n[1] * y + n[2] * z > d + j + m
        return False


def removed(wounds, x, y, z, k=1.0):
    for w in wounds:
        if w.test(x, y, z, k):
            return True
    return False


# ------------------------------------------------------------------------------------------- rebar / rubble
def rebar_tuft(p, x, y, z, n=4, length=(0.5, 1.5), spread=0.35, rng=None, r=0.014):
    rng = rng or random
    for _ in range(n):
        dx, dz = rng.uniform(-spread, spread), rng.uniform(-spread, spread)
        L = rng.uniform(*length)
        tilt = rng.uniform(0.0, 0.5)
        ang = rng.uniform(0, 6.28)
        p.tube("rebar", (x + dx, y, z + dz), (x + dx + math.cos(ang) * tilt * L, y + L, z + dz + math.sin(ang) * tilt * L), r, sides=3, caps=False, smooth=False)


def rubble(p, cx, cz, rx, rz, n, rng, y=0.0, mats=("concrete", "concrete_dark", "concrete", "brick"), big=1.6, rebar=3, yaw=0.0):
    """Mound of broken slabs/blocks in an ellipse."""
    for i in range(n):
        a = rng.uniform(0, 6.283)
        rr = math.sqrt(rng.uniform(0.0, 1.0))
        x, z = cx + math.cos(a) * rx * rr, cz + math.sin(a) * rz * rr
        h = (1.0 - rr) ** 0.8
        s = rng.uniform(0.35, big) * (0.6 + 0.6 * h)
        sy = s * rng.uniform(0.25, 0.8)
        yy = y + h * big * 0.75 * rng.uniform(0.5, 1.0) + sy * 0.4
        p.box(rng.choice(mats), (x, yy, z), (s * rng.uniform(0.8, 1.7), sy, s * rng.uniform(0.7, 1.4)),
              rot=(rng.uniform(-25, 25), rng.uniform(0, 180), rng.uniform(-25, 25)), tint=rng.uniform(0.7, 1.05))
    for i in range(rebar):
        a = rng.uniform(0, 6.283)
        rr = math.sqrt(rng.uniform(0.0, 0.7))
        rebar_tuft(p, cx + math.cos(a) * rx * rr, y + big * 0.5 * (1 - rr), cz + math.sin(a) * rz * rr, n=3, length=(0.6, 1.6), rng=rng)


def lean(p, kx=0.0, kz=0.0, curve=0.0, y_pivot=0.0):
    """Shear all geometry (and collision hulls): x += kx*h*(1+curve*h)."""
    def f(v):
        h = max(v.y - y_pivot, 0.0)
        s = h * (1.0 + curve * h)
        v.x += kx * s
        v.z += kz * s
    for a in p.accs.values():
        for v in a.v:
            f(v)
    for vs, _ in p.cols:
        for v in vs:
            f(v)


def wn(p, seed_off=0):
    return random.Random(p.seed * 31 + seed_off)


# ------------------------------------------------------------------------------------------- block
class Block:
    def __init__(self, p, x0, x1, z0, z1, F, fh, nx, nz, y0=0.0, wounds=(), sp=1.0, wh=1.9, pw=0.7, proud=0.15, depth=0.5,
                 msp="concrete_dark", mpier="concrete", mhead=None, mroof="concrete", glass="glass", pbroken=0.45,
                 sides="FLBR", side_from=None, rng=None, floor_style=None, int_tint=0.28, parapet=0.9, lip=False,
                 pier_runs=True, bays_pattern=None, mtop_par=None, tint_var=0.1, roof=True, p_missing=0.0, pier_sub=7.5, sills=False, stub_keep=0.4, rebar_k=1.0, skip_bays=None, mult=(1.0, 1.0, 1.0), soot_amt=1.0, curtain_p=0.0, ac_p=0.0):
        self.p, self.x0, self.x1, self.z0, self.z1 = p, x0, x1, z0, z1
        self.F, self.fh, self.nx, self.nz, self.y0 = F, fh, nx, nz, y0
        self.bx, self.bz = (x1 - x0) / nx, (z1 - z0) / nz
        self.wounds = list(wounds)
        self.sp, self.wh, self.pw, self.proud, self.depth = sp, wh, pw, proud, depth
        self.msp, self.mpier, self.mhead = msp, mpier, mhead or msp
        self.mroof, self.glass, self.pbroken = mroof, glass, pbroken
        self.sides = sides
        self.side_from = side_from or {}
        self.rng = rng or random.Random(3)
        self.floor_style = floor_style or {}
        self.int_tint = int_tint
        self.parapet = parapet
        self.lip = lip
        self.tint_var = tint_var
        self.roof = roof
        self.mtop_par = mtop_par
        self.p_missing = p_missing
        self.sills = sills
        self.skip_bays = skip_bays or {}
        self.mult = mult if isinstance(mult, tuple) else (mult, mult, mult)
        self.soot_amt = soot_amt
        self.curtain_p = curtain_p
        self.ac_p = ac_p
        self.stub_keep = stub_keep
        self.rebar_k = rebar_k
        self.pier_sub = pier_sub
        self._compute_alive()

    # -- geometry helpers
    def yf(self, f):
        return self.y0 + f * self.fh

    def cell_center(self, ix, iz):
        return self.x0 + (ix + 0.5) * self.bx, self.z0 + (iz + 0.5) * self.bz

    def alive(self, f, ix, iz):
        if f < 0 or f >= self.F or ix < 0 or ix >= self.nx or iz < 0 or iz >= self.nz:
            return False
        return self.A[f][ix][iz]

    def _compute_alive(self):
        self.A = []
        for f in range(self.F):
            ym = self.yf(f) + self.fh * 0.5
            plane = []
            for ix in range(self.nx):
                col = []
                for iz in range(self.nz):
                    cx, cz = self.cell_center(ix, iz)
                    col.append(not removed(self.wounds, cx, ym, cz, 1.0))
                plane.append(col)
            self.A.append(plane)

    def soot(self, x, y, z):
        if not self.wounds or self.soot_amt <= 0:
            return 1.0
        for k, v in ((1.9, 0.5), (2.7, 0.68), (3.6, 0.84)):
            if removed(self.wounds, x, y, z, k):
                return 1.0 - (1.0 - v) * self.soot_amt
        return 1.0

    def roof_at(self, x, z, margin=0.0):
        """Y of the top of the surviving stack at world (x, z) (before lean), or None if nothing stands there."""
        ix = int((x - self.x0) / self.bx)
        iz = int((z - self.z0) / self.bz)
        if ix < 0 or ix >= self.nx or iz < 0 or iz >= self.nz:
            return None
        for f in range(self.F - 1, -1, -1):
            if self.alive(f, ix, iz):
                return self.yf(f + 1)
        return None

    # -- side frame
    def side_frame(self, s):
        n = Vector(SIDEN[s])
        t = UPV.cross(n)
        O = {"F": Vector((self.x0, 0, self.z1)), "L": Vector((self.x1, 0, self.z1)),
             "B": Vector((self.x1, 0, self.z0)), "R": Vector((self.x0, 0, self.z0))}[s]
        length = (self.x1 - self.x0) if s in "FB" else (self.z1 - self.z0)
        nb = self.nx if s in "FB" else self.nz
        return n, t, O, length, nb

    def bay_cell(self, s, b):
        if s == "F":
            return b, self.nz - 1
        if s == "L":
            return self.nx - 1, self.nz - 1 - b
        if s == "B":
            return self.nx - 1 - b, 0
        return 0, b

    @staticmethod
    def P(O, t, n, u, d, y):
        return Vector((O.x + t.x * u - n.x * d, y, O.z + t.z * u - n.z * d))

    # -- interior volumes -------------------------------------------------------------------
    def build_interior(self):
        p = self.p
        groups = {}
        for ix in range(self.nx):
            for iz in range(self.nz):
                f = 0
                while f < self.F:
                    if self.alive(f, ix, iz):
                        a = f
                        while f < self.F and self.alive(f, ix, iz):
                            f += 1
                        groups.setdefault((a, f), set()).add((ix, iz))
                    else:
                        f += 1
        self.rects = []
        d = self.depth
        for (a, b), cells in groups.items():
            rows = {}
            for ix, iz in cells:
                rows.setdefault(iz, []).append(ix)
            runs = {}
            for iz, xs in rows.items():
                xs.sort()
                st = xs[0]
                prev = xs[0]
                for x in xs[1:] + [None]:
                    if x is None or x != prev + 1:
                        runs.setdefault(iz, []).append((st, prev + 1))
                        if x is not None:
                            st = x
                    prev = x if x is not None else prev
            # vertical merge of identical x runs
            open_ = {}
            rects = []
            for iz in range(self.nz + 1):
                cur = set(runs.get(iz, []))
                for key in list(open_.keys()):
                    if key not in cur:
                        rects.append((key[0], key[1], open_.pop(key), iz))
                for key in cur:
                    if key not in open_:
                        open_[key] = iz
            for (ix0, ix1, iz0, iz1) in rects:
                self.rects.append((a, b, ix0, ix1, iz0, iz1))
                xa = self.x0 + ix0 * self.bx + (d if ix0 == 0 else 0)
                xb = self.x0 + ix1 * self.bx - (d if ix1 == self.nx else 0)
                za = self.z0 + iz0 * self.bz + (d if iz0 == 0 else 0)
                zb = self.z0 + iz1 * self.bz - (d if iz1 == self.nz else 0)
                ya = self.yf(a)
                yb = self.yf(b) - 0.4
                skip = () if a > 0 else ("ny",)
                p.bx("concrete_dark", (xa, xb), (ya, yb), (za, zb), skip=skip, tint=self.int_tint)
                if self.roof:
                    # roof / top slab (bright), flush with facade plane minus 3 cm
                    xa2 = self.x0 + ix0 * self.bx + (0.03 if ix0 == 0 else 0)
                    xb2 = self.x0 + ix1 * self.bx - (0.03 if ix1 == self.nx else 0)
                    za2 = self.z0 + iz0 * self.bz + (0.03 if iz0 == 0 else 0)
                    zb2 = self.z0 + iz1 * self.bz - (0.03 if iz1 == self.nz else 0)
                    p.bx(self.mroof, (xa2, xb2), (yb, yb + 0.4), (za2, zb2), skip=("ny",), sub=6.0)

    # -- facade -----------------------------------------------------------------------------
    def fstyle(self, f):
        st = dict(sp=self.sp, wh=self.wh, msp=self.msp, mhead=self.mhead, pbroken=self.pbroken)
        st.update(self.floor_style.get(f, {}))
        return st

    def build_facade(self, s):
        p, rng = self.p, self.rng
        n, t, O, length, nb = self.side_frame(s)
        bay = length / nb
        d0 = self.depth
        pw = self.pw
        f_from = self.side_from.get(s, 0)
        rng0 = random.Random(ord(s) * 13 + 7)
        ok = {}
        for f in range(f_from, self.F):
            ym = self.yf(f) + self.fh * 0.5
            row = []
            for b in range(nb):
                ix, iz = self.bay_cell(s, b)
                good = self.alive(f, ix, iz)
                if good:
                    c = self.P(O, t, n, (b + 0.5) * bay, 0.0, ym)
                    good = not removed(self.wounds, c.x, ym, c.z, 1.0)
                    if good and self.p_missing and rng0.random() < self.p_missing and f < self.F - 1:
                        good = False
                    if b in self.skip_bays.get(s, ()):
                        good = False
                row.append(good)
            ok[f] = row
        # facade cells (one set of quads per bay so tint/soot can vary per bay)
        P = self.P
        mult = self.mult
        for f in range(f_from, self.F):
            st = self.fstyle(f)
            sp, wh = st["sp"], st["wh"]
            ya, yb = self.yf(f), self.yf(f) + self.fh
            yw0, yw1 = ya + sp, ya + sp + wh
            row = ok[f]
            for bb in range(nb):
                if not row[bb]:
                    continue
                u0, u1 = bb * bay, (bb + 1) * bay
                cc = P(O, t, n, (u0 + u1) / 2, 0.0, 0)
                k0 = (1.0 + rng.uniform(-self.tint_var, self.tint_var)) * self.soot(cc.x, (ya + yb) / 2, cc.z)
                tint = (k0 * mult[0], k0 * mult[1], k0 * mult[2])
                tint_h = tuple(c * 0.94 for c in tint)
                p.quad(st["msp"], P(O, t, n, u0, 0, ya), P(O, t, n, u1, 0, ya), P(O, t, n, u1, 0, yw0), P(O, t, n, u0, 0, yw0), tint=tint)
                if self.sills:
                    p.quad(st["msp"], P(O, t, n, u0, d0, yw0), P(O, t, n, u0, 0, yw0), P(O, t, n, u1, 0, yw0), P(O, t, n, u1, d0, yw0), tint=tint)
                if yb - yw1 > 0.05:
                    p.quad(st["mhead"], P(O, t, n, u0, 0, yw1), P(O, t, n, u1, 0, yw1), P(O, t, n, u1, 0, yb), P(O, t, n, u0, 0, yb), tint=tint_h)
                    p.quad(st["mhead"], P(O, t, n, u0, 0, yw1), P(O, t, n, u0, d0, yw1), P(O, t, n, u1, d0, yw1), P(O, t, n, u1, 0, yw1), tint=tint_h)
                if self.glass:
                    ua, ub = u0 + pw / 2, u1 - pw / 2
                    r = rng.random()
                    gd = d0 * 0.45
                    if r > st["pbroken"]:
                        p.quad(self.glass, P(O, t, n, ua, gd, yw0), P(O, t, n, ub, gd, yw0), P(O, t, n, ub, gd, yw1), P(O, t, n, ua, gd, yw1))
                    elif r > st["pbroken"] * 0.55:
                        cx = rng.choice((0, 1)); cy = rng.choice((0, 1))
                        ux = (ua, ub)[cx]; uy = (yw0, yw1)[cy]
                        ux2 = ux + (ub - ua) * (0.45 if cx == 0 else -0.45)
                        uy2 = uy + (yw1 - yw0) * (0.55 if cy == 0 else -0.55)
                        pts = [P(O, t, n, ux, gd, uy), P(O, t, n, ux2, gd, uy), P(O, t, n, ux, gd, uy2)]
                        if (cx + cy) % 2 == 1:
                            pts.reverse()
                        p.poly(self.glass, pts, flat=True)
                if self.glass and self.curtain_p and rng.random() < self.curtain_p:
                    ua, ub = u0 + pw / 2 + 0.05, u1 - pw / 2 - 0.05
                    hh = wh * rng.uniform(0.45, 0.9)
                    col = rng.choice(((0.62, 0.5, 0.34), (0.34, 0.4, 0.52), (0.5, 0.26, 0.2), (0.7, 0.68, 0.6)))
                    cd = d0 * 0.3
                    p.quad("canvas", P(O, t, n, ua, cd, yw1 - hh), P(O, t, n, ub, cd, yw1 - hh), P(O, t, n, ub, cd, yw1), P(O, t, n, ua, cd, yw1), tint=col)
                if self.ac_p and rng.random() < self.ac_p and f > 0:
                    ua = u0 + pw / 2 + rng.uniform(0.1, max(0.11, bay - pw - 1.0))
                    sbox(self, s, "metal_bare", ua, ua + 0.8, -0.15, 0.55, yw0 - 0.02, yw0 + 0.5, skip=("ny",), tint=rng.uniform(0.7, 1.0))
                if f == self.F - 1 and self.parapet > 0:
                    pm = self.mtop_par or st["mhead"]
                    ph = self.parapet
                    p.quad(pm, P(O, t, n, u0, 0.0, yb), P(O, t, n, u1, 0.0, yb), P(O, t, n, u1, 0.0, yb + ph), P(O, t, n, u0, 0.0, yb + ph), tint=tint)
                    p.quad(pm, P(O, t, n, u0, 0.3, yb + ph), P(O, t, n, u0, 0.0, yb + ph), P(O, t, n, u1, 0.0, yb + ph), P(O, t, n, u1, 0.3, yb + ph), tint=tint)
                    p.quad(pm, P(O, t, n, u0, 0.3, yb), P(O, t, n, u0, 0.3, yb + ph), P(O, t, n, u1, 0.3, yb + ph), P(O, t, n, u1, 0.3, yb), tint=tuple(c * 0.6 for c in tint))
        # piers
        for g in range(nb + 1):
            f = f_from
            while f < self.F:
                def has(ff):
                    return (g - 1 >= 0 and ok[ff][g - 1]) or (g < nb and ok[ff][g])
                if not has(f):
                    f += 1
                    continue
                fa = f
                while f < self.F and has(f):
                    f += 1
                fb = f
                corner = g == 0 or g == nb
                w = self.pw * (1.5 if corner else 1.0)
                u = g * bay
                if g == 0:
                    ua, ub_ = u, u + w
                elif g == nb:
                    ua, ub_ = u - w, u
                else:
                    ua, ub_ = u - w / 2, u + w / 2
                ya_, yb_ = self.yf(fa), self.yf(fb)
                P = self.P
                pr, dp = self.proud, self.depth + 0.1
                tn = 1.0 + rng.uniform(-0.08, 0.08)
                m_ = self.mpier
                ucen = (ua + ub_) / 2
                cpos = P(O, t, n, ucen, 0.0, 0)

                def chunks(step):
                    k = max(1, int(math.ceil((yb_ - ya_) / step - 1e-6)))
                    return [(ya_ + (yb_ - ya_) * i / k, ya_ + (yb_ - ya_) * (i + 1) / k) for i in range(k)]
                for (c0, c1) in chunks(self.pier_sub):
                    k0 = tn * self.soot(cpos.x, (c0 + c1) / 2, cpos.z)
                    tt = (k0 * mult[0], k0 * mult[1], k0 * mult[2])
                    p.quad(m_, P(O, t, n, ua, -pr, c0), P(O, t, n, ub_, -pr, c0), P(O, t, n, ub_, -pr, c1), P(O, t, n, ua, -pr, c1), tint=tt)
                for (c0, c1) in chunks(self.pier_sub * 1.6):
                    k0 = tn * 0.92 * self.soot(cpos.x, (c0 + c1) / 2, cpos.z)
                    tt = (k0 * mult[0], k0 * mult[1], k0 * mult[2])
                    p.quad(m_, P(O, t, n, ua, dp, c0), P(O, t, n, ua, -pr, c0), P(O, t, n, ua, -pr, c1), P(O, t, n, ua, dp, c1), tint=tt)
                    p.quad(m_, P(O, t, n, ub_, -pr, c0), P(O, t, n, ub_, dp, c0), P(O, t, n, ub_, dp, c1), P(O, t, n, ub_, -pr, c1), tint=tt)
                p.quad(m_, P(O, t, n, ua, dp, yb_), P(O, t, n, ua, -pr, yb_), P(O, t, n, ub_, -pr, yb_), P(O, t, n, ub_, dp, yb_), tint=tn)
                if fa > 0:
                    p.quad(m_, P(O, t, n, ua, -pr, ya_), P(O, t, n, ua, dp, ya_), P(O, t, n, ub_, dp, ya_), P(O, t, n, ub_, -pr, ya_), tint=0.6)
                if fb < self.F and self.pw > 0:
                    c = self.P(O, t, n, u, self.depth * 0.4, self.yf(fb))
                    rebar_tuft(p, c.x, self.yf(fb), c.z, n=max(1, int(2 * self.rebar_k)), length=(0.5, 1.4), rng=rng)

    # -- slab stubs / bare columns ------------------------------------------------------------
    def build_wound_detail(self):
        p, rng = self.p, self.rng
        # slab stubs into dead neighbours
        dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        for f in range(self.F):
            for ix in range(self.nx):
                for iz in range(self.nz):
                    if not self.alive(f, ix, iz):
                        continue
                    for dx, dz in dirs:
                        jx, jz = ix + dx, iz + dz
                        if jx < 0 or jx >= self.nx or jz < 0 or jz >= self.nz:
                            continue
                        if self.alive(f, jx, jz):
                            continue
                        if rng.random() > self.stub_keep:
                            continue
                        cx, cz = self.cell_center(ix, iz)
                        L = rng.uniform(0.6, (self.bx if dx else self.bz) * 0.9)
                        wdt = (self.bz if dx else self.bx) * rng.uniform(0.35, 0.95)
                        half = (self.bx if dx else self.bz) / 2
                        # stub centre
                        ex = cx + dx * (half + L / 2 - 0.3)
                        ez = cz + dz * (half + L / 2 - 0.3)
                        off = rng.uniform(-1, 1) * ((self.bz if dx else self.bx) - wdt) / 2
                        if dx:
                            ez += off
                        else:
                            ex += off
                        sz = (L + 0.6, 0.38, wdt) if dx else (wdt, 0.38, L + 0.6)
                        droop = rng.uniform(0, 16)
                        # droop about the attachment edge: pitch in the direction away from the building
                        rot = (0, 0, 0)
                        if dx:
                            rot = (0, 0, -droop * dx)
                        else:
                            rot = (droop * dz, 0, 0)
                        y = self.yf(f) + 0.2 - (math.sin(math.radians(droop)) * L * 0.5)
                        inner = ("nx" if dx > 0 else "px") if dx else ("nz" if dz > 0 else "pz")
                        p.box(self.mroof, (ex, y, ez), sz, rot=rot, sub=0, tint=rng.uniform(0.8, 1.0), skip=(inner,))
                        if rng.random() < 0.55:
                            tx = cx + dx * (half + L - 0.3)
                            tz = cz + dz * (half + L - 0.3)
                            rebar_tuft(p, tx + (rng.uniform(-1, 1) * wdt / 2 if not dx else 0), y, tz + (rng.uniform(-1, 1) * wdt / 2 if dx else 0), n=1, length=(0.3, 0.9), spread=0.2, rng=rng)
        # bare columns at grid vertices
        for gi in range(self.nx + 1):
            for gj in range(self.nz + 1):
                x, z = self.x0 + gi * self.bx, self.z0 + gj * self.bz
                interior = 0 < gi < self.nx and 0 < gj < self.nz
                exist = []
                vis = []
                prev = False
                for f in range(self.F):
                    adj = [(gi - 1, gj - 1), (gi, gj - 1), (gi - 1, gj), (gi, gj)]
                    al = [self.alive(f, a, b) for a, b in adj]
                    inb = [0 <= a < self.nx and 0 <= b < self.nz for a, b in adj]
                    ym = self.yf(f) + self.fh * 0.5
                    cw = removed(self.wounds, x, ym, z, 0.55)
                    e = (any(al) or prev) and not cw
                    # visible = some in-block adjacent cell is dead
                    v = e and any((not al[i]) and inb[i] for i in range(4))
                    exist.append(e)
                    vis.append(v)
                    prev = e
                f = 0
                while f < self.F:
                    if not vis[f]:
                        f += 1
                        continue
                    fa = f
                    while f < self.F and exist[f]:
                        f += 1
                    fb = f
                    ytop = self.yf(fb)
                    p.bx("concrete", (x - 0.32, x + 0.32), (self.yf(fa), ytop), (z - 0.32, z + 0.32), skip=("ny",) if fa == 0 else (), sub=3.0, tint=rng.uniform(0.8, 1.0))
                    if fb < self.F:
                        rebar_tuft(p, x, ytop, z, n=max(1, int(3 * self.rebar_k)), length=(0.7, 2.0), spread=0.22, rng=rng)

    def collision(self):
        for (a, b, ix0, ix1, iz0, iz1) in self.rects:
            xa = self.x0 + ix0 * self.bx
            xb = self.x0 + ix1 * self.bx
            za = self.z0 + iz0 * self.bz
            zb = self.z0 + iz1 * self.bz
            self.p.cbx((xa, xb), (self.yf(a) if a > 0 else 0.0, self.yf(b)), (za, zb))

    def build(self):
        self.build_interior()
        for s in self.sides:
            self.build_facade(s)
        self.build_wound_detail()
        self.collision()


# ------------------------------------------------------------------------------------------- rooftop props
def water_tank(p, x, y, z, r=1.6, h=2.6, legs=1.6, rng=None, mat="wood"):
    for sx, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        p.tube("metal_dark", (x + sx * r * 0.7, y, z + sz * r * 0.7), (x + sx * r * 0.7, y + legs, z + sz * r * 0.7), 0.08, sides=4, smooth=False)
    p.tube("metal_dark", (x - r * 0.7, y + legs * 0.5, z - r * 0.7), (x + r * 0.7, y + legs * 0.5, z + r * 0.7), 0.04, sides=4, smooth=False)
    p.tube("metal_dark", (x + r * 0.7, y + legs * 0.5, z - r * 0.7), (x - r * 0.7, y + legs * 0.5, z + r * 0.7), 0.04, sides=4, smooth=False)
    p.cyl(mat, (x, y + legs + h / 2, z), r, h, "y", sides=12, smooth=True)
    p.cyl("metal_dark", (x, y + legs + h * 0.3, z), r * 1.015, 0.1, "y", sides=12)
    p.cyl("metal_dark", (x, y + legs + h * 0.75, z), r * 1.015, 0.1, "y", sides=12)
    p.cyl("metal_dark", (x, y + legs + h + 0.35, z), r * 1.0, 0.7, "y", sides=12, r2=0.15)


def mech_box(p, x, y, z, sx, sy, sz, mat="metal_bare", rot=0.0):
    p.box(mat, (x, y + sy / 2, z), (sx, sy, sz), rot=(0, rot, 0), sub=0, tint=0.9)
    p.box("metal_dark", (x, y + sy + 0.05, z), (sx * 0.8, 0.1, sz * 0.8), rot=(0, rot, 0))


def antenna(p, x, y, z, h=10.0, lean=(0.0, 0.0), rng=None, crossbars=3):
    top = (x + lean[0] * h, y + h, z + lean[1] * h)
    p.tube("metal_dark", (x, y, z), top, 0.06, sides=5, r2=0.03)
    for i in range(crossbars):
        t = 0.45 + 0.17 * i
        c = (x + (top[0] - x) * t, y + h * t, z + (top[2] - z) * t)
        w = 1.2 * (1.0 - t * 0.6)
        p.tube("metal_dark", (c[0] - w, c[1], c[2]), (c[0] + w, c[1], c[2]), 0.025, sides=4, smooth=False)


def cloth_hang(p, ux, y, z, side_n, w=1.2, h=2.5, tint=1.0):
    """A ragged curtain of canvas hanging out of a broken window (double-sided material)."""
    pass


# ------------------------------------------------------------------------------------------- facade add-ons
def sbox(blk, s, mat, ua, ub, d0, d1, ya, yb, **kw):
    """Axis-aligned box in side coordinates: u along the side, d0..d1 measured OUTWARD from the facade plane."""
    n, t, O, length, nb = blk.side_frame(s)
    a = Block.P(O, t, n, ua, -d0, ya)
    b = Block.P(O, t, n, ub, -d1, yb)
    return blk.p.bx(mat, (min(a.x, b.x), max(a.x, b.x)), (min(ya, yb), max(ya, yb)), (min(a.z, b.z), max(a.z, b.z)), **kw)


def side_pt(blk, s, u, d_out, y):
    n, t, O, length, nb = blk.side_frame(s)
    return Block.P(O, t, n, u, -d_out, y)


def balconies(blk, s, floors, prob, rng, depth=1.4, inset=0.45, rail_mat="metal_dark", slab_mat="concrete", collapse=0.15):
    n, t, O, length, nb = blk.side_frame(s)
    bay = length / nb
    p = blk.p
    for f in floors:
        y = blk.yf(f)
        for b in range(nb):
            ix, iz = blk.bay_cell(s, b)
            if not blk.alive(f, ix, iz):
                continue
            c = side_pt(blk, s, (b + 0.5) * bay, 0.0, y + 1.0)
            if removed(blk.wounds, c.x, y + 1.0, c.z, 1.0):
                continue
            if rng.random() > prob:
                continue
            ua, ub = b * bay + inset, (b + 1) * bay - inset
            if rng.random() < collapse:
                # torn-off balcony: slab tilted down, rail gone
                dr = rng.uniform(18, 40)
                pc = side_pt(blk, s, (ua + ub) / 2, depth * 0.45, y + 0.1)
                rot = {"F": (dr, 0, 0), "B": (-dr, 0, 0), "L": (0, 0, -dr), "R": (0, 0, dr)}[s]
                sx_, sz_ = (ub - ua, depth) if s in "FB" else (depth, ub - ua)
                p.box(slab_mat, (pc.x, y + 0.1 - depth * 0.2, pc.z), (sx_, 0.18, sz_), rot=rot, tint=0.85)
                rebar_tuft(p, pc.x, y, pc.z, n=1, length=(0.4, 0.9), rng=rng)
                continue
            sbox(blk, s, slab_mat, ua, ub, -0.1, depth, y - 0.02, y + 0.18, tint=rng.uniform(0.85, 1.0))
            ends = ("px", "nx") if s in "FB" else ("pz", "nz")
            sbox(blk, s, rail_mat, ua, ub, depth - 0.05, depth, y + 0.18, y + 1.1, skip=("ny",) + ends, tint=0.9)


def awning(blk, s, y, rng, out=2.2, drop=0.7, u0=0.0, u1=None, stripe=((0.85, 0.22, 0.16), (0.85, 0.8, 0.66)), seg=1.0, tear=0.15):
    n, t, O, length, nb = blk.side_frame(s)
    u1 = length if u1 is None else u1
    p = blk.p
    k = max(1, int((u1 - u0) / seg))
    w = (u1 - u0) / k
    for i in range(k):
        if rng.random() < tear:
            continue
        ua, ub = u0 + i * w, u0 + (i + 1) * w
        sag = rng.uniform(0.0, 0.5) if rng.random() < 0.4 else 0.0
        a0 = side_pt(blk, s, ua, 0.0, y)
        a1 = side_pt(blk, s, ub, 0.0, y)
        b1 = side_pt(blk, s, ub, out, y - drop - sag)
        b0 = side_pt(blk, s, ua, out, y - drop - sag)
        p.quad("canvas", a0, a1, b1, b0, tint=stripe[i % 2], sub=0)
    # frame rods
    for i in range(0, k + 1, 2):
        ua = u0 + i * w
        p.tube("metal_dark", side_pt(blk, s, ua, 0.0, y), side_pt(blk, s, ua, out, y - drop), 0.03, sides=4, smooth=False)

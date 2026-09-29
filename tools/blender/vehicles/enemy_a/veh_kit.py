"""Detailed hard-surface kit for the enemy_a raiders: lamps (housing + reflector bowl + lens + bezel, taped / caged / broken variants),
spikes, weld beads, mesh guards, junk (jerry cans, spare tyres, crates, tarp rolls, ammo boxes, chains), cabin parts (bucket + bench seats,
dash, door cards, steering wheel).  Coordinates as in veh_lib: x = left(+), f = forward(+), z = up.

Every part is built into ONE bmesh per call with per-face material indices (KB), so a lamp is one object with 3-4 materials.
"""
from veh_lib import *
from veh_lib import _new_obj, _fix_normals


# ------------------------------------------------------------------------------------------ small vector helpers (x,f,z space)
def V3(p):
    return Vector((p[0], p[1], p[2]))


def basis(d, up=(0, 0, 1)):
    """Orthonormal frame (U, Vv, D) in (x,f,z) space: D = d, Vv ~ up, U = D x up."""
    D = V3(d).normalized()
    Up = V3(up)
    U = D.cross(Up)
    if U.length < 1e-6:
        U = D.cross(Vector((0, 1, 0)))
    U.normalize()
    Vv = U.cross(D).normalized()
    return U, Vv, D


def xfz(v):
    """(x,f,z) Vector -> Blender Vector."""
    return Vector((v[0], -v[1], v[2]))


class KB:
    """Multi-material bmesh accumulator.  add faces with mat index via .mi(name)."""

    def __init__(self, name, g="body"):
        self.name, self.g = name, g
        self.bm = bmesh.new()
        self.mats = []

    def mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def vert(self, p):
        """p in (x,f,z) (tuple or Vector)."""
        return self.bm.verts.new(xfz(p))

    def face(self, vs, m):
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = self.mi(m)
        return f

    def recalc(self, faces):
        faces = [f for f in faces if f is not None and f.is_valid]
        if faces:
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)

    def done(self, smooth=False, sharp=40.0, flat=None):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        o = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(o)
        for m in self.mats:
            me.materials.append(rod_lib._MATS.get(m) or mat(m))
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
            try:
                me.set_sharp_from_angle(angle=sharp * D2R)
            except Exception:
                pass
        reg(o, self.g)
        if flat is True:
            mark_flat(o)
        elif flat is False and me.attributes.get("flat") is not None:
            me.attributes.remove(me.attributes["flat"])
        return o


# ------------------------------------------------------------------------------------------ generic sweeps
def stack(K, c, d, outline, prof, mats, up=(0, 0, 1), cap0=True, cap1=True):
    """Solid 'stack': an outline (unit 2D loop [(u,v)]) scaled by s and pushed along D by w for each prof entry (s, w[, du, dv]).
    s == 0 collapses to a pole.  mats: one material name, or a list per profile segment (len(prof)-1).  Returns faces."""
    U, Vv, D = basis(d, up)
    C = V3(c)
    rings = []
    for e in prof:
        s, w = e[0], e[1]
        du = e[2] if len(e) > 2 else 0.0
        dv = e[3] if len(e) > 3 else 0.0
        if s <= 1e-7:
            rings.append([K.vert(C + D * w + U * du + Vv * dv)])
        else:
            rings.append([K.vert(C + U * (u * s + du) + Vv * (v * s + dv) + D * w) for u, v in outline])
    faces = []
    n = len(outline)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        m = mats if isinstance(mats, str) else mats[min(i, len(mats) - 1)]
        if len(a) == 1 and len(b) == 1:
            continue
        for j in range(n):
            k = (j + 1) % n
            if len(a) == 1:
                faces.append(K.face((a[0], b[j], b[k]), m))
            elif len(b) == 1:
                faces.append(K.face((a[j], a[k], b[0]), m))
            else:
                faces.append(K.face((a[j], a[k], b[k], b[j]), m))
    m0 = mats if isinstance(mats, str) else mats[0]
    m1 = mats if isinstance(mats, str) else mats[-1]
    if cap0 and len(rings[0]) > 2:
        faces.append(K.face(rings[0][::-1], m0))
    if cap1 and len(rings[-1]) > 2:
        faces.append(K.face(rings[-1], m1))
    K.recalc(faces)
    return faces


def circle(n, a0=0.0):
    return [(math.cos(a0 + 2 * math.pi * i / n), math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]


def rrect_unit(w, h, r, n=3):
    """rounded rectangle outline, size w x h (so scale 1 = real size)."""
    return rrect(w, h, r, n)


def ring_torus(K, c, d, loop, sides, m, up=(0, 0, 1), a0=0.0):
    """Revolve a closed 2D loop [(r, w)] around axis d through c (closed torus-type solid)."""
    U, Vv, D = basis(d, up)
    C = V3(c)
    rings = []
    for i in range(sides):
        a = a0 + 2 * math.pi * i / sides
        ca, sa = math.cos(a), math.sin(a)
        rings.append([K.vert(C + (U * ca + Vv * sa) * r + D * w) for r, w in loop])
    faces = []
    nl = len(loop)
    for i in range(sides):
        a, b = rings[i], rings[(i + 1) % sides]
        for j in range(nl):
            k = (j + 1) % nl
            mm = m if isinstance(m, str) else m[j]
            faces.append(K.face((a[j], a[k], b[k], b[j]), mm))
    K.recalc(faces)
    return faces


def box_k(K, c, s, m, d=(0, 1, 0), up=(0, 0, 1), taper=1.0):
    """Box centred at c, size s = (su, sv, sw) in the (U, Vv, D) frame.  taper scales the +D face."""
    o = rrect(1.0, 1.0, 0.0, 1)
    o = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
    out = [(u * s[0], v * s[1]) for u, v in o]
    return stack(K, c, d, out, [(1.0, -s[2] / 2), (taper, s[2] / 2)], m, up)


def cyl_k(K, c, d, r, length, m, sides=10, r2=None, up=(0, 0, 1)):
    return stack(K, c, d, circle(sides), [(r, -length / 2), (r if r2 is None else r2, length / 2)], m, up)


# ------------------------------------------------------------------------------------------ lamps
def lamp(name, c, r, d=(0, 1, 0), depth=None, shape="round", size=None, housing="metal_dark", bowl="chrome", lens="light_head",
         g="body", tape=None, cage=False, broken=False, sides=14, up=(0, 0, 1), inner=0.66, visor=False, bezel=None):
    """Sealed-beam style lamp facing d with its FRONT face at c.  shape 'round' (radius r) or 'rect' (size=(w,h), r = corner radius).
    housing cup (outer = housing material, inner = reflector bowl material), emissive element deep in the bowl, domed glass cover,
    optional chrome/black bezel ring, tape X ('cloth_tan'/'cloth_dark'), wire cage, broken (no glass, dark insert + shards)."""
    K = KB(name, g)
    if shape == "round":
        out = circle(sides)
        R = r
    else:
        w, h = size
        R = min(w, h) / 2
        out = [(u / R, v / R) for u, v in rrect(w, h, r, 2)]
    depth = depth or R * 1.1
    # housing cup: outer wall -> lip -> inner bowl (reflector)
    prof = [(0.0, -depth), (0.72 * R, -depth), (1.0 * R, -0.5 * depth), (1.08 * R, -0.012), (1.08 * R, 0.0), (0.95 * R, 0.0),
            (0.62 * R, -0.52 * depth), (0.0, -0.58 * depth)]
    mats = [housing, housing, housing, housing, bowl if bezel is None else bezel, bowl, bowl]
    stack(K, c, d, out, prof, mats, up, cap0=False, cap1=False)
    if bezel:
        U, Vv, D = basis(d, up)
        C = V3(c)
        # flat bezel ring proud of the lip
        stack(K, C + D * 0.002, d, out, [(0.93 * R, 0.0), (1.13 * R, 0.0), (1.13 * R, 0.010), (0.93 * R, 0.014)], bezel, up, cap0=False, cap1=False)
    C = V3(c)
    U, Vv, D = basis(d, up)
    if not broken:
        # emissive lens: faceted dome just inside the lip (flute steps catch highlights by day); the chrome bowl shows as a ring
        wz = -0.12 * depth
        li = 0.84 * R
        stack(K, C + D * wz, d, out, [(0.0, -0.01), (li, -0.01), (li, 0.004), (0.78 * li, 0.010), (0.74 * li, 0.008), (0.42 * li, 0.015),
                                        (0.38 * li, 0.013), (0.0, 0.018)], lens, up)
    else:
        wz = -0.30 * depth
        stack(K, C + D * wz, d, out, [(0.0, -0.01), (inner * R, -0.01), (inner * R, 0.004), (0.0, 0.006)], "metal_dark", up)
        # jagged shards left in the rim
        rnd = random.Random(len(name) * 7 + int(abs(c[0]) * 100))
        for k in range(5):
            a = rnd.uniform(0, 2 * math.pi)
            span = rnd.uniform(0.35, 0.8)
            ln = rnd.uniform(0.25, 0.55) * R
            p0 = C + (U * math.cos(a) + Vv * math.sin(a)) * 0.95 * R
            p1 = C + (U * math.cos(a + span) + Vv * math.sin(a + span)) * 0.95 * R
            tip = C + (U * math.cos(a + span / 2) + Vv * math.sin(a + span / 2)) * (0.95 * R - ln) + D * 0.002
            vs = [K.vert(p) for p in (p0, p1, tip)]
            vb = [K.vert(p - D * 0.003) for p in (p0, p1, tip)]
            fs = [K.face(vs, "glass"), K.face(vb[::-1], "glass")]
            for i in range(3):
                j = (i + 1) % 3
                fs.append(K.face((vs[i], vs[j], vb[j], vb[i]), "glass"))
            K.recalc(fs)
    if tape:
        for ang in (40, -40):
            a = ang * D2R
            dirv = U * math.cos(a) + Vv * math.sin(a)
            nrm = D
            side = dirv.cross(nrm).normalized()
            L = 1.02 * R
            p0, p1 = C - dirv * L + D * (0.006 + 0.10 * R), C + dirv * L + D * (0.006 + 0.10 * R)
            tw = 0.18 * R + 0.012
            vs = [K.vert(p0 - side * tw / 2), K.vert(p1 - side * tw / 2), K.vert(p1 + side * tw / 2), K.vert(p0 + side * tw / 2)]
            vb = [K.vert(v.co.copy()) for v in vs]
            for v in vb:
                v.co = v.co - xfz(D) * 0.003
            fs = [K.face(vs, tape), K.face(vb[::-1], tape)]
            for i in range(4):
                j = (i + 1) % 4
                fs.append(K.face((vs[i], vs[j], vb[j], vb[i]), tape))
            K.recalc(fs)
    if visor:
        # half-moon sun visor over the top of the lamp
        stack(K, C + D * 0.03 + Vv * 0.0, d, [(math.cos(a), math.sin(a)) for a in [math.pi * i / 8 for i in range(9)]] + [(math.cos(math.pi * i / 8) * 0.92, math.sin(math.pi * i / 8) * 0.92) for i in range(8, -1, -1)],
              [(1.14 * R, -0.03), (1.14 * R, 0.05)], housing, up)
    o = K.done(smooth=True, sharp=35.0, flat=False)
    if cage:
        cr = 0.0055
        U, Vv, D = basis(d, up)
        C = V3(c)
        front = C + D * (0.05 + 0.1 * R)
        pts = []
        for i in range(17):
            a = 2 * math.pi * i / 16
            pts.append(tuple(front + (U * math.cos(a) + Vv * math.sin(a)) * 1.05 * R))
        tube(name + "_cage", pts, cr, "metal_dark", res=0, g=g)
        for k in (-0.5, 0.0, 0.5):
            a = C + D * (0.05 + 0.1 * R) + U * (k * R) + Vv * (-math.sqrt(max(1 - k * k, 0.0)) * 1.05 * R)
            b = C + D * (0.05 + 0.1 * R) + U * (k * R) + Vv * (math.sqrt(max(1 - k * k, 0.0)) * 1.05 * R)
            tube(name + "_cbar", [tuple(a), tuple(b)], cr, "metal_dark", res=0, g=g)
        for sgn in (1, -1):
            a = C + D * (0.05 + 0.1 * R) + U * (sgn * 1.05 * R)
            b = C + U * (sgn * 1.12 * R) - D * 0.02
            tube(name + "_cleg", [tuple(a), tuple(b)], cr, "metal_dark", res=0, g=g)
    return o


def tail_lamp(name, c, w, h, d=(0, -1, 0), depth=0.07, g="body", housing="metal_dark", bezel="chrome", ribs=4, reverse=0.0,
              broken=False, taped=None, up=(0, 0, 1), rev_side=-1):
    """Rectangular tail-lamp cluster facing d: housing box, bezel frame, ribbed red lens (ribs step alternately), optional reverse
    segment (fraction of width, on the rev_side of U) in light_head, optional broken lens (dark ribs) patched with tape."""
    K = KB(name, g)
    U, Vv, D = basis(d, up)
    C = V3(c)
    out = [(u, v) for u, v in rrect(w, h, min(w, h) * 0.12, 2)]
    stack(K, C - D * depth / 2, d, out, [(1.0, -depth / 2), (1.0, depth / 2 - 0.004)], housing, up)
    # bezel frame (rect ring)
    t = 0.014
    fr = [(1.0 + 2 * t / w, 0.0), (1.0 + 2 * t / w, 0.010), (1.0, 0.012), (1.0, 0.0)]
    stack(K, C, d, out, fr, bezel, up, cap0=False, cap1=False)
    wl = w * (1.0 - reverse)
    lens_u = -rev_side * (w - wl) / 2
    rh = h / ribs
    for i in range(ribs):
        v0 = -h / 2 + i * rh
        cc = C + U * lens_u + Vv * (v0 + rh / 2) + D * (0.001 + (0.003 if i % 2 else 0.0))
        box_k(K, tuple(cc), (wl - 0.006, rh - 0.003, 0.010), "light_tail" if not (broken and i >= ribs - 2) else "metal_dark", d, up, taper=1.0)
    if reverse > 0:
        cc = C + U * (rev_side * (w / 2 - (w - wl) / 2)) + D * 0.002
        box_k(K, tuple(cc), (w - wl - 0.006, h - 0.006, 0.010), "light_head", d, up)
    if taped:
        for k in (-0.25, 0.2):
            cc = C + U * (w * k) + D * 0.010
            box_k(K, tuple(cc), (0.05, h * 1.25, 0.003), taped, d, up)
    return K.done(smooth=False, flat=False)


# ------------------------------------------------------------------------------------------ welding, spikes, plates
def weld(name, pts, r=0.0065, step=0.038, g="body", m="metal_bare", seed=0):
    """Rippled weld bead along a polyline of (x,f,z) points (4-sided section, radius ripples every step)."""
    rnd = random.Random(seed)
    P3 = [V3(p) for p in pts]
    out = []
    for i in range(len(P3) - 1):
        a, b = P3[i], P3[i + 1]
        n = max(int((b - a).length / step), 1)
        for k in range(n):
            out.append(a + (b - a) * (k / n))
    out.append(P3[-1])
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(out) - 1)
    for i, p in enumerate(out):
        q = xfz(p)
        sp.points[i].co = (q.x + rnd.uniform(-0.001, 0.001), q.y + rnd.uniform(-0.001, 0.001), q.z + rnd.uniform(-0.001, 0.001), 1.0)
        sp.points[i].radius = 1.0 if i % 2 == 0 else 0.62
    cu.bevel_depth = r
    cu.bevel_resolution = 0
    cu.use_fill_caps = True
    co = bpy.data.objects.new(name + "_c", cu)
    bpy.context.collection.objects.link(co)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(co.evaluated_get(dg))
    bpy.data.objects.remove(co)
    bpy.data.curves.remove(cu)
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    set_mat(o, rod_lib._MATS.get(m) or mat(m))
    for p in me.polygons:
        p.use_smooth = True
    mark_flat(o)
    return reg(o, g)


def spike(K, base, d, r, length, m="spike", sides=6, collar=True, up=(0, 0, 1)):
    """Spike with a hex collar welded at the base (into KB K)."""
    stack(K, base, d, circle(sides, 0.3), [(r, 0.0), (r * 0.82, length * 0.35), (0.0, length)], m, up, cap0=True, cap1=False)
    if collar:
        stack(K, base, d, circle(6), [(r * 1.45, -0.012), (r * 1.45, 0.018), (r * 1.2, 0.026)], "metal_dark", up)


def spikes(name, items, g="body", m="spike", sides=6, collar=True):
    """items: [(base, dir, r, length), ...] -> one object."""
    K = KB(name, g)
    for base, d, r, L in items:
        up = (0, 0, 1) if abs(V3(d).normalized().z) < 0.9 else (0, 1, 0)
        spike(K, base, d, r, L, m, sides, collar=collar, up=up)
    return K.done(smooth=True, sharp=30.0, flat=True)


def plate(name, quad, t, m="armor", g="body", out=None, rivets=0.09, rivet_m=None, weld_edges=(), seed=0, bevel=0.004, inset=0.022):
    """Armour plate from an outer quad [(x,f,z)]*4 (in order round the plate), thickness t going inward (against `out`).
    rivets: spacing (0 = none).  weld_edges: indices i of edges (quad[i] -> quad[i+1]) that get a weld bead."""
    o = quad_slab(name, quad, t, m, out=out or (0, 0, 1), g=g, bevel=bevel, seg=1)
    pts = [V3(p) for p in quad]
    n = (pts[1] - pts[0]).cross(pts[3] - pts[0]).normalized()
    if out is not None and n.dot(V3(out)) < 0:
        n = -n
    items = []
    if rivets:
        for i in range(4):
            a, b = pts[i], pts[(i + 1) % 4]
            L = (b - a).length
            cnt = max(int(L / rivets), 1)
            # inset the edge toward the plate centre
            ctr = sum(pts, Vector()) / 4
            for k in range(cnt):
                p = a + (b - a) * (k / cnt)
                p = p + (ctr - p).normalized() * inset
                items.append((tuple(p + n * 0.001), tuple(n)))
        bolts(name + "_r", items, 0.0085, 0.0075, rivet_m or m, g=g, cap_dome=True)
    for i in weld_edges:
        a, b = pts[i], pts[(i + 1) % 4]
        weld(name + "_w%d" % i, [tuple(a - n * t * 0.5), tuple(b - n * t * 0.5)], r=0.0065, g=g, m=m, seed=seed + i)
    return o


# ------------------------------------------------------------------------------------------ mesh guards / grilles
def grille(name, corners, nu, nv, bar=0.008, frame=0.022, m="metal_dark", g="body", diag=False, depth=0.012):
    """Welded window guard spanning 4 corners [(x,f,z)] (c0 -> c1 = u edge, c0 -> c3 = v edge): angle-iron frame + bars.
    diag=True makes an expanded-metal diamond lattice instead of a square grid."""
    c = [V3(p) for p in corners]
    K = KB(name, g)
    n = (c[1] - c[0]).cross(c[3] - c[0]).normalized()

    def bar_k(p0, p1, wdt, dep, mm):
        dvec = (p1 - p0)
        L = dvec.length
        if L < 1e-5:
            return
        dd = dvec / L
        side = dd.cross(n).normalized()
        q = [p0 - side * wdt / 2, p1 - side * wdt / 2, p1 + side * wdt / 2, p0 + side * wdt / 2]
        a = [K.vert(v + n * dep / 2) for v in q]
        b = [K.vert(v - n * dep / 2) for v in q]
        fs = [K.face(a, mm), K.face(b[::-1], mm)]
        for i in range(4):
            j = (i + 1) % 4
            fs.append(K.face((a[i], a[j], b[j], b[i]), mm))
        K.recalc(fs)

    def at(u, v):
        return c[0] + (c[1] - c[0]) * u + (c[3] - c[0]) * v + ((c[2] - c[1]) - (c[3] - c[0])) * (u * v)

    for i in range(4):
        bar_k(c[i], c[(i + 1) % 4], frame, depth * 1.6, m)
    if not diag:
        for i in range(1, nu):
            bar_k(at(i / nu, 0), at(i / nu, 1), bar, depth, m)
        for j in range(1, nv):
            bar_k(at(0, j / nv), at(1, j / nv), bar, depth, m)
    else:
        # diamond lattice: lines u = s +- a*v (a = nu/nv so one diamond spans one u- and one v-cell), clipped to the unit square
        a = float(nv) / float(nu)
        for sgn in (1, -1):
            for k in range(-nv - 1, nu + nv + 2):
                s0 = k / nu
                # v range where 0 <= s0 + sgn*a*v <= 1
                if sgn > 0:
                    v0, v1 = max(0.0, (0.0 - s0) / a), min(1.0, (1.0 - s0) / a)
                else:
                    v0, v1 = max(0.0, (s0 - 1.0) / a), min(1.0, s0 / a)
                if v1 - v0 < 1e-3:
                    continue
                bar_k(at(s0 + sgn * a * v0, v0), at(s0 + sgn * a * v1, v1), bar, depth, m)
    return K.done(smooth=False, flat=True)


# ------------------------------------------------------------------------------------------ junk
def jerry_can(name, c, yaw=0.0, m="armor", g="body", lie=False, s=1.0):
    """20 l jerry can at c (bottom centre), broad faces facing +-x when yaw = 0.  lie=True: lying on a broad face.
    Body 0.34 (f) x 0.165 (x) x 0.47 (z) at s = 1."""
    K = KB(name, g)
    W, T, H = 0.34 * s, 0.165 * s, 0.47 * s
    # built standing at the origin in (x,f,z): width along f, thickness along x, height along z
    outl = [(u, v) for u, v in rrect(W, T, 0.03 * s, 1)]
    stack(K, (0, 0, 0), (0, 0, 1), outl, [(0.96, 0.0), (1.0, 0.02 * s), (1.0, H - 0.05 * s), (0.97, H - 0.02 * s), (0.9, H)], m, up=(1, 0, 0))
    U, Vv, D = basis((0, 0, 1), (1, 0, 0))            # U ~ along f?, Vv = +x
    for sb in (1, -1):
        for sa in (1, -1):
            p0 = Vector((sb * (T / 2 + 0.002), -sa * 0.13 * s, 0.07 * s))
            p1 = Vector((sb * (T / 2 + 0.002), sa * 0.13 * s, H - 0.08 * s))
            nn = Vector((sb, 0, 0))
            dd = (p1 - p0).normalized()
            side = dd.cross(nn).normalized()
            q = [p0 - side * 0.012 * s, p1 - side * 0.012 * s, p1 + side * 0.012 * s, p0 + side * 0.012 * s]
            a = [K.vert(v) for v in q]
            b = [K.vert(v - nn * 0.006) for v in q]
            fs = [K.face(a, m), K.face(b[::-1], m)]
            for i in range(4):
                j = (i + 1) % 4
                fs.append(K.face((a[i], a[j], b[j], b[i]), m))
            K.recalc(fs)
    for k in (-0.08, 0.0, 0.08):
        cyl_k(K, (0, k * s, H + 0.035 * s), (0, 0, 1), 0.009 * s, 0.07 * s, "metal_dark", sides=6, up=(1, 0, 0))
    box_k(K, (0, 0, H + 0.072 * s), (0.024 * s, 0.22 * s, 0.016 * s), "metal_dark", d=(0, 0, 1), up=(1, 0, 0))
    cyl_k(K, (0, 0.12 * s, H + 0.02 * s), (0, 0, 1), 0.028 * s, 0.05 * s, "metal_dark", sides=10, up=(1, 0, 0))
    o = K.done(smooth=True, sharp=40.0, flat=False)
    M4 = Matrix.Rotation(yaw * D2R, 4, "Z")
    if lie:
        M4 = M4 @ Matrix.Translation((0, 0, T / 2)) @ Matrix.Rotation(-math.pi / 2, 4, "Y")
    o.data.transform(Matrix.Translation(xfz(V3(c))) @ M4)
    return o


def spare_tyre(name, c, axis, R=0.36, W=0.24, rim_r=0.21, g="body", rim=True, sides=28, up=(0, 0, 1), lugs=True):
    """Loose spare tyre with a chunky tread (revolved profile, alternating block radius) + a simple steel wheel."""
    K = KB(name, g)
    U, Vv, D = basis(axis, up)
    C = V3(c)
    hw = W / 2
    h = R - rim_r
    loop = [(rim_r + 0.01, -0.80 * hw), (rim_r + 0.45 * h, -hw), (R - 0.18 * h, -0.93 * hw), (R, -0.72 * hw), (R, 0.72 * hw),
            (R - 0.18 * h, 0.93 * hw), (rim_r + 0.45 * h, hw), (rim_r + 0.01, 0.80 * hw)]
    rings = []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        ca, sa = math.cos(a), math.sin(a)
        lug = 0.0 if (not lugs or i % 2 == 0) else -0.018
        rr = []
        for j, (r, w) in enumerate(loop):
            rj = r + (lug if j in (3, 4) else 0.0)
            rr.append(K.vert(C + (U * ca + Vv * sa) * rj + D * w))
        rings.append(rr)
    fs = []
    for i in range(sides):
        a, b = rings[i], rings[(i + 1) % sides]
        for j in range(len(loop)):
            k = (j + 1) % len(loop)
            fs.append(K.face((a[j], a[k], b[k], b[j]), "rubber_tire"))
    K.recalc(fs)
    if rim:
        stack(K, C, axis, circle(16), [(0.0, -0.05), (rim_r + 0.012, -0.05), (rim_r + 0.012, 0.05), (rim_r * 0.55, 0.06), (0.07, 0.07), (0.0, 0.072)], "rim", up)
        for k in range(5):
            a = 2 * math.pi * k / 5
            cyl_k(K, tuple(C + (U * math.cos(a) + Vv * math.sin(a)) * 0.055 + D * 0.078), axis, 0.011, 0.02, "metal_dark", sides=6, up=up)
    return K.done(smooth=True, sharp=50.0, flat=False)


def crate(name, c, s, yaw=0.0, m="wood", g="body", batten="wood"):
    """Wooden crate (bottom centre c, size s=(sx,sf,sz)) with edge battens."""
    K = KB(name, g)
    ya = yaw * D2R
    fwd = (math.sin(-ya), math.cos(ya), 0.0)
    U, Vv, D = basis(fwd, (0, 0, 1))
    C = V3(c) + Vector((0, 0, s[2] / 2))
    # body
    box_k(K, tuple(C), (s[0] - 0.02, s[2] - 0.02, s[1] - 0.02), m, d=fwd, up=(0, 0, 1))
    # battens along the 12 edges (slightly proud)
    t = 0.035
    hx, hz, hf = s[0] / 2, s[2] / 2, s[1] / 2
    for sx in (-1, 1):
        for sz in (-1, 1):
            box_k(K, tuple(C + U * (sx * (hx - t / 2)) + Vv * (sz * (hz - t / 2))), (t, t, s[1]), batten, d=fwd, up=(0, 0, 1))
    for sf in (-1, 1):
        for sz in (-1, 1):
            box_k(K, tuple(C + D * (sf * (hf - t / 2)) + Vv * (sz * (hz - t / 2))), (s[0] - 2 * t, t, t), batten, d=fwd, up=(0, 0, 1))
        for sx in (-1, 1):
            box_k(K, tuple(C + D * (sf * (hf - t / 2)) + U * (sx * (hx - t / 2))), (t, s[2] - 2 * t, t), batten, d=fwd, up=(0, 0, 1))
    return K.done(smooth=False, flat=False)


def ammo_box(name, c, yaw=0.0, s=(0.30, 0.16, 0.20), m="armor", g="body"):
    K = KB(name, g)
    ya = yaw * D2R
    fwd = (math.sin(-ya), math.cos(ya), 0.0)
    U, Vv, D = basis(fwd, (0, 0, 1))
    C = V3(c)
    box_k(K, tuple(C + Vector((0, 0, s[2] / 2 - 0.012))), (s[0], s[2] - 0.024, s[1]), m, d=fwd)
    box_k(K, tuple(C + Vector((0, 0, s[2] - 0.012))), (s[0] + 0.006, 0.024, s[1] + 0.006), m, d=fwd)
    box_k(K, tuple(C + Vector((0, 0, s[2] + 0.004)) ), (0.12, 0.012, 0.022), "metal_dark", d=fwd)
    box_k(K, tuple(C + D * (s[1] / 2 + 0.004) + Vector((0, 0, s[2] - 0.035))), (0.05, 0.04, 0.012), "metal_dark", d=fwd)
    return K.done(smooth=False, flat=False)


def tarp_roll(name, c, axis, length, r, m="canvas", g="body", straps=2, seed=0, strap_m="cloth_dark"):
    """Rolled tarp / bedroll: lumpy lofted cylinder with strap bands."""
    K = KB(name, g)
    rnd = random.Random(seed)
    U, Vv, D = basis(axis, (0, 0, 1))
    C = V3(c)
    n = 12
    st = 7
    rings = []
    for i in range(st):
        t = i / (st - 1)
        w = -length / 2 + length * t
        rr = []
        for k in range(n):
            a = 2 * math.pi * k / n
            bump = 1.0 + 0.08 * math.sin(3 * a + t * 5 + seed) + rnd.uniform(-0.04, 0.04)
            end = 0.82 if i in (0, st - 1) else 1.0
            rr.append(K.vert(C + (U * math.cos(a) + Vv * math.sin(a) * 0.85) * r * bump * end + D * w))
        rings.append(rr)
    fs = []
    for i in range(st - 1):
        for k in range(n):
            j = (k + 1) % n
            fs.append(K.face((rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]), m))
    fs.append(K.face(rings[0][::-1], m))
    fs.append(K.face(rings[-1], m))
    K.recalc(fs)
    for s in range(straps):
        w = -length / 2 + length * (s + 1) / (straps + 1)
        ring_torus(K, tuple(C + D * w), axis, [(r * 1.02, -0.02), (r * 1.08, -0.02), (r * 1.08, 0.02), (r * 1.02, 0.02)], 12, strap_m)
    return K.done(smooth=True, sharp=60.0, flat=False)


def chain(name, pts, link=0.06, wire=0.007, g="body", m="metal_bare", seg=6):
    """Chain of alternating links along a polyline (seg points per link, 4-sided wire)."""
    K = KB(name, g)
    P3 = [V3(p) for p in pts]
    L = sum((P3[i + 1] - P3[i]).length for i in range(len(P3) - 1))
    n = max(int(L / (link * 0.72)), 2)

    def at(s):
        acc = 0.0
        for i in range(len(P3) - 1):
            seg = (P3[i + 1] - P3[i]).length
            if acc + seg >= s or i == len(P3) - 2:
                t = min((s - acc) / max(seg, 1e-6), 1.0)
                return P3[i] + (P3[i + 1] - P3[i]) * t, (P3[i + 1] - P3[i]).normalized()
            acc += seg
        return P3[-1], (P3[-1] - P3[-2]).normalized()
    for k in range(n):
        p, d = at(L * (k + 0.5) / n)
        up = (0, 0, 1) if abs(d.z) < 0.9 else (1, 0, 0)
        U, Vv, D = basis(tuple(d), up)
        ax = U if k % 2 == 0 else Vv                  # link plane normal alternates
        loop = []
        for i in range(8):
            a = 2 * math.pi * i / 8
            loop.append((math.cos(a), math.sin(a)))
        # stadium link: ring of 8 points, 4-sided wire
        centre = p
        rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            rp = centre + D * (math.cos(a) * link * 0.5) + (ax.cross(D)).normalized() * (math.sin(a) * link * 0.28)
            nrm = (rp - centre).normalized()
            rings.append([K.vert(rp + nrm * wire), K.vert(rp + ax * wire), K.vert(rp - nrm * wire), K.vert(rp - ax * wire)])
        fs = []
        for i in range(seg):
            a, b = rings[i], rings[(i + 1) % seg]
            for j in range(4):
                jj = (j + 1) % 4
                fs.append(K.face((a[j], a[jj], b[jj], b[j]), m))
        K.recalc(fs)
    o = K.done(smooth=True, sharp=80.0)
    mark_flat(o)
    return o


def strap(name, pts, w=0.035, t=0.004, m="cloth_dark", g="body", normal=None):
    """Flat strap/rope along a polyline, lying on surfaces with approx normal `normal` (x,f,z)."""
    K = KB(name, g)
    P3 = [V3(p) for p in pts]
    nrm = V3(normal or (0, 0, 1)).normalized()
    rows = []
    for i, p in enumerate(P3):
        d = (P3[min(i + 1, len(P3) - 1)] - P3[max(i - 1, 0)]).normalized()
        side = d.cross(nrm).normalized()
        rows.append([K.vert(p - side * w / 2 + nrm * t), K.vert(p + side * w / 2 + nrm * t), K.vert(p + side * w / 2), K.vert(p - side * w / 2)])
    fs = []
    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        for j in range(4):
            k = (j + 1) % 4
            fs.append(K.face((a[j], a[k], b[k], b[j]), m))
    fs.append(K.face(rows[0][::-1], m))
    fs.append(K.face(rows[-1], m))
    K.recalc(fs)
    return K.done(smooth=False)


# ------------------------------------------------------------------------------------------ cabin
def steering_wheel(c, ang, R=0.19, g="steer", rim_m="leather", spokes=3, hub_m="metal_dark", sides=20):
    """Steering wheel centred at c (x,f,z); column axis points forward-down at `ang` deg below horizontal (same as the socket pitch).
    Built in group `g` ('steer' -> exported as steering_wheel_mesh under the steering_wheel socket)."""
    d = (0.0, math.cos(ang * D2R), -math.sin(ang * D2R))
    K = KB("swheel", g)
    U, Vv, D = basis(d, (0, 0, 1))
    C = V3(c)
    tr = 0.0145
    ring_torus(K, c, d, [(R + tr * math.cos(a), tr * math.sin(a)) for a in [2 * math.pi * i / 6 for i in range(6)]], sides, rim_m)
    # dished spokes (hub sits 3 cm down the column)
    angs = [-90, 30, 150] if spokes == 3 else [0, 180, -90, 90][:spokes]
    for a in angs:
        ar = a * D2R
        dirv = U * math.cos(ar) + Vv * math.sin(ar)
        p0 = C + dirv * 0.045 + D * 0.03
        p1 = C + dirv * (R - 0.004)
        dd = (p1 - p0).normalized()
        side = dd.cross(D).normalized()
        q = [p0 - side * 0.018, p1 - side * 0.013, p1 + side * 0.013, p0 + side * 0.018]
        a_ = [K.vert(v + D * 0.004) for v in q]
        b_ = [K.vert(v - D * 0.004) for v in q]
        fs = [K.face(a_, hub_m), K.face(b_[::-1], hub_m)]
        for i in range(4):
            j = (i + 1) % 4
            fs.append(K.face((a_[i], a_[j], b_[j], b_[i]), hub_m))
        K.recalc(fs)
    stack(K, tuple(C + D * 0.03), d, circle(12), [(0.0, -0.028), (0.042, -0.022), (0.05, 0.0), (0.05, 0.03), (0.0, 0.03)], hub_m, (0, 0, 1))
    stack(K, tuple(C + D * 0.03), d, circle(10), [(0.0, -0.034), (0.03, -0.03), (0.0, -0.028)], "chrome", (0, 0, 1), cap0=False, cap1=False)
    return K.done(smooth=True, sharp=50.0, flat=False)


def loft_axis(name, T, stations, m, g="body", cap=True, smooth=True, sharp=45.0):
    """Loft rings along a custom axis: T(a, b, t) -> (x,f,z).  stations = [(t, [(a,b)...]), ...] (same ring size)."""
    K = KB(name, g)
    rings = [[K.vert(T(a, b, t)) for a, b in ring] for t, ring in stations]
    n = len(stations[0][1])
    fs = []
    for i in range(len(rings) - 1):
        for j in range(n):
            k = (j + 1) % n
            fs.append(K.face((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]), m))
    if cap:
        fs.append(K.face(rings[0][::-1], m))
        fs.append(K.face(rings[-1], m))
    K.recalc(fs)
    return K.done(smooth=smooth, sharp=sharp, flat=False)


def bucket_seat(name, x, f, z, w=0.48, m="fabric", frame_m="metal_dark", recline=14, g="body", bolster=0.07, belt=None, h=0.62):
    """Race-style bucket: lofted cushion + back shell with side bolsters, rails.  (x,f,z) = seat-base centre (top of rails)."""
    hw = w / 2
    # cushion: loft along f of a U section
    def ring_c(k=1.0):
        return [(-hw, 0.0), (hw, 0.0), (hw, 0.10 * k + 0.02), (hw - 0.05, 0.13 * k), (hw - bolster - 0.02, 0.085), (0.0, 0.075),
                (-hw + bolster + 0.02, 0.085), (-hw + 0.05, 0.13 * k), (-hw, 0.10 * k + 0.02)]
    T = lambda a, b, t: (x + a, f + t, z + b)
    loft_axis(name + "_cush", T, [(-0.24, ring_c(1.0)), (-0.05, ring_c(1.0)), (0.16, ring_c(0.85)), (0.24, [(a * 0.96, b * 0.8) for a, b in ring_c(0.6)])], m, g)
    # back: loft along its own up axis (reclined)
    ra = recline * D2R
    upv = (0.0, -math.sin(ra), math.cos(ra))
    fwdv = (0.0, math.cos(ra), math.sin(ra))
    base = (x, f - 0.25, z + 0.07)

    def TB(a, b, t):
        return (base[0] + a, base[1] + fwdv[1] * b + upv[1] * t, base[2] + fwdv[2] * b + upv[2] * t)

    def ring_b(k=1.0, hk=1.0):
        return [(-hw * hk, -0.05), (hw * hk, -0.05), (hw * hk, 0.06 + 0.06 * k), (hw * hk - 0.05, 0.12 * k), (hw * hk - bolster - 0.02, 0.03),
                (0.0, 0.02), (-hw * hk + bolster + 0.02, 0.03), (-hw * hk + 0.05, 0.12 * k), (-hw * hk, 0.06 + 0.06 * k)]
    loft_axis(name + "_back", TB, [(0.0, ring_b(1.0)), (0.30, ring_b(1.0)), (h - 0.14, ring_b(0.55, 0.86)), (h - 0.1, ring_b(0.3, 0.6)), (h, [(a * 0.55, b * 0.4) for a, b in ring_b(0.2, 0.9)])], m, g)
    # rails + pedestal
    for sx in (-1, 1):
        beam(name + "_rail", (x + sx * (hw - 0.09), f + 0.22, z - 0.02), (x + sx * (hw - 0.09), f - 0.24, z - 0.02), 0.03, 0.03, frame_m, u=(1, 0, 0), g=g)
    if belt:
        for sx in (-0.11, 0.11):
            p0 = TB(sx, 0.035, h - 0.05)
            p1 = TB(sx * 0.4, 0.07, 0.18)
            beam(name + "_belt", p0, p1, 0.045, 0.004, belt, u=(1, 0, 0), g=g)
            p2 = (x + sx * 0.3, f + 0.12, z + 0.09)
            beam(name + "_belt2", p1, p2, 0.045, 0.004, belt, u=(1, 0, 0), g=g)


def bench_seat(name, x0, x1, f, z, depth=0.56, m="fabric", g="body", recline=10, h=0.60, pleats=7, headrests=()):
    """Pleated bench: cushion + back as lofts across x with pleat ridges in the profile."""
    W = x1 - x0

    def pleated(n, hgt, dep):
        pts = [(0.0, 0.0)]
        k = 2 * n
        for i in range(k + 1):
            t = i / k
            bump = 0.012 if i % 2 else 0.0
            pts.append((dep * (0.05 + 0.9 * t), hgt + bump - 0.025 * (2 * t - 1) ** 2))
        pts.append((dep, hgt * 0.75))
        pts.append((dep, 0.0))
        return pts
    # cushion: stations along x, ring in (f, z) plane
    ring = pleated(pleats, 0.13, depth)
    T = lambda a, b, t: (t, f - depth / 2 + a, z + b)
    loft_axis(name + "_cush", T, [(x0, [(a, b * 0.85) for a, b in ring]), (x0 + 0.04, ring), (x1 - 0.04, ring), (x1, [(a, b * 0.85) for a, b in ring])], m, g, smooth=True, sharp=70)
    ra = recline * D2R
    back = pleated(pleats, 0.14, h)
    base_f = f - depth / 2 + 0.02

    def TB(a, b, t):
        # a = height along the back, b = thickness forward
        return (t, base_f - 0.14 + b * math.cos(ra) - a * math.sin(ra), z + 0.10 + a * math.cos(ra) + b * math.sin(ra))
    loft_axis(name + "_back", TB, [(x0, [(a, b * 0.85) for a, b in back]), (x0 + 0.04, back), (x1 - 0.04, back), (x1, [(a, b * 0.85) for a, b in back])], m, g, smooth=True, sharp=70)
    for hx in headrests:
        top = TB(h + 0.07, 0.07, hx)
        bx(name + "_hr", top, (0.26, 0.09, 0.15), m, bevel=0.03, seg=1, pitch=-recline, g=g)


def door_card(name, sd, x_in, f0, f1, z0, z1, g, m="interior", trim="leather", handle="chrome"):
    """Inner door trim on a door panel whose inside face is the plane x = sd*x_in: card, armrest, pull, window crank, speaker grille."""
    t = 0.012
    xc = sd * (x_in - t / 2)
    bx(name + "_card", (xc, (f0 + f1) / 2, (z0 + z1) / 2), (t, f1 - f0, z1 - z0), m, bevel=0.004, seg=1, g=g)
    # top roll + armrest
    bx(name + "_roll", (sd * (x_in - 0.02), (f0 + f1) / 2, z1 - 0.02), (0.035, f1 - f0 - 0.02, 0.04), trim, bevel=0.012, seg=2, g=g)
    bx(name + "_arm", (sd * (x_in - 0.04), (f0 + f1) / 2 - 0.05, z0 + (z1 - z0) * 0.55), (0.06, (f1 - f0) * 0.45, 0.05), trim, bevel=0.015, seg=2, g=g)
    bx(name + "_pull", (sd * (x_in - 0.022), f1 - 0.16, z0 + (z1 - z0) * 0.78), (0.018, 0.10, 0.025), handle, bevel=0.005, seg=1, g=g)
    cyl(name + "_crank", (sd * (x_in - 0.025), (f0 + f1) / 2 + 0.06, z0 + (z1 - z0) * 0.72), 0.022, 0.02, "x", handle, sides=8, g=g)
    beam(name + "_crank_h", (sd * (x_in - 0.036), (f0 + f1) / 2 + 0.06, z0 + (z1 - z0) * 0.72), (sd * (x_in - 0.036), (f0 + f1) / 2 + 0.12, z0 + (z1 - z0) * 0.74), 0.012, 0.012, handle, g=g)
    cyl(name + "_spk", (sd * (x_in - 0.014), f1 - 0.18, z0 + (z1 - z0) * 0.30), 0.06, 0.012, "x", "metal_dark", sides=12, g=g)


def gauge_cluster(name, c, n=3, r=0.04, g="body", face="metal_dark", ring="chrome", d=(0, -1, 0.25)):
    """Row of round gauges (ring + dark face + a light needle) facing the driver (d)."""
    K = KB(name, g)
    U, Vv, D = basis(d, (0, 0, 1))
    C = V3(c)
    for i in range(n):
        p = C + U * ((i - (n - 1) / 2) * r * 2.3)
        stack(K, tuple(p), d, circle(10), [(0.0, -0.01), (r * 1.18, -0.01), (r * 1.18, 0.008), (r, 0.006), (0.0, -0.002)],
              [face, ring, ring, face], (0, 0, 1))
        box_k(K, tuple(p + D * 0.0 + U * (r * 0.3) + Vv * (r * 0.2)), (r * 0.9, 0.004, 0.003), "cloth_tan", d=d, up=(0, 0, 1))
    return K.done(smooth=True, sharp=40.0, flat=False)


def skull_orn(name, c, d=(0, 1, 0), s=1.0, g="body", m="canvas", horns=True):
    """Stylised cow skull (bone) with horns - hood/grille ornament facing d."""
    K = KB(name, g)
    U, Vv, D = basis(d, (0, 0, 1))
    C = V3(c)
    # cranium + long snout (lofted along -Vv i.e. downwards along the face)
    prof = [(0.0, 0.0), (0.06 * s, 0.004), (0.085 * s, 0.03 * s), (0.08 * s, 0.10 * s), (0.055 * s, 0.20 * s), (0.04 * s, 0.26 * s), (0.0, 0.27 * s)]
    outl = [(math.cos(a), math.sin(a) * 0.55) for a in [2 * math.pi * i / 10 for i in range(10)]]
    # axis: from brow downward = -Vv
    stack(K, tuple(C + Vv * 0.06 * s), tuple(-Vv), outl, [(e[0], e[1]) for e in prof], m, tuple(D))
    for sx in (-1, 1):
        # eye sockets (dark)
        cyl_k(K, tuple(C + U * (sx * 0.05 * s) + D * (0.03 * s) + Vv * (0.0)), tuple(D), 0.022 * s, 0.03 * s, "metal_dark", sides=8)
        if horns:
            pts = []
            for i in range(7):
                t = i / 6
                pts.append(tuple(C + U * (sx * (0.07 + 0.30 * t) * s) + Vv * ((0.06 + 0.10 * t * t - 0.02 * t) * s) - D * (0.05 * t * s)))
            tube(name + "_horn", pts, 0.022 * s, m, res=1, g=g, taper=(1.0, 0.25))
    return K.done(smooth=True, sharp=50.0, flat=False)


# ------------------------------------------------------------------------------------------ organic decal patches (fixed-material rust / primer)
def blob_outline(n, seed, irregular=0.3):
    rnd = random.Random(seed)
    ph = [rnd.uniform(0, 6.283) for _ in range(5)]
    am = [rnd.uniform(0.3, 1.0) for _ in range(5)]
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        r = 1.0 + irregular * sum(am[k] * math.sin((k + 1) * a + ph[k]) / (k + 1) for k in range(5)) / 1.4
        r *= 1.0 + rnd.uniform(-0.06, 0.06)
        out.append((math.cos(a) * max(r, 0.35), math.sin(a) * max(r, 0.35)))
    return out


def bullet_holes(name, ray, pts, direction, g="body", r=0.012):
    """Bullet holes: bright torn ring + dark hole, projected along `direction` onto the ray targets at (x,f,z) pts."""
    K = KB(name, g)
    d = V3(direction).normalized()
    for p in pts:
        hit = ray(xfz(V3(p)) - xfz(d) * 0.5, xfz(d), 1.5)
        if hit is None:
            continue
        hp = Vector((hit[0].x, -hit[0].y, hit[0].z))
        hn = Vector((hit[1].x, -hit[1].y, hit[1].z)).normalized()
        stack(K, tuple(hp + hn * 0.001), tuple(hn), circle(6, 0.4), [(r, 0.0), (r * 0.9, 0.003), (r * 0.45, 0.0025)], "metal_bare",
              up=(0, 0, 1) if abs(hn.z) < 0.9 else (0, 1, 0), cap0=True, cap1=False)
        stack(K, tuple(hp + hn * 0.001), tuple(hn), circle(6, 0.4), [(r * 0.5, 0.0024), (0.0, 0.0026)], "metal_dark",
              up=(0, 0, 1) if abs(hn.z) < 0.9 else (0, 1, 0), cap0=False, cap1=False)
    o = K.done(smooth=False)
    mark_flat(o)
    return o


def patch(name, ray, center, direction, radius, m, seed=0, n=12, offset=0.0035, irregular=0.45, g="body", stretch=(1.0, 1.0), rim=None):
    """Organic flat patch projected onto surfaces along `direction` (x,f,z); optional darker `rim` ring material (e.g. rust halo)."""
    d = xfz(V3(direction)).normalized()
    c = xfz(V3(center))
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((0, 1, 0))
    ux = d.cross(up).normalized()
    uy = d.cross(ux).normalized()
    outl = blob_outline(n, seed, irregular)
    h0 = ray(c - d * 0.6, d, 1.5)
    if h0 is None:
        return None
    bm = bmesh.new()

    def proj(u, v):
        p = c + ux * (u * radius * stretch[0]) + uy * (v * radius * stretch[1])
        h = ray(p - d * 0.6, d, 1.5)
        if h is None:
            return None
        return h[0] + h[1] * offset
    cv = bm.verts.new(h0[0] + h0[1] * offset)
    ring = []
    for u, v in outl:
        p = proj(u, v)
        if p is None:
            p = proj(u * 0.6, v * 0.6) or (h0[0] + h0[1] * offset)
        ring.append(bm.verts.new(p))
    mid = []
    for u, v in outl:
        p = proj(u * 0.55, v * 0.55)
        mid.append(bm.verts.new(p if p is not None else h0[0] + h0[1] * offset))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((cv, mid[i], mid[j]))
        bm.faces.new((mid[i], ring[i], ring[j], mid[j]))
    _fix_normals(bm)
    o = _new_obj(name, bm, m)
    for p in o.data.polygons:
        if p.normal.dot(d) > 0:
            o.data.flip_normals()
            break
    for p in o.data.polygons:
        p.use_smooth = True
    return reg(o, g)

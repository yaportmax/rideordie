"""Wear-texture bake + assembly + export pipeline for the enemy vehicles.

Every textured material shares ONE albedo atlas + ONE ORM atlas per vehicle (UV islands of all objects packed together).
Paint/paint2 bake to grayscale so the runtime tint (material.color) works.  Glass and lights stay untextured.
"""
from veh_lib import *
import numpy as np
import time
_T0 = time.time()


def tlog(msg):
    print('[%6.1fs] %s' % (time.time() - _T0, msg), flush=True)

# materials whose surfaces get baked wear (everything else keeps flat factors)
TEXTURED = ["paint", "paint2", "metal_dark", "metal_bare", "rust", "armor", "rim", "interior", "fabric", "leather", "wood",
            "canvas", "rubber", "rubber_tire", "plastic", "spike", "brass", "chrome", "cloth_red", "cloth_dark", "cloth_tan", "gun_metal"]

# ------------------------------------------------------------------------------------------ node graph helper
class G:
    def __init__(self, m):
        self.m = m
        self.t = m.node_tree
        self.n = self.t.nodes
        self.l = self.t.links

    def new(self, typ, **kw):
        nd = self.n.new(typ)
        for k, v in kw.items():
            setattr(nd, k, v)
        return nd

    def put(self, sock, v):
        if v is None:
            return
        if isinstance(v, (int, float)):
            try:
                sock.default_value = float(v)
            except Exception:
                sock.default_value = (v, v, v, 1.0)
        elif hasattr(v, "node"):
            self.l.new(v, sock)
        else:
            vv = tuple(v)
            if len(vv) == 3 and len(sock.default_value) == 4:
                vv = vv + (1.0,)
            sock.default_value = vv

    def geo(self, name):
        return self.new("ShaderNodeNewGeometry").outputs[name]

    def math(self, op, a, b=None, c=None, clamp=False):
        nd = self.new("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.put(nd.inputs[0], a)
        if b is not None:
            self.put(nd.inputs[1], b)
        if c is not None:
            self.put(nd.inputs[2], c)
        return nd.outputs[0]

    def add(self, a, b):
        return self.math("ADD", a, b)

    def sub(self, a, b):
        return self.math("SUBTRACT", a, b)

    def mul(self, a, b):
        return self.math("MULTIPLY", a, b)

    def clamp(self, a):
        return self.math("ADD", a, 0.0, clamp=True)

    def lin(self, a, k, o=0.0, clamp=True):
        """clamp(a*k + o)"""
        return self.math("MULTIPLY_ADD", a, k, o, clamp=clamp)

    def new_map_range(self, x, lo, hi):
        nd = self.new("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        self.put(nd.inputs["Value"], x)
        nd.inputs["From Min"].default_value = lo
        nd.inputs["From Max"].default_value = hi
        return nd.outputs["Result"]

    def mixf(self, fac, a, b):
        nd = self.new("ShaderNodeMix", data_type="FLOAT")
        self.put(nd.inputs[0], fac)
        self.put(nd.inputs[2], a)
        self.put(nd.inputs[3], b)
        return nd.outputs[0]

    def mixc(self, fac, a, b, blend="MIX"):
        nd = self.new("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        self.put(nd.inputs[0], fac)
        self.put(nd.inputs[6], a)
        self.put(nd.inputs[7], b)
        return nd.outputs[2]

    def rgb(self, r, g, b):
        nd = self.new("ShaderNodeCombineColor")
        self.put(nd.inputs[0], r)
        self.put(nd.inputs[1], g)
        self.put(nd.inputs[2], b)
        return nd.outputs[0]

    def sep(self, v):
        nd = self.new("ShaderNodeSeparateXYZ")
        self.put(nd.inputs[0], v)
        return nd.outputs[0], nd.outputs[1], nd.outputs[2]

    def vmap(self, v, scale=(1, 1, 1), loc=(0, 0, 0)):
        nd = self.new("ShaderNodeMapping")
        self.put(nd.inputs["Vector"], v)
        nd.inputs["Scale"].default_value = scale if not isinstance(scale, (int, float)) else (scale, scale, scale)
        nd.inputs["Location"].default_value = loc
        return nd.outputs[0]

    def noise(self, vec, scale, detail=4.0, rough=0.5, distort=0.0):
        nd = self.new("ShaderNodeTexNoise", noise_dimensions="3D")
        self.put(nd.inputs["Vector"], vec)
        nd.inputs["Scale"].default_value = scale
        nd.inputs["Detail"].default_value = detail
        nd.inputs["Roughness"].default_value = rough
        nd.inputs["Distortion"].default_value = distort
        return nd.outputs["Fac"]

    def voronoi_edge(self, vec, scale):
        nd = self.new("ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature="DISTANCE_TO_EDGE")
        self.put(nd.inputs["Vector"], vec)
        nd.inputs["Scale"].default_value = scale
        return nd.outputs["Distance"]

    def ramp(self, fac, stops):
        nd = self.new("ShaderNodeValToRGB")
        cr = nd.color_ramp
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = (*stops[0][1][:3], 1.0)
        cr.elements[1].position = stops[-1][0]
        cr.elements[1].color = (*stops[-1][1][:3], 1.0)
        for pos, col in stops[1:-1]:
            e = cr.elements.new(pos)
            e.color = (*col[:3], 1.0)
        self.put(nd.inputs["Fac"], fac)
        return nd.outputs["Color"]

    def ramp_f(self, fac, stops):
        return self.ramp(fac, [(p, (v, v, v)) for p, v in stops])

    def ao(self, dist, samples=12, inside=False, only_local=False):
        nd = self.new("ShaderNodeAmbientOcclusion", samples=samples, inside=inside, only_local=only_local)
        nd.inputs["Distance"].default_value = dist
        return nd.outputs["AO"]

    def bevel(self, radius, samples=6):
        nd = self.new("ShaderNodeBevel", samples=samples)
        nd.inputs["Radius"].default_value = radius
        return nd.outputs["Normal"]

    def dot(self, a, b):
        nd = self.new("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        self.put(nd.inputs[0], a)
        self.put(nd.inputs[1], b)
        return nd.outputs["Value"]

    def image(self, img, vec=None, ext="CLIP", interp="Linear"):
        nd = self.new("ShaderNodeTexImage", extension=ext, interpolation=interp)
        nd.image = img
        if vec is not None:
            self.put(nd.inputs["Vector"], vec)
        return nd


# ------------------------------------------------------------------------------------------ wear recipes
# per material: base colour a, dust/dirt colour, rust colour, edge-wear colour, roughness, metallic, rustiness (0..1 how much rust shows on it)
# bump: height recipe for the baked normal map (dist = bump distance in metres; the other keys weight height layers)
RECIPES = {
    "paint":       dict(a=(0.80, 0.80, 0.80), dust=(0.52, 0.49, 0.45), rustc=(0.16, 0.13, 0.11), edgec=(0.60, 0.60, 0.60), rough=0.50, metal=0.06, rusty=1.0, dirty=1.0, mottle=0.10,
                        bump=dict(dist=0.0022, rust=1.0, chip=1.0, scr=1.0, grain=0.10, dent=1.0)),
    "paint2":      dict(a=(0.80, 0.80, 0.80), dust=(0.56, 0.53, 0.49), rustc=(0.16, 0.13, 0.11), edgec=(0.60, 0.60, 0.60), rough=0.55, metal=0.05, rusty=1.0, dirty=1.0, mottle=0.12,
                        bump=dict(dist=0.0022, rust=1.0, chip=1.0, scr=1.0, grain=0.10, dent=1.0)),
    "rust":        dict(a=(0.20, 0.068, 0.028), dust=(0.20, 0.13, 0.08), rustc=(0.06, 0.024, 0.012), edgec=(0.40, 0.17, 0.06), rough=0.9, metal=0.1, rusty=0.0, dirty=0.12, mottle=0.85,
                        bump=dict(dist=0.004, crust=1.0, grain=0.6)),
    "metal_dark":  dict(a=(0.042, 0.042, 0.045), dust=(0.16, 0.14, 0.11), rustc=(0.14, 0.058, 0.025), edgec=(0.30, 0.30, 0.31), rough=0.6, metal=0.25, rusty=0.6, dirty=0.6, mottle=0.4,
                        bump=dict(dist=0.002, grain=0.5, rust=0.8, chip=0.4)),
    "metal_bare":  dict(a=(0.26, 0.26, 0.27), dust=(0.22, 0.19, 0.15), rustc=(0.20, 0.08, 0.032), edgec=(0.55, 0.55, 0.57), rough=0.42, metal=1.0, rusty=0.6, dirty=0.8, mottle=0.45,
                        bump=dict(dist=0.002, grain=0.5, rust=0.8, scr=1.0, pit=0.5)),
    "armor":       dict(a=(0.055, 0.057, 0.053), dust=(0.17, 0.145, 0.115), rustc=(0.18, 0.068, 0.026), edgec=(0.3, 0.3, 0.31), rough=0.62, metal=0.3, rusty=0.9, dirty=0.6, mottle=0.5,
                        bump=dict(dist=0.003, grain=0.3, rust=1.0, chip=0.8, scr=1.0, dent=0.6)),
    "rim":         dict(a=(0.05, 0.05, 0.052), dust=(0.17, 0.14, 0.105), rustc=(0.18, 0.07, 0.028), edgec=(0.32, 0.32, 0.33), rough=0.5, metal=0.3, rusty=1.0, dirty=0.45, mottle=0.4,
                        bump=dict(dist=0.002, grain=0.4, rust=0.8, chip=0.6)),
    "interior":    dict(a=(0.065, 0.057, 0.048), dust=(0.20, 0.17, 0.13), rustc=(0.12, 0.06, 0.03), edgec=(0.2, 0.17, 0.14), rough=0.85, metal=0.0, rusty=0.2, dirty=1.0, mottle=0.4,
                        bump=dict(dist=0.0015, grain=0.8, crinkle=0.4)),
    "fabric":      dict(a=(0.085, 0.062, 0.045), dust=(0.30, 0.24, 0.17), rustc=(0.05, 0.03, 0.02), edgec=(0.26, 0.21, 0.15), rough=0.95, metal=0.0, rusty=0.1, dirty=1.0, mottle=0.5,
                        bump=dict(dist=0.002, weave=1.0, crinkle=0.6)),
    "leather":     dict(a=(0.11, 0.05, 0.022), dust=(0.24, 0.18, 0.12), rustc=(0.05, 0.02, 0.01), edgec=(0.26, 0.15, 0.08), rough=0.62, metal=0.0, rusty=0.1, dirty=1.0, mottle=0.5,
                        bump=dict(dist=0.0015, crinkle=1.0)),
    "wood":        dict(a=(0.17, 0.095, 0.045), dust=(0.18, 0.14, 0.09), rustc=(0.08, 0.05, 0.03), edgec=(0.24, 0.16, 0.09), rough=0.85, metal=0.0, rusty=0.0, dirty=0.4, mottle=0.6,
                        bump=dict(dist=0.003, wood=1.0)),
    "canvas":      dict(a=(0.25, 0.195, 0.12), dust=(0.40, 0.34, 0.25), rustc=(0.12, 0.09, 0.06), edgec=(0.44, 0.38, 0.28), rough=0.95, metal=0.0, rusty=0.0, dirty=1.0, mottle=0.5,
                        bump=dict(dist=0.004, weave=0.6, crinkle=1.0)),
    "cloth_red":   dict(a=(0.30, 0.018, 0.012), dust=(0.30, 0.16, 0.10), rustc=(0.10, 0.02, 0.01), edgec=(0.4, 0.1, 0.06), rough=0.95, metal=0.0, rusty=0.0, dirty=1.2, mottle=0.5,
                        bump=dict(dist=0.002, weave=1.0, crinkle=0.5)),
    "cloth_dark":  dict(a=(0.04, 0.036, 0.032), dust=(0.2, 0.16, 0.12), rustc=(0.05, 0.04, 0.03), edgec=(0.12, 0.1, 0.08), rough=0.92, metal=0.0, rusty=0.0, dirty=1.2, mottle=0.5,
                        bump=dict(dist=0.002, weave=1.0, crinkle=0.5)),
    "cloth_tan":   dict(a=(0.33, 0.27, 0.17), dust=(0.34, 0.28, 0.20), rustc=(0.1, 0.08, 0.05), edgec=(0.4, 0.32, 0.22), rough=0.95, metal=0.0, rusty=0.0, dirty=1.2, mottle=0.5,
                        bump=dict(dist=0.002, weave=1.0, crinkle=0.5)),
    "rubber":      dict(a=(0.02, 0.02, 0.02), dust=(0.10, 0.09, 0.07), rustc=(0.02, 0.02, 0.02), edgec=(0.09, 0.085, 0.08), rough=0.85, metal=0.0, rusty=0.0, dirty=1.0, mottle=0.3,
                        bump=dict(dist=0.0015, grain=0.8)),
    "rubber_tire": dict(a=(0.024, 0.023, 0.022), dust=(0.11, 0.095, 0.075), rustc=(0.02, 0.02, 0.02), edgec=(0.07, 0.065, 0.06), rough=0.9, metal=0.0, rusty=0.0, dirty=0.45, mottle=0.3,
                        bump=dict(dist=0.0015, grain=1.0)),
    "plastic":     dict(a=(0.03, 0.03, 0.032), dust=(0.18, 0.16, 0.13), rustc=(0.04, 0.04, 0.04), edgec=(0.2, 0.2, 0.2), rough=0.62, metal=0.0, rusty=0.0, dirty=0.45, mottle=0.3,
                        bump=dict(dist=0.001, grain=0.5)),
    "spike":       dict(a=(0.24, 0.24, 0.25), dust=(0.20, 0.16, 0.12), rustc=(0.20, 0.08, 0.032), edgec=(0.55, 0.55, 0.57), rough=0.38, metal=1.0, rusty=0.5, dirty=0.7, mottle=0.4,
                        bump=dict(dist=0.0015, grain=0.5, pit=0.6)),
    "brass":       dict(a=(0.55, 0.38, 0.10), dust=(0.22, 0.16, 0.08), rustc=(0.10, 0.09, 0.04), edgec=(0.75, 0.55, 0.2), rough=0.4, metal=1.0, rusty=0.2, dirty=1.0, mottle=0.4,
                        bump=dict(dist=0.001, grain=0.5)),
    "chrome":      dict(a=(0.55, 0.55, 0.57), dust=(0.22, 0.18, 0.14), rustc=(0.20, 0.08, 0.032), edgec=(0.70, 0.70, 0.72), rough=0.13, metal=1.0, rusty=1.2, dirty=0.7, mottle=0.25,
                        bump=dict(dist=0.0008, pit=0.4, rust=0.8)),
    "gun_metal":   dict(a=(0.06, 0.06, 0.065), dust=(0.16, 0.13, 0.10), rustc=(0.20, 0.08, 0.032), edgec=(0.42, 0.42, 0.44), rough=0.42, metal=0.9, rusty=0.5, dirty=0.8, mottle=0.4,
                        bump=dict(dist=0.0012, grain=0.4, chip=0.4)),
}


def _stable(s):
    """Stable small hash (Python's str hash is salted per process -> builds would not be reproducible)."""
    return sum((i + 1) * ord(c) for i, c in enumerate(s)) % 97


def build_wear(m, S, img_hooks=None):
    """Build the procedural graph for material m.  Returns dict(col, rough, metal, ao, height, bump_dist)."""
    R = dict(RECIPES[m.name])
    R.update(S.get("override", {}).get(m.name, {}))
    B = dict(R.get("bump", {}))
    g = G(m)
    seed = S.get("seed", 1) * 17.13 + _stable(m.name)
    pos = g.geo("Position")
    nrm = g.geo("Normal")
    px, py, pz = g.sep(pos)
    P0 = g.vmap(pos, 1.0, (seed, seed * 0.7, seed * 1.3))

    def nz(scale, detail=4.0, rough=0.5, distort=0.0, stretch=(1, 1, 1), off=None):
        v = P0 if off is None else g.vmap(P0, 1.0, off)
        return g.noise(g.vmap(v, stretch), scale, detail, rough, distort)

    rustS = S.get("rust", 0.5) * R["rusty"]
    dirtS = S.get("dirt", 0.7) * R["dirty"]
    wearS = S.get("wear", 0.6)
    is_paint = m.name in ("paint", "paint2")
    is_cloth = m.name in ("fabric", "canvas", "cloth_red", "cloth_dark", "cloth_tan", "leather", "interior")
    n_l = nz(0.9, 4.0, 0.55)
    n_m = nz(5.0, 6.0, 0.6)
    n_f = nz(70.0, 3.0, 0.5)
    n_r3 = nz(60.0, 2.0, 0.5)
    streak = nz(1.0, 4.0, 0.6, 0.0, (9, 9, 1.0))
    scr = nz(1.0, 2.0, 0.5, 0.0, (75, 3, 55))
    ao = g.ao(0.5, 16)
    cav = g.ao(0.06, 10)
    bev = g.bevel(0.012 if not is_paint else 0.02, 6)
    ed = g.clamp(g.mul(g.sub(1.0, g.dot(bev, g.geo("Normal"))), 5.0))
    _, _, nzn = g.sep(nrm)
    top = g.new_map_range(nzn, 0.25, 0.95)
    under = g.new_map_range(nzn, -0.35, -0.85)
    low = g.new_map_range(g.sub(0.95, pz), 0.0, 0.85)

    # ---- rust field: blotches concentrated low, in crevices and on sun-baked tops (evaluated also a bit ABOVE each point for streaks)
    def rust_field(dz=0.0):
        off = None if dz == 0.0 else (0.0, 0.0, dz)
        r1 = g.lin(nz(2.2, 6.0, 0.55, 0.7, off=off), 2.8, -0.9)
        r2 = g.lin(nz(15.0, 4.0, 0.55, off=off), 2.8, -0.9)
        return g.add(g.mul(r1, 0.50), g.mul(r2, 0.22))
    n_r2 = nz(15.0, 4.0, 0.55)
    field0 = rust_field()
    field = g.add(field0, g.add(g.mul(g.sub(1.0, ao), 0.22), g.add(g.mul(low, 0.16), g.mul(top, 0.06))))
    thr = 0.80 - 0.15 * min(rustS, 1.3)
    rust = g.new_map_range(field, thr - 0.025, thr + 0.05)
    halo = g.new_map_range(field, thr - 0.14, thr - 0.025)
    pits = g.mul(halo, g.new_map_range(n_r3, 0.56, 0.66))
    rustm = g.clamp(g.add(rust, g.mul(pits, 0.85)))
    # rust run-off: streaks hanging BELOW rusty spots (sample the rust field above the point), only on vertical faces
    run = None
    if rustS > 0.05:
        acc = None
        for dz in (0.05, 0.12, 0.22):
            f2 = g.new_map_range(rust_field(dz), thr - 0.02, thr + 0.08)
            acc = f2 if acc is None else g.math("MAXIMUM", acc, f2)
        vs = g.mul(g.sub(1.0, top), g.sub(1.0, under))
        sn = nz(1.0, 3.0, 0.5, 0.0, (40, 40, 1.2))
        run = g.clamp(g.mul(g.mul(acc, vs), g.new_map_range(sn, 0.42, 0.62)))
    # ---- dirt: grime low on the body, in crevices, streaks under ledges, dust on horizontals, mud around the wheels
    dirt = g.add(g.mul(low, g.lin(n_m, 0.35 if is_cloth else 1.1, 0.05 if is_cloth else 0.15)), g.mul(g.sub(1.0, cav), 0.25 if is_cloth else 0.32))
    dirt = g.add(dirt, g.mul(g.new_map_range(streak, 0.5, 0.75), g.mul(g.sub(1.0, top), g.mul(g.new_map_range(pz, 0.2, 0.9), 0.28))))
    dust_top = g.mul(top, g.mul(g.new_map_range(n_l, 0.35, 0.75), (0.10 if is_cloth else 0.26) * S.get("dust", 1.0)))
    dirt = g.add(dirt, dust_top)
    dirt = g.add(dirt, g.mul(under, 0.6))
    mud = None
    for (wf, wz, wr) in (S.get("wheels", []) if m.name not in ("rubber_tire", "rim") else []):
        dy = g.sub(py, -wf)
        dzz = g.sub(pz, wz)
        d = g.math("SQRT", g.add(g.mul(dy, dy), g.mul(dzz, dzz)))
        w = g.new_map_range(d, wr + 0.42, wr + 0.03)
        mud = w if mud is None else g.math("MAXIMUM", mud, w)
    if mud is not None:
        spat = g.new_map_range(nz(28.0, 3.0, 0.6), 0.40, 0.62)
        mud = g.clamp(g.mul(mud, g.add(g.mul(spat, 0.7), 0.3)))
        dirt = g.add(dirt, g.mul(mud, 0.75))
    dirt = g.clamp(g.mul(dirt, dirtS))
    # ---- chipped edges, random paint chips (primer ring + bare core) and scratches
    chipn = n_f
    chip = g.mul(ed, g.new_map_range(chipn, 0.57 - 0.08 * wearS, 0.59 - 0.08 * wearS))
    fch = nz(9.0, 3.0, 0.55)
    fchip = g.mul(g.new_map_range(fch, 0.70 - 0.05 * wearS, 0.715 - 0.05 * wearS), wearS)
    fring = g.mul(g.new_map_range(fch, 0.655 - 0.05 * wearS, 0.67 - 0.05 * wearS), wearS)
    scrl = g.mul(g.new_map_range(scr, 0.80 - 0.1 * wearS, 0.87), 0.85 * S.get("scratch", 0.5))
    chip = g.clamp(g.add(g.add(chip, scrl), fchip if is_paint else 0.0))
    # ---- colours
    nl = g.new_map_range(n_l, 0.30, 0.70)
    colr = g.mixc(nl, R["a"], tuple(x * (1.0 - R["mottle"]) for x in R["a"]))
    grain = g.new_map_range(n_f, 0.35, 0.65)
    colr = g.mixc(g.mul(grain, 0.10), colr, tuple(x * 0.7 for x in R["a"]))
    if is_paint:
        # sun fade: tops bleached lighter + chalky; sides keep more depth
        colr = g.mixc(g.mul(top, g.lin(n_l, 0.30, 0.05)), colr, (0.90, 0.90, 0.90))
        # primer ring round the random chips
        colr = g.mixc(g.clamp(fring), colr, (0.62, 0.62, 0.62))
    colr = g.mixc(g.mul(dirt, 0.88), colr, R["dust"])
    if mud is not None:
        colr = g.mixc(g.mul(g.mul(mud, dirtS), 0.55), colr, tuple(x * 0.55 for x in R["dust"]))
    rc = g.mixc(n_r2, tuple(x * 0.55 for x in R["rustc"]), tuple(min(x * 1.5, 1.0) for x in R["rustc"]))
    if run is not None:
        colr = g.mixc(g.mul(run, 0.55 * min(rustS, 1.0)), colr, tuple(x * 1.2 for x in R["rustc"]))
    colr = g.mixc(rustm, colr, rc)
    colr = g.mixc(g.clamp(chip), colr, R["edgec"])
    hook = None if argv().get("nohook") else (S.get("hooks") or {}).get(m.name)
    ctx = dict(g=g, pos=pos, nrm=nrm, px=px, py=py, pz=pz, ao=ao, cav=cav, edge=ed, dirt=dirt, rust=rustm, top=top, n_l=n_l, n_m=n_m, n_f=n_f, nz=nz)
    if hook:
        colr = hook(ctx, colr)
    colr = g.mixc(g.clamp(g.add(g.mul(g.sub(1.0, cav), 0.26), g.mul(g.sub(1.0, ao), 0.12))), colr, (0, 0, 0))
    rough = g.add(g.add(R["rough"], g.mul(g.sub(n_m, 0.5), 0.24)), g.add(g.mul(dirt, 0.42), g.sub(g.mul(rustm, 0.42), g.mul(g.clamp(chip), 0.10))))
    rough = g.add(rough, g.mul(top, 0.30 if is_paint else 0.18))
    rough = g.clamp(rough)
    metal = g.clamp(g.mul(g.sub(1.0, g.mul(g.add(dirt, rustm), 0.8)), R["metal"]))
    if is_paint:
        metal = g.clamp(g.add(metal, g.mul(g.clamp(g.sub(chip, fchip)), 0.45)))
    # ---- height for the normal-map bake
    h = g.mul(g.sub(n_f, 0.5), B.get("grain", 0.0) * 0.5)
    if B.get("dent"):
        h = g.add(h, g.mul(g.sub(nz(3.0, 2.0, 0.5), 0.5), 1.0 * B["dent"]))
    if B.get("rust"):
        crust = g.add(g.mul(rustm, 0.55), g.mul(g.mul(rustm, n_r3), 0.9))
        h = g.add(h, g.mul(crust, B["rust"]))
    if B.get("chip"):
        h = g.sub(h, g.mul(g.clamp(chip), 0.45 * B["chip"]))
    if B.get("scr"):
        h = g.sub(h, g.mul(scrl, 0.35 * B["scr"]))
    if B.get("pit"):
        pn = nz(140.0, 2.0, 0.5)
        h = g.sub(h, g.mul(g.new_map_range(pn, 0.62, 0.75), 0.5 * B["pit"]))
    if B.get("hammer"):
        vo = g.new("ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature="F1")
        g.put(vo.inputs["Vector"], P0)
        vo.inputs["Scale"].default_value = 22.0
        dim = g.new_map_range(vo.outputs["Distance"], 0.0, 0.6)
        h = g.add(h, g.mul(dim, 0.55 * B["hammer"]))
    if B.get("crust"):
        c1 = nz(35.0, 5.0, 0.7, 0.4)
        c2 = nz(120.0, 2.0, 0.5)
        h = g.add(h, g.add(g.mul(c1, 1.2 * B["crust"]), g.mul(c2, 0.5 * B["crust"])))
    if B.get("weave"):
        wv = nz(260.0, 1.0, 0.4)
        h = g.add(h, g.mul(wv, 0.8 * B["weave"]))
    if B.get("crinkle"):
        ck = nz(18.0, 5.0, 0.65, 0.3)
        h = g.add(h, g.mul(g.math("ABSOLUTE", g.sub(ck, 0.5)), -1.6 * B["crinkle"]))
    if B.get("wood"):
        wd = nz(1.0, 3.0, 0.5, 0.0, (4, 4, 90))
        wd2 = nz(1.0, 3.0, 0.5, 0.0, (90, 4, 4))
        h = g.add(h, g.mul(g.add(wd, wd2), 0.6 * B["wood"]))
    return dict(col=colr, rough=rough, metal=metal, ao=g.lin(ao, 0.6, 0.4), height=h, bump_dist=B.get("dist", 0.0015))


# ------------------------------------------------------------------------------------------ bake
_FORCE_CPU = [False]


def _coverage(img, fill):
    """Fraction of atlas pixels that differ from the generated fill colour (a failed bake leaves the fill everywhere)."""
    r = img.size[0]
    arr = np.empty(r * r * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    arr = arr.reshape(-1, 4)[:, :3]
    return float((np.abs(arr - np.array(fill, dtype=np.float32)).max(axis=1) > 0.004).mean())


def _setup_cycles(samples):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    cy = scn.cycles
    cy.samples = samples
    cy.use_denoising = False
    cy.device = "CPU"
    if _FORCE_CPU[0] or argv().get("cpu"):
        print("BAKE device: CPU (forced)")
        return
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        ok = False
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
            ok = ok or d.use
        if ok:
            cy.device = "GPU"
    except Exception as e:
        print("cycles GPU setup failed:", e)
    print("BAKE device:", cy.device)


def _new_img(name, res, srgb, fill):
    img = bpy.data.images.new(name, res, res, alpha=False, float_buffer=False)
    img.generated_color = (*fill, 1.0)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    return img


def area_report():
    tot = {}
    for o in bpy.context.scene.objects:
        if o.type != "MESH" or o.name.startswith("_tmp"):
            continue
        me = o.data
        fl = me.attributes.get("flat")
        fv = [0] * len(me.polygons)
        if fl is not None and len(fl.data) == len(me.polygons):
            fl.data.foreach_get("value", fv)
        for p in me.polygons:
            if not o.material_slots or not o.material_slots[p.material_index].material:
                continue
            mn = o.material_slots[p.material_index].material.name
            if mn in TEXTURED and not fv[p.index]:
                k = (o.name, mn)
                tot[k] = tot.get(k, 0.0) + p.area
    for k, v in sorted(tot.items(), key=lambda kv: -kv[1])[:34]:
        print("AREA %-24s %-12s %.2f m2" % (k[0], k[1], v))
    print("AREA total %.1f m2" % sum(tot.values()))


DENS = {"metal_dark": 0.36, "interior": 0.45, "fabric": 0.45, "rubber_tire": 0.5, "rust": 0.6, "metal_bare": 0.6, "leather": 0.45,
        "canvas": 0.55, "cloth_red": 0.6, "cloth_dark": 0.5, "cloth_tan": 0.55, "rubber": 0.5, "plastic": 0.5, "wood": 0.6, "armor": 0.75,
        "rim": 0.55, "chrome": 0.55, "spike": 0.5, "gun_metal": 0.9, "paint": 1.4, "paint2": 1.4}


def scale_islands(use):
    """After smart_project: scale each UV island about its centre by its texel-density class (edit mode, bmesh)."""
    done = set()
    for o, idx in use:
        if o.data.name in done:
            continue
        done.add(o.data.name)
        bm = bmesh.from_edit_mesh(o.data)
        uvl = bm.loops.layers.uv.active
        dn = bm.faces.layers.int.get("dens")
        faces = [f for f in bm.faces if f.select]
        par = {f.index: f.index for f in faces}

        def find(x):
            while par[x] != x:
                par[x] = par[par[x]]
                x = par[x]
            return x
        for e in bm.edges:
            lf = [f for f in e.link_faces if f.select]
            if len(lf) != 2:
                continue
            f1, f2 = lf
            u1 = {l.vert.index: l[uvl].uv for l in f1.loops if l.vert in e.verts}
            u2 = {l.vert.index: l[uvl].uv for l in f2.loops if l.vert in e.verts}
            if len(u1) == 2 and len(u2) == 2 and all((u1[v] - u2[v]).length < 2e-5 for v in u1):
                a, b = find(f1.index), find(f2.index)
                if a != b:
                    par[a] = b
        groups = {}
        for f in faces:
            groups.setdefault(find(f.index), []).append(f)
        slot_names = [s.material.name if s.material else "" for s in o.material_slots]
        for gf in groups.values():
            area = sum(f.calc_area() for f in gf) or 1.0
            k = 0.0
            for f in gf:
                d = DENS.get(slot_names[f.material_index], 1.0)
                if dn is not None and f[dn] > 0:
                    d *= f[dn] / 100.0
                if f.normal.z < -0.6:
                    d *= 0.55
                k += d * f.calc_area()
            k /= area
            if abs(k - 1.0) < 0.015:
                continue
            uvs = [l[uvl] for f in gf for l in f.loops]
            cx = sum(u.uv.x for u in uvs) / len(uvs)
            cy = sum(u.uv.y for u in uvs) / len(uvs)
            for u in uvs:
                u.uv.x = cx + (u.uv.x - cx) * k
                u.uv.y = cy + (u.uv.y - cy) * k
        bmesh.update_edit_mesh(o.data)


SPOT_CELL = 24          # px per reserved flat-colour cell (top rows of the atlas)


def spot_uv(idx, res):
    return ((SPOT_CELL * idx + SPOT_CELL * 0.5) / res, 1.0 - SPOT_CELL * 0.5 / res)


def unwrap_atlas(objs, tex_mats, res, margin=0.0018, angle=66.0):
    """Pack every textured, non-flat face into one atlas (scaled to leave the top strip free); flat faces get a per-material colour cell."""
    bpy.ops.object.select_all(action="DESELECT")
    use = []
    for o in objs:
        me = o.data
        if not me.uv_layers:
            me.uv_layers.new(name="UVMap")
        idx = {i for i, s in enumerate(o.material_slots) if s.material and s.material.name in tex_mats}
        if idx:
            use.append((o, idx))
    if not use:
        return
    for o, _ in use:
        o.select_set(True)
    bpy.context.view_layer.objects.active = use[0][0]
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    nsel = 0
    for o, idx in use:
        bm = bmesh.from_edit_mesh(o.data)
        fl = bm.faces.layers.int.get("flat")
        for f in bm.faces:
            ok = f.material_index in idx and not (fl is not None and f[fl])
            f.select_set(ok)
            nsel += ok
        bm.select_flush(True)
        bmesh.update_edit_mesh(o.data)
    tlog("unwrapping %d faces" % nsel)
    if argv().get("debug"):
        area_report()
    bpy.ops.uv.smart_project(angle_limit=angle * D2R, island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    scale_islands(use)
    # guard: a degenerate sliver island (zero UV area, finite 3D area) gets blown up by average_islands_scale and then
    # pack_islands shrinks every other island to nothing -> collapse such faces to a point before packing
    for o, idx in use:
        bm = bmesh.from_edit_mesh(o.data)
        uvl = bm.loops.layers.uv.active
        worst = 0.0
        fixed = 0
        for f in bm.faces:
            if not f.select:
                continue
            us = [l[uvl].uv for l in f.loops]
            ext = max(max(u.x for u in us) - min(u.x for u in us), max(u.y for u in us) - min(u.y for u in us))
            worst = max(worst, ext)
            if not math.isfinite(ext) or ext > 50.0:
                for l in f.loops:
                    l[uvl].uv = (0.0, 0.0)
                fixed += 1
        if fixed or argv().get("debug"):
            print("UVEXT %-22s max face extent %.3g  collapsed %d" % (o.name, worst, fixed))
        bmesh.update_edit_mesh(o.data)
    try:
        bpy.ops.uv.pack_islands(margin=margin, rotate=True, shape_method="AABB")
    except TypeError:
        bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    # scale into [0, 0.955]^2 and send flat faces to their colour cells
    order = [n for n in TEXTURED]
    seen_me = set()
    for o, idx in use:
        me = o.data
        if me.name in seen_me:
            continue
        seen_me.add(me.name)
        uvl = me.uv_layers.active
        nl = len(me.loops)
        uv = np.empty(nl * 2, dtype=np.float32)
        uvl.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        npoly = len(me.polygons)
        ls = np.empty(npoly, dtype=np.int32)
        lt = np.empty(npoly, dtype=np.int32)
        mi = np.empty(npoly, dtype=np.int32)
        me.polygons.foreach_get("loop_start", ls)
        me.polygons.foreach_get("loop_total", lt)
        me.polygons.foreach_get("material_index", mi)
        flat = np.zeros(npoly, dtype=np.int32)
        if me.attributes.get("flat") is not None and len(me.attributes["flat"].data) == npoly:
            me.attributes["flat"].data.foreach_get("value", flat)
        lp = np.repeat(np.arange(npoly), lt)
        loop_flat = flat[lp] > 0
        loop_mat = mi[lp]
        slot_names = [s.material.name if s.material else "" for s in o.material_slots]
        for i in idx:
            nm = slot_names[i]
            sel = loop_mat == i
            nf = sel & ~loop_flat
            uv[nf] *= 0.955
            fsel = sel & loop_flat
            if fsel.any():
                uv[fsel] = spot_uv(order.index(nm), res)
        uvl.data.foreach_set("uv", uv.ravel())
        me.update()


def bake_all(name, S, res=2048, orm_res=1024, samples=24, fast=False):
    """Bake albedo + ORM atlases for every mesh in the scene and rewrite the materials to use them.  Returns (albedo_path, orm_path)."""
    os.makedirs(SCRATCH, exist_ok=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith("_tmp")]
    present = set()
    for o in meshes:
        for s in o.material_slots:
            if s.material:
                present.add(s.material.name)
    tex = [n for n in TEXTURED if n in present]
    tlog("unwrap start")
    for o in meshes:                      # non-finite vertices poison smart_project / pack_islands for EVERY object
        co = np.empty(len(o.data.vertices) * 3, dtype=np.float32)
        o.data.vertices.foreach_get("co", co)
        if not np.isfinite(co).all():
            print("NONFINITE vertices in", o.name, int((~np.isfinite(co)).sum() // 3))
    unwrap_atlas(meshes, set(tex), res)
    tlog("unwrap done")
    for o in meshes:
        if not o.data.uv_layers:
            continue
        uv = np.empty(len(o.data.loops) * 2, dtype=np.float32)
        o.data.uv_layers.active.data.foreach_get("uv", uv)
        bad = int((~np.isfinite(uv)).sum())
        if bad or (len(uv) and (uv.min() < -0.01 or uv.max() > 1.01)):
            print("BAD UVS in %s: nonfinite %d range %.3f..%.3f" % (o.name, bad, np.nanmin(uv), np.nanmax(uv)))
        if argv().get("debug"):
            me = o.data
            me.calc_loop_triangles()
            uvd = uv.reshape(-1, 2)
            tot = 0.0
            big = (0.0, -1)
            for t in me.loop_triangles:
                a, b, c = (uvd[l] for l in t.loops)
                ar = abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
                tot += ar
                if ar > big[0]:
                    big = (ar, t.polygon_index)
            print("UVAREA %-22s %.5f  biggest tri %.5f (poly %d)" % (o.name, tot, big[0], big[1]))
    if argv().get("debug"):
        uv_overlap_report(meshes)
    # triangulate now (UVs are kept): Cycles' baker mis-fills big concave / collinear n-gons left by the booleans
    done = set()
    for o in meshes:
        if o.data.name in done:
            continue
        done.add(o.data.name)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
        bm.to_mesh(o.data)
        bm.free()

    # ground for AO contact shadow
    ground = bpy.data.objects.new("_tmp_ground", bpy.data.meshes.new("_tmp_ground"))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30.0)
    bm.to_mesh(ground.data)
    bm.free()
    bpy.context.collection.objects.link(ground)
    gm = bpy.data.materials.new("_tmp_ground")
    ground.data.materials.append(gm)
    _setup_cycles(samples)
    img_a = _new_img(name + "_albedo", res, True, (0.25, 0.25, 0.25))
    img_o = _new_img(name + "_orm", orm_res, False, (1.0, 0.7, 0.0))
    nres = int(argv().get("nrm", res))
    img_n = _new_img(name + "_normal", nres, False, (0.5, 0.5, 1.0)) if nres > 0 else None
    dummy = _new_img(name + "_dummy", 8, True, (0.2, 0.2, 0.2))
    # graphs
    rec = {}
    hooked = S
    for mname in tex:
        m = bpy.data.materials[mname]
        m.use_nodes = True
        for nd in list(m.node_tree.nodes):
            m.node_tree.nodes.remove(nd)
        W = build_wear(m, S)
        col, rough, metal, ao = W["col"], W["rough"], W["metal"], W["ao"]
        g = G(m)
        out = g.new("ShaderNodeOutputMaterial")
        emi = g.new("ShaderNodeEmission")
        g.l.new(emi.outputs[0], out.inputs["Surface"])
        tgt = g.new("ShaderNodeTexImage")
        tgt.image = img_a
        m.node_tree.nodes.active = tgt
        pack = g.rgb(ao, rough, metal)
        rec[mname] = (m, emi, tgt, col, pack, W["height"], W["bump_dist"], out)
    for m in bpy.data.materials:
        if m.name in tex or m.name.startswith("_tmp"):
            continue
        m.use_nodes = True
        tgt = m.node_tree.nodes.new("ShaderNodeTexImage")
        tgt.image = dummy
        m.node_tree.nodes.active = tgt
    # select bake objects
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    def run(kind, img, sm):
        _setup_cycles(sm)
        for mname, (m, emi, tgt, col, pack, hgt, bd, out) in rec.items():
            for l in list(m.node_tree.links):
                if l.to_node == emi:
                    m.node_tree.links.remove(l)
            m.node_tree.links.new(col if kind == "albedo" else pack, emi.inputs["Color"])
            tgt.image = img
            m.node_tree.nodes.active = tgt
        tlog("BAKE %s start" % kind)
        bpy.ops.object.bake(type="EMIT", margin=10, margin_type="EXTEND", use_clear=False, use_selected_to_active=False, use_cage=False)

    def run_normal(img, sm):
        _setup_cycles(sm)
        for mname, (m, emi, tgt, col, pack, hgt, bd, out) in rec.items():
            g = G(m)
            dif = g.new("ShaderNodeBsdfDiffuse")
            bump = g.new("ShaderNodeBump")
            bump.inputs["Distance"].default_value = bd * float(argv().get("bumpk", 1.0))
            bump.inputs["Strength"].default_value = 1.0
            g.put(bump.inputs["Height"], hgt)
            g.l.new(bump.outputs["Normal"], dif.inputs["Normal"])
            for l in list(m.node_tree.links):
                if l.to_node == out:
                    m.node_tree.links.remove(l)
            g.l.new(dif.outputs[0], out.inputs["Surface"])
            tgt.image = img
            m.node_tree.nodes.active = tgt
        tlog("BAKE normal start")
        bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", normal_r="POS_X", normal_g="POS_Y", normal_b="POS_Z",
                            margin=10, margin_type="EXTEND", use_clear=False, use_selected_to_active=False, use_cage=False)

    def checked(fn, img, fill, *a, need=0.30):
        """Bake, verify the atlas actually received texels; a silently failed GPU bake (shared GPU) is retried on the CPU."""
        img.generated_color = (*fill, 1.0)
        fn(img, *a)
        cov = _coverage(img, fill)
        tlog("coverage %s %.2f" % (img.name, cov))
        if cov < need:
            print("BAKE WARNING: %s coverage %.2f -> retrying on CPU" % (img.name, cov))
            _FORCE_CPU[0] = True
            img.generated_color = (*fill, 1.0)
            img.source = "GENERATED"
            fn(img, *a)
            cov = _coverage(img, fill)
            tlog("coverage (cpu) %s %.2f" % (img.name, cov))
            if cov < need:
                raise RuntimeError("bake failed twice for %s (coverage %.2f)" % (img.name, cov))

    checked(lambda im, sm: run("albedo", im, sm), img_a, (0.25, 0.25, 0.25), samples)
    tlog("albedo done")
    checked(lambda im, sm: run("orm", im, sm), img_o, (1.0, 0.7, 0.0), max(samples, 32))
    tlog("orm done")
    if img_n is not None:
        checked(lambda im, sm: run_normal(im, sm), img_n, (0.5, 0.5, 1.0), 1, need=0.03)
        tlog("normal done")
    if not argv().get("nofill"):
        _fill_spots(img_a, img_o, tex, res, orm_res, S, img_n=img_n, nres=nres)
    if argv().get("debug"):
        _debug_atlas(meshes, img_o, orm_res)
        _debug_albedo(meshes, img_a, res)
    pa = os.path.join(SCRATCH, name + "_albedo.png")
    po = os.path.join(SCRATCH, name + "_orm.png")
    pn = os.path.join(SCRATCH, name + "_normal.png")
    for img, p in ((img_a, pa), (img_o, po), (img_n, pn)):
        if img is None:
            continue
        img.filepath_raw = p
        img.file_format = "PNG"
        img.save()
    bpy.data.objects.remove(ground)
    # final materials
    ia = bpy.data.images.load(pa)
    ia.colorspace_settings.name = "sRGB"
    ia.pack()
    io = bpy.data.images.load(po)
    io.colorspace_settings.name = "Non-Color"
    io.pack()
    inn = None
    if img_n is not None:
        inn = bpy.data.images.load(pn)
        inn.colorspace_settings.name = "Non-Color"
        inn.pack()
    ao_grp = _occlusion_group()
    for mname in tex:
        m = bpy.data.materials[mname]
        for nd in list(m.node_tree.nodes):
            m.node_tree.nodes.remove(nd)
        g = G(m)
        out = g.new("ShaderNodeOutputMaterial")
        bsdf = g.new("ShaderNodeBsdfPrincipled")
        g.l.new(bsdf.outputs[0], out.inputs["Surface"])
        ta = g.image(ia, ext="REPEAT")
        g.l.new(ta.outputs["Color"], bsdf.inputs["Base Color"])
        to = g.image(io, ext="REPEAT")
        sp = g.new("ShaderNodeSeparateColor")
        g.l.new(to.outputs["Color"], sp.inputs[0])
        g.l.new(sp.outputs[1], bsdf.inputs["Roughness"])
        g.l.new(sp.outputs[2], bsdf.inputs["Metallic"])
        gn = g.new("ShaderNodeGroup")
        gn.node_tree = ao_grp
        g.l.new(sp.outputs[0], gn.inputs["Occlusion"])
        bsdf.inputs["Specular IOR Level"].default_value = 0.5
        if inn is not None:
            tn = g.image(inn, ext="REPEAT")
            nm = g.new("ShaderNodeNormalMap", space="TANGENT")
            nm.inputs["Strength"].default_value = 1.0
            g.l.new(tn.outputs["Color"], nm.inputs["Color"])
            g.l.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return pa, po


def _debug_atlas(meshes, img, r):
    arr = np.empty(r * r * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    arr = arr.reshape(r, r, 4)
    for o in meshes:
        me = o.data
        uvl = me.uv_layers.active
        if uvl is None:
            continue
        rows = {}
        for p in me.polygons:
            uvs = [uvl.data[l].uv for l in p.loop_indices]
            cu = sum(u[0] for u in uvs) / len(uvs)
            cv = sum(u[1] for u in uvs) / len(uvs)
            x = min(max(int(cu * r), 0), r - 1)
            y = min(max(int(cv * r), 0), r - 1)
            v = arr[y, x]
            mn = o.material_slots[p.material_index].material.name if o.material_slots else "?"
            rows.setdefault(mn, []).append(v)
        if o.name in ("panel_door_L", "body_paint", "panel_hood"):
            ub = [(min(uvl.data[l].uv[0] for l in p.loop_indices), min(uvl.data[l].uv[1] for l in p.loop_indices), max(uvl.data[l].uv[0] for l in p.loop_indices), max(uvl.data[l].uv[1] for l in p.loop_indices), p.area) for p in me.polygons if o.material_slots[p.material_index].material.name.startswith("paint")]
            ub.sort(key=lambda t: -(t[2] - t[0]) * (t[3] - t[1]))
            for t in ub[:4]:
                print("DBGUV", o.name, ["%.3f" % x for x in t])
            for p in sorted(me.polygons, key=lambda q: -q.area)[:3]:
                uvs = [tuple(uvl.data[l].uv) for l in p.loop_indices]
                ar = 0.5 * abs(sum(uvs[i][0] * uvs[(i + 1) % len(uvs)][1] - uvs[(i + 1) % len(uvs)][0] * uvs[i][1] for i in range(len(uvs))))
                print("DBGPOLY", o.name, "verts", len(uvs), "area3d %.3f" % p.area, "uvarea %.5f" % ar, "mat", o.material_slots[p.material_index].material.name, "uv0", ["%.3f" % x for x in uvs[0]])
        if o.name == "body_paint":
            npoly = len(me.polygons)
            flat = np.zeros(npoly, dtype=np.int32)
            if me.attributes.get("flat") is not None and len(me.attributes["flat"].data) == npoly:
                me.attributes["flat"].data.foreach_get("value", flat)
            bad = []
            for p in me.polygons:
                uvs = [uvl.data[l].uv for l in p.loop_indices]
                cu = sum(u[0] for u in uvs) / len(uvs)
                cv = sum(u[1] for u in uvs) / len(uvs)
                v = arr[min(max(int(cv * r), 0), r - 1), min(max(int(cu * r), 0), r - 1)]
                if abs(v[0] - 1.0) < 0.02 and abs(v[1] - 0.7) < 0.02 and v[2] < 0.02:
                    bad.append((p.area, p.index, len(uvs), int(flat[p.index]), o.material_slots[p.material_index].material.name, (round(cu, 3), round(cv, 3))))
            bad.sort(reverse=True)
            for b in bad[:12]:
                print("DBGBAD", b)
        for mn, vs in rows.items():
            vs = np.array(vs)
            unb = int(((np.abs(vs[:, 0] - 1.0) < 0.02) & (np.abs(vs[:, 1] - 0.7) < 0.02) & (vs[:, 2] < 0.02)).sum())
            print("DBG %-22s %-12s n=%5d unbaked=%d AO=%.2f rough=%.2f metal=%.2f" % (o.name, mn, len(vs), unb, vs[:, 0].mean(), vs[:, 1].mean(), vs[:, 2].mean()))


def _debug_albedo(meshes, img, r):
    arr = np.empty(r * r * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    arr = arr.reshape(r, r, 4)
    fill = np.array([0.25, 0.25, 0.25])
    tot = {}
    for o in meshes:
        me = o.data
        uvl = me.uv_layers.active
        if uvl is None:
            continue
        for p in me.polygons:
            if p.area < 0.01:
                continue
            mn = o.material_slots[p.material_index].material.name if o.material_slots else "?"
            uvs = [uvl.data[l].uv for l in p.loop_indices]
            cu = sum(u[0] for u in uvs) / len(uvs)
            cv = sum(u[1] for u in uvs) / len(uvs)
            v = arr[min(max(int(cv * r), 0), r - 1), min(max(int(cu * r), 0), r - 1)][:3]
            if np.abs(v - fill).max() < 0.012:
                k = (o.name, mn)
                a = tot.get(k, [0, 0.0])
                a[0] += 1
                a[1] += p.area
                tot[k] = a
    for k, v in sorted(tot.items(), key=lambda kv: -kv[1][1])[:14]:
        print("DBGALB unbaked", k, v[0], "polys", "%.2f m2" % v[1])


def uv_overlap_report(meshes, n=512):
    cov = np.zeros((n, n), dtype=np.int16)
    owner = {}
    who = {}
    seen = set()
    for o in meshes:
        me = o.data
        if me.name in seen or not me.uv_layers:
            continue
        seen.add(me.name)
        uvl = me.uv_layers.active
        npoly = len(me.polygons)
        flat = np.zeros(npoly, dtype=np.int32)
        if me.attributes.get("flat") is not None and len(me.attributes["flat"].data) == npoly:
            me.attributes["flat"].data.foreach_get("value", flat)
        me.calc_loop_triangles()
        for t in me.loop_triangles:
            if flat[t.polygon_index]:
                continue
            mn = o.material_slots[me.polygons[t.polygon_index].material_index].material.name
            if mn not in TEXTURED:
                continue
            pts = np.array([uvl.data[l].uv for l in t.loops]) * n
            x0, x1 = int(max(pts[:, 0].min(), 0)), int(min(pts[:, 0].max(), n - 1))
            y0, y1 = int(max(pts[:, 1].min(), 0)), int(min(pts[:, 1].max(), n - 1))
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            a, b, c = pts
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-9:
                continue
            l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
            l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
            l3 = 1 - l1 - l2
            m = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
            sub = cov[y0:y1 + 1, x0:x1 + 1]
            hit = m & (sub > 0)
            if hit.any():
                key = (o.name, mn)
                who[key] = who.get(key, 0) + int(hit.sum())
            sub[m] += 1
    print("OVERLAP texels(512 grid) >1:", int((cov > 1).sum()), "of covered", int((cov > 0).sum()))
    for k, v in sorted(who.items(), key=lambda kv: -kv[1])[:12]:
        print("OVERLAP by", k, v)


def _lin2srgb(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 1e-6), 1 / 2.4) - 0.055)


def _fill_spots(img_a, img_o, tex, res, orm_res, S, img_n=None, nres=0):
    """Fill the reserved colour cells (flat faces: bolts, rivets, tiny parts) with each material's average look."""
    if img_n is not None:
        arr = np.empty(nres * nres * 4, dtype=np.float32)
        img_n.pixels.foreach_get(arr)
        arr = arr.reshape(nres, nres, 4)
        cell = max(int(SPOT_CELL * nres / res), 2)
        arr[nres - cell:nres, 0:cell * len(TEXTURED), :] = np.array([0.5, 0.5, 1.0, 1.0], dtype=np.float32)
        img_n.pixels.foreach_set(arr.ravel())
    for img, r, kind in ((img_a, res, "a"), (img_o, orm_res, "o")):
        arr = np.empty(r * r * 4, dtype=np.float32)
        img.pixels.foreach_get(arr)
        arr = arr.reshape(r, r, 4)
        for i, nm in enumerate(TEXTURED):
            if nm not in tex:
                continue
            R = RECIPES[nm]
            cell = max(int(SPOT_CELL * r / res), 2)
            x0, y0 = cell * i, 0
            if kind == "a":
                col = np.array(R["a"], dtype=np.float32) * 0.8 + np.array(R["dust"], dtype=np.float32) * 0.2
                col = _lin2srgb(col)
                val = np.array([col[0], col[1], col[2], 1.0], dtype=np.float32)
            else:
                val = np.array([0.9, R["rough"] + 0.15, R["metal"] * 0.6, 1.0], dtype=np.float32)
            arr[r - cell:r, x0:x0 + cell, :] = val          # image rows run bottom->top: top rows are the LAST rows
        img.pixels.foreach_set(arr.ravel())


def _occlusion_group():
    name = "glTF Material Output"
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]
    ng = bpy.data.node_groups.new(name, "ShaderNodeTree")
    ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return ng


# ------------------------------------------------------------------------------------------ assembly
class Vehicle:
    def __init__(self, vid, style=None, sockets=None):
        reset()
        REG.clear()
        SOCKETS.clear()
        PIVOTS.clear()
        self.vid = vid
        self.style = style or {}
        self.M = pal()
        self.finals = []          # final top-level objects (panels, wheels)
        self.args = argv()
        random.seed(hash(vid) & 0xffff)

    # -- helpers used by vehicle scripts
    def pivot(self, group, x, f, z):
        PIVOTS[group] = (x, f, z)

    def _merge_by_material(self, objs, prefix):
        by = defaultdict(list)
        for o in objs:
            key = o.material_slots[0].material.name if o.material_slots and o.material_slots[0].material else "none"
            by[key].append(o)
        out = []
        for k, lst in by.items():
            for o in lst:
                bake_transform(o) if o.parent is None else None
            out.append(join(lst, "%s_%s" % (prefix, k)) if len(lst) > 1 else _rename(lst[0], "%s_%s" % (prefix, k)))
        return out

    def finish(self, bake=True):
        args = self.args
        if args.get("parts"):
            agg = defaultdict(int)
            for gname, lst in REG.items():
                for o in lst:
                    if o.type == "MESH":
                        base = o.name.split(".")[0]
                        agg[(gname if gname.startswith("wheel") is False else "wheel", base)] += tri_count([o])
            for (gname, base), t in sorted(agg.items(), key=lambda kv: -kv[1])[:60]:
                print("PART %-16s %-22s %6d" % (gname, base, t))
        root_body = bpy.data.objects.new("body", None)
        root_body.empty_display_type = "PLAIN_AXES"
        root_body.empty_display_size = 0.3
        bpy.context.collection.objects.link(root_body)
        # 1. body: everything in group body (and unknown groups) merged by material under the `body` empty
        body_parts = list(REG.get("body", []))
        panels = {}
        wheels = {}
        # 0. steering wheel rim/spokes/hub -> own mesh node `steering_wheel_mesh`, child of the `steering_wheel` socket,
        #    geometry expressed in the socket frame (spinning it about local Z turns the wheel)
        if REG.get("steer") and "steering_wheel" in SOCKETS:
            sk = SOCKETS["steering_wheel"]
            lst = REG["steer"]
            for o in lst:
                bake_transform(o)
            sw = join(lst, "steering_wheel_mesh") if len(lst) > 1 else _rename(lst[0], "steering_wheel_mesh")
            sw.name = "steering_wheel_mesh"
            sw.data.name = "steering_wheel_mesh"
            bpy.context.view_layer.update()
            sw.data.transform(sk.matrix_world.inverted())
            sw.parent = sk
            sw.matrix_parent_inverse = Matrix.Identity(4)
            sw.matrix_basis = Matrix.Identity(4)
            smooth_by_angle(sw, 40)
        for gname, lst in REG.items():
            if gname in ("body", "steer"):
                continue
            if gname.startswith("panel_"):
                panels[gname] = lst
            elif gname.startswith("wheel_"):
                wheels[gname] = lst
            else:
                body_parts += lst
        if body_parts:
            for o in body_parts:
                bake_transform(o)
            bo = join(body_parts, "body_mesh") if len(body_parts) > 1 else _rename(body_parts[0], "body_mesh")
            bo.parent = root_body
            smooth_by_angle(bo, self.style.get("smooth", 38.0))
        # 2. panels: join all parts into one mesh object with origin at the hinge
        for gname, lst in panels.items():
            for o in lst:
                bake_transform(o)
            ob = join(lst, gname) if len(lst) > 1 else _rename(lst[0], gname)
            ob.data.name = gname
            hp = PIVOTS.get(gname)
            if hp is not None:
                set_origin(ob, P(*hp))
            smooth_by_angle(ob, self.style.get("smooth", 38.0))
        # 3. wheels: objects already built around the origin, moved to the hub
        for gname, lst in wheels.items():
            hub = PIVOTS[gname]
            em = bpy.data.objects.new(gname, None)
            em.empty_display_type = "PLAIN_AXES"
            em.empty_display_size = 0.2
            bpy.context.collection.objects.link(em)
            em.location = P(*hub)
            bpy.context.view_layer.update()
            for o in lst:
                o.parent = em
        bpy.context.view_layer.update()
        for o in bpy.context.scene.objects:
            if o.type == "MESH" and not o.data.uv_layers:
                o.data.uv_layers.new(name="UVMap")          # tangent export needs a UV map on every mesh
        if not args.get("nomerge"):
            consolidate_materials(self.style.get("merge_tris", 130))
        tris = tri_count()
        print("TRIS(before bake)", tris)
        if bake and not args.get("nobake"):
            bake_all(self.vid, self.style, res=int(args.get("res", 2048)), orm_res=int(args.get("orm", 1024)), samples=int(args.get("samples", 24)))
        else:
            self._flat_fallback()
            done = set()
            for o in bpy.context.scene.objects:
                if o.type == "MESH" and o.data.name not in done:
                    done.add(o.data.name)
                    bm = bmesh.new()
                    bm.from_mesh(o.data)
                    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
                    bm.to_mesh(o.data)
                    bm.free()
        if args.get("areas"):
            area_report()
        self.report()
        path = os.path.join(OUT_DIR, self.vid + ".glb")
        if args.get("out"):
            # QA builds (e.g. --nobake shape passes) go to a scratch file instead of replacing the shipped GLB
            path = os.path.join(PUBLIC, "models", "vehicles", "_qa", str(args["out"]))
        if args.get("strip"):
            # QA build: drop the named detachable panels (e.g. --strip panel_hood,panel_door_L) to check what is underneath; writes <id>_strip.glb
            kill = set(str(args["strip"]).split(","))
            for o in list(bpy.context.scene.objects):
                if o.name in kill:
                    for c in list(o.children):
                        bpy.data.objects.remove(c)
                    bpy.data.objects.remove(o)
            path = os.path.join(OUT_DIR, self.vid + "_strip.glb")
        self.export(path)
        return path

    def _flat_fallback(self):
        # tint-friendly flat colours for unbaked builds (paint stays near white)
        pass

    def report(self):
        n_mesh = sum(1 for o in bpy.context.scene.objects if o.type == "MESH")
        prims = 0
        for o in bpy.context.scene.objects:
            if o.type == "MESH":
                prims += max(1, len({p.material_index for p in o.data.polygons}))
        bb_min = Vector((1e9, 1e9, 1e9))
        bb_max = Vector((-1e9, -1e9, -1e9))
        for o in bpy.context.scene.objects:
            if o.type == "MESH":
                for c in o.bound_box:
                    w = o.matrix_world @ Vector(c)
                    bb_min = Vector((min(bb_min[i], w[i]) for i in range(3)))
                    bb_max = Vector((max(bb_max[i], w[i]) for i in range(3)))
        rows = []
        for o in bpy.context.scene.objects:
            if o.type == "MESH":
                rows.append((tri_count([o]), o.name))
        rows.sort(reverse=True)
        print("REPORT top objects:", ", ".join("%s=%d" % (n, t) for t, n in rows[:14]))
        print("REPORT tris=%d mesh_objects=%d primitives=%d" % (tri_count(), n_mesh, prims))
        print("REPORT bbox x[%.2f,%.2f] f[%.2f,%.2f] z[%.2f,%.2f] size=%.2f x %.2f x %.2f" % (
            bb_min.x, bb_max.x, -bb_max.y, -bb_min.y, bb_min.z, bb_max.z, bb_max.x - bb_min.x, bb_max.y - bb_min.y, bb_max.z - bb_min.z))

    def export(self, path):
        objs = [o for o in bpy.context.scene.objects if o.parent is None and not o.name.startswith("_tmp")]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.object.select_all(action="DESELECT")
        sel = set()

        def add(o):
            sel.add(o)
            for c in o.children:
                add(c)
        for o in objs:
            add(o)
        for o in sel:
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                                  export_materials="EXPORT", export_cameras=False, export_lights=False, export_extras=True,
                                  export_image_format="JPEG", export_jpeg_quality=int(self.args.get("jpeg", 90)), export_texcoords=True, export_normals=True,
                                  export_tangents=not self.args.get("notangents"), export_animations=False, export_skins=False, export_vertex_color="NONE")
        print("EXPORTED", path, "%.1f KB" % (os.path.getsize(path) / 1024))


def _rename(o, name):
    o.name = name
    o.data.name = name
    return o


# tiny per-object material uses fold into a visually close palette neighbour (each material in a mesh = one draw call)
MERGE_TO = {"leather": "interior", "plastic": "interior", "rubber": "rubber_tire", "gun_metal": "metal_dark", "gun_steel": "metal_bare",
            "gun_black": "metal_dark", "cloth_tan": "canvas", "fabric": "interior", "cloth_dark": "interior", "brass": "metal_bare",
            "wood": "rust", "spike": "metal_bare", "rim": "metal_dark"}


def consolidate_materials(max_tris=130):
    for o in bpy.context.scene.objects:
        if o.type != "MESH" or o.name == "gun_mg" or o.name.startswith("wheel_"):
            continue
        me = o.data
        names = [s.material.name if s.material else "" for s in o.material_slots]
        cnt = defaultdict(int)
        for p in me.polygons:
            cnt[p.material_index] += len(p.vertices) - 2
        remap = {}
        for i, nm in enumerate(names):
            tgt = MERGE_TO.get(nm)
            if not tgt or cnt.get(i, 0) == 0 or cnt[i] > max_tris:
                continue
            if tgt not in names:
                if tgt not in rod_lib._MATS:
                    continue
                me.materials.append(rod_lib._MATS[tgt])
                names.append(tgt)
            remap[i] = names.index(tgt)
        if remap:
            for p in me.polygons:
                if p.material_index in remap:
                    p.material_index = remap[p.material_index]
            print("MERGED %-20s %s" % (o.name, ", ".join("%s->%s(%d)" % (names[a], names[b], cnt[a]) for a, b in remap.items())))

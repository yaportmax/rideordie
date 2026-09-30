"""Collapse a character's many materials into ONE atlas material per class (draw-call reduction).

Classes:  body  (skin, clothes, gear, boots, metal, lenses ...)   opaque, double sided
          hair  (hair, mohawk, brows, lashes)                     alpha-tested (MASK), double sided
          eye   (eyeballs)                                        opaque
Every primitive's UV islands (connected triangle sets) are repacked into the class atlas at a common world texel
density (faces/hands get a priority boost), sampling each source texture (atlas-sourced textures clamped, tiling
gear textures wrapped) and baking the material's colour factor, roughness/metal factors or ORM texture, normal map and
emissive into atlas textures.  Islands that would be smaller than a few texels (rivets, studs, shells) share a per
material colour swatch.

Atlas textures of the body class:
    albedo (sRGB)                                    baseColorTexture
    normal (tangent space, glTF +Y)                  normalTexture
    mr: R = DETAIL CLASS + PAINT FLAG: R = class * 32 + (paint ? 24 : 8)   (class 0 none, 1 skin, 2 fabric, 3 leather,
                                                     4 metal, 5 rubber/plastic; paint = the source material was `paint*`, tint it
                                                     at runtime); G = roughness, B = metallic
                                                     metallicRoughnessTexture  (glTF ignores R; src/view/crew_view.js reads it)
    The body material carries extras.detail = {pxm, size}: atlas texels per metre (islands at priority 1) and atlas size, so
    the runtime can tile world-scale micro-detail over the atlas UVs.
    emissive (only when a source material glows)     emissiveTexture
"""
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

import mh
import uvbake as U

HAIR = {"hair", "hair_face"}
EYE = {"eye"}


DETAIL = {"none": 0, "skin": 1, "fabric": 2, "leather": 3, "metal": 4, "rubber": 5, "plastic": 5}


def detail_class(name, overrides=None):
    """Micro-detail class of a source material (see the module doc): per-character overrides first, then name rules."""
    if overrides and name in overrides:
        return DETAIL[overrides[name]]
    n = name.lower()
    rules = (("skin", "skin"), ("eye", "none"), ("glass", "none"), ("lens", "none"), ("light", "none"), ("leather", "leather"),
             ("glove", "leather"), ("boot", "leather"), ("metal", "metal"), ("armor", "metal"), ("spike", "metal"), ("rust", "metal"),
             ("rim", "metal"), ("chain", "metal"), ("steel", "metal"), ("rubber", "rubber"), ("plastic", "plastic"), ("bone", "plastic"),
             ("webbing", "fabric"), ("canvas", "fabric"), ("tape", "fabric"), ("rag", "fabric"), ("cloth", "fabric"), ("knit", "fabric"),
             ("denim", "fabric"), ("trim", "fabric"), ("paint", "fabric"), ("strap", "fabric"), ("lace", "fabric"))
    for key, cls in rules:
        if key in n:
            return DETAIL[cls]
    return 0


def classify(name):
    if name in HAIR:
        return "hair"
    if name in EYE:
        return "eye"
    return "body"


# --- sources ----------------------------------------------------------------------------------------------

class Source:
    """One source material: its textures (uint8 arrays), factors and sampling mode, with a mip cache."""

    def __init__(self, ctx, mi):
        g = ctx.glb.g
        m = g["materials"][mi]
        pbr = m.get("pbrMetallicRoughness", {})

        def arr(ti):
            if ti is None:
                return None
            key = g["textures"][ti["index"]]["name"]
            a = ctx.glb.arrays.get(key)
            if a is None:
                return None
            a = np.asarray(a)
            if a.ndim == 2:
                a = np.repeat(a[..., None], 3, axis=2)
            return a

        self.name = m["name"]
        self.base = arr(pbr.get("baseColorTexture"))
        self.normal = arr(m.get("normalTexture"))
        self.mr = arr(pbr.get("metallicRoughnessTexture"))
        col = np.array(pbr.get("baseColorFactor", [1, 1, 1, 1]), float)
        self.color = np.clip(col[:3], 0, None) ** (1 / 2.2)          # back to sRGB (factors were linearised by Glb.material)
        self.alpha = float(col[3])
        self.rough = float(pbr.get("roughnessFactor", 1.0))
        self.metal = float(pbr.get("metallicFactor", 0.0))
        em = m.get("emissiveFactor")
        self.emissive = None
        if em is not None and max(em) > 0:
            st = m.get("extensions", {}).get("KHR_materials_emissive_strength", {}).get("emissiveStrength", 1.0)
            self.emissive = (np.array(em, float) ** (1 / 2.2), float(st))
        self.paint = self.name.startswith("paint")
        self.dclass = detail_class(self.name, getattr(ctx, "detail_class", {}))
        self.wrap = self.name not in ctx.clamped
        if self.alpha < 1.0 and m.get("alphaMode") == "BLEND":     # lenses become opaque glossy glass in the atlas
            self.rough = min(self.rough, 0.08)
            self.color = self.color * (0.55 + 0.45 * self.alpha)
        self.size = None
        for a in (self.base, self.normal, self.mr):
            if a is not None:
                self.size = (a.shape[1], a.shape[0])
                break
        self._mips = {}

    def textured(self):
        return self.size is not None

    def mip(self, which, k):
        key = (which, k)
        if key not in self._mips:
            a = getattr(self, which)
            if a is None:
                self._mips[key] = None
            elif k == 0:
                self._mips[key] = a.astype(np.float32)
            else:
                im = Image.fromarray(a)
                w, h = max(1, a.shape[1] >> k), max(1, a.shape[0] >> k)
                self._mips[key] = np.asarray(im.resize((w, h), Image.BOX)).astype(np.float32)
        return self._mips[key]

    def sample(self, which, k, sx, sy):
        """Bilinear sample of texture `which` at level-0 pixel coords (sx, sy) (arrays), from mip level k."""
        a = self.mip(which, k)
        if a is None:
            return None
        s = float(2 ** k)
        x = sx / s - 0.5
        y = sy / s - 0.5
        mode = "grid-wrap" if self.wrap else "nearest"
        ch = a.shape[2] if a.ndim == 3 else 1
        out = np.empty(sx.shape + (ch,), np.float32)
        for c in range(ch):
            out[..., c] = ndimage.map_coordinates(a[..., c], [y, x], order=1, mode=mode)
        return out

    def mean(self, which):
        a = getattr(self, which)
        if a is None:
            return None
        return a.reshape(-1, a.shape[-1]).astype(np.float32).mean(axis=0)


# --- islands -----------------------------------------------------------------------------------------------

def islands(idx, nverts):
    t = idx.reshape(-1, 3)
    rows = np.concatenate([t[:, 0], t[:, 1], t[:, 2]])
    cols = np.concatenate([t[:, 1], t[:, 2], t[:, 0]])
    A = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(nverts, nverts))
    n, lab = connected_components(A, directed=False)
    return lab[t[:, 0]], lab


class Island:
    __slots__ = ("pi", "tris", "verts", "src", "sx0", "sy0", "sx1", "sy1", "d_src", "prio", "world", "f", "w", "h", "x", "y", "swatch", "kind")


def gather(entries, prio_fn):
    """entries: list of (prim, Source). Returns list of Island."""
    out = []
    for pi, (p, src) in enumerate(entries):
        idx = np.asarray(p["idx"]).reshape(-1, 3)
        uv = np.asarray(p["uv"], np.float64)
        pos = np.asarray(p["pos"], np.float64)
        tl, vl = islands(idx, len(uv))
        W, H = src.size if src.textured() else (1, 1)
        for lab in np.unique(tl):
            tsel = np.flatnonzero(tl == lab)
            tri = idx[tsel]
            verts = np.unique(tri)
            isl = Island()
            isl.pi, isl.tris, isl.verts, isl.src = pi, tsel, verts, src
            u = uv[verts, 0] * W
            v = uv[verts, 1] * H
            isl.sx0, isl.sx1, isl.sy0, isl.sy1 = float(u.min()), float(u.max()), float(v.min()), float(v.max())
            a, b, c = pos[tri[:, 0]], pos[tri[:, 1]], pos[tri[:, 2]]
            wa = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum()
            ua, ub, uc = uv[tri[:, 0]] * [W, H], uv[tri[:, 1]] * [W, H], uv[tri[:, 2]] * [W, H]
            pa = 0.5 * np.abs((ub[:, 0] - ua[:, 0]) * (uc[:, 1] - ua[:, 1]) - (uc[:, 0] - ua[:, 0]) * (ub[:, 1] - ua[:, 1])).sum()
            isl.world = float(wa)
            isl.d_src = float(np.sqrt(pa / max(wa, 1e-9))) if src.textured() and pa > 0 else 0.0
            isl.prio = prio_fn(p, verts)
            isl.swatch = False
            out.append(isl)
    return out


def shelf_pack(sizes, S):
    """Skyline bottom-left packing (tighter than shelves); rects sorted by height then width."""
    order = sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0]))
    sky = [[0, 0, S]]                      # segments: x, y, width
    offs = [None] * len(sizes)
    for i in order:
        w, h = sizes[i]
        if w > S or h > S:
            return None
        best = None
        for si in range(len(sky)):
            x = sky[si][0]
            if x + w > S:
                break
            # the rect spans segments si.. while their total width < w: y = max of their heights
            y, width, sj = 0, 0, si
            while width < w and sj < len(sky):
                y = max(y, sky[sj][1])
                width += sky[sj][2]
                sj += 1
            if width < w or y + h > S:
                continue
            if best is None or y < best[1] or (y == best[1] and x < best[0]):
                best = (x, y, si)
        if best is None:
            return None
        x, y, si = best
        offs[i] = (x, y)
        # update the skyline: replace covered part by the new top
        new = [x, y + h, w]
        out = []
        for seg in sky:
            sx, sy, sw_ = seg
            ex = sx + sw_
            if ex <= x or sx >= x + w:
                out.append(seg)
                continue
            if sx < x:
                out.append([sx, sy, x - sx])
            if ex > x + w:
                out.append([x + w, sy, ex - (x + w)])
        out.append(new)
        out.sort(key=lambda s_: s_[0])
        merged = []
        for seg in out:
            if merged and merged[-1][1] == seg[1] and merged[-1][0] + merged[-1][2] == seg[0]:
                merged[-1][2] += seg[2]
            else:
                merged.append(seg)
        sky = merged
    return offs


def _shelf_pack_old(sizes, S):
    order = sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0]))
    x = y = shelf = 0
    offs = [None] * len(sizes)
    for i in order:
        w, h = sizes[i]
        if w > S or h > S:
            return None
        if x + w > S:
            x, y, shelf = 0, y + shelf, 0
        if y + h > S:
            return None
        offs[i] = (x, y)
        x += w
        shelf = max(shelf, h)
    return offs


def layout(isls, S, pad, swatch_px=6, max_frac=0.5, tile_px=None):
    """Choose the density D (px per metre) that fills the atlas and assign every island a slot:
        own    - its own rect (large islands),
        shared - small islands of a TILING material share that material's detail tile (same texel scale),
        swatch - tiny / untextured islands share a flat mean-colour swatch of their material.
    Returns (swatch offsets per source id, tile slots per source id, D)."""
    T = tile_px or (64 if S >= 2048 else 48 if S >= 1024 else 32)

    def plan(D):
        own, tiles, sws = [], {}, []
        per_src_f = {}
        for it in isls:
            it.swatch = False
            it.kind = None
            if not it.src.textured() or it.d_src <= 0:
                it.kind = "swatch"
                continue
            f = min(D * it.prio / it.d_src, 1.0)
            w = int(np.ceil((it.sx1 - it.sx0) * f)) + 1
            h = int(np.ceil((it.sy1 - it.sy0) * f)) + 1
            lim = int(S * max_frac)
            if max(w, h) > lim:
                k = lim / max(w, h)
                f *= k
                w, h = max(1, int(w * k)), max(1, int(h * k))
            it.f, it.w, it.h = f, w, h
            if it.src.wrap:
                per_src_f.setdefault(id(it.src), []).append(f)
        for sid, fl in per_src_f.items():
            tiles[sid] = float(np.median(fl))
        for it in isls:
            if it.kind == "swatch":
                continue
            if it.src.wrap:
                ft = tiles[id(it.src)]
                if (it.sx1 - it.sx0) * ft <= T - 1 and (it.sy1 - it.sy0) * ft <= T - 1:
                    it.kind = "shared"
                    it.f = ft
                    continue
            elif it.w <= 4 and it.h <= 4:
                it.kind = "swatch"
                continue
            it.kind = "own"
            own.append(it)
        used_tiles = sorted({id(it.src) for it in isls if it.kind == "shared"})
        used_sw = sorted({id(it.src) for it in isls if it.kind == "swatch"})
        sizes = [(it.w + 2 * pad, it.h + 2 * pad) for it in own] + [(T + 2 * pad, T + 2 * pad)] * len(used_tiles)             + [(swatch_px + 2 * pad, swatch_px + 2 * pad)] * len(used_sw)
        return own, used_tiles, used_sw, tiles, sizes

    lo, hi = 20.0, 6000.0
    best = None
    for _ in range(26):
        D = np.sqrt(lo * hi)
        own, ut, us, tiles, sizes = plan(D)
        if shelf_pack(sizes, S) is None:
            hi = D
        else:
            lo = D
            best = D
        if hi / lo < 1.02:
            break
    D = best if best is not None else lo
    own, ut, us, tiles, sizes = plan(D)
    offs = shelf_pack(sizes, S)
    if offs is None:
        raise RuntimeError("atlas packing failed")
    for k, it in enumerate(own):
        it.x, it.y = offs[k]
    n = len(own)
    tile_slots = {sid: (offs[n + j], tiles[sid], T) for j, sid in enumerate(ut)}
    sw = {sid: offs[n + len(ut) + j] for j, sid in enumerate(us)}
    for it in isls:
        it.swatch = it.kind == "swatch"
    return sw, tile_slots, D


def render(entries, isls, sw, tile_slots, S, pad, alpha=False, swatch_px=6):
    """Rasterise all islands into the atlas images and return (images dict, remapped uv per entry)."""
    albedo = np.zeros((S, S, 4 if alpha else 3), np.float32)
    normal = np.zeros((S, S, 3), np.float32)
    normal[...] = (128.0, 128.0, 255.0)
    mr = np.zeros((S, S, 3), np.float32)
    mr[..., 0] = 8
    mr[..., 1] = 0.85 * 255
    emis = None
    if any(s.emissive is not None for _, s in entries):
        emis = np.zeros((S, S, 3), np.float32)
    written = np.zeros((S, S), bool)
    new_uv = [np.asarray(p["uv"], np.float64).copy() for p, _ in entries]

    def put(src, x0, y0, w, h, sx, sy):
        """Fill dest rect [y0:y0+h, x0:x0+w] from source coordinates (sx, sy) (level-0 px arrays shaped (h, w))."""
        ys, xs = slice(y0, y0 + h), slice(x0, x0 + w)
        fpx = getattr(put, "f", 1.0)
        k = int(max(0, np.floor(np.log2(1.0 / max(fpx, 1e-6)))))
        k = min(k, 6)
        if src.base is not None:
            b = src.sample("base", k, sx, sy) / 255.0
            rgb = b[..., :3] * src.color[None, None, :]
            if alpha:
                a = b[..., 3:4] if b.shape[-1] == 4 else np.ones(b.shape[:2] + (1,), np.float32)
                albedo[ys, xs] = np.concatenate([rgb, a], -1) * 255.0
            else:
                albedo[ys, xs] = rgb * 255.0
        else:
            c = np.concatenate([src.color, [1.0]]) if alpha else src.color
            albedo[ys, xs] = np.asarray(c, np.float32) * 255.0
        if src.normal is not None:
            normal[ys, xs] = src.sample("normal", k, sx, sy)[..., :3]
        if src.mr is not None:
            m = src.sample("mr", k, sx, sy)
            mr[ys, xs, 1] = np.clip(m[..., 1] * src.rough, 0, 255)
            mr[ys, xs, 2] = np.clip(m[..., 2] * src.metal, 0, 255)
        else:
            mr[ys, xs, 1] = src.rough * 255.0
            mr[ys, xs, 2] = src.metal * 255.0
        mr[ys, xs, 0] = src.dclass * 32 + (24 if src.paint else 8)
        if emis is not None and src.emissive is not None:
            emis[ys, xs] = np.asarray(src.emissive[0], np.float32) * 255.0
        written[ys, xs] = True

    # shared detail tiles of tiling materials: one T x T sample of the texture at the material's texel scale
    for sid, ((x0, y0), ft, T) in tile_slots.items():
        src = next(it.src for it in isls if id(it.src) == sid)
        n = T + 2 * pad
        gx, gy = np.meshgrid(np.arange(n, dtype=np.float64), np.arange(n, dtype=np.float64))
        put.f = ft
        put(src, x0, y0, n, n, (gx - pad + 0.5) / ft, (gy - pad + 0.5) / ft)
        for it in isls:
            if it.kind != "shared" or id(it.src) != sid:
                continue
            W, H = src.size
            uv = new_uv[it.pi]
            ouv = np.asarray(entries[it.pi][0]["uv"], np.float64)[it.verts]
            # the island's min corner lands on the tile origin (wrap: same texture content modulo the tile)
            uv[it.verts, 0] = (x0 + pad + (ouv[:, 0] * W - it.sx0) * ft) / S
            uv[it.verts, 1] = (y0 + pad + (ouv[:, 1] * H - it.sy0) * ft) / S
    # own islands
    for it in isls:
        if it.kind != "own":
            continue
        src = it.src
        W, H = src.size
        f = it.f
        w_o, h_o = it.w + 2 * pad, it.h + 2 * pad
        gx, gy = np.meshgrid(np.arange(w_o, dtype=np.float64), np.arange(h_o, dtype=np.float64))
        sx = it.sx0 + (gx - pad + 0.5) / f
        sy = it.sy0 + (gy - pad + 0.5) / f
        put.f = f
        put(src, it.x, it.y, w_o, h_o, sx, sy)
        uv = new_uv[it.pi]
        p = entries[it.pi][0]
        ouv = np.asarray(p["uv"], np.float64)[it.verts]
        uv[it.verts, 0] = (it.x + pad + (ouv[:, 0] * W - it.sx0) * f) / S
        uv[it.verts, 1] = (it.y + pad + (ouv[:, 1] * H - it.sy0) * f) / S
    # swatches: flat mean colour of the source, islands scaled into the swatch
    for sid, (x0, y0) in sw.items():
        src = next(it.src for it in isls if id(it.src) == sid)
        n = swatch_px + 2 * pad
        if src.textured():
            W, H = src.size
            gx, gy = np.meshgrid(np.arange(n, dtype=np.float64), np.arange(n, dtype=np.float64))
            # sample a representative patch of the source (its centre) heavily blurred -> mean look
            sx = np.full_like(gx, W * 0.5)
            sy = np.full_like(gy, H * 0.5)
            put.f = 1.0 / 64.0
            put(src, x0, y0, n, n, sx, sy)
            normal[y0:y0 + n, x0:x0 + n] = (128.0, 128.0, 255.0)
        else:
            put.f = 1.0
            put(src, x0, y0, n, n, np.zeros((n, n)), np.zeros((n, n)))
        for it in isls:
            if not it.swatch or id(it.src) != sid:
                continue
            uv = new_uv[it.pi]
            p = entries[it.pi][0]
            ouv = np.asarray(p["uv"], np.float64)[it.verts]
            lo, hi = ouv.min(axis=0), ouv.max(axis=0)
            span = max(float((hi - lo).max()), 1e-9)          # keep the island's UV shape (non-degenerate tangents)
            uv[it.verts, 0] = (x0 + pad + 0.5 + (ouv[:, 0] - lo[0]) / span * (swatch_px - 1)) / S
            uv[it.verts, 1] = (y0 + pad + 0.5 + (ouv[:, 1] - lo[1]) / span * (swatch_px - 1)) / S
    # fill the gutters (mip bleeding) from the nearest written texel
    fillmask = written
    albedo = U.dilate(albedo, fillmask)
    normal = U.dilate(normal, fillmask)
    mr = U.dilate(mr, fillmask)
    if emis is not None:
        emis = U.dilate(emis, fillmask)
    imgs = dict(albedo=np.clip(albedo + 0.5, 0, 255).astype(np.uint8), normal=np.clip(normal + 0.5, 0, 255).astype(np.uint8),
                mr=np.clip(mr + 0.5, 0, 255).astype(np.uint8), emissive=None if emis is None else np.clip(emis + 0.5, 0, 255).astype(np.uint8))
    return imgs, new_uv


# --- the merge -----------------------------------------------------------------------------------------------

def _prio_fn(head_boost=2.0, hand_boost=1.4):
    head_ids = np.array([mh.BONE_INDEX["Head"], mh.BONE_INDEX["Neck"]])
    hand_ids = np.array([i for n, i in mh.BONE_INDEX.items() if "Hand" in n])

    def prio(p, verts):
        j = np.asarray(p["joints"])[verts, 0]
        if np.isin(j, head_ids).mean() > 0.5:
            return head_boost
        if np.isin(j, hand_ids).mean() > 0.5:
            return hand_boost
        return 1.0
    return prio


def _concat(prims):
    out = {k: [] for k in ("pos", "nrm", "uv", "joints", "weights", "color", "idx")}
    base = 0
    for p in prims:
        n = len(p["pos"])
        out["pos"].append(np.asarray(p["pos"], np.float32))
        out["nrm"].append(np.asarray(p["nrm"], np.float32))
        out["uv"].append(np.asarray(p["uv"], np.float32))
        out["joints"].append(np.asarray(p["joints"]))
        out["weights"].append(np.asarray(p["weights"], np.float32))
        c = p.get("color")
        out["color"].append(np.ones((n, 3), np.float32) if c is None else np.asarray(c, np.float32)[:, :3])
        out["idx"].append(np.asarray(p["idx"]).reshape(-1) + base)
        base += n
    r = {k: np.concatenate(v) for k, v in out.items()}
    if np.allclose(r["color"], 1.0):
        r.pop("color")
    return r


def merge(ctx, out, sizes=None, pad=None, head_boost=2.0, hand_boost=1.4, jpg_q=88):
    """Build atlas materials in `out` (a fresh glb.Glb) and return {group: [prims with 'material' set]}.
    sizes: dict(body=2048, hair=1024, eye=256)."""
    sizes = {**dict(body=1024, hair=512, eye=128), **(sizes or {})}
    srcs = {}
    by_class = {"body": [], "hair": [], "eye": [], "armor": []}
    for gname, prims in ctx.groups.items():
        for p in prims:
            mi = p["material"]
            if mi not in srcs:
                srcs[mi] = Source(ctx, mi)
            cls = classify(srcs[mi].name)
            if cls == "body" and "armor" in sizes and gname.startswith("armor_"):
                cls = "armor"                   # hidden armor tiers get their own atlas (the base body keeps the full one)
            by_class[cls].append((gname, p, srcs[mi]))
    result = {}
    prio = _prio_fn(head_boost, hand_boost)
    for cls, items in by_class.items():
        if not items:
            continue
        S = sizes[cls]
        pd = pad if pad is not None else (4 if S >= 2048 else 3 if S >= 1024 else 2)
        entries = [(p, s) for _, p, s in items]
        isls = gather(entries, prio if cls in ("body", "armor") else (lambda p, v: 1.0))
        sw, tiles, D = layout(isls, S, pd)
        imgs, new_uv = render(entries, isls, sw, tiles, S, pd, alpha=(cls == "hair"))
        kinds = {k: sum(1 for i in isls if i.kind == k) for k in ("own", "shared", "swatch")}
        print("  atlas %-4s %d px: %d islands %s, %d tiles, %.0f px/m (%.2f mm/texel)" % (
            cls, S, len(isls), kinds, len(tiles), D, 1000.0 / max(D, 1e-6)))
        if cls == "hair":
            tb = out.texture_array("hair_albedo", imgs["albedo"], "png")
            mat = out.material("hair", base_tex=tb, rough=0.7, alpha_mode="MASK", alpha_cutoff=0.42, double_sided=True, srgb=False,
                               spec=0.2)
        elif cls == "eye":
            tb = out.texture_array("eye_albedo", imgs["albedo"], "jpg", 92)
            mat = out.material("eye", base_tex=tb, rough=0.25, srgb=False)
        else:
            tb = out.texture_array(cls + "_albedo", imgs["albedo"], "jpg", jpg_q)
            tn = out.texture_array(cls + "_normal", imgs["normal"], "jpg", 92)
            tm = out.texture_array(cls + "_mr", imgs["mr"], "jpg", 94)          # 4:4:4 - R carries the detail class
            kw = {}
            if imgs["emissive"] is not None:
                te = out.texture_array("body_emissive", imgs["emissive"], "jpg", 85)
                strength = max(s.emissive[1] for _, s in entries if s.emissive is not None)
                kw = dict(emissive=(1.0, 1.0, 1.0), emissive_strength=strength)
            mat = out.material(cls, base_tex=tb, normal_tex=tn, mr_tex=tm, rough=1.0, metallic=1.0, double_sided=True, srgb=False,
                               spec=0.45, **kw)
            out.g["materials"][mat]["extras"] = {"detail": {"pxm": round(float(D), 2), "size": int(S)}}
            if imgs["emissive"] is not None:
                out.g["materials"][mat]["emissiveTexture"] = {"index": te}
        ctx.atlas_images = getattr(ctx, "atlas_images", {})
        ctx.atlas_images[cls] = imgs
        try:
            import os
            d = "C:/Dev/rideordie/shots/chars/atlas"
            os.makedirs(d, exist_ok=True)
            Image.fromarray(imgs["albedo"]).save("%s/%s_%s.png" % (d, ctx.name, cls))
            if cls in ("body", "armor"):
                Image.fromarray(imgs["mr"]).save("%s/%s_%s_mr.png" % (d, ctx.name, cls))
        except Exception as e:                      # debug output only
            print("  (atlas dump failed: %s)" % e)
        # merge prims per group
        per_group = {}
        for (gname, p, s), uv in zip(items, new_uv):
            q = dict(p)
            q["uv"] = uv
            per_group.setdefault(gname, []).append(q)
        for gname, plist in per_group.items():
            m = _concat(plist)
            m["material"] = mat
            m["_label"] = "body" if cls == "armor" else cls
            result.setdefault(gname, []).append(m)
    return result

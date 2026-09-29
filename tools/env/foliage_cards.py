"""Procedural foliage cards / skins for the vegetation props.  Writes RGBA PNGs (colour bled into transparent texels) to the props texture cache.
   usage: foliage_cards.py [name ...]      (no args = everything)      view with the Read tool!
   Cards are drawn at 2x and box-downsampled with premultiplied alpha.  Stem/base of every card is at the bottom centre (v=0), tip at the top."""
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

PTEX = os.environ.get("ROD_PROP_TEX", "C:/Dev/art_cache/rideordie/props_tex")
os.makedirs(PTEX, exist_ok=True)
SS = 2


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))


def jit(c, r, amt=10):
    d = r.uniform(-amt, amt)
    return tuple(int(max(0, min(255, v + d + r.uniform(-amt * 0.3, amt * 0.3)))) for v in c[:3])


def bez(p0, p1, p2, t):
    a = lerp(p0, p1, t); b = lerp(p1, p2, t)
    return lerp(a, b, t)


def finish_rgba(im, path, size, boost=0.0):
    """downsample premultiplied, bleed colour into transparent texels, save"""
    a = np.asarray(im.convert("RGBA"), dtype=np.float32) / 255.0
    alpha = a[..., 3:4]
    pm = np.concatenate([a[..., :3] * alpha, alpha], -1)
    big = Image.fromarray((pm * 255 + 0.5).astype(np.uint8), "RGBA").resize(size, Image.BOX)
    p = np.asarray(big, dtype=np.float32) / 255.0
    al = p[..., 3]
    if boost:
        al = 1.0 - (1.0 - al) ** boost                       # fatten thin needles so alpha-tested mips keep coverage
    rgb = np.where(al[..., None] > 1e-3, p[..., :3] / np.maximum(al[..., None], 1e-3), 0.0)
    solid = al > 0.35
    idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    rgb = rgb[idx[0], idx[1]]
    out = np.concatenate([rgb, al[..., None]], -1)
    Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(path, optimize=True)
    print("card", os.path.basename(path), size, "coverage %.2f" % float((al > 0.5).mean()))


def canvas(w, h):
    return Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))


def line(d, p0, p1, col, w):
    d.line([(p0[0] * SS, p0[1] * SS), (p1[0] * SS, p1[1] * SS)], fill=col + (255,), width=max(1, int(w * SS)))


def poly(d, pts, col):
    d.polygon([(x * SS, y * SS) for x, y in pts], fill=col + (255,))


def ellipse_leaf(d, c, ang, L, W, col, veins=None):
    """pointed leaf centred at c, pointing along ang (radians)"""
    ca, sa = math.cos(ang), math.sin(ang)
    pts = []
    for k in range(9):
        t = k / 8.0
        w = math.sin(t * math.pi) ** 0.8 * W * 0.5
        x, y = -L / 2 + L * t, w
        pts.append((c[0] + x * ca - y * sa, c[1] + x * sa + y * ca))
    for k in range(8, -1, -1):
        t = k / 8.0
        w = math.sin(t * math.pi) ** 0.8 * W * 0.5
        x, y = -L / 2 + L * t, -w
        pts.append((c[0] + x * ca - y * sa, c[1] + x * sa + y * ca))
    poly(d, pts, col)
    if veins:
        line(d, (c[0] - ca * L / 2, c[1] - sa * L / 2), (c[0] + ca * L / 2, c[1] + sa * L / 2), veins, 1.2)


# ----------------------------------------------------------------------------------------------------- conifer sprigs
def conifer_sprig(kind, seed):
    """fine needle clusters on twigs (bottle-brush): hundreds of thin needles, dark inside, lighter yellow-green tips, gaps between twigs"""
    r = random.Random(seed)
    W = H = 512
    im = canvas(W, H)
    d = ImageDraw.Draw(im)
    twig_col = (58, 44, 30)
    if kind == "a":        # spruce/fir-like: short dense needles all around the twig
        inner, tip = (28, 44, 22), (98, 110, 48)
        nlen, per, step, nlat, spread, sgn_lo, sgn_hi = (26, 44), 5, 4.2, 6, 1.0, 22, 78
    elif kind == "b":      # ponderosa: long needles in fans at twig ends + scattered along twigs
        inner, tip = (40, 56, 24), (132, 138, 62)
        nlen, per, step, nlat, spread, sgn_lo, sgn_hi = (58, 96), 4, 6.0, 6, 0.95, 8, 74
    else:                  # fir: shorter flatter needles, slightly darker
        inner, tip = (26, 44, 24), (86, 104, 50)
        nlen, per, step, nlat, spread, sgn_lo, sgn_hi = (20, 34), 5, 3.8, 7, 0.88, 30, 82
    x0, y0, y1 = W / 2, H - 4, 10
    def stem(t):
        return (x0 + 10 * math.sin(t * 3.2 + seed), y0 + (y1 - y0) * t)
    def draw_twig(pts, u_scale=1.0, width=2.0):
        for k in range(len(pts) - 1):
            line(d, pts[k], pts[k + 1], twig_col, width * (1 - k / len(pts) * 0.6))
        # needles along the polyline
        total = sum(math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) for k in range(len(pts) - 1))
        pos = step * 1.5
        acc = 0.0
        k = 0
        seglen = math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
        while pos < total:
            while k < len(pts) - 2 and acc + seglen < pos:
                acc += seglen
                k += 1
                seglen = math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1])
            f = (pos - acc) / max(seglen, 1e-6)
            p = (pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f)
            dv = (pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1])
            base_a = math.atan2(dv[1], dv[0])
            u = pos / total
            taper = 1.0 - 0.45 * u
            nn = per
            for q in range(nn):
                sgn = r.choice((-1, 1))
                ang = base_a + sgn * math.radians(r.uniform(sgn_lo, sgn_hi))
                ln = r.uniform(*nlen) * taper * (0.75 + 0.5 * math.sin(math.pi * min(1, u * 0.9 + 0.1)))
                mid = (p[0] + math.cos(ang) * ln * 0.5, p[1] + math.sin(ang) * ln * 0.5)
                end = (p[0] + math.cos(ang) * ln, p[1] + math.sin(ang) * ln)
                lightness = min(1.0, 0.10 + 0.55 * u_scale * u + r.uniform(0.0, 0.35))
                c_in = jit(lerp(inner, tip, lightness * 0.35), r, 5)
                c_out = jit(lerp(inner, tip, lightness), r, 7)
                line(d, p, mid, c_in, 1.7)
                line(d, mid, end, c_out, 1.5)
            pos += step * r.uniform(0.75, 1.25)
    # laterals first (behind), then the main stem on top
    for side in (-1, 1):
        for i in range(nlat):
            t = 0.10 + 0.80 * (i + r.uniform(-0.2, 0.2) * 0.5) / (nlat - 1)
            if r.random() < 0.10:
                continue
            sp = stem(t)
            reach = (W * 0.5 - 20) * spread * (math.sin(math.pi * min(1.0, t ** 0.7 * 0.97)) * 0.75 + 0.25 * (1 - t)) * r.uniform(0.78, 1.05)
            reach = max(reach, 60)
            ang0 = math.radians(56 - 22 * t + r.uniform(-8, 8))
            droop = (0.22 if kind == "a" else 0.10 if kind == "b" else 0.15) * reach
            n = 12
            pts = []
            for k in range(n + 1):
                u = k / n
                pts.append((sp[0] + side * math.sin(ang0) * reach * u + r.uniform(-1.5, 1.5), sp[1] - math.cos(ang0) * reach * u * 0.6 + droop * u * u))
            draw_twig(pts, 1.0, 2.2)
            if kind == "b":       # pom-pom fan of long needles at the twig end
                e0 = pts[-1]
                for q in range(18):
                    aa = math.radians(-90 + side * 35 + r.uniform(-75, 75))
                    ln = r.uniform(*nlen) * 0.95
                    line(d, e0, (e0[0] + math.cos(aa) * ln, e0[1] + math.sin(aa) * ln), jit(lerp(inner, tip, r.uniform(0.35, 1.0)), r, 8), 1.7)
            # a short sub twig
            if r.random() < 0.7 and reach > 100:
                u0 = r.uniform(0.35, 0.6)
                q0 = pts[int(u0 * n)]
                sub = [(q0[0] + side * k * 7, q0[1] - k * 10 + k * k * 0.5) for k in range(7)]
                draw_twig(sub, 0.9, 1.6)
    stem_pts = [stem(i / 24) for i in range(25)]
    draw_twig(stem_pts, 0.9, 3.4)
    # terminal tuft
    for q in range(16):
        a = math.radians(-90 + r.uniform(-40, 40))
        ln = r.uniform(*nlen) * 0.9
        e = (x0 + math.cos(a) * ln, y1 + 6 + math.sin(a) * ln + 18)
        line(d, (x0, y1 + 20), e, jit(tip, r, 8), 1.6)
    return im


# ----------------------------------------------------------------------------------------------------- other foliage
def blades(kind, seed, n=46):
    r = random.Random(seed)
    W = H = 512
    im = canvas(W, H)
    d = ImageDraw.Draw(im)
    if kind == "dry":
        cols = [((122, 96, 54), (206, 178, 108)), ((150, 122, 70), (226, 200, 130)), ((104, 84, 50), (180, 150, 92))]
    else:
        cols = [((44, 70, 26), (128, 160, 70)), ((52, 84, 30), (150, 176, 84)), ((40, 62, 26), (108, 140, 60))]
    order = sorted(range(n), key=lambda _: r.random())
    for i in order:
        x = W / 2 + r.gauss(0, 34)
        hgt = r.uniform(0.45, 0.98) * (H - 12) * (1.0 - 0.35 * abs(x - W / 2) / 120.0 if abs(x - W / 2) < 120 else 0.5)
        lean = r.gauss(0, 1) * 70 + (x - W / 2) * 0.9
        p0 = (x, H - 4)
        p1 = (x + lean * 0.25, H - 4 - hgt * 0.55)
        p2 = (x + lean, H - 4 - hgt)
        wd = r.uniform(9, 17)
        c0, c1 = r.choice(cols)
        c0, c1 = jit(c0, r, 10), jit(c1, r, 10)
        m = 14
        left, right = [], []
        prev = None
        seg = []
        for k in range(m + 1):
            t = k / m
            pt = bez(p0, p1, p2, t)
            seg.append(pt)
        for k in range(m):
            t = k / m
            w = wd * (1 - t) ** 0.85 * 0.5 + 0.4
            dx, dy = seg[k + 1][0] - seg[k][0], seg[k + 1][1] - seg[k][1]
            dl = math.hypot(dx, dy) or 1
            nx, ny = -dy / dl, dx / dl
            quad = [(seg[k][0] - nx * w, seg[k][1] - ny * w), (seg[k][0] + nx * w, seg[k][1] + ny * w)]
            w2 = wd * (1 - (k + 1) / m) ** 0.85 * 0.5 + 0.3
            quad += [(seg[k + 1][0] + nx * w2, seg[k + 1][1] + ny * w2), (seg[k + 1][0] - nx * w2, seg[k + 1][1] - ny * w2)]
            col = tuple(int(v) for v in lerp(c0, c1, ((k + 0.5) / m) ** 0.8))
            poly(d, quad, col)
    return im


def stalks(kind, seed):
    """a few tall thin seed stalks with seed heads"""
    r = random.Random(seed)
    W = H = 512
    im = canvas(W, H)
    d = ImageDraw.Draw(im)
    if kind == "dry":
        c0, c1, head = (128, 106, 64), (196, 172, 112), (176, 148, 88)
    else:
        c0, c1, head = (58, 84, 34), (116, 142, 66), (128, 132, 70)
    for i in range(9):
        x = W / 2 + r.gauss(0, 46)
        hgt = r.uniform(0.62, 0.98) * (H - 10)
        lean = r.gauss(0, 34) + (x - W / 2) * 0.6
        p0, p1, p2 = (x, H - 4), (x + lean * 0.2, H - 4 - hgt * 0.6), (x + lean, H - 4 - hgt)
        pts = [bez(p0, p1, p2, t / 16.0) for t in range(17)]
        for k in range(16):
            line(d, pts[k], pts[k + 1], tuple(int(v) for v in lerp(c0, c1, k / 16.0)), 3.2 - 1.6 * k / 16)
        tip = pts[-1]
        dx, dy = pts[-1][0] - pts[-3][0], pts[-1][1] - pts[-3][1]
        a = math.atan2(dy, dx)
        L = r.uniform(46, 72)
        ellipse_leaf(d, (tip[0] + math.cos(a) * L * 0.5, tip[1] + math.sin(a) * L * 0.5), a, L, 11, jit(head, r, 10))
        for q in range(9):
            aa = a + math.radians(r.uniform(-40, 40))
            f0 = r.uniform(0.2, 0.9)
            line(d, (tip[0] + math.cos(a) * L * f0, tip[1] + math.sin(a) * L * f0), (tip[0] + math.cos(aa) * (L + 12), tip[1] + math.sin(aa) * (L + 12)), jit(head, r, 10), 1.0)
        for q in range(3):
            bx = x + r.uniform(-14, 14)
            bt = (bx + r.gauss(0, 40), H - 4 - r.uniform(80, 170))
            line(d, (bx, H - 4), bt, jit(lerp(c0, c1, 0.4), r, 8), 4.0)
    return im


def palm_frond(seed, dry=False):
    dry_tip = (128, 106, 54)
    r = random.Random(seed)
    W, H = 512, 512
    im = canvas(W, H)
    d = ImageDraw.Draw(im)
    x0 = W / 2
    rib = [(x0 + 30 * math.sin(t * 1.2) * t, H - 4 - t * (H - 20)) for t in [i / 40 for i in range(41)]]
    for i in range(40):
        line(d, rib[i], rib[i + 1], (92, 84, 44) if not dry else (96, 76, 46), 6 * (1 - i / 40) + 1.5)
    nleaf = 38
    for side in (-1, 1):
        for i in range(nleaf):
            t = 0.05 + 0.93 * i / (nleaf - 1)
            k = min(39, int(t * 40))
            p = rib[k]
            Lmax = 236 * (math.sin(math.pi * (t ** 0.8)) * 0.75 + 0.25 * (1 - t)) + 14
            ang = math.radians(58 - 20 * t + r.uniform(-4, 4))
            droop = 0.34 * Lmax
            m = 8
            w0 = 13 * (1 - 0.5 * t)
            top, bot = [], []
            for q in range(m + 1):
                u = q / m
                px = p[0] + side * math.sin(ang) * Lmax * u
                py = p[1] - math.cos(ang) * Lmax * u * 0.7 + droop * u * u
                top.append((px, py))
            # tapered leaflet polygon
            poly_pts = []
            for q in range(m + 1):
                u = q / m
                w = w0 * (1 - u) ** 0.7 * 0.5 + 0.3
                poly_pts.append((top[q][0], top[q][1] - w))
            for q in range(m, -1, -1):
                u = q / m
                w = w0 * (1 - u) ** 0.7 * 0.5 + 0.3
                poly_pts.append((top[q][0], top[q][1] + w))
            green = lerp((40, 72, 30), (98, 122, 52), 0.25 + 0.75 * r.random() * (1 - t * 0.4))
            col = jit(lerp(green, dry_tip, 0.10 + 0.15 * t), r, 8)
            if dry:
                col = jit(lerp((112, 88, 52), (150, 124, 78), r.random()), r, 8)
            poly(d, poly_pts, col)
            line(d, top[0], top[m // 2], (jit((70, 96, 44), r, 6)), 1.5)
    return im


def fern_frond(seed):
    """narrow pinnate frond (use on a card ~0.4x as wide as it is long): rachis up the centre, pinnae with gaps, small pinnule notches"""
    r = random.Random(seed)
    W = H = 512
    im = canvas(W, H)
    d = ImageDraw.Draw(im)
    x0 = W / 2
    N = 60
    rib = [(x0 + 22 * math.sin((i / N) * 2.2) * (i / N), H - 4 - (i / N) * (H - 20)) for i in range(N + 1)]
    for i in range(N):
        line(d, rib[i], rib[i + 1], (62, 84, 40), 5.5 * (1 - i / N) + 1.6)
    npair = 26
    for side in (-1, 1):
        for i in range(npair):
            t = 0.05 + 0.90 * i / (npair - 1)
            k = min(N - 1, int(t * N))
            p = rib[k]
            Lp = 118 * (math.sin(math.pi * min(1, t ** 0.75)) * 0.92 + 0.08 * (1 - t)) + 10
            ang = math.radians(74 - 22 * t + r.uniform(-3, 3))      # angle from the rachis direction
            droop = 0.10 * Lp
            m = 8
            pts = [(p[0] + side * math.sin(ang) * Lp * (q / m), p[1] - math.cos(ang) * Lp * (q / m) * 0.55 + droop * (q / m) ** 2) for q in range(m + 1)]
            line(d, pts[0], pts[m], (74, 100, 46), 2.4)
            for q in range(1, m + 1):
                u = q / m
                pl = 22 * (1 - u * 0.8) + 5
                g = lerp((44, 78, 38), (100, 140, 62), r.random() * (0.4 + 0.6 * u))
                for sgn in (-1, 1):
                    dxx, dyy = pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]
                    a = math.atan2(dyy, dxx) + sgn * math.radians(64)
                    c = (pts[q][0] + math.cos(a) * pl * 0.5, pts[q][1] + math.sin(a) * pl * 0.5)
                    ellipse_leaf(d, c, a, pl, 8.5 * (1 - 0.3 * u) + 2, jit(g, r, 6))
                ellipse_leaf(d, pts[m], math.atan2(pts[m][1] - pts[m - 1][1], pts[m][0] - pts[m - 1][0]), 16, 7, jit(g, r, 6))
    return im


def leafy(kind, seed):
    """scrub / green bush / dry bush leaf sprays: woody stems fanning up with leaves"""
    r = random.Random(seed)
    W = H = 512
    im = canvas(W, H)
    d = ImageDraw.Draw(im)
    if kind == "scrub":
        leafcols = [(112, 114, 82), (138, 136, 100), (158, 152, 112), (96, 98, 70)]
        stem_col, leaf_len, leaf_w, nst, per = (86, 72, 56), 44, 12, 9, 26
    elif kind == "green":
        leafcols = [(34, 54, 28), (46, 70, 34), (64, 88, 42), (30, 48, 26)]
        stem_col, leaf_len, leaf_w, nst, per = (60, 48, 34), 34, 16, 11, 34
    else:  # dry
        leafcols = [(140, 118, 78), (164, 142, 98), (112, 92, 62), (178, 156, 110)]
        stem_col, leaf_len, leaf_w, nst, per = (96, 78, 56), 40, 14, 11, 9
    x0, y0 = W / 2, H - 6
    for si in range(nst):
        spread = (si / (nst - 1) - 0.5) * 2
        ang = math.radians(90 + spread * 46 + r.uniform(-8, 8))
        Lst = (H - 40) * r.uniform(0.62, 0.98) * (1 - 0.32 * abs(spread))
        p0 = (x0 + r.uniform(-16, 16), y0)
        p2 = (p0[0] + math.cos(ang) * Lst * 0.75, p0[1] - math.sin(ang) * Lst)
        p1 = (p0[0] + (p2[0] - p0[0]) * 0.15, p0[1] - Lst * 0.55)
        pts = [bez(p0, p1, p2, i / 16) for i in range(17)]
        for i in range(16):
            line(d, pts[i], pts[i + 1], stem_col, (6.0 if kind == 'dry' else 4.5) * (1 - i / 16) + 1.4)
        # side twigs with leaves
        for k in range(per):
            t = 0.22 + 0.78 * k / per
            i0 = min(15, int(t * 16))
            p = lerp(pts[i0], pts[i0 + 1], t * 16 - i0)
            dx, dy = pts[i0 + 1][0] - pts[i0][0], pts[i0 + 1][1] - pts[i0][1]
            base_a = math.atan2(dy, dx)
            for sgn in (-1, 1):
                a = base_a + sgn * math.radians(r.uniform(35, 70))
                ln = leaf_len * r.uniform(0.7, 1.2) * (0.6 + 0.4 * t) * (1.0 if kind != "dry" else 1.3)
                e = (p[0] + math.cos(a) * ln * 0.9, p[1] + math.sin(a) * ln * 0.9)
                if kind == "dry":
                    line(d, p, e, stem_col, 3.2)
                    if r.random() < 0.45:
                        ellipse_leaf(d, e, a, leaf_len * 0.7, leaf_w * 0.8, jit(r.choice(leafcols), r, 8))
                elif kind == "scrub":
                    for q in range(3):
                        aa = a + math.radians(r.uniform(-20, 20))
                        cc = (p[0] + math.cos(aa) * ln * (0.35 + 0.3 * q), p[1] + math.sin(aa) * ln * (0.35 + 0.3 * q))
                        ellipse_leaf(d, cc, aa, leaf_len * r.uniform(0.8, 1.2), leaf_w, jit(r.choice(leafcols), r, 8))
                else:
                    c = (p[0] + math.cos(a) * ln * 0.55, p[1] + math.sin(a) * ln * 0.55)
                    ellipse_leaf(d, c, a, ln, leaf_w * r.uniform(0.85, 1.15), jit(r.choice(leafcols), r, 8), veins=jit((50, 74, 40), r, 4))
            # terminal leaf
        e = pts[-1]
        ellipse_leaf(d, e, math.atan2(pts[-1][1] - pts[-2][1], pts[-1][0] - pts[-2][0]), leaf_len, leaf_w, jit(r.choice(leafcols), r, 8))
    return im


# ----------------------------------------------------------------------------------------------------- seamless skins
def tile_noise(n, seed, beta=2.0):
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(n) * n
    fx, fy = np.meshgrid(f, f)
    rr = np.sqrt(fx * fx + fy * fy); rr[0, 0] = 1
    amp = rr ** (-beta / 2); amp[0, 0] = 0
    a = np.real(np.fft.ifft2(amp * np.exp(1j * rng.uniform(0, 2 * np.pi, (n, n)))))
    a -= a.mean(); a /= a.std() + 1e-9
    return a.astype(np.float32)


def cactus_skin(kind, seed, size=512):
    """kind 'rib': ONE rib per tile width (u=0/1 is the rib crest, u=0.5 the groove) so the model maps u = rib_index -> spines sit exactly on the crests.
       kind 'pad': seamless prickly-pear pad skin with staggered areoles."""
    n = size
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    lo = tile_noise(n, seed, 3.0); mid = tile_noise(n, seed + 1, 1.8); hi = tile_noise(n, seed + 2, 0.8)
    if kind == "rib":
        crest = 0.5 + 0.5 * np.cos(2 * np.pi * xx)                     # 1 at crest, 0 in the groove
        base = np.array([96, 112, 80], np.float32); light = np.array([126, 138, 100], np.float32); dark = np.array([60, 76, 52], np.float32)
        t = np.clip(0.42 + 0.26 * (crest - 0.5) + 0.10 * lo + 0.05 * mid + 0.03 * hi, 0, 1)
    else:
        base = np.array([94, 112, 88], np.float32); light = np.array([126, 140, 116], np.float32); dark = np.array([62, 80, 62], np.float32)
        t = np.clip(0.5 + 0.13 * lo + 0.08 * mid + 0.03 * hi, 0, 1)
    col = np.where(t[..., None] < 0.5, dark + (base - dark) * (t[..., None] * 2), base + (light - base) * ((t[..., None] - 0.5) * 2))
    col += np.array([4, 3, 0], np.float32) * mid[..., None]
    if kind == "pad":                       # waxy blue-grey bloom, patchy
        bl = np.clip(0.5 + 0.55 * tile_noise(n, seed + 7, 2.4), 0, 1)[..., None] * 0.42
        col = col * (1 - bl) + np.array([118, 136, 132], np.float32) * bl
    else:                                   # older darker / scarred patches
        sc = np.clip((tile_noise(n, seed + 9, 2.0) - 0.9) * 1.6, 0, 1)[..., None] * 0.5
        col = col * (1 - sc) + np.array([88, 78, 64], np.float32) * sc
    img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    def areole(x, y, rr, nsp, ln0, ln1):
        for ox in (-n, 0, n):
            for oy in (-n, 0, n):
                xx_, yy_ = x + ox, y + oy
                if -20 < xx_ < n + 20 and -20 < yy_ < n + 20:
                    d.ellipse([xx_ - rr, yy_ - rr * 1.2, xx_ + rr, yy_ + rr * 1.2], fill=(150, 138, 104))
                    for q in range(nsp):
                        a = rng.uniform(0, 2 * math.pi)
                        ln = rng.uniform(ln0, ln1)
                        d.line([xx_, yy_, xx_ + math.cos(a) * ln, yy_ + math.sin(a) * ln * 1.3], fill=(206, 196, 160), width=1)
    if kind == "rib":
        rows = 22
        for j in range(rows):
            y = (j + 0.5) / rows * n + rng.uniform(-2, 2)
            areole(0 + rng.uniform(-1.5, 1.5), y, 3.6, 9, 6, 13)
    else:
        cols_n, rows_n = 8, 8
        for j in range(rows_n):
            for i in range(cols_n):
                cx = (i + (0.5 if j % 2 else 0.0)) / cols_n * n + rng.uniform(-3, 3)
                cy = (j + 0.5) / rows_n * n + rng.uniform(-3, 3)
                areole(cx, cy, 2.4, 7, 4, 9)
    return img


def tile_normal(a):
    return a


# ----------------------------------------------------------------------------------------------------- billboards
def load_card(name):
    return Image.open(os.path.join(PTEX, name + ".png")).convert("RGBA")


def pine_billboard(kind, seed):
    r = random.Random(seed)
    W, H = 256, 512
    sprig = load_card("card_pine_" + kind)
    im = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    trunk_top = 0.16
    # trunk
    d = ImageDraw.Draw(im)
    tx = W / 2
    d.polygon([((tx - 5) * SS, H * SS), ((tx + 5) * SS, H * SS), ((tx + 2) * SS, H * 0.2 * SS), ((tx - 2) * SS, H * 0.2 * SS)], fill=(70, 52, 38, 255))
    if kind == "a":
        crown_lo, crown_hi, rmax, n_h, ang0 = 0.20, 0.97, 0.47, 34, 22
    elif kind == "b":
        crown_lo, crown_hi, rmax, n_h, ang0 = 0.34, 0.97, 0.50, 26, 12
    else:
        crown_lo, crown_hi, rmax, n_h, ang0 = 0.13, 0.98, 0.42, 32, 26
    items = []
    for i in range(n_h):
        t = i / (n_h - 1)                       # 0 bottom of the crown .. 1 top
        y = H * (1 - (crown_lo + (crown_hi - crown_lo) * t))
        if kind == "b":
            reach = rmax * W * (0.55 + 0.45 * math.sin(t * 3.0)) * (1 - 0.55 * t)
        else:
            reach = rmax * W * (1 - t) ** 0.85 * 0.98 + 10
        for side in (-1, 1):
            for k in range(2):
                L = reach * r.uniform(0.75, 1.05) * (1.0 if k == 0 else 0.6)
                items.append((y + r.uniform(-6, 6), side, max(L, 22), t, k))
    items.sort(key=lambda a: -a[3])
    for (y, side, L, t, k) in items:
        sc = L / (sprig.size[1] * 0.5) * SS * 1.15 / 1.0
        sp = sprig.resize((max(2, int(sprig.size[0] * sc * 0.55)), max(2, int(sprig.size[1] * sc * 0.55))), Image.LANCZOS)
        # rotate so the stem points sideways (+-90deg) and slightly down
        droop = ang0 - 10 * t + r.uniform(-6, 6)
        rot = -side * (90 - droop)
        sp = sp.rotate(rot, expand=True, resample=Image.BICUBIC)
        # shade: darker low/inner, lighter on the right (sun side) and at the tips
        arr = np.asarray(sp, dtype=np.float32)
        h_, w_ = arr.shape[:2]
        xs = np.linspace(-1, 1, w_)[None, :, None]
        shade = 0.72 + 0.20 * t + 0.12 * (xs * (1 if True else 1)) * 0.5 + 0.10 * np.abs(xs)
        arr[..., :3] = np.clip(arr[..., :3] * shade, 0, 255)
        sp = Image.fromarray(arr.astype(np.uint8), "RGBA")
        ax = tx * SS + side * L * 0.5 * SS * 0.98
        ay = y * SS
        im.alpha_composite(sp, (int(ax - sp.size[0] / 2), int(ay - sp.size[1] / 2)))
    # top spire
    return im


# ----------------------------------------------------------------------------------------------------- driver
def build(names):
    def want(n):
        return not names or n in names
    S = (512, 512)
    for k, seed in (("a", 11), ("b", 22), ("c", 33)):
        if want("card_pine_" + k):
            finish_rgba(conifer_sprig(k, seed), os.path.join(PTEX, "card_pine_%s.png" % k), S, boost=2.4)
    if want("card_grass_dry"):
        finish_rgba(blades("dry", 5), os.path.join(PTEX, "card_grass_dry.png"), S)
    if want("card_grass_green"):
        finish_rgba(blades("green", 6), os.path.join(PTEX, "card_grass_green.png"), S)
    if want("card_palm_frond"):
        finish_rgba(palm_frond(7), os.path.join(PTEX, "card_palm_frond.png"), S)
    if want("card_palm_frond_dry"):
        finish_rgba(palm_frond(9, dry=True), os.path.join(PTEX, "card_palm_frond_dry.png"), S)
    if want("card_grass_stalks_dry"):
        finish_rgba(stalks("dry", 21), os.path.join(PTEX, "card_grass_stalks_dry.png"), S, boost=1.8)
    if want("card_grass_stalks_green"):
        finish_rgba(stalks("green", 22), os.path.join(PTEX, "card_grass_stalks_green.png"), S, boost=1.8)
    if want("card_fern"):
        finish_rgba(fern_frond(8), os.path.join(PTEX, "card_fern.png"), S)
    for k, seed in (("scrub", 41), ("green", 42), ("dry", 43)):
        if want("card_bush_" + k):
            finish_rgba(leafy(k, seed), os.path.join(PTEX, "card_bush_%s.png" % k), S)
    if want("cactus_skin"):
        cactus_skin("rib", 3).save(os.path.join(PTEX, "cactus_skin_albedo.jpg"), quality=88)
    if want("cactus_pear_skin"):
        cactus_skin("pad", 4).save(os.path.join(PTEX, "cactus_pear_skin_albedo.jpg"), quality=88)


if __name__ == "__main__":
    build(sys.argv[1:])

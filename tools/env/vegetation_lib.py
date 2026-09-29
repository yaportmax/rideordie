"""Blender-side helpers for the vegetation props (import after envlib).  Everything is deterministic per seed."""
import math
import random
import os
import sys

import bpy
import bmesh
from mathutils import Vector, Matrix, noise as mnoise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from envlib import *                      # noqa: F401,F403,E402
from envlib import _frame                 # noqa: E402

Z = Vector((0, 0, 1))


def rot_about(v, axis, ang):
    return Matrix.Rotation(ang, 3, axis) @ v


def sweep(mb, m, pts, radii, seg=8, tile_m=1.0, u_repeat=None, rib=0.0, cap_end=True, cap_start=False, rib_profile=None):
    """Sweep a circle along a polyline with UVs (u around, v along; v in metres/tile_m, u scaled so texel density is constant).
       rib > 0 : alternate crest/groove radii (seg must be even; crest at even j).  u_repeat = number of u tiles around (ribbed cacti: one per rib).
       radii: float or list per point.  Returns [ring verts]."""
    bm = mb.bm(m)
    uvl = bm.loops.layers.uv.verify()
    pts = [Vector(p) for p in pts]
    n = len(pts)
    if not isinstance(radii, (list, tuple)):
        radii = [radii] * n
    rows = []
    prev_u = None
    cum = [0.0]
    for i in range(1, n):
        cum.append(cum[-1] + (pts[i] - pts[i - 1]).length)
    for i, p in enumerate(pts):
        d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        if d.length < 1e-6:
            d = Vector((0, 0, 1))
        u, v, w = _frame(d)
        if prev_u is not None:
            u2 = prev_u - w * prev_u.dot(w)
            if u2.length > 1e-6:
                u = u2.normalized()
                v = w.cross(u).normalized()
        prev_u = u
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            r = radii[i]
            if rib > 0:
                r *= 1.0 + rib * (1.0 if j % 2 == 0 else -1.0)
            ring.append(bm.verts.new(p + (u * math.cos(a) + v * math.sin(a)) * r))
        rows.append(ring)
    for i in range(n - 1):
        for j in range(seg):
            f = bm.faces.new((rows[i][j], rows[i][(j + 1) % seg], rows[i + 1][(j + 1) % seg], rows[i + 1][j]))
            for lp, (jj, ii) in zip(f.loops, ((j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1))):
                circ = (u_repeat if u_repeat else 2 * math.pi * max(radii[ii], 0.005) / tile_m)
                lp[uvl].uv = (jj / seg * circ, cum[ii] / tile_m)
    def cap(ring, flip, ii):
        try:
            f = bm.faces.new(list(reversed(ring)) if flip else ring)
        except ValueError:
            return
        for lp in f.loops:
            lp[uvl].uv = (0.0, cum[ii] / tile_m)
    if cap_start and radii[0] > 0:
        cap(rows[0], True, 0)
    if cap_end and radii[-1] > 0:
        cap(rows[-1], False, n - 1)
    return rows


def card3d(mb, m, base, d, length, width, roll=0.0, bend=(0, 0, 0), seg=2, uv=(0, 0, 1, 1), fold=0.0, width_taper=1.0, flipv=False):
    """Flat foliage card (double-sided material expected).  Starts at `base`, runs along unit vector d for `length`; texture v runs base->tip
       (u across, bottom centre of the texture = base).  side axis = horizontal perpendicular to d rotated by `roll` degrees about d.
       bend = (x,y,z) displacement of the tip (quadratic).  fold = V-fold in degrees (centre rib raised).  width_taper scales the width at the tip."""
    bm = mb.bm(m)
    uvl = bm.loops.layers.uv.verify()
    d = Vector(d).normalized()
    s = d.cross(Z)
    if s.length < 1e-4:
        s = Vector((1, 0, 0))
    s.normalize()
    if roll:
        s = rot_about(s, d, roll * D2R)
    nrm = s.cross(d).normalized()
    if nrm.z < 0:
        nrm = -nrm
    fr = fold * D2R
    u0, v0, u1, v1 = uv
    rows = []
    for i in range(seg + 1):
        t = i / seg
        c = Vector(base) + d * length * t + Vector(bend) * (t * t)
        w = width * 0.5 * (1.0 + (width_taper - 1.0) * t)
        if fold > 0:
            l = c - s * w * math.cos(fr) - nrm * w * math.sin(fr)
            ce = c
            r_ = c + s * w * math.cos(fr) - nrm * w * math.sin(fr)
            rows.append((bm.verts.new(l), bm.verts.new(ce), bm.verts.new(r_), t))
        else:
            rows.append((bm.verts.new(c - s * w), None, bm.verts.new(c + s * w), t))
    for i in range(seg):
        a, b = rows[i], rows[i + 1]
        vt0 = v0 + (v1 - v0) * (1 - a[3] if flipv else a[3])
        vt1 = v0 + (v1 - v0) * (1 - b[3] if flipv else b[3])
        um = (u0 + u1) / 2
        quads = []
        if fold > 0:
            quads.append(((a[0], a[1], b[1], b[0]), ((u0, vt0), (um, vt0), (um, vt1), (u0, vt1))))
            quads.append(((a[1], a[2], b[2], b[1]), ((um, vt0), (u1, vt0), (u1, vt1), (um, vt1))))
        else:
            quads.append(((a[0], a[2], b[2], b[0]), ((u0, vt0), (u1, vt0), (u1, vt1), (u0, vt1))))
        for verts, uvs in quads:
            try:
                f = bm.faces.new(verts)
            except ValueError:
                continue
            for lp, t in zip(f.loops, uvs):
                lp[uvl].uv = t


def polar(az_deg, elev_deg):
    a, e = az_deg * D2R, elev_deg * D2R
    return Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a + 1e-9)))
    return t * t * (3 - 2 * t)


def foliage_vcol(objs, height, radius, center=(0, 0), low=0.5, tint=(1, 1, 1), noise_amp=0.10, seed=1, top_warm=0.05, base_fade=0.0):
    """baked-looking foliage shading in COLOR_0: darker deep inside the crown / low down, lighter at the outer tips / top, low-freq variation."""
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for o in objs:
        me = o.data
        if "Col" in me.color_attributes:
            me.color_attributes.remove(me.color_attributes["Col"])
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for i, v in enumerate(me.vertices):
            p = o.matrix_world @ v.co
            rr = math.hypot(p.x - center[0], p.y - center[1]) / max(radius, 1e-3)
            hh = p.z / max(height, 1e-3)
            s = low + (1 - low) * smoothstep(0.0, 1.0, rr * 0.85 + hh * 0.30)
            s *= 1.0 + noise_amp * mnoise.noise(p * 0.9 + off)
            if base_fade > 0:
                s *= 1.0 - base_fade * max(0.0, 1.0 - p.z / 0.5)
            s = max(0.12, min(1.15, s))
            ca.data[i].color = (min(1.0, s * tint[0] * (1 + top_warm * hh)), min(1.0, s * tint[1] * (1 + top_warm * 0.5 * hh)), min(1.0, s * tint[2]), 1.0)
        me.color_attributes.active_color = ca


def wobble_path(p0, p1, n, amp, seed, freq=1.3, up_bias=0.0):
    """polyline from p0 to p1 with smooth lateral wobble (deterministic)"""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    u, v, w = _frame(d)
    off = Vector((seed * 7.13, seed * 3.71, seed * 1.93))
    pts = []
    for i in range(n):
        t = i / (n - 1)
        q = p0 + d * t
        e = math.sin(t * math.pi)
        q += u * mnoise.noise(Vector((t * freq, 0.0, 0.0)) + off) * amp * e
        q += v * mnoise.noise(Vector((0.0, t * freq, 3.7)) + off) * amp * e
        q.z += up_bias * t * t
        pts.append(q)
    return pts

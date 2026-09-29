"""Local workaround (revolver/shotgun): bmesh bevel of booleaned shells can leave thousands of zero-area faces, which make
Blender's UV `average_islands_scale` explode (atlas ends up 1% used).  Importing this module wraps gunlib.bevel_bm / bool_op so every
shell is cleaned (merge near-doubles, drop collapsed faces) right after it is produced."""
import bmesh
import gunlib

_orig_bevel = gunlib.bevel_bm
_orig_bool = gunlib.bool_op


def clean(bm, dist=2e-3, min_area=1e-5):
    try:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
        bad = [f for f in bm.faces if f.calc_area() < min_area]
        if bad:
            bmesh.ops.delete(bm, geom=bad, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
    except Exception as ex:      # pragma: no cover
        print("WARN clean failed", ex)
    return bm


def bevel_clean(bm, width, segs=2, angle=30.0, sel=None):
    r = _orig_bevel(bm, width, segs, angle, sel)
    return clean(bm)


def bool_clean(bm, cutters, op="DIFFERENCE", solver="EXACT"):
    r = _orig_bool(bm, cutters, op, solver)
    return clean(r, 1e-3, 1e-6)


gunlib.bevel_bm = bevel_clean
gunlib.bool_op = bool_clean

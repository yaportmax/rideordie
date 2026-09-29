"""Muscle-car only helpers (e_muscle 'Rammer')."""
from veh_lib import *
from veh_lib import _new_obj, _fix_normals


def cone_dir(name, base, direction, r, length, m, sides=6, g=None, r2=0.004):
    """Cone / spike with its base centre at `base` (x,f,z), pointing along `direction` (x,f,z)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r, radius2=r2, depth=length)
    bm.transform(Matrix.Translation((0, 0, length / 2)))
    d = Pv(direction).normalized()
    q = Vector((0, 0, 1)).rotation_difference(d)
    bm.transform(Matrix.Translation(Pv(base)) @ q.to_matrix().to_4x4())
    _fix_normals(bm)
    o = _new_obj(name, bm, m)
    return reg(o, g)


def set_faces_material(o, mat_name, pred):
    """Give faces of o (that satisfy pred(center Vector, normal Vector)) a different material (adds a slot when needed)."""
    m = rod_lib._MATS.get(mat_name) or mat(mat_name)
    idx = None
    for i, s in enumerate(o.material_slots):
        if s.material == m:
            idx = i
    if idx is None:
        o.data.materials.append(m)
        idx = len(o.data.materials) - 1
    for p in o.data.polygons:
        if pred(p.center, p.normal):
            p.material_index = idx

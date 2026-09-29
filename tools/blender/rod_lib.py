"""Shared Blender helpers for RIDE OR DIE assets.  Run headless:

    "C:/Dev/tools/Blender-4.5.11-portable/blender.exe" -b --factory-startup -P tools/blender/<area>/<asset>.py -- [args]

CONVENTIONS (see docs/ASSET_SPEC.md):
  * Meters. Blender Z up. The model FRONT points toward Blender -Y  (-> +Z in glTF / Three.js after export).
  * Blender +X = the model's LEFT side (facing forward).  (-> +X in glTF).  Name sides by that: *_L = +X, *_R = -X.
  * Every mesh gets a named material (see mat()).  Game code tints/swaps materials by NAME.
  * Export with export_glb(): applies modifiers, +Y up, GLB, materials, no cameras/lights.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Matrix, Euler

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PUBLIC = os.path.join(ROOT, "public")
D2R = math.pi / 180.0


def argv():
    """Arguments after the `--` separator, as a dict ( --key value | --flag )."""
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out, i = {}, 0
    while i < len(a):
        if a[i].startswith("--"):
            k = a[i][2:]
            if i + 1 < len(a) and not a[i + 1].startswith("--"):
                out[k] = a[i + 1]; i += 2; continue
            out[k] = True
        i += 1
    return out


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    _MATS.clear()


# ------------------------------------------------------------------------------------------- materials
_MATS = {}


def mat(name, base=(0.8, 0.8, 0.8), metal=0.0, rough=0.5, emit=None, emit_strength=0.0, alpha=1.0,
        clearcoat=0.0, transmission=0.0, ior=1.45, spec=0.5, double_sided=False):
    """Principled material (cached by name).  base/emit are linear RGB(A) tuples."""
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*base[:3], 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    b.inputs["Alpha"].default_value = alpha
    b.inputs["IOR"].default_value = ior
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = clearcoat
    if "Transmission Weight" in b.inputs:
        b.inputs["Transmission Weight"].default_value = transmission
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit[:3], 1.0)
        b.inputs["Emission Strength"].default_value = emit_strength
    if alpha < 1.0:
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    m.use_backface_culling = not double_sided
    m.diffuse_color = (*base[:3], 1.0)
    _MATS[name] = m
    return m


def set_mat(obj, m):
    if isinstance(m, str):
        m = _MATS.get(m) or mat(m)
    obj.data.materials.clear()
    obj.data.materials.append(m)


# ------------------------------------------------------------------------------------------- objects
def _link(obj, parent=None):
    bpy.context.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, kind="PLAIN_AXES", size=0.1):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = kind
    o.empty_display_size = size
    o.location = loc
    o.rotation_euler = Euler([r * D2R for r in rot])  # degrees in
    return _link(o, parent)


def mesh_from(name, verts, faces, m=None, loc=(0, 0, 0), parent=None, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    o = bpy.data.objects.new(name, me)
    o.location = loc
    _link(o, parent)
    if m is not None:
        set_mat(o, m)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return o


def box(name, size, loc=(0, 0, 0), m=None, bevel=0.0, segs=2, parent=None, rot=(0, 0, 0)):
    """Axis-aligned box of `size` (x,y,z) centred at loc, optional bevel modifier applied later on export."""
    sx, sy, sz = [s / 2 for s in size]
    v = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz), (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    o = mesh_from(name, v, f, m, loc, parent)
    o.rotation_euler = Euler([r * D2R for r in rot])
    if bevel > 0:
        add_bevel(o, bevel, segs)
    return o


def cylinder(name, radius, depth, loc=(0, 0, 0), axis="X", verts=32, m=None, parent=None, bevel=0.0, radius2=None, caps=True):
    """Cylinder/cone along `axis` (X|Y|Z), centred at loc."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=verts, radius1=radius, radius2=radius if radius2 is None else radius2, depth=depth)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    o.location = loc
    if axis == "X":
        o.rotation_euler = Euler((0, 90 * D2R, 0))
    elif axis == "Y":
        o.rotation_euler = Euler((90 * D2R, 0, 0))
    _link(o, parent)
    if m is not None:
        set_mat(o, m)
    if bevel > 0:
        add_bevel(o, bevel, 2)
    return o


def add_bevel(o, width=0.01, segs=2, angle=35.0):
    md = o.modifiers.new("Bevel", "BEVEL")
    md.width = width
    md.segments = segs
    md.limit_method = "ANGLE"
    md.angle_limit = angle * D2R
    md.harden_normals = False
    return md


def add_subsurf(o, levels=2):
    md = o.modifiers.new("Subsurf", "SUBSURF")
    md.levels = levels
    md.render_levels = levels
    return md


def smooth_by_angle(o, angle=32.0):
    """Auto-smooth shading (Blender 4.1+)."""
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=angle * D2R)
    except Exception:
        for p in o.data.polygons:
            p.use_smooth = True


def apply_modifiers(o):
    bpy.context.view_layer.objects.active = o
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = o.data
    o.modifiers.clear()
    o.data = me
    bpy.data.meshes.remove(old)


def uv_smart(o, angle=66.0, margin=0.003):
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=angle * D2R, island_margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def loft(name, sections, m=None, loc=(0, 0, 0), parent=None, cap=True, smooth=False):
    """Loft closed cross-section rings along Y.  sections = [(y, [(x, z), ...]), ...] (same vertex count per ring).
    Front is -Y, so list rings from rear (large +y) to front (-y) or any order; winding is fixed automatically."""
    verts, faces = [], []
    n = len(sections[0][1])
    for y, ring in sections:
        assert len(ring) == n, "loft rings need equal vertex counts"
        for x, z in ring:
            verts.append((x, y, z))
    for i in range(len(sections) - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            c, d = (i + 1) * n + (j + 1) % n, (i + 1) * n + j
            faces.append((a, b, c, d))
    if cap:
        faces.append(tuple(range(n - 1, -1, -1)))
        faces.append(tuple((len(sections) - 1) * n + j for j in range(n)))
    o = mesh_from(name, verts, faces, m, loc, parent, smooth)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()
    return o


def join(objs, name=None):
    """Join mesh objects (keeps the first one's transform/materials list merged)."""
    bpy.context.view_layer.objects.active = objs[0]
    for x in bpy.context.selected_objects:
        x.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.ops.object.join()
    if name:
        objs[0].name = name
        objs[0].data.name = name
    return objs[0]


def mirror_x(o):
    md = o.modifiers.new("Mirror", "MIRROR")
    md.use_axis[0] = True
    md.use_clip = False
    return md


# ------------------------------------------------------------------------------------------- export
def export_glb(path, objects=None, draco=False):
    """Export `objects` (default: everything) to `path` (absolute, or relative to public/).  Modifiers applied."""
    if not os.path.isabs(path):
        path = os.path.join(PUBLIC, path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    objs = objects if objects is not None else list(bpy.context.scene.objects)
    sel = set()

    def add(o):
        sel.add(o)
        for c in o.children:
            add(c)
    for o in objs:
        add(o)
    for o in sel:
        o.select_set(True)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_materials="EXPORT", export_cameras=False, export_lights=False, export_extras=True,
              export_image_format="AUTO", export_texcoords=True, export_normals=True, export_tangents=False,
              export_animations=True, export_skins=True, export_vertex_color="ACTIVE" if hasattr(bpy.types, "Attribute") else "MATERIAL")
    if draco:
        kw.update(export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        for k in ("export_vertex_color", "export_extras"):
            kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)
    print("EXPORTED", path, "%.1f KB" % (os.path.getsize(path) / 1024))
    return path


def tri_count(objs=None):
    n = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs or bpy.context.scene.objects:
        if o.type == "MESH":
            me = o.evaluated_get(dg).to_mesh()
            me.calc_loop_triangles()
            n += len(me.loop_triangles)
            o.evaluated_get(dg).to_mesh_clear()
    return n

"""QA helper (fork: smg/rifle): re-export the finished scene lifted by dz metres so the parts below the grip origin are not hidden
by the viewer's ground plane (y=0), with a coloured marker sphere on every socket empty.
Output: public/models/weapons/_qa/<name>_lift.glb  (the _qa folder is not a deliverable)."""
import os
import bpy
import bmesh
import gunlib

COL = {"muzzle": (1, 0, 0), "eject": (1, 0.5, 0), "grip_R": (0, 1, 0), "grip_L": (0, 0.4, 1), "mag_well": (1, 1, 0), "sight": (1, 0, 1), "stock": (0, 1, 1)}


def export_lifted(name, dz=0.16, markers=True, r=0.006):
    made = []
    if markers:
        for o in list(bpy.context.scene.objects):
            if o.type == "EMPTY":
                bm = bmesh.new()
                bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=r)
                me = bpy.data.meshes.new("_mk")
                bm.to_mesh(me); bm.free()
                m = bpy.data.materials.new("mk_" + o.name)
                m.use_nodes = True
                b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
                c = COL.get(o.name, (1, 1, 1))
                b.inputs["Base Color"].default_value = (*c, 1)
                b.inputs["Emission Color"].default_value = (*c, 1)
                b.inputs["Emission Strength"].default_value = 2.0
                me.materials.append(m)
                mo = bpy.data.objects.new("mk_" + o.name, me)
                bpy.context.collection.objects.link(mo)
                mo.parent = o.parent
                mo.matrix_world = o.matrix_world
                made.append(mo)
    for o in bpy.context.scene.objects:
        if o.parent is None:
            o.location.z += dz
    path = os.path.join(gunlib.OUT_DIR, "_qa", name + "_lift.glb")
    gunlib.export_gltf(path)
    for o in bpy.context.scene.objects:
        if o.parent is None:
            o.location.z -= dz
    for mo in made:
        bpy.data.objects.remove(mo)

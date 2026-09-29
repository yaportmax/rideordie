"""RIDE OR DIE - rocket: the RPG projectile (PG-7V style HEAT round in flight, fins deployed).  Units mm, G frame.
Origin = centre of the warhead's cylindrical body (identical to the `rocket` node origin inside rpg.glb; the warhead + booster stub
geometry comes from the very same helper so the two match exactly)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpg_helpers import *
import gunfinish, gunlook

# ---- local look tweaks: paint2 = hot emissive flame colour (own style key) -----------------------------------------------
_orig_tm = gunfinish.textured_material


def _tm(name, alb, orm, nrm, k=0):
    m = _orig_tm(name, alb, orm, nrm, k)
    if name == "paint2":
        bs = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bs.inputs["Emission Color"].default_value = (1.0, 0.42, 0.06, 1.0)
        bs.inputs["Emission Strength"].default_value = 3.0
    return m


gunfinish.textured_material = _tm
_paint = gunlook.recipe_paint
gunlook.RECIPES["paint2"] = lambda c, s: _paint(c, dict(s, paint_color=s.get("paint2_color", (1.0, 0.36, 0.05)), wear=0.0, dirt=0.0))

install_military_paint()
G = Gun("rocket")
R = G.part("rocket")
warhead(R, (0.0, 0.0, 0.0))

# ---- motor section + tail boom + fin hub + nozzle (rocket-local x negative = rearward) ---------------------------------------
c0 = (0, 0, 0)
R.add(lathe_bm([(-240.0, 0.0), (-240.0, BOOST_R), (-330.0, BOOST_R), (-330.0, 0.0)], 32, "x", c0), "gun_metal", bevel=0.0)
R.add(lathe_loop([(-328.0, BOOST_R - 0.4), (-328.0, 22.2), (-338.0, 22.2), (-338.0, BOOST_R - 0.4), (-328.0, BOOST_R - 0.4)], 32, "x", c0), "gun_black", bevel=0.0)
for gx in (-262.0, -290.0):
    R.add(lathe_loop([(gx, BOOST_R - 0.5), (gx, BOOST_R + 0.9), (gx + 4.0, BOOST_R + 0.9), (gx + 4.0, BOOST_R - 0.5), (gx, BOOST_R - 0.5)], 32, "x", c0), "gun_black", bevel=0.0)
# boom (steel) narrowing to the fin hub
R.add(lathe_bm([(-330.0, 0.0), (-330.0, 16.5), (-345.0, 15.0), (-405.0, 15.0), (-405.0, 0.0)], 28, "x", c0), "gun_black", bevel=0.0)
# fin hub with six hinge lugs
R.add(lathe_bm([(-405.0, 0.0), (-405.0, 17.5), (-409.0, 18.2), (-438.0, 18.2), (-441.0, 17.0), (-441.0, 0.0)], 30, "x", c0), "gun_metal", bevel=0.0)
NF = 6
for k in range(NF):
    ang = k * 360.0 / NF + 30.0
    xf = Matrix.Rotation(math.radians(ang), 4, "X")
    # fin blade (deployed swept blade), thin plate in the x-r plane
    blade = [(-352.0, 16.0), (-438.0, 16.0), (-455.0, 60.0), (-411.0, 64.0)]
    bm = prism_bm(blade, -0.9, 0.9, fillet=[0.5, 0.5, 1.5, 1.5], fsegs=2, xf=xf)
    R.add(bm, "gun_metal", bevel=0.25)
    # folded tab at the blade tip (real PG-7 fins have wrapped tips)
    tab = box_bm((10.0, 3.4, 1.6), c=(-435.0, 0.0, 62.0), rot=(0, 0, 0), xf=xf)
    R.add(tab, "gun_metal", bevel=0.25)
    # root hinge pin
    hp = cyl_bm((-365.0, -3.0, 16.5), (-365.0, 3.0, 16.5), 2.2, segs=10)
    bmesh.ops.transform(hp, matrix=xf, verts=hp.verts)
    R.add(hp, "gun_steel", bevel=0.0)
# nozzle bell (hollow)
noz = [(-441.0, 0.0), (-441.0, 17.0), (-452.0, 17.6), (-466.0, 20.2), (-478.0, 23.2), (-482.0, 24.4), (-482.0, 21.6), (-470.0, 18.6),
       (-456.0, 15.4), (-448.0, 13.5), (-448.0, 0.0)]
R.add(lathe_bm(noz, 32, "x", c0), "gun_metal", bevel=0.0)
for k in range(7):
    a = 2 * math.pi * k / 7
    R.add(cyl_bm((-448.0, 7.5 * math.cos(a), 7.5 * math.sin(a)), (-446.0, 7.5 * math.cos(a), 7.5 * math.sin(a)), 2.2, segs=10), "gun_black", bevel=0.0)

# ---- optional flame cone (child node; emissive `paint2`) -------------------------------------------------------------------------
F = G.part("flame", pivot=(-482.0, 0, 0), parent="rocket")
outer = [(-482.0, 0.0), (-482.0, 21.0), (-498.0, 25.5), (-540.0, 24.0), (-590.0, 15.5), (-632.0, 4.5), (-646.0, 0.0)]
F.add(lathe_bm(outer, 24, "x", c0), "paint2", bevel=0.0)
core = [(-482.0, 0.0), (-482.0, 11.0), (-520.0, 12.5), (-566.0, 7.0), (-600.0, 0.0)]
F.add(lathe_bm(core, 20, "x", c0, scale=(1.0, 1.0)), "paint2", bevel=0.0)

# ---- sockets -----------------------------------------------------------------------------------------------------------
G.socket("nose", (WH_NOSE_X, 0, 0))
G.socket("tail", (-482.0, 0, 0), rot=(0, 0, 90))      # exhaust origin; local +X points rearward (direction the flame/smoke goes)
G.socket("muzzle", (-95.0, 0, 0))                     # where the tube mouth sits when loaded (matches rpg.glb `muzzle`)

G.motion("flame", "scale", (1, 0, 0), 1.0, "optional: toggle visibility / scale along its local Z (glTF) for the motor burn; origin at the nozzle exit; emissive paint2, no transparency.")
G.remark("Origin = centre of the warhead's cylindrical body (identical to the `rocket` node origin in rpg.glb). Nose tip at +246.5 mm, nozzle exit at -482 mm, optional flame cone to -646 mm. Fin span radius ~64 mm, 6 fins, deployed.")
G.remark("Body colour comes from the `paint` material (olive drab); `paint2` (flame only) is emissive orange.")
G.notes["style"] = dict(paint_color=(0.036, 0.044, 0.018), paint2_color=(1.0, 0.36, 0.05), rust=0.5, wear=1.0)
G.finish(size=1024)

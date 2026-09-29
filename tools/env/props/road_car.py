"""Road furniture: skeleton_car_frame (burnt-out rusty car shell: no glass, no tyres, open doors).  Front = Blender -Y (+Z glTF), left = +X.
   blender -b --factory-startup -P tools/env/props/road_car.py"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from envlib import *
from roadlib import *
from envlib import _frame


def circle_pts(c, normal, r, n=14, phase=0.0):
    u, v, w = _frame(normal)
    return [Vector(c) + (u * math.cos(2 * math.pi * i / n + phase) + v * math.sin(2 * math.pi * i / n + phase)) * r for i in range(n + 1)]


def skeleton_car_frame():
    new_scene(); M = std()
    R, S = M["rust"], M["soot"]
    mb = MB()
    Wf, Wr = -1.45, 1.40                       # axle y positions
    ZW = 0.34                                  # wheel centre height (before sagging)

    def tube(m, pts, r, seg=5, **k):
        return mb.tube(m, [Vector(p) for p in pts], r * 1.35, seg=seg, **k)      # chunkier members so the frame still reads at distance

    # ---- chassis ------------------------------------------------------------------------------------------------------
    for sx in (-1, 1):
        mb.box(R, (0.55 * sx, -0.05, 0.35), (0.07, 4.0, 0.10))
        # kinked front horn (bent up by the crash)
        mb.box(R, (0.55 * sx, -2.10, 0.42 + 0.03 * sx), (0.07, 0.30, 0.09), rot=(-12, 0, 0))
    for y in (-1.75, -1.05, -0.35, 0.55, 1.35, 1.95):
        mb.box(R, (0, y, 0.33), (1.18, 0.06, 0.07))
    # ---- floor pan remnants (rusted through) -------------------------------------------------------------------------
    mb.box(R, (0.42, -0.36, 0.415), (0.62, 0.66, 0.012))          # left front footwell
    mb.box(R, (-0.50, -0.30, 0.415), (0.42, 0.55, 0.012))
    mb.box(R, (0.0, -0.36, 0.47), (0.26, 0.85, 0.12))  # transmission tunnel
    mb.box(R, (-0.38, 0.70, 0.43), (0.66, 0.60, 0.012))           # rear seat pan
    mb.box(R, (0.50, 0.60, 0.43), (0.30, 0.35, 0.012))
    mb.box(R, (-0.30, 1.50, 0.40), (0.85, 0.70, 0.012))           # trunk floor
    # ---- sills ------------------------------------------------------------------------------------------------------
    for sx in (-1, 1):
        mb.box(R, (0.84 * sx, 0.10, 0.44), (0.10, 1.75, 0.09))
    # ---- pillars, roof rails, header ---------------------------------------------------------------------------------
    for sx in (-1, 1):
        tube(R, [(0.80 * sx, -0.74, 0.47), (0.77 * sx, -0.58, 0.85), (0.72 * sx, -0.42, 1.26)], 0.024)                   # A pillar
        tube(R, [(0.80 * sx, 0.90, 0.47), (0.79 * sx, 1.02, 0.86), (0.70 * sx, 1.07, 1.23)], 0.024)                      # C pillar
        tube(R, [(0.72 * sx, -0.42, 1.26), (0.68 * sx, 0.30, 1.30), (0.70 * sx, 1.07, 1.23)], 0.020)                     # roof rail
    mb.box(R, (0.0, -0.42, 1.265), (1.44, 0.05, 0.03))                                                       # windshield header
    mb.box(R, (0.0, 0.30, 1.295), (1.34, 0.035, 0.025))
    mb.box(R, (0.0, 1.07, 1.235), (1.40, 0.05, 0.03))
    mb.box(R, (-0.32, 0.70, 1.285), (0.70, 0.75, 0.010), rot=(1.5, -1.5, 0))                                              # roof remnant
    # ---- firewall / dash / column / wheel -----------------------------------------------------------------------------
    mb.box(R, (0.47, -0.72, 0.72), (0.76, 0.012, 0.56), rot=(0, 0, 0))
    mb.box(R, (-0.60, -0.72, 0.68), (0.50, 0.012, 0.46))
    mb.box(S, (0.10, -0.60, 0.985), (1.5, 0.26, 0.04))                                                         # charred dash top
    tube(R, [(-0.80, -0.62, 0.90), (0.80, -0.62, 0.90)], 0.024, cap_start=True)
    tube(R, [(0.36, -0.58, 0.90), (0.36, -0.22, 0.72)], 0.020, cap_start=True)
    tube(S, circle_pts((0.36, -0.20, 0.70), (0.0, 0.35, 0.94), 0.19, 14), 0.014, seg=5, cap_end=False)                     # steering wheel rim
    for a in (0.0, 2.1, 4.2):
        tube(S, [(0.36, -0.20, 0.70), (0.36 + 0.19 * math.cos(a), -0.20 + 0.19 * math.sin(a) * 0.35, 0.70 + 0.19 * math.sin(a) * 0.94)], 0.008, seg=4)
    # ---- seats (spring frames) -----------------------------------------------------------------------------------------
    for sx in (-1, 1):
        x = 0.40 * sx
        for dx in (-0.20, 0.20):
            tube(R, [(x + dx, -0.05, 0.50), (x + dx, 0.40, 0.50)], 0.014, seg=5, cap_start=True)
        tube(R, [(x - 0.20, 0.36, 0.52), (x - 0.22, 0.44, 1.00), (x + 0.22, 0.44, 1.00), (x + 0.20, 0.36, 0.52)], 0.016, seg=5, cap_start=True)
        mb.box(S, (x, 0.18, 0.56), (0.42, 0.44, 0.07), bevel=0.01, rot=(0, 0, 3 * sx))                                     # charred cushion
        for k in range(4):
            tube(R, [(x - 0.20, 0.0 + k * 0.1, 0.51), (x, 0.0 + k * 0.1 + 0.05, 0.56), (x + 0.20, 0.0 + k * 0.1, 0.51)], 0.005, seg=3, cap_start=True)
    # ---- engine bay ----------------------------------------------------------------------------------------------------
    mb.box(S, (0, -1.30, 0.62), (0.62, 0.64, 0.46), bevel=0.015)
    for sx in (-1, 1):
        mb.box(S, (0.25 * sx, -1.30, 0.90), (0.21, 0.52, 0.13), bevel=0.012)
        mb.cyl(R, Vector((0.25 * sx, -1.05, 1.0)), Vector((0.25 * sx, -1.05, 1.08)), 0.04, 0.04, seg=6)                    # valve cover bolts/dist
    mb.cyl(R, Vector((0, -1.63, 0.62)), Vector((0, -1.72, 0.62)), 0.11, 0.11, seg=10)
    mb.box(S, (0.0, -1.30, 1.02), (0.36, 0.30, 0.10))                                                           # intake
    mb.box(R, (0.0, -1.93, 0.62), (1.0, 0.07, 0.48))                                                           # radiator
    for sx in (-1, 1):
        mb.box(R, (0.58 * sx, -1.93, 0.66), (0.05, 0.05, 0.62))
    mb.box(R, (0.0, -1.93, 0.96), (1.20, 0.05, 0.05))
    mb.box(R, (0.0, -1.93, 0.36), (1.20, 0.05, 0.05))
    # fender arches + fender top lines
    for sx in (-1, 1):
        for (yc, tag) in ((Wf, "f"), (Wr, "r")):
            arc = [(0.86 * sx, yc + 0.46 * math.cos(math.radians(a)), ZW + 0.03 + 0.46 * math.sin(math.radians(a))) for a in range(10, 171, 20)]
            tube(R, arc, 0.020, seg=5, cap_start=True)
        tube(R, [(0.87 * sx, -0.72, 0.86), (0.86 * sx, -1.30, 0.84), (0.85 * sx, -1.95, 0.76)], 0.022, seg=5, cap_start=True)
        tube(R, [(0.86 * sx, 0.95, 0.80), (0.86 * sx, 1.55, 0.82), (0.84 * sx, 2.10, 0.66)], 0.022, seg=5, cap_start=True)
    # ---- bumpers ----------------------------------------------------------------------------------------------------
    mb.box(R, (0.05, -2.24, 0.42), (1.75, 0.10, 0.13), bevel=0.012, rot=(0, 0, 2))
    mb.box(R, (-0.86, -2.20, 0.34), (0.20, 0.10, 0.13), bevel=0.01, rot=(0, 0, 32))
    for sx in (-1, 1):
        mb.box(R, (0.5 * sx, -2.10, 0.42), (0.05, 0.25, 0.06))
    mb.box(R, (0.3, 2.16, 0.45), (1.55, 0.09, 0.13), bevel=0.012, rot=(0, 0, -7))                                            # hanging rear bumper
    mb.box(R, (-0.5, 2.05, 0.66), (0.05, 0.05, 0.42))
    # rear panel frame + tail light housings
    tube(R, [(-0.74, 1.98, 0.50), (-0.72, 2.00, 0.96), (0.74, 2.00, 0.96), (0.74, 1.98, 0.50)], 0.018, seg=5, cap_start=True)
    for sx in (-1, 1):
        mb.box(S, (0.68 * sx, 2.02, 0.80), (0.14, 0.06, 0.12))
    # ---- axles, diff, springs, driveshaft, exhaust, tank -------------------------------------------------------------------
    tube(R, [(-0.78, Wf, ZW), (0.78, Wf, ZW)], 0.035, seg=6, cap_start=True)
    tube(R, [(-0.80, Wr, ZW - 0.03), (0.80, Wr, ZW - 0.03)], 0.048, seg=8, cap_start=True)
    mb.sphere(R, (0.02, Wr, ZW - 0.03), (0.17, 0.15, 0.15), subdiv=2)
    for sx in (-1, 1):
        mb.cyl(R, Vector((0.50 * sx, Wf, ZW + 0.04)), Vector((0.50 * sx, Wf, ZW + 0.36)), 0.055, 0.055, seg=7)              # coil springs (stubs)
        tube(R, [(0.55 * sx, Wr - 0.55, ZW + 0.02), (0.55 * sx, Wr, ZW - 0.06), (0.55 * sx, Wr + 0.55, ZW + 0.02)], 0.013, seg=4, cap_start=True)
    tube(R, [(0, -0.9, 0.30), (0, Wr, 0.30)], 0.030, seg=5, cap_start=True)
    tube(S, [(0.32, -1.1, 0.22), (0.32, -0.2, 0.20), (0.32, 0.9, 0.22), (0.30, 1.15, 0.25)], 0.028, seg=5, cap_start=True)  # exhaust
    mb.cyl(S, Vector((0.30, 1.15, 0.25)), Vector((0.30, 1.75, 0.25)), 0.10, 0.10, seg=8)                                     # muffler
    tube(S, [(0.30, 1.75, 0.25), (0.30, 2.05, 0.20), (0.30, 2.25, 0.05)], 0.028, seg=6)
    mb.box(R, (-0.15, 1.55, 0.29), (0.85, 0.55, 0.22), bevel=0.012)                                                          # fuel tank
    # ---- wheel rims (no tyres) + brake drums ----------------------------------------------------------------------------
    rim_prof = [(0.0, 0.045), (0.045, 0.045), (0.05, 0.02), (0.13, 0.015), (0.16, -0.03), (0.195, -0.055), (0.195, -0.10), (0.188, -0.10), (0.16, -0.075)]
    for sx in (-1, 1):
        for yc in (Wf, Wr):
            c = (0.83 * sx, yc, ZW)
            mb.lathe(R, rim_prof, seg=10, close=False, center=c, rot=(0, 90 * sx, 0))
            for k in range(5):
                a = 2 * math.pi * k / 5
                p = Vector((c[0] + 0.05 * sx, c[1] + 0.06 * math.cos(a), c[2] + 0.06 * math.sin(a)))
                mb.cyl(S, p, p + Vector((0.025 * sx, 0, 0)), 0.014, 0.012, seg=6, caps=(False, True))
            mb.cyl(R, Vector((0.72 * sx, yc, ZW)), Vector((0.80 * sx, yc, ZW)), 0.14, 0.14, seg=10)
    # ---- open doors (hinged at the A pillar) --------------------------------------------------------------------------------
    for sx in (-1, 1):
        vs = []
        vs += mb.box(R, (0, 0.475, 0.47), (0.04, 0.95, 0.07))          # lower rail
        vs += mb.box(R, (0, 0.03, 0.75), (0.04, 0.06, 0.62))           # front stile
        vs += mb.box(R, (0, 0.92, 0.75), (0.04, 0.06, 0.62))           # rear stile
        vs += mb.box(R, (0, 0.475, 0.98), (0.04, 0.95, 0.05))          # belt line
        vs += mb.tube(R, [Vector((0, 0.03, 0.98)), Vector((0.0, 0.10, 1.20)), Vector((0.0, 0.60, 1.26)), Vector((0, 0.90, 1.10)), Vector((0, 0.92, 0.98))], 0.016, seg=5, cap_start=True)
        vs += mb.tube(R, [Vector((0, 0.06, 0.50)), Vector((0, 0.88, 0.95))], 0.014, seg=5, cap_start=True)                 # diagonal brace
        vs += mb.box(R, (0, 0.30, 0.62), (0.02, 0.36, 0.20), rot=(0, 0, 0))            # skin remnant
        vs += mb.box(S, (0.03, 0.80, 0.86), (0.05, 0.10, 0.03))           # handle
        T = Matrix.Translation((0.86 * sx, -0.66, 0.0)) @ Matrix.Rotation(math.radians(-70 * sx), 4, "Z")
        transform_verts(mb, R, vs, T)
    # ---- body skin remnants for mass / silhouette ------------------------------------------------------------------------------------
    for sx in (-1, 1):
        mb.box(R, (0.875 * sx, -1.78, 0.66), (0.014, 0.38, 0.30), rot=(0, 0, 0))
        mb.box(R, (0.875 * sx, -0.98, 0.62), (0.014, 0.30, 0.24))
        mb.box(R, (0.875 * sx, 1.62, 0.62), (0.014, 0.62, 0.36))
    mb.box(R, (0.875, 1.05, 0.66), (0.014, 0.36, 0.28))
    mb.box(R, (0.32, -0.05, 1.29), (0.62, 0.55, 0.010), rot=(2, 3, 0))
    mb.box(R, (-0.30, 0.98, 0.985), (1.0, 0.30, 0.012))
    # ---- hood (propped open, twisted, rusted through) + trunk lid hanging open ------------------------------------------------------
    vs = mb.box(R, (0.0, -0.62, 0.0), (1.50, 1.22, 0.016))
    vs += mb.box(R, (0.62, -0.62, -0.02), (0.06, 1.10, 0.04))
    vs += mb.box(R, (-0.62, -0.62, -0.02), (0.06, 1.10, 0.04))
    T = Matrix.Translation((0.0, -0.74, 0.99)) @ Matrix.Rotation(math.radians(6), 4, "Y") @ Matrix.Rotation(math.radians(-44), 4, "X")
    transform_verts(mb, R, vs, T)
    vs = mb.box(R, (0.0, 0.46, 0.0), (1.30, 0.92, 0.014))
    vs += mb.box(R, (0.58, 0.46, -0.02), (0.05, 0.85, 0.04))
    T = Matrix.Translation((0.0, 1.99, 0.97)) @ Matrix.Rotation(math.radians(-5), 4, "Y") @ Matrix.Rotation(math.radians(68), 4, "X")
    transform_verts(mb, R, vs, T)
    # ---- overall sag: nose down a little, leaning onto the left rims, sitting on the ground -------------------------------------
    lean_all_v = rot_about((0, 0, 0.3), (1.2, 1.6, 0))
    for (m, bm) in mb.bms.values():
        bmesh.ops.transform(bm, matrix=lean_all_v, verts=list(bm.verts))
    finish("skeleton_car_frame", mb, "furniture", ao=dict(samples=10, dist=0.6, strength=0.75, gradient=0.35),
           post=lambda o: grime_vc(o, 51, dirt=0.6, ground=0.5, ground_h=0.6, soot=0.55, soot_up=True),
           notes="Burnt-out rusty car shell, 4.5 m long, front toward Blender -Y (= +Z glTF): chassis rails, floor remnants, pillars + roof rails, dash/steering wheel, seat frames, "
                 "charred engine block, radiator support, wheel arches, open doors (hinged at the A pillar), bare rims on drums, exhaust/tank; no glass, no tyres.")


BUILD = dict(skeleton_car_frame=skeleton_car_frame)

if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for n in [x for x in a if x in BUILD] or list(BUILD):
        BUILD[n]()

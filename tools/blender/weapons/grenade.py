"""RIDE OR DIE - grenade: F1 'pineapple' style fragmentation grenade with pull-ring safety pin and spoon lever.
Units mm, G frame. Origin = centre of the body; the fuze points +X (= +Z in glTF, the model 'front'); the spoon runs along the +Y (gun-left) side."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpg_helpers import *

install_military_paint()
G = Gun("grenade")
BODY_R, BODY_A = 30.0, 37.0          # egg: max radius, half length
X_BOT, X_TOP = -34.0, 34.0           # truncated ends (bottom plug / fuze well)
FZ = 41.0                            # fuze body starts here
FX_END = 60.0                        # fuze head end face
PIN_X = 50.0                         # safety pin axis (along Y) crosses the fuze axis here


def egg_r(x):
    t = min(abs(x) / BODY_A, 0.999)
    return BODY_R * (1 - t ** 2.4) ** (1 / 2.4)


# ---- ribbed body: 9 rows x 12 columns of raised, rounded pillows ------------------------------------------------------------------------
rows = 9
xs = [X_BOT + (X_TOP - X_BOT) * k / rows for k in range(rows + 1)]
prof = [(X_BOT, 0.0), (X_BOT, egg_r(X_BOT) - 0.6)]
CELL = [(0.16, -0.45), (0.38, 0.55), (0.62, 0.55), (0.84, -0.45)]
for i in range(rows):
    x0, x1 = xs[i], xs[i + 1]
    if i > 0:                                   # groove line between rows
        prof.append((x0, egg_r(x0) - 2.3))
    for u, off in CELL:
        x = x0 + (x1 - x0) * u
        prof.append((x, egg_r(x) + off))
prof.append((X_TOP, egg_r(X_TOP) - 0.9))
SEGS = 44


def col_groove(k):
    return (0.925, 0.985, 1.0, 0.985)[k % 4]


body = G.part("body")
body.add(lathe_bm(prof, SEGS, "x", (0, 0, 0), mod=col_groove), "paint", bevel=0.0)
# fuze-well neck ring (cast collar) and base plug with screw slot
body.add(lathe_loop([(30.0, 13.6), (30.0, 17.0), (35.5, 17.0), (37.5, 14.4), (37.5, 12.4), (30.0, 12.4), (30.0, 13.6)], 32, "x"), "paint", bevel=0.0)
plug = lathe_bm([(-33.0, 0.0), (-33.0, 15.2), (-36.4, 14.2), (-38.6, 11.5), (-38.6, 0.0)], 30, "x")
body.add(plug, "gun_steel", bevel=0.3, cut=[box_bm((2.6, 4.0, 22.0), c=(-38.2, 0, 0), rot=(0, 0, 0))])

# ---- fuze: hex collar, body, safety-pin bore rim, head ---------------------------------------------------------------------------
body.add(lathe_bm([(36.0, 0.0), (36.0, 14.2), (42.5, 14.2), (42.5, 0.0)], 6, "x", phase=math.radians(30)), "gun_steel", bevel=0.5)
fuze = lathe_bm([(40.0, 0.0), (40.0, 10.6), (56.0, 10.6), (58.5, 9.6), (FX_END, 8.0), (FX_END, 0.0)], 32, "x")
body.add(fuze, "gun_metal", bevel=0.0, cut=[cyl_bm((PIN_X, -16, 0), (PIN_X, 16, 0), 1.9, segs=14)])
body.add(lathe_loop([(45.0, 10.2), (45.0, 11.6), (47.5, 11.6), (47.5, 10.2), (45.0, 10.2)], 32, "x"), "gun_steel", bevel=0.0)
body.add(lathe_loop([(52.5, 9.9), (52.5, 11.3), (55.0, 11.3), (55.0, 9.9), (52.5, 9.9)], 32, "x"), "gun_steel", bevel=0.0)
# hinge boss for the spoon (on the +Y side of the fuze head)
body.box((5.0, 5.0, 14.0), c=(56.0, 9.5, 0), mat="gun_steel", bevel=0.6)
body.cyl((56.0, 6.5, -8.5), (56.0, 6.5, 8.5), 1.8, segs=10, mat="gun_steel")
# safety clip: wire wrapped around the fuze neck (with straight tails)
cp = []
for k in range(0, 27):
    a = math.radians(30 + k * 12.5)
    cp.append((44.0, 12.6 * math.cos(a), 12.6 * math.sin(a)))
cp = [(44.0, 12.6, 8.0)] + cp + [(44.0, 12.4 * math.cos(math.radians(30 + 26 * 12.5)), 12.4 * math.sin(math.radians(30 + 26 * 12.5)) - 4.0)]
body.add(sweep_bm(cp, 0.75, segs=6), "gun_steel", bevel=0.0)
# stencil bands (engraved rings, painted-over look) on the top shoulder
G.notes["style"] = dict(paint_color=(0.036, 0.044, 0.018), wear=1.35, dirt=1.1)

# ---- SPOON LEVER (moving; hinge at the fuze head) ---------------------------------------------------------------------------------
HX, HY = 56.0, 10.5
lever = G.part("lever", pivot=(HX, HY, 0.0))
path = [(HX, HY + 0.5, 0), (49.0, 12.0, 0), (41.0, 15.6, 0), (34.0, 20.4, 0), (27.0, 25.0, 0), (19.0, 29.2, 0), (10.0, 32.2, 0), (0.0, 33.3, 0),
        (-10.0, 32.6, 0), (-20.0, 29.6, 0), (-28.0, 25.4, 0), (-33.0, 21.0, 0)]
LPROF = [(6.5, 0.9), (-6.5, 0.9), (-6.5, -0.9), (6.5, -0.9)]
lever.sweep(path, radius=1.0, profile=LPROF, mat="paint", bevel=0.4, smooth=4)
lever.box((2.6, 17.0, 15.0), c=(FX_END + 1.8, 2.0, 0), mat="paint", bevel=1.0)               # bent cap over the fuze head
lever.box((6.0, 3.0, 13.0), c=(HX, HY - 1.4, 0), mat="paint", bevel=0.5)                    # hinge ears
lever.add(sweep_bm([(-33.0, 21.0, 0), (-36.5, 17.6, 0)], 1.0, segs=4, profile=LPROF), "paint", bevel=0.4)
lever.box((26.0, 0.9, 1.2), c=(6.0, 33.9, 0), mat="paint", bevel=0.3)                        # stamped rib

# ---- SAFETY PIN + PULL RING (moving; origin at the pin/fuze-axis crossing) ------------------------------------------------------------
pin = G.part("pin", pivot=(PIN_X, 0.0, 0.0))
pin.cyl((PIN_X, -16.5, 0), (PIN_X, 13.5, 0), 1.45, segs=10, mat="gun_steel", bevel=0.0)
pin.cyl((PIN_X, -16.5, 0), (PIN_X, -18.5, 0), 2.6, segs=12, mat="gun_steel", bevel=0.0)
pin.add(sweep_bm([(PIN_X, 13.4, 0), (PIN_X, 15.0, -1.2), (PIN_X - 1.5, 15.6, -3.4)], 1.1, segs=6), "gun_steel", bevel=0.0)
pin.add(ring_bm((PIN_X + 0.0, -30.0, 0), (0, 0, 1), 11.5, 1.55, segs=8, tsegs=30), "gun_steel", bevel=0.0)

# ---- sockets ---------------------------------------------------------------------------------------------------------------------------
G.socket("grip_R", (0.0, 26.0, 0.0))             # right palm rests on the spoon (holds the lever down)
G.socket("throw", (8.0, 0.0, 0.0))               # release point (centre of mass)
G.socket("fuze", (FX_END, 0.0, 0.0))             # fuze top: smoke/spark emitter after the spoon flies off

G.motion("pin", "translate", (0, -1, 0), 35.0, "pull the pin out along its own axis (toward gun-right = glTF -X). Origin = pin/fuze-axis crossing. Do it just before the lever flies.")
G.motion("lever", "rotate", (0, 0, -1), 95.0, "on release the spoon swings ~95 deg outward about its hinge (glTF axis (0,-1,0) i.e. rotate -95 deg about +Y up) and can then be spawned as a flying debris piece. Origin = hinge.")
G.remark("Model front (+Z glTF) = the fuze. In hand the lever lies against the palm (grip_R is on the spoon). Body is an F1-style cast-iron 'pineapple' ~60 mm dia x 117 mm long incl. fuze.")
G.finish(size=512)

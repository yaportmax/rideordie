"""First-person arms for RIDE OR DIE: public/models/characters/fp_arms.glb  (hero gunner: fingerless leather gloves,
cloth forearm wraps, a field watch on the left wrist, paracord bracelet on the right, bare tattooed upper arms).

One file, three stages (run the driver with the numpy venv; it calls Blender for stage 2 by itself):

    C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/characters/fp_arms.py            # full build
    ... fp_arms.py --stage 2 3        # only some stages (1 = MakeHuman extraction, 2 = Blender, 3 = paint + GLB)

Stage 1 (numpy):   the hero_gunner MakeHuman body (same SPEC => the SAME skeleton as hero_gunner.glb) at FULL resolution;
                   the two arms (deltoid -> fingertips) are cut out with their quads, UVs and MakeHuman weights.
Stage 2 (Blender): Catmull-Clark subdivision, glove shells (offset skin + stitched rolled hems, padded knuckle bar, wrist
                   strap with a snap), shingled spiral cloth wraps, watch, bracelet; UV unwrap + pack (2k atlas, hands get
                   the most texels); Cycles AO bake; per-vertex region fields; weights transferred to every added piece.
Stage 3 (numpy):   per-texel painting from exact 3D fields (skin pores / knuckle creases / nails, leather grain + scuffs,
                   stitches, weave, grime), height -> normal map, ORM; skeleton with IDENTITY rest rotations (the shared
                   rig contract), sockets socket_hand_R/L (= hero_gunner's), finger pose clips pose_rifle / pose_pistol /
                   pose_launcher / pose_open, written with glb.py (WebP textures).

Contract (for src/view/viewmodel.js): bones Spine2 > Left/RightShoulder > Arm > ForeArm > Hand > Hand{Thumb..Pinky}{1..3},
identity rest rotations, character faces +Z, left = +X, metres; sockets socket_hand_R / socket_hand_L (children of the hand
bones, grip centre, +Z weapon forward / +Y up in pose_rifle); clips carry finger tracks only.
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(HERE, "_cache", "fp_arms")
SRC_NPZ = os.path.join(CACHE, "stage1.npz")
GEO_NPZ = os.path.join(CACHE, "stage2.npz")
OUT_GLB = os.path.join(ROOT, "public", "models", "characters", "fp_arms.glb")
BLENDER = "C:/Dev/tools/Blender-4.5.11-portable/blender.exe"
ATLAS = 2048

try:
    import bpy  # noqa: F401
    IN_BLENDER = True
except ImportError:
    IN_BLENDER = False

SIDES = ("Left", "Right")
FINGER_NAMES = ("Thumb", "Index", "Middle", "Ring", "Pinky")


def arm_bone_names():
    out = ["Spine2"]
    for s in SIDES:
        out += [s + "Shoulder", s + "Arm", s + "ForeArm", s + "Hand"]
        for f in FINGER_NAMES:
            out += ["%sHand%s%d" % (s, f, k) for k in (1, 2, 3)]
    return out


# =====================================================================================================================
# stage 1 : MakeHuman arms (numpy venv)
# =====================================================================================================================
def stage1():
    import numpy as np
    sys.path.insert(0, HERE)
    import body as B
    import mh
    import c_hero_gunner as HG
    t0 = time.time()
    ch = B.Char(HG.SPEC)
    names = mh.BONE_NAMES
    W = ch.W                                          # (13380, 52) normalised MakeHuman weights on the game bones
    keep = arm_bone_names()
    kidx = [names.index(n) for n in keep]
    # vertex arm-ness: weight on the arm chain below the clavicle
    chain = [names.index(n) for n in names if n.startswith(SIDES) and any(k in n for k in ("Arm", "Hand"))]
    armw = W[:, chain].sum(1)
    faces = [f for f in ch.body.faces if f[2] == "body"]
    pos_final = mh.to_final(ch.pos)
    sel = []
    for vi, ti, g in faces:
        a = armw[vi]
        if a.min() < 0.30:
            continue
        sel.append((vi, ti))
    used = sorted({v for vi, _ in sel for v in vi})
    remap = {v: i for i, v in enumerate(used)}
    quads = np.array([[remap[v] for v in vi] for vi, _ in sel], np.int32)
    quv = np.array([[ch.vt[t] for t in ti] for _, ti in sel], np.float64)          # (F, 4, 2) MakeHuman uv
    P = pos_final[used]
    # weights restricted to the FP skeleton: everything else (Spine1, Neck, ...) folds into Spine2
    Wk = W[used][:, kidx].copy()
    rest = 1.0 - Wk.sum(1)
    Wk[:, 0] += np.maximum(rest, 0.0)
    Wk /= Wk.sum(1, keepdims=True)
    heads = ch.heads_final                            # (52, 3) game space, all bones (hero_gunner skeleton)
    os.makedirs(CACHE, exist_ok=True)
    np.savez(SRC_NPZ, pos=P, quads=quads, quv=quv, weights=Wk.astype(np.float32), bones=np.array(keep),
             heads=heads, all_bones=np.array(names), parents=np.array(mh.PARENTS), scale=ch.scale)
    print("stage1: %d verts, %d quads, %.1fs" % (len(P), len(quads), time.time() - t0))


# =====================================================================================================================
# driver
# =====================================================================================================================
def run_blender(extra=()):
    cmd = [BLENDER, "-b", "--factory-startup", "-P", os.path.abspath(__file__), "--", "--stage", "2"] + list(extra)
    t0 = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf8", errors="replace")
    lines = [l for l in (p.stdout + p.stderr).splitlines() if l.startswith(("fp:", "Error", "Traceback", "  File", "    ")) or "Error" in l]
    print("\n".join(lines[-80:]))
    print("stage2 (blender): %.1fs, exit %d" % (time.time() - t0, p.returncode))
    if p.returncode != 0 or not os.path.exists(GEO_NPZ):
        raise SystemExit("blender stage failed")


def main_driver(argv):
    stages = {1, 2, 3}
    extra = []
    if "--stage" in argv:
        i = argv.index("--stage")
        stages = set()
        for a in argv[i + 1:]:
            if a.isdigit():
                stages.add(int(a))
            else:
                break
    if "--preview" in argv:
        extra.append("--preview")
    if 1 in stages:
        stage1()
    if 2 in stages:
        run_blender(extra)
    if 3 in stages:
        import fp_arms_paint
        fp_arms_paint.stage3(GEO_NPZ, SRC_NPZ, OUT_GLB, ATLAS)


if __name__ == "__main__":
    if IN_BLENDER:
        sys.path.insert(0, HERE)
        import fp_arms_blender
        fp_arms_blender.stage2(SRC_NPZ, GEO_NPZ, sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    else:
        sys.path.insert(0, HERE)
        main_driver(sys.argv[1:])

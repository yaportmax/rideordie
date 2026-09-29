"""QA harness for anim.py:  bakes test-body GLBs with the clips and renders them through tools/characters/qa.html.

    python anim_test.py poses       # stances + weapon poses contact sheets
    python anim_test.py clips       # every clip, several times each
    python anim_test.py stress      # skinning stress poses
    python anim_test.py check       # numeric checks (foot sliding, ground contact, loops, wrist bend)
    python anim_test.py rest        # IK/frame maths reproduce the rest pose (all local rotations ~ identity)
    python anim_test.py times <clip> <kind> <az> <el> <dist> <ty> <t0,t1,..>   # exact clip times, one camera
    python anim_test.py weapons|sit|stress <kind>
Run with C:/Dev/conduit/art_src/venv/Scripts/python.exe.
"""
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anim  # noqa: E402
import body as B  # noqa: E402
import mh  # noqa: E402
import rig as rigmod  # noqa: E402
from glb import Glb  # noqa: E402

ROOT = "C:/Dev/rideordie"
QA_DIR = ROOT + "/public/models/characters/_qa"
SHOTS = ROOT + "/shots/chars"
os.makedirs(QA_DIR, exist_ok=True)
os.makedirs(SHOTS, exist_ok=True)

SPECS = {
    "m": dict(macro=dict(gender=1.0, age=0.5, muscle=0.6, weight=0.35, height=0.5, race="caucasian"), height=1.82, skin="young_african_male"),
    "f": dict(macro=dict(gender=0.0, age=0.5, muscle=0.4, weight=0.7, height=0.4, race="caucasian"), height=1.62, skin="young_caucasian_female"),
}
_cache = {}


def build(kind, only=None, **kw):
    """anim.build_clips with the QA body mesh for exact ground contact."""
    ch = char(kind)
    g = Glb()
    pr = body_prims(ch, g)[0]
    return anim.build_clips(ch.heads_final, only=only, mesh=(pr["pos"], pr["joints"], pr["weights"]), foot_sole=getattr(ch, "sole", 0.0), **kw)


def char(kind="m"):
    if kind not in _cache:
        _cache[kind] = B.Char(SPECS[kind])
    return _cache[kind]


def body_prims(ch, glb):
    nrm = mh.vertex_normals(ch.pos, ch.tv)
    m = mh.split_seams(ch.pos, nrm, ch.body.vt, ch.tv, ch.tt)
    j, w = mh.top4(ch.W[m["src"]])
    tex = glb.texture_array("skin_albedo", B.skin_image(ch.spec["skin"], 1024), "jpg", 88)
    mat = glb.material("skin", base_tex=tex, rough=0.8)
    return [dict(pos=mh.to_final(m["pos"]), nrm=mh.to_final(m["nrm"]), uv=m["uv"], joints=j, weights=w, idx=m["idx"], material=mat)]


def box(center, size, rot=None):
    """Axis-aligned box (optionally rotated) -> (pos, nrm, idx)."""
    c = np.asarray(center, float)
    h = np.asarray(size, float) / 2
    P, N, I = [], [], []
    for ax in range(3):
        for sgn in (-1, 1):
            n = np.zeros(3)
            n[ax] = sgn
            u, v = np.zeros(3), np.zeros(3)
            u[(ax + 1) % 3] = 1
            v[(ax + 2) % 3] = 1
            base = len(P)
            for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                P.append(c + (n * h[ax] + u * a * h[(ax + 1) % 3] + v * b * h[(ax + 2) % 3]) if rot is None else c + rot @ (n * h[ax] + u * a * h[(ax + 1) % 3] + v * b * h[(ax + 2) % 3]))
                N.append(n if rot is None else rot @ n)
            I += [base, base + 1, base + 2, base, base + 2, base + 3] if sgn > 0 else [base, base + 2, base + 1, base, base + 3, base + 2]
    return np.array(P), np.array(N), np.array(I, np.uint32)


def torus(center, u, v, R_, r_, nu=48, nv=10):
    P, N, I = [], [], []
    for i in range(nu):
        a = 2 * np.pi * i / nu
        radial = np.cos(a) * u + np.sin(a) * v
        n3 = np.cross(u, v)
        for j in range(nv):
            b = 2 * np.pi * j / nv
            nrm = np.cos(b) * radial + np.sin(b) * n3
            P.append(np.asarray(center) + radial * R_ + nrm * r_)
            N.append(nrm)
    for i in range(nu):
        for j in range(nv):
            a, b = i * nv + j, ((i + 1) % nu) * nv + j
            c, d = ((i + 1) % nu) * nv + (j + 1) % nv, i * nv + (j + 1) % nv
            I += [a, b, c, a, c, d]
    return np.array(P), np.array(N), np.array(I, np.uint32)


def merge_meshes(parts):
    P, N, I, off = [], [], [], 0
    for p, n, i in parts:
        P.append(p)
        N.append(n)
        I.append(i + off)
        off += len(p)
    return np.concatenate(P), np.concatenate(N), np.concatenate(I)


def rifle_proxy():
    """Rifle in gun space: origin at the right hand's grip centre, +Z muzzle, +Y up."""
    return merge_meshes([box((0, 0.085, 0.03), (0.05, 0.085, 0.26)), box((0, 0.07, -0.19), (0.045, 0.09, 0.16)),
                         box((0, 0.05, -0.275), (0.05, 0.13, 0.02)), box((0, 0.055, 0.31), (0.055, 0.055, 0.34)),
                         box((0, 0.09, 0.58), (0.02, 0.02, 0.22)), box((0, -0.035, 0.0), (0.032, 0.11, 0.04)),
                         box((0, 0.0, 0.10), (0.03, 0.14, 0.05)), box((0, 0.14, 0.05), (0.02, 0.02, 0.09))])


def pistol_proxy():
    return merge_meshes([box((0, 0.045, 0.06), (0.03, 0.035, 0.22)), box((0, -0.03, -0.005), (0.03, 0.10, 0.04))])


def write_qa(name, clips, kind="m", sockets=True, gun=None, wheel=False):
    ch = char(kind)
    glb = Glb()
    prims = body_prims(ch, glb)
    heads = ch.heads_final
    sp, sr = anim.socket_frames(heads, clips) if sockets and hasattr(anim, "socket_frames") and "pose_rifle" in clips else (None, None)
    nodes, sock = rigmod.add_skeleton(glb, heads, sp, sr)
    mesh = glb.mesh("body", prims)
    skin = glb.skin(nodes, rigmod.inverse_bind(heads), nodes[0])
    mnode = glb.node("body_mesh", mesh=mesh, skin=skin)
    kids = [nodes[0], mnode]
    gm = glb.material("gun", color=(0.12, 0.12, 0.13, 1), metallic=0.6, rough=0.4)
    if gun:
        p, n, i = rifle_proxy() if gun == "rifle" else pistol_proxy()
        gmesh = glb.mesh("gun", [dict(pos=p, nrm=n, uv=np.zeros((len(p), 2)), idx=i, material=gm)])
        gnode = glb.node("gun_proxy", mesh=gmesh)
        glb.g["nodes"][sock["socket_hand_R"]].setdefault("children", []).append(gnode)
    if wheel:
        g = anim.sit_geometry(anim.Rig(heads))
        p, n, i = torus(g["wc"], g["u_w"], g["r_w"], g["rad"], 0.017)
        wmesh = glb.mesh("wheel", [dict(pos=p, nrm=n, uv=np.zeros((len(p), 2)), idx=i, material=gm)])
        kids.append(glb.node("wheel_proxy", mesh=wmesh))
    root = glb.node("qa", children=kids)
    glb.g["scenes"][0]["nodes"] = [root]
    anim.write_clips(glb, nodes, clips)
    path = "%s/anim_%s.glb" % (QA_DIR, name)
    glb.save(path)
    return "/models/characters/_qa/anim_%s.glb" % name


def shot(query, out, w=1800, h=700):
    cmd = ["node", "tools/test/shot.mjs", "tools/characters/qa.html?" + query, out, "--quiet", "--w=%d" % w, "--h=%d" % h]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if "saved" not in r.stdout:
        print(r.stdout[-800:], r.stderr[-800:])
    return out


def pose_clip(rig, p, frames=("chest", "chest"), name="pose"):
    tr = anim.Track(p)
    tr.key(0.0)
    c = anim.bake(rig, tr, 0.0, False, frames)
    return c


def render_clip(url, name, times, out, az=35, el=10, dist=4.0, ty=0.95, cols=None, w=1800, h=640, extra=""):
    ts = ",".join("%.3f" % t for t in times)
    q = "model=%s&anim=%s&times=%s&az=%s&el=%s&dist=%s&ty=%s&fov=30&cols=%d%s" % (url, name, ts, az, el, dist, ty, cols or len(times), extra)
    return shot(q, out, w, h)


def stitch(paths, out):
    from PIL import Image
    ims = [Image.open(p) for p in paths]
    W = max(i.size[0] for i in ims)
    H = sum(i.size[1] for i in ims)
    sheet = Image.new("RGB", (W, H))
    y = 0
    for i in ims:
        sheet.paste(i, (0, y))
        y += i.size[1]
    sheet.save(out)


def time_grid(c, n):
    T = float(c["times"][-1])
    return list(np.linspace(0, T, n)) if T > 0 else [0.0]


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "poses"
    if what == "poses":
        kind = sys.argv[2] if len(sys.argv) > 2 else "m"
        ch = char(kind)
        rig = anim.Rig(ch.heads_final)
        base = anim.ready_stance(rig)
        clips = {"ready": pose_clip(rig, base)}
        for kd in ("rifle", "pistol", "launcher"):
            clips["aim_" + kd] = pose_clip(rig, anim.aim_pose(rig, base, kd))
        sp, g = anim.sit_base(rig)
        clips["sit"] = pose_clip(rig, sp, ("world", "world"))
        url = write_qa("poses_" + kind, clips, kind, sockets=False)
        for cname in clips:
            for view, (az, el) in {"f": (20, 8), "s": (90, 5), "b": (200, 8), "t": (0, 60)}.items():
                pass
        for cname in clips:
            q = "model=%s&anim=%s&t=0&views=20:8,90:5,160:8,0:60&look=Spine2&dist=3.0&fov=28&cols=4&bones=0" % (url, cname)
            shot(q, "%s/anim_pose_%s_%s.png" % (SHOTS, kind, cname), 1800, 520)
        print("ok")

    elif what == "clips":
        kind = sys.argv[2] if len(sys.argv) > 2 else "m"
        only = sys.argv[3].split(",") if len(sys.argv) > 3 else None
        ch = char(kind)
        clips = build(kind)
        url_g = write_qa("clips_" + kind, clips, kind, gun="rifle")
        url_w = write_qa("sit_" + kind, clips, kind, wheel=True)
        for name, c in clips.items():
            url = url_w if "sit" in name else url_g
            if only and name not in only:
                continue
            T = c["times"][-1]
            print("%-16s T=%.2fs frames=%d loop=%s" % (name, T, len(c["times"]), c["loop"]))
            if T <= 0:
                continue
            seated = "sit" in name
            dist = 3.4 if seated else 4.2
            ty = 0.75 if seated else (0.6 if name == "death_fall" else 0.95)
            out1 = render_clip(url, name, time_grid(c, 6), "%s/anim_%s_%s_a.png" % (SHOTS, kind, name), az=35, el=10, dist=dist, ty=ty, cols=6, w=2000, h=560)
            out2 = render_clip(url, name, time_grid(c, 6), "%s/anim_%s_%s_b.png" % (SHOTS, kind, name), az=110, el=8, dist=dist, ty=ty, cols=6, w=2000, h=560)
            stitch([out1, out2], "%s/anim_%s_%s.png" % (SHOTS, kind, name))

    elif what == "check":
        kind = sys.argv[2] if len(sys.argv) > 2 else "m"
        ch = char(kind)
        heads = ch.heads_final
        clips = build(kind)
        g = Glb()
        pr = body_prims(ch, g)[0]
        pos, J, Wt = pr["pos"], pr["joints"].astype(int), pr["weights"]
        sub = np.arange(0, len(pos), 3)
        pos, J, Wt = pos[sub], J[sub], Wt[sub]
        IDX = mh.BONE_INDEX
        for name, c in clips.items():
            poses = c["_poses"]
            lows, feet, wr = [], [], []
            for (W, P) in poses:
                Mw = W[J]                                            # (V,4,3,3)
                rel = pos[:, None, :] - heads[J]                     # (V,4,3)
                out = np.einsum("vkij,vkj->vki", Mw, rel) + P[J]
                v = (out * Wt[:, :, None]).sum(axis=1)
                lows.append(v[:, 1].min())
                feet.append(np.concatenate([P[IDX["LeftFoot"]], P[IDX["RightFoot"]]]))
                for S in ("Left", "Right"):
                    fa = P[IDX[S + "Hand"]] - P[IDX[S + "ForeArm"]]
                    hd = P[IDX[S + "HandMiddle1"]] - P[IDX[S + "Hand"]]
                    wr.append(np.degrees(np.arccos(np.clip(np.dot(fa, hd) / np.linalg.norm(fa) / np.linalg.norm(hd), -1, 1))))
            lows, feet = np.array(lows), np.array(feet)
            seam = float(np.abs(c["rot"][-1] - c["rot"][0]).max()) if c["loop"] else float("nan")
            slide = float(np.abs(feet - feet[0]).max())
            print("%-15s frames=%3d lowest y: min %+.3f end %+.3f | foot travel %.3f | max wrist bend %.0f deg | loop seam %.5f" % (
                name, len(poses), lows.min(), lows[-1], slide, max(wr), seam))

    elif what == "weapons":
        kind = sys.argv[2] if len(sys.argv) > 2 else "m"
        ch = char(kind)
        clips = anim.build_clips(ch.heads_final, only=["pose_rifle", "pose_pistol", "pose_launcher"])
        for nm, gun in (("pose_rifle", "rifle"), ("pose_pistol", "pistol"), ("pose_launcher", "rifle")):
            url = write_qa("w_" + nm + "_" + kind, clips, kind, gun=gun)
            q = "model=%s&anim=%s&t=0&views=35:10,90:6,145:10,0:8&look=Spine2&dist=2.4&fov=28&cols=4&ty=1.35" % (url, nm)
            shot(q, "%s/anim_w_%s_%s.png" % (SHOTS, nm, kind), 2000, 620)
    elif what == "sit":
        kind = sys.argv[2] if len(sys.argv) > 2 else "m"
        ch = char(kind)
        clips = anim.build_clips(ch.heads_final, only=["idle_sit_drive", "sit_lean_L", "sit_lean_R"])
        url = write_qa("sit_" + kind, clips, kind, wheel=True, sockets=False)
        for nm in ("idle_sit_drive", "sit_lean_L", "sit_lean_R"):
            q = "model=%s&anim=%s&t=0.5&views=30:12,90:6,150:12,180:8,0:60&look=Spine2&dist=2.6&fov=28&cols=5&ty=1.0" % (url, nm)
            shot(q, "%s/anim_sit_%s_%s.png" % (SHOTS, nm, kind), 2000, 560)

    elif what == "stress":
        kind = sys.argv[2] if len(sys.argv) > 2 else "m"
        ch = char(kind)
        rig = anim.Rig(ch.heads_final)
        k = rig.k
        V = anim.V
        rv = anim.rv
        base = anim.ready_stance(rig)
        # plain upright standing pose (feet together-ish) as the starting point for stress tests
        st = rig.neutral()
        st["fL_pos"] = V(0.16 * k, rig.ankle_h, 0.0)
        st["fR_pos"] = V(-0.16 * k, rig.ankle_h, 0.0)
        st["hips_pos"] = V(0.0, rig.hips_y - 0.02, rig.heads[0][2])
        def arms(p, L, R, poleL=(0.6, -1, -0.3), poleR=(-0.6, -1, -0.3), fL=(0, 0, 1), fR=(0, 0, 1), pL=(-1, 0, 0), pR=(1, 0, 0)):
            p = anim.setp(p, hL_pos=np.array(L) * k, hR_pos=np.array(R) * k, hL_pole=poleL, hR_pole=poleR, hL_f=anim.unit(fL), hR_f=anim.unit(fR),
                          hL_p=anim.unit(pL), hR_p=anim.unit(pR))
            return p
        poses = {}
        poses["arms_up"] = arms(st, (0.20, 0.62, 0.05), (-0.20, 0.62, 0.05), (0.8, 0.2, -0.3), (-0.8, 0.2, -0.3), (0, 1, 0.2), (0, 1, 0.2), (-1, 0, 0.3), (1, 0, 0.3))
        poses["arms_cross"] = arms(st, (-0.14, 0.02, 0.22), (0.14, 0.02, 0.22), (0.2, -1, 0.2), (-0.2, -1, 0.2), (-1, 0, 0.3), (1, 0, 0.3), (0, 1, 0), (0, 1, 0))
        poses["elbow120"] = arms(st, (0.20, 0.16, 0.14), (-0.20, 0.16, 0.14), (0.4, -1, -0.5), (-0.4, -1, -0.5), (-0.2, 1, 0.5), (0.2, 1, 0.5), (0, 0.4, 1), (0, 0.4, 1))
        poses["arms_side"] = arms(st, (0.62, 0.12, 0.0), (-0.62, 0.12, 0.0), (0, -0.3, -1), (0, -0.3, -1), (1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, 1))
        poses["arms_fwd"] = arms(st, (0.15, 0.06, 0.60), (-0.15, 0.06, 0.60), (0.3, -1, 0), (-0.3, -1, 0), (0, 0, 1), (0, 0, 1), (-1, 0, 0), (1, 0, 0))
        poses["twist_L60"] = anim.setp(arms(st, (0.05, 0.0, 0.42), (-0.05, 0.0, 0.42), (0.2, -1, 0), (-0.2, -1, 0), (0, 0, 1), (0, 0, 1), (-1, 0, 0), (1, 0, 0)), sp0=rv(0, 15), sp1=rv(0, 20), sp2=rv(0, 25))
        poses["twist_R60"] = anim.setp(poses["twist_L60"], sp0=rv(0, -15), sp1=rv(0, -20), sp2=rv(0, -25))
        poses["bend_fwd90"] = anim.setp(arms(st, (0.2, -0.3, 0.3), (-0.2, -0.3, 0.3), (0.2, -1, 0), (-0.2, -1, 0)), hips_rot=rv(45), sp0=rv(15), sp1=rv(15), sp2=rv(15),
                                        hips_pos=V(0, rig.hips_y - 0.06, rig.heads[0][2] - 0.25 * k))
        poses["leg_kick"] = anim.setp(arms(st, (0.3, -0.2, 0.2), (-0.3, -0.2, 0.2)), fL_pos=V(0.16 * k, 0.86 * k, 0.60 * k), fL_pitch=anim.S1(-30))
        poses["leg_side"] = anim.setp(arms(st, (0.3, -0.2, 0.1), (-0.3, -0.2, 0.1)), fL_pos=V(0.72 * k, 0.72 * k, 0.05), fL_roll=anim.S1(-70), kL_pole=V(0.3, 0, 1))
        poses["head_turn"] = anim.setp(st, neck=rv(0, 35), head=rv(-10, 40))
        poses["rest_arms"] = arms(st, *(np.array(rig.hand["L"]["grip_local"]) / k + rig.heads[anim.IDX["LeftHand"]] / k * 0 for _ in range(1)), (-0.0, 0, 0)) if False else st
        clips = {n: pose_clip(rig, p, ("chest", "chest")) for n, p in poses.items()}
        url = write_qa("stress_" + kind, clips, kind, sockets=False)
        names = list(clips)
        from PIL import Image
        tiles = []
        for n in names:
            q = "model=%s&anim=%s&t=0&views=0:6,70:8&look=Spine2&dist=3.6&fov=28&cols=2&ty=1.05" % (url, n)
            tiles.append(Image.open(shot(q, "%s/anim_stress_%s_%s.png" % (SHOTS, n, kind), 700, 420)))
        cols = 3
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (700 * cols, 420 * rows))
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * 700, (i // cols) * 420))
        sheet.save("%s/anim_stress_all_%s.png" % (SHOTS, kind))
        print("ok")

    elif what == "rest":
        for kind in ("m", "f"):
            heads = char(kind).heads_final
            rig = anim.Rig(heads)
            W, P = rig.solve(rig.neutral(), frames=("world", "world"), auto_shoulder=False)
            L = rig.local_from_world(W)
            ang = [np.degrees(np.arccos(np.clip((np.trace(L[b]) - 1) / 2, -1, 1))) for b in range(anim.NB)]
            print(kind, "max local rotation at rest %.3f deg, max position error %.4f m" % (max(ang), np.abs(P - heads).max()))
    elif what == "times":
        name, kind = sys.argv[2], sys.argv[3]
        az, el, dist, ty = [float(x) for x in sys.argv[4:8]]
        times = [float(x) for x in sys.argv[8].split(",")]
        gun = sys.argv[9] if len(sys.argv) > 9 else None
        clips = build(kind, only=[name, "pose_rifle"])
        url = write_qa("v_%s_%s" % (name, kind), clips, kind, gun=gun, wheel="sit" in name)
        out = "%s/anim_t_%s_%s.png" % (SHOTS, name, kind)
        n = len(times)
        render_clip(url, name, times, out, az=az, el=el, dist=dist, ty=ty, cols=min(n, 4), w=1800, h=int(450 * ((n + 3) // 4)))
        print(out)

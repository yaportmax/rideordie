"""fp_arms: anatomical hand sockets + finger poses FITTED to real grip shapes (numpy / scipy).

Sockets (children of the hand bones, identity rest rig):
  socket_hand_R = centre of a pistol grip held in the fist: just behind the MCP knuckle line, one grip half-width into the palm,
                  axes = weapon axes (+X left, +Y up, +Z forward) for a grip raked RAKE_R degrees (bottom rearward).
  socket_hand_L = palm contact point under a handguard (C-grip): palm facing +Y (up), fingers pointing right and 25 deg forward,
                  the handguard axis along +Z, its centre HG_R above the socket.  For vertical front grips / pistol support
                  rotate it by TUNE.lRot = [0, 0, 90] (palm faces the gun's right side), which the pose fits below assume.
Finger poses are solved per clip against simple grip solids expressed in the socket frame (weapon frame, mm, G axes:
x forward, y left, z up): contact of the finger pads, no penetration, index pad on the trigger, thumb along the frame.
"""
import numpy as np
from scipy.optimize import minimize
from scipy.spatial.transform import Rotation as R

import fp_arms_rig as RIG

RAKE_R = 18.0          # grip rake assumed by socket_hand_R
HG_R = 23.0            # handguard radius assumed by socket_hand_L
FING = ("Index", "Middle", "Ring", "Pinky")


def unit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


# ------------------------------------------------------------------------------------------------ hand geometry
def hand_geo(rig, S, side):
    fr = rig.frames[side]
    d0, lat, palm = fr["d0"], fr["lat"], -fr["dorsal"]
    lat = unit(lat - d0 * np.dot(lat, d0))
    w = rig.H[side + "Hand"]
    mcp = {f: rig.H["%sHand%s1" % (side, f)] for f in FING}
    mc = np.mean([mcp["Index"], mcp["Middle"], mcp["Ring"], mcp["Pinky"]], axis=0)
    # palm skin distance from the metacarpal plane (mesh, hand-dominated verts between wrist and knuckles)
    P = np.asarray(S["pos"], float)
    bones = [str(b) for b in S["bones"]]
    Wt = np.asarray(S["weights"], float)
    hw = Wt[:, bones.index(side + "Hand")]
    rel = P - (w + mc) * 0.5
    along = (P - w) @ d0
    L = np.dot(mc - w, d0)
    across = (P - mc) @ lat
    sel = (hw > 0.6) & (along > 0.35 * L) & (along < 0.8 * L) & (np.abs(across) < 0.012)
    dist = rel[sel] @ palm
    palm_skin = float(np.percentile(dist[dist > 0], 75)) if (dist > 0).any() else 0.012
    back_skin = float(-np.percentile(dist[dist < 0], 25)) if (dist < 0).any() else 0.012
    return dict(d0=d0, lat=lat, palm=palm, wrist=w, mcp=mcp, mc=mc, palm_skin=palm_skin, back_skin=back_skin)


def socket_R(rig, S, rake=RAKE_R, half_w=15.0, back=24.0, high=18.0):
    g = hand_geo(rig, S, "Right")
    X = unit(g["palm"])                                    # the right palm faces the gun's LEFT
    u = unit(-g["lat"] - X * np.dot(-g["lat"], X))         # pinky -> index = up along the grip
    f = np.cross(X, u)
    if np.dot(f, g["d0"]) < 0:
        raise RuntimeError("right hand frame is mirrored")
    r = np.radians(rake)
    Y = np.cos(r) * u - np.sin(r) * f
    Z = np.sin(r) * u + np.cos(r) * f
    Rm = np.stack([X, Y, Z], axis=1)
    mid = (g["mcp"]["Index"] + g["mcp"]["Middle"]) * 0.5 * 0.35 + g["mcp"]["Middle"] * 0.65
    # high grip: the web of the hand rides up under the tang -> the grip centre sits `high` mm lower in the hand
    pos = mid - f * (back / 1000.0) + X * (g["palm_skin"] + 0.001 + half_w / 1000.0) - u * (high / 1000.0)
    return pos, Rm, g


def socket_L(rig, S, fwd_deg=25.0, contact=2.0):
    g = hand_geo(rig, S, "Left")
    Y = unit(g["palm"])                                    # palm up
    e1 = unit(g["d0"] - Y * np.dot(g["d0"], Y))            # fingers
    e2 = np.cross(Y, e1)
    if np.dot(e2, -g["lat"]) < 0:
        e2 = -e2
    a = np.radians(fwd_deg)
    Z = np.sin(a) * e1 + np.cos(a) * e2
    X = -np.cos(a) * e1 + np.sin(a) * e2
    if np.dot(np.cross(Y, Z), X) < 0:
        raise RuntimeError("left hand frame is mirrored")
    Rm = np.stack([X, Y, Z], axis=1)
    pos = g["mcp"]["Middle"] - e1 * 0.030 + Y * (g["palm_skin"] + contact / 1000.0)
    return pos, Rm, g


def socket_quat(Rm):
    return R.from_matrix(Rm).as_quat()


# ------------------------------------------------------------------------------------------------ grip solids (mm, G axes)
def sdf_box(p, rake, hf=22.0, hw=15.0, rc=7.0, top=42.0, bot=-60.0, cf=0.0):
    r = np.radians(rake)
    u = np.array([np.sin(r), 0.0, np.cos(r)])             # up along the grip (G: x fwd, y left, z up)
    f = np.array([np.cos(r), 0.0, -np.sin(r)])
    lf = p @ f - cf
    lw = p[..., 1]
    lu = p @ u
    qx = np.abs(lf) - (hf - rc)
    qy = np.abs(lw) - (hw - rc)
    out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - rc
    du = np.maximum(np.maximum(lu - top, bot - lu), 0)
    return np.where(du > 0, np.sqrt(np.maximum(out, 0) ** 2 + du ** 2), out)


def sdf_hcyl(p, rad=HG_R, zc=HG_R):
    """handguard: cylinder along x, centre (y 0, z zc)"""
    return np.sqrt(p[..., 1] ** 2 + (p[..., 2] - zc) ** 2) - rad


def sdf_vcyl(p, rad, yc):
    """vertical cylinder (front grip / fist), axis along z through (x 0, y yc)"""
    return np.sqrt(p[..., 0] ** 2 + (p[..., 1] - yc) ** 2) - rad


# ------------------------------------------------------------------------------------------------ finger kinematics
RAD = {"Thumb": (10.0, 9.0, 8.0), "Index": (10.0, 9.0, 7.5), "Middle": (10.5, 9.5, 7.5), "Ring": (10.0, 9.0, 7.5), "Pinky": (9.0, 8.0, 7.0)}


class Hand:
    def __init__(self, rig, side, sock_pos, sock_R):
        self.rig, self.side = rig, side
        self.sp, self.sR = sock_pos, sock_R
        self.fr = rig.frames[side]

    def to_g(self, p):
        q = (p - self.sp) @ self.sR                         # socket frame (x left, y up, z fwd), metres
        return np.stack([q[..., 2], q[..., 0], q[..., 1]], axis=-1) * 1000.0

    def finger(self, f, ang, spread=0.0, thumb=(0.0, 0.0)):
        """Posed joint positions + pad sample points (G mm) for one finger."""
        side, rig = self.side, self.rig
        pose = {side: {f: tuple(ang), "spread": spread, "thumb": thumb}}
        locs = rig.finger_locals(pose)
        J = ["%sHand%s%d" % (side, f, k) for k in (1, 2, 3)]
        Wr = np.eye(3)
        P = [rig.H[J[0]].copy()]
        rots = []
        for k in range(3):
            Wr = Wr @ locs[J[k]]
            rots.append(Wr.copy())
            nxt = rig.H[J[k + 1]] if k < 2 else rig.tips[side + f]
            P.append(P[-1] + Wr @ (nxt - rig.H[J[k]]))
        palm0 = -self.fr["dorsal"]
        if f == "Thumb":
            ax = rig.axes[(side, f)]
            dirn = unit(rig.H[J[2]] - rig.H[J[1]])
            palm0 = unit(np.cross(ax, dirn))
        pads, axes_ = [], []
        for k in range(3):
            for t in ((0.35, 0.8) if k < 2 else (0.3, 0.75)):
                a = P[k] + (P[k + 1] - P[k]) * t
                pads.append(a + rots[k] @ palm0 * RAD[f][k] / 1000.0)
                axes_.append((a, RAD[f][k]))
        return dict(P=self.to_g(np.array(P)), pads=self.to_g(np.array(pads)),
                    ax=self.to_g(np.array([a for a, _ in axes_])), rad=np.array([r for _, r in axes_]))


def fit_finger(hand, f, sdf, lo, hi, x0, target=None, tw=0.0, contact_w=1.0, spread=0.0, thumb_extra=None):
    """Fit (mcp, pip, dip) [+ (opp, abd) for the thumb] so the pads touch the solid without penetration."""
    nth = 5 if f == "Thumb" else 3

    def unpack(x):
        if f == "Thumb":
            return (x[0], x[1], x[2]), (x[3], x[4])
        return tuple(x), (0.0, 0.0)

    def cost(x):
        ang, th = unpack(x)
        g = hand.finger(f, ang, spread, th)
        dp = sdf(g["pads"])
        da = sdf(g["ax"])
        c = contact_w * np.sum(np.minimum(dp, 25.0) ** 2) * 0.02
        pen = np.maximum(g["rad"] * 0.85 - da, 0)
        c += np.sum(pen ** 2) * 2.0
        c += np.sum(np.maximum(-dp, 0) ** 2) * 1.0
        if target is not None:
            c += tw * np.sum((g["P"][-1] - np.asarray(target)) ** 2) * 0.05
        # natural coupling: dip ~ 0.6 pip
        if f != "Thumb":
            c += 0.002 * (x[2] - 0.6 * x[1]) ** 2
        return c
    # coarse grid first (the cost is non-smooth: contact / penetration switches), then refine
    best, bx = cost(np.array(x0, float)), np.array(x0, float)
    if f != "Thumb":
        for m in np.arange(lo[0], hi[0] + 1, 12.0):
            for pp in np.arange(lo[1], hi[1] + 1, 12.0):
                for dd in (0.35, 0.6, 0.85):
                    x = np.array([m, pp, min(hi[2], pp * dd)])
                    c = cost(x)
                    if c < best:
                        best, bx = c, x
    else:
        rng = np.random.default_rng(3)
        for _ in range(400):
            x = np.array([rng.uniform(l_, h_) for l_, h_ in zip(lo, hi)])
            c = cost(x)
            if c < best:
                best, bx = c, x
    res = minimize(cost, bx, method="L-BFGS-B", bounds=list(zip(lo, hi)))
    ang, th = unpack(res.x)
    return ang, th, float(res.fun)


def fit_hand(hand, spec):
    """spec: dict(solid=sdf fn, fingers=dict(f -> dict(x0, lo, hi, target?, tw?, contact_w?)), spread) -> pose dict for one side."""
    out = {"spread": spec.get("spread", 0.0)}
    for f, fs in spec["fingers"].items():
        sdf = fs.get("solid", spec["solid"])
        ang, th, c = fit_finger(hand, f, sdf, fs["lo"], fs["hi"], fs["x0"], fs.get("target"), fs.get("tw", 0.0), fs.get("contact_w", 1.0),
                                out["spread"])
        out[f] = tuple(round(float(a), 1) for a in ang)
        if f == "Thumb":
            out["thumb"] = tuple(round(float(a), 1) for a in th)
        out["_cost_" + f] = round(c, 2)
    return out


FLO, FHI = (-10, 0, 0), (95, 110, 80)
TLO, THI = (-20, -10, -10, -30, -30), (60, 70, 70, 80, 60)


def solve_poses(rig, S):
    """Fit all clips. Returns ({clip: {side: pose}}, sockets {name: (pos_model, quat)})."""
    pR, RR, gR = socket_R(rig, S)
    pL, RL, gL = socket_L(rig, S)
    Rz90 = R.from_euler("z", -90, degrees=True).as_matrix()      # game TUNE.lRot = [0, 0, +90] (socket = grip * lRot)
    handR = Hand(rig, "Right", pR, RR)
    handL = Hand(rig, "Left", pL, RL)
    handLv = Hand(rig, "Left", pL, RL @ Rz90)                 # lRot [0,0,90]: palm faces the gun's right
    fingers_R = lambda trig, thumb_t: {
        "Index": dict(x0=(35, 55, 25), lo=FLO, hi=FHI, target=trig, tw=1.0, contact_w=0.0),
        "Middle": dict(x0=(75, 90, 45), lo=FLO, hi=FHI), "Ring": dict(x0=(78, 90, 45), lo=FLO, hi=FHI),
        "Pinky": dict(x0=(80, 85, 45), lo=FLO, hi=FHI),
        "Thumb": dict(x0=(15, 25, 15, 30, 20), lo=TLO, hi=THI, target=thumb_t, tw=1.0, contact_w=0.3)}
    clips = {}
    # --- rifle class: pistol grip + handguard C-grip
    box18 = lambda p: sdf_box(p, 18.0)
    clips["pose_rifle"] = {
        "Right": fit_hand(handR, dict(solid=box18, spread=-3, fingers=fingers_R((54.0, 0.0, 30.0), (32.0, 18.0, 48.0)))),
        "Left": fit_hand(handL, dict(solid=lambda p: sdf_hcyl(p), spread=2, fingers={
            "Index": dict(x0=(45, 60, 30), lo=FLO, hi=FHI), "Middle": dict(x0=(50, 65, 32), lo=FLO, hi=FHI),
            "Ring": dict(x0=(55, 66, 34), lo=FLO, hi=FHI), "Pinky": dict(x0=(60, 68, 34), lo=FLO, hi=FHI),
            "Thumb": dict(x0=(10, 15, 10, 20, 20), lo=TLO, hi=THI, target=(40.0, 26.0, 20.0), tw=1.0, contact_w=0.3)}))}
    # --- pistol: 20 deg grip, support hand (lRot 90) wraps the right fist (vertical cylinder ~ r 34 centred 26 mm to its right)
    box20 = lambda p: sdf_box(p, 20.0, hf=23.5)
    clips["pose_pistol"] = {
        "Right": fit_hand(handR, dict(solid=box20, spread=-3, fingers=fingers_R((47.0, 0.0, 19.0), (40.0, 14.0, 34.0)))),
        "Left": fit_hand(handLv, dict(solid=lambda p: sdf_vcyl(p, 34.0, -36.0), spread=-2, fingers={
            "Index": dict(x0=(55, 70, 30), lo=FLO, hi=FHI), "Middle": dict(x0=(60, 72, 32), lo=FLO, hi=FHI),
            "Ring": dict(x0=(64, 74, 34), lo=FLO, hi=FHI), "Pinky": dict(x0=(68, 74, 34), lo=FLO, hi=FHI),
            "Thumb": dict(x0=(20, 10, 5, 5, 5), lo=TLO, hi=THI, target=(50.0, -12.0, 32.0), tw=1.0, contact_w=0.0)}))}
    # --- launcher: right as rifle, left fist round a 32 mm vertical front grip (lRot 90)
    clips["pose_launcher"] = {
        "Right": clips["pose_rifle"]["Right"],
        "Left": fit_hand(handLv, dict(solid=lambda p: sdf_vcyl(p, 16.0, -18.0), spread=-2, fingers={
            "Index": dict(x0=(70, 85, 40), lo=FLO, hi=FHI), "Middle": dict(x0=(72, 88, 40), lo=FLO, hi=FHI),
            "Ring": dict(x0=(78, 90, 40), lo=FLO, hi=FHI), "Pinky": dict(x0=(82, 88, 40), lo=FLO, hi=FHI),
            "Thumb": dict(x0=(20, 25, 20, 30, 20), lo=TLO, hi=THI, target=(20.0, -18.0, 38.0), tw=1.0, contact_w=0.4)}))}
    clips["pose_open"] = RIG.POSES["pose_open"]
    q = {"socket_hand_R": (pR, socket_quat(RR)), "socket_hand_L": (pL, socket_quat(RL))}
    return clips, q, dict(R=(pR, RR, gR), L=(pL, RL, gL))


if __name__ == "__main__":
    import os
    import sys
    HERE = os.path.dirname(os.path.abspath(__file__))
    S = np.load(os.path.join(HERE, "_cache", "fp_arms", "stage1.npz"))
    rig = RIG.FpRig(S)
    clips, socks, info = solve_poses(rig, S)
    for k, (p, q) in socks.items():
        hb = "RightHand" if k.endswith("_R") else "LeftHand"
        print(k, "offset from hand (mm)", np.round((p - rig.H[hb]) * 1000, 1), "quat", np.round(q, 4))
    print("palm skin R/L (mm)", round(info["R"][2]["palm_skin"] * 1000, 1), round(info["L"][2]["palm_skin"] * 1000, 1))
    for c, sides in clips.items():
        print(c)
        for s, p in sides.items():
            print("  ", s, {k: v for k, v in p.items()})

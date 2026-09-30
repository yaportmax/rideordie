"""Silhouette gear for the raiders (final space, rigid or body-skinned via common.add_gear): face scarves, scrap pauldrons
with spikes, back-slung blades, respirators, knee pads, molotov satchels, spiked collars, skull trophies.

Everything here is authored to read at 5-30 m: big shapes first (pauldron, mask, blade on the back), a few high-contrast
details second (spikes, filters, rivets), minimal micro detail (the tiled material textures carry that).
"""
import numpy as np

import cloth
import common
import gear
import kit
import mh
import raidergear as RG


# ------------------------------------------------------------------------------------------------
# face scarf (bandit style: nose to chest, triangular drape) - a cloth piece in the caller's material
# ------------------------------------------------------------------------------------------------

def face_scarf_garment(fit, top=-0.030, off=0.010, hang=0.10, point=0.07):
    """Lower-face scarf over the nose and mouth, falling in a triangle below the chin (INTERNAL space garment).
    top: upper edge relative to the eye line (m)."""
    hf = cloth.head_frame(fit)
    e = hf["eye"]

    def keep(cent, nrm, h):
        front = cent[:, 2] < h["centre"][2] + 0.005            # front half of the head / neck (internal -Z = forward)
        return front & (cent[:, 1] < e[1] + top) & (cent[:, 1] > e[1] - 0.22)
    g = cloth.head_shell(fit, keep, off=off, bridge=0.010, iters=22, include_neck=True, ymin=e[1] - 0.24)
    if not g.pos:
        return g
    P = np.array(g.pos)
    chin_y = e[1] - 0.105
    # the cloth hangs straight down from the chin line instead of following the throat inward; the centre sags to a point
    zc = float(P[np.abs(P[:, 1] - chin_y) < 0.015, 2].min()) if np.any(np.abs(P[:, 1] - chin_y) < 0.015) else hf["front"] + 0.06
    below = np.clip((chin_y - P[:, 1]) / 0.10, 0.0, 1.0)
    cx = fit.cx
    w = np.clip(1.0 - np.abs(P[:, 0] - cx) / 0.09, 0.0, 1.0)
    P[:, 2] = np.where(P[:, 1] < chin_y, np.minimum(P[:, 2], zc + 0.012 + 0.10 * (chin_y - P[:, 1]) * (1 - w)), P[:, 2])
    P[:, 1] -= below * w ** 1.5 * point
    P[:, 2] -= below * w * 0.015
    for k, p in enumerate(P):
        g.pos[k] = p
    return g


# ------------------------------------------------------------------------------------------------
# hard-surface pieces
# ------------------------------------------------------------------------------------------------

def pauldron(ctx, brc, binder, side, mats, layers=3, spikes=3, size=1.0, spike_len=0.075, tilt=0.0, label="pauldron"):
    """Layered scrap-metal pauldron (overlapping lames like a roof) strapped to the upper arm, with rivets and spikes.
    mats: dict(plate=, rivet=, strap=, spike=).  Rigid to <side>Arm (the lames) so it moves with the arm."""
    H = brc.landmarks()
    sg = 1.0 if side == "Left" else -1.0
    arm, fore = H[side + "Arm"], H[side + "ForeArm"]
    rc = brc.region(side + "Arm", side + "Shoulder", "Spine2")
    out_dir = np.array([sg * 0.62, 0.78, 0.0])
    out_dir /= np.linalg.norm(out_dir)
    rivs = []
    for i in range(layers):
        t = i / max(layers - 1, 1)
        c0 = arm + np.array([sg * (0.020 + 0.042 * t), 0.055 - 0.085 * t, 0.0])
        n = out_dir * (1 - t) + np.array([sg, 0.15, 0.0]) * t
        n /= np.linalg.norm(n)
        P, hn = gear.surface_pts(rc, c0[None])
        hu, hv = (0.105 - 0.018 * t) * size, (0.080 - 0.022 * t) * size
        so = 0.022 + 0.022 * (layers - 1 - i)
        try:
            pm = kit.patch_on_surface(rc, P[0], n, (0, 0, 1), hu, hv, standoff=so, thick=0.007, bevel=0.003, e=5.0, rings=4, seg=24,
                                      dome=(0.016 - 0.008 * t) * size, cast_from=0.3)
            pm = kit.smooth_normals(pm, 70.0)
        except RuntimeError:
            continue
        common.add_gear(ctx, pm, mats["plate"], binder, bone=side + "Arm", label=label)
        # rivets along the lower edge
        u = np.cross([0, 0, 1.0], n)
        u /= np.linalg.norm(u)
        v = np.cross(n, u)
        for k in (-1, 0, 1):
            q = P[0] + u * hu * 0.7 * k - v * hv * 0.62 + n * 0.3
            T, hp, hnn = kit.Raycaster(pm["pos"], pm["idx"]).cast(q[None], (-n)[None], tmax=0.6)
            if np.isfinite(T[0]):
                rivs.append((hp[0], hnn[0] if hnn[0] @ n > 0 else -hnn[0]))
        if i == 0 and spikes:
            for k in range(spikes):
                a = (k - (spikes - 1) / 2) * 0.55
                d = n * np.cos(a * 0.6) + np.array([0, 0, 1.0]) * np.sin(a) * 0.9 + np.array([0, 0.25, 0])
                d = np.asarray(d) + np.array([sg * tilt, 0, 0])
                d /= np.linalg.norm(d)
                base = P[0] + n * (so + 0.012 + 0.018 * size) + np.array([0, 0, 1.0]) * a * 0.055 * size
                common.add_gear(ctx, gear.spike(base, d, spike_len * size * (1.0 if k == (spikes - 1) // 2 else 0.8), 0.012 * size, seg=7),
                                mats["spike"], binder, bone=side + "Arm", label="spikes")
    if rivs:
        common.add_gear(ctx, RG.studs([p for p, n in rivs], [n for p, n in rivs], r=0.006, h=0.004, seg=5), mats["rivet"], binder,
                        bone=side + "Arm", label="rivets")
    # strap around the upper arm under the pauldron
    rc_arm = brc.region(side + "Arm")
    u = (fore - arm) / np.linalg.norm(fore - arm)
    y0 = arm + u * 0.11
    rr, dirs = kit.rings_along(rc_arm, y0, y0 + u * 0.03, [0.0, 1.0], offset=0.006, n=16, r_out=0.2)
    inner, _ = kit.rings_along(rc_arm, y0, y0 + u * 0.03, [0.0, 1.0], offset=0.002, n=16, r_out=0.2)
    m = kit.orient_outward(kit.loft(np.array([inner[0], rr[0], rr[1], inner[1]]), closed=True, tile=0.25, angle=60.0), y0 + u * 0.015, 60.0)
    common.add_gear(ctx, m, mats["strap"], binder, bone=side + "Arm", label="strap")


def machete_on_back(ctx, binder, H, mats, side=-1.0, length=0.58, label="machete", brc=None, standoff=0.045):
    """A machete in a leather sheath slung diagonally across the back (handle over the right shoulder when side=-1).
    brc: gear.BodyRC - the sheath follows the back surface of the body, `standoff` behind it (clothes included)."""
    s2 = H["Spine2"]
    back_z = s2[2] - 0.155
    top = np.array([side * 0.12, s2[1] + 0.19, back_z])
    bot = np.array([-side * 0.13, s2[1] - 0.17, back_z])
    ax = (bot - top) / np.linalg.norm(bot - top)
    n = np.array([0.0, 0.0, -1.0])
    wdir = np.cross(n, ax)
    wdir /= np.linalg.norm(wdir)
    L = length
    grip_len = 0.13
    ts = np.linspace(0, 1, 8)
    line = [top + (bot - top) * t for t in ts]
    rc = brc.region("Spine", "Hips", "Shoulder") if brc is not None else None

    def on_back(q, extra=0.0):
        q = q.copy()
        if rc is not None:
            T, hp, hn = rc.cast(np.array([[q[0], q[1], -0.9]]), np.array([[0.0, 0.0, 1.0]]), tmax=1.8)
            if np.isfinite(T[0]):
                q[2] = hp[0][2] - standoff - extra
        return q
    pts = np.array([on_back(q) for q in line])
    # smooth the z profile, keep it monotone-ish (a rigid blade: fit a straight line in z)
    A_ = np.stack([ts, np.ones_like(ts)], axis=1)
    coef, *_ = np.linalg.lstsq(A_, pts[:, 2], rcond=None)
    zfit = A_ @ coef
    zmin = np.minimum(zfit, pts[:, 2])
    shift = float((zmin - zfit).min())
    top = np.array([top[0], top[1], coef[1] + shift])
    bot = np.array([bot[0], bot[1], coef[0] + coef[1] + shift])
    ax = (bot - top) / np.linalg.norm(bot - top)
    wdir = np.cross(n, ax)
    wdir /= np.linalg.norm(wdir)
    s0 = top + ax * grip_len
    L = min(L, float(np.linalg.norm(bot - s0)) + 0.06)
    path = [s0 + ax * L * t + wdir * 0.010 * np.sin(t * np.pi) for t in np.linspace(0, 1, 7)]
    prof = np.array([[-1.0, -0.22], [1.0, -0.28], [1.0, 0.28], [-1.0, 0.22]])
    sheath = kit.sweep(np.array(path), np.linspace(0.030, 0.019, 7), profile=prof, sides=4, caps=True, tile=0.2, up=n)
    common.add_gear(ctx, sheath, mats["sheath"], binder, bone="Spine2", label=label)
    # handle: wrapped grip + guard + pommel
    common.add_gear(ctx, kit.cylinder(top, s0, 0.015, 0.016, seg=7, tile=0.1), mats["grip"], binder, bone="Spine2", label=label)
    guard = kit.xform(kit.rbox((0.075, 0.012, 0.022), 0.003, 1), R=kit.look_rot(ax, n), t=s0)
    common.add_gear(ctx, guard, mats["metal"], binder, bone="Spine2", label=label)
    common.add_gear(ctx, kit.ellipsoid(top - ax * 0.008, [0.019, 0.019, 0.019], seg=8, rings=5), mats["metal"], binder, bone="Spine2", label=label)
    # two straps holding it
    for t in (0.25, 0.70):
        c = s0 + ax * L * t
        strap = kit.xform(kit.rbox((0.022, 0.085, 0.012), 0.002, 1), R=kit.look_rot(n, ax), t=c + n * 0.004)
        common.add_gear(ctx, strap, mats["strap"], binder, bone="Spine2", label=label)


def respirator(ctx, brc, binder, mats, scale=1.0, label="respirator"):
    """Military-style respirator over the nose and mouth: rubber face piece, a central valve and two big filter canisters
    angled down and out, straps around the head.  Rigid to Head."""
    hi = gear.head_info(ctx, brc)
    rc = brc.head()
    ey = 0.5 * (hi["eye_l"][1] + hi["eye_r"][1])
    zc = hi["head"][2]
    # face piece: a surface patch over mouth + nose
    o = np.array([0.0, ey - 0.055, hi["front"] + 0.2])
    T, hp, hn = rc.cast(o[None], np.array([[0.0, 0.0, -1.0]]), tmax=0.5)
    P0 = hp[0]
    piece = kit.patch_on_surface(rc, P0, np.array([0.0, -0.1, 1.0]), (0, 1, 0), 0.058 * scale, 0.052 * scale, standoff=0.006, thick=0.012,
                                 bevel=0.004, e=2.6, rings=4, seg=22, dome=0.022 * scale, cast_from=0.3)
    common.add_gear(ctx, piece, mats["rubber"], binder, bone="Head", label=label)
    front = P0 + np.array([0.0, -0.008, 0.050 * scale])
    # central exhale valve
    common.add_gear(ctx, kit.cylinder(front - np.array([0, 0, 0.018]), front + np.array([0, -0.004, 0.012]), 0.020 * scale, 0.016 * scale, seg=10),
                    mats["metal"], binder, bone="Head", label=label)
    common.add_gear(ctx, kit.cylinder(front + np.array([0, -0.004, 0.012]), front + np.array([0, -0.005, 0.016]), 0.012 * scale, 0.011 * scale, seg=10),
                    mats["dark"], binder, bone="Head", label=label)
    # filter canisters (cheeks), pointing down/forward/out
    for sgn in (1.0, -1.0):
        base = P0 + np.array([sgn * 0.040 * scale, -0.020, 0.030 * scale])
        d = np.array([sgn * 0.55, -0.60, 0.58])
        d /= np.linalg.norm(d)
        a = base + d * 0.010
        b = a + d * 0.040 * scale
        common.add_gear(ctx, kit.cylinder(base, a, 0.014 * scale, 0.016 * scale, seg=10), mats["rubber"], binder, bone="Head", label=label)
        can = kit.lathe([(0.0, 0.0), (0.034 * scale, 0.0), (0.036 * scale, 0.004), (0.036 * scale, 0.034 * scale), (0.032 * scale, 0.040 * scale),
                         (0.0, 0.040 * scale)], a, axis=d, seg=12, up=(0, 1, 0))
        common.add_gear(ctx, can, mats["canister"], binder, bone="Head", label=label)
        # ribs + grille
        for t in (0.012, 0.024):
            common.add_gear(ctx, kit.lathe([(0.036 * scale, -0.002), (0.039 * scale, 0.0), (0.039 * scale, 0.003), (0.036 * scale, 0.005)], a + d * t * scale,
                                           axis=d, seg=12, up=(0, 1, 0)), mats["metal"], binder, bone="Head", label=label)
        common.add_gear(ctx, kit.cylinder(b, b + d * 0.002, 0.026 * scale, 0.026 * scale, seg=12), mats["dark"], binder, bone="Head", label=label)
    # straps: two around the back of the head
    for (y0, y1) in ((ey + 0.020, ey + 0.036), (ey - 0.062, ey - 0.046)):
        rr, dirs = kit.rings_along(rc, np.array([0, y0, zc]), np.array([0, y1, zc]), [0.0, 1.0], offset=0.012, n=22, r_out=0.3)
        inner, _ = kit.rings_along(rc, np.array([0, y0, zc]), np.array([0, y1, zc]), [0.0, 1.0], offset=0.008, n=22, r_out=0.3)
        # only the back 60% of the ring (the front is under the mask / goggles)
        keep = np.where(rr[0][:, 2] < hi["head"][2] + 0.03)[0]
        if len(keep) < 4:
            continue
        keep = np.sort(keep)
        ring = [inner[0][keep], rr[0][keep], rr[1][keep], inner[1][keep]]
        m = kit.loft(np.array(ring), closed=True, tile=0.25, angle=60.0)
        common.add_gear(ctx, kit.orient_outward(m, np.array([0, 0.5 * (y0 + y1), zc]), 60.0), mats["strap"], binder, bone="Head", label=label)


def knee_pads(ctx, brc, binder, rc_pants, mats, size=1.0, label="knee_pad"):
    """Hard-shell knee pads with a strap band (skinned to the knee blend so they bend with the leg)."""
    H = brc.landmarks()
    for side in ("Left", "Right"):
        kn = H[side + "Leg"]
        o = kn + np.array([0.0, 0.01, 0.35])
        T, hp, hn = rc_pants.cast(o[None], np.array([[0.0, 0.0, -1.0]]), tmax=0.7)
        if not np.isfinite(T[0]):
            continue
        pad = gear.knee_pad(rc_pants, hp[0], hn[0], half_u=0.058 * size, half_v=0.072 * size, thick=0.016)
        common.add_gear(ctx, pad, mats["pad"], binder, bone=side + "Leg", label=label)
        # strap behind the knee: a band ring around the leg slightly below the joint
        leg_dir = (H[side + "Foot"] - kn) / np.linalg.norm(H[side + "Foot"] - kn)
        c0 = kn + leg_dir * 0.045
        rc_leg = rc_pants
        rr, dirs = kit.rings_along(rc_leg, c0, c0 + leg_dir * 0.028, [0.0, 1.0], offset=0.006, n=16, r_out=0.22)
        inner, _ = kit.rings_along(rc_leg, c0, c0 + leg_dir * 0.028, [0.0, 1.0], offset=0.002, n=16, r_out=0.22)
        m = kit.orient_outward(kit.loft(np.array([inner[0], rr[0], rr[1], inner[1]]), closed=True, tile=0.25, angle=60.0), c0, 60.0)
        common.add_gear(ctx, m, mats["strap"], binder, bone=side + "Leg", label=label)


def molotov(ctx, binder, bone, base, d, mats, scale=1.0, label="molotov"):
    """A bottle with a rag stuffed in the neck (glass green/brown + cloth), base point + axis direction d."""
    d = np.asarray(d, float) / np.linalg.norm(d)
    s = scale
    body = kit.lathe([(0.0, 0.0), (0.030 * s, 0.0), (0.032 * s, 0.006 * s), (0.032 * s, 0.13 * s), (0.026 * s, 0.155 * s), (0.012 * s, 0.175 * s),
                      (0.011 * s, 0.215 * s), (0.0, 0.215 * s)], base, axis=d, seg=9, up=(0, 0, 1))
    common.add_gear(ctx, body, mats["bottle"], binder, bone=bone, label=label)
    tip = base + d * 0.215 * s
    rag = kit.sweep(kit.polyline_smooth([tip - d * 0.01, tip + d * 0.03 + np.array([0.01, 0, 0.0]), tip + d * 0.05 + np.array([0.025, -0.02, 0.01]),
                                         tip + d * 0.045 + np.array([0.04, -0.05, 0.015])], 6), np.linspace(0.012, 0.007, 6) * s, sides=4, tile=0.1)
    common.add_gear(ctx, rag, mats["rag"], binder, bone=bone, label=label)


def satchel(ctx, binder, H, rc, side, mats, y_off=-0.02, label="satchel"):
    """A canvas satchel on the hip (strap over the opposite shoulder is left to the caller)."""
    sg = 1.0 if side == "Left" else -1.0
    hip = H[side + "UpLeg"]
    th = np.radians(80.0) * sg
    o = np.array([np.sin(th) * 0.6, hip[1] + y_off, hip[2] + np.cos(th) * 0.6])
    T, hp, hn = rc.cast(o[None], (-np.array([np.sin(th), 0.0, np.cos(th)]))[None], tmax=0.9)
    if not np.isfinite(T[0]):
        return None, None
    m = gear.pouch((0.20, 0.17, 0.085), flap=0.55, radius=0.012)
    common.add_gear(ctx, gear.place(m, hp[0] + hn[0] * 0.006, hn[0]), mats["canvas"], binder, bone="Hips", label=label)
    return hp[0], hn[0]


def spiked_collar(ctx, brc, binder, mats, spikes=8, label="collar"):
    """A studded leather collar around the neck with short spikes."""
    H = brc.landmarks()
    rc = brc.region("Neck")
    nk, hd = H["Neck"], H["Head"]
    c0 = nk + (hd - nk) * 0.25
    c1 = nk + (hd - nk) * 0.62
    rr, dirs = kit.rings_along(rc, c0, c1, [0.0, 1.0], offset=0.012, n=20, r_out=0.25)
    inner, _ = kit.rings_along(rc, c0, c1, [0.0, 1.0], offset=0.004, n=20, r_out=0.25)
    m = kit.orient_outward(kit.loft(np.array([inner[0], rr[0], rr[1], inner[1]]), closed=True, tile=0.25, angle=60.0), 0.5 * (c0 + c1), 60.0)
    common.add_gear(ctx, m, mats["leather"], binder, bone="Neck", label=label)
    mid = 0.5 * (rr[0] + rr[1])
    sp = []
    for k in np.linspace(0, len(mid), spikes, endpoint=False).astype(int):
        p = mid[k]
        d = dirs[k]
        sp.append(gear.spike(p - d * 0.002, d + np.array([0, 0.1, 0]), 0.03, 0.007, seg=6))
    common.add_gear(ctx, kit.merge(sp), mats["spike"], binder, bone="Neck", label="spikes")


def skull(center, size=0.05, seg=10):
    """A small low-poly skull trophy (cranium + jaw block + eye sockets as separate dark meshes). Returns (bone, dark)."""
    s = size
    cran = kit.ellipsoid(center + np.array([0, 0.012 * s / 0.05, 0]), [0.5 * s, 0.52 * s, 0.6 * s], seg=seg, rings=7)
    jaw = kit.xform(kit.rbox((0.62 * s, 0.35 * s, 0.55 * s), 0.12 * s, 1), t=center + np.array([0, -0.40 * s, 0.15 * s]))
    eyes = [kit.ellipsoid(center + np.array([sx * 0.2 * s, -0.02 * s, 0.52 * s]), [0.14 * s, 0.13 * s, 0.08 * s], seg=6, rings=4) for sx in (-1, 1)]
    nose = kit.ellipsoid(center + np.array([0, -0.2 * s, 0.56 * s]), [0.06 * s, 0.08 * s, 0.05 * s], seg=5, rings=3)
    return kit.merge([cran, jaw]), kit.merge(eyes + [nose])


# ------------------------------------------------------------------------------------------------
# painted back emblems (texture: call from a painter's `extra`)
# ------------------------------------------------------------------------------------------------

def _sd_ellipse(x, y, cx, cy, rx, ry):
    return np.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2) - 1.0


def paint_back_emblem(bk, alb, h, center_y, kind="skull", size=0.12, colour=(0.78, 0.74, 0.64), strength=0.85, seed=3, cx=None):
    """Crude hand-painted emblem on the BACK of a garment (internal space: back = +Z).  kind: skull | cross | tally.
    Rough, chipped paint (noise-eroded), slightly raised."""
    import uvbake as U
    fit = bk.fit
    x = bk.P[..., 0] - (fit.cx if cx is None else cx)
    y = bk.P[..., 1] - center_y
    back = bk.P[..., 2] > fit.pos[:, 2].mean()
    s = size
    if kind == "skull":
        cran = _sd_ellipse(x, y, 0.0, 0.10 * s / 0.12, 0.42 * s, 0.40 * s) < 0
        jaw = (np.abs(x) < 0.24 * s) & (y < -0.16 * s / 0.12 * 0.12) & (y > -0.42 * s)
        eyes = (_sd_ellipse(np.abs(x), y, 0.16 * s, 0.02 * s, 0.10 * s, 0.11 * s) < 0)
        nose = (np.abs(x) < 0.04 * s + (y + 0.12 * s) * 0.2) & (y < -0.06 * s) & (y > -0.16 * s)
        teeth = (np.abs(x) < 0.22 * s) & (np.abs(y + 0.30 * s) < 0.012) | ((np.abs(y + 0.30 * s) < 0.09 * s) & (np.abs(np.mod(x + 0.5, 0.055 * s / 0.12) - 0.0275 * s / 0.12) < 0.005))
        bones = ((np.abs((x - y * 1.1)) < 0.05 * s) | (np.abs((x + y * 1.1)) < 0.05 * s)) & (np.abs(y + 0.35 * s) < 0.45 * s) & (np.abs(x) < 0.80 * s) & (y < -0.30 * s)
        m = (cran | jaw | bones) & ~eyes & ~nose & ~teeth
    elif kind == "cross":
        m = ((np.abs(x) < 0.08 * s) & (np.abs(y) < 0.7 * s)) | ((np.abs(y - 0.2 * s) < 0.08 * s) & (np.abs(x) < 0.45 * s))
    else:
        m = np.zeros_like(x, bool)
        for k in range(4):
            m |= (np.abs(x - (k - 1.5) * 0.14 * s) < 0.03 * s) & (np.abs(y) < 0.5 * s)
        m |= (np.abs(y - x * 0.9) < 0.035 * s) & (np.abs(x) < 0.4 * s)
    m = (m & back).astype(np.float32)
    # dry-brush erosion + drips
    er = U.fbm(m.shape, 25.0, 3, seed)
    m = m * U.smoothstep(0.30, 0.55, er + 0.25)
    m = U.blur(m, 0.6)
    col = np.asarray(colour, np.float32) * (0.85 + 0.25 * U.fbm(m.shape, 60.0, 2, seed + 1))[..., None]
    alb = alb * (1 - strength * m[..., None]) + col * strength * m[..., None]
    return alb, h + m * 0.0002

"""raider_c: masked heavy - 1.92 m hulking brute, cracked hockey mask with straps, riveted scrap-metal chest plates, a car-door
left pauldron (paint, tintable), tyre-tread right shoulder, pipe forearm guards, taped hands, metal thigh/shin guards, chain
belt with a padlock, tyre-rubber apron, heavy boots, dark work trousers."""
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import charbuild
import cloth
import common
import gear
import kit
import lod
import menace
import mh
import outfit
import paintcloth as PC
import raidergear as RG
import skinpaint as SP
import uvbake as U

NAME = "raider_c"
SPEC = dict(macro=dict(gender=1.0, age=0.55, muscle=1.0, weight=0.85, height=0.5, race={"caucasian": 0.7, "african": 0.3}),
            extra=[("torso/torso-vshape-incr", 0.6), ("neck/neck-scale-horiz-incr", 1.0), ("neck/neck-scale-vert-decr", 0.6),
                   ("armslegs/l-hand-scale-incr", 0.5), ("armslegs/r-hand-scale-incr", 0.5), ("head/head-scale-horiz-decr", 0.2)],
            height=1.92, skin="middleage_caucasian_male", sole=0.035)

TROUSERS = (0.075, 0.07, 0.06)
UNDER = (0.10, 0.095, 0.085)


def mask_painter():
    """Cream hockey mask: vent-hole pattern, three red slashes, grime in the recesses, cracks."""
    def paint(bk):
        fit = bk.fit
        shape = bk.mask.shape
        alb = np.ones(shape + (3,), np.float32) * np.array([0.78, 0.74, 0.62], np.float32)
        n = U.fbm(shape, 60.0, 3, 5)
        alb *= (0.85 + 0.2 * n)[..., None]
        hf = cloth.head_frame(fit)
        e = hf["eye"]
        x = bk.P[..., 0] - e[0]
        y = bk.P[..., 1] - e[1]
        h = np.zeros(shape, np.float32)
        # vent holes: rows of small dark ovals on the cheeks / chin / forehead
        holes = np.zeros(shape, np.float32)
        for cx, cy in [(sx * xx, yy) for sx in (-1, 1) for xx, yy in ((0.030, -0.045), (0.040, -0.062), (0.022, -0.075), (0.012, -0.095),
                                                                      (0.035, -0.084), (0.020, 0.045), (0.036, 0.040))] + [(0.0, -0.06), (0.0, -0.105), (0.0, 0.055)]:
            d = ((x - cx) / 0.0048) ** 2 + ((y - cy) / 0.0065) ** 2
            holes = np.maximum(holes, (d < 1.0).astype(np.float32))
        holes = U.blur(holes, 0.6)
        alb = alb * (1 - holes[..., None]) + np.array([0.03, 0.025, 0.02], np.float32) * holes[..., None]
        h -= holes * 0.002
        # red slashes over the right cheek / forehead
        sl = np.zeros(shape, np.float32)
        for k in range(3):
            x0 = -0.045 + 0.016 * k
            u_ = (x - x0) * 0.8 + (y - 0.02) * 0.6
            v_ = -(x - x0) * 0.6 + (y - 0.02) * 0.8
            sl = np.maximum(sl, ((np.abs(u_) < 0.0035 * (1 - np.abs(v_) / 0.05)) & (np.abs(v_) < 0.05)).astype(np.float32))
        sl = U.blur(sl, 0.8)
        alb = alb * (1 - 0.9 * sl[..., None]) + np.array([0.45, 0.03, 0.02], np.float32) * 0.9 * sl[..., None]
        # cracks + grime toward the edges
        cr = PC.aniso(shape, 9, 0.6, 6)
        crack = (np.abs(cr) < 0.03).astype(np.float32) * U.smoothstep(0.6, 0.8, U.fbm(shape, 40.0, 2, 3))
        alb *= (1 - 0.6 * crack)[..., None]
        edge = 1.0 - U.smoothstep(0.0, 0.025, bk.hem)
        alb *= (1 - 0.35 * edge * (0.5 + n))[..., None]
        dm, dc = PC.dust_layer(bk, 17, 0.35)
        alb = alb * (1 - dm[..., None] * 0.6) + dc[None, None, :] * dm[..., None] * 0.6
        h += PC.edge_roll(bk, 0.006, 0.0012)
        return alb, h
    return paint


def skin_texture(ctx, fit):
    ch = ctx.ch
    import body as B
    base = B.skin_image(ch.spec["skin"], 1024).astype(np.float32) / 255.0
    sb = SP.SkinBake(ch, fit, 1024)
    base = sb.fill_gutters(base)
    alb = SP.tone(base, mul=(0.72, 0.58, 0.46), gamma=1.05)
    alb = SP.blend(alb, (0.24, 0.18, 0.13), SP.dirt(sb, 9, 0.8))
    c, half = SP._face_frame(ch)
    scalp = (sb.G["Head"] > 0.5) & ((sb.P[..., 1] > c[1] + 0.035) | ((sb.N[..., 2] > 0.2) & (sb.P[..., 1] > c[1] - 0.05)))
    n = U.fbm(sb.mask.shape, 1.6, 2, 12, wrap=False)
    m = U.blur(scalp.astype(np.float32), 3.0) * (0.35 + 0.3 * U.smoothstep(0.4, 0.6, n))
    alb = SP.blend(alb, (0.08, 0.07, 0.06), np.clip(m, 0, 0.7))
    # scars on the scalp and the forearms
    for k in range(4):
        rng = np.random.default_rng(k + 3)
        sel = sb.bone_mask("LeftForeArm" if k % 2 else "RightForeArm") > 0.6
        idx = np.flatnonzero(sel.reshape(-1))
        if len(idx) == 0:
            continue
        p = sb.P.reshape(-1, 3)[idx[rng.integers(len(idx))]]
        pts = np.array([p + [-0.02, 0.015, 0], p, p + [0.025, -0.012, 0.0]])
        alb = SP.scar(alb, sb.P, pts, width=0.003, colour=(0.55, 0.38, 0.34), strength=0.6)
    return np.clip(alb * 255 + 0.5, 0, 255).astype(np.uint8)


def rivets(meshes_pts, r=0.0065, h=0.004):
    return RG.studs([p - n * 0.001 for p, n in meshes_pts], [n for p, n in meshes_pts], r=r, h=h, seg=4)


def plate(rc, P, n, up, hu, hv, standoff, thick=0.008, dome=0.01, e=3.5, rings=3, seg=16):
    return kit.patch_on_surface(rc, P, n, up, hu, hv, standoff=standoff, thick=thick, bevel=0.003, e=e, rings=rings, seg=seg, dome=dome, cast_from=0.35)


def rivets_around(P, n, up, hu, hv, standoff, count=8, inset=0.014, mesh=None):
    """Rivet positions around a plate outline; with `mesh` they are ray-cast onto the plate's actual top surface."""
    n = np.asarray(n, float) / np.linalg.norm(n)
    u = np.cross(up, n)
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    rc = kit.Raycaster(mesh["pos"], mesh["idx"]) if mesh is not None else None
    out = []
    for k in range(count):
        a = 2 * np.pi * (k + 0.5) / count
        rr = kit.superellipse_r(a, hu - inset, hv - inset, 3.5)
        q = P + (np.cos(a) * u + np.sin(a) * v) * rr
        if rc is not None:
            T, hp, hn = rc.cast((q + n * 0.25)[None], (-n)[None], tmax=0.5)
            if np.isfinite(T[0]):
                out.append((hp[0], hn[0] if hn[0] @ n > 0 else -hn[0]))
            continue
        out.append((q + n * standoff, n))
    return out


def add_gear(ctx, fit, pcs):
    ch = ctx.ch
    brc = gear.BodyRC(ch)
    binder = kit.Binder(ch)
    H = brc.landmarks()
    hi = gear.head_info(ctx, brc)
    rc_t = outfit.rc_from_pieces([pcs["under"]])
    rc_p = outfit.rc_from_pieces([pcs["trousers"]])
    armor = common.gear_material(ctx, "armor", "scrap", color=(0.62, 0.58, 0.54), rough=1.0, metal=1.0)
    paint = ctx.material("paint", base_tex=ctx.glb.texture_array("paint_tex", _paint_tex(), "jpg", 88), color=(0.24, 0.33, 0.36, 1.0), rough=0.7, metallic=0.25)
    metal = common.gear_material(ctx, "metal_dark", "metal_dark", color=(0.42, 0.42, 0.40), rough=1.0, metal=1.0)
    rubber = common.gear_material(ctx, "rubber", "rubber", color=(0.08, 0.08, 0.08), rough=1.0, metal=0.0)
    leather = common.gear_material(ctx, "leather", "leather", color=(0.13, 0.08, 0.05), rough=0.85, metal=0.0)
    tape = common.gear_material(ctx, "cloth_tape", "canvas", color=(0.30, 0.27, 0.20), rough=0.95)
    strap = common.gear_material(ctx, "webbing_black", "webbing", color=(0.05, 0.05, 0.05), rough=0.9)
    riv = []
    cy = fit.belt_y + 0.22
    up = np.array([0.0, 1.0, 0.0])
    # chest plates (upper chest, abdomen, left pec plate painted), back plate
    for (x, y, hu, hv, so, mat, dome) in ((0.0, cy + 0.06, 0.17, 0.095, 0.010, armor, 0.016), (0.0, cy - 0.12, 0.15, 0.085, 0.018, armor, 0.012),
                                          (0.07, cy + 0.09, 0.075, 0.06, 0.030, paint, 0.008), (-0.08, cy - 0.04, 0.07, 0.05, 0.030, armor, 0.006)):
        T, hp, hn = rc_t.cast(np.array([[x, y, 0.9]]), np.array([[0.0, 0.0, -1.0]]), tmax=2.0)
        if not np.isfinite(T[0]):
            continue
        pm = plate(rc_t, hp[0], hn[0], up, hu, hv, so, dome=dome)
        common.add_gear(ctx, pm, mat, binder, label="chest_plate")
        riv += rivets_around(hp[0], hn[0], up, hu, hv, 0, count=4, mesh=pm)
    T, hp, hn = rc_t.cast(np.array([[0.0, cy, -0.9]]), np.array([[0.0, 0.0, 1.0]]), tmax=2.0)
    if np.isfinite(T[0]):
        pm = plate(rc_t, hp[0], hn[0], up, 0.17, 0.2, 0.012, dome=0.02, rings=4, seg=20)
        common.add_gear(ctx, pm, armor, binder, label="back_plate")
        riv += rivets_around(hp[0], hn[0], up, 0.17, 0.2, 0, count=6, mesh=pm)
    # shoulder straps holding the plates
    for sx in (1.0, -1.0):
        sm, _, _ = gear.ribbon(rc_t, [[sx * 0.12, cy + 0.12, 0.2], [sx * 0.13, H["Neck"][1] - 0.01, 0.0], [sx * 0.12, cy + 0.12, -0.2]], 0.04,
                               standoff=0.016, thick=0.005, n=14)
        common.add_gear(ctx, sm, strap, binder, label="strap")
    # left pauldron: a car-door panel (paint) with a window-frame lip; right: tyre tread
    rc_sh = brc.region("LeftArm", "LeftShoulder", "RightArm", "RightShoulder")
    arm = H["LeftArm"]
    P, hn_ = gear.surface_pts(rc_sh, (arm + np.array([0.02, 0.06, 0.0]))[None])
    n = np.array([0.55, 0.83, 0.0])
    door = kit.patch_on_surface(rc_sh, P[0], n, (0, 0, 1), 0.14, 0.16, standoff=0.03, thick=0.012, bevel=0.004, e=6.0, rings=3, seg=20, dome=0.03, cast_from=0.35)
    common.add_gear(ctx, door, paint, binder, label="pauldron_door")
    lip = kit.patch_on_surface(rc_sh, P[0] + np.array([-0.02, 0.0, 0.0]), n, (0, 0, 1), 0.15, 0.03, standoff=0.05, thick=0.012, bevel=0.003, e=6.0, rings=2, seg=12, dome=0.0, cast_from=0.35)
    common.add_gear(ctx, lip, metal, binder, label="pauldron_door")
    riv += rivets_around(P[0], n, np.array([0.0, 0.0, 1.0]), 0.14, 0.16, 0, count=8, mesh=door)
    spike_m = common.gear_material(ctx, "spike", "metal_dark", color=(0.70, 0.68, 0.64), rough=0.7, metal=1.0)
    for k, off in enumerate((-0.09, -0.03, 0.03, 0.09)):
        base = P[0] + n * 0.05 + np.array([0.0, 0.0, off]) + np.array([0.02, 0.0, 0.0])
        d = n + np.array([0.25, 0.1, off * 3.0])
        common.add_gear(ctx, gear.spike(base, d, 0.085 if k in (1, 2) else 0.065, 0.014, seg=7), spike_m, binder, bone="LeftArm", label="spikes")
    armR, foreR = H["RightArm"], H["RightForeArm"]
    axis = (foreR - armR) / np.linalg.norm(foreR - armR)
    prof = [(0.07, -0.045), (0.105, -0.045), (0.112, -0.03), (0.112, 0.03), (0.105, 0.045), (0.07, 0.045)]
    tyre = kit.lathe(prof, armR + axis * 0.03 + np.array([0, 0.035, 0]), axis=axis, seg=18, up=(0, 1, 0), angle=(np.pi / 2 - 2.2, np.pi / 2 + 2.2))
    common.add_gear(ctx, tyre, rubber, binder, bone="RightArm", label="pauldron_tyre")
    # forearm pipe guards + straps
    for side in ("Left", "Right"):
        el, wr = H[side + "ForeArm"], H[side + "Hand"]
        u = (wr - el) / np.linalg.norm(wr - el)
        sg = 1.0 if side == "Left" else -1.0
        out = np.array([sg, 0.3, 0.0])
        out -= u * (out @ u)
        out /= np.linalg.norm(out)
        side_v = np.cross(u, out)
        bodyF = mh.to_final(ch.full["pos"])
        band, _ = RG.bracer(bodyF, H, side, from_wrist=0.06, length=0.035, grow=0.018, seg=14, spikes=0)
        band2, _ = RG.bracer(bodyF, H, side, from_wrist=0.17, length=0.035, grow=0.022, seg=14, spikes=0)
        common.add_gear(ctx, band, leather, binder, bone=side + "ForeArm", label="pipe_strap")
        common.add_gear(ctx, band2, leather, binder, bone=side + "ForeArm", label="pipe_strap")
        for k, off in enumerate((-0.022, 0.0, 0.022)):
            p0 = el + u * 0.05 + out * 0.058 + side_v * off
            p1 = wr - u * 0.03 + out * 0.046 + side_v * off
            common.add_gear(ctx, kit.cylinder(p0, p1, 0.011, seg=8), metal, binder, bone=side + "ForeArm", label="pipe")
        # taped hands
        rc_h = brc.region(side + "Hand")
        mid = H[side + "HandMiddle1"]
        wrap = gear.spiral_wrap(rc_h, wr - u * 0.02, mid + (mid - wr) * 0.1, turns=3.0, width=0.034, offset=0.004, thick=0.003, n=20, r_out=0.2)
        common.add_gear(ctx, wrap, tape, binder, label="hand_wrap")
    # thigh + shin guards, knee cups
    for sx, name in ((1.0, "Left"), (-1.0, "Right")):
        hip, knee, ank = H[name + "UpLeg"], H[name + "Leg"], H[name + "Foot"]
        for (y, hu, hv, mat, so) in ((0.5 * (hip[1] + knee[1]) - 0.03, 0.075, 0.12, armor, 0.008), (knee[1] + 0.005, 0.06, 0.06, metal, 0.018),
                                     (0.5 * (knee[1] + ank[1]) + 0.04, 0.055, 0.12, armor, 0.012)):
            T, hp, hn = rc_p.cast(np.array([[hip[0] * 0.5 + knee[0] * 0.5, y, 0.8]]), np.array([[0.0, 0.0, -1.0]]), tmax=2.0)
            if np.isfinite(T[0]):
                pm = plate(rc_p, hp[0], hn[0], up, hu, hv, so, dome=0.014 if mat is metal else 0.008)
                common.add_gear(ctx, pm, mat, binder, label="leg_guard")
    # chain belt + padlock + tyre apron
    bm, front, c, rings = gear.belt(ctx, brc, fit.belt_y - 0.01, detail=0.5)
    common.add_gear(ctx, bm, leather, binder, label="belt")
    ring = rings[2] + (rings[2] - np.array([0.0, rings[2][:, 1].mean(), c[2]])) * np.array([0.04, 0, 0.04])
    ch_pts = np.vstack([ring[::3], ring[:1]])
    ch_m = RG.chain(ch_pts[:len(ch_pts) // 2 + 2], link_len=0.065, link_w=0.03, wire=0.0045)
    common.add_gear(ctx, ch_m, metal, binder, bone="Hips", label="chain")
    lock = kit.rbox((0.04, 0.05, 0.018), 0.004, 1)
    common.add_gear(ctx, kit.xform(lock, t=front + np.array([0.03, -0.045, 0.02])), metal, binder, bone="Hips", label="padlock")
    a = np.linspace(0, np.pi, 8)
    shackle = np.stack([0.03 + 0.012 * np.cos(a), -0.02 + 0.015 * np.sin(a), np.full(8, 0.02)], axis=1) + front
    common.add_gear(ctx, kit.sweep(shackle, 0.0035, sides=5), metal, binder, bone="Hips", label="padlock")
    T, hp, hn = rc_p.cast(np.array([[0.0, fit.belt_y - 0.17, 0.8]]), np.array([[0.0, 0.0, -1.0]]), tmax=2.0)
    if np.isfinite(T[0]):
        ap = kit.patch_on_surface(rc_p, hp[0] + np.array([0, 0.0, 0.0]), hn[0], up, 0.13, 0.17, standoff=0.02, thick=0.01, bevel=0.003, e=5.0, rings=3, seg=16, dome=0.0, cast_from=0.35)
        common.add_gear(ctx, ap, rubber, binder, label="apron")
    common.add_gear(ctx, rivets(riv), metal, binder, label="rivets")
    # heavy boots
    boot_m = common.gear_material(ctx, "leather_boot", "leather", color=(0.07, 0.055, 0.045), rough=0.85, metal=0.0)
    for side in ("Left", "Right"):
        b = gear.boots(ctx, brc, side, upper_off=0.014, shaft_len=0.26, detail=0.45)
        common.add_gear(ctx, b["upper"], boot_m, binder, label="boot_upper")
        common.add_gear(ctx, b["shaft"], boot_m, binder, label="boot_shaft")
        ank = H[side + "Foot"][2]
        common.add_gear(ctx, b["sole"], rubber, binder, blend=(side + "Foot", side + "ToeBase", lambda P, a=ank: np.clip((P[:, 2] - a) / 0.15, 0, 1)), label="boot_sole")
    # mask straps: three bands around the head
    rc_hd = brc.head()
    ey = hi["eye_l"][1]
    zc = hi["head"][2]
    for (y0, y1) in ((ey + 0.035, ey + 0.055), (ey - 0.045, ey - 0.028)):
        rr, dirs = kit.rings_along(rc_hd, np.array([0, y0, zc]), np.array([0, y1, zc]), [0.0, 1.0], offset=0.006, n=24, r_out=0.3)
        inner, _ = kit.rings_along(rc_hd, np.array([0, y0, zc]), np.array([0, y1, zc]), [0.0, 1.0], offset=0.002, n=24, r_out=0.3)
        m = kit.loft(np.array([inner[0], rr[0], rr[1], inner[1]]), closed=True, tile=0.25, angle=60.0)
        m = kit.orient_outward(m, np.array([0, 0.5 * (y0 + y1), zc]), 60.0)
        common.add_gear(ctx, m, strap, binder, bone="Head", label="mask_strap")
    # --- two rusted exhaust stacks rising behind the shoulders (bolted to the back plate) + a skull on the belt
    rust = common.gear_material(ctx, "rust", "scrap", color=(0.55, 0.36, 0.22), rough=1.0, metal=0.6)
    s2 = H["Spine2"]
    T, hp, hn = rc_t.cast(np.array([[0.0, cy, -0.9]]), np.array([[0.0, 0.0, 1.0]]), tmax=2.0)
    bz = (hp[0][2] if np.isfinite(T[0]) else s2[2] - 0.15) - 0.05
    for sx in (1.0, -1.0):
        p0 = np.array([sx * 0.085, cy - 0.10, bz])
        p1 = np.array([sx * 0.10, s2[1] + 0.22, bz - 0.015])
        p2 = p1 + np.array([sx * 0.015, 0.07, -0.05])
        pipe = kit.sweep(kit.polyline_smooth([p0, 0.5 * (p0 + p1), p1, p2], 10), 0.026, sides=10, caps=True, tile=0.2)
        common.add_gear(ctx, pipe, rust, binder, bone="Spine2", label="exhaust")
        d = (p2 - p1) / np.linalg.norm(p2 - p1)
        common.add_gear(ctx, kit.cylinder(p2 - d * 0.01, p2 + d * 0.012, 0.031, 0.031, seg=10), metal, binder, bone="Spine2", label="exhaust")
        common.add_gear(ctx, kit.cylinder(p2 + d * 0.012, p2 + d * 0.014, 0.024, 0.024, seg=10), rubber, binder, bone="Spine2", label="exhaust")
        for y in (cy - 0.02, s2[1] + 0.05):
            cl = kit.xform(kit.rbox((0.07, 0.022, 0.014), 0.003, 1), t=np.array([sx * 0.09, y, bz + 0.03]))
            common.add_gear(ctx, cl, strap, binder, bone="Spine2", label="exhaust")
    bone_m = common.gear_material(ctx, "bone", "plastic", color=(0.78, 0.72, 0.60), rough=0.8)
    sk_b, sk_d = menace.skull(np.array([0.10, fit.belt_y - 0.07, 0.0]), size=0.055)
    T, hp, hn = rc_p.cast(np.array([[0.10, fit.belt_y - 0.07, 0.8]]), np.array([[0.0, 0.0, -1.0]]), tmax=2.0)
    if np.isfinite(T[0]):
        off = np.array([0.0, 0.0, hp[0][2] + 0.03])
        common.add_gear(ctx, kit.xform(sk_b, t=off), bone_m, binder, bone="Hips", label="skull")
        common.add_gear(ctx, kit.xform(sk_d, t=off), rubber, binder, bone="Hips", label="skull")
    ctx.brc, ctx.binder = brc, binder


def _paint_tex(size=256):
    """Grey-scale chipped paint over bare metal (tint via the material colour factor)."""
    n = U.fbm((size, size), 10.0, 3, 3)
    big = U.fbm((size, size), 60.0, 3, 8)
    chips = U.smoothstep(0.70, 0.73, n * 0.75 + big * 0.35)
    sc = U.fbm((size, size), 3.0, 2, 4)
    streak = PC.aniso((size, size), 5, 0.8, 20)
    g = 0.90 - 0.08 * sc - 0.05 * np.clip(streak, -1, 1) - 0.12 * (1 - big)
    g = g * (1 - chips) + 0.30 * chips
    return (np.clip(np.stack([g, g, g], -1), 0, 1) * 255).astype(np.uint8)


def build():
    t0 = time.time()
    ctx = charbuild.Ctx(NAME, SPEC)
    ctx.bulk = 1.25
    ch = ctx.ch
    lod.decimate(ch, 0.16)
    fit = cloth.CFit(ch)
    ctx.fit = fit
    under = cloth.torso_top(fit, "tank", off=0.014, bridge=0.03, hem=-0.03, strap=0.15, neck_half=0.07, drape=False)
    trousers = cloth.pants(fit, off=0.024, bridge=0.03)

    def mask_keep(cent, nrm, hf):
        e = hf["eye"]
        fr = (nrm[:, 2] < -0.25) & (cent[:, 1] < e[1] + 0.07) & (cent[:, 1] > e[1] - 0.125)
        eyes = (np.linalg.norm((cent - hf["eye_l"]) * np.array([1.0, 1.35, 0.0]), axis=1) < 0.018) | \
               (np.linalg.norm((cent - hf["eye_r"]) * np.array([1.0, 1.35, 0.0]), axis=1) < 0.018)
        return fr & ~eyes
    mask = cloth.head_shell(fit, mask_keep, off=0.014, bridge=0.012, iters=30)
    pc_u = cloth.finish(under, fit)
    pc_t = cloth.finish(trousers, fit)
    pc_m = cloth.finish(mask, fit)
    tris = common.cull_tris(ch, [under.cover, trousers.cover], hide_bones=("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"))
    common.add_skin(ctx, tris, skin_texture(ctx, fit))
    common.add_eyes_lite(ctx, iris=(0.30, 0.34, 0.30))
    common.cloth_group(ctx, "cloth_under", [pc_u], outfit.fabric_painter(UNDER, dust=0.6, seed=71, oil=0.3))
    common.cloth_group(ctx, "cloth_trousers", [pc_t], outfit.fabric_painter(TROUSERS, dust=0.8, seed=81, legs=True, oil=0.4))
    common.cloth_group(ctx, "plastic", [pc_m], mask_painter(), rough=0.45, ppm=900, spec=0.5)
    pcs = dict(under=pc_u, trousers=pc_t, mask=pc_m)
    add_gear(ctx, fit, pcs)
    ctx.report()
    print("tris", ctx.tri_count(), "time %.1f" % (time.time() - t0))
    return ctx


if __name__ == "__main__":
    ctx = build()
    ctx.save_final(charbuild.OUT_DIR + "/_qa/raider_c_wip.glb", split_by_label=True)

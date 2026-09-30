"""hero_driver: the player's driver - young woman, rust-orange leather bomber over a black tank, driving gloves, ponytail,
pilot goggles pushed up on the head, cargo pants and boots.  Seated through the cab windows."""
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
import mh
import outfit
import paintcloth as PC
import skinpaint as SP
import uvbake as U

NAME = "hero_driver"
SPEC = dict(macro=dict(gender=0.0, age=0.48, muscle=0.42, weight=0.28, height=0.5, race={"asian": 0.5, "caucasian": 0.5}),
            extra=[], height=1.70, skin="young_caucasian_female")

ORANGE = (0.36, 0.115, 0.03)
BLACK = (0.03, 0.03, 0.033)
PANTS = (0.075, 0.08, 0.075)


def emblem(bk, alb, h):
    """A ringed star on the upper back of the jacket (the crew's mark)."""
    fit = bk.fit
    x = bk.P[..., 0] - fit.cx
    y = bk.P[..., 1]
    back = bk.P[..., 2] > fit.torso_cz + 0.005
    cy = fit.sh_y - 0.155
    dx, dy = x, y - cy
    r = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)
    ring = (np.abs(r - 0.085) < 0.006) & back
    # five-point star
    k = 5
    star_r = 0.016 + 0.048 * np.abs(np.cos(2.5 * (ang - np.pi / 2))) ** 1.4
    star = (r < star_r) & back
    m = U.blur((ring | star).astype(np.float32), 0.8)
    alb = alb * (1 - m[..., None] * 0.9) + np.array([0.75, 0.62, 0.32], np.float32) * (m[..., None] * 0.9)
    h = h + m * 0.0006
    return alb, h


def jacket_painter():
    base = outfit.leather_painter(ORANGE, scuff_col=(0.50, 0.26, 0.10), dust=0.25, seed=7, wear=0.55)

    def paint(bk):
        alb, h = base(bk)
        alb, h = emblem(bk, alb, h)
        return alb, h
    return paint


def skin_texture(ctx, fit):
    ch = ctx.ch
    import body as B
    base = B.skin_image(ch.spec["skin"], 2048).astype(np.float32) / 255.0
    sb = SP.SkinBake(ch, fit, 2048)
    base = sb.fill_gutters(base)
    alb = SP.tone(base, mul=(0.86, 0.73, 0.60), gamma=1.0, sat=1.05)
    alb = SP.blend(alb, (0.38, 0.28, 0.20), SP.dirt(sb, 5, 0.22))
    alb = SP.freckles(alb, sb, ch, seed=3, amount=0.28)
    e = SP.face_box(ch)[0]
    # small scar on the chin and a thin neck tattoo (three short strokes below the ear)
    tat0 = np.array([e[0] + 0.05, e[1] - 0.13, e[2] + 0.05])
    P = sb.P
    for k in range(3):
        a = tat0 + np.array([0.0, -0.012 * k, 0.0])
        pts = np.array([a, a + np.array([0.012, -0.004, 0.02])])
        d = SP.line_mask_3d(P, pts, 0.002)
        alb = SP.ink(alb, 1.0 - U.smoothstep(0.0008, 0.0022, d), (0.10, 0.11, 0.15), 0.7)
    return np.clip(alb * 255 + 0.5, 0, 255).astype(np.uint8)


def add_gear(ctx, fit, pcs):
    ch = ctx.ch
    brc = gear.BodyRC(ch)
    binder = kit.Binder(ch)
    H = brc.landmarks()
    rc_j = outfit.rc_from_pieces([pcs["jacket"]])
    rc_p = outfit.rc_from_pieces([pcs["pants"]])
    knit = common.gear_material(ctx, "cloth_rib", "knit", color=BLACK, rough=0.95)
    zip_m = common.gear_material(ctx, "metal_dark", "metal_dark", color=(0.62, 0.6, 0.5), rough=1.0, metal=1.0)
    leather_dk = common.gear_material(ctx, "leather_dark", "leather", color=(0.10, 0.08, 0.07), rough=0.8, metal=0.0)
    leather_br = common.gear_material(ctx, "leather", "leather", color=(0.28, 0.16, 0.08), rough=0.8, metal=0.0)
    rubber = common.gear_material(ctx, "rubber", "rubber", color=(0.11, 0.11, 0.11), rough=1.0, metal=0.0)
    lace = common.gear_material(ctx, "webbing_lace", "webbing", color=(0.30, 0.28, 0.24), rough=0.9)
    canvas = common.gear_material(ctx, "cloth_canvas", "canvas", color=(0.075, 0.08, 0.075), rough=0.95)
    orange_patch = common.gear_material(ctx, "cloth_patch", "canvas", color=(0.7, 0.55, 0.2), rough=0.95)
    # boots (black)
    for side in ("Left", "Right"):
        b = gear.boots(ctx, brc, side, upper_off=0.010, detail=0.7, laces=False)
        boot_m = common.gear_material(ctx, "leather_boot", "leather", color=(0.055, 0.05, 0.05), rough=0.75, metal=0.0)
        common.add_gear(ctx, b["upper"], boot_m, binder, label="boot_upper")
        common.add_gear(ctx, b["shaft"], boot_m, binder, label="boot_shaft")
        for lm in b["laces"]:
            common.add_gear(ctx, lm, lace, binder, label="lace")
        ank = H[side + "Foot"][2]
        common.add_gear(ctx, b["sole"], rubber, binder, blend=(side + "Foot", side + "ToeBase", lambda P, a=ank: np.clip((P[:, 2] - a) / 0.15, 0, 1)), label="boot_sole")
    # jacket: collar, hem rib, cuffs, zipper, chest patch, epaulettes
    nk = H["Neck"]
    col = outfit.collar(ctx, brc, height=0.05, gap_deg=26.0, thick=0.010, out=0.02, flare=0.018)
    common.add_gear(ctx, col, knit, binder, label="collar")
    hem_y = fit.belt_y - 0.075
    hm = cloth.loop_band(pcs["g_jacket"], "lowest", height=0.055, thick=0.008, grow=0.006, n_max=48)
    if hm is not None:
        common.add_gear(ctx, kit.xform(hm, R=np.diag([-1.0, 1.0, -1.0])), knit, binder, label="hem_rib")
    for side in ("Left", "Right"):
        wr, el = H[side + "Hand"], H[side + "ForeArm"]
        u = (wr - el) / np.linalg.norm(wr - el)
        cf = outfit.cuff(pcs["jacket"], H, side, seg=16)
        if cf is not None:
            common.add_gear(ctx, cf, knit, binder, label="cuff")
    z = outfit.zipper(rc_j, fit.belt_y + 0.20, hem_y + 0.03, z_hint=0.9, width=0.012, thick=0.004)
    if z is not None:
        common.add_gear(ctx, z, zip_m, binder, label="zipper")
    # chest pockets / patch
    for sx in (1.0, -1.0):
        T, hp, hn = rc_j.cast(np.array([[sx * 0.10, fit.belt_y + 0.22, 0.9]]), np.array([[0, 0, -1.0]]), tmax=2.0)
        if np.isfinite(T[0]):
            pk = kit.patch_on_surface(rc_j, hp[0], hn[0], (0, 1, 0), 0.052, 0.036, standoff=0.002, thick=0.008, bevel=0.003, e=5.0, rings=3, seg=20)
            common.add_gear(ctx, pk, common.gear_material(ctx, "leather_jacket", "leather", color=ORANGE, rough=0.7, metal=0.0), binder, label="chest_pocket")
    # epaulettes
    for sx in (1.0, -1.0):
        arm = H["LeftArm" if sx > 0 else "RightArm"]
        T, hp, hn = rc_j.cast(np.array([[arm[0] - sx * 0.02, arm[1] + 0.3, arm[2]]]), np.array([[0, -1.0, 0]]), tmax=1.0)
        if np.isfinite(T[0]):
            ep = kit.patch_on_surface(rc_j, hp[0], hn[0], (0, 0, 1), 0.02, 0.055, standoff=0.003, thick=0.006, bevel=0.002, e=4.0, rings=2, seg=16)
            common.add_gear(ctx, ep, common.gear_material(ctx, "leather_jacket", "leather", color=ORANGE, rough=0.7, metal=0.0), binder, label="epaulette")
    # pilot goggles pushed up over the hairline: brass rims, brown leather strap
    gg = gear.goggles(ctx, brc, up=0.062, lens_r=0.027, spacing=0.036, tilt=14.0, seg=16, ring_n=32)
    strap_m = common.gear_material(ctx, "leather_strap", "leather", color=(0.20, 0.12, 0.07), rough=0.8, metal=0.0)
    rim_m = common.gear_material(ctx, "metal_rim", "metal_dark", color=(0.70, 0.52, 0.22), rough=1.0, metal=1.0)
    lens_m = common.plain_material(ctx, "glass_lens", (0.10, 0.28, 0.30), rough=0.05, alpha=0.7, double_sided=True)
    frame_m = common.gear_material(ctx, "leather_frame", "leather", color=(0.10, 0.07, 0.05), rough=0.8, metal=0.0)
    common.add_gear(ctx, gg["strap"], strap_m, binder, bone="Head", label="goggle_strap")
    for f in gg["frames"]:
        common.add_gear(ctx, f, frame_m, binder, bone="Head", label="goggle_frame")
    for f in gg["rims"]:
        common.add_gear(ctx, f, rim_m, binder, bone="Head", label="goggle_rim")
    for f in gg["lenses"]:
        common.add_gear(ctx, f, lens_m, binder, bone="Head", label="goggle_lens")
    common.add_gear(ctx, gg["bridge"], frame_m, binder, bone="Head", label="goggle_bridge")
    # driving gloves (full)
    glove_m = common.gear_material(ctx, "leather_glove", "leather", color=(0.05, 0.045, 0.045), rough=0.6, metal=0.0)
    for side in ("Left", "Right"):
        g = cloth.glove(fit, side, fingerless=False)
        if g.pos:
            common.add_tiled_piece(ctx, cloth.finish(g, fit), glove_m, label="glove")
    # trims
    for g_, m_, r_ in ((pcs["g_pants"], canvas, 0.006),):
        for tube in cloth.bindings(g_, radius=r_, min_len=0.14, sides=3, spacing=0.03):
            common.add_gear(ctx, kit.xform(tube, R=np.diag([-1.0, 1.0, -1.0])), m_, binder, label="trim")
    ctx.brc, ctx.binder = brc, binder


def build():
    t0 = time.time()
    ctx = charbuild.Ctx(NAME, SPEC)
    # the player trucks (truck_t1..t4): steering_wheel = seat_driver + (0, 0.30..0.40, 0.655..0.69), column tilt ~25 deg
    ctx.seat = dict(wheel_up=0.37, wheel_fwd=0.66)
    ch = ctx.ch
    import lod
    lod.decimate(ch, 0.40, lod.importance(ch, head=0.9, hands=0.45, torso=0.55, limbs=0.55, feet=0.0))
    fit = cloth.CFit(ch)
    ctx.fit = fit
    tank = cloth.torso_top(fit, "tank", off=0.012, bridge=0.02, hem=-0.03, neck=(-0.02, -0.02), drape=False, belt_blouse=0.0)
    pants = cloth.pants(fit, off=0.02, bridge=0.02)
    jacket = cloth.torso_top(fit, "sleeved", sleeve_len=fit.limb_len("L_arm", 2) - 0.02, off=0.018, bridge=0.008, hem=-0.10, open_front=0.075,
                             open_y=fit.belt_y + 0.20, neck=(-0.01, -0.01), neck_up=0.02, iters=40, arm_off_extra=0.004, drape=False)
    # keep the jacket clear of the tank underneath
    from scipy.spatial import cKDTree
    pc_tank = cloth.finish(tank, fit)
    tree = cKDTree(pc_tank["pos"])
    P = np.array(jacket.pos)
    for _ in range(3):
        d, i = tree.query(P)
        gap = np.einsum("ij,ij->i", P - pc_tank["pos"][i], pc_tank["nrm"][i])
        P = P + pc_tank["nrm"][i] * np.maximum(0.012 - gap, 0.0)[:, None]
    for k, p in enumerate(P):
        jacket.pos[k] = p
    gloveL, gloveR = cloth.glove(fit, "Left", fingerless=False), cloth.glove(fit, "Right", fingerless=False)
    pc_j = cloth.finish(jacket, fit)
    pc_p = cloth.finish(pants, fit)
    tris = common.cull_tris(ch, [tank.cover, pants.cover, jacket.cover, gloveL.cover, gloveR.cover],
                            hide_bones=("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"))
    common.add_skin(ctx, tris, skin_texture(ctx, fit))
    common.add_eyes(ctx, "brown")
    common.add_brows(ctx, (0.035, 0.028, 0.025), lashes=True)
    common.add_hair(ctx, "ponytail01", (0.075, 0.06, 0.055), lift=0.06, rough=0.75)
    common.cloth_group(ctx, "cloth_tank", [pc_tank], outfit.fabric_painter(BLACK, dust=0.25, seed=2, drape=0.0016))
    common.cloth_group(ctx, "cloth_pants", [pc_p], outfit.fabric_painter(PANTS, dust=0.5, seed=4, legs=True, folds_scale=0.55))
    ctx.detail_class = {**getattr(ctx, "detail_class", {}), "cloth_jacket": "leather"}
    common.cloth_group(ctx, "cloth_jacket", [pc_j], jacket_painter(), rough=0.7)
    pcs = dict(jacket=pc_j, pants=pc_p, tank=pc_tank, g_tank=tank, g_pants=pants, g_jacket=jacket)
    add_gear(ctx, fit, pcs)
    ctx.report()
    print("tris", ctx.tri_count(), "time %.1f" % (time.time() - t0))
    return ctx


if __name__ == "__main__":
    ctx = build()
    ctx.save_final(charbuild.OUT_DIR + "/_qa/hero_driver_wip.glb", split_by_label=True)

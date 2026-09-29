"""raider_d: hooded bomber - slim twitchy man, grey-green hoodie with the hood up, scarf over the lower face, dark bomber
jacket, improvised explosive vest (dynamite bundles, tape, wires, detonator with a red LED), a trigger in the right hand,
cargo pants, boots, gloves."""
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
import mh
import outfit
import paintcloth as PC
import raidergear as RG
import skinpaint as SP
import uvbake as U

NAME = "raider_d"
SPEC = dict(macro=dict(gender=1.0, age=0.40, muscle=0.42, weight=0.18, height=0.5, race={"african": 0.7, "asian": 0.3}),
            extra=[("neck/neck-scale-horiz-decr", 0.4)], height=1.75, skin="young_african_male")

HOODIE = (0.16, 0.18, 0.14)
JACKET = (0.06, 0.055, 0.05)
PANTS = (0.14, 0.12, 0.08)
SCARF = (0.30, 0.22, 0.13)


def skin_texture(ctx, fit):
    ch = ctx.ch
    import body as B
    base = B.skin_image(ch.spec["skin"], 1024).astype(np.float32) / 255.0
    sb = SP.SkinBake(ch, fit, 1024)
    base = sb.fill_gutters(base)
    alb = SP.tone(base, mul=(1.0, 0.96, 0.92), gamma=1.0)
    alb = SP.blend(alb, (0.20, 0.15, 0.11), SP.dirt(sb, 10, 0.6))
    # dark smudges around the eyes (soot)
    def paint(x, y, front):
        soot = (np.abs(y - 0.0) < 0.022) & (np.abs(x) < 0.07)
        yield soot.astype(np.float32) * (0.5 + 0.5 * U.fbm(x.shape, 20.0, 2, 3, wrap=False)), (0.05, 0.04, 0.035), 0.5
    alb = SP.face_bands(alb, sb, ch, paint)
    return np.clip(alb * 255 + 0.5, 0, 255).astype(np.uint8)


def push_clear(g, under_pc, gap=0.012):
    from scipy.spatial import cKDTree
    tree = cKDTree(under_pc["pos"])
    P = np.array(g.pos)
    for _ in range(3):
        d, i = tree.query(P)
        gp = np.einsum("ij,ij->i", P - under_pc["pos"][i], under_pc["nrm"][i])
        P = P + under_pc["nrm"][i] * np.maximum(gap - gp, 0.0)[:, None]
    for k, p in enumerate(P):
        g.pos[k] = p


def add_gear(ctx, fit, pcs):
    ch = ctx.ch
    brc = gear.BodyRC(ch)
    binder = kit.Binder(ch)
    H = brc.landmarks()
    rc_j = outfit.rc_from_pieces([pcs["jacket"], pcs["hoodie"]])
    rubber = common.gear_material(ctx, "rubber", "rubber", color=(0.09, 0.09, 0.09), rough=1.0, metal=0.0)
    tape = common.gear_material(ctx, "cloth_tape", "canvas", color=(0.05, 0.05, 0.05), rough=0.6)
    metal = common.gear_material(ctx, "metal_dark", "metal_dark", color=(0.35, 0.35, 0.33), rough=1.0, metal=1.0)
    dyn = ctx.material("plastic", color=(0.50, 0.07, 0.04, 1.0), rough=0.8, metallic=0.0, base_tex=ctx.glb.texture_array("dyn_tex", _dyn_tex(), "jpg", 88))
    led = ctx.material("light_tail", color=(1.0, 0.1, 0.05, 1.0), rough=0.3, emissive=(1.0, 0.08, 0.04), emissive_strength=4.0)
    wire_m = common.gear_material(ctx, "rubber_wire", "rubber", color=(1.0, 1.0, 1.0), rough=0.6, metal=0.0)
    webbing = common.gear_material(ctx, "webbing_black", "webbing", color=(0.06, 0.06, 0.05), rough=0.9)
    # boots
    boot_m = common.gear_material(ctx, "leather_boot", "leather", color=(0.10, 0.08, 0.06), rough=0.85, metal=0.0)
    for side in ("Left", "Right"):
        b = gear.boots(ctx, brc, side, upper_off=0.011, detail=0.45)
        common.add_gear(ctx, b["upper"], boot_m, binder, label="boot_upper")
        common.add_gear(ctx, b["shaft"], boot_m, binder, label="boot_shaft")
        ank = H[side + "Foot"][2]
        common.add_gear(ctx, b["sole"], rubber, binder, blend=(side + "Foot", side + "ToeBase", lambda P, a=ank: np.clip((P[:, 2] - a) / 0.15, 0, 1)), label="boot_sole")
    # dynamite bundles on the chest and belly: 2 x 2 bundles of three sticks, taped
    cy = fit.belt_y + 0.20
    tops = []
    for (x, y) in ((-0.075, cy + 0.02), (0.075, cy + 0.02), (-0.07, cy - 0.16), (0.07, cy - 0.16)):
        T, hp, hn = rc_j.cast(np.array([[x, y, 0.9]]), np.array([[0.0, 0.0, -1.0]]), tmax=2.0)
        if not np.isfinite(T[0]):
            continue
        n = hn[0]
        side_v = np.cross([0.0, 1.0, 0.0], n)
        side_v /= np.linalg.norm(side_v)
        L = 0.15
        sticks = []
        for k in (-1, 0, 1):
            c = hp[0] + n * (0.016 + 0.004 * (k == 0)) + side_v * k * 0.029
            p0, p1 = c - np.array([0, L / 2, 0]), c + np.array([0, L / 2, 0])
            sticks.append(kit.cylinder(p0, p1, 0.0145, seg=8, caps=(True, True), tile=0.1))
        common.add_gear(ctx, kit.merge(sticks), dyn, binder, label="dynamite")
        for yy in (-0.045, 0.045):
            c = hp[0] + n * 0.017 + np.array([0, yy, 0])
            bandm = kit.rbox((0.098, 0.022, 0.038), 0.0, 0)
            common.add_gear(ctx, kit.xform(bandm, R=kit.look_rot(n), t=c), tape, binder, label="tape")
        tops.append(hp[0] + n * 0.03 + np.array([0, L / 2 + 0.005, 0]))
        # fuses
        for k in (-1, 1):
            f0 = hp[0] + n * 0.017 + side_v * k * 0.029 + np.array([0, L / 2, 0])
            fz = kit.sweep(kit.polyline_smooth([f0, f0 + np.array([0, 0.02, 0.005]), f0 + np.array([k * 0.01, 0.035, 0.01])], 5), 0.0018, sides=3)
            fz["col"] = np.tile([0.45, 0.4, 0.3], (len(fz["pos"]), 1))
            common.add_gear(ctx, fz, wire_m, binder, label="fuse")
    # detonator box with a red LED at the centre of the chest
    T, hp, hn = rc_j.cast(np.array([[0.0, cy - 0.07, 0.9]]), np.array([[0.0, 0.0, -1.0]]), tmax=2.0)
    det = hp[0] + hn[0] * 0.03
    common.add_gear(ctx, kit.xform(kit.rbox((0.075, 0.055, 0.032), 0.005, 1), R=kit.look_rot(hn[0]), t=det), metal, binder, bone="Spine1", label="detonator")
    common.add_gear(ctx, kit.ellipsoid(det + hn[0] * 0.017 + np.array([0.02, 0.012, 0]), [0.006, 0.006, 0.004], seg=8, rings=5), led, binder, bone="Spine1", label="led")
    common.add_gear(ctx, kit.xform(kit.rbox((0.03, 0.012, 0.006), 0.002, 1), R=kit.look_rot(hn[0]), t=det + hn[0] * 0.017 + np.array([-0.012, -0.01, 0])), tape, binder, bone="Spine1", label="detonator")
    # wires from the detonator to every bundle (alternating red / black)
    for k, tp in enumerate(tops):
        mid = 0.5 * (det + tp) + hn[0] * 0.03
        w = kit.sweep(kit.polyline_smooth([det + hn[0] * 0.01, mid, tp], 7), 0.0025, sides=3)
        w["col"] = np.tile([0.55, 0.05, 0.03] if k % 2 == 0 else [0.05, 0.05, 0.05], (len(w["pos"]), 1))
        common.add_gear(ctx, w, wire_m, binder, label="wire")
    # vest straps around the torso holding the charges
    for y in (cy + 0.02, cy - 0.16):
        rr, dirs = kit.rings_along(brc.region("Spine", "Hips"), np.array([0.0, y - 0.018, H["Spine1"][2]]), np.array([0.0, y + 0.018, H["Spine1"][2]]), [0.0, 1.0],
                                   offset=0.052, n=28, r_out=0.32)
        inner = rr - dirs[None] * 0.005
        m = kit.loft(np.array([inner[0], rr[0], rr[1], inner[1]]), closed=True, tile=0.25, angle=60.0)
        common.add_gear(ctx, kit.orient_outward(m, np.array([0.0, y, H["Spine1"][2]]), 60.0), webbing, binder, label="vest_strap")
    # trigger wire from the detonator down the right arm into the right hand
    rc_arm = outfit.rc_from_pieces([pcs["jacket"]])
    wrR, elR, shR = H["RightHand"], H["RightForeArm"], H["RightArm"]
    ctrl = [det + np.array([-0.03, -0.02, 0.01]), np.array([-0.16, cy - 0.12, 0.08]), shR + (elR - shR) * 0.6 + np.array([0.0, -0.035, 0.03]),
            elR + (wrR - elR) * 0.5 + np.array([0.0, -0.035, 0.03]), wrR + np.array([0.0, -0.02, 0.02])]
    w = kit.sweep(kit.polyline_smooth(ctrl, 20), 0.0025, sides=3)
    w["col"] = np.tile([0.55, 0.05, 0.03], (len(w["pos"]), 1))
    common.add_gear(ctx, w, wire_m, binder, label="wire")
    # trigger (dead-man switch) in the right palm
    mid = H["RightHandMiddle1"]
    palm = 0.5 * (wrR + mid) + np.array([0.0, -0.022, 0.0])
    trig = kit.cylinder(palm + np.array([0.0, 0.0, -0.035]), palm + np.array([0.0, 0.0, 0.035]), 0.012, seg=8)
    common.add_gear(ctx, trig, metal, binder, bone="RightHand", label="trigger")
    common.add_gear(ctx, kit.cylinder(palm + np.array([0, 0, 0.035]), palm + np.array([0, 0, 0.048]), 0.007, seg=6), led, binder, bone="RightHand", label="trigger")
    # gloves
    glove_m = common.gear_material(ctx, "leather_glove", "leather", color=(0.06, 0.055, 0.05), rough=0.7, metal=0.0)
    for g_ in pcs["gloves"]:
        common.add_tiled_piece(ctx, cloth.finish(g_, fit), glove_m, label="glove")
    # jacket cuffs + hem band
    knit = common.gear_material(ctx, "cloth_rib", "knit", color=(0.05, 0.05, 0.05), rough=0.95)
    for side in ("Left", "Right"):
        cf = outfit.cuff(pcs["jacket"], H, side, grow=0.006, seg=12)
        if cf is not None:
            common.add_gear(ctx, cf, knit, binder, label="cuff")
    # rolled rim around the hood's face opening
    for tube in cloth.bindings(pcs["g_hood"], radius=0.009, min_len=0.2, sides=4, spacing=0.03):
        common.add_gear(ctx, kit.xform(tube, R=np.diag([-1.0, 1.0, -1.0])), ctx.mats["cloth_hoodie"], binder, bone="Head", label="hood_rim")
    ctx.brc, ctx.binder = brc, binder


def _dyn_tex(size=128):
    """Dynamite paper: bright band + printed text stripes (grey-scale detail over the red factor)."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    g = np.full((size, size), 0.95, np.float32)
    g -= 0.25 * ((np.abs(y - 0.5) < 0.12) & ((np.sin(x * 60) > 0.2) | (np.abs(y - 0.5) > 0.08)))
    g *= 0.9 + 0.1 * U.fbm((size, size), 8.0, 2, 3)
    return (np.clip(np.stack([g, g, g], -1), 0, 1) * 255).astype(np.uint8)


def build():
    t0 = time.time()
    ctx = charbuild.Ctx(NAME, SPEC)
    ch = ctx.ch
    lod.decimate(ch, 0.17, lod.importance(ch, head=0.45, hands=0.6, torso=0.35, limbs=0.3, feet=0.0))
    fit = cloth.CFit(ch)
    ctx.fit = fit
    hoodie = cloth.torso_top(fit, "sleeved", sleeve_len=fit.limb_len("L_arm", 2) - 0.03, off=0.016, bridge=0.02, hem=-0.08, neck=(-0.035, -0.03),
                             neck_up=0.03, drape=False, arm_off_extra=0.006)
    pc_h = cloth.finish(hoodie, fit)
    jacket = cloth.torso_top(fit, "sleeved", sleeve_len=fit.limb_len("L_arm", 2) - 0.05, off=0.026, bridge=0.01, hem=-0.07, open_front=0.07,
                             neck=(0.02, -0.02), drape=False, arm_off_extra=0.006)
    push_clear(jacket, pc_h, 0.010)
    pants = cloth.pants(fit, off=0.026, bridge=0.03)
    gloves = [cloth.glove(fit, s, fingerless=False) for s in ("Left", "Right")]

    def hood_keep(cent, nrm, hf):
        e = hf["eye"]
        face = (nrm[:, 2] < -0.15) & (np.abs(cent[:, 0] - e[0]) < 0.062) & (cent[:, 1] < e[1] + 0.05) & (cent[:, 1] > e[1] - 0.16)
        return ~face
    hood = cloth.head_shell(fit, hood_keep, off=0.022, bridge=0.02, iters=30, include_neck=True)
    # a peak: pull the hood's crown up and back a little
    hf = cloth.head_frame(fit)
    P = np.array(hood.pos)
    w = np.clip((P[:, 1] - (hf["top"] - 0.06)) / 0.06, 0, 1) * np.clip((P[:, 2] - hf["centre"][2]) / 0.08, 0, 1)
    P = P + w[:, None] ** 1.5 * np.array([0.0, 0.01, 0.035])
    # volume: loose over the back and crown, gathered toward the face opening
    c = hf["centre"]
    rad = P - c
    rad /= np.maximum(np.linalg.norm(rad, axis=1, keepdims=True), 1e-6)
    back = np.clip((P[:, 2] - (c[2] - 0.02)) / 0.1, 0, 1)
    crown = np.clip((P[:, 1] - c[1]) / 0.08, 0, 1)
    P = P + rad * (0.022 * back + 0.012 * crown)[:, None] * (P[:, 1] > hf["eye"][1] - 0.13)[:, None]
    for k, p in enumerate(P):
        hood.pos[k] = p

    def scarf_keep(cent, nrm, hf):
        e = hf["eye"]
        return (nrm[:, 2] < 0.2) & (cent[:, 1] < e[1] - 0.035) & (cent[:, 2] < hf["centre"][2] + 0.02)
    scarf = cloth.head_shell(fit, scarf_keep, off=0.012, bridge=0.012, iters=20, include_neck=True, ymin=hf["eye"][1] - 0.2)
    pc_j = cloth.finish(jacket, fit)
    pc_p = cloth.finish(pants, fit)
    pc_hd = cloth.finish(hood, fit)
    pc_s = cloth.finish(scarf, fit)
    tris = common.cull_tris(ch, [hoodie.cover, pants.cover, hood.cover] + [g.cover for g in gloves],
                            hide_bones=("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"))
    common.add_skin(ctx, tris, skin_texture(ctx, fit))
    common.add_eyes_lite(ctx, iris=(0.14, 0.08, 0.04))
    common.add_brows(ctx, (0.03, 0.025, 0.02), lashes=False)
    common.cloth_group(ctx, "cloth_hoodie", [pc_h, pc_hd], outfit.fabric_painter(HOODIE, dust=0.6, seed=91, arms=True, folds_scale=1.2))
    common.cloth_group(ctx, "cloth_jacket", [pc_j], outfit.leather_painter(JACKET, scuff_col=(0.2, 0.18, 0.15), dust=0.5, seed=95, wear=0.6), rough=0.7)
    common.cloth_group(ctx, "cloth_pants", [pc_p, pc_s], outfit.fabric_painter(PANTS, dust=0.7, seed=97, legs=True))
    pcs = dict(hoodie=pc_h, jacket=pc_j, g_jacket=jacket, pants=pc_p, gloves=gloves, g_hood=hood)
    add_gear(ctx, fit, pcs)
    ctx.report()
    print("tris", ctx.tri_count(), "time %.1f" % (time.time() - t0))
    return ctx


if __name__ == "__main__":
    ctx = build()
    ctx.save_final(charbuild.OUT_DIR + "/_qa/raider_d_wip.glb", split_by_label=True)

"""raider_a: bandana + goggles grunt - stocky sunburnt brute, faded red bandana (paint, tintable), round dark goggles, torn
leather vest over a bare chest, shotgun-shell bandolier, cargo pants, wrist wraps, fingerless gloves, chunky boots."""
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

VARIANT = 1
NAME = "raider_a"
SPEC = dict(macro=dict(gender=1.0, age=0.46, muscle=0.6, weight=0.6, height=0.5, race="caucasian"),
            extra=[("torso/torso-vshape-incr", 0.25), ("neck/neck-scale-horiz-incr", 0.5)],
            height=1.78, skin="middleage_caucasian_male")
SPEC2 = dict(macro=dict(gender=1.0, age=0.60, muscle=0.55, weight=0.72, height=0.5, race={"african": 0.8, "caucasian": 0.2}),
             extra=[("torso/torso-vshape-incr", 0.15), ("neck/neck-scale-horiz-incr", 0.5)], height=1.80, skin="middleage_african_male")

VEST = (0.34, 0.19, 0.10)
PANTS = (0.42, 0.36, 0.24)
BANDANA_TINT = (0.62, 0.10, 0.07)


def bandana_painter():
    def extra(bk, alb, h):
        P = bk.P
        k = 2 * np.pi / 0.013
        dots = (np.sin(P[..., 0] * k) * np.sin(P[..., 1] * k) * np.sin(P[..., 2] * k + 1.0) > 0.55).astype(np.float32)
        dots = U.blur(dots, 0.6)
        alb = alb * (1 - 0.18 * dots[..., None]) + 0.55 * dots[..., None] * np.array([0.9, 0.85, 0.8], np.float32) * 0.35
        return alb, h
    return outfit.fabric_painter((0.9, 0.9, 0.9), dust=0.6, dust_col=(0.55, 0.5, 0.42), seed=13, drape=0.0009, extra=extra, sweat=0.3)


def pants_extra(bk, alb, h):
    """A stitched knee patch on the left leg and a grease smear."""
    fit = bk.fit
    kn = fit.chains["L_leg"][1]
    d = np.hypot(bk.P[..., 0] - kn[0], bk.P[..., 1] - kn[1])
    front = bk.P[..., 2] < kn[2] + 0.01
    patch = ((np.abs(bk.P[..., 0] - kn[0]) < 0.055) & (np.abs(bk.P[..., 1] - kn[1]) < 0.065) & front & (bk.P[..., 0] < fit.cx)).astype(np.float32)
    edge = U.blur(patch, 1.0) - patch
    pc = np.array([0.20, 0.19, 0.12], np.float32) * (0.85 + 0.3 * U.fbm(patch.shape, 30.0, 2, 44))[..., None]
    alb = alb * (1 - patch[..., None]) + pc * patch[..., None]
    inner = U.blur(patch, 3.0)
    ring = np.clip((patch - inner) * 6.0, 0, 1) * patch
    dash = (np.sin((bk.P[..., 0] + bk.P[..., 1]) * 2 * np.pi / 0.008) > 0.2).astype(np.float32)
    alb *= (1 - 0.55 * ring * dash)[..., None]
    alb *= (1 - 0.35 * np.clip(edge * 4, 0, 1))[..., None]
    h = h + patch * 0.0012 - ring * dash * 0.0004
    return alb, h


def skin_texture(ctx, fit):
    ch = ctx.ch
    import body as B
    base = B.skin_image(ch.spec["skin"], 1024).astype(np.float32) / 255.0
    sb = SP.SkinBake(ch, fit, 1024)
    base = sb.fill_gutters(base)
    if VARIANT == 2:
        alb = SP.tone(base, mul=(0.92, 0.86, 0.80), gamma=1.0)
        alb = SP.blend(alb, (0.22, 0.17, 0.12), SP.dirt(sb, 6, 0.6))
        alb = SP.stubble(alb, sb, ch, seed=5, amount=1.7, colour=(0.035, 0.03, 0.028), cheeks=1.0)      # full short beard
        alb = SP.stubble(alb, sb, ch, seed=8, amount=0.5, colour=(0.45, 0.43, 0.40), cheeks=0.6, lip=0.3)  # grey in it
        e = mh.to_game(ch.body.mh_bone("eye.R")[0]) + ch.lift
        pts = np.array([e + [-0.012, 0.035, -0.02], e + [0.004, 0.0, -0.03], e + [0.02, -0.045, -0.025]])
        alb = SP.scar(alb, sb.P, pts, width=0.0026, colour=(0.42, 0.30, 0.26), strength=0.85)
    else:
        alb = SP.tone(base, mul=(0.86, 0.72, 0.60), gamma=1.05)
        alb = SP.sunburn(alb, sb, ch, amount=0.55)
        alb = SP.blend(alb, (0.25, 0.19, 0.13), SP.dirt(sb, 6, 0.7))
        alb = SP.stubble(alb, sb, ch, seed=4, amount=0.85, colour=(0.09, 0.07, 0.055), cheeks=0.7)
    # tattoos: tribal band right upper arm, blackwork sleeve left forearm/upper arm
    rsel = sb.bone_mask("RightArm") > 0.5
    a, s, r = SP.limb_uv(sb, "R_arm", (1.0, 0.0, 0.0), sel=rsel)
    alb = SP.ink(alb, SP.tribal_band(a, s, 0.06, 0.16, 0.05, 0.03, seed=5) * rsel, (0.06, 0.08, 0.1), 0.8)
    lsel = (sb.bone_mask("LeftArm", "LeftForeArm") > 0.4)
    a, s, r = SP.limb_uv(sb, "L_arm", (-1.0, 0.0, 0.0), sel=lsel)
    alb = SP.ink(alb, SP.flame_sleeve(a, s, 0.14, 0.40, seed=9) * lsel, (0.07, 0.09, 0.12), 0.8)
    # chest scars
    c = mh.to_game(ch.body.mh_bone("spine01")[0]) + ch.lift
    for k, dx in enumerate((-0.03, 0.02)):
        p0 = np.array([c[0] + dx - 0.05, c[1] + 0.02, c[2] - 0.15])
        p1 = np.array([c[0] + dx + 0.06, c[1] - 0.09, c[2] - 0.15])
        pts = np.array([p0, 0.5 * (p0 + p1), p1])
        alb = SP.scar(alb, sb.P, pts, width=0.0025, colour=(0.58, 0.4, 0.36), strength=0.7)
    return np.clip(alb * 255 + 0.5, 0, 255).astype(np.uint8)


def add_gear(ctx, fit, pcs, gl):
    ch = ctx.ch
    brc = gear.BodyRC(ch)
    binder = kit.Binder(ch)
    H = brc.landmarks()
    rc_v = outfit.rc_from_pieces([pcs["vest"]])
    rc_c = outfit.rc_from_pieces([pcs["vest"], pcs["pants"]])
    leather = common.gear_material(ctx, "leather", "leather", color=(0.20, 0.12, 0.07), rough=0.85, metal=0.0)
    leather_dk = common.gear_material(ctx, "leather_dark", "leather", color=(0.075, 0.06, 0.05), rough=0.85, metal=0.0)
    rubber = common.gear_material(ctx, "rubber", "rubber", color=(0.10, 0.10, 0.09), rough=1.0, metal=0.0)
    canvas = common.gear_material(ctx, "cloth_canvas", "canvas", color=(0.10, 0.09, 0.055), rough=0.95)
    tape = common.gear_material(ctx, "cloth_tape", "canvas", color=(0.33, 0.29, 0.20), rough=0.95)
    lace = common.gear_material(ctx, "webbing_lace", "webbing", color=(0.30, 0.27, 0.2), rough=0.9)
    metal = common.gear_material(ctx, "metal_dark", "metal_dark", color=(0.5, 0.5, 0.48), rough=1.0, metal=1.0)
    shell_m = common.gear_material(ctx, "plastic_shell", "plastic", color=(1, 1, 1), rough=0.55)
    black = common.gear_material(ctx, "webbing_black", "webbing", color=(0.05, 0.05, 0.05), rough=0.9)
    # boots
    boot_m = common.gear_material(ctx, "leather_boot", "leather", color=(0.11, 0.075, 0.05), rough=0.85, metal=0.0)
    for side in ("Left", "Right"):
        b = gear.boots(ctx, brc, side, upper_off=0.011, detail=0.45)
        common.add_gear(ctx, b["upper"], boot_m, binder, label="boot_upper")
        common.add_gear(ctx, b["shaft"], boot_m, binder, label="boot_shaft")
        ank = H[side + "Foot"][2]
        common.add_gear(ctx, b["sole"], rubber, binder, blend=(side + "Foot", side + "ToeBase", lambda P, a=ank: np.clip((P[:, 2] - a) / 0.15, 0, 1)), label="boot_sole")
    # belt with pouches
    bm, front, c, rings = gear.belt(ctx, brc, fit.belt_y - 0.005, detail=0.5)
    common.add_gear(ctx, bm, leather_dk, binder, label="belt")
    common.add_gear(ctx, kit.xform(kit.rbox((0.06, 0.05, 0.012), 0.003, 1), t=front + np.array([0, 0, 0.005])), metal, binder, bone="Hips", label="buckle")
    for sgn, size in ((-1.0, (0.10, 0.12, 0.055)), (1.0, (0.075, 0.09, 0.05)), (-0.55, (0.06, 0.08, 0.04))):
        th = np.radians(66.0 * sgn if abs(sgn) < 1 else 62.0 * sgn)
        o = np.array([np.sin(th) * 0.5, fit.belt_y - 0.04, c[2] + np.cos(th) * 0.5])
        T, hp, hn = rc_c.cast(o[None], -np.array([[np.sin(th), 0.0, np.cos(th)]]), tmax=0.8)
        if np.isfinite(T[0]):
            common.add_gear(ctx, gear.place(gear.pouch(size, detail=0.5), hp[0] + hn[0] * 0.004, hn[0]), canvas, binder, bone="Hips", label="pouch")
    # bandolier (right shoulder -> left hip)
    cy = fit.belt_y + 0.20
    ctrl = [[-0.10, fit.sh_y + 0.005, 0.0], [-0.075, cy + 0.06, 0.11], [0.02, cy - 0.05, 0.15], [0.14, fit.belt_y + 0.03, 0.10]]
    strap, shells = RG.bandolier(rc_v, ctrl)
    common.add_gear(ctx, strap, leather_dk, binder, label="bandolier")
    common.add_gear(ctx, shells, shell_m, binder, label="shells")
    # wrist wraps + fingerless gloves
    for side in ("Left", "Right"):
        rc_arm = brc.region(side + "ForeArm")
        el, wr = H[side + "ForeArm"], H[side + "Hand"]
        u = (wr - el) / np.linalg.norm(wr - el)
        wrap = gear.spiral_wrap(rc_arm, el + u * 0.10, wr - u * 0.02, turns=4.5, width=0.03, offset=0.003, thick=0.003, n=30,
                                phase=0.6 if side == "Left" else 2.4)
        common.add_gear(ctx, wrap, tape, binder, label="forearm_wrap")
    glove_m = common.gear_material(ctx, "leather_glove", "leather", color=(0.08, 0.065, 0.055), rough=0.7, metal=0.0)
    for g_ in gl:
        common.add_tiled_piece(ctx, cloth.finish(g_, fit), glove_m, label="glove")
    # goggles over the eyes (round dark lenses)
    if VARIANT == 2:      # pushed up on the bandana: the face shows
        gg = gear.goggles(ctx, brc, up=0.055, hair=0.012, lens_r=0.027, spacing=0.0335, tilt=10.0, seg=10, ring_n=18)
    else:
        gg = gear.goggles(ctx, brc, up=0.0, hair=0.004, lens_r=0.027, spacing=0.0335, tilt=-4.0, seg=10, ring_n=18)
    strap_m = common.gear_material(ctx, "webbing_strap", "webbing", color=(0.05, 0.05, 0.05), rough=0.9)
    lens_m = common.plain_material(ctx, "glass_lens", (0.95, 0.52, 0.06), rough=0.08, alpha=0.9, double_sided=True, emissive=(0.35, 0.16, 0.0))
    rim_m = common.gear_material(ctx, "metal_rim", "metal_dark", color=(0.42, 0.40, 0.36), rough=1.0, metal=1.0)
    frame_m = common.gear_material(ctx, "rubber_frame", "rubber", color=(0.06, 0.06, 0.06), rough=1.0, metal=0.0)
    common.add_gear(ctx, gg["strap"], strap_m, binder, bone="Head", label="goggle_strap")
    for f in gg["frames"]:
        common.add_gear(ctx, f, frame_m, binder, bone="Head", label="goggle_frame")
    for f in gg["rims"]:
        common.add_gear(ctx, f, rim_m, binder, bone="Head", label="goggle_rim")
    for f in gg["lenses"]:
        common.add_gear(ctx, f, lens_m, binder, bone="Head", label="goggle_lens")
    # bandana knot + tails at the back of the head (tinted `paint`)
    hi = gear.head_info(ctx, brc)
    knot_at = np.array([0.0, hi["eye_l"][1] + 0.005, hi["back"] - 0.004])
    bmat = ctx.mats["paint"]
    for k, m in enumerate(RG.bandana_tails(knot_at)):
        m["uv"] = m["uv"] * 0.5
        common.add_gear(ctx, m, bmat, binder, bone="Head", label="bandana_tail")
    # rolled trims
    for g_, m_, r_ in ((pcs["g_vest"], leather_dk, 0.0045),):
        for tube in cloth.bindings(g_, radius=r_, min_len=0.14, sides=3, spacing=0.045):
            common.add_gear(ctx, kit.xform(tube, R=np.diag([-1.0, 1.0, -1.0])), m_, binder, label="trim")
    # --- silhouette upgrades: scrap pauldron with spikes (left), machete across the back, knee pads
    armor = common.gear_material(ctx, "armor", "scrap", color=(0.60, 0.55, 0.50), rough=1.0, metal=1.0)
    spike_m = common.gear_material(ctx, "spike", "metal_dark", color=(0.70, 0.68, 0.64), rough=0.8, metal=1.0)
    menace.pauldron(ctx, brc, binder, "Left", dict(plate=armor, rivet=metal, strap=leather_dk, spike=spike_m), layers=3, spikes=3, size=1.0)
    grip_m = common.gear_material(ctx, "cloth_tape", "canvas", color=(0.33, 0.29, 0.20), rough=0.95)
    menace.machete_on_back(ctx, binder, H, dict(sheath=leather, grip=grip_m, metal=metal, strap=leather_dk), brc=brc, standoff=0.045, length=0.46)
    pad_m = common.gear_material(ctx, "plastic_pad", "plastic", color=(0.12, 0.12, 0.11), rough=0.7)
    menace.knee_pads(ctx, brc, binder, rc_c, dict(pad=pad_m, strap=black))
    ctx.brc, ctx.binder = brc, binder


def build(variant=1):
    global VARIANT
    VARIANT = variant
    t0 = time.time()
    ctx = charbuild.Ctx(NAME + ("2" if variant == 2 else ""), SPEC2 if variant == 2 else SPEC)
    ch = ctx.ch
    lod.decimate(ch, 0.19)
    fit = cloth.CFit(ch)
    ctx.fit = fit
    vest = cloth.torso_top(fit, "tank", off=0.020, bridge=0.03, hem=-0.03, open_front=0.085, strap=0.145, neck_half=0.07, neck=(-0.02, -0.03))
    pants = cloth.pants(fit, off=0.026, bridge=0.03)
    gl = [cloth.glove(fit, s, fingerless=True) for s in ("Left", "Right")]

    def bandana_keep(cent, nrm, hf):
        t = np.clip((cent[:, 2] - hf["front"]) / max(hf["back"] - hf["front"], 1e-6), 0, 1)
        cut_y = hf["eye"][1] + 0.052 - 0.10 * (t * t * (3 - 2 * t)) ** 1.2
        return cent[:, 1] > cut_y
    band = cloth.head_shell(fit, bandana_keep, off=0.006, bridge=0.003)
    scarf = menace.face_scarf_garment(fit, top=-0.028, off=0.011, point=0.075) if VARIANT == 1 else None
    pc_scarf = cloth.finish(scarf, fit) if scarf is not None else None
    pc_vest = cloth.finish(vest, fit)
    pc_pants = cloth.finish(pants, fit)
    pc_band = cloth.finish(band, fit)
    tris = common.cull_tris(ch, [vest.cover, pants.cover, band.cover] + ([scarf.cover] if scarf is not None else []) + [g.cover for g in gl],
                            hide_bones=("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"))
    common.add_skin(ctx, tris, skin_texture(ctx, fit))
    common.add_eyes_lite(ctx, iris=(0.20, 0.32, 0.36))
    common.add_brows(ctx, (0.07, 0.055, 0.045), lashes=False)
    emblem = lambda bk, alb, h: menace.paint_back_emblem(bk, alb, h, fit.belt_y + 0.30, "skull", 0.12, colour=(0.80, 0.76, 0.66))
    common.cloth_group(ctx, "cloth_vest", [pc_vest], outfit.leather_painter(VEST, scuff_col=(0.32, 0.2, 0.12), dust=0.5, seed=21, wear=0.8, extra=emblem),
                       rough=0.75)
    common.cloth_group(ctx, "cloth_pants", [pc_pants], outfit.fabric_painter(PANTS, dust=0.7, seed=31, legs=True, folds_scale=0.8, extra=pants_extra))
    common.cloth_group(ctx, "paint", [pc_band] + ([pc_scarf] if pc_scarf is not None else []), bandana_painter(), color=BANDANA_TINT + (1.0,), rough=0.9, ppm=420)
    pcs = dict(vest=pc_vest, pants=pc_pants, g_vest=vest, g_pants=pants)
    add_gear(ctx, fit, pcs, gl)
    ctx.report()
    print("tris", ctx.tri_count(), "time %.1f" % (time.time() - t0))
    return ctx


if __name__ == "__main__":
    ctx = build()
    ctx.save_final(charbuild.OUT_DIR + "/_qa/raider_a_wip.glb", split_by_label=True)

"""hero_gunner: the player's gunner - tan-skinned survivor, teal tank top, cargo pants, boots, fingerless gloves,
goggles on the forehead.  Armor tiers t1..t3 are separate hidden skinned nodes (see armor_gunner.py)."""
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake
import charbuild
import cloth
import common
import garments as G
import gear
import kit
import mh
import paintcloth as PC
import parts
import skinpaint as SP
import uvbake as U

NAME = "hero_gunner"
SPEC = dict(macro=dict(gender=1.0, age=0.52, muscle=0.62, weight=0.32, height=0.5, race={"african": 0.55, "caucasian": 0.45}),
            extra=[("torso/torso-vshape-incr", 0.35), ("neck/neck-scale-horiz-incr", 0.2)],
            height=1.82, skin="young_african_male")

TEAL = np.array([0.06, 0.40, 0.42], np.float32)
KHAKI = np.array([0.27, 0.26, 0.17], np.float32)


def paint_top(bk):
    """Teal ribbed tank top: grain, gathered folds at the hem, sweat and dust."""
    fit = bk.fit
    shape = bk.mask.shape
    alb = np.ones(shape + (3,), np.float32) * TEAL[None, None, :]
    alb *= (1.0 + PC.grain(shape, 3, 1.6, 0.05))[..., None]
    mott = U.fbm(shape, 200.0, 3, 5)
    alb *= (0.9 + 0.2 * mott)[..., None]
    h = PC.drape(bk, fit.belt_y - 0.02, amp=0.0019, width=0.024, length=0.18, gather=0.28, seed=2)
    h += PC.side_seams(bk, fit) + PC.edge_roll(bk, 0.014, 0.0011)
    # neck / armhole binding a shade darker
    band = 1.0 - U.smoothstep(0.010, 0.016, bk.hem)
    alb *= (1.0 - 0.18 * band)[..., None]
    # sweat: dark patch down the centre back and under the arms
    th = fit.theta(bk.P.reshape(-1, 3)).reshape(shape)
    back = np.exp(-(((np.abs(th) - np.pi) / 0.32) ** 2)) * U.smoothstep(fit.belt_y, fit.belt_y + 0.25, bk.Y) * (1 - U.smoothstep(fit.sh_y - 0.05, fit.sh_y + 0.02, bk.Y))
    alb *= (1.0 - 0.22 * back * (0.6 + 0.6 * mott))[..., None]
    dm, dc = PC.dust_layer(bk, 11, 0.55)
    alb = alb * (1 - dm[..., None]) + dc[None, None, :] * dm[..., None] * 0.95
    return alb, h


def paint_pants(bk):
    fit = bk.fit
    shape = bk.mask.shape
    alb = np.ones(shape + (3,), np.float32) * KHAKI[None, None, :]
    alb *= (1.0 + PC.grain(shape, 8, 1.8, 0.05))[..., None]
    mott = U.fbm(shape, 150.0, 3, 9)
    alb *= (0.88 + 0.24 * mott)[..., None]
    h = np.zeros(shape, np.float32)
    for key in ("L_leg", "R_leg"):
        kn = fit.limb_len(key, 1)
        h += PC.wrinkles(bk, fit, key, kn, 0.06, 0.0011, 0.09, 0.008, seed=3)
        h += PC.wrinkles(bk, fit, key, fit.limb_len(key, 2) - 0.02, 0.10, 0.0012, 0.10, 0.009, seed=4)
        h += PC.wrinkles(bk, fit, key, 0.07, 0.08, 0.0009, 0.08, 0.007, seed=5)
    h += PC.drape(bk, fit.ankle_y, amp=0.0012, width=0.03, length=0.2, gather=0.9, base=0.6, seed=6)
    h += PC.edge_roll(bk, 0.02, 0.0018)
    dm, dc = PC.dust_layer(bk, 21, 0.9, ground_col=(0.5, 0.4, 0.28))
    alb = alb * (1 - dm[..., None] * 0.9) + dc[None, None, :] * dm[..., None] * 0.9
    return alb, h


def build():
    t0 = time.time()
    ctx = charbuild.Ctx(NAME, SPEC)
    ch = ctx.ch
    if os.environ.get("LOD"):
        import lod
        lod.decimate(ch, float(os.environ["LOD"]))
    fit = cloth.CFit(ch)
    ctx.fit = fit
    # -- garments
    tank = cloth.torso_top(fit, "tank", off=0.014, bridge=0.04, hem=-0.02)
    pants = cloth.pants(fit, off=0.03, bridge=0.035)
    pc_top = cloth.finish(tank, fit)
    pc_pants = cloth.finish(pants, fit)
    # -- skin
    gloveL = cloth.glove(fit, "Left")
    gloveR = cloth.glove(fit, "Right")
    tris = common.cull_tris(ch, [tank.cover, pants.cover, gloveL.cover, gloveR.cover])
    skin_img = skin_texture(ctx, fit, tris)
    common.add_skin(ctx, tris, skin_img)
    common.add_eyes(ctx, "brown")
    common.add_hair(ctx, "short04", (0.16, 0.115, 0.085), lift=0.05, rough=0.9)
    # -- cloth
    common.cloth_group(ctx, "cloth_top", [pc_top], paint_top)
    common.cloth_group(ctx, "cloth_pants", [pc_pants], paint_pants)
    add_gear(ctx, fit)
    print("tris", ctx.tri_count(), "time %.1f" % (time.time() - t0))
    return ctx


def add_gear(ctx, fit):
    ch = ctx.ch
    brc = gear.BodyRC(ch)
    binder = kit.Binder(ch)
    leather = common.gear_material(ctx, "leather", "leather", color=(0.42, 0.26, 0.15), rough=0.8, metal=0.0, seed=2)
    rubber = common.gear_material(ctx, "rubber", "rubber", color=(0.16, 0.15, 0.14), rough=1.0, metal=0.0)
    glove_mat = common.gear_material(ctx, "leather_glove", "leather", color=(0.16, 0.12, 0.10), rough=0.7, metal=0.0, seed=3)
    # boots
    for side in ("Left", "Right"):
        b = gear.boots(ctx, brc, side)
        common.add_gear(ctx, b["upper"], leather, binder, label="boot_upper")
        common.add_gear(ctx, b["shaft"], leather, binder, label="boot_shaft")
        lace = common.gear_material(ctx, "webbing_lace", "webbing", color=(0.75, 0.7, 0.55), rough=0.9)
        for lm in b["laces"]:
            common.add_gear(ctx, lm, lace, binder, label="lace")
        common.add_gear(ctx, b["sole"], rubber, binder, bone=None, blend=(side + "Foot", side + "ToeBase", lambda P: np.clip((P[:, 2] - brc.landmarks()[side + "Foot"][2]) / 0.15, 0, 1)), label="boot_sole")
    # belt
    bm, front, c, rings = gear.belt(ctx, brc, ctx.fit.belt_y - 0.005)
    black = common.gear_material(ctx, "webbing_black", "webbing", color=(0.08, 0.08, 0.08), rough=0.9)
    common.add_gear(ctx, bm, black, binder, label="belt")
    steel = common.gear_material(ctx, "metal_dark", "metal_dark", color=(0.62, 0.62, 0.6), seed=4)
    buckle = kit.rbox((0.058, 0.044, 0.012), 0.003, 2)
    buckle = kit.xform(buckle, t=front + np.array([0, 0, 0.005]))
    common.add_gear(ctx, buckle, steel, binder, bone="Hips", label="buckle")
    # goggles on the forehead
    gg = gear.goggles(ctx, brc)
    strap_m = common.gear_material(ctx, "webbing_strap", "webbing", color=(0.06, 0.06, 0.06), rough=0.9)
    frame_m = common.gear_material(ctx, "rubber_frame", "rubber", color=(0.10, 0.10, 0.10), rough=1.0)
    rim_m = common.gear_material(ctx, "metal_rim", "metal_dark", color=(0.55, 0.42, 0.22), seed=6)
    lens_m = common.plain_material(ctx, "glass_lens", (0.95, 0.42, 0.06), rough=0.06, alpha=0.62, double_sided=True)
    common.add_gear(ctx, gg["strap"], strap_m, binder, bone="Head", label="goggle_strap")
    for f in gg["frames"]:
        common.add_gear(ctx, f, frame_m, binder, bone="Head", label="goggle_frame")
    for f in gg["rims"]:
        common.add_gear(ctx, f, rim_m, binder, bone="Head", label="goggle_rim")
    for f in gg["lenses"]:
        common.add_gear(ctx, f, lens_m, binder, bone="Head", label="goggle_lens")
    common.add_gear(ctx, gg["bridge"], frame_m, binder, bone="Head", label="goggle_bridge")
    # gloves
    for side in ("Left", "Right"):
        g = cloth.glove(ctx.fit, side, fingerless=True)
        if g.pos:
            pc = cloth.finish(g, ctx.fit)
            common.add_tiled_piece(ctx, pc, glove_mat, label="glove")


def skin_texture(ctx, fit, tris):
    ch = ctx.ch
    base = B_skin(ch)
    sb = SP.SkinBake(ch, fit, 2048)
    alb = base.astype(np.float32) / 255.0
    alb = SP.tone(alb, mul=(1.0, 0.98, 0.95), gamma=0.95)
    d = SP.dirt(sb, 4, 0.55)
    alb = SP.blend(alb, (0.30, 0.22, 0.15), d)
    return np.clip(alb * 255 + 0.5, 0, 255).astype(np.uint8)


def B_skin(ch):
    import body as B
    return B.skin_image(ch.spec["skin"], 2048)


if __name__ == "__main__":
    ctx = build()
    path = charbuild.OUT_DIR + "/_qa/hero_gunner_wip.glb"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print("bytes", ctx.save(path, split_by_label=True))

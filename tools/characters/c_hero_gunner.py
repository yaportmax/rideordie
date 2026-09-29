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
            height=1.83, skin="young_african_male")

TEAL = np.array([0.02, 0.20, 0.23], np.float32)
KHAKI = np.array([0.16, 0.15, 0.09], np.float32)


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
    band = 1.0 - U.smoothstep(0.010, 0.016, bk.hem)
    alb *= (1.0 - 0.18 * band)[..., None]
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


def eye_point(ch, side):
    return mh.to_game(ch.body.mh_bone("eye." + side)[0]) + ch.lift        # internal space


def face_point(ch, x, y):
    """Front-most face vertex near internal (x, y)."""
    P = ch.pos
    sel = np.isin(ch.top, [mh.BONE_INDEX["Head"]]) & (P[:, 2] < ch.sk["heads"]["Head"][2])
    d = (P[:, 0] - x) ** 2 + (P[:, 1] - y) ** 2
    d[~sel] = 1e9
    return P[np.argmin(d)]


def skin_texture(ctx, fit, tris):
    ch = ctx.ch
    import body as B
    base = B.skin_image(ch.spec["skin"], 2048).astype(np.float32) / 255.0
    sb = SP.SkinBake(ch, fit, 2048, tris=(ch.tv, ch.tt))
    alb = SP.tone(base, mul=(1.02, 1.0, 0.97), gamma=0.95)
    alb = SP.blend(alb, (0.30, 0.22, 0.15), SP.dirt(sb, 4, 0.5))
    # tattoos: tribal band on the right upper arm, blackwork sleeve fading down the left forearm
    arm_sel = ((sb.bone_mask("RightArm", "RightForeArm") > 0.5)).astype(np.float32)
    a, s, r = SP.limb_uv(sb, "R_arm", (1.0, 0.0, 0.0), sel=arm_sel > 0)
    m = SP.tribal_band(a, s, 0.075, 0.150, 0.045, 0.022, seed=3) * arm_sel
    alb = SP.ink(alb, m, (0.05, 0.06, 0.09), 0.8)
    farm = sb.bone_mask("LeftForeArm") > 0.4
    a, s, r = SP.limb_uv(sb, "L_arm", (-1.0, 0.0, 0.0), sel=farm)
    up = fit.limb_len("L_arm", 1)
    m = SP.flame_sleeve(a, s, up + 0.02, up + 0.22, seed=6) * farm
    alb = SP.ink(alb, m, (0.06, 0.07, 0.10), 0.75)
    # scar through the left eyebrow (internal space: left = -x)
    e = eye_point(ch, "L")
    p0 = face_point(ch, e[0] - 0.004, e[1] + 0.052)
    p1 = face_point(ch, e[0] + 0.006, e[1] + 0.022)
    p2 = face_point(ch, e[0] + 0.012, e[1] - 0.008)
    alb = SP.scar(alb, sb.P, np.array([p0, p1, p2]), width=0.0022, colour=(0.55, 0.36, 0.33), strength=0.85)
    return np.clip(alb * 255 + 0.5, 0, 255).astype(np.uint8)


def cloth_rc(ctx, pcs):
    pos = np.concatenate([mh.to_final(p["pos"]) for p in pcs])
    idx, base = [], 0
    for p in pcs:
        idx.append(p["idx"].reshape(-1, 3) + base)
        base += len(p["pos"])
    return kit.Raycaster(pos, np.concatenate(idx))


def add_gear(ctx, fit, pc_top, pc_pants):
    ch = ctx.ch
    brc = gear.BodyRC(ch)
    binder = kit.Binder(ch)
    H = brc.landmarks()
    rc_cloth = cloth_rc(ctx, [pc_top, pc_pants])
    rc_pants = cloth_rc(ctx, [pc_pants])
    leather = common.gear_material(ctx, "leather", "leather", color=(0.30, 0.18, 0.10), rough=0.85, metal=0.0, seed=2)
    leather_dk = common.gear_material(ctx, "leather_dark", "leather", color=(0.11, 0.09, 0.08), rough=0.8, metal=0.0, seed=3)
    rubber = common.gear_material(ctx, "rubber", "rubber", color=(0.13, 0.12, 0.11), rough=1.0, metal=0.0)
    canvas = common.gear_material(ctx, "cloth_canvas", "canvas", color=(0.20, 0.19, 0.12), rough=0.95, metal=0.0)
    tape = common.gear_material(ctx, "cloth_tape", "canvas", color=(0.50, 0.44, 0.30), rough=0.95, metal=0.0, seed=4)
    lace = common.gear_material(ctx, "webbing_lace", "webbing", color=(0.55, 0.5, 0.36), rough=0.9)
    black = common.gear_material(ctx, "webbing_black", "webbing", color=(0.05, 0.05, 0.05), rough=0.9)
    steel = common.gear_material(ctx, "metal_dark", "metal_dark", color=(0.55, 0.55, 0.53), seed=4)
    # boots
    for side in ("Left", "Right"):
        b = gear.boots(ctx, brc, side)
        common.add_gear(ctx, b["upper"], leather, binder, label="boot_upper")
        common.add_gear(ctx, b["shaft"], leather, binder, label="boot_shaft")
        for lm in b["laces"]:
            common.add_gear(ctx, lm, lace, binder, label="lace")
        ank = H[side + "Foot"][2]
        common.add_gear(ctx, b["sole"], rubber, binder, blend=(side + "Foot", side + "ToeBase", lambda P, a=ank: np.clip((P[:, 2] - a) / 0.15, 0, 1)), label="boot_sole")
    # belt, buckle, pouches
    bm, front, c, rings = gear.belt(ctx, brc, ctx.fit.belt_y - 0.005)
    common.add_gear(ctx, bm, black, binder, label="belt")
    buckle = kit.xform(kit.rbox((0.058, 0.044, 0.012), 0.003, 1), t=front + np.array([0, 0, 0.005]))
    common.add_gear(ctx, buckle, steel, binder, bone="Hips", label="buckle")
    y_belt = ctx.fit.belt_y
    for sgn, size in ((-1.0, (0.10, 0.12, 0.055)), (1.0, (0.07, 0.09, 0.05))):
        th = np.radians(62.0) * sgn
        o = np.array([np.sin(th) * 0.5, y_belt - 0.04, c[2] + np.cos(th) * 0.5])
        T, hp, hn = rc_cloth.cast(o[None], -np.array([[np.sin(th), 0.0, np.cos(th)]]), tmax=0.8)
        if np.isfinite(T[0]):
            pm = gear.place(gear.pouch(size), hp[0] + hn[0] * 0.004, hn[0])
            common.add_gear(ctx, pm, canvas, binder, bone="Hips", label="pouch")
    # cargo pockets + knee pads
    for sgn in (1.0, -1.0):
        hip = H["LeftUpLeg" if sgn > 0 else "RightUpLeg"]
        knee = H["LeftLeg" if sgn > 0 else "RightLeg"]
        y = 0.5 * (hip[1] + knee[1]) - 0.02
        o = np.array([[sgn * 0.6, y, 0.5 * (hip[2] + knee[2])]])
        T, hp, hn = rc_pants.cast(o, np.array([[-sgn, 0.0, 0.0]]), tmax=1.0)
        if np.isfinite(T[0]):
            pk = kit.patch_on_surface(rc_pants, hp[0], hn[0], (0, 1, 0), 0.068, 0.09, standoff=0.002, thick=0.014, bevel=0.005, e=5.0, rings=4, seg=24, dome=0.004)
            fl = kit.patch_on_surface(rc_pants, hp[0] + np.array([0, 0.058, 0]), hn[0], (0, 1, 0), 0.070, 0.032, standoff=0.012, thick=0.006, bevel=0.003, e=5.0, rings=3, seg=24)
            common.add_gear(ctx, pk, canvas, binder, label="cargo_pocket")
            common.add_gear(ctx, fl, canvas, binder, label="cargo_flap")
        o = np.array([[knee[0], knee[1] + 0.01, 0.6]])
        T, hp, hn = rc_pants.cast(o, np.array([[0.0, 0.0, -1.0]]), tmax=1.0)
        if np.isfinite(T[0]):
            kp = gear.knee_pad(rc_pants, hp[0], hn[0])
            common.add_gear(ctx, kp, leather_dk, binder, label="knee_pad")
    # forearm wraps
    for side in ("Left", "Right"):
        rc_arm = brc.region(side + "ForeArm")
        el, wr = H[side + "ForeArm"], H[side + "Hand"]
        u = (wr - el) / np.linalg.norm(wr - el)
        wrap = gear.spiral_wrap(rc_arm, el + u * 0.06, wr - u * 0.03, turns=5.5, width=0.026, offset=0.003, thick=0.003,
                                phase=0.6 if side == "Left" else 2.4)
        common.add_gear(ctx, wrap, tape, binder, label="forearm_wrap")
    # goggles on the forehead
    gg = gear.goggles(ctx, brc)
    strap_m = common.gear_material(ctx, "webbing_strap", "webbing", color=(0.05, 0.05, 0.05), rough=0.9)
    frame_m = common.gear_material(ctx, "rubber_frame", "rubber", color=(0.08, 0.08, 0.08), rough=1.0)
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
    # rolled trim along the free edges of the tank top and the trousers
    trim_top = common.gear_material(ctx, "cloth_trim_top", "knit", color=tuple(TEAL * 0.9), rough=0.95)
    trim_pants = common.gear_material(ctx, "cloth_trim_pants", "canvas", color=tuple(KHAKI * 0.95), rough=0.95)
    for g_, nm in ctx.trims:
        for tube in cloth.bindings(g_, radius=0.0055 if nm == "top" else 0.0065, min_len=0.14):
            common.add_gear(ctx, kit.xform(tube, R=np.diag([-1.0, 1.0, -1.0])), trim_top if nm == "top" else trim_pants, binder, label="trim_" + nm)
    # gloves
    glove_mat = common.gear_material(ctx, "leather_glove", "leather", color=(0.10, 0.08, 0.07), rough=0.7, metal=0.0, seed=3)
    for side in ("Left", "Right"):
        g = cloth.glove(ctx.fit, side, fingerless=True)
        if g.pos:
            common.add_tiled_piece(ctx, cloth.finish(g, ctx.fit), glove_mat, label="glove")
    ctx.brc, ctx.binder, ctx.rc_cloth = brc, binder, rc_cloth


def build(lod_ratio=None):
    t0 = time.time()
    ctx = charbuild.Ctx(NAME, SPEC)
    ch = ctx.ch
    import lod
    # hero: head/torso/limbs untouched, hands moderately reduced (gloves), feet (inside boots) collapsed
    lod.decimate(ch, lod_ratio or 0.70, lod.importance(ch, head=1.0, hands=0.55, torso=1.0, limbs=1.0, feet=0.0))
    fit = cloth.CFit(ch)
    ctx.fit = fit
    tank = cloth.torso_top(fit, "tank", off=0.014, bridge=0.04, hem=-0.02)
    pants = cloth.pants(fit, off=0.03, bridge=0.035)
    gloveL, gloveR = cloth.glove(fit, "Left"), cloth.glove(fit, "Right")
    pc_top = cloth.finish(tank, fit)
    pc_pants = cloth.finish(pants, fit)
    ctx.trims = [(tank, "top"), (pants, "pants")]
    tris = common.cull_tris(ch, [tank.cover, pants.cover, gloveL.cover, gloveR.cover],
                            hide_bones=("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"))
    common.add_skin(ctx, tris, skin_texture(ctx, fit, tris))
    common.add_eyes(ctx, "brown")
    common.add_brows(ctx, (0.05, 0.04, 0.035), lashes=True)
    common.add_hair(ctx, "short04", (0.16, 0.115, 0.085), lift=0.05, rough=0.9)
    common.cloth_group(ctx, "cloth_top", [pc_top], paint_top)
    common.cloth_group(ctx, "cloth_pants", [pc_pants], paint_pants)
    add_gear(ctx, fit, pc_top, pc_pants)
    ctx.pcs = dict(top=pc_top, pants=pc_pants)
    print("base tris", ctx.tri_count(), "time %.1f" % (time.time() - t0))
    return ctx


def build_full():
    import armor_gunner
    ctx = build()
    for fn in (armor_gunner.build_t1, armor_gunner.build_t2, armor_gunner.build_t3):
        t0 = time.time()
        fn(ctx)
        print(fn.__name__, "tris", ctx.tri_count(ctx.tier_group), "%.1fs" % (time.time() - t0))
    return ctx


if __name__ == "__main__":
    ctx = build_full()
    ctx.save_final(charbuild.OUT_DIR + "/_qa/hero_gunner_full.glb", hidden_groups=("armor_t1", "armor_t2", "armor_t3"))

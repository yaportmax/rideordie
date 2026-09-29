"""raider_b: mohawk punk - lean wiry, tall orange-red mohawk over shaved sides, black studded sleeveless leather vest over a
bare tattooed chest, layered leather pauldrons with long spikes, spiked bracers, chains, torn dark jeans, boots,
black eye band + white skull jaw face paint, piercings."""
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

NAME = "raider_b"
SPEC = dict(macro=dict(gender=1.0, age=0.40, muscle=0.58, weight=0.12, height=0.5, race={"caucasian": 0.6, "asian": 0.4}),
            extra=[("neck/neck-scale-horiz-decr", 0.3), ("cheek/l-cheek-bones-incr", 0.6), ("cheek/r-cheek-bones-incr", 0.6)],
            height=1.80, skin="young_asian_male")

VEST = (0.035, 0.032, 0.03)
JEANS = (0.07, 0.085, 0.11)


def jeans_extra(bk, alb, h):
    """Torn knees: pale frayed threads over a dark gap, faded thighs."""
    fit = bk.fit
    for key, side in (("L_leg", -1), ("R_leg", 1)):
        kn = fit.chains[key][1]
        front = bk.P[..., 2] < kn[2] + 0.0
        dx = bk.P[..., 0] - kn[0]
        dy = bk.P[..., 1] - (kn[1] + (0.02 if side < 0 else -0.03))
        hole = ((np.abs(dx) < 0.05) & (np.abs(dy) < 0.022 + 0.006 * np.sin(dx * 180)) & front).astype(np.float32)
        threads = (np.sin(bk.P[..., 1] * 2 * np.pi / 0.004) > 0.2).astype(np.float32)
        alb = alb * (1 - hole[..., None]) + (np.array([0.62, 0.60, 0.55], np.float32) * threads[..., None] * 0.9 + np.array([0.08, 0.06, 0.05], np.float32) * (1 - threads[..., None])) * hole[..., None]
        fray = U.blur(hole, 2.0) * (1 - hole)
        alb = alb * (1 - 0.5 * fray[..., None]) + np.array([0.5, 0.52, 0.55], np.float32) * 0.5 * fray[..., None]
    fade = U.smoothstep(0.35, 0.7, U.fbm(bk.mask.shape, 120.0, 3, 77)) * 0.35
    alb = alb * (1 - fade[..., None]) + np.array([0.24, 0.28, 0.34], np.float32) * fade[..., None]
    return alb, h


def skin_texture(ctx, fit):
    ch = ctx.ch
    import body as B
    base = B.skin_image(ch.spec["skin"], 1024).astype(np.float32) / 255.0
    sb = SP.SkinBake(ch, fit, 1024)
    base = sb.fill_gutters(base)
    alb = SP.tone(base, mul=(0.93, 0.84, 0.74), gamma=1.0)
    alb = SP.blend(alb, (0.28, 0.21, 0.15), SP.dirt(sb, 8, 0.6))
    # shaved sides: dark stubble over the scalp (not the face)
    c, half = SP._face_frame(ch)
    scalp = (sb.G["Head"] > 0.5) & (sb.P[..., 1] > c[1] + 0.035) | ((sb.G["Head"] > 0.5) & (sb.N[..., 2] > 0.2) & (sb.P[..., 1] > c[1] - 0.05))
    n = U.fbm(sb.mask.shape, 1.6, 2, 12, wrap=False)
    m = U.blur(scalp.astype(np.float32), 3.0) * (0.55 + 0.35 * U.smoothstep(0.4, 0.6, n))
    alb = SP.blend(alb, (0.06, 0.05, 0.045), np.clip(m, 0, 0.8))
    alb = SP.stubble(alb, sb, ch, seed=4, amount=0.45, colour=(0.07, 0.055, 0.045), cheeks=0.3)

    def paint(x, y, front):
        eye_band = (np.abs(y - 0.004) < 0.019 + 0.004 * np.cos(x * 60)) & (np.abs(x) < 0.064 - 0.01 * np.abs(y) / 0.02)
        yield eye_band.astype(np.float32), (0.02, 0.02, 0.022), 0.95
        # skull jaw: pale band over the chin/jaw with dark vertical 'teeth' lines across the lips
        jaw = (y < -0.060) & (y > -0.125) & (np.abs(x) < 0.058)
        yield jaw.astype(np.float32), (0.70, 0.68, 0.62), 0.6
        teeth = jaw & (np.abs(y + 0.078) < 0.012) & (np.abs(((x + 0.004) / 0.0085) % 1.0 - 0.5) < 0.12)
        yield teeth.astype(np.float32), (0.03, 0.03, 0.03), 0.9
    alb = SP.face_bands(alb, sb, ch, paint)
    # tattoos: blackwork across the chest and both upper arms
    for key, sub, d in (("L_arm", "LeftArm", (-1.0, 0, 0)), ("R_arm", "RightArm", (1.0, 0, 0))):
        sel = sb.bone_mask(sub) > 0.45
        a, s, r = SP.limb_uv(sb, key, d, sel=sel)
        alb = SP.ink(alb, SP.flame_sleeve(a, s, 0.03, 0.24, seed=len(key) + ord(sub[0])) * sel, (0.05, 0.06, 0.08), 0.85)
    return np.clip(alb * 255 + 0.5, 0, 255).astype(np.uint8)


def add_gear(ctx, fit, pcs):
    ch = ctx.ch
    brc = gear.BodyRC(ch)
    binder = kit.Binder(ch)
    H = brc.landmarks()
    hi = gear.head_info(ctx, brc)
    leather = common.gear_material(ctx, "leather", "leather", color=(0.06, 0.055, 0.05), rough=0.7, metal=0.0)
    leather_br = common.gear_material(ctx, "leather_brown", "leather", color=(0.16, 0.09, 0.05), rough=0.8, metal=0.0)
    rubber = common.gear_material(ctx, "rubber", "rubber", color=(0.09, 0.09, 0.09), rough=1.0, metal=0.0)
    spike_m = common.gear_material(ctx, "spike", "metal_dark", color=(0.75, 0.74, 0.70), rough=0.6, metal=1.0)
    metal = common.gear_material(ctx, "metal_dark", "metal_dark", color=(0.45, 0.45, 0.43), rough=1.0, metal=1.0)
    # mohawk
    tex = RG.strand_texture((0.30, 0.05, 0.02), (1.0, 0.42, 0.06))
    hair_m = ctx.material("hair", base_tex=ctx.glb.texture_array("hair_mohawk", tex, "jpg", 88), rough=0.7, spec=0.4)
    mo = RG.mohawk(brc.head(), hi, count=12, height=(0.08, 0.17), base_len=0.058, base_w=0.026, up_bias=0.55)
    common.add_gear(ctx, mo, hair_m, binder, bone="Head", label="hair")
    # boots
    boot_m = common.gear_material(ctx, "leather_boot", "leather", color=(0.05, 0.045, 0.045), rough=0.7, metal=0.0)
    for side in ("Left", "Right"):
        b = gear.boots(ctx, brc, side, upper_off=0.010, shaft_len=0.26, detail=0.45)
        common.add_gear(ctx, b["upper"], boot_m, binder, label="boot_upper")
        common.add_gear(ctx, b["shaft"], boot_m, binder, label="boot_shaft")
        ank = H[side + "Foot"][2]
        common.add_gear(ctx, b["sole"], rubber, binder, blend=(side + "Foot", side + "ToeBase", lambda P, a=ank: np.clip((P[:, 2] - a) / 0.15, 0, 1)), label="boot_sole")
    # belt
    bm, front, c, rings = gear.belt(ctx, brc, fit.belt_y - 0.012, detail=0.5)
    common.add_gear(ctx, bm, leather, binder, label="belt")
    common.add_gear(ctx, kit.xform(kit.rbox((0.07, 0.05, 0.012), 0.003, 1), t=front + np.array([0, 0, 0.005])), spike_m, binder, bone="Hips", label="buckle")
    # studs along the vest edges
    pv = pcs["vest"]
    pts, nrms = RG.edge_points(pcs["g_vest"], mh.to_final(pv["pos"]), mh.to_final(pv["nrm"]), spacing=0.068)
    st = RG.studs(pts - nrms * 0.001, nrms, r=0.0065, h=0.007, seg=4)
    if st is not None:
        common.add_gear(ctx, st, spike_m, binder, label="studs")
    # layered leather pauldrons with spike clusters
    rc_sh = brc.region("LeftArm", "LeftShoulder", "RightArm", "RightShoulder")
    for side in ("Left", "Right"):
        sg = 1.0 if side == "Left" else -1.0
        arm = H[side + "Arm"]
        fore = H[side + "ForeArm"]
        axis = (fore - arm) / np.linalg.norm(fore - arm)
        for k in range(2):
            cpos = arm + np.array([sg * 0.015, 0.05, 0.0]) + axis * (0.05 * k) - np.array([0, 0.03 * k, 0])
            n = np.array([sg * (0.5 + 0.35 * k), 0.85 - 0.4 * k, 0.0])
            n /= np.linalg.norm(n)
            P, hn = gear.surface_pts(rc_sh, cpos[None])
            pm = kit.patch_on_surface(rc_sh, P[0], n, (0, 0, 1), 0.085 + 0.01 * k, 0.10 + 0.008 * k, standoff=0.012 + 0.014 * k, thick=0.012,
                                      bevel=0.004, e=3.0, rings=3, seg=18, dome=0.02, cast_from=0.3)
            common.add_gear(ctx, pm, leather if k == 0 else leather_br, binder, label="pauldron")
        top = arm + np.array([sg * 0.06, 0.105, 0.0])
        sc = RG.spike_cluster(top, [sg * 0.45, 0.9, 0.0], count=5, length=0.13, r=0.013, spread=0.55, seed=3 if sg > 0 else 5)
        common.add_gear(ctx, sc, spike_m, binder, bone=side + "Arm", label="spikes")
        # strap across the chest holding the pauldron
    # spiked bracers
    bodyF = mh.to_final(ch.full["pos"] if hasattr(ch, "full") else ch.pos)
    for side in ("Left", "Right"):
        band, spk = RG.bracer(bodyF, H, side, from_wrist=0.035, length=0.10, grow=0.011, seg=16, spikes=3)
        common.add_gear(ctx, band, leather, binder, bone=side + "ForeArm", label="bracer")
        common.add_gear(ctx, spk, spike_m, binder, bone=side + "ForeArm", label="bracer_spikes")
    # chains: hanging from the belt at the right hip and a loop across the vest front
    ch1 = RG.chain([front + np.array([-0.06, -0.01, 0.01]), front + np.array([-0.10, -0.10, 0.03]), front + np.array([-0.17, -0.02, -0.02])], link_len=0.034)
    common.add_gear(ctx, ch1, metal, binder, bone="Hips", label="chain")
    # piercings: nose ring + ear studs
    P = brc.P
    head = np.isin(brc.top, [mh.BONE_INDEX["Head"]])
    ey = hi["eye_l"][1]
    sel = head & (np.abs(P[:, 0]) < 0.006) & (P[:, 1] < ey - 0.035) & (P[:, 1] > ey - 0.06)
    if sel.any():
        tip = P[sel][np.argmax(P[sel][:, 2])]
        a = np.linspace(0, 2 * np.pi, 10, endpoint=False)
        ring = tip + np.array([0.0, -0.004, -0.004]) + np.cos(a)[:, None] * np.array([0.0, 0.0, 0.0065]) + np.sin(a)[:, None] * np.array([0.0, 0.0065, 0.0])
        common.add_gear(ctx, cloth.closed_tube(ring, 0.0011, 4), spike_m, binder, bone="Head", label="piercing")
    for sgn in (1.0, -1.0):
        sel = head & (P[:, 0] * sgn > 0) & (np.abs(P[:, 1] - (ey - 0.03)) < 0.01)
        if sel.any():
            e = P[sel][np.argmax(np.abs(P[sel][:, 0]))]
            for dy in (0.0, 0.012):
                common.add_gear(ctx, kit.ellipsoid(e + np.array([sgn * 0.002, dy, 0]), [0.003, 0.003, 0.003], seg=4, rings=3), spike_m, binder, bone="Head", label="piercing")
    # --- silhouette upgrades: spiked collar, spiked knee guards
    menace.spiked_collar(ctx, brc, binder, dict(leather=leather, spike=spike_m), spikes=9)
    rc_j = outfit.rc_from_pieces([pcs["jeans"]])
    menace.knee_pads(ctx, brc, binder, rc_j, dict(pad=leather, strap=leather), size=0.9)
    for side in ("Left", "Right"):
        kn = H[side + "Leg"]
        T, hp, hn = rc_j.cast((kn + np.array([0.0, 0.01, 0.35]))[None], np.array([[0.0, 0.0, -1.0]]), tmax=0.7)
        if np.isfinite(T[0]):
            base = hp[0] + hn[0] * 0.028
            common.add_gear(ctx, gear.spike(base, hn[0] + np.array([0, 0.25, 0]), 0.055, 0.011, seg=7), spike_m, binder, bone=side + "Leg", label="spikes")
    ctx.brc, ctx.binder = brc, binder


def build():
    t0 = time.time()
    ctx = charbuild.Ctx(NAME, SPEC)
    ch = ctx.ch
    lod.decimate(ch, 0.17)
    fit = cloth.CFit(ch)
    ctx.fit = fit
    vest = cloth.torso_top(fit, "tank", off=0.016, bridge=0.02, hem=-0.01, open_front=0.11, open_y=fit.belt_y - 0.02, strap=0.15,
                           neck_half=0.075, neck=(0.0, -0.02), drape=False)
    jeans = cloth.pants(fit, off=0.016, bridge=0.02)
    pc_v = cloth.finish(vest, fit)
    pc_j = cloth.finish(jeans, fit)
    tris = common.cull_tris(ch, [vest.cover, jeans.cover], hide_bones=("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"))
    common.add_skin(ctx, tris, skin_texture(ctx, fit))
    common.add_eyes_lite(ctx, iris=(0.16, 0.10, 0.05))
    common.add_brows(ctx, (0.05, 0.04, 0.035), lashes=False)
    emblem = lambda bk, alb, h: menace.paint_back_emblem(bk, alb, h, fit.belt_y + 0.28, "tally", 0.16, colour=(0.62, 0.08, 0.05), seed=5)
    common.cloth_group(ctx, "cloth_vest", [pc_v], outfit.leather_painter(VEST, scuff_col=(0.22, 0.2, 0.18), dust=0.45, seed=51, wear=0.7, extra=emblem),
                       rough=0.6)
    common.cloth_group(ctx, "cloth_jeans", [pc_j], outfit.fabric_painter(JEANS, dust=0.6, seed=61, legs=True, folds_scale=0.7, extra=jeans_extra))
    pcs = dict(vest=pc_v, jeans=pc_j, g_vest=vest, g_jeans=jeans)
    add_gear(ctx, fit, pcs)
    ctx.report()
    print("tris", ctx.tri_count(), "time %.1f" % (time.time() - t0))
    return ctx


if __name__ == "__main__":
    ctx = build()
    ctx.save_final(charbuild.OUT_DIR + "/_qa/raider_b_wip.glb", split_by_label=True)

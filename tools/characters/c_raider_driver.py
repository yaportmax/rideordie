"""raider_driver: heavy-set sunburnt man ~45 - faded baseball cap (paint, tintable per gang), gold aviators, grizzled beard,
brown leather jacket with the collar up, fingerless driving gloves, chain necklace, cargo pants, boots.  Seen seated."""
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

NAME = "raider_driver"
SPEC = dict(macro=dict(gender=1.0, age=0.62, muscle=0.45, weight=0.72, height=0.5, race="caucasian"),
            extra=[("stomach/stomach-pregnant-incr", 0.35), ("neck/neck-scale-horiz-incr", 0.5), ("head/head-fat-incr", 0.3)],
            height=1.78, skin="middleage_caucasian_male")

JACKET = (0.16, 0.085, 0.045)
PANTS = (0.13, 0.12, 0.08)
TEE = (0.10, 0.10, 0.10)


def skin_texture(ctx, fit):
    ch = ctx.ch
    import body as B
    base = B.skin_image(ch.spec["skin"], 1024).astype(np.float32) / 255.0
    sb = SP.SkinBake(ch, fit, 1024)
    base = sb.fill_gutters(base)
    alb = SP.tone(base, mul=(0.84, 0.68, 0.56), gamma=1.05)
    alb = SP.sunburn(alb, sb, ch, amount=0.6)
    alb = SP.blend(alb, (0.26, 0.2, 0.14), SP.dirt(sb, 12, 0.5))
    # grizzled short beard: dense dark stubble layer + a grey salt-and-pepper layer on top
    alb = SP.stubble(alb, sb, ch, seed=6, amount=1.25, colour=(0.09, 0.075, 0.06), cheeks=1.0)
    alb = SP.stubble(alb, sb, ch, seed=9, amount=0.55, colour=(0.42, 0.40, 0.37), cheeks=0.8)
    return np.clip(alb * 255 + 0.5, 0, 255).astype(np.uint8)


def beard_painter():
    def paint(bk):
        shape = bk.mask.shape
        base = np.array([0.20, 0.17, 0.14], np.float32)
        st = PC.aniso(shape, 5, 0.5, 6)
        st2 = PC.aniso(shape, 6, 0.4, 3)
        grey = U.smoothstep(0.55, 0.75, U.fbm(shape, 30.0, 2, 7))
        alb = np.ones(shape + (3,), np.float32) * base
        alb *= (0.55 + 0.35 * np.clip(st, -1.5, 1.5)[..., None] * 0.5 + 0.25)
        alb = alb * (1 - 0.6 * grey[..., None]) + np.array([0.55, 0.52, 0.48], np.float32) * 0.6 * grey[..., None] * (0.7 + 0.3 * st2[..., None])
        h = (st * 0.0006 + st2 * 0.0003).astype(np.float32)
        edge = 1.0 - U.smoothstep(0.0, 0.012, bk.hem)
        alb *= (1 - 0.3 * edge)[..., None]
        return alb, h
    return paint


def cap_painter():
    def extra(bk, alb, h):
        # panel seams from the crown button, a sweat band line and a faded logo patch
        fit = bk.fit
        hf = cloth.head_frame(fit)
        c = hf["centre"]
        P = bk.P
        ang = np.arctan2(P[..., 0] - c[0], -(P[..., 2] - c[2]))
        seam = np.zeros(bk.mask.shape, np.float32)
        for k in range(6):
            a = -np.pi + k * np.pi / 3
            d = np.abs(np.angle(np.exp(1j * (ang - a))))
            seam = np.maximum(seam, (d < 0.02).astype(np.float32))
        seam *= (P[..., 1] > hf["eye"][1] + 0.06)
        h = h - U.blur(seam, 0.8) * 0.0008
        alb *= (1 - 0.25 * U.blur(seam, 0.8))[..., None]
        logo = (np.abs(P[..., 0] - c[0]) < 0.03) & (np.abs(P[..., 1] - (hf["eye"][1] + 0.075)) < 0.02) & (P[..., 2] < c[2])
        alb = alb * (1 - 0.35 * logo[..., None])
        return alb, h
    return outfit.fabric_painter((0.9, 0.9, 0.88), dust=0.5, dust_col=(0.55, 0.5, 0.42), seed=41, drape=0.0005, sweat=0.0, extra=extra, dark_edge=0.3)


def brim_piece(fit, cap_g):
    """The cap's peak as a cloth piece (internal space), shaped from the front edge of the crown shell."""
    hf = cloth.head_frame(fit)
    P = np.array(cap_g.pos)
    e = hf["eye"]
    front_z = hf["front"]
    y0 = e[1] + 0.036
    nu, nv = 13, 4
    xs = np.linspace(-0.088, 0.088, nu)
    # inner edge: points on the crown shell near height y0 at each x (front half)
    fr = P[(P[:, 2] < hf["centre"][2]) & (np.abs(P[:, 1] - y0) < 0.02)]
    grid = np.zeros((nv, nu, 3))
    for i, x in enumerate(xs):
        near = fr[np.abs(fr[:, 0] - (fit.cx + x)) < 0.012]
        zi = float(near[:, 2].min()) if len(near) else front_z
        for j in range(nv):
            v = j / (nv - 1)
            reach = 0.075 * np.sqrt(max(1.0 - (x / 0.092) ** 2, 0.0))
            z = zi + 0.012 * (1 - v) - v * reach
            y = y0 - 0.004 - 0.018 * v ** 1.6 - 0.012 * (x / 0.09) ** 2 * v
            grid[j, i] = [fit.cx + x, y, z]
    th = 0.005
    top = grid
    bot = grid - np.array([0.0, th, 0.0])
    Vt = top.reshape(-1, 3)
    Vb = bot.reshape(-1, 3)
    V = np.concatenate([Vt, Vb])
    idx = []
    nb = len(Vt)
    for j in range(nv - 1):
        for i in range(nu - 1):
            a, b, c_, d = j * nu + i, j * nu + i + 1, (j + 1) * nu + i + 1, (j + 1) * nu + i
            idx += [(a, c_, b), (a, d, c_)]
            idx += [(nb + a, nb + b, nb + c_), (nb + a, nb + c_, nb + d)]
    # rim around the outer edge and the sides
    ring = [(nv - 1) * nu + i for i in range(nu)] + [j * nu + nu - 1 for j in range(nv - 2, -1, -1)]
    ring2 = [j * nu for j in range(nv)]
    for seq in (ring, ring2):
        for a, b in zip(seq[:-1], seq[1:]):
            idx += [(a, b, nb + b), (a, nb + b, nb + a)]
    idx = np.array(idx, np.int64)
    # orient: top faces up
    fn = kit.face_normals(V, idx)
    if (fn[: 2 * (nu - 1) * (nv - 1): 2, 1]).mean() > 0:
        pass
    m = kit.smooth_normals(kit.mk(V, np.zeros_like(V), np.stack([V[:, 0], V[:, 2]], 1), idx), 45.0)
    # make sure top faces point up (internal space: +Y up)
    fn = kit.face_normals(m["pos"], m["idx"])
    top_t = m["pos"][m["idx"]].mean(axis=1)[:, 1] > y0 - 0.02
    if (fn[:, 1] * np.where(top_t, 1, 0)).sum() < 0:
        m["idx"] = m["idx"][:, [0, 2, 1]]
        m = kit.smooth_normals(m, 45.0)
    n = len(m["pos"])
    j = np.zeros((n, 4), np.uint16)
    j[:, 0] = mh.BONE_INDEX["Head"]
    w = np.zeros((n, 4), np.float32)
    w[:, 0] = 1.0
    return dict(pos=m["pos"], nrm=m["nrm"], uv_m=np.stack([m["pos"][:, 0], m["pos"][:, 2]], 1), region=np.array(["brim"] * n), joints=j,
                weights=w, idx=m["idx"], hem=np.full(n, 0.2), src=np.arange(n), depth=np.zeros(n), ao=np.zeros(n))


def aviators(ctx, brc, hi):
    """Gold-frame aviator sunglasses (final space): (frames, lenses, temples)."""
    eyes = [hi["eye_l"], hi["eye_r"]]
    frames, lenses = [], []
    t = np.linspace(0, 2 * np.pi, 20, endpoint=False)
    for e in eyes:
        sg = 1.0 if e[0] > 0 else -1.0
        c = e + np.array([sg * 0.004, -0.007, 0.024])
        # teardrop outline: wider at the top-outer corner, deeper at the bottom-outer
        ox = 0.027 * np.cos(t) + sg * 0.004 * (1 - np.sin(t)) * 0.5
        oy = 0.020 * np.sin(t) - 0.006 * (1 - np.sin(t)) * (0.5 + 0.5 * sg * np.cos(t))
        pts = c + np.stack([ox, oy, -0.004 * (ox / 0.027) ** 2 * sg * 0 - 0.003 * (ox ** 2 + oy ** 2) / 0.0007], axis=1)
        frames.append(cloth.closed_tube(pts, 0.0013, 4))
        fan = np.vstack([c + np.array([0, 0, 0.002]), pts])
        idx = np.array([(0, 1 + k, 1 + (k + 1) % len(pts)) for k in range(len(pts))])
        lm = kit.mk(fan, np.tile([0, 0, 1.0], (len(fan), 1)), (fan[:, :2] - c[:2]) * 10 + 0.5, idx)
        if kit.face_normals(lm["pos"], lm["idx"])[:, 2].mean() < 0:
            lm["idx"] = lm["idx"][:, [0, 2, 1]]
        lenses.append(lm)
    # double bridge
    l0 = eyes[0] + np.array([-0.022, 0.006, 0.026])
    r0 = eyes[1] + np.array([0.022, 0.006, 0.026])
    br1 = kit.sweep(kit.polyline_smooth([l0, 0.5 * (l0 + r0) + np.array([0, 0.004, 0.004]), r0], 8), 0.0012, sides=4)
    br2 = kit.sweep(kit.polyline_smooth([l0 - np.array([0, 0.012, 0]), 0.5 * (l0 + r0) - np.array([0, 0.006, -0.002]), r0 - np.array([0, 0.012, 0])], 8), 0.0011, sides=4)
    # temples back to the ears
    rc = brc.head()
    temples = []
    for e in eyes:
        sg = 1.0 if e[0] > 0 else -1.0
        p0 = e + np.array([sg * 0.030, 0.004, 0.02])
        pts = [p0]
        for k in range(1, 6):
            z = p0[2] - 0.02 * k
            o = np.array([[sg * 0.3, p0[1] - 0.002 * k, z]])
            T, hp, hn = rc.cast(o, np.array([[-sg, 0.0, 0.0]]), tmax=0.4)
            if np.isfinite(T[0]):
                pts.append(hp[0] + np.array([sg * 0.004, 0, 0]))
        pts.append(pts[-1] + np.array([-sg * 0.004, -0.02, -0.01]))
        temples.append(kit.sweep(kit.polyline_smooth(pts, 12), 0.0012, sides=4))
    return kit.merge(frames + [br1, br2] + temples), kit.merge(lenses)


def add_gear(ctx, fit, pcs):
    ch = ctx.ch
    brc = gear.BodyRC(ch)
    binder = kit.Binder(ch)
    H = brc.landmarks()
    hi = gear.head_info(ctx, brc)
    rubber = common.gear_material(ctx, "rubber", "rubber", color=(0.09, 0.09, 0.09), rough=1.0, metal=0.0)
    gold = common.gear_material(ctx, "metal_rim", "metal_dark", color=(0.85, 0.66, 0.30), rough=0.6, metal=1.0)
    lens_m = common.plain_material(ctx, "glass_lens", (0.10, 0.08, 0.05), rough=0.04, alpha=0.88, double_sided=True)
    chain_m = common.gear_material(ctx, "metal_chain", "metal_dark", color=(0.75, 0.62, 0.35), rough=0.7, metal=1.0)
    knit = common.gear_material(ctx, "leather_collar", "leather", color=JACKET, rough=0.75, metal=0.0)
    fr, le = aviators(ctx, brc, hi)
    common.add_gear(ctx, fr, gold, binder, bone="Head", label="aviator_frame")
    common.add_gear(ctx, le, lens_m, binder, bone="Head", label="aviator_lens")
    # collar up
    col = outfit.collar(ctx, brc, height=0.058, gap_deg=55.0, thick=0.008, out=0.022, flare=0.022, n=24, y_off=-0.025)
    common.add_gear(ctx, col, knit, binder, label="collar")
    # chain necklace (visible in the open collar)
    nk = H["Neck"]
    T, hp, hn = brc.region("Spine2", "Neck").cast(np.array([[0.0, nk[1] - 0.06, 0.6]]), np.array([[0, 0, -1.0]]), tmax=1.0)
    if np.isfinite(T[0]):
        low = hp[0] + hn[0] * 0.008
        pts = [np.array([0.06, nk[1] + 0.02, nk[2] + 0.02]), np.array([0.045, nk[1] - 0.03, low[2] - 0.01]), low, np.array([-0.045, nk[1] - 0.03, low[2] - 0.01]), np.array([-0.06, nk[1] + 0.02, nk[2] + 0.02])]
        common.add_gear(ctx, RG.chain(pts, link_len=0.02, link_w=0.011, wire=0.0018), chain_m, binder, label="necklace")
    # boots
    boot_m = common.gear_material(ctx, "leather_boot", "leather", color=(0.12, 0.08, 0.05), rough=0.85, metal=0.0)
    for side in ("Left", "Right"):
        b = gear.boots(ctx, brc, side, upper_off=0.011, detail=0.55)
        common.add_gear(ctx, b["upper"], boot_m, binder, label="boot_upper")
        common.add_gear(ctx, b["shaft"], boot_m, binder, label="boot_shaft")
        ank = H[side + "Foot"][2]
        common.add_gear(ctx, b["sole"], rubber, binder, blend=(side + "Foot", side + "ToeBase", lambda P, a=ank: np.clip((P[:, 2] - a) / 0.15, 0, 1)), label="boot_sole")
    # fingerless driving gloves + jacket cuffs
    glove_m = common.gear_material(ctx, "leather_glove", "leather", color=(0.10, 0.07, 0.05), rough=0.7, metal=0.0)
    for g_ in pcs["gloves"]:
        common.add_tiled_piece(ctx, cloth.finish(g_, fit), glove_m, label="glove")
    for side in ("Left", "Right"):
        cf = outfit.cuff(pcs["jacket"], H, side, grow=0.005, seg=12, width=0.04)
        if cf is not None:
            common.add_gear(ctx, cf, knit, binder, label="cuff")
    for tube in cloth.bindings(pcs["g_cap"], radius=0.0045, min_len=0.2, sides=4, spacing=0.02):
        common.add_gear(ctx, kit.xform(tube, R=np.diag([-1.0, 1.0, -1.0])), ctx.mats["paint"], binder, bone="Head", label="cap_band")
    ctx.brc, ctx.binder = brc, binder


def build():
    t0 = time.time()
    ctx = charbuild.Ctx(NAME, SPEC)
    ch = ctx.ch
    lod.decimate(ch, 0.25)
    fit = cloth.CFit(ch)
    ctx.fit = fit
    tee = cloth.torso_top(fit, "sleeved", sleeve_len=0.12, off=0.012, bridge=0.02, hem=-0.06, neck=(0.0, -0.02), drape=False)
    pc_tee = cloth.finish(tee, fit)
    jacket = cloth.torso_top(fit, "sleeved", sleeve_len=fit.limb_len("L_arm", 2) - 0.03, off=0.024, bridge=0.01, hem=-0.10, open_front=0.07,
                             open_y=fit.belt_y + 0.08, neck=(0.02, -0.01), neck_up=0.02, drape=False, arm_off_extra=0.006)
    from c_raider_d import push_clear
    push_clear(jacket, pc_tee, 0.010)
    pants = cloth.pants(fit, off=0.026, bridge=0.03)
    gloves = [cloth.glove(fit, s, fingerless=True) for s in ("Left", "Right")]

    def cap_keep(cent, nrm, hf):
        t = np.clip((cent[:, 2] - hf["front"]) / max(hf["back"] - hf["front"], 1e-6), 0, 1)
        return cent[:, 1] > hf["eye"][1] + 0.034 - 0.045 * t ** 1.5
    cap = cloth.head_shell(fit, cap_keep, off=0.014, bridge=0.012, iters=30)
    # crown slightly higher (a cap stands off the head)
    hf = cloth.head_frame(fit)
    P = np.array(cap.pos)
    P[:, 1] += 0.012 * np.clip((P[:, 1] - (hf["eye"][1] + 0.06)) / 0.06, 0, 1)
    for k, p in enumerate(P):
        cap.pos[k] = p

    pc_j = cloth.finish(jacket, fit)
    pc_p = cloth.finish(pants, fit)
    pc_cap = cloth.finish(cap, fit)
    pc_brim = brim_piece(fit, cap)
    tris = common.cull_tris(ch, [tee.cover, pants.cover, cap.cover] + [g.cover for g in gloves],
                            hide_bones=("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"))
    common.add_skin(ctx, tris, skin_texture(ctx, fit))
    common.add_eyes_lite(ctx, iris=(0.25, 0.30, 0.32))
    common.add_brows(ctx, (0.12, 0.10, 0.08), lashes=False)
    common.cloth_group(ctx, "cloth_tee", [pc_tee], outfit.fabric_painter(TEE, dust=0.5, seed=101, sweat=0.3))
    common.cloth_group(ctx, "cloth_jacket", [pc_j], outfit.leather_painter(JACKET, scuff_col=(0.36, 0.22, 0.12), dust=0.45, seed=103, wear=0.8), rough=0.7)
    common.cloth_group(ctx, "cloth_pants", [pc_p], outfit.fabric_painter(PANTS, dust=0.7, seed=107, legs=True))
    common.cloth_group(ctx, "paint", [pc_cap, pc_brim], cap_painter(), color=(0.55, 0.12, 0.08, 1.0), rough=0.9, ppm=500)
    pcs = dict(jacket=pc_j, gloves=gloves, g_cap=cap)
    add_gear(ctx, fit, pcs)
    ctx.report()
    print("tris", ctx.tri_count(), "time %.1f" % (time.time() - t0))
    return ctx


if __name__ == "__main__":
    ctx = build()
    ctx.save_final(charbuild.OUT_DIR + "/_qa/raider_driver_wip.glb", split_by_label=True)

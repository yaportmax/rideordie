"""Gunner armor tiers t1 (slim vest) / t2 (plate carrier) / t3 (heavy armor): separate skinned nodes on the hero skeleton.
Each tier is a full replacement (the game shows exactly one of them)."""
import numpy as np

import cloth
import common
import gear
import kit
import mh
import paintcloth as PC
import uvbake as U


def _rc(ctx, pcs):
    pos = np.concatenate([mh.to_final(p["pos"]) for p in pcs])
    idx, base = [], 0
    for p in pcs:
        idx.append(p["idx"].reshape(-1, 3) + base)
        base += len(p["pos"])
    return kit.Raycaster(pos, np.concatenate(idx))


def molle_painter(color, panel=True, rows=True, wear=0.5, seed=1, extra=None):
    """Canvas vest painter: MOLLE webbing rows on the front and back panels, panel seams, dust."""
    color = np.asarray(color, np.float32)

    def paint(bk):
        fit = bk.fit
        shape = bk.mask.shape
        alb = np.ones(shape + (3,), np.float32) * color[None, None, :]
        alb *= (1.0 + PC.grain(shape, seed, 1.6, 0.06))[..., None]
        mott = U.fbm(shape, 160.0, 3, seed + 3)
        alb *= (0.86 + 0.28 * mott)[..., None]
        h = PC.drape(bk, fit.belt_y - 0.05, amp=0.0009, width=0.03, length=0.2, gather=0.22, seed=seed + 5, base=0.2)
        h += PC.edge_roll(bk, 0.014, 0.0012)
        Y = bk.Y
        x = bk.P[..., 0] - fit.cx
        z = bk.P[..., 2] - fit.torso_cz
        y0, y1 = fit.belt_y + 0.035, fit.sh_y - 0.02
        inside = U.smoothstep(y0 - 0.004, y0 + 0.004, Y) * (1 - U.smoothstep(y1 - 0.004, y1 + 0.004, Y))
        panel_x = np.abs(x) < 0.145
        ppm = bk.ppm
        if rows:
            # horizontal webbing bars: 2.5 cm pitch, 1.9 cm bar with 6 mm gaps, broken into 6 cm segments
            pitch = 0.0254 * 1.0
            fy = ((Y - y0) / pitch) % 1.0
            bar = (fy > 0.22) & (fy < 0.96)
            col_seg = ((x + 1.0) / 0.075) % 1.0
            seg = (col_seg > 0.06) & (col_seg < 0.94)
            m = (bar & seg & panel_x & (inside > 0.5)).astype(np.float32)
            m = U.blur(m, 0.6)
            h += m * 0.0011
            alb *= (1.0 - 0.10 * (1.0 - m) * panel_x * inside)[..., None]
            alb *= (1.0 + 0.06 * m)[..., None]
        # panel seams down the middle of the front / back
        seam = np.exp(-((np.abs(x) / 0.0025) ** 2)) * inside
        h -= seam * 0.0009
        alb *= (1.0 - 0.25 * seam)[..., None]
        dm, dc = PC.dust_layer(bk, seed + 11, 0.5 * wear, ground_col=(0.42, 0.34, 0.24))
        alb = alb * (1 - dm[..., None] * 0.8) + dc[None, None, :] * dm[..., None] * 0.8
        if extra:
            alb, h = extra(bk, alb, h)
        return alb, h
    return paint


def vest_shell(ctx, name, color, off=0.026, hem=-0.035, strap=0.14, neck_half=0.06, neck=(-0.02, -0.03), iters=40, open_front=0.0, seed=1, wear=0.5):
    fit = ctx.fit
    g = cloth.torso_top(fit, "tank", off=off, bridge=0.02, hem=hem, strap=strap, neck_half=neck_half, neck=neck, iters=iters,
                        open_front=open_front)
    # keep the vest clear of the tank top underneath (no z-fighting / poke-through)
    from scipy.spatial import cKDTree
    under = ctx.pcs["top"]
    tree = cKDTree(under["pos"])
    P = np.array(g.pos)
    for _ in range(3):
        d, i = tree.query(P)
        gap = np.einsum("ij,ij->i", P - under["pos"][i], under["nrm"][i])
        push = np.maximum(0.015 - gap, 0.0)
        P = P + under["nrm"][i] * push[:, None]
    for k, p in enumerate(P):
        g.pos[k] = p
    pc = cloth.finish(g, fit)
    common.cloth_group(ctx, name, [pc], molle_painter(color, wear=wear, seed=seed), group=ctx.tier_group, rough=0.92, color=(1, 1, 1, 1))
    return g, pc


def _trim(ctx, g, pc_mat, radius=0.0055, min_len=0.14):
    for tube in cloth.bindings(g, radius=radius, min_len=min_len, sides=3, spacing=0.035):
        common.add_gear(ctx, kit.xform(tube, R=np.diag([-1.0, 1.0, -1.0])), pc_mat, ctx.binder, group=ctx.tier_group, label="trim")


def _place_on(rc, o, d, tmax=1.5):
    T, hp, hn = rc.cast(np.asarray(o, float)[None], np.asarray(d, float)[None], tmax=tmax)
    if not np.isfinite(T[0]):
        return None, None
    return hp[0], hn[0]


def _put(ctx, mesh, mat, bone=None, label="gear"):
    common.add_gear(ctx, mesh, mat, ctx.binder, bone=bone, group=ctx.tier_group, label=label)


def mats(ctx):
    M = {}
    M["steel"] = common.gear_material(ctx, "armor", "armor", color=(0.30, 0.32, 0.25), rough=1.0, metal=1.0)
    M["steel_lt"] = common.gear_material(ctx, "armor_bare", "metal_dark", color=(0.60, 0.60, 0.58), rough=1.0, metal=1.0)
    M["dark"] = common.gear_material(ctx, "metal_dark", "metal_dark", color=(0.30, 0.30, 0.30), rough=1.0, metal=1.0)
    M["web"] = common.gear_material(ctx, "webbing_black", "webbing", color=(0.05, 0.05, 0.05), rough=0.9)
    M["olive"] = common.gear_material(ctx, "cloth_gear_olive", "canvas", color=(0.10, 0.11, 0.06), rough=0.95)
    M["coyote"] = common.gear_material(ctx, "cloth_gear_coyote", "canvas", color=(0.34, 0.27, 0.16), rough=0.95)
    M["black"] = common.gear_material(ctx, "cloth_gear_black", "canvas", color=(0.045, 0.045, 0.045), rough=0.95)
    M["leather"] = common.gear_material(ctx, "leather_dark", "leather", color=(0.11, 0.09, 0.08), rough=0.8, metal=0.0)
    M["rubber"] = common.gear_material(ctx, "rubber", "rubber", color=(0.13, 0.12, 0.11), rough=1.0, metal=0.0)
    M["gren"] = common.gear_material(ctx, "paint_grenade", "metal_dark", color=(0.10, 0.16, 0.06), rough=1.0, metal=0.3)
    return M


def build_t1(ctx):
    """Slim soft-armor vest in coyote canvas: MOLLE panels, two mag pouches, a radio pouch, shoulder straps, drag handle."""
    ctx.tier_group = "armor_t1"
    M = mats(ctx)
    g, pc = vest_shell(ctx, "cloth_vest_t1", (0.30, 0.24, 0.14), off=0.024, seed=3)
    rc = _rc(ctx, [pc])
    H = ctx.brc.landmarks()
    _trim(ctx, g, M["black"], 0.0055)
    cy = ctx.fit.belt_y + 0.20
    # two mag pouches on the chest (front = +Z)
    for sx in (-1.0, 1.0):
        P, n = _place_on(rc, [sx * 0.07, cy - 0.02, 0.8], [0, 0, -1])
        if P is not None:
            pm = gear.place(gear.pouch(detail=0.5, size=(0.075, 0.105, 0.045), flap=0.42), P + n * 0.003, n)
            _put(ctx, pm, M["olive"], label="pouch")
    # radio pouch on the left side
    P, n = _place_on(rc, [0.7, cy - 0.10, 0.02], [-1, 0, 0])
    if P is not None:
        _put(ctx, gear.place(gear.pouch(detail=0.5, size=(0.06, 0.13, 0.05), flap=0.35), P + n * 0.003, n), M["olive"], label="pouch")
    # utility pouch on the back + drag handle
    P, n = _place_on(rc, [0.0, cy - 0.06, -0.8], [0, 0, 1])
    if P is not None:
        _put(ctx, gear.place(gear.pouch(detail=0.5, size=(0.14, 0.10, 0.05), flap=0.4), P + n * 0.003, n), M["olive"], label="pouch")
    P, n = _place_on(rc, [0.0, ctx.fit.sh_y - 0.045, -0.8], [0, 0, 1])
    if P is not None:
        loop = kit.sweep(kit.polyline_smooth([P + [-0.045, 0, 0], P + [-0.05, 0.03, 0.03], P + [0.0, 0.045, 0.045], P + [0.05, 0.03, 0.03], P + [0.045, 0, 0]], 16) + n * 0.004, 0.005, sides=5, tile=0.25)
        _put(ctx, loop, M["web"], label="drag_handle")
    # shoulder-strap buckles and a chest webbing strap
    for sx in (-1.0, 1.0):
        P, n = _place_on(rc, [sx * 0.11, H["Neck"][1] - 0.02, 0.0], [0, -1, 0])
        if P is not None:
            _put(ctx, gear.place(kit.rbox((0.030, 0.026, 0.008), 0.002, 1), P + n * 0.003, n, up=(0, 0, 1)), M["dark"], label="buckle")
    cm, hp, hn = gear.ribbon(rc, [[-0.17, cy + 0.10, 0.0], [-0.09, cy + 0.11, 0.13], [0.09, cy + 0.11, 0.13], [0.17, cy + 0.10, 0.0]], 0.026,
                             standoff=0.005, thick=0.004, n=24)
    _put(ctx, cm, M["web"], label="chest_strap")
    # cummerbund tabs
    for sx in (-1.0, 1.0):
        P, n = _place_on(rc, [sx * 0.6, ctx.fit.belt_y + 0.07, 0.03], [-sx, 0, 0])
        if P is not None:
            _put(ctx, gear.place(kit.rbox((0.09, 0.055, 0.008), 0.002, 1), P + n * 0.003, n), M["black"], label="tab")


def _shoulder_pad(ctx, side, M, rc_sh, standoff, thick, half, dome, mat, layers=1, rc_body=None):
    H = ctx.brc.landmarks()
    sg = 1.0 if side == "Left" else -1.0
    arm = H[side + "Arm"]
    fore = H[side + "ForeArm"]
    axis = (fore - arm) / np.linalg.norm(fore - arm)
    outs = []
    for k in range(layers):
        c = arm + np.array([sg * 0.02, 0.055, 0.0]) + axis * (0.055 * k) - np.array([0, 0.035 * k, 0])
        n = np.array([sg * 0.55, 0.85, 0.0]) if k == 0 else np.array([sg * 0.9, 0.35 - 0.1 * k, 0.0])
        n /= np.linalg.norm(n)
        P, hn = gear.surface_pts(rc_sh, c[None])
        pm = kit.patch_on_surface(rc_sh, P[0], n, (0, 0, 1), half[0] * (1 + 0.12 * k), half[1] * (1 + 0.08 * k), standoff=standoff + 0.012 * k,
                                  thick=thick, bevel=0.006, e=3.4, rings=5, seg=28, dome=dome, cast_from=0.30)
        outs.append(pm)
    return outs


def build_t2(ctx):
    """Plate carrier: black cummerbund carrier with steel plates front and back, padded shoulder pads, three grenades,
    triple mag pouches, admin panel, drag handle, cummerbund side plates."""
    ctx.tier_group = "armor_t2"
    M = mats(ctx)
    g, pc = vest_shell(ctx, "cloth_vest_t2", (0.06, 0.065, 0.05), off=0.034, hem=-0.03, seed=5, wear=0.35)
    rc = _rc(ctx, [pc])
    H = ctx.brc.landmarks()
    fit = ctx.fit
    _trim(ctx, g, M["black"], 0.0065)
    cy = fit.belt_y + 0.20
    # steel plates (front and back) standing proud of the carrier
    P, n = _place_on(rc, [0.0, cy + 0.02, 0.9], [0, 0, -1])
    plate_f = kit.patch_on_surface(rc, P, n, (0, 1, 0), 0.118, 0.148, standoff=0.004, thick=0.024, bevel=0.007, e=3.6, rings=6, seg=32, dome=0.012, cast_from=0.3)
    _put(ctx, plate_f, M["steel"], label="plate_front")
    P, n = _place_on(rc, [0.0, cy + 0.02, -0.9], [0, 0, 1])
    plate_b = kit.patch_on_surface(rc, P, n, (0, 1, 0), 0.118, 0.148, standoff=0.004, thick=0.024, bevel=0.007, e=3.6, rings=6, seg=32, dome=0.010, cast_from=0.3)
    _put(ctx, plate_b, M["steel"], label="plate_back")
    # bolts on the front plate
    for dx in (-0.075, 0.075):
        for dy in (-0.10, 0.10):
            q, qn = _place_on(rc, [dx, cy + 0.02 + dy, 0.9], [0, 0, -1])
            if q is not None:
                _put(ctx, kit.cylinder(q + qn * 0.026, q + qn * 0.032, 0.006, 0.005, seg=8), M["dark"], label="bolt")
    # padded shoulder pads
    rc_sh = ctx.brc.region("LeftArm", "LeftShoulder", "RightArm", "RightShoulder")
    for side in ("Left", "Right"):
        for pm in _shoulder_pad(ctx, side, M, rc_sh, 0.022, 0.03, (0.068, 0.092), 0.022, M["black"], layers=1):
            _put(ctx, pm, M["black"], bone=None, label="shoulder_pad")
    # grenades on the chest
    for i, sx in enumerate((-0.13, 0.13, 0.0)):
        gb, gm = gear.grenade(1.05)
        P, n = _place_on(rc, [sx, cy - 0.145, 0.9], [0, 0, -1])
        if P is None:
            continue
        # upright grenade sitting on the surface: its +Y = up, its base against the carrier
        base = kit.xform(gb, t=[0, -0.03, 0.0])
        met = kit.xform(gm, t=[0, -0.03, 0.0])
        # grenade axis = world up; offset out from the surface by its radius
        off = P + n * (0.030 + 0.004)
        _put(ctx, kit.xform(base, t=off), M["gren"], label="grenade")
        _put(ctx, kit.xform(met, t=off), M["dark"], label="grenade_fuse")
    # triple mag pouches low on the chest
    P, n = _place_on(rc, [0.0, cy - 0.245, 0.9], [0, 0, -1])
    if P is not None:
        for dx in (-0.075, 0.0, 0.075):
            pm = gear.place(gear.pouch(detail=0.5, size=(0.066, 0.11, 0.05), flap=0.4), P + np.array([dx, 0, 0]) + n * 0.003, n)
            _put(ctx, pm, M["olive"], label="pouch")
    # admin pouch upper chest, drag handle and hydration pack on the back
    P, n = _place_on(rc, [0.0, cy + 0.20, 0.9], [0, 0, -1])
    if P is not None:
        _put(ctx, gear.place(gear.pouch(detail=0.5, size=(0.15, 0.07, 0.03), flap=0.6), P + n * 0.003, n), M["black"], label="pouch")
    P, n = _place_on(rc, [0.0, cy + 0.22, -0.9], [0, 0, 1])
    if P is not None:
        loop = kit.sweep(kit.polyline_smooth([P + [-0.05, 0, 0], P + [-0.055, 0.035, 0.03], P + [0.0, 0.055, 0.045], P + [0.055, 0.035, 0.03], P + [0.05, 0, 0]], 16) + n * 0.006, 0.006, sides=5, tile=0.25)
        _put(ctx, loop, M["web"], label="drag_handle")
    P, n = _place_on(rc, [0.0, cy - 0.20, -0.9], [0, 0, 1])
    if P is not None:
        _put(ctx, gear.place(gear.pouch(detail=0.5, size=(0.20, 0.16, 0.06), flap=0.35), P + n * 0.003, n), M["olive"], label="pouch")
    # cummerbund side plates
    for sx in (-1.0, 1.0):
        P, n = _place_on(rc, [sx * 0.7, fit.belt_y + 0.10, 0.02], [-sx, 0, 0])
        if P is not None:
            sp = kit.patch_on_surface(rc, P, n, (0, 1, 0), 0.055, 0.075, standoff=0.004, thick=0.016, bevel=0.005, e=3.6, rings=4, seg=24, dome=0.006, cast_from=0.3)
            _put(ctx, sp, M["steel"], label="side_plate")
    # shoulder-strap buckles
    for sx in (-1.0, 1.0):
        P, n = _place_on(rc, [sx * 0.11, H["Neck"][1] - 0.02, 0.0], [0, -1, 0])
        if P is not None:
            _put(ctx, gear.place(kit.rbox((0.034, 0.03, 0.01), 0.002, 1), P + n * 0.003, n, up=(0, 0, 1)), M["dark"], label="buckle")


def pauldron(ctx, side, H):
    """Domed shoulder cap + two lames wrapped around the upper arm + three spikes: [(mesh, material key)]."""
    sg = 1.0 if side == "Left" else -1.0
    arm = H[side + "Arm"]
    fore = H[side + "ForeArm"]
    axis = (fore - arm) / np.linalg.norm(fore - arm)
    out = []
    # cap: upper half of an ellipsoid over the shoulder joint, tilted along the arm
    ell = kit.ellipsoid([0, 0, 0], [0.098, 0.062, 0.098], seg=16, rings=8)
    keep = ell["pos"][:, 1] > -0.006
    tri_keep = np.all(keep[ell["idx"]], axis=1)
    ell = dict(ell, idx=ell["idx"][tri_keep])
    Rt = kit.look_rot(axis * 0.55 + np.array([0, -0.2, 0]), (0, 1, 0))
    tilt = kit.rot_axis([0, 0, 1], -sg * np.radians(28))
    cap = kit.xform(ell, R=tilt, t=arm + np.array([sg * 0.02, 0.048, 0.0]))
    out.append((cap, "steel"))
    # lames: partial bands around the arm axis
    x, y, z = kit.frame_from_axis(axis, (0, 1, 0))
    for k, (s, r0, hgt, mk) in enumerate(((0.050, 0.068, 0.034, "steel_lt"), (0.092, 0.060, 0.034, "steel"))):
        prof = [(r0, -hgt), (r0 + 0.005, -hgt), (r0 + 0.012, -hgt * 0.4), (r0 + 0.012, hgt * 0.4), (r0 + 0.005, hgt), (r0, hgt)]
        band = kit.lathe(prof, arm + axis * s, axis=axis, seg=16, up=(0, 1, 0), angle=(np.pi / 2 - np.radians(125) , np.pi / 2 + np.radians(125)))
        out.append((band, mk))
    # spikes on the cap
    top = arm + np.array([sg * 0.075, 0.10, 0.0])
    for dz in (-0.045, 0.0, 0.045):
        out.append((gear.spike(top + np.array([0, 0, dz]), [sg * 0.5, 0.85, dz * 3], 0.07, 0.012), "dark"))
    return out


def build_t3(ctx):
    """Heavy armor: thick plated chest / back, layered pauldrons with spikes, gorget, hip tassets, big knee cups,
    crossing harness."""
    ctx.tier_group = "armor_t3"
    M = mats(ctx)
    g, pc = vest_shell(ctx, "cloth_vest_t3", (0.045, 0.045, 0.04), off=0.036, hem=-0.02, seed=8, wear=0.3)
    rc = _rc(ctx, [pc])
    H = ctx.brc.landmarks()
    fit = ctx.fit
    _trim(ctx, g, M["black"], 0.007)
    cy = fit.belt_y + 0.20
    # chest: main plate + upper shield plate + centre ridge
    P, n = _place_on(rc, [0.0, cy - 0.01, 0.9], [0, 0, -1])
    chest = kit.patch_on_surface(rc, P, n, (0, 1, 0), 0.145, 0.165, standoff=0.006, thick=0.032, bevel=0.009, e=3.0, rings=6, seg=36, dome=0.026, cast_from=0.3)
    _put(ctx, chest, M["steel"], label="plate_front")
    P2, n2 = _place_on(rc, [0.0, cy + 0.155, 0.9], [0, 0, -1])
    upper = kit.patch_on_surface(rc, P2, n2, (0, 1, 0), 0.115, 0.055, standoff=0.012, thick=0.026, bevel=0.007, e=3.0, rings=4, seg=28, dome=0.012, cast_from=0.3)
    _put(ctx, upper, M["steel_lt"], label="plate_upper")
    ridge = kit.rbox((0.014, 0.25, 0.018), 0.006, 1)
    _put(ctx, kit.xform(ridge, t=P + n * 0.062 + np.array([0, 0.0, 0])), M["dark"], label="ridge")
    # abdomen lames
    for k in range(3):
        q, qn = _place_on(rc, [0.0, fit.belt_y + 0.075 - 0.05 * k, 0.9], [0, 0, -1])
        if q is not None:
            lame = kit.patch_on_surface(rc, q, qn, (0, 1, 0), 0.115 - 0.008 * k, 0.03, standoff=0.006 + 0.004 * k, thick=0.014, bevel=0.005, e=3.2, rings=2, seg=20, dome=0.004, cast_from=0.3)
            _put(ctx, lame, M["steel"], label="lame")
    # back plate + spine plates
    P, n = _place_on(rc, [0.0, cy + 0.02, -0.9], [0, 0, 1])
    back = kit.patch_on_surface(rc, P, n, (0, 1, 0), 0.14, 0.175, standoff=0.006, thick=0.022, bevel=0.009, e=3.4, rings=6, seg=36, dome=0.008, cast_from=0.3)
    _put(ctx, back, M["steel"], label="plate_back")
    for k in range(4):
        q, qn = _place_on(rc, [0.0, cy + 0.14 - 0.075 * k, -0.9], [0, 0, 1])
        if q is not None:
            v = kit.rbox((0.16, 0.022, 0.014), 0.0, 0)
            _put(ctx, gear.place(v, q + qn * 0.032, qn), M["dark"], label="vent_bar")
    # pauldrons: a domed cap + two lames (partial bands around the upper arm) + spikes
    for side in ("Left", "Right"):
        for i, (pm, mk) in enumerate(pauldron(ctx, side, H)):
            _put(ctx, pm, M[mk], label="pauldron")
    # gorget: a low steel collar around the neck
    nk = H["Neck"]
    rings, dirs = kit.rings_along(ctx.brc.region("Neck"), np.array([0, nk[1] + 0.005, nk[2]]), np.array([0, nk[1] + 0.06, nk[2] + 0.012]), [0, 0.5, 1.0],
                                  offset=0.022, n=28, r_out=0.25)
    rings[2] = rings[2] + dirs * 0.012
    rings = np.concatenate([rings, (rings[2] + dirs * 0.006 - np.array([0, 0.014, 0]))[None]])
    gor = kit.loft(rings, closed=True, tile=0.25, angle=40.0)
    gor = kit.orient_outward(gor, rings.reshape(-1, 3).mean(axis=0), 40.0)
    _put(ctx, gor, M["steel"], label="gorget")
    # tassets: hip plates
    rc_p = ctx.rc_cloth
    for sx in (-1.0, 1.0):
        P, n = _place_on(rc_p, [sx * 0.6, fit.belt_y - 0.10, 0.06], [-sx, 0, 0])
        if P is not None:
            ta = kit.patch_on_surface(rc_p, P, n, (0, 1, 0), 0.075, 0.105, standoff=0.010, thick=0.02, bevel=0.006, e=3.4, rings=4, seg=20, dome=0.012, cast_from=0.3)
            _put(ctx, ta, M["steel"], label="tasset")
    # big knee cups
    for sx in (-1.0, 1.0):
        kn = H["LeftLeg" if sx > 0 else "RightLeg"]
        P, n = _place_on(rc_p, [kn[0], kn[1] + 0.01, 0.6], [0, 0, -1])
        if P is not None:
            cup = kit.patch_on_surface(rc_p, P, n, (0, 1, 0), 0.075, 0.09, standoff=0.012, thick=0.026, bevel=0.007, e=2.8, rings=4, seg=20, dome=0.02, cast_from=0.3)
            _put(ctx, cup, M["steel"], label="knee_cup")
            ridge2 = kit.rbox((0.014, 0.12, 0.012), 0.004, 1)
            _put(ctx, gear.place(ridge2, P + n * (0.012 + 0.048), n), M["dark"], label="knee_ridge")

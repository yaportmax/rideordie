"""Reusable outfit parts (final space): collars, rib bands, zippers, patches, straps; generic painters for fabric / leather."""
import numpy as np

import cloth
import common
import gear
import kit
import mh
import paintcloth as PC
import uvbake as U


def rc_from_pieces(pcs):
    pos = np.concatenate([mh.to_final(p["pos"]) for p in pcs])
    idx, base = [], 0
    for p in pcs:
        idx.append(p["idx"].reshape(-1, 3) + base)
        base += len(p["pos"])
    return kit.Raycaster(pos, np.concatenate(idx))


def band_ring(rc, p0, p1, height_ts=(0.0, 1.0), offset=0.006, thick=0.008, n=40, r_out=0.4, tuck=0.0, tile=0.25, rib_bulge=0.003):
    """A ribbed band (hem / cuff / waistband) hugging the surface around the axis p0->p1. Two outer rings + inner lining."""
    ts = np.linspace(height_ts[0], height_ts[1], 5)
    rings, dirs = kit.rings_along(rc, p0, p1, ts, offset=offset, n=n, r_out=r_out)
    bulge = np.array([0.0, 1.0, 0.7, 1.0, 0.0]) * rib_bulge
    rings = rings + dirs[None, :, :] * bulge[:, None, None] - dirs[None, :, :] * tuck * np.array([0.0, 0.4, 1.0, 0.4, 0.0])[:, None, None]
    inner = rings[[0, -1]] - dirs[None] * thick
    allr = np.concatenate([inner[:1], rings, inner[1:]])
    m = kit.loft(allr, closed=True, tile=tile, angle=55.0)
    return kit.orient_outward(m, allr.reshape(-1, 3).mean(axis=0), 55.0)


def collar(ctx, brc, height=0.04, gap_deg=32.0, thick=0.010, up=0.0, out=0.018, flare=0.014, n=36, y_off=0.0):
    """A stand-up collar around the neck with a gap at the front; returns a kit mesh."""
    H = brc.landmarks()
    nk = H["Neck"]
    base = np.array([0.0, nk[1] + y_off, nk[2]])
    top = base + np.array([0.0, height, 0.006])
    rc = brc.region("Neck")
    rings, dirs = kit.rings_along(rc, base, top, [0.0, 0.5, 1.0], offset=out, n=n, r_out=0.25)
    rings[1] = rings[1] + dirs * flare * 0.5
    rings[2] = rings[2] + dirs * flare
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    # ring direction 0 is x (left, +X)... find columns near the front (+Z): dirs . z > cos(gap)
    front = dirs[:, 2] > np.cos(np.radians(gap_deg))
    keep = np.flatnonzero(~front)
    # order columns around, starting after the gap
    ang = np.arctan2(dirs[keep, 0], dirs[keep, 2])          # 0 = front, +ve toward +X
    order = keep[np.argsort(ang)]
    r2 = rings[:, order]
    outer = r2
    innerr = r2 - dirs[order][None] * thick
    allr = np.concatenate([innerr[:1], outer, innerr[-1:]])
    m = kit.loft(allr, closed=False, tile=0.25, angle=50.0)
    return m


def cuff(pc, H, side, s_from_wrist=0.035, width=0.05, grow=0.007, seg=28):
    """A ribbed cuff band on a sleeve: measured from the sleeve piece's own vertices near the wrist."""
    wr, el = H[side + "Hand"], H[side + "ForeArm"]
    u = (wr - el) / np.linalg.norm(wr - el)
    P = mh.to_final(pc["pos"])
    c0 = wr - u * s_from_wrist
    t = (P - c0) @ u
    v = P - c0 - np.outer(t, u)
    r = np.linalg.norm(v, axis=1)
    near = (np.abs(t) < width * 0.7) & (r < 0.14)
    if near.sum() < 6:
        return None
    rad = float(np.percentile(r[near], 85))
    w = width / 2
    prof = [(rad - 0.004, -w), (rad + grow - 0.003, -w), (rad + grow, -w * 0.5), (rad + grow + 0.002, 0.0), (rad + grow, w * 0.5), (rad + grow - 0.003, w), (rad - 0.004, w)]
    return kit.lathe(prof, c0, axis=u, seg=seg, up=(0, 1, 0))


def zipper(rc, y0, y1, z_hint=0.9, width=0.011, thick=0.004, n=30):
    """Centre-front zipper strip on the garment surface between heights y0..y1 (raycast from the front)."""
    ys = np.linspace(y0, y1, n)
    pts = np.stack([np.zeros(n), ys, np.full(n, z_hint)], axis=1)
    T, hp, hn = rc.cast(pts, np.tile([0.0, 0.0, -1.0], (n, 1)), tmax=2.0)
    ok = np.isfinite(T)
    if ok.sum() < 4:
        return None
    hp, hn = hp[ok], hn[ok]
    side = np.tile([1.0, 0.0, 0.0], (len(hp), 1))
    prof = [(-width / 2, 0.0), (width / 2, 0.0), (width / 2, thick), (-width / 2, thick)]
    rings = np.array([[hp[i] + hn[i] * 0.003 + side[i] * x + hn[i] * z for x, z in prof] for i in range(len(hp))])
    return kit.loft(rings, closed=True, cap0=True, cap1=True, tile=0.25, angle=50.0)


def stitch_dashes(shape, mask_fn, period=0.008, on=0.5):
    return None


# --- generic painters ---------------------------------------------------------------------------------------

def fabric_painter(color, dust=0.5, dust_col=(0.42, 0.34, 0.24), drape=0.0018, hem_off=-0.02, grain=0.05, mott=0.22, seed=1,
                   edge=0.0011, legs=False, arms=False, sweat=0.0, oil=0.0, rough_cav=0.35, dark_edge=0.15, folds_scale=1.0, extra=None):
    color = np.asarray(color, np.float32)

    def paint(bk):
        fit = bk.fit
        shape = bk.mask.shape
        alb = np.ones(shape + (3,), np.float32) * color[None, None, :]
        alb *= (1.0 + PC.grain(shape, seed, 1.6, grain))[..., None]
        m1 = U.fbm(shape, 170.0, 3, seed + 5)
        alb *= ((1 - mott / 2) + mott * m1)[..., None]
        # trousers: folds gather at the waist and stack above the boots; the thighs/shins stay mostly smooth
        h = PC.drape(bk, fit.belt_y + hem_off, amp=drape * folds_scale, width=0.024, length=0.18, gather=0.28, seed=seed + 2,
                     base=0.08 if legs else 0.25)
        h += PC.side_seams(bk, fit) + PC.edge_roll(bk, 0.014, edge)
        if legs:
            for key in ("L_leg", "R_leg"):
                kn = fit.limb_len(key, 1)
                h += PC.wrinkles(bk, fit, key, kn, 0.06, 0.0010 * folds_scale, 0.07, 0.010, seed=seed + 3)
                h += PC.wrinkles(bk, fit, key, fit.limb_len(key, 2) - 0.02, 0.10, 0.0010 * folds_scale, 0.08, 0.011, seed=seed + 4)
                h += PC.wrinkles(bk, fit, key, 0.07, 0.08, 0.0007 * folds_scale, 0.07, 0.009, seed=seed + 5)
            h += PC.drape(bk, fit.ankle_y, amp=0.0011, width=0.03, length=0.2, gather=0.35, base=0.08, seed=seed + 6)
            # large-scale wear: faded knees and thigh fronts, darker grime on the seat, inner thighs and shins
            th = fit.theta(bk.P.reshape(-1, 3)).reshape(shape)
            front = np.clip(np.cos(th), 0, 1)
            kn_y = fit.ankle_y + 0.40
            knee = np.exp(-((bk.Y - kn_y) / 0.09) ** 2) * front
            thigh = U.smoothstep(kn_y + 0.05, kn_y + 0.25, bk.Y) * (1 - U.smoothstep(fit.belt_y - 0.12, fit.belt_y, bk.Y)) * front
            wn = U.fbm(shape, 60.0, 3, seed + 31)
            fade = np.clip(0.55 * knee + 0.22 * thigh, 0, 1) * (0.55 + 0.7 * wn)
            grey = alb.mean(axis=-1, keepdims=True)
            alb = alb * (1 - 0.45 * fade[..., None]) + (grey * 1.55 + 0.02) * 0.45 * fade[..., None]
            back = np.clip(-np.cos(th), 0, 1)
            seat = U.smoothstep(fit.belt_y - 0.25, fit.belt_y - 0.10, bk.Y) * back
            shin = (1 - U.smoothstep(fit.ankle_y + 0.05, fit.ankle_y + 0.35, bk.Y))
            gr = np.clip(0.30 * seat + 0.25 * shin, 0, 0.5) * (0.6 + 0.8 * U.fbm(shape, 40.0, 2, seed + 33))
            alb *= (1 - gr)[..., None]
        if arms:
            for key in ("L_arm", "R_arm"):
                el = fit.limb_len(key, 1)
                h += PC.wrinkles(bk, fit, key, el, 0.05, 0.0012 * folds_scale, 0.08, 0.007, seed=seed + 7)
                h += PC.wrinkles(bk, fit, key, el - 0.09, 0.05, 0.0008 * folds_scale, 0.07, 0.007, seed=seed + 8)
        band = 1.0 - U.smoothstep(0.010, 0.016, bk.hem)
        alb *= (1.0 - dark_edge * band)[..., None]
        if sweat > 0:
            th = fit.theta(bk.P.reshape(-1, 3)).reshape(shape)
            back = np.exp(-(((np.abs(th) - np.pi) / 0.32) ** 2)) * U.smoothstep(fit.belt_y, fit.belt_y + 0.25, bk.Y)
            alb *= (1.0 - sweat * back * (0.6 + 0.6 * m1))[..., None]
        if oil > 0:
            st = PC.aniso(shape, seed + 21, 3, 25)
            alb *= (1.0 - oil * np.clip((st - 1.2) * 0.8, 0, 1))[..., None]
        dm, dc = PC.dust_layer(bk, seed + 9, dust, ground_col=dust_col)
        alb = alb * (1 - dm[..., None] * 0.85) + dc[None, None, :] * dm[..., None] * 0.85
        if extra:
            alb, h = extra(bk, alb, h)
        return alb, h
    return paint


def leather_painter(color, scuff_col=(0.55, 0.36, 0.2), dust=0.3, seed=1, wear=0.6, seams=True, grain_amp=0.0007, extra=None):
    """Worn leather jacket: cracked grain (fine), scuffs on shoulders/elbows/hem, creases at elbows, stitched seams."""
    color = np.asarray(color, np.float32)

    def paint(bk):
        fit = bk.fit
        shape = bk.mask.shape
        ppm = bk.ppm
        alb = np.ones(shape + (3,), np.float32) * color[None, None, :]
        n1 = U.fbm(shape, 90.0, 3, seed)
        n2 = U.fbm(shape, 9.0, 2, seed + 1)
        alb *= (0.90 + 0.20 * n1)[..., None]
        alb *= (0.97 + 0.06 * n2)[..., None]
        # grain: faint cracks
        cr = PC.aniso(shape, seed + 4, 1.4, 1.4)
        h = np.clip(cr * 0.5, -1, 1) * grain_amp
        h += PC.drape(bk, fit.belt_y - 0.04, amp=0.0008, width=0.03, length=0.16, gather=0.25, seed=seed + 2, base=0.3)
        h += PC.edge_roll(bk, 0.014, 0.0012)
        for key in ("L_arm", "R_arm"):
            el = fit.limb_len(key, 1)
            h += PC.wrinkles(bk, fit, key, el, 0.05, 0.0012, 0.09, 0.007, seed=seed + 7)
            h += PC.wrinkles(bk, fit, key, el - 0.10, 0.045, 0.0008, 0.08, 0.007, seed=seed + 8)
        h += PC.side_seams(bk, fit, 0.0011)
        # scuffs: lighter, worn patches where the surface catches (blotchy, on top surfaces + edges)
        sc = U.smoothstep(0.62, 0.85, U.fbm(shape, 70.0, 3, seed + 6)) * wear * 0.6
        sc += (1.0 - U.smoothstep(0.0, 0.03, bk.hem)) * 0.35 * wear
        alb = alb * (1 - np.clip(sc, 0, 0.55)[..., None]) + np.asarray(scuff_col, np.float32) * np.clip(sc, 0, 0.55)[..., None]
        if seams:
            th = fit.theta(bk.P.reshape(-1, 3)).reshape(shape)
            a = np.abs(th)
            for ang in (np.pi / 2,):
                d = np.abs(a - ang) * 0.17
                st = np.exp(-((d / 0.0016) ** 2))
                dash = (np.sin(bk.Y * 2 * np.pi / 0.006) > 0).astype(np.float32)
                alb *= (1 - 0.35 * st * dash)[..., None]
        dm, dc = PC.dust_layer(bk, seed + 9, dust, ground_col=(0.42, 0.34, 0.24))
        alb = alb * (1 - dm[..., None] * 0.7) + dc[None, None, :] * dm[..., None] * 0.7
        if extra:
            alb, h = extra(bk, alb, h)
        return alb, h
    return paint

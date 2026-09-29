"""Gear builders specific to the raiders (final space): bandolier, bandana knot, mohawk, spikes, studs, masks, dynamite ..."""
import numpy as np

import gear
import kit
import mh


def bandolier(rc, ctrl, width=0.062, shell_r=0.0098, spacing=0.0245, n=24):
    """A cartridge bandolier: (strap mesh, [shell meshes with vertex colours]) following the surface."""
    strap, hp, hn = gear.ribbon(rc, ctrl, width, standoff=0.004, thick=0.005, n=n)
    # arc-length resample of the path
    seg = np.linalg.norm(np.diff(hp, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    marks = np.arange(0.5 * spacing, s[-1] - 0.5 * spacing, spacing)
    shells = []
    for m in marks:
        i = int(np.searchsorted(s, m))
        i = min(max(i, 1), len(hp) - 1)
        p = hp[i] + hn[i] * (0.004 + 0.005 + shell_r * 0.85)
        t = hp[min(i + 1, len(hp) - 1)] - hp[i - 1]
        t /= np.linalg.norm(t)
        side = np.cross(hn[i], t)
        side /= np.linalg.norm(side)
        p0, p1 = p - side * width * 0.42, p + side * width * 0.42
        cyl = kit.cylinder(p0, p1, shell_r, shell_r * 0.94, seg=5, caps=(False, True), tile=0.1)
        # vertex colours: red hull, brass base (at p0 side)
        ax = (p1 - p0) / np.linalg.norm(p1 - p0)
        tt = ((cyl["pos"] - p0) @ ax) / (width * 0.84)
        col = np.where((tt < 0.18)[:, None], np.array([0.75, 0.56, 0.2]), np.array([0.55, 0.06, 0.05]))
        cyl["col"] = col
        shells.append(cyl)
    return strap, kit.merge(shells)


def bandana_tails(anchor, back_dir=np.array([0.0, 0.0, -1.0]), length=0.16, width=0.032, splay=0.022, wave=0.012, droop=0.55, n=14):
    """Knot + two tails hanging from a point at the back of the head (final space): list of meshes."""
    anchor = np.asarray(anchor, float)
    out = [kit.ellipsoid(anchor + np.array([0, 0, 0.0]), [0.021, 0.019, 0.026], seg=10, rings=6)]
    prof = np.array([[-1.0, 0.0], [1.0, 0.0], [1.0, 0.18], [-1.0, 0.18]])
    for sgn in (1.0, -1.0):
        pts = []
        for k in range(n):
            t = k / (n - 1)
            p = anchor + np.array([sgn * splay * t + np.sin(t * 5 + sgn) * wave * t, -length * t * droop - 0.01 * t, -0.006 - 0.03 * t * t])
            pts.append(p)
        tail = kit.sweep(np.array(pts), width * 0.5 * (1.0 + 0.0), profile=prof, sides=4, caps=False, tile=0.1)
        out.append(tail)
    return out


def studs(points, normals, r=0.006, h=0.005, seg=8):
    meshes = []
    for p, n in zip(points, normals):
        meshes.append(kit.cylinder(p + n * 0.001, p + n * h, r, r * 0.55, seg=seg, tile=0.05))
    return kit.merge(meshes)


def spike_cluster(base, direction, count=5, length=0.09, r=0.011, spread=0.5, seed=0):
    rng = np.random.default_rng(seed)
    d = np.asarray(direction, float)
    d /= np.linalg.norm(d)
    x = np.cross(d, [0, 1, 0])
    if np.linalg.norm(x) < 1e-6:
        x = np.cross(d, [1, 0, 0])
    x /= np.linalg.norm(x)
    y = np.cross(d, x)
    meshes = []
    for k in range(count):
        a = 2 * np.pi * k / count + rng.uniform(-0.2, 0.2)
        dd = d + (np.cos(a) * x + np.sin(a) * y) * spread * (0.6 if k else 0.0)
        dd /= np.linalg.norm(dd)
        L = length * (1.0 if k == 0 else rng.uniform(0.7, 0.95))
        meshes.append(gear.spike(base + (np.cos(a) * x + np.sin(a) * y) * 0.02 * (1 if k else 0), dd, L, r))
    return kit.merge(meshes)


def strand_texture(root_col, tip_col, w=64, h=256, seed=3):
    """Streaky hair texture for solid spikes: v = 0 root .. 1 tip, colour gradient + strands (RGB uint8)."""
    import uvbake as U
    rng = np.random.default_rng(seed)
    base = rng.standard_normal((h, w)).astype(np.float32)
    from scipy import ndimage
    st = ndimage.gaussian_filter(base, sigma=(18, 0.7), mode="wrap")
    st = (st - st.min()) / (st.max() - st.min())
    t = np.linspace(0, 1, h)[:, None]
    col = np.asarray(root_col, np.float32)[None, None, :] * (1 - t[..., None]) + np.asarray(tip_col, np.float32)[None, None, :] * t[..., None]
    col = col * (0.55 + 0.7 * st[..., None])
    return (np.clip(col, 0, 1) * 255).astype(np.uint8)


def mohawk(rc_head, hi, count=11, height=(0.07, 0.15), base_len=0.055, base_w=0.022, back_tilt=0.35, sides=6, rings=5, seed=2, up_bias=0.0):
    """A spiked mohawk crest along the head midline (final space): lofted flattened cones. uv v = 0 root .. 1 tip."""
    rng = np.random.default_rng(seed)
    ey = hi["eye_l"][1]
    front, back = hi["front"], hi["back"]
    c = np.array([0.0, ey + 0.02, 0.5 * (front + back)])
    meshes = []
    for k in range(count):
        t = 0.10 + 0.72 * k / (count - 1)         # hairline (just behind the forehead) .. occiput
        # direction from the head centre in the YZ plane: forward-up at the forehead, up at the crown, back-down at the nape
        phi = (0.55 - 1.45 * t) * np.pi / 2 * 1.6      # +0.88 rad (forward) .. -1.4 rad (backward/down)
        d = np.array([0.0, np.cos(phi), np.sin(phi)])
        o = c + d * 0.3
        T, hp, hn = rc_head.cast(o[None], -d[None], tmax=0.4)
        if np.isfinite(T[0]):
            hp[0, 0] = 0.0
        if not np.isfinite(T[0]):
            continue
        p0 = hp[0] + hn[0] * 0.002
        n0 = hn[0]
        # height profile: tallest over the crown
        H = height[0] + (height[1] - height[0]) * np.sin(np.clip((t + 0.05) / 1.0, 0, 1) * np.pi) ** 0.8 * (1.0 - 0.35 * t)
        H *= rng.uniform(0.9, 1.1)
        grow = n0 * (1 - back_tilt) + np.array([0.0, 0.0, -1.0]) * back_tilt
        grow = grow / np.linalg.norm(grow) * (1 - up_bias) + np.array([0.0, 1.0, 0.0]) * up_bias
        grow[0] = 0.0
        grow /= np.linalg.norm(grow)
        tang = np.cross(np.array([1.0, 0.0, 0.0]), n0)
        tang /= np.linalg.norm(tang)
        a = np.linspace(0, 2 * np.pi, sides, endpoint=False)
        rr = []
        for j in range(rings):
            s = j / (rings - 1)
            w = (1 - s) ** 1.3
            ctr = p0 + grow * H * s + np.array([0.0, 0.0, -1.0]) * (H * 0.25 * s * s)
            rr.append(ctr + np.cos(a)[:, None] * np.array([1.0, 0, 0]) * base_w * 0.5 * max(w, 0.04)
                      + np.sin(a)[:, None] * tang * base_len * 0.5 * max(w, 0.04))
        tip = p0 + grow * H * 1.04 + np.array([0.0, 0.0, -1.0]) * (H * 0.27)
        rr.append(np.tile(tip, (sides, 1)))
        m = kit.loft(np.array(rr), closed=True, tile=1.0, angle=70.0)
        # uv: u around, v = height fraction
        v = np.clip(((m["pos"] - p0) @ grow) / (H * 1.04), 0, 1)
        m["uv"] = np.stack([np.arctan2((m["pos"] - p0) @ tang, (m["pos"] - p0)[:, 0]) / (2 * np.pi) + 0.5, v], axis=1)
        m = kit.orient_outward(m, p0 + grow * H * 0.4, 70.0)
        meshes.append(m)
    return kit.merge(meshes)


def edge_points(g, pc_final_pos, pc_final_nrm, spacing=0.03, min_len=0.12, smooth=6):
    """Points (+ outward normals) every `spacing` along the free edges of a garment (for studs / rivets). FINAL space."""
    import garments as G
    from scipy.spatial import cKDTree
    T = np.array(g.tris, np.int64)
    P = mh.to_final(np.array(g.pos))
    tree = cKDTree(pc_final_pos)
    pts, nrms = [], []
    for loop in G._boundary_loops(T):
        q = P[loop]
        L = float(np.linalg.norm(np.diff(q, axis=0), axis=1).sum())
        if L < min_len:
            continue
        for _ in range(smooth):
            q = q * 0.5 + (np.roll(q, 1, axis=0) + np.roll(q, -1, axis=0)) * 0.25
        seg = np.linalg.norm(np.diff(np.vstack([q, q[:1]]), axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        marks = np.arange(0.0, s[-1], spacing)
        qq = np.stack([np.interp(marks, s, np.append(q[:, k], q[0, k])) for k in range(3)], axis=1)
        _, i = tree.query(qq)
        pts.append(qq)
        nrms.append(pc_final_nrm[i])
    if not pts:
        return np.zeros((0, 3)), np.zeros((0, 3))
    return np.concatenate(pts), np.concatenate(nrms)


def bracer(body_pos_final, H, side, from_wrist=0.03, length=0.11, grow=0.012, seg=20, spikes=4, spike_len=0.028):
    """A leather bracer (lathe band around the forearm) + a row of small spikes on its outer side."""
    wr, el = H[side + "Hand"], H[side + "ForeArm"]
    u = (wr - el) / np.linalg.norm(wr - el)
    c0 = wr - u * (from_wrist + length / 2)
    t = (body_pos_final - c0) @ u
    v = body_pos_final - c0 - np.outer(t, u)
    r = np.linalg.norm(v, axis=1)
    near = (np.abs(t) < length / 2) & (r < 0.08)
    rad = float(np.percentile(r[near], 90)) if near.sum() > 5 else 0.035
    L = length / 2
    prof = [(rad - 0.002, -L), (rad + grow, -L), (rad + grow + 0.002, -L * 0.8), (rad + grow + 0.002, L * 0.8), (rad + grow, L), (rad - 0.002, L)]
    band = kit.lathe(prof, c0, axis=u, seg=seg, up=(0, 1, 0))
    # spikes on the back of the forearm (outward = away from the body: +X for Left, -X for Right, tilted up)
    sg = 1.0 if side == "Left" else -1.0
    out = np.array([sg, 0.35, 0.0])
    out = out - u * (out @ u)
    out /= np.linalg.norm(out)
    sp = []
    import gear as GR
    for k in range(spikes):
        s_ = -L * 0.65 + (1.3 * L) * k / max(spikes - 1, 1)
        base = c0 + u * s_ + out * (rad + grow)
        sp.append(GR.spike(base, out, spike_len, 0.006, seg=6))
    return band, kit.merge(sp)


def chain(path_pts, link_len=0.022, link_w=0.012, wire=0.0022, sides=4):
    """Alternating chain links along a polyline (final space)."""
    path = kit.polyline_smooth(path_pts, 64)
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    marks = np.arange(link_len * 0.5, s[-1], link_len * 0.78)
    links = []
    for k, m in enumerate(marks):
        p = np.stack([np.interp(m, s, path[:, j]) for j in range(3)])
        i = min(int(np.searchsorted(s, m)), len(path) - 1)
        t = path[min(i, len(path) - 1)] - path[max(i - 1, 0)]
        t /= max(np.linalg.norm(t), 1e-9)
        side = np.cross(t, [0, 1, 0])
        if np.linalg.norm(side) < 1e-6:
            side = np.cross(t, [1, 0, 0])
        side /= np.linalg.norm(side)
        up = np.cross(side, t)
        w = side if k % 2 == 0 else up
        a = np.linspace(0, 2 * np.pi, 8, endpoint=False)
        ring = p + np.cos(a)[:, None] * t * link_len * 0.5 + np.sin(a)[:, None] * w * link_w * 0.5
        import cloth as C
        links.append(C.closed_tube(ring, wire, 3))
    return kit.merge(links)

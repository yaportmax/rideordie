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

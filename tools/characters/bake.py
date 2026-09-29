"""Bake per-texel attributes for a set of atlas-packed pieces, then paint albedo / height in UV space."""
import numpy as np

import mh
import uvbake as U


class Baked:
    """Per-texel attributes for one atlas. Positions/normals are INTERNAL space (same as the fit)."""

    def __init__(self, pieces, atlas, extra_names=()):
        self.size = atlas
        uv, tris, attrs = [], [], []
        base = 0
        names = ["px", "py", "pz", "nx", "ny", "nz", "hem", "piece"] + list(extra_names)
        for pi, pc in enumerate(pieces):
            uv.append(pc["uv"])
            tris.append(pc["idx"].reshape(-1, 3) + base)
            cols = [pc["pos"], pc["nrm"], pc["hem"][:, None], np.full((len(pc["pos"]), 1), float(pi))]
            for en in extra_names:
                cols.append(np.asarray(pc[en], float).reshape(len(pc["pos"]), -1))
            attrs.append(np.concatenate(cols, axis=1))
            base += len(pc["pos"])
        uv = np.concatenate(uv)
        tris = np.concatenate(tris)
        attrs = np.concatenate(attrs)
        img, mask = U.rasterize(uv, tris, attrs, atlas)
        self.mask = mask
        img = U.dilate(img, mask, max_dist=12)
        self.P = img[..., 0:3]
        n = img[..., 3:6]
        self.N = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
        self.hem = img[..., 6]
        self.piece = np.rint(img[..., 7]).astype(int)
        self.extra = {en: img[..., 8 + i] for i, en in enumerate(extra_names)} if extra_names else {}
        self.extra_raw = img[..., 8:]

    @property
    def Y(self):
        return self.P[..., 1]

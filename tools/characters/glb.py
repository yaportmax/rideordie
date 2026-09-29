"""A small glTF 2.0 (.glb) writer for skinned, textured, animated characters (numpy only).

Adapted from CONDUIT's gltf_out.py; adds embedded textures, PBR materials, node extras, hidden nodes
(KHR_node_visibility + extras.hidden), COLOR_0 and animation clips.
"""
import io
import json
import struct

import numpy as np

FLOAT, USHORT, UINT, UBYTE = 5126, 5123, 5125, 5121


class Glb:
    def __init__(self, generator="ride-or-die characters"):
        self.bin = bytearray()
        self.g = {"asset": {"version": "2.0", "generator": generator}, "buffers": [], "bufferViews": [],
                  "accessors": [], "nodes": [], "meshes": [], "materials": [], "skins": [], "animations": [],
                  "images": [], "textures": [], "samplers": [], "scenes": [{"nodes": []}], "scene": 0}
        self._img_cache = {}
        self._tex_cache = {}
        self.g["samplers"].append({"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497})
        self.uses_visibility = False

    # -- buffers ----------------------------------------------------------------------------------
    def _view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin += data
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            v["target"] = target
        self.g["bufferViews"].append(v)
        return len(self.g["bufferViews"]) - 1

    def accessor(self, arr, kind, comp=FLOAT, target=None, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        dt = {FLOAT: np.float32, USHORT: np.uint16, UINT: np.uint32, UBYTE: np.uint8}[comp]
        arr = arr.astype(dt)
        view = self._view(arr.tobytes(), target)
        count = arr.shape[0]
        acc = {"bufferView": view, "componentType": comp, "count": int(count), "type": kind}
        if normalized:
            acc["normalized"] = True
        if minmax:
            flat = arr.reshape(count, -1)
            acc["min"] = [float(x) for x in flat.min(axis=0)]
            acc["max"] = [float(x) for x in flat.max(axis=0)]
        self.g["accessors"].append(acc)
        return len(self.g["accessors"]) - 1

    # -- images / textures -------------------------------------------------------------------------
    def image(self, key, data, mime):
        """Embed encoded image bytes (PNG/JPEG); returns the texture index."""
        if key in self._tex_cache:
            return self._tex_cache[key]
        view = self._view(data)
        self.g["images"].append({"bufferView": view, "mimeType": mime, "name": key})
        self.g["textures"].append({"sampler": 0, "source": len(self.g["images"]) - 1, "name": key})
        self._tex_cache[key] = len(self.g["textures"]) - 1
        return self._tex_cache[key]

    def texture_array(self, key, arr, fmt="jpg", quality=90):
        """arr: HxWx3/4 uint8 (or HxW). fmt 'jpg' or 'png'."""
        from PIL import Image
        arr = np.asarray(arr)
        if arr.dtype != np.uint8:
            arr = np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)
        im = Image.fromarray(arr)
        buf = io.BytesIO()
        if fmt == "jpg":
            im.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True, subsampling=0 if quality >= 92 else 2)
            mime = "image/jpeg"
        else:
            im.save(buf, "PNG", optimize=True)
            mime = "image/png"
        return self.image(key, buf.getvalue(), mime)

    # -- materials ---------------------------------------------------------------------------------
    def material(self, name, color=(1, 1, 1, 1), metallic=0.0, rough=0.7, base_tex=None, normal_tex=None, normal_scale=1.0,
                 mr_tex=None, occ_tex=None, emissive=None, emissive_strength=None, alpha_mode=None, alpha_cutoff=0.5,
                 double_sided=False, extensions=None, srgb=True, spec=None):
        color = list(color)
        if srgb:                                    # factors are linear in glTF; scripts give sRGB
            color[:3] = [float(c) ** 2.2 for c in color[:3]]
            if emissive is not None:
                emissive = [float(c) ** 2.2 for c in emissive]
        m = {"name": name, "pbrMetallicRoughness": {"baseColorFactor": [float(x) for x in color],
                                                    "metallicFactor": float(metallic), "roughnessFactor": float(rough)}}
        if base_tex is not None:
            m["pbrMetallicRoughness"]["baseColorTexture"] = {"index": base_tex}
        if mr_tex is not None:
            m["pbrMetallicRoughness"]["metallicRoughnessTexture"] = {"index": mr_tex}
        if normal_tex is not None:
            m["normalTexture"] = {"index": normal_tex, "scale": float(normal_scale)}
        if occ_tex is not None:
            m["occlusionTexture"] = {"index": occ_tex}
        if emissive is not None:
            m["emissiveFactor"] = [float(x) for x in emissive]
            if emissive_strength:
                m.setdefault("extensions", {})["KHR_materials_emissive_strength"] = {"emissiveStrength": float(emissive_strength)}
        if alpha_mode:
            m["alphaMode"] = alpha_mode
            if alpha_mode == "MASK":
                m["alphaCutoff"] = float(alpha_cutoff)
        if double_sided:
            m["doubleSided"] = True
        if spec is not None:
            m.setdefault("extensions", {})["KHR_materials_specular"] = {"specularFactor": float(spec)}
        if extensions:
            m.setdefault("extensions", {}).update(extensions)
        self.g["materials"].append(m)
        return len(self.g["materials"]) - 1

    # -- nodes / meshes / skins ----------------------------------------------------------------------
    def node(self, name, t=None, r=None, s=None, children=None, mesh=None, skin=None, extras=None, hidden=False):
        n = {"name": name}
        if t is not None:
            n["translation"] = [float(x) for x in t]
        if r is not None:
            n["rotation"] = [float(x) for x in r]
        if s is not None:
            n["scale"] = [float(x) for x in s]
        if children:
            n["children"] = children
        if mesh is not None:
            n["mesh"] = mesh
        if skin is not None:
            n["skin"] = skin
        if extras:
            n["extras"] = dict(extras)
        if hidden:
            n.setdefault("extras", {})["hidden"] = True
            n.setdefault("extras", {})["visible"] = False
            n["extensions"] = {"KHR_node_visibility": {"visible": False}}
            self.uses_visibility = True
        self.g["nodes"].append(n)
        return len(self.g["nodes"]) - 1

    def mesh(self, name, prims):
        """prims: [{pos, nrm, uv, joints, weights, idx, material, color?, uv2?}]"""
        out = []
        for p in prims:
            attrs = {
                "POSITION": self.accessor(p["pos"], "VEC3", target=34962, minmax=True),
                "NORMAL": self.accessor(p["nrm"], "VEC3", target=34962),
                "TEXCOORD_0": self.accessor(p["uv"], "VEC2", target=34962),
            }
            if "joints" in p:
                j = np.asarray(p["joints"])
                w = np.asarray(p["weights"], np.float64)
                w = w / np.maximum(w.sum(axis=1, keepdims=True), 1e-9)
                q = np.floor(w * 255.0 + 0.5).astype(np.int64)
                # make every row sum to exactly 255 (add the rounding error to the dominant weight)
                q[np.arange(len(q)), w.argmax(axis=1)] += 255 - q.sum(axis=1)
                q = np.maximum(q, 0)
                attrs["JOINTS_0"] = self.accessor(j.astype(np.uint8), "VEC4", UBYTE, target=34962)
                attrs["WEIGHTS_0"] = self.accessor(q.astype(np.uint8), "VEC4", UBYTE, target=34962, normalized=True)
            if "color" in p and p["color"] is not None:
                c = np.asarray(p["color"], np.float32)
                attrs["COLOR_0"] = self.accessor(c[:, :3], "VEC3", target=34962)
            if "uv2" in p and p["uv2"] is not None:
                attrs["TEXCOORD_1"] = self.accessor(p["uv2"], "VEC2", target=34962)
            ii = np.asarray(p["idx"]).reshape(-1)
            icomp = USHORT if int(ii.max()) < 65535 else UINT
            prim = {"attributes": attrs, "indices": self.accessor(ii, "SCALAR", icomp, target=34963),
                    "material": p["material"]}
            out.append(prim)
        self.g["meshes"].append({"name": name, "primitives": out})
        return len(self.g["meshes"]) - 1

    def skin(self, joints, ibms, skeleton_root, name=None):
        """ibms: (J, 4, 4) inverse bind matrices (row-major numpy); glTF wants column-major."""
        acc = self.accessor(np.array([m.T.reshape(-1) for m in ibms]), "MAT4")
        s = {"joints": joints, "inverseBindMatrices": acc, "skeleton": skeleton_root}
        if name:
            s["name"] = name
        self.g["skins"].append(s)
        return len(self.g["skins"]) - 1

    def animation(self, name, times, tracks):
        """tracks: [(node, 'rotation'|'translation', values)]  (values: (T, 4) xyzw or (T, 3))."""
        tin = self.accessor(np.asarray(times, np.float32).reshape(-1), "SCALAR", minmax=True)
        samplers, channels = [], []
        for node, path, vals in tracks:
            vals = np.asarray(vals, np.float32)
            kind = "VEC4" if path == "rotation" else "VEC3"
            out = self.accessor(vals, kind)
            samplers.append({"input": tin, "output": out, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})
        self.g["animations"].append({"name": name, "samplers": samplers, "channels": channels})

    def save(self, path):
        while len(self.bin) % 4:
            self.bin.append(0)
        self.g["buffers"] = [{"byteLength": len(self.bin)}]
        for k in ("skins", "animations", "materials", "images", "textures", "samplers"):
            if not self.g[k]:
                del self.g[k]
        used = []
        if self.uses_visibility:
            used.append("KHR_node_visibility")
        for ext in ("KHR_materials_emissive_strength", "KHR_materials_specular", "KHR_materials_clearcoat"):
            if any(ext in m.get("extensions", {}) for m in self.g.get("materials", [])):
                used.append(ext)
        if used:
            self.g["extensionsUsed"] = used
        js = json.dumps(self.g, separators=(",", ":")).encode()
        while len(js) % 4:
            js += b" "
        with open(path, "wb") as f:
            total = 12 + 8 + len(js) + 8 + len(self.bin)
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack("<II", len(self.bin), 0x004E4942))
            f.write(bytes(self.bin))
        return total

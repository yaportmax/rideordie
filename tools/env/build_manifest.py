"""Merge tools/env/props_manifest/*.json (written by envlib.finish) into public/models/props/manifest.json.
   Re-reads every GLB with glb_info so tris/height/radius are always the real numbers.  usage: build_manifest.py"""
import glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_info import info

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PROPS = os.path.join(ROOT, "public", "models", "props")
FRAG = os.path.join(ROOT, "tools", "env", "props_manifest")


def main():
    frags = {}
    for p in glob.glob(os.path.join(FRAG, "*.json")):
        d = json.load(open(p))
        frags[d["name"]] = d
    out = {}
    for f in sorted(glob.glob(os.path.join(PROPS, "*.glb"))):
        name = os.path.splitext(os.path.basename(f))[0]
        if name.startswith("_"):
            continue
        r = info(f)
        d = frags.get(name, {})
        mn, mx = r["min"], r["max"]
        entry = dict(
            file="%s.glb" % name,
            category=d.get("category", "prop"),
            height=round(mx[1] - mn[1], 3),                               # glTF Y (up)
            radius=round(max(abs(mn[0]), abs(mx[0]), abs(mn[2]), abs(mx[2])), 3),
            size=[round(mx[0] - mn[0], 3), round(mx[1] - mn[1], 3), round(mx[2] - mn[2], 3)],   # x, y(up), z in glTF axes
            tris=r["tris"],
            materials=[m["name"] for m in r["materials"]],
            kb=round(os.path.getsize(f) / 1024, 1),
        )
        for k in ("lod", "billboard", "variants", "alpha_tested", "notes"):
            if d.get(k) is not None:
                entry[k] = d[k]
        if any(m["alpha"] == "MASK" for m in r["materials"]):
            entry["alpha_tested"] = True
        out[name] = entry
    doc = dict(
        _readme="Props are instancing-friendly GLBs: metres, Y up, origin at base centre (min y = 0). COLOR_0 holds baked ambient occlusion (multiply base colour). "
                "Materials are named after the textures in public/textures/<name>/ where applicable (rock_grey, rock_red, cliff, concrete, rust_metal...): game code may swap them. "
                "*_lod / *_billboard files are cheaper stand-ins for the same prop (same base footprint). "
                "Foliage (pines, shrubs, palm, grass) uses alphaMode MASK + doubleSided cards and carries a small emissive term (emissive = albedo*0.6-0.85, KHR_materials_emissive_strength) as a fake ambient floor so shaded sides never go black: set material.emissive to black / emissiveIntensity 0 if the game has its own hemisphere/ambient light. "
                "Sign faces and the billboard read from glTF -Z (toward oncoming traffic when the road runs +Z; rotate 180deg about Y otherwise); guardrail traffic side is +X; guardrail_4m and fence_chainlink_4m tile every 4.0 m along Z; wire_span shares utility_pole's origin transform and spans 20 m along +Z; skeleton_car_frame faces +Z. "
                "Rocks: rock_0N (rock_grey) and rock_0N_red variants share geometry; swap the material by name for other biomes.",
        props=out,
    )
    with open(os.path.join(PROPS, "manifest.json"), "w") as f:
        json.dump(doc, f, indent=1)
    tot = sum(v["kb"] for v in out.values())
    print("manifest: %d props, %.1f MB total" % (len(out), tot / 1024))


if __name__ == "__main__":
    main()

"""Fast model review build (meshes + textures + only idle_stand / idle_sit_drive / pose_rifle) into shots/chars/mdl/<id>.glb.

    C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/characters/build_review.py raider_a [raider_b ...]
"""
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anim  # noqa: E402

OUT = "C:/Dev/rideordie/shots/chars/mdl"
_orig = anim.build_clips


def _quick(heads, **kw):
    kw.pop("only", None)
    return _orig(heads, only=["pose_rifle", "idle_stand", "idle_sit_drive"], **kw)


anim.build_clips = _quick
os.makedirs(OUT, exist_ok=True)
for cid in sys.argv[1:]:
    mod = importlib.import_module("c_" + cid)
    ctx = mod.build_full() if cid == "hero_gunner" else mod.build()
    hero = cid.startswith("hero")
    sizes = dict(body=2048, hair=1024, eye=256) if hero else dict(body=1024, hair=512, eye=128)
    if cid == "hero_gunner":
        sizes["armor"] = 2048
    hidden = ("armor_t1", "armor_t2", "armor_t3") if cid == "hero_gunner" else ()
    ctx.save_final(OUT + "/%s.glb" % cid, hidden_groups=hidden, atlas_sizes=sizes)

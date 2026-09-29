"""Build every character GLB into public/models/characters/.

    C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/characters/build_all.py [id ...]

ids: hero_gunner hero_driver raider_a raider_b raider_c raider_d raider_driver (default: all)
"""
import importlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import charbuild

IDS = ["hero_gunner", "hero_driver", "raider_a", "raider_b", "raider_c", "raider_d", "raider_driver"]


def main(ids):
    stats = {}
    for cid in ids:
        t0 = time.time()
        mod = importlib.import_module("c_" + cid)
        if cid == "hero_gunner":
            ctx = mod.build_full()
            hidden = ("armor_t1", "armor_t2", "armor_t3")
        else:
            ctx = mod.build()
            hidden = ()
        path = charbuild.OUT_DIR + "/%s.glb" % cid
        hero = cid.startswith("hero")
        sizes = dict(body=2048, hair=1024, eye=256) if hero else dict(body=1024, hair=512, eye=128)
        size = ctx.save_final(path, hidden_groups=hidden, atlas_sizes=sizes)
        stats[cid] = dict(tris_total=ctx.tri_count(), tris_body=ctx.tri_count("main"), bytes=size,
                          groups={g: ctx.tri_count(g) for g in ctx.groups if g != "main"},
                          materials=sorted(ctx.mats), height=float(ctx.ch.pos[:, 1].max()), seconds=round(time.time() - t0, 1))
        print("== %s: %d tris, %.2f MB, %.0fs" % (cid, ctx.tri_count(), size / 1e6, time.time() - t0), flush=True)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_build_stats.json")
    old = json.load(open(out)) if os.path.exists(out) else {}
    old.update(stats)
    json.dump(old, open(out, "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:] or IDS)

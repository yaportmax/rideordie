"""remeta.py - recompute meta JSON for all existing ogg files (no re-encode)."""
import glob, json, os, sys
import render as R
import manifest as M
from concurrent.futures import ProcessPoolExecutor

def one(f):
    g = os.path.basename(os.path.dirname(f)); fn = os.path.basename(f)[:-4]
    x = R.decode_ogg(f)
    mp = os.path.join(R.META, g, fn + ".json")
    old = json.load(open(mp)) if os.path.exists(mp) else {}
    loop = old.get("loop_jump") is not None
    m = R.analyze(x, loop)
    for k in ("src_len", "dec_len", "variation", "build_s", "loop_jump_src"):
        if k in old: m[k] = old[k]
    m["file"] = f"{g}/{fn}.ogg"; m["bytes"] = os.path.getsize(f)
    os.makedirs(os.path.dirname(mp), exist_ok=True)
    json.dump(m, open(mp, "w"))
    return fn

if __name__ == "__main__":
    files = sorted(glob.glob(os.path.join(R.OUT, "*", "*.ogg")))
    with ProcessPoolExecutor(max_workers=12) as ex:
        n = len(list(ex.map(one, files, chunksize=4)))
    print("remeta", n)

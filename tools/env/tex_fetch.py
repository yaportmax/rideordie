"""Download CC0 PBR maps from Poly Haven (2k jpg) into the art cache (outside the repo).
   maps: Diffuse, nor_gl (OpenGL normal), arm (AO/Rough/Metal packed; falls back to AO + Rough + Metal), Displacement.
   usage: tex_fetch.py [--res 2k] id id ...   (skips files already cached)"""
import json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
CACHE = os.environ.get("ROD_ART_CACHE", "C:/Dev/art_cache/rideordie/env")

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "rod-asset-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()

def fetch(asset, res="2k"):
    d = os.path.join(CACHE, asset); os.makedirs(d, exist_ok=True)
    files = json.loads(get("https://api.polyhaven.com/files/%s" % asset))
    info = json.loads(get("https://api.polyhaven.com/info/%s" % asset))
    with open(os.path.join(d, "info.json"), "w") as f:
        json.dump({"name": info.get("name"), "authors": info.get("authors"), "dimensions_mm": info.get("dimensions")}, f)
    want = ["Diffuse", "nor_gl", "arm", "Displacement"]
    if "arm" not in files:
        want += ["AO", "Rough", "Metal"]
    for k in want:
        m = files.get(k)
        if not m: continue
        pick = m.get(res) or m.get("1k")
        if not pick or "jpg" not in pick: continue
        p = os.path.join(d, k + ".jpg")
        if os.path.exists(p) and os.path.getsize(p) > 1000: continue
        open(p, "wb").write(get(pick["jpg"]["url"]))
    print("ok", asset, flush=True)

if __name__ == "__main__":
    a = sys.argv[1:]; res = "2k"
    if a and a[0] == "--res": res = a[1]; a = a[2:]
    with ThreadPoolExecutor(6) as ex:
        list(ex.map(lambda i: fetch(i, res), a))

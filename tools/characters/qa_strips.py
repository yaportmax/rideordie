"""Render clip strips (N evenly spaced clip times, fixed camera) through tools/characters/qa.html for animation review.

    python tools/characters/qa_strips.py <model.glb url> <clip>[,<clip>...] [--weapon rifle] [--az 30] [--el 8] [--n 8]
        [--dist 4.4] [--ty 0.95] [--tz 0] [--tx 0] [--t0 0] [--t1 <dur>] [--out shots/chars/strips] [--vehicle id --seat gunner]
        [--lik] [--h 440] [--views az:el,az:el]   (several views -> one strip per view, stacked in one PNG)

Needs the no-HMR dev server on :5180.  Prints the output paths.
"""
import argparse
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import reanim  # noqa: E402


def norm_url(url):
    url = url.replace("\\", "/")
    if "Program Files/Git/" in url:
        url = url.split("Program Files/Git", 1)[1]
    return "/" + url.lstrip("/")


def clip_durations(url):
    path = os.path.join(ROOT, "public" + url) if url.startswith("/models") else os.path.join(ROOT, url.lstrip("/"))
    js, binb = reanim.read_glb(path)
    out = {}
    for a in js.get("animations", []):
        T = 0.0
        for s in a["samplers"]:
            acc = js["accessors"][s["input"]]
            T = max(T, float(acc["max"][0]))
        out[a["name"]] = T
    return out


def shot(query, out, w, h):
    cmd = ["node", os.path.join(ROOT, "tools/test/shot.mjs"), "tools/characters/qa.html?" + query, out,
           "--base=http://localhost:5180", "--wait=700", "--quiet", "--timeout=60000", "--w=%d" % w, "--h=%d" % h]
    subprocess.run(cmd, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("clips")
    ap.add_argument("--weapon")
    ap.add_argument("--lik", action="store_true")
    ap.add_argument("--wl")
    ap.add_argument("--rail")
    ap.add_argument("--az", type=float, default=30)
    ap.add_argument("--el", type=float, default=8)
    ap.add_argument("--views")
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--dist", type=float, default=4.4)
    ap.add_argument("--ty", type=float, default=0.95)
    ap.add_argument("--tz", type=float)
    ap.add_argument("--tx", type=float)
    ap.add_argument("--t0", type=float, default=0.0)
    ap.add_argument("--t1", type=float)
    ap.add_argument("--times")
    ap.add_argument("--out", default="shots/chars/strips")
    ap.add_argument("--vehicle")
    ap.add_argument("--seat", default="gunner")
    ap.add_argument("--vyaw", type=float, default=0)
    ap.add_argument("--h", type=int, default=440)
    ap.add_argument("--cw", type=int, default=230)
    ap.add_argument("--tag", default="")
    ap.add_argument("--fov", type=float, default=30)
    a = ap.parse_args()
    a.model = norm_url(a.model)
    durs = clip_durations(a.model)
    os.makedirs(os.path.join(ROOT, a.out), exist_ok=True)
    views = [tuple(map(float, v.split(":"))) for v in a.views.split(",")] if a.views else [(a.az, a.el)]
    jobs = []
    for clip in a.clips.split(","):
        T = durs.get(clip)
        if T is None:
            print("no clip", clip, "in", a.model, "- have", sorted(durs))
            continue
        if a.times:
            ts = [float(x) for x in a.times.split(",")]
        else:
            t1 = a.t1 if a.t1 is not None else T
            ts = list(np.linspace(a.t0, t1, a.n))
        for vi, (az, el) in enumerate(views):
            q = "model=%s&anim=%s&noinfo=1&labels=1&cols=%d&times=%s&az=%g&el=%g&dist=%g&ty=%g&fov=%g" % (
                a.model, clip, len(ts), ",".join("%.3f" % t for t in ts), az, el, a.dist, a.ty, a.fov)
            if a.tz is not None:
                q += "&tz=%g" % a.tz
            if a.tx is not None:
                q += "&tx=%g" % a.tx
            if a.weapon:
                q += "&weapon=" + a.weapon
            if a.lik:
                q += "&lik=1"
            if a.wl:
                q += "&wl=" + a.wl
            if a.rail:
                q += "&rail=" + a.rail
            if a.vehicle:
                q += "&vehicle=%s&seat=%s&vyaw=%g" % (a.vehicle, a.seat, a.vyaw)
            out = os.path.join(ROOT, a.out, "%s%s_v%d.png" % (clip, a.tag, vi))
            jobs.append((clip, q, out, a.cw * len(ts), a.h))
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(lambda j: shot(j[1], j[2], j[3], j[4]), jobs))
    # stack the views of each clip into one image
    by = {}
    for clip, q, out, w, h in jobs:
        by.setdefault(clip, []).append(out)
    for clip, outs in by.items():
        ims = [Image.open(o) for o in outs if os.path.exists(o)]
        if not ims:
            continue
        W = max(i.width for i in ims)
        sheet = Image.new("RGB", (W, sum(i.height for i in ims)))
        y = 0
        for im in ims:
            sheet.paste(im, (0, y))
            y += im.height
        dst = os.path.join(ROOT, a.out, "%s%s.png" % (clip, a.tag))
        sheet.save(dst)
        for o in outs:
            if o != dst and os.path.exists(o):
                os.remove(o)
        print(dst)


if __name__ == "__main__":
    main()

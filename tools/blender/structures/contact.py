"""Contact sheets: one hero view per structure -> shots/structures/_c/*.png -> tiled shots/structures/contact_sheet_<group>.png (+ all).
python tools/blender/structures/contact.py [group ...]"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
os.chdir(ROOT)
man = json.load(open("public/models/structures/manifest.json"))
want = set(sys.argv[1:])
os.makedirs("shots/structures/_c", exist_ok=True)
ROAD = {"road"}   # groups whose pieces are road-aligned
EXTRA = {"natural_arch": "road=1", "dam_road_10m": "road=1", "dam_gate_big": "road=1", "spike_wall": "road=1", "spike_gate": "road=1"}


def shot(i_e):
    i, e = i_e
    q = "haze=1&az=32&el=13"
    if e["group"] in ROAD or e["id"] in EXTRA:
        q += "&road=1"
    else:
        q += "&road=0&gcol=4a4032"
    if e["id"] in ("bridge_span_20m", "bridge_arch", "bridge_pier"):
        q += "&gy=-14&road=0"
    if e["id"] in ("overpass_concrete",):
        q += "&az=28"
    dx, dy, dz = e["dims"]
    dist = max(2.5 * dy, 1.55 * max(dx, dz), 8.0)
    q += "&dist=%.1f" % dist
    out = "shots/structures/_c/%03d_%s.png" % (i, e["id"])
    cmd = ["node", "tools/test/shot.mjs", "tools/blender/structures/qa.html?model=/models/structures/%s.glb&%s" % (e["id"], q), out, "--quiet", "--w=720", "--h=480", "--wait=900"]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out


order = ["road", "city", "outpost", "dam", "coast", "canyon", "other"]
ents = sorted(man["structures"], key=lambda e: (order.index(e["group"]) if e["group"] in order else 99, e["id"]))
ents = [e for e in ents if not want or e["group"] in want or e["id"] in want]
with ThreadPoolExecutor(4) as ex:
    outs = list(ex.map(shot, enumerate(ents)))
# tile
listing = "shots/structures/_c/list.txt"
with open(listing, "w") as fh:
    for o in outs:
        fh.write("file '%s'\n" % os.path.basename(o))
n = len(outs)
cols = 5
rows = (n + cols - 1) // cols
name = "contact_sheet" + ("_" + "_".join(sorted(want)) if want else "") + ".png"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listing, "-vf", "tile=%dx%d:padding=4:color=0x101010" % (cols, rows), "-frames:v", "1", "shots/structures/" + name], check=False)
print("wrote shots/structures/%s (%d tiles)" % (name, n))

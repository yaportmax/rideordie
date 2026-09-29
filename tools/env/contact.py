"""Contact sheet of all props from shots/env/<name>.png (single-view shots; make them with tools/env/shots.mjs).
   usage: contact.py [out.png] [--cols 6] [--only name,name] [--w 480 --h 320]"""
import glob, json, os, sys
from PIL import Image, ImageDraw
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
a = sys.argv[1:]
out = os.path.join(ROOT, "shots", "env", "_contact_sheet.png")
cols, cw, ch, only = 6, 480, 320, None
i = 0
while i < len(a):
    if a[i] == "--cols": cols = int(a[i + 1]); i += 2
    elif a[i] == "--only": only = a[i + 1].split(","); i += 2
    elif a[i] == "--w": cw = int(a[i + 1]); i += 2
    elif a[i] == "--h": ch = int(a[i + 1]); i += 2
    else: out = a[i]; i += 1
man = json.load(open(os.path.join(ROOT, "public", "models", "props", "manifest.json")))["props"]
names = [n for n in man if (not only or n in only)]
order = {"rock": 0, "boulder": 1, "pillar": 2}
names.sort(key=lambda n: (man[n]["category"], n))
rows = (len(names) + cols - 1) // cols
sh = Image.new("RGB", (cols * cw, rows * ch), (16, 16, 18))
for k, n in enumerate(names):
    p = os.path.join(ROOT, "shots", "env", n + ".png")
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert("RGB")
    # crop the viewer's info text strip, fit to cell
    im = im.resize((cw, ch), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    e = man[n]
    d.rectangle([0, ch - 16, cw, ch], fill=(0, 0, 0))
    d.text((4, ch - 14), "%s  %s  h%.1fm r%.1fm  %dt" % (n, e["category"], e["height"], e["radius"], e["tris"]), fill=(255, 255, 0))
    sh.paste(im, ((k % cols) * cw, (k // cols) * ch))
sh.save(out)
print(out, sh.size, len(names), "props")

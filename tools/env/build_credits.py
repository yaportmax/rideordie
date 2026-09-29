"""Append / refresh the ENVIRONMENT section of CREDITS.md (Poly Haven CC0 sources actually used by tools/env scripts).
   A cached Poly Haven asset is credited if its id appears in any tools/env script (other than the fetch/browse helpers)."""
import glob, json, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
CACHE = "C:/Dev/art_cache/rideordie/env"
false_pos = {"rock_01", "pebbles"}    # our own prop / texture names that collide with unused Poly Haven ids
skip = {"tex_fetch.py", "ph_list.py", "ph_thumbs.py", "cache_sheet.py", "build_credits.py"}
text = ""
for p in glob.glob(os.path.join(ROOT, "tools", "env", "**", "*.py"), recursive=True):
    if os.path.basename(p) in skip:
        continue
    text += open(p, encoding="utf-8", errors="ignore").read() + "\n"
used = []
for d in sorted(os.listdir(CACHE)):
    ip = os.path.join(CACHE, d, "info.json")
    if not os.path.exists(ip) or d in false_pos:
        continue
    if re.search(r"(?<![A-Za-z0-9_])" + re.escape(d) + r"(?![A-Za-z0-9_])", text):
        info = json.load(open(ip))
        used.append((d, info.get("name") or d, ", ".join(sorted((info.get("authors") or {}).keys()))))

START, END = "<!-- ENV-CREDITS-START -->", "<!-- ENV-CREDITS-END -->"
sec = [START, "", "## Environment art (public/textures, public/models/props)",
       "Procedural work (particle sprites, road-marking atlas, wind ripples / lane wear, all prop geometry, signs, foliage cards, hazard marks) was generated offline by `tools/env` "
       "(Python/numpy/scipy/PIL, Blender 4.5). No copyrighted or AI-generated art.", "",
       "PBR photoscan sources - **Poly Haven (polyhaven.com), CC0 1.0** (https://creativecommons.org/publicdomain/zero/1.0/); regraded / mirrored / flattened / packed to ARM by `tools/env/build_textures.py`:", ""]
for d, name, au in used:
    sec.append("- `%s` (%s) - %s" % (d, name, au or "Poly Haven"))
sec += ["", END, ""]
p = os.path.join(ROOT, "CREDITS.md")
cur = open(p, encoding="utf-8").read() if os.path.exists(p) else "# Credits\n"
if START in cur:
    cur = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"\n?", "\n".join(sec), cur, flags=re.S)
else:
    cur = cur.rstrip("\n") + "\n\n" + "\n".join(sec)
open(p, "w", encoding="utf-8").write(cur)
print("credited %d Poly Haven assets" % len(used))

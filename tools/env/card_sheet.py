"""composite RGBA cards over a mid-blue background for review.  usage: card_sheet.py out.png name name ..."""
import os, sys
from PIL import Image, ImageDraw
PT = "C:/Dev/art_cache/rideordie/props_tex"
out, names = sys.argv[1], sys.argv[2:]
tiles = []
for n in names:
    p = os.path.join(PT, n + ".png")
    if not os.path.exists(p): p = os.path.join(PT, n + "_albedo.jpg")
    im = Image.open(p).convert("RGBA")
    bg = Image.new("RGBA", im.size, (120, 150, 180, 255)); bg.alpha_composite(im)
    d = ImageDraw.Draw(bg); d.text((3, 3), n, fill=(255, 255, 0, 255))
    tiles.append(bg.convert("RGB"))
cols = 4; cw = max(t.size[0] for t in tiles); ch = max(t.size[1] for t in tiles)
rows = (len(tiles) + cols - 1) // cols
sh = Image.new("RGB", (cols * cw, rows * ch))
for k, t in enumerate(tiles): sh.paste(t, ((k % cols) * cw, (k // cols) * ch))
sh.save(out)

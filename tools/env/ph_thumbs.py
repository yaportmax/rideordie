"""Make a labelled contact sheet of Poly Haven texture thumbnails.  usage: ph_thumbs.py out.png id id ..."""
import sys, io, urllib.request
from PIL import Image, ImageDraw
out, ids = sys.argv[1], sys.argv[2:]
tiles = []
for i in ids:
    try:
        req = urllib.request.Request("https://cdn.polyhaven.com/asset_img/thumbs/%s.png?width=256&height=256" % i, headers={"User-Agent": "rod-asset-fetch/1.0"})
        im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert("RGB").resize((256, 256))
    except Exception as e:
        print("fail", i, e); im = Image.new("RGB", (256, 256), (60, 0, 0))
    d = ImageDraw.Draw(im); d.rectangle([0, 0, 256, 14], fill=(0, 0, 0)); d.text((2, 1), i, fill=(255, 255, 0))
    tiles.append(im)
cols = 6
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cols * 256, rows * 256))
for k, t in enumerate(tiles):
    sheet.paste(t, ((k % cols) * 256, (k // cols) * 256))
sheet.save(out)
print("saved", out, sheet.size)

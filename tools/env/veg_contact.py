import sys, os
from PIL import Image, ImageDraw
names = sys.argv[2:]
tiles = []
for n in names:
    im = Image.open("C:/Dev/rideordie/shots/env/%s.png" % n).convert("RGB")
    tiles.append(im)
cols = 4
w, h = tiles[0].size
rows = (len(tiles) + cols - 1) // cols
sh = Image.new("RGB", (cols * w, rows * h))
for k, t in enumerate(tiles): sh.paste(t, ((k % cols) * w, (k // cols) * h))
sh.save(sys.argv[1])

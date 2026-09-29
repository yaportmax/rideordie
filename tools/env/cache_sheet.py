import sys, os
from PIL import Image, ImageDraw
C = "C:/Dev/art_cache/rideordie/env"
out, ids = sys.argv[1], sys.argv[2:]
S = 384; cols = 4
rows = (len(ids)+cols-1)//cols
sh = Image.new("RGB", (cols*S, rows*S))
for k, i in enumerate(ids):
    im = Image.open(os.path.join(C, i, "Diffuse.jpg")).convert("RGB").resize((S, S), Image.LANCZOS)
    d = ImageDraw.Draw(im); d.rectangle([0,0,S,14], fill=(0,0,0)); d.text((2,1), i, fill=(255,255,0))
    sh.paste(im, ((k%cols)*S, (k//cols)*S))
sh.save(out); print(out)

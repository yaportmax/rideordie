"""1:1 crops of albedo (512px) for detail review.  usage: tex_crop.py out.png name name ..."""
import os, sys
from PIL import Image, ImageDraw
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
T = os.path.join(ROOT, "public", "textures")
out, names = sys.argv[1], sys.argv[2:]
cols = 3; S = 512
rows = (len(names) + cols - 1) // cols
sh = Image.new("RGB", (cols * S, rows * S))
for k, nm in enumerate(names):
    im = Image.open(os.path.join(T, nm, "albedo.jpg")).convert("RGB")
    w = im.size[0]
    c = im.crop((w // 2 - S // 2, w // 2 - S // 2, w // 2 + S // 2, w // 2 + S // 2))
    d = ImageDraw.Draw(c); d.rectangle([0, 0, 120, 13], fill=(0, 0, 0)); d.text((2, 1), nm, fill=(255, 255, 0))
    sh.paste(c, ((k % cols) * S, (k // cols) * S))
sh.save(out)

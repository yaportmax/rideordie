"""Preview sheet: albedo tiled 2x2 (seam check) + normal + arm.   usage: tex_preview.py out.png name name ..."""
import os, sys
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
T = os.path.join(ROOT, "public", "textures")
out, names = sys.argv[1], sys.argv[2:]
cols = 2
W, H = 768, 512
rows = (len(names) + cols - 1) // cols
sheet = Image.new("RGB", (cols * W, rows * H), (20, 20, 20))
for k, nm in enumerate(names):
    d = os.path.join(T, nm)
    a = Image.open(os.path.join(d, "albedo.jpg")).convert("RGB").resize((256, 256), Image.LANCZOS)
    cell = Image.new("RGB", (W, H))
    for i in range(2):
        for j in range(2):
            cell.paste(a, (i * 256, j * 256))
    cell.paste(Image.open(os.path.join(d, "normal.jpg")).convert("RGB").resize((256, 256), Image.LANCZOS), (512, 0))
    cell.paste(Image.open(os.path.join(d, "arm.jpg")).convert("RGB").resize((256, 256), Image.LANCZOS), (512, 256))
    dr = ImageDraw.Draw(cell)
    dr.rectangle([0, 0, 200, 13], fill=(0, 0, 0))
    dr.text((2, 1), nm, fill=(255, 255, 0))
    sheet.paste(cell, ((k % cols) * W, (k // cols) * H))
sheet.save(out)
print(out)

"""grid.py out.png in1.png in2.png ... [--cols N] [--w W]  : contact sheet of screenshots (Pillow), for QA"""
import sys
from PIL import Image
args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = dict(a[2:].split('=') for a in sys.argv[1:] if a.startswith('--'))
out, ins = args[0], args[1:]
cols = int(opt.get('cols', 2))
W = int(opt.get('w', 800))
ims = [Image.open(p).convert('RGB') for p in ins]
h = int(W * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
g = Image.new('RGB', (cols * W, rows * h))
for i, im in enumerate(ims):
    g.paste(im.resize((W, h), Image.LANCZOS), ((i % cols) * W, (i // cols) * h))
g.save(out)

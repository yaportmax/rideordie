"""Repack the worn line items of road_markings/markings.png into a small column strip for the road shader.

Output: public/textures/road_markings/lines.png, 9 columns x 64 px wide, 768 px tall (128 px/m, one column = 0.5 m x 6 m).
Columns: 0-3 edge_white_a/b/c/faded (6 m, tiles vertically), 4-6 dash_white_a/b/c (3.2 m at the top, transparent below),
7-8 rumble_a/b (0.9 m wide squeezed into 0.5 m, 3 m repeated twice). The shader turns each column into one layer of a
DataArrayTexture (no mip bleeding between items). Stored OPAQUE (canvas readback would drop colour under alpha 0):
R = paint brightness (bled under the gaps), G = paint coverage (alpha), B = 0.
"""
import json
from PIL import Image

SRC = 'public/textures/road_markings/'
atlas = Image.open(SRC + 'markings.png').convert('RGBA')
items = json.load(open(SRC + 'markings.json'))['items']
COLW, H = 64, 768
cols = ['edge_white_a', 'edge_white_b', 'edge_white_c', 'edge_white_faded', 'dash_white_a', 'dash_white_b', 'dash_white_c', 'rumble_a', 'rumble_b']
out = Image.new('RGBA', (COLW * len(cols), H), (0, 0, 0, 0))
for i, name in enumerate(cols):
    it = items[name]
    crop = atlas.crop((it['x'], it['y'], it['x'] + it['w'], it['y'] + it['h']))
    if name.startswith('rumble'):
        crop = crop.resize((COLW, it['h']), Image.LANCZOS)
        out.paste(crop, (i * COLW, 0)); out.paste(crop, (i * COLW, it['h']))
    else:
        ox = i * COLW + (COLW - it['w']) // 2
        out.paste(crop, (ox, 0))
# bleed colour under transparent texels (so mips never pull in black)
px = out.load()
W = out.size[0]
for x in range(W):
    col = x // COLW
    for y in range(H):
        r, g, b, a = px[x, y]
        if a == 0:
            px[x, y] = (200, 200, 196, 0) if col < 7 else (40, 40, 40, 0)
rgb = Image.new('RGB', out.size)
rp = rgb.load()
for x in range(W):
    for y in range(H):
        r, g, b, a = px[x, y]
        rp[x, y] = (int(0.3 * r + 0.55 * g + 0.15 * b), a, 0)
rgb.save(SRC + 'lines.png', optimize=True)
print('saved', out.size)

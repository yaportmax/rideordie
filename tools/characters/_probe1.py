import sys
sys.path.insert(0, 'C:/Dev/rideordie/tools/characters')
import mh
import numpy as np
b = mh.Body()
tv, tt = mh.triangulate(b.faces, lambda g: g == 'body')
for age, h in ((0.5, 0.5), (0.5, 0.7), (0.5, 1.0), (0.6, 0.5)):
    b.shape(dict(gender=1.0, age=age, muscle=0.6, weight=0.4, height=h))
    pts = mh.to_game(b.v[:13380])
    print(age, h, 'height', pts[:, 1].max() - pts[:, 1].min())
sk = mh.game_skeleton(b)
W = mh.weight_matrix(b, sk, 13380)
top = np.argmax(W, axis=1)
cnt = {}
for t in tv:
    n = mh.BONE_NAMES[top[t[0]]]
    grp = 'head' if n in ('Head', 'Neck') else 'hand' if 'Hand' in n else 'foot' if 'Foot' in n or 'Toe' in n else 'arm' if 'Arm' in n or 'Shoulder' in n else 'leg' if 'Leg' in n else 'torso'
    cnt[grp] = cnt.get(grp, 0) + 1
print(cnt)

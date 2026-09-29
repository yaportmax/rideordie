import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "buggy.py")).read().replace("V.finish(bake=True)", "")
exec(compile(src, "buggy.py", "exec"))
from collections import Counter
c = Counter()
for o in REG["body"]:
    k = o.material_slots[0].material.name if o.material_slots and o.material_slots[0].material else "NONE:" + str(len(o.material_slots))
    c[k] += 1
print("KEYS", dict(c))
print("bad", [o.name for o in REG["body"] if not o.material_slots][:10])

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "technical.py"), encoding="utf8").read()
src = src.replace("V.finish(bake=True)", "")
exec(compile(src, "technical.py", "exec"))
from collections import Counter
c = Counter()
for o in REG["body"]:
    k = o.material_slots[0].material.name if o.material_slots and o.material_slots[0].material else "none"
    c[k] += 1
print("KEYS", dict(c))
print("TUB", [s.material.name if s.material else None for s in tub.material_slots])

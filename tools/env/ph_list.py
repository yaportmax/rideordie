import json, urllib.request, sys
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "rod-asset-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()
t = sys.argv[1] if len(sys.argv) > 1 else "textures"
d = json.loads(get("https://api.polyhaven.com/assets?t=" + t))
print(len(d))
for k, v in sorted(d.items()):
    print(k, "|", ",".join(v.get("categories", [])), "|", ",".join(v.get("tags", []))[:80], "|", v.get("dimensions"))
